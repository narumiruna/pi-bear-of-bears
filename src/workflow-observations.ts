import { randomUUID } from "node:crypto";
import type { GameMessage } from "./game.js";
import { nativeBossCataloguePages } from "./workflow-boss-catalogue.js";
import { nativeBossRespawnPages } from "./workflow-boss-respawn.js";
import {
  buildContinuation,
  ContinuationReports,
} from "./workflow-continuation.js";
import { ControlIdentity } from "./workflow-control-identity.js";
import { idleReportCharacter } from "./workflow-events.js";
import {
  barrierEvent,
  summarizeStatusInvalidation,
} from "./workflow-invalidation.js";
import { inventoryObservation } from "./workflow-inventory-observation.js";
import { observationChannel } from "./workflow-observation-channel.js";
import {
  homeFacts,
  roomFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
  WORKFLOW_QUERY,
} from "./workflow-parsers.js";
import { knownQueryObservation } from "./workflow-query-observation.js";
import { canBindRepeatedObservation } from "./workflow-request-binding.js";
import type { WorkflowResult } from "./workflow-result.js";
import { runtimeEffectReplyFacts } from "./workflow-runtime-effects.js";

export * from "./workflow-parsers.js";

import type {
  BarrierEvent,
  Checkpoint,
  Invalidator,
  Observation,
  ObservationChannel,
  Source,
} from "./workflow-observation-types.js";

export type { Checkpoint, Observation, ObservationChannel, Source };

/** 分支內原文觀測；有界保存，不持久化執行資格。 */
export class WorkflowObservations {
  private readonly records = new Map<number, Observation>();
  private readonly checkpoints = new Map<string, Checkpoint>();
  private epoch = 0;
  private barrier = 0;
  private invalidator: Invalidator | null = null;
  private coverage = 0;
  private evictedMessages = 0;
  private actor: string | null = null;
  private readonly identity = new ControlIdentity();
  private controller = new AbortController();
  private readonly continuationReports = new ContinuationReports();
  get signal() {
    return this.controller.signal;
  }
  get generation() {
    return this.epoch;
  }
  reset() {
    this.controller.abort(new Error("分支或 session 已改變。"));
    this.controller = new AbortController();
    this.epoch++;
    this.barrier = 0;
    this.invalidator = null;
    this.coverage = 0;
    this.evictedMessages = 0;
    this.actor = null;
    this.identity.reset();
    this.records.clear();
    this.checkpoints.clear();
    this.continuationReports.reset();
  }
  private advanceBarrier(
    barrierId: number,
    kind: Invalidator["kind"],
    message?: GameMessage,
    request?: string,
  ) {
    if (barrierId < this.barrier) {
      return;
    }
    this.barrier = barrierId;
    this.invalidator = {
      kind,
      barrierId,
      request,
      ...(message
        ? {
            messageId: message.id,
            revision: message.revision,
            date: message.date,
          }
        : {}),
    };
  }
  invalidate(request?: string) {
    this.advanceBarrier(
      Math.max(this.barrier, ...this.records.keys(), 0),
      request ? "non_query_request" : "explicit",
      undefined,
      request,
    );
    this.identity.requested(request, this.barrier);
  }
  /** 最近 barrier 的歷史定位，不產生操作資格。 */
  invalidationEvent(): BarrierEvent | null {
    return barrierEvent(this.invalidator, this.records);
  }
  statusInvalidation() {
    return summarizeStatusInvalidation(
      this.invalidator,
      this.barrier,
      this.records,
    );
  }
  observe(
    messages: readonly GameMessage[],
    request?: string,
    omitted = 0,
    generation = this.epoch,
  ) {
    if (generation !== this.epoch) {
      return;
    }
    const actorAtRequest = this.actor;
    if (request && !WORKFLOW_QUERY.test(request)) {
      this.invalidate(request);
    }
    if (omitted) {
      this.coverage++;
      this.advanceBarrier(
        Math.max(this.barrier, ...this.records.keys(), 0),
        "omitted",
      );
    }
    const bossCatalogue = nativeBossCataloguePages(messages, request);
    const bossRespawn = nativeBossRespawnPages(messages, request);
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
      const previous = this.records.get(message.id);
      if (previous?.message.revision === message.revision) {
        if (
          request &&
          canBindRepeatedObservation(
            this.records.values(),
            previous,
            request,
            this.actor,
            this.epoch,
          )
        ) {
          previous.command = request;
        }
        continue;
      }
      const source: Source = {
        messageId: message.id,
        revision: message.revision,
        date: message.date,
        observedAt: Date.now(),
      };
      const report = idleReportCharacter(message.text);
      if (
        !previous &&
        !message.outgoing &&
        report &&
        !this.identity.pending &&
        this.actor &&
        report !== this.actor
      ) {
        continue;
      }
      const status = statusFacts(message);
      if (status) {
        if (this.actor && this.actor !== status.name) {
          this.epoch++;
          this.advanceBarrier(message.id - 1, "actor_change", message, request);
        }
        this.actor = status.name;
        if (this.identity.pending) {
          this.identity.confirm(
            source,
            knownQueryObservation(message) === true,
          );
        }
      }
      const contextLost =
        !status &&
        !report &&
        (this.identity.pending ||
          (request !== undefined &&
            (actorAtRequest !== this.actor || generation !== this.epoch)));
      let command = message.outgoing ? message.text : (request ?? null);
      if (message.outgoing && !WORKFLOW_QUERY.test(message.text)) {
        this.advanceBarrier(
          message.id,
          "outgoing_change",
          message,
          message.text,
        );
        this.identity.outgoing(
          message.id,
          message.text,
          this.latest(statusFacts, Number.POSITIVE_INFINITY)?.source
            .messageId ?? 0,
        );
      }
      const lastRequest =
        request ??
        [...this.records.values()]
          .reverse()
          .find((record) => record.message.outgoing)?.message.text ??
        "";
      const catalogue =
        /^\/(?:forge|refine|craft)(?:\s|$)/u.test(lastRequest) &&
        /鍛造|進階|精煉|合成|配方/u.test(message.text);
      const continuation =
        /^\s*\d+\. /u.test(message.text) && lastRequest === "/inventory all";
      if (!message.outgoing && continuation) {
        command = lastRequest;
      }
      const inspection =
        /\n類型：/u.test(message.text) && /^\/inspect\s/u.test(lastRequest);
      let known =
        request === "/boss" || request === "/boss_respawn"
          ? (request === "/boss" ? bossCatalogue : bossRespawn).has(message.id)
          : (knownQueryObservation(message) ??
            ((this.actor !== null &&
              !contextLost &&
              runtimeEffectReplyFacts(message, request, source)) ||
              catalogue ||
              continuation ||
              inspection));
      if (contextLost) {
        known = false;
      }
      if (
        !message.outgoing &&
        !known &&
        !report &&
        WORKFLOW_QUERY.test(request ?? "")
      ) {
        command = null;
      }
      if (!message.outgoing && !known) {
        this.advanceBarrier(
          message.id,
          report && !this.identity.pending && report === this.actor
            ? "own_resource_report"
            : "unknown_bot_reply",
          message,
          request,
        );
      }
      if (previous && previous.message.revision !== message.revision) {
        this.advanceBarrier(message.id, "source_revision", message, request);
      }
      this.records.set(message.id, {
        message: structuredClone(message),
        source,
        actor:
          report ??
          (contextLost || (!message.outgoing && !known && !request)
            ? null
            : this.actor),
        command,
        epoch: this.epoch,
      });
    }
    while (this.records.size > 600) {
      this.records.delete(Math.min(...this.records.keys()));
      this.evictedMessages++;
    }
  }
  bindOriginal(
    messages: readonly GameMessage[],
    sourceId: string,
    generation: number,
  ) {
    if (generation !== this.epoch) {
      return;
    }
    for (const message of messages) {
      const record = this.records.get(message.id);
      if (record?.message.revision === message.revision) {
        record.source.originalSourceId = sourceId;
      }
    }
  }
  all() {
    return [...this.records.values()].sort(
      (a, b) => a.message.id - b.message.id,
    );
  }
  currentRecords(maxAge = 60_000) {
    return this.all().filter(
      (record) =>
        !record.message.outgoing &&
        record.actor === this.actor &&
        record.epoch === this.epoch &&
        record.message.id > this.barrier &&
        Date.now() >= record.message.date * 1000 &&
        Date.now() - record.message.date * 1000 <= maxAge,
    );
  }
  latest<T>(parser: (message: GameMessage) => T | undefined, maxAge = 60_000) {
    for (const record of this.all().reverse()) {
      if (
        record.message.outgoing ||
        record.actor !== this.actor ||
        record.epoch !== this.epoch ||
        record.message.id <= this.barrier
      ) {
        continue;
      }
      const parsed = parser(record.message);
      if (parsed !== undefined) {
        const age = Date.now() - record.message.date * 1000;
        if (age < 0 || age > maxAge || Date.now() < record.source.observedAt) {
          return;
        }
        return { value: parsed, source: record.source };
      }
    }
  }
  status() {
    return this.identity.pending ? undefined : this.latest(statusFacts);
  }
  runtimeEffects() {
    const entry = this.latest((message) => {
      const record = this.records.get(message.id);
      return record
        ? runtimeEffectReplyFacts(message, record.command, record.source)
        : undefined;
    });
    return entry ? { effects: entry.value, source: entry.source } : null;
  }
  inventory(maxAge = 300_000) {
    const records = this.all().filter(
      (record) =>
        !record.message.outgoing &&
        record.actor === this.actor &&
        record.epoch === this.epoch &&
        record.message.id > this.barrier,
    );
    return inventoryObservation(records, maxAge);
  }
  channel(source: Source): ObservationChannel | null {
    return observationChannel(this.records.get(source.messageId));
  }
  assertBoundSources(sources: Source[]) {
    const expected = new Map<string, Source>();
    for (const source of sources) {
      const record = this.records.get(source.messageId);
      if (!record || record.message.revision !== source.revision) {
        throw new Error("來源 message ID／revision 已改變。");
      }
      const channel = this.channel(source);
      if (channel) {
        expected.set(channel, source);
      }
    }
    const current = {
      status: this.status()?.source,
      tower: this.latest((message) => towerFacts(message.text))?.source,
      room: this.latest((message) => roomFacts(message.text))?.source,
      home: this.latest((message) => homeFacts(message.text))?.source,
      skills: this.latest((message) => skillsFacts(message.text))?.source,
      inventory: this.inventory()?.sources.at(-1),
    };
    for (const [channel, source] of expected) {
      const fresh = current[channel as keyof typeof current];
      if (
        !fresh ||
        fresh.messageId !== source.messageId ||
        fresh.revision !== source.revision
      ) {
        throw new Error(`相關 ${channel} 觀測已失效或出現更新，須重新核對。`);
      }
    }
  }
  get(id: string, view: "current" | "historical" = "current") {
    const point = this.checkpoints.get(id);
    // 歷史只允許本 store 尚存且來源未變的區間；reset 仍清空全部分支資料。
    if (!point || (view !== "historical" && point.epoch !== this.epoch)) {
      throw new Error("快照不存在、分支或角色已改變。");
    }
    for (const source of point.sources) {
      if (
        this.records.get(source.messageId)?.message.revision !== source.revision
      ) {
        throw new Error("快照來源已修訂或遺失。");
      }
    }
    return structuredClone(point);
  }
  assertCurrent(
    id: string,
    actor: string,
    maxAge = 60_000,
    channels?: readonly ObservationChannel[],
  ) {
    const point = this.get(id);
    // 保留快照修訂、角色、分支及 barrier 檢查，只縮限流程真正相依的時效來源。
    const sources = channels
      ? point.sources.filter((source) => {
          const channel = this.channel(source);
          return channel !== null && channels.includes(channel);
        })
      : point.sources;
    const current = this.status();
    this.assertBoundSources(sources);
    if (
      point.actor !== actor ||
      current?.value.name !== actor ||
      current.source.messageId !== point.sources[0].messageId ||
      current.source.revision !== point.sources[0].revision ||
      sources.some(
        (source) =>
          Date.now() - source.date * 1000 > maxAge ||
          Date.now() < source.date * 1000,
      ) ||
      point.endId <= this.barrier
    ) {
      throw new Error("快照已失效；須重新觀測目前角色與來源。");
    }
    return { ...point, sources };
  }
  /** 只保存未決回報，不因後續唯讀查詢成功就把未知操作清除。 */
  rememberWorkflow(result: WorkflowResult, generation = this.epoch) {
    if (generation !== this.epoch) {
      return;
    }
    this.continuationReports.remember(result, generation);
  }
  /** 單一歷史續行摘要；讀取不刷新時間、不建立可執行快照。 */
  continuation() {
    return buildContinuation(
      this.all(),
      this.actor,
      this.epoch,
      Boolean(this.status()),
      {
        controlIdentityKnown: this.actor !== null && !this.identity.pending,
        pendingWorkflows: this.continuationReports.snapshot(),
        statusInvalidation: this.statusInvalidation(),
        invalidationEvent: this.invalidationEvent(),
        observationCoverage: {
          omittedBatches: this.coverage,
          evictedMessages: this.evictedMessages,
          savedMessages: this.records.size,
        },
      },
    );
  }

  capture(extraSources: Source[] = []) {
    const status = this.status();
    if (!status) {
      throw new Error("缺少新鮮、可綁定的本人 /status 原文。");
    }
    const inventory = this.inventory();
    const home = this.latest((message) => homeFacts(message.text));
    const sources = [
      status.source,
      ...(inventory?.sources ?? []),
      ...(home ? [home.source] : []),
      ...extraSources,
    ];
    const point: Checkpoint = {
      id: randomUUID(),
      coverage: this.coverage,
      epoch: this.epoch,
      actor: status.value.name,
      sources,
      endId: Math.max(...sources.map((source) => source.messageId)),
      status: status.value,
      inventory: inventory?.value ?? null,
      home: home?.value ?? null,
    };
    this.checkpoints.set(point.id, structuredClone(point));
    while (this.checkpoints.size > 64) {
      this.checkpoints.delete(this.checkpoints.keys().next().value as string);
    }
    return point;
  }
}

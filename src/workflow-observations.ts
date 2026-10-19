import { randomUUID } from "node:crypto";
import type { GameMessage } from "./game.js";
import { parseInventory } from "./inventory.js";

import {
  cleanName,
  homeFacts,
  roomFacts,
  runtimeEffectFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
  WORKFLOW_QUERY,
} from "./workflow-parsers.js";

export {
  amount,
  cleanName,
  DIRECTIONS,
  type Direction,
  homeFacts,
  numberValue,
  roomFacts,
  runtimeEffectFacts,
  skillsFacts,
  statusFacts,
  towerFacts,
  WORKFLOW_QUERY,
} from "./workflow-parsers.js";

export interface Source {
  originalSourceId?: string;
  messageId: number;
  revision: string;
  date: number;
  observedAt: number;
}
export interface Observation {
  message: GameMessage;
  source: Source;
  actor: string | null;
  command: string | null;
  epoch: number;
}
export interface Checkpoint {
  id: string;
  coverage: number;
  epoch: number;
  actor: string;
  sources: Source[];
  endId: number;
  status: NonNullable<ReturnType<typeof statusFacts>>;
  inventory: ReturnType<typeof parseInventory> | null;
  home: ReturnType<typeof homeFacts> | null;
}

/** 分支內原文觀測；有界保存，不持久化執行資格。 */
export class WorkflowObservations {
  private readonly records = new Map<number, Observation>();
  private readonly checkpoints = new Map<string, Checkpoint>();
  private epoch = 0;
  private barrier = 0;
  private coverage = 0;
  private actor: string | null = null;
  private controller = new AbortController();
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
    this.coverage = 0;
    this.actor = null;
    this.records.clear();
    this.checkpoints.clear();
  }
  invalidate() {
    this.barrier = Math.max(this.barrier, ...this.records.keys(), 0);
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
    if (request && !WORKFLOW_QUERY.test(request)) {
      this.invalidate();
    }
    if (omitted) {
      this.coverage++;
      this.invalidate();
    }
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
      const previous = this.records.get(message.id);
      if (previous?.message.revision === message.revision) {
        if (request) {
          previous.command = request;
        }
        continue;
      }
      const report = /^【([^\n]+)】\n🐾 (?:已)?掛機 /u.exec(message.text);
      if (report && this.actor && cleanName(report[1]) !== this.actor) {
        continue;
      }
      const status = statusFacts(message);
      if (status) {
        if (this.actor && this.actor !== status.name) {
          this.epoch++;
          this.barrier = message.id - 1;
        }
        this.actor = status.name;
      }
      let command = message.outgoing ? message.text : (request ?? null);
      if (message.outgoing && !WORKFLOW_QUERY.test(message.text)) {
        this.barrier = Math.max(this.barrier, message.id);
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
      const known =
        status ||
        towerFacts(message.text) ||
        roomFacts(message.text) ||
        homeFacts(message.text) ||
        skillsFacts(message.text) ||
        runtimeEffectFacts(message.text) ||
        parseInventory(message) ||
        catalogue ||
        continuation ||
        inspection;
      if (!message.outgoing && !known && WORKFLOW_QUERY.test(request ?? "")) {
        command = null;
      }
      if (!message.outgoing && !known) {
        this.barrier = Math.max(this.barrier, message.id);
      }
      if (previous && previous.message.revision !== message.revision) {
        this.barrier = Math.max(this.barrier, message.id);
      }
      this.records.set(message.id, {
        message: structuredClone(message),
        source: {
          messageId: message.id,
          revision: message.revision,
          date: message.date,
          observedAt: Date.now(),
        },
        actor: !message.outgoing && !known && !request ? null : this.actor,
        command,
        epoch: this.epoch,
      });
    }
    while (this.records.size > 600) {
      this.records.delete(Math.min(...this.records.keys()));
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
    return this.latest(statusFacts);
  }
  runtimeEffects() {
    const entry = this.latest((message) => {
      const record = this.records.get(message.id);
      return record?.command?.startsWith("/skill ")
        ? runtimeEffectFacts(message.text)
        : undefined;
    });
    return entry ? { effects: entry.value, source: entry.source } : null;
  }
  inventory() {
    const records = this.all().filter(
      (record) =>
        !record.message.outgoing &&
        record.actor === this.actor &&
        record.epoch === this.epoch &&
        record.message.id > this.barrier,
    );
    for (let index = records.length - 1; index >= 0; index--) {
      if (!/^🎒 背包（/u.test(records[index].message.text)) {
        continue;
      }
      const parts = [records[index]];
      if (!/🔢 用編號最方便：/u.test(parts[0].message.text)) {
        for (const next of records.slice(index + 1)) {
          if (!/^\s*\d+\. /u.test(next.message.text)) {
            break;
          }
          parts.push(next);
          if (/🔢 用編號最方便：/u.test(next.message.text)) {
            break;
          }
        }
      }
      const last = parts.at(-1);
      if (!last) {
        return;
      }
      const value = parseInventory({
        ...last.message,
        text: parts.map((part) => part.message.text).join("\n"),
      });
      if (!value) {
        return;
      }
      const sources = parts.map((part) => part.source);
      if (
        sources.some(
          (source) =>
            Date.now() - source.date * 1000 > 300_000 ||
            source.date * 1000 > Date.now(),
        )
      ) {
        return;
      }
      return { value, sources };
    }
  }
  channel(source: Source) {
    const record = this.records.get(source.messageId);
    if (!record) {
      return null;
    }
    const message = record.message;
    if (statusFacts(message)) {
      return "status";
    }
    if (towerFacts(message.text)) {
      return "tower";
    }
    if (roomFacts(message.text)) {
      return "room";
    }
    if (homeFacts(message.text)) {
      return "home";
    }
    if (skillsFacts(message.text)) {
      return "skills";
    }
    if (parseInventory(message) || record.command === "/inventory all") {
      return "inventory";
    }
    return null;
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
  get(id: string) {
    const point = this.checkpoints.get(id);
    if (!point || point.epoch !== this.epoch) {
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
  assertCurrent(id: string, actor: string, maxAge = 60_000) {
    const point = this.get(id);
    const current = this.status();
    this.assertBoundSources(point.sources);
    if (
      point.actor !== actor ||
      current?.value.name !== actor ||
      current.source.messageId !== point.sources[0].messageId ||
      current.source.revision !== point.sources[0].revision ||
      point.sources.some(
        (source) =>
          Date.now() - source.date * 1000 > maxAge ||
          Date.now() < source.date * 1000,
      ) ||
      point.endId <= this.barrier
    ) {
      throw new Error("快照已失效；須重新觀測目前角色與來源。");
    }
    return point;
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

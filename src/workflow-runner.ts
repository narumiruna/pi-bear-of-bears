import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { BEARS_RESULT_SCHEMA, decodeBearsResult } from "./bears-result.js";
import type { GameMessage } from "./game.js";
import { STRUCTURED_COMMANDS, serializeCommand } from "./game-commands.js";
import { withDispatchCheck } from "./game-operation.js";
import {
  homeFacts,
  roomFacts,
  type Source,
  skillsFacts,
  statusFacts,
  towerFacts,
  type WorkflowObservations,
} from "./workflow-observations.js";
import type { WorkflowResult, WorkflowScope } from "./workflow-result.js";

class RejectedAction extends Error {}

const observationParsers = {
  room: (message: GameMessage) => roomFacts(message.text),
  tower: (message: GameMessage) => towerFacts(message.text),
  home: (message: GameMessage) => homeFacts(message.text),
  skills: (message: GameMessage) => skillsFacts(message.text),
};
const observationTools = {
  room: "bears_look",
  tower: "bears_tower",
  home: "bears_home",
  skills: "bears_skills",
} as const;
type ObservationChannel = keyof typeof observationParsers;
type ObservationValue<K extends ObservationChannel> = NonNullable<
  ReturnType<(typeof observationParsers)[K]>
>;

/** 固定流程的巢狀工具協調；不接受任意 script 或指令字串。 */
export class WorkflowRunner {
  private commands = 0;
  private changes = 0;
  private readonly started = Date.now();
  private boundSources: Source[] = [];
  constructor(
    readonly store: WorkflowObservations,
    readonly ctx: ExtensionToolContext,
    readonly result: WorkflowResult,
    readonly scope: WorkflowScope | undefined,
    readonly signal: AbortSignal,
  ) {}
  check() {
    this.signal.throwIfAborted();
    if (this.scope && Date.now() - this.started >= this.scope.maxMilliseconds) {
      throw new Error("已達本次時間範圍。");
    }
  }
  private async invoke(tool: string, args: Record<string, unknown>) {
    this.check();
    if (this.scope && this.commands >= this.scope.maxCommands) {
      throw new Error("已達本次查詢／指令範圍。");
    }
    this.commands++;
    const outcome = await this.ctx.executeTool(tool, args, {
      signal: this.signal,
    });
    const result = outcome.result;
    const metadata = result.details as
      | { bearsOriginal?: { text?: string; sourceId?: string } }
      | undefined;
    const sourceId = metadata?.bearsOriginal?.sourceId;
    if (sourceId) {
      const originalSources = (this.result.data.originalSources ?? []) as {
        tool: string;
        originalSourceId: string;
      }[];
      originalSources.push({ tool, originalSourceId: sourceId });
      this.result.data.originalSources = originalSources;
    }
    if (outcome.isError) {
      throw new Error(
        result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      );
    }
    if (!metadata?.bearsOriginal?.text) {
      throw new Error("子工具缺少未精簡原文，禁止依摘要確認操作。");
    }
    // 流程只消費 metadata 的完整原文；有界 structuredContent 可能是預覽。
    const raw = decodeBearsResult(metadata.bearsOriginal.text);
    if (
      !Check(BEARS_RESULT_SCHEMA, raw) ||
      !raw.complete ||
      raw.code === "INVALID_RESULT"
    ) {
      throw new Error("子工具未提供原始訊息。");
    }
    this.check();
    return raw.messages;
  }
  history() {
    return this.invoke("bears_history", { limit: 30 });
  }
  async guard(sources: Source[]) {
    const messages = await this.history();
    this.assertWindow(messages, sources);
    this.boundSources = structuredClone(sources);
  }
  private assertWindow(messages: GameMessage[], sources: Source[]) {
    this.store.assertBoundSources(sources);
    for (const source of sources) {
      const current = messages.find(
        (message) => message.id === source.messageId && !message.outgoing,
      );
      if (!current || current.revision !== source.revision) {
        throw new Error(
          "message ID／revision 已改變或未完整取得，未送出操作。",
        );
      }
    }
    const status = this.store.status();
    if (
      !status ||
      (this.scope && status.value.name !== this.scope.character) ||
      status.value.hp === 0 ||
      status.value.gold === null ||
      status.value.estimated ||
      status.value.idle
    ) {
      throw new Error("角色狀態／金幣證據失效、死亡或仍在掛機。");
    }
    this.check();
  }
  async step<T>(
    tool: string,
    args: Record<string, unknown>,
    parse: (message: GameMessage) => T | undefined,
    change = false,
    beforeDispatch?: () => void,
  ): Promise<T> {
    this.check();
    if (this.scope && this.commands >= this.scope.maxCommands) {
      throw new Error("已達本次查詢／指令範圍，未呼叫子工具。");
    }
    if (change) {
      if (!this.scope) {
        throw new Error("缺少本次執行範圍。");
      }
      if (this.changes >= this.scope.maxChanges) {
        throw new Error("已達本次狀態變更範圍。");
      }
      this.changes++;
    }
    const prior = new Map(
      this.store
        .all()
        .map((record) => [record.message.id, record.message.revision]),
    );
    const startedAt = Math.floor(Date.now() / 1000);
    const step = {
      tool,
      state: "submitted" as
        | "submitted"
        | "not_dispatched"
        | "confirmed"
        | "rejected"
        | "outcome_unknown",
    };
    this.result.steps.push(step);
    const find = (messages: GameMessage[]) => {
      for (const message of [...messages].sort((a, b) => b.id - a.id)) {
        if (
          message.outgoing ||
          message.date < startedAt ||
          prior.get(message.id) === message.revision
        ) {
          continue;
        }
        if (change && /無法|失敗|不足|被拒絕/u.test(message.text)) {
          throw new RejectedAction(`遊戲拒絕 ${tool}：${message.text}`);
        }
        const value = parse(message);
        if (value !== undefined) {
          const source = this.store
            .all()
            .find(
              (record) =>
                record.message.id === message.id &&
                record.message.revision === message.revision,
            )?.source;
          if (source) {
            this.result.sources.push(structuredClone(source));
          }
          return value;
        }
      }
    };
    let failure: unknown;
    try {
      const entry = change
        ? STRUCTURED_COMMANDS.find((entry) => `bears_${entry.command}` === tool)
        : undefined;
      const expected = entry ? serializeCommand(entry, args) : null;
      const messages = change
        ? await withDispatchCheck(
            (window, action) => {
              if (
                !expected ||
                !("text" in action) ||
                action.text !== expected
              ) {
                throw new Error("實際指令與已核對步驟不同。");
              }
              this.store.observe(window);
              this.assertWindow(window, this.boundSources);
              beforeDispatch?.();
            },
            () => this.invoke(tool, args),
          )
        : await this.invoke(tool, args);
      const value = find(messages);
      if (value !== undefined) {
        step.state = "confirmed";
        return value;
      }
    } catch (error) {
      failure = error;
      if (error instanceof RejectedAction) {
        step.state = "rejected";
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (
        this.signal.aborted ||
        /rate limit|not dispatched|已達|blocked|not approved|缺少未精簡原文/u.test(
          detail,
        )
      ) {
        step.state =
          change && !/not dispatched|blocked|not approved|已達/u.test(detail)
            ? "outcome_unknown"
            : "not_dispatched";
        throw error;
      }
    }
    // 只補讀兩次，不等待、不重送、不以 unrelated 更新證明成功。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const messages = await this.history();
        const value = find(messages);
        if (value !== undefined) {
          step.state = "confirmed";
          return value;
        }
      } catch (error) {
        failure = error;
        break;
      }
    }
    if (failure instanceof RejectedAction) {
      step.state = "rejected";
      throw failure;
    }
    step.state = "outcome_unknown";
    throw new Error(
      `結果不明，未重送 ${tool}。${failure instanceof Error ? failure.message : ""}`,
    );
  }
  /** 固定唯讀通道按缺漏準備；操作前後必要的新核驗必須指定 refresh。 */
  async prepareObservation<K extends ObservationChannel>(
    channel: K,
    refresh = false,
  ): Promise<ObservationValue<K>> {
    this.check();
    const status = this.store.status();
    const actor = this.result.actor;
    const generation = this.store.generation;
    if (!status || !actor || status.value.name !== actor) {
      throw new Error("準備資料前角色或來源未確認。");
    }
    const parser = observationParsers[channel] as (
      message: GameMessage,
    ) => ObservationValue<K> | undefined;
    let view = this.store.latest(parser);
    if (refresh || !view) {
      if (status.value.idle) {
        throw new Error("掛機中必要查詢副作用未確認，不自動停掛或補查。");
      }
      await this.step(observationTools[channel], {}, parser);
      view = this.store.latest(parser);
      const observed = this.result.sources.at(-1);
      if (
        !view ||
        observed?.messageId !== view.source.messageId ||
        observed.revision !== view.source.revision
      ) {
        throw new Error("補查後來源已出現更新或無法綁定。");
      }
    }
    if (
      !view ||
      generation !== this.store.generation ||
      this.store.status()?.value.name !== actor
    ) {
      throw new Error("準備資料中角色或來源已改變。");
    }
    this.store.assertBoundSources([status.source, view.source]);
    if (
      !this.result.sources.some(
        (source) =>
          source.messageId === view.source.messageId &&
          source.revision === view.source.revision,
      )
    ) {
      this.result.sources.push(structuredClone(view.source));
    }
    return view.value;
  }

  /** 只補查缺少／失效的全背包；付款或換裝刷新可要求新觀測。 */
  async prepareInventory(force = false) {
    this.check();
    const actor = this.result.actor;
    const generation = this.store.generation;
    const status = this.store.status();
    if (!actor || status?.value.name !== actor) {
      throw new Error("準備資料前角色未確認。");
    }
    let view = this.store.inventory();
    if (force || !view?.value.complete) {
      if (status.value.idle) {
        throw new Error("掛機中全背包查詢副作用未確認，不自動停掛。");
      }
      await this.step("bears_inventory", { all: true }, (message) => {
        const current = this.store.inventory();
        return current?.value.complete &&
          current.sources.some((source) => source.messageId === message.id)
          ? true
          : undefined;
      });
      view = this.store.inventory();
    }
    if (
      !view?.value.complete ||
      generation !== this.store.generation ||
      this.store.status()?.value.name !== actor
    ) {
      throw new Error("準備資料中角色、完整性或相依狀態已改變。");
    }
    this.store.assertBoundSources(view.sources);
    for (const source of view.sources) {
      if (
        !this.result.sources.some(
          (bound) =>
            bound.messageId === source.messageId &&
            bound.revision === source.revision,
        )
      ) {
        this.result.sources.push(structuredClone(source));
      }
    }
    return view.value;
  }

  async status() {
    const status = await this.step("bears_status", {}, statusFacts);
    this.result.actor = status.name;
    this.result.data.lastStatus = status;
    const current = this.store.status();
    if (!current || JSON.stringify(current.value) !== JSON.stringify(status)) {
      throw new Error("本人狀態之後有未核對活動或來源不符。");
    }
    if (this.scope && status.name !== this.scope.character) {
      throw new Error("角色已改變。");
    }
    if (this.scope && (status.hp === 0 || status.idle)) {
      throw new Error("角色死亡或仍在掛機。");
    }
    return status;
  }
}

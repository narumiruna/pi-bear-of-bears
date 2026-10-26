import { randomUUID } from "node:crypto";
import type { GameMessage } from "./game.js";
import { ledgerCommand } from "./ledger-privacy.js";
import { projectLedger } from "./ledger-projection.js";
import type { LedgerStore } from "./ledger-store.js";
import type {
  LedgerAccounting,
  LedgerCall,
  LedgerContext,
  LedgerReference,
  LedgerSink,
  LedgerTicket,
} from "./ledger-types.js";

export interface LedgerHost {
  session: () => string;
  references: () => LedgerReference[];
  publish: (reference: LedgerReference) => void;
}
export class LedgerRuntime implements LedgerSink {
  readonly runtime = randomUUID();
  private readonly calls = new Map<string, string[]>();
  private closed = false;
  private epoch = 0;
  private failure: string | null = null;
  constructor(
    readonly store: LedgerStore,
    private readonly host: LedgerHost,
  ) {}
  private context(call?: LedgerCall): LedgerContext {
    const context = {
      id: randomUUID(),
      session: this.host.session(),
      runtime: this.runtime,
      toolCallId: call?.toolCallId ?? null,
      toolName: call?.toolName ?? null,
      at: Date.now(),
    };
    this.store.context(context);
    return context;
  }
  private publish(contextId: string, through: number) {
    this.host.publish({ contextId, through });
  }
  private fault() {
    this.failure =
      "帳本落盤或分支引用失敗；已送出操作不能推為失敗，請查 history，不重送。停用前保留故障副本。";
  }
  diagnostics() {
    return this.failure ? [this.failure] : [];
  }
  begin(
    kind: "command" | "history",
    command: string | null,
    call?: LedgerCall,
  ): LedgerTicket {
    if (this.closed || this.failure) {
      if (kind === "command") {
        throw new Error(
          "帳本不可寫，操作未派送；仍可查 bears_history。修復或明確停用 ledger 後再操作。",
        );
      }
      return this.unavailableTicket();
    }
    let context: LedgerContext, id: string;
    try {
      context = this.context(call);
      id = randomUUID();
      const through = this.store.transaction(() => {
        this.store.operation({
          id,
          contextId: context.id,
          command: ledgerCommand(command),
          kind,
          at: Date.now(),
        });
        return this.store.event(context.id, id, "state", { state: "prepared" });
      });
      this.publish(context.id, through);
      if (call) {
        this.calls.set(call.toolCallId, [
          ...(this.calls.get(call.toolCallId) ?? []),
          id,
        ]);
      }
    } catch {
      this.fault();
      if (kind === "command") {
        throw new Error(
          "帳本送出前寫入失敗，操作未派送；仍可查 bears_history。",
        );
      }
      return this.unavailableTicket();
    }
    const epoch = this.epoch;
    const publish = (through: number) => {
      if (!this.closed && epoch === this.epoch) {
        this.publish(context.id, through);
      }
    };
    let beforeIds = new Set<number>();
    let beforeMax = 0,
      finished = false,
      damaged = false;
    return {
      observe: (messages, phase) => {
        if (finished) {
          return;
        }
        try {
          if (phase === "before") {
            beforeMax = Math.max(0, ...messages.map((m) => m.id));
            beforeIds = new Set(messages.map((m) => m.id));
          }
          let through = this.store.observe(context.id, id, messages, phase);
          if (
            phase === "after" &&
            messages.length >= 10 &&
            beforeIds.size > 0 &&
            !messages.some((m) => beforeIds.has(m.id))
          ) {
            through = this.store.event(context.id, id, "gap", {
              reason: "after_page_without_overlap",
            });
          }
          if (through > 0) {
            publish(through);
          }
        } catch {
          damaged = true;
          this.fault();
          if (phase === "before" && kind === "command") {
            throw new Error("帳本送出前觀測寫入失敗，操作未派送。");
          }
        }
      },
      dispatch: (actualCommand) => {
        if (damaged || this.closed || this.failure || epoch !== this.epoch) {
          throw new Error("帳本不可寫，操作未派送。");
        }
        try {
          const through = this.store.event(context.id, id, "state", {
            state: "submitted",
            command: ledgerCommand(actualCommand ?? command),
            beforeMax,
          });
          publish(through);
        } catch {
          damaged = true;
          this.fault();
          throw new Error("帳本送出意圖寫入失敗，操作未派送。");
        }
      },
      finish: (sent, failed = false) => {
        if (finished) {
          return this.accounting(id);
        }
        finished = true;
        try {
          const state =
            kind === "history"
              ? failed
                ? "unresolved"
                : "confirmed"
              : sent
                ? "unresolved"
                : "not_dispatched";
          const through = this.store.event(context.id, id, "state", {
            state,
            failed,
            damaged,
          });
          publish(through);
        } catch {
          this.fault();
        }
        return this.accounting(id);
      },
    };
  }
  private unavailableTicket(): LedgerTicket {
    return {
      observe: () => {},
      dispatch: () => {
        throw new Error("帳本不可寫，操作未派送。");
      },
      finish: () => ({
        operationId: "unrecorded",
        state: "unresolved",
        confirmedMpCost: null,
        operationalEligibility: false,
        mpAfter: null,
        hpAfter: null,
        complete: false,
        reasons: this.diagnostics(),
      }),
    };
  }
  private accounting(id: string): LedgerAccounting {
    try {
      const projection = projectLedger(this.read());
      const operation = projection.operations.find((o) => o.id === id);
      return {
        operationId: id,
        state: operation?.state ?? "unresolved",
        confirmedMpCost: operation?.confirmedMpCost ?? null,
        operationalEligibility: false,
        mpAfter: this.failure ? null : (operation?.mpAfter ?? null),
        hpAfter: this.failure ? null : (operation?.hpAfter ?? null),
        complete:
          !this.failure &&
          operation?.state === "confirmed" &&
          operation.mpAfter !== null &&
          operation.mpAfter !== undefined,
        reasons: [
          ...this.diagnostics(),
          ...(operation?.reasons ?? []),
          ...(!operation ||
          operation.mpAfter === null ||
          operation.mpAfter === undefined
            ? ["餘額或操作歸屬未知，不由成本補猜。"]
            : []),
        ],
      };
    } catch {
      this.fault();
      return {
        operationId: id,
        state: "unresolved",
        confirmedMpCost: null,
        operationalEligibility: false,
        mpAfter: null,
        hpAfter: null,
        complete: false,
        reasons: this.diagnostics(),
      };
    }
  }
  watch(messages: readonly GameMessage[], omitted: number) {
    if (
      this.closed ||
      this.failure ||
      (messages.length === 0 && omitted === 0)
    ) {
      return;
    }
    try {
      const context = this.context();
      let through = this.store.observe(context.id, null, messages, "watch");
      if (omitted > 0) {
        through = this.store.event(context.id, null, "gap", {
          reason: "watch_omitted",
          omitted,
        });
      }
      this.publish(context.id, through);
    } catch {
      this.fault();
    }
  }
  original(messages: readonly GameMessage[], sourceId: string) {
    if (this.closed || this.failure) {
      return;
    }
    try {
      this.store.original(messages, sourceId);
    } catch {
      this.fault();
    }
  }
  operationIds(toolCallId: string) {
    return this.calls.get(toolCallId) ?? [];
  }
  read() {
    const data = this.store.read(this.host.references());
    data.diagnostics.push(...this.diagnostics());
    return data;
  }
  metric(record: {
    toolCallId: string;
    toolName: string;
    parentToolCallId?: string;
    startedAt: number;
    durationMs: number;
    isError: boolean;
  }) {
    if (this.closed || this.failure) {
      return;
    }
    try {
      const context = this.context({
        toolCallId: record.toolCallId,
        toolName: record.toolName,
      });
      const through = this.store.event(context.id, null, "metric", {
        ...record,
        operationIds: this.operationIds(record.toolCallId),
      });
      this.publish(context.id, through);
    } catch {
      this.fault();
    }
  }
  usage(usage: {
    input: number;
    output: number;
    totalTokens: number;
    cost: { total: number };
  }) {
    if (this.closed || this.failure) {
      return;
    }
    if (
      ![usage.input, usage.output, usage.totalTokens].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      !Number.isFinite(usage.cost.total) ||
      usage.cost.total < 0
    ) {
      return;
    }
    try {
      const context = this.context();
      this.publish(
        context.id,
        this.store.event(context.id, null, "usage", usage),
      );
    } catch {
      this.fault();
    }
  }
  reset() {
    this.epoch++;
    this.calls.clear();
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.calls.clear();
      this.store.close();
    }
  }
}

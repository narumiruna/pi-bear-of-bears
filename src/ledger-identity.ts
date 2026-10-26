import { isAbsolute, join } from "node:path";
import type { GameMessage } from "./game.js";
import { type LedgerHost, LedgerRuntime } from "./ledger-runtime.js";
import { LedgerStore } from "./ledger-store.js";
import type {
  LedgerAccounting,
  LedgerCall,
  LedgerSink,
  LedgerTicket,
} from "./ledger-types.js";
import { telegramLedgerAccount, telegramUserId } from "./telegram-user-id.js";

/** 不開啟連線；只接受既有 transport 驗證的本人 ID，再同步開庫及落盤。 */
export class LedgerIdentity implements LedgerSink {
  private active?: LedgerRuntime;
  private account?: string;
  private blocked?: string;
  private closed = false;
  private epoch = 0;
  private readonly acceptedCalls = new Set<string>();
  constructor(
    private readonly directory: string,
    private readonly host: (account: string) => LedgerHost,
    private readonly changed: () => void = () => {},
  ) {
    if (!isAbsolute(directory)) {
      throw new Error("BEARS_LEDGER_DIR 必須是絕對路徑。");
    }
  }
  get requiresIdentity() {
    return !this.closed && !this.blocked && !this.active?.diagnostics().length;
  }
  get runtime() {
    return this.closed || this.blocked ? undefined : this.active;
  }
  diagnostics() {
    if (this.blocked) {
      return [this.blocked];
    }
    return this.active
      ? []
      : [
          "帳本已啟用，等待既有 Telegram 連線確認本人 ID；不主動登入或查詢遊戲。",
        ];
  }
  private block(reason: string) {
    this.blocked = reason;
    this.epoch++;
    this.acceptedCalls.clear();
    this.active?.reset();
    this.changed();
  }
  private resolve(id: unknown) {
    if (this.closed || this.blocked) {
      throw new Error(this.blocked ?? "帳本已關閉。");
    }
    const userId = telegramUserId(id),
      account = telegramLedgerAccount(userId);
    if (this.account && this.account !== account) {
      this.block(
        "本 Pi 工作階段偵測到不同 Telegram 登入者；未寫入舊帳本，請重新載入以切換帳號。",
      );
      throw new Error(this.blocked);
    }
    if (!this.active) {
      let store: LedgerStore | undefined;
      try {
        const host = this.host(account);
        store = new LedgerStore(
          join(this.directory, `${userId}.sqlite`),
          account,
        );
        this.active = new LedgerRuntime(store, host);
        this.account = account;
        this.changed();
      } catch {
        store?.close();
        this.block(
          "帳本初始化失敗；請檢查私有路徑、權限及 SQLite schema。未刪庫或重送，history 仍可讀。",
        );
        throw new Error(this.blocked);
      }
    }
    return this.active;
  }
  private missing(kind: "command" | "history", sent = false): LedgerAccounting {
    return {
      operationId: "unrecorded",
      state: kind === "command" && !sent ? "not_dispatched" : "unresolved",
      confirmedMpCost: null,
      operationalEligibility: false,
      mpAfter: null,
      hpAfter: null,
      complete: false,
      reasons:
        this.diagnostics().length > 0
          ? this.diagnostics()
          : ["本次連線未確認本人 ID；未記帳，不猜餘額。"],
    };
  }
  begin(
    kind: "command" | "history",
    command: string | null,
    call?: LedgerCall,
  ): LedgerTicket {
    if (call) {
      this.acceptedCalls.delete(call.toolCallId);
    }
    if (this.active?.diagnostics().length && !this.blocked) {
      return this.active.begin(kind, command, call);
    }
    if (kind === "command" && (this.closed || this.blocked)) {
      throw new Error(
        "帳本不可寫或登入者已改變，操作未派送；仍可查 bears_history。",
      );
    }
    const epoch = this.epoch;
    let delegate: LedgerTicket | undefined,
      finished = false;
    return {
      identify: (id) => {
        try {
          if (finished || this.closed || epoch !== this.epoch) {
            throw new Error("帳本控制情境已改變，操作未派送。");
          }
          delegate = this.resolve(id).begin(kind, command, call);
          if (call) {
            this.acceptedCalls.add(call.toolCallId);
          }
        } catch (error) {
          if (kind === "command") {
            throw error;
          }
        }
      },
      observe: (messages, phase) => {
        if (!finished) {
          delegate?.observe(messages, phase);
        }
      },
      dispatch: (actual) => {
        if (
          finished ||
          this.closed ||
          this.blocked ||
          epoch !== this.epoch ||
          !delegate
        ) {
          throw new Error("未確認本人 ID 或帳本控制情境已改變，操作未派送。");
        }
        delegate.dispatch(actual);
      },
      finish: (sent, failed) => {
        finished = true;
        return delegate?.finish(sent, failed) ?? this.missing(kind, sent);
      },
    };
  }
  watch(messages: readonly GameMessage[], omitted: number, id?: string) {
    try {
      this.resolve(id).watch(messages, omitted);
    } catch {
      /* 未識別或衝突的來源不進任何帳本。 */
    }
  }
  original(
    messages: readonly GameMessage[],
    source: string,
    call?: LedgerCall,
    id?: string,
  ) {
    if (this.closed || this.blocked || !this.active) {
      return;
    }
    if (id !== undefined) {
      try {
        if (telegramLedgerAccount(id) !== this.account) {
          return;
        }
      } catch {
        return;
      }
    } else if (!call || !this.acceptedCalls.has(call.toolCallId)) {
      return;
    }
    this.active.original(messages, source);
  }
  operationIds(call: string) {
    return this.runtime?.operationIds(call) ?? [];
  }
  reset() {
    this.epoch++;
    this.acceptedCalls.clear();
    this.active?.reset();
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.epoch++;
      this.acceptedCalls.clear();
      this.active?.close();
    }
  }
}

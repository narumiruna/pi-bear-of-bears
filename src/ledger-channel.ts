import { AsyncLocalStorage } from "node:async_hooks";
import type { GameMessage } from "./game.js";
import type { LedgerCall, LedgerSink } from "./ledger-types.js";

interface Channel {
  calls: AsyncLocalStorage<LedgerCall>;
  sink?: LedgerSink;
  session?: () => string;
}
// Pi 的 jiti cache 按 extension 分開；跨 cache 共用接點，但 SDK session 不得串帳。
const key = Symbol.for("pi-bear-of-bears.ledger.v1");
const registry = globalThis as unknown as Record<symbol, Channel | undefined>;
const channel: Channel = registry[key] ?? {
  calls: new AsyncLocalStorage<LedgerCall>(),
};
registry[key] = channel;
export function installLedger(sink: LedgerSink, session?: () => string) {
  if (channel.sink) {
    throw new Error("記帳 extension 已啟用，拒絕重複安裝。");
  }
  channel.sink = sink;
  channel.session = session;
  return () => {
    if (channel.sink === sink) {
      channel.sink = undefined;
      channel.session = undefined;
    }
  };
}
const belongs = (session = channel.calls.getStore()?.sessionId) =>
  !session || !channel.session || channel.session() === session;
export function ledgerBegin(
  kind: "command" | "history",
  command: string | null,
) {
  if (!belongs()) {
    if (kind === "command") {
      throw new Error(
        "帳本屬於另一個 Pi 工作階段，操作未派送；不可跨 session 串帳。",
      );
    }
    return;
  }
  return channel.sink?.begin(kind, command, channel.calls.getStore());
}
export const ledgerNeedsIdentity = () =>
  belongs() && channel.sink?.requiresIdentity === true;
export const withLedgerCall = <T>(call: LedgerCall, work: () => T) =>
  channel.calls.run(call, work);
export const ledgerWatch = (
  messages: readonly GameMessage[],
  omitted = 0,
  session?: string,
  telegramUserId?: string,
) => {
  if (belongs(session)) {
    channel.sink?.watch(messages, omitted, telegramUserId);
  }
};
export const ledgerOriginal = (
  messages: readonly GameMessage[],
  source: string,
  session?: string,
  telegramUserId?: string,
) => {
  if (belongs(session)) {
    channel.sink?.original(
      messages,
      source,
      channel.calls.getStore(),
      telegramUserId,
    );
  }
};
export const ledgerOperationIds = (toolCallId: string, session?: string) =>
  belongs(session) ? (channel.sink?.operationIds(toolCallId) ?? []) : [];

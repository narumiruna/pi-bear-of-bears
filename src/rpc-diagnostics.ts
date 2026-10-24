import { AsyncLocalStorage } from "node:async_hooks";
import type { TelegramClient } from "teleproto";
import { STRUCTURED_TOOL_NAMES } from "./game-command-catalog.js";

export type RpcPhase =
  | "connect"
  | "history"
  | "before_history"
  | "button_validation"
  | "dispatch"
  | "after_history"
  | "close"
  | "unspecified";
export interface RpcRecord {
  step: number;
  tool: string;
  phase: RpcPhase;
  purpose: "query" | "guard" | "command" | "delayed";
  method: string;
  durationMs: number;
  outcome: "pending" | "returned" | "rate_limited" | "failed";
}
export interface RpcDiagnostics {
  version: 1;
  rpcCalls: number;
  toolCalls: number;
  omitted: number;
  records: RpcRecord[];
}
interface Context {
  report: RpcDiagnostics;
  step: number;
  tool: string;
  phase: RpcPhase;
  purpose: RpcRecord["purpose"];
  lifecycle: { closed: boolean; rateLimited: boolean };
}
// 不同 extension 的 jiti cache 必須共用同一個 async context；不保存遊戲觀測。
const key = Symbol.for("pi-bear-of-bears.rpc-diagnostics.v1");
const registry = globalThis as unknown as Record<
  symbol,
  AsyncLocalStorage<Context> | undefined
>;
const context = registry[key] ?? new AsyncLocalStorage<Context>();
registry[key] = context;
const tools = new Set([...STRUCTURED_TOOL_NAMES, "bears_history"]);
const methods = new Set([
  "updates.GetState",
  "help.GetConfig",
  "users.GetUsers",
  "contacts.ResolveUsername",
  "messages.GetHistory",
  "messages.GetMessages",
  "messages.SendMessage",
  "messages.GetBotCallbackAnswer",
  "updates.GetDifference",
  "Ping",
  "PingDelayDisconnect",
  "InvokeWithLayer",
  "InitConnection",
]);

export function newRpcDiagnostics(): RpcDiagnostics {
  return { version: 1, rpcCalls: 0, toolCalls: 0, omitted: 0, records: [] };
}

/** 僅在本次呼叫範圍收集；巢狀範圍沿用，不重複計數或建立背景工作。 */
export async function withRpcDiagnostics<T>(
  report: RpcDiagnostics,
  work: () => Promise<T>,
): Promise<T> {
  const parent = context.getStore();
  if (parent && !parent.lifecycle.closed) {
    return work();
  }
  const current: Context = {
    report,
    step: 0,
    tool: "unclassified",
    phase: "unspecified",
    purpose: "query",
    lifecycle: { closed: false, rateLimited: false },
  };
  try {
    return await context.run(current, work);
  } finally {
    current.lifecycle.closed = true;
  }
}
export function hasRpcRateLimit() {
  return context.getStore()?.lifecycle.rateLimited ?? false;
}

export function withRpcPhase<T>(phase: RpcPhase, work: () => Promise<T>) {
  const current = context.getStore();
  return current ? context.run({ ...current, phase }, work) : work();
}
export function withRpcStep<T>(
  tool: string,
  work: () => Promise<T>,
  purpose: RpcRecord["purpose"] = "query",
) {
  const current = context.getStore();
  if (!current || current.lifecycle.closed) {
    return work();
  }
  const step = ++current.report.toolCalls;
  return context.run(
    {
      ...current,
      step,
      purpose,
      tool: tools.has(tool) ? tool : "unclassified",
    },
    work,
  );
}

function failureOutcome(error: unknown): RpcRecord["outcome"] {
  const seconds = (error as { seconds?: unknown } | null)?.seconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? "rate_limited"
    : "failed";
}

const installed = Symbol.for("pi-bear-of-bears.rpc-instrumented.v1");
/** 在 invoke 邊界計數，不將 getMessages／sendMessage 外層再算一次。
 * 計數為 library RPC 呼叫，不是封包、連線握手或 Telegram 內部重試次數。
 * 保留原始參數、this、結果及錯誤；不記錄引數或錯誤文字。
 */
export function instrumentRpc(client: TelegramClient) {
  const target = client as TelegramClient & { [installed]?: boolean };
  if (target[installed]) {
    return;
  }
  const original = client.invoke;
  client.invoke = function (this: TelegramClient, request, dcId, options) {
    const current = context.getStore();
    if (!current || current.lifecycle.closed) {
      return original.call(this, request, dcId, options);
    }
    const start = performance.now();
    const record: RpcRecord = {
      step: current.step,
      tool: current.tool,
      phase: current.phase,
      purpose: current.purpose,
      method: methods.has(request.className) ? request.className : "other_rpc",
      durationMs: 0,
      outcome: "pending",
    };
    current.report.rpcCalls++;
    if (current.report.records.length < 512) {
      current.report.records.push(record);
    } else {
      current.report.omitted++;
    }
    const finish = () => {
      record.durationMs = Math.max(0, performance.now() - start);
    };
    try {
      return original.call(this, request, dcId, options).then(
        (result) => {
          record.outcome = "returned";
          finish();
          return result;
        },
        (error: unknown) => {
          record.outcome = failureOutcome(error);
          if (record.outcome === "rate_limited") {
            current.lifecycle.rateLimited = true;
          }
          finish();
          throw error;
        },
      );
    } catch (error) {
      record.outcome = failureOutcome(error);
      if (record.outcome === "rate_limited") {
        current.lifecycle.rateLimited = true;
      }
      finish();
      throw error;
    }
  } as TelegramClient["invoke"];
  target[installed] = true;
}

import { resolve } from "node:path";
import process from "node:process";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { installLedger } from "../src/ledger-channel.js";
import { registerLedgerCommands } from "../src/ledger-commands.js";
import { LedgerIdentity } from "../src/ledger-identity.js";
import { registerLedgerTools } from "../src/ledger-tools.js";
import type { LedgerReference, LedgerSink } from "../src/ledger-types.js";

const REFERENCE = "bears-ledger-ref";
function unavailable(reason: string): LedgerSink {
  return {
    begin: (kind) => {
      if (kind === "command") {
        throw new Error(
          "帳本不可寫，操作未派送；仍可查 bears_history。請修復或明確停用 ledger。",
        );
      }
      return {
        observe: () => {},
        dispatch: () => {},
        finish: () => ({
          operationId: "unrecorded",
          state: "unresolved",
          confirmedMpCost: null,
          operationalEligibility: false,
          mpAfter: null,
          hpAfter: null,
          complete: false,
          reasons: [reason],
        }),
      };
    },
    watch: () => {},
    original: () => {},
    operationIds: () => [],
  };
}
export default function (pi: ExtensionAPI) {
  let context: ExtensionContext | undefined,
    identity: LedgerIdentity | undefined;
  let uninstall: (() => void) | undefined,
    startup: string[] = [];
  const current = () => identity?.runtime;
  const diagnostics = () => [...startup, ...(identity?.diagnostics() ?? [])];
  const enabled = () => identity !== undefined;
  const pending = new Map<
    string,
    {
      toolName: string;
      parentToolCallId?: string;
      startedAt: number;
      monotonic: number;
    }
  >();
  const resetQueries = registerLedgerTools(pi, current, diagnostics, enabled);
  const resetExport = registerLedgerCommands(pi, current, diagnostics, enabled);
  const changed = () => {
    resetQueries();
    resetExport();
  };
  const references = (account: string): LedgerReference[] =>
    (context?.sessionManager.getBranch() ?? []).flatMap((entry) => {
      if (entry.type !== "custom" || entry.customType !== REFERENCE) {
        return [];
      }
      const data = entry.data as {
        account?: unknown;
        version?: unknown;
        contextId?: unknown;
        through?: unknown;
      } | null;
      return data?.version === 1 &&
        data.account === account &&
        typeof data.contextId === "string" &&
        /^[a-f0-9-]{36}$/u.test(data.contextId) &&
        typeof data.through === "number" &&
        Number.isSafeInteger(data.through) &&
        data.through > 0
        ? [{ contextId: data.contextId, through: data.through }]
        : [];
    });
  function stop() {
    uninstall?.();
    uninstall = undefined;
    identity?.close();
    identity = undefined;
    pending.clear();
    changed();
  }
  pi.on("session_start", (_event, ctx) => {
    stop();
    context = ctx;
    startup = [];
    if (process.env.BEARS_LEDGER === "0") {
      startup = ["BEARS_LEDGER=0，帳本未啟用。"];
      return;
    }
    try {
      identity = new LedgerIdentity(
        process.env.BEARS_LEDGER_DIR ??
          resolve(getAgentDir(), "bear-of-bears", "ledger"),
        (account) => ({
          session: () => context?.sessionManager.getSessionId() ?? "unknown",
          references: () => references(account),
          publish: (ref) =>
            pi.appendEntry(REFERENCE, { version: 1, account, ...ref }),
        }),
        changed,
      );
      try {
        uninstall = installLedger(
          identity,
          () => context?.sessionManager.getSessionId() ?? "unknown",
        );
      } catch (error) {
        identity.close();
        identity = undefined;
        throw error;
      }
    } catch {
      startup = [
        "帳本初始化失敗；檢查 Node／BEARS_LEDGER_DIR、權限及 SQLite schema。未刪庫或重送。",
      ];
      try {
        uninstall = installLedger(
          unavailable(startup[0]),
          () => context?.sessionManager.getSessionId() ?? "unknown",
        );
      } catch {
        startup.push("同程序已有帳本擁有者；拒絕重複安裝。");
      }
      if (ctx.hasUI) {
        ctx.ui.notify(startup.join("\n"), "warning");
      }
    }
  });
  pi.on("session_tree", (_event, ctx) => {
    context = ctx;
    identity?.reset();
    pending.clear();
    changed();
  });
  pi.on("session_shutdown", () => {
    stop();
    context = undefined;
  });
  pi.on("tool_execution_start", (event) => {
    if (identity && !pending.has(event.toolCallId)) {
      pending.set(event.toolCallId, {
        toolName: event.toolName,
        parentToolCallId: event.parentToolCallId,
        startedAt: Date.now(),
        monotonic: performance.now(),
      });
    }
  });
  pi.on("tool_execution_end", (event) => {
    const call = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (call) {
      current()?.metric({
        toolCallId: event.toolCallId,
        toolName: call.toolName,
        ...(call.parentToolCallId
          ? { parentToolCallId: call.parentToolCallId }
          : {}),
        startedAt: call.startedAt,
        durationMs:
          event.durationMs ?? Math.round(performance.now() - call.monotonic),
        isError: event.isError,
      });
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      current()?.usage(event.message.usage);
    }
  });
}

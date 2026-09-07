import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  classifyOutcome,
  commandCategory,
  MANUAL_MARKS,
  METRIC_TOOLS,
  type MetricRecord,
  summarizeMetrics,
} from "../src/metrics.js";
import { MetricsStore, metricsDirectory } from "../src/metrics-store.js";

export default function (pi: ExtensionAPI) {
  let store: MetricsStore | undefined;
  let failed = false;
  const pending = new Map<string, { record: MetricRecord; started: number }>();
  function warn(ctx: ExtensionContext) {
    if (!failed && ctx.hasUI)
      ctx.ui.notify(
        "Bear of Bears 統計無法讀寫；本次統計已停止，遊戲工具不受影響。請檢查 BEARS_METRICS_DIR 與權限。",
        "warning",
      );
    failed = true;
  }
  function append(record: MetricRecord, ctx: ExtensionContext) {
    if (!store || failed) return;
    try {
      store.append(record);
    } catch {
      warn(ctx);
    }
  }
  pi.on("session_start", (_event, ctx) => {
    pending.clear();
    failed = false;
    store = undefined;
    if (process.env.BEARS_METRICS === "0") return;
    try {
      store = new MetricsStore(metricsDirectory());
    } catch {
      warn(ctx);
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    if (
      !store ||
      failed ||
      !METRIC_TOOLS.has(event.toolName) ||
      pending.has(event.toolCallId)
    )
      return;
    const input = event.args as { text?: unknown } | null;
    const record: MetricRecord = {
      version: 1,
      at: new Date().toISOString(),
      id: randomUUID(),
      phase: "start",
      tool: event.toolName,
      ...(event.toolName === "bears_send"
        ? { command: commandCategory(input?.text) }
        : {}),
    };
    pending.set(event.toolCallId, { record, started: performance.now() });
    append(record, ctx);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    const call = pending.get(event.toolCallId);
    if (!call) return;
    pending.delete(event.toolCallId);
    append(
      {
        ...call.record,
        phase: "end",
        at: new Date().toISOString(),
        durationMs: Math.round(performance.now() - call.started),
        outcome: classifyOutcome(event.result, event.isError),
      },
      ctx,
    );
  });
  pi.on("session_shutdown", () => {
    pending.clear();
    store = undefined;
  });
  pi.registerCommand("bears-metrics", {
    description:
      "查看本機操作統計： [天數，預設 30]；人工標記：mark 分類 [/指令]。不操作 Telegram。",
    handler: async (args, ctx) => {
      const reply = (content: string) =>
        pi.sendMessage(
          { customType: "bears-metrics", content, display: true },
          { triggerTurn: false },
        );
      if (!store || failed) {
        reply(
          "操作統計未啟用或讀寫失敗；檢查 BEARS_METRICS／BEARS_METRICS_DIR，修正後 /reload。",
        );
        return;
      }
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] === "mark") {
        const command =
          parts[2] === undefined ? undefined : commandCategory(parts[2]);
        if (
          parts.length < 2 ||
          parts.length > 3 ||
          !MANUAL_MARKS.has(parts[1]) ||
          (command !== undefined && !command.startsWith("/"))
        ) {
          reply(
            "用法：/bears-metrics mark capability_missed|wrong_command|wrong_arguments|unnecessary_operation [/已知指令]；不接受自由文字。",
          );
          return;
        }
        append(
          {
            version: 1,
            at: new Date().toISOString(),
            id: randomUUID(),
            phase: "manual",
            mark: parts[1],
            command,
          },
          ctx,
        );
        reply(
          failed
            ? "人工標記寫入失敗。"
            : "已記錄人工標記；不代表 extension 自動驗證了誤用。",
        );
        return;
      }
      const days = parts.length === 0 ? 30 : Number(parts[0]);
      if (
        parts.length > 1 ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 3650
      ) {
        reply(
          "用法：/bears-metrics [1–3650 天] 或 /bears-metrics mark 分類 [/指令]",
        );
        return;
      }
      try {
        const { records, skipped } = await store.read();
        reply(
          `${summarizeMetrics(records, days)}\n略過無效／不完整紀錄：${skipped}\n儲存位置：${store.directory}`,
        );
      } catch {
        reply(
          "統計讀取失敗；請檢查檔案權限或封存過大的舊紀錄。未輸出部分統計，也未修改遊戲狀態。",
        );
      }
    },
  });
}

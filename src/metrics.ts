// 僅允許固定分類進入統計，不保留指令引數、玩家文字或錯誤原文。
export const METRIC_TOOLS = new Set([
  "bears_history",
  "bears_send",
  "bears_click",
  "bears_world",
  "bears_codex",
  "bears_original",
  "bears_optimize_equipment",
]);
const commands = new Set(
  `help look who consider boss quest status skills bestiary gallery inventory inspect idlestatus go attack skill flee rest recall recall2 use equip autoequip lock idle stopidle mute shop buy sell sellall forge market pets adopt feed play pat home expand furn store start create chars switch advance chat finger top say`.split(
    " ",
  ),
);
const aliases: Record<string, string> = {
  看: "look",
  掂量: "consider",
  攻擊: "attack",
  逃跑: "flee",
  頭目: "boss",
  任務: "quest",
  狀態: "status",
  圖鑑: "bestiary",
  收藏: "gallery",
  背包: "inventory",
  一鍵裝備: "autoequip",
  休息: "rest",
  回城: "recall",
  中繼: "recall2",
  掛機: "idle",
  進度: "idlestatus",
  結算: "stopidle",
  靜音: "mute",
  清背包: "sellall",
  北: "go",
  南: "go",
  東: "go",
  西: "go",
};
export function commandCategory(text: unknown): string {
  if (typeof text !== "string" || !text.trim()) return "invalid_text";
  const token = text.trim().split(/\s+/, 1)[0];
  if (Object.hasOwn(aliases, token)) return `/${aliases[token]}`;
  const match = /^\/([a-z]+)(?:@BearOfBearsBot)?$/i.exec(token);
  if (!match) return "other_text";
  const name = match[1].toLowerCase();
  return commands.has(name) ? `/${name}` : "unknown_command";
}
export const MANUAL_MARKS = new Set([
  "capability_missed",
  "wrong_command",
  "wrong_arguments",
  "unnecessary_operation",
]);
export type Outcome =
  | "returned"
  | "updates_observed"
  | "no_update_yet"
  | "stale_button"
  | "unsupported_button"
  | "overlap_rejected"
  | "invalid_arguments"
  | "outcome_unknown"
  | "rate_limited"
  | "tool_error";
export function classifyOutcome(result: unknown, isError: boolean): Outcome {
  const value = result as {
    content?: { type: string; text?: string }[];
  } | null;
  const text = Array.isArray(value?.content)
    ? value.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
    : "";
  if (isError) {
    if (text.includes("Action may have reached the bot; outcome is unknown."))
      return "outcome_unknown";
    if (
      text.includes(
        "Message missing or changed. Read bears_history and choose again.",
      )
    )
      return "stale_button";
    if (text.includes("Only ordinary text and callback buttons are supported;"))
      return "unsupported_button";
    if (text.includes("A Telegram operation is already running."))
      return "overlap_rejected";
    if (text.includes("Telegram rate limit:")) return "rate_limited";
    if (
      /Validation failed for tool|limit must be 1–30\.|beforeId must be positive\.|Send 1–4096 characters of plain text\./.test(
        text,
      )
    )
      return "invalid_arguments";
    return "tool_error";
  }
  try {
    const data = JSON.parse(text);
    if (data?.observation === "no_update_yet") return "no_update_yet";
    if (data?.observation === "bot_updates_observed") return "updates_observed";
  } catch {
    /* 非 JSON 結果不推測遊戲是否成功。 */
  }
  return "returned";
}
export interface MetricRecord {
  version: 1;
  at: string;
  id: string;
  phase: "start" | "end" | "manual";
  tool?: string;
  command?: string;
  outcome?: Outcome;
  durationMs?: number;
  mark?: string;
}

export function summarizeMetrics(
  records: MetricRecord[],
  days: number,
  now = Date.now(),
) {
  const since = now - days * 86400000;
  const unique = new Map<string, MetricRecord>();
  for (const record of records) {
    const at = Date.parse(record.at);
    if (at >= since && at <= now)
      unique.set(`${record.id}:${record.phase}`, record);
  }
  const rows = new Map<
    string,
    {
      attempts: number;
      results: number;
      ms: number;
      outcomes: Map<string, number>;
    }
  >();
  const marks = new Map<string, number>();
  const increment = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);
  let first = now;
  let last = since;
  for (const record of unique.values()) {
    first = Math.min(first, Date.parse(record.at));
    last = Math.max(last, Date.parse(record.at));
    if (record.phase === "manual") {
      increment(marks, `${record.mark} ${record.command ?? ""}`.trim());
      continue;
    }
    const key = `${record.tool}${record.command ? ` ${record.command}` : ""}`;
    const row = rows.get(key) ?? {
      attempts: 0,
      results: 0,
      ms: 0,
      outcomes: new Map(),
    };
    if (record.phase === "start") row.attempts++;
    else {
      row.results++;
      row.ms += record.durationMs ?? 0;
      increment(row.outcomes, record.outcome ?? "tool_error");
    }
    rows.set(key, row);
  }
  const lines = [
    `Bear of Bears 操作統計（最近 ${days} 天，UTC）`,
    unique.size
      ? `觀測資料：${new Date(first).toISOString()} ～ ${new Date(last).toISOString()}`
      : "尚無紀錄。",
    "工具／指令 | 嘗試次數 | 結果數 | 平均耗時 ms | 結果分類",
  ];
  for (const [key, row] of [...rows].sort(
    (a, b) => b[1].attempts - a[1].attempts || a[0].localeCompare(b[0]),
  )) {
    lines.push(
      `${key} | ${row.attempts} | ${row.results} | ${row.results ? Math.round(row.ms / row.results) : "—"} | ${[...row.outcomes].map(([k, n]) => `${k}=${n}`).join(", ")}`,
    );
  }
  if (marks.size)
    lines.push(
      "人工標記（非自動判定）：",
      ...[...marks].map(([k, n]) => `${k}: ${n}`),
    );
  lines.push(
    "嘗試不代表已送達；returned／updates_observed 不代表遊戲成功。拒絕、限流、結果不明不直接等於 Agent 誤用。",
    "只統計載入後的 Agent 工具事件；不含 Telegram 手動操作、watch、面板內部讀取。跨查詢時間邊界或程序中止可能造成嘗試／結果數不一致。",
  );
  return lines.join("\n");
}

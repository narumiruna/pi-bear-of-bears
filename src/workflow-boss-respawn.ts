import type { GameMessage } from "./game.js";

const PREFIX = [
  "🕒 Boss 重生看板",
  "✅=存活可挑戰　⏳=重生中",
  "─────────────────",
];
// 僅支援已核的35項完整單頁；改版、分頁或缺項維持未知，不跨呼叫猜續頁。
const GROUPS = [
  ["🗡️ 一般 Boss（主世界＋星墜曆）", 20],
  ["🌀 裂界九王（侵蝕帶）", 9],
  ["🌠 世界王（星核裂隙）", 6],
] as const;
const FOOTER = "🗼 星塔星主：不重生（爬塔動態生成）";
const ENTRY =
  /^\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*([\p{L}\p{N}·]+) Lv([1-9]\d*)（重生 (?:[1-9]\d* 分|[1-9]\d*(?:\.\d+)? 小時)｜([\p{L}\p{N}·]+)）　(?:✅ 存活|⏳ 重生中 剩 (?:[1-9]\d* 秒|[1-9]\d* 分(?: [0-5]?\d 秒)?|[1-9]\d* 小時(?: [0-5]?\d 分)?))$/u;

/**
 * 只辨識同次 /boss_respawn 的完整唯讀文字，不產生怪血、現身、冷卻資格或安全證明。
 * 混入其他回覆（即使是已知格式）、按鈕或媒體時，整批維持未知事件護欄。
 */
export function nativeBossRespawnPages(
  messages: readonly GameMessage[],
  request?: string,
) {
  const rejected = new Set<number>();
  if (request !== "/boss_respawn") {
    return rejected;
  }
  const ordered = [...messages].sort((a, b) => a.id - b.id);
  let outgoing: GameMessage | undefined;
  if (ordered[0]?.outgoing && ordered[0].text === request) {
    outgoing = ordered.shift();
  }
  const reply = ordered[0];
  if (
    ordered.length !== 1 ||
    !reply ||
    reply.outgoing ||
    reply.hasMedia ||
    reply.buttons.length > 0 ||
    (outgoing &&
      (outgoing.hasMedia ||
        outgoing.buttons.length > 0 ||
        reply.id !== outgoing.id + 1 ||
        reply.date < outgoing.date))
  ) {
    return rejected;
  }
  const lines = reply.text.split("\n").filter((line) => line !== "");
  if (!PREFIX.every((line, index) => lines[index] === line)) {
    return rejected;
  }
  let index = PREFIX.length;
  const seen = new Set<string>();
  for (const [heading, count] of GROUPS) {
    if (lines[index++] !== heading) {
      return rejected;
    }
    for (let entry = 0; entry < count; entry++) {
      const match = ENTRY.exec(lines[index++] ?? "");
      if (!match) {
        return rejected;
      }
      const key = match.slice(1, 4).join("\0");
      if (seen.has(key)) {
        return rejected;
      }
      seen.add(key);
    }
  }
  if (lines[index++] !== FOOTER || index !== lines.length) {
    return rejected;
  }
  return new Set([reply.id]);
}

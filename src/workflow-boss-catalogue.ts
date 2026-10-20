import type { GameMessage } from "./game.js";

const HEADING = "👑 BOSS 圖鑑（擊殺有機率掉落稀有裝備）";
// 僅辨識已保存的原生說明；新效果或未知行仍須使觀測失效。
const EFFECTS = new Set([
  "　✨ 專屬〔蠻力衝撞〕：25% 機率以 1.6× 傷害衝撞",
  "　✨ 專屬〔孢子爆散〕：30% 機率額外噴發無視防禦的孢子傷害",
  "　✨ 專屬〔劇毒侵蝕〕：每次攻擊額外造成你最大 HP 3% 的毒傷（無視防禦）",
  "　✨ 專屬〔烈焰纏身〕：25% 機率灼燒，追加火焰傷害",
  "　✨ 專屬〔怒濤翻騰〕：25% 機率以 1.5× 傷害重擊",
  "　✨ 專屬〔熔岩狂暴〕：自身殘血（<40%）時傷害提升 1.4×",
  "　✨ 專屬〔王者狂暴〕：殘血（<40%）傷害 1.5×，並 30% 機率再重擊 1.5×",
  "　✨ 專屬〔深淵汲取〕：攻擊回復所造成傷害 50% 的 HP，20% 破防追傷",
  "　✨ 專屬〔時之壓制〕：20% 機率傷害翻倍；自身<50% 時追加你最大 HP 5% 真傷",
]);
const ENTRY =
  /^\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)* [\p{L}\p{N}·]+ Lv[1-9]\d*　📍[\p{L}\p{N}·]+$/u;
const STATS = /^　HP [1-9]\d*／ATK [1-9]\d*／DEF [1-9]\d*$/u;
const DROP =
  /^　\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)* [\p{L}\p{N}·]+ (?:(?:ATK|DEF|INT|AGI)\+[1-9]\d*)?　(?:\d+(?:\.\d+)?%|≈\d+(?:\.\d+)?%\/殺)(?:　🎁習得〔[\p{L}\p{N}·]+〕)?$/u;
const MYTH =
  /^　（🔴神話每殺最多掉一件：先擲 (?:2|1\.5|1\.2)% 閘門，再依權重擇一；上列為真實每殺機率）$/u;
const ESSENCE = "　💠 王之精魄 70%（進階素材，/forge 用）";

/**
 * 只豁免同一次 /boss 回覆中，自精確標題開始、ID 連續且逐行符合協定的文字頁。
 * 原生分頁可能停在條目中間；辨識唯讀前綴不表示圖鑑完整，更不是現身或機制證據。
 * 不保留跨呼叫 pending，避免以舊 request 信任 watch／history 的孤立事件。
 */
export function nativeBossCataloguePages(
  messages: readonly GameMessage[],
  request?: string,
) {
  const accepted = new Set<number>();
  if (request !== "/boss") {
    return accepted;
  }
  const ordered = [...messages].sort((a, b) => a.id - b.id);
  if (ordered[0]?.outgoing && ordered[0].text === "/boss") {
    ordered.shift();
  }
  if (ordered[0]?.text.split("\n")[0] !== HEADING) {
    return accepted;
  }
  let phase: "entry" | "stats" | "effectOrDrop" | "drop" | "drops" | "myth" =
    "entry";
  for (const [index, message] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (
      message.outgoing ||
      message.hasMedia ||
      message.buttons.length > 0 ||
      (previous &&
        (message.id !== previous.id + 1 || message.date < previous.date))
    ) {
      return new Set<number>();
    }
    const lines = message.text.split("\n");
    if (index === 0) {
      lines.shift();
    }
    if (!lines.some((line) => line.length > 0)) {
      return new Set<number>();
    }
    for (const line of lines) {
      if (line === "") {
        continue;
      }
      if (phase === "entry" && ENTRY.test(line)) {
        phase = "stats";
      } else if (phase === "stats" && STATS.test(line)) {
        phase = "effectOrDrop";
      } else if (phase === "effectOrDrop" && EFFECTS.has(line)) {
        phase = "drop";
      } else if (
        (phase === "effectOrDrop" || phase === "drop" || phase === "drops") &&
        DROP.test(line)
      ) {
        phase = "drops";
      } else if (phase === "drops" && MYTH.test(line)) {
        phase = "myth";
      } else if ((phase === "drops" || phase === "myth") && line === ESSENCE) {
        phase = "entry";
      } else {
        return new Set<number>();
      }
    }
    accepted.add(message.id);
  }
  // 單獨標題或只到怪物名稱仍不足以辨識；原生案例停在效果／掉落行。
  return phase === "stats" ? new Set<number>() : accepted;
}

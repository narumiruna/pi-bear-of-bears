import { plainGameText } from "./game-text.js";

// 已保存的 native status 與既有標籤式 replay；未知行不擴充為可略過格式。
const axis = String.raw`(?:ATK|DEF|INT|AGI)[：:]\s*[\d,]+(?:\s*(?:\([\d,]+\+[\d,]+\)|（基礎\s+[\d,]+＋裝備\s+[\d,]+）))?`;
const attributes = new RegExp(
  `^${axis}(?:\\s+${axis})*(?:\\s+🌀閃\\d+%\\s+⚡連\\d+%\\s+💥暴\\d+%)?$`,
  "u",
);
const lines = [
  /^[─━\-═]+$/u,
  /^HP[：:]\s*\d+\/\d+\s+MP[：:]\s*\d+\/\d+$/u,
  attributes,
  /^金幣[：:]\s*[\d,]+$/u,
  /^EXP[：:]\s*(?:\d+\/\d+(?:（本級）)?|滿級)(?:\s+含掛機預估)?$/u,
  /^(?:二轉)?Lv\d+\s+(?:[▰▱]+\s+)?(?:\d+%|滿級)$/u,
  /^位置[：:]\s*\S.*$/u,
  // 798299 的套裝摘要只保留描述，不解析成額外屬性或戰鬥保證。
  /^🎽 套裝加成：[^×（）\n、；]+×[1-4]件(?:、[^×（）\n、；]+×[1-4]件)*（[^（）\n]+）(?:；[^×（）\n、；]+×[1-4]件(?:、[^×（）\n、；]+×[1-4]件)*（[^（）\n]+）)*$/u,
  /^🔴 裝備特效：\S.*$/u,
  /^🏅 稱號：\S.*$/u,
  /^🎽 \/gear 看逐部位裝備。?$/u,
  /^🐾 掛機中（[^\n]+）— \/stopidle 結算$/u,
  // 既有合成 replay 的獨立提示行，不冒稱 native 欄位。
  /^含掛機預估$/u,
  /^🐾 掛機中$/u,
];

/** 呼叫者先以 statusFacts 核對標題、必要欄位與數值；此處只驗證整份行型。
 * 未知效果文字仍作原始描述，不由此宣稱效果、收益或完整機制已驗證。
 */
export function statusReplyComplete(text: string) {
  const body = plainGameText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const line of body.slice(1)) {
    if (!lines.some((pattern) => pattern.test(line))) {
      return false;
    }
    const labels = attributes.test(line)
      ? [...line.matchAll(/(?:^|\s)(ATK|DEF|INT|AGI)[：:]/gu)].map(
          (match) => match[1],
        )
      : [/^(HP|金幣|EXP|位置|🎽 套裝加成)[：:]/u.exec(line)?.[1]].filter(
          (label) => label !== undefined,
        );
    for (const label of labels) {
      if (seen.has(label)) {
        return false;
      }
      seen.add(label);
    }
  }
  return body.length > 1;
}

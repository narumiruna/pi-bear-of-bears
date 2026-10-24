import { cleanName, numberValue } from "./workflow-parser-values.js";

/** 只辨識已保存 fixture 的完整回報；未知尾行不得視為可略過公告。 */
export function idleReportFacts(text: string) {
  const replay =
    /^【([^\n]+)】\n🐾 (?:已)?掛機 [1-9]\d* (?:分鐘|小時)，金幣 \+([1-9]\d*)G$/u.exec(
      text,
    );
  if (replay) {
    const gold = numberValue(replay[2]);
    return gold === null
      ? null
      : {
          character: cleanName(replay[1]),
          gold,
          experience: null,
          settlementWindow: null,
          format: "replay" as const,
        };
  }
  // equipment-snapshot-replay.test.ts 已保存的原生三行小時回報／本人結算。
  const native =
    /^【([^\n]+)】\n🐾 (?:已)?掛機 [1-9]\d* (?:天|小時|分)(?:（本次結算 ([1-9]\d* (?:小時|分))）)?\nEXP \+([\d,]+)　🪙 \+([\d,]+)$/u.exec(
      text,
    );
  if (!native) {
    return null;
  }
  const experience = numberValue(native[3]),
    gold = numberValue(native[4]);
  if (experience === null || gold === null) {
    return null;
  }
  return {
    character: cleanName(native[1]),
    gold,
    experience,
    settlementWindow: native[2] ?? null,
    format: "native" as const,
  };
}

export function isOtherCharacterIdleReport(text: string, title?: string) {
  // 只採已觀測的角色標題分隔與具名掛機戰報；無法識別時維持失效保護。
  const separator = title?.indexOf("　") ?? -1;
  if (!title || separator < 0) {
    return false;
  }
  const report = idleReportCharacter(text);
  if (!report) {
    return false;
  }
  const withoutIcon = (value: string) =>
    value.replace(/^[^\p{Letter}\p{Number}]+/u, "").trim();
  const currentName = withoutIcon(title.slice(0, separator));
  return !!currentName && currentName !== withoutIcon(report);
}

export function idleReportCharacter(text: string): string | null {
  return idleReportFacts(text)?.character ?? null;
}

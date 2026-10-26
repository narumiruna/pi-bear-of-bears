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
    return detailedNativeIdleReport(text);
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

/** 819614–621：只接受完整的詳細小時通知；展示掉落不作物品入帳。 */
function detailedNativeIdleReport(text: string) {
  const lines = text.split("\n");
  if (lines.length !== 16) {
    return null;
  }
  const header = /^【([^【】\n]+)】$/u.exec(lines[0]);
  const timing =
    /^🐾 已掛機 (\d+) 天 (\d+) 小時（本次結算 (\d+) 小時 (\d+) 分）　共走過 (\d+) 個地點$/u.exec(
      lines[1],
    );
  const totals = /^　EXP \+([\d,]+)　🪙 \+([\d,]+)$/u.exec(lines[5]);
  const omitted = /^　✨ …另外撿到 (\d+) 件裝備$/u.exec(lines[14]);
  const level = /^　二轉Lv(\d+) ▰{10} 滿級$/u.exec(lines[15]);
  if (
    !header ||
    !timing ||
    !totals ||
    !omitted ||
    !level ||
    !/^　📍 現在位置：\S[^\n]*$/u.test(lines[2]) ||
    !/^　🧭 路線：\S[^\n]*$/u.test(lines[3])
  ) {
    return null;
  }
  const character = cleanName(header[1]);
  const [days, hours, settledHours, minutes, rooms] = timing
    .slice(1)
    .map(numberValue);
  if (
    !character ||
    days === null ||
    days < 1 ||
    hours === null ||
    hours > 23 ||
    settledHours === null ||
    minutes === null ||
    minutes > 59 ||
    (settledHours === 0 && minutes === 0) ||
    rooms === null ||
    rooms < 1
  ) {
    return null;
  }
  const positive = (raw: string | undefined) => {
    const value = numberValue(raw);
    return value !== null && value > 0;
  };
  if (
    !lines[4].startsWith("　") ||
    !lines[4]
      .slice(1)
      .split("　")
      .every((entry) => {
        const kill = /^\S[^\n×]* ×(\d+)$/u.exec(entry);
        return kill !== null && positive(kill[1]);
      })
  ) {
    return null;
  }
  if (
    !lines.slice(6, 14).every((line) => {
      const loot = /^　✨ 撿到 ([^\s×][^\n×]*?)(?: ×(\d+))?$/u.exec(line);
      return loot !== null && (loot[2] === undefined || positive(loot[2]));
    }) ||
    !positive(omitted[1]) ||
    !positive(level[1])
  ) {
    return null;
  }
  const experience = numberValue(totals[1]);
  const gold = numberValue(totals[2]);
  if (experience === null || gold === null) {
    return null;
  }
  return {
    character,
    gold,
    experience,
    settlementWindow: `${timing[3]} 小時 ${timing[4]} 分`,
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

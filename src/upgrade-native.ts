import type { EquipmentWeights } from "./equipment-optimizer.js";
import { cleanName, numberValue } from "./workflow-parsers.js";

/** 原生鍛造選單、免費預覽與成功回執各自解析，不將回執的稅率套回新預覽。 */
export function nativeForgeFacts(raw: string) {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const preview = lines[0] === "🔎 鍛造預覽（試算，不花材料）";
  const receipt = /^🔨✨ 進階成功！/u.test(lines[0] ?? "");
  const menuLines = lines.filter((line) => /^\d+\. .+ → .+（需 /u.test(line));
  if (!preview && !receipt && menuLines.length === 0) {
    return null;
  }
  const issues: string[] = [];
  const parse = (value: string | undefined) => {
    const number = numberValue(value);
    if (number === null) {
      issues.push("原生鍛造數值缺漏或無效。");
    }
    return number;
  };
  let transition: RegExpExecArray | null = null;
  let essence: number | null = null,
    baseGold: number | null = null,
    taxGold: number | null = null;
  const stats: Partial<EquipmentWeights> = {};
  const quotedBefore: Partial<EquipmentWeights> = {};
  let eligibilityRaw: string | null = null;
  if (preview) {
    transition = /^(.+?) → (.+)$/u.exec(lines[1] ?? "");
    const costs = lines.filter((line) => /^需 /u.test(line));
    const cost =
      /^需 💠×([\d,]+)（你有 ×([\d,]+)）＋ ([\d,]+)G（你有 ([\d,]+)G）$/u.exec(
        costs[0] ?? "",
      );
    if (costs.length !== 1 || !cost) {
      issues.push("原生預覽消耗欄位缺漏、重複或格式未知。");
    } else {
      essence = parse(cost[1]);
      baseGold = parse(cost[3]);
      parse(cost[2]);
      parse(cost[4]);
    }
    for (const line of lines.slice(2)) {
      const stat = /^(ATK|DEF|INT|AGI) ([\d,]+)→([\d,]+)（\+([\d,]+)）$/u.exec(
        line,
      );
      if (stat) {
        const key = (
          {
            ATK: "attack",
            DEF: "defense",
            INT: "intelligence",
            AGI: "agility",
          } as const
        )[stat[1] as "ATK" | "DEF" | "INT" | "AGI"];
        const before = parse(stat[2]),
          after = parse(stat[3]),
          delta = parse(stat[4]);
        if (
          stats[key] !== undefined ||
          before === null ||
          after === null ||
          delta === null ||
          after - before !== delta
        ) {
          issues.push("原生預覽屬性重複、差額矛盾或無效。");
        } else {
          quotedBefore[key] = before;
          stats[key] = after;
        }
      } else if (/^✅ 材料足夠，\/forge [1-9]\d* 即可進階$/u.test(line)) {
        eligibilityRaw = line;
      } else if (line !== costs[0]) {
        issues.push(`原生預覽有未識別行：${line}`);
      }
    }
  } else if (receipt) {
    transition = /^🔨✨ 進階成功！(.+?) → [^\p{L}\p{N}]*【(.+)】$/u.exec(
      lines[0],
    );
    const costs = lines.filter((line) => line.startsWith("（消耗"));
    const cost = /^（消耗 💠×([\d,]+) ＋ ([\d,]+)G＋鑄造稅 ([\d,]+)G）$/u.exec(
      costs[0] ?? "",
    );
    if (
      costs.length !== 1 ||
      !cost ||
      lines.length !== 3 ||
      !/^.+（BOSS 進階）$/u.test(lines[1])
    ) {
      issues.push("原生成功回執消耗、屬性或額外費用未完整識別。");
    } else {
      essence = parse(cost[1]);
      baseGold = parse(cost[2]);
      taxGold = parse(cost[3]);
    }
  } else {
    const row = /^\d+\. (.+?) → (.+?)（需 💠×([\d,]+) ＋ ([\d,]+)G）$/u.exec(
      menuLines[0] ?? "",
    );
    if (menuLines.length !== 1 || !row) {
      issues.push("原生鍛造選單消耗無法唯一識別。");
    } else {
      transition = row;
      essence = parse(row[3]);
      baseGold = parse(row[4]);
    }
  }
  const from = transition ? cleanName(transition[1]) : null,
    to = transition ? cleanName(transition[2]) : null;
  const stage =
    from && to && !/·(?:極|神)$/u.test(from) && to === `${from}·極`
      ? "base → ·極"
      : from?.endsWith("·極") && to === `${from.slice(0, -2)}·神`
        ? "·極 → ·神"
        : null;
  if (!stage) {
    issues.push("原生鍛造前後品項或階段矛盾。");
  }
  const total =
    receipt && baseGold !== null && taxGold !== null
      ? baseGold + taxGold
      : null;
  if (total !== null && !Number.isSafeInteger(total)) {
    issues.push("原生消耗總額超過安全整數範圍。");
  }
  return {
    kind: preview ? "preview" : receipt ? "receipt" : "menu",
    from,
    to,
    stage,
    baseGold: issues.length > 0 ? null : baseGold,
    taxGold: issues.length > 0 ? null : taxGold,
    essence: issues.length > 0 ? null : essence,
    receiptTotalGold: issues.length > 0 ? null : total,
    stats: issues.length > 0 || Object.keys(stats).length === 0 ? null : stats,
    quotedBefore,
    eligibilityRaw,
    automaticEquip: null,
    issues,
  };
}

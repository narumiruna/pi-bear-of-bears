import { nativeForgeFacts } from "./upgrade-native.js";
import type { Material } from "./upgrade-recipes.js";
import type { Source } from "./workflow-observations.js";
import { numberValue } from "./workflow-parsers.js";

export type UpgradeOperation = "forge" | "refine" | "craft";
/** 標籤式原文報價；未知 native 格式保留 raw，不推算未提供的稅規則。 */
export function upgradeQuote(
  raw: string,
  operation: UpgradeOperation,
  source: Source,
) {
  const native = operation === "forge" ? nativeForgeFacts(raw) : null;
  const issues: string[] = [...(native?.issues ?? [])];
  const field = (labels: string) => {
    const lines = raw
      .split("\n")
      .filter((line) =>
        new RegExp(`^(?:${labels})[：:]`, "u").test(line.trim()),
      );
    if (lines.length === 0) {
      return null;
    }
    const match = new RegExp(
      `^(?:${labels})[：:]\\s*([\\d,]+)\\s*G$`,
      "u",
    ).exec(lines[0].trim());
    const value = numberValue(match?.[1]);
    if (lines.length !== 1 || value === null) {
      issues.push(`費用欄位重複或未完整識別：${labels}`);
      return null;
    }
    return value;
  };
  const baseGold = field("金幣|報價") ?? native?.baseGold ?? null;
  const taxGold = field("稅費") ?? native?.taxGold ?? null;
  const reportedTotalGold = field("含稅總額|完整總額");
  const noOtherFees = raw
    .split("\n")
    .some((line) => line.trim() === "無其他費用");
  const sum =
    baseGold !== null &&
    taxGold !== null &&
    Number.isSafeInteger(baseGold + taxGold)
      ? baseGold + taxGold
      : null;
  if (baseGold !== null && taxGold !== null && sum === null) {
    issues.push("基價與稅費加總溢位。");
  }
  if (
    reportedTotalGold !== null &&
    ((baseGold !== null && reportedTotalGold < baseGold) ||
      (sum !== null && reportedTotalGold !== sum))
  ) {
    issues.push("總額與基價／稅費矛盾。");
  }
  if (
    /另收|未含|不含|額外費|外加|費用未知|稅率未知|待定|手續費[：:]/u.test(raw)
  ) {
    issues.push("仍有未核對的額外費用或限制。");
  }
  const derived = reportedTotalGold === null && noOtherFees && sum !== null;
  const totalGold =
    issues.length === 0 ? (reportedTotalGold ?? (derived ? sum : null)) : null;
  const automatic = raw
    .split("\n")
    .filter((line) => /^自動裝備[：:]/u.test(line));
  const automaticEquip =
    automatic.length === 1 && /^自動裝備[：:]\s*(?:是|否)$/u.test(automatic[0])
      ? /是$/u.test(automatic[0])
      : null;
  const tier = /^資產級距[：:]\s*([\d,]+)～([\d,]+)G$/mu.exec(raw);
  const lower = numberValue(tier?.[1]),
    upper = numberValue(tier?.[2]);
  const asset = /^本人資產[：:]\s*([\d,]+)G$/mu.exec(raw);
  return {
    operation,
    raw,
    ...(native ? { native } : {}),
    source: structuredClone(source),
    baseGold,
    taxGold,
    reportedTotalGold,
    totalGold,
    totalBasis:
      totalGold === null ? "unknown" : derived ? "derived" : "observed",
    complete: totalGold !== null,
    derivation: derived
      ? {
          operation,
          rule: "同份原文明列基價、稅費與無其他費用，僅加總金額；未外推百分比或級距稅率。",
          sources: [structuredClone(source)],
        }
      : null,
    automaticEquip,
    assets: numberValue(asset?.[1]),
    assetTier:
      lower !== null && upper !== null && lower < upper
        ? { lower, upper, boundaryConvention: "unknown" }
        : null,
    issues,
  };
}

interface PathStage {
  kind: string;
  target: string;
  stage: string | null;
  quote: ReturnType<typeof upgradeQuote>;
  materials: Material[];
}
/** 多階報價只是條件研究；前階成功後的狀態與稅費仍須重新取得。 */
export function upgradeQuotePaths(
  candidates: PathStage[],
  stock: Map<string, number>,
  cash: number | null,
) {
  const forge = candidates.filter((item) => item.kind === "forge");
  const paths = [];
  for (const first of forge.filter((item) => item.stage === "base → ·極")) {
    const seconds = forge.filter(
      (item) => item.target === first.target && item.stage === "·極 → ·神",
    );
    if (
      seconds.length !== 1 ||
      forge.filter(
        (item) => item.target === first.target && item.stage === first.stage,
      ).length !== 1
    ) {
      continue;
    }
    const stages = [first, seconds[0]];
    const needed = new Map<string, number>();
    const issues = [
      "前階成功後必須重新核對後階物品、資產、完整報價及自動裝備；舊報價不鎖價。",
    ];
    const projectedCash: (number | null)[] = [];
    let remainingCash = cash;
    for (const item of stages) {
      for (const material of item.materials) {
        const total = (needed.get(material.name) ?? 0) + material.quantity;
        if (
          !Number.isSafeInteger(total) ||
          !Number.isSafeInteger(material.quantity) ||
          material.quantity < 0
        ) {
          issues.push(`多階材料數量無效：${material.name}`);
        } else {
          needed.set(material.name, total);
        }
      }
      remainingCash =
        remainingCash === null || item.quote.totalGold === null
          ? null
          : remainingCash - item.quote.totalGold;
      projectedCash.push(remainingCash);
      if (remainingCash !== null && remainingCash < 0) {
        issues.push("逐階現金不足。");
      }
    }
    const total = stages.every((item) => item.quote.totalGold !== null)
      ? stages.reduce((sum, item) => sum + (item.quote.totalGold ?? 0), 0)
      : null;
    const tier = first.quote.assetTier,
      assets = first.quote.assets,
      cost = first.quote.totalGold;
    if (
      tier &&
      assets !== null &&
      cost !== null &&
      (assets - cost <= tier.lower || assets - cost >= tier.upper)
    ) {
      issues.push("前階支出會觸及或跨出已觀察資產級距；後階稅費不可沿用。");
    }
    paths.push({
      target: first.target,
      stages: stages.map((item) => ({ stage: item.stage, quote: item.quote })),
      materials: [...needed].map(([name, quantity]) => ({
        name,
        quantity,
        held: stock.get(name) ?? 0,
        missing: Math.max(0, quantity - (stock.get(name) ?? 0)),
      })),
      conditionalQuoteTotalGold:
        total !== null && Number.isSafeInteger(total) ? total : null,
      totalGold: null,
      projectedCash,
      projectionBasis: "derived",
      assumptions: [
        "僅扣已列金幣，不推定未知資產組成或後階資格；材料各階共用同一份存量。",
      ],
      revalidateAfterEveryStage: true,
      canPay: false,
      issues,
    });
  }
  return paths;
}

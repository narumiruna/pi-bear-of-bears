export interface EquipmentWeights {
  attack: number;
  defense: number;
  intelligence: number;
  agility: number;
}

export interface EquipmentCandidate {
  /** 遊戲編號，不是陣列索引。 */
  id: number;
  name: string;
  slot: string | null;
  stats: EquipmentWeights | null;
  equipped: boolean;
  eligible: boolean | null;
  /** null 表示效果資訊不足；空陣列表示已確認沒有額外效果。 */
  effects: string[] | null;
}

export const DEFAULT_WEIGHTS: Readonly<EquipmentWeights> = Object.freeze({
  attack: 1,
  defense: 1,
  intelligence: 1,
  agility: 1,
});
const keys = ["attack", "defense", "intelligence", "agility"] as const;

export function validateWeights(value: EquipmentWeights): EquipmentWeights {
  if (
    !value ||
    keys.some((key) => !Number.isFinite(value[key])) ||
    Object.keys(value).some(
      (key) => !keys.includes(key as (typeof keys)[number]),
    )
  )
    throw new Error("必須完整提供四項有限數值。");
  return { ...value };
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("裝備評分數值溢位。");
  return value;
}

export function equipmentScore(
  stats: EquipmentWeights,
  weights: EquipmentWeights,
): number {
  validateWeights(stats);
  validateWeights(weights);
  return keys.reduce(
    (total, key) => finite(total + finite(stats[key] * weights[key])),
    0,
  );
}

export interface EquipmentRecommendation {
  slot: string;
  currentId: number | null;
  targetId: number;
  currentScore: number;
  targetScore: number;
  delta: number;
}

/** 純計算；完整性及來源必須另由快照層驗證，不構成換裝授權。 */
export function optimizeEquipment(
  items: readonly EquipmentCandidate[],
  options: {
    weights?: EquipmentWeights;
    ignoreEffects?: boolean;
    /** 已確認的所有部位，沒有目前裝備的部位才可視為空槽。 */
    slots: readonly string[];
  },
) {
  const weights = validateWeights(options.weights ?? DEFAULT_WEIGHTS);
  const blockers: string[] = [];
  const recommendations: EquipmentRecommendation[] = [];
  const groups = new Map<string, EquipmentCandidate[]>();
  for (const slot of options.slots) {
    if (!slot || groups.has(slot)) throw new Error("部位清單不得空白或重複。");
    groups.set(slot, []);
  }
  if (!groups.size) throw new Error("缺少已確認的部位清單。");
  const ids = new Set<number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id))
      throw new Error("遊戲物品編號無效或重複。");
    ids.add(item.id);
    if (!item.name.trim()) blockers.push(`物品 ${item.id} 缺少名稱。`);
    const group = item.slot === null ? undefined : groups.get(item.slot);
    if (!group) blockers.push(`物品 ${item.id} 部位未知。`);
    else group.push(item);
    if (item.stats === null) blockers.push(`物品 ${item.id} 屬性未知。`);
    else equipmentScore(item.stats, weights);
    if (item.eligible === null || (item.equipped && !item.eligible))
      blockers.push(`物品 ${item.id} 穿戴資格未知或矛盾。`);
  }
  let currentScore = 0;
  let targetScore = 0;
  for (const [slot, group] of groups) {
    const worn = group.filter((item) => item.equipped);
    if (worn.length > 1) {
      blockers.push(`${slot} 有多件目前裝備。`);
      continue;
    }
    const current = worn[0];
    const base = current?.stats ? equipmentScore(current.stats, weights) : 0;
    currentScore = finite(currentScore + base);
    let best = current;
    let bestScore = base;
    for (const item of group) {
      if (!item.eligible || !item.stats) continue;
      const score = equipmentScore(item.stats, weights);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    targetScore = finite(targetScore + bestScore);
    if (!best || best === current) continue;
    const effects = best.effects;
    const oldEffects = current ? current.effects : [];
    if (effects === null || oldEffects === null) {
      blockers.push(`${slot} 技能／被動資訊未知。`);
      continue;
    }
    if (
      !options.ignoreEffects &&
      JSON.stringify([...effects].sort()) !==
        JSON.stringify([...oldEffects].sort())
    ) {
      blockers.push(`${slot} 有未授權忽略的額外效果取捨。`);
      continue;
    }
    if (
      group.some(
        (item) =>
          item !== best &&
          item.name === best.name &&
          item.stats !== null &&
          best.stats !== null &&
          keys.every((key) => item.stats?.[key] === best.stats?.[key]),
      )
    ) {
      blockers.push(`${slot} 目標有無法區分的同名同屬性物品。`);
      continue;
    }
    recommendations.push({
      slot,
      currentId: current?.id ?? null,
      targetId: best.id,
      currentScore: base,
      targetScore: bestScore,
      delta: finite(bestScore - base),
    });
  }
  return {
    weights,
    strategySource: options.weights ? "explicit" : "default",
    blockers,
    currentScore,
    predictedScore: targetScore,
    /** 任一證據缺漏時不提供可套用目標；預測分數不代表推薦。 */
    recommendations: blockers.length ? [] : recommendations.slice(0, 6),
    remainingRecommendations: blockers.length
      ? 0
      : Math.max(0, recommendations.length - 6),
  };
}

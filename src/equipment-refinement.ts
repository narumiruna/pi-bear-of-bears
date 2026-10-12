import type { EquipmentWeights } from "./equipment-optimizer.js";

export interface EquipmentRefinement {
  level: number;
  text: string;
  base: Partial<EquipmentWeights>;
  effective: Partial<EquipmentWeights>;
}

/** Parse only observed +1 to +5 base-to-effective attribute rows. */
export function parseEquipmentRefinement(
  level: number,
  text: string,
): EquipmentRefinement | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return;
  }
  const aliases = {
    ATK: "attack",
    DEF: "defense",
    INT: "intelligence",
    AGI: "agility",
  } as const;
  const base: Partial<EquipmentWeights> = {};
  const effective: Partial<EquipmentWeights> = {};
  const pattern = /(ATK|DEF|INT|AGI) (\d+)→(\d+)/gu;
  if (
    !/^(?:ATK|DEF|INT|AGI) \d+→\d+(?:\s+(?:ATK|DEF|INT|AGI) \d+→\d+)*$/u.test(
      text,
    )
  ) {
    return;
  }
  for (const match of text.matchAll(pattern)) {
    const key = aliases[match[1] as keyof typeof aliases];
    const from = Number(match[2]);
    const to = Number(match[3]);
    if (
      base[key] !== undefined ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      to < from
    ) {
      return;
    }
    base[key] = from;
    effective[key] = to;
  }
  if (Object.keys(base).length === 0) {
    return;
  }
  return { level, text, base, effective };
}

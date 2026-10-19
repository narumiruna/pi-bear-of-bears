import type { EquipmentWeights } from "./equipment-optimizer.js";
import {
  type InventoryEntry,
  parseInventoryEquipmentFacts,
  parseListedAttributes,
} from "./inventory.js";
import { nativeForgeFacts } from "./upgrade-native.js";

/** 數值收益與效果取捨分開，不把缺軸、未列技能或未知被動補成零。 */
export function upgradeComparison(
  item: InventoryEntry | undefined,
  raw: string,
) {
  const standard = item ? parseInventoryEquipmentFacts(item) : undefined;
  const before =
    standard?.stats ??
    item?.refinement?.effective ??
    (item
      ? parseListedAttributes(
          item.description.split(/\s+🔴|[，,]\s*習得|（/u)[0],
        )
      : null);
  const after =
    parseListedAttributes(/^進階後屬性[：:]\s*(.+)$/mu.exec(raw)?.[1] ?? "") ??
    nativeForgeFacts(raw)?.stats ??
    null;
  const values = (labels: string) =>
    raw.split("\n").flatMap((line) => {
      const match = new RegExp(`^(?:${labels})[：:]\\s*(.+)$`, "u").exec(line);
      return match ? [match[1]] : [];
    });
  const observedBeforeEffects = item
    ? [...item.description.matchAll(/(?:被動[：:]|習得〔)(.+)/gu)].map(
        (match) => match[1],
      )
    : [];
  return {
    before: before ?? null,
    after,
    axisDelta: Object.fromEntries(
      (["attack", "defense", "intelligence", "agility"] as const).map((key) => [
        key,
        before?.[key] !== undefined && after?.[key] !== undefined
          ? (after[key] as number) - (before[key] as number)
          : null,
      ]),
    ) as Record<keyof EquipmentWeights, number | null>,
    observedBeforeEffects,
    observedAfterEffects: values("進階後被動|取得技能|進階後技能"),
    observedLostEffects: values("失去效果|失去技能|失去被動"),
    effectsVerified: false,
    universallyBetter: false,
    note: "四軸差是已列有效值的比較；未列效果不代表不存在，技能與被動沒有折成零分。",
  };
}

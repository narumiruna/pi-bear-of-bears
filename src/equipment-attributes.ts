import type { EquipmentWeights } from "./equipment-optimizer.js";
import {
  type EquipmentRefinement,
  parseEquipmentRefinement,
} from "./equipment-refinement.js";
import { type InventoryEntry, parseListedAttributes } from "./inventory.js";

const keys = ["attack", "defense", "intelligence", "agility"] as const;

/** 合併明確列值；相同值去重，不將詞條與總值重複相加。 */
export function mergeEquipmentAttributes(
  entry: InventoryEntry,
  inspect: string,
  options: { inventorySparseComplete?: boolean } = {},
) {
  const sources: Array<{
    kind: "inventory" | "inspect" | "affix";
    text: string;
    values: Partial<EquipmentWeights> | null;
    refinement?: EquipmentRefinement;
  }> = [];
  const add = (
    kind: (typeof sources)[number]["kind"],
    text: string,
    refinement?: EquipmentRefinement,
  ) => {
    sources.push({
      kind,
      text,
      values: refinement?.effective ?? parseListedAttributes(text),
      ...(refinement ? { refinement } : {}),
    });
  };
  add(
    "inventory",
    entry.refinement?.text ?? entry.description.split("（")[0].trim(),
    entry.refinement,
  );
  const attributes = /^屬性：(.+)$/m.exec(inspect)?.[1];
  const refined = /^屬性（精煉 \+(\d+)）：(.+)$/mu.exec(inspect);
  const inspectRefinement = refined
    ? parseEquipmentRefinement(Number(refined[1]), refined[2])
    : undefined;
  if (attributes !== undefined) {
    add("inspect", attributes);
  }
  if (inspectRefinement) {
    add("inspect", inspectRefinement.text, inspectRefinement);
  }
  for (const match of inspect.matchAll(/^\s*⟨[^⟨⟩]+⟩\s*(.+)$/gm)) {
    add("affix", match[1]);
  }
  const diagnostics: string[] = [];
  if (
    inspect.includes("屬性（精煉") &&
    (!inspectRefinement ||
      attributes !== undefined ||
      inspect.match(/^屬性（精煉/gmu)?.length !== 1)
  ) {
    diagnostics.push("inspect 精煉屬性格式無法確認。");
  }
  if (
    inspect &&
    (entry.refinement?.level !== inspectRefinement?.level ||
      keys.some(
        (key) => entry.refinement?.base[key] !== inspectRefinement?.base[key],
      ))
  ) {
    diagnostics.push("inventory 與 inspect 精煉等級或基值不一致。");
  }
  const descriptionValues = parseListedAttributes(
    entry.description.split("（")[0].trim(),
  );
  if (
    entry.refinement &&
    descriptionValues &&
    keys.some((key) => descriptionValues[key] !== entry.refinement?.base[key])
  ) {
    diagnostics.push("inventory 精煉基值與屬性摘要不一致。");
  }
  const values: Partial<EquipmentWeights> = {};
  const conflicts: string[] = [];
  const inventoryValues = sources.find(
    (source) => source.kind === "inventory",
  )?.values;
  const inspectValues = sources.find(
    (source) => source.kind === "inspect",
  )?.values;
  const hasParsedInspect = Boolean(inspectValues);
  for (const source of sources) {
    if (!source.values) {
      // inspect 的「屬性」列是該裝備完整數值；可取代背包中混有技能文字的摘要。
      if (!(source.kind === "inventory" && hasParsedInspect)) {
        diagnostics.push(`${source.kind} 屬性格式無法確認。`);
      }
      continue;
    }
    for (const key of keys) {
      const value = source.values[key];
      if (value === undefined) {
        continue;
      }
      if (values[key] !== undefined && values[key] !== value) {
        if (!conflicts.includes(key)) {
          conflicts.push(key);
        }
      } else {
        values[key] = value;
      }
    }
  }
  for (const key of conflicts) {
    delete values[key as keyof EquipmentWeights];
    diagnostics.push(`${key} 的來源數值不一致，不選用任一來源或相加。`);
  }
  const inferredZeros: Array<keyof EquipmentWeights> = [];
  const inspectSparseComplete =
    (attributes !== undefined || inspectRefinement !== undefined) &&
    inspectValues !== null &&
    inspectValues !== undefined &&
    (!inventoryValues ||
      keys.every((key) => inspectValues[key] === inventoryValues[key]));
  if (
    (options.inventorySparseComplete || inspectSparseComplete) &&
    sources.some((source) => source.values)
  ) {
    for (const key of keys) {
      if (values[key] === undefined && !conflicts.includes(key)) {
        values[key] = 0;
        inferredZeros.push(key);
      }
    }
  }
  const missing = keys.filter(
    (key) => values[key] === undefined && !conflicts.includes(key),
  );
  if (missing.length > 0) {
    diagnostics.push(`尚未明確列出：${missing.join("、")}。`);
  }
  return {
    sources,
    values,
    missing,
    inferredZeros,
    conflicts,
    diagnostics,
    stats: diagnostics.length > 0 ? null : (values as EquipmentWeights),
  };
}

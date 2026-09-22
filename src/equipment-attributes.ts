import type { EquipmentWeights } from "./equipment-optimizer.js";
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
  }> = [];
  const add = (kind: (typeof sources)[number]["kind"], text: string) => {
    sources.push({ kind, text, values: parseListedAttributes(text) });
  };
  add("inventory", entry.description.split("（")[0].trim());
  const attributes = /^屬性：(.+)$/m.exec(inspect)?.[1];
  if (attributes !== undefined) {
    add("inspect", attributes);
  }
  for (const match of inspect.matchAll(/^\s*⟨[^⟨⟩]+⟩\s*(.+)$/gm)) {
    add("affix", match[1]);
  }
  const diagnostics: string[] = [];
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
    attributes !== undefined &&
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

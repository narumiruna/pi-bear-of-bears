import type { InventoryEntry } from "./inventory.js";
import type { Checkpoint } from "./workflow-observation-types.js";

/** 同名多組不合併為可用數量；列號不是跨版本物品 ID。 */
export function inventoryQuantities(entries: InventoryEntry[]) {
  const counts = new Map<string, number>();
  const ambiguous: string[] = [];
  for (const item of entries) {
    if (counts.has(item.name)) {
      ambiguous.push(item.name);
    } else {
      counts.set(item.name, item.count);
    }
  }
  for (const name of ambiguous) {
    counts.delete(name);
  }
  return { counts, ambiguous: [...new Set(ambiguous)] };
}

export function inventoryDifferences(before: Checkpoint, after: Checkpoint) {
  if (
    before.actor !== after.actor ||
    before.epoch !== after.epoch ||
    !before.inventory?.complete ||
    !after.inventory?.complete ||
    before.endId > after.endId
  ) {
    throw new Error("背包差異需要同角色、同分支、依時間排序的兩份完整版本。");
  }
  const first = inventoryQuantities(before.inventory.entries);
  const last = inventoryQuantities(after.inventory.entries);
  const ambiguous = [...new Set([...first.ambiguous, ...last.ambiguous])];
  const changes = [...new Set([...first.counts.keys(), ...last.counts.keys()])]
    .filter((name) => !ambiguous.includes(name))
    .map((name) => ({
      name,
      before: first.counts.get(name) ?? 0,
      after: last.counts.get(name) ?? 0,
      delta: (last.counts.get(name) ?? 0) - (first.counts.get(name) ?? 0),
    }))
    .filter((item) => item.delta !== 0);
  return {
    character: before.actor,
    beforeVersion: before.id,
    afterVersion: after.id,
    sources: { before: before.sources, after: after.sources },
    changes,
    ambiguous,
    complete: ambiguous.length === 0,
    note: "數量差異不證明收益來源、物品用途或操作授權。",
  };
}

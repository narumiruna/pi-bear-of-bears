import {
  type InventoryEntry,
  isExplicitNonEquipmentEntry,
  parseInventoryEquipmentFacts,
} from "./inventory.js";
import {
  cleanName,
  statusFacts,
  type WorkflowObservations,
} from "./workflow-observations.js";
import { workflowResult } from "./workflow-result.js";

function entryKind(entry: InventoryEntry) {
  if (entry.equipped || parseInventoryEquipmentFacts(entry)) {
    return "equipment";
  }
  if (!isExplicitNonEquipmentEntry(entry)) {
    return "unknown";
  }
  return /從 BOSS 凝聚|墜星核心剝落|分解傳說/u.test(entry.description)
    ? "materials"
    : "consumables";
}

/** 只從有效完整背包產生研究用 subset，不產生新的完整背包或執行資格。 */
export function inventorySnapshot(
  store: WorkflowObservations,
  filter: { kind?: "all" | "equipment" | "materials"; name?: string },
) {
  const status = store.latest(statusFacts, 300_000);
  const inventory = store.inventory();
  const result = workflowResult(status?.value.name ?? null, [
    ...(status ? [status.source] : []),
    ...(inventory?.sources ?? []),
  ]);
  result.data = {
    sourceTotal: inventory?.value.total ?? null,
    acquiredRows: inventory?.value.listed ?? 0,
    sourceComplete: inventory?.value.complete ?? false,
    filteredSubset: true,
    filter,
    items: [],
    actionable: false,
    maxAgeMs: 300_000,
  };
  if (!status || !inventory?.value.complete) {
    result.blockers.push(
      "需要同角色五分鐘內的完整全列背包及狀態；不從 subset 補完整性。",
    );
    return result;
  }
  store.assertBoundSources(inventory.sources);
  const rows = inventory.value.entries.map((entry) => ({
    rowNumber: entry.id,
    name: entry.name,
    count: entry.count,
    equipped: entry.equipped,
    locked: entry.locked ?? false,
    refinement: entry.refinement ?? null,
    kind: entryKind(entry),
    description: entry.description,
  }));
  const unknownRows = rows.filter((item) => item.kind === "unknown").length;
  const matched = rows.filter(
    (item) =>
      (!filter.kind || filter.kind === "all" || item.kind === filter.kind) &&
      (!filter.name || cleanName(item.name).includes(cleanName(filter.name))),
  );
  const items = matched.slice(0, 30);
  // 保留整列，無法容納的長列只省略並回報數量，不裁成不完整品項。
  while (
    items.length > 0 &&
    Buffer.byteLength(JSON.stringify(items)) > 24_000
  ) {
    items.pop();
  }
  Object.assign(result.data, {
    classificationComplete: unknownRows === 0,
    unknownRows,
    matchedRows: matched.length,
    shownRows: items.length,
    omittedRows: matched.length - items.length,
    items,
    note: "分類只含已確認品項；未知品項不猜用途。省略列須用名稱縮小範圍，沒有後端游標或增量協定。",
  });
  result.state = "ready";
  return result;
}

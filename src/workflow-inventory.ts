import {
  type InventoryEntry,
  isExplicitNonEquipmentEntry,
  parseInventoryEquipmentFacts,
} from "./inventory.js";
import { inventoryDifferences } from "./inventory-delta.js";
import {
  type DisposalCandidate,
  disposalPreflight,
} from "./workflow-disposal.js";
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

function missingRows(entries: InventoryEntry[], total: number | null) {
  if (total === null || !Number.isSafeInteger(total) || total < 0) {
    return [];
  }
  const ids = [...new Set(entries.map((entry) => entry.id))]
    .filter((id) => id >= 1 && id <= total)
    .sort((a, b) => a - b);
  const ranges: { from: number; to: number }[] = [];
  let next = 1;
  for (const id of ids) {
    if (id > next) {
      ranges.push({ from: next, to: id - 1 });
    }
    next = id + 1;
  }
  if (next <= total) {
    ranges.push({ from: next, to: total });
  }
  return ranges;
}
function continuousRows(entries: InventoryEntry[]) {
  let count = 0;
  for (const entry of entries) {
    if (entry.id !== count + 1) {
      break;
    }
    count++;
  }
  return count;
}
function duplicateGroups(rows: { name: string; rowNumber: number }[]) {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const group = groups.get(row.name) ?? [];
    group.push(row.rowNumber);
    groups.set(row.name, group);
  }
  const duplicate = [...groups].filter(([, ids]) => ids.length > 1);
  const shown = duplicate.slice(0, 30).map(([name, ids]) => ({
    name,
    rowNumbers: ids.slice(0, 30),
    omittedRows: Math.max(0, ids.length - 30),
  }));
  while (shown.length > 0 && Buffer.byteLength(JSON.stringify(shown)) > 6000) {
    shown.pop();
  }
  return { groups: shown, omittedGroups: duplicate.length - shown.length };
}

/** 只從有效完整背包產生研究用 subset，不產生新的完整背包或執行資格。 */
export function inventorySnapshot(
  store: WorkflowObservations,
  filter: {
    kind?: "all" | "equipment" | "materials" | "equipped";
    name?: string;
    compare?: { before: string; after: string };
    includeContinuation?: boolean;
    preflight?: DisposalCandidate;
  },
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
    ...(filter.includeContinuation
      ? { continuation: store.continuation() }
      : {}),
    ...(filter.preflight
      ? { preflight: disposalPreflight(store, filter.preflight) }
      : {}),
    actionable: false,
    diagnostics: inventory?.value.diagnostics ?? ["缺少有效背包來源。"],
    continuousRows: continuousRows(inventory?.value.entries ?? []),
    pages: inventory?.sources ?? [],
    missingRows: missingRows(
      inventory?.value.entries ?? [],
      inventory?.value.total ?? null,
    ),
    maxAgeMs: 300_000,
  };
  if (!status || !inventory?.value.complete) {
    const invalidation = store.invalidationEvent();
    if (invalidation) {
      result.data.invalidationEvent = invalidation;
    }
    result.blockers.push(
      "需要同角色五分鐘內的完整全列背包及狀態；不從 subset 補完整性。",
    );
    return result;
  }
  store.assertBoundSources(inventory.sources);
  const rowSources = new Map<number, (typeof inventory.sources)[number]>();
  for (const source of inventory.sources) {
    const text =
      store.all().find((record) => record.message.id === source.messageId)
        ?.message.text ?? "";
    for (const line of text.split(/\r?\n/u)) {
      const match = /^\s*(\d+)\. /u.exec(line);
      if (match) {
        rowSources.set(Number(match[1]), source);
      }
    }
  }
  const rows = inventory.value.entries.map((entry) => ({
    rowNumber: entry.id,
    name: entry.name,
    count: entry.count,
    equipped: entry.equipped,
    locked: entry.locked ?? false,
    refinement: entry.refinement ?? null,
    kind: entryKind(entry),
    description: entry.description,
    source: rowSources.get(entry.id) ?? null,
  }));
  const unknownRows = rows.filter((item) => item.kind === "unknown").length;
  const matched = rows.filter(
    (item) =>
      (!filter.kind ||
        filter.kind === "all" ||
        item.kind === filter.kind ||
        (filter.kind === "equipped" && item.equipped)) &&
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
    duplicateGroups: duplicateGroups(rows),
    ...(filter.compare
      ? {
          comparison: inventoryDifferences(
            store.get(filter.compare.before),
            store.get(filter.compare.after),
          ),
        }
      : {}),
    note: "分類只含已確認品項；未知品項不猜用途。省略列須用名稱縮小範圍，沒有後端游標或增量協定。",
  });
  const preflight = result.data.preflight as
    | ReturnType<typeof disposalPreflight>
    | undefined;
  result.state = preflight?.state ?? "ready";
  if (preflight) {
    result.blockers.push(...preflight.blockers);
  }
  return result;
}

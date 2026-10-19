import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const stable = (value: unknown) =>
  JSON.stringify(value).replaceAll(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gu,
    "00000000-0000-4000-8000-000000000000",
  );

test("明確要求 summary 才省略未穿背包列；預設 full 相容，內部完整快照及風險證據不減量", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    `🎒 背包（128 種，全列）：\n${Array.from({ length: 128 }, (_, index) => `  ${index + 1}. 🟠⚔️傳世鋼鐵巨劍 x${index + 1}${index === 0 ? " 【裝備中】" : ""} — ATK +5（Lv1 可裝備）`).join("\n")}\n🔢 用編號最方便：/inspect 1`,
    "/inventory all",
  );
  const full = await app.call("bears_combat_snapshot", { mode: "tower" });
  const summary = await app.call("bears_combat_snapshot", {
    mode: "tower",
    view: "summary",
  });
  expect(summary.state).toBe(full.state);
  expect(summary.blockers).toEqual(full.blockers);
  expect(summary.sources).toEqual(full.sources);
  expect(summary.data.riskVerified).toBe(false);
  expect(summary.data.inventory).toMatchObject({
    view: "summary",
    sourceTotal: 128,
    acquiredRows: 128,
    sourceComplete: true,
    filteredSubset: true,
    omittedRows: 127,
    equipped: [{ id: 1, equipped: true }],
    actionable: false,
  });
  expect(summary.data.inventory).not.toHaveProperty("entries");
  expect(
    app.store.get(summary.data.snapshotId as string).inventory?.entries,
  ).toHaveLength(128);
  expect(summary.data.plannerObservation).toEqual(full.data.plannerObservation);
  expect(summary.data.skills).toEqual(full.data.skills);
  expect(summary.data.effects).toEqual(full.data.effects);
  const before = stable(full),
    after = stable(summary);
  const reduction = 1 - encode(after).length / encode(before).length;
  expect(reduction).toBeGreaterThanOrEqual(0.3);
  expect({
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
    beforeTokens: encode(before).length,
    afterTokens: encode(after).length,
  }).toMatchSnapshot();
  expect(app.sent).toEqual([]);
});

test("summary 不修補缺頁、不刷新來源或創造執行資格", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(
    "🎒 背包（2 種，全列）：\n  1. 🟠⚔️傳世鋼鐵巨劍 — ATK +5（Lv1 可裝備）",
    "/inventory all",
  );
  const result = await app.call("bears_combat_snapshot", {
    mode: "tower",
    view: "summary",
  });
  expect(result.data.inventory).toMatchObject({
    sourceTotal: 2,
    acquiredRows: 1,
    sourceComplete: false,
    actionable: false,
  });
  expect(result.data.blocks).toMatchObject({
    equipment: { complete: false, riskVerified: false },
  });
  vi.mocked(Date.now).mockReturnValue(NOW + 60001);
  const expired = await app.call("bears_combat_snapshot", {
    mode: "tower",
    view: "summary",
  });
  expect(expired.state).toBe("needs_observation");
  expect(expired.data).not.toHaveProperty("plannerObservation");
  expect(app.sent).toEqual([]);
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

for (const mode of [
  "numeric",
  "unknown",
  "duplicate",
  "locked",
  "last",
  "changed",
] as const) {
  test(`不可逆預檢不執行操作：${mode}`, async () => {
    const app = workflowHarness();
    app.seed();
    let text = inventoryText();
    if (mode === "duplicate") {
      text = text.replace("傳世鋼鐵巨劍", "傳世青銅巨劍");
    }
    if (mode === "locked") {
      text = text.replace("傳世青銅巨劍", "傳世青銅巨劍 🔒");
    }
    app.observe(text, "/inventory all");
    const point = app.store.capture();
    if (mode === "changed") {
      app.observe(text.replace("x5", "x6"), "/inventory all");
    }
    const result = await app.call("bears_inventory_snapshot", {
      preflight: {
        snapshotId: point.id,
        item: mode === "numeric" ? "2" : "傳世青銅巨劍",
        quantity: 1,
        ...(mode === "unknown" ? {} : { retain: 0 }),
      },
    });
    expect(["stopped", "needs_observation"]).toContain(result.state);
    expect(result.data.actionable ?? false).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    if (mode === "numeric") {
      expect(result.blockers.join(" ")).toContain("整組數字");
    }
    if (mode === "duplicate") {
      expect(result.blockers.join(" ")).toContain("同名多組");
    }
    if (mode === "locked") {
      expect(result.blockers.join(" ")).toContain("已鎖定");
    }
    if (mode === "last") {
      expect(result.blockers.join(" ")).toContain("最後一件");
    }
    if (mode === "unknown") {
      expect(result.blockers.join(" ")).toContain("必要用途");
    }
    expect(app.sent).toEqual([]);
    expect(app.context.executeTool).not.toHaveBeenCalled();
  });
}

test.each([1, 2])(
  "前後實際移除 %i 件；數量不符或碎片缺預覽都不能通過驗收",
  async (removed) => {
    const app = workflowHarness();
    app.seed();
    app.observe(
      inventoryText().replace("傳世青銅巨劍", "傳世青銅巨劍 x3"),
      "/inventory all",
    );
    const before = app.store.capture();
    app.observe(
      inventoryText().replace("傳世青銅巨劍", `傳世青銅巨劍 x${3 - removed}`),
      "/inventory all",
    );
    const after = app.store.capture();
    const result = await app.call("bears_inventory_snapshot", {
      preflight: {
        snapshotId: before.id,
        verifyAfter: after.id,
        item: "傳世青銅巨劍",
        quantity: 1,
      },
    });
    expect(result.state).toBe("needs_observation");
    expect(result.data.preflight).toMatchObject({
      data: {
        quantityMatchesDeclaration: removed === 1,
        expectedFragments: null,
        fragmentsVerified: false,
        actionable: false,
      },
    });
    if (removed === 2) {
      expect(result.blockers.join(" ")).toContain("停止後續相依操作");
    }
    expect(app.sent).toEqual([]);
  },
);

test("唯一名稱可綁完整版本與 inspect；未知預覽、技能及用途仍不給可執行推薦", async () => {
  const app = workflowHarness();
  app.seed();
  const preview = app.observe("尚未保存完整格式的分解預覽", "/dismantle");
  app.seed();
  app.observe(
    inventoryText().replace("傳世青銅巨劍", "傳世青銅巨劍 x3"),
    "/inventory all",
  );
  const point = app.store.capture();
  const inspect = app.observe(
    "🟠⚔️傳世青銅巨劍\n類型：武器（武器槽）\n屬性：ATK +10\n授技：未知機制",
    "/inspect 2",
  );
  const result = await app.call("bears_inventory_snapshot", {
    preflight: {
      snapshotId: point.id,
      item: "傳世青銅巨劍",
      quantity: 1,
      retain: 2,
      inspect: { messageId: inspect.id, revision: inspect.revision },
      preview: { messageId: preview.id, revision: preview.revision },
    },
  });
  expect(result.state).toBe("needs_observation");
  expect(result.data.preflight).toMatchObject({
    data: {
      inventoryVersion: point.id,
      item: { count: 3 },
      expectedFragments: null,
      inspection: { unverifiedEffects: ["授技：未知機制"] },
      actionable: false,
      authorizationGranted: false,
    },
  });
  expect(result.blockers.join(" ")).toContain("預期碎片保持未知");
  expect(result.blockers.join(" ")).toContain("預覽早於綁定背包版本");
  expect(app.sent).toEqual([]);
});

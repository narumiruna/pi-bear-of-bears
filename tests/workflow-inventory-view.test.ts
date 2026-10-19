import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("本機背包分類／名稱篩選保留全列計數、來源及 subset 標記，不送 Telegram", async () => {
  const app = workflowHarness();
  app.seed();
  const material = await app.call("bears_inventory_snapshot", {
    kind: "materials",
  });
  expect(material.state).toBe("ready");
  expect(material.data).toMatchObject({
    sourceTotal: 3,
    acquiredRows: 3,
    sourceComplete: true,
    filteredSubset: true,
    matchedRows: 1,
    shownRows: 1,
    omittedRows: 0,
    actionable: false,
    items: [{ rowNumber: 3, count: 5, kind: "materials" }],
  });
  const equipment = await app.call("bears_inventory_snapshot", {
    kind: "equipment",
    name: "青銅",
  });
  expect(equipment.data).toMatchObject({
    matchedRows: 1,
    items: [{ rowNumber: 2 }],
  });
  expect(app.sent).toEqual([]);
  expect(app.context.executeTool).not.toHaveBeenCalled();
  expect(material.sources.some((source) => source.messageId === 2)).toBe(true);
});

test("缺頁、新批次、過期、reload 及未知活動均不能用 subset 冒充完整背包", async () => {
  for (const condition of ["missing", "expired", "reload", "activity"]) {
    const app = workflowHarness();
    app.seed();
    if (condition === "missing") {
      app.observe(inventoryText().replace("3 種", "4 種"), "/inventory all");
    }
    if (condition === "expired") {
      vi.mocked(Date.now).mockReturnValue(NOW + 300001);
    }
    if (condition === "reload") {
      app.store.reset();
    }
    if (condition === "activity") {
      app.observe("未歸因的外部操作");
    }
    const result = await app.call("bears_inventory_snapshot", {});
    expect(result.state).toBe("needs_observation");
    expect(result.data.items).toEqual([]);
    expect(app.sent).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});

test("未知品項不猜材料或裝備；分類完整性不等於全列完整性，掛機資料只能研究", async () => {
  const app = workflowHarness();
  app.seed();
  app.observe(`${statusText()}\n🐾 掛機中`, "/status");
  app.observe(
    inventoryText().replace(
      "從 BOSS 凝聚而出的力量結晶，於鍛造台用來進階王裝（/forge）。",
      "未確認用途",
    ),
    "/inventory all",
  );
  const result = await app.call("bears_inventory_snapshot", {
    kind: "materials",
  });
  expect(result.data).toMatchObject({
    sourceComplete: true,
    classificationComplete: false,
    unknownRows: 1,
    matchedRows: 0,
    actionable: false,
  });
  expect(app.sent).toEqual([]);
});

test("大型篩選提供有界摘要與省略數，不製造游標，也不延長來源時間", async () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  app.observe(
    `🎒 背包（80 種，全列）：\n${Array.from({ length: 80 }, (_, i) => `  ${i + 1}. 🟠⚔️傳世鋼鐵巨劍 x${i + 1} — ATK +5（Lv1 可裝備）`).join("\n")}\n🔢 用編號最方便：/inspect 1`,
    "/inventory all",
  );
  const result = await app.call("bears_inventory_snapshot", {});
  expect(result.data).toMatchObject({
    sourceTotal: 80,
    acquiredRows: 80,
    matchedRows: 80,
    shownRows: 30,
    omittedRows: 50,
    filteredSubset: true,
  });
  expect(result.data).not.toHaveProperty("nextOffset");
  expect(result.sources.every((source) => source.observedAt === NOW)).toBe(
    true,
  );
  expect(app.sent).toEqual([]);
});

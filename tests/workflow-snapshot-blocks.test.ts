import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { combatSnapshot } from "../src/workflow-combat.js";
import { workflowResult } from "../src/workflow-result.js";
import { WorkflowRunner } from "../src/workflow-runner.js";
import {
  inventoryText,
  NOW,
  roomText,
  skillsText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
test("各區塊保留來源與時間；新 status 不刷新舊 inventory／skills，非原子且風險未驗", () => {
  const app = workflowHarness();
  app.seed();
  vi.mocked(Date.now).mockReturnValue(NOW + 30000);
  app.observe(statusText(), "/status");
  const result = combatSnapshot(app.store, "tower");
  expect(result.data.nonAtomic).toBe(true);
  const blocks = result.data.blocks as Record<
    string,
    { sources: { observedAt: number }[]; fresh: boolean; riskVerified: boolean }
  >;
  expect(Object.keys(blocks)).toEqual(
    expect.arrayContaining([
      "character",
      "equipment",
      "resources",
      "location",
      "encounter",
      "skills",
      "effects",
    ]),
  );
  expect(blocks.character.sources[0].observedAt).toBe(NOW + 30000);
  expect(blocks.equipment.sources[0].observedAt).toBe(NOW);
  expect(blocks.skills.sources[0].observedAt).toBe(NOW);
  expect(blocks.effects.riskVerified).toBe(false);
  expect(app.sent).toEqual([]);
});
test("全背包準備重用有效觀測；缺漏才補一筆，不為完整回覆補 history", async () => {
  const app = workflowHarness();
  app.seed();
  const result = workflowResult("測試熊");
  const run = new WorkflowRunner(
    app.store,
    app.context,
    result,
    undefined,
    new AbortController().signal,
  );
  expect((await run.prepareInventory()).complete).toBe(true);
  expect(app.context.executeTool).not.toHaveBeenCalled();
  app.store.invalidate();
  app.observe(statusText(), "/status");
  expect((await run.prepareInventory()).complete).toBe(true);
  expect(app.sent).toEqual(["/inventory all"]);
  expect(app.context.executeTool).toHaveBeenCalledTimes(1);
});

test("補查中切角停止；掛機中缺背包不查詢、不停掛", async () => {
  for (const idle of [true, false]) {
    const app = workflowHarness();
    app.seed();
    app.store.invalidate();
    app.observe(`${statusText()}${idle ? "\\n🐾 掛機中" : ""}`, "/status");
    const result = workflowResult("測試熊");
    const run = new WorkflowRunner(
      app.store,
      app.context,
      result,
      undefined,
      new AbortController().signal,
    );
    app.overrides.set("/inventory all", () => {
      app.observe(statusText("別角"), "/status");
      return inventoryText();
    });
    await expect(run.prepareInventory()).rejects.toThrow(
      idle ? /掛機/u : /角色/u,
    );
    expect(app.sent).toEqual(idle ? [] : ["/inventory all"]);
  }
});

test("位置來源衝突停止建立 ready 快照；完整背包不等於物品可唯一綁定", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(roomText("另一房"), "/look");
  const conflict = combatSnapshot(app.store, "tower");
  expect(conflict.state).toBe("needs_observation");
  expect(conflict.data.blocks).toMatchObject({
    location: { complete: false, uniquelyBound: false },
  });
  const duplicate = inventoryText()
    .replace("傳世青銅巨劍", "傳世鋼鐵巨劍")
    .replace("ATK +5", "ATK +10")
    .replace(" 【裝備中】", "");
  app.observe(duplicate, "/inventory all");
  expect(combatSnapshot(app.store, "tower").data.blocks).toMatchObject({
    equipment: { complete: true, uniquelyBound: false },
  });
});

test("來源過期、未來、重讀舊資料不刷新日期", () => {
  const app = workflowHarness();
  app.seed();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 61000);
  app.store.observe(app.raw);
  expect(combatSnapshot(app.store, "tower").blockers.join(" ")).toContain(
    "/status",
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW - 1000);
  expect(combatSnapshot(app.store, "tower").state).toBe("needs_observation");
});

test("技能不完整時只回傳缺口，不以零值建立 action", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(skillsText.replaceAll("無其他成本", "未知耗血"), "/skills");
  const result = combatSnapshot(app.store, "tower");
  expect(result.data.plannerObservation).toMatchObject({ actions: [] });
  expect(result.data.blocks).toMatchObject({
    skills: {
      parsable: true,
      complete: false,
      fresh: true,
      uniquelyBound: true,
      riskVerified: false,
    },
  });
});

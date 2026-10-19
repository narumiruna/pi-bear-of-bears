import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { combatSnapshot } from "../src/workflow-combat.js";
import {
  inventoryText,
  NOW,
  skillsText,
  statusText,
  towerText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const source = {
  messageId: 10,
  revision: "a".repeat(64),
  date: NOW / 1000,
  observedAt: NOW,
  originalSourceId: "fixture-source",
};
// 明確標籤式 replay 協定；不是原生 Telegram 格式或戰鬥安全證明。
const trace = (lines: string[]) =>
  parseCombatEvents(["戰鬥紀錄：測試王", ...lines].join("\n"), source);

test("事件依原文順序保留成本、先機、名補／實補、燃血、反擊與正式結算", () => {
  const result = trace([
    "MP消耗：42",
    "先機：58；HP：3040→2982/3040",
    "對敵傷害：900；敵HP：1000→100/1000",
    "恢復：500；HP：2982→3040/3040",
    "燃血：456；HP：3040→2584/3040",
    "反擊：78；HP：2584→2506/3040",
    "狀態：戰鬥中",
  ]);
  expect(result.complete).toBe(true);
  expect(result.outcome).toBe("ongoing");
  expect(result.events.map((event) => event.kind)).toEqual([
    "mp_cost",
    "initiative",
    "damage",
    "healing",
    "hp_cost",
    "counter",
    "state",
  ]);
  expect(result.events[3]).toMatchObject({
    nominal: { value: 500, basis: "observed" },
    actual: { value: 58, basis: "derived" },
    line: 5,
  });
  expect(result.battleId).toBeNull();
  expect(result.riskVerified).toBe(false);
  expect(result.source).toEqual(source);
});

test("滿血名補實補0；缺段及多次未分配治療保持 unknown，不倒推分攤", () => {
  expect(trace(["恢復：500；HP：3040→3040/3040"]).events[0].actual).toEqual({
    value: 0,
    basis: "derived",
  });
  const ambiguous = trace(["恢復：500", "恢復：400", "HP：3040/3040"]);
  expect(
    ambiguous.events
      .filter((event) => event.kind === "healing")
      .every((event) => event.actual?.value === null),
  ).toBe(true);
  expect(ambiguous.complete).toBe(false);
});

test("閃避後盾耗次不明保留保守界線；DEF描述不能變成runtime減傷百分比", () => {
  const result = trace([
    "護盾：接下來3次受擊減傷19%",
    "反擊：0（閃避）；HP：3040→3040/3040",
    "狀態：戰鬥中",
  ]);
  expect(result.shield).toMatchObject({
    remainingHits: null,
    bounds: { min: 0, max: 3 },
    basis: "derived",
  });
  expect(trace(["DEF +20"]).complete).toBe(false);
});

test("跨狂暴門檻只保留觀測，敵0HP未結算不能算勝利", () => {
  const ongoing = trace([
    "對敵傷害：700；敵HP：1000→300/1000",
    "效果：敵人進入狂暴",
    "對敵傷害：300；敵HP：300→0/1000",
    "狀態：戰鬥中",
  ]);
  expect(ongoing.outcome).toBe("ongoing");
  expect(ongoing.rewardGold.value).toBeNull();
  expect(trace(["對敵傷害：1000；敵HP：1000→0/1000"]).outcome).toBe("unknown");
  expect(trace(["結算：勝利", "獲得金幣：100G"]).rewardGold).toEqual({
    value: 100,
    basis: "observed",
  });
});

test.each(["結算：失敗", "結算：逃離"])("結算狀態不合併成贏：%s", (line) => {
  expect(trace([line]).outcome).toBe(
    line.includes("失敗") ? "lost" : "escaped",
  );
});

test("缺漏、矛盾與非法整數不產生可信實補、獎勵或攻擊候選", () => {
  for (const lines of [
    ["先機：58；HP：3040→2982/3040", "恢復：500；HP：2900→3040/3040"],
    ["結算：勝利", "結算：失敗", "獲得金幣：100G"],
    ["MP消耗：9007199254740992"],
    ["恢復：10；HP：1→100/100"],
    ["未知追傷"],
  ]) {
    const result = trace(lines);
    expect(result.complete).toBe(false);
    expect(result.rewardGold.value).toBeNull();
  }
  const app = workflowHarness();
  app.seed();
  app.observe("戰鬥紀錄：合成星主\n未知追傷", "/skill 合成小招");
  app.observe(statusText(), "/status");
  app.observe(inventoryText(), "/inventory all");
  app.observe(skillsText, "/skills");
  app.observe(towerText(), "/tower");
  const snapshot = combatSnapshot(app.store, "tower");
  expect(snapshot.state).toBe("needs_observation");
  expect(snapshot.data.riskVerified).toBe(false);
  expect(snapshot.data.plannerObservation).toMatchObject({ actions: [] });
});

test("同 message ID／revision 不重複計獎，revision 更新只取新版；零HP未結算收支不閉帳", async () => {
  const app = workflowHarness();
  const before = app.seed();
  const receipt = app.observe(
    "戰鬥紀錄：測試王\n結算：勝利\n獲得金幣：100G",
    "/attack 測試王",
  );
  app.store.observe([receipt]);
  app.store.observe(
    [
      {
        ...receipt,
        text: receipt.text.replace("100G", "120G"),
        revision: "b".repeat(64),
      },
    ],
    "/attack 測試王",
  );
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  app.observe(statusText("測試熊", 900, 60, 1120), "/status");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const reconciled = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: after.id,
  });
  expect(reconciled.data.credits).toBe(120);
  expect(reconciled.data.events).toHaveLength(1);
  const unsafe = workflowHarness();
  const start = unsafe.seed();
  unsafe.observe(
    "戰鬥紀錄：測試王\n對敵傷害：1000；敵HP：1000→0/1000\n獲得金幣：100G",
    "/attack 測試王",
  );
  unsafe.observe(statusText("測試熊", 900, 60, 1100), "/status");
  unsafe.observe(inventoryText(), "/inventory all");
  const end = unsafe.store.capture();
  const result = await unsafe.call("bears_reconcile_rewards", {
    before: start.id,
    after: end.id,
  });
  expect(result.state).toBe("needs_observation");
  expect(result.data.credits).toBe(0);
  expect(unsafe.sent).toEqual([]);
});

test.each([
  ["對敵傷害：10；HP：100→90/100"],
  ["恢復：10；敵HP：90→100/100"],
  ["對敵傷害：10；敵HP：100→90/100", "對敵傷害：10；敵HP：90→80/200"],
  ["結算：勝利", "反擊：10；HP：100→90/100", "獲得金幣：100G"],
  ["獲得金幣：100G", "結算：勝利"],
  ["對敵傷害：10；敵HP：100→90/100", "結算：勝利", "獲得金幣：100G"],
])("HP 對象、最大值及正式結算順序矛盾不計獎：%j", (...lines) => {
  const result = trace(lines);
  expect(result.complete).toBe(false);
  expect(result.rewardGold.value).toBeNull();
});

test("非已確認格式保留 unknown，不從相同名稱／編號／殘血合成 battle ID", () => {
  const result = parseCombatEvents("敵人HP0；仍在戰鬥中", source);
  expect(result).toMatchObject({
    format: "unsupported",
    complete: false,
    outcome: "unknown",
    battleId: null,
    riskVerified: false,
  });
  expect(result.events).toEqual([]);
});

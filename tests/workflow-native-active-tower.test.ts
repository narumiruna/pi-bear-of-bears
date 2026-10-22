import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { towerFacts } from "../src/workflow-parsers.js";
import { NOW, workflowHarness } from "./fixtures/workflow.js";

// 776654 (2026-10-21)：原生 /tower 的進行中格式；不含入場費或 ATK。
const nativeTower = `🗼 無盡星塔 — 每一層都是一顆未墜之星的倒影
📜 個人最佳：第 39 層｜入塔 8 次
⚔️ 挑戰中：第 17 層　🐧星影·凍原冰鰭獸　HP 22,269/22,269
　/attack 或 /skill 繼續攻塔｜/tower quit 結束
💡 塔怪只在你出手時反擊——隨時可停手喝藥、整裝再戰（怪血保留）；/flee 只是收刀，之後 /attack 即接回本層`;

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("原生進行中樓層與怪血可綁定，不虛構入場價格、ATK 或可選樓層", () => {
  expect(towerFacts(nativeTower)).toMatchObject({
    floor: 17,
    target: "星影·凍原冰鰭獸",
    hp: 22269,
    maxHp: 22269,
    best: 39,
    conflicts: [],
    challengeKnown: true,
    attack: null,
    starts: [],
    pricing: { kind: "unknown", gold: null, crystals: null },
  });
});

test.each([
  `${nativeTower}\n⚔️ 挑戰中：第 18 層　🐧另一怪　HP 1/2`,
  `${nativeTower}\n⚔️ 挑戰中：第 17 層　🐧星影·凍原冰鰭獸　HP 22,269/22,269`,
  `${nativeTower}\nHP：1/2`,
  `${nativeTower}\n目前樓層：第18層`,
  `${nativeTower}\n怪物：另一怪`,
  `${nativeTower}\n🎫 入場：🎁 今日首戰免費`,
  `${nativeTower}\n📜 個人最佳：第 39 層｜入塔 8 次`,
  nativeTower.replace("第 17 層", "第 0 層"),
  nativeTower.replace("HP 22,269/22,269", "HP 未知"),
  nativeTower.replace("🐧星影·凍原冰鰭獸", "🐧"),
])("矛盾、重複或未知進行中格式不建立可操作挑戰", (text) => {
  const facts = towerFacts(text);
  expect(facts?.floor).toBeNull();
  expect(facts?.hp).toBeNull();
  expect(facts?.pricing.kind).toBe("unknown");
  expect(facts?.conflicts.length).toBeGreaterThan(0);
});

test.each([
  "HP 22,270/22,269",
  "HP 1/0",
  "HP 22,26/22,269",
  "HP 9007199254740992/9007199254740992",
])("無效怪血 %s 不補值", (hp) => {
  expect(
    towerFacts(nativeTower.replace("HP 22,269/22,269", hp))?.hp,
  ).toBeNull();
});

test("恢復流程接受原生挑戰，但仍需前庭明示免費才能休息", async () => {
  const app = workflowHarness();
  app.state.floor = 17;
  app.state.enemyHp = 22269;
  app.overrides.set("/tower", () => nativeTower);
  app.seed();
  app.observe(nativeTower, "/tower");
  const observed = app.store.latest((message) => towerFacts(message.text));
  if (!observed) {
    throw new Error("缺少原生挑戰觀測");
  }
  const point = app.store.capture([observed.source]);
  const result = await app.call("bears_tower_recover", {
    scope: app.scope(point.id),
  });
  expect(result.blockers).toEqual([]);
  expect(result.state).toBe("confirmed");
  expect(result.data.recovered).toEqual({ hp: 100, mp: 40, gold: 0 });
  expect(app.sent.filter((command) => command === "/rest")).toHaveLength(1);
  expect(app.sent.some((command) => /tower (?:go|quit)/u.test(command))).toBe(
    false,
  );
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { nativeTowerReward } from "../src/combat-native-tower.js";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

const text = readFileSync(
  new URL("./fixtures/native-tower-clear-823125.txt", import.meta.url),
  "utf8",
).trimEnd();
const parse = (raw = text) =>
  parseCombatEvents(raw, {
    messageId: 823125,
    revision: "fixture",
    date: 1793043560,
    observedAt: 1793043561748,
  });
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => {
  vi.restoreAllMocks();
});

test("823125首達精魄保留數量與行號，預覽不污染本場", () => {
  const r = parse();
  expect(r).toMatchObject({
    complete: true,
    outcome: "won",
    target: "星影·魔王衛士",
    rewardGold: { value: 6073 },
    unknownLines: [],
    issues: [],
    riskVerified: false,
  });
  expect(r.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "reward_item",
        line: 10,
        description: "💠 王之精魄 ×2",
        nominal: { value: 2, basis: "observed" },
      }),
      expect.objectContaining({
        kind: "effect",
        line: 11,
        description: expect.stringContaining("第 96 層"),
      }),
    ]),
  );
  expect(nativeTowerReward(parse())).toMatchObject({
    floor: 95,
    repeatable: 6073,
    firstClear: 1140000,
    total: 1146073,
  });
});

test("首達含精魄的區間金帳仍完全閉合", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, "/skill 血怒亂斬");
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 1147073), "/status");
  app.observe(inventoryText(), "/inventory all");
  const r = reconcileRewards(app.store, before.id, app.store.capture().id);
  expect(r.data).toMatchObject({ credits: 1146073, unexplained: 0 });
});

const essence = "　💠 王之精魄 ×2";
const invalid = [
  text.replace(essence, `${essence}\n${essence}`),
  text.replace(essence, "　💠 未知素材 ×2"),
  text.replace(essence, "　💠 王之精魄 ×0"),
  text.replace(essence, "　💠 王之精魄 ×9007199254740992"),
  text.replace(essence, "　💠 王之精魄 ×-2"),
  text.replace(essence, "　💠 王之精魄 ×2.5"),
  text.replace(essence, "　💠 王之精魄 ×2\n"),
  text.replace(
    `⭐ 個人首達！獎勵 🪙1,140,000\n${essence}`,
    `${essence}\n⭐ 個人首達！獎勵 🪙1,140,000`,
  ),
  text.replace("💀 星影·魔王衛士 倒下！EXP +343449  金幣 +6,073", ""),
  text.replace("HP：0/9010448", "HP：1/9010448"),
  text.replace("第 96 層：", "第 97 層："),
  `${text}\n未知費用`,
];
test.each(invalid)("首達精魄未知、錯序、溢位仍拒絕：%#", (raw) => {
  expect(parse(raw)).toMatchObject({
    complete: false,
    outcome: "unknown",
    rewardGold: { value: null },
    riskVerified: false,
  });
  expect(nativeTowerReward(parse(raw))).toBeNull();
});

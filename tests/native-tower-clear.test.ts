import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { ledgerWatch } from "../src/ledger-channel.js";
import { ledgerFact, parseLedgerFacts } from "../src/ledger-facts.js";
import { reconcileRewards } from "../src/workflow-rewards.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import {
  inventoryText,
  message,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

const text = readFileSync(
  new URL("./fixtures/native-tower-clear-820047.txt", import.meta.url),
  "utf8",
).trimEnd();
const parse = (raw = text) =>
  parseCombatEvents(raw, {
    messageId: 820047,
    revision: "fixture",
    date: 1793021852,
    observedAt: 1793021852000,
  });
const open: ReturnType<typeof ledgerHarness>[] = [];
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
  vi.restoreAllMocks();
});

test("820047完整通層尾段可解析，下一層不污染本場目標與HP", () => {
  const r = parse();
  expect(r).toMatchObject({
    complete: true,
    outcome: "won",
    target: "星影·冥界守衛",
    rewardGold: { value: 6208 },
    unknownLines: [],
    issues: [],
    riskVerified: false,
  });
  expect(
    r.events.filter((e) => e.kind === "damage").at(-1)?.hpAfter?.value,
  ).toBe(0);
  expect(
    ledgerFact(parseLedgerFacts(message(820047, text), NOW), "tower_clear"),
  ).toMatchObject({
    floor: 93,
    repeatable: 6208,
    firstClear: 1116000,
    total: 1122208,
    format: "native",
  });
});

test("通層與戰鬥同則回覆只扣一次MP、怪金與首達各入一次，重讀不重計", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  await h.act(
    "/status",
    statusText("測試熊", 1000, 100, 18461826).replace(
      "HP：1000/1000　MP：100/100",
      "HP：3040/3040　MP：362/422",
    ),
  );
  const r = await h.act("/skill 血怒亂斬", text);
  expect(r.accounting).toMatchObject({
    confirmedMpCost: 32,
    mpAfter: 330,
    hpAfter: 3040,
    complete: true,
  });
  expect(h.projection().account).toMatchObject({
    mpSpent: 32,
    credits: 1122208,
    firstClear: 1116000,
    repeatable: 6208,
    gold: { value: 19584034 },
    clears: [expect.objectContaining({ floor: 93 })],
  });
  ledgerWatch(h.messages);
  await h.game.history();
  expect(h.projection().account?.credits).toBe(1122208);
});

test("區間對帳同時列怪金與首達，不能漏計首達或雙加怪金", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(text, "/skill 血怒亂斬");
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 1123208), "/status");
  app.observe(inventoryText(), "/inventory all");
  const after = app.store.capture();
  const r = reconcileRewards(app.store, before.id, after.id);
  expect(r.data).toMatchObject({ credits: 1122208, unexplained: 0 });
  expect(r.data.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ category: "battle", credit: 6208 }),
      expect.objectContaining({ category: "one_time", credit: 1116000 }),
    ]),
  );
});

const invalid = [
  text.replace("⭐ 個人首達！", "\n⭐ 個人首達！"),
  text.replace("💀 星影·冥界守衛 倒下！EXP +311518  金幣 +6,208", ""),
  `${text}\n未知費用`,
  text.replace("🗼 第 93 層攻破！\n", ""),
  text.replace("⭐ 個人首達！獎勵 🪙1,116,000\n", ""),
  text.split("\n").slice(0, -1).join("\n"),
  text.replace("第 94 層：", "第 95 層："),
  text.replace("第 93 層攻破！", "第 94 層攻破！"),
  text.replace("HP：0/7725007", "HP：1/7725007"),
  text.replace("💀 星影·冥界守衛 倒下！", "💀 另一隻怪物 倒下！"),
  text.replace("1,116,000", "9007199254740992"),
  text.replace("1,116,000", "9007199254740991"),
  text.replace("8,343,007", "0"),
  text.replace("15,812", "9007199254740992"),
  text.replace("第 93 層攻破！", "第 93 層攻破！\n🗼 第 93 層攻破！"),
  text.replace(
    "🗼 第 93 層攻破！\n⭐ 個人首達！獎勵 🪙1,116,000",
    "⭐ 個人首達！獎勵 🪙1,116,000\n🗼 第 93 層攻破！",
  ),
];
test.each(invalid)("缺行、矛盾、錯序與溢位不認通層：%#", (raw) => {
  expect(parse(raw)).toMatchObject({
    complete: false,
    outcome: "unknown",
    rewardGold: { value: null },
    riskVerified: false,
  });
  expect(
    ledgerFact(parseLedgerFacts(message(1, raw), NOW), "tower_clear"),
  ).toBeNull();
});

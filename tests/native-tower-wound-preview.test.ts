import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { ledgerWatch } from "../src/ledger-channel.js";
import { ledgerFact, parseLedgerFacts } from "../src/ledger-facts.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { message, NOW, statusText } from "./fixtures/workflow.js";

const text = readFileSync(
  new URL("./fixtures/native-tower-clear-824867.txt", import.meta.url),
  "utf8",
).trimEnd();
const suffix = "　🩸重傷層：吸血/回春 −60%";
const parse = (raw = text) =>
  parseCombatEvents(raw, {
    messageId: 824867,
    revision: "fixture",
    date: 1793051606,
    observedAt: 1793051607211,
  });
const open: ReturnType<typeof ledgerHarness>[] = [];
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
  vi.restoreAllMocks();
});

test("824867重傷只屬下層預覽，不污染本場目標、HP與治療", () => {
  const r = parse();
  expect(r).toMatchObject({
    complete: true,
    outcome: "won",
    target: "星影·疾風隼",
    rewardGold: { value: 4782 },
    unknownLines: [],
    issues: [],
    riskVerified: false,
  });
  expect(
    r.events.find((e) => e.kind === "effect" && e.line === 10),
  ).toMatchObject({
    description: expect.stringContaining(suffix),
  });
  expect(
    r.events.filter((e) => e.kind === "damage").at(-1)?.hpAfter?.value,
  ).toBe(0);
  expect(r.events.find((e) => e.kind === "healing")).toMatchObject({
    nominal: { value: 5295 },
    healingSource: "active_skill",
  });
  expect(
    ledgerFact(parseLedgerFacts(message(824867, text), NOW), "tower_clear"),
  ).toMatchObject({
    floor: 96,
    firstClear: 1152000,
    repeatable: 4782,
    total: 1156782,
  });
});

test("重傷預覽可與已核精魄行並存且保留正確行號", () => {
  const raw = text.replace("🗼 第 97 層：", "　💠 王之精魄 ×2\n🗼 第 97 層：");
  const r = parse(raw);
  expect(r.complete).toBe(true);
  expect(r.events.find((e) => e.kind === "reward_item")).toMatchObject({
    line: 10,
  });
  expect(r.events.find((e) => e.line === 11)).toMatchObject({
    kind: "effect",
    description: expect.stringContaining(suffix),
  });
});

test("重傷預覽通層只扣一次MP、怪金與首達各入一次", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  await h.act(
    "/status",
    statusText("測試熊", 1000, 100, 21863222).replace(
      "HP：1000/1000　MP：100/100",
      "HP：3040/3040　MP：330/422",
    ),
  );
  const r = await h.act("/skill 血怒亂斬", text);
  expect(r.accounting).toMatchObject({
    confirmedMpCost: 32,
    mpAfter: 298,
    hpAfter: 3040,
    complete: true,
  });
  expect(h.projection().account).toMatchObject({
    credits: 1156782,
    repeatable: 4782,
    firstClear: 1152000,
    gold: { value: 23020004 },
  });
  ledgerWatch(h.messages);
  await h.game.history();
  expect(h.projection().account?.credits).toBe(1156782);
});

const invalid = [
  text.replace(suffix, `${suffix}${suffix}`),
  text.replace(suffix, `${suffix}\n未知費用`),
  text.replace(suffix, "\n🩸重傷層：吸血/回春 −60%"),
  text.replace(suffix, "　🩸重傷層：吸血/回春 −50%"),
  text.replace(suffix, "　🩸重傷層：吸血/回春 −600%"),
  text.replace(suffix, "　未知效果"),
  text.replace("HP：0/9731284", "HP：1/9731284"),
  text.replace("第 97 層：", "第 98 層："),
  text.replace("💀 星影·疾風隼 倒下！EXP +360621  金幣 +4,782", ""),
  text.replace("⭐ 個人首達！獎勵 🪙1,152,000\n", ""),
];
test.each(invalid)("未知重傷格式、缺行或矛盾仍拒絕：%#", (raw) => {
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

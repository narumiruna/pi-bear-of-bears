import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";

const text = readFileSync(
  new URL("./fixtures/native-wounded-lifesteal-824930.txt", import.meta.url),
  "utf8",
).trimEnd();
const parse = (raw = text) =>
  parseCombatEvents(raw, {
    messageId: 824930,
    revision: "fixture",
    date: 1793052197,
    observedAt: 1793052198540,
  });

test("824930重傷神吸先補1149，主動僅實補371，不再誤算1520", () => {
  const r = parse();
  expect(r).toMatchObject({
    complete: true,
    unknownLines: [],
    issues: [],
    riskVerified: false,
  });
  expect(r.events.filter((e) => e.kind === "healing")).toMatchObject([
    {
      line: 9,
      description: "🩸 神話吸血 +1149（重傷衰減）　HP：2669/3040",
      healingSource: "mythic_lifesteal",
      nominal: { value: 1149 },
      actual: { value: 1149 },
      hpAfter: { value: 2669 },
      unappliedNominal: { value: 0 },
    },
    {
      line: 10,
      healingSource: "active_skill",
      nominal: { value: 13399 },
      actual: { value: 371 },
      hpAfter: { value: 3040 },
      unappliedNominal: { value: 13028 },
      overheal: { value: null },
    },
  ]);
  expect(
    r.events
      .filter((e) => ["initiative", "healing", "counter"].includes(e.kind))
      .map((e) => e.kind),
  ).toEqual(["initiative", "healing", "healing", "counter"]);
});

test("神吸548的同序案例保留主動實補972，不套重傷倍率", () => {
  const r = parse(
    text.replace("+1149（重傷衰減）　HP：2669", "+548（重傷衰減）　HP：2068"),
  );
  expect(r.complete).toBe(true);
  expect(
    r.events.filter((e) => e.kind === "healing").map((e) => e.actual?.value),
  ).toEqual([548, 972]);
});

test("首次重傷神吸無前HP仍保留實補未知", () => {
  const r = parse(
    "✨ 使用技能：血怒亂斬（MP -32）\n🩸 神話吸血 +1149（重傷衰減）　HP：2669/3040",
  );
  expect(r.events.find((e) => e.kind === "healing")).toMatchObject({
    healingSource: "mythic_lifesteal",
    actual: { value: null },
  });
});

test.each([
  text.replace("（重傷衰減）", "（未知衰減）"),
  text.replace("（重傷衰減）", "（重傷衰減）（重傷衰減）"),
  text.replace("+1149", "+9007199254740992"),
  text.replace("HP：2669/3040", "HP：2670/3040"),
  `${text}\n未知事件`,
])("未知標記、溢位或HP矛盾仍拒絕：%#", (raw) => {
  expect(parse(raw)).toMatchObject({ complete: false, riskVerified: false });
});

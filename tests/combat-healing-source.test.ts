import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { type LedgerCombat, ledgerFact } from "../src/ledger-facts.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const blood = read("./fixtures/native-combat-819096.json") as {
  text: string;
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
};
const mixed = read("./fixtures/native-combat-819046.json") as typeof blood;
const berserk = (
  read("./fixtures/native-combat.json") as (typeof blood)[]
).find((row) => row.id === 677625);
if (!berserk) {
  throw new Error("缺少嗜血原文677625");
}
const parse = (text: string) =>
  parseCombatEvents(text, {
    messageId: blood.id,
    date: blood.date,
    revision: blood.revision,
    originalSourceId: blood.originalSourceId,
    observedAt: blood.date * 1000,
  });
const heals = (text: string) =>
  parse(text).events.filter((e) => e.kind === "healing");
const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("819096血怒主動吸取不是裝備被動；首次實補仍unknown", () => {
  const result = parse(blood.text);
  expect(result.complete).toBe(true);
  expect(heals(blood.text)).toMatchObject([
    {
      healingSource: "active_skill",
      nominal: { value: 14936 },
      actual: { value: null },
      overheal: { value: null },
    },
  ]);
  expect(result.riskVerified).toBe(false);
});

test("677625嗜血狂殺的技內吸取也標為主動，保留燃血順序", () => {
  expect(heals(berserk.text)[0].healingSource).toBe("active_skill");
  expect(
    parse(berserk.text)
      .events.filter((e) => ["healing", "hp_cost", "counter"].includes(e.kind))
      .map((e) => e.kind),
  ).toEqual(["healing", "hp_cost", "counter"]);
});

test("819046神話吸血與主動吸取分開，不改實補1520／0", () => {
  expect(heals(mixed.text)).toMatchObject([
    { healingSource: "mythic_lifesteal", actual: { value: 1520 } },
    { healingSource: "active_skill", actual: { value: 0 } },
  ]);
});

test.each(["未知吸血技能", "血怒亂斬改"])(
  "未驗證技能%s的相同吸血文案保留unknown",
  (name) => {
    const events = heals(
      blood.text.replace("使用技能：血怒亂斬", `使用技能：${name}`),
    );
    expect(events[0].healingSource).toBe("unknown");
    expect(events[0].actual?.value).toBeNull();
  },
);

test("一般主動恢復文案仍為active_skill", () => {
  const text =
    "✨ 使用技能：地脈·萬物回春（MP -60）\n💚 恢復 1672 HP！HP：3040/3040";
  expect(heals(text)[0]).toMatchObject({
    healingSource: "active_skill",
    nominal: { value: 1672 },
    actual: { value: null },
  });
});

test("Game→持久化帳本保存正確回血來源，HP／MP與成本不變", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  await h.act(
    "/status",
    statusText().replace(
      "HP：900/1000　MP：60/100",
      "HP：3040/3040　MP：54/422",
    ),
  );
  const result = await h.act("/skill 血怒亂斬", blood.text);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    complete: true,
    hpAfter: 3040,
    mpAfter: 22,
    confirmedMpCost: 32,
  });
  const data = h.runtime.read();
  const obs = data.observations.find((o) => o.message.text === blood.text);
  const facts =
    data.facts.find((f) => f.observationId === obs?.id)?.facts ?? [];
  expect(
    ledgerFact<LedgerCombat>(facts, "combat")?.events.find(
      (e) => e.kind === "healing",
    )?.healingSource,
  ).toBe("active_skill");
});

test("來源修正不放寬未知尾文或推實補", () => {
  const result = parse(`${blood.text}\n未知事件`);
  expect(result.complete).toBe(false);
  expect(result.outcome).toBe("unknown");
  expect(
    result.events.find((e) => e.kind === "healing")?.actual?.value,
  ).toBeNull();
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
}[];
const fixture = (id: number) => {
  const value = fixtures.find((row) => row.id === id);
  if (!value) {
    throw new Error(`缺少原文 ${id}`);
  }
  return value;
};
const parse = (id: number, text = fixture(id).text) => {
  const { id: messageId, date, revision, originalSourceId } = fixture(id);
  return parseCombatEvents(text, {
    messageId,
    date,
    revision,
    originalSourceId,
    observedAt: NOW,
  });
};
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("764549 原生先機後神吸實補656、主吸實補0；依輸出順序而非技能文案", () => {
  const result = parse(764549);
  expect(result).toMatchObject({
    format: "native_skill",
    complete: true,
    outcome: "ongoing",
    battleId: null,
    target: "地脈古蠕·堤豐",
    riskVerified: false,
  });
  const heals = result.events.filter((event) => event.kind === "healing");
  expect(heals).toMatchObject([
    {
      nominal: { value: 1118, basis: "observed" },
      actual: { value: 656, basis: "derived" },
    },
    {
      nominal: { value: 5215, basis: "observed" },
      actual: { value: 0, basis: "derived" },
    },
  ]);
  expect(
    result.events.find((event) => event.kind === "initiative"),
  ).toMatchObject({ actual: { value: 656, basis: "observed" } });
});

test("677625 原生先回血後燃血再反擊；未知首次治療前HP不倒推，傷害上限只記觀測", () => {
  const result = parse(677625);
  expect(result.complete).toBe(true);
  const changes = result.events.filter((event) =>
    ["healing", "hp_cost", "counter"].includes(event.kind),
  );
  expect(changes.map((event) => event.kind)).toEqual([
    "healing",
    "hp_cost",
    "counter",
  ]);
  expect(changes[0].actual).toEqual({ value: null, basis: "unknown" });
  expect(changes[1].actual).toEqual({ value: 456, basis: "observed" });
  expect(changes[2].actual).toEqual({ value: 69, basis: "observed" });
  expect(result.riskVerified).toBe(false);
});

test("677954 原生護盾保留0～3保守界線，不用19%或滿血名補推未來生存", () => {
  const result = parse(677954);
  expect(result).toMatchObject({
    complete: true,
    shield: { remainingHits: null, bounds: { min: 0, max: 3 } },
  });
  expect(
    result.events.find((event) => event.kind === "healing")?.actual,
  ).toEqual({ value: null, basis: "unknown" });
  expect(result.target).toBeNull();
});

test("764551 追加、已計入真傷、毒傷與荊棘依原文保留，不把91毒再次加到734反擊", () => {
  const result = parse(764551);
  expect(result.complete).toBe(true);
  expect(
    result.events.find((event) => event.kind === "counter")?.actual?.value,
  ).toBe(734);
  expect(
    result.events.find((event) => event.kind === "included_damage"),
  ).toMatchObject({ nominal: { value: 372 }, actual: { value: null } });
  expect(
    result.events.find((event) => event.kind === "damage_component"),
  ).toMatchObject({ nominal: { value: 91 }, actual: { value: null } });
});

test("764553 正式勝利才計6837G；0HP無結算、未知行、錯HP或多段加總矛盾一律不計", () => {
  expect(parse(764553)).toMatchObject({
    complete: true,
    outcome: "won",
    rewardGold: { value: 6837, basis: "observed" },
  });
  for (const text of [
    fixture(764553).text.replace(/^💀.*\n/mu, ""),
    `${fixture(764553).text}\n未知追加費用`,
    fixture(764549).text.replace("HP：3040/3040", "HP：4000/3040"),
    fixture(764549).text.replace("共 14901 傷害", "共 14900 傷害"),
    fixture(764553).text.replace("金幣 +6,837", "金幣 +6,83"),
    `${fixture(764553).text}\n${fixture(764553)
      .text.split("\n")
      .find((line) => line.startsWith("💀"))}`,
  ]) {
    const result = parse(764553, text);
    expect(result.rewardGold.value).toBeNull();
    expect(result.outcome).not.toBe("won");
  }
});

test("原生正式回執接入對帳，未結算即使現金差相符也不閉帳；不送遊戲指令", async () => {
  for (const settled of [true, false]) {
    const app = workflowHarness();
    const before = app.seed();
    const text = settled
      ? fixture(764553).text
      : fixture(764553).text.replace(/^💀.*\n/mu, "金幣 +6,837\n");
    app.observe(text, "/skill 熊力衝擊");
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    app.observe(statusText("測試熊", 900, 60, 7837), "/status");
    app.observe(inventoryText(), "/inventory all");
    const after = app.store.capture();
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
    });
    expect(result.state).toBe(settled ? "confirmed" : "needs_observation");
    expect(result.data.credits).toBe(settled ? 6837 : 0);
    expect(app.sent).toEqual([]);
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});

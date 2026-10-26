import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

const row = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat-819038.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
};
const parse = (text = row.text) =>
  parseCombatEvents(text, {
    messageId: row.id,
    date: row.date,
    revision: row.revision,
    originalSourceId: row.originalSourceId,
    observedAt: row.date * 1000,
  });
const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("819038獨立共鳴與塔庇護只保存註記，依原文明示反擊扣HP", () => {
  const result = parse();
  expect(result).toMatchObject({
    complete: true,
    outcome: "ongoing",
    riskVerified: false,
    unknownLines: [],
    issues: [],
    shield: null,
    battleId: null,
  });
  expect(
    result.events.find((e) => e.kind === "resonance_stacks")?.nominal?.value,
  ).toBe(5);
  expect(
    result.events.find((e) => e.kind === "resonance_percent")?.nominal?.value,
  ).toBe(60);
  expect(
    result.events.find((e) => e.description?.startsWith("🛡️ 星塔庇護")),
  ).toMatchObject({
    kind: "effect",
    nominal: { value: 1520, basis: "observed" },
    actual: { value: null, basis: "unknown" },
  });
  expect(result.events.find((e) => e.kind === "counter")).toMatchObject({
    actual: { value: 1520 },
    hpAfter: { value: 1520 },
    maxHp: { value: 3040 },
  });
  expect(
    result.events.find((e) => e.kind === "healing")?.actual?.value,
  ).toBeNull();
  expect(
    result.events.find((e) => e.kind === "reflection")?.actual?.value,
  ).toBe(1523);
  expect(result.rewardGold.value).toBeNull();
});

test.each([
  ["（🌟星淵共鳴×5+60%）", "（🌟星淵共鳴×9007199254740992+60%）"],
  ["（🌟星淵共鳴×5+60%）", "（🌟星淵共鳴×5+6,0%）"],
  ["（🌟星淵共鳴×5+60%）", "（🌟星淵共鳴×5+60%）未知"],
  ["至多 1,520", "至多 1,52"],
  ["至多 1,520", "至多 9007199254740992"],
  ["上限的 50%", "上限的 101%"],
  ["上限的 50%", "上限的 5,0%"],
  ["上限的 50%", "上限的 9007199254740992%"],
  ["上限的 50%）", "上限的 50%）未知"],
])("未知註記或異常數字仍阻擋：%s", (from, to) => {
  const result = parse(row.text.replace(from, to));
  expect(result.complete).toBe(false);
  expect(result.outcome).toBe("unknown");
  expect(result.rewardGold.value).toBeNull();
  expect(result.riskVerified).toBe(false);
});

test("未知尾文與不一致HP不因新註記而放行", () => {
  for (const text of [
    `${row.text}\n未知費用`,
    row.text.replace("HP：1520/3040", "HP：1521/3040"),
  ]) {
    expect(parse(text).complete).toBe(false);
  }
});

test("共用Game→帳本可更新本輪MP330及HP1520，不把庇護列當額外扣血或勝利", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  // 以完整status建立與原生回執一致的本人上限及MP，不借表頭／效果補零。
  const status = statusText("測試熊", 1000, 100).replace(
    "HP：1000/1000　MP：100/100",
    "HP：3040/3040　MP：362/422",
  );
  await h.act("/status", status);
  const result = await h.act("/skill 血怒亂斬", row.text);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    confirmedMpCost: 32,
    mpAfter: 330,
    hpAfter: 1520,
    complete: true,
  });
  expect(h.projection().account).toMatchObject({
    mpSpent: 32,
    credits: 0,
    mp: { value: 330 },
    hp: { value: 1520 },
  });
});

test("未知行仍只確認獨立32MP成本，不補造餘額", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  await h.act("/status", statusText());
  const result = await h.act("/skill 血怒亂斬", `${row.text}\n未知事件`);
  expect(result.accounting).toMatchObject({
    confirmedMpCost: 32,
    mpAfter: null,
    hpAfter: null,
    complete: false,
  });
});

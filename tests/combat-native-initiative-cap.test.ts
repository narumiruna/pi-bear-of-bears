import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

const row = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-combat-819046.json", import.meta.url),
    "utf8",
  ),
) as {
  id: number;
  date: number;
  revision: string;
  originalSourceId: string;
  text: string;
};
const cap = "🛡️ 星塔庇護：單次傷害至多 1,520（你血量上限的 50%）";
const incoming = "你受到 1520 點傷害。HP：1520/3040";
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

test("819046先機→庇護註記→實傷不是缺段；兩次1520、名實補分開", () => {
  const result = parse();
  expect(result).toMatchObject({
    complete: true,
    outcome: "ongoing",
    target: "星影·冥界守衛",
    issues: [],
    unknownLines: [],
    shield: null,
    riskVerified: false,
  });
  expect(
    result.events
      .filter((e) =>
        ["initiative_marker", "effect", "initiative"].includes(e.kind),
      )
      .slice(0, 3)
      .map((e) => e.kind),
  ).toEqual(["initiative_marker", "effect", "initiative"]);
  expect(
    result.events
      .filter((e) => ["initiative", "counter"].includes(e.kind))
      .map((e) => e.actual?.value),
  ).toEqual([1520, 1520]);
  expect(
    result.events
      .filter((e) => e.kind === "healing")
      .map((e) => e.actual?.value),
  ).toEqual([1520, 0]);
  expect(result.events.filter((e) => e.description === cap)).toHaveLength(2);
  expect(result.rewardGold.value).toBeNull();
});

test.each([
  row.text.replace(`${incoming}\n`, ""),
  row.text.replace(incoming, "🌀 你閃過了 其他王 的攻擊！"),
  row.text.replace(cap, "效果：未知"),
  row.text.replace(cap, "（🌟星淵共鳴×5+60%）"),
  row.text.replace(cap, "🛡️ 新護盾！接下來 3 次受擊減傷 24%"),
  row.text.replace(cap, `${cap}\n未知事件`),
  row.text.replace(cap, cap.replace("50%", "101%")),
  row.text.replace(cap, cap.replace("1,520", "9007199254740992")),
  row.text.replace(cap, `${cap}未知尾文`),
])("僅允許精確庇護註記，不跳過缺實傷、錯目標、其他效果或未知行", (text) => {
  const result = parse(text);
  expect(result.complete).toBe(false);
  expect(result.outcome).toBe("unknown");
  expect(result.rewardGold.value).toBeNull();
  expect(result.riskVerified).toBe(false);
});

test("Game→帳本保留同手先機與反擊，MP238、HP1520，不重扣提示上限", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  const status = statusText().replace(
    "HP：900/1000　MP：60/100",
    "HP：3040/3040　MP：270/422",
  );
  await h.act("/status", status);
  const result = await h.act("/skill 血怒亂斬", row.text);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    complete: true,
    confirmedMpCost: 32,
    hpAfter: 1520,
    mpAfter: 238,
  });
  expect(h.projection().account).toMatchObject({
    mpSpent: 32,
    hp: { value: 1520 },
    mp: { value: 238 },
    credits: 0,
  });
});

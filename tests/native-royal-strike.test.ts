import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

const raw = readFileSync(
  new URL("./fixtures/native-royal-strike-831574.txt", import.meta.url),
  "utf8",
).trimEnd();
const marker = "👑 🌟星主·冰縛女妖 王者重擊！";
const parse = (text = raw) =>
  parseCombatEvents(text, {
    messageId: 831574,
    revision: "fixture",
    date: 1793088791,
    observedAt: 1793088793101,
  });
const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("831574王者重擊僅註記，不另計傷害或安全資格", () => {
  const r = parse();
  expect(r).toMatchObject({
    complete: true,
    target: "🌟星主·冰縛女妖",
    unknownLines: [],
    issues: [],
    riskVerified: false,
  });
  expect(r.events.find((e) => e.description === marker)).toMatchObject({
    kind: "effect",
    line: 7,
  });
  expect(r.events.filter((e) => e.kind === "counter")).toMatchObject([
    {
      nominal: { value: 1520 },
      actual: { value: 1520 },
      hpAfter: { value: 1520 },
    },
  ]);
});

test("Game到ledger恢復資源推導，僅扣32MP", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  await h.act(
    "/status",
    statusText().replace(
      "HP：900/1000　MP：60/100",
      "HP：3040/3040　MP：270/422",
    ),
  );
  const r = await h.act("/skill 血怒亂斬", raw);
  expect(r.accounting).toMatchObject({
    complete: true,
    confirmedMpCost: 32,
    mpAfter: 238,
    hpAfter: 1520,
  });
  expect(h.projection().account?.mpSpent).toBe(32);
});

test.each([
  raw.replace(marker, `${marker}\n${marker}`),
  raw.replace(marker, marker.replace("王者重擊", "未知重擊")),
  raw.replace(marker, `${marker}（未知）`),
  `${raw.replace(marker, "")}\n${marker}`,
  `✨ 使用技能：血怒亂斬（MP -32）\n${marker}`,
  raw.replace(
    "🩸 吸血！",
    "💨 另一隻怪 搶得先機！\n你受到 1520 點傷害。HP：1520/3040\n🩸 吸血！",
  ),
])("未知／重複／錯序／目標矛盾仍拒絕：%#", (text) => {
  expect(parse(text)).toMatchObject({ complete: false, riskVerified: false });
});

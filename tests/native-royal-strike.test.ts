import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseCombatEvents } from "../src/combat-events.js";

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

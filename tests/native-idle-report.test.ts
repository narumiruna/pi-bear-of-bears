import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { ledgerWatch } from "../src/ledger-channel.js";
import {
  idleReportFacts,
  isOtherCharacterIdleReport,
} from "../src/workflow-events.js";
import { ledgerHarness, skillText } from "./fixtures/ledger.js";

const report = readFileSync(
  new URL("./fixtures/native-idle-819614.txt", import.meta.url),
  "utf8",
).trimEnd();
const opened: ReturnType<typeof ledgerHarness>[] = [];
const setup = () => {
  const h = ledgerHarness();
  opened.push(h);
  h.install();
  h.seed("なるみ_狂戰熊");
  return h;
};
afterEach(() => {
  for (const h of opened.splice(0)) {
    h.close();
  }
});

test("819614完整詳細通知保留角色、實際金幣及結算窗", () => {
  expect(idleReportFacts(report)).toEqual({
    character: "なるみ",
    gold: 66012,
    experience: 2380080,
    settlementWindow: "1 小時 0 分",
    format: "native",
  });
  expect(
    isOtherCharacterIdleReport(report, "🐺 なるみ_狂戰熊　狂戰熊 二轉Lv80"),
  ).toBe(true);
  expect(isOtherCharacterIdleReport(report, "🔮 なるみ　法熊")).toBe(false);
});

test("同批多怪通知仍以標題角色分帳", () => {
  const sword = report
    .replace("【🔮 なるみ】", "【🗡️ なるみ_劍聖熊】")
    .replace("5 天 18 小時", "2 天 10 小時")
    .replace(
      "　🪨星屑潛伏者 ×298　💫隕核星靈 ×233",
      "　🐝小蜜蜂 ×311　🐻黑熊盜賊 ×185　🌹食人花 ×57　🍄蘑菇巨人 ×52　🐗草原野豬 ×39",
    )
    .replace("2380080", "24973")
    .replace("66,012", "3,279");
  expect(idleReportFacts(sword)).toMatchObject({
    character: "なるみ_劍聖熊",
    gold: 3279,
    experience: 24973,
  });
});

test("他角原生詳細通知不清除本人MP，不切角、不併收入且重讀不重計", async () => {
  const h = setup();
  const result = await h.act("/skill 血怒亂斬", [report, skillText()]);
  expect(result.accounting).toMatchObject({
    state: "confirmed",
    mpAfter: 68,
    confirmedMpCost: 32,
  });
  expect(h.projection().account).toMatchObject({
    character: "なるみ_狂戰熊",
    credits: 0,
    gold: { value: 1000 },
    mp: { value: 68 },
  });
  expect(h.projection("なるみ").account?.credits).toBe(66012);
  ledgerWatch(h.messages);
  await h.game.history();
  expect(h.projection("なるみ").account?.credits).toBe(66012);
  expect(h.projection().account?.mp.value).toBe(68);
});

test("同角色詳細通知仍使HP與MP未知，不由掛機報告推目前資源", async () => {
  const h = setup();
  const own = report.replace("【🔮 なるみ】", "【🐺 なるみ_狂戰熊】");
  await h.act("/skill 血怒亂斬", [own, skillText()]);
  expect(h.projection().account).toMatchObject({
    credits: 66012,
    mp: { value: null },
  });
});

const invalid = [
  `${report}\n交易成功，金幣已變更。`,
  report.split("\n").slice(0, -1).join("\n"),
  report.replace(
    "　🧭 路線：隕鐵原 → 微光坑緣 → 失重淺谷 → 慢時之地 → …（+6）\n",
    "",
  ),
  report.replace("66,012", "9007199254740992"),
  report.replace("2380080", "-1"),
  report.replace("×298", "×9007199254740992"),
  report.replace("×3", "×9007199254740992"),
  report.replace("×3", "×-1"),
  report.replace("×3", "×未知"),
  report.replace("119 件", "9007199254740992 件"),
  report.replace("18 小時", "24 小時"),
  report.replace("1 小時 0 分", "1 小時 60 分"),
  report.replace("【🔮 なるみ】", "【🔮】"),
  report.replace("10 個地點", "0 個地點"),
  report.replace("　✨ 撿到 🪓永恆戰斧", "操作已完成"),
];
test.each(invalid)("未知、缺行或數值非法的詳細通知不批准略過：%#", (text) => {
  expect(idleReportFacts(text)).toBeNull();
  expect(isOtherCharacterIdleReport(text, "🐺 なるみ_狂戰熊　狂戰熊")).toBe(
    false,
  );
});

test("未知尾文仍使本人資源失效", async () => {
  const h = setup();
  await h.act("/skill 血怒亂斬", [invalid[0], skillText()]);
  expect(h.projection().account?.mp.value).toBeNull();
  expect(h.projection("なるみ").account).toBeNull();
});

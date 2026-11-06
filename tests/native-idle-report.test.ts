import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import {
  idleReportFacts,
  isOtherCharacterIdleReport,
} from "../src/workflow-events.js";
import { WorkflowObservations } from "../src/workflow-observations.js";
import { towerFacts } from "../src/workflow-parsers.js";
import { statusText } from "./fixtures/workflow.js";

const report = readFileSync(
  new URL("./fixtures/native-idle-819614.txt", import.meta.url),
  "utf8",
).trimEnd();

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

const liveBatch = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-idle-959420.json", import.meta.url),
    "utf8",
  ),
) as { messages: GameMessage[] };
const hourlyReport = liveBatch.messages.find((entry) => entry.id === 959420);
if (!hourlyReport) {
  throw new Error("fixture 缺少 959420 原生掛機報告。");
}
const hourlyText = hourlyReport.text;

afterEach(() => vi.restoreAllMocks());

test("959420 未滿一天的詳細報告保留所屬角色、金幣及結算窗", () => {
  expect(idleReportFacts(hourlyText)).toEqual({
    character: "なるみ_劍聖熊",
    gold: 18285,
    experience: 135167,
    settlementWindow: "1 小時 20 分",
    format: "native",
  });
  expect(
    isOtherCharacterIdleReport(hourlyText, "🐺 なるみ_狂戰熊　狂戰熊 二轉Lv80"),
  ).toBe(true);
  expect(
    isOtherCharacterIdleReport(hourlyText, "🗡️ なるみ_劍聖熊　劍聖熊 二轉Lv80"),
  ).toBe(false);
});

test.each(["1 小時 20 分", "23 小時 59 分"])(
  "合成小時／分鐘邊界保留既有詳細格式：%s",
  (duration) => {
    expect(
      idleReportFacts(hourlyText.replace("11 小時 45 分", duration)),
    ).toMatchObject({ character: "なるみ_劍聖熊", gold: 18285 });
  },
);

test.each([
  "0 小時 45 分",
  "24 小時 45 分",
  "11 小時 60 分",
  "9007199254740992 小時 45 分",
  "11 天 45 分",
])("未知或非法時長仍拒絕：%s", (duration) => {
  expect(
    idleReportFacts(hourlyText.replace("11 小時 45 分", duration)),
  ).toBeNull();
});

test.each([
  `${hourlyText}\n本人獲得金幣：100G`,
  hourlyText.split("\n").slice(0, -1).join("\n"),
])("小時格式不放寬未知尾行／缺行保護：%#", (text) => {
  expect(idleReportFacts(text)).toBeNull();
});

test("原生 tower 同批三角通知不失效；合成本角通知仍使資源失效", () => {
  // 控制狀態為合成；同批 tower／三角通知保留原文、日期及 revision。
  vi.spyOn(Date, "now").mockReturnValue(1793934932000);
  const store = new WorkflowObservations();
  store.observe(
    [
      {
        ...liveBatch.messages[0],
        id: 959415,
        date: 1793934927,
        text: statusText("なるみ_狂戰熊", 1000, 100, 416073),
        revision: "synthetic-current-status",
      },
    ],
    "/status",
  );
  expect(store.status()?.value.name).toBe("なるみ_狂戰熊");
  store.observe(liveBatch.messages, "/tower");
  expect(store.status()?.value.name).toBe("なるみ_狂戰熊");
  const tower = store.latest((entry) => towerFacts(entry.text));
  expect(tower?.value).toMatchObject({ floor: 104, hp: 9143237 });
  const point = store.capture(tower ? [tower.source] : []);
  expect(() => store.assertCurrent(point.id, "なるみ_狂戰熊")).not.toThrow();
  store.observe([
    {
      ...hourlyReport,
      id: 959421,
      text: hourlyText.replace("なるみ_劍聖熊", "なるみ_狂戰熊"),
      revision: "synthetic-own-report",
    },
  ]);
  expect(store.status()).toBeUndefined();
  expect(store.statusInvalidation()).toMatchObject({
    kind: "own_resource_report",
    messageId: 959421,
  });
});

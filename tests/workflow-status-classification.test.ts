import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { statusFacts } from "../src/workflow-parsers.js";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

// 合成混合訊息只測試不可略過未知尾文，不冒稱已取得世界公告 native 格式。
test.each([
  "未知世界結算尾文",
  "🚪 出口：北", // 不能因局部 roomFacts 可解析而繞過不完整 status。
  "世界王分寶資格預告\n獲得金幣：100G",
  "【測試熊】\n🐾 掛機 1 小時，金幣 +100G",
])("局部 status 可供研究，混合資源／未知尾文仍不可成為可信查詢：%s", (tail) => {
  const app = workflowHarness();
  const point = app.seed();
  const mixed = app.observe(`${statusText()}\n${tail}`, "/status");
  expect(statusFacts(mixed)?.name).toBe("測試熊");
  expect(app.store.status()).toBeUndefined();
  expect(app.store.inventory()).toBeUndefined();
  expect(app.store.invalidationEvent()).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: mixed.id,
  });
  expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
  expect(app.sent).toEqual([]);
});

test.each(["金幣：9999", "位置：別處", "EXP：滿級", "ATK：9999 (9999+0)"])(
  "重複資源或屬性欄位不能任選第一個成為可信 status：%s",
  (duplicate) => {
    const app = workflowHarness();
    app.seed();
    app.observe(`${statusText()}\n${duplicate}`, "/status");
    expect(app.store.status()).toBeUndefined();
    expect(app.store.invalidationEvent()?.kind).toBe("unknown_bot_reply");
    expect(app.sent).toEqual([]);
  },
);

test.each([
  "character-status.txt",
  "character-status-berserker-769232.txt",
  "character-status-berserker-798299.txt",
])(
  "已保存原生 status 的裝備特效、滿級／預估與掛機說明仍可讀：%s",
  (filename) => {
    const app = workflowHarness();
    const body = readFileSync(
      new URL(`./fixtures/${filename}`, import.meta.url),
      "utf8",
    );
    const reply = app.observe(body, "/status");
    expect(app.store.status()?.source.messageId).toBe(reply.id);
    expect(app.sent).toEqual([]);
  },
);

const setStatus = readFileSync(
  new URL("./fixtures/character-status-berserker-798299.txt", import.meta.url),
  "utf8",
);
const setLine = setStatus
  .split("\n")
  .find((line) => line.startsWith("🎽 套裝加成："));
if (!setLine) {
  throw new Error("原生 fixture 缺少套裝加成行");
}

test("原生套裝狀態可綁本人快照，但不由描述改寫屬性或產生操作", () => {
  const app = workflowHarness();
  const reply = app.observe(setStatus, "/status");
  expect(app.store.status()?.value).toMatchObject({
    name: "なるみ_狂戰熊",
    gold: 10034860,
    hp: 3040,
    mp: 422,
    attributes: { ATK: 3759, DEF: 5710, INT: 520, AGI: 798 },
  });
  expect(app.store.status()?.source.messageId).toBe(reply.id);
  const point = app.store.capture();
  expect(() =>
    app.store.assertCurrent(point.id, "なるみ_狂戰熊"),
  ).not.toThrow();
  expect(app.sent).toEqual([]);
});

test.each([
  `${setStatus}\n${setLine}`,
  `${setStatus}\n未知世界結算尾文`,
  setStatus.replace(setLine, "🎽 套裝加成：未知世界結算"),
  setStatus.replace("×3件", "×0件"),
  setStatus.replace(
    "🎽 /gear 看逐部位裝備",
    "🎽 /gear 看逐部位裝備\n金幣：9999",
  ),
])("新套裝行不略過重複欄位、錯誤結構或未知尾文：%s", (body) => {
  const app = workflowHarness();
  app.seed();
  app.observe(body, "/status");
  expect(app.store.status()).toBeUndefined();
  expect(app.store.invalidationEvent()?.kind).toBe("unknown_bot_reply");
  expect(app.sent).toEqual([]);
});

test("缺少本人 DEF 時，不能從裝備特效描述擷取數字補值", () => {
  const app = workflowHarness();
  const partial = app.observe(
    `${statusText().replace("　DEF：10 (10+0)", "")}\n🔴 裝備特效：未確認條件 DEF：9999`,
    "/status",
  );
  expect(statusFacts(partial)?.attributes.DEF).toBeNull();
  expect(app.store.status()?.value.attributes.DEF).toBeNull();
  expect(app.sent).toEqual([]);
});

test("既有 replay 的預估與掛機行保留，不將未列屬性補零", () => {
  const app = workflowHarness();
  app.observe(`${statusText()}\n含掛機預估\n🐾 掛機中`, "/status");
  expect(app.store.status()?.value).toMatchObject({
    estimated: true,
    idle: true,
  });
  expect(app.sent).toEqual([]);
});

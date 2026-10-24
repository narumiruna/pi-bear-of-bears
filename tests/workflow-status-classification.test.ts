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

test.each(["character-status.txt", "character-status-berserker-769232.txt"])(
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

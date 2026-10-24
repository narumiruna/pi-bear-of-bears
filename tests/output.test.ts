import { expect, test } from "vitest";
import { compactBearsOutput } from "../src/compact-context.js";
import { structuredPreview } from "../src/output.js";

test("結構化預覽保留完整項目、警告與原始分頁資訊", () => {
  const value = {
    messages: Array.from({ length: 30 }, (_, id) => ({
      id,
      text: "熊".repeat(1000),
    })),
    nextOffset: 30,
    warning: "結果未知，不可重試",
  };
  const original = structuredClone(value);
  const text = structuredPreview(value, "/tmp/example.json");
  if (text === undefined) {
    throw new Error("應產生結構化預覽");
  }
  const result = JSON.parse(text);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(45_000);
  expect(result.truncated).toBe(true);
  expect(result.fullOutputPath).toBe("/tmp/example.json");
  expect(result.preview.messages).toEqual(
    value.messages.slice(0, 30 - result.omittedItems),
  );
  expect(result.preview.warning).toBe(value.warning);
  expect(result.preview.nextOffset).toBe(30);
  expect(value).toEqual(original);
  expect(JSON.parse(compactBearsOutput(text))).toEqual(result);
});

test("巢狀資料省略整列，保留歷史資格警示、分頁及列內來源", () => {
  const items = Array.from({ length: 30 }, (_, id) => ({
    id,
    text: "熊".repeat(1000),
    sources: [{ messageId: id + 1, revision: "fixture" }],
  }));
  const value = {
    actor: "前角",
    data: {
      items,
      historicalContext: { currentCharacter: "目前角", budgetEligible: false },
      actionable: false,
      nextOffset: 30,
    },
  };
  const original = structuredClone(value);
  const text = structuredPreview(value, "/tmp/example.json");
  if (!text) {
    throw new Error("巢狀陣列應可安全縮小");
  }
  const result = JSON.parse(text);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(45000);
  expect(result.truncated).toBe(true);
  expect(result.preview.data).toMatchObject({
    actionable: false,
    nextOffset: 30,
    historicalContext: { currentCharacter: "目前角", budgetEligible: false },
  });
  expect(result.preview.data.items).toEqual(
    items.slice(0, 30 - result.omittedItems),
  );
  expect(result.preview.data.items[0].sources).toEqual(items[0].sources);
  expect(value).toEqual(original);
  expect(JSON.parse(compactBearsOutput(text))).toEqual(result);
});

test("小型結果完整保留，無法安全縮小的本文交回文字預覽", () => {
  expect(structuredPreview({ ok: true }, "unused")).toBe('{"ok":true}');
  expect(
    structuredPreview({ text: "熊".repeat(20_000) }, "unused"),
  ).toBeUndefined();
});

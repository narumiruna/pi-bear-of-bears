import { readFile } from "node:fs/promises";
import type {
  ContextEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import extension from "../extensions/compact-context.js";
import { compactBearsOutput, compactGameText } from "../src/compact-context.js";

const bot = {
  id: 42,
  outgoing: false,
  date: 123,
  revision: "a".repeat(64),
  text: "HP：90/90\n─────────────────\n\n🐾 掛機中 — /stopidle",
  buttons: [{ row: 0, column: 1, text: "⚡連擊", kind: "callback" }],
  hasMedia: false,
};

function transform(messages: ContextEvent["messages"]) {
  let handler:
    | ((event: ContextEvent) => { messages: ContextEvent["messages"] })
    | undefined;
  extension({
    on(name: string, callback: typeof handler) {
      expect(name).toBe("context");
      handler = callback;
    },
  } as ExtensionAPI);
  if (!handler) throw new Error("未註冊 context handler");
  return handler({ type: "context", messages }).messages;
}

function result(toolName = "bears_history", isError = false) {
  return {
    role: "toolResult" as const,
    toolName,
    toolCallId: "call-1",
    timestamp: 123,
    isError,
    content: [{ type: "text" as const, text: JSON.stringify([bot], null, 2) }],
    details: { original: bot },
  };
}

test("精簡裝飾並保留數值、預估註記、位置與掛機狀態", async () => {
  const text = await readFile("tests/fixtures/character-status.txt", "utf8");
  const compact = compactGameText(text);
  expect(compact).not.toContain("───");
  expect(compact).not.toContain("▱");
  expect(compact).toContain("Lv10 5%");
  expect(compact).toContain("閃1% 連0% 暴0%");
  expect(compact).toContain("含掛機預估");
  expect(compact).toContain("位置：🌫️ 腐葉溝壑");
  expect(compact).toContain("掛機中（森林小徑）— /stopidle 結算");
  expect(compactGameText(compact)).toBe(compact);
});

test("JSON 精簡不刪欄位、按鈕文字或送出的指令", () => {
  const value = {
    messages: [bot, { ...bot, outgoing: true }],
    note: "結果未知，不可重試",
    nextOffset: null,
  };
  const original = JSON.stringify(value, null, 2);
  const compact = compactBearsOutput(original);
  expect(compact.length).toBeLessThan(original.length);
  expect(JSON.parse(compact)).toEqual({
    ...value,
    messages: [{ ...bot, text: compactGameText(bot.text) }, value.messages[1]],
  });
  expect(compactBearsOutput(compact)).toBe(compact);
});

test("未知符號與沒有百分比的進度條不刪除", () => {
  const text = "✅ ❌ ⚠️\n❤️ 10\nLv10 ▱▱▱\n傷害 -12 +3 1/2 → 北\n/skill_1";
  expect(compactGameText(text)).toBe(text);
});

test.each([
  "錯誤：不可重試",
  '{"text":"未完整',
  '{\n  "id": 1\n}\n[Output truncated. Full private game output: /tmp/result.json.]',
])("無法解析時原樣保留：%s", (text) => {
  expect(compactBearsOutput(text)).toBe(text);
});

test("context hook 不修改原始訊息，保留圖片、metadata 與工具配對", () => {
  const message = result();
  const image = { type: "image" as const, data: "AA==", mimeType: "image/png" };
  const source = { ...message, content: [...message.content, image] };
  const snapshot = structuredClone(source);
  const [compact] = transform([source]);
  expect(source).toEqual(snapshot);
  expect(compact).toEqual({
    ...source,
    content: [
      { type: "text", text: compactBearsOutput(message.content[0].text) },
      image,
    ],
  });
});

test("僅處理指定工具與 bears-watch，不碰使用者、其他工具或錯誤", () => {
  const untouched = [
    result("read"),
    result("bears_unknown"),
    result("bears_send", true),
    { role: "user" as const, content: bot.text, timestamp: 0 },
  ];
  expect(transform(untouched)).toEqual(untouched);
  for (const tool of [
    "bears_history",
    "bears_send",
    "bears_click",
    "bears_world",
  ]) {
    expect(transform([result(tool)])[0]).not.toEqual(result(tool));
  }
  for (const content of [JSON.stringify([bot], null, 2), result().content]) {
    const watch = {
      role: "custom" as const,
      customType: "bears-watch",
      content,
      display: true,
      timestamp: 0,
    };
    expect(transform([watch])[0]).not.toEqual(watch);
    const other = { ...watch, customType: "other" };
    expect(transform([other])).toEqual([other]);
  }
});

import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ExtensionAPI,
  SessionManager,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { STRUCTURED_TOOL_NAMES } from "../src/game-commands.js";
import { originalPage, registerOriginalTool } from "../src/original.js";
import { toolResult } from "../src/output.js";

test("巢狀 codemode 工具原文獨立保存，即使父腳本失敗仍可查閱且遵守分支隔離", async () => {
  const session = SessionManager.inMemory();
  const root = session.appendMessage({
    role: "user",
    content: "測試",
    timestamp: 0,
  });
  let handler: (event: ToolResultEvent) => unknown = () => undefined;
  registerOriginalTool({
    on: (_name: string, callback: typeof handler) => {
      handler = callback;
    },
    appendEntry: (type: string, data: unknown) =>
      session.appendCustomEntry(type, data),
    registerTool: () => undefined,
  } as unknown as ExtensionAPI);
  const result = await toolResult({ messages: [{ text: "完整巢狀原文🐻" }] });
  const sourceId = result.details.bearsOriginal.sourceId;
  const event: ToolResultEvent = {
    type: "tool_result",
    toolName: "bears_history",
    toolCallId: "script/0",
    parentToolCallId: "script",
    input: {},
    isError: false,
    ...result,
  };
  handler({ ...event, parentToolCallId: undefined });
  expect(() => originalPage(session.getBranch(), sourceId)).toThrow("找不到");
  handler({ ...event, toolName: "read" } as ToolResultEvent);
  expect(() => originalPage(session.getBranch(), sourceId)).toThrow("找不到");
  handler(event);
  expect(originalPage(session.getBranch(), sourceId).text).toBe(
    result.details.bearsOriginal.text,
  );
  // Nested results do not appear as transcript toolResult messages.
  expect(
    session.getBranch().filter((entry) => entry.type === "message"),
  ).toHaveLength(1);
  session.branch(root);
  expect(() => originalPage(session.getBranch(), sourceId)).toThrow("找不到");
});

test("原文跨分頁精確還原，分支隔離，watch 原文可查閱", async () => {
  const session = SessionManager.inMemory();
  const value = [{ text: "熊🐻\n─────────\n⚡連10%" }];
  const result = await toolResult(value);
  const id = result.details.bearsOriginal.sourceId;
  const entryId = session.appendMessage({
    role: "toolResult",
    toolName: "bears_history",
    toolCallId: "call-1",
    timestamp: 0,
    isError: false,
    ...result,
  });
  let offset = 0;
  let restored = "";
  for (;;) {
    const page = originalPage(session.getBranch(), id, offset, 3);
    restored += page.text;
    if (page.nextOffset === null) {
      break;
    }
    offset = page.nextOffset;
  }
  expect(restored).toBe(JSON.stringify(value, null, 2));
  const watch = await toolResult({ messages: value });
  session.appendCustomMessageEntry(
    "bears-watch",
    watch.content,
    true,
    watch.details,
  );
  expect(
    originalPage(session.getBranch(), watch.details.bearsOriginal.sourceId)
      .text,
  ).toBe(watch.details.bearsOriginal.text);
  session.branch(entryId);
  expect(() =>
    originalPage(session.getBranch(), watch.details.bearsOriginal.sourceId),
  ).toThrow("找不到");
  expect(originalPage(session.getBranch(), id).text).toBe(restored);
});

test.each(["bears_optimize_equipment", "bears_public_character"])(
  "%s 的截斷輸出可由本分支原文完整還原，不依賴暫存檔",
  async (toolName) => {
    const session = SessionManager.inMemory();
    const root = session.appendMessage({
      role: "user",
      content: "合成測試資料",
      timestamp: 0,
    });
    const value = {
      entries: Array.from({ length: 100 }, (_, itemId) => ({
        itemId,
        text: "原文熊🐻".repeat(100),
      })),
      applicable: false,
    };
    const result = await toolResult(value);
    const preview = JSON.parse(result.content[0].text);
    expect(preview.truncated).toBe(true);
    expect(preview.omittedItems).toBeGreaterThan(0);
    // 只刪除本測試合成資料的暫存檔，證明查閱不讀檔。
    await rm(dirname(preview.fullOutputPath), {
      recursive: true,
      force: true,
    });
    session.appendMessage({
      role: "toolResult",
      toolName,
      toolCallId: `call-${toolName}`,
      timestamp: 0,
      isError: false,
      ...result,
    });
    const id = result.details.bearsOriginal.sourceId;
    let offset = 0;
    let restored = "";
    for (;;) {
      const page = originalPage(session.getBranch(), id, offset, 6000);
      restored += page.text;
      if (page.nextOffset === null) {
        break;
      }
      offset = page.nextOffset;
    }
    expect(restored).toBe(JSON.stringify(value, null, 2));
    session.branch(root);
    expect(() => originalPage(session.getBranch(), id)).toThrow("找不到");
  },
);

test.each(STRUCTURED_TOOL_NAMES)("%s 保留可查閱的原文", async (toolName) => {
  const session = SessionManager.inMemory();
  const result = await toolResult({ messages: [{ text: "合成遊戲回覆" }] });
  session.appendMessage({
    role: "toolResult",
    toolName,
    toolCallId: "structured",
    timestamp: 0,
    isError: false,
    ...result,
  });
  expect(
    originalPage(session.getBranch(), result.details.bearsOriginal.sourceId)
      .text,
  ).toBe(result.details.bearsOriginal.text);
});

test("拒絕未知來源、其他工具 metadata 與非法分頁", async () => {
  const session = SessionManager.inMemory();
  const result = await toolResult({ text: "原文" });
  const id = result.details.bearsOriginal.sourceId;
  session.appendMessage({
    role: "toolResult",
    toolName: "read",
    toolCallId: "other",
    timestamp: 0,
    isError: false,
    ...result,
  });
  expect(() => originalPage(session.getBranch(), id)).toThrow("找不到");
  expect(() => originalPage([], "/tmp/credentials")).toThrow("找不到");
  expect(() => originalPage([], id, -1)).toThrow("參數");
  expect(() => originalPage([], id, 0, 6001)).toThrow("參數");
});

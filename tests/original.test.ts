import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { originalPage } from "../src/original.js";
import { toolResult } from "../src/output.js";

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

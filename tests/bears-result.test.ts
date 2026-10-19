import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import {
  BEARS_RESULT_SCHEMA,
  decodeBearsResult,
  gameErrorResult,
  gameToolResult,
  registerResultDecoder,
} from "../src/bears-result.js";
import { toolResult } from "../src/output.js";
import { workflowResult } from "../src/workflow-result.js";
import { message } from "./fixtures/workflow.js";

const raw = {
  delivery: "submitted",
  observation: "bot_updates_observed",
  messages: [message(1, "無關更新")],
};
test("舊雙文字與新 structuredContent 的訊息、來源、語意一致；更新不等於成功", async () => {
  const old = await toolResult(raw);
  const decoded = decodeBearsResult(old);
  const modern = {
    ...decoded,
    originalSourceId: old.details.bearsOriginal.sourceId,
  };
  expect(decodeBearsResult({ structuredContent: modern })).toEqual(decoded);
  expect(decoded).toMatchObject({
    delivery: "submitted",
    outcome: "unknown",
    code: "OUTCOME_UNKNOWN",
    messages: raw.messages,
    complete: true,
  });
  expect(Check(BEARS_RESULT_SCHEMA, decoded)).toBe(true);
});
test("優先驗證結構化通道；不由壞通道回退成功文字", () => {
  expect(
    decodeBearsResult({
      structuredContent: { ok: true },
      content: [{ type: "text", text: JSON.stringify(raw) }],
    }),
  ).toMatchObject({ code: "INVALID_RESULT", complete: false });
});
test.each([
  "拒絕",
  '{"delivery":"submitted"}',
  '{"originalSourceId":"only"}',
  '{"messages":[',
  { ok: true },
  { messages: [{ id: 1, text: "不完整" }] },
])("非 JSON／不完整／source only 不推定成功：%j", (value) => {
  expect(decodeBearsResult(value)).toMatchObject({
    code: "INVALID_RESULT",
    outcome: "unknown",
    complete: false,
  });
});
test("截斷及只有 source ID 仍保留原文入口，不提升為成功", () => {
  expect(decodeBearsResult('{"originalSourceId":"only"}')).toMatchObject({
    originalSourceId: "only",
    complete: false,
    code: "INVALID_RESULT",
  });
  expect(
    decodeBearsResult('not JSON\n{"originalSourceId":"source"}'),
  ).toMatchObject({
    originalSourceId: "source",
    complete: false,
    code: "INVALID_RESULT",
  });
});

test("沒有更新保留 submitted；history 與流程維持不同 schema", async () => {
  expect(
    decodeBearsResult({ ...raw, observation: "no_update_yet", messages: [] }),
  ).toMatchObject({
    delivery: "submitted",
    observation: "no_update_yet",
    outcome: "unknown",
  });
  expect(decodeBearsResult(await toolResult(raw.messages))).toMatchObject({
    kind: "history",
    delivery: "not_applicable",
    messages: raw.messages,
  });
  const flow = workflowResult("測試熊");
  expect(decodeBearsResult({ structuredContent: flow })).toEqual(flow);
});
test("大型多頁回覆整則省略，完整原文不變，preview 不升為完整背包", async () => {
  const value = {
    ...raw,
    messages: Array.from({ length: 30 }, (_, id) =>
      message(id + 1, "熊".repeat(1000)),
    ),
  };
  const result = await gameToolResult(value);
  const text = result.content[0].text;
  const path = JSON.parse(text).fullOutputPath;
  try {
    expect(Check(BEARS_RESULT_SCHEMA, result.structuredContent)).toBe(true);
    expect(result.structuredContent.complete).toBe(false);
    expect(
      Buffer.byteLength(JSON.stringify(result.structuredContent)),
    ).toBeLessThanOrEqual(44_000);
    expect(result.structuredContent.messages.length).toBeLessThan(30);
    expect(decodeBearsResult(text)).toMatchObject({ complete: false });
    expect(decodeBearsResult(result.details.bearsOriginal.text)).toMatchObject({
      complete: true,
      messages: value.messages,
    });
  } finally {
    if (path) {
      await rm(dirname(path), { recursive: true, force: true });
    }
  }
});
test("共用 decoder 的大型輸出同樣有界；保留完整 metadata，不連線", async () => {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  registerResultDecoder({
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
  } as unknown as ExtensionAPI);
  const tool = tools.get("bears_decode_result");
  if (!tool) {
    throw new Error("缺少 decoder");
  }
  const value = {
    ...raw,
    messages: Array.from({ length: 30 }, (_, id) =>
      message(id + 1, "熊".repeat(1000)),
    ),
  };
  const output = await tool.execute(
    "decode",
    { result: value },
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
  const block = output.content[0];
  if (block.type !== "text") {
    throw new Error("缺少文字");
  }
  const path = JSON.parse(block.text).fullOutputPath;
  try {
    expect(
      Buffer.byteLength(JSON.stringify(output.structuredContent)),
    ).toBeLessThanOrEqual(44_000);
    expect(output.structuredContent).toMatchObject({ complete: false });
    expect(output.details).toHaveProperty("bearsOriginal.text");
  } finally {
    if (path) {
      await rm(dirname(path), { recursive: true, force: true });
    }
  }
});

test("送出前拒絕與送出後未知保持不同，取消不能宣稱未送出", async () => {
  for (const [error, delivery, code] of [
    [
      "Action was not dispatched to the bot. cancelled",
      "not_dispatched",
      "NOT_DISPATCHED",
    ],
    [
      "Action may have reached the bot; outcome is unknown.",
      "unknown",
      "OUTCOME_UNKNOWN",
    ],
    ["cancelled", "unknown", "OUTCOME_UNKNOWN"],
  ]) {
    const result = await gameToolResult(gameErrorResult(new Error(error)));
    expect(result.structuredContent).toMatchObject({
      delivery,
      code,
      outcome: "unknown",
    });
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import {
  READONLY_RESULT_SCHEMA,
  readonlyToolResult,
} from "../src/bears-readonly-result.js";
import {
  decodeBearsResult,
  registerResultDecoder,
} from "../src/bears-result.js";

test("唯讀資料保留 root 欄位與原文字，新增輸出完整性及來源，不冒充遊戲結果", async () => {
  for (const value of [
    {
      source: "public fixture",
      fetchedAt: "2026-10-20T00:00:00Z",
      note: "非即時存活",
      rooms: [],
      total: 0,
      nextOffset: null,
    },
    {
      kind: "bosses",
      entries: [],
      note: "機率不是保證",
      evolution: [],
      total: 0,
      nextOffset: null,
    },
    {
      applicable: false,
      blockers: ["缺少 status"],
      recommendations: [],
      completeness: { declared: 4, listed: 3, complete: false },
    },
  ]) {
    const result = await readonlyToolResult(value);
    const data = result.structuredContent;
    expect(Check(READONLY_RESULT_SCHEMA, data)).toBe(true);
    expect(data).toMatchObject(value);
    expect(data).toMatchObject({
      resultKind: "read_only_data",
      outputComplete: true,
      outputReasons: [],
    });
    expect(data.originalSourceId).toBe(result.details.bearsOriginal.sourceId);
    expect(JSON.parse(result.content[0].text)).toEqual(value);
    expect(JSON.parse(result.details.bearsOriginal.text)).toEqual(value);
    expect(data).not.toHaveProperty("outcome");
    expect(data).not.toHaveProperty("state");
    expect(decodeBearsResult(result)).toEqual(data);
    expect(decodeBearsResult(data)).toEqual(data);
    expect(
      decodeBearsResult(`${JSON.stringify(data)}\n${result.content[1].text}`),
    ).toEqual(data);
  }
});

test("大型唯讀輸出不裁成可套用推薦或竄改游標，保留原文但明示整份 payload 省略", async () => {
  const value = {
    applicable: true,
    recommendations: [{ text: "熊".repeat(18000) }],
    nextOffset: 10,
    note: "未知效果",
  };
  const result = await readonlyToolResult(value);
  expect(result.structuredContent).toMatchObject({
    resultKind: "read_only_data",
    outputComplete: false,
  });
  expect(result.structuredContent.outputReasons.length).toBeGreaterThan(0);
  expect(result.structuredContent).not.toHaveProperty("applicable");
  expect(result.structuredContent).not.toHaveProperty("recommendations");
  expect(result.structuredContent).not.toHaveProperty("nextOffset");
  expect(
    Buffer.byteLength(JSON.stringify(result.structuredContent)),
  ).toBeLessThanOrEqual(44000);
  expect(JSON.parse(result.details.bearsOriginal.text)).toEqual(value);
  // 舊文字通道可能建立 overflow；清理測試建立的暫存檔。
  const preview = JSON.parse(result.content[0].text);
  if (preview.fullOutputPath) {
    await rm(join(preview.fullOutputPath, ".."), {
      recursive: true,
      force: true,
    });
  }
});

test("唯讀結構化通道錯誤不回退文字；中繼欄位由 formatter 決定，不採 payload 的假來源", async () => {
  const result = await readonlyToolResult({
    resultKind: "command",
    originalSourceId: "fake",
    outputComplete: false,
    source: "fixture",
  });
  expect(result.structuredContent.outputComplete).toBe(true);
  expect(result.structuredContent.originalSourceId).not.toBe("fake");
  expect(
    decodeBearsResult({
      ...result,
      structuredContent: {
        ...result.structuredContent,
        outputComplete: "true",
      },
    }),
  ).toMatchObject({ code: "INVALID_RESULT", complete: false });
});

test("decoder 不將 kind=bosses 當作 game messages；手動巨大物件也受輸出上限保護", async () => {
  let decoder: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  registerResultDecoder({
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      decoder = tool;
    },
  } as unknown as ExtensionAPI);
  if (!decoder) {
    throw new Error("缺少 decoder");
  }
  const small = (await readonlyToolResult({ kind: "bosses", entries: [] }))
    .structuredContent;
  const output = await decoder.execute(
    "test",
    { result: small },
    undefined,
    undefined,
    {} as never,
  );
  expect(output.structuredContent).toEqual(small);
  const huge = await decoder.execute(
    "test",
    { result: { ...small, entries: [{ payload: "熊".repeat(18000) }] } },
    undefined,
    undefined,
    {} as never,
  );
  expect(huge.structuredContent).toMatchObject({
    outputComplete: false,
    originalSourceId: small.originalSourceId,
  });
  expect(huge.structuredContent).not.toHaveProperty("entries");
  const preview = JSON.parse(
    huge.content[0].type === "text" ? huge.content[0].text : "null",
  );
  if (preview.fullOutputPath) {
    await rm(join(preview.fullOutputPath, ".."), {
      recursive: true,
      force: true,
    });
  }
});

test("實際 extension loader：五個查詢 tools 都有 schema，optimizer 本機回傳且不登入", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-readonly-loader-"));
  try {
    const loaded = await discoverAndLoadExtensions(
      [resolve("extensions/bears.ts"), resolve("extensions/codex-public.ts")],
      directory,
      directory,
    );
    expect(loaded.errors).toEqual([]);
    const definitions = new Map(
      loaded.extensions.flatMap((extension) =>
        [...extension.tools].map(
          ([name, entry]) => [name, entry.definition] as const,
        ),
      ),
    );
    for (const name of [
      "bears_world",
      "bears_codex",
      "bears_public_character",
      "bears_optimize_equipment",
      "bears_life_codex",
    ]) {
      const tool = definitions.get(name);
      expect(tool?.outputSchema, name).toBeDefined();
      expect(tool?.annotations?.readOnlyHint, name).toBe(true);
    }
    const tool = definitions.get("bears_optimize_equipment");
    if (!tool) {
      throw new Error("缺少 optimizer");
    }
    const output = await tool.execute(
      "test",
      {},
      undefined,
      undefined,
      {} as never,
    );
    expect(Check(READONLY_RESULT_SCHEMA, output.structuredContent)).toBe(true);
    expect(output.structuredContent).toMatchObject({
      outputComplete: true,
      resultKind: "read_only_data",
      recommendations: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createCodemodeExtension,
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";
import { gameToolResult } from "../src/bears-result.js";
import { toolResult } from "../src/output.js";
import { message, statusText } from "./fixtures/workflow.js";

test("實際 loader 與 Codemode worker：新 command 是 object、舊文字經共用 decoder；details 不外洩", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-codemode-loader-"));
  const loaded = await discoverAndLoadExtensions(
    [resolve("extensions/bears.ts")],
    directory,
    directory,
  );
  await rm(directory, { recursive: true, force: true });
  expect(loaded.errors).toEqual([]);
  const tools = new Map(
    [...loaded.extensions[0].tools].map(([name, tool]) => [
      name,
      tool.definition,
    ]),
  );
  const api = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    getAllTools: () => [...tools.values()],
    getSettings: () => ({}),
  } as unknown as ExtensionAPI;
  createCodemodeExtension({ models: false })(api);
  const raw = {
    delivery: "submitted",
    observation: "bot_updates_observed",
    messages: [message(1, statusText())],
  };
  const legacy = await toolResult(raw);
  const oldText = legacy.content.map((block) => block.text).join("\n");
  const executeTool = vi.fn(async (name: string, args: unknown) => {
    const definition = tools.get(name);
    if (!definition) {
      throw new Error("missing tool");
    }
    const result =
      name === "bears_status"
        ? await gameToolResult(raw)
        : await definition.execute(
            "nested",
            args,
            undefined,
            undefined,
            context,
          );
    if (!definition.outputSchema) {
      throw new Error("missing outputSchema");
    }
    expect(Check(definition.outputSchema, result.structuredContent)).toBe(true);
    return {
      toolCall: { id: "nested", name, arguments: args },
      result,
      isError: false,
    };
  });
  const context = {
    tools: [...tools.values()],
    executeTool,
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionToolContext;
  const codemode = tools.get("codemode");
  if (!codemode) {
    throw new Error("missing codemode");
  }
  const output = await codemode.execute(
    "smoke",
    {
      code: `const command = await tools.bears_status({}); const old = await tools.bears_decode_result({result:${JSON.stringify(oldText)}}); const read = await tools.bears_optimize_equipment({}); const decodedRead = await tools.bears_decode_result({result:read}); return {readType:typeof read, readKind:read.resultKind, readComplete:read.outputComplete, sameRead:JSON.stringify(read)===JSON.stringify(decodedRead), type:typeof command, delivery:command.delivery, outcome:command.outcome, sameMessages:JSON.stringify(command.messages)===JSON.stringify(old.messages), complete:command.complete, source:typeof command.originalSourceId, detailsVisible:command.details!==undefined};`,
    },
    undefined,
    undefined,
    context,
  );
  const visible = output.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  expect(visible).toContain("Script completed");
  expect(visible).toContain('"type":"object"');
  expect(visible).toContain('"sameMessages":true');
  expect(visible).toContain('"outcome":"unknown"');
  expect(visible).toContain('"detailsVisible":false');
  expect(visible).toContain('"readType":"object"');
  expect(visible).toContain('"readKind":"read_only_data"');
  expect(visible).toContain('"readComplete":true');
  expect(visible).toContain('"sameRead":true');
  expect(executeTool.mock.calls.map(([name]) => name)).toEqual([
    "bears_status",
    "bears_decode_result",
    "bears_optimize_equipment",
    "bears_decode_result",
  ]);
}, 30000);

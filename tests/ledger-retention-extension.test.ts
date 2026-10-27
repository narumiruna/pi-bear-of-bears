import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import * as retention from "../src/ledger-retention.js";
import { registerLedgerRetention } from "../src/ledger-retention-extension.js";
import { RecordsStore } from "../src/records-store.js";
import { ledgerHarness } from "./fixtures/ledger.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const h of open.splice(0)) {
    h.close();
  }
});
async function setup() {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  h.seed();
  for (let n = 0; n < 8; n++) {
    await h.act("/skill 血怒亂斬");
  }
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const sendMessage = vi.fn();
  registerLedgerRetention(
    {
      on: (
        name: string,
        fn: (event: unknown, ctx: ExtensionContext) => unknown,
      ) => handlers.set(name, fn),
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
      sendMessage,
    } as unknown as ExtensionAPI,
    () => h.runtime,
  );
  const ctx = {
    cwd: h.directory,
    hasUI: false,
    model: { id: "synthetic" },
    modelRegistry: { streamSimple: vi.fn() },
  } as unknown as ExtensionToolContext;
  vi.stubEnv("BEARS_RECORDS_PATH", join(h.directory, "records.sqlite"));
  const call = async () => {
    const tool = tools.get("bears_ledger_compact");
    if (!tool) {
      throw new Error("missing");
    }
    const result = await tool.execute("test", {}, undefined, undefined, ctx);
    expect(
      tool.outputSchema && Check(tool.outputSchema, result.structuredContent),
    ).toBe(true);
    return result;
  };
  const emit = (name: string) => handlers.get(name)?.({}, ctx);
  return { h, ctx, tools, emit, call, sendMessage };
}
test("未明確啟用時factory／安全邊界不開紀錄庫、不呼叫模型或觸發Goal", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "0");
  await h.emit("session_start");
  await h.emit("agent_before_settle");
  expect(existsSync(join(h.h.directory, "records.sqlite"))).toBe(false);
  expect(h.ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
  await expect(h.call()).rejects.toThrow(/尚未啟用/u);
  expect(h.sendMessage).not.toHaveBeenCalled();
});
test("低於門檻不呼叫模型，not_needed也符合輸出schema", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "1");
  RecordsStore.initialize(join(h.h.directory, "records.sqlite")).close();
  const result = await h.call();
  expect(result.structuredContent).toMatchObject({
    version: 1,
    operationalEligibility: false,
    data: { state: "not_needed" },
  });
  expect(h.ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
});

test("壓縮不自建遺失的個人紀錄庫、不呼叫模型或刪原事件", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "1");
  const count = h.h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n;
  const result = await h.call();
  expect(result).toMatchObject({
    isError: true,
    structuredContent: {
      data: { state: "stopped", reason: expect.stringContaining("不存在") },
    },
  });
  expect(existsSync(join(h.h.directory, "records.sqlite"))).toBe(false);
  expect(h.ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
  expect(h.h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n).toBe(
    count,
  );
});

test("唯讀候選分頁固定snapshot，切樹失效且不呼叫模型", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "0");
  const original = retention.prepareRetention;
  vi.spyOn(retention, "prepareRetention").mockImplementation((store) =>
    original(store, 1),
  );
  const tool = h.tools.get("bears_ledger_compaction_preview");
  if (!tool) {
    throw new Error("missing");
  }
  const first = await tool.execute(
    "preview",
    { limit: 2 },
    undefined,
    undefined,
    h.ctx,
  );
  const data = (
    first.structuredContent as {
      data: { snapshot: string; nextOffset: number; eventIds: number[] };
    }
  ).data;
  expect(data.eventIds).toHaveLength(2);
  const next = await tool.execute(
    "preview",
    { snapshot: data.snapshot, offset: data.nextOffset, limit: 2 },
    undefined,
    undefined,
    h.ctx,
  );
  expect(
    (
      next.structuredContent as { data: { eventIds: number[] } }
    ).data.eventIds.some((id) => data.eventIds.includes(id)),
  ).toBe(false);
  await h.emit("session_tree");
  await expect(
    tool.execute(
      "preview",
      { snapshot: data.snapshot, offset: data.nextOffset },
      undefined,
      undefined,
      h.ctx,
    ),
  ).rejects.toThrow(/snapshot/u);
  expect(h.ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
});

test("自動摘要失敗只嘗試一次，不觸發Agent續行或刪原文", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "1");
  RecordsStore.initialize(join(h.h.directory, "records.sqlite")).close();
  const original = retention.prepareRetention;
  vi.spyOn(retention, "prepareRetention").mockImplementation((store) =>
    original(store, 1),
  );
  const prepare = h.h.store.db.prepare.bind(h.h.store.db);
  vi.spyOn(h.h.store.db, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql === "SELECT COUNT(*) n FROM events") {
      vi.spyOn(statement, "get").mockReturnValue({ n: 180000 });
    }
    return statement;
  });
  vi.mocked(h.ctx.modelRegistry.streamSimple).mockImplementation(
    () =>
      ({
        result: () =>
          Promise.resolve({
            content: [{ type: "text", text: "invalid json" }],
            usage: {
              input: 1,
              output: 1,
              totalTokens: 2,
              cacheRead: 0,
              cacheWrite: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
          }),
      }) as ReturnType<typeof h.ctx.modelRegistry.streamSimple>,
  );
  const sent = vi.mocked(h.h.bot.send).mock.calls.length;
  await h.emit("agent_before_settle");
  await h.emit("agent_before_settle");
  expect(h.ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
  expect(h.sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: false });
  const schema = h.tools.get("bears_ledger_compact")?.outputSchema;
  if (!schema) {
    throw new Error("missing");
  }
  expect(
    Check(schema, JSON.parse(h.sendMessage.mock.calls[0][0].content)),
  ).toBe(true);
  expect(
    h.h.store.db.prepare("SELECT COUNT(*) n FROM ledger_compactions").get()?.n,
  ).toBe(0);
  expect(h.h.bot.send).toHaveBeenCalledTimes(sent);
});

test("切樹取消正在執行的子模型；不重複spawn、不刪原資料", async () => {
  const h = await setup();
  vi.stubEnv("BEARS_LEDGER_RETENTION", "1");
  RecordsStore.initialize(join(h.h.directory, "records.sqlite")).close();
  const original = retention.prepareRetention;
  vi.spyOn(retention, "prepareRetention").mockImplementation((store) =>
    original(store, 1),
  );
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(h.ctx.modelRegistry.streamSimple).mockImplementation(
    (_model, _input, options) =>
      ({
        result: () =>
          new Promise((_resolve, reject) => {
            started();
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      }) as ReturnType<typeof h.ctx.modelRegistry.streamSimple>,
  );
  const count = h.h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n;
  const pending = h.call();
  await ready;
  await expect(h.call()).rejects.toThrow(/已有壓縮工作/u);
  await h.emit("session_tree");
  expect(await pending).toMatchObject({ isError: true });
  expect(h.h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n).toBe(
    count,
  );
  expect(
    h.h.store.db.prepare("SELECT COUNT(*) n FROM ledger_compactions").get()?.n,
  ).toBe(0);
  expect(h.ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
});

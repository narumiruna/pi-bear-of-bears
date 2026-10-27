import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createCodemodeExtension,
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionToolContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import extension from "../extensions/ledger.js";
import { ledgerOperationIds, withLedgerCall } from "../src/ledger-channel.js";
import { ledgerHarness, skillText } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

type Handler = (event: unknown, context: ExtensionCommandContext) => unknown;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function directory() {
  const path = mkdtempSync(
    join(realpathSync(tmpdir()), "bears-ledger-extension-"),
  );
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function setup(hasUI = false) {
  const root = directory(),
    sm = SessionManager.inMemory(root);
  const handlers = new Map<string, Handler>(),
    tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>(),
    commands = new Map<
      string,
      Parameters<ExtensionAPI["registerCommand"]>[1]
    >();
  const sendMessage = vi.fn(),
    notify = vi.fn();
  const ctx = {
    hasUI,
    cwd: root,
    sessionManager: sm,
    ui: { notify },
  } as unknown as ExtensionCommandContext;
  extension({
    on: (key: string, handler: Handler) => handlers.set(key, handler),
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerCommand: (
      name: string,
      command: Parameters<ExtensionAPI["registerCommand"]>[1],
    ) => commands.set(name, command),
    appendEntry: (name: string, data: unknown) =>
      sm.appendCustomEntry(name, data),
    sendMessage,
  } as unknown as ExtensionAPI);
  const emit = (name: string, event: unknown = {}) =>
    handlers.get(name)?.(event, ctx);
  cleanups.push(() => {
    emit("session_shutdown");
  });
  const call = async (
    name: string,
    args: unknown = {},
    signal?: AbortSignal,
  ) => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error("缺 tool");
    }
    if (!Check(tool.parameters, args)) {
      throw new Error("invalid schema");
    }
    const result = await tool.execute(
      "read-only",
      args,
      signal,
      undefined,
      ctx as unknown as ExtensionToolContext,
    );
    expect(
      tool.outputSchema && Check(tool.outputSchema, result.structuredContent),
    ).toBe(true);
    return result.structuredContent;
  };
  return {
    root,
    sm,
    tools,
    emit,
    call,
    sendMessage,
    notify,
    command: (args: string) => commands.get("bears-ledger")?.handler(args, ctx),
  };
}
function enable(root: string) {
  vi.stubEnv("BEARS_LEDGER", "1");
  vi.stubEnv("BEARS_LEDGER_DIR", join(root, "ledger"));
}

test.each([false, true])(
  "TUI=%s factory 只註冊；未啟用、啟用及 shutdown 均不自動連線或續行",
  async (hasUI) => {
    const h = setup(hasUI);
    expect(readdirSync(h.root)).toEqual([]);
    expect(h.tools.size).toBe(6);
    vi.stubEnv("BEARS_LEDGER", "0");
    h.emit("session_start");
    expect(await h.call("bears_ledger_status")).toMatchObject({
      enabled: false,
      operationalEligibility: false,
    });
    enable(h.root);
    h.emit("session_start");
    expect(await h.call("bears_ledger_status")).toMatchObject({
      enabled: true,
      character: null,
    });
    expect(h.sendMessage).not.toHaveBeenCalled();
    h.emit("session_shutdown");
    h.emit("session_shutdown");
    expect(await h.call("bears_ledger_status")).toMatchObject({
      enabled: false,
    });
  },
);

test.each([undefined, "custom"])(
  "根目錄覆寫 %s：確認身分前不建檔，之後使用單層完整 ID 檔名",
  async (override) => {
    const app = setup();
    vi.stubEnv("BEARS_LEDGER", "1");
    vi.stubEnv("PI_CODING_AGENT_DIR", join(app.root, ".pi", "agent"));
    vi.stubEnv(
      "BEARS_LEDGER_DIR",
      override ? join(app.root, override) : undefined,
    );
    app.emit("session_start");
    expect(await app.call("bears_ledger_status")).toMatchObject({
      enabled: true,
      diagnostics: expect.arrayContaining([expect.stringContaining("等待")]),
    });
    expect(readdirSync(app.root)).toEqual([]);
    const h = ledgerHarness();
    cleanups.push(() => h.close());
    Object.defineProperty(h.bot, "telegramUserId", {
      value: "9007199254740993",
    });
    h.add(statusText());
    await h.game.history();
    const root = override
      ? join(app.root, override)
      : join(app.root, ".pi", "agent", "bear-of-bears");
    expect(existsSync(join(root, "9007199254740993.sqlite"))).toBe(true);
    expect(existsSync(join(root, "by-telegram-id"))).toBe(false);
    expect(app.sm.getBranch()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customType: "bears-ledger-ref",
          data: expect.objectContaining({
            version: 1,
            account: "telegram-9007199254740993",
          }),
        }),
      ]),
    );
    expect(h.bot.send).not.toHaveBeenCalled();
  },
);

test("初始化失敗時 action 送出前拒絕；唯讀 history 不被 DB 阻斷", async () => {
  const app = setup(true);
  enable(app.root);
  vi.stubEnv("BEARS_LEDGER_DIR", "relative-path");
  app.emit("session_start");
  const h = ledgerHarness();
  cleanups.push(() => h.close());
  h.add(statusText());
  await expect(h.game.act({ text: "/status" })).rejects.toThrow(
    /not dispatched/u,
  );
  expect(await h.game.history()).toHaveLength(1);
  expect(h.bot.send).not.toHaveBeenCalled();
  expect(await app.call("bears_ledger_status")).toMatchObject({
    enabled: false,
    diagnostics: expect.arrayContaining([
      expect.stringContaining("初始化失敗"),
    ]),
  });
  expect(app.notify).toHaveBeenCalledOnce();
});

test("唯讀工具嚴格 schema、取消、原文分頁與 snapshot 保持一致；無 SQL／路徑入口", async () => {
  const app = setup();
  enable(app.root);
  app.emit("session_start");
  const h = ledgerHarness();
  cleanups.push(() => h.close());
  h.add(statusText());
  await h.game.history();
  await h.act("/skill 血怒亂斬");
  const status = (await app.call("bears_ledger_status")) as {
    resources: { mp: { source: { observationId: number } } };
  };
  const id = status.resources.mp.source.observationId;
  const first = (await app.call("bears_ledger_trace", {
    observationId: id,
    limit: 35,
  })) as { text: string; nextOffset: number | null; snapshot: string };
  let text = first.text,
    offset = first.nextOffset;
  // 新觀測與 metrics 不改已凍結的 trace 分頁。
  await h.game.history();
  while (offset !== null) {
    const page = (await app.call("bears_ledger_trace", {
      observationId: id,
      offset,
      limit: 6000,
      snapshot: first.snapshot,
    })) as typeof first;
    text += page.text;
    offset = page.nextOffset;
  }
  expect(JSON.parse(text).message.text).toBe(skillText());
  await expect(
    app.call("bears_ledger_trace", { observationId: id, offset: 10 }),
  ).rejects.toThrow(/snapshot/u);
  for (const args of [
    { sql: "DROP TABLE facts" },
    { path: "/private" },
    { character: "x", extra: 1 },
  ]) {
    await expect(app.call("bears_ledger_status", args)).rejects.toThrow(
      /schema/u,
    );
  }
  await expect(
    app.call("bears_ledger_trace", { observationId: 999999 }),
  ).rejects.toThrow(/目前分支/u);
  const controller = new AbortController();
  controller.abort();
  await expect(
    app.call("bears_ledger_status", {}, controller.signal),
  ).rejects.toThrow();
  app.emit("session_tree");
  await expect(
    app.call("bears_ledger_trace", {
      observationId: id,
      offset: 35,
      snapshot: first.snapshot,
    }),
  ).rejects.toThrow(/過期/u);
  expect(h.bot.send).toHaveBeenCalledOnce();
});

test("command 預覽不寫檔；backup／rebuild 不派送；文件匯出需要獨立明確指令", async () => {
  const app = setup();
  enable(app.root);
  mkdirSync(join(app.root, "docs", "goals"), { recursive: true });
  app.emit("session_start");
  const h = ledgerHarness();
  cleanups.push(() => h.close());
  h.add(statusText());
  await h.game.history();
  await app.command("export-write");
  expect(app.sendMessage.mock.calls.at(-1)?.[0].content).toContain(
    "先執行 export-preview",
  );
  await app.command("export-preview");
  expect(readdirSync(join(app.root, "docs", "goals"))).toEqual([]);
  await app.command("export-write");
  expect(readdirSync(join(app.root, "docs", "goals"))).toEqual([
    "bears-ledger-checkpoint.md",
  ]);
  await app.command("backup");
  await app.command("rebuild");
  expect(
    app.sendMessage.mock.calls.every(
      ([, options]) => options.triggerTurn === false,
    ),
  ).toBe(true);
});

test("實際 Pi jiti loader、共用接點、SessionManager ancestry 與 Codemode worker 離線整合", async () => {
  const root = directory();
  enable(root);
  const loaded = await discoverAndLoadExtensions(
    [resolve("extensions/ledger.ts"), resolve("extensions/bears.ts")],
    root,
    root,
  );
  expect(loaded.errors).toEqual([]);
  expect(readdirSync(root)).toEqual([]);
  const ledger = loaded.extensions[0],
    sm = SessionManager.inMemory(root);
  loaded.runtime.appendEntry = (name, data) => {
    sm.appendCustomEntry(name, data);
  };
  loaded.runtime.sendMessage = vi.fn();
  const ctx = {
    cwd: root,
    hasUI: false,
    sessionManager: sm,
  } as unknown as ExtensionToolContext;
  const emit = async (name: string) => {
    for (const handler of ledger.handlers.get(name) ?? []) {
      await handler({}, ctx);
    }
  };
  await emit("session_start");
  cleanups.push(() => {
    for (const handler of ledger.handlers.get("session_shutdown") ?? []) {
      void handler({}, ctx);
    }
  });
  const h = ledgerHarness();
  cleanups.push(() => h.close());
  h.add(statusText());
  await h.game.history();
  vi.mocked(h.bot.send).mockImplementationOnce(() => {
    h.add("/skill 血怒亂斬", true);
    h.add(skillText());
    return Promise.resolve();
  });
  const result = await withLedgerCall(
    { toolCallId: "parent/1", toolName: "bears_skill" },
    () => h.game.act({ text: "/skill 血怒亂斬" }),
  );
  expect(result.accounting).toMatchObject({ confirmedMpCost: 32, mpAfter: 28 }); // statusText 預設 60 MP
  expect(ledgerOperationIds("parent/1")).toHaveLength(1);
  const tools = new Map(
    [...ledger.tools].map(([name, tool]) => [name, tool.definition]),
  );
  const api = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    getAllTools: () => [...tools.values()],
    getSettings: () => ({}),
  } as unknown as ExtensionAPI;
  createCodemodeExtension({ models: false })(api);
  const context = {
    ...ctx,
    tools: [...tools.values()],
    executeTool: async (name: string, args: unknown) => {
      const definition = tools.get(name);
      if (!definition) {
        throw new Error("缺 tool");
      }
      const result = await definition.execute(
        "parent/2",
        args,
        undefined,
        undefined,
        context,
      );
      expect(
        definition.outputSchema &&
          Check(definition.outputSchema, result.structuredContent),
      ).toBe(true);
      return {
        toolCall: { id: "parent/2", name, arguments: args },
        result,
        isError: false,
      };
    },
  } as unknown as ExtensionToolContext;
  const codemode = tools.get("codemode");
  if (!codemode) {
    throw new Error("缺 codemode");
  }
  const output = await codemode.execute(
    "offline",
    {
      code: "const s=await tools.bears_ledger_status({}); const c=await tools.bears_ledger_checkpoint({}); const r=await tools.bears_ledger_report({limit:100}); return {mp:s.resources.mp.value,eligible:s.operationalEligibility,preview:typeof c.text,snapshot:typeof r.snapshot};",
    },
    undefined,
    undefined,
    context,
  );
  expect(output.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('"mp":28') }),
    ]),
  );
  expect(h.bot.send).toHaveBeenCalledOnce();
  expect(loaded.runtime.sendMessage).not.toHaveBeenCalled();
  await emit("session_shutdown");
}, 30000);

test("無帳號環境設定也預設啟用但不連線；舊手動標籤不影響 Telegram ID 自動對應", async () => {
  const app = setup();
  vi.stubEnv("BEARS_LEDGER", "");
  vi.stubEnv("BEARS_LEDGER_ACCOUNT", "../ignored-old-label");
  vi.stubEnv("BEARS_LEDGER_DIR", join(app.root, "ledger"));
  app.emit("session_start");
  expect(await app.call("bears_ledger_status")).toMatchObject({
    enabled: true,
    diagnostics: expect.arrayContaining([expect.stringContaining("等待")]),
  });
  expect(readdirSync(app.root)).toEqual([]);
  const h = ledgerHarness();
  cleanups.push(() => h.close());
  h.add(statusText());
  await h.game.history();
  expect(existsSync(join(app.root, "ledger", "100000001.sqlite"))).toBe(true);
  expect(await app.call("bears_ledger_status")).toMatchObject({
    enabled: true,
    diagnostics: [],
  });
  expect(h.bot.send).not.toHaveBeenCalled();
});

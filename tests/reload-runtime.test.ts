import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";
import extension from "../extensions/reload-runtime.js";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const commands = new Map<string, Command>();
  const tools = new Map<string, Tool>();
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const waitForIdle = vi.fn(() => Promise.resolve());
  const reload = vi.fn(() => Promise.resolve());
  const abort = vi.fn();
  const ctx = {
    waitForIdle,
    reload,
    abort,
  } as unknown as ExtensionCommandContext;
  let dispatched: Promise<void> | undefined;
  const command = () => {
    const registered = commands.get("reload-runtime");
    if (!registered) {
      throw new Error("缺少 reload-runtime command");
    }
    return registered.handler("", ctx);
  };
  const sendUserMessage = vi.fn<ExtensionAPI["sendUserMessage"]>(
    (content, options) => {
      if (content === "/reload-runtime" && options?.expandPromptTemplates) {
        dispatched = command();
      }
    },
  );
  extension({
    registerCommand: (name: string, value: Command) =>
      commands.set(name, value),
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, handler),
    sendUserMessage,
  } as unknown as ExtensionAPI);
  return {
    commands,
    tools,
    waitForIdle,
    reload,
    abort,
    sendUserMessage,
    command,
    dispatched: () => dispatched,
    turnEnd: () => handlers.get("turn_end")?.({}, ctx),
    request: (signal?: AbortSignal) => {
      const tool = tools.get("reload_runtime");
      if (!tool) {
        throw new Error("缺少 reload_runtime tool");
      }
      return tool.execute(
        "reload-test",
        {},
        signal,
        undefined,
        ctx as unknown as ExtensionToolContext,
      );
    },
  };
}

test("只註冊 reload command 與 codemode tool，拒絕額外參數", () => {
  const app = harness();
  expect([...app.commands.keys()]).toEqual(["reload-runtime"]);
  expect([...app.tools.keys()]).toEqual(["reload_runtime"]);
  const tool = app.tools.get("reload_runtime");
  if (!tool) {
    throw new Error("缺少 reload_runtime tool");
  }
  expect(tool.exposure).toBe("codemode");
  expect(Check(tool.parameters, {})).toBe(true);
  expect(Check(tool.parameters, { command: "/quit" })).toBe(false);
});

test("tool 明確派送 command，批次結束後才停止 Agent 並等待 idle reload", async () => {
  const app = harness();
  const idle = deferred();
  app.waitForIdle.mockReturnValue(idle.promise);
  const result = await app.request();
  expect(app.sendUserMessage).toHaveBeenCalledExactlyOnceWith(
    "/reload-runtime",
    { deliverAs: "followUp", expandPromptTemplates: true },
  );
  expect(result.details).toEqual({ status: "queued" });
  expect(result.content).toEqual([
    expect.objectContaining({ text: expect.stringContaining("不是完成證明") }),
  ]);
  expect(app.waitForIdle).toHaveBeenCalledOnce();
  expect(app.abort).not.toHaveBeenCalled();
  expect(app.reload).not.toHaveBeenCalled();

  app.turnEnd();
  expect(app.abort).toHaveBeenCalledOnce();
  expect(app.reload).not.toHaveBeenCalled();
  idle.resolve();
  await app.dispatched();
  expect(app.reload).toHaveBeenCalledOnce();
});

test("同一批次重複請求只派送一次，也不重複執行 command", async () => {
  const app = harness();
  const idle = deferred();
  app.waitForIdle.mockReturnValue(idle.promise);
  await app.request();
  await app.request();
  await app.command();
  expect(app.sendUserMessage).toHaveBeenCalledOnce();
  expect(app.waitForIdle).toHaveBeenCalledOnce();
  idle.resolve();
  await app.dispatched();
  expect(app.reload).toHaveBeenCalledOnce();
});

test("手動 command 在 idle 時直接 reload，不派送模型訊息或使用舊 runtime", async () => {
  const app = harness();
  await app.command();
  expect(app.waitForIdle).toHaveBeenCalledBefore(app.reload);
  expect(app.reload).toHaveBeenCalledOnce();
  expect(app.sendUserMessage).not.toHaveBeenCalled();
  expect(app.abort).not.toHaveBeenCalled();
});

test("未要求 reload 時，turn_end 不停止 Agent", () => {
  const app = harness();
  app.turnEnd();
  expect(app.abort).not.toHaveBeenCalled();
  expect(app.reload).not.toHaveBeenCalled();
});

test("已取消的 tool 不派送 command，也不停止 Agent", async () => {
  const app = harness();
  const reason = new Error("已取消");
  await expect(app.request(AbortSignal.abort(reason))).rejects.toBe(reason);
  app.turnEnd();
  expect(app.sendUserMessage).not.toHaveBeenCalled();
  expect(app.waitForIdle).not.toHaveBeenCalled();
  expect(app.abort).not.toHaveBeenCalled();
});

test.each(["waitForIdle", "reload"] as const)(
  "%s 失敗會保留錯誤，不自動重試；解除 pending 後可明確重送",
  async (operation) => {
    const app = harness();
    const error = new Error(`${operation} 失敗`);
    app[operation].mockRejectedValueOnce(error);
    await expect(app.command()).rejects.toBe(error);
    app.turnEnd();
    expect(app.abort).not.toHaveBeenCalled();
    expect(app[operation]).toHaveBeenCalledOnce();
    if (operation === "waitForIdle") {
      expect(app.reload).not.toHaveBeenCalled();
    }
    await app.command();
    expect(app[operation]).toHaveBeenCalledTimes(2);
    expect(app.reload).toHaveBeenCalled();
  },
);

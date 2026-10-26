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

function harness(sessionId = crypto.randomUUID(), branch: unknown[] = []) {
  const commands = new Map<string, Command>();
  const tools = new Map<string, Tool>();
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const waitForIdle = vi.fn(() => Promise.resolve());
  const reload = vi.fn(() => Promise.resolve());
  const abort = vi.fn();
  const emit = vi.fn();
  const ctx = {
    waitForIdle,
    reload,
    abort,
    sessionManager: {
      getSessionId: () => sessionId,
      getLeafId: () => (branch.at(-1) as { id?: string })?.id ?? null,
      getBranch: () => branch,
    },
    isIdle: () => true,
    hasUI: false,
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
    events: { emit },
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
    ctx,
    event: (name: string, event: unknown) => handlers.get(name)?.(event, ctx),
    waitForIdle,
    reload,
    abort,
    emit,
    sendUserMessage,
    command,
    dispatched: () => dispatched,
    turnEnd: () => handlers.get("turn_end")?.({}, ctx),
    beforeSettle: () => handlers.get("agent_before_settle")?.({}, ctx),
    toolCall: () => handlers.get("tool_call")?.({}, ctx),
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

test("新runtime須等完整reload成功才送一次continue，不使用失效舊API", async () => {
  const sessionId = crypto.randomUUID();
  const old = harness(sessionId);
  const fresh = harness(sessionId);
  const ready = deferred();
  const finish = deferred();
  old.reload.mockImplementation(async () => {
    await fresh.event("session_start", { reason: "reload" });
    fresh.event("session_start", { reason: "reload" });
    old.sendUserMessage.mockImplementation(() => {
      throw new Error("舊runtime已失效");
    });
    ready.resolve();
    await finish.promise;
  });
  const command = old.command();
  await ready.promise;
  expect(fresh.sendUserMessage).not.toHaveBeenCalled();
  finish.resolve();
  await command;
  expect(fresh.sendUserMessage).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("continue\n"),
    { deliverAs: "followUp" },
  );
  fresh.event("session_start", { reason: "reload" });
  expect(fresh.sendUserMessage).toHaveBeenCalledOnce();
});

test.each([
  "失敗",
  "切樹",
  "關閉",
  "新使用者輸入",
  "新使用者紀錄",
  "不同session",
  "分支不符",
  "舊runtime收到取消",
  "Goal狀態改變",
  "非閒置",
])("%s不得觸發reload續行，亦不留下可重播ticket", async (reason) => {
  const sessionId = crypto.randomUUID();
  const branch: unknown[] = [
    { id: "anchor", type: "custom", customType: "test" },
  ];
  const old = harness(sessionId, branch);
  const fresh = harness(
    reason === "不同session" ? crypto.randomUUID() : sessionId,
    reason === "分支不符" ? [] : branch,
  );
  old.reload.mockImplementation(async () => {
    await fresh.event("session_start", { reason: "reload" });
    if (reason === "切樹") {
      fresh.event("session_tree", {});
    }
    if (reason === "關閉") {
      fresh.event("session_shutdown", { reason: "exit" });
    }
    if (reason === "新使用者輸入") {
      fresh.event("input", { source: "interactive" });
    }
    if (reason === "新使用者紀錄") {
      branch.push({
        id: "new-user",
        type: "message",
        message: { role: "user" },
      });
    }
    if (reason === "舊runtime收到取消") {
      old.event("agent_settled", { aborted: true });
    }
    if (reason === "Goal狀態改變") {
      branch.push({
        id: "goal-changed",
        type: "custom",
        customType: "goal.state",
        data: { id: crypto.randomUUID(), status: "stopped" },
      });
    }
    if (reason === "非閒置") {
      fresh.ctx.isIdle = () => false;
    }
    if (reason === "失敗") {
      throw new Error("reload失敗");
    }
  });
  if (reason === "失敗") {
    await expect(old.command()).rejects.toThrow("reload失敗");
  } else {
    await old.command();
  }
  expect(fresh.sendUserMessage).not.toHaveBeenCalled();
  const later = harness(sessionId, branch);
  later.event("session_start", { reason: "reload" });
  await Promise.resolve();
  expect(later.sendUserMessage).not.toHaveBeenCalled();
});

test.each(["取消", "切分支"])("等待idle期間%s不交接續行", async (reason) => {
  const sessionId = crypto.randomUUID();
  const old = harness(sessionId);
  const fresh = harness(sessionId);
  const idle = deferred();
  old.waitForIdle.mockReturnValue(idle.promise);
  old.reload.mockImplementation(async () => {
    await fresh.event("session_start", { reason: "reload" });
  });
  const command = old.command();
  if (reason === "取消") {
    old.event("agent_settled", { aborted: true });
  } else {
    old.event("session_tree", {});
  }
  idle.resolve();
  await command;
  expect(old.reload).toHaveBeenCalledOnce();
  expect(fresh.sendUserMessage).not.toHaveBeenCalled();
});

test.each(["startup", "reload"])(
  "無ticket的%s不自行啟動Agent",
  async (reason) => {
    const fresh = harness();
    fresh.event("session_start", { reason });
    await Promise.resolve();
    expect(fresh.sendUserMessage).not.toHaveBeenCalled();
  },
);

test.each(["paused", "stopped", "completed"])(
  "既有%s Goal不因reload重新啟動",
  async (status) => {
    const sessionId = crypto.randomUUID();
    const branch = [
      {
        id: "goal",
        type: "custom",
        customType: "goal.state",
        data: { id: crypto.randomUUID(), status },
      },
    ];
    const old = harness(sessionId, branch);
    const fresh = harness(sessionId, branch);
    old.reload.mockImplementation(async () => {
      await fresh.event("session_start", { reason: "reload" });
    });
    await old.command();
    expect(fresh.sendUserMessage).toHaveBeenCalledOnce();
    expect(fresh.emit).not.toHaveBeenCalledWith(
      "runtime:reload-continue",
      expect.anything(),
    );
    expect(branch[0].data.status).toBe(status);
  },
);

test.each(["stopped", "completed", "replaced"])(
  "等待idle時Goal被%s不恢復",
  async (status) => {
    const sessionId = crypto.randomUUID();
    const state = { id: crypto.randomUUID(), status: "active" };
    const branch = [
      { id: "goal", type: "custom", customType: "goal.state", data: state },
    ];
    const old = harness(sessionId, branch);
    const fresh = harness(sessionId, branch);
    const idle = deferred();
    old.waitForIdle.mockReturnValue(idle.promise);
    old.reload.mockImplementation(async () => {
      await fresh.event("session_start", { reason: "reload" });
    });
    const command = old.command();
    state.status = status;
    if (status === "replaced") {
      state.id = crypto.randomUUID();
      state.status = "paused";
    }
    idle.resolve();
    await command;
    expect(fresh.sendUserMessage).not.toHaveBeenCalled();
  },
);

test("continue派送拋錯只嘗試一次，Goal收到暫停通知", async () => {
  const sessionId = crypto.randomUUID();
  const old = harness(sessionId);
  const fresh = harness(sessionId);
  fresh.sendUserMessage.mockImplementation(() => {
    throw new Error("派送失敗");
  });
  old.reload.mockImplementation(async () => {
    await fresh.event("session_start", { reason: "reload" });
  });
  await old.command();
  await Promise.resolve();
  expect(fresh.sendUserMessage).toHaveBeenCalledOnce();
  expect(fresh.emit).toHaveBeenCalledWith(
    "runtime:reload-continue-failed",
    expect.any(Object),
  );
});

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

test("tool 明確派送command並正常終止；不abort，等待idle才reload", async () => {
  const app = harness();
  const idle = deferred();
  app.waitForIdle.mockReturnValue(idle.promise);
  const result = await app.request();
  expect(app.sendUserMessage).toHaveBeenCalledExactlyOnceWith(
    "/reload-runtime",
    { deliverAs: "followUp", expandPromptTemplates: true },
  );
  expect(result.details).toEqual({ status: "queued" });
  expect(result.terminate).toBe(true);
  expect(app.emit).toHaveBeenCalledExactlyOnceWith(
    "runtime:reload-pending",
    true,
  );
  expect(result.content).toEqual([
    expect.objectContaining({ text: expect.stringContaining("不是完成證明") }),
  ]);
  expect(app.waitForIdle).toHaveBeenCalledOnce();
  expect(app.abort).not.toHaveBeenCalled();
  expect(app.reload).not.toHaveBeenCalled();

  app.turnEnd();
  expect(app.abort).not.toHaveBeenCalled();
  expect(app.beforeSettle()).toEqual({ continue: false });
  expect(app.toolCall()).toMatchObject({ block: true, terminate: true });
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
  expect(app.emit).toHaveBeenCalledOnce();
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
  expect(app.emit).not.toHaveBeenCalled();
  app.turnEnd();
  expect(app.sendUserMessage).not.toHaveBeenCalled();
  expect(app.waitForIdle).not.toHaveBeenCalled();
  expect(app.abort).not.toHaveBeenCalled();
});

test("reload失敗且舊runtime已失效時，清理事件不覆蓋原錯誤", async () => {
  const app = harness();
  const original = new Error("reload載入失敗");
  app.reload.mockRejectedValueOnce(original);
  app.emit.mockImplementation((_channel, pending) => {
    if (!pending) {
      throw new Error("舊runtime失效");
    }
  });
  await expect(app.command()).rejects.toBe(original);
  expect(app.reload).toHaveBeenCalledOnce();
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
    expect(app.emit.mock.calls).toEqual([
      ["runtime:reload-pending", true],
      ["runtime:reload-pending", false],
    ]);
    expect(app.beforeSettle()).toBeUndefined();
    expect(app.toolCall()).toBeUndefined();
    if (operation === "waitForIdle") {
      expect(app.reload).not.toHaveBeenCalled();
    }
    await app.command();
    expect(app[operation]).toHaveBeenCalledTimes(2);
    expect(app.reload).toHaveBeenCalled();
  },
);

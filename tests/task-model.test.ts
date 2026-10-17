import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
  ExtensionVirtualModel,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import extension from "../extensions/task-model.js";

interface State {
  profile: "fast" | "deep";
  reason: string;
  overrideId?: string;
}

function model(id: string, reasoning = true): Model<Api> {
  return {
    id,
    provider: "test",
    name: id,
    api: "openai-responses",
    baseUrl: "https://example.invalid",
    reasoning,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 16000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function harness() {
  const fast = model("small");
  const deep = model("large");
  const plain = model("plain", false);
  const virtual = {
    ...deep,
    provider: "task-router",
    id: "auto",
    api: "pi-virtual",
  } as Model<Api>;
  let available = [fast, deep, plain, virtual];
  let branch: Record<string, unknown>[] = [];
  let definition: ExtensionVirtualModel<State>;
  let command: Parameters<ExtensionAPI["registerCommand"]>[1];
  let tool: Parameters<ExtensionAPI["registerTool"]>[0];
  const events = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const notify = vi.fn();
  const status = vi.fn();
  const context = {
    hasUI: true,
    model: deep,
    sessionManager: { getBranch: () => branch },
    getContextUsage: () => ({
      tokens: 1000,
      contextWindow: 200000,
      percent: 0.5,
    }),
    modelRegistry: {
      getAvailable: () => available,
      find: (provider: string, id: string) =>
        available.find((m) => m.provider === provider && m.id === id),
    },
    ui: { notify, setStatus: status },
  } as unknown as ExtensionToolContext;
  const setModel = vi.fn((next: Model<Api>) => {
    context.model = next;
    return Promise.resolve(
      events.get("model_select")?.({ model: next, source: "set" }, context),
    ).then(() => true);
  });
  const setThinkingLevel = vi.fn();
  const api = {
    registerVirtualModel: (value: ExtensionVirtualModel<State>) => {
      definition = value;
    },
    registerCommand: (_name: string, value: typeof command) => {
      command = value;
    },
    registerTool: (value: typeof tool) => {
      tool = value;
    },
    appendEntry: (customType: string, data: unknown) => {
      branch.push({ type: "custom", customType, data });
    },
    setModel,
    setThinkingLevel,
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => events.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(api);
  return {
    fast,
    deep,
    plain,
    virtual,
    context,
    notify,
    status,
    setModel,
    setThinkingLevel,
    get branch() {
      return branch;
    },
    setBranch(next: Record<string, unknown>[]) {
      branch = next;
    },
    setAvailable(next: Model<Api>[]) {
      available = next;
    },
    reload() {
      extension(api);
    },
    event(name: string, source = "set") {
      return events.get(name)?.({ model: context.model, source }, context);
    },
    command(args: string) {
      return command.handler(
        args,
        context as unknown as ExtensionCommandContext,
      );
    },
    tool(
      profile: "fast" | "deep",
      reason = "下一步需要這個 profile",
      signal?: AbortSignal,
    ) {
      return tool.execute(
        "switch",
        { profile, reason },
        signal,
        undefined,
        context,
      );
    },
    route(request: Partial<ModelRouteRequest<State>> = {}) {
      return definition.route(
        {
          model: virtual,
          thinkingLevel: "off",
          reason: "user",
          messages: [
            { role: "user", content: "幫我查看角色清單", timestamp: 1 },
          ],
          ...request,
        },
        context,
      );
    },
    async setup() {
      await command.handler(
        "fast test/small low",
        context as unknown as ExtensionCommandContext,
      );
      await command.handler(
        "deep test/large high",
        context as unknown as ExtensionCommandContext,
      );
      await command.handler(
        "auto",
        context as unknown as ExtensionCommandContext,
      );
    },
  };
}

test("預設 model 不可用時不啟用、不猜 model；拒絕未知、無登入或 virtual profile", async () => {
  const app = harness();
  await app.command("auto");
  expect(app.setModel).not.toHaveBeenCalled();
  await app.command("fast missing/not-found low");
  await app.command("deep task-router/auto high");
  await app.command("fast test/small invalid");
  await app.command("fast test/small low extra");
  expect(app.branch).toHaveLength(0);
  expect(app.notify.mock.calls.every((call) => call[1] === "error")).toBe(true);
});

test("設定兩個 profile 才啟用；status 無副作用；off 回到 physical deep", async () => {
  const app = harness();
  await app.setup();
  expect(app.context.model).toBe(app.virtual);
  expect(app.branch).toHaveLength(3);
  await app.command("status");
  await app.command("");
  expect(app.notify.mock.lastCall?.[0]).toContain("fast: test/small");
  expect(app.branch).toHaveLength(3);
  await app.command("off");
  expect(app.context.model).toBe(app.deep);
  expect(app.setThinkingLevel).toHaveBeenCalledWith("high");
});

test("新請求依任務選 model 與 thinking，畫面顯示原因", async () => {
  const app = harness();
  await app.setup();
  const fast = await app.route();
  expect(fast).toMatchObject({
    model: app.fast,
    thinkingLevel: "low",
    state: { profile: "fast" },
  });
  expect(app.status.mock.lastCall?.[1]).toContain("例行查詢");
  const deep = await app.route({
    messages: [{ role: "user", content: "review extension", timestamp: 2 }],
  });
  expect(deep).toMatchObject({ model: app.deep, thinkingLevel: "high" });
});

test("continuation、retry 保留完整 pair，不依 toolResult 或模型文字降級", async () => {
  const app = harness();
  await app.setup();
  const initial = await app.route({
    messages: [{ role: "user", content: "分析", timestamp: 1 }],
  });
  for (const reason of ["continuation", "retry"] as const) {
    const result = await app.route({
      reason,
      state: initial.state,
      previous: { model: app.deep, thinkingLevel: "medium" },
      messages: [{ role: "user", content: "/status", timestamp: 1 }],
    });
    expect(result).toMatchObject({ model: app.deep, thinkingLevel: "medium" });
  }
});

test("retry 使用 failed pair，不做未授權的 provider fallback", async () => {
  const app = harness();
  await app.setup();
  const failed = { model: app.deep, thinkingLevel: "high" as const };
  const result = await app.route({
    reason: "retry",
    failed: failed as NonNullable<ModelRouteRequest<State>["failed"]>,
    previous: { model: app.fast, thinkingLevel: "low" },
  });
  expect(result).toMatchObject({ model: app.deep, thinkingLevel: "high" });
});

test("LLM tool 從下一個 continuation 切 model＋thinking；同批拒絕重複排程", async () => {
  const app = harness();
  await app.setup();
  const first = await app.route();
  const result = await app.tool("deep", "遇到未知機制，需要分析");
  expect(result.details).toMatchObject({
    scheduled: true,
    model: "test/large",
    thinking: "high",
  });
  // The selection remains virtual; no premature physical switch while a batch is executing.
  expect(app.setModel).toHaveBeenCalledTimes(1);
  await expect(app.tool("fast")).rejects.toThrow("已有待套用");
  const switched = await app.route({
    reason: "continuation",
    state: first.state,
    previous: first,
  });
  expect(switched).toMatchObject({
    model: app.deep,
    thinkingLevel: "high",
    state: { profile: "deep" },
  });
  expect(app.status.mock.lastCall?.[1]).toContain("LLM：遇到未知機制");
  const sticky = await app.route({
    reason: "continuation",
    state: switched.state,
    previous: switched,
  });
  expect(sticky.model).toBe(app.deep);
  await app.tool("fast", "分析完成，只剩唯讀查詢");
  const next = await app.route({
    reason: "continuation",
    state: switched.state,
    previous: switched,
  });
  expect(next).toMatchObject({ model: app.fast, thinkingLevel: "low" });
});

test("新的 user 請求重新分類；舊 tool 請求不會在後續 continuation 復活", async () => {
  const app = harness();
  await app.setup();
  await app.tool("deep");
  const user = await app.route();
  expect(user.model).toBe(app.fast);
  const next = await app.route({
    reason: "continuation",
    state: user.state,
    previous: user,
  });
  expect(next.model).toBe(app.fast);
});

test("manual model 覆寫後 tool 拒絕，off 不擅自更換 manual model", async () => {
  const app = harness();
  await app.setup();
  app.context.model = app.plain;
  await app.event("model_select");
  await expect(app.tool("deep")).rejects.toThrow("尊重手動");
  await app.command("off");
  expect(app.context.model).toBe(app.plain);
  expect(app.setModel).toHaveBeenCalledTimes(1);
});

test("設定與 LLM 請求跟隨 branch、reload；不讀取其他分支資料", async () => {
  const app = harness();
  await app.setup();
  const first = await app.route();
  await app.tool("deep");
  const original = [...app.branch];
  app.reload();
  const resumed = await app.route({
    reason: "continuation",
    state: first.state,
    previous: first,
  });
  expect(resumed.model).toBe(app.deep);
  app.setBranch([]);
  await app.event("session_tree");
  expect(() => app.route()).toThrow("未登入");
  app.setBranch(original);
  const restored = await app.route();
  expect(restored.model).toBe(app.fast);
});

test("direct 摘要使用 deep，但不吃掉待套用的 LLM 請求", async () => {
  const app = harness();
  await app.setup();
  const initial = await app.route();
  await app.tool("deep");
  expect((await app.route({ reason: "direct" })).model).toBe(app.deep);
  const next = await app.route({
    reason: "continuation",
    state: initial.state,
    previous: initial,
  });
  expect(next.model).toBe(app.deep);
});

test("無 reasoning 的 model 將 thinking 限制為 off；未登入就報錯，不回退", async () => {
  const app = harness();
  await app.setup();
  await app.command("fast test/plain high");
  expect(await app.route()).toMatchObject({
    model: app.plain,
    thinkingLevel: "off",
  });
  app.setAvailable([app.deep, app.virtual]);
  expect(() => app.route()).toThrow("未登入");
  await expect(app.tool("fast")).rejects.toThrow("未登入");
});

test("圖片與短續行安全地保留 deep；非互動模式不呼叫畫面 API", async () => {
  const app = harness();
  await app.setup();
  app.context.hasUI = false;
  app.status.mockClear();
  const image = await app.route({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "查看角色清單" },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
    ],
  });
  expect(image.model).toBe(app.deep);
  const followUp = await app.route({
    state: image.state,
    messages: [{ role: "user", content: "1", timestamp: 2 }],
  });
  expect(followUp.model).toBe(app.deep);
  expect(app.status).not.toHaveBeenCalled();
});

test("session_start 預設啟用 5.6 Luna low 與 Sol high", async () => {
  const app = harness();
  const luna = {
    ...model("gpt-5.6-luna"),
    provider: "openai-codex",
    contextWindow: 272000,
  };
  const sol = {
    ...model("gpt-6.1-sol"),
    provider: "openai-codex",
    contextWindow: 272000,
  };
  app.setAvailable([luna, sol, app.virtual]);
  expect(app.setModel).not.toHaveBeenCalled();
  await app.event("session_start");
  expect(app.context.model).toBe(app.virtual);
  expect(await app.route()).toMatchObject({
    model: luna,
    thinkingLevel: "low",
  });
  expect(
    await app.route({
      messages: [{ role: "user", content: "研究與決策", timestamp: 1 }],
    }),
  ).toMatchObject({ model: sol, thinkingLevel: "high" });
});

test("off 後 reload／resume 不重新啟用", async () => {
  const app = harness();
  await app.setup();
  await app.command("off");
  app.reload();
  await app.event("session_start");
  expect(app.context.model).toBe(app.deep);
  expect(app.setModel).toHaveBeenCalledTimes(2);
  await app.command("auto");
  expect(app.context.model).toBe(app.virtual);
  expect(app.setModel).toHaveBeenCalledTimes(3);
});

test("手動 model selection 停用狀態跨 reload 保留；restore 本身不寫停用狀態", async () => {
  const app = harness();
  await app.setup();
  app.context.model = app.plain;
  await app.event("model_select");
  app.reload();
  await app.event("session_start");
  expect(app.context.model).toBe(app.plain);
  expect(app.setModel).toHaveBeenCalledTimes(1);
  const count = app.branch.length;
  await app.event("model_select", "restore");
  expect(app.branch).toHaveLength(count);
});

test("startup profile 不可用時只警告，保留原 model；已啟用時不重複 setModel", async () => {
  const app = harness();
  await app.event("session_start");
  expect(app.context.model).toBe(app.deep);
  expect(app.setModel).not.toHaveBeenCalled();
  expect(app.notify.mock.lastCall?.[1]).toBe("warning");
  await app.setup();
  await app.event("session_start");
  expect(app.setModel).toHaveBeenCalledTimes(1);
});

test("排除 Spark：設定與舊 sticky response 都不能將路由導向 Spark", async () => {
  const app = harness();
  await app.setup();
  const spark = model("gpt-5.3-codex-spark");
  app.setAvailable([app.fast, app.deep, app.virtual, spark]);
  await app.command("fast test/gpt-5.3-codex-spark low");
  expect(app.notify.mock.lastCall?.[0]).toContain("已排除");
  expect((await app.route()).model).toBe(app.fast);
  expect(
    (
      await app.route({
        reason: "continuation",
        previous: { model: spark, thinkingLevel: "low" },
      })
    ).model,
  ).toBe(app.deep);
});

test.each([null, 150000])(
  "context 未知或接近 fast 上限時保留 deep：%s",
  async (tokens) => {
    const app = harness();
    await app.setup();
    app.context.getContextUsage = () => ({
      tokens,
      contextWindow: 200000,
      percent: null,
    });
    expect((await app.route()).model).toBe(app.deep);
    await expect(app.tool("fast")).rejects.toThrow("未排程 fast");
  },
);

test("不以 text-only model 處理對話中的圖片，也不允許 LLM 盲目降級", async () => {
  const app = harness();
  await app.setup();
  app.fast.input = ["text"];
  app.setBranch([
    ...app.branch,
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "image", data: "", mimeType: "image/png" }],
        timestamp: 1,
      },
    },
  ]);
  await expect(app.tool("fast")).rejects.toThrow("不支援圖片");
  app.deep.input = ["text"];
  expect(() =>
    app.route({
      messages: [
        {
          role: "user",
          content: [{ type: "image", data: "", mimeType: "image/png" }],
          timestamp: 1,
        },
      ],
    }),
  ).toThrow("deep model 不支援圖片");
});

test("取消與空白原因不寫入切換狀態", async () => {
  const app = harness();
  await app.setup();
  const controller = new AbortController();
  controller.abort();
  await expect(app.tool("deep", "原因", controller.signal)).rejects.toThrow();
  await expect(app.tool("deep", " \n\t")).rejects.toThrow("不得空白");
  expect(app.branch).toHaveLength(3);
});

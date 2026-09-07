import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";

const fake = vi.hoisted(() => ({ create: vi.fn(), watch: vi.fn() }));
vi.mock("../src/telegram.js", () => ({
  createTransport: fake.create,
  createWatchConnection: fake.watch,
}));

import extension from "../extensions/bears.js";

function harness(hasUI = false) {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: ExtensionContext) => unknown>
  >();
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
  } as unknown as ExtensionAPI;
  extension(pi);
  const context = {
    hasUI,
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  } as unknown as ExtensionContext;
  return {
    async event(name: string) {
      for (const handler of handlers.get(name) ?? [])
        await handler({}, context);
    },
    async execute(name: string, params = {}, signal?: AbortSignal) {
      const tool = tools.get(name);
      if (!tool) throw new Error("缺少工具");
      return tool.execute("test", params, signal, undefined, context);
    },
  };
}

const inventory: GameMessage = {
  id: 2,
  revision: "a".repeat(64),
  date: Math.floor(Date.now() / 1000),
  outgoing: false,
  buttons: [],
  hasMedia: false,
  text: "🎒 背包（2 種）：\n  1. 護甲 【裝備中】— 防禦 +6\n…另有 1 種未列出\n🔢 用編號最方便：/inspect 1",
};
const decode = (
  value: Awaited<ReturnType<ReturnType<typeof harness>["execute"]>>,
) =>
  JSON.parse(
    value.content.find((block) => block.type === "text")?.text ?? "null",
  );

test("實際工具：history 未精簡觀測到 optimizer；計算無連線、分支及 reload 失效", async () => {
  fake.create.mockReset();
  fake.watch.mockReset();
  const close = vi.fn(async () => {});
  const send = vi.fn();
  fake.create.mockResolvedValue({
    connect: async () => {},
    close,
    history: async () => [inventory],
    send,
  });
  const app = harness();
  await app.event("session_start");
  expect(fake.create).not.toHaveBeenCalled();
  expect(fake.watch).not.toHaveBeenCalled();
  expect(
    decode(await app.execute("bears_optimize_equipment")).source,
  ).toBeNull();
  await app.execute("bears_history");
  const result = decode(await app.execute("bears_optimize_equipment"));
  expect(result.completeness).toEqual({
    declared: 2,
    listed: 1,
    complete: false,
  });
  expect(result.source.messageId).toBe(2);
  expect(result.recommendations).toEqual([]);
  expect(fake.create).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  await app.event("session_tree");
  expect(
    decode(await app.execute("bears_optimize_equipment")).source,
  ).toBeNull();
  await app.event("session_shutdown");
  const reloaded = harness();
  expect(
    decode(await reloaded.execute("bears_optimize_equipment")).source,
  ).toBeNull();
  expect(close).toHaveBeenCalledTimes(1);
});

test("互動 session：500ms watch 先於 1500ms 工具回覆仍累積兩件 inspect", async () => {
  let receive: ((message: GameMessage) => void) | undefined;
  fake.watch.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    subscribe: (callback: typeof receive) => {
      receive = callback;
      return () => {};
    },
  });
  const messages: GameMessage[] = [
    {
      ...inventory,
      text: "🎒 背包（2 種）：\n  1. 護甲 — DEF +4\n  2. 護符 — INT +3\n🔢 用編號最方便：/inspect 1",
    },
  ];
  const send = vi.fn(async (text: string) => {
    const name = text.endsWith("1") ? "護甲" : "護符";
    const outgoing = {
      ...inventory,
      id: messages.length + 2,
      text,
      outgoing: true,
    };
    const reply = {
      ...inventory,
      id: outgoing.id + 1,
      text: `${name}\n類型：防具（身體槽）\n屬性：DEF +4`,
    };
    messages.push(outgoing, reply);
    receive?.(outgoing);
    receive?.(reply);
  });
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: async () => [...messages],
    send,
  });
  const app = harness(true);
  try {
    await app.event("session_start");
    await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
    await app.execute("bears_history");
    await app.execute("bears_send", { text: "/inspect 1" });
    await app.execute("bears_send", { text: "/inspect 2" });
    expect(
      decode(await app.execute("bears_optimize_equipment")).inspectSources,
    ).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    receive?.({ ...inventory, id: 20, outgoing: true, text: "/equip 1" });
    await vi.waitFor(
      async () =>
        expect(
          decode(await app.execute("bears_optimize_equipment")).inspectSources,
        ).toHaveLength(0),
      { timeout: 2000 },
    );
  } finally {
    await app.event("session_shutdown");
  }
}, 10000);

test("R7：inspect 取消或送出錯誤保留既有 inspect", async () => {
  const messages = [
    {
      ...inventory,
      text: "🎒 背包（1 種）：\n  1. 護甲 — DEF +4\n🔢 用編號最方便：/inspect 1",
    },
    { ...inventory, id: 3, outgoing: true, text: "/inspect 1" },
    { ...inventory, id: 4, text: "護甲\n類型：防具（身體槽）\n屬性：DEF +4" },
  ];
  const send = vi.fn(async () => {
    throw new Error("合成送出錯誤");
  });
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: async () => messages,
    send,
  });
  const app = harness();
  try {
    await app.execute("bears_history");
    const before = decode(
      await app.execute("bears_optimize_equipment"),
    ).inspectSources;
    expect(before).toHaveLength(1);
    await expect(
      app.execute("bears_send", { text: "/inspect 1" }, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(
      decode(await app.execute("bears_optimize_equipment")).inspectSources,
    ).toEqual(before);
    await expect(
      app.execute("bears_send", { text: "/inspect 1" }),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      decode(await app.execute("bears_optimize_equipment")).inspectSources,
    ).toEqual(before);
    await expect(
      app.execute("bears_send", { text: "/equip 1" }, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(
      decode(await app.execute("bears_optimize_equipment")).inspectSources,
    ).toEqual([]);
  } finally {
    await app.event("session_shutdown");
  }
});

test("R10：無 watch 的 Game.act incoming 活動使既有 inspect 失效", async () => {
  const messages = [
    {
      ...inventory,
      text: "🎒 背包（1 種）：\n  1. 護甲 — DEF +4\n🔢 用編號最方便：/inspect 1",
    },
    { ...inventory, id: 3, outgoing: true, text: "/inspect 1" },
    { ...inventory, id: 4, text: "護甲\n類型：防具（身體槽）\n屬性：DEF +4" },
  ];
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: async () => [...messages],
    send: async () => {
      messages.push({ ...inventory, id: 5, text: "外部戰鬥回覆" });
    },
  });
  const app = harness();
  try {
    await app.execute("bears_history");
    expect(
      decode(await app.execute("bears_optimize_equipment")).inspectSources,
    ).toHaveLength(1);
    await app.execute("bears_send", { text: "/inspect 1" });
    const result = decode(await app.execute("bears_optimize_equipment"));
    expect(result.inspectSources).toEqual([]);
    expect(result.blockers).toContain("觀測已失效，須重新查詢。");
  } finally {
    await app.event("session_shutdown");
  }
});

test("工具拒絕部分權重與取消，不呼叫 transport", async () => {
  fake.create.mockReset();
  const app = harness();
  await expect(
    app.execute("bears_optimize_equipment", { weights: { attack: 1 } }),
  ).rejects.toThrow();
  await expect(
    app.execute("bears_optimize_equipment", {}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(fake.create).not.toHaveBeenCalled();
});

test("history 進行中切換分支，延遲回覆不可寫入新快照", async () => {
  let release!: (messages: GameMessage[]) => void;
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: () =>
      new Promise<GameMessage[]>((resolve) => {
        release = resolve;
      }),
  });
  const app = harness();
  const pending = app.execute("bears_history");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await app.event("session_tree");
  release([inventory]);
  await pending;
  expect(
    decode(await app.execute("bears_optimize_equipment")).source,
  ).toBeNull();
});

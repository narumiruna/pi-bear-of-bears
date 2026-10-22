import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { WorldMap } from "../src/world.js";
import {
  message,
  roomText,
  statusText,
  towerText,
} from "./fixtures/workflow.js";

const fake = vi.hoisted(() => ({ create: vi.fn(), watch: vi.fn() }));
vi.mock("../src/telegram.js", () => ({
  createTransport: fake.create,
  createWatchConnection: fake.watch,
}));
vi.mock("../src/game.js", async (importOriginal) => {
  const module = await importOriginal<typeof import("../src/game.js")>();
  return {
    ...module,
    Game: class extends module.Game {
      constructor(factory: ConstructorParameters<typeof module.Game>[0]) {
        super(factory, 0);
      }
    },
  };
});

import extension from "../extensions/bears.js";

afterEach(() => vi.restoreAllMocks());

/** 真正的 extension／Game 路徑；只有 transport 與時鐘由測試控制。 */
function timingHarness(initial: GameMessage) {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const shutdown: ((event: unknown, ctx: ExtensionContext) => unknown)[] = [];
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: (name: string, handler: (typeof shutdown)[number]) => {
      if (name === "session_shutdown") {
        shutdown.push(handler);
      }
    },
    events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
  } as unknown as ExtensionAPI;
  extension(pi);
  const raw = [initial];
  const send = vi.fn<(text: string) => Promise<void>>();
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: async (limit: number) => raw.slice(-limit),
    send,
  });
  const context = {
    hasUI: false,
    executeTool: async (
      name: string,
      args: unknown,
      options?: { signal?: AbortSignal },
    ) => ({
      result: await call(name, args, options?.signal),
      isError: false,
    }),
  } as unknown as ExtensionToolContext;
  function call(name: string, args: unknown, signal?: AbortSignal) {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`缺少測試工具：${name}`);
    }
    return tool.execute("test", args, signal, undefined, context);
  }
  return {
    raw,
    send,
    call,
    close: async () => {
      for (const handler of shutdown) {
        await handler({}, context);
      }
    },
  };
}

// 只有 ID／date／observedAt 來自問題回報；狀態文字與 revision 為合成測試資料。
test.each(
  [
    {
      tool: "bears_tower_entry_check",
      id: 770689,
      date: 1792519131,
      observedAt: 1792519130214,
    },
    {
      tool: "bears_move_to",
      id: 770695,
      date: 1792519168,
      observedAt: 1792519167405,
    },
    {
      tool: "bears_move_to",
      id: 786514,
      date: 1792685357,
      observedAt: 1792685356064,
    },
  ].flatMap((sample) => [
    { ...sample, future: false },
    { ...sample, future: true },
  ]),
)(
  "$tool 回覆後才記錄 observedAt；future=$future 保留嚴格日期檢查",
  async ({ tool, id, date, observedAt, future }) => {
    const startedAt = observedAt - 1500;
    const receivedAt = future ? observedAt : date * 1000 + 125;
    vi.spyOn(Date, "now").mockReturnValue(startedAt);
    vi.spyOn(WorldMap.prototype, "allRooms").mockResolvedValue([
      {
        id: 1,
        name: "星塔前庭",
        safe: true,
        boss: false,
        description: "",
        exits: {},
      },
    ]);
    const actor = "なるみ_大德熊";
    const app = timingHarness(message(id - 10, statusText(actor)));
    await app.call("bears_history", { limit: 30 });
    const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
    const snapshotId = (
      snapshot.structuredContent as { data: { snapshotId: string } }
    ).data.snapshotId;
    expect(snapshotId).toBeDefined();

    let sent!: () => void;
    const submitted = new Promise<void>((resolve) => {
      sent = resolve;
    });
    let deliver!: () => void;
    const response = new Promise<void>((resolve) => {
      deliver = resolve;
    });
    let nextId = id - 1;
    app.send.mockImplementation(async (text: string) => {
      app.raw.push(message(nextId++, text, true));
      if (text === "/status") {
        sent();
        await response;
      }
      const reply =
        text === "/status"
          ? statusText(actor)
          : text === "/tower"
            ? towerText()
            : text === "/look"
              ? roomText()
              : undefined;
      if (!reply) {
        throw new Error(`測試禁止額外指令：${text}`);
      }
      app.raw.push(
        message(nextId++, reply, false, text === "/status" ? date : undefined),
      );
    });
    try {
      const pending = app.call(
        tool,
        tool === "bears_tower_entry_check"
          ? { character: actor, freeOnly: true }
          : {
              destination: "星塔前庭",
              scope: {
                snapshotId,
                character: actor,
                maxCommands: 10,
                maxChanges: 1,
                maxMilliseconds: 300000,
                maxGold: 0,
              },
            },
      );
      await submitted;
      vi.mocked(Date.now).mockReturnValue(receivedAt);
      deliver();
      const result = (await pending).structuredContent as {
        state: string;
        blockers: string[];
        steps: { tool: string; state: string }[];
        sources: { messageId: number; date: number; observedAt: number }[];
      };
      expect(
        result.sources.find((source) => source.messageId === id),
      ).toMatchObject({
        messageId: id,
        date,
        observedAt: receivedAt,
      });
      expect(receivedAt).toBeGreaterThan(startedAt);
      if (future) {
        expect(result.state).toBe("stopped");
        expect(result.blockers).toEqual([
          `本人 /status 訊息時間晚於本機時間（訊息 ${id}，超前 ${date * 1000 - receivedAt} ms）；保留日期檢查，不等待或自動重送。`,
        ]);
        expect(result.steps).toEqual([
          { tool: "bears_status", state: "confirmed" },
        ]);
        expect(app.send.mock.calls.map(([command]) => command)).toEqual([
          "/status",
        ]);
        // 相同原文的 history 不會刷新 observedAt，也不繞過未來日期檢查。
        await app.call("bears_history", { limit: 6 });
        const blocked = await app.call("bears_combat_snapshot", {
          mode: "tower",
        });
        expect(blocked.structuredContent).toMatchObject({
          actor: null,
          state: "needs_observation",
        });
        vi.mocked(Date.now).mockReturnValue(date * 1000);
        const later = await app.call("bears_combat_snapshot", {
          mode: "tower",
        });
        expect(later.structuredContent).toMatchObject({
          actor,
          sources: [
            expect.objectContaining({
              messageId: id,
              date,
              observedAt: receivedAt,
            }),
          ],
        });
      } else {
        expect(result.state).toBe(
          tool === "bears_tower_entry_check" ? "ready" : "confirmed",
        );
        expect(result.blockers).toEqual([]);
        expect(app.send.mock.calls.map(([command]) => command)).toEqual([
          "/status",
          tool === "bears_tower_entry_check" ? "/tower" : "/look",
        ]);
      }
      expect(fake.watch).not.toHaveBeenCalled();
    } finally {
      deliver();
      await app.close();
    }
  },
);

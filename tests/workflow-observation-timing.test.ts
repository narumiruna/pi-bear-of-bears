import { readFileSync } from "node:fs";
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

// 954260–263 的最小案例：send 的實際 history 含 outgoing 與回春，
// 但舊 Game.act 只回傳 bot 訊息，導致下一手盾預算無法綁定。
// HP／MP 使用合成數值；不驗證遊戲承傷或操作授權。
test.each([true, false])(
  "Game→extension 回春盾只採真實 outgoing；transport 提供 outgoing=%s",
  async (includeOutgoing) => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const app = timingHarness(message(1, statusText("測試熊", 1000, 100)));
    const command = "/skill 地脈·萬物回春";
    let nextId = 2;
    let mp = 100;
    let hp = 1000;
    let enemyHp = 900;
    app.send.mockImplementation((text) => {
      if (includeOutgoing || text !== command) {
        app.raw.push(message(nextId++, text, true));
      }
      let reply: string;
      if (text === "/status") {
        reply = statusText("測試熊", hp, mp);
      } else if (text === "/tower") {
        reply = towerText(30, enemyHp);
      } else if (text === command) {
        mp -= 60;
        reply =
          "✨ 使用技能：地脈·萬物回春（MP -60）\n🛡️ 地脈·萬物回春！接下來 3 次受擊減傷 24%\n💚 恢復 550 HP！HP：1000/1000";
      } else if (text === "/skill 血怒亂斬") {
        mp -= 32;
        hp = 900;
        enemyHp = 850;
        reply =
          "✨ 使用技能：血怒亂斬（MP -32）\n🌀 連續攻擊 5 段：10＋10＋10＋10＋10 ＝ 共 50 傷害！　👻 HP：850/1000\n🩸 吸血！恢復 100 HP。HP：1000/1000\n👻 反擊！你受到 100 傷害。HP：900/1000";
      } else {
        throw new Error(`測試禁止額外指令：${text}`);
      }
      app.raw.push(message(nextId++, reply));
      return Promise.resolve();
    });
    try {
      await app.call("bears_history", { limit: 30 });
      await app.call("bears_tower", {});
      await app.call("bears_skill", { name: "地脈·萬物回春" });
      // 狀態變更後必須取得新的原生 MP 與塔況，不沿用舊 status。
      await app.call("bears_status", {});
      await app.call("bears_tower", {});
      const snapshot = (
        await app.call("bears_combat_snapshot", {
          mode: "tower",
          view: "summary",
        })
      ).structuredContent as { data: { snapshotId: string } };
      const plan = (
        await app.call("bears_plan_tower_step", {
          snapshotId: snapshot.data.snapshotId,
          policy: "blood-earth-32-60",
        })
      ).structuredContent;
      if (includeOutgoing) {
        expect(plan).toMatchObject({
          state: "ready",
          blockers: [],
          data: {
            decision: "blood",
            resources: { mp: 40 },
            shieldBudget: { min: 3 },
          },
        });
        await app.call("bears_skill", { name: "血怒亂斬" });
        await app.call("bears_status", {});
        await app.call("bears_tower", {});
        const after = (
          await app.call("bears_combat_snapshot", {
            mode: "tower",
            view: "summary",
          })
        ).structuredContent as { data: { snapshotId: string } };
        const recovery = (
          await app.call("bears_plan_tower_step", {
            snapshotId: after.data.snapshotId,
            policy: "blood-earth-32-60",
          })
        ).structuredContent;
        expect(recovery).toMatchObject({
          state: "ready",
          blockers: [],
          data: {
            decision: "recover",
            resources: { hp: 900, mp: 8 },
            shieldBudget: { min: 2 },
          },
        });
      } else {
        expect(plan).toMatchObject({
          state: "needs_observation",
          blockers: ["回春缺少在先、同角色／分支的 outgoing，不推盾耗。"],
        });
      }
      expect(app.send.mock.calls.map(([text]) => text)).toEqual([
        "/tower",
        command,
        "/status",
        "/tower",
        ...(includeOutgoing ? ["/skill 血怒亂斬", "/status", "/tower"] : []),
      ]);
      expect(fake.watch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);

test("Game 只收到血怒 outgoing，首次 history 收到原生回覆後可繼續單步規劃，不重送", async () => {
  const sample = JSON.parse(
    readFileSync(
      new URL("./fixtures/native-late-tower-blood.json", import.meta.url),
      "utf8",
    ),
  ) as { outgoing: GameMessage; reply: GameMessage };
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue((sample.outgoing.date - 10) * 1000);
  const ownStatus = (mp: number) =>
    `🐺 測試熊　狂戰熊 二轉Lv80\nHP：3040/3040　MP：${mp}/422\nATK：4557\nDEF：5420\nINT：1132\nAGI：826\n金幣：416,073\nEXP：滿級\n位置：🗼 星塔前庭`;
  let mp = 146;
  let enemyHp = 16828907;
  const tower = () =>
    `🗼 無盡星塔\n📜 個人最佳：第 103 層｜入塔 38 次\n⚔️ 挑戰中：第 104 層　🩻星影·空洞騎士　HP ${enemyHp}/18,011,927`;
  const app = timingHarness(message(954520, ownStatus(mp)));
  let nextId = 954521;
  app.send.mockImplementation((text) => {
    if (text === sample.outgoing.text) {
      mp -= 32;
      enemyHp = 16802715;
      app.raw.push(structuredClone(sample.outgoing));
      nextId = sample.reply.id + 1;
      return Promise.resolve();
    }
    app.raw.push(message(nextId++, text, true));
    let reply: string;
    if (text === "/status") {
      reply = ownStatus(mp);
    } else if (text === "/tower") {
      reply = tower();
    } else if (text === "/skill 地脈·萬物回春") {
      mp -= 60;
      reply =
        "✨ 使用技能：地脈·萬物回春（MP -60）\n🛡️ 地脈·萬物回春！接下來 3 次受擊減傷 24%\n💚 恢復 1672 HP！HP：3040/3040";
    } else {
      throw new Error(`測試禁止額外指令：${text}`);
    }
    app.raw.push(message(nextId++, reply));
    return Promise.resolve();
  });
  try {
    await app.call("bears_history", { limit: 30 });
    await app.call("bears_tower", {});
    await app.call("bears_skill", { name: "地脈·萬物回春" });
    await app.call("bears_status", {});
    await app.call("bears_tower", {});
    clock.mockReturnValue(sample.outgoing.date * 1000 + 100);
    const submitted = await app.call("bears_skill", { name: "血怒亂斬" });
    expect(submitted.structuredContent).toMatchObject({
      observation: "no_update_yet",
      outcome: "unknown",
      messages: [sample.outgoing],
    });
    clock.mockReturnValue(sample.reply.date * 1000 + 100);
    app.raw.push(structuredClone(sample.reply));
    await app.call("bears_history", { limit: 3 });
    await app.call("bears_status", {});
    await app.call("bears_tower", {});
    const point = (
      await app.call("bears_combat_snapshot", {
        mode: "tower",
        view: "summary",
      })
    ).structuredContent as { data: { snapshotId: string } };
    const plan = (
      await app.call("bears_plan_tower_step", {
        snapshotId: point.data.snapshotId,
        policy: "blood-earth-32-60",
      })
    ).structuredContent;
    expect(plan).toMatchObject({
      state: "ready",
      blockers: [],
      data: {
        decision: "blood",
        resources: { hp: 3040, mp: 54 },
        shieldBudget: { min: 2 },
      },
    });
    expect(app.send.mock.calls.map(([text]) => text)).toEqual([
      "/tower",
      "/skill 地脈·萬物回春",
      "/status",
      "/tower",
      "/skill 血怒亂斬",
      "/status",
      "/tower",
    ]);
  } finally {
    await app.close();
  }
});

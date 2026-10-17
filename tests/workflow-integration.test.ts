import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { originalPage } from "../src/original.js";
import { WORKFLOW_TOOL_NAMES } from "../src/workflow-tools.js";
import {
  homeText,
  inventoryText,
  message,
  NOW,
  roomText,
  skillsText,
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
import combatExtension from "../extensions/combat.js";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  fake.create.mockReset();
  fake.watch.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function integration() {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const handlers = new Map<
    string,
    ((event: unknown, ctx: ExtensionContext) => unknown)[]
  >();
  const entries: unknown[] = [];
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    on: (
      name: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data }),
    events: { on: vi.fn(() => vi.fn()), emit: vi.fn() },
  } as unknown as ExtensionAPI;
  extension(pi);
  combatExtension(pi);
  const raw: GameMessage[] = [
    message(1, statusText()),
    message(2, roomText()),
    message(3, towerText()),
    message(4, inventoryText()),
    message(5, homeText()),
    message(6, skillsText),
  ];
  let nextId = 7,
    full = false;
  const send = vi.fn((text: string) => {
    raw.push(message(nextId++, text, true));
    const reply =
      text === "/status"
        ? statusText("測試熊", full ? 1000 : 900, full ? 100 : 60)
        : text === "/look"
          ? roomText()
          : text === "/tower"
            ? towerText()
            : text === "/rest"
              ? "免費休息，HP／MP 已恢復。"
              : undefined;
    if (!reply) {
      throw new Error(`測試禁止額外指令：${text}`);
    }
    if (text === "/rest") {
      full = true;
    }
    raw.push(message(nextId++, reply));
    return Promise.resolve();
  });
  let historyCallback: (() => void) | undefined;
  fake.create.mockResolvedValue({
    connect: async () => {},
    close: async () => {},
    history: (limit: number) => {
      historyCallback?.();
      return Promise.resolve(raw.slice(-limit));
    },
    send,
  });
  const context = {
    hasUI: false,
    tools: [],
    executeTool: vi.fn(
      async (
        name: string,
        args: unknown,
        options?: { signal?: AbortSignal },
      ) => {
        const tool = tools.get(name);
        if (!tool) {
          throw new Error("Missing tool");
        }
        const result = await tool.execute(
          "nested",
          args,
          options?.signal,
          undefined,
          context,
        );
        for (const handler of handlers.get("tool_result") ?? []) {
          await handler(
            {
              toolName: name,
              parentToolCallId: "parent",
              details: result.details,
            },
            context,
          );
        }
        return {
          toolCall: { id: "nested", name, arguments: args },
          result,
          isError: false,
        };
      },
    ),
  } as unknown as ExtensionToolContext;
  return {
    tools,
    context,
    entries,
    send,
    raw,
    pi,
    onHistory: (callback: () => void) => {
      historyCallback = callback;
    },
    event: async (name: string) => {
      for (const handler of handlers.get(name) ?? []) {
        await handler({}, context);
      }
    },
    call: (name: string, args: unknown) => {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error("Missing tool");
      }
      if (!Check(tool.parameters, args)) {
        throw new Error("schema");
      }
      return tool.execute("test", args, undefined, undefined, context);
    },
  };
}

test("實際 bears extension：原始 Game 回覆進入快照，多步恢復仍走 nested tools、hooks、原文", async () => {
  const app = integration();
  await app.event("session_start");
  expect(fake.create).not.toHaveBeenCalled();
  expect(fake.watch).not.toHaveBeenCalled();
  expect(WORKFLOW_TOOL_NAMES.every((name) => app.tools.has(name))).toBe(true);
  await app.call("bears_history", { limit: 30 });
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  const body = snapshot.structuredContent as { data: { snapshotId: string } };
  const output = await app.call("bears_tower_recover", {
    scope: {
      snapshotId: body.data.snapshotId,
      character: "測試熊",
      maxCommands: 40,
      maxChanges: 2,
      maxMilliseconds: 300000,
      maxGold: 0,
    },
  });
  expect(output.structuredContent).toMatchObject({
    state: "confirmed",
    data: { recovered: { hp: 100, mp: 40, gold: 0 } },
  });
  expect(
    app.send.mock.calls
      .map(([command]) => command)
      .filter((command) => command === "/rest"),
  ).toHaveLength(1);
  expect(app.context.executeTool).toHaveBeenCalled();
  const nestedSources = (
    output.structuredContent as {
      data: { originalSources: { tool: string; originalSourceId: string }[] };
    }
  ).data.originalSources;
  expect(nestedSources.some((source) => source.tool === "bears_rest")).toBe(
    true,
  );
  for (const source of nestedSources) {
    expect(
      originalPage(app.entries as never[], source.originalSourceId).text.length,
    ).toBeGreaterThan(0);
  }
  const parentId = (output.structuredContent as { originalSourceId: string })
    .originalSourceId;
  expect(parentId).toBe(
    (output.details as { bearsOriginal: { sourceId: string } }).bearsOriginal
      .sourceId,
  );
  const parentEntry = {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "bears_tower_recover",
      details: output.details,
    },
  };
  expect(originalPage([parentEntry] as never[], parentId).text).toContain(
    '"confirmed"',
  );
  expect(app.entries.length).toBeGreaterThan(0);
  const first = app.entries[0] as {
    data: { bearsOriginal: { sourceId: string } };
  };
  expect(
    originalPage(app.entries as never[], first.data.bearsOriginal.sourceId)
      .text,
  ).toContain('"revision"');
  await app.event("session_shutdown");
});

test("planner 優先用 snapshotId 取得原文數值；缺風險仍不建議攻擊", async () => {
  const app = integration();
  await app.call("bears_history", { limit: 30 });
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  const body = snapshot.structuredContent as { data: { snapshotId: string } };
  const plan = await app.call("bears_plan_combat", {
    snapshotId: body.data.snapshotId,
    mode: "tower",
  });
  expect(plan.structuredContent).toMatchObject({
    state: "needs_observation",
    recommendation: null,
    context: { character: "測試熊" },
  });
  expect(app.send).not.toHaveBeenCalled();
  await app.event("session_shutdown");
});

test("tree／session 重設不恢復執行資格；歷史原文仍可讀但不能用舊 snapshot 執行", async () => {
  const app = integration();
  await app.call("bears_history", { limit: 30 });
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  const body = snapshot.structuredContent as { data: { snapshotId: string } };
  await app.event("session_tree");
  const invalid = await app.call("bears_move_to", {
    scope: {
      snapshotId: body.data.snapshotId,
      character: "測試熊",
      maxCommands: 30,
      maxChanges: 2,
      maxMilliseconds: 300000,
      maxGold: 0,
    },
    destination: "安全站",
  });
  expect(invalid.structuredContent).toMatchObject({ state: "stopped" });
  expect(app.send).not.toHaveBeenCalled();
  await app.event("session_shutdown");
});

test("guard history 之後、實際 send 之前的外部 revision 變更仍會拒絕休息", async () => {
  const app = integration();
  await app.call("bears_history", { limit: 30 });
  const snapshot = await app.call("bears_combat_snapshot", { mode: "tower" });
  const body = snapshot.structuredContent as { data: { snapshotId: string } };
  app.onHistory(() => {
    const calls = vi.mocked(app.context.executeTool).mock.calls;
    if (calls.at(-1)?.[0] !== "bears_rest") {
      return;
    }
    const room = [...app.raw]
      .reverse()
      .find((record) => !record.outgoing && record.text.startsWith("📍"));
    if (room) {
      room.revision = "b".repeat(64);
    }
  });
  const result = await app.call("bears_tower_recover", {
    scope: {
      snapshotId: body.data.snapshotId,
      character: "測試熊",
      maxCommands: 40,
      maxChanges: 2,
      maxMilliseconds: 300000,
      maxGold: 0,
    },
  });
  expect(result.structuredContent).toMatchObject({ state: "stopped" });
  expect(app.send.mock.calls.map(([command]) => command)).not.toContain(
    "/rest",
  );
  await app.event("session_shutdown");
});

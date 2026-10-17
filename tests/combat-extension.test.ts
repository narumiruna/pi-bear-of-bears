import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import extension from "../extensions/combat.js";
import { COMBAT_PLAN_SCHEMA } from "../src/combat-planner.js";
import { STRUCTURED_COMMANDS, serializeCommand } from "../src/game-commands.js";
import { combatObservation } from "./fixtures/combat-observation.js";

const NOW = 1_800_000_000_000;
afterEach(() => vi.restoreAllMocks());

function harness() {
  let definition: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  const pi = {
    registerTool: vi.fn((tool: typeof definition) => {
      definition = tool;
    }),
    registerCommand: vi.fn(),
    on: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  extension(pi as unknown as ExtensionAPI);
  if (!definition) {
    throw new Error("缺少 tool");
  }
  const tool = definition;
  const context = { executeTool: vi.fn() } as unknown as ExtensionToolContext;
  return {
    pi,
    tool,
    context,
    execute(input: unknown, signal?: AbortSignal) {
      return tool.execute("test", input, signal, undefined, context);
    },
  };
}

test("只註冊 LLM tool，不註冊 slash command、事件、背景操作或模型回合", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const app = harness();
  expect(app.pi.registerTool).toHaveBeenCalledTimes(1);
  expect(app.tool.name).toBe("bears_plan_combat");
  expect(app.tool.exposure).toBe("codemode");
  expect(app.tool.annotations).toMatchObject({
    readOnlyHint: true,
    openWorldHint: false,
  });
  const result = await app.execute(combatObservation());
  expect(result.structuredContent).toEqual(result.details);
  expect(Check(COMBAT_PLAN_SCHEMA, result.structuredContent)).toBe(true);
  expect(
    JSON.parse(
      result.content.find((block) => block.type === "text")?.text ?? "null",
    ),
  ).toEqual(result.details);
  expect(app.pi.registerCommand).not.toHaveBeenCalled();
  expect(app.pi.on).not.toHaveBeenCalled();
  expect(app.pi.sendMessage).not.toHaveBeenCalled();
  expect(app.pi.sendUserMessage).not.toHaveBeenCalled();
  expect(app.context.executeTool).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("取消或非法輸入拒絕計算，不執行任何遊戲 tool", async () => {
  const app = harness();
  await expect(
    app.execute(combatObservation(), AbortSignal.abort()),
  ).rejects.toThrow();
  await expect(app.execute({ autoExecute: true })).rejects.toThrow("schema");
  expect(app.context.executeTool).not.toHaveBeenCalled();
});

test("建議引數符合既有 bears_skill／bears_attack 協定，但不送出", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const app = harness();
  const input = combatObservation();
  for (const [hp, command, expected] of [
    [900, "skill", "/skill 合成大招"],
    [100, "attack", "/attack 合成訓練王"],
  ] as const) {
    input.target.hp = hp;
    const result = await app.execute(input);
    const plan = result.structuredContent as {
      recommendation: { tool: string; arguments: unknown };
    };
    expect(plan.recommendation.tool).toBe(`bears_${command}`);
    const entry = STRUCTURED_COMMANDS.find(
      (entry) => entry.command === command,
    );
    if (!entry) {
      throw new Error("缺少既有戰鬥 tool 定義。");
    }
    expect(serializeCommand(entry, plan.recommendation.arguments)).toBe(
      expected,
    );
  }
  expect(app.context.executeTool).not.toHaveBeenCalled();
});

test("無狀態：第二次呼叫缺少機制時不沿用舊建議，重新載入亦無待送操作", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const first = harness();
  await first.execute(combatObservation());
  const input = combatObservation();
  delete input.risk;
  const current = await first.execute(input);
  const reloaded = await harness().execute(input);
  expect(current.details).toEqual(reloaded.details);
  expect(current.details).toMatchObject({
    state: "needs_observation",
    recommendation: null,
  });
});

test("實際 pi loader 可獨立載入 extension，不需登入或其他 extension", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-combat-loader-test-"));
  try {
    const result = await discoverAndLoadExtensions(
      [resolve("extensions/combat.ts")],
      directory,
      directory,
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    const loaded = result.extensions[0];
    expect([...loaded.tools.keys()]).toEqual(["bears_plan_combat"]);
    expect(loaded.commands.size).toBe(0);
    expect(loaded.handlers.size).toBe(0);
    expect(
      loaded.tools.get("bears_plan_combat")?.definition.outputSchema,
    ).toBeDefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

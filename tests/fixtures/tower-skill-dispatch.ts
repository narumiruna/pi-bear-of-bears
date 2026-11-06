import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, vi } from "vitest";
import {
  BEARS_RESULT_SCHEMA,
  type BearsResult,
  gameFailureResult,
  gameToolResult,
} from "../../src/bears-result.js";
import { type BotTransport, Game } from "../../src/game.js";
import { registerGameCommandTools } from "../../src/game-commands.js";
import { BLOOD_SKILL, EARTH_SKILL } from "../../src/tower-shield-budget.js";
import { towerFacts } from "../../src/workflow-parsers.js";
import { registerTowerSkillTool } from "../../src/workflow-tower-skill.js";
import { message, statusText, towerText, workflowHarness } from "./workflow.js";

export const native = JSON.parse(
  readFileSync(
    new URL("./native-tower-dispatch-window-2026-11-06.json", import.meta.url),
    "utf8",
  ),
);
/** 只有時鐘及待送後的血怒回執取自 fixture。身分、塔況、回春及前血怒皆為合成控制，不是完整實機重播或安全證明。 */
export function setup(
  decision: "blood" | "spring" | "recover" | "stop" = "blood",
) {
  const clock = vi.spyOn(Date, "now");
  const app = workflowHarness();
  const add = (
    id: number,
    date: number,
    text: string,
    request?: string,
    outgoing = false,
  ) => {
    clock.mockReturnValue(date * 1000);
    const value = message(id, text, outgoing, date);
    app.raw.push(value);
    app.store.observe([value], request);
  };
  const base = native.anchor.date;
  add(960112, base, statusText("合成控制熊", 1000, 100), "/status");
  add(native.anchor.id, base, towerText(30, 900), "/tower");
  add(
    native.spring.outgoing.id,
    native.spring.outgoing.date,
    `/skill ${EARTH_SKILL}`,
    `/skill ${EARTH_SKILL}`,
    true,
  );
  add(
    native.spring.reply.id,
    native.spring.reply.date,
    "✨ 使用技能：地脈·萬物回春（MP -60）\n💚 恢復 550 HP！HP：1000/1000\n🛡️ 地脈之盾！接下來 3 次受擊減傷 24%",
    `/skill ${EARTH_SKILL}`,
  );
  add(
    960116,
    base + 20,
    `/skill ${BLOOD_SKILL}`,
    `/skill ${BLOOD_SKILL}`,
    true,
  );
  add(
    960117,
    base + 21,
    "✨ 使用技能：血怒亂斬（MP -32）\n🌀 連續攻擊 5 段：10＋10＋10＋10＋10 ＝ 共 50 傷害！　👻 HP：850/1000\n🩸 吸血！恢復 100 HP。HP：1000/1000\n👻 反擊！你受到 100 傷害。HP：900/1000",
    `/skill ${BLOOD_SKILL}`,
  );
  add(
    960122,
    base + 47,
    statusText(
      "合成控制熊",
      decision === "blood" ? 1000 : 900,
      decision === "recover" ? 31 : 100,
      1000,
      decision === "stop" ? "野外" : "星塔前庭",
    ),
    "/status",
  );
  add(960124, base + 48, towerText(30, 850), "/tower");
  clock.mockReturnValue(native.prePlan.clock.before);
  const tower = app.store.latest((value) => towerFacts(value.text));
  if (!tower) {
    throw new Error("缺少合成塔況");
  }
  const snapshotId = app.store.capture([tower.source]).id;
  const wireSend = vi.fn(async (_text: string, _signal: AbortSignal) => {});
  const bot: BotTransport = {
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    history: vi.fn(async () => [
      ...app.raw,
      ...(wireSend.mock.calls.at(-1)?.[0] === native.blood.outgoing.text
        ? [
            {
              ...native.blood.outgoing,
              outgoing: true,
              buttons: [],
              hasMedia: false,
            },
            {
              ...native.blood.reply,
              outgoing: false,
              buttons: [],
              hasMedia: false,
            },
          ]
        : []),
    ]),
    message: vi.fn(async () => undefined),
    send: wireSend,
    click: vi.fn(async () => undefined),
  };
  const game = new Game(async () => bot, 0);
  const send = vi.fn(async (text: string, signal?: AbortSignal) => {
    try {
      return await gameToolResult(await game.act({ text }, signal));
    } catch (error) {
      return gameFailureResult(error);
    }
  });
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      app.tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  registerGameCommandTools(pi, send);
  registerTowerSkillTool(pi, app.store, send);
  return { app, clock, snapshotId, bot, wireSend, game, send, pi };
}

type Harness = ReturnType<typeof setup>;
export const args = (h: Harness, name = BLOOD_SKILL) => ({
  snapshotId: h.snapshotId,
  policy: "blood-earth-32-60",
  name,
});
export function invoke(
  h: Harness,
  params: unknown = args(h),
  signal?: AbortSignal,
) {
  const tool = h.app.tools.get("bears_tower_skill");
  if (!tool) {
    throw new Error("缺少 bears_tower_skill");
  }
  return tool.execute("test", params, signal, undefined, h.app.context);
}
export const receipt = (result: Awaited<ReturnType<typeof invoke>>) =>
  result.structuredContent as BearsResult;
export async function rejected(
  h: Harness,
  params: unknown = args(h),
  signal?: AbortSignal,
) {
  const result = await invoke(h, params, signal);
  expect(result.isError).toBe(true);
  expect(Check(BEARS_RESULT_SCHEMA, result.structuredContent)).toBe(true);
  expect(receipt(result)).toMatchObject({
    code: "NOT_DISPATCHED",
    delivery: "not_dispatched",
    outcome: "unknown",
    messages: [],
  });
  expect(receipt(result).reasons.join()).toContain(
    "Action was not dispatched to the bot.",
  );
  expect(h.wireSend).not.toHaveBeenCalled();
  expect(h.bot.click).not.toHaveBeenCalled();
  expect(h.app.context.executeTool).not.toHaveBeenCalled();
}

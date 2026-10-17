import { createHash } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { vi } from "vitest";
import { EquipmentSnapshot } from "../../src/equipment-snapshot.js";
import type { GameMessage } from "../../src/game.js";
import {
  registerGameCommandTools,
  STRUCTURED_COMMANDS,
} from "../../src/game-commands.js";
import { toolResult } from "../../src/output.js";
import {
  towerFacts,
  WorkflowObservations,
} from "../../src/workflow-observations.js";
import { registerWorkflowTools } from "../../src/workflow-tools.js";
import type { WorldMap } from "../../src/world.js";

export const NOW = 1_800_000_000_000;
export const statusText = (
  name = "測試熊",
  hp = 900,
  mp = 60,
  gold = 1000,
  location = "星塔前庭",
) =>
  `✨ ${name}　法熊 Lv10\nHP：${hp}/1000　MP：${mp}/100\nATK：20 (20+0)　DEF：10 (10+0)\nINT：30 (30+0)　AGI：5 (5+0)\n金幣：${gold}\nEXP：0/100\n位置：${location}`;
export const roomText = (
  name = "星塔前庭",
  exits = "下",
  extra = "安全區域；免費休息\n裝備費用：0G",
) => `📍 ${name}\n${extra}\n🚪 出口：${exits}`;
export const towerText = (
  floor = 30,
  hp = 900,
  name = "合成星主",
  fee = "今日首戰免費",
) =>
  `🗼 無盡星塔\n個人最佳：29\n挑戰中：第${floor}層\n怪物：${name}\nHP：${hp}/1000\nATK：100\n特殊：未確認追傷\n可選起始樓層：1–30\n入場費：${fee}`;
export const inventoryText = (worn = 1) =>
  `🎒 背包（3 種，全列）：\n  1. 🟠⚔️傳世鋼鐵巨劍${worn === 1 ? " 【裝備中】" : ""} — ATK +5（Lv1 可裝備）\n  2. 🟠⚔️傳世青銅巨劍${worn === 2 ? " 【裝備中】" : ""} — ATK +10（Lv1 可裝備）\n  3. 王之精魄 x5 — 從 BOSS 凝聚而出的力量結晶，於鍛造台用來進階王裝（/forge）。\n🔢 用編號最方便：/inspect 1`;
export const homeText = (cash = 1000, vault = 0, fee = "0G") =>
  `🏡 家園\n身上金幣：${cash}\n金庫餘額：${vault}\n存款手續費：${fee}\n/deposit 金額`;
export const skillsText =
  "技能列表\n合成小招（12MP）期望傷害：200；無其他成本\n合成大招（32MP）期望傷害：700；無其他成本";
export function message(
  id: number,
  text: string,
  outgoing = false,
  date = Math.floor(Date.now() / 1000),
): GameMessage {
  return {
    id,
    text,
    outgoing,
    date,
    revision: createHash("sha256").update(`${id}:${text}`).digest("hex"),
    buttons: [],
    hasMedia: false,
  };
}

/** 合成、標籤式協定 fixtures；不是即時 Telegram 原文或實戰安全證明。 */
export function workflowHarness() {
  const store = new WorkflowObservations(),
    equipment = new EquipmentSnapshot();
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const events: { tool: string; args: unknown; isError: boolean }[] = [];
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
      tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const raw: GameMessage[] = [];
  const sent: string[] = [];
  let nextId = 1;
  const state = {
    name: "測試熊",
    hp: 900,
    mp: 60,
    gold: 1000,
    vault: 0,
    location: "星塔前庭",
    idle: false,
    inCombat: false,
    floor: 30,
    enemyHp: 900,
    worn: 1,
  };
  const overrides = new Map<
    string,
    () => string | string[] | Promise<string | string[]>
  >();
  let pendingHistory: (() => void) | undefined;
  const observe = (text: string, request?: string, outgoing = false) => {
    const value = message(nextId++, text, outgoing);
    raw.push(value);
    store.observe([value], request);
    equipment.observe([value], Date.now(), request);
    return value;
  };
  const seed = () => {
    observe(
      `${statusText(state.name, state.hp, state.mp, state.gold, state.location)}${state.idle ? "\n🐾 掛機中" : ""}`,
      "/status",
    );
    observe(inventoryText(state.worn), "/inventory all");
    observe(homeText(state.gold, state.vault), "/home");
    observe(roomText(state.location), "/look");
    observe(skillsText, "/skills");
    observe(towerText(), "/tower");
    const tower = store.latest((message) => towerFacts(message.text));
    return store.capture(tower ? [tower.source] : []);
  };
  const reply = (command: string): string => {
    if (command === "/status") {
      return `${statusText(state.name, state.hp, state.mp, state.gold, state.location)}${state.idle ? "\n🐾 掛機中" : ""}`;
    }
    if (command === "/tower") {
      return towerText(state.floor, state.enemyHp);
    }
    if (command === "/look") {
      return roomText(
        state.location,
        state.location === "星塔前庭" ? "下" : "上",
        `安全區域；免費休息\n裝備費用：0G${state.inCombat ? "\n戰鬥中" : ""}`,
      );
    }
    if (command === "/home") {
      return homeText(state.gold, state.vault);
    }
    if (command === "/inventory all") {
      return inventoryText(state.worn);
    }
    if (command === "/flee") {
      state.inCombat = false;
      return "你收刀離開戰鬥，挑戰保留。";
    }
    if (command === "/rest") {
      state.hp = 1000;
      state.mp = 100;
      return "免費休息，HP／MP 已恢復。";
    }
    if (command.startsWith("/deposit ")) {
      const quantity = Number(command.split(" ")[1]);
      state.gold -= quantity;
      state.vault += quantity;
      return `存款成功：${quantity}G`;
    }
    if (command.startsWith("/equip ")) {
      state.worn = Number(command.split(" ")[1]);
      return "已裝備 🟠⚔️傳世青銅巨劍";
    }
    if (command.startsWith("/go ")) {
      const direction = command.split(" ")[1];
      state.location = state.location === "星塔前庭" ? "安全站" : "星塔前庭";
      return `你往${direction}走去\n${roomText(state.location, state.location === "安全站" ? "上" : "下")}`;
    }
    throw new Error(`未定義的合成回覆：${command}`);
  };
  registerGameCommandTools(pi, async (text) => {
    sent.push(text);
    observe(text, undefined, true);
    if (!/^\/(?:status|tower|home|look|inventory|skills|inspect)/u.test(text)) {
      store.invalidate();
      equipment.invalidate();
    }
    const override = overrides.get(text);
    const texts = override ? await override() : reply(text);
    const messages = (Array.isArray(texts) ? texts : [texts])
      .filter(Boolean)
      .map((value) => observe(value, text));
    return toolResult({
      delivery: "submitted",
      observation:
        messages.length > 0 ? "bot_updates_observed" : "no_update_yet",
      messages,
    });
  });
  tools.set("bears_history", {
    name: "bears_history",
    label: "history",
    description: "history",
    parameters: STRUCTURED_COMMANDS[0].parameters,
    execute: () => {
      pendingHistory?.();
      return toolResult([...raw]);
    },
  });
  const context = {
    executeTool: vi.fn(
      async (
        name: string,
        args: unknown,
        options?: { signal?: AbortSignal },
      ) => {
        options?.signal?.throwIfAborted();
        const entry = tools.get(name);
        if (!entry) {
          throw new Error(`tool 不存在：${name}`);
        }
        try {
          if (name !== "bears_history" && !Check(entry.parameters, args)) {
            throw new Error(`schema：${name}`);
          }
          const result = await entry.execute(
            `nested-${events.length}`,
            args,
            options?.signal,
            undefined,
            context,
          );
          events.push({ tool: name, args, isError: false });
          return {
            toolCall: { id: "nested", name, arguments: args },
            result,
            isError: false,
          };
        } catch (error) {
          events.push({ tool: name, args, isError: true });
          return {
            toolCall: { id: "nested", name, arguments: args },
            result: {
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              details: {},
            },
            isError: true,
          };
        }
      },
    ),
  } as unknown as ExtensionToolContext;
  const rooms = [
    {
      id: 1,
      name: "星塔前庭",
      safe: true,
      boss: false,
      description: "",
      exits: { 下: 2 },
    },
    {
      id: 2,
      name: "安全站",
      safe: true,
      boss: false,
      description: "",
      exits: { 上: 1 },
    },
  ];
  const world = { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
    WorldMap,
    "allRooms"
  >;
  const codex = {
    lookup: vi.fn(
      async (_options?: {
        recipes?: boolean;
        query?: string;
        offset?: number;
      }) => ({
        source: "public fixture",
        fetchedAt: new Date(NOW).toISOString(),
        entries: [],
        nextOffset: null,
        total: 0,
        offset: 0,
        evolution: [],
      }),
    ),
  };
  registerWorkflowTools(pi, { store, equipment, world, codex: codex as never });
  const call = async (name: string, args: unknown, signal?: AbortSignal) => {
    const entry = tools.get(name);
    if (!entry) {
      throw new Error("缺少 tool");
    }
    const result = await entry.execute(
      "test",
      args,
      signal,
      undefined,
      context,
    );
    return result.structuredContent as unknown as import("../../src/workflow-result.js").WorkflowResult;
  };
  const scope = (id: string) => ({
    snapshotId: id,
    character: state.name,
    maxCommands: 100,
    maxChanges: 20,
    maxMilliseconds: 300000,
    maxGold: 0,
  });
  return {
    store,
    equipment,
    tools,
    events,
    raw,
    sent,
    state,
    overrides,
    observe,
    seed,
    call,
    scope,
    world,
    codex,
    context,
    onHistory: (callback: () => void) => {
      pendingHistory = callback;
    },
  };
}

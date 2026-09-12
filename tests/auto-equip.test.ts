import { expect, test, vi } from "vitest";
import {
  AutoEquip,
  formatAutoEquipResult,
  parseAutoEquipConfirmation,
  parseFleeConfirmation,
  parseSwitchCombatBlock,
} from "../src/auto-equip.js";
import type { Game, GameMessage } from "../src/game.js";

function message(id: number, text: string): GameMessage {
  return {
    id,
    outgoing: false,
    text,
    date: id,
    revision: String(id),
    buttons: [],
    hasMedia: false,
  };
}

class QueueGame {
  readonly commands: string[] = [];
  readonly stop = vi.fn();

  constructor(
    private readonly replies: Array<{ command: string; text: string }>,
  ) {}

  act(input: { text: string }) {
    const next = this.replies.shift();
    if (!next) {
      return Promise.reject(new Error(`Unexpected command: ${input.text}`));
    }
    expect(input.text).toBe(next.command);
    this.commands.push(input.text);
    return Promise.resolve({
      delivery: "submitted" as const,
      observation: "bot_updates_observed" as const,
      acknowledgement: undefined,
      messages: [message(this.commands.length, next.text)],
      note: "test",
    });
  }
}

const chars = `🐻 你的角色（2/9）　▶️＝操作中
▶️ 🔮 甲熊　賢者熊 二轉Lv25　❤90/90　📍熊熊村廣場
　　⚔️ 乙熊　戰熊 Lv2　❤150/150　📍熊熊村廣場 🐾`;

function switched(
  name: string,
  job: string,
  level: number,
  idle = false,
  advanced = false,
) {
  const levelLabel = `${advanced ? "二轉" : ""}Lv${level}`;
  return `${idle ? `📥 ${name} 掛機結算：\n⏹️ 掛機已結束。\n` : ""}✅ 已切換為 ✨ ${name}（${job} ${levelLabel}）
📍 熊熊村廣場　輸入 /look 查看周圍。`;
}

const equipped = "⚡ 一鍵裝備完成！\n✅ 已自動裝備目前職業的最強裝備。";
const equippedWithChanges = `⚡ 一鍵裝備
　武器：🟢🪓精良青銅戰斧 → 🟠🗡️不朽秘銀熊爪
　身體：🟢🛡️精良青銅護甲 → 🟠🛡️不朽鋼鐵護甲
ATK：222　DEF：233　INT：80`;
const alreadyStrongest = `⚡ 一鍵裝備
　已經是背包裡最強的組合了，沒有可換的。
ATK：222　DEF：233　INT：80`;
const combatBlocked =
  "⚔️ 戰鬥中無法切換角色！請先結束戰鬥（/flee 逃跑或擊敗怪物）。";
const fled = "💨 你已逃離戰鬥。";

test("辨識切換阻擋與逃跑結果", () => {
  expect(parseSwitchCombatBlock(combatBlocked)).toBe(true);
  expect(parseSwitchCombatBlock("✅ 已切換角色")).toBeUndefined();
  expect(parseFleeConfirmation(fled)).toBe(true);
  expect(parseFleeConfirmation("💨 逃跑失敗，怪物仍在追擊！")).toBeUndefined();
});

test("辨識一鍵裝備成功與失敗回覆", () => {
  expect(parseAutoEquipConfirmation(equipped)).toBe(true);
  expect(parseAutoEquipConfirmation(equippedWithChanges)).toBe(true);
  expect(parseAutoEquipConfirmation(alreadyStrongest)).toBe(true);
  expect(parseAutoEquipConfirmation("⚡ 目前已是最強裝備。")).toBe(true);
  expect(
    parseAutoEquipConfirmation("❌ 一鍵裝備失敗：目前無法更換。"),
  ).toBeUndefined();
  expect(
    parseAutoEquipConfirmation("⚡ 一鍵裝備\n　武器：舊裝備 → 新裝備"),
  ).toBeUndefined();
  expect(parseAutoEquipConfirmation("一般聊天訊息")).toBeUndefined();
});

test("依序為所有角色一鍵裝備並回到原本角色", async () => {
  const game = new QueueGame([
    { command: "/chars", text: chars },
    { command: "/switch 乙熊", text: switched("乙熊", "戰熊", 2, true) },
    { command: "/autoequip", text: equipped },
    {
      command: "/switch 甲熊",
      text: switched("甲熊", "賢者熊", 25, false, true),
    },
    { command: "/autoequip", text: equipped },
  ]);
  const observe = vi.fn();
  const result = await new AutoEquip(
    game as unknown as Pick<Game, "act" | "stop">,
    observe,
  ).run();

  expect(game.commands).toEqual([
    "/chars",
    "/switch 乙熊",
    "/autoequip",
    "/switch 甲熊",
    "/autoequip",
  ]);
  expect(result).toEqual({
    commands: 5,
    characters: [
      { name: "乙熊", job: "戰熊", level: 2 },
      { name: "甲熊", job: "賢者熊", level: 125 },
    ],
  });
  expect(observe).toHaveBeenCalledTimes(5);
  expect(formatAutoEquipResult(result)).toContain("所有角色一鍵裝備完成");
});

test("切換被戰鬥阻擋時先逃跑再繼續", async () => {
  const game = new QueueGame([
    { command: "/chars", text: chars },
    { command: "/switch 乙熊", text: combatBlocked },
    { command: "/flee", text: fled },
    { command: "/switch 乙熊", text: switched("乙熊", "戰熊", 2, true) },
    { command: "/autoequip", text: equipped },
    {
      command: "/switch 甲熊",
      text: switched("甲熊", "賢者熊", 25, false, true),
    },
    { command: "/autoequip", text: equipped },
  ]);

  const result = await new AutoEquip(
    game as unknown as Pick<Game, "act" | "stop">,
  ).run();

  expect(game.commands).toEqual([
    "/chars",
    "/switch 乙熊",
    "/flee",
    "/switch 乙熊",
    "/autoequip",
    "/switch 甲熊",
    "/autoequip",
  ]);
  expect(result.commands).toBe(7);
  expect(result.characters).toHaveLength(2);
});

test("無法確認一鍵裝備回覆時停止且不重送", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n");
  const game = new QueueGame([
    { command: "/chars", text: one },
    { command: "/autoequip", text: "沒有可確認的回覆" },
  ]);

  await expect(
    new AutoEquip(game as unknown as Pick<Game, "act" | "stop">).run(),
  ).rejects.toThrow("不會重送");
  expect(game.commands).toEqual(["/chars", "/autoequip"]);
});

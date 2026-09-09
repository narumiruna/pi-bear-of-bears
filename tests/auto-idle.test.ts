import { expect, test, vi } from "vitest";
import {
  AutoIdle,
  chooseIdleRoute,
  formatAutoIdleResult,
  parseCharacterList,
  parseCurrentStatus,
  parseSelectedCharacter,
} from "../src/auto-idle.js";
import type { Game, GameMessage } from "../src/game.js";
import type { Room, WorldMap } from "../src/world.js";

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

function action(messages: GameMessage[]) {
  return {
    delivery: "submitted" as const,
    observation: "bot_updates_observed" as const,
    acknowledgement: undefined,
    messages,
    note: "test",
  };
}

class QueueGame {
  readonly commands: string[] = [];
  readonly stop = vi.fn();

  constructor(
    private readonly replies: Array<{ command: string; text: string }>,
  ) {}

  async act(input: { text: string }) {
    const next = this.replies.shift();
    if (!next) throw new Error(`Unexpected command: ${input.text}`);
    expect(input.text).toBe(next.command);
    this.commands.push(input.text);
    return action([message(this.commands.length, next.text)]);
  }
}

const rooms: Room[] = [
  {
    id: 1,
    name: "熊熊村廣場",
    description: "",
    safe: true,
    boss: false,
    exits: { 東: 2 },
  },
  {
    id: 2,
    name: "蘑菇迷林",
    description: "",
    safe: false,
    boss: false,
    exits: { 西: 1, 東: 3, 南: 4 },
    monsterCount: 3,
  },
  {
    id: 3,
    name: "鮭魚溪",
    description: "",
    safe: false,
    boss: false,
    exits: { 西: 2 },
    monsterCount: 2,
  },
  {
    id: 4,
    name: "危險王座",
    description: "",
    safe: false,
    boss: true,
    exits: { 東: 7 },
    monsterCount: 1,
  },
  {
    id: 5,
    name: "荒地起點",
    description: "",
    safe: true,
    boss: false,
    exits: { 東: 4, 南: 6 },
  },
  {
    id: 6,
    name: "蛙聲澤",
    description: "",
    safe: false,
    boss: false,
    exits: { 北: 5 },
    monsterCount: 2,
  },
  {
    id: 7,
    name: "斷戟原",
    description: "",
    safe: false,
    boss: false,
    exits: { 西: 4 },
    monsterCount: 2,
  },
];

const chars = `🐻 你的角色（2/9）　▶️＝操作中
▶️ ✨ 甲熊　法熊 Lv8　❤90/90　📍熊熊村廣場
　　⚔️ 乙熊　戰熊 Lv1　❤150/150　📍熊熊村廣場 🐾`;

function switched(name: string, job: string, level: number, idle = false) {
  return `${idle ? `📥 ${name} 掛機結算：\n⏹️ 掛機已結束。\n` : ""}✅ 已切換為 ✨ ${name}（${job} Lv${level}）
📍 熊熊村廣場　輸入 /look 查看周圍。`;
}

function moved(direction: string, room: string) {
  return `你往${direction}走去…
🍄 ${room}
說明
🚪 出口：西→熊熊村廣場`;
}

function idling(room: string) {
  return `🐾 開始掛機！你的熊從 🍄${room} 出發，會自己四處遊蕩找打得贏的怪…`;
}

test("解析角色清單、切換回覆與目前狀態", () => {
  expect(parseCharacterList(chars)).toEqual([
    {
      name: "甲熊",
      job: "法熊",
      level: 8,
      location: "熊熊村廣場",
      active: true,
      idle: false,
    },
    {
      name: "乙熊",
      job: "戰熊",
      level: 1,
      location: "熊熊村廣場",
      active: false,
      idle: true,
    },
  ]);
  expect(
    parseSelectedCharacter(switched("乙熊", "戰熊", 2, true), "乙熊"),
  ).toMatchObject({
    name: "乙熊",
    job: "戰熊",
    level: 2,
    location: "熊熊村廣場",
    idleSettled: true,
  });
  expect(
    parseCurrentStatus(`✨ 甲熊　法熊 Lv8
HP：90/90　MP：100/100
EXP：1/2（本級）
位置：🏞️ 鮭魚溪
🐾 掛機中（鮭魚溪）— /stopidle 結算`),
  ).toMatchObject({
    name: "甲熊",
    level: 8,
    location: "鮭魚溪",
    idle: true,
  });
  expect(() => parseCharacterList(chars.replace("甲熊", "甲 熊"))).toThrow();
});

test("依等級選擇路線且不穿越 BOSS 房", () => {
  expect(chooseIdleRoute(rooms, 1, "熊熊村廣場")).toMatchObject({
    target: { name: "蘑菇迷林" },
    path: [{ direction: "東", room: { name: "蘑菇迷林" } }],
    fallback: false,
  });
  expect(chooseIdleRoute(rooms, 8, "熊熊村廣場")).toMatchObject({
    target: { name: "鮭魚溪" },
    path: [
      { direction: "東", room: { name: "蘑菇迷林" } },
      { direction: "東", room: { name: "鮭魚溪" } },
    ],
  });
  expect(chooseIdleRoute(rooms, 24, "荒地起點")).toMatchObject({
    target: { name: "蛙聲澤" },
    path: [{ direction: "南", room: { name: "蛙聲澤" } }],
    fallback: true,
  });
  expect(() => chooseIdleRoute(rooms, 1, "危險王座")).toThrow("非 BOSS 路線");
  expect(chooseIdleRoute(rooms, 24, "蛙聲澤")).toMatchObject({
    target: { name: "蛙聲澤" },
    path: [],
    fallback: true,
  });
});

test("依序重設每個角色掛機，最後回到原本角色", async () => {
  const game = new QueueGame([
    { command: "/chars", text: chars },
    { command: "/switch 乙熊", text: switched("乙熊", "戰熊", 1, true) },
    { command: "/go 東", text: moved("東", "蘑菇迷林") },
    { command: "/idle", text: idling("蘑菇迷林") },
    { command: "/switch 甲熊", text: switched("甲熊", "法熊", 8) },
    { command: "/go 東", text: moved("東", "蘑菇迷林") },
    { command: "/go 東", text: moved("東", "鮭魚溪") },
    { command: "/idle", text: idling("鮭魚溪") },
  ]);
  const observe = vi.fn();
  const auto = new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
      WorldMap,
      "allRooms"
    >,
    observe,
  );
  const result = await auto.start();
  expect(result.commands).toBe(8);
  expect(result.characters.map((item) => item.name)).toEqual(["乙熊", "甲熊"]);
  expect(result.characters.map((item) => item.target)).toEqual([
    "蘑菇迷林",
    "鮭魚溪",
  ]);
  expect(observe).toHaveBeenCalledTimes(8);
  expect(formatAutoIdleResult(result)).toContain("掛機設定完成");
});

test("單一角色已在目標房掛機時不重啟", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n")
    .replace("📍熊熊村廣場", "📍鮭魚溪 🐾");
  const game = new QueueGame([
    { command: "/chars", text: one },
    {
      command: "/status",
      text: `✨ 甲熊　法熊 Lv8\nHP：90/90　MP：100/100\nEXP：1/2（本級）\n位置：🏞️ 鮭魚溪\n🐾 掛機中（鮭魚溪）— /stopidle 結算`,
    },
  ]);
  const result = await new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
      WorldMap,
      "allRooms"
    >,
  ).start();
  expect(result.characters[0].result).toBe("already_running");
  expect(game.commands).toEqual(["/chars", "/status"]);
});

test("移動回覆不符時立即停止且不送出 idle", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n");
  const game = new QueueGame([
    { command: "/chars", text: one },
    {
      command: "/status",
      text: `✨ 甲熊　法熊 Lv8\nHP：90/90　MP：100/100\nEXP：1/2（本級）\n位置：🏘️ 熊熊村廣場`,
    },
    { command: "/go 東", text: "沒有可確認的移動回覆" },
  ]);
  const auto = new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
      WorldMap,
      "allRooms"
    >,
  );
  await expect(auto.start()).rejects.toThrow("不會重送");
  expect(game.commands).toEqual(["/chars", "/status", "/go 東"]);
});

test("單一目前角色以 /stopidle 停止掛機", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n")
    .replace("📍熊熊村廣場", "📍鮭魚溪 🐾");
  const game = new QueueGame([
    { command: "/chars", text: one },
    {
      command: "/stopidle",
      text: "🐾 已掛機 10 分\nEXP +100\n⏹️ 掛機已結束。",
    },
  ]);
  const result = await new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
      WorldMap,
      "allRooms"
    >,
  ).stopAll();
  expect(result.characters).toHaveLength(1);
  expect(game.commands).toEqual(["/chars", "/stopidle"]);
});

test("停止所有掛機角色並恢復原本目前角色", async () => {
  const activeIdle = chars.replace("📍熊熊村廣場\n", "📍熊熊村廣場 🐾\n");
  const game = new QueueGame([
    { command: "/chars", text: activeIdle },
    { command: "/switch 乙熊", text: switched("乙熊", "戰熊", 1, true) },
    { command: "/switch 甲熊", text: switched("甲熊", "法熊", 8, true) },
  ]);
  const result = await new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
      WorldMap,
      "allRooms"
    >,
  ).stopAll();
  expect(result.characters.map((item) => item.name)).toEqual(["乙熊", "甲熊"]);
  expect(result.characters.every((item) => item.result === "stopped")).toBe(
    true,
  );
  expect(game.commands).toEqual(["/chars", "/switch 乙熊", "/switch 甲熊"]);
});

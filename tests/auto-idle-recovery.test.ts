import { expect, test, vi } from "vitest";
import { AutoIdle } from "../src/auto-idle.js";
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
    private readonly lateReplies: GameMessage[][] = [],
  ) {}

  act(input: { text: string }) {
    const next = this.replies.shift();
    if (!next) {
      return Promise.reject(new Error(`Unexpected command: ${input.text}`));
    }
    expect(input.text).toBe(next.command);
    this.commands.push(input.text);
    return Promise.resolve(action([message(this.commands.length, next.text)]));
  }

  history() {
    return Promise.resolve(this.lateReplies.shift() ?? []);
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
    exits: { 西: 1, 東: 3 },
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

function world() {
  return { allRooms: vi.fn(async () => rooms) } as unknown as Pick<
    WorldMap,
    "allRooms"
  >;
}

test("切換回覆省略掛機結算時以 status 確認，不重送 switch", async () => {
  const game = new QueueGame([
    { command: "/chars", text: chars },
    { command: "/switch 乙熊", text: switched("乙熊", "戰熊", 1) },
    {
      command: "/status",
      text:
        "⚔️ 乙熊　戰熊 Lv1\n" +
        "HP：150/150　MP：10/10\n" +
        "EXP：1/100（本級）\n" +
        "位置：🏘️ 熊熊村廣場",
    },
    { command: "/go 東", text: moved("東", "蘑菇迷林") },
    { command: "/idle", text: idling("蘑菇迷林") },
    { command: "/switch 甲熊", text: switched("甲熊", "法熊", 8) },
    { command: "/go 東", text: moved("東", "蘑菇迷林") },
    { command: "/go 東", text: moved("東", "鮭魚溪") },
    { command: "/idle", text: idling("鮭魚溪") },
  ]);

  const result = await new AutoIdle(
    game as unknown as Pick<Game, "act" | "stop">,
    world(),
  ).start();

  expect(result.characters.map((item) => item.name)).toEqual(["乙熊", "甲熊"]);
  expect(game.commands.filter((command) => command === "/switch 乙熊")).toEqual(
    ["/switch 乙熊"],
  );
  expect(game.commands).toContain("/status");
});

test("延遲移動回覆只補讀 history，不重送原指令", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n");
  const game = new QueueGame(
    [
      { command: "/chars", text: one },
      {
        command: "/status",
        text: "✨ 甲熊　法熊 Lv8\nHP：90/90　MP：100/100\nEXP：1/2（本級）\n位置：🏘️ 熊熊村廣場",
      },
      { command: "/go 東", text: "尚未收到回覆" },
      { command: "/go 東", text: moved("東", "鮭魚溪") },
      { command: "/idle", text: idling("鮭魚溪") },
    ],
    [
      [],
      [
        {
          ...message(30, moved("東", "蘑菇迷林")),
          date: Math.floor(Date.now() / 1000),
        },
      ],
    ],
  );
  const result = await new AutoIdle(
    game,
    world(),
    () => {},
    () => {},
    0,
  ).start();
  expect(result.characters[0].target).toBe("鮭魚溪");
  expect(game.commands).toEqual([
    "/chars",
    "/status",
    "/go 東",
    "/go 東",
    "/idle",
  ]);
});

test("動作結果不明時只讀 history 恢復，不重送原指令", async () => {
  const one = chars
    .replace("（2/9）", "（1/9）")
    .split("\n")
    .slice(0, 2)
    .join("\n");
  const commands: string[] = [];
  const replies = [
    one,
    "✨ 甲熊　法熊 Lv8\nHP：90/90　MP：100/100\nEXP：1/2（本級）\n位置：🏘️ 熊熊村廣場",
    undefined,
    moved("東", "鮭魚溪"),
    idling("鮭魚溪"),
  ];
  const game = {
    stop: vi.fn(),
    act(input: { text: string }) {
      const index = commands.length;
      commands.push(input.text);
      if (index === 2) {
        return Promise.reject(
          new Error(
            "Action may have reached the bot; outcome is unknown. Do not retry it.",
          ),
        );
      }
      return Promise.resolve(
        action([message(index + 1, replies[index] ?? "")]),
      );
    },
    history() {
      return Promise.resolve([
        {
          ...message(40, moved("東", "蘑菇迷林")),
          date: Math.floor(Date.now() / 1000),
        },
      ]);
    },
  };

  const result = await new AutoIdle(
    game,
    world(),
    () => {},
    () => {},
    0,
  ).start();

  expect(result.characters[0].target).toBe("鮭魚溪");
  expect(commands).toEqual(["/chars", "/status", "/go 東", "/go 東", "/idle"]);
});

import { expect, test, vi } from "vitest";
import type { EquipmentCandidate } from "../src/equipment-optimizer.js";
import { evaluateVerifiedEquipment } from "../src/equipment-snapshot.js";
import { type BotTransport, Game, type GameMessage } from "../src/game.js";

// 合成 transport 使用結構化測試資料，不將此 JSON 冒充真實 Telegram 協定。
function scenario() {
  let items: EquipmentCandidate[] = [
    {
      id: 7,
      name: "目前武器",
      slot: "武器",
      stats: { attack: 1, defense: 0, intelligence: 0, agility: 0 },
      equipped: true,
      eligible: true,
      effects: [],
    },
    {
      id: 23,
      name: "候選武器",
      slot: "武器",
      stats: { attack: 2, defense: 0, intelligence: 0, agility: 0 },
      equipped: false,
      eligible: true,
      effects: [],
    },
  ];
  let id = 1;
  let text = "";
  const messages: GameMessage[] = [];
  const emit = () => {
    messages.push({
      id: id++,
      outgoing: false,
      date: 100,
      revision: String(id).padStart(64, "0"),
      text,
      buttons: [],
      hasMedia: false,
    });
  };
  const send = vi.fn(async (command: string) => {
    if (command === "/inventory") {
      text = JSON.stringify(items);
      emit();
    } else if (/^\/equip \d+$/.test(command)) {
      const target = Number(command.split(" ")[1]);
      if (!items.some((item) => item.id === target))
        throw new Error("無此編號");
      items = items.map((item, index) => ({
        ...item,
        equipped: item.id === target,
        id: index + 30,
      }));
      text = "合成：已換裝";
      emit();
    }
  });
  const bot: BotTransport = {
    connect: async () => {},
    history: async () => [...messages],
    message: async () => undefined,
    send,
    click: async () => undefined,
    close: async () => {},
  };
  const game = new Game(async () => bot, 0);
  const query = async () => {
    const result = await game.act({ text: "/inventory" });
    const data = JSON.parse(
      result.messages.at(-1)?.text ?? "null",
    ) as EquipmentCandidate[];
    return { complete: true, items: data, slots: ["武器"], blockers: [] };
  };
  return {
    game,
    query,
    send,
    bot,
    reorder: () => {
      items = items.map((item) => ({ ...item, id: item.id + 100 }));
    },
  };
}

test("mock：擷取、重查、正向逐件操作、編號重排及新觀測確認", async () => {
  const { game, query, send } = scenario();
  await game.history();
  const first = evaluateVerifiedEquipment(await query());
  expect(first.recommendations[0].targetId).toBe(23);
  const fresh = evaluateVerifiedEquipment(await query());
  expect(fresh.recommendations).toEqual(first.recommendations);
  await game.act({ text: `/equip ${fresh.recommendations[0].targetId}` });
  const after = await query();
  expect(after.items.find((item) => item.name === "候選武器")).toMatchObject({
    id: 31,
    equipped: true,
  });
  expect(evaluateVerifiedEquipment(after).recommendations).toEqual([]);
  expect(send.mock.calls.map(([command]) => command)).toEqual([
    "/inventory",
    "/inventory",
    "/equip 23",
    "/inventory",
  ]);
});

test("mock：執行前編號改變必須重算，不沿用舊 targetId", async () => {
  const { game, query, send, reorder } = scenario();
  expect(
    evaluateVerifiedEquipment(await query()).recommendations[0].targetId,
  ).toBe(23);
  reorder();
  const fresh = evaluateVerifiedEquipment(await query());
  expect(fresh.recommendations[0].targetId).toBe(123);
  await game.act({ text: `/equip ${fresh.recommendations[0].targetId}` });
  expect((await query()).items.find((item) => item.equipped)?.name).toBe(
    "候選武器",
  );
  expect(send.mock.calls.some(([command]) => command === "/equip 23")).toBe(
    false,
  );
});

test("mock：平手、無提升及缺漏不產生操作", async () => {
  const { query, send } = scenario();
  const data = await query();
  for (const attack of [0, 1]) {
    data.items[1].stats = { attack, defense: 0, intelligence: 0, agility: 0 };
    expect(evaluateVerifiedEquipment(data).recommendations).toEqual([]);
  }
  data.complete = false;
  expect(evaluateVerifiedEquipment(data).recommendations).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
});

test.each(["費用", "速率限制", "取消", "延遲"])(
  "mock：部分成功後遇 %s 停止，不重送未知結果",
  async (failure) => {
    const { game, query, send, bot } = scenario();
    await query();
    await game.act({ text: "/equip 23" });
    const confirmed = await query();
    expect(confirmed.items.find((item) => item.equipped)?.name).toBe(
      "候選武器",
    );
    const controller = new AbortController();
    bot.send = vi.fn(async () => {
      if (failure === "取消") controller.abort();
      if (failure === "速率限制")
        throw Object.assign(new Error("rate limit"), { seconds: 10 });
      if (failure !== "延遲") throw new Error("合成：非預期費用或取消");
    });
    if (failure === "延遲") {
      expect((await game.act({ text: "/equip 31" })).observation).toBe(
        "no_update_yet",
      );
      await game.history();
      await game.history();
    } else
      await expect(
        game.act({ text: "/equip 31" }, controller.signal),
      ).rejects.toThrow(/outcome is unknown/);
    expect(bot.send).toHaveBeenCalledTimes(1);
    expect(
      send.mock.calls.filter(([command]) => command === "/equip 23"),
    ).toHaveLength(1);
    // 停止／不重送是此明確的 Agent 流程驗收腳本；Game 不替 Agent 決策或反向換裝。
  },
);

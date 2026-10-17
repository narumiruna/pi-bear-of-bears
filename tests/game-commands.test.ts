import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import {
  registerGameCommandTools,
  STRUCTURED_COMMANDS,
  STRUCTURED_TOOL_NAMES,
  serializeCommand,
} from "../src/game-commands.js";
import { toolResult } from "../src/output.js";

const samples: Record<string, [Record<string, unknown>, string]> = {
  inventory: [{ all: true }, "/inventory all"],
  inspect: [{ item: 3 }, "/inspect 3"],
  finger: [{ name: "なるみ" }, "/finger なるみ"],
  go: [{ direction: "上" }, "/go 上"],
  attack: [{ target: "荒原巨角獸" }, "/attack 荒原巨角獸"],
  skill: [{ name: "連環爪擊" }, "/skill 連環爪擊"],
  use: [{ item: "恢復藥" }, "/use 恢復藥"],
  equip: [{ item: 2 }, "/equip 2"],
  switch: [{ name: "なるみ_狂戰熊" }, "/switch なるみ_狂戰熊"],
  create: [{ name: "小熊", profession: "道熊" }, "/create 小熊 道熊"],
  adopt: [{ species: "海豹", name: "小白" }, "/adopt 海豹 小白"],
  feed: [{ name: "小白", food: "飼料" }, "/feed 小白 飼料"],
  play: [{ name: "小白" }, "/play 小白"],
  pat: [{ name: "小白" }, "/pat 小白"],
  say: [{ message: "測試 訊息" }, "/say 測試 訊息"],
  forge_preview: [{ index: 3 }, "/forge preview 3"],
  forge_upgrade: [{ index: 3 }, "/forge 3"],
};

function serialize(key: string, input: unknown) {
  const entry = STRUCTURED_COMMANDS.find((entry) => entry.command === key);
  if (!entry) {
    throw new Error("測試缺少指令");
  }
  return serializeCommand(entry, input);
}

test.each(STRUCTURED_COMMANDS)(
  "/$command 固定序列化並拒絕額外欄位",
  (entry) => {
    const [input, expected] = samples[entry.command] ?? [
      {},
      `/${entry.command}`,
    ];
    expect(serializeCommand(entry, input)).toBe(expected);
    expect(() =>
      serializeCommand(entry, { ...input, text: "/buy 道具" }),
    ).toThrow("Validation failed");
  },
);

test.each([
  ["create", { profession: "道熊", name: "小熊" }, "/create 小熊 道熊"],
  ["adopt", { name: "小白", species: "海豹" }, "/adopt 海豹 小白"],
  ["feed", { food: "飼料", name: "小白" }, "/feed 小白 飼料"],
] as const)(
  "%s 依 schema 宣告順序序列化，不依輸入欄位順序",
  (key, input, expected) => {
    expect(serialize(key, input)).toBe(expected);
  },
);

test("選填參數、整數與名稱兩種物品參照、六方向皆正確", () => {
  expect(serialize("inventory", {})).toBe("/inventory");
  expect(serialize("inventory", { all: false })).toBe("/inventory");
  expect(serialize("auction", {})).toBe("/auction");
  expect(serialize("auction", { view: "browse" })).toBe("/auction");
  expect(serialize("auction", { view: "my" })).toBe("/auction my");
  expect(serialize("attack", {})).toBe("/attack");
  expect(serialize("attack", { target: 2 })).toBe("/attack 2");
  expect(serialize("inspect", { item: "有 空格的裝備" })).toBe(
    "/inspect 有 空格的裝備",
  );
  expect(serialize("feed", { name: "小白" })).toBe("/feed 小白");
  for (const direction of ["北", "南", "東", "西", "上", "下"]) {
    expect(serialize("go", { direction })).toBe(`/go ${direction}`);
  }
});

test.each([
  ["go", { direction: "東北" }],
  ["auction", { view: "sell" }],
  ["auction", { view: "offer" }],
  ["create", { name: "小熊", profession: "狂戰熊" }],
  ["create", { name: "小 熊", profession: "法熊" }],
  ["adopt", { species: "龍", name: "小白" }],
  ["feed", { name: "小白", food: "飼 料" }],
  ["inspect", { item: 0 }],
  ["inspect", { item: -1 }],
  ["inspect", { item: 1.5 }],
  ["inspect", { item: NaN }],
  ["inspect", { item: Infinity }],
  ["forge_upgrade", { index: "1" }],
  ["forge_preview", { index: 2 ** 53 }],
  ["inventory", { all: "true" }],
  ["status", null],
  ["status", []],
  ["inspect", {}],
  ["inspect", { item: "" }],
  ...[
    "/buy 物品",
    "名稱\n/buy 物品",
    "名稱\r/say 訊息",
    "名稱\u0000",
    "名稱\u2028",
    " 名稱",
    "名稱 ",
    "熊".repeat(201),
  ].map((item): [string, unknown] => ["inspect", { item }]),
])("拒絕非法 %s 參數 %j", (key, input) => {
  expect(() => serialize(key as string, input)).toThrow("Validation failed");
});

test("公開訊息驗證完整 Telegram 指令長度上限", () => {
  expect(serialize("say", { message: "熊".repeat(4091) })).toHaveLength(4096);
  expect(() => serialize("say", { message: "熊".repeat(4092) })).toThrow(
    "Validation failed",
  );
});

test("完整涵蓋 /help 非交易入口；未知 /store 不猜語法", () => {
  const excluded = [
    "buy",
    "sell",
    "sellall",
    "auction_sell",
    "auction_offer",
    "store",
  ];
  expect(STRUCTURED_TOOL_NAMES).toHaveLength(
    new Set(STRUCTURED_TOOL_NAMES).size,
  );
  for (const key of excluded) {
    expect(STRUCTURED_TOOL_NAMES).not.toContain(`bears_${key}`);
  }
  const helpCommands =
    "help go look who consider attack skill flee boss boss_build quest status skills bestiary gallery inventory inspect use equip autoequip rest recall recall2 idle idlestatus stopidle mute forge adopt pets feed play pat home expand furn chars create switch advance shop say chat finger top".split(
      " ",
    );
  for (const key of helpCommands) {
    expect(STRUCTURED_TOOL_NAMES).toContain(`bears_${key}`);
  }
});

test("註冊不連線；先驗參數與取消，每次只呼叫共同 send 一次", async () => {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const send = vi.fn(async () => toolResult({ observation: "no_update_yet" }));
  registerGameCommandTools(
    {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    send,
  );
  expect(send).not.toHaveBeenCalled();
  const execute = (name: string, input: unknown, signal?: AbortSignal) => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error("測試缺少工具");
    }
    return tool.execute("test", input, signal, undefined, {} as never);
  };
  await expect(execute("bears_go", { direction: "壞方向" })).rejects.toThrow(
    "Validation failed",
  );
  await expect(
    execute("bears_status", {}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  const result = await execute("bears_go", { direction: "東" });
  expect(send).toHaveBeenCalledExactlyOnceWith("/go 東", undefined);
  expect(result.content[0]).toMatchObject({
    text: '{\n  "observation": "no_update_yet"\n}',
  });
  send.mockRejectedValueOnce(new Error("outcome is unknown"));
  await expect(execute("bears_go", { direction: "東" })).rejects.toThrow(
    "outcome is unknown",
  );
  expect(send).toHaveBeenCalledTimes(2);
});

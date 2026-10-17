import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import {
  registerGameCommandTools,
  STRUCTURED_COMMANDS,
  STRUCTURED_TOOL_NAMES,
  serializeCommand,
} from "../src/game-commands.js";
import { toolResult } from "../src/output.js";

const catalog = JSON.parse(
  readFileSync(
    new URL("./fixtures/game-command-catalog.json", import.meta.url),
    "utf8",
  ),
) as {
  menuCommands: string[];
  helpCommands: string[];
  additionalCommands: string[];
  slashAliases: Record<string, string>;
};
const samples: Record<string, [Record<string, unknown>, string]> = {
  inventory: [{ all: true }, "/inventory all"],
  inspect: [{ item: 3 }, "/inspect 3"],
  consider: [{ target: "荒原巨角獸" }, "/consider 荒原巨角獸"],
  game_history: [{ section: "番外" }, "/history 番外"],
  gearrank: [{ view: "me" }, "/gearrank me"],
  buy: [{ item: "恢復藥" }, "/buy 恢復藥"],
  sell: [{ item: "銅甲" }, "/sell 銅甲"],
  sellall: [{ rarity: "稀有" }, "/sellall 稀有"],
  finger: [{ name: "小熊" }, "/finger 小熊"],
  stock: [{ symbol: "STAR" }, "/stock STAR"],
  go: [{ direction: "上" }, "/go 上"],
  goto: [{ destination: "浮萍潭" }, "/goto 浮萍潭"],
  attack: [{ target: "荒原巨角獸" }, "/attack 荒原巨角獸"],
  skill: [{ name: "連環爪擊" }, "/skill 連環爪擊"],
  use: [{ item: "恢復藥", quantity: 5 }, "/use 恢復藥 5"],
  equip: [{ item: 2 }, "/equip 2"],
  switch: [{ name: "小熊" }, "/switch 小熊"],
  create: [{ name: "小熊", profession: "道熊" }, "/create 小熊 道熊"],
  rename: [{ name: "新小熊" }, "/rename 新小熊"],
  adopt: [{ species: "海豹", name: "小白" }, "/adopt 海豹 小白"],
  release: [{ name: "小白" }, "/release 小白"],
  feed: [{ name: "小白", food: "飼料" }, "/feed 小白 飼料"],
  play: [{ name: "小白" }, "/play 小白"],
  pat: [{ name: "小白" }, "/pat 小白"],
  store: [{ index: 2 }, "/store 2"],
  retrieve: [{ index: 3 }, "/retrieve 3"],
  deposit: [{ amount: 100 }, "/deposit 100"],
  withdraw: [{ amount: 200 }, "/withdraw 200"],
  unlock: [{ item: 2 }, "/unlock 2"],
  unalias: [{ name: "喝" }, "/unalias 喝"],
  lotto: [
    { amount: 50000, numbers: [3, 7, 15, 23, 38] },
    "/lotto 50000 3 7 15 23 38",
  ],
  trade: [
    { symbol: "STAR", side: "多", amount: 200, leverage: 3 },
    "/trade STAR 多 200 3",
  ],
  close: [{ position: 2 }, "/close 2"],
  say: [{ message: "測試 訊息" }, "/say 測試 訊息"],
  forge_preview: [{ index: 3 }, "/forge preview 3"],
  forge_upgrade: [{ index: 3 }, "/forge 3"],
  refine_upgrade: [{ item: "銅甲" }, "/refine 銅甲"],
  dismantle_item: [{ item: 3 }, "/dismantle 3"],
  dismantle_all: [{}, "/dismantle 全部"],
  dismantle_after: [{ index: 3 }, "/dismantle >3"],
  lock_item: [{ index: 3 }, "/lock 3"],
  shards_redeem: [{ index: 3 }, "/shards 3"],
  craft_make: [{ recipe: "A1" }, "/craft A1"],
  craft_store: [{ item: "銅甲" }, "/craft store 銅甲"],
  craft_take: [{ item: 3 }, "/craft take 3"],
  tower_go: [{ floor: 30 }, "/tower go 30"],
  tower_quit: [{}, "/tower quit"],
  config_ui: [{ mode: "easy" }, "/config ui easy"],
  alias_set: [{ name: "喝", command: "use", args: ["20"] }, "/alias 喝=use 20"],
  bebe_travel: [{ destination: "熊魔王" }, "/bebe 熊魔王"],
  bebe_save: [{ name: "村莊" }, "/bebe save 村莊"],
  bebe_list: [{}, "/bebe list"],
  bebe_go: [{ name: "村莊" }, "/bebe go 村莊"],
  bebe_del: [{ name: "村莊" }, "/bebe del 村莊"],
  bebe_stop: [{}, "/bebe stop"],
  auction_sell: [{ item: 3, note: "保留 備註" }, "/auction sell 3 保留 備註"],
  auction_offer: [
    {
      listing: 47,
      offers: [{ item: "王之精魄", quantity: 500 }, { item: "銅甲" }],
    },
    "/auction offer 47 王之精魄x500+銅甲",
  ],
};
const cases = STRUCTURED_COMMANDS.map((entry) => ({
  entry,
  input: samples[entry.command]?.[0] ?? {},
  expected: samples[entry.command]?.[1] ?? `/${entry.command}`,
}));
function serialize(key: string, input: unknown) {
  const entry = STRUCTURED_COMMANDS.find((entry) => entry.command === key);
  if (!entry) {
    throw new Error(`測試缺少指令 ${key}`);
  }
  return serializeCommand(entry, input);
}
function setup() {
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const send = vi.fn(async () => toolResult({ observation: "no_update_yet" }));
  registerGameCommandTools(
    {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    send,
  );
  return { tools, send };
}

test("完整覆蓋即時 Telegram menu、/help、額外已驗命令及 slash aliases，沒有排除清單", () => {
  const roots = new Set([
    ...catalog.menuCommands,
    ...catalog.helpCommands,
    ...catalog.additionalCommands,
    ...Object.keys(catalog.slashAliases),
  ]);
  const actual = new Set(
    STRUCTURED_COMMANDS.map((entry) => entry.prefix.split(" ")[0].slice(1)),
  );
  expect([...actual].sort()).toEqual([...roots].sort());
  for (const key of roots) {
    expect(STRUCTURED_TOOL_NAMES).toContain(
      key === "history" ? "bears_game_history" : `bears_${key}`,
    );
  }
  expect(new Set(STRUCTURED_TOOL_NAMES).size).toBe(
    STRUCTURED_TOOL_NAMES.length,
  );
  expect(catalog.menuCommands.length).toBe(new Set(catalog.menuCommands).size);
  for (const key of Object.keys(samples)) {
    expect(STRUCTURED_TOOL_NAMES).toContain(`bears_${key}`);
  }
});

test("完整文件的 tool 名稱及 Telegram prefix 與註冊目錄逐項一致", () => {
  const reference = readFileSync(
    new URL(
      "../skills/playing-bear-of-bears/references/structured-tools.md",
      import.meta.url,
    ),
    "utf8",
  );
  const rows = [
    ...reference.matchAll(/^\| `(bears_[a-z0-9_]+)` \| `([^`]+)` \|/gm),
  ].map((match) => [match[1], match[2]]);
  expect(rows).toEqual(
    STRUCTURED_COMMANDS.map((entry) => [
      `bears_${entry.command}`,
      entry.prefix,
    ]),
  );
});

test.each(cases)(
  "$entry.command 固定序列化並拒絕額外欄位",
  ({ entry, input, expected }) => {
    expect(serializeCommand(entry, input)).toBe(expected);
    expect(() =>
      serializeCommand(entry, { ...input, text: "/buy 道具" }),
    ).toThrow("Validation failed");
    for (const invalid of [null, [], "", 1]) {
      expect(() => serializeCommand(entry, invalid)).toThrow(
        "Validation failed",
      );
    }
  },
);

test.each(cases)(
  "$entry.command 註冊為 codemode tool；驗參數、取消、單次送出及不明結果不重試",
  async ({ entry, input, expected }) => {
    const { tools, send } = setup();
    expect([...tools.keys()]).toEqual(STRUCTURED_TOOL_NAMES);
    const tool = tools.get(`bears_${entry.command}`);
    if (!tool) {
      throw new Error(`缺少已註冊 tool bears_${entry.command}`);
    }
    expect(tool.exposure).toBe("codemode");
    expect(tool.promptGuidelines?.join(" ")).toContain(
      "工具可用不代表已獲操作授權",
    );
    expect(tool.description).toContain("不自動重試");
    expect(send).not.toHaveBeenCalled();
    const execute = (params: unknown, signal?: AbortSignal) =>
      tool.execute("test", params, signal, undefined, {} as never);
    await expect(execute({ ...input, extra: true })).rejects.toThrow(
      "Validation failed",
    );
    await expect(execute(input, AbortSignal.abort())).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    const result = await execute(input);
    expect(send).toHaveBeenCalledExactlyOnceWith(expected, undefined);
    expect(result.content[0]).toMatchObject({
      text: '{\n  "observation": "no_update_yet"\n}',
    });
    send.mockRejectedValueOnce(new Error("outcome is unknown"));
    await expect(execute(input)).rejects.toThrow("outcome is unknown");
    expect(send).toHaveBeenCalledTimes(2);
  },
);

test.each([
  ["create", { profession: "道熊", name: "小熊" }, "/create 小熊 道熊"],
  ["adopt", { name: "小白", species: "海豹" }, "/adopt 海豹 小白"],
  ["feed", { food: "飼料", name: "小白" }, "/feed 小白 飼料"],
  ["use", { quantity: "滿", item: "龍骨藥水" }, "/use 龍骨藥水 滿"],
  [
    "trade",
    { leverage: 2, amount: 100, side: "空", symbol: "STAR" },
    "/trade STAR 空 100 2",
  ],
  [
    "auction_offer",
    { offers: [{ quantity: 2, item: "王之精魄" }], listing: 3 },
    "/auction offer 3 王之精魄x2",
  ],
] as const)("%s 依 schema 順序序列化", (key, input, expected) => {
  expect(serialize(key, input)).toBe(expected);
});

test.each([
  ["inventory", {}, "/inventory"],
  ["inventory", { all: false }, "/inventory"],
  ["auction", {}, "/auction"],
  ["auction", { view: "browse" }, "/auction"],
  ["auction", { view: "my" }, "/auction my"],
  ["consider", {}, "/consider"],
  ["consider", { target: 2 }, "/consider 2"],
  ["attack", {}, "/attack"],
  ["attack", { target: 2 }, "/attack 2"],
  ["buy", {}, "/buy"],
  ["buy", { item: "有 空格的物品" }, "/buy 有 空格的物品"],
  ["sell", { item: 2 }, "/sell 2"],
  ["sellall", { rarity: "史詩" }, "/sellall 史詩"],
  ["sellall", { rarity: "全部" }, "/sellall 全部"],
  ["inspect", { item: "有 空格的裝備" }, "/inspect 有 空格的裝備"],
  ["use", { item: 2 }, "/use 2"],
  ["use", { item: "龍骨藥水", quantity: "滿" }, "/use 龍骨藥水 滿"],
  ["equip", {}, "/equip"],
  ["switch", {}, "/switch"],
  ["goto", {}, "/goto"],
  ["game_history", {}, "/history"],
  ["gearrank", {}, "/gearrank"],
  ["feed", { name: "小白" }, "/feed 小白"],
  ["forge_preview", {}, "/forge preview"],
  ["refine_upgrade", { item: 2 }, "/refine 2"],
  ["dismantle_item", { item: "銅甲" }, "/dismantle 銅甲"],
  ["craft_store", { item: 2 }, "/craft store 2"],
  ["craft_take", { item: "銅甲" }, "/craft take 銅甲"],
  ["tower_go", {}, "/tower go"],
  ["config_ui", { mode: "full" }, "/config ui full"],
  ["alias_set", { name: "狀態", command: "status" }, "/alias 狀態=status"],
  ["auction_sell", {}, "/auction sell"],
  ["auction_sell", { item: "銅甲" }, "/auction sell 銅甲"],
  ["lotto", { amount: 50000 }, "/lotto 50000"],
  ["trade", { symbol: "1", side: "現貨", amount: 100 }, "/trade 1 現貨 100"],
  ["unlock", { item: "銅甲" }, "/unlock 銅甲"],
  ...["北", "南", "東", "西", "上", "下"].map((direction) => [
    "go",
    { direction },
    `/go ${direction}`,
  ]),
] as [string, Record<string, unknown>, string][])(
  "%s 支援已觀察的選填／替代引數 %j",
  (key, input, expected) => {
    expect(serialize(key, input)).toBe(expected);
  },
);

test.each([
  ["go", { direction: "東北" }],
  ["auction", { view: "sell" }],
  ["auction", { view: "offer" }],
  ["buy", { item: 1 }],
  ["sell", {}],
  ["sellall", {}],
  ["sellall", { rarity: "傳說" }],
  ["sellall", { rarity: "稀有\n/say 訊息" }],
  ["create", { name: "小熊", profession: "狂戰熊" }],
  ["create", { name: "小 熊", profession: "法熊" }],
  ["adopt", { species: "龍", name: "小白" }],
  ["feed", { name: "小白", food: "飼 料" }],
  ["inspect", {}],
  ["inventory", { all: "true" }],
  ["forge_upgrade", { index: "1" }],
  ["forge_preview", { index: 2 ** 53 }],
  ["use", { item: 2, quantity: "全部" }],
  ["craft_make", { recipe: "store" }],
  ["craft_make", { recipe: "A0" }],
  ["config_ui", { mode: "other" }],
  ["gearrank", { view: "all" }],
  ["dismantle_item", { item: "全部" }],
  ["dismantle_item", { item: ">3" }],
  ["bebe_travel", { destination: "stop" }],
  ["bebe_travel", { destination: "save 家" }],
  ["alias_set", { name: "喝=use", command: "20" }],
  ["alias_set", { name: "喝", command: "/use" }],
  ["alias_set", { name: "喝", command: "use", args: [" 20"] }],
  ["alias_set", { name: "喝", command: "use", args: ["20\n/say 訊息"] }],
  ["auction_sell", { note: "沒有物品" }],
  ["auction_offer", { listing: 1, offers: [] }],
  ["auction_offer", { listing: 1, offers: [{ item: "王之精魄+銅甲" }] }],
  ["auction_offer", { listing: 1, offers: [{ item: "王之精魄x2" }] }],
  ["auction_offer", { listing: 1, offers: [{ item: " 王之精魄" }] }],
  [
    "auction_offer",
    { listing: 1, offers: [{ item: "王之精魄", extra: true }] },
  ],
  ["trade", { symbol: "STAR", side: "買", amount: 1 }],
  ["trade", { symbol: "STAR", side: "多", amount: 1, leverage: 4 }],
  ["trade", { symbol: "STAR", side: "多", amount: 1, leverage: 1.5 }],
  ["lotto", { amount: 1, numbers: [1, 2, 3, 4] }],
  ["lotto", { amount: 1, numbers: [1, 2, 3, 4, 4] }],
  ["lotto", { amount: 1, numbers: [0, 2, 3, 4, 5] }],
  ["lotto", { amount: 1, numbers: [1, 2, 3, 4, 40] }],
  ...[0, -1, 1.5, NaN, Infinity, 2 ** 53].flatMap((value) => [
    ["inspect", { item: value }],
    ["deposit", { amount: value }],
    ["withdraw", { amount: value }],
    ["store", { index: value }],
    ["retrieve", { index: value }],
    ["close", { position: value }],
    ["tower_go", { floor: value }],
    ["use", { item: 2, quantity: value }],
    [
      "auction_offer",
      { listing: 1, offers: [{ item: "銅甲", quantity: value }] },
    ],
  ]),
  ...["buy", "sell", "inspect"].flatMap((key) =>
    [
      "",
      "/sellall 全部",
      "名稱\n/buy 物品",
      "名稱\r/say 訊息",
      "名稱\u0000",
      "名稱\u2028",
      " 名稱",
      "名稱 ",
      "熊".repeat(201),
    ].map((item) => [key, { item }]),
  ),
] as [string, unknown][])(
  "拒絕非法 %s 參數 %j，且不送出",
  async (key, input) => {
    expect(() => serialize(key, input)).toThrow("Validation failed");
    const { tools, send } = setup();
    await expect(
      tools
        .get(`bears_${key}`)
        ?.execute("test", input, undefined, undefined, {} as never),
    ).rejects.toThrow("Validation failed");
    expect(send).not.toHaveBeenCalled();
  },
);

test("所有文字路徑共用 Telegram 長度上限，含巢狀出價及快捷", () => {
  expect(serialize("say", { message: "熊".repeat(4091) })).toHaveLength(4096);
  expect(() => serialize("say", { message: "熊".repeat(4092) })).toThrow(
    "Validation failed",
  );
  expect(() =>
    serialize("alias_set", {
      name: "喝",
      command: "use",
      args: new Array(30).fill("熊".repeat(200)),
    }),
  ).toThrow("指令超過 4096");
  expect(() =>
    serialize("auction_offer", {
      listing: 1,
      offers: new Array(30).fill({ item: "熊".repeat(200) }),
    }),
  ).toThrow("指令超過 4096");
});

test("提供交易 tools 不解除授權或既有禁令；查詢與付款分開", () => {
  const { tools } = setup();
  for (const key of [
    "buy",
    "sell",
    "sellall",
    "auction_sell",
    "auction_offer",
    "trade",
    "close",
    "lotto",
    "release",
  ]) {
    expect(tools.get(`bears_${key}`)?.description).toContain(
      "適用交易禁令優先",
    );
    expect(tools.get(`bears_${key}`)?.description).toContain(
      "須另有使用者明確授權",
    );
  }
  for (const key of [
    "forge",
    "refine",
    "dismantle",
    "craft",
    "shards",
    "tower",
    "lock",
    "config",
    "alias",
    "auction",
  ]) {
    expect(serialize(key, {})).toBe(`/${key}`);
    expect(
      STRUCTURED_COMMANDS.find((entry) => entry.command === key)?.description,
    ).not.toContain("會改變遊戲狀態");
  }
  for (const key of [
    "forge_upgrade",
    "refine_upgrade",
    "dismantle_item",
    "dismantle_all",
    "dismantle_after",
    "craft_make",
    "shards_redeem",
    "tower_go",
    "lock_item",
    "config_ui",
    "alias_set",
    "auction_sell",
    "auction_offer",
  ]) {
    expect(
      STRUCTURED_COMMANDS.find((entry) => entry.command === key)?.description,
    ).toContain("會改變遊戲狀態");
  }
});

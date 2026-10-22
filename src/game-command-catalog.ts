import { type TObject, type TProperties, Type } from "typebox";

// 來源：Telegram command menu、/help 729558 及 commands.md 的已觀察語法。
const name = (maxLength = 200) =>
  Type.String({
    minLength: 1,
    maxLength,
    pattern: "^[^/\\s][^\\u0000-\\u001f\\u007f\\u2028\\u2029]*$",
  });
const token = () =>
  Type.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[^/\\s\\u0000-\\u001f\\u007f]+$",
  });
const positive = () =>
  Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const item = () => Type.Union([positive(), name()]);
const choice = (values: string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const authorization =
  "會改變遊戲狀態；須有使用者對此操作的授權，先核對本人資源、費用與副作用。";
const specialAuthorization =
  "須另有使用者明確授權；本 tool 的存在及參數不構成授權。";
const tradeAuthorization = `適用交易禁令優先。${specialAuthorization}`;

export interface Command {
  command: string;
  prefix: string;
  description: string;
  parameters: TObject;
}
function command(
  commandName: string,
  description: string,
  properties: TProperties = {},
  prefix = `/${commandName}`,
): Command {
  return {
    command: commandName,
    prefix,
    description,
    parameters: Type.Object(properties, { additionalProperties: false }),
  };
}
function action(
  commandName: string,
  description: string,
  properties: TProperties = {},
  prefix?: string,
): Command {
  return command(
    commandName,
    `${description} ${authorization}`,
    properties,
    prefix,
  );
}

export const GAME_COMMANDS: readonly Command[] = [
  ...[
    ["help", "讀取遊戲指令說明。"],
    ["look", "查看目前房間、怪物與出口。"],
    ["who", "查看同房間玩家。"],
    ["boss", "查看 BOSS 位置與掉落；不證明即時存活。"],
    ["boss_build", "查看頂階系列流派指南。"],
    ["boss_respawn", "查看 BOSS 存活與重生倒數；不輪詢等待。"],
    ["worldboss", "查看世界王血量、貢獻與倒數；不攻擊、不輪詢。"],
    ["quest", "查看新手任務與進度。"],
    ["status", "查看目前角色屬性、資源與掛機狀態。"],
    ["skills", "查看技能與消耗，不施放技能。"],
    ["bestiary", "查看已擊敗怪物圖鑑。"],
    ["gallery", "查看 concept-art 收藏；不下載圖片。"],
    ["titles", "查看稱號收藏與解鎖條件。"],
    ["gear", "查看各部位目前裝備。"],
    ["potions", "查看藥水與消耗品。"],
    ["idlestatus", "查看掛機預估進度，不結算。"],
    ["pets", "查看寵物狀態。"],
    ["home", "查看家園與已持有家具。"],
    ["vault", "查看珍藏保存庫，不存入或取回。"],
    ["chars", "查看角色清單，不切換或刪除。"],
    ["chat", "查看近期玩家聊天，不公開發言。"],
    ["top", "查看英雄排行榜。"],
    ["story", "查看青春物語進度與回憶。"],
    ["journal", "查看尋寶奇譚日誌與回憶。"],
    ["shop", "僅開啟目前位置的商店目錄，不購買或販售。"],
    ["furn", "僅開啟家具目錄，不點選購買。"],
    ["market", "查看交易所行情；不下單，遠端資格以即時回覆為準。"],
    ["positions", "查看本人持倉與掛單，不平倉或交易。"],
    ["craft", "查看合成配方、持有材料與報價，不合成。"],
    ["craft_inventory", "查看合成保管區，不存入或取回。"],
    ["shards", "查看裝備碎片與兌換編號，不兌換。"],
    ["config", "查看介面設定，不修改。"],
    ["alias", "查看自訂快捷，不建立或執行快捷。"],
    ["bebe", "查看 BeBeMove 護送用法，不啟動移動。"],
    ["tower", "查看星塔狀態、入場費與可選起始樓層，不入塔。"],
  ].map(([key, description]) => command(key, description)),
  command("consider", "評估指定目標勝算；不保證安全或必勝。", {
    target: Type.Optional(item()),
  }),
  // bears_history 保留給 Telegram 聊天紀錄，避免覆寫既有觀測工具。
  command(
    "game_history",
    "查看世界正史；不是 Telegram 聊天紀錄，引數是否篩選以回覆為準。",
    {
      section: Type.Optional(name()),
    },
    "/history",
  ),
  command("gearrank", "查看身上裝備力榜或本人逐件評分。", {
    view: Type.Optional(choice(["me"])),
  }),
  command("inventory", "查看背包；配裝使用 all=true 並核對全列完整性。", {
    all: Type.Optional(Type.Boolean()),
  }),
  command("inspect", "查看物品；編號須綁定最新背包，名稱不證明本人持有。", {
    item: item(),
  }),
  command("finger", "查看指定玩家的位置與活動。", { name: name() }),
  command("stock", "查看指定公司的 K 線圖，不下單。", { symbol: token() }),
  command("forge", "只查看王裝進階選單；付款另用 bears_forge_upgrade。"),
  command("refine", "只查看穿戴裝備的精煉需求，不精煉；報價不保證含稅。"),
  command("dismantle", "只查看分解清單及收益，不銷毀物品。"),
  command("lock", "只查看已鎖定物品，不更改鎖定。"),
  command("auction", "只查掛牌或本人掛牌／offer，不新增、接受或撤回交易。", {
    view: Type.Optional(choice(["browse", "my"])),
  }),
  action(
    "buy",
    `購買指定物品；省略 item 只開商店選單。先核即時價格與數量。${tradeAuthorization}`,
    {
      item: Type.Optional(name()),
    },
  ),
  action(
    "sell",
    `販售指定物品；先核最新背包、數量、售價與保留用途。${tradeAuthorization}`,
    {
      item: item(),
    },
  ),
  action(
    "sellall",
    `批次販售指定稀有度及更低裝備；先核預覽與保留項目。史詩僅限確認未二轉者；全部受既有禁止使用規則限制。${tradeAuthorization}`,
    {
      rarity: choice(["稀有", "史詩", "全部"]),
    },
  ),
  action("go", "依已觀察出口逐房移動；會結算並結束掛機。", {
    direction: choice(["北", "南", "東", "西", "上", "下"]),
  }),
  action(
    "goto",
    "使用傳送券快速旅行；省略 destination 開選單，不視為免費步行。",
    {
      destination: Type.Optional(name()),
    },
  ),
  action(
    "attack",
    "攻擊指定怪物；省略 target 選最弱者。先核現身與安全；會結束掛機。",
    {
      target: Type.Optional(item()),
    },
  ),
  action("skill", "施放已確認技能；先核 MP、目標與安全，會結束掛機。", {
    name: name(),
  }),
  ...[
    [
      "start",
      `開啟入門或角色資訊；無角色時可能開始建立流程。${specialAuthorization}`,
    ],
    ["flee", "嘗試逃離戰鬥，須確認結果。"],
    ["rest", "在安全區恢復。"],
    ["recall", "傳送回熊熊村廣場；有冷卻，不推定掛機已結算。"],
    ["recall2", "傳送中央中繼站；有冷卻，不推定掛機已結算。"],
    ["recall3", "傳送星淵地底營地；有冷卻，不推定掛機已結算。"],
    ["autoequip", "僅目前角色使用遊戲端一鍵裝備，不做多角色輪值。"],
    [
      "idle",
      "僅目前角色啟動原生持續掛機；須明確授權，不等同全角色 start_idle。",
    ],
    ["stopidle", "僅目前角色停止掛機並結算；不等同全角色 stop_idle。"],
    ["mute", `切換每小時戰報設定。${specialAuthorization}`],
    [
      "expand",
      `付費擴建家園，不是預覽；先核當次價格及上限。${specialAuthorization}`,
    ],
    [
      "advance",
      `開啟不可逆二轉流程；/help 標示 2,000,000G，仍須即時核價。${specialAuthorization}`,
    ],
    ["talk", "與現場 NPC 對話；可能接任務或推進劇情，不是純查詢。"],
    ["gift", `送禮給現場 NPC，可能消耗物品與每日額度。${specialAuthorization}`],
    [
      "lottovip",
      `開啟熊樂透 VIP 兌換；可能領取限次獎勵，不下注。${specialAuthorization}`,
    ],
  ].map(([key, description]) => action(key, description)),
  action(
    "use",
    "使用並消耗物品；quantity 可為正整數或滿，先核實際效果及用量。",
    {
      item: item(),
      quantity: Type.Optional(Type.Union([positive(), Type.Literal("滿")])),
    },
  ),
  action(
    "equip",
    "更換本人裝備；省略 item 開選單。先核最新背包、資格與效果取捨。",
    {
      item: Type.Optional(item()),
    },
  ),
  action(
    "switch",
    "切換既有角色；省略 name 列出選單。先核戰鬥／星塔中斷與前角持續掛機。",
    {
      name: Type.Optional(name()),
    },
  ),
  action("create", `建立並切換角色。${specialAuthorization}`, {
    name: token(),
    profession: choice(["戰熊", "法熊", "道熊"]),
  }),
  action("rename", `消耗改名卷變更目前角色名稱。${specialAuthorization}`, {
    name: token(),
  }),
  action("adopt", `領養寵物；先核資格、費用與容量。${specialAuthorization}`, {
    species: choice(["狗", "貓", "小鳥", "魚", "海豹"]),
    name: token(),
  }),
  action(
    "release",
    `歸還指定寵物並退部分費用，會移除寵物。${tradeAuthorization}`,
    { name: token() },
  ),
  action("feed", "餵食寵物，可能消耗飼料。", {
    name: token(),
    food: Type.Optional(token()),
  }),
  action("play", "陪指定寵物玩耍。", { name: token() }),
  action("pat", "撫摸指定動物。", { name: token() }),
  action("store", "存入珍藏；index 綁定最新背包，須在家園。", {
    index: positive(),
  }),
  action(
    "retrieve",
    "取回珍藏；index 綁定最新保存庫，不是背包編號，須在家園。",
    { index: positive() },
  ),
  action("deposit", "將本人金幣存入同角色家園；先核餘額、費用與金庫規則。", {
    amount: positive(),
  }),
  action(
    "withdraw",
    `從本人家園提款；存款授權不包含提款。${specialAuthorization}`,
    { amount: positive() },
  ),
  action("unlock", "解除物品鎖定；會失去批次處置保護。", { item: item() }),
  action("unalias", `刪除自訂快捷，不執行快捷。${specialAuthorization}`, {
    name: token(),
  }),
  action(
    "lotto",
    `購買熊彩539；省略 numbers 使用電腦選號。先核投注金額與資格。${tradeAuthorization}`,
    {
      amount: positive(),
      numbers: Type.Optional(
        Type.Array(Type.Integer({ minimum: 1, maximum: 39 }), {
          minItems: 5,
          maxItems: 5,
          uniqueItems: true,
        }),
      ),
    },
  ),
  action(
    "trade",
    `提交股票訂單；先核公司、方向、金額、槓桿、稅及成交規則。${tradeAuthorization}`,
    {
      symbol: token(),
      side: choice(["多", "空", "現貨"]),
      amount: positive(),
      leverage: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
    },
  ),
  action(
    "close",
    `平倉指定持倉，可能產生稅與損失；不是關閉視窗。${tradeAuthorization}`,
    { position: positive() },
  ),
  action("say", `向全伺服器公開廣播，不是 NPC 答題。${specialAuthorization}`, {
    message: name(4091),
  }),
];

const forgeIndex = { index: positive() };
export const FORGE_COMMANDS: readonly Command[] = [
  command(
    "forge_preview",
    "免費預覽王裝進階；報價可能漏稅，不是完整費用證明。",
    { index: Type.Optional(positive()) },
    "/forge preview",
  ),
  action(
    "forge_upgrade",
    "不可逆進階王裝；先核最新編號、完整含稅費用、材料、淨收益與自動換裝。",
    forgeIndex,
    "/forge",
  ),
];

export const SUBCOMMANDS: readonly Command[] = [
  action(
    "refine_upgrade",
    "付費精煉穿戴裝備；先核完整含稅成本、預期效果與不可逆消耗。",
    { item: item() },
    "/refine",
  ),
  action(
    "dismantle_item",
    "按已核唯一名稱不可逆分解單件；數字編號會整組分解，已禁用。先核名稱、實際數量及保留量；同名分組不明時停止，不改用批次處置繞過。保留所需裝備與技能。",
    { item: name() },
    "/dismantle",
  ),
  action(
    "dismantle_all",
    "不可逆批次分解；必須逐項核實投入、收益與保留用途。",
    {},
    "/dismantle 全部",
  ),
  action(
    "dismantle_after",
    "不可逆批次分解 >編號 的範圍；先核當次清單及全部受影響物品。",
    forgeIndex,
    "/dismantle",
  ),
  action(
    "lock_item",
    "鎖定最新背包編號的物品以保留；完成後驗證鎖定狀態。",
    forgeIndex,
    "/lock",
  ),
  action(
    "shards_redeem",
    "消耗當次清單的裝備碎片兌換；先核編號、數量、所得與副作用。",
    forgeIndex,
    "/shards",
  ),
  action(
    "craft_make",
    "省略 confirm 僅預覽配方，不消耗；confirm=確定 執行不可逆合成，材料含絕世須用 確定燒絕世。先逐筆核對最新預覽的永久消耗品項、精魄、完整含稅費用與保留用途；非絕世優先不代表可犧牲所需裝備。不得自動接續確認或因被擋而升級確認。",
    {
      recipe: Type.String({ pattern: "^[A-E][1-9][0-9]*$", maxLength: 20 }),
      confirm: Type.Optional(choice(["確定", "確定燒絕世"])),
    },
    "/craft",
  ),
  action(
    "craft_store",
    "將本人裝備存入合成保管區；先核背包品項與保留用途，不跨角色。",
    { item: item() },
    "/craft store",
  ),
  action(
    "craft_take",
    "從合成保管區取回本人裝備；編號須綁定保管區，不是背包。",
    { item: item() },
    "/craft take",
  ),
  action(
    "tower_go",
    "進入星塔；先核當次免費資格或完整金幣／材料費與起始樓層。",
    { floor: Type.Optional(positive()) },
    "/tower go",
  ),
  action(
    "tower_quit",
    "正式結束星塔挑戰；保留最佳紀錄，重新入塔可能再次付費。",
    {},
    "/tower quit",
  ),
  action(
    "config_ui",
    `切換介面顯示設定，不改遊戲戰鬥能力。${specialAuthorization}`,
    { mode: choice(["easy", "full"]) },
    "/config ui",
  ),
  action(
    "alias_set",
    `設定自訂快捷，日後輸入名稱可能觸發狀態變更或花費；不因此授權執行。${specialAuthorization}`,
    {
      name: token(),
      command: token(),
      args: Type.Optional(Type.Array(token())),
    },
    "/alias",
  ),
  action(
    "bebe_travel",
    "啟動 BeBeMove 自動護送；先核目的地、運送券／金幣與中斷掛機副作用。",
    { destination: name() },
    "/bebe",
  ),
  action(
    "bebe_save",
    `收藏目前地點，不啟動護送。${specialAuthorization}`,
    { name: name() },
    "/bebe save",
  ),
  command("bebe_list", "查看 BeBeMove 收藏地點，不移動。", {}, "/bebe list"),
  action(
    "bebe_go",
    "啟動前往收藏地點的自動護送；先核當次費用與副作用。",
    { name: name() },
    "/bebe go",
  ),
  action(
    "bebe_del",
    `刪除指定收藏地點，不啟動護送。${specialAuthorization}`,
    { name: name() },
    "/bebe del",
  ),
  action(
    "bebe_stop",
    "停止目前 BeBeMove 護送；確認實際位置及是否仍在掛機。",
    {},
    "/bebe stop",
  ),
  action(
    "auction_sell",
    `上架並託管物品；省略 item 開選單，點選可能直接上架。先核完整費用與保留用途。${tradeAuthorization}`,
    {
      item: Type.Optional(item()),
      note: Type.Optional(name()),
    },
    "/auction sell",
  ),
  action(
    "auction_offer",
    `以裝備／材料出價並託管；先核掛牌、本人品項、數量及期限。${tradeAuthorization}`,
    {
      listing: positive(),
      offers: Type.Array(
        Type.Object(
          {
            item: name(),
            quantity: Type.Optional(positive()),
          },
          { additionalProperties: false },
        ),
        { minItems: 1 },
      ),
    },
    "/auction offer",
  ),
];

// slash aliases 也提供 tool；一般中文快捷與 MUD 方向由既有 canonical tool 表達。
const ALIAS_COMMANDS = [
  command("cinv", "查看合成保管區；/craft_inventory 的別名。"),
  command("wb", "查看世界王看板；/worldboss 的別名，不輪詢。"),
  command("tw", "查看星塔狀態；/tower 的別名，不入塔。"),
  command("l", "查看周圍；/look 的別名。"),
  command("ls", "查看周圍；/look 的別名。"),
];
export const STRUCTURED_COMMANDS = [
  ...GAME_COMMANDS,
  ...FORGE_COMMANDS,
  ...SUBCOMMANDS,
  ...ALIAS_COMMANDS,
];
export const STRUCTURED_TOOL_NAMES = STRUCTURED_COMMANDS.map(
  (entry) => `bears_${entry.command}`,
);

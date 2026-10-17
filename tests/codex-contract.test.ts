import { expect, test, vi } from "vitest";
import {
  PublicCodex,
  parseCodex as parsePublicCodex,
} from "../extensions/codex-client.js";
import { Codex, parseCodex } from "../src/codex.js";

const drop = {
  name: "孢子法杖",
  emoji: "🍄",
  slot: "weapon",
  stats: "INT+110",
  stats_god: "INT+204",
  rarity: "legend",
  rtag: "🟠",
  passive: "被動",
  grant_skill: "孢子爆發",
  prob_pct: 6,
  material: false,
};
const boss = {
  boss: "孢子母體",
  emoji: "🍄",
  series: "孢子",
  art: "boss-02",
  loc: "孢子母巢",
  template_id: 35,
  level: 89,
  mythic_kill_pct: 0,
  drops: [drop],
};
const material = { name: "神話魔刃", emoji: "🌑", qty: 1 };
const recipe = {
  id: "A1",
  style: "A",
  style_name: "套裝融合",
  out_name: "融合核心",
  out_emoji: "💚",
  out_slot: "accessory",
  out_stats: "INT+720",
  out_passive: "真傷12%",
  rtag: "💚",
  essence: 40,
  gold: 4_000_000,
  materials: [material],
};
const evolution = { suffix: "·神", mult: 1.6, essence: 40, gold: 2_500_000 };
const fixture = {
  bosses: [boss],
  recipes: [recipe],
  evo: { mythic: [evolution] },
};

test("共用欄位不合併 client 的 query 正規化、offset 政策或快取", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(fixture));
  const main = new Codex(fetcher);
  const standalone = new PublicCodex(fetcher);
  expect((await main.lookup({ query: " 孢子 " })).total).toBe(0);
  expect((await standalone.lookup({ query: " 孢子 " })).total).toBe(1);
  expect((await main.lookup({ offset: -1 })).entries).toEqual([boss]);
  await expect(standalone.lookup({ offset: -1 })).rejects.toThrow(
    new Error("offset 必須是非負整數。"),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

// 不由共用欄位表建立預期值，確保契約意外變更會使測試失敗。
test.each([parseCodex, parsePublicCodex])(
  "圖鑑 parser 保留五組欄位、JSON 欄位順序並排除額外資料：%#",
  (parse) => {
    const input = {
      players: [{ name: "不應輸出" }],
      bosses: [
        {
          ...boss,
          private: "不應輸出",
          drops: [{ ...drop, private: "不應輸出" }],
        },
      ],
      recipes: [
        {
          ...recipe,
          private: "不應輸出",
          materials: [{ ...material, private: "不應輸出" }],
        },
      ],
      evo: { mythic: [{ ...evolution, private: "不應輸出" }] },
    };
    expect(JSON.stringify(parse(input))).toBe(
      JSON.stringify({
        bosses: [boss],
        recipes: [recipe],
        evolution: [evolution],
      }),
    );
  },
);

test.each([
  [
    { ...drop, name: undefined, material: undefined },
    "掉落材料標記格式錯誤。",
    "公開圖鑑欄位錯誤：name",
  ],
  [
    { ...drop, name: undefined },
    "公開資料欄位錯誤：name",
    "公開圖鑑欄位錯誤：name",
  ],
  [
    { ...drop, material: undefined },
    "掉落材料標記格式錯誤。",
    "掉落機率或材料標記格式錯誤。",
  ],
  [
    { ...drop, prob_pct: 101 },
    "掉落機率超出範圍。",
    "掉落機率或材料標記格式錯誤。",
  ],
  [
    { ...drop, prob_pct: "6" },
    "公開資料欄位錯誤：prob_pct",
    "公開圖鑑欄位錯誤：prob_pct",
  ],
])(
  "兩個 parser 保留各自的錯誤訊息與驗證順序：%#",
  (invalidDrop, mainError, publicError) => {
    const input = { ...fixture, bosses: [{ ...boss, drops: [invalidDrop] }] };
    expect(() => parseCodex(input)).toThrow(new Error(mainError));
    expect(() => parsePublicCodex(input)).toThrow(new Error(publicError));
  },
);

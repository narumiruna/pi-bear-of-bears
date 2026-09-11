import { afterEach, expect, test, vi } from "vitest";
import { CODEX_URL, Codex, parseCodex } from "../src/codex.js";

const drop = {
  name: "孢子法杖",
  emoji: "🍄",
  slot: "weapon",
  stats: "INT+110",
  stats_god: "INT+204",
  rarity: "legend",
  rtag: "🟠",
  passive: "",
  grant_skill: "孢子爆發",
  prob_pct: 6,
  material: false,
};
const boss = {
  template_id: 35,
  boss: "孢子母體",
  emoji: "🍄",
  level: 89,
  series: "孢子",
  art: "boss-02",
  loc: "孢子母巢",
  mythic_kill_pct: 0,
  drops: [drop],
};
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
  materials: [{ name: "神話魔刃", emoji: "🌑", qty: 1 }],
};
const data = {
  bosses: [boss],
  recipes: [recipe],
  evo: { mythic: [{ suffix: "·神", mult: 1.6, essence: 40, gold: 2_500_000 }] },
  players: [{ name: "不應輸出" }],
};
afterEach(() => vi.restoreAllMocks());

test("保留圖鑑數值、配方與進化費用，排除無關欄位", () => {
  const result = parseCodex(data);
  expect(result.bosses[0].drops[0]).toEqual(drop);
  expect(result.recipes[0]).toEqual(recipe);
  expect(result.evolution[0].mult).toBe(1.6);
  expect(result).not.toHaveProperty("players");
});

test("搜尋掉落、技能與配方材料，使用固定 URL 並快取 12 秒", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(data));
  const codex = new Codex(fetcher);
  expect((await codex.lookup({ query: "int" })).total).toBe(1);
  expect((await codex.lookup({ query: "孢子爆發" })).total).toBe(1);
  expect(
    (await codex.lookup({ recipes: true, query: "神話魔刃" })).entries,
  ).toEqual([recipe]);
  expect((await codex.lookup({ query: "無此物品" })).total).toBe(0);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(CODEX_URL);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
  });
  now.mockReturnValue(13_000);
  await codex.lookup({});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("每頁 10 筆，最後一頁及超出範圍不再提供下一頁", async () => {
  const codex = new Codex(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ...data, bosses: new Array(11).fill(boss) }),
      ),
  );
  expect((await codex.lookup({})).nextOffset).toBe(10);
  const last = await codex.lookup({ offset: 10 });
  expect(last.entries).toHaveLength(1);
  expect(last.nextOffset).toBeNull();
  expect((await codex.lookup({ offset: 20 })).entries).toEqual([]);
});

test("拒絕錯誤 schema 與機率", () => {
  for (const value of [
    null,
    {},
    { ...data, recipes: {} },
    { ...data, bosses: [{ ...boss, level: "89" }] },
    { ...data, bosses: [{ ...boss, drops: [{ ...drop, prob_pct: 101 }] }] },
  ]) {
    expect(() => parseCodex(value)).toThrow();
  }
});

test("HTTP、空回覆、JSON 與大小錯誤不重試", async () => {
  for (const response of [
    new Response(null),
    new Response("", { status: 503 }),
    new Response("invalid"),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(new Codex(fetcher).lookup({})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  }
});

test("取消操作時不發出請求，已有快取也不回傳", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
  const codex = new Codex(fetcher);
  await expect(codex.lookup({}, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await codex.lookup({});
  await expect(codex.lookup({}, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

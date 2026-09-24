import { expect, test, vi } from "vitest";
import { PublicCodex, parseCodex } from "../extensions/codex-client.js";

const boss = {
  template_id: 1,
  boss: "孢子母體",
  emoji: "🍄",
  level: 89,
  series: "孢子",
  art: "boss-02",
  loc: "孢子母巢",
  mythic_kill_pct: 0,
  drops: [
    {
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
    },
  ],
};
const recipe = {
  id: "C1",
  style: "C",
  style_name: "橋接",
  out_name: "熔鑄魔刃",
  out_emoji: "💚",
  out_slot: "weapon",
  out_stats: "ATK+700",
  out_passive: "屠王",
  rtag: "💚",
  essence: 6,
  gold: 600000,
  materials: [{ name: "ATK 武器", emoji: "🔁", qty: 3 }],
};
const fixture = {
  bosses: [boss],
  recipes: [recipe],
  evo: { mythic: [{ suffix: "·神", mult: 1.6, essence: 40, gold: 2500000 }] },
  players: [{ name: "private" }],
};

test("只保留公開 BOSS、配方與進化欄位", () => {
  const parsed = parseCodex(fixture);
  expect(parsed.bosses[0].drops[0].prob_pct).toBe(6);
  expect(parsed.recipes[0].materials[0].qty).toBe(3);
  expect(parsed.evolution[0].gold).toBe(2500000);
  expect(parsed).not.toHaveProperty("players");
  expect(() =>
    parseCodex({ ...fixture, bosses: [{ ...boss, level: "89" }] }),
  ).toThrow();
  expect(() =>
    parseCodex({
      ...fixture,
      bosses: [{ ...boss, drops: [{ ...boss.drops[0], prob_pct: 101 }] }],
    }),
  ).toThrow();
});

test("固定網址唯讀抓取、搜尋配方與分頁，12 秒內快取", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ ...fixture, bosses: new Array(11).fill(boss) }),
    );
  const codex = new PublicCodex(fetcher);
  const first = await codex.lookup({ query: "孢子" });
  expect(first.total).toBe(11);
  expect(first.entries).toHaveLength(10);
  expect(
    (await codex.lookup({ query: "孢子", offset: 10 })).entries,
  ).toHaveLength(1);
  expect(
    (await codex.lookup({ recipes: true, query: "武器" })).entries,
  ).toEqual([recipe]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://lab4.kvzhuang.net/gen-art/bears-life-codex/codex.json",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
});

test("取消、HTTP 錯誤與過大回覆均拒絕且不重試", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(fixture));
  await expect(
    new PublicCodex(fetcher).lookup({}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  for (const response of [
    new Response("oops", { status: 503 }),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(new PublicCodex(failed).lookup({})).rejects.toThrow();
    expect(failed).toHaveBeenCalledOnce();
  }
});

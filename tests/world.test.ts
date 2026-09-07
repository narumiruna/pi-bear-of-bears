import { expect, test, vi } from "vitest";
import { parseWorld, WORLD_URL, WorldMap } from "../src/world.js";

const data = {
  ts: "2026-09-07",
  rooms: {
    "1": { n: "熊熊村廣場", d: "起點", safe: 1, boss: 0, ex: { 東: 2 } },
    "2": {
      n: "熊族市場",
      d: "補給",
      safe: 1,
      boss: 0,
      ex: { 西: 1 },
      npcn: "阿糖",
    },
  },
};

test("parses observed map schema and preserves directional exits", () => {
  expect(parseWorld(data).rooms[0]).toMatchObject({
    id: 1,
    name: "熊熊村廣場",
    safe: true,
    boss: false,
    exits: { 東: 2 },
  });
  expect(() => parseWorld({ rooms: {} })).toThrow("no rooms");
  expect(() =>
    parseWorld({ rooms: { "1": { ...data.rooms["1"], ex: { 東: "2" } } } }),
  ).toThrow("exit");
  expect(() =>
    parseWorld({ rooms: { "1": { ...data.rooms["1"], safe: "yes" } } }),
  ).toThrow("schema");
});

test("fetches a fixed URL, filters rooms and caches for 12 seconds", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(data)));
  const world = new WorldMap(fetcher);
  expect(
    (await world.lookup({ query: "阿糖" })).rooms.map((room) => room.id),
  ).toEqual([2]);
  expect((await world.lookup({ roomId: 1 })).rooms).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(WORLD_URL);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
});

test("paginates at 30 rooms", async () => {
  const rooms = Object.fromEntries(
    Array.from({ length: 31 }, (_, i) => [String(i + 1), data.rooms["1"]]),
  );
  const world = new WorldMap(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ rooms }))),
  );
  const page = await world.lookup({});
  expect(page.rooms).toHaveLength(30);
  expect(page.nextOffset).toBe(30);
  expect((await world.lookup({ offset: 30 })).rooms).toHaveLength(1);
});

test("handles HTTP, malformed and oversized responses without retries", async () => {
  for (const response of [
    new Response("", { status: 503 }),
    new Response("not json"),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(new WorldMap(fetcher).lookup({})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  }
});

test("pre-aborted lookups never fetch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    new WorldMap(fetcher).lookup({}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

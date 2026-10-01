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
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
  const world = new WorldMap(fetcher);
  expect(
    (await world.lookup({ query: "阿糖" })).rooms.map((room) => room.id),
  ).toEqual([2]);
  expect((await world.lookup({ roomId: 1 })).rooms).toHaveLength(1);
  expect(await world.allRooms()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(WORLD_URL);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
});

test("paginates at 30 rooms", async () => {
  const rooms = Object.fromEntries(
    Array.from({ length: 31 }, (_, i) => [String(i + 1), data.rooms["1"]]),
  );
  const world = new WorldMap(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ rooms })),
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

test("提供怪物數量與位置相符的 BOSS，排除玩家與聊天", async () => {
  const boss = {
    e: "👑",
    n: "測試王",
    loc: "熊族市場",
    lv: 80,
    hp: 5300,
    atk: 250,
    def: 119,
    drops: [{ e: "🗡️", n: "戰角", s: "ATK+75", p: 6, sk: "" }],
  };
  const snapshot = {
    ...data,
    monsters: { "1": 0, "2": 2 },
    bosses: [boss],
    players: [{ name: "不應輸出" }],
    chat: ["不應輸出"],
  };
  const parsed = parseWorld(snapshot);
  expect(parsed.rooms[0].monsterCount).toBe(0);
  expect(parsed.rooms[0].bosses).toEqual([]);
  expect(parsed.rooms[1].bosses).toEqual([boss]);
  expect(parseWorld(data).rooms[0].monsterCount).toBeUndefined();
  expect(JSON.stringify(parsed)).not.toContain("不應輸出");
  expect(() => parseWorld({ ...snapshot, monsters: { "1": -1 } })).toThrow();
  expect(() =>
    parseWorld({ ...snapshot, bosses: [{ ...boss, hp: "5300" }] }),
  ).toThrow();
  const world = new WorldMap(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(snapshot)),
  );
  expect(
    (await world.lookup({ query: "測試王" })).rooms.map((room) => room.id),
  ).toEqual([2]);
});

test("合併地表與地底，保留地下出口、怪物及同位置 BOSS", async () => {
  const boss = {
    e: "🐛",
    n: "測試地脈王",
    loc: "地脈中樞",
    lv: 173,
    hp: 18500,
    atk: 820,
    def: 390,
    drops: [],
  };
  const snapshot = {
    ...data,
    rooms_under: {
      "308": {
        n: "地脈中樞",
        d: "地底王房",
        safe: 0,
        boss: 1,
        ex: { 西: 307 },
        npcn: "地底嚮導",
      },
      "300": { n: "地底營地", d: "補給", safe: 1, boss: 0, ex: { 東: 301 } },
    },
    monsters: { "308": 1 },
    bosses: [boss],
  };
  const parsed = parseWorld(snapshot);
  expect(parsed.rooms.map((room) => room.id)).toEqual([1, 2, 300, 308]);
  expect(parsed.rooms[3]).toMatchObject({
    name: "地脈中樞",
    safe: false,
    boss: true,
    exits: { 西: 307 },
    npc: "地底嚮導",
    monsterCount: 1,
    bosses: [boss],
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(snapshot));
  const world = new WorldMap(fetcher);
  expect((await world.lookup({ roomId: 308 })).rooms[0]?.id).toBe(308);
  expect((await world.lookup({ query: "測試地脈王" })).total).toBe(1);
  expect((await world.lookup({ query: "地底嚮導" })).rooms[0]?.id).toBe(308);
  expect(await world.allRooms()).toHaveLength(4);
  expect(fetcher).toHaveBeenCalledOnce();
});

test("地底可單獨提供房間，非法圖層與跨層重複 ID 不靜默忽略", () => {
  const room = data.rooms["1"];
  expect(
    parseWorld({ rooms: {}, rooms_under: { "300": room } }).rooms,
  ).toHaveLength(1);
  for (const rooms_under of [
    null,
    [],
    "invalid",
    { "300": { ...room, ex: { 東: "301" } } },
  ]) {
    expect(() => parseWorld({ ...data, rooms_under })).toThrow();
  }
  expect(() => parseWorld({ ...data, rooms_under: { "1": room } })).toThrow(
    "ID 重複",
  );
});

test("跨圖層分頁使用同一快照，12 秒到期才重新抓取", async () => {
  const snapshot = {
    ...data,
    rooms: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [String(i + 1), data.rooms["1"]]),
    ),
    rooms_under: { "322": { ...data.rooms["2"], n: "虛空深淵" } },
    monsters: { "322": 2 },
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(
      Response.json({ ...snapshot, monsters: { "322": 0 } }),
    );
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const world = new WorldMap(fetcher);
    const first = await world.lookup({});
    expect(first.total).toBe(31);
    expect(first.rooms).toHaveLength(30);
    expect(first.nextOffset).toBe(30);
    const last = await world.lookup({ offset: 30 });
    expect(last.rooms.map((room) => room.id)).toEqual([322]);
    expect(last.nextOffset).toBeNull();
    expect(last.fetchedAt).toBe(first.fetchedAt);
    clock.mockReturnValue(12_999);
    expect((await world.lookup({ roomId: 322 })).rooms[0]?.monsterCount).toBe(
      2,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    clock.mockReturnValue(13_000);
    expect(
      (await world.lookup({ query: "虛空深淵" })).rooms[0]?.monsterCount,
    ).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url === WORLD_URL)).toBe(true);
  } finally {
    clock.mockRestore();
  }
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("同實例冷查詢合併抓取，分頁共用完成後的時間戳", async () => {
  const pending = gate();
  const snapshot = {
    rooms: Object.fromEntries(
      Array.from({ length: 31 }, (_, i) => [String(i + 1), data.rooms["1"]]),
    ),
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    await pending.promise;
    return Response.json(snapshot);
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const world = new WorldMap(fetcher);
    const first = world.lookup({});
    const last = world.lookup({ offset: 30 });
    const all = world.allRooms();
    clock.mockReturnValue(5_000);
    pending.release();
    const [a, b, rooms] = await Promise.all([first, last, all]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(a.fetchedAt).toBe(new Date(5_000).toISOString());
    expect(b.fetchedAt).toBe(a.fetchedAt);
    expect(a.nextOffset).toBe(30);
    expect(b.rooms.map((room) => room.id)).toEqual([31]);
    expect(rooms).toHaveLength(31);
    clock.mockReturnValue(16_999);
    await world.lookup({ roomId: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
    clock.mockReturnValue(17_000);
    await world.lookup({ roomId: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

test("12 秒到期的不同篩選查詢只刷新一次，不回傳過期資料", async () => {
  const pending = gate();
  const fresh = { ...data, ts: "新快照" };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(data))
    .mockImplementation(async () => {
      await pending.promise;
      return Response.json(fresh);
    });
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const world = new WorldMap(fetcher);
    await world.lookup({});
    clock.mockReturnValue(13_000);
    const first = world.lookup({ roomId: 1 });
    const second = world.lookup({ query: "阿糖" });
    pending.release();
    const results = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.timestamp)).toEqual([
      "新快照",
      "新快照",
    ]);
    expect(results[0].fetchedAt).toBe(results[1].fetchedAt);
    expect(fetcher.mock.calls.every(([url]) => url === WORLD_URL)).toBe(true);
  } finally {
    clock.mockRestore();
  }
});

test.each(["HTTP", "schema"])(
  "共用刷新%s失敗時全部拒絕、不回退過期資料，下一次查詢可恢復",
  async (failure) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(data))
      .mockImplementation(async () =>
        failure === "HTTP"
          ? new Response("", { status: 503 })
          : Response.json({ rooms: {} }),
      );
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const world = new WorldMap(fetcher);
      await world.lookup({});
      clock.mockReturnValue(13_000);
      const results = await Promise.allSettled([
        world.lookup({ roomId: 1 }),
        world.lookup({ query: "阿糖" }),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      fetcher.mockResolvedValueOnce(Response.json({ ...data, ts: "恢復" }));
      expect((await world.lookup({})).timestamp).toBe("恢復");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  },
);

test("首位查詢取消立即拒絕，但不中斷其他訊號共用的抓取", async () => {
  const pending = gate();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_, init) => {
    const signal = init?.signal;
    if (!signal) {
      throw new Error("缺少抓取取消訊號");
    }
    let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      return await Promise.race([
        pending.promise.then(() => Response.json(data)),
        aborted,
      ]);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  });
  const world = new WorldMap(fetcher);
  const firstController = new AbortController();
  const otherController = new AbortController();
  const first = world.lookup({}, firstController.signal);
  const rejected = expect(first).rejects.toThrow("取消第一筆");
  const other = world.lookup({ roomId: 2 }, otherController.signal);
  firstController.abort(new Error("取消第一筆"));
  try {
    await rejected;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
  } finally {
    pending.release();
  }
  expect((await other).rooms[0]?.id).toBe(2);
  expect((await world.lookup({ roomId: 1 })).rooms[0]?.id).toBe(1);
  expect(fetcher).toHaveBeenCalledOnce();
});

test("不同WorldMap實例各自冷抓取，不誤當同實例並行miss", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(data));
  await Promise.all([
    new WorldMap(fetcher).lookup({}),
    new WorldMap(fetcher).lookup({}),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("pre-aborted lookups never fetch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    new WorldMap(fetcher).lookup({}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

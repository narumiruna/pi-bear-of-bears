export const WORLD_URL =
  "https://lab4.kvzhuang.net/gen-art/bears-life/state.json";

export interface Room {
  id: number;
  name: string;
  description: string;
  safe: boolean;
  boss: boolean;
  exits: Record<string, number>;
  npc?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid world map data.");
  return value as Record<string, unknown>;
}

export function parseWorld(value: unknown) {
  const state = object(value);
  const rooms = Object.entries(object(state.rooms))
    .map(([key, value]): Room => {
      const room = object(value);
      const id = Number(key);
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        typeof room.n !== "string" ||
        typeof room.d !== "string" ||
        ![0, 1].includes(room.safe as number) ||
        ![0, 1].includes(room.boss as number)
      ) {
        throw new Error("Invalid world room schema.");
      }
      const exits: Record<string, number> = {};
      for (const [direction, target] of Object.entries(object(room.ex))) {
        if (
          typeof target !== "number" ||
          !Number.isSafeInteger(target) ||
          target < 1
        )
          throw new Error("Invalid room exit.");
        exits[direction] = target;
      }
      return {
        id,
        name: room.n,
        description: room.d,
        safe: room.safe === 1,
        boss: room.boss === 1,
        exits,
        npc: typeof room.npcn === "string" ? room.npcn : undefined,
      };
    })
    .sort((a, b) => a.id - b.id);
  if (!rooms.length) throw new Error("World map has no rooms.");
  return {
    timestamp:
      typeof state.ts === "string" || typeof state.ts === "number"
        ? state.ts
        : null,
    rooms,
  };
}

export class WorldMap {
  private cached?: { fetchedAt: number; data: ReturnType<typeof parseWorld> };

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async lookup(
    options: { query?: string; roomId?: number; offset?: number },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (!this.cached || Date.now() - this.cached.fetchedAt >= 12000) {
      const deadline = AbortSignal.timeout(15000);
      const response = await this.fetcher(WORLD_URL, {
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        redirect: "error",
      });
      if (!response.ok) throw new Error(`World map HTTP ${response.status}.`);
      if (!response.body) throw new Error("World map response is empty.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024)
            throw new Error("World map exceeds 2 MiB.");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      this.cached = {
        fetchedAt: Date.now(),
        data: parseWorld(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
      };
    }
    const { data, fetchedAt } = this.cached;
    const query = options.query?.toLowerCase() ?? "";
    const matched = data.rooms.filter(
      (room) =>
        (options.roomId === undefined || room.id === options.roomId) &&
        `${room.name} ${room.description} ${room.npc ?? ""}`
          .toLowerCase()
          .includes(query),
    );
    const offset = options.offset ?? 0;
    return {
      source: WORLD_URL,
      timestamp: data.timestamp,
      fetchedAt: new Date(fetchedAt).toISOString(),
      note: "Public map updates about every 12 seconds. Exits may be gated; confirm actual state with the Telegram bot.",
      total: matched.length,
      rooms: matched.slice(offset, offset + 30),
      nextOffset: offset + 30 < matched.length ? offset + 30 : null,
    };
  }
}

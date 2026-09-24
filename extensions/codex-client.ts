const URL = "https://lab4.kvzhuang.net/gen-art/bears-life-codex/codex.json";
const MAX_BYTES = 2 * 1024 * 1024;
const TTL_MS = 12_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("公開圖鑑格式錯誤：預期物件。");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("公開圖鑑格式錯誤：預期陣列。");
  }
  return value;
}

function pick<S extends string, N extends string>(
  input: unknown,
  strings: readonly S[],
  numbers: readonly N[],
): Record<S, string> & Record<N, number> {
  const source = object(input);
  const output: Record<string, string | number> = {};
  for (const key of strings) {
    if (typeof source[key] !== "string") {
      throw new Error(`公開圖鑑欄位錯誤：${key}`);
    }
    output[key] = source[key];
  }
  for (const key of numbers) {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`公開圖鑑欄位錯誤：${key}`);
    }
    output[key] = value;
  }
  return output as Record<S, string> & Record<N, number>;
}

export function parseCodex(value: unknown) {
  const source = object(value);
  const bosses = list(source.bosses).map((item) => {
    const boss = object(item);
    return {
      ...pick(
        boss,
        ["boss", "emoji", "series", "art", "loc"],
        ["template_id", "level", "mythic_kill_pct"],
      ),
      drops: list(boss.drops).map((item) => {
        const drop = object(item);
        const selected = pick(
          drop,
          [
            "name",
            "emoji",
            "slot",
            "stats",
            "stats_god",
            "rarity",
            "rtag",
            "passive",
            "grant_skill",
          ],
          ["prob_pct"],
        );
        if (selected.prob_pct > 100 || typeof drop.material !== "boolean") {
          throw new Error("掉落機率或材料標記格式錯誤。");
        }
        return { ...selected, material: drop.material };
      }),
    };
  });
  const recipes = list(source.recipes).map((item) => {
    const recipe = object(item);
    return {
      ...pick(
        recipe,
        [
          "id",
          "style",
          "style_name",
          "out_name",
          "out_emoji",
          "out_slot",
          "out_stats",
          "out_passive",
          "rtag",
        ],
        ["essence", "gold"],
      ),
      materials: list(recipe.materials).map((item) =>
        pick(item, ["name", "emoji"], ["qty"]),
      ),
    };
  });
  const evolution = list(object(source.evo).mythic).map((item) =>
    pick(item, ["suffix"], ["mult", "essence", "gold"]),
  );
  return { bosses, recipes, evolution };
}

export class PublicCodex {
  private cached?: { fetchedAt: number; data: ReturnType<typeof parseCodex> };

  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async lookup(
    options: { recipes?: boolean; query?: string; offset?: number },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (!this.cached || Date.now() - this.cached.fetchedAt >= TTL_MS) {
      const response = await this.fetcher(URL, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok || !response.body) {
        throw new Error(`公開圖鑑 HTTP ${response.status} 或空回覆。`);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            throw new Error("公開圖鑑超過 2 MiB。");
          }
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      signal?.throwIfAborted();
      const data = parseCodex(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      this.cached = { fetchedAt: Date.now(), data };
    }
    signal?.throwIfAborted();
    const { data, fetchedAt } = this.cached;
    const entries = options.recipes ? data.recipes : data.bosses;
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const matched = entries.filter((entry) =>
      JSON.stringify(entry).toLocaleLowerCase().includes(query),
    );
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("offset 必須是非負整數。");
    }
    return {
      source: URL,
      fetchedAt: new Date(fetchedAt).toISOString(),
      note: "公開圖鑑資料可能過期；掉落機率為百分比，非掉落保證；配方費用只供研究，不會購買或製作。",
      kind: options.recipes ? "recipes" : "bosses",
      total: matched.length,
      entries: matched.slice(offset, offset + 10),
      nextOffset: offset + 10 < matched.length ? offset + 10 : null,
      evolution: data.evolution,
    };
  }
}

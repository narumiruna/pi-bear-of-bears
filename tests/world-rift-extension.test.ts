import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { afterEach, expect, test, vi } from "vitest";
import { READONLY_RESULT_SCHEMA } from "../src/bears-readonly-result.js";
import { WORLD_URL } from "../src/world.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/world-rift-public-20261020.json", import.meta.url),
    "utf8",
  ),
);
afterEach(() => vi.restoreAllMocks());

test("實際world tool展示裂隙來源層並保留boss原值，不冒充即時狀態或登入Telegram", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bears-world-rift-loader-"));
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json(fixture));
  try {
    const loaded = await discoverAndLoadExtensions(
      [resolve("extensions/bears.ts")],
      directory,
      directory,
    );
    expect(loaded.errors).toEqual([]);
    const tool = loaded.extensions[0]?.tools.get("bears_world")?.definition;
    if (!tool) {
      throw new Error("缺少bears_world");
    }
    expect(tool.annotations?.readOnlyHint).toBe(true);
    for (const [roomId, safe] of [
      [210, true],
      [211, false],
    ] as const) {
      const output = await tool.execute(
        "test",
        { roomId },
        undefined,
        undefined,
        {} as never,
      );
      expect(Check(READONLY_RESULT_SCHEMA, output.structuredContent)).toBe(
        true,
      );
      expect(output.structuredContent).toMatchObject({
        source: WORLD_URL,
        timestamp: fixture.ts,
        resultKind: "read_only_data",
        outputComplete: true,
        total: 1,
        rooms: [{ id: roomId, safe, boss: false, sourceLayer: "rooms_rift" }],
      });
      expect(output.structuredContent).not.toHaveProperty("riskVerified");
      expect(output.structuredContent).not.toHaveProperty("outcome");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      WORLD_URL,
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { readFileSync } from "node:fs";
import process from "node:process";
import { encode } from "gpt-tokenizer";
import { expect, test } from "vitest";
import { createCompactCache } from "../src/compact-cache.js";
import { compactBearsOutput } from "../src/compact-context.js";

// 固定合成樣本不含私人聊天；o200k_base 僅作比較基準，不代表所有 provider。
const bot = (id: number, text: string) => ({
  id,
  outgoing: false,
  revision: "a".repeat(64),
  buttons: [],
  text,
});
const status = bot(
  1,
  readFileSync("tests/fixtures/character-status.txt", "utf8"),
);
const samples = {
  history: {
    messages: [
      status,
      bot(2, "戰鬥勝利\n─────────\nEXP +120\nHP 80/90\n金幣 +10"),
    ],
  },
  battle: {
    messages: [bot(3, "戰鬥勝利\n─────────\nEXP +120\nHP 80/90\n金幣 +10")],
  },
  world: {
    rooms: Array.from({ length: 30 }, (_, id) => ({
      id,
      name: "森林小徑",
      safe: false,
      exits: { north: id + 1 },
    })),
    nextOffset: 30,
  },
  codex: {
    bosses: Array.from({ length: 10 }, (_, id) => ({
      id,
      name: "測試熊",
      hp: 1000,
      drops: [{ name: "熊爪", probability: 0.1 }],
    })),
    nextOffset: 10,
  },
};

test("固定樣本量測 JSON 排版與文字精簡的個別收益", () => {
  const rows = Object.entries(samples).map(([sample, value]) => {
    const source = JSON.stringify(value, null, 2);
    const minified = JSON.stringify(value);
    const output = compactBearsOutput(source);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      compactBearsOutput(source);
    }
    const uncachedMs = (performance.now() - start) / 100;
    const cache = createCompactCache();
    cache(source);
    const cachedStart = performance.now();
    for (let i = 0; i < 100; i++) {
      cache(source);
    }
    const cachedMs = (performance.now() - cachedStart) / 100;
    expect(encode(output).length).toBeLessThanOrEqual(encode(source).length);
    expect(compactBearsOutput(output)).toBe(output);
    return {
      sample,
      originalTokens: encode(source).length,
      minifiedTokens: encode(minified).length,
      compactTokens: encode(output).length,
      uncachedMs,
      cachedMs,
    };
  });
  if (process.env.COMPACT_METRICS) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  }
});

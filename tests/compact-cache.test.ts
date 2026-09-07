import { expect, test, vi } from "vitest";
import { createCompactCache } from "../src/compact-cache.js";
import * as compact from "../src/compact-context.js";

test("依文字命中並以 LRU 項目上限淘汰", () => {
  const spy = vi.spyOn(compact, "compactBearsOutput");
  try {
    const cache = createCompactCache(1000, 2);
    cache("{}");
    cache("[]");
    cache("{}");
    cache("null");
    cache("[]");
    expect(spy).toHaveBeenCalledTimes(4);
  } finally {
    spy.mockRestore();
  }
});

test("超過位元組上限或停用時不快取，結果不變", () => {
  const spy = vi.spyOn(compact, "compactBearsOutput");
  try {
    for (const cache of [createCompactCache(1), createCompactCache(100, 0)]) {
      expect(cache("{ } ")).toBe("{}");
      expect(cache("{ } ")).toBe("{}");
    }
    expect(spy).toHaveBeenCalledTimes(4);
  } finally {
    spy.mockRestore();
  }
});

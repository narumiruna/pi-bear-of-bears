import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

for (const mode of [
  "first",
  "middle",
  "duplicate",
  "revision",
  "actor",
] as const) {
  test(`背包完整性與來源：${mode}`, async () => {
    const app = workflowHarness();
    app.observe(statusText(), "/status");
    app.observe("/inventory all", undefined, true);
    const lines = inventoryText().split("\n");
    const first = app.observe(lines.slice(0, 2).join("\n"), "/inventory all");
    if (mode === "middle") {
      app.observe(lines[2]);
    }
    if (mode === "duplicate") {
      app.observe(lines[1]);
      app.observe(lines.slice(2).join("\n"));
    }
    if (mode === "revision") {
      app.observe(lines.slice(2).join("\n"));
      app.store.observe([
        {
          ...first,
          revision: "changed",
          text: first.text.replace("3 種", "4 種"),
        },
      ]);
    }
    if (mode === "actor") {
      app.observe(statusText("乙熊"), "/status");
      app.observe(lines.slice(2).join("\n"));
    }
    const result = await app.call("bears_inventory_snapshot", {});
    expect(result.state).toBe("needs_observation");
    expect(result.data.sourceComplete).toBe(false);
    expect(result.data.items).toEqual([]);
    if (mode === "first" || mode === "middle") {
      expect(result.data.continuousRows).toBe(mode === "first" ? 1 : 2);
      expect(result.data.missingRows).toEqual([
        { from: mode === "first" ? 2 : 3, to: 3 },
      ]);
      expect(result.data.pages).toHaveLength(mode === "first" ? 1 : 2);
    }
    expect(app.sent).toEqual([]);
  });
}

test("兩完整版本差異綁來源；穿戴篩選與整列原文定位不改快照", async () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(inventoryText().replace("x5", "x8"), "/inventory all");
  const after = app.store.capture();
  const result = await app.call("bears_inventory_snapshot", {
    kind: "equipped",
    compare: { before: before.id, after: after.id },
  });
  expect(result.data.comparison).toMatchObject({
    character: "測試熊",
    beforeVersion: before.id,
    afterVersion: after.id,
    complete: true,
    changes: [{ name: "王之精魄", before: 5, after: 8, delta: 3 }],
  });
  const items = result.data.items as {
    rowNumber: number;
    source: { messageId: number };
  }[];
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    rowNumber: 1,
    source: { messageId: after.endId },
  });
  expect(app.store.inventory()?.value.entries).toHaveLength(3);
  expect(app.sent).toEqual([]);
});

test("重名分組不合併預算、未知詞條不補值；差異只保留可唯一比較品項", async () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  const text = inventoryText().replace("傳世青銅巨劍", "傳世鋼鐵巨劍");
  app.observe(text, "/inventory all");
  const before = app.store.capture();
  app.observe(text.replace("x5", "x6"), "/inventory all");
  const after = app.store.capture();
  const result = await app.call("bears_inventory_snapshot", {
    compare: { before: before.id, after: after.id },
  });
  expect(result.data.duplicateGroups).toEqual({
    groups: [{ name: "🟠⚔️傳世鋼鐵巨劍", rowNumbers: [1, 2], omittedRows: 0 }],
    omittedGroups: 0,
  });
  expect(result.data.comparison).toMatchObject({
    complete: false,
    ambiguous: ["🟠⚔️傳世鋼鐵巨劍"],
    changes: [{ name: "王之精魄", delta: 1 }],
  });
  app.observe(
    inventoryText().replace("ATK +5（Lv1 可裝備）", "未確認被動／授技"),
    "/inventory all",
  );
  const unknown = await app.call("bears_inventory_snapshot", {
    kind: "equipped",
  });
  expect((unknown.data.items as { description: string }[])[0].description).toBe(
    "未確認被動／授技",
  );
  expect(unknown.data.items).not.toHaveProperty("stats");
});

test("跨角、缺頁及反序版本不產生差異推薦", async () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe(inventoryText().replace("x5", "x8"), "/inventory all");
  const after = app.store.capture();
  const reversed = await app.call("bears_inventory_snapshot", {
    compare: { before: after.id, after: before.id },
  });
  expect(reversed.state).toBe("stopped");
  app.observe(statusText("乙熊"), "/status");
  app.observe(inventoryText(), "/inventory all");
  const other = app.store.capture();
  expect(
    (
      await app.call("bears_inventory_snapshot", {
        compare: { before: before.id, after: other.id },
      })
    ).state,
  ).toBe("stopped");
  expect(app.sent).toEqual([]);
});

test("超長重名分組整組省略並列數量，不截斷名稱或改寫完整性", async () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  const name = "長".repeat(4000);
  app.observe(
    `🎒 背包（2 種，全列）：\n  1. ${name} — 未知用途\n  2. ${name} — 未知用途\n🔢 用編號最方便：/inspect 1`,
    "/inventory all",
  );
  const result = await app.call("bears_inventory_snapshot", {});
  expect(result.data.sourceComplete).toBe(true);
  expect(result.data.duplicateGroups).toEqual({ groups: [], omittedGroups: 1 });
  expect((result.data.items as { name: string }[])[0].name).toBe(name);
  expect(app.sent).toEqual([]);
});

test("固定80列摘要位元組少於全列，仍保留整列與原文定位", async () => {
  const app = workflowHarness();
  app.observe(statusText(), "/status");
  const full = `🎒 背包（80 種，全列）：\n${Array.from({ length: 80 }, (_, i) => `  ${i + 1}. 測試材料${i}${i === 0 ? " 【裝備中】" : ""} — ${"未知用途，不能補零。".repeat(8)}`).join("\n")}\n🔢 用編號最方便：/inspect 1`;
  app.observe(full, "/inventory all");
  const result = await app.call("bears_inventory_snapshot", {
    kind: "equipped",
  });
  expect(result.data.sourceComplete).toBe(true);
  expect(result.data.shownRows).toBe(1);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
    Buffer.byteLength(full),
  );
  const measured = {
    fullBytes: Buffer.byteLength(full),
    summaryBytes: Buffer.byteLength(
      JSON.stringify({ ...result, originalSourceId: undefined }),
    ),
  };
  expect(measured).toMatchSnapshot();
});

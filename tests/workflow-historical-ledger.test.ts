import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toolResult } from "../src/output.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

function interval(app: ReturnType<typeof workflowHarness>) {
  const before = app.seed();
  app.observe("獲得金幣：100G", "/attack 合成王");
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, 1100), "/status");
  app.observe(inventoryText(), "/inventory all");
  return { before, after: app.store.capture() };
}

test("切角後可明確選歷史帳本，不把前角已結區間變成目前預算", async () => {
  const app = workflowHarness();
  const { before, after } = interval(app);
  app.observe(statusText("乙熊", 800, 50, 300), "/status");
  const controlledSource = structuredClone(app.store.status());
  expect(() => app.store.get(after.id)).toThrow();
  const ordinary = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: after.id,
  });
  expect(ordinary.state).toBe("stopped");
  const result = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: after.id,
    historical: true,
  });
  expect(result.state).toBe("confirmed");
  expect(result.actor).toBe("測試熊");
  expect(result.data).toMatchObject({
    credits: 100,
    actualDelta: 100,
    actionable: false,
    historicalContext: {
      currentCharacter: "乙熊",
      intervalCharacter: "測試熊",
      sameControlContext: false,
      budgetEligible: false,
      sourceTimesRefreshed: false,
    },
    ledger: {
      boundaries: {
        before: { sources: before.sources },
        after: { sources: after.sources },
      },
    },
  });
  expect(app.store.status()).toEqual(controlledSource);
  expect(() => app.store.assertCurrent(after.id, "測試熊")).toThrow();
  expect(app.sent).toEqual([]);
  expect(app.context.executeTool).not.toHaveBeenCalled();
});

test("歷史資格警示位於大量資料之前，截斷展示也不可遺失", async () => {
  const app = workflowHarness();
  const { before, after } = interval(app);
  app.observe(statusText("乙熊"), "/status");
  const result = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: after.id,
    historical: true,
  });
  // 只擴大展示負載，不當成背包／掉落證據。
  result.data.items = Array.from({ length: 1000 }, (_, i) => ({
    name: `合成${i}${"測試".repeat(80)}`,
    delta: 1,
  }));
  const output = await toolResult(result);
  const text = output.content[0].text;
  const path = text.startsWith('{"truncated":true')
    ? (JSON.parse(text) as { fullOutputPath: string }).fullOutputPath
    : /Full private game output: (.+?)\. Delete it/u.exec(text)?.[1];
  try {
    expect(text).toMatch(/Output truncated|"truncated"\s*:\s*true/u);
    expect(text).toMatch(/"budgetEligible"\s*:\s*false/u);
    expect(text).toMatch(/"actionable"\s*:\s*false/u);
    expect(output.details.bearsOriginal.text).toContain('"historicalContext"');
  } finally {
    if (path) {
      await rm(dirname(path), { recursive: true, force: true });
    }
  }
  expect(app.sent).toEqual([]);
});

test.each(["revision", "missing", "reset"])(
  "歷史模式也不繞過來源及分支隔離：%s",
  async (mode) => {
    const app = workflowHarness();
    const { before, after } = interval(app);
    app.observe(statusText("乙熊"), "/status");
    if (mode === "revision") {
      const record = app.store
        .all()
        .find((entry) => entry.message.id === after.sources[0].messageId);
      if (!record) {
        throw new Error("測試缺少來源");
      }
      app.store.observe([{ ...record.message, revision: "changed" }]);
    } else if (mode === "missing") {
      for (let i = 0; i < 610; i++) {
        app.observe(statusText("乙熊"), "/status");
      }
    } else {
      app.store.reset();
    }
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
      historical: true,
    });
    expect(result.state).toBe("stopped");
    expect(app.sent).toEqual([]);
  },
);

test("歷史模式不混兩角或兩次控制情境的餘額", async () => {
  const app = workflowHarness();
  const { before } = interval(app);
  app.observe(statusText("乙熊"), "/status");
  app.observe(inventoryText(), "/inventory all");
  const other = app.store.capture();
  app.observe(statusText(), "/status");
  app.observe(inventoryText(), "/inventory all");
  const returned = app.store.capture();
  for (const after of [other, returned]) {
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
      historical: true,
    });
    expect(result.state).toBe("stopped");
  }
  expect(app.sent).toEqual([]);
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ControlIdentity } from "../src/workflow-control-identity.js";
import { workflowResult } from "../src/workflow-result.js";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const win = (
  JSON.parse(
    readFileSync(
      new URL("./fixtures/native-combat.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string }[]
).find((entry) => entry.text.startsWith("✨ 使用技能：熊力衝擊"))?.text;
if (!win) {
  throw new Error("缺少既有原生勝利 fixture");
}

test.each(["outgoing", "request_only"])(
  "切角尚未確認時晚到戰報不掛前角：%s",
  async (mode) => {
    const app = workflowHarness();
    const point = app.seed();
    if (mode === "outgoing") {
      app.observe("/switch 乙熊", undefined, true);
    } else {
      app.store.observe([], "/switch 乙熊");
    }
    const receipt = app.observe(win, "/skill 熊力衝擊");
    expect(
      app.store.all().find((entry) => entry.message.id === receipt.id)?.actor,
    ).toBeNull();
    expect(app.store.status()).toBeUndefined();
    expect(() => app.store.assertCurrent(point.id, "測試熊")).toThrow();
    const result = await app.call("bears_combat_snapshot", {
      mode: "boss",
      includeHistory: true,
    });
    expect(result.data.history).toMatchObject({
      samples: [],
      incompleteSources: [{ messageId: receipt.id }],
      actionable: false,
    });
    expect(app.store.continuation()).toMatchObject({
      controlledCharacter: null,
      lastObservedCharacter: "測試熊",
      controlIdentityKnown: false,
    });
    expect(app.sent).toEqual([]);
  },
);

test("舊 status 重讀與切角拒絕都不等於恢復控制身分；新 status 可重新確認同角", () => {
  const app = workflowHarness();
  app.seed();
  const old = app.store.all().find((entry) => entry.command === "/status");
  if (!old) {
    throw new Error("缺少舊 status");
  }
  const pending = workflowResult("測試熊");
  pending.steps.push({ tool: "bears_switch", state: "outcome_unknown" });
  app.store.rememberWorkflow(pending);
  app.observe("/switch 乙熊", undefined, true);
  app.observe("切角遭拒絕", "/switch 乙熊");
  app.store.observe([old.message], "/status");
  expect(app.store.continuation()).toMatchObject({
    controlIdentityKnown: false,
    controlledCharacter: null,
    pendingWorkflows: { reports: [{ sameControlContext: false }] },
  });
  app.observe(statusText(), "/status");
  expect(app.store.continuation()).toMatchObject({
    controlIdentityKnown: true,
    controlledCharacter: "測試熊",
    pendingWorkflows: { reports: [{ sameControlContext: true }] },
  });
  expect(app.sent).toEqual([]);
});

test.each(["stale", "future", "old_id", "incomplete"])(
  "控制身分確認仍須新鮮、在後且完整的 status：%s",
  (mode) => {
    const identity = new ControlIdentity();
    identity.requested("/switch 乙熊", 10);
    identity.confirm(
      {
        messageId: mode === "old_id" ? 10 : 11,
        revision: "fixture",
        date: NOW / 1000 + (mode === "stale" ? -61 : mode === "future" ? 1 : 0),
        observedAt: NOW,
      },
      mode !== "incomplete",
    );
    expect(identity.pending).toBe(true);
    identity.confirm(
      { messageId: 12, revision: "fresh", date: NOW / 1000, observedAt: NOW },
      true,
    );
    expect(identity.pending).toBe(false);
  },
);

test("晚到舊 outgoing 不推翻在後確認；開清單不是切角，reset 清除邊界", () => {
  const identity = new ControlIdentity();
  identity.outgoing(10, "/switch 乙熊", 11);
  expect(identity.pending).toBe(false);
  identity.requested("/switch", 11);
  expect(identity.pending).toBe(false);
  identity.requested("/switch 乙熊", 12);
  expect(identity.pending).toBe(true);
  identity.reset();
  expect(identity.pending).toBe(false);
});

test("原生明示他角回報在控制不明時保留歸屬，但不能確認該角色目前受控", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("/switch 乙熊", undefined, true);
  const report = app.observe("【乙熊】\n🐾 掛機 1 小時，金幣 +100G");
  expect(
    app.store.all().find((entry) => entry.message.id === report.id)?.actor,
  ).toBe("乙熊");
  expect(app.store.continuation()).toMatchObject({
    controlIdentityKnown: false,
    controlledCharacter: null,
  });
  app.observe(statusText("乙熊"), "/status");
  expect(app.store.continuation()).toMatchObject({
    controlIdentityKnown: true,
    controlledCharacter: "乙熊",
  });
  expect(app.sent).toEqual([]);
});

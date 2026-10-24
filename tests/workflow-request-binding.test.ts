import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reconcileRewards } from "../src/workflow-rewards.js";
import {
  inventoryText,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-idle-reports.json", import.meta.url),
    "utf8",
  ),
) as { manual: string };
const manual = fixture.manual.replace("☯️ なるみ_陰陽熊", "測試熊");

function close(
  app: ReturnType<typeof workflowHarness>,
  before: string,
  gold: number,
) {
  vi.mocked(Date.now).mockReturnValue(NOW + 60000);
  app.observe(statusText("測試熊", 900, 60, gold), "/status");
  app.observe(inventoryText(), "/inventory all");
  return reconcileRewards(app.store, before, app.store.capture().id);
}

test.each([
  ["/idlestatus", "/stopidle", 0],
  ["/stopidle", "/idlestatus", 33808],
] as const)(
  "同 ID／revision 再次出現不能從 %s 改綁 %s",
  (first, repeated, expected) => {
    const app = workflowHarness();
    const before = app.seed();
    const receipt = app.observe(manual, first);
    const source = structuredClone(app.store.all().at(-1)?.source);
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    app.store.observe([receipt], repeated);
    const record = app.store
      .all()
      .find((entry) => entry.message.id === receipt.id);
    expect(record).toMatchObject({ command: first, source });
    const result = close(app, before.id, 34808);
    expect(result.data.credits).toBe(expected);
    expect(result.data.unexplained).toBe(33808 - expected);
    expect(app.sent).toEqual([]);
  },
);

test.each([undefined, "/idlestatus"])(
  "舊孤立回覆不能靠新 request 補綁手動結算；前一 outgoing=%s",
  (outgoing) => {
    const app = workflowHarness();
    const before = app.seed();
    if (outgoing) {
      app.observe(outgoing, undefined, true);
    }
    const receipt = app.observe(manual);
    app.observe("/stopidle", undefined, true); // 此 outgoing 晚於舊回覆，不能回填歸屬。
    app.store.observe([receipt], "/stopidle");
    expect(
      app.store.all().find((entry) => entry.message.id === receipt.id)?.command,
    ).toBeNull();
    const result = close(app, before.id, 34808);
    expect(result.data.credits).toBe(0);
    expect(result.state).toBe("needs_observation");
    expect(app.sent).toEqual([]);
  },
);

test("watch 先觀測回覆時，已有同角同分支且在先的 outgoing 才能補綁；不刷新時間", () => {
  const app = workflowHarness();
  const before = app.seed();
  app.observe("/stopidle", undefined, true);
  const receipt = app.observe(manual);
  const source = structuredClone(app.store.all().at(-1)?.source);
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  app.store.observe([receipt], "/stopidle");
  app.store.observe([receipt], "/stopidle");
  expect(
    app.store.all().find((entry) => entry.message.id === receipt.id),
  ).toMatchObject({ command: "/stopidle", source });
  const result = close(app, before.id, 34808);
  expect(result.data.credits).toBe(33808);
  expect(result.data.events).toHaveLength(1);
  expect(app.sent).toEqual([]);
});

test.each(["late_observation", "future_date", "unknown_actor"])(
  "outgoing 的身分與時間也必須成立：%s",
  (mode) => {
    const app = workflowHarness();
    if (mode !== "unknown_actor") {
      app.seed();
    }
    const anchor = app.observe("/stopidle", undefined, true);
    if (mode === "future_date") {
      app.store.observe([
        { ...anchor, revision: "future", date: anchor.date + 1 },
      ]);
    }
    const receipt = app.observe(manual);
    if (mode === "late_observation") {
      vi.mocked(Date.now).mockReturnValue(NOW + 1000);
      app.store.observe([{ ...anchor, revision: "late" }]);
    }
    if (mode === "unknown_actor") {
      app.observe(statusText(), "/status");
    }
    app.store.observe([receipt], "/stopidle");
    expect(
      app.store.all().find((entry) => entry.message.id === receipt.id)?.command,
    ).toBeNull();
    expect(app.sent).toEqual([]);
  },
);

test("切角再切回不會把舊分支的孤立回覆綁定為目前操作", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("/stopidle", undefined, true);
  const receipt = app.observe(manual);
  app.observe(statusText("乙熊"), "/status");
  app.observe(statusText(), "/status");
  app.store.observe([receipt], "/stopidle");
  expect(
    app.store.all().find((entry) => entry.message.id === receipt.id)?.command,
  ).toBeNull();
  expect(app.sent).toEqual([]);
});

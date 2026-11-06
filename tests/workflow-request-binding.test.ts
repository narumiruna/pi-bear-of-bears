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
const lateBlood = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-late-tower-blood.json", import.meta.url),
    "utf8",
  ),
) as { outgoing: { text: string }; reply: { text: string } };

test("send 已觀測真實 outgoing 後，首次 history 的完整原生技能可綁定，重讀不刷新時間", () => {
  const app = workflowHarness();
  app.seed();
  const command = lateBlood.outgoing.text;
  app.observe(command, command, true);
  const reply = app.observe(lateBlood.reply.text);
  const record = app.store.all().find((entry) => entry.message.id === reply.id);
  expect(record).toMatchObject({ actor: "測試熊", command });
  const source = structuredClone(record?.source);
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  app.store.observe([reply]);
  expect(
    app.store.all().find((entry) => entry.message.id === reply.id),
  ).toMatchObject({ command, source });
  expect(app.sent).toEqual([]);
});

test.each([
  "history_only",
  "wrong_skill",
  "revised",
  "omitted",
  "expired",
  "future",
  "intervening",
  "actor_change",
  "unknown_actor",
  "incomplete_reply",
])("遲到技能不補造角色或因果來源：%s", (mode) => {
  const app = workflowHarness();
  if (mode !== "unknown_actor") {
    app.seed();
  }
  const command =
    mode === "wrong_skill" ? "/skill 地脈·萬物回春" : lateBlood.outgoing.text;
  if (mode === "future") {
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  }
  const outgoing = app.observe(
    command,
    mode === "history_only" ? undefined : command,
    true,
  );
  if (mode === "future") {
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
  if (mode === "revised") {
    app.store.observe([{ ...outgoing, revision: "changed" }], command);
  }
  if (mode === "omitted") {
    app.store.observe([], undefined, 1);
  }
  if (mode === "expired") {
    vi.mocked(Date.now).mockReturnValue(NOW + 61_000);
  }
  if (mode === "intervening") {
    app.observe("未知訊息");
  }
  if (mode === "actor_change") {
    app.observe(statusText("乙熊"), "/status");
  }
  const reply = app.observe(
    mode === "incomplete_reply"
      ? `${lateBlood.reply.text}\n未知效果`
      : lateBlood.reply.text,
  );
  expect(
    app.store.all().find((entry) => entry.message.id === reply.id)?.command,
  ).toBeNull();
  expect(app.sent).toEqual([]);
});

test.each([statusText(), "🗼 無盡星塔\n挑戰中：第30層\n怪物：合成星主"])(
  "tower 的遲到回覆不能改綁其他面板或缺血量原文：%s",
  (text) => {
    const app = workflowHarness();
    app.seed();
    app.observe("/tower", "/tower", true);
    const reply = app.observe(text);
    expect(
      app.store.all().find((entry) => entry.message.id === reply.id)?.command,
    ).toBeNull();
  },
);

test("本人status晚到時不能把另一角色回覆綁到原request", () => {
  const app = workflowHarness();
  app.seed();
  app.observe("/status", "/status", true);
  const reply = app.observe(statusText("乙熊"));
  expect(
    app.store.all().find((entry) => entry.message.id === reply.id)?.command,
  ).toBeNull();
});

test("同一 outgoing 已有完整回覆後，不將另一則同技能回覆重複綁定", () => {
  const app = workflowHarness();
  app.seed();
  app.observe(lateBlood.outgoing.text, lateBlood.outgoing.text, true);
  app.observe(lateBlood.reply.text);
  const duplicate = app.observe(lateBlood.reply.text);
  expect(
    app.store.all().find((entry) => entry.message.id === duplicate.id)?.command,
  ).toBeNull();
});

test("watch 先見 outgoing、同次 send 隨後確認時可保留標記，不刷新原始來源", () => {
  const app = workflowHarness();
  app.seed();
  const outgoing = app.observe(lateBlood.outgoing.text, undefined, true);
  const source = structuredClone(app.store.all().at(-1)?.source);
  app.store.observe([outgoing], lateBlood.outgoing.text);
  expect(
    app.store.all().find((entry) => entry.message.id === outgoing.id),
  ).toMatchObject({ requestObserved: true, source });
  const reply = app.observe(lateBlood.reply.text);
  expect(
    app.store.all().find((entry) => entry.message.id === reply.id)?.command,
  ).toBe(lateBlood.outgoing.text);
});

test("watch 先見孤立原生技能後，晚觀測的 outgoing 不回填既有未知回覆", () => {
  const app = workflowHarness();
  app.seed();
  const reply = app.observe(lateBlood.reply.text);
  app.observe(lateBlood.outgoing.text, lateBlood.outgoing.text, true);
  app.store.observe([reply], lateBlood.outgoing.text);
  expect(
    app.store.all().find((entry) => entry.message.id === reply.id)?.command,
  ).toBeNull();
});

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

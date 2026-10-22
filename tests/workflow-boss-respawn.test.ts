import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { combatSnapshot } from "../src/workflow-combat.js";
import {
  WORKFLOW_QUERY,
  WorkflowObservations,
} from "../src/workflow-observations.js";
import { message, roomText, statusText } from "./fixtures/workflow.js";

// 780804 原生完整單頁；本人數值與 outgoing 為合成，不冒充遊戲實測。
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/boss-respawn-780804.json", import.meta.url),
    "utf8",
  ),
) as { originalSourceId: string; messages: GameMessage[] };
const statusDate = 1792628734;
const now = 1792628768 * 1000;
const pages = () => structuredClone(native.messages);
function seed() {
  vi.mocked(Date.now).mockReturnValue((statusDate + 1) * 1000);
  const store = new WorkflowObservations();
  store.observe(
    [message(780802, statusText("測試熊"), false, statusDate)],
    "/status",
  );
  vi.mocked(Date.now).mockReturnValue(now);
  return store;
}
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

test.each([false, true])(
  "完整原生重生板不使33秒前的本人狀態失效（含 outgoing=%s）",
  (outgoing) => {
    const store = seed();
    const point = store.capture();
    const source = store.status()?.source;
    const replies = pages();
    if (outgoing) {
      replies.unshift(message(780803, "/boss_respawn", true, 1792628766));
    }
    expect(WORKFLOW_QUERY.test("/boss_respawn")).toBe(true);
    store.observe(replies, "/boss_respawn");
    store.bindOriginal(pages(), native.originalSourceId, store.generation);
    expect(store.status()?.source).toEqual(source);
    expect(store.status()?.value).toMatchObject({ name: "測試熊", hp: 900 });
    expect(() => store.assertCurrent(point.id, "測試熊")).not.toThrow();
    expect(store.all().at(-1)?.source.originalSourceId).toBe(
      native.originalSourceId,
    );
    const snapshot = combatSnapshot(store, "boss", "霜寂·凍原猛獁");
    expect(snapshot.actor).toBe("測試熊");
    expect(snapshot.state).toBe("needs_observation");
    expect(snapshot.data.riskVerified).not.toBe(true);
    expect(snapshot.data).not.toHaveProperty("plannerObservation");
    expect(snapshot.blockers).toContain(
      "缺少可唯一綁定的目標現身、HP 或樓層。",
    );
  },
);

test.each([
  ["秒", "1 秒"],
  ["分", "2 分"],
  ["分秒", "2 分 0 秒"],
  ["小時", "1 小時"],
  ["小時分", "1 小時 9 分"],
])("辨識倒數單位%s，但不將倒數當本人資格", (_label, remaining) => {
  const store = seed();
  const reply = pages()[0];
  reply.text = reply.text.replace("4 分 16 秒", remaining);
  store.observe([reply], "/boss_respawn");
  expect(store.status()?.value.name).toBe("測試熊");
  expect(combatSnapshot(store, "boss").data).not.toHaveProperty(
    "plannerObservation",
  );
});

test.each([
  ["標題", (text: string) => text.replace("🕒 Boss 重生看板", "Boss 看板")],
  [
    "頁尾",
    (text: string) => text.replace("🗼 星塔星主：不重生（爬塔動態生成）", ""),
  ],
  ["缺條目", (text: string) => text.replace(/^🦬荒原巨角獸[^\n]*\n/mu, "")],
  [
    "新增條目",
    (text: string) =>
      text.replace(
        "\n🌀 裂界九王",
        "\n🐻新王 Lv200（重生 5 分｜新房）　✅ 存活\n\n🌀 裂界九王",
      ),
  ],
  [
    "重複條目",
    (text: string) =>
      text.replace(
        /^🍄孢子母體[^\n]*/mu,
        "🦬荒原巨角獸 Lv80（重生 5 分｜巨獸的領地）　✅ 存活",
      ),
  ],
  ["倒數越界", (text: string) => text.replace("4 分 16 秒", "4 分 60 秒")],
  ["未知狀態", (text: string) => text.replace("✅ 存活", "✅ 已攻擊")],
  ["戰鬥行", (text: string) => `${text}\n你受到 200 傷害。HP：700/1000`],
  [
    "同行事件",
    (text: string) => text.replace("✅ 存活", "✅ 存活；你受到200傷害"),
  ],
  ["已知房間格式", (text: string) => `${text}\n${roomText()}`],
])("不因 /boss_respawn request 而信任%s", (_label, change) => {
  const store = seed();
  const point = store.capture();
  const reply = pages()[0];
  reply.text = change(reply.text);
  store.observe([reply], "/boss_respawn");
  expect(store.status()).toBeUndefined();
  expect(() => store.assertCurrent(point.id, "測試熊")).toThrow();
  expect(store.statusInvalidation()).toMatchObject({
    kind: "unknown_bot_reply",
    messageId: 780804,
    request: "/boss_respawn",
  });
});

test.each([
  [
    "額外訊息",
    (values: GameMessage[]) => [...values, message(780805, roomText())],
  ],
  [
    "重複看板",
    (values: GameMessage[]) => [...values, { ...values[0], id: 780805 }],
  ],
  [
    "按鈕",
    (values: GameMessage[]) => [
      {
        ...values[0],
        buttons: [{ text: "攻擊", row: 0, column: 0, kind: "text" as const }],
      },
    ],
  ],
  ["媒體", (values: GameMessage[]) => [{ ...values[0], hasMedia: true }]],
  [
    "分頁",
    (values: GameMessage[]) => [
      { ...values[0], text: values[0].text.slice(0, 100) },
      { ...values[0], id: 780805, text: values[0].text.slice(100) },
    ],
  ],
  [
    "outgoing 媒體",
    (values: GameMessage[]) => [
      { ...message(780803, "/boss_respawn", true, 1792628766), hasMedia: true },
      ...values,
    ],
  ],
  [
    "outgoing 缺號",
    (values: GameMessage[]) => [
      message(780801, "/boss_respawn", true, 1792628766),
      ...values,
    ],
  ],
  [
    "outgoing 時序倒退",
    (values: GameMessage[]) => [
      message(780803, "/boss_respawn", true, 1792628769),
      ...values,
    ],
  ],
])("完整單頁協定拒絕%s", (_label, change) => {
  const store = seed();
  store.observe(change(pages()), "/boss_respawn");
  expect(store.status()).toBeUndefined();
});

test("不從 history 或其他 request 猜來源，也不接受附加引數", () => {
  for (const request of [
    undefined,
    "/look",
    "/boss_respawn attack",
    " /boss_respawn",
    "/boss_respawn\n/attack",
  ]) {
    const store = seed();
    store.observe(pages(), request);
    expect(store.status()).toBeUndefined();
  }
  expect(WORKFLOW_QUERY.test("/boss_respawn\n")).toBe(false);
  expect(WORKFLOW_QUERY.test("/boss_respawn ")).toBe(false);
  expect(WORKFLOW_QUERY.test("/boss_respawn attack")).toBe(false);
  expect(WORKFLOW_QUERY.test("/boss_respawn\n/attack")).toBe(false);
});

test("看板不能恢復失效狀態，亦不延長本人狀態的60秒時效", () => {
  const invalidated = seed();
  invalidated.observe([message(780803, "未知戰鬥事件")]);
  invalidated.observe(pages(), "/boss_respawn");
  expect(invalidated.status()).toBeUndefined();
  const expired = seed();
  expired.observe(pages(), "/boss_respawn");
  vi.mocked(Date.now).mockReturnValue((statusDate + 61) * 1000);
  expect(expired.status()).toBeUndefined();
  expect(combatSnapshot(expired, "boss").actor).toBeNull();
  vi.mocked(Date.now).mockReturnValue((statusDate - 1) * 1000);
  expect(expired.status()).toBeUndefined();
});

test("保留 revision、缺漏、角色改變與非查詢操作護欄", () => {
  for (const invalidate of [
    (store: WorkflowObservations) =>
      store.observe([{ ...pages()[0], revision: "changed" }], "/boss_respawn"),
    (store: WorkflowObservations) => store.observe([], undefined, 1),
    (store: WorkflowObservations) =>
      store.observe([message(780805, "/rest", true)]),
    (store: WorkflowObservations) =>
      store.observe([message(780805, statusText("另一熊"))], "/status"),
    (store: WorkflowObservations) => store.reset(),
  ]) {
    const store = seed();
    const point = store.capture();
    store.observe(pages(), "/boss_respawn");
    expect(store.status()).toBeDefined();
    invalidate(store);
    expect(() => store.assertCurrent(point.id, "測試熊")).toThrow();
  }
});

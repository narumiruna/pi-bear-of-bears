import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GameMessage } from "../src/game.js";
import { combatSnapshot } from "../src/workflow-combat.js";
import {
  WORKFLOW_QUERY,
  WorkflowObservations,
} from "../src/workflow-observations.js";
import {
  message,
  roomText,
  skillsText,
  statusText,
} from "./fixtures/workflow.js";

// 兩則原生公開圖鑑原文及原始 revision；不使用 session、憑證或 Telegram 連線。
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/boss-catalogue-770091.json", import.meta.url),
    "utf8",
  ),
) as {
  originalSourceId: string;
  messages: GameMessage[];
};
const statusDate = 1792505144;
const now = (statusDate + 43) * 1000;
const pages = () => structuredClone(native.messages);
function seed() {
  const store = new WorkflowObservations();
  // 770081 的原文未提供：只重建姓名、ID 與時間；數值為合成值，不冒充當次狀態。
  store.observe(
    [message(770081, statusText("なるみ_狂戰熊", 700, 35), false, statusDate)],
    "/status",
  );
  store.observe([message(770085, roomText(), false, statusDate + 5)], "/look");
  store.observe(
    [message(770089, skillsText, false, statusDate + 20)],
    "/skills",
  );
  return store;
}
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

test("原生 /boss 雙頁在43秒內不使本人 status 失效，也不提供現身或安全證明", () => {
  expect(WORKFLOW_QUERY.test("/boss")).toBe(true);
  expect(WORKFLOW_QUERY.test("/boss attack")).toBe(false);
  const store = seed();
  const before = store.capture();
  store.observe(
    [message(770090, "/boss", true, statusDate + 27), ...pages()],
    "/boss",
  );
  store.bindOriginal(
    native.messages,
    native.originalSourceId,
    store.generation,
  );
  expect(store.status()?.value).toMatchObject({
    name: "なるみ_狂戰熊",
    hp: 700,
    mp: 35,
  });
  expect(() => store.assertCurrent(before.id, "なるみ_狂戰熊")).not.toThrow();
  expect(store.all().at(-1)?.source.originalSourceId).toBe(
    native.originalSourceId,
  );
  const snapshot = combatSnapshot(store, "boss", "荒原巨角獸");
  expect(snapshot.actor).toBe("なるみ_狂戰熊");
  expect(snapshot.state).toBe("needs_observation");
  expect(snapshot.data.riskVerified).not.toBe(true);
  expect(snapshot.data).not.toHaveProperty("plannerObservation");
  expect(snapshot.blockers).toContain("缺少可唯一綁定的目標現身、HP 或樓層。");
});

test.each([
  [
    "混入其他已知查詢格式",
    (values: GameMessage[]) => [
      ...values,
      message(770093, roomText(), false, statusDate + 30),
    ],
  ],
  [
    "混入已知技能格式",
    (values: GameMessage[]) => [
      ...values,
      message(770093, skillsText, false, statusDate + 30),
    ],
  ],
  [
    "未知獨立回覆",
    (values: GameMessage[]) => [
      ...values,
      message(770093, "未知活動", false, statusDate + 30),
    ],
  ],
  [
    "混入戰鬥行",
    (values: GameMessage[]) => [
      { ...values[0], text: `${values[0].text}\n反擊：200；HP：700→500/1000` },
      values[1],
    ],
  ],
  [
    "混入技能結果",
    (values: GameMessage[]) => [
      values[0],
      { ...values[1], text: `${values[1].text}\n✨ 使用技能：嗜血狂殺` },
    ],
  ],
  [
    "同一行追加事件",
    (values: GameMessage[]) => [
      { ...values[0], text: `${values[0].text}；你受到200傷害` },
      values[1],
    ],
  ],
  ["缺少首頁", (values: GameMessage[]) => values.slice(1)],
  [
    "缺頁",
    (values: GameMessage[]) => [values[0], { ...values[1], id: 770093 }],
  ],
  [
    "夾入未知事件",
    (values: GameMessage[]) => [
      values[0],
      message(770092, "不明事件", false, statusDate + 29),
      { ...values[1], id: 770093 },
    ],
  ],
  [
    "未知專屬效果",
    (values: GameMessage[]) => [
      {
        ...values[0],
        text: values[0].text.replace(
          "25% 機率以 1.6× 傷害衝撞",
          "未知招式，HP已恢復",
        ),
      },
      values[1],
    ],
  ],
  [
    "缺少怪物數值",
    (values: GameMessage[]) => [
      {
        ...values[0],
        text: values[0].text.replace("　HP 5300／ATK 250／DEF 119\n", ""),
      },
      values[1],
    ],
  ],
  [
    "缺少條目結尾",
    (values: GameMessage[]) => [
      {
        ...values[0],
        text: values[0].text.replace(
          "　💠 王之精魄 70%（進階素材，/forge 用）\n",
          "",
        ),
      },
      values[1],
    ],
  ],
  [
    "附有按鈕",
    (values: GameMessage[]) => [
      {
        ...values[0],
        buttons: [{ text: "戰鬥", row: 0, column: 0, kind: "text" as const }],
      },
      values[1],
    ],
  ],
  [
    "非文字附件",
    (values: GameMessage[]) => [{ ...values[0], hasMedia: true }, values[1]],
  ],
] as const)("/boss 不因 request 而信任%s", (_label, change) => {
  const store = seed();
  const point = store.capture();
  store.observe(change(pages()), "/boss");
  expect(store.status()).toBeUndefined();
  expect(combatSnapshot(store, "boss").actor).toBeNull();
  expect(() => store.assertCurrent(point.id, "なるみ_狂戰熊")).toThrow();
});

test("無 request 的圖鑑與跨呼叫孤立續頁仍保守失效，不接續猜測來源", () => {
  const store = seed();
  store.observe(pages());
  expect(store.status()).toBeUndefined();
  const late = seed();
  late.observe(pages().slice(0, 1), "/boss");
  expect(late.status()).toBeDefined();
  late.observe(pages().slice(1), "/boss");
  expect(late.status()).toBeUndefined();
});

test("保留狀態變更、revision、缺頁、epoch 與時效護欄", () => {
  for (const invalidate of [
    (store: WorkflowObservations) => store.observe([], "/attack 荒原巨角獸"),
    (store: WorkflowObservations) =>
      store.observe([message(770093, "/rest", true)]),
    (store: WorkflowObservations) =>
      store.observe([{ ...native.messages[1], revision: "changed" }], "/boss"),
    (store: WorkflowObservations) => store.observe([], undefined, 1),
    (store: WorkflowObservations) => store.reset(),
    () => vi.mocked(Date.now).mockReturnValue(statusDate * 1000 + 60001),
    () => vi.mocked(Date.now).mockReturnValue(statusDate * 1000 - 1),
  ]) {
    vi.mocked(Date.now).mockReturnValue(now);
    const store = seed();
    const point = store.capture();
    store.observe(pages(), "/boss");
    expect(store.status()).toBeDefined();
    invalidate(store);
    expect(store.status()).toBeUndefined();
    expect(() => store.assertCurrent(point.id, "なるみ_狂戰熊")).toThrow();
  }
  vi.mocked(Date.now).mockReturnValue(now);
  const store = seed();
  const point = store.capture();
  store.observe(pages(), "/boss");
  store.observe([message(770093, statusText("乙熊"))], "/status");
  expect(store.status()?.value.name).toBe("乙熊");
  expect(() => store.assertCurrent(point.id, "なるみ_狂戰熊")).toThrow();
});

test.each([
  "unknown_bot_reply",
  "outgoing_change",
  "source_revision",
  "omitted",
] as const)("失效診斷保留 %s 與來源，不恢復任何本人數值", (kind) => {
  const store = seed();
  store.observe(pages(), "/boss");
  if (kind === "unknown_bot_reply") {
    store.observe([message(770093, "未知事件")]);
  } else if (kind === "outgoing_change") {
    store.observe([message(770093, "/rest", true)]);
  } else if (kind === "source_revision") {
    store.observe([{ ...native.messages[1], revision: "changed" }], "/boss");
  } else {
    store.observe([], undefined, 1);
  }
  const snapshot = combatSnapshot(store, "boss");
  expect(snapshot.data.statusInvalidation).toMatchObject({
    kind,
    statusSource: { messageId: 770081 },
  });
  expect(snapshot.actor).toBeNull();
  expect(snapshot.data).not.toHaveProperty("character");
  expect(snapshot.data).not.toHaveProperty("snapshotId");
  expect(snapshot.data).not.toHaveProperty("plannerObservation");
});

test("未辨識的 consider 仍失效；圖鑑不能恢復已失效的 status", () => {
  const store = seed();
  store.observe([], "/consider 熔核巨像·維斯");
  store.observe(pages(), "/boss");
  expect(store.status()).toBeUndefined();
  expect(combatSnapshot(store, "boss").data.statusInvalidation).toMatchObject({
    kind: "non_query_request",
    request: "/consider 熔核巨像·維斯",
    statusSource: { messageId: 770081, date: statusDate },
  });
});

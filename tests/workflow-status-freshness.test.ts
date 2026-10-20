import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { parseCharacterStatus } from "../src/character-status.js";
import { combatSnapshot } from "../src/workflow-combat.js";
import {
  statusFacts,
  WorkflowObservations,
} from "../src/workflow-observations.js";
import { message } from "./fixtures/workflow.js";

const raw = readFileSync(
  new URL("./fixtures/character-status-berserker-769232.txt", import.meta.url),
  "utf8",
);
const date = 1792495124;
const status = message(769232, raw, false, date);
afterEach(() => vi.restoreAllMocks());

// 使用者提供原文；revision 由 fixture 生成，並非 Telegram 原始 revision。
test.each([0, 33000, 60000])(
  "原生滿級狂戰熊 status 在 %i ms 內能綁定本人，不受裝備特效影響",
  (age) => {
    vi.spyOn(Date, "now").mockReturnValue(date * 1000);
    expect(parseCharacterStatus(status)?.title).toBe(
      "🐺 なるみ_狂戰熊　狂戰熊 二轉Lv80",
    );
    expect(statusFacts(status)).toMatchObject({
      name: "なるみ_狂戰熊",
      hp: 3040,
      maxHp: 3040,
      mp: 146,
      maxMp: 422,
      gold: 66811983,
      location: "星塔前庭",
      attributes: { ATK: 4154, DEF: 3923, INT: 652, AGI: 771 },
    });
    const store = new WorkflowObservations();
    store.observe([status], "/status");
    vi.mocked(Date.now).mockReturnValue(date * 1000 + age);
    const snapshot = combatSnapshot(store, "tower");
    expect(snapshot.actor).toBe("なるみ_狂戰熊");
    expect(snapshot.data.character).toMatchObject({ hp: 3040, mp: 146 });
    expect(snapshot.sources).toContainEqual(
      expect.objectContaining({ messageId: 769232, date }),
    );
    // 只有 status 不代表已取得目標、技能或攻擊資格。
    expect(snapshot.state).toBe("needs_observation");
    expect(snapshot.data).not.toHaveProperty("plannerObservation");
  },
);

test("超過60秒時明示過期與來源，不以重新讀取原文刷新資格", () => {
  vi.spyOn(Date, "now").mockReturnValue(date * 1000 + 60001);
  const store = new WorkflowObservations();
  store.observe([status], "/status");
  const snapshot = combatSnapshot(store, "tower");
  expect(snapshot.blockers).toEqual([
    "本人 /status 原文已過期（訊息 769232，距訊息時間 60001 ms；上限 60000 ms）；須取得新 /status 回覆。",
  ]);
  expect(snapshot.actor).toBeNull();
  expect(snapshot.state).toBe("needs_observation");
  expect(snapshot.data).not.toHaveProperty("snapshotId");
  expect(snapshot.data).not.toHaveProperty("character");
  expect(store.status()).toBeUndefined();
});

test("沒有原文或來源已失效時不誤報過期，也不回退舊角色", () => {
  vi.spyOn(Date, "now").mockReturnValue(date * 1000 + 60001);
  const store = new WorkflowObservations();
  const missing =
    "缺少新鮮且可綁定的本人 /status 原文（可能尚未取得或來源已失效）。";
  expect(combatSnapshot(store, "tower").blockers).toEqual([missing]);
  store.observe([status], "/status");
  store.invalidate();
  expect(combatSnapshot(store, "tower").blockers).toEqual([missing]);
  store.reset();
  expect(combatSnapshot(store, "tower").blockers).toEqual([missing]);
});

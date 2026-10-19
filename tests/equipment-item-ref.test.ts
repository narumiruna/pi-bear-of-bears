import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { gameToolResult } from "../src/bears-result.js";
import { EquipmentSnapshot } from "../src/equipment-snapshot.js";
import { Game } from "../src/game.js";
import {
  inventoryText,
  message,
  NOW,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };
function snapshot(text = inventoryText()) {
  const store = new EquipmentSnapshot();
  store.observe([message(1, statusText()), message(2, text)]);
  return store;
}
test("數量改變時單件流程不得沿用舊名稱與列號", async () => {
  const app = workflowHarness();
  const point = app.seed();
  let reads = 0;
  app.overrides.set("/inventory all", () => {
    reads++;
    return reads === 1
      ? inventoryText()
      : inventoryText().replace("傳世青銅巨劍 —", "傳世青銅巨劍 x2 —");
  });
  const result = await app.call("bears_equip_upgrade", {
    scope: app.scope(point.id),
    weights,
  });
  expect(result.state).toBe("stopped");
  expect(app.sent.filter((command) => command.startsWith("/equip "))).toEqual(
    [],
  );
});
test("itemRef 綁定本次完整背包與列號，非永久 ID，reload 不沿用", () => {
  const store = snapshot();
  const ref = store
    .evaluate(weights)
    .itemReferences.find((item) => item.rowNumber === 2);
  expect(ref).toMatchObject({
    rowNumber: 2,
    backendItemId: null,
    observed: { count: 1, equipped: false },
  });
  expect(ref?.itemRef).toMatch(/^item:/u);
  expect(store.resolveItemRef(ref?.itemRef ?? "", weights).id).toBe(2);
  expect(() => snapshot().resolveItemRef(ref?.itemRef ?? "", weights)).toThrow(
    /參照/u,
  );
  store.reset();
  expect(() => store.resolveItemRef(ref?.itemRef ?? "", weights)).toThrow(
    /參照/u,
  );
});
test.each([
  inventoryText().replace("青銅巨劍 —", "青銅巨劍 x2 —"),
  inventoryText().replace("ATK +10", "ATK +11"),
  inventoryText().replace("青銅巨劍", "青銅巨劍 ✨+1（ATK+1）"),
  inventoryText()
    .replace("  1.", "  9.")
    .replace("  2.", "  1.")
    .replace("  9.", "  2."),
  inventoryText().replace("3 種", "4 種"),
])("新版背包數量、詞條、精煉、重排、缺頁均拒絕舊參照", (text) => {
  const store = snapshot();
  const ref = store
    .evaluate(weights)
    .itemReferences.find((item) => item.rowNumber === 2);
  store.observe([message(3, text)]);
  expect(() => store.resolveItemRef(ref?.itemRef ?? "", weights)).toThrow(
    /參照/u,
  );
});
test("重讀不刷新時效；角色切換、活動或穿戴變更使參照失效", () => {
  for (const change of ["time", "actor", "activity", "worn"] as const) {
    const store = snapshot();
    const ref = store.evaluate(weights).itemReferences[0];
    if (change === "time") {
      vi.mocked(Date.now).mockReturnValue(NOW + 300001);
      store.observe([message(2, inventoryText(), false, NOW / 1000)]);
    } else if (change === "actor") {
      store.observe([message(3, statusText("別角"))]);
    } else if (change === "activity") {
      store.invalidate();
    } else {
      store.observe([message(3, inventoryText(2))]);
    }
    expect(() => store.resolveItemRef(ref?.itemRef ?? "", weights)).toThrow(
      /參照/u,
    );
    vi.mocked(Date.now).mockReturnValue(NOW);
  }
});
test("新首頁缺尾頁時立即拒絕舊參照；補完後只能取得新版本參照", () => {
  const store = snapshot();
  const ref = store.evaluate(weights).itemReferences[0];
  const lines = inventoryText().split("\n");
  store.observe([message(3, lines.slice(0, 2).join("\n"))]);
  expect(() => store.resolveItemRef(ref.itemRef, weights)).toThrow(/參照/u);
  store.observe([message(4, lines.slice(2).join("\n"))]);
  expect(store.evaluate(weights).applicable).toBe(true);
  expect(() => store.resolveItemRef(ref.itemRef, weights)).toThrow(/參照/u);
});

test("多頁版本包含中頁 revision；較舊首頁不被新尾頁刷新 TTL", () => {
  const store = new EquipmentSnapshot();
  const lines = inventoryText().split("\n");
  const header = message(2, lines.slice(0, 2).join("\n"));
  const middle = message(3, lines[2]);
  const footer = message(4, lines.slice(3).join("\n"));
  store.observe([message(1, statusText()), header, middle, footer]);
  const ref = store.evaluate(weights).itemReferences[0];
  store.observe([header, { ...middle, revision: "b".repeat(64) }, footer]);
  expect(() => store.resolveItemRef(ref.itemRef, weights)).toThrow(/參照/u);
  const old = new EquipmentSnapshot();
  old.observe([
    message(1, statusText()),
    { ...header, date: NOW / 1000 - 301 },
    middle,
    footer,
  ]);
  expect(old.evaluate(weights).itemReferences).toEqual([]);
});

test.each(["room", "status", "middle"])(
  "多頁背包在實際 dispatch 前 %s 來源改變時，錯物品／未核價指令為零",
  async (channel) => {
    const app = workflowHarness();
    const point = app.seed();
    const lines = inventoryText().split("\n");
    app.overrides.set("/inventory all", () => [
      lines.slice(0, 2).join("\n"),
      lines[2],
      lines.slice(3).join("\n"),
    ]);
    const send = vi.fn(async () => {});
    const game = new Game(
      async () => ({
        connect: async () => {},
        close: async () => {},
        send,
        message: async () => undefined,
        click: async () => undefined,
        history: () => {
          const source = [...app.raw]
            .reverse()
            .find(
              (record) =>
                !record.outgoing &&
                (channel === "room"
                  ? record.text.startsWith("📍")
                  : channel === "status"
                    ? record.text.startsWith("✨")
                    : record.text === lines[2]),
            );
          if (!source) {
            throw new Error("缺少測試來源");
          }
          source.revision = "c".repeat(64);
          return Promise.resolve([...app.raw]);
        },
      }),
      0,
    );
    const original = vi.mocked(app.context.executeTool).getMockImplementation();
    if (!original) {
      throw new Error("缺少原始測試實作");
    }
    vi.mocked(app.context.executeTool).mockImplementation(async (...args) => {
      if (args[0] !== "bears_equip") {
        return original(...args);
      }
      const result = await gameToolResult(
        await game.act({ text: "/equip 2" }, args[2]?.signal),
      );
      return {
        toolCall: {
          type: "toolCall",
          id: "equip",
          name: "bears_equip",
          arguments: { item: 2 },
        },
        result,
        isError: false,
      };
    });
    const result = await app.call("bears_equip_upgrade", {
      scope: app.scope(point.id),
      weights,
    });
    expect(result.state).toBe("stopped");
    expect(send).not.toHaveBeenCalled();
    expect(result.steps.at(-1), result.blockers.join("；")).toMatchObject({
      tool: "bears_equip",
      state: "not_dispatched",
    });
  },
);

test("同名異詞條不合併；不可區分的同樣裝備不建立個體參照", () => {
  const text = inventoryText().replace("傳世青銅巨劍", "傳世鋼鐵巨劍");
  const distinct = snapshot(text).evaluate(weights).itemReferences;
  expect(
    distinct.filter((ref) => ref.observed.name.includes("鋼鐵")),
  ).toHaveLength(2);
  expect(new Set(distinct.map((ref) => ref.fingerprint)).size).toBe(
    distinct.length,
  );
  const duplicate = text
    .replace("ATK +5", "ATK +10")
    .replace(" 【裝備中】", "");
  const same = snapshot(duplicate).evaluate(weights);
  expect(same.itemReferences).toEqual([]);
  expect(same.applicable).toBe(false);
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, roomText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

function recovery(flee = "💨 你趁亂逃跑了！") {
  const app = workflowHarness();
  app.state.inCombat = true;
  app.overrides.set("/flee", () => {
    app.state.inCombat = false;
    return flee;
  });
  app.overrides.set("/rest", () => {
    app.state.hp = 1000;
    app.state.mp = 100;
    return "💤 充分休息後恢復了！\nHP：1000/1000　MP：100/100";
  });
  const point = app.seed();
  return { app, scope: app.scope(point.id) };
}

// 819014 原生收刀；原生休息形狀來自已保存的818932，不是本輪重送。
test.each(["💨 你趁亂逃跑了！", "你沒有在戰鬥中。"])(
  "固定恢復流程接受原生收刀 %s 與完整休息，仍核身分、怪血及錢差",
  async (flee) => {
    const { app, scope } = recovery(flee);
    const result = await app.call("bears_tower_recover", { scope });
    expect(result.state).toBe("confirmed");
    expect(result.blockers).toEqual([]);
    expect(result.data.recovered).toEqual({ hp: 100, mp: 40, gold: 0 });
    expect(app.sent.filter((c) => c === "/flee")).toHaveLength(1);
    expect(app.sent.filter((c) => c === "/rest")).toHaveLength(1);
    expect(
      app.sent.some((c) => /tower (?:go|quit)|\/attack|\/skill/u.test(c)),
    ).toBe(false);
  },
);

test.each([
  "💨 你趁亂逃跑了！\n受到999傷害",
  "你沒有在戰鬥中。\n未知尾文",
  "逃跑了嗎？",
])("未知收刀回覆不休息、不重送：%s", async (flee) => {
  const { app, scope } = recovery(flee);
  const result = await app.call("bears_tower_recover", { scope });
  expect(result.state).toBe("outcome_unknown");
  expect(app.sent.filter((c) => c === "/flee")).toHaveLength(1);
  expect(app.sent).not.toContain("/rest");
});

test.each([
  "💤 充分休息後恢復了！\nHP：999/1000　MP：100/100",
  "💤 充分休息後恢復了！\nHP：1000/1000　MP：99/100",
  "💤 充分休息後恢復了！\nHP：9007199254740992/9007199254740992　MP：100/100",
  "💤 充分休息後恢復了！\nHP：0/0　MP：100/100",
  "💤 充分休息後恢復了！\nHP：1000/1000　MP：100/100\n未知尾文",
])("不完整或未知原生休息不確認、不重送：%s", async (reply) => {
  const { app, scope } = recovery();
  app.overrides.set("/rest", () => reply);
  const result = await app.call("bears_tower_recover", { scope });
  expect(result.state).toBe("outcome_unknown");
  expect(app.sent.filter((c) => c === "/rest")).toHaveLength(1);
});

test("原生收刀後仍需前庭免費證據，不以原生休息形狀當作零費用", async () => {
  const { app, scope } = recovery();
  app.overrides.set("/look", () =>
    roomText(
      "星塔前庭",
      "下",
      `安全區域${app.state.inCombat ? "\n戰鬥中" : ""}`,
    ),
  );
  const result = await app.call("bears_tower_recover", { scope });
  expect(result.state).toBe("stopped");
  expect(app.sent).not.toContain("/rest");
});

test.each(["gold", "identity", "enemy", "notFull"])(
  "原生恢復仍拒絕驗收差異：%s",
  async (kind) => {
    const { app, scope } = recovery();
    app.overrides.set("/rest", () => {
      app.state.hp = kind === "notFull" ? 900 : 1000;
      app.state.mp = 100;
      if (kind === "gold") {
        app.state.gold--;
      }
      if (kind === "identity") {
        app.state.name = "另一熊";
      }
      if (kind === "enemy") {
        app.state.enemyHp--;
      }
      return "💤 充分休息後恢復了！\nHP：1000/1000　MP：100/100";
    });
    const result = await app.call("bears_tower_recover", { scope });
    expect(result.state).not.toBe("confirmed");
    expect(app.sent.filter((c) => c === "/rest")).toHaveLength(1);
  },
);

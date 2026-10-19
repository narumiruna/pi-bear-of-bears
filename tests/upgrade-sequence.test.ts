import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };
const stats = (suffix: string) =>
  suffix === "·神"
    ? { defense: 444, agility: 684 }
    : suffix === "·極"
      ? { defense: 336, agility: 518 }
      : { defense: 240, agility: 370 };
const inventory = (suffix: string, essence: number, fault?: string) =>
  `🎒 背包（${fault === "lost-original" ? 3 : 4} 種，全列）：
  1. 🟠⚔️傳世鋼鐵巨劍 【裝備中】 — ATK +5（Lv1 可裝備）
  2. 🟠⚡星核行者之靴${suffix}${fault === "auto-equip" ? " 【裝備中】" : ""} — DEF +${stats(suffix).defense} AGI +${stats(suffix).agility}（BOSS 進階）
  3. 王之精魄 x${essence} — 從 BOSS 凝聚而出的力量結晶，於鍛造台用來進階王裝（/forge）。
${fault === "lost-original" ? "" : `  4. 🟠👟星屑輕靴${fault === "auto-equip" ? "" : " 【裝備中】"} — DEF +110 AGI +170（星塔 15 層首達）\n`}🔢 用編號最方便：/inspect 1`;
const receipt = (
  from: string,
  to: string,
  essence: number,
  gold: string,
  tax: string,
) =>
  `🔨✨ 進階成功！⚡ 星核行者之靴${from} → ⚡【星核行者之靴${to}】\n　防禦 +${stats(to).defense}、敏捷 +${stats(to).agility}（BOSS 進階）\n　（消耗 💠×${essence} ＋ ${gold}G＋鑄造稅 ${tax}G）`;
const quote = (stage: string, total: number, essence: number, index = 1) =>
  `${index}. 星核行者之靴\n階段：${stage}\n含稅總額：${total}G\n精魄：${essence}\n材料需求完整\n進階後屬性：DEF +${stats(stage === "base → ·極" ? "·極" : "·神").defense} AGI +${stats(stage === "base → ·極" ? "·極" : "·神").agility}`;
const finish = (
  app: ReturnType<typeof workflowHarness>,
  gold: number,
  suffix: string,
  essence: number,
  fault?: string,
) => {
  app.observe(statusText("測試熊", 900, 60, gold), "/status");
  app.observe(inventory(suffix, essence, fault), "/inventory all");
  return app.store.capture();
};

test("兩階 forge 只作條件研究；每階以新狀態／背包對帳，保留原裝，後階新價不得沿用舊合計", async () => {
  const app = workflowHarness();
  app.state.gold = 4000000;
  app.seed();
  app.observe(inventory("", 50), "/inventory all");
  const before = app.store.capture();
  app.observe(
    `${quote("base → ·極", 600000, 10)}\n${quote("·極 → ·神", 2250000, 30, 2)}`,
    "/forge",
  );
  const plan = await app.call("bears_plan_upgrade", {
    target: "星核行者之靴",
    metric: "attributes",
    weights,
  });
  expect(plan.data.quotePaths).toEqual([
    expect.objectContaining({
      conditionalQuoteTotalGold: 2850000,
      canPay: false,
      revalidateAfterEveryStage: true,
      materials: [{ name: "王之精魄", quantity: 40, held: 50, missing: 0 }],
    }),
  ]);
  // 合成已完成回執，不發送 forge；計畫不提供自動付款工具。
  app.observe(receipt("", "·極", 10, "400,000", "200,000"), "/forge 1");
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  const first = finish(app, 3400000, "·極", 40);
  expect(
    (
      await app.call("bears_reconcile_rewards", {
        before: before.id,
        after: first.id,
      })
    ).state,
  ).toBe("confirmed");
  app.observe(
    quote("·極 → ·神", 2500000, 30).replace(
      "1. 星核行者之靴",
      "1. 星核行者之靴·極",
    ),
    "/forge",
  );
  const repriced = await app.call("bears_plan_upgrade", {
    target: "星核行者之靴·極",
    metric: "attributes",
    weights,
  });
  expect(
    (repriced.data.candidates as { totalGold: number }[])[0].totalGold,
  ).toBe(2500000);
  expect(repriced.data.quotePaths).toEqual([]);
  app.observe(receipt("·極", "·神", 30, "1,500,000", "1,000,000"), "/forge 1");
  vi.mocked(Date.now).mockReturnValue(NOW + 2000);
  const second = finish(app, 900000, "·神", 10);
  const closed = await app.call("bears_reconcile_rewards", {
    before: first.id,
    after: second.id,
  });
  expect(closed.state).toBe("confirmed");
  expect(closed.data.debits).toBe(2500000);
  const combined = await app.call("bears_reconcile_rewards", {
    before: before.id,
    after: second.id,
  });
  expect(combined.state).toBe("confirmed");
  expect(combined.data.debits).toBe(3100000);
  expect(app.sent).toEqual([]);
});

test.each(["gold", "essence", "auto-equip", "lost-original"])(
  "第一階 %s 不符不交付閉帳或下一階許可，不自動付款／復原",
  async (fault) => {
    const app = workflowHarness();
    app.state.gold = 4000000;
    app.seed();
    const initial = inventory("", 50);
    app.observe(
      fault === "lost-original"
        ? initial.replace("星屑輕靴 【裝備中】", "星屑輕靴")
        : initial,
      "/inventory all",
    );
    const before = app.store.capture();
    app.observe(receipt("", "·極", 10, "400,000", "200,000"), "/forge 1");
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    const after = finish(
      app,
      fault === "gold" ? 3399999 : 3400000,
      "·極",
      fault === "essence" ? 39 : 40,
      fault,
    );
    const result = await app.call("bears_reconcile_rewards", {
      before: before.id,
      after: after.id,
    });
    expect(result.state).toBe("needs_observation");
    expect(result.data.netGoldPerMinute).toBeNull();
    expect(app.sent).toEqual([]);
  },
);

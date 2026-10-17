import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { depositAmount } from "../src/workflow-wallet.js";
import { homeText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test.each([
  [0, 0, 0],
  [20, 80, 0],
  [21, 79, 11],
  [1000, 0, 900],
  [101, 0, 91],
])("存款公式 C=%i V=%i D=%i，嚴格門檻及向下取整", (cash, vault, deposit) => {
  expect(depositAmount(cash, vault, 20, 10).deposit).toBe(deposit);
});

test("存款使用精確整數、拒絕非法策略與非有限數", () => {
  const cash = Number.MAX_SAFE_INTEGER,
    vault = Number.MAX_SAFE_INTEGER;
  expect(depositAmount(cash, vault, 20, 10).total).toBe(
    (BigInt(cash) + BigInt(vault)).toString(),
  );
  for (const args of [
    [NaN, 0, 20, 10],
    [1, 0, 10, 20],
    [1.5, 0, 20, 10],
    [-1, 0, 20, 10],
  ]) {
    expect(() => depositAmount(args[0], args[1], args[2], args[3])).toThrow();
  }
});

test("同角色存款：雙餘額重驗、一次存入、實支核對，不提款或移動", async () => {
  const app = workflowHarness();
  app.state.location = "熊熊溫暖的家";
  const point = app.seed();
  const result = await app.call("bears_balance_wallet", {
    scope: app.scope(point.id),
    policy: { thresholdPercent: 20, targetPercent: 10, maxDeposit: 900 },
  });
  expect(result.blockers).toEqual([]);
  expect(result.state).toBe("confirmed");
  expect(result.data.deposited).toBe(900);
  expect(app.sent.filter((command) => command.startsWith("/deposit"))).toEqual([
    "/deposit 900",
  ]);
  expect(
    app.sent.some((command) => /withdraw|switch|\/go/u.test(command)),
  ).toBe(false);
});

test("存款非零手續費在 scope 範圍內，費用與本金分開驗收", async () => {
  const app = workflowHarness();
  app.state.location = "熊熊溫暖的家";
  const point = app.seed();
  app.overrides.set("/home", () =>
    homeText(app.state.gold, app.state.vault, "3G"),
  );
  app.overrides.set("/deposit 900", () => {
    app.state.gold = 97;
    app.state.vault = 900;
    return "存款成功：900G\n手續費：3G";
  });
  const result = await app.call("bears_balance_wallet", {
    scope: { ...app.scope(point.id), maxGold: 3 },
    policy: { thresholdPercent: 20, targetPercent: 10, maxDeposit: 900 },
  });
  expect(result.state).toBe("confirmed");
  expect(result.data.actualFee).toBe(3);
  expect(result.data.deposited).toBe(900);
  expect(result.data.observedTotalChange).toBe("-3");
});

test.each(["fee", "remote", "budget", "changed", "mismatch"])(
  "存款停止 %s，不修改策略或補存",
  async (kind) => {
    const app = workflowHarness();
    app.state.location = kind === "remote" ? "星塔前庭" : "熊熊溫暖的家";
    const point = app.seed();
    let homes = 0;
    app.overrides.set("/home", () => {
      homes++;
      return homeText(
        app.state.gold,
        kind === "changed" && homes === 2 ? 1 : app.state.vault,
        kind === "fee" ? "未知" : "0G",
      );
    });
    if (kind === "mismatch") {
      app.overrides.set("/deposit 900", () => {
        app.state.gold = 99;
        app.state.vault = 900;
        return "存款成功：900G";
      });
    }
    const result = await app.call("bears_balance_wallet", {
      scope: app.scope(point.id),
      policy: {
        thresholdPercent: 20,
        targetPercent: 10,
        maxDeposit: kind === "budget" ? 899 : 900,
      },
    });
    expect(result.state).not.toBe("confirmed");
    expect(
      app.sent.filter((command) => command.startsWith("/deposit")),
    ).toHaveLength(kind === "mismatch" ? 1 : 0);
  },
);

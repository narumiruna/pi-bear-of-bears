import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { inventoryText, NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

const name = "🟠⚔️未知試劍";
const weights = { attack: 1, defense: 1, intelligence: 1, agility: 1 };

// 合成品項重用 797731／797847 已觀察的原生 inspect 版面；不是實機換裝驗證。
function inspection(title = name, native = true) {
  return [
    title,
    ...(native ? ["────────────────", "稀有度：🟠傳說"] : []),
    "類型：武器（武器槽）",
    "需求等級：Lv1　✅ 可裝備（你 Lv10）",
    "屬性：ATK +10",
    "持有：1 件",
  ].join("\n");
}

function setup(text: string) {
  const app = workflowHarness();
  const point = app.seed();
  app.overrides.set("/inventory all", () =>
    inventoryText().replaceAll("🟠⚔️傳世青銅巨劍", name),
  );
  app.overrides.set("/inspect 2", () => text);
  return { app, point };
}

for (const native of [true, false]) {
  test(`換裝辨識${native ? "原生分隔線／稀有度" : "既有簡式"} inspect；未列屬性仍不補零或換裝`, async () => {
    const { app, point } = setup(inspection(name, native));
    const result = await app.call("bears_equip_upgrade", {
      scope: app.scope(point.id),
      weights,
    });
    expect(result.steps.find((step) => step.tool === "bears_inspect")).toEqual({
      tool: "bears_inspect",
      state: "confirmed",
    });
    expect(result.state).toBe("stopped");
    expect(result.blockers.join(" ")).toContain("配裝資料不足");
    expect(result.blockers.join(" ")).not.toContain("結果不明");
    expect(app.sent.filter((command) => command === "/inspect 2")).toHaveLength(
      1,
    );
    expect(app.sent.some((command) => command.startsWith("/equip"))).toBe(
      false,
    );
  });
}

for (const text of [
  inspection(`${name}·極`),
  inspection("🟠⚔️其他試劍"),
  `${name}\n稀有度：🟠傳說\n屬性：ATK +10`,
]) {
  test(`不接受錯名、名稱前綴或缺類型的 inspect：${text.split("\n")[0]}`, async () => {
    const { app, point } = setup(text);
    const result = await app.call("bears_equip_upgrade", {
      scope: app.scope(point.id),
      weights,
    });
    expect(
      result.steps.find((step) => step.tool === "bears_inspect")?.state,
    ).not.toBe("confirmed");
    expect(app.sent.filter((command) => command === "/inspect 2")).toHaveLength(
      1,
    );
    expect(app.sent.some((command) => command.startsWith("/equip"))).toBe(
      false,
    );
  });
}

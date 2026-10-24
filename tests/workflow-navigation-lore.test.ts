import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { roomFacts } from "../src/workflow-parsers.js";
import type { Room } from "../src/world.js";
import { NOW, roomText, workflowHarness } from "./fixtures/workflow.js";

const receipt = JSON.parse(
  readFileSync(
    new URL("./fixtures/navigation-795522.json", import.meta.url),
    "utf8",
  ),
) as { text: string };
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

function setup(text = receipt.text, fee = 0) {
  const app = workflowHarness();
  app.state.location = "熔岩裂縫";
  const point = app.seed();
  app.world.allRooms = vi.fn(
    async (): Promise<Room[]> => [
      {
        id: 1,
        name: "熔岩裂縫",
        safe: false,
        boss: false,
        description: "",
        exits: { 南: 2 },
      },
      {
        id: 2,
        name: "冥界之門",
        safe: false,
        boss: false,
        description: "",
        exits: { 北: 1 },
      },
    ],
  );
  app.overrides.set("/look", () => roomText(app.state.location, "南→冥界之門"));
  app.overrides.set("/go 南", () => {
    app.state.location = "冥界之門";
    app.state.gold -= fee;
    return text;
  });
  return { app, scope: app.scope(point.id) };
}

test("門圖示房名能解析，僅出口列仍不能當房名", () => {
  expect(roomFacts(receipt.text)).toMatchObject({
    name: "冥界之門",
    exits: ["北", "東"],
  });
  expect(roomFacts("🚪 出口：北→熔岩裂縫　東→獵人要塞")).toBeUndefined();
});

test("795522明示抵達冥界之門；固定敘事無法開啟不是移動拒絕，仍核位置與零費", async () => {
  const { app, scope } = setup();
  const result = await app.call("bears_move_to", { scope, destination: 2 });
  expect(result.state).toBe("confirmed");
  expect(result.data.walked).toEqual([{ direction: "南", room: "冥界之門" }]);
  expect(result.data.lastStatus).toMatchObject({
    location: "冥界之門",
    gold: 1000,
  });
  expect(result.data.observedGoldSpend).toBe(0);
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 南",
  ]);
});

for (const [name, text] of [
  ["明示移動失敗", `${receipt.text}\n移動失敗，無法通過。`],
  [
    "未知拒絕文案",
    receipt.text.replace("大門緊閉且無法開啟", "你無法進入大門"),
  ],
  ["不同方向", receipt.text.replace("你往南走去", "你往東走去")],
  ["不同房名", receipt.text.replace("🚪 冥界之門", "🚪 其他大門")],
  ["非移動回執", receipt.text.replace("你往南走去…\n", "")],
] as const) {
  test(`冥界敘事例外不吞掉${name}，不重送`, async () => {
    const { app, scope } = setup(text);
    const result = await app.call("bears_move_to", { scope, destination: 2 });
    expect(result.state).toBe("stopped");
    expect(result.steps.at(-1)?.state).toBe("rejected");
    expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
      "/go 南",
    ]);
  });
}

test("敘事例外不豁免實際費用核對，扣金仍停止", async () => {
  const { app, scope } = setup(receipt.text, 1);
  const result = await app.call("bears_move_to", { scope, destination: 2 });
  expect(result.state).toBe("stopped");
  expect(result.data.observedGoldSpend).toBe(1);
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 南",
  ]);
});

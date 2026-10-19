import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { workflowResult } from "../src/workflow-result.js";
import { WorkflowRunner } from "../src/workflow-runner.js";
import {
  NOW,
  roomText,
  skillsText,
  statusText,
  workflowHarness,
} from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());
const runner = (app: ReturnType<typeof workflowHarness>) =>
  new WorkflowRunner(
    app.store,
    app.context,
    workflowResult("測試熊"),
    undefined,
    new AbortController().signal,
  );

test("room／tower／home／skills 按需準備重用各自有效來源，不送指令或額外history", async () => {
  const app = workflowHarness();
  app.seed();
  const run = runner(app);
  for (const channel of ["room", "tower", "home", "skills"] as const) {
    expect(await run.prepareObservation(channel)).toBeDefined();
  }
  expect(app.sent).toEqual([]);
  expect(app.context.executeTool).not.toHaveBeenCalled();
  expect(run.result.sources).toHaveLength(4);
  expect(run.result.sources.every((source) => source.observedAt === NOW)).toBe(
    true,
  );
});

test("缺漏才逐筆補查；強制刷新僅影響指定通道，不以新status刷新舊資料", async () => {
  const app = workflowHarness();
  app.seed();
  vi.mocked(Date.now).mockReturnValue(NOW + 61000);
  app.observe(statusText(), "/status");
  app.overrides.set("/skills", () => skillsText);
  const run = runner(app);
  await run.prepareObservation("skills");
  await run.prepareObservation("skills");
  await run.prepareObservation("room");
  await run.prepareObservation("room", true);
  expect(app.sent).toEqual(["/skills", "/look", "/look"]);
  expect(app.events.filter((event) => event.tool === "bears_history")).toEqual(
    [],
  );
});

test("補查期間切角或掛機中不繼續、不查未知副作用通道，也不自動停掛", async () => {
  const app = workflowHarness();
  app.state.idle = true;
  app.seed();
  await expect(runner(app).prepareObservation("skills", true)).rejects.toThrow(
    /掛機/u,
  );
  expect(app.sent).toEqual([]);
  const changed = workflowHarness();
  changed.seed();
  changed.overrides.set("/look", () => {
    changed.observe(statusText("別角"), "/status");
    return roomText();
  });
  await expect(
    runner(changed).prepareObservation("room", true),
  ).rejects.toThrow(/角色|來源/u);
  expect(changed.sent).toEqual(["/look"]);
});

test("未知回覆最多補讀兩次，不重送；不是建立可執行資料的替代路徑", async () => {
  const app = workflowHarness();
  app.seed();
  app.overrides.set("/skills", () => "無法識別的技能協定");
  await expect(runner(app).prepareObservation("skills", true)).rejects.toThrow(
    /結果不明/u,
  );
  expect(app.sent).toEqual(["/skills"]);
  expect(
    app.events.filter((event) => event.tool === "bears_history"),
  ).toHaveLength(2);
});

test("移動後外部新房間／戰鬥觀測不沿用先前到達回覆，也不繼續下一步", async () => {
  for (const conflict of ["location", "combat"]) {
    const app = workflowHarness();
    const point = app.seed();
    app.overrides.set("/status", () => {
      if (app.state.location === "安全站") {
        app.observe(
          roomText(
            conflict === "location" ? "另一房" : "安全站",
            "上",
            conflict === "combat" ? "戰鬥中" : "安全區域",
          ),
          "/look",
        );
      }
      return statusText("測試熊", 900, 60, 1000, app.state.location);
    });
    const result = await app.call("bears_move_to", {
      scope: app.scope(point.id),
      destination: "安全站",
    });
    expect(result.state).toBe("stopped");
    expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
      "/go 下",
    ]);
    expect(app.sent.filter((command) => command === "/look")).toHaveLength(1);
  }
});

test("移動回覆已含現場時只重用該次新房間，仍新核status／費用與送出前來源", async () => {
  const app = workflowHarness();
  const point = app.seed();
  const result = await app.call("bears_move_to", {
    scope: app.scope(point.id),
    destination: "安全站",
  });
  expect(result.state).toBe("confirmed");
  expect(app.sent.filter((command) => command === "/look")).toHaveLength(1);
  expect(app.sent.filter((command) => command === "/status")).toHaveLength(2);
  expect(app.sent.filter((command) => command.startsWith("/go "))).toEqual([
    "/go 下",
  ]);
  expect(result.data.lastLocation).toBe("安全站");
  expect(
    app.events.filter((event) => event.tool === "bears_history"),
  ).toHaveLength(2);
});

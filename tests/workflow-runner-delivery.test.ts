import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toolResult } from "../src/output.js";
import { workflowResult } from "../src/workflow-result.js";
import { WorkflowRunner } from "../src/workflow-runner.js";
import { NOW, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

// 2026-10-21 原始限流錯誤的去識別最小案例；不是遊戲操作授權。
const unknownDelivery = JSON.stringify({
  version: 1,
  kind: "command",
  delivery: "unknown",
  observation: "unknown",
  outcome: "unknown",
  code: "OUTCOME_UNKNOWN",
  messages: [],
  complete: false,
  reasons: [
    "Telegram rate limit: wait 3 seconds before any further requests. Action may have reached the bot; outcome is unknown. Do not retry it. Read bears_history before deciding what to do next.",
  ],
});

for (const change of [false, true]) {
  test(`限流且送達未知時，${change ? "變更" : "查詢"}步驟均保留 outcome_unknown，不補查或重送`, async () => {
    const app = workflowHarness();
    const point = app.seed();
    vi.mocked(app.context.executeTool).mockRejectedValueOnce(
      new Error(unknownDelivery),
    );
    const result = workflowResult("測試熊");
    const run = new WorkflowRunner(
      app.store,
      app.context,
      result,
      app.scope(point.id),
      new AbortController().signal,
    );
    await expect(
      run.step(
        change ? "bears_go" : "bears_status",
        change ? { direction: "下" } : {},
        () => undefined,
        change,
      ),
    ).rejects.toThrow(/rate limit/u);
    expect(result.steps[0].state).toBe("outcome_unknown");
    expect(app.context.executeTool).toHaveBeenCalledTimes(1);
  });
}

test("明示未送出的拒絕仍保留 not_dispatched，不補查或重送", async () => {
  const app = workflowHarness();
  app.seed();
  vi.mocked(app.context.executeTool).mockRejectedValueOnce(
    new Error("not dispatched: blocked; not approved"),
  );
  const result = workflowResult("測試熊");
  const run = new WorkflowRunner(
    app.store,
    app.context,
    result,
    undefined,
    new AbortController().signal,
  );
  await expect(run.step("bears_status", {}, () => undefined)).rejects.toThrow(
    /not dispatched/u,
  );
  expect(result.steps[0].state).toBe("not_dispatched");
  expect(app.context.executeTool).toHaveBeenCalledTimes(1);
});

for (const change of [false, true]) {
  test(`完整錯誤封裝的${change ? "變更" : "查詢"}限流保留送達未知與原文來源`, async () => {
    // 2026-10-22 20:21 的最小封裝：錯誤本文另附 originalSourceId。
    const app = workflowHarness();
    const point = app.seed();
    const errorResult = await toolResult(JSON.parse(unknownDelivery));
    const tool = change ? "bears_go" : "bears_status";
    const args: Record<string, string> = change ? { direction: "下" } : {};
    vi.mocked(app.context.executeTool).mockResolvedValueOnce({
      toolCall: {
        type: "toolCall",
        id: "delivery-unknown",
        name: tool,
        arguments: args,
      },
      result: errorResult,
      isError: true,
    });
    const result = workflowResult("測試熊");
    const run = new WorkflowRunner(
      app.store,
      app.context,
      result,
      app.scope(point.id),
      new AbortController().signal,
    );
    await expect(run.step(tool, args, () => undefined, change)).rejects.toThrow(
      /rate limit/u,
    );
    expect(result.steps).toEqual([{ tool, state: "outcome_unknown" }]);
    expect(result.data.originalSources).toEqual([
      { tool, originalSourceId: errorResult.details.bearsOriginal.sourceId },
    ]);
    expect(app.context.executeTool).toHaveBeenCalledTimes(1);
  });
}

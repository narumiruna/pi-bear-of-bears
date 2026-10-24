import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { workflowInterruption } from "../src/workflow-interruption.js";
import { workflowResult } from "../src/workflow-result.js";
import { NOW, statusText, workflowHarness } from "./fixtures/workflow.js";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

test("單一摘要取代舊現況，不刷新觀測時間或送指令", async () => {
  const app = workflowHarness();
  app.seed();
  const first = app.store.continuation();
  vi.mocked(Date.now).mockReturnValue(NOW + 1000);
  const second = await app.call("bears_inventory_snapshot", {
    includeContinuation: true,
  });
  expect(second.data.continuation).toEqual(first);
  expect(first).toMatchObject({
    controlledCharacter: "測試熊",
    actionable: false,
    statusSource: { observedAt: NOW },
  });
  app.observe(statusText("測試熊", 800, 50, 900, "安全站"), "/status");
  const next = app.store.continuation();
  expect(next.lastStatus).toMatchObject({
    hp: 800,
    mp: 50,
    gold: 900,
    location: "安全站",
  });
  expect(app.sent).toEqual([]);
  expect(app.context.executeTool).not.toHaveBeenCalled();
});

test("未知操作保留且不因新查詢成功清除；新未決回報不覆蓋舊操作", () => {
  const app = workflowHarness();
  app.seed();
  const pending = workflowResult("測試熊");
  pending.steps.push({ tool: "bears_go", state: "outcome_unknown" });
  app.store.rememberWorkflow(pending);
  app.store.rememberWorkflow(workflowResult("測試熊"));
  const query = workflowResult("測試熊");
  query.steps.push({ tool: "bears_status", state: "outcome_unknown" });
  app.store.rememberWorkflow(query);
  expect(app.store.continuation().pendingWorkflows).toMatchObject({
    reports: [
      {
        character: "測試熊",
        steps: [{ tool: "bears_go", state: "outcome_unknown" }],
      },
      {
        character: "測試熊",
        steps: [{ tool: "bears_status", state: "outcome_unknown" }],
      },
    ],
    omittedReports: 0,
  });
});

test("切角／來源失效與過期明示歷史；reload 不恢復未決操作，拒絕舊分支晚到結果", () => {
  const app = workflowHarness();
  app.seed();
  const generation = app.store.generation;
  const pending = workflowResult("測試熊");
  pending.steps.push({ tool: "bears_go", state: "outcome_unknown" });
  app.store.rememberWorkflow(pending);
  vi.mocked(Date.now).mockReturnValue(NOW + 60001);
  expect(app.store.continuation()).toMatchObject({
    controlledCharacter: null,
    lastObservedCharacter: "測試熊",
    statusFresh: false,
    nativeIdle: null,
    lastObservedNativeIdle: false,
    statusSource: { observedAt: NOW },
  });
  app.observe(statusText("乙熊"), "/status");
  expect(app.store.continuation()).toMatchObject({
    controlledCharacter: "乙熊",
    lastStatus: { name: "乙熊" },
    pendingWorkflows: { reports: [{ sameControlContext: false }] },
  });
  app.store.reset();
  app.store.rememberWorkflow(pending, generation);
  expect(app.store.continuation()).toMatchObject({
    controlledCharacter: null,
    lastStatus: null,
    pendingWorkflows: { reports: [], omittedReports: 0 },
  });
  expect(app.sent).toEqual([]);
});

test("未決檢查點保留原目標與送達狀態，來源修訂後明示缺證", () => {
  const app = workflowHarness();
  const point = app.seed();
  const pending = workflowResult("測試熊", point.sources);
  pending.steps.push({ tool: "bears_go", state: "outcome_unknown" });
  pending.data.lastLocation = "安全站";
  pending.data.interruption = workflowInterruption(
    pending,
    8,
    "結果不明",
    false,
  );
  app.store.rememberWorkflow(pending);
  const first = app.store.continuation();
  expect(first.pendingWorkflows.reports[0]).toMatchObject({
    interruption: {
      target: 8,
      lastConfirmedLocation: "安全站",
      delivery: "unknown",
    },
    sameControlContext: true,
    sourceValidation: { allReferencesMatch: true },
  });
  const source = app.raw[0];
  app.store.observe([{ ...source, revision: "changed" }]);
  expect(app.store.continuation().pendingWorkflows.reports[0]).toMatchObject({
    sourceValidation: {
      allReferencesMatch: false,
      issues: [expect.objectContaining({ reason: "revision_changed" })],
    },
  });
  expect(first.pendingWorkflows.reports[0]).toMatchObject({
    sourceValidation: { allReferencesMatch: true },
  });
});

test("缺頁與保存範圍淘汰明列，不把遺失的未決來源當仍有效", () => {
  const app = workflowHarness();
  const point = app.seed();
  const pending = workflowResult("測試熊", point.sources);
  pending.steps.push({ tool: "bears_go", state: "outcome_unknown" });
  app.store.rememberWorkflow(pending);
  app.store.observe([], undefined, 1);
  expect(app.store.continuation()).toMatchObject({
    statusFresh: false,
    statusInvalidation: { kind: "omitted" },
    observationCoverage: { omittedBatches: 1, evictedMessages: 0 },
  });
  for (let index = 0; index < 601; index++) {
    app.observe(statusText(), "/status");
  }
  const result = app.store.continuation();
  expect(result.observationCoverage.evictedMessages).toBeGreaterThan(0);
  expect(result.pendingWorkflows.reports[0]).toMatchObject({
    sourceValidation: {
      allReferencesMatch: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ reason: "source_missing" }),
      ]),
    },
  });
  app.store.reset();
  expect(app.store.continuation()).toMatchObject({
    observationCoverage: {
      omittedBatches: 0,
      evictedMessages: 0,
      savedMessages: 0,
    },
    pendingWorkflows: { reports: [] },
  });
  expect(app.sent).toEqual([]);
});

test("未決來源診斷有界且不將無來源回報當成匹配成功", () => {
  const app = workflowHarness();
  const point = app.seed();
  const pending = workflowResult("測試熊");
  pending.steps.push({ tool: "bears_status", state: "outcome_unknown" });
  app.store.rememberWorkflow(pending);
  expect(app.store.continuation().pendingWorkflows.reports[0]).toMatchObject({
    sourceValidation: {
      allReferencesMatch: false,
      issues: [{ source: null, reason: "missing_source_list" }],
    },
  });
  pending.sources = Array.from({ length: 35 }, (_, index) => ({
    ...point.sources[0],
    messageId: 9000 + index,
  }));
  app.store.rememberWorkflow(pending);
  const diagnosis =
    app.store.continuation().pendingWorkflows.reports[1].sourceValidation;
  expect(diagnosis).toMatchObject({
    allReferencesMatch: false,
    checkedSources: 35,
    omittedIssues: 15,
  });
  expect(diagnosis.issues).toHaveLength(20);
});

test("較新的未確認處置不能被較舊成功回執蓋過", () => {
  const app = workflowHarness();
  app.seed();
  const fixtures = JSON.parse(
    readFileSync(
      new URL("./fixtures/native-forge.json", import.meta.url),
      "utf8",
    ),
  ) as { text: string }[];
  const receipt = app.observe(fixtures[2].text, "/forge 4");
  expect(app.store.continuation().lastIrreversibleObservation).toMatchObject({
    kind: "parsed_receipt",
    source: { messageId: receipt.id },
  });
  const request = app.observe("/dismantle 傳世青銅巨劍", undefined, true);
  expect(app.store.continuation()).toMatchObject({
    lastIrreversibleObservation: {
      kind: "unverified_request",
      source: { messageId: request.id },
    },
    lastIrreversibleReceipt: { source: { messageId: receipt.id } },
    actionable: false,
  });
});

test("相關不可逆指令只記來源，不把已送出或預覽當成成功處置", () => {
  const app = workflowHarness();
  app.seed();
  const request = app.observe("/dismantle 傳世青銅巨劍", undefined, true);
  expect(app.store.continuation()).toMatchObject({
    controlledCharacter: null,
    irreversibleReceiptCoverage: "forge_receipts_only",
    lastIrreversibleReceipt: null,
    recentRelatedRequests: [
      {
        source: { messageId: request.id },
        commandCategory: "/dismantle",
        confirmation: "request_only_may_include_preview",
      },
    ],
    actionable: false,
  });
  expect(app.sent).toEqual([]);
});

test("未決回報有界且明列省略數，傳出摘要不能改內部證據", () => {
  const app = workflowHarness();
  app.seed();
  const pending = workflowResult("測試熊");
  pending.steps.push({ tool: "bears_go", state: "submitted" });
  for (let i = 0; i < 21; i++) {
    app.store.rememberWorkflow(pending);
  }
  const checkpoint = app.store.continuation();
  expect(checkpoint.pendingWorkflows.reports).toHaveLength(20);
  expect(checkpoint.pendingWorkflows.omittedReports).toBe(1);
  checkpoint.pendingWorkflows.reports.length = 0;
  expect(app.store.continuation().pendingWorkflows.reports).toHaveLength(20);
});

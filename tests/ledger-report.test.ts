import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  ledgerCheckpoint,
  previewLedgerExport,
  writeLedgerExport,
} from "../src/ledger-checkpoint.js";
import { ledgerEvidence } from "../src/ledger-evidence.js";
import { LedgerPages } from "../src/ledger-pages.js";
import { ledgerPage, ledgerStatus } from "../src/ledger-query.js";
import { ledgerActivity, ledgerReport } from "../src/ledger-report.js";
import { compareCombatConditions } from "../src/workflow-combat-history.js";
import { ledgerHarness, skillText } from "./fixtures/ledger.js";
import { inventoryText, skillsText, towerText } from "./fixtures/workflow.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
const setup = () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  return h;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of open.splice(0)) {
    h.close();
  }
});

test("報表缺傷害起點不以名目補實傷；已包含真傷排除，usage 缺資料保持 unknown", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬");
  const report = ledgerReport(h.runtime.read());
  expect(report).toMatchObject({
    samples: 1,
    confirmedMpCost: 32,
    effectiveDamage: null,
    damagePerMp: null,
    agent: { modelUsage: null },
    coverage: { knownCosts: 1, knownDamageEvents: 0, damageEvents: 1 },
  });
  expect(report.operationalEligibility).toBe(false);
  expect(report.riskVerified).toBe(false);
});

test("固定 replay 資料集驗算實傷、MP、通層首達與錢差，不重加怪金", async () => {
  const h = setup();
  h.seed();
  const combat =
    "戰鬥紀錄：合成星影\nMP消耗：32\n對敵傷害：100；敵HP：100→0/100\n結算：勝利\n獲得金幣：5G";
  await h.act("/skill 合成小招", [
    combat,
    "通層回執：第1層\n怪金：5G\n首達：100G\n合計：105G",
  ]);
  const report = ledgerReport(h.runtime.read());
  expect(report).toMatchObject({
    effectiveDamage: 100,
    confirmedMpCost: 32,
    damagePerMp: 3.125,
    damagePerAction: 100,
    gold: { firstClear: 100, repeatable: 5, totalClearReceipts: 105 },
  });
});

test("時間聯集排除重疊父子；中斷不是已證明等待，負區間不補零", () => {
  expect(
    ledgerActivity([
      { start: 100, end: 200 },
      { start: 120, end: 170 },
      { start: 250, end: 300 },
    ]),
  ).toEqual({
    elapsedMs: 200,
    activeMs: 150,
    interruptions: [{ start: 200, end: 250 }],
    clockValid: true,
  });
  expect(ledgerActivity([{ start: 2, end: 1 }])).toMatchObject({
    elapsedMs: null,
    activeMs: null,
    clockValid: false,
  });
  expect(ledgerActivity([]).activeMs).toBeNull();
});

test("operation ID 關聯 metrics，分支級文件與模型成本不冒稱單手精確成本", async () => {
  const h = setup();
  h.seed();
  const result = await h.act("/skill 血怒亂斬");
  const id = result.accounting?.operationId;
  if (!id) {
    throw new Error("缺 operation");
  }
  const call = h.runtime.read().contexts.find((c) => c.toolCallId)?.toolCallId;
  if (!call) {
    throw new Error("缺 call");
  }
  const start = Date.now();
  h.runtime.metric({
    toolCallId: call,
    toolName: "bears_send",
    parentToolCallId: "parent",
    startedAt: start,
    durationMs: 100,
    isError: false,
  });
  h.runtime.metric({
    toolCallId: "parent",
    toolName: "codemode",
    startedAt: start,
    durationMs: 150,
    isError: false,
  });
  h.runtime.metric({
    toolCallId: "doc",
    toolName: "edit",
    startedAt: start + 160,
    durationMs: 20,
    isError: false,
  });
  h.runtime.usage({
    input: 10,
    output: 5,
    totalTokens: 15,
    cost: { total: 0.01 },
  });
  const report = ledgerReport(h.runtime.read());
  expect(report.timing).toMatchObject({
    activeMs: 100,
    elapsedMs: 100,
    categories: { battle: 100 },
  });
  expect(report.agent).toMatchObject({
    timing: { activeMs: 170, elapsedMs: 180 },
    documentActiveMs: 20,
    modelUsage: { input: 10, output: 5, totalTokens: 15, costUsd: 0.01 },
  });
  expect(report.coverage.metricLinkedOperations).toBe(1);
});

test("條件證據保留配裝／技能／樓層／血量階段與未知政策；changed-since 只列新樣本", async () => {
  const h = setup();
  h.seed();
  for (const text of [
    inventoryText(),
    skillsText,
    towerText(91, 900, "合成星影"),
  ]) {
    const m = h.add(text);
    h.runtime.watch([m], 0);
  }
  await h.act("/skill 血怒亂斬");
  const first = ledgerEvidence(h.runtime.read());
  expect(first.samples[0].conditions).toMatchObject({
    character: "測試熊",
    floor: 91,
    target: "合成星影",
    phase: "above_half",
    equipmentVersion: expect.any(String),
    skillsVersion: expect.any(String),
    protectionPolicy: null,
  });
  expect(first.samples[0].missingConditions).toContain("protectionPolicy");
  expect(first.samples[0].counterexample).toBeNull();
  const cursor = first.samples[0].source.observationId;
  await h.act("/skill 血怒亂斬", skillText(32, "\n未知新特殊"));
  const next = ledgerEvidence(h.runtime.read(), "測試熊", cursor);
  expect(next.samples).toHaveLength(1);
  expect(next.samples[0]).toMatchObject({
    complete: false,
    riskVerified: false,
    conditionsComplete: false,
  });
  const changed = compareCombatConditions(first.samples[0].conditions, {
    ...first.samples[0].conditions,
    floor: 92,
    equipmentVersion: "other",
    skillsVersion: "other",
    phase: "low",
    protectionPolicy: "agent-conservative-policy-v2",
  });
  expect(changed.changed).toEqual(
    expect.arrayContaining([
      "floor",
      "equipmentVersion",
      "skillsVersion",
      "phase",
      "protectionPolicy",
    ]),
  );
  expect(changed.riskVerified).toBe(false);
});

test("同投影的 status／checkpoint 無新事件時穩定且有限長，不製造新鮮度", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬");
  const before = ledgerCheckpoint(h.runtime.read());
  expect(before).toBe(ledgerCheckpoint(h.runtime.read()));
  expect(before.length).toBeLessThanOrEqual(2400);
  expect(before).toContain("HP 500");
  expect(before).toContain("MP 68");
  expect(before).toContain("剩餘耗次 unknown");
  expect(ledgerStatus(h.runtime)).toMatchObject({
    operationalEligibility: false,
    resources: { mp: { value: 68, basis: "derived" } },
  });
  await h.act("/skill 血怒亂斬", []);
  const after = ledgerCheckpoint(h.runtime.read());
  expect(after).toContain("未決：1");
  expect(after).toContain("MP unknown");
  expect(after).not.toBe(before);
});

test("匯出 preview 不寫 repo；拒絕人工修改、預覽競態與 symlink，保留 GOAL 與舊 anchor", () => {
  const h = setup();
  h.seed();
  mkdirSync(join(h.directory, "docs", "goals"), { recursive: true });
  const goal = join(h.directory, "GOAL.md"),
    old = join(h.directory, "docs", "goals", "old.md");
  writeFileSync(goal, "契約");
  writeFileSync(old, "# 歷史\n<a id='old'></a>\n");
  const text = ledgerCheckpoint(h.runtime.read());
  const preview = previewLedgerExport(h.store, h.directory, text);
  expect(existsSync(preview.path)).toBe(false);
  expect(preview.allowed).toBe(true);
  writeLedgerExport(h.store, preview, text);
  expect(readFileSync(preview.path, "utf8")).toBe(text);
  const next = previewLedgerExport(h.store, h.directory, `${text}\n新摘要`);
  writeFileSync(preview.path, `${text}\n人工修改`);
  expect(() => writeLedgerExport(h.store, next, next.after)).toThrow(/改變/u);
  expect(previewLedgerExport(h.store, h.directory, text).allowed).toBe(false);
  expect(readFileSync(goal, "utf8")).toBe("契約");
  expect(readFileSync(old, "utf8")).toContain("id='old'");
  const other = join(h.directory, "symlink-export");
  mkdirSync(other);
  symlinkSync(join(h.directory, "docs"), join(other, "docs"));
  expect(() => previewLedgerExport(h.store, other, text)).toThrow(/symlink/u);
});

test("Unicode code point 分頁能還原 JSON；frozen snapshot 不重查且切樹失效", () => {
  const data = { text: "🐻熊".repeat(10) },
    page = ledgerPage("trace", data, 0, 13);
  const tail = ledgerPage("trace", data, page.nextOffset ?? 0, 6000);
  expect(JSON.parse(page.text + tail.text)).toEqual(data);
  const pages = new LedgerPages(),
    query = vi.fn(() => data);
  const first = pages.page("report", "scope", query, { limit: 10 });
  pages.page("report", "scope", query, {
    offset: 10,
    snapshot: first.snapshot,
  });
  expect(query).toHaveBeenCalledOnce();
  expect(() =>
    pages.page("report", "other", query, {
      offset: 10,
      snapshot: first.snapshot,
    }),
  ).toThrow(/條件/u);
  const same = pages.page("report", "same-output-other-scope", query, {
    limit: 10,
  });
  expect(() =>
    pages.page("report", "same-output-other-scope", query, {
      offset: 10,
      snapshot: same.snapshot,
    }),
  ).not.toThrow();
  pages.reset();
  expect(() =>
    pages.page("report", "scope", query, {
      offset: 10,
      snapshot: first.snapshot,
    }),
  ).toThrow(/過期/u);
});

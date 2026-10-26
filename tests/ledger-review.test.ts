import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { decodeBearsResult, gameErrorResult } from "../src/bears-result.js";
import {
  ledgerOperationIds,
  ledgerWatch,
  withLedgerCall,
} from "../src/ledger-channel.js";
import { projectLedger } from "../src/ledger-projection.js";
import { ledgerReport } from "../src/ledger-report.js";
import { LedgerRuntime } from "../src/ledger-runtime.js";
import type { LedgerReference } from "../src/ledger-types.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { statusText } from "./fixtures/workflow.js";

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
test("外部分支的遊戲動作不能被稍後的 metric、usage 或舊 history 遮蔽；新 status 只重建歷史欄位", async () => {
  const h = setup();
  h.seed();
  const base = h.references();
  await h.act("/skill 血怒亂斬");
  h.branch(base);
  h.runtime.metric({
    toolCallId: "query",
    toolName: "read",
    startedAt: Date.now(),
    durationMs: 1,
    isError: false,
  });
  h.runtime.usage({ input: 1, output: 1, totalTokens: 2, cost: { total: 0 } });
  expect(h.projection().externalEvents).toBeGreaterThan(0);
  await h.game.history(30, 2);
  expect(h.projection().externalEvents).toBeGreaterThan(0);
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
  const fresh = h.add(statusText("測試熊", 500, 68));
  h.runtime.watch([fresh], 0);
  expect(h.projection()).toMatchObject({
    externalEvents: 0,
    account: { mp: { value: 68 } },
    operationalEligibility: false,
  });
  expect(h.bot.send).toHaveBeenCalledOnce();
});
test("獨立 Node 程序寫入共用 WAL；不屬本分支的事件保持外部缺口", () => {
  const h = setup();
  h.seed();
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(${JSON.stringify(h.store.path)}); db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000"); const id=${JSON.stringify(randomUUID())}; db.prepare("INSERT INTO contexts VALUES(?,?)").run(id,JSON.stringify({id,session:"other-process",runtime:"child",at:Date.now(),toolCallId:null,toolName:null})); db.prepare("INSERT INTO events(context_id,operation_id,at,kind,data) VALUES(?,NULL,?,?,?)").run(id,Date.now(),"gap",JSON.stringify({reason:"external"})); db.close();`,
    ],
    { timeout: 10000, stdio: "pipe" },
  );
  expect(h.projection().externalEvents).toBe(1);
  expect(h.projection("測試熊").account?.mp.value).toBeNull();
  expect(h.factory).not.toHaveBeenCalled();
});
test("foreign keys 與唯一 context constraint 失敗不留下半筆事件", () => {
  const h = setup();
  h.seed();
  const context = h.runtime.read().contexts[0];
  expect(() => h.store.event("missing", null, "gap", {})).toThrow(
    /FOREIGN KEY/u,
  );
  expect(() => h.store.context(context)).toThrow(/UNIQUE/u);
  const before = h.runtime.read().events.length;
  expect(() =>
    h.store.transaction(() => {
      h.store.event(context.id, null, "gap", {});
      throw new Error("回滾");
    }),
  ).toThrow();
  expect(h.runtime.read().events.length).toBe(before);
});
test("取消已派送操作帶可追查 operation ID，仍只派送一次、不把 unknown 當失敗重跑", async () => {
  const h = setup();
  h.seed();
  const controller = new AbortController();
  vi.mocked(h.bot.send).mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve();
  });
  let error: unknown;
  try {
    await h.game.act({ text: "/skill 血怒亂斬" }, controller.signal);
  } catch (caught) {
    error = caught;
  }
  expect(gameErrorResult(error)).toMatchObject({
    code: "OUTCOME_UNKNOWN",
    accounting: {
      operationId: expect.any(String),
      state: "unresolved",
      complete: false,
      mpAfter: null,
    },
  });
  await h.game.history();
  expect(h.bot.send).toHaveBeenCalledOnce();
});
test("重複安裝不取代帳本擁有者", async () => {
  const h = setup();
  h.seed();
  expect(() => h.install()).toThrow(/重複安裝/u);
  await h.act("/skill 血怒亂斬");
  expect(h.projection().account?.mpSpent).toBe(32);
});
test("金幣加減中間量不越界四捨五入；超界合計不作可用餘額", async () => {
  const h = setup();
  h.seed();
  await h.act("/craft A1", `獲得金幣：${Number.MAX_SAFE_INTEGER}G`);
  expect(h.projection().account?.gold.value).toBeNull();
  expect(h.projection().account?.credits).toBe(Number.MAX_SAFE_INTEGER);
});
test("damage component 的未知實傷不是零；未知尾文不冒稱完整有效削血", async () => {
  const h = setup();
  h.seed();
  await h.act("/skill 血怒亂斬");
  const report = ledgerReport(h.runtime.read());
  expect(report.damageComponents.damage.actual).toBeNull();
  expect(report.damageComponents.damage.knownPartialActual).toBe(0);
});
test("完整恢復週期須兩端確認；固定 replay 可驗算每週期實傷與 MP", async () => {
  const h = setup();
  h.seed();
  await h.act("/rest", "免費休息，HP／MP 已恢復。");
  await h.act(
    "/skill 合成小招",
    "戰鬥紀錄：合成星影\nMP消耗：32\n對敵傷害：100；敵HP：1000→900/1000\n狀態：戰鬥中",
  );
  await h.act("/rest", "免費休息，HP／MP 已恢復。");
  const report = ledgerReport(h.runtime.read());
  expect(report.damagePerRecoveryCycle).toBe(100);
  expect(report.recoveryCycleSamples.cycles).toMatchObject([
    { confirmedMpCost: 32, effectiveDamage: 100 },
  ]);
});

test("切樹後舊 ticket 不將觀測引用寫入新 branch，也不重新派送", () => {
  const h = setup();
  h.seed();
  const base = h.references();
  const ticket = h.runtime.begin("command", "/skill 血怒亂斬");
  ticket.observe(h.messages, "before");
  ticket.dispatch();
  h.branch(base);
  const before = h.references();
  ticket.observe([h.add("舊分支遲到訊息")], "after");
  ticket.finish(true);
  expect(h.references()).toEqual(before);
  expect(h.projection().externalEvents).toBeGreaterThan(0);
  expect(h.factory).not.toHaveBeenCalled();
  const notSent = h.runtime.begin("command", "/skill 血怒亂斬");
  h.runtime.reset();
  expect(() => notSent.dispatch()).toThrow(/未派送/u);
});

test("宣告的 accounting schema 無效時不靜默移除為完整結果", () => {
  expect(
    decodeBearsResult({
      delivery: "submitted",
      messages: [],
      accounting: { mpAfter: -1 },
    }),
  ).toMatchObject({ code: "INVALID_RESULT", complete: false });
});
test("新回覆的最大 HP 取代舊上限；不把敵 HP 當本人 HP", async () => {
  const h = setup();
  h.seed();
  await h.act(
    "/skill 血怒亂斬",
    "✨ 使用技能：血怒亂斬（MP -32）\n造成 10 點傷害！🐻 HP：9000/10000\n💚 恢復 100 HP！HP：1500/2000\n🐻 反擊！你受到 100 傷害。HP：1400/2000",
  );
  expect(h.projection().account).toMatchObject({
    hp: { value: 1400 },
    maxHp: 2000,
  });
  await h.act("/rest", "免費休息，HP／MP 已恢復。");
  expect(h.projection().account?.hp.value).toBe(2000);
});

test("同程序多 SDK session 不串帳；外來 command 拒絕派送，history/watch 不寫另一帳本", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install(() => "session-a");
  h.seed();
  const own = h.runtime.begin("history", null, {
    toolCallId: "shared-call",
    toolName: "bears_history",
    sessionId: "session-a",
  });
  own.observe(h.messages, "history");
  own.finish(false);
  const before = h.runtime.read().observations.length,
    operations = h.runtime.read().operations.length;
  await expect(
    withLedgerCall(
      { toolCallId: "foreign", toolName: "bears_send", sessionId: "session-b" },
      () => h.game.act({ text: "/skill 血怒亂斬" }),
    ),
  ).rejects.toThrow(/not dispatched/u);
  expect(h.factory).not.toHaveBeenCalled();
  await withLedgerCall(
    {
      toolCallId: "foreign-history",
      toolName: "bears_history",
      sessionId: "session-b",
    },
    () => h.game.history(),
  );
  ledgerWatch([h.add("外來工作階段回覆")], 0, "session-b");
  expect(h.runtime.read().observations).toHaveLength(before);
  expect(h.runtime.read().operations).toHaveLength(operations);
  expect(ledgerOperationIds("shared-call", "session-a")).toHaveLength(1);
  expect(ledgerOperationIds("shared-call", "session-b")).toEqual([]);
  expect(h.bot.send).not.toHaveBeenCalled();
});

test("真實 SessionManager 檔案的 resume／tree／fork 只重建 ancestry，不回溯遊戲或恢復操作", () => {
  const h = ledgerHarness();
  open.push(h);
  let sm = SessionManager.create(h.directory, join(h.directory, "pi-sessions"));
  sm.appendMessage({
    role: "user",
    content: "離線驗證",
    timestamp: Date.now(),
  });
  const references = (): LedgerReference[] =>
    sm
      .getBranch()
      .flatMap((e) =>
        e.type === "custom" && e.customType === "ledger-test"
          ? [e.data as LedgerReference]
          : [],
      );
  const runtime = new LedgerRuntime(h.store, {
    session: () => sm.getSessionId(),
    references,
    publish: (ref) => {
      sm.appendCustomEntry("ledger-test", ref);
    },
  });
  runtime.watch([h.add(statusText("測試熊", 1000, 60))], 0);
  const base = sm.getLeafId(),
    session = sm.getSessionId();
  if (!base) {
    throw new Error("缺 ancestry");
  }
  const ticket = runtime.begin("command", "/skill 血怒亂斬");
  ticket.observe(h.messages, "before");
  ticket.dispatch();
  h.add("/skill 血怒亂斬", true);
  h.add("✨ 使用技能：血怒亂斬（MP -32）\n💚 恢復 500 HP！HP：1000/1000");
  ticket.observe(h.messages, "after");
  ticket.finish(true);
  const file = sm.getSessionFile();
  if (!file) {
    throw new Error("缺 session file");
  }
  sm = SessionManager.open(file);
  runtime.reset();
  expect(projectLedger(runtime.read()).account?.mp.value).toBe(28);
  sm.branch(base);
  runtime.reset();
  expect(projectLedger(runtime.read(), "測試熊").account?.mp.value).toBeNull();
  const fork = sm.createBranchedSession(base);
  if (!fork) {
    throw new Error("缺 fork file");
  }
  expect(sm.getSessionId()).not.toBe(session);
  sm = SessionManager.open(fork);
  runtime.reset();
  expect(projectLedger(runtime.read())).toMatchObject({
    operationalEligibility: false,
    externalEvents: expect.any(Number),
  });
  expect(h.factory).not.toHaveBeenCalled();
});

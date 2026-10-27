import { afterEach, expect, test, vi } from "vitest";
import { projectLedger } from "../src/ledger-projection.js";
import {
  commitRetention,
  prepareRetention,
  retentionReferences,
} from "../src/ledger-retention.js";
import { ledgerHarness } from "./fixtures/ledger.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of open.splice(0)) {
    h.close();
  }
});
async function setup() {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  h.seed();
  for (let n = 0; n < 12; n++) {
    await h.act("/skill 血怒亂斬");
    h.runtime.metric({
      toolCallId: String(n),
      toolName: "test",
      startedAt: Date.now(),
      durationMs: 1,
      isError: false,
    });
  }
  return h;
}
test("壓縮約半量舊事件，精確資源／成本／未決一致；原文移除，trace明示，重跑冪等", async () => {
  const h = await setup(),
    before = h.projection(),
    count = Number(
      h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n,
    );
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("plan missing");
  }
  const checkpoint = commitRetention(h.store, plan, "records:test/summary@1");
  expect(checkpoint.deletedEvents).toBeGreaterThan(count * 0.3);
  expect(
    Number(h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n),
  ).toBe(count - checkpoint.deletedEvents);
  expect(h.projection()).toEqual(before);
  expect(commitRetention(h.store, plan, "records:test/summary@1").id).toBe(
    plan.id,
  );
  const compacted = h.store.db
    .prepare("SELECT observation_id FROM ledger_compacted_observations LIMIT 1")
    .get();
  expect(compacted).toBeDefined();
  expect(
    h.store.trace(Number(compacted?.observation_id))?.compacted,
  ).not.toBeNull();
  expect(h.store.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("兩萬筆telemetry壓縮接近一半，未刪事件ID不重編", () => {
  const h = ledgerHarness();
  open.push(h);
  h.seed();
  h.store.db.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000)
    INSERT INTO contexts SELECT 'metric-'||n,json_object('id','metric-'||n,'session','synthetic','runtime','synthetic','toolCallId',NULL,'toolName',NULL,'at',0) FROM seq;
    INSERT INTO events(context_id,operation_id,at,kind,data) SELECT id,NULL,0,'metric','{}' FROM contexts WHERE id LIKE 'metric-%';`);
  const before = h.projection(),
    count = Number(
      h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n,
    );
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  const tail = Number(
    h.store.db.prepare("SELECT MAX(id) n FROM events").get()?.n,
  );
  commitRetention(h.store, plan, "records:test/summary@1");
  expect(plan.eventIds.length / count).toBeGreaterThan(0.49);
  expect(plan.eventIds.length / count).toBeLessThan(0.51);
  expect(
    Number(h.store.db.prepare("SELECT MAX(id) n FROM events").get()?.n),
  ).toBe(tail);
  expect(h.projection()).toEqual(before);
}, 30000);

test("維修候選在讀取原始列前就套用既有限額，超限不做無界查詢或刪除", () => {
  const h = ledgerHarness();
  open.push(h);
  h.seed();
  h.store.db.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<201000)
    INSERT INTO events(context_id,operation_id,at,kind,data)
    SELECT (SELECT id FROM contexts LIMIT 1),NULL,0,'metric','{}' FROM seq;`);
  const count = h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n;
  const prepare = h.store.db.prepare.bind(h.store.db);
  vi.spyOn(h.store.db, "prepare").mockImplementation((sql) => {
    if (sql === "SELECT * FROM events ORDER BY id") {
      throw new Error("不可先執行無界查詢");
    }
    return prepare(sql);
  });
  expect(() => prepareRetention(h.store)).toThrow(/有界維修讀取上限/u);
  expect(h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n).toBe(
    count,
  );
}, 30000);

test("壓縮checkpoint未知格式與缺parser事實不回填零或從標記重建", async () => {
  const h = await setup(),
    plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  const checkpoint = commitRetention(h.store, plan, "records:test/summary@1");
  const compacted = h.store.db
    .prepare("SELECT observation_id FROM ledger_compacted_observations LIMIT 1")
    .get();
  h.store.db
    .prepare("DELETE FROM facts WHERE observation_id=?")
    .run(compacted?.observation_id ?? 0);
  h.store.reparse();
  expect(() => h.runtime.read()).toThrow(/parser/u);
  h.store.db
    .prepare("UPDATE ledger_compactions SET data=? WHERE id=?")
    .run(JSON.stringify({ ...checkpoint, version: 999 }), checkpoint.id);
  expect(() => h.runtime.read()).toThrow(/checkpoint/u);
});

test("未知格式與尚未完整解析的重要全文不為半量目標刪除", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  h.seed();
  const unknown = h.add("重要未知格式：仍待核實的裝備效果");
  h.runtime.watch([unknown], 0);
  for (let n = 0; n < 12; n++) {
    await h.act("/skill 血怒亂斬");
  }
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  commitRetention(h.store, plan, "records:test/summary@1");
  expect(h.store.trace(2)?.message.text).toBe(unknown.text);
  expect(h.store.trace(2)?.compacted).toBeNull();
  expect(h.store.trace(1)?.message.text).toBe(h.messages[0].text);
});

test("準備後來源變更與取消不刪；未決context受保護", async () => {
  const h = await setup();
  const pending = h.runtime.begin("command", "/attack 測試");
  pending.dispatch();
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("plan missing");
  }
  const contexts = h.store.db
    .prepare(
      "SELECT context_id FROM operations WHERE json_extract(data,'$.command')='/attack 測試'",
    )
    .all();
  expect(
    contexts.every((c) => !plan.contexts.includes(String(c.context_id))),
  ).toBe(true);
  const count = h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n;
  expect(() =>
    commitRetention(
      h.store,
      plan,
      "records:test/summary@1",
      AbortSignal.abort(),
    ),
  ).toThrow();
  expect(h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n).toBe(
    count,
  );
  h.runtime.metric({
    toolCallId: "new",
    toolName: "test",
    startedAt: Date.now(),
    durationMs: 1,
    isError: false,
  });
  expect(() =>
    commitRetention(h.store, plan, "records:test/summary@1"),
  ).toThrow(/變更/u);
  expect(
    h.store.db.prepare("SELECT COUNT(*) n FROM ledger_compactions").get()?.n,
  ).toBe(0);
});
test("舊分支之外的事件仍建立barrier，不因壓縮回填舊角色資源", async () => {
  const h = await setup();
  const refs = h.references().slice(0, 2);
  const before = projectLedger(h.store.read(refs));
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  commitRetention(h.store, plan, "records:test/summary@1");
  expect(projectLedger(h.store.read(refs))).toEqual(before);
});

test("首達、怪金與正式通層在壓縮前後不變", async () => {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  h.seed();
  await h.act(
    "/attack 測試",
    "通層回執：第10層\n怪金：100G\n首達：1000G\n合計：1100G",
  );
  for (let n = 0; n < 12; n++) {
    await h.act("/skill 血怒亂斬");
  }
  const before = h.projection();
  expect(before.account?.clears.map((c) => c.floor)).toEqual([10]);
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  commitRetention(h.store, plan, "records:test/summary@1");
  expect(h.projection()).toEqual(before);
});

test("舊分支只讀自己的checkpoint，不把壓縮當新觀測；新revision仍衝突", async () => {
  const h = await setup(),
    refs = h.references(),
    baseline = projectLedger(h.runtime.read());
  const plan = prepareRetention(h.store, 1);
  if (!plan) {
    throw new Error("missing");
  }
  commitRetention(h.store, plan, "records:test/summary@1");
  expect(projectLedger(h.store.read(refs))).toEqual(baseline);
  const all = h.store.read(retentionReferences(h.store.db));
  expect(all.compactions).toHaveLength(1);
  expect(all.compactions?.[0].summaryReference).toBe("records:test/summary@1");
  expect(projectLedger(h.store.read([])).account).toBeNull();
  h.runtime.watch([h.messages[0]], 0);
  expect(
    h.store.db
      .prepare("SELECT COUNT(*) n FROM observations WHERE message_id=1")
      .get()?.n,
  ).toBe(1);
  h.runtime.watch(
    [
      {
        ...h.messages[0],
        revision: "different-revision",
        text: "未知格式修訂",
      },
    ],
    0,
  );
  expect(h.projection().conflicts).toContain(1);
  expect(
    h.store.db
      .prepare("SELECT COUNT(*) n FROM observations WHERE message_id=1")
      .get()?.n,
  ).toBe(2);
});

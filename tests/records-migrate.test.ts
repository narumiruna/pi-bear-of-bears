import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  applyRecordsImport,
  previewRecordsImport,
  readRecordsSources,
  resolveRecordLink,
  verifyRecordsImport,
} from "../src/records-migrate.js";
import { RecordsStore } from "../src/records-store.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) {
    c();
  }
});
function setup() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "records-migrate-")),
    store = new RecordsStore(join(root, "records.sqlite"));
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return store;
}
const source = {
  path: "docs/notes/legacy.md",
  text: '# 歷史\r\n前言未知時間\r\n<a id="record-1"></a>\r\n## 2026-10-27 21:08 +0800：測試\r\n本文🐻\r\n```md\r\n## 不可分割\r\n<a id="fake"></a>\r\n```\r\n### 子標題\r\n其餘\r\n<a id="record-1"></a>\r\n## 無日期\r\n最後沒有換行',
};
test("CRLF、fence、巢狀標題、重複alias及前言完整保留，不猜未明日期", () => {
  const store = setup(),
    plan = previewRecordsImport([source]);
  expect(plan.files[0].parts.map((p) => p.record.body).join("")).toBe(
    source.text,
  );
  expect(
    plan.files[0].parts.some((p) => p.aliases.some((a) => a.includes("fake"))),
  ).toBe(false);
  expect(plan.files[0].parts.at(-1)?.record.eventDate).toBeNull();
  const dated = plan.files[0].parts.find((p) => p.record.eventDate !== null);
  expect(dated?.record).toMatchObject({
    eventDate: "2026-10-27",
    eventTime: "21:08",
    timezone: "+0800",
  });
  expect(applyRecordsImport(store, plan, [source]).verified).toBe(true);
  expect(store.resolve("docs/notes/legacy.md#record-1").items).toHaveLength(2);
  expect(applyRecordsImport(store, plan, [source]).records).toBe(
    store.status().records,
  );
  expect(verifyRecordsImport(store, plan).bytes).toBe(
    Buffer.byteLength(source.text),
  );
  expect(
    resolveRecordLink("docs/goals/current.md", "../notes/legacy.md#record-1"),
  ).toEqual({ alias: "docs/notes/legacy.md#record-1" });
});
test("來源變動、取消及未支援fence不留下半筆；相同路徑新版不盲匯", () => {
  const store = setup(),
    plan = previewRecordsImport([source]);
  expect(() =>
    applyRecordsImport(store, plan, [
      { ...source, text: `${source.text}不同` },
    ]),
  ).toThrow(/變更/u);
  expect(() =>
    applyRecordsImport(store, plan, [source], AbortSignal.abort()),
  ).toThrow();
  expect(store.status().records).toBe(0);
  expect(() =>
    previewRecordsImport([{ ...source, text: "```\n未閉" }]),
  ).toThrow(/未閉合/u);
  applyRecordsImport(store, plan, [source]);
  const changed = [{ ...source, text: `${source.text}新` }];
  expect(() =>
    applyRecordsImport(store, previewRecordsImport(changed), changed),
  ).toThrow(/其他匯入/u);
});
test("目前八個來源全量暫存匯入可由初始版本逐byte還原，不改原檔", () => {
  const store = setup(),
    sources = readRecordsSources(process.cwd()),
    plan = previewRecordsImport(sources);
  expect(sources).toHaveLength(8);
  const result = applyRecordsImport(store, plan, sources);
  expect(result.bytes).toBe(
    sources.reduce((n, s) => n + Buffer.byteLength(s.text), 0),
  );
  expect(result.verified).toBe(true);
  expect(previewRecordsImport(readRecordsSources(process.cwd())).id).toBe(
    plan.id,
  );
  expect(store.search({ query: "星塔" }).items.length).toBeGreaterThan(0);
  expect(store.search({ query: "狂戰熊" }).items.length).toBeGreaterThan(0);
}, 60000);

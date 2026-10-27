import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  readCutoverDocuments,
  recordsCutoverCommand,
} from "../src/records-cutover-cli.js";
import {
  applyRecordsImport,
  previewRecordsImport,
  RECORDS_INPUTS,
  readRecordsSources,
} from "../src/records-migrate.js";
import { RecordsStore } from "../src/records-store.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of cleanup.splice(0).reverse()) {
    c();
  }
});
function setup() {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "records-cutover-cli-test-"),
  );
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  for (const path of RECORDS_INPUTS) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      '# 前言\n<a id="same"></a>\n## 2026-10-27 21:00 +0800：測試\n完整內容\n',
    );
  }
  writeFileSync(
    join(root, "README.md"),
    "[查閱](docs/notes/2026-10.md#same)\n",
  );
  const sources = readRecordsSources(root),
    plan = previewRecordsImport(sources);
  return {
    root,
    plan,
    sources,
    database: join(root, "runtime/records.sqlite"),
  };
}
test("rehearse只用暫存庫，不修改來源或建立正式庫，其他計畫與隱藏目錄不讀", () => {
  const h = setup();
  mkdirSync(join(h.root, "docs/plans"));
  writeFileSync(join(h.root, "docs/plans/unrelated.md"), "不讀此計畫");
  chmodSync(join(h.root, "docs/plans/unrelated.md"), 0);
  mkdirSync(join(h.root, ".private"));
  writeFileSync(join(h.root, ".private/session.md"), "不得讀取");
  const result = recordsCutoverCommand(["rehearse"], h.root);
  expect(result.referenceScope).toBe("temporary_database_deleted_on_exit");
  expect(result.referencesConverted).toBe(1);
  expect(result.documents.map((d) => d.path)).toEqual(["README.md"]);
  expect(existsSync(h.database)).toBe(false);
  expect(existsSync(join(h.root, ".pi"))).toBe(false);
  expect(readRecordsSources(h.root)).toEqual(h.sources);
  expect(readFileSync(join(h.root, "README.md"), "utf8")).toBe(
    "[查閱](docs/notes/2026-10.md#same)\n",
  );
});
test("preview從readOnly原庫取得含WAL快照，缺衍生索引只在副本重建", () => {
  const h = setup(),
    store = new RecordsStore(h.database);
  cleanup.push(() => store.close());
  applyRecordsImport(store, h.plan, h.sources);
  const extra = store.append("in-wal", {
    kind: "log",
    title: "WAL內資料",
    body: "不可遺失",
  });
  store.db.exec("DROP TABLE records_fts; DROP TABLE records_current;");
  const before = store.status();
  const dataVersion = store.db
    .prepare("PRAGMA data_version")
    .get()?.data_version;
  const result = recordsCutoverCommand(
    ["preview", h.database, h.plan.id],
    h.root,
  );
  expect(result.referenceScope).toBe("supplied_database");
  expect(result.databaseId).toBe(store.databaseId);
  expect(result.epoch).toBe(
    Number(store.db.prepare("SELECT epoch FROM records_meta").get()?.epoch),
  );
  expect(store.status()).toEqual(before);
  expect(store.db.prepare("PRAGMA data_version").get()?.data_version).toBe(
    dataVersion,
  );
  expect(
    store.db
      .prepare("SELECT name FROM sqlite_master WHERE name='records_current'")
      .get(),
  ).toBeUndefined();
  expect(store.read(extra.id).body).toBe("不可遺失");
  for (const proposed of result.documents) {
    for (const e of proposed.references) {
      expect(store.resolve(e.reference ?? "").items).toHaveLength(1);
    }
  }
});
test("錯誤manifest、不存在的庫或apply模式停止，不建空庫或移除來源", () => {
  const h = setup();
  expect(() =>
    recordsCutoverCommand(["preview", h.database, "wrong"], h.root),
  ).toThrow(/不符/u);
  expect(() =>
    recordsCutoverCommand(["preview", h.database, h.plan.id], h.root),
  ).toThrow();
  expect(() =>
    recordsCutoverCommand(["apply", h.database, h.plan.id], h.root),
  ).toThrow(/不提供apply/u);
  expect(existsSync(h.database)).toBe(false);
  expect(readRecordsSources(h.root)).toEqual(h.sources);
});
test("預覽中並行改寫文件會停止，保留別人的內容而不套用舊差異", () => {
  const h = setup();
  const status = RecordsStore.prototype.status;
  vi.spyOn(RecordsStore.prototype, "status").mockImplementation(function (
    this: RecordsStore,
  ) {
    writeFileSync(join(h.root, "README.md"), "並行更新必須保留");
    return status.call(this);
  });
  expect(() => recordsCutoverCommand(["rehearse"], h.root)).toThrow(
    /期間文件或來源變動/u,
  );
  expect(readFileSync(join(h.root, "README.md"), "utf8")).toBe(
    "並行更新必須保留",
  );
  expect(existsSync(h.database)).toBe(false);
});

test("預覽不跟隨文件symlink，新分卷未納盤點時停止而不漏匯", () => {
  const h = setup();
  symlinkSync(join(h.root, "README.md"), join(h.root, "linked.md"));
  expect(() => readCutoverDocuments(h.root)).toThrow(/單一連結/u);
  rmSync(join(h.root, "linked.md"));
  writeFileSync(join(h.root, "docs/notes/2026-11.md"), "新資料不得遺漏");
  expect(() => recordsCutoverCommand(["rehearse"], h.root)).toThrow(
    /新紀錄來源/u,
  );
  expect(existsSync(h.database)).toBe(false);
});

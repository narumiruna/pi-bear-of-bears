import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRecordsImport,
  previewRecordsImport,
  readRecordsSources,
  verifyStoredRecordsImport,
} from "../dist/src/records-migrate.js";
import { auditRecordReferences } from "../dist/src/records-reference-audit.js";
import { RecordsStore, recordsHash } from "../dist/src/records-store.js";

const root = mkdtempSync(join(realpathSync(tmpdir()), "records-benchmark-"));
let store;
const ms = (fn) => {
  const at = performance.now();
  const value = fn();
  return { ms: performance.now() - at, value };
};
const distribution = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    medianMs: v[Math.floor(v.length / 2)],
    p95Ms: v[Math.ceil(v.length * 0.95) - 1],
  };
};
try {
  const opened = ms(() => new RecordsStore(join(root, "records.sqlite")));
  store = opened.value;
  const sources = readRecordsSources(process.cwd()),
    plan = previewRecordsImport(sources);
  const imported = ms(() => applyRecordsImport(store, plan, sources));
  const cases = [
    "星塔",
    "狂戰熊",
    "なるみ_狂戰熊",
    "834216",
    "2026-10-27",
    "/skill",
    "MP -32",
    "王之精魄",
    "🎒",
    "<a id=",
  ];
  const results = [];
  for (const query of cases) {
    const sql = [],
      baseline = [],
      bytes = [],
      rgBytes = [];
    const expected = sources.some((s) =>
      s.text.toLowerCase().includes(query.toLowerCase()),
    );
    for (let i = 0; i < 30; i++) {
      const a = ms(() => store.search({ query }));
      sql.push(a.ms);
      bytes.push(Buffer.byteLength(JSON.stringify(a.value)));
      if (a.value.items.length > 0 !== expected) {
        throw new Error(`搜尋命中不符：${query}`);
      }
      const b = ms(() => {
        try {
          return execFileSync(
            "rg",
            ["-F", "-i", "--", query, ...sources.map((s) => s.path)],
            { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
          );
        } catch (error) {
          if (error.status === 1) {
            return "";
          }
          throw error;
        }
      });
      baseline.push(b.ms);
      rgBytes.push(Buffer.byteLength(b.value));
      if (bytes.at(-1) > 8192) {
        throw new Error("搜尋輸出超過8KiB");
      }
    }
    results.push({
      query,
      runs: 30,
      sqlite: distribution(sql),
      rg: distribution(baseline),
      sqliteBytes: Math.max(...bytes),
      rgBytes: Math.max(...rgBytes),
    });
  }
  const docPaths = execFileSync(
    "rg",
    [
      "--files",
      "--glob",
      "*.md",
      "--glob",
      "!docs/plans/**",
      "--glob",
      "!docs/notes/**",
      "--glob",
      "!docs/logs/**",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((p) => !sources.some((s) => s.path === p));
  const audit = auditRecordReferences(
    docPaths.map((path) => ({ path, text: readFileSync(path, "utf8") })),
    store,
  );
  // 量測結束後才加入合成WAL資料，不混進來源查詢基準或歷史紀錄筆數。
  store.db.exec("PRAGMA wal_autocheckpoint=0");
  const synthetic = store.append("offline-backup-proof-1", {
    kind: "log",
    title: "合成備份驗證",
    body: "WAL版本一；不是遊戲紀錄",
  });
  store.revise("offline-backup-proof-2", synthetic.id, 1, {
    kind: "log",
    title: "合成備份驗證",
    body: "WAL版本二；不是遊戲紀錄",
  });
  const walBytesBeforeBackup = statSync(`${store.path}-wal`).size;
  if (walBytesBeforeBackup === 0) {
    throw new Error("WAL備份fixture未產生可驗證的WAL");
  }
  const backup = store.backup(join(root, "backup"));
  const restoredPath = join(root, "restore/records.sqlite");
  mkdirSync(join(root, "restore"), { mode: 0o700 });
  copyFileSync(backup, restoredPath, constants.COPYFILE_EXCL);
  const restored = new RecordsStore(restoredPath, { create: false });
  let backupRestore;
  try {
    const verified = verifyStoredRecordsImport(restored, plan.id);
    const aliases = (s) =>
      s.db
        .prepare("SELECT alias,record_id FROM aliases ORDER BY alias,record_id")
        .all();
    const originalAliases = aliases(store),
      restoredAliases = aliases(restored);
    if (
      JSON.stringify(restored.status()) !== JSON.stringify(store.status()) ||
      recordsHash(JSON.stringify(originalAliases)) !==
        recordsHash(JSON.stringify(restoredAliases)) ||
      restored.read(synthetic.id, 1).body !== "WAL版本一；不是遊戲紀錄" ||
      restored.read(synthetic.id, 2).body !== "WAL版本二；不是遊戲紀錄" ||
      restored.db.prepare("PRAGMA integrity_check").get()?.integrity_check !==
        "ok" ||
      restored.db.prepare("PRAGMA foreign_key_check").all().length > 0
    ) {
      throw new Error("全量備份還原的身分、別名、版本或完整性不符");
    }
    backupRestore = {
      ...verified,
      databaseIdentityPreserved: true,
      aliasesVerified: restoredAliases.length,
      syntheticWalRevisionsVerified: 2,
      walBytesBeforeBackup,
      totalRestoredRecords: restored.status().records,
      integrityCheck: "ok",
      foreignKeyViolations: 0,
    };
  } finally {
    restored.close();
  }
  if (previewRecordsImport(readRecordsSources(process.cwd())).id !== plan.id) {
    throw new Error("演練期間來源變動；不把舊快照當成目前盤點");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        node: process.version,
        sqlite: store.db.prepare("SELECT sqlite_version() version").get()
          .version,
        fts5Trigram: store.trigram,
        sourceBytes: imported.value.bytes,
        sourceManifest: plan.id,
        sourceFiles: plan.files.map(({ parts, ...f }) => ({
          ...f,
          parts: parts.length,
        })),
        records: imported.value.records,
        openMs: opened.ms,
        importMs: imported.ms,
        results,
        backupRestore,
        referenceAudit: {
          documents: audit.documents,
          counts: audit.counts,
          findings: audit.findings.map(
            ({ reference: _reference, ...finding }) => finding,
          ),
        },
        note: "rg量測包含process啟動；僅有界查詢輸出與命中驗證，不推通用速度優勢。來源未改，暫存庫於結束刪除。量測後另加一筆合成log與一版修訂驗證WAL備份還原，不算原始紀錄。稽核reference不保存暫存庫UUID；正式切換前須重做並處理missing／multiple／needs_review。",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  store?.close();
  rmSync(root, { recursive: true, force: true });
}

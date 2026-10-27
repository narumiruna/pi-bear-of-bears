import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { privateLedgerDirectory } from "./ledger-files.js";
import { privateRecordsFile } from "./records-data.js";
import {
  applyRecordsImport,
  previewRecordsImport,
  readRecordsSources,
  verifyStoredRecordsImport,
} from "./records-migrate.js";
import { RecordsStore } from "./records-store.js";

function snapshotFile(path: string, text: string) {
  privateLedgerDirectory(dirname(path));
  if (existsSync(path)) {
    privateRecordsFile(path);
    if (readFileSync(path, "utf8") !== text) {
      throw new Error("既有復原快照內容不符；未覆寫。");
    }
  } else {
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
}
/** 離線CLI，不由extension自動執行；從不刪Markdown或自行切換正式寫入規則。 */
export function recordsMigrationCommand(args: string[], cwd = process.cwd()) {
  const [mode, database, expectedHash, backupDirectory] = args;
  if (mode === "verify") {
    if (
      !database ||
      !isAbsolute(database) ||
      !existsSync(database) ||
      !expectedHash
    ) {
      throw new Error("verify需要既有DB絕對路徑及匯入manifest；不建立空庫。");
    }
    const store = new RecordsStore(database, { create: false });
    try {
      return {
        ...verifyStoredRecordsImport(store, expectedHash),
        databaseId: store.databaseId,
      };
    } finally {
      store.close();
    }
  }
  const sources = readRecordsSources(cwd),
    plan = previewRecordsImport(sources);
  if (mode === "preview") {
    return {
      version: 1,
      mode,
      manifest: plan.id,
      files: plan.files.map(({ parts, ...file }) => ({
        ...file,
        parts: parts.length,
        aliases: parts.reduce((n, p) => n + p.aliases.length, 0),
      })),
      note: "只盤點，未開庫、備份、匯入、刪檔或切換規則。",
    };
  }
  if (
    mode !== "apply" ||
    !database ||
    !isAbsolute(database) ||
    expectedHash !== plan.id ||
    !backupDirectory ||
    !isAbsolute(backupDirectory) ||
    resolve(backupDirectory) === dirname(database)
  ) {
    throw new Error(
      "apply需要DB絕對路徑、相同preview manifest與獨立的第二份備份絕對目錄。",
    );
  }
  const snapshot = join(backupDirectory, `migration-${plan.id}`);
  privateLedgerDirectory(snapshot);
  for (const source of sources) {
    snapshotFile(join(snapshot, source.path), source.text);
  }
  snapshotFile(
    join(snapshot, "manifest.json"),
    JSON.stringify(
      {
        version: plan.version,
        id: plan.id,
        files: plan.files.map(({ parts, ...file }) => ({
          ...file,
          parts: parts.length,
        })),
      },
      null,
      2,
    ),
  );
  const store = new RecordsStore(database);
  try {
    if (
      store.status().records > 0 &&
      !store.db.prepare("SELECT 1 FROM imports WHERE id=?").get(plan.id)
    ) {
      throw new Error("目標庫已有其他資料；拒絕把本次遷移併入錯誤目標。");
    }
    const result = store.transaction(() => {
      const imported = applyRecordsImport(store, plan, readRecordsSources(cwd));
      if (previewRecordsImport(readRecordsSources(cwd)).id !== plan.id) {
        throw new Error(
          "匯入期間來源改變；已回滾，不切換或刪來源，請保留快照查證。",
        );
      }
      return imported;
    });
    return {
      ...result,
      databaseId: store.databaseId,
      snapshot,
      backup: store.backup(backupDirectory),
      note: "來源仍保留；正式切換與刪檔另須D6放行。",
    };
  } finally {
    store.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(recordsMigrationCommand(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "紀錄遷移失敗；未刪來源。"}\n`,
    );
    process.exitCode = 1;
  }
}

import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { privateLedgerDirectory } from "./ledger-files.js";
import { previewRecordsCutover } from "./records-cutover.js";
import { privateRecordsFile, recordsHash } from "./records-data.js";
import {
  applyRecordsImport,
  previewRecordsImport,
  RECORDS_INPUTS,
  readRecordsSources,
} from "./records-migrate.js";
import type { RecordDocument } from "./records-reference-audit.js";
import { RecordsStore } from "./records-store.js";

/** 固定文件範圍，不讀隱藏資料、node_modules、遷移來源或其他計畫。 */
export function readCutoverDocuments(cwd: string) {
  const documents: RecordDocument[] = [];
  let bytes = 0;
  const visit = (directory: string, root = false) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const path = join(directory, entry.name);
      const name = relative(cwd, path).split("\\").join("/");
      if (name === "docs/notes" || name === "docs/logs") {
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error("遷移來源目錄不可為連結。");
        }
        if (
          readdirSync(path).some(
            (file) =>
              file.endsWith(".md") &&
              !RECORDS_INPUTS.includes(`${name}/${file}`),
          )
        ) {
          throw new Error(
            "發現未納入八份盤點的新紀錄來源；先更新遷移範圍，不漏匯或刪除。",
          );
        }
        continue;
      }
      if (name === "docs/plans" || RECORDS_INPUTS.includes(name)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!root || ["docs", "skills", "wiki"].includes(entry.name)) {
          visit(path);
        }
      } else if (entry.name.endsWith(".md")) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
          throw new Error("切換文件不是單一連結的一般檔案；未讀內容。");
        }
        bytes += stat.size;
        if (
          documents.length >= 512 ||
          bytes > 16 * 1024 * 1024 ||
          stat.size > 2 * 1024 * 1024
        ) {
          throw new Error("切換文件超出有界預覽大小；未改檔。");
        }
        documents.push({ path: name, text: readFileSync(path, "utf8") });
      }
    }
  };
  visit(cwd, true);
  return documents.sort((a, b) => a.path.localeCompare(b.path));
}
function existingSnapshot(database: string, target: string) {
  const before = lstatSync(database, { bigint: true });
  privateLedgerDirectory(dirname(database));
  for (const suffix of ["", "-wal", "-shm"]) {
    privateRecordsFile(database + suffix);
  }
  privateRecordsFile(target, true);
  const source = new DatabaseSync(database, { readOnly: true });
  try {
    source.prepare("VACUUM INTO ?").run(target);
    const after = lstatSync(database, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error("預覽期間資料庫檔案已替換；不使用舊連線快照。");
    }
  } finally {
    source.close();
  }
}
/** 只產生候選JSON；無apply模式、不刪來源、不改有效規則、不reload。 */
export function recordsCutoverCommand(args: string[], cwd = process.cwd()) {
  const [mode, database, expected] = args;
  if (
    (mode !== "rehearse" && mode !== "preview") ||
    (mode === "preview" && (!database || !isAbsolute(database) || !expected)) ||
    (mode === "rehearse" && args.length !== 1) ||
    (mode === "preview" && args.length !== 3)
  ) {
    throw new Error(
      "用法：rehearse（私有暫存演練）或 preview DB絕對路徑 匯入manifest；不提供apply。",
    );
  }
  const documents = readCutoverDocuments(cwd);
  const plan = previewRecordsImport(readRecordsSources(cwd));
  if (mode === "preview" && plan.id !== expected) {
    throw new Error(
      "Markdown來源已不符匯入manifest；請重新盤點，不預覽錯誤對應。",
    );
  }
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), "records-cutover-"),
  );
  let store: RecordsStore | undefined;
  try {
    const path = join(directory, "records.sqlite");
    if (mode === "preview") {
      existingSnapshot(database, path);
      store = new RecordsStore(path, { create: false });
    } else {
      store = new RecordsStore(path);
      applyRecordsImport(store, plan, readRecordsSources(cwd));
    }
    const preview = previewRecordsCutover(store, plan.id, documents);
    const refreshed = readCutoverDocuments(cwd);
    if (
      previewRecordsImport(readRecordsSources(cwd)).id !== plan.id ||
      recordsHash(JSON.stringify(refreshed)) !==
        recordsHash(JSON.stringify(documents))
    ) {
      throw new Error("預覽期間文件或來源變動；未改檔，請保留並重新盤點。");
    }
    return {
      ...preview,
      mode,
      referenceScope:
        mode === "rehearse"
          ? "temporary_database_deleted_on_exit"
          : "supplied_database",
      note: `${preview.note} ${mode === "preview" ? "原庫只以readOnly連線製作含WAL快照，後續索引工作只在暫存副本。" : "僅在私有暫存庫匯入，沒有原庫讀寫。"} 本次暫存庫於結束清除。`,
    };
  } finally {
    try {
      store?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(
      `${JSON.stringify(recordsCutoverCommand(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "切換預覽失敗；未改檔。"}\n`,
    );
    process.exitCode = 1;
  }
}

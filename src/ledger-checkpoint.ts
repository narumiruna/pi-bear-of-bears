import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fingerprint } from "./ledger-facts.js";
import { projectLedger } from "./ledger-projection.js";
import type { LedgerStore } from "./ledger-store.js";
import type { LedgerData } from "./ledger-types.js";

export function ledgerCheckpoint(data: LedgerData, character?: string) {
  const p = projectLedger(data, character),
    a = p.account;
  const show = (field: "hp" | "mp" | "gold") =>
    a?.[field].value === null || a?.[field].value === undefined
      ? "unknown"
      : `${a[field].value}（${a[field].basis}；trace ${a[field].source?.observationId ?? "unknown"}）`;
  return [
    "# Bear of Bears 最新帳本檢查點",
    "",
    "本頁為歷史記帳預覽，不是即時狀態或遊戲指令。",
    `- 角色：${p.character ?? "unknown"}；挑戰：本機區間，server ID unknown。`,
    `- 資源：HP ${show("hp")}；MP ${show("mp")}；金幣 ${show("gold")} G。`,
    `- 收支：確認收入 ${a?.credits ?? "unknown"} G／支出 ${a?.debits ?? "unknown"} G；MP 成本 ${a?.mpSpent ?? "unknown"}。`,
    `- 未決：${p.pending.length}；修訂衝突：${p.conflicts.length}；外部分支新事件：${p.externalEvents}；差額：${a?.reconciliations.length ?? 0}；缺口：${p.gaps.length}。`,
    "- 防護：剩餘耗次 unknown；跨層、收刀、休息、長停或切角均不得沿用舊盾。",
    "- 前置核驗：依最新使用者授權，先用新 history 核對角色、資源、目標與未決操作；結果不明不重送。",
    `- 來源：parser v${p.parserVersion}；最後 status trace ${a?.lastStatus?.source.observationId ?? "unknown"}；以 bears_ledger_trace／report 查明細。`,
    ...p.gaps.slice(-3).map((g) => `- 缺口：${g.reason}`),
    ...p.diagnostics.slice(-2).map((d) => `- 診斷：${d}`),
    "",
  ]
    .join("\n")
    .slice(0, 2400);
}
export interface LedgerExportPreview {
  path: string;
  before: string | null;
  after: string;
  allowed: boolean;
  key: string;
  diff: string;
}
function exportPath(cwd: string) {
  const root = realpathSync(cwd),
    path = join(root, "docs", "goals", "bears-ledger-checkpoint.md");
  // 只能寫入固定產物，不提供任意路徑或 GOAL.md 寫入介面。
  for (const part of [root, join(root, "docs"), dirname(path)]) {
    if (
      lstatSync(part).isSymbolicLink() ||
      realpathSync(part) !== resolve(part)
    ) {
      throw new Error("匯出目錄不可含 symlink。");
    }
  }
  return path;
}
function current(path: string) {
  if (!existsSync(path)) {
    // dangling symlink 不能視為不存在。
    try {
      lstatSync(path);
      throw new Error("匯出檔不可為 symlink。");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e;
      }
    }
    return null;
  }
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 32_768
  ) {
    throw new Error("匯出檔不是可替換的一般檔案。");
  }
  return readFileSync(path, "utf8");
}
export function previewLedgerExport(
  store: LedgerStore,
  cwd: string,
  after: string,
): LedgerExportPreview {
  const path = exportPath(cwd),
    before = current(path),
    key = `checkpoint_export:${fingerprint(path)}`;
  const previous = store.cached<{ hash: string }>(key);
  const allowed = before === null || previous?.hash === fingerprint(before);
  return {
    path,
    before,
    after,
    key,
    allowed,
    diff: `--- ${path}\n+++ ledger preview\n${before === null ? "(新檔)" : before === after ? "(無變更)" : `- ${before.split("\n").join("\n- ")}`}\n+ ${after.split("\n").join("\n+ ")}\n${allowed ? "" : "拒絕覆寫：既有內容不是本帳本上次匯出的完整產物。"}`,
  };
}
export function writeLedgerExport(
  store: LedgerStore,
  preview: LedgerExportPreview,
  latest: string,
) {
  if (
    !preview.allowed ||
    latest !== preview.after ||
    current(preview.path) !== preview.before
  ) {
    throw new Error("預覽後來源或文件已改變；未覆寫，請重新預覽。");
  }
  const temporary = join(dirname(preview.path), `.${randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, latest);
    closeSync(fd);
    // 單程序預覽檢查；檔案不是操作資格，失敗不影響任何遊戲狀態。
    if (current(preview.path) !== preview.before) {
      throw new Error("匯出檔已改變，拒絕覆寫。");
    }
    if (preview.before === null) {
      linkSync(temporary, preview.path);
    } else {
      renameSync(temporary, preview.path);
    }
    store.cache(preview.key, { hash: fingerprint(latest) });
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* 已關閉。 */
    }
    try {
      unlinkSync(temporary);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // 暫存檔清理失敗不覆蓋原始匯出結果；檔案保持私有。
      }
    }
  }
}

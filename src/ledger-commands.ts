import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type LedgerExportPreview,
  ledgerCheckpoint,
  previewLedgerExport,
  writeLedgerExport,
} from "./ledger-checkpoint.js";
import { ledgerStatus } from "./ledger-query.js";
import type { LedgerRuntime } from "./ledger-runtime.js";
export function registerLedgerCommands(
  pi: ExtensionAPI,
  getRuntime: () => LedgerRuntime | undefined,
  getDiagnostics: () => string[],
  enabled = () => getRuntime() !== undefined,
) {
  let preview: LedgerExportPreview | undefined;
  const requireRuntime = () => {
    const runtime = getRuntime();
    if (!runtime) {
      throw new Error(getDiagnostics().join("\n") || "帳本尚未啟用。");
    }
    return runtime;
  };
  pi.registerCommand("bears-ledger", {
    description:
      "本機帳本 status／backup／rebuild／export-preview／export-write；不連線 Telegram、不續戰。",
    handler: (args, ctx) =>
      Promise.resolve().then(() => {
        const reply = (content: string) =>
          pi.sendMessage(
            { customType: "bears-ledger", content, display: true },
            { triggerTurn: false },
          );
        try {
          if (!args.trim() || args.trim() === "status") {
            reply(
              JSON.stringify(
                ledgerStatus(
                  getRuntime(),
                  undefined,
                  getDiagnostics(),
                  enabled(),
                ),
              ),
            );
            return;
          }
          const ledger = requireRuntime();
          if (args.trim() === "backup") {
            reply(
              `已驗證 SQLite 完整備份：${ledger.store.backup()}。未查 Telegram。`,
            );
          } else if (args.trim() === "rebuild") {
            ledger.store.reparse();
            reply(
              "已由原文重建目前 parser 事實並清除投影快取；未重送、未改操作資格。",
            );
          } else if (args.trim() === "export-preview") {
            preview = previewLedgerExport(
              ledger.store,
              ctx.cwd,
              ledgerCheckpoint(ledger.read()),
            );
            reply(preview.diff);
          } else if (args.trim() === "export-write") {
            if (!preview) {
              throw new Error("請先執行 export-preview。");
            }
            writeLedgerExport(
              ledger.store,
              preview,
              ledgerCheckpoint(ledger.read()),
            );
            reply(`已匯出 ${preview.path}；只取代上次未修改的產物。`);
            preview = undefined;
          } else {
            reply(
              "用法：/bears-ledger status|backup|rebuild|export-preview|export-write",
            );
          }
        } catch (error) {
          reply(
            `帳本操作未完成：${error instanceof Error ? error.message : "未知錯誤"}。不重送 Telegram。`,
          );
        }
      }),
  });

  return () => {
    preview = undefined;
  };
}

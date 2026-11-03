# 持久化帳本已移除

SQLite ledger extension、`bears_ledger_*` tools、`/bears-ledger` 指令、派送前記帳與結果 `accounting` 欄位均已移除。`BEARS_LEDGER`、`BEARS_LEDGER_DIR` 不再影響套件，也不再為記帳呼叫 Telegram `getMe()`。

## 保留功能與資料

- `bears_original`、目前分支的原文／快照及 `bears_reconcile_rewards` 區間收支比較仍保留；區間比較的 `data.ledger` 是既有回傳格式，不會建立 SQLite 帳本。
- `/bears-metrics` 操作統計仍保留，不新增帳本 operation ID 關聯；舊 JSONL 不遷移。
- 既有私人 SQLite、WAL／SHM、備份與 session 中的舊引用不讀取、不搬移、不刪除，也不自動轉成新期初資源。
- 原有送達不明、取消、限流、逐筆核驗及授權規則不變。移除功能不會重送指令、重啟掛機或恢復 Goal。

## 載入與歷史說明

重啟 Pi 或另行執行 `/reload` 後，才會卸載目前程序已載入的舊 extension；不要為部署中斷正在保留的遊戲挑戰。本次修改不自動 reload 或恢復遊戲。

需要查閱舊版的帳本程式、備份工具與操作方式時，請使用 Git 歷史；`docs/investigations/` 的帳本驗收是歷史紀錄，不表示新版仍提供相關功能。既有私人帳本的清理或復原須另行明確決定，不應刪除整個共用資料目錄。

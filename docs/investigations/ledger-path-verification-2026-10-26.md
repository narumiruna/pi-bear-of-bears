# 帳本扁平路徑驗證

日期：2026-10-26，Asia/Taipei。程式與離線驗證已完成；正式資料尚未搬移，也未停止、reload 或連線現場程序。切換程序見[帳本說明](../ledger.md#舊-id-庫的一次性離線切換)。

## 路徑與資料界線

| 條件 | 新位置 |
| --- | --- |
| 未設定 `BEARS_LEDGER_DIR` | `<agent-dir>/bear-of-bears/<user-id>.sqlite` |
| `./run.sh` 且未覆寫環境變數 | repository 內的 `.pi/agent/bear-of-bears/<user-id>.sqlite` |
| 設定 `BEARS_LEDGER_DIR` | `<BEARS_LEDGER_DIR>/<user-id>.sqlite` |

`<user-id>` 是既有 Telegram transport 驗證的本人 ID 完整十進位字串。`LedgerIdentity` 決定檔名；`LedgerStore` 接受明確 SQLite 檔案路徑，不建立帳號子目錄。內部 `telegram-<user-id>`、schema v1、事件／操作 ID、原文來源及 `bears-ledger-ref` 分支引用不變。

只修改路徑、必要呼叫端、測試及使用文件；沒有新增設定、dependency、Telegram RPC、自動掃描、fallback、搬庫或合併。保留延後開庫、送出前落盤、身分變更阻擋及既有權限／連結檢查。`run.sh`、schema SQL、parser 與操作授權未修改。

## 離線驗證

環境：macOS darwin/arm64，Node.js v26.10.0；最低版本另以 Node.js v22.19.0 執行。全部資料庫為臨時合成資料，不讀取正式庫或憑證。

| 檢查 | 結果 |
| --- | --- |
| `npm test -- tests/ledger*.test.ts tests/workflow-package-load.test.ts` | 9 檔、121 項通過。 |
| `npm run check:ci` | 通過；既有 Biome schema 2.5.12 與 CLI 2.5.15 差異僅 info。 |
| `npm test` | 104 檔、1668 項通過。 |
| `npm run build` | 通過。 |
| `git diff --check`、本次 Markdown 相對連結／anchor | 通過；現行路徑說明一致。 |
| signed commit 驗證 | 原環境未設定 `gpg.ssh.allowedSignersFile`，預設驗證失敗。以 Git 已設定的 SSH 公鑰建立臨時 allowed-signers，透過 `git -c gpg.ssh.allowedSignersFile=<temporary-file> verify-commit HEAD` 驗證通過；未修改永久 Git 設定。 |
| `npm test -- tests/package-resources.test.ts tests/ledger-path.test.ts` | 2 檔、5 項通過，包含打包 skill 連結檢查。 |
| 最低 Node.js 22.19.0：下列命令 | 13 檔、146 項通過；SQLite experimental warning 為預期訊息。 |
| `npm run benchmark:ledger` | 合成 200 手技能、100 次恢復、200 次 history、200 次 watch 重讀通過；確認消耗及恢復均為 6400 MP，重複扣帳 0。只驗證本機 workload，不代表實機效能。 |
| 帳本文件的離線備份程式碼 | 從文件抽取原樣程式碼，以已關閉的合成舊庫執行；備份、exclusive 還原及來源相等通過。錯誤 owner、來源不存在及目的檔已存在均停止，未建立缺少的來源檔。 |

最低版本重跑命令：

```sh
npm exec --yes --package=node@22.19.0 -- node node_modules/vitest/vitest.mjs run \
  tests/ledger*.test.ts tests/workflow-package-load.test.ts tests/package-resources.test.ts \
  tests/telegram.test.ts tests/watch.test.ts tests/extension-watch.test.ts
```

驗收定位：

- `tests/ledger-extension.test.ts`：預設與自訂根目錄、確認 ID 前不建檔、完整精度檔名、內部帳號引用及實際 Pi loader／Codemode／shutdown。
- `tests/ledger-identity.test.ts`：最小 ID、大於 JS 安全整數的 ID 及 signed 64-bit 上界；不同帳號隔離、登入者變更阻擋、舊手動標籤庫與舊 ID 庫不接管、不 fallback。
- `tests/ledger-store.test.ts`：0700／0600、相對路徑、目錄 symlink、DB／WAL／SHM 的 symlink／hardlink／過寬權限、錯誤 owner、未知 schema、非空 v0、損壞資料及送出前後故障。
- `tests/ledger-path.test.ts`：在舊 ID 目錄建立 schema v1 合成庫，清空 WAL 後再寫入已提交資料及未決操作；驗證非空 WAL 的 `VACUUM INTO` 備份，關庫後還原至扁平檔名。備份前後及重新開庫的原文來源、操作／事件 ID、完整分支與另一 ancestry 投影均相等；parser 重建保留舊版本及匯出所有權 hash。目的檔不覆寫，備份目錄 symlink 拒絕。
- `tests/workflow-package-load.test.ts`、`tests/package-resources.test.ts`：npm dry-run 隔離載入及打包 skill 路徑，不安裝、發布或建立 Telegram transport。

## Review 與尚未驗證路徑

已逐檔檢查 correctness、security、lifecycle safety、compatibility、regressions 與 scope。權限與 owner 檢查沒有放寬；初始化失敗的清理、shutdown 冪等、分支引用及未知身分阻擋保持既有流程。這是範圍限定的 source review，不是全儲存庫 security audit。獨立 subagent 無法啟動，原因為目前 provider 不支援停用 parent extensions 的子程序；未宣稱通過獨立 review。

正式切換仍須由使用者關閉所有使用舊庫的 Pi 程序，保留 DB／WAL／SHM，再以最後已提交資料產生並驗證備份。還原後的正常授權連線及本機 status／trace 現場核對尚未執行。新版不尋找舊帳；未切換就正常連線會建立新空庫，不能當成舊帳續接。新庫已有資料後不得直接退回過期舊庫，須先備份並另行決定保留方式。

## 交付狀態

實作分支為 `narumi/refactor/ledger-path`，基底為本機 `main` 的 `9c3f3bf58b67f984c76a15f695653f96d1b65e68`。開始時已有該筆未推送 commit 及計畫檔的路徑名稱修改；均保留，未把既有 parser 修正改寫為本次變更。

已建立本次 signed commit，工作目錄無未提交變更。GitHub 交付受限：`AGENTS.md` 要求 signed commit 直接推送 `main`，且禁止 pull request，與本次 branch／PR 要求衝突。沒有擅自推送既有未發布 commit 或建立 PR；交付尚未完成，計畫與入口須保留至規則衝突解決。

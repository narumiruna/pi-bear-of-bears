# Telegram ID 自動對應帳本驗收

日期：2026-10-26，Asia/Taipei。依後續要求移除手動帳號標籤，改由已登入的 Telegram 本人使用者 ID 自動對應。使用方式見[帳本說明](../ledger.md)。本次未登入、查詢或操作遊戲，未自行 reload、commit 或 push。

## 行為與資料界線

- 帳本預設啟用身分等待，無須 `BEARS_LEDGER_ACCOUNT`；舊變數不參與映射。`BEARS_LEDGER=0` 仍可停用，`BEARS_LEDGER_DIR` 仍是可選私有根目錄。
- `TelegramTransport.connect()` 完成既有授權與 bot 對象檢查後，在帳本需要時透過既有 client 的 `getMe()` 取得使用者本人。不是 bot／chat／角色 ID，不從遊戲文字、電話、username、憑證或 session 檔內容推定。
- 本人 ID 保留完整十進位字串，驗證正整數及 Telegram signed TL long 範圍；不轉 JS Number。測試包括大於 JS 安全整數的 `9007199254740993` 與 64 位元上界。
- 首次確認 ID 後才開 `<ledger-root>/by-telegram-id/telegram-<id>/ledger.sqlite`。同一 Telegram 帳號的所有角色共用一庫；來源觀測、操作意圖及成本仍在派送前同步落盤。
- `session_start`、查帳、備份查詢及單純 reload 不會為帳本建立 Telegram 連線。尚未確認身分時，status 的 `enabled=true` 是功能狀態，診斷明示等待身分；不猜期初或改用共用帳號。
- 單一 Pi session 若看到不同登入者，拒絕相依派送並失效舊視圖，history 仍可讀；須重新載入隔離既有控制情境。正常切換遊戲角色不觸發此限制。
- watch 綁定連線確認時的 ID，不在 flush 時重讀可變 getter。身分只作內部路由，不新增到 watch 的模型可見內容。不同 SDK session 的 watch／工具不為另一個帳本取得或保存身分。

## 舊資料與復原

不變更 schema v1，不搜尋、改名、接管或合併舊標籤庫。採用新的 `by-telegram-id` 層級，即使以前手動標籤剛好叫 `telegram-<id>`，也不會被自動採用；原始檔案仍留在原處。單憑舊標籤無法證明歷史資料所屬登入者。

備份仍使用 SQLite 完整備份，還原至新私有根目錄並保留 `by-telegram-id/telegram-<id>` 結構。遇身分或 DB 故障不重送、不刪庫掩蓋問題；需要回退時由使用者設定 `BEARS_LEDGER=0` 後重新啟動。新控制器在 host／開庫失敗時關閉已取得的 DB 連線，不保留部分啟用狀態。

## 驗證結果

環境：macOS darwin/arm64；Node v26.10.0；實際安裝的 Pi coding-agent 1.4.0。

| 檢查 | 結果 |
| --- | --- |
| `npm run check:ci` | 通過；既有 Biome schema／CLI 版本差異僅 info。 |
| `npm test` | **102 檔、1639 項通過**。 |
| `npm run build` | 通過。 |
| `git diff --check`、本次文件本機連結／換行檢查 | 通過。 |
| 最低 Node 22.19.0 | **16 檔、173 項通過**，包含實際 Pi loader、Codemode、套件隔離載入與 ledger／transport／watch 回歸。 |

最低 Node 重跑指令：

```sh
npm exec --yes --package=node@22.19.0 -- node node_modules/vitest/vitest.mjs run \
  tests/ledger*.test.ts tests/telegram.test.ts tests/watch.test.ts tests/extension-watch.test.ts \
  tests/workflow-package-load.test.ts tests/metrics.test.ts tests/combat-native*.test.ts \
  tests/workflow-boundaries.test.ts tests/workflow-continuation.test.ts
```

主要回歸：

- `tests/ledger-identity.test.ts`：精度、非法 ID、延後開庫、未知身分不派送／history 可讀、角色共庫、不同登入者與 reload、舊庫同名不接管、DB 故障、原文來源及遲到 ticket。
- `tests/telegram.test.ts`：使用 `getMe()` 而非 bot ID；停用或不需要帳本時不新增身分查詢；一般身分 RPC 失敗仍可唯讀 history、派送維持阻擋；限流、bot／關閉中停止，不猜 ID、不重試；`account_identity` RPC 階段分開記錄。
- `tests/watch.test.ts`、`tests/extension-watch.test.ts`：來源 ID 固定於連線；不新增到模型可見輸出；外來 SDK session 的 watch 不替另一個帳本取得身分。
- `tests/ledger-extension.test.ts`：無帳號設定仍預設等待、舊變數無效、唯讀查詢不登入、DB 故障不派送、實際 Pi jiti loader／Codemode 與已確認連線接點。
- 既有去重、revision、分支、取消、MP 拒絕、SQLite 備份／重建及 workflow 安全護欄維持通過，沒有放寬操作資格。

## Review 修正與限制

已修正舊標籤與新衍生名稱可能碰撞、失敗初始化的連線清理、watch ID 在 flush 時變動、外來 SDK session 的額外身分查詢，以及身分被誤帶入 watch 輸出的風險，均有離線回歸。

每次需要記帳的新連線呼叫一次 `getMe()`；SDK cache 是否省略 RPC 取決於實際 client 狀態。沒有新增連線、輪詢或 retry；未量測實機延遲，不以先前的純 SQLite workload 宣稱此項沒有網路成本。停用或外來 SDK 呼叫不為此讀取身分。

尚未以真實 Telegram 登入者驗證，沒有讀取憑證／session 檔來取得 ID。這是離線程式驗收，不代表遊戲現況、戰鬥安全或 Goal 完成。原生休息／塔首達等既有 unknown 格式限制不變。

# 本機持久化帳本

本文件只說明帳本，不新增遊戲授權或恢復工作階段。

## 啟用與資料位置

需要 Node.js 22.19.0 以上，使用內建 `node:sqlite`，不要求第三方 driver。最低版本會顯示 experimental warning；未驗證 Bun。

不需設定帳號。預設在既有 transport 正常連線內以 `getMe()` 取得已登入的 Telegram **使用者本人 ID**，不是 bot、chat、username、電話或角色；以完整十進位字串保存，不轉 JS Number，也不讀取或顯示憑證內容。不另建立連線、輪詢或重試。

確認本人 ID 後才開庫；此前唯讀 status 的 diagnostics 會顯示等待身分，不為查帳主動登入。`BEARS_LEDGER_ACCOUNT` 已移除；`BEARS_LEDGER=0` 可停用，停用時不為帳本查本人 ID。每次需要記帳的新連線呼叫一次 `getMe()`，實際 RPC／延遲取決於 SDK cache，未做實機效能量測。

預設位置為 `<agent-dir>/bear-of-bears/<user-id>.sqlite`，跟隨 `PI_CODING_AGENT_DIR`。使用 source checkout 的 `./run.sh` 且未覆寫環境變數時，位置在 repository 內的 `.pi/agent/bear-of-bears/<user-id>.sqlite`；外部覆寫仍優先。設定 `BEARS_LEDGER_DIR` 時，直接使用 `<BEARS_LEDGER_DIR>/<user-id>.sqlite`，根目錄須為私有的真實絕對路徑。同一 Telegram 帳號的所有角色共用一庫，內部帳號仍為 `telegram-<user-id>`，schema v1、事件 ID 與 Pi 分支引用不變。新目錄 0700、檔案 0600，拒絕 symlink、資料檔 hardlink 與過寬權限。

舊庫保留，不掃描、fallback、自動搬移或合併。**已有 ID 庫時，須由使用者先依下節離線切換，再以新版正常連線；新空庫不是舊帳續接。** 舊手動標籤不能證明 owner，不直接改名接管。單一 Pi session 若偵測到另一 Telegram 登入者會拒絕相依派送，須由使用者重新載入以隔離控制情境；正常角色切換不影響本人 ID。設定變更由使用者明確重新啟動，不為部署 reload 保留中的挑戰。帳本載入不會啟動 Telegram、背景工作或 Goal。

## 查詢與未知資訊

- `bears_ledger_status`：歷史資源、成本、未決與缺口。
- `bears_ledger_trace`：以帳內 `observationId` 或 `operationId` 追查原文及 parser 版本，不接受 SQL 或路徑。
- `bears_ledger_report`：角色／訊息區間的成本、條件差異、實傷及耗時；`afterObservationId` 限制重複證據。
- `bears_ledger_checkpoint`：最多 2400 字的預覽，不改檔。

trace／report 的 `text` 是 JSON 片段；offset 為零起算 Unicode code point，limit 最多 6000。首頁取得 `snapshot`，續頁帶相同條件與該值，依 `nextOffset` 串接。切樹、reload 或容量淘汰後須重查首頁；snapshot 不刷新新鮮度。

指令的 `accounting.confirmedMpCost` 只證明已確認成本，`mpAfter=null` 不可補零。只有角色、起點及中間連續性成立才推導餘額；`confirmed` 不代表完整機制或安全。所有工具的 `operationalEligibility=false`，不取代即時核驗。

同 ID／revision 只計一次；不同 ID 同文分開。未知 revision 順序、缺頁、切角、外部分支或時鐘異常保留缺口；Pi 分支不撤銷遊戲動作。主動回血、裝備吸血、名目／實補／溢補分開；盾耗次、未記錄防護政策與未確認挑戰 ID 不猜值。未知尾文不放寬共用 parser。名目未實補量可能含治療衰減，不全部當作溢補；條件不足時反例保持 unknown。

初版原生技能使用共用 parser，完整 status、具名掛機及已知財務回執依格式解析。原生休息／塔首達尚無完整 fixture，未支援時保持 unknown；離線 replay 不當成實機格式。模型 usage、文件耗時只按分支記錄，缺資料不估精確單手成本。不為補帳或報表額外戰鬥。

## 預覽、備份與復原

- `/bears-ledger export-preview` 只顯示 diff；另行 `export-write` 才寫固定的 `docs/goals/bears-ledger-checkpoint.md`。目錄須已存在；只建立新檔或替換上次未人工修改的完整產物，不改 `GOAL.md` 或舊 anchor。不要同時用其他編輯器修改匯出產物。
- `/bears-ledger backup` 使用 SQLite `VACUUM INTO` 及 `quick_check`，包含已提交 WAL；備份位於 `<ledger-root>/backups/<uuid>.sqlite`，內部 owner 不變。不要只複製開啟中的主 DB。
- `/bears-ledger rebuild` 從保留原文重建目前 parser 事實，保留舊版本及防覆寫 hash，不重送、不恢復遊戲。

送出前落盤失敗拒絕該筆派送；送出後失敗保留遊戲回覆並標記帳本不完整。history 不被資料庫故障阻斷，不能將 unknown 當作失敗重送。

還原前停止受影響操作並關閉所有使用該庫的 Pi 程序，保留該帳號 DB、同名 WAL／SHM 及備份；共用根目錄可能含其他帳號，不刪整個根目錄。可先以 `BEARS_LEDGER=0` 停用，再將已驗證備份放入新的 0700 私有根目錄，命名 `<user-id>.sqlite`、權限 0600；ID 須符合內部 `telegram-<user-id>`。目的 DB／WAL／SHM 任一存在時停止，不覆寫、不合併、不混入舊 sidecar。設定 `BEARS_LEDGER_DIR` 後，由相同登入者重新啟動及正常連線確認；以唯讀 status／trace 核對來源與未決。無原文或 ancestry 引用時列缺口，不推期初、不重送 Telegram。

### 舊 ID 庫的一次性離線切換

1. 由使用者安排停機並關閉所有使用舊庫的 Pi 程序，保留整個舊帳號目錄及 DB／WAL／SHM。此後不再用舊版寫入；舊手動標籤庫不在此程序範圍。
2. 確認舊庫為 schema v1，且 `ledger_meta.account` 是先前正常連線驗證的 `telegram-<user-id>`。在停機後沿用 SQLite `VACUUM INTO` 及 `quick_check` 產生完整備份，涵蓋最後已提交 WAL。source checkout 可在 build 後以 `new LedgerStore(oldDatabasePath, account).backup()` 執行，結束時必須關閉 store；確認來源存在且 owner 正確，不建立空庫冒充舊庫。失敗即停止，不刪舊庫，不以較早備份宣稱涵蓋最後寫入。
3. 依上述還原條件，將備份以 exclusive create 放為新根目錄的 `<user-id>.sqlite`，不帶入舊 WAL／SHM；目的檔存在時停止，不覆寫或合併。
4. 完成還原後才以新版啟動。保留原 Pi session 的 ancestry 引用及內部帳號；下一次正常授權連線後，以本機 status／trace 核對來源、操作 ID、未決與分支資料，不為驗收新增遊戲指令。
5. 尚無新資料時，可關閉新版並回到舊版及原位置。新庫已有新資料時，先備份並停止，不能直接退回過期舊庫或自動合併，須另行決定保留方式。`BEARS_LEDGER=0` 只暫停帳本，不解除未決或遊戲限制。

事件上限 200000，每個 DB／WAL／SHM 檔案限 256 MiB；達限前備份、封存並改用新根目錄。未知 schema 拒絕，不刪庫。資料含私人遊戲內容，不提交 Git 或公開 wiki；自由文字與聊天引數不進永久帳本。這些程序不解除遊戲授權、未決或安全護欄。

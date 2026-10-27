# SQLite 個人紀錄庫

## 狀態與界線

目前為開發／演練介面，**尚未正式遷移或刪除 Markdown**。正式切換仍需 [SQLite 計畫](plans/2026-10-27_sqlite-records-plan.md) 的 D1–D6 核定；以下路徑及單機策略依建議值開發，不代表使用者已接受失去 GitHub 瀏覽或選定第二份備份位置。切換前 `AGENTS.md` 的既有紀錄寫入規則保持有效，不同時維護兩份正式資料。

紀錄庫保存人工歷史敘述，和遊戲觀測 ledger 分開。查詢、新增、修訂、匯入、備份都不登入 Telegram、不建立即時遊戲資格、不觸發 Goal 或恢復遊戲。

## 儲存與 API

- 預設開發位置：專案 `.pi/records/records.sqlite`；可用絕對路徑 `BEARS_RECORDS_PATH` 覆寫。DB、WAL／SHM、備份皆私有，`.pi/records/` 不進 Git；外部指定位置亦不得提交私人資料。
- extension factory 與 session_start 不開庫；首次明確工具／command 操作只開既有庫，shutdown 冪等關閉。DB 遺失或變成空檔時停止，查詢、新增、verify 與帳本壓縮均不自行建立空庫；路徑設定變更亦不沿用舊連線。
- schema v1：`records`、不可變 `revisions`、`requests`、`aliases`、`imports`、`import_parts`；`records_current` 與 FTS5 是可重建衍生索引，不是第二套正式本文。
- SQLite 使用 WAL、foreign keys、FULL synchronous、1 秒 busy timeout。版本未知、損壞、symlink、hardlink、寬權限與開啟後 inode 被替換時拒絕操作，不建立新空庫冒充舊庫。
- `createdAt` 是該修訂寫入紀錄庫的 Unix 毫秒，`importedAt` 是初始匯入批次時間；`observedAt` 只有呼叫端明示的觀測 Unix 毫秒才保存，不用查詢時間刷新。事件日期／時間／時區另存。未明日期／時間／時區／角色保留未知，不從檔名、相鄰紀錄或當前登入者補猜。本文可包含 Markdown 字串，但不輸出 `.md` 副本。

| Tool | 用途 |
| --- | --- |
| `records_search` | 字面搜尋；最多 10 筆、含摘錄的輸出低於 8 KiB。可按 kind、明示日期與角色篩選。續頁保持相同條件並帶 cursor；有寫入即拒絕過期 cursor。 |
| `records_get` | 按 id／revision 讀全文。預設 4000、最多 6000 Unicode code points；後續 offset 必須固定首次 revision，不默默接到新版。 |
| `records_append` | 用 requestKey 交易式新增；相同 key／相同內容回同一結果，不同內容拒絕。工具確認 commit 才回正式 ID。 |
| `records_revise` | 指定 expectedRevision；衝突不覆寫，舊版永久可讀。不提供刪除紀錄的 tool。 |
| `records_resolve` | 解析已登記的完整舊路徑／anchor、`records:<database-id>/<id>@<revision>`，或綁定該庫的 `records:<database-id>/alias/<percent-encoded-alias>` 集合文字引用。整卷可多筆，後續 offset 帶首次 snapshot；拒絕跨庫及錯誤編碼，查無不猜一筆代替，不讀任意檔案。 |

搜尋不將文字當 SQL 或 FTS 語法。3 字以上適用時用 trigram 候選，再以同一字面條件篩選；1–2 字、控制字元與無 FTS5 環境直接做參數化字面比對。英文字母採 SQLite `lower()` 的 ASCII 大小寫語意，Unicode 非 ASCII 不額外做模糊比對。

`/records status`、`/records search 文字`、`/records show ID [revision]`、`/records backup` 可直接使用，不呼叫模型。show 只顯示第一頁；完整後續用 `records_get`。command 回覆不觸發 Agent 回合。

**全新且沒有舊 Markdown 紀錄的專案**，可由使用者以 `/records init` 明確初始化空庫；不提供模型初始化 tool、不接收任意路徑參數，既有檔案原子拒絕。來源索引或 notes／logs 目錄仍有任一月份 `.md` 時拒絕 init（不限原八份清單），須先盤點並走下列離線遷移，避免兩套寫入。init 不匯入歷史、不代表 D6 正式切換；DB 遺失時先依備份復原，不用 init 代替復原。

## 離線遷移

先 build，再由使用者在核定時段執行；Agent 的暫存測試不等於正式切換。

```sh
npm run build
node dist/src/records-migrate-cli.js preview
node dist/src/records-migrate-cli.js apply /absolute/records.sqlite PREVIEW_MANIFEST /absolute/second-backup
node dist/src/records-migrate-cli.js verify /absolute/records.sqlite PREVIEW_MANIFEST
```

- `PREVIEW_MANIFEST` 換成 preview 回傳的 SHA-256；兩個路徑換成核定的 DB 與獨立備份目錄。preview 不開庫或改檔。
- apply 先保存包含未提交內容的八份來源復原快照，再核對來源 hash、交易式匯入、完整驗證，最後產生含 WAL 的一致性 SQLite 備份。目標已有無關資料時拒絕合併；相同匯入可重跑。
- 分割辨識 fence 外的 anchor／標題，同時保留前言、空行、索引獨有敘述與無日期內容。初始本文不正規化換行，包含 CRLF；所有來源 bytes 必須能從 revision 1 逐區塊還原並匹配 SHA-256。
- 別名以完整 repository 路徑為主要定位，不只用 `record-0001`；另保留由明示標題時間建立的 `NOTESHH:mm`／`LOGHH:mm`（HH:mm 為明示時間）歷史簡稱。重複 anchor、相同時刻與整卷回多筆而不是任選。原始本文的相對連結保留；`resolveRecordLink(origin, href)` 可將它轉成 repository alias 或外部網址，不能把連結文字當授權。
- verify 可只靠庫內初始版本與 manifest 檢查，不要求舊 Markdown 仍存在。
- CLI **不會刪除來源、不改寫既有規則／引用、不自行 reload**。正式切換必須另核 D6、凍結寫入、驗證第二份備份與引用，不能只因 CLI 顯示 verified 就刪來源。

## 規則與引用切換預覽

```sh
node dist/src/records-cutover-cli.js rehearse
node dist/src/records-cutover-cli.js preview /absolute/records.sqlite PREVIEW_MANIFEST
```

- `rehearse` 只用私有暫存庫，檢查目前八份來源與有效文件；結束即刪暫存庫，回傳的暫存 ID **不能當正式引用**。不建立正式庫、不改檔、不刪來源。
- `preview` 先核對目前來源與 manifest，以 readOnly 連線產生包含 WAL 的一致性暫存副本；索引重建僅在副本進行，保留正式 databaseId。原庫及有效文件不寫入。
- 候選 JSON 包含各文件來源／結果 hash、分階段精確差異、庫身分、epoch 及整體 snapshot。唯一舊引用固定初始 revision 1；整卷／重複時刻使用集合引用，不展開成數千 ID、不任選一筆，也不是瀏覽器連結。
- 規則原文不唯一、缺頁、未支援連結呈現或 Wiki 私人引用會保留 `needs_review`。偵測到並行改寫、未納盤點的新分卷、不安全文件連結或超過 512 份／16 MiB（單檔 2 MiB）時停止；不覆寫別人的更新、不讀其他計畫或隱藏 session。
- **沒有 apply 子命令。** `ready` 只表示候選產生成功，不等於 D1–D6 核定或審查完成。正式切換前仍須停止寫入、使用正式庫重新預覽並逐項審查；純記憶體 renderer 也會拒絕來源 hash 不符。
- JSON 含私人文件片段；若保存，使用 0700 目錄與 `umask 077`，不要提交完整候選至 Git。程式不自動保存另一份可持續寫入的 Markdown。

## 備份與復原

`/records backup` 保存於 DB 同目錄下的 `backups/`，使用 `VACUUM INTO` 包含已提交 WAL，並驗證 SQLite。日常備份首版由使用者明確執行，不自動清理，不提供跨機合併或雲端同步。

復原時先停止所有使用該庫的程序，保留 DB／WAL／SHM，在新的 0700 目錄以 exclusive create 放置已驗證備份，檔案 0600；目的地及 sidecar 任一已存在時停止，不覆寫或混入舊 sidecar。設定新 `BEARS_RECORDS_PATH` 並重啟，核對 databaseId、revision、匯入 manifest 與舊 alias。不把較舊備份直接覆蓋已新增紀錄的正式庫。

同磁碟備份無法防整機遺失；獨立保存位置、頻率與正式切換時段仍待使用者核定。沒有 Markdown fallback、雙向同步或自動 Markdown 匯出。

## 已執行驗證

程式、測試與部署缺口的完整交接見[兩份計畫離線驗收](investigations/records-retention-verification-2026-10-27.md)。

- 全量暫存演練：8 份來源、5,039,918 bytes、1764 個區塊／紀錄；來源 manifest `5585b3b306324570e225088b5b3791d9398f79a4fbff98abf70c6074e09cbef3`。包含當時未提交的紀錄；原檔未變。
- Node.js v22.19.0／SQLite 3.50.4：實際開庫、FTS5 trigram、兩字「星塔」、三字「狂戰熊」與備份 smoke 通過；v26.10.0／SQLite 3.53.4 為完整測試與基準環境。
- 基準：`npm run build && node benchmarks/run-records.mjs`，固定 10 案各 30 次，見 [量測 JSON](investigations/records-benchmark-2026-10-27.json)。`rg` 包含程序啟動成本；結果不代表所有規模、所有查詢或冷啟動都更快。
- 外部引用稽核（2026-10-28 00:34 重跑）：125 份非來源／非計畫 Markdown 文件，443 個唯一解析、221 個可分頁的多筆定位、0 缺頁及 0 未解析歷史時刻簡稱；稽核不把多筆任選成唯一。正式切換前仍須重新盤點及套用引用變更。
- 全量暫存備份還原：原始1764筆／8檔hash、6845筆alias與庫身分相符；另有一筆明示合成log的兩版WAL回歸資料，還原後1765筆、完整性ok及零foreign-key違規。不是正式D3備份交接。
- 尚未完成：正式 DB／第二份位置核定、有效規則與引用切換、移除舊檔，以及正式 runtime reload 後的本機 smoke。這些項目完成前，不宣稱 SQLite 已是這份 repository 的唯一正式紀錄來源。

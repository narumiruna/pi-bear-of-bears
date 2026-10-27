# SQLite 紀錄庫與帳本整理：離線驗收

## 結論與範圍

兩份計畫的程式及暫存演練已建立，**尚未完成正式切換與本人帳本容量回收驗收**。本文件只記錄 coding Goal `6e47bdc1-fa6e-4d64-b9b6-9f11cc80ff46`；不啟用遊戲、不取代並行 session 的目標，也不覆寫其 `GOAL.md` 或續行更新。

- [SQLite 計畫](../plans/2026-10-27_sqlite-records-plan.md)：D1–D6 未見使用者核定，仍保留正式遷移、規則／引用切換、移除來源及載入驗收待辦。
- [帳本整理計畫](../plans/2026-10-27_ledger-retention-plan.md)：永久刪除整理成功的舊事件已獲授權；正式紀錄庫、部署及本人回收證據仍未具備。不是每批再次索取刪除授權。
- 使用／復原方式分別見 [records](../records.md) 與 [compaction](../ledger-retention.md)。本文件不是啟用指令。

## 實作與離線證據

| 領域 | 主要檔案 | 已驗證範圍 |
| --- | --- | --- |
| 紀錄持久化 | `src/records-{data,store,search}.ts` | request key、不可變修訂、預期版本衝突、重開、字面搜尋、長短詞、固定版本分頁、私有路徑、鎖等待、含 WAL 備份及新位置讀回。 |
| 工具與生命週期 | `extensions/records.ts`、`src/records-tools.ts` | 五個 codemode tools、嚴格參數及輸出 schema；factory／session_start 不開庫，commands 不觸發模型或 Goal。 |
| 遷移與定位 | `src/records-migrate{,-cli}.ts`、`src/records-reference-audit.ts` | 八份來源完整 byte／hash 核對、CRLF／fence／前言、未知欄位、重跑、來源變動整批回滾、整卷及歷史時刻別名、原來源移除後獨立 verify。 |
| 切換預覽 | `src/records-cutover{,-cli,-rules}.ts` | 只在記憶體產生候選；庫身分／epoch／來源 hash、唯一引用固定 revision 1、集合引用保留歧義、並行變動停止、原庫 readOnly 含 WAL 副本。 |
| 帳本回收 | `src/ledger-retention.ts` 及 ledger store／runtime | 固定 watermark、完整 context、未決排除、跨分支 partial through、精確事實重播、真正刪列及來源關聯清理、原文壓縮標記。 |
| 整理模型與落盤 | `src/ledger-retention-{agent,digest,run,wiki}.ts` | 無工具隔離 context、有界分塊、取消／timeout、schema／來源驗證、records 冪等摘要、受限公開摘錄、失敗不刪帳、含 WAL 暫存備份及提交後清理。 |
| 派送與安全邊界 | `src/ledger-retention-extension.ts`、`src/ledger-runtime.ts` | active ticket／維護互斥、跨連線 lease、原子派送護欄、切樹／shutdown 取消、watch gap、不重複自動 spawn。 |

精確帳務只由程式核對，不由模型猜餘額、正式勝場或未決結果。已刪的 trace 明示不可還原；目前 parser 無相容壓縮事實時停止，不把壓縮標記重新解析成空帳。未解析、仍有引用及僅有 hash 的重要全文不為湊半量而刪除。

### 收尾回歸修正

1. 壓縮工具成功、失敗與 `not_needed` 分支統一使用宣告的 `{version, operationalEligibility, data}` envelope；測試用 TypeBox 核對工具回覆與自動通知。
2. runtime 開啟 records 必須使用既有庫模式。DB 遺失、空檔或路徑設定變更時停止，不因查詢、新增、verify 或壓縮默默建立空庫。
3. 僅由使用者明確 `/records init` 原子新建空庫；既有檔案拒絕，來源索引或 notes／logs 中有任一月份 Markdown 亦拒絕，不只檢查原八份清單。已重現並修正新月份被漏過的問題，避免資料分流。沒有模型初始化 tool；初始化不代表匯入歷史或 D6 放行。
4. 開庫後、初始化 schema 前核對 inode 與安全路徑，避免把檔案替換當成原庫；既有空檔的 verify 不寫入新 schema。
5. 2026-10-28 重現候選準備在檢查上限前先作無界 `SELECT *` 的問題。候選、提交核驗與投影改共用 `eventRows`，SQL 先套用既有上限；201000 筆以上的合成超限案例拒絕且不刪除。寫入 200000 筆與檔案 256 MiB 護欄未調高。

## 執行環境與命令

觀測日期：2026-10-27 至 2026-10-28，時區 `+0800`。主要環境為 Node.js v26.10.0／SQLite 3.53.4；最低支援環境為 Node.js v22.19.0／SQLite 3.50.4。

| 命令／檢查 | 結果 |
| --- | --- |
| `npm run build` | 2026-10-28 00:45 通過。 |
| `npm test -- tests/records-store.test.ts tests/records-migrate.test.ts tests/records-extension.test.ts` | 2026-10-28 00:47 通過，3 檔／27 項。 |
| `npm test` | 2026-10-28 00:45 通過，130 檔／1976 項，包含新月份初始化防護。 |
| `npm run check:ci` | 2026-10-28 00:45 通過，294 檔；僅既有 Biome schema 2.5.12／CLI 2.5.15 的一則 info。 |
| `git diff --check` | 通過，無空白錯誤；最後僅更新文件證據。另核對本任務5份文件的12個本機檔案連結，全部存在。 |
| Node.js 22.19.0：十個新增功能測試檔 | 2026-10-28 00:45 通過，10 檔／61 項。SQLite experimental warning 不算失敗。 |

最低版本命令：以 Node.js 22.19.0 執行 `node_modules/vitest/vitest.mjs run`，測試檔為 `tests/records-{store,extension,migrate-cli,migrate,reference-audit,cutover,cutover-cli}.test.ts` 及 `tests/ledger-retention{,-agent,-extension}.test.ts`。十檔測試使用合成資料及私有暫存目錄，不操作本人 DB 或 Telegram。

## 全量來源演練及效率

2026-10-28 00:34 已重新執行全量暫存演練：8 份來源、5,039,918 bytes、1764 個區塊／紀錄。匯入格式 v2 的 manifest 為 `5585b3b306324570e225088b5b3791d9398f79a4fbff98abf70c6074e09cbef3`。這是當時來源快照，不是正式切換可免重新核對的授權或永久 hash。

`npm run build && node benchmarks/run-records.mjs` 可重做全量暫存匯入、byte／hash 驗證、10 案各 30 次查詢及非來源／非計畫文件引用稽核，結果見[量測 JSON](records-benchmark-2026-10-27.json)。程式完成後刪除自己建立的暫存庫；不移除來源、不套用規則或引用變更。

本次 10 案各 30 次，搜尋輸出最多 4301 bytes。引用稽核涵蓋 125 份文件：443 個唯一解析、221 個多筆定位、0 缺頁及 0 未解析時刻簡稱。這是切換前盤點，不代表已改寫引用。

`rg` 基準包含程序啟動；例如 `<a id=` 的 SQLite P95 為 12.05 ms，`rg` 為 8.22 ms。不能由有界輸出或本次 median 推論所有查詢、冷啟動或規模都有速度提升。唯一／多筆定位分開計算，不以任選一筆消除歧義。

## 切換預覽與全量備份還原

`node dist/src/records-cutover-cli.js rehearse` 已以目前八份來源演練：125 份有效／歷史文件、20 項規則候選、654 處引用候選，沒有解析阻礙。摘要見[預覽演練](records-cutover-preview-2026-10-28.json)。唯一引用使用庫內原始 revision 1，多筆定位轉為綁定 databaseId 的集合引用；不任選一筆，也不將 records 文字引用做成假瀏覽器連結。

候選保留每份文件來源／分階段結果 hash，規則原文不唯一或預覽中有並行改寫時停止。CLI 沒有 apply，暫存庫在結束時清理，不保存可誤用的暫存 ID。正式資料庫選定後仍要重新產生並審查；本次沒有套用候選或修改有效寫入規則。

`benchmarks/run-records.mjs` 在查詢量測完成後，另於私有暫存庫新增一筆明示合成 log 及一版修訂，關閉該暫存連線的自動 checkpoint，驗證包含 WAL 的一致性備份，還原到另一個全新 0700 目錄再完整核對：

- 原始 8 檔／5,039,918 bytes／1764 筆全部 hash 相符；6845 筆 alias 及 databaseId 保留。
- 合成資料 revision 1 與 2 都可讀，還原庫共 1765 筆；合成資料不算來源歷史或效能查詢案例。
- 備份前 WAL 為 42,180,592 bytes；`integrity_check=ok`，`foreign_key_check` 為 0 違規。
- 暫存庫、備份與還原副本結束後清理，來源檔未改。這不是 D3 的正式獨立備份交接。

## 尚未執行及正式放行條件

| 項目 | 必要條件／後續證據 |
| --- | --- |
| D1–D5 決策 | 使用者確認專案一庫／位置、Git 與跨機政策、備份責任、保留修訂且不提供刪除、接受本機查閱及外部舊網址限制。現有程式依建議值開發，不等同已核定。 |
| 第二份備份 | 使用者指定獨立保存位置、日常頻率及保留責任；正式 apply 後必須還原驗證。不能將本機暫存演練當成已交接備份。 |
| D6 切換時段 | 使用者放行並停止所有相關寫入者；重新讀取工作樹、有效規則及來源，來源變動即停止重做 preview。不能忽略並行 session。 |
| 規則與引用切換 | 候選產生器與暫存全量預覽已完成，正式差異仍須審查；正式 databaseId／紀錄 ID 確認後才套用，不用暫存庫 ID 取代正式引用，不啟用半套 SQLite 規則。 |
| 正式匯入與移除來源 | 保存未提交內容快照，正式匯入／全量 verify、完整性及備份還原通過；刪檔前 hash 再核對，規則與來源切換期間不得繼續寫入。 |
| 正式載入 smoke | 依安排 reload；只測本機新增、搜尋、固定版本全文、修訂、舊引用、重開及備份，不以遊戲動作測部署。 |
| 本人帳本回收 | 正式 records 就緒並明確啟用 retention 後，取得整理前後事件數、manifest、摘要、清理數與重跑證據；真實模型 usage 與離線替身分開記錄。 |

**未做的事**：沒有正式匯入、刪除舊 Markdown、修改有效寫入規則、啟用 retention、reload 本次新版、呼叫真實整理模型或刪除本人帳本事件。沒有提高容量上限、停用 ledger 或繞過派送護欄。

SQLite 刪列可能只增加可重用空頁；事件數減半不代表檔案 bytes 減半。暫存備份清理失敗會明示保留，程序崩潰留下的副本不自動刪除；不以無限封存原文替代已授權的事件回收。

以上正式條件未驗收前，兩份計畫保持未完成，不刪計畫、不輸出 Goal 完成標記。

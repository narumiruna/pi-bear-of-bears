# SQLite 紀錄取代 Markdown 實作計畫

狀態：開發與暫存演練已進行，D1–D6 尚待使用者核定。依建議值實作的介面尚未正式切換；不建立本人正式紀錄庫、不刪舊檔、不改成雙重寫入，也不自行reload。實作與限制見[records文件](../records.md)，固定查詢及引用稽核見[量測報告](../investigations/records-benchmark-2026-10-27.json)。

## Goal

將 `docs/notes/`、`docs/logs/` 與 `docs/NOTES.md`、`docs/LOG.md` 日期索引改為 SQLite 紀錄庫，由 Pi extension 提供讀寫與查詢。切換後 SQLite 是這些紀錄的唯一正式資料來源，不保留 Markdown 主檔、搜尋用副本、雙向同步或自動 Markdown 匯出。

完整保留歷史內容、時間、來源與證據定位；透過有界搜尋及分頁全文讀取減少不相關內容進入 context。不先宣稱 SQLite 的查詢速度一定比 `rg` 快。

範圍不包含 `AGENTS.md`、`GOAL.md`、`docs/goals/`、調查文件、wiki 與 `docs/context-feedback/` 的儲存格式。它們仍是文件；其中指向已遷移紀錄的引用與寫入程序必須更新。

## Context

2026-10-27 本機盤點：

- 六個分卷合計 4,923,794 bytes，約 4.9 MB；有 1,750 次 HTML anchor 宣告。anchor 數量不是紀錄筆數，須檢查重複、別名與非紀錄章節。
- `docs/notes/2026-10.md` 有 18,420 行，`docs/NOTES.md` 有 1,160 行。新紀錄倒序寫入，舊分卷與 `legacy.md` 並非統一格式。
- 分卷含文件前言、歷史限制、不同層級標題、程式碼區塊及相對連結；不能只依 `##` 或日期正規表示式切割。
- 初步搜尋在目標八檔與 `docs/plans/` 以外找到 44 個有明確路徑引用的檔案；尚未涵蓋所有裸文字簡稱、HTML／reference-style 連結或外部引用，完整盤點列為前置工作。不檢查或修改其他既有計畫。
- [AGENTS.md](../../AGENTS.md) 與[文件入口](../README.md) 定義分卷寫入、日期索引及歷史資料界線。[遊玩 skill](../../skills/playing-bear-of-bears/SKILL.md) 仍要求寫入月分卷；README 與其他參考文件亦需更新。
- [既有帳本](../ledger.md) 使用 `node:sqlite`，依 Telegram ID 分庫，並有 Pi 分支來源限制。它是遊戲觀測帳本，不是人工敘述紀錄庫；不能直接將筆記當成帳本觀測或即時操作資格。
- `extensions/ledger.ts`、`src/ledger-store.ts` 與 `tests/ledger-extension.test.ts` 可作為註冊、生命週期、交易、備份及離線測試模式參考，不直接擴張 `LedgerStore`。
- `package.json` 要求 Node.js >=22.19.0，以明確的 `pi.extensions` 清單載入 extension；`run.sh` 會載入本套件。[.gitignore](../../.gitignore) 目前只忽略部分 `.pi/` 路徑，另明確允許 `docs/logs/*.md` 進 Git。
- 本機 Node.js v26.10.0／SQLite 3.53.4 的記憶體測試支援 FTS5 trigram。三字「狂戰熊」可命中，兩字「星塔」的 MATCH 不命中；必須處理短詞，且仍須驗證專案最低支援版本。
- 工作目錄已有未提交變更，包括 `docs/NOTES.md`、`docs/notes/2026-10.md`、`GOAL.md`、續行文件與 ledger 程式／測試。不得 reset、覆寫或漏匯入這些變更；正式切換前須重新盤點。

## Unknowns：需要你決定

「只選 SQLite，不雙重維護 Markdown」已確定，不再作為待決選項。下列建議尚不是已核准需求；你可以逐項回答，或確認全部採建議。

| ID | 需要決定 | 建議 | 取捨與影響 |
| --- | --- | --- | --- |
| D1 | 資料庫歸屬與位置：專案一庫，或依 Telegram 帳號分庫？ | 專案一庫，獨立於 ledger；預設專案根目錄下 `.pi/records/records.sqlite`，允許明確設定其他位置。 | 不需 Telegram 登入即可查筆記，跨角色敘述不用拆分；但同專案所有使用者共用紀錄，若需要帳號隔離，須改資料路徑與匯入歸屬。不得用當下登入者猜歷史 owner。 |
| D2 | 是否需要 Git 保存紀錄或多台機器接續？ | 正式 SQLite 不進 Git；首版單機，不做資料合併。 | clone／checkout 不會帶回紀錄，GitHub 也看不到新紀錄。若要版本化，可另選將一致性 SQLite 快照提交 Git，但沒有文字 diff 或自動 merge；多機寫入不能靠同步開啟中的 DB 解決。 |
| D3 | 備份放哪裡、何時做、保留多久？ | 提供手動備份及還原程序；遷移／升版前強制產生並驗證備份。正式切換前指定一個獨立於原 DB 的第二份保存位置；首版不自動清理備份。 | 同磁碟快照只能處理部分誤改，不能防整機遺失。須確認第二份位置與日常備份頻率；若要自動備份，明確選定觸發事件，不新增輪詢或雲端服務。 |
| D4 | 誰負責寫紀錄，能否修改／刪除？ | Agent 依現有記錄規則明確呼叫新增／修訂工具；修訂保留舊版本，首版不提供刪除。 | 不攔截所有檔案寫入、不在每次遊戲工具回覆後自動生成摘要。若要全自動紀錄或永久刪除，需另定觸發、保存與授權規則。 |
| D5 | 能否接受紀錄只能經本機工具／指令查閱，失去 GitHub Markdown 瀏覽及舊網址？ | 接受；repository 內改用穩定紀錄 ID，舊路徑／anchor 可由 resolver 查回。 | 刪檔後無法維持外部既有網址可點閱；保留 Git 歷史也不等於維持目前網址。若仍要公開瀏覽，須另立唯讀檢視功能，不以保留 Markdown 副本解決。 |
| D6 | 何時正式切換並刪除舊檔？ | 先完成開發及全量離線演練，再由你安排停止相關紀錄寫入、備份、最終匯入與驗收的時段。 | 現有工作階段及未提交紀錄不可在匯入中繼續改寫。未到切換時段只交付程式，不刪檔、不改成半套 SQLite 流程，也不自行 reload 正在使用的 Pi。 |

D1–D5 核定後才固定儲存與 API 契約；D6 是正式遷移的獨立放行條件。若選擇多機同步、公開檢視或自動摘要，先更新本計畫的範圍與驗收，不默默加入首版。

## Architecture

以下依建議選項設計，決策不同時先更新本節。

### 資料與責任

- 新增 `extensions/records.ts` 作為註冊與 command 入口；`src/records-store.ts` 負責 schema、交易、搜尋、版本與備份；`src/records-tools.ts` 負責工具契約；`src/records-migrate.ts` 負責一次性離線匯入、驗證及引用對應。不新增常駐索引服務。
- 使用內建 `node:sqlite`、TypeScript、TypeBox 與 Vitest，沿用 Node.js >=22.19.0 支援範圍；不先增加 SQLite driver、向量庫或 Markdown parser dependency，只有格式測試證明必要時才評估相依套件。
- 分離 `records`、`revisions`、`aliases` 與 `imports`：穩定 ID 與目前版本、不可變修訂內容、舊路徑／anchor 別名、匯入批次及來源 hash。全文索引只作衍生資料，可由正式紀錄重建。
- 紀錄保存 `note`／`log` 類型、標題、完整本文、明示的事件日期／時間／時區、可確認角色與來源 ID；建立時間、匯入時間和觀測時間分開。舊紀錄缺日期、時區或角色時保留未知，不以檔名、鄰文或當前角色補猜。
- 本文可保留原有 Markdown 排版字串；這是 SQLite 欄位內容，不維護 `.md` 檔案。索引摘要若有分卷沒有的獨有資訊，必須保留而非直接丟棄。保存原始來源路徑，使本文內相對連結可解析成紀錄引用或仍存在的 repository 文件；初始原文版本保持不變，不因轉換引用失去 byte 核驗依據。
- 使用資料庫身分、紀錄 ID 與 revision 建立文字引用，例如 `records:<database-id>/<record-id>@<revision>`；實際值由工具回傳，使用者不必手填 UUID。這不是瀏覽器超連結，亦不假設 Pi 自動支援此 URI。
- 舊別名以完整 repository 相對路徑加 anchor 作 key；不能只用跨分卷可能重複的 `record-0001`。保留分卷及索引頁的無 anchor 查閱入口，回傳可分頁的對應紀錄集合，不任選一筆充當整卷。
- 這是跨 session 共用的歷史紀錄，不隨 Pi 分支回溯或切樹刪除。可保存來源 session 資訊，但不推測來源屬於目前分支，不與 ledger 建立虛假的強制外鍵。

### 最小使用介面

| 介面 | 行為 |
| --- | --- |
| `records_search` | 依文字、類型、日期及可確認角色篩選；回傳 ID、revision、日期、標題、短摘錄與續頁資訊。 |
| `records_get` | 讀取指定 ID／revision；全文以 Unicode code point 分頁，不默默截斷。 |
| `records_append` | 交易式新增；使用可重送辨識的 request key，確認 commit 後才回傳正式 ID。 |
| `records_revise` | 要求預期 revision，新增修訂並保留舊版；版本衝突不覆寫。 |
| `records_resolve` | 將已登記的舊路徑／anchor 轉成紀錄引用；不讀任意路徑。 |
| `/records status`、`/records search`、`/records show`、`/records backup` | 供使用者直接查閱及備份；不觸發模型、Telegram 或遊戲續行。 |
| `/records init` | 僅供使用者明確初始化全新、無舊 Markdown 的專案；原子拒絕既有檔，不當作遺失庫的復原或正式遷移。 |

工具使用 `exposure: "codemode"`、嚴格參數、`outputSchema`／`structuredContent` 與正確的唯讀／寫入 annotations。不提供任意 SQL、任意路徑或遊戲授權欄位。查詢內容是不受信任的歷史資料，不當作新指令或即時狀態。

搜尋先定義一致的字面查詢語意；FTS5 trigram 處理可用長詞，1–2 字、特殊符號與不適用索引的查詢走參數化字串比對。兩條路徑使用相同篩選與排序規則，特殊字元不得變成任意 MATCH 語法。搜尋預設最多 10 筆、文字輸出不超過 8 KiB；全文預設每頁 4,000、最多 6,000 code points，另限制序列化 bytes。所有超限結果提供可完成讀取的分頁入口；跨頁需固定 revision／查詢快照或明確拒絕過期游標。

### 持久化與故障界線

- factory 只註冊；首次操作只開既有庫，shutdown 冪等關閉。遺失／空檔不由查詢、新增或壓縮自動重建；初始化僅由明確 command 或離線 apply 進行。沒有 watcher、timer、背景摘要、context 全量注入或自動遊戲操作。
- 使用明確 schema 版本、foreign keys、WAL、交易與有界 busy timeout；序列化同程序寫入，測試多程序競爭。未知 schema、損壞或目標庫錯誤時停止，不建立新空庫冒充原資料。
- 備份包含已提交 WAL，使用 SQLite 一致性備份方式並驗證完整性；不能只複製開啟中的主 DB。沿用私有目錄 0700／資料檔 0600、拒絕不安全連結的設計；不讀憑證或 Telegram session。
- 寫入失敗、取消或回覆遺失時不宣稱記錄成功；以 request key 查核已提交結果，不盲目新增第二筆。紀錄庫故障不改變已發生的遊戲結果，也不暗中改回 Markdown 寫入。

## Plan

### 1. 核定契約與探索缺口

- [ ] 核定 D1–D5，將選項、保存位置與備份責任寫回本計畫；驗收為使用者明確確認，並移除與決策不符的設計。
- [x] 建立八個輸入檔的完整盤點與相依引用清單，涵蓋現有未提交內容、明示 anchor、標題 anchor、相對連結、裸文字引用及索引獨有內容；驗收為每個輸入都有 bytes／SHA-256、每種格式都有 fixture，歧義有明確處理方式。只追蹤本計畫，不讀改其他計畫；舊計畫中的引用以 alias 相容。
- [x] 在最低 Node.js 22.19.0 與目前 runtime 驗證 SQLite、FTS5 trigram、短詞 fallback 及備份 API；驗收為兩種環境的可重現結果。環境不可用時保留此項，不以目前 runtime 取代最低版本驗證。
- [ ] 固定 schema、引用格式、搜尋語意、分頁與錯誤契約，並選出 10 個真實查詢案例建立 `rg`／讀檔基準；驗收為契約文件與固定案例可獨立重跑，含「星塔」、角色名、訊息 ID、日期、符號及未明日期資料。

### 2. 建立紀錄庫與 extension

- [x] 實作 `src/records-store.ts`，支援交易式新增、保留歷史的修訂、request key、版本衝突、固定版本讀取與備份；驗收為 `tests/records-store.test.ts` 涵蓋重開庫、取消、重送、競爭、鎖定、磁碟／寫入失敗、未知 schema 與損壞。
- [x] 實作全文搜尋、短詞 fallback、篩選與有界分頁；驗收為長短中文、英文、特殊符號、無結果、超長單筆、修訂後索引更新及跨頁一致性測試通過，無遺漏本文入口。
- [x] 實作 `extensions/records.ts`、`src/records-tools.ts` 及 `/records` commands，加入 `package.json` 的明確註冊清單；驗收為 `tests/records-extension.test.ts` 及 Pi 隔離載入測試證明 schema／codemode 可用、生命週期可重入，且不連 Telegram、不續行、不全量注入 context。
- [ ] 依 D2–D3 加入資料檔／sidecar／備份的 Git 政策及一致性備份流程，撰寫 `docs/records.md`；驗收為新位置權限、安全路徑、目的地已存在拒絕、含 WAL 備份、還原到新位置與再次查閱的離線演練通過。

### 3. 製作一次性遷移並全量演練

- [x] 實作 `src/records-migrate.ts` 的明確 preview／apply／verify 流程；preview 只產生盤點，不改正式資料。依已確認的 anchor／標題邊界保留完整區塊，避開 code fence，將前言與非紀錄文字保存在庫內匯入脈絡；驗收為 `tests/records-migrate.test.ts` 對重複 anchor、無日期、巢狀標題、索引摘要及不支援格式不漏文、不猜值。
- [x] 建立來源 hash、區塊對應、alias 與引用轉換報告，使同一匯入重跑不重複；來源變動、歧義或目的庫不符時拒絕套用。驗收為重跑、故障回滾及 apply 前後 hash 改變的測試通過，且本文內相對連結與無 anchor 整卷引用都有可用去向。
- [x] 用目前全部八個檔案在私有暫存庫演練；驗收為所有來源 bytes 都可由初始紀錄及匯入脈絡重組並匹配 SHA-256、所有明細與索引獨有內容有去向、每個舊引用可解析或有已接受的例外。不能只比較筆數或抽樣。
- [x] 在全量演練庫重跑固定 10 案、每案 30 次，記錄開庫時間、暖查詢 median／P95、回傳 bytes 及量測環境，與基準比較；驗收為正確命中、有界輸出及完整全文可取回。未實測更快時不宣稱速度提升；若有明顯退步，先修正或取得接受再切換。

### 4. 切換規則、引用及正式資料

- [x] 準備 `AGENTS.md`、`docs/README.md`、`README.md`、`docs/ledger.md`、遊玩 skill／參考文件與非計畫引用文件的切換變更；驗收為預覽顯示所有有效寫入規則改走 records tools、引用改成可解析 ID，且不變更遊戲授權或其他文件儲存範圍。此時不啟用半套規則。（`src/records-cutover*.ts`：125份文件、20項規則及654處引用的暫存演練；唯一引用固定初始版本，集合保留歧義。沒有apply或有效檔案改寫，正式ID須於D1–D6核定後重做預覽。見[演練摘要](../investigations/records-cutover-preview-2026-10-28.json)。）
- [ ] 取得 D6 放行並凍結相關寫入，保存包含未提交內容的切換前復原快照與確認的檔案 hash；驗收為使用者確認時段、相關寫入者已停止、第二份備份可讀，來源再核對一致。任何變動即停止並重新 preview。
- [ ] 在正式目標庫執行一次性匯入與完整驗證，產生切換後一致性 SQLite 備份並還原驗證；驗收為全量 hash／區塊／alias 核對通過、`PRAGMA integrity_check` 與 `foreign_key_check` 通過，備份包含同一批紀錄及 revision。
- [ ] 套用已審查的規則與引用變更，移除 `docs/NOTES.md`、`docs/LOG.md` 及六個舊分卷；驗收為移除前 hash 仍符合匯入版本，repository 無有效舊寫入規則或失效內部引用。歷史／本計畫中的舊路徑只作遷移來源說明，既有其他計畫靠 resolver 相容；不留下可繼續寫入的 Markdown stub。
- [ ] 依使用者安排載入新版，在不操作遊戲的條件下完成新增、搜尋、全文、修訂、舊引用解析、重開與備份的本機 smoke test；驗收為新紀錄只出現在 SQLite，舊版本可查，無舊檔重生、重複筆記或 Telegram 操作。

## Rollback / Recovery

1. 刪除舊檔前必須已有包含目前未提交內容的切換前復原快照及驗證過的 SQLite 備份；只靠 Git HEAD 不足以保護未提交紀錄。復原快照是固定的遷移備份，不是另一套持續寫入的正式資料。
2. preview 或演練失敗時，原檔與正式規則不動。正式 apply 失敗時回滾交易並保留診斷，不刪來源、不靜默續匯或重建空庫。
3. 正式切換涉及 DB、規則與刪檔，不能假設它們是一個交易；保存各階段狀態，過程中禁止其他寫入。中斷後先核對 hash／manifest 再決定完成切換或還原，不同時開放兩套寫入。
4. 若尚未新增切換後紀錄，可在停止 extension 後恢復切換前資料與原規則；保留已匯入庫作診斷，但只啟用一個正式來源。若已有新紀錄，不得直接回到舊 Markdown 或舊備份；先完整備份新庫，選擇修復 SQLite 或經批准的單向回遷，避免遺失新資料。
5. 日常損壞／誤改時先停止受影響的紀錄寫入並保存 DB／WAL／SHM，在新私有位置還原已驗證備份，核對資料庫身分、紀錄及 revision 後才啟用。不在本計畫執行未授權的遠端備份、帳號操作或遊戲復原。

## Risks

- **失去 Git 可見性與公開連結**：D2、D5 必須明確接受；resolver 只能保留本機定位，不能恢復外部網址。
- **資料只剩本機一份**：D3 未完成、第二份備份未驗證時不得刪來源檔；開發測試通過不等於正式資料已受保護。
- **格式與引用非標準、持續寫入造成漏匯**：全量 byte coverage／hash 核驗、來源鎖定與歧義停止；不以 LLM 摘要代替遷移原文。
- **中文短詞漏查或查詢輸出過大**：trigram 加短詞 fallback、固定案例及分頁測試；不只驗證三字以上名稱。
- **誤把筆記當遊戲證據或目前授權**：保留原觀測時間、未知與歷史標記，與 ledger 分開；紀錄工具不刷新遊戲狀態。
- **與既有未提交工作衝突**：切換前重讀相關 diff，只修改本次核定範圍；不以本計畫處理 unrelated ledger 修改或其他計畫。

## Completion Checklist

- [ ] D1–D6 有明確結論，所有實作任務通過各自驗收；最低 runtime 與格式歧義已解決或有使用者接受的限制。
- [x] `npm test -- tests/records-store.test.ts tests/records-migrate.test.ts tests/records-extension.test.ts`、`npm test` 與 `npm run build` 通過；保留實際命令與結果，不將離線測試寫成遊戲驗證。（2026-10-28：相關3檔27項、全130檔1976項及build通過；Node.js 22.19.0新增功能10檔61項亦通過。見[離線驗收](../investigations/records-retention-verification-2026-10-27.md)。）
- [ ] 正式匯入的八份輸入全文、初始版本、時間與來源、索引獨有資訊及所有 alias 核對通過；舊檔移除後仍能完整查回。
- [ ] 相關規則、skills、文件引用、相對連結及 diff 已檢查；舊檔不再是有效讀寫入口，也沒有自動 Markdown 輸出或雙向同步。
- [ ] SQLite 正式位置、Git／跨機政策、備份位置／頻率與復原責任完成交接；獨立備份及還原演練有證據。
- [ ] Pi 本機載入與 smoke test 完成；搜尋案例、輸出限制及效率量測已記錄，未驗證範圍清楚標示，無額外遊戲操作。
- [ ] 使用者接受正式切換與剩餘限制；先將驗收證據與復原方式保存在 `docs/records.md` 或對應調查文件，再刪除本計畫並回報路徑。正式遷移或任何驗收未完成時不得刪除本計畫。

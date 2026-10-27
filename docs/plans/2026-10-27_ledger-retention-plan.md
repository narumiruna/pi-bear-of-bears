# 帳本容量整理與知識提取

## Goal

依使用者2026-10-27要求：事件達容量門檻時啟動受限subagent，整理較舊約一半資料；通用知識歸Wiki、個人經驗歸角色相關日誌。使用者已明確允許整理成功後永久刪除該批舊事件，類似LLM compaction，不要求長期保留所有原文或每批再次詢問。回收活躍帳本容量，但精確帳務checkpoint仍由程式驗證，不以模型摘要補猜餘額或未決結果。純coding期間不恢復爬塔。

## Context

- 實作中：核心、候選分頁、機器事實重播、受限subagent、SQLite摘要與公開摘錄writer已完成離線測試；使用與限制見[compaction文件](../ledger-retention.md)。正式紀錄庫、本人事件刪除及載入驗收未執行，不把暫存演練當完成。

- 現有帳本schema v1、事件上限200000，單一檔案上限256 MiB。實機唯讀診斷曾被容量阻斷；已修復診斷分支並reload。額外逐筆event原子限額修正已完成相關57項與build，尚未reload。
- 本機檔案metadata最後測得DB102.80 MiB、WAL0、SHM0.03 MiB；不是純事件大小，未查本人DB內容或確認精確事件總數。
- `src/ledger-store.ts`以contexts／operations／observations／facts／events／operation_observations建立關聯；Pi分支以contextId／through引用帳本，不能直接刪最舊100000列。
- 現有個人日誌為`docs/NOTES.md`→`docs/notes/YYYY-MM.md`，續行在`docs/goals/`；沒有必要另建第二份完整戰報。角色索引可連結既有明細，不重複流水。
- `wiki/AGENTS.md`禁止玩家身分、個人數值、私人訊息ID與個人戰報連結；不能將本人戰鬥事件直接寫入Wiki。
- 初期盤點沒有subagent。現已實作獨立、無工具的provider-neutral model context，不建立預設會載入遊戲extensions的完整AgentSession；呼叫端只提供固定JSON，不提供工具或主對話。

## Architecture

1. 程式以唯讀快照、穩定watermark及完整操作組挑選較舊約一半的候選，不要求一次恰好100000列。先排除未決、仍寫入中的操作；舊分支引用由compaction checkpoint／範圍manifest處理，不能把所有被引用的舊事件永久釘住而無法回收。
2. 由程式產生有來源的結構化收支／資源邊界、操作狀態及manifest；機器帳務以此精確層為準，不由LLM補數或把unknown當零。
3. 單一受限subagent讀分塊、有總token／時間預算的資料。只回傳結構化知識候選、角色經驗及引用，不提供Telegram、bash、任意讀寫檔或DB存取。不把100000事件一次塞入context，不遞迴spawn。
4. 確認來源、衝突與隱私後，程式／主Agent才寫入既有Wiki主題及日誌；Wiki僅保留有合適公開來源支持的通用內容。純私人證據支持的機制先留角色日誌為條件觀察，不宣告通用規則。
5. 摘要成功落盤及帳務邊界驗證通過後，在排他交易下永久刪除該批舊事件與不再需要的關聯原文／facts，保留checkpoint、來源範圍與hash。未刪事件ID不重編。舊分支遇已壓縮範圍要明示只剩摘要，不能偽造逐筆trace或沿用已遺失來源的操作資格；不以永久封存全部原文代替實際刪除。SQLite空頁回收與檔案縮小分開驗收，不宣稱事件減半即磁碟減半。
6. 容量處理與遊戲派送互斥，完成後仍重新核本人及挑戰，不恢復舊護盾、不重送未決操作。觸發放在可取消且有生命週期的安全邊界，不在每個事件寫入中啟動模型或建立背景循環。

## Plan

- [x] 定義FIFO操作組與跨分支引用的保留／回收規則，使用多分支、未決及同ID修訂fixtures證明不斷鏈。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 定義精確帳務checkpoint與manifest schema，驗證壓縮前後資源、成本、未決及正式勝場一致；無法證明一致者排除回收。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 實作可分頁的唯讀候選準備與容量觸發，固定同一watermark，門檻含高／低水位避免重複spawn。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 依Pi SDK docs及examples實作無遊戲／任意檔案工具的受限subagent，串接取消、timeout、輸出schema及模型usage；停機／reload時釋放。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 實作Wiki／個人日誌的候選分類、去重、來源及隱私驗證；寫檔衝突不覆寫人工內容，未知與矛盾保留。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 實作備份、排他壓縮與提交驗證；摘要或寫檔失敗、模型取消、來源改變均不刪原始帳本。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [x] 補多連線、崩潰點、有限重試、同一範圍冪等與重啟恢復測試，不靠遊戲動作補證。（離線證據：`tests/ledger-retention*.test.ts`、`tests/ledger-store.test.ts`。）
- [ ] 更新ledger使用／復原文件及必要既有規則，完成相關測試、全測、build與diff，分開記錄離線與載入驗收。（2026-10-28離線全130檔1976項、build、Biome、diff通過；維修初始讀取亦共用有界SQL，未調高寫入上限。見[驗收紀錄](../investigations/records-retention-verification-2026-10-27.md)。正式規則與載入仍待D1–D6，不以離線結果勾除此項。）
- [x] Not applicable: 本次實作Goal `6e47bdc1-fa6e-4d64-b9b6-9f11cc80ff46` 僅交付兩份計畫，不因本程式恢復任何遊戲；工作目錄其他session的Goal更新不當作本session的遊戲授權。

## Unknowns

- 永久刪除授權已確認：整理成功後可刪約半量舊事件。模型摘要失敗／不完整不觸發刪除，不再將永久原文封存當前提。
- 已實作可辨識壓縮範圍的查詢與機器checkpoint，舊Pi分支的partial through仍保留未決狀態；未知checkpoint格式拒絕讀取。未支援或已刪的原文不能宣稱可還原。
- 已實作目前模型、無工具隔離context、60秒共用timeout、最多8塊／每塊2500輸出tokens，以及已報50000 tokens／1 USD的停止線；單次回覆可能已跨線，非硬性付款上限。正式啟用仍待紀錄庫D1–D6與部署安排，預設不啟用、不重新載入目前Pi。

## Rollback / Recovery

- 刪除前建立可驗證的暫存復原資料，維持原庫直到摘要檔案及精確checkpoint驗證成功。commit前失敗保留原資料，commit後以manifest對帳，不重做遊戲操作；成功後清除暫存復原副本，不留下無限累積的完整封存。
- schema遷移與舊分支相容須先離線fixture驗證，不在運行中直接搬本人DB或刪events測試。

## Completion Checklist

- [x] 約半量候選被整理、未決及引用保護、精確帳務一致性均有測試。（僅離線合成驗證；尚未呼叫真實付費子模型。）
- [x] 實際證明subagent無遊戲工具、無任意檔案／DB權限，取消與失敗不刪資料。（僅離線合成驗證；尚未呼叫真實付費子模型。）
- [ ] Wiki無玩家資訊，角色紀錄沿用既有日誌且保留來源、未知與差異。
- [ ] 恢復、冪等、多連線與崩潰測試、build及必要載入驗收通過。
- [ ] 真實容量處理結果與未驗證項目如實記錄，確認事件數實際下降、關聯原文按規則清理及重複執行不重複摘要，無未決操作重送或繞過派送護欄。

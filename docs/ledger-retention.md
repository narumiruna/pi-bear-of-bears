# 帳本事件 Compaction

## 狀態

程式與離線合成驗證已建立；**尚未啟用本人帳本的自動壓縮，也未刪除本人事件**。SQLite 個人紀錄庫的正式位置、第二份備份及切換時段仍依 [紀錄庫計畫](plans/2026-10-27_sqlite-records-plan.md) D1–D6 核定。不以本文件授權或恢復任何遊戲 Goal。

## 執行機制

1. 明確設定 `BEARS_LEDGER_RETENTION=1` 後，在 `agent_before_settle` 的安全邊界檢查活躍事件數。達 180000 筆才考慮較舊約一半；也可明確呼叫 `bears_ledger_compact`。factory、session_start、reload 不啟動模型或背景工作。
2. 以固定 watermark 選完整 context，排除含未決操作的 context，不拆跨邊界操作。資料不足時不為湊半量刪未決資料。保留未刪事件的原始 ID。
3. 由程式產生機器 checkpoint、條件樣本與摘要輸入；精確資源、成本、首達、怪金、已知勝場、未決、revision 衝突與外部分支障礙均以原有投影重播核驗，不由模型計算。
4. 單一無工具 subagent（隔離模型context，不是OS沙箱）只收到有界、完整 JSON 分塊，沒有主對話、檔案、bash、DB、Telegram、MCP、遞迴 agent 或專案 extensions。使用目前模型的既有 provider-neutral stream，不另讀憑證或建立遊戲連線。
5. subagent 回傳有 schema 的個人摘要、未知與公開摘錄候選。個人資料以穩定 request key 寫入 [records](records.md)，並回讀驗證；中斷重試會重用已落盤的同一份摘要，不再花模型成本生成不同版本。
6. 摘要成功後，產生包含 WAL 的暫存完整 SQLite 備份，於交易內再次核對來源 hash 及 manifest，刪除該批事件與對應的 operation_observations，將不再被活躍事件引用、且完整解析的戰鬥／恢復／明確通層原文改為壓縮標記。未知格式、不完整戰鬥、只有hash的技能／裝備與其他仍重要的全文保留，不為達半量刪掉唯一證據。保留必要的 parser 事實、操作狀態、來源索引與摘要引用，不保留全部聊天原文。
7. 重播驗證相同才 commit；不一致、來源變動、取消、格式／寫入失敗都回滾。成功後移除本次暫存完整備份；移除失敗會回報 `backupRetained`，不將已完成的壓縮推成未發生。

設定是部署放行，不是遊戲授權；本次 coding 不會自行設定該值或 reload。未開啟時，既有 200000 事件與 256 MiB 檔案護欄保持有效。個人紀錄庫不存在或未初始化時停止，不新建空庫承接摘要。

手動工具與自動通知皆回傳 `{version: 1, operationalEligibility: false, data: ...}`；`not_needed`、成功與失敗分支共用相同 envelope，不將整理成功當成操作資格。

## 保存與捨棄

- 活躍 `events` 的舊列會實際刪除，不只是標記隱藏。`ledger_compactions` 保存去重的機器索引、範圍、來源 hash、parser 版本與摘要引用。
- 為維持舊 Pi 分支在任意 `through` 的語意，prepared／submitted／完成狀態及必要來源索引保留；不能因操作現在已完成，就讓舊分支的未決狀態消失。
- `ledger_compacted_observations` 保存不可變內容 hash 與 checkpoint ID；新觀測同 ID／revision 時必須吻合原 hash，不用壓縮標記假裝原文。新 revision 仍造成原有衝突，不自選較晚版本。
- trace 明示 `compacted`，只剩必要機器事實／摘要，不宣稱能還原逐字原文。report 回傳 compactions 與耗時／模型 usage 明細可能不完整的限制；目前保留的部分成本不能冒稱全歷史模型費用。
- 已壓縮原文不能本機 reparse。若目前 parser 的事實不存在，讀取明示失敗，不把標記解析成空事實或零餘額；後續 parser 升版需實作可驗證的 checkpoint 相容性。
- 事件數減半不代表檔案 bytes 減半。SQLite 可能保留空頁，必要機器事實與未決證據也仍存在；不自動 `VACUUM` 重寫正在使用的主庫，不承諾無限保存或永不再達 256 MiB。

## Wiki 與個人紀錄

- 全庫帳務基準明確標示不是候選區間新增收益；先前樣本不能寫成理論上界或固定機率。摘要列出省略數與未知，不能以省略當作沒有。
- 私人角色名稱、資源、配裝、訊息 ID 與戰報留在個人紀錄，不進 Wiki。
- Wiki 目前只接受呼叫端明確提供、來自固定公開 BOSS 圖鑑 URL 的逐字摘錄；模型不能自行提供新網址、任意檔名或私人資料當公開來源。一般帳本事件沒有合格公開來源，因此自動路徑的 Wiki 候選通常應為空。
- 合格摘錄由固定 writer 寫入 `wiki/ledger-knowledge/`，更新該目錄及總索引，依來源 hash 去重；已人工修改的產物拒絕覆寫。寫入失敗不刪帳。這個目錄只在有合格內容時建立，不預建空分類。

## 互斥、取消與故障

- 本程序有 active ticket／維護互斥；SQLite 維護 lease 阻止其他新版寫入者開始派送，送出意圖也在同一 SQL 內檢查 lease。提交前來源 hash 再核對，其他連線改動會使壓縮停止。
- lease 只記到期時間，不靠背景輪詢；reload／shutdown／切樹會取消所屬工作。處理期間的 watch 若略過，結束後留下 gap，不延續舊餘額推導。
- 共用總 timeout 60 秒、最多 8 個分塊、每個輸出最多 2500 tokens。累計已報 usage 過 50000 tokens 或 1 USD 時不續做、不刪帳；這是收到回執後的停止線，單一 provider 回覆可能已跨線，不是假稱硬性付款上限。
- 手動工具回傳真實 model usage，包含失敗回覆已用的部分；自動路徑另寫入本機帳本 usage，不把自動摘要費用冒稱由某場戰鬥產生。模型或 SDK 未提供的部分不估算。
- 自動處理失敗後不在同一 runtime 自動重試；沒有 sleep、timer 輪詢、排程、背景刷怪或自動遊戲續行。
- SQL 回滾保護原資料；程序中斷留下的備份不自動刪除。處理故障時先查 manifest、摘要與 SQLite 完整性，不重送遊戲操作，不直接刪原庫。

## 驗證範圍

候選準備、提交核驗與投影共用先限 SQL 列數的讀取，超過既有維修上限即停止，不先載入全庫再檢查，也不提高 200000 筆寫入上限。

離線測試包含約半量回收、20000 筆 telemetry、201000 筆以上超限停止、未決保留、任意舊分支 partial through、首達／怪金／通層、來源變動、取消、摘要與 Wiki 拒絕、跨連線 lease、已落盤摘要重試、原文壓縮標記、相同 revision hash，以及 watch 缺口。沒有以本人戰鬥或真實付費模型呼叫測試。

正式 runtime、本人容量回收、停機切換與剩餘引用驗收尚未完成；以兩份實作計畫的未勾項為準，不以離線測試宣告整體 Goal 完成。具體命令、證據與放行條件見[兩份計畫離線驗收](investigations/records-retention-verification-2026-10-27.md)。

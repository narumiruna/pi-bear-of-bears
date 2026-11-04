# 延遲戰鬥回覆與 Goal 空轉處理計畫

## Goal

讓已送出但暫無回覆的遊戲操作能在新證據到達後重新核驗，避免重送、錯誤歸屬與 Goal 重複空轉；不自動恢復已暫停的遊戲目標。

## Context

- `src/game.ts` 的 `act()` 在固定 `replyWaitMs` 後讀取最近10則訊息，以 ID／revision 差異回傳更新；沒有更新時回傳 `no_update_yet`。這不證明遊戲操作失敗。
- `src/watch.ts` 已有新訊息收集與 pending queue，須先核對其啟用、分支歸屬與通知方式，不能假定本次有啟用或曾漏送。
- `extensions/goal.ts` 在結算時重送契約，連續三次沒有成功工具執行或相同回覆後暫停。工具活動不是任務進展，不能為重設計數增加查詢。
- 本次第二手血怒 outgoing923722，兩次history未見回覆；使用者其後提供戰鬥文字，列本人HP1520／3040、怪HP16653660／16677710。使用者貼文提供新線索，但尚未與Telegram原生訊息綁定，不據此直接恢復戰鬥。

## Non-Goals

- 不恢復爬塔、不付款、不測危險戰鬥，也不建立背景輪詢。
- 不放寬操作結果、角色歸屬、護盾、生存預算或完成驗收。
- 不把延長等待時間當成唯一修正，也不因文字相似就自動認領回覆。

## Plan

- [x] 追查 `src/game.ts`、`src/watch.ts`、操作帳本及 `extensions/goal.ts` 的資料流，確認未決操作、延遲訊息與 Goal 通知的既有能力；以具體檔案／函式及離線案例列出可重現缺陷與尚未確定的外部延遲原因。
- [x] 修改前完整閱讀 Pi 相關 extension／事件／TUI文件及範例，核實可用事件與續行介面；以文件定位確認方案不依賴不存在的API。
- [x] 先補延遲回覆回歸測試，涵蓋送達但無回覆、補查用完後新訊息到達、無關公告、修訂、缺在先outgoing、角色／分支改變與取消；測試須保證不重送、不錯綁、不自行續戰。
- [x] 依調查結果修正既有未決操作接續流程，保留operation ID、送達狀態、證據來源及待核原因；新證據只能轉為可重新核驗，不直接產生攻擊或成功判定，以前項測試驗收。
- [x] 定義並實作 Goal 的明確等待外部證據狀態及一次性提示，避免相同缺口繼續消耗三次結算；保留未完成目標與原循環保護，不把任意工具成功當成解除等待。以Goal測試驗收無輪詢、無契約空轉、無偽完成。
- [x] 驗證外部新證據只更新待核狀態／通知；已被循環保護暫停的Goal仍須明確 `/goal-resume`，session／分支切換、reload及取消不得自動恢復，以事件測試驗收。
- [x] 更新受影響的skill與操作說明，區分同一未決指令兩次補查上限、外部新證據觸發核驗及禁止無新證據輪詢；檢查與AGENTS.md及Goal契約一致，不要求使用者常態代貼回覆。

## 驗證證據與交接

- 資料流：`Game.act()` 只回傳當次差異；`WorkflowObservations` 已保留原文／request歸屬規則；`GameWatch` 在互動／RPC session 預設啟用，`bears-watch` 使用 `triggerTurn:false`。不改這些歸屬或連線規則。Telegram延遲的外部原因仍未知，未證實為SDK或網路bug。
- 當前原始碼沒有可供此流程引用的持久化operation UUID；`src/game-operation.ts` 是程序內排他鎖。因此以實際Telegram outgoing ID作等待錨點，保留回覆 ID、revision、原文source ID與本人候選名稱，不捏造帳本operation ID，不修改既有帳本／快照。
- `src/late-reply.ts` 僅產生 `operationalEligibility:false` 的原生技能回覆候選。既有watch／history入口接續通知，不重新送出操作。修訂、省略、跨角色／分支、取消與Auto Idle抑制時保守失效。
- `extensions/goal.ts` 明確等待協定保存未完成目標並只提示一次；新候選不啟動turn，明確 `/goal-resume` 後才核驗。持久化仍是version1／status=paused加可選waitingExternal欄位，舊runtime可讀為paused；還原不自動續行。
- 已閱讀Pi `docs/extensions.md` 的事件、session、訊息及UI API，並核對 `examples/extensions/event-bus.ts`、`file-trigger.ts`。僅使用既有事件匯流排、notify與appendEntry，沒有客製TUI或新監看連線。
- 離線回歸：`tests/late-reply.test.ts` 包含本次血怒文字；`tests/goal-external-wait.test.ts` 包含等待、通知去重、錯誤標記、最後補查與結算間的新訊息競態，以及明確恢復／生命週期。相關8檔91項通過；完整 `npm test`：118檔1832項通過。`npm run build`、變更程式檔 Biome 檢查及 `git diff --check` 通過。Biome只有既有schema版本提示（2.5.12設定／2.6.4 CLI），未改無關設定。
- 文件核對：README、AGENTS.md及遊玩skill的等待／恢復界線已同步；沒有新增相對文件連結。本計畫引用的程式與測試路徑均存在。
- 實機未驗：本次沒有登入、發送遊戲指令、恢復Goal或reload。不宣稱已修復Telegram延遲或本層可安全續攻。載入新runtime與恢復爬塔分開；保留原未決操作檢查點，待使用者確認載入安排後再做對應工作。
- 程式交付已實作並通過離線檢查；最後一項使用者交付／載入確認尚未取得，因此保留計畫、不宣告整份驗收完成。

## Risks

- 延遲回覆與無關公告可能混在一起：不以時間接近或文字相似作唯一歸屬依據，缺證保留未知。
- 等待狀態可能變成新的自動恢復捷徑：通知與操作授權分離，暫停後明確恢復要求不變。
- 既有watch可能未啟用：先查明能力與生命週期，不為修復新增隱藏連線或背景工作。

## Rollback / Recovery

- 保留既有原文、operation ID及帳本，不清除未決資料、不重播遊戲操作。
- 若需更動持久化狀態，先定義舊版相容與還原測試；無必要不新增資料格式或遷移。
- 修正可按明確檔案範圍撤回；runtime載入前仍用舊版安全界線，未決挑戰不為部署而reload。部署與遊戲續行分開驗收。

## Completion Checklist

- [x] 所有實作任務已完成，或不適用項有具體理由；延遲原因未知時不宣稱修復Telegram服務。
- [x] 執行受影響的Vitest測試（`npm test -- <實際測試路徑>`），記錄實際路徑與結果。
- [x] `npm run build` 通過，並檢查diff、文件連結及授權／安全規則未被放寬。
- [x] 離線驗證與實機驗證分列；若無授權或安全實機條件，明列未驗範圍及交接，不假造實機完成。
- [ ] 使用者確認交付／載入安排；所有條件成立後刪除此計畫，回報刪除路徑與驗證證據。

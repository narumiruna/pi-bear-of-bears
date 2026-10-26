# reload_runtime 正常收尾誤用abort

## 結論與重現

使用者實際呼叫tool後看見 `Error: This operation was aborted`。這不是reload成功應有的提示，也不能由工具的queued回覆推定reload已完成。

`extensions/reload-runtime.ts` 原本在 `turn_end` 呼叫 `ctx.abort()`，但codemode父工具沒有傳遞巢狀tool的終止提示，Agent仍進入下一回合準備。SDK在讀取已取消signal時，產生stopReason=aborted、errorMessage=`This operation was aborted`的assistant訊息；Pi在畫面呈現這筆錯誤。

舊隔離測試只核對reload一次、工具結果已保存及provider callCount=1，沒有檢查assistant錯誤訊息。新增與真實provider／compaction準備一致的signal檢查，再驗收沒有aborted／error訊息後，原兩個有／無Goal案例均失敗，重現完全相同的錯誤；不是吞掉例外或從UI隱藏錯誤。

## 修正

- 移除 `turn_end` 的 `ctx.abort()`；不將正常reload視為取消工作。
- tool回傳 `terminate:true`，command仍使用 `ctx.waitForIdle()` 後才 `ctx.reload()`，不在正在執行的工具批次中替換runtime。成功後不再使用舊pi／ctx。
- 等待reload期間阻擋新的工具請求，阻擋結果以 `terminate:true` 正常結束批次；已開始的工作可以正常保存結果，不主動取消。
- 透過 `runtime:reload-pending` 事件通知Goal；Goal在正常結算時保存paused、不重送契約，不靠abort或三次循環保護。不自動恢復遊戲，不產生完成標記。
- 等待／reload失敗時清除pending並保留真正錯誤，不自動重試。若reload已使舊runtime失效，清理事件失敗也不得覆蓋原錯誤。

## SDK限制

目前Pi SDK的codemode不會轉送nested tool的 `terminate`，所以codemode路線可能多一次正常的模型文字收尾；若模型改呼叫新工具，會在執行前被阻擋。直接啟用並呼叫 `reload_runtime` 的路線不需要這次額外收尾。兩者均不靠abort、都等待idle、都不自動續行Goal。

此修正沒有改動已安裝SDK、取消語意或任意捕捉／隱藏AbortError，也沒有替換全域codemode實作。

## 驗證

- `tests/reload-runtime-integration.test.ts`：真實Pi SDK、真實codemode worker與faux provider，RPC／TUI模式綁定、Goal有／無、直接tool／codemode文字收尾／codemode試圖新增工具，共12個案例。
- 每例確認無assistant aborted／error訊息、agent_settled.aborted=false、reload僅一次且在idle、工具結果與同一對話保存。嘗試後續工具的probe沒有執行；Goal維持paused，沒有契約重送。
- `tests/reload-runtime.test.ts` 保留schema、取消、重複請求、手動command、wait/reload失敗及原錯誤保留；與 `tests/goal-extension.test.ts` 合計三檔51項通過。
- 完整 `npm test`：111檔1747項通過；`npm run build`、本次五個程式／測試檔Biome及 `git diff --check`通過。
- 以上TUI模式是SDK隔離綁定，不等同於目前互動終端的實際UI重測。沒有在目前對話呼叫reload、沒有修改或恢復任何遊戲狀態。

## 部署及復原

目前載入的舊extension仍含abort行為。先由使用者手動執行 `/reload` 載入修正，再另行測試tool；不能用舊tool來證明新修正已生效。工具queued仍僅表示已要求，最終以Pi的reload成功／失敗回覆為準；失敗保留原錯誤，不重送。

已保留的狂戰93層狀態仍是舊觀測。Goal若恢復，必須由使用者明確 `/goal-resume` 並重新核對本人、挑戰及資源，不沿舊盾或歷史帳本直接出手。

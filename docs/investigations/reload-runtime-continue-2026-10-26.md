# Reload 後一次性續行

## 結論

`reload_runtime`／`/reload-runtime` 現在會在成功 reload 後，由新 runtime 送出一次 `continue`。目前 coding 驗收通過；尚未在本互動 session 部署／實測，不代表遊戲狀態已刷新或已續攻94層。首次載入新版仍須 `/reload`；舊版沒有一次性交接能力。

## 原因與修正

原先正常收尾可避免 abort，但 reload 後無新訊息啟動 Agent；Goal 也只從歷史還原為 paused。

- `src/runtime-reload-handoff.ts`：process 記憶體的一次性 ticket，以 session ID 與分支錨點綁定；只有本次 command 能建立，不以歷史 session entry 自啟動，不落盤。
- `extensions/reload-runtime.ts`：idle 後建立 ticket，新 runtime 在 `session_start(reason=reload)` 先 consume，只登記非阻塞 callback；完整 `ctx.reload()` 成功返回才完成 ticket。不能在 session_start await ticket，否則死鎖。舊 runtime 之後只操作 plain ticket／本地取消旗標，不再使用舊 API。
- `extensions/goal.ts`：僅恢復本次 reload 前 active、仍為同 ID paused 的 Goal；由該 `continue` 啟動單一新回合，不另送契約 turn。既有 paused／stopped／completed Goal 不啟用，`continue` 只續行最新使用者工作。
- 取消、切換 session／分支、新使用者輸入、Goal 在等待期間停止／更換、reload 失敗或新 runtime 非閒置時不續行；普通 `/reload`／啟動沒有 ticket 不續行。同步派送失敗通知 Goal 回到 paused，不重試不明結果。

續行訊息明示重新核對身分、資源與操作資格；不恢復舊盾、舊快照或重送不明遊戲操作。本次未使用 Telegram 工具。

## 驗證

2026-10-26，離線 SDK／faux provider：

- `tests/reload-runtime-integration.test.ts`：12 個 TUI／RPC、Goal／一般工作、直接 tool／codemode、新工具被阻擋組合，確認舊工作正常 settled、無 aborted/error、新 runtime 一則 continue、同 session 與對話保留。Goal 接續後仍會被既有三次空轉保護暫停。
- `tests/reload-runtime.test.ts`：只在完整 reload 成功後派送、不碰失效舊 API、重複 session_start 不重送、失敗／取消／新輸入／不同 session／分支／非閒置／Goal 變動不續行，以及被動 Goal 不被啟用。
- `tests/goal-extension.test.ts`：同 ID 恢復、停止／完成／不同 ID 不恢復、交接 handler 不清零循環計數、派送失敗保留停止狀態。共用測試 harness 移至 `tests/fixtures/goal-extension.ts`。
- 全量 `npm test`：113 檔、1814 項通過。
- `npm run build`、本次7個 TS 檔 Biome 與 `git diff --check` 通過。

首次正式載入、真模型續行與遊戲內實機驗收未執行；不將上述離線結果當成已部署證明。工作樹其他既有遊戲修正保留，未提交或回滾。

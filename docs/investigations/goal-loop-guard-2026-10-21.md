# 2026-10-21：Goal 無工具回覆循環的 runtime 斷路器

## 問題與範圍

使用者明確要求「如果進入無限循環 就改進」，並補充可提升狂戰熊本人的圖鑑覆蓋率。先修復續行流程，再獨立核驗新候選；不以 coding 或圖鑑數量替代星塔95驗收。

實際對話連續出現「未找到安全操作／續行決策失敗／95未完成」的改寫，沒有新操作。舊 `extensions/goal.ts` 在未見完成標記時無條件追加相同契約並要求下一次模型請求；先前提示回歸只能證明字串有注入，不能限制這個 runtime 循環。

## 修正

- 連續3次可由 Goal 決定的 `agent_before_settle` 沒有成功 `tool_execution_end`，或3次最終文字相同（只正規化空白），保存 `paused` 並停止本 extension 重送契約。目標仍未完成，不標記 completed／stopped。
- 以成功工具事件重設無工具計數，包含 nested calls；開始事件、執行錯誤與結果 `isError` 不重設。工具活動不代表遊戲成功或驗收進展，既有安全規則不變。
- 相同回覆的 SHA-256 只留在記憶體，不持久化回覆全文；換句話但沒有工具仍會被無工具計數攔住。
- 明確恢復、新目標、分支還原及 shutdown 清除偵測記憶。計數跨 Agent 啟動保留；`before_agent_start` 不清零，避免外部重送契約時每輪歸零。原修正在此 hook 清零的漏洞及回歸見下節。
- 先判斷完成標記、取消／錯誤及其他待送工作。保留前置 extension 的 `event.entries`；只略過尾端 custom 訊息找最終回覆，不跨 user 或 toolResult 接受舊完成標記。
- 不新增模型可用暫停 tool、timer、背景工作或自動重試；Agent 自行輸出的 pause／blocked 標記仍無效。斷路後須先改善決策，再明確 `/goal-resume`。

## 回歸與驗證

1. 以實際三種無進展回覆重現：新測試修改前5項失敗，舊19項通過。
2. 加入有／無UI、相同回覆夾工具、nested成功、錯誤不重設、恢復／新工作／分支計數、完成與待送工作優先等案例；另驗20輪不同回覆且有工具活動不因總回合數而停止。
3. 獨立審查發現前置 extension custom 訊息遮蔽回覆，以及 boundary entries 被替換丟失；新增回歸修改前失敗，修正後通過。保留不跨 user／toolResult 誤收舊完成標記的測試。
4. 最終 `npm test`：73檔1,264項通過；`npm run build` 通過；`npx biome check` 與 `git diff --check` 通過。僅見既有 Node localStorage 實驗警告。

## 10:36：跨 Agent 啟動的重複訊息保護

使用者要求「若重複送出一樣的訊息三次則停下來」。現有相同最終回覆計數已支援忽略空白、成功工具不清零，但 `before_agent_start` 無條件 `resetGuard()`，使每次重新啟動 Agent 的重送路徑無法累計三次。這是離線可重現的漏洞，不據此宣稱先前實際 session 必定走此路徑或已載入新碼。

- 移除該 hook 的清零；仍由新目標、明確 `/goal-resume`、session 還原／關閉重設。第三次相同回覆保存 `paused`，停止本 extension 自動續送，保留未完成目標；不取消其他操作或宣告完成。
- 新增每次都先觸發 `before_agent_start` 的有／無UI回歸：成功工具夾在同樣回覆間仍第三次停止；後續啟動不再注入契約、恢復後重新計數。另驗不同文字且無工具的跨啟動計數不清零。
- 修改前新增3項均失敗，既有28項通過；將原同回覆測試合併至覆蓋更完整的跨啟動案例後，Goal 測試30項。全套73檔1,266項、`npm run build`、兩檔 Biome 與 `git diff --check` 均通過。未 reload 或執行遊戲。

## 限制與載入

這不是語意進展偵測器：不同回覆夾有成功工具的無效研究仍可能漏判；相同文字的有效工作可能保守觸發。不能用無目的查詢規避保護，也不能因工具成功就降低戰鬥／費用證據要求。

已核對 Pi 文件及安裝版本的 lifecycle／boundary declarations 與 runtime 實作；測試使用隔離 hook harness，未透過真實模型實測。修改尚未 reload，不宣稱本 session 已啟用新斷路器；reload 後既有 active 按原規則還原為 paused，不會自行恢復遊戲。無新增遊戲勝場或通層證據。

# Reload 與外部 Goal 續行衝突

## 根因與範圍

2026-11-09 查核時，工具已可正常執行，使用者已停用 Goal；本次只修復程式，未操作 Telegram。

舊版 `extensions/reload-runtime.ts` 從 tool 立即派送 command，再以 `waitForIdle()` 等待工作清空。等待期間持續攔截所有工具。新輸入只設 `cancelled`，卻沒有解除 `pending`，也沒有在等待結束後停止已取消的 reload。

本專案 `extensions/goal.ts` 會接收 `runtime:reload-pending`，但套件預設未載入它。實際安裝的外部 `@narumitw/pi-goal` 在 `agent_settled` 派送續行，不接收該私有事件。既有整合測試使用的是本專案 Goal，無法覆蓋這種競爭。持續續行與等待 idle 因此可能互相阻礙；這解釋了工具反覆被攔截，但未逐筆重播歷史數千回合。

## 修正

- Tool 只保存請求，依官方範例於 `agent_settled` 派送 command，不加 `deliverAs`。
- 新的人類或 extension 輸入取消未完成請求並立即解除工具封鎖；不等待 Goal 自願配合私有事件。
- Settled 已有待送訊息時取消請求；內部 command 帶 generation token，拒絕已失效的派送。
- 等待 idle 後重新確認取消狀態；取消後不得 reload 新工作。
- 派送同步失敗解除封鎖；取消不自動重試，不 abort，不自動恢復已停止 Goal。
- 保留本專案 Goal 的既有一次性交接，於 tool 請求時保存原始身分，避免結算暫停後遺失 active 來源。

## 驗證

- 用有界的外部 Goal 替身在真實 Pi SDK 的 settled 邊界派送續行，不接收私有 reload 事件，測試兩種 extension 註冊順序。
- 相同新增測試套用 `HEAD` 舊版時，兩案均失敗：新工作的 probe 工具執行次數為 0；測試能自行收尾，不靠 timeout 才判定失敗。臨時重現檔已移除。
- 修正後兩案通過：外部續行先到則取消 reload、probe 可執行；reload 先到則完成一次 reload，新工作仍可執行。
- 單元測試涵蓋三種 input source、取消過期 command、等待 idle 中取消、pending messages、同步派送失敗；既有 codemode、載入失敗與 Goal 停止案例保留。
- `npm test`：121 檔、1949 項通過。
- `npm run build`、變更程式的 Biome 檢查及 `git diff --check` 通過。Biome 另提示既有 schema 2.5.12 與 CLI 2.6.4 版本不同；未擴大修改設定。

## 限制與部署

外部 Goal 不接受本專案的一次性交接，不保證跨 extension 的原子排程。Reload 先完成時，其一次 continue 可能先於競爭輸入；測試限制額外請求數，不宣稱所有來源合併成單一回合。需要確定執行 reload 時，先由使用者暫停外部 Goal，再執行 `/reload-runtime`，不要反覆重試。

2026-11-09 12:13（Asia/Taipei）現場確認：收到 reload 完成後的一次自動續行，新 `reload_runtime` 描述已包含「新的使用者或 extension 輸入會取消未完成請求並解除工具封鎖」；隨後 codemode 內的 read、bash 均成功，`git diff --check` 通過。確認修正版已載入且工具可用；遊戲 Goal 維持停用，未操作 Telegram。現場未重新啟動外部 Goal 製造衝突，競爭與取消路徑的驗證範圍仍是上述隔離 SDK 回歸測試。

# Workflow 回覆觀測時間調查（2026-10-21）

## 結論與限制

目前原碼沒有將請求開始時間寫入 workflow `observedAt`。實際 extension 的離線回歸確認，`observedAt` 在非同步回覆完成後才取 `Date.now()`；不應再移動時間戳或加入 clock tolerance。

兩筆回報的日期在各自 `observedAt` 之後 786 ms、595 ms。在檢查時本機時間仍早於訊息日期的條件下，現有嚴格 future-date guard 足以重現「只確認 status 後 stopped」，不需要任何未知後續訊息。這是已重現的充分條件，不是原次現場原因的完整證明。缺少現場檢查時刻與載入版本，不能判定為時鐘偏差、系統校時或舊 runtime，也不能宣稱已修復流程停止。

本次新增離線回歸與本調查；未改 production source，保留 actor、epoch、revision、barrier 與 future-date 檢查。沒有合理依據將原停止改成 `ready`。

## 回報證據與最小案例

來源為本次 coding 任務提供的觀測摘要，不是此子工作自行取得的 Telegram 原文。以下時間皆為 Unix 時間；顯示時間採 UTC。

| Tool | 訊息 ID | `date`（秒） | `observedAt`（毫秒） | `date × 1000 - observedAt` |
| --- | --- | --- | --- | --- |
| `bears_tower_entry_check` | 770689 | 1792519131 | 1792519130214 | 786 ms |
| `bears_move_to` | 770695 | 1792519168 | 1792519167405 | 595 ms |

- 770689：訊息日期 `2026-10-20T17:58:51.000Z`；觀測時間 `2026-10-20T17:58:50.214Z`。
- 770695：訊息日期 `2026-10-20T17:59:28.000Z`；觀測時間 `2026-10-20T17:59:27.405Z`。
- 回報角色為 `なるみ_大德熊`；後續六則 history 僅有 switch、stopidle、status，後來 snapshot 將原 status 標為 fresh。
- 子工作未取得原始 status 文字、Telegram revision、六則 history 全文、呼叫開始／接收／檢查時間與現場載入程式指紋。測試只使用回報的 ID／date／observedAt；狀態內容與 revision 明示為合成資料。
- 主線補核：新 `bears_history` source `bcc424ef-6fab-4b2e-bcb8-e2c43312669b` 完整包含770684–689，最後689確為大德本人滿2175／1356、56248282G、觀測者之徑；revision為`6d79347bacf646f5d21059b8cbea741314c2139424e9f9f84e307954c12491ea`，沒有插入的後續活動。這補足689原生內容，但仍沒有原停止檢查時刻或現場runtime指紋，不能單獨確定根因。主線操作與收尾見[2026-10-21 01:58–02:01紀錄](../notes/2026-10.md#2026-10-21-0158-free-tower-druid)。

## 資料流查證

1. [`extensions/bears.ts`](../../extensions/bears.ts) 的 `sendCommand()` 先保存 equipment／workflow generation，再 `await game.act()`，最後才呼叫 `observedResult()`。呼叫前沒有保存 observation timestamp。
2. [`src/game.ts`](../../src/game.ts) 的 `act()` 依序取得操作前 history、執行 dispatch check、送出指令、取得回覆 history，再回傳 changes。此流程既有的接收等待未在本次新增或延長。
3. `observedResult()` 呼叫 [`WorkflowObservations.observe()`](../../src/workflow-observations.ts)。新訊息的 `source.observedAt` 直接取當下 `Date.now()`。相同 message ID／revision 再次觀測不刷新此值。
4. [`src/telegram.ts`](../../src/telegram.ts) 的 snapshot 直接保留 Telegram `message.date`，沒有以請求開始時間計算日期。
5. [`src/workflow-runner.ts`](../../src/workflow-runner.ts) 的 `step()` 保存 `startedAt = floor(Date.now() / 1000)`，只用來排除請求前的回覆；沒有傳入 observation store。`status()` 能解析回覆後，仍須由 store 再驗來源與新鮮度。
6. `WorkflowObservations.latest()` 先核對 actor、epoch、barrier，再以目前 `Date.now() - message.date × 1000` 計算 age。age 小於零、超過 60,000 ms 或目前時間早於 `observedAt` 時不提供 status。
7. `WorkflowRunner.status()` 在 store 不提供有效 status 時，回報「本人狀態之後有未核對活動或來源不符。」。此文字涵蓋多種失效，不足以證明一定存在未知後續活動。

此處是分支內記憶體觀測，不是 HTTP cache。資料以 message ID 保存並核對 revision；重新讀取 history 或建立 snapshot 不延長 status 的 60,000 ms 時效。觀測日期從未來變成有效日期，可以解釋後來 snapshot 為 fresh，但這個現象本身不能證明是哪一端時鐘或 runtime 出問題。

## 離線回歸

新增 [`tests/workflow-observation-timing.test.ts`](../../tests/workflow-observation-timing.test.ts)，透過實際 bears extension／Game／workflow tools 與 mock transport 執行四個案例。沒有載入真實 Telegram transport、憑證或 session；`WorldMap.allRooms()` 也以本機資料替代，不存取公開網站。

1. 對兩個 tool 各使用 promise 暫掛 mock send。在請求開始與回覆完成之間調整測試時鐘，確認來源 `observedAt` 等於回覆完成後時間，不等於請求開始時間。
2. 回覆完成時已達訊息日期：tower entry check 為 `ready`；move-to 同一已確認房間為 `confirmed`，只查 status／look，不步行或改變遊戲狀態。
3. 回覆完成時使用回報的兩組較早時間：兩個 tool 都只確認 status 後 `stopped`；未送 tower／look、未重送 status。
4. 未改測試時鐘前再查相同 history，仍不能建立有效 snapshot。只將測試時鐘設定到訊息日期後，相同 status 可綁定本人，且原 `observedAt` 不變。這是直接設定 mock clock，沒有等待、sleep、輪詢或遊戲續行建議。

檢查結果：

- `npm test -- tests/workflow-observation-timing.test.ts tests/workflow-integration.test.ts`：2 檔、10 項通過。
- `npm test -- tests/workflow tests/game.test.ts tests/game-operation.test.ts tests/character-status.test.ts`：21 檔、229 項通過，包含既有 actor／epoch／revision／barrier、取消、dispatch 與過期檢查。
- `npm run build`：通過。
- `biome check tests/workflow-observation-timing.test.ts` 與 `git diff --check`：通過。
- 主線獨立重新執行 `npm run ci`（2026-10-21 02:04 +0800）：Biome檢查通過、72檔／1236項測試通過、build通過。這是離線原碼驗證，不是現場停止原因或遊戲戰果驗收。
- 調查文件相對連結已檢查。子工作未改 skill、使用者紀錄或續行文件；主線另依遊玩程序保存紀錄。未 commit、push 或 reload。

## 仍缺少的現場證據

若要區分真實時鐘問題、載入版本差異或其他失效，需要以下去除憑證的資料；不得以擴大安全容許範圍取代查證。

- 原停止當下的 request start、transport history 完成、store observe 與 `status()` 新鮮度檢查時刻；各點應採同一時間單位並保留訊息 ID／revision／generation／barrier。
- 現場實際載入的 extension 與 source 指紋、最後載入時間，以及是否與本次檢查原碼一致。
- 該時段本機與 Telegram 日期來源的時間基準或系統時鐘校正事件。僅憑亞秒級差距不能斷言偏差來源。
- 原始 status 與同批完整回覆，用來排除同批 revision、角色或未知訊息造成的另一個局部失效。

本次不進行上述現場取證，不修改安全資格，不以測試成功宣稱遊戲目標或原次 runtime 問題已完成。

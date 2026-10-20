# Combat snapshot 的 status 新鮮度診斷（2026-10-20）

## 結論與限制

提供的原生訊息 `769232` 能被現有 parser 正確解析。在離線時鐘設定為訊息時間後 33 秒或恰 60 秒時，combat snapshot 都能辨識 `なるみ_狂戰熊`。沒有重現此原文造成的 parser 缺漏，不修改 parser 或延長新鮮度。

已確認的問題是診斷文字：超過 60 秒後，舊實作與完全沒有原文時一樣回傳「缺少本人新 /status 原文。」，未區分原文過期。修正只改善此診斷，不恢復執行資格，也不回填已過期的 actor、HP／MP 或 snapshot ID。

原回報的 status `date=1792495124`（2026-10-20 19:18:44，UTC+08:00）與 snapshot 約 `1792495157`（19:19:17）僅相差 33 秒。如果這兩個時間精確且同一觀測實例未被重設或失效，不能只用 60 秒時效解釋原失敗。缺少失敗當下精確本機時間、觀測世代與失效事件，原次失敗原因仍未確認，不以推測修改安全邊界。

主 Agent 已於同一 script 內以新訊息 `769244`（`date=1792495192`）執行 `bears_status` 後，緊接的 snapshot 成功解析 actor。這是主線的直接遊戲觀測，不是調查子工作自行呼叫遊戲 tools 的結果。本次全程僅離線測試，未讀取憑證。

## 資料流與時效

1. `extensions/bears.ts` 的 `observedResult()` 將未精簡 `GameMessage` 傳入同實例 `WorkflowObservations.observe()`；`bears_status` 也走此路徑。
2. `src/workflow-parsers.ts` 的 `statusFacts()` 先經 `parseCharacterStatus()` 辨識原生佈局，再解析姓名、HP／MP、金幣、位置及四軸屬性。
3. `src/workflow-observations.ts` 以 message ID 保存記錄與 revision，並以目前角色、epoch、barrier 篩選可用觀測。這是分支內記憶體觀測，不是公開查詢的 HTTP 快取。
4. `status()` 使用 `latest()` 預設 `maxAge=60_000 ms`。新鮮度以訊息 `date × 1000` 計算，恰 60,000 ms 仍有效；再次讀到相同原文或建立新 snapshot 不刷新訊息時間。未來訊息或本機時間早於 `observedAt` 也不能使用。
5. 狀態變更、未知回覆、watch 缺頁、來源 revision 變更與 session／tree 重設，可能使尚未超時的原文失效。新鮮度不是唯一資格條件。

## 精準修正

`src/workflow-combat.ts` 在沒有有效 status 時，另外以無時效上限的 `latest(statusFacts, Infinity)` 查閱診斷來源；此查閱仍保留角色、epoch、barrier 與可信時間檢查。

- 找到過期來源：回報訊息 ID、距訊息時間的毫秒數、60,000 ms 上限及重新取得 `/status` 回覆的要求。
- 找不到可診斷來源：回報缺少新鮮且可綁定原文，可能尚未取得或來源已失效；不斷言原文從未存在。
- 兩條路徑都維持 `needs_observation`、`actor:null`，不建立 snapshot ID 或 planner observation。

未變更目標、技能、休息費用、戰鬥成本或攻擊資格。`tower:null` 或 `freeRest:false` 不是本次已證實的 parser bug。

## 回歸與檢查

原文保存在 [`tests/fixtures/character-status-berserker-769232.txt`](../../tests/fixtures/character-status-berserker-769232.txt)，來源是本次主 Agent 取得的遊戲工具回覆；測試 revision 是 fixture 產生值，不宣稱為 Telegram 原始 revision。

- [`tests/workflow-status-freshness.test.ts`](../../tests/workflow-status-freshness.test.ts)：原文在 0、33、60 秒成功綁定；60,001 ms 後拒絕；新讀到的舊原文不刷新時效；未取得、失效與 reset 不誤報過期。
- [`tests/workflow-integration.test.ts`](../../tests/workflow-integration.test.ts)：以 mock transport 經實際 bears extension 的 `bears_status`→33 秒→`bears_combat_snapshot` 路徑，確認本人數值與原文 source ID；未連線 Telegram。
- 修正前先執行新鮮度回歸：3 項解析／時效測試通過，2 項診斷測試因舊訊息文字不符而失敗，確認修正對象是診斷而非 parser。
- 修正後執行 `npm test -- tests/workflow-status-freshness.test.ts tests/workflow-integration.test.ts tests/workflow-observations.test.ts tests/workflow-snapshot-blocks.test.ts tests/workflow-snapshot-summary.test.ts tests/character-status.test.ts`：6 檔、52 項通過。
- `npm run build`：通過。

以上只證明列出的離線範圍。未獨立重現原次 runtime 失敗，未執行遊戲內驗證，也未驗證原次失敗的實例、時鐘或 watch 事件。

# 重生看板使新鮮本人狀態失效（2026-10-22）

## 結論與範圍

已修共享觀測層的兩個可重現缺口：精確 `/boss_respawn` 未列為查詢，且原生完整單頁未有已知格式辨識。這只避免已核唯讀看板錯誤作廢本人狀態，不刷新狀態時間、不建立目標現身／HP、本人討伐資格或戰鬥安全證明。

**離線通過，未 reload 或實機驗新碼。** 修正未改Telegram連線、重試、等待或任何遊戲授權；不是限流修復，不以重新查存活板或真實戰鬥測試護欄。

## 實證與重現

- 780802：本人劍聖哨站全滿；來源 `fb9bbb29-fb47-48cd-85ff-1671c49c6648`，訊息時間1792628734。
- 780804：唯讀重生板；來源 `1875c873-0dd9-4875-bb26-577fbaeab9ad`，時間1792628767，僅相隔33秒。
- snapshot `238ff402-e004-4439-9118-a6c7e2be6768` 回傳actor=null、unknown_bot_reply失效來源804，而非正常60秒過期。
- [原文回讀紀錄](../context-feedback/2026-10.md#2026-10-22-0833-respawn-status-barrier)確認完整35條、三分組與頁尾，無事件、媒體或按鈕。fixture保存原文ID／revision與公開怪物資料；測試中的本人數值及outgoing明示為合成。

## 修正

- `src/workflow-parsers.ts`：僅新增精確無引數 `/boss_respawn`，不接受附加指令。
- `src/workflow-boss-respawn.ts`：驗同次request、單一文字回覆、可選緊鄰outgoing及時間順序；精確標題、三組20／9／6條、不重複條目、倒數格式與完整頁尾。
- `src/workflow-observations.ts`：與原生 `/boss` 一樣使用專屬格式結果，不因request本身或混入其他已知查詢格式就信任整批。
- 不保留跨呼叫pending；未綁request的首次看板、未知新格式、缺項、分頁、事件混入、media／buttons均保守失效；已保存相同ID／revision的history重讀不刷新本人時間。既有revision、omitted、actor／epoch、非查詢、未來時間及60秒時效護欄不變。

## 驗證

1. 先新增回歸：27項中9項失敗，重現分類與狀態失效；未以付款、移動或攻擊補證。
2. 修正並增加outgoing媒體測試後：新增28項全通過。
3. `npm test`：76檔、1332項全過。
4. `npm run build` 通過；五個變更程式／fixture的指定Biome及 `git diff --check` 通過。
5. runtime仍舊版；下次載入後只用正常必要的唯讀觀測核對，不重播舊導航／戰鬥，不以離線測試宣稱遊戲進展或服務已恢復。

## 問題發現時與後續

問題發現時780802本人在哨站手動全滿、19364671G。修後沒有reload，而是以全新817 look／819 status重新建立導航資格；此流程成功不證新分類已載入。其後五步到荒塚遇限流，最後843全滿、0G步行、未送第六步／未攻猛獁；見[08:37限流](../logs/2026-10.md#2026-10-22-0837-swordmaster-mammoth-navigation-flood)及[目前續行點](../goals/berserker-swordmaster-95-codex-rank-continuation.md)。這不是看板修復失效或Telegram根因已確診的證據，不重送或輪詢。

# Telegram 限流診斷資訊遺失：2026-10-22

## 結論與實機邊界

本輪修正共享 `src/game.ts` 的限流例外診斷：保留 `connect`／`operation` 階段、可辨識的 teleproto RPC 方法名與原始 cause。不新增等待、重試、連線重用或限流豁免，亦不改已送出操作的 outcome unknown 判斷。**這不是限流根因修復；尚未 reload，未實機驗收新訊息。**

## 原始證據與缺口

- 2026-10-22 06:28 +0800，`bears_move_to` 由沼澤木屋往霜風避難所，確認南枯木→西蛙鳴→西枯骨→南荒原哨所→南凍原小徑五步後，以 `Telegram rate limit: wait 3 seconds before any further requests.` 停止。來源 `40f5b878-cb2b-49e0-8579-29cfdf2b75a7`。
- 最後本人 status 779994：劍聖滿2963／398、24043161G、凍原小徑；來源 `a1278939-d572-48b9-b13f-536f56210665`。步驟與 walked 均僅五次 go，沒有第六次 go，未抵達女妖或攻擊。沒有 sleep、輪詢或重送；受限後未再呼叫 Telegram。
- 較早歷史也曾在五步至凍原後限流，但不能由相似位置／步數確診是發送頻率、連線、授權檢查、username resolution 或 GetHistory 限額。本次回覆沒有 RPC 方法或底層 error cause，根因仍未知，不宣稱 cache miss、未授權操作或導航資料錯誤。

### 09:45追加觀測

狂戰新導航流程 `cbb9e242-bc9f-45ae-b5bf-9f5432ca5a36` 也在五步至荒塚後遇同一限流；209最後全滿3040／422、17316106G，只確認五步，沒有第六步送出／成功證據。與06:28、08:37的相似性仍不足以證固定步數限額或特定RPC根因；診斷新碼未reload，沒有用本次舊格式錯誤宣稱新診斷失效或另加重試／等待。限流後未Telegram補查，僅本機原文保存出口。詳[09:45流程與停止點](../logs/2026-10.md#2026-10-22-0945-berserker-mammoth-navigation-flood)。

### 13:04追加觀測

劍聖由中繼導航至裂界之門（`b6831ac1-b638-482f-81be-9ecb5db0a449`），六步東北東東東南 confirmed；782697最後滿2963／398、13453282G、風暴眼緣。最後南移回報 `delivery=unknown`、`complete=false` 與 `Action may have reached the bot`，source `3cfe2bd1-210e-491f-9e04-c8629dfdc80b`，不能斷言沒有送出或已成功。已停止當批，未立即history／等待／重送／補掛。這次六步不支持固定五步限額；仍是舊格式，既有新診斷未reload，不推根因或修改等待策略。下次先history釐清末步，不整批重跑。遊戲明細見[13:04檢查點](../notes/2026-10.md#2026-10-22-1304-dual-five-wins-divine-jiao-armor)。

### 13:29末步結果已釐清

下一批先新history取得782699，確認先前782698南移其實已成功到裂界之門；source `c186ed15-6313-4fde-bb61-d0a2877f95c8`。沒有重送或整批重跑。這是當時 `delivery=unknown` 的新回執，不反改舊工具結果為已知，也不由本批未再限流推根因已修或新診斷已載入。

### 20:21末status受限與舊步驟標籤

狂戰赴凍原小徑的流程 `f934c139-0b6b-4b15-a1a4-f63b37fb81b5` 八步到安全荒原哨所785211後，下一status為delivery unknown、complete false、限流3秒，來源 `83003346-068b-410e-b014-88d500a9c9e7`。未進凍原、未攻王，受限後未Telegram補查／等待／重跑。流程steps的not_dispatched與原文不一致，不能作重送資格；本地runner已有保留查詢送達未知的修正但未reload，本次只新增兩項完整toolResult封裝回歸，未再改分類邏輯。完整76檔1334項、build與指定Biome通過，仍未實機載入驗收；錯誤仍未附RPC／phase，不能推定限流根因。詳[20:21停止點](../logs/2026-10.md#2026-10-22-2021-berserker-navigation-status-flood)。

### 後續正常續行已釐清末status

新history `51732690-0063-4878-97a5-32ad33355c65` 取得785213，證明212status確已送達並回覆荒原哨所全滿。沒有重送或整批重跑；這支持當時保留delivery unknown的必要性，不反改當時結果或宣稱限流根因已修。後續新戰果見[2026-10-22 21:09明細](../notes/2026-10.md#2026-10-22-2109-four-berserker-wins-swordmaster-typhon)。

## 可重現的本地問題

`Game.runUnlocked` 對唯讀操作捕捉帶正數 `seconds` 的錯誤後，只重新建立通用限流文字，丟失原始訊息與 cause。已安裝的 teleproto `RPCBaseErrors._fmtRequest`／`FloodWaitError` 會在訊息尾端附 `(caused by <request.className>)`，因此原本可用的方法定位也會遺失。這是本地資訊遺失，不是依實機缺失的 RPC 方法反推本次限流原因。

新增六個離線回歸先在舊碼失敗：connect／operation 唯讀限流、已送出限流保留不明狀態，以及三種不辨識的診斷文字。模擬訊息依上述已安裝依賴的格式建立，沒有連線 Telegram、讀取登入憑證或嘗試重現限流。

## 變更

- `src/game.ts`：記錄連線與實際操作階段；只從訊息尾端嚴格解析有限長度的 `namespace.Method`，不將整段底層文字加到唯讀限流回覆；保留錯誤 cause。
- `tests/game.test.ts`：驗證方法名／階段／cause、唯讀回覆不新增任意原始診斷，以及 factory／connect／history／send 只執行一次、送出後仍報 outcome unknown。
- 不修改 `TelegramTransport`、導航路線、來源新鮮度、逐筆 guard 或 `floodSleepThreshold: 0`。沒有把根因未知當作新增延遲、放寬護欄或恢復未知操作的依據。

## 驗證與後續

- 舊碼：`npm test -- tests/game.test.ts`，六個新增案例失敗、原23個通過。
- 修正後相關四檔81項通過；完整 `npm test` **75檔1304項通過**。
- `npm run build`、指定兩檔 Biome 與 `git diff --check` 通過。
- 下次正常工作中，服務可用後先新 history 核本人、位置與是否有使用者操作，再沿新出口續行；不從木屋重跑整批。新碼需 reload 才會載入，不用製造限流或真實有價操作驗證診斷。
- 若日後自然取得 RPC／phase 證據，再只針對受影響 API 評估 request 次數、快取或連線生命週期；目前不推定特定原因已確認或已修復。

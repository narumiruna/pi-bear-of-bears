# Codex 請求失敗調查

## 結論

2026-10-14 00:25 的直接失敗來自 Codex 回傳的 `error` stream event，不是 BOSS 工具失敗、Goal 主動停損或 pi-caffeinate 中止請求。Pi 初次請求加五次重試都收到相同類型錯誤，之後 Goal extension 依 retry exhaustion 進入 waiting。

遠端根因仍未確認。現有紀錄只保存一般錯誤文字與 request ID，沒有該事件的原始 error code／payload、HTTP status 或實際 transport。不能直接判定為服務 outage、超限、帳號額度或 opaque context 損壞。

## 已驗證證據

來源為目前 session 的必要 metadata、Pi 1.2.0 已安裝 source 與設定白名單；未讀取憑證、Telegram session、完整私人聊天或發送診斷請求。

| 時間（+0800） | Session entry | 結果 |
| --- | --- | --- |
| 00:23:51.743 | `23a45bcb` | `openai-codex`／`gpt-6.1-sol` 成功產生 bash tool call；input 3,188、cacheRead 187,648、output 4,224，total 195,060。 |
| 00:23:51.804 | `400a2de6` | bash tool result 成功，`isError=false`；toolCallId 與上一 call 完全相符。 |
| 00:23:53.488 | `51eb6497` | 初次 Codex error；沒有 content，usage 全0。 |
| 00:23:57.090 | `2ea3bb3a` | 第一次重試失敗。 |
| 00:24:03.019 | `f6daf85d` | 第二次重試失敗。 |
| 00:24:12.908 | `b80ecafb` | 第三次重試失敗。 |
| 00:24:31.482 | `28118bde` | 第四次重試失敗。 |
| 00:25:05.818 | `6c5f38d6` | 第五次重試失敗；request ID `236d9b67-7f4c-40f5-9a81-31f690468cf3`。 |
| 00:25:05.840 | `d4783cd6` | Goal state 新增 waiting reason：Provider retries exhausted。 |

六次錯誤各有不同 request ID，證明不是同一個錯誤被 UI 重複顯示。`retry.maxRetries=5` 表示初次加五次重試，共六次請求；retry 的 context edits 將失敗 assistant attempts 從模型輸入省略，但保留原始稽核紀錄。

同 session 在00:42–00:43另出現四次同類失敗，00:43:39後再次成功。00:45–00:47同 provider／model 成功處理 total 約210,052至232,456 tokens 的回應，沒有新的 compaction entry 介於原失敗與這些成功之間。這降低「固定 context 長度門檻」或「永久模型不可用」的可能性，但不能排除特定請求內容觸發服務端 bug。

## 各訊息的來源

- Codex provider 的 `mapCodexEvents()` 收到 `type="error"` 時建立 `CodexApiError`，加上 `Codex error:` 前綴；`response.failed` 是另一個分支。此次文字前綴符合前者。
- Provider catch 將錯誤轉成 `stopReason="error"` 與 `errorMessage`。該錯誤類別帶有 code／payload，但此次 persisted assistant message 沒有保存相應 diagnostics。`provider_transport_failure` 的診斷分支不涵蓋一般 `CodexApiError`。
- Pi `agent-session.js` 的 `_prepareRetry()` 依設定執行 exponential backoff，超過五次後不再重試；interactive mode 顯示 `Retry failed after 5 attempts`。
- `@narumitw/pi-goal/src/runtime.ts` 的 `finalizeSettledRecovery()` 在 provider retry exhaustion 後呼叫 `enterGoalWait()` 並顯示該 warning。不是 Agent 呼叫 `goal_wait`，也不是 Goal 已完成。
- `@narumitw/pi-caffeinate/src/caffeinate.ts:119` 在 `agent_end` 釋放 inhibitor，故 `Released pi-caffeinate (agent finished)` 是請求結束後的清理，不是前置失敗原因。

## 排除與限制

- **不是該次 bash 執行失敗**：最後 tool result 成功且 call ID 配對正確。
- **沒有明確 timeout 證據**：最後请求約2.3秒即失敗，provider timeout 設為3,600,000ms；錯誤文字也不是 timeout。
- **沒有明確 context overflow 證據**：目前 model metadata 為272,000 contextWindow，reserveTokens 32,768，普通門檻239,232；最後成功請求 total195,060，後續更長請求仍成功。模型 metadata／設定是目前觀測，不保證遠端服務的實際限制完全相同。
- **没有明确401／quota／429證據**：錯誤沒有這些分類，不能宣稱已查明認證或額度狀態。
- **usage0不代表服務沒有執行或一定沒有計費**：只代表這些失敗回應沒有提供可用 usage。
- 同 session 22:57 曾有獨立 `WebSocket closed 1008` 及 transport diagnostic，不能把較早的 transport failure 當成本次00:25 generic Codex error 的直接原因。

## 後續處理

1. 目前同 model 已能成功回應，不必立即更改帳號、增加重試次數或重送遊戲操作。
2. 若再次出現，保存錯誤時間、request ID，以及去敏的 error code、實際 transport、是否使用 previous_response_id、request bytes／估計 tokens；不保存 Authorization、完整 request body 或 opaque reasoning 內容。
3. 若持續失敗，可用短的新 session 或暫時 SSE 做對照，區分特定 context／cached transport 與一般服務問題；這些只是診斷方法，不是已證實修復。本次未更改 transport／compaction／retry 設定。
4. 精確遠端原因需服務方依上述 request ID 查 server logs。現有本地證據不足，不修改 retry／Goal source 來假裝已修復。

本次僅新增此調查文件；未更動遊戲狀態、Goal 狀態、憑證或既有工作中的其他變更。

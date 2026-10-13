# Codex request、context 與 transport 續查

## 最新結論

**目前不支持「pi-goal 產生固定錯誤的 prompt／tool 結構」作為根因。** 離線重建多組請求，失敗與稍後成功的 retry 具有相同 request body；套用 project scope Goal hook 與 Bears context hook 後仍相同。

更正前一輪的重要錯誤：此前查的是 user scope pi-goal `0.54.4`，但此專案配置的是 **project scope `0.54.11`**，已包含所討論的 prefix 修正，且安裝時間早於事發 session。不能把另一個 pane 當成已知載入舊版，亦撤回以升級修復此事的建議。

仍需區分：pi-goal 的普通輸入喚醒／自動續行會讓錯誤反覆出現；provider 間歇拒絕請求的內部原因則未查明。先前的「server overloaded」證據仍有效，但不證明所有 processing error 都只有這個原因。

## Scope 與版本證據

- `.pi/settings.json` 配置 `npm:@narumitw/pi-goal`，檔案最後修改時間為 2026-09-25。
- `.pi/npm/node_modules/@narumitw/pi-goal/package.json`：`0.54.11`。
- project package manifest 與 entrypoint 的 birth／modified 時間：2026-10-12 17:40:03，UTC+08:00。
- 原 session 啟動：2026-10-13 12:50:41，UTC+08:00。
- user scope `~/.pi/agent/npm/node_modules/@narumitw/pi-goal/package.json`：`0.54.4`；目前 user settings 沒有 pi-goal package declaration。
- Pi package scope 規則以 project declaration 取代同名 personal package。以上支持此專案應使用 project scope，而不是 user scope 的殘留安裝。
- 尚未取得另一個 process 的完整載入模組清單；磁碟安裝版本與配置不是直接的 process memory 證據。不得反過來把缺少該清單當成使用舊版的證據。
- session 的 compaction 後 Goal contract 已記錄 `details.sentAt`，與新版 deferred-contract 處理所需 metadata 一致。

## 最後的運行觀測

於約 17:03（Asia/Taipei）唯讀查看 Herdr `w6A:p1`：

- `/goal resume` 後多次成功 model tool-call 回覆與 processing error 交錯。
- 原始 session 最新成功 assistant entry `f89dd745`：16:34:58.250，usage `214291` tokens，tool name `bears_history`。
- 隨後 6 筆 error，最後 entry `0a6fd4b1`：16:36:18.688，request ID `63e6a0ea-df8d-4d47-b980-fdc09b011af3`。
- 16:36:18.706 的最後 entry `a02698d6` 保存 provider-retry waiting。
- Herdr 最後觀測畫面亦顯示 waiting；沒有在本次研究中重新喚醒它。

以上只核對 agent／provider 流程，不把畫面中的工具呼叫當成已確認遊戲收益或成功操作。

## 離線重建方法

使用已安裝 pi 的唯讀函式，不呼叫會遷移或保存 session 的 `SessionManager.open`：

1. 讀取指定 conversation JSONL，使用各 assistant attempt 的 parent ID 作為歷史 checkpoint。
2. 用 `buildSessionContext(entries, parentId)` 套用原始 branch、compaction 與 `context_edit`。
3. 從該 checkpoint 祖先找出當時 Goal state。
4. 用 project scope `0.54.11` 的 `reconcileGoalContextContract`，以及本專案 `extensions/compact-context.ts` 的 context hook 轉換。
5. 用 `convertToLlm` 與 pi-ai Codex adapter 的 `onPayload` 擷取建好的 request body；立刻拋出離線 sentinel，阻止送出。
6. 使用人造、不可用的 test account token，只供 adapter 本機欄位解析。覆寫 fetch／WebSocket 為拒絕網路操作；assert network call count 為 0。
7. 只輸出大小、hash、型別數量與結構檢查結果，不保存或顯示完整 prompt、encrypted reasoning、headers 或憑證。

第一次只重建 canonical projection；第二次另套用 Goal 與 Bears context hooks。兩種 hook 的順序在所有選取 checkpoints 產生相同結果。第二次實際改寫 149–159 個 message，故以下數據採第二次，不把 canonical 數據冒充完整 hook 處理後的結果。

尚未重播每個 extension 的完整 process 狀態、provider hook、account 選擇或 transport cache。因此這是**依持久紀錄重建的 full body**，不是當時實際 wire payload，亦不證明當時的 WebSocket delta 相同。

## 重建結果

以下為套用 project Goal 與 Bears context hooks 後的結果。Hash 是 SHA-256 前 16 字元；request 使用固定的 offline session ID，因此不能用 hash 與未知的 live session request 直接比對。

| 原始 assistant attempts | 歷史結果 | 重建 body bytes | input items | body hash |
|---|---|---:|---:|---|
| `011e1f6c`、`37a8fee1` | 兩筆 error | 1,068,392 | 449 | `87b3684ac06fab14` |
| `a17377ad`、`02e98818`、`d8051869`、`88b4a4c7` | 3 次 error 後成功 tool call | 1,072,218 | 452 | `4dc5f1242afa9307` |
| `97ac412f`、`39887f7e`、`41984f3a`、`a9a2ee35` | resume 後 3 次 error，再成功 tool call | 1,090,612 | 458 | `4b2a812e213324c8` |
| `9859197f`、`0a6fd4b1` | 最後一批的初次與最後 error | 1,151,797 | 477 | `fcb187c54a6ed178` |

共同結構檢查：

- 每個 checkpoint 的 instructions hash 相同，tools hash 相同。
- 每個 checkpoint 實際保留 **1 筆 Goal contract**；不是原始 branch 內的 3 筆全部送出。
- orphan tool outputs：0；duplicate tool call IDs：0。
- 失敗 attempt 被 `context_edit` 排除，沒有在 retry 中持續累加錯誤文字。
- Goal hook 對 deferred contract 做位置修復，但在同一組失敗／成功 retry 中結果穩定。

因此，確定性 prompt 格式錯誤、每次 retry 都改變 instructions／tools、累加重複 Goal contract 等解釋，都缺乏支持。不能排除某些後端路由對同一請求有不同處理行為。

## Context 大小與 compaction

最後重建 body 的主要內容大小（逐 item JSON bytes，不含外層欄位與分隔符）：

- reasoning items：557,832 bytes。
- function-call outputs：481,176 bytes。
- function calls：54,740 bytes。
- user items 合計：31,791 bytes，包含 summary、Goal、普通輸入等，不等於 Goal prompt 本身。

這表示 serialized body 主要由 reasoning replay 與工具歷史構成，不是 Goal continuation 的 3.4K characters。

目前 catalog 對 `gpt-6.1-sol` 設定 `contextWindow: 272000`；目前 compaction reserve 為 `32768`，名目 threshold 為 `239232`。最新成功 usage 約 214K，尚不足以證明 context overflow。這些是目前設定與 catalog；usage 也不是 provider 對每筆失敗請求的 token 計數。

最後兩次 compaction 在 13:08 與 13:42，都是 `fromHook: false`，details 只有 read／modified file lists。沒有 opaque Codex checkpoint metadata，不支持將這批 error 歸因於 `pi-codex-compact` 的 checkpoint rewrite。

目前 `pi-usage` settings 沒有啟用 `codexFastMode`，其 default 是 false；session 也沒有 progress-state 類 custom entries。這縮小了其他 hook 的可能範圍，但不是 live process 狀態的完整證明。

## Transport：已知與未知

原 session 在 13:54:50 有一筆 `provider_transport_failure`：

- `WebSocket closed 1000`。
- `configuredTransport: auto`。
- `eventsEmitted: true`。
- `requestBytes: 595155`。

在對應 adapter source：

- `recordWebSocketFailure` 會把該 session 標記為 SSE fallback。
- 此錯誤即使發生在 stream 開始後，也會先標記 fallback，再拋出錯誤；下一次請求可走 SSE。
- fallback 記憶體狀態可能因 process／extension runtime 重建而消失；不能單靠舊 diagnostic 宣稱 15:00 或 16:30 一定仍使用 SSE。
- `CodexApiError` 屬於 non-transport error，不會由這條分支自動觸發 SSE fallback。
- WebSocket 的 cached delta 只有 body 非 input 欄位相同、且完整 input prefix 精確相同時才使用。
- WebSocket error 會清除 cached continuation 並關閉連線，不是無條件拿同一個 `previous_response_id` 重試。

所以「強制 SSE」可以是受控診斷項目，**但目前它可能早已 fallback 至 SSE**，不能當成已知修復。現在缺少出錯當下的 transport／delta／provider error code，這是最直接的證據缺口。

## 後續有效驗證

1. 優先捕捉同一個故障 session 下一筆請求的去敏感化 metadata：實際 transport、full／delta、request bytes、body hash、provider error type／code／request ID；不記錄 credentials、headers、完整 context 或 encrypted reasoning。
2. 若需要 live 對照，應用不執行遊戲工具的獨立測試，固定 model、retained context、tools 與 request options，只改 transport；原 session 與短 session 同時一成一敗不是這種對照。
3. 若 actual transport 已是 SSE，再測試縮短 context，而不是反覆切 SSE 或執行 resume。
4. 只做 bounded、可核驗的測試；遇到明確 provider 拒絕即停止該 live 測試，不用 polling、額外 Goal loop 或 repeated gameplay 驗證。

本次尚未執行 live 對照，也未修改任何 extension、provider 設定、帳號、pane 或遊戲狀態；結論不宣稱已找出 OpenAI 內部根因。

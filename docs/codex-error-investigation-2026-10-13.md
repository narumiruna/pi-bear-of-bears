# Codex processing error 調查

## 結論

2026-10-13 約 15:00–15:02（Asia/Taipei），`openai-codex / gpt-6.1-sol` 的回覆串流傳回 provider error。同一輪初次失敗明確指出 `Our servers are currently overloaded`，後續 5 次 retry 均回覆一般 processing error。**最有證據支持的解釋是 provider 暫時過載或內部處理故障**；不能證明每一筆一般錯誤都具有相同內部根因。

`pi-caffeinate` 的啟停通知是 agent lifecycle 的結果，不是這些 Codex error 的來源。Goal 在 retry 用盡後保存等待狀態，沒有宣告任務完成。

## 原始證據

- 查閱時間：2026-10-13，Asia/Taipei。
- 來源：本機 pi conversation session JSONL；不是 Telegram session。
- 檔案：`~/.pi/agent/sessions/--Users-narumi-src-pi-bear-of-bears--/2026-10-13T04-50-41-338Z_01a13399-3638-7496-a174-48566348796b.jsonl`。
- 沒有讀取憑證、`auth.json` 或 Telegram session；只擷取錯誤、usage、時間與 lifecycle metadata。

以下起始時間取自 `pi-stamp.data.timestamp`，結束時間取自 message entry timestamp，時區皆為 UTC+08:00。

| 次序 | 請求起始 | 回覆結束 | 結果／request ID |
|---|---|---|---|
| 初次 | 15:00:36.247 | 15:00:39.333 | `Our servers are currently overloaded` |
| retry 1 | 15:00:41.382 | 15:00:44.244 | `2a03987e-9b9d-42a5-9659-4313236e00e9` |
| retry 2 | 15:00:48.286 | 15:00:50.796 | `79cd3255-a712-4e24-a757-9d965838a87c` |
| retry 3 | 15:00:58.839 | 15:01:00.892 | `991419d9-7777-44f5-bb36-3d2138585c17` |
| retry 4 | 15:01:16.936 | 15:01:20.057 | `378a2b34-d354-4800-9757-1f2219e9fbae` |
| retry 5 | 15:01:52.106 | 15:01:54.473 | `dc2f9df9-c8f0-42d4-9d67-295f938bf571` |

- 六筆回覆均為 `stopReason: error`、空 content、記錄 usage 為 0。
- 最後錯誤 entry ID：`37a8fee1`；request ID `378a2b34…` 的 entry ID：`011e1f6c`。
- `15:01:54.488` 的 `goal-state` entry `3dbd0fd3` 保存 `waiting.reason: Provider retries exhausted…`；原 session 此後沒有其他 entry。
- 貼文中的前兩組時間與 request ID 依原始紀錄相差一筆；原文以 request ID 定位。最後 `15:01:52 / 2.4s` 則與原始紀錄一致。
- 失敗前 `15:00:36.178` 曾成功完成一筆 tool-call 回覆，`totalTokens: 193005`，其中 `cacheRead: 191744`。這支持問題不是持續性的無法連線或 model ID 一律無效，但不能排除特定 payload 或後端路由問題。

## 實作核對

下列路徑是初次調查時的 user scope 安裝版本，不代表 pane 的實際載入版本：pi `1.2.0`、pi-goal `0.54.4`、pi-caffeinate `0.49.11`。後續已確認此專案配置的 project scope pi-goal 為 `0.54.11`，事發前已安裝；不能用 user scope 版本判定此 pane 過舊，詳見 [request 續查](codex-request-investigation-2026-10-13.md)。

### Provider error

`~/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:536–554` 的 `mapCodexEvents` 接到 provider 的 `type: error` event 時，拋出 `CodexApiError` 並加上 `Codex error:`。

因此這個文字是 provider 串流錯誤的包裝，不是 caffeinate 自行產生的錯誤。Session 沒有保留這幾筆的完整原始 error event、HTTP status 或 transport diagnostic，無法進一步判定後端 error code、HTTP 500 或確切使用 SSE／WebSocket。

### Retry

- 目前 `~/.pi/agent/settings.json` 設定 `retry.maxRetries: 5`；project settings 沒有相關覆寫。這與事發時 UI 及六筆請求一致；目前設定不單獨證明歷史設定。
- pi-ai `dist/utils/retry.js:23–90` 將 `overloaded` 與 `you can retry your request` 分類為可重試。
- pi `dist/core/agent-session.js:3060–3100` 保留失敗歷史，但透過 context edit 從送給 model 的投影移除，再執行 exponential backoff。
- 實際間隔符合約 `2 / 4 / 8 / 16 / 32` 秒 backoff；不是連續無間隔重送。
- `Retry failed after 5 attempts` 指 5 次 retry，另有初次請求，共 6 次。最後 request ID 重複出現在摘要，是顯示最後錯誤，不是額外第 7 次請求。
- 目前 provider timeout 設定為 `3600000ms`，這批請求卻在約 2–3 秒收到錯誤；沒有 timeout 訊息，沒有證據支持單純加大 timeout 能處理此事。

### Goal 與 caffeinate

- pi-goal `src/lifecycle.ts:526–543` 保存 provider recovery，取消自己的 continuation，交由 pi 的 recovery 流程處理。
- pi-goal `src/runtime.ts:879–899` 在 settled recovery 時進入等待並顯示 `Goal waiting after provider retries were exhausted`。
- pi-caffeinate `src/caffeinate.ts:111–126` 在 `agent_start` 啟動防休眠，在 `agent_end` 釋放。`Keeping computer awake`／`Released ... (agent finished)` 只是這些事件的通知；`agent finished` 也不表示 Goal 完成。

## 尚不能確定的部分

- 沒有完整 provider event，不能確認一般 processing error 的內部原因。
- 沒有證據把這批錯誤歸因於配額耗盡、登入失效、context overflow 或本機休眠。
- 上下文約 193K tokens 是最後成功回覆的 usage，不是失敗請求的精確大小；長上下文可能影響負載，但未經對照測試，不列為已證實根因。
- 沒有查得事發時 OpenAI 官方事故紀錄；本結論不宣稱平台全面故障。

## Herdr 補充觀測：16:14 左右

使用者指出同時能與本 session 對話，但另一個 pane 不能。依授權透過 Herdr 唯讀檢查，未送 prompt、按鍵或重啟任何 pane。

- Workspace：`w6A`（`pi-bear-of-bears`）；另一個 agent：`w6A:p1`；本 agent：`w6A:p2`。
- 來源：`herdr agent get w6A:p1`、`herdr agent read w6A:p1 --source recent-unwrapped --lines 140`、`herdr pane process-info --pane w6A:p1`、`herdr pane current --current`。
- 另一個 pi process 仍存在，Herdr 與畫面均顯示 working；沒有證據顯示 process 已退出。這個狀態也不證明 provider 請求健康。
- `16:13:38` 的 `hi` 先遇到 `Our servers are currently overloaded`，隨後 `16:13:46` 的 retry 成功回答「Hi，我在…」，usage 為 `193189` tokens。
- 成功後 Goal 自動 continuation #22 進入一般 processing error，畫面時間依序為 `16:13:55`、`16:13:59`、`16:14:06`；request ID 分別為 `2744ef66-cb48-4b13-ba2a-03b0a3187327`、`e631b5ea-390c-44ce-8fc9-0eda3bedfce4`、`a5b4bb17-31bb-434b-99df-1d7479464d83`。
- `16:14:17` 又成功產生 `bears_history` tool call，usage 為 `193940` tokens；接著 `16:14:26`、`16:14:30` 再遇一般 processing error，request ID 為 `450c5587-6161-4999-a193-c8ad6ba398e0`、`1ab6fe45-179d-4040-88f5-cff013f76327`。
- 因此不能描述為另一個 session 完全無法對話；實際是成功與失敗交錯，且 Goal 自動續行讓錯誤持續出現。即使同一個 model／provider，本 session 可用也不保證另一個請求可用，更不支持「平台全面不可用」。
- 長上下文仍是待驗假說；畫面沒有足夠資料證明同時兩邊請求的唯一差異是上下文，也不能把 Goal 本身當成 processing error 根因。

## 建議

1. 恢復服務後用 follow-up 或 `/goal resume` 續行，保留原 Goal 進度；不要用無上限 retry 掩蓋持續故障。
2. 若反覆發生，用新短 session／相同 model 做對照，再比較原 session；若只有長 session 出錯，才進一步檢查上下文或 payload。這是建議，調查未另發付費 model 請求。
3. 若持續失敗，向 OpenAI 提供上表 request ID、時間與時區，請其查後端原因。
4. 後續診斷可保存去敏感化的 error code、request ID、transport 與 HTTP status（若有），不記錄完整 prompt、headers 或憑證。這是改善建議，本次未修改 extension 或設定。

# pi-bear-of-bears

透過 [pi](https://pi.dev) 與你的 Telegram **使用者帳號**，在 [@BearOfBearsBot](https://t.me/BearOfBearsBot) 遊玩萬熊之熊。此套件使用 Teleproto 連接 MTProto，不使用 BotFather token。

- **遊戲工具**：讀取紀錄、傳送指令、操作支援的按鈕，以及查詢公開地圖。
- **即時監看**：將遊戲對話更新帶入 pi，不主動啟動 agent 回合。
- **狀態面板**：在編輯器上方顯示最近觀測到的角色與房間資訊。

> Telegram session 具有帳號存取權限。登入必須由你在自己的終端機完成；不要將憑證、session 內容、驗證碼或密碼貼進 pi 對話。

## 快速開始

需要 Node.js **22.13 以上**，以及支援 `@earendil-works` extension API 的 pi。專案開發依賴使用 pi 0.85.1 系列。

### 1. 安裝與登入

先到 [Telegram Apps](https://my.telegram.org/apps) 取得 **App api_id** 與 **App api_hash**，再親自在終端機執行，不要委託 agent 登入：

```bash
git clone https://github.com/narumiruna/pi-bear-of-bears.git
cd pi-bear-of-bears
npm ci
npm run login
```

依提示輸入 API 憑證、電話號碼、驗證碼，以及啟用兩步驟驗證時所需的密碼。登入會驗證帳號並在本機儲存 session，不會傳送遊戲指令。

### 2. 載入套件

在專案目錄執行：

```bash
pi -e .
```

若 pi 詢問是否信任專案，確認來源後再允許。此方式載入套件宣告的 extensions 與 skill，不會儲存套件安裝設定；其他已設定的 pi 資源仍可能載入。

### 3. 先要求唯讀檢查

```text
/skill:playing-bear-of-bears 先查看我的角色狀態，再建議下一步，暫時不要戰鬥或花錢。
```

授權遊玩時，指定範圍、動作上限與禁止事項，例如：

```text
手動探索附近區域，最多 5 個動作。不要啟動掛機、進 BOSS 房、購買、交易或發公開訊息。
```

## 遊玩與操作界線

此儲存庫僅允許**手動遊玩**：不得啟動或重新啟動掛機，也不得用角色切換、scripts 或背景迴圈間接繞過限制。若觀測到已啟動掛機，應使用 `/stopidle` 停止並結算，確認結果後不再啟動。

| 工具 | 用途 |
| --- | --- |
| `bears_history` | 讀取最多 30 則近期訊息，包含按鈕座標與 revision；以 `beforeId` 取得更早的紀錄。 |
| `bears_send` | 傳送一個純文字遊戲指令，並短暫等待回覆。 |
| `bears_click` | 依 message ID、revision、列與欄重新驗證並操作文字／callback 按鈕。 |
| `bears_world` | 以房間 ID 或文字查詢公開地圖，提供分頁、出口、NPC、安全／BOSS 標記、怪物數量與 BOSS 數值／掉落；不需登入。 |
| `bears_codex` | 查詢 BOSS 掉落機率、裝備屬性、被動、技能及進化費用；`recipes: true` 改查製作配方，不執行製作；不需登入。 |

- 同一帳號不要同時交給多個 agent 操作；agent 正在遊玩時，也不要手動發出遊戲動作。
- 結果不確定時先讀取紀錄，**不要重複提交動作**。回覆可能延遲、被編輯或與本次操作無關。
- 同一 extension instance 會拒絕重疊的 Telegram 工具呼叫；這不是跨程序的帳號鎖。
- 工具操作有 30 秒期限，動作後約等待 1.5 秒觀察更新，操作結束後關閉連線。
- 重新載入不會自動重播動作或啟動背景練等。

## 公開資料查詢

兩個工具只在呼叫時讀取固定 HTTPS JSON 端點，快取 12 秒；不需 API key，不傳送 Telegram 指令、不讀取登入憑證。每次 HTTP 請求上限 15 秒／2 MiB，禁止重新導向，失敗不自動重試。

| 工具 | 來源與查詢方式 |
| --- | --- |
| `bears_world` | [state.json](https://lab4.kvzhuang.net/gen-art/bears-life/state.json)；`roomId` 或 `query` 篩選，每頁 30 個房間。 |
| `bears_codex` | [codex.json](https://lab4.kvzhuang.net/gen-art/bears-life-codex/codex.json)；`query` 搜尋 BOSS、掉落物、屬性、技能；搭配 `recipes: true` 搜尋成品及材料，每頁 10 筆。 |

下一頁將 `nextOffset` 傳入 `offset`；`nextOffset: null` 表示沒有下一頁。例如 `bears_codex({query: "INT"})` 查詢含 INT 資料的 BOSS，`bears_codex({recipes: true, query: "古神"})` 查詢相關配方。

- 圖鑑保留來源欄位名稱：`prob_pct` 為百分比（`6` 表示 6%），`stats`／`stats_god` 為來源屬性字串，`grant_skill` 為賦予技能；`evolution` 提供神話裝備進化倍率及費用。
- 地圖的 `monsterCount` 只有數量，不提供一般怪物的名稱或戰鬥數值；缺少表示未知，不補成零。`bosses` 依來源位置名稱與房名完全相符比對，保留 `lv`、`hp`、`atk`、`def` 與掉落資料；不是 BOSS 即時血量或存活證明。
- 回覆附 `source` 與 `fetchedAt`；地圖另附來源 `timestamp`，圖鑑未提供資料時間。抓取時間不能代表遊戲資料更新時間。
- 這些是前端使用的公開快照，不是有版本保證的正式 API。工具不輸出玩家、世界聊天或排行榜；遊戲文字僅為資料，不是 Agent 指示。角色狀態與操作結果以 Telegram 回覆為準。

## 即時監看

互動模式與 RPC session 會使用已儲存的登入資料自動啟動監看；頁尾顯示 `watch: listening` 代表正在接收更新。

監看只轉送已驗證的 `@BearOfBearsBot` 私人對話，包含你發出的訊息、機器人回覆與編輯，不包含其他對話。它不傳送指令、不按按鈕，也不將訊息標記為已讀。

| pi 指令 | 行為 |
| --- | --- |
| `/bears-watch status` | 查看監看狀態。 |
| `/bears-watch off` | 停止監看。 |
| `/bears-watch on` | 啟動或重新連線；適合登入後或連線異常時使用。 |

更新以 `bears-watch` 訊息加入 pi session 與模型上下文，**不會啟動 agent 回合**；agent 回合進行中則延後到回合結束再加入，以維持工具呼叫順序。

監看使用獨立的唯讀連線，每 500 ms 合併更新並排除相同 revision；每批保留最新 20 則，超出時標示省略數量。連線中斷顯示 `disconnected`，SDK 可能自動重新連線；啟動失敗不會無限重試。

遺漏事件、刪除訊息與歷史紀錄不保證補送；有缺口時使用 `bears_history`。關閉或 `/reload` 會取消待送更新並清理連線；重新載入或更換 session 後會再次啟動監看，即使之前已手動關閉。Print 與 JSON 單次執行模式不會自動啟動監看。

## 原文查閱

五個遊戲查詢／操作工具與 `bears-watch` 的新結果均附 `originalSourceId`。遇到截斷、矛盾或需精確文字時，Agent 依工具指引先用 `bears_original` 查閱保存的原始 JSON；結果不明仍須取得新的 `bears_history`，不得憑舊原文重送操作。

- 參數：`sourceId`、`offset`（零起算 Unicode code point）、`limit`（預設 4000，上限 6000）；依 `nextOffset` 翻頁，串接 `text` 可還原原文。
- 原文存在 session 的工具／watch metadata，不直接送入模型；增加 session 儲存量，但不依賴私人暫存檔。只查目前分支，不讀任意路徑或連線 Telegram。
- 舊版紀錄沒有索引時明確回報找不到；`bears_original` 本身不再精簡，也不產生新原文索引。
- Agent 使用後須依 `AGENTS.md` 在 [`docs/compact-context-feedback.md`](docs/compact-context-feedback.md) 記錄情境、疑問、查閱範圍與結果，供後續改善。

## 模型上下文精簡

套件預設載入 `extensions/compact-context.ts`，在每次模型請求前透過 `context` event 精簡五個 `bears_*` 工具結果（含 `bears_codex`）與 `bears-watch` 更新，不改動原始 session 紀錄、工具顯示或狀態面板。

- 移除 JSON 排版空白、bot 本文的空白行與裝飾分隔線。
- 僅在閃避／連擊／暴擊標籤後接數值百分比時移除圖示，保留 `⚡連鎖技能` 等非屬性文字；另移除掛機圖示及已有等級與百分比的進度條。
- 保留所有欄位、數值、警告、預估註記、指令、message ID、revision、按鈕原文與座標；不刪除敘事或未知符號。
- 使用者訊息、送出的遊戲指令、其他工具與錯誤結果不改寫。JSON 已截斷或無法解析時原樣保留，包含私人暫存檔路徑。

- 以原始文字做 LRU 快取，上限 256 筆、鍵與值合計 2 MiB UTF-8 資料量（不含 JavaScript 物件額外成本）；不依賴訊息物件身分，不跨 extension 實例保存。
- 輸出層遇到超限資料時，先嘗試完整緊密 JSON，再使用保留完整陣列項目的 JSON 預覽；明列 `truncated`、`omittedItems`、`fullOutputPath`。外層警告與原始分頁欄位保留，分頁欄位不代表預覽已涵蓋全部項目。無法安全縮小時回退原本的文字截斷。此輸出層調整也會反映於工具顯示與新 session 紀錄；context hook 本身仍不修改原始紀錄。
- 暫不進行跨訊息去重：相同 bot 訊息的再次觀測仍可能具有時間與操作確認意義，避免改寫歷史造成 prompt cache 失效或遺失證據。

執行 `COMPACT_METRICS=1 npm test -- tests/compact-metrics.test.ts --silent=false` 可比較固定合成 history、battle、world、codex 樣本的原始／JSON minify／本文精簡 token 數，以及有無快取的平均處理時間。採 `gpt-tokenizer` 的 o200k_base 作為離線基準，不代表其他 tokenizer 或實際 provider 計費；不讀取私人聊天或呼叫模型。

已載入整個套件時執行 `/reload`；若原本僅載入個別 extension，重新啟動並使用 `pi -e .`，或額外指定 `-e ./extensions/compact-context.ts`。此 extension 不發出網路請求、不呼叫其他模型，也不執行遊戲操作。實際 token 節省量依內容與 tokenizer 而異。

## 狀態面板

面板顯示的是**最後觀測，不是即時戰鬥狀態**。角色數值、位置與技能可能來自不同訊息；舊的滿血數值不代表現在仍滿血，舊的敵人清單也不代表敵人仍在場。

### 精簡與詳細模式

- **精簡模式**：優先顯示角色、HP／MP、EXP、位置、出口、敵人觀測及技能 MP 費用，上限 24 行。
- **詳細模式**：另外顯示屬性、金幣、完整來源與時間，以及較完整的掛機、任務和技能紀錄，上限 48 行。
- 角色與位置保留各自的觀測時間；角色狀態之後有新活動時，顯示「狀態可能過期」。
- 未標示掛機中的觀測，以及被它取代的較舊掛機回報，在精簡模式隱藏；這不代表已確認目前未掛機。
- 技能名稱與 MP 費用來自按鈕文字，**不代表冷卻已結束或現在可用**。

內容支援 CJK／emoji 寬度與換行；超出行數時顯示截短提示。RPC 使用純文字面板。重新載入後回到精簡模式，不另行持久化角色快取。

### 更新方式

面板啟動時讀取最近 30 則遊戲訊息一次，之後由監看與工具結果更新，不會背景輪詢或主動發送遊戲指令。

| 操作 | 結果 |
| --- | --- |
| agent 未操作時，在 Telegram 手動傳送 `/status` | 向機器人取得新的角色狀態；收到回覆後由監看更新面板。 |
| 在 pi 執行 `/bears-status` 或 `/bears-status refresh` | 只重讀近期紀錄，**不會向 Telegram 傳送 `/status`**。 |
| `/bears-status compact` | 切換精簡模式，不發出網路請求。 |
| `/bears-status full` | 切換詳細模式，不發出網路請求。 |

找不到完整 `/status` 回覆時，請在 Telegram 請求一份。戰鬥與移動訊息不會被用來猜測或覆寫個別角色數值。

### 資料解讀限制

- 保留原回覆的數值與「含掛機預估」等註記，不把掛機收益加進餘額、不累加歷次回報，也不視為已結算獎勵。
- 新位置與舊房間名稱不同時，不沿用舊出口與敵人。
- 任務僅解析支援的新任務／完成通知；不推測未支援的任務選單、掛機結算或冷卻格式。
- 缺少資訊表示未知；沒有技能按鈕不代表技能不可用。

## 設定與登入資料

| 環境變數 | 用途 | 預設值 |
| --- | --- | --- |
| `TELEGRAM_API_ID` | Telegram Apps 的 App api_id | 使用已儲存的憑證。 |
| `TELEGRAM_API_HASH` | Telegram Apps 的 App api_hash | 使用已儲存的憑證。 |
| `BEARS_SESSION_FILE` | session 路徑，建議使用儲存庫外的絕對路徑 | `~/.config/bear-of-bears/session` |

程序環境變數優先於已儲存的憑證，缺少的值才由憑證檔補上；不載入 dotenv 檔案。變更環境變數後須重新啟動 pi。自訂 `BEARS_SESSION_FILE` 時，登入與啟動 pi 都要使用同一路徑。

登入會將 session 與相鄰的 `session.credentials.json` 設為權限 `600`，新建目錄設為 `700`。驗證碼與密碼採遮罩輸入；不儲存電話號碼、驗證碼或兩步驟驗證密碼，也不印出 session 內容。

既有 session 會先驗證再重用，不會直接覆寫；憑證衝突也不會自動覆蓋。監看、面板讀取紀錄或 Telegram 工具開始操作時才讀取憑證；公開地圖不需憑證。

## 安全注意事項

- 固定導向遊戲 bot 只限制本套件工具，**不會縮小 session 本身的帳號權限**，也不限制其他 pi 工具或 extensions；可考慮使用專用帳號。
- 憑證與 session 應存於儲存庫外，備份也須妥善保護。遭到外洩時，到 Telegram「Settings → Devices」撤銷存取；只刪除本機檔案不會撤銷權限。
- 需要重新登入時，先撤銷舊 session，再移除對應的本機 session 檔並執行 `npm run login`。
- URL、付款、驗證、電話與位置按鈕會被封鎖；一般指令與 callback 仍可能花費遊戲資源。購買、交易與 PvP 的授權要求是 agent 行為規範，**不是交易防火牆**。
- 遊戲文字與工具結果會進入模型上下文及 pi session 紀錄。不要在對話中提供機密資料。
- 工具只提供訊息文字、按鈕與是否含媒體的標記，不下載照片或檔案；圖片及不支援的互動請直接使用 Telegram。
- 工具輸出上限為 45 KB／1800 行，完整輸出存於私人暫存目錄；不再需要時可刪除。
- 公開地圖與圖鑑快取 12 秒，後端更新頻率未保證，資料可能過期；路線也可能有遊戲內前置條件。
- 請遵守遊戲自動化規則與 Telegram rate limits。

## 開發與驗證

```bash
npm run ci
```

此指令依序執行 Biome 檢查、Vitest 測試與 TypeScript build。測試使用模擬 transport 與 HTTP 回覆，不需要 Telegram 憑證。

離線測試涵蓋工具請求、取消操作、過期按鈕、設定、輸出限制、監看生命週期、角色解析與面板，以及 pi 資源載入。這些測試不能取代真實帳號的端對端驗證；手動遊玩觀測記錄於 [field-notes.md](skills/playing-bear-of-bears/field-notes.md)，不代表目前遊戲狀態。

| 路徑 | 職責 |
| --- | --- |
| `extensions/bears.ts` | 遊戲工具與監看整合。 |
| `extensions/character-status.ts` | 狀態面板生命週期與指令。 |
| `extensions/compact-context.ts` | 模型請求前的非破壞性遊戲內容精簡。 |
| `src/` | 登入、設定、Telegram 連線、操作協調、地圖查詢與狀態解析／呈現。 |
| `tests/` | 離線測試與測試資料。 |
| `skills/playing-bear-of-bears/SKILL.md` | 有範圍限制、依觀測證據操作的遊玩流程。 |
| `AGENTS.md` | 文件語言與手動遊玩的儲存庫規範。 |

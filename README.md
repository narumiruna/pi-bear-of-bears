# pi-bear-of-bears

透過 [pi](https://pi.dev) 與你的 Telegram **使用者帳號**，在 [@BearOfBearsBot](https://t.me/BearOfBearsBot) 遊玩萬熊之熊。此套件使用 Teleproto 連接 MTProto，不使用 BotFather token。

- **遊戲工具**：讀取紀錄、傳送指令、操作支援的按鈕，以及查詢公開地圖。
- **即時監看**：將遊戲對話更新帶入 pi，不主動啟動 agent 回合。
- **工作狀態面板**：由 LLM 主動維護目前目標、重要進度、阻塞與下一步。
- **Auto Idle**：直接用 `/idle` 或 `/stopidle` 以 rule-based 流程管理所有角色，不呼叫 LLM。

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

### 登入與遊玩使用相同的儲存位置

上述 `npm run login` 與 `pi -e .` 在未設定環境變數時，使用全域的 `~/.pi/agent`。本專案的 `just play` 則固定設定 `PI_CODING_AGENT_DIR=.pi/agent`，使用專案內的目錄，**不會自動讀取全域的登入資料**。

若要使用 `just play`，請在專案根目錄登入到相同位置（需先安裝 [just](https://github.com/casey/just)）：

```bash
PI_CODING_AGENT_DIR=.pi/agent npm run login
just play
```

此時 session 存於 `.pi/agent/bear-of-bears/session`，API 憑證存於相鄰的 `session.credentials.json`。兩者都是敏感資料，不得提交到 Git。

也可以用 `BEARS_SESSION_FILE` 明確指定 session 檔案，讓登入與遊玩共用同一份資料；此設定優先於 `PI_CODING_AGENT_DIR` 決定的 session 位置，且必須使用絕對路徑。例如，讓 `just play` 使用全域位置的 session：

```bash
BEARS_SESSION_FILE="$HOME/.pi/agent/bear-of-bears/session" npm run login
BEARS_SESSION_FILE="$HOME/.pi/agent/bear-of-bears/session" just play
```

這只指定 Telegram session 與相鄰憑證的位置，不會改變 `just play` 的其他 pi 資料目錄。既有登入資料不會因切換設定而自動搬移；更多設定見[設定與登入資料](#設定與登入資料)。

### 3. 先要求唯讀檢查

```text
/skill:playing-bear-of-bears 先查看我的角色狀態，再建議下一步，暫時不要戰鬥或花錢。
```

授權遊玩時，指定範圍、動作上限與禁止事項，例如：

```text
手動探索附近區域，最多 5 個動作。不要啟動掛機、進 BOSS 房、購買、交易或發公開訊息。
```

## 裝備評分策略

未指定策略時，裝備評分預設採 `ATK／DEF／INT／AGI = 1／1／1／1`，也就是四項屬性加總。
這不是職業最佳或實戰效益保證；明確指定的權重優先於職業策略。

```text
/skill:bears-equipment-strategy 根據我的職業與主要技能安排配裝權重，先只查詢與說明，不換裝。
```

[職業配裝 skill](skills/bears-equipment-strategy/SKILL.md) 依已確認的主要屬性選擇啟發式 profile，例如 ATK 主力採 `2／1／1／1`、INT 主力採 `1／1／2／1`。
證據不足或混合流派回退等權重，不從職業名稱猜公式；技能、被動與套裝取捨不會因總分提高而自動忽略。
`bears_optimize_equipment` 讀取同一 extension 的未精簡觀測，不接受使用者或模型提供物品 JSON，也不建立 Telegram 連線。
可要求「幫我抓背包並換上更強裝備」；Agent 依序查 history、`/status`、`/inventory`，取得完整性診斷，必要時補 inspect，再評分與逐件核對。
省略整組 `weights` 使用等權重；自訂範例為 `{ "weights": { "attack": 1, "defense": 1, "intelligence": 2, "agility": 1 } }`，四項必須完整且有限。

目前受限格式：背包會省略物品，inspect 未列屬性與完整技能／被動的語意也尚未全部確認，因此真實觀測可能只得到阻擋，不能宣稱完整背包或真實正向換裝成功。
未支援分頁不會拼湊成完整清單；不把缺少屬性當零，也不從名稱猜部位。
`attributeEvidence` 保留每件物品在背包、inspect 與詞條中的明確數值；相同數值去重，缺項保留，來源衝突拒絕評分，不將詞條與背包總值重複相加。
回覆包含版本、角色與背包來源 message ID／revision／時間、宣告及已列數量、目前穿戴、缺漏與推薦。
換裝、外部活動、分支切換與 reload 使舊觀測失效；背包與角色觀測超過五分鐘拒絕套用，不恢復待送操作。

Agent 自動串接工具，不是 optimizer 內建換裝迴圈：每次換裝前刷新背包並重算，換裝後以新背包／inspect 確認，平手不換、負分不卸裝。
每次最多 6 次 equip 嘗試、10 次狀態變更、40 次查詢與 5 分鐘，採使用者較低上限；這些額度是 Agent 流程規範，不是通用工具的交易防火牆。
結果不明最多讀 history 兩次，仍不明即停止且不重送；取消、死亡、角色改變、速率限制、非預期費用與不完整快照同樣停止。
本流程不購買、製作、強化、販售、銷毀、交易、消耗物品、切換角色或啟動掛機；已在掛機時須先停止並確認結算。
正向配裝的 mock 測試使用明確的合成結構化資料驗證計算與底層操作接口，不將其當成已驗證的 Telegram inspect 協定。

## 遊玩與操作界線

遊戲內掛機可在使用者明確授權的範圍與額度內使用；不得以角色切換、scripts 或背景迴圈繞過授權及遊戲操作限制。單次配裝流程不自行啟動掛機，需先停止並確認結算才能建立穩定配裝觀測。

| 工具 | 用途 |
| --- | --- |
| `bears_history` | 讀取最多 30 則近期訊息，包含按鈕座標與 revision；以 `beforeId` 取得更早的紀錄。 |
| `bears_send` | 傳送一個純文字遊戲指令，並短暫等待回覆。 |
| `bears_click` | 依 message ID、revision、列與欄重新驗證並操作文字／callback 按鈕。 |
| `bears_world` | 以房間 ID 或文字查詢公開地圖，提供分頁、出口、NPC、安全／BOSS 標記、怪物數量與 BOSS 數值／掉落；不需登入。 |
| `bears_codex` | 查詢 BOSS 掉落機率、裝備屬性、被動、技能及進化費用；`recipes: true` 改查製作配方，不執行製作；不需登入。 |
| `start_idle` | 由 Agent 單次啟動所有角色的 rule-based 掛機流程；仍會消耗一次模型回合，優先直接用 `/idle`。 |
| `stop_idle` | 由 Agent 單次停止所有角色掛機；仍會消耗一次模型回合，優先直接用 `/stopidle`。 |

- 同一帳號不要同時交給多個 agent 操作；agent 正在遊玩時，也不要手動發出遊戲動作。
- 結果不確定時先讀取紀錄，**不要重複提交動作**。回覆可能延遲、被編輯或與本次操作無關。
- 同一 extension instance 會拒絕重疊的 Telegram 工具呼叫；這不是跨程序的帳號鎖。
- 工具操作有 30 秒期限，動作後約等待 1.5 秒觀察更新，操作結束後關閉連線。
- 重新載入不會自動重播動作或啟動背景練等。

## Auto Idle：不經 LLM 的多角色掛機

在 Pi 互動介面直接執行：

```text
/idle
/stopidle
```

`/idle` 與 `/stopidle` 是 Pi extension commands，會在送入 Agent 前被攔截，因此不建立模型回合。
在 Telegram 直接輸入同名指令仍是遊戲機器人的單一目前角色操作，兩者不要混淆。
若已在自然語言對話中取得明確授權，Agent 也可單獨呼叫 `start_idle` 或 `stop_idle`；tools 只回傳 compact summary 並要求結束該回合，但仍比直接 slash command 多一次模型用量。

`/idle` 會先載入公開地圖，再查詢 `/chars`，依序處理非目前角色並在最後回到原本角色。
切換到原本掛機中的角色會先結算該角色；extension 依結算後等級選擇起始房間，以 BFS 沿公開出口找出最多 40 步且不進入 BOSS 房的路線，逐步核對移動回覆，最後送出遊戲端 `/idle`。
單一目前角色若已在規則選定房間掛機，則保持原狀，不為重啟而結算。

| 角色等級 | 優先起始房間 | 無非 BOSS 路線時的候選 |
| --- | --- | --- |
| Lv1–7 | 蘑菇迷林 | 無 |
| Lv8–14 | 鮭魚溪 | 蘑菇迷林 |
| Lv15–18 | 螢石廊 | 鮭魚溪 |
| Lv19–23 | 蛙聲澤 | 螢石廊 |
| Lv24–29 | 斷戟原 | 蛙聲澤 |
| Lv30–39 | 龍巢外圍 | 蛙聲澤 |
| Lv40–69 | 虛空邊界 | 龍巢外圍、蛙聲澤 |
| Lv70–89 | 無光谷 | 虛空邊界 |
| Lv90–119 | 星圖廢墟 | 無光谷 |
| Lv120–154 | 凍原小徑 | 星圖廢墟、無光谷 |
| Lv155 以上 | 霜風平原 | 凍原小徑、無光谷 |

此表是保守且可重現的啟發式，不是依裝備、技能與即時 EXP／分鐘證明的全域最佳解。
遊戲端掛機仍會自行遊蕩、避開打不贏的怪，並可能挑戰打得贏的 BOSS。
若公開地圖缺少房間、路線超過 40 步、回覆目的地不符、Telegram rate limit、取消或結果不明，整輪立即停止且不重送。
每輪最多處理 9 個角色、送出 200 個遊戲指令；不換裝、不使用道具、不交易，也不建立 background loop 或在 reload 後續跑。

`/stopidle` 依 `/chars` 的掛機標記切換並結算所有掛機角色，最後恢復原本目前角色。
Auto Idle 執行時會拒絕其他 Telegram 遊戲 tools 交錯操作；watch 仍更新本機狀態，但不把逐步自動操作注入模型上下文，避免抵銷 token 節省。

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

更新以 `bears-watch` 訊息加入 pi session 與模型上下文，**不會啟動 agent 回合**；agent 回合進行中則延後到回合結束再加入，以維持工具呼叫順序。Auto Idle 執行期間例外：watch 仍更新本機觀測，但略過該批自動操作的 context 訊息。

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

## 操作統計

套件預設載入 `extensions/metrics.ts`，被動記錄載入後的七個 `bears_*` 工具呼叫（含 `bears_optimize_equipment`）。
已載入整個套件時使用 `/reload`；只載入個別 extension 時，重新啟動並使用 `pi -e .` 或加上 `-e ./extensions/metrics.ts`。
它不建立 Telegram 連線、不發送遊戲指令、不自動重試，也不修改或封鎖工具呼叫。

| pi 指令 | 用途 |
| --- | --- |
| `/bears-metrics` | 顯示最近 30 天各工具／指令的嘗試次數、結果數、平均耗時與結果分類。 |
| `/bears-metrics 7` | 查看最近 7 天；接受 1–3650 天。 |
| `/bears-metrics mark capability_missed /chat` | 人工標記漏掉已存在的功能，例如誤稱不能查看近期聊天。 |
| `/bears-metrics mark wrong_command /skills` | 人工標記選錯指令；另支援 `wrong_arguments`、`unnecessary_operation`。 |

人工標記的指令可省略，只接受已知指令與固定分類，不接受自由文字。
查詢與標記只在本機執行；回報會加入 pi 對話供之後分析，但不啟動 Agent 回合。
平時的逐次紀錄不注入模型上下文，也不回填既有聊天或 session 歷史。

### 解讀方式

- 指令以允許清單正規化，例如 `北` 歸為 `/go`；未列入清單的指令歸為 `unknown_command`，其他文字歸為 `other_text`。未知不等於錯誤。
- `stale_button`、`unsupported_button`、`overlap_rejected`、`invalid_arguments` 表示觀測到對應工具拒絕；仍需判斷是 Agent 誤用、選單更新或其他原因。
- `rate_limited`、`outcome_unknown`、`no_update_yet` 分開計數，不直接當成誤用；`returned` 與 `updates_observed` 也不代表遊戲操作成功。
- 自動分類只比對固定的工具錯誤特徵及結構化 observation，不判讀玩家／機器人的聊天本文。漏用功能、授權是否足夠、策略是否正確需人工判斷與標記。
- 次數是指定時間區間的 Agent 工具事件頻率，不是 Telegram 實際送達次數。耗時從工具開始事件到結束事件，包含等待／前置處理，不是純網路延遲。
- 不包含 Telegram 手動操作、watch、狀態面板內部讀取，或未被 pi 發出事件的呼叫。程序中止、停用、寫入失敗或查詢時間邊界可能讓嘗試與結果數不一致。

累積一段時間後，優先檢視高頻指令、工具拒絕分類與人工標記，再決定哪些指令值得封裝成結構化 tools；不要把所有錯誤加總成「誤用率」。

### 儲存與隱私

紀錄預設存於 pi agent 目錄下的 `bear-of-bears/metrics/`（通常為 `~/.pi/agent/bear-of-bears/metrics/`），透過 pi 的 `getAgentDir()` 跟隨 `PI_CODING_AGENT_DIR` 設定。
每個 extension 實例使用獨立 JSONL 檔案，跨 session 與重新啟動累積，不因 `/tree` 或 `/fork` 重播舊計數。
每筆只存 schema version、UTC 時間、隨機操作 ID、工具／指令分類、階段，以及結果分類／耗時或人工標記。
不保存指令引數、聊天、玩家名稱、按鈕內容、Telegram ID、pi session ID、原始 tool call ID、錯誤原文或憑證；不讀取 Telegram session 檔案。
新建目錄權限為 `700`、檔案為 `600`，逐次紀錄不自動外傳、不自動刪除；查詢摘要會進入 pi 對話，之後可能隨上下文送給模型。不用時可自行封存或刪除統計目錄內的 JSONL 檔案。

- `BEARS_METRICS=0`：停用紀錄與查詢；變更後重新啟動或 `/reload`。
- `BEARS_METRICS_DIR`：指定統計專用目錄的絕對路徑；不同專案預設共用統計，要分開觀測可設定不同目錄。
- 寫入失敗會停止該實例後續紀錄，UI 警告一次，不影響遊戲工具；查詢會回報未啟用／失敗。修正後 `/reload`。
- 查詢會明列略過的損壞／未知版本紀錄數；拒絕符號連結檔案，單檔超過 32 MiB 或有效紀錄超過 200000 筆時不輸出部分統計，請先封存舊紀錄。

## 工作狀態面板

套件預設載入 `extensions/status.ts`，提供 `update_status` tool。LLM 會在多步驟工作開始，以及重要進度、關鍵事實、阻塞或下一步改變時，主動以完整內容更新編輯器上方的 widget；過時項目應在下一次更新移除。

| 參數 | 用途 |
| --- | --- |
| `title` | 選填的面板標題，最長 60 字元。 |
| `items` | 依重要性排序的完整項目清單，最多 8 項、每項 160 字元；傳空陣列會清除面板。 |

狀態保存在 `update_status` 的 tool result details，重新載入或切換 `/tree` 分支時會依目前分支還原。widget 最多顯示 18 行，支援 CJK／emoji 寬度與換行；RPC 使用純文字內容。

此面板不讀取 Telegram、不啟動網路連線，也不是遊戲即時狀態來源。內容由 LLM 根據當時上下文整理，重要操作仍須重新查閱遊戲即時狀態；工作完成或不再需要面板時，LLM 應以空 `items` 清除。原本自動解析角色與房間資訊的 widget 暫時棄用。

## 設定與登入資料

| 環境變數 | 用途 | 預設值 |
| --- | --- | --- |
| `TELEGRAM_API_ID` | Telegram Apps 的 App api_id | 使用已儲存的憑證。 |
| `TELEGRAM_API_HASH` | Telegram Apps 的 App api_hash | 使用已儲存的憑證。 |
| `PI_CODING_AGENT_DIR` | pi agent 目錄；統計、Telegram session 與憑證的預設位置皆跟隨此設定 | `~/.pi/agent` |
| `BEARS_SESSION_FILE` | session 路徑，建議使用儲存庫外的絕對路徑 | `<pi agent dir>/bear-of-bears/session` |

程序環境變數優先於已儲存的憑證，缺少的值才由憑證檔補上；不載入 dotenv 檔案。變更環境變數後須重新啟動 pi。自訂 `BEARS_SESSION_FILE` 時，登入與啟動 pi 都要使用同一路徑。

`BEARS_SESSION_FILE` 優先決定 session 路徑；未設定時才使用 `PI_CODING_AGENT_DIR` 下的 `bear-of-bears/session`。`just play` 固定使用專案內的 `.pi/agent`，與未設定環境變數的 `npm run login` 不同，請依[登入與遊玩使用相同的儲存位置](#登入與遊玩使用相同的儲存位置)選擇配套指令。

預設 session 為 `~/.pi/agent/bear-of-bears/session`，憑證為相鄰的 `session.credentials.json`，透過 `getAgentDir()` 支援自訂 pi agent 目錄。
不會自動搬移或回退讀取舊版的 `~/.config/bear-of-bears/`；既有使用者可在登入與啟動 pi 時設定 `BEARS_SESSION_FILE="$HOME/.config/bear-of-bears/session"` 繼續使用，或自行將 session 與相鄰憑證檔一併搬至新目錄，保留私人權限且不要覆蓋既有檔案。
登入會將 session 與相鄰的 `session.credentials.json` 設為權限 `600`，新建目錄設為 `700`。驗證碼與密碼採遮罩輸入；不儲存電話號碼、驗證碼或兩步驟驗證密碼，也不印出 session 內容。

既有 session 會先驗證再重用，不會直接覆寫；憑證衝突也不會自動覆蓋。監看或 Telegram 工具開始操作時才讀取憑證；工作狀態面板與公開地圖不需憑證。

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

離線測試涵蓋工具請求、取消操作、過期按鈕、設定、輸出限制、監看生命週期、角色解析、工作狀態面板，以及 pi 資源載入。這些測試不能取代真實帳號的端對端驗證；手動遊玩觀測記錄於 [docs/NOTES.md](docs/NOTES.md)；skill 的精簡策略參考則見 [leveling-and-equipment.md](skills/playing-bear-of-bears/references/leveling-and-equipment.md)，兩者都不代表目前遊戲狀態。

| 路徑 | 職責 |
| --- | --- |
| `extensions/bears.ts` | 遊戲工具與監看整合。 |
| `extensions/auto-idle.ts` | `/idle`、`/stopidle` 與多角色 Auto Idle tools。 |
| `extensions/status.ts` | `update_status` tool、分支狀態還原與工作狀態面板。 |
| `extensions/compact-context.ts` | 模型請求前的非破壞性遊戲內容精簡。 |
| `extensions/metrics.ts` | 被動操作統計、人工誤用標記與本機報表。 |
| `src/` | 登入、設定、Telegram 連線、Auto Idle、操作協調、地圖查詢與狀態解析／呈現。 |
| `tests/` | 離線測試與測試資料。 |
| `skills/playing-bear-of-bears/SKILL.md` | 有範圍限制、依觀測證據操作的遊玩流程。 |
| `skills/bears-equipment-strategy/SKILL.md` | 等權重預設與依證據選擇的職業配裝策略。 |
| `AGENTS.md` | 文件語言與遊戲操作界線的儲存庫規範。 |

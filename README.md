# pi-bear-of-bears

透過 [pi](https://pi.dev) 與你的 Telegram **使用者帳號**，在 [@BearOfBearsBot](https://t.me/BearOfBearsBot) 遊玩萬熊之熊。此套件使用 Teleproto 連接 MTProto，不使用 BotFather token。

官方網站與世界地圖：[https://bearofbears.net/](https://bearofbears.net/)；裝備圖鑑：[https://bearofbears.net/bears-life-codex/](https://bearofbears.net/bears-life-codex/)。

- **遊戲工具**：讀取紀錄、傳送指令、操作支援的按鈕，以及查詢公開地圖。
- **即時監看**：將遊戲對話更新帶入 pi，不主動啟動 agent 回合。
- **遊戲狀態面板**：由 LLM 從遊玩過程陸續收到的資訊中，彈性挑選對後續遊玩有用的內容。
- **Auto Idle**：直接用 `/idle` 或 `/stopidle` 以 rule-based 流程管理所有角色，不呼叫 LLM。

> Telegram session 具有帳號存取權限。登入必須由你在自己的終端機完成；不要將憑證、session 內容、驗證碼或密碼貼進 pi 對話。

## 文件導覽

- 安裝與功能說明：本文件。
- 目前目標、角色、續行資料與歷史查閱：[文件入口](docs/README.md)。
- repository 開發規則與遊戲授權：[AGENTS.md](AGENTS.md)。skill 提供程序，不覆蓋 repository 的交易禁令。

## 快速開始

需要 Node.js **22.19 以上**，以及支援 `@earendil-works` extension API 的 pi。專案開發依賴使用 pi 1.1.0 系列。

### 1. 安裝與登入

先到 [Telegram Apps](https://my.telegram.org/apps) 取得 **App api_id** 與 **App api_hash**，再親自在終端機執行，不要委託 agent 登入：

```bash
git clone https://github.com/narumiruna/pi-bear-of-bears.git
cd pi-bear-of-bears
npm ci
npm run login
```

依提示輸入 API 憑證、電話號碼、驗證碼，以及啟用兩步驟驗證時所需的密碼。登入會驗證帳號並在本機儲存 session，不會傳送遊戲指令。

### 2. 啟動 pi

在專案目錄執行：

```bash
./run.sh
```

腳本會切換到專案根目錄，載入本套件、內建 MCP 及腳本列出的外部 pi 套件。外部套件首次解析可能需要網路；載入前請檢查 `run.sh` 的套件清單。若 pi 詢問是否信任專案，確認來源後再允許。

若只要載入本套件，不使用腳本中的其他套件，可執行 `pi -e . --tools +codemode`；這不會儲存套件安裝設定，其他已設定的 pi 資源仍可能載入。

### 登入與遊玩使用相同的儲存位置

`npm run login` 與 `./run.sh` 在未設定環境變數時，都使用全域的 `~/.pi/agent`。`run.sh` **不設定或覆寫** `PI_CODING_AGENT_DIR` 或 `BEARS_SESSION_FILE`，不會自動切換到專案內的 `.pi/agent`。

若已有自訂環境變數，登入與遊玩須使用相同設定。`BEARS_SESSION_FILE` 必須是絕對路徑，並優先於 `PI_CODING_AGENT_DIR` 決定 session 與相鄰憑證的位置；不影響其他 pi 資料目錄。既有登入資料不會因切換設定而自動搬移。更多設定見[設定與登入資料](#設定與登入資料)。

### 3. 先要求唯讀檢查

```text
/skill:playing-bear-of-bears 先查看我的角色狀態，再建議下一步，暫時不要戰鬥或花錢。
```

授權遊玩時，指定範圍、動作上限與禁止事項，例如：

```text
手動探索附近區域，最多 5 個動作。不要啟動掛機、進 BOSS 房、購買、交易或發公開訊息。
```

## 透過 codemode 呼叫 Agent tools

本專案註冊的 Agent tools 都使用 `exposure: "codemode"`，預設不直接宣告給 model；LLM 透過內建 codemode 的 `tools.<name>(args)` 呼叫。slash commands、watch、事件處理與 Pi 原生檔案工具不受此設定影響。

`./run.sh` 已明確載入並啟用內建 codemode，不依賴 MCP server 設定。使用其他啟動方式時，加入 `--tools +codemode`；這會保留原有預設 tools。tool_search 或其他明確啟用操作仍可能將 tool 宣告為直接可用，exposure 不是存取權限防火牆。

```js
text(await tools.bears_history({ limit: 10 }));
```

先檢查上次輸出，再於下一次 codemode 呼叫執行已授權操作。例如已核對目前角色、資源與目標後，才執行相應遊戲 tool。不要把查證與尚未核准的下一筆動作盲目預排在同一 script。

- 用 `searchTools("查詢角色狀態")` 或 `describeTool("bears_status")` 查詢 tool 說明；不從名稱猜語法。
- Telegram tools 仍逐筆 `await` 並確認結果；不使用 `Promise.all`、背景迴圈、輪詢或結果不明時重送。只有互不依賴的唯讀公開查詢才可並行。
- `bears_plan_combat` 及八個流程 tools 宣告 `outputSchema`，script 直接取得結果物件；其餘 tools 回傳文字結果，不是完整 `ToolResult` 或 `details`。篩選輸出時保留警告、截斷註記、來源 ID、訊息 ID、revision、費用與不確定性，不只輸出成功摘要。
- 帶 `originalSourceId` 的巢狀 bears tool，其完整原文另存為目前分支的 custom entry，`bears_original` 可在同 script 後續呼叫、reload 或 resume 後查閱；失敗 script 不會回滾已發生的遊戲動作或來源紀錄。舊頂層 toolResult 與 watch 索引仍可讀。
- `update_status` 也保存分支 custom entry，不依賴頂層 toolResult 才能還原。metrics 依巢狀工具的 execution events 計數，不把父 codemode 再算成遊戲操作。
- `start_idle`／`stop_idle` 的 script 只呼叫該 tool 並立即 `return`，不接其他動作；收到摘要後結束 Agent 回合。巢狀 tool 的 `terminate` 不等於父 script 自動終止，仍優先直接使用 `/idle`／`/stopidle`，避免模型用量。

## 自動切換 model 與 thinking

套件包含 `extensions/task-model.ts`，註冊 virtual model `task-router/auto`。預設 fast 為 `openai-codex/gpt-5.6-luna`＋low，deep 為 `openai-codex/gpt-6.1-sol`＋high。session 啟動時預設啟用；若此分支曾明確停用或手動選擇 model，則保留手動模式，不因 reload／resume 重新啟用。profile 不可用或未登入時只警告並保留原 model，不會呼叫額外 classifier 或讀取憑證檔。

```text
/reload
/task-model status
```

研究、決策與複雜任務使用 Sol；例行工作先使用 5.6 Luna。`gpt-6-luna` 是可設定的替代選項；本機 catalog 顯示其支援圖片、272k context，標價也較 5.6 Luna 低，但尚未實測速度或任務品質，不以標價推定速度。`gpt-5.3-codex-spark` 依使用者要求排除，不能設為路由 profile，也不作 fallback。

可明確覆寫 profile，例如：

```text
/task-model fast openai-codex/gpt-6-luna low
/task-model deep openai-codex/gpt-6.1-sol high
```

model 必須存在於 `/model` 的可用 physical model 清單。兩個 profile 可以使用同一 model、不同 thinking。覆寫保存在目前 session 分支，支援 resume、reload 與 tree 切換，不修改其他 session 或全域預設。

- **fast**：僅明確的例行查詢，例如「查看角色清單」「查看掛機進度」、`/status` 內容或簡短對話。Pi slash command 若已被其他 extension 攔截而未建立模型請求，本路由不會介入。
- **deep**：coding、研究、分析、戰鬥風險與複雜決策；不明確的請求也採 deep。這是固定文字規則，不是理解任務正確性的保證。
- 新使用者請求重新判斷；「繼續」「1」等短續行保留上一個 profile。工具回覆與 retry 預設保留上一個 physical model＋thinking，不在同輪每次請求間自動來回切換。
- LLM 可透過 codemode 呼叫 **`tools.set_task_model({profile: "fast" | "deep", reason: "原因"})`** 主動改變切換時機。例如例行查詢發現未知機制時升為 deep；分析完成、只剩明確例行操作時改為 fast。工具只排程，從下一次模型請求生效，不改變同批其他工具的執行方式，也不自行建立新回合。
- 同一工具批次最多排程一次。新使用者請求會重新分類，不沿用未套用的舊切換要求。切換可能失去 prompt cache，LLM 不應反覆切換。
- 頁尾顯示實際 physical model；extension 狀態列另顯示 profile、有效 thinking 與選擇原因。thinking 會限制到目標 model 支援的等級，virtual model 本身的 `/thinking` 不取代 profile 設定。
- 缺少設定、model 不可用或未登入時報錯，不猜 model、不自動換 provider。對話包含圖片時，新請求使用 deep；deep 不支援圖片時停止，不以文字 placeholder 代替。context 使用量未知或已達 fast context window 的 75% 時，也保留 deep，避免為降級而縮短上下文；這是保守門檻，不保證永遠不需 compaction。LLM tool 遇到同樣限制會拒絕排程 fast。
- `set_task_model` 只能選擇使用者已設定的 profile，且只有選用 `task-router/auto` 時可用。它不擴張遊戲授權、不發送 Telegram 指令，也不保證 fast 一定更便宜或更快。

```text
/task-model status
/task-model off
```

`status` 顯示目前模式與設定；`off` 從 auto 回到已設定的 deep model＋thinking。手動使用 `/model` 或 model cycling 選擇 physical model，也會立即退出自動路由，LLM tool 不得自行重新啟用。若已在手動模式，`off` 不再更換 model。停用狀態保存在目前 session 分支，reload／resume 後仍保留；使用 `/task-model auto` 才重新啟用。全新的 session 仍預設啟用。

已載入本套件時使用 `/reload` 載入新 extension；也可用 `pi -e ./extensions/task-model.ts` 單獨載入。離線測試驗證路由、LLM 排程、取消、分支還原與手動覆寫；不代表已驗證實際 provider 的端對端切換或計費。

## 裝備評分策略

未指定策略時，裝備評分預設採 `ATK／DEF／INT／AGI = 1／1／1／1`，也就是四項屬性加總。
這不是職業最佳或實戰效益保證；明確指定的權重優先於職業策略。

```text
/skill:bears-equipment-strategy 根據我的職業與主要技能安排配裝權重，先只查詢與說明，不換裝。
```

唯讀限制優先：此範例不授權切角、停止掛機、逃跑或換裝。只有未附唯讀限制的直接呼叫，才採 skill 所定義的批次配裝流程。

[職業配裝 skill](skills/bears-equipment-strategy/SKILL.md) 依已確認的主要屬性選擇啟發式 profile，例如 ATK 主力採 `2／1／1／1`、INT 主力採 `1／1／2／1`。
證據不足或混合流派回退等權重，不從職業名稱猜公式；技能、被動與套裝取捨不會因總分提高而自動忽略。
`bears_optimize_equipment` 讀取同一 extension 的未精簡觀測，不接受使用者或模型提供物品 JSON，也不建立 Telegram 連線。
可要求「幫我抓背包並換上更強裝備」；Agent 依序查 history、`/status`、`/inventory all`，取得完整性診斷，必要時補 inspect，再評分與逐件核對。
省略整組 `weights` 使用等權重；自訂範例為 `{ "weights": { "attack": 1, "defense": 1, "intelligence": 2, "agility": 1 } }`，四項必須完整且有限。

`/inventory all` 的「全列」回覆可拆成連續多則訊息；extension 只在宣告數、連續編號與清單結尾全部一致時拼接成完整快照。一般 `/inventory` 的省略或未知分頁仍不會被誤判為完整。
對名稱、等級、資格與屬性格式全部符合已確認協定的標準裝備列，optimizer 會推導部位，並將屬性列未出現的四軸視為零；特殊名稱、技能、被動、套裝、未知格式或來源衝突仍保守阻擋並要求 inspect。
`attributeEvidence` 保留每件物品在背包、inspect 與詞條中的明確數值及 `inferredZeros`；相同數值去重，來源衝突拒絕評分，不將詞條與背包總值重複相加。
回覆包含版本、角色與背包來源 message ID／revision／時間、宣告及已列數量、目前穿戴、缺漏與推薦。
換裝、外部活動、分支切換與 reload 使舊觀測失效；背包與角色觀測超過五分鐘拒絕套用，不恢復待送操作。

Agent 自動串接工具，不是 optimizer 內建換裝迴圈：每次換裝前刷新背包並重算，換裝後以新背包／inspect 確認，平手不換、負分不卸裝。
每次最多 6 次 equip 嘗試、10 次狀態變更、40 次查詢與 5 分鐘，採使用者較低上限；這些額度是 Agent 流程規範，不是通用工具的交易防火牆。
結果不明最多讀 history 兩次，仍不明即停止且不重送；取消、死亡、角色改變、速率限制、非預期費用與不完整快照同樣停止。
本流程不購買、製作、強化、販售、銷毀、交易、消耗物品、切換角色或啟動掛機；已在掛機時須先停止並確認結算。
正向配裝的 mock 測試使用明確的合成結構化資料驗證計算與底層操作接口，不將其當成已驗證的 Telegram inspect 協定。

## 打王／推塔決策 tool（唯讀原型）

`extensions/combat.ts` 只註冊 `bears_plan_combat` tool，不提供 slash command。LLM 可透過 codemode 呼叫，將重複的單步預算與招式排序交給程式；不需要使用者手動提供 JSON。

1. LLM 先讀 `bears_history`，取得本人新 `/status`、`/look` 或 `/tower`、`/skills`，再用 `bears_combat_snapshot` 建立原文綁定的 `snapshotId`，交給 `bears_plan_combat`。
   - `snapshotId` 模式的角色、HP／MP、目標、樓層與技能由程式從原文取得；LLM 只另提供已核對的 `risk` 與 `riskEvidence`。
   - 舊版完整觀測參數仍相容，只做條件計算，不能視為原文驗證。
   - `mode` 為 `boss` 或 `tower`；塔內必須提供目前 `target.floor`。
   - `evidence.status`、`target`、`risk`、`actions` 各附 `messageId`、`revision`、`date`（Unix 秒）；原型只接受最近 60 秒內、非未來的訊息時間。
   - `risk` 明列 `mechanicsComplete`、`beforeActionUpperBound`、`afterActionUpperBound` 與說明。兩個上界分別涵蓋出手前受擊，以及出手後各種結果的最壞後續傷害；後者必須取命中後觸發狂暴、未命中反擊、追加傷害與反傷的最壞合計，並核對當前防護耗次，不能只填裸 ATK 或一次實傷。
   - `actions` 僅列傷害招式，明列 `kind`、技能 `name`、`available`、`costsComplete`、`mpCost`、`hpCost` 與 `expectedDamage`。`hpCost` 是本次主動耗血的保守上界；其他成本或副作用未知時，`costsComplete` 必須為 `false`。
2. Tool 檢查完整性、時間與停止條件，再計算 `HP ≥ 出手前承傷上界 + 最壞後續傷害上界 + 主動耗血 + 1`，不預支恢復或終殺。
3. 在符合預算的候選中，預估可終殺者優先選最低 MP；否則選最高預估傷害。平手依耗血、傷害或 MP 成本及原始順序決定，詳見程式；這不是整場最佳策略或命中保證。
4. 回傳 `state`、`recommendation`、`budget`、`rejected`、來源與警告。
   - `ready`：提供一筆 `bears_attack` 或 `bears_skill` 建議，LLM 仍須核對授權與最新狀態才可另行呼叫。
   - `needs_observation`：資料缺漏、過期或機制未知，不建議攻擊。
   - `recover`：沒有可選攻擊，須另查恢復或撤退條件；不自動施法、逃跑或退出星塔。
   - `stop`：結果不明、rate limit、掛機中、死亡、目標未現身或觀測矛盾。
   - `target_defeated`：提供的目標 HP 為 0，不代表掉落入帳或整趟推塔完成。

`snapshotId` 模式會重新核對原文快照的角色、來源與新鮮度，但**不證明呼叫者提供的承傷上界**。技能文案不等於 runtime 防護，未知主動耗血不補成已確認零成本。錯誤上界仍可能產生錯誤建議，`ready` 不是安全證明或操作授權。每筆操作後重新觀測；沒有待送操作、背景工作或 reload 後自動續跑。自療、防護、入塔與開戰仍須由 LLM 另行核對授權。

載入整個套件後執行 `/reload` 即可使用。測試使用合成的結構化觀測做單步與序列 replay，不代表已驗證即時遊戲解析或實戰安全。

## 程式化流程 tools

八個 tools 註冊於既有 bears extension，使用 `exposure: "codemode"`，不新增 slash commands。LLM 可依自然語言需求選擇 tool；不要求使用者整理遊戲資料 JSON。

| Tool | 功能及界線 |
| --- | --- |
| `bears_combat_snapshot` | 本機唯讀解析戰鬥原文、建立 `snapshotId`；缺漏與機制未知分開列出，不送指令。 |
| `bears_reconcile_rewards` | 比較前／後快照及回執；區分預估、結算、一次性獎勵與存款費用，不自行結算掛機。 |
| `bears_tower_recover` | 固定流程內核對挑戰、必要時收刀、確認前庭免費才休息，再驗怪血及實支；不退出或重入。 |
| `bears_move_to` | 依六方向出口逐房步行並核對位置，排除 BOSS；不召回、付費旅行或戰鬥。 |
| `bears_equip_upgrade` | 重用 optimizer，刷新及重算後最多換一件嚴格提升裝備，用新背包驗收；不管理掛機。 |
| `bears_tower_entry_check` | 查當次角色、資格、完整價格及可選樓層；不入塔、不假設免費重置時間。 |
| `bears_plan_upgrade` | 讀本人已保存的 forge／refine／craft 原文與公開配方，比較材料缺口、階段報價及屬性；缺稅費不推總價，不付款。 |
| `bears_balance_wallet` | 依明確指定的策略，核對同角色兩處餘額後最多存款一次並對帳；不提款、移動或跨角轉移。 |

執行型 tools 需要 `scope.character`、`snapshotId`、`maxCommands`、`maxChanges`、`maxMilliseconds`、`maxGold`。四個 `max*` 欄位分別約束子工具查詢／指令次數、狀態變更次數、流程時間及金幣費用；`scope` 是本次界線，不是授權憑證，也不替代使用者授權或降低既有較嚴格限制。`bears_balance_wallet` 另需 `policy.thresholdPercent`、`targetPercent`、`maxDeposit`；沒有帳號專屬預設，本金與手續費分開限制。

1. LLM 先取得原文，再用 `bears_combat_snapshot` 準備識別。非戰鬥用途可使用其中的角色／資源快照，但戰鬥欄位缺漏仍不能攻擊。
2. LLM 核對授權與此次有限範圍後，呼叫一個執行型 tool。僅這些固定流程內，由程式逐步核驗並選擇下一筆；不將相同規則推廣成任意 codemode 迴圈。
3. 流程持有程序內共用排他權，子步驟經 `ctx.executeTool`，保留 hooks、原文與既有操作統計；單指令、其他流程及 Auto Idle 不得插入。
4. 每次狀態變更的實際 `send` 前，再核對相關 message ID、revision 與實際指令，降低查證與送出間的狀態變更風險。這不能防止其他程序或 Telegram 手動操作。
5. `confirmed` 才表示該流程已驗收；`ready` 只是資料／候選可供使用。`stopped`、`needs_observation`、`outcome_unknown` 均附缺口及最後狀態。子步驟另區分 `submitted`、`not_dispatched`、`rejected` 與 `confirmed`，不把送出當成成功。

結構化結果保留 `originalSourceId`；`sources[].originalSourceId` 可指向子查詢的完整原文，透過 `bears_original` 查閱。原文只是證據，不恢復舊執行資格。

所有流程在取消、限流、死亡、資料矛盾或費用不符時停止，不自動回滾。結果不明最多補讀 history 兩次，不等待或重送。reload／session／tree 切換使執行資格失效，不恢復工作。快照及原文在記憶體內有界保存，缺頁、過期或來源移出保存範圍時明示缺漏。

目前 parser 支援既有 status／完整背包格式，以及測試涵蓋的標籤式 tower、room、home、skills 與工藝回覆。未知格式不猜值。換裝須確認完整費用且不超出 `scope.maxGold`，存款須有完整手續費與入口證據，休息須明示前庭免費；缺少時會停止，不能以付款測價或拿測試文字當遊戲協定。

**離線驗證完成，實機未驗證。** 測試使用合成、去識別化 fixtures 及模擬 transport；不證明目前遊戲所有回覆格式、費用或實戰安全。實作範圍與逐項驗證見 [PLAN.md](PLAN.md) 及[驗證紀錄](docs/plans/workflow-tools-verification.md)。

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
- 同一程序內共用模組的 Game、流程 tools 與 Auto Idle 會拒絕交錯的 Telegram 操作；這不是跨程序、不同套件副本或 Telegram 手動操作的帳號鎖。
- 工具操作有 30 秒期限，動作後約等待 1.5 秒觀察更新，操作結束後關閉連線。
- 重新載入不會自動重播動作或啟動背景練等。

## 結構化遊戲 tools

`extensions/bears.ts` 註冊 117 個結構化遊戲 tools，涵蓋 2026-10-17 核對的 Telegram command menu 全部 87 個命令與即時 `/help`（訊息 729558），另包含已確認的額外命令、slash aliases 與子命令。共 94 個 Telegram 入口，不再排除買賣或拍賣命令。

完整名稱、Telegram prefix、參數及分類見[結構化 tools 完整對照](skills/playing-bear-of-bears/references/structured-tools.md)。命令來源與離線覆蓋快照位於 `tests/fixtures/game-command-catalog.json`；這是當次公開命令的覆蓋範圍，不保證涵蓋日後新增或未公開的命令。

| 分類 | 主要 tools（名稱加 `bears_`） |
| --- | --- |
| 探索與角色資訊 | `look`、`consider`、`boss_respawn`、`worldboss`、`gear`、`gearrank`、`titles`、`potions`、`inventory`、`inspect` |
| 移動與戰鬥 | `go`、`goto`、`recall3`、`bebe_travel`、`attack`、`skill`、`use`、`equip` |
| 工藝與星塔 | `forge`／`forge_upgrade`、`refine`／`refine_upgrade`、`dismantle`／`dismantle_item`、`craft`／`craft_make`、`shards`／`shards_redeem`、`tower`／`tower_go`／`tower_quit` |
| 商店與金融 | `buy`、`sell`、`sellall`、`auction`、`auction_sell`、`auction_offer`、`market`、`stock`、`trade`、`positions`、`close`、`lotto` |
| 家園、寵物與劇情 | `vault`、`store`、`retrieve`、`deposit`、`withdraw`、`release`、`story`、`journal`、`talk`、`gift` |
| 角色與設定 | `start`、`switch`、`create`、`rename`、`advance`、`config_ui`、`alias_set`、`unalias` |

**名稱例外：`bears_game_history` 傳送遊戲 `/history`；既有 `bears_history` 仍只讀 Telegram 聊天紀錄。** 原有 `bears_send` 與 `bears_click` 保留。

- 查詢與狀態變更分開封裝。工具存在不解除交易禁令，也不代表已授權花費、移除物品、建立／轉職或公開發言；操作前仍須核對本人資源、費用與副作用。
- `sellall` 提供已觀察的 `稀有`／`史詩`／`全部` 參數；`全部` 仍受禁止使用規則限制，`史詩` 仍須確認目前角色未二轉。
- 名稱最多 200 字元，`say.message` 最多 4091 字元；拒絕控制字元、換行、頭尾空白、開頭 `/`、未知欄位及錯誤型別。正整數須在安全整數範圍內，完整指令不得超過 4096 字元。
- `use.quantity` 支援正整數或 `滿`；拍賣出價與快捷使用結構化陣列，不需自行拼接指令。完整限制見對照文件。
- 每次呼叫只送一個指令，與 `bears_send` 共用 `Game`、操作鎖、Auto Idle 排他、快照觀測及失效規則。先讀 `bears_history`，逐筆確認結果；不自動重試、不建立操作迴圈。
- 結果沿用 `originalSourceId`／`bears_original`，並納入上下文精簡及本機統計；統計不保存參數或訊息。
- `bears_idle`／`bears_stopidle` 只處理目前角色，不等同全角色 `start_idle`／`stop_idle`，也不攔截 Pi slash commands。

載入套件後使用 `/reload` 啟用新 tools。測試使用離線 transport；查證命令時未執行交易、付費強化或其他有副作用的操作。

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

根目錄套件另提供 [圖鑑研究 skill](skills/research-bears-equipment/SKILL.md) 與 `bears_life_codex` 唯讀工具，可用 `/skill:research-bears-equipment` 研究公開 BOSS 裝備與合成配方。這項工具不需 Telegram 登入；既有 `bears_codex` 功能相近，擇一查詢即可。

兩個工具只在呼叫時讀取固定 HTTPS JSON 端點，快取 12 秒；不需 API key，不傳送 Telegram 指令、不讀取登入憑證。每次 HTTP 請求上限 15 秒／2 MiB，禁止重新導向，失敗不自動重試。

| 工具 | 來源與查詢方式 |
| --- | --- |
| `bears_world` | [state.json](https://bearofbears.net/state.json)；`roomId` 或 `query` 篩選，每頁 30 個房間。 |
| `bears_codex` | [codex.json](https://bearofbears.net/bears-life-codex/codex.json)；`query` 搜尋 BOSS、掉落物、屬性、技能；搭配 `recipes: true` 搜尋成品及材料，每頁 10 筆。 |

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
- 原文存在 session 的頂層工具／watch metadata，或 codemode 巢狀工具的分支 custom entry，不直接送入模型；增加 session 儲存量，但不依賴私人暫存檔。只查目前分支，不讀任意路徑或連線 Telegram。
- 舊版紀錄沒有索引時明確回報找不到；`bears_original` 本身不再精簡，也不產生新原文索引。
- 在本儲存庫內執行已授權的遊玩記錄任務時，Agent 使用後須依本地 `AGENTS.md` 在 [`docs/compact-context-feedback.md`](docs/compact-context-feedback.md) 記錄情境、疑問、查閱範圍與結果。單獨安裝套件不要求存取這些未隨包發佈的帳號紀錄。

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

套件預設載入 `extensions/metrics.ts`，被動記錄載入後的七個既有 `bears_*` 工具呼叫（含 `bears_optimize_equipment`）及上述結構化遊戲 tools。
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

## 遊戲狀態面板

套件預設載入 `extensions/status.ts`，提供 `update_status` tool。LLM 在遊玩過程中透過 bears tools 陸續取得資訊時，會自行挑選對後續遊玩有用的內容，以完整內容更新編輯器上方的 widget；不限制固定欄位，也不必收錄所有資訊。

| 參數 | 用途 |
| --- | --- |
| `title` | 簡短標題，明示已確認的目前操作角色，可附職業或主要目標，最長 60 字元；省略時為「遊戲狀態」。 |
| `items` | 依對下一步的影響排序，通常 4 至 6 項，允許 1 至 8 項、每項最長 160 字元。每項只說一個主題，建議使用「自由標籤：內容」；本角項目不重複角色名稱，跨角色資訊另標歸屬。 |

標題確認目前角色後，項目預設屬於本角，不在每行重複角色名稱。只有跨角色或全體資訊另標歸屬，例如「全體進度：…」或「待確認｜角色 B：…」；角色或歸屬不明時標示待確認，不自行猜測，也不省略歸屬。保留必要的跨角色目標與其他角色最後觀測；切角並確認成功後，LLM 應更新標題與內容排序，不把前角的裝備、資源或生命值套用到新角色。未確認共用的資源不得列為帳號資源。

標籤與內容不限定分類，可記錄臨時限制、發現或待驗證事項，也可使用無標籤文字。不要求填滿欄位；數值須有必要單位、計算對象與比較基準，不使用自創縮寫或操作流水帳。

- 屬性只在影響目前配裝或戰鬥決策時顯示，不固定列出全部屬性。
- 目前狀態、歷史支出與下一步分項表達；歷史支出只有在影響剩餘預算或後續決策時保留，不混入目前餘額。
- 下一步寫明動作、完整物品名稱與必要數量，不使用「分解一根」等對象不明的指示，也不為縮短文字省略安全條件。
- 使用直接語句，例如「材料：最後觀測精魄 15,806 個」。HP 與 MP 都已確認全滿且不需精確值時，可寫「HP／MP 全滿」；未知或不滿時不得概括為全滿。

以下為格式範例，不代表目前遊戲狀態：

```text
◆ なるみ｜賢者熊
• 目標：星塔 70 層；目前最高 65 層
• 全體進度：最後觀測 9 名角色均未達 70 層
• 現況：霜風避難所，手動操作；HP／MP 全滿
• 資金：80,446,791 G
• 材料：最後觀測精魄 15,806 個、通用碎片 4 個
• 待確認｜角色 B：最後觀測入場材料不足
```

每次更新由 LLM 提供完整替代內容，移除已被新觀測取代、已解除的臨時限制與不再有用的項目；無法確認仍有效的資訊標示「最後觀測」或「可能過期」，推論或未知機制標示「待驗證」。這些是生成規則，extension 不會自動查證角色、資源或時效。

狀態保存在 `bears.status` custom entry，重新載入或切換 `/tree` 分支時會依目前分支還原；舊版頂層 `update_status` tool result details 仍支援讀取。widget 最多顯示 10 行（含單行標題、上下框線與超限提示），支援 CJK／emoji 寬度與續行縮排。超出高度時，從第一個放不下的完整項目起省略，顯示「另有 N 項未顯示」，不顯示半句；完整內容仍保存。自由標籤以第一個冒號前的短前綴著色；RPC 使用純文字內容。

在 Pi 主編輯器按 **Ctrl+Alt+B** 可顯示／隱藏面板，不呼叫 LLM 或 Telegram。隱藏時仍保存最新更新，重新開啟即顯示最新內容；切換 `/tree` 分支保持顯示偏好，新 session 或 `/reload` 後預設顯示。可用 `/hotkeys` 查看快捷鍵。

此面板不直接讀取 Telegram、不啟動網路連線，也不證明遊戲即時狀態。內容由 LLM 根據 bears tools 的觀測整理，重要操作仍須重新查閱遊戲即時狀態。面板不會在單次工作結束後清除，而會保留最後一次整理的遊戲狀態。

## 設定與登入資料

| 環境變數 | 用途 | 預設值 |
| --- | --- | --- |
| `TELEGRAM_API_ID` | Telegram Apps 的 App api_id | 使用已儲存的憑證。 |
| `TELEGRAM_API_HASH` | Telegram Apps 的 App api_hash | 使用已儲存的憑證。 |
| `PI_CODING_AGENT_DIR` | pi agent 目錄；統計、Telegram session 與憑證的預設位置皆跟隨此設定 | `~/.pi/agent` |
| `BEARS_SESSION_FILE` | session 路徑，建議使用儲存庫外的絕對路徑 | `<pi agent dir>/bear-of-bears/session` |

程序環境變數優先於已儲存的憑證，缺少的值才由憑證檔補上；不載入 dotenv 檔案。變更環境變數後須重新啟動 pi。自訂 `BEARS_SESSION_FILE` 時，登入與啟動 pi 都要使用同一路徑。

`BEARS_SESSION_FILE` 優先決定 session 路徑；未設定時才使用 `PI_CODING_AGENT_DIR` 下的 `bear-of-bears/session`。`./run.sh` 沿用呼叫環境，不另設儲存位置；請依[登入與遊玩使用相同的儲存位置](#登入與遊玩使用相同的儲存位置)讓登入與遊玩使用相同設定。

預設 session 為 `~/.pi/agent/bear-of-bears/session`，憑證為相鄰的 `session.credentials.json`，透過 `getAgentDir()` 支援自訂 pi agent 目錄。
不會自動搬移或回退讀取舊版的 `~/.config/bear-of-bears/`；既有使用者可在登入與啟動 pi 時設定 `BEARS_SESSION_FILE="$HOME/.config/bear-of-bears/session"` 繼續使用，或自行將 session 與相鄰憑證檔一併搬至新目錄，保留私人權限且不要覆蓋既有檔案。
登入會將 session 與相鄰的 `session.credentials.json` 設為權限 `600`，新建目錄設為 `700`。驗證碼與密碼採遮罩輸入；不儲存電話號碼、驗證碼或兩步驟驗證密碼，也不印出 session 內容。

既有 session 會先驗證再重用，不會直接覆寫；憑證衝突也不會自動覆蓋。監看或 Telegram 工具開始操作時才讀取憑證；遊戲狀態面板與公開地圖不需憑證。

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

`AGENTS.md` 與 `docs/` 是本儲存庫的開發規則及遊玩紀錄，不隨 npm 套件發佈。套件內的 skills 不依賴個人角色文件，也不將本帳號的專屬授權套用到其他使用者。

```bash
npm run ci
```

此指令依序執行 Biome 檢查、Vitest 測試與 TypeScript build。測試使用模擬 transport 與 HTTP 回覆，不需要 Telegram 憑證。

離線測試涵蓋工具請求、取消操作、過期按鈕、設定、輸出限制、監看生命週期、角色解析、遊戲狀態面板，以及 pi 資源載入。這些測試不能取代真實帳號的端對端驗證；手動遊玩觀測由 [docs/NOTES.md 日期索引](docs/NOTES.md) 連至月分卷；skill 的精簡策略參考則見 [leveling-and-equipment.md](skills/playing-bear-of-bears/references/leveling-and-equipment.md)，兩者都不代表目前遊戲狀態。

| 路徑 | 職責 |
| --- | --- |
| `extensions/bears.ts` | 遊戲工具與監看整合。 |
| `extensions/auto-idle.ts` | `/idle`、`/stopidle` 與多角色 Auto Idle tools。 |
| `extensions/combat.ts`、`src/combat-planner.ts` | LLM 可呼叫的唯讀戰鬥決策、原文快照整合與單步招式排序。 |
| `src/workflow-*.ts` | 八個流程 tools 的原文解析、快照、對帳、固定狀態機及註冊。 |
| `src/game-operation.ts`、`src/room-route.ts` | 共用程序內排他、送出前核驗與六方向路線搜尋。 |
| `extensions/status.ts` | `update_status` tool、分支狀態還原與由 LLM 整理的遊戲狀態面板。 |
| `extensions/compact-context.ts` | 模型請求前的非破壞性遊戲內容精簡。 |
| `extensions/metrics.ts` | 被動操作統計、人工誤用標記與本機報表。 |
| `extensions/task-model.ts` | 任務 model＋thinking 路由、LLM 主動切換 tool 與手動覆寫。 |
| `src/game-command-catalog.ts` | 完整命令目錄、參數 schema 與操作分類。 |
| `src/game-commands.ts` | 結構化 tool 註冊、參數驗證與固定指令序列化。 |
| `src/` | 登入、設定、Telegram 連線、Auto Idle、操作協調、地圖查詢與狀態解析／呈現。 |
| `tests/` | 離線測試與測試資料。 |
| `skills/playing-bear-of-bears/SKILL.md` | 有範圍限制、依觀測證據操作的遊玩流程。 |
| `skills/bears-equipment-strategy/SKILL.md` | 等權重預設與依證據選擇的職業配裝策略。 |
| `AGENTS.md` | 文件語言與遊戲操作界線的儲存庫規範。 |

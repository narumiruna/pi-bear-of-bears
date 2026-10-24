# 遊玩 extensions A–G 驗證紀錄

此文件對應根目錄 [PLAN.md](../../PLAN.md) 的新增改進，不替代原八項工具的驗證。只記 coding 證據，不作遊戲狀態或操作授權。

## 2026-10-24：A 請求診斷與中斷資訊

### 實作與呼叫路徑

- `src/rpc-diagnostics.ts` 在 `TelegramClient.invoke` 邊界記錄 library RPC 呼叫，外層 `getMessages`／`sendMessage` 不再計數。同 client 安裝兩次不包兩層。只保存有限方法分類、用途、階段、子步驟序號、耗時與結果分類，最多 512 列，超額另計 `omitted`。不保存 request、完整指令引數、回覆、憑證或錯誤文字。
- `src/telegram.ts` 的 `createClient` 安裝觀測器。`connect` 包含 authorization 與 bot entity 核驗，實際 RPC 數依 library 快取而變；`history`／`message` 經 `getMessages`，`send` 經 `sendMessage`，callback 經 `GetBotCallbackAnswer`。文字按鈕不再額外計外層 click。
- `src/game.ts` 分開標示 connect、送前 history、按鈕 revision 檢查、dispatch、送後 history 與 close。callback 內部的第二次按鈕補驗也標為 button_validation，不混作真正 dispatch。未改原始等待、取消、排他或送前安全核驗。
- `src/workflow-runner.ts` 分開 query、guard、command 與 delayed 用途；晚到回覆最多補查兩次，不重送原指令。`src/workflow-tools.ts` 在單次流程內收集 `data.rpcDiagnostics`，巢狀診斷範圍沿用一次計數。沒有 RPC 的純本機輸出不新增診斷欄位。
- `src/workflow-interruption.ts` 產生 `data.interruption`：角色、原目標、已確認步數／位置、最後 status／來源、未決子操作、最後一步、送達狀態、停止碼與重驗項目。guard／本機核驗停止且沒有未決 command 時 delivery=not_applicable，不能把前一步已送出當成本次送達。不輸出待送工作，也不提供 resume 入口。
- watch 的 `connect`／事件訂閱與手動／Auto Idle 沒有呼叫 WorkflowRunner，不併入流程 RPC 數；事件推送不是一次 `GetHistory`。現有 `extensions/metrics.ts` 仍統計 Agent 工具事件，不把子步驟 RPC 當額外工具呼叫。兩個指標不可相加。

### 固定離線 replay

`tests/rpc-diagnostics.test.ts` 使用實際 WorkflowRunner、Game 與合成 BotTransport／RPC client，不連線 Telegram。每一步完整請求序列保存在 `tests/__snapshots__/rpc-diagnostics.test.ts.snap`；耗時使用非負即時值，不作穩定效能門檻。

| 案例 | 子工具呼叫 | 合成 RPC 呼叫 | 移動指令 | 結果 |
| --- | ---: | ---: | ---: | --- |
| 正常七步 | 24 | 80 | 7 | confirmed |
| 第一步回覆晚到 | 25 | 82 | 7 | confirmed；多一次有限補查 |
| 重複房間頁 | 24 | 80 | 7 | confirmed；不重送 |
| 每步未知背景公告 | 31 | 108 | 7 | 每步另補現場查詢後 confirmed，不沿已失效現場 |
| 下一步 guard 限流 | 7 | 22 | 1 | 停在 history，不多送第二步 |
| 第一步送後限流 | 5 | 16 | 1 | outcome_unknown，不補查、不重送 |
| 第一步送出時取消 | 5 | 15 | 1 | 停止，不送後 history 或下一步 |
| authorization 吞掉限流錯誤 | 1 | 1 | 0 | connect 階段停止，不當成一般錯誤補查 |

`tests/workflow-inventory-collection.test.ts` 另以實際 Game／WorkflowRunner 重現三頁背包：首頁已到、中頁與尾頁分別在兩次有限 history 到達；只送一次 `/inventory all`。缺尾頁則保留 incomplete 並停止，不發第三次補查。完整請求序列保存在同名 snapshot。

### 去重決策（A5）

**本次不採用 history 去重，沒有降低 RPC 數或修復外部限流的宣稱。** guard history 與 Game 送前 history 並非同一觀測：其間有工具 hooks、跨 extension 排他邊界及可能晚到的切角／資源回覆。既有 `withDispatchCheck` 必須消費送前新 history，不能拿 guard 的舊陣列替代。送後 history 也不能取代下一步核驗。基線已區分兩者用途，暫無能證明時間與來源等價的刪除候選，故保留全部請求。

### 已跑檢查與限制

- `npm test -- tests/rpc-diagnostics.test.ts`：11 tests 通過；涵蓋巢狀不重算、this／參數／錯誤不變、限流 phase、512 列上限、pending 不冒稱 returned、未知分類及關閉後 async scope 不新增統計。即使 RPC library 把 authorization 限流改成一般錯誤，或限流發生於第 513 個省略項，Runner 仍停止當批，不補查。`tests/telegram.test.ts` 9 tests 包含 callback 內部補驗的 phase。
- `npm test -- tests/workflow-inventory-collection.test.ts`：2 tests 通過。
- 首次全套：81 files／1375 tests 通過（加入背包收集測試前）；`npm run build` 通過。最終整合須再跑。
- `npm run check:ci` 通過，保留既有 Biome schema 2.5.12／CLI 2.5.15 提示；`git diff --check` 通過。
- 首次環境：Node v26.10.0、npm 11.19.1，安裝 Vitest 5.0.3／teleproto 1.229.3，與 `package.json` 不合。之後已同步 lockfile 並安裝 Vitest 5.0.5／teleproto 1.232.0；新版重驗見後節，不將首次結果混為新版本證據。
- library RPC 呼叫不等於網路封包、握手數、library 內部 retry 或外部限流根因。正常 replay 每次 connect 只模擬一個 RPC，不能當實機七步的絕對 RPC 預算。
- 未 reload、未連線 Telegram、未執行遊戲操作；本機測試不證明目前 session 已載入新版。

## 2026-10-24：C 完整背包與研究摘要

- `src/workflow-inventory.ts` 重用既有完整性判定，輸出連續列、缺號範圍、parser diagnostics、頁面及整列來源、展示省略數、穿戴篩選與有界重名分組。未知屬性、技能或用途不補零。
- `src/inventory-delta.ts` 只比較同角色、同分支、依序的兩份完整版本。列號不作跨版本 ID，同名多組標歧義；不抹除其他唯一品項的差異。既有收益對帳重用其數量抽取。
- `tests/workflow-inventory-research.test.ts`：10 tests，涵蓋首頁／中頁晚到、缺尾、重複頁、修訂、跨角、反序、未知效果、來源與兩版本差異。`tests/workflow-inventory-collection.test.ts` 的 2 tests 驗證既有兩次有限補查，不重送背包。
- 80 列固定合成 fixture 的穿戴研究摘要為 **1546 bytes**，原文 **21349 bytes**，見同名 snapshot。只代表此 fixture／filter；不是所有摘要都比短清單小。六案例 late-inventory 因新增缺口及來源欄位，2147 → 3262 bytes，沒有隱藏這項成本。

## 2026-10-24：B、D 部分交付

- `src/workflow-events.ts` 僅完整比對既有 replay 格式及已保存的原生三行具名掛機回報。`tests/fixtures/native-idle-reports.json` 從既有 equipment replay 擷取，明示原始 message ID／時間未保存，沒有補造新 Telegram 證據。
- 本角回報推進資源 barrier；他角完整已知回報可忽略，但未知尾行、混合本人獎勵或已綁來源 revision 不可略過。`statusInvalidation` 增列受影響區塊，仍保留觸發 ID／revision。相關回歸見 `tests/workflow-event-classification.test.ts`。
- `src/workflow-reward-ledger.ts` 擴充既有 `reconcileRewards`，不是另一個帳本系統。`data.ledger` 分開角色、操作區間、來源／revision、兩端資源證據、已確認交易、實際差額、待歸因及缺證。原生「本次結算」自然入帳與明確 `/stopidle` 尾款分帳；`/idlestatus` 不計收入。
- 同 ID／revision 不重算；改署他角的 revision 取代原事件，不保留舊本人金幣。無關重名品項不抹除唯一材料的實際差額；歧義品項從前後兩邊一起排除，另列 ambiguousItems。分類不明仍顯示 unknown，不按王名混合世界／野王。測試：`tests/workflow-reward-ledger.test.ts` 5 tests，以及既有 rewards／forge 回歸。
- **未完成 B1–B3 與 D2／D5 的世界王部分。** 完整純血線／正式世界殞落及個人獎勵格式缺證，不能把日誌摘要當 native fixture。已一次查指定舊原文但目前分支找不到，見[原文缺證紀錄](../context-feedback/2026-10.md#2026-10-24-1406-workflow-bloodline-fixture-missing)。不重查負面來源、不連線 Telegram 補測。未知世界文字仍維持保守 barrier。

## 2026-10-24：E 唯讀預檢診斷

- `src/workflow-disposal.ts` 經既有 inventory tool 的 `preflight` 參數提供診斷，綁完整 snapshotId、唯一名稱、單件數量、宣告保留量、精煉與 inspect／preview ID／revision。
- 數字整組／批次、重名、舊版本、穿戴／鎖定、保留用途未知及最後一件均阻擋。inspect 必須在該版本之後且對應列號；展示原始效果及永久失去品項，不按低屬性判廢品。
- `verifyAfter` 重用 D／C 的兩版本差異，只核對移除量是否符合單件宣告；數量不符回報停止後續相依操作。沒有 executor、付款、分解或升級呼叫。
- `tests/workflow-disposal.test.ts`：9 tests。另修正 `src/inventory.ts` 的 `parseInspect` 漏列「授技」為未知效果，與 inventory tests 一起通過。
- **E 尚未完成 native 預覽與碎片驗收。** 完整預覽格式未保存，因此 `expectedFragments=null`、`fragmentsVerified=false`，預檢維持 needs_observation，不產生可執行推薦。不是只要填數字就能解鎖的介面；數量吻合不代表碎片或授權已驗。

## 2026-10-24：F 歷史索引與單一檢查點

- `src/workflow-combat-history.ts` 透過 combat snapshot 的 `includeHistory` 提供逐角色正式勝／退／敗回執，保留來源、事件、最後觀測資源／配裝／技能及同角色資源差異。舊觀測不冒稱戰鬥當下的原子狀態；不按同名合併遭遇、不計算承傷上界或下一戰資格。
- `src/workflow-continuation.ts`／既有 store 提供 `includeContinuation`：新現況取代舊現況，歷史來源不刷新；過期時 nativeIdle=null，舊值另列 lastObservedNativeIdle。最近可解析不可逆回執目前只涵蓋 forge，明列 coverage；其他相關指令只保留來源，不能把 request 或 preview 當成成功處置。未決回報有界保存 20 筆，省略另計；新唯讀成功不抹除舊未知操作。
- reset 清除檢查點；舊 generation 的晚到流程結果不能寫入新分支。沒有持久化待送工作、resume 或新增遊戲呼叫。測試：`tests/workflow-continuation.test.ts` 5 tests、`tests/workflow-combat-history.test.ts` 4 tests。歷史多頁背包與目前背包共用 `src/workflow-inventory-observation.ts` 的完整性及來源收集，不複製 parser 或把 subset 當完整配裝。
- **F1／F2 尚未完整**：native 野王／世界王同名型別及私人冷卻正式訊息仍缺可綁定格式。`personalCooldown.eligible=null`；公共存活不會清除私人限制，未解析原生可能新勝保留待核。

## G：整合與量測狀態

- 未新增 extension 入口或工具名稱。現有註冊與 schema 增加 opt-in 研究參數，skill 同步前置條件、未知欄位及禁止副作用。依既有 loader／codemode／原文／context 回歸驗證，不 reload 目前 session。
- `npm install --ignore-scripts` 同步既有 manifest／lockfile 不一致；`npm ls teleproto vitest --depth=0` 正常，實際 teleproto 1.232.0、Vitest 5.0.5。build 與完整測試均以此版本重驗。
- `npm audit` 額外發現 Pi 1.4.0 pin 的 undici 8.10.2 漏洞（1 high／1 moderate 的相依路徑）；一般 update 不能解除上游精確 pin。未採用建議的 major downgrade／force。這不是本次遊戲程式已修好的漏洞，不宣稱依賴零風險。
- 六案例單次重現命令：`BEARS_WORKFLOW_METRICS_REPORT=1 npm test -- tests/workflow-scenario-metrics.test.ts`。實際耗時、指令數、history 數、bytes／tokens、缺頁案例與錯誤副作用數，以及八個 Game／RPC replay 的單次耗時與輸出大小見[離線量測 artifact](artifacts/workflow-improvements-offline-metrics.json)。不新增背景記錄，也不保存任意聊天或完整引數。
- 固定七步及各停止案例的 RPC 序列未減量；正常仍 80、未知公告仍 108 個合成 RPC。equip 輸出 7645 → 7729 bytes、native-entry 1710 → 1793 bytes，新增的是診斷。interruption 7261 → 8887 bytes（前批）；本批新增失效定位後為 9093 bytes，新增結構化中斷資訊。舊版沒有可比較耗時樣本，不計速度改善率。
- 前批整合（2026-10-24 15:15 +0800）：88 files／1418 tests 通過；139 個本次相關文件相對連結通過。最新結果見下一節及 PLAN 最後追蹤列；`npm run build`、`npm run check:ci`、`git diff --check` 通過。實際 extension loader、schema、hooks、原文、context 及排他回歸均包含在全套內。命令與結果也在 PLAN 追蹤列記錄。離線／新版載入／實機分開：**離線通過；目前 session 未 reload；未做 Telegram 或實機驗證。**

## 2026-10-24 15:30 +0800：獨立補完 B5／F4／G3

- 不重查缺失原文，先用新測試重現三項本機缺口：未決回報遺失原目標／送達資訊、來源修訂／淘汰不明示，以及舊成功回執掩蓋較新未確認處置。修正 `src/workflow-continuation.ts`、`src/workflow-observations.ts` 後三項皆通過。
- pendingWorkflows 保留既有 interruption，另列 sameControlContext 與有界 sourceValidation；匹配只表示來源 ID／revision／時間及角色／generation 還能對應，不刷新時效或變成資格。沒有來源清單也不能算匹配。診斷最多 20 項，省略另計。
- observationCoverage 明列本 store 已觀測的缺頁批次、保存範圍淘汰量及現存訊息數，不冒稱完整 Telegram 歷史。reset 清除計數與未決資訊；切角後舊回報明示不同控制情境。lastIrreversibleObservation 依來源先後選最新已解析回執或未確認 request，不將較新的 request／preview 藏在舊成功之後；未知格式仍標示未知。
- B5 的 invalidationEvent 在沒有 status 或來源已淘汰時也保留原因、觸發 ID／revision、受影響區塊及 sourceMissing。它明示 historical_barrier_event，不宣稱後續新來源仍失效；背包缺證及流程停止都會輸出，且不複製完整 request。也修正無角色證據時 `null === null` 導致未知事件被誤標成本人回報的問題。
- 測試：`tests/workflow-continuation.test.ts` **9 tests**、`tests/workflow-event-classification.test.ts` **7 tests**。完整 **88 files／1424 tests**、build、check:ci、diff 通過。純本機測試沒有 Telegram 呼叫。
- G3 保存本次與前批的相同八個 RPC replay、六個研究／流程案例。正常仍 80 RPC，延遲 82、公告 108，各停止位置與指令數不變；新增中斷診斷使六案例 interruption 8887 → 9093 bytes。各次實測耗時及 byte 差異明列，未保存的前批 source hash 明示未記錄；不宣稱速度改善或外部限流已修好。
- 本次只勾選可獨立驗證的 B5、F4、G3，未把 native 格式缺證當成這些本機交付的阻礙，也沒有把本次進展宣稱為 A–G 全部完成。

## 2026-10-24 16:15 +0800：B4／D 的獨立防誤認回歸

- 先以最小案例重現局部效果誤使未知訊息通過 barrier 的 4 項失敗；新增 `src/workflow-runtime-effects.ts`，整份原生技能回覆必須解析完整且技能名稱對應本次 request。標籤式 replay 的每行都必須是合法效果行；未知尾文、無效數值、未綁定、同批首次身分或切角後的舊 request 均不產生可信效果。局部 parser 仍供研究，不作整份訊息分類依據。
- `tests/workflow-runtime-effects.test.ts` **11 tests**，包含既有真實技能 fixture、來源時間保留、CRLF、錯技能、跨角、未知尾文與技能清單；`tests/workflow-event-classification.test.ts` **11 tests**。CRLF 新測試曾失敗，修正後已納入全套重驗。
- 先重現 5 項收支誤認：否定句、資格預告、未知尾文、重複金幣欄位與工藝漏稅／矛盾。新增 `src/workflow-reward-replay.ts`，僅接受相依操作綁定且整份欄位完整的標籤式 replay；拒絕重複、超安全整數與矛盾金額。支出必須有實際總額或完整基價加稅費，不把漏稅視為零，也不重算總額內稅費。
- 另查到存款費用仍以局部文字擷取，新增案例先重現 **6 項失敗**：否定、未知尾文、重複費用、金額不符、假指令與未綁定來源。帳本現只接受完整標籤式存款回執、相同金額的 `/deposit` 及明列費用；未知回執不因兩處餘額吻合而入帳。未改動 wallet executor、費用上限或送前核驗，也未執行真實存款。
- 上述 replay 事件明列 `format=labelled_replay`，不冒稱 native 世界／工藝／存款格式；不以合成反例補造缺失的 native fixture。其他已確認收益仍保留。`tests/workflow-reward-ledger.test.ts` **27 tests**；連同 boundaries／wallet 的針對性 **3 files／64 tests** 與 build 通過。
- 16:10 的中途全套為 **89 files／1454 tests**；存款補修後全套 **89 files／1461 tests**、`npm run build`、`npm run check:ci` 與 `git diff --check` 通過。10 份相關文件的 **164 個相對檔案連結**存在性檢查通過（不包含 anchor 語意驗證）。Biome 保留既有 1 項 schema info。固定六案例與八個 RPC replay 已重跑，正常 80、延遲 82、未知公告 108 RPC，各停止位置不變，量測 artifact 保留前批資料及本次樣本，不宣稱 RPC 或耗時改善。
- B4 與 D5 的 native 世界混合回執仍缺證，因此本次只記局部完成，不勾整項。未 reload、未連線 Telegram、未進行遊戲操作或 commit。

## 2026-10-24 16:25 +0800：F3 最後觀測條件比較

- 直接補完獨立的 F3，不把 F1／F2 的遭遇型別與私人冷卻缺證套用到欄位比較。`src/workflow-combat-history.ts` 保留各角色正式勝／退／敗樣本、資源差異及未知機制，新增 `lastObservedConditionComparison`：配裝與技能的新增、移除、欄位改變及兩端來源；沒有適用的同角目前 status 時不比較。
- 配裝兩端必須是完整背包；只比較穿戴列，排除列號差異；同名分組另列歧義，不任選一組。技能僅比較已解析列，明列 `coverage=parsed_entries_only`，不冒稱整份清單完整或效果等價。各類最多展示 20 項，超出另計 omitted；缺資料回傳 null 與 missingBlocks，不當作無變化。
- 另先重現戰後才觀測的舊背包修訂被回填為戰前配裝的失敗。歷史前置資料現在除角色／epoch／訊息 ID 外，也要求觀測時間及訊息時間均不晚於戰報；無法還原的前置配裝保持 null。沒有延長 TTL 或刷新來源時間。
- `tests/workflow-combat-history.test.ts` **15 tests**，涵蓋已勝邊界比較、缺頁、過期、跨角、列號變動、未知授技、重名分組、25 項技能差異只展示 20 項及戰後修訂。先重現缺少條件比較與修訂回填各 1 項失敗後修正。全部仍為 `conditionsComplete=false`／`riskVerified=false`／`actionable=false`，不提供承傷上界或下一階資格。
- 16:23 的中途全套為 **89 files／1469 tests**；後續又補完下列原生技能綁定及舊預覽回歸，最終檢查見下一節。tool 說明及 skill 同步前置條件與限制。未 reload、未連線 Telegram、未遊玩或 commit。
- 本次只將 F3 勾選為具來源的最後觀測比較；不是 F1／F2 或整體 A–G 完成。另核對現有 fixture：世界相關文字只有公開地圖的資格說明，不是正式公告、殞落或個人收益回執；未將其補造為 native 原文。

## 2026-10-24 16:32 +0800：F1／D／E 的獨立來源核驗

- 以既有 `native-combat.json` 的真實勝利回覆重現：不同技能 request 或 `/flee` 仍被索引成正式原生勝場，且沒有可定位的已用技能。新增共用 `nativeSkillBinding`，從完整原生 parser 的首行 MP 成本事件讀取技能名，要求 request 相符；只在相符時輸出 observedSkill 及來源。標籤式 replay 不冒稱原生施放證據。歷史新測試先有 3 項失敗，再修正通過。
- `recentCombatEvents` 與收益帳本共用綁定檢查，避免只修歷史展示。近期事件另先重現 2 項錯誤，修正後不相符回覆為 incomplete／outcome unknown，不建立目標或計入金幣；相符原生 fixture 的 6837G 仍正常對帳。不重送 request，也不查 Telegram。
- 另核對 E 的獨立版本綁定：舊預覽即使同角色且未逾時，早於所綁定完整背包版本時也不適用。先在既有測試重現缺少明確阻擋，再補上舊品項／舊編號的版本檢查。完整 native 預覽仍缺證，未產生任何執行或碎片驗收資格。
- 歷史 **15 tests**、帳本 **30 tests**、處置 **9 tests**，針對性合計 **54 tests**；全套 **89 files／1475 tests**、build、check:ci、diff 通過。10 份相關文件的 **166 個相對檔案連結**存在性通過，不涵蓋 anchor 語意檢查。既有 Biome schema info 保留。
- 固定 8 個 RPC／6 個流程案例重跑，正常 80、延遲 82、未知公告 108 RPC，停止案例及指令數不變；artifact 保留實測樣本。這些固定案例未啟用 includeHistory，不能據此宣稱新歷史欄位沒有輸出成本。
- 這些補修不完成 F1 的遭遇型別、D 的世界回執或 E5 碎片驗收；不擴大授權、不 reload、不遊玩。

## 2026-10-24 16:50 +0800：D5 重複來源綁定與 B4 完整 status 分類

- `src/workflow-observations.ts` 原本會以新 request 覆寫同 ID／revision 的 command，讓 `/idlestatus` 舊回覆變成手動收入，或把原有 `/stopidle` 收入抹除。先重現 **5 項失敗**，再加入 `src/workflow-request-binding.ts`：既有非 null 綁定不改寫；未綁定回覆只可用當時已觀測、在先、同角色／epoch 且文字相符的最後 outgoing 補綁。晚到 outgoing、未知角色或切角後均不能補造歸屬，來源時間不刷新。
- `tests/workflow-request-binding.test.ts` **9 tests**，包含 watch 先到但 outgoing 證據齊全的正例、相同事件只入帳一次、查詢／結算反向改綁、孤立舊回覆、跨角色 epoch、未來日期與晚觀測來源；既有 watch／loader／context 回歸仍通過。沒有為省 request 改變 history 或 dispatch 路徑。
- 另先重現 **3 項 status 未知尾文誤通過**及 **4 項重複金幣／位置／EXP／屬性誤通過**。新增 `src/workflow-status-reply.ts`，必要數值仍由 statusFacts 判定，再以已保存兩份 native 與既有 replay 的行型核對整份 status，拒絕未知尾行與重複欄位；不完整 status 不能再靠局部 roomFacts 轉成可信查詢。局部 statusFacts 保留研究用途，不等於可重用狀態。
- `tests/workflow-status-classification.test.ts` **12 tests**，正例涵蓋既有原生滿級、裝備特效、掛機／預估說明；混合世界資格／本人回報僅作合成反例，不冒稱取得世界 native fixture。未保存的新 status 欄位維持保守失效，不宣稱支援所有版本。
- 另先重現缺少本人 DEF 時，`statusFacts` 會從裝備特效的 `DEF：9999` 補值；修正為只讀本人屬性列，未知維持 null，不從提示或被動描述填值。
- 針對性 **2 files／21 tests**、全套 **91 files／1496 tests**、build、check:ci、diff 通過；Biome 保留既有 schema info。10 份相關文件的 **168 個相對檔案連結**存在性通過，不涵蓋 anchor 語意。固定 8 個 RPC／6 個流程案例重驗，正常 80、延遲 82、未知公告 108 RPC，停止位置與指令數不變。未宣稱 RPC／耗時改善。
- 對 F2 另查未試過的具體來源 `b18c3bf1-16da-461e-964c-1f0207318147`，仍缺目前分支原文索引，見[2026-10-24 16:50 回饋](../context-feedback/2026-10.md#2026-10-24-1650-workflow-cooldown-fixture-missing)。不遍試其他 UUID，也不把含省略號的紀錄補成 native parser；未查 Telegram、未讀憑證／session、未 reload／遊戲／commit。
- 這些是 B4／D5 可獨立驗證的補修，沒有完成世界公告／回執、分解碎片或私人冷卻的缺證部分；不因此勾選整項 B4／D5。

## 2026-10-24 17:15 +0800：B4／D5 家園完整性及送前費用核驗

- 以新測試先重現 **7 項失敗**：家園未知費用、世界資格混入、重複手續費／現金／金庫、局部出口回退，以及費用未知時仍送出存款。新增 `src/workflow-home-reply.ts`，只容許既有 native 與 replay 行型，各資源欄位必須唯一；未知尾文不保留可信舊 status／inventory。費用未知時在存款 dispatch 前停止，不靠付款後餘額來驗證未知條件。
- 同名房間是必要正例：`/look` 的「熊熊溫暖的家」不能誤套家園面板。初版在既有 wallet／seed 中觸發誤停，已用家園面板標題識別修正並補直接回歸；沒有全域略過家園文字。原生家園缺少存款費用／入口仍明示未知，擴屋費用不當存款費用。
- 原生完整文字搬至 `tests/fixtures/native-home.json`，內容來自原有 `tests/workflow-home.test.ts`：2026-10-19 `/home` 761325 的格式，金額保留既有合成值。原始訊息時間未保存，不補造時間或新的 Telegram 證據。未知家具格式仍保守失效，沒有宣稱涵蓋所有家園版本。
- 另先重現 **1 項零淨差帳本誤閉帳**：觀測已判未知的家園尾文，會在收益對帳中再次被局部 homeFacts 略過。新增共用 `src/workflow-query-observation.ts`，觀測與帳本採相同 status／home 校驗；已識別但不完整的面板不得回退其他 parser。其他通道的完整性、TTL、角色及副作用檢查維持原位，沒有建立另一套可信快照或 transport。
- `tests/workflow-home-classification.test.ts` **14 tests**；連同既有 home／wallet **3 files／37 tests**；額外 status／ledger 針對性檢查也通過。全套 **92 files／1510 tests**、build、check:ci、diff 通過，Biome 保留既有 schema info。10 份相關文件的 **169 個相對檔案連結**存在性通過，不涵蓋 anchor 語意；固定 8 個 RPC／6 個流程案例重驗，正常 80、延遲 82、未知公告 108 RPC，停止位置與指令數不變。新增分類計算成本不作普遍速度改善宣稱，完整樣本見量測 artifact。
- 本次仍是 B4／D5 的獨立補修，不完成 B1–B3 的世界格式、D2 世界收益、E5 碎片或 F1／F2 型別與私人冷卻。未查負面原文、未連線 Telegram、未 reload／遊戲／commit。

## 剩餘驗收缺口

1. B：完整世界血線、正式殞落與具名個人獎勵最小原文 fixture；完成嚴格純公告分類與 target 相依失效，不放寬未知格式。
2. D：以同批正式世界回執／原生混入案例驗證逐角色分類，不能把餘額吻合當單一來源。
3. E：完整唯讀分解預覽與唯一名稱單件語義來源，完成單件／整組收益解析後才能核碎片。現有診斷不是完成 E 的替代品。
4. F：正式私人討伐限制及可綁定本人勝回執、同名不同型別遭遇來源；目前 unknown 不能作資格。
5. G：本批 G4 所列測試、build、靜態、diff／檔案連結檢查已全部執行並通過；待上述交付完成後仍須重跑同案例比較與全套整合。不能將本次部分交付或離線通過當整體完成。

恢復缺證部分只需既有、去識別化完整原文或正常已授權觀測保存的 fixture；不要求付款、危險測試、等公告、輪詢或啟動遊戲。E 的已知診斷與 F 的歷史索引仍可獨立驗證；本文件不將單一原文缺口擴大成所有 coding 不可行。


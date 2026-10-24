# 遊玩 extensions 改進實作追蹤計畫

> 建立日期：2026-10-24。狀態：**A／C 已離線驗證；B、D、E、F 部分交付，G 本批離線整合通過；整體尚未驗收**。新增改進的證據見[驗證紀錄](docs/plans/workflow-improvements-verification.md)。
> 原八項 workflow tools 的計畫與離線交付紀錄已移至[歷史計畫](docs/plans/workflow-tools-original-plan.md)，驗證證據見[逐項驗證紀錄](docs/plans/workflow-tools-verification.md)。使用者後續指定原計畫的 coding Goal 已另行完成重新核驗與補修；不代表本文件新增 A–G 工作已完成。

## 目標與範圍

優先改善「看得準、少重查、能對帳、能安全續行」，降低 Telegram 請求、背包補頁、手算收支與重建操作狀態的負擔。先量測與補強既有 tools；只有責任或生命週期確實不同時，才新增 extension 入口，不預先建立多套 transport、快取或可信狀態。

本文件只追蹤 coding 工作，不啟動遊戲、Goal mode、背景工作或任何待送操作。授權與停止規則依 [AGENTS.md](AGENTS.md)、[GOAL.md](GOAL.md) 與[遊玩 skill](skills/playing-bear-of-bears/SKILL.md)。目前依外部 coding 目標實作並離線驗收，不因此恢復遊玩。

### 不變的安全界線

- 不新增自動連打、等重生、背景刷怪、付款、交易或跨角色轉移。
- 不延長觀測有效期、不省略身分、出口、費用、message ID／revision、BOSS 與送達檢查來追求速度。
- Telegram 操作逐筆確認；限流即停止當批，不 sleep、不自動重試或立即補查。結果未知不重送。
- 公開資料、本人即時觀測、歷史樣本與推論分開；樣本不當承傷上界，勝場不產生新操作資格。
- reload、session／tree 切換不恢復待送操作。歷史檢查點不是即時狀態或授權。
- 不把文件、單項缺證、材料增加或離線測試當作遊戲目標完成。

## 已觀察問題與程式入口

下列是調查線索，不是未經重現就成立的 bug 或效能結論。

| 問題 | 證據／現況 | 優先入口 |
| --- | --- | --- |
| 多步導航的查詢密度與限流 | [2026-10-24 03:48 中斷紀錄](docs/logs/2026-10.md#2026-10-24-0348-swordmaster-spore-navigation-flood)；`moveTo` 每步 guard、移動與 status，`Game.act` 另讀前後 history。尚不能斷言重複請求就是外部限流唯一根因 | `src/game.ts`、`src/telegram.ts`、`src/workflow-runner.ts`、`src/workflow-actions.ts`、`extensions/metrics.ts` |
| 背景訊息使本人狀態失效 | [2026-10-24 03:25 紀錄](docs/notes/2026-10.md#2026-10-24-0325-berserker-three-underground-wins)中的世界血線公告觸屏障；目前未知 bot reply 保守推進 barrier | `src/workflow-observations.ts`、`src/workflow-runner.ts` |
| 全列背包延遲分頁，模型反覆整理數百列 | 原文收集與 `bears_inventory_snapshot` 已存在；需區分資料尚未收齊、parser 缺項與僅輸出省略，不重造完整性機制 | `src/inventory.ts`、`src/equipment-snapshot.ts`、`src/workflow-inventory.ts`、`src/workflow-runner.ts` |
| 原生／世界／野王／工藝的跨時段對帳 | [2026-10-24 09:53 待歸帳差額](docs/notes/2026-10.md#2026-10-24-0953-swordmaster-four-low-bosses-two-shards)；既有對帳已能算差額，但不提供完整逐角色分類帳 | `src/workflow-rewards.ts`、`src/workflow-observations.ts`、`src/workflow-tools.ts` |
| 不可逆處置前重複核保留量 | 同名多組不朽裝有歧義，名稱單件與數字整組語義不同；必要裝備、授技與用途仍須獨立核對 | `src/inventory.ts`、`src/equipment-snapshot.ts`、`src/game-commands.ts` |
| 長篇紀錄重建本人邊界與目前中斷點 | 續行文件累積多段「最新」觀測；切角、舊冷卻與已完成操作容易混用 | `extensions/bears.ts`、`src/workflow-observations.ts`、既有 combat parser、`extensions/compact-context.ts`、`extensions/status.ts` |

## 階段與依賴

| 階段 | 優先序 | 交付 | 依賴 | 狀態 |
| --- | --- | --- | --- | --- |
| A | P0 | RPC 基線、請求追蹤及明確中斷資訊 | 無 | 已實作／新版依賴離線通過；未採去重 |
| B | P0 | 嚴格事件分類及相依狀態失效 | A 的基線與案例 | 部分交付；世界格式 fixture 缺證 |
| C | P1 | 完整背包有限收集與精簡摘要 | A；重用既有完整性 | 離線驗證通過 |
| D | P1 | 逐角色收益帳本 | B、C 的來源與完整性 | 區間帳本／原生分帳已交付；世界部分未完成 |
| E | P2 | 不可逆操作唯讀預檢 | C；重用 D 的數量驗證 | 診斷與移除量對帳已交付；native 預覽／碎片未驗 |
| F | P2 | 本人戰績／冷卻索引及單一續行檢查點 | B、D；背包相依部分用 C | 歷史條件比較／檢查點已交付；型別及私人冷卻未完成 |
| G | 最終 | 文件、整合、套件載入及量測比較 | A–F | 本批離線整合通過；剩餘交付後仍須重驗 |

每階段先完成可獨立驗證的最小交付。相關缺口只阻擋相依功能；不因想做新 extension 就一次重構整套工具。

## A：請求診斷、導航中斷資訊與去重評估

- [x] A1 盤點一次流程中 guard、子指令、送前／送後 history、延遲補查與 watch 的實際呼叫路徑。
- [x] A2 補低層 RPC 計數，依流程與子步驟關聯，區分工具呼叫數、RPC 數、耗時與限流 phase；巢狀呼叫不重複計數。
- [x] A3 固定 replay 基線：正常七步導航、延遲回覆、分頁、背景公告、送前限流、送後限流與取消。保存每一步的請求序列及停止位置。
- [x] A4 定義共用中斷摘要：角色、原目標、已確認步數／位置、最後來源、未決操作、送達狀態、停止碼與缺少的重驗項目；不只回傳錯誤字串。
- [x] A5 只在同一操作範圍內，評估能否重用等價的 history 觀測。先列出不影響送前核驗與晚到訊息偵測的證據，再實作最小去重；無法證明等價就保留請求並記錄原因。
- [x] A6 為原文、觀測時間、取消、單指令／Auto Idle 排他與 metrics 相容性補回歸。

**驗收**：能精確指出每個 RPC 的用途與限流發生階段；所有停止案例不多送一步。若採用去重，同一固定案例須實際少一次以上等價請求，且所有安全回歸不變。未採用時不得宣稱已降低請求量或修復外部限流。統計不保存憑證、session、任意聊天或完整指令引數。

## B：背景事件分類與相依失效

- [ ] B1 保存最小真實格式 fixture：世界王血線、正式殞落／本人獎勵、本角與他角原生回報，以及不明格式。
- [ ] B2 建立有限分類與來源歸屬，區分「公開血線資訊」「本人資源變動」「其他角色回報」「未知事件」；同名世界王與野王不可只按名稱合併。
- [ ] B3 已嚴格辨識的純血線公告只更新對應遭遇資訊，不無條件清除不相依的本人位置／裝備證據；涉及目前目標時仍使該目標資料失效。
- [ ] B4 本人原生結算、世界獎勵、切角、修訂及缺頁仍使相關資源／來源失效；不能因訊息像公告就忽略。
- [x] B5 輸出失效原因、觸發訊息 ID／revision 與受影響資料區塊，保留未知格式的保守 barrier。

**驗收**：同一批訊息混有 status、公告與本人獎勵時，各區塊正確失效；修訂、延遲、角色不明及缺頁不會變成可操作狀態。不以全域略過「世界王」或「掛機」文字處理誤停。

## C：完整背包收集與摘要

- [x] C1 重現首頁已到、中頁晚到、缺尾頁、重複頁、頁面修訂與跨角混頁。
- [x] C2 重用既有 parser 與完整性判定，提供宣告總列數、實收連續列、頁面來源、缺口與輸出省略數；省略摘要不等於缺少原始資料。
- [x] C3 在既有有限觀測額度內收齊延遲頁面，不重送 `/inventory all`、不輪詢；達限或限流即回傳部分結果與缺口。
- [x] C4 擴充 `bears_inventory_snapshot` 的研究摘要：穿戴、材料、重名分組及前後新增／移除品項。差異須綁定兩份同角色完整版本。
- [x] C5 精簡展示保留整列與原文定位；不把未知詞條、被動、技能或部位補零，也不讓 subset 成為新的完整背包。

**驗收**：有效完整原文能供後續工具重用；多頁正常案例只送一次背包指令。缺頁、過期、修訂或重名歧義仍阻擋相依操作；固定 fixture 的摘要輸出量低於全列，另保留量測數值，不預先承諾減量比例。

## D：逐角色收益帳本

- [x] D1 擴充 `bears_reconcile_rewards`，不新增互不相通的對帳系統；事件保留角色、來源、遭遇／操作區間及修訂。
- [ ] D2 分類野王、世界王、原生自然入帳、手動尾款、工藝與一次性獎勵；世界資格、概念圖及指定裝備片不當成成裝或已結收益。
- [x] D3 分別輸出「已確認收支」「前後實際差額」「待歸因差額」「證據缺漏」。一個事件的分類不確定，不抹除其他已確認事件。
- [x] D4 支援保存停止原生前後的獨立證據邊界；唯讀帳本不自行停止掛機、切角、查詢或領取獎勵。
- [ ] D5 驗證晚到世界回執、整點原生混入、他角回覆、重複／修訂事件、同名不同裝備組與工藝漏稅。

**驗收**：同 message ID／revision 不重複入帳；修訂是替換而非新增。沒有正式收益證據時，即使餘額差吻合也保留待歸因；無法分離原生與世界時不冒稱單一來源收益。跨角色資源永不合併成可用預算。

## E：不可逆操作唯讀預檢

- [x] E1 定義候選預檢輸入與結果，綁定角色、完整背包版本、唯一名稱／物品參照、數量、精煉與 inspect／分解預覽來源。
- [x] E2 呈現目前用途、授技／被動、保留量、預期碎片與永久失去的物品；必要用途缺少證據時明示未知，不按低屬性自動判廢品。
- [x] E3 對同名多組、名稱歧義、未知單件語義、數量變動、鎖定與資料過期阻擋；不得改用數字或批次入口繞過。
- [x] E4 已有單件操作仍由 Agent 另行核對授權後呼叫；預檢不串接付款、分解或升級，也不自動犧牲最後一件。
- [ ] E5 重用 D 的前後差額檢查驗收數量與碎片，不符時停止後續相依操作。

**驗收**：未知保留用途、缺預覽、背包重編號及同名分組案例都不給可執行推薦；數字整組風險與唯一名稱單件案例分開測試。預檢結果不是操作授權。

## F：本人戰績、冷卻與續行檢查點

- [ ] F1 從正式回執建立逐角色戰績索引，保存目標類型、當時配裝、技能、資源、先機／反擊、特殊階段與撤退／勝利結果。
- [ ] F2 本人討伐限制只採明示冷卻與可綁定的本人勝場；公共存活不能清除私人限制，原生可能有新勝而缺證時回報待核。
- [x] F3 查詢結果分開列出可比較的已勝邊界、條件差異與未知機制；不把樣本計算成理論上界，不自動放行下一階。
- [x] F4 建立單一結構化檢查點，保存目前控制角色、最後位置／資源及其時間、原生狀態、未決操作、最近不可逆處置與各項來源。
- [x] F5 新現況取代舊現況，歷史另存；依現有文件分工產生可檢查摘要，不持續把多段「最新控制」堆入續行文件。
- [x] F6 切角、reload、session／tree 分支與來源缺漏測試；檢查點不得跨分支沿用為可信操作資格。若需持久化，只存必要遊戲證據，不存憑證或無關玩家資料。

**驗收**：同名王不同類型、兩角色同時有資格、正式退出與未決查詢均可區分。重新讀取檢查點不刷新觀測時間、不送遊戲指令，實際續行仍須新觀測及授權核驗。

## G：整合、量測與交付

- [x] G1 實作前閱讀適用的 Pi extension／SDK 文件及交叉引用；新增入口時才調整 `package.json`，並驗證註冊、schema、hooks、原文及 context 精簡相容性。
- [x] G2 更新 tools 說明與 skill，清楚列出每項能力的前置條件、未知項與禁止副作用；不讓工具宣告擴張遊戲授權。
- [x] G3 以 A 的相同固定案例比較 RPC 數、指令數、耗時、摘要大小、缺頁與誤停情況；記錄環境與不確定性，不用一次成功宣稱穩定最佳。
- [x] G4 完成相關測試、全套測試、build、靜態檢查與 diff／文件連結檢查。
- [x] G5 分開記錄「離線通過」「新版已載入」「實機已驗」。未 reload 不宣稱修正已在目前 session 生效；實機驗證須另依當次授權選低風險流程，不為測試付款、打未知王或故意觸發限流。
- [x] G6 更新本文件狀態及證據索引，不順帶 commit、reload 或恢復遊戲。

## 追蹤與完成定義

- 勾選只表示該項已有可定位的交付與檢查證據；設計、coding、離線驗證、新版載入與實機驗證分開記錄。
- 每次階段更新在下表追加一列，包含實際路徑、測試命令／結果、量測及未解問題；未做的項目保持未勾。
- 若去重或新入口不可行，先記錄原因並調整範圍，不跳過既有護欄或將該階段標成完成。
- 本計畫 coding 完成須 A–G 交付可追溯、必要回歸與整合檢查通過，且未完成的載入／實機項目明示。目前 coding 契約依 `GOAL.md` 驗收；歷史遊戲目標不屬本計畫完成指標。

| 日期 | 階段 | 交付／證據 | 實際檢查 | 未完成／限制 |
| --- | --- | --- | --- | --- |
| 2026-10-24 | 規劃 | 本文件；舊八項工具計畫封存 | 文件相對連結與 `git diff --check` 交付前檢查 | 當時 A–G 尚未實作；未執行程式測試或遊戲操作 |
| 2026-10-24 | A | `src/rpc-diagnostics.ts`、`src/workflow-interruption.ts` 及既有流程整合；[逐項證據與基線](docs/plans/workflow-improvements-verification.md) | RPC 9 tests、背包有限收集 2 tests；首次全套 81 files／1375 tests、build、check:ci、diff 通過 | 不採 history 去重；當時依賴版本不合；後續已同步重驗，見下列追蹤。未 reload／實機驗證 |
| 2026-10-24 | B–F 部分／C | 原生三行事件、區間收益帳本、完整背包來源／差異、唯讀處置診斷、歷史回執及單一檢查點；[逐項證據](docs/plans/workflow-improvements-verification.md) | 原生／混合訊息與 revision 回歸；背包研究 10、有限收集 2、帳本 5、處置 9、檢查點 5、歷史 4 tests；固定摘要 21349 → 1546 bytes | 世界公告／獎勵、分解預覽及私人冷卻格式仍缺證；預檢不產生可執行推薦 |
| 2026-10-24 | G 部分整合 | 同步 lockfile；teleproto 1.232.0／Vitest 5.0.5；[單次離線量測](docs/plans/artifacts/workflow-improvements-offline-metrics.json)；更新契約／skill／文件 | 新版依賴的整合檢查持續重跑；實際最終數字見最後追蹤列；無去重或速度改善宣稱 | Biome schema 提示及上游 undici audit 風險明示；未 reload／實機；待剩餘項完成後再作最終整合 |
| 2026-10-24 15:15 +0800 | 當批重驗 | 補 callback 內部 phase、authorization 隱藏限流及超限記錄回歸；無關重名不抹除唯一材料差額；歷史多頁來源共用完整性 | **88 files／1418 tests 通過**；`npm run build`、`npm run check:ci`、`git diff --check` 通過；139 個本次相關文件相對連結通過 | 仍不是 A–G 全部完成；待世界公告／獎勵、分解預覽及私人冷卻完整 fixture，未以猜測放寬 native parser |
| 2026-10-24 15:30 +0800 | B5／F4／G3 | 未決目標／送達資訊、來源修訂／淘汰診斷、缺頁與淘汰計數、最近不可逆觀測排序；失效原因不再依賴 status 存在，且不抄完整指令；[前後離線量測](docs/plans/artifacts/workflow-improvements-offline-metrics.json) | 先重現 3 個 F4 缺口再修正；檢查點 9 tests、事件分類 7 tests；全套 **88 files／1424 tests**、build、check:ci、diff 通過；140 個相關文件相對連結通過 | B1–B4／D2、D5／E5／F1–F3 仍須具體格式證據；不再把原文缺口套到可獨立驗證的 B5、F4、G3。未 reload／遊戲操作／commit |

| 2026-10-24 16:15 +0800 | B4／D 局部補修 | 完整技能回覆與 request 綁定；未知尾文／角色變更維持 barrier；完整標籤式收支與存款費用驗證；`src/workflow-runtime-effects.ts`、`src/workflow-reward-replay.ts`；[詳細證據](docs/plans/workflow-improvements-verification.md) | 先重現效果 4、收支 5、存款 6 項失敗後修正；效果 11、事件分類 11、帳本 27 tests；全套 **89 files／1461 tests**、build、check:ci、diff 通過；164 個相對檔案連結存在；固定 replay 重驗 | B4／D5 只完成不依賴缺失 native 格式的部分，仍不勾整項；B1–B3、D2、E5、F1–F3 及最終 G 整合仍待驗。未 reload／Telegram／遊戲操作／commit |

| 2026-10-24 16:25 +0800 | F3／歷史來源補修 | `src/workflow-combat-history.ts` 加入最後觀測的穿戴與技能差異、兩端來源、缺證、歧義及有界省略數；排除在戰報之後才觀測或訊息時間晚於戰報的前置來源；同步 tool／skill；[證據](docs/plans/workflow-improvements-verification.md) | 先重現缺少條件比較及戰後修訂回填各 1 項失敗；歷史 12 tests；全套 **89 files／1469 tests**、build、check:ci、diff 通過 | F3 是具來源的最後觀測比較，非戰鬥原子狀態、效果等價或勝率判定；F1／F2 與 B／D／E 的 native 缺證仍未完成；未 reload／Telegram／遊戲／commit |

| 2026-10-24 16:32 +0800 | F1／D／E 來源補修 | `src/combat-events.ts` 共用原生技能／request 綁定，歷史保留已確認技能來源；近期事件及帳本拒絕錯綁回覆；處置診斷拒絕早於完整背包版本的舊預覽；[證據](docs/plans/workflow-improvements-verification.md) | 歷史 15、帳本 30、處置 9 tests；全套 **89 files／1475 tests**、build、check:ci、diff 通過；166 個相對檔案連結存在；固定 8 個 RPC／6 個流程案例重驗 | 不按同名推遭遇型別，未補造世界獎勵、私人冷卻或分解格式；F1／F2、B1–B4、D2／D5、E5 仍未驗收；G4 只勾選本批已實際通過的整合檢查，剩餘交付後重跑 |

| 2026-10-24 16:50 +0800 | D5／B4 獨立補修 | 同 ID／revision 的操作歸屬不被新 request 覆寫；watch 補綁須既有 outgoing 證據；完整 status 行型與唯一欄位核驗；`src/workflow-request-binding.ts`、`src/workflow-status-reply.ts`；[證據](docs/plans/workflow-improvements-verification.md) | 先重現 request 綁定 5、status 尾文 3、重複欄位 4 及被動描述誤補 DEF 1 項失敗再修正；針對性 21 tests，全套 **91 files／1496 tests**、build、check:ci、diff 通過；168 個相對檔案連結存在；固定 replay 重驗 | B4／D5 的世界 native 部分未完成。另查具體私人冷卻原文亦缺索引，未補造格式、未連線 Telegram／reload／遊戲／commit |

| 2026-10-24 17:15 +0800 | B4／D5 家園完整性 | `src/workflow-home-reply.ts` 核對完整家園行型／唯一欄位；`src/workflow-query-observation.ts` 共用觀測與帳本判定；搬移既有原生家園 fixture 保留歷史來源；[證據](docs/plans/workflow-improvements-verification.md) | 先重現 7 項家園／送前費用缺口及 1 項零淨差帳本誤閉帳；家園分類 14、home／wallet 合計 37 tests；全套 **92 files／1510 tests**、build、check:ci、diff 通過；169 個相對檔案連結存在；固定 8 個 RPC／6 個流程案例重驗 | 只有已保存家園格式的離線覆蓋，未知家具保守失效；未取得新的世界／分解／冷卻格式，未連線 Telegram／reload／遊戲／commit |

### 程式變更的檢查命令

```bash
npm test -- <實際受影響測試路徑>
npm run build
```

`<實際受影響測試路徑>` 須換成該階段的新增／回歸測試檔案。最終整合執行：

```bash
npm run check:ci
npm test
npm run build
git diff --check
```

純文件階段只檢查內容、相對連結與 diff，不冒稱已跑程式測試。實作時保留工作目錄既有變更，逐階段核對本次 diff。

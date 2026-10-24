# 遊戲流程 tools 離線驗證

## 同範圍再次驗收（Goal 602bcb5e）

使用者再次指定原八項 tools 計畫，外部 Goal 為 `602bcb5e-448e-4094-b2a5-74118f698694`；範圍不含根目錄新計畫 A–G。重新核對原計畫完成定義與下列逐項實作／測試證據，未發現新增的未完成 coding 項目，不為新 Goal 重造功能。

- 本次實跑 `npm run check:ci && npm test && npm run build && git diff --check`：80檔1366項通過，靜態檢查、build及diff通過；保留既有 Biome schema info 與 Node experimental warning。
- 使用者回報 reload 後，透過目前 session 的 tool discovery，已找到全部8個工具及參數 schema。這只證明註冊可見，不證明最新修正的執行版本或真實遊戲流程已通過。
- 本次另跑 `npm pack --dry-run --ignore-scripts --json`：78個打包檔案、10個必要資源均存在；7份文件的138個本機連結／anchors及最終diff檢查通過。
- 前次 inspect 修正與5項回歸保留，並納入本次完整測試。程式及文件中的其他既有修改不覆寫；未操作Telegram、commit或自行reload。
- 本計畫允許以介面、實作、離線測試、文件及套件載入驗證完成 coding 交付；**離線驗證完成，實機未驗證**。原計畫不另要求冒險、付費或恢復遊戲來取得完成資格。

## 2026-10-24 指定原計畫的重新驗收

本次依外部 Goal `14817c58-99fd-4dcc-9730-b4607a1cc1cd` 核對[原八項 tools 計畫](workflow-tools-original-plan.md)，不是根目錄新改進計畫 A–G 的實作。原八項 tools 已有實作；本次逐項檢查既有證據、補修可重現缺口並重新執行完整 coding 驗收，未重造工具或恢復遊戲。

### 補修：原生 inspect 回覆的流程辨識

- `src/workflow-actions.ts` 的 `equipUpgrade` 原要求 `名稱\n類型：` 緊鄰；原生 inspect 可在兩者之間包含分隔線、稀有度與敘述，因此既有 parser 能解析、流程卻將其誤報 `outcome_unknown`。
- 新 `tests/workflow-equip-inspect.test.ts` 以合成品項重用已觀察 797731／797847 版面，修正前實跑 **1 failed／4 passed**，原生案例重現；這不是透過遊戲實際換裝取得的驗證。
- 修正為重用 `parseInspect` 並完整比對名稱，不用名稱前綴或放寬品項綁定。原生與簡式回覆都可確認 inspect 步驟；未列屬性與未確認效果仍停止推薦，不因此送出 equip。錯名、同名前綴及缺類型仍不確認、不重送。
- 新增5項回歸；相關 `workflow-equip-inspect`、`workflow-actions`、`workflow-boundaries`、`workflow-integration` **4檔60項通過**，TypeScript build通過。

### 原計畫工作分解核驗

| 原階段 | 本次核對的交付與可執行證據 | 結果 |
| --- | --- | --- |
| A 共用觀測與執行基礎 | `workflow-observations`、`workflow-boundaries`、`workflow-dispatch`、`game-operation`、`workflow-loader`；來源綁定、取消、排他及單指令／Auto Idle 相容 | 離線通過 |
| B 戰鬥快照與收益對帳 | `workflow-observations`、`workflow-integration`、`workflow-boundaries`、`combat-planner`；未知機制、跨角、修訂、缺頁、材料差額及存款中性轉移 | 離線通過 |
| C 星塔檢查與恢復 | `workflow-actions`、`workflow-boundaries`、`workflow-integration`、`workflow-tower-native`；不入塔、挑戰保留、非免費拒絕及結果不明不重送 | 離線通過 |
| D 導航與單件換裝 | `workflow-actions`、`workflow-boundaries`、`workflow-navigation-freshness`、新增 `workflow-equip-inspect` 及既有 equipment／Auto Idle 測試 | 補修後離線通過 |
| E 強化研究與存款 | `workflow-upgrades`、`workflow-wallet`；材料共享、選材保護、未知成本、單筆存款與費用不符停止 | 離線通過 |
| F 套件整合與交付 | `extension`、`codemode-exposure`、`package-resources`、`workflow-loader`、`workflow-integration`、`metrics`、`original`；註冊、實際 loader、nested hooks、原文及重置邊界 | 離線通過 |

表中名稱均為 `tests/<名稱>.test.ts`；下方需求對照保留各 tool 的實作路徑與細項。原計畫 A–F 無未完成的 coding 項目；真實遊戲驗收不在此結論內。

### 本次實際檢查

- 修正前基線：`npm run check:ci && npm test && npm run build && git diff --check`，79檔1361項通過。
- 修正後完整重跑同一組命令：**80個測試檔、1366項全部通過**；Biome無錯誤、TypeScript build及diff檢查通過。
- `npm pack --dry-run --ignore-scripts --json`：78個打包檔案，核對10個必要 runtime／skill資源均存在，未建立tarball或執行發布／prepare腳本。
- 交付前文件檢查：7份文件、136個本機連結及其anchors通過，`git diff --check`通過；現有工作目錄其他未提交修改保留，Agent未commit、reload或操作Telegram。
- Biome schema 2.5.12 與 CLI 2.5.15 不一致只有既有 info；Node localStorage experimental warning 不影響測試結果。

**交付界線：原計畫 coding 與離線驗證完成；交付後使用者回報已 reload，實機仍未驗證。** reload 為使用者回報，未另外核實目前 session 的載入版本；loader測試使用隔離模擬環境，不保證所有原生格式、完整費用或實戰安全。

## 交付範圍

實作[原八項 tools 歷史計畫](workflow-tools-original-plan.md)的八個 LLM tools，整合至既有 `extensions/bears.ts`，未新增 slash command、Telegram transport、背景工作、排程或環境變數。`bears_plan_combat` 保留舊版條件計算，另支援原文綁定的 `snapshotId`。

**離線驗證完成，實機未驗證。** 本次沒有登入、讀取 Telegram 憑證或操作真實遊戲。正常流程使用合成標籤式 fixtures、既有去識別化格式及模擬 transport；測試不能證明遊戲目前的所有文字格式、費用或戰鬥安全。

## 需求對照

| 需求 | 實作 | 驗證證據 |
| --- | --- | --- |
| 八個 tools、codemode exposure、嚴格參數與結構化結果 | [workflow-tools.ts](../../src/workflow-tools.ts)、[workflow-result.ts](../../src/workflow-result.ts) | `workflow-actions.test.ts`、`codemode-exposure.test.ts`、`extension.test.ts`、`package-resources.test.ts` |
| 原始狀態、角色、目標、塔層、技能與未知效果 | [workflow-parsers.ts](../../src/workflow-parsers.ts)、[workflow-combat.ts](../../src/workflow-combat.ts) | `workflow-observations.test.ts`、`workflow-boundaries.test.ts`、`workflow-integration.test.ts` |
| 來源 ID／revision／時間、新鮮度、分頁、失效及分支隔離 | [workflow-observations.ts](../../src/workflow-observations.ts) | `workflow-observations.test.ts`、`workflow-boundaries.test.ts`、`workflow-integration.test.ts`；無回覆的變更亦失效，watch 缺頁不能用後續相同餘額補成閉帳；既有裝備快照 replay 測試 |
| 同角色收支、材料／物品差額、修訂去重、存款中性轉移 | [workflow-rewards.ts](../../src/workflow-rewards.ts) | `workflow-observations.test.ts`、`workflow-boundaries.test.ts`；未閉合與預估不產生實現收益速率 |
| 當次入塔資格、完整價格、可選樓層與本人資源，不入塔 | [workflow-actions.ts](../../src/workflow-actions.ts) | `workflow-actions.test.ts`、`workflow-boundaries.test.ts`；已用免費不推定可免費入場，明列擇一規則才核算本人扣款分支，規則不明或資源不足保留缺口 |
| 星塔必要收刀、免費恢復、怪血／挑戰保留及實支核對 | [workflow-actions.ts](../../src/workflow-actions.ts) | `workflow-actions.test.ts`、`workflow-integration.test.ts`、`workflow-boundaries.test.ts`；準備後跨層不改套新遭遇，野外戰鬥不收刀；滿資源不重做，費用／樓層／怪血／角色改變停止 |
| 六方向導航、避開 BOSS、實際出口及目的地驗證 | [room-route.ts](../../src/room-route.ts)、[workflow-actions.ts](../../src/workflow-actions.ts) | `workflow-actions.test.ts`、`workflow-boundaries.test.ts`；起點偏離準備快照時不重規劃；單向出口、缺路、同名、門票、錯誤目的地及部分成功 |
| 保留 Auto Idle 原四方向政策與既有行為 | [idle-route.ts](../../src/idle-route.ts) | `auto-idle.test.ts`、`auto-idle-recovery.test.ts`；只抽出路線搜尋，不改掛機策略 |
| 重用 optimizer，一次最多換一件並確認穿戴 | [workflow-actions.ts](../../src/workflow-actions.ts)、[equipment-snapshot.ts](../../src/equipment-snapshot.ts) | `workflow-actions.test.ts`、既有 equipment 測試；平手、未知效果、改號、未穿戴及完整已知非零費用 |
| 工藝候選、材料缺口、階段報價、循環與受保護裝備 | [workflow-upgrades.ts](../../src/workflow-upgrades.ts) | `workflow-upgrades.test.ts`；共享材料不重用、跨頁子配方、精煉有效屬性、漏稅、價格矛盾、未知收益與公開來源失敗 |
| 同角色單筆存款、明確策略、費用／本金分開限制 | [workflow-wallet.ts](../../src/workflow-wallet.ts) | `workflow-wallet.test.ts`；0、恰好門檻、向下取整、大數、非零手續費、重驗改變、遠端拒絕及帳目不符 |
| 全流程排他、內部重入、與單指令及 Auto Idle 相容 | [game-operation.ts](../../src/game-operation.ts)、[auto-idle-state.ts](../../src/auto-idle-state.ts) | `game-operation.test.ts`、`workflow-boundaries.test.ts`、`workflow-loader.test.ts`、既有 Auto Idle 測試 |
| 實際 send 前再次核對來源及指令 | [game.ts](../../src/game.ts)、[workflow-runner.ts](../../src/workflow-runner.ts) | `workflow-dispatch.test.ts`、`workflow-integration.test.ts`；guard history 之後的外部 revision 變更亦會拒絕送出 |
| 取消、限流、明確拒絕、不明結果與部分完成 | [workflow-runner.ts](../../src/workflow-runner.ts) | `workflow-actions.test.ts`、`workflow-boundaries.test.ts`；最多兩次補讀、不重送、不回滾、不等待重生 |
| 巢狀 hooks、原文與既有統計路徑 | [bears.ts](../../extensions/bears.ts)、[original.ts](../../src/original.ts) | `workflow-integration.test.ts`、`original.test.ts`、`metrics.test.ts`；子工具經 `ctx.executeTool`，不另計父流程為遊戲動作 |
| 載入／reload／session／tree 不恢復執行資格 | [workflow-observations.ts](../../src/workflow-observations.ts)、[bears.ts](../../extensions/bears.ts) | `workflow-integration.test.ts`、`workflow-boundaries.test.ts`、`extension.test.ts`；無待送操作還原或新排程 |

表中的測試名稱均位於 `tests/`。測試包含正常流程與拒絕／失敗路徑，不只檢查 tool 是否存在。

## 實際 loader 發現並修正的問題

Pi 對不同 extension 使用獨立的 jiti module cache。只在 TypeScript module 內宣告 `active` 或 `running`，直接 import 的單元測試會通過，但實際載入兩個 extension 時不一定共用鎖。

`workflow-loader.test.ts` 先重現了第二個 extension 未被拒絕的情況。修正後，流程 owner、dispatch guard 及 Auto Idle／watch 抑制狀態以 namespaced `Symbol.for` registry 在程序內共用。測試以實際 `discoverAndLoadExtensions` 載入兩個臨時 extension，確認另一個 extension 的操作被拒絕，watch 能看到 Auto Idle 狀態，完成後鎖會釋放；不建立 Telegram 連線。

registry 只保存正在執行的排他狀態，不保存可恢復的遊戲計畫、可信快照或排程。它不是跨程序的帳號鎖，不能防止 Telegram 手動操作。

## 原文與結果語意

- 結構化結果提供 `originalSourceId`；個別 `sources` 可保留子查詢的原文 ID，`data.originalSources` 另列子呼叫原文入口，即使結果不明也保留已取得的回覆。頂層與巢狀結果均可沿原有 `bears_original` 路徑查閱，不從原文恢復執行資格。
- `ready` 表示資料／候選可供使用，不是操作授權或戰鬥安全證明。`confirmed` 僅代表本次有限流程通過其驗收。
- `submitted`、`not_dispatched`、`rejected`、`outcome_unknown` 分開回報。被拒絕或不明操作不重送；部分成功時保存最後位置、狀態、穿戴、實際餘額或觀測到的支出。
- 授權責任已寫入 skill：Agent 先核對角色、目標、費用及有限範圍，只將指定固定流程的逐步核驗委派給程式。`scope`、快照 ID 或本文件都不是新的遊戲授權。
- 技能的固定主動耗血保留數值；百分比、其他資源成本或不完整說明不補成已確認零成本。scope 角色不符時，不以輸入角色冒充實際觀測身分。
- 帳號存款比例不設套件預設；同角色的本金與手續費分開限制。未知總價不以歷史稅差、付款試價或候選四軸分數補值。未明列稅費時 `tax` 保留未知；報價與完整總額的差另列 `feeDifference`，不冒充已確認稅項。

## 初次交付執行的檢查（歷史）

開發期間已反覆執行各流程相關測試及 TypeScript build。最終驗收使用：

```bash
npm run check:ci
npm test
npm run build
git diff --check
```

另核對文件相對連結、八項 tool／計畫章節及 npm dry-run 打包的 runtime 檔案。最終完整驗收為 **50 個測試檔案、1034 個測試全部通過**；`check:ci`、TypeScript build、tracked／新增檔案的 whitespace 檢查及打包資源核對均通過。這是 coding 驗收，不是實機安全證明。

Biome 的 schema 版本與已安裝 CLI 版本有既有提示；這不是本次新增的 lint error，不為本任務修改無關設定。Node 的 localStorage experimental warning 亦不代表測試失敗。

## 仍未宣稱的能力

- 未驗證目前遊戲所有 tower、room、home、skills 或工藝回覆格式。未知格式會回報缺漏或停止，不把合成 fixtures 當成已確認的 Telegram 協定。
- 未取得完整戰鬥原碼或通用承傷上界。runtime 效果保留觀測及來源，不推固定 TTL、閃避耗次或跨層保留。
- 星塔免費重置時間、現行完整工藝稅費及未列出的入口條件仍須在正常、已授權遊玩中核對，不為 coding 驗收額外花費、等待或試打。
- 不提供跨程序帳號排他、交易、跨角轉移、背景刷王或重新載入後續跑。

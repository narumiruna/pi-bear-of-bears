# 遊戲流程 tools 離線驗證

## 交付範圍

實作 [PLAN.md](../../PLAN.md) 的八個 LLM tools，整合至既有 `extensions/bears.ts`，未新增 slash command、Telegram transport、背景工作、排程或環境變數。`bears_plan_combat` 保留舊版條件計算，另支援原文綁定的 `snapshotId`。

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

## 執行的檢查

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

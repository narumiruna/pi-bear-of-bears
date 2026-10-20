# Workflow snapshot 在原生 BOSS 圖鑑後失效（2026-10-20）

## 結論與適用範圍

已用保存的 `770091`／`770092` 原生圖鑑重現兩個獨立失效入口：`/boss` 不在 `WORKFLOW_QUERY`，指令路徑先使先前觀測失效；圖鑑也不在已知回覆分類中，兩頁再各自推進 barrier（使較早觀測失效的訊息界線）。這是 workflow 的查詢分類與觀測問題，不是已證實的 status parser 失敗，也不能歸因於 60 秒時效。

本次修正精確的 `/boss` 查詢分類，並只辨識同次回覆中符合嚴格原生格式的連續文字頁。未知事件、混入戰鬥、來源修訂與其他安全護欄仍會使舊觀測失效。另新增 `data.statusInvalidation`，讓無可用 status 的 snapshot 保留最新失效原因及證據定位，不恢復 actor、HP／MP 或執行資格。

**不能據此宣稱完整主線已修復。** `/consider` 也不在查詢白名單中，指令本身仍會獨立使之前的 status 失效。當次 `770087` 原文未提供，不能自行新增其已知格式或放寬安全。測試確認：先經 `/consider` 失效後，即使接到合法圖鑑，也不會恢復舊 status。

本次全部為離線驗證，未操作遊戲、未發送 Telegram、未讀取 Telegram session 或憑證，也未 commit。需要 reload 才能讓已載入的 extension 使用新程式；reload 會清除記憶體觀測，不能沿用舊 snapshot 資格。

## 原始證據與缺口

主線提供的時間及來源如下，時區為 UTC+08:00：

- `770081`：`/status`，角色 `なるみ_狂戰熊`，`date=1792505144`，即 2026-10-20 22:05:44。
- 接續 `770085` look、`770087` consider、`770089` skills。這三則及 `770081` 的當次原文未提供給本調查。
- `bears_boss`：`770091`／`770092`，`date=1792505172`／`1792505173`，即 22:06:12／22:06:13；`originalSourceId=3913440b-abcb-47c9-a741-6e3949dfbf6b`。
- 緊接 snapshot：`originalSourceId=4e835bcd-06b8-418f-85b4-828353d304cc`，主線回報 `actor:null` 及缺少新鮮且可綁定 status。
- 當時 bash 時間 22:06:27，距 status 訊息時間僅 43 秒。沒有理由將此直接寫成超過 60 秒。

圖鑑由主線遊戲工具回覆保存的資料檔取得。最小重現以兩則原始訊息保存於 [`tests/fixtures/boss-catalogue-770091.json`](../../tests/fixtures/boss-catalogue-770091.json)：保留完整文字、ID、date、原始 revision、附件／按鈕資訊及 original source ID，不保存無關工具包裝。保留兩頁是為了驗證第一頁在條目效果後結束、第二頁從掉落列接續的原生分頁邊界。第二頁也停在條目中間，不能宣稱整份圖鑑完整。

測試中的 `770081` 僅重建角色名稱、ID 與時間，HP 700／1000、MP 35／100 等值是合成值，不冒充當次本人數值。`770085`／`770089` 同樣使用合成內容。測試不重建未知的 `770087` 回覆；另以 `/consider` request 本身證明既有失效行為。

既有 status 時效分析及 `769232` 原文回歸見[新鮮度調查](combat-status-freshness-2026-10-20.md)。本次不將另一組訊息的證據回填為該次 runtime 的唯一原因，也未重現當時 watch、實例及所有中間事件。

## 修正與安全條件

### 查詢與嚴格文字辨識

- `src/workflow-parsers.ts`：只將精確 `/boss` 加入 `WORKFLOW_QUERY`；`/boss attack` 等不因此成為唯讀查詢。
- `src/workflow-boss-catalogue.ts`：只在明確 `/boss` request 的同一觀測批次中，從精確原生標題開始逐行辨識。只支援已保存的專屬效果文字、怪物名稱／等級／位置、HP／ATK／DEF、掉落列、神話機率說明及精魄條目結尾。
  - 多頁須 ID 連續、時間不倒退，且沒有附件或按鈕；條目順序須符合狀態機。
  - 每一個非空行都須符合目前階段；未知效果、額外敘事、同一行追加事件、缺少條目內必要行或頁碼缺口均不接受。
  - 任一頁不符時，整批不取得圖鑑豁免；不能再由其他寬鬆的 room／skills parser 將混入回覆當成已知 `/boss` 回覆。
  - 允許原生頁面在已辨識的條目中間停止，只表示已取得的文字為唯讀圖鑑前綴，不表示資料完整。
- `src/workflow-observations.ts`：只有上述辨識結果能豁免圖鑑造成的 unknown barrier；未知或 out-of-band 回覆仍依原規則失效。

不保存跨呼叫的 pending 圖鑑狀態。缺少 request 的 watch／history 新訊息，以及只有續頁、沒有同批首頁的回覆，仍保守失效。若 watch 先於帶 request 的工具結果收到同一原文，既有 barrier 不會被後續重讀撤銷。此情況仍可能要求重新取得 status；本次沒有放寬事件關聯來消除此限制。

### 精確失效診斷

`WorkflowObservations` 記錄最新 barrier 的原因：明確 invalidate、非查詢 request、狀態變更的 outgoing 指令、未知 bot 回覆、來源 revision 變更、缺頁或角色變更。snapshot 無可用 status 且仍能定位被 barrier 擋住的 status 時，`data.statusInvalidation` 提供：

- 被擋住的 `statusSource`；
- `kind`、`barrierId`，以及可取得的 request、觸發訊息 ID／revision／date；
- 可取得的觸發訊息 `source`，包含後續綁定的 `originalSourceId`。

此資料是診斷定位，不是完整事件歷程，也不證明該事件是原次失敗的唯一原因。reset 後不保留舊診斷。既有缺少／過期 blocker 文字與 60,000 ms 邊界不變，不用診斷來源回填 `character`、`snapshotId` 或 `plannerObservation`。

### 保留的界線

- 未提高任何 HP／MP；圖鑑中的回血、傷害、機率或裝備數值不寫入本人狀態、planner 風險或 runtime 效果。
- 圖鑑不提供 BOSS 現身證據、不使未知機制成為 complete，也不讓 `riskVerified` 變成 true。
- 原有狀態變更、角色／epoch／revision、reset、舊 generation、watch 缺頁、訊息時間與 observedAt 護欄繼續適用；同 revision 重讀不能撤銷已存在的失效。
- 仍未知的 `/consider` 不新增白名單。下一步若要修正該流程，須先取得 `770087` 或同格式可重現原文與來源，離線建立正反例；不以猜測、重送操作或延長時效補證。

## 測試與檢查

調查及離線驗證日期為 2026-10-20（UTC+08:00）。

1. 修改前基準：`npm test -- tests/workflow-status-freshness.test.ts tests/workflow-observations.test.ts tests/workflow-integration.test.ts tests/workflow-snapshot-blocks.test.ts tests/workflow-snapshot-summary.test.ts`，5 檔、46 項通過。
2. 先加入原生圖鑑 fixture 及回歸，再修改 source：`npm test -- tests/workflow-boss-catalogue.test.ts`，13 項中 3 項失敗、10 項通過。失敗涵蓋 `/boss` 非查詢及合法圖鑑仍清除 status，確認不是先更改 parser 再推定原因。
3. 修正後擴充正反例與失效診斷，執行：`npm test -- tests/workflow-*.test.ts tests/combat-events.test.ts tests/combat-planner.test.ts tests/character-status.test.ts tests/game-commands.test.ts`，21 檔、668 項通過。
   - [`workflow-boss-catalogue.test.ts`](../../tests/workflow-boss-catalogue.test.ts)：原生雙頁與 43 秒 status、未知／混入戰鬥／其他已知查詢回覆、結構缺漏、附件／按鈕、孤立續頁、狀態變更、revision、缺頁、角色／epoch、時效、精確 invalidator 與 consider 不恢復舊資格。
   - [`workflow-integration.test.ts`](../../tests/workflow-integration.test.ts)：經實際 bears extension 的 mock transport 執行 `bears_status` → `bears_boss` → snapshot，確認指令路徑不再誤失效；再以未知戰鬥回覆確認拒絕與原文 source ID 診斷。這不是連線 Telegram 或遊戲內驗證。
4. `npm run build`：通過。
5. 本次相關 TypeScript 檔案通過 `biome check`；`git diff --check` 通過。調查文件相對連結與 fixture 來源逐項核對。

以上只證明列出的離線範圍；不證明完整原次 runtime、watch 先後順序或遊戲戰鬥安全。

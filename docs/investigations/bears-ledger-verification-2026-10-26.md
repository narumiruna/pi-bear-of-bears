# Bear of Bears 帳本離線驗證與 review

> 本頁保留初版驗收。後續已取消手動帳號標籤，改用 Telegram 本人 ID；目前行為及後續驗收見 [Telegram ID 自動對應](telegram-ledger-identity-verification-2026-10-26.md)。

日期：2026-10-26，Asia/Taipei。已完成首版實作及 code review 修正；本紀錄取代已完成的實作計畫，保留驗收、範圍與限制。[使用與復原](../ledger.md)。

## 交付範圍

- `extensions/ledger.ts` 註冊四個唯讀工具及明確的本機管理指令；`src/ledger-*` 分開私有儲存、觀測／歸屬、版本化事實、分支投影、查詢與報表。
- 共同 `Game` 接點涵蓋 send、click、structured tools、workflow 與 history；watch 在既有 callback 同步保存。先保存未精簡觀測，再產生輸出及原文來源，不依賴 event bus 的非同步落盤。
- 使用 `node:sqlite`，沒有新增第三方 driver，也沒有提高 Node 最低版本。schema v1、foreign keys、WAL、FULL synchronous、1 秒 busy timeout、私有路徑及有限容量均已離線測試。
- send／history／watch 同一 ID／revision 只記一次事實；不同 ID 同文不合併。事實保留 parser version 及行號，重建不重送；revision 順序未知時保留衝突。
- 提供確認 MP 成本、可推導餘額、金幣回執／status 差額、條件差異、changed-since、單一檢查點及 operation ID 關聯效率報表。`unappliedNominal` 與無法確認的溢補分開。
- 所有結果的 `operationalEligibility=false`，戰鬥證據不提高 `riskVerified`，也不修改 Goal 或即時 workflow 護欄。

本次沒有遊戲查詢、登入、戰鬥、恢復、切角、hot reload、commit 或 push。測試只使用模擬 transport、既有 fixtures、隔離 Pi loader／Codemode worker 及臨時 SQLite。

## 環境與檢查

| 檢查 | 實際結果 |
| --- | --- |
| 主環境 | macOS darwin/arm64；Node v26.10.0；實際安裝的 Pi coding-agent **1.4.0**。不是從 `package.json` 的 `^1.3.0` 推定版本。 |
| `npm run check:ci` | 通過；既有 Biome schema 2.5.12／CLI 2.5.15 差異只有 info，未為本任務修改設定。 |
| `npm test` | **101 檔、1610 項通過**；包含 5 個新增 ledger 測試檔及既有相關回歸。 |
| `npm run build` | 通過。 |
| `git diff --check` | 通過；另檢查新增文字檔換行、尾端空白及本次文件相對連結。 |
| Node **22.19.0** | 下列 **12 檔、126 項通過**；包含實際 Pi loader、npm pack 隔離套件與 Codemode worker，不只驗證 SQLite import。 |
| 固定 workload | 200 筆技能回執、100 次 replay 恢復、各 200 次 history／watch 重讀；成本及重建結果一致，重複扣帳 0。 |

最低 Node 重跑指令：

```sh
npm exec --yes --package=node@22.19.0 -- node node_modules/vitest/vitest.mjs run \
  tests/ledger.test.ts tests/ledger-store.test.ts \
  tests/ledger-extension.test.ts tests/ledger-report.test.ts tests/ledger-review.test.ts \
  tests/workflow-package-load.test.ts tests/metrics.test.ts \
  tests/combat-native*.test.ts tests/workflow-boundaries.test.ts tests/workflow-continuation.test.ts
```

Node 22 的 SQLite experimental warning 及 Node 26 Pi 測試的 localStorage warning 不影響上述結果。未驗證 Bun、其他作業系統、較舊 Pi SDK 或真 TUI 的人工視覺互動；TUI／無 UI 生命週期以 shim 測試。

## Review 發現與修正

| 發現 | 修正與回歸證據 |
| --- | --- |
| 跨分支動作可能被稍後 metric、usage 或重讀舊 history 掩蓋 | 以全庫首次觀測及非 ancestry barrier 判斷，不用最新本機事件作遮蔽邊界；新 status 只重建歷史欄位。`tests/ledger-review.test.ts`。 |
| 切樹後舊 ticket 的遲到回覆可能追加至新 branch | 加入 runtime epoch；遲到觀測保留於 DB，不發布到新 ancestry，未派送的舊情境拒絕 dispatch。同檔測試。 |
| jiti 共用 channel 可能讓同程序不同 SDK session 串帳 | 工具、slash 管理流程及 watch 帶 session 身分；外來 command 送出前拒絕，history 可讀但不寫另一帳本，metrics 關聯亦隔離。同檔測試及實際 loader。 |
| 最後一個 HP 事件可能是敵方 HP；本人上限也可能被新觀測取代 | 只取本人事件，保存其新上限；不將敵歸零當本人死亡。`ledger-review`／`ledger.test.ts`。 |
| 缺頁或未知變動後可能沿用舊角色歸屬 | 清除相依控制身分／資源；確認成本仍可留原文，但不猜本人餘額或混入他角收入。`ledger.test.ts`。 |
| 缺值可能以分項 0、無反例 false 或名目差全作溢補呈現 | 完整實傷與已知部分分開；不可比較的反例保持 null；名目未實補可能含治療衰減，不能全稱 overheal。`ledger-report`／`ledger-review`／`ledger.test.ts`。 |
| 可變報表續頁可能拼成不同版本；同內容不同條件的 cache key 也可能互相衝突 | 凍結 snapshot、綁條件及 kind、有限快取，切樹清除；續頁不重查可變資料。`ledger-report`／`ledger-extension.test.ts`。 |
| metrics 變更曾保存原始 tool-call ID，違反原隱私契約 | JSONL 只新增隨機 operation IDs，不保存原始 call ID 或引數；舊測試原樣通過。SQLite 必要控制情境另存私有帳本；自由文字／聊天引數不保存。`metrics`／`ledger.test.ts`。 |
| 送出後故障或取消的帳目可能失去追查入口 | 保留原遊戲結果與可追查 operation ID，標記不完整；不改成未執行或自動重送。`ledger-store`／`ledger-review.test.ts`。 |
| 新檔匯出可能覆寫預覽期間別人建立的檔案 | 新檔採 exclusive link；既有產物檢查上次 hash、預覽內容與目前檔案，拒絕人工修改／symlink／hardlink。匯出 hash 不隨資源投影重建刪除。`ledger-report`／`ledger-extension.test.ts`。 |
| 新 skill 連結不能依賴已發佈 skill 目錄外的文件 | 新增打包內 `references/ledger.md`，完整套件資源測試通過，不放寬既有檢查。 |

既有 `combat-replay` snapshot 因共用事件新增 HP／max HP 來源而由 6338 bytes／2177 tokens 變成 6677 bytes／2286 tokens；已核對後更新兩個欄位，不隱藏新增證據成本。

## 故障與復原覆蓋

- 重複回覆、同文不同 ID、空回覆與延遲補證、watch 先到、缺 echo、不唯一關聯、MP 拒絕、未知起點／尾文、已包含真傷及名目／實補／未知溢補。
- revision 矛盾及舊版重讀、具名他角掛機、未知全服公告、切角、頁面無交集、未知挑戰／防護政策與未來日期；只失效相依欄位。
- 送出前後落盤故障、prepared／submitted 崩潰、取消、不明送達；均不新增重送或背景工作。history 不被 DB 故障阻斷。
- schema constraints、交易 rollback、多連線寫鎖、另一個 Node 程序的 WAL 寫入、私有權限／symlink／hardlink、未知版本、非空 v0 與損壞 DB。
- 真實 `SessionManager` session 檔案的 resume、tree、fork，及 runtime reload／epoch、同程序多 SDK session；不能恢復遊戲操作資格。
- 完整備份→新私有目錄還原→移除目前 parser 版本並由原文重建→核對結果一致→停用／冪等 shutdown。舊 parser 版本保留，預覽不寫檔，`GOAL.md` 與舊 anchor 不動。

首版只有**空 v0→v1 初始化**，不存在既有 production schema 升版。舊非空 schema 拒絕處理，真正升版前完整備份的規則仍保留；不以本次演練宣稱所有未來遷移已驗證。匯出產物不支援與不合作的其他編輯器同時更新，使用方式已明示不並行編輯。

## 固定 workload 原始量測

執行 `npm run build && npm run benchmark:ledger`；由 `benchmarks/run-ledger.mjs` 在臨時私有目錄產生合成回執，結束清除。以下為最後一次 Node v26.10.0 輸出中的原始數值：

```json
{
  "workload": {"skillReceipts":200,"rests":100,"historyRereads":200,"watchDuplicates":200,"rawMessages":601},
  "account": {"expectedMp":6400,"ledgerMp":6400,"recoveredMp":6400,"duplicateDebits":0,"independentCombatFacts":200},
  "observations":601,
  "events":9847,
  "timingMs": {
    "ingest":8646.802915999999,
    "commandP50":16.265625,
    "commandP95":32.83249999999998,
    "readAndProjection":40.022665999998935,
    "rebuild":1544.1423750000013
  },
  "bytes":{"database":3756032,"wal":4177712},
  "queryTokensO200k":{"fullRawHistory":55874,"status":352,"reportWithoutOldEvidence":3890},
  "coverage":{"knownCosts":200,"totalSkillReceipts":200,"knownDamageEvents":0,"damageEvents":200}
}
```

確認成本覆蓋 200／200；每筆第一個敵傷缺少可靠起點，完整實傷保持 unknown，而不是用名目量補值。因此不能由此量測計算真實 DPS。恢復為合成 replay 協定，不是實機免費恢復證明。

時間是單次本機量測，受負載影響，不作效能門檻。raw history、status、changed-since report 的資訊量不同，token 差不是等價壓縮率。沒有導入前真實 Agent 工作階段基準，也沒有模型 usage／Telegram 端到端成本，**不宣稱最有效率或實機改善率**。

## 保留的界線

- 原生休息／塔首達、未確認工藝及其他未知格式保持缺口；通層 labelled replay 不冒稱原生格式。詳細格式範圍見[使用說明](../ledger.md#初版格式範圍)。不為補 fixture 操作遊戲。
- 沒有穩定 server encounter ID、防護政策或完整配裝／技能條件時，不硬合併為同場或可比較安全樣本；反例保持 unknown。
- 模型 usage 與文件耗時只能作分支級記錄，沒有資料保持 unknown。舊 metrics 無 operation ID，不補造關聯或遷移。
- SQLite 與 Telegram 無原子交易；不能宣稱 exactly-once 遠端執行。故障備份、相容版本、停用與重建程序均已記錄，不刪舊庫掩蓋問題。
- 尚未驗證真模型、Telegram 或正式 TUI 互動；本次沒有啟用實際帳號帳本，也沒有替使用者設定環境變數或 reload 保留的挑戰。

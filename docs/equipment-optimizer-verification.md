# 裝備評分驗收紀錄

## 範圍與限制

依使用者核准的受限驗收，真實背包不完整時拒絕套用，正向換裝以 mock 驗證底層接口。
這不是已驗證的真實自動換裝：目前已觀察的 inspect 尚不足以確認全部屬性及效果，解析器保留缺漏，不提供可套用推薦。
數值核心可比較完整的已驗證候選；合成測試資料不代表遊戲協定，不可由模型或使用者 JSON 注入工具快照。

仍未驗證的遊戲格式：完整背包／分頁途徑、所有部位與穿戴資格、未列屬性的語意、完整技能／被動／套裝、穩定物品識別，以及 equip 費用、限制、副作用與成功訊息。
這些情境維持阻擋，不以省略項目的「較弱」描述、稀有度或名稱猜測。未完整驗證上述格式前，即使背包列數相符，也不代表可以真實換裝。

## 實作與自動化證據

| 契約 | 證據 |
| --- | --- |
| 等權重預設、完整自訂權重、有限值、溢位、嚴格提升、平手保留、不卸裝 | `tests/equipment-optimizer.test.ts` |
| 逐部位與窮舉最佳分數一致 | 固定 seed `0x9e3779b9`，1,000 組、每組 27 個合法組合；測試容差 `1e-10` |
| 效果未知／未授權取捨、重名目標阻擋 | 數值核心測試與 `tests/equipment-snapshot.test.ts` |
| 編號、堆疊、穿戴、重名、描述與強化／效果文字保留 | `tests/inventory.test.ts`；不把未列屬性或效果補成零／空陣列 |
| 缺頁、未知分頁、省略、格式錯誤不得完整 | inventory／snapshot 測試；不拼湊未知頁面 |
| 來源、版本、編輯、重複、過期、角色切換、inspect 綁定 | `tests/equipment-snapshot.test.ts` |
| 未精簡 history → 快照 → optimizer、無登入計算、reload／分支與延遲回覆隔離 | `tests/equipment-extension.test.ts` 與 pi loader 測試 |
| 正向擷取與推薦、換裝前重查、前後編號重排、穿戴確認 | `tests/equipment-integration.test.ts` 的合成 transport／明確 normalized 候選；不是完整真實解析路徑 |
| 平手、無提升、缺漏、部分成功、取消、速率限制、非預期費用與延遲 | 同一 mock 整合測試；未知結果不重送，不反向換裝 |

工具使用 extension 既有的單一 `Game`；optimizer 不建立 transport、不送指令、不啟動背景工作。
`session_start`、`session_tree`、`session_shutdown` 重設快照；generation 拒收舊分支的延遲結果。
watch 被動接收可辨識的 status／inventory 與可關聯的 inspect 回聲；其他活動或缺失 batch 使快照失效，不自行補查。失效活動界線保留至新觀測，角色狀態必須晚於該界線，背包又須晚於角色狀態；只刷新背包不能恢復舊角色的可信度。history 可由已觀察 outgoing inspect 指令綁定延遲回覆；插入其他操作、換包與 reset 清除關聯。唯讀查詢錯誤不自行清空既有證據，但外部活動、過期與原有完整性阻擋仍有效。這不是與遊戲端的原子交易保證。

## Agent 流程審查

`skills/playing-bear-of-bears/SKILL.md` 明定先 history、status、inventory，補查使用已確認的 inspect 語法；策略與擷取分離。
每次換裝前重查及重算，之後以新背包／inspect 確認；總分預測不當成成功。
額度為六次 equip 嘗試、十次狀態變更、四十次查詢與五分鐘，採使用者較低上限；結果未知最多查 history 兩次。
死亡、取消、角色改變、速率限制、費用不明、缺漏與達限都停止；部分成功不自動回復。
不購買、消耗、製作、強化、販售、銷毀、交易、切換角色或啟動掛機。
這些是 Agent 流程規範及人工文件審查，不宣稱為通用 Telegram 工具的自動額度防火牆或模型行為實驗。

職業策略審查涵蓋預設等權重、明確覆寫、有 INT 證據的 profile、混合／缺漏回退、非法權重、只問策略不換裝，以及技能取捨仍阻擋。

## 即時觀測：2026-09-07（Asia/Taipei，UTC+08:00）

- history `619005` 顯示掛機仍在繼續；依儲存庫規則送出 `/stopidle`，`619007` 明示「掛機已結束」，未重新啟動。
- `/status` `619009` 與 `/inventory` `619011` 為本次 Agent 自行查詢，不需使用者提供 JSON。
- 背包來源 revision：`e55e87b345ce0faff634093e90664b84b66af4de5807404dd954f42fc4355d04`，遊戲時間 `1788790249`。
- 遊戲宣告 47 種、列出 40 種，明示另外 7 種未列出；已穿戴六件。此結果無工具截斷，不需額外原文查閱。
- 使用 pi loader 載入新 extension，透過其註冊的 `bears_history` 與 `bears_optimize_equipment` 執行唯讀驗收；共用該 extension 的 `Game`，不另實作 Telegram client，不將模型重述當成快照。
- 實際回傳：`complete: false`、`applicable: false`、`recommendations: []`，包含總數不符與遊戲端省略診斷。計算觀測時間 `1788790562995`；來源此時也已超過五分鐘，另外正確回報背包與角色過期。不能據此宣稱通過「新鮮完整快照」驗收。
- 即時查詢階段三次查詢（history／status／inventory）、一次停止掛機；後續 loader 驗收另一次唯讀 history。零次 equip，無購買、交易、物品處置、角色切換或掛機啟動。沒有真實正向換裝結果。

## 補充唯讀驗收：2026-09-07（Asia/Taipei，UTC+08:00）

使用者另行核准最多五分鐘、40 次查詢；本輪六次查詢（history、status、inventory、loader 的唯讀 history、兩次 inspect），另兩次本機原文查閱。零次狀態變更、零次 equip，查詢於約兩分鐘內結束。

- 新 status `619018`；背包 `619020`，時間 `1788792665`，revision 與前次相同但 message ID 為新來源。
- 經新 extension 的 history → optimizer 管線，觀測時間 `1788792686024`，距來源約 21 秒；斷言沒有過期診斷。
- 實際結果：宣告 47 種、列出 40 種、目前穿戴六件，`complete: false`、`applicable: false`、推薦空陣列。新鮮來源的不完整背包阻擋驗收通過，不代表取得完整背包。
- `/inspect 10`（`619022`）確認飾品槽、需求等級及可裝備格式；但護符在背包列敏捷 +3，inspect 的屬性只有 DEF +4 與 INT +10。已查原文確認兩種顯示的差異不是精簡造成；未列屬性不能補零，紀錄見 `compact-context-feedback.md`。
- `/inspect 8`（`619024`）確認武器槽與詞條型裝備：沒有 `屬性：` 列，而由「⟨鋒銳⟩ 攻擊 +14」「⟨堅壁⟩ 防禦 +6」表示詞條。不能把缺少屬性列當成沒有屬性。
- 這些證據補足真實格式案例，但尚未解決完整屬性／效果判定；正向可信解析整合仍未完成，計畫保留。

## 屬性合併回歸

`src/equipment-attributes.ts` 合併背包、inspect 與已觀察的詞條列；`attributeEvidence` 暴露來源、明確列值、缺項與衝突。
同值去重、不相加；衝突不任選來源；只有四項皆明確且所有來源格式可辨識時才產生數值向量。完整數值向量仍不代表效果資訊完整或取得換裝授權。
`tests/equipment-attributes.test.ts` 涵蓋護符漏列敏捷、詞條戰斧、合成完整四軸、強化／來源衝突及未知格式；snapshot 測試驗證原始文字經真實解析與合併後仍正確阻擋缺漏。
完整解析到可套用推薦的正向整合仍未完成，不以這些回歸測試替代。

## 檢查

`npm run ci`：25 個測試檔、130 個測試通過，TypeScript build 通過。
既有 Biome schema 提示與 character widget warning 未在本任務修改；Node localStorage ExperimentalWarning 不影響測試結果。

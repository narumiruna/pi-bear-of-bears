# 文件入口

先依問題選擇下列入口，不必先讀完整遊玩歷史。文件中的數值都是觀測紀錄，不證明遊戲目前狀態。

## 查詢入口

| 需要的資訊 | 先讀 |
| --- | --- |
| 安裝、登入、啟動與工具功能 | [專案 README](../README.md) |
| 開發規則、遊戲授權與禁止事項 | [AGENTS.md](../AGENTS.md) |
| 目前目標與驗收條件 | [GOAL.md](../GOAL.md) |
| 目前 coding 驗收與後續改進 | [改進追蹤計畫](../PLAN.md)、[A–G 驗證紀錄](plans/workflow-improvements-verification.md)；[原八項歷史驗收](plans/workflow-tools-verification.md) |
| 目前狂戰熊任務目標的完成驗收（不自行啟動續玩） | [尋寶奇譚／青春物語／NPC劇情驗收](goals/berserker-questlines-continuation.md)；舊爬塔資料見[星塔續行封存](goals/berserker-tower-first-continuation.md) |
| 角色名稱、職業、等級來源與命名限制 | [CHARS.md](CHARS.md) |
| 某次操作、資源變化與戰報 | [NOTES.md](NOTES.md)，依日期進入月分卷 |
| 例行操作或失敗追蹤 | [LOG.md](LOG.md)，依日期進入月分卷 |
| 原文查閱、截斷與證據缺漏 | [compact-context-feedback.md](compact-context-feedback.md)，依日期進入月分卷 |
| 遊玩程序與已觀察指令 | [遊玩 skill](../skills/playing-bear-of-bears/SKILL.md)、[指令參考](../skills/playing-bear-of-bears/commands.md) |
| 配裝權重與完整性核驗 | [配裝 skill](../skills/bears-equipment-strategy/SKILL.md) |
| 公開圖鑑與配方研究 | [研究 skill](../skills/research-bears-equipment/SKILL.md) |

## 文件狀態與更新規則

- **目前規則**：`AGENTS.md` 是 repository 通用授權的單一來源；skill 提供可重用程序，不新增本帳號權限。`GOAL.md` 只定義目前契約，不保存進度。
- **最後觀測**：角色表與續行資料只保留最新可用摘要，附時間與來源。下一筆操作仍須重新核驗，文件整理不能刷新觀測時間。
- **歷史紀錄**：`notes/`、`logs/`、`context-feedback/` 按 `YYYY-MM.md` 分卷；原有入口提供日期索引。未明示日期的原章節保存在各目錄 `legacy.md`，不猜日期。
- **歷史封存**：下列檢查點、研究、調查及舊契約保留當時結論，不是目前遊戲指令或授權。不可用舊目標、禁止／允許條款覆蓋目前規則。
- 更新現況時取代受影響摘要，不追加整批戰報；新明細只寫入所屬分卷並更新日期入口。
- 每筆新紀錄包含完整日期、時間／時區、來源 ID 與唯一 HTML anchor，例如 `<a id="2026-10-17-0942-iron"></a>`。引用文字包含日期、時間與主題，連結目標使用分卷路徑加該 anchor；此 anchor 為格式範例，不是現有證據定位。
- 本次遷移產生的 `record-NNNN` anchor 固定不變，不因重排或新增紀錄重新編號。不要只用「詳 NOTES09:10」作新引用。

## 戰鬥文件判讀

以下依本次文件審查的最新使用者原則判讀，不啟用遊玩或背景工作，也不把歷史測試轉成新授權。

- 以**本人已勝的最高可比較強度**作為能力邊界。核對當前角色、裝備、HP／MP、技能、目標現身及退路後，可以重打已勝區間，並有限試探緊鄰上一階，不連跳。
- 「一階」不是 `Lv+1`，等級也不必連續；依目標等級、攻防、特殊機制、當前資源及本人實戰紀錄比較。不能只用等級、圖鑑已登錄或 `/consider` 判詞決定勝算；他角勝場也不能當本人邊界。
- 未知理論承傷上界或缺完整公式，不構成全面禁打理由。本人實戰樣本可支持條件相近的重打與有限試探，但不是理論上界或完整機制證明；不得捏造 `mechanicsComplete`，也不以文書標記解除工具實際護欄。
- 明顯危險不硬試；試探逐手確認，有危險即退／恢復，不以預排連擊、僥倖閃避或預期吸血硬撐。不能合理比較的特殊機制須另行判斷，不把一場的缺口擴張為所有候選禁打。

## 歷史檢查點與任務契約

- [狂戰熊星圖歷史契約，墊底輪值目標前，2026-10-17](goals/berserker-star-chart-before-lowest-rotation-2026-10-17.md)：舊目標未完成。
- [狂戰熊星圖歷史續行資料](goals/berserker-star-chart-continuation.md)：不是目前操作指令。
- [狂戰熊爬塔第一歷史契約，星圖羅盤目標前，2026-10-17](goals/berserker-tower-first-before-star-chart-2026-10-17.md)：舊目標未完成。
- [狂戰熊截至2026-10-24 22:26的歷史檢查點](goals/berserker-tower-checkpoint-through-2026-10-24-2226.md)：不是目前操作指令；現行續行入口見上表。
- [裝備力第一歷史契約，狂戰爬塔目標前，2026-10-17](goals/equipped-power-first-before-berserker-tower-2026-10-17.md)
- [裝備力第一原續行資料](goals/server-first-continuation.md)：不是目前輪值目標或驗收依據。
- [角色完整歷史，截至 2026-10-17](goals/characters-history-through-2026-10-17.md)
- [全服第一檢查點，2026-10-17](goals/server-first-checkpoint-2026-10-17.md)
- [全服第一歷史，截至 2026-10-13](goals/server-first-history-through-2026-10-13.md)
- [全服第一中斷檢討，2026-10-11](goals/server-first-interruption-review-2026-10-11.md)
- [なるみ安全清王契約，2026-10-11 前](goals/narumi-safe-clear-before-server-first-2026-10-11.md)
- [なるみ安全清王檢查點，2026-10-10](goals/narumi-safe-clear-checkpoint-2026-10-10.md)
- [多角色安全清王契約，2026-10-09 前](goals/safe-clear-multi-character-before-narumi-2026-10-09.md)
- [清王契約，2026-10-08 前](goals/clear-bosses-before-safety-2026-10-08.md)
- [なるみ舊星塔與收藏契約](goals/narumi-tower-gallery-previous.md)
- [圖鑑檢查點，2026-09-30](bestiary-goal-checkpoint-2026-09-30.md)
- [圖鑑檢查點，2026-09-28](bestiary-goal-checkpoint-2026-09-28.md)
- [裝備力檢查點，2026-09-24](equipment-power-checkpoint-2026-09-24.md)
- [裝備力操作紀錄，2026-09-24](equipment-power-operation-2026-09-24.md)

## 研究與驗證

- [重生看板使本人狀態誤失效，2026-10-22](investigations/boss-respawn-status-barrier-2026-10-22.md)：780804完整原文與嚴格35條單頁辨識；28新增回歸／全76檔1332項、build通過，未reload，不將存活板當現身／本人資格或安全證明。

- [公開地圖漏裂隙圖層與導航保護，2026-10-20](investigations/world-rift-layer-2026-10-20.md)：保存實際7房並排除boss原值0的裂隙非安全房自動導航／掛機；71檔1232項＋build通過，另真實公開URL查210／211通過。當前session仍須reload，未Telegram／實機通行驗證。

- [原生爆擊追擊與先機閃避解析，2026-10-20](investigations/combat-native-followup-2026-10-20.md)：770320／282實際fixture與G對帳回歸；24檔685項＋build通過，仍須reload、未遊戲內驗證，不解除技能成本或承傷未知。

- [Agent 與 extension 安全性及效率改進計畫，2026-10-19](plans/2026-10-19_agent-extension-improvement-plan.md)：五個查詢工具的常駐介面通過；68檔／1,222項測試及 Pi SDK1.3.0 隔離測試通過。固定六案例74.6%減量、故障映射、環境與界線見[離線驗收](plans/2026-10-19_agent-extension-acceptance.md)。最後 reload 已依使用者回報記錄，程式指紋與驗收版本一致；未量測真實模型端到端或透過副作用獨立觸發新護欄，無須為文件更新再次 reload。

- [九角星塔70層優先角色研究，2026-10-18](investigations/tower70-character-priority-2026-10-18.md)：本人戰力、承傷缺口、輸出及現有補強比較；結論不是70層通關證明。

- [遊玩 extensions 改進追蹤計畫](../PLAN.md)：RPC 診斷、事件分類、背包摘要、收益帳本、不可逆操作預檢與續行檢查點；A／C 已離線驗證，其餘部分交付，完整狀態見驗證紀錄。
- [原八項 tools 歷史計畫](plans/workflow-tools-original-plan.md)、[逐項離線驗證](plans/workflow-tools-verification.md)：保留原實作範圍、授權界線與驗收證據；不是目前實作待辦或遊戲操作契約。

- [BOSS 歷史參考](BOSSES.md)：來源數值與安全結論須即時重驗。
- [裝備研究，2026-09-24](equipment-research-2026-09-24.md)
- [optimizer 驗證紀錄](equipment-optimizer-verification.md)
- [optimizer 計畫，2026-09-07](plans/2026-09-07_equipment-optimizer-plan.md)

- [狂戰熊星塔95層歷史契約，劇情任務目標前，2026-10-25](goals/berserker-tower95-before-quests-2026-10-25.md)：舊目標未完成；目前契約見根目錄GOAL.md。

## 問題調查與 review 紀錄

- [原生套裝status誤拒絕，2026-10-24](investigations/status-set-bonus-classification-2026-10-24.md)：798299真實fixture重現套裝行／無句號提示漏接；全96檔1544項＋build通過，尚未reload或實機導航驗收。

- [冥界之門敘事與房名誤拒絕，2026-10-24](investigations/navigation-gate-lore-2026-10-24.md)：795522到達原文、524新定位；嚴格敘事行例外與🚪標題辨識，8新增回歸／全79檔1354項、build通過，未reload／新版門內導航實機驗收。

- [原生裂甲與蠻力衝撞解析，2026-10-24](investigations/native-armor-charge-2026-10-24.md)：795245／247真實原文、嚴格格式與目標／數字核驗；全78檔1346項及build通過，未reload／新版實機驗收，不推敵DEF或傷害倍率。

- [Telegram限流診斷資訊遺失，2026-10-22](investigations/telegram-flood-diagnostics-2026-10-22.md)：保留階段、可辨識RPC與cause，六個新回歸、75檔1304項與build通過；限流根因未明、未reload／實機驗證，不新增等待或重試。

- [Goal 回覆循環 runtime 斷路器，2026-10-21](investigations/goal-loop-guard-2026-10-21.md)：連續3次無成功工具或相同回覆時暫停重送、不標完成；保留前置 boundary entries 與完成／待送工作優先。73檔1,264項與build通過，未reload／真模型驗證；不是遊戲進展。

- [局部缺證擴張與低風險BOSS替代決策，2026-10-21](investigations/low-risk-boss-fallback-2026-10-21.md)：修正遊玩規則、Goal續行提示與任務檢查點；提示回歸不代表模型行為或實際戰鬥驗證，未新增自動停止或放寬安全界線。

- [Workflow回覆觀測時間與未來日期護欄，2026-10-21](investigations/workflow-observation-timing-2026-10-21.md)：實際extension離線回歸證明observedAt在回覆後記錄；未來日期可條件重現status後停止，現場根因仍缺檢查時刻／runtime證據。未改production或放寬檢查，主線72檔1236項及build通過，不宣稱實機已修復。

- [BOSS 圖鑑造成 workflow 觀測失效，2026-10-20](investigations/workflow-boss-catalogue-2026-10-20.md)：修正精確 `/boss` 查詢分類與嚴格原生連續頁辨識，補失效來源診斷；21檔668項離線測試與build通過。需reload，尚未實機驗證；`/consider`仍可能獨立使舊status失效，不宣稱完整主線已修復。

- [Combat snapshot 的 status 新鮮度診斷，2026-10-20](investigations/combat-status-freshness-2026-10-20.md)：原生狂戰熊status於33秒／60秒可解析；僅改善過期診斷，原次runtime缺漏原因仍未確認。

- [星塔免費入場與跨日恢復查證，2026-10-17](investigations/tower-free-entry-verification-2026-10-17.md)

- [Codex provider 失敗，2026-10-14](investigations/codex-provider-failure-2026-10-14.md)
- [Codex error，2026-10-13](codex-error-investigation-2026-10-13.md)
- [Codex request，2026-10-13](codex-request-investigation-2026-10-13.md)
- [pi Goal error，2026-10-13](pi-goal-error-investigation-2026-10-13.md)
- [PR 1 review ledger](pr-1-review-ledger.md)
- [PR 3 review ledger](pr-3-review-ledger.md)

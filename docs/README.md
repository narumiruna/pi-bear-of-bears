# 文件入口

先依問題選擇下列入口，不必先讀完整遊玩歷史。文件中的數值都是觀測紀錄，不證明遊戲目前狀態。

## 查詢入口

| 需要的資訊 | 先讀 |
| --- | --- |
| 安裝、登入、啟動與工具功能 | [專案 README](../README.md) |
| 開發規則、遊戲授權與禁止事項 | [AGENTS.md](../AGENTS.md) |
| 目前目標與驗收條件 | [GOAL.md](../GOAL.md) |
| 最近進展、下一步與局部缺口 | [狂戰熊主動、其餘八角掛機續行資料](goals/berserker-active-others-idle-continuation.md) |
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

## 歷史檢查點與任務契約

- [狂戰熊星圖歷史契約，墊底輪值目標前，2026-10-17](goals/berserker-star-chart-before-lowest-rotation-2026-10-17.md)：舊目標未完成。
- [狂戰熊星圖歷史續行資料](goals/berserker-star-chart-continuation.md)：不是目前操作指令。
- [狂戰熊爬塔第一歷史契約，星圖羅盤目標前，2026-10-17](goals/berserker-tower-first-before-star-chart-2026-10-17.md)：舊目標未完成。
- [狂戰熊爬塔歷史續行資料](goals/berserker-tower-first-continuation.md)：不作為目前操作指令。
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

- [Agent 與 extension 安全性及效率改進計畫，2026-10-19](plans/2026-10-19_agent-extension-improvement-plan.md)：五個查詢工具的常駐介面通過；68檔／1,222項測試及 Pi SDK1.3.0 隔離測試通過。固定六案例74.6%減量、故障映射、環境與界線見[離線驗收](plans/2026-10-19_agent-extension-acceptance.md)。最後 reload 已依使用者回報記錄，程式指紋與驗收版本一致；未量測真實模型端到端或透過副作用獨立觸發新護欄，無須為文件更新再次 reload。

- [九角星塔70層優先角色研究，2026-10-18](investigations/tower70-character-priority-2026-10-18.md)：本人戰力、承傷缺口、輸出及現有補強比較；結論不是70層通關證明。

- [遊戲流程 tools 實作計畫](../PLAN.md)、[逐項離線驗證](plans/workflow-tools-verification.md)：原八個 LLM tools 的實作範圍、授權界線與驗收證據；新增本機背包篩選見上述改進計畫，不是遊戲操作契約。

- [BOSS 歷史參考](BOSSES.md)：來源數值與安全結論須即時重驗。
- [裝備研究，2026-09-24](equipment-research-2026-09-24.md)
- [optimizer 驗證紀錄](equipment-optimizer-verification.md)
- [optimizer 計畫，2026-09-07](plans/2026-09-07_equipment-optimizer-plan.md)

## 問題調查與 review 紀錄

- [Combat snapshot 的 status 新鮮度診斷，2026-10-20](investigations/combat-status-freshness-2026-10-20.md)：原生狂戰熊status於33秒／60秒可解析；僅改善過期診斷，原次runtime缺漏原因仍未確認。

- [星塔免費入場與跨日恢復查證，2026-10-17](investigations/tower-free-entry-verification-2026-10-17.md)

- [Codex provider 失敗，2026-10-14](investigations/codex-provider-failure-2026-10-14.md)
- [Codex error，2026-10-13](codex-error-investigation-2026-10-13.md)
- [Codex request，2026-10-13](codex-request-investigation-2026-10-13.md)
- [pi Goal error，2026-10-13](pi-goal-error-investigation-2026-10-13.md)
- [PR 1 review ledger](pr-1-review-ledger.md)
- [PR 3 review ledger](pr-3-review-ledger.md)

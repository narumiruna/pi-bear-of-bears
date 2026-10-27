/** 只供預覽的建議契約變更；D1–D6核定前不寫回有效規則。 */
export interface RecordsRuleChange {
  path: string;
  oldText: string;
  newText: string;
}
export const RECORDS_CUTOVER_RULES: RecordsRuleChange[] = [
  {
    path: "AGENTS.md",
    oldText:
      "- `start_idle` 失敗時，在 `docs/LOG.md` 記錄原因與各角完成／未完成狀態，再改善對應 extension 或 skill，並完成相關檢查。",
    newText:
      "- `start_idle` 失敗時，以 `records_append` 新增 `log` 紀錄，保存原因與各角完成／未完成狀態，再改善對應 extension 或 skill，並完成相關檢查。",
  },
  {
    path: "AGENTS.md",
    oldText:
      "先由 `docs/README.md` 選擇入口；現況摘要、操作明細與歷史封存分開讀寫。新引用須使用完整日期與分卷 anchor，不只寫時間。",
    newText:
      "先由 `docs/README.md` 選擇入口；現況摘要、操作明細與歷史封存分開讀寫。個人戰報與例行日誌只寫入 SQLite：以 `records_append` 新增、`records_revise` 保留舊版修訂，request key 不盲換，衝突不覆寫；寫入失敗不退回 Markdown。保存明示事件日期、時間／時區及來源；未知不補猜。新引用使用工具回傳的 databaseId／紀錄 ID／revision，不只寫時間；Markdown 原文回饋仍保留日期與 anchor。歷史資料不刷新狀態或授權。",
  },
  {
    path: "AGENTS.md",
    oldText:
      "| `docs/NOTES.md` → `docs/notes/YYYY-MM.md` | 日期索引 → 逐場戰報、投入／收益、換裝前後數值與操作結果 |\n| `docs/LOG.md` → `docs/logs/YYYY-MM.md` | 日期索引 → 例行操作與失敗追蹤 |",
    newText:
      "| SQLite `note` 紀錄 | `records_search`／`records_get` 查逐場戰報、投入／收益、換裝前後數值與操作結果 |\n| SQLite `log` 紀錄 | `records_search`／`records_get` 查例行操作與失敗追蹤 |",
  },
  {
    path: "docs/README.md",
    oldText: "SQLite 個人紀錄庫（尚未正式切換）",
    newText: "SQLite 個人紀錄庫（個人戰報與日誌的唯一正式來源）",
  },
  {
    path: "docs/README.md",
    oldText:
      "| 某次操作、資源變化與戰報 | [NOTES.md](NOTES.md)，依日期進入月分卷 |\n| 例行操作或失敗追蹤 | [LOG.md](LOG.md)，依日期進入月分卷 |",
    newText:
      '| 某次操作、資源變化與戰報 | `records_search({kind: "note"})` → `records_get`，見[紀錄庫](records.md) |\n| 例行操作或失敗追蹤 | `records_search({kind: "log"})` → `records_get`，見[紀錄庫](records.md) |',
  },
  {
    path: "docs/README.md",
    oldText:
      "- **歷史紀錄**：`notes/`、`logs/`、`context-feedback/` 按 `YYYY-MM.md` 分卷；原有入口提供日期索引。未明示日期的原章節保存在各目錄 `legacy.md`，不猜日期。",
    newText:
      "- **歷史紀錄**：個人戰報與例行日誌在 SQLite，以 records tools 查閱；原文查閱回饋仍在 `context-feedback/YYYY-MM.md` 與日期索引。匯入資料的未知日期、角色及時區維持未知，不從舊檔名補猜。",
  },
  {
    path: "docs/README.md",
    oldText:
      "- 更新現況時取代受影響摘要，不追加整批戰報；新明細只寫入所屬分卷並更新日期入口。",
    newText:
      "- 更新現況時取代受影響摘要，不追加整批戰報；個人明細以 `records_append` 新增，修訂使用 `records_revise`。原文查閱回饋仍更新其 Markdown 分卷與日期入口，不建立個人戰報 Markdown 副本。",
  },
  {
    path: "docs/README.md",
    oldText:
      '- 每筆新紀錄包含完整日期、時間／時區、來源 ID 與唯一 HTML anchor，例如 `<a id="2026-10-17-0942-iron"></a>`。引用文字包含日期、時間與主題，連結目標使用分卷路徑加該 anchor；此 anchor 為格式範例，不是現有證據定位。\n- 本次遷移產生的 `record-NNNN` anchor 固定不變，不因重排或新增紀錄重新編號。不要只用「詳 NOTES09:10」作新引用。',
    newText:
      "- 新個人紀錄保存明示日期、時間／時區與來源 ID，使用工具回傳的 `records:<database-id>/<record-id>@<revision>` 文字引用，不建 HTML anchor、不自行編造 ID。原文回饋仍使用日期與唯一 HTML anchor。\n- 舊路徑、anchor、時刻簡稱與集合引用由 `records_resolve` 解析；多筆定位不任選，續頁固定 snapshot。這些是本機紀錄引用，不是仍可寫入的舊檔或瀏覽器網址。",
  },
  {
    path: "skills/playing-bear-of-bears/SKILL.md",
    oldText:
      "日期索引只保留入口摘要，不在三處重複流水帳。將紀錄及精簡的最新檢查點寫入其指定位置；在來源儲存庫內依 `docs/README.md` 與 `docs/NOTES.md` 索引，將明細寫入當月 `docs/notes/YYYY-MM.md`，只在任務續行文件更新最新檢查點。",
    newText:
      "不在多處重複流水帳。在來源儲存庫內依 `docs/README.md` 及 `docs/records.md`，以 `records_append` 新增 `note` 明細，修訂用 `records_revise` 保留歷史；不寫回舊 Markdown、不另建日期索引。工具確認 commit 才回報記錄成功；request key 重送不盲換，版本衝突不覆寫。只在任務續行文件更新精簡的最新檢查點。",
  },
  {
    path: "skills/playing-bear-of-bears/SKILL.md",
    oldText:
      "在來源儲存庫內，`docs/NOTES.md` 是完整遊玩紀錄的索引，明細以其連結的月分卷為來源；單獨使用套件不依賴這些個人文件。",
    newText:
      "在來源儲存庫內，完整遊玩紀錄由 `records_search` 搜尋、`records_get` 固定 revision 分頁查閱；舊引用由 `records_resolve` 定位，不任選歧義結果。單獨使用套件不依賴來源儲存庫的個人資料。",
  },
  {
    path: "skills/playing-bear-of-bears/references/leveling-and-equipment.md",
    oldText: "僅在來源儲存庫內依適用規則使用 `docs/NOTES.md`。",
    newText:
      "僅在來源儲存庫內依適用規則用 `records_append` 新增 `note`，修訂用 `records_revise` 保留舊版；不建立個人 Markdown 副本。",
  },
  {
    path: "README.md",
    oldText:
      "手動遊玩觀測由 [docs/NOTES.md 日期索引](docs/NOTES.md) 連至月分卷；",
    newText:
      "手動遊玩觀測由 [SQLite 個人紀錄庫](docs/records.md) 的 `records_search`／`records_get` 查閱；",
  },
  {
    path: "README.md",
    oldText: "月報與索引不複製流水。",
    newText: "個人明細只寫入 SQLite，不複製到檢查點。",
  },
  {
    path: "docs/ledger.md",
    oldText:
      "匯出不改 `GOAL.md`、月報、日期索引或其他續行文件，不刪舊 anchor。單一最新檢查點留在該產物；月報只寫通層、換裝、新機制、事故及差額，日期索引只留入口，不再三處重複流水。",
    newText:
      "匯出不改 `GOAL.md`、SQLite 個人紀錄或其他續行文件。單一最新檢查點留在該產物；通層、換裝、新機制、事故及差額以 `records_append` 新增 `note`，修訂以 `records_revise` 保留舊版，不建立月報或日期索引副本。",
  },
  {
    path: "README.md",
    oldText:
      "- SQLite 個人紀錄庫與離線遷移：[開發與切換狀態](docs/records.md)；目前尚未取代既有 Markdown。",
    newText:
      "- SQLite 個人紀錄庫與離線遷移：[查詢、寫入與復原](docs/records.md)；個人戰報與日誌只維護 SQLite，不另存 Markdown。",
  },
  {
    path: "docs/ledger.md",
    oldText:
      "是獨立的敘述儲存，不是遊戲觀測來源，目前 repository 的正式切換仍待核定。",
    newText:
      "是個人敘述紀錄的唯一正式來源，與遊戲觀測帳本分開，不提供操作資格。",
  },
  {
    path: "docs/records.md",
    oldText:
      "目前為開發／演練介面，**尚未正式遷移或刪除 Markdown**。正式切換仍需 [SQLite 計畫](plans/2026-10-27_sqlite-records-plan.md) 的 D1–D6 核定；以下路徑及單機策略依建議值開發，不代表使用者已接受失去 GitHub 瀏覽或選定第二份備份位置。切換前 `AGENTS.md` 的既有紀錄寫入規則保持有效，不同時維護兩份正式資料。",
    newText:
      "個人戰報與例行日誌以 SQLite 為唯一正式來源，不保留可持續寫入的舊 Markdown。此狀態只在 D1–D6 已核定、正式匯入、備份還原、規則與引用切換以及載入驗收完成後生效；不能只因預覽包含本段就宣稱已切換。資料位置與備份責任依正式交接，不將 clone／checkout 當成資料復原。",
  },
  {
    path: "docs/records.md",
    oldText: "- 預設開發位置：專案",
    newText: "- 預設位置：專案",
  },
  {
    path: "docs/README.md",
    oldText: "開發介面、離線遷移與備份",
    newText: "使用介面、離線遷移與備份",
  },
  {
    path: "docs/records.md",
    oldText: "- 尚未完成：正式 DB／第二份位置核定",
    newText: "- 2026-10-27 離線驗收時尚未完成：正式 DB／第二份位置核定",
  },
];

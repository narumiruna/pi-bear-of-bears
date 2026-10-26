# 持久化帳本

帳本保存操作意圖、遊戲觀測與版本化解析，提供歷史資源、條件化戰鬥證據及效率報表。**帳本查詢不建立 Telegram 連線，也不選擇下一手、重送、恢復戰鬥或刷新操作資格。** 本人 ID 由既有 transport 正常連線取得；未決操作仍依新 history 釐清。

## 啟用與停用

需要 Node.js 22.19.0 以上；使用內建 `node:sqlite`，沒有新增 driver dependency。最低版本會顯示 SQLite experimental warning；支援範圍不包含未測的 Bun runtime。

不需要設定帳號。套件預設啟用身分等待；`BEARS_LEDGER_ACCOUNT` 已移除且不影響映射。只有可選設定：

```sh
# 停用帳本
export BEARS_LEDGER=0
# 或指定私有資料根目錄；不設定則使用 Pi agent 預設位置
export BEARS_LEDGER_DIR="$HOME/.pi/agent/bear-of-bears"
```

- 正常 Telegram 連線在完成既有授權與 bot 對象檢查後呼叫 `getMe()`，只使用已登入的**使用者本人 ID**，不是 bot、chat、username、電話或遊戲角色。ID 保留為完整十進位字串，不轉成可能失真的 JS Number。
- 首次確認本人 ID 後才開啟 `<user-id>.sqlite` 私有庫，內部帳號仍為 `telegram-<user-id>`，同一 Telegram 帳號的所有角色共用此庫。無身分時不猜預設帳號；`enabled=true` 只表示功能啟用，diagnostics 會明示等待身分。查帳不會為此主動登入。
- 預設位置為 `<agent-dir>/bear-of-bears/<user-id>.sqlite`，根目錄為 `resolve(getAgentDir(), "bear-of-bears")`，跟隨 `PI_CODING_AGENT_DIR`。`./run.sh` 未覆寫環境變數時，使用 repository 內的 `.pi/agent/bear-of-bears/<user-id>.sqlite`；外部覆寫仍優先。設定 `BEARS_LEDGER_DIR` 時直接保存為 `<BEARS_LEDGER_DIR>/<user-id>.sqlite`。對話仍固定為 `@BearOfBearsBot`，不得提交私人帳本至 Git。
- factory 只註冊；`session_start` 只安裝延後綁定控制器，shutdown 冪等關閉。不新增 watcher、timer、輪詢或 continuation。相同程序拒絕重複安裝；工具與 watch 帶 SDK session 身分，另一 session 的 command 送出前拒絕，history 仍可讀但不串入原帳本。
- 每次既有 transport 新連線會在需要自動帳本時呼叫一次 `getMe()`；實際新增 RPC 與耗時取決於 SDK cache，`account_identity` 階段另列診斷。停用時不為帳本查本人身分，沒有額外連線、輪詢或 retry。本次未量測這項實機成本。
- 單一 Pi session 確認身分後若看到不同 Telegram 登入者，會拒絕相依派送並失效舊視圖，直到重新載入；不將另一帳號回覆寫入舊庫。正常遊戲角色切換不影響 Telegram ID，不需任何設定。
- 舊目錄保留，不掃描、fallback、改名或自動合併。舊手動標籤不能證明資料所屬 Telegram ID，不直接改名接管。內部帳號、schema v1、事件 ID 與 Pi 分支引用不變；已有 ID 庫須先完成下節離線切換，不搬動使用中的 DB。
- 更改環境變數後，須由使用者重新啟動或明確 reload。**不要為部署帳本而 reload 正保留挑戰的工作階段。** 本次實作沒有 reload 現場。

身分確認後，送出前無法落盤會拒絕該筆派送；送出後故障保留遊戲工具回覆，`accounting.complete=false`，不能當成遊戲失敗。`bears_history` 不被資料庫故障阻斷；一般身分讀取失敗仍可補讀 history，但不寫入任何帳本、不允許派送。RPC 限流或取消仍停止，不能藉補查繞過。修復或明確停用後才再次操作。

## 唯讀查詢

四個工具均透過 Codemode 暴露，有嚴格參數與輸出 envelope；不接受 SQL、檔案路徑、任意資產調整或操作授權。

| 工具 | 用途 |
| --- | --- |
| `bears_ledger_status` | 最後觀測／推導的 HP、MP、金幣、確認收支、未決、衝突與來源。可用 `character` 查歷史角色；不代表目前控制角色。 |
| `bears_ledger_trace` | 以 `observationId` 查原文與 parser 版本，或以 `operationId` 查送達事件與來源鏈。只讀目前 ancestry 引用的資料。 |
| `bears_ledger_report` | 以 `character`、`fromMessageId`、`throughMessageId` 篩選本機區間；`afterObservationId` 限制舊戰鬥證據的重複輸出。 |
| `bears_ledger_checkpoint` | 最多 2400 字的檢查點預覽，可供續行頁或面板共用；不改檔。 |

```js
const status = await tools.bears_ledger_status({});
text(status);
// 查帳不表示可以接著攻擊；仍依既有來源、資格與授權規則判斷。
```

trace／report 回傳 `format="json_fragment"`，`offset` 是零起算 Unicode code point，`limit` 預設 4000、最多 6000。首頁回傳 `snapshot`；續頁必須帶相同條件與 `snapshot`，依 `nextOffset` 串接 `text` 才是完整 JSON。不要將單一片段當完整報表。

trace 的數字 ID 只對目前登入者的帳本有效，不能沿用其他帳號的觀測列號。snapshot 是本機凍結查詢，不代表新鮮度。每個實例最多保留 8 份，序列化內容合計 4 MiB、單份最多 2 MiB（不含 JavaScript 物件額外成本）；切樹、換 session、reload、shutdown 或容量淘汰後須從首頁重查。超限時縮小訊息區間或使用 `afterObservationId`。每次輸出另限 44 KB。

## 數字與未知資訊

- `accounting.confirmedMpCost` 是本手獨立確認的成本；`mpAfter` 只有角色、起點及中間連續性成立才推導。成本不是餘額，`null` 不是零。`accounting.complete` 不表示完整戰鬥機制或遊戲成功；所有查詢的 `operationalEligibility` 固定為 `false`。
- `prepared`／`submitted` 是本機意圖；`submitted` 在網路派送前保存，不能證明遠端執行。崩潰、空回覆或送達不明維持 `unresolved`，不自動 retry。`confirmed` 只表示有相符的可解析欄位；未知尾文仍可使餘額及完整戰鬥結論失效。
- 精確 outgoing echo、送出前邊界及唯一相符回執才建立關聯。不以時間最近、watch 先到或文字相同猜歸屬。不同 ID 的同文分別保留；同 ID／revision 的 send、history、watch 重讀只記一次事實。
- revision 無可比較編輯順序時保留衝突，不採「最後讀到」的版本。原文與舊 parser 版本保留；其他獨立成本不因此消失。
- 缺頁、未知角色、切角、未決、時鐘異常或外部變動失效相依欄位；新 status 可提供新歷史錨點，但不能解除未決或刷新操作資格。其他角色的具名掛機收入不列入本人塔帳。
- Pi 分支不是遊戲回溯。非 ancestry 的動作保存為外部缺口；後續 metric、usage 或舊 history 不會將它掩蓋。切樹後舊 ticket 的遲到觀測只進資料庫，不追加引用到新分支。
- 金額及資源使用安全整數，超界保持未知。報表中的合計只涵蓋確認回執，不是完整錢包或所有收益；新 status 不符時保留差額，不硬閉帳。

### 格式範圍（parser v5）

2026-10-26 parser v5修正血怒／嗜血的技內主動吸取來源分類，未知技的相同文案保留unknown，見[回血來源修正](investigations/combat-healing-source-2026-10-26.md)。v4修正先機與實傷間的精確庇護註記被誤判缺段，見[先機庇護修正](investigations/native-tower-initiative-cap-2026-10-26.md)；不允許任意效果插入或缺失實傷。v3新增獨立星淵共鳴與星塔庇護註記，離線驗證見[塔內註記修正](investigations/native-tower-effects-2026-10-26.md)；只保留觀測、不推生存上界。v2的原生恢復與合併套裝格式驗證見[原生恢復修正](investigations/native-ledger-recovery-2026-10-26.md)。舊資料須由使用者在載入新版後執行 `/bears-ledger rebuild` 補目前版本；不自動 reload 或重送遊戲操作。

| 可解析範圍 | 限制 |
| --- | --- |
| 共用完整 status parser | 排除含掛機預估的數值；不是目前操作資格。 |
| 共用原生技能／labelled replay parser | 保留事件順序、主動技能、裝備吸血、神話吸血、名目量及可推導的實補／溢補。首次治療前 HP 未知時不補猜。未知尾文不放寬既有 `complete`。 |
| 原生技能標頭 `✨ 使用技能：名稱（MP -數字）` | 唯一合法標頭可提供獨立成本；整手未知時仍不推 MP 餘額。 |
| 原生完整兩行休息回覆 `💤 充分休息後恢復了！`＋HP／MP | 只接受安全整數、明示全滿及唯一匹配 `/rest` 的回覆；以原文更新上限與餘額，不由此推免費或金幣不變。未知恢復前 MP 時，實補仍未知。 |
| 原生收刀 `💨 你趁亂逃跑了！`／`你沒有在戰鬥中。` | 唯一匹配 `/flee` 時確認送達及角色鏈；不推 HP／MP／金幣不變，須以後續原文重建。 |
| 完整 MP 不足回覆 | 不列成功或消耗；明列的目前 MP 可作歷史觀測。 |
| 共用 tower 面板及單則完整背包／已解析技能列 | 只記最後觀測的樓層、配裝／技能指紋；分頁背包不在帳本內另造放寬版拼接器。既有 workflow 的完整背包護欄不變。 |
| 原生完整勝利怪金、具名掛機回報、既有 replay 財務回執 | 首達合計不得再加一次怪金；兩端 status 差額獨立列示。 |
| `免費休息，HP／MP 已恢復。`、`通層回執：第…層` 的四行金額格式 | **僅為離線 labelled replay 協定，不宣稱是已驗證的原生休息／塔首達格式。** 原生未支援格式保存缺口，待正常遊玩取得原文後再補 fixture；不為補格式新增遊戲操作。 |

`unappliedNominal` 只表示名目量減實補；缺少治療衰減協定時不全部稱為 `overheal`。防護條件不足、沒有可比較舊樣本時，反例判定保持 null，不以 false 冒稱已排除反例。

沒有穩定 server encounter ID 時，只提供具來源的本機區間。防護政策與盾耗次未記錄時明列 unknown，不假設與舊樣本相同；血量分組不是已知狂暴門檻。條件差異、實傷與反例不等於理論上界、勝率或下一手批准。

效率報表分開確認 MP、已知部分實傷、完整實傷、兩次確認恢復之間的週期、工具耗時、首達與可重複收益。未知起點不以名目傷害補零或補實傷；已包含真傷不重加。時間使用區間聯集，不重加父子呼叫；中斷不是已證明的等待原因。模型 usage 與文件耗時只按分支記錄，缺資料保持 unknown，不精確分攤到單手。既有 metrics JSONL 只新增隨機 `operationIds`，仍不保存原始 tool-call ID 或引數。

## 文件預覽與匯出

```text
/bears-ledger status
/bears-ledger export-preview
/bears-ledger export-write
```

前兩個指令不寫 repository。只有獨立的 `export-write` 才會寫固定的 `docs/goals/bears-ledger-checkpoint.md`；目錄須已存在。它檢查預覽後來源／檔案是否改變，只能建立新檔或替換上次未人工修改的完整產物，拒絕 symlink／hardlink。新檔使用 exclusive link，不覆寫預覽期間別人建立的檔案；同一產物更新時不要同時用其他編輯器修改。

匯出不改 `GOAL.md`、月報、日期索引或其他續行文件，不刪舊 anchor。單一最新檢查點留在該產物；月報只寫通層、換裝、新機制、事故及差額，日期索引只留入口，不再三處重複流水。既有人工續行頁不自動搬移，未獲新遊玩資料時也不更新舊現場。

## 隱私、容量與復原

- 新目錄 0700、檔案 0600；拒絕路徑中的 symlink、資料檔 hardlink 及過寬權限，不自動 chmod 既有資料。既有私有父目錄中的子路徑須使用真實絕對路徑。
- 保存必要 bot 原文及記帳指令引數；自由文字、聊天指令引數不進永久帳本，outgoing 按鈕不保存。trace 會明示未保存文字；revision 仍指向原來源。完整原文工具沿用既有私有儲存，帳本不另外抓取聊天或憑證。
- 資料庫含私人角色、訊息 ID、session／call 關聯及遊戲內容；不要提交 Git 或貼到公開 wiki。trace／report 給模型時仍是不受信任資料，不能當成 Agent 指示。
- foreign keys、WAL、`synchronous=FULL`、1 秒 busy timeout；schema v1 只初始化空 v0。未知版本或非空 v0 拒絕，不自動刪庫。每個 DB／WAL／SHM 檔案限 256 MiB，事件限 200000；達限前備份並封存，改用新的私有根目錄。新庫沒有舊帳，不猜期初。

### 備份、還原與停用演練

1. 在不進行遊戲操作時執行 `/bears-ledger backup`，取得 `<ledger-root>/backups/<uuid>.sqlite` 私有備份。使用 SQLite `VACUUM INTO`，包含已提交 WAL，並以 `quick_check` 驗證。備份仍記錄原本的內部帳號，不以 UUID 判定擁有者。**不要只複製開啟中的主 DB。**
2. 若落盤失敗或資料庫損壞，先停止受影響操作並關閉使用該庫的 Pi 程序。保留該帳號 DB、同名 WAL／SHM 與備份；扁平根目錄可能含其他帳號，不移除整個共用根目錄。若無法備份，不刪檔、不重建空庫掩蓋問題。
3. 回退時設定 `BEARS_LEDGER=0` 再重新啟動。這只停用帳本，不撤銷遊戲動作，也不解除未決或授權限制。
4. 還原時建立新的 0700 私有根目錄，將已驗證備份放為 `<user-id>.sqlite`、權限 0600；ID 必須符合備份的內部 `telegram-<user-id>` 帳號。目的 DB／WAL／SHM 任一存在時停止，不覆寫、不合併、不混入舊 sidecar。設定新的 `BEARS_LEDGER_DIR` 後，由同一登入者重新啟動及正常連線確認。舊手動標籤庫不直接改名接管；ID 舊庫切換依下節。
5. `/bears-ledger rebuild` 由保存原文補上目前 parser 版本並清除資源投影快取，保留舊版本與防覆寫匯出 hash。再次查 status／trace，核對來源、未決及 `operationalEligibility=false`。沒有原文或 ancestry 引用時列缺口；不重送任何 Telegram 操作。
6. 初版沒有既有 production schema 升版；空 v0→v1 在交易內初始化，未知舊庫拒絕。日後真正升版前仍須完整備份，不能以本次新庫演練宣稱所有遷移已驗證。

### 舊 ID 庫的一次性離線切換

**本程序須由使用者安排停機；本次實作沒有停止現場程序、搬移正式資料或操作遊戲。** 未還原前以新版正常連線會建立新空庫，不能視為接續舊帳。若目的檔已存在，先停止並保存兩邊資料，不直接覆寫或合併。

1. 關閉所有使用舊庫的 Pi 程序，保留舊帳號目錄及 DB／WAL／SHM。此後不再用舊版寫入。只處理先前由正常連線驗證過本人 ID 的 schema v1 庫；舊手動標籤庫不在此程序範圍。
2. 在 source checkout 執行 `npm run build`，再執行下列離線備份。將 `/absolute/old/.../ledger.sqlite` 替換為舊 ID 庫的真實絕對路徑，將 `<user-id>` 替換為已驗證本人 ID 的完整十進位字串。命令只讀取舊庫驗證 owner，再沿用 `LedgerStore.backup()` 的 `VACUUM INTO`／`quick_check`。失敗時停止並保留舊庫，不以關閉程序前的較早備份代替最後寫入。

   ```sh
   node --input-type=module - '/absolute/old/by-telegram-id/telegram-<user-id>/ledger.sqlite' '<user-id>' <<'JS'
   import { DatabaseSync } from "node:sqlite";
   import { LedgerStore } from "./dist/src/ledger-store.js";
   import { telegramLedgerAccount } from "./dist/src/telegram-user-id.js";
   const [path, id] = process.argv.slice(2);
   const account = telegramLedgerAccount(id);
   const check = new DatabaseSync(path, { readOnly: true });
   try {
     if (check.prepare("PRAGMA user_version").get()?.user_version !== 1 ||
         check.prepare("SELECT account FROM ledger_meta WHERE id=1").get()?.account !== account) {
       throw new Error("舊庫 schema 或 owner 不符；停止。");
     }
   } finally {
     check.close();
   }
   const store = new LedgerStore(path, account);
   try { console.log(store.backup()); } finally { store.close(); }
   JS
   ```

3. 將命令輸出的已驗證備份還原到新根目錄。新根目錄為 0700，目的檔為 `<user-id>.sqlite`、0600；只複製備份，不複製舊 WAL／SHM。以 exclusive create 複製，例如 Node.js 的 `copyFileSync(backup, destination, constants.COPYFILE_EXCL)`；目的 DB／WAL／SHM 任一存在時停止。自訂根目錄時設定 `BEARS_LEDGER_DIR`，不得保留舊帳號子目錄層級。
4. 完成還原後才以新版啟動。保留原 Pi session 的 `bears-ledger-ref` ancestry，不改其中的 `telegram-<user-id>`、context 或 event ID。下一次正常授權連線確認本人 ID 後，以本機 status／trace 核對來源、操作 ID、未決及分支資料；不為驗收新增遊戲指令。缺少原文或 ancestry 時記錄缺口，不推期初。
5. 切換後尚無新資料時，可關閉新版並回到舊版及原位置。新庫若已有新資料，先備份並停止，不直接退回過期舊庫或自動合併，須另行決定保留方式。也可設定 `BEARS_LEDGER=0` 暫停帳本，但不解除未決或遊戲限制。

路徑與合成切換驗收見[2026-10-26 路徑驗證](investigations/ledger-path-verification-2026-10-26.md)。正式資料切換及正常連線後的現場核對仍待使用者安排。

自動身分對應見 [Telegram ID 驗收](investigations/telegram-ledger-identity-verification-2026-10-26.md)；初版記帳與量測見 [2026-10-26 驗證紀錄](investigations/bears-ledger-verification-2026-10-26.md)。未驗證 Telegram／真模型端到端效能，不為驗收恢復舊挑戰或新增戰鬥。

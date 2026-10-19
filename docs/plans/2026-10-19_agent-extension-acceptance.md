# Agent 與 extension 改進：六案例離線驗收

> 2026-10-20 03:03 +0800 更新最後 reload 回報；離線量測與測試證據仍為前輪結果。對應[改進計畫](2026-10-19_agent-extension-improvement-plan.md)。這是固定 client、模擬 transport 及指定版本的驗證，不是遊戲操作授權、所有故障的窮舉或真實模型端到端測量。

## 結論與範圍

1. 六案例受控比較：44,405→11,274 tokens，降低 **74.6%**；119,063→31,499 bytes。模擬遊戲指令18→18、history 7→7；錯誤副作用送出均為0。
2. 已補齊下表所列正常／故障回歸映射，包含兩階 forge 的新價、逐階對帳、意外換裝及原裝遺失。這不表示未列出的交錯順序或原生格式都已驗證。
3. 本機 Pi SDK1.1.0：68個測試檔、1,222項測試、CI檢查及 build 通過。獨立環境的 pi-coding-agent／pi-ai／pi-tui 均固定1.3.0，1,222項測試及 build 也通過，包含實際 loader／Codemode worker。
4. 五個查詢工具已在常駐 extension 驗證為物件回傳。使用者最後回報已 reload；磁碟程式指紋與已驗收版本一致，未另以真實付款觸發新 forge 對帳護欄。付費、換裝、戰鬥等遊戲副作用仍未實機驗收。

## 固定版本、資料及重跑方法

在原始碼 checkout 執行：

```bash
npm run ci
npm run benchmark:agent-extension
```

- benchmark 程式：[runner](../../benchmarks/run-agent-extension.mjs)、[六案例](../../benchmarks/agent-extension.test.ts)、[結果 snapshot](../../benchmarks/__snapshots__/agent-extension.test.ts.snap)。一般 npm test 仍只跑 tests/；benchmark 使用獨立 config，不使一般 CI 依賴完整 Git 歷史。
- 參照版本固定為 `20b70ac3ab4217df1ffa333d6466adf644d9bebf`。它是 Git 參照點，不代表開始工作時整份 dirty worktree 的備份；差異不能全部歸因於本輪變更。
- 目前程式指紋：`6c25f985c3242d1bed4dd20fdeba6f35d7eb6e6378b7b08c4f52e9d433906376`。runner 對排序後的 src/*.ts、測試 harness 與 benchmark client 內容計算 SHA-256；不是 commit ID。
- runner 只將指定版本的 src、package.json、離線 harness 匯出到私有 benchmarks/.baseline，使用同一組本機依賴；不切換工作樹、不安裝套件、不連網。目錄已存在或 Git 參照不存在時停止，不覆寫、刪除或自動 fetch。
- 正常結束或測試失敗都清除自己建立的 baseline 及依賴 symlink；測試另清除自己產生的 overflow 檔。該目錄列入 .gitignore，不提交舊程式副本、node_modules 或 binary。
- client 禁止 fetch；Telegram transport、公開配方來源及回覆全部由 harness 模擬。沒有讀取真實 Telegram session 或送出遊戲指令。
- 背包及戰鬥案例固定310列、四頁規模，取自本輪已觀察的實際規模，但內容為合成資料，不複製私人完整背包。換裝等其餘案例沿用小型 fixtures；這個 workload 組成不得在比較後任意改變以追求門檻。
- tokenizer 固定 o200k_base，UUID 與64字元 hash 正規化；兩側使用相同規則。只計實際提供給固定 client 的完整結果，不在量測端截掉成本、警告或未知項。這是 SDK 結果的完整序列化量，不套用 Codemode 預設10,000 tokens展示截斷，也不是實際 provider 帳單；真實 client 若採預設截斷，不能把不完整預覽當作同等資訊。

本基準比較的是「舊版已提供的介面」與「新版對同一工作項目提供的介面」，不是完全相同能力的純 wire format 比較：

- 舊版無背包篩選，client 讀完整 combat snapshot；新版讀完整來源的 filtered subset。
- 舊版沒有戰鬥事件欄位，client 保留原文及 full snapshot；新版使用已解析事件及 summary，原始來源仍可定位。
- 新版增加 itemRef、多階材料合計與成本證據，所以部分案例輸出反而增加。這些差異在下表單列，不冒充舊版已具備的新能力。

## 六案例量測

| 案例 | 舊 bytes | 新 bytes | 舊 tokens | 新 tokens | 模擬指令 舊→新 | history 舊→新 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 完整／遲到四頁背包 | 63,496 | 2,315 | 23,869 | 836 | 1→1 | 1→1 |
| 一次單件換裝 | 5,973 | 7,645 | 2,145 | 2,835 | 9→9 | 2→2 |
| 兩階 forge 研究 | 1,990 | 5,822 | 709 | 1,960 | 0→0 | 0→0 |
| 一場有限戰鬥回放 | 40,364 | 6,746 | 15,152 | 2,337 | 0→0 | 0→0 |
| 原生免費星塔入口 | 1,651 | 1,710 | 565 | 651 | 2→2 | 0→0 |
| 無回覆後 reload／切角拒絕 | 5,589 | 7,261 | 1,965 | 2,655 | 6→6 | 4→4 |
| 合計 | 119,063 | 31,499 | 44,405 | 11,274 | 18→18 | 7→7 |

- client 的 workflow API 呼叫8→8，直接工具呼叫2→2；這不是「真實模型外層呼叫數」或模型請求次數。沒有用 wrapper 數量代替 Telegram 指令數。
- 原文查閱0→0；失效 snapshot 拒絕1→1；結果未知1→1。中斷案例的4次 history 包含2次必要 guard及最多2次結果查證，不是放寬補讀上限。
- 錯誤副作用從實際模擬送出序列與允許序列比對；唯一允許的副作用是換裝及中斷案例各1次 equip。這不表示正確副作用總數為0，也不等於真實帳號已換裝。
- 入口舊版回 needs_observation、無法確認原生資格；新版 ready／eligible=true，但兩側都不入塔。新版不是用降低檢查換取同樣的舊結果。
- 舊版沒有 itemRef、有序事件及多階合計；新版的相關能力斷言已通過。兩階 forge 是唯讀研究，不是未授權的自動付費執行器。
- 74.6%受310列背包／戰鬥 workload 影響，不能外推小背包或所有任務。原四 fixture 的14.9%、查詢格式37.4%、128列 summary 的73.5%維持各自樣本及語意，不合併宣稱純解碼改善率。

### 模擬執行時間

2026-10-20 02:44 +0800，Node v26.11.1、Pi SDK1.1.0、Vitest5.0.3，一次本機樣本：

| 案例 | 舊 ms | 新 ms |
| --- | ---: | ---: |
| inventory | 16.07 | 5.62 |
| equip | 4.42 | 6.56 |
| forge | 5.06 | 2.25 |
| combat | 6.55 | 4.02 |
| entry | 0.77 | 1.21 |
| interruption | 2.35 | 4.10 |

這些時間只涵蓋模擬 client 的處理區間，包含格式化及可能的 overflow I/O，不含模型、Telegram 網路或 module 載入。snapshot 只驗證時間為數字，不設速度門檻，也不因本次數字宣稱實機加速。

## 正常與故障回歸映射

| 案例 | 已列入的驗證點 | 直接證據 |
| --- | --- | --- |
| 多頁背包 | 完整、缺中頁、遲到尾頁、重讀不累加、重複／新批次、輸出截斷、中頁 revision、來源過期 | [equipment-snapshot-replay](../../tests/equipment-snapshot-replay.test.ts)、[equipment-item-ref](../../tests/equipment-item-ref.test.ts)、[workflow-inventory-view](../../tests/workflow-inventory-view.test.ts)、[bears-result](../../tests/bears-result.test.ts) |
| 單件換裝 | 同名異詞條／不可區分同樣物品、重排、數量／精煉改變、角色／活動／TTL失效、實際 dispatch 前 room／status／中頁修改、新背包驗收、費用不符 | [equipment-item-ref](../../tests/equipment-item-ref.test.ts)、[workflow-actions](../../tests/workflow-actions.test.ts)、[workflow-dispatch](../../tests/workflow-dispatch.test.ts) |
| 兩階 forge | 各階完整／缺稅／矛盾成本、共享材料逐階扣除、跨資產級距提示、基值／精煉有效值、保護材料、每階新對帳與後階新價、意外穿戴改變、未列原裝遺失、金幣／精魄差額不符 | [upgrade-quotes](../../tests/upgrade-quotes.test.ts)、[upgrade-native](../../tests/upgrade-native.test.ts)、[upgrade-sequence](../../tests/upgrade-sequence.test.ts)、[craft-confirmation](../../tests/craft-confirmation.test.ts) |
| 有限戰鬥 | 先機→回血、名補／實補0、多次治療缺段、回血→燃血→反擊、已計入真傷／毒傷不重加、未知盾耗次、狂暴觀測、0 HP未結算、正式勝利／失敗／逃離、message revision 不重複計獎、未知成本或格式不建攻擊候選 | [combat-events](../../tests/combat-events.test.ts)、[combat-native](../../tests/combat-native.test.ts)、[workflow-snapshot-blocks](../../tests/workflow-snapshot-blocks.test.ts)、[combat-planner](../../tests/combat-planner.test.ts) |
| 原生入口 | 付費／免費完整原文、非法數字、重複／衝突資格、額外費用、樓層範圍、自動擇一規則未知或資源不足；檢查不入塔 | [workflow-tower-native](../../tests/workflow-tower-native.test.ts)、[workflow-boundaries](../../tests/workflow-boundaries.test.ts) |
| 中斷／並行 | 送前／送後取消、無回覆、遲到觀測、明確拒絕、切角、Auto Idle、reload／tree reset、不恢復待送、Game跨實例排他、實際 send 前來源／指令改寫 | [workflow-boundaries](../../tests/workflow-boundaries.test.ts)、[workflow-integration](../../tests/workflow-integration.test.ts)、[workflow-dispatch](../../tests/workflow-dispatch.test.ts)、[game-operation](../../tests/game-operation.test.ts)、[equipment-extension](../../tests/equipment-extension.test.ts)、[game](../../tests/game.test.ts) |

### 本輪發現並修正的兩階缺口

[upgrade-sequence.test.ts](../../tests/upgrade-sequence.test.ts) 新增5項測試：正常兩階與4種第一階異常。其中意外換裝、未穿原裝遺失兩項先重現錯誤 confirmed，再修改 workflow-rewards：

- 只將已確認的 from→to 品項演進套到原本穿戴名稱；可以保留「已穿·極→已穿·神」，不能因此接受原本未穿品項自動取代其他裝備。
- 即使金幣及精魄差額閉合，未核對的穿戴變更或回執沒列出的品項消耗仍 needs_observation，netGoldPerMinute=null，不交付下一階許可或自動補救。
- 每階及兩階合併區間都能核對；後階價格由2,250,000改成2,500,000G時，只使用新報價，不沿用原條件合計。沒有新增付款、反向換裝或原裝恢復工具。

## SDK及常駐驗證

| 環境 | 測試 | build | 邊界 |
| --- | --- | --- | --- |
| 現有安裝：Pi SDK1.1.0／Vitest5.0.3 | 68檔／1,222項通過；六案例 benchmark 另1項通過 | 通過 | 常駐查詢驗收在此版本；未修改本機依賴 |
| 獨立環境：pi-coding-agent、pi-ai、pi-tui 均1.3.0／Vitest5.0.5 | 68檔／1,222項通過，含 loader／Codemode worker | 通過 | 只複製程式／測試／skills／必要設定；npm安裝於獨立暫存目錄，ignore-scripts，不改本機或全球依賴；不是1.3.0真實Telegram副作用驗收 |

SDK1.3.0 的獨立驗證使用程式、測試、skills、README、run.sh及必要設定的副本，不複製 .env、.pi 或 Telegram session。只在副本目錄執行下列命令，保留原工作樹依賴：

```bash
npm install --ignore-scripts --package-lock=false --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000 @earendil-works/pi-coding-agent@1.3.0 @earendil-works/pi-ai@1.3.0 @earendil-works/pi-tui@1.3.0
npm test
npm run build
```

最後一次重跑遇到 npm registry 的 transitive dependency 問題：2026-10-20 02:53 +0800，`https://registry.npmjs.org/@aws-sdk/credential-provider-http/-/credential-provider-http-3.972.77.tgz` 回 HTTP404；fetch-retries=0。這是 npm registry tarball／本機 npm cache 層的版本可用性差異，TTL 未知，不是本 extension 的12秒公開資料快取失效。

確認本機 npm cache 已有3.972.76後，只在副本 package.json 加入 `overrides: {"@aws-sdk/credential-provider-http":"3.972.76"}`，再以 `npm install --offline --ignore-scripts --package-lock=false --no-audit --no-fund` 安裝，沒有再次重送失敗URL。三個 Pi packages 仍各為1.3.0；02:55重跑完整1,222項測試及 build 通過。該 override 不加入專案、鎖檔或全球設定；重跑時須分開記錄 SDK版本與 transitive dependency 條件。

驗證後清除自己建立的副本；沒有安裝到全球或改動現有 node_modules。

2026-10-20 02:26～02:27 +0800 的五個查詢常駐結果均為物件、resultKind=read_only_data、outputComplete=true、outputReasons=[]：

| Tool | 核驗 | originalSourceId |
| --- | --- | --- |
| bears_optimize_equipment | reload後無新背包時 recommendations=[]、applicable=false，沒有以輸出完整性補本人資格 | 8d0411e2-b2d9-42cb-b8ee-2b44aceee211 |
| bears_world | roomId=1、total=1、nextOffset=null，保留公開時間及非即時警告 | f412cb8e-7e35-48f9-a146-82d92b806d27 |
| bears_codex | 荒原巨角獸 query，保留2筆 entries、bosses kind、機率與演進費用 | 56a7fe73-1529-4539-828a-d36ec8aac764 |
| bears_life_codex | 相同 query 為物件，保留2筆及分頁欄位 | 6c53d1bf-4cea-4e3e-bff8-954168f816fa |
| bears_public_character | 回傳已觀察的なるみ_狂戰熊姓名、六件裝備及來源警告；頁面活動時間未標時區，不當即時狀態 | fc93cc0a-8d33-46d5-a187-c27381a61542 |

本輪只有起始 history 1次、本機計算與公開查詢；**遊戲指令送出0筆**。未為已通過的 snapshot／forge 再查 status、背包或遊戲選單。兩個 codex 工具仍各有既存的獨立cache實例，不把它們的首次抓取當成相同實例的非預期cache miss。

## 未涵蓋項目

- 真實模型請求次數、外層 tool 呼叫數、usage 及模型＋Telegram端到端時間仍未測量，不能由 clientCalls、tokenizer 或模擬 ms 替代。
- 固定六案例是明定 workload／故障映射的離線驗收，不是全部並行排列或所有遊戲格式的證明。原生普攻、敗北、逃跑及其他變體未取得完整格式時仍 unknown。
- 使用者於最後一輪回報已 reload；本輪沒有程式碼變更，不要求再次 reload。載入狀態採使用者回報，沒有以真實付款、戰鬥或換裝獨立觸發新護欄；這些操作不因 coding 或本文件獲得授權。
- 後端永久物品ID、原子快照、游標、battle ID、跨程序 exactly-once 及權威成本仍未提供；本機參照與條件合計不冒充這些保證。

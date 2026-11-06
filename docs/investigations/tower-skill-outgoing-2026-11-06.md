# 技能結果漏掉 outgoing，無法建立星塔盾預算

## 結論

已修正 `Game.act` 丟棄同次歷史中 outgoing 訊息的流程。只保留實際觀察到、ID 大於操作前最新訊息的新 outgoing，不補造送達回執，不增加 Telegram RPC。只有 bot 更新能設定 `bot_updates_observed`；只有 outgoing 時仍為 `no_update_yet`，不代表技能成功。

最新離線檢查為2026-11-06 04:09 +0800：相關7檔136項、完整118檔1860項與build通過。至05:37遊玩檢查點，傳送保留outgoing、血怒／status／tower自然late已分別實機通過；skills自然late仍待核，不稱全部分支已實測。只有首次觀測到完整回覆時嚴格綁定，不刷新原文時間或重送；遊戲 Goal 未完成。

## 原始案例與判斷

- 操作角色：`なるみ_狂戰熊`；有效 Goal `481ad07e-bacb-40a2-9923-e731de9a3332`。
- `/skill 地脈·萬物回春` 的 outgoing954260，date1793902503，revision `00bc23e87a55fa250f10eaf765e678297b8c5df6a034583e277b1397d53f1c11`；稍後補查 `bears_history beforeId=954264 limit=4` 確認它存在，來源 `5ce2f352-af4a-4ac4-bfcc-1dcd1d7ae739`。
- 技能回覆954261，date1793902504，來源 `4bbe9253-3ccf-4a21-9fb8-9ff0f647a4c6`，原文：

  ```text
  ✨ 使用技能：地脈·萬物回春（MP -60）
  🛡️ 地脈·萬物回春！接下來 3 次受擊減傷 24%
  💚 恢復 1672 HP！HP：3040/3040
  ```

- 954263新 `/status` 核MP362；補新 `/tower`、`/skills` 後，planner仍回覆「回春缺少在先、同角色／分支的 outgoing，不推盾耗。」來源 `f0aa75be-25af-408f-8a75-b12f4d3c2ffa`。這個護欄正確，不應移除。
- `src/game.ts` 的 `Game.act` 原本從 `after_history` 結果排除全部 outgoing。`extensions/bears.ts` 因此只能觀測 bot 回覆，無法保留已存在的在先來源。既有 workflow 測試通常預先注入 outgoing，未涵蓋真正 `Game`→extension 的資料路徑。
- 技能後，舊status／tower／skills失效是既有保守規則，不是本次要放寬的問題。每手仍須取得狀態變更後的新 `/status` 與必要塔況；不能沿用只是未滿60秒、但MP已過期的status。
- 前一段MP82仍施回春、再送血怒被「目前22MP」拒絕，是Agent算術與門檻核對錯誤，不是此bug或parser錯誤。拒絕不計成功／耗MP。兩項問題分開記錄。

## 變更與護欄

- `src/game.ts`：保留同次 `after_history` 實際觀察到的新 outgoing；維持 bot 更新的獨立判定。
- `extensions/bears.ts`：`bears_send` 說明明示 outgoing 不證明成功。
- `tests/game.test.ts`：驗證 outgoing 單獨出現、outgoing加回覆、舊 outgoing 修訂不冒充新派送，以及無新增history RPC／重送。
- `tests/workflow-observation-timing.test.ts`：走真實 extension／`Game` 路徑，驗證有 outgoing 才建立三次盾、MP100→40→8後選恢復；缺 outgoing 時仍阻擋。HP／MP與戰報為最小合成案例，不當遊戲生存證據。
- 不改動 `towerShieldBudget`、技能費用、盾耗、來源修訂、角色歸屬或戰鬥安全護欄。

## 實際檢查

1. 修正前：`npm test -- tests/game.test.ts tests/workflow-observation-timing.test.ts` 重現3項失敗；完整transport確有outgoing，但結果及盾來源遺失。
2. 修正後：`npm test -- tests/game.test.ts tests/workflow-observation-timing.test.ts tests/workflow-tower-step.test.ts tests/workflow-request-binding.test.ts tests/bears-result.test.ts`：5檔101項通過。
3. `npm test`：118檔1836項通過。
4. `npm run build`：通過。
5. 變更4個source／test路徑的Biome檢查通過；既有schema版本2.5.12與CLI2.6.4不符提示仍保留，未修改不相關設定。
6. 第一階段遊戲內：4春4血逐手MP422→54，54時正確選recover，每筆skill含真實outgoing；後續15血11春再削346,952 HP，兩個完整MP區間轉recover後已獨立原生休息全復。第三區間遊戲結果確認，但出現下節的遲到綁定bug，未繼續攻擊。

## 追加案例：送達已觀測，原生回覆遲到後未綁定

- 2026-11-06 02:51 +0800，`/skill 血怒亂斬` 首次結果僅含outgoing954532（date1793904707），`delivery=submitted`、`observation=no_update_yet`、`outcome=unknown`；來源 `822db335-5e55-4586-a0b6-d8b301ddbe38`。只有outgoing不當技能成功。
- 緊接一次 `bears_history limit=3`，完整含舊tower954531、原outgoing954532與新bot954533（date1793904710）；來源 `4427ddbe-de2a-4a46-9cac-25f84836a456`。兩者之間未送其他查詢或操作。血怒原文完整，技能32 MP、怪16802715／18011927、本人3040 HP；最小原文保存在[fixture](../../tests/fixtures/native-late-tower-blood.json)。
- 後續新status確認MP54，第二次history仍涵蓋完整順序，planner卻以「最後技能／攻擊缺少直接綁定回覆」阻擋。原因是history未帶新request，完整native技能仍被存為actor／command未知。遊戲結果已核驗，不是未決技能，不重送，也不重置兩次補查額度。
- 安全收尾：已另行收刀休息；954555／557確認HP3040、MP422、416073 G、同104怪16802715、best103／入38。沒有退出重付、死亡或不滅觸發。

### 追加修正與限制

- `WorkflowObservations` 只在同次指令結果確有與request相同的真實outgoing時記內部 `requestObserved`，保留當時角色／epoch與來源時間；watch先見outgoing後的同次send可確認旗標，不刷新時間。
- 首次晚到native技能只在全部條件成立時綁定：緊鄰在先outgoing已有此旗標；同角色／epoch／coverage；60秒內、未修訂、無未決切角；日期次序正確；完整原生技能名稱與command一致。不將歷史outgoing、新request、孤立watch、未知角色或部分戰報當送達證據。
- 已存在的未知／已綁回覆不藉重讀改綁；重複技能、插入未知訊息、錯技、修訂、過期、缺頁、角色改變與未完整解析仍保留未知。不清除既有安全護欄或設定 `riskVerified=true`。
- request歸屬集中於 `src/workflow-request-binding.ts`，包含原有連續背包頁規則；多次判斷共用已物化records，避免一次性iterator耗盡。既有背包續頁回歸保持通過。
- 修正前單測重現actor／command均null；修正後真實 `Game`→extension測試以該native fixture重現outgoing-only→history→新status／tower→planner可決策，且沒有重送技能。
- 實際檢查：相關7檔127項、完整118檔1851項、build及變更9個code／test／fixture路徑的Biome檢查均通過。追加修正須新實例載入；普通續攻可依本人既有實戰進行，遲到分支未自然重現前保持實機待驗，不為測試故意製造未決遊戲操作。

## 追加案例：唯讀塔況晚到使盾流程誤判歸屬缺漏

- `/tower` 首次send只含outgoing954898，date1793908336、revision `640f33cb8eaf37ca914dac41d515ac25715e3065d40f4873ac498212bb8587a0`，`observation=no_update_yet`；來源 `e6136f30-f1cd-4165-a21c-2e5fa474bfce`。
- 首次 `bears_history limit=3` 完整含舊status954897、該outgoing與bot954899（date1793908338、revision `f39b07655c52fc2216f8eb4ea8fabeedaa73ab7c270a92befc790c42cbe28c9b`），來源 `183cff87-e825-420c-8201-7288a074b6c9`。必要原文如下；不複製其他玩家排行：

  ```text
  🗼 無盡星塔 — 每一層都是一顆未墜之星的倒影
  📜 個人最佳：第 103 層｜入塔 38 次
  ⚔️ 挑戰中：第 104 層　🩻星影·空洞騎士　HP 16,231,932/18,011,927
  ```

- 面板本身已解析，遊戲結果不明的問題不存在；但回覆command未綁，盾流程以「回覆歸屬缺漏、重複或互相矛盾」阻擋。原生status的HP1520／MP206一致，最後技能均同次完整回覆，所以不能把本例算成技能late分支驗收。
- 最小回歸先重現 `/tower` 晚到；相同流程亦重現每手使用的 `/status`、`/skills` 晚到，故一併修正這三種既有策略面板，不開放任意未綁面板或未知command。
- 共用原有direct-outgoing、角色／epoch／coverage、60秒、日期、修訂及首次觀測護欄。`/status` 另須完整且角色名稱吻合；`/skills` 須為已辨識面板；`/tower` 須有唯一有效樓層、目標、HP與上限。缺HP、錯面板、另一角色、只有歷史outgoing等仍阻擋。
- 沒有修改 `towerShieldBudget` 讓未知訊息直接略過；只是完整相符的晚到查詢能保留原request。相關7檔136項、完整118檔1860項、build與變更路徑Biome通過。未擴張操作授權或重送查詢；實機追加分支待自然重現。原文查閱見[2026-11-06 03:52回饋](../context-feedback/2026-11.md#2026-11-06-0352-tower104-late-query-binding)。

## 修正後自然實機驗證：2026-11-06 04:18–05:37 +0800

- 技能：血怒outgoing954946（date1793909880）首次只outgoing，來源 `8a9a3f55-20f3-480b-8372-6c470b385f56`。首次history來源 `778e090d-e7d8-4aa8-85fd-256d360c9bc0` 完整見native954947；新status／tower後planner ready spring、盾min2，來源 `05dceac9-20d2-4ec8-b473-83374db3358e`。同本人HP1520／MP238與血怒費用相符，沒有重送或插入其他操作。
- 唯讀status：outgoing955516（date1793911960）來源 `14d0adae-995d-45c6-b9d2-3408e29448fa`；第一次history尚無bot，第二次history才首次觀測完整955517（date1793911967），來源 `db8fe48e-00e3-4b7c-a3cd-1e5b6dc99828`。本人1520HP／54MP、416073G、前庭；新tower955520後planner ready recover、盾min2，來源 `58774fad-12bc-4d2c-99f0-e7774b6c0c69`。兩次補查不重置，沒有重送。
- 唯讀tower：outgoing955706（date1793913377）首次只outgoing，來源 `ac7547cd-ed8c-4425-95f5-d2f0063ad706`；一次history來源 `690af492-b0d5-47e3-bfe8-1b46aa6a1b70` 首次完整觀測955707（date1793913379），同104怪15027142。新snapshot→planner來源 `f5914f55-2dcc-47b8-8bc3-534f397c6ee5` ready spring、HP1520／MP206，接續955709原生回春成功；沒有重送或插入其他指令。這只新增tower實機範圍，skills仍待自然核驗。
- 「首次觀測」是該bot回覆第一次進入觀測，不限第一個history呼叫；既有未知／已綁訊息仍不因重讀改綁或刷新來源時間。
- 05:01前兩批共57血45春、十二次原生零G恢復，維持同104。沒有刻意製造延遲、額外付款、查舊回覆或使用original；tower／skills分支在這些批次均同次完整回覆，不能借status案例宣稱已驗。精確資源與收尾來源見[2026-11-06 05:01戰報](../notes/2026-11.md#2026-11-06-0501-berserker-tower104)。

- 05:37批另有一筆 `/tower` 955884唯讀缺回覆，兩次補查已耗盡；遊戲狀態變更均明確。安全恢復後，新查詢955892只驗收恢復後同挑戰保血，不回填舊回覆、不重置原補查。全批25血21春、六次零G恢復（含一次中途收尾），見[2026-11-06 05:37戰報](../notes/2026-11.md#2026-11-06-0537-berserker-tower104)。不能把唯讀局部缺口當全域阻擋，也不能把這筆缺回覆算作late綁定實測。

## 前庭恢復的工具適用範圍

當次 `/look` 與 `/help` 未列免費費用，`bears_tower_recover` 的明示免費護欄仍停止，沒有改parser把 `freeRest` 補成true。父端依同本人、同前庭、同一次入塔38／104的多次原生零G實證與新身分／金錢核驗，另行執行必要 `/rest`；每次再核全復、0G差與怪血保留，不稱固定工具 `confirmed`，不外推其他角色／房間。完整原文回饋見[2026-11-06 02:37紀錄](../context-feedback/2026-11.md#2026-11-06-0237-tower104-rest-cost)。

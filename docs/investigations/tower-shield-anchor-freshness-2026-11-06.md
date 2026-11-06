# 回春前塔況錨點過期與診斷

## 結論

2026-11-06 06:49 +0800離線查證：回春原生回覆已完整解析，問題不是漏掉outgoing或技能綁定。施法前的塔況錨點（已綁定的同層塔況來源）在最後快照觀測時至少62.683秒，超過既有60秒上限；新 `/tower` 不能刷新舊錨點。保留此護欄，只補明確診斷與準備順序。

最新離線複驗為2026-11-06 10:25 +0800：相關四檔90項、完整119檔1870項、build及17個相關extension／source／test／fixture路徑的Biome檢查通過。Biome仍提示既有schema2.5.12與CLI2.6.4不符，未修改不相關設定。07:01新實例正常遊玩已核首春min3／unavailableReason=null，自然逾期時顯示診斷，再新春重建min3並實際續攻；沒有刻意製造逾期。只完成兩段而非六段，遊戲Goal未完成。

## 證據與限制

- 本人 `なるみ_狂戰熊`，同104／入塔38。`/tower` 956744 date1793918322，來源 `94b7cea1-f34d-4ec7-b3c1-7f7f8708e7a1`；怪13303220／18011927。
- `/skill 地脈·萬物回春` outgoing956753 date1793918358；完整native956754 date1793918359，來源 `85322765-6fd0-4bdc-824f-149f930624f9`，三受24%盾、名補1672。新 `/status` 956756核3040HP／362MP，實耗60 MP；沒有血怒或削血。
- 施法後新 `/tower` 956758及 `/skills` 956760皆完整。最後snapshot的最大來源observedAt為1793918384683，對舊錨點年齡62.683秒。這是實際planner執行時間的下界，不是精確執行時間；在此下界重放時，回春本身僅25.683秒，舊錨點仍正確失效。
- 原planner來源 `83c301b7-d8ae-4d32-82f0-7225fab2565e` 回ready／spring、min=null、sources=[]、issues=[]，但只說「盾預算不足／未知」，沒有說明錨點缺口。原生最小案例及完整capturedPlanner見[fixture](../../tests/fixtures/native-tower-spring-observation-2026-11-06.json)。首次skills／snapshot／planner及中間snapshot未保留完整store，已在fixture明示，沒有補造。
- 已安全 `/flee`→`/rest` 補60 MP；新 `/status` 956766與 `/tower` 956768核全滿、416073 G、同104怪13303220保留。這一段沒有新增削血，不稱六區間完成；明細見[2026-11-06 06:40戰報](../notes/2026-11.md#2026-11-06-0640-berserker-tower104)。沒有使用original或新增原文回饋。

## 遊戲內驗證：2026-11-06 07:01 +0800

- 準備後最後新 `/status` 956781、`/tower` 956790，再春956792；post-status956794核3040HP／362MP、post-tower956796核同怪。planner來源 `3a7c72b8-c536-47a3-a4be-0c33ad1b919a` ready blood、min3／24%／unavailableReason=null，完整綁施前塔況與回春outgoing／native，接血怒956798成功。
- 第2段自然遇到舊錨點過期，planner來源 `f0748819-288f-40ad-9336-3bb8dc7be2fb` 正確回min=null及明確診斷。本人3040HP／330MP、新塔況明確且成本／安全通過後另施新春956860，planner來源 `26ce908d-92be-4d04-aacb-f791d196cc6e` 重建min3，沒有刷新舊來源或放寬TTL。
- 實際兩段8血怒／8回春耗及補736 MP、削195664 HP，均0G全復保血。父端另以本地原始資料核技能去重與三個關鍵planner結果，未使用original；完整來源與收尾見[2026-11-06 07:01戰報](../notes/2026-11.md#2026-11-06-0701-berserker-tower104)。skills自然late仍不在本次驗證範圍。

## 追加：outgoing與回覆先後過期，2026-11-06 08:43 +0800

- `/skill 地脈·萬物回春` outgoing958099 date1793925738，回覆958100 date1793925739，來源 `0524e18a-cd71-4956-b34f-7e75d9ec15ae`。此前兩個投影分別min3／min2，證明當時曾採計來源；末planner卻報「缺少在先outgoing」。完整末結果及明示投影／轉錄缺漏見[新fixture](../../tests/fixtures/native-tower-shield-request-freshness-2026-11-06.json)。
- 原始根因仍未完全確認：沒有實際planner呼叫時刻或內部epoch。最後來源observedAt只給出outgoing年齡至少55.332秒，不能據此斷言已超過60秒，更不能宣稱source被淘汰或漏綁。這不影響已確認的遊戲結果；已收刀全復、0G差及同怪保血。
- 離線可重現一種確定的診斷缺口：outgoing比回覆早1秒時，在outgoing已過60秒、回覆仍不超過60秒的窗口，既有護欄正確停止，但把「已過期」寫成「缺少」。只有實際同角色／epoch、非未來時間且outgoing已超60秒時，才改用明確過期診斷；state、min、issues是否阻擋及TTL均不變。
- 新增5項測試，分開放入`tests/tower-shield-request-freshness.test.ts`，避免單檔超過500行。60000／60001／61000／61001 ms邊界及原生一秒日期差均覆蓋；時鐘與控制情境是合成重放，不冒充原始呼叫時間或epoch。當時新分支僅離線驗證；後續正常操作記錄planner呼叫前後時鐘界限，遊戲內不刻意製造逾期。
- 初次build的測試unknown欄位存取、檔案行數及import type警示已修正；最新89項、1869項、build及Biome通過。schema版本提示仍是既有資訊，不改設定或放寬檢查。

- 後續2026-11-06 09:10–09:30 +0800正常五段，planner均記Date.now前後界限，沒有outgoing先過期或needs_observation再現；只有既有前錨點自然過期分支。新增診斷仍只稱離線覆蓋，不以成功回填原失效原因。見[2026-11-06 09:30戰報](../notes/2026-11.md#2026-11-06-0930-berserker-tower104)。

## 自然實機核實：2026-11-06 10:00–10:08 +0800

- 既定第5個MP區間末，planner來源 `b7121108-f40d-496a-9806-a57d8b6a88a4`，clock界限[1793930426577,1793930426578]；春outgoing958746 date1793930366、reply958747 date1793930367、來源 `d3b4fe5f-c5cf-4a71-8297-05358f2e3c3d`。兩端皆確認outgoing60.577–60.578秒已過期，而reply59.577–59.578秒仍新鮮；production完整plan正確停止並顯示明確診斷。這次原因已核實，不回填08:43舊案。
- 完整失敗snapshot未存，只保存摘要及來源，沒有以後來結果還原或捏造epoch。新增[實機fixture](../../tests/fixtures/native-tower-outgoing-expired-2026-11-06.json)與1項回歸：使用真實訊息／observedAt／呼叫界限重放；測試中的控制情境仍明示合成。兩端重放結果與captured blockers／unavailableReason一致，不送任何遊戲操作。
- 1520HP／22MP時停止攻勢，依獨立授權原生flee→rest全復、0G與同104保血後，重新核驗／新盾才完成第6段。六段555719 HP、六次零G全復，見[2026-11-06 10:08戰報](../notes/2026-11.md#2026-11-06-1008-berserker-tower104)。新實測不擴張存活保證、授權或TTL。

## 變更

- `src/tower-shield-budget.ts`：缺少不超過60秒、同角色／分支的施法前塔況時，回傳`unavailableReason`。不改min、issues、TTL、來源歸屬或預算資格。
- `src/workflow-tower-step.ts`：沿用此診斷作為既有spring建議的reason；不增加操作或改變決策。
- `src/workflow-tools.ts`與遊玩skill：先完成必要skills／完整背包，再於首次回春前更新status／tower。只處理本策略相依的blockers，不為通用snapshot的技能完整成本未知反覆補查。
- `tests/workflow-tower-step.test.ts`：原生最小案例、60000 ms含邊界／60001 ms過期、準備後更新塔況的對照，共新增4項；確認新查詢不替舊錨點續命、不送任何遊戲指令、不設定riskVerified。

## 實際檢查

1. 修改前，49項中3項因缺少明確診斷失敗；既有min=null護欄及準備後更新塔況的對照已成立。
2. `npm test -- tests/workflow-tower-step.test.ts tests/workflow-observation-timing.test.ts tests/workflow-request-binding.test.ts`：3檔84項通過；2026-11-06 07:38 +0800以這三個實際存在的路徑重跑仍通過。
3. `npm test`：118檔1864項通過；`npm run build`通過。
4. 五個變更code／fixture路徑的`npx biome check`通過；新fixture一次格式問題已修正。純skill文字再核對術語、指令、參數、流程及安全規則，不需要為此重跑build。

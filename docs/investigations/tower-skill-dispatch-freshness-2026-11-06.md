# 星塔技能在送出前重驗策略時效

## 結論

2026-11-06 13:18 +0800新增單筆 `bears_tower_skill({snapshotId, policy:"blood-earth-32-60", name})`，並將planner的血怒／回春推薦連到此入口。入口及既有Game dispatch callback各重算策略，失效或改選時不送出；不延長60秒、不加估計margin、不自動換招、恢復、補查或連打。普通bears_skill行為不變，但本策略不得用它繞過護欄。

來源分工修正後相關5檔114項、完整121檔1938項與build通過，4個code／test路徑Biome通過。13:22–13:23初次正常驗證、14:02–14:18及14:28–15:05後續實機均已核；14:17及後續五筆入口自然逾期拒絕未送。這些不驗證callback逾期或遠端延遲上界，也不等於生存批准或Goal完成。

## 實機案例與證據範圍

- 第26操作實例在2026-11-06 12:45:54.614–.616 +0800取得ready/blood，HP3040／MP330、盾min2／24%。施前塔錨960113 date1793940298在此時56.614–56.616秒；春outgoing960114 date1793940316仍新鮮。
- 真實血怒outgoing960126 date1793940361（12:46:01）、來源 `8efb9809-6714-40f0-91a6-0743b268e1da`，對塔錨已63秒；唯一native960127明示MP−32、實傷12464及閃避反擊。動作已發且結果明確，不能撤回或用閃避／生還回填時效合規。
- [最小fixture](../../tests/fixtures/native-tower-dispatch-window-2026-11-06.json)保留實際clock、訊息定位及血怒原文。完整pre-plan／snapshot及skill呼叫前後clock未逐字轉交，不補造或把全部時間差歸給模型／連線／RPC任一階段。測試的身分、塔況、春與前手控制事件明示合成，不冒稱完整實機重播。
- 原普通路徑沒有策略dispatch guard。新增紅測試用mock Game／BotTransport重現plan有效、63秒仍send1，並非因新module缺失而紅；對照新入口send0。

## 實作與界線

- `src/workflow-tower-skill.ts`在本機入口檢查schema／取消與指定策略；既有Game完成connect及before_history後、呼叫send之前，再核精確技能文字、角色／分支、策略與所有初始／重算相依source的message ID及revision，包含outgoing。保留外層dispatch guard。
- 只送一筆既有 `/skill`，沿用原生receipt及觀測；不呼叫ctx.executeTool建立多步流程。Game本來的前後history RPC數量不增加；帶guard時前置窗口為30則，普通無guard為10則。不是增加舊未決操作的Agent補查，也不刷新來源date／TTL。
- 入口確定未送及Game dispatch拒絕保留NOT_DISPATCHED；送出後失敗仍OUTCOME_UNKNOWN，未知send錯誤不洗成未送，不自動重試。回覆完整性與實際資源仍由Agent核。
- **保障限於callback核驗當下。** 不能保證之後網路／Telegram服務端的outgoing timestamp仍在60秒內，也不能防止其他程序或手動操作。收到真實outgoing仍核時效；若已送出而超界，停相依攻勢、保留原文並必要收尾，不推測延遲上界。
- readOnly planner仍不執行或授權；name、policy及snapshotId由當次推薦明帶。成本、副作用、當層／狂暴階段、生存與授權仍須另核；普通bears_skill不是本策略的回退路徑。

## 正常遊戲內驗證

- 2026-11-06 13:22–13:23 +0800，planner推薦完整snapshotId／policy／name，實際只經新受護欄入口各施一春／一血怒。春outgoing960156／native960157，新MP422→362；血怒960162／163，新MP362→330，怪7978769→7966313，實削12456 HP；全復後422、G差0。
- 春的實際outgoing對相依status／tower為18／13秒；血怒對status／tower／施前錨／春outgoing／reply為19／15／41／28／27秒，均不超60。呼叫前後clock已保存，不冒稱已獨立量測callback內clock或遠端延遲上界。
- 完整來源、精確args與收尾見[2026-11-06 13:23戰報](../notes/2026-11.md#2026-11-06-1323-berserker-guarded-skill)。本次先機／反擊均閃避，不作承傷安全證明；沒有刻意觸發實機逾期拒絕，該邊界仍限離線回歸範圍。
- 舊960026及其未歸因60 MP與本修正無關，繼續保留；不因新正常樣本回填、重送或重置舊補查額度。後續每手仍核真實outgoing年齡，異常停相依攻勢，不保證任意未來傳輸時間。

<a id="2026-11-06-1357-source-dependencies"></a>
## 2026-11-06 13:57 +0800：診斷來源與動作相依來源

- 13:43第7手為新回春，子端以原plan所列前一劑盾的塔錨960207年齡70秒停止後續攻勢；當前status／tower據交接為24／19秒。父端未取得當次完整plan與callback資料，不把舊錨70秒單獨判為新回春違規，也不據護欄放行回填全部合規。原生成功及收尾另見[13:44戰報](../notes/2026-11.md#2026-11-06-1344-berserker-source-dependencies)。
- 程式核對發現planner無論選血怒、回春或恢復，都把舊盾診斷來源加入頂層sources。合成控制回歸重現：新回春仍符合策略且本人／塔況新鮮，但不相依的舊錨過期並離開before_history窗口時，送出護欄錯誤拒絕。這是獨立離線重現，不是該實機手的完整重播。
- 最小修正只在血怒分支加入shield.sources；新回春／恢復的頂層sources只保留當前本人／塔況。舊盾來源完整留在data.shieldBudget.sources，未刪證據。策略條件、未決／未解析／歸屬護欄、60秒及血怒沿盾檢查不變；新回春建立新盾，不沿過期舊盾攻擊。
- 先跑新增測試，3項如預期失敗；修正後相關5檔114項、完整121檔1938項及build通過。新增7項涵蓋來源分工、舊錨退出窗口、新回春當前來源缺失及60000／60001毫秒邊界；原血怒過期、修訂／缺失拒絕仍通過。
- 測試增加後超過單檔500行限制，將共用Game harness移至tests/fixtures/tower-skill-dispatch.ts，新來源測試獨立於tests/tower-skill-sources.test.ts；兩者用途分明，不複製harness。4個code／test路徑Biome通過，既有schema版本資訊提示不改。skill與README同步說明兩種來源；修正後實機仍待新操作員核驗，不刻意製造逾期或延遲。

<a id="2026-11-06-1418-natural-entry-rejection"></a>
## 2026-11-06 14:18 +0800：正常來源分工與入口自然拒絕

- 載入後31手成功（16血怒／15回春）已核：新回春只列當前status／tower，血怒保留沿盾來源；真outgoing對全部相依來源最大54秒。實削359247 HP、1412 MP實耗實補、0G全復；[戰報與收尾](../notes/2026-11.md#2026-11-06-1418-berserker-tower104)。沒有刻意延遲或等逾期。
- 第32手推薦args為snapshotId `3a300109-c180-46c9-b5a0-e4b034dce840`、policy `blood-earth-32-60`、name `血怒亂斬`。plan clock[1793945862952,1793945862956]為ready/blood、HP3040／MP178／盾3。呼叫clock[1793945868885,1793945868887]（14:17:48.885–.887），下列施前塔錨已61.885秒，而非plan時的55.952–55.956秒。

| 用途         | message ID | date（Unix秒） | revision                                                         |
| ------------ | ---------: | -------------: | ---------------------------------------------------------------- |
| 目前status   |     960455 |     1793945853 | 3f88aea123f55c7f8c72d1eb4a1a28f25871d73ad6e42e0b9f1726d07ffd1d85 |
| 目前tower    |     960457 |     1793945862 | 9364c855eb015716f8fd0f240e0d8f78246e940f2205525693d49a70fbd54ea9 |
| 回春施前塔錨 |     960443 |     1793945807 | 9364c855eb015716f8fd0f240e0d8f78246e940f2205525693d49a70fbd54ea9 |
| 回春outgoing |     960452 |     1793945844 | 00bc23e87a55fa250f10eaf765e678297b8c5df6a034583e277b1397d53f1c11 |
| 回春native   |     960453 |     1793945844 | 44a0506eaf1638119f454ab4941a24eec959cbe7cf4b48fe4cfb816fe57a90f0 |

```json
{
  "version": 1,
  "kind": "command",
  "delivery": "not_dispatched",
  "observation": "unknown",
  "outcome": "unknown",
  "code": "NOT_DISPATCHED",
  "messages": [],
  "complete": false,
  "reasons": [
    "Action was not dispatched to the bot. 星塔策略不再符合指定技能；spring"
  ],
  "originalSourceId": "44b0f5a0-534d-4855-915a-ed41238ca312"
}
```

- 這是入口自然逾期拒絕的實機證據，沒有outgoing、扣費、普通skill回退或重試；不是dispatch callback逾期／遠端延遲邊界已驗。當前本人與塔況新鮮仍不能使所沿盾的舊錨續命；另選新回春須新核驗。
- 操作員因交接條款提前全復至422 MP；當時178 MP其實足供新核驗後另選回春，不應把NOT_DISPATCHED當成未決或強制恢復觸發。skill已明確區分單筆未送與全批停止；只有資源／安全需要時才恢復。一次非ready摘要直接取shieldBudget.min的TypeError亦補先檢查state及資料存在，不改extension有效輸出或將本機摘要錯誤當Game失敗。

## 檢查

1. `npm test -- tests/tower-skill-dispatch.test.ts tests/workflow-tower-step.test.ts tests/workflow-dispatch.test.ts tests/extension.test.ts tests/workflow-package-load.test.ts`：5檔108項通過，新增50項。覆蓋入口／連線／before_history後過期、60000含界／60001拒絕、source修訂／缺失、身分／分支／coverage／未決變更、取消、策略改選、外層guard及單筆receipt。
2. `npm test`：120檔1931項；`npm run build`通過。真實pi loader及npm pack乾跑存在檢查通過，未連線Telegram。
3. 7個code／test與1個fixture的`npx biome check`通過；初次fixture短陣列格式已修。既有schema2.5.12／CLI2.6.4資訊提示不改；`git diff --check`通過。README／skill按實際API更新，未改117指令目錄或十個多步流程清單。
4. 修正前當批實削120474 HP，其中12464 HP來自上述時效偏差手，不作後續安全樣本；已零G全復。見[2026-11-06 12:47戰報](../notes/2026-11.md#2026-11-06-1247-berserker-tower104)。舊960026回執及未歸因60 MP仍保留，與本次時效修正分開。

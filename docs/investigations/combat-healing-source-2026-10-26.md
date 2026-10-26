# 血怒主動吸取被誤列為裝備吸血

## 實機證據

2026-10-26 18:59 +0800，本輪狂戰93層實戰後核對新帳本報表，發現原生「🩸 吸血！恢復」被一律分類 equipment_lifesteal，與已保存819026技能表中血怒主動吸取35%的文案不符；嗜血狂殺亦有技內主動吸取。

- 本機報表範圍819092–819096，snapshot `36dbba0c189f025686dbd21dcd84fcb562d90ce9f399128fff9bd480d64468c6`；offset0／6000、limit6000。第二頁完整列819092錯誤來源，819096亦同；不為查無關資料讀剩頁。
- 819096原文來源 `7e5a78d4-899e-41c7-84f6-a3596896c40a`，operation `cb02e6e8-a722-4450-9f0a-0ae8610eabf4`，保存為 `tests/fixtures/native-combat-819096.json`。明確是血怒技能內吸取，沒有「裝備」標記；首次實補仍unknown。最終HP3040／MP22及成本32均由原有accounting完整確認。
- 技能文案fixture `tests/fixtures/skills-berserker-819026.txt`、既有嗜血原生677625與同手神話／主動吸取819046作交叉回歸，不為研究重送技能或臨時換裝。

## 最小修正

- `src/combat-native.ts` 保存本次已解析技能標頭；只有精確血怒亂斬／嗜血狂殺中的一般吸血文案分類 active_skill。未知技能或相似名稱的相同文案保留unknown，不再冒稱裝備被動。
- 神話吸血仍為mythic_lifesteal、一般主動恢復仍為active_skill；事件順序、HP／MP、首次實補、未套用名目量及護盾未知規則不變。技能名稱只參與來源分類，不推命中、實補、費用或安全資格。
- 共用parser透過既有extension接點供帳本／workflow使用，沒有新增遊戲旁路或自動重試。解析事實內容改變，parser升v5；schema／wire仍1。舊原文與版本保留，不自動歷史rebuild。

## 驗證

- 新增 `tests/combat-healing-source.test.ts` 八項；修正前6失敗／2通過，覆蓋血怒、嗜血、同手神話與主動吸取、未知技、近似名、一般恢復、持久化事實及未知尾文。
- 既有 `tests/ledger.test.ts` 的血怒fixture原本也誤斷為equipment_lifesteal，本次改成active_skill；首次實補unknown等驗收不變。
- 最終完整 `npm test`：111檔1736項通過，`npm run build`及本次五個程式／測試／fixture的Biome、`git diff --check`通過。
- 首次build曾因工作目錄同時新增的reload測試使用ES2024型別及未縮窄schema失敗；再次讀檔時該組測試已由其他變更修正，本次未修改那些檔案。重新完整測試與build均通過，不將該修正冒稱本次產出。
- 前次交付時需要reload載入v5；後續已載入並由新Goal授權恢復遊玩。819138原生同手神話／主動吸取，帳本observation158 trace確認parser5、mythic_lifesteal實補1520及active_skill實補0，來源分類修正已實機驗證。沒有歷史rebuild，也不把解析正確當戰鬥安全證明。

## 遊戲中斷

本輪七血怒／六回春584MP、一休息實補368MP，怪4755778→4538899，實削216879；無新通層或收益。最後819096明示HP3040／3040，帳本確認MP22／422，沒有為修正再送遊戲操作。修復需reload，之後仍須新history／status／tower核本人、挑戰及資源，不沿舊盾；MP不足一春一血，先依已驗證流程收刀／恢復。

- [原文回饋，2026-10-26 18:59](../context-feedback/2026-10.md#2026-10-26-1859-bloodrage-healing-source)
- [本人戰報，2026-10-26 19:03](../notes/2026-10.md#2026-10-26-1903-berserker-healing-source-reload)

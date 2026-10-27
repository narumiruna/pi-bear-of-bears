# 2026-10-26：原生星塔通層尾段與首達收支漏解析

## 已確認問題

820047血怒正式擊殺93層星影·冥界守衛，HP0、死亡／怪金、通層、首達及94預覽同一則回覆。`NativeCombat`只認正式擊殺與部分掉落；其後四行被視為未知，因此獨立32MP可保留，但HP／MP餘額、正式勝利與收益均unknown。這是實際未支援格式，不是遊戲結算失敗。

- 原文source `864a257e-88f5-4288-a06e-6f5dcfc8bdfe`，已保存 `tests/fixtures/native-tower-clear-820047.txt`。
- 820043付款／終殺前金18461826G；820049金19584034G，實增**1122208G＝怪金6208＋個人首達1116000**，HP3040／MP330。source `8c1ea1bb-2414-422b-a2c9-36809d3d2841`。
- 820051正式最佳93／入18次、有效94星影·精英獵人HP8343007／8343007，source `5c2f5839-4150-4cba-a6d5-e1d94569c694`。94尚未出手，不把預覽數值當93事件或94安全證明。

## 修正與防護

- `src/combat-native-tower.ts`集中處理已觀測完整四行首達尾段與獎勵抽取；`src/combat-native.ts`只在正式擊殺、已知敵HP0之後才接受，尾段必須位於結尾且順序相同，下一層必須是已通層＋1。
- 不支援的重登、其他寶箱／掉落尾文、缺行、額外內部空行、未知尾文、錯序、非相鄰樓層、矛盾HP／目標或超出安全整數的金額／數值均保持unknown；不由缺首達行推零。
- 下層預覽只存effect原文，不加入本場targets或enemy HP；riskVerified仍false。怪金仍是battle的rewardGold，首達另列一次性事件，不將首達當可重複收益。
- `src/ledger-facts.ts`由完整combat事件生成native tower_clear；`src/ledger-resources.ts`跳過同則combat怪金的先行加帳，由通層事實統一記一次總額。`src/workflow-rewards.ts`同步把怪金與首達分列，避免區間對帳漏首達或重加怪金。
- 帳本parser升v7，不改schema、不自動rebuild舊帳本、不重送遊戲指令。

## 驗證

- 修正前新17項測試有3項失敗，分別重現未知四行、本人MP／HP推導失效、對帳漏1122208G。
- 最終19項新回歸涵蓋完整通層、ledger去重／一次扣MP、怪金／首達分類、區間對帳，以及缺正式擊殺／HP非0／錯序／額外未知行／金額或預覽溢位等拒絕。
- 相關四檔87項通過；最終完整**113檔1786項**通過；`npm run build`、相關Biome與`git diff --check`通過。沒有以新formatter配置或未知公式放寬測試。

## 2026-10-27 01:40 +0800：新自然通層實機驗收

- 821519正式通94，source `f63bb107-d134-4b26-b497-d8ad9b454e52`；operation `05c531b0-bc9c-4135-9c91-c7bf7b133e26` 的trace observation2510明確parserVersion7，combat complete／won、unknownLines／issues皆空，riskVerified仍false。
- 本場target為星影·精英獵人、tower_clear94；95魔王衛士預覽僅effect，不污染本場target或敵HP。怪金5115與首達1128000獨立事實；首達未併為可重複收益。
- ledger report區間821509–523完整串接後，只有一筆tower交易1133115G；firstClear1128000／repeatable5115、actualDelta＝expectedDelta1133115、pendingAttribution0。本人新status821521錢包19584034→20717149，523新tower最佳94／入18、有效95，正式回執與錢差閉合。
- 這是載入後自然產生的新通層，不是離線fixture、舊觀測rebuild或重刷補驗。戰報與後續95有限試探見[2026-10-27 01:40](../notes/2026-10.md#2026-10-27-0140-berserker-tower94-clear)。不將本次驗收泛化其他尾段格式或整體Goal完成。

## 中斷與部署（歷史）

本次發現問題後停止94出手，只查本人status／tower核收支與挑戰；未收刀／休息或退出重入。最後HP3040／MP330、19584034G，現役六件＋5、4557ATK／5119DEF，最佳93、有效94滿HP，入塔仍18次。需要單獨reload才載入v7；queued不代表已載入，不能在舊runtime恢復攻擊。載入確認後新history／status／tower、重新新春，再依當前模板與既有鄰階授權逐手評估94。未聲稱新原生通層實機已驗，不重刷93或等待事件補驗。

### 2026-10-26 23:39 +0800：載入交接完成

reload自動continue已到達；新 `bears_ledger_status({character:"なるみ_狂戰熊"})` 明確parserVersion7／enabled=true。820078新status、080 tower確認原本人HP3040／MP330／19584034G及同94滿HP後，084重新施春、086核270MP，再088開始94實戰。至132已9血7春708MP、兩次免費恢復全滿，削251604HP，尚未通94。部署交接確認完成並刪離線修復計畫；v7新原生通層分帳仍待後續自然戰果，舊未知觀測未重建，不把載入或一般技能解析當新通層驗收。

# 原生通層下層重傷預覽（2026-10-27）

## 結論

824867正式通96後，下層97預覽新增全形空格後綴 `🩸重傷層：吸血/回春 −60%`，parser8原僅接受數值括號結尾，整段通層被判unknown。最小修正僅接受這個已觀察的可選後綴，完整預覽仍只存effect，不推當前重傷／護盾／治療或生存資格。parser升9。

## 證據

- 來源 `8e5efd6b-8f8b-4872-a661-0ac592a5d79d`，operation `0606e6f1-d66d-4281-b420-9812678a71d9`，message824867／date1793051606／revision `7d84448ee900257572155fd67654fa3ea55260889c93f98efdfbbf46c2d2df3b`。
- ledger observation5857，parser8 trace snapshot `1489831649f64b7ad90b3fb050029ecdd9fb53ee7a0ccdb467dbeb2dee9600ac`：complete=false、outcome=unknown；unknownLines8–11含通層、首達、重傷預覽與提示，issues列正式結算後未知。不是遊戲未勝。
- 824869本人金21863222→23020004，差1156782＝怪4782＋首達1152000；HP3040／MP298。824871最佳96／入18，97滿血10509786。沒有精魄行，不冒稱精魄新格式自然驗收。
- fixture `tests/fixtures/native-tower-clear-824867.txt`，新測試 `tests/native-tower-wound-preview.test.ts`。保留原始文字而非修過fixture。

## 修正與驗證

- `src/combat-native-tower.ts`只在下層預覽數值括號後允許精確已核重傷後綴，不泛化任意文字、百分比或另起一行。
- 舊完整四／五行、精魄安全整數、相鄰樓層、敵HP0與正式擊殺前置不變；未知效果、重複後綴、錯序、缺行仍拒絕。
- 預覽不污染本場目標疾風隼、HP0、主動回血5295與名目數值；riskVerified仍false。測試涵蓋精魄與重傷合併行號、MP單扣、怪金／首達單計及重讀防重。
- 修前13項中3失敗／10通過；修後相關3檔47項全通；完整117檔1857項全通；`npm run build`與相關Biome通過。diff檢查另核。
- 未重建SQLite／舊帳。離線回歸不冒充新版自然事件，parser9載入已驗：reload後enabled=true／parserVersion9，824874／876新核本人與97，878新春後880／884／886實戰。新增重傷預覽自然通層驗收仍待後續；一般技能成功不替代該驗收。

## 續行

已單獨reload並收到自動continue，新runtime核parser9、本人資源及97。882主動回春實補1520至滿，與預覽重傷文案不能直接互套；不推所有治療免重傷。97較96 HP＋8%／ATK＋4%，重傷吸血／回春−60%已列，但不可直接將文案當主動回春實補公式；舊87重傷主動回血樣本僅輔證。新盾滿血有限試探前保留先機→主動回血→反擊，不借被動神吸／暴追／閃／星火。跨層或reload前盾不用。

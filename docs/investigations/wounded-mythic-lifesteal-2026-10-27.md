# 重傷神話吸血標記缺漏（2026-10-27）

## 結論

824910與930的 `🩸 神話吸血 +數量（重傷衰減）　HP：…` 未被parser9辨識，導致戰鬥complete=false與資源推導失效；更重要的是主動吸血跳過被動的HP轉移，930誤算實補1520而非371。現在只接受已核精確可選標記，沿既有HP差計算兩種治療來源，保留標記原文，不推衰減前數值或另套倍率。parser升10。

## 證據

- 930source `91a92d99-5ff0-4a5b-a579-9fa1d5ea25d3`，operation `0ccc8f29-d94e-4a06-be53-28778c119ba5`，date1793052197／revision `ee10343bdcee61b5fb0034d3d1dcf1af25a46f612d33eb02ca8531e92829daaf`。
- ledger observation5920，snapshot `49b882323ef5d0d45ef43de972dbe01a1b2663851d1bd60e279f242cad7b3981`：唯一unknownLine9是重傷神吸，complete=false；主動第10行誤得actual1520、unapplied11879。原HP1520→被動1149到2669→主動13399回3040，正確主動actual371、unapplied13028，不能把未套用名目全部叫溢補。
- 910類同，被動548只到2068，主動6389實補972。使用該比例作測試變體不冒充新的原始fixture。
- 932新本人status核HP1520／MP206、23020004G，source `6273c551-fa4e-4e32-90cc-6568959c2dcf`；新資源觀測不回填原parser結果或護盾。
- fixture `tests/fixtures/native-wounded-lifesteal-824930.txt`保原文，新測試 `tests/native-wounded-lifesteal.test.ts`。

## 修正與驗證

- `src/combat-native.ts`僅在神話吸血量後允許可選精確`（重傷衰減）`，標記保存description。未知／重複標記、溢位與HP矛盾仍拒絕。
- 來源仍mythic_lifesteal／active_skill，事件順序不變；首次無前HP實補仍unknown，riskVerified仍false，不把樣本或解析complete當安全批准。
- 新9項修前4失敗／5通過；修後相關3檔28項通過，完整118檔1866項全通，build、相關Biome、git diff --check通過。
- 未重建SQLite或覆蓋v9歷史解析；v10已載入enabled=true／parserVersion10；934／936重核本人／97，938新春才940出手。新自然956與962重傷神吸已驗收：observation5946／5952，complete=true、unknownLines／issues空，riskVerified仍false，HP／MP各正確推導。956／962被動名547實547，主動分別名6381／6380、實973，不再誤算1520。trace snapshot `29b724d76e4a714cc838b9300dcbcc778ea32f32b5a6753c8eefa5d36375cb3e`／`39f5dc6c6cc30f9d9ab8975fdb9472fca97dc4dd5f834aa0653653d0250efb8b`；956 source `f0d8fee0-08b0-4072-b992-33a49676eba3`，962 `38e988cf-4bce-4c32-960e-4a6384a41fab`。未rebuild舊事件，離線及實機證據分開。

## 續行

reload與新春實戰續行已完成；目前976本人3040／422全滿、23020004G，978同97保怪9947902／10509786。新自然重傷神吸回歸通過，不代表完整承傷上界或其他新格式已驗收；下一筆新春，不沿休息前盾。新未知結果先history，不重送。

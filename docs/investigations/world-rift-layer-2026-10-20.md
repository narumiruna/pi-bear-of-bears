# 公開地圖漏裂隙圖層與導航保護（2026-10-20）

## 結論與限制

`parseWorld`只合併`rooms`與`rooms_under`，漏掉公開快照中的`rooms_rift`。因此原始資料有210星核裂隙，`bears_world(roomId:210)`仍回total0。這是本機解析缺口，不表示入口不存在，也不證明遊戲即時出口或世界王存活。

新增圖層不能只合併資料：原始211–216世界王房的`boss`都為0。保留原始`safe`／`boss`語意，同時以來源圖層保守限制裂隙非安全房的自動導航與掛機選點。不得由`boss=false`認定普通怪房，也不推測名稱或敘事補出口。

**目前session未reload、未遊戲內驗證。** 另於23:07:50直接用編譯後WorldMap對真實公開URL查詢210／211成功（見下），不是Telegram或目前工具載入結果。修正不解決74層承傷、召喚技能容量／MP或工藝完整費用。

## 原始證據

- 固定公開URL：`https://bearofbears.net/state.json`。2026-10-20 22:57 +0800以標準瀏覽器UA單次取得200；來源`ts=2026-10-19T01:42:54.060275Z`，不以抓取時間刷新來源時間。
- 根欄位有`rooms`148間、`rooms_under`25間、`rooms_rift`7間；沒有skills／config／combat／formula定義。查本來源未取得深淵巨獸MP或容量，不把缺欄位當成已知零值。
- 22:58 `bears_world(roomId:210)`：total0、rooms空、outputComplete=true；source `c808b2bf-c06f-4699-9656-29c6004e2d5b`。這不是輸出省略：舊parser根本未讀該層。
- 210：星核裂隙，raw safe1／boss0，ex南211；211：裂隙·凍原獸影，raw safe0／boss0，ex北210／南212。後續至216皆raw safe0／boss0；房間描述有世界王定位，但不以描述自行產生出口或存活證據。
- [最小實際fixture](../../tests/fixtures/world-rift-public-20261020.json)只保留必要公開地圖欄位及完整7間裂隙房，不保存玩家、聊天或其他無關公開資料。空地表／地底是測試裁剪，並非原始快照缺少該兩層。

## 修正範圍與護欄

- 房間保留`sourceLayer`，供唯讀展示與路線護欄辨識；不將原始`boss=false`偷偷改成true。
- 裂隙非安全房可唯讀展示，但不得成為自動移動目的地、中繼或原生掛機啟動候選；零步同房情境也不得繞過。手動探索、打王與原生掛機授權沒有增加。
- 210原始安全房仍保留既有出口，能作路線通行候選；不使用`rift_gate`或`tower_gate`敘事合成新出口。公開連線缺少時保留缺口，不保證能從營地抵達。
- 舊層、重複ID／非法層／非法出口護欄與12秒快取、固定URL、來源時間維持。新圖層不是即時登入狀態或BOSS存活證明。

## 離線驗證

- 子任務限定修正地圖、共用路線、自動移動與掛機候選；先實際fixture與紅燈回歸，再修正，不使用網路／Telegram／憑證。
- 主線另增[實際extension-loader回歸](../../tests/world-rift-extension.test.ts)，以mock公開fetch驗210／211資料、來源層、raw boss值與唯讀schema；這不是連線遊戲。測試僅允許固定公開URL，兩次查詢應共用快取，不登入Telegram。
- 子任務先紅5項漏層；僅補parser後再紅9項導航／掛機風險，確認漏護欄會實際送go或接受同房零步。修正後相關8檔101項及build通過。
- 主線23:02獨立`npm test`全套**71檔1232項通過**；`npm run build`通過，本次9個程式／測試／fixture的`biome check`與`git diff --check`通過。Node localStorage ExperimentalWarning為警告，沒有失敗測試。
- 主線逐值比對fixture完整7間rooms_rift及ts與公開原文一致，無players／chat等其他根欄位。再以編譯後`parseWorld`讀當次完整公開快照，總180房；210保留safe=true／boss=false且navigationBlocked=false，211–216皆safe=false／boss=false且navigationBlocked=true。不把此離線輸出當成目前tool已reload或實機導航驗證。
- **23:07:50 +0800真實公開服務驗證**：以編譯後`WorldMap`直接對固定`https://bearofbears.net/state.json`查210／211，非mock、未發Telegram。兩次均唯一房間、sourceLayer為rooms_rift、raw boss=false；210安全且可作導航候選，211非安全且navigationBlocked=true。兩次fetchedAt同為`2026-10-20T15:07:50.007Z`，實際共用有效快照；來源ts仍`2026-10-19T01:42:54.060275Z`。這比離線fixture驗證多了實際HTTP與schema解析範圍，但不驗證目前session已載入、即時遊戲位置、出口可走或王存活。
- 文件相對連結另行檢查；未操作移動、攻擊、掛機或付費。

本次不以修工具當作新增勝場、通層或實際裝備提升；本人與八角分工另見當月戰報及[續行檢查點](../goals/berserker-active-others-idle-continuation.md)。

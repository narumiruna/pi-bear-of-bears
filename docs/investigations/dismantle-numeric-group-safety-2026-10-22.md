# 數字分解索引整組誤拆：安全修正

## 結論

`bears_dismantle_item` 原先宣稱分解單件，卻允許數字索引直接送往原生整組入口。現已在共享 command catalogue 及送出前驗證禁止數字參數／數字字串，僅保留已核唯一名稱。這是 `extensions/bears.ts` 實際註冊所使用的實作修正，不只改文件。

離線兩檔423項測試、build、指定檔Biome與diff檢查通過。**目前工作階段仍是舊tool schema，尚未reload實機驗收；不得重送數字分解測試或自動續付原批次。**

## 原始證據與影響

- 2026-10-22 03:34 +0800，劍聖欲從餘品逐件供料，778946母表#16為不朽永恆護符×6、#17同名單件。錯將工具的「單件」描述套用數字路徑，送出 `bears_dismantle_item({item:16})`。
- 778948回覆明列護符×6→神話碎片12；單筆原意1件、實際6件，不應淡化成單件成功或把原授權倒寫成整組。原文source `736b321d-e2f9-4949-90b5-a67442395da6`，offset0／limit6000、總526字、已完整。
- 已立即停止後續分解與精煉。778950–953全342列連續確認：該6件組已不在、另一同名組仍1；兩組護甲2／5未動、原裝／授技物仍在，通用碎12、精13867／晶1978、金30495798G。source `771cdba5-60cd-42f4-bbcd-d1a2c52e5ff4`。沒有執行手腳＋2或新增付款。
- 背包種類仍342：少一組護符、新增通用神話碎片一種，不能把總數未變當未消耗，也不是parser漏頁。
- 舊715574等只證**名稱路徑**當次拆一件，沒有證明數字也單件；舊文件錯誤泛化，Agent也未區分。名稱同名分組仍需另核唯一性，這次修正不保證任意名稱皆安全。

## 修正

- `src/game-command-catalog.ts`：單件tool的`item`改為名稱string，說明數字會整組及同名不明時停止。
- `src/game-commands.ts`：序列化送出前拒絕整數字串，先NFKC正規化以涵蓋全形／上標等相容字形；保留`全部`與`>編號`拒絕。數字型別由schema拒絕。
- `tests/game-commands.test.ts`：來源778948的9種數字／字串回歸均驗證send未被呼叫，另驗證3種正常名稱只送一筆；不以真實物品重測。
- `tests/bears-codemode-loader.test.ts`：實際載入`extensions/bears.ts`後核新schema拒絕數字且保留名稱；不執行Telegram工具。
- `skills/playing-bear-of-bears/commands.md`、`references/structured-tools.md`：分開名稱單件與數字整組語義，禁止以批次tool或部分名稱繞單件限制。

整組操作沒有被包裝成新的單件能力；既有批次tools仍需完整範圍授權。沒有變更遊戲端、放寬保留量、擴大授權或補償／交易操作。

## 驗證與剩餘限制

- `npm test -- tests/game-commands.test.ts tests/bears-codemode-loader.test.ts`：2檔423項通過。
- `npm run build`：通過。
- `npx biome check src/game-command-catalog.ts src/game-commands.ts tests/game-commands.test.ts tests/bears-codemode-loader.test.ts`：通過。
- `git diff --check`：通過；未跑無關的完整測試集。
- 中途一次build發現測試將通用TSchema當TObject取properties，已改結構斷言後重跑通過；一次Biome區塊格式錯誤亦已修正重驗。
- 03:41唯讀`describeTool`仍回舊`number|string`與舊單件描述，證明修改尚未載入此工作階段。新離線loader不是目前熱環境的實機驗收。
- reload後先新history及tool metadata確認版本；不得靠發真實數字分解補證，不重播此次操作或自動續付＋2。另核新角色、完整背包、唯一名稱、保留量與完整含稅費後才重新選操作。

遊戲檢查點與最新Goal仍見[雙角續行](../goals/berserker-swordmaster-95-codex-rank-continuation.md)，所有遊戲目標尚未完成。

# 帳本漏綁技能查詢回執

## 結論與實機證據

2026-10-26 17:46 +0800，Goal `c8c0496f-dac6-4021-bcaf-8b03aed71357` 於爬塔前驗證技能時發現新bug，依要求停止遊戲。沒有為確認bug施法或重送查詢。

- 819026完整原生技能表；`bears_skills` 來源 `3aa52c37-43fe-48bf-8361-ff31a46782e8`，accounting operation `36ff3be1-310e-46e4-b2e8-bc86588b1250` 誤列 unresolved。
- `bears_combat_snapshot` 來源 `51ab04f9-bac2-44bb-bf2d-f97aa0b08789` 同時解析五項技能；費用完整性仍為未知，不視為出手批准。
- 原文保存為 `tests/fixtures/skills-berserker-819026.txt`。這是本次本人原生回覆，不是即時資源或技能防護證明。
- `parseLedgerFacts` 已產生 skills 事實，但 `src/ledger-attribution.ts` 的 replyMatches 沒有對應 `/skills`，所以明確查詢誤列未決。不是Telegram延遲或精簡遺失。

## 最小修正與界線

- 增加 skills 事實與精確 `/skills` 指令匹配；沿用 outgoing echo 唯一性、重複回覆、來源與歸屬護欄。
- 回歸另發現 `ledgerCommand` 會刪掉非保留指令的引數，使 `/skills 其他` 被縮為 `/skills`。現在這類未知引數回傳null，不落盤自由文字，也不能冒充無引數查詢。
- 不改技能parser、完整成本或戰鬥護欄；不從表頭MP推即時餘額，不推HP成本零、盾耗次或安全。不新增資源延續規則，確認查詢與完整資源分開。
- 既有 `extensions/bears.ts` 的ledger接點沿用修正；沒有新增旁路、Telegram操作或背景工作。事實格式未變，parser版本仍2。

## 離線驗證

- 新增 `tests/ledger-skills-binding.test.ts` 十項：原生／標籤式技能表、錯指令、未知引數、重複回覆、無身分、無技能列、只有watch，以及未知引數不落盤。
- 修改前3失敗／6通過；第一輪修正後未知引數案例仍失敗，補privacy防冒充後九項全通過。
- 原九項回歸完成時，`npm test -- tests/ledger*.test.ts`：九檔129項通過。
- 使用者後續要求 resolve 後，再補未知引數不落盤驗收；完整 `npm test`：106檔1693項通過。`npm run build`、三個修改程式／測試檔Biome及 `git diff --check`通過。
- 使用者後續回報已reload；於新Goal另行授權遊玩後，819030新 `/skills` 回覆 accounting state=confirmed（來源 `2668cfeb-4dc7-4e04-96b4-51d418bf47f3`），完成此漏綁修正的實機驗證。HP／MP仍unknown、complete=false符合既有保守行為，不代表查詢失敗或完整資源確認。未執行歷史rebuild。

## 遊戲中斷點

819022／819024已回滿HP3040／MP422；金23861826G，休息錢差0G。819020最後觀測同次93、怪4799446／7725007、最佳92。本輪未攻擊、未新增通層、未重入或付入場費，無當手施法／攻擊待釐清。技能查詢的帳本歸屬缺漏與遊戲結果分開記錄。

- [原文回饋，2026-10-26 17:46](../context-feedback/2026-10.md#2026-10-26-1746-ledger-skills-binding)
- [本人操作明細，2026-10-26 17:49](../notes/2026-10.md#2026-10-26-1749-berserker-skills-ledger-stop)

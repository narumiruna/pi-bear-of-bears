# 原生王者重擊註記缺漏

## 證據與影響

831552及831574的高血星主戰報含「👑 🌟星主·冰縛女妖 王者重擊！」。parser10不接受此行，使combat.complete=false，HP／MP推導未知，workflow以unknown_bot_reply失效。574 source `b64b7747-db80-427d-8ec3-3428f324ba1b`、operation `f2c5ab80-142b-4691-9c8c-6fc7f356e728`；原文完整，非精簡遺失。戰報最終HP1520、怪21075861；不重送攻擊。

## 修復與離線驗證

- fixture `tests/fixtures/native-royal-strike-831574.txt`，8項回歸修前2失敗／6通過；修後全過。
- `src/combat-native-enemy-effects.ts`保存精確王者重擊為effect及目標，拒絕重複、傷害前／反傷後／反擊後錯序、缺反擊；未知後綴仍拒絕。不補倍率、不另加傷害、不改riskVerified。
- 因原檔超500行限制，將同責任的裂甲／蠻力衝撞原邏輯一併搬入敵方註記helper，無規則變更。`LEDGER_PARSER_VERSION=11`；不rebuild舊帳。
- 相關3檔28項通過、完整119檔1874項通過；npm run build、目標Biome、git diff --check通過。測試警告localStorage未提供file，不影響結果。

## 部署中斷點

2026-10-27 16:16 +0800：831576收刀／578免費全補，580本人3040／422、26563228G，582最佳99／入18、同100怪21075861／21182886。100累計五血五春460MP、兩休552MP（含99末缺92），330＋552−460＝422，削107025HP。休息前盾不沿用。

## 載入與新自然驗收

reload完成，bears_ledger_status enabled=true／parserVersion11／diagnostics空；831584本人全滿、586同100保血後588新春續攻，未沿舊盾。831646自然王者重擊驗收：source `790c3f3d-3f03-44bc-911d-166ddc705a85`、operation `7b9c0f02-8723-4f2f-aa71-d934fb4c46e0`、observation12627，parser11 complete=true、ongoing、unknownLines／issues空、riskVerified=false；重擊effect一筆、反傷3882、最終反擊1520，accounting確認MP206／HP1520。trace snapshot `11a19fd98ce5b12763fc72c04788702c0c2f82187186eaec1e72fe1f06ab5ea6`已完整讀取；未重送或rebuild舊帳。修復部署驗收完成，計畫可刪除；不代表持續爬塔Goal完成。精魄／下層重傷預覽自然通層格式仍待驗。

# 名稱 inspect 誤使裝備快照失效

## 結論

`extensions/bears.ts` 的送出前分類僅接受 `/inspect 數字`，但 `EquipmentSnapshot.observe()` 已支援唯一名稱。因此 `/inspect 嵐羽疾行靴·神` 在送出前清掉所有 inspect 綁定並提高角色 barrier，之後回覆無法恢復角色有效性。不是 Telegram 換裝失敗；本輪未送換裝。

## 重現與修正

- 現場：陰陽 `/status` 1003928、完整309庫1003930–33、兩靴 inspect1003935／37；刷新後仍失效。原文與候選對照見 [回饋](../context-feedback/2026-11.md#2026-11-10-yin-optimizer-source-refresh)。
- 直接離線重播這12則原生訊息時，snapshot 可綁兩靴且沒有失效 barrier，定位到送出前而非原文 parser。
- 新 `EquipmentSnapshot.isQuery()` 共用既有數字查詢與唯一名稱解析；送出前及 outgoing 回聲採相同分類。不廣放名稱 regex，不修補過期來源，不解除技能／被動、歧義、完整性、資格或成本護欄。
- 新 integration regression 使用原生精煉靴格式，涵蓋名稱含／不含 emoji、取消、成功送出與保留先前 inspect；即使分類修好，未知效果仍阻擋推薦。
- 新 snapshot regression 拒絕未持、重名及換行複合指令。原有數字／狀態變更取消行為保留。

## 驗證

- 暫時還原舊送出前數字分類，兩個新 integration case 均因 inspectSources 被清空失敗；已恢復修正。
- `npm test`：121檔1952測試通過；`npm run build` 通過。
- 後續僅整理行數／Promise 回傳以通過 lint；相關41測試及 build 已再過。最終四個修改程式檔的 Biome check、build 及 `git diff --check` 亦通過。
- Biome CLI 2.6.6 對既有 schema 2.5.12 顯示資訊提示；未擅改設定或使用者 package 變更。
- reload現場重驗通過：新status1003939、完整309庫1003941–44，連續名稱inspect1003946／48後，optimizer原文保留兩筆inspectSources、正確本人與完整庫，失效barrier消失。其他特殊列缺軸／效果仍使applicable=false，未換裝；詳同一回饋anchor。

## 續行

目前控制陰陽熊，最後安全前庭、全2120／1154、35,603,129G（歷史觀測，須刷新）。無未決狀態變更；六穿＋5未換、星核靴＋3仍備用。先 reload，再 history／新status→完整庫→必要 inspect 重驗分類；若仍無適用推薦，保留現裝並續其他合法補強／稱號來源。完整雙目標未完成，不呼叫 goal_complete。

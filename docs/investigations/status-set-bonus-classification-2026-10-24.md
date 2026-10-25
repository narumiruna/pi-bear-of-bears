# 原生套裝狀態遭誤拒絕（2026-10-24）

## 原因與證據

- 22:09 +0800，798299 `/status`完整回覆確認狂戰熊木屋手動、HP3040／MP422全滿、10034860G、3759／5710／520／798。source `9c0286dd-8bcb-40aa-8c1f-41db435c2a1a`。
- 隨後 `bears_combat_snapshot` 回`actor=null`、`unknown_bot_reply`指向同一798299，source `02a828cd-fe3d-465d-914c-b54782584b1f`；未呼叫move_to、未送任何導航子操作。
- 原文保存為`tests/fixtures/character-status-berserker-798299.txt`，沒有截斷、未知費用或身分衝突。`statusFacts`能辨識本人，但`workflow-status-reply.ts`完整行型漏掉原生`🎽 套裝加成：…`，且原生`🎽 /gear 看逐部位裝備`沒有句號，既有規則卻要求句號。
- 修改production前新增fixture與回歸，19項中兩項如預期失敗，重現整份新status無法綁定。不是以未知公式為由停止材料戰，也不放寬數值／時效護欄。

## 修改範圍

- `src/workflow-status-reply.ts`只接受有系列名、×1–4件及完整全形括號描述的套裝摘要；可多系列，但摘要重複出現仍拒絕。不將套裝敘述換算成DEF、盾或收益。
- `/gear`固定提示行接受已保存的有／無句號兩種結尾，不略過任意新增尾文。
- 測試核對本人資源、原生來源與可綁快照；重複套裝、零件數、錯誤結構、未知尾文、重複金幣仍必須失效且零派送。

## 驗證與限制

- 相關4檔42項測試＋build通過。
- 修正測試檔格式與lint後，兩個修改TS檔Biome通過；全96檔1544項Vitest及`npm run build`通過。Node僅輸出既有localStorage experimental warning。
- 尚未reload，也未用新parser執行Telegram導航；不能把離線成功當實機通行或95驗收。現有工具仍可能載入舊版，受影響的是依賴此status分類的固定流程，不是所有原生單步遊戲操作。
- 本人保持已確認安全木屋全滿；材料戰後續依新外部Goal及當前回覆獨立決策，不重送原失敗snapshot作遊戲操作，不要求使用者代做危險測試。

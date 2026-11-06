# 未滿一天的掛機報告使星塔觀測失效

## 結論

2026-11-06 11:30 +0800已修正extension共用parser `src/workflow-events.ts`：完整詳細通知增加已觀察的「小時／分鐘」時長格式。不變更身分、來源時效、未知訊息或戰鬥安全護欄。

相關四檔116項、完整119檔1881項、build及三個變更路徑的Biome檢查通過。下一個操作實例須載入修正並重驗當前狀態；修正後同類自然混報的遊戲內驗證仍待觀測，不為此等候或輪詢。

## 原文與重現

- 狂戰在同104／入38施放回春後，`/tower`批次夾三份其他角色掛機報告。劍聖報告959420 date1793934931、revision `2e16103a09a8251445111fbc70b0d11decf33ad5a8995ac43c1166a978635d26`，其第二行為「🐾 已掛機 11 小時 45 分（本次結算 1 小時 20 分）　共走過 22 個地點」。既有詳細parser只接受「天／小時」，因此未辨識所屬角色，設unknown_bot_reply失效界線。
- 舊程式對原生完整16行回null，四項新回歸在修正前失敗，包含同批tower使本人來源失效的案例。不是Telegram未送達或真正切角；當時新status／tower已另核本人、原生結果明確，沒有未決技能。
- 一次唯讀 `bears_history({limit:8,beforeId:959421})`保存959416–959420，來源 `5438b61d-bd58-4afc-b527-a30e9972800f`、取得2026-11-06 11:22:42 +0800；[fixture](../../tests/fixtures/native-idle-959420.json)直接由結果JSON.stringify寫入，無手抄hash、未送遊戲指令或使用original。訊息時間與取得時間分開；歷史取證不刷新遊戲資源。

## 修正與限制

- 只增加完整16行詳細通知中的「1–23小時、0–59分」格式；原有「正整數天、0–23小時」格式不變。其餘位置、路線、擊殺、金幣、EXP、八條掉落、其餘裝備及滿級尾行仍須符合既有協定。
- 仍拒絕零小時、24小時、60分、超出安全整數、未知單位、缺行及附加本人獎勵。這是parser支援範圍，不外推遊戲全部時長顯示規則；展示掉落不作物品入帳。
- 他角完整報告不影響本角來源；本角完整報告仍設own_resource_report使資源失效。整合測試以合成控制status及真實同批tower／三角報告驗證，不冒稱真實原子快照或生存保證。
- 實作在共用parser，extension的觀測、配裝來源及收益分類沿用同一辨識結果，不新增旁路、設定或自動恢復。

## 載入後正常操作

2026-11-06 11:33–11:43 +0800，新實例載入修正後完成三個正常MP區間，實削365176 HP、實耗及恢復1140 MP、三次0G全復；[完整戰報](../notes/2026-11.md#2026-11-06-1143-berserker-tower104)。沒有再遇同類混報，這只證明本次正常續行，不替代該分支的自然實機驗證。

## 檢查

1. `npm test -- tests/native-idle-report.test.ts tests/workflow-event-classification.test.ts tests/workflow-observations.test.ts tests/workflow-tower-step.test.ts`：4檔116項通過，新增11項；包含原文、合成時長邊界、拒絕案例與本人／他角隔離。
2. `npm test`：119檔1881項通過；`npm run build`通過。
3. `npx biome check src/workflow-events.ts tests/native-idle-report.test.ts tests/fixtures/native-idle-959420.json`及`git diff --check`通過。初次import排序錯誤已修；既有schema2.5.12／CLI2.6.4提示未改。
4. 遊戲當批三區間實削316074 HP、三次0G全復，見[2026-11-06 11:19戰報](../notes/2026-11.md#2026-11-06-1119-berserker-tower104)。這是修正前的已確認戰果，不當修正後自然混報驗證。

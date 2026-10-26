# 原生星塔恢復帳本解析修正

## 結論

2026-10-26修正已觀察到的合併套裝status、收刀及休息格式。這是離線解析修正，不代表遊戲戰鬥安全已驗證；現場沒有reload、rebuild或重送操作。

## 原文與重現

- 818840完整本人status的套裝列為「絕世熔核×2件、絕世地脈×2件（…）」；既有規則只接受每個套裝分開括號，導致帳本status未建立。來源 `333f959b-7bfb-4311-9c7b-7efbae680962`；完整fixture為 `tests/fixtures/character-status-berserker-818840.txt`。
- 818930「💨 你趁亂逃跑了！」，來源 `74384437-85d6-4475-a50d-54597429a253`；818844「你沒有在戰鬥中。」，來源 `31760ec7-5b75-4811-bf52-bcfffde2aff4`。原先不是可歸屬的帳本回執，造成角色／資源推導中斷。
- 818932「💤 充分休息後恢復了！」及第二行「HP：3040/3040　MP：422/422」，來源 `fb8af50f-48a1-43e8-ac43-eb9e33ed4eec`；初版只支援labelled replay，未解析原生明示餘額。
- 新增回歸最初18項中5項失敗、13項保守案例通過，確認不是Telegram操作失敗；沒有因帳本unknown重送遊戲指令。

## 修改與界線

- `src/workflow-status-reply.ts`只新增逗號式套裝群組形狀，保留重複欄位、錯誤件數及未知尾文阻擋。不從效果描述改寫屬性或防護。
- `src/ledger-facts.ts`及`src/ledger-attribution.ts`新增兩種已觀察收刀回覆與完整兩行休息。仍須精確outgoing echo及唯一同指令回覆，不接受其他指令、重複回覆、未知尾文、未補滿或超界數字。
- `src/ledger-resources.ts`收刀後資源仍未知，只保留身分鏈；休息依明示值更新HP／MP與上限。恢復前MP未知時實補未知，不以新滿值減零；原生休息沒有錢包／價格欄位，因此金幣未知，不推零費用。
- `src/ledger-types.ts`的parser升v2，`src/ledger-query.ts`的狀態／分頁schema跟隨常數，wire version仍1。舊原文與v1事實不刪除；新版本歷史重建須由使用者載入後執行 `/bears-ledger rebuild`，不自動開啟、遷移或查詢私人帳本。
- 此修正由 `extensions/bears.ts`既有ledger接點與workflow parser使用；不新增extension旁路、背景戰鬥或直接Telegram存取。

## 驗證

- 新增 `tests/ledger-native-recovery.test.ts` 共20項：實際status與恢復、無身分／切角、數字／尾文、重複回覆及錯指令；沿用完整共同Game→帳本投影，不只測regex。
- parser重建測試改用版本常數，保留舊版事實並驗證重建不觸發transport。
- 全套Vitest：最終修改後103檔／1659項通過；相關8檔／130項亦通過。`npm run build`、修改檔案Biome與`git diff --check`通過。
- 尚未reload、未執行實機新版parser驗收或歷史rebuild。保留當次93層挑戰，不為部署reload工作階段；舊runtime仍可用遊戲原文逐筆確認，但不得宣稱新版accounting已生效。

## 遊戲中斷點

818932本人於星塔前庭HP3040／MP422已滿，93怪最後5212949／7725007HP、最佳92。未退出、未重入、未消耗新入場材料；下一次遊戲行動先核目前角色與有效挑戰，新回春後才續戰。詳細投入見[2026-10-26 16:59戰報](../notes/2026-10.md#2026-10-26-1659-berserker-tower93-resume)。

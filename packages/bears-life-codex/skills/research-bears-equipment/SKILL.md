---
name: research-bears-equipment
description: 查詢萬熊之熊公開 BOSS 裝備圖鑑及合成配方，研究掉落、屬性、被動、材料、精魄、金幣與進化費用；適用於比較角色裝備強化途徑，不執行購買或製作。
---

# 研究萬熊之熊裝備來源

使用 `bears_life_codex` 唯讀查詢公開圖鑑，不需要 Telegram 帳號。
先以 `query` 搜尋 BOSS、裝備名稱、屬性或技能；需查合成材料時設 `recipes: true`，空查詢則逐頁讀取 `nextOffset` 至 `null`。
回覆時附上來源 URL、抓取時間、百分比機率與原始數值；`evolution` 為獨立的進化費用表，不等同配方的 `gold` 與 `essence`。
不要把公開資料當成角色已持有材料、BOSS 即時存活或已解鎖配方的證明。
若要計算角色可行性，另取得該角色最新狀態及完整背包；資料缺漏時標明未知，不推定可製作或可穿戴。
本 skill 只授權研究；購買、製作、進化、戰鬥、換裝與切換角色須另有使用者明確授權，並遵循 `playing-bear-of-bears` 與 `bears-equipment-strategy` 的安全規則。

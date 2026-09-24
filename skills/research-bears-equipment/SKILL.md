---
name: research-bears-equipment
description: 查詢萬熊之熊公開 BOSS 裝備圖鑑及合成配方，研究掉落、屬性、被動、材料、精魄、金幣與進化費用；適用於比較角色裝備強化途徑，不執行購買或製作。
---

# 研究萬熊之熊裝備來源

先讀取[頁面索引](references/codex-page.md)，辨識 BOSS 等級、位置、王之精魄與特殊材料來源；這是使用者提供的歷史摘錄，不取代最新圖鑑。
使用 `bears_codex` 或 `bears_life_codex` 唯讀查詢 `https://lab4.kvzhuang.net/gen-art/bears-life-codex/codex.json`，不需要 Telegram 帳號，也不使用 Firecrawl；兩個工具功能相近，擇一即可。
先以 `query` 搜尋 BOSS、裝備名稱、屬性或技能；需查合成材料時設 `recipes: true`，空查詢則逐頁讀取 `nextOffset` 至 `null`。
若目的是補王之精魄，先查荒原巨角獸：頁面摘錄列出 Lv80、巨獸的領地、精魄70%（並非必掉）；再以當次圖鑑、遊戲 `/boss`、角色 HP／位置、實際出口與 `/consider` 查證。
只有得到「輕鬆」或「有把握」、有安全路線與恢復手段、並有使用者戰鬥授權，才可按遊玩 skill 戰鬥；不得因缺材料就省略這條可驗證路線，也不得把這份唯讀研究 skill 當作戰鬥授權。
回覆時附上來源 URL、抓取時間、百分比機率與原始數值；`evolution` 為獨立的進化費用表，不等同配方的 `gold` 與 `essence`。
不要把公開資料當成角色已持有材料、BOSS 即時存活或已解鎖配方的證明。
若要計算角色可行性，另取得該角色最新狀態及完整背包；資料缺漏時標明未知，不推定可製作或可穿戴。
本 skill 只授權研究；購買、製作、進化、戰鬥、換裝與切換角色須另有使用者明確授權，並遵循 `playing-bear-of-bears` 與 `bears-equipment-strategy` 的安全規則。

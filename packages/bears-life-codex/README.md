# 萬熊之熊公開圖鑑 Pi package

此 package 僅從 [公開圖鑑](https://lab4.kvzhuang.net/gen-art/bears-life-codex/) 的 `codex.json` 抓取 BOSS 掉落與合成配方，不使用 Telegram session，也不執行遊戲操作。

從本儲存庫安裝：

```bash
pi install ./packages/bears-life-codex
```

亦可在單次執行時使用 `pi -e ./packages/bears-life-codex`。
安裝後重新啟動 Pi 或執行 `/reload`，透過 `/skill:research-bears-equipment` 查詢，或直接呼叫 `bears_life_codex`。
例如 `bears_life_codex({"query":"孢子"})` 查 BOSS，`bears_life_codex({"recipes":true,"query":"熔鑄"})` 查配方；使用回傳的 `nextOffset` 翻頁。

資料每 12 秒最多重新抓取一次；每頁最多 10 筆。
公開資訊可能過期，不代表角色已持有物品、遊戲內配方已解鎖或 BOSS 即時存活。
若同時安裝完整 `pi-bear-of-bears` package，它已提供功能相近的 `bears_codex`，請擇一使用，避免重複查詢。

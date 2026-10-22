# 結構化遊戲 tools 完整對照

## 覆蓋範圍與來源

2026-10-17 核對 @BearOfBearsBot 的 Telegram command menu（`users.GetFullUser` 的 `botInfo.commands`）共 87 個命令，並核對即時 `/help`（訊息 729558）。
另納入已確認的 `/gearrank`、`/unalias` 及 5 個 slash aliases；共 94 個入口、117 個 tools，含分開封裝的查詢及狀態變更子命令。一般中文快捷及 MUD 方向縮寫由 canonical tools 表達，不另建 tool。

- 命令與 schema：`src/game-command-catalog.ts`；驗參數、序列化及註冊：`src/game-commands.ts`。
- 離線覆蓋快照：`tests/fixtures/game-command-catalog.json`。測試比對所有入口，不維護交易排除清單。
- 子命令來源：729564（合成）、729566（合成保管區）、729568（快捷）、729570（BeBeMove）、729572（介面設定）、729574（股票）；既有觀察見[遊戲指令參考](../commands.md)。
- 熊彩539 的 5 個相異號碼為 1–39，另與[官方樂透頁](https://bearofbears.net/bears-life-lottery/)交叉核對。
- 這是當次已確認的公開命令，不保證涵蓋日後新增或未公開的命令。新增時須更新 catalogue、快照、測試及本表，不猜測語法。

## 操作界線

工具覆蓋與操作授權分開。提供 `buy`、`sell`、`sellall`、拍賣、股票或樂透 tools，不解除適用的交易禁令，也不代表使用者已核准花費、移除物品、轉職或公開發言。
`sellall.rarity = 全部` 能表達既有語法，但仍受禁止使用規則限制；`史詩` 仍須先確認目前角色未二轉。
查詢選單不授權點選其中的付費或不可逆按鈕。

每次呼叫只送一筆 Telegram 指令，不自動重試；先讀 `bears_history`，逐筆核對結果。角色、資源、目標或結果不明時先補查，仍不明則停止受影響操作。理論承傷上界未知不等於全面禁打；已勝區間與使用者允許的鄰階試探依 [skill](../SKILL.md#以已勝紀錄為邊界往上試一階) 判斷，不捏造公式或 planner 欄位。
所有 tools 共用既有 send path、操作鎖、Auto Idle 排他、快照失效、原文及精簡處理。重新載入不會自動執行任何命令。

**名稱例外：`bears_game_history` 傳送遊戲 `/history`；既有 `bears_history` 只讀 Telegram 聊天紀錄，兩者不得互相取代。**

### 合成 #358 界線

合成流程更新僅依使用者提供的票 #358 部署說明，尚未實機核驗；歷史訊息 729564 不證明新流程已驗證。
`bears_craft_make` 省略 `confirm` 僅預覽、不消耗；`confirm: '確定'` 執行不可逆合成，實際材料含絕世裝備時須使用 `confirm: '確定燒絕世'`。
確認前須以最新預覽及本人即時背包逐筆核對實際永久消耗的裝備品項與數量、精魄、金幣、稅及含稅總額，並保留目前所需裝備、技能與材料。
非絕世優先不是犧牲所需裝備的許可；鎖定物品排除，絕世裝備仍可當材料。
不得自動接續確認，也不得因普通確認被擋而自動升級確認；兩種確認都必須另行核對授權及不可逆副作用。
`bears_plan_upgrade` 支援讀取已保存的配方預覽，保留原始消耗文字與警告；格式不明或完整投入缺漏時仍阻擋相依操作，不付款或自動確認。

## 參數規則

- `?` 表示選填；`item` 的正整數或 string 代表編號或名稱，編號須綁定對應的最新清單。
- 正整數必須在 JavaScript 安全整數範圍內；所有 schemas 拒絕未知欄位。
- 一般名稱最多 200 字元；`say.message` 最多 4091 字元。字串不得含控制字元、換行、頭尾空白或開頭 `/`。
- 單一 token 欄位（如角色／寵物名稱、股票代號、快捷引數）不得含空白。這是本機協定限制，不證明遊戲端資格。
- `use.quantity` 可為正整數或 `滿`；`lotto.numbers` 省略時由遊戲選號，提供時須為 5 個相異的 1–39 整數。
- `auction_offer.offers` 至少一項，每項以 `item` 及選填 `quantity` 表達；序列化為 `物品x數量+物品`。品項不可自行嵌入 `+` 或末尾 `x數字`。
- `alias_set` 序列化為 `/alias 名稱=指令 引數…`；不執行所設定的快捷。`bebe_travel.destination` 不接受 BeBeMove 子命令，以免混淆旅行與管理操作。
- `dismantle_item.item` 僅接受已核唯一名稱；數字參數及數字字串（含前置零、正負號與相容字形）均拒絕，因原生數字索引會整組分解，並非單件。也不接受 `全部` 或 `>編號`；同名分組無法唯一核實時停止，不改用部分名稱或批次處置繞過。批次處置仍須另有完整範圍授權。
- 最終指令上限 4096 字元；巢狀字串與合成指令同樣檢查。

## 完整對照表

表中的 Telegram prefix 由 tool 加上具名參數序列化；不是可繞過 schema 的任意字串入口。
標示狀態變更者即使省略引數只開選單，仍採保守授權分類。

| Tool | Telegram prefix | 參數 | 分類 |
| --- | --- | --- | --- |
| `bears_help` | `/help` | 無 | 查詢 |
| `bears_look` | `/look` | 無 | 查詢 |
| `bears_who` | `/who` | 無 | 查詢 |
| `bears_boss` | `/boss` | 無 | 查詢 |
| `bears_boss_build` | `/boss_build` | 無 | 查詢 |
| `bears_boss_respawn` | `/boss_respawn` | 無 | 查詢 |
| `bears_worldboss` | `/worldboss` | 無 | 查詢 |
| `bears_quest` | `/quest` | 無 | 查詢 |
| `bears_status` | `/status` | 無 | 查詢 |
| `bears_skills` | `/skills` | 無 | 查詢 |
| `bears_bestiary` | `/bestiary` | 無 | 查詢 |
| `bears_gallery` | `/gallery` | 無 | 查詢 |
| `bears_titles` | `/titles` | 無 | 查詢 |
| `bears_gear` | `/gear` | 無 | 查詢 |
| `bears_potions` | `/potions` | 無 | 查詢 |
| `bears_idlestatus` | `/idlestatus` | 無 | 查詢 |
| `bears_pets` | `/pets` | 無 | 查詢 |
| `bears_home` | `/home` | 無 | 查詢 |
| `bears_vault` | `/vault` | 無 | 查詢 |
| `bears_chars` | `/chars` | 無 | 查詢 |
| `bears_chat` | `/chat` | 無 | 查詢 |
| `bears_top` | `/top` | 無 | 查詢 |
| `bears_story` | `/story` | 無 | 查詢 |
| `bears_journal` | `/journal` | 無 | 查詢 |
| `bears_shop` | `/shop` | 無 | 查詢 |
| `bears_furn` | `/furn` | 無 | 查詢 |
| `bears_market` | `/market` | 無 | 查詢 |
| `bears_positions` | `/positions` | 無 | 查詢 |
| `bears_craft` | `/craft` | 無 | 查詢 |
| `bears_craft_inventory` | `/craft_inventory` | 無 | 查詢 |
| `bears_shards` | `/shards` | 無 | 查詢 |
| `bears_config` | `/config` | 無 | 查詢 |
| `bears_alias` | `/alias` | 無 | 查詢 |
| `bears_bebe` | `/bebe` | 無 | 查詢 |
| `bears_tower` | `/tower` | 無 | 查詢 |
| `bears_consider` | `/consider` | `target?: 正整數／string` | 查詢 |
| `bears_game_history` | `/history` | `section?: string` | 查詢 |
| `bears_gearrank` | `/gearrank` | `view?: me` | 查詢 |
| `bears_inventory` | `/inventory` | `all?: boolean` | 查詢 |
| `bears_inspect` | `/inspect` | `item: 正整數／string` | 查詢 |
| `bears_finger` | `/finger` | `name: string` | 查詢 |
| `bears_stock` | `/stock` | `symbol: string` | 查詢 |
| `bears_forge` | `/forge` | 無 | 查詢 |
| `bears_refine` | `/refine` | 無 | 查詢 |
| `bears_dismantle` | `/dismantle` | 無 | 查詢 |
| `bears_lock` | `/lock` | 無 | 查詢 |
| `bears_auction` | `/auction` | `view?: browse／my` | 查詢 |
| `bears_buy` | `/buy` | `item?: string` | 狀態變更 |
| `bears_sell` | `/sell` | `item: 正整數／string` | 狀態變更 |
| `bears_sellall` | `/sellall` | `rarity: 稀有／史詩／全部` | 狀態變更 |
| `bears_go` | `/go` | `direction: 北／南／東／西／上／下` | 狀態變更 |
| `bears_goto` | `/goto` | `destination?: string` | 狀態變更 |
| `bears_attack` | `/attack` | `target?: 正整數／string` | 狀態變更 |
| `bears_skill` | `/skill` | `name: string` | 狀態變更 |
| `bears_start` | `/start` | 無 | 狀態變更 |
| `bears_flee` | `/flee` | 無 | 狀態變更 |
| `bears_rest` | `/rest` | 無 | 狀態變更 |
| `bears_recall` | `/recall` | 無 | 狀態變更 |
| `bears_recall2` | `/recall2` | 無 | 狀態變更 |
| `bears_recall3` | `/recall3` | 無 | 狀態變更 |
| `bears_autoequip` | `/autoequip` | 無 | 狀態變更 |
| `bears_idle` | `/idle` | 無 | 狀態變更 |
| `bears_stopidle` | `/stopidle` | 無 | 狀態變更 |
| `bears_mute` | `/mute` | 無 | 狀態變更 |
| `bears_expand` | `/expand` | 無 | 狀態變更 |
| `bears_advance` | `/advance` | 無 | 狀態變更 |
| `bears_talk` | `/talk` | 無 | 狀態變更 |
| `bears_gift` | `/gift` | 無 | 狀態變更 |
| `bears_lottovip` | `/lottovip` | 無 | 狀態變更 |
| `bears_use` | `/use` | `item: 正整數／string; quantity?: 正整數／滿` | 狀態變更 |
| `bears_equip` | `/equip` | `item?: 正整數／string` | 狀態變更 |
| `bears_switch` | `/switch` | `name?: string` | 狀態變更 |
| `bears_create` | `/create` | `name: string; profession: 戰熊／法熊／道熊` | 狀態變更 |
| `bears_rename` | `/rename` | `name: string` | 狀態變更 |
| `bears_adopt` | `/adopt` | `species: 狗／貓／小鳥／魚／海豹; name: string` | 狀態變更 |
| `bears_release` | `/release` | `name: string` | 狀態變更 |
| `bears_feed` | `/feed` | `name: string; food?: string` | 狀態變更 |
| `bears_play` | `/play` | `name: string` | 狀態變更 |
| `bears_pat` | `/pat` | `name: string` | 狀態變更 |
| `bears_store` | `/store` | `index: 正整數` | 狀態變更 |
| `bears_retrieve` | `/retrieve` | `index: 正整數` | 狀態變更 |
| `bears_deposit` | `/deposit` | `amount: 正整數` | 狀態變更 |
| `bears_withdraw` | `/withdraw` | `amount: 正整數` | 狀態變更 |
| `bears_unlock` | `/unlock` | `item: 正整數／string` | 狀態變更 |
| `bears_unalias` | `/unalias` | `name: string` | 狀態變更 |
| `bears_lotto` | `/lotto` | `amount: 正整數; numbers?: 1–39 的整數[]` | 狀態變更 |
| `bears_trade` | `/trade` | `symbol: string; side: 多／空／現貨; amount: 正整數; leverage?: 1–3 的整數` | 狀態變更 |
| `bears_close` | `/close` | `position: 正整數` | 狀態變更 |
| `bears_say` | `/say` | `message: string` | 狀態變更 |
| `bears_forge_preview` | `/forge preview` | `index?: 正整數` | 查詢 |
| `bears_forge_upgrade` | `/forge` | `index: 正整數` | 狀態變更 |
| `bears_refine_upgrade` | `/refine` | `item: 正整數／string` | 狀態變更 |
| `bears_dismantle_item` | `/dismantle` | `item: string（已核唯一名稱；禁數字索引／字串）` | 狀態變更 |
| `bears_dismantle_all` | `/dismantle 全部` | 無 | 狀態變更 |
| `bears_dismantle_after` | `/dismantle` | `index: 正整數` | 狀態變更 |
| `bears_lock_item` | `/lock` | `index: 正整數` | 狀態變更 |
| `bears_shards_redeem` | `/shards` | `index: 正整數` | 狀態變更 |
| `bears_craft_make` | `/craft` | `recipe: string（A–E 加正整數，如 A1）; confirm?: '確定'／'確定燒絕世'` | 省略 confirm 僅預覽；確認為狀態變更 |
| `bears_craft_store` | `/craft store` | `item: 正整數／string` | 狀態變更 |
| `bears_craft_take` | `/craft take` | `item: 正整數／string` | 狀態變更 |
| `bears_tower_go` | `/tower go` | `floor?: 正整數` | 狀態變更 |
| `bears_tower_quit` | `/tower quit` | 無 | 狀態變更 |
| `bears_config_ui` | `/config ui` | `mode: easy／full` | 狀態變更 |
| `bears_alias_set` | `/alias` | `name: string; command: string; args?: string[]` | 狀態變更 |
| `bears_bebe_travel` | `/bebe` | `destination: string` | 狀態變更 |
| `bears_bebe_save` | `/bebe save` | `name: string` | 狀態變更 |
| `bears_bebe_list` | `/bebe list` | 無 | 查詢 |
| `bears_bebe_go` | `/bebe go` | `name: string` | 狀態變更 |
| `bears_bebe_del` | `/bebe del` | `name: string` | 狀態變更 |
| `bears_bebe_stop` | `/bebe stop` | 無 | 狀態變更 |
| `bears_auction_sell` | `/auction sell` | `item?: 正整數／string; note?: string` | 狀態變更 |
| `bears_auction_offer` | `/auction offer` | `listing: 正整數; offers: { item: string, quantity?: 正整數 }[]` | 狀態變更 |
| `bears_cinv` | `/cinv` | 無 | 查詢 |
| `bears_wb` | `/wb` | 無 | 查詢 |
| `bears_tw` | `/tw` | 無 | 查詢 |
| `bears_l` | `/l` | 無 | 查詢 |
| `bears_ls` | `/ls` | 無 | 查詢 |

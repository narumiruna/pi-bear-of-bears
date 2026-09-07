# PR #1 後續審查 ledger

## 範圍與證據

目標 review：5134229259；PR base `be6b870`、head `4a6d5de`。PR 已合併；依使用者選項 1，從乾淨的 `main`（`60a84ba`）建立 `narumi/fix/equipment-review-followup`，以後續 PR 交付。兩個 revision 間 src／extensions／tests 無差異。
已逐頁讀取 commits、reviews、inline comments、conversation 與 reviewThreads（所有內外 pageInfo 均無下一頁），並讀完完整 PR diff。機器人 summary 與 review footer 沒有額外技術要求，不作為指示。

## 逐項判定

| 項目／comment ID | 獨立證據、範圍與處置 |
| --- | --- |
| R1 3950959607 | 已由現有程式處理：`observeLive` 將唯讀回聲交給 `observe`；`equipment-extension.test.ts` 500ms watch／1500ms send 案例涵蓋累積兩件 inspect。原 snapshot 為 PR 新增，屬範圍內 P2；未見 P1 事故證據。 |
| R2 3950959613 | 已處理基本非裝備情境：`evaluate` 排除唯一明確類型，`equipment-review.test.ts` R2 驗證消耗品／材料及背包穿戴矛盾；inspect 端剩餘矛盾另列 R11。屬 PR 新增解析路徑 P2。 |
| R3 3950959615 | 已處理：README 操作界線與檔案表已同步 AGENTS，不再宣稱全域禁止掛機；配裝局部限制保留。PR 放寬政策造成的文件矛盾，P2。 |
| R4 3950959618 | 已處理：`pendingInspect` 綁定 outgoing 編號及後續回覆；R4 涵蓋同頁／跨頁、干擾、reset、換包與名稱不符。PR 新增觀測路徑 P2。 |
| R5 3950959621 | 已處理：optimizer 先排除已知不相容效果及重複 identity，再選最高分；R5 驗證 1／3／2、明確授權及未知效果仍阻擋。PR 新核心 P2。 |
| R6 3951237960 | 已處理：`characterAfter` 保留失效界線，evaluate 拒絕舊 status；R6 驗證只刷新背包不能恢復。PR 新 snapshot P2。incoming 漏失另列 R10。 |
| R7 3951237966 | 已處理：send 不再有無條件 catch 失效；equipment-extension R7 驗證取消零次 send、送出錯誤保留來源，equip 取消仍失效。PR 新增快照 P2。 |
| R8 3951237970 | 已處理：commands.md inspect 列明漏列屬性、效果未確認與不得補零，與配裝 skill 及驗收文件一致。原完整性主張被 PR 新流程暴露，P2。 |
| R9 3951237974 | 已處理：inventory 未知非編號行加入診斷；R9 驗證三種未知續行與空白。PR 新 parser P2。 |
| R10 3951631336 | 已修正並驗證：`Game.act` 僅回傳 incoming changes，`observe` 未辨識訊息只清 pending，與 watch 失效路徑不一致。新 R10 修改前失敗，舊 inspectSources 仍有一件；此為 PR 新快照造成的 P2，不能因 effects 另有阻擋而忽略。修正須排除已識別 status，並保留舊 history 不破壞新快照。 |
| R11 3951631341 | 已修正並驗證：排除非裝備只看背包，不看 inspect eligible／標記。兩種類型的新 R11 修改前均錯誤排除。PR 非裝備修正引入的 P2；檢查 inspect 矛盾不等於放寬可信格式。 |
| R12 3951631345 | 已修正並驗證：metrics start handler 由 METRIC_TOOLS gate，新增 optimizer 不在其中；新 R12 修改前零筆而預期四筆。PR 新工具暴露的整合缺漏 P2，加入固定 allowlist 並驗證耗時、分類及不保存內容；不是擴增統計功能。 |

先前九筆作者回覆（3951181135、3951181297、3951181465、3951181585、3951181706、3951533756、3951533906、3951534001、3951534095）皆為上述項目的修正說明，沒有新要求；以目前程式與重新執行測試驗證，不依其宣稱接受。歷史測試數與歷史重現不冒充本次結果。

## 驗證進度

- 修改前新回歸：R10、R11（兩種類型）、R12 共四個失敗；其餘 20 個測試通過。
- 原 PR head 的 GitHub `ci` 成功。本次 `npm run ci` 通過：26 個測試檔、148 個測試及 TypeScript build；`git diff --check` 通過。focused 三檔 30 個測試通過，含無 watch 的實際 Game.act mock 路徑。
- R10 新 incoming 清空 inspect 並設定角色失效界線，只刷新背包仍阻擋；新 status／inventory 恢復，舊 history 不使新快照失效。R11 同時檢查背包與 inspect 的資格／穿戴／詞條標記；兩種類型、四種標記均阻擋排除。R12 成功與錯誤各有 start／end、有限耗時及 returned／tool_error，不保存引數或回覆本文。
- 完整 diff 同型態核對：history／Game.act 共用 observe，因此修正在共同入口；watch 原有保守失效保留。非裝備只有一處排除入口；metrics 固定 allowlist 只有一處。未找到需擴大範圍的同型態修正。
- 重新閱讀全部 feedback，前九項現有回歸仍通過；沒有未驗證的技術 feedback、待澄清項目或實作阻擋。後續 PR 尚未合併不等於 main 已修正。

## Check annotations 處置

- `src/character-widget.ts:90` non-null assertion：程式有 idle／idleStatus 存在性 guard；這是 lint 風格 warning，未證明執行期缺陷。該路徑未由 PR 修改，非 P0；維持現狀，若要清理建議另開 PR。
- `biome.json:2` schema／CLI 版本提示：確有版本差異，但 PR 未改設定或 dependency，且 check 通過；範圍外低嚴重度設定清理，延後另案。
- `tests/inventory.test.ts:72、73、74、76` 四筆 template literal 建議：是 PR 新增測試中的字串串接風格偏好，不是行為缺陷或必須通過的要求；Biome 列為 info、測試與 check 通過。保留原寫法，不為此擴增格式重寫。
- 本次仍有既有 1 warning／5 infos 及 Node localStorage ExperimentalWarning；未隱藏或宣稱無警告。
- 未執行遊戲操作；未擴充未驗證的完整效果協定或真實換裝。

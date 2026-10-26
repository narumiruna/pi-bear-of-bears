# 帳本路徑簡化計畫

## Goal

將預設 SQLite 路徑縮短為 `<agent-dir>/bear-of-bears/<user-id>.sqlite`。使用 `run.sh` 且未覆寫環境變數時，就是 `.pi/agent/bear-of-bears/<user-id>.sqlite`；`<user-id>` 是已驗證的 Telegram 本人 ID 十進位字串。

保留一帳號一庫及既有資料，不增加設定、路徑抽象層或自動遷移框架。本次實作不包含停止現場程序、搬動正式資料或操作遊戲。

## Context

- [run.sh](../../run.sh) 預設將 `PI_CODING_AGENT_DIR` 設為專案內的 `.pi/agent`，但保留外部覆寫值。
- [extensions/ledger.ts](../../extensions/ledger.ts) 設定根目錄，接著 [LedgerIdentity](../../src/ledger-identity.ts) 加上 `by-telegram-id`，再由 [LedgerStore](../../src/ledger-store.ts) 加上帳號目錄與 `ledger.sqlite`，造成多層包裝。
- `ledger_meta.account` 和 Pi 分支引用使用 `telegram-<user-id>`。縮短檔名不需要改動這些內部身分或 schema。
- 已確認舊位置存在 DB、WAL、SHM；不能只搬動使用中的主 DB。實作基底 `9c3f3bf` 已含原生解析修正，與本計畫無關，保持不變。
- 離線實作與驗收證據見[路徑驗證紀錄](../investigations/ledger-path-verification-2026-10-26.md)。GitHub 交付受阻：`AGENTS.md` 禁止 pull request 並要求直接推送 `main`，與本次要求衝突；開始時本機另有未推送 commit，不能擅自發布。需先解決交付規則衝突，未完成前保留本計畫及入口。

## Architecture

- 預設根目錄改為 `resolve(getAgentDir(), "bear-of-bears")`；保留既有 `BEARS_LEDGER_DIR`，設定時使用 `<BEARS_LEDGER_DIR>/<user-id>.sqlite`，仍要求真實絕對路徑。
- `LedgerIdentity` 以已驗證的本人 ID 組合檔名；`LedgerStore` 接受明確的 SQLite 檔案路徑及內部 `account`，不再替呼叫端建立帳號子目錄。
- 保留 `telegram-<user-id>` 的內部帳號、schema v1、分支引用與事件 ID。保留延後開庫、身分變更阻擋、私有權限、連結檢查及送出前落盤規則。
- 沿用現有 SQLite 備份與完整性驗證。既有庫採一次性離線切換，不掃描舊庫、不自動 fallback、不合併舊手動標籤庫；`run.sh` 不需修改。

## Plan

- [x] **補上路徑與資料保留回歸案例**：在帳本相關測試建立合成舊庫及備份，固定預設／自訂根目錄、完整精度 ID 檔名及內部帳號不變的預期。驗收以新路徑斷言及備份前後來源、未決與分支投影相等為準，不讀取正式庫內容。
- [x] **簡化開庫路徑**：修改 `extensions/ledger.ts`、`src/ledger-identity.ts`、`src/ledger-store.ts` 與必要的測試 fixture／benchmark 呼叫端，產出單層 `<user-id>.sqlite`。驗收為正常開庫、未知身分不建檔、不同帳號隔離及錯誤 owner 拒絕的測試通過；不改 Telegram 連線流程或資料 schema。
- [x] **驗證扁平目錄的保護與復原**：調整 DB／WAL／SHM 權限與連結回歸，演練含已提交 WAL 的備份還原、重新開庫及 parser 重建。驗收為 0700／0600、symlink／hardlink／過寬權限及未知 schema 拒絕等案例通過，舊原文、操作 ID、分支引用及匯出所有權資料不遺失；全程只用臨時庫。
- [x] **更新使用與切換文件**：同步 `README.md`、[帳本說明](../ledger.md) 及 [skill 包內參考](../../skills/playing-bear-of-bears/references/ledger.md)，說明 `run.sh`、自訂根目錄、新檔名及下節切換程序。歷史驗收保留原結論；驗收為現行說明無舊預設路徑，連結有效，不誤稱資料永遠位於 repository 外。
- [ ] **完成驗證與交付 review**：執行下列完成檢查，記錄離線結果與尚未執行的現場切換；確認沒有自動搬庫、額外登入、重送或其他遊戲副作用。驗收證據保存於非計畫文件；全部完成後才刪除此計畫及入口。離線檢查與逐檔 review 已通過；GitHub 交付因上述規則衝突受阻，未標完成。

## Rollback / Recovery

以下是後續正式切換程序，不在本次實作中執行。

1. 使用者準備切換時，先關閉所有使用該庫的 Pi 程序，保留舊帳號目錄及 DB／WAL／SHM。再沿用既有 `VACUUM INTO` 與 `quick_check` 邏輯離線產生完整備份，涵蓋最後已提交的資料；備份失敗即停止，不刪除舊庫。不能用關閉程序前的較早備份冒稱包含最後寫入。
2. 將已驗證備份放至新根目錄的 `<user-id>.sqlite`，目錄 0700、檔案 0600；目的檔已存在時停止，不覆寫、不合併，也不混入舊 WAL／SHM。
3. 完成還原後才以新版啟動。下一次正常授權連線確認本人 ID 後，以本機 status／trace 核對來源、未決及分支資料；不為驗收新增遊戲指令。不得把新空庫當成已接續舊帳。
4. 切換後尚無新資料時，可關閉新版並回到舊版及原位置。新庫若已有新資料，先備份並停止，不能直接退回過期舊庫或自動合併；需要另行決定資料保留方式。亦可用 `BEARS_LEDGER=0` 暫停帳本，不解除任何未決或遊戲限制。

## Completion Checklist

- [x] `npm test -- tests/ledger*.test.ts tests/workflow-package-load.test.ts`、`npm run check:ci`、`npm run build` 通過；失敗須區分本次問題與既有工作樹問題，不覆寫無關修正。帳本 9 檔／121 項及完整 104 檔／1668 項通過；未覆寫基底 parser 修正。
- [x] 使用 Node.js 22.19.0 執行帳本相關測試通過，證明沒有提高最低版本；合成舊庫切換後資料與內部身分保持一致。13 檔／146 項通過，重跑命令見驗證紀錄。
- [x] `git diff --check`、文件相對連結與打包 skill 路徑檢查通過；review 確認變更只有路徑、必要呼叫端、測試及文件，未改 schema 或操作授權。
- [ ] 交付新位置、備份／切換／回退步驟及測試證據，明示正式資料是否尚未搬移、需要使用者停止程序後再切換；未執行的現場驗證不得宣稱通過。完成後移除此計畫與 `docs/README.md` 入口。文件與證據已備妥，正式資料未搬移；待 GitHub 交付規則衝突解決後完成交付並移除計畫及入口。

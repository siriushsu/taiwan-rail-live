# Android App 版面重整合流進度

更新時間：2026-08-27（Asia/Taipei）

## 1. 環境與基準

| 項目 | 結果 |
|---|---|
| 指定工作樹 | `/Users/xuxiang/Code/捷運小動畫/.codex/worktrees/android-plus-v16` |
| 工作分支 | `codex/android-redesign-v17`（由 `codex/android-plus-v16` 的 `c060425` 建立） |
| 工作樹狀態 | 建分支前乾淨，無 staged／unstaged 變更 |
| 版面線 | `build/redesign-901`；相對 Android 線實測為 Android 8 顆／版面 65 顆 |
| merge-base | `4ae2cf1a81f3cd49723bfd9738b23ade5cee3f35` |
| 網路 | `https://railisland.tw/` 回應 HTTP 200 |
| 本機 server | `PORT=5261 node scripts/dev_server.mjs` 可啟動；缺 `.env`，所以本機 `/api/tra-live` 代理不可用 |
| Playwright | bundled Chromium 可成功 launch／close |
| npm 依賴 | 不執行 `npm install`／`npm ci`；沿用既有 `app/node_modules` |
| 本機 release 檔 | `app/release-policy.json` 已有；`key.properties` 與 `google-services.json` 尚待依派工單複製（保持 gitignored） |

## 2. 執行紀錄

- [x] 完整讀取派工單並確認只操作指定工作樹、不 push、不 rebase。
- [x] 完成網路、Git、server、Playwright 與本機 release 檔自檢。
- [ ] 合併 `build/redesign-901`，解決衝突並通過 `verify_merge_no_loss.mjs`。
- [ ] 完成 Android 平台適配與版號判定。
- [ ] 完成網頁層、出貨鏈、release APK/AAB 與真機／模擬器驗收。
- [ ] 提交經驗證的合流結果並安裝到使用者手機。


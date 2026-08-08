# D1 schema

正式庫＝Cloudflare D1 `railisland-delay-history`，Worker 綁定名 `DELAY_DB`（`wrangler.jsonc`）。

| 檔 | 地位 | 說明 |
|---|---|---|
| `0001_existing_reconstructed.sql` | ⚠️ **重建，未核對** | 既有三張表，從 `worker.js` 的查詢反推。只保證「夠測試用」，不保證等於正式庫。 |
| `0002_bounty.sql` | ✅ **權威** | 懸賞四張表。正式庫的這四張表就是用它建的。 |
| `0003_live_activity.sql` | ✅ **權威** | 跟車即時動態（Live Activity）的推播交班表 `la_bindings`。**尚未套到正式庫。** |
| `0004_la_fail_streak.sql` | ✅ **權威** | 只給「已經套過舊版 0003」的環境補 `fail_streak` 欄位。**全新的庫套 0003 就夠，不要跑這支。** |
| `0005_la_last_obs_idx.sql` | ✅ **權威** | 只給「已經套過舊版 0003」的環境補 `last_obs_idx` 欄位。**全新的庫套 0003 就夠，不要跑這支。** |

## 套用到正式庫

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0002_bounty.sql
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0003_live_activity.sql
```

（`npx wrangler` 在這台機器是壞的，一律用上面的完整寫法。）

0001–0003 全部 `IF NOT EXISTS`，重跑無害。**這一步屬於上線批次，不在實作計畫的任何 task 裡。**

🔴 **0003 忘了套的症狀**：`/api/la/bind` 回 503 `bind_failed`（客戶端靜默忽略），
且 cron 每分鐘噴一則 `[cron la-push] 失敗: ... no such table: la_bindings`。
整個跟車即時動態功能完全不動，而前端看起來一切正常。

🔴 **只有「已經用舊版 0003 建過表」的環境才要再套 0004／0005**（本機 `.wrangler`、開發庫）。
`CREATE TABLE IF NOT EXISTS` 不會替既有的表補欄位，少了 `fail_streak` 會讓 cron
每分鐘噴 `no such column: fail_streak`。

🔴 **0005 忘了套的症狀**：`SELECT *` 讀不到這一欄（`undefined`）⇒ `laNextIdx` 退回舊語意
（地板＝`last_idx`，斷線恢復後站名修不回來）；而推播成功後那發
`UPDATE … SET last_obs_idx=?` 會拋 `no such column: last_obs_idx`，落進 per-row 的
try/catch ⇒ cron **每分鐘每列噴一則** `[cron la-push] 單列處理失敗`，且 `last_idx` 永遠
不更新 ⇒ 同一張卡每分鐘重推一次。噴得很大聲，但要知道去哪裡看。

## 核對 0001 與正式庫

```bash
npx wrangler d1 execute DELAY_DB --remote --command "SELECT sql FROM sqlite_master WHERE type='table'"
```

核對過就把 `0001_existing_reconstructed.sql` 改名成 `0001_existing.sql` 並刪掉檔頭警告。

## 改結構的規矩

**不要再用 `wrangler d1 execute --command` 手打 DDL。** 既有三張表就是那樣建的，
結果是沒人知道正式庫的結構怎麼來、也無法在別的環境重建。新增或修改一律：
新開一個 `000N_描述.sql` → 本機 `node scripts/verify_bounty_schema.mjs` 綠 → 才套到正式庫。

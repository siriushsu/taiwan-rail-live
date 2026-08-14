# D1 schema

正式庫＝Cloudflare D1 `railisland-delay-history`，Worker 綁定名 `DELAY_DB`（`wrangler.jsonc`）。

| 檔 | 地位 | 說明 |
|---|---|---|
| `0001_existing_reconstructed.sql` | ⚠️ **重建，未核對** | 既有三張表，從 `worker.js` 的查詢反推。只保證「夠測試用」，不保證等於正式庫。 |
| `0002_bounty.sql` | ✅ **權威** | 懸賞四張表。正式庫的這四張表就是用它建的。 |
| `0003_live_activity.sql` | ✅ **權威** | 跟車即時動態（Live Activity）的推播交班表 `la_bindings`。**2026-08-08 已套到正式庫**（同日直查確認表已存在、且有實際交班列）。 |
| `0004_la_fail_streak.sql` | ✅ **權威** | 只給「已經套過舊版 0003」的環境補 `fail_streak` 欄位。**全新的庫套 0003 就夠，不要跑這支。** |
| `0005_la_last_obs_idx.sql` | ✅ **權威** | 只給「已經套過舊版 0003」的環境補 `last_obs_idx` 欄位。**全新的庫套 0003 就夠，不要跑這支。** |
| `0006_la_last_notice.sql` | ✅ **權威** | 只給「已經套過舊版 0003」的環境補 `last_notice` 欄位。**全新的庫套 0003 就夠，不要跑這支。** |
| `0007_la_last_stopping.sql` | ✅ **權威** | 補 `last_stopping` 欄位（停靠中）。**所有環境都要跑**——0003 上線後「就地補進建表腳本」的例外已失效，新環境＝`0003` + `0007`。 |
| `0008_la_apns_env.sql` | ✅ **權威** | 補 `apns_env` 欄位（記住這顆 token 打得通的 APNs 環境）。**所有環境都要跑**，新環境＝`0003` + `0007` + `0008`。 |
| `0009_metro_wait.sql` | ✅ **權威** | 捷運等車卡的推播交班表 `metro_wait_bindings`（**與跟車的 `la_bindings` 是兩張獨立的表**，那張的 `train_no`／`stops`／`sta_map` 都是 NOT NULL 且綁單一車次，等車卡沒有車次可填）。**所有環境都要跑，與 0003 系列彼此無關**。 |

## 套用到正式庫

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0002_bounty.sql
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0003_live_activity.sql
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0009_metro_wait.sql
```

（`npx wrangler` 在這台機器是壞的，一律用上面的完整寫法。）

0001–0003 全部 `IF NOT EXISTS`，重跑無害。**這一步屬於上線批次，不在實作計畫的任何 task 裡。**

🔴 **0003 忘了套的症狀**：`/api/la/bind` 回 503 `bind_failed`（客戶端靜默忽略），
且 cron 每分鐘噴一則 `[cron la-push] 失敗: ... no such table: la_bindings`。
整個跟車即時動態功能完全不動，而前端看起來一切正常。

🔴 **0009 忘了套的症狀**：`/api/metro-wait/bind` 回 503 `bind_failed`（前端 `metroWaitBind()`
靜默忽略，卡片照開），且 cron 每分鐘噴一則 `[cron metro-wait] 失敗: ... no such table:
metro_wait_bindings`。**症狀在使用者端幾乎看不出來**——等車卡本來就能離線活著，只是動態島
永遠停在「進站」、追蹤時間到了也不會自動收卡，跟沒接推播長得一模一樣。
（`verify_metro_wait_push.mjs` 的 `G1(schema gate)` 會先擋下來：表不在就直接 abort，
欄位集合對不上就 FAIL，不會讓整批斷言在缺表的庫上假綠。）

🔴 **只有「已經用舊版 0003 建過表」的環境才要再依序套 0004／0005／0006**（本機 `.wrangler`、
開發庫）。`CREATE TABLE IF NOT EXISTS` 不會替既有的表補欄位，少了 `fail_streak` 會讓 cron
每分鐘噴 `no such column: fail_streak`。

🔴 **0005／0006 忘了套的症狀**：兩者都會在推播成功後那發 `UPDATE … SET last_obs_idx=?,
last_notice=?` 拋 `no such column`，落進 per-row 的 try/catch ⇒ cron **每分鐘每列噴一則**
`[cron la-push] 單列處理失敗`，且 `last_idx` 永遠不更新 ⇒ 同一張卡每分鐘重推一次。
噴得很大聲，但要知道去哪裡看。
（`verify_la_push_loop.mjs` 開頭的 `SCHEMA` 閘門會先擋下來：欄位缺一條就直接 FAIL，
不會讓整批斷言在缺欄位的庫上假綠。）

## 核對 0001 與正式庫

```bash
npx wrangler d1 execute DELAY_DB --remote --command "SELECT sql FROM sqlite_master WHERE type='table'"
```

核對過就把 `0001_existing_reconstructed.sql` 改名成 `0001_existing.sql` 並刪掉檔頭警告。

## 改結構的規矩

**不要再用 `wrangler d1 execute --command` 手打 DDL。** 既有三張表就是那樣建的，
結果是沒人知道正式庫的結構怎麼來、也無法在別的環境重建。新增或修改一律：
新開一個 `000N_描述.sql` → 本機 `node scripts/verify_bounty_schema.mjs` 綠 → 才套到正式庫。

🔴 **曾有一個例外，2026-08-08 起已失效**：建表腳本還沒套到正式庫時，新欄位要就地補進那支
建表腳本，同時另開一支 `ALTER TABLE` 補丁給已經套過舊版的開發庫（`0004`／`0005`／`0006`
就是這個模式）。**`0003` 已於 2026-08-08 套上正式庫，該例外當場失效**——`0007` 起一律只能
新開檔案，不得再回頭改 `0003`。代價是新環境要依序跑 `0003` → `0007` → `0008`，這一點寫在上表。

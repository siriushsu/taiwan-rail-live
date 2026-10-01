-- 路段懸賞 v2：每段「去重人數」、籌碼帳本、車庫解鎖、雲端搭乘，以及上傳時帶的 client 資訊。
--
-- 🔴 所有環境都要跑（新環境＝0002 + 0014 + 0015）。先套 schema、再部署用到它的 Worker。忘了套的症狀：
--    ① 最嚴重：/api/account-delete 對【所有人】回 502——bountyPurgeUid 在同一個 batch 刪這四張新表，
--       缺任何一張整批失敗，刪帳號就做不成（App 審查要求能刪帳號）。
--    ② bountySubmit 一律 503 submit_failed（INSERT 找不到 bounty_samples.client 欄）；
--       chips-me／garage-redeem／cloud-ride／bounty-merge 一律 503。
--    ③ 驗證 cron 在寫 bounty_seg_contrib／chip_ledger 那幾句丟錯；這兩件排在「標記已判定」之前，
--       所以樣本留在 pending、補套之後下一發 cron 會重判，不會永久漏發。
--       缺 bounty_samples.kept_d0／kept_d1 時，每一班車在讀前次線組那一句就丟錯（同樣留 pending，補上之後下一發重判）。
--    ④ /api/bounty-board【整個】回 503：看板的 SELECT 讀 bounty_board.distinct_ok_users（與 0015 的 retired），缺欄整句失敗；
--       回應是 public, s-maxage=60，全站每個人的看板都會空掉（不是只有新功能壞）。
--    ⑤ 每日估值 cron 丟錯：上架新單位的 INSERT 讀 bounty_seg_contrib，缺這張表整支估值中止——
--       板上不會有新單位、也不會重算價格，而且只在 log 裡看得到。
--    （比照 0012 漏套那次：schema 沒到位就先出 Worker，是這個專案踩過的坑。ship-web 2.4 的正式庫 schema
--    守門人會擋下「正式庫缺 schema/*.sql 裡的表或欄」的出貨。）
--
-- 🔴 回滾提醒：Worker 若回滾到這一版「之前」的舊版，舊版不認得這四張新表——
--    刪帳號（bountyPurgeUid）只刪 bounty_samples／bounty_claims／bounty_points 三張，不清籌碼帳本、車庫解鎖、雲端搭乘、
--    每段貢獻（刪了帳號、這些個人資料仍留在庫裡，是隱私承諾的破口）；帳號合併（bountyMerge）也不搬這四張表
--    （登入前的籌碼與解鎖會留在舊 token 名下）。回滾 Worker 時要一併處理這兩件事：回滾期間暫停刪帳號與合併，
--    或回滾後對新表手動補刪／補搬。
--
-- 全部 CREATE 用 IF NOT EXISTS：cron 與新環境都會重跑同一份檔。
-- 🔴 ALTER 一律放在檔尾：SQLite 沒有 ADD COLUMN IF NOT EXISTS，重套時第一句 ALTER 會丟
--    「duplicate column name」，整檔 exec 就在那裡中斷（scripts/d1_local.mjs 的 applySchemaFiles
--    吞掉這一種錯）——放在最前面會連帶吞掉後面所有 CREATE。
--    同一個理由：這個檔一旦套進任何一個庫，之後要加欄就開新檔，不要再接在這裡——重套到第一句 ALTER 就中斷，
--    後來接上的那句在那個庫永遠跑不到。
--    例外：檔尾的 bounty_samples.kept_d0／kept_d1 是這個檔還沒套進正式庫時接上的。已經套過較早版本 0014 的庫（本機、開發庫）
--    重套這個檔補不到這兩欄，要單獨跑那兩句 ALTER（正式庫 schema 守門人 scripts/verify_remote_schema.mjs 缺哪一欄就印哪一句）。
--    正式庫套過之後，這個例外就不再成立：之後的欄一律開新檔。

-- ── 每段的去重貢獻者 ────────────────────────────────────────────────────────
-- 「這一段有幾個不同的人交過合格（ok）錄程」＝COUNT(DISTINCT actor)。收滿門檻看的是人數，不是趟數：
-- 同一個人在同一段跑十趟只算一個人（data/bounty_rules.json 的 coverDistinct：台鐵 50、高鐵 15）。
-- seg_key 與 bounty_board.seg_key 同鍵空間（sys|lnId|A|B；dwell 是 sys|lnId|站|站）。
-- 只有 verdict='ok' 的趟才寫進來：unusable／suspect 不算「貢獻」（付出與資料是兩本帳，見 0002）。
-- first_ok_at：這個人第一次在這一段交出 ok 的時間（判定當下）。/api/bounty-me 的「首位校正者」看它；帳號合併撞段時取兩邊較早的。
CREATE TABLE IF NOT EXISTS bounty_seg_contrib (
  seg_key     TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  first_ok_at INTEGER NOT NULL,
  PRIMARY KEY (seg_key, actor)
);
-- 帳號合併與刪帳號都是「以 actor 找列」（PK 的 actor 在第二欄，用不上主鍵索引）：沒有這個索引，
-- 每次合併約掃 3 次全表、刪帳號 2 次，而這張表的列數＝段數×人數，D1 以讀取列數計費。
CREATE INDEX IF NOT EXISTS idx_seg_contrib_actor ON bounty_seg_contrib (actor);
-- /api/bounty-me 的「首位校正者」：每一段找 first_ok_at 最早的時刻（同時刻的每一位都算），每段讀一列。
-- 沒有它，每段要讀遍這一段所有貢獻者再排序（worker.js 用 INDEXED BY 指名它，正式庫沒套時那一句直接報錯）。
CREATE INDEX IF NOT EXISTS idx_seg_contrib_first ON bounty_seg_contrib (seg_key, first_ok_at, actor);

-- ── 籌碼帳本：只進不改，餘額＝SUM(delta)，不另存一份餘額（避免兩份真相）──────────────
-- kind：trip 合格錄程｜cloud 雲端搭乘換的｜redeem 兌換車庫場景（delta 為負）｜merge 合併帳號時的退款或搬移｜adjust 人工調整。
-- ref：這一筆的來源鍵，UNIQUE(kind, ref) 保證同一個來源只入帳一次——驗證 cron 重跑、重送同一批都不會重複發。
--      trip 的 ref＝趟鍵 actor|trip_date|train_no；redeem 的 ref＝requestId。
-- day：台北日 YYYY-MM-DD，每日籌碼上限用 (actor, kind='trip', day) 加總；不屬於任何一天的列（redeem）可以是 NULL。
-- id 顯式 NOT NULL：rowid 表的 TEXT PRIMARY KEY 不隱含 NOT NULL（同 0002 的 bounty_claims.id）。
CREATE TABLE IF NOT EXISTS chip_ledger (
  id         TEXT    PRIMARY KEY NOT NULL,
  actor      TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('trip','cloud','redeem','merge','adjust')),
  delta      INTEGER NOT NULL,
  ref        TEXT    NOT NULL,
  day        TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref)
);
-- 兩個查詢都以 actor 起頭：每日上限（actor + day）、餘額（actor 加總）。
CREATE INDEX IF NOT EXISTS idx_chip_ledger_actor_day ON chip_ledger (actor, day);

-- ── 車庫場景解鎖：永久，不綁通行證 ─────────────────────────────────────────
-- nth：這是這個人解鎖的第幾座（價格只看第幾座，不看是哪一座）；cost：當時花了多少籌碼。
CREATE TABLE IF NOT EXISTS garage_unlocks (
  actor      TEXT    NOT NULL,
  scene      TEXT    NOT NULL,
  nth        INTEGER NOT NULL,
  cost       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor, scene)
);

-- ── 雲端搭乘：一個人一天最多一筆 ───────────────────────────────────────────
-- 前景跟同一班真實列車連續 10 分鐘算 1 次；PK (actor, day) 讓「每日 1 次」是結構保證。
-- request_id：重送去重用（可空，舊客端沒有）。
-- simulator：這一筆是不是模擬器送來的（client.simulator 為真才是 1）。模擬器的搭乘照寫進來（測試流程要能跑完、
--   也占掉當天那一格），但不算進「換籌碼的次數」——查次數的地方一律要帶 simulator=0。
CREATE TABLE IF NOT EXISTS cloud_rides (
  actor      TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  train_key  TEXT    NOT NULL,
  sec        INTEGER NOT NULL,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  simulator  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor, day)
);

-- ── 既有表加欄（🔴 一律放最後，理由見檔頭）─────────────────────────────────────
-- distinct_ok_users：該段（seg_key）的去重貢獻人數，與 bounty_seg_contrib 同步遞增；收滿門檻看這一欄。
-- 同一個 seg_key 底下的每一列（不同車種／方向／時段）值相同：人數是「段」的屬性。
ALTER TABLE bounty_board ADD COLUMN distinct_ok_users INTEGER NOT NULL DEFAULT 0;
-- client：上傳當下的 {platform, app, simulator} JSON 字串（只存這三個欄位）。舊列與直接寫入的測試列為 NULL。
ALTER TABLE bounty_samples ADD COLUMN client TEXT;
-- kept_d0／kept_d1：判定當下，這一列所屬線組「防偽閘收下的點」的最小與最大沿線里程（公尺），同一組每一列值相同。
-- 只有 ok 的組寫；unusable／suspect（含 oversize）、pending、判定這兩欄出現之前就判過的舊列都是 NULL。
-- 遲傳合併判籌碼時，前次組的移動距離讀這兩欄、不從原始 payload 重算：同一份資料不論分幾次上傳、分在哪幾發判，結果要相同。
ALTER TABLE bounty_samples ADD COLUMN kept_d0 REAL;
ALTER TABLE bounty_samples ADD COLUMN kept_d1 REAL;
-- （bounty_board.retired 在 0015：理由見檔頭。kept_d0／kept_d1 接在這裡的例外與已套過舊版 0014 的庫怎麼補，也見檔頭。）

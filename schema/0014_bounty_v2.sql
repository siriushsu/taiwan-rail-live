-- 路段懸賞 v2：每段「去重人數」、籌碼帳本、車庫解鎖、雲端搭乘，以及上傳時帶的 client 資訊。
--
-- 🔴 所有環境都要跑（新環境＝0002 + 0014）。先套 schema、再部署用到它的 Worker。忘了套的症狀：
--    新 Worker 的 bountySubmit 一律 503 submit_failed（INSERT 找不到 bounty_samples.client 欄）；
--    驗證 cron 更糟——它先把樣本標成已判定、之後才寫 bounty_seg_contrib／chip_ledger，缺表時那幾句失敗，
--    那幾趟就永遠是「已判定、沒有去重人數、沒有籌碼」，而且沒有任何重試機會。
--    （比照 0012 漏套那次：schema 沒到位就先出 Worker，是這個專案踩過的坑。）
--
-- 全部 CREATE 用 IF NOT EXISTS：cron 與新環境都會重跑同一份檔。
-- 🔴 兩句 ALTER 一定放在檔尾：SQLite 沒有 ADD COLUMN IF NOT EXISTS，重套時第一句 ALTER 會丟
--    「duplicate column name」，整檔 exec 就在那裡中斷（scripts/d1_local.mjs 的 applySchemaFiles
--    吞掉這一種錯）——放在最前面會連帶吞掉後面所有 CREATE。

-- ── 每段的去重貢獻者 ────────────────────────────────────────────────────────
-- 「這一段有幾個不同的人交過合格（ok）錄程」＝COUNT(DISTINCT actor)。收滿門檻看的是人數，不是趟數：
-- 同一個人在同一段跑十趟只算一個人（data/bounty_rules.json 的 coverDistinct：台鐵 50、高鐵 15）。
-- seg_key 與 bounty_board.seg_key 同鍵空間（sys|lnId|A|B；dwell 是 sys|lnId|站|站）。
-- 只有 verdict='ok' 的趟才寫進來：unusable／suspect 不算「貢獻」（付出與資料是兩本帳，見 0002）。
-- first_ok_at：這個人第一次在這一段交出 ok 的時間（判定當下），只供稽核。
CREATE TABLE IF NOT EXISTS bounty_seg_contrib (
  seg_key     TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  first_ok_at INTEGER NOT NULL,
  PRIMARY KEY (seg_key, actor)
);

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
CREATE TABLE IF NOT EXISTS cloud_rides (
  actor      TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  train_key  TEXT    NOT NULL,
  sec        INTEGER NOT NULL,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor, day)
);

-- ── 既有表加欄（🔴 一律放最後，理由見檔頭）─────────────────────────────────────
-- distinct_ok_users：該段（seg_key）的去重貢獻人數，與 bounty_seg_contrib 同步遞增；收滿門檻看這一欄。
-- 同一個 seg_key 底下的每一列（不同車種／方向／時段）值相同：人數是「段」的屬性。
ALTER TABLE bounty_board ADD COLUMN distinct_ok_users INTEGER NOT NULL DEFAULT 0;
-- client：上傳當下的 {platform, app, simulator} JSON 字串（只存這三個欄位）。舊列與直接寫入的測試列為 NULL。
ALTER TABLE bounty_samples ADD COLUMN client TEXT;

-- AI 一句話排行程（scripts/trip_ask.mjs，/api/trip-ask）：試用次數、每日用量、每月花費、問過的話。
-- 帳號一律存 uid 的 SHA-256（前綴 'trip-ask:'），不存 uid 本身。刪帳號時三張帶 uid_hash 的表一起刪（tripAskPurge）。
-- 部署新版 Worker 前先套用；沒套時三支端點回 503，刪帳號照常（表不存在當作沒有資料）。

-- 沒有通行證的人：試用 5 次、綁帳號終身（使用者 10-24 定）。used 只算「查得了」的那幾發。
CREATE TABLE IF NOT EXISTS trip_ai_trial (
  uid_hash TEXT PRIMARY KEY,
  used     INTEGER NOT NULL,
  first_ms INTEGER NOT NULL
);

-- 每人每天（台灣日期）問了幾次、花了多少（百萬分之一美元）。有通行證的人每天上限看這張。
CREATE TABLE IF NOT EXISTS trip_ai_usage (
  uid_hash    TEXT NOT NULL,
  day         TEXT NOT NULL,
  asks        INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid_hash, day)
);

-- 每月（台灣時間 YYYY-MM）這個功能花了多少；到 MONTHLY_CAP_USD 就暫停到下個月。
CREATE TABLE IF NOT EXISTS trip_ai_budget (
  month       TEXT PRIMARY KEY,
  cost_micros INTEGER NOT NULL DEFAULT 0
);

-- 每一句話與解析結果，只留 7 天（排程每小時刪）。說明（explain）要靠這列確認是本人、1 小時內、次數沒超過。
CREATE TABLE IF NOT EXISTS trip_ai_asks (
  id            TEXT PRIMARY KEY,
  uid_hash      TEXT NOT NULL,
  at_ms         INTEGER NOT NULL,
  text          TEXT,
  parsed        TEXT,
  model         TEXT,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  explain_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trip_ai_asks_at ON trip_ai_asks (at_ms);
CREATE INDEX IF NOT EXISTS trip_ai_asks_uid ON trip_ai_asks (uid_hash);

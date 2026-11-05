-- 誤點一日重播（/api/delay-replay）：台鐵一天每班車的影格、當天重點。一天一列，gz 是 scripts/delay_replay.mjs 回傳的 JSON
-- gzip 後的內容（一天約 60 KB，解開約 270 KB）。每日誤點 cron（ingestDelayHistory）順便寫，缺的日子自己補；
-- 2026-11-02 以前由 scripts/delay_replay_backfill.mjs 從 TDX 歷史檔回補。
CREATE TABLE IF NOT EXISTS tra_delay_replay (
  service_date TEXT PRIMARY KEY,   -- 例 2026-11-02（台北日）
  gz           BLOB NOT NULL
);

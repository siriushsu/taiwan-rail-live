-- 誤點氣候圖（/api/delay-climate）：台鐵每一段每天「多出幾分鐘」。一天一列，由每日誤點 cron（ingestDelayHistory）
-- 抓完當天歷史誤點後順便寫，不另打 TDX。segs 是 JSON：{"七堵|八堵":[班次, 增量總和(分)], ...}，
-- 段鍵＝兩端站名排序後用 | 接（去括號、台→臺），兩個方向合在一起；分攤到的班次按里程比例算，所以有小數。
-- 一列約 6 KB，一年約 2 MB。2026-11-02 以前的歷史由 scripts/delay_climate_backfill.mjs 從 TDX 歷史檔回補。
CREATE TABLE IF NOT EXISTS tra_delay_climate (
  service_date TEXT PRIMARY KEY,   -- 例 2026-11-02（台北日）
  segs         TEXT NOT NULL
);

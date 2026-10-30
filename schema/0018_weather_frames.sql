-- 跟車即時天氣 P0（scripts/weather_frames.mjs）：每筆＝一個雷達時刻（每 10 分鐘一筆），
-- body 是 gzip 過的 JSON（本島雷達格點＋綜觀測站＋雨量站），約 40 KB。保留 90 天，由 cron 每天 03:02 清。
-- obs_at／rain_at 跟 radar_at 相同才算收齊；測站比雷達晚發，同一筆通常第二輪才補齊。
CREATE TABLE IF NOT EXISTS weather_frames (
  radar_at   TEXT PRIMARY KEY,   -- 例 2026-10-30T22:20:00+08:00
  obs_at     TEXT,
  rain_at    TEXT,
  sources    TEXT NOT NULL,      -- {"radar":"cwa-api"|"cwa-s3",...}
  updated_ms INTEGER NOT NULL,
  body       BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS weather_frames_updated ON weather_frames(updated_ms);

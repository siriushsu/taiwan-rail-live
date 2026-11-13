-- 台鐵營運通阻公告歷史（worker.js archiveTraAlert）：給誤點原因分析用。TDX Rail/TRA/Alert 只給現在的公告，沒存到就補不回來。
-- WEATHER_CRON 那一發每 5 分鐘抓一次：內容（Alerts 陣列）跟上一列一樣、距上次看到又不到 15 分鐘，只更新 last_ms；
-- 否則新增一列。所以一列＝一段「連續觀測到同一份公告」的時間；「全線營運正常」也照存。不清理（內容變了才新增，量很小）。
CREATE TABLE IF NOT EXISTS tra_alert_log (
  first_ms INTEGER PRIMARY KEY,   -- 第一次看到這份內容（cron 的 scheduledTime，epoch ms）
  last_ms  INTEGER NOT NULL,      -- 最後一次看到同一份內容
  hash     TEXT NOT NULL,         -- Alerts 陣列 JSON 的 SHA-256（不含頂層 UpdateTime，它每次都變）
  body     TEXT NOT NULL          -- TDX 回傳原文
);

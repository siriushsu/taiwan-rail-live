-- ⚠️ 這一份不是權威 DDL。
--
-- 既有三張表（tra_delay_daily / tra_station_events / kv_blobs）是 2026-07 期間用
-- `wrangler d1 execute --command` 之類的方式臨時建的，repo 裡從來沒有它們的 schema。
-- 這份檔是**從 worker.js 的查詢語句反推重建**的，用途只有一個：讓離線測試能建出一顆
-- 結構夠像的庫（驗證閘的第二重要查 tra_station_events，測試環境沒有它就等於沒驗到那一重）。
--
-- 與正式庫核對的方法（等 wrangler 能跑之後做，本計畫不做）：
--   npx wrangler d1 execute DELAY_DB --remote --command "SELECT sql FROM sqlite_master WHERE type='table'"
-- 核對過就把本檔改名為 0001_existing.sql 並刪掉這段警告。
-- 反推來源：worker.js 的 STATION_EVENT_UPSERT、stationEvents()、todayBoard()、delayHistory()、delayStats()。

-- 逐站觀測事件。PK 以 service_date 起頭且 WITHOUT ROWID＝按日期叢集，查某一天是連續範圍掃描
-- （worker.js 保留期清理的註解明載這個特性，故此處照著重建）。
CREATE TABLE IF NOT EXISTS tra_station_events (
  service_date TEXT    NOT NULL,
  train_no     TEXT    NOT NULL,
  sta          TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  delay        INTEGER,
  delay_max    INTEGER,
  obs_at       TEXT,
  PRIMARY KEY (service_date, train_no, sta, status)
) WITHOUT ROWID;

-- 每日誤點統計來源列
CREATE TABLE IF NOT EXISTS tra_delay_daily (
  service_date TEXT    NOT NULL,
  train_no     TEXT    NOT NULL,
  final_delay  INTEGER,
  max_delay    INTEGER,
  PRIMARY KEY (service_date, train_no)
) WITHOUT ROWID;

-- 預先算好的統計 blob（/api/delay-stats 唯讀單列查詢）
CREATE TABLE IF NOT EXISTS kv_blobs (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID;

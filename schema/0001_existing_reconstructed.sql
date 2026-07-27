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
-- 反推來源：worker.js 的 STATION_EVENT_UPSERT、stationEvents()、todayBoard()、delayHistory()、
-- delayStats()、writeDayRows()、ingestDelayHistory()（後兩者是複審 Important 1 補的：初版反推
-- 漏了 tra_delay_daily 的 events/last_station/last_seen 與 kv_blobs 的 updated，4 欄）。

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

-- 每日誤點統計來源列。events/last_station/last_seen 三欄是複審 Important 1 補的：worker.js:911-912
-- （writeDayRows）的 UPDATE/INSERT 與 worker.js:944（ingestDelayHistory）的 SELECT 都會讀寫它們，
-- 初版反推漏掉——值的來源見 worker.js:809 buildDayRows：events 是這個服務日該車次的事件筆數（累計整數），
-- last_station/last_seen 是最後一筆事件的站碼與 TDX SrcUpdateTime 原始字串，型別皆跟著查詢用法定 TEXT。
CREATE TABLE IF NOT EXISTS tra_delay_daily (
  service_date TEXT    NOT NULL,
  train_no     TEXT    NOT NULL,
  final_delay  INTEGER,
  max_delay    INTEGER,
  events       INTEGER,
  last_station TEXT,
  last_seen    TEXT,
  PRIMARY KEY (service_date, train_no)
) WITHOUT ROWID;

-- 預先算好的統計 blob（/api/delay-stats 唯讀單列查詢）。updated 欄是複審 Important 1 補的：
-- worker.js:968（ingestDelayHistory）寫入時帶 datetime('now')，初版反推漏掉這欄，
-- 該行真實語句在漏欄的舊 schema 下會直接炸「no column named updated」。
CREATE TABLE IF NOT EXISTS kv_blobs (
  k       TEXT PRIMARY KEY,
  v       TEXT NOT NULL,
  updated TEXT
) WITHOUT ROWID;

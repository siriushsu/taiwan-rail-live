-- 短效「整段旅程」分享。一列只保存分享中的最新狀態與最新一筆手機座標，絕不保存軌跡歷史。
--
-- public_id 是收件人連結裡的 128-bit 隨機識別碼；edit_hash 是另一把 256-bit 編輯憑證的
-- SHA-256，不把可更新／刪除分享的明文憑證放進 D1。兩者分離，拿到公開連結的人只能讀。
-- expires_at 最長為 created_at + 12 小時；GET 先以它判定失效，cron／懶清理再刪除實體列。
CREATE TABLE IF NOT EXISTS journey_shares (
  public_id        TEXT PRIMARY KEY,
  edit_hash        TEXT NOT NULL,
  payload          TEXT NOT NULL,
  location_enabled INTEGER NOT NULL DEFAULT 0 CHECK (location_enabled IN (0, 1)),
  position_lat     REAL,
  position_lon     REAL,
  position_accuracy REAL,
  position_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_journey_shares_expire ON journey_shares(expires_at);

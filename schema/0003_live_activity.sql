-- 跟車即時動態(Live Activity)的推播交班表。
-- 一列 = 一張正在鎖屏上跑的卡。token 是 APNs device token,天然唯一。
-- stops/sta_map/stop_codes 存前端交來的【表定】資料(JSON 字串),永不過期;
-- last_idx/last_delay 是後端每分鐘更新的狀態,用來判斷「有沒有變、要不要推」。
CREATE TABLE IF NOT EXISTS la_bindings (
  token       TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  sys         TEXT NOT NULL,
  train_no    TEXT NOT NULL,
  stops       TEXT NOT NULL,
  sta_map     TEXT NOT NULL,
  stop_codes  TEXT NOT NULL,
  last_idx    INTEGER NOT NULL DEFAULT -1,
  last_delay  INTEGER NOT NULL DEFAULT 0,
  bound_at    INTEGER NOT NULL,
  expire_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_la_expire ON la_bindings(expire_at);

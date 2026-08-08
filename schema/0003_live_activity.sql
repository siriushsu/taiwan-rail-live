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
  -- last_obs_idx:最後一次【真的被觀測到】的索引(表定推算不寫這一欄)。單調閘門的地板綁它,
  -- 不綁 last_idx——上游整批失效期間卡片仍靠表定往前推(使用者裁示:不能凍住),推過頭之後
  -- 若地板還是 last_idx,觀測恢復時就【永遠】拉不回來,錯的站名會黏住。地板改成這一欄之後,
  -- 觀測可以回收表定推過頭的部分,但最低只回到上一次真的觀測到的那一站 ⇒ 觀測序列仍然單調不減。
  last_obs_idx INTEGER NOT NULL DEFAULT -1,
  last_delay  INTEGER NOT NULL DEFAULT 0,
  -- fail_streak:這一列連續幾輪推播失敗(成功即歸零)。批次熔斷用它區分「我方設定錯誤」
  -- (整批都是第 1 次失敗)與「這個 token 自然死亡」(同一列連續失敗很多輪)——單 tick 的
  -- 失敗比例做不到這件事,因為死 token 每個 tick 都會重試、健康的列只在換站時才會嘗試,
  -- 於是「本輪嘗試的全都是死 token」是常態,舊的全敗規則在那種 tick 恆成立、永遠不刪列。
  fail_streak INTEGER NOT NULL DEFAULT 0,
  bound_at    INTEGER NOT NULL,
  expire_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_la_expire ON la_bindings(expire_at);
-- 注意:fail_streak 是最終複審 A-I1 才加的。這張表在本機 .wrangler 或任何開發庫若已經用
-- 舊版建過,CREATE TABLE IF NOT EXISTS 不會替它補欄位 ⇒ 那些環境要另外套 0004。

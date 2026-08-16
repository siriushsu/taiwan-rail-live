-- 捷運等車卡(Live Activity)的推播交班表。
-- 一列 = 一張正在鎖屏上跑的等車卡。token 是 ActivityKit 的 push token,天然唯一。
--
-- 🔴 為什麼不共用 la_bindings 加一個 kind 欄:那張表的 train_no/stops/sta_map/stop_codes
--    四欄都是 NOT NULL 且語意是「一趟台鐵/高鐵行程」,等車卡沒有任何一個對得上;共用等於
--    塞四個假值進去,還要在已經上線且驗收極重的 laPushAll 每一條查詢與判定式上加 kind 分支。
--    兩條迴圈的判定邏輯本來就完全不同(那邊是「走到第幾站」,這邊是「下一班是誰」),
--    分表之後彼此的改動不會互相波及。
--
-- 🔴 沒有 uid 欄:等車卡是免費功能(通行證不 gate 它),bind 不驗身分,所以也沒有
--    「同一個帳號最多幾列」可修剪。防濫用靠三層:(a) 端點限流(LA_LIMITER,20/分鐘/IP)
--    (b) token 必須是合法 hex 格式 (c) end_at 上限 3 小時 ⇒ 灌進來的列最多活 3 小時。
CREATE TABLE IF NOT EXISTS metro_wait_bindings (
  token       TEXT PRIMARY KEY,
  sys         TEXT NOT NULL,            -- trtc / krtc / tymc
  station     TEXT NOT NULL,            -- 開卡當下的站名原字串(比對時才正規化,存原樣以便診斷)
  -- dest:使用者在方向選單挑的那個方向;NULL = 「最快一班(全部方向)」。
  -- 這一欄是【前端過濾條件的持久化】——零推播階段這個過濾只發生在 JS 開卡那一瞬間,
  -- 推播接手後每分鐘都要重做一次,所以它必須存下來。
  dest        TEXT,
  -- end_at:追蹤時段終點(epoch 秒)。與 App 端 attributes.endAt 是同一個值(由原生算完回傳給
  -- JS 再送上來),不是各算各的——兩邊各算會讓卡片印的「追蹤至 HH:mm」與伺服器收卡時刻對不上。
  end_at      INTEGER NOT NULL,
  -- last_state:上一次【真的送出去】的 content-state(JSON 字串)。判斷要不要推就是拿它跟
  -- 這一輪算出來的比(mwShouldPush)。存整包而不是存一個雜湊:雜湊只答「一不一樣」,
  -- 而 eta 這種每輪都會抖動幾秒的量需要的是「差多少」(遲滯比較),雜湊做不到。
  -- NULL = 還沒推過任何一發。
  last_state  TEXT,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  -- apns_env:同 la_bindings.apns_env,記住這顆 token 打得通的 APNs 環境('prod'/'sandbox')。
  -- 兩張表各存各的:同一台裝置的兩張卡是兩顆不同的 token,共用一個環境快取沒有意義,
  -- 而跨表 join 只為省一次請求不值得。
  apns_env    TEXT,
  bound_at    INTEGER NOT NULL,
  expire_at   INTEGER NOT NULL          -- = end_at + 寬限(收卡推播失敗時的兜底清理)
);
CREATE INDEX IF NOT EXISTS ix_mw_expire ON metro_wait_bindings(expire_at);

-- 台鐵等站卡(Live Activity)的推播交班表。
-- 一列 = 一張正在鎖屏上跑的等站卡:某位使用者在某一站等【一班指定的車】。
--
-- 🔴 為什麼不共用 metro_wait_bindings 加一個 sys='tra':那張表存的是「哪一站、哪個方向」,
--    每分鐘都要重新問官方「這一站的下一班是誰」;這張表存的是「哪一班車」,表訂時刻在開卡
--    當下就固定了,每分鐘只要把官方誤點分鐘 join 回來。兩條迴圈的判定邏輯完全不同,
--    共用會讓 mwPushAll 的每一條查詢與判定式都長出 sys 分支(理由同 0009 不共用 la_bindings)。
--
-- 🔴 沒有 sys 欄:這一批【只做台鐵】(使用者裁示 2026-08-22)。高鐵官方連誤點欄位都沒有
--    (memory: tra-thsr-no-official-eta),林鐵沒有即時介接 ⇒ 沒有第二個系統可以填進來。
--    日後真要加,加的是欄位不是假值——現在先不預留,預留的欄位會變成「有一欄永遠是 'tra'」
--    的死程式碼,而且讓讀者以為別的值也走得通。
--
-- 🔴 沒有 uid 欄:等站卡是免費功能,bind 不驗身分(同 0009)。防濫用靠三層:
--    (a) 端點限流(LA_LIMITER,20/分鐘/IP) (b) token 必須是合法 hex 格式
--    (c) end_at 上限(TW_MAX_TRACK_SEC = 3.5 小時)⇒ 灌進來的列最多活 3.5 小時。
CREATE TABLE IF NOT EXISTS tra_wait_bindings (
  token       TEXT PRIMARY KEY,
  -- station:開卡當下的站名原字串。【純顯示用】——卡片上那一行站名由 App 端 attributes 帶著,
  -- 伺服器不拿它做任何比對(比對的鍵是 train_no)。存下來是為了診斷:一列推不出去時,
  -- 光看 token 與車次看不出使用者在等哪一站。
  station     TEXT NOT NULL,
  -- train_no:台鐵車次號。這是本表唯一的 join 鍵——每分鐘拿它去 /api/tra-live 的 trains[]
  -- 找同一班車的官方誤點分鐘。
  -- 🔴 跨系統撞號(memory: cross-system-train-number-collision):/api/tra-live 的來源
  --    TrainLiveBoards 只含台鐵 ⇒ 不會跟高鐵同號車撞。跨日撞號在 ≤3.5 小時的追蹤窗內
  --    不會發生(同一車次號要隔天才再開一班)。
  train_no    TEXT NOT NULL,
  -- sched_sec:表訂到站時刻(epoch 秒,絕對時刻不是 secOfDay)。
  -- 🔴 這一欄是【固定值】,這正是本表與 metro_wait_bindings 最大的差別:等車卡每分鐘都要
  --    重新挑班次,等站卡挑的那一班在開卡當下就定了,伺服器只負責把誤點 join 回來。
  --    卡片主角「實際約到站」= sched_sec + 誤點分鐘 × 60,兩個輸入都是官方值 ⇒ 可以顯示。
  sched_sec   INTEGER NOT NULL,
  -- end_at:追蹤時段終點(epoch 秒)。
  -- 🔴 與 metro_wait 的 end_at 有一個關鍵差異:這一欄【會被伺服器往後延】(誤點把實際到站
  --    推遠時,見 twNextEndAt)。之所以合法,是因為這張卡【不印】「追蹤至 HH:mm」——
  --    0009 那條「兩邊必須是同一個數」守的是卡片印出來的承諾,這裡沒有那個承諾。
  --    只准延不准縮:縮會在使用者還在等車時提前收卡。
  end_at      INTEGER NOT NULL,
  -- last_state:上一次【真的送出去】的 content-state(JSON 字串)。判斷要不要推就是拿它跟
  -- 這一輪算出來的比(twShouldPush)。存整包而不是雜湊:雜湊只答「一不一樣」,而 dataAt
  -- 需要的是「差多少」(遲滯比較)。NULL = 還沒推過任何一發。
  last_state  TEXT,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  -- apns_env:同 0008/0009,記住這顆 token 打得通的 APNs 環境('prod'/'sandbox')。
  apns_env    TEXT,
  bound_at    INTEGER NOT NULL,           -- 追蹤硬上限(bound_at + 3.5h)的起算點
  expire_at   INTEGER NOT NULL            -- = end_at + 寬限(收卡推播失敗時的兜底清理)
);
CREATE INDEX IF NOT EXISTS ix_tw_expire ON tra_wait_bindings(expire_at);

-- 軌島 · GPS 路段收集懸賞：D1 四張表（規格 打卡收集系統設計_GPS懸賞_2026-07-27.html §6）
-- 加在既有的 DELAY_DB（railisland-delay-history），不開新庫。
--
-- 這是本 repo 第一份權威 schema 檔：正式庫的這四張表就是用它建的，改結構一律改這裡再套用，
-- 不要再用 `wrangler d1 execute --command` 手打（既有三張表就是那樣建的，結果沒人知道它們怎麼來的）。
-- 全部 IF NOT EXISTS：cron 與新環境都會重跑同一份檔，不冪等就不能自動化。

-- ── 懸賞板：cron 每日重算 ───────────────────────────────────────────────────
-- 計價單位＝(段, 車種, 方向) 或 (站, 車種, 時段類型)。停站點的 seg_key 寫成 sys|lnId|站名|站名
-- （A 與 B 相同）：真實軌道區間的兩端必為相異站，所以 A==B 唯一代表「這是一座站」，
-- 不必另發明標記字元，也能用同一個 split('|') 解析。
CREATE TABLE IF NOT EXISTS bounty_board (
  seg_key            TEXT    NOT NULL,   -- 正規區間鍵 sys|lnId|A|B（字典序，與收集系統同鍵空間）
  sys                TEXT    NOT NULL,   -- 冗餘存一份：coverN 分系統門檻查詢不必 parse seg_key
  train_kind         TEXT    NOT NULL,
  dir                INTEGER NOT NULL,   -- 0/1；dwell 列固定 0（停站時間不分方向）
  kind               TEXT    NOT NULL,   -- 'track' 軌道點 | 'dwell' 停站點
  slot               TEXT    NOT NULL,   -- dwell 的時段類型 'peak'|'off'|'holiday'；track 為 ''
  l1                 REAL    NOT NULL DEFAULT 1,   -- 班次密度乘數 1–3
  l2                 REAL    NOT NULL DEFAULT 1,   -- 時間乘數 1–5
  points             INTEGER NOT NULL DEFAULT 1,   -- round(1 × l1 × l2)
  per_day            REAL    NOT NULL DEFAULT 0,   -- 該單位的日班次數＝L1 的分母，來自 data/bounty_units.json
  first_listed_at    INTEGER NOT NULL,             -- 上架時間；只供稽核，不參與計價
  -- 🔴 L2 從 first_claimable_at 起算，不是 first_listed_at。理由（規格 §4 鐵則）：L2 量的是「真實招募難度」，
  -- 而「沒人能接」與「沒人想接」是兩件事。懸賞板若比 App 送審過還早上線，L2 會在無人能接的期間虛漲，
  -- 到頂之後自己觸發 unlocked_offer＝用假訊號打開真金流。NULL 代表還沒有人能接 → L2 恆為 1。
  first_claimable_at INTEGER,
  l2_capped_at       INTEGER,                      -- l2 首次到達上限 5 的時間；NULL＝還沒到頂
  -- 🔴 只數 verdict='ok' 的樣本。unusable（防偽過、品質不過）照給章照給點數，但不計入下架門檻——
  -- 使用者的付出與資料的品質是兩本帳（規格 §7）。
  sample_count       INTEGER NOT NULL DEFAULT 0,
  covered_at         INTEGER,                      -- 收滿時間；track＝下架，dwell＝仍在架上但點數衰減
  unlocked_offer     INTEGER NOT NULL DEFAULT 0,   -- 自動開關：l2>=5 且 sample_count=0 且 now−l2_capped_at>=30 天
  PRIMARY KEY (seg_key, train_kind, dir, kind, slot)
) WITHOUT ROWID;
-- 懸賞板查詢一律是「還沒收滿的、依種類分組」，所以索引押 kind + covered_at
CREATE INDEX IF NOT EXISTS idx_board_open ON bounty_board (kind, covered_at, sys, seg_key);

-- ── 認領：鎖的是價格，不是獨佔權 ─────────────────────────────────────────────
-- 規格 §3 刻意偏離上游 §11 的字面：第二個人照樣接得到、照樣計點。捷運段的採用門檻本來就需要
-- 多趟一致（N≥3），做成獨佔會直接擋掉自己需要的樣本。使用者只看到「已有 N 人接了這段」＝資訊不是禁令。
CREATE TABLE IF NOT EXISTS bounty_claims (
  id            TEXT    PRIMARY KEY,   -- claimId|序號：同一次認領的多個單位共用前綴，才查得回「這次接了什麼」
  actor         TEXT    NOT NULL,
  seg_key       TEXT    NOT NULL,
  train_kind    TEXT    NOT NULL,
  dir           INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  slot          TEXT    NOT NULL,
  points_locked INTEGER NOT NULL,      -- 接下當時的點數：之後估值再漲再跌都不影響這一筆
  claimed_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,      -- claimed_at + 24h
  status        TEXT    NOT NULL DEFAULT 'open'   -- 'open'|'fulfilled'|'expired'
);
CREATE INDEX IF NOT EXISTS idx_claims_unit  ON bounty_claims (seg_key, train_kind, dir, kind, slot, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_claims_actor ON bounty_claims (actor, status);

-- ── 樣本：沿途每 60 秒一批，一批一列 ────────────────────────────────────────
-- 分批存不合併的理由：每批獨立可驗，斷線／沒電時已經傳出去的不會丟——這是「部分覆蓋也計點」的前提。
-- 驗證時再依 (actor, trip_date, train_no) 併回同一趟。
CREATE TABLE IF NOT EXISTS bounty_samples (
  id           TEXT    PRIMARY KEY,
  actor        TEXT    NOT NULL,
  sys          TEXT    NOT NULL,
  ln_id        TEXT    NOT NULL,
  train_no     TEXT    NOT NULL,
  dir          INTEGER NOT NULL,
  trip_date    TEXT    NOT NULL,       -- 台北日 YYYY-MM-DD
  payload      TEXT    NOT NULL,       -- 里程序列 JSON：[{d,t,v,acc},…] 全程無經緯度
  segs         TEXT,                   -- 判定當下算出的覆蓋結果 JSON：[{key,kind,slot,cov}]；pending 時為 NULL
  submitted_at INTEGER NOT NULL,
  verdict      TEXT    NOT NULL DEFAULT 'pending',  -- 'pending'|'ok'|'unusable'|'suspect'
  verdict_at   INTEGER,
  -- 🔴 quality_code 與 reject_code 是兩個欄位、兩套文案、兩種可見性，永遠不可以合成一個。
  -- 合成之後只要有人手滑把它顯示出去，防偽的細節就外洩了（等於教人怎麼繞過）。
  quality_code TEXT,                   -- unusable 的原因碼 → 會回傳給使用者
  reject_code  TEXT                    -- suspect 的原因碼 → 永不回傳使用者，只給內部稽核
);
CREATE INDEX IF NOT EXISTS idx_samples_pending ON bounty_samples (verdict, trip_date);
CREATE INDEX IF NOT EXISTS idx_samples_trip    ON bounty_samples (actor, trip_date, train_no);

-- ── 點數帳：匿名先玩，登入才跨裝置 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bounty_points (
  actor       TEXT PRIMARY KEY,   -- 匿名 device token 或 Firebase uid
  uid         TEXT,               -- 登入後綁定
  points      INTEGER NOT NULL DEFAULT 0,
  merged_into TEXT,               -- 合併後指向 uid，防重複合併；後續該 token 的寫入一律轉向
  updated_at  INTEGER NOT NULL
) WITHOUT ROWID;

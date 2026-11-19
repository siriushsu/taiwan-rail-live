-- 搭乘集章（2026-11-19）：判定合格的每一趟記一列，chips-me 照規則檔 chips.stamps 換算成章（data/bounty_rules.json）。
--
-- 一趟＝(actor, trip_date, train_no, sys)，跟帳本錄程列的趟鍵同一班車（帳本 ref＝actor|乘車日|車次，沒有系統；這裡多存 sys，
-- 高鐵與台鐵四碼車次撞號時才分得開）。
-- car：判定當下從班表查到的車種名（台鐵 data/tra_schedule.json 的 carName，例如「自強(3000障)」；查不到、或不是台鐵就是空字串）。
--      章的對照放在讀的那一端（scripts/bounty_chips_core.mjs 的 stampOfRide）：規則檔改了對照，舊趟次照新對照重算，不用改這張表。
-- 寫的時機：bountyCreditTripChips 算出這趟有點數（raw > 0）就寫，不看當天是不是已經領滿 500 點；寫入失敗不擋點數入帳。
-- 合併帳號：兩邊有同一趟＝留帳號那一列，其餘改名（bountyMerge）。刪帳號：跟錢包其他表一起刪（bountyPurgeUid）。
-- 逐人讀寫都以 actor 起頭：主鍵的自動索引 sqlite_autoindex_ride_log_1 服務這幾種查詢（worker.js 用 INDEXED BY 指名它）。
--
-- 🔴 先套 schema、再部署用到它的 Worker。忘了套的症狀：
--    ① /api/account-delete 對【所有人】回 502：bountyPurgeUid 在同一個 batch 刪這張表，缺表整批失敗。
--    ② chips-me 一律 503（錢包讀不到）；判定照常入帳點數（寫這張表的那一句自己吞錯），但那幾晚的趟次不會有章，要事後回補。
--    ship-web 的正式庫 schema 守門人（scripts/verify_remote_schema.mjs）會擋下沒套就出貨。
-- 只有 CREATE，全部 IF NOT EXISTS，重跑無害。之後要加欄就開新檔。
CREATE TABLE IF NOT EXISTS ride_log (
  actor      TEXT    NOT NULL,
  trip_date  TEXT    NOT NULL,
  train_no   TEXT    NOT NULL,
  sys        TEXT    NOT NULL,
  car        TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor, trip_date, train_no, sys)
);

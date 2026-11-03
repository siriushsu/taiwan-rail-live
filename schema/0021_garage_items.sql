-- 車庫兌換車款：用點數換到的車款，每人每款一列，永久、不綁通行證（POST /api/garage-collect）。
--
-- 跟場景的 garage_unlocks 分開放：那張表的列數就是「第幾座」，場景價格照它算，車款放進去會讓下一座場景變貴；
-- 舊 App 讀 chips-me 的 unlocked 時要求每筆的 nth 不重複，車款混進去整份錢包讀取失敗。
-- item：兌換品 id（data/bounty_rules.json 的 chips.items 的鍵，例如 train:dr3000）。cost：當時花了幾點（之後改價不影響已換到的）。
-- unit：cost 的單位。這張表在懸賞 v3 之後才有，只會是 'point'；跟 garage_unlocks 同一個欄位，合併退款照它寫帳本列的 unit。
-- 帳本照舊寫 chip_ledger（kind='redeem'，id＝item|<兌換品>|<ref>）；餘額只看帳本，這張表只回答「換到了哪幾款」。
-- 逐人讀寫（錢包、兌換、合併、刪帳號）都以 actor 起頭：主鍵 (actor, item) 的自動索引 sqlite_autoindex_garage_items_1
-- 服務這幾種查詢（worker.js 用 INDEXED BY 指名它，理由見「查詢計畫釘死」）。
--
-- 🔴 先套 schema、再部署用到它的 Worker。忘了套的症狀：
--    ① /api/account-delete 對【所有人】回 502：bountyPurgeUid 在同一個 batch 刪這張表，缺表整批失敗（App 審查要求能刪帳號）。
--    ② chips-me、garage-collect、bounty-merge 一律 503（錢包整個讀不到，場景兌換也跟著不能用）。
--    ship-web 的正式庫 schema 守門人（scripts/verify_remote_schema.mjs）會擋下沒套就出貨。
-- 🔴 回滾提醒：Worker 若回滾到這一版之前，舊版不認得這張表——刪帳號不刪、合併不搬（登入前換到的車款留在舊裝置名下）。
--    回滾期間暫停刪帳號與合併，或回滾後對這張表手動補刪／補搬（同 0014 檔頭）。
-- 只有 CREATE，全部 IF NOT EXISTS，重跑無害。之後要加欄就開新檔。
CREATE TABLE IF NOT EXISTS garage_items (
  actor      TEXT    NOT NULL,
  item       TEXT    NOT NULL,
  cost       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  unit       TEXT    NOT NULL DEFAULT 'point',
  PRIMARY KEY (actor, item)
);

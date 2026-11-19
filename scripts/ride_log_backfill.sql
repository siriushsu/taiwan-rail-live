-- 搭乘集章回補（2026-11-19 定案「回補舊趟次」）：把 ride_log（schema/0027）上線之前、已經判定合格並入帳的每一趟補進去。
-- 一趟＝帳本有這班車的錄程列（kind 'trip'，ref 結尾是「|乘車日|車次」，補差額列 ref 帶 |topup| 不算）而且樣本是 ok 的那個系統。
-- 當天領滿上限、錄程列沒寫進去的趟次補不到（帳本是唯一的「合格」紀錄）；模擬器本來就不入帳，所以不會被補。
-- car 一律寫空字串：之後讀錢包時照現行班表補（stampsOf；那一天不在班表檔內就退回同車次任一天的車種名，少數改點的班次可能對錯，提案第二節的已知誤差）。
-- created_at 寫 0：看得出是回補的列。重跑無害（主鍵＋OR IGNORE）。
-- 🔴 對正式庫執行要使用者說 go。先跑下面這句唯讀的數一數（會補幾趟、幾個人），再跑 INSERT：
--   SELECT COUNT(*) AS trips, COUNT(DISTINCT actor) AS people FROM (SELECT DISTINCT s.actor, s.trip_date, s.train_no, s.sys FROM bounty_samples s
--     WHERE s.verdict='ok' AND EXISTS (SELECT 1 FROM chip_ledger l WHERE l.actor=s.actor AND l.kind='trip' AND l.day=s.trip_date
--     AND instr(l.ref, '|topup|')=0 AND substr(l.ref, -length('|' || s.trip_date || '|' || s.train_no)) = '|' || s.trip_date || '|' || s.train_no));
-- 驗收：scripts/verify_bounty_stamps.mjs 的 B 組拿這個檔對種好的庫跑。
INSERT OR IGNORE INTO ride_log (actor, trip_date, train_no, sys, car, created_at)
SELECT DISTINCT s.actor, s.trip_date, s.train_no, s.sys, '', 0 FROM bounty_samples s
WHERE s.verdict='ok' AND EXISTS (SELECT 1 FROM chip_ledger l WHERE l.actor=s.actor AND l.kind='trip' AND l.day=s.trip_date
  AND instr(l.ref, '|topup|')=0 AND substr(l.ref, -length('|' || s.trip_date || '|' || s.train_no)) = '|' || s.trip_date || '|' || s.train_no);

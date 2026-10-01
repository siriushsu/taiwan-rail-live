-- 路段懸賞：判定當下存下防偽閘收下點的里程範圍。
--
-- kept_d0／kept_d1：這一列所屬線組「防偽閘收下的點」的最小與最大沿線里程（公尺），同一組每一列值相同。
-- 只有 ok 的組寫；unusable／suspect（含 oversize）、pending、這兩欄出現之前就判過的舊列都是 NULL（NULL 不貢獻移動距離）。
-- 籌碼的移動距離由此算：遲傳合併判籌碼時，前次組的里程範圍讀這兩欄、不從原始 payload 重算，
-- 所以同一份資料不論分幾次上傳、分在哪幾發判，移動距離都相同。
--
-- 🔴 所有環境都要跑（新環境＝0002 + 0014 + 0015 + 0016）。先套 schema、再部署用到它的 Worker。忘了套的症狀：
--    判定 cron 每一班車讀前次線組的那一句 SELECT 讀 kept_d0／kept_d1，缺欄整句失敗；
--    超量車標 suspect 的那句 UPDATE、標記已判定的那句 UPDATE 也都寫這兩欄，同樣失敗。
--    這幾句都排在點數、趟數、籌碼入帳之前，所以那班車一樣都不寫、樣本留在 pending，記一次出錯，補套之後下一發 cron 重判，不會永久漏發；
--    但套之前整支判定 cron 沒有任何一班車判得出來（路段懸賞的點數與籌碼全停）。
-- 自成一檔、只有這兩句：0014、0015 都已經套進正式庫，重套它們會在第一句 ALTER 中斷，接在後面的欄位永遠跑不到。
-- 重跑會報 duplicate column name（無害，代表已經套過）。
ALTER TABLE bounty_samples ADD COLUMN kept_d0 REAL;
ALTER TABLE bounty_samples ADD COLUMN kept_d1 REAL;

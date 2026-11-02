-- 路段懸賞：判定當下存下防偽閘收下點所在那一段的時刻範圍（11-02）。
--
-- kept_t0／kept_t1：這一列所屬那一段（bountyKeptSegments 在長的移動斷訊處切開的段）「防偽閘收下的點」最早與最晚的樣本時刻
-- （台北當日秒；該組跨午夜時是加過一天的值），同一段每一列值相同，跟 kept_d0／kept_d1 同一句寫。只有 ok 的組寫，其餘 NULL。
-- 遲傳合併判時，前次段之間照時間與速度上限接段（bountyLineMeters）要用這兩欄；舊列沒有（NULL）才退回該段各列原始 payload 的時刻。
-- 原始時刻含防偽閘丟掉的雜點：前一發段尾有一個雜點落在斷訊中間，段的時刻就被拉近下一段，晚到一批就把超過 20 分鐘的斷訊接起來多發點。
--
-- 🔴 所有環境都要跑，而且先套 schema、再部署用到它的 Worker。忘了套的症狀：讀前次線組的 SELECT 與標記已判定的 UPDATE 缺欄整句失敗，
--    整支判定 cron 沒有任何一班車判得出來（樣本留在 pending，補套之後下一發重判，不會永久漏發）。
-- 重跑會報 duplicate column name（無害，代表已經套過）。
ALTER TABLE bounty_samples ADD COLUMN kept_t0 REAL;
ALTER TABLE bounty_samples ADD COLUMN kept_t1 REAL;

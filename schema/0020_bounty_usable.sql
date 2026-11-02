-- 路段懸賞：「資料可用」標記（11-02）。跟點數分開：點數照判定給，這兩欄只回答「這一列的點是不是真的是這個車次」。
--
-- usable：1＝這一列每一點都落在跟「表定＋官方逐站誤點」對得上的站之間；0＝這條線比得到站，但這一列有點對不上
--         （開錄時還在月台等車、下車後還在錄、或整趟跟車次對不上）；NULL＝還沒標，或一站都比不到（沒有班表、沒有官方誤點、整段地下、高鐵）。
-- usable_at：標的時刻（epoch 毫秒）。比不了的也寫，下一發就不再挑它；遲傳的批次判 ok 之後是 NULL，那班車會整班重算。
-- 只有 verdict='ok' 的台鐵列會寫（bountyUsableCron，判定 cron 跑完之後接著跑）。之後拿錄程修地圖、調班表，只讀 usable=1 的列。
--
-- 🔴 先套 schema、再部署用到它的 Worker。忘了套的症狀：bountyUsableCron 挑班車那一句缺欄失敗、只印錯誤，判定與點數不受影響。
-- 重跑會報 duplicate column name（無害，代表已經套過）。
ALTER TABLE bounty_samples ADD COLUMN usable INTEGER;
ALTER TABLE bounty_samples ADD COLUMN usable_at INTEGER;

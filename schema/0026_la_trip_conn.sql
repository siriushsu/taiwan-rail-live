-- 跟這趟（AI 串聯行程 P3）：鎖屏卡多段交棒時，上一發推出去的接續判斷。
-- 值＝「接得上／偏緊／可能接不上｜改搭的第幾個｜有沒有自動改搭過」組成的字串，NULL＝沒有接續（一般跟車、最後一段）。
-- 用途兩個：(1) 進「沒變就不推」的判定式——判斷翻了就要推；(2) 翻成「可能接不上」的那一發才帶 alert（亮螢幕一次，不每分鐘響）。
-- 規矩同 last_notice／last_stopping：laBind 重設點要一起歸零（PBIND）。
ALTER TABLE la_bindings ADD COLUMN last_conn TEXT;

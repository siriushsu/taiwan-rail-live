-- 跟車 Live Activity 的跨車轉乘計畫。
--
-- JSON 只有兩種 phase：
--   planned：仍跟第一段，內含轉乘站索引／時刻與接續車完整表定序列。
--   active ：已交棒到接續車，保留可變的車次／車種／色彩，供後續每一發 ContentState 覆寫
--            ActivityAttributes（attributes 建立後不可變）。
--
-- NULL＝一般單段跟車。只加一欄而不拆十多個 target_* 欄，是因為整份計畫永遠同進同退，沒有
-- 任何欄位需要獨立查詢或建立索引；拆欄只會製造「換綁時漏重設其中一欄」的安靜分岔。
ALTER TABLE la_bindings ADD COLUMN journey_state TEXT;

-- 台鐵等站卡 B(進站軌道):補「上一個停靠站的表定發車時刻」。
--
-- prev_dep_sec:epoch 秒。開卡當下由 App 從時刻表查好送上來(POST /api/tra-wait/bind 的 prevDepSec),
-- 與 sched_sec 一樣是【固定值】。伺服器用它與官方誤點算出「車正在上一站→本站之間」的時段,
-- 只有那一段每分鐘推一發(卡片上的車只在收到推播時往前挪;見 tra_wait_core.mjs 的 twRunWindow)。
--
-- NULL = 沒有行駛段可言:舊版 App 不送、或這一站就是起點站。這種列照舊只在誤點變了才推。
-- 🔴 所有環境都要跑(新環境＝0010 + 0013)。忘了套的症狀:部署新 Worker 後 bind 一律 503
--    bind_failed(INSERT 找不到欄位),卡片照開但從此沒有任何推播——必須先套 schema 再部署。
ALTER TABLE tra_wait_bindings ADD COLUMN prev_dep_sec INTEGER;

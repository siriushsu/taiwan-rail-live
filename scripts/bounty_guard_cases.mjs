// 懸賞設定檔守門的共用案例。同一條守門在 Worker（worker.js 的 coverageOf）與網頁（index.html 的 bountyUpdateDwellProgress）各寫一份，
// 兩邊的判準（verify_bounty_dwell.mjs 的 D15、verify_bounty_recorder_web.mjs 的 D）從這裡拿同一份案例：只改一邊的範圍，那一邊的判準會紅。
// quality.dwell.posSpeedWindowSec：要是數字、1–10 秒。0.5 釘下限、10.5 釘上限（第十三輪獨立驗收 P3-3：兩邊原本只測 60 與 Infinity，
// 上限在 10–60 之間各改各的，判準看不出來）。
export const POS_SPEED_WINDOW_REJECT = [['missing', undefined], ['zero', 0], ['half', 0.5], ['str', '5'], ['justOver', 10.5], ['sixty', 60], ['inf', Infinity]];
export const POS_SPEED_WINDOW_ACCEPT = [['one', 1], ['ten', 10]];

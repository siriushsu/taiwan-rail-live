// scripts/bounty_chips_core.mjs —— 籌碼規則的純函式。客端顯示與伺服器入帳共用這一份。
// 規則正本：路段懸賞 v2 §3.2／§3.3／§3.8。數字全部讀 data/bounty_rules.json 的 chips 區塊。

export function taipeiDay(epochMs) {
  const d = new Date(epochMs + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}

// 一趟合格錄程值幾個籌碼（還沒套每日上限）。
// trip: { verdict, lineKeys: ['tra_sched|南迴線', ...], durationSec, day: 'YYYY-MM-DD' }
export function tripChips(trip, chips) {
  if (!trip || trip.verdict !== 'ok') return 0;
  if (!(trip.durationSec >= chips.minTripSec)) return 0;
  const remote = (trip.lineKeys || []).some(k => chips.remoteLines.includes(k));
  let mult = remote ? chips.remoteMultiplier : 1;
  for (const ev of chips.events || []) {
    if (trip.day < ev.from || trip.day > ev.to) continue;
    if (ev.lines && !(trip.lineKeys || []).some(k => ev.lines.includes(k))) continue;
    mult *= ev.multiplier;
  }
  return chips.perTrip * mult;
}

// 每日籌碼上限（v2 §3.2「每日籌碼上限」）：數的是籌碼（×2 之後），超過的部分不給。
export function applyDailyChipCap(chipsForTrip, chipsAlreadyToday, chips) {
  return Math.max(0, Math.min(chipsForTrip, chips.dailyChipCap - chipsAlreadyToday));
}

// 雲端搭乘：今天這次算不算。paidDays 是這個 actor 已入帳的雲端搭乘日期（YYYY-MM-DD）。
export function cloudRideCounts(ride, paidDays, chips) {
  if (!ride || !(ride.sec >= chips.cloud.minSec)) return false;
  const todayCount = paidDays.filter(d => d === ride.day).length;
  return todayCount < chips.cloud.dailyMax;
}

// 雲端搭乘次數換籌碼：累計次數 → 應得籌碼（整數，多的次數留著）。
export function cloudChipsEarned(totalRides, chips) {
  return Math.floor(totalRides / chips.cloud.perChip);
}

// 第 N 座（1 起算）要花多少。超過價目表就沿用最後一格（09-29：第 1 座 4、之後每座 8）。
export function priceOfNth(n, chips) {
  const p = chips.prices;
  return p[Math.min(n, p.length) - 1];
}

// 能不能兌換某一座。unlocked 是已解鎖場景 id 陣列，balance 是目前籌碼。
export function canRedeem(sceneId, unlocked, balance, chips) {
  if (!chips.scenes.includes(sceneId)) return { ok: false, why: 'unknown_scene' };
  if (unlocked.includes(sceneId)) return { ok: false, why: 'already' };
  const cost = priceOfNth(unlocked.length + 1, chips);
  if (balance < cost) return { ok: false, why: 'not_enough', cost };
  return { ok: true, cost };
}

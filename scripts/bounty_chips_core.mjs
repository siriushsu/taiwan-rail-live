// scripts/bounty_chips_core.mjs —— 點數規則的純函式（懸賞 v3：沿線 1 公里 1 點）。客端顯示與伺服器入帳共用這一份。
// 規則的數字全部讀 data/bounty_rules.json 的 chips 區塊（區塊名與鍵名沿用 v2，讓舊客端讀得下去；數字都是點數）。

export function taipeiDay(epochMs) {
  const d = new Date(epochMs + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}

// 一條線收下的里程（公尺）→ 整數公寸。里程是判定收下的點的沿線里程相減（伺服器存到 0.1 m），
// 兩個浮點相減會差一個尾數（12345.6 − 2345.6 ＝ 9999.999…），直接除 1000 再捨去會少一點；先換成整數公寸再算。
function lineDm(m) {
  const v = Math.round(Number(m) * 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// 一趟合格錄程值幾點（還沒套每日上限）。
// trip: { verdict, durationSec, day: 'YYYY-MM-DD', lines: [{ key: 'tra_sched|南迴線', m: 98400 }, ...] }
//   lines：每條 ok 線收下的沿線里程（公尺），一條線一筆（同一條線前後各發的範圍由呼叫端先取聯集）。
// 點數＝Σ 各線公里數 × perKm × 偏遠倍率（那條線在 remoteLines）× 期間活動倍率（活動沒指定線、或指定了這條線），加總後捨去成整數。
// 合格門檻：verdict ok、durationSec ≥ minTripSec、各線里程加總 ≥ minTripMoveM（整趟停在一站不算）。
export function tripPoints(trip, chips) {
  if (!trip || trip.verdict !== 'ok') return 0;
  if (!(trip.durationSec >= chips.minTripSec)) return 0;
  let moveDm = 0, scaled = 0;
  for (const l of Array.isArray(trip.lines) ? trip.lines : []) {
    const dm = lineDm(l && l.m);
    if (!dm) continue;
    moveDm += dm;
    let mult = chips.remoteLines.includes(l.key) ? chips.remoteMultiplier : 1;
    for (const ev of chips.events || []) {
      if (trip.day < ev.from || trip.day > ev.to) continue;
      if (ev.lines && !ev.lines.includes(l.key)) continue;
      mult *= ev.multiplier;
    }
    scaled += dm * mult;
  }
  if (!(moveDm >= chips.minTripMoveM * 10)) return 0;
  // 公寸換公里是 ÷10000。倍率都是整數時全程整數運算；小數倍率的活動（例如 1.5）乘出來可能差一個尾數，加 1e-9 再捨去。
  return Math.floor(scaled * chips.perKm / 10000 + 1e-9);
}

// 每日上限：數的是加倍之後的點數，超過的部分不給。
export function applyDailyChipCap(pointsForTrip, pointsAlreadyToday, chips) {
  return Math.max(0, Math.min(pointsForTrip, chips.dailyChipCap - pointsAlreadyToday));
}

// 雲端搭乘：今天這次算不算。paidDays 是這個 actor 已入帳的雲端搭乘日期（YYYY-MM-DD）。算的話入帳 chips.cloud.points 點。
export function cloudRideCounts(ride, paidDays, chips) {
  if (!ride || !(ride.sec >= chips.cloud.minSec)) return false;
  const todayCount = paidDays.filter(d => d === ride.day).length;
  return todayCount < chips.cloud.dailyMax;
}

// 第 N 座（1 起算）要花多少點。超過價目表就沿用最後一格（價目表：第 1 座 200、之後每座 300）。
export function priceOfNth(n, chips) {
  const p = chips.prices;
  return p[Math.min(n, p.length) - 1];
}

// 能不能兌換某一座。unlocked 是已解鎖場景 id 陣列，balance 是目前點數。
export function canRedeem(sceneId, unlocked, balance, chips) {
  if (!chips.scenes.includes(sceneId)) return { ok: false, why: 'unknown_scene' };
  if (unlocked.includes(sceneId)) return { ok: false, why: 'already' };
  const cost = priceOfNth(unlocked.length + 1, chips);
  if (balance < cost) return { ok: false, why: 'not_enough', cost };
  return { ok: true, cost };
}

// 兌換車款的價目表是 chips.items（{兌換品 id: 點數}）：每款固定價，不看兌換順序，跟場景的價目表分開算。
// 沒有 items＝還沒開放任何車款（上線開關就是規則檔）。id 不合格式、價格不是正整數的那一款當成沒列，回 null。
// id 不含 '|'：帳本列的 id＝item|<兌換品>|<ref>，前後綴要切得出來。
export const GARAGE_ITEM_ID_RE = /^train:[a-z0-9_-]{1,40}$/;
export function itemPrice(itemId, chips) {
  const items = chips && chips.items;
  if (typeof itemId !== 'string' || !GARAGE_ITEM_ID_RE.test(itemId) || !items || typeof items !== 'object' || !Object.hasOwn(items, itemId)) return null;
  const p = items[itemId];
  return Number.isInteger(p) && p > 0 ? p : null;
}

// 能不能兌換某一款。owned 是已換到的兌換品 id 陣列，balance 是目前點數。
export function canCollect(itemId, owned, balance, chips) {
  const cost = itemPrice(itemId, chips);
  if (cost == null) return { ok: false, why: 'unknown_item' };
  if (owned.includes(itemId)) return { ok: false, why: 'already' };
  if (balance < cost) return { ok: false, why: 'not_enough', cost };
  return { ok: true, cost };
}

// ── 搭乘集章（2026-11-19 定案，規格 native 主樹 build/ride-stamps-1119/搭乘集章-提案.html）──────────────
// 規則在 chips.stamps：{ cars: [{ id, sys, match? }], sets: [{ id, cars: [章 id…], reward?: 'pick' }], names: {…} }。
//   ・cars 依序比對，第一個命中的就是這一趟的章：sys 要相同；有 match 的再拿班表的車種名（台鐵 carName，例如「自強(3000障)」）
//     當正規式比對，沒有 match＝這個系統每一班都算（高鐵全是 700T）。都沒命中＝這一趟不蓋章（專車、觀光列車）。
//   ・章對照放在讀的那一端（伺服器只存每一趟的系統、車次、車種名）：規則檔改了對照，舊趟次照新對照重算。
// 沒有 chips.stamps＝功能關著（上線開關就是規則檔，同 chips.items）。
export const STAMP_ID_RE = /^[a-z0-9_-]{1,40}$/;
const stampReMem = new Map();
function stampRe(src) {
  if (!stampReMem.has(src)) {
    let re = null;
    try { re = new RegExp(src); } catch (e) { re = null; }
    stampReMem.set(src, re);
  }
  return stampReMem.get(src);
}
export function stampsOn(chips) {
  const s = chips && chips.stamps;
  return !!s && Array.isArray(s.cars) && Array.isArray(s.sets);
}
// 一趟（sys、班表車種名）蓋哪個章；不蓋回 null。match 寫壞（不是合法正規式）的那一條當成沒列。
export function stampOfRide(sys, car, chips) {
  if (!stampsOn(chips)) return null;
  for (const c of chips.stamps.cars) {
    if (!c || !STAMP_ID_RE.test(String(c.id)) || c.sys !== sys) continue;
    if (c.match == null) return c.id;
    const re = stampRe(String(c.match));
    if (re && re.test(String(car == null ? '' : car))) return c.id;
  }
  return null;
}
// 錢包裡的章：rides 是這個人的搭乘紀錄 [{ trip_date, train_no, sys, car }]（伺服器依乘車日、車次排好）。
// 回 [{ id, n, first: { day, train } }]，照規則檔 cars 的順序，只列蓋到的；first 是最早的那一趟。
export function stampsView(rides, chips) {
  if (!stampsOn(chips)) return [];
  const got = new Map();
  for (const r of rides || []) {
    const id = stampOfRide(r.sys, r.car, chips);
    if (!id) continue;
    const s = got.get(id);
    if (s) s.n += 1;
    else got.set(id, { id, n: 1, first: { day: String(r.trip_date), train: String(r.train_no) } });
  }
  const order = [...new Set(chips.stamps.cars.map(c => c && c.id))];
  return order.filter(id => got.has(id)).map(id => got.get(id));
}
// 能不能領一組的獎勵車。view 是 stampsView 的結果，claimed 是已領過的組 id，owned 是已有的兌換品 id。
// 獎勵車只能從 chips.items 現在有列價格的車款裡挑（itemPrice 不是 null）、而且還沒有。
export function canClaimSet(setId, itemId, view, claimed, owned, chips) {
  const set = stampsOn(chips) ? chips.stamps.sets.find(s => s && s.id === setId && STAMP_ID_RE.test(String(s.id))) : null;
  if (!set) return { ok: false, why: 'unknown_set' };
  if (set.reward !== 'pick') return { ok: false, why: 'no_reward' };
  const have = new Set((view || []).map(s => s.id));
  if (!(Array.isArray(set.cars) && set.cars.length && set.cars.every(id => have.has(id)))) return { ok: false, why: 'incomplete' };
  if ((claimed || []).includes(setId)) return { ok: false, why: 'claimed' };
  if (itemPrice(itemId, chips) == null) return { ok: false, why: 'unknown_item' };
  if ((owned || []).includes(itemId)) return { ok: false, why: 'already' };
  return { ok: true };
}

// 誤點一日重播:把一天的 TDX 歷史誤點事件算成 /api/delay-replay 回的內容。
// Worker 每日 cron 跟 scripts/delay_replay_backfill.mjs 回補共用這一支,算法只有一份。
// 回傳 { v, day, names, tr, m, sum }:
//   names 站名;tr 每班車的影格 [車次, 站索引[], 分鐘[], 誤點[]],兩影格之間線性內插;
//   m 這天的重點(結構化欄位,文字由前端依語言組);sum 一句話的摘要欄位。
// 2025-01-21～2026-11-02 共 650 天驗過:「本來準點的車在一段多出 10 分以上」抓到的時間地點跟新聞對得上,
// 抓到的是最早卡住的車,不一定是事故本身(2026-03-27 抓到板橋—樹林,電車線斷在樹林—鶯歌)。
const GAP_MIN = 120;     // 同一車次隔兩小時以上算下一趟
const ROUTE_KM = 400;    // 超過這個距離當作走不到
const MILE_STATIONS = ['基隆', '新竹', '臺中', '高雄', '宜蘭', '花蓮', '臺東'];
const BINS = 288;        // 5 分鐘一格
const norm = n => String(n).replace(/\s*\(.*\)$/, '').replace(/台/g, '臺');

// tra.json 的線(含 aux,通過車的紀錄也會落在那些站)→ 站與相鄰距離;tra_station_info.json 給 TDX StationID → 站名
export function replayBuildNet(tra, stationInfo) {
  const idName = new Map(), adj = new Map(), seen = new Set();
  for (const s of Object.values(stationInfo || {})) if (s && s.id && s.name) idName.set(String(s.id), norm(s.name));
  for (const line of (tra && tra.lines) || []) {
    const st = line.stations || [];
    for (const s of st) { const n = norm(s.name); if (!adj.has(n)) adj.set(n, []); }
    for (let i = 0; i + 1 < st.length; i++) {
      const a = norm(st[i].name), b = norm(st[i + 1].name), k = a < b ? a + '|' + b : b + '|' + a;
      if (a === b || seen.has(k)) continue;
      seen.add(k);
      const km = Math.abs(st[i + 1].d - st[i].d);
      adj.get(a).push([b, km]); adj.get(b).push([a, km]);
    }
  }
  return { idName, adj, names: [...adj.keys()], from: new Map() };
}
// a 到各站的軌道距離,一站算一次
function distFrom(net, a) {
  let out = net.from.get(a);
  if (out) return out;
  const dist = new Map([[a, 0]]);
  out = new Map();
  for (;;) {
    let u = null, du = Infinity;
    for (const [n, d] of dist) if (!out.has(n) && d < du) { u = n; du = d; }
    if (u == null || du > ROUTE_KM) break;
    out.set(u, du);
    for (const [v, km] of net.adj.get(u) || []) if (du + km < (dist.get(v) ?? Infinity)) dist.set(v, du + km);
  }
  net.from.set(a, out);
  return out;
}
const kmBetween = (net, a, b) => distFrom(net, a).get(b);
const near = (net, a, b, km) => { const d = kmBetween(net, a, b); return d != null && d <= km; };
function span(net, set) {
  const a = [...set];
  let best = [a[0], a[0]], bd = -1;
  for (const x of a) for (const y of a) { const k = kmBetween(net, x, y) ?? -1; if (k > bd) { bd = k; best = [x, y]; } }
  return { a: best[0], b: best[1], km: bd };
}

// 事件 → 每班車清理過的停靠序列 [{st, m0, m1, d0, d1, n}]。分鐘從當天台北 0 點起算,紀錄站＝最後經過的站
function dayTrips(day, events, net) {
  const t0 = Date.parse(day + 'T00:00:00+08:00'), by = new Map();
  for (const r of events) {
    if (r.SrcUpdateTime == null || r.TrainNo == null || r.StationID == null) continue;
    const ms = Date.parse(r.SrcUpdateTime), d = parseInt(r.DelayTime, 10);
    if (!Number.isFinite(ms) || !Number.isFinite(d)) continue;
    const k = String(r.TrainNo);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ m: (ms - t0) / 60000, st: String(r.StationID), d });
  }
  const out = [];
  for (const [no, ev] of by) {
    ev.sort((x, y) => x.m - y.m);
    let cur = [];
    const flush = () => { if (cur.length) { out.push({ no, v: cur }); cur = []; } };
    for (const e of ev) {
      const n = net.idName.get(e.st);
      if (!n || !net.adj.has(n)) continue;
      const l = cur[cur.length - 1];
      if (l && e.m - l.m1 >= GAP_MIN && l.st !== n) flush();
      const l2 = cur[cur.length - 1];
      if (l2 && l2.st === n) { l2.m1 = e.m; l2.d1 = e.d; l2.n++; }
      else cur.push({ st: n, m0: e.m, m1: e.m, d0: e.d, d1: e.d, n: 1 });
    }
    flush();
  }
  for (const t of out) {
    const v = t.v;
    v[0].m0 = v[0].m1; v[0].d0 = v[0].d1;   // 第一站開車前的紀錄從半夜就掛著,只留最後一筆當發車
    // A,B,A 的跳動:B 只有一兩筆就是雜訊
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i + 1 < v.length; i++) {
      if (v[i - 1].st === v[i + 1].st && v[i].n <= 2) { v[i - 1].m1 = v[i + 1].m1; v[i - 1].d1 = v[i + 1].d1; v[i - 1].n += v[i + 1].n; v.splice(i, 2); i--; }
    }
    // 走不到、或快到不可能的那一站丟掉(紀錄時間本身有一兩分鐘抖動,近距離不看速度)
    for (let i = 1; i < v.length; i++) {
      const km = kmBetween(net, v[i - 1].st, v[i].st) ?? 1e9, dt = Math.max(1, v[i].m0 - v[i - 1].m1);
      if (km > 20 && km / dt * 60 > 200) { v.splice(i, 1); i--; }
    }
    t.m0 = v[0].m1; t.m1 = v[v.length - 1].m1;
  }
  return out.filter(t => t.v.length >= 2);
}
// 誤點只在到下一站時才更新,停很久的那段要在離站時補一個影格,不然看起來是一路慢慢開
function frames(trips, idx) {
  const tr = [];
  for (const t of trips) {
    const v = t.v, T = [], S = [], D = [];
    const push = (m, s, d) => { T.push(Math.round(m)); S.push(idx.get(s)); D.push(Math.round(d)); };
    for (let i = 0; i < v.length; i++) {
      const c = v[i], n = v[i + 1];
      push(c.m0, c.st, c.d0);
      if (c.m1 - c.m0 >= 3) push(c.m1, c.st, n ? c.d0 + (n.d0 - c.d0) * (c.m1 - c.m0) / Math.max(1, n.m0 - c.m0) : c.d1);
    }
    tr.push([t.no, S, T, D]);
  }
  return tr;
}
function legsOf(trips) {
  const L = [];
  for (const t of trips) {
    const v = t.v;
    for (let i = 0; i + 1 < v.length; i++) L.push({ no: t.no, a: v[i].st, b: v[i + 1].st, m0: v[i].m0, m1: v[i + 1].m0, before: v[i].d0, inc: v[i + 1].d0 - v[i].d0, first: i === 0 });
  }
  return L.sort((x, y) => x.m0 - y.m0);
}
// 本來準點的車突然多出 10 分以上＝這裡有事;同地點(12 公里)、一小時內的算同一處
function hitClusters(legs, net) {
  const out = [];
  for (const L of legs) {
    if (L.inc < 10 || L.before >= 5 || L.first) continue;
    let c = out.find(c => L.m0 - c.last <= 60 && [...c.st].some(s => near(net, s, L.a, 12)));
    if (!c) { c = { first: L, last: L.m0, st: new Set(), trains: new Set(), sum: 0, legs: [] }; out.push(c); }
    c.last = Math.max(c.last, L.m0); c.st.add(L.a); c.st.add(L.b); c.trains.add(L.no); c.sum += L.inc; c.legs.push(L);
  }
  return out.sort((x, y) => y.sum - x.sum);
}
// 誤點 15 分以上的車從事發點一站一站碰到哪裡:只算跟已碰到的站相連(40 公里內)的,別處自己的誤點不混進來
function front(trips, net, seeds, t0) {
  const ev = [];
  for (const t of trips) for (const v of t.v) if (v.d0 >= 15 && v.m0 >= t0) ev.push([v.m0, v.st, t.no, v.d0]);
  ev.sort((a, b) => a[0] - b[0]);
  const reached = new Map(seeds.map(s => [s, { t: t0 }]));
  for (const [m, st, no, d] of ev) {
    if (reached.has(st)) continue;
    for (const s of reached.keys()) if (near(net, s, st, 40)) { reached.set(st, { t: m, no, d }); break; }
  }
  return reached;
}
function lateCurve(trips) {
  const late = new Array(BINS).fill(0);
  for (const t of trips) {
    const v = t.v;
    for (let b = 0; b < BINS; b++) {
      const tm = b * 5;
      if (tm < t.m0 || tm > t.m1) continue;
      let i = 0;
      while (i + 1 < v.length && v[i + 1].m0 <= tm) i++;
      const n = v[Math.min(i + 1, v.length - 1)], c = v[i], f = n === c ? 0 : Math.min(1, (tm - c.m0) / Math.max(1, n.m0 - c.m0));
      if (c.d0 + (n.d0 - c.d0) * f >= 5) late[b]++;
    }
  }
  return late;
}
export function replayDay(day, events, net) {
  const trips = dayTrips(day, events, net), idx = new Map(net.names.map((n, i) => [n, i]));
  const tr = frames(trips, idx), legs = legsOf(trips), hits = hitClusters(legs, net), late = lateCurve(trips), m = [];
  const main = hits[0] && hits[0].sum >= 150 ? hits[0] : null;
  const pk = Math.max(...late), pb = late.indexOf(pk);
  let sum = { k: 'calm', pkT: pb * 5, pk };
  if (main) {
    // 群本身會沿著回堵一路連下去,「一帶」只看開頭 45 分鐘
    const f = main.first, early = main.legs.filter(l => l.m0 - f.m0 <= 45), eSt = new Set(early.flatMap(l => [l.a, l.b])), eTr = new Set(early.map(l => l.no)), sp = span(net, eSt);
    const area = sp.km > 3 ? [sp.a, sp.b] : [f.a, f.b];
    m.push({ k: 'start', t: f.m0, a: f.a, b: f.b, no: f.no, inc: f.inc, n: eTr.size, area, st: [...eSt] });
    // 卡最久:開頭三小時內、這一帶,多出來的分鐘要接近走掉的時間(不然是紀錄斷掉,不是真的停住)
    const stall = legs.filter(l => l.m0 >= f.m0 - 5 && l.m0 <= f.m0 + 180 && l.inc >= (l.m1 - l.m0) * .5 && [...eSt].some(s => near(net, s, l.a, 25))).sort((a, b) => b.inc - a.inc)[0];
    if (stall && stall.inc >= 20) m.push({ k: 'stall', t: stall.m0 + Math.min(30, (stall.m1 - stall.m0) / 2), a: stall.a, b: stall.b, no: stall.no, inc: stall.inc, t0: stall.m0, t1: stall.m1, st: [stall.a, stall.b] });
    const fr = front(trips, net, [...main.st], f.m0);
    for (const n of MILE_STATIONS) {
      const r = fr.get(n);
      if (!r || !r.no || r.t <= f.m0 + 10 || r.t > f.m0 + 600) continue;   // 隔十小時以上就說不上是同一波
      m.push({ k: 'reach', t: r.t, to: n, no: r.no, d: r.d, after: r.t - f.m0, st: [f.a, n] });
    }
    for (const c of hits.slice(1, 5)) {
      if (c.sum < 200 || c.trains.size < 6) continue;
      if ([...c.st].some(s => [...main.st].some(q => near(net, s, q, 15))) && c.first.m0 - main.last < 60) continue;
      m.push({ k: 'other', t: c.first.m0, a: c.first.a, b: c.first.b, no: c.first.no, n: c.trains.size, inc: c.sum, st: [...c.st] });
    }
    m.push({ k: 'peak', t: pb * 5, n: pk, after: pb * 5 - f.m0, st: [] });
    const far = m.filter(x => x.k === 'reach').sort((a, b) => b.t - a.t)[0];
    sum = { k: 'event', t: f.m0, area, farTo: far?.to, farAfter: far?.after, pkT: pb * 5, pk };
  } else {
    m.push({ k: 'peak', t: pb * 5, n: pk, st: [] });
    for (const c of hits.slice(0, 2)) if (c.sum >= 12) m.push({ k: 'small', t: c.first.m0, a: c.first.a, b: c.first.b, no: c.first.no, inc: c.first.inc, st: [c.first.a, c.first.b] });
  }
  if ((late[286] ?? 0) >= 5) m.push({ k: 'night', t: 1435, n: late[286], st: [] });
  m.sort((a, b) => a.t - b.t);
  for (const x of m) x.t = Math.round(x.t);
  return { v: 1, day, names: net.names, tr, m, sum };
}

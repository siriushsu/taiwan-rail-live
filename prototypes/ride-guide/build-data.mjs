// 乘車導覽原型的路線／班次資料產生器。
// 從 repo 既有資料檔裁出示範旅程（平溪線、花東線、海線）需要的最小集合，輸出成一支 JS（掛 window 全域），
// 讓原型用 file://、本機 server、Artifact 預覽都能直接讀，不需要 fetch。
//   軌道幾何：data/tra.json（OSM 衍生，ODbL）
//   英文站名：i18n/stations.json
//   班次：data/tra_schedule.json（臺鐵開放資料逐日時刻表快照）
// 用法：node prototypes/ride-guide/build-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tra = JSON.parse(readFileSync(join(root, 'data/tra.json'), 'utf8'));
const sched = JSON.parse(readFileSync(join(root, 'data/tra_schedule.json'), 'utf8'));

const R = 6371.0088;
const rad = (x) => (x * Math.PI) / 180;
function hav(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 依站的里程 d（km）切出兩站之間的折線；from > to 時反向。
function slice(line, fromName, toName) {
  const shape = line.shape;
  const cum = [0];
  for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + hav(shape[i - 1], shape[i]));
  const k = line.shapeLen / cum[cum.length - 1]; // 站點 d 與 shapeLen 同一尺度
  const st = (n) => {
    const s = line.stations.find((x) => x.name === n);
    if (!s) throw new Error(`${line.id} 找不到 ${n}`);
    return s.d / k;
  };
  const a = st(fromName), b = st(toName);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const at = (d) => {
    const i = cum.findIndex((c) => c >= d);
    if (i === -1) return shape[shape.length - 1]; // 浮點誤差略超出尾端
    if (i === 0) return shape[0];
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [shape[i - 1][0] + (shape[i][0] - shape[i - 1][0]) * t, shape[i - 1][1] + (shape[i][1] - shape[i - 1][1]) * t];
  };
  const pts = [at(lo)];
  for (let i = 0; i < shape.length; i++) if (cum[i] > lo && cum[i] < hi) pts.push(shape[i]);
  pts.push(at(hi));
  return a <= b ? pts : pts.reverse();
}

// Douglas–Peucker（平面近似，台灣緯度下足夠）
function simplify(pts, tolKm) {
  if (pts.length < 3) return pts;
  const kx = Math.cos(rad(25.05)) * 111.32, ky = 110.57;
  const xy = pts.map((p) => [p[1] * kx, p[0] * ky]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1, bi = -1;
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((x2 - x1) * (y1 - xy[i][1]) - (x1 - xy[i][0]) * (y2 - y1)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tolKm) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const L = Object.fromEntries(tra.lines.map((l) => [l.id, l]));

// 英文站名沿用 repo 的 i18n/stations.json；站 id＝英文名去空白與撇號的小寫
const i18n = JSON.parse(readFileSync(join(root, 'i18n/stations.json'), 'utf8'));
const EN = (function find(d) {
  if (d && typeof d === 'object') {
    if (d['光復'] && d['光復'].en) return d;
    for (const v of Object.values(d)) { const r = find(v); if (r) return r; }
  }
  return null;
})(i18n);
const idOf = (zh) => {
  const en = EN[zh] && EN[zh].en;
  if (!en) throw new Error(`i18n 沒有 ${zh} 的英文站名`);
  return en.toLowerCase().replace(/[\s'’]/g, '');
};

// 示範路線：每條是幾段 [線, 起站, 迄站] 串起來的折線，加上幾班「每天都開」的示範班次
const ROUTES = {
  pingxi: { legs: [[L.SHENAO, '八斗子', '瑞芳'], [L['宜蘭線'], '瑞芳', '三貂嶺'], [L.PINGXI, '三貂嶺', '菁桐']], trains: ['4816', '4827'] },
  huadong: { legs: [[L['臺東線'], '花蓮', '玉里']], trains: ['4528', '4543'] },
  haixian: { legs: [[L['海線'], '竹南', '彰化']], trains: ['2527', '2540'] },
};

const T = sched.trains;
const allDates = Object.keys(sched.dates);
// 有導覽內容的站：另外輸出示範日的開出班次，給「回程與下一班」用
const GUIDE = new Set(['shifen', 'pingxi', 'jingtong', 'guangfu', 'tongxiao']);
const DEMO_DATE = '2026-10-01';
if (!sched.dates[DEMO_DATE]) throw new Error(`時刻表快照沒有示範日 ${DEMO_DATE}`);
function pickTrain(no, stationSet) {
  // 同一車次跨日可能有多份定義（臨時改點）；取「停靠站都在這條路線上」且行駛天數最多的那份
  let best = null;
  T.forEach((t, i) => {
    if (t.train !== no || !t.stops.every((s) => stationSet.has(s.name))) return;
    const dates = allDates.filter((d) => sched.dates[d].includes(i)).sort();
    if (!best || dates.length > best.dates.length) best = { t, dates };
  });
  if (!best) throw new Error(`班表找不到 ${no}`);
  return best;
}

const out = {
  builtFrom: {
    track: 'data/tra.json（OpenStreetMap 衍生，ODbL）',
    schedule: `data/tra_schedule.json（臺鐵開放資料逐日時刻表，快照 ${sched.date}，涵蓋 ${sched.dateRange.join('～')}）`,
  },
  scheduleSnapshot: sched.date,
  scheduleRange: sched.dateRange,
  demoDate: DEMO_DATE,
  routes: {},
};

for (const [rid, def] of Object.entries(ROUTES)) {
  let path = [];
  const names = [];
  for (const [line, a, b] of def.legs) {
    const seg = slice(line, a, b);
    path = path.length ? path.concat(seg.slice(1)) : seg;
    const st = line.stations.map((x) => x.name);
    const i = st.indexOf(a), j = st.indexOf(b);
    const part = i <= j ? st.slice(i, j + 1) : st.slice(j, i + 1).reverse();
    for (const n of part) if (!names.includes(n)) names.push(n);
  }
  path = simplify(path, 0.006).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + hav(path[i - 1], path[i]));
  const project = (p) => {
    let best = Infinity, bestKm = 0;
    const kx = Math.cos(rad(p[0])) * 111.32, ky = 110.57;
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1][1] * kx, ay = path[i - 1][0] * ky, bx = path[i][1] * kx, by = path[i][0] * ky;
      const px = p[1] * kx, py = p[0] * ky, vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1e-12)));
      const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
      if (d < best) { best = d; bestKm = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
    }
    return { offKm: best, km: bestKm };
  };
  const set = new Set(names);
  const trains = def.trains.map((no) => {
    const { t, dates } = pickTrain(no, set);
    return { no: t.train, type: t.typeName, dates, stops: t.stops.map((s) => ({ id: idOf(s.name), arr: s.arrSec, dep: s.depSec })) };
  });
  const stations = {};
  for (const zh of names) {
    const s = T.flatMap((t) => t.stops).find((x) => x.name === zh);
    if (!s) throw new Error(`班表沒有 ${zh} 的座標`);
    const pr = project([s.lat, s.lon]);
    if (pr.offKm > 0.3) throw new Error(`${zh} 離軌道 ${pr.offKm.toFixed(3)} km，投影可疑`);
    stations[idOf(zh)] = { zh, en: EN[zh].en, lat: s.lat, lon: s.lon, km: +pr.km.toFixed(3) };
  }
  // 導覽站的「下一段／回程」：示範日當天所有在這站開出的班次（不限本路線的示範班次）
  const departures = {};
  for (const zh of names) {
    const id = idOf(zh);
    if (!GUIDE.has(id)) continue;
    const idx = new Set(sched.dates[DEMO_DATE]);
    departures[id] = T.flatMap((t, i) => {
      if (!idx.has(i)) return [];
      const k = t.stops.findIndex((x) => x.name === zh);
      if (k < 0 || k === t.stops.length - 1) return [];
      const last = t.stops[t.stops.length - 1].name;
      return [{ no: t.train, type: t.typeName, dep: t.stops[k].depSec, to: { zh: last, en: (EN[last] && EN[last].en) || last } }];
    }).sort((x, y) => x.dep - y.dep);
  }
  out.routes[rid] = { lengthKm: +cum[cum.length - 1].toFixed(3), path, stations, trains, departures };
  console.log(`${rid}：折線 ${path.length} 點、全長 ${out.routes[rid].lengthKm} km、${names.length} 站`);
  for (const tr of trains) console.log('  ', tr.no, tr.type, tr.dates.length, '天', tr.stops.map((x) => x.id).join('>'));
}

const file = join(here, 'data', 'routes.js');
writeFileSync(file,
  '// 自動產生：node prototypes/ride-guide/build-data.mjs（勿手改）\n' +
  `window.RIDE_ROUTES = ${JSON.stringify(out)};\n`);
console.log(`寫出 ${file}`);

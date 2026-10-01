// 乘車導覽原型的路線／班次資料產生器。
// 從 repo 既有資料檔裁出平溪線示範旅程需要的最小集合，輸出成一支 JS（掛 window 全域），
// 讓原型用 file://、本機 server、Artifact 預覽都能直接讀，不需要 fetch。
//   軌道幾何：data/tra.json（OSM 衍生，ODbL）——深澳線＋宜蘭線瑞芳–三貂嶺段＋平溪線
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
// 八斗子 → 瑞芳（深澳線反向）→ 三貂嶺（宜蘭線反向）→ 菁桐（平溪線）
const legs = [
  [L.SHENAO, '八斗子', '瑞芳'],
  [L['宜蘭線'], '瑞芳', '三貂嶺'],
  [L.PINGXI, '三貂嶺', '菁桐'],
];
let path = [];
for (const [line, a, b] of legs) {
  const seg = slice(line, a, b);
  path = path.length ? path.concat(seg.slice(1)) : seg;
}
path = simplify(path, 0.006).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]);

// 沿折線累積里程，並把每一站投影到折線上取得「路線里程」
const cum = [0];
for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + hav(path[i - 1], path[i]));
function project(p) {
  let best = Infinity, bestKm = 0;
  const kx = Math.cos(rad(25.05)) * 111.32, ky = 110.57;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][1] * kx, ay = path[i - 1][0] * ky, bx = path[i][1] * kx, by = path[i][0] * ky;
    const px = p[1] * kx, py = p[0] * ky;
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1e-12)));
    const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
    if (d < best) { best = d; bestKm = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
  }
  return { offKm: best, km: bestKm };
}

const stationIds = {
  八斗子: 'badouzi', 海科館: 'haikeguan', 瑞芳: 'ruifang', 猴硐: 'houtong', 三貂嶺: 'sandiaoling',
  大華: 'dahua', 十分: 'shifen', 望古: 'wanggu', 嶺腳: 'lingjiao', 平溪: 'pingxi', 菁桐: 'jingtong',
};

const T = sched.trains;
const pick = (no) => {
  const i = T.findIndex((t) => t.train === no && t.stops.some((s) => s.name === '菁桐'));
  if (i < 0) throw new Error(`班表找不到 ${no}`);
  const dates = Object.entries(sched.dates).filter(([, v]) => v.includes(i)).map(([k]) => k).sort();
  return { t: T[i], dates };
};

const stations = {};
for (const [zh, id] of Object.entries(stationIds)) {
  const s = T.flatMap((t) => t.stops).find((x) => x.name === zh);
  const pr = project([s.lat, s.lon]);
  if (pr.offKm > 0.25) throw new Error(`${zh} 離軌道 ${pr.offKm.toFixed(3)} km，投影可疑`);
  stations[id] = { zh, lat: s.lat, lon: s.lon, km: +pr.km.toFixed(3) };
}

const trains = ['4816', '4827'].map((no) => {
  const { t, dates } = pick(no);
  return {
    no: t.train,
    type: t.typeName,
    dates,
    stops: t.stops.map((s) => ({ id: stationIds[s.name], arr: s.arrSec, dep: s.depSec })),
  };
});

const out = {
  builtFrom: {
    track: 'data/tra.json（OpenStreetMap 衍生，ODbL）',
    schedule: `data/tra_schedule.json（臺鐵開放資料逐日時刻表，快照 ${sched.date}，涵蓋 ${sched.dateRange.join('～')}）`,
  },
  scheduleSnapshot: sched.date,
  scheduleRange: sched.dateRange,
  lengthKm: +cum[cum.length - 1].toFixed(3),
  path,
  stations,
  trains,
};

const file = join(here, 'data', 'route-pingxi.js');
writeFileSync(file,
  '// 自動產生：node prototypes/ride-guide/build-data.mjs（勿手改）\n' +
  `window.RIDE_ROUTE = ${JSON.stringify(out)};\n`);
console.log(`寫出 ${file}：折線 ${path.length} 點、全長 ${out.lengthKm} km`);
for (const tr of trains) console.log(tr.no, tr.dates.length, '天', tr.stops.map((s) => s.id).join('>'));
for (const [id, s] of Object.entries(stations)) console.log(id, s.km);

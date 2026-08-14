#!/usr/bin/env node
// 抓台鐵各站的「月台幾何」→ data/tra_platforms.json（單站打卡判定用）
//
// 為什麼需要這個（issue #28，2026-08-14）：打卡原本判「你到該站那一個座標點的直線距離
// ≤ 依站等給的半徑」。汐科月台實長 338m，而我們登記的座標落在月台東端外 141m 處，
// 到月台最遠端 476m —— 半徑 180m 只涵蓋月台最東邊約 40m，站在月台上九成位置都打不到卡。
// 站等半徑量的是「站有多大」的估計值，量不到「月台往哪個方向延伸多長」，這是結構性的限制，
// 不是把半徑調大就能解（汐科要開到 480m，而汐科↔汐止只隔 921m）。
//
// 解法＝把判定改成「到月台線段的距離」，本腳本產生那些線段。
//
// 每站存「最遠兩點連成的一條線段」而不是完整多邊形：全 197 站實測，各站所有月台頂點對
// 該線段的最大偏差中位數 16.6m、最大 62m（板橋，多座月台並排的橫向鋪開，不是彎曲），
// 遠小於前端的橫向容忍值 ⇒ 兩點就夠，不必扛完整幾何。腳本會自己驗這件事（見 MAX_DEV_M）。
//
// 兩道過濾（缺一就會把別的系統或別站的月台收進來）：
//   1. 月台必須貼著台鐵路線（到 data/tra.json 的 shape ≤ TRACK_NEAR_M）——排掉純捷運/輕軌月台。
//      OSM 的 operator/name 標籤覆蓋率只有一半（890 條裡 350 條有 name），標籤過濾不可靠。
//   2. 每條月台只指派給「最近的那一座台鐵站」且距離 ≤ STATION_NEAR_M——避免烏日把 833m 外的
//      新烏日月台、三塊厝把 864m 外的高雄月台一起吃進來。
//   共站站區（台北的高鐵月台、南港的高鐵月台）會留下來，這是刻意的：人站在台北車站的高鐵
//   月台上，就是人在台北車站，該給章。
//
// 資料授權：OpenStreetMap contributors，ODbL。同 data/tra.json 的線形來源（見其 source_notes）。
//
// 用法：node scripts/fetch_tra_platforms.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'data/tra_platforms.json';
const BBOX = '21.8,119.9,25.4,122.1';          // 台灣本島＋離島邊界（與 fetch_tra.py 同一個框）
const TRACK_NEAR_M = 40;                        // 月台到台鐵線形的容許距離
const STATION_NEAR_M = 500;                     // 月台到「最近台鐵站」的容許距離
const MAX_DEV_M = 100;                          // 頂點對代表線段的偏差上限（超過就該存完整幾何，本腳本會 fail）
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = `[out:json][timeout:180];\nway["railway"="platform"](${BBOX});\nout geom;`;

const R = 6371000;
const rad = d => d * Math.PI / 180;
const havM = (a, b) => {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
// 本地平面投影（公尺）：站區尺度下夠準，點對線段距離用得上
const xy = (p, o) => [(p[1] - o[1]) * 111320 * Math.cos(rad(o[0])), (p[0] - o[0]) * 110540];
const distSegM = (p, a, b, o) => {
  const [px, py] = xy(p, o), [ax, ay] = xy(a, o), [bx, by] = xy(b, o);
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// ── 台鐵站點與線形 ──────────────────────────────────────────────────────────
const tra = JSON.parse(readFileSync('data/tra.json', 'utf8'));
const stations = new Map();                      // 站名 → [lat, lon]
for (const ln of tra.lines) for (const s of ln.stations || []) if (!stations.has(s.name)) stations.set(s.name, [s.lat, s.lon]);
const track = [];
for (const ln of tra.lines) for (const p of ln.shape) track.push(p);
// 0.005° 網格加速「到線形的距離」：全掃是 197 站 × 890 月台 × 數萬點
const GRID = 0.005;
const cell = p => `${Math.floor(p[0] / GRID)},${Math.floor(p[1] / GRID)}`;
const grid = new Map();
for (const p of track) { const k = cell(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
const distTrackM = p => {
  const [cx, cy] = cell(p).split(',').map(Number);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) { const d = havM(p, q); if (d < best) best = d; }
  return best;
};

// ── Overpass ────────────────────────────────────────────────────────────────
let elements = null;
for (const url of MIRRORS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'railisland/1.0 (+https://railisland.tw)' },
      body: new URLSearchParams({ data: QUERY }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    elements = (await res.json()).elements || [];
    console.log(`overpass ok: ${url} → ${elements.length} ways`);
    break;
  } catch (e) { console.log(`overpass fail: ${url} — ${e.message}`); }
}
if (!elements) { console.error('所有 Overpass 鏡像都失敗，不覆蓋既有檔案'); process.exit(1); }

// ── 指派月台 → 車站 ─────────────────────────────────────────────────────────
const byStation = new Map();
let nearTrack = 0;
for (const e of elements) {
  const g = (e.geometry || []).map(p => [p.lat, p.lon]);
  if (g.length < 2) continue;
  const step = Math.max(1, Math.floor(g.length / 12));
  const smp = g.filter((_, i) => i % step === 0);
  if (Math.min(...smp.map(distTrackM)) > TRACK_NEAR_M) continue;   // 過濾 1：不貼台鐵線形
  nearTrack++;
  let best = Infinity, bestName = null;
  for (const [name, c] of stations) {
    const d = Math.min(...smp.map(p => havM(c, p)));
    if (d < best) { best = d; bestName = name; }
  }
  if (best > STATION_NEAR_M) continue;                              // 過濾 2：離最近的站太遠
  if (!byStation.has(bestName)) byStation.set(bestName, []);
  byStation.get(bestName).push(g);
}

// ── 每站取代表線段（最遠兩點）＋自驗偏差 ───────────────────────────────────
const out = {};
let worst = { dev: 0, name: '' };
for (const [name, ways] of byStation) {
  const pts = ways.flat();
  let a = pts[0], b = pts[0], len = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = havM(pts[i], pts[j]);
    if (d > len) { len = d; a = pts[i]; b = pts[j]; }
  }
  if (len < 20) continue;                                           // 幾何太小＝抓錯東西，不如退回站等半徑
  const o = stations.get(name);
  const dev = Math.max(...pts.map(p => distSegM(p, a, b, o)));
  if (dev > worst.dev) worst = { dev, name };
  const r5 = v => Math.round(v * 1e5) / 1e5;
  out[name] = [[r5(a[0]), r5(a[1])], [r5(b[0]), r5(b[1])]];
}
if (worst.dev > MAX_DEV_M) {
  console.error(`月台頂點對代表線段偏差 ${worst.dev.toFixed(0)}m（${worst.name}）超過 ${MAX_DEV_M}m ⇒ 兩點線段不足以代表幾何，需改存完整折線。不寫檔。`);
  process.exit(1);
}

// 站名對不上班表的話前端一輩子查不到，出檔前先講
const schedNames = new Set();
try {
  for (const tr of JSON.parse(readFileSync('data/tra_schedule_dense.json', 'utf8')).trains)
    for (const s of tr.stops) schedNames.add(s.name);
} catch (e) { console.log('（讀不到 tra_schedule_dense.json，跳過站名對照）'); }
if (schedNames.size) {
  const orphan = Object.keys(out).filter(n => !schedNames.has(n));
  console.log(`站名對不上班表的：${orphan.length ? orphan.join('、') : '(無)'}`);
}

const doc = {
  source: 'OpenStreetMap contributors — way[railway=platform]，經 Overpass API 取得',
  license: 'ODbL 1.0（https://www.openstreetmap.org/copyright）',
  note: '每站一條「代表線段」＝該站區所有月台頂點中相距最遠的兩點；共站站區（如台北的高鐵月台）刻意保留。前端把它當「人在不在這座站」的判定基準，見 index.html 的 checkinJudge。',
  built_at: new Date().toISOString(),
  bbox: BBOX,
  filters: { trackNearM: TRACK_NEAR_M, stationNearM: STATION_NEAR_M },
  maxSegmentDevM: Math.round(worst.dev),
  stations: out,
};
writeFileSync(OUT, JSON.stringify(doc), 'utf8');
console.log(`月台 way ${elements.length} → 貼台鐵線形 ${nearTrack} → 指派到 ${Object.keys(out).length} 站`);
console.log(`頂點對線段最大偏差 ${worst.dev.toFixed(0)}m（${worst.name}）`);
console.log(`沒有月台幾何、維持站等半徑的站：${[...stations.keys()].filter(n => !out[n]).length} 座`);
console.log(`wrote ${OUT}`);

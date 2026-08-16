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
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// 第一段抓「畫得出形狀的月台」。public_transport=platform 要一起抓：OSM 有些站只標了這個、
// 沒標 railway=platform，只查後者會漏掉（2026-08-14 第一版就漏了）。
const QUERY = `[out:json][timeout:240];
(way["railway"="platform"](${BBOX});
 way["public_transport"="platform"](${BBOX});
 way["railway"="platform_edge"](${BBOX});
);
out geom;`;
// 第二段：沒有任何月台多邊形的站，改用列車停車點（stop_position／railway=stop）＋站等中位月台長
// 推一條線段出來。實測 44 座缺幾何的站裡有 43 座有停車點，且停車點離我們登記的站點座標
// 多半 ≤20m ⇒ 它至少把「站點座標歪掉」這件事修掉（岡山 68m、車埕 35m、三塊厝 25m）。
const QUERY_STOPS = `[out:json][timeout:240];
(node["public_transport"="stop_position"]["train"="yes"](${BBOX});
 node["railway"="stop"](${BBOX});
);
out;`;
// 各站等的「實測月台長中位數」，用來給沒有幾何的站推長度。這五個數字不是拍的，是本腳本
// 第一段量到的 197 座真實月台按站等取中位（tier 0/1/2/3/4）。資料重抓時會一起重算並印出來。
const EST_HALF_FALLBACK = [378, 330, 307, 270, 188];

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
// 鏡像很常 504／連不上（實測一輪裡三個鏡像可以全掛），所以是「多輪 × 多鏡像 ＋ 退避」。
// 抓不到就整支中止、絕不覆蓋既有檔案——半套資料悄悄上線比抓不到嚴重得多。
const overpass = async (q, label) => {
  for (let round = 0; round < 4; round++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'railisland/1.0 (+https://railisland.tw)' },
          body: new URLSearchParams({ data: q }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        console.log(`overpass ok（${label}）: ${url} → ${(j.elements || []).length} 筆`);
        return j.elements || [];
      } catch (e) { console.log(`overpass fail（${label}）: ${url} — ${e.message}`); }
    }
    await new Promise(r => setTimeout(r, 15000 * (round + 1)));
  }
  return null;
};
const elements = await overpass(QUERY, '月台');
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

// ── 第二段：沒有月台多邊形的站，用停車點＋站等中位月台長推 ────────────────────
// 為什麼要推：留著不管的話那些站仍在用「可能歪掉的站點座標＋站等半徑」，
// 而使用者要的是全台可用（懸賞任務會踩到這些站）。推出來的東西標成 derived，
// 前端一樣走「與站等半徑取聯集」⇒ 只會多給不會少給，估錯的代價有上界。
const cls = (() => { try { return JSON.parse(readFileSync('data/tra_station_class.json', 'utf8')); } catch (e) { return {}; } })();
const CLS_TIER = { 特等: 0, 一等: 1, 二等: 2, 三等: 3 };
const tierOf = n => { const c = cls[n] || cls[n.replace(/台/g, '臺')]; return c ? (CLS_TIER[c] ?? 4) : 4; };
// 中位數直接從「這一輪實測到的月台」算，不寫死：資料重抓時自己跟著更新。
// 樣本 < 6 的站等退回 EST_HALF_FALLBACK（tier 0 只有四座，中位數不穩）。
const estLen = [0, 1, 2, 3, 4].map(t => {
  const a = Object.entries(out).filter(([n]) => tierOf(n) === t)
    .map(([, s]) => havM(s[0], s[1])).sort((x, y) => x - y);
  return a.length >= 6 ? Math.round(a[a.length >> 1]) : EST_HALF_FALLBACK[t];
});
console.log(`站等中位月台長（推估用）：${estLen.map((v, i) => `tier${i}=${v}m`).join(' ')}`);

const stopEls = await overpass(QUERY_STOPS, '停車點');
if (!stopEls) { console.error('停車點抓不到，不覆蓋既有檔案'); process.exit(1); }

// 沿線形走 dist 公尺，回傳終點。
// 🔴 一定要「走到一半就內插」，不可以直接停在下一個頂點：台鐵線形的頂點間距很不平均
// （直線段動輒數百公尺一個點），停在頂點會讓推出來的月台長度暴衝——第一版就這樣，
// tier4 該是 188m 的段量出來 244～1149m。
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const walk = (shape, i, dir, dist) => {
  let acc = 0, k = i;
  for (;;) {
    const nk = k + dir;
    if (nk < 0 || nk >= shape.length) return shape[k];        // 走到線尾就到此為止
    const d = havM(shape[k], shape[nk]);
    if (acc + d >= dist) return lerp(shape[k], shape[nk], (dist - acc) / d);
    acc += d; k = nk;
  }
};
const derived = {};
const noStop = [];
for (const [name, c] of stations) {
  if (out[name]) continue;
  // 只收「貼著台鐵線形」的停車點：高鐵／捷運共站時它們的停車點也在附近，不濾會被拉走
  const stops = stopEls.map(n => [n.lat, n.lon])
    .filter(p => havM(c, p) <= 400 && distTrackM(p) <= TRACK_NEAR_M);
  if (!stops.length) { noStop.push(name); continue; }
  const ctr = [stops.reduce((s, p) => s + p[0], 0) / stops.length, stops.reduce((s, p) => s + p[1], 0) / stops.length];
  // 找最近的線形頂點（哪一條線、第幾點），從那裡往兩邊各走半個月台長
  let best = { d: Infinity, shape: null, i: -1 };
  for (const ln of tra.lines) for (let i = 0; i < ln.shape.length; i++) {
    const d = havM(ctr, ln.shape[i]);
    if (d < best.d) best = { d, shape: ln.shape, i };
  }
  if (!best.shape || best.d > TRACK_NEAR_M * 2) { noStop.push(name); continue; }
  const half = estLen[tierOf(name)] / 2;
  const a = walk(best.shape, best.i, -1, half), b = walk(best.shape, best.i, +1, half);
  if (havM(a, b) < 20) { noStop.push(name); continue; }
  const r5 = v => Math.round(v * 1e5) / 1e5;
  derived[name] = [[r5(a[0]), r5(a[1])], [r5(b[0]), r5(b[1])]];
}

// ── 自我把關：任何一站的線段都不可以伸進別站的判定範圍 ─────────────────────
// （前端橫向容忍 120m ⇒ 兩條線段靠得比 240m 近就可能互相涵蓋。推估的那些先被撤掉，
//   實測的留著；實測還撞在一起的話是資料本身有問題，直接 fail 不出檔。）
const LATERAL_M = 120;
const segDistM = (s1, s2) => {
  const o = s1[0];
  return Math.min(distSegM(s2[0], s1[0], s1[1], o), distSegM(s2[1], s1[0], s1[1], o),
    distSegM(s1[0], s2[0], s2[1], o), distSegM(s1[1], s2[0], s2[1], o));
};
const dropped = [];
// 🔴 每一輪都要用「當下還活著的集合」比對：拿一份開頭拍的快照去比，會把已經被撤掉的那條
// 又算成一次衝突，於是同一對站兩邊都被撤（第一版就這樣，北湖／湖口、善化／南科 四座全滅）。
for (const n of Object.keys(derived)) {
  for (const [m, t] of Object.entries({ ...out, ...derived })) {
    if (m === n) continue;
    if (segDistM(derived[n], t) <= LATERAL_M * 2) { delete derived[n]; dropped.push(`${n}(撞${m})`); break; }
  }
}
{
  const names = Object.keys(out);
  const clash = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    if (segDistM(out[names[i]], out[names[j]]) <= LATERAL_M * 2) clash.push(`${names[i]}↔${names[j]}`);
  if (clash.length) {
    console.error(`實測月台線段互相涵蓋：${clash.join('、')} ⇒ 資料有問題，不寫檔`);
    process.exit(1);
  }
}

// 站名對不上班表的話前端一輩子查不到，出檔前先講
const schedNames = new Set();
try {
  for (const tr of JSON.parse(readFileSync('data/tra_schedule_dense.json', 'utf8')).trains)
    for (const s of tr.stops) schedNames.add(s.name);
} catch (e) { console.log('（讀不到 tra_schedule_dense.json，跳過站名對照）'); }
if (schedNames.size) {
  // 正名：tra.json 手打站列的「左營(舊城)」「新城 (太魯閣)」在班表（台鐵 ODS 官方站名）是「左營」「新城」，
  // densify_schedule.py 已把通過站改成官方名（2026-08-16，同座標兩顆站的網友回報），前端 checkinPlatformSeg
  // 用班表站名查這份檔——鍵不跟著改就查不到（verify_checkin_platform A5）。去掉括號後對得上班表、
  // 且該名字還沒有幾何時，鍵改用官方站名。
  const base = n => { const i = Math.min(...[n.indexOf('('), n.indexOf('（')].filter(x => x >= 0)); return Number.isFinite(i) ? n.slice(0, i).trim() : n; };
  const renamed = [];
  for (const g of [out, derived]) for (const n of Object.keys(g)) {
    if (schedNames.has(n)) continue;
    const b = base(n);
    if (b !== n && schedNames.has(b) && !out[b] && !derived[b]) { g[b] = g[n]; delete g[n]; renamed.push(`${n}→${b}`); }
  }
  console.log(`站名正名（改用班表官方站名）：${renamed.length ? renamed.join('、') : '(無)'}`);
  const orphan = [...Object.keys(out), ...Object.keys(derived)].filter(n => !schedNames.has(n));
  console.log(`站名對不上班表的：${orphan.length ? orphan.join('、') : '(無)'}`);
}

const doc = {
  source: 'OpenStreetMap contributors — way[railway=platform／public_transport=platform／railway=platform_edge] 與 node[stop_position／railway=stop]，經 Overpass API 取得',
  license: 'ODbL 1.0（https://www.openstreetmap.org/copyright）',
  note: 'stations＝實測：該站區所有月台頂點中相距最遠的兩點（共站站區如台北的高鐵月台刻意保留）。derived＝推估：OSM 沒有月台多邊形的站，取列車停車點沿路線走「該站等的中位月台長」推出來的線段。前端把兩者都當「人在不在這座站」的判定基準，並與站等半徑取聯集，見 index.html 的 checkinJudge。',
  built_at: new Date().toISOString(),
  bbox: BBOX,
  filters: { trackNearM: TRACK_NEAR_M, stationNearM: STATION_NEAR_M, lateralM: LATERAL_M },
  maxSegmentDevM: Math.round(worst.dev),
  estLenByTier: estLen,
  stations: out,
  derived,
};
writeFileSync(OUT, JSON.stringify(doc), 'utf8');
console.log(`月台 way ${elements.length} → 貼台鐵線形 ${nearTrack} → 實測 ${Object.keys(out).length} 站`);
console.log(`頂點對線段最大偏差 ${worst.dev.toFixed(0)}m（${worst.name}）`);
console.log(`停車點推估補上 ${Object.keys(derived).length} 站${dropped.length ? `；撤掉會與鄰站互相涵蓋的 ${dropped.length} 座：${dropped.join('、')}` : ''}`);
const left = [...stations.keys()].filter(n => !out[n] && !derived[n]);
console.log(`仍無幾何、維持站等半徑的：${left.length} 座${left.length ? `（${left.join('、')}）` : ''}`);
console.log(`wrote ${OUT}`);

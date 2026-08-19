#!/usr/bin/env node
// 建「交叉點高低表」：兩條不同路線立體交叉的地方，誰在上、誰在下。
//
// 為什麼要這張表：地圖是一張 canvas，先畫的被後畫的蓋住。列車一律浮在所有軌道之上
// （2026-08-19 已修）之後，剩下的問題是「兩條交叉線各有一台車同時經過時，誰蓋誰」。
// 那是現實世界的事實，不能靠陣列順序決定——實測台北車站一天約 32% 的取樣格會遇到。
//
// 資料來源＝OSM 的 layer / bridge / tunnel 標籤。那是 OSM 專門用來表達「同一個平面位置上
// 哪條在上」的欄位，也是所有地圖算繪器判交叉疊層的依據；不是我們自己推的。
// 例：板橋新埔 捷運環狀線 layer=1~2 + bridge=viaduct，台鐵縱貫線與高鐵 layer=-2~-3 + tunnel=yes。
//
// 判「是不是真的立體交叉」不看名字看幾何：兩條線的局部走向夾角要夠大（預設 ≥25°）。
// 共線（中和新蘆線兩支線）、接軌（山線海線在竹南匯流）都是近乎平行，會被這一關擋掉——
// 那些地方本來就是同一個平面，沒有誰上誰下可言。
//
// 用法：node scripts/build_crossing_levels.mjs [--out data/rail_crossing_levels.json] [--dry]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const argv = process.argv.slice(2);
const OUT = (() => { const i = argv.indexOf('--out'); return i >= 0 ? argv[i + 1] : 'data/rail_crossing_levels.json'; })();
const DRY = argv.includes('--dry');
const NO_CACHE = argv.includes('--refresh');           // 重抓 OSM（預設吃 .cache/osm_crossings 的快取）
const CACHE_DIR = path.join(ROOT, '.cache', 'osm_crossings');

// 線形來源＝index.html 的 SYS_DEFS 實際載入的那些檔（別用 data/mrt.json，那份沒有被載入）。
// sysId 要與 SYS_DEFS 的 id 一致：畫面上要靠它認出「這台車屬於交叉口的哪一側」——
// 捷運各線用 ln.id 認（跨系統唯一），台鐵/高鐵/林鐵的班次只帶 tr.sys（一班車會跨好幾條線，
// 沒有單一 lineId 可用），所以那三個系統只認得到「系統」這一層。
const SYS_FILES = [
  ['台鐵', 'tra_sched', 'tra.json'], ['高鐵', 'thsr_sched', 'thsr_track.json'],
  ['阿里山林鐵', 'afr_sched', 'afr.json'], ['台北捷運', 'mrt', 'trtc.json'],
  ['桃園機捷', 'tymc', 'tymc.json'], ['淡海輕軌', 'ntdlrt', 'ntdlrt.json'],
  ['安坑輕軌', 'ntalrt', 'ntalrt.json'], ['三鶯線', 'sanying', 'sanying.json'],
  ['高雄捷運', 'krtc', 'krtc.json'], ['台中捷運', 'tmrt', 'tmrt.json'],
];
const SCHED_SYS = new Set(['tra_sched', 'thsr_sched', 'afr_sched']); // 這些系統的班次只認得到系統層級

const MIN_ANGLE_DEG = 25;      // 小於此角＝共線／接軌，不是立體交叉
const CLUSTER_M = 300;         // 同一對路線、這個距離內的交點併成一處
const OSM_RADIUS_M = 60;       // 向 OSM 要交叉點周邊多大範圍的軌道
const ASSIGN_MAX_M = 45;       // OSM way 距我方線形超過這個距離就不認領（理智檢查）
const BEARING_MAX_DEG = 30;    // OSM way 的走向與我方線形差超過這個角度就不算同一條
const BEARING_MARGIN = 12;     // 還要比另一條至少好這麼多度，否則棄權（分不清就不猜）

const R_LAT = 110.574, R_LON = 101.751;                       // 台灣緯度下的 km/度
const km = (a, b) => Math.hypot((a[0] - b[0]) * R_LAT, (a[1] - b[1]) * R_LON);

function loadLines() {
  const out = [];
  for (const [sys, sysId, f] of SYS_FILES) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { console.warn(`  ⚠ 讀不到 ${f}，跳過`); continue; }
    for (const ln of (j.lines || [])) {
      const pts = ln.shape || (ln.stations || []).map(s => [s.lat, s.lon]);
      if (pts && pts.length > 1) out.push({ sys, sysId, id: ln.id, name: ln.name, pts });
    }
  }
  return out;
}

// 線段相交 → 交點（含各自的段索引，之後拿來算夾角）
function segX(p, q, r, s) {
  const d = (q[1] - p[1]) * (s[0] - r[0]) - (q[0] - p[0]) * (s[1] - r[1]);
  if (Math.abs(d) < 1e-14) return null;
  const t = ((r[1] - p[1]) * (s[0] - r[0]) - (r[0] - p[0]) * (s[1] - r[1])) / d;
  const u = ((r[1] - p[1]) * (q[0] - p[0]) - (r[0] - p[0]) * (q[1] - p[1])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}
// 兩線段夾角（0–90°，公里座標下算，免得經緯度尺度不同把角度算歪）
function angleDeg(a1, a2, b1, b2) {
  const v = [(a2[0] - a1[0]) * R_LAT, (a2[1] - a1[1]) * R_LON];
  const w = [(b2[0] - b1[0]) * R_LAT, (b2[1] - b1[1]) * R_LON];
  const nv = Math.hypot(...v), nw = Math.hypot(...w);
  if (!nv || !nw) return 0;
  const c = Math.min(1, Math.abs((v[0] * w[0] + v[1] * w[1]) / (nv * nw)));
  return Math.acos(c) * 180 / Math.PI;
}
// 點到折線的最短距離（km）
function distToLine(pt, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ax = a[1] * R_LON, ay = a[0] * R_LAT, bx = b[1] * R_LON, by = b[0] * R_LAT;
    const px = pt[1] * R_LON, py = pt[0] * R_LAT;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

// 折線在某點附近的局部走向（0–180°，公里座標）。用走向分辨 OSM way 屬於哪條線——
// 台北車站那種「兩條都在地下、水平距離只有幾公尺」的地方，距離分不出來，走向可以。
function localBearing(pts, at, radiusKm = 0.12) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    if (km(mid, at) > radiusKm) continue;
    let dx = (pts[i + 1][1] - pts[i][1]) * R_LON, dy = (pts[i + 1][0] - pts[i][0]) * R_LAT;
    const L = Math.hypot(dx, dy); if (!L) continue;
    if (dy < 0 || (dy === 0 && dx < 0)) { dx = -dx; dy = -dy; }   // 方向不分正反，統一到上半平面
    sx += dx / L; sy += dy / L; n++;
  }
  if (!n) return null;
  return (Math.atan2(sy, sx) * 180 / Math.PI + 180) % 180;
}
const bearingDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

function findCrossings(lines) {
  const raw = [];
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
    const A = lines[a], B = lines[b];
    for (let i = 0; i < A.pts.length - 1; i++) for (let k = 0; k < B.pts.length - 1; k++) {
      const x = segX(A.pts[i], A.pts[i + 1], B.pts[k], B.pts[k + 1]);
      if (!x) continue;
      raw.push({ A, B, at: x, ang: angleDeg(A.pts[i], A.pts[i + 1], B.pts[k], B.pts[k + 1]) });
    }
  }
  // 同一對路線、CLUSTER_M 內併一處，夾角取該群最大值（一群裡只要有一段是真的橫越就算）
  const cl = [];
  for (const r of raw) {
    const hit = cl.find(c => c.A === r.A && c.B === r.B && km(c.at, r.at) * 1000 < CLUSTER_M);
    if (hit) { hit.n++; hit.ang = Math.max(hit.ang, r.ang); }
    else cl.push({ ...r, n: 1 });
  }
  return cl;
}

// 為什麼用 curl 不用 fetch：這台機器上 Node 的 fetch 打 overpass-api.de 一律 ETIMEDOUT／
// ECONNREFUSED（IPv4 優先也一樣），同一支查詢用 curl 卻穩定 200。這是建表用的離線工具，
// 不是出貨程式碼，所以直接用會動的那個。沒有 User-Agent 會被 Overpass 以 406 擋掉。
const UA = 'railisland-crossing-levels/1.0 (https://railisland.tw)';
async function overpass(query, tries = 3) {
  let last;
  for (let t = 0; t < tries; t++) {
    try {
      const out = execFileSync('curl', ['-s', '-m', '120', '--fail-with-body',
        '-H', `User-Agent: ${UA}`, '-X', 'POST',
        'https://overpass-api.de/api/interpreter', '--data-urlencode', `data=${query}`],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(out);
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 15000 * (t + 1))); }
  }
  throw new Error(`${(last && last.message || '').slice(0, 80)}（已重試 ${tries} 次）`);
}

// OSM 的「這條軌道在第幾層」。依 OSM 慣例，**沒有 layer 標籤就是 layer 0（地面）**，
// 所以平面路段不是「未知」而是明確的 0——地面的台鐵與高架的高鐵交叉，就是這樣判出來的。
// explicit 記「這個層號有沒有標籤背書」：兩側都是隱含 0 時不採信（見下方要求至少一側 explicit），
// 免得 OSM 漏標 tunnel 的地下段被當成地面，跟另一條隱含 0 的線比出一個假的「同高」或假的順序。
function osmLevel(t) {
  if (t.layer != null && t.layer !== '' && Number.isFinite(+t.layer)) return { v: +t.layer, explicit: true };
  if (t.bridge && t.bridge !== 'no') return { v: 1, explicit: true };
  if (t.tunnel && t.tunnel !== 'no') return { v: -1, explicit: true };
  return { v: 0, explicit: false };
}

const main = async () => {
  const lines = loadLines();
  console.log(`載入 ${lines.length} 條路線（${[...new Set(lines.map(l => l.sys))].length} 個系統）`);

  const all = findCrossings(lines);
  const cand = all.filter(c => c.ang >= MIN_ANGLE_DEG);
  console.log(`幾何交點合併後 ${all.length} 處 → 夾角 ≥${MIN_ANGLE_DEG}° 的立體交叉候選 ${cand.length} 處`);
  console.log(`（被夾角擋掉的 ${all.length - cand.length} 處是共線／接軌，同一個平面，沒有誰上誰下）\n`);

  // 一次問一批，避免對 Overpass 連發
  const rows = [], unknown = [];
  const BATCH = 8;
  for (let i = 0; i < cand.length; i += BATCH) {
    const grp = cand.slice(i, i + BATCH);
    const q = `[out:json][timeout:60];(\n` +
      grp.map(c => `way(around:${OSM_RADIUS_M},${c.at[0].toFixed(6)},${c.at[1].toFixed(6)})` +
        `[railway~"^(rail|subway|light_rail|monorail|narrow_gauge)$"];`).join('\n') +
      `\n);out geom;`;
    process.stdout.write(`  第 ${i / BATCH + 1} 批（${grp.length} 處）… `);
    const cacheFile = path.join(CACHE_DIR, `osm_${i / BATCH + 1}.json`);
    let js;
    if (!NO_CACHE && fs.existsSync(cacheFile)) { js = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); process.stdout.write('用快取 '); }
    else {
      try { js = await overpass(q); } catch (e) { console.log(`失敗：${e.message}`); continue; }
      fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(js));
      await new Promise(r => setTimeout(r, 12000)); // Overpass 免費配額只有 2 個 slot
    }
    const ways = (js.elements || []).filter(e => e.type === 'way' && e.geometry);
    console.log(`回 ${ways.length} 條 way`);

    for (const c of grp) {
      // 只看這個交叉點附近的 way 節點
      const near = ways.map(w => ({
        w, geo: w.geometry.map(g => [g.lat, g.lon]).filter(p => km(p, c.at) * 1000 <= OSM_RADIUS_M * 1.6),
      })).filter(x => x.geo.length);

      const bA = localBearing(c.A.pts, c.at), bB = localBearing(c.B.pts, c.at);
      const lvl = { A: [], B: [] };
      for (const { w, geo } of near) {
        const L = osmLevel(w.tags || {});
        const dA = Math.min(...geo.map(p => distToLine(p, c.A.pts)));
        const dB = Math.min(...geo.map(p => distToLine(p, c.B.pts)));
        if (Math.min(dA, dB) * 1000 > ASSIGN_MAX_M) continue;     // 離兩條都遠：別條線（例如站內側線）
        const bw = localBearing(geo, c.at, OSM_RADIUS_M * 1.6 / 1000);
        if (bw == null || bA == null || bB == null) continue;
        const gA = bearingDiff(bw, bA), gB = bearingDiff(bw, bB);
        const best = Math.min(gA, gB);
        if (best > BEARING_MAX_DEG) continue;                     // 走向跟兩條都不像：站內側線之類
        if (Math.abs(gA - gB) < BEARING_MARGIN) continue;         // 兩條都像：分不清就不猜
        lvl[gA < gB ? 'A' : 'B'].push(L);
      }
      const pick = arr => { // 取眾數（同一條線在交叉口可能被切成多段，層號應一致）
        if (!arr.length) return null;
        const cnt = new Map(); for (const o of arr) cnt.set(o.v, (cnt.get(o.v) || 0) + 1);
        const v = [...cnt.entries()].sort((x, y) => y[1] - x[1] || Math.abs(y[0]) - Math.abs(x[0]))[0][0];
        return { v, explicit: arr.some(o => o.v === v && o.explicit) };
      };
      const pa = pick(lvl.A), pb = pick(lvl.B);
      const la = pa && pa.v, lb = pb && pb.v;
      const tag = `${c.A.sys}${c.A.name} × ${c.B.sys}${c.B.name} @${c.at[0].toFixed(4)},${c.at[1].toFixed(4)}`;
      if (pa == null || pb == null) { unknown.push({ tag, why: `交叉口找不到對得上的 OSM 軌道（A=${la} B=${lb}）` }); continue; }
      if (la === lb) { unknown.push({ tag, why: `同高度 layer=${la}，不必排序` }); continue; }
      // 兩側都是「沒標籤所以當 0」時不會走到這（0===0 已在上一行擋掉）；
      // 但「一側隱含 0、另一側隱含 0 之外」不存在——隱含只會是 0。故此處必有至少一側 explicit。
      if (!pa.explicit && !pb.explicit) { unknown.push({ tag, why: '兩側都沒有 layer/bridge/tunnel 背書' }); continue; }
      if (c.A.sysId === c.B.sysId && SCHED_SYS.has(c.A.sysId)) {
        unknown.push({ tag, why: `同一個班表系統（${c.A.sysId}）的兩條線：班次只帶系統別、認不出是哪一條，收了會排錯` });
        continue;
      }
      rows.push({
        lat: +c.at[0].toFixed(6), lon: +c.at[1].toFixed(6),
        above: la > lb ? { id: c.A.id, sys: c.A.sysId } : { id: c.B.id, sys: c.B.sysId },
        below: la > lb ? { id: c.B.id, sys: c.B.sysId } : { id: c.A.id, sys: c.A.sysId },
        levels: { [c.A.id]: la, [c.B.id]: lb },
        explicit: { [c.A.id]: pa.explicit, [c.B.id]: pb.explicit },
        note: `${c.A.sys}${c.A.name} × ${c.B.sys}${c.B.name}`,
        angle: +c.ang.toFixed(1),
      });
    }
  }

  rows.sort((a, b) => a.note.localeCompare(b.note, 'zh-Hant') || a.lat - b.lat);
  console.log(`\n判定成功 ${rows.length} 處：`);
  for (const r of rows) console.log(`  ${r.note.padEnd(34)} ${r.above.id} 在上 / ${r.below.id} 在下  (layer ${JSON.stringify(r.levels)})`);
  if (unknown.length) {
    console.log(`\n未列入 ${unknown.length} 處：`);
    for (const u of unknown) console.log(`  ${u.tag}\n      ${u.why}`);
  }

  const doc = {
    _readme: '交叉點高低表：兩條不同路線立體交叉處誰在上。來源＝OSM layer/bridge/tunnel。' +
      'above/below 各是 {id, sys}：捷運各線用 id 認、台鐵/高鐵/林鐵只認得到 sys。' +
      '重建：node scripts/build_crossing_levels.mjs（--refresh 重抓 OSM）',
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap (layer / bridge / tunnel) via Overpass API',
    minAngleDeg: MIN_ANGLE_DEG,
    crossings: rows,
  };
  if (DRY) console.log('\n--dry：不寫檔');
  else { fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(doc, null, 1) + '\n'); console.log(`\n已寫入 ${OUT}（${rows.length} 處）`); }
};
main().catch(e => { console.error(e); process.exit(1); });

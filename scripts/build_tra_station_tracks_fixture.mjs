// 從全台 OSM 快照挑出「站區裡已經畫好、但沒被打包進出貨路網」的台鐵股道，寫成可補入的 fixture。
//
// 為什麼要有這支（F9，F6 的一般化）：build_physical_routes → pack_physical_network 只收候選路徑走過的 way，
// 全台 6899 條 railway=rail|narrow_gauge 只有 4373 條進了 network.json，2526 條沒進來
// （output/audit-0914/station-inventory.md）。F6 只手工補了 9 條乾跑證明有人要走的咽喉連接段；
// 2026-09-14 使用者裁示「當然是你把資料有的都補上去」「交通部都有資料，那我們就應該知道有，
// 怎麼會是當作沒有核實就不畫？」⇒ 站區裡 OSM 已經畫好的台鐵股道全部準備成可補入的清單。
//
// 挑選條件（四關，缺一不收）：
//   1. 不在 rail-3d/physical/network.json（已在的包含 F6 那 9 條，自動跳過）。
//   2. 是台鐵、營運中的股道——排除口徑照 output/audit-0914/crossovers.md：
//      railway 必須是 rail（narrow_gauge = 阿里山林鐵／台糖五分車）；有 gauge 就必須含 1067
//      （1435 高鐵、762 五分車、545 蹦蹦車）；usage 不得是 industrial／military／tourism／test／spillway；
//      operator／name／ref 不得命中他系統或保存鐵道（高鐵、台糖、捷運、輕軌、林鐵、中鋼、舊打狗驛、
//      國家鐵道博物館、舊山線、觀光園區）；不得是 construction／proposed／disused／abandoned／preserved。
//   3. 與出貨路網的 tra_sched way 共用至少一個 node id，**含遞移**（透過同批其他新 way 接上的也算）。
//      只認 tra_sched 的節點當種子：共用 node id 不等於同一個系統，新左營／南港那幾條 yard 是高鐵的
//      （output/audit-0914/verify-station-inventory.md 第 2 條），只從高鐵 way 接得上的一律收不進來。
//   4. 幾何任一點在任一台鐵站中心 STATION_RADIUS_M 內（站座標 data/tra.json）——站區股道，不是整條支線。
//
// 兩個獨立區段：
//   * ways   —— 上述四關全過的股道，預設要補。
//   * bridge —— 萬華–臺北隧道東正線那 30 m 的「OSM 缺口」補丁（F7），**預設不套用**，等裁定。
//     它含一條 OSM 既有但被打包丟掉的東正線 way，加一條依 TDX 官方幾何擬的橋接段（見 BRIDGE 註解）。
//
// 跑法：node scripts/build_tra_station_tracks_fixture.mjs
//   輸入 OVERPASS=（預設 output/audit-0914/overpass-B-railways.json，2026-09-14 快照，out body geom）
//   輸出 scripts/fixtures/tra-station-tracks-osm-0914.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERPASS = process.env.OVERPASS || path.join(ROOT, 'output/audit-0914/overpass-B-railways.json');
const OUT = process.env.OUT || path.join(ROOT, 'scripts/fixtures/tra-station-tracks-osm-0914.json');
const OSM_BASE = '2026-09-14T04:57:00Z';   // overpass-B-railways.fetched-at.txt
const STATION_RADIUS_M = 1000;

const M = 111320, lat0 = 23.7, kx = M * Math.cos(lat0 * Math.PI / 180);
const distM = (a, b) => Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * M);

const els = JSON.parse(fs.readFileSync(OVERPASS, 'utf8')).elements.filter(e => e.type === 'way');
const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'rail-3d/physical/network.json'), 'utf8'));
const tra = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tra.json'), 'utf8'));

// ── 台鐵站中心（同名只取一次）＋空間格
const stations = [], seenName = new Set();
for (const ln of tra.lines) for (const s of ln.stations) { if (!seenName.has(s.name)) { seenName.add(s.name); stations.push({ name: s.name, x: s.lon * kx, y: s.lat * M }); } }
const SCELL = 1200, sgrid = new Map();
for (const s of stations) { const k = Math.floor(s.x / SCELL) + ':' + Math.floor(s.y / SCELL); (sgrid.get(k) || sgrid.set(k, []).get(k)).push(s); }
function nearestStation(p) {
  const x = p.lon * kx, y = p.lat * M, R = STATION_RADIUS_M; let best = null;
  for (let gx = Math.floor((x - R) / SCELL); gx <= Math.floor((x + R) / SCELL); gx++)
    for (let gy = Math.floor((y - R) / SCELL); gy <= Math.floor((y + R) / SCELL); gy++)
      for (const s of sgrid.get(gx + ':' + gy) || []) { const d = Math.hypot(x - s.x, y - s.y); if (!best || d < best.d) best = { d, name: s.name }; }
  return best;
}

// ── 第 2 關：台鐵、營運中
const EXCL_OPERATOR = /高速鐵路|高鐵|糖業|Sugar|捷運|Metro|MRT|輕軌|Light Rail|林業|鐵道博物館|仕佳|中國鋼鐵|中鋼/;
const EXCL_NAME = /高鐵|高速鐵路|台糖|臺糖|糖廠|五分車|蹦蹦|阿里山|林鐵|林場|打狗|中鋼|舊山線|觀光|園區|博物館|試車|實驗/;
const EXCL_USAGE = new Set(['industrial', 'military', 'tourism', 'test', 'spillway']);
const EXCL_DESC = /not used|no longer|abandoned|廢線|拆除/i;
// F7 的兩條東正線 way 不進 ways：1551465832 歸 bridge 區段（要裁定），1551482234 是它的重複繪製（同起訖、2 節點），只收一條。
const BRIDGE_WAY = '1551465832', DUP_OF_BRIDGE_WAY = '1551482234';
// OSM 的 layer 與它在出貨路網裡唯一相連的 way 互相矛盾，補進去 build_rail_levels 結構上無解。
// 581275240（斗南，service=crossover，name=縱貫線，layer=1，66.6 m）在出貨路網裡只接一條 way：
// 既有側線 580149815（無 layer ⇒ rank 0），兩者共用節點 5562175274。classifyRailStructure 給
// 581275240 rank 1，於是 rail_level_crossings 在**距該共用節點 0.41 m** 處判出一個異層交叉，
// 要求 7 m 垂直淨距——同一個節點不可能既在地面又在 7 m 高。實測 build_rail_levels 的鬆弛從
// 第 200 圈起 violation 卡死在 3.46730 完全不再下降（跑到 5800 圈同一個值），不是收斂太慢。
// 用 scratchpad/f9/falsecross.mjs 掃全網：rank 不同的交叉 86 個，其中「兩條 way 直接相連」的
// 只有這 1 個，且只有它是 F9 新增的。不動模型的 8% 坡度／7 m 淨距／收斂斷言，改成不收這條。
const LAYER_CONFLICT_WAYS = new Set(['581275240']);
function rejectReason(w) {
  const t = w.tags || {};
  if (t.railway !== 'rail') return 'railway=' + t.railway;
  if (t.gauge && !String(t.gauge).split(';').includes('1067')) return 'gauge=' + t.gauge;
  if (t.usage && EXCL_USAGE.has(t.usage)) return 'usage=' + t.usage;
  for (const k of ['operator', 'operator:zh']) if (t[k] && EXCL_OPERATOR.test(t[k])) return 'operator';
  for (const k of ['name', 'name:zh', 'ref', 'network']) if (t[k] && EXCL_NAME.test(t[k])) return 'name';
  if (t.construction || t.proposed || t.disused || t.abandoned || t['railway:preserved'] === 'yes') return 'construction/disused';
  if (t.description && EXCL_DESC.test(t.description)) return 'description';
  // 2026-09-14 裁示：「不得把施工線、地面保存線、未核實用途的 yard 隨手當現役客運線」。
  // 沒有 service 標籤的貨運／港線支線（臺中港線、花蓮臨港線）補進去會被 topology 的 isTrack() 當成一般正線，
  // 不受 track_directions.mjs 的 YARD_CAP_M 限制 ⇒ 不收。帶 service=spur 的蘇澳港線那 4 條照舊收（受 yard 規則管）。
  if (!t.service && (t['railway:traffic_mode'] === 'freight' || /港線|臨港/.test(t.name || ''))) return '貨運／港線支線（無 service，會被當一般正線）';
  if (LAYER_CONFLICT_WAYS.has(String(w.id))) return 'layer 與直接相連的既有 way 矛盾（build_rail_levels 無解）';
  if (String(w.id) === DUP_OF_BRIDGE_WAY) return '重複繪製（與 ' + BRIDGE_WAY + ' 同起訖）';
  if (String(w.id) === BRIDGE_WAY) return '歸入 bridge 區段（待裁定）';
  return null;
}

const inNet = new Set(net.ways.map(w => String(w.id)));
const rejects = {};
const cands = [];
for (const w of els) {
  if (inNet.has(String(w.id))) continue;
  const r = rejectReason(w); if (r) { rejects[r.split('=')[0]] = (rejects[r.split('=')[0]] || 0) + 1; continue; }
  let best = null; for (const p of w.geometry) { const b = nearestStation(p); if (b && (!best || b.d < best.d)) best = b; }
  if (!best || best.d > STATION_RADIUS_M) { rejects.farFromStation = (rejects.farFromStation || 0) + 1; continue; }
  cands.push({ w, station: best.name, stationDistM: Math.round(best.d) });
}

// ── 第 3 關：與 tra_sched 共用節點（遞移閉包）
const traNodes = new Set();
for (const w of net.ways) if (w.system === 'tra_sched') for (const n of w.nodes) traNodes.add(String(n));
const byId = new Map(cands.map(c => [String(c.w.id), c])), pool = new Set(byId.keys()), accepted = [];
for (let changed = true; changed;) {
  changed = false;
  for (const id of [...pool]) {
    const c = byId.get(id);
    if (!c.w.nodes.some(n => traNodes.has(String(n)))) continue;
    accepted.push(c); pool.delete(id); for (const n of c.w.nodes) traNodes.add(String(n)); changed = true;
  }
}
rejects.notConnectedToTra = pool.size;

// 非客運性質的提示（貨運支線／港線：tags 是 railway=rail 沒有 service，補進去會被當一般正線走，
// 不受 track_directions.mjs 的 yard 規則限制——列出來讓人決定，不在這裡改它的標籤）。
const freightHint = w => !w.tags?.service && (w.tags?.['railway:traffic_mode'] === 'freight' || /港線|臨港/.test(w.tags?.name || ''));

const lenOf = w => { let L = 0; for (let i = 0; i + 1 < w.geometry.length; i++) L += distM(w.geometry[i], w.geometry[i + 1]); return L; };
const shape = c => ({ id: String(c.w.id), station: c.station, stationDistM: c.stationDistM, lengthM: Math.round(lenOf(c.w)), tags: c.w.tags, nodes: c.w.nodes.map(String), geometry: c.w.geometry, ...(freightHint(c.w) ? { nonPassengerHint: '貨運／港線支線：無 service 標籤，補進去會被當一般正線，不受 yard 規則限制' } : {}) });

// ── bridge 區段（F7，預設不套用）
// 證據：TDX GIS v3 實體路線在 8114403662 → 5244930008 這 30.2 m 內**全程有兩條平行股**（WL#5 與 WL#3，
// 間距 4.1–5.1 m，每 2 m 取樣 16 點全部命中）。兩個端點分屬不同股（8114403662 在 WL#5 上、5244930008 在
// WL#3 上），所以這條橋接段實際上是「在兩股之間斜渡」而不是東正線的直線延續；沿線任一點到最近 TDX 股
// 的距離 ≤2.5 m。中間不補點（TDX 沒有一條股同時通過這兩個節點，補點等於自己畫道岔），端點座標沿用 OSM。
const osmById = new Map(els.map(w => [String(w.id), w]));
const nodeCoord = new Map();
for (const w of els) w.nodes.forEach((n, i) => { if (!nodeCoord.has(String(n))) nodeCoord.set(String(n), w.geometry[i]); });
const bridgeSrc = osmById.get(BRIDGE_WAY);
const bridge = {
  note: '萬華–臺北隧道東正線的 OSM 缺口（F7，26 場互穿）。預設不套用，等主對話裁定；套用法見 extend_tra_station_tracks.mjs 的 SECTION=bridge。',
  ways: [
    { ...shape({ w: bridgeSrc, station: '臺北', stationDistM: Math.round(Math.min(...bridgeSrc.geometry.map(p => nearestStation(p).d))) }), why: 'OSM 既有的東正線末段，被打包丟掉；與它同起訖的 1551482234 是重複繪製，只收這一條（3 節點版）。' },
    {
      id: 'f9-taipei-east-bridge-0914', station: '臺北', stationDistM: 0,
      lengthM: Math.round(distM(nodeCoord.get('8114403662'), nodeCoord.get('5244930008'))),
      tags: { ...bridgeSrc.tags, source: 'TDX GIS v3 V3/Map/Rail/Network/Line/OperatorCode/TRA（交通部，政府資料開放授權條款-1.0）', 'fixme': '本段非 OSM 既有 way，是依官方 TDX 幾何擬的補缺；上游修好後應以 OSM way 取代' },
      nodes: ['8114403662', '5244930008'],
      geometry: [nodeCoord.get('8114403662'), nodeCoord.get('5244930008')],
      synthetic: true,
      evidence: 'TDX 在這 30.2 m 內全程兩股（WL#5／WL#3，間距 4.1–5.1 m，每 2 m 取樣 16/16 命中）；本段沿線到最近 TDX 股 ≤2.5 m。兩端點在 TDX 分屬不同股 ⇒ 功能上是斜渡不是直線延續。',
    },
  ],
};

// ── 節點標籤（補入的 way 上的 OSM 節點標籤；overpass-B 只有 way，節點標籤取 overpass-C 停車點快照）
const nodeTags = {};
try {
  const stopEls = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/audit-0914/overpass-C-stopnodes.json'), 'utf8')).elements;
  const wanted = new Set(); for (const c of accepted) for (const n of c.w.nodes) wanted.add(String(n));
  for (const w of bridge.ways) for (const n of w.nodes) wanted.add(String(n));
  for (const e of stopEls) if (e.type === 'node' && wanted.has(String(e.id)) && e.tags) nodeTags[String(e.id)] = e.tags;
} catch { /* 沒有停車點快照就留空，extend 端只補不改 */ }

const byService = {};
for (const c of accepted) { const k = c.w.tags?.service || '(正線／無 service)'; (byService[k] = byService[k] || { ways: 0, lengthM: 0 }); byService[k].ways++; byService[k].lengthM += lenOf(c.w); }
for (const v of Object.values(byService)) v.lengthM = Math.round(v.lengthM);
const byStation = {};
for (const c of accepted) byStation[c.station] = (byStation[c.station] || 0) + 1;

const doc = {
  version: 1,
  source: 'OpenStreetMap / Overpass（way 本體 out body geom；節點標籤取 overpass-C 停車點快照）',
  license: 'ODbL 1.0',
  osmBase: OSM_BASE,
  generator: 'scripts/build_tra_station_tracks_fixture.mjs',
  basis: `F6（tra-station-throats-osm-0914.json，9 條）的一般化：不再只挑乾跑證明要走的幾條，改成把「站區 ${STATION_RADIUS_M} m 內、OSM 已畫、屬台鐵營運股道、且能（遞移）接回出貨路網 tra_sched」的 way 全部列出。2026-09-14 使用者裁示「當然是你把資料有的都補上去」。路徑搜尋端仍沿用 scripts/lib/track_directions.mjs 的 yard 規則（沒有純正線順向路徑才准走、一條路徑 yard 總長 ≤ YARD_CAP_M），所以補進來的站場股道不會自動變成現役客運線。2026-09-14 同一裁示的另一半「不得把施工線、地面保存線、未核實用途的 yard 隨手當現役客運線」⇒ 沒有 service 標籤的貨運／港線支線（臺中港線 89697472／106915416、花蓮臨港線 693144762／693143447／693144763，合計 5 條 6 771 m）不收：它們少了 service 標籤，補進去會被 isTrack() 當一般正線、不受 YARD_CAP_M 限制，等同把未核實用途的貨運線升格成現役客運線；帶 service=spur 的蘇澳港線 4 條不在此列，照舊收。另排除 581275240（斗南 crossover，OSM layer=1 與它在出貨路網裡唯一相連的既有側線 580149815 無 layer 矛盾，距共用節點 0.41 m 處被判異層交叉、要求 7 m 淨距 ⇒ build_rail_levels 的鬆弛 violation 從第 200 圈起卡死在 3.4673 不再下降），理由與掃描方法見 LAYER_CONFLICT_WAYS 註解。`,
  selection: { stationRadiusM: STATION_RADIUS_M, rejects, candidates: cands.length, accepted: accepted.length },
  totals: { ways: accepted.length, lengthM: Object.values(byService).reduce((a, v) => a + v.lengthM, 0), stations: Object.keys(byStation).length, byService, byStationTop: Object.entries(byStation).sort((a, b) => b[1] - a[1]).slice(0, 20) },
  ways: accepted.sort((a, b) => String(a.w.id).localeCompare(String(b.w.id))).map(shape),
  bridge,
  nodeTags,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(`候選 ${cands.length} → 收 ${accepted.length} 條、${doc.totals.lengthM} m、${doc.totals.stations} 站；bridge 區段 ${bridge.ways.length} 條（預設不套用）→ ${path.relative(ROOT, OUT)}`);
console.log('  分類：' + Object.entries(byService).map(([k, v]) => `${k} ${v.ways}條/${v.lengthM}m`).join('，'));
console.log('  排除：' + Object.entries(rejects).map(([k, v]) => `${k} ${v}`).join('，'));
console.log('  站別 top10：' + doc.totals.byStationTop.slice(0, 10).map(([s, n]) => s + ' ' + n).join('，'));
console.log('  貨運／港線提示 ' + doc.ways.filter(w => w.nonPassengerHint).length + ' 條：' + doc.ways.filter(w => w.nonPassengerHint).map(w => `${w.id}(${w.tags.name || ''},${w.lengthM}m)`).join(' '));

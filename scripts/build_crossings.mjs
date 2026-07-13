#!/usr/bin/env node
// 台鐵平交道公開資料 → 投影到 data/tra.json 既有線形 → 產出 data/crossings.json
// 重建本檔輸出後,要再跑 enrich_crossings_osm.mjs 補 tracks/elec 欄位(OSM 推算)
// 資料源:交通部台鐵局「平交道公開資料」XML
//   https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/e3ad2d341b2143b0a5d3db8da7be4467
// 欄位:NAME(名稱) LINE(線別,中文) TYPE(種類) LOC(縣市,舊行政區名) POS("緯度, 經度" WGS84;約半數為 NULL)
// 用法:node scripts/build_crossings.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'scripts/.crossings_cache');
const CACHE_FILE = path.join(CACHE_DIR, 'raw_crossings.xml');
const OSM_CACHE_FILE = path.join(CACHE_DIR, 'osm_level_crossings.json');
const SOURCE_URL = 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/e3ad2d341b2143b0a5d3db8da7be4467';

// OSM Overpass:台灣本島 bbox 的 railway=level_crossing 節點,補官方無座標缺漏
const OVERPASS_EPS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// 台灣本島 (south,west,north,east):涵蓋屏東枋寮以南~基隆、宜花東海岸;離島無台鐵故不含
const TW_BBOX = '21.85,120.00,25.35,122.10';
const SNAP_MAX_M = 30;      // OSM 節點離最近 tra.json 線形 ≤ 此距離才收(>30m 視為非本網路)
const DEDUP_TRA_DM = 60;    // 對官方筆:同 lnId 且 |Δd|<此值(m) 視為同一平交道
const DEDUP_TRA_GEOM_M = 40;// 對官方筆:raw 座標(任一線)在此半徑(m)內亦視為重複(防平行線 lnId 不一致漏抓)
const CLUSTER_DM = 40;      // OSM 內部:同 lnId 且 |Δd|<此值(m) 聚類成一筆(雙軌常拆兩節點)
// 2026-07-13 使用者裁決:平交道回歸純官方資料——台鐵官方現役 415 處與 dataset 帶座標筆數恰吻合
// (無座標 386 筆=已裁撤/立體化),OSM 聯集反而混入非台鐵管理道口。OSM 邏輯保留,要重開加 --with-osm
const WITH_OSM = process.argv.includes('--with-osm');

const R = 6371, toR = Math.PI / 180;
function haversineKm(a, b) { // a,b: [lat,lon]
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const la1 = a[0] * toR, la2 = b[0] * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function cumOf(shape) { // shape: [[lat,lon],...] -> 累積 haversine 弧長(km),與 index.html 的 ensureCum() 同算法
  const c = [0];
  for (let i = 1; i < shape.length; i++) c[i] = c[i - 1] + haversineKm(shape[i - 1], shape[i]);
  return c;
}
// 點投影到折線(平面近似求垂足,haversine 量實距,與 build_tdx.mjs 的 project() 同手法):
// 回傳 {dist(km,離線距離), s(沿線弧長km), foot:[lat,lon]}
function projectPoint(pt, shape, cum) {
  let best = { dist: Infinity, s: 0, foot: null };
  for (let j = 0; j < shape.length - 1; j++) {
    const a = shape[j], b = shape[j + 1];
    const k = Math.cos(a[0] * toR);
    const vx = (b[1] - a[1]) * k, vy = b[0] - a[0];
    const px = (pt[1] - a[1]) * k, py = pt[0] - a[0];
    const L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    const foot = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dd = haversineKm(pt, foot);
    if (dd < best.dist) best = { dist: dd, s: cum[j] + haversineKm(a, foot), foot };
  }
  return best;
}

// ─────────────── 1. 下載/快取原始 XML ───────────────
async function fetchXml() {
  if (existsSync(CACHE_FILE)) {
    console.log(`(cache hit ${CACHE_FILE})`);
    return readFileSync(CACHE_FILE, 'utf8');
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`downloading ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(CACHE_FILE, buf);
  return buf.toString('utf8');
}

// ─────────────── 1b. 下載/快取 OSM Overpass level_crossing 節點 ───────────────
async function fetchOsm() {
  if (existsSync(OSM_CACHE_FILE)) {
    console.log(`(cache hit ${OSM_CACHE_FILE})`);
    return JSON.parse(readFileSync(OSM_CACHE_FILE, 'utf8'));
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  // level_crossing(車道)+ crossing(行人)一併抓,行人只計數不納入;
  // 對每個節點反查通過的 highway way 取道路名(way body 含 nodes[] 供對應節點)。
  const query = `[out:json][timeout:300];
(
  node["railway"="level_crossing"](${TW_BBOX});
  node["railway"="crossing"](${TW_BBOX});
)->.xings;
.xings out body;
way(bn.xings)["highway"];
out body;`;
  const body = new URLSearchParams({ data: query }).toString();
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = OVERPASS_EPS[attempt % OVERPASS_EPS.length];
    try {
      console.log(`querying Overpass ${ep.split('/')[2]} (attempt ${attempt + 1}) ...`);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'rail-crossings/1.0' },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      writeFileSync(OSM_CACHE_FILE, JSON.stringify(json));
      return json;
    } catch (e) {
      last = e;
      console.log(`  失敗 ${e.message};退避重試`);
      await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
    }
  }
  throw last;
}

// ─────────────── 2. 解析 XML ───────────────
function parseNodes(xml) {
  const text = xml.replace(/^﻿/, ''); // 去 UTF-8 BOM
  const nodes = [];
  const field = (block, tag) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
    return m ? m[1].trim() : '';
  };
  for (const m of text.matchAll(/<NODE>([\s\S]*?)<\/NODE>/g)) {
    const block = m[1];
    const posRaw = field(block, 'POS');
    let lat = null, lon = null;
    if (posRaw && posRaw !== 'NULL') {
      const parts = posRaw.split(',').map(s => Number(s.trim()));
      if (parts.length === 2 && parts.every(Number.isFinite)) [lat, lon] = parts;
    }
    nodes.push({
      name: field(block, 'NAME'),
      line: field(block, 'LINE'),
      type: field(block, 'TYPE'),
      county: field(block, 'LOC'),
      lat, lon,
    });
  }
  return nodes;
}

// ─────────────── 3. LINE(XML 中文線別)→ tra.json lnId 映射表 ───────────────
// 「縱貫線」為官方通稱,涵蓋竹南-彰化間的山線/海線兩並行路廊,XML 未細分,故候選含四段;
// 「台中線」是山線的官方正式路線名(竹南-彰化經台中);成追線(chengzhui,追分↔成功)夾在山海線之間,
// 兩者都可能收錄其上的平交道,一併列為候選讓最近距離決定。
// 「深澳支線」(瑞芳→深澳,舊貨運線)與現行深澳線(SHENAO,瑞芳-海科館-八斗子)在瑞芳-海科館段共用路廊,
// 故一併嘗試投影,實際採用與否以 snapDist 判定(見稽核報告)。
const LINE_MAP = {
  '縱貫線': ['縱貫線北段', '山線', '海線', '縱貫線南段', 'chengzhui'],
  '台中線': ['山線', 'chengzhui'],
  '台東線': ['臺東線'],
  '屏東線': ['屏東線'],
  '宜蘭線': ['宜蘭線'],
  '集集線': ['JIJI'],
  '南迴線': ['南迴線'],
  '北迴線': ['北迴線'],
  '內灣線': ['NEIWAN', 'LIUJIA'],
  '深澳線': ['SHENAO'],
  '深澳支線': ['SHENAO'],
  '平溪線': ['PINGXI'],
};
// 港區側線/專用側線/特種支線/未分類:tra.json(現行客運路網)無對應線形,排除不投影。
const EXCLUDED_LINES = new Set([
  '高雄港線', '林口線', '台中港線', '神岡特種支線', '基隆港線', '花蓮港線',
  '東港特種支線', '屏東特種支線', '蘇澳港線', '第一臨港線',
  '中興一號特種支線', '中興二號特種支線', '其他',
]);

// ─────────────── main ───────────────
async function main() {
  const xml = await fetchXml();
  const all = parseNodes(xml);
  const withPos = all.filter(n => n.lat != null);
  console.log(`XML 節點總數 ${all.length},含座標 ${withPos.length}`);

  const tra = JSON.parse(readFileSync(path.join(ROOT, 'data/tra.json'), 'utf8'));
  const lineById = new Map(tra.lines.map(l => [l.id, l]));
  const cumCache = new Map(); // lnId -> cum array
  const cumOfLine = id => {
    if (!cumCache.has(id)) cumCache.set(id, cumOf(lineById.get(id).shape));
    return cumCache.get(id);
  };

  const matched = [];
  const excluded = []; // {name, line, county, reason, diag?}
  const allLnIds = tra.lines.map(l => l.id);

  for (const n of withPos) {
    const pt = [n.lat, n.lon];
    if (EXCLUDED_LINES.has(n.line)) {
      // 2026-07-13 使用者裁決(修正前案):貨運支線(台中港線等)、已停用線(高雄港線/林口線等)
      // 不在本圖模擬路網上,底下沒有畫出的軌道,原始座標標點會變成一串浮在空地/道路上的記號,
      // 看起來像明顯錯誤(使用者實測回報台中港站左邊那一串)。這些道口也無班次預測。故不上圖,
      // 僅記入 excluded 稽核清單。要重開就把這批改回 matched.push(noSched)。
      excluded.push({ name: n.name, line: n.line, county: n.county, reason: '貨運/專用/已停用線,不在模擬路網(使用者裁決不上圖)' });
      continue;
    }
    const candidates = LINE_MAP[n.line];
    if (!candidates) {
      // LINE 對應不到既有映射表:退回全網最近線,並記入排除清單以供人工複核
      let diag = null;
      for (const id of allLnIds) {
        const r = projectPoint(pt, lineById.get(id).shape, cumOfLine(id));
        if (!diag || r.dist < diag.dist) diag = { lnId: id, dist: r.dist };
      }
      excluded.push({ name: n.name, line: n.line, county: n.county, reason: 'LINE 欄位不在映射表中(未知線別)', diagLnId: diag.lnId, diagDistM: +(diag.dist * 1000).toFixed(1) });
      continue;
    }
    let best = null;
    for (const id of candidates) {
      const ln = lineById.get(id);
      if (!ln) continue;
      const r = projectPoint(pt, ln.shape, cumOfLine(id));
      if (!best || r.dist < best.dist) best = { lnId: id, ...r };
    }
    // 投影垂足離原始座標過遠(>50m):候選線群不含實際路廊(如八股頭/光復路實在舊山線、
    // 中正路投影退化到線首 d=0),垂足會把記號拉到錯的位置。此時垂足不可信,顯示點改回官方原始座標
    // (位置就正確);d/snapDistM 仍保留供記錄與粗略預測。閾值 50m:正常筆 snapDist 最大 28m,乾淨分隔。
    const snapM = +(best.dist * 1000).toFixed(1);
    const badProj = snapM > 50;
    matched.push({
      name: n.name,
      type: n.type,
      county: n.county,
      lnId: best.lnId,
      d: +best.s.toFixed(4),
      lat: badProj ? +n.lat.toFixed(6) : +best.foot[0].toFixed(6),
      lon: badProj ? +n.lon.toFixed(6) : +best.foot[1].toFixed(6),
      rawLat: +n.lat.toFixed(6),
      rawLon: +n.lon.toFixed(6),
      snapDistM: snapM,
      ...(badProj ? { projFallback: true } : {}), // 稽核旗標:此筆用原始座標而非投影垂足
      src: 'tra',
      xmlLine: n.line, // 稽核用:原始 XML LINE 中文欄位(多候選線群組要看它與 lnId 是否合理對應);不寫入 crossings.json
    });
  }

  // ─────────────── 4. OSM 補缺(預設停用,--with-osm 才跑;見檔頭 WITH_OSM 註解) ───────────────
  let osmMerged = [], osmSnapped = [], levelNodes = [], pedNodes = [];
  let matchedToTra = 0, traMatchedFlag = new Set(), crossValidDiffs = [];
  if (WITH_OSM) {
  const osmJson = await fetchOsm();
  const osmElements = osmJson.elements || [];
  const osmNodes = osmElements.filter(e => e.type === 'node');
  levelNodes = osmNodes.filter(e => e.tags && e.tags.railway === 'level_crossing');
  pedNodes = osmNodes.filter(e => e.tags && e.tags.railway === 'crossing');
  console.log(`\nOSM 原始:level_crossing ${levelNodes.length} 節點,crossing(行人,不納入) ${pedNodes.length} 節點`);

  // 節點 id → 道路名:反查通過此節點的 highway way,優先取有 name 的
  const roadName = new Map();
  for (const w of osmElements) {
    if (w.type !== 'way' || !w.tags || !w.tags.highway || !Array.isArray(w.nodes)) continue;
    const nm = w.tags.name || w.tags['name:zh'] || '';
    if (!nm) continue;
    for (const nid of w.nodes) if (!roadName.has(nid)) roadName.set(nid, nm);
  }

  // 每個 level_crossing 節點投影到全網 16 線,取最近線,snapDist ≤ 30m 才收
  let droppedFar = 0;
  for (const nd of levelNodes) {
    const pt = [nd.lat, nd.lon];
    let best = null;
    for (const id of allLnIds) {
      const r = projectPoint(pt, lineById.get(id).shape, cumOfLine(id));
      if (!best || r.dist < best.dist) best = { lnId: id, ...r };
    }
    if (best.dist * 1000 > SNAP_MAX_M) { droppedFar++; continue; }
    osmSnapped.push({
      id: nd.id, lnId: best.lnId, d: best.s,
      foot: best.foot, raw: pt, snapDistM: +(best.dist * 1000).toFixed(1),
      name: nd.tags.name || roadName.get(nd.id) || '', // 優先平交道節點自身 name(較準,常是正式名稱),其次通過的道路名
    });
  }
  console.log(`OSM 投影 tra.json:≤${SNAP_MAX_M}m 收 ${osmSnapped.length},>${SNAP_MAX_M}m 淘汰 ${droppedFar}`);

  // 對官方 394 去重:同 lnId 且 |Δd|<60m,或 raw 座標在任一官方筆 40m 內 → matched(視為同一)
  const officialByLn = new Map();
  for (const m of matched) {
    if (!officialByLn.has(m.lnId)) officialByLn.set(m.lnId, []);
    officialByLn.get(m.lnId).push(m);
  }
  const osmNew = []; // (matchedToTra/traMatchedFlag/crossValidDiffs 已提升到 if 外,尾端稽核統計要用)
  for (const o of osmSnapped) {
    let hit = null;
    const sameLn = officialByLn.get(o.lnId) || [];
    for (const m of sameLn) {
      if (Math.abs(m.d - o.d) * 1000 < DEDUP_TRA_DM) { hit = m; break; }
    }
    if (!hit) { // 幾何後援:平行線 lnId 不一致時,用 raw 座標鄰近判定
      for (const m of matched) {
        if (haversineKm(o.raw, [m.rawLat, m.rawLon]) * 1000 < DEDUP_TRA_GEOM_M) { hit = m; break; }
      }
    }
    if (hit) {
      matchedToTra++;
      traMatchedFlag.add(hit);
      crossValidDiffs.push(haversineKm(o.raw, [hit.rawLat, hit.rawLon]) * 1000);
      continue;
    }
    osmNew.push(o);
  }
  console.log(`OSM 對官方去重:matched ${matchedToTra}(覆蓋官方 ${traMatchedFlag.size}/${matched.length}),新增候選 ${osmNew.length}`);

  // OSM 內部聚類:同 lnId 且 |Δd|<40m 併一筆,座標取聚類 raw 重心後重新投影
  osmNew.sort((a, b) => a.lnId === b.lnId ? a.d - b.d : a.lnId.localeCompare(b.lnId));
  const clusters = [];
  for (const o of osmNew) {
    const last = clusters[clusters.length - 1];
    if (last && last.lnId === o.lnId && Math.abs(last._lastD - o.d) * 1000 < CLUSTER_DM) {
      last.members.push(o); last._lastD = o.d;
    } else {
      clusters.push({ lnId: o.lnId, members: [o], _lastD: o.d });
    }
  }
  const lineShortName = new Map(tra.lines.map(l => [l.id, l.name.split('（')[0]])); // 「山線（竹南–彰化）」→「山線」
  const unnamedSeq = new Map(); // lnId -> 序號計數器(clusters 已依 lnId,d 排序,序號沿線遞增)
  for (const c of clusters) {
    // 重心(raw 座標平均)→ 重新投影該線取 foot/d;名稱取成員中第一個有名者,全無名則「平交道」+線名+序號
    const mlat = c.members.reduce((s, m) => s + m.raw[0], 0) / c.members.length;
    const mlon = c.members.reduce((s, m) => s + m.raw[1], 0) / c.members.length;
    const ln = lineById.get(c.lnId);
    const r = projectPoint([mlat, mlon], ln.shape, cumOfLine(c.lnId));
    const named = c.members.find(m => m.name);
    let name;
    if (named) {
      name = named.name;
    } else {
      const seq = (unnamedSeq.get(c.lnId) || 0) + 1;
      unnamedSeq.set(c.lnId, seq);
      name = `平交道(${lineShortName.get(c.lnId) || c.lnId} ${seq})`;
    }
    osmMerged.push({
      name,
      type: '平交道',
      county: '', // 稍後用最近官方筆補
      lnId: c.lnId,
      d: +r.s.toFixed(4),
      lat: +r.foot[0].toFixed(6),
      lon: +r.foot[1].toFixed(6),
      rawLat: +mlat.toFixed(6),
      rawLon: +mlon.toFixed(6),
      snapDistM: +(r.dist * 1000).toFixed(1),
      src: 'osm',
      _clusterN: c.members.length,
    });
  }
  console.log(`OSM 內部聚類:${osmNew.length} 候選 → ${osmMerged.length} 筆新增`);

  // county:用最近官方筆(raw 座標 haversine)的 county 補;縣市地理連續,鄰近平交道縣市幾乎必同
  for (const rec of osmMerged) {
    let nc = null;
    for (const m of matched) {
      const dd = haversineKm([rec.rawLat, rec.rawLon], [m.rawLat, m.rawLon]);
      if (!nc || dd < nc.dd) nc = { dd, county: m.county };
    }
    rec.county = nc ? nc.county : '';
  }
  } else {
    console.log('\nOSM 補缺:停用(純官方資料;需要時 node scripts/build_crossings.mjs --with-osm)');
  }

  const merged = matched.concat(osmMerged);
  merged.sort((a, b) => a.lnId === b.lnId ? a.d - b.d : a.lnId.localeCompare(b.lnId));

  const cleanOut = merged.map(({ xmlLine, _clusterN, ...rec }) => rec); // 稽核欄位不寫入輸出
  const out = {
    system: '台鐵平交道',
    source: '交通部台鐵局「平交道公開資料」' + (osmMerged.length ? ' + OpenStreetMap (ODbL)' : ''),
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source_notes: `官方 XML 共 ${all.length} 筆,含座標 ${withPos.length} 筆(src:tra;與台鐵官方公布現役平交道數一致,無座標 ${all.length - withPos.length} 筆為已裁撤/立體化)。` +
      (osmMerged.length ? `另以 OpenStreetMap (Overpass) railway=level_crossing 節點投影 data/tra.json 線形(≤${SNAP_MAX_M}m)補缺 ${osmMerged.length} 筆(src:osm),` +
        `對官方去重、OSM 內部聚類雙軌;OSM 筆命名取通過道路名(無名者「平交道」),縣市取最近官方筆。` : '') +
      `座標投影取沿線位置(d,km,haversine 弧長,算法與站點 d 一致);投影垂足離原點 >50m 的 ${cleanOut.filter(c => c.projFallback).length} 筆` +
      `(候選線不含實際路廊,如八股頭/光復路實在舊山線)改用官方原始座標標點。貨運/專用/已停用線平交道不在模擬路網上、` +
      `底下無軌道,不上圖(見 audit excluded)。合計 ${cleanOut.length} 筆。`,
    crossings: cleanOut,
  };
  writeFileSync(path.join(ROOT, 'data/crossings.json'), JSON.stringify(out));

  // ─────────────── console 統計(供稽核報告引用) ───────────────
  const pctOf = arr => { const s = [...arr].sort((a, b) => a - b); return p => s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const traDists = matched.filter(m => m.snapDistM != null).map(m => m.snapDistM);
  const osmDists = osmMerged.map(m => m.snapDistM);
  const tp = pctOf(traDists), op = pctOf(osmDists);
  console.log(`\n=== 合計 ${merged.length} 筆(官方 ${matched.length} + OSM ${osmMerged.length}) ===`);
  console.log(`官方 snapDist(m): 中位 ${tp(0.5)}  p90 ${tp(0.9)}  max ${Math.max(...traDists)}`);
  if (osmDists.length) console.log(`OSM  snapDist(m): 中位 ${op(0.5)}  p90 ${op(0.9)}  max ${Math.max(...osmDists)}`);
  const cvSorted = [...crossValidDiffs].sort((a, b) => a - b);
  if (cvSorted.length) console.log(`交叉驗證(OSM命中官方的座標偏差 m): 中位 ${cvSorted[cvSorted.length >> 1].toFixed(1)}  p90 ${cvSorted[Math.floor(cvSorted.length * 0.9)].toFixed(1)}  覆蓋率 ${traMatchedFlag.size}/${matched.length} (${(100 * traMatchedFlag.size / matched.length).toFixed(1)}%)`);

  // 可疑清單:聚類後仍與同線鄰筆 <80m、無名筆、snapDist 25–30m 邊緣筆
  let nearNbr = 0;
  for (let i = 1; i < merged.length; i++) if (merged[i].lnId && merged[i].lnId === merged[i - 1].lnId && Math.abs(merged[i].d - merged[i - 1].d) * 1000 < 80) nearNbr++;
  const unnamed = osmMerged.filter(m => m.name.startsWith('平交道(')).length;
  const edgeSnap = osmMerged.filter(m => m.snapDistM >= 25).length;
  console.log(`可疑:同線<80m 鄰筆對 ${nearNbr};OSM 無名筆 ${unnamed}/${osmMerged.length};OSM snapDist 25–30m 邊緣 ${edgeSnap}`);

  writeFileSync(path.join(CACHE_DIR, 'audit_data.json'), JSON.stringify({
    matched, excluded, osmMerged, osmSnappedCount: osmSnapped.length,
    levelNodes: levelNodes.length, pedNodes: pedNodes.length,
    matchedToTra, coverage: traMatchedFlag.size, crossValidDiffs,
    totalAll: all.length, totalWithPos: withPos.length, total: merged.length,
  }, null, 2));
  console.log(`\n稽核用中繼資料寫入 ${path.join(CACHE_DIR, 'audit_data.json')}`);
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });

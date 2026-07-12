#!/usr/bin/env node
// 台鐵平交道公開資料 → 投影到 data/tra.json 既有線形 → 產出 data/crossings.json
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
const SOURCE_URL = 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/e3ad2d341b2143b0a5d3db8da7be4467';

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
      // 診斷用:仍算出全網最近線,供稽核報告判斷是否真的無關
      let diag = null;
      for (const id of allLnIds) {
        const r = projectPoint(pt, lineById.get(id).shape, cumOfLine(id));
        if (!diag || r.dist < diag.dist) diag = { lnId: id, dist: r.dist };
      }
      excluded.push({ name: n.name, line: n.line, county: n.county, reason: '港區/專用/特種支線/未分類,無對應現行線形', diagLnId: diag.lnId, diagDistM: +(diag.dist * 1000).toFixed(1) });
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
    matched.push({
      name: n.name,
      type: n.type,
      county: n.county,
      lnId: best.lnId,
      d: +best.s.toFixed(4),
      lat: +best.foot[0].toFixed(6),
      lon: +best.foot[1].toFixed(6),
      rawLat: +n.lat.toFixed(6),
      rawLon: +n.lon.toFixed(6),
      snapDistM: +(best.dist * 1000).toFixed(1),
      xmlLine: n.line, // 稽核用:原始 XML LINE 中文欄位(多候選線群組要看它與 lnId 是否合理對應);不寫入 crossings.json
    });
  }

  matched.sort((a, b) => a.lnId === b.lnId ? a.d - b.d : a.lnId.localeCompare(b.lnId));

  const out = {
    system: '台鐵平交道',
    source: '交通部台鐵局「平交道公開資料」',
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source_notes: `XML 共 ${all.length} 筆,含座標 ${withPos.length} 筆;座標依 LINE 欄位對應 data/tra.json 線形投影取沿線位置(d,km,haversine 弧長,算法與站點 d 一致),` +
      `港區側線/專用側線/特種支線/未分類線別(無對應現行客運線形)予以排除;完整排除清單與可疑筆數見 build_crossings.mjs 執行輸出。`,
    crossings: matched.map(({ xmlLine, ...rec }) => rec), // xmlLine 只供稽核,輸出檔不含
  };
  writeFileSync(path.join(ROOT, 'data/crossings.json'), JSON.stringify(out));

  // ─────────────── console 統計(供稽核報告引用) ───────────────
  const dists = matched.map(m => m.snapDistM).sort((a, b) => a - b);
  const pct = p => dists[Math.min(dists.length - 1, Math.floor(dists.length * p))];
  console.log(`\n匹配成功 ${matched.length} 筆,排除 ${excluded.length} 筆(含座標但無法對應線形)`);
  console.log(`snapDist(m): 中位數 ${pct(0.5).toFixed(1)}  p90 ${pct(0.9).toFixed(1)}  max ${dists[dists.length - 1].toFixed(1)}`);
  const suspicious = matched.filter(m => m.snapDistM > 100);
  console.log(`snapDist > 100m: ${suspicious.length} 筆`);

  writeFileSync(path.join(CACHE_DIR, 'audit_data.json'), JSON.stringify({ matched, excluded, suspicious, totalAll: all.length, totalWithPos: withPos.length }, null, 2));
  console.log(`\n稽核用中繼資料寫入 ${path.join(CACHE_DIR, 'audit_data.json')}`);
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });

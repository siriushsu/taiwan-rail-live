#!/usr/bin/env node
// data/crossings.json 補 tracks(軌道數) / elec(電化) 兩欄 —— 用 OSM 鐵路線形推算,供前端畫官方四款平交道標誌
//   台灣 OSM 慣例:每條實體軌道各一條 way["railway"="rail"](不用 tracks= 數字標籤);electrified 標籤覆蓋完整。
// 演算法:對每個道口,以最近 OSM way 的方位角作垂直取樣線(±30m),數與所有 rail way 的交點,2.5m 聚類 = tracks;
//         相交 way 的 electrified 標籤決定 elec(任一 contact_line/yes/rail→true;全 no→false;全缺→線名 fallback)。
//   tracks==0(垂直段 30m 內無軌道)= 資料缺口,該筆不寫 tracks/elec(前端退回通用圖示)。
// 演算法之後套用主對話裁決 OVERRIDES(見 LINE_OVERRIDES/ENTRY_OVERRIDES 常數),重跑本腳本裁決存活。
// 用法:node scripts/enrich_crossings_osm.mjs   (先跑 build_crossings.mjs 產出 crossings.json)
// 注意:crossings.json 就地改寫,只新增 tracks/elec,其餘欄位與筆數一字不動。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CROSSINGS = path.join(ROOT, 'data/crossings.json');
const CACHE = '/private/tmp/claude-501/-Users-xuxiang-Code------/9364938b-6a7d-4c36-8927-76fd03177f46/scratchpad/osm_rail_tw.json';

// Overpass:一次抓全台本島 railway=rail(bbox 語法;around 在各端點會逾時故不用)
const OVERPASS_EPS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OVERPASS_QUERY = '[out:json][timeout:180];\nway["railway"="rail"](21.8,119.9,25.45,122.05);\nout geom tags;';

const DEG = Math.PI / 180;
const PERP_HALF_M = 30;       // 垂直取樣線每側延伸公尺
const CLUSTER_M = 2.5;        // 交點聚類半徑(台鐵軌距間距 ≥3.5m,故 2.5m 只併同軌被切兩段的同位交點)
const BBOX_MARGIN_DEG = 0.0018; // 候選 way 粗篩:bbox 外擴約 200m
const BRANCH_LINES = new Set(['PINGXI', 'NEIWAN', 'JIJI', 'SHENAO']); // 支線 fallback → 非電化(NEIWAN 由 override 救回)

// ─────────────── 主對話裁決 OVERRIDES(2026-07-13)——演算法輸出後強制覆寫,重跑本腳本時裁決存活 ───────────────
// 1) NEIWAN 線級 elec:true —— 內灣線 2011 年隨六家線通車已全線電化;OSM「內灣」ways 電化標籤混雜
//    (electrified=no 34 條/contact_line 46 條),七個道口恰全落於舊標 no 段,演算法照讀成 false 與現實不符。
// 2) 八股頭/光復路[山線] elec:false —— 兩筆為 projFallback,實體在非電化「舊山線」保存段(OSM 該處無
//    electrified 標籤),線名 fallback 依 lnId=山線誤判成電化;tracks 維持演算法結果。
// 3) 大石巷[JIJI] tracks:1 —— 並行的中興二號特種支線(OSM usage=military)已停用且本圖整條排除不畫,
//    政策定案:集集線道口一律單線。
const LINE_OVERRIDES = { // lnId → 補丁(整線適用)
  NEIWAN: { elec: true },
};
const ENTRY_OVERRIDES = { // `${name}|${lnId}` → 補丁(單筆適用)
  '八股頭|山線': { elec: false },
  '光復路|山線': { elec: false },
  '大石巷|JIJI': { tracks: 1 },
};
// 硬 gate 的支線 elec 期望(2026-07-13 主對話修正:原「內灣=非電化」是錯的領域知識,內灣線已電化)
const BRANCH_ELEC_EXPECT = { PINGXI: false, JIJI: false, SHENAO: false, NEIWAN: true };

// ─────────────── 幾何 ───────────────
// 局部公尺座標:x=(lon-lon0)*111320*cos(lat0)、y=(lat-lat0)*110540(以道口點為原點)
function makeToXY(lat0, lon0) {
  const cos0 = Math.cos(lat0 * DEG);
  return (lat, lon) => [(lon - lon0) * 111320 * cos0, (lat - lat0) * 110540];
}
// 點(px,py)到線段(a→b)的最短距離平方 + 垂足參數 t
function pointSegDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
  const fx = ax + vx * t, fy = ay + vy * t;
  const dx = px - fx, dy = py - fy;
  return { d2: dx * dx + dy * dy, L2 };
}
// 線段 p1p2 與 p3p4 交點(局部平面),無交回 null
function segSegIntersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null; // 平行/共線
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p1[0] + d1x * t, p1[1] + d1y * t];
}

// ─────────────── 抓 OSM ───────────────
async function fetchOsm() {
  if (existsSync(CACHE)) {
    console.log(`(cache hit ${CACHE})`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  mkdirSync(path.dirname(CACHE), { recursive: true });
  const body = new URLSearchParams({ data: OVERPASS_QUERY }).toString();
  let last = null;
  for (const ep of OVERPASS_EPS) {
    try {
      console.log(`querying Overpass ${ep.split('/')[2]} ...`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 240000);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'rail-crossings-enrich/1.0' },
        body, signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      writeFileSync(CACHE, JSON.stringify(json));
      const sz = (JSON.stringify(json).length / 1e6).toFixed(1);
      console.log(`  OK,快取 ${CACHE} (~${sz} MB)`);
      return json;
    } catch (e) {
      last = e;
      console.log(`  失敗 ${e.message};試下一個端點`);
    }
  }
  throw last;
}

// electrified 值 → 正/負/未知
function isElectrifiedPos(v) { return v && /(?:contact_line|rail|yes)/.test(v); }

// ─────────────── main ───────────────
async function main() {
  const doc = JSON.parse(readFileSync(CROSSINGS, 'utf8'));
  const crossings = doc.crossings;
  const before = crossings.length;
  console.log(`crossings.json:${before} 筆`);

  const osm = await fetchOsm();
  const ways = [];
  for (const el of osm.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const geom = el.geometry.map(g => [g.lat, g.lon]);
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [la, lo] of geom) {
      if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    }
    ways.push({
      geom, minLat, maxLat, minLon, maxLon,
      electrified: (el.tags && el.tags.electrified) || null,
      name: (el.tags && (el.tags.name || el.tags['name:zh'])) || '',
    });
  }
  console.log(`OSM railway=rail ways:${ways.length}`);

  let enriched = 0, gaps = 0, fallbackUsed = 0;
  const gapList = [], fallbackList = [], overrideList = [];
  const perLine = new Map(); // lnId -> {n, multi, elec, gap}
  const results = []; // 供報告

  for (const c of crossings) {
    const lat0 = c.lat, lon0 = c.lon;
    const toXY = makeToXY(lat0, lon0);
    // 候選 way:bbox 外擴 ~200m 命中
    const cands = ways.filter(w =>
      lat0 >= w.minLat - BBOX_MARGIN_DEG && lat0 <= w.maxLat + BBOX_MARGIN_DEG &&
      lon0 >= w.minLon - BBOX_MARGIN_DEG && lon0 <= w.maxLon + BBOX_MARGIN_DEG);

    // 各候選 way 轉局部座標段列
    const candSegs = []; // {xy1,xy2,way}
    for (const w of cands) {
      const pts = w.geom.map(([la, lo]) => toXY(la, lo));
      for (let i = 0; i < pts.length - 1; i++) candSegs.push({ a: pts[i], b: pts[i + 1], way: w });
    }

    let rec = { name: c.name, lnId: c.lnId, tracks: 0, elec: null, nearestM: null, elecSrc: null, evals: [] };

    if (candSegs.length) {
      // 最近段(對原點)→ 方位
      let best = null;
      for (const s of candSegs) {
        const { d2, L2 } = pointSegDist2(0, 0, s.a[0], s.a[1], s.b[0], s.b[1]);
        if (L2 < 1e-9) continue; // 退化段跳過
        if (!best || d2 < best.d2) best = { d2, seg: s };
      }
      if (best) {
        rec.nearestM = +Math.sqrt(best.d2).toFixed(1);
        const dx = best.seg.b[0] - best.seg.a[0], dy = best.seg.b[1] - best.seg.a[1];
        const L = Math.hypot(dx, dy);
        const px = -dy / L, py = dx / L; // 垂直單位向量
        const P1 = [-PERP_HALF_M * px, -PERP_HALF_M * py];
        const P2 = [PERP_HALF_M * px, PERP_HALF_M * py];

        // 與所有候選段求交
        const hits = []; // {pt:[x,y], electrified}
        for (const s of candSegs) {
          const ip = segSegIntersect(P1, P2, s.a, s.b);
          if (ip) hits.push({ pt: ip, electrified: s.way.electrified });
        }
        // 2.5m 聚類 → tracks
        const clusters = []; // {pt, elecVals:Set}
        for (const h of hits) {
          let cl = null;
          for (const k of clusters) {
            const ddx = k.pt[0] - h.pt[0], ddy = k.pt[1] - h.pt[1];
            if (ddx * ddx + ddy * ddy <= CLUSTER_M * CLUSTER_M) { cl = k; break; }
          }
          if (!cl) { cl = { pt: h.pt, elecVals: new Set() }; clusters.push(cl); }
          if (h.electrified) cl.elecVals.add(h.electrified);
        }
        rec.tracks = clusters.length;

        // elec:所有相交 way 的 electrified 值集合
        const allVals = [];
        for (const k of clusters) for (const v of k.elecVals) allVals.push(v);
        rec.evals = [...new Set(allVals)];
        if (rec.tracks > 0) {
          if (allVals.some(isElectrifiedPos)) { rec.elec = true; rec.elecSrc = 'osm'; }
          else if (allVals.length > 0) { rec.elec = false; rec.elecSrc = 'osm'; } // 有標籤且全非正 = 全 no
          else { // 全缺標籤 → 線名 fallback
            rec.elec = !BRANCH_LINES.has(c.lnId);
            rec.elecSrc = 'fallback';
          }
        }
      }
    }

    // 裁決 overrides:演算法結果之後套用(理由見檔頭 OVERRIDES 常數);缺口(tracks=0)不造值
    if (rec.tracks > 0) {
      const ov = { ...(LINE_OVERRIDES[c.lnId] || {}), ...(ENTRY_OVERRIDES[`${c.name}|${c.lnId}`] || {}) };
      if ('tracks' in ov || 'elec' in ov) {
        const bT = rec.tracks, bE = rec.elec;
        if ('tracks' in ov) rec.tracks = ov.tracks;
        if ('elec' in ov) { rec.elec = ov.elec; rec.elecSrc = 'override'; }
        overrideList.push(`${c.name}[${c.lnId}] tracks ${bT}→${rec.tracks}, elec ${bE}→${rec.elec}`);
      }
    }

    results.push(rec);
    const pl = perLine.get(c.lnId) || { n: 0, multi: 0, elec: 0, gap: 0 };
    pl.n++;

    if (rec.tracks > 0) {
      c.tracks = rec.tracks;
      c.elec = rec.elec;
      enriched++;
      if (rec.tracks >= 2) pl.multi++;
      if (rec.elec) pl.elec++;
      if (rec.elecSrc === 'fallback') { fallbackUsed++; fallbackList.push(`${c.name}[${c.lnId}] tracks=${rec.tracks} elec=${rec.elec}`); }
    } else {
      gaps++; pl.gap++;
      gapList.push(`${c.name}[${c.lnId}] nearestM=${rec.nearestM}`);
      delete c.tracks; delete c.elec; // 重跑冪等:此輪判缺口就清掉舊輪殘留欄位
    }
    perLine.set(c.lnId, pl);
  }

  // ─────────────── 寫回(minify,無尾換行,與 build_crossings.mjs 一致) ───────────────
  writeFileSync(CROSSINGS, JSON.stringify(doc));
  // 驗證:parse 有效 + 筆數不變 + 只多了 tracks/elec
  const verify = JSON.parse(readFileSync(CROSSINGS, 'utf8'));
  if (verify.crossings.length !== before) throw new Error(`筆數變了!${before}->${verify.crossings.length}`);

  // ─────────────── 硬 gate:四支線 tracks==1;elec 期望 平溪/集集/深澳=false、內灣=true ───────────────
  const violations = [];
  for (const c of crossings) {
    const expect = BRANCH_ELEC_EXPECT[c.lnId];
    if (expect === undefined) continue;
    if (!('tracks' in c)) { violations.push(`${c.name}[${c.lnId}] 缺口未補(無 tracks) — 支線本應 tracks=1`); continue; }
    if (c.tracks !== 1 || c.elec !== expect) violations.push(`${c.name}[${c.lnId}] tracks=${c.tracks} elec=${c.elec}(應 tracks=1 elec=${expect})`);
  }

  // ─────────────── 分線統計表 ───────────────
  const lnOrder = [...perLine.keys()].sort();
  const tableRows = lnOrder.map(ln => {
    const p = perLine.get(ln);
    const enr = p.n - p.gap;
    return {
      lnId: ln, n: p.n, enriched: enr, gap: p.gap,
      pctMulti: enr ? +(100 * p.multi / enr).toFixed(1) : 0,
      pctElec: enr ? +(100 * p.elec / enr).toFixed(1) : 0,
    };
  });

  // ─────────────── console 輸出 ───────────────
  console.log(`\n=== 補欄結果 ===`);
  console.log(`補上 tracks/elec:${enriched}/${before};缺口(不寫欄):${gaps};電化 fallback(線名推):${fallbackUsed};裁決 override:${overrideList.length}`);
  console.log(`\n=== 裁決 OVERRIDES 生效(${overrideList.length}) ===`);
  overrideList.forEach(o => console.log('  * ' + o));
  console.log(`\n=== 硬 GATE:四支線 tracks==1;elec 平溪/集集/深澳=false、內灣=true ===`);
  if (violations.length === 0) console.log('PASS — 無違反');
  else { console.log(`FAIL — ${violations.length} 筆違反(如實回報,未自動修改):`); violations.forEach(v => console.log('  ! ' + v)); }

  console.log(`\n=== 分線統計 ===`);
  console.log('lnId'.padEnd(14) + 'n'.padStart(5) + 'enr'.padStart(6) + 'gap'.padStart(5) + '%multi'.padStart(8) + '%elec'.padStart(8));
  for (const r of tableRows) {
    console.log(r.lnId.padEnd(14) + String(r.n).padStart(5) + String(r.enriched).padStart(6) + String(r.gap).padStart(5) + String(r.pctMulti).padStart(8) + String(r.pctElec).padStart(8));
  }

  // 合理性線索
  console.log(`\n=== 合理性線索(人工判讀) ===`);
  const lnHint = (ln, label) => { const r = tableRows.find(t => t.lnId === ln); if (r) console.log(`  ${label}(${ln}): %multi=${r.pctMulti} %elec=${r.pctElec} n=${r.n} gap=${r.gap}`); };
  lnHint('縱貫線北段', '縱貫北'); lnHint('縱貫線南段', '縱貫南'); lnHint('山線', '山線'); lnHint('海線', '海線');
  lnHint('屏東線', '屏東'); lnHint('臺東線', '台東'); lnHint('宜蘭線', '宜蘭'); lnHint('北迴線', '北迴'); lnHint('南迴線', '南迴');
  lnHint('JIJI', '集集'); lnHint('NEIWAN', '內灣'); lnHint('PINGXI', '平溪'); lnHint('SHENAO', '深澳');

  // ─────────────── 報告落檔 ───────────────
  const REPORT = '/private/tmp/claude-501/-Users-xuxiang-Code------/9364938b-6a7d-4c36-8927-76fd03177f46/scratchpad/crossing-enrich-report.md';
  const L = [];
  L.push('# 平交道 tracks/elec 補欄報告', '');
  L.push(`- 資料:${before} 筆(crossings.json);補上 ${enriched},缺口 ${gaps},電化 fallback ${fallbackUsed},裁決 override ${overrideList.length}`);
  L.push(`- OSM railway=rail ways:${ways.length};快取 ${CACHE}`);
  L.push('');
  L.push(`## 裁決 OVERRIDES 生效(${overrideList.length}) — 2026-07-13 主對話定案,理由見腳本 OVERRIDES 常數註解`);
  overrideList.forEach(o => L.push(`- ${o}`));
  L.push('');
  L.push('## 硬 GATE(四支線 tracks==1;elec 平溪/集集/深澳=false、內灣=true)');
  L.push(violations.length ? `FAIL — ${violations.length} 筆:` : 'PASS');
  violations.forEach(v => L.push(`- ${v}`));
  L.push('');
  L.push('## 分線統計');
  L.push('| lnId | n | 補上 | 缺口 | %multi(≥2軌) | %elec |');
  L.push('|---|---|---|---|---|---|');
  for (const r of tableRows) L.push(`| ${r.lnId} | ${r.n} | ${r.enriched} | ${r.gap} | ${r.pctMulti} | ${r.pctElec} |`);
  L.push('');
  L.push(`## 缺口清單(${gapList.length}) — 該筆不寫 tracks/elec`);
  gapList.forEach(g => L.push(`- ${g}`));
  L.push('');
  L.push(`## 電化 fallback(${fallbackList.length}) — OSM 無 electrified 標籤,改線名推`);
  fallbackList.forEach(f => L.push(`- ${f}`));
  L.push('');
  L.push('## 全筆結果(name | lnId | tracks | elec | elecSrc | nearestM | electrifiedVals)');
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i], r = results[i];
    const tks = ('tracks' in c) ? c.tracks : '—(缺口)';
    const elc = ('elec' in c) ? c.elec : '—';
    L.push(`- ${c.name} | ${c.lnId} | ${tks} | ${elc} | ${r.elecSrc || '-'} | ${r.nearestM ?? '-'} | ${r.evals.join(';') || '-'}`);
  }
  writeFileSync(REPORT, L.join('\n'));
  console.log(`\n報告寫入 ${REPORT}`);
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });

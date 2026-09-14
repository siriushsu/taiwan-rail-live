// 用 TDX 官方逐股幾何核實「OSM 畫了兩條平行 way 的隧道段，是不是真的雙線」。
//
// 為什麼要有這支：scripts/lib/parallel_tracks.mjs 的 UNVERIFIED_REFS 把南迴線／臺東線的同名平行隧道 way
// 一律當「未核實」排除，於是那幾段被判成單線。2026-09-14 使用者裁示「交通部都有資料，那我們就應該知道有，
// 怎麼會是當作沒有核實就不畫？」——TDX GIS 圖資 v3「軌道路網實體路線」是逐股道的官方幾何（雙線區間畫兩條
// part、間距約 4 m），拿它當第二個獨立來源，就能把「未核實」變成「已核實／已否決」。
//
// 判法（每個取樣點）：
//   1. 沿 OSM way 的實際線形每 SAMPLE_STEP_M 取一點（不是兩站直線中點——舊法在山區隧道會吸附到 2.8 km 外）。
//   2. 吸附到最近的 TDX 線段；距離 > SNAP_MAX_M 視為「TDX 在這裡沒畫到」(no-geom)，不進分母。
//   3. 從吸附點找「不同 part」的最近線段，距離落在 [LO_M, HI_M] ⇒ 這一點 TDX 畫了第二股 (parallel)。
//      LO_M 的地板是為了排掉 part 邊界的同股延續（距離趨近 0），不是雙股。
//   4. 一對 way 的核實比例 = parallel /（parallel + single）；≥ VERIFIED_FRAC 判 verified。
//
// 門檻怎麼定的（同一支腳本的 --calibrate 可重跑）：
//   已知雙線（縱貫線／宜蘭線長 way）比例 0.95–1.00、第二股距離中位數 3.9–4.2 m；
//   已知單線（集集線／平溪線／內灣線）比例 0.00–0.05。0.6 落在這個缺口正中央，兩邊都有餘裕。
//   北迴線（真雙線但 OSM 與 TDX 都有隧道段只畫一條）量到 0.50–0.54 ⇒ 幾何法對那條線本來就會失手，
//   所以 build_tra_track_sections.mjs 的 KNOWN_DOUBLE_REFS override 要保留，不能被本檔取代。
//
// 跑法：
//   node scripts/build_tdx_parallel_evidence.mjs            → 寫 scripts/fixtures/tra-parallel-verified-tdx-0914.json
//   node scripts/build_tdx_parallel_evidence.mjs --calibrate → 印正負對照組（門檻的證據）
//   node scripts/build_tdx_parallel_evidence.mjs --sections  → 全部站對的 TDX 取樣，對帳 repo 單雙線（只印報告，不改任何檔）
//
// 🔴 2026-09-14 第二次裁示（使用者提供台鐵官方《路線修築沿革》）：官方沿革比本支的幾何量測上位。
// 南迴線自 1991 年通車只有電氣化、沒有任何「添築雙線」紀錄 ⇒ 中央隧道／安朔隧道不算第二股；
// 山里隧道有「山里─臺東(雙線) 2013 添築雙線」佐證 ⇒ 算。逐對依據寫在 fixture 的 truthSource，
// 重跑本支會沿用（見下方「沿用官方沿革裁定」），不會被幾何值蓋掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEAR_M, ANGLE, UNVERIFIED_REFS, isTrack, sectionKey } from './lib/parallel_tracks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TDX_FIXTURE = 'scripts/fixtures/tdx-map-rail-network-line-TRA-20260914.geojson';
const OUT = 'scripts/fixtures/tra-parallel-verified-tdx-0914.json';
const SAMPLE_STEP_M = 100, SECTION_STEP_M = 200;
const SNAP_MAX_M = 35, LO_M = 3, HI_M = 8, SEARCH_R_M = 60;
const VERIFIED_FRAC = 0.6, MIN_COVERED = 5;

// ── 平面近似（與 parallel_tracks.mjs 同一把尺）
const M = 111320, lat0 = 23.7, kx = M * Math.cos(lat0 * Math.PI / 180);
const xy = p => [p[0] * kx, p[1] * M];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function projSeg(P, A, B) {
  const vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
  if (!L2) return { p: A, d: dist(P, A) };
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L2));
  const p = [A[0] + vx * t, A[1] + vy * t];
  return { p, d: dist(P, p) };
}

// ── TDX 線段的空間格索引；part = 「一條 MultiLineString 的一個 part」＝ TDX 畫的一股
function loadTdx(file) {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const segs = [];
  g.features.forEach((f, fi) => {
    const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    parts.forEach((pl, pi) => {
      const part = `${f.properties?.model?.LineID ?? fi}#${pi}`;
      for (let i = 0; i + 1 < pl.length; i++) {
        const A = xy(pl[i]), B = xy(pl[i + 1]);
        if (dist(A, B) > 1e-9) segs.push({ part, A, B });
      }
    });
  });
  const CELL = 60, grid = new Map();
  for (const s of segs) {
    const x0 = Math.min(s.A[0], s.B[0]), x1 = Math.max(s.A[0], s.B[0]), y0 = Math.min(s.A[1], s.B[1]), y1 = Math.max(s.A[1], s.B[1]);
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
      const k = gx + ':' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(s);
    }
  }
  const near = (P, R) => {
    const out = [], seen = new Set();
    for (let gx = Math.floor((P[0] - R) / CELL); gx <= Math.floor((P[0] + R) / CELL); gx++)
      for (let gy = Math.floor((P[1] - R) / CELL); gy <= Math.floor((P[1] + R) / CELL); gy++)
        for (const s of grid.get(gx + ':' + gy) || []) { if (!seen.has(s)) { seen.add(s); out.push(s); } }
    return out;
  };
  return { segs, near, source: g._source, features: g.features.length };
}

// 單點判定：TDX 在這裡有沒有畫第二股
function probe(idx, P, snapMax = SNAP_MAX_M) {
  const cs = idx.near(P, snapMax);
  let best = null;
  for (const s of cs) { const r = projSeg(P, s.A, s.B); if (!best || r.d < best.d) best = { d: r.d, p: r.p, part: s.part }; }
  if (!best || best.d > snapMax) return { verdict: 'no-geom', snapM: best ? +best.d.toFixed(1) : null, secondM: null };
  let second = null;
  for (const s of idx.near(best.p, SEARCH_R_M)) {
    if (s.part === best.part) continue;
    const r = projSeg(best.p, s.A, s.B);
    if (r.d < LO_M) continue;              // part 邊界的同股延續，不是第二股
    if (!second || r.d < second.d) second = { d: r.d, part: s.part };
  }
  const secondM = second ? +second.d.toFixed(2) : null;
  return { verdict: secondM !== null && secondM <= HI_M ? 'parallel' : 'single', snapM: +best.d.toFixed(1), secondM };
}

// 沿 way／路徑線形等距取樣（含首點）
function sampleLine(coords, stepM) {
  const pts = coords.map(xy), out = [];
  if (!pts.length) return out;
  out.push(pts[0]);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = dist(pts[i], pts[i + 1]); if (!L) continue;
    let t = stepM - acc;
    while (t < L) { out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / L, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / L]); t += stepM; }
    acc = (acc + L) % stepM;
  }
  return out;
}
function tally(idx, samples, snapMax) {
  const c = { parallel: 0, single: 0, 'no-geom': 0 }, seconds = [], snaps = [];
  for (const P of samples) {
    const r = probe(idx, P, snapMax); c[r.verdict]++;
    if (r.secondM !== null) seconds.push(r.secondM);
    if (r.snapM !== null) snaps.push(r.snapM);
  }
  seconds.sort((a, b) => a - b); snaps.sort((a, b) => a - b);
  const covered = c.parallel + c.single;
  return {
    samples: samples.length, parallel: c.parallel, single: c.single, noGeom: c['no-geom'],
    covered, coverage: samples.length ? +(covered / samples.length).toFixed(3) : 0,
    parallelFrac: covered ? +(c.parallel / covered).toFixed(3) : null,
    medianSecondM: seconds.length ? seconds[seconds.length >> 1] : null,
    medianSnapM: snaps.length ? snaps[snaps.length >> 1] : null,
  };
}

// ── parallel_tracks.mjs 目前「因為 UNVERIFIED_REFS 而被排掉」的 way 對（用同一組常數重算，才不會兩邊漂）
function suppressedPairs(net) {
  const ways = net.ways.filter(isTrack);
  const unverifiedPair = (a, b) => a.tags?.tunnel && b.tags?.tunnel && a.tags?.name && a.tags.name === b.tags.name && (UNVERIFIED_REFS.has(a.tags?.ref) || UNVERIFIED_REFS.has(b.tags?.ref));
  const CELL = 50, grid = new Map();
  for (const w of ways) {
    const c = w.coordinates;
    for (let i = 0; i + 1 < c.length; i++) {
      const A = xy(c[i]), B = xy(c[i + 1]);
      const x0 = Math.min(A[0], B[0]) - NEAR_M, x1 = Math.max(A[0], B[0]) + NEAR_M, y0 = Math.min(A[1], B[1]) - NEAR_M, y1 = Math.max(A[1], B[1]) + NEAR_M;
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const k = gx + ':' + gy; (grid.get(k) || grid.set(k, []).get(k)).push({ w, i, A, B });
      }
    }
  }
  const agg = new Map();
  let segs = 0, lenM = 0;
  for (const w of ways) for (let i = 0; i + 1 < w.coordinates.length; i++) {
    const c = w.coordinates, A = xy(c[i]), B = xy(c[i + 1]);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dir = Math.atan2(B[1] - A[1], B[0] - A[0]);
    let bestAll = null, hasOk = false;
    for (const e of grid.get(Math.floor(mid[0] / CELL) + ':' + Math.floor(mid[1] / CELL)) || []) {
      if (e.w === w) continue;
      const r = projSeg(mid, e.A, e.B); if (r.d > NEAR_M) continue;
      let ang = Math.abs(Math.atan2(e.B[1] - e.A[1], e.B[0] - e.A[0]) - dir) % Math.PI; ang = Math.min(ang, Math.PI - ang);
      if (ang > ANGLE) continue;
      if (!bestAll || r.d < bestAll.d) bestAll = { w: e.w, d: r.d };
      if (!unverifiedPair(w, e.w)) hasOk = true;
    }
    if (!bestAll || hasOk) continue;      // 沒有平行候選，或另有沒被排除的候選 ⇒ 這一段不是被 UNVERIFIED_REFS 擋掉的
    const L = dist(A, B); segs++; lenM += L;
    const key = [String(w.id), String(bestAll.w.id)].sort().join('|');
    const rec = agg.get(key) || agg.set(key, { key, a: w, b: bestAll.w, segs: 0, lenM: 0, dists: [] }).get(key);
    rec.segs++; rec.lenM += L; rec.dists.push(bestAll.d);
  }
  return { pairs: [...agg.values()].sort((x, y) => y.lenM - x.lenM), segs, lenM };
}

const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'rail-3d/physical/network.json'), 'utf8'));
const idx = loadTdx(TDX_FIXTURE);
const argv = process.argv.slice(2);

if (argv.includes('--calibrate')) {
  // 門檻的正負對照組：已知雙線要接近 1、已知單線要接近 0，門檻落在中間才有牙。
  const mains = net.ways.filter(isTrack);
  const pick = (ref, n) => mains.filter(w => w.tags?.ref === ref).sort((a, b) => b.coordinates.length - a.coordinates.length).slice(0, n);
  for (const [label, ref] of [['已知雙線', '縱貫線'], ['已知雙線', '宜蘭線'], ['已知單線', '集集線'], ['已知單線', '平溪線'], ['已知單線', '內灣線'], ['真雙線但兩邊都只畫一條', '北迴線']])
    for (const w of pick(ref, 3)) {
      const t = tally(idx, sampleLine(w.coordinates, SAMPLE_STEP_M), SNAP_MAX_M);
      console.log(`${label} ${ref} way=${w.id} n=${t.samples} 平行${t.parallel} 單${t.single} 無幾何${t.noGeom} 比例=${t.parallelFrac} 第二股中位=${t.medianSecondM}m 吸附中位=${t.medianSnapM}m`);
    }
  process.exit(0);
}

if (argv.includes('--sections')) {
  // 全部站對：沿「派車表真的派過的路徑」線形取樣，和 repo 現行單雙線判定對帳（只報告，不改檔）。
  const dispatch = JSON.parse(fs.readFileSync(path.join(ROOT, 'rail-3d/physical/dispatch.json'), 'utf8'));
  const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tra_track_sections.json'), 'utf8')).pairs;
  const pairPaths = new Map();
  for (const [key, plan] of Object.entries(dispatch.plans)) {
    if (!key.startsWith('tra_sched:')) continue;
    const sig = JSON.parse(plan.stopSignature);
    for (let i = 0; i + 1 < sig.length; i++) {
      const pk = sectionKey(sig[i][0].split(':')[1], sig[i + 1][0].split(':')[1]);   // 與區間表同一把鍵（站名正規化）
      (pairPaths.get(pk) || pairPaths.set(pk, new Set()).get(pk)).add(plan.pathIds[i]);
    }
  }
  const rows = [];
  for (const [pk, pids] of pairPaths) {
    const pid = [...pids][0], p = net.paths[pid]; if (!p) continue;
    // 路徑線形：沿 walk 把每一段的座標接起來
    const coords = [];
    for (const [wi, start, cnt] of p.walk) {
      const w = net.ways[wi]; if (!w?.coordinates) continue;
      const n = Math.abs(cnt), dirn = Math.sign(cnt) || 1;
      for (let k = 0; k <= n; k++) { const i = start + k * dirn + (dirn < 0 ? 1 : 0); if (i >= 0 && i < w.coordinates.length) coords.push(w.coordinates[i]); }
    }
    const t = tally(idx, sampleLine(coords, SECTION_STEP_M), SNAP_MAX_M);
    const tdxTracks = t.covered >= MIN_COVERED && t.parallelFrac !== null ? (t.parallelFrac >= VERIFIED_FRAC ? 2 : 1) : null;
    rows.push({ pair: pk, repoTracks: repo[pk]?.tracks ?? null, repoFrac: repo[pk]?.parallelFrac ?? null, refs: repo[pk]?.refs ?? [], override: !!repo[pk]?.override, tdxTracks, ...t });
  }
  const mismatch = rows.filter(r => r.tdxTracks !== null && r.repoTracks !== null && r.tdxTracks !== r.repoTracks);
  const out = { generatedAt: new Date().toISOString().slice(0, 10), method: `沿派車路徑線形每 ${SECTION_STEP_M} m 取樣，吸附上限 ${SNAP_MAX_M} m，第二股窗 ${LO_M}–${HI_M} m，比例 ≥${VERIFIED_FRAC} 判雙線，覆蓋樣本 <${MIN_COVERED} 判定不足`, totals: { pairs: rows.length, judged: rows.filter(r => r.tdxTracks !== null).length, mismatch: mismatch.length }, mismatch, rows: rows.sort((a, b) => a.pair.localeCompare(b.pair, 'zh-Hant')) };
  const file = argv[argv.indexOf('--sections') + 1] || 'output/audit-0914/tdx-section-crosscheck-0914.json';
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(out, null, 1));
  console.log(`站對 ${rows.length}：可判 ${out.totals.judged}、與 repo 不一致 ${mismatch.length} → ${file}`);
  for (const m of mismatch) console.log(`  ${m.pair} repo=${m.repoTracks}(frac ${m.repoFrac}${m.override ? ', override' : ''}) tdx=${m.tdxTracks}(frac ${m.parallelFrac}, 覆蓋 ${m.covered}/${m.samples}) refs=${m.refs.join('+')}`);
  process.exit(0);
}

// ── 預設模式：核實被 UNVERIFIED_REFS 排除的 way 對
const sup = suppressedPairs(net);
const pairs = sup.pairs.map(r => {
  const per = {};
  for (const [side, w] of [['a', r.a], ['b', r.b]]) per[side] = { wayId: String(w.id), ...tally(idx, sampleLine(w.coordinates, SAMPLE_STEP_M), SNAP_MAX_M) };
  const covered = per.a.covered + per.b.covered, parallel = per.a.parallel + per.b.parallel;
  const parallelFrac = covered ? +(parallel / covered).toFixed(3) : null;
  // 三種結局要分開：TDX 說有第二股（verified）／TDX 說沒有（rejected）／TDX 在這裡量不到夠多樣本（insufficient）。
  // insufficient 不是「否決」，只是還缺證據；照裁示的保守邊界，它與 rejected 一樣維持排除，但理由不同。
  const verdict = covered < MIN_COVERED ? 'insufficient' : parallelFrac >= VERIFIED_FRAC ? 'verified' : 'rejected';
  const dists = r.dists.slice().sort((x, y) => x - y);
  return {
    key: r.key, name: r.a.tags?.name ?? null, refs: [r.a.tags?.ref, r.b.tags?.ref],
    ways: [String(r.a.id), String(r.b.id)],
    osm: { suppressedSegs: r.segs, suppressedLenM: Math.round(r.lenM), medianGapM: +dists[dists.length >> 1].toFixed(1) },
    tdx: { samples: per.a.samples + per.b.samples, covered, parallel, single: per.a.single + per.b.single, noGeom: per.a.noGeom + per.b.noGeom, parallelFrac, coverage: +(covered / (per.a.samples + per.b.samples)).toFixed(3), medianSecondM: per.a.medianSecondM ?? per.b.medianSecondM, perWay: per },
    verdict, verified: verdict === 'verified',
    lowCoverage: covered < 20 || (covered / (per.a.samples + per.b.samples)) < 0.5,
  };
});
// 🔴 官方《路線修築沿革》的裁定比本支的幾何量測上位（2026-09-14 第二次裁示）：舊檔裡任何帶 truthSource
// 的一對，verdict／verified 一律沿用舊檔，不讓重跑把人工核實過的結果靜默蓋回 TDX 幾何值。
// 要重新以幾何為準，就先把那一對的 truthSource 從 fixture 拿掉（明示動作）。
let kept = 0;
try {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'));
  const by = new Map((prev.pairs || []).filter(p => p.truthSource).map(p => [p.key, p]));
  for (const p of pairs) {
    const o = by.get(p.key); if (!o) continue;
    if (o.verdict !== p.verdict) console.log(`  ↺ 沿用官方沿革裁定 ${p.name} ${p.key}：本次幾何判 ${p.verdict}，維持 ${o.verdict}`);
    p.verdict = o.verdict; p.verified = o.verified; p.truthSource = o.truthSource; kept++;
  }
} catch { /* 舊檔不在就純幾何產一份 */ }
if (kept) console.log(`沿用舊檔的官方沿革裁定 ${kept} 對（帶 truthSource 的）`);

const doc = {
  version: 1,
  generatedAt: '2026-09-14',
  generator: 'scripts/build_tdx_parallel_evidence.mjs',
  purpose: '用 TDX 官方逐股幾何核實 scripts/lib/parallel_tracks.mjs 的 UNVERIFIED_REFS 排除清單；verified=true 的 way 對之後要當第二股算。',
  ruling: '2026-09-14 使用者裁示：「交通部都有資料，那我們就應該知道有，怎麼會是當作沒有核實就不畫？」⇒ TDX 官方逐股幾何算核實來源。',
  source: idx.source,
  thresholds: { sampleStepM: SAMPLE_STEP_M, snapMaxM: SNAP_MAX_M, secondStrandWindowM: [LO_M, HI_M], searchRadiusM: SEARCH_R_M, verifiedFrac: VERIFIED_FRAC, minCoveredSamples: MIN_COVERED },
  calibration: '同支腳本 --calibrate：已知雙線（縱貫線／宜蘭線）比例 0.95–1.00、第二股中位 3.9–4.2 m；已知單線（集集線／平溪線／內灣線）0.00–0.05。北迴線 0.50–0.54（TDX 在那條線的隧道段也只畫一條）⇒ build_tra_track_sections.mjs 的 KNOWN_DOUBLE_REFS override 不可移除。',
  osmSuppressedTotal: { segs: sup.segs, lenM: Math.round(sup.lenM) },
  pairs,
};
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(doc, null, 1));
const n = v => pairs.filter(p => p.verdict === v);
const mark = { verified: '✅核實', rejected: '❌否決（TDX 只畫一條）', insufficient: '➖樣本不足（維持排除）' };
console.log(`被 UNVERIFIED_REFS 排除的 way 對 ${pairs.length}（${sup.segs} 段、${Math.round(sup.lenM)} m）：核實 ${n('verified').length}、否決 ${n('rejected').length}、樣本不足 ${n('insufficient').length} → ${OUT}`);
for (const p of pairs) console.log(`  ${mark[p.verdict]} ${p.name} ${p.ways.join('‖')} 比例=${p.tdx.parallelFrac} 覆蓋=${p.tdx.covered}/${p.tdx.samples} 第二股中位=${p.tdx.medianSecondM}m OSM被排除 ${p.osm.suppressedLenM}m${p.lowCoverage ? ' ⚠️覆蓋低' : ''}`);
console.log(`核實後可回收的 OSM 平行段長度：${Math.round(n('verified').reduce((a, p) => a + p.osm.suppressedLenM, 0))} m / ${Math.round(sup.lenM)} m`);

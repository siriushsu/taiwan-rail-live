// 全島掃描：網站地景的場地面（landscape-web/places/detail 的 surfaces：跑道、球場、草地、遊戲場…）在同一格裡互相重疊的地方。
// 重疊又同高的兩層面會互相穿插閃爍（11-24 育德國小：跑道是整塊實心橢圓、裡面再疊一塊草地）。
// 重疊面積用柵格量（每 0.5 m 取樣，跟 places.mjs 的判斷方式無關），再對 places.mjs fieldLevels 的分階：重疊 ≥ 1 m² 而分到同一階的算紅。
//   node scripts/audit_landscape_field_overlaps.mjs [輸出資料夾=build/field-overlaps]
//   FLAT=1：當作修正前（全部同一階），對照用，應該全紅。
// 輸出 overlaps.json（每一對）與 overlaps.html（清單，依重疊面積排序）；結束碼＝紅的對數 > 0 ? 1 : 0。
// 名稱：landscape-web/places/vector/12 的 names 圖層（學校、場館名），取 300 m 內最近的一個；解碼套件借 T7 地景工作區的（沒有就不印名稱）。
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fieldLevels } from '../landscape-web/places.mjs';
import { fromTM2 } from '../landscape-web/engine/proj/tm2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'build/field-overlaps')); mkdirSync(OUT, { recursive: true });
const DET = path.join(ROOT, 'landscape-web/places/detail'), T = 1280, STEP = .5, MIN = 1;
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const inRings = (x, y, rings) => rings.reduce((c, r) => c !== inRing(x, y, r), false);
const bbox = rings => rings[0].reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const area = (rings, bb) => { let n = 0; for (let x = Math.floor(bb[0] / STEP) * STEP + STEP / 2; x < bb[2]; x += STEP) for (let y = Math.floor(bb[1] / STEP) * STEP + STEP / 2; y < bb[3]; y += STEP) if (inRings(x, y, rings)) n++; return n * STEP * STEP; };

// 名稱（可有可無）
const names = [];
try {
  const tools = '/Volumes/Sirius T7/軌島-地景原型-1112/landscape/lib/env.mjs';
  const { protoImport } = await import(pathToFileURL(tools).href);
  const { VectorTile } = await protoImport('@mapbox/vector-tile/index.js'), pm = await protoImport('pbf/index.js'), Pbf = pm.PbfReader || pm.default;
  const V = path.join(ROOT, 'landscape-web/places/vector/12');
  for (const x of readdirSync(V).filter(x => /^\d+$/.test(x))) for (const f of readdirSync(path.join(V, x)).filter(f => /^\d+/.test(f))) {
    const y = parseInt(f), vt = new VectorTile(new Pbf(readFileSync(path.join(V, x, f)))), L = vt.layers.names; if (!L) continue;
    for (let i = 0; i < L.length; i++) { const ft = L.feature(i), g = ft.toGeoJSON(+x, y, 12).geometry, c = g.type === 'Point' ? g.coordinates : g.coordinates.flat(3).length ? (a => [a[0], a[1]])(g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0]) : null; if (c && ft.properties.name) names.push({ ll: c, name: ft.properties.name, k: ft.properties.k }); }
  }
} catch (e) { console.log('名稱略過：', e.message); }
const nameNear = (lon, lat) => { let best = null, bd = 300; for (const n of names) { const d = Math.hypot((n.ll[0] - lon) * 101000, (n.ll[1] - lat) * 111000); if (d < bd) { bd = d; best = n.name; } } return best || ''; };

const levelsOf = process.env.FLAT ? S => S.map(() => 0) : fieldLevels;
const pairs = []; let tiles = 0, surf = 0, slow = { ms: 0, tile: '' };
for (const f of readdirSync(DET).filter(f => /^\d+_\d+\.json$/.test(f))) {
  const reg = JSON.parse(readFileSync(path.join(DET, f), 'utf8'));
  for (const [id, t] of Object.entries(reg)) {
    const S = t.surfaces || []; if (!S.length) continue; tiles++; surf += S.length;
    const t0 = performance.now(), lv = levelsOf(S), ms = performance.now() - t0; if (ms > slow.ms) slow = { ms: +ms.toFixed(1), tile: id, n: S.length };
    const items = S.map(([kind, rings], i) => ({ i, kind, rings, bb: bbox(rings) })).filter(s => s.kind !== 'line');
    const [ti, tj] = id.slice(1).split('_N').map(Number);
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b], bb = [Math.max(A.bb[0], B.bb[0]), Math.max(A.bb[1], B.bb[1]), Math.min(A.bb[2], B.bb[2]), Math.min(A.bb[3], B.bb[3])];
      if (bb[0] >= bb[2] || bb[1] >= bb[3]) continue;
      let n = 0, sx = 0, sy = 0;
      for (let x = Math.floor(bb[0] / STEP) * STEP + STEP / 2; x < bb[2]; x += STEP) for (let y = Math.floor(bb[1] / STEP) * STEP + STEP / 2; y < bb[3]; y += STEP) if (inRings(x, y, A.rings) && inRings(x, y, B.rings)) { n++; sx += x; sy += y; }
      const ov = n * STEP * STEP; if (ov < MIN) continue;
      const E = ti * T + sx / n, N = tj * T + sy / n, [lon, lat] = fromTM2(E, N);
      pairs.push({ tile: id, a: A.kind, b: B.kind, overlap: +ov.toFixed(1), areaA: +area(A.rings, A.bb).toFixed(0), areaB: +area(B.rings, B.bb).toFixed(0), levelA: lv[A.i], levelB: lv[B.i], fixed: lv[A.i] !== lv[B.i], sameColor: A.kind === B.kind, at: [+E.toFixed(1), +N.toFixed(1)], lonlat: [+lon.toFixed(6), +lat.toFixed(6)], name: '' });
    }
  }
}
pairs.sort((u, v) => v.overlap - u.overlap);
for (const p of pairs) p.name = nameNear(...p.lonlat);
const red = pairs.filter(p => !p.fixed), diffColor = pairs.filter(p => !p.sameColor);
const sum = { made: new Date().toISOString(), tiles, surfaces: surf, overlapPairs: pairs.length, differentKinds: diffColor.length, sameKind: pairs.length - diffColor.length, overlapM2: +pairs.reduce((s, p) => s + p.overlap, 0).toFixed(0), sameLevelAfterFix: red.length, slowestLevelsTile: slow, byPair: Object.fromEntries(Object.entries(pairs.reduce((m, p) => { const k = [p.a, p.b].sort().join('+'); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((u, v) => v[1] - u[1])) };
writeFileSync(path.join(OUT, 'overlaps.json'), JSON.stringify({ summary: sum, pairs }, null, 1));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
writeFileSync(path.join(OUT, 'overlaps.html'), `<!doctype html><meta charset="utf-8"><title>場地面重疊清單</title><style>body{font:14px -apple-system,"PingFang TC",sans-serif;margin:24px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:3px 8px;text-align:left}tr.same td{color:#888}.r{color:#b00;font-weight:600}</style>
<h1>網站地景場地面重疊清單（${sum.made.slice(0, 16)}）</h1>
<p>${tiles} 格、${surf} 塊場地面；重疊 ≥ ${MIN} m² 的有 <b>${pairs.length}</b> 對（不同種類 ${diffColor.length} 對、同種類 ${sum.overlapPairs - diffColor.length} 對，同種類同色、閃爍看不太出來），重疊合計 ${sum.overlapM2} m²。修正前這些全都同高；修正後同一階的：<span class="${red.length ? 'r' : ''}">${red.length}</span> 對。</p>
<p>種類組合：${Object.entries(sum.byPair).map(([k, v]) => esc(k) + ' ' + v).join('、')}</p>
<table><tr><th>#</th><th>格</th><th>附近名稱</th><th>A</th><th>B</th><th>重疊 m²</th><th>A 面積</th><th>B 面積</th><th>修後階 A／B</th><th>經緯度</th></tr>
${pairs.map((p, i) => `<tr class="${p.sameColor ? 'same' : ''}"><td>${i + 1}</td><td>${p.tile}</td><td>${esc(p.name)}</td><td>${p.a}</td><td>${p.b}</td><td>${p.overlap}</td><td>${p.areaA}</td><td>${p.areaB}</td><td class="${p.fixed ? '' : 'r'}">${p.levelA}／${p.levelB}</td><td><a href="https://www.openstreetmap.org/#map=19/${p.lonlat[1]}/${p.lonlat[0]}">${p.lonlat[1]}, ${p.lonlat[0]}</a></td></tr>`).join('\n')}</table>`);
console.log(JSON.stringify(sum, null, 1)); console.log('寫出', path.join(OUT, 'overlaps.html'));
process.exitCode = red.length ? 1 : 0;

// 把 verify_physical_no_overlap 的事件報告（建議 SAMPLE=4 連續掃描）整理成「一場一場的遭遇」並分家族。
//
// 為什麼要另開一支：閘門每 120 秒取樣，一場 8 秒的迎面互穿有 93% 機率量不到；2026-09-14 用 SAMPLE=4
// 掃 9/13 全日，閘門看到的 55 對變成 635 場獨立事件。數字要能對到「根因家族」才知道該修路網、
// 進路還是時間模型，所以這支除了合併連續取樣成區間，還用 network.json 的股道幾何判斷：
//   * 對向事件旁邊有沒有平行股道 —— 有＝雙線區間兩班車被派到同一股（派路），沒有＝單線交會點落在站間（時間模型）
//   * 一停一跑事件是不是同一對車「同月台」事件的進出站尾巴（相鄰 B 區間）
//
// 跑法：
//   node scripts/summarize_overlap_intervals.mjs <report.json> [--json out.json] [--list]
//   report 由 `SAMPLE=4 REPORT=... node scripts/verify_physical_no_overlap.mjs` 產生。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) throw Error('用法：node scripts/summarize_overlap_intervals.mjs <report.json> [--json out.json] [--list]');
const outJson = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const list = args.includes('--list');
const report = JSON.parse(readFileSync(file, 'utf8'));
const step = report.step || 4;
const hh = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
const cls = h => h.dwellA && h.dwellB ? 'B' : (!h.sameDir ? 'Ap' : (h.dwellA || h.dwellB ? 'C' : 'A'));

// ── 合併連續取樣成區間（同一對車，相鄰取樣間隔 ≤ step）────────────────────────
const byPair = new Map();
for (const e of report.events) { const k = [e.a, e.b].sort().join('/'); (byPair.get(k) || byPair.set(k, []).get(k)).push(e); }
const intervals = [];
for (const [pair, es] of byPair) {
  es.sort((x, y) => x.timeSec - y.timeSec);
  let cur = null;
  for (const e of es) {
    const holds = e.holds.split('/').map(Number);
    if (cur && e.timeSec - cur.end <= step) { cur.end = e.timeSec; cur.maxSharedM = Math.max(cur.maxSharedM, e.sharedM); cur.classes.add(cls(e)); cur.stops.add(e.stop); cur.holdMax = Math.max(cur.holdMax, ...holds); cur.edgeIds.add(e.edgeIds[0]); }
    else { cur = { pair, a: e.a, b: e.b, start: e.timeSec, end: e.timeSec, maxSharedM: e.sharedM, classes: new Set([cls(e)]), stops: new Set([e.stop]), holdMax: Math.max(...holds), edgeIds: new Set([e.edgeIds[0]]) }; intervals.push(cur); }
  }
}
for (const iv of intervals) { iv.durSec = iv.end - iv.start + step; iv.classes = [...iv.classes]; iv.stops = [...iv.stops]; iv.edgeIds = [...iv.edgeIds]; }

// ── 幾何：對向事件旁邊有沒有平行股道 ───────────────────────────────────────────
const net = JSON.parse(readFileSync(path.join(ROOT, 'rail-3d/physical/network.json'), 'utf8'));
const ways = net.ways.filter(w => w.system === 'tra_sched' && w.tags?.railway === 'rail');
const wayById = new Map(ways.map(w => [String(w.id), w]));
const M = 111320;
const segOf = (edgeId) => {
  const [wayId, idx] = edgeId.split(':'); const w = wayById.get(wayId); if (!w?.coordinates) return null;
  const i = Number(idx); const a = w.coordinates[i], b = w.coordinates[i + 1]; if (!a || !b) return null;
  return { wayId, a, b };
};
const toXY = (p, lat0) => [p[0] * M * Math.cos(lat0 * Math.PI / 180), p[1] * M];
// 平行股道判定：另一條 way 的某一段，中點距本段中點 ≤ 14 m、方向夾角 ≤ 25°、且不是 siding/crossover/yard
const parallelTrackNear = (seg) => {
  if (!seg) return null;
  const lat0 = seg.a[1]; const A = toXY(seg.a, lat0), B = toXY(seg.b, lat0);
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; const dir = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const hits = [];
  for (const w of ways) {
    if (String(w.id) === seg.wayId || !w.coordinates) continue;
    if (['siding', 'crossover', 'yard', 'spur'].includes(w.tags?.service)) continue;
    const c = w.coordinates; let best = Infinity;
    for (let i = 0; i + 1 < c.length; i++) {
      const P = toXY(c[i], lat0), Q = toXY(c[i + 1], lat0);
      const vx = Q[0] - P[0], vy = Q[1] - P[1], L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((mid[0] - P[0]) * vx + (mid[1] - P[1]) * vy) / L2));
      const d = Math.hypot(mid[0] - P[0] - vx * t, mid[1] - P[1] - vy * t);
      if (d > 14) continue;
      let ang = Math.abs(Math.atan2(vy, vx) - dir) % Math.PI; ang = Math.min(ang, Math.PI - ang);
      if (ang > 25 * Math.PI / 180) continue;
      if (d < best) best = d;
    }
    if (best < Infinity) hits.push({ wayId: String(w.id), distM: +best.toFixed(1), name: w.tags?.name || w.tags?.ref || '' });
  }
  hits.sort((x, y) => x.distM - y.distM);
  return hits;
};

// ── 家族 ───────────────────────────────────────────────────────────────────────
// 同一對車若有相鄰的 B（同月台）區間，C 區間視為它的進出站尾巴
const pairHasB = new Map();
for (const iv of intervals) if (iv.classes.includes('B')) pairHasB.set(iv.pair, true);
for (const iv of intervals) {
  const main = iv.classes.includes('A') ? 'A' : iv.classes.includes('Ap') ? 'Ap' : iv.classes.includes('C') && !iv.classes.includes('B') ? 'C' : 'B';
  iv.cls = main;
  if (main === 'Ap') {
    const seg = segOf(iv.edgeIds[0]); const par = parallelTrackNear(seg);
    iv.parallel = par ? par.slice(0, 3) : null;
    iv.family = par === null ? 'Ap-未知(way 無座標)' : par.length ? 'Ap-雙線同股(旁有平行股道→派路)' : 'Ap-單線交會落站間(→時間模型)';
  } else if (main === 'C') {
    const seg = segOf(iv.edgeIds[0]); const par = parallelTrackNear(seg);
    iv.parallel = par ? par.slice(0, 3) : null;
    iv.family = pairHasB.get(iv.pair) ? 'C-同月台進出尾巴(→月台指派)'
      : par === null ? 'C-未知(way 無座標)'
      : par.length ? 'C-通過車穿過停站車,旁有平行股道(→派路/月台指派)' : 'C-通過車穿過停站車,無平行股道(→路網缺股道/時間)';
  } else if (main === 'A') {
    iv.family = iv.holdMax >= 119 ? 'A-追撞頂到120s上限(→待避時間模型)' : 'A-追撞未頂上限';
  } else iv.family = 'B-同月台同節點(→月台指派/路網)';
}
const fam = {};
for (const iv of intervals) { const f = fam[iv.family] = fam[iv.family] || { n: 0, sec: 0, short: 0, pairs: new Set() }; f.n++; f.sec += iv.durSec; if (iv.durSec < 120) f.short++; f.pairs.add(iv.pair); }
console.log(`報告 ${file}\n服務日 ${report.serviceDate} 編組 ${report.formationProbe} 取樣 ${report.samples} 個時點（間隔 ${report.sample}s）命中 ${report.events.length} 筆 → 獨立事件 ${intervals.length} 場`);
console.log('閘門分類（每取樣點計）:', JSON.stringify(report.counts));
console.log('\n家族                                        場次   <120s   總秒數   涉及車對');
for (const [k, v] of Object.entries(fam).sort((x, y) => y[1].n - x[1].n)) console.log(`${k.padEnd(40, '　')} ${String(v.n).padStart(4)}  ${String(v.short).padStart(5)}  ${String(v.sec).padStart(7)}   ${v.pairs.size}`);
if (list) for (const iv of intervals.sort((x, y) => x.start - y.start)) console.log(`${iv.cls.padEnd(3)} ${iv.pair.padEnd(11)} ${hh(iv.start)}-${hh(iv.end)} ${String(iv.durSec).padStart(4)}s max=${iv.maxSharedM}m hold=${iv.holdMax} ${iv.stops.join(';')} ${iv.family}${iv.parallel ? ' 平行:' + iv.parallel.map(p => p.wayId + '@' + p.distM + 'm').join(',') : ''}`);
if (outJson) { writeFileSync(outJson, JSON.stringify({ source: file, serviceDate: report.serviceDate, formationProbe: report.formationProbe, step, intervals, families: Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, { ...v, pairs: v.pairs.size }])) }, null, 1)); console.log(`\n寫入 ${outJson}`); }

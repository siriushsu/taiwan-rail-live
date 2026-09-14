// 台鐵「相鄰兩站之間是單線還是雙線」表（data/tra_track_sections.json），交會／待避推論
// （index.html inferMeetPassTimes）用它決定對向車能不能在站間錯車。
//
// 為什麼要有這張表：2026-09-14 追根因（docs/tra-overlap-rootcause-0914.md R3）量到通過站時刻是
// 「單車孤立的跑段曲線」回填的，不看同站其他班車的官方停站窗——單線區間對向車的交會點於是落在
// 站間（9/13 全日 60 場迎面互穿）。要把通過時刻夾回交會窗，先得知道那一段是不是單線。
//
// 判法（純幾何，來源 rail-3d/physical/network.json，與 summarize_overlap_intervals.mjs 同一把尺）：
//   * 只看正線 way（railway=rail 且 service 不是 siding/crossover/yard/spur）。
//   * 一段 way 旁邊 14 公尺內有另一條正線 way 的一段、夾角 ≤25° ⇒ 這一段「有平行股道」。
//   * 站對的路徑取派車表（dispatch.json）裡真的派過的 pathIds，沿 walk 逐段累加「有平行股道的長度」，
//     佔比 ≥ 50% ⇒ 雙線（tracks=2），否則單線（tracks=1）。站區內的到發線也是正線 way，會把佔比
//     往上推一點，但站間長度佔絕對多數，門檻取一半足夠分開。
//   * 🔴 南迴線／臺東線有幾對【同名隧道 way】（中央隧道 81151555‖575059356 等）並排，是不是真的第二股
//     未核實（根因報告第 5 節）。這裡一律【不算】平行股道 ⇒ 判成單線。判單線的代價只是「多夾一次通過
//     時刻」，判雙線的代價是漏掉整段的交會推論，兩者不對稱，取保守。等人工核實後拿掉 UNVERIFIED_REFS 即可。
//
// 跑法：node scripts/build_tra_track_sections.mjs  → 寫 data/tra_track_sections.json 並印每站對一行供人眼核對。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeParallelIndex, isTrack, segLen } from './lib/parallel_tracks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const net = JSON.parse(readFileSync(path.join(ROOT, 'rail-3d/physical/network.json'), 'utf8'));
const dispatch = JSON.parse(readFileSync(path.join(ROOT, 'rail-3d/physical/dispatch.json'), 'utf8'));
// OSM 把「單一隧道、雙軌並列」的區段畫成一條 way（北迴線新觀音、新永春等隧道），幾何上量不到平行股道。
// 北迴線 2005 年雙軌電氣化全線完工是公開事實（交通部鐵道局），整條線一律雙線；其餘線別只信幾何。
const KNOWN_DOUBLE_REFS = { '北迴線': '北迴線雙軌電氣化 2005 年全線完工，OSM 雙軌隧道只畫一條 way' };
const DOUBLE_FRAC = 0.5;

const ways = net.ways;
// 平行股道的判準（14 m、25°、南迴／臺東同名隧道不算）與 repair_physical_directions.mjs 共用 scripts/lib/parallel_tracks.mjs。
const { hasParallel } = makeParallelIndex(ways);
// 沿 walk 走一條路徑：[[wayIndex, startIdx, signedCount], ...]
function pathStats(p) {
  let total = 0, par = 0; const refs = new Set();
  for (const [wi, start, cnt] of p.walk) {
    const w = ways[wi]; if (!w?.coordinates) continue;
    if (w.tags?.ref) refs.add(w.tags.ref);
    const n = Math.abs(cnt), dirn = Math.sign(cnt) || 1;
    for (let k = 0; k < n; k++) {
      // walk 的第二項是第一段的段序，反向走時段序是 start, start-1, …（與 restore_physical_routes.mjs／route-runtime.js 同一套；
      // 2026-09-14 前寫成 start-1 起算，反向的每一段都往前錯一段）。
      const i = start + k * dirn;
      if (i < 0 || i + 1 >= w.coordinates.length) continue;
      const L = segLen(w, i); total += L;
      if (isTrack(w) && hasParallel(w, i)) par += L;
    }
  }
  return { total, par, refs };
}
// 站對 ← 派車表：plan.stopSignature 第 i 站→第 i+1 站的路徑就是 pathIds[i]
const pairs = new Map();   // "A|B" → {total, par, paths:Set, refs:Set}
for (const [key, plan] of Object.entries(dispatch.plans)) {
  if (!key.startsWith('tra_sched:')) continue;
  const sig = JSON.parse(plan.stopSignature);
  for (let i = 0; i + 1 < sig.length; i++) {
    const a = sig[i][0].split(':')[1], b = sig[i + 1][0].split(':')[1];
    const pk = [a, b].sort().join('|');
    const rec = pairs.get(pk) || pairs.set(pk, { total: 0, par: 0, paths: new Set(), refs: new Set() }).get(pk);
    const pid = plan.pathIds[i]; if (rec.paths.has(pid)) continue;
    const p = net.paths[pid]; if (!p) continue;
    rec.paths.add(pid);
    const st = pathStats(p); rec.total += st.total; rec.par += st.par; for (const r of st.refs) rec.refs.add(r);
  }
}
const out = {};
for (const [pk, r] of [...pairs].sort((x, y) => x[0].localeCompare(y[0], 'zh-Hant'))) {
  const frac = r.total > 0 ? r.par / r.total : 0, refs = [...r.refs].sort();
  const known = refs.length && refs.every(x => KNOWN_DOUBLE_REFS[x]) ? refs.map(x => KNOWN_DOUBLE_REFS[x]).join('；') : null;
  out[pk] = { tracks: known || frac >= DOUBLE_FRAC ? 2 : 1, parallelFrac: +frac.toFixed(3), lengthM: Math.round(r.total / r.paths.size), refs, ...(known ? { override: known } : {}) };
}
const file = path.join(ROOT, 'data/tra_track_sections.json');
writeFileSync(file, JSON.stringify({
  version: 1,
  source_notes: '本站自算，無外部上游：由 rail-3d/physical/network.json（OSM 股道幾何）與 rail-3d/physical/dispatch.json（各站對實際派過的路徑）'
    + '算出相鄰兩站之間有平行正線股道的長度佔比，≥0.5 判雙線（tracks=2）否則單線（tracks=1）。'
    + '南迴線／臺東線同名隧道 way 是否為第二股未核實，一律不算平行股道。產生器 scripts/build_tra_track_sections.mjs。',
  pairs: out,
}, null, 1));
const byRef = {};
for (const [pk, v] of Object.entries(out)) { const k = v.refs.join('+') || '(無 ref)'; (byRef[k] = byRef[k] || []).push(`${pk} ${v.tracks === 2 ? '雙' : '單'} ${v.parallelFrac} ${v.lengthM}m`); }
for (const [k, list] of Object.entries(byRef).sort()) { console.log(`\n== ${k} ==`); for (const l of list) console.log('  ' + l); }
const n1 = Object.values(out).filter(v => v.tracks === 1).length;
console.log(`\n站對 ${Object.keys(out).length}：單線 ${n1}、雙線 ${Object.keys(out).length - n1} → ${file}`);

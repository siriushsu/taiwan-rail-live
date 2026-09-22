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
//   * 🔴 南迴線／臺東線那幾對【同名隧道 way】（中央隧道 81151555‖575059356 等）是不是真的第二股，
//     2026-09-14 已用官方 TDX GIS v3「實體路線」逐股幾何核實：8 對裡 6 對確認 TDX 也畫兩條（間距約 4 m）、
//     1 對（鳳林隧道）TDX 只畫一條、1 對（中央隧道 62 m 短段）樣本不足。核實過的現在【算】平行股道，
//     其餘維持不算。判單線的代價只是「多夾一次通過時刻」，判雙線的代價是漏掉整段交會推論，兩者不對稱，
//     所以沒核實的一律取保守。證據與門檻：scripts/build_tdx_parallel_evidence.mjs
//     → scripts/fixtures/tra-parallel-verified-tdx-0914.json。
//     🔴 2026-09-14 稍晚：使用者提供台鐵官方《路線修築沿革》（scripts/fixtures/tra-line-construction-history.csv）
//     後改判——官方沿革比 TDX 幾何上位，南迴線自 1991 通車只有電氣化、沒有任何「添築雙線」紀錄，
//     中央隧道／安朔隧道改回不算；山里隧道有「山里─臺東(雙線) 2013 添築雙線」佐證，維持算。逐對依據在
//     fixture 的 truthSource。
//   * 🔴 鍵一律用 lib/parallel_tracks.mjs 的 sectionKey()（站名正規化成班表用字「臺」再排序）：
//     派車表站名是 OSM 用字「台東」，班表是「臺東」，不正規化的話讀表端查不到又不會報錯（＝整個失明）。
//
//   對帳：產完會印一行「本站單／雙線里程 vs 官方」，官方值取 scripts/fixtures/tra-track-length-stats.json
//   （台鐵公司開放資料《臺鐵路線及軌道長度統計資料》）最後一年。只印給人看，不當閘門——涵蓋範圍本來就不同。
//
// 跑法：node scripts/build_tra_track_sections.mjs  → 寫 data/tra_track_sections.json 並印每站對一行供人眼核對。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeParallelIndex, isTrack, segLen, sectionKey } from './lib/parallel_tracks.mjs';
import { createRouteRuntime } from '../rail-3d/physical/route-runtime.js';

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
// maxPathM＝這個站對派過的路徑裡最長的那一條，給 index.html 當跑段剖面的站間長度下限（schedSegKmOf）。
// 為什麼要它：剖面原本只照示意線形的站間長建，畫車卻是把同一個比例投到實體股道上
// （rail-3d/physical/motion.js 的 sample()），點速＝剖面速度×（實體站間長÷示意站間長）。實測剖面會把
// 峰值夾在剛好等於車種極速，只要實體比示意長一點點就超速——2026-09-19 量到 271 段、137 班，
// 其中多數站對兩份幾何都在官方營業里程的 0.1 km 解析度內（和平–和仁：比例 1.003），修不了幾何。
// 取「最長」是因為同一站對不同班次會派到不同股道；剖面長 ≥ 任何一條會畫的路徑，點速就恆 ≤ 剖面速度。
// 長度用 route-runtime 的 unfold()＝畫車端量站間的同一段程式；無條件進位到公釐再加 1 公釐，
// 讓公尺→公里→公尺的浮點來回與 offsets 累加誤差永遠落在安全側。
const runtime = createRouteRuntime(net, null);
// 站對 ← 派車表：plan.stopSignature 第 i 站→第 i+1 站的路徑就是 pathIds[i]
const pairs = new Map();   // "A|B" → {total, par, maxPath, paths:Set, refs:Set}
for (const [key, plan] of Object.entries(dispatch.plans)) {
  if (!key.startsWith('tra_sched:')) continue;
  const sig = JSON.parse(plan.stopSignature);
  for (let i = 0; i + 1 < sig.length; i++) {
    const a = sig[i][0].split(':')[1], b = sig[i + 1][0].split(':')[1];
    const pk = sectionKey(a, b);   // 站名正規化成班表用字「臺」再排序，理由見 lib/parallel_tracks.mjs

    const rec = pairs.get(pk) || pairs.set(pk, { total: 0, par: 0, maxPath: 0, paths: new Set(), refs: new Set() }).get(pk);
    const pid = plan.pathIds[i]; if (rec.paths.has(pid)) continue;
    const p = net.paths[pid]; if (!p) continue;
    rec.paths.add(pid);
    const st = pathStats(p); rec.total += st.total; rec.par += st.par; for (const r of st.refs) rec.refs.add(r);
    rec.maxPath = Math.max(rec.maxPath, runtime.unfold(String(pid)).path.length);
  }
}
const out = {};
for (const [pk, r] of [...pairs].sort((x, y) => x[0].localeCompare(y[0], 'zh-Hant'))) {
  const frac = r.total > 0 ? r.par / r.total : 0, refs = [...r.refs].sort();
  const known = refs.length && refs.every(x => KNOWN_DOUBLE_REFS[x]) ? refs.map(x => KNOWN_DOUBLE_REFS[x]).join('；') : null;
  out[pk] = { tracks: known || frac >= DOUBLE_FRAC ? 2 : 1, parallelFrac: +frac.toFixed(3), lengthM: Math.round(r.total / r.paths.size),
    maxPathM: +((Math.ceil(r.maxPath * 1000) + 1) / 1000).toFixed(3), refs, ...(known ? { override: known } : {}) };
}
const file = path.join(ROOT, 'data/tra_track_sections.json');
writeFileSync(file, JSON.stringify({
  version: 1,
  source_notes: '本站自算，無外部上游：由 rail-3d/physical/network.json（OSM 股道幾何）與 rail-3d/physical/dispatch.json（各站對實際派過的路徑）'
    + '算出相鄰兩站之間有平行正線股道的長度佔比，≥0.5 判雙線（tracks=2）否則單線（tracks=1）。'
    + '南迴線／臺東線同名隧道 way 是否為第二股，2026-09-14 已用交通部 TDX GIS 圖資 v3「軌道路網實體路線」'
    + '（逐股道官方幾何，政府資料開放授權條款-1.0）逐對核實：核實過的算平行股道，未核實／經核實只有一股的仍不算。'
    + '核實證據 scripts/fixtures/tra-parallel-verified-tdx-0914.json（產生器 scripts/build_tdx_parallel_evidence.mjs）；'
    + 'TDX 與台鐵官方《路線修築沿革》衝突時以沿革為準（南迴線無添築雙線紀錄 ⇒ 不算；山里─臺東 2013 添築雙線 ⇒ 算）。'
    + 'maxPathM＝該站對派過的實體股道路徑中最長者（公尺，進位到公釐再加 1 公釐），index.html 建跑段剖面時站間長度取它與示意線形長的較大者，'
    + '畫在任一條實體股道或示意線形上的點速才不會超過剖面速度（＝不超過車種極速）。'
    + '鍵＝兩站名正規化成班表用字「臺」後排序、以 | 相接（讀表端 index.html 用班表站名查）。'
    + '產生器 scripts/build_tra_track_sections.mjs。',
  pairs: out,
}, null, 1));
const byRef = {};
for (const [pk, v] of Object.entries(out)) { const k = v.refs.join('+') || '(無 ref)'; (byRef[k] = byRef[k] || []).push(`${pk} ${v.tracks === 2 ? '雙' : '單'} ${v.parallelFrac} ${v.lengthM}m`); }
for (const [k, list] of Object.entries(byRef).sort()) { console.log(`\n== ${k} ==`); for (const l of list) console.log('  ' + l); }
const n1 = Object.values(out).filter(v => v.tracks === 1).length;
console.log(`\n站對 ${Object.keys(out).length}：單線 ${n1}、雙線 ${Object.keys(out).length - n1} → ${file}`);

// 對帳（只印，不當閘門）：官方《臺鐵路線及軌道長度統計資料》的單／雙線「路線里程」是全營業路線，
// 我們這張表只有「派車表真的派過的相鄰站對」，支線與無客運路段不在內，長度又取同站對各路徑的平均，
// 所以兩邊本來就不會相等；印出來是為了讓量級偏離（例如整條線被判錯邊）能被一眼看見。
const stats = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/tra-track-length-stats.json'), 'utf8'));
const y = stats[stats.length - 1];
let km1 = 0, km2 = 0;
for (const v of Object.values(out)) { if (v.tracks === 2) km2 += v.lengthM / 1000; else km1 += v.lengthM / 1000; }
const o1 = y['單線路線里程公里'], o2 = y['雙線路線里程公里'];
console.log(`對帳（只印不擋）：本表 單線 ${km1.toFixed(1)} km／雙線 ${km2.toFixed(1)} km ｜ 官方 ${y['年度']} 年度 單線 ${o1}／雙線 ${o2} km`
  + `（台鐵公司開放資料，政府資料開放授權條款-1.0）｜ 差 單線 ${(km1 - o1).toFixed(1)}／雙線 ${(km2 - o2).toFixed(1)} km`
  + `；涵蓋範圍不同（本表只含有派車計畫的相鄰站對 ${Object.keys(out).length} 對，不含支線與無客運路段）。`);

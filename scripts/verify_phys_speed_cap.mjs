// 實體股道層「畫車速度」不得超過車種極速（issue #15：速度不能超過車種極速，不留容差）。
//
// 為什麼另開一支、不沿用 verify_speed_cap.mjs：那支讀的是 trainPos／#fpSpd，#fpSpd 顯示前就
// 已經 Math.min(…, speedCapOf) 夾過，而立體地圖畫車走的是 railIslandPhysical.sample——它把
// 跑段剖面的「進度比例」直接乘到實體股道長上。2026-09-19 實測：剖面建在示意線形站間長
// （rpSegKm）上、峰值恰好貼齊極速，實體長比示意長長一點點，畫出來的點速就超標
// （台鐵 271 段／137 班，最多 +15 km/h），而 #fpSpd 照樣顯示一個夾過的合法數字。
// 所以這支**只量實體取樣器**：每 0.5 秒差分 chainage，不經任何顯示層夾限。
//
// 判準：
//   G1 physical 就緒，台鐵實體段覆蓋率具名斷言（分母不准無聲縮水）。
//   G2 預算剖面整批被採用（used>0、stale=0）——否則量到的是現算剖面，不是出貨的那份。
//   G3 台鐵：每個有實體股道表的站對都拿到 physKm（剖面長度的來源）；中間夾派車表沒有的通過站、3D 併成一段畫的，
//      各小段剖面長相加不短於前後兩站那一對的最長實體路徑；中間夾派車表沒有的停靠站、3D 停在那一站投影點的，
//      切開的每一截剖面長不短於那一截在這班車派到的路徑上的實體長（閘門自己投影）。
//   G4 台鐵：實體點速 ≤ 車種極速（數值誤差 1e-6 km/h，不是容差）；併段整段量，中途停靠站切開的逐截量。
//   G5 機捷：同上。
//   G6 台鐵：派車表沒有的中途停靠站，官方停留時段內 3D 停住、停在那一站座標投影到路徑上的點（2026-10 起的平鎮；
//      現行資料沒有這種站時是 0 站次，合成站的單元檢查在 verify_tra_plan_binding.mjs）。
//   高鐵只印資訊：剖面綁在派軌解上，改長度要重解六種日型的派軌，另案處理（已知最多 +1.75 km/h）。
//
// 跑法（自帶靜態站）：node scripts/verify_phys_speed_cap.mjs   可選 PORT=／ENGINE=webkit
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = Number(process.env.PORT || 0);
const EPS_KMH = 1e-6;
const MIN_TRA_SEGS = 30000; // 2026-09-19 實測 38k 段有實體取樣；塌到這以下代表 physical 沒接上
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
PORT = server.address().port; // 預設 0＝系統挑空埠並綁 127.0.0.1：原本寫死 5561 又不給 host，別棵樹的孤兒佔著 127.0.0.1:5561 時這裡照樣 listen 成功、請求卻被孤兒接走

// G0：量的是這棵樹
const md5 = f => createHash('md5').update(readFileSync(path.join(ROOT, f))).digest('hex');
const served = createHash('md5').update(Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   index.html disk=${md5('index.html')} serve=${served}\n   tra_run_profiles=${md5('data/tra_run_profiles.json')} tra_track_sections=${md5('data/tra_track_sections.json')}`);
if (served !== md5('index.html')) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.some(s => s.rp))
  && window.railIslandPhysical && typeof window.railIslandPhysical.sample === 'function', null, { timeout: 240000 });
await page.waitForTimeout(3000);

const r = await page.evaluate(async () => {
  const P = window.railIslandPhysical, EPS = 0.01, out = { pre: { ..._rpPre }, sys: {}, missPhysKm: [], tableHit: 0, mergedHit: 0, mergedShort: [], pieceHit: 0, pieceShort: [], cutStops: 0, cutMoved: [] };
  // 派車表沒有的台鐵中途站（2026-10 起的平鎮）3D 把前後兩段併成一段畫（plan-binding.js），取樣回報的 stopIndex
  // 是併段起點 ⇒ 照官方站序逐段量會漏掉併段後半截。這裡改成量整段併段；站集由閘門自己從派車表算，不取產品回報的站序。
  const { stationKey } = await import('/rail-3d/physical/timing.js');
  const known = new Set(Object.entries(P.dispatch.plans).filter(([k]) => k.startsWith('tra_sched:')).flatMap(([, p]) => JSON.parse(p.stopSignature).map(x => x[0])));
  for (const tr of state.trains) {
    const sys = tr.sys; if (!['tra_sched', 'thsr_sched', 'afr_sched'].includes(sys) || !tr.stops) continue;
    const o = out.sys[sys] || (out.sys[sys] = { segs: 0, trains: new Set(), over: [], worst: null });
    const s = tr.stops, cap = resolvePerf(tr).v;
    // 派車表沒有的中途站：通過站併進前後那一段（skipped），停靠站是切點（unknownStop），3D 在那裡停、前後逐截量。
    const unknown = i => sys === 'tra_sched' && !tr.loop && i > 0 && i < s.length - 1 && !known.has(stationKey(sys, s[i].name));
    const skipped = i => unknown(i) && s[i].stop === false, unknownStop = i => unknown(i) && s[i].stop !== false;
    // 切點在這班車派到的那一段路徑上的位置（離該段起點的公尺）：閘門自己拿站座標投影，不讀 motion 的 cuts。
    const rec = sys === 'tra_sched' && P.has(tr) ? P.record(tr) : null;
    const along = k => { const n = rec.stopIndexes.findIndex((x, m) => x < k && rec.stopIndexes[m + 1] > k), path = P.geometry.unfold(rec.plan.pathIds[n]).path;
      return { n, path, loc: path.locate([s[k].lon, s[k].lat]) }; };
    if (rec?.stopIndexes) for (let k = 1; k < s.length - 1; k++) if (unknownStop(k) && s[k].depSec > s[k].arrSec) {
      out.cutStops++; const { path, loc } = along(k), pt = path.at(loc.s).coordinate;
      const q = [s[k].arrSec + EPS, (s[k].arrSec + s[k].depSec) / 2, s[k].depSec - EPS].map(t => P.sample(tr, t));
      const off = q.map(x => x && x.physical ? haversineKm({ lat: x.lat, lon: x.lon }, { lat: pt[1], lon: pt[0] }) * 1000 : Infinity);
      // 0.01 m 是 route 與單段 path 各自累加里程的浮點誤差（實測 1e-9 m 級），不是停車位置的容差。
      if (!q.every(x => x && x.dwell && x.stopIndex === k && x.route === q[0].route && x.chainageM === q[0].chainageM) || !off.every(d => d <= 0.01))
        out.cutMoved.push(`${tr.train} ${s[k].name} dwell=${q.map(x => x?.dwell).join('/')} 離投影點 ${off.map(d => d.toFixed(3)).join('/')} m`);
    }
    for (let i = 0; i < s.length - 1; i++) {
      if (sys === 'tra_sched' && state.trackSections) {
        const p = state.trackSections[traSectionKey(s[i].name, s[i + 1].name)];
        if (p && p.maxPathM > 0) { out.tableHit++; if (!(s[i].physKm > 0)) out.missPhysKm.push(`${tr.train} ${s[i].name}→${s[i + 1].name}`); }
      }
      if (skipped(i)) continue;
      let j = i + 1; while (j < s.length - 1 && skipped(j)) j++;
      // 併段中間全是通過站時 3D 沿用同一條剖面：各小段剖面長相加不得短於前後兩站那一對的最長實體路徑（G3 同一條下限）。
      if (j > i + 1 && state.trackSections && s.slice(i + 1, j).every(x => x.stop === false)) {
        const p = state.trackSections[traSectionKey(s[i].name, s[j].name)];
        if (p && p.maxPathM > 0) {
          out.mergedHit++; const L = s.slice(i, j).reduce((n, x) => n + (x.rpSegKm || 0) * 1000, 0);
          if (!(L >= p.maxPathM - 1e-6)) out.mergedShort.push(`${tr.train} ${s[i].name}→${s[j].name} ${L.toFixed(3)}<${p.maxPathM}`);
        }
      }
      // 中途停靠站切開的一截：剖面長不得短於這班車派到的那一段路徑上、這一截的實體長（投影點切出來的長度）。
      if (rec?.stopIndexes && (unknownStop(i) || unknownStop(j)) && s.slice(i, j).every(x => x.rp)) {
        const pos = k => unknownStop(k) ? along(k).loc.s : null, a = pos(i), b = pos(j), n = along(unknownStop(i) ? i : j).n;
        const physM = (b ?? P.geometry.unfold(rec.plan.pathIds[n]).path.length) - (a ?? 0), L = s.slice(i, j).reduce((m, x) => m + x.rpSegKm * 1000, 0);
        out.pieceHit++; if (!(L >= physM)) out.pieceShort.push(`${tr.train} ${s[i].name}→${s[j].name} ${L.toFixed(3)}<${physM.toFixed(3)}`);
      }
      const t0 = s[i].depSec + EPS, t1 = s[j].arrSec - EPS; if (!(t1 > t0)) continue;
      const a = P.sample(tr, t0), b = P.sample(tr, t1);
      if (!a || !b || !a.physical || !b.physical || a.stopIndex !== i || b.stopIndex !== i || a.route !== b.route) continue;
      let peak = 0;
      for (let u = s[i].depSec; u + 0.5 <= s[j].arrSec; u += 0.5) {
        const p0 = P.sample(tr, u), p1 = P.sample(tr, u + 0.5);
        if (!p0 || !p1 || !p0.physical || !p1.physical || p0.route !== p1.route) continue;
        const v = (p1.chainageM - p0.chainageM) * 7.2; if (v > peak) peak = v;
      }
      o.segs++; o.trains.add(String(tr.train));
      const x = { train: String(tr.train), from: s[i].name, to: s[j].name, cap, dot: peak,
        physM: b.chainageM - a.chainageM, profM: s.slice(i, j).every(x => x.rp) ? s.slice(i, j).reduce((n, x) => n + x.rpSegKm * 1000, 0) : null };
      if (!o.worst || peak - cap > o.worst.dot - o.worst.cap) o.worst = x;
      if (peak > cap) o.over.push(x);
    }
  }
  for (const o of Object.values(out.sys)) o.trains = o.trains.size;
  return out;
});
await browser.close(); server.close();

const fmt = x => x ? `${x.train} ${x.from}→${x.to} 點速 ${x.dot.toFixed(3)}／極速 ${x.cap}（實體 ${x.physM.toFixed(0)} m，剖面 ${x.profM == null ? '—' : x.profM.toFixed(0) + ' m'}）` : '—';
const tra = r.sys.tra_sched || { segs: 0, trains: 0, over: [] }, afr = r.sys.afr_sched || { segs: 0, trains: 0, over: [] }, thsr = r.sys.thsr_sched;
t('頁面無 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));
t('G1 physical 就緒且台鐵實體段覆蓋率', tra.segs >= MIN_TRA_SEGS, `${tra.segs} 段／${tra.trains} 班（下限 ${MIN_TRA_SEGS}）`);
t('G2 預算剖面整批被採用', r.pre.used > 0 && r.pre.stale === 0, `used ${r.pre.used} stale ${r.pre.stale} local ${r.pre.local}`);
t('G3 有實體股道表的台鐵站間都帶 physKm', r.tableHit > 0 && r.missPhysKm.length === 0 && r.mergedShort.length === 0 && r.pieceShort.length === 0,
  `命中 ${r.tableHit} 站間，缺 ${r.missPhysKm.length}${r.missPhysKm.length ? '：' + r.missPhysKm.slice(0, 3).join('、') : ''}`
  + `；併段 ${r.mergedHit} 段，剖面短於實體 ${r.mergedShort.length}${r.mergedShort.length ? '：' + r.mergedShort.slice(0, 3).join('、') : ''}`
  + `；中途停靠站切開 ${r.pieceHit} 截，剖面短於實體 ${r.pieceShort.length}${r.pieceShort.length ? '：' + r.pieceShort.slice(0, 3).join('、') : ''}`);
const overBy = o => o.over.filter(x => x.dot > x.cap + EPS_KMH);
t('G4 台鐵實體點速 ≤ 車種極速', overBy(tra).length === 0,
  `${overBy(tra).length} 段／${new Set(overBy(tra).map(x => x.train)).size} 班超標；最接近上限：${fmt(tra.worst)}`);
t('G5 機捷實體點速 ≤ 車種極速', afr.segs > 0 && overBy(afr).length === 0,
  `${afr.segs} 段；${overBy(afr).length} 段超標；最接近上限：${fmt(afr.worst)}`);
t('G6 派車表沒有的中途停靠站：官方停留時段內 3D 停在投影點', r.cutMoved.length === 0,
  `${r.cutStops} 站次（現行資料沒有這種站時是 0），沒停住 ${r.cutMoved.length}${r.cutMoved.length ? '：' + r.cutMoved.slice(0, 3).join('、') : ''}`);
if (thsr) console.log(`INFO  高鐵（已知未修，需重解派軌）：${thsr.segs} 段，${overBy(thsr).length} 段超標；最嚴重：${fmt(thsr.worst)}`);
console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

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
//   G3 台鐵：每個有實體股道表的站對都拿到 physKm（剖面長度的來源）。
//   G4 台鐵：實體點速 ≤ 車種極速（數值誤差 1e-6 km/h，不是容差）。
//   G5 機捷：同上。
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

const r = await page.evaluate(() => {
  const P = window.railIslandPhysical, EPS = 0.01, out = { pre: { ..._rpPre }, sys: {}, missPhysKm: [], tableHit: 0 };
  for (const tr of state.trains) {
    const sys = tr.sys; if (!['tra_sched', 'thsr_sched', 'afr_sched'].includes(sys) || !tr.stops) continue;
    const o = out.sys[sys] || (out.sys[sys] = { segs: 0, trains: new Set(), over: [], worst: null });
    const s = tr.stops, cap = resolvePerf(tr).v;
    for (let i = 0; i < s.length - 1; i++) {
      if (sys === 'tra_sched' && state.trackSections) {
        const p = state.trackSections[traSectionKey(s[i].name, s[i + 1].name)];
        if (p && p.maxPathM > 0) { out.tableHit++; if (!(s[i].physKm > 0)) out.missPhysKm.push(`${tr.train} ${s[i].name}→${s[i + 1].name}`); }
      }
      const t0 = s[i].depSec + EPS, t1 = s[i + 1].arrSec - EPS; if (!(t1 > t0)) continue;
      const a = P.sample(tr, t0), b = P.sample(tr, t1);
      if (!a || !b || !a.physical || !b.physical || a.stopIndex !== i || b.stopIndex !== i || a.route !== b.route) continue;
      let peak = 0;
      for (let u = s[i].depSec; u + 0.5 <= s[i + 1].arrSec; u += 0.5) {
        const p0 = P.sample(tr, u), p1 = P.sample(tr, u + 0.5);
        if (!p0 || !p1 || !p0.physical || !p1.physical || p0.route !== p1.route) continue;
        const v = (p1.chainageM - p0.chainageM) * 7.2; if (v > peak) peak = v;
      }
      o.segs++; o.trains.add(String(tr.train));
      const x = { train: String(tr.train), from: s[i].name, to: s[i + 1].name, cap, dot: peak,
        physM: b.chainageM - a.chainageM, profM: s[i].rp ? s[i].rpSegKm * 1000 : null };
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
t('G3 有實體股道表的台鐵站間都帶 physKm', r.tableHit > 0 && r.missPhysKm.length === 0,
  `命中 ${r.tableHit} 站間，缺 ${r.missPhysKm.length}${r.missPhysKm.length ? '：' + r.missPhysKm.slice(0, 3).join('、') : ''}`);
const overBy = o => o.over.filter(x => x.dot > x.cap + EPS_KMH);
t('G4 台鐵實體點速 ≤ 車種極速', overBy(tra).length === 0,
  `${overBy(tra).length} 段／${new Set(overBy(tra).map(x => x.train)).size} 班超標；最接近上限：${fmt(tra.worst)}`);
t('G5 機捷實體點速 ≤ 車種極速', afr.segs > 0 && overBy(afr).length === 0,
  `${afr.segs} 段；${overBy(afr).length} 段超標；最接近上限：${fmt(afr.worst)}`);
if (thsr) console.log(`INFO  高鐵（已知未修，需重解派軌）：${thsr.segs} 段，${overBy(thsr).length} 段超標；最嚴重：${fmt(thsr.worst)}`);
console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

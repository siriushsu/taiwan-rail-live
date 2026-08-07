// staMap 建構驗收:站名正規化 → 站碼 → 下一停靠站索引。
// 判準對象是 index.html 裡的【產品函式】,不是本檔複製的版本——用 Playwright 求值真頁面。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // /api/thsr-schedule 例外:9f05f2f(2026-08-07)後 thsr_sched 的主要來源改成這支 API,
  // applySchedSystems 對每個系統的 sys.data.trains 直接 for..of,回 200 {} 會讓它非陣列而炸開機
  // (TypeError: sys.data.trains is not iterable,實測重現)。回 404 讓 App 自己的
  // fallbackUrl 機制接手退回 data/thsr_schedule_dense.json——這正是程式註解寫的
  // 「API 失敗(非 2xx/網路錯)退回打包靜態檔」設計路徑,不是本檔發明的行為。
  if (url.pathname === '/api/thsr-schedule') { res.statusCode = 404; return res.end('nf'); }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await page.goto(base, { waitUntil: 'networkidle' });
// state 是 index.html 頂層 const(classic script,非 module),不會掛在 window 上——
// window.state 恆為 undefined,故用 typeof 守門存取裸變數(既有慣例見 verify_live_activity.mjs boot())。
await page.waitForFunction(() => typeof state !== 'undefined' && state.stnInfoMap && Object.keys(state.stnInfoMap).length > 200, null, { timeout: 60000 });

// T1 全班表站名都對得上站碼(異體字＋括號註記)
const cover = await page.evaluate(() => {
  const names = new Set();
  for (const s of state.systems) {
    if (s.id !== 'tra_sched' || !s.data) continue;
    for (const t of (s.data.trains || [])) for (const st of (t.stops || [])) names.add(st.name);
  }
  const miss = [...names].filter(n => !state.stnInfoMap[traStnKey(n)]);
  return { total: names.size, miss };
});
ok('T1 班表站名 100% 對得上站碼', cover.total > 200 && cover.miss.length === 0,
   `${cover.total - cover.miss.length}/${cover.total}${cover.miss.length ? ' 缺:' + cover.miss.join(' ') : ''}`);

// T2 座標守門:名稱對上之後座標必須同點(專案原則:別名守門用座標,不用「名稱不撞」)
const geo = await page.evaluate(() => {
  let worst = 0, worstName = '';
  for (const s of state.systems) {
    if (s.id !== 'tra_sched' || !s.data) continue;
    for (const t of (s.data.trains || [])) for (const st of (t.stops || [])) {
      const i = state.stnInfoMap[traStnKey(st.name)];
      if (!i || st.lat == null) continue;
      const d = Math.hypot((i.lat - st.lat) * 111, (i.lon - st.lon) * 101);
      if (d > worst) { worst = d; worstName = `${st.name}→${i.name}`; }
    }
  }
  return { worst, worstName };
});
ok('T2 座標守門 全部 <1km', geo.worst < 1.0, `最大 ${geo.worst.toFixed(3)}km (${geo.worstName})`);

// T3 staMap 語意:通過站與停靠站都指向正確的「下一個停靠站」
const sem = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  const t = (sys.data.trains || []).find(x => String(x.train) === '554');
  if (!t) return { err: '班表無 554' };
  const map = buildStaMap(t.stops, state.stnInfoMap);
  const stopOnly = t.stops.filter(s => s.stop !== false);
  const idOf = n => state.stnInfoMap[traStnKey(n)].id;
  return {
    n: Object.keys(map).length, stops: stopOnly.length, passed: t.stops.length,
    fromStop: map[idOf('潮州')], fromPass: map[idOf('竹田')],
    fromStopName: stopOnly[map[idOf('潮州')]] && stopOnly[map[idOf('潮州')]].name,
    fromPassName: stopOnly[map[idOf('竹田')]] && stopOnly[map[idOf('竹田')]].name,
    terminusHas: map[idOf(t.stops[t.stops.length - 1].name)],
  };
});
ok('T3a 離開停靠站→下一停靠站正確', sem.fromStopName === '屏東', `潮州→${sem.fromStopName}(idx ${sem.fromStop})`);
ok('T3b 離開通過站→下一停靠站正確', sem.fromPassName === '屏東', `竹田→${sem.fromPassName}(idx ${sem.fromPass})`);
ok('T3c 終點站沒有下一站', sem.terminusHas === undefined, `終點值=${sem.terminusHas}`);

// T4 全車次都建得出非空 staMap(正向對照:證明不是「函式回空物件也全過」)
const all = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  let empty = 0, tot = 0, maxN = 0;
  for (const t of (sys.data.trains || [])) {
    const n = Object.keys(buildStaMap(t.stops, state.stnInfoMap)).length;
    tot++; if (!n) empty++; if (n > maxN) maxN = n;
  }
  return { tot, empty, maxN };
});
ok('T4 全車次 staMap 皆非空', all.tot > 500 && all.empty === 0 && all.maxN > 50,
   `${all.tot} 車次、空 ${all.empty} 個、最大 ${all.maxN} 筆`);

// T5 stopCodes 與停靠站同序同長且無 null
const sc = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  const t = (sys.data.trains || []).find(x => String(x.train) === '554');
  const codes = buildStopCodes(t.stops, state.stnInfoMap);
  const stopOnly = t.stops.filter(s => s.stop !== false);
  return { len: codes.length, want: stopOnly.length, nulls: codes.filter(x => !x).length, first: codes[0] };
});
ok('T5 stopCodes 同序同長且無 null', sc.len === sc.want && sc.nulls === 0,
   `${sc.len}/${sc.want}、null ${sc.nulls}、首筆 ${sc.first}`);

await browser.close(); server.close();
const bad = results.filter(r => !r.p).length;
console.log(`\n總計 ${results.length} 項,FAIL ${bad}`);
process.exit(bad ? 1 : 0);

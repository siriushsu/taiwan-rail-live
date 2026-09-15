import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5497);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const failures = [];
const ok = (engine, name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(`${engine} ${name}`);
};

for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await launcher.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*tra-live*', r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    const NativeDate = Date, fixed = new NativeDate('2026-09-15T07:43:00+08:00').getTime();
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  });
  await page.goto(`http://127.0.0.1:${PORT}/?g=tra&t=07:43`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.trains?.length > 300, null, { timeout: 120_000 });
  await page.waitForFunction(() => !!window.railIslandPhysical, null, { timeout: 120_000 });
  const report = await page.evaluate(() => {
    const train = no => state.trains.find(t => String(t.train) === no);
    const inspect = (leaderNo, followerNo, station, dir) => {
      const leader = train(leaderNo), follower = train(followerNo), wait = leader?.stops.find(s => s.name === station && s._plannedDwell);
      if (!leader || !follower || !wait) return { missing: true };
      const followerAt = follower.stops.find(s => s.name === station), mid = (wait.arrSec + wait.depSec) / 2;
      const samples = [wait.arrSec + 1, mid, wait.depSec - 1].map(t => trainPosAt(leader, t));
      const same = samples.every((p, i) => i === 0 || Math.hypot(p.lat - samples[0].lat, p.lon - samples[0].lon) < 1e-12);
      const flips = []; let prior = null;
      for (let t = Math.floor(wait.arrSec - 180); t <= Math.ceil(wait.depSec + 180); t++) {
        const a = trainSeg(leader, t), b = trainSeg(follower, t);
        if (!a?.ln || a.ln !== b?.ln || a.dir !== b.dir) { prior = null; continue; }
        const sign = Math.sign((a.d - b.d) * a.dir);
        if (sign && prior && sign !== prior.sign) flips.push({ t, dwell: a.dwell, stationDelta: Math.abs(a.d - wait.dA) });
        if (sign) prior = { sign };
      }
      let maxKmh = 0, backwards = 0, prev = null;
      for (let t = Math.floor(leader.stops[0].arrSec); t <= Math.ceil(leader.stops.at(-1).depSec); t++) {
        const p = trainPosAt(leader, t); if (!p) { prev = null; continue; }
        if (prev) {
          const km = haversineKm(prev.p, p), kmh = km * 3600; maxKmh = Math.max(maxKmh, kmh);
          const ga = trainSeg(leader, prev.t), gb = trainSeg(leader, t);
          if (ga?.ln && ga.ln === gb?.ln && ga.dir === gb.dir && (gb.d - ga.d) * ga.dir < -1e-6) backwards++;
        }
        prev = { p, t };
      }
      return { missing: false, station: wait.name, stopFlag: wait.stop, by: wait._overtakeBy,
        dwellSec: wait.depSec - wait.arrSec, clearance: wait.depSec - followerAt.depSec,
        brakingLead: followerAt.arrSec - wait.arrSec, required: OVERTAKE_CLEAR_SEC + resolvePerf(leader).v / resolvePerf(leader).b,
        same, physical: samples.every(p => p?.physical), binding: railIslandPhysical.record(leader)?.bindingBasis,
        flips, maxKmh, cap: speedCapOf(leader), backwards, direction: Math.sign(wait.dB - wait.dA), expectedDirection: dir };
    };
    return { build: BUILD, day: state.data?._schedDay, planned: state._meetStats?.planned,
      forward: inspect('6563', '207', '崇德', 1), reverse: inspect('114', '228', '五堵', -1) };
  });
  for (const [name, row] of [['順向 6563／207', report.forward], ['反向 114／228', report.reverse]]) {
    ok(engine, `${name} 有預排待避`, !row.missing, JSON.stringify(row));
    if (row.missing) continue;
    ok(engine, `${name} 回找的站留足煞車時間`, row.brakingLead >= row.required, `${row.brakingLead.toFixed(1)}s ≥ ${row.required.toFixed(1)}s`);
    ok(engine, `${name} 後車清站 30 秒才放行`, Math.abs(row.clearance - 30) < .01, `${row.clearance.toFixed(3)}s`);
    ok(engine, `${name} 待避期間停在同一座標`, row.same && row.physical, `固定=${row.same}／實體股道=${row.physical}／${row.binding}`);
    ok(engine, `${name} 前後次序只在站內交換`, row.flips.length === 1 && row.flips[0].dwell && row.flips[0].stationDelta < .001, JSON.stringify(row.flips));
    // 實體股道弧長與 2D 跑段里程有約 3–4% 的來源差（6563 東澳段基線即為 124.1 vs 120），
    // 這裡抓待避造成的倒退／異常衝刺，容許既有幾何差 5%；使用者看到的速度表另有 speedCapOf 硬夾限。
    ok(engine, `${name} 不倒退且無異常加速`, row.backwards === 0 && row.maxKmh <= row.cap * 1.05,
      `實體股道最大 ${row.maxKmh.toFixed(1)}／模型上限 ${row.cap} km/h，倒退 ${row.backwards}`);
    ok(engine, `${name} 覆蓋正確行車方向`, row.direction === row.expectedDirection, `${row.direction}`);
  }
  ok(engine, '頁面無 runtime 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close(); await browser.close();
}

server.close();
if (failures.length) { console.error(`\n${failures.length} 項失敗：${failures.join('、')}`); process.exit(1); }
console.log('\n預排待避：雙方向、煞車提前量、站內停等、實體股道與速度連續性全部通過');

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'app', 'www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const server = http.createServer(async (req, res) => {
  try {
    const raw = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
const url = `http://127.0.0.1:${server.address().port}/`;

async function prepare(page, email = 'sirius1984@gmail.com') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof passportShowcaseEligible === 'function' && typeof renderRidePanel === 'function');
  await page.waitForFunction(() => state && state.special && Array.isArray(state.schedStations) && state.schedStations.length >= 100, null, { timeout: 30000 });
  return page.evaluate(ownerEmail => {
    localStorage.clear();
    state.account = { ready: true, user: { uid: 'owner-fixture', email: ownerEmail, displayName: '軌島擁有者' }, syncing: false, lastSync: Date.now(), actionError: '', error: '' };
    state.plus = { active: true, founding: true, cloudSyncReady: true };
    accountRender();
    const before = {
      envelope: localStorage.getItem('rail-user-data-v1'),
      rides: localStorage.getItem('trainmap-rides'),
      checkins: localStorage.getItem('trainmap-checkins'),
    };
    document.getElementById('ridePanel').hidden = false;
    renderRidePanel();
    return before;
  }, email);
}

async function inspect(page, before) {
  const out = await page.evaluate(snapshot => {
    const panel = document.getElementById('ridePanel');
    const after = {
      envelope: localStorage.getItem('rail-user-data-v1'),
      rides: localStorage.getItem('trainmap-rides'),
      checkins: localStorage.getItem('trainmap-checkins'),
    };
    const headers = [...panel.querySelectorAll('.ph-sec')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
    return {
      eligible: passportShowcaseEligible(), on: passportShowcaseOn(),
      status: panel.querySelector('.ride-stats')?.textContent.replace(/\s+/g, ' ').trim(),
      banner: panel.querySelector('.passport-showcase')?.textContent.replace(/\s+/g, ' ').trim(),
      achievements: panel.querySelectorAll('.achv-chip.on').length,
      lockedAchievements: panel.querySelectorAll('.achv-chip:not(.on)').length,
      lockedCollection: panel.querySelectorAll('.ph-stamps .seal.na').length,
      lineDone: panel.querySelectorAll('.ph-line .pl-pct.done').length,
      rideRows: panel.querySelectorAll('.ph-row').length,
      stationHeader: headers.find(x => x.startsWith('車站收集')) || '',
      accountButton: document.querySelector('#accountBody [data-action="showcase"]')?.textContent.trim(),
      unchanged: JSON.stringify(snapshot) === JSON.stringify(after),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  }, before);
  assert(out.eligible && out.on, '擁有者在 build 22 未自動開啟展示');
  assert((out.status || '').includes('站 100') && out.status.includes('成就 21') && out.status.includes('完乘 15'), `展示統計不完整: ${out.status}`);
  assert(out.achievements === 21 && out.lockedAchievements === 0, `成就不是 21/21: ${out.achievements}`);
  assert(out.lockedCollection === 0, `圖鑑還有 ${out.lockedCollection} 枚未收集`);
  assert(out.lineDone === 6 && out.rideRows === 15, `路線/完乘示範數不對: ${out.lineDone}/${out.rideRows}`);
  assert(out.stationHeader.includes('100'), `百站沒有顯示: ${out.stationHeader}`);
  assert(out.banner?.includes('真正的完乘') && out.accountButton === '查看我的真實護照', '展示警示或切換入口缺失');
  assert(out.unchanged, '展示模式改寫了真實護照儲存');
  assert(out.scrollWidth <= out.clientWidth + 1, `水平溢出 ${out.scrollWidth}/${out.clientWidth}`);
  return out;
}

const results = [];
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const width of [360, 375, 414, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const before = await prepare(page);
        const out = await inspect(page, before);
        await page.evaluate(() => closeRidePanel());
        await page.tap('#tabRide');
        assert(await page.locator('#ridePanel').isVisible(), `${name}/${width}: 觸控點護照沒開`);
        const point = await page.locator('#tabRide').evaluate(el => {
          const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { hit: hit === el || el.contains(hit), width: r.width, height: r.height };
        });
        assert(point.hit && point.width >= 44 && point.height >= 44, `${name}/${width}: 護照觸控目標不可點或小於 44px`);
        if (name === 'chromium' && width === 375) await page.screenshot({ path: '/private/tmp/rail-owner-passport-375.png' });
        results.push({ engine: name, width, ...out, touch: point });
        await context.close();
      }
    } finally { await browser.close(); }
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await prepare(page, 'someone@example.com');
    const outsider = await page.evaluate(() => ({ eligible: passportShowcaseEligible(), on: passportShowcaseOn(), button: !!document.querySelector('[data-action="showcase"]') }));
    assert(!outsider.eligible && !outsider.on && !outsider.button, '非擁有者帳號看到展示入口');
  } finally { await browser.close(); }

  console.log(JSON.stringify({ ok: true, build: 22, achievements: 21, cases: results }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
}

// 重播巡檢封存的正式回覆，測真實 Chromium/WebKit 看板與手機觸控，不連正式 API。
// METRO_CAPTURE_DIR 指向巡檢的 work/overall-audit（含 browser.json 與 response-*.json）。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const capture = process.env.METRO_CAPTURE_DIR;
assert(capture, '請指定 METRO_CAPTURE_DIR：使用封存真實資料，不自製高分來源');
const audit = JSON.parse(fs.readFileSync(path.join(capture, 'browser.json'), 'utf8'));
const now = audit.frames.at(-1).at * 1000;
const payloads = new Map();
for (const rec of audit.network) if (rec.status === 200 && rec.body) {
  const url = new URL(rec.url);
  payloads.set(url.pathname + url.search, fs.readFileSync(path.join(capture, rec.body), 'utf8'));
}
const mime = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      for (const width of [360, 375, 414, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.addInitScript(now => {
          const NativeDate = Date;
          window.__auditNow = now;
          window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [window.__auditNow])); }
            static now() { return window.__auditNow; }
          };
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-lang', 'zh-TW');
        }, now);
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          const body = payloads.get(url.pathname + url.search);
          if (body) return route.fulfill({ contentType: 'application/json', body });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{"rows":[],"trains":[],"list":[],"board":[],"src":null}' });
          if (url.origin !== base) return route.abort();
          return route.continue();
        });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.systems &&
          ['krtc', 'ntdlrt', 'ntalrt', 'tymc'].every(id => state.systems.some(s => s.id === id && s.data && s._times)), null, { timeout: 45000 });
        await page.evaluate(async () => {
          selectGroup(GROUPS.find(g => g.id === 'metro'), true);
          await Promise.all([pollMetroCore(), pollMetroLive(), pollNtmLive()]);
        });
        await page.waitForFunction(() => state._metroLiveRaw?.krtc && state._metroLiveRaw?.tymc && state._ntmLiveRaw?.ankeng && state.metroCore?.snapshot, null, { timeout: 20000 });
        const sources = await page.evaluate(() => {
          const out = [];
          for (const id of ['KR', 'KO', 'A', 'V', 'VB', 'K']) {
            const ln = state.lines.find(l => l.id === id);
            state.visible.add(id);
            const choices = ln.stations.map((st, si) => ({ st, si, rows: metroSourceRowsForEntry({ ln, si, li: state.lines.indexOf(ln) }) }))
              .filter(x => x.rows.length).sort((a, b) => b.rows.length - a.rows.length);
            if (!choices.length) { out.push({ line: id, missing: true }); continue; }
            const chosen = choices[0];
            const view = metroCoreBoardView(chosen.st, state.lines, false);
            const rows = view.groups.filter(g => g.ln.id === id && g.kind === 'source').flatMap(g => g.rows);
            const exported = webMcpMetroBoardRows(chosen.st, state.lines, false, 100)
              .filter(r => r.line_id === id && r.data_basis === 'official_realtime_board');
            out.push({ line: id, station: chosen.st.name, index: chosen.si, rows: rows.length,
              exported: exported.length, exportTimesValid: exported.every(r => /^\d{2}:\d{2}$/.test(r.arrival_time)),
              linked: rows.filter(r => r.vehicleId).length, core: metroCoreItemsForLine(ln)?.length ?? null,
              sourceEpochs: rows.map(r => r.arrivalEpoch), precision: rows.map(r => r.precision) });
          }
          return out;
        });
        assert(sources.every(s => !s.missing && s.rows > 0 && s.exported === s.rows && s.exportTimesValid), JSON.stringify(sources));
        assert(sources.filter(s => ['KR', 'KO'].includes(s.line)).every(s => s.core === null && s.rows > 0),
          '本次真實語料的高捷位置應保留防護，但官方倒數不能跟著消失');
        for (const selected of sources) {
          await page.evaluate(({ line, index }) => {
            const ln = state.lines.find(l => l.id === line);
            openBoard({ ...ln.stations[index], sys: ln._sys });
          }, selected);
          await page.waitForFunction(() => document.querySelectorAll('#board .row[data-core-record]').length > 0);
          const shown = await page.evaluate(line => {
            const el = document.getElementById('board'), rect = el.getBoundingClientRect();
            const records = el._metroCoreRecords || [];
            return { source: records.filter(r => r.kind === 'source' && r.ln.id === line).length,
              overflow: el.scrollWidth - el.clientWidth, left: rect.left, right: rect.right,
              bodyOverflow: document.documentElement.scrollWidth - innerWidth,
              text: el.querySelector('.row .min')?.textContent };
          }, selected.line);
          assert(shown.source > 0, `${engine}/${width}/${selected.line} 沒顯示來源列`);
          assert(shown.overflow <= 2 && shown.bodyOverflow <= 2, JSON.stringify(shown));
          assert(shown.left >= -1 && shown.right <= width + 1, JSON.stringify(shown));
          const unlinked = page.locator('#board .row[data-core-record]:not([data-core-vehicle])').first();
          if (await unlinked.count()) {
            const before = await page.evaluate(() => !!state.freqFollow);
            await unlinked.tap();
            assert.equal(await page.evaluate(() => !!state.freqFollow), before, '未連結倒數誤追班表車');
          }
          await page.locator('#boardClose').tap();
          assert.equal(await page.evaluate(() => state.boardStation), null, '手機關閉看板失效');
        }
        const stale = await page.evaluate(() => {
          window.__auditNow += 151000;
          const ln = state.lines.find(l => l.id === 'KR');
          return ln.stations.reduce((sum, _st, si) => sum + metroSourceRowsForEntry({ ln, si }).length, 0);
        });
        assert.equal(stale, 0, '過期來源仍偽裝成即時');
        assert.deepEqual(errors, []);
        const result = { engine, width, sources, errors, staleRows: stale };
        results.push(result);
        console.log(JSON.stringify(result));
        await context.close();
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
if (process.env.METRO_RESULT) fs.writeFileSync(process.env.METRO_RESULT, JSON.stringify({ method: 'Captured production responses; functional browser replay, not accuracy scoring', results }, null, 2));
console.log(`PASS ${results.length} 組瀏覽器／手機寬度，6 條線官方倒數與觸控驗證`);

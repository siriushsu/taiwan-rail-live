// 真頁面、雙引擎、手機真觸控；只固定班表時刻，不 stub renderer／跟隨行為。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium, webkit } = await import(process.env.KLRT_TEST_PLAYWRIGHT || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'));
const trips = JSON.parse(readFileSync(path.join(root, 'data/krtc_times.json'))).lines.C.sets['平日'];
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.resolve(root, '.' + pathname);
  if (!(file === root || file.startsWith(root + path.sep)) || pathname.startsWith('/api/') || !existsSync(file)) { res.writeHead(404); return res.end('{}'); }
  if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const digest = b => createHash('sha256').update(b).digest('hex');
assert.equal(digest(await (await fetch(base)).arrayBuffer().then(b => Buffer.from(b))), digest(html));
console.log('驗收 HTML SHA256', digest(html));
let cases = 0;
try {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      for (const width of [360, 375, 390, 414, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
        await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
        await page.goto(base + '/?g=metro&lang=zh-TW', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.lines?.some(l => l.id === 'C' && l._tt?.length), null, { timeout: 60000 });
        const open = async (deco = false, stationIndex = 5, at = 8 * 3600 + 57 * 60) => {
          await page.evaluate(({ trips, deco, stationIndex, at }) => {
            if (deco && state.group !== 'all') selectGroup(GROUPS.find(g => g.id === 'all'));
            if (!deco && state.group !== 'metro') selectGroup(GROUPS.find(g => g.id === 'metro'));
            state.playing = false; setSimSec(at);
            const ln = (deco ? state.decoLines : state.lines).find(l => l.id === 'C' && l._sys === 'krtc');
            ln._tt = trips;
            ln._liveShift = null; ln._gpsShifts = null;
            openBoard({ ...ln.stations[stationIndex], sys: deco ? 'deco' : 'freq', metroSysId: 'krtc' });
          }, { trips, deco, stationIndex, at });
          await page.locator('#board .klrt-board-row').first().waitFor({ state: 'attached' });
        };
        for (const deco of [false, true]) for (const dark of [false, true]) {
          await page.evaluate(dark => document.documentElement.dataset.theme = dark ? 'dark' : 'light', dark);
          await open(deco);
          const text = await page.locator('#board').textContent();
          assert(text.includes('順行') && text.includes('逆行') && text.includes('駁二大義') && text.includes('夢時代'), `${engine}/${width}/${deco}/${dark} 方向文字`);
          assert.equal(await page.locator('#board .klrt-board-row').count(), 4);
          const times = await page.locator('#board .klrt-board-row .t').allTextContents();
          assert.deepEqual(times.sort(), ['09:00','09:08','09:11','09:26']);
          if (dark) {
            assert.equal(await page.locator('#board .night-directions button').count(), 2);
            await page.tap('#board .night-directions button:nth-child(2)');
            assert.equal(await page.locator('#board .night-directions button:nth-child(2)').getAttribute('aria-pressed'), 'true');
          }
          const compact = await page.evaluate(deco => {
            const el = document.createElement('div');
            el.innerHTML = renderFreqBoard(null, state.boardStation, metroBoardLines(state.boardStation, deco ? state.decoLines : state.lines), deco, { compact: true });
            return [...el.querySelectorAll('.row')].map(r => r.querySelector('b').textContent);
          }, deco);
          assert.deepEqual(compact.sort(), ['逆行','順行'].sort(), '查詢摘要各保留一向');
          // 全畫面＋既有板(sheet)；量所有可見互動控件，排除祖孫與刻意包含的容器。
          for (const full of [false, true]) {
            await page.evaluate(full => { document.body.classList.toggle('fs', full); dispatchEvent(new Event('resize')); }, full);
            const layout = await page.evaluate(() => {
              boardAlignColumns(document.getElementById('board'));
              const visible = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
              const controls = [...document.querySelectorAll('button, a[href], input, select, [role="button"], .row[data-ci]')].filter(visible);
              const board = document.getElementById('board');
              const rows = [...board.querySelectorAll('.klrt-board-row')].filter(visible);
              const clipped = rows.filter(r => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > innerWidth + 1).map(r => r.textContent);
              const pairOverlap = [];
              for (const r of rows) for (const c of controls) {
                if (c === r || c.contains(r) || r.contains(c) || board.contains(c)) continue;
                const a = r.getBoundingClientRect(), b = c.getBoundingClientRect();
                if (Math.min(a.right,b.right) - Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 1) pairOverlap.push(c.id || c.className);
              }
              return { overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped, controls: controls.length, pairOverlap };
            });
            assert.equal(layout.overflow, false, JSON.stringify(layout));
            assert.deepEqual(layout.clipped, [], JSON.stringify(layout));
            // 重疊可為浮層遮住底下控件；觸控命中另外逐列驗，避免把合法遮罩誤當 bug。
            assert(layout.controls > 5);
            cases++;
          }
          await page.evaluate(() => document.body.classList.remove('fs'));
          // 真的觸控每向第一班：scrollIntoView 後中心必須是自己，且跟隨相同 trip。
          for (const direction of ['逆行', '順行']) {
            await open(deco, 5, 9 * 3600 + 60); // 兩班均已由起點發車，才驗真正跟車
            if (dark) await page.locator('#board .night-directions button').filter({ hasText: direction }).tap();
            const row = page.locator('#board .klrt-board-row').filter({ has: page.locator('b', { hasText: direction }) }).first();
            await row.scrollIntoViewIfNeeded();
            const expected = await row.getAttribute('data-ci');
            const target = await row.evaluate(r => { const b = r.getBoundingClientRect(); return { x:b.x+b.width/2, y:b.y+b.height/2, hit:r.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)) }; });
            assert(target.hit, `${engine}/${width}/${deco}/${dark}/${direction} 真觸控命中`);
            await page.tap(`#board .klrt-board-row[data-ci="${expected}"]`);
            const correct = await page.evaluate(({ ci, deco }) => {
              const ln = (deco ? state.decoLines : state.lines).find(l => l.id === 'C');
              return { sameLine: state.freqFollow?.ln === ln, sameTrip: state.freqFollow?.tr === ln._tt[ci], keys: Object.keys(state.freqFollow || {}), actualTrip: state.freqFollow?.tr?.slice(0, 6), expectedTrip: ln._tt[ci]?.slice(0, 6), ci, deco };
            }, { ci: Number(expected), deco });
            assert(correct.sameLine && correct.sameTrip, `${engine}/${width}/${dark}/${direction} 跟隨不可接成反方向或另一班 ${JSON.stringify(correct)}`);
          }
        }
        // 外語＋特大字、公告、更多抽屜同時存在。公告走真 state，手機依法顯示晶片而非硬造橫幅。
        for (const lang of ['en','ja']) {
          await page.evaluate(lang => setLanguage(lang), lang);
          await open(false);
          await page.evaluate(() => {
            document.documentElement.dataset.fs = 'xlarge';
            document.body.classList.add('fs');
            state.alert = { list:[{ sys:'krtc', sysLabel:'高雄捷運', title:'測試公告', start:'2026-09-28T09:00:00+08:00' }] };
            renderAlertBanner(); renderBoard();
          });
          const rows = await page.locator('#board .klrt-board-row').allTextContents();
          assert.equal(rows.length, 4);
          const labels = await page.locator('#board .klrt-board-row > b').allTextContents();
          assert.deepEqual([...new Set(labels)].sort(), (lang === 'en' ? ['Clockwise','Counterclockwise'] : ['時計回り','反時計回り']).sort(), `${lang} 方向須翻譯：${rows}`);
          if (lang === 'en') assert(rows.every(r => !/駁二|夢時代/.test(r)), `英文途經站須翻譯：${rows}`);
          const clipping = await page.locator('#board .klrt-board-row').evaluateAll(rows => rows.filter(r => {
            const s = getComputedStyle(r); if (s.display === 'none') return false;
            return r.scrollWidth > r.clientWidth + 1 || [...r.children].some(c => c.scrollWidth > c.clientWidth + 1);
          }).map(r => r.textContent));
          assert.deepEqual(clipping, [], `${engine}/${width}/${lang} 方向及途經站不得截字`);
          await page.tap('#tabMore');
          await page.waitForFunction(() => document.body.classList.contains('tools-open'));
          assert(await page.locator('#moreClose').evaluate(e => { const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), '抽屜關閉鈕不能被看板蓋住');
          await page.tap('#moreClose');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          if (width === 390 && lang === 'en') await page.screenshot({ path:`/private/tmp/klrt-board-${engine}-390-en.png` });
          await page.evaluate(() => { delete document.documentElement.dataset.fs; document.body.classList.remove('fs'); state.alert=null; renderAlertBanner(); });
          cases++;
        }
        assert.deepEqual(errors, [], '頁面不得有執行例外');
        console.log(`PASS ${engine} ${width}px 雙向／同框／明暗／全畫面／compact／觸控跟隨`);
        await context.close();
      }
    } finally { await browser.close(); }
  }
  console.log(`PASS ${cases} 版面狀態，雙引擎 × 5 手機寬度`);
} finally { await new Promise(r => server.close(r)); }

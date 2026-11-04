import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.RAIL_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.RAIL_KO_EVIDENCE || '/tmp/railisland-ko-1104';
fs.mkdirSync(output, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.geojson': 'application/geo+json', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (url.pathname.startsWith('/api/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
assert.equal(await (await fetch(base)).text(), fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
const results = [];
const failures = [];
async function prepare(browser, width, mobile = true, locale = 'ko-KR', query = '') {
  const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 1024 : 844 }, isMobile: mobile, hasTouch: mobile, locale });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + query, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready && (state.trains.length || state.lines.length), null, { timeout: 90000 });
  } catch (error) {
    console.error('BOOT', JSON.stringify(await page.evaluate(() => ({ lang: document.documentElement.lang, i18n: !!window.__i18n, ready: typeof state !== 'undefined' ? state.ready : null, text: document.body.innerText.slice(-800) }))), errors);
    await page.screenshot({ path: path.join(output, 'boot-failure.png') });
    await context.close();
    throw error;
  }
  return { context, page, errors };
}
async function audit(page, scope, name, scrollable = false) {
  const result = await page.evaluate(async ({ scope, scrollable }) => {
    const root = document.querySelector(scope);
    if (!root) return { missing: scope };
    const controls = [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [role="button"]')];
    const shown = controls.filter(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width >= 4 && r.height >= 4 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05 && s.pointerEvents !== 'none' &&
        r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    });
    const overlaps = [];
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j]; if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (Math.min(ar.right, br.right) - Math.max(ar.left, br.left) > 3 && Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top) > 3) {
        overlaps.push([a.id || a.textContent.trim(), b.id || b.textContent.trim()]);
      }
    }
    const blocked = [];
    for (const el of scrollable ? controls : shown) {
      if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
      if (scrollable) { el.scrollIntoView({ block: 'center' }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      if (!hit || !(hit === el || el.contains(hit))) blocked.push(el.id || el.textContent.trim());
    }
    return { overlaps, blocked, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), controls: shown.length };
  }, { scope, scrollable });
  assert(!result.missing, `${name} 缺少 ${scope}`);
  assert(result.overflow <= 1, `${name} 水平溢出 ${result.overflow}px`);
  assert.deepEqual(result.overlaps, [], `${name} 控件相交`);
  assert.deepEqual(result.blocked, [], `${name} 控件被遮住或裁切`);
  return result;
}
try {
  for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]].filter(([name]) => !process.env.RAIL_KO_ENGINES || process.env.RAIL_KO_ENGINES.split(',').includes(name))) {
    console.log('START', engine);
    const browser = await launcher.launch({ ...(engine === 'Chromium' ? { channel: 'chrome', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] } : {}), headless: true });
    try {
      for (const width of (process.env.RAIL_KO_WIDTHS || '360,375,390,414,600,768').split(',').map(Number).filter(Number.isFinite)) {
        console.log('OPEN', engine, width);
        const { context, page, errors } = await prepare(browser, width);
        try {
          // 網頁版首次開啟固定繁中（SEO），ko-KR 瀏覽器只給一條切換提示；原生 App 才依系統語言自動切。
          assert.equal(await page.getAttribute('html', 'lang'), 'zh-TW', '網頁版首次開啟固定繁中');
          await page.locator('#langHint').waitFor({ state: 'visible', timeout: 30000 });
          assert.match(await page.locator('#langHint').innerText(), /한국어로 볼까요/);
          await audit(page, '#langHint', `${engine}/${width}/語言提示`);
          await page.tap('#langHintGo');
          await page.waitForFunction(() => document.documentElement.lang === 'ko');
          assert.equal(await page.evaluate(() => localStorage.getItem('trainmap-language')), 'ko', '提示切換要存偏好');
          const initial = await page.evaluate(() => ({
            t: t('到站提醒'), n1: t('{n} 班奔跑中', { n: 1 }), n2: t('{n} 班奔跑中', { n: 2 }),
            station: stationName('臺北', 'tra_sched'), route: routeName('板南線', 'mrt'),
            taipeiCityHall: stationName('市政府', 'mrt'), taichungCityHall: stationName('市政府', 'tmrt'),
            fallback: stationName('冬山', 'tra_sched'),
          }));
          assert.equal(initial.t, '도착 알림');
          assert.equal(initial.n1, '1편 운행 중'); assert.equal(initial.n2, '2편 운행 중');
          assert.equal(initial.station, '타이베이'); assert.equal(initial.route, '반난선');
          assert.equal(initial.taipeiCityHall, '타이베이 시청'); assert.equal(initial.taichungCityHall, '타이중 시청');
          assert.equal(initial.fallback, '둥산', '韓文完整站名');
          await audit(page, 'body', `${engine}/${width}/預設`);
          await page.evaluate(() => { state.alert = { list: [{ sysLabel: '台鐵', title: '營運通阻公告', desc: '網路連線失敗，請稍後再試', lines: [] }] }; renderAlertBanner(); });
          await audit(page, '.stage', `${engine}/${width}/橫幅`);
          await page.evaluate(() => state._setFs(true));
          await audit(page, '.stage', `${engine}/${width}/全畫面橫幅`);
          await page.tap('#tabMore');
          await page.waitForFunction(() => document.body.classList.contains('tools-open'));
          await audit(page, '#moreSheet', `${engine}/${width}/更多設定`, true);
          for (const lang of ['en', 'ja', 'ko', 'zh-TW', 'ko']) {
            await page.locator('#msLangSeg').scrollIntoViewIfNeeded();
            await page.tap(`#msLangSeg button[data-lang="${lang}"]`);
            assert.equal(await page.getAttribute('html', 'lang'), lang);
            assert.equal(await page.locator(`#msLangSeg button[data-lang="${lang}"]`).getAttribute('aria-pressed'), 'true');
            const texts = await page.evaluate(() => ({ pass: document.querySelector('#msPlusSlot')?.textContent || '', language: document.querySelector('[data-act="language"]')?.textContent || '' }));
            if (lang === 'ko') assert(texts.language.includes('언어'));
          }
          await page.locator('#msLangSeg').scrollIntoViewIfNeeded();
          if (width === 375) await page.screenshot({ path: path.join(output, `${engine}-375-settings.png`) });
          await page.tap('#moreClose');
          await page.evaluate(() => { const st = state.schedStations.find(s => s.sys === 'tra_sched' && /[臺台]北/.test(s.name)); openBoard(st); });
          await page.waitForFunction(() => !document.getElementById('board').hidden);
          const board = await page.locator('#board').innerText();
          assert(board.includes('타이베이') && board.includes('앞으로 3시간'), '韓文車站看板');
          if (width === 375) await page.screenshot({ path: path.join(output, `${engine}-375-board.png`) });
          await page.goto(base, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.__i18n?.catalogReady && state.ready);
          assert.equal(await page.getAttribute('html', 'lang'), 'ko', '重新載入保留韓文');
          assert.deepEqual(errors, []);
          results.push({ engine, width, pass: true });
          console.log(`PASS ${engine} ${width}px：提示／觸控切換／重整／站名／看板／控件幾何`);
        } catch (error) {
          failures.push(`${engine}/${width}: ${error.stack}`);
          console.error(`FAIL ${engine} ${width}px：${error.message}`);
          await page.screenshot({ path: path.join(output, `${engine}-${width}-failure.png`) });
        } finally { await context.close(); }
      }
      const { context, page, errors } = await prepare(browser, 1280, false, 'en-US', '?lang=ko-KR');
      try {
        assert.equal(await page.getAttribute('html', 'lang'), 'ko');
        await page.evaluate(() => {
          for (const lang of ['ko', 'ja', 'en', 'zh-TW', 'ko']) window.__i18n.setLanguage(lang);
          openFontPanel();
        });
        assert((await page.locator('#fontPanel').innerText()).includes('화면 및 글자 크기'));
        // 離開地圖前等股道資料真正載入，避免 WebKit 將導航取消中的 fetch 回報成頁面錯誤。
        await page.waitForFunction(() => !!window.railIslandPhysical, null, {timeout:90000});
        await page.screenshot({ path: path.join(output, `${engine}-desktop-font.png`) });
        assert.deepEqual(errors, []);
        results.push({ engine, width: 1280, pass: true });
        console.log(`PASS ${engine} desktop：query 優先與字級面板`);
        for (const file of ['privacy.html', 'terms.html']) {
          await page.goto(base + file + '?lang=ko-KR');
          assert.equal(await page.getAttribute('html', 'lang'), 'ko');
          const residual = await page.evaluate(() => {
            const walker=document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); const rows=[];
            while(walker.nextNode()) { const n=walker.currentNode; if(!/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)&&/[\u3400-\u9fff]/.test(n.textContent)&&!Object.values(window.RAIL_I18N_LEGAL_MESSAGES.ko).includes(n.textContent.trim())) rows.push(n.textContent.trim()); }
            return rows;
          });
          assert.deepEqual(residual, [], file+' 仍有中文');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        for (const file of ['about/index.html','accuracy/index.html','data-sources/index.html','account-deletion.html','app-support.html']) {
          await page.setViewportSize({width:375,height:844});
          await page.goto(base+file+'?lang=ko');
          assert.equal(await page.getAttribute('html','lang'),'ko',file);
          const check=await page.evaluate(()=>{
            const values=new Set(Object.values(window.RAIL_I18N_LEGAL_MESSAGES.ko)),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),residual=[];
            while(walker.nextNode()){const n=walker.currentNode,v=n.textContent.trim();if(!/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)&&/[\u3400-\u9fff]/.test(v)&&!values.has(v))residual.push(v);}
            return {residual,overflow:document.documentElement.scrollWidth>innerWidth};
          });
          assert.deepEqual(check.residual,[],file+' 未翻譯原文');
          assert.equal(check.overflow,false,file+' 水平溢出');
        }
        const english = await browser.newContext({locale:'en-US'});
        const englishPage=await english.newPage();
        await englishPage.goto(base+'about/');
        assert.equal(await englishPage.getAttribute('html','lang'),'zh-TW','未提供英文的公開頁應保留中文語言標記');
        await english.close();
        await page.route('**/api/weekend*', r => r.fulfill({contentType:'application/json',body:JSON.stringify({span:{label:'國慶連假',from:'2026-10-09',to:'2026-10-11',days:3},events:[{title:'官方活動',note:'中文公告',days:['2026-10-10'],places:[]}],alsoOpen:[],updated:'2026-10-09'})}));
        await page.goto(base+'weekend.html?lang=ko-KR');
        await page.waitForFunction(() => document.body.dataset.ready==='1');
        assert.equal(await page.locator('#h1').innerText(), '국경일 연휴 · 철도 행사');
        assert.equal(await page.locator('.src-zh').innerText(), '중국어 원문');
        assert((await page.locator('#foot').innerText()).includes('지도로 돌아가기'));
        await page.screenshot({path:path.join(output,`${engine}-weekend.png`)});
        assert.deepEqual(errors, []);
        console.log(`PASS ${engine}：法律頁全文、活動頁與來源標示`);
      } catch (error) {
        failures.push(`${engine}/desktop: ${error.stack}`);
        throw error;
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ results, failures }, null, 2) + '\n');
}
assert.deepEqual(failures, []);

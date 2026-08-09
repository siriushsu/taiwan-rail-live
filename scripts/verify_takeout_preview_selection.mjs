// Google Takeout 預覽上限外地點的選取與觸控驗證：Chromium + WebKit 真實瀏覽器。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SRC = readFileSync(INDEX_PATH, 'utf8');
const INDEX_MD5 = createHash('md5').update(SRC).digest('hex');
const limitMatch = /const shownResolved = r\.resolved\.slice\(0,\s*(\d+)\)/.exec(SRC);
const PREVIEW_LIMIT = limitMatch ? Number(limitMatch[1]) : NaN;
const TOTAL = PREVIEW_LIMIT + 5;
const WIDTHS = (process.env.T11_WIDTHS || '360,375,414,768').split(',').map(Number).filter(Number.isFinite);
const ENGINE_NAMES = (process.env.T11_ENGINES || 'chromium,webkit').split(',').map(x => x.trim()).filter(Boolean);

console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);
console.log(`[G0] previewLimit=${PREVIEW_LIMIT} syntheticTotal=${TOTAL}`);
console.log(`[G0] engines=${ENGINE_NAMES.join(',')} widths=${WIDTHS.join(',')}`);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  // 高鐵班表自 2026-08-07(9f05f2f)改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
  // 空物件是 200 ⇒ fetchJSONAt 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的
  // sys.data.trains 拋錯 ⇒ boot 停在 state.ready=true 之前 ⇒ waitReady 逾時。這裡吐打包的那份(同 schema)。
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') { res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'))); return; }
    res.end('{}'); return;
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/?takeout=1`;

const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
ok('G0 伺服器送出的 index.html 與當前 T11 worktree 逐 byte 相同', served === INDEX_MD5,
  `served=${served} root=${INDEX_MD5}`);
ok('G0 成功從產品碼讀到有限的 Takeout 預覽上限', Number.isInteger(PREVIEW_LIMIT) && PREVIEW_LIMIT > 0,
  `previewLimit=${PREVIEW_LIMIT}`);

const cases = [];
const launchers = { chromium, webkit };

async function prepare(page) {
  await page.evaluate(total => {
    savePins([]);
    state.takeoutResult = {
      files: ['T11-合成清單.json'], incomplete: [], outside: [],
      resolved: Array.from({ length: total }, (_, i) => ({
        title: `T11 地點 ${i + 1}`, list: '驗收用', sourceFile: 'T11-合成清單.json', url: '',
        coord: { lat: 23 + i / 10000, lon: 121 + i / 10000 },
      })),
    };
    takeoutOpen();
    takeoutRenderPreview();
  }, TOTAL);
}

async function readSelection(page) {
  return page.evaluate(() => {
    const confirm = document.getElementById('takeoutConfirm');
    const m = /\d+/.exec(confirm.textContent || '');
    return {
      visible: document.querySelectorAll('.takeout-check').length,
      selected: takeoutSelectedCount(),
      labelCount: m ? Number(m[0]) : 0,
      label: confirm.textContent,
    };
  });
}

async function inspectBulk(page) {
  return page.evaluate(() => {
    const bulk = document.querySelector('.takeout-bulk');
    const checkbox = document.querySelector('.takeout-include-unshown');
    if (!bulk || !checkbox) return { found: false, visible: false, hit: false, overlaps: ['missing'], text: '' };
    const r = bulk.getBoundingClientRect(), cs = getComputedStyle(bulk);
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 &&
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 4, r.top + 4], [r.right - 4, r.top + 4],
      [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4],
    ];
    const hit = points.every(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el && (el === bulk || bulk.contains(el));
    });
    const candidates = [...document.querySelectorAll('#takeoutModal button, #takeoutModal input, #takeoutModal a, #takeoutModal .takeout-row')];
    const overlaps = candidates.filter(el => {
      if (el === bulk || bulk.contains(el) || el.contains(bulk)) return false;
      const s = getComputedStyle(el), q = el.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || q.width === 0 || q.height === 0) return false;
      if (q.bottom <= 0 || q.right <= 0 || q.top >= innerHeight || q.left >= innerWidth) return false;
      return Math.min(r.right, q.right) - Math.max(r.left, q.left) > 0.5 &&
        Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 0.5;
    }).map(el => el.id ? `#${el.id}` : (el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : el.tagName));
    return { found: true, visible, hit, overlaps, text: bulk.textContent.replace(/\s+/g, ' ').trim(), checked: checkbox.checked };
  });
}

for (const engineName of ENGINE_NAMES) {
  const launcher = launchers[engineName];
  if (!launcher) { ok(`引擎 ${engineName} 存在`, false, '不支援的引擎名稱'); continue; }
  let browser;
  try { browser = await launcher.launch(); }
  catch (e) { ok(`${engineName} 啟動`, false, String(e).slice(0, 300)); continue; }
  for (const width of WIDTHS) {
    const height = width === 768 ? 1024 : 844;
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const tag = `${engineName}/${width}`;
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof state !== 'undefined' && typeof takeoutRenderPreview === 'function' && typeof setupTakeoutUi === 'function');
      await page.evaluate(() => setupTakeoutUi());

      await prepare(page);
      const before = await readSelection(page);
      const bulkUi = await inspectBulk(page);
      const hidden = TOTAL - before.visible;
      const bulkTextHasCount = hidden > 0 && bulkUi.text.includes(String(hidden)) && bulkUi.text.includes('未預覽');
      await page.tap('#takeoutConfirm');
      const defaultActual = await page.evaluate(() => loadPins().length);

      await prepare(page);
      const beforeTap = await readSelection(page);
      await page.locator('.takeout-bulk').scrollIntoViewIfNeeded();
      const tapAccepted = await page.tap('.takeout-bulk', { timeout: 3000 }).then(() => true).catch(() => false);
      const afterTap = await readSelection(page);
      const checkedAfterTap = await page.locator('.takeout-include-unshown').isChecked().catch(() => false);
      await page.tap('#takeoutConfirm');
      const bulkActual = await page.evaluate(() => loadPins().length);

      const item = {
        tag, width, engineName, before, beforeTap, afterTap, bulkUi, bulkTextHasCount, tapAccepted, checkedAfterTap,
        defaultActual, bulkActual,
      };
      cases.push(item);
      console.log(`CASE ${tag} visible=${before.visible} defaultSelected=${before.selected} defaultLabel=${before.labelCount} defaultActual=${defaultActual} ` +
        `bulkSelected=${afterTap.selected} bulkLabel=${afterTap.labelCount} bulkActual=${bulkActual} ` +
        `visibleCtl=${bulkUi.visible} overlaps=${bulkUi.overlaps.length} efp=${bulkUi.hit} tap=${tapAccepted && checkedAfterTap}`);
    } catch (e) {
      cases.push({ tag, width, engineName, error: String(e) });
      console.log(`CASE ${tag} ERROR ${String(e).slice(0, 500)}`);
    } finally { await ctx.close(); }
  }
  await browser.close();
}

const expectedCases = WIDTHS.length * ENGINE_NAMES.filter(n => launchers[n]).length;
ok('四寬度×雙引擎的所有案例都完整執行', cases.length === expectedCases && cases.every(x => !x.error),
  `cases=${cases.length}/${expectedCases} errors=${cases.filter(x => x.error).map(x => `${x.tag}:${x.error}`).join(' | ')}`);
ok('預設匯入筆數＝使用者看得到且可逐筆取消的筆數', cases.every(x => !x.error && x.before.visible < TOTAL && x.before.selected === x.before.visible && x.defaultActual === x.before.visible),
  cases.map(x => `${x.tag}:${x.error || `${x.before.selected}/${x.before.visible}/${x.defaultActual}`}`).join(' '));
ok('開啟「其餘 N 個未預覽地點」後，匯入筆數＝總可匯入筆數', cases.every(x => !x.error && x.afterTap.selected === TOTAL && x.bulkActual === TOTAL),
  cases.map(x => `${x.tag}:${x.error || `${x.afterTap.selected}/${x.bulkActual}/${TOTAL}`}`).join(' '));
ok('預設狀態的確認鈕數字與實際匯入結果一致', cases.every(x => !x.error && x.before.labelCount === x.before.selected && x.before.labelCount === x.defaultActual),
  cases.map(x => `${x.tag}:${x.error || `${x.before.labelCount}/${x.defaultActual}`}`).join(' '));
ok('全部納入狀態的確認鈕數字與實際匯入結果一致', cases.every(x => !x.error && x.afterTap.labelCount === x.afterTap.selected && x.afterTap.labelCount === x.bulkActual),
  cases.map(x => `${x.tag}:${x.error || `${x.afterTap.labelCount}/${x.bulkActual}`}`).join(' '));
ok('新控制項在四寬度×雙引擎都可見，且文案明說其餘筆數', cases.every(x => !x.error && x.bulkUi.found && x.bulkUi.visible && x.bulkTextHasCount),
  cases.map(x => `${x.tag}:${x.error || `visible=${x.bulkUi.visible},text=${x.bulkTextHasCount}`}`).join(' '));
ok('新控制項在四寬度×雙引擎都不與既有可見互動控件幾何相交', cases.every(x => !x.error && x.bulkUi.overlaps.length === 0),
  cases.map(x => `${x.tag}:${x.error || x.bulkUi.overlaps.join(',') || '0'}`).join(' '));
ok('新控制項在四寬度×雙引擎的 elementFromPoint 五點都命中自己', cases.every(x => !x.error && x.bulkUi.hit),
  cases.map(x => `${x.tag}:${x.error || x.bulkUi.hit}`).join(' '));
ok('四寬度×雙引擎都用 page.tap() 真觸控開啟「全部納入」並真正生效', cases.every(x => !x.error && x.tapAccepted && x.checkedAfterTap && x.afterTap.selected === TOTAL),
  cases.map(x => `${x.tag}:${x.error || `tap=${x.tapAccepted},checked=${x.checkedAfterTap},selected=${x.afterTap.selected}`}`).join(' '));

server.close();
const fails = results.filter(x => !x.pass);
console.log(`\n${results.length - fails.length}/${results.length} 通過`);
process.exit(fails.length ? 1 : 0);

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { SPEC, SYS_IDS, pageBBox } from './lib/metro_page_spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  let target = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) target = path.join(target, 'index.html');
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const paths = ['/about/', '/accuracy/', '/data-sources/', '/stations/', '/stations/taipei/', '/stations/formosa-boulevard/', '/en/', '/ja/'];
// 英日文著陸頁與首頁必須互相對應:同一組 hreflang、各自 canonical、CTA 帶 ?lang= 進即時地圖
const hreflangExpected = { 'zh-Hant': 'https://railisland.tw/', en: 'https://railisland.tw/en/', ja: 'https://railisland.tw/ja/', 'x-default': 'https://railisland.tw/' };
const landings = { '/en/': { lang: 'en', cta: '/?lang=en', titleRe: /Taiwan Train Map/, canonical: 'https://railisland.tw/en/' }, '/ja/': { lang: 'ja', cta: '/?lang=ja', titleRe: /台湾鉄道/, canonical: 'https://railisland.tw/ja/' } };
async function hreflangSet(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')].map(el => [el.getAttribute('hreflang'), el.getAttribute('href')])));
}
async function inspectLanding(page, pathname, label) {
  const want = landings[pathname];
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang, title: document.title,
    canonical: document.querySelector('link[rel=canonical]')?.href,
    ctas: [...document.querySelectorAll('a.button:not(.secondary), a.nav-live')].map(el => el.getAttribute('href')),
  }));
  if (info.lang !== want.lang) failures.push(`${label} html lang=${info.lang}`);
  if (!want.titleRe.test(info.title)) failures.push(`${label} title 不含搜尋字：${info.title}`);
  if (info.canonical !== want.canonical) failures.push(`${label} canonical=${info.canonical}`);
  if (info.ctas.length < 2 || info.ctas.some(href => href !== want.cta)) failures.push(`${label} CTA 連結不是 ${want.cta}：${info.ctas.join('、')}`);
  const set = await hreflangSet(page);
  if (JSON.stringify(set) !== JSON.stringify(hreflangExpected)) failures.push(`${label} hreflang 不完整或不對應：${JSON.stringify(set)}`);
}

const widths = [360, 375, 414, 768];

// ── 捷運路線圖頁（SEO 階段 A）─────────────────────────────────────────────────────────
// 預設驗：總覽＋5 系統頁＋2 條路線頁（一條捷運 bannan、一條輕軌 danhai），三語各一份；--metro-all 驗全部 60 頁。
// 版面矩陣＝桌面 1280 ＋ 觸控 360/375/414/768；CTA 用 page.tap() 真的點「在地圖上看即時列車」，
// 再驗 state.group、M.getCenter()／getZoom()、地圖可視範圍蓋得住該頁的路線範圍、en／ja 進入對應語言。
// 另有兩個縮短迭代的旗標（驗收與出貨都不用）：--metro-only 略過既有代表頁與首頁入口的驗證，只驗捷運頁；
// --only=<正規式> 只驗網址符合該正規式的捷運頁（例：--only=^/en/metro/taipei/$）。
const metroAll = process.argv.includes('--metro-all');
const metroOnly = process.argv.includes('--metro-only');
const onlyFilter = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length);
const LANG_DIR = { zh: 'metro', en: 'en/metro', ja: 'ja/metro' };
const APP_LANG = { zh: 'zh-TW', en: 'en', ja: 'ja' };
const metroEntry = (lang, sys, slug) => ({
  lang, sys, slug, kind: slug ? 'line' : sys ? 'system' : 'overview',
  pathname: `/${LANG_DIR[lang]}/${sys ? `${sys}/` : ''}${slug ? `${slug}/` : ''}`,
  bbox: pageBBox(sys, slug),
});
const allMetro = [];
for (const lang of Object.keys(LANG_DIR)) {
  allMetro.push(metroEntry(lang, null, null));
  for (const sys of SYS_IDS) allMetro.push(metroEntry(lang, sys, null));
  for (const e of SPEC) allMetro.push(metroEntry(lang, e.sys, e.slug));
}
const metroPages = (metroAll ? allMetro : allMetro.filter(e => e.kind !== 'line' || e.slug === 'bannan' || e.slug === 'danhai')).filter(e => !onlyFilter || new RegExp(onlyFilter).test(e.pathname));
if (!metroPages.length) { console.error(`沒有符合 --only=${onlyFilter} 的捷運頁`); process.exit(2); }
const luminance = css => {
  const m = String(css).match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return la == null || lb == null ? null : (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

// 頁面內的版面、地圖、配色檢查。scheme＝'light'|'dark'（context 的 colorScheme）。
async function inspectMetro(page, label, entry, scheme) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const issues = [];
    const inSvg = el => !!el.closest('svg');
    const insideScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
    // 1. 任何元素（除 SVG 內部）超出視窗左右邊
    for (const el of document.querySelectorAll('main *, header *, footer *')) {
      if (inSvg(el)) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if ((b.right > vw + 1 || b.left < -1) && !insideScroller(el)) { issues.push(`超出視窗 <${el.tagName.toLowerCase()} class="${el.className}"> left=${b.left.toFixed(1)} right=${b.right.toFixed(1)} vw=${vw}`); if (issues.length > 6) break; }
    }
    // 2. 內部橫向捲動、或被 overflow:hidden／clip 裁掉的內容。只看真實子元素與文字（Range 量得到的矩形），
    //    不看偽元素：.hero::after 是刻意伸出框外被裁掉的裝飾圓環，scrollWidth 會把它算進去，量它是假紅。
    const contentRects = el => {
      const out = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) { if (!inSvg(n)) out.push([n, n.getBoundingClientRect()]); continue; }
        if (!n.textContent.trim() || (n.parentElement && inSvg(n.parentElement))) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const rect of range.getClientRects()) out.push([n.parentElement, rect]);
      }
      return out;
    };
    for (const el of document.querySelectorAll('main *')) {
      if (inSvg(el)) continue;
      const cs = getComputedStyle(el);
      if (!['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX) || el.clientWidth <= 0) continue;
      const tag = `<${el.tagName.toLowerCase()} class="${el.className}">`;
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) { issues.push(`內部橫向捲動 ${tag} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`); continue; }
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      const box = el.getBoundingClientRect();
      const cut = contentRects(el).find(([, r]) => r.width > 0 && r.height > 0 && (r.right > box.right + 1 || r.left < box.left - 1));
      if (cut) issues.push(`內容被 overflow:${cs.overflowX} 裁掉 ${tag} 的 <${cut[0].tagName.toLowerCase()} class="${cut[0].className}"> 範圍 ${cut[1].left.toFixed(1)}–${cut[1].right.toFixed(1)}，容器 ${box.left.toFixed(1)}–${box.right.toFixed(1)}`);
    }
    // 3. 地圖 SVG
    const maps = [...document.querySelectorAll('svg.geo-map')].map(svg => {
      const vb = svg.viewBox.baseVal, box = svg.getBoundingClientRect(), fig = svg.closest('figure').getBoundingClientRect();
      const scale = box.width / vb.width;
      const cs = getComputedStyle(svg);
      // getBBox() 是字型的 ascent＋descent 行框，上下各有一截沒有墨跡的空白；壓到圓點與否要看「字形墨跡＋白邊」，
      // 所以垂直範圍改用 canvas measureText 量該字串的 actualBoundingBoxAscent／Descent（基線取 text 的 y），水平沿用 getBBox。
      const measure = document.createElement('canvas').getContext('2d');
      const labels = [...svg.querySelectorAll('text.lbl')].map(t => {
        const b = t.getBBox(), cs = getComputedStyle(t);
        measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = measure.measureText(t.textContent), base = t.y.baseVal[0].value, halo = (parseFloat(cs.strokeWidth) || 0) / 2;
        return { text: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height, inkTop: base - m.actualBoundingBoxAscent - halo, inkBottom: base + m.actualBoundingBoxDescent + halo, fs: parseFloat(cs.fontSize), fill: cs.fill, halo: cs.stroke };
      });
      const dots = [...svg.querySelectorAll('circle.dot')].map(c => ({ x: c.cx.baseVal.value, y: c.cy.baseVal.value, r: c.r.baseVal.value }));
      const overlaps = [];
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5) overlaps.push(`${a.text}／${b.text}`);
      }
      const onDot = [];
      for (const l of labels) for (const d of dots) {
        const nx = Math.max(l.x, Math.min(d.x, l.x + l.w)), ny = Math.max(l.inkTop, Math.min(d.y, l.inkBottom));
        if ((nx - d.x) ** 2 + (ny - d.y) ** 2 < (d.r - 0.3) ** 2) onDot.push(`${l.text}（壓到 ${d.x.toFixed(0)},${d.y.toFixed(0)}）`);
      }
      const outside = labels.filter(l => l.x < -0.5 || l.y < -0.5 || l.x + l.w > vb.width + 0.5 || l.y + l.h > vb.height + 0.5).map(l => l.text);
      return {
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && box.width > 0 && box.height > 0,
        inViewport: box.left >= -0.5 && box.right <= vw + 0.5, inFigure: box.left >= fig.left - 0.5 && box.right <= fig.right + 0.5,
        width: box.width, vbW: vb.width, labels: labels.length, dots: dots.length, overlaps, onDot, outside,
        effFont: labels.length ? Math.min(...labels.map(l => l.fs)) * scale : null, fill: labels[0]?.fill, halo: labels[0]?.halo,
      };
    });
    // 4. 路線頁站序：節點與站名都看得到、不被裁
    const stops = [...document.querySelectorAll('.stop')].map(li => {
      const node = li.querySelector('.rail-node'), name = li.querySelector('.stop-name');
      const nb = node ? node.getBoundingClientRect() : null, tb = name ? name.getBoundingClientRect() : null;
      return { node: !!nb && nb.width > 0 && nb.height > 0 && nb.left >= 0 && nb.right <= vw, name: !!tb && tb.width > 0 && tb.right <= vw + 0.5 };
    });
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const lede = document.querySelector('.lede');
    return {
      maps, stops, bodyBg, lede: lede ? getComputedStyle(lede).color : null, issues,
      liveBtn: [...document.querySelectorAll('a.button')].map(a => a.getAttribute('href')).filter(h => h.startsWith('/?g=metro')).length,
      scrollW: document.documentElement.scrollWidth, clientW: vw,
    };
  });
  if (r.scrollW - r.clientW > 1) failures.push(`${label} 水平溢出 ${r.scrollW - r.clientW}px`);
  for (const issue of r.issues) failures.push(`${label} ${issue}`);
  if (r.liveBtn < 1) failures.push(`${label} 沒有「在地圖上看即時列車」深連結`);
  if (entry.kind === 'system') {
    if (!r.maps.length) failures.push(`${label} 系統頁沒有地圖 SVG`);
    for (const [i, m] of r.maps.entries()) {
      const tag = `${label} 地圖#${i + 1}`;
      if (!m.visible) failures.push(`${tag} 看不到`);
      if (!m.inViewport || !m.inFigure) failures.push(`${tag} 沒有落在版面內（inViewport=${m.inViewport}, inFigure=${m.inFigure}）`);
      if (m.labels < 2 || m.dots < 2) failures.push(`${tag} 標籤 ${m.labels}／站點 ${m.dots} 過少`);
      if (m.overlaps.length) failures.push(`${tag} 站名標籤互相重疊：${m.overlaps.slice(0, 5).join('、')}`);
      if (m.onDot.length) failures.push(`${tag} 站名壓在站點圓點上：${m.onDot.slice(0, 5).join('、')}`);
      if (m.outside.length) failures.push(`${tag} 站名超出 SVG 邊界：${m.outside.slice(0, 5).join('、')}`);
      if (m.effFont != null && m.width >= 300 && m.effFont < 10) failures.push(`${tag} 站名實際字級 ${m.effFont.toFixed(1)}px 小於 10px`);
      const c = contrast(m.fill, m.halo);
      if (c != null && c < 4.5) failures.push(`${tag} 站名與底色對比 ${c.toFixed(1)} 小於 4.5（${scheme}）`);
    }
  }
  if (entry.kind === 'line') {
    if (r.stops.length < 2) failures.push(`${label} 站序只有 ${r.stops.length} 站`);
    const badNode = r.stops.filter(x => !x.node).length, badName = r.stops.filter(x => !x.name).length;
    if (badNode) failures.push(`${label} ${badNode} 個站點節點不在版面內或看不到`);
    if (badName) failures.push(`${label} ${badName} 個站名被裁到視窗外`);
  }
  const bg = luminance(r.bodyBg);
  if (bg != null && (scheme === 'dark' ? bg > 0.2 : bg < 0.7)) failures.push(`${label} ${scheme} 模式底色亮度 ${bg.toFixed(2)} 不合理`);
  const cr = contrast(r.lede, r.bodyBg);
  if (cr != null && cr < 4.5) failures.push(`${label} 導言與底色對比 ${cr.toFixed(1)} 小於 4.5（${scheme}）`);
}

// 主程式開機完成：首頁是重型 SPA，開機中版面還在變、捲動位置會被開機流程重設；要量命中、點擊、捲動的檢查一律等到這個訊號再開始
const APP_READY = () => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready;
const waitAppReady = page => page.waitForFunction(APP_READY, null, { timeout: 90_000 });

// 點 CTA → 深連結進主程式：state.group、地圖中心／縮放、可視範圍、語言
async function checkMetroCta(context, engineName, entry) {
  const label = `${engineName} 375px CTA ${entry.pathname}`;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const response = await page.goto(`${base}${entry.pathname}`, { waitUntil: 'load' });
    if (!response?.ok()) { failures.push(`${label} HTTP ${response?.status()}`); return; }
    const cta = page.locator('.hero-actions a.button:not(.secondary)').first();
    const href = (await cta.getAttribute('href')) || '';
    const u = new URL(href, base);
    if (u.pathname !== '/' || u.searchParams.get('g') !== 'metro') { failures.push(`${label} CTA 連結不是 /?g=metro：${href}`); return; }
    // 先驗連結本身：at 壞了（例如經緯度對調）主程式會直接開不起來，要等 90 秒逾時才報一個看不出原因的例外，所以在點之前就講清楚
    if (entry.bbox) {
      const atRaw = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(u.searchParams.get('at') || '');
      const [s0, w0, n0, e0] = entry.bbox, pad = 0.002;
      if (!atRaw) { failures.push(`${label} CTA 沒有合法的 at 參數：${href}`); return; }
      const lat = Number(atRaw[1]), lon = Number(atRaw[2]);
      if (!(lat >= s0 - pad && lat <= n0 + pad && lon >= w0 - pad && lon <= e0 + pad)) { failures.push(`${label} CTA 的 at 參數 ${lat},${lon} 不在該頁路線範圍 [${entry.bbox.map(v => v.toFixed(3)).join(', ')}] 內（經緯度是否對調？）`); return; }
    }
    await cta.scrollIntoViewIfNeeded();
    await cta.tap();
    await page.waitForURL(url => new URL(url).pathname === '/' && new URL(url).searchParams.get('g') === 'metro', { timeout: 30_000 });
    await waitAppReady(page);
    const st = await page.evaluate(() => {
      const b = M.getBounds();
      return { group: state.group, lines: state.lines.length, htmlLang: document.documentElement.lang, appLang: I18N_LANG, center: M.getCenter(), zoom: M.getZoom(), bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] };
    });
    if (st.group !== 'metro') failures.push(`${label} state.group=${st.group}（應為 metro）`);
    if (!st.lines) failures.push(`${label} 進主程式後沒有捷運路線資料`);
    if (st.htmlLang !== APP_LANG[entry.lang] || st.appLang !== APP_LANG[entry.lang]) failures.push(`${label} 語言 html=${st.htmlLang} app=${st.appLang}，應為 ${APP_LANG[entry.lang]}`);
    if (entry.bbox) {
      const at = /^(-?[\d.]+),(-?[\d.]+)$/.exec(u.searchParams.get('at') || '');
      const z = Number(u.searchParams.get('z'));
      const [s0, w0, n0, e0] = entry.bbox, pad = 0.002;
      if (!at) failures.push(`${label} CTA 沒有 at 參數：${href}`);
      else {
        if (Math.abs(st.center.lat - Number(at[1])) > 5e-4 || Math.abs(st.center.lng - Number(at[2])) > 5e-4) failures.push(`${label} 地圖中心 ${st.center.lat.toFixed(4)},${st.center.lng.toFixed(4)} ≠ at=${at[1]},${at[2]}`);
        if (Math.abs(st.zoom - z) > 0.02) failures.push(`${label} 縮放 ${st.zoom.toFixed(2)} ≠ z=${z}`);
      }
      if (!(st.center.lat >= s0 - pad && st.center.lat <= n0 + pad && st.center.lng >= w0 - pad && st.center.lng <= e0 + pad)) failures.push(`${label} 地圖中心 ${st.center.lat.toFixed(4)},${st.center.lng.toFixed(4)} 不在該頁路線範圍 [${entry.bbox.map(v => v.toFixed(3)).join(', ')}] 內`);
      // 可視範圍要蓋住路線範圍（各軸至少 85%）；蓋不住＝zoom 太近，使用者一進來就看不到整條線
      const [bs, bw, bn, be] = st.bounds;
      const covLat = Math.max(0, Math.min(n0, bn) - Math.max(s0, bs)) / Math.max(n0 - s0, 1e-9);
      const covLon = Math.max(0, Math.min(e0, be) - Math.max(w0, bw)) / Math.max(e0 - w0, 1e-9);
      entry.cover = [covLat, covLon];
      if (covLat < 0.85 || covLon < 0.85) failures.push(`${label} 可視範圍只蓋住路線範圍的 緯度 ${(covLat * 100).toFixed(0)}%／經度 ${(covLon * 100).toFixed(0)}%（z=${z}）`);
    }
    if (errors.length) failures.push(`${label} pageerror：${errors.join('；')}`);
  } catch (error) {
    failures.push(`${label} 例外：${String(error.message).split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

// 手機「更多」裡的四顆說明入口：互不重疊、都在視窗內、每顆點擊中心可命中自己、整列不造成橫向溢出
async function inspectAeoLinkRow(page, label) {
  const r = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.ms-aeo-links a')];
    const rects = links.map(a => { a.scrollIntoView({ block: 'center' }); const b = a.getBoundingClientRect(); const c = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { text: a.textContent.trim(), left: b.left, right: b.right, top: b.top, bottom: b.bottom, hit: c === a || a.contains(c), clipped: a.scrollWidth > a.clientWidth + 1 }; });
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${a.text}／${b.text}`);
    }
    return { rects, overlaps, vw: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  if (r.rects.length !== 4) failures.push(`${label} 入口列不是 4 顆（${r.rects.length}）`);
  if (r.overlaps.length) failures.push(`${label} 入口列互相重疊：${r.overlaps.join('、')}`);
  for (const b of r.rects) {
    if (b.left < -0.5 || b.right > r.vw + 0.5) failures.push(`${label} 入口「${b.text}」超出視窗（${b.left.toFixed(0)}–${b.right.toFixed(0)} / ${r.vw}）`);
    if (!b.hit) failures.push(`${label} 入口「${b.text}」中心點被遮住`);
    if (b.clipped) failures.push(`${label} 入口「${b.text}」文字被裁`);
  }
  if (r.overflow > 1) failures.push(`${label} 入口列造成水平溢出 ${r.overflow}px`);
}

async function inspect(page, label) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  const targets = page.locator('.site-nav a, .hero-actions a, .card-link');
  const blockedTargets = [];
  for (let index = 0; index < await targets.count(); index++) {
    const target = targets.nth(index);
    const result = await target.evaluate(element => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { label: element.textContent.trim(), hittable: center === element || element.contains(center) };
    });
    if (!result.hittable) blockedTargets.push(`${result.label} #${index + 1}`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  const metrics = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll('.site-nav a')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const boxes = interactive.map(element => {
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        label: element.textContent.trim(),
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      };
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${a.label} / ${b.label}`);
    }
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: document.querySelectorAll('h1').length,
      main: Boolean(document.querySelector('main#main')),
      overlaps,
    };
  });
  if (metrics.overflow > 1) failures.push(`${label} 水平溢出 ${metrics.overflow}px`);
  if (metrics.h1 !== 1 || !metrics.main) failures.push(`${label} 語意結構錯誤`);
  if (blockedTargets.length) failures.push(`${label} 捲入畫面後點擊中心仍被遮住：${blockedTargets.join('、')}`);
  if (metrics.overlaps.length) failures.push(`${label} 導覽互相重疊：${metrics.overlaps.join('、')}`);
  if (errors.length) failures.push(`${label} pageerror：${errors.join('；')}`);
}

try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      for (const pathname of metroOnly ? [] : paths) {
        const page = await desktop.newPage();
        const response = await page.goto(`${base}${pathname}`, { waitUntil: 'load' });
        if (!response?.ok()) failures.push(`${engineName} desktop ${pathname} HTTP ${response?.status()}`);
        await inspect(page, `${engineName} desktop ${pathname}`);
        if (landings[pathname]) await inspectLanding(page, pathname, `${engineName} desktop ${pathname}`);
        await page.close();
      }
      await desktop.close();

      // 捷運路線圖頁：桌面 1280（淺色）
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
        for (const entry of scheme === 'light' ? metroPages : metroPages.filter(e => e.kind !== 'overview' && e.lang === 'zh')) {
          const page = await ctx.newPage();
          const label = `${engineName} desktop ${scheme} ${entry.pathname}`;
          const response = await page.goto(`${base}${entry.pathname}`, { waitUntil: 'load' });
          if (!response?.ok()) failures.push(`${label} HTTP ${response?.status()}`);
          await inspectMetro(page, label, entry, scheme);
          await inspect(page, label);
          await page.close();
        }
        await ctx.close();
      }

      for (const width of widths) {
        const mobile = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await mobile.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        if (!metroOnly) {
          const rootPage = await mobile.newPage();
          await rootPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
          if (width === widths[0]) {
            const rootSet = await hreflangSet(rootPage);
            if (JSON.stringify(rootSet) !== JSON.stringify(hreflangExpected)) failures.push(`${engineName} 首頁 hreflang 不對應：${JSON.stringify(rootSet)}`);
          }
          await rootPage.locator('#tabMore').tap();
          const aeoFooterLinks = rootPage.locator('.ms-aeo-links a');
          if (await aeoFooterLinks.count() !== 4) failures.push(`${engineName} ${width}px 手機「關於」區 AEO 入口不是 4 個`);
          else await inspectAeoLinkRow(rootPage, `${engineName} ${width}px`);
          const aboutLink = rootPage.locator('.ms-aeo-links a[href="about/"]');
          await aboutLink.scrollIntoViewIfNeeded();
          const rootHit = await aboutLink.evaluate(element => {
            const box = element.getBoundingClientRect();
            const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return center === element || element.contains(center);
          });
          if (!rootHit) failures.push(`${engineName} ${width}px 手機「關於軌島」入口被遮住`);
          await aboutLink.tap();
          await rootPage.waitForURL('**/about/');
          if (!rootPage.url().endsWith('/about/')) failures.push(`${engineName} ${width}px 首頁 AEO 入口觸控未成功`);
          await rootPage.close();
          // 「捷運路線圖」入口：手機「更多」與頁尾各一條，點下去到 /metro/
          const metroRoot = await mobile.newPage();
          await metroRoot.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
          await waitAppReady(metroRoot);
          await metroRoot.locator('#tabMore').tap();
          const metroLink = metroRoot.locator('.ms-aeo-links a[href="metro/"]');
          if (await metroLink.count() !== 1) failures.push(`${engineName} ${width}px 手機「更多」裡沒有恰好一個「捷運路線圖」入口`);
          else {
            await metroLink.scrollIntoViewIfNeeded();
            if ((await metroLink.textContent()).trim() !== '捷運路線圖') failures.push(`${engineName} ${width}px 手機「捷運路線圖」入口文字不對`);
            await metroLink.tap();
            await metroRoot.waitForURL('**/metro/');
            if (!metroRoot.url().endsWith('/metro/')) failures.push(`${engineName} ${width}px 「捷運路線圖」入口觸控未成功`);
          }
          await metroRoot.close();
          for (const pathname of paths) {
            const page = await mobile.newPage();
            const response = await page.goto(`${base}${pathname}`, { waitUntil: 'load' });
            if (!response?.ok()) failures.push(`${engineName} ${width}px ${pathname} HTTP ${response?.status()}`);
            await inspect(page, `${engineName} ${width}px ${pathname}`);
            if (pathname === '/about/') {
              await page.locator('.site-nav a[href="/stations/"]').tap();
              await page.waitForURL('**/stations/');
              if (!page.url().endsWith('/stations/')) failures.push(`${engineName} ${width}px 觸控導覽未成功`);
            }
            await page.close();
          }
        }
        for (const scheme of width === 375 ? ['light', 'dark'] : ['light']) {
          const ctx = scheme === 'light' ? mobile : await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
          for (const entry of scheme === 'light' ? metroPages : metroPages.filter(e => e.kind !== 'overview' && e.lang === 'zh')) {
            const page = await ctx.newPage();
            const label = `${engineName} ${width}px ${scheme} ${entry.pathname}`;
            const response = await page.goto(`${base}${entry.pathname}`, { waitUntil: 'load' });
            if (!response?.ok()) failures.push(`${label} HTTP ${response?.status()}`);
            await inspectMetro(page, label, entry, scheme);
            await inspect(page, label);
            await page.close();
          }
          if (scheme !== 'light') await ctx.close();
        }
        if (width === 375) {
          for (const entry of metroPages) await checkMetroCta(mobile, engineName, entry);
        }
        await mobile.close();
      }
      // 頁尾入口列在最窄手機寬度（320）與桌面頁尾也要排得下
      const narrow = await browser.newContext({ viewport: { width: 320, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await narrow.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); });
      const narrowPage = await narrow.newPage();
      await narrowPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await waitAppReady(narrowPage);
      await narrowPage.locator('#tabMore').tap();
      await inspectAeoLinkRow(narrowPage, `${engineName} 320px`);
      await narrow.close();
      const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const widePage = await wide.newPage();
      await widePage.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await waitAppReady(widePage); // 開機前捲進畫面、開機後被捲回頂端，命中測試就會隨機失敗（2026-09-29 實際抓到一次）
      const footLink = widePage.locator('.foot-links a[href="metro/"]');
      if (await footLink.count() !== 1) failures.push(`${engineName} 桌面頁尾沒有恰好一個「捷運路線圖」入口`);
      else {
        await footLink.scrollIntoViewIfNeeded();
        const hit = await footLink.evaluate(element => {
          const box = element.getBoundingClientRect();
          const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const ok = center === element || element.contains(center);
          return { ok, cover: ok ? '' : `${center ? `${center.tagName.toLowerCase()}#${center.id}.${String(center.className && center.className.baseVal === undefined ? center.className : '').slice(0, 40)}` : '視窗外（null）'}`, top: Math.round(box.top), vh: innerHeight };
        });
        if (!hit.ok) failures.push(`${engineName} 桌面頁尾「捷運路線圖」入口被遮住（命中 ${hit.cover}，top=${hit.top}，視窗高 ${hit.vh}）`);
      }
      await wide.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error(`AEO 瀏覽器驗收失敗（${failures.length} 項）`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const covers = metroPages.map(e => e.cover).filter(Boolean);
const minCover = covers.length ? Math.min(...covers.flat()) : null;
console.log(`AEO 瀏覽器驗收通過：Chromium + WebKit；桌面與 ${widths.join('/')}px 觸控寬度；${paths.length} 個代表頁面（含 /en/、/ja/ 的 lang／title／canonical／hreflang／CTA）；捷運路線圖頁 ${metroPages.length}／${allMetro.length} 頁${metroAll ? '（全部）' : '（總覽＋5 系統＋捷運 bannan／輕軌 danhai 各語言；--metro-all 驗全部）'}：版面矩陣、SVG 地圖標籤、深連結 CTA${minCover == null ? '' : `（可視範圍最低覆蓋 ${(minCover * 100).toFixed(0)}%）`}`);

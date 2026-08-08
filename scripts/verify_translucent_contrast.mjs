// 面板半透明(body.panel-translucent)的文字/圖表可讀性驗收。
//
// 為什麼要量而不是看:面板底色是 alpha .30 + backdrop-filter blur(3px),背後直接透出地圖
// (圖磚、路網彩線、車號牌)。「字會不會跟背景融在一起」取決於「字色 vs 該處實際透出來的顏色」,
// 縮圖裸眼看不出 4.5:1 與 2.8:1 的差別(judgment.md 心得 6)。
//
// 判準來源刻意與實作不同源(心得 29):背景真值取自「把七個面板 visibility:hidden 之後的實際螢幕
// 像素」,不是從 CSS 變數推算;再依 CSS 合成規則把「面板玻璃底 → 各層祖先背景」依序疊上去,
// 最後與 computed color 算 WCAG 對比。地圖像素先做 σ=3 高斯加權,對應 backdrop-filter: blur(3px)。
// 取樣點取 5% 分位(不是平均):字壓在深色路網線上那幾個像素才是使用者看不清的地方。
//
// 用法:node scripts/verify_translucent_contrast.mjs [目標目錄]  (預設=本腳本所在的工作區)
//   ENGINES=chromium  只跑一個引擎     ONLY=light/desktop  只跑一個情境
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const PORT = Number(process.env.PORT || 5241);
const OUT = process.env.SHOT_DIR || '/private/tmp/claude-501/-Users-xuxiang-Code------/da6b4901-2703-4a17-8484-d6c75870f4a3/scratchpad';
const ONLY = process.env.ONLY || '';
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');
// 評估候選色時用:一串 CSS 宣告,套在 body.panel-translucent 上(與正式改法同一個選擇器層級,
// 且實色基準那半不受影響)。例:SPARK_VARS='--spark-line:#C3DAFF;--spark-plate:rgba(11,18,32,.8)'
const SPARK_VARS = process.env.SPARK_VARS || '';

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── G0 自檢:驗的到底是哪份檔案(心得 32:驗收腳本曾連兩輪驗到釘死的舊 worktree) ──
const idxPath = path.join(ROOT, 'index.html');
const diskMd5 = createHash('md5').update(readFileSync(idxPath)).digest('hex');
console.log(`\n== 目標 ==\n目錄 ${ROOT}\nindex.html md5 ${diskMd5}\n`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    // 衛星情境要真的載到 Esri 影像:圖磚端點不驗 token 值(memory: esri-key-validation-trap),
    // 給一個假值就能拿到真影像——量的是「亮色面板疊在衛星照片上」這個最壞情境。
    if (url.pathname === '/api/basemap-token') return res.end('{"esri":"HARNESS-FAKE"}');
    // 高鐵班表自 2026-08-07(9f05f2f)改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
    // 空物件是 200 ⇒ fetchJSONAt 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的
    // sys.data.trains 拋錯 ⇒ boot 停在 state.ready=true 之前 ⇒ waitForFunction 逾時。這裡吐打包的那份(同 schema)。
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;
{
  const served = Buffer.from(await fetch(BASE).then(r => r.arrayBuffer()));
  const servedMd5 = createHash('md5').update(served).digest('hex');
  ok('G0 伺服器吐回的 index.html 與磁碟逐 byte 相同', servedMd5 === diskMd5, `${servedMd5.slice(0, 10)} vs ${diskMd5.slice(0, 10)}`);
}

// ── 頁內採集:七個面板子樹的每個文字節點 + 其祖先背景鏈 ──
const COLLECT = () => {
  const PANEL_SEL = ['.board', '.traincard', '#nearCard', '#xingCard', '#xingHelp', '.follow-panel', '.freq-card'];
  const out = [];
  const seen = new Set();
  for (const sel of PANEL_SEL) {
    for (const panel of document.querySelectorAll(sel)) {
      if (seen.has(panel) || panel.hidden) continue;
      seen.add(panel);
      const pcs = getComputedStyle(panel), pr = panel.getBoundingClientRect();
      if (pcs.display === 'none' || pcs.visibility === 'hidden' || parseFloat(pcs.opacity) < 0.05) continue;
      if (pr.width < 8 || pr.height < 8 || pr.bottom < 0 || pr.top > innerHeight) continue;
      const pid = panel.id || String(panel.className).split(' ')[0];
      const walk = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const tx = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!tx) continue;
        const el = n.parentElement;
        if (!el || el.closest('[hidden]')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rects = [...rg.getClientRects()].map(r => [r.left, r.top, r.right, r.bottom])
          .filter(([l, t, r2, b]) => r2 - l > 1 && b - t > 1 && r2 > 0 && b > 0 && l < innerWidth && t < innerHeight);
        if (!rects.length) continue;
        const bgs = [];
        for (let a = el; a; a = a.parentElement) {
          const c = getComputedStyle(a).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bgs.push(c);
          if (a === panel) break;
        }
        bgs.reverse();
        out.push({
          panel: pid, text: tx.slice(0, 28), tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').split(' ').slice(0, 2).join('.'),
          color: cs.color, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
          shadow: cs.textShadow === 'none' ? '' : cs.textShadow, bgs, rects,
        });
      }
    }
  }
  return out;
};

// 速度曲線 canvas:回傳實際畫上去的像素座標與色值
const COLLECT_SPARK = () => {
  const el = document.getElementById('tcSpark');
  if (!el || !el.width) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 4) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) return null;
  const ctx = el.getContext('2d', { willReadFrequently: true });
  const dpr = el.width / r.width;
  const d = ctx.getImageData(0, 0, el.width, el.height).data;
  const bgs = [];
  for (let a = el; a; a = a.parentElement) {
    const bc = getComputedStyle(a).backgroundColor;
    if (bc && !/rgba\(0, 0, 0, 0\)|transparent/.test(bc)) bgs.push(bc);
    if (a.matches('.traincard, .board')) break;
  }
  // 只取「畫面上真的看得到」的那一段:手機的列車 sheet 會把 canvas 下半截切在可視區外,
  // 不裁的話會拿 sheet 外面的 tab bar 當背景真值,量出假的低對比(實測 1.81 vs 實際 7+)。
  const host = el.closest('.traincard, .board') || el.parentElement;
  const hr = host.getBoundingClientRect();
  const clip = {
    l: Math.max(0, r.left, hr.left), t: Math.max(0, r.top, hr.top),
    r: Math.min(innerWidth, r.right, hr.right), b: Math.min(innerHeight, r.bottom, hr.bottom),
  };
  const px = [];
  const st = Math.max(1, Math.round(dpr));
  for (let y = 0; y < el.height; y += st) for (let x = 0; x < el.width; x += st) {
    const i = (y * el.width + x) * 4;
    if (d[i + 3] < 40) continue;
    const px0 = r.left + x / dpr, py0 = r.top + y / dpr;
    if (px0 < clip.l || px0 > clip.r || py0 < clip.t || py0 > clip.b) continue;
    px.push([px0, py0, d[i], d[i + 1], d[i + 2], +(d[i + 3] / 255).toFixed(3)]);
  }
  if (px.length < 60) return null; // 幾乎整條被切掉:回 null 讓 G3 明說量不到,不要用殘塊充數
  // 曲線本體(線/游標/軸標,alpha=1)與面積填色(alpha≈.16–.34)要分開判:
  // 面積填色本來就是半透明裝飾,拿它一起算會把門檻拉成永遠不可能過。
  // 軸標的白色外框(strokeText)與底板也是 alpha=1 的像素,但它們正是「與背景同色」的那層,
  // 拿來算對比會把 5% 分位壓到 1.0 附近(判準抓錯對象)。把這兩個色回傳,量測時排除。
  // 白名單比黑名單可靠:外框/底板的反鋸齒邊會混出無數中間色(實測混到 (214,209,198),
  // 用「排除接近外框色」濾不掉)。改成只認「接近曲線本體三個色票」的像素。
  const keep = ['--spark-line', '--spark-cursor', '--spark-axis'].map(t => cs.getPropertyValue(t).trim()).filter(Boolean);
  // 底板是畫在 canvas 裡的(不是 CSS 背景),量測時要當成曲線與地圖之間的一層一起合成,
  // 否則會低估曲線的實際對比。
  return { rect: [r.left, r.top, r.right, r.bottom], bgs: bgs.reverse(), px, keep, plate: cs.getPropertyValue('--spark-plate').trim() };
};

// ── 頁內量測:把「面板藏起來」的截圖解碼、σ=3 高斯取樣,算每個文字節點的對比 ──
// 刻意在頁內做:(1) 免原生 PNG 依賴 (2) 兩引擎用同一份 JS 數學,結果可互相比對。
const MEASURE = async ({ b64, items, spark, vw, vh }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(img, 0, 0);
  const W = cv.width, H = cv.height;
  const sx = W / vw, sy = H / vh;            // 截圖與 CSS 像素的比例(deviceScaleFactor=1 時為 1)
  const D = c2.getImageData(0, 0, W, H).data;

  const SIG = 3, R = 6;                       // backdrop-filter: blur(3px) → σ=3,取 ±2σ
  const K = [];
  for (let i = -R; i <= R; i++) K.push(Math.exp(-(i * i) / (2 * SIG * SIG)));
  const cache = new Map();
  const bgAt = (px, py) => {
    const x0 = Math.round(px * sx), y0 = Math.round(py * sy);
    const key = y0 * W + x0;
    const hit = cache.get(key); if (hit) return hit;
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let dy = -R; dy <= R; dy++) {
      const y = Math.max(0, Math.min(H - 1, y0 + dy)), ky = K[dy + R];
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.max(0, Math.min(W - 1, x0 + dx)), w = ky * K[dx + R];
        const i = (y * W + x) * 4;
        r += D[i] * w; g += D[i + 1] * w; b += D[i + 2] * w; wsum += w;
      }
    }
    const v = { r: r / wsum, g: g / wsum, b: b / wsum, a: 1 };
    cache.set(key, v);
    return v;
  };

  // 注意:CSS 自訂屬性(--spark-line…)的 getPropertyValue 回傳的是原文,通常是 #RRGGBB;
  // 只認 rgb() 會全部解析失敗(白名單變空 → 整批像素被丟掉 → p5=null)。
  const parseColor = s => {
    if (!s) return null;
    const t = String(s).trim();
    const h = t.match(/^#([0-9a-f]{3,8})\b/i);
    if (h) {
      let v = h[1];
      if (v.length === 3 || v.length === 4) v = [...v].map(c => c + c).join('');
      const n = parseInt(v.slice(0, 6), 16);
      const a = v.length >= 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
    }
    const m = t.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const pctl = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

  const rows = [];
  const bgLums = [];
  for (const it of items) {
    const fg0 = parseColor(it.color);
    if (!fg0) continue;
    const chain = it.bgs.map(parseColor).filter(Boolean);
    const sh = it.shadow ? parseColor(it.shadow) : null;
    const halo = sh && sh.a >= 0.6 ? sh : null;
    const area = it.rects.reduce((a, [l, t, r, b]) => a + (r - l) * (b - t), 0);
    const step = Math.max(1, Math.round(Math.sqrt(area / 400)));
    const cts = [];
    for (const [l, t, r, b] of it.rects) {
      for (let y = t; y < b; y += step) for (let x = l; x < r; x += step) {
        const raw = bgAt(x, y);
        bgLums.push(lum(raw));
        let bg = raw;
        for (const c of chain) bg = over(c, bg);
        if (halo) bg = over({ ...halo, a: halo.a * 0.85 }, bg);  // 有 halo 的字:字周圍實際底色是 halo
        const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
        cts.push(contrast(fg, bg));
      }
    }
    if (!cts.length) continue;
    const need = (it.size >= 24 || (it.size >= 18.66 && it.weight >= 700)) ? 3.0 : 4.5;
    const p5 = pctl(cts, 0.05);
    rows.push({ panel: it.panel, text: it.text, tag: it.tag, cls: it.cls, color: it.color, size: it.size, weight: it.weight, halo: !!halo, p5, min: Math.min(...cts), need, pass: p5 >= need });
  }

  let sparkOut = null;
  if (spark) {
    const chain = spark.bgs.map(parseColor).filter(Boolean);
    const keepC = (spark.keep || []).map(parseColor).filter(Boolean);
    const plateC = (() => { const p = parseColor(spark.plate); return p && p.a > 0.02 ? p : null; })();
    const near = (p, q) => Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b) < 60;
    const strong = [], fillCts = [], dbg = [];
    let skipped = 0;
    for (const [x, y, r, g, b, a] of spark.px) {
      if (a >= 0.85 && !keepC.some(k => near({ r, g, b }, k))) { skipped++; continue; } // 不是曲線本體(外框/底板/其反鋸齒邊)
      let bg = bgAt(x, y);
      for (const c of chain) bg = over(c, bg);
      if (plateC) bg = over(plateC, bg);
      const fg = over({ r, g, b, a }, bg);
      const ct = contrast(fg, bg);
      (a >= 0.85 ? strong : fillCts).push(ct);
      if (a >= 0.85) dbg.push({ ct: +ct.toFixed(2), px: [Math.round(r), Math.round(g), Math.round(b)], bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)], at: [Math.round(x), Math.round(y)] });
    }
    dbg.sort((p, q) => p.ct - q.ct);
    sparkOut = { worst: dbg.slice(0, 8), n: strong.length, nFill: fillCts.length, nSkip: skipped, p5: pctl(strong, 0.05), min: strong.length ? Math.min(...strong) : null, fillP50: pctl(fillCts, 0.5) };
  }

  const mean = bgLums.reduce((a, b) => a + b, 0) / (bgLums.length || 1);
  const sd = Math.sqrt(bgLums.reduce((a, b) => a + (b - mean) ** 2, 0) / (bgLums.length || 1));
  return { rows, spark: sparkOut, bg: { mean, sd, n: bgLums.length } };
};

async function boot(browser, { theme, width, height, touch, sheetSize, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t, ss]) => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-appearance', t);
      localStorage.setItem('trainmap-panel-translucent', '1');
      if (ss) localStorage.setItem('trainmap-sheet-size', ss);
    } catch (e) {}
  }, [theme, sheetSize || '']);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(`pageerror: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`console.error: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  if (SPARK_VARS) await page.addStyleTag({ content: `body.panel-translucent{${SPARK_VARS}}` });
  const no = await page.evaluate(async () => {
    let tries = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 90) { await new Promise(r => setTimeout(r, 60)); tries++; }
    let running = null, any = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      if (!any) any = String(tr.train);
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (s && eff > s[0].depSec + 60 && eff < s[s.length - 1].arrSec - 120) { running = String(tr.train); break; }
    }
    const n = running || any;
    if (n) followTrainNo(n);
    return n;
  });
  await page.waitForTimeout(600);
  return { ctx, page, errs, no };
}

// 面板開啟片段。手機面板互斥(soloPanel),所以分成幾個 pass 各量一次;
// 桌機七面板可以同時開,一個 pass 量完。
const STEP = {
  traincard: no => `(() => { const tr = state.trains.find(t => String(t.train) === '${no}'); if (!tr) return false; renderTrainCard(tr); if (typeof setSparkOpen === 'function') setSparkOpen(true); return true; })()`,
  trainSheet: () => `(() => { if (typeof openTrainSheet !== 'function') return false; openTrainSheet(); const tc = document.getElementById('trainCard'); return tc.classList.contains('tc-sheet'); })()`,
  board: () => `(() => { openBoard({ name: '台北', sys: 'tra_sched' }); return true; })()`,
  nearCard: () => `(() => { if (typeof openNearbyStations !== 'function') return false; openNearbyStations(25.0478, 121.5170, 40); return true; })()`,
  xingCard: () => `(() => { const cr = (state.crossings || [])[0]; if (!cr || typeof openCrossingCard !== 'function') return false; openCrossingCard(cr); return true; })()`,
  xingHelp: () => `(() => { const el = document.getElementById('xingHelp'); if (!el) return false; el.hidden = false; el.classList.add('show'); clearTimeout(state._xingHelpT); return true; })()`,
  freqCard: () => `(() => {
    if (typeof setFreqFollow !== 'function') return false;
    for (const ln of (state.lines || [])) {
      const tt = ln._tt || (ln.times && ln.times.trips);
      if (tt && tt.length) { setFreqFollow({ ln, tr: tt[0] }); return !document.getElementById('freqCard').hidden; }
    }
    for (const ln of (state.lines || [])) {
      if (ln.stations && ln.stations.length) { setFreqFollow({ ln, k: 0 }); return !document.getElementById('freqCard').hidden; }
    }
    return false;
  })()`,
};

async function runSteps(page, names, no) {
  const opened = [], missing = [];
  for (const n of names) {
    let r = false;
    try { r = await page.evaluate(c => eval(c), STEP[n](no)); } catch (e) { r = false; }
    (r ? opened : missing).push(n);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(800);
  return { opened, missing };
}

const HIDE_PANELS = '.board,.traincard,#nearCard,#xingCard,#xingHelp,.follow-panel,.freq-card{visibility:hidden !important}';

// 判準:半透明「不得比實色模式明顯差」+ 絕對地板 3.0。
// 為什麼不是硬套 WCAG 4.5:實色紙面下 --ok 綠(#1B8F4D)本來就只有 4.03、--red 也接近門檻,
// 那是既有色票的事(要改得動品牌色),不是這次半透明造成的回歸。實色基準低於 4.5 的另外列出來。
const FLOOR = 3.0, KEEP = 0.8;
const sdSeen = [];

async function measurePass(page, sc, label, pass, no) {
  const { opened, missing } = await runSteps(page, pass.steps, no);
  // 桌機的速度曲線落在摺線以下(1280×800 實測可視像素 0 個 → G3 只會回「找不到 #tcSpark」),
  // 先把它捲進畫面再取樣;背景真值那張截圖也是在捲動之後才拍,兩者同一個視窗位置。
  if (pass.spark) {
    await page.evaluate(() => {
      const sw = document.querySelector('.tc-sparkwrap');
      if (sw && !sw.hidden) sw.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200); // 等圖磚
  const tiles = await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter(i => i.naturalWidth > 0).length);
  const itemsT = await page.evaluate(COLLECT);
  const sparkT = await page.evaluate(COLLECT_SPARK);
  await page.screenshot({ path: `${OUT}/_glass_${label.replace(/\//g, '_')}_${pass.name}.png` });
  // 實色基準:同一個 DOM、同一個地圖位置、同一秒的資料,只把 class 關掉(曲線要重畫才換色)
  await page.evaluate(() => {
    document.body.classList.remove('panel-translucent');
    if (state.followTrain && typeof drawSpark === 'function') drawSpark(state.followTrain, effTLive(state.followTrain));
  });
  await page.waitForTimeout(150);
  const itemsS = await page.evaluate(COLLECT);
  const sparkS = await page.evaluate(COLLECT_SPARK);
  await page.evaluate(() => {
    document.body.classList.add('panel-translucent');
    if (state.followTrain && typeof drawSpark === 'function') drawSpark(state.followTrain, effTLive(state.followTrain));
  });
  const style = await page.addStyleTag({ content: HIDE_PANELS });
  await page.waitForTimeout(300);
  const shotB = await page.screenshot();
  const b64 = shotB.toString('base64');
  const mT = await page.evaluate(MEASURE, { b64, items: itemsT, spark: sparkT, vw: sc.width, vh: sc.height });
  const mS = await page.evaluate(MEASURE, { b64, items: itemsS, spark: sparkS, vw: sc.width, vh: sc.height });
  await style.evaluate(el => el.remove());

  const tag = `${label}/${pass.name}`;
  // 圖磚真的載到才有背景真值可談;變異度只當資訊列出來——暗色底圖本來就是接近純黑的平面,
  // sd 低是事實不是缺陷(全域另有一條 G1z 確認這套量測抓得到變異)。
  sdSeen.push(mT.bg.sd);
  ok(`G1 ${tag} 背景有實際內容可量(圖磚 ${tiles} 張)`, tiles >= 8,
    `亮度 sd=${mT.bg.sd.toFixed(4)} mean=${mT.bg.mean.toFixed(3)} 取樣 ${mT.bg.n}`);
  ok(`G1b ${tag} 該開的面板都開了`, missing.length === 0, missing.length ? `開不起來:${missing.join('/')}` : opened.join('/'));

  // 逐元素配對(走訪順序相同;即時資料跳動的節點文字會不同 → 排除並記數)
  const paired = [], unmatched = [];
  for (let i = 0; i < Math.min(mT.rows.length, mS.rows.length); i++) {
    const t = mT.rows[i], s = mS.rows[i];
    if (t.text !== s.text || t.cls !== s.cls) { unmatched.push(t); continue; }
    paired.push({ ...t, solid: s.p5 });
  }
  // 相對回歸只有在「掉到 AA 門檻以下」才算病:7.07 vs 實色 8.87 讀起來一樣清楚,
  // 拿比例硬判只會逼出沒有意義的修法(心得 35:判準不要綁在會漂移的量上)。
  const bad = paired.filter(r => r.p5 < FLOOR || (r.p5 < r.solid * KEEP && r.p5 < 4.5)).sort((a, b) => a.p5 - b.p5);
  const palette = paired.filter(r => r.solid < 4.5);
  ok(`G2 ${tag} 半透明文字不比實色差(配對 ${paired.length}/${mT.rows.length} 個節點)`,
    bad.length === 0 && paired.length >= 6,
    paired.length < 6 ? `只配對到 ${paired.length} 個節點,取樣可能整批落空` :
    bad.length ? `${bad.length} 個掉太多:` + bad.slice(0, 5).map(r => `${r.panel}/${r.cls || r.tag}「${r.text.slice(0, 9)}」${r.p5.toFixed(2)}(實色 ${r.solid.toFixed(2)})`).join('; ')
      : `最低 ${Math.min(...paired.map(r => r.p5)).toFixed(2)};實色底本來就<4.5 的 ${palette.length} 個(既有色票,非本次回歸);跳動未配對 ${unmatched.length}`);

  if (pass.spark) {
    if (mT.spark && mS.spark) {
      const t = mT.spark, s = mS.spark;
      const f2 = v => (v == null ? 'n/a' : v.toFixed(2));
      if (process.env.DEBUG_SPARK) console.log('   worst:', JSON.stringify(t.worst));
      ok(`G3 ${tag} 速度曲線本體對比(${t.n} 本體像素/填色 ${t.nFill}/非本體 ${t.nSkip})`, t.p5 != null && t.p5 >= FLOOR && t.n >= 100,
        `半透明 ${f2(t.p5)} vs 實色 ${f2(s.p5)};面積填色中位 半透明 ${f2(t.fillP50)} vs 實色 ${f2(s.fillP50)}`);
    } else ok(`G3 ${tag} 速度曲線可量到`, false, '找不到 #tcSpark 或未展開');
  }
  return bad.map(b => ({ ...b, label: tag }));
}

async function runScenario(browser, engine, sc) {
  const label = `${engine}/${sc.theme}${sc.basemap === 'sat' ? '+衛星' : ''}/${sc.tag}`;
  if (ONLY && !label.includes(ONLY)) return null;
  const { ctx, page, errs, no } = await boot(browser, sc);
  if (sc.basemap === 'sat') {
    const satOn = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) { if (typeof satTokenState !== 'undefined' && satTokenState !== 'pending') break; await new Promise(r => setTimeout(r, 100)); }
      if (typeof setBasemap !== 'function') return false;
      state.basemap = 'sat'; setBasemap();
      return state.basemap === 'sat';
    });
    ok(`G1c ${label} 衛星底圖切得過去`, satOn, satOn ? '' : 'setBasemap 沒切到 sat(token 或按鈕被移除)');
    await page.waitForTimeout(2500);
  }
  const bad = [];
  for (const pass of sc.passes) bad.push(...await measurePass(page, sc, label, pass, no));

  // ── G4 收合到最小的列車資訊要恢復不透明 ──
  const mins = await page.evaluate(() => {
    const res = {};
    const fp = document.getElementById('followPanel');
    if (fp && !fp.hidden) {
      const had = fp.classList.contains('fp-min');
      fp.classList.add('fp-min');
      const cs = getComputedStyle(fp);
      res.fpMin = { bg: cs.backgroundColor, bd: cs.backdropFilter || cs.webkitBackdropFilter };
      if (!had) fp.classList.remove('fp-min');
    }
    const tc = document.querySelector('.traincard');
    if (tc && tc.classList.contains('tc-sheet')) {
      const had = tc.classList.contains('sheet-small');
      tc.classList.add('sheet-small');
      const cs = getComputedStyle(tc);
      res.tcSmall = { bg: cs.backgroundColor, bd: cs.backdropFilter || cs.webkitBackdropFilter };
      if (!had) tc.classList.remove('sheet-small');
    }
    return res;
  });
  for (const [k, v] of Object.entries(mins)) {
    const c = (v.bg.match(/rgba?\(([^)]+)\)/) || [])[1];
    const a = c ? (c.split(/[\s,/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
    ok(`G4 ${label} ${k} 收合態恢復實色`, a >= 0.9 && (!v.bd || v.bd === 'none'), `bg=${v.bg} backdrop=${v.bd}`);
  }

  // ── G5 關掉開關要回到原本的樣子 ──
  const off = await page.evaluate(() => {
    document.body.classList.remove('panel-translucent');
    const el = document.querySelector('.follow-panel:not([hidden])') || document.querySelector('.board:not([hidden])');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, bd: cs.backdropFilter || cs.webkitBackdropFilter, shadow: cs.textShadow,
      muted: cs.getPropertyValue('--muted').trim(), faint: cs.getPropertyValue('--faint').trim(),
      line: cs.getPropertyValue('--line').trim(), lineDash: cs.getPropertyValue('--line-dash').trim() };
  });
  const oa = (off.bg.match(/rgba?\(([^)]+)\)/) || [])[1];
  const offAlpha = oa ? (oa.split(/[\s,/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
  ok(`G5 ${label} 關掉半透明後回實色、無 halo`, offAlpha >= 0.9 && (!off.bd || off.bd === 'none') && (off.shadow === 'none' || !off.shadow),
    `bg=${off.bg} backdrop=${off.bd} shadow=${off.shadow} muted=${off.muted} faint=${off.faint} line=${off.line}`);

  ok(`G6 ${label} 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
  return { label, bad };
}

// 桌機七面板可同時開,一個 pass 掃完;手機面板互斥(soloPanel),拆成四個 pass。
// 已知覆蓋缺口:七個半透明面板裡的 .freq-card(捷運跟隨小卡)沒有納入自動量測——
// 在無網路 fixture 下開不起來(setFreqFollow 需要實際的捷運班表物件)。它與 .follow-panel
// 共用同一組面板層規則(外圈、色票升階),風險同級但未被實測,不當作已驗。
const DESKTOP_PASSES = [
  { name: '全開', steps: ['traincard', 'board', 'nearCard', 'xingCard', 'xingHelp'], spark: true },
];
const MOBILE_PASSES = [
  { name: '列車sheet', steps: ['trainSheet'], spark: true },
  { name: '車站看板', steps: ['board'], spark: false },
  { name: '附近車站', steps: ['nearCard'], spark: false },
  { name: '平交道', steps: ['xingCard', 'xingHelp'], spark: false },
];
const D = { tag: 'desktop', width: 1280, height: 800, touch: false, passes: DESKTOP_PASSES };
const M = { tag: 'mobile', width: 390, height: 844, touch: true, passes: MOBILE_PASSES };
const SCENARIOS = [
  { ...D, theme: 'light' },
  { ...D, theme: 'dark' },
  { ...M, theme: 'light' },
  { ...M, theme: 'dark' },
  // 衛星影像=使用者實機回報最糟的一張:亮色面板疊在深淺交錯的照片上
  { ...M, theme: 'light', basemap: 'sat' },
  { ...D, theme: 'light', basemap: 'sat' },
  { ...M, theme: 'dark', basemap: 'sat' },
];

const allBad = [];
for (const engineName of ENGINES) {
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  for (const sc of SCENARIOS) {
    const r = await runScenario(browser, engineName, sc);
    if (r) allBad.push(...r.bad);
  }
  await browser.close();
}
server.close();

if (allBad.length) {
  const lines = ['# 半透明面板未達標文字明細', '', '| 情境 | 面板 | 元素 | 文字 | 字級/字重 | 色 | halo | 半透明 5%分位 | 實色基準 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const b of allBad.sort((x, y) => x.p5 - y.p5)) {
    lines.push(`| ${b.label} | ${b.panel} | ${b.tag}.${b.cls} | ${b.text} | ${b.size}/${b.weight} | ${b.color} | ${b.halo ? 'Y' : ''} | ${b.p5.toFixed(2)} | ${b.solid != null ? b.solid.toFixed(2) : '-'} |`);
  }
  writeFileSync(`${OUT}/未達標_半透明對比.md`, lines.join('\n'));
  console.log(`\n未達標明細(${allBad.length} 筆) → ${OUT}/未達標_半透明對比.md`);
}

ok('G1z 這套量測抓得到背景變異(至少一個情境的地圖底不是平面)', Math.max(...sdSeen) > 0.05, `各情境亮度 sd 最大值 ${Math.max(...sdSeen).toFixed(4)}`);

const fail = results.filter(r => !r.pass);
console.log(`\n== ${results.length - fail.length}/${results.length} PASS ==`);
if (fail.length) { console.log(fail.map(f => 'FAIL ' + f.name + (f.detail ? ' — ' + f.detail : '')).join('\n')); process.exit(1); }

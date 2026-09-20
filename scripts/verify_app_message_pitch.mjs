#!/usr/bin/env node
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
let server = null;
let base = process.argv[2];
if (!base) {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://local.test');
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end('{}');
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!path.resolve(file).startsWith(ROOT) || !existsSync(file)) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
}
const sizes = [
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 740, height: 430 },
];
const failures = [];
const pass = label => console.log(`✅ ${label}`);
const fail = (label, detail) => { failures.push(`${label}: ${detail}`); console.error(`❌ ${label} — ${detail}`); };

for (const [engineName, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await launcher.launch({ headless: true });
  for (const viewport of sizes) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${base}?g=all`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof showToast === 'function' && typeof drawMe === 'function' && M && ctx,
      null, { timeout: 90_000 });

    const result = await page.evaluate(async () => {
      document.body.classList.add('fs', 'mobile-shell');
      document.documentElement.dataset.fs = '1';
      const panel = document.getElementById('followPanel');
      panel.hidden = false;
      panel.classList.remove('fp-min');
      panel.style.maxHeight = '520px';
      const box = document.getElementById('toasts');
      box.replaceChildren();

      const inspect = () => {
        const toast = box.lastElementChild;
        const tr = toast.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const cs = getComputedStyle(toast);
        const bs = getComputedStyle(box);
        return {
          text: toast.textContent,
          toastRect: { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom, width: tr.width, height: tr.height },
          boxRect: { left: br.left, right: br.right, top: br.top, bottom: br.bottom, width: br.width, height: br.height },
          toastScroll: { width: toast.scrollWidth, height: toast.scrollHeight, clientWidth: toast.clientWidth, clientHeight: toast.clientHeight },
          boxScroll: { height: box.scrollHeight, clientHeight: box.clientHeight },
          whiteSpace: cs.whiteSpace,
          overflow: cs.overflow,
          overflowY: bs.overflowY,
          maxHeight: box.style.maxHeight,
        };
      };

      showToast('開始收集 · 竹南 → 苗栗（沒定到位置，上車站先算搭過）', { wrap: true });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const collect = inspect();

      box.replaceChildren();
      showToast('官方訊號恢復　北捷即時資料中斷約 6 分鐘後恢復，1 台列車已重新對齊官方位置——中斷期間畫面上的位置是推估的，所以這些車會往前跳或往後退。', { wrap: true });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const recovery = inspect();

      const old = {
        getPitch: M.getPitch,
        detailOpacity: M.detailOpacity,
        toScreen: M.toScreen,
        getZoom: M.getZoom,
        arc: ctx.arc,
      };
      mePos = { lat: 24.5, lon: 121, acc: 80 };
      M.detailOpacity = () => 1;
      M.toScreen = () => ({ x: 120, y: 120 });
      M.getZoom = () => 15;
      const arcs = [];
      ctx.arc = (...args) => arcs.push(args);
      M.getPitch = () => 0;
      drawMe();
      const flatArcs = arcs.length;
      arcs.length = 0;
      state.followTrain = null;
      state.freqFollow = null;
      M.getPitch = () => 45;
      drawMe();
      const tiltedFreeArcs = arcs.length;
      arcs.length = 0;
      state.followTrain = { train: 'test' };
      drawMe();
      const tiltedFollowArcs = arcs.length;
      state.followTrain = null;
      M.getPitch = old.getPitch;
      M.detailOpacity = old.detailOpacity;
      M.toScreen = old.toScreen;
      M.getZoom = old.getZoom;
      ctx.arc = old.arc;

      box.replaceChildren();
      showToast('點通知外面應立即收起', { wrap: true });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__outsideToastTap = 0;
      document.addEventListener('pointerdown', () => { window.__outsideToastTap++; }, { once: true });
      return { collect, recovery, flatArcs, tiltedFreeArcs, tiltedFollowArcs };
    });

    const label = `${engineName} ${viewport.width}×${viewport.height}`;
    for (const [kind, metrics] of [['收集通知', result.collect], ['訊號恢復', result.recovery]]) {
      const fitsWidth = metrics.toastScroll.width <= metrics.toastScroll.clientWidth + 1;
      const fitsHeight = metrics.toastScroll.height <= metrics.toastScroll.clientHeight + 1;
      const insideViewport = metrics.toastRect.left >= -1 && metrics.toastRect.right <= viewport.width + 1
        && metrics.toastRect.top >= -1 && metrics.toastRect.bottom <= viewport.height + 1;
      const parentNotClipping = metrics.boxScroll.height <= metrics.boxScroll.clientHeight + 1
        && metrics.overflowY === 'visible' && metrics.maxHeight === '';
      if (fitsWidth && fitsHeight && insideViewport && parentNotClipping && metrics.whiteSpace !== 'nowrap' && metrics.overflow !== 'hidden') {
        pass(`${label} ${kind}完整可見`);
      } else {
        fail(`${label} ${kind}完整可見`, JSON.stringify(metrics));
      }
    }
    if (result.flatArcs >= 3 && result.tiltedFreeArcs === 0 && result.tiltedFollowArcs === 0) {
      pass(`${label} 平面顯示定位點，手動／跟車傾斜均隱藏`);
    } else {
      fail(`${label} 定位點傾斜狀態`, JSON.stringify(result));
    }
    // show class 由 requestAnimationFrame 掛上；WebKit 忙著載地圖資產時，兩個 rAF 並不保證
    // CSS 狀態已經可供下一個原生觸控事件讀到。先等通知確實進入 show，避免 handler 看見空集合。
    await page.waitForFunction(() => document.querySelectorAll('#toasts .toast.show, #toastsCorner .toast.show').length > 0,
      null, { timeout: 2_000 });
    // 通知會依頂列／跟車卡動態換位置；固定點左下角在矮螢幕或窄螢幕可能正好落進通知矩形，
    // 那是在「點通知本身」而不是驗「點外部」。先從多個可點座標找一個確實不在任何通知內，
    // 再用真實 touchscreen.tap；避免版面正確時測試反而隨通知落點隨機紅。
    const outsidePoint = await page.evaluate(() => {
      const rects = [...document.querySelectorAll('#toasts .toast.show, #toastsCorner .toast.show')]
        .map(element => element.getBoundingClientRect());
      const candidates = [
        [4, 4], [innerWidth - 4, 4], [4, innerHeight - 4], [innerWidth - 4, innerHeight - 4],
        [innerWidth / 2, 4], [innerWidth / 2, innerHeight - 4], [4, innerHeight / 2],
        [innerWidth - 4, innerHeight / 2], [innerWidth / 2, innerHeight / 2],
      ];
      return candidates.find(([x, y]) => !rects.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) || null;
    });
    if (!outsidePoint) {
      fail(`${label} 找不到通知外觸控座標`, '通知矩形覆蓋所有候選點');
    } else {
      await page.touchscreen.tap(outsidePoint[0], outsidePoint[1]);
    }
    let dismissedInTime = false;
    try {
      // pointerdown 會同步拿掉 show，再以 450ms transition 移除節點；等待條件比固定睡 500ms
      // 更能承受 WebKit 主執行緒正忙，同時仍會把「根本沒收起」在 2 秒內判紅。
      await page.waitForFunction(() => document.querySelectorAll('#toasts .toast.show, #toastsCorner .toast.show').length === 0,
        null, { timeout: 1_000 });
      await page.waitForFunction(() => document.querySelectorAll('#toasts .toast, #toastsCorner .toast').length === 0,
        null, { timeout: 2_000 });
      dismissedInTime = true;
    } catch {}
    const dismiss = await page.evaluate(() => ({
      count: document.querySelectorAll('#toasts .toast, #toastsCorner .toast').length,
      propagated: window.__outsideToastTap,
    }));
    if (dismissedInTime && dismiss.count === 0 && dismiss.propagated === 1) {
      pass(`${label} 真實觸控點通知外即收起，且原點擊不被吞掉`);
    } else {
      fail(`${label} 點外部收起通知`, JSON.stringify({ ...dismiss, outsidePoint, dismissedInTime }));
    }
    if (errors.length) fail(`${label} pageerror`, errors.join(' | '));
    await context.close();
  }
  await browser.close();
}

if (failures.length) {
  if (server) server.close();
  console.error(`\n${failures.length} 項驗收失敗`);
  process.exit(1);
}
if (server) server.close();
console.log('\n兩引擎、五種手機視窗驗收全數通過。');

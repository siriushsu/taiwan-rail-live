#!/usr/bin/env node
// 「匯出捷運診斷」入口的手機／觸控驗收。依專案 gate 掃 360/375/414/768、真的 page.tap、
// elementFromPoint、同 sheet 控件相交、水平溢出，並涵蓋 body.fs。
import { chromium } from 'playwright';

const URL = process.argv.find(x => /^https?:/.test(x)) || 'http://127.0.0.1:5186/index.html';
const widths = [360, 375, 414, 768];
const browser = await chromium.launch();
let failures = 0;
const check = (pass, label, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
    acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('moreSheet') && document.getElementById('trtcDiagExportRow'));
  const opener = await page.locator('#tabMore').isVisible() ? '#tabMore' : '#toolsFab';
  await page.tap(opener);
  await page.tap('[data-act="diagStrip"]');
  const result = await page.evaluate(() => {
    const row = document.getElementById('trtcDiagExportRow'), rr = row.getBoundingClientRect();
    const top = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
    const controls = [...document.querySelectorAll('#moreSheet button:not([hidden]), #moreSheet .ms-row:not([hidden])')]
      .filter(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && el !== row;
      });
    const overlaps = controls.filter(el => {
      const r = el.getBoundingClientRect();
      return rr.left < r.right && rr.right > r.left && rr.top < r.bottom && rr.bottom > r.top;
    }).map(el => el.id || el.textContent.trim().slice(0, 24));
    return { hidden: row.hidden, hit: !!top && (top === row || row.contains(top)),
      rect: { left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom, height: rr.height }, overlaps,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check(!result.hidden && result.hit, `${width}px：觸控開啟後按鈕可達且 elementFromPoint 命中`, JSON.stringify(result.rect));
  check(result.rect.height >= 40 && result.rect.left >= 0 && result.rect.right <= width,
    `${width}px：觸控目標留在 viewport 內`, `h=${result.rect.height.toFixed(0)}`);
  check(result.overlaps.length === 0, `${width}px：不與 sheet 其他控件相交`, result.overlaps.join(', '));
  check(result.overflowX <= 0, `${width}px：沒有水平捲動`, `overflow=${result.overflowX}`);

  // 全畫面態再開一次（先關 sheet，避免只在既有開啟狀態改 class 的假測）。
  await page.tap('#moreClose');
  await page.evaluate(() => document.body.classList.add('fs'));
  await page.tap(opener);
  const fsHit = await page.evaluate(() => {
    const row = document.getElementById('trtcDiagExportRow'), r = row.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !row.hidden && !!top && (top === row || row.contains(top)) && r.top >= 0 && r.bottom <= innerHeight;
  });
  check(fsHit, `${width}px body.fs：匯出按鈕仍在可點範圍`);

  if (width === 375) {
    const downloadPromise = page.waitForEvent('download');
    await page.tap('#trtcDiagExportRow');
    const download = await downloadPromise, stream = await download.createReadStream();
    let text = ''; for await (const chunk of stream) text += chunk.toString();
    let json = null; try { json = JSON.parse(text); } catch {}
    check(download.suggestedFilename().startsWith('railisland-trtc-entity-') && json?.schema === 1 && json?.windowSec === 600,
      '375px：實際點擊可下載合法的 10 分鐘診斷 JSON', download.suggestedFilename());
  }
  check(errors.length === 0, `${width}px：沒有 pageerror`, errors[0] || '');
  await context.close();
}

await browser.close();
console.log(failures ? `\n❌ ${failures} 項未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);

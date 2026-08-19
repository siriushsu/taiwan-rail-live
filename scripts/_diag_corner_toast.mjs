import { chromium } from 'playwright';
import fs from 'node:fs';
const html = fs.readFileSync('index.html', 'utf8');
const U = 'https://railisland.tw/';
const b = await chromium.launch();
for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  await p.waitForTimeout(2500);
  // 首訪教學卡會蓋住地圖,量之前先關掉(自己記過的坑)
  await p.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w) w.remove(); });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    showToast('位置已校正 <b>3</b> 台', { corner: true });
    return new Promise(res => setTimeout(() => {
      const el = document.querySelector('#toastsCorner .toast');
      if (!el) return res({ err: '沒有產生角落提示' });
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      // pointer-events:none ⇒ 命中會穿透到底下那層,這正是要看的:底下是誰
      const under = document.elementFromPoint(cx, cy);
      const path = []; let n = under;
      while (n && path.length < 4) { path.push(n.id ? '#' + n.id : (n.className && String(n.className).split(' ')[0] ? '.' + String(n.className).split(' ')[0] : n.tagName)); n = n.parentElement; }
      const vis = getComputedStyle(el);
      const box = document.getElementById('toastsCorner');
      const bb = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const op = box.offsetParent;
      const opr = op ? op.getBoundingClientRect() : null;
      return res({ rect: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        vw: innerWidth, vh: innerHeight, under: path.join(' < '), opacity: vis.opacity, fs: vis.fontSize,
        box: { y: Math.round(bb.top), h: Math.round(bb.height) },
        offsetParent: op ? (op.id ? '#' + op.id : '.' + String(op.className).split(' ')[0]) : null,
        css: { pos: cs.position, top: cs.top, bottom: cs.bottom, left: cs.left },
        inline: box.getAttribute('style') || '(無)',
        opRect: opr ? { y: Math.round(opr.top), h: Math.round(opr.height) } : null });
    }, 700));
  });
  console.log(`${w}px  ${JSON.stringify(r)}`);
  await p.screenshot({ path: `/private/tmp/claude-501/-Users-xuxiang-Code------/f490da7b-adc7-4d84-87c3-102afc64cf0b/scratchpad/corner_${w}.png` });
  await p.close();
}
await b.close();

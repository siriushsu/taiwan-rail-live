// 「更多」抽屜(桌面 ≥901)在頁面已捲動時開啟,面板上緣不得被推出視窗。
//
// 症狀(2026-08-04 使用者回報):先拉右側捲軸往下,再點 ☰ 開「更多」,看不到選單上方;
// 要關掉、把捲軸歸位、重開才看得到。
// 根因:positionMoreSheet() 把 fixed 面板的 bottom 設成 (innerHeight - 鈕的 viewport top + 8)。
// 桌面帶隨頁面捲動 ⇒ 捲下去後鈕的 r.top 變小甚至為負 ⇒ bottom 變大 ⇒ 面板被往上推出視窗。
// left 本來就有 clamp,bottom 沒有。
//
// 判準刻意綁「面板在視窗內」這個語意,不綁任何座標常數(心得35:判準寫是什麼,不寫幾 px)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const PORT = 5299;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

let pass = 0, fail = 0;
const bad = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; bad.push(`${name}${detail ? ' (' + detail + ')' : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// 桌面尺寸兩種:一般筆電高度與較矮的視窗(矮視窗更容易讓面板頂出去)
const VIEWPORTS = [{ w: 1280, h: 800 }, { w: 1440, h: 700 }];

async function openSheetAt(page, scrollY) {
  await page.evaluate(y => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(120);
  // 開之前先確保是關的(每輪獨立)
  await page.evaluate(() => { if (document.body.classList.contains('tools-open')) document.getElementById('toolsFab').click(); });
  await page.waitForTimeout(80);
  await page.click('#toolsFab');
  await page.waitForTimeout(180);
  return page.evaluate(() => {
    const s = document.getElementById('moreSheet');
    const f = document.getElementById('toolsFab');
    const r = s.getBoundingClientRect(), fr = f.getBoundingClientRect();
    return {
      open: document.body.classList.contains('tools-open'),
      top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
      vh: window.innerHeight, scrollY: Math.round(window.scrollY),
      fabTop: Math.round(fr.top),
      // 面板最上面那一列的中心點,實際拿它做命中測試(rect 在視窗內 ≠ 點得到)
      firstRowHit: (() => {
        const row = s.querySelector('.ms-row, .ms-sec');
        if (!row) return 'no-row';
        const rr = row.getBoundingClientRect();
        const el = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
        return el ? (s.contains(el) ? 'in-sheet' : el.id || el.className || el.tagName) : 'null';
      })(),
    };
  });
}

for (const br of [{ n: 'chromium', b: chromium }, { n: 'WebKit', b: webkit }]) {
  const browser = await br.b.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    // 首訪教學卡(#howtoWrap,z800)會攔截所有點擊——不先關掉,click 會 timeout,
    // 而且 elementFromPoint 全部命中它,命中測試等於失明。
    await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#toolsFab', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(900); // 讓帶/站台帶排好,頁面高度穩定

    const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    const tag = `${br.n} ${vp.w}x${vp.h}`;
    ok(`${tag} 前提:頁面真的可捲動(否則本測試沒有鑑別力)`, maxScroll > 50, `maxScroll=${maxScroll}`);
    // 前提二:沒有任何全屏卡擋著。不驗這條的話,下面所有命中測試都可能是在測那張卡。
    const blockers = await page.evaluate(() => {
      const hw = document.getElementById('howtoWrap');
      const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return { hwHidden: !hw || hw.hidden, mid: mid ? (mid.id || mid.className || mid.tagName) : 'null' };
    });
    ok(`${tag} 前提:首訪教學卡沒擋著`, blockers.hwHidden === true, JSON.stringify(blockers));

    // 0 是控制組(未捲動,原本就正常);其餘是回報的情境
    const steps = [0, 150, 400, Math.round(maxScroll / 2), maxScroll].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    for (const y of steps) {
      const s = await openSheetAt(page, y);
      const label = y === 0 ? '控制組 scrollY=0' : `scrollY=${y}`;
      ok(`${tag} ${label}:面板有開`, s.open === true, JSON.stringify(s));
      ok(`${tag} ${label}:上緣沒被推出視窗(top>=0)`, s.top >= 0, `top=${s.top} bottom=${s.bottom} h=${s.h} vh=${s.vh} fabTop=${s.fabTop}`);
      ok(`${tag} ${label}:下緣沒掉出視窗(bottom<=vh)`, s.bottom <= s.vh, `bottom=${s.bottom} vh=${s.vh}`);
      ok(`${tag} ${label}:最上面那一列真的點得到(不是只有 rect 在視窗內)`, s.firstRowHit === 'in-sheet', `hit=${s.firstRowHit}`);
      // 反向:不准為了「看得見」就改成無條件靠頂。鈕上方塞得下整個面板時,原本的設計(貼齊鈕上方 8px)
      // 必須維持——沒有這條,把 bottom 寫死成 innerHeight-H-12 也會讓上面三條全綠。
      const roomEnough = (s.fabTop - 8 - s.h) >= 12;
      ok(`${tag} ${label}:鈕上方空間夠時仍貼齊鈕(沒有修過頭變成永遠靠頂)`,
        !roomEnough || Math.abs(s.bottom - (s.fabTop - 8)) <= 1,
        `roomEnough=${roomEnough} bottom=${s.bottom} 期望貼齊=${s.fabTop - 8}`);
    }
    ok(`${tag} 全程零 pageerror/console.error`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await browser.close();
}

server.close();
console.log(`\n──────── ${pass}/${pass + fail} PASS ────────`);
if (fail) { bad.forEach(b => console.log(`FAIL: ${b}`)); process.exit(1); }
console.log('全部 PASS');

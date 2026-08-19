import { chromium } from 'playwright';
import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
const U = 'https://railisland.tw/';
const b = await chromium.launch(); const p = await b.newPage();
await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
  r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
if (process.env.LOCAL_DATA === '1') await p.route(u => {
  const x = new URL(u); return x.origin === new URL(U).origin && x.pathname.startsWith('/data/');
}, r => { const f = '.' + new URL(r.request().url()).pathname;
  if (!fs.existsSync(f)) return r.continue();
  r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(f) }); });
await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
const r = await p.evaluate(() => state.lines.filter(l => isTrtcBoardLine(l)).map(ln => {
  const n = ln.stations.length; let dw = 0, run = 0, dwv = [];
  for (let i = 0; i < n; i++) { const v = Number((ln.stations[i] || {}).dwell);
    if (v > 0) { dw++; dwv.push(v); } }   // 官方值本來就有很多剛好 25,不能用「不等於 25」當有無
  for (let i = 0; i + 1 < n; i++) if (Number(runBetween(ln, i, i + 1)) > 0) run++;
  dwv.sort((a, c) => a - c);
  return { id: ln.id, n, dwell: `${dw}/${n}`, run: `${run}/${n - 1}`,
    dwellRange: dwv.length ? `${dwv[0]}~${dwv[dwv.length - 1]}s` : '(無)' };
}));
await b.close(); console.log('線別        站數  有停靠秒  有行駛秒  停靠秒範圍');
for (const x of r) console.log(`${x.id.padEnd(12)}${String(x.n).padStart(4)}${x.dwell.padStart(10)}${x.run.padStart(10)}  ${x.dwellRange}`);

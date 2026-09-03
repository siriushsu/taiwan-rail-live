#!/usr/bin/env node
// OBS 直播／導播模式(?live=1／?live=2)刪除的守門人。
// G1 靜態:index.html 與 design-mock.html 對「OBS 機制＋REPLAY 骨架＋導播專用放空分支」的 grep 必為 0。
// G2 動態:帶 ?live=1 開機,body 不得有 live class、state 不得有 liveMode／director、#liveHud／#replayBadge 不存在、零 pageerror。
// G3 正向對照:同名家族必須還在——#liveBadge 元素存在、updateLiveBadge 是函式、原始碼仍有 state.nightReplay = true（放空深夜重播；該旗標延遲賦值、冷開機不在 state 上,不能用 in 判）——
//    證明刪的是 OBS,不是「所有叫 live 的東西」。少了這條,把整包 LIVE 徽章一起砍掉也會全綠。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(process.argv[2] || join(import.meta.dirname, '..'));
const PORT = Number(process.env.OBS_PORT || 43533);
const PATTERN = /state\.liveMode|state\.director\b|state\.liveReplay|state\._liveMapOverride|state\._dirBmIdx|state\._dirPhase|state\._dirNext|DIRECTOR_KEY|DIRECTOR_FOLLOW_Z|DIR_FOLLOW_BLOCK|DIR_GROUP_BLOCK|DIR_BASEMAPS|LIVE_REPLAY_FROM|LIVE_REPLAY_TO|function initDirector|function initLive|function directorTick|function directorClockTick|function liveClockTick|function advanceDirectorBasemap|function pickTourMetro|function pickCityOverview|function ambientJumpToMetro|function fadeSwitchMetro|function metroCoverage|METRO_TOUR_CHANCE|CITY_OVERVIEW_SPEED|classList\.(add|contains|remove)\('live'\)|classList\.(add|contains|remove)\('director'\)|body\.live[ .]|body\.director\b|body\.fs\.live\b|:not\(\.live\)|\.live-hud|\.live-wm|id="liveHud"|\?live=1|\?live=2|\?live\b|get\('live'\)|replayBadge|msStatReplay|\.badge \.replay|sc\.slow|導播/g;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`); };

// ── G1 靜態 ──
for (const f of ['index.html', 'design-mock.html']) {
  const src = await readFile(join(ROOT, f), 'utf8');
  const hits = [];
  // 命中 DIRECTOR_KEY 那行只印行號不印內容:repo 是 PUBLIC,守門人的輸出會被貼進回報
  src.split('\n').forEach((ln, i) => { if (PATTERN.test(ln)) hits.push(`${i + 1}: ${/DIRECTOR_KEY/.test(ln) ? '(DIRECTOR_KEY 那行,不印)' : ln.trim().slice(0, 100)}`); PATTERN.lastIndex = 0; });
  ok(`G1 ${f} OBS 殘留為 0`, hits.length === 0, hits.length ? `${hits.length} 處,前 5:\n   ${hits.slice(0, 5).join('\n   ')}` : '');
}

// G3 的 nightReplay 一半是靜態的:該旗標只在放空深夜分支才被賦值,冷開機用 in 判恆假
const nightReplayKept = /state\.nightReplay = true/.test(await readFile(join(ROOT, 'index.html'), 'utf8'));

// ── G2／G3 動態 ──
const server = createServer(async (rq, rs) => {
  try {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    const f = join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT)) { rs.statusCode = 403; return rs.end(); }
    const b = await readFile(f);
    rs.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream');
    rs.end(b);
  } catch { rs.statusCode = 404; rs.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // /api 走真正式站(與 verify_basemap_align 同一套):用 {} 假 stub 會讓 boot 拋錯,整支判準靜默失效
  await ctx.route('**/api/**', async r => {
    const u = new URL(r.request().url());
    try {
      const res = await fetch('https://railisland.tw' + u.pathname + u.search, { headers: { accept: 'application/json' } });
      await r.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
    } catch { await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); }
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?live=1&lang=zh-TW`, { waitUntil: 'domcontentloaded' });
  let ready = true;
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 }).catch(() => { ready = false; });
  ok('G2a boot 到 state.ready', ready, ready ? '' : '60 秒內沒 ready——先看 pageerror');
  // boot 沒到 window.__state 時 G2b–G3 仍要印成紅,不能讓 evaluate 拋錯把整支腳本炸掉
  const r = await page.evaluate(() => { const s = window.__state || {}; return {
    liveClass: document.body.classList.contains('live'),
    directorClass: document.body.classList.contains('director'),
    liveMode: typeof s.liveMode,
    director: typeof s.director,
    liveHud: !!document.getElementById('liveHud'),
    replayBadge: !!document.getElementById('replayBadge'),
    msStatReplay: !!document.getElementById('msStatReplay'),
    liveBadge: !!document.getElementById('liveBadge'),
    ulb: typeof window.updateLiveBadge,
  }; });
  ok('G2b ?live=1 不再掛 body.live／body.director', !r.liveClass && !r.directorClass, JSON.stringify(r));
  ok('G2c state 沒有 liveMode／director 欄位', r.liveMode === 'undefined' && r.director === 'undefined', JSON.stringify({ liveMode: r.liveMode, director: r.director }));
  ok('G2d #liveHud／#replayBadge／#msStatReplay 不存在', !r.liveHud && !r.replayBadge && !r.msStatReplay);
  ok('G2e 零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));
  ok('G3 正向對照:#liveBadge 在、updateLiveBadge 是函式、原始碼仍有 state.nightReplay = true', r.liveBadge && r.ulb === 'function' && nightReplayKept, JSON.stringify({ liveBadge: r.liveBadge, ulb: r.ulb, nightReplayKept }));
} finally {
  await browser.close();
  server.close();
}
const pass = results.filter(x => x.pass).length;
console.log(`\n=== ${pass}/${results.length} 通過 ===`);
process.exit(pass === results.length ? 0 : 1);

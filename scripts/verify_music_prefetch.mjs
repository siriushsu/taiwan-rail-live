#!/usr/bin/env node
// 預抓下一首的驗收（web 路徑）。
//
// 🔴 判準是【下一首的網路請求，在還沒換到它之前就發出了】——不是「換歌卡不卡」。
//    換歌順不順在本機/快網下恆綠，對「有沒有預抓」完全沒有鑑別力；真正要保護的情境是隧道，
//    而那個情境的可觀測代理就是「請求的發生時機早於需要它的時機」。
// 🔴 原生 AVPlayer 那半【本檔驗不到】（Playwright 摸不到 AVPlayer，模擬器的網路也不代表隧道）。
//    見 Task 9 的真機清單；原生半段在真機驗過之前一律記為未驗，不得因本檔全綠就當作通過。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MUSIC_PREFETCH_PORT || 46475);
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

// ── G0 自檢:證明驗的是當前工作區那一份(記憶 心得 32/38)──
console.log(`[G0] ROOT=${ROOT}`);
{
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  console.log(`[G0] index.html ${src.length} bytes、${src.split('\n').length} 行`);
}

const hits = [];   // 每一筆 .mp3 請求
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}/`);
  const p = decodeURIComponent(u.pathname);
  if (p.endsWith('.mp3')) hits.push({ t: Date.now(), p });
  if (p.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    // 高鐵班表回空物件會讓 boot 中止(見 verify_music_scoring.mjs 的同一條註解)。
    if (p === '/api/thsr-schedule') return res.end(fs.readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const fails = [], ok = [];
const check = (n, c, d = '') => { (c ? ok : fails).push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const base = (s) => decodeURIComponent(String(s)).split('/').pop();
const hitCount = (name) => hits.filter(h => base(h.p) === name).length;
const settle = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const bctx = await browser.newContext({ locale: 'zh-TW' });
const page = await bctx.newPage();
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(String(e).slice(0, 200)); console.error('   [pageerror]', String(e).slice(0, 200)); });
await bctx.addInitScript(() => {
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.musicPrefetchNext === 'function'
  && window.MUSIC_DATA && window.MUSIC_DATA.free && window.MUSIC_DATA.free.tracks.length > 0,
  null, { timeout: 30000 }).catch(() => {});

const hasFn = await page.evaluate(() => typeof window.musicPrefetchNext === 'function');
check('A0 musicPrefetchNext 存在且對外可見', hasFn);

if (hasFn) {
  // ── 情境:切到免費清單、載入第 idx 首。預抓應該在【這一刻】就把 idx+1 拉下來。
  const setup = await page.evaluate(() => {
    musicApplyMode({ kind: 'free' }, { noLoad: true });
    const m = state.music;
    m.enabled = false;                       // 不真的播,只驗載入/預抓這條路
    m.idx = 0;
    return { cur: m.list[0], next: m.list[1 % m.list.length], third: m.list[2 % m.list.length], n: m.list.length };
  });
  check('A1 前置:免費清單有至少 3 首且彼此不同', setup.n >= 3
    && new Set([setup.cur, setup.next, setup.third]).size === 3, JSON.stringify(setup));

  hits.length = 0;
  const idxBefore = await page.evaluate(() => { musicLoadCur(); return state.music.idx; });
  await settle(1200);
  const curN = hitCount(base(setup.cur)), nextN = hitCount(base(setup.next));
  check('A2 載入當首時,下一首的請求已經發出(這就是「預抓」)', nextN > 0,
    JSON.stringify({ cur: curN, next: nextN, hits: hits.map(h => base(h.p)) }));
  check('A3 發出時還沒換到它(idx 沒有前進)＝真的提前,不是換曲的副作用',
    idxBefore === 0 && (await page.evaluate(() => state.music.idx)) === 0, `idx=${idxBefore}`);

  // ── 冪等:同一首重複呼叫不可以反覆重抓(清單只有一首時尤其會變成無窮重抓)
  const nextBefore = hitCount(base(setup.next));
  await page.evaluate(() => { musicPrefetchNext(); musicPrefetchNext(); musicPrefetchNext(); });
  await settle(800);
  check('A4 同一首重複呼叫不重抓', hitCount(base(setup.next)) === nextBefore,
    `${nextBefore} → ${hitCount(base(setup.next))}`);

  // ── 前進一首後,預抓目標要跟著移到再下一首
  hits.length = 0;
  await page.evaluate(() => { state.music.idx = 1; musicLoadCur(); });
  await settle(1200);
  check('A5 前進一首後,預抓目標跟著移到再下一首', hitCount(base(setup.third)) > 0,
    JSON.stringify({ third: base(setup.third), hits: hits.map(h => base(h.p)) }));

  // ── 反向對照:原生佇列路徑不可以在 web 端重複預抓一次(原生自己有 preloadNext)
  hits.length = 0;
  const nativeProbe = await page.evaluate(async () => {
    const m = state.music;
    m.idx = 0;
    m.audio.setTrack = function () {};      // 偽裝成原生路由
    musicPrefetchNext();
    await new Promise(r => setTimeout(r, 300));
    delete m.audio.setTrack;
    return true;
  });
  await settle(600);
  check('A6 反向對照:原生佇列路徑不在 web 端重複預抓', nativeProbe && hits.length === 0,
    JSON.stringify(hits.map(h => base(h.p))));
}

check('A7 頁面零 JS 例外(預抓用了 let,呼叫早於宣告會是 TDZ ReferenceError)',
  pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
await new Promise(r => server.close(r));
for (const l of [...ok, ...fails]) console.log(l);
console.log(`\n總計 ${ok.length + fails.length} 項，PASS ${ok.length}，FAIL ${fails.length}`);
console.log('⚠️ 原生 AVPlayer 預抓（RailAudioPlugin.preloadNext）本檔驗不到，真機驗過前記為未驗。');
process.exit(fails.length ? 1 : 0);

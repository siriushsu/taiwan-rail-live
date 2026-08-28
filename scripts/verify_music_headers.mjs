#!/usr/bin/env node
// 音檔快取標頭 ＋ 斷線退路驗收。
// A 段驗本機 _headers 的規則字面;帶 MUSIC_HEADERS_BASE 時 B 段對真站台實測;
// C 段載真的 index.html,對它自己的 error handler 派事件,驗「連續失敗退回內建曲目」。
// 🔴 `_headers` 的路徑含空白,Cloudflare 的比對規則要實測——不能假設沒編碼的 `/suno musics/*` 會生效,
//    所以 B 段(線上實測)在升正式站前是必跑的,不能只靠 A 段的字面檢查放行。
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.MUSIC_HEADERS_BASE || '';
const fails = [], ok = [];
const check = (n, c, d = '') => (c ? ok : fails).push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);

// G0 自檢:印出驗的是哪一份,免得對著別棵樹的 _headers 全綠(心得 32)。
const HP = path.join(ROOT, '_headers');
console.log(`驗證目標：${HP}`);

const H = readFileSync(HP, 'utf8');
// _headers 以「行首為 /」起新區塊;把註解行剔掉再切,否則註解裡的 /api/* 會被當成區塊起點。
const blocks = H.split('\n').filter(l => !/^\s*#/.test(l)).join('\n').split(/^(?=\/)/m);
const block = blocks.find(b => /^\/suno/.test(b)) || '';
check('A1 _headers 有音檔區塊', !!block, block ? block.split('\n')[0] : '找不到 /suno… 起頭的區塊');
check('A2 宣告 immutable 長快取',
  /cache-control:\s*public,\s*max-age=31536000,\s*immutable/i.test(block), block.trim() || '(無區塊)');
// A3:區塊要蓋到整個目錄。只寫 /suno musics 而沒有 /* 的話,子目錄的檔案不會命中。
check('A3 樣式蓋到子目錄(結尾 /*)', /^\/suno[^\n]*\/\*\s*$/m.test(block), block.split('\n')[0] || '');

if (BASE) {
  // 探測路徑從 data/music.json 取真檔,不寫死——寫死的檔名一旦被換掉,B 段會變成驗「404 沒有長快取」。
  const music = JSON.parse(readFileSync(path.join(ROOT, 'data/music.json'), 'utf8'));
  const paid = music.pools.flatMap(p => p.tracks)[0];
  const probes = [
    ['免費曲', music.free.tracks[0] && music.free.tracks[0].src],
    ['付費曲', paid && paid.src],
  ].filter(([, s]) => s);
  check('B0 取到探測用的真檔案路徑', probes.length === 2, probes.map(p => p[1]).join(' / '));
  for (const [label, src] of probes) {
    const url = `${BASE.replace(/\/$/, '')}/${encodeURI('suno musics/' + src)}?bust=${Date.now()}`;
    let r = null, err = '';
    try { r = await fetch(url, { method: 'HEAD' }); } catch (e) { err = String(e && e.message || e); }
    const cc = r ? (r.headers.get('cache-control') || '') : '';
    check(`B1 ${label} 線上回 200`, !!r && r.status === 200, r ? String(r.status) : err);
    check(`B2 ${label} 線上標頭真的是長快取`,
      /max-age=31536000/.test(cc) && /immutable/.test(cc), cc || '(無 cache-control)');
  }
} else {
  console.log('（未設 MUSIC_HEADERS_BASE，只驗 _headers 字面；升正式站前必須帶預覽站網址再跑一次）');
}

// ── C 段:斷線退路的行為驗收 ──────────────────────────────────────────────
// 直接對 index.html 自己的 <audio> 派 'error' 事件,跑的是出貨的那段 handler,不是重寫的模型
// (記憶 心得 29:判準不得與實作共用推導假設;這裡連「實作」都是同一份)。
// 派事件是同步的,所以整段在一次 evaluate 內讀完狀態,不會被真實媒體的非同步錯誤插隊。
const PORT = Number(process.env.MUSIC_HEADERS_PORT || 46473);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      // 高鐵班表回空物件會讓 boot 中止(見 verify_music_scoring.mjs 的同一條註解)。
      if (p === '/api/thsr-schedule') return res.end(await readFile(path.join(ROOT, 'data/thsr_schedule_dense.json')));
      return res.end('{}');
    }
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const bctx = await browser.newContext({ locale: 'zh-TW' });
const page = await bctx.newPage();
page.on('pageerror', e => console.error('   [pageerror]', String(e).slice(0, 160)));
await bctx.addInitScript(() => {
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
  window.RAIL_APP_VERSION = '1.5.0';   // 讓 musicIsApp() 為真:退路是 App 限定(網站沒有打包的檔)
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MUSIC_DATA && window.MUSIC_DATA.free
  && window.MUSIC_DATA.free.bundled && window.MUSIC_DATA.free.bundled.length > 0, null, { timeout: 30000 });

const C = await page.evaluate(() => {
  const same = (a, b) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
  const bundled = window.MUSIC_DATA.free.bundled;
  const fake = ['__gone-1.mp3', '__gone-2.mp3', '__gone-3.mp3', '__gone-4.mp3', '__gone-5.mp3'];
  const m = state.music;
  const boom = () => m.audio.dispatchEvent(new Event('error'));
  const reset = () => { m.enabled = true; m._fails = 0; m._fellBack = false; m.idx = 0; m.list = fake.slice(); };

  const out = { isApp: musicIsApp(), bundledN: bundled.length, startsDifferent: !same(fake, bundled) };

  reset(); boom(); boom();
  out.afterTwo = { isBundled: same(m.list, bundled), fellBack: !!m._fellBack, fails: m._fails };
  boom();
  out.afterThree = { isBundled: same(m.list, bundled), fellBack: !!m._fellBack };

  // 一次性:已經退過之後再敲三次,不可以再退一次(否則內建檔也載不到時會無限重試)。
  // 🔴 判準不能比清單【內容】:再退一次只是把同一批內建曲目重洗,排序後逐項相同,比內容永遠看不出來
  //    (突變測試證實:拿掉守衛後那條判準照樣綠)。改比兩件事——
  //    (a) m.list 是不是同一個陣列【物件】(退回會 reassign,musicNext 的重洗是原地);
  //    (b) _fails 的落點:走守衛時一路加到 3,真的再退一次則會被歸零。
  const listRef = m.list;
  m._fails = 0; boom(); boom(); boom();
  out.secondFallback = { sameArrayObject: m.list === listRef, fails: m._fails, fellBack: !!m._fellBack };

  // 'playing' 之後 _fellBack 要歸零,網路回來後仍能再退一次
  m.audio.dispatchEvent(new Event('playing'));
  out.afterPlaying = { fellBack: !!m._fellBack, fails: m._fails };

  // 反向對照:不是 App 就不退(網站沒有打包在二進位裡的檔,退了只是換一批 404)
  const saved = window.RAIL_APP_VERSION;
  window.RAIL_APP_VERSION = '';
  reset(); boom(); boom(); boom();
  out.notApp = { isApp: musicIsApp(), isBundled: same(m.list, bundled) };
  window.RAIL_APP_VERSION = saved;
  m.enabled = false;
  return out;
});

check('C0 前置:musicIsApp() 為真、內建曲目非空、起始清單與內建不同',
  C.isApp && C.bundledN > 0 && C.startsDifferent, JSON.stringify(C));
check('C1 連續 2 次失敗【不】退(只跳下一首)', !C.afterTwo.isBundled && !C.afterTwo.fellBack, JSON.stringify(C.afterTwo));
check('C2 第 3 次失敗退回內建曲目', C.afterThree.isBundled, JSON.stringify(C.afterThree));
check('C3 退回後標記 _fellBack', C.afterThree.fellBack, JSON.stringify(C.afterThree));
check('C4 一次性:已退過就不再退(防無限重試)',
  C.secondFallback.sameArrayObject && C.secondFallback.fails === 3, JSON.stringify(C.secondFallback));
check('C5 有曲子放起來後 _fellBack 歸零(網路回來仍可再退)',
  !C.afterPlaying.fellBack && C.afterPlaying.fails === 0, JSON.stringify(C.afterPlaying));
check('C6 反向對照:非 App 連 3 次失敗也不退',
  !C.notApp.isApp && !C.notApp.isBundled, JSON.stringify(C.notApp));

await browser.close();
await new Promise(r => server.close(r));

for (const l of [...ok, ...fails]) console.log(l);
console.log(`\n總計 ${ok.length + fails.length} 項，PASS ${ok.length}，FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);

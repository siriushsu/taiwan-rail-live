#!/usr/bin/env node
// 車聲圖層(App 限定的鐵軌環境音)驗收。雙引擎 x 手機/桌面兩寬度。
//
// 驗的是【行為】不是【存在】:開關真的點一次、偏好真的寫進 localStorage、位移真的推得出「車在動」、
// 原生層真的收到 { on, src, gain }。原生層用 Proxy 替身(任何方法都回 resolved promise),
// 只有 setAmbience 會把參數記進 window.__amb——所以判準看的是「原生被叫了什麼」,不是 JS 內部旗標。
// 網站版(沒有 RAIL_APP_VERSION / RAIL_AMBIENCE_AVAILABLE)那一列必須整個不現形、整條路徑不碰原生。
//
// 突變自檢(各考一層):
//   · 把 updateFollowCamera 裡的 ambNotePos 拿掉 → S1 紅
//   · AMB_STOP_MPS 改成 -1 → B4 停站那條紅(永遠不會淡出)
//   · ambBindToggle 不加 .avail → B1 紅
//   · ambTick 開頭的 ambAvailable() 守門拿掉 → C2 紅(網站版會去碰不存在的原生物件)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.AMB_PORT || 46473);
const ENGINES = process.env.AMB_ENGINES ? process.env.AMB_ENGINES.split(',') : ['chromium', 'webkit'];
const WIDTHS = process.env.AMB_WIDTHS ? process.env.AMB_WIDTHS.split(',').map(Number) : [390, 1280];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const AMB_SRC = 'audio/train-ride-loop.mp3';

const src = await readFile(join(ROOT, 'index.html'), 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html ${src.length} bytes、${src.split('\n').length} 行`);

const results = [];
const ok = (id, pass, detail = '') => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : '❌'} ${id}${!pass && detail ? ' — ' + detail : ''}`); };

// ── S. 靜態接線:三條跟隨相機路徑都要餵位置、兩個停跟都要清時間戳 ────────────────────────
{
  // 兩個相機函式在檔案裡的先後不保證,各自從函式頭往後切固定長度(都在 6000 字元內收尾)
  const at = name => { const i = src.indexOf(`function ${name}(`); if (i < 0) throw new Error(`找不到 ${name}`); return src.slice(i, i + 6000); };
  const fc = at('updateFollowCamera'), ff = at('updateFreqFollowCamera');
  ok('S1 台鐵/高鐵跟隨相機餵 ambNotePos', /ambNotePos\(pos\.lat, pos\.lon\)/.test(fc));
  ok('S1b 捷運三條分支都餵 ambNotePos', (ff.match(/ambNotePos\(info\.pos\.lat, info\.pos\.lon\)/g) || []).length === 2 && /ambNotePos\(info\.lat, info\.lon\)/.test(ff),
    `pos=${(ff.match(/ambNotePos\(info\.pos\.lat/g) || []).length} raw=${/ambNotePos\(info\.lat/.test(ff)}`);
  ok('S2 兩個停跟都清時間戳', (src.match(/if \(state\.amb\) state\.amb\.at = 0;/g) || []).length === 2);
  ok('S3 車聲列不是 .mpl-row(不能被情境計數吃到)', /class="mpl-amb" id="mplAmb"/.test(src) && !/class="mpl-row mpl-amb|mpl-amb mpl-row/.test(src));
  ok('S4 音檔路徑與 prepare-web 一致', src.includes(`const AMB_SRC = '${AMB_SRC}'`)
    && (await readFile(join(ROOT, 'app/scripts/prepare-web.mjs'), 'utf8')).includes(`'${AMB_SRC}'`));
}

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (p === '/api/thsr-schedule') return res.end(await readFile(join(ROOT, 'data/thsr_schedule_dense.json')));
      return res.end('{}');
    }
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

async function boot(browser, { app, width, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 768, isMobile: width < 768, locale: 'zh-TW' });
  await ctx.addInitScript(({ app }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
    if (app) {
      window.RAIL_APP_VERSION = '9.9.9';
      window.RAIL_AMBIENCE_AVAILABLE = true;
      window.__amb = [];
      window.RAIL_NATIVE_AUDIO = new Proxy({}, { get: (_, k) => {
        if (k === 'then') return undefined;
        if (k === 'setAmbience') return p => { window.__amb.push({ ...p, t: performance.now() }); return Promise.resolve({ ok: true }); };
        return () => Promise.resolve({ ok: true, remove() {} });
      } });
    }
  }, { app });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push(String(e).slice(0, 160)); console.error(`   [pageerror ${tag}]`, String(e).slice(0, 160)); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?plus=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.musicPlOpen === 'function' && typeof window.ambTick === 'function'
    && typeof state !== 'undefined' && state.amb && window.MUSIC_DATA, null, { timeout: 30000 });
  return { ctx, page, errs };
}

const openMenu = page => page.evaluate(() => { state.music._effKey = ''; window.musicPlOpen(); });
const rowState = page => page.evaluate(() => {
  const row = document.getElementById('mplAmb'), tg = document.getElementById('mplAmbTg');
  if (!row) return null;
  const cs = getComputedStyle(row), b = row.getBoundingClientRect();
  return { avail: row.classList.contains('avail'), display: cs.display, h: b.height,
    checked: tg && tg.getAttribute('aria-checked'), on: !!(tg && tg.classList.contains('on')),
    txt: (row.querySelector('b') || {}).textContent || '' };
});

for (const [eng, launcher] of [['chromium', chromium], ['webkit', webkit]].filter(([e]) => ENGINES.includes(e))) {
  const browser = await launcher.launch();
  for (const w of WIDTHS) {
    const tag = `${eng}/${w}`;

    // ── C. 網站版:列不現形、路徑不碰原生 ───────────────────────────────────────────────
    {
      const { ctx, page, errs } = await boot(browser, { app: false, width: w, tag: tag + '/web' });
      await openMenu(page);
      const r = await rowState(page);
      ok(`${tag} C1 網站版車聲列存在但不現形`, !!r && !r.avail && r.display === 'none' && r.h === 0, JSON.stringify(r));
      const before = errs.length;
      const c2 = await page.evaluate(() => {
        try {
          window.ambSetOn(true);
          state.followTrain = { __stub: 1 };
          const a = state.amb, t0 = performance.now();
          a.lat = 25.0478; a.lon = 121.5170; a.at = t0 - 1000; window.ambTick();
          a.lat = 25.0481; a.lon = 121.5170; a.at = t0; window.ambTick(true);
          state.followTrain = null;
          return { threw: false, native: typeof window.RAIL_NATIVE_AUDIO, playing: a.playing, on: a.on };
        } catch (e) { state.followTrain = null; return { threw: String(e).slice(0, 120) }; }
      });
      ok(`${tag} C2 網站版即使被叫到也不碰原生、不拋錯`, c2.threw === false && c2.native === 'undefined' && c2.playing === false && errs.length === before, JSON.stringify(c2));
      await ctx.close();
    }

    // ── B. App 版:開關、偏好、位移→原生 ───────────────────────────────────────────────
    const { ctx, page, errs } = await boot(browser, { app: true, width: w, tag });
    await openMenu(page);
    let r = await rowState(page);
    ok(`${tag} B1 App 版車聲列現形、預設關`, !!r && r.avail && r.display === 'flex' && r.h > 20 && r.checked === 'false' && r.txt.length > 0, JSON.stringify(r));

    // 真的點開關(不是 evaluate 改 class):手機寬度是觸控 click
    await page.click('#mplAmbTg');
    r = await rowState(page);
    const pref = await page.evaluate(() => localStorage.getItem('trainmap-ambience'));
    ok(`${tag} B2 點一下開關 → 開、偏好落地`, r.checked === 'true' && r.on && pref === '{"on":true}', JSON.stringify({ r, pref }));

    // 重開頁面:偏好要還原(App 每次冷啟都會走這條)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.musicPlOpen === 'function' && typeof state !== 'undefined' && state.amb, null, { timeout: 30000 });
    await openMenu(page);
    r = await rowState(page);
    const onAfterReload = await page.evaluate(() => state.amb.on);
    ok(`${tag} B3 重開頁面後開關仍開`, r.checked === 'true' && onAfterReload === true, JSON.stringify({ r, onAfterReload }));

    // 位移 → 原生:跟車中兩秒各一個位置(約 33 m/s),要收到 on:true;同位置再一秒,要收到 on:false
    const b4 = await page.evaluate(({ AMB_SRC }) => {
      const a = state.amb, calls = window.__amb; const n0 = calls.length;
      state.followTrain = { __stub: 1 }; state.ambient = false;
      const t0 = performance.now();
      a.plat = null; a.pat = 0; a.lat = 25.0478; a.lon = 121.5170; a.at = t0 - 1000; window.ambTick();
      a.lat = 25.0481; a.lon = 121.5170; a.at = t0; window.ambTick();
      const moving = calls[calls.length - 1];
      a.at = t0 + 1000; window.ambTick();           // 同一個位置再過一秒=停站
      const stopped = calls[calls.length - 1];
      state.followTrain = null;
      return { added: calls.length - n0, moving, stopped, vol: state.music.vol, src: AMB_SRC };
    }, { AMB_SRC });
    ok(`${tag} B4 車在動 → 原生 on:true 帶正確 src`, b4.added >= 2 && b4.moving && b4.moving.on === true && b4.moving.src === AMB_SRC, JSON.stringify(b4));
    ok(`${tag} B4b 停站 → 原生 on:false`, b4.stopped && b4.stopped.on === false && b4.stopped !== b4.moving, JSON.stringify(b4));
    ok(`${tag} B4c gain = 音量 x 0.8`, b4.moving && Math.abs(b4.moving.gain - Math.min(1, b4.vol * 0.8)) < 0.02, JSON.stringify({ gain: b4.moving && b4.moving.gain, vol: b4.vol }));

    // 放空模式:沒有單一目標,一直放;關掉放空就停
    const b5 = await page.evaluate(() => {
      const calls = window.__amb;
      state.followTrain = null; state.freqFollow = null; state.amb.at = 0;
      state.ambient = true; window.ambTick(); const on = calls[calls.length - 1];
      state.ambient = false; window.ambTick(); const off = calls[calls.length - 1];
      return { on, off };
    });
    ok(`${tag} B5 放空模式 → on、退出放空 → off`, b5.on && b5.on.on === true && b5.off && b5.off.on === false && b5.off !== b5.on, JSON.stringify(b5));

    // 停跟:時間戳清零後下一拍要 off(clearFollow / clearFreqFollow 都只做這一件事)
    const b6 = await page.evaluate(() => {
      const a = state.amb, calls = window.__amb;
      state.followTrain = { __stub: 1 };
      const t0 = performance.now();
      a.plat = null; a.pat = 0; a.lat = 25.0478; a.lon = 121.5170; a.at = t0 - 1000; window.ambTick();
      a.lat = 25.0481; a.lon = 121.5170; a.at = t0; window.ambTick();
      const moving = calls[calls.length - 1];
      state.followTrain = null; a.at = 0; window.ambTick();
      const cleared = calls[calls.length - 1];
      return { moving, cleared };
    });
    ok(`${tag} B6 停跟 → off`, b6.moving.on === true && b6.cleared.on === false, JSON.stringify(b6));

    // 關掉開關:車再怎麼動都不准叫原生 on
    await page.click('#mplAmbTg');
    const b7 = await page.evaluate(() => {
      const a = state.amb, calls = window.__amb; const n0 = calls.length;
      state.followTrain = { __stub: 1 };
      const t0 = performance.now();
      a.plat = null; a.pat = 0; a.lat = 25.0478; a.lon = 121.5170; a.at = t0 - 1000; window.ambTick();
      a.lat = 25.0481; a.lon = 121.5170; a.at = t0; window.ambTick();
      state.followTrain = null;
      const news = calls.slice(n0);
      return { on: a.on, pref: localStorage.getItem('trainmap-ambience'), onCalls: news.filter(c => c.on).length, checked: document.getElementById('mplAmbTg').getAttribute('aria-checked') };
    });
    ok(`${tag} B7 關掉後車在動也不叫原生 on`, b7.on === false && b7.pref === '{"on":false}' && b7.onCalls === 0 && b7.checked === 'false', JSON.stringify(b7));

    ok(`${tag} B8 整輪零 pageerror`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
}
server.close();

const fail = results.filter(r => !r.pass).length;
console.log(`\n──────── ${results.length - fail}/${results.length} PASS ────────`);
process.exit(fail ? 1 : 0);

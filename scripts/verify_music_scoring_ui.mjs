#!/usr/bin/env node
// 配樂情境選單的版面與行為驗收。雙引擎 x 五寬度。
//
// 🔴 驗按鈕不是驗它在哪,是驗【點它會發生什麼】:elementFromPoint 只答得出「命中誰」,
//    對祖先容器恆真;所以每一條都要真的 click 一次並量它造成的狀態改變(記憶 心得 33/37)。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.MUSIC_UI_PORT || 46472);
const WIDTHS = [360, 375, 414, 768, 1280];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

const src = await readFile(join(ROOT, 'index.html'), 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html ${src.length} bytes、${src.split('\n').length} 行`);
if (!existsSync(join(ROOT, 'data', 'music.json'))) { console.error('❌ [G0] 缺 data/music.json'); process.exit(1); }

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

const results = [];
const ok = (id, pass, detail = '') => { results.push({ id, pass }); if (!pass) console.log(`❌ ${id}${detail ? ' — ' + detail : ''}`); };

for (const [eng, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  for (const w of WIDTHS) {
    const tag = `${eng}/${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: w < 768, isMobile: w < 768,
      locale: 'zh-TW' });   // 🔴 不釘的話 chromium 預設 en-US、webkit 另一種,同一條判準會看到不同語言
    await ctx.addInitScript(() => {
      try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
      try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error(`   [pageerror ${tag}]`, String(e).slice(0, 140)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html?plus=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.musicPlOpen === 'function'
      && window.MUSIC_DATA && window.MUSIC_DATA.pools.length === 16, null, { timeout: 30000 });
    await page.evaluate(() => { state.plus = { active: false }; state.music._effKey = ''; window.musicPlOpen(); });

    // A. 清單完整:16 池 + 3 家族 + 跟著列車 + 隨機 = 21 列
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#musicPlBody .mpl-row')].map(r => ({
        mode: r.dataset.mode, locked: r.classList.contains('locked'), txt: r.textContent.trim(),
        lockText: (r.querySelector('.mpl-lock') || {}).textContent || '' })));
    ok(`${tag} A1 列數 = 21`, rows.length === 21, `實際 ${rows.length}`);
    ok(`${tag} A2 16 個池全在`, rows.filter(r => r.mode.startsWith('pool:')).length === 16);
    ok(`${tag} A3 三個家族全在`, rows.filter(r => r.mode.startsWith('family:')).length === 3);
    ok(`${tag} A4 免費那列不上鎖`, rows.some(r => r.mode === 'free' && !r.locked));
    ok(`${tag} A5 未訂閱時付費列全上鎖`, rows.filter(r => r.mode !== 'free').every(r => r.locked),
      rows.filter(r => r.mode !== 'free' && !r.locked).map(r => r.mode).join(','));
    // 🔴 結構性斷言:不驗特定語言的字串。介面會依 locale 翻譯("通行證"/"Pass"),
    //    寫死中文會讓這條在英文環境假紅——實際契約是「每個上鎖列都有一塊非空的文字標記,且不用 emoji」。
    ok(`${tag} A6 每個上鎖列都有非空的文字鎖標記`,
      rows.filter(r => r.locked).every(r => r.lockText.trim().length > 0),
      rows.filter(r => r.locked && !r.lockText.trim()).map(r => r.mode).slice(0, 3).join(','));
    ok(`${tag} A6b 鎖標記不用 emoji`,
      !rows.some(r => /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{1F512}\u{1F513}]/u.test(r.txt)),
      rows.filter(r => /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u.test(r.txt)).map(r => r.mode).join(','));
    const slots = await page.evaluate(() => {
      const g = (m) => { const r = document.querySelector(`#musicPlBody .mpl-row[data-mode="${m}"]`);
        return r ? (r.querySelector('.mpl-slot') || {}).textContent || '' : null; };
      return { shipped: g('pool:metro-motion'), unshipped: g('pool:yilan-line'), free: g('free') };
    });
    ok(`${tag} A7 已上架的池狀態槽含曲數 7`, /\b7\b/.test(slots.shipped || ''), JSON.stringify(slots));
    ok(`${tag} A8 未上架的池狀態槽不含數字(標為尚未上架)`,
      !!slots.unshipped && !/\d/.test(slots.unshipped), JSON.stringify(slots));
    ok(`${tag} A9 免費那列狀態槽含 57`, /\b57\b/.test(slots.free || ''), JSON.stringify(slots));

    // B. 點得到、而且點了真的開 gate(不是只驗 id 存在——「還在但已停用」會整類穿過)
    const hit = await page.evaluate(() => {
      const row = document.querySelector('#musicPlBody .mpl-row[data-mode="pool:metro-motion"]');
      row.scrollIntoView({ block: 'center' });
      const b = row.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { inside: !!(el && row.contains(el)), disabled: row.disabled === true,
        pe: getComputedStyle(row).pointerEvents, h: b.height };
    });
    ok(`${tag} B1 列的中心命中它自己`, hit.inside, JSON.stringify(hit));
    ok(`${tag} B2 列沒有被停用`, !hit.disabled && hit.pe !== 'none', JSON.stringify(hit));
    ok(`${tag} B3 列高 >= 44(觸控目標)`, hit.h >= 44, `實際 ${hit.h}`);

    // 🔴 plusGateOpen 是頂層函式宣告,程式碼以裸識別字呼叫 ⇒ 覆寫 window.plusGateOpen 裝不到間諜。
    //    改驗它的【真實副作用】:Plus 面板被打開。這也才是使用者真的會看到的東西。
    await page.click('#musicPlBody .mpl-row[data-mode="pool:metro-motion"]');
    await page.waitForTimeout(300);
    const gate = await page.evaluate(() => ({
      plusOpen: !document.getElementById('plusModal').hidden, mode: state.music.mode }));
    ok(`${tag} B4 未訂閱點付費列會開通行證面板`, gate.plusOpen, JSON.stringify(gate));
    ok(`${tag} B5 未訂閱點了不得偷偷切模式`, gate.mode.kind !== 'pool', JSON.stringify(gate));
    await page.evaluate(() => { const m = document.getElementById('plusModal'); if (m) m.hidden = true; });

    // C. 訂閱後點得動、狀態真的變
    await page.evaluate(() => { state.plus = { active: true }; window.musicPlRender(); });
    await page.click('#musicPlBody .mpl-row[data-mode="family:city-circuit"]');
    const c1 = await page.evaluate(() => ({ mode: state.music.mode, n: state.music.list.length }));
    ok(`${tag} C1 訂閱後點家族真的生效`, c1.mode.kind === 'family' && c1.mode.id === 'city-circuit' && c1.n === 22, JSON.stringify(c1));
    await page.click('#musicPlBody .mpl-row[data-mode="auto"]');
    const c2 = await page.evaluate(() => state.music.mode.kind);
    ok(`${tag} C2 點「跟著列車」切回自動`, c2 === 'auto', c2);
    await page.click('#musicPlBody .mpl-row[data-mode="free"]');
    const c3 = await page.evaluate(() => ({ k: state.music.mode.kind, n: state.music.list.length }));
    ok(`${tag} C3 點「隨機」回到免費 57 首`, c3.k === 'free' && c3.n === 57, JSON.stringify(c3));

    // D. 版面:對話框不得溢出視窗,頁面不得被撐出橫捲
    const box = await page.evaluate(() => {
      const d = document.querySelector('#musicPlModal .takeout-dialog').getBoundingClientRect();
      return { l: d.left, r: d.right, t: d.top, b: d.bottom, vw: innerWidth, vh: innerHeight,
        sw: document.documentElement.scrollWidth };
    });
    ok(`${tag} D1 對話框在視窗內(左右)`, box.l >= -1 && box.r <= box.vw + 1, JSON.stringify(box));
    ok(`${tag} D2 頁面沒被撐出橫捲`, box.sw <= box.vw + 1, JSON.stringify(box));
    ok(`${tag} D3 對話框頂端在視窗內`, box.t >= -1, JSON.stringify(box));

    await ctx.close();
  }
  await browser.close();
}
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,PASS ${results.length - bad.length},FAIL ${bad.length}`);
process.exit(bad.length ? 1 : 0);

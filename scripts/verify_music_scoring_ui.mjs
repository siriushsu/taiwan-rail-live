#!/usr/bin/env node
// 配樂情境選單的版面與行為驗收。雙引擎 x 五寬度。
//
// 🔴 驗按鈕不是驗它在哪,是驗【點它會發生什麼】:elementFromPoint 只答得出「命中誰」,
//    對祖先容器恆真;所以每一條都要真的 click 一次並量它造成的狀態改變(記憶 心得 33/37)。
// 🔴 2026-09-02 設計輪之後契約變了:付費界線由頂端一條說明帶講【一次】,不再逐列掛「通行證」。
//    舊版 A5/A6「每個上鎖列都要有文字鎖標記」是那個設計的判準,已隨設計作廢;
//    它保護的意圖(不做沉默的閘門)改由 F 組承接——說明帶要在、要有入口、點了要真的開面板。
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

    // ── A. 清單完整:16 個池一個都不能少,未上架的降級但仍看得見(使用者裁示) ──────────
    const all = await page.evaluate(() => {
      const q = s => [...document.querySelectorAll('#musicPlBody ' + s)];
      // 🔴 每次展開都會重畫清單 ⇒ 先抓一份 NodeList 再逐一點,第二顆之後點的是已經脫離
      //    文件的舊節點,什麼都不會發生(而且看起來就只是「少了幾個池」)。要每次重查。
      window.MUSIC_DATA.families.forEach(f => {
        const b = document.querySelector(`#musicPlBody [data-fam="${f.id}"]`);
        if (b && b.getAttribute('aria-expanded') === 'false') b.click();
      });
      const pools = window.MUSIC_DATA.pools;
      const shown = q('.mpl-row .mpl-txt b').map(b => b.textContent);
      return {
        fam: q('[data-mode^="family:"]').length,
        hero: q('.mpl-hero[data-mode="auto"]').length,
        free: q('[data-mode="free"]').length,
        clickablePools: q('[data-mode^="pool:"]').length,
        soon: q('.mpl-row.soon').length,
        missing: pools.filter(p => !shown.includes(p.zh)).map(p => p.id),
        shippedCount: pools.filter(p => p.tracks.length).length,
      };
    });
    ok(`${tag} A1 三個家族都在`, all.fam === 3, JSON.stringify(all));
    ok(`${tag} A2 主打卡「跟著列車」在`, all.hero === 1, JSON.stringify(all));
    ok(`${tag} A3 「隨機」在`, all.free === 1, JSON.stringify(all));
    ok(`${tag} A4 16 個池的名字全部看得到(展開後)`, all.missing.length === 0, `缺 ${all.missing.join(',')}`);
    ok(`${tag} A5 已上架的池可點、未上架的降級`,
      all.clickablePools === all.shippedCount && all.soon === 16 - all.shippedCount, JSON.stringify(all));

    // 準備中那批:要【看得見】(不是 display:none)但【點不到】——兩件事都要驗,少一件就變成隱藏或誤點
    const soon = await page.evaluate(() => {
      const el = document.querySelector('#musicPlBody .mpl-row.soon');
      if (!el) return null;
      const cs = getComputedStyle(el), b = el.getBoundingClientRect();
      return { display: cs.display, pe: cs.pointerEvents, opacity: +cs.opacity, h: b.height,
        hasMode: el.dataset.mode !== undefined };
    });
    ok(`${tag} A6 準備中的池看得見`, !!soon && soon.display !== 'none' && soon.h > 0 && soon.opacity > 0.2, JSON.stringify(soon));
    ok(`${tag} A7 準備中的池點不到`, !!soon && soon.pe === 'none' && !soon.hasMode, JSON.stringify(soon));

    const slots = await page.evaluate(() => {
      const g = (sel) => { const r = document.querySelector('#musicPlBody ' + sel);
        return r ? (r.querySelector('.mpl-slot') || {}).textContent || '' : null; };
      return { shipped: g('[data-mode="pool:metro-motion"]'), free: g('[data-mode="free"]'),
        fam: g('[data-mode="family:open-landscape"]'),
        unshipped: [...document.querySelectorAll('#musicPlBody .mpl-row.soon')]
          .map(r => (r.querySelector('.mpl-slot') || {}).textContent || '')[0] };
    });
    ok(`${tag} A8 已上架的池狀態槽含曲數 7`, /\b7\b/.test(slots.shipped || ''), JSON.stringify(slots));
    ok(`${tag} A9 未上架的池狀態槽不含數字(標為尚未上架)`,
      !!slots.unshipped && !/\d/.test(slots.unshipped), JSON.stringify(slots));
    ok(`${tag} A10 免費那列狀態槽含 57`, /\b57\b/.test(slots.free || ''), JSON.stringify(slots));
    ok(`${tag} A11 家族狀態槽報得出 0 可播 6 準備中`,
      /0/.test(slots.fam || '') && /6/.test(slots.fam || ''), JSON.stringify(slots));

    // ── F. 付費界線:整份清單只講一次,而且那一次是有入口的 ─────────────────────────
    const band = await page.evaluate(() => {
      const b = document.querySelector('#musicPlBody .mpl-band');
      const body = document.getElementById('musicPlBody');
      const word = t('通行證');                                   // 依 locale 取字,不寫死中文
      const hits = (body.textContent.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      const cta = document.getElementById('mplPlans');
      return { txt: b ? b.textContent.trim() : null, hits, word,
        ctaShown: !!(cta && !cta.hidden), ctaH: cta ? cta.getBoundingClientRect().height : 0 };
    });
    ok(`${tag} F1 未訂閱時有一條非空的付費說明帶`, !!band.txt && band.txt.length > 4, JSON.stringify(band));
    ok(`${tag} F2 「通行證」整份清單只出現一次`, band.hits === 1, JSON.stringify(band));
    ok(`${tag} F3 說明帶帶著「看方案」入口`, band.ctaShown && band.ctaH >= 32, JSON.stringify(band));
    await page.click('#mplPlans');
    await page.waitForTimeout(250);
    ok(`${tag} F4 點「看方案」會開通行證面板`,
      await page.evaluate(() => !document.getElementById('plusModal').hidden));
    await page.evaluate(() => { const m = document.getElementById('plusModal'); if (m) m.hidden = true; });

    // ── B. 點得到、而且點了真的開 gate(不是只驗 id 存在——「還在但已停用」會整類穿過) ──
    const hit = await page.evaluate(() => {
      const row = document.querySelector('#musicPlBody [data-mode="pool:metro-motion"]');
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
    await page.click('#musicPlBody [data-mode="pool:metro-motion"]');
    await page.waitForTimeout(300);
    const gate = await page.evaluate(() => ({
      plusOpen: !document.getElementById('plusModal').hidden, mode: state.music.mode }));
    ok(`${tag} B4 未訂閱點付費列會開通行證面板`, gate.plusOpen, JSON.stringify(gate));
    ok(`${tag} B5 未訂閱點了不得偷偷切模式`, gate.mode.kind !== 'pool', JSON.stringify(gate));
    await page.evaluate(() => { const m = document.getElementById('plusModal'); if (m) m.hidden = true; });

    // ── C. 訂閱後點得動、狀態真的變 ────────────────────────────────────────────────
    await page.evaluate(() => { state.plus = { active: true }; window.musicPlRender(); });
    await page.click('#musicPlBody [data-mode="family:city-circuit"]');
    const c1 = await page.evaluate(() => ({ mode: state.music.mode, n: state.music.list.length,
      open: document.querySelector('#musicPlBody [data-fam="city-circuit"]').getAttribute('aria-expanded') }));
    ok(`${tag} C1 訂閱後點家族真的生效`, c1.mode.kind === 'family' && c1.mode.id === 'city-circuit' && c1.n === 22, JSON.stringify(c1));
    ok(`${tag} C2 選了家族順手攤開它`, c1.open === 'true', JSON.stringify(c1));

    // 🔴 右側 44px 是展開鈕:它【只能】改展開狀態,不准順手改選擇——
    //    「選家族」是硬條件,兩個動作擠在同一列上,弄混就等於把選家族偷偷拿掉。
    await page.evaluate(() => { window.musicApplyMode({ kind: 'free' }, {}); window.musicPlRender(); });
    // 判準寫成「翻面」而不是「變成 true」:前面 A 組已經把三個家族全展開過,寫死方向會被
    // 執行順序決定真假(判準盲點 3:別把判準綁在會漂移的量上)。
    const st = () => page.evaluate(() => ({ mode: state.music.mode.kind,
      open: document.querySelector('#musicPlBody [data-fam="quiet-hours"]').getAttribute('aria-expanded'),
      pools: document.querySelectorAll('#musicPlBody .mpl-row.soon').length }));
    const b0 = await st();
    await page.click('#musicPlBody [data-fam="quiet-hours"]');
    const c3 = await st();
    ok(`${tag} C3 點展開鈕會翻面,而且該家族的池跟著進出`,
      c3.open !== b0.open && c3.pools !== b0.pools, JSON.stringify({ b0, c3 }));
    ok(`${tag} C4 點展開鈕不得改變選擇`, c3.mode === b0.mode, `${b0.mode} → ${c3.mode}`);
    await page.click('#musicPlBody [data-fam="quiet-hours"]');
    const c5 = await st();
    ok(`${tag} C5 再點一次翻回來`, c5.open === b0.open && c5.pools === b0.pools, JSON.stringify({ b0, c5 }));

    await page.click('#musicPlBody [data-mode="auto"]');
    ok(`${tag} C6 點「跟著列車」切回自動`, await page.evaluate(() => state.music.mode.kind === 'auto'));
    await page.click('#musicPlBody [data-mode="free"]');
    const c7 = await page.evaluate(() => ({ k: state.music.mode.kind, n: state.music.list.length }));
    ok(`${tag} C7 點「隨機」回到免費 57 首`, c7.k === 'free' && c7.n === 57, JSON.stringify(c7));

    // ── E. 現在播放區 ──────────────────────────────────────────────────────────────
    // <audio> 換成只回報「在播」的替身:headless 放不出聲音,不換就只驗得到「音樂關閉中」空狀態。
    const e1 = await page.evaluate(() => {
      state.music.audio = { paused: false, volume: 0, src: '', ended: false,
        play: () => Promise.resolve(), pause() { this.paused = true; }, addEventListener() {} };
      state.music.enabled = true;
      window.musicApplyMode({ kind: 'pool', id: 'metro-motion' }, { noLoad: true });
      window.musicPlRender();
      const m = state.music;
      // 期望值自己從檔名推,不呼叫實作的 musicLabel——同源比對「相等」是零資訊(判準盲點 1)
      const expect = decodeURIComponent(m.list[m.idx]).split('/').pop().replace(/\.[^.]+$/, '');
      const txt = id => (document.getElementById(id) || {}).textContent || '';
      return { track: txt('mplTrack'), expect, pool: txt('mplPool'),
        poolExpect: window.MUSIC_DATA.pools.find(p => p.id === 'metro-motion').zh,
        why: txt('mplWhy'), len: txt('mplLen') };
    });
    ok(`${tag} E1 現在播放顯示的是真的在播那一首`, e1.track === e1.expect, JSON.stringify(e1));
    ok(`${tag} E2 顯示它屬於哪個情境池`, e1.pool === e1.poolExpect, JSON.stringify(e1));
    ok(`${tag} E3 說得出為什麼在播這首`, e1.why.trim().length > 3, JSON.stringify(e1));
    ok(`${tag} E4 曲長是 m:ss`, /^\d+:[0-5]\d$/.test(e1.len), JSON.stringify(e1));

    const e5 = await page.evaluate(() => {
      const r = id => { const el = document.getElementById(id); return el ? el.getBoundingClientRect() : null; };
      return { play: r('mplPlay'), next: r('mplNext'), vol: r('mplVol') };
    });
    ok(`${tag} E5 播放/換首/音量三個控件都在`, !!e5.play && !!e5.next && !!e5.vol, JSON.stringify(e5));
    ok(`${tag} E6 播放與換首是 44px 觸控目標`,
      !!e5.play && !!e5.next && e5.play.height >= 44 && e5.play.width >= 44
      && e5.next.height >= 44 && e5.next.width >= 44, JSON.stringify(e5));

    // 🔴 重畫清單【不准】換掉現在播放區的節點:每幀重建會讓 mousedown 與 mouseup 落在不同節點上,
    //    click 就永遠不派發(跟車面板正是這樣壞掉的)。用節點同一性驗,不是用外觀。
    const e7 = await page.evaluate(() => {
      document.getElementById('mplPlay').dataset.probe = 'x';
      window.musicPlRender(); window.musicPlRender();
      return { kept: document.getElementById('mplPlay').dataset.probe === 'x',
        listRedrew: !!document.getElementById('mplList') };
    });
    ok(`${tag} E7 重畫清單不會換掉播放控件的節點`, e7.kept && e7.listRedrew, JSON.stringify(e7));

    // 曲末待換池的提示:該亮的時候亮、該滅的時候滅(反向判準要有正向對照,判準盲點 5)
    const e8 = await page.evaluate(() => {
      const m = state.music;
      window.musicApplyMode({ kind: 'auto' }, { noLoad: true });
      m._ctxKey = 'metro|day'; m._curCtxKey = 'metro|day'; window.mplNowSync();
      const same = document.getElementById('mplPending').hidden;
      m._curCtxKey = 'south|night'; window.mplNowSync();
      const el = document.getElementById('mplPending');
      return { hiddenWhenSame: same, shownWhenDiff: !el.hidden, txt: el.textContent };
    });
    ok(`${tag} E8 情境沒變時不出現待換池提示`, e8.hiddenWhenSame, JSON.stringify(e8));
    ok(`${tag} E9 情境變了但曲子還沒完會說明`, e8.shownWhenDiff && e8.txt.length > 6, JSON.stringify(e8));

    // ── D. 版面:對話框不得溢出視窗,頁面不得被撐出橫捲 ───────────────────────────
    const box = await page.evaluate(() => {
      window.MUSIC_DATA.families.forEach(f => {          // 最長的一種狀態:全部展開(每次重查,理由同 A 組)
        const b = document.querySelector(`#musicPlBody [data-fam="${f.id}"]`);
        if (b && b.getAttribute('aria-expanded') === 'false') b.click();
      });
      const d = document.querySelector('#musicPlModal .takeout-dialog').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#musicPlBody .mpl-row, #musicPlBody .mpl-fam, #musicPlBody .mpl-hero')];
      const bodyBox = document.getElementById('musicPlBody').getBoundingClientRect();
      const over = rows.filter(r => r.getBoundingClientRect().right > bodyBox.right + 1).length;
      return { l: d.left, r: d.right, t: d.top, b: d.bottom, vw: innerWidth, vh: innerHeight,
        sw: document.documentElement.scrollWidth, over, rows: rows.length };
    });
    ok(`${tag} D1 對話框在視窗內(左右)`, box.l >= -1 && box.r <= box.vw + 1, JSON.stringify(box));
    ok(`${tag} D2 頁面沒被撐出橫捲`, box.sw <= box.vw + 1, JSON.stringify(box));
    ok(`${tag} D3 對話框頂端在視窗內`, box.t >= -1, JSON.stringify(box));
    ok(`${tag} D4 全部展開後沒有任何一列凸出內容區`, box.over === 0, JSON.stringify(box));

    await ctx.close();
  }
  await browser.close();
}
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,PASS ${results.length - bad.length},FAIL ${bad.length}`);
process.exit(bad.length ? 1 : 0);

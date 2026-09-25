#!/usr/bin/env node
// .board 家族面板的 sticky 固定段讓位守門(2026-09-25,v0925n)。
//
// 瀏覽器自己把內容捲進來時(Tab／Shift+Tab 聚焦、scrollIntoView)不認 sticky 標題。index.html 的
// syncBoardScrollPad 量整疊固定段(h3;橫式合併卡另有站名牌與分頁列)的底緣寫進 --board-scroll-pad,
// CSS 拿它給內容當 scroll-margin-top;WebKit 聚焦文字欄位不看 scroll-margin,由 boardRevealField 補捲。
// 只有真瀏覽器量得到,兩個引擎各跑一輪:
//   W 鍵盤往回走(Shift+Tab;WebKit 要 Option+Shift+Tab 才走得到按鈕):焦點中心落在固定段上的拍數＝0。
//     360 直式標準／特大字級、844×390 橫式合併卡;走過的內容拍數要夠多,否則是沒走到的假綠。
//   J 面板捲到下面時把焦點放進標題裡的 ×(＝選單關掉時 opener.focus()、從面板外 Tab 進來):捲動量 ≤ 8px。
//     容器 scroll-padding-top 那種寫法會跳 128–130px(v0925k 的護照就是那樣上線的)。
//   F 文字欄位(軌道面板 #rdSearch)被蓋住時聚焦:下一拍之後不再被蓋,半秒後也沒被捲回去。
//   P 讓位值＝捲到中段時實際卡住的固定段底緣(差 ≤ 1px):站名牌出現／消失之後(syncBoardHeadVar 尾端那一刀)、
//     護照重繪換掉 h3 再換字級之後(MutationObserver 重掛)。
//   N 正向對照,要紅才算數:拿掉讓位 ⇒ W 紅;改回容器 scroll-padding ⇒ J 紅(兩個引擎都做——WebKit 的聚焦捲動
//     是非同步的,要證明等得夠久);拿掉那一刀／拿掉重掛 ⇒ P 紅(只做 Chromium)。
// 慣例照 verify_transfer_collapse.mjs:自帶 node:http 靜態伺服器(埠號由系統挑)、語系與時鐘釘死、關首訪教學卡、
// 掛 pageerror、T0 身分自檢。瀏覽器一律無視窗。約 95 秒(2026-09-25 實測 94s)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(Number(process.env.PORT || 0), '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── T0 目標自檢:先證明「我在驗誰」 ──────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}\n`);

// 頁內工具:固定段、可聚焦元素、焦點是否被蓋、讓位值與實際卡住的底緣
const HELPERS = `window.__bsp = (() => {
  const heads = p => [...p.children].filter(n => n.matches('h3, .dwell-plate, .uni-tabs') && getComputedStyle(n).position === 'sticky' && n.getBoundingClientRect().height > 0);
  const desc = e => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '') : null;
  const tabbables = p => [...p.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable="true"]')]
    .filter(e => !e.disabled && e.tabIndex >= 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0);
  const measure = id => {
    const p = document.getElementById(id), a = document.activeElement;
    if (!p || p.hidden || !a || a === p || !p.contains(a)) return { left: true };
    const hs = heads(p), inHead = hs.some(h => h.contains(a));
    const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !inHead && hs.some(h => hit && h.contains(hit));
    return { inHead, covered, el: desc(a), over: hs.length ? +(Math.max(...hs.map(h => h.getBoundingClientRect().bottom)) - r.top).toFixed(1) : 0 };
  };
  const padOf = p => parseFloat(p.style.getPropertyValue('--board-scroll-pad')) || 0;
  // 捲到中段量實際卡住的固定段底緣(＋最下面那段的下邊界),量完捲回原位
  const stuck = id => {
    const bd = document.getElementById(id);
    const st0 = bd.scrollTop, max = bd.scrollHeight - bd.clientHeight;
    bd.scrollTop = Math.floor(max / 2);
    const hs = heads(bd), base = bd.getBoundingClientRect().top + bd.clientTop;
    let bottom = 0;
    for (const h of hs) bottom = Math.max(bottom, h.getBoundingClientRect().bottom - base + (parseFloat(getComputedStyle(h).marginBottom) || 0));
    bd.scrollTop = st0;
    return { pad: padOf(bd), stuck: +bottom.toFixed(1), max, n: hs.length };
  };
  return { heads, desc, tabbables, measure, padOf, stuck };
})();`;

const OPEN = {
  favPanel: `(() => {
    const stns = [['臺北', 25.0478, 121.517], ['板橋', 25.0143, 121.4637], ['桃園', 24.9892, 121.3136], ['新竹', 24.8016, 120.9716], ['臺中', 24.1372, 120.6869],
      ['彰化', 24.0817, 120.5386], ['嘉義', 23.4791, 120.4411], ['臺南', 22.9971, 120.2126], ['高雄', 22.6394, 120.3025], ['花蓮', 23.9929, 121.6011]];
    userDataSaveCollection('stations', stns.map(([name, lat, lon]) => ({ name, lat, lon, sys: 'tra_sched', label: '台鐵' })));
    saveFavs(state.trains.filter(t => t.sys === 'tra_sched').slice(0, 10).map(t => ({ train: String(t.train), sys: 'tra_sched' })));
    savePins(Array.from({ length: 6 }, (_, i) => ({ lat: 25.0 + i * 0.01, lon: 121.5 + i * 0.01, label: '地點' + (i + 1) })));
    openFavPanel();
  })()`,
  board: `openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`,
  trackPanel: `openTrackPanel()`,
  searchPanel: `openSearchPanel({ user: true })`,
  ridePanel: `openRidePanel()`,
  // 跟車中打開車站看板＝合併卡(橫式時 h3 下還有 sticky 的站名牌與分頁列)
  // 挑已發車、沒在停站、下一站至少 3 分鐘後才到的車:收牌那一格才不會被停靠牌(跟車迴圈自己亮的)混進來
  uni: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => {
      const tt = effTLive(t), info = nextStopInfo(t, tt);
      return tt >= t.stops[0].depSec && !dwellInfoOf(t, tt) && info && info.min >= 3;
    }) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 });
    await new Promise(r => setTimeout(r, 300));
  })()`,
};
const ELEM = { favPanel: 'favPanel', board: 'board', trackPanel: 'trackPanel', searchPanel: 'searchPanel', ridePanel: 'ridePanel', uni: 'board' };
const CLOSE_ALL = `(() => {
  for (const f of ['closeBoard', 'closeFavPanel', 'closeRidePanel', 'closeExplorePanel', 'closeTrackPanel', 'closeTodayPanel', 'closeDelayHist', 'closeFontPanel', 'closeTripSharePanel', 'closeBusStopPanel', 'closeSearchPanel'])
    try { if (typeof window[f] === 'function') window[f](); } catch (e) {}
  try { if (state.followTrain || state.freqFollow) clearFollow(); } catch (e) {}
  try { document.activeElement && document.activeElement.blur(); } catch (e) {}
})()`;
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

async function boot(browser, { width, height, tier = 'std' }) {
  const mobile = width < 1000;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(t => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-language', 'zh-TW');
      localStorage.removeItem('trainmap-sheet-size');
      if (t !== 'std') localStorage.setItem('trainmap-fontscale', t);
    } catch (e) {}
  }, tier);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}?lang=zh-TW&t=09:41`, { waitUntil: 'domcontentloaded' });
  // 等開機收尾:finishLoad 會 closeRidePanel(),太早開護照會量到被關掉的空面板
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.mode === 'sched' && state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.evaluate(HELPERS);
  return { ctx, page, errors };
}
async function open(page, key) {
  await page.evaluate(CLOSE_ALL);
  await page.evaluate(OPEN[key]);
  await settle(page); await page.waitForTimeout(250);
  return page.evaluate(id => { const p = document.getElementById(id); return !!(p && !p.hidden); }, ELEM[key]);
}
// W:從最後一個可聚焦元素一路往回走到焦點離開面板
async function walk(page, eng, id) {
  const n = await page.evaluate(id => { const p = document.getElementById(id); const tb = __bsp.tabbables(p); if (tb.length) tb[tb.length - 1].focus(); return tb.length; }, id);
  let steps = 0, content = 0, covered = 0; const bad = [];
  for (let i = 0; i < 80; i++) {
    await settle(page);
    const m = await page.evaluate(id => __bsp.measure(id), id);
    if (m.left) break;
    steps++;
    if (!m.inHead) content++;
    if (m.covered) { covered++; if (bad.length < 3) bad.push(`${m.el} 壓 ${m.over}px`); }
    await page.keyboard.press(eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  }
  return { n, steps, content, covered, bad };
}
// J:捲到 80% 再把焦點放進標題(或固定段裡)的某個鈕;WebKit 的聚焦捲動是非同步的,等 450ms 再量
const JUMP = async ([id, sel]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p = document.getElementById(id);
  const btns = [...p.querySelectorAll(sel)].filter(e => !e.disabled && e.getClientRects().length);
  const btn = btns[btns.length - 1];
  if (!btn) return { none: true };
  if (document.activeElement) document.activeElement.blur();
  const max = p.scrollHeight - p.clientHeight;
  p.scrollTop = Math.floor(max * 0.8);
  await sleep(150);
  const before = p.scrollTop;
  btn.focus();
  await sleep(450);
  const after = p.scrollTop;
  btn.blur();
  return { btn: __bsp.desc(btn), max, before, after, jump: before - after };
};
const H3_BTN = ':scope > h3 button, :scope > h3 a[href]';
// F:#rdSearch 在 #rdSystem 正上方;把 #rdSystem 捲到剛好貼著固定段,#rdSearch 就整顆壓在標題下,再聚焦它
const FIELD = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bd = document.getElementById('trackPanel'), el = document.getElementById('rdSearch'), nxt = document.getElementById('rdSystem');
  if (!bd || bd.hidden || !el || !nxt || !el.getClientRects().length) return { none: true };
  const hs = __bsp.heads(bd), stackBottom = () => Math.max(...hs.map(h => h.getBoundingClientRect().bottom));
  bd.scrollTop = 0; await sleep(50);
  bd.scrollTop = Math.max(0, nxt.getBoundingClientRect().top - stackBottom() - 2 + bd.scrollTop);
  await sleep(150);
  const over = () => +(stackBottom() - el.getBoundingClientRect().top).toFixed(1);
  const over0 = over();
  el.focus();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(50);
  const over1 = over();
  await sleep(500);
  const over2 = over();
  el.blur();
  return { over0, over1, over2 };
};
// 站名牌出現／消失:照 index.html flashRandomNextPlate 的契約(設 _randomNextPlate、清 _plateStop、立刻 updateFollowPanel),
// 只是期限拉長、自己指定報哪一站;不等跟車迴圈下一輪刷新(那一輪多久來一次不歸這支管)。
const PLATE = async on => {
  const tr = state.followTrain;
  state._randomNextPlate = on ? { tr, until: performance.now() + 600000, stop: tr.stops[Math.min(2, tr.stops.length - 1)] } : null;
  state._plateStop = null;
  updateFollowPanel(tr);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 250));
  const dp = document.getElementById('dwellPlate');
  return { ...__bsp.stuck('board'), plate: (dp.classList.contains('dp-docked') ? '併入' : '未併') + (dp.classList.contains('show') ? '亮' : '暗') };
};
const FONT = async tier => {
  if (typeof setFontScale === 'function') setFontScale(tier);
  else if (tier === 'std') document.documentElement.removeAttribute('data-fs'); else document.documentElement.setAttribute('data-fs', tier);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 150));
  return __bsp.stuck('ridePanel');
};
const padFits = s => Math.abs(s.pad - s.stuck) <= 1;
const fmtS = s => `pad ${s.pad} 實際 ${s.stuck}(${s.n} 段, 可捲 ${s.max}${s.plate ? ', 牌' + s.plate : ''})`;

let t0Done = false;
for (const [eng, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch({ headless: true });
  const P = s => `${eng} ${s}`;

  // ── 360×780 直式標準字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780 });
    if (!t0Done) {
      t0Done = true;
      const served = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
      ok('T0 服務端 BUILD 與本機檔案一致', served === localBuild, `served=${served} local=${localBuild}`);
    }
    // W:走過的內容拍數下限(當下量到的可聚焦數推導,不寫死):長面板至少走完一半,短面板至少 2 拍
    for (const key of ['favPanel', 'board', 'trackPanel', 'searchPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    // J
    for (const key of ['favPanel', 'board', 'trackPanel', 'ridePanel']) {
      await open(page, key);
      const j = await page.evaluate(JUMP, [ELEM[key], H3_BTN]);
      ok(P(`J 360 ${key} 捲在下面時聚焦標題的鈕,內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
        j.none ? '標題裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
    }
    // F
    await open(page, 'trackPanel');
    const f = await page.evaluate(FIELD);
    ok(P('F 360 被蓋住的文字欄位 #rdSearch 聚焦後讓出來、半秒後也沒被捲回去'), !f.none && f.over0 > 20 && f.over1 <= 0.5 && f.over2 <= 0.5,
      f.none ? '#rdSearch 不在畫面上' : `聚焦前壓 ${f.over0}px → 下一拍 ${f.over1} → 半秒後 ${f.over2}(≤0 才算讓出)`);
    // P:護照重繪換掉 h3(新節點)之後換字級,讓位要跟著長高
    await open(page, 'ridePanel');
    const rideStuck = async mutate => {
      await page.evaluate(() => renderRidePanel());
      if (mutate) await page.evaluate(() => boardPadRO.unobserve(document.querySelector('#ridePanel > h3')));
      await settle(page);
      const std = await page.evaluate(FONT, 'std');
      const xl = await page.evaluate(FONT, 'xlarge');
      await page.evaluate(FONT, 'std');
      return { std, xl };
    };
    const rs = await rideStuck(false);
    ok(P('P 360 護照重繪後換特大字級,讓位＝實際固定段底緣'), padFits(rs.std) && padFits(rs.xl) && rs.xl.stuck > rs.std.stuck + 3,
      `標準 ${fmtS(rs.std)}；特大 ${fmtS(rs.xl)}`);
    if (eng === 'chromium') {
      const rm = await rideStuck(true);
      ok(P('N 突變:重繪後新 h3 沒被觀察 ⇒ 特大字級的讓位停在舊值(P 量得到紅)'), !padFits(rm.xl), `特大 ${fmtS(rm.xl)}`);
    }
    // N:改回容器 scroll-padding-top(v0925k 的寫法) ⇒ J 必須紅
    await open(page, 'board');
    await page.evaluate(() => {
      window.syncBoardScrollPad = function () {};
      for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = b.style.getPropertyValue('--board-scroll-pad'); b.style.removeProperty('--board-scroll-pad'); }
    });
    const jn = await page.evaluate(JUMP, ['board', H3_BTN]);
    ok(P('N 對照:容器 scroll-padding-top ⇒ 聚焦標題的鈕內容會跳(J 量得到紅)'), !jn.none && Math.abs(jn.jump) > 20,
      jn.none ? '標題裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
    // N:讓位整個拿掉 ⇒ W 必須紅
    await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = ''; b.style.removeProperty('--board-scroll-pad'); } });
    await open(page, 'favPanel');
    const wn = await walk(page, eng, 'favPanel');
    ok(P('N 對照:拿掉讓位 ⇒ 我的最愛鍵盤往回走會被蓋(W 量得到紅)'), wn.covered > 0, `被蓋 ${wn.covered}/${wn.content} 拍`);
    ok(P('360 標準字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 360×780 直式特大字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780, tier: 'xlarge' });
    for (const key of ['favPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 特大 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 特大 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    ok(P('360 特大字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 844×390 橫式合併卡(h3＋站名牌＋分頁列三段固定段) ──────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 844, height: 390 });
    const opened = await open(page, 'uni');
    const isUni = opened && await page.evaluate(() => { const t = document.querySelector('#board > .uni-tabs'); return !!(t && getComputedStyle(t).position === 'sticky'); });
    ok(P('844×390 合併卡打得開、分頁列是 sticky'), isUni);
    if (isUni) {
      const w = await walk(page, eng, 'board');
      ok(P('W 844×390 合併卡鍵盤往回走,焦點不被固定段蓋住'), w.covered === 0 && w.content >= 2,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
      await page.evaluate(CLOSE_ALL); await page.evaluate(OPEN.uni); await settle(page); await page.waitForTimeout(250);
      for (const [label, sel] of [['標題的鈕', H3_BTN], ['分頁鈕', ':scope > .uni-tabs button']]) {
        const j = await page.evaluate(JUMP, ['board', sel]);
        ok(P(`J 844×390 合併卡捲在下面時聚焦${label},內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
          j.none ? `找不到${label}` : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
      }
      const off = await page.evaluate(PLATE, false), on = await page.evaluate(PLATE, true), off2 = await page.evaluate(PLATE, false);
      ok(P('P 844×390 站名牌出現／消失,讓位＝實際固定段底緣'), padFits(off) && padFits(on) && padFits(off2) && on.n === off.n + 1 && on.stuck > off.stuck + 10,
        `無牌 ${fmtS(off)}；有牌 ${fmtS(on)}；再收 ${fmtS(off2)}`);
      if (eng === 'chromium') {
        const src = await page.evaluate(() => syncBoardHeadVar.toString());
        const LINE = 'if (on) syncBoardScrollPad(bd);';
        ok(P('N 突變目標那一行還在 syncBoardHeadVar 裡'), src.includes(LINE));
        if (src.includes(LINE)) {
          await page.evaluate(([s, line]) => { window.__origSBHV = syncBoardHeadVar; window.syncBoardHeadVar = (0, eval)('(' + s.replace(line, '') + ')'); }, [src, LINE]);
          await page.evaluate(PLATE, false);
          const mOn = await page.evaluate(PLATE, true);
          ok(P('N 突變:拿掉 syncBoardHeadVar 尾端那一刀 ⇒ 站名牌出現時讓位停在舊值(P 量得到紅)'), !padFits(mOn), `有牌 ${fmtS(mOn)}`);
          await page.evaluate(() => { window.syncBoardHeadVar = window.__origSBHV; });
        }
      }
    }
    ok(P('844×390 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await browser.close();
}
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${failed.length ? `未過 ${failed.length} 條` : '全部通過'}(共 ${results.length} 條)`);
process.exitCode = failed.length ? 1 : 0;

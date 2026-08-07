// 跟隨鎖 × .board 家族 sheet 相交通案驗證——fresh 驗收 finding①(4f20551 只修了誤點履歷個案)的通案化。
// 手機寬(360/375/414/768)跟車時逐一開啟每個 sheet,量 getBoundingClientRect 幾何相交 +
// elementFromPoint 像素真值(鎖鈕 z800 > sheet z650,相交時鎖鈕會浮在 sheet 上擋內容)。
// 高身情境:favs 塞 25 筆、rides 塞 30 筆、today 餵 40 班誤點假資料、board 開台北站(真班表)。
// 判準:幾何相交時鎖鈕必須已讓位(opacity≈0 + pointer-events:none),否則 FAIL。
// 迴歸:無 sheet 時鎖鈕可見可點、關 sheet 後復原、桌機(1280)完全不受影響、面板互斥不變。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5223;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 高鐵班表已改走 /api/thsr-schedule(commit 9f05f2f):真實端點只有兩種合法形狀——200 帶完整文件,
  // 或(上游失敗時)404。下面通用的 /api/* 200 `{}` 是這支假伺服器自己造出來、現實中不存在的第三種
  // 形狀——`{}` 是 truthy,index.html 的 fallbackUrl 退路只在 raw 為假值時才啟動,於是 resolveScheduleDay
  // 原樣放行 `{}`、sys.data.trains 變成 undefined,開機時 for...of 直接丟 TypeError。這裡回真實靜態檔
  // 內容,才是這條路徑成功時的忠實模擬。
  if (url.pathname === '/api/thsr-schedule') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
  }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
// listen(0):這個 repo 同時有 30+ 個 worktree 各自跑驗收,固定埠遲早撞到別人的樹——
// 撞到的話最好的下場是連不上(空輸出、既不綠也不紅),最壞是驗到別人的碼還全綠。
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
// G0:伺服器吐出來的位元組必須 == 磁碟上的位元組,否則後面量什麼都不算數
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const wire = createHash('md5').update(Buffer.from(await (await fetch(BASE)).arrayBuffer())).digest('hex');
  if (wire !== disk) { console.error(`G0 FAIL ${wire} != ${disk}`); process.exit(1); }
  console.log(`[G0] ROOT=${ROOT}\n[G0] index.html md5=${disk}  BASE=${BASE}\n`);
}

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const allErrors = [];

// 誤點履歷控制組用的假資料(沿 verify_delay_history_ui.mjs)
const FAKE_DAYS = (() => {
  const days = [], end = new Date(Date.UTC(2026, 6, 19));
  for (let i = 89; i >= 0; i--) {
    const dt = new Date(end); dt.setUTCDate(dt.getUTCDate() - i);
    if (i % 11 === 3) continue;
    const fd = i % 7 === 0 ? 8 + (i % 5) * 2 : i % 4;
    days.push({ d: dt.toISOString().slice(0, 10), fd, md: fd + (i % 3) });
  }
  return days;
})();
// today 看板 40 班假資料(撐出高身 sheet)
const FAKE_TODAY = Array.from({ length: 40 }, (_, i) => ({ no: String(1000 + i * 7), delay: (i % 9) * 3, delayMax: (i % 9) * 3 + 4 }));

async function boot(browser, { width, height, touch, tag }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; errs.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { const s = `[${tag}] console.error: ${m.text()}`; errs.push(s); allErrors.push(s); } });
  await page.route('**/api/today-board*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: FAKE_TODAY }) }));
  await page.route('**/api/delay-stats*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trains: {} }) }));
  await page.route('**/api/delay-history*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ train: 'x', days: FAKE_DAYS, _meta: { window_days: 90, n: FAKE_DAYS.length, generated: '2026-07-20T01:00:00Z' } }) }));
  await page.goto(BASE + '?plus=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(200);
  // 跟一班台鐵車(鎖鈕只在跟隨中顯示)
  const no = await page.evaluate(async () => {
    let tries = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && tries < 60) { await new Promise(r => setTimeout(r, 60)); tries++; }
    let running = null, any = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      if (!any) any = String(tr.train);
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (s && eff > s[0].depSec + 60 && eff < s[s.length - 1].arrSec - 120) { running = String(tr.train); break; }
    }
    const n = running || any;
    if (n) followTrainNo(n);
    return n;
  });
  await page.waitForTimeout(400);
  // 高身情境種子:25 筆收藏 + 30 筆乘車紀錄
  await page.evaluate(() => {
    userDataSaveCollection('favs', Array.from({ length: 25 }, (_, i) => ({ train: String(2000 + i), label: `自強${2000 + i}　台北→高雄` })));
    userDataSaveCollection('rides', Array.from({ length: 30 }, (_, i) => ({ train: String(3000 + i), sys: 'tra_sched', date: `2026-06-${String(1 + (i % 28)).padStart(2, '0')}`, kind: '自強', from: '台北', to: '高雄', km: 100 + i, dep: 21600, stops: 8 })));
  });
  return { ctx, page, errs, no };
}

// 每個 sheet 的開法(在頁內執行);board 開台北站(真班表,下午時段列多)
const SHEETS = [
  { id: 'board',          open: `openBoard({ name: '台北', sys: 'tra_sched' })` },
  { id: 'favPanel',       open: `openFavPanel()` },
  { id: 'ridePanel',      open: `openRidePanel()` },
  { id: 'explorePanel',   open: `openExplorePanel()` },
  { id: 'trackPanel',     open: `openTrackPanel()` },
  { id: 'todayPanel',     open: `openTodayPanel()` },
  { id: 'delayHistPanel', open: `openDelayHist(state.trains.find(t => String(t.train) === '__NO__'))` },
];

async function measureSheet(page, sheet, no) {
  await page.evaluate(code => eval(code), sheet.open.replace('__NO__', no));
  await page.waitForTimeout(700); // 待渲染 + opacity 過渡(.5s)走完再量
  const m = await page.evaluate(id => {
    const howto = document.getElementById('howtoWrap');
    const el = document.getElementById(id);
    const lb = document.getElementById('followLockBtn');
    const r = el.getBoundingClientRect();
    const overlap = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    let lock = null;
    if (lb) {
      const lr = lb.getBoundingClientRect(), cs = getComputedStyle(lb);
      const csCtl = getComputedStyle(lb.closest('.follow-lock-ctl'));
      const op = Math.min(parseFloat(cs.opacity), parseFloat(csCtl.opacity));
      const pe = (cs.pointerEvents === 'none' || csCtl.pointerEvents === 'none') ? 'none' : cs.pointerEvents;
      const ov = overlap(r, lr);
      let efp = null;
      if (ov) {
        const x = (Math.max(r.left, lr.left) + Math.min(r.right, lr.right)) / 2;
        const y = (Math.max(r.top, lr.top) + Math.min(r.bottom, lr.bottom)) / 2;
        const hit = document.elementFromPoint(x, y);
        efp = hit && hit.closest('#followLockBtn') ? 'lock' : (hit && hit.closest('#' + id) ? 'sheet' : (hit ? hit.tagName : 'null'));
      }
      lock = { rect: [lr.left, lr.top, lr.right, lr.bottom].map(v => Math.round(v)), op: +op.toFixed(2), pe, ov, efp };
    }
    return {
      howtoHidden: !howto || howto.hidden,
      hidden: el.hidden,
      rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)),
      h: Math.round(r.height),
      contentH: el.scrollHeight,
      sheetOpen: document.body.classList.contains('sheet-open'),
      dhOpen: document.body.classList.contains('dh-open'),
      lock,
    };
  }, sheet.id);
  // 關閉(下一個 sheet 由 open 內的互斥自關,這裡顯式關乾淨)
  await page.evaluate(id => {
    const f = { board: 'closeBoard', favPanel: 'closeFavPanel', ridePanel: 'closeRidePanel', explorePanel: 'closeExplorePanel', trackPanel: 'closeTrackPanel', todayPanel: 'closeTodayPanel', delayHistPanel: 'closeDelayHist' }[id];
    window[f]();
  }, sheet.id);
  await page.waitForTimeout(80);
  return m;
}

const browser = await chromium.launch();
const webkitB = await webkit.launch();

// chromium 掃四寬度;WebKit(手機主場引擎)抽 375 全 sheet 佐證,防 UA 樣式差異(心得 23/24 家族)
const RUNS = [[360, 780, true, browser, 'M360'], [375, 812, true, browser, 'M375'], [414, 896, true, browser, 'M414'], [768, 1024, true, browser, 'M768'], [375, 812, true, webkitB, 'WK375']];
for (const [width, height, touch, eng, tag] of RUNS) {
  const { ctx, page, errs, no } = await boot(eng, { width, height, touch, tag });
  ok(`${tag}.0 跟到台鐵車、鎖鈕可見`, !!no && await page.locator('.follow-lock-ctl').isVisible(), `no=${no}`);
  // 基線:無 sheet 時鎖鈕可見可互動
  const base = await page.evaluate(() => {
    const lb = document.getElementById('followLockBtn');
    const cs = getComputedStyle(lb), r = lb.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { op: parseFloat(cs.opacity), pe: cs.pointerEvents, rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)), efpLock: !!(hit && hit.closest('#followLockBtn')) };
  });
  ok(`${tag}.1 基線(無 sheet):鎖鈕不透明可點且 elementFromPoint 命中`, base.op > 0.9 && base.pe !== 'none' && base.efpLock, `op=${base.op} pe=${base.pe} rect=${base.rect.join(',')}`);
  for (const sheet of SHEETS) {
    const m = await measureSheet(page, sheet, no);
    if (m.hidden) { ok(`${tag} ${sheet.id} 開啟失敗`, false, 'hidden'); continue; }
    const line = `sheet=[${m.rect.join(',')}] h=${m.h} contentH=${m.contentH} lock=[${m.lock.rect.join(',')}] ov=${m.lock.ov} op=${m.lock.op} pe=${m.lock.pe} efp=${m.lock.efp} howtoHidden=${m.howtoHidden}`;
    // 判準:幾何相交 → 鎖鈕必須讓位(op<0.02 或 pe:none),且 elementFromPoint 不命中鎖鈕
    const yielded = m.lock.op < 0.02 || m.lock.pe === 'none';
    const pass = m.howtoHidden && (!m.lock.ov || (yielded && m.lock.efp !== 'lock'));
    ok(`${tag} ${sheet.id} 相交時鎖鈕已讓位`, pass, line);
  }
  // 迴歸:全關後鎖鈕復原
  const after = await page.evaluate(() => {
    const lb = document.getElementById('followLockBtn');
    const cs = getComputedStyle(lb);
    return { op: parseFloat(cs.opacity), pe: cs.pointerEvents, sheetOpen: document.body.classList.contains('sheet-open') };
  });
  ok(`${tag}.9 全關後鎖鈕復原(op=1, 可點, sheet-open 已卸)`, after.op > 0.9 && after.pe !== 'none' && !after.sheetOpen, JSON.stringify(after));
  // 迴歸:鎖鈕真的可點(點一下 → followLock 翻轉)
  const beforeLock = await page.evaluate(() => state.followLock);
  await page.evaluate(() => document.getElementById('followLockBtn').click());
  const afterLock = await page.evaluate(() => state.followLock);
  ok(`${tag}.10 鎖鈕點擊功能不變(followLock 翻轉)`, beforeLock !== afterLock, `${beforeLock}→${afterLock}`);
  // 迴歸:面板互斥(開 fav 再開 today → fav 自關)
  await page.evaluate(() => { openFavPanel(); openTodayPanel(); });
  const mutex = await page.evaluate(() => ({ fav: document.getElementById('favPanel').hidden, today: document.getElementById('todayPanel').hidden }));
  await page.evaluate(() => closeTodayPanel());
  ok(`${tag}.11 面板互斥不變(開 today 自關 fav)`, mutex.fav === true && mutex.today === false, JSON.stringify(mutex));
  if (errs.length) ok(`${tag}.Z 零 pageerror/console.error`, false, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// 桌機控制組:sheet 開啟不得影響鎖鈕(規則只在手機媒體塊)
{
  const { ctx, page, errs, no } = await boot(browser, { width: 1280, height: 800, touch: false, tag: 'D1280' });
  ok('D1280.0 跟到台鐵車、鎖鈕可見', !!no && await page.locator('.follow-lock-ctl').isVisible(), `no=${no}`);
  for (const sheet of SHEETS) {
    await page.evaluate(code => eval(code), sheet.open.replace('__NO__', no));
    await page.waitForTimeout(250);
    const d = await page.evaluate(() => {
      const lb = document.getElementById('followLockBtn');
      const cs = getComputedStyle(lb);
      return { op: parseFloat(cs.opacity), pe: cs.pointerEvents };
    });
    ok(`D1280 ${sheet.id} 開啟時鎖鈕不受影響(桌機)`, d.op > 0.9 && d.pe !== 'none', `op=${d.op} pe=${d.pe}`);
    await page.evaluate(id => {
      const f = { board: 'closeBoard', favPanel: 'closeFavPanel', ridePanel: 'closeRidePanel', explorePanel: 'closeExplorePanel', trackPanel: 'closeTrackPanel', todayPanel: 'closeTodayPanel', delayHistPanel: 'closeDelayHist' }[id];
      window[f]();
    }, sheet.id);
  }
  if (errs.length) ok('D1280.Z 零 pageerror/console.error', false, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// 【V9】App 內建瀏覽器逃生提示(#iabHint) × 速度膠囊(.controls) × 跟車卡
// (與 feat/trtc-live 上的同名批次同源;那條分支另有 G1–G6 的浮層避讓,本檔只帶這一組)
//
// 缺陷:.iab-hint 的 bottom 釘死 calc(env+74px),而收合(slim)膠囊 bottom 是 var(--tabbar-clear)+10、
// 高 39–41px ⇒ 膠囊頂端比提示下緣還高,提示(z713)整片壓在膠囊(z700)上,正好吃掉 #pp。
// 判準寫成「量到的效果」(相交 px、elementFromPoint 命中),不是「選擇器在不在陣列裡」。
// 三個方向都要有:①正向(該讓的讓了) ②反向對照(讓過頭也要抓:提示自己的鈕還點得到嗎)
// ③零回歸(別把 #randBtn/群組頁籤/時鐘徽章換成新的受害者)。
//
// 🔴 兩個會讓整組斷言空轉成假綠的前置:
//   ・body.cfaint(閒置 5 秒的把手態)把 #pp 設成 display:none ⇒ 不歸零成 slim 就是在量「沒有播放鍵」。
//   ・提示要 1400ms 後才浮出,且首訪教學卡 z800 蓋全場。
// 兩者各有一條前置斷言(V9.0)守著。
// ═══════════════════════════════════════════════════════════════════════════
{
  const MUT = process.env.MUT || '';
  const MUTS = {
    // 打掉第一層(提示讓開膠囊)=退回修復前 → 該讓 V9a/V9b 變紅,V9c/V9d/V9e 必須仍綠
    ihNoLift: [`if (ih) ih.style.bottom = (ihShown && ctl) ? (Math.round(stR.bottom - ctl.getBoundingClientRect().top) + 8) + 'px' : '';`,
               `if (ih) ih.style.bottom = '';`],
    // 提示改排到「卡」之上(修這件事最直覺、也是實測會壓死上緣控件的那條路)→ 該讓 V9d 變紅
    ihOverCard: [`if (ih) ih.style.bottom = (ihShown && ctl) ? (Math.round(stR.bottom - ctl.getBoundingClientRect().top) + 8) + 'px' : '';`,
                 `if (ih) ih.style.bottom = (ihShown && ctl) ? (Math.round(stR.bottom - ctl.getBoundingClientRect().top) + 8) + 'px' : '';\n    if (ih && ihShown) { const _c = state.freqFollow ? fc : fp; if (_c && !_c.hidden) ih.style.bottom = (Math.round(stR.bottom - _c.getBoundingClientRect().top) + 8) + 'px'; }`],
    // 拿掉抬升上界 → 該讓 V9e(卡壓到時鐘徽章)變紅
    noCeil: [`lift = Math.max(52, Math.min(lift, Math.round(stR.bottom - (ceil + 8) - cardH)));`,
             `lift = Math.max(52, lift);`],
    // 拿掉 opacity 門檻(淡出中的提示仍當家具)→ 該讓 V2G(cexp 下卡多讓)變紅
    ihNoOpacityGate: [`const ihShown = !!(shellOk && ih && !ih.hidden && ih.offsetParent && +getComputedStyle(ih).opacity >= 0.5);`,
                      `const ihShown = !!(shellOk && ih && !ih.hidden && ih.offsetParent);`],
  };
  if (MUT && !MUTS[MUT]) { console.error(`未知的 MUT=${MUT}`); process.exit(1); }
  if (MUT) console.log(`\n★★ 突變模式 MUT=${MUT} —— 指名該變紅的見上方註解(其餘仍須全綠)\n`);

  const IAB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Barcelona 382.1.0.34.109';
  const W_H = { 320: 568, 360: 640, 375: 812, 414: 896, 768: 1024 };

  const PROBE = `(function(){
    function box(sel){ var el=typeof sel==='string'?document.querySelector(sel):sel; if(!el) return null;
      var cs=getComputedStyle(el);
      if (cs.display==='none'||cs.visibility==='hidden'||el.hidden) return null; // .stage 是 fixed,offsetParent 恆 null,不可拿來判可見
      var r=el.getBoundingClientRect(); if(!(r.width>0.5&&r.height>0.5)) return null;
      return { t:r.top, b:r.bottom, l:r.left, r:r.right, h:r.height, w:r.width, op:+cs.opacity, pe:cs.pointerEvents }; }
    // 相交:寬與高要分別 >0.5 才算真的疊到——只比垂直區間會把「左右錯開」的兩個盒子算成相交
    function iv(a,b){ var A=box(a),B=box(b); if(!A||!B) return 0;
      var h=Math.min(A.b,B.b)-Math.max(A.t,B.t), w=Math.min(A.r,B.r)-Math.max(A.l,B.l);
      return (h>0.5&&w>0.5)?Math.round(h*10)/10:0; }
    function own(sel){ var el=typeof sel==='string'?document.querySelector(sel):sel; if(!el) return 'absent';
      var b=box(el); if(!b) return 'invis';
      var h=document.elementFromPoint((b.l+b.r)/2,(b.t+b.b)/2);
      return (h && (h===el||el.contains(h))) ? 'own' : ('BY:'+(h?h.tagName.toLowerCase()+(h.id?'#'+h.id:''):'null')); }
    window.__own = own; window.__iv = iv; window.__box = box;
    window.__stack = function(){
      var cardSel = state.freqFollow ? '#freqCard' : (state.followTrain ? '#followPanel' : null);
      var ih = document.getElementById('iabHint');
      var ihLive = !!(box(ih) && +getComputedStyle(ih).opacity >= 0.5);  // 判準自己算,不讀實作的旗標
      var st = box('.stage'), ctl = box('.controls'), card = cardSel?box(cardSel):null, ihB = box(ih);
      var furnTop = ctl ? ctl.t : null;
      if (ihLive && ihB) furnTop = Math.min(furnTop, ihB.t);
      return { cexp:document.body.classList.contains('cexp'), cfaint:document.body.classList.contains('cfaint'),
        ppVis: !!box('#pp'), cardSel:cardSel, stage:st, ctl:ctl, card:card, ih:ihB, ihLive:ihLive, furnTop:furnTop,
        badge: box('.badge'), topbar: box('.topbar') };
    };
    // 全域掃描:所有可見控件都要點得到(沒有白名單,只要有一顆被蓋就吐出來)
    window.__ctlAudit = function(){
      var bad=[], sels='.controls button, .controls input, .topbar button, #mapActions button, .follow-panel button, .freq-card button, .iab-hint button';
      document.querySelectorAll(sels).forEach(function(el){
        var b=box(el); if(!b||b.pe==='none') return;
        var o=own(el); if(o!=='own') bad.push((el.id||el.className||el.tagName)+'←'+o);
      });
      return bad;
    };
    // 資訊浮層被遮:量「看得見的東西被蓋掉多少」,補 elementFromPoint 對 pointer-events:none 結構性失明的那半
    window.__occAudit = function(){
      var out=[], cardSel = state.freqFollow ? '#freqCard' : (state.followTrain ? '#followPanel' : null);
      if (!cardSel) return out;
      // 刻意不含 ['#iabHint',cardSel]:那一對由 V9h 用「這個畫面本身的缺口」判(缺口從當下量到的
      // rect 現算),比這裡寫死的 14px 強——320×568 塞不下 tabbar+膠囊+232px 提示+154px 卡時,
      // 剩下的相交是幾何必然,拿固定門檻去判只會逼人把門檻往上調成下一個會被推翻的魔術數字。
      // (V9h 在修復前的 main 上會紅:BASE 相交 124px、缺口算出來是 0。)
      [['#dwellPlate',cardSel],['.badge',cardSel]].forEach(function(p){
        var h=iv(p[0],p[1]); if(h>14){ var A=box(p[0]),B=box(p[1]);
          out.push({v:p[0],o:p[1],h:h,w:Math.round(Math.min(A.r,B.r)-Math.max(A.l,B.l))}); }
      });
      return out;
    };
  })()`;

  // 已知未修:必須帶理由、而且每次都印出來(靜靜吞掉 = 假裝沒這回事)
  const OCC_KNOWN = {
    '#dwellPlate': '320×568 垂直預算不足(名牌下緣到底 344px < 需要 408px),名牌刻意不列入抬升上界;pointer-events:none 不擋控件',
  };

  // 膠囊三態:#pp 在 cfaint 是 display:none,量之前一律歸零成 slim,否則所有 #pp 斷言空轉成真
  const setSlim = async (page) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { document.body.classList.remove('cexp'); if (state._fsCapsuleSync) state._fsCapsuleSync(true); else document.body.classList.remove('cfaint'); });
      await page.waitForTimeout(200);
      const s = await page.evaluate(() => ({ cexp: document.body.classList.contains('cexp'), cfaint: document.body.classList.contains('cfaint'), ppVis: !!__box('#pp') }));
      if (!s.cexp && !s.cfaint && s.ppVis) return s;
    }
    return await page.evaluate(() => ({ cexp: document.body.classList.contains('cexp'), cfaint: document.body.classList.contains('cfaint'), ppVis: !!__box('#pp') }));
  };
  const setCexp = async (page) => {
    // 膠囊的 5 秒閒置計時器會在量測窗內把 cexp 收掉 ⇒ 讀回確認,最多三次
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { document.body.classList.remove('cfaint'); document.body.classList.add('cexp'); (state._placeFsOverlays || (() => {}))(); });
      await page.waitForTimeout(260);
      if (await page.evaluate(() => document.body.classList.contains('cexp'))) return true;
    }
    return false;
  };

  const followTra = page => page.evaluate(async () => {
    let n = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && n++ < 100) await new Promise(r => setTimeout(r, 60));
    let running = null, any = null;
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      if (!any) any = String(tr.train);
      const s = tr.stops, eff = (typeof effT === 'function') ? effT(tr) : 0;
      if (s && eff > s[0].depSec + 60 && eff < s[s.length - 1].arrSec - 120) { running = String(tr.train); break; }
    }
    const t = running || any; if (t) followTrainNo(t); return t;
  });
  const followMetro = page => page.evaluate(async () => {
    let n = 0;
    while (!(state.decoLines && state.decoLines.length) && n++ < 120) await new Promise(r => setTimeout(r, 60));
    const hit = (typeof pickTourMetro === 'function') ? pickTourMetro() : null;
    if (!hit) return null; setFreqFollow(hit); return String(hit.ln.id || 'metro');
  });
  const followDwell = page => page.evaluate(async () => {
    let n = 0;
    while ((!state.trains || !state.trains.some(t => t.sys === 'tra_sched')) && n++ < 100) await new Promise(r => setTimeout(r, 60));
    for (const tr of (state.trains || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.train) continue;
      const s = tr.stops; if (!s || s.length < 3) continue;
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i].depSec - s[i].arrSec >= 30) { followTrainNo(String(tr.train)); setSimSec(s[i].arrSec + 20); return String(tr.train); }
      }
    }
    return null;
  });

  for (const [engName, br] of [['chromium', browser], ['webkit', webkitB]]) {
    for (const W of [320, 360, 375, 414, 768]) {
      const tag = `${engName}/${W}`;
      const ctx = await br.newContext({ viewport: { width: W, height: W_H[W] }, hasTouch: true, isMobile: true, locale: 'zh-TW', userAgent: IAB_UA });
      await ctx.addInitScript(() => {
        try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
      if (MUT) {
        // 突變只在記憶體裡替換,不寫檔、不碰 git;來源字串找不到就當場失敗(不打空包彈)
        const [from, to] = MUTS[MUT];
        await page.route(BASE, async r => {
          const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
          if (!html.includes(from)) { console.error(`MUT ${MUT}: 找不到來源字串`); process.exit(1); }
          await r.fulfill({ status: 200, contentType: 'text/html', body: html.replace(from, to) });
        });
      }
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
      await page.waitForTimeout(2600); // 提示 1400ms 後才浮出,留餘裕
      await page.evaluate(PROBE);

      const v9 = async (label) => {
        const pre = await setSlim(page);
        ok(`${tag} V9.0 前置 ${label}:膠囊是 slim(非 cfaint/cexp)且播放鍵可見`,
          !pre.cexp && !pre.cfaint && pre.ppVis, JSON.stringify(pre));
        const e = await page.evaluate(() => {
          const s = __stack();
          const gtabs = [].map.call(document.querySelectorAll('.topbar .gtab'), b => __own(b));
          return {
            stack: s, ppOwn: __own('#pp'), ihCloseOwn: __own('#iabClose'), ihBtnOwn: __own('.iab-hint .ih-btns button'),
            cardCloseOwn: s.cardSel === '#freqCard' ? __own('#fcEnd') : (s.cardSel ? __own('#fpClose') : 'n/a'),
            randOwn: __own('#randBtn'), gtabs,
            ihXctl: __iv('#iabHint', '.controls'), ihXcard: s.cardSel ? __iv('#iabHint', s.cardSel) : 0,
            ihXma: __iv('#iabHint', '#mapActions'), ihXtop: __iv('#iabHint', '.topbar'),
            badgeXcard: s.cardSel ? __iv('.badge', s.cardSel) : 0,
            topXcard: s.cardSel ? __iv('.topbar', s.cardSel) : 0,
            ctlAudit: __ctlAudit(), occAudit: __occAudit(),
          };
        });
        const s = e.stack;
        // ── 正向:缺陷本身 ──
        ok(`${tag} V9a ${label} 播放/暫停鍵點得到`, e.ppOwn === 'own', `hit=${e.ppOwn}`);
        ok(`${tag} V9b ${label} 逃生提示不壓膠囊(幾何相交=0)`, e.ihXctl === 0,
          `相交 ${e.ihXctl} 提示=[${s.ih && Math.round(s.ih.t)},${s.ih && Math.round(s.ih.b)}] 膠囊=[${s.ctl && Math.round(s.ctl.t)},${s.ctl && Math.round(s.ctl.b)}]`);
        // ── 反向對照:讓過頭一樣是壞的(把提示藏到膠囊底下也能讓 V9a/V9b 變綠) ──
        ok(`${tag} V9c ${label} 提示自己的 ×/按鈕仍點得到(反向對照)`,
          e.ihCloseOwn === 'own' && e.ihBtnOwn === 'own', `×=${e.ihCloseOwn} 鈕=${e.ihBtnOwn}`);
        // ── 零回歸:別把 #randBtn/群組頁籤/時鐘徽章換成新的受害者 ──
        ok(`${tag} V9d ${label} 提示沒壓到上緣(動作列/頂列相交=0、鈕逐顆可點)`,
          e.ihXma === 0 && e.ihXtop === 0 && e.randOwn === 'own' && e.gtabs.every(g => g === 'own'),
          `動作列 ${e.ihXma} 頂列 ${e.ihXtop} rand=${e.randOwn} gtabs=${JSON.stringify(e.gtabs)}`);
        if (s.cardSel) {
          ok(`${tag} V9e ${label} 卡沒被抬過頭(不壓時鐘徽章/頂列、整張留在 stage 內)`,
            e.badgeXcard === 0 && e.topXcard === 0 && s.card.t >= s.stage.t - 0.5 && s.card.b <= s.stage.b + 0.5,
            `徽章 ${e.badgeXcard} 頂列 ${e.topXcard} 卡=[${Math.round(s.card.t)},${Math.round(s.card.b)}] stage=[${Math.round(s.stage.t)},${Math.round(s.stage.b)}]`);
          ok(`${tag} V9f ${label} 卡自己的結束鈕仍點得到`, e.cardCloseOwn === 'own', `hit=${e.cardCloseOwn}`);
          ok(`${tag} V9g ${label} 卡貼著下緣家具(讓開但不多讓)`, (s.furnTop - s.card.b) <= 24,
            `家具頂=${Math.round(s.furnTop)} 卡底=${Math.round(s.card.b)} 差=${Math.round(s.furnTop - s.card.b)}`);
          // 缺口純由量到的 rect 現算,不讀實作的中間變數(判準與實作不同源)
          const need = s.card.h + 8 + (s.ihLive ? s.ih.h + 8 : 0) + (s.stage.b - s.ctl.t);
          const avail = s.stage.b - ((s.badge ? s.badge.b : s.stage.t) + 8);
          const shortfall = Math.max(0, Math.round(need - avail));
          ok(`${tag} V9h ${label} 提示×卡相交不超過畫面本身的缺口`, e.ihXcard <= shortfall + 2,
            `相交 ${e.ihXcard} 缺口 ${shortfall}(卡 ${Math.round(s.card.h)} + 提示 ${s.ihLive ? Math.round(s.ih.h) : 0} vs 可用 ${Math.round(avail)})`);
        }
        ok(`${tag} V9i ${label} 可見控件全部點得到(全域)`, e.ctlAudit.length === 0, e.ctlAudit.join(' | '));
        const unknown = e.occAudit.filter(o => !OCC_KNOWN[o.v]);
        const known = e.occAudit.filter(o => OCC_KNOWN[o.v]);
        ok(`${tag} V9j ${label} 資訊浮層未被遮 ≥14px`, unknown.length === 0,
          JSON.stringify(unknown) + (known.length ? `　[已知未修] ${JSON.stringify(known.map(k => ({ ...k, why: OCC_KNOWN[k.v] })))}` : ''));
      };

      await v9('無跟車');
      await followTra(page); await page.waitForTimeout(500); await v9('tra跟車');
      await page.evaluate(() => { clearFollow(); if (typeof clearFreqFollow === 'function') clearFreqFollow(); });
      const mno = await followMetro(page);
      if (mno) { await page.waitForTimeout(500); await v9('metro跟車'); }
      await page.evaluate(() => { clearFollow(); if (typeof clearFreqFollow === 'function') clearFreqFollow(); });
      await followDwell(page); await page.waitForTimeout(1000); await v9('停靠中');

      // 擠壓情境:copyUrl 的 legacy() 在 clipboard 失敗時會把整條網址塞進 .ih-note(分享深連結本來就長)。
      // 這是抬升上界唯一會真的咬到的情境——沒有它,noCeil 突變不會讓任何斷言變紅 ＝ 判準沒有牙。
      await page.evaluate(() => {
        const n = document.getElementById('iabNote');
        if (n) n.textContent = location.origin + '/?trip=' + 'A'.repeat(120);
        (state._placeFsOverlays || (() => {}))();
      });
      await page.waitForTimeout(300);
      const grew = await page.evaluate(() => { const b = __box('#iabHint'); return b ? Math.round(b.h) : 0; });
      ok(`${tag} V9.X 前置:長註記讓提示真的變高(>190px)`, grew > 190, `提示高=${grew}`);
      await v9('停靠+長註記');

      // ── cexp:淡出中的提示不算家具 ──
      const gotCexp = await setCexp(page);
      ok(`${tag} V2.0 前置 cexp 真的套上了`, gotCexp);
      const c = await page.evaluate(() => {
        const s = __stack();
        return { s, ppOwn: __own('#pp'), ihOp: s.ih ? s.ih.op : null, ctlAudit: __ctlAudit() };
      });
      ok(`${tag} V2.G cexp 卡只讓開展開帶(淡出中的提示不算家具)`,
        !c.s.card || (c.s.furnTop - c.s.card.b) <= 24,
        `家具頂=${c.s.furnTop && Math.round(c.s.furnTop)} 卡底=${c.s.card && Math.round(c.s.card.b)} 差=${c.s.card ? Math.round(c.s.furnTop - c.s.card.b) : 'n/a'} ihOp=${c.ihOp}`);
      ok(`${tag} V2.P cexp 播放鍵仍點得到`, c.ppOwn === 'own', `hit=${c.ppOwn}`);

      // 關掉提示後 inline bottom 要清乾淨(否則提示消失了卡還一直讓位)
      await setSlim(page);
      const closed = await page.evaluate(() => {
        const b = document.getElementById('iabClose'); const o = __own('#iabClose');
        if (b) b.click();
        return { closeOwn: o, bottom: (document.getElementById('iabHint') || { style: {} }).style.bottom };
      });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ bottom: (document.getElementById('iabHint') || { style: {} }).style.bottom, ppOwn: __own('#pp') }));
      ok(`${tag} V2.R 提示的 × 點得到、關掉後 inline bottom 已清`,
        closed.closeOwn === 'own' && after.bottom === '' && after.ppOwn === 'own',
        `×=${closed.closeOwn} bottom="${after.bottom}" pp=${after.ppOwn}`);

      if (errs.length) ok(`${tag} Z(iab) 零 pageerror/console.error`, false, errs.slice(0, 3).join(' | '));
      else ok(`${tag} Z(iab) 零 pageerror/console.error`, true);
      await ctx.close();
    }
  }
}

server.close();
await browser.close();
await webkitB.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);

// 放空模式相機主權 + 出口鈕可及性 + 音樂開關同步 — Playwright 真引擎 + 本機靜態伺服器。
//
// 三件事的來源(2026-08-31 使用者回報 + 裁示):
//  A 放空模式下地圖手勢仍全開 ⇒ 拖曳跟每幀 recenterTo 對打、捏出去的 zoom 沒人還原、
//    「回到列車」鈕在放空是藏的 ⇒ 歪掉之後沒有回得來的路。裁示:兩個視角都鎖,除非離開放空。
//  B 放空的唯一出口「離開放空」idle 後 opacity:0+pointer-events:none(要按兩下)、bottom 沒讓開
//    系統手勢區、熱區只有 32px ⇒ 使用者回報「安卓有時候連退出的按鈕都會不見按不到」。
//  C 抽屜那列音樂開關只有 syncMoreSheet 會重畫,而播放狀態是非同步落定的 ⇒ 永遠慢一步,
//    要去點正上方的省電模式才會被順手改對(使用者說的「跟省電模式聯動」)。
//
// 判準紀律:
//  - 每個「鎖住了」的斷言都配一個【控制組】(同一個 harness、ambient 關掉)必須反向成立,
//    否則就是 harness 沒牙(心得 37)。
//  - 手勢用【真的做一次】(CDP 觸控拖曳/滾輪/雙擊)量事件有沒有發生,不只讀 handler 的 enabled()。
//  - 反向棘輪:idle 淡出對其他家具必須維持原樣,證明沒把整條 idle 規則廢掉。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5197);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── T0 目標自檢(心得 32:驗收腳本第一道閘門要先證明「我在驗誰」) ────────────────
const idxPath = path.join(ROOT, 'index.html');
const idxSrc = readFileSync(idxPath, 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const build = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${idxPath}\n      md5=${md5}  BUILD=${build}  ${idxSrc.split('\n').length} 行\n`);

// 靜態斷言(computed style 照不到 env(),只能讀規則本身)
ok('B4 靜態 放空控制列 bottom 含 env(safe-area-inset-bottom)',
  /body\.ambient \.controls \{[^}]*bottom: calc\(8px \+ env\(safe-area-inset-bottom/.test(idxSrc),
  '規則文字比對');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3,
  hasTouch: true, isMobile: true, locale: 'zh-TW',   // 語系釘死(心得:文案判準隨機器語系假紅)
});
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-appearance', 'dark');
  localStorage.setItem('trainmap-ambient-style', 'follow');
  // 原生音訊 bridge 替身:狀態【非同步】才落定(150ms),重現 App 的真實時序
  const ls = {};
  window.__na = { plays: 0, pauses: 0 };
  window.RAIL_NATIVE_AUDIO = {
    addListener(t, f) { (ls[t] = ls[t] || []).push(f); return Promise.resolve(); },
    setQueue() { return Promise.resolve(); },
    setVolume() { return Promise.resolve(); },
    play() { window.__na.plays++; setTimeout(() => (ls.state || []).forEach(f => f({ playing: true })), 150); return Promise.resolve(); },
    resume() { window.__na.plays++; setTimeout(() => (ls.state || []).forEach(f => f({ playing: true })), 150); return Promise.resolve(); },
    pause() { window.__na.pauses++; setTimeout(() => (ls.state || []).forEach(f => f({ playing: false })), 150); return Promise.resolve(); },
  };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));          // waitReady 逾時=boot 靜默拋錯,先掛這個
await page.goto(`http://localhost:${PORT}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && map && state.mode === 'sched'; } catch (e) { return false; } }, null, { timeout: 30000 });
} catch (e) {
  console.log('boot 失敗,pageerror:', errors.slice(0, 3));
  throw e;
}
await page.waitForTimeout(600);

const cdp = await ctx.newCDPSession(page);
// 事件計數器:程式自己的 setView(animate:false) 不會發 dragstart;zoom 不變也不會發 zoomstart
await page.evaluate(() => {
  window.__ev = { dragstart: 0, zoomstart: 0, click: 0 };
  map.on('dragstart', () => window.__ev.dragstart++);
  map.on('zoomstart', () => window.__ev.zoomstart++);
  map.on('click', () => window.__ev.click++);
});
const resetEv = () => page.evaluate(() => { window.__ev.dragstart = 0; window.__ev.zoomstart = 0; window.__ev.click = 0; });
const ev = () => page.evaluate(() => ({ ...window.__ev }));
const zoom = () => page.evaluate(() => map.getZoom());
const handlers = () => page.evaluate(() =>
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']
    .filter(k => map[k] && map[k].enabled()));

// 真觸控拖曳(CDP;Playwright 的 touchscreen 只有 tap)
async function touchDrag(x0, y0, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 6, y: y0 + dy * i / 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
}
async function mouseDrag(x0, y0, dx, dy) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 + dx * i / 6, y0 + dy * i / 6);
  await page.mouse.up(); await page.waitForTimeout(150);
}
// 一輪完整手勢:觸控拖曳 + 滑鼠拖曳 + 滾輪縮放 + 雙擊。回傳「有沒有動到相機」的證據。
// 兩種輸入路徑都做:放空要兩條都擋得住,控制組只要有一條動得了就證明 harness 有牙。
// ★ 每輪都先暫停播放:跟車相機每幀 setView 會把還沒超過拖曳容差的手勢掐掉(這正是使用者感受到的
//   「打架」,但拿它當實驗背景會讓控制組隨機失敗)。放空與控制組用同一個設定,只留 ambient 一個變因。
async function gestureRound() {
  await page.evaluate(() => { state.playing = false; });
  await page.waitForTimeout(250);
  await resetEv();
  const z0 = await zoom();
  await touchDrag(200, 430, 120, 90);
  await mouseDrag(200, 430, 120, 90);
  await page.mouse.move(200, 430); await page.mouse.wheel(0, -400); await page.waitForTimeout(250);
  await page.mouse.dblclick(200, 430); await page.waitForTimeout(400);
  const e = await ev(); const z1 = await zoom();
  return { ...e, zoomChanged: Math.abs(z1 - z0) > 1e-6, z0, z1 };
}
const enterAmbient = async (style) => {
  await page.evaluate(s => { setAmbientStyle(s); setAmbient(true); }, style);
  await page.waitForTimeout(900);
};
const leaveAmbient = async () => { await page.evaluate(() => setAmbient(false)); await page.waitForTimeout(500); };

// ── A 手勢鎖 ──────────────────────────────────────────────────────────────────
await enterAmbient('follow');
ok('A1 放空(跟車) 六個相機手勢 handler 全關', (await handlers()).length === 0, `仍開著: ${JSON.stringify(await handlers())}`);
const gFollow = await gestureRound();
ok('A2 放空(跟車) 真拖曳不發 dragstart', gFollow.dragstart === 0, `dragstart=${gFollow.dragstart}`);
ok('A3 放空(跟車) 滾輪/雙擊不改 zoom', !gFollow.zoomChanged && gFollow.zoomstart === 0, `z ${gFollow.z0}→${gFollow.z1} zoomstart=${gFollow.zoomstart}`);
ok('A8 放空中地圖點擊仍收得到(點車跟隨沒被鎖掉)', gFollow.click > 0, `click=${gFollow.click}`);

await leaveAmbient();
ok('A6 離開放空後六個手勢全部還原', (await handlers()).length === 6, `開著: ${(await handlers()).length}/6`);
// ★ 控制組:同一套 harness、ambient 關掉 —— 手勢【必須】真的動得了,否則上面三條是假綠
const gCtl = await gestureRound();
ok('A5 控制組(非放空) 同一套手勢真的動得了地圖', gCtl.dragstart > 0 && gCtl.zoomChanged,
  `dragstart=${gCtl.dragstart}(觸控+滑鼠兩路) z ${gCtl.z0}→${gCtl.z1}`);

await enterAmbient('hotspot');
ok('A7 放空(群車) 同樣六個手勢全關(兩視角一致)', (await handlers()).length === 0, `仍開著: ${JSON.stringify(await handlers())}`);
const gHot = await gestureRound();
ok('A7b 放空(群車) 真拖曳/縮放都動不了', gHot.dragstart === 0 && !gHot.zoomChanged, `dragstart=${gHot.dragstart} z ${gHot.z0}→${gHot.z1}`);
await leaveAmbient();

// A9 安全網:ambient 已關但手勢被留在鎖住 ⇒ 下一幀必須自動交還
await page.evaluate(() => { map.dragging.disable(); map.touchZoom.disable(); });
await page.waitForTimeout(400);
ok('A9 安全網:非放空卻手勢鎖著 ⇒ tick 自動交還', (await handlers()).length === 6, `開著: ${(await handlers()).length}/6`);

// ── B 出口鈕 ──────────────────────────────────────────────────────────────────
await enterAmbient('follow');
await page.evaluate(() => { clearTimeout(state._idleT); clearTimeout(state._theaterT); document.body.classList.add('idle'); });
await page.waitForTimeout(900); // 等 .7s 的 opacity 轉場走完
const idleCss = await page.evaluate(() => {
  const g = s => { const el = document.querySelector(s); if (!el) return null; const c = getComputedStyle(el); return { op: +c.opacity, pe: c.pointerEvents }; };
  return { controls: g('.controls'), rand: g('#randBtn'), near: g('#nearBtn'), tabbar: g('.tabbar'), lc: g('.leaflet-control-container') };
});
ok('B1 idle 時「離開放空」仍看得見且可按',
  idleCss.controls && idleCss.controls.op > 0.2 && idleCss.controls.pe !== 'none',
  `opacity=${idleCss.controls?.op} pointer-events=${idleCss.controls?.pe}`);
// ★ 反向棘輪:其他家具的 idle 淡出必須原樣,證明沒把整條規則廢掉。
// #nearBtn 在網站版會被 remove()(LOCATE_ENABLED 為假,見 index.html 的「網站/PWA 沒有定位能力」),
// 所以判「在場的都必須仍淡出」而不是「四個都要在」;另配一條覆蓋率閘門,免得選擇器全壞掉時
// every() 對空集合恆真、這條變成沒有牙的假綠(心得 37d)。
const others = ['rand', 'near', 'tabbar', 'lc'];
const present = others.filter(k => idleCss[k]);
ok('B3 反向棘輪 其他家具 idle 仍淡出且不可點',
  present.every(k => idleCss[k].op === 0 && idleCss[k].pe === 'none'),
  `在場 ${present.join('/')} → ${JSON.stringify(present.map(k => idleCss[k]))}`);
ok('B3b 覆蓋率閘門 反向棘輪至少驗到 3 個家具', present.length >= 3, `在場 ${present.length}/4: ${present.join('/')}`);
// B2 真的按得到:命中測試 + 真按下去看有沒有離開放空
const hit = await page.evaluate(() => {
  const b = document.getElementById('ambientBtn'); const r = b.getBoundingClientRect();
  const at = (x, y) => { const el = document.elementFromPoint(x, y); return !!(el && (el === b || b.contains(el))); };
  return { h: r.height, mid: at(r.left + r.width / 2, r.top + r.height / 2),
           up: at(r.left + r.width / 2, r.top + r.height / 2 - 21), dn: at(r.left + r.width / 2, r.top + r.height / 2 + 21) };
});
ok('B2 idle 態下「離開放空」中心命中得到', hit.mid, JSON.stringify(hit));
ok('B5 觸控熱區上下 ±21px(≥44) 都命中同一顆鈕', hit.up && hit.dn, `鈕高=${hit.h} ${JSON.stringify(hit)}`);
await page.evaluate(() => document.getElementById('ambientBtn').click());
await page.waitForTimeout(400);
ok('B2b 按下去真的離開了放空', (await page.evaluate(() => !!state.ambient)) === false);

// ── C 音樂開關 ────────────────────────────────────────────────────────────────
const musicToggleOn = () => page.evaluate(() => {
  const tg = document.querySelector('#moreBody .ms-row[data-proxy="musicBtn"] .toggle');
  return tg ? tg.classList.contains('on') : null;
});
await page.evaluate(() => { document.getElementById('tabMore').click(); });
await page.waitForTimeout(300);
ok('C0 抽屜開得起來、音樂列在場', (await musicToggleOn()) !== null);
await page.evaluate(() => {
  state.music.enabled = false; state.music.audio._paused = true; state._syncMoreSheet();
});
await page.waitForTimeout(100);
await page.evaluate(() => document.querySelector('#moreBody .ms-row[data-proxy="musicBtn"]').click());
const immediate = await musicToggleOn();          // 同一個 tick 之後立刻讀
ok('C1 按下「背景音樂」當下開關就顯示開', immediate === true, `toggle=${immediate}`);
await page.waitForTimeout(500);                   // 原生事件(150ms)之後
ok('C2 原生事件回來後仍是開', (await musicToggleOn()) === true);
ok('C2b 原生層真的收到 play', (await page.evaluate(() => window.__na.plays)) > 0);
// 關掉:淡出 800ms 之後才會真 pause;全程【不碰】省電那一列
await page.evaluate(() => document.querySelector('#moreBody .ms-row[data-proxy="musicBtn"]').click());
await page.waitForTimeout(1600);
ok('C3 關掉後不必去點省電那列,開關自己變成關', (await musicToggleOn()) === false,
  `toggle=${await musicToggleOn()}`);

ok('Z 頁面零例外', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? ' — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);

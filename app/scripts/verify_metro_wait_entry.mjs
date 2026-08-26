// 捷運等車卡(Live Activity 手動入口,Task 6)JS 側驗證——Playwright 真引擎 + 本機靜態伺服器。
//
// 背景:原生 plugin(window.Capacitor.Plugins.RailMetroWait)由主對話並行實作,本檔只驗網頁側:
//   看板 h3「在這站等」鈕的出現條件、開卡 payload 組裝(北捷 eta 秒級 vs 高捷/機捷分鐘級,絕不混算)、
//   waitOpen 深連結接收。比照 scripts/verify_live_activity.mjs 的自架本機 HTTP server 模式——
//   同一台 server 同時吐 index.html/靜態檔與特判的 /api/* 回應,不用 page.route,外部資源
//   (CDN Leaflet)不受影響照樣走真網路。
//
// 判準三條自我約束(同 verify_live_activity.mjs):
//  (1) 斷言一律落在產品程式碼的行為上(記錄器收到的呼叫序列/DOM),不是腳本自己塞進去的 state。
//  (2) 每條斷言配一發瞄準它語意的突變(見檔尾),打在產品碼上不是打在 DOM/state。
//  (3) 凡「必須是 0／未被呼叫」型斷言一律配正向對照。
//
// G0 自檢(心得32):ROOT 由本檔自身路徑推導,不吃 --root/env;伺服器連接埠取 0(OS 指派)。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

const FIX = p => JSON.parse(readFileSync(path.join(ROOT, 'app/fixtures/metro', p), 'utf8'));
const trtcMainRaw = FIX('trtc-live.json');   // 台北車站等多線共站的實錄
const trtcYRaw = FIX('trtc-live-y.json');    // 環狀線實錄(brief 指定用「十四張」)
const krtcRaw = FIX('krtc-live.json');
const tymcRaw = FIX('tymc-live.json');

// trtc 板 eta/at 是絕對 epoch 秒的靜態快照(擷取於過去)——整批平移到「現在」附近,
// 保留列與列之間的相對秒差(離峰/離站順序不變),讓 trtcOfficialRowFresh 的 45 秒新鮮度窗通得過。
function freshenTrtc(raw, filterName) {
  const rows = (raw.board || []).filter(r => !filterName || r.name === filterName);
  if (!rows.length) return { board: [], src: 'trtc', trains: raw.trains || [] };
  const capturedAt = Math.max(...rows.map(r => Number(r.at)));
  const shift = Math.floor(Date.now() / 1000) - capturedAt + 3; // 落在擷取時刻之後 3 秒=現在附近
  // trains 原樣帶過(擁擠度 join 只讀 dest/cars,不讀時間欄——不需要平移)。
  return { board: rows.map(r => ({ ...r, eta: Number(r.eta) + shift, at: Number(r.at) + shift })), src: 'trtc', trains: raw.trains || [] };
}
// krtc/tymc 的 e 是相對分鐘,不受時間平移影響;只需把頂層 at 換成「現在」讓 dataAt 新鮮度過關。
function freshenLive(raw, excludeStation) {
  const rows = excludeStation ? raw.rows.filter(r => r.s !== excludeStation) : raw.rows;
  return { at: new Date().toISOString(), rows };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let trtcLiveOverride = null;      // null=預設空板；否則 {board,src}
const metroLiveOverride = {};     // sys → {at,rows}；缺項回空 rows
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/trtc-live') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(trtcLiveOverride || { board: [], src: 'trtc' }));
  }
  if (url.pathname === '/api/metro-live') {
    const sys = url.searchParams.get('sys');
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(metroLiveOverride[sys] || { at: new Date().toISOString(), rows: [] }));
  }
  // 高鐵班表主來源(同 verify_live_activity.mjs 既有踩坑筆記):空物件會讓 boot 卡死在 state.ready 之前。
  if (url.pathname === '/api/thsr-schedule') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
  }
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
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

// G0 第二半:證明「等一下瀏覽器抓到的」就是 ROOT 這棵樹的檔案。
{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  if (served !== INDEX_MD5) throw new Error(`[G0] 伺服器吐出的 index.html 與 ROOT 不同 served=${served} root=${INDEX_MD5}`);
  console.log('[G0] 伺服器 index.html 與 ROOT 逐 byte 相同');
}

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// 假橋接必須在頁面腳本執行「之前」就位:METRO_WAIT_ENABLED 相關判斷雖然是函式(每次重讀,見
// index.html metroWaitEnabled),但 addInitScript 仍是唯一乾淨的注入時機,不依賴此特性也一樣成立。
async function boot(browser, { withPlugin = true, startResult = { ok: true }, confirmResult = null,
  initialGroup = 'metro', viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ withPlugin, startResult, confirmResult }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} // 首訪教學卡先關,否則 elementFromPoint 全滅
    window.__confirmCalls = 0;
    if (confirmResult !== null) window.confirm = () => { window.__confirmCalls++; return confirmResult; };
    if (!withPlugin) return;
    window.__waitCalls = [];
    window.__waitListeners = {};
    window.__waitStartResult = startResult;
    const rec = (m, p) => {
      window.__waitCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null, t: Date.now() });
      if (m === 'start') return Promise.resolve(window.__waitStartResult);
      if (m === 'openLiveUpdateSettings') return Promise.resolve({ opened: true });
      return Promise.resolve({ ok: true });
    };
    window.__waitEmit = (ev, payload) => (window.__waitListeners[ev] || []).forEach(f => f(payload));
    window.Capacitor = { Plugins: { RailMetroWait: {
      start: p => rec('start', p),
      stop: () => rec('stop', null),
      openLiveUpdateSettings: () => rec('openLiveUpdateSettings', null),
      addListener: (ev, cb) => {
        (window.__waitListeners[ev] = window.__waitListeners[ev] || []).push(cb);
        return Promise.resolve({ remove: () => {} });
      },
    } } };
  }, { withPlugin, startResult, confirmResult });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  if (initialGroup) {
    await page.evaluate(gid => { const g = GROUPS.find(x => x.id === gid); if (g) selectGroup(g); }, initialGroup);
  }
  return { ctx, page, errors };
}

const calls = (page, m) => page.evaluate(mm => (window.__waitCalls || []).filter(c => !mm || c.m === mm), m);
const clearCalls = page => page.evaluate(() => { window.__waitCalls = []; });

// 2026-08-14 追蹤改版後,#boardWait 一律先開選單(時長 30/60/90 必經手,單方向也不例外)——
// 本套件的既有情境要的是「最快一班/開始追蹤」路徑:點鈕後選單出現就點 data-wait-choice="all"
// (多方向=最快一班鈕、單方向=開始追蹤鈕,同一個 data 值)。
// 選單自身的行為(方向過濾/時長/取消)由 verify_metro_wait_picker.mjs 專門驗,這裡不重複。
async function clickWaitThroughPicker(page) {
  await page.click('#boardWait');
  await page.waitForTimeout(200);
  const pickerOpen = await page.evaluate(() => {
    const m = document.getElementById('metroWaitPicker');
    return !!m && !m.hidden;
  });
  if (pickerOpen) {
    await page.click('#metroWaitPickerChoices .metro-wait-choice[data-wait-choice="all"]');
    await page.waitForTimeout(150);
  }
}

// pollTrtcLive() 內建 _trtcPolling 進行中鎖:每次 selectGroup 都會經 finishLoad() 觸發一次
// fire-and-forget 的自動輪詢,用「當時」的 trtcLiveOverride——常是我們還沒來得及設定新值前的
// 舊值(可能是上一個測試留下的別站資料,也可能是預設空板)。若我們緊接著手動呼叫 pollTrtcLive()
// 又剛好撞上那次自動輪詢還沒 resolve,鎖會讓我們這次呼叫直接 no-op。
// 這裡不能只驗「board.rows 非空」就判定落地成功——實測踩到:E 測試遺留的 trtcLiveOverride
// (台北車站 7 列)先被 F 自己 selectGroup 觸發的自動輪詢撈到,rows.length>0 一樣成立,但內容是
// 錯的(上一個測試的站),真正帶著十四張新資料的那次 pollTrtcLive() 根本還沒打出去,helper 就
// 誤判「已落地」提早返回。改為驗「board 裡真的有比對得到目標站名的列」(用 app 自己的
// trtcOfficialStationName 正規化比對,同一套去尾邏輯,含臺/台寬鬆),用「打一次→看目標站落地
// 了沒→沒有就再打」的有界重試,只等可觀察的內容結果,不等固定毫秒數、也不只等「非空」這種
// 可能被舊資料滿足的弱條件。
async function ensureTrtcBoardLanded(page, stationName, timeoutMs = 3000) {
  const hasStation = () => page.evaluate(name => {
    const b = state.trtcOfficialBoard;
    if (!b || !Array.isArray(b.rows)) return false;
    const key = trtcOfficialStationName(name);
    return b.rows.some(r => trtcOfficialStationName(r.name) === key);
  }, stationName);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await hasStation()) return true;
    await page.evaluate(() => pollTrtcLive());
    await page.waitForTimeout(80);
  }
  return hasStation();
}

// 開捷運分頁(state.lines,非官方板路徑要靠 state.lines 本身找站,不吃 __waitFindStation)裡某站的看板。
const openFreqStation = (page, name) => page.evaluate(n => {
  const key = n.replace(/臺/g, '台');
  for (const ln of state.lines) {
    for (const s of ln.stations || []) {
      if (s.name.replace(/臺/g, '台') === key) { openBoard({ name: s.name, lat: s.lat, lon: s.lon, sys: 'freq' }); return true; }
    }
  }
  return false;
}, name);
const openTraStation = page => page.evaluate(() => {
  const g = GROUPS.find(x => x.id === 'tra'); selectGroup(g);
  const st = state.schedStations.find(s => s.sys === 'tra_sched');
  if (!st) return false;
  openBoard(st);
  return true;
});

const cr = await chromium.launch();

// ══════════ A:web 模式(無 Capacitor mock)——北捷站看板無等車鈕(legacy 與 official 兩條路徑都要) ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: false });
  const openedA1 = await openFreqStation(page, '十四張'); // 此刻 trtc-live 未輪詢過,走 legacy renderFreqBoard
  await page.waitForTimeout(150);
  const hasBtnLegacy = await page.evaluate(() => !!document.getElementById('boardWait'));
  ok('A1 前置:開得了十四張站看板(legacy 路徑)', openedA1, '');
  ok('A1 web 模式 legacy 板無等車鈕', !hasBtnLegacy, `hasBtn=${hasBtnLegacy}`);
  // 切到官方板路徑再驗一次:證明兩個 render function 都被旗標擋住,不是只驗到其中一支。
  trtcLiveOverride = freshenTrtc(trtcYRaw);
  await ensureTrtcBoardLanded(page, '十四張');
  await page.waitForTimeout(150);
  const officialOn = await page.evaluate(() => document.getElementById('board') && document.getElementById('board').dataset.trtcOfficial === '1');
  const hasBtnOfficial = await page.evaluate(() => !!document.getElementById('boardWait'));
  ok('A2 前置:確實切到官方板路徑(dataset.trtcOfficial===1)', officialOn === true, `officialOn=${officialOn}`);
  ok('A2 web 模式官方板無等車鈕', !hasBtnOfficial, `hasBtn=${hasBtnOfficial}`);
  ok('A 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ B:注入 mock plugin——北捷站看板有等車鈕,且在 sticky h3 內 ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  trtcLiveOverride = freshenTrtc(trtcYRaw);
  await ensureTrtcBoardLanded(page, '十四張');
  await openFreqStation(page, '十四張');
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const btn = document.getElementById('boardWait');
    return { has: !!btn, inH3: !!(btn && btn.closest('h3')), text: btn ? btn.textContent.trim() : '' };
  });
  ok('B 等車鈕存在', info.has, JSON.stringify(info));
  ok('B 等車鈕在 sticky h3 內(v0717p 鐵則)', info.inH3, JSON.stringify(info));
  ok('B 初始文案為「追蹤這站」', info.text === '追蹤這站', `text=${info.text}`);
  ok('B 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ C:點鈕 → start payload 正確;同站再點 → stop;文案回「在這站等」 ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  trtcLiveOverride = freshenTrtc(trtcYRaw);
  await ensureTrtcBoardLanded(page, '十四張');
  await openFreqStation(page, '十四張');
  await page.waitForTimeout(150);
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  const st = await calls(page, 'start');
  ok('C 點鈕 → start 恰好 1 次', st.length === 1, `start=${st.length}`);
  const p = st[0] && st[0].p;
  ok('C payload.sys==="trtc"', !!p && p.sys === 'trtc', JSON.stringify(p));
  ok('C payload.station 非空', !!p && typeof p.station === 'string' && p.station.length > 0, JSON.stringify(p && p.station));
  ok('C payload.nextEta 為秒級 epoch(1.7e9~2.1e9)', !!p && p.nextEta > 1.7e9 && p.nextEta < 2.1e9, `nextEta=${p && p.nextEta}`);
  ok('C payload.nextMinutes===null(精度誠實鐵則)', !!p && p.nextMinutes === null, `nextMinutes=${p && p.nextMinutes}`);
  ok('C payload.nextDest 非空', !!p && typeof p.nextDest === 'string' && p.nextDest.length > 0, JSON.stringify(p && p.nextDest));
  ok('C payload.dataAt 為秒級 epoch', !!p && p.dataAt > 1.7e9 && p.dataAt < 2.1e9, `dataAt=${p && p.dataAt}`);
  ok('C payload.crowd===null(環狀線實錄 trains 無可 join 的 cars——負對照,不准造)', !!p && p.crowd === null, `crowd=${JSON.stringify(p && p.crowd)}`);
  ok('C payload.durationMin 不經時長段=預設 30', !!p && p.durationMin === 30, `durationMin=${p && p.durationMin}`);
  const btnAfterStart = await page.evaluate(() => document.getElementById('boardWait').textContent.trim());
  ok('C start 成功後文案變「結束追蹤」', btnAfterStart === '結束追蹤', `text=${btnAfterStart}`);
  await clearCalls(page);
  await page.click('#boardWait');
  await page.waitForTimeout(150);
  const sp = await calls(page, 'stop');
  ok('C 同站再點 → stop 恰好 1 次', sp.length === 1, `stop=${sp.length}`);
  const btnAfterStop = await page.evaluate(() => document.getElementById('boardWait').textContent.trim());
  ok('C stop 後文案回「追蹤這站」', btnAfterStop === '追蹤這站', `text=${btnAfterStop}`);
  // C2 正對照(08-14 擁擠度接通):同站同鈕,這次 override 帶兩個方向各一台有 cars 的車
  // (合成 harness 資料,只為打穿 join 路徑;實錄 Y 線 feed 本來就沒有 cars)。
  // 兩方向都給值 ⇒ 不必假設哪個方向先到,斷言綁「nextDest 對應的那台車的 cars 原值」。
  trtcLiveOverride = { ...freshenTrtc(trtcYRaw),
    trains: [{ no: '901', dest: '大坪林站', cars: [1, 2, 3, 2] },
             { no: '902', dest: '新北產業園區站', cars: [3, 3, 2, 1] }] };
  // pollTrtcLive 有 _trtcPolling 防重入鎖(見 ensureTrtcBoardLanded 的踩坑註解)——
  // 等「crowdByDest 真的落地」這個可觀察內容,不等固定毫秒數。
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => pollTrtcLive());
    await page.waitForTimeout(80);
    if (await page.evaluate(() => !!(state.trtcOfficialBoard && state.trtcOfficialBoard.crowdByDest
      && state.trtcOfficialBoard.crowdByDest['大坪林站']))) break;
  }
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  const st2 = await calls(page, 'start');
  const p2 = st2[0] && st2[0].p;
  const expCrowd = p2 && ({ '大坪林站': [1, 2, 3, 2], '新北產業園區站': [3, 3, 2, 1] })[p2.nextDest];
  ok('C2 正對照:payload.crowd 深等於 nextDest 對應車的 cars',
    !!p2 && JSON.stringify(p2.crowd) === JSON.stringify(expCrowd || null),
    `nextDest=${p2 && p2.nextDest} crowd=${JSON.stringify(p2 && p2.crowd)} exp=${JSON.stringify(expCrowd)}`);
  ok('C 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ D:高捷/機捷——分鐘級,nextEta 恆 null ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  metroLiveOverride.krtc = freshenLive(krtcRaw);
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '哈瑪星');
  await page.waitForTimeout(150);
  await clearCalls(page);
  const clicked = await page.evaluate(() => !!document.getElementById('boardWait'));
  if (clicked) await clickWaitThroughPicker(page);
  const st = await calls(page, 'start');
  ok('D-krtc 前置:鈕存在且點得到', clicked, '');
  ok('D-krtc start 恰好 1 次', st.length === 1, `start=${st.length}`);
  const p = st[0] && st[0].p;
  ok('D-krtc payload.sys==="krtc"', !!p && p.sys === 'krtc', JSON.stringify(p));
  ok('D-krtc payload.nextMinutes 為整數', !!p && Number.isInteger(p.nextMinutes), `nextMinutes=${p && p.nextMinutes}`);
  ok('D-krtc payload.nextEta===null(絕不把分鐘換算成 eta)', !!p && p.nextEta === null, `nextEta=${p && p.nextEta}`);
  ok('D-krtc payload.nextDest 非空', !!p && typeof p.nextDest === 'string' && p.nextDest.length > 0, JSON.stringify(p && p.nextDest));
  ok('D-krtc 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  metroLiveOverride.tymc = freshenLive(tymcRaw);
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '三重站');
  await page.waitForTimeout(150);
  await clearCalls(page);
  const clicked = await page.evaluate(() => !!document.getElementById('boardWait'));
  if (clicked) await clickWaitThroughPicker(page);
  const st = await calls(page, 'start');
  ok('D-tymc 前置:鈕存在且點得到', clicked, '');
  ok('D-tymc start 恰好 1 次', st.length === 1, `start=${st.length}`);
  const p = st[0] && st[0].p;
  ok('D-tymc payload.sys==="tymc"', !!p && p.sys === 'tymc', JSON.stringify(p));
  ok('D-tymc payload.nextMinutes 為整數', !!p && Number.isInteger(p.nextMinutes), `nextMinutes=${p && p.nextMinutes}`);
  ok('D-tymc payload.nextEta===null', !!p && p.nextEta === null, `nextEta=${p && p.nextEta}`);
  ok('D-tymc 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ E:waitOpen 深連結——開站看板＋start 被呼叫;站名帶「臺」變體也要通 ══════════
{
  // 刻意從 'tra' 群組開機(非 metro),同時驗到 metroWaitFindStation 的「目前池找不到 → 切群組再找」分支。
  const { ctx, page, errors } = await boot(cr, { withPlugin: true, initialGroup: 'tra' });
  trtcLiveOverride = freshenTrtc(trtcMainRaw, '台北車站');
  await page.evaluate(() => pollTrtcLive()); // 此刻尚未切到 metro 群組,pollTrtcLive 應該直接 no-op(pool 內無 trtc board line)
  await clearCalls(page);
  const before = await page.evaluate(() => state.group);
  await page.evaluate(() => window.__waitEmit('waitOpen', { sys: 'trtc', station: '臺北車站' })); // 深連結站名用「臺」變體
  await page.waitForTimeout(1600); // waitOpen handler 有 boot 穩定閘門(資料已載時 ≈600ms 落定),等待要蓋過它
  // waitOpen 處理器自己會 selectGroup('metro') 才找得到站,但 pollTrtcLive 只在剛才 tra 群組跑過一次
  // (那次因 pool 無 trtc line 而 no-op),trtcOfficialBoard 仍是空的——動 metro 群組後手動再補一次輪詢,
  // 讓 metroWaitStartFor 真的找得到官方列(否則只會 toast,不會呼叫 start,測不到 payload)。
  await page.evaluate(() => pollTrtcLive());
  await page.evaluate(() => window.__waitEmit('waitOpen', { sys: 'trtc', station: '臺北車站' }));
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => ({
    group: state.group,
    boardStationName: state.boardStation && state.boardStation.name,
    boardVisible: !document.getElementById('board').hidden,
  }));
  ok('E 前置:開機群組確實是 tra(非 metro)', before === 'tra', `before=${before}`);
  ok('E waitOpen 後群組切到 metro', after.group === 'metro', JSON.stringify(after));
  ok('E waitOpen 後開啟「台北車站」看板(寬鬆比對「臺」→「台」)', after.boardStationName === '台北車站' && after.boardVisible, JSON.stringify(after));
  const st = await calls(page, 'start');
  ok('E waitOpen 後 start 被呼叫(≥1)', st.length >= 1, `start=${st.length}`);
  ok('E start payload.sys==="trtc"', st.length >= 1 && st[st.length - 1].p.sys === 'trtc', JSON.stringify(st[st.length - 1] && st[st.length - 1].p));
  // E-crowd(08-14「小工具能顯示擠不擠,app 內也要能」):台北車站官方板——實錄 trains 只 join 得到
  // 板南線兩個終點(南港展覽館站 cars=[1,1,1,1,1,1]、亞東醫院站),淡水信義線各列必須沒有 bars。
  // 同一塊板上正負並存,證明「有資料才畫、沒資料不畫」不是全開或全關。
  const crowdDom = await page.evaluate(() => {
    const out = {};
    for (const row of document.querySelectorAll('#board .row[data-trtc-eta]')) {
      const b = row.querySelector('b');
      const c = row.querySelector('.crowd');
      const first = c && c.querySelector('i');
      out[b ? b.textContent.trim() : '?'] = {
        bars: c ? c.querySelectorAll('i').length : 0,
        color: first ? getComputedStyle(first).backgroundColor : null,
      };
    }
    return out;
  });
  const rowSp = crowdDom['往 南港展覽館站'], rowTamsui = crowdDom['往 淡水站'];
  ok('E-crowd 往南港展覽館站列有 6 格 bars(實錄 206 車 6 節)', !!rowSp && rowSp.bars === 6, JSON.stringify(crowdDom));
  ok('E-crowd bars 首格色=舒適綠 #4acc73(與小工具同色票)', !!rowSp && rowSp.color === 'rgb(74, 204, 115)', `color=${rowSp && rowSp.color}`);
  ok('E-crowd 往淡水站列 0 格(同板負對照:官方沒給就不畫)', !!rowTamsui && rowTamsui.bars === 0, JSON.stringify(rowTamsui));
  ok('E 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ F:反向——台鐵站看板無此鈕;環狀線站(十四張)有鈕且 payload.sys==="trtc" ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true, initialGroup: 'tra' });
  const openedTra = await openTraStation(page);
  await page.waitForTimeout(150);
  const traHasBtn = await page.evaluate(() => !!document.getElementById('boardWait'));
  ok('F 前置:開得了一個台鐵站看板', openedTra, '');
  ok('F 台鐵站看板無等車鈕', !traHasBtn, `hasBtn=${traHasBtn}`);
  await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'metro'); selectGroup(g); });
  trtcLiveOverride = freshenTrtc(trtcYRaw);
  await ensureTrtcBoardLanded(page, '十四張');
  await openFreqStation(page, '十四張');
  await page.waitForTimeout(150);
  const yHasBtn = await page.evaluate(() => !!document.getElementById('boardWait'));
  ok('F 環狀線站(十四張)有等車鈕', yHasBtn, `hasBtn=${yHasBtn}`);
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  const st = await calls(page, 'start');
  ok('F 環狀線站 payload.sys==="trtc"', st.length === 1 && st[0].p.sys === 'trtc', JSON.stringify(st[0] && st[0].p));
  ok('F 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ G:沒官方資料的捷運站——點鈕 toast,start 未被呼叫 ══════════
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  metroLiveOverride.krtc = freshenLive(krtcRaw, '小港'); // 過濾掉「小港」的列:站結構上仍屬 krtc(長鈕),但此刻無官方資料
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '小港');
  await page.waitForTimeout(150);
  const hasBtn = await page.evaluate(() => !!document.getElementById('boardWait'));
  ok('G 前置:沒資料的站鈕仍出現(結構性覆蓋,不看資料有無)', hasBtn, `hasBtn=${hasBtn}`);
  await clearCalls(page);
  const toastBefore = await page.evaluate(() => { const t = document.getElementById('toasts'); return t ? t.textContent : null; });
  await page.click('#boardWait');
  // metroWaitStartFor 對「拿不到官方列」有最多三輪「觸發輪詢→等 1.2s→重讀」的補救
  // (小工具深連結冷開 App 的真實情境),toast 最晚 ~4.5s 才出現,等待要蓋過整個重試窗。
  await page.waitForTimeout(5500);
  const toastAfter = await page.evaluate(() => { const t = document.getElementById('toasts'); return t ? t.textContent : null; });
  const st = await calls(page, 'start');
  ok('G 點鈕後出現 toast(文字改變)', toastAfter !== toastBefore && !!toastAfter && toastAfter.length > 0, `before=${JSON.stringify(toastBefore)} after=${JSON.stringify(toastAfter)}`);
  ok('G start 未被呼叫', st.length === 0, `start=${st.length}`);
  // 正向對照:同一顆按鈕、同一支記錄器,換一個有資料的站點下去真的記得到 start(證明上面的 0 不是按鈕本身失靈)。
  metroLiveOverride.krtc = freshenLive(krtcRaw);
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '哈瑪星');
  await page.waitForTimeout(150);
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  const st2 = await calls(page, 'start');
  ok('G 正向對照:有資料的站點鈕真的記到 start(≥1)', st2.length >= 1, `start=${st2.length}`);
  ok('G 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// (登記於 verify-release.mjs TOAST_REVIEWED 的兩個等車卡 toast 指紋,由本檔 H 組與 C/G 組實測覆蓋)
// ══════════ H:waitOpen 帶不存在的站名——不炸 boot、toast 說明、start 不被呼叫 ══════════
// (主對話驗收時補上:E 只驗 happy path,深連結站名對不回 web 站物件的防禦分支原本零覆蓋。
//  E 的 happy path 同時充當本組的正向對照:同一個 listener、同一支記錄器,好站名真的會 start。)
{
  const { ctx, page, errors } = await boot(cr, { withPlugin: true });
  await clearCalls(page);
  const toastBefore = await page.evaluate(() => { const t = document.getElementById('toasts'); return t ? t.textContent : null; });
  await page.evaluate(() => window.__waitEmit('waitOpen', { sys: 'trtc', station: '不存在的幽靈站' }));
  await page.waitForTimeout(1600); // 同上,蓋過 boot 穩定閘門
  const toastAfter = await page.evaluate(() => { const t = document.getElementById('toasts'); return t ? t.textContent : null; });
  const st = await calls(page, 'start');
  const alive = await page.evaluate(() => typeof state === 'object' && !!document.getElementById('board'));
  ok('H 幽靈站 waitOpen 後 toast 出現(文字改變且含站名)', toastAfter !== toastBefore && !!toastAfter && toastAfter.includes('幽靈站'), `after=${JSON.stringify(toastAfter)}`);
  ok('H 幽靈站 start 未被呼叫', st.length === 0, `start=${st.length}`);
  ok('H 頁面仍存活可查詢', alive === true, `alive=${alive}`);
  ok('H 無 JS 例外(listener 不炸 boot)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ I:Android 16 Live Update 未允許——明示同意才開系統設定，同一 session 只問一次 ══════════
{
  const startResult = { ok: true, endAt: Math.round(Date.now() / 1000) + 1800,
    liveUpdate: { supported: true, allowed: false, eligible: true, promoted: false } };
  const { ctx, page, errors } = await boot(cr, { withPlugin: true, startResult, confirmResult: true,
    viewport: { width: 390, height: 844 } });
  metroLiveOverride.krtc = freshenLive(krtcRaw);
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '哈瑪星');
  await page.waitForTimeout(150);
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  await page.waitForTimeout(250);
  const first = await calls(page, 'openLiveUpdateSettings');
  const confirmFirst = await page.evaluate(() => window.__confirmCalls);
  ok('I Android 16 未允許即時通知時會先詢問一次', confirmFirst === 1, `confirm=${confirmFirst}`);
  ok('I 使用者明示同意後才開系統即時通知設定', first.length === 1, `open=${first.length}`);

  // 直接再餵一次相同系統回應；判準落在產品的 session 防重旗標，不靠測試端改 state。
  await page.evaluate(live => metroWaitOfferLiveUpdateSettings(
    window.Capacitor.Plugins.RailMetroWait, live), startResult.liveUpdate);
  await page.waitForTimeout(100);
  const second = await calls(page, 'openLiveUpdateSettings');
  const confirmSecond = await page.evaluate(() => window.__confirmCalls);
  ok('I 同一 session 換站或重試不會重複追問', confirmSecond === 1 && second.length === 1,
    `confirm=${confirmSecond} open=${second.length}`);
  ok('I-允許路徑無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const startResult = { ok: true, endAt: Math.round(Date.now() / 1000) + 1800,
    liveUpdate: { supported: true, allowed: false, eligible: true, promoted: false } };
  const { ctx, page, errors } = await boot(cr, { withPlugin: true, startResult, confirmResult: false,
    viewport: { width: 390, height: 844 } });
  metroLiveOverride.krtc = freshenLive(krtcRaw);
  await page.evaluate(() => pollMetroLive());
  await openFreqStation(page, '哈瑪星');
  await page.waitForTimeout(150);
  await clearCalls(page);
  await clickWaitThroughPicker(page);
  await page.waitForTimeout(250);
  const opened = await calls(page, 'openLiveUpdateSettings');
  const confirms = await page.evaluate(() => window.__confirmCalls);
  ok('I-拒絕路徑仍有詢問，且不擅自打開設定', confirms === 1 && opened.length === 0,
    `confirm=${confirms} open=${opened.length}`);
  ok('I-拒絕路徑無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await cr.close();
await new Promise(r => server.close(r));

const passN = results.filter(r => r.pass).length;
const failN = results.length - passN;
console.log(`[total] PASS=${passN} FAIL=${failN}`);
if (failN > 0) {
  console.log('[FAILED]');
  for (const r of results) if (!r.pass) console.log(`  - ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  process.exitCode = 1;
}

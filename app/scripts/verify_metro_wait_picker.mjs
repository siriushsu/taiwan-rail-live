// 「在這站等」開卡前方向選單驗收——Playwright 真引擎 + 本機靜態伺服器。
// server/boot/fixture/G0 md5/__waitCalls 模式逐項比照 verify_metro_wait_entry.mjs；不改既有驗收腳本。
//
// 自我約束：
//   (1) 斷言只讀產品碼產生的 DOM 與 RailMetroWait.start 記錄，不把預期 state 塞回產品碼。
//   (2) 0 次呼叫／不彈選單都有同腳本正向對照。
//   (3) 每條 ok() 斷言都有檔尾一發產品碼突變與預期紅名單。
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
const trtcMainRaw = FIX('trtc-live.json');
const trtcYRaw = FIX('trtc-live-y.json');

// 過去擷取的 eta/at 整批平移到現在附近，保留原始列順序與相對秒差。
function freshenTrtc(raw, { station = null, dest = null } = {}) {
  const rows = (raw.board || []).filter(r => (!station || r.name === station) && (!dest || r.dest === dest));
  if (!rows.length) return { board: [], src: 'trtc', trains: raw.trains || [] };
  const capturedAt = Math.max(...rows.map(r => Number(r.at)));
  const shift = Math.floor(Date.now() / 1000) - capturedAt + 3;
  return {
    board: rows.map(r => ({ ...r, eta: Number(r.eta) + shift, at: Number(r.at) + shift })),
    src: 'trtc',
    trains: raw.trains || [],
  };
}

const taipeiDests = [...new Set((trtcMainRaw.board || []).filter(r => r.name === '台北車站').map(r => r.dest))];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let trtcLiveOverride = null;
const metroLiveOverride = {};
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

// G0：瀏覽器即將取得的 index.html 必須與腳本推導出的 ROOT 逐 byte 相同。
{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  if (served !== INDEX_MD5) throw new Error(`[G0] 伺服器吐出的 index.html 與 ROOT 不同 served=${served} root=${INDEX_MD5}`);
  console.log('[G0] 伺服器 index.html 與 ROOT 逐 byte 相同');
}

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function boot(browser, { initialGroup = 'metro', viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    window.__waitCalls = [];
    window.__waitListeners = {};
    const rec = (m, p) => {
      window.__waitCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null, t: Date.now() });
      return Promise.resolve({ ok: true });
    };
    window.__waitEmit = (ev, payload) => (window.__waitListeners[ev] || []).forEach(f => f(payload));
    window.Capacitor = { Plugins: { RailMetroWait: {
      start: p => rec('start', p),
      stop: () => rec('stop', null),
      addListener: (ev, cb) => {
        (window.__waitListeners[ev] = window.__waitListeners[ev] || []).push(cb);
        return Promise.resolve({ remove: () => {} });
      },
    } } };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  if (initialGroup) await page.evaluate(gid => { const g = GROUPS.find(x => x.id === gid); if (g) selectGroup(g); }, initialGroup);
  return { ctx, page, errors };
}

const calls = (page, m = null) => page.evaluate(mm => (window.__waitCalls || []).filter(c => !mm || c.m === mm), m);
const clearCalls = page => page.evaluate(() => { window.__waitCalls = []; });

// selectGroup() 會 fire-and-forget 輪詢，可能撞 _trtcPolling 鎖；只在目標站的官方列真的落地時返回。
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

const openFreqStation = (page, name) => page.evaluate(n => {
  const key = n.replace(/臺/g, '台');
  for (const ln of state.lines) for (const s of ln.stations || []) {
    if (s.name.replace(/臺/g, '台') === key) {
      openBoard({ name: s.name, lat: s.lat, lon: s.lon, sys: 'freq' });
      return true;
    }
  }
  return false;
}, name);

async function openTrtcFixtureStation(page, raw, stationFixtureName, stationUiName, dest = null) {
  trtcLiveOverride = freshenTrtc(raw, { station: stationFixtureName, dest });
  const landed = await ensureTrtcBoardLanded(page, stationUiName);
  const opened = await openFreqStation(page, stationUiName);
  await page.waitForTimeout(120);
  return { landed, opened };
}

async function waitForPicker(page) {
  await page.waitForFunction(() => {
    const m = document.getElementById('metroWaitPicker');
    return !!m && !m.hidden;
  }, null, { timeout: 3000 });
}

async function waitForStarts(page, count = 1) {
  await page.waitForFunction(n => (window.__waitCalls || []).filter(c => c.m === 'start').length >= n, count, { timeout: 4000 });
}

const cr = await chromium.launch();

// ══════════ A：台北車站 7 方向——body 層選單、方向列、預設高亮、像素可點、淡水 payload ══════════
{
  const { ctx, page, errors } = await boot(cr, { viewport: { width: 375, height: 667 } });
  const prep = await openTrtcFixtureStation(page, trtcMainRaw, '台北車站', '台北車站');
  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  const picker = await page.evaluate(expectedDests => {
    const modal = document.getElementById('metroWaitPicker');
    const buttons = [...document.querySelectorAll('#metroWaitPickerChoices .metro-wait-choice')];
    const directionButtons = buttons.slice(1);
    return {
      prepModal: !!modal,
      visible: !!modal && !modal.hidden,
      inBody: !!modal && modal.parentElement === document.body,
      optionCount: buttons.length,
      directionTexts: directionButtons.map(b => b.textContent.trim()),
      fastestText: buttons[0] && buttons[0].textContent.trim(),
      fastestOn: !!buttons[0] && buttons[0].classList.contains('on'),
      starts: (window.__waitCalls || []).filter(c => c.m === 'start').length,
      everyDestPresent: expectedDests.every(dest => directionButtons.some(b => b.textContent.startsWith('往' + dest + '——'))),
      tamsuiFormat: directionButtons.some(b => /^往淡水站——\d{2}:\d{2}$/.test(b.textContent.trim())),
    };
  }, taipeiDests);
  ok('A1 前置:fixture 落地且台北車站看板開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('A2 多方向手點會顯示選單', picker.prepModal && picker.visible, JSON.stringify(picker));
  ok('A3 選單直接掛在 body 層', picker.inBody, `inBody=${picker.inBody}`);
  ok('A4 選項數=7 方向+最快一班', taipeiDests.length === 7 && picker.optionCount === taipeiDests.length + 1, `fixtureDests=${taipeiDests.length} options=${picker.optionCount}`);
  ok('A5 各方向皆為「往dest——HH:MM」且最快一班預設高亮', picker.everyDestPresent && picker.tamsuiFormat && picker.fastestText === '最快一班（全部方向）' && picker.fastestOn, JSON.stringify(picker));
  ok('A6 尚未選方向前 start=0', picker.starts === 0, `start=${picker.starts}`);

  const hit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#metroWaitPickerChoices .metro-wait-choice')]
      .find(b => b.textContent.includes('往淡水站'));
    if (!btn) return { has: false, hit: null };
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const at = document.elementFromPoint(x, y);
    return { has: true, x, y, hit: at && (at.closest('.metro-wait-choice') === btn), tag: at && at.tagName };
  });
  ok('A7 選項中心 elementFromPoint 命中該選項', hit.has && hit.hit === true, JSON.stringify(hit));

  await page.getByRole('button', { name: /往淡水站/ }).click();
  await waitForStarts(page);
  const started = await calls(page, 'start');
  const payload = started[0] && started[0].p;
  ok('A8 點淡水方向後 start 恰 1 次', started.length === 1, `start=${started.length}`);
  ok('A9 淡水 payload 兩班不跨方向', !!payload && payload.nextDest === '淡水站' && (payload.secondDest === '淡水站' || payload.secondDest === null), JSON.stringify(payload));
  ok('A10 選方向後選單關閉', await page.evaluate(() => document.getElementById('metroWaitPicker').hidden === true), '');
  ok('A11 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ B：最快一班——與改動前「全方向排序後取前兩列」payload 逐欄相同 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const prep = await openTrtcFixtureStation(page, trtcMainRaw, '台北車站', '台北車站');
  const expected = await page.evaluate(() => {
    const bundle = metroWaitTrtcBundle(state.boardStation, state.lines, state.deco);
    const p = metroWaitPayload('trtc', state.boardStation, { rows: bundle.rows.slice(0, 2), dataAt: bundle.dataAt });
    p.durationMin = 30; // 追蹤改版:不動時長段=預設 30
    return p;
  });
  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  await page.getByRole('button', { name: /最快一班/ }).click();
  await waitForStarts(page);
  const started = await calls(page, 'start');
  const actual = started[0] && started[0].p;
  // key 是每次開卡現生的關聯 id(內含 Date.now()),用來把稍後才回來的 pushToken 認回這張卡;
  // 它【必然】每次都不同,而 expected 走的是 metroWaitPayload() 本體(不含 key)⇒ 逐欄比對前先剝掉,
  // 另立 B3b 專驗它的契約。不剝的話這條會變成「永遠紅」的假紅(判準綁在會漂移的量上)。
  const actualNoKey = actual ? (({ key, ...rest }) => rest)(actual) : actual;
  ok('B1 前置:fixture 落地且台北車站看板開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('B2 最快一班 start 恰 1 次', started.length === 1, `start=${started.length}`);
  ok('B3 最快一班 payload 與既有全方向前兩班逐欄相同(key 除外)', JSON.stringify(actualNoKey) === JSON.stringify(expected), `actual=${JSON.stringify(actualNoKey)} expected=${JSON.stringify(expected)}`);
  ok('B3b payload 帶 key,格式為 sys|station|dest|時戳(推播綁定要靠它認回這張卡;缺了就永遠綁不上)',
     !!actual && typeof actual.key === 'string' && new RegExp(`^trtc\\|台北車站\\|\\|\\d{13}$`).test(actual.key), `key=${actual && actual.key}`);
  ok('B4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ C：trtc-live-y 只留單一 dest——選單仍開(時長必經手),方向段落收起、單顆「開始追蹤」 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const prep = await openTrtcFixtureStation(page, trtcYRaw, '十四張站', '十四張', '大坪林站');
  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  const single = await page.evaluate(() => ({
    starts: (window.__waitCalls || []).filter(c => c.m === 'start').length,
    options: [...document.querySelectorAll('#metroWaitPickerChoices .metro-wait-choice')].map(b => b.textContent.trim()),
    secDirHidden: document.getElementById('metroWaitPickerSecDir').hidden,
    durDefault: [...document.querySelectorAll('#metroWaitDurs .metro-wait-dur')]
      .filter(b => b.classList.contains('on')).map(b => b.dataset.waitDur).join(','),
  }));
  ok('C1 前置:單方向 fixture 落地且十四張看板開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('C2 單方向站選單仍開:單顆「開始追蹤 往…」、方向段落隱藏、尚未 start', single.starts === 0 &&
    single.options.length === 1 && /^開始追蹤 往大坪林站/.test(single.options[0]) && single.secDirHidden === true,
    JSON.stringify(single));
  ok('C2b 時長段預設 30 高亮', single.durDefault === '30', `on=${single.durDefault}`);
  await page.click('#metroWaitPickerChoices .metro-wait-choice[data-wait-choice="all"]');
  await waitForStarts(page);
  const started = await calls(page, 'start');
  ok('C3 點「開始追蹤」後 start 恰 1 次且 nextDest 為唯一方向、durationMin=30',
    started.length === 1 && started[0].p.nextDest === '大坪林站' && started[0].p.durationMin === 30,
    JSON.stringify(started[0] && started[0].p));
  ok('C4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ D：waitOpen 深連結——多方向站也不彈選單、直接 start ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const prep = await openTrtcFixtureStation(page, trtcMainRaw, '台北車站', '台北車站');
  await clearCalls(page);
  await page.evaluate(() => window.__waitEmit('waitOpen', { sys: 'trtc', station: '台北車站' }));
  await waitForStarts(page);
  const started = await calls(page, 'start');
  const stateAfter = await page.evaluate(() => ({
    pickerHidden: document.getElementById('metroWaitPicker').hidden,
    board: state.boardStation && state.boardStation.name,
  }));
  ok('D1 前置:多方向 fixture 落地且台北車站可開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('D2 waitOpen 多方向站不彈選單並直接 start 恰 1 次', stateAfter.pickerHidden && started.length === 1, `state=${JSON.stringify(stateAfter)} start=${started.length}`);
  ok('D2b waitOpen 不經選單 durationMin=預設 30', started[0] && started[0].p.durationMin === 30, `durationMin=${started[0] && started[0].p.durationMin}`);
  ok('D3 waitOpen 仍開啟台北車站看板', stateAfter.board === '台北車站', JSON.stringify(stateAfter));
  ok('D4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ E：取消不開卡、鈕文案不變；同情境再選最快一班作正向對照 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const prep = await openTrtcFixtureStation(page, trtcMainRaw, '台北車站', '台北車站');
  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  await page.click('#metroWaitPickerCancel');
  await page.waitForTimeout(100);
  const cancelled = await page.evaluate(() => ({
    starts: (window.__waitCalls || []).filter(c => c.m === 'start').length,
    hidden: document.getElementById('metroWaitPicker').hidden,
    buttonText: document.getElementById('boardWait').textContent.trim(),
  }));
  ok('E1 前置:多方向 fixture 落地且台北車站看板開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('E2 取消後選單關閉、start=0、鈕文案不變', cancelled.hidden && cancelled.starts === 0 && cancelled.buttonText === '追蹤這站', JSON.stringify(cancelled));

  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  await page.getByRole('button', { name: /最快一班/ }).click();
  await waitForStarts(page);
  const positive = await calls(page, 'start');
  ok('E3 正向對照:同站同鈕選最快一班會 start 恰 1 次', positive.length === 1, `start=${positive.length}`);
  ok('E4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ F：時長段(08-14 追蹤改版)——點 60 換高亮、選方向後 payload 帶 60;重開選單回預設 30 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const prep = await openTrtcFixtureStation(page, trtcMainRaw, '台北車站', '台北車站');
  await clearCalls(page);
  await page.click('#boardWait');
  await waitForPicker(page);
  await page.click('#metroWaitDurs .metro-wait-dur[data-wait-dur="60"]');
  const durState = await page.evaluate(() => ({
    on: [...document.querySelectorAll('#metroWaitDurs .metro-wait-dur')]
      .filter(b => b.classList.contains('on')).map(b => b.dataset.waitDur).join(','),
    pickerStillOpen: !document.getElementById('metroWaitPicker').hidden,
  }));
  ok('F1 前置:多方向 fixture 落地且台北車站看板開啟', prep.landed && prep.opened, JSON.stringify(prep));
  ok('F2 點 60 分鐘:高亮唯一移到 60、選單不關', durState.on === '60' && durState.pickerStillOpen, JSON.stringify(durState));
  await page.getByRole('button', { name: /最快一班/ }).click();
  await waitForStarts(page);
  const started = await calls(page, 'start');
  ok('F3 選最快一班後 payload.durationMin=60', started.length === 1 && started[0].p.durationMin === 60, JSON.stringify(started[0] && started[0].p && { durationMin: started[0].p.durationMin }));
  // 重開選單:時長回預設 30(上一次的 60 不沿用)。F3 後鈕是「結束追蹤」(再點=stop 不開單),先收卡。
  await page.evaluate(() => metroWaitStop());
  await page.waitForTimeout(120);
  await page.click('#boardWait');
  await waitForPicker(page);
  const reopened = await page.evaluate(() => [...document.querySelectorAll('#metroWaitDurs .metro-wait-dur')]
    .filter(b => b.classList.contains('on')).map(b => b.dataset.waitDur).join(','));
  ok('F4 重開選單時長回預設 30', reopened === '30', `on=${reopened}`);
  ok('F5 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
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

// ══════════ 突變清單(逐條 ok 對應；突變打產品碼 index.html，預期紅名單如下) ══════════
// M01 A1：pollTrtcLive 成功回應後略過 state.trtcOfficialBoard 落地       → A1。
// M02 A2：metroWaitStartFromBoard 無條件直接 metroWaitStartFor          → A2。
// M03 A3：把 #metroWaitPicker 搬進 .stage                              → A3。
// M04 A4：metroWaitOpenPicker 的 directions.map 改成 slice(1).map       → A4。
// M05 A5：刪掉 fastest 的 on class，並把方向時間 span 改成空字串         → A5。
// M06 A6：metroWaitOpenPicker 前先呼叫 metroWaitStartFor                 → A6。
// M07 A7：.metro-wait-picker 設 pointer-events:none                      → A7。
// M08 A8：方向選項 click handler 呼叫 metroWaitStartFor 兩次             → A8。
// M09 A9：metroWaitStartFor 指定 dest 時跳過 filter                      → A9。
// M10 A10：方向選項 click handler 刪掉 metroWaitClosePicker               → A10。
// M11 A11：淡水選項 start 後 queueMicrotask(() => { throw Error('mut-A') }) → A11。
// M12 B1：pollTrtcLive 成功回應後略過 state.trtcOfficialBoard 落地        → B1。
// M13 B2：最快一班 click handler return                                  → B2。
// M14 B3：最快一班分支改送 directions[0].dest                            → B3。
// M14b B3b：metroWaitStartFor 組 payload 時不塞 key（推播綁定認不回卡）    → B3b。
// M15 B4：最快一班分支 start 後 queueMicrotask(() => { throw Error('mut-B') }) → B4。
// M16 C1：pollTrtcLive 成功回應後略過 state.trtcOfficialBoard 落地        → C1。
// M17 C2：metroWaitOpenPicker 的 multi 判定改恆 true(單方向也畫方向列)    → C2。
// M18 C3：單方向分支的 data-wait-choice 改成 '0'(all 路徑斷線)            → C3(waitForStarts 逾時)。
// M19 C4：單方向 start 後 queueMicrotask(() => { throw Error('mut-C') })    → C4。
// M28 C2b/F4：metroWaitOpenPicker 不重設 durationMin/高亮(沿用上次)       → F4(先跑 F3 選 60);C2b 單跑不紅,故 F4 是主判準。
// M29 F2：durs.onclick 不換高亮只改 draft                                 → F2。
// M30 F3：metroWaitStartFor 忽略 durationMin 參數恆送 30                   → F3。
// M20 D1：pollTrtcLive 成功回應後略過 state.trtcOfficialBoard 落地        → D1。
// M21 D2：ensureMetroWaitListener 改呼叫 metroWaitStartFromBoard           → D2。
// M22 D3：ensureMetroWaitListener 刪掉 openBoard(st)                       → D3。
// M23 D4：waitOpen start 後 queueMicrotask(() => { throw Error('mut-D') })  → D4。
// M24 E1：pollTrtcLive 成功回應後略過 state.trtcOfficialBoard 落地        → E1。
// M25 E2：#metroWaitPickerCancel.onclick 改為選 fastest                    → E2。
// M26 E3：最快一班 click handler return                                  → E3。
// M27 E4：取消先 close、再 queueMicrotask(() => { throw Error('mut-E') })  → E4。

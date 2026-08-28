// 台鐵等站卡的前端驗收——Playwright 真引擎（chromium + webkit）＋本機靜態伺服器。
// server/boot/G0 md5 的骨架比照 verify_metro_wait_picker.mjs，不改既有驗收腳本。
//
// 自我約束：
//   (1) 斷言只讀產品碼產生的 DOM 與 RailTraWait.start／bind 的實際 payload，
//       不把預期 state 塞回產品碼。
//   (2) 誤點值走【真的資料路徑】（伺服器吐 /api/tra-live → pollLive() → state.live），
//       不用 page.evaluate 直接塞 state.live——注入的東西會被頁面自己的輪詢洗掉，
//       而且那樣驗到的不是產品真正會走的那條路（memory: verify-fixture-stub-drift）。
//   (3) 期望值一律在 Node 這側獨立算（Intl.DateTimeFormat），不呼叫 index.html 的 fmtHM——
//       判準與實作同源時，兩邊一起改壞會集體全綠（judgment 心得 29）。
//   (4) 每一條「不可以有」都配一條正向對照（0 次呼叫、空清單也會通過的斷言不算判準）。
//
// 🔴 時鐘固定：頁面的 Date 被平移到【今天的 08:20（台北）】。理由是「接下來 3 小時有誰來」
//    這種看板在深夜是空的 ⇒ 不固定時鐘的話，同一支腳本白天綠、半夜紅，而紅的原因是環境
//    不是產品（judgment 心得 34）。平移只動時刻不動日期，班表窗（14 天逐日）仍然命中。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

// ── 固定時鐘 ────────────────────────────────────────────────────────────────
const TARGET_HHMM = [8, 20];
const hhmmTaipei = ms => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(ms));
const taipeiSecOfDay = ms => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const g = t => Number(p.find(x => x.type === t).value);
  return g('hour') * 3600 + g('minute') * 60 + g('second');
};
const CLOCK_SHIFT_MS = ((TARGET_HHMM[0] * 3600 + TARGET_HHMM[1] * 60) - taipeiSecOfDay(Date.now())) * 1000;
const fakeNow = () => Date.now() + CLOCK_SHIFT_MS;
console.log(`[G0] 頁面時鐘平移 ${Math.round(CLOCK_SHIFT_MS / 60000)} 分 ⇒ ${hhmmTaipei(fakeNow())}（台北）`);

// ── 伺服器 ──────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let traLiveOverride = { at: new Date(fakeNow()).toISOString(), srv: fakeNow(), trains: [] };
let bindCalls = [];
const readBody = req => new Promise(res => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => res(b));
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/tra-live') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(traLiveOverride));
  }
  if (url.pathname === '/api/tra-wait/bind' || url.pathname === '/api/tra-wait/unbind') {
    const body = await readBody(req);
    let parsed = null; try { parsed = JSON.parse(body); } catch (e) {}
    bindCalls.push({ kind: url.pathname.endsWith('bind') && !url.pathname.endsWith('unbind') ? 'bind' : 'unbind', body: parsed });
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end('{"ok":true}');
  }
  if (url.pathname === '/api/thsr-schedule') {
    // 🔴 這一支不能用萬用 {} 打發:boot 會對它的 trains 做 for...of ⇒ 整個 boot 靜默拋錯、
    //    state.ready 永遠不成立（症狀只有 waitForFunction 逾時，看不出原因）。
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

{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  if (served !== INDEX_MD5) throw new Error(`[G0] 伺服器吐出的 index.html 與 ROOT 不同 served=${served} root=${INDEX_MD5}`);
  console.log('[G0] 伺服器 index.html 與 ROOT 逐 byte 相同');
}

const results = [];
// 兩個引擎各自量到的 pill 高度。壞掉的那次就是【同一份 CSS 兩邊算出不同盒高】——
// 單引擎跑完全綠時這件事沒有任何判準看得到。
const pillHeights = {};
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function boot(browser, { viewport = { width: 1280, height: 900 }, withPlugin = true } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ shift, plugin }) => {
    // 時鐘平移：Date.now 與零參數 new Date() 都要蓋，否則兩者會對不上（產品碼兩種都在用）。
    const Real = Date, rawNow = Date.now.bind(Date);
    const shifted = () => rawNow() + shift;
    const Patched = new Proxy(Real, {
      construct: (target, args) => (args.length ? new target(...args) : new target(shifted())),
    });
    Patched.now = shifted;
    window.Date = Patched;
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    window.__twCalls = [];
    window.__twListeners = {};
    window.__twStartResult = { ok: true, id: 'act-1', endAt: 0 };
    window.__twStatus = { active: false };
    window.__twEmit = (ev, payload) => (window.__twListeners[ev] || []).forEach(f => f(payload));
    const rec = (m, p) => {
      window.__twCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null });
      if (m === 'start') {
        // endAt 照原生那條算式回（實際約到站 + 30 分，下限 10 分、上限 3.5 小時）——
        // bind 送上去的必須是【原生回的這個值】，替身若自己亂回一個，T9 那條就驗不到東西。
        const eta = Number(p.schedSec) + (Number(p.delayMin) || 0) * 60;
        const now = Date.now() / 1000;
        const endAt = Math.min(Math.max(eta + 1800, now + 600), now + 3.5 * 3600);
        return Promise.resolve({ ...window.__twStartResult, endAt });
      }
      if (m === 'status') return Promise.resolve(window.__twStatus);
      return Promise.resolve({ ok: true });
    };
    const railTraWait = {
      start: p => rec('start', p),
      stop: () => rec('stop', null),
      status: () => rec('status', null),
      addListener: (ev, cb) => {
        (window.__twListeners[ev] = window.__twListeners[ev] || []).push(cb);
        return Promise.resolve({ remove: () => {} });
      },
    };
    window.Capacitor = { Plugins: plugin ? { RailTraWait: railTraWait } : {} };
  }, { shift: CLOCK_SHIFT_MS, plugin: withPlugin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000 });
  await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'tra'); if (g) selectGroup(g); });
  await page.waitForFunction(() => Array.isArray(state.trains) && state.trains.length > 0, null, { timeout: 60000 });
  return { ctx, page, errors };
}

// 站名 → 開台鐵看板。回傳實際用到的站物件摘要（sys 必須是 tra_sched，否則 renderBoard 會走別條路）。
// 🔴 不可以走 state.lines——sched 群組它恆空（index.html 自己的註解就寫著）。
//    看板靠 name+sys 過濾班次，必須用 state.schedStations 裡的【活體站物件】
//    （這也正是 index.html 自己開最愛車站看板時取站的路徑，line 14420）。
const openTraStation = (page, name) => page.evaluate(n => {
  const s = (state.schedStations || []).find(x => x.name === n && x.sys === 'tra_sched');
  if (!s) return null;
  openBoard(s);
  return { name: s.name, sys: s.sys };
}, name);

const rowsOf = page => page.evaluate(() => {
  const el = document.getElementById('board');
  return (el && el._traWaitRows || []).map(r => ({
    no: String(r.tr.train), off: !!r.off, dtm: r.dtm, dl: r.dl, t: r.t,
    typeName: r.tr.typeName, dest: r.dest,
  }));
});
const calls = (page, m = null) => page.evaluate(mm => (window.__twCalls || []).filter(c => !mm || c.m === mm), m);
const clearCalls = page => page.evaluate(() => { window.__twCalls = []; });

async function run(engineName, browser) {
  const tag = s => `[${engineName}] ${s}`;
  // ══════════ A：pill 出現條件 ══════════
  const { ctx, page, errors } = await boot(browser);
  const st = await openTraStation(page, '板橋');
  ok(tag('A1 台鐵站看板開得起來且 sys=tra_sched'), !!st && st.sys === 'tra_sched', JSON.stringify(st));
  const pill = await page.evaluate(() => {
    const b = document.getElementById('boardTraWait');
    if (!b) return null;
    const h3 = b.closest('h3');
    return { text: b.textContent.trim(), inH3: !!h3, on: b.classList.contains('on') };
  });
  ok(tag('A2 pill 出現在 sticky h3 內、文案為「追蹤一班車」'),
    !!pill && pill.inH3 && pill.text === '追蹤一班車' && !pill.on, JSON.stringify(pill));

  // ══════════ B：候選清單（來自真的 rows） ══════════
  const rows = await rowsOf(page);
  ok(tag('B1 看板 rows 有東西（時鐘已固定在 08:20，深夜空板不會發生）'), rows.length > 0, `rows=${rows.length}`);
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  const picker = await page.evaluate(() => {
    const modal = document.getElementById('traWaitPicker');
    const btns = [...document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice')];
    return {
      inBody: modal.parentElement === document.body,
      count: btns.length,
      times: btns.map(b => b.querySelector('.tra-wait-choice-time').textContent.trim()),
      nos: btns.map(b => b.querySelector('.tra-wait-choice-no').textContent.trim()),
      subs: btns.map(b => b.querySelector('.tra-wait-choice-sub').textContent.trim()),
      delays: btns.map(b => b.querySelector('.tra-wait-choice-delay').textContent.trim()),
      delayCls: btns.map(b => [...b.querySelector('.tra-wait-choice-delay').classList].filter(c => c !== 'tra-wait-choice-delay')),
      starts: (window.__twCalls || []).filter(c => c.m === 'start').length,
    };
  });
  ok(tag('B2 選單掛在 body 層（.stage 會把 z-index 封頂）'), picker.inBody, `inBody=${picker.inBody}`);
  ok(tag('B3 候選 1–8 班且不超過看板 rows 數'),
    picker.count > 0 && picker.count <= 8 && picker.count <= rows.filter(r => !r.off).length,
    `count=${picker.count} rows=${rows.length}`);
  ok(tag('B4 每一列都是「HH:mm ＋ 車種車次 ＋ 往終點」'),
    picker.times.every(t => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) &&
    picker.nos.every(n => n.length > 0) &&
    picker.subs.every(x => /^(往 .+|（終點到達）)$/.test(x)),
    JSON.stringify({ t: picker.times[0], n: picker.nos[0], s: picker.subs[0] }));
  ok(tag('B5 尚未選車之前 start=0（選單只是選單）'), picker.starts === 0, `start=${picker.starts}`);
  // 🔴 停駛車不可入選。今天官方零停駛 ⇒ 分母是空的、這條會【無條件通過】
  //    （突變測試會誠實地告訴你「這條沒有判準看得到」）。所以先注入一班真的停駛車：
  //    複製一班已經在窗內的車、改車次、標 _cancelled——走的是 renderBoard 自己那條
  //    `state.traCancelled` 併池的路徑，不是把預期塞回產品碼。
  await page.evaluate(() => traWaitClosePicker());
  const offNo = await page.evaluate(() => {
    const el = document.getElementById('board');
    const src = (el._traWaitRows || []).find(r => !r.off && r.tr);
    if (!src) return null;
    const clone = Object.assign(Object.create(Object.getPrototypeOf(src.tr)), src.tr,
      { train: '9990', _cancelled: true });
    state.traCancelled = [clone];
    renderBoard();
    return '9990';
  });
  const rows2 = await rowsOf(page);
  ok(tag('B6a 注入的停駛車真的上了看板並被標成 off（B6 的分母）'),
    !!offNo && rows2.some(r => r.no === offNo && r.off), `off 列=${rows2.filter(r => r.off).map(r => r.no).join(',') || '(無)'}`);
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  const nos2 = await page.evaluate(() => [...document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice-no')].map(e => e.textContent.trim()));
  ok(tag('B6 官方停駛的車不在候選裡'),
    nos2.length > 0 && !nos2.some(n => n.endsWith(' ' + offNo)),
    `候選=${nos2.length} 班，停駛的 ${offNo} ${nos2.some(n => n.endsWith(' ' + offNo)) ? '竟然在裡面' : '不在裡面'}`);
  await page.evaluate(() => { state.traCancelled = []; renderBoard(); });

  // ══════════ C：誤點來自 state.live.map 原值（走真的資料路徑） ══════════
  await page.evaluate(() => traWaitClosePicker());
  const target = (await rowsOf(page)).filter(r => !r.off)[0];
  // 這一班給 7 分誤點、另外挑一班【不放進 feed】當反向對照。
  const other = (await rowsOf(page)).filter(r => !r.off && r.no !== target.no)[0];
  traLiveOverride = {
    at: new Date(fakeNow() - 30000).toISOString(), srv: fakeNow(),
    trains: [{ no: target.no, delay: 7, sta: '', status: 0 }],
  };
  await page.evaluate(() => pollLive());
  await page.waitForFunction(no => !!(state.live && state.live.map && state.live.map.has(no)), target.no, { timeout: 5000 });
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  const chips = await page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice')) {
      const no = b.querySelector('.tra-wait-choice-no').textContent.trim().split(/\s+/).pop();
      out[no] = { text: b.querySelector('.tra-wait-choice-delay').textContent.trim(),
        cls: [...b.querySelector('.tra-wait-choice-delay').classList].filter(c => c !== 'tra-wait-choice-delay')[0] };
    }
    return out;
  });
  ok(tag('C1 官方誤點 7 分照抄（不是 easedShift 的漸變值）'),
    chips[target.no] && chips[target.no].text === '誤點 7 分' && chips[target.no].cls === 'late',
    JSON.stringify(chips[target.no]));
  // 🔴 反向對照：不在 feed 裡的車必須是「誤點未知」，絕不可以是「準點」——
  //    後者是宣稱一個官方沒說過的事實。
  ok(tag('C2 不在官方動態窗裡的車寫「誤點未知」，不是「準點」'),
    !other || (chips[other.no] && chips[other.no].text === '誤點未知' && chips[other.no].cls === 'unknown'),
    other ? JSON.stringify({ no: other.no, ...chips[other.no] }) : '(只有一班候選，這條無對照)');
  ok(tag('C2b 上面那條有真的對照到另一班車'), !!other, other ? `other=${other.no}` : '沒有第二班可對照');

  // ══════════ D：開卡 payload（精度紅線） ══════════
  // 🔴 D0 是 D2 的前提。schedEpoch 的算式是「dtm 減回 dl×60」——dl 是 easedShift 過的漸變值,
  //    它從 0 爬向官方值。dl 還停在 0 的那一瞬間,「有沒有減回去」【算出來一模一樣】⇒
  //    D2 對這條算式恆真、而突變測試會誤報「這條沒有判準看得到」。
  //    先等它追上官方的 7 分,再往下驗（judgment 心得 17:前置條件要先做出來並斷言）。
  let conv = null;
  for (let i = 0; i < 60; i++) {
    conv = (await rowsOf(page)).find(r => r.no === target.no);
    if (conv && Math.abs(conv.dl - 7) < 0.05) break;
    await page.waitForTimeout(100);
  }
  ok(tag('D0 看板那一列的誤點已經追上官方的 7 分（D2 的前提）'),
    !!conv && Math.abs(conv.dl - 7) < 0.05, `dl=${conv && conv.dl}`);
  await clearCalls(page);
  bindCalls = [];
  // 選單是在 dl 還沒收斂時畫的 ⇒ 重畫一次,讓按下去的那一列與 D0 量到的是同一份 rows。
  await page.evaluate(() => traWaitClosePicker());
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  const shownHM = await page.evaluate(no => {
    const btn = [...document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice')]
      .find(b => b.querySelector('.tra-wait-choice-no').textContent.trim().endsWith(' ' + no));
    if (!btn) return null;
    const t = btn.querySelector('.tra-wait-choice-time').textContent.trim();
    btn.click();
    return t;
  }, target.no);
  await page.waitForFunction(() => (window.__twCalls || []).some(c => c.m === 'start'), null, { timeout: 6000 });
  const startCalls = await calls(page, 'start');
  const pl = startCalls[0] && startCalls[0].p;
  ok(tag('D1 恰好呼叫一次 start'), startCalls.length === 1, `start=${startCalls.length}`);
  // 🔴 期望值取【選單上印給使用者看的那個時刻】——它來自 rows 的 r.t，與 schedEpoch 走的
  //    dtm／dl 是兩個不同的欄位。拿 dtm−dl×60 當期望就是把實作的算式抄第二遍,
  //    兩邊一起改壞會集體全綠（judgment 心得 29）。使用者驗收時看的也正是這兩個數字一不一致。
  ok(tag('D2 schedSec 換回台北鐘面＝選單上印出來的表定時刻'),
    !!pl && !!shownHM && hhmmTaipei(pl.schedSec * 1000) === shownHM,
    pl ? `schedSec=${pl.schedSec} → ${hhmmTaipei(pl.schedSec * 1000)}，選單印的是 ${shownHM}` : 'no payload');
  // 第二條防線:它必須落在【未來】而且是整分——誤點被加進去時這兩條也還是綠的,
  // 所以它只是輔助,真正有牙的是上面那條。
  ok(tag('D2b schedSec 是絕對 epoch 秒（不是當日秒數）且落在合理窗內'),
    !!pl && pl.schedSec > 1.7e9 && pl.schedSec > fakeNow() / 1000 - 600 &&
    pl.schedSec < fakeNow() / 1000 + 4 * 3600,
    pl ? `schedSec=${pl.schedSec}` : 'no payload');
  ok(tag('D3 delayMin 是官方原值 7、dataAt 是資料自己的時戳'),
    !!pl && pl.delayMin === 7 && Math.abs(pl.dataAt - Math.floor(Date.parse(traLiveOverride.at) / 1000)) <= 1,
    pl ? `delayMin=${pl.delayMin} dataAt=${pl.dataAt}` : 'no payload');
  ok(tag('D4 站名／車次／車種／終點都帶齊'),
    !!pl && pl.station === '板橋' && pl.trainNo === target.no && !!pl.trainType && !!pl.dest,
    JSON.stringify(pl && { station: pl.station, trainNo: pl.trainNo, trainType: pl.trainType, dest: pl.dest }));
  // 🔴 精度反向對照（派工原話：卡片渲染輸出絕不出現 mm:ss 倒數形式）。
  //    payload 是卡片文字的唯一原料 ⇒ 這裡先擋一次：不可以有任何「秒數／倒數」欄位，
  //    也不可以有任何字串值長得像 m:ss。
  const badKeys = pl ? Object.keys(pl).filter(k => /sec(onds)?left|countdown|eta|remain|until|duration/i.test(k)) : ['no payload'];
  ok(tag('D5 payload 沒有任何倒數／剩餘秒數欄位'), badKeys.length === 0, `keys=${Object.keys(pl || {}).join(',')}`);
  const badVals = pl ? Object.entries(pl).filter(([, v]) => typeof v === 'string' && /\d+:\d{2}/.test(v)).map(([k]) => k) : ['no payload'];
  ok(tag('D6 payload 沒有任何 mm:ss 形狀的字串值'), badVals.length === 0, `bad=${badVals.join(',') || '(無)'}`);
  ok(tag('D6b 上面兩條真的掃到了東西（正向對照）'),
    !!pl && Object.keys(pl).length >= 6, `keys=${Object.keys(pl || {}).length}`);
  ok(tag('D7 pill 翻成「結束追蹤」'),
    await page.evaluate(() => { const b = document.getElementById('boardTraWait'); return !!b && b.textContent.trim() === '結束追蹤' && b.classList.contains('on'); }));

  // ══════════ E：交班 bind ══════════
  await page.evaluate(() => {
    const c = (window.__twCalls || []).find(x => x.m === 'start');
    window.__twEmit('traWaitPushToken', { token: 'deadbeef', key: c.p.key });
  });
  await page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !bindCalls.some(c => c.kind === 'bind'); i++) await page.waitForTimeout(50);
  const bind = bindCalls.find(c => c.kind === 'bind');
  ok(tag('E1 token 回來後有交班'), !!bind, JSON.stringify(bind && bind.body));
  // 🔴「兩邊必須是同一個數」：bind 送的 schedSec 與 endAt 必須逐字等於原生回的那一組，
  //    自己重算會與卡片上印著的數字漂開。
  const startRes = await page.evaluate(() => state.traWait);
  ok(tag('E2 bind 的 schedSec/endAt＝開卡當下那一組（不是重算的）'),
    !!bind && bind.body.schedSec === pl.schedSec && bind.body.endAt === startRes.endAt,
    JSON.stringify({ bind: bind && bind.body, state: startRes }));
  ok(tag('E3 bind 帶了 station 與 trainNo'),
    !!bind && bind.body.station === '板橋' && bind.body.trainNo === target.no);
  // 反向對照：key 對不上的 token 不可以交上去。
  const before = bindCalls.filter(c => c.kind === 'bind').length;
  await page.evaluate(() => window.__twEmit('traWaitPushToken', { token: 'cafebabe', key: 'not-my-key' }));
  await page.waitForTimeout(250);
  ok(tag('E4 key 對不上的 token 不會交班（反向對照）'),
    bindCalls.filter(c => c.kind === 'bind').length === before,
    `bind ${before} → ${bindCalls.filter(c => c.kind === 'bind').length}`);

  // ══════════ F：互斥 ══════════
  // 🔴 F1 走【真的開卡路徑】（按選單那一列 → traWaitStartFor），不是直接呼叫 waitCardsDropOther()——
  //    後者把斷言擺在受測物的下游:互斥函式本身寫得再對,只要開卡路徑忘了叫它,鎖屏上照樣
  //    會並存兩張卡,而那樣的判準是綠的。
  await page.evaluate(() => traWaitStop());
  await page.evaluate(() => { state.metroWait = { sys: 'trtc', station: '龍山寺', dest: null, endAt: Date.now() / 1000 + 1800 }; });
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  await page.evaluate(() => document.querySelector('#traWaitPickerChoices .tra-wait-choice').click());
  await page.waitForFunction(() => state.traWait !== null, null, { timeout: 6000 });
  ok(tag('F1 從看板開等站卡時，捷運等車卡的 state 被收掉（單卡不變量，走真的開卡路徑）'),
    await page.evaluate(() => state.metroWait === null && state.traWait !== null));
  // 反向那半（開捷運等車卡收掉等站卡）在台鐵分頁點不到——它的入口在捷運看板。
  // 這裡驗互斥函式本身，另外用【原始碼層】斷言兩條開卡路徑都真的叫了它（見 F3）。
  await page.evaluate(() => waitCardsDropOther('metro'));
  ok(tag('F2 反向也成立：開等車卡時等站卡被收掉'),
    await page.evaluate(() => state.traWait === null));

  // ══════════ G：收卡 ══════════
  await page.evaluate(() => renderBoard());
  await clearCalls(page);
  bindCalls = [];
  // 重開一張再按結束，才驗得到「使用者主動收卡」這條路。
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  await page.evaluate(() => document.querySelector('#traWaitPickerChoices .tra-wait-choice').click());
  await page.waitForFunction(() => (window.__twCalls || []).some(c => c.m === 'start'), null, { timeout: 6000 });
  // 🔴 先把「已交班」這個前提做出來:沒交過 token 的卡收掉時【本來就】不該送 unbind
  //    (伺服器上根本沒有那一列)。少了這一步,G2 驗到的是一個前提不成立的空集合
  //    ——這正是第一次跑出來的紅(judgment 心得 17:回報缺陷前先確認前置條件真的成立)。
  await page.evaluate(() => {
    const cs = (window.__twCalls || []).filter(x => x.m === 'start');
    window.__twEmit('traWaitPushToken', { token: 'feedface', key: cs[cs.length - 1].p.key });
  });
  for (let i = 0; i < 40 && !bindCalls.some(c => c.kind === 'bind'); i++) await page.waitForTimeout(50);
  ok(tag('G0 收卡前這張卡真的已經交過班（G2 的前提）'),
    bindCalls.some(c => c.kind === 'bind' && c.body && c.body.token === 'feedface'),
    `calls=${bindCalls.map(c => c.kind).join(',') || '(無)'}`);
  await page.click('#boardTraWait');
  await page.waitForFunction(() => (window.__twCalls || []).some(c => c.m === 'stop'), null, { timeout: 6000 });
  ok(tag('G1 按「結束追蹤」會呼叫原生 stop 並把 state 清掉'),
    await page.evaluate(() => state.traWait === null &&
      (window.__twCalls || []).filter(c => c.m === 'stop').length === 1));
  for (let i = 0; i < 40 && !bindCalls.some(c => c.kind === 'unbind'); i++) await page.waitForTimeout(50);
  const unbind = bindCalls.find(c => c.kind === 'unbind');
  ok(tag('G2 收卡同時通知伺服器註銷（否則它會繼續推給不存在的卡）'),
    !!unbind && !!unbind.body && unbind.body.token === 'feedface',
    `calls=${bindCalls.map(c => c.kind).join(',') || '(無)'} token=${unbind && unbind.body && unbind.body.token}`);
  // 反向對照:沒交過班的卡收掉時【不可以】送 unbind——伺服器上沒有那一列,多送一發是雜訊,
  // 而且少了這一條,「有沒有送 unbind」會退化成「無條件送一發」也全綠的判準。
  bindCalls = [];
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  await page.evaluate(() => document.querySelector('#traWaitPickerChoices .tra-wait-choice').click());
  await page.waitForFunction(() => state.traWait !== null, null, { timeout: 6000 });
  await page.click('#boardTraWait');
  await page.waitForFunction(() => state.traWait === null, null, { timeout: 6000 });
  await page.waitForTimeout(300);
  ok(tag('G2b 沒交過班的卡收掉時不送 unbind（反向對照）'),
    !bindCalls.some(c => c.kind === 'unbind'), `calls=${bindCalls.map(c => c.kind).join(',') || '(無)'}`);

  // ══════════ C3：raw 與 eased 真的分岔的那一瞬間 ══════════
  // 🔴 這一段是整支腳本裡唯一能分辨「官方原值」與「easedShift 漸變值」的地方。
  //    前面 C1 之所以綠，是因為 live 剛啟用時 easedShift 會 snap 到官方值 ⇒ 兩者【恰好相等】，
  //    相等時任何判準都分不出實作讀的是哪一個（判準與被測差異同源＝零資訊）。
  //    把官方值從 7 分改成 20 分、【立刻】讀：raw 已經是 20，eased 還在往上爬。
  //    使用者長期裁示是「官方值一律照抄」，所以卡上與選單上必須是 20。
  await page.evaluate(() => traWaitClosePicker());
  traLiveOverride = {
    at: new Date(fakeNow() - 30000).toISOString(), srv: fakeNow(),
    trains: [{ no: target.no, delay: 20, sta: '', status: 0 }],
  };
  await page.evaluate(() => pollLive());
  await page.waitForFunction(no => !!(state.live && state.live.map && Number(state.live.map.get(no)) === 20),
    target.no, { timeout: 5000 });
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 4000 });
  const split = await page.evaluate(no => {
    const el = document.getElementById('board');
    const row = (el._traWaitRows || []).find(r => String(r.tr && r.tr.train) === no);
    const btn = [...document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice')]
      .find(b => b.querySelector('.tra-wait-choice-no').textContent.trim().endsWith(' ' + no));
    return { eased: row ? row.dl : null, chip: btn ? btn.querySelector('.tra-wait-choice-delay').textContent.trim() : null };
  }, target.no);
  ok(tag('C3a 這一刻 raw(20) 與 eased 真的不同（C3 的前提，相等就分不出來）'),
    split.eased !== null && split.eased !== 20, `eased=${split.eased} raw=20`);
  ok(tag('C3 選單印的是官方原值 20 分，不是還在爬的 easedShift'),
    split.chip === '誤點 20 分', `chip=${split.chip} eased=${split.eased}`);
  await page.evaluate(() => traWaitClosePicker());
  ok(tag('G3 pill 回到「追蹤一班車」'),
    await page.evaluate(() => document.getElementById('boardTraWait').textContent.trim() === '追蹤一班車'));

  // ══════════ H：時鐘閘門自救 ══════════
  await page.evaluate(() => { setSimSec(nowSecOfDay(activeTz()) + 7200); renderBoard(); });
  const drifted = await page.evaluate(() => Math.round(state.simSec - nowSecOfDay(activeTz())));
  await clearCalls(page);
  await page.click('#boardTraWait');
  await page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 5000 });
  const rescued = await page.evaluate(() => Math.round(state.simSec - nowSecOfDay(activeTz())));
  ok(tag('H1 時鐘離開「現在」時先帶回來再開選單'),
    Math.abs(drifted) > 3600 && Math.abs(rescued) <= 120, `drift=${drifted}s → ${rescued}s`);
  // 帶回來之後選單列出來的還是「現在」之後的車 ⇒ 開卡 schedSec 仍在未來。
  await page.evaluate(() => document.querySelector('#traWaitPickerChoices .tra-wait-choice').click());
  await page.waitForFunction(() => (window.__twCalls || []).some(c => c.m === 'start'), null, { timeout: 6000 });
  const pl2 = (await calls(page, 'start'))[0].p;
  ok(tag('H2 自救後開的卡，表定時刻仍在現在之後（沒有被 +2 小時的假時鐘汙染）'),
    pl2.schedSec > fakeNow() / 1000 - 300 && pl2.schedSec < fakeNow() / 1000 + 3 * 3600 + 600,
    `schedSec=${hhmmTaipei(pl2.schedSec * 1000)} now=${hhmmTaipei(fakeNow())}`);
  await page.evaluate(() => traWaitStop());

  // ══════════ I：沒有原生 plugin 時整組不出現（反向對照） ══════════
  ok(tag('I0 本輪沒有 console/page 例外'), errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
  const noPlug = await boot(browser, { withPlugin: false });
  await openTraStation(noPlug.page, '板橋');
  ok(tag('I1 沒有 RailTraWait plugin 時 pill 完全不出現（web/PWA）'),
    await noPlug.page.evaluate(() => !document.getElementById('boardTraWait')));
  await noPlug.ctx.close();

  // ══════════ J：手機版（375 寬）══════════
  const mob = await boot(browser, { viewport: { width: 375, height: 667 } });
  await openTraStation(mob.page, '板橋');
  const pillHit = await mob.page.evaluate(() => {
    const b = document.getElementById('boardTraWait');
    if (!b) return { has: false };
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // 判準的【期望值】取自樣式表裡作者寫下的宣告(CSSOM),量測值取自引擎算出來的
    // computed style——兩邊不同源(judgment 心得 29)。寫成無效簡寫時 CSSOM 這三條會是
    // 空字串,對照就直接紅;若改讀 computed 當期望,那是拿實作驗實作,恆真。
    let declared = null;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of rules || []) {
        if (rule.selectorText === '.board .board-wait') {
          declared = { fs: rule.style.fontSize, fw: rule.style.fontWeight, lh: rule.style.lineHeight,
                       pt: rule.style.paddingTop || rule.style.padding, bw: rule.style.borderWidth,
                       ui: getComputedStyle(document.documentElement).getPropertyValue('--ui').trim() };
        }
      }
    }
    const cs = getComputedStyle(b);
    return { has: true, w: Math.round(r.width), h: Math.round(r.height),
             hit: !!el && (el === b || b.contains(el)), declared,
             computed: { fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight } };
  });
  // 🔴 驗按鈕不是驗它在哪，是驗點它會發生什麼（memory: 心得 33）。
  ok(tag('J1 手機 375 寬 pill 命中自己'), pillHit.has && pillHit.hit,
    JSON.stringify({ has: pillHit.has, hit: pillHit.hit, w: pillHit.w, h: pillHit.h }));
  // 🔴 這一條是被實際的紅逼出來的:`font: 800 12.5px/1.5 inherit` 的簡寫【整條會被丟掉】
  //    (inherit 只有當整條值就是它時才合法),兩個引擎都退回 UA 預設按鈕字體、高度差 6px,
  //    而 iOS 是 WebKit ⇒ 這顆 CTA 在唯一有等站卡的平台上最矮。判準寫成「宣告的三個字體
  //    屬性必須真的生效」而不是「高度 ≥ N px」——後者是會被下次改文案／改字級推翻的魔術數字
  //    (judgment 心得 35)。
  ok(tag('J1b .board-wait 的字體宣告沒有被瀏覽器丟掉（無效簡寫會整條消失）'),
    !!pillHit.declared && !!pillHit.declared.fs && !!pillHit.declared.fw && !!pillHit.declared.lh,
    JSON.stringify(pillHit.declared));
  const declaredFontPx = pillHit.declared
    ? parseFloat(pillHit.declared.fs.match(/[\d.]+/)?.[0] || 'NaN')
      * (parseFloat(pillHit.declared.ui) || 1)
    : NaN;
  ok(tag('J1c computed 字體＝解析後的樣式表宣告（期望值取自 CSSOM，與實作不同源）'),
    !!pillHit.declared &&
    Math.abs(parseFloat(pillHit.computed.fs) - declaredFontPx) < 0.01 &&
    pillHit.computed.fw === pillHit.declared.fw &&
    Math.abs(parseFloat(pillHit.computed.lh) - declaredFontPx * parseFloat(pillHit.declared.lh)) < 0.51,
    JSON.stringify({ declared: pillHit.declared, computed: pillHit.computed }));
  pillHeights[engineName] = pillHit.h;
  await mob.page.click('#boardTraWait');
  await mob.page.waitForFunction(() => { const m = document.getElementById('traWaitPicker'); return !!m && !m.hidden; }, null, { timeout: 5000 });
  const overflow = await mob.page.evaluate(() => {
    const rows = [...document.querySelectorAll('#traWaitPickerChoices .tra-wait-choice')];
    const dlg = document.querySelector('#traWaitPicker .takeout-dialog').getBoundingClientRect();
    return {
      n: rows.length,
      over: rows.filter(r => { const b = r.getBoundingClientRect(); return b.right > dlg.right + 1 || b.left < dlg.left - 1; }).length,
      bodyScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  ok(tag('J2 手機選單列不溢出對話框、頁面不橫捲'),
    overflow.n > 0 && overflow.over === 0 && !overflow.bodyScroll, JSON.stringify(overflow));
  await mob.ctx.close();
}

for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  try { await run(name, browser); } finally { await browser.close(); }
}
server.close();

// ══════════ F3：原始碼層——兩條開卡路徑都要叫互斥函式 ══════════
// 🔴 這一條是【冷分支】的補位:捷運那條開卡路徑的入口在捷運看板,從台鐵分頁按不到,
//    行為層驗不到它。原始碼層雖然弱（只證明那行字在），但它擋的正是「有人把呼叫刪掉」
//    這個唯一的失效方式——而那個失效在行為層是完全靜默的。
{
  const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bodyOf = name => {
    const i = src.indexOf(`function ${name}(`);
    if (i < 0) return null;
    let depth = 0, started = false;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') { depth++; started = true; }
      else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
    }
    return null;
  };
  for (const fn of ['traWaitStartFor', 'metroWaitStartFor']) {
    const body = bodyOf(fn);
    ok(`F3 ${fn}() 有呼叫 waitCardsDropOther()（鎖屏只留一張卡）`,
      !!body && /waitCardsDropOther\(/.test(body),
      body ? '（函式找到了）' : `找不到 function ${fn}(` );
  }
}

ok('K1 兩個引擎算出來的 pill 盒高一致（同一份 CSS 不該有兩種盒模型）',
  Object.keys(pillHeights).length === 2 &&
  Math.abs(pillHeights.chromium - pillHeights.webkit) <= 1,
  JSON.stringify(pillHeights));

const fail = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項，FAIL ${fail.length}`);
if (fail.length) { for (const f of fail) console.log(`  FAIL ${f.name} — ${f.detail}`); process.exit(1); }

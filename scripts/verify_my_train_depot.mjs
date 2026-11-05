#!/usr/bin/env node
// 自製列車:機務段守門腳本。從車庫入口走到親手發車接地圖跟車,每顆按鈕都真的按一次:
//   入口、六格、逐列畫框與換股、三時段、親手發車(看完動畫與略過)、重開後出勤中、編輯、刪除、
//   排進指定股、回到現在、過期與沒買過、開不了 3D、手機寬度。
// 車隊規則在 verify_my_train_fleet.mjs,純函式在 verify_my_train_plan.mjs。
//
// 慣例同 verify_my_train_fleet.mjs:自帶靜態伺服器、語系鎖 zh-TW、pageerror 掛勾、chromium＋webkit。
// 無視窗 Chrome 要帶 Metal 參數才開得了 WebGL;WebKit 開不了時走「開不了 3D」那條路,結尾印出來,不算通過 3D 的項目。

import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.DEPOT_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT || 0), '127.0.0.1', resolve); });
const PORT = server.address().port;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const js = x => JSON.stringify(x);

const KEY = 'trainmap-my-fleet-v1';
const RIDES = [1, 2, 3, 4].map(i => ({ train: '800' + i, date: '2026-01-0' + i, sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 }));
const INIT = (rides) => {
  for (const [k, v] of [['trainmap-howto-seen', '1'], ['trainmap-language', 'zh-TW'], ['trainmap-powersave', '0'], ['trainmap-fprail-min', '0'],
    ['trainmap-rides', JSON.stringify(rides)]]) localStorage.setItem(k, v);
};
// 持證:開機就算數,深連結開頁時才不會先落到過期畫面。
const PASS = () => { document.addEventListener('DOMContentLoaded', () => { plusState().active = true; }, { once: true }); };

// 外部圖磚失手跟機務段無關;本機檔案載入失敗、頁面自己印的錯誤照算。
const externalNoise = (text, url) => /^https?:/.test(url || '') && !(url || '').startsWith(`http://127.0.0.1:${PORT}/`)
  || /^(Fetch API cannot load |Access to fetch at '?)https?:\/\/(?!127\.0\.0\.1)/.test(text);
async function newPage(ctx, errors) {
  const page = await ctx.newPage();
  page.on('dialog', d => (d.type() === 'confirm' && /確定要刪除/.test(d.message()) ? d.accept() : d.dismiss()).catch(() => {}));
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (page.reloading && /^實體股道 TypeError/.test(m.text())) return; // 舊頁面還在載的實體股道被重開中止,兩個引擎的訊息不同
    const u = (m.location() || {}).url;
    if (!externalNoise(m.text(), u)) errors.push('CONSOLE: ' + m.text() + (u ? ' @ ' + u : ''));
  });
  return page;
}
const URL0 = () => `http://127.0.0.1:${PORT}/?lang=zh-TW&g=nat`;
async function ready(page) {
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready && state.trains.length > 0 && typeof MyTrainUI !== 'undefined'; }
    catch (e) { return false; }
  }, null, { timeout: 40000 });
}
async function boot(ctx, errors) {
  const page = await newPage(ctx, errors);
  await page.goto(URL0(), { waitUntil: 'domcontentloaded' });
  await ready(page);
  return page;
}

// 真的點:中心點 elementFromPoint 要是它自己,手機走真手指。
async function press(page, sel, touch) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b || b.width < 1 || b.height < 1) throw new Error('看不見 ' + sel);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const hit = await loc.evaluate((el, pt) => {
    const h = document.elementFromPoint(pt[0], pt[1]);
    return { ok: !!h && (h === el || el.contains(h)), what: h ? h.outerHTML.slice(0, 90) : null };
  }, [x, y]);
  if (!hit.ok) throw new Error(`${sel} 的中心點打到 ${hit.what}`);
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y, { delay: 60 });
}
async function openGarage(page, touch) {
  const tab = await page.evaluate(() => {
    const el = document.getElementById('tabMore');
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  await press(page, tab ? '#tabMore' : '#toolsFab', touch);
  await page.locator('#moreSheet [data-act="garage"]').waitFor({ state: 'visible', timeout: 5000 });
  await press(page, '#moreSheet [data-act="garage"]', touch);
  await page.waitForFunction(() => !!window.TrainGarage?.isOpen, null, { timeout: 8000 });
}
const CHIP = i => `#mtDepot .md-chip[data-i="${i}"]`;
const A = name => `#mtDepot .md-frame.on [data-a="${name}"]`;
const settle = page => page.waitForTimeout(520); // 畫框滑入 .42 秒,滑到定位才點得準
// 特寫時選車列收著,先回全景。
async function chip(page, i, touch) {
  if (await page.evaluate(() => document.querySelector('#mtDepot .md-frame').classList.contains('on'))) { await press(page, A('back'), touch); await settle(page); }
  await press(page, CHIP(i), touch);
  await settle(page);
}
async function depotOpen(page) {
  await page.waitForFunction(() => window.MyTrainDepot?.isOpen, null, { timeout: 8000 });
}
// 3D 就位,或這台開不了 3D。回傳 true＝有 3D。
async function stageUp(page) {
  await page.waitForFunction(() => window.MyTrainDepot.ready || !!document.querySelector('#mtDepot .md-load.flat'), null, { timeout: 40000 });
  return page.evaluate(() => window.MyTrainDepot.ready);
}
const frame = page => page.evaluate(() => {
  const f = document.querySelector('#mtDepot .md-frame');
  return { on: f.classList.contains('on'), text: f.innerText.replace(/\s+/g, ' '), acts: [...f.querySelectorAll('[data-a]')].map(b => b.dataset.a) };
});
const chips = page => page.evaluate(() => [...document.querySelectorAll('#mtDepot .md-chip')].map(c => ({ cls: c.className.replace('md-chip', '').trim(), name: c.querySelector('b').textContent, sub: c.querySelector('small').textContent, on: c.getAttribute('aria-pressed') })));
const fleet = page => page.evaluate(() => MyTrainUI.load().trains);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const clock = page => page.evaluate(() => ({ now: state.clockAtNow, off: Math.abs(state.simSec - nowSecOfDay()), search: location.search }));
// 畫面平均亮度:畫一幀,同一個工作內讀回來(沒開 preserveDrawingBuffer,過了這一拍就讀不到)。
const brightness = page => page.evaluate(() => {
  MyTrainDepot.stage.frame();
  const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(document.querySelector('#mtDepot .md-gl'), 0, 0, 64, 36);
  const d = x.getImageData(0, 0, 64, 36).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11;
  return s / (d.length / 4);
});
// 種車隊:每列半天後才開,開頁時都在股道上。第 1 股帶十天的紀錄,畫框的數字才算得出來。
async function seed(page, rows) {
  return page.evaluate(list => {
    plusState().active = true;
    const k = n => MyTrainPlan.stationKey('tra_sched', n), today = todayStr(), dep = Math.floor(((nowSecOfDay() + 43200) % 86400) / 60) * 60;
    const cur = MyTrainUI.load();
    let trains = [];
    for (const [track, name, modelId, from, to] of list) {
      trains = MyTrainPlan.fleetPut(trains, { id: 'my:seed000' + track, name, modelId, sys: 'tra_sched', from: k(from), to: k(to), via: null, dir: null, pattern: 'major',
        depSec: dep, color: '#2E6FB0' }, MyTrainPlan.firstRunDay(dep, nowSecOfDay(), today), false, track);
    }
    const first = trains[0], leg = MyTrainPlan.legOf(ownTrainPlan(first));
    const day = new Date(Date.parse(today + 'T12:00:00+08:00') - 10 * 864e5).toISOString().slice(0, 10);
    trains[0] = { ...first, firstDay: day, legs: [{ day, ...leg }], hand: { 'device-a': { n: 2, km: 60, stops: 16 } } };
    MyTrainUI.save({ ...cur, trains });
    ownTrainRebuild();
    // 開車時間排在半天後:下午開頁時那個時間已經過了,今天的班次也算進累計。
    return { leg, day, ran: dep + leg.dur < 86400 && nowSecOfDay() >= dep + leg.dur };
  }, rows);
}
const ROWS = [[0, '一號', 'emu800', '臺北', '七堵'], [1, '二號', 'emu3000', '七堵', '臺北'], [2, '三號', 'e1000', '臺北', '高雄'], [4, '五號', 'emu800', '花蓮', '臺東']];

// 待命的字樣放得下:六股全滿再多兩列。量完還原,不動後面的案例。
// 手機窄寬會折行,所以除了不溢出,還要量頂列沒有被撐高。里程放大成六列跑過一年的量級,數字短的時候量不出來。
const standbyFits = page => page.evaluate(() => {
  const head = document.querySelector('#mtDepot .md-head'), tall = head.offsetHeight;
  const cur = MyTrainUI.load(), base = cur.trains[0];
  const more = Array.from({ length: 8 - cur.trains.length }, (_, i) => ({ ...base, id: 'my:standby0' + i, name: '待命' + i, track: null, legs: [], hand: {}, outRun: null }));
  MyTrainUI.save({ ...cur, trains: [...cur.trains.map(t => ({ ...t, legs: t.legs.map(l => ({ ...l, km: l.km * 3000 })) })), ...more] });
  MyTrainDepot.refresh();
  const el = document.querySelector('#mtDepot .md-fleet'), r = el.getBoundingClientRect(), out = { text: el.textContent, lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)), head: [tall, head.offsetHeight], fits: head.offsetHeight === tall && el.scrollWidth <= el.clientWidth + 1 && r.left >= -.5 && r.right <= innerWidth + .5 };
  MyTrainUI.save(cur);
  MyTrainDepot.refresh();
  return out;
});

// 畫框的交會數:掃完之前不能寫 0 次,但親手趟或舊段已經有次數就照顯示。量完還原,不動後面的案例。
const meetsCell = page => page.evaluate(() => {
  const cur = MyTrainUI.load(), first = cur.trains.find(t => t.track === 0), last = first.legs.length - 1;
  const read = (meets, handMeets) => {
    const train = { ...first, legs: first.legs.map((l, i) => i === last ? { ...l, meets } : l), hand: { 'device-a': { n: 2, km: 60, stops: 16, meets: handMeets } } };
    MyTrainUI.save({ ...cur, trains: cur.trains.map(t => t === first ? train : t) });
    MyTrainDepot.refresh();
    return [...document.querySelectorAll('#mtDepot .md-st')].find(e => e.textContent.includes('交會真車'))?.innerText.replace(/\s+/g, ' ');
  };
  const out = { wait: read(null, 0), done: read(4, 0), zero: read(0, 0), hand: read(null, 5) };
  MyTrainUI.save(cur);
  MyTrainDepot.refresh();
  return out;
});

// 成就頁與外觀頁。第 1 股有十天紀錄,開頁判定給首航與十日;千里補一枚給車牌框,第 4 股這款路上沒有同款真車。
const PANEL = '#mtDepot .md-panel.on';
const lookOf = (page, i) => page.evaluate(n => MyTrainUI.load().trains.find(t => t.track === n)?.look, i);
const markOn = (page, i) => page.evaluate(n => MyTrainDepot.stage?.markOf(n), i);
const PICK = (kind, id) => `#mtDepot .md-frame.on [data-a="${kind}"][data-k="${id}"]`;
async function honorPages(page, P, touch, has3d) {
  await chip(page, 0, touch);
  const f = await frame(page);
  ok(P('[成就] 畫框:六格紀錄、六枚章、下一個目標、換外觀'), /交會真車\s*(\d+\s*次|計算中)/.test(f.text) && /成就 3／31/.test(f.text) && /下一個「萬里」/.test(f.text) && f.acts.includes('look'), f.text.slice(0, 260));
  const meets = await meetsCell(page);
  ok(P('[畫框] 交會數掃完前寫計算中,掃完換成次數,已有次數就不蓋掉'), meets.wait === '交會真車 計算中' && /^交會真車 [1-9]\d* ?次$/.test(meets.done) && /^交會真車 0 ?次$/.test(meets.zero) && /^交會真車 5 ?次$/.test(meets.hand), js(meets));
  const shelf = await page.evaluate(() => [...document.querySelectorAll('#mtDepot .md-stp')].map(e => [e.classList.contains('got'), e.textContent.trim()]));
  ok(P('[成就] 六枚章:首航、十日、千里亮,其他暗'), shelf.length === 6 && js(shelf.filter(x => x[0]).map(x => x[1])) === js(['首航首航', '十日十日', '千里千里']), js(shelf));
  await press(page, A('ach'), touch); await page.waitForTimeout(450);
  const pa = await page.evaluate(() => { const el = document.querySelector('#mtDepot .md-panel');
    return { sections: el.querySelectorAll('section').length, items: el.querySelectorAll('li').length, got: el.querySelectorAll('li.got').length, text: el.innerText.replace(/\s+/g, ' '), sw: el.querySelector('.md-fb').scrollWidth, cw: el.querySelector('.md-fb').clientWidth }; });
  ok(P('[成就] 全部成就:八組、31 枚、拿到 3 枚'), pa.sections === 8 && pa.items === 31 && pa.got === 3 && /已拿 3／31/.test(pa.text), js({ ...pa, text: pa.text.slice(0, 60) }));
  ok(P('[成就] 獎勵照目錄寫,天氣標資料來源,不給點數'), ['頭牌「首航」', '車牌框「銅」', '資料來源：中央氣象署', '不給點數'].every(w => pa.text.includes(w)), pa.text.slice(0, 120));
  ok(P('[成就] 成就頁沒有橫向溢出'), pa.sw <= pa.cw, js([pa.sw, pa.cw]));
  ok(P('[成就] 有同款真車的車款不寫拿不到'), !pa.text.includes('拿不到'));
  const pscan = await scan(page, `${PANEL} [data-a="achClose"]`);
  ok(P('[成就] 關閉鈕按得到'), clean(pscan), js(pscan));
  await press(page, `${PANEL} [data-a="achClose"]`, touch); await page.waitForTimeout(450);
  ok(P('[成就] 關掉回畫框'), await page.evaluate(() => !document.querySelector('#mtDepot .md-panel').classList.contains('on') && document.querySelector('#mtDepot .md-frame').classList.contains('on')));

  await press(page, A('look'), touch); await page.waitForTimeout(has3d ? 400 : 0);
  const lk = await page.evaluate(() => ({ marks: document.querySelectorAll('#mtDepot .md-mki').length, plates: document.querySelectorAll('#mtDepot .md-pli').length, locked: document.querySelectorAll('#mtDepot .md-mki.lock').length, text: document.querySelector('#mtDepot .md-frame').innerText.replace(/\s+/g, ' ') }));
  ok(P('[外觀] 頭牌 18 款＋不掛、車牌框 8 款,拿到的數字對'), lk.marks === 19 && lk.plates === 8 && lk.locked === 17 && /掛在車頭 1／18/.test(lk.text) && /地圖上看得到 2／8/.test(lk.text), js({ ...lk, text: lk.text.slice(0, 100) }));
  await press(page, PICK('mk', 'maiden'), touch);
  ok(P('[外觀] 拿到的點了就掛上'), (await lookOf(page, 0)).mark === 'maiden' && (!has3d || (await markOn(page, 0)) === 'maiden'), js(await lookOf(page, 0)));
  await press(page, PICK('mk', 'rain'), touch);
  const tried = await frame(page);
  ok(P('[外觀] 沒拿到的可以試掛,不存檔'), (await lookOf(page, 0)).mark === 'maiden' && (!has3d || (await markOn(page, 0)) === 'rain') && /試掛中。拿到「雨行」才能留著/.test(tried.text), tried.text.slice(0, 90));
  await page.evaluate(() => MyTrainDepot.refresh());
  ok(P('[外觀] 定時重算不會把試掛蓋掉'), !has3d || (await markOn(page, 0)) === 'rain');
  await press(page, PICK('pl', 'bronze'), touch);
  ok(P('[外觀] 拿到的車牌框掛上,地圖上的車跟著換'), (await lookOf(page, 0)).plate === 'bronze' && await page.evaluate(() => state.myTrains.filter(r => ownTrainBaseId(r) === 'my:seed0000').every(r => r._ownLook.plate === 'bronze')));
  await press(page, PICK('pl', 'gold'), touch);
  ok(P('[外觀] 沒拿到的車牌框試掛,不存檔'), (await lookOf(page, 0)).plate === 'bronze' && /試掛中。拿到「環球」/.test((await frame(page)).text));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `look-${page.viewportSize().width}.png`) });
  const every = await page.evaluate(() => [...document.querySelectorAll('#mtDepot .md-mki,#mtDepot .md-pli')].map(el => el.dataset.k));
  let reach = 0;
  for (const k of every) {
    const loc = page.locator(`#mtDepot .md-frame.on [data-k="${k}"]`);
    await loc.scrollIntoViewIfNeeded();
    if (await loc.evaluate(el => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.height >= 44 && (h === el || el.contains(h)); })) reach++;
  }
  ok(P('[外觀] 每一款都捲得到、點得到、高 44 以上'), reach === every.length, `${reach}/${every.length}`);
  await press(page, `#mtDepot .md-ff ${'[data-a="lookDone"]'}`, touch); await settle(page);
  const after = await frame(page);
  ok(P('[外觀] 完成回畫框,試掛回原樣,畫框看得到掛的東西'), after.acts.includes('go') && (await lookOf(page, 0)).plate === 'bronze' && (!has3d || (await markOn(page, 0)) === 'maiden')
    && await page.evaluate(() => !!document.querySelector('#mtDepot .md-lk img') && !!document.querySelector('#mtDepot .md-lk .md-plt')), after.text.slice(0, 60));
  await press(page, A('back'), touch); await settle(page);
  await press(page, '#mtDepot [data-a="achFleet"]', touch); await page.waitForTimeout(450);
  const fl = await page.evaluate(() => { const el = document.querySelector('#mtDepot .md-panel'); return { items: el.querySelectorAll('li').length, text: el.innerText.replace(/\s+/g, ' ') }; });
  ok(P('[成就] 車隊成就:6 枚,獎勵是車庫佈置'), fl.items === 6 && /車庫佈置：招牌金字/.test(fl.text) && /車庫佈置之後才開放/.test(fl.text), js(fl).slice(0, 120));
  await press(page, `${PANEL} [data-a="achClose"]`, touch); await page.waitForTimeout(450);
  await chip(page, 3, touch);
  await press(page, A('ach'), touch); await page.waitForTimeout(450);
  ok(P('[成就] 路上沒有同款真車的車款寫清楚拿不到'), /這款車路上沒有同款真車，拿不到。/.test(await page.evaluate(() => document.querySelector('#mtDepot .md-panel').innerText)));
  await press(page, `${PANEL} [data-a="achClose"]`, touch); await page.waitForTimeout(450);
  await press(page, A('back'), touch); await settle(page);
}
// 第 4 股用路上沒有的車款;第 1 股補一枚千里。
const HONOR_ROWS = [...ROWS.slice(0, 3), [3, '四號', 'dr2700', '臺北', '七堵'], ROWS[3]];
const seedHonors = page => seed(page, HONOR_ROWS).then(() => page.evaluate(() => {
  const cur = MyTrainUI.load();
  MyTrainUI.save({ ...cur, trains: cur.trains.map(t => (t.track === 0 ? { ...t, earned: { km1k: '2026-01-02' } } : t)) });
}));

async function sugPick(page, which, name, touch) {
  await press(page, `[data-mt-f="${which}"]`, touch);
  await page.locator(`[data-mt-f="${which}"]`).fill(name);
  const row = page.locator(`[data-mt-sug="${which}"]`).getByRole('button', { name, exact: true }).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await row.scrollIntoViewIfNeeded();
  if (touch) await row.tap(); else await row.click();
}
const formOpen = page => page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 });
const formClosed = page => page.waitForFunction(() => !document.getElementById('mtForm').open, null, { timeout: 8000 });
const submitReady = page => page.waitForFunction(() => { const b = document.querySelector('[data-mt-f="depart"]'); return !!b && !b.disabled; }, null, { timeout: 5000 });

async function desktop(browser, tag, opts) {
  const P = s => `[${tag}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  await ctx.addInitScript(PASS);
  const page = await boot(ctx, errors);
  const { leg, ran } = await seed(page, ROWS);

  // ── 入口:車庫一格進來,地圖暫停,離開回車庫,關掉車庫時鐘接回現在 ──
  await openGarage(page);
  await press(page, '#trainGarage [data-mt-g="depot"]');
  await depotOpen(page);
  const has3d = await stageUp(page);
  ok(P('[入口] 車庫那一格進得來,車庫關掉,3D 就位'), await page.evaluate(() => !window.TrainGarage?.isOpen) && (has3d || !opts.needs3d), `3D=${has3d}`);
  if (has3d) {
    const info = await page.evaluate(() => MyTrainDepot.stage.info());
    ok(P('[入口] 四列車與場景都畫出來'), info.calls > 50 && info.triangles > 100000, js(info));
  }
  const paused = await page.evaluate(async () => { const a = state.simSec; await new Promise(r => setTimeout(r, 1200)); return { a, b: state.simSec }; });
  ok(P('[入口] 開著時地圖不跑'), paused.a === paused.b, js(paused));
  await press(page, '#mtDepot .md-exit');
  await page.waitForFunction(() => !window.MyTrainDepot.isOpen && !!window.TrainGarage?.isOpen, null, { timeout: 8000 });
  ok(P('[入口] 離開回到車庫'), true);
  await press(page, '#trainGarage .g-close');
  await page.waitForFunction(() => !window.TrainGarage?.isOpen, null, { timeout: 5000 });
  await page.waitForTimeout(1400);
  const back = await clock(page);
  ok(P('[入口] 關掉車庫後地圖接回現在,網址沒留尾巴'), back.now && back.off <= 2 && !/garage/.test(back.search), js(back));

  // ── 深連結＋六格 ──
  await page.goto(URL0() + '&garage=depot', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await depotOpen(page);
  await stageUp(page);
  const six = await chips(page);
  ok(P('[六格] 深連結開得到;四列在庫、兩格空股,順序照股道'), six.length === 6 && six[0].name === '一號' && six[1].name === '二號' && six[2].name === '三號' && six[4].name === '五號' && six[3].cls === 'empty' && six[5].cls === 'empty', js(six.map(c => c.name)));
  const head = await page.evaluate(() => document.querySelector('#mtDepot .md-fleet').textContent);
  ok(P('[六格] 標題列寫列車數與總里程'), /^4 列車 · [\d,]+ 公里$/.test(head), head);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-overview.png`) });

  // ── 畫框 ──
  await chip(page, 0);
  const f0 = await frame(page);
  const days = ran ? 11 : 10, km = Math.round(leg.km * days + 60), stops = leg.stops * days + 16;
  ok(P('[畫框] 第 1 股:名字、車款、起訖、時間'), f0.on && /第 1 股/.test(f0.text) && /一號/.test(f0.text) && /臺北/.test(f0.text) && /七堵/.test(f0.text) && /每天 \d\d:\d\d 開/.test(f0.text), f0.text.slice(0, 70));
  ok(P('[畫框] 紀錄:天數、趟數、親手 2 次,里程與停靠照段落算'), new RegExp(`已行駛\\s*${days}\\s*天`).test(f0.text) && new RegExp(`發車\\s*${days + 2}\\s*趟・親手 2`).test(f0.text)
    && f0.text.includes(`累計里程 ${km.toLocaleString('en-US')}`) && f0.text.includes(`停靠 ${stops.toLocaleString('en-US')}`), f0.text.slice(70, 170));
  ok(P('[畫框] 在庫的車有發車、編輯、刪除'), ['go', 'edit', 'delete'].every(a => f0.acts.includes(a)), js(f0.acts));
  if (SHOTS) { await page.waitForTimeout(1400); await page.screenshot({ path: path.join(SHOTS, `${tag}-focus0.png`) }); }
  await press(page, A('next')); await settle(page);
  const f1 = await frame(page);
  await press(page, A('prev')); await settle(page);
  await press(page, A('prev')); await settle(page);
  const f5 = await frame(page);
  ok(P('[畫框] 下一股、上一股,從第 1 股往回繞到第 6 股'), /第 2 股/.test(f1.text) && /二號/.test(f1.text) && /第 6 股/.test(f5.text) && /這股還空著/.test(f5.text), `${f1.text.slice(0, 16)} / ${f5.text.slice(0, 16)}`);
  const sim0 = await page.evaluate(() => state.simSec);
  await page.keyboard.press('ArrowRight'); await settle(page);
  await page.keyboard.press('4');
  const fk = await frame(page), keys = await page.evaluate(sim => ({ now: state.clockAtNow, speed: state.speedMult, moved: state.simSec - sim }), sim0);
  ok(P('[畫框] 方向鍵換股'), /第 1 股/.test(fk.text), fk.text.slice(0, 12));
  ok(P('[畫框] 地圖的快捷鍵在這頁不動時鐘與倍速'), keys.now && keys.speed === 1 && keys.moved === 0, js(keys));
  await press(page, A('back')); await settle(page);
  const bk = await frame(page);
  const dock = await page.evaluate(() => !document.querySelector('#mtDepot .md-dock').classList.contains('off'));
  ok(P('[畫框] 回全景:畫框收掉,選車列回來'), !bk.on && dock, js({ on: bk.on, dock }));
  await chip(page, 1);
  await page.keyboard.press('Escape'); await settle(page);
  const esc1 = await page.evaluate(() => ({ open: MyTrainDepot.isOpen, on: document.querySelector('#mtDepot .md-frame').classList.contains('on') }));
  ok(P('[畫框] 看著一列時 Esc 回全景,不離開'), esc1.open && !esc1.on, js(esc1));

  // ── 直接點 3D 裡的車 ──
  if (has3d) {
    const hit = await page.evaluate(async () => {
      const c = document.querySelector('#mtDepot .md-gl').getBoundingClientRect();
      return { x: c.x + c.width / 2, y0: c.y + c.height * .3, y1: c.y + c.height * .7 };
    });
    await page.waitForTimeout(1700);
    let picked = -1;
    for (let k = 0; k <= 8 && picked < 0; k++) {
      await page.mouse.click(hit.x + (k % 3 - 1) * 60, hit.y0 + (hit.y1 - hit.y0) * Math.floor(k / 3) / 2);
      await page.waitForTimeout(120);
      picked = await page.evaluate(() => MyTrainDepot.stage.current);
    }
    await settle(page);
    const fp = await frame(page);
    ok(P('[3D] 點畫面裡的股道會打開那一股的畫框'), picked >= 0 && fp.on && fp.text.includes(`第 ${picked + 1} 股`), `股=${picked + 1}`);
    await press(page, A('back')); await page.waitForTimeout(1700);

    // ── 三時段 ──
    const lit = {};
    for (const id of ['night', 'dusk', 'day']) {
      await press(page, `#mtDepot [data-period="${id}"]`);
      lit[id] = await brightness(page);
      if (SHOTS) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `${tag}-${id}.png`) }); }
    }
    const pressed = await page.evaluate(() => [...document.querySelectorAll('#mtDepot [data-period]')].map(b => b.getAttribute('aria-pressed')));
    ok(P('[時段] 三個時段畫面都換了,夜晚最暗'), lit.night + 15 < lit.dusk && lit.night + 15 < lit.day && Math.abs(lit.day - lit.dusk) > 2, js(lit));
    ok(P('[時段] 按鈕狀態跟著走'), js(pressed) === js(['true', 'false', 'false']), js(pressed));
    if (SHOTS) {
      await chip(page, 2);
      await page.waitForTimeout(1500);
      for (const id of ['night', 'dusk', 'day']) {
        await press(page, `#mtDepot [data-period="${id}"]`);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `${tag}-focus-${id}.png`) });
      }
    }
  }

  // ── 親手發車:看完動畫 ──
  await chip(page, 0);
  const seen = await page.evaluate(() => {
    window.__caps = [];
    new MutationObserver(() => { const c = document.querySelector('#mtDepot .md-cap'); if (c && !c.hidden && c.textContent && window.__caps.at(-1) !== c.textContent) window.__caps.push(c.textContent); })
      .observe(document.querySelector('#mtDepot .md-cap'), { childList: true, characterData: true, subtree: true, attributes: true });
    return MyTrainUI.load().trains[0].hand;
  });
  await press(page, A('go'));
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 40000 }).catch(async e => {
    console.log('卡在發車:', js(await page.evaluate(() => ({ open: document.getElementById('mtDepot').open, is: MyTrainDepot.isOpen, view: MyTrainDepot.stage?.view, busy: MyTrainDepot.stage?.busy, caps: window.__caps,
      follow: state.followTrain?.train, frame: document.querySelector('#mtDepot .md-frame').innerText.slice(0, 120), row: MyTrainUI.load().trains[0], block: ownTrainHandBlock(MyTrainUI.load().trains[0]), now: state.clockAtNow }))));
    throw e;
  });
  const run = await page.evaluate(() => {
    const row = MyTrainUI.load().trains[0], rec = state.followTrain;
    return { caps: window.__caps, base: rec._ownBase, id: row.id, hand: Object.values(row.hand).reduce((n, h) => n + h.n, 0), out: !!row.outRun, sim: state.simSec, now: state.clockAtNow, name: document.querySelector('[data-mt-name]')?.textContent };
  });
  if (has3d) ok(P('[發車] 四段字幕照順序出現'), run.caps.length === 4 && /號誌/.test(run.caps[0]) && /轉車台/.test(run.caps[1]) && /對準/.test(run.caps[2]) && /一號開出車庫/.test(run.caps[3]), js(run.caps));
  ok(P('[發車] 交棒到地圖跟車,跟的是這一列的親手趟,時鐘在現在'), run.base === run.id && run.now && run.out && run.name === '一號', js({ base: run.base, now: run.now, name: run.name }));
  ok(P('[發車] 次數加一'), run.hand === Object.values(seen).reduce((n, h) => n + h.n, 0) + 1, String(run.hand));
  await page.waitForTimeout(1500);
  const moved = await page.evaluate(sim => ({ d: state.simSec - sim, off: Math.abs(state.simSec - nowSecOfDay()) }), run.sim);
  ok(P('[發車] 回到地圖後時鐘在走'), moved.d > 0.5 && moved.off <= 2, js(moved));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-follow.png`) });

  // ── 親手發車:略過動畫 ──
  await page.evaluate(() => { clearFollow(); openMyTrainDepot(); });
  await depotOpen(page);
  await stageUp(page);
  await chip(page, 1);
  await press(page, A('go'));
  if (has3d) await press(page, '#mtDepot .md-skip');
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 6000 });
  ok(P('[發車] 略過動畫馬上接到地圖'), await page.evaluate(() => state.followTrain._ownBase === MyTrainUI.load().trains[1].id && state.clockAtNow));

  // ── 重開後出勤中:股道空著,「去看它」接回親手趟 ──
  await page.evaluate(() => clearFollow());
  page.reloading = true;
  await page.goto(URL0() + '&garage=depot', { waitUntil: 'domcontentloaded' });
  page.reloading = false;
  await ready(page);
  await depotOpen(page);
  await stageUp(page);
  const out = await chips(page);
  ok(P('[出勤] 重開頁後兩列還是出勤中'), out[0].cls === 'out' && out[1].cls === 'out' && out[0].sub === '出勤中', js(out.slice(0, 3).map(c => [c.cls, c.sub])));
  await chip(page, 0);
  const fo = await frame(page);
  ok(P('[出勤] 畫框寫幾點開出、現在在哪,只給「去看它」'), /\d\d:\d\d 開出，現在在.+附近/.test(fo.text) && fo.acts.includes('watch') && !fo.acts.includes('go'), fo.text.slice(0, 80));
  if (SHOTS) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(SHOTS, `${tag}-out.png`) }); }
  await press(page, A('watch'));
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 6000 });
  const watch = await page.evaluate(() => ({ base: state.followTrain._ownBase, id: MyTrainUI.load().trains[0].id, own: String(state.followTrain.train).includes('#'), now: state.clockAtNow }));
  ok(P('[出勤] 「去看它」跟上路上那一趟,時鐘在現在'), watch.base === watch.id && watch.own && watch.now, js(watch));
  await page.evaluate(() => { clearFollow(); openMyTrainDepot(); });
  await depotOpen(page);
  await stageUp(page);

  // ── 編輯班次:留在機務段 ──
  await chip(page, 2);
  await press(page, A('edit'));
  await formOpen(page);
  const label = await page.evaluate(() => document.querySelector('[data-mt-f="depart"]').textContent);
  await page.locator('[data-mt-f="name"]').fill('改名');
  const mm = await page.locator('[data-mt-f="mm"]').inputValue();
  await page.locator('[data-mt-f="mm"]').fill(String((+mm + 7) % 60));
  await submitReady(page);
  await press(page, '[data-mt-f="depart"]');
  await formClosed(page);
  await page.waitForTimeout(200);
  const ed = await page.evaluate(() => ({ open: MyTrainDepot.isOpen, row: MyTrainUI.load().trains.find(t => t.track === 2), h: document.querySelector('#mtDepot .md-frame h2').textContent, chip: document.querySelector('#mtDepot .md-chip[data-i="2"] b').textContent, small: document.querySelector('#mtDepot .md-chip[data-i="2"] small').textContent }));
  ok(P('[編輯] 存好留在機務段,畫框、格子、存檔都換新'), label === '存好班次' && ed.open && ed.row.name === '改名' && ed.h === '改名' && ed.chip === '改名' && Math.floor(ed.row.depSec / 60) % 60 === (+mm + 7) % 60 && ed.small.includes(String((+mm + 7) % 60).padStart(2, '0')), js({ label, h: ed.h, chip: ed.chip, small: ed.small }));

  // ── 刪除 ──
  const before = await fleet(page);
  await chip(page, 4);
  await press(page, A('delete'));
  await page.waitForFunction(() => MyTrainUI.load().trains.length === 3, null, { timeout: 4000 }).catch(() => {});
  const del = await page.evaluate(() => ({ n: MyTrainUI.load().trains.length, tracks: MyTrainUI.load().trains.map(t => t.track), map: state.myTrains.filter(r => !r._ownBase).length, chip: document.querySelector('#mtDepot .md-chip[data-i="4"]').className, head: document.querySelector('#mtDepot .md-fleet').textContent, text: document.querySelector('#mtDepot .md-frame').innerText }));
  ok(P('[刪除] 只刪這一列,股道空出來,其他列留在原股'), del.n === before.length - 1 && js(del.tracks) === js([0, 1, 2]) && del.map === 3 && /empty/.test(del.chip) && /這股還空著/.test(del.text) && /^3 列車/.test(del.head), js(del));

  // ── 排進指定股:中間有空股時,點哪一股就進哪一股 ──
  await chip(page, 5);
  await press(page, A('pick'));
  await page.locator('#mtDepot .md-models [data-a="model"]').first().waitFor({ state: 'visible', timeout: 3000 });
  await press(page, '#mtDepot .md-models [data-a="model"][data-model="emu800"]');
  await formOpen(page);
  const label2 = await page.evaluate(() => document.querySelector('[data-mt-f="depart"]').textContent);
  await sugPick(page, 'from', '臺北', false);
  await sugPick(page, 'to', '七堵', false);
  const dep = await page.evaluate(() => (Math.floor(state.simSec / 60) * 60 + 7200) % 86400);
  await page.locator('[data-mt-f="hh"]').fill(String(Math.floor(dep / 3600)));
  await page.locator('[data-mt-f="mm"]').fill(String(Math.floor((dep % 3600) / 60)));
  await page.locator('[data-mt-f="name"]').fill('六股');
  await submitReady(page);
  await press(page, '[data-mt-f="depart"]');
  await formClosed(page);
  await page.waitForTimeout(300);
  const put = await page.evaluate(() => ({ track: MyTrainUI.load().trains.find(t => t.name === '六股')?.track, open: MyTrainDepot.isOpen, h: document.querySelector('#mtDepot .md-frame h2').textContent, cur: document.querySelector('#mtDepot .md-chip[aria-pressed="true"]')?.dataset.i }));
  ok(P('[排班] 排進第 6 股,不是第一條空股;留在機務段看新車'), label2 === '排進這一股' && put.track === 5 && put.open && put.h === '六股' && put.cur === '5', js({ label2, ...put }));

  // ── 時鐘不在現在 ──
  await chip(page, 2);
  await page.evaluate(() => { setSimSec(state.simSec + 3600); MyTrainDepot.refresh(); });
  const off = await frame(page);
  ok(P('[時鐘] 不在現在時改給「回到現在」,寫原因,不給發車'), off.acts.includes('now') && !off.acts.includes('go') && /回到現在才能親手發車/.test(off.text), js(off.acts));
  await press(page, A('now'));
  const on = await frame(page), onClock = await clock(page);
  ok(P('[時鐘] 按了回到現在就能發車'), on.acts.includes('go') && onClock.now && onClock.off <= 2, js({ acts: on.acts, ...onClock }));

  // ── 過期:車隊都在,地圖上不跑,只留開通行證 ──
  await page.evaluate(() => { plusState().active = false; ownTrainEntitlementSync(); });
  await page.waitForTimeout(200);
  const lapse = await frame(page);
  const left = await page.evaluate(() => ({ map: state.myTrains.length, chips: [...document.querySelectorAll('#mtDepot .md-chip b')].filter(b => b.textContent !== '空股').length, n: MyTrainUI.load().trains.length }));
  ok(P('[過期] 車都看得到,地圖上不跑'), left.map === 0 && left.chips === left.n && left.n === 4, js(left));
  ok(P('[過期] 畫框只留開通行證,寫明車隊都還在'), lapse.acts.includes('pass') && !lapse.acts.includes('go') && !lapse.acts.includes('edit') && !lapse.acts.includes('delete') && /車隊都還在/.test(lapse.text), js(lapse.acts));
  if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, `${tag}-lapsed.png`) }); }
  await press(page, A('pass'));
  await page.waitForFunction(() => !window.MyTrainDepot.isOpen, null, { timeout: 4000 });
  const wall = await page.evaluate(() => ({ depot: document.getElementById('mtDepot').open, plus: !document.getElementById('plusModal').hidden }));
  ok(P('[過期] 按了關掉機務段,付費牆打開'), !wall.depot && wall.plus, js(wall));
  await ctx.close();

  // ── 從沒買過:一列示範車,不寫存檔 ──
  const errs2 = [];
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx2.addInitScript(INIT, RIDES);
  const p2 = await boot(ctx2, errs2);
  const save0 = await p2.evaluate(k => { plusState().active = false; ownTrainEntitlementSync(); openMyTrainDepot(); return localStorage.getItem(k); }, KEY);
  await depotOpen(p2);
  await stageUp(p2);
  const demoChips = await chips(p2);
  await chip(p2, 0);
  const demo = await frame(p2);
  ok(P('[示範] 第 1 股是示範車,其他空股'), demoChips[0].name === '示範車' && demoChips.slice(1).every(c => c.cls === 'empty'), js(demoChips.map(c => c.name)));
  ok(P('[示範] 只有開通行證才能發車,沒有紀錄格'), demo.acts.includes('pass') && !demo.acts.includes('go') && !demo.acts.includes('edit') && !/累計里程/.test(demo.text) && /開通行證才能發車/.test(demo.text), js(demo.acts));
  if (SHOTS) { await p2.waitForTimeout(1400); await p2.screenshot({ path: path.join(SHOTS, `${tag}-demo.png`) }); }
  await chip(p2, 3);
  const demoEmpty = await frame(p2);
  ok(P('[示範] 空股也是開通行證,不給排班'), demoEmpty.acts.includes('pass') && !demoEmpty.acts.includes('pick'), js(demoEmpty.acts));
  const save1 = await p2.evaluate(k => localStorage.getItem(k), KEY);
  ok(P('[示範] 存檔一個字都沒動'), save0 === save1, String(save1).slice(0, 60));
  ok(P('[示範] 整段沒有頁面錯誤'), errs2.length === 0, errs2.slice(0, 3).join(' | '));
  await ctx2.close();

  // ── 開不了 3D:清單、畫框、發車照常 ──
  const errs3 = [];
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx3.addInitScript(INIT, RIDES);
  await ctx3.addInitScript(PASS);
  await ctx3.route('**/rail-3d/roundhouse-stage.js', r => r.abort());
  const p3 = await boot(ctx3, errs3);
  await seed(p3, ROWS);
  await p3.evaluate(() => openMyTrainDepot());
  await depotOpen(p3);
  await p3.waitForSelector('#mtDepot .md-load.flat', { timeout: 10000 });
  const flat = await p3.evaluate(() => document.querySelector('#mtDepot .md-load').textContent);
  await chip(p3, 2);
  const f3 = await frame(p3);
  ok(P('[無 3D] 說明開不了 3D,畫框照常'), flat === '這台裝置開不了 3D' && /三號/.test(f3.text), flat);
  if (SHOTS) await p3.screenshot({ path: path.join(SHOTS, `${tag}-flat.png`) });
  await press(p3, A('go'));
  await p3.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 5000 });
  ok(P('[無 3D] 發車直接接到地圖跟車'), await p3.evaluate(() => state.followTrain._ownBase === MyTrainUI.load().trains[2].id && state.clockAtNow));
  const real3 = errs3.filter(e => !/^CONSOLE: (roundhouse|Failed to load resource)/.test(e));
  ok(P('[無 3D] 除了擋下的那支檔案沒有別的錯'), real3.length === 0, real3.slice(0, 3).join(' | '));
  await ctx3.close();

  // ── 減少動態:沒有長動畫,一按就到地圖 ──
  const errs4 = [];
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  await ctx4.addInitScript(INIT, RIDES);
  await ctx4.addInitScript(PASS);
  const p4 = await boot(ctx4, errs4);
  await seed(p4, ROWS);
  await p4.evaluate(() => openMyTrainDepot());
  await depotOpen(p4);
  await stageUp(p4);
  await chip(p4, 0);
  const t0 = Date.now();
  await press(p4, A('go'));
  await p4.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 8000 });
  ok(P('[減少動態] 發車幾秒內到地圖'), Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
  ok(P('[減少動態] 沒有頁面錯誤'), errs4.length === 0, errs4.slice(0, 3).join(' | '));
  await ctx4.close();

  ok(P('整段沒有頁面錯誤'), errors.length === 0, errors.slice(0, 3).join(' | '));
  return has3d;
}

// 控件兩兩相交、點得到自己、在畫面內。
const scan = (page, sel) => page.evaluate(selector => {
  const els = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const rects = els.map(e => ({ e, r: e.getBoundingClientRect(), n: e.dataset.a || e.dataset.period || e.className || e.tagName }));
  const clash = [], miss = [], outside = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      if (a.r.left < b.r.right - .5 && b.r.left < a.r.right - .5 && a.r.top < b.r.bottom - .5 && b.r.top < a.r.bottom - .5) clash.push(`${a.n}×${b.n}`);
    }
    if (a.r.top < 0 || a.r.bottom > innerHeight + .5) outside.push(a.n);
    const h = document.elementFromPoint(Math.min(innerWidth - 1, a.r.x + a.r.width / 2), Math.min(innerHeight - 1, a.r.y + a.r.height / 2));
    if (a.r.right > 0 && a.r.left < innerWidth && !(h === a.e || a.e.contains(h))) miss.push(`${a.n}→${h?.className || h?.tagName}`);
  }
  return { n: rects.length, clash, miss, outside };
}, sel);
const clean = s => !s.clash.length && !s.miss.length && !s.outside.length;

// 手機:真手指走一遍;寬度掃 360／375／414／768,再加一個橫的。
async function phone(browser, tag, width, height) {
  const P = s => `[${tag} ${width}×${height}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  await ctx.addInitScript(PASS);
  const page = await boot(ctx, errors);
  await seedHonors(page);
  await openGarage(page, true);
  await press(page, '#trainGarage [data-mt-g="depot"]', true);
  await depotOpen(page);
  const has3d = await stageUp(page);
  await page.waitForTimeout(300);

  const over = await scan(page, '#mtDepot .md-exit,#mtDepot [data-period],#mtDepot .md-chip');
  ok(P('總覽:控件不互蓋、都點得到、都在畫面內'), clean(over), js(over));
  ok(P('總覽:沒有水平捲動'), (await overflow(page)) <= 0, String(await overflow(page)));
  const stand = await standbyFits(page);
  ok(P('總覽:待命字樣放得下'), stand.fits && /待命 2 列/.test(stand.text), js(stand));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}x${height}-overview.png`) });
  for (const id of ['night', 'day']) await press(page, `#mtDepot [data-period="${id}"]`, true);
  ok(P('總覽:時段鈕手指按得到'), await page.evaluate(() => document.querySelector('#mtDepot [data-period="day"]').getAttribute('aria-pressed') === 'true'));
  // 六格都摸得到:窄螢幕要橫滑。
  let reach = 0;
  for (let i = 0; i < 6; i++) {
    await page.locator(CHIP(i)).scrollIntoViewIfNeeded();
    const hit = await page.locator(CHIP(i)).evaluate(el => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.left >= 0 && r.right <= innerWidth + .5 && (h === el || el.contains(h)); });
    if (hit) reach++;
  }
  ok(P('六格橫滑都摸得到'), reach === 6, String(reach));

  await chip(page, 0, true);
  await page.waitForTimeout(has3d ? 1300 : 0);
  // 內文裡的「全部成就」捲到才看得到,honorPages 真的按一次。
  const fr = await scan(page, '#mtDepot .md-exit,#mtDepot .md-fh [data-a],#mtDepot .md-ff [data-a]');
  ok(P('畫框:每顆按鈕不互蓋、點得到、在畫面內'), clean(fr), js(fr));
  const box = await page.evaluate(() => { const f = document.querySelector('#mtDepot .md-frame').getBoundingClientRect(), h = document.querySelector('#mtDepot .md-head').getBoundingClientRect(), b = document.querySelector('#mtDepot .md-fb'); return { top: f.top, head: h.bottom, right: f.right, w: innerWidth, bottom: f.bottom, hh: innerHeight, sw: b.scrollWidth, cw: b.clientWidth }; });
  ok(P('畫框:不蓋標題列、不超出畫面、內文沒有橫向溢出'), box.top >= box.head - .5 && box.right <= box.w + .5 && box.bottom <= box.hh + .5 && box.sw <= box.cw, js(box));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}x${height}-focus.png`) });
  // 紀錄格捲到底也摸得到。
  const scrolled = await page.evaluate(() => { const b = document.querySelector('#mtDepot .md-fb'); b.scrollTop = b.scrollHeight; const last = [...b.querySelectorAll('.md-st')].at(-1), r = last.getBoundingClientRect(), fb = b.getBoundingClientRect(); return { fits: r.bottom <= fb.bottom + 1, can: b.scrollHeight > b.clientHeight }; });
  ok(P('畫框:紀錄捲到底看得完'), scrolled.fits, js(scrolled));
  const still = await page.evaluate(() => { const b = document.querySelector('#mtDepot .md-fb'), c = document.querySelector('#mtDepot .md-chip'), top = b.scrollTop; MyTrainDepot.refresh(); return { same: b.isConnected && c.isConnected && b.scrollTop === top, top }; });
  ok(P('畫框:定時重算時內容沒變就不動畫面'), still.same, js(still));
  await press(page, A('next'), true); await settle(page);
  ok(P('畫框:下一股手指按得到'), /第 2 股/.test((await frame(page)).text));
  await press(page, A('back'), true); await settle(page);
  await page.waitForTimeout(has3d ? 1500 : 0);

  await honorPages(page, P, true, has3d);

  // 空股的選車清單,每一款都摸得到。
  await page.locator(CHIP(5)).scrollIntoViewIfNeeded();
  await chip(page, 5, true);
  await press(page, A('pick'), true);
  await page.locator('#mtDepot .md-models [data-a="model"]').first().waitFor({ state: 'visible', timeout: 3000 });
  const models = await page.locator('#mtDepot .md-models [data-a="model"]').count();
  let touched = 0;
  for (let i = 0; i < models; i++) {
    const loc = page.locator('#mtDepot .md-models [data-a="model"]').nth(i);
    await loc.scrollIntoViewIfNeeded();
    if (await loc.evaluate(el => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h === el || el.contains(h); })) touched++;
  }
  ok(P('選車清單:每一款捲得到、點得到'), models > 0 && touched === models, `${touched}/${models}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}x${height}-models.png`) });
  await press(page, A('back'), true); await settle(page);

  // 全畫面狀態:機務段在最上層,不該被 body.fs 影響。
  await page.evaluate(() => document.body.classList.add('fs'));
  await page.waitForTimeout(has3d ? 1500 : 0);
  const fs1 = await scan(page, '#mtDepot .md-exit,#mtDepot [data-period],#mtDepot .md-chip');
  ok(P('全畫面狀態:總覽一樣'), clean(fs1), js(fs1));
  await page.evaluate(() => document.body.classList.remove('fs'));

  // 親手發車,手指按略過,接地圖。
  await page.locator(CHIP(2)).scrollIntoViewIfNeeded();
  await chip(page, 2, true);
  await press(page, A('go'), true);
  if (has3d) {
    await page.waitForTimeout(400);
    const dep = await scan(page, '#mtDepot .md-exit,#mtDepot .md-skip');
    ok(P('發車中:離開與略過都點得到'), clean(dep), js(dep));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}x${height}-depart.png`) });
    await press(page, '#mtDepot .md-skip', true);
  }
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 8000 });
  const end = await page.evaluate(() => ({ name: document.querySelector('[data-mt-name]')?.textContent, now: state.clockAtNow }));
  ok(P('發車交棒到跟車,地圖上沒有水平捲動'), end.name === '三號' && end.now && (await overflow(page)) <= 0, js(end));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}x${height}-follow.png`) });
  ok(P('整段沒有頁面錯誤'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  return has3d;
}

// 其他語系:字比較長,窄螢幕要放得下;車名是使用者自己取的,其餘不該剩下中文。
async function language(browser, tag, lang) {
  const P = s => `[${tag} ${lang}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: lang, timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  await ctx.addInitScript(PASS);
  await ctx.addInitScript(l => localStorage.setItem('trainmap-language', l), lang);
  const page = await newPage(ctx, errors);
  await page.goto(`http://127.0.0.1:${PORT}/?lang=${lang}&g=nat`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await seed(page, ROWS);
  await page.evaluate(() => openMyTrainDepot());
  await depotOpen(page);
  const has3d = await stageUp(page);
  await page.waitForTimeout(300);
  const over = await scan(page, '#mtDepot .md-exit,#mtDepot [data-period],#mtDepot .md-chip');
  ok(P('總覽放得下'), clean(over), js(over));
  const stand = await standbyFits(page);
  ok(P('待命字樣有翻譯、放得下'), stand.fits && !/待命/.test(stand.text), js(stand));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${lang}-overview.png`) });
  await chip(page, 0, true);
  await page.waitForTimeout(has3d ? 1300 : 0);
  const fr = await scan(page, '#mtDepot .md-exit,#mtDepot .md-fh [data-a],#mtDepot .md-ff [data-a]');
  ok(P('畫框放得下'), clean(fr), js(fr));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${lang}-focus.png`) });
  if (lang !== 'ja') {
    const text = await page.evaluate(() => { const d = document.getElementById('mtDepot').cloneNode(true); d.querySelectorAll('[data-i18n-skip],.md-chip b').forEach(e => e.remove()); return d.textContent; });
    const left = text.match(/[\u4e00-\u9fff]+/g) || [];
    ok(P('畫面上沒有剩中文'), left.length === 0, js(left.slice(0, 8)));
  }
  ok(P('沒有頁面錯誤'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// 成就與外觀:桌機滑鼠。地圖上的車牌框、親手首航的大章接在後面。
async function honors(browser, tag) {
  const P = s => `[${tag}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  await ctx.addInitScript(PASS);
  const page = await boot(ctx, errors);
  await seedHonors(page);
  await page.evaluate(() => openMyTrainDepot());
  await depotOpen(page);
  const has3d = await stageUp(page);
  await honorPages(page, P, false, has3d);

  // 親手發第一趟:大章只蓋在這列車的第一趟。第 2 股是新車,第 1 股跑過了。
  await chip(page, 1);
  await press(page, A('go'));
  if (has3d) { await page.waitForTimeout(300); await press(page, '#mtDepot .md-skip'); }
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain), null, { timeout: 8000 });
  await page.waitForTimeout(700);
  const card = await page.evaluate(() => ({ big: !!document.querySelector('[data-mt-panel] .mt-big-stamp'), text: document.querySelector('[data-mt-maiden]')?.innerText }));
  ok(P('[跟車卡] 第一趟親手發車蓋首航大章'), card.big && /拿到成就「首航」，解鎖頭牌「首航」/.test(card.text), js(card));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-maiden.png`) });
  await page.evaluate(() => openMyTrainDepot());
  await depotOpen(page);
  await stageUp(page);
  await chip(page, 0);
  await press(page, A('go'));
  if (has3d) { await page.waitForTimeout(300); await press(page, '#mtDepot .md-skip'); }
  await page.waitForFunction(() => !document.getElementById('mtDepot').open && isMyTrain(state.followTrain) && state.followTrain.label === '一號', null, { timeout: 8000 });
  await page.waitForTimeout(700);
  const again = await page.evaluate(() => ({ big: !!document.querySelector('[data-mt-panel] .mt-big-stamp'), mark: document.querySelector('[data-mt-mark] img')?.alt, plate: document.querySelector('[data-mt-name]')?.className }));
  ok(P('[跟車卡] 跑過的車不蓋章,看得到頭牌與車牌框'), !again.big && /首航/.test(again.mark || '') && /mt-plate/.test(again.plate), js(again));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-follow-plate.png`) });
  // 地圖上的牌:畫出來的像素要有框的顏色,不是真車的車牌色。關掉機務段後時鐘要追一兩拍,車才上地圖。
  await page.waitForFunction(() => !!trainPos(state.followTrain, state.simSec), null, { timeout: 5000 });
  const plate = await page.evaluate(async () => {
    const rec = state.followTrain, p = mapDetailPoint([trainPos(rec, state.simSec).lat, trainPos(rec, state.simSec).lon]);
    const dpr = state.dpr, c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    c.width = 120 * dpr; c.height = 30 * dpr;
    x.drawImage(cv, (p.x - 60) * dpr, (p.y - 15) * dpr, 120 * dpr, 30 * dpr, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; let bronze = 0, navy = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (Math.abs(d[i] - 0xD0) + Math.abs(d[i + 1] - 0x93) + Math.abs(d[i + 2] - 0x5C) < 60) bronze++;
      if (Math.abs(d[i] - 0x2A) + Math.abs(d[i + 1] - 0x4A) + Math.abs(d[i + 2] - 0x73) < 40) navy++;
    }
    return { bronze, navy, three: !!window.railIslandIntegration?.hasModel({ tr: rec }) };
  });
  ok(P('[地圖] 車牌框畫上地圖'), plate.three || (plate.bronze > 4 && plate.navy > 20), js(plate));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  ok(P('[外觀] 重開頁留著'), js(await lookOf(page, 0)) === js({ mark: 'maiden', plate: 'bronze' }), js(await lookOf(page, 0)));
  ok(P('整段沒有頁面錯誤'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

const METAL = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const engines = [['chromium', chromium, { channel: 'chrome', headless: true, args: METAL }, true], ['webkit', webkit, { headless: true }, false]];
const notes = [];
for (const [tag, type, opts, needs3d] of engines.filter(e => !process.env.DEPOT_ENGINE || e[0] === process.env.DEPOT_ENGINE)) {
  const browser = await type.launch(opts);
  try {
    const has3d = await desktop(browser, tag, { needs3d });
    await honors(browser, tag);
    if (!has3d) notes.push(`${tag} 開不了 WebGL:3D 項目沒驗到,走的是開不了 3D 的路`);
    const sizes = tag === 'webkit' ? [[375, 812]] : [[360, 740], [375, 812], [414, 896], [768, 1024], [812, 375]];
    for (const [w, h] of sizes) await phone(browser, tag, w, h);
    if (tag === 'chromium') for (const lang of ['en', 'ja', 'ko']) await language(browser, tag, lang);
  } catch (e) {
    ok(`[${tag}] 跑完全程`, false, e.message);
  }
  await browser.close();
}
server.close();
const bad = results.filter(r => !r.pass);
for (const n of notes) console.log('注意:' + n);
console.log(`\n${results.length - bad.length}/${results.length} 通過`);
process.exit(bad.length ? 1 : 0);

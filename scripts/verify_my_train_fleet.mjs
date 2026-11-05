#!/usr/bin/env node
// 自製列車:車隊守門腳本。一個人最多六列同時上地圖,這支從真的介面走多列才會出事的地方:
//   舊存檔搬進第 1 股、六列同時跑、每一列都跟得上、刪一列不動到其他列、六股滿了、親手發車、
//   手機寬度。單列的隔離邊界在 verify_my_train_isolation.mjs,純函式在 verify_my_train_plan.mjs。
//
// 慣例同 verify_my_train_isolation.mjs:自帶靜態伺服器、語系鎖 zh-TW、pageerror 掛勾、chromium＋webkit。
// 親手趟的「跑完」不等真實時間:把這一趟的按下時刻往回改,讓牆鐘判定自己走到,收車的路徑是真的。

import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.FLEET_SHOTS || '';
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

const NEW_KEY = 'trainmap-my-fleet-v1', OLD_KEY = 'trainmap-my-train-v1';
const RIDES = [1, 2, 3, 4].map(i => ({ train: '800' + i, date: '2026-01-0' + i, sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 }));
const INIT = (rides) => {
  document.addEventListener('DOMContentLoaded', () => { plusState().active = true; if (state.ready) ownTrainRebuild(); }, { once: true });
  for (const [k, v] of [['trainmap-howto-seen', '1'], ['trainmap-language', 'zh-TW'], ['trainmap-powersave', '0'], ['trainmap-fprail-min', '0'],
    ['trainmap-rides', JSON.stringify(rides)]]) localStorage.setItem(k, v);
};

// 外部圖磚失手跟車隊無關;本機檔案載入失敗、頁面自己印的錯誤照算。
const externalNoise = (text, url) => /^https?:/.test(url || '') && !(url || '').startsWith(`http://127.0.0.1:${PORT}/`)
  || /^(Fetch API cannot load |Access to fetch at '?)https?:\/\/(?!127\.0\.0\.1)/.test(text);
async function boot(ctx, errors) {
  const page = await ctx.newPage();
  page.on('dialog', d => (d.type() === 'confirm' && /確定要刪除/.test(d.message()) ? d.accept() : d.dismiss()).catch(() => {}));
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (page.reloading && /^實體股道 TypeError/.test(m.text())) return; // 舊頁面還在載的實體股道被重開中止,兩個引擎的訊息不同
    const u = (m.location() || {}).url;
    if (!externalNoise(m.text(), u)) errors.push('CONSOLE: ' + m.text() + (u ? ' @ ' + u : ''));
  });
  await page.goto(`http://127.0.0.1:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return page;
}
async function reload(page) {
  page.reloading = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  page.reloading = false;
  await ready(page);
}
async function ready(page) {
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready && state.trains.length > 0 && typeof MyTrainUI !== 'undefined'; }
    catch (e) { return false; }
  }, null, { timeout: 40000 });
  await page.evaluate(() => { plusState().active = true; ownTrainRebuild(); });
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
  if (await page.evaluate(() => !!window.TrainGarage?.isOpen)) return;
  const tab = await page.evaluate(() => {
    const el = document.getElementById('tabMore');
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  await press(page, tab ? '#tabMore' : '#toolsFab', touch);
  await page.locator('#moreSheet [data-act="garage"]').waitFor({ state: 'visible', timeout: 5000 });
  await press(page, '#moreSheet [data-act="garage"]', touch);
  await page.waitForFunction(() => !!window.TrainGarage?.isOpen, null, { timeout: 8000 });
}
async function pickModel(page, modelId, touch) {
  await press(page, '#trainGarage [data-filter="all"]', touch);
  await press(page, `#trainGarage .g-car[data-model="${modelId}"]`, touch);
  await page.waitForFunction(id => document.querySelector(`#trainGarage .g-car[data-model="${id}"]`)?.getAttribute('aria-pressed') === 'true', modelId, { timeout: 5000 });
}
async function sugPick(page, which, name, touch) {
  await press(page, `[data-mt-f="${which}"]`, touch);
  await page.locator(`[data-mt-f="${which}"]`).fill(name);
  const row = page.locator(`[data-mt-sug="${which}"]`).getByRole('button', { name, exact: true }).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await row.scrollIntoViewIfNeeded();
  if (touch) await row.tap(); else await row.click();
}
// 車庫 → 選車款 → 自己排一班 → 機務段的表單 → 排進這一股,等這一列真的進車隊。stay:留在機務段。
async function schedule(page, { name, from, to, depSec, modelId = 'emu800', touch = false, stay = false }) {
  const before = await page.evaluate(() => MyTrainUI.load().trains.length);
  await openGarage(page, touch);
  await pickModel(page, modelId, touch);
  await press(page, '[data-mt-g="schedule"]', touch);
  await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 });
  await sugPick(page, 'from', from, touch);
  await sugPick(page, 'to', to, touch);
  await page.locator('[data-mt-f="hh"]').fill(String(Math.floor(depSec / 3600)));
  await page.locator('[data-mt-f="mm"]').fill(String(Math.floor((depSec % 3600) / 60)));
  await page.locator('[data-mt-f="name"]').fill(name);
  await page.waitForFunction(() => { const b = document.querySelector('[data-mt-f="depart"]'); return !!b && !b.disabled; }, null, { timeout: 5000 });
  await press(page, '[data-mt-f="depart"]', touch);
  await page.waitForFunction(n => MyTrainUI.load().trains.length === n && !document.getElementById('mtForm').open, before + 1, { timeout: 8000 });
  if (stay) return;
  await press(page, '#mtDepot .md-exit', touch);
  await page.waitForFunction(() => !window.MyTrainDepot.isOpen && !!window.TrainGarage?.isOpen, null, { timeout: 8000 });
  await press(page, '#trainGarage .g-close', touch);
  await page.waitForFunction(() => !window.TrainGarage?.isOpen, null, { timeout: 5000 });
}
// 滿六股:車庫卡片上的按鈕停用,原因寫在同一張卡片上(全站提示蓋在車庫底下,看不到)。
async function fullNote(page) {
  const note = page.locator('#trainGarage [data-mt-g="note"]');
  await note.scrollIntoViewIfNeeded();
  return note.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { disabled: document.querySelector('#trainGarage [data-mt-g="schedule"]').disabled, text: el.textContent,
      seen: /六條股道都排滿了/.test(el.textContent) && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && (hit === el || el.contains(hit)) };
  });
}
const fleet = page => page.evaluate(() => MyTrainUI.load().trains);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// 把鏡頭放到這一列上面,回傳它的車牌在頁面上的座標。不跟車時才量得到,跟車中鏡頭會自己動。
async function markOf(page, id, simSec) {
  return page.evaluate(([trainId, sec]) => {
    state.playing = false; state.clockAtNow = false; state.simSec = sec;
    const rec = ownTrainRecord(trainId), pos = trainPos(rec, sec);
    M.setView([pos.lat, pos.lon], 13, { animate: false });
    draw();
    const h = state._ownTrainHits.find(x => x.tr === rec);
    if (!h) return null;
    const box = document.getElementById('map').getBoundingClientRect();
    return { x: box.x + h.x, y: box.y + h.y };
  }, [id, simSec]);
}

const ROUTES = [
  { name: '一號', from: '臺北', to: '七堵' }, { name: '二號', from: '七堵', to: '臺北' },
  { name: '三號', from: '臺北', to: '高雄' }, { name: '四號', from: '高雄', to: '臺北' },
  { name: '五號', from: '花蓮', to: '臺東' }, { name: '六號', from: '臺東', to: '花蓮' },
];

async function desktop(browser, tag) {
  const P = s => `[${tag}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  const page = await boot(ctx, errors);

  // ── 舊存檔搬移 ──
  const T0 = await page.evaluate(() => (Math.floor(state.simSec / 60) * 60 + 180) % 86400);
  const legacy = await page.evaluate(([dep, oldKey]) => {
    const key = n => MyTrainPlan.stationKey('tra_sched', n);
    const text = JSON.stringify({ v: 1, appearance: { haloOn: false, haloSize: 'lg' }, train: {
      id: 'my:0f8e2d1c-aaaa-4bbb-8ccc-123456789abc', name: '一號', modelId: 'emu800', sys: 'tra_sched', from: key('臺北'), to: key('七堵'),
      via: null, dir: null, pattern: 'all', depSec: dep, color: '#2E6FB0' } });
    localStorage.setItem(oldKey, text);
    return text;
  }, [T0, OLD_KEY]);
  ok(P('前置:新鍵還不存在'), await page.evaluate(k => localStorage.getItem(k) === null, NEW_KEY));
  await reload(page);
  const migrated = await page.evaluate(([newKey, oldKey]) => ({
    raw: JSON.parse(localStorage.getItem(newKey) || 'null'), old: localStorage.getItem(oldKey),
    today: todayStr(), onMap: state.myTrains.map(r => r.label), }), [NEW_KEY, OLD_KEY]);
  const was = JSON.parse(legacy).train, now0 = migrated.raw?.trains?.[0];
  ok(P('[搬移] 排班欄位逐欄相同'), !!now0 && Object.keys(was).every(k => now0[k] === was[k]), js(now0));
  ok(P('[搬移] 進第 1 股、首航日是今天、外觀帶過來'), now0?.track === 0 && now0?.firstDay === migrated.today && migrated.raw.appearance.haloSize === 'lg');
  ok(P('[搬移] 舊鍵一個字都沒變'), migrated.old === legacy);
  ok(P('[搬移] 車上地圖、第一段里程記下了'), js(migrated.onMap) === js(['一號']) && now0?.legs?.length === 1 && now0.legs[0].km > 0 && now0.legs[0].day === migrated.today, js(now0?.legs));

  // ── 六列同時跑(兩個方向各一列的路線各三組)──
  for (const r of ROUTES.slice(1)) await schedule(page, { ...r, depSec: T0 });
  const six = await fleet(page);
  ok(P('[六列] 六列都進車隊,股道 0–5 各一列'), js(six.map(t => t.track).sort()) === js([0, 1, 2, 3, 4, 5]), js(six.map(t => [t.name, t.track])));
  const ids = Object.fromEntries(six.map(t => [t.name, t.id]));
  const running = await page.evaluate(sec => {
    if (isMyTrain(state.followTrain)) clearFollow();
    state.playing = false; state.clockAtNow = false; state.simSec = sec;
    M.setView([23.75, 120.95], 8, { animate: false });
    draw();
    return { hits: state._ownTrainHits.map(h => h.tr.train), pos: state.myTrains.map(r => [r.label, !!trainPos(r, sec)]) };
  }, T0 + 300);
  ok(P('[六列] 同一個時刻六列都在路上'), running.pos.length === 6 && running.pos.every(p => p[1]), js(running.pos));
  ok(P('[六列] 六列都畫上地圖'), new Set(running.hits).size === 6, js(running.hits.length));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-six.png`) });
  const moved = await page.evaluate(sec => {
    const at = () => state.myTrains.map(r => { const p = trainPos(r, state.simSec); return [p.lat, p.lon]; });
    state.simSec = sec; const a = at();
    state.simSec = sec + 120; const b = at();
    return a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]));
  }, T0 + 300);
  ok(P('[六列] 時鐘往前走,六列都會動'), moved.every(d => d > 0.001), js(moved.map(d => +d.toFixed(4))));

  // ── 兩個方向:起訖、走過的距離、來回里程 ──
  const paths = await page.evaluate(() => {
    const km = (a, b) => { const R = 6371, r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * R; };
    return MyTrainUI.load().trains.map(t => {
      const rec = ownTrainRecord(t.id), s = rec.stops, dep = s[0].depSec, dur = s[s.length - 1].arrSec - dep;
      const pts = Array.from({ length: 61 }, (_, i) => trainPos(rec, (dep + 3 + (dur - 6) * i / 60) % 86400));
      const first = s[0], last = s[s.length - 1];
      let walked = 0;
      for (let i = 1; i < pts.length; i++) walked += km(pts[i - 1], pts[i]);
      return { name: t.name, km: t.legs.at(-1).km, walked, stops: t.legs.at(-1).stops, from: first.name, to: last.name,
        startGap: km(pts[0], { lat: first.lat, lon: first.lon }), endGap: km(pts.at(-1), { lat: last.lat, lon: last.lon }) };
    });
  });
  for (const p of paths) {
    const ratio = p.walked / p.km;
    ok(P(`[方向] ${p.name} ${p.from}→${p.to}:從起站開到訖站,走過的距離對得上里程`), p.startGap < 2 && p.endGap < 2 && ratio > 0.8 && ratio < 1.05,
      `路線 ${p.km} 公里、走過 ${p.walked.toFixed(1)}、起點差 ${p.startGap.toFixed(2)}、終點差 ${p.endGap.toFixed(2)}`);
  }
  for (const [a, b] of [[0, 1], [2, 3], [4, 5]]) {
    const gap = Math.abs(paths[a].km - paths[b].km) / paths[a].km;
    ok(P(`[方向] ${paths[a].name}、${paths[b].name} 來回里程一樣`), gap < 0.02 && paths[a].stops === paths[b].stops, `${paths[a].km}/${paths[b].km},停 ${paths[a].stops}/${paths[b].stops}`);
  }

  // ── 每一列都跟得上:真的點地圖上的車牌 ──
  for (const t of six) {
    await page.evaluate(() => { if (state.followTrain) clearFollow(); });
    const pt = await markOf(page, t.id, T0 + 300);
    if (!pt) { ok(P(`[跟車] ${t.name} 車牌畫出來了`), false); continue; }
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction(id => state.followTrain?.train === id, t.id, { timeout: 4000 }).catch(() => {});
    const got = await page.evaluate(() => ({ id: state.followTrain?.train, name: document.querySelector('[data-mt-name]')?.textContent,
      route: document.querySelector('[data-mt-panel]')?.textContent || '' }));
    ok(P(`[跟車] 點 ${t.name} 就跟上 ${t.name},面板是它的`), got.id === t.id && got.name === t.name, js({ id: got.id === t.id, name: got.name }));
  }
  // 六列的事件列各記各的:每一列的「從 X 發車」都是自己的起站。
  // 撥鐘後第一拍是跳動,只移掃描起點;60× 下一拍走 30 秒,留兩分鐘讓後面的拍子才走過發車點。
  await page.evaluate(sec => { if (state.followTrain) clearFollow(); state.simSec = sec; state.playing = true; setSpeed(60); }, T0 - 120);
  await page.waitForFunction(ids => ids.every(id => (state.ownTrainLogs.get(id)?.items || []).some(x => x.kind === 'depart')), six.map(t => t.id), { timeout: 30000 }).catch(() => {});
  const logs = await page.evaluate(() => { state.playing = false; setSpeed(1); return MyTrainUI.load().trains.map(t => {
    const rec = ownTrainRecord(t.id), log = state.ownTrainLogs.get(t.id);
    return { name: t.name, from: stationName(rec.stops[0].name, rec.sys), first: (log?.items || []).find(x => x.kind === 'depart')?.text || '' };
  }); });
  ok(P('[事件列] 六列各記各的,發車站都是自己的起站'), logs.every(l => l.first.includes(l.from)), js(logs.map(l => l.first)));
  // 面板換列時,事件列跟著換。
  const panelLog = async id => {
    await page.evaluate(i => ownTrainFollow({ id: i, noJump: true }), id);
    await page.waitForTimeout(700);
    return page.evaluate(() => document.querySelector('[data-mt-panel]')?.textContent || '');
  };
  const pa = await panelLog(ids['五號']), pb = await panelLog(ids['四號']);
  ok(P('[事件列] 從一列換到另一列,面板換成新那列的內容'), /花蓮/.test(pa) && /高雄/.test(pb) && !/花蓮/.test(pb), `${pa.slice(0, 40)} / ${pb.slice(0, 40)}`);

  // ── 六股滿了 ──
  await page.evaluate(() => { if (state.followTrain) clearFollow(); });
  await openGarage(page);
  await pickModel(page, 'emu800');
  const full = await fullNote(page);
  ok(P('[滿庫] 第七列排不了:按鈕停用,卡片上寫要先刪一列,打得到那行字'), full.disabled && full.seen, js(full));
  await press(page, '#trainGarage .g-close');
  await page.waitForFunction(() => !window.TrainGarage?.isOpen, null, { timeout: 5000 });

  // ── 刪一列 ──
  const before = await fleet(page);
  await page.evaluate(id => ownTrainFollow({ id, noJump: true }), ids['三號']);
  await page.waitForTimeout(300);
  await press(page, '[data-mt-action="delete"]');
  await page.waitForFunction(() => MyTrainUI.load().trains.length === 5, null, { timeout: 4000 }).catch(() => {});
  const afterDel = await page.evaluate(() => ({ trains: MyTrainUI.load().trains, ids: state.myTrains.map(r => r.train), following: state.followTrain?.train || null }));
  const keep = before.filter(t => t.name !== '三號');
  ok(P('[刪除] 跟著的那列刪掉:其他五列存檔逐欄相同,地圖上還有五列,跟車結束'), js(afterDel.trains) === js(keep) && js(afterDel.ids.sort()) === js(keep.map(t => t.id).sort()) && afterDel.following === null,
    js({ n: afterDel.trains.length, following: afterDel.following }));
  // 刪別列:跟著的那列不受影響。
  const otherDel = await page.evaluate(([follow, del]) => {
    ownTrainFollow({ id: follow, noJump: true });
    const ok1 = ownTrainDelete(ownTrainRecord(del));
    return { ok1, same: state.followTrain === ownTrainRecord(follow), id: state.followTrain?.train, n: state.myTrains.length, name: document.querySelector('[data-mt-name]')?.textContent };
  }, [ids['一號'], ids['六號']]);
  ok(P('[刪除] 刪別列:還跟著原本那列,而且接到重建後的新物件'), otherDel.ok1 && otherDel.same && otherDel.id === ids['一號'] && otherDel.n === 4 && otherDel.name === '一號', js(otherDel));
  await page.evaluate(() => clearFollow());
  await schedule(page, { name: '補位', from: '花蓮', to: '臺東', depSec: T0 });
  const refill = await fleet(page);
  ok(P('[刪除] 空出來的股道給新排的車'), refill.find(t => t.name === '補位')?.track === before.find(t => t.name === '三號').track, js(refill.map(t => [t.name, t.track])));

  // ── 親手發車 ──
  // 找一列此刻不在路上的車:把它的每日班次挪到半天後,鏡頭回到現在。
  const handId = ids['二號'];
  const prep = await page.evaluate(id => {
    if (state.followTrain) clearFollow();
    const cur = MyTrainUI.load();
    const trains = cur.trains.map(t => (t.id === id ? { ...t, depSec: (nowSecOfDay() + 43200) % 86400 } : t));
    MyTrainUI.save({ ...cur, trains }); ownTrainRebuild(); jumpToNow();
    return { atNow: state.clockAtNow, block: ownTrainHandBlock(MyTrainUI.load().trains.find(t => t.id === id)) };
  }, handId);
  ok(P('[親手] 前置:時鐘在現在、車在股道上,可以發車'), prep.atNow && prep.block === null, js(prep));
  const sent = await page.evaluate(id => {
    const n = state.myTrains.length, sim = Math.floor(state.simSec) % 86400, rec = ownTrainHandDepart(id);
    if (!rec) return null;
    ownTrainFollow({ id: rec.train, keepNow: true });
    const t = MyTrainUI.load(), row = t.trains.find(x => x.id === id);
    return { added: state.myTrains.length - n, train: rec.train, dep: rec.stops[0].depSec, sim, following: state.followTrain === rec, atNow: state.clockAtNow,
      device: t.device, hand: row.hand, outRun: row.outRun, leg: row.legs.at(-1), block: ownTrainHandBlock(row), pos: !!trainPos(rec, state.simSec + 20) };
  }, handId);
  ok(P('[親手] 按下去立刻多一趟,跟上去,時鐘留在現在'), !!sent && sent.added === 1 && sent.train.startsWith(handId + '#') && sent.following && sent.atNow && sent.pos && Math.abs(sent.dep - sent.sim) <= 2, js(sent));
  const mine = sent && sent.hand[sent.device];
  ok(P('[親手] 次數、公里、停站按下去就記在這台裝置名下'), !!mine && mine.n === 1 && mine.km === sent.leg.km && mine.stops === sent.leg.stops, js(sent?.hand));
  ok(P('[親手] 車在路上不能再發一趟'), sent?.block === 'out', String(sent?.block));
  const blocked = await page.evaluate(id => {
    const before = localStorage.getItem('trainmap-my-fleet-v1');
    const again = ownTrainHandDepart(id);
    const keep = state.clockAtNow; state.clockAtNow = false;
    const row = MyTrainUI.load().trains.find(t => t.id !== id && t.track !== null);
    const notNow = ownTrainHandBlock(row), viaClock = ownTrainHandDepart(row.id);
    state.clockAtNow = keep;
    return { again, notNow, viaClock, same: localStorage.getItem('trainmap-my-fleet-v1') === before };
  }, handId);
  ok(P('[親手] 擋下來的發車什麼都不記;時鐘不在現在不給發'), blocked.again === null && blocked.viaClock === null && blocked.notNow === 'not_now' && blocked.same, js(blocked));
  await reload(page);
  const back = await page.evaluate(([id, train]) => ({ rec: !!ownTrainRecord(train), base: ownTrainRecord(train)?._ownBase === id, daily: !!ownTrainRecord(id), n: state.myTrains.length }), [handId, sent?.train]);
  ok(P('[親手] 重開頁面親手趟接得回來,每日班次也在'), back.rec && back.base && back.daily, js(back));
  // 跑完:把按下時刻往回改,牆鐘判定自己走到。跟著的那台面板留著,車從清單拿掉。
  // 跟車時網址帶 ?t=,重開頁時鐘停在那一刻,先回到現在。
  await page.evaluate(train => { jumpToNow(); ownTrainFollow({ id: train, keepNow: true }); }, sent?.train);
  const finished = await page.evaluate(train => {
    const rec = ownTrainRecord(train), dur = rec._ownRun.dur, cur = MyTrainUI.load();
    const trains = cur.trains.map(t => (t.id === rec._ownBase ? { ...t, outRun: { ...t.outRun, at: t.outRun.at - dur * 1000 - 1000 } } : t));
    MyTrainUI.save({ ...cur, trains });
    rec._ownRun.at -= dur * 1000 + 1000;
    return rec._ownBase;
  }, sent?.train);
  const gone = await page.waitForFunction(train => !ownTrainRecord(train), sent?.train, { timeout: 5000 }).then(() => true).catch(() => false);
  const end = await page.evaluate(([id, train]) => {
    const row = MyTrainUI.load().trains.find(t => t.id === id);
    return { outRun: row.outRun, n: Object.values(row.hand)[0]?.n, follow: state.followTrain?.train === train, panel: !document.getElementById('followPanel').hidden,
      block: ownTrainHandBlock(row) };
  }, [finished, sent?.train]);
  ok(P('[親手] 跑完就收車:清單拿掉、次數留著、面板還在、可以再發'), gone && end.outRun === null && end.n === 1 && end.follow && end.panel && end.block === null, js(end));
  await page.evaluate(() => clearFollow());
  // 沒有通行證:車隊留著,地圖上不跑,不能發車。
  const lapse = await page.evaluate(id => {
    plusState().active = false; ownTrainEntitlementSync();
    const off = { map: state.myTrains.length, stored: MyTrainUI.load().trains.length, block: ownTrainHandBlock(MyTrainUI.load().trains.find(t => t.id === id)) };
    plusState().active = true; ownTrainEntitlementSync();
    return { off, on: state.myTrains.length };
  }, handId);
  ok(P('[通行證] 過期時六列都留著、地圖上不跑、不能發車;續期回來'), lapse.off.map === 0 && lapse.off.stored === 5 && lapse.off.block === 'pass_required' && lapse.on >= 5, js(lapse));

  ok(P('整段沒有頁面錯誤'), errors.length === 0, errors.slice(0, 3).join(' | '));
  const seed = await page.evaluate(() => MyTrainUI.load());
  await ctx.close();
  return seed;
}

// 手機:真手指走一遍車庫、排班、跟車、刪除;寬度掃 360／375／414／768。
async function phone(browser, tag, width, height, seed) {
  const P = s => `[${tag} ${width}] ${s}`;
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(INIT, RIDES);
  await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [NEW_KEY, JSON.stringify(seed)]);
  const page = await boot(ctx, errors);
  const dep = await page.evaluate(() => (Math.floor(state.simSec / 60) * 60 + 180) % 86400);
  await schedule(page, { name: '手機', from: '臺北', to: '七堵', depSec: dep, touch: true, stay: true });
  await press(page, '#mtDepot [data-a="go"]', true);
  await press(page, '#mtDepot .md-skip', true).catch(() => {}); // 開不了 3D 時沒有動畫可以略過
  await page.waitForFunction(() => !document.getElementById('mtDepot')?.open && isMyTrain(state.followTrain), null, { timeout: 15000 });
  const n = await page.evaluate(() => ({ trains: MyTrainUI.load().trains.length, map: state.myTrains.length, name: document.querySelector('[data-mt-name]')?.textContent }));
  ok(P('排班、親手發車走得完,跟上新排的那列'), n.trains === 6 && n.map === 7 && n.name === '手機', js(n));
  ok(P('跟車時沒有水平捲動'), (await overflow(page)) <= 0, String(await overflow(page)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}-follow.png`) });
  await openGarage(page, true);
  await pickModel(page, 'emu800', true);
  const full = await fullNote(page);
  ok(P('滿六股的提示看得到、沒有超出畫面,按鈕停用'), full.disabled && full.seen, js(full));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${width}-full.png`) });
  await press(page, '[data-mt-g="view"]', true);
  await page.waitForFunction(() => !window.TrainGarage?.isOpen && isMyTrain(state.followTrain), null, { timeout: 6000 });
  const viewed = await page.evaluate(() => ({ id: state.followTrain.train, first: MyTrainUI.load().trains.find(t => t.modelId === 'emu800').id }));
  ok(P('車庫「去看它」跟上這款車的那一列'), viewed.id === viewed.first, js(viewed));
  const wasName = await page.evaluate(() => document.querySelector('[data-mt-name]')?.textContent);
  await press(page, '[data-mt-action="delete"]', true);
  await page.waitForFunction(() => MyTrainUI.load().trains.length === 5, null, { timeout: 4000 }).catch(() => {});
  const left = await page.evaluate(name => ({ n: MyTrainUI.load().trains.length, gone: !MyTrainUI.load().trains.some(t => t.name === name), map: state.myTrains.length, follow: !!state.followTrain }), wasName);
  ok(P('面板刪除只刪這一列,跟車結束'), left.n === 5 && left.gone && left.map >= 5 && !left.follow, js(left));
  ok(P('整段沒有頁面錯誤、沒有水平捲動'), errors.length === 0 && (await overflow(page)) <= 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

const engines = [['chromium', chromium, { channel: 'chrome', headless: true }], ['webkit', webkit, { headless: true }]];
for (const [tag, type, opts] of engines) {
  const browser = await type.launch(opts);
  try {
    const seed = await desktop(browser, tag);
    const widths = tag === 'webkit' ? [[375, 812]] : [[360, 740], [375, 812], [414, 896], [768, 1024]];
    // 手機情境從五列開始:再排一列就滿六股。
    for (const [w, h] of widths) await phone(browser, tag, w, h, seed);
  } catch (e) {
    ok(`[${tag}] 跑完全程`, false, e.message);
  }
  await browser.close();
}
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} 通過`);
process.exit(bad.length ? 1 : 0);

#!/usr/bin/env node
// 自製列車的帳號同步。守使用者會做的事:手機排車、電腦登入同一帳號看得到、兩邊各發一次車都留著、
// 換外觀取新的、刪掉傳得過去、車超過六股放待命、換人登入不會把上一個人的車帶進去。
//
// 前半是合併規則的純函式(幾秒),含隨機兩台裝置收斂;案例寫成 output/golden/mytrain/sync.json(gitignored),
// App 移植合併時逐筆比對。後半走真介面:Playwright 一個 context 一台裝置,Firestore 用 Node 端一份共用的
// 記憶體假雲端(慣例同 verify_checkin_sync),按鈕排的同步就真的傳到另一台。
//
// 假雲端刻意比真的嚴:收到 undefined、陣列直接套陣列就丟錯,回傳時把鍵順序倒過來,
// 真 Firestore 不保證 map 的鍵順序,比內容不能比字串。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const js = x => JSON.stringify(x);

// ═══ 純函式 ═══
const planCtx = vm.createContext({ console, atob });
vm.runInContext(readFileSync(path.join(ROOT, 'my-train-plan.js'), 'utf8'), planCtx, { filename: 'my-train-plan.js' });
const P = planCtx.MyTrainPlan;
const clone = x => JSON.parse(js(x));
const golden = [];
const merge = (local, cloud) => { const out = clone(P.fleetMerge(local, cloud)); golden.push({ fn: 'fleetMerge', local, cloud, out }); return out; };
const toCloud = fleet => { const out = clone(P.fleetToCloud(fleet)); golden.push({ fn: 'fleetToCloud', fleet, out }); return out; };
const fromCloud = (col, local) => { const out = clone(P.fleetFromCloud(col, local)); golden.push({ fn: 'fleetFromCloud', col, local, out }); return out; };

const DEV_A = '0f8e2d1c-aaaa-4bbb-8ccc-123456789abc', DEV_B = '0f8e2d1c-bbbb-4bbb-8ccc-123456789abc';
const LEG = { day: '2026-11-01', km: 100, stops: 5, dep: 28800, dur: 3600, tags: [], rise: null, set: null, meets: 2, twin: false, kin: [] };
const train = (id, over = {}) => ({ id, name: id.slice(3, 7), modelId: 'emu800', sys: 'tra_sched', from: 'a', to: 'b', via: null, dir: null, pattern: 'all',
  depSec: 28800, color: '#2E6FB0', ...P.fleetFields({ track: 0, firstDay: '2026-11-01', legs: [LEG] }), ...over });
const fleet = (trains, over = {}) => ({ v: 1, appearance: { haloOn: true, haloSize: 'std' }, trains, device: null, earned: {}, gone: [], ...over });
const EMPTY = { items: [], tombstones: [] };
const row = (col, id) => col.items.find(i => i.id === id);
const A = 'my:aaaaaaaa', B = 'my:bbbbbbbb', C = 'my:cccccccc';

console.log('\n── 上雲與下雲 ──');
{
  const local = fleet([train(A, { u: 5, outRun: { at: 1, dep: 2, dur: 3 }, judged: '2026-11-02' })], { device: DEV_A, earned: { fleet3: '2026-11-03' }, gone: [{ id: C, deletedAt: 9 }, { id: B, deletedAt: 3 }] });
  const col = toCloud(local), v = row(col, A);
  ok('上雲的列車不帶 outRun、judged、u,時間放 updatedAt', v.updatedAt === 5 && !('outRun' in v.value) && !('judged' in v.value) && !('u' in v.value), js(Object.keys(v.value)));
  ok('外觀設定、本機裝置欄不上雲', !js(col).includes(DEV_A) && !js(col).includes('haloSize'));
  ok('車隊成就算一筆', row(col, 'fleet').value.earned.fleet3 === '2026-11-03' && col.items.length === 2);
  ok('沒成就就不多一筆', toCloud(fleet([train(A)])).items.length === 1);
  ok('墓碑照 id 排,兩台比得起來', js(col.tombstones.map(t => t.id)) === js([B, C]));
  const back = fromCloud(col, local);
  ok('下雲留本機的 outRun、judged、appearance、device', back.trains[0].outRun.at === 1 && back.trains[0].judged === '2026-11-02' && back.device === DEV_A && back.appearance.haloOn === true);
  ok('下雲的新車 outRun、judged 是空的', fromCloud(col, fleet([])).trains[0].outRun === null && fromCloud(col, fleet([])).trains[0].judged === null);
  ok('上雲再下雲再上雲不變', P.fleetSame(toCloud(back), col));
  const running = fleet([train(A, { u: 5, outRun: { at: 1, dep: 2, dur: 3 } })]);
  ok('別台只改名字:親手趟留著', fromCloud(toCloud(fleet([train(A, { u: 9, name: '改名' })])), running).trains[0].outRun?.at === 1);
  ok('別台改了排班:親手趟取消', fromCloud(toCloud(fleet([train(A, { u: 9, depSec: 30000 })])), running).trains[0].outRun === null);
  const shuffled = { items: col.items.map(i => Object.fromEntries(Object.entries(i).reverse())), tombstones: col.tombstones };
  ok('鍵順序不同算相同', P.fleetSame(col, shuffled));
  ok('內容不同算不同(對照)', !P.fleetSame(col, { ...col, tombstones: [] }));
}

console.log('\n── 合併規則 ──');
{
  // 新的贏:排班、外觀
  const older = train(A, { u: 5, name: '舊', look: { mark: 'east', plate: null } }), newer = train(A, { u: 9, name: '新', look: { mark: null, plate: 'bronze' } });
  let m = merge(toCloud(fleet([older])), toCloud(fleet([newer])));
  ok('雲端比較新:排班、外觀取雲端', row(m, A).value.name === '新' && row(m, A).value.look.plate === 'bronze' && row(m, A).updatedAt === 9);
  m = merge(toCloud(fleet([newer])), toCloud(fleet([older])));
  ok('本機比較新:排班、外觀取本機', row(m, A).value.name === '新' && row(m, A).updatedAt === 9);
  m = merge(toCloud(fleet([train(A, { u: 5, name: '本機' })])), toCloud(fleet([train(A, { u: 5, name: '雲端' })])));
  ok('一樣新算雲端的,兩台才收得攏', row(m, A).value.name === '雲端');

  // 親手趟:每台各記各的
  const h = (n, km) => ({ n, km, stops: n * 5, meets: 0 });
  m = merge(toCloud(fleet([train(A, { u: 5, hand: { [DEV_A]: h(2, 200), [DEV_B]: h(1, 100) } })])), toCloud(fleet([train(A, { u: 9, hand: { [DEV_B]: h(3, 300) } })])));
  const hand = row(m, A).value.hand;
  ok('親手趟各裝置分開、同一台取次數多的', hand[DEV_A].n === 2 && hand[DEV_B].n === 3 && hand[DEV_B].km === 300, js(hand));

  // 段:依起始日聯集
  const l1 = { ...LEG, day: '2026-11-01' }, l2 = { ...LEG, day: '2026-11-03', km: 50 }, l3 = { ...LEG, day: '2026-11-05', km: 70 };
  m = merge(toCloud(fleet([train(A, { u: 5, legs: [l1, l2] })])), toCloud(fleet([train(A, { u: 9, legs: [l1, l3] })])));
  ok('起始日不同的段都留著、照日期排', js(row(m, A).value.legs.map(l => l.day)) === js(['2026-11-01', '2026-11-03', '2026-11-05']));
  m = merge(toCloud(fleet([train(A, { u: 5, legs: [{ ...l2, km: 11 }] })])), toCloud(fleet([train(A, { u: 9, legs: [{ ...l2, km: 22 }] })])));
  ok('同一天的段取新的', row(m, A).value.legs[0].km === 22);
  m = merge(toCloud(fleet([train(A, { u: 5, legs: [{ ...l2, meets: 7, twin: true, kin: ['my:x'] }] })])), toCloud(fleet([train(A, { u: 9, legs: [{ ...l2, meets: null }] })])));
  ok('新的還沒掃到交會,同一條路就沿用另一邊掃好的', row(m, A).value.legs[0].meets === 7 && row(m, A).value.legs[0].twin === true && row(m, A).value.legs[0].kin[0] === 'my:x');
  m = merge(toCloud(fleet([train(A, { u: 5, legs: [{ ...l2, km: 11, meets: 7 }] })])), toCloud(fleet([train(A, { u: 9, legs: [{ ...l2, km: 22, meets: null }] })])));
  ok('路線改過就不沿用(對照)', row(m, A).value.legs[0].meets === null);

  // 成就、首航
  m = merge(toCloud(fleet([train(A, { u: 5, firstDay: '2026-10-01', earned: { maiden: '2026-10-02', east: '2026-10-03' } })], { earned: { fleet3: '2026-10-09' } })),
    toCloud(fleet([train(A, { u: 9, firstDay: '2026-11-01', earned: { maiden: '2026-10-05', dawn: '2026-11-01' } })], { earned: { fleet3: '2026-10-08', fleet6: '2026-11-01' } })));
  ok('成就聯集、日期取早的', js(Object.entries(row(m, A).value.earned).sort()) === js([['dawn', '2026-11-01'], ['east', '2026-10-03'], ['maiden', '2026-10-02']]));
  ok('車隊成就也一樣', row(m, 'fleet').value.earned.fleet3 === '2026-10-08' && row(m, 'fleet').value.earned.fleet6 === '2026-11-01');
  ok('首航日取早的', row(m, A).value.firstDay === '2026-10-01');

  // 刪除
  m = merge(toCloud(fleet([], { gone: [{ id: A, deletedAt: 9 }] })), toCloud(fleet([train(A, { u: 5 })])));
  ok('刪除比最後修改晚:不見了、墓碑留著', !row(m, A) && m.tombstones[0].id === A);
  m = merge(toCloud(fleet([train(A, { u: 5 })])), toCloud(fleet([], { gone: [{ id: A, deletedAt: 5 }] })));
  ok('同一刻算刪了', !row(m, A));
  m = merge(toCloud(fleet([train(A, { u: 9 })])), toCloud(fleet([], { gone: [{ id: A, deletedAt: 5 }] })));
  ok('刪了之後另一台又改過:車回來,改的人贏', !!row(m, A));
  m = merge(toCloud(fleet([], { gone: [{ id: A, deletedAt: 5 }] })), toCloud(fleet([], { gone: [{ id: A, deletedAt: 8 }] })));
  ok('墓碑時間取晚的', m.tombstones[0].deletedAt === 8);
  const many = Array.from({ length: 130 }, (_, i) => ({ id: 'my:gone' + String(i).padStart(4, '0'), deletedAt: i + 1 }));
  m = merge(toCloud(fleet([], { gone: many })), EMPTY);
  ok('墓碑最多留 100 筆,留新的', m.tombstones.length === 100 && !m.tombstones.some(t => t.deletedAt <= 30));

  // 股道
  m = merge(toCloud(fleet([train(A, { u: 5, track: 0 })])), toCloud(fleet([train(B, { u: 9, track: 0 })])));
  ok('股道撞號:id 小的留著,另一列補空股', row(m, A).value.track === 0 && row(m, B).value.track === 1);
  const ids = n => Array.from({ length: n }, (_, i) => 'my:train' + String(i).padStart(3, '0'));
  const eight = ids(8).map((id, i) => train(id, { u: i + 1, track: i % 6 }));
  m = merge(toCloud(fleet(eight.slice(0, 4))), toCloud(fleet(eight.slice(4))));
  const tracks = m.items.map(i => i.value.track);
  ok('超過六股:全部留著,多的待命', m.items.length === 8 && tracks.filter(t => t === null).length === 2 && new Set(tracks.filter(t => t !== null)).size === 6, js(tracks));
  const thirteen = ids(13).map((id, i) => train(id, { u: i + 1, track: i < 6 ? i : null }));
  m = merge(toCloud(fleet(thirteen)), EMPTY);
  ok('超過 12 列才丟,丟沒股道裡最舊的', m.items.length === 12 && !row(m, ids(13)[6]) && !!row(m, ids(13)[12]) && !!row(m, ids(13)[0]));
  m = merge(EMPTY, EMPTY);
  ok('兩邊都空:還是空的', m.items.length === 0 && m.tombstones.length === 0);
}

console.log('\n── 兩台隨機改,都要收斂 ──');
{
  let seed = 20261105;
  const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], HONORS = ['maiden', 'east', 'dawn', 'late'], FLEET = ['fleet3', 'fleet6'];
  let clock = 1000, serial = 0, bad = null, rounds = 0, written = 0;
  const edit = (dev, f, name) => {
    const id = () => f.trains[rnd(f.trains.length)];
    switch (rnd(7)) {
      case 0: { const t = id(); if (t) { t.u = ++clock; t.name = name + clock; } break; }
      case 1: { const t = id(); if (t) { t.u = ++clock; t.look = { mark: 'east', plate: rnd(2) ? 'bronze' : null }; } break; }
      case 2: { const t = id(); if (t) { const h = t.hand[dev] || { n: 0, km: 0, stops: 0, meets: 0 }; t.hand = { ...t.hand, [dev]: { ...h, n: h.n + 1, km: h.km + 10 } }; } break; }
      case 3: { const t = id(); if (t) { const day = DAYS[rnd(4)]; t.legs = [...t.legs.filter(l => l.day !== day), { ...LEG, day, km: 10 + rnd(5), meets: rnd(2) ? null : 3 }].sort((a, b) => (a.day < b.day ? -1 : 1)); } break; }
      case 4: { const t = id(); if (t) t.earned = { ...t.earned, [HONORS[rnd(4)]]: DAYS[rnd(4)] }; else f.earned = { ...f.earned, [FLEET[rnd(2)]]: DAYS[rnd(4)] }; break; }
      case 5: { const t = id(); if (t) { f.trains = f.trains.filter(x => x !== t); f.gone = [...f.gone, { id: t.id, deletedAt: ++clock }]; } break; }
      default: {
        const used = new Set(f.trains.map(t => t.track)), free = [0, 1, 2, 3, 4, 5].find(i => !used.has(i));
        f.trains = [...f.trains, train('my:r' + String(++serial).padStart(7, '0'), { u: ++clock, track: free === undefined ? null : free })];
      }
    }
  };
  for (; rounds < 400 && !bad; rounds++) {
    const start = clock, base = Array.from({ length: rnd(5) }, () => train('my:r' + String(++serial).padStart(7, '0'), { u: ++clock, track: 0 }));
    const shared = P.assignTracks(base);
    let a = fleet(clone(shared)), b = fleet(clone(shared)), cloud = clone(EMPTY);
    for (let i = rnd(6); i > 0; i--) edit(DEV_A, a, 'a');
    for (let i = rnd(6); i > 0; i--) edit(DEV_B, b, 'b');
    const fold = (dev, col) => {
      const out = (rounds < 8 ? merge : (x, y) => clone(P.fleetMerge(x, y)))(P.fleetToCloud(dev), col);
      if (!P.fleetSame(out, col)) written++;
      return out;
    };
    const step = (dev) => { cloud = fold(dev, cloud); return clone(P.fleetFromCloud(cloud, dev)); };
    a = step(a); b = step(b); a = step(a);
    const cloudNow = cloud;
    const quiet = P.fleetSame(fold(a, cloud), cloudNow) && P.fleetSame(fold(b, cloud), cloudNow);
    const same = P.fleetSame(P.fleetToCloud(a), P.fleetToCloud(b)) && P.fleetSame(P.fleetToCloud(a), cloud);
    const on = cloud.items.filter(i => i.id !== 'fleet').map(i => i.value.track).filter(t => t !== null);
    const tracksOk = new Set(on).size === on.length && on.every(t => t >= 0 && t < 6) && (cloud.items.filter(i => i.id !== 'fleet').length <= 6 ? on.length === cloud.items.filter(i => i.id !== 'fleet').length : on.length === 6);
    const deadOk = cloud.tombstones.every(t => !row(cloud, t.id) || row(cloud, t.id).updatedAt > t.deletedAt);
    if (!quiet || !same || !tracksOk || !deadOk) bad = { round: rounds, quiet, same, tracksOk, deadOk, start };
  }
  ok(`400 組隨機兩台改動同步三次後收斂,再同步不再寫`, !bad && rounds === 400, bad ? js(bad) : `寫入 ${written} 次`);
}

mkdirSync(path.join(ROOT, 'output/golden/mytrain'), { recursive: true });
writeFileSync(path.join(ROOT, 'output/golden/mytrain/sync.json'), js(golden));
console.log(`\ngolden ${golden.length} 筆 → output/golden/mytrain/sync.json`);

// ═══ 真介面 ═══
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

const KEY = 'trainmap-my-fleet-v1';
const cloud = new Map();
const flip = v => (Array.isArray(v) ? v.map(flip) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, flip(v[k])])) : v);
function cloudOp(op, arg) {
  if (op === 'get') return cloud.has(arg) ? flip(cloud.get(arg)) : null;
  const at = Date.now();
  for (const [k, v] of Object.entries(arg)) { const { updatedAt, ...doc } = v; cloud.set(k, { ...doc, __at: at }); }
  return true;
}
const fleetDoc = uid => cloud.get(`users/${uid}/data/mytrains`) || null;

const errors = [];
const externalNoise = (text, url) => /^https?:/.test(url || '') && !(url || '').startsWith(`http://127.0.0.1:${PORT}/`)
  || /^(Fetch API cannot load |Access to fetch at '?)https?:\/\/(?!127\.0\.0\.1)/.test(text);
async function device(browser, tag, seed = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.exposeBinding('__cloud', (_, op, arg) => cloudOp(op, arg));
  // Firebase 換成假模組,帳號初始化與 onAuthStateChanged 走真的。登入時機交給 login()。
  await ctx.addInitScript(() => {
    window.__io = { txns: 0, log: [], scheduled: 0, deny: false, mid: null };
    const denied = () => { const e = new Error('denied'); e.code = 'permission-denied'; return e; };
    // Firestore SDK 收到這兩種值會丟錯,假雲端照做,才測得到真的寫得上去。
    const legal = (v, where, inArray) => {
      if (v === undefined) throw new Error('undefined at ' + where);
      if (Array.isArray(v)) { if (inArray) throw new Error('nested array at ' + where); v.forEach((x, i) => legal(x, `${where}[${i}]`, true)); }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) legal(x, `${where}.${k}`, false);
    };
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { window.__authCb = cb; },
      doc: (db, ...segs) => ({ key: segs.join('/'), kind: segs[segs.length - 1] }),
      serverTimestamp: () => ({ __server: true }),
      runTransaction: async (db, fn) => {
        const reads = [], writes = {};
        const tx = {
          get: async ref => {
            if (window.__io.deny && ref.kind === 'mytrains') throw denied();
            reads.push(ref.kind);
            const d = await window.__cloud('get', ref.key);
            return { exists: () => !!d, data: () => d && { ...d, updatedAt: { toMillis: () => d.__at } } };
          },
          set: (ref, data) => { legal(data, ref.kind); writes[ref.key] = data; },
        };
        const out = await fn(tx);
        if (window.__io.mid) { const f = window.__io.mid; window.__io.mid = null; f(); }
        await window.__cloud('commit', writes);
        window.__io.txns++;
        window.__io.log.push({ reads, wrote: Object.keys(writes).map(k => k.split('/').pop()) });
        return out;
      },
    };
  });
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries({ 'trainmap-howto-seen': '1', 'trainmap-language': 'zh-TW', 'trainmap-powersave': '0', 'trainmap-fprail-min': '0', ...s })) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const u = (m.location() || {}).url;
    if (!externalNoise(m.text(), u)) errors.push(`[${tag}] ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  return { ctx, page };
}
const ready = page => page.waitForFunction(() => {
  try { return typeof state !== 'undefined' && state.ready && state.trains.length > 0 && typeof MyTrainUI !== 'undefined'; }
  catch (e) { return false; }
}, null, { timeout: 45000 });

// 登入:走真的 onAuthStateChanged,裡面會跑登入那次同步。
const login = (page, uid) => page.evaluate(async uid => {
  window.plusIsActive = () => true;
  window.plusReconcileEntitlement = async () => false;
  if (!window.__wrapped) {
    window.__wrapped = true;
    const real = accountScheduleSync;
    window.accountScheduleSync = () => { window.__io.scheduled++; real(); };
  }
  await accountEnsureInit();
  await window.__authCb({ uid, email: 'x@example.com' });
}, uid);
const sync = page => page.evaluate(async () => {
  while (state.account.syncing) await new Promise(r => setTimeout(r, 20));
  const n = window.__io.log.length, ok = await accountSyncNow('login');
  return { ok, err: state.account.actionError, legacy: !!state.account.legacyKinds, last: window.__io.log[window.__io.log.length - 1] || null, ran: window.__io.log.length - n };
});
// 等按鈕排的那一次同步跑完,要真的等到,不靠手動呼叫。
const autoSync = (page, n) => page.waitForFunction(n => window.__io.txns >= n && !state.account.syncing, n, { timeout: 8000 });
const txns = page => page.evaluate(() => window.__io.txns);
const addTrain = (page, name, from, to, hours) => page.evaluate(([name, from, to, hours]) => {
  const key = n => MyTrainPlan.stationKey('tra_sched', n);
  const train = { id: 'my:' + crypto.randomUUID(), name, modelId: 'emu800', sys: 'tra_sched', from: key(from), to: key(to), via: null, dir: null, pattern: 'all',
    depSec: Math.floor(nowSecOfDay() / 60 + hours * 60) * 60 % 86400, color: '#2E6FB0' };
  if (!ownTrainDepart(train)) return null;
  if (state.followTrain) clearFollow();
  return train.id;
}, [name, from, to, hours]);
const fleetOf = page => page.evaluate(() => MyTrainUI.load());
const trainOf = (f, id) => f.trains.find(t => t.id === id);
const onMap = page => page.evaluate(() => state.myTrains.filter(r => !r._ownRun).map(r => r.label));

const browser = await chromium.launch();
try {
  const U = 'uid-commuter';
  const phone = await device(browser, 'phone', { 'trainmap-account-uid': U, 'trainmap-account-last-uid': U });
  const pc = await device(browser, 'pc', { 'trainmap-account-uid': U, 'trainmap-account-last-uid': U });
  await login(phone.page, U);

  console.log('\n── 手機排車,電腦看得到 ──');
  const first = await phone.page.evaluate(() => window.__io.log[0]);
  ok('沒車的人登入時讀一次車隊文件、不寫', !!first && first.reads.includes('mytrains') && !first.wrote.includes('mytrains') && !fleetDoc(U), js(first));
  let r = await sync(phone.page);
  ok('沒車的人第二次同步不讀不寫', r.ok && !r.last.reads.includes('mytrains') && !r.last.wrote.includes('mytrains'), js(r.last.reads));

  let n = await txns(phone.page);
  const id = await addTrain(phone.page, '一號', '臺北', '七堵', 6);
  await autoSync(phone.page, n + 1);
  const doc = fleetDoc(U), item = doc && doc.items.find(i => i.id === id);
  ok('手機排一列車,不用手動就傳上雲端', !!item && item.value.name === '一號' && item.updatedAt > 0, js(doc && doc.items.map(i => i.id)));
  ok('文件的欄位跟 rules 白名單一致', doc && js(Object.keys(doc).filter(k => k !== '__at').sort()) === js(['clientUpdatedAt', 'items', 'kind', 'revision', 'tombstones', 'version']) && doc.kind === 'mytrains' && doc.version === 1
    && Number.isInteger(doc.revision) && Number.isInteger(doc.clientUpdatedAt), js(doc && Object.keys(doc)));
  ok('上雲的內容沒有 outRun、judged、u', item && !('outRun' in item.value) && !('judged' in item.value) && !('u' in item.value), item && js(Object.keys(item.value)));

  const before = await pc.page.evaluate(() => MyTrainUI.load().trains.length);
  await login(pc.page, U);
  let f = await fleetOf(pc.page);
  ok('電腦登入之前車隊是空的(對照)', before === 0);
  ok('電腦登入後拿到那列車,地圖上跑起來', trainOf(f, id)?.name === '一號' && (await onMap(pc.page)).length === 1, js(await onMap(pc.page)));
  const down = await pc.page.evaluate(() => window.__io.log[0]);
  ok('電腦下載之後不回寫', !!down && !down.wrote.includes('mytrains'), js(down));
  r = await sync(pc.page);
  ok('內容相同再同步不寫', r.ok && r.last.reads.includes('mytrains') && !r.last.wrote.includes('mytrains'), js(r.last.wrote));

  console.log('\n── 寫回不會繞圈 ──');
  const quiet = async page => {
    const before = await page.evaluate(() => [window.__io.scheduled, window.__io.txns]);
    await page.waitForTimeout(2600);
    const after = await page.evaluate(() => [window.__io.scheduled, window.__io.txns]);
    return js(before) === js(after);
  };
  ok('收到別台的車之後,電腦沒有再排同步', await quiet(pc.page));

  console.log('\n── 兩邊各發一次車 ──');
  const depart = (page, id) => page.evaluate(id => {
    if (state.followTrain) clearFollow();
    jumpToNow();
    const blocked = ownTrainHandBlock(MyTrainUI.load().trains.find(t => t.id === id));
    return { blocked, rec: !!ownTrainHandDepart(id) };
  }, id);
  n = await txns(phone.page);
  let d = await depart(phone.page, id);
  await autoSync(phone.page, n + 1);
  ok('手機親手發一趟', d.rec, js(d));
  n = await txns(pc.page);
  d = await depart(pc.page, id);
  await autoSync(pc.page, n + 1);
  ok('電腦也親手發一趟', d.rec, js(d));
  await sync(phone.page);
  const [fp, fc] = [await fleetOf(phone.page), await fleetOf(pc.page)];
  const handOf = x => trainOf(x, id).hand;
  ok('兩邊各發一次車都留著', Object.keys(handOf(fp)).length === 2 && Object.values(handOf(fp)).every(h => h.n === 1) && js(Object.entries(handOf(fp)).sort()) === js(Object.entries(handOf(fc)).sort()), js(handOf(fp)));
  ok('手機的進行中那一趟還在自己手上', !!trainOf(fp, id).outRun && !!trainOf(fc, id).outRun);
  ok('兩台的裝置 id 各自留著', fp.device && fc.device && fp.device !== fc.device);

  console.log('\n── 外觀與排班取新的 ──');
  const setLook = (page, id, look) => page.evaluate(([id, look]) => ownTrainSetLook(id, look), [id, look]);
  n = await txns(phone.page);
  await setLook(phone.page, id, { mark: 'east', plate: null });
  await autoSync(phone.page, n + 1);
  await sync(pc.page);
  ok('手機換頭牌,電腦拿到', trainOf(await fleetOf(pc.page), id).look.mark === 'east');
  n = await txns(pc.page);
  await setLook(pc.page, id, { mark: 'maiden', plate: 'bronze' });
  await autoSync(pc.page, n + 1);
  await sync(phone.page);
  ok('電腦後改的蓋過手機', js(trainOf(await fleetOf(phone.page), id).look) === js({ mark: 'maiden', plate: 'bronze' }));

  n = await txns(pc.page);
  const moved = await pc.page.evaluate(id => {
    const t = MyTrainUI.load().trains.find(x => x.id === id);
    return ownTrainEdit({ ...t, name: '改名', depSec: (t.depSec + 3600) % 86400 }) ? (t.depSec + 3600) % 86400 : null;
  }, id);
  await autoSync(pc.page, n + 1);
  await sync(phone.page);
  const shown = await phone.page.evaluate(id => ({ dep: ownTrainRecord(id)?.stops[0].depSec, name: MyTrainUI.load().trains.find(x => x.id === id)?.name }), id);
  ok('改排班傳過去,地圖上的時刻跟著換', shown.dep === moved && shown.name === '改名', js({ shown, moved }));

  console.log('\n── 刪除 ──');
  n = await txns(phone.page);
  const gone = await phone.page.evaluate(id => ownTrainDelete(ownTrainRecord(id)), id);
  await autoSync(phone.page, n + 1);
  ok('手機刪掉,雲端的車不見、墓碑留著', gone && !fleetDoc(U).items.some(i => i.id === id) && fleetDoc(U).tombstones.some(t => t.id === id), js(fleetDoc(U).tombstones));
  await pc.page.evaluate(() => { if (state.followTrain) clearFollow(); });
  await sync(pc.page);
  ok('電腦同步後也不見,地圖上沒了', !trainOf(await fleetOf(pc.page), id) && (await onMap(pc.page)).length === 0);
  await sync(phone.page);
  ok('再同步不會復活', !trainOf(await fleetOf(phone.page), id) && !fleetDoc(U).items.some(i => i.id === id));
  const follow = await addTrain(pc.page, '跟著的', '臺北', '七堵', 6);
  await sync(pc.page);
  await sync(phone.page);
  await pc.page.evaluate(id => ownTrainFollow({ id }), follow);
  n = await txns(phone.page);
  await phone.page.evaluate(id => ownTrainDelete(ownTrainRecord(id)), follow);
  await autoSync(phone.page, n + 1);
  await sync(pc.page);
  ok('正在跟的車被別台刪掉:跟車收掉,不留死狀態', await pc.page.evaluate(() => state.followTrain === null || !isMyTrain(state.followTrain)));

  console.log('\n── 超過六股 ──');
  const V = 'uid-eight';
  await login(phone.page, V);
  await login(pc.page, V);
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  const fromPhone = [], fromPc = [];
  for (const x of names.slice(0, 4)) fromPhone.push(await addTrain(phone.page, x, '臺北', '七堵', 6));
  for (const x of names.slice(4)) fromPc.push(await addTrain(pc.page, x, '臺北', '七堵', 8));
  await sync(phone.page);
  await sync(pc.page);
  await sync(phone.page);
  const eightA = await fleetOf(phone.page), eightB = await fleetOf(pc.page);
  const tracksOf = x => x.trains.map(t => t.track);
  ok('手機四列加電腦四列:八列都留著,六列有股道、兩列待命', eightA.trains.length === 8 && tracksOf(eightA).filter(t => t === null).length === 2 && new Set(tracksOf(eightA).filter(t => t !== null)).size === 6, js(tracksOf(eightA)));
  ok('兩台的股道一樣', js(eightA.trains.map(t => [t.id, t.track]).sort()) === js(eightB.trains.map(t => [t.id, t.track]).sort()));
  ok('地圖上只跑六列', (await onMap(phone.page)).length === 6, String((await onMap(phone.page)).length));
  ok('機務段車隊數字看得到待命', await phone.page.evaluate(() => ownTrainDepotHost().fleet().standby) === 2);
  const standby = eightA.trains.find(t => t.track === null).id, onTrack = eightA.trains.find(t => t.track !== null);
  n = await txns(phone.page);
  await phone.page.evaluate(id => ownTrainDelete(ownTrainRecord(id)), onTrack.id);
  await autoSync(phone.page, n + 1);
  await sync(pc.page);
  await sync(phone.page);
  const seven = await fleetOf(pc.page);
  ok('刪一列:待命的車補進空股,兩台一樣', seven.trains.length === 7 && tracksOf(seven).filter(t => t === null).length === 1 && js((await fleetOf(phone.page)).trains.map(t => [t.id, t.track]).sort()) === js(seven.trains.map(t => [t.id, t.track]).sort()), js(tracksOf(seven)));
  ok('被遞補的車上了地圖', Number.isInteger(trainOf(seven, standby)?.track) && (await onMap(pc.page)).length === 6, js(trainOf(seven, standby)?.track));

  console.log('\n── 重開頁 ──');
  await pc.page.reload({ waitUntil: 'domcontentloaded' });
  await ready(pc.page);
  await login(pc.page, V);
  ok('重開頁:車都在,地圖上六列,內容沒變就不寫', (await fleetOf(pc.page)).trains.length === 7 && (await onMap(pc.page)).length === 6
    && await pc.page.evaluate(() => window.__io.log.length > 0 && !window.__io.log.some(x => x.wrote.includes('mytrains'))));

  console.log('\n── 換人登入 ──');
  const W = 'uid-stranger';
  await login(pc.page, W);
  r = await sync(pc.page);
  f = await fleetOf(pc.page);
  ok('同一台換別人登入:上一個人的車不進新帳號的雲端', r.ok && !fleetDoc(W) && f.trains.length === 0, `trains=${f.trains.length}`);
  ok('地圖上的車跟著換掉', (await onMap(pc.page)).length === 0);
  await login(pc.page, V);
  ok('換回來之前先登出:車收掉', await pc.page.evaluate(async () => { await window.__authCb(null); return state.myTrains.length === 0 && MyTrainUI.load().trains.length === 0; }));
  await login(pc.page, V);
  f = await fleetOf(pc.page);
  ok('換回來,自己的車都在', f.trains.length === 7 && (await onMap(pc.page)).length === 6, `trains=${f.trains.length}`);

  const guest = { v: 1, appearance: { haloOn: true, haloSize: 'std' }, device: null, earned: {},
    trains: [{ ...train('my:guest000'), from: 'tra_sched|臺北', to: 'tra_sched|七堵', look: { mark: null, plate: null } }] };
  const stranger = await device(browser, 'stranger', { [KEY]: js(guest), 'trainmap-account-last-uid': 'uid-a' });
  await login(stranger.page, 'uid-b');
  r = await sync(stranger.page);
  const left = await stranger.page.evaluate(k => JSON.parse(localStorage.getItem(k)).trains.length, KEY);
  ok('裝置上一個是 A,B 登入:共用存檔不進 B 的分區和雲端,共用那份也不動', r.ok && (await fleetOf(stranger.page)).trains.length === 0 && !fleetDoc('uid-b') && left === 1, `left=${left}`);
  // 中間換過人,上一個登入的已經不是 A 了,A 回來還是要接得到自己的車。
  await stranger.page.evaluate(() => window.__authCb(null));
  await login(stranger.page, 'uid-a');
  r = await sync(stranger.page);
  f = await fleetOf(stranger.page);
  ok('中間換過 B,A 回來接手共用存檔並傳上自己的雲端', r.ok && f.trains.length === 1 && fleetDoc('uid-a')?.items?.length === 1, `trains=${f.trains.length} doc=${js(fleetDoc('uid-a')?.items?.map(i => i.id))}`);
  await login(stranger.page, 'uid-c');
  ok('第三個人登入還是空的', (await fleetOf(stranger.page)).trains.length === 0);
  await login(stranger.page, 'uid-a');
  const owned = await stranger.page.evaluate(([k, uid]) => {
    accountClearLocal(uid);
    return Object.keys(localStorage).filter(x => x === k || x === k + ':uid:' + uid || x.startsWith('trainmap-my-train') || x === 'trainmap-my-fleet-owner');
  }, [KEY, 'uid-a']);
  ok('本人刪帳號:分區、共用那份、主人紀錄都清掉', owned.length === 0, js(owned));
  await stranger.ctx.close();

  // 共用那份是 B 的,還沒上過雲。A 在這台刪帳號不能連 B 的車一起刪,那是唯一一份。
  const shared = await device(browser, 'shared', { [KEY]: js(guest), 'trainmap-account-last-uid': 'uid-kept' });
  await login(shared.page, 'uid-leaving');
  ok('B 的車不進 A 的分區', (await fleetOf(shared.page)).trains.length === 0);
  const kept = await shared.page.evaluate(([k, uid]) => { accountClearLocal(uid); return !!localStorage.getItem(k) && !localStorage.getItem(k + ':uid:' + uid); }, [KEY, 'uid-leaving']);
  ok('A 刪帳號清自己的分區,共用那份留著', kept);
  await shared.page.evaluate(() => window.__authCb(null));
  await login(shared.page, 'uid-kept');
  r = await sync(shared.page);
  ok('B 回來接手自己的車', r.ok && (await fleetOf(shared.page)).trains.length === 1 && fleetDoc('uid-kept')?.items?.length === 1);
  await shared.ctx.close();
  const owner = await device(browser, 'owner', { [KEY]: js(guest), 'trainmap-account-uid': 'uid-a', 'trainmap-account-last-uid': 'uid-a' });
  await login(owner.page, 'uid-a');
  r = await sync(owner.page);
  ok('本人更新到新版:舊存檔(沒有 u、沒有 gone)接手進分區並上傳', r.ok && (await fleetOf(owner.page)).trains.length === 1 && fleetDoc('uid-a')?.items.length === 1
    && await owner.page.evaluate(k => !!localStorage.getItem(k + ':uid:uid-a'), KEY));

  console.log('\n── 邊界 ──');
  await owner.page.evaluate(() => {
    window.__io.mid = () => {
      const cur = MyTrainUI.load();
      MyTrainUI.save({ ...cur, trains: [...cur.trains, { ...cur.trains[0], id: 'my:midmidmid', name: '半路', track: 1, u: Date.now() }] });
    };
  });
  await owner.page.evaluate(() => {
    const cur = MyTrainUI.load();
    MyTrainUI.save({ ...cur, trains: cur.trains.map(t => ({ ...t, u: Date.now(), name: '先改' })) });
  });
  r = await sync(owner.page);
  f = await fleetOf(owner.page);
  ok('交易進行中排的車,寫回之後還在', r.ok && !!trainOf(f, 'my:midmidmid') && trainOf(f, 'my:guest000').name === '先改', js(f.trains.map(t => t.name)));
  r = await sync(owner.page);
  ok('下一次同步把它傳上去', r.ok && fleetDoc('uid-a').items.some(i => i.id === 'my:midmidmid'));

  await owner.page.evaluate(() => { window.__io.deny = true; state.account.legacyKinds = false; state.account.fleetUid = null; });
  r = await sync(owner.page);
  const deny = await owner.page.evaluate(() => window.__io.log.at(-1));
  ok('rules 還沒放行:退回舊清單,其他資料照常同步,本機的車不動', r.ok && r.legacy && !deny.reads.includes('mytrains') && deny.wrote.includes('rides') && (await fleetOf(owner.page)).trains.length === 2, js({ r, deny }));
  await owner.ctx.close();

  console.log('\n── 刪帳號 ──');
  const before2 = await phone.page.evaluate(k => Object.keys(localStorage).filter(x => x.startsWith(k)), KEY);
  const del = await phone.page.evaluate(async ([uid, k]) => {
    const src = accountDelete.toString();
    const m = src.match(/for \(const collection of \['users', 'sandboxUsers'\]\) \{[\s\S]*?\n    \}\n/);
    if (!m) return { error: 'loop not found' };
    const out = {};
    for (const deny of [false, true]) {
      const deleted = [];
      const a = { fb: { doc: (db, ...s) => s.join('/'), deleteDoc: async p => {
        if (deny && /\/mytrains$/.test(p)) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
        deleted.push(p);
      } }, db: {} };
      try { await (new Function('a', 'u', `return (async () => { ${m[0]} })();`))(a, { uid }); out[deny ? 'denied' : 'allowed'] = deleted; }
      catch (e) { out[deny ? 'denied' : 'allowed'] = 'THREW ' + e.message; }
    }
    accountClearLocal(uid);
    out.left = Object.keys(localStorage).filter(x => x.startsWith(k) && (x === k || x.endsWith(uid)));
    return out;
  }, [V, KEY]);
  ok('刪帳號前本機有這個人的分區(對照)', before2.includes(`${KEY}:uid:${V}`), js(before2));
  ok('刪帳號連正式與 Sandbox 的車隊文件一起刪', Array.isArray(del.allowed) && del.allowed.includes(`users/${V}/data/mytrains`) && del.allowed.includes(`sandboxUsers/${V}/data/mytrains`), js(del.allowed));
  ok('rules 還沒放行時不卡住刪帳號', Array.isArray(del.denied) && del.denied.includes(`users/${V}/data/rides`), js(del.denied));
  ok('刪帳號清掉這個人的本機車隊', Array.isArray(del.left) && del.left.length === 0, js(del.left));
} finally {
  await browser.close();
  server.close();
}
ok('全程沒有 pageerror、console error', errors.length === 0, errors.slice(0, 3).join(' | '));

// 判準數寫死:少跑幾條不能自動通過。
const EXPECTED = 82;
const pass = results.filter(x => x.pass).length;
if (results.length !== EXPECTED) { console.log(`FAIL 執行項數 ${results.length} != 預期 ${EXPECTED}`); process.exit(1); }
console.log(`\n合計 ${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);

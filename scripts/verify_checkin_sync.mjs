// issue #72:電腦登入後「通勤的證明」「老通勤族」是 0、手機有——打卡／路段(checkins／segments)
// 從沒接上帳號同步。本檔驗 2026-09-23 接上之後的行為:Playwright 真引擎＋本機靜態伺服器,
// Firestore 用記憶體假雲端(doc/runTransaction/serverTimestamp stub,沿用 verify_account_sync_race 慣例)。
//
// 判準對應使用者真正會做的事:手機搭車累積路段 → 同步 → 電腦登入同一帳號 → 成就亮起。
//   C1  手機(舊版留在共用 key 的路段 n=120)同步後,雲端 segments 文件有那一段、n=120
//   C2  電腦(全新裝置)同一帳號同步後,maxSeg=120、commute100 亮、commute500 不亮
//   C3  陌生人防護:裝置上一個驗證身分是 A,B 登入同步 ⇒ A 的路段不進 B 的雲端、B 分區是空的
//   C4  示範資料(demo:1)永不上傳
//   C5  rules 還沒放行(permission-denied)⇒ 退回舊清單重試成功、favs 照常上傳
//   C6  交易進行中又走過一段 ⇒ 寫回後本機同時有雲端那段與剛寫的那段(不被快照蓋掉)
//   C7  刪帳號:checkins／segments 文件被刪;被 rules 擋(permission-denied)不會讓刪帳號失敗
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const PORT = Number(process.env.PORT || 5471);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
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
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/?plus=1`;

const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const errors = [];
const SEG = 'tra_sched|WL|臺北|萬華';
const U = 'uid-commuter', A = 'uid-a', B = 'uid-b';

// 一台「裝置」＝一個獨立 context(localStorage 不共用);seed 在頁面載入前寫進 localStorage。
async function device(browser, tag, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('trainmap-howto-seen', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed || {});
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] ${e}`));
  await page.goto(BASE);
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  return { ctx, page };
}
// 在頁內裝好帳號狀態與假雲端;cloud 由 Node 端傳入、同步後讀回,跨裝置共用同一份。
async function sync(page, uid, cloud, opts = {}) {
  return page.evaluate(async ({ uid, cloud, opts }) => {
    window.plusIsActive = () => true;
    window.plusReconcileEntitlement = async () => false;
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0, loggingOut: false, syncPromise: null,
      user: { uid, email: 'x@example.com' }, auth: {}, db: {},
    };
    const store = cloud;
    const attempts = [];
    state.account.fb = {
      doc: (db, ...segs) => ({ key: segs.join('/'), kind: segs[segs.length - 1] }),
      serverTimestamp: () => ({ __server: true }),
      runTransaction: async (db, fn) => {
        const writes = {}, kinds = [];
        const tx = {
          get: async ref => { kinds.push(ref.kind); const d = store[ref.key]; return { exists: () => !!d, data: () => d && { ...d, updatedAt: { toMillis: () => d.__at } } }; },
          set: (ref, data) => { writes[ref.key] = data; },
        };
        const out = await fn(tx);
        attempts.push(kinds.slice());
        if (opts.denyCheckins && kinds.some(k => k === 'checkins' || k === 'segments')) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
        if (opts.midWrite) opts.midWrite = eval(opts.midWrite)();
        const now = Date.now();
        for (const [k, v] of Object.entries(writes)) store[k] = { ...v, updatedAt: undefined, __at: now };
        return out;
      },
    };
    const okSync = await accountSyncNow('login');
    return { okSync, cloud: store, attempts, legacy: !!state.account.legacyKinds, err: state.account.actionError };
  }, { uid, cloud, opts });
}
const segDoc = (cloud, uid) => cloud[`users/${uid}/data/segments`];
const segItem = (cloud, uid, k) => ((segDoc(cloud, uid) || {}).items || []).find(x => x.id === k);

const browser = await chromium.launch();
try {
  const cloud = {};
  // ── C1:手機。舊版把路段存在共用 key(沒分區),本人就是上一個驗證身分 ⇒ 分區繼承、同步上傳
  const phoneSeed = {
    'trainmap-checkins-v1': JSON.stringify({ v: 2, st: { 'tra_sched|臺北': { name: '臺北', sys: 'tra_sched', s: 'pass', n: 3, d: '2026-09-20', u: 1_758_000_000_000 } },
      sg: { [SEG]: { n: 120, nv: 40, u: 1_758_000_000_000 } } }),
    'trainmap-account-uid': U, 'trainmap-account-last-uid': U,
  };
  const phone = await device(browser, 'phone', phoneSeed);
  const r1 = await sync(phone.page, U, cloud);
  Object.assign(cloud, r1.cloud);
  const it1 = segItem(cloud, U, SEG);
  ok('C1 手機同步後雲端 segments 有那一段且 n=120', r1.okSync && it1 && it1.value.n === 120 && it1.value.nv === 40,
    `ok=${r1.okSync} item=${JSON.stringify(it1)} err=${r1.err}`);
  ok('C1b 雲端 checkins 文件也有那座站', !!((cloud[`users/${U}/data/checkins`] || {}).items || []).find(x => x.id === 'tra_sched|臺北'));
  await phone.ctx.close();

  // ── C2:電腦(全新)同一帳號
  const pc = await device(browser, 'pc', { 'trainmap-account-uid': U, 'trainmap-account-last-uid': U });
  const before = await pc.page.evaluate(() => achContext(userDataLoadCollection('rides')).x.maxSeg);
  const r2 = await sync(pc.page, U, cloud);
  Object.assign(cloud, r2.cloud);
  const after = await pc.page.evaluate(() => {
    const rides = userDataLoadCollection('rides'), ctx = achContext(rides);
    return { maxSeg: ctx.x.maxSeg, c100: ACH_TESTS.commute100(rides, ctx.coll, ctx.km, ctx.x), c500: ACH_TESTS.commute500(rides, ctx.coll, ctx.km, ctx.x),
      stn: !!loadCheckins().st['tra_sched|臺北'] };
  });
  ok('C2 電腦同步前 maxSeg=0(對照:確實是 #72 的起點)', before === 0, `before=${before}`);
  ok('C2 電腦同步後 maxSeg=120、通勤的證明亮、老通勤族不亮、打卡站也帶過來',
    r2.okSync && after.maxSeg === 120 && after.c100 === true && after.c500 === false && after.stn, JSON.stringify(after));
  await pc.ctx.close();

  // ── C3:陌生人防護
  const cloud3 = {};
  const shared = await device(browser, 'shared', {
    'trainmap-checkins-v1': JSON.stringify({ v: 2, st: {}, sg: { [SEG]: { n: 77, nv: 0, u: 1_758_000_000_000 } } }),
    'trainmap-account-uid': B, 'trainmap-account-last-uid': A,
  });
  const r3 = await sync(shared.page, B, cloud3);
  const b3 = await shared.page.evaluate(({ B }) => ({ own: Object.keys(loadCheckins(B).sg).length, guest: Object.keys(loadCheckins(null).sg).length }), { B });
  ok('C3 上一個身分是 A,B 登入同步:A 的路段不進 B 的雲端、B 分區空、共用 key 原封不動',
    r3.okSync && !segItem(r3.cloud, B, SEG) && b3.own === 0 && b3.guest === 1, `cloudItem=${JSON.stringify(segItem(r3.cloud, B, SEG))} ${JSON.stringify(b3)}`);
  await shared.ctx.close();

  // ── C4:示範資料
  const demo = await device(browser, 'demo', {
    [`trainmap-checkins-v1:uid:${U}`]: JSON.stringify({ v: 2, demo: 1, st: {}, sg: { [SEG]: { n: 121, nv: 0, u: 1 } } }),
    'trainmap-account-uid': U, 'trainmap-account-last-uid': U,
  });
  const r4 = await sync(demo.page, U, {});
  ok('C4 demo:1 的收集不上傳(雲端沒有 segments 文件)、其餘照常同步', r4.okSync && !segDoc(r4.cloud, U) && !!r4.cloud[`users/${U}/data/favs`],
    `keys=${Object.keys(r4.cloud).join(',')}`);
  await demo.ctx.close();

  // ── C5:rules 還沒部署
  const leg = await device(browser, 'legacy', phoneSeed);
  const r5 = await sync(leg.page, U, {}, { denyCheckins: true });
  ok('C5 rules 擋新 kind ⇒ 退回舊清單重試成功、legacyKinds=true、雲端沒有 segments',
    r5.okSync && r5.legacy && r5.attempts.length === 2 && !r5.attempts[1].includes('segments') && !segDoc(r5.cloud, U) && !!r5.cloud[`users/${U}/data/rides`],
    `attempts=${JSON.stringify(r5.attempts)} legacy=${r5.legacy} err=${r5.err}`);
  await leg.ctx.close();

  // ── C6:交易進行中又寫了一段
  const NEW = 'tra_sched|WL|萬華|板橋';
  const mid = await device(browser, 'mid', { 'trainmap-account-uid': U, 'trainmap-account-last-uid': U });
  const midWrite = `() => { const c = loadCheckins('${U}'); c.sg['${NEW}'] = { n: 1, nv: 0, u: Date.now() + 5 }; saveCheckins(c, '${U}'); return null; }`;
  const r6 = await sync(mid.page, U, JSON.parse(JSON.stringify(cloud)), { midWrite });
  const sg6 = await mid.page.evaluate(({ U }) => loadCheckins(U).sg, { U });
  ok('C6 交易途中新寫的那段在寫回後仍在,雲端那段也帶回來了', r6.okSync && sg6[NEW] && sg6[NEW].n === 1 && sg6[SEG] && sg6[SEG].n === 120,
    JSON.stringify(Object.fromEntries(Object.entries(sg6).map(([k, v]) => [k, v.n]))));
  await mid.ctx.close();

  // ── C7:刪帳號
  const del = await device(browser, 'delete', { 'trainmap-account-uid': U, 'trainmap-account-last-uid': U });
  const r7 = await del.page.evaluate(async ({ U }) => {
    const out = {};
    for (const deny of [false, true]) {
      const deleted = [];
      const src = accountDelete.toString();
      // 只驗刪文件那段迴圈的行為:把它原樣抽出來跑(整支 accountDelete 需要真的 reauth,stub 不值得)
      const m = src.match(/for \(const collection of \['users', 'sandboxUsers'\]\) \{[\s\S]*?\n    \}\n/);
      if (!m) return { error: 'loop not found' };
      const a = { fb: { doc: (db, ...s) => s.join('/'), deleteDoc: async p => {
        if (deny && /\/(checkins|segments)$/.test(p)) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
        deleted.push(p);
      } }, db: {} };
      const u = { uid: U };
      try { await (new Function('a', 'u', 'USER_DATA_COLLECTIONS', 'CHECKIN_SYNC_KINDS', `return (async () => { ${m[0]} })();`))(a, u, USER_DATA_COLLECTIONS, CHECKIN_SYNC_KINDS); out[deny ? 'denied' : 'allowed'] = deleted; }
      catch (e) { out[deny ? 'denied' : 'allowed'] = 'THREW ' + e.message; }
    }
    return out;
  }, { U });
  ok('C7 刪帳號會刪 checkins／segments;被 rules 擋時不拋錯、其餘文件照刪',
    Array.isArray(r7.allowed) && r7.allowed.includes(`users/${U}/data/segments`) && r7.allowed.includes(`sandboxUsers/${U}/data/checkins`)
    && Array.isArray(r7.denied) && r7.denied.includes(`users/${U}/data/rides`) && !r7.denied.some(p => /segments$/.test(p)),
    JSON.stringify({ allowed: Array.isArray(r7.allowed) ? r7.allowed.length : r7.allowed, denied: Array.isArray(r7.denied) ? r7.denied.length : r7.denied }));
  await del.ctx.close();
} finally {
  await browser.close();
  server.close();
}
ok('G1 全程沒有 pageerror', errors.length === 0, errors.slice(0, 3).join(' | '));
const EXPECTED = 10;
const pass = results.filter(Boolean).length;
if (results.length !== EXPECTED) { console.log(`FAIL 執行項數 ${results.length} != 預期 ${EXPECTED}`); process.exit(1); }
console.log(`合計 ${pass} PASS / ${results.length - pass} FAIL`);
process.exit(pass === results.length ? 0 : 1);

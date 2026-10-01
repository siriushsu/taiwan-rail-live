// 路段懸賞 v2 · 網頁端「懸賞身分、籌碼讀取與快取、護照籌碼列、網頁錄程收斂」驗收
// ——Playwright 真引擎（無視窗）＋ node 靜態伺服器 ＋ 打樁的 Firebase 與 /api。
//
// 驗的是 index.html 的行為，量的是瀏覽器【實際發出的請求、實際寫進 localStorage 的值、實際畫在護照裡的字】，
// 不是原始碼裡有沒有那串字。每個「0 次／不在」都有對照組（同一個環境下改一個輸入就會出現），
// 每個「不送」的情境都有 fixture 判準證明情境真的成立，不會因為登入根本沒發生而假綠。
//
// 範圍（對應 docs/bounty/contract-v2.md 的身分規則、chips-me、bounty-merge）：
//   CH1  護照籌碼列：餘額 0／5／50、下一座、雲端搭乘進度、每日上限；舊點數那一格不在 DOM
//   CH2  全部場景都解鎖時不顯示「下一座」（比 unlocked 數與 chips.scenes 數，不看 nextCost）
//   CH3  籌碼列的字與通行證狀態無關（state.plus.active 真／假逐字相同）
//   CH4  請求：沒登入 0 次；登入後帶 Bearer、不帶 ?actor=；開機已登入／登入／合併完成各讀一次
//   CH5  身分：409 merged_elsewhere 與 403 wrong_account → 換新的懸賞 actor、再併一次；同一次登入只換一次
//   CH6  登出：併過的 actor 換新、籌碼快取與記憶體清掉；在途的回應不會在登出後寫回快取
//   CH7  懸賞旗標關：開機清掉籌碼快取、沒有籌碼列、0 次 chips-me、不寫新的 actor key
//   CH8  上傳佇列：400 app_only 是終態（清掉、不重送）；其他錯誤照舊保留
//   CH9  看板收滿的卡：有「已收滿」說明、沒有接單鈕
//   CH10 錄程入口：懸賞開著時不啟動定位取樣、改顯示「要用 App」的說明
//   CH11 手機版：360／375／414／768 × Chromium／WebKit，真觸控點開護照（底部分頁列的「護照」）
//   CH12 快取與 actor 的邊界（401 清、503 留、存不下、第一次沿用裝置 id、英文介面沒有漏翻）
//
// 打樁慣例照 scripts/verify_bounty_merge_web.mjs：window.RAIL_FIREBASE_CONFIG＋window.RAIL_FIREBASE_TEST_MODULES；
// localStorage['trainmap-account-uid'] 讓開機走 accountEnsureInit（回訪者分支）。
// 跑法：node scripts/verify_bounty_chips_web.mjs（自己在空的埠起靜態伺服器、跑完自己關）
//   CHIPS_SHOT_DIR=<目錄>   手機版每個組合存一張截圖（不設就不存）
//   CHIPS_ONLY=CH5,CH6      只跑指定的組（開發時用；閘門一律不設）
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// G0 自檢：ROOT 由本檔自身路徑推導，不吃任何 --root／env 參數，結構上不會誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 10000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
}
const ONLY = process.env.CHIPS_ONLY ? new Set(process.env.CHIPS_ONLY.split(',').map(x => x.trim())) : null;
const want = g => !ONLY || ONLY.has(g);
const SHOT_DIR = process.env.CHIPS_SHOT_DIR || '';
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

// ── 判準的資料來源：測試自己讀規則檔、自己造回應，不呼叫 index.html 的函式算期望值 ──────────────────────────
const RULES = JSON.parse(readFileSync(path.join(ROOT, 'data/bounty_rules.json'), 'utf8'));
const SCENES = RULES.chips.scenes;
const UID_A = 'uid-chips-aaaa0001', UID_B = 'uid-chips-bbbb0002';
const KEY_CHIPS = 'trainmap-chips-me-v1', KEY_ACTOR = 'trainmap-bounty-actor-v1', KEY_DEV = 'trainmap-device-id', KEY_QUEUE = 'trainmap-bounty-upload-v1';
const ACTOR_RE = /^[A-Za-z0-9_-]{8,64}$/;
const APP_GLOBALS = { RAIL_MUSIC_AVAILABLE: true, RAIL_ONLINE_BASEMAPS_AVAILABLE: true, RAIL_APP_CONFIG: { satRetina: true } };
const THSR = readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'));
const unlockedN = n => SCENES.slice(0, n).map((scene, i) => ({ scene, nth: i + 1, at: 1791600000000 + i }));
// 刻意用跟規則檔裡任何一格都不同的數字（nextCost 7、cap 6）：期望值若是客戶端自己從規則檔算的，這裡就對不上
const CHIPS = (over = {}) => ({ balance: 5, unlocked: unlockedN(1), nextCost: 7, cloud: { rides: 4, toNextChip: 2 }, today: { chips: 0, cap: 6 }, ...over });
const ME = { actor: 'x', points: 128, corrected: { segs: 12, adopted: 9 }, lines: [{ sys: 'tra_sched', lnId: '南迴線', segs: 8, adopted: 6 }], firsts: [], trips: [] };
const CARD_OPEN = { id: 'card-open', sys: 'tra_sched', lnId: '南迴線', trainKind: '自強', dir: 0, kind: 'track', slot: '',
  unitKeys: ['tra_sched|南迴線|枋寮|加祿'], units: 1, points: 3, claimers: 0, samples: 0, coverN: 50, need: 50, distinctOk: 3 };
const CARD_COVERED = { ...CARD_OPEN, id: 'card-covered', trainKind: '區間車', covered: true, distinctOk: 50 };
const BOARD = { at: 1791600000000, coverN: { TRA: 50, THSR: 15, metro: 3 }, cards: [CARD_OPEN, CARD_COVERED] };
const qItem = (i, actor = 'seed-actor-0001') => ({ id: `q|${i}|1`,
  payload: { actor, sys: 'tra_sched', lnId: '南迴線', trainNo: '123', dir: 0, tripDate: '2026-10-01', batch: 1, samples: [{ d: 1000 + i, t: 100 + i, v: 20, acc: 8 }] },
  meta: { tripId: `q|${i}`, lnId: '南迴線', sys: 'tra_sched', trainNo: '123', dir: 0, tripDate: '2026-10-01', cardId: 'c', points: 3, segs: [], u: 1 } });

// ── 靜態伺服器（node http，空的埠，跑完由 finally 關掉）────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.xml': 'text/xml', '.webmanifest': 'application/manifest+json' };
const served = { n: 0, missing: new Set() };
const server = createServer((req, res) => {
  served.n++;
  let f = null, p = req.url;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT + path.sep) || !statSync(f).isFile()) f = null;
  } catch (e) { f = null; }
  if (!f) { served.missing.add(p); res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  createReadStream(f).on('error', () => res.destroy()).pipe(res);
});
const port = await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => res(server.address().port)); });
const BASE = `http://127.0.0.1:${port}`;
let browser = null, wk = null;
try {
  browser = await chromium.launch({ headless: true });

  // Firebase 替身與環境打樁。🔴 addInitScript 把函式序列化後在頁面裡跑，引用不到本檔的外層繫結 ⇒ 一切寫在函式體內，
  // 情境差異靠 arg。每次載入頁面都會重跑（重新整理後計數歸零）。
  const STUB = (arg) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); if (!arg.passportClosed) localStorage.setItem('trainmap-passport-open', '1'); } catch (e) {}
    const uid = (() => { try { return localStorage.getItem('__test_uid'); } catch (e) { return null; } })() || arg.uid;
    window.__authFired = 0;
    // 本機寫入紀錄：懸賞 actor 與「同步用的裝置 id」各被寫過幾次（驗懸賞不碰 trainmap-device-id、同一次登出只換一次 actor）
    window.__writes = { dev: 0, actor: 0 };
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === window.localStorage) {
        if (k === 'trainmap-device-id') window.__writes.dev++;
        if (k === 'trainmap-bounty-actor-v1') window.__writes.actor++;
        if (arg.deviceIdBlocked && k === 'trainmap-device-id') throw new Error('QuotaExceededError');
        if (arg.actorKeyBlocked && k === 'trainmap-bounty-actor-v1') throw new Error('QuotaExceededError');
      }
      return origSet.call(this, k, v);
    };
    // 預先放進去的 localStorage 值：每個分頁只放一次（重新整理不重放，不然「被清掉了」永遠驗不到）
    try {
      if (arg.seed && !sessionStorage.getItem('__seeded')) {
        for (const k of Object.keys(arg.seed)) localStorage.setItem(k, arg.seed[k]);
        sessionStorage.setItem('__seeded', '1');
      }
    } catch (e) {}
    // 頁面腳本開始跑之前，籌碼快取那把 key 裡放著什麼（驗「被清掉」之前要先證明它真的在）
    window.__seedProbe = (() => { try { return localStorage.getItem('trainmap-chips-me-v1'); } catch (e) { return null; } })();
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    const user = { uid, email: 't@example.com', getIdToken: async () => 'fake-id-token' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      getIdToken: async () => 'fake-id-token',
      onAuthStateChanged: (auth, cb) => {
        window.__authCb = cb;
        setTimeout(() => { window.__authFired++; cb(arg.noUser ? null : user); }, 50);
        if (arg.twice) setTimeout(() => { window.__authFired++; cb(arg.noUser ? null : user); }, 120);
      },
      // 真的登出：signOut 回來之後 auth 才解出 null（accountEndSession 在 await signOut 之後同步跑，null 事件晚一拍）
      signOut: async () => { setTimeout(() => { window.__authFired++; window.__authCb && window.__authCb(null); }, 0); },
    };
    try { localStorage.setItem('trainmap-account-uid', uid); } catch (e) {}
  };

  // 一個獨立情境：自己的 localStorage／sessionStorage、自己的 /api 打樁與請求紀錄。回應內容與模式在請求當下才讀，測試中途可以改。
  async function newSession(arg = {}, mode = {}, ctxOpts = {}) {
    const br = ctxOpts.browser || browser;
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', ...(ctxOpts.ctx || {}) });
    await ctx.addInitScript(STUB, { uid: UID_A, ...arg });
    if (arg.app) await ctx.addInitScript(g => { Object.assign(window, g); }, APP_GLOBALS);
    const s = { ctx, merges: [], bme: [], chips: [], submits: [], seq: 0, errors: [],
      mode: { merge: 'ok', bme: 'ok', chips: 'ok', submit: 'app_only', ...mode },
      chipsBody: CHIPS(), meBody: ME, board: BOARD };
    const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
    await ctx.route('**/*', async route => {
      const rq = route.request(), u = new URL(rq.url());
      if (u.hostname !== '127.0.0.1') return route.abort();                                  // 地圖磚、字型等外部資源一律不連
      const auth = rq.headers()['authorization'] || null;
      if (u.pathname === '/api/chips-me') {
        s.chips.push({ seq: ++s.seq, search: u.search, auth, url: rq.url() });
        const m = s.mode.chips;
        if (m === 'abort') return route.abort();
        if (m === '401') return json(route, 401, { error: 'unauthorized' });
        if (m === '503') return json(route, 503, { error: 'not_ready' });
        if (m === 'slow') await sleep(700);
        return json(route, 200, s.chipsBody);
      }
      if (u.pathname === '/api/bounty-me') {
        s.bme.push({ seq: ++s.seq, search: u.search, auth });
        const m = s.mode.bme;
        if (m === '401') return json(route, 401, { error: 'auth_required' });
        if (m === '403') return json(route, 403, { error: 'wrong_account' });
        if (m === '503') return json(route, 503, { error: 'not_ready' });
        return json(route, 200, s.meBody);
      }
      if (u.pathname === '/api/bounty-merge') {
        let actor = null; try { actor = JSON.parse(rq.postData()).actor; } catch (e) {}
        const m = { seq: ++s.seq, method: rq.method(), auth, actor, body: rq.postData() };
        s.merges.push(m);
        const n = s.merges.length, md = s.mode.merge;
        if (md === 'abort') return route.abort();
        if (md === '503') return json(route, 503, { error: 'merge_failed' });
        if (md === '409' || (md === '409once' && n === 1)) return json(route, 409, { error: 'merged_elsewhere' });
        if (md === 'slow') await sleep(700);
        m.doneSeq = ++s.seq;
        return json(route, 200, { ok: true, uid: 'x', points: 0, merged: true });
      }
      if (u.pathname === '/api/bounty-submit') {
        let body = null; try { body = JSON.parse(rq.postData()); } catch (e) {}
        s.submits.push({ seq: ++s.seq, actor: body && body.actor, auth });
        const md = s.mode.submit, n = s.submits.length;
        if (md === '403once' && n === 1) return json(route, 403, { error: 'wrong_account' });
        if (md === '503') return json(route, 503, { error: 'not_ready' });
        if (md === 'bad_samples') return json(route, 400, { error: 'bad_samples' });
        return json(route, 400, { error: 'app_only' });
      }
      if (u.pathname === '/api/bounty-board') return json(route, 200, s.board);
      if (u.pathname === '/api/thsr-schedule') return route.fulfill({ status: 200, contentType: 'application/json', body: THSR });
      if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    s.page = await ctx.newPage();
    s.page.on('pageerror', e => s.errors.push(String(e && e.message || e)));
    return s;
  }
  // 開機走完（state.ready）才算「頁面起來了」：「0 次請求」「不在」這類否定判準，要等到開機的最後一步跑完才有意義
  const bootDone = (page) => page.waitForFunction(() => { try { return state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000 });
  const loggedIn = async (page) => {
    await page.waitForFunction(() => { try { return !!(state.account && state.account.user && state.account.user.uid); } catch (e) { return false; } }, null, { timeout: 30000 });
    await bootDone(page);
  };
  const authResolvedNull = async (page) => {
    await page.waitForFunction(() => { try { return window.__authFired >= 1 && state.account && state.account.ready === true && state.account.user === null; } catch (e) { return false; } }, null, { timeout: 30000 });
    await bootDone(page);
  };
  const lsGet = (page, k) => page.evaluate(key => localStorage.getItem(key), k);
  const flagOf = (page, uid) => lsGet(page, 'trainmap-bounty-merged-' + uid);
  const chipsLoaded = (page) => page.waitForFunction(() => { try { return chipsMeMem !== null; } catch (e) { return false; } }, null, { timeout: 30000 });
  // 讀護照裡的籌碼列：selector 指到桌面 #passport 或手機 #ridePanel
  const rowInfo = (page, scope = '#passport') => page.evaluate(sc => {
    const el = document.querySelector(sc + ' .ph-chips');
    if (!el) return null;
    const cells = {};
    el.querySelectorAll('[data-k]').forEach(c => { cells[c.dataset.k] = { text: c.textContent.replace(/\s+/g, ' ').trim(), nums: [...c.querySelectorAll('b')].map(b => b.textContent.trim()) }; });
    return { text: el.textContent.replace(/\s+/g, ' ').trim(), off: el.classList.contains('off'), cells, shown: el.offsetParent !== null };
  }, scope);
  const goBounty = (s, qs = '') => s.page.goto(`${BASE}/?bounty=1&lang=zh-TW${qs}`);
  const bootBounty = async (arg, mode, chipsOver) => {
    const s = await newSession(arg, mode);
    if (chipsOver) s.chipsBody = chipsOver;
    await goBounty(s);
    await loggedIn(s.page);
    return s;
  };

  // ═══ CH1：護照籌碼列（餘額 0／5／50）＋ 舊點數那一格不在 DOM ═══════════════════════════════════════════════════
  if (want('CH1')) for (const bal of [0, 5, 50]) {
    await attempt(`CH1-${bal}`, async () => {
      const s = await bootBounty({}, {}, CHIPS({ balance: bal }));
      await chipsLoaded(s.page);
      await sleep(400);
      const r = await rowInfo(s.page);
      ok(`CH1a-${bal} [fixture] 登入解出 user、懸賞旗標是開的、籌碼回應已經收下（餘額 ${bal}）`,
        (await s.page.evaluate(() => BOUNTY_ENABLED && !!state.account.user && chipsMeMem.balance)) === bal);
      ok(`CH1b-${bal} 護照有籌碼列、不是「登入後看得到」那句；餘額格只有一個數字且恰好是 ${bal}`,
        !!r && !r.off && !!r.cells.balance && r.cells.balance.nums.length === 1 && r.cells.balance.nums[0] === String(bal), JSON.stringify(r));
      ok(`CH1c-${bal} 下一座＝7（讀回應的 nextCost，不是客戶端自己算）、雲端搭乘＝4 次、再 2 次、每日上限＝6（讀 today.cap）`,
        !!r && !!r.cells.next && r.cells.next.nums.join() === '7' && !!r.cells.cloud && r.cells.cloud.nums.join() === '4,2' && !!r.cells.cap && r.cells.cap.nums.join() === '6', JSON.stringify(r && r.cells));
      const old = await s.page.evaluate(() => ({
        cell: !!document.querySelector('.corr-pt'),
        text: (document.querySelector('#passport .ph-correct') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
      }));
      ok(`CH1d-${bal} 舊點數那一格不在 DOM（.corr-pt 不存在、校正貢獻節裡找不到伺服器回的 128 點）；校正 12 段、已採用 9 段照舊顯示`,
        !old.cell && !/128/.test(old.text) && /12/.test(old.text) && /9/.test(old.text), old.text);
      ok(`CH1e-${bal} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
  }

  // ═══ CH2：全部場景都解鎖 → 不顯示「下一座」；差一座就顯示（對照）═══════════════════════════════════════════════
  if (want('CH2')) await attempt('CH2', async () => {
    const all = await bootBounty({}, {}, CHIPS({ balance: 9, unlocked: unlockedN(SCENES.length) }));
    await chipsLoaded(all.page); await sleep(500);
    const ra = await rowInfo(all.page);
    ok(`CH2a 已解鎖 ${SCENES.length} 座＝規則檔的場景數（伺服器仍回 nextCost 7）：沒有「下一座」，餘額與雲端搭乘照樣有`,
      !!ra && !ra.off && !ra.cells.next && !!ra.cells.balance && ra.cells.balance.nums[0] === '9' && !!ra.cells.cloud, JSON.stringify(ra));
    await all.ctx.close();
    const part = await bootBounty({}, {}, CHIPS({ balance: 9, unlocked: unlockedN(SCENES.length - 1) }));
    await chipsLoaded(part.page); await sleep(500);
    const rp = await rowInfo(part.page);
    ok(`CH2b 對照：已解鎖 ${SCENES.length - 1} 座（還差一座）：「下一座」在、數字是 7`,
      !!rp && !!rp.cells.next && rp.cells.next.nums.join() === '7', JSON.stringify(rp));
    await part.ctx.close();
  });

  // ═══ CH3：籌碼列與通行證無關 ═════════════════════════════════════════════════════════════════════════════════
  if (want('CH3')) await attempt('CH3', async () => {
    const s = await bootBounty({});
    await chipsLoaded(s.page); await sleep(500);
    const text = async plus => {
      await s.page.evaluate(v => { state.plus.active = v; renderPassport(); }, plus);
      const fx = await s.page.evaluate(() => plusIsActive());
      return { fx, row: await rowInfo(s.page) };
    };
    const on = await text(true), off = await text(false);
    ok('CH3a [fixture] 兩次 plusIsActive() 真的一次真、一次假', on.fx === true && off.fx === false, JSON.stringify([on.fx, off.fx]));
    ok('CH3b 通行證有效／無效：籌碼列的文字逐字相同，而且不是空的（含餘額 5）',
      !!on.row && !!off.row && on.row.text === off.row.text && /5/.test(on.row.text) && on.row.text.length > 8, JSON.stringify([on.row && on.row.text, off.row && off.row.text]));
    ok('CH3c 兩種狀態下各格的數字也相同', !!on.row && !!off.row && JSON.stringify(on.row.cells) === JSON.stringify(off.row.cells));
    await s.ctx.close();
  });

  // ═══ CH4：請求——沒登入 0 次；登入後帶 Bearer、不帶 ?actor=；開機／登入／合併完成各讀一次 ═══════════════════════════
  if (want('CH4')) await attempt('CH4', async () => {
    const lo = await newSession({ noUser: true, seed: { [KEY_CHIPS]: JSON.stringify(CHIPS({ balance: 77 })) } });
    await goBounty(lo);
    await authResolvedNull(lo.page);
    await sleep(1500);
    const rl = await rowInfo(lo.page);
    ok('CH4a [fixture] 懸賞旗標開、auth 已解出「沒有登入」', (await lo.page.evaluate(() => BOUNTY_ENABLED && state.account.user === null)) === true);
    ok('CH4b 沒登入：chips-me 請求 0 次（數的是瀏覽器真的發出的請求）', lo.chips.length === 0, JSON.stringify(lo.chips));
    ok('CH4c 沒登入：護照只有「登入後看得到籌碼」那句提示、沒有餘額格；上次登入留下的快取（餘額 77）被清掉、也沒有畫出來',
      !!rl && rl.off && !rl.cells.balance && /登入後看得到籌碼/.test(rl.text) && !/77/.test(rl.text) && (await lsGet(lo.page, KEY_CHIPS)) === null, JSON.stringify(rl));
    const direct = await lo.page.evaluate(async () => { try { return { r: await fetchChipsMe(), threw: '' }; } catch (e) { return { r: 'x', threw: String((e && e.message) || e) }; } });
    await sleep(500);
    ok('CH4f 沒登入時直接呼叫 fetchChipsMe()：回 null、不丟例外、請求仍是 0 次（擋的是函式自己的登入檢查，不是「剛好沒有人呼叫它」）',
      direct.r === null && !direct.threw && lo.chips.length === 0, JSON.stringify({ direct, n: lo.chips.length }));
    await lo.ctx.close();

    const li = await bootBounty({}, { merge: 'slow' });
    await chipsLoaded(li.page); await sleep(1800);
    ok('CH4d 登入後：chips-me 有請求、全部帶 Authorization: Bearer＜idToken＞、網址一律沒有 actor=、路徑是 /api/chips-me',
      li.chips.length >= 1 && li.chips.every(x => x.auth === 'Bearer fake-id-token' && !/actor=/i.test(x.url) && new URL(x.url).pathname === '/api/chips-me'), JSON.stringify(li.chips));
    const doneSeq = (li.merges[0] || {}).doneSeq || 0;
    ok('CH4e 開機時 session 還原（登入）讀一次；合併（延遲 700ms）完成之後再讀一次——登入那一刻讀到的是還沒併進來的帳',
      li.merges.length === 1 && doneSeq > 0 && li.chips.some(x => x.seq < doneSeq) && li.chips.some(x => x.seq > doneSeq), JSON.stringify({ chips: li.chips.map(x => x.seq), doneSeq }));
    await li.ctx.close();
  });

  // ═══ CH5：身分——409 merged_elsewhere／403 wrong_account → 換新的 actor、再併一次；同一次登入只換一次 ═════════════
  if (want('CH5')) {
    await attempt('CH5a', async () => {
      const s = await bootBounty({}, { merge: '409once' });
      await until(() => s.merges.length >= 2);
      await sleep(600);
      const dev = await lsGet(s.page, KEY_DEV), act = await lsGet(s.page, KEY_ACTOR);
      const flag = await flagOf(s.page, UID_A);
      ok('CH5a1 [fixture] 第一次併的是這台裝置原本的 id（懸賞 actor 第一次讀時沿用它）、伺服器第一發回 409',
        s.merges.length >= 1 && s.merges[0].actor === dev && !!dev && dev !== 'ephemeral', JSON.stringify({ dev, merges: s.merges.map(x => x.actor) }));
      ok('CH5a2 409 之後：懸賞 actor 換成新的（合格式、不等於舊的、不是 ephemeral）、merge 再打一次（共 2 發）、第二發送的就是新 actor',
        s.merges.length === 2 && ACTOR_RE.test(act || '') && act !== dev && act !== 'ephemeral' && s.merges[1].actor === act, JSON.stringify({ dev, act, merges: s.merges.map(x => x.actor) }));
      ok('CH5a3 trainmap-device-id 沒變、而且只被寫過 1 次（初次產生）——懸賞的程式碼不碰同步用的裝置 id；懸賞 actor 那把 key 寫了 2 次（沿用＋換新）',
        (await lsGet(s.page, KEY_DEV)) === dev && (await s.page.evaluate(() => JSON.stringify(window.__writes))) === JSON.stringify({ dev: 1, actor: 2 }), String(await s.page.evaluate(() => JSON.stringify(window.__writes))));
      ok('CH5a4 之後都用新的：bountyActor() 是新 actor、第二發成功後「已併」旗標記的是新 actor（不是舊的）',
        (await s.page.evaluate(() => bountyActor())) === act && flag === act, String(flag));
      ok('CH5a5 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });

    await attempt('CH5b', async () => {
      const s = await bootBounty({}, { merge: '409' });
      await until(() => s.merges.length >= 2);
      await sleep(2000);
      const dev = await lsGet(s.page, KEY_DEV), act = await lsGet(s.page, KEY_ACTOR);
      ok('CH5b1 連續兩次 409：merge 恰好打 2 發（不會無限重試）、等 2 秒後仍是 2、第二發是新 actor',
        s.merges.length === 2 && s.merges[0].actor === dev && s.merges[1].actor === act && act !== dev, JSON.stringify(s.merges.map(x => x.actor)));
      ok('CH5b2 懸賞 actor 只換了一次（那把 key 恰好被寫 2 次）、沒有「已併」旗標（兩次都沒併成）',
        (await s.page.evaluate(() => window.__writes.actor)) === 2 && (await flagOf(s.page, UID_A)) === null);
      await s.page.evaluate(() => bountyMergeOnLogin(state.account.user));   // 同一次登入再觸發一次合併
      await until(() => s.merges.length >= 3);
      await sleep(1200);
      ok('CH5b3 同一次登入再觸發合併：照樣打（共 3 發）、但帶的仍是同一個新 actor——不再換第二次',
        s.merges.length === 3 && s.merges[2].actor === act && (await lsGet(s.page, KEY_ACTOR)) === act && (await s.page.evaluate(() => window.__writes.actor)) === 2, JSON.stringify(s.merges.map(x => x.actor)));
      await s.ctx.close();
    });

    await attempt('CH5c', async () => {
      const s = await bootBounty({});
      await until(async () => (await flagOf(s.page, UID_A)) !== null);
      const dev = await lsGet(s.page, KEY_DEV), act0 = await lsGet(s.page, KEY_ACTOR);
      ok('CH5c1 [fixture] 登入併成功（1 發），旗標記的是目前的 actor', s.merges.length === 1 && (await flagOf(s.page, UID_A)) === act0 && act0 === dev);
      s.mode.bme = '403';
      await s.page.evaluate(() => fetchBountyMe());
      await until(() => s.merges.length >= 2);
      await sleep(600);
      const act1 = await lsGet(s.page, KEY_ACTOR);
      ok('CH5c2 懸賞端點（讀彙總）回 403 wrong_account：actor 換新、merge 再打一發、送的是新 actor；trainmap-device-id 不變',
        s.merges.length === 2 && ACTOR_RE.test(act1 || '') && act1 !== act0 && s.merges[1].actor === act1 && (await lsGet(s.page, KEY_DEV)) === dev, JSON.stringify({ act0, act1, merges: s.merges.map(x => x.actor) }));
      await s.page.evaluate(() => fetchBountyMe());
      await sleep(1000);
      ok('CH5c3 同一次登入第二個 403：不再換（actor 不變、merge 仍是 2 發）', (await lsGet(s.page, KEY_ACTOR)) === act1 && s.merges.length === 2, JSON.stringify(s.merges.map(x => x.actor)));
      await s.ctx.close();
    });

    await attempt('CH5d', async () => {
      // 上傳佇列裡的批次遇到 403 wrong_account：actor 換新、佇列裡的批次一律改用新 actor、下一輪重送（這一輪不繼續送後面的）
      const s = await newSession({ seed: { [KEY_QUEUE]: JSON.stringify([qItem(1), qItem(2)]) } }, { submit: '403once' });
      await goBounty(s); await loggedIn(s.page);
      await until(async () => (await flagOf(s.page, UID_A)) !== null);
      await until(() => s.submits.length >= 1);
      await sleep(800);
      const act = await lsGet(s.page, KEY_ACTOR);
      const q = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH5d1 佇列裡的兩筆收到 403 wrong_account：actor 換新、這一輪只送 1 發就停、佇列兩筆都還在、而且都已改成新 actor',
        s.submits.length === 1 && ACTOR_RE.test(act || '') && act !== 'seed-actor-0001' && q.length === 2 && q.every(x => x.payload.actor === act), JSON.stringify({ act, submits: s.submits, q: q.map(x => x.payload.actor) }));
      await s.page.evaluate(() => bountyRetryPending());
      await sleep(600);
      const q2 = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH5d2 下一輪重送：帶的是新 actor（伺服器這次回 400 app_only，兩筆都清掉）', s.submits.length === 3 && s.submits[1].actor === act && q2.length === 0, JSON.stringify({ submits: s.submits, q2: q2.length }));
      await s.ctx.close();
    });
  }

  // ═══ CH6：登出——併過的 actor 換新、快取與記憶體清掉；在途回應不寫回 ════════════════════════════════════════════
  if (want('CH6')) {
    for (const [tag, how] of [['signOut', 'accountSignOut()'], ['revoke', 'window.__authCb(null)']]) {
      await attempt(`CH6-${tag}`, async () => {
        const s = await bootBounty({});
        await chipsLoaded(s.page);
        await until(async () => (await flagOf(s.page, UID_A)) !== null);
        await until(() => s.page.evaluate(() => bountyMeMem !== null));
        const dev = await lsGet(s.page, KEY_DEV), act0 = await lsGet(s.page, KEY_ACTOR);
        ok(`CH6a-${tag} [fixture] 登出前：已併（旗標＝目前的 actor）、籌碼快取在、彙總在記憶體裡`,
          (await flagOf(s.page, UID_A)) === act0 && !!(await lsGet(s.page, KEY_CHIPS)) && (await s.page.evaluate(() => bountyMeMem !== null && chipsMeMem !== null)) === true);
        await s.page.evaluate(h => { window.__how = h; (0, eval)(h); }, how);
        await s.page.waitForFunction(() => state.account.user === null, null, { timeout: 15000 });
        await sleep(800);                                   // 讓 onAuthStateChanged 的 null 分支（第二次進身分收尾）也跑完
        const act1 = await lsGet(s.page, KEY_ACTOR);
        ok(`CH6b-${tag} 登出後：懸賞 actor 換新（合格式、不等於舊的）、trainmap-device-id 不變且只寫過 1 次`,
          ACTOR_RE.test(act1 || '') && act1 !== act0 && (await lsGet(s.page, KEY_DEV)) === dev && (await s.page.evaluate(() => window.__writes.dev)) === 1, JSON.stringify({ act0, act1 }));
        ok(`CH6c-${tag} 身分收尾會跑兩次，但 actor 只換一次（那把 key 恰好寫 2 次：沿用＋換新）`, (await s.page.evaluate(() => window.__writes.actor)) === 2);
        ok(`CH6d-${tag} 籌碼快取 trainmap-chips-me-v1 不在；記憶體裡的彙總與籌碼都清成 null`,
          (await lsGet(s.page, KEY_CHIPS)) === null && (await s.page.evaluate(() => bountyMeMem === null && chipsMeMem === null)) === true);
        const row = await rowInfo(s.page);
        ok(`CH6e-${tag} 護照改回「登入後看得到籌碼」、沒有餘額格`, !!row && row.off && !row.cells.balance, JSON.stringify(row));
        await s.ctx.close();
      });
    }

    await attempt('CH6-control', async () => {
      // 對照：這台裝置的 actor 從沒併進帳號（併失敗、沒有旗標）→ 登出時不換（換 actor 是「併過」才有的後果）
      const s = await bootBounty({}, { merge: '503' });
      await chipsLoaded(s.page); await until(() => s.merges.length >= 1); await sleep(500);
      const act0 = await lsGet(s.page, KEY_ACTOR);
      await s.page.evaluate(() => accountSignOut());
      await s.page.waitForFunction(() => state.account.user === null, null, { timeout: 15000 });
      await sleep(800);
      ok('CH6f 對照：沒併過（沒有已併旗標）→ 登出後 actor 不換、籌碼快取照樣清掉',
        (await flagOf(s.page, UID_A)) === null && (await lsGet(s.page, KEY_ACTOR)) === act0 && (await lsGet(s.page, KEY_CHIPS)) === null, String(act0));
      await s.ctx.close();
    });

    await attempt('CH6-inflight', async () => {
      // 在途的回應：籌碼請求還沒回來（延遲 700ms）就登出 → 回來之後不寫進快取、不寫進記憶體
      const s = await bootBounty({});
      await chipsLoaded(s.page);
      s.mode.chips = 'slow';
      await s.page.evaluate(() => { localStorage.removeItem('trainmap-chips-me-v1'); window.__inflight = fetchChipsMe(); });
      await sleep(150);
      await s.page.evaluate(() => accountSignOut());
      await s.page.waitForFunction(() => state.account.user === null, null, { timeout: 15000 });
      await sleep(1500);
      ok('CH6g 登出時還有一發籌碼請求在途：它回來之後快取沒有被寫回、記憶體仍是 null（那份資料屬於上一位）',
        (await lsGet(s.page, KEY_CHIPS)) === null && (await s.page.evaluate(() => chipsMeMem === null)) === true && s.chips.length >= 2);
      await s.ctx.close();
    });
  }

  // ═══ CH7：懸賞旗標關 ═══════════════════════════════════════════════════════════════════════════════════════════
  if (want('CH7')) await attempt('CH7', async () => {
    const s = await newSession({ seed: { [KEY_CHIPS]: JSON.stringify(CHIPS({ balance: 77 })) } });
    await s.page.goto(`${BASE}/?lang=zh-TW`);
    await loggedIn(s.page);
    await sleep(2000);
    ok('CH7a [fixture] 登入解出 user、懸賞旗標是關的、頁面腳本開始跑之前快取裡真的有那份資料（餘額 77）',
      (await s.page.evaluate(() => BOUNTY_ENABLED === false && !!state.account.user)) === true && /"balance":77/.test((await s.page.evaluate(() => window.__seedProbe)) || ''));
    ok('CH7b 旗標關：開機後 trainmap-chips-me-v1 被清掉', (await lsGet(s.page, KEY_CHIPS)) === null);
    ok('CH7c 旗標關：護照裡沒有籌碼列（桌面護照與手機護照面板都沒有）', (await s.page.evaluate(() => document.querySelectorAll('.ph-chips').length)) === 0);
    ok('CH7d 旗標關：chips-me 請求 0 次、bounty-merge 0 次、bounty-me 0 次', s.chips.length === 0 && s.merges.length === 0 && s.bme.length === 0, JSON.stringify({ c: s.chips.length, m: s.merges.length, b: s.bme.length }));
    ok('CH7e 旗標關：不寫新的懸賞 actor key、不產生籌碼快取', (await lsGet(s.page, KEY_ACTOR)) === null && (await s.page.evaluate(() => window.__writes.actor)) === 0);
    await s.page.reload();
    await loggedIn(s.page); await sleep(1000);
    ok('CH7f 重新整理後仍然乾淨（沒有籌碼列、沒有請求）', (await s.page.evaluate(() => document.querySelectorAll('.ph-chips').length)) === 0 && s.chips.length === 0);
    await s.ctx.close();
  });

  // ═══ CH8：上傳佇列——400 app_only 是終態 ═══════════════════════════════════════════════════════════════════════
  if (want('CH8')) {
    await attempt('CH8a', async () => {
      const s = await newSession({ seed: { [KEY_QUEUE]: JSON.stringify([qItem(1), qItem(2)]) } }, { submit: 'app_only' });
      await goBounty(s); await loggedIn(s.page);
      await until(() => s.submits.length >= 2);
      await sleep(1200);
      const q = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH8a1 [fixture] 佇列放了 2 筆、伺服器回 400 app_only', s.submits.length >= 1 && s.mode.submit === 'app_only');
      ok('CH8a2 兩筆都清掉（佇列空了）、每筆只送過 1 次（共 2 發，不是卡在隊首重試）', q.length === 0 && s.submits.length === 2, JSON.stringify({ q: q.length, submits: s.submits.length }));
      ok('CH8a3 被清掉的那兩筆沒有被標成「已送出」（本機旅程紀錄裡沒有它們）', !/q\|1|q\|2/.test((await lsGet(s.page, 'trainmap-bounty-v1')) || ''));
      await s.page.reload(); await loggedIn(s.page); await sleep(1500);
      ok('CH8a4 重新整理後不再重送（請求數仍是 2）', s.submits.length === 2, String(s.submits.length));
      await s.ctx.close();
    });
    await attempt('CH8b', async () => {
      // 對照：別的錯誤不是終態——503 留在佇列、卡在隊首（照舊每一輪只送隊首那一筆）、不清掉
      const s = await newSession({ seed: { [KEY_QUEUE]: JSON.stringify([qItem(1), qItem(2)]) } }, { submit: '503' });
      await goBounty(s); await loggedIn(s.page);
      await until(() => s.submits.length >= 1);
      await sleep(1200);
      const q = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH8b 對照：503 → 佇列原封不動（2 筆都在）、這一輪只送了隊首那一筆', q.length === 2 && s.submits.length === 1, JSON.stringify({ q: q.length, submits: s.submits.length }));
      s.mode.submit = 'bad_samples';
      await s.page.evaluate(() => bountyRetryPending());
      await sleep(600);
      const q2 = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH8c 對照：另一個 400（bad_samples）也不算終態——只有 app_only 才清', q2.length === 2, String(q2.length));
      s.mode.submit = 'app_only';
      await s.page.evaluate(() => bountyRetryPending());
      await sleep(800);
      ok('CH8d 同一個佇列改回 app_only → 兩筆都清掉', JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]').length === 0);
      await s.ctx.close();
    });
  }

  // ═══ CH9：看板收滿的卡 ═══════════════════════════════════════════════════════════════════════════════════════
  if (want('CH9')) await attempt('CH9', async () => {
    const s = await bootBounty({});
    await chipsLoaded(s.page);
    await s.page.click('#passport [data-act="bountyboard"]');
    await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 2, null, { timeout: 15000 });
    const cards = await s.page.evaluate(() => [...document.querySelectorAll('#bountyList .bt-card')].map(c => ({
      id: c.dataset.card, text: c.textContent.replace(/\s+/g, ' ').trim(), take: c.querySelectorAll('.bt-take').length })));
    const open = cards.find(c => c.id === CARD_OPEN.id), cov = cards.find(c => c.id === CARD_COVERED.id);
    ok('CH9a [fixture] 看板收到 2 張卡：一般卡有接單鈕（對照）', cards.length === 2 && !!open && open.take === 1, JSON.stringify(cards));
    ok('CH9b covered:true 的卡有「已收滿，照樣可以錄程拿籌碼」整句', !!cov && cov.text.includes('已收滿，照樣可以錄程拿籌碼'), cov && cov.text);
    ok('CH9c covered:true 的卡沒有接單鈕（認領會 404，不提供）', !!cov && cov.take === 0);
    ok('CH9d 一般卡沒有「已收滿」那句', !!open && !open.text.includes('已收滿'));
    await s.ctx.close();
  });

  // ═══ CH10：開始錄程入口 ═══════════════════════════════════════════════════════════════════════════════════════
  if (want('CH10')) {
    const probe = async (qs, app) => {
      const s = await newSession({ app });
      await s.page.goto(`${BASE}/?lang=zh-TW${qs}`);
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 40000 });
      await s.page.evaluate(() => {
        window.__sampling = 0;
        const orig = window.bountyStartSampling;
        window.bountyStartSampling = function () { window.__sampling++; return orig.apply(this, arguments); };
      });
      const out = await s.page.evaluate(card => {
        document.getElementById('toasts').innerHTML = '';
        startBountyRecording(card);
        return { sampling: window.__sampling, recording: !!state.recording, toast: document.getElementById('toasts').textContent.replace(/\s+/g, ' ').trim(),
          flag: BOUNTY_ENABLED, native: PHYSICAL_COLLECT_ENABLED };
      }, CARD_OPEN);
      await s.ctx.close();
      return out;
    };
    await attempt('CH10', async () => {
      const on = await probe('&bounty=1', true);
      ok('CH10a [fixture] App 殼＋懸賞旗標開（沒有旗標的話，舊程式碼在 App 殼裡會啟動取樣）', on.flag === true && on.native === true, JSON.stringify(on));
      ok('CH10b 旗標開：按開始錄程 → 定位取樣沒有被啟動（bountyStartSampling 0 次）、沒有進入錄製、顯示「錄程要用軌島 App」說明',
        on.sampling === 0 && on.recording === false && on.toast.includes('錄程要用軌島 App'), JSON.stringify(on));
      const off = await probe('', true);
      ok('CH10c 對照：旗標關（同樣的 App 殼）→ 照舊啟動取樣（bountyStartSampling 1 次、進入錄製）——只有旗標開著才收斂',
        off.flag === false && off.native === true && off.sampling === 1 && off.recording === true, JSON.stringify(off));
      const demo = await probe('&demo=bounty', false);
      ok('CH10d 對照：?demo=bounty（備援站看設計用，不上傳）不受影響——照舊走完錄製流程（取樣 1 次）',
        demo.flag === true && demo.sampling === 1 && demo.recording === true && !demo.toast.includes('錄程要用軌島 App'), JSON.stringify(demo));
    });
  }

  // ═══ CH11：手機版——四個寬度 × 兩個引擎，真觸控點開護照 ════════════════════════════════════════════════════════
  if (want('CH11')) {
    const MOBILE = async (engineName, br, width, loggedOut) => {
      const tag = `${engineName}-${width}${loggedOut ? '-out' : ''}`;
      await attempt(`CH11-${tag}`, async () => {
        const s = await newSession(loggedOut ? { noUser: true, passportClosed: true } : { passportClosed: true }, {}, {
          browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        await goBounty(s);
        if (loggedOut) { await authResolvedNull(s.page); await sleep(800); } else { await loggedIn(s.page); await chipsLoaded(s.page); await sleep(500); }
        await s.page.tap('#tabRide');                                                      // 手機底部分頁列的「護照」，手機上實際點得到的入口（#rideBtn 在手機上是藏起來的）
        await s.page.waitForFunction(() => { const p = document.getElementById('ridePanel'); return p && !p.hidden && p.querySelector('.ph-chips'); }, null, { timeout: 15000 });
        await s.page.evaluate(() => document.querySelector('#ridePanel .ph-chips').scrollIntoView({ block: 'center' }));
        await sleep(400);
        const m = await s.page.evaluate(() => {
          const row = document.querySelector('#ridePanel .ph-chips'), panel = document.getElementById('ridePanel');
          const r = row.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
          const inside = el => !!el && (el === row || row.contains(el));
          const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
          const hits = pts.map(([x, y]) => inside(document.elementFromPoint(x, y)));
          const controls = [...panel.querySelectorAll('button, a, [role="button"], input, select')].filter(c => !row.contains(c) && !c.contains(row) && c.offsetParent !== null);
          const overlaps = controls.map(c => { const q = c.getBoundingClientRect();
            const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
            return w > 0.5 && h > 0.5 ? (c.id || c.className || c.tagName) : null; }).filter(Boolean);
          return { rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }, vw: W, vh: H,
            inView: r.left >= 0 && r.right <= W && r.top >= 0 && r.bottom <= H && r.width > 0 && r.height > 0,
            hits, overlaps, controls: controls.length,
            hscroll: { doc: document.documentElement.scrollWidth - W, panel: panel.scrollWidth - panel.clientWidth, row: row.scrollWidth - row.clientWidth },
            off: row.classList.contains('off'), text: row.textContent.replace(/\s+/g, ' ').trim() };
        });
        ok(`CH11a-${tag} 籌碼列${loggedOut ? '（登出提示）' : ''}在可視範圍內（捲到中間後四邊都在視窗裡）`, m.inView, JSON.stringify(m.rect) + ` vw=${m.vw} vh=${m.vh}`);
        ok(`CH11b-${tag} elementFromPoint 在中心與四個角落都回到籌碼列自己（沒有被別的東西蓋住）`, m.hits.every(Boolean), JSON.stringify(m.hits));
        ok(`CH11c-${tag} 不跟護照裡既有的控件重疊（掃了 ${m.controls} 個可見控件）`, m.controls > 0 && m.overlaps.length === 0, JSON.stringify(m.overlaps));
        ok(`CH11d-${tag} 沒有水平捲動（頁面、護照面板、籌碼列自己都不超寬）`, m.hscroll.doc <= 1 && m.hscroll.panel <= 1 && m.hscroll.row <= 1, JSON.stringify(m.hscroll));
        ok(`CH11e-${tag} 內容對：${loggedOut ? '只有登入提示、沒有餘額' : '餘額 5、下一座 7、雲端搭乘'}`,
          loggedOut ? (m.off && /登入後看得到籌碼/.test(m.text)) : (!m.off && /5/.test(m.text) && /7/.test(m.text) && /雲端搭乘/.test(m.text)), m.text);
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `chips-${tag}.png`) });
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE('chromium', browser, w, false);
    await MOBILE('chromium', browser, 360, true);
    await attempt('CH11-webkit-launch', async () => {
      wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE('webkit', wk, w, false);
      await MOBILE('webkit', wk, 360, true);
    });
  }

  // ═══ CH12：快取與 actor 的邊界 ════════════════════════════════════════════════════════════════════════════════
  if (want('CH12')) {
    await attempt('CH12a', async () => {
      const s = await bootBounty({});
      await chipsLoaded(s.page);
      const raw = await lsGet(s.page, KEY_CHIPS);
      let j = null; try { j = JSON.parse(raw); } catch (e) {}
      ok('CH12a 讀成功：回應原樣寫進 trainmap-chips-me-v1（車庫讀 unlocked[].scene 判斷場景鎖不鎖）',
        !!j && j.balance === 5 && Array.isArray(j.unlocked) && j.unlocked.length === 1 && j.unlocked[0].scene === SCENES[0] && j.nextCost === 7, String(raw).slice(0, 160));
      s.mode.chips = '503';
      await s.page.evaluate(() => fetchChipsMe());
      ok('CH12b 暫時性錯誤（503）：快取與記憶體都留著上一份（不清）', (await lsGet(s.page, KEY_CHIPS)) === raw && (await s.page.evaluate(() => chipsMeMem && chipsMeMem.balance)) === 5);
      s.mode.chips = '401';
      await s.page.evaluate(async () => { await fetchChipsMe(); renderPassport(); });     // 重繪是呼叫端（登入、合併完成）自己做的，不在 fetchChipsMe 裡
      const r401 = await rowInfo(s.page);
      ok('CH12c 401：快取清掉、記憶體清成 null（你現在看不到這個帳）、重繪後護照不再顯示餘額 5（改成破折號）',
        (await lsGet(s.page, KEY_CHIPS)) === null && (await s.page.evaluate(() => chipsMeMem === null)) === true &&
          !!r401 && !!r401.cells.balance && !r401.cells.balance.nums.includes('5') && r401.cells.balance.nums.join() === '—', JSON.stringify(r401));
      s.mode.chips = 'ok'; s.chipsBody = { garbage: true };
      await s.page.evaluate(() => fetchChipsMe());
      ok('CH12d 回應形狀不對（沒有 balance／unlocked）：不寫快取、不丟例外', (await lsGet(s.page, KEY_CHIPS)) === null && s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });

    await attempt('CH12b', async () => {
      // 第一次讀到時沿用 userDataDeviceId() 的值：舊版就是拿它當 actor，伺服器上已經記在它名下的帳不能斷
      const s = await bootBounty({}, { merge: '503' });
      await until(() => s.merges.length >= 1);
      const dev = await lsGet(s.page, KEY_DEV);
      ok('CH12e 第一次沿用 trainmap-device-id 的值當懸賞 actor、寫進自己的 key；之後 bountyActor() 讀的就是那把 key',
        !!dev && (await lsGet(s.page, KEY_ACTOR)) === dev && s.merges[0].actor === dev && (await s.page.evaluate(() => bountyActor())) === dev);
      await s.page.evaluate(k => localStorage.setItem(k, 'manual-actor-xyz-0001'), KEY_ACTOR);
      ok('CH12f 懸賞 actor 那把 key 被換掉後，bountyActor() 讀新的、trainmap-device-id 沒受影響',
        (await s.page.evaluate(() => bountyActor())) === 'manual-actor-xyz-0001' && (await lsGet(s.page, KEY_DEV)) === dev);
      await s.ctx.close();
    });

    await attempt('CH12c', async () => {
      // 存不下：與原本的 'ephemeral' 一致——不送合併、也不拿共用值去讀別人的帳
      for (const [tag, arg] of [['裝置 id 存不下', { deviceIdBlocked: true }], ['懸賞 actor 那把 key 存不下', { actorKeyBlocked: true }]]) {
        const s = await bootBounty(arg);
        await sleep(1500);
        ok(`CH12g 登入、${tag}：bountyActor() 是字面 ephemeral、不送 bounty-merge（0 次）`,
          (await s.page.evaluate(() => bountyActor())) === 'ephemeral' && s.merges.length === 0, JSON.stringify(s.merges));
        await s.ctx.close();
        const o = await newSession({ ...arg, noUser: true });
        await goBounty(o); await authResolvedNull(o.page); await sleep(1500);
        ok(`CH12h 沒登入、${tag}：不用 ephemeral 去讀彙總（bounty-me 0 次、沒有任何 actor=ephemeral 的請求）`,
          o.bme.length === 0 && !o.bme.some(x => /ephemeral/.test(x.search)), JSON.stringify(o.bme));
        await o.ctx.close();
      }
    });

    await attempt('CH12d', async () => {
      // 英文介面：新增的每一句都有譯文（執行時沒有漏出中文）
      const s = await newSession({ app: false }, {}, { ctx: { locale: 'en-US' } });
      await s.page.goto(`${BASE}/?bounty=1&lang=en`);
      await loggedIn(s.page); await chipsLoaded(s.page); await sleep(500);
      const cjk = /[㐀-鿿]/;
      const r = await rowInfo(s.page);
      ok('CH12i 英文介面：登入後的籌碼列整列沒有中文字、也不是空的', !!r && r.text.length > 8 && !cjk.test(r.text), r && r.text);
      await s.page.click('#passport [data-act="bountyboard"]');
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 2, null, { timeout: 15000 });
      const cov = await s.page.evaluate(id => { const c = [...document.querySelectorAll('#bountyList .bt-card')].find(x => x.dataset.card === id); return c ? c.querySelector('.bt-covered') ? c.querySelector('.bt-covered').textContent : '' : null; }, CARD_COVERED.id);
      ok('CH12j 英文介面：收滿的卡那句說明有譯文、沒有中文字', !!cov && cov.length > 8 && !cjk.test(cov), String(cov));
      const toast = await s.page.evaluate(card => { document.getElementById('toasts').innerHTML = ''; startBountyRecording(card); return document.getElementById('toasts').textContent.trim(); }, CARD_OPEN);
      ok('CH12k 英文介面：錄程入口的 App 說明有譯文、沒有中文字', toast.length > 8 && !cjk.test(toast), toast);
      await s.ctx.close();
      const lo = await newSession({ noUser: true }, {}, { ctx: { locale: 'en-US' } });
      await lo.page.goto(`${BASE}/?bounty=1&lang=en`);
      await authResolvedNull(lo.page); await sleep(800);
      const rl = await rowInfo(lo.page);
      ok('CH12l 英文介面：登出時的提示沒有中文字', !!rl && rl.off && rl.text.length > 8 && !cjk.test(rl.text), rl && rl.text);
      await lo.ctx.close();
    });
  }
} finally {
  if (wk) await wk.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  server.closeAllConnections(); server.close();                        // 只關本輪自己起的這一個伺服器
  console.log(`[G0] 靜態伺服器：${served.n} 個請求、404 ${served.missing.size} 個路徑${served.missing.size ? '：' + [...served.missing].sort().join(' ') : ''}`);
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);

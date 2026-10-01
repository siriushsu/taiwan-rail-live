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
//   CH6  登出：併過的 actor 換新、籌碼快取與記憶體清掉；在途的籌碼與 bounty-me 回應不會在登出後寫回
//   CH7  懸賞旗標關：開機清掉籌碼快取、沒有籌碼列、0 次 chips-me／bounty-me（含直接呼叫 fetchChipsMe()、fetchBountyMe()）、不寫新的 actor key
//   CH8  上傳佇列：旗標開時 400 app_only 是終態（清掉、不重送）；其他錯誤照舊保留；旗標關時 app_only 也照舊保留、下次開機重送
//   CH9  看板收滿的卡：有「已收滿」說明、沒有接單鈕
//   CH10 錄程入口：懸賞開著時不啟動定位取樣；網頁顯示「要用 App」、現行 App 殼顯示「請更新到最新版」（兩個平台訊號各自成立、英日文、旗標關與 ?demo=bounty 的對照；看板開著時提示要在最上層，網頁點「接下」的那句也是）
//   CH11 手機版：360／375／414／768 × Chromium／WebKit，真觸控點開護照（底部分頁列的「護照」）
//   CH12 快取與 actor 的邊界（401 清、503 留、存不下、第一次沿用裝置 id、英文介面沒有漏翻）
//   CH13 開機時序：登入結果比開機那一發 bounty-me 晚出來；401 晚到、200 晚到兩種先後，最後護照都要有登入者的段數
//   CH14 冷開機時 session 已經不見（磁碟上還記著已併的帳號）：已併的 actor 換新、裝置 id 不變、籌碼快取清掉
//   CH15 看板卡片：偏遠線標「籌碼 ×N」、其他線沒有標記；名單與 N 讀規則檔（換一份規則檔，兩個方向都跟著翻）
//   CH16 旗標開時，看板／說明卡／錄程列／接下時的提示都沒有拿「點」當獎勵單位；承諾句不再提點數；英日文介面同樣乾淨
//   CH17 說明卡的獎勵句：每趟幾顆、偏遠線倍率、每天上限，與伺服器入帳用的純函式算出來的一致（真規則檔與另一份規則檔）
//   CH18 旗標關：看不到任何一句獎勵說法（新舊都沒有）、不讀規則檔、不打認領請求；對照：旗標開同一頁看得到
//   CH19 手機版：360／375／414／768 × Chromium／WebKit，看板（有 ×N 標記）、說明卡、提示；兩兩相交掃描、沒有水平捲動、真觸控點「接下」、App 殼按「開始錄製」的更新提示在最上層、網頁點「接下」的提示在最上層
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
import { tripChips, applyDailyChipCap } from './bounty_chips_core.mjs';

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
// 刻意用跟規則檔裡任何一格都不同的數字（nextCost 7、cap 6）：期望值若是客戶端自己從規則檔算的，這裡就對不上。
// today.chips 刻意不是 0（3）：cap−chips（3）與 chips（3）都不等於 cap（6），上限格顯示的是 cap 還是 cap−chips 才分得出來。
const CHIPS = (over = {}) => ({ balance: 5, unlocked: unlockedN(1), nextCost: 7, cloud: { rides: 4, toNextChip: 2 }, today: { chips: 3, cap: 6 }, ...over });
const ME = { actor: 'x', points: 128, corrected: { segs: 12, adopted: 9 }, lines: [{ sys: 'tra_sched', lnId: '南迴線', segs: 8, adopted: 6 }], firsts: [], trips: [] };
const CARD_OPEN = { id: 'card-open', sys: 'tra_sched', lnId: '南迴線', trainKind: '自強', dir: 0, kind: 'track', slot: '',
  unitKeys: ['tra_sched|南迴線|枋寮|加祿'], units: 1, points: 3, claimers: 0, samples: 0, coverN: 50, need: 50, distinctOk: 3 };
const CARD_COVERED = { ...CARD_OPEN, id: 'card-covered', trainKind: '區間車', covered: true, distinctOk: 50 };
// 伺服器認領回應裡的點數：刻意用 4 位數的標記值（看板卡片資料用 7357／7541），跟任何規則數字與畫面上的數字都對不上，
// 畫面上若又把它們印出來，一出現就認得出。
const CLAIM_POINTS = 7939;
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
        if ((arg.bountyKeyBlocked || window.__bountyKeyBlocked) && k === 'trainmap-bounty-v1') throw new Error('QuotaExceededError');
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
        // authManual：登入結果由測試在指定的時刻才放出來（window.__fireAuth），用來重現「開機比登入結果早」的時序
        if (arg.authManual) { window.__fireAuth = () => { window.__authFired++; cb(arg.noUser ? null : user); }; return; }
        setTimeout(() => { window.__authFired++; cb(arg.noUser ? null : user); }, 50);
        if (arg.twice) setTimeout(() => { window.__authFired++; cb(arg.noUser ? null : user); }, 120);
      },
      // 真的登出：signOut 回來之後 auth 才解出 null（accountEndSession 在 await signOut 之後同步跑，null 事件晚一拍）
      signOut: async () => { setTimeout(() => { window.__authFired++; window.__authCb && window.__authCb(null); }, 0); },
    };
    try { localStorage.setItem('trainmap-account-uid', uid); } catch (e) {}
    // 頁面腳本開始跑之前，與身分有關的鍵各是什麼（冷開機的情境要先證明「上一個 session 的痕跡真的在」）
    window.__preBoot = (() => { try {
      const u = localStorage.getItem('trainmap-account-uid');
      return { uid: u, actor: localStorage.getItem('trainmap-bounty-actor-v1'), dev: localStorage.getItem('trainmap-device-id'),
        merged: u ? localStorage.getItem('trainmap-bounty-merged-' + u) : null, chips: localStorage.getItem('trainmap-chips-me-v1') !== null };
    } catch (e) { return null; } })();
  };

  // 一個獨立情境：自己的 localStorage／sessionStorage、自己的 /api 打樁與請求紀錄。回應內容與模式在請求當下才讀，測試中途可以改。
  async function newSession(arg = {}, mode = {}, ctxOpts = {}) {
    const br = ctxOpts.browser || browser;
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', ...(ctxOpts.ctx || {}) });
    await ctx.addInitScript(STUB, { uid: UID_A, ...arg });
    if (arg.app) await ctx.addInitScript(g => { Object.assign(window, g); }, APP_GLOBALS);
    // 只有 Capacitor 那個平台訊號的 App 殼（沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE）：IS_NATIVE_APP 是兩個訊號的聯集，各自單獨成立都要被認得
    if (arg.capacitor) await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }; });
    // rules：null＝送真的規則檔；物件＝改送這一份；'404'＝讀不到。rulesReq 是規則檔被請求幾次。
    const s = { ctx, merges: [], bme: [], chips: [], submits: [], claims: [], rulesReq: 0, boardReq: 0, seq: 0, errors: [],
      mode: { merge: 'ok', bme: 'ok', chips: 'ok', submit: 'app_only', ...mode },
      chipsBody: CHIPS(), meBody: ME, board: BOARD, gates: {}, rules: null };
    // 測試持有的閘：hold('actor'|'bearer') 之後，那一種 bounty-me 的回應要等到 release() 才送出（先後由測試決定，不靠睡眠秒數）
    s.hold = kind => { let release; const g = { promise: new Promise(r => { release = r; }), release: () => release() }; s.gates[kind] = g; return g; };
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
        // kind：這一發帶 Bearer 還是用 ?actor= 讀。回應可以被測試的閘（hold）扣住；doneSeq／status 記下它實際回出去的順序與結果
        const ent = { seq: ++s.seq, search: u.search, auth, kind: auth ? 'bearer' : 'actor' };
        s.bme.push(ent);
        if (s.gates[ent.kind]) await s.gates[ent.kind].promise;
        ent.doneSeq = ++s.seq;
        const m = s.mode.bme;
        // merged：這台裝置的 actor 已經併進帳號——契約：用 ?actor= 讀回 401，帶 Bearer 讀回 200
        if (m === '401' || (m === 'merged' && ent.kind === 'actor')) { ent.status = 401; return json(route, 401, { error: 'auth_required' }); }
        if (m === '403') { ent.status = 403; return json(route, 403, { error: 'wrong_account' }); }
        if (m === '503') { ent.status = 503; return json(route, 503, { error: 'not_ready' }); }
        ent.status = 200;
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
      if (u.pathname === '/api/bounty-board') { s.boardReq++; return json(route, 200, s.board); }
      if (u.pathname === '/api/bounty-claim') {
        let body = null; try { body = JSON.parse(rq.postData()); } catch (e) {}
        s.claims.push({ seq: ++s.seq, body, auth });
        return json(route, 200, { ok: true, claimId: 'cl-' + s.claims.length, units: 1, pointsLocked: CLAIM_POINTS, expiresAt: Date.now() + 86400000 });
      }
      if (u.pathname === '/data/bounty_rules.json') {
        s.rulesReq++;
        if (s.rules === '404') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
        if (s.rules) return json(route, 200, s.rules);
        return route.continue();
      }
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
  // 讀護照「校正貢獻」節實際畫出來的內容：segs＝第一個數字（校正段數）；empty＝顯示的是「還沒有校正記錄」的空狀態
  const corrInfo = (page) => page.evaluate(() => {
    const el = document.querySelector('#passport .ph-correct');
    const b = el && el.querySelector('.corr-nums b');
    return { text: el ? el.textContent.replace(/\s+/g, ' ').trim() : null, segs: b ? b.textContent.trim() : null, empty: !!(el && el.querySelector('.ph-empty')) };
  });
  const goBounty = (s, qs = '') => s.page.goto(`${BASE}/?bounty=1&lang=zh-TW${qs}`);
  // 吐司平常不接點擊（pointer-events:none），elementFromPoint 不會回它：量之前暫時讓它接得到，再問「提示矩形的左／中／右三點，最上面是誰」。
  // 被看板或遮罩蓋住時，最上面是看板（或看板裡的卡片），不是這張提示。
  const topIsToast = page => page.evaluate(() => {
    const st = document.createElement('style'); st.textContent = '#toasts, #toasts .toast { pointer-events: auto !important; }'; document.head.appendChild(st);
    const el = [...document.querySelectorAll('#toasts .toast.show')].pop();
    let toast = null;
    if (el) {
      const r = el.getBoundingClientRect();
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 10, r.top + r.height / 2], [r.right - 10, r.top + r.height / 2]];
      toast = { text: el.textContent.replace(/\s+/g, ' ').trim(), onTop: pts.every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.toast')); }),
        inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0, clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 };
    }
    st.remove();
    return { toast, boardOpen: !document.getElementById('bountyModal').hidden, briefOpen: !document.getElementById('bountyBriefModal').hidden, recording: !!state.recording };
  });
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
      ok(`CH1f-${bal} [fixture] 回應裡 today.chips＝3（不是 0）、cap＝6：cap−chips（3）與 chips（3）都不等於 cap，分得出上限格顯示的是哪一個`,
        (await s.page.evaluate(() => chipsMeMem.today.chips === 3 && chipsMeMem.today.cap === 6 && chipsMeMem.today.cap - chipsMeMem.today.chips !== chipsMeMem.today.cap)) === true);
      ok(`CH1g-${bal} 上限格裡只有一個數字、恰好是 today.cap（6）：不是 cap−chips、也不是 today.chips`,
        !!r && !!r.cells.cap && r.cells.cap.nums.length === 1 && r.cells.cap.nums[0] === '6', JSON.stringify(r && r.cells.cap));
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

    await attempt('CH6-inflight-me', async () => {
      // 在途的回應：bounty-me（護照的校正貢獻）還沒回來就登出 → 回來之後記憶體不能被寫回上一位的資料，護照也不能出現上一位的段數。
      // 回應由測試的閘扣住，等登出完成之後才放行（不靠睡眠秒數）。
      const s = await bootBounty({});
      await chipsLoaded(s.page);
      await until(async () => (await flagOf(s.page, UID_A)) !== null);                    // 登入後的合併與重讀都跑完了
      await until(() => s.page.evaluate(() => bountyMeMem !== null));
      await sleep(600);
      const gate = s.hold('bearer');
      const n0 = s.bme.length;
      await s.page.evaluate(() => { window.__inflight = fetchBountyMe(); });
      await until(() => s.bme.length > n0);                                               // 這一發已經送出、被扣在伺服器這邊
      const ent = s.bme[s.bme.length - 1];
      await s.page.evaluate(() => accountSignOut());
      await s.page.waitForFunction(() => state.account.user === null, null, { timeout: 15000 });
      await sleep(800);                                                                   // 讓兩次身分收尾都跑完
      const mid = { doneEarly: !!ent.doneSeq, memNull: await s.page.evaluate(() => bountyMeMem === null) };
      gate.release();                                                                     // 現在才讓那發 200（上一位的 12 段）回來
      await until(() => ent.doneSeq);
      await sleep(800);
      const ret = await s.page.evaluate(async () => { const r = await window.__inflight; renderPassport(); return r; });
      const c = await corrInfo(s.page);
      ok('CH6h [fixture] 登出時那一發 bounty-me 還在途（登出完成時它還沒回）、登出後記憶體已是 null；它之後回的是 200（上一位的資料）',
        mid.doneEarly === false && mid.memNull === true && ent.status === 200, JSON.stringify({ mid, ent }));
      ok('CH6i 在途那發（200，上一位的 12 段）回來之後：記憶體仍是 null、函式回 null、護照的校正貢獻節是空狀態、找不到上一位的 12 段',
        ret === null && (await s.page.evaluate(() => bountyMeMem === null)) === true && c.empty === true && c.segs === null && !/12/.test(c.text || ''), JSON.stringify({ ret, c }));
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
    // 開機流程裡呼叫 fetchChipsMe 的每一處各自也看旗標；只看開機流程的話，函式自己的那一道檢查被拿掉也不會紅，所以直接呼叫一次。
    const direct = await s.page.evaluate(async () => { try { return { r: await fetchChipsMe(), threw: '' }; } catch (e) { return { r: 'x', threw: String((e && e.message) || e) }; } });
    await sleep(500);
    ok('CH7f 旗標關、已登入時直接呼叫 fetchChipsMe()：回 null、不丟例外、chips-me 請求仍是 0 次（擋的是函式自己的旗標檢查，不是「開機流程剛好沒有呼叫它」）',
      direct.r === null && !direct.threw && s.chips.length === 0, JSON.stringify({ direct, n: s.chips.length }));
    // fetchBountyMe 同理：開機流程裡它的三個呼叫端（登入回呼、合併完成、開機）各自也看旗標，函式自己的那一道要直接呼叫才量得到。
    const directMe = await s.page.evaluate(async () => { try { return { r: await fetchBountyMe(), threw: '' }; } catch (e) { return { r: 'x', threw: String((e && e.message) || e) }; } });
    await sleep(500);
    ok('CH7h 旗標關、已登入時直接呼叫 fetchBountyMe()：回 null、不丟例外、bounty-me 請求仍是 0 次（擋的是函式自己的旗標檢查，不是「開機流程剛好沒有呼叫它」）',
      directMe.r === null && !directMe.threw && s.bme.length === 0, JSON.stringify({ directMe, n: s.bme.length }));
    await s.page.reload();
    await loggedIn(s.page); await sleep(1000);
    ok('CH7g 重新整理後仍然乾淨（沒有籌碼列、沒有請求）', (await s.page.evaluate(() => document.querySelectorAll('.ph-chips').length)) === 0 && s.chips.length === 0);
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
    await attempt('CH8e', async () => {
      // 對照：旗標關（正式站現在的狀態）——400 app_only 不是終態，佇列照舊留著、下次開機照樣重送。
      // 上傳佇列在開機時不看旗標就會重送，旗標關著時把舊佇列清掉，就改掉了還留著舊佇列的裝置的行為。
      const s = await newSession({ seed: { [KEY_QUEUE]: JSON.stringify([qItem(1), qItem(2)]) } }, { submit: 'app_only' });
      await s.page.goto(`${BASE}/?lang=zh-TW`); await loggedIn(s.page);
      await until(() => s.submits.length >= 1);
      await sleep(1200);
      const q = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH8e1 [fixture] 懸賞旗標是關的、佇列放了 2 筆、伺服器回 400 app_only、開機時真的送過',
        (await s.page.evaluate(() => BOUNTY_ENABLED)) === false && s.mode.submit === 'app_only' && s.submits.length >= 1, JSON.stringify({ n: s.submits.length }));
      ok('CH8e2 旗標關：400 app_only 不是終態——佇列 2 筆都還在、這一輪只送了隊首那一筆（共 1 發）', q.length === 2 && s.submits.length === 1, JSON.stringify({ q: q.length, submits: s.submits.length }));
      await s.page.reload(); await loggedIn(s.page); await sleep(1500);
      const q2 = JSON.parse((await lsGet(s.page, KEY_QUEUE)) || '[]');
      ok('CH8e3 旗標關：下次開機照樣重送——重新整理後又送了 1 發（共 2 發）、佇列仍是 2 筆', s.submits.length === 2 && q2.length === 2, JSON.stringify({ q: q2.length, submits: s.submits.length }));
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
  // 懸賞開著時，網頁與現行 App 殼（網頁包成的那一版）都不啟動定位取樣；提示依平台分兩句：網頁「要用 App」、App 殼「請更新到最新版」。
  // 兩句的全文就是規格，直接寫在這裡（不從頁面的字典或函式取，否則是自己驗自己）。
  // 平台訊號有兩個，IS_NATIVE_APP 是它們的聯集：RAIL_ONLINE_BASEMAPS_AVAILABLE 這個鍵在不在、Capacitor.isNativePlatform() 回不回 true；
  // 兩個各自單獨成立都要認得（只讀其中一個的寫法，另一個訊號的 App 殼就會拿到網頁那一句）。
  if (want('CH10')) {
    const WEB_PROMPT = { 'zh-TW': '錄程要用軌島 App。網頁可以看懸賞板與自己的籌碼',
      en: 'Recording a trip needs the Rail Island app. The website lets you view the bounty board and your own chips.',
      ja: '旅程の記録には軌島アプリが必要です。ウェブサイトでは懸賞板とご自身のチップを確認できます。' };
    const APP_PROMPT = { 'zh-TW': '要錄程，請先把軌島 App 更新到最新版',
      en: 'To record a trip, please update the Rail Island app to the latest version.',
      ja: '旅程を記録するには、軌島アプリを最新版に更新してください。' };
    const neither = text => !text.includes(WEB_PROMPT['zh-TW']) && !text.includes(APP_PROMPT['zh-TW']);   // 控制組：兩句都不是
    const probe = async (qs, { app = false, capacitor = false, lang = 'zh-TW' } = {}) => {
      const locale = lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
      const s = await newSession({ app, capacitor }, {}, { ctx: { locale } });
      await s.page.goto(`${BASE}/?lang=${lang}${qs}`);
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
          flag: BOUNTY_ENABLED, native: IS_NATIVE_APP, demo: DEMO_AS_APP,
          keySignal: typeof window.RAIL_ONLINE_BASEMAPS_AVAILABLE !== 'undefined',
          capSignal: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) };
      }, CARD_OPEN);
      out.errors = s.errors.length;
      await s.ctx.close();
      return out;
    };
    await attempt('CH10', async () => {
      const L = 'zh-TW';
      const on = await probe('&bounty=1', { app: true });
      ok('CH10a [fixture] 現行 App 殼（只有「RAIL_ONLINE_BASEMAPS_AVAILABLE 這個鍵在」那個平台訊號）＋懸賞旗標開、不是 ?demo=bounty（沒有旗標的話，舊程式碼在 App 殼裡會啟動取樣）',
        on.flag === true && on.native === true && on.demo === false && on.keySignal === true && on.capSignal === false, JSON.stringify(on));
      ok('CH10b 現行 App 殼、旗標開：按開始錄程 → 定位取樣沒有被啟動（bountyStartSampling 0 次）、沒有進入錄製、提示整句是「請更新到最新版」那一句（不是網頁那一句）',
        on.sampling === 0 && on.recording === false && on.toast === APP_PROMPT[L] && on.toast !== WEB_PROMPT[L], JSON.stringify(on));
      const cap = await probe('&bounty=1', { capacitor: true });
      ok('CH10c [fixture] 現行 App 殼（只有「Capacitor.isNativePlatform() 回 true」那個平台訊號，沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE）＋懸賞旗標開，頁面沒有未捕捉的例外',
        cap.flag === true && cap.native === true && cap.demo === false && cap.keySignal === false && cap.capSignal === true && cap.errors === 0, JSON.stringify(cap));
      ok('CH10d 另一個平台訊號單獨成立也算 App 殼：沒有啟動取樣、沒有進入錄製、提示整句是「請更新到最新版」那一句',
        cap.sampling === 0 && cap.recording === false && cap.toast === APP_PROMPT[L], JSON.stringify(cap));
      const web = await probe('&bounty=1', {});
      ok('CH10e 網頁、旗標開：沒有啟動取樣、沒有進入錄製、提示整句照舊是「錄程要用軌島 App。網頁可以看懸賞板與自己的籌碼」（不是更新那一句）',
        web.flag === true && web.native === false && web.demo === false && web.sampling === 0 && web.recording === false &&
          web.toast === WEB_PROMPT[L] && web.toast !== APP_PROMPT[L], JSON.stringify(web));
      const off = await probe('', { app: true });
      ok('CH10f 對照：旗標關（同樣的 App 殼）→ 照舊啟動取樣（bountyStartSampling 1 次、進入錄製）、新舊兩句提示都沒有——只有旗標開著才收斂',
        off.flag === false && off.native === true && off.sampling === 1 && off.recording === true && neither(off.toast), JSON.stringify(off));
      const offWeb = await probe('', {});
      ok('CH10g 對照：旗標關、網頁 → 沒有啟動取樣，提示是既有的「GPS 校正旅程需要用 App」、新舊兩句都不是——旗標關時網頁的行為不變',
        offWeb.flag === false && offWeb.native === false && offWeb.sampling === 0 && offWeb.recording === false && offWeb.toast === 'GPS 校正旅程需要用 App' && neither(offWeb.toast), JSON.stringify(offWeb));
      const demo = await probe('&demo=bounty', {});
      ok('CH10h 對照：?demo=bounty（網頁；備援站看設計用，不上傳）不受影響——照舊走完錄製流程（取樣 1 次、進入錄製）、新舊兩句提示都沒有',
        demo.flag === true && demo.demo === true && demo.sampling === 1 && demo.recording === true && neither(demo.toast), JSON.stringify(demo));
      const demoApp = await probe('&demo=bounty', { app: true });
      ok('CH10i 對照：?demo=bounty 在 App 殼裡也不受影響（不會被「請更新」擋下）——取樣 1 次、進入錄製、新舊兩句提示都沒有',
        demoApp.flag === true && demoApp.native === true && demoApp.demo === true && demoApp.sampling === 1 && demoApp.recording === true && neither(demoApp.toast), JSON.stringify(demoApp));
      for (const lang of ['en', 'ja']) {
        const name = lang === 'en' ? '英文' : '日文';
        const a = await probe('&bounty=1', { app: true, lang }), w = await probe('&bounty=1', { lang });
        ok(`CH10j-${lang} ${name}介面、現行 App 殼、旗標開：沒有啟動取樣、沒有進入錄製，提示整句是${name}的「請更新到最新版」`,
          a.flag === true && a.native === true && a.sampling === 0 && a.recording === false && a.toast === APP_PROMPT[lang], JSON.stringify(a));
        ok(`CH10k-${lang} ${name}介面、網頁、旗標開：沒有啟動取樣、沒有進入錄製，提示整句是${name}的「要用 App」`,
          w.flag === true && w.native === false && w.sampling === 0 && w.recording === false && w.toast === WEB_PROMPT[lang], JSON.stringify(w));
      }
    });
    // 真實流程：看板開著、接下之後說明卡開在它上面，按「開始錄製」。上面幾條直接呼叫 startBountyRecording，看板沒開，量不到被蓋住。
    await attempt('CH10l', async () => {
      const s = await newSession({ app: true });
      await goBounty(s);
      await bootDone(s.page);
      await s.page.evaluate(() => openBountyBoard());
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 1, null, { timeout: 15000 });
      await s.page.evaluate(card => showBountyBrief(card), CARD_OPEN);
      await s.page.click('#bountyBriefGo');
      await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
      await sleep(450);
      const r = await topIsToast(s.page);
      ok('CH10l 現行 App 殼（桌面）：看板與說明卡開著時按「開始錄製」→ 沒有進入錄製、看板與說明卡都收起來、「請更新」那句在最上層（左／中／右三個點的 elementFromPoint 都是這張提示）、整張卡在視窗內',
        !!r.toast && r.toast.text === APP_PROMPT['zh-TW'] && r.toast.onTop && r.toast.inView && !r.toast.clipped && !r.boardOpen && !r.briefOpen && !r.recording, JSON.stringify(r));
      await s.ctx.close();
    });
    // 網頁（旗標開、不是 ?demo=bounty）真實流程：看板開著，點卡上的「接下」。網頁沒有認領這條路，只吐一句話；看板疊在吐司上面時那句話看不到。
    const WEB_TAKE = 'GPS 校正旅程需要用 App。網頁可以看懸賞板與自己的成果';
    await attempt('CH10m', async () => {
      const s = await newSession({});
      await goBounty(s);
      await bootDone(s.page);
      await s.page.evaluate(() => openBountyBoard());
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card .bt-take').length >= 1, null, { timeout: 15000 });
      const opened = await s.page.evaluate(() => ({ board: !document.getElementById('bountyModal').hidden, native: IS_NATIVE_APP, demo: DEMO_AS_APP, flag: BOUNTY_ENABLED }));
      await s.page.click('#bountyList .bt-card .bt-take');
      await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
      await sleep(450);
      const r = await topIsToast(s.page);
      ok('CH10m 網頁（桌面）、旗標開、看板開著時點「接下」→ 看板收起來、「GPS 校正旅程需要用 App」那句在最上層（左／中／右三個點的 elementFromPoint 都是這張提示）、整張卡在視窗內；沒有送認領、沒有進入錄製（點之前看板確實開著）',
        opened.board === true && opened.native === false && opened.demo === false && opened.flag === true &&
          !!r.toast && r.toast.text === WEB_TAKE && r.toast.onTop && r.toast.inView && !r.toast.clipped && !r.boardOpen && !r.briefOpen && !r.recording && s.claims.length === 0,
        JSON.stringify({ opened, r, claims: s.claims.length }));
      await s.ctx.close();
    });
    // 同一個網頁情境、看板開著時直接呼叫 startBountyRecording：畫面上走不到這條路（網頁點「接下」在說明卡之前就被擋下），
    // 這條只守「兩個平台的提示前都先收起看板」這件事不會被改回只收一邊。
    await attempt('CH10n', async () => {
      const s = await newSession({});
      await goBounty(s);
      await bootDone(s.page);
      await s.page.evaluate(() => openBountyBoard());
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 1, null, { timeout: 15000 });
      const opened = await s.page.evaluate(() => ({ board: !document.getElementById('bountyModal').hidden, native: IS_NATIVE_APP, demo: DEMO_AS_APP, flag: BOUNTY_ENABLED }));
      await s.page.evaluate(card => startBountyRecording(card), CARD_OPEN);
      await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
      await sleep(450);
      const r = await topIsToast(s.page);
      ok('CH10n 網頁（桌面）、旗標開、看板開著時直接呼叫 startBountyRecording → 看板收起來、「錄程要用軌島 App」那句在最上層、沒有進入錄製（點之前看板確實開著）',
        opened.board === true && opened.native === false && opened.demo === false && opened.flag === true &&
          !!r.toast && r.toast.text === WEB_PROMPT['zh-TW'] && r.toast.onTop && r.toast.inView && !r.toast.clipped && !r.boardOpen && !r.recording, JSON.stringify({ opened, r }));
      await s.ctx.close();
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
      ok('CH12k 英文介面（網頁）：錄程入口的「要用 App」說明有譯文、沒有中文字', toast.length > 8 && !cjk.test(toast), toast);
      await s.ctx.close();
      const lo = await newSession({ noUser: true }, {}, { ctx: { locale: 'en-US' } });
      await lo.page.goto(`${BASE}/?bounty=1&lang=en`);
      await authResolvedNull(lo.page); await sleep(800);
      const rl = await rowInfo(lo.page);
      ok('CH12l 英文介面：登出時的提示沒有中文字', !!rl && rl.off && rl.text.length > 8 && !cjk.test(rl.text), rl && rl.text);
      await lo.ctx.close();
    });
  }

  // ═══ CH13：開機時序——登入結果比開機那一發 bounty-me 晚出來，兩發的回應不照送出的順序回來 ═════════════════════════
  // 已登入、這台裝置的 actor 已經併進帳號：開機時登入還沒就緒，那一發用 ?actor= 讀，伺服器對「併進帳號的 actor」回 401；
  // 登入結果出來後再用 Bearer 讀一發（200，登入者的 12 段）。兩發的回應不保證照送出的順序回來：
  // 晚到的 401 若蓋掉較新的 200，護照的校正貢獻就一直空著（已經併過，不會再重讀）。
  // 登入結果由測試放出來（authManual），回應的先後由測試的閘決定（不靠睡眠秒數），所以兩種先後都能穩定重現。
  if (want('CH13')) {
    const DEV13 = 'merged-device-actor-0013';
    const boot13 = async (holds) => {
      const s = await newSession({ authManual: true, seed: { [KEY_ACTOR]: DEV13, ['trainmap-bounty-merged-' + UID_A]: DEV13 } }, { bme: 'merged' });
      const gates = holds.map(k => s.hold(k));
      await goBounty(s);
      await bootDone(s.page);
      await until(() => s.bme.some(x => x.kind === 'actor'));                                   // 開機那一發（登入還沒就緒）已經送出
      await until(() => s.page.evaluate(() => typeof window.__fireAuth === 'function'));
      await s.page.evaluate(() => window.__fireAuth());                                         // 現在才讓登入結果出來
      await loggedIn(s.page);
      return { s, gates };
    };
    const verdict13 = async (tag, s, order, mid) => {
      const a = s.bme.filter(x => x.kind === 'actor'), b = s.bme.filter(x => x.kind === 'bearer');
      ok(`CH13a-${tag} [fixture] 開機那一發用 ?actor=＜已併的 actor＞讀、被回 401；登入後那一發帶 Bearer 讀、回 200（各恰好 1 發，沒有第三發）`,
        a.length === 1 && b.length === 1 && s.bme.length === 2 && a[0].search === '?actor=' + DEV13 && a[0].status === 401
          && b[0].auth === 'Bearer fake-id-token' && !/actor=/.test(b[0].search) && b[0].status === 200, JSON.stringify(s.bme));
      ok(`CH13b-${tag} [fixture] 兩發同時在途（Bearer 送出時開機那一發還沒回），回應的先後正是這一組要測的：` +
        (order === 'bearer-first' ? '200（Bearer）先回、401 晚到，而且 200 已經套用進記憶體時那發 401 還沒回' : '401 先回、200（Bearer）晚到，而且 401 回完時那發 200 還沒回'),
        !!a[0] && !!b[0] && b[0].seq < a[0].doneSeq && (order === 'bearer-first'
          ? b[0].doneSeq < a[0].doneSeq && mid.aDone === false && mid.segs === 12
          : a[0].doneSeq < b[0].doneSeq && mid.bDone === false), JSON.stringify({ mid, a: a[0], b: b[0] }));
      const mem = await s.page.evaluate(() => bountyMeMem && bountyMeMem.corrected);
      const c = await corrInfo(s.page);
      ok(`CH13c-${tag} 兩發都回完之後：記憶體裡是登入者的彙總（校正 12 段、已採用 9 段），不是被 401 清掉的 null`,
        !!mem && mem.segs === 12 && mem.adopted === 9, JSON.stringify(mem));
      ok(`CH13d-${tag} 護照的校正貢獻節有登入者的段數（12 段、其中 9 段已採用），不是「還沒有校正記錄」`,
        c.segs === '12' && !c.empty && /9/.test(c.text || '') && !/還沒有校正記錄/.test(c.text || ''), JSON.stringify(c));
      ok(`CH13e-${tag} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
    };
    await attempt('CH13-401晚到', async () => {
      const { s, gates: [gA] } = await boot13(['actor']);
      await until(() => s.page.evaluate(() => bountyMeMem !== null));                           // 登入後那一發（200）先回、已經套用
      const mid = { aDone: !!s.bme.find(x => x.kind === 'actor').doneSeq, segs: await s.page.evaluate(() => bountyMeMem && bountyMeMem.corrected.segs) };
      gA.release();                                                                              // 現在才放開機那一發：401 晚到
      await until(() => s.bme.find(x => x.kind === 'actor').doneSeq);
      await sleep(800);
      await verdict13('401晚到', s, 'bearer-first', mid);
      await s.ctx.close();
    });
    await attempt('CH13-200晚到', async () => {
      const { s, gates: [gA, gB] } = await boot13(['actor', 'bearer']);
      await until(() => s.bme.some(x => x.kind === 'bearer'));                                  // 登入後那一發也送出了：兩發同時在途
      gA.release();                                                                              // 先放開機那一發：401 先回
      await until(() => s.bme.find(x => x.kind === 'actor').doneSeq);
      await sleep(800);
      const mid = { bDone: !!s.bme.find(x => x.kind === 'bearer').doneSeq };
      gB.release();                                                                              // 再放登入後那一發：200 晚到
      await until(() => s.bme.find(x => x.kind === 'bearer').doneSeq);
      await sleep(800);
      await verdict13('200晚到', s, 'actor-first', mid);
      await s.ctx.close();
    });
  }

  // ═══ CH14：冷開機時 session 已經不見——上一個 session 沒登出就結束，這次 auth 直接解出「沒有登入」══════════════════
  // 與登出不同：這個 session 的記憶體裡從來沒有登入過的人（沒有 previousUid），只有磁碟上的痕跡（ACCOUNT_UID_KEY 還記著已併的帳號）。
  // 已併進那個帳號的 actor 若沒收掉，之後這台裝置的匿名讀取一律被伺服器回 401，匿名認領送出的也還是那個 actor。
  if (want('CH14')) {
    const DEV14 = 'cold-boot-device-0014';
    const base14 = { [KEY_DEV]: DEV14, [KEY_ACTOR]: DEV14, [KEY_CHIPS]: JSON.stringify(CHIPS({ balance: 77 })) };
    const cold = async (merged) => {
      const s = await newSession({ noUser: true, seed: merged ? { ...base14, ['trainmap-bounty-merged-' + UID_A]: DEV14 } : base14 });
      await goBounty(s);
      await authResolvedNull(s.page);
      await sleep(800);
      return s;
    };
    await attempt('CH14', async () => {
      const s = await cold(true);
      const pre = await s.page.evaluate(() => window.__preBoot);
      const st = await s.page.evaluate(() => ({ flag: BOUNTY_ENABLED, user: state.account.user, fired: window.__authFired, mem: chipsMeMem, actor: bountyActor() }));
      ok('CH14a [fixture] 開機前：上一個 session 的痕跡都在（ACCOUNT_UID_KEY 記著帳號、懸賞 actor＝裝置 id、已併旗標記的就是這個 actor、籌碼快取在）；開機後 auth 只解出一次、解出「沒有登入」、懸賞旗標開',
        !!pre && pre.uid === UID_A && pre.actor === DEV14 && pre.dev === DEV14 && pre.merged === DEV14 && pre.chips === true && st.flag === true && st.user === null && st.fired === 1, JSON.stringify({ pre, st }));
      ok('CH14b 冷開機沒有登入：已併進那個帳號的懸賞 actor 換新（合格式、不等於舊的、不是 ephemeral）',
        ACTOR_RE.test(st.actor || '') && st.actor !== DEV14 && st.actor !== 'ephemeral' && (await lsGet(s.page, KEY_ACTOR)) === st.actor, JSON.stringify({ actor: st.actor }));
      ok('CH14c trainmap-device-id 沒變（懸賞的 actor 不跟同步用的裝置 id 混用）', (await lsGet(s.page, KEY_DEV)) === DEV14);
      ok('CH14d 籌碼快取 trainmap-chips-me-v1 清掉、記憶體裡的籌碼是 null', (await lsGet(s.page, KEY_CHIPS)) === null && st.mem === null);
      await s.ctx.close();
      const c = await cold(false);
      const pc = await c.page.evaluate(() => window.__preBoot);
      ok('CH14e 對照：同樣的冷開機、但這個 actor 沒有併過（沒有已併旗標）→ actor 不換；籌碼快取照樣清掉（換 actor 是「併過」才有的後果）',
        !!pc && pc.uid === UID_A && pc.merged === null && pc.chips === true && (await lsGet(c.page, KEY_ACTOR)) === DEV14 && (await lsGet(c.page, KEY_CHIPS)) === null, JSON.stringify(pc));
      await c.ctx.close();
    });
  }
  // ═══ 獎勵說法共用（CH15–CH19）═══════════════════════════════════════════════════════════════════════════════════
  // 期望值只用本檔自己讀的規則檔（RULES）與伺服器入帳用的純函式（bounty_chips_core.mjs）算，不呼叫 index.html 的任何函式。
  const KEY_NAN = 'tra_sched|南迴線', KEY_PT = 'tra_sched|屏東線';
  // 另一份規則檔：每趟、倍率、每天上限、偏遠線名單都跟真的那份不同——畫面若寫死（或讀錯來源），換一份就對不上。
  const RULES_ALT = { ...RULES, chips: { ...RULES.chips, perTrip: 3, remoteMultiplier: 5, dailyChipCap: 20, remoteLines: [KEY_PT] } };
  // 伺服器會怎麼給：一趟合格的錄程，非偏遠線給 perTrip、偏遠線給 perTrip × 倍率；一天最多 dailyChipCap。
  const expectOf = (rules, lineKey) => {
    const c = rules.chips;
    const trip = k => ({ verdict: 'ok', lineKeys: [k], durationSec: c.minTripSec, moveM: c.minTripMoveM, day: '2026-10-02' });
    const base = tripChips(trip('none|不是偏遠線'), c), here = tripChips(trip(lineKey), c);
    return { perTrip: base, mult: here / base, remote: here !== base, cap: applyDailyChipCap(1e9, 0, c) };
  };
  const CARD_R = { ...CARD_OPEN, id: 'card-remote-open', unitKeys: ['tra_sched|南迴線|加祿|枋寮'], points: 7357 };                  // 南迴線：真規則檔的偏遠線
  const CARD_P = { ...CARD_OPEN, id: 'card-other-open', lnId: '屏東線', unitKeys: ['tra_sched|屏東線|民族|高雄'], points: 7541 };   // 屏東線：真規則檔不是，另一份規則檔才是
  const CARD_RC = { ...CARD_COVERED, id: 'card-remote-covered' };                                                              // 南迴線、收滿
  const BOARD_V2 = { ...BOARD, cards: [CARD_R, CARD_P, CARD_RC] };
  const POINT_MARKS = /7357|7541|7939/;                                                  // 卡片資料與認領回應裡的點數標記值
  const POINTS_RE = /\d\s*點|點數|鎖價|點已鎖定/;                                         // 繁中：拿點數當獎勵單位的寫法
  const POINTS_RE_I18N = /\bpts?\b|\bpoints?\b|locked[- ]in|ポイント|ロック/i;            // 英日文同一類寫法
  // App 殼、旗標開、已登入，打開看板等所有卡出來。桌面走護照上的「懸賞板」鈕。
  const boardSession = async (arg = {}, { rules = null, board = BOARD_V2, lang = 'zh-TW', me = null } = {}) => {
    const locale = lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
    const s = await newSession({ app: true, ...arg }, {}, { ctx: { locale } });
    s.board = board; s.rules = rules; if (me) s.meBody = me;
    await s.page.goto(`${BASE}/?bounty=1&lang=${lang}`);
    await loggedIn(s.page);
    await chipsLoaded(s.page);
    await s.page.click('#passport [data-act="bountyboard"]');
    await s.page.waitForFunction(n => document.querySelectorAll('#bountyList .bt-card').length >= n, board.cards.length, { timeout: 15000 });
    return s;
  };
  const readBoard = page => page.evaluate(() => ({
    sub: document.getElementById('bountySub').textContent.replace(/\s+/g, ' ').trim(),
    cards: [...document.querySelectorAll('#bountyList .bt-card')].map(c => ({ id: c.dataset.card,
      text: c.textContent.replace(/\s+/g, ' ').trim(),
      tags: [...c.querySelectorAll('.bt-pt')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      take: c.querySelectorAll('.bt-take').length })) }));
  const briefOpen = page => page.waitForFunction(() => { const m = document.getElementById('bountyBriefModal'); return !!m && !m.hidden && !!m.querySelector('#bountyBriefBody .bb-sec'); }, null, { timeout: 15000 });
  const readBrief = page => page.evaluate(() => ({
    text: document.getElementById('bountyBriefBody').textContent.replace(/\s+/g, ' ').trim(),
    toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) }));
  const takeSel = id => `#bountyList .bt-card[data-card="${id}"] .bt-take`;
  // 說明卡獎勵句的字面（字典的譯文）；數字與單複數由期望值決定
  const REWARD = {
    'zh-TW': e => ({ per: `合格的一趟得 ${e.perTrip} 顆籌碼。`, mult: `這條線的籌碼 ×${e.mult}。`, cap: `每天最多 ${e.cap} 顆。` }),
    en: e => ({ per: `A qualifying trip earns ${e.perTrip} chip${e.perTrip === 1 ? '' : 's'}.`, mult: `Chips are ×${e.mult} on this line.`, cap: `Up to ${e.cap} chip${e.cap === 1 ? '' : 's'} a day.` }),
    ja: e => ({ per: `条件を満たした1回の乗車でチップを ${e.perTrip} 枚もらえます。`, mult: `この路線ではチップが ${e.mult} 倍になります。`, cap: `1日に獲得できるのは最大 ${e.cap} 枚です。` }),
  };

  // ═══ CH15：看板卡片的籌碼標記——偏遠線標「籌碼 ×N」、其他線沒有；名單與 N 讀規則檔 ═══════════════════════════════════
  if (want('CH15')) {
    const cardOf = (b, id) => b.cards.find(x => x.id === id) || { tags: null, text: '', take: -1 };
    await attempt('CH15-real', async () => {
      const s = await boardSession();
      const b = await readBoard(s.page);
      const eR = expectOf(RULES, KEY_NAN), eP = expectOf(RULES, KEY_PT);
      ok('CH15a [fixture] 看板收到 3 張卡（南迴線一般卡、屏東線一般卡、南迴線收滿卡）；真規則檔裡南迴線是偏遠線、屏東線不是，伺服器入帳函式對這兩條線給的倍率也不同（有對照）',
        b.cards.length === 3 && RULES.chips.remoteLines.includes(KEY_NAN) && !RULES.chips.remoteLines.includes(KEY_PT) && eR.remote && eR.mult > 1 && !eP.remote && eP.mult === 1,
        JSON.stringify({ n: b.cards.length, eR, eP }));
      ok(`CH15b 偏遠線的一般卡有且只有一個標記，寫成「籌碼 ×${eR.mult}」（倍率是伺服器入帳函式算的那個）`,
        JSON.stringify(cardOf(b, CARD_R.id).tags) === JSON.stringify([`籌碼 ×${eR.mult}`]), JSON.stringify(cardOf(b, CARD_R.id)));
      ok('CH15c 非偏遠線的卡沒有任何標記，卡面也沒有「×」或「籌碼」字樣（有標記的與沒標記的在同一塊板上）',
        JSON.stringify(cardOf(b, CARD_P.id).tags) === '[]' && !/[×籌]/.test(cardOf(b, CARD_P.id).text), JSON.stringify(cardOf(b, CARD_P.id)));
      ok(`CH15d 偏遠線的收滿卡也標「籌碼 ×${eR.mult}」，而且照樣沒有接單鈕`,
        JSON.stringify(cardOf(b, CARD_RC.id).tags) === JSON.stringify([`籌碼 ×${eR.mult}`]) && cardOf(b, CARD_RC.id).take === 0, JSON.stringify(cardOf(b, CARD_RC.id)));
      ok('CH15e 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    await attempt('CH15-alt', async () => {
      const s = await boardSession({}, { rules: RULES_ALT });
      const b = await readBoard(s.page);
      const probe = await s.page.evaluate(() => ({ mult: bountyRulesMem && bountyRulesMem.chips.remoteMultiplier, lines: bountyRulesMem && bountyRulesMem.chips.remoteLines }));
      const aP = expectOf(RULES_ALT, KEY_PT), aR = expectOf(RULES_ALT, KEY_NAN);
      ok('CH15f [fixture] 換成另一份規則檔：頁面讀到的就是它（倍率 5、偏遠線只剩屏東線）；伺服器入帳函式對它：屏東線 ×5、南迴線不加倍',
        probe.mult === 5 && JSON.stringify(probe.lines) === JSON.stringify([KEY_PT]) && s.rulesReq >= 1 && aP.mult === 5 && !aR.remote, JSON.stringify({ probe, rulesReq: s.rulesReq, aP, aR }));
      ok('CH15g 名單與倍率跟著規則檔走（不是寫死）：屏東線的卡標「籌碼 ×5」，南迴線的卡（一般與收滿）都沒有標記',
        JSON.stringify(cardOf(b, CARD_P.id).tags) === JSON.stringify([`籌碼 ×${aP.mult}`]) && JSON.stringify(cardOf(b, CARD_R.id).tags) === '[]' && JSON.stringify(cardOf(b, CARD_RC.id).tags) === '[]',
        JSON.stringify(b.cards.map(c => [c.id, c.tags])));
      await s.ctx.close();
    });
    await attempt('CH15-404', async () => {
      const s = await boardSession({}, { rules: '404' });
      const b = await readBoard(s.page);
      ok('CH15h 規則檔讀不到：看板照樣出來（3 張卡、一般卡有接單鈕），沒有任何標記（寧可不標，也不標錯），頁面沒有未捕捉的例外',
        b.cards.length === 3 && cardOf(b, CARD_R.id).take === 1 && b.cards.every(c => c.tags.length === 0) && s.errors.length === 0, JSON.stringify({ cards: b.cards.map(c => [c.id, c.tags, c.take]), errors: s.errors }));
      await s.ctx.close();
    });
  }

  // ═══ CH16：旗標開時，畫面上沒有任何一句拿「點」當獎勵單位 ═══════════════════════════════════════════════════════
  // 看板卡片資料與認領回應裡的點數用 4 位數的標記值（7357／7541／7939）：畫面上若又印出來，一眼認得出；
  // 字面的「點」「鎖價」另用正則抓。範圍：看板副標與卡片、接下時的提示（接下／存不下／已接下／示範四條路徑）、
  // 出發前說明卡、錄程列、護照空狀態那句承諾、說明中心那一則。中文、英文、日文各跑一遍。
  if (want('CH16')) {
    const TX = {
      'zh-TW': { re: POINTS_RE, sub: [/籌碼/, /上限/], subNo: /榮譽/, subDemo: [/示範資料/, /都是假的/], tag: '籌碼 ×2',
        claimed: '接下了・24 小時內有效', demoClaimed: '（示範）接下了・24 小時內有效',
        saveFail: '已在伺服器接下，但這台裝置存不下來（可能是儲存空間滿了或無痕模式）——重新整理後認領不會留著',
        again: '這段你已經接下了，還沒過期', expiry: '接下的卡 24 小時內有效。', promise: '即使這次的資料不能用，校正者章還是你的。',
        passport: '章還是你的', tip: '校正者章還是你的', rowTrack: '0 段已覆蓋', rowDwell: '0 站已覆蓋' },
      en: { re: POINTS_RE_I18N, sub: [/chips/, /daily limit/], subNo: /honou?r/i, subDemo: [/Demo data/, /fake/], tag: 'Chips ×2',
        claimed: 'Claimed · valid for 24 hours', demoClaimed: '(Demo) Claimed · valid for 24 hours',
        saveFail: 'Claimed on the server, but this device couldn’t save it (storage may be full, or you’re in private browsing) — the claim won’t persist after you refresh',
        again: 'You’ve already claimed this segment, and it hasn’t expired yet', expiry: 'A claimed card is valid for 24 hours.', promise: 'Even if this data can’t be used, the calibrator stamp is still yours.',
        passport: 'even if the data can’t be used, the stamp is still yours', tip: 'you keep the calibrator stamp', rowTrack: 'Segments covered: 0', rowDwell: 'Stations covered: 0' },
      ja: { re: POINTS_RE_I18N, sub: [/チップ/, /上限/], subNo: /名誉/, subDemo: [/デモデータ/, /仮/], tag: 'チップ ×2',
        claimed: '受け取りました・24時間有効', demoClaimed: '（デモ）受け取りました・24時間有効',
        saveFail: 'サーバー側では受領済みですが、この端末には保存できませんでした（ストレージ不足またはプライベートブラウジングの可能性）。更新すると受領記録は残りません',
        again: 'この区間はすでに受け取り済みで、まだ有効期限内です', expiry: '受け取ったカードは24時間有効です。', promise: '今回のデータが使えなくても、校正者スタンプはあなたのものです。',
        passport: 'データが使えなかった場合でも、スタンプはあなたのものです', tip: '校正者スタンプはあなたのものです', rowTrack: '0区間を記録済み', rowDwell: '0駅を記録済み' },
    };
    const ME_EMPTY = { ...ME, points: 0, corrected: { segs: 0, adopted: 0 }, lines: [] };       // 護照「校正貢獻」的空狀態
    const noPts = (x, re) => !re.test(x) && !POINT_MARKS.test(x);
    for (const lang of ['zh-TW', 'en', 'ja']) {
      const X = TX[lang];
      await attempt(`CH16-app-${lang}`, async () => {
        const s = await boardSession({}, { lang, me: ME_EMPTY });
        const b = await readBoard(s.page);
        const memPts = await s.page.evaluate(() => bountyBoardMem.cards.map(c => c.points));
        ok(`CH16a-${lang} [fixture] 看板資料裡每張卡都帶點數（${memPts.join('、')}）——畫面不印它們才有意義；3 張卡都畫出來了`,
          memPts.length === 3 && memPts.every(Number.isFinite) && b.cards.length === 3, JSON.stringify({ memPts, n: b.cards.length }));
        ok(`CH16b-${lang} 看板副標講籌碼與每天上限、沒有寫成「只有榮譽」；副標與每張卡的字都沒有拿點當獎勵單位（沒有點數字樣、沒有卡片資料裡的 7357／7541）`,
          X.sub.every(r => r.test(b.sub)) && !X.subNo.test(b.sub) && [b.sub, ...b.cards.map(c => c.text)].every(x => noPts(x, X.re)), JSON.stringify(b));
        await s.page.click(takeSel(CARD_R.id));
        await briefOpen(s.page);
        const br = await readBrief(s.page);
        ok(`CH16c-${lang} [fixture] 接下第一張卡：伺服器收到 1 發認領（cardId 對、有 actor）、說明卡開了、提示出現了`,
          s.claims.length === 1 && !!s.claims[0].body && s.claims[0].body.cardId === CARD_R.id && typeof s.claims[0].body.actor === 'string' && br.toasts.length >= 1, JSON.stringify({ claims: s.claims.length, toasts: br.toasts }));
        ok(`CH16d-${lang} 接下時的提示只有一句「${X.claimed}」：沒有點數、沒有伺服器回的 7939`, br.toasts.length === 1 && br.toasts[0] === X.claimed, JSON.stringify(br.toasts));
        ok(`CH16e-${lang} 出發前說明卡沒有點數字樣（沒有點數字樣、沒有 7357／7939、沒有「值 N」）；有期限那句與承諾那句`,
          noPts(br.text, X.re) && !/值\s*\d/.test(br.text) && br.text.includes(X.expiry) && br.text.includes(X.promise), br.text);
        const live = await s.page.evaluate(() => !!document.querySelector('#bountyList .bt-card[data-card="card-remote-open"] .bt-take[data-claimed="1"]'));
        const b2 = await readBoard(s.page);
        ok(`CH16f-${lang} 接下之後看板重畫（那張卡標成已接下）：照樣沒有點數字樣`, live && b2.cards.length === 3 && b2.cards.every(c => noPts(c.text, X.re)), JSON.stringify({ live, b2 }));
        await s.page.click('#bountyBriefLater');
        // 本機有這張卡還沒過期的認領、看板上卻找不到它：再接一次不送第二發認領，提示照實說「已經接下了」
        const again = await s.page.evaluate(async () => {
          document.getElementById('toasts').innerHTML = '';
          const keep = bountyBoardMem; bountyBoardMem = { cards: [] };
          try { await bountyClaim('card-remote-open'); } finally { bountyBoardMem = keep; }
          return [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        });
        ok(`CH16g-${lang} [fixture] 已接下又再接一次：沒有送第二發認領（共 ${s.claims.length} 發）；提示是「${X.again}」`, s.claims.length === 1 && again.length === 1 && again[0] === X.again, JSON.stringify({ claims: s.claims.length, again }));
        // 這台裝置存不下認領（無痕模式、空間滿）：伺服器已經接下，提示照實講，不報成功
        await s.page.evaluate(() => { window.__bountyKeyBlocked = true; document.getElementById('toasts').innerHTML = ''; });
        await s.page.click(takeSel(CARD_P.id));
        await briefOpen(s.page);
        await until(() => s.claims.length >= 2);
        const br2 = await readBrief(s.page);
        const saved = JSON.parse((await lsGet(s.page, 'trainmap-bounty-v1')) || '{}');
        ok(`CH16h-${lang} [fixture] 第二張卡接下時這台裝置存不下（磁碟上只有第一張的認領）、伺服器收到第 2 發認領`,
          s.claims.length === 2 && !!saved.claims && !!saved.claims[CARD_R.id] && !saved.claims[CARD_P.id], JSON.stringify({ claims: s.claims.length, saved: Object.keys(saved.claims || {}) }));
        ok(`CH16i-${lang} 存不下時的提示照實說「伺服器接下了、這裡沒存成」、沒有點數、沒有 7939；說明卡照樣開了`,
          br2.toasts.length === 1 && br2.toasts[0] === X.saveFail && noPts(br2.toasts[0], X.re) && br2.text.length > 40, JSON.stringify(br2.toasts));
        const pp = await s.page.evaluate(() => { const e = document.querySelector('#passport .ph-correct .ph-empty'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
        ok(`CH16j-${lang} 護照「校正貢獻」空狀態那句承諾沒有提點數（「${X.passport}」在、沒有點數字樣）`, pp !== null && pp.includes(X.passport) && noPts(pp, X.re), String(pp));
        await s.page.evaluate(() => openHelp('bountyme'));
        const tip = await s.page.evaluate(() => { const e = document.querySelector('#helpBody .help-sec[data-sec="bountyme"] .tip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
        ok(`CH16k-${lang} 說明中心「護照裡的校正貢獻」那一則沒有提點數（「${X.tip}」在、沒有點數字樣）`, tip !== null && tip.includes(X.tip) && noPts(tip, X.re), String(tip));
        if (lang === 'en') ok('CH16l-en 英文介面：提示與承諾句沒有漏出中文（日文用漢字，這條只對英文有意義；日文那一輪靠上面的整句比對）', [br.toasts[0], br2.toasts[0], again[0], pp, tip].every(x => !/[㐀-鿿]/.test(x)), JSON.stringify([br.toasts[0], br2.toasts[0], again[0], pp, tip]));
        ok(`CH16m-${lang} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
        await s.ctx.close();
      });
      await attempt(`CH16-demo-${lang}`, async () => {
        // ?demo=bounty（備援站看設計用，不上傳）：假資料的看板、示範接下、說明卡、錄程列
        const s = await newSession({ app: false }, {}, { ctx: { locale: lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW' } });
        await s.page.goto(`${BASE}/?lang=${lang}&demo=bounty`);
        await bootDone(s.page);
        await s.page.click('#passport [data-act="bountyboard"]');
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
        const b = await readBoard(s.page);
        const ids = await s.page.evaluate(() => ({ dwell: (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id, track: (bountyBoardMem.cards.find(c => c.kind === 'track') || {}).id,
          pts: bountyBoardMem.cards.map(c => c.points), demo: DEMO_AS_APP && BOUNTY_ENABLED && !IS_NATIVE_APP }));
        ok(`CH16n-${lang} [fixture] 示範看板：假資料的卡帶著點數（${ids.pts.join('、')}）、有停站卡與路段卡；是示範流程、不是 App 殼`,
          ids.demo === true && ids.pts.length >= 5 && ids.pts.every(Number.isFinite) && !!ids.dwell && !!ids.track, JSON.stringify(ids));
        ok(`CH16o-${lang} 示範副標有「示範、假的」與籌碼那句、不再說「路段與點數都是假的」；副標與每張卡沒有拿點當獎勵單位`,
          X.subDemo.every(r => r.test(b.sub)) && X.sub.every(r => r.test(b.sub)) && !/點數|points/i.test(b.sub) && [b.sub, ...b.cards.map(c => c.text)].every(x => !X.re.test(x)), JSON.stringify(b));
        await s.page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
        await s.page.click(takeSel(ids.dwell));
        await briefOpen(s.page);
        const br = await readBrief(s.page);
        ok(`CH16p-${lang} 示範接下的提示是「${X.demoClaimed}」；說明卡沒有點數字樣、有期限與承諾那兩句`,
          br.toasts.length === 1 && br.toasts[0] === X.demoClaimed && !X.re.test(br.text) && !/值\s*\d/.test(br.text) && br.text.includes(X.expiry) && br.text.includes(X.promise), JSON.stringify({ toasts: br.toasts, text: br.text }));
        await s.page.click('#bountyBriefGo');
        await s.page.waitForFunction(() => !!state.recording, null, { timeout: 15000 });
        await s.page.evaluate(() => setRecordPanel(true));
        const row = await s.page.evaluate(() => ({ dwell: document.getElementById('recRow').textContent.replace(/\s+/g, ' ').trim(),
          open: !document.getElementById('recordScreen').hidden }));
        const rowTrack = await s.page.evaluate(trackId => {            // 同一個錄製畫面、卡換成路段卡再畫一次（路段那條樣板）
          const r = state.recording, keep = r.card;
          r.card = bountyBoardMem.cards.find(c => c.id === trackId); renderRecordScreen();
          const t1 = document.getElementById('recRow').textContent.replace(/\s+/g, ' ').trim();
          r.card = keep; renderRecordScreen();
          return t1;
        }, ids.track);
        ok(`CH16q-${lang} 錄程列只寫覆蓋了幾站／幾段（停站卡「${X.rowDwell}」、路段卡「${X.rowTrack}」），沒有「點已鎖定」；錄製畫面真的開了（列是樣板畫的、不是靜態佔位）`,
          row.open && row.dwell === X.rowDwell && rowTrack === X.rowTrack && !X.re.test(row.dwell) && !X.re.test(rowTrack), JSON.stringify({ row, rowTrack }));
        ok(`CH16r-${lang} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
        await s.ctx.close();
      });
    }
  }

  // ═══ CH17：說明卡的獎勵句——數字讀規則檔，偏遠線才有倍率句，與伺服器入帳用的純函式一致 ═══════════════════════════════════
  // 規則檔換一份（每趟、倍率、上限、偏遠線名單都不同），句子的數字與有沒有倍率句都要跟著翻；兩個方向、中英日三種介面。
  if (want('CH17')) {
    const CASES = [
      ['真規則檔·偏遠線', null, RULES, CARD_R, KEY_NAN],
      ['真規則檔·非偏遠線', null, RULES, CARD_P, KEY_PT],
      ['另一份規則檔·偏遠線', RULES_ALT, RULES_ALT, CARD_P, KEY_PT],
      ['另一份規則檔·非偏遠線', RULES_ALT, RULES_ALT, CARD_R, KEY_NAN],
    ];
    for (const [tag, served, rules, card, key] of CASES) await attempt(`CH17-${tag}`, async () => {
      const s = await boardSession({}, { rules: served });
      const loaded = await s.page.evaluate(() => { const c = bountyRulesMem && bountyRulesMem.chips; return c ? { perTrip: c.perTrip, mult: c.remoteMultiplier, cap: c.dailyChipCap } : null; });
      await s.page.click(takeSel(card.id));
      await briefOpen(s.page);
      const br = await readBrief(s.page);
      const e = expectOf(rules, key), w = REWARD['zh-TW'](e);
      ok(`CH17a-${tag} [fixture] 頁面讀到的規則就是這一輪該有的那份（每趟 ${rules.chips.perTrip}、倍率 ${rules.chips.remoteMultiplier}、上限 ${rules.chips.dailyChipCap}）；伺服器入帳函式對這條線：${e.remote ? `偏遠線、一趟 ×${e.mult}` : '不是偏遠線、不加倍'}`,
        !!loaded && loaded.perTrip === rules.chips.perTrip && loaded.mult === rules.chips.remoteMultiplier && loaded.cap === rules.chips.dailyChipCap && e.perTrip === rules.chips.perTrip, JSON.stringify({ loaded, e }));
      ok(`CH17b-${tag} 說明卡有「${w.per}」與「${w.cap}」（每趟與每天上限，數字＝伺服器入帳用的純函式算出來的）`, br.text.includes(w.per) && br.text.includes(w.cap), br.text);
      ok(`CH17c-${tag} ${e.remote ? `偏遠線：有「${w.mult}」，位置在每趟那句與每天上限那句之間` : '不是偏遠線：沒有倍率那句（整段沒有「×」也沒有「這條線的籌碼」）'}`,
        e.remote ? (br.text.includes(w.mult) && br.text.indexOf(w.per) < br.text.indexOf(w.mult) && br.text.indexOf(w.mult) < br.text.indexOf(w.cap)) : !/×|這條線的籌碼/.test(br.text), br.text);
      await s.ctx.close();
    });
    await attempt('CH17-404', async () => {
      const s = await boardSession({}, { rules: '404' });
      await s.page.click(takeSel(CARD_R.id));
      await briefOpen(s.page);
      const br = await readBrief(s.page);
      ok('CH17d 規則檔讀不到：說明卡照樣開、沒有任何獎勵句（寧可不寫，也不憑記憶補數字，或寫伺服器不一定會給的東西）；期限那句與承諾那句照在',
        !/顆籌碼|每天最多|×|這條線的籌碼/.test(br.text) && br.text.includes('接下的卡 24 小時內有效。') && br.text.includes('即使這次的資料不能用，校正者章還是你的。'), br.text);
      ok('CH17e 規則檔讀不到：頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    for (const lang of ['en', 'ja']) await attempt(`CH17-${lang}`, async () => {
      for (const [tag, served, rules, card, key] of [CASES[0], CASES[3]]) {
        const s = await boardSession({}, { rules: served, lang });
        await s.page.click(takeSel(card.id));
        await briefOpen(s.page);
        const br = await readBrief(s.page);
        const e = expectOf(rules, key), w = REWARD[lang](e);
        ok(`CH17f-${lang}-${tag} 外文介面的獎勵句：「${w.per}」「${w.cap}」${e.remote ? `「${w.mult}」` : '（不是偏遠線：沒有倍率句）'}；數字與單複數照伺服器入帳函式算的`,
          br.text.includes(w.per) && br.text.includes(w.cap) && (e.remote ? br.text.includes(w.mult) : !/×|倍/.test(br.text)), br.text);
        await s.ctx.close();
      }
    });
  }

  // ═══ CH18：旗標關——看不到任何一句獎勵說法、不讀規則檔、不打看板與認領；對照：同一個 App 殼旗標開就看得到 ═══════════════════
  if (want('CH18')) {
    const SAYS = /合格的一趟|顆籌碼|這條線的籌碼|每天最多|每天有上限|校正者章|懸賞板|籌碼 ×/;
    const look = async (s) => {
      const st = await s.page.evaluate(() => ({ flag: BOUNTY_ENABLED, native: PHYSICAL_COLLECT_ENABLED, entry: !!document.querySelector('[data-act="bountyboard"]'),
        text: document.body.innerText,
        boxes: ['bountyModal', 'bountyBriefModal', 'recordScreen'].map(id => { const e = document.getElementById(id); return !!e && (e.hidden || getComputedStyle(e).display === 'none'); }),
        rulesMem: typeof bountyRulesMem === 'undefined' ? 'undef' : bountyRulesMem }));
      await s.page.evaluate(() => openHelp());
      const help = await s.page.evaluate(() => ({ secs: document.querySelectorAll('#helpBody .help-sec[data-sec^="bounty"]').length, text: document.getElementById('helpBody').innerText }));
      return { st, help };
    };
    await attempt('CH18-off', async () => {
      const s = await newSession({ app: true });
      s.board = BOARD_V2;
      await s.page.goto(`${BASE}/?lang=zh-TW`);
      await loggedIn(s.page);
      await sleep(1000);
      const { st, help } = await look(s);
      ok('CH18a [fixture] 旗標關、App 殼（有登入）：不是示範流程', st.flag === false && st.native === true, JSON.stringify({ flag: st.flag, native: st.native }));
      ok('CH18b 旗標關：沒有懸賞板入口、整頁看得到的字裡沒有任何一句獎勵說法（每趟幾顆、倍率、每天上限、校正者章、懸賞板、籌碼 ×N）、三個懸賞浮層都藏著',
        st.entry === false && !SAYS.test(st.text) && st.boxes.every(Boolean), JSON.stringify({ entry: st.entry, boxes: st.boxes, hit: (st.text.match(SAYS) || [null])[0] }));
      ok('CH18c 旗標關：說明中心沒有懸賞那幾節（bounty 開頭的節 0 個）、說明中心的字裡也沒有獎勵說法', help.secs === 0 && !SAYS.test(help.text), JSON.stringify({ secs: help.secs, hit: (help.text.match(SAYS) || [null])[0] }));
      ok('CH18d 旗標關：不讀規則檔（0 次、記憶體裡沒有）、不打看板、認領、籌碼、彙總（各 0 次）',
        s.rulesReq === 0 && st.rulesMem === null && s.boardReq === 0 && s.claims.length === 0 && s.chips.length === 0 && s.bme.length === 0, JSON.stringify({ rules: s.rulesReq, board: s.boardReq, claims: s.claims.length, chips: s.chips.length, bme: s.bme.length }));
      ok('CH18e 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    await attempt('CH18-on', async () => {
      // 對照：同一個 App 殼、同一份看板，只差旗標——入口在、說明中心有懸賞那幾節、讀了規則檔、說明卡看得到獎勵句
      const s = await boardSession();
      const { st, help } = await look(s);
      const hit = SAYS.test(st.text) || SAYS.test(help.text);
      await s.page.evaluate(() => closeHelp());
      await s.page.click(takeSel(CARD_R.id));
      await briefOpen(s.page);
      const br = await readBrief(s.page);
      const e = expectOf(RULES, KEY_NAN), w = REWARD['zh-TW'](e);
      ok('CH18f 對照：旗標開——有懸賞板入口、說明中心有 3 節懸賞的說明、讀了規則檔、看板打了、說明卡有獎勵句（所以 CH18b–d 的「沒有」是旗標造成的）',
        st.flag === true && st.entry === true && help.secs === 3 && hit && s.rulesReq >= 1 && s.boardReq >= 1 && br.text.includes(w.per) && br.text.includes(w.cap),
        JSON.stringify({ flag: st.flag, entry: st.entry, secs: help.secs, hit, rules: s.rulesReq, board: s.boardReq }));
      await s.ctx.close();
    });
  }

  // ═══ CH19：手機版——四個寬度 × 兩個引擎：看板（有 ×N 標記）、說明卡、接下時的提示 ═══════════════════════════════════════
  // 真觸控（isMobile＋hasTouch、page.tap）從底部分頁列「護照」進、點「懸賞板」、點「接下」。量的是實際版面：
  // 兩兩相交掃描（逐層裁掉捲動容器之外看不到的部分）、水平捲動、elementFromPoint 命中、提示卡在視窗內且沒被截。
  if (want('CH19')) {
    const MEASURE = ({ itemSel, scrollSels, reachSel }) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const shown = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      // 會讓後代（fixed）或定位後代（absolute）以它為包含區塊的祖先：transform／filter 等、或已定位
      const makesCB = (cs, absolute) => cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
        /paint|layout|strict|content/.test(cs.contain) || /transform|perspective|filter/.test(cs.willChange) || (absolute && cs.position !== 'static');
      const clip = el => {                                  // 這個元素實際看得到的矩形：往上逐層裁掉有捲動／裁切的容器
        const r = el.getBoundingClientRect();
        let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rr = Math.min(r.right, vw), b = Math.min(r.bottom, vh);
        // fixed／absolute 的元素不被「不是它包含區塊」的祖先的 overflow 裁掉：往上找到它的包含區塊那一層才開始裁
        const pos = getComputedStyle(el).position;
        let escaped = pos === 'fixed' || pos === 'absolute';
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (escaped) { if (!makesCB(cs, pos === 'absolute')) continue; escaped = false; }
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const q = p.getBoundingClientRect();
          l = Math.max(l, q.left); t = Math.max(t, q.top); rr = Math.min(rr, q.right); b = Math.min(b, q.bottom);
        }
        return { l, t, r: rr, b, full: r };
      };
      const name = el => (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]) + ':' + el.textContent.replace(/\s+/g, ' ').trim().slice(0, 10);
      const rects = [...document.querySelectorAll(itemSel)].filter(shown).map(el => ({ el, ...clip(el) })).filter(x => x.r - x.l > 0.5 && x.b - x.t > 0.5);
      const pairs = [];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 0.5 && h > 0.5) pairs.push([name(a.el), name(b.el), Math.round(w), Math.round(h)]);
      }
      const reach = [...document.querySelectorAll(reachSel)].filter(shown).map(el => {
        const c = clip(el); const x = (c.l + c.r) / 2, y = (c.t + c.b) / 2; const hit = document.elementFromPoint(x, y);
        return { n: name(el), ok: !!hit && (hit === el || el.contains(hit)), vis: c.r - c.l > 0.5 && c.b - c.t > 0.5 };
      }).filter(x => x.vis);
      const hscroll = { doc: document.documentElement.scrollWidth - vw };
      for (const sel of scrollSels) { const e = document.querySelector(sel); hscroll[sel] = e ? e.scrollWidth - e.clientWidth : null; }
      return { vw, vh, n: rects.length, pairs, reach, hscroll,
        out: rects.filter(x => x.full.left < -0.5 || x.full.right > vw + 0.5).map(x => name(x.el)) };
    };
    const BOARD_ITEMS = '#bountyModal .tk-head b, #bountyModal .tk-x, #bountyBriefModal .tk-x, #bountySub, #bountyList .bt-r, #bountyList .bt-meta, #bountyList .bt-pt, #bountyList .bt-take, #bountyList .bt-covered';
    const BRIEF_ITEMS = '#bountyBriefModal .tk-head b, #bountyBriefModal .tk-x, #bountyBriefBody .bb-sec > b, #bountyBriefBody .bb-sec p, #bountyBriefBody .bb-sec li, #bountyBriefModal .tk-foot button';
    const toastBox = page => page.evaluate(() => {
      const els = [...document.querySelectorAll('#toasts .toast')]; const el = els[els.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect(), vw = window.innerWidth;
      return { text: el.textContent.replace(/\s+/g, ' ').trim(), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), vw, inView: r.left >= -0.5 && r.right <= vw + 0.5 && r.width > 0,
        clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 };
    });
    const MOBILE19 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      await attempt(`CH19-${tag}`, async () => {
        const s = await newSession({ passportClosed: true, app: true }, {}, { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        s.board = BOARD_V2;
        await goBounty(s); await loggedIn(s.page); await chipsLoaded(s.page); await sleep(300);
        await s.page.tap('#tabRide');                                                      // 手機底部分頁列的「護照」
        await s.page.waitForFunction(() => { const p = document.getElementById('ridePanel'); return p && !p.hidden && p.querySelector('[data-act="bountyboard"]'); }, null, { timeout: 15000 });
        await s.page.evaluate(() => document.querySelector('#ridePanel [data-act="bountyboard"]').scrollIntoView({ block: 'center' }));
        await sleep(300);
        await s.page.tap('#ridePanel [data-act="bountyboard"]');                           // 手機上實際點得到的「懸賞板」入口
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 });
        await sleep(400);
        const bd = await readBoard(s.page);
        const bm = await s.page.evaluate(MEASURE, { itemSel: BOARD_ITEMS, scrollSels: ['#bountyModal .tk-box', '#bountyList'], reachSel: '#bountyList .bt-take, #bountyModal .tk-x' });
        // 籌碼標記要在自己那張卡的範圍內（沒裁過的矩形）：被拉出卡片的標記（fixed／absolute／位移）會蓋到別的東西
        const inCard = await s.page.evaluate(() => [...document.querySelectorAll('#bountyList .bt-card')].flatMap(card => {
          const c = card.getBoundingClientRect();
          return [...card.querySelectorAll('.bt-pt')].map(tg => { const r = tg.getBoundingClientRect();
            return { card: card.dataset.card, ok: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 }; });
        }));
        const eR = expectOf(RULES, KEY_NAN);
        const tagsOf = id => (bd.cards.find(c => c.id === id) || { tags: null }).tags;
        ok(`CH19a-${tag} 看板 3 張卡、偏遠線的兩張（一般卡、收滿卡）各有一個「籌碼 ×${eR.mult}」、另一張沒有標記`,
          bd.cards.length === 3 && JSON.stringify(tagsOf(CARD_R.id)) === JSON.stringify([`籌碼 ×${eR.mult}`]) && JSON.stringify(tagsOf(CARD_RC.id)) === JSON.stringify([`籌碼 ×${eR.mult}`]) && JSON.stringify(tagsOf(CARD_P.id)) === '[]', JSON.stringify(bd.cards.map(c => [c.id, c.tags])));
        ok(`CH19b-${tag} 看板兩兩相交掃描：掃了 ${bm.n} 個可見元素、沒有任何兩個互相蓋住（標題、×、副標、每張卡的名稱／說明／籌碼標記／接單鈕／已收滿說明）；兩個籌碼標記都在自己那張卡的範圍內`,
          bm.n >= 12 && bm.pairs.length === 0 && inCard.length === 2 && inCard.every(x => x.ok), JSON.stringify({ pairs: bm.pairs, inCard }));
        ok(`CH19c-${tag} 看板沒有水平捲動（頁面、懸賞板框、卡片列表都不超寬）、沒有元素超出視窗左右邊`,
          bm.hscroll.doc <= 1 && bm.hscroll['#bountyModal .tk-box'] <= 1 && bm.hscroll['#bountyList'] <= 1 && bm.out.length === 0, JSON.stringify({ h: bm.hscroll, out: bm.out, vw: bm.vw }));
        ok(`CH19d-${tag} 每顆接單鈕與關閉鈕的中心點 elementFromPoint 回到它自己（${bm.reach.length} 顆）`, bm.reach.length >= 3 && bm.reach.every(x => x.ok), JSON.stringify(bm.reach.filter(x => !x.ok)));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-board-${tag}.png`) });
        // 真觸控點「接下」
        await s.page.tap(takeSel(CARD_R.id));
        await briefOpen(s.page);
        await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
        await sleep(450);
        const t1 = await toastBox(s.page);
        const brief = await readBrief(s.page);
        const mm = await s.page.evaluate(MEASURE, { itemSel: BRIEF_ITEMS, scrollSels: ['#bountyBriefModal .tk-box', '#bountyBriefBody'], reachSel: '#bountyBriefGo, #bountyBriefLater, #bountyBriefX' });
        const w = REWARD['zh-TW'](eR);
        ok(`CH19e-${tag} 真觸控點「接下」：伺服器收到 1 發認領、說明卡開了、獎勵句（每趟、×${eR.mult}、每天上限）都在`,
          s.claims.length === 1 && brief.text.includes(w.per) && brief.text.includes(w.mult) && brief.text.includes(w.cap), JSON.stringify({ claims: s.claims.length, text: brief.text.slice(0, 160) }));
        ok(`CH19f-${tag} 說明卡兩兩相交掃描：掃了 ${mm.n} 個可見元素、沒有任何兩個互相蓋住；沒有水平捲動、沒有元素超出視窗左右邊`,
          mm.n >= 8 && mm.pairs.length === 0 && mm.hscroll.doc <= 1 && mm.hscroll['#bountyBriefModal .tk-box'] <= 1 && mm.hscroll['#bountyBriefBody'] <= 1 && mm.out.length === 0, JSON.stringify({ pairs: mm.pairs, h: mm.hscroll, out: mm.out }));
        ok(`CH19g-${tag} 說明卡的「開始錄製」「等一下再說」「×」中心點 elementFromPoint 回到它自己`, mm.reach.length === 3 && mm.reach.every(x => x.ok), JSON.stringify(mm.reach));
        ok(`CH19h-${tag} 接下時的提示是「接下了・24 小時內有效」、整張卡在視窗內（左 ${t1 && t1.l}、右 ${t1 && t1.r}、視窗寬 ${width}）、字沒有被截掉`,
          !!t1 && t1.text === '接下了・24 小時內有效' && t1.inView && !t1.clipped, JSON.stringify(t1));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-brief-${tag}.png`) });
        // 存不下認領（最長的那句提示）：關掉說明卡、讓這台裝置寫不進去、真觸控點第二張卡的「接下」
        await s.page.tap('#bountyBriefLater');
        await s.page.evaluate(() => { window.__bountyKeyBlocked = true; document.getElementById('toasts').innerHTML = ''; });
        await s.page.tap(takeSel(CARD_P.id));
        await briefOpen(s.page);
        await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
        await sleep(450);
        const t2 = await toastBox(s.page);
        ok(`CH19i-${tag} 存不下認領時最長的那句提示：照實說、整張卡在視窗內（左 ${t2 && t2.l}、右 ${t2 && t2.r}）、字沒有被截掉`,
          !!t2 && t2.text.startsWith('已在伺服器接下，但這台裝置存不下來') && t2.inView && !t2.clipped, JSON.stringify(t2));
        // 現行 App 殼按「開始錄製」（說明卡還開在看板上面）：真觸控點下去。手機上看板整片蓋住吐司，要看實際最上層是誰
        await s.page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
        await s.page.tap('#bountyBriefGo');
        await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
        await sleep(450);
        const t3 = await topIsToast(s.page);
        ok(`CH19k-${tag} 現行 App 殼按「開始錄製」：沒有進入錄製、看板與說明卡都收起來、「請更新到最新版」那句在最上層（左／中／右三個點的 elementFromPoint 都是這張提示）、整張卡在視窗內、字沒有被截掉`,
          !!t3.toast && t3.toast.text === '要錄程，請先把軌島 App 更新到最新版' && t3.toast.onTop && t3.toast.inView && !t3.toast.clipped && !t3.boardOpen && !t3.briefOpen && !t3.recording, JSON.stringify(t3));
        ok(`CH19j-${tag} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
        await s.ctx.close();
      });
      // 網頁（旗標開、不是 App 殼）：同一個寬度，從底部分頁列的「護照」進看板，真觸控點卡上的「接下」。
      // 網頁沒有認領這條路，只吐一句話；手機上看板整片蓋住吐司，沒收起來的話那句話看不到。
      await attempt(`CH19w-${tag}`, async () => {
        const s = await newSession({ passportClosed: true }, {}, { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        s.board = BOARD_V2;
        await goBounty(s); await loggedIn(s.page); await sleep(300);
        await s.page.tap('#tabRide');
        await s.page.waitForFunction(() => { const p = document.getElementById('ridePanel'); return p && !p.hidden && p.querySelector('[data-act="bountyboard"]'); }, null, { timeout: 15000 });
        await s.page.evaluate(() => document.querySelector('#ridePanel [data-act="bountyboard"]').scrollIntoView({ block: 'center' }));
        await sleep(300);
        await s.page.tap('#ridePanel [data-act="bountyboard"]');
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 });
        await sleep(400);
        const opened = await s.page.evaluate(() => ({ board: !document.getElementById('bountyModal').hidden, native: IS_NATIVE_APP, demo: DEMO_AS_APP, flag: BOUNTY_ENABLED }));
        await s.page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
        await s.page.tap(takeSel(CARD_R.id));
        await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
        await sleep(450);
        const t4 = await topIsToast(s.page);
        ok(`CH19l-${tag} 網頁（旗標開）看板開著時真觸控點「接下」：看板收起來、「GPS 校正旅程需要用 App」那句在最上層（左／中／右三個點的 elementFromPoint 都是這張提示）、整張卡在視窗內、字沒有被截掉；沒有送認領、沒有進入錄製、頁面沒有未捕捉的例外（點之前看板確實開著）`,
          opened.board === true && opened.native === false && opened.demo === false && opened.flag === true &&
            !!t4.toast && t4.toast.text === 'GPS 校正旅程需要用 App。網頁可以看懸賞板與自己的成果' && t4.toast.onTop && t4.toast.inView && !t4.toast.clipped &&
            !t4.boardOpen && !t4.briefOpen && !t4.recording && s.claims.length === 0 && s.errors.length === 0,
          JSON.stringify({ opened, t4, claims: s.claims.length, errors: s.errors }));
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE19('chromium', browser, w);
    await attempt('CH19-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE19('webkit', wk, w);
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

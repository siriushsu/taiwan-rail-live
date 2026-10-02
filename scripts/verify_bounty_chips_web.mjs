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
//   CH10 錄程入口：懸賞開著時不啟動定位取樣；網頁顯示「要用 App」、現行 App 殼顯示請先更新軌島 App 的那一句（兩個平台訊號各自成立、英日文、旗標關與 ?demo=bounty 的對照；看板開著時提示要在最上層，網頁點「接下」的那句也是）
//   CH11 手機版：360／375／414／768 × Chromium／WebKit，真觸控點開護照（底部分頁列的「護照」）
//   CH12 快取與 actor 的邊界（401 清、503 留、存不下、第一次沿用裝置 id、英文介面沒有漏翻）
//   CH13 開機時序：登入結果比開機那一發 bounty-me 晚出來；401 晚到、200 晚到兩種先後，最後護照都要有登入者的段數
//   CH14 冷開機時 session 已經不見（磁碟上還記著已併的帳號）：已併的 actor 換新、裝置 id 不變、籌碼快取清掉
//   CH15 看板卡片：偏遠線的卡標「籌碼 ×N」、其他線沒有標記；名單與 N 讀規則檔（換一份規則檔，兩個方向都跟著翻）
//   CH16 旗標開時，看板／說明卡／錄程列／接下時的提示都沒有拿「點」當獎勵單位；承諾句不再提點數；英日文介面同樣乾淨
//   CH17 說明卡的獎勵句：每趟幾顆、偏遠線倍率、每天上限，與伺服器入帳用的純函式算出來的一致（真規則檔與另一份規則檔）
//   CH18 旗標關：看不到任何一句獎勵說法（新舊都沒有）、不讀規則檔、不打認領請求；對照：旗標開同一頁看得到
//   CH19 手機版：360／375／414／768 × Chromium／WebKit，看板（有 ×N 標記）、說明卡、提示；兩兩相交掃描、沒有水平捲動、App 殼真觸控點「接下」只提示更新（說明卡改由認領入口直接開出來量）、App 殼按「開始錄製」的更新提示在最上層、網頁點「接下」的提示在最上層
//   CH20 ?demo=bounty 的示範看板：有一張偏遠線的卡、「籌碼 ×N」標記看得到（中英日、手機不用捲）；名單與倍率讀規則檔、換一份規則檔跟著翻；規則檔讀不到時維持原本 5 張卡；規則檔還沒回來就開板，板子先顯示載入中、規則檔一到第一次畫出來的卡就有標記；其他卡不變
//   CH21 旗標開時的懸賞文案（看板、說明卡、護照校正貢獻、說明中心三節、接下的提示）第一人稱用單數，沒有「我們／We／私たち」；規則檔 qualityText 的中文也沒有，而且每一句在英日字典都有同一句當鍵、譯文也沒有複數；掃描規則自己咬得住
//   CH22 規則檔一直不回來時：示範看板、真看板、護照籌碼都在「上限＋餘裕」之內畫出來（看板沒有標記、護照沒有「下一座」）；規則檔在上限之內到了，第一次畫就帶標記；之後才到，看板補上標記、不丟錯、不重複，關掉的看板不被畫、重開的看板不被舊的補畫蓋住
//   CH24 現行 App 殼在看板上就請人更新：副標說這一版還不能接、卡上按鈕字是「要更新 App 才能接」（已接下的卡也一樣）、按下去收起看板＋吐司是開始錄製同一句、不送認領、不寫本機認領紀錄、不開說明卡；網頁、?demo=bounty（含 App 殼裡）、旗標關的副標、按鈕字、點擊結果一個字不變；手機 360／375／414／768 × Chromium／WebKit 真觸控
//   CH23 說明卡講清楚「合格」是什麼：「先講清楚」那一節緊接在「錄到一半中斷沒關係」後面有兩句（合格的一趟要同時做到什麼、沒達到會怎樣）；門檻數字讀規則檔，換一份規則檔跟著變，進位只往上（換算回去不低於伺服器的門檻、多出的不到一個進位單位，達到畫面門檻的那一趟伺服器給籌碼）；規則檔讀不到或門檻不能用時整段不寫；中英日、?demo=bounty 的停站卡也有
//   CH25 停站卡的說明卡講清楚怎麼錄才會達到籌碼門檻：請人從前一站或更早就開始錄、一直錄到離開要錄的站；整趟要錄滿門檻才有籌碼，兩個數字與同一張卡上「合格」那句同一份；規則檔缺或門檻不是正數就只講怎麼錄、不寫數字；英日文；手機四寬度兩引擎
//   CH26 護照的校正貢獻：只錄過停站卡的人也有校正者章（bounty-me 回應新增 dwellStops）；只有停站時寫「校正停站 N 站」、原因說明照給；有路段的人畫面完全不變；舊版回應沒有欄位時與以前一樣；亂值；英日文；手機四寬度兩引擎
//   CH27 現行 App 殼剩下三處還在教人錄程：說明中心「懸賞板」「錄一趟校正旅程」兩節、護照校正貢獻的空狀態、開機接回錄製，都讀看板同一個判定；網頁、?demo=bounty、旗標關完全不變；手機四寬度兩引擎
//   CH28 現行 App 殼看板上已收滿的卡也請人更新：那一句改成收滿了、這一版錄不了程、要更新到最新版；網頁、?demo=bounty（含在 App 殼裡）、旗標關仍是原句；中英日；手機四寬度兩引擎，那一句不被截、不溢出、不與別的元素重疊、沒有水平捲動
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
import vm from 'node:vm';
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
      if (u.pathname === '/api/bounty-board') { s.boardReq++; if (s.gates.board) await s.gates.board.promise; return json(route, 200, s.board); }   // hold('board')：看板資料的回應也能由測試扣住
      if (u.pathname === '/api/bounty-claim') {
        let body = null; try { body = JSON.parse(rq.postData()); } catch (e) {}
        s.claims.push({ seq: ++s.seq, body, auth });
        return json(route, 200, { ok: true, claimId: 'cl-' + s.claims.length, units: 1, pointsLocked: CLAIM_POINTS, expiresAt: Date.now() + 86400000 });
      }
      if (u.pathname === '/data/bounty_rules.json') {
        s.rulesReq++;
        if (s.gates.rules) await s.gates.rules.promise;                                      // 測試扣住規則檔的回應（hold('rules')），放開之前一律不回
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
      const desc = e => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}` : 'null';
      toast = { text: el.textContent.replace(/\s+/g, ' ').trim(), by: pts.map(([x, y]) => desc(document.elementFromPoint(x, y))), onTop: pts.every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.toast')); }),
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

    // 回應標頭已經到了、本文還在傳的那一拍：fetchBountyMe 讀完本文之後還有第二道守門（讀本文前的那一道已經通過）。
    // 只用 page.route 延後整個回應，第一道就先擋下了，碰不到第二道；所以包住 Response.prototype.json，
    // 在 bounty-me 的本文被讀取的當下扣住，等登出完成才放行。
    const JSONHOLD = () => {
      const orig = Response.prototype.json;
      window.__jsonHold = { on: false, held: 0, release: null };
      Response.prototype.json = function () {
        const h = window.__jsonHold;
        if (h.on && /\/api\/bounty-me(\?|$)/.test(this.url)) {
          h.on = false; h.held++;
          return new Promise(res => { h.release = () => res(orig.call(this)); });
        }
        return orig.call(this);
      };
    };
    for (const [tag, logout] of [['control', false], ['signOut', true]]) await attempt(`CH6-body-${tag}`, async () => {
      const s = await newSession({}, {});
      await s.ctx.addInitScript(JSONHOLD);
      await goBounty(s);
      await loggedIn(s.page);
      await chipsLoaded(s.page);
      await until(async () => (await flagOf(s.page, UID_A)) !== null);
      await until(() => s.page.evaluate(() => bountyMeMem !== null));
      await sleep(600);
      await s.page.evaluate(() => { window.__jsonHold.on = true; window.__inflight = fetchBountyMe(); });
      await until(() => s.page.evaluate(() => window.__jsonHold.held >= 1));              // 標頭到了、第一道守門過了、本文被扣住
      const held = await s.page.evaluate(() => window.__jsonHold.held);
      const ent = s.bme[s.bme.length - 1];
      if (logout) {
        await s.page.evaluate(() => accountSignOut());
        await s.page.waitForFunction(() => state.account.user === null, null, { timeout: 15000 });
        await sleep(800);                                                                 // 讓兩次身分收尾都跑完
      }
      const mid = await s.page.evaluate(() => ({ memNull: bountyMeMem === null, held: window.__jsonHold.held }));
      await s.page.evaluate(() => window.__jsonHold.release());                           // 本文現在才到（上一位的 12 段）
      const ret = await s.page.evaluate(async () => { const r = await window.__inflight; renderPassport(); return r; });
      const c = await corrInfo(s.page);
      const memSegs = await s.page.evaluate(() => bountyMeMem && bountyMeMem.corrected && bountyMeMem.corrected.segs);
      if (!logout) {
        ok('CH6j-control [fixture] 同一個流程不登出：標頭到了、本文被扣住（json() 被攔到 1 次、這一發 bounty-me 回 200）；放行之後記憶體寫進這一份（12 段）、護照顯示 12 段——扣住與放行的機制本身是通的',
          held === 1 && ent && ent.status === 200 && memSegs === 12 && c.segs === '12' && s.errors.length === 0, JSON.stringify({ held, status: ent && ent.status, memSegs, c }));
      } else {
        ok('CH6j [fixture] 登出時那一發 bounty-me 的標頭已經到了（json() 被攔到 1 次，代表讀本文前的第一道守門已通過）、本文還在途；登出完成後記憶體已是 null',
          held === 1 && ent && ent.status === 200 && mid.memNull === true, JSON.stringify({ held, mid, status: ent && ent.status }));
        ok('CH6k 本文在登出之後才到（上一位的 12 段）：記憶體仍是 null、函式回 null、護照的校正貢獻節是空狀態、找不到上一位的 12 段；頁面沒有未捕捉的例外',
          ret === null && memSegs === null && c.empty === true && c.segs === null && !/12/.test(c.text || '') && s.errors.length === 0, JSON.stringify({ ret, memSegs, c, errors: s.errors }));
      }
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
  // 懸賞開著時，網頁與現行 App 殼（網頁包成的那一版）都不啟動定位取樣；提示依平台分兩句：網頁「要用 App」、App 殼是要先更新軌島 App 的那一句。
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
      ok('CH10b 現行 App 殼、旗標開：按開始錄程 → 定位取樣沒有被啟動（bountyStartSampling 0 次）、沒有進入錄製、提示整句是要先更新軌島 App 的那一句（不是網頁那一句）',
        on.sampling === 0 && on.recording === false && on.toast === APP_PROMPT[L] && on.toast !== WEB_PROMPT[L], JSON.stringify(on));
      const cap = await probe('&bounty=1', { capacitor: true });
      ok('CH10c [fixture] 現行 App 殼（只有「Capacitor.isNativePlatform() 回 true」那個平台訊號，沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE）＋懸賞旗標開，頁面沒有未捕捉的例外',
        cap.flag === true && cap.native === true && cap.demo === false && cap.keySignal === false && cap.capSignal === true && cap.errors === 0, JSON.stringify(cap));
      ok('CH10d 另一個平台訊號單獨成立也算 App 殼：沒有啟動取樣、沒有進入錄製、提示整句是要先更新軌島 App 的那一句',
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
        ok(`CH10j-${lang} ${name}介面、現行 App 殼、旗標開：沒有啟動取樣、沒有進入錄製，提示整句是${name}的要先更新軌島 App 那一句`,
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
  // 現行 App 殼的看板上按「接下」只提示更新、不認領、不開說明卡（見 CH24），畫面上走不到說明卡。要驗說明卡與認領之後的畫面，
  // 改成直接呼叫認領的唯一入口 bountyClaim（按鈕的點擊處理本來就只是呼叫它）：請求、本機紀錄、說明卡、提示都照走。
  const claimDirect = (page, id) => page.evaluate(i => { bountyClaim(i); }, id);
  // 說明卡獎勵句的字面（字典的譯文）；數字與單複數由期望值決定
  const REWARD = {
    'zh-TW': e => ({ per: `合格的一趟得 ${e.perTrip} 顆籌碼。`, mult: `這條線的籌碼 ×${e.mult}。`, cap: `每天最多 ${e.cap} 顆。` }),
    en: e => ({ per: `A qualifying trip earns ${e.perTrip} chip${e.perTrip === 1 ? '' : 's'}.`, mult: `Chips are ×${e.mult} on this line.`, cap: `Up to ${e.cap} chip${e.cap === 1 ? '' : 's'} a day.` }),
    ja: e => ({ per: `条件を満たした1回の乗車でチップを ${e.perTrip} 枚もらえます。`, mult: `この路線ではチップが ${e.mult} 倍になります。`, cap: `1日に獲得できるのは最大 ${e.cap} 枚です。` }),
  };

  // ═══ CH15：看板卡片的籌碼標記——偏遠線的卡標「籌碼 ×N」、其他線沒有；名單與 N 讀規則檔 ═══════════════════════════════════
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
        again: '這段你已經接下了，還沒過期', expiry: '接下的卡 24 小時內有效。', promise: '即使這次的資料不能用，只要錄得夠完整，校正者章還是你的。',
        passport: '還不能錄程，要更新到最新版才行', tip: '校正者章還是你的', rowTrack: '0 段已覆蓋', rowDwell: '0 站已覆蓋',
        subShell: '這些項目還沒有實測資料。這一版還不能接，要更新到最新版的軌島 App 才能接下來錄——現在可以先看看有哪些。' },
      en: { re: POINTS_RE_I18N, sub: [/chips/, /daily limit/], subNo: /honou?r/i, subDemo: [/Demo data/, /fake/], tag: 'Chips ×2',
        claimed: 'Claimed · valid for 24 hours', demoClaimed: '(Demo) Claimed · valid for 24 hours',
        saveFail: 'Claimed on the server, but this device couldn’t save it (storage may be full, or you’re in private browsing) — the claim won’t persist after you refresh',
        again: 'You’ve already claimed this segment, and it hasn’t expired yet', expiry: 'A claimed card is valid for 24 hours.', promise: 'Even if this data can’t be used, the calibrator stamp is still yours as long as you recorded enough of it.',
        passport: 'update to the latest version to record', tip: 'you keep the calibrator stamp', rowTrack: 'Segments covered: 0', rowDwell: 'Stations covered: 0',
        subShell: 'These items don’t have real measurement data yet. This version can’t claim them — update the Rail Island app to the latest version to claim and record. For now, you can browse what’s available.' },
      ja: { re: POINTS_RE_I18N, sub: [/チップ/, /上限/], subNo: /名誉/, subDemo: [/デモデータ/, /仮/], tag: 'チップ ×2',
        claimed: '受け取りました・24時間有効', demoClaimed: '（デモ）受け取りました・24時間有効',
        saveFail: 'サーバー側では受領済みですが、この端末には保存できませんでした（ストレージ不足またはプライベートブラウジングの可能性）。更新すると受領記録は残りません',
        again: 'この区間はすでに受け取り済みで、まだ有効期限内です', expiry: '受け取ったカードは24時間有効です。', promise: '今回のデータが使えなくても、十分に記録できていれば、校正者スタンプはあなたのものです。',
        passport: '最新版に更新してください', tip: '校正者スタンプはあなたのものです', rowTrack: '0区間を記録済み', rowDwell: '0駅を記録済み',
        subShell: 'これらの項目にはまだ実測データがありません。このバージョンでは受け取れません。軌島アプリを最新版に更新すると、受け取って記録できます。今は内容を確認できます。' },
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
        ok(`CH16b-${lang} 現行 App 殼的看板副標是請更新那句、沒有寫成「只有榮譽」（講籌碼與每天上限的那句副標由 CH16o 的示範看板驗）；副標與每張卡的字都沒有拿點當獎勵單位（沒有點數字樣、沒有卡片資料裡的 7357／7541）`,
          b.sub === X.subShell && !X.subNo.test(b.sub) && [b.sub, ...b.cards.map(c => c.text)].every(x => noPts(x, X.re)), JSON.stringify(b));
        await claimDirect(s.page, CARD_R.id);
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
        await claimDirect(s.page, CARD_P.id);
        await briefOpen(s.page);
        await until(() => s.claims.length >= 2);
        const br2 = await readBrief(s.page);
        const saved = JSON.parse((await lsGet(s.page, 'trainmap-bounty-v1')) || '{}');
        ok(`CH16h-${lang} [fixture] 第二張卡接下時這台裝置存不下（磁碟上只有第一張的認領）、伺服器收到第 2 發認領`,
          s.claims.length === 2 && !!saved.claims && !!saved.claims[CARD_R.id] && !saved.claims[CARD_P.id], JSON.stringify({ claims: s.claims.length, saved: Object.keys(saved.claims || {}) }));
        ok(`CH16i-${lang} 存不下時的提示照實說「伺服器接下了、這裡沒存成」、沒有點數、沒有 7939；說明卡照樣開了`,
          br2.toasts.length === 1 && br2.toasts[0] === X.saveFail && noPts(br2.toasts[0], X.re) && br2.text.length > 40, JSON.stringify(br2.toasts));
        const pp = await s.page.evaluate(() => { const e = document.querySelector('#passport .ph-correct .ph-empty'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
        ok(`CH16j-${lang} 護照「校正貢獻」空狀態（現行 App 殼：請更新那句，不許諾錄就有章）沒有提點數（「${X.passport}」在、沒有點數字樣）`, pp !== null && pp.includes(X.passport) && noPts(pp, X.re), String(pp));
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
      await claimDirect(s.page, card.id);
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
      await claimDirect(s.page, CARD_R.id);
      await briefOpen(s.page);
      const br = await readBrief(s.page);
      ok('CH17d 規則檔讀不到：說明卡照樣開、沒有任何獎勵句（寧可不寫，也不憑記憶補數字，或寫伺服器不一定會給的東西）；期限那句與承諾那句照在',
        !/顆籌碼|每天最多|×|這條線的籌碼/.test(br.text) && br.text.includes('接下的卡 24 小時內有效。') && br.text.includes('即使這次的資料不能用，只要錄得夠完整，校正者章還是你的。'), br.text);
      ok('CH17e 規則檔讀不到：頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    for (const lang of ['en', 'ja']) await attempt(`CH17-${lang}`, async () => {
      for (const [tag, served, rules, card, key] of [CASES[0], CASES[3]]) {
        const s = await boardSession({}, { rules: served, lang });
        await claimDirect(s.page, card.id);
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
      await claimDirect(s.page, CARD_R.id);
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
        // 現行 App 殼真觸控點「接下」：只提示更新、看板收起（整套判準在 CH24）。說明卡這一版走不到，重開看板後直接叫認領入口開出來量版面
        await s.page.tap(takeSel(CARD_R.id));
        await s.page.waitForFunction(() => document.getElementById('bountyModal').hidden, null, { timeout: 5000 });
        await s.page.evaluate(() => { openBountyBoard(); });
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 });
        await s.page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
        await claimDirect(s.page, CARD_R.id);
        await briefOpen(s.page);
        await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
        await sleep(450);
        const t1 = await toastBox(s.page);
        const brief = await readBrief(s.page);
        const mm = await s.page.evaluate(MEASURE, { itemSel: BRIEF_ITEMS, scrollSels: ['#bountyBriefModal .tk-box', '#bountyBriefBody'], reachSel: '#bountyBriefGo, #bountyBriefLater, #bountyBriefX' });
        const w = REWARD['zh-TW'](eR);
        ok(`CH19e-${tag} 認領入口開出說明卡：伺服器收到 1 發認領（先前真觸控點「接下」那一下只提示更新、沒有送）、說明卡開了、獎勵句（每趟、×${eR.mult}、每天上限）都在`,
          s.claims.length === 1 && brief.text.includes(w.per) && brief.text.includes(w.mult) && brief.text.includes(w.cap), JSON.stringify({ claims: s.claims.length, text: brief.text.slice(0, 160) }));
        ok(`CH19f-${tag} 說明卡兩兩相交掃描：掃了 ${mm.n} 個可見元素、沒有任何兩個互相蓋住；沒有水平捲動、沒有元素超出視窗左右邊`,
          mm.n >= 8 && mm.pairs.length === 0 && mm.hscroll.doc <= 1 && mm.hscroll['#bountyBriefModal .tk-box'] <= 1 && mm.hscroll['#bountyBriefBody'] <= 1 && mm.out.length === 0, JSON.stringify({ pairs: mm.pairs, h: mm.hscroll, out: mm.out }));
        ok(`CH19g-${tag} 說明卡的「開始錄製」「等一下再說」「×」中心點 elementFromPoint 回到它自己`, mm.reach.length === 3 && mm.reach.every(x => x.ok), JSON.stringify(mm.reach));
        ok(`CH19h-${tag} 接下時的提示是「接下了・24 小時內有效」、整張卡在視窗內（左 ${t1 && t1.l}、右 ${t1 && t1.r}、視窗寬 ${width}）、字沒有被截掉`,
          !!t1 && t1.text === '接下了・24 小時內有效' && t1.inView && !t1.clipped, JSON.stringify(t1));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-brief-${tag}.png`) });
        // 存不下認領（最長的那句提示）：關掉說明卡、讓這台裝置寫不進去、叫認領入口認領第二張卡
        await s.page.tap('#bountyBriefLater');
        await s.page.evaluate(() => { window.__bountyKeyBlocked = true; document.getElementById('toasts').innerHTML = ''; });
        await claimDirect(s.page, CARD_P.id);
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
        ok(`CH19k-${tag} 現行 App 殼按「開始錄製」：沒有進入錄製、看板與說明卡都收起來、要先更新軌島 App 的那句在最上層（左／中／右三個點的 elementFromPoint 都是這張提示）、整張卡在視窗內、字沒有被截掉`,
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

  // ═══ CH20：?demo=bounty 的示範看板——有一張偏遠線的卡，「籌碼 ×N」標記看得到 ═══════════════════════════════════════════
  // 備援站沒有 /api/*，示範看板由頁面自己合成。偏遠線名單與倍率讀規則檔；挑卡與畫標記都走真看板那一套（bountyRemoteMult／renderBountyBoard），
  // 假資料裡沒有另外寫標記。規則檔讀不到時，板子維持原本的 5 張卡、沒有標記；其他卡（內容、順序）不因為多了這一張而變。
  if (want('CH20')) {
    const TAG20 = { 'zh-TW': n => `籌碼 ×${n}`, en: n => `Chips ×${n}`, ja: n => `チップ ×${n}` };
    const lineKeyOf = id => id.split('|').slice(0, 2).join('|');            // 示範卡的 id 是「系統|線名|…」，前兩段就是規則檔名單裡的寫法
    const demoSession = async (lang, rules, ctxOpts = {}) => {
      const locale = lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
      const s = await newSession({ app: false }, {}, { ctx: { locale, ...ctxOpts } });
      s.rules = rules;                                                       // null＝送真的規則檔；物件＝改送這一份；'404'＝讀不到
      await s.page.goto(`${BASE}/?lang=${lang}&demo=bounty`);
      await bootDone(s.page);
      return s;
    };
    const openDemoBoard = async (s, viaPassport) => {
      if (viaPassport) await s.page.click('#passport [data-act="bountyboard"]'); else await s.page.evaluate(() => openBountyBoard());
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
      await sleep(300);
    };
    const readDemo = page => page.evaluate(() => ({
      cards: [...document.querySelectorAll('#bountyList .bt-card')].map(c => ({ id: c.dataset.card, text: c.textContent.replace(/\s+/g, ' ').trim(),
        tags: [...c.querySelectorAll('.bt-pt')].map(x => ({ text: x.textContent.replace(/\s+/g, ' ').trim(), html: x.outerHTML })) })) }));
    const remoteOf = (rules, id) => rules.chips.remoteLines.includes(lineKeyOf(id));
    let fallback = null;                                                     // 規則檔讀不到時的板子（原本的那 5 張），給 CH20c 當對照

    await attempt('CH20b', async () => {
      const s = await demoSession('zh-TW', '404');
      await openDemoBoard(s, true);
      fallback = await readDemo(s.page);
      const kinds = await s.page.evaluate(() => bountyBoardMem.cards.map(c => c.kind));
      ok('CH20b 規則檔讀不到（404）：示範看板照樣出得來、維持原本的 5 張卡（4 張路段卡＋1 張停站卡）、沒有任何標記、頁面沒有未捕捉的例外（規則檔真的被問過）',
        s.rulesReq >= 1 && fallback.cards.length === 5 && kinds.filter(k => k === 'track').length === 4 && kinds.filter(k => k === 'dwell').length === 1 &&
          fallback.cards.every(c => c.tags.length === 0) && s.errors.length === 0, JSON.stringify({ rulesReq: s.rulesReq, kinds, tags: fallback.cards.map(c => c.tags.length), errors: s.errors }));
      await s.ctx.close();
    });

    for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH20a-${lang}`, async () => {
      const s = await demoSession(lang, null);
      await openDemoBoard(s, true);
      const d = await readDemo(s.page);
      const want20 = TAG20[lang](RULES.chips.remoteMultiplier);
      const remote = d.cards.filter(c => remoteOf(RULES, c.id)), others = d.cards.filter(c => !remoteOf(RULES, c.id));
      ok(`CH20a-${lang} 示範看板有偏遠線的卡（名單讀規則檔：${RULES.chips.remoteLines.join('、')}）、每張都標「${want20}」（倍率讀規則檔）、標記的寫法跟真看板一模一樣；其他卡沒有標記；頁面沒有未捕捉的例外`,
        remote.length >= 1 && remote.every(c => c.tags.length === 1 && c.tags[0].text === want20 && c.tags[0].html === `<div class="bt-pt bt-chip">${want20}</div>`) &&
          others.length >= 5 && others.every(c => c.tags.length === 0) && s.errors.length === 0,
        JSON.stringify({ remote: remote.map(c => [c.id, c.tags]), others: others.length, errors: s.errors }));
      if (lang === 'zh-TW') {
        // 其他卡沒有因為多了這一張而變：把偏遠線那張拿掉，剩下的內容與順序就是規則檔讀不到時的那 5 張
        ok('CH20c 多出來的只有偏遠線那一張：拿掉它之後，其餘的卡（編號與卡面的字、順序）與規則檔讀不到時的 5 張完全相同',
          !!fallback && remote.length === 1 && JSON.stringify(others.map(c => [c.id, c.text])) === JSON.stringify(fallback.cards.map(c => [c.id, c.text])),
          JSON.stringify({ remote: remote.map(c => c.id), others: others.map(c => c.id), fallback: fallback && fallback.cards.map(c => c.id) }));
      }
      await s.ctx.close();
    });

    await attempt('CH20d', async () => {
      const s = await demoSession('zh-TW', RULES_ALT);                      // 另一份規則檔：偏遠線改成屏東線、倍率 5
      await openDemoBoard(s, true);
      const d = await readDemo(s.page);
      const tagged = d.cards.filter(c => c.tags.length > 0);
      const want20 = TAG20['zh-TW'](RULES_ALT.chips.remoteMultiplier);
      ok(`CH20d 名單與倍率跟著規則檔走（不是寫死）：換一份規則檔，標記的卡換成屏東線、標「${want20}」，南迴線的卡不再有標記`,
        tagged.length === 1 && lineKeyOf(tagged[0].id) === KEY_PT && tagged[0].tags[0].text === want20 &&
          d.cards.every(c => remoteOf(RULES_ALT, c.id) === (c.tags.length > 0)) && !d.cards.some(c => lineKeyOf(c.id) === KEY_NAN && c.tags.length > 0) && s.errors.length === 0,
        JSON.stringify({ tagged: tagged.map(c => [c.id, c.tags.map(x => x.text)]), errors: s.errors }));
      await s.ctx.close();
    });

    // 手機：開板之後不用捲，標記就在視窗裡、點得到（量的是「中心點最上面是誰」，被別的東西蓋住或被捲動容器裁掉都會是別人）
    for (const [w, h] of [[360, 640], [390, 844]]) await attempt(`CH20e-${w}`, async () => {
      const s = await demoSession('zh-TW', null, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await openDemoBoard(s, false);
      await sleep(400);
      const r = await s.page.evaluate(() => {
        const tag = document.querySelector('#bountyList .bt-chip');
        if (!tag) return { found: false };
        const q = tag.getBoundingClientRect(), hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return { found: true, text: tag.textContent.trim(), inView: q.left >= 0 && q.right <= innerWidth && q.top >= 0 && q.bottom <= innerHeight, hitTag: !!(hit && hit.closest('.bt-chip')),
          scrolled: document.getElementById('bountyList').scrollTop };
      });
      ok(`CH20e-${w} 手機 ${w}×${h}：開板後不捲動，「${TAG20['zh-TW'](RULES.chips.remoteMultiplier)}」標記就在視窗內、中心點最上面就是它`,
        r.found && r.text === TAG20['zh-TW'](RULES.chips.remoteMultiplier) && r.inView && r.hitTag && r.scrolled === 0 && s.errors.length === 0, JSON.stringify({ r, errors: s.errors }));
      await s.ctx.close();
    });

    // 規則檔還沒回來就開板：示範板的偏遠線那張要等規則檔讀到才挑得出來（見 openBountyBoard 對示範模式的那一行等待），
    // 所以板子先停在「載入中…」、一張卡都沒有；規則檔一到，第一次畫出來的卡就有那張與標記，不是先畫一版沒標記的。
    // 規則檔的回應由測試扣住再放開（不靠睡眠秒數決定誰先誰後）；開機前就扣住，所以開機時的那幾次讀取也一起等著。
    await attempt('CH20f', async () => {
      const s = await newSession({ app: false }, {}, { ctx: { locale: 'zh-TW' } });
      const gate = s.hold('rules');
      await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
      await bootDone(s.page);
      const reqBefore = s.rulesReq;
      await s.page.evaluate(() => { window.__openP = openBountyBoard(); });          // 不等它：它正卡在規則檔上
      await until(() => s.rulesReq > reqBefore);                                      // 等到它真的把規則檔的請求發出去、卡在上面再讀（等待有上限，CH22 另外驗；這裡不靠睡固定秒數）
      const held = await s.page.evaluate(() => ({ hidden: document.getElementById('bountyModal').hidden, cards: document.querySelectorAll('#bountyList .bt-card').length,
        loading: !!document.querySelector('#bountyList .bt-empty') }));
      const reqHeld = s.rulesReq;
      gate.release();
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
      const d = await readDemo(s.page);                                                // 卡一出現就讀：之後有沒有補畫都不影響這一條
      const want20 = TAG20['zh-TW'](RULES.chips.remoteMultiplier);
      const remote = d.cards.filter(c => remoteOf(RULES, c.id)), others = d.cards.filter(c => !remoteOf(RULES, c.id));
      ok('CH20f 規則檔還沒回來就開板：先顯示載入中、一張卡都沒有；規則檔一到，第一次畫出來的卡就有偏遠線那張、標「' + want20 + '」，其他卡沒有標記',
        held.hidden === false && held.cards === 0 && held.loading && reqHeld > reqBefore &&
          remote.length === 1 && remote[0].tags.length === 1 && remote[0].tags[0].text === want20 && others.length >= 5 && others.every(c => c.tags.length === 0) && s.errors.length === 0,
        JSON.stringify({ held, rulesReq: reqHeld, reqBefore, remote: remote.map(c => [c.id, c.tags.map(x => x.text)]), others: others.length, errors: s.errors }));
      await s.ctx.close();
    });
  }
  // ═══ CH21：旗標開時，懸賞文案的第一人稱一律用單數（我／I），不出現「我們／We／私たち」 ═══════════════════════════════════
  // 讀的是旗標開、App 殼裡實際畫出來的字：看板（副標與每張卡）、出發前說明卡、護照「校正貢獻」那一節、說明中心三節懸賞、
  // 接下／已接下／存不下三句提示。每個畫面除了掃「沒有」，還要對一句已知的新寫法（證明讀到的是那個畫面，不是空字串）。
  // 規則檔（data/bounty_rules.json）的 qualityText 是伺服器原樣回給網頁、錄製中的提示也直接用的固定文案，畫面上拿它的中文原句當鍵查字典。
  // 那幾句不會出現在下面的畫面流程裡（沒有帶品質原因的旅程）：CH21g 直接掃規則檔的中文、CH21h 對照字典的鍵與譯文，兩條都是零例外。
  if (want('CH21')) {
    const PL = {
      'zh-TW': /我們|咱們|我方/,
      en: /\b(?:we|us|our|ours|ourselves)\b/i,
      ja: /私たち|私達|我々|わたしたち|弊社|当社|当方|私ども|私共/,
    };
    // 改過的四句各自的新寫法（說明中心兩節的一句話、說明卡的承諾句、說明中心「護照裡的校正貢獻」那節的提示）；日文原本就沒有主語，沒動
    const SENT = {
      'zh-TW': { help: '有些路段我手上的行駛資料不夠準', rec: '我用它把那段路的位置推算修準', promise: '我會告訴你是什麼原因、下次怎麼改善。', tip: '而且我會寫出是什麼原因、下次怎麼改善' },
      en: { help: 'the running data I have isn’t accurate enough yet', rec: 'and I use it to make train position estimates', promise: 'I’ll tell you why and how to do better next time.', tip: 'and I tell you why and how to do better next time' },
      ja: { help: '走行データの精度が足りない区間があります', rec: '乗車のついでに記録してもらうと', promise: '理由と次回の改善点をお伝えします。', tip: '原因と次回の改善方法もお知らせします' },
    };
    const PASSPORT21 = { 'zh-TW': '還不能錄程，要更新到最新版才行', en: 'update to the latest version to record', ja: '最新版に更新してください' };   // 現行 App 殼的空狀態
    const ME_EMPTY21 = { ...ME, points: 0, corrected: { segs: 0, adopted: 0 }, lines: [] };       // 護照「校正貢獻」的空狀態
    const hitsOf = (lang, arr) => arr.filter(x => PL[lang].test(x));
    for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH21-${lang}`, async () => {
      const s = await boardSession({}, { lang, me: ME_EMPTY21 });
      const b = await readBoard(s.page);
      const board = [b.sub, ...b.cards.map(c => c.text)];
      await claimDirect(s.page, CARD_R.id);
      await briefOpen(s.page);
      const br = await readBrief(s.page);
      const toasts = [...br.toasts];
      await s.page.click('#bountyBriefLater');
      const again = await s.page.evaluate(async () => {                       // 已接下又再接一次
        document.getElementById('toasts').innerHTML = '';
        const keep = bountyBoardMem; bountyBoardMem = { cards: [] };
        try { await bountyClaim('card-remote-open'); } finally { bountyBoardMem = keep; }
        return [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      });
      toasts.push(...again);
      await s.page.evaluate(() => { window.__bountyKeyBlocked = true; document.getElementById('toasts').innerHTML = ''; });   // 這台裝置存不下認領
      await claimDirect(s.page, CARD_P.id);
      await briefOpen(s.page);
      await until(() => s.claims.length >= 2);
      toasts.push(...(await readBrief(s.page)).toasts);
      const passport = await s.page.evaluate(() => { const e = document.querySelector('#passport .ph-correct'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; });
      await s.page.evaluate(() => openHelp('bounty'));
      const help = await s.page.evaluate(() => Object.fromEntries(['bounty', 'bountyrec', 'bountyme'].map(k => {
        const e = document.querySelector(`#helpBody .help-sec[data-sec="${k}"]`); return [k, e ? e.textContent.replace(/\s+/g, ' ').trim() : '']; })));
      const X = SENT[lang];
      ok(`CH21a-${lang} 看板：副標與每張卡（${b.cards.length} 張）沒有第一人稱複數`,
        b.cards.length === 3 && b.sub.length > 10 && hitsOf(lang, board).length === 0, JSON.stringify({ hits: hitsOf(lang, board), sub: b.sub }));
      ok(`CH21b-${lang} 出發前說明卡：沒有第一人稱複數；承諾句寫成「${X.promise}」`,
        br.text.includes(X.promise) && hitsOf(lang, [br.text]).length === 0, br.text);
      ok(`CH21c-${lang} 護照「校正貢獻」那一節（現行 App 殼）：沒有第一人稱複數（讀到的那一節有請更新那一句：「${PASSPORT21[lang]}」）`,
        passport.includes(PASSPORT21[lang]) && hitsOf(lang, [passport]).length === 0, passport);
      ok(`CH21d-${lang} 說明中心「懸賞板」「錄一趟校正旅程」「護照裡的校正貢獻」三節：沒有第一人稱複數；三節各有改過的那一句（「${X.help}」「${X.rec}」「${X.tip}」）`,
        help.bounty.includes(X.help) && help.bountyrec.includes(X.rec) && help.bountyme.includes(X.tip) && hitsOf(lang, Object.values(help)).length === 0, JSON.stringify(help));
      ok(`CH21e-${lang} 接下／已接下又接／存不下三句提示：沒有第一人稱複數；頁面沒有未捕捉的例外`,
        toasts.length === 3 && toasts.every(x => x.length > 4) && hitsOf(lang, toasts).length === 0 && s.errors.length === 0, JSON.stringify({ toasts, errors: s.errors }));
      await s.ctx.close();
    });
    // 掃描規則自己要咬得住：已知的複數寫法抓得到（含 We’ll、our、us），單數與長得像的字（status、bonus）不誤報
    const BAD = { 'zh-TW': ['我們會告訴你', '等我們維護', '咱們一起', '我方'], en: ['We’ll tell you', 'we use it', 'Tell us why', 'our running data', 'it is ours'], ja: ['私たちが', '我々は', '弊社では'] };
    const GOOD = { 'zh-TW': ['我會告訴你', '我用它把那段路修準', '告訴我', '我手上的資料'], en: ['I’ll tell you why', 'my running data', 'tell me why', 'status and bonus', 'the running data I have'], ja: ['お伝えします', 'あなたのものです', '私は'] };
    ok('CH21f 掃描規則自己咬得住：已知的第一人稱複數寫法（中英日）都抓得到、單數與長得像的字都不誤報',
      Object.keys(PL).every(l => BAD[l].every(x => PL[l].test(x)) && GOOD[l].every(x => !PL[l].test(x))), JSON.stringify({ missed: Object.keys(PL).flatMap(l => BAD[l].filter(x => !PL[l].test(x))), false: Object.keys(PL).flatMap(l => GOOD[l].filter(x => PL[l].test(x))) }));
    // 先確認掃得到東西（每個代碼都有非空的 title 與 how），零命中才不是掃了個空
    const qCodes = Object.entries(RULES.qualityText || {});
    const qShape = qCodes.length > 0 && qCodes.every(([, v]) => v && ['title', 'how'].every(k => typeof v[k] === 'string' && v[k].trim() !== ''));
    const qStrings = qCodes.flatMap(([code, v]) => Object.entries(v || {}).filter(([, x]) => typeof x === 'string').map(([k, x]) => ({ at: `${code}.${k}`, text: x })));
    const qHits = qStrings.filter(x => PL['zh-TW'].test(x.text)).map(x => x.at);
    ok('CH21g 規則檔 qualityText 的中文裡，沒有第一人稱複數（零例外）；每個代碼都有 title 與 how，掃到的不是空的',
      qShape && qHits.length === 0, JSON.stringify({ codes: qCodes.length, strings: qStrings.length, hits: qHits }));
    // 字典怎麼讀：頁面查 t() 時看到的表，是 index.html 依序載入 i18n/translations.js、content-translations.js、bus-transfer-translations.js
    // 之後的 window.RAIL_I18N_MESSAGES（後面的 Object.assign 蓋前面的）。這裡照 scripts/check_i18n.mjs 的做法，在只有空 window 的 vm 裡依同樣順序
    // 各執行一次，不開頁面、不切語言。「有譯文」＝照 t() 查表的方式（i18nLookup）拿這句中文當鍵查那一種語言的表，查到的是非空字串、而且不等於原文；
    // 沒有、值是空的、或原樣抄回，t() 都會把中文直接顯示給英日介面的人看。
    await attempt('CH21h', async () => {
      const DICT = (() => {
        const sandbox = { window: {} };
        vm.createContext(sandbox);
        for (const f of ['translations.js', 'content-translations.js', 'bus-transfer-translations.js'])
          vm.runInContext(readFileSync(path.join(ROOT, 'i18n', f), 'utf8'), sandbox, { filename: `i18n/${f}` });
        return sandbox.window.RAIL_I18N_MESSAGES || {};
      })();
      const has = (dict, lang, x) => { const v = (dict[lang] || {})[x]; return typeof v === 'string' && v.trim() !== '' && v !== x; };
      const missing = (dict, lang, texts) => texts.filter(x => !has(dict, lang, x));
      const zh = qStrings.map(x => x.text).filter(x => /\p{Script=Han}/u.test(x));
      const lacks = { en: missing(DICT, 'en', zh), ja: missing(DICT, 'ja', zh) };
      const plural = { en: zh.filter(x => has(DICT, 'en', x) && PL.en.test(DICT.en[x])), ja: zh.filter(x => has(DICT, 'ja', x) && PL.ja.test(DICT.ja[x])) };
      ok('CH21h 規則檔 qualityText 的每一句中文（每個代碼的 title、how），在字典的 en 與 ja 都有同一句當鍵、值是真的譯文，而且英日譯文都沒有第一人稱複數——規則檔換了字、字典沒跟著換，這條會紅',
        qShape && zh.length > 0 && Object.values(lacks).every(a => a.length === 0) && Object.values(plural).every(a => a.length === 0),
        JSON.stringify({ strings: zh.length, lacks, plural }));
      // 掃描自己要咬得住：真字典裡沒有的假句子要判成缺；小字典裡有譯文的不誤報；空字串、原文抄回、只有另一種語言才有的鍵，都判成缺
      const FAKE = '這是一句字典裡不會有的假句子，只用來確認判準會把它判成缺';
      const small = { en: { '甲': 'A', '空': '', '抄': '抄' }, ja: { '甲': 'あ' } };
      const probes = [
        ['真字典沒有的假句子（en）', missing(DICT, 'en', [FAKE]).length, 1],
        ['真字典沒有的假句子（ja）', missing(DICT, 'ja', [FAKE]).length, 1],
        ['小字典有譯文（en、ja）', missing(small, 'en', ['甲']).length + missing(small, 'ja', ['甲']).length, 0],
        ['空字串值、原文抄回', missing(small, 'en', ['空', '抄']).length, 2],
        ['只有另一種語言才有的鍵', missing(small, 'ja', ['空']).length, 1],
      ];
      ok('CH21i 字典的掃描自己咬得住：真字典裡沒有的假句子，en 與 ja 都判成缺；小字典裡有譯文的不誤報，空字串、原文抄回、只有另一種語言才有的鍵都判成缺',
        probes.every(([, got, want]) => got === want), JSON.stringify(probes));
    });
  }
  // ═══ CH22：規則檔一直不回來時，看板與護照不被它卡住 ═══════════════════════════════════════════════════════════════
  // 規則檔只決定卡片上的「籌碼 ×N」標記與護照的「下一座」那一格；手機在隧道裡，一個請求可以好幾分鐘既不回也不報錯。
  // 規則檔（與其中一組的看板資料）的回應由測試扣住（hold）、之後才放開，誰先誰後由測試持有的閘決定，不靠睡眠秒數。
  // 「上限」讀頁面自己的常數（BOUNTY_RULES_WAIT_MS），畫出來的最長時間＝上限＋一點餘裕；另外釘一個絕對的地板與天花板，
  // 因為只跟著頁面的常數走的話，上限被改得很長，判準也跟著放寬、照樣全綠；被改到接近 0，正常網路下標記就趕不上第一次畫。
  if (want('CH22')) {
    const CAP_FLOOR_MS = 1000, CAP_CEIL_MS = 5000, SLACK_MS = 2500;
    const eR = expectOf(RULES, KEY_NAN), MARK = `籌碼 ×${eR.mult}`;
    const capOf = page => page.evaluate(() => BOUNTY_RULES_WAIT_MS);
    const limitOf = cap => Math.min(cap, CAP_CEIL_MS) + SLACK_MS;
    const rulesInMem = page => page.evaluate(() => bountyRulesMem !== null);
    // 開看板（不等它，它正卡在規則檔上）：在頁面裡記下開始的時刻；回頁面實際等了多久才畫出 n 張以上的卡（超過 limit 還沒畫出來：drawn＝false）
    const openAndWait = async (page, n, limit) => {
      await page.evaluate(() => { window.__t0 = performance.now(); window.__openErr = null; window.__openP = openBountyBoard().then(() => true, e => { window.__openErr = String((e && e.message) || e); return false; }); });
      const drawn = await page.waitForFunction(k => document.querySelectorAll('#bountyList .bt-card').length >= k, n, { timeout: limit, polling: 25 }).then(() => true, () => false);
      return { drawn, ms: await page.evaluate(() => Math.round(performance.now() - window.__t0)) };
    };
    // 開看板那一呼叫自己有沒有跑完：true＝跑完沒丟錯、false＝丟了錯、'pending'＝還卡著（不能直接 await，卡著的話會一直等下去）
    const openState = (page, key = '__openP') => page.evaluate(k => Promise.race([window[k], new Promise(r => setTimeout(() => r('pending'), 200))]), key);
    // 放開規則檔，等到它真的進了頁面的記憶體；再讓頁面多跑幾拍（若有人在補畫，這時早已畫完）
    const releaseAndArrive = async (s, gate) => {
      gate.release();
      await s.page.waitForFunction(() => bountyRulesMem !== null, null, { timeout: 15000 });
      await s.page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    };
    const idsOf = b => b.cards.map(c => c.id);
    const tagOf = (b, id) => (b.cards.find(c => c.id === id) || { tags: null }).tags;
    const distinct = a => new Set(a).size === a.length;
    const modalState = page => page.evaluate(() => ({ hidden: document.getElementById('bountyModal').hidden, html: document.getElementById('bountyList').innerHTML,
      cards: document.querySelectorAll('#bountyList .bt-card').length, loading: !!document.querySelector('#bountyList .bt-empty') }));
    // 真看板（旗標開、App 殼、已登入）：規則檔從開機前就扣住；看板資料照舊立刻回（南迴線兩張＝偏遠線、屏東線一張）
    const realSession = async () => {
      const s = await newSession({ app: true }, {}, { ctx: { locale: 'zh-TW' } });
      s.board = BOARD_V2;
      const gate = s.hold('rules');
      await s.page.goto(`${BASE}/?bounty=1&lang=zh-TW`);
      await loggedIn(s.page);
      await chipsLoaded(s.page);
      return { s, gate };
    };
    const REAL_IDS = [CARD_R.id, CARD_P.id, CARD_RC.id];

    // ── 示範看板（?demo=bounty）：規則檔扣住 → 上限之內畫出原本的 5 張；之後才放開 → 不丟錯、不重挑、不重複
    await attempt('CH22-demo', async () => {
      const s = await newSession({ app: false }, {}, { ctx: { locale: 'zh-TW' } });
      const gate = s.hold('rules');
      await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
      await bootDone(s.page);
      const cap = await capOf(s.page);
      ok(`CH22a 等規則檔的上限（BOUNTY_RULES_WAIT_MS＝${cap} 毫秒）是個有限的數字，落在 ${CAP_FLOOR_MS}～${CAP_CEIL_MS} 毫秒：太長，看板與護照在隧道裡一直等；太短，正常網路下標記趕不上第一次畫`,
        Number.isFinite(cap) && cap >= CAP_FLOOR_MS && cap <= CAP_CEIL_MS, String(cap));
      const before = s.rulesReq;
      const o = await openAndWait(s.page, 1, limitOf(cap));
      const b1 = await readBoard(s.page);
      const st = await s.page.evaluate(() => ({ rulesMem: bountyRulesMem !== null, kinds: bountyBoardMem ? bountyBoardMem.cards.map(c => c.kind) : null }));
      const done = await openState(s.page);
      ok(`CH22b 示範看板：規則檔一直扣住時，在上限＋餘裕（${limitOf(cap)} 毫秒）之內畫出原本的 5 張卡（4 張路段卡＋1 張停站卡）、沒有任何標記；開看板那一呼叫自己跑完了；規則檔此時確實還沒到（頁面問過、還在等）`,
        o.drawn && o.ms <= limitOf(cap) && b1.cards.length === 5 && !!st.kinds && st.kinds.filter(k => k === 'track').length === 4 && st.kinds.filter(k => k === 'dwell').length === 1 &&
          b1.cards.every(c => c.tags.length === 0) && done === true && st.rulesMem === false && s.rulesReq > before && s.errors.length === 0,
        JSON.stringify({ cap, o, kinds: st.kinds, tags: b1.cards.map(c => c.tags.length), done, rulesMem: st.rulesMem, rulesReq: s.rulesReq, before, errors: s.errors }));
      await releaseAndArrive(s, gate);
      const b2 = await readBoard(s.page);
      ok('CH22c 示範看板：規則檔之後才到——頁面沒有丟例外、板子還是原來那 5 張（編號與順序不變、沒有重複、沒有重挑出偏遠線那張）；規則檔確實進了記憶體',
        (await rulesInMem(s.page)) && s.errors.length === 0 && b2.cards.length === 5 && JSON.stringify(idsOf(b2)) === JSON.stringify(idsOf(b1)) && distinct(idsOf(b2)),
        JSON.stringify({ before: idsOf(b1), after: idsOf(b2), errors: s.errors }));
      await s.ctx.close();
    });

    // ── 真看板：規則檔扣住 → 上限之內先畫不帶標記的卡；之後才放開 → 偏遠線的卡補上標記
    await attempt('CH22-real', async () => {
      const { s, gate } = await realSession();
      const cap = await capOf(s.page);
      const before = s.rulesReq;
      const o = await openAndWait(s.page, 3, limitOf(cap));
      const b1 = await readBoard(s.page);
      const rulesMem1 = await rulesInMem(s.page);
      const done = await openState(s.page);
      ok(`CH22d 真看板：規則檔一直扣住（看板資料照舊回）時，在上限＋餘裕（${limitOf(cap)} 毫秒）之內畫出 3 張卡、沒有任何標記；開看板那一呼叫自己跑完了；規則檔此時確實還沒到（頁面問過、還在等）`,
        o.drawn && o.ms <= limitOf(cap) && JSON.stringify(idsOf(b1)) === JSON.stringify(REAL_IDS) && b1.cards.every(c => c.tags.length === 0) && done === true && rulesMem1 === false && s.rulesReq > before && s.errors.length === 0,
        JSON.stringify({ cap, o, ids: idsOf(b1), tags: b1.cards.map(c => c.tags.length), done, rulesMem: rulesMem1, rulesReq: s.rulesReq, before, errors: s.errors }));
      gate.release();
      const marked = await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-chip').length >= 1, null, { timeout: 10000 }).then(() => true, () => false);
      await s.page.evaluate(() => new Promise(r => setTimeout(r, 300)));
      const b2 = await readBoard(s.page);
      ok(`CH22e 真看板：規則檔之後才到、看板還開著——偏遠線的兩張卡（南迴線一般卡與收滿卡）補上「${MARK}」、屏東線那張沒有；還是原來那 3 張（編號與順序不變、沒有重複）、頁面沒有丟例外`,
        marked && JSON.stringify(tagOf(b2, CARD_R.id)) === JSON.stringify([MARK]) && JSON.stringify(tagOf(b2, CARD_RC.id)) === JSON.stringify([MARK]) && JSON.stringify(tagOf(b2, CARD_P.id)) === '[]' &&
          JSON.stringify(idsOf(b2)) === JSON.stringify(REAL_IDS) && distinct(idsOf(b2)) && (await openState(s.page)) === true && s.errors.length === 0,
        JSON.stringify({ marked, tags: b2.cards.map(c => [c.id, c.tags]), errors: s.errors }));
      await s.ctx.close();
    });

    // ── 真看板，規則檔在上限之內到了：第一次畫出來的卡就帶標記（不是先畫一版沒標記的再補），而且一到就畫、不是照樣等滿上限
    await attempt('CH22-intime', async () => {
      const { s, gate } = await realSession();
      const cap = await capOf(s.page);
      const before = s.rulesReq;
      await s.page.evaluate(() => {
        window.__first = null; window.__t0 = performance.now();
        new MutationObserver(() => {
          const cs = document.querySelectorAll('#bountyList .bt-card');
          if (!window.__first && cs.length >= 3) { window.__firstAt = Math.round(performance.now() - window.__t0); window.__first = [...cs].map(c => ({ id: c.dataset.card, tags: [...c.querySelectorAll('.bt-pt')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) })); }
        }).observe(document.getElementById('bountyList'), { childList: true, subtree: true });
        window.__openErr = null;
        window.__openP = openBountyBoard().then(() => true, e => { window.__openErr = String((e && e.message) || e); return false; });
      });
      await until(() => s.rulesReq > before);                                           // 頁面真的在等規則檔了（離上限還很遠），這時才放開
      gate.release();
      await s.page.waitForFunction(() => window.__first !== null, null, { timeout: 15000 });
      const first = await s.page.evaluate(() => window.__first), firstAt = await s.page.evaluate(() => window.__firstAt);
      const tags = id => (first.find(c => c.id === id) || { tags: null }).tags;
      ok(`CH22f 真看板：規則檔在上限之內到了——第一次畫出來的卡就帶標記（南迴線兩張「${MARK}」、屏東線沒有），不是先畫一版沒標記的再補；而且在上限（${cap} 毫秒）到之前就畫了（${firstAt} 毫秒），不是照樣等滿上限`,
        first.length === 3 && JSON.stringify(first.map(c => c.id)) === JSON.stringify(REAL_IDS) && JSON.stringify(tags(CARD_R.id)) === JSON.stringify([MARK]) && JSON.stringify(tags(CARD_RC.id)) === JSON.stringify([MARK]) &&
          JSON.stringify(tags(CARD_P.id)) === '[]' && Number.isFinite(firstAt) && firstAt < cap && s.errors.length === 0, JSON.stringify({ first, firstAt, cap, errors: s.errors }));
      await s.ctx.close();
    });

    // ── 真看板，看板關掉之後規則檔才到：不丟錯、不畫到關著的看板上
    await attempt('CH22-closed', async () => {
      const { s, gate } = await realSession();
      const cap = await capOf(s.page);
      const o = await openAndWait(s.page, 3, limitOf(cap));
      await s.page.click('#bountyClose');
      const snap = await modalState(s.page);
      await releaseAndArrive(s, gate);
      const after = await modalState(s.page);
      const o2 = await openAndWait(s.page, 3, 10000);                                   // 對照：重開，規則檔已在記憶體，第一次畫就帶標記
      const b3 = await readBoard(s.page);
      ok('CH22g 真看板：看板關掉之後規則檔才到——頁面沒有丟例外、看板保持關閉、關著的看板裡的內容一個字沒變（沒有補上標記）；規則檔確實到了（重新開板，第一次畫就帶標記）',
        o.drawn && snap.hidden === true && snap.cards === 3 && !/bt-chip/.test(snap.html) && after.hidden === true && after.html === snap.html && s.errors.length === 0 &&
          o2.drawn && JSON.stringify(tagOf(b3, CARD_R.id)) === JSON.stringify([MARK]) && JSON.stringify(tagOf(b3, CARD_P.id)) === '[]',
        JSON.stringify({ o, snapHidden: snap.hidden, snapCards: snap.cards, afterHidden: after.hidden, same: after.html === snap.html, o2, tags: b3.cards.map(c => [c.id, c.tags]), errors: s.errors }));
      await s.ctx.close();
    });

    // ── 真看板，第一次開的補畫不能畫到第二次開的看板上：關掉再開（第二次的看板資料還沒回來、停在載入中），這時規則檔才到
    await attempt('CH22-reopen', async () => {
      const { s, gate } = await realSession();
      const cap = await capOf(s.page);
      const o1 = await openAndWait(s.page, 3, limitOf(cap));
      await s.page.click('#bountyClose');
      const bgate = s.hold('board');                                                    // 第二次開板的看板資料先扣住
      await s.page.evaluate(() => { window.__openP2 = openBountyBoard().then(() => true, e => { window.__openErr = String((e && e.message) || e); return false; }); });
      await until(() => s.boardReq >= 2);                                               // 第二次的看板請求已經發出、卡在閘上
      const loading = await modalState(s.page);
      await releaseAndArrive(s, gate);
      const mid = await modalState(s.page);                                             // 規則檔到了、第二次的看板資料還沒到：還是「載入中…」，沒有被舊的補畫蓋成卡片
      bgate.release();
      const drawn2 = await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 }).then(() => true, () => false);
      const b = await readBoard(s.page);
      ok('CH22j 真看板：第一次開的看板沒等到規則檔、關掉再開（第二次的看板資料還沒回來）時規則檔才到——第二次那塊「載入中…」沒有被第一次留下的補畫蓋成舊的卡片；看板資料一到，第二次畫的卡帶標記、沒有重複、沒有丟例外',
        o1.drawn && loading.hidden === false && loading.cards === 0 && loading.loading && mid.hidden === false && mid.cards === 0 && mid.loading &&
          drawn2 && JSON.stringify(idsOf(b)) === JSON.stringify(REAL_IDS) && JSON.stringify(tagOf(b, CARD_R.id)) === JSON.stringify([MARK]) && JSON.stringify(tagOf(b, CARD_P.id)) === '[]' && distinct(idsOf(b)) && s.errors.length === 0,
        JSON.stringify({ loading: [loading.hidden, loading.cards, loading.loading], mid: [mid.hidden, mid.cards, mid.loading], drawn2, tags: b.cards.map(c => [c.id, c.tags]), errors: s.errors }));
      await s.ctx.close();
    });

    // ── 護照：規則檔扣住 → 上限之內籌碼數字照樣畫出來（「下一座」那一格不顯示）；之後才放開 → 不丟錯
    // 登入結果由測試放出來（authManual），所以「從登入到籌碼數字畫出來」的時間在頁面裡量得到起點。
    await attempt('CH22-passport', async () => {
      const s = await newSession({ authManual: true }, {}, { ctx: { locale: 'zh-TW' } });
      const gate = s.hold('rules');
      await goBounty(s);
      await bootDone(s.page);
      await until(() => s.page.evaluate(() => typeof window.__fireAuth === 'function'));
      const cap = await capOf(s.page);
      const before = s.rulesReq;
      await s.page.evaluate(() => { window.__t0 = performance.now(); window.__fireAuth(); });
      const drawn = await s.page.waitForFunction(() => { const b = document.querySelector('#passport .ph-chips [data-k="balance"] b'); return !!b && b.textContent.trim() === '5'; }, null, { timeout: limitOf(cap), polling: 25 }).then(() => true, () => false);
      const ms = await s.page.evaluate(() => Math.round(performance.now() - window.__t0));
      const r = await rowInfo(s.page);
      const rulesMem1 = await rulesInMem(s.page);
      ok(`CH22h 護照：規則檔一直扣住時，籌碼數字在上限＋餘裕（${limitOf(cap)} 毫秒）之內照樣畫出來（餘額 5）、「下一座」那一格不顯示（照規則檔讀不到處理）；規則檔此時確實還沒到（頁面問過、還在等）`,
        drawn && ms <= limitOf(cap) && !!r && !r.off && !!r.cells.balance && r.cells.balance.nums.join() === '5' && !r.cells.next && rulesMem1 === false && s.rulesReq > before && s.errors.length === 0,
        JSON.stringify({ cap, drawn, ms, cells: r && Object.keys(r.cells), rulesMem: rulesMem1, rulesReq: s.rulesReq, before, errors: s.errors }));
      await releaseAndArrive(s, gate);
      const r2 = await rowInfo(s.page);
      ok('CH22i 護照：規則檔之後才到——頁面沒有丟例外、籌碼數字還在（餘額 5）；規則檔確實進了記憶體',
        (await rulesInMem(s.page)) && s.errors.length === 0 && !!r2 && !r2.off && !!r2.cells.balance && r2.cells.balance.nums.join() === '5', JSON.stringify({ cells: r2 && r2.cells, errors: s.errors }));
      await s.ctx.close();
    });
  }
  // ═══ CH23：說明卡講清楚「合格」是什麼 ═══════════════════════════════════════════════════════════════════════════
  // 說明卡「先講清楚」那一節，緊接在「錄到一半中斷沒關係」後面有兩句：什麼叫合格的一趟（同一班車從頭錄到尾至少幾分鐘、同一條線上至少移動多遠、
  // 資料能用、一班車最多算一趟），以及沒達到會怎樣。門檻讀規則檔 chips.minTripSec／minTripMoveM，進位只准往上：畫面上的門檻永遠不比伺服器的低。
  // 期望值有兩種來源，都不呼叫 index.html 的函式：
  //   ① 字面對照表：每一列「規則檔的秒數與公尺數 → 畫面上該出現的字」都是這裡手算寫死的；
  //   ② 換算回去的區間檢查：把畫面上的數字讀出來換回秒與公尺，必須 ≥ 規則檔的門檻、而且多出來的不到一個進位單位（分鐘 60 秒、公里 100 公尺、公尺 1），
  //      再丟進伺服器入帳用的純函式 tripChips——達到畫面上的門檻的那一趟，伺服器真的會給籌碼。
  if (want('CH23')) {
    const SENT23 = {
      'zh-TW': { head: '合格的一趟要同時做到：', tail: '一班車最多算一趟。', short: '沒達到門檻，能用的資料照樣拿來校正，只是沒有籌碼。',
        full: (time, dist) => `合格的一趟要同時做到：同一班車從頭錄到尾至少 ${time}、在同一條線上至少移動 ${dist}、資料能用。一班車最多算一趟。`,
        unit: { min: n => `${n} 分鐘`, km: n => `${n} 公里`, m: n => `${n} 公尺` } },
      en: { head: 'A qualifying trip needs all of these:', tail: 'One train counts as one trip at most.', short: 'If a trip falls short, its usable data still goes into calibration; it just earns no chips.',
        full: (time, dist) => `A qualifying trip needs all of these: you record the same train for at least ${time} from start to finish, you travel at least ${dist} along the same line, and the data is usable. One train counts as one trip at most.`,
        unit: { min: n => `${n} min`, km: n => `${n} km`, m: n => `${n} m` } },
      ja: { head: '条件を満たした1回の乗車とは、', tail: '1本の列車につき、数えるのは1回までです。', short: '条件に届かなくても、使えるデータは校正に使われます。ただしチップはもらえません。',
        full: (time, dist) => `条件を満たした1回の乗車とは、次のすべてを満たすものです。同じ列車を最初から最後まで ${time} 以上記録すること、同じ路線上を ${dist} 以上移動すること、使えるデータであること。1本の列車につき、数えるのは1回までです。`,
        unit: { min: n => `${n}分`, km: n => `${n}km`, m: n => `${n}m` } },
    };
    const NEW_ANY = /合格的一趟要同時做到|沒達到門檻|A qualifying trip needs all|falls short|条件を満たした1回の乗車とは|条件に届かなくても/;
    const ENGINEERING = /判定|里程跨距|跨距|minTripSec|minTripMoveM|verdict|suspect|unusable|durationSec|moveM|chips\./;
    const withChips = over => ({ ...RULES, chips: { ...RULES.chips, ...over } });
    // 一份規則檔（minTripSec／minTripMoveM）→ 畫面該出現的字（手算）。km 的小數是進位到 0.1 公里。
    const TABLE = [
      { id: 'a', sec: 900, m: 2500, zh: ['15 分鐘', '2.5 公里'], en: ['15 min', '2.5 km'], ja: ['15分', '2.5km'], why: '整分鐘、2.5 公里（換一份規則檔，畫面跟著變）' },
      { id: 'b', sec: 650, m: 1500, zh: ['11 分鐘', '1.5 公里'], en: ['11 min', '1.5 km'], ja: ['11分', '1.5km'], why: '650 秒＝10.83 分鐘→往上取 11（往下會是 10）' },
      { id: 'c', sec: 601, m: 1001, zh: ['11 分鐘', '1.1 公里'], en: ['11 min', '1.1 km'], ja: ['11分', '1.1km'], why: '只多 1 秒、多 1 公尺也各往上進一格' },
      { id: 'd', sec: 60, m: 999, zh: ['1 分鐘', '999 公尺'], en: ['1 min', '999 m'], ja: ['1分', '999m'], why: '剛好 1 分鐘；不到 1 公里寫公尺、不進位成 1 公里' },
      { id: 'e', sec: 1, m: 1, zh: ['1 分鐘', '1 公尺'], en: ['1 min', '1 m'], ja: ['1分', '1m'], why: '最小的正數也不會寫成 0' },
      { id: 'f', sec: 3600, m: 12345, zh: ['60 分鐘', '12.4 公里'], en: ['60 min', '12.4 km'], ja: ['60分', '12.4km'], why: '12.345 公里→往上取 12.4（四捨五入會是 12.3）' },
    ];
    // 畫面上的合格那一句：抓出兩個門檻，換算回秒與公尺
    const shownOf = text => {
      const mt = text.match(/至少 ([\d.]+) 分鐘/), md = text.match(/至少移動 ([\d.]+) (公里|公尺)/);
      if (!mt || !md) return null;
      const km = md[2] === '公里';
      return { sec: Math.round(Number(mt[1]) * 60), m: km ? Math.round(Number(md[1]) * 10) * 100 : Math.round(Number(md[1])), km, minTxt: mt[1], distTxt: md[1] };
    };
    const rangeOk = (shown, sec, m) => !!shown && shown.sec >= sec && shown.sec - sec < 60 && shown.m >= m && shown.m - m < (shown.km ? 100 : 1);
    const gets = (shown, rules) => tripChips({ verdict: 'ok', lineKeys: ['none|x'], durationSec: shown.sec, moveM: shown.m, day: '2026-10-02' }, rules.chips);
    // 這個 session 直接叫 bountyClaim 開說明卡：說明卡的內容與怎麼走到它無關（走到它的路在別的判準驗）
    const openBriefOf = async (s, card) => {
      await s.page.evaluate(id => { bountyClaim(id); }, card.id);
      await briefOpen(s.page);
      return readBrief(s.page);
    };
    const fixtureOk = (s, rules) => s.page.evaluate(r => { const c = bountyRulesMem && bountyRulesMem.chips; return !!c && c.minTripSec === r.sec && c.minTripMoveM === r.m; }, { sec: rules.chips.minTripSec, m: rules.chips.minTripMoveM });

    await attempt('CH23-real', async () => {
      const s = await boardSession({}, {});
      const br = await openBriefOf(s, CARD_R);
      const sh = shownOf(br.text), L = SENT23['zh-TW'];
      ok(`CH23a [fixture] 讀到的規則檔就是真的那份（minTripSec ${RULES.chips.minTripSec}、minTripMoveM ${RULES.chips.minTripMoveM}、每趟 ${RULES.chips.perTrip}）；說明卡開了`,
        (await fixtureOk(s, RULES)) && RULES.chips.perTrip > 0 && br.text.length > 100, JSON.stringify({ n: br.text.length }));
      ok('CH23b 說明卡有「合格的一趟要同時做到」那一整句：四件事都在（從頭錄到尾至少幾分鐘、同一條線上至少移動多遠、資料能用、一班車最多算一趟），數字是規則檔進位後的',
        !!sh && br.text.includes(L.head) && br.text.includes(L.tail) && br.text.includes('資料能用') && /同一班車從頭錄到尾至少/.test(br.text) && /在同一條線上至少移動/.test(br.text), br.text);
      ok(`CH23c 畫面上的門檻換回秒與公尺（${sh && sh.sec} 秒、${sh && sh.m} 公尺）：不低於規則檔的（${RULES.chips.minTripSec} 秒、${RULES.chips.minTripMoveM} 公尺）、多出來的不到一個進位單位`,
        rangeOk(sh, RULES.chips.minTripSec, RULES.chips.minTripMoveM), JSON.stringify({ sh, rules: [RULES.chips.minTripSec, RULES.chips.minTripMoveM] }));
      ok('CH23d 伺服器入帳用的純函式（tripChips）對這些門檻：剛好達到畫面上寫的那一趟有籌碼、少 1 秒或少 1 公尺沒有、資料被判可疑或不能用沒有（四句話各對得上伺服器的一個條件）',
        !!sh && gets(sh, RULES) > 0 &&
          tripChips({ verdict: 'ok', lineKeys: [], durationSec: sh.sec - 1, moveM: sh.m, day: '2026-10-02' }, RULES.chips) === 0 &&
          tripChips({ verdict: 'ok', lineKeys: [], durationSec: sh.sec, moveM: sh.m - 1, day: '2026-10-02' }, RULES.chips) === 0 &&
          tripChips({ verdict: 'suspect', lineKeys: [], durationSec: sh.sec, moveM: sh.m, day: '2026-10-02' }, RULES.chips) === 0 &&
          tripChips({ verdict: 'unusable', lineKeys: [], durationSec: sh.sec, moveM: sh.m, day: '2026-10-02' }, RULES.chips) === 0, JSON.stringify(sh));
      const pos = ['錄到一半中斷沒關係', L.head, L.short, '即使這次的資料不能用'].map(x => br.text.indexOf(x));
      ok('CH23e 位置與語氣：緊接在「錄到一半中斷沒關係」之後、在「即使這次的資料不能用」之前（中斷那句、合格那句、沒達到那句、承諾那句依序）；「沒達到門檻，能用的資料照樣拿來校正，只是沒有籌碼。」在；整段沒有工程術語',
        pos.every(x => x >= 0) && pos.every((x, i) => i === 0 || x > pos[i - 1]) && !ENGINEERING.test(br.text), JSON.stringify({ pos, hit: (br.text.match(ENGINEERING) || [null])[0] }));
      const dom = await s.page.evaluate(() => [...document.querySelectorAll('#bountyBriefBody .bb-sec')].map(sec => ({ head: sec.querySelector('b').textContent.trim(), text: sec.textContent.replace(/\s+/g, ' ').trim(), lis: [...sec.querySelectorAll('li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()) })));
      const clean = dom.find(x => x.head === '先講清楚');
      const ix = clean ? ['錄到一半中斷沒關係', L.head, '沒達到門檻', '即使這次的資料不能用'].map(p => clean.lis.findIndex(x => x.startsWith(p))) : [];
      ok('CH23f 這兩句各自是「先講清楚」那一節裡獨立的一條（不是塞進別的段落），上下兩條照在、依序是 中斷、合格、沒達到、承諾；其他幾節裡沒有這兩句',
        !!clean && ix.length === 4 && ix.every(v => v >= 0) && ix.every((v, k) => k === 0 || v === ix[k - 1] + 1) && dom.length >= 3 && !dom.filter(x => x.head !== '先講清楚').some(x => NEW_ANY.test(x.text)), JSON.stringify({ ix, heads: dom.map(x => x.head) }));
      ok('CH23g 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 換一份規則檔、畫面跟著變（寫死的數字換一份就對不上）；三種介面各一輪
    for (const lang of ['zh-TW', 'en', 'ja']) for (const row of (lang === 'zh-TW' ? TABLE.slice(0, 2) : TABLE.slice(0, 1))) await attempt(`CH23-served-${lang}-${row.id}`, async () => {
      const rules = withChips({ minTripSec: row.sec, minTripMoveM: row.m });
      const s = await boardSession({}, { rules, lang });
      const br = await openBriefOf(s, CARD_R);
      const X = SENT23[lang], [tm, ds] = row[lang === 'zh-TW' ? 'zh' : lang];
      ok(`CH23h-${lang}-${row.id} [fixture] 頁面讀到的是這一輪換的規則檔（${row.sec} 秒、${row.m} 公尺）：${row.why}`, await fixtureOk(s, rules), '');
      ok(`CH23i-${lang}-${row.id} ${lang} 介面的整句：「${X.full(tm, ds)}」，緊接著「${X.short}」`,
        br.text.includes(X.full(tm, ds)) && br.text.includes(X.short) && br.text.indexOf(X.short) > br.text.indexOf(X.full(tm, ds)), br.text);
      if (lang === 'zh-TW') {
        const sh = shownOf(br.text);
        ok(`CH23j-${row.id} 換算回去的區間檢查與伺服器純函式：畫面上的門檻不低於規則檔、多出來的不到一個進位單位，達到畫面門檻的那一趟伺服器給籌碼`,
          rangeOk(sh, row.sec, row.m) && gets(sh, rules) > 0, JSON.stringify({ sh }));
      }
      if (lang === 'en') {
        const seg = br.text.slice(br.text.indexOf(X.head), br.text.indexOf(X.short) + X.short.length);
        ok(`CH23k-en-${row.id} 英文介面：合格那兩句整段取出來（${seg.length} 字）沒有漏出中文`, seg.length > 150 && !/[㐀-鿿]/.test(seg), seg);
      }
      ok(`CH23l-${lang}-${row.id} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 進位的對照表：同一個頁面把規則檔記憶體換成各種數字（頁面自己讀規則檔的那個變數），每一列的字與區間檢查都要對
    await attempt('CH23-table', async () => {
      const s = await boardSession({}, {});
      const L = SENT23['zh-TW'];
      for (const row of TABLE) {
        const text = await s.page.evaluate(r => {
          bountyRulesMem = { ...bountyRulesMem, chips: { ...bountyRulesMem.chips, minTripSec: r.sec, minTripMoveM: r.m } };
          showBountyBrief(bountyBoardMem.cards[0]);
          return document.getElementById('bountyBriefBody').textContent.replace(/\s+/g, ' ').trim();
        }, { sec: row.sec, m: row.m });
        const sh = shownOf(text), rules = withChips({ minTripSec: row.sec, minTripMoveM: row.m });
        ok(`CH23m-${row.id} 規則檔 ${row.sec} 秒、${row.m} 公尺 → 「${L.full(row.zh[0], row.zh[1])}」（${row.why}）；換算回去不低於規則檔、多出的不到一個進位單位`,
          text.includes(L.full(row.zh[0], row.zh[1])) && rangeOk(sh, row.sec, row.m) && gets(sh, rules) > 0, JSON.stringify({ text: text.slice(text.indexOf(L.head), text.indexOf(L.head) + 80), sh }));
      }
      // 規則檔讀到了、但門檻缺、不是正數、不是數字，或每趟不給籌碼：整段不寫（只有合格那兩句不寫，說明卡其他的句子照在）
      const BAD = [
        ['沒有 chips 區塊', { whole: true }], ['沒有 minTripSec', { drop: 'minTripSec' }], ['沒有 minTripMoveM', { drop: 'minTripMoveM' }], ['minTripSec 是 0', { set: { minTripSec: 0 } }],
        ['minTripMoveM 是 0', { set: { minTripMoveM: 0 } }], ['minTripSec 是負數', { set: { minTripSec: -600 } }], ['minTripMoveM 不是數字', { set: { minTripMoveM: 'abc' } }], ['每趟 0 顆', { set: { perTrip: 0 } }],
      ];
      const outs = [];
      for (const [label, o] of BAD) {
        const text = await s.page.evaluate(({ o, chips }) => {
          const c = { ...chips, ...(o.set || {}) };
          if (o.drop) delete c[o.drop];
          bountyRulesMem = o.whole ? { v: 1 } : { ...bountyRulesMem, chips: c };
          showBountyBrief(bountyBoardMem.cards[0]);
          return document.getElementById('bountyBriefBody').textContent.replace(/\s+/g, ' ').trim();
        }, { o, chips: RULES.chips });
        outs.push([label, !NEW_ANY.test(text) && text.includes('錄到一半中斷沒關係') && text.includes('即使這次的資料不能用')]);
      }
      ok('CH23n 規則檔讀到了但門檻缺、是 0、是負數、不是數字、或每趟不給籌碼：合格那兩句都不出現，說明卡其他句子（中斷、承諾）照在', outs.every(x => x[1]), JSON.stringify(outs));
      ok('CH23o 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 規則檔讀不到：說明卡照樣開、合格那兩句整段不出現（寧可不寫，也不憑記憶補數字）；每趟、每天那兩句也不在
    await attempt('CH23-404', async () => {
      const s = await boardSession({}, { rules: '404' });
      const br = await openBriefOf(s, CARD_R);
      ok('CH23p 規則檔讀不到：說明卡照樣開、合格那兩句與獎勵句都不出現（沒有「合格的一趟要同時做到」「沒達到門檻」「顆籌碼」）；期限、中斷、承諾那幾句照在；頁面沒有未捕捉的例外',
        !NEW_ANY.test(br.text) && !/顆籌碼|每天最多/.test(br.text) && br.text.includes('錄到一半中斷沒關係') && br.text.includes('接下的卡 24 小時內有效。') && br.text.includes('即使這次的資料不能用') && s.errors.length === 0, br.text);
      await s.ctx.close();
    });
    // ?demo=bounty 的說明卡（停站卡）也有這兩句；備援站看設計的路徑照走（真的點「接下」、說明卡開、能按「開始錄製」進錄製）
    await attempt('CH23-demo', async () => {
      const s = await newSession({ app: false }, {}, { ctx: { locale: 'zh-TW' } });
      await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
      await bootDone(s.page);
      await s.page.click('#passport [data-act="bountyboard"]');
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
      const dwell = await s.page.evaluate(() => (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id);
      await s.page.click(takeSel(dwell));
      await briefOpen(s.page);
      const br = await readBrief(s.page), sh = shownOf(br.text);
      ok('CH23q ?demo=bounty（停站卡）：真的點「接下」開出的說明卡也有合格那一整句與「沒達到門檻」那句，數字不低於規則檔、多出的不到一個進位單位',
        !!dwell && br.text.includes(SENT23['zh-TW'].head) && br.text.includes(SENT23['zh-TW'].short) && rangeOk(sh, RULES.chips.minTripSec, RULES.chips.minTripMoveM), JSON.stringify({ dwell, sh }));
      await s.page.click('#bountyBriefGo');
      await s.page.waitForFunction(() => !!state.recording, null, { timeout: 15000 });
      ok('CH23r ?demo=bounty：說明卡按「開始錄製」照樣進入錄製（備援站的設計流程不受影響）；頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
  }
  // ═══ CH24：現行 App 殼在看板上就請人更新；網頁、?demo=bounty、旗標關的行為一個字不變 ══════════════════════════════════
  // 現行 App 殼＝網頁包成的那一版（IS_NATIVE_APP 真）：伺服器只收新版原生 App 的錄程，這一版錄不了。判定只有一份（BOUNTY_APP_NEEDS_UPDATE：
  // 懸賞開著、不是 ?demo=bounty、IS_NATIVE_APP 真），看板副標、卡上的按鈕字、按鈕的點擊、開始錄製的提示四處共用。
  //   ・副標說這一版還不能接、更新到最新版才能接；每張可接的卡（含已接下的）按鈕字是「要更新 App 才能接」；已收滿的卡沒有按鈕、那一句也改成請更新（CH28）
  //   ・按下按鈕：先收起看板、吐司是 startBountyRecording 同一句；不送認領、不寫本機認領紀錄、不開說明卡
  //   ・網頁（兩個平台訊號都沒有）與 ?demo=bounty（含在 App 殼裡）的副標、按鈕字、點擊結果，與改之前完全相同；旗標關時兩個判定都是假
  if (want('CH24')) {
    const T24 = {
      'zh-TW': {
        subShell: '這些項目還沒有實測資料。這一版還不能接，要更新到最新版的軌島 App 才能接下來錄——現在可以先看看有哪些。',
        subWeb: '這些項目還沒有實測資料。用 App 才能接下來錄——網頁可以先看看有哪些。',
        subApp: '接一張、搭那班車時開錄，把沿途的速度剖面測出來。全部免費，合格的一趟可以得到籌碼，每天有上限。',
        subDemo: '示範資料，僅供確認設計：這裡的路段都是假的，接下來也不會真的錄。',
        btnShell: '要更新 App 才能接', btnWeb: '要用 App 才能接', btnTrack: '接下這段', btnDwell: '接下停站', btnLive: '已接下・看說明',
        update: '要錄程，請先把軌島 App 更新到最新版', webTake: 'GPS 校正旅程需要用 App。網頁可以看懸賞板與自己的成果',
        demoClaimed: '（示範）接下了・24 小時內有效', covered: '已收滿。這一版的軌島 App 還不能錄程，要更新到最新版才行。',
      },
      en: {
        subShell: 'These items don’t have real measurement data yet. This version can’t claim them — update the Rail Island app to the latest version to claim and record. For now, you can browse what’s available.',
        subWeb: 'These items don\'t have real measurement data yet. Use the app to claim and record — the website lets you browse what\'s available.',
        btnShell: 'Update the app to claim', btnWeb: 'Use the app to claim',
        update: 'To record a trip, please update the Rail Island app to the latest version.',
        webTake: 'GPS calibration journeys require the app. The website lets you view the bounty board and your own results.',
        covered: 'Fully covered. This version of the Rail Island app can’t record trips yet — update to the latest version to record.',
      },
      ja: {
        subShell: 'これらの項目にはまだ実測データがありません。このバージョンでは受け取れません。軌島アプリを最新版に更新すると、受け取って記録できます。今は内容を確認できます。',
        subWeb: 'これらの項目にはまだ実測データがありません。受け取って記録するにはアプリが必要です。ウェブ版では内容を確認できます。',
        btnShell: '受け取るにはアプリの更新が必要です', btnWeb: '受け取るにはアプリが必要です',
        update: '旅程を記録するには、軌島アプリを最新版に更新してください。',
        webTake: 'GPS校正旅程にはアプリが必要です。ウェブサイトでは懸賞板とご自身の成果を確認できます。',
        covered: '収集済みです。この版の軌島アプリではまだ記録できません。最新版に更新してください。',
      },
    };
    const KEY_B = 'trainmap-bounty-v1', KEY_BD = 'trainmap-bounty-demo-v1';
    const localeOf = lang => lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
    // 開看板（桌面走護照上的「懸賞板」鈕，同 boardSession）；回 { s, b }。arg：newSession 的參數；qs：網址後面接的（&demo=bounty）
    const openBoard24 = async (arg, { lang = 'zh-TW', qs = '', n = 3, board = BOARD_V2 } = {}) => {
      const s = await newSession(arg, {}, { ctx: { locale: localeOf(lang) } });
      s.board = board;
      await s.page.goto(`${BASE}/?${qs.includes('demo=bounty') ? '' : 'bounty=1&'}lang=${lang}${qs}`);
      if (qs.includes('demo=bounty')) await bootDone(s.page); else { await loggedIn(s.page); await chipsLoaded(s.page); }
      // 看板用頁面自己的入口開（比照 CH10m）：點護照上的鈕會讓整個文件捲動，之後吐司的位置跟著跑到視窗外，量不到「最上層」
      await s.page.evaluate(() => { openBountyBoard(); });
      await s.page.waitForFunction(k => document.querySelectorAll('#bountyList .bt-card').length >= k, n, { timeout: 15000 });
      return s;
    };
    const flags24 = page => page.evaluate(() => ({ flag: BOUNTY_ENABLED, native: IS_NATIVE_APP, demo: DEMO_AS_APP, update: typeof BOUNTY_APP_NEEDS_UPDATE === 'undefined' ? null : BOUNTY_APP_NEEDS_UPDATE }));
    const takeLabels = page => page.evaluate(() => [...document.querySelectorAll('#bountyList .bt-card')].map(c => ({ id: c.dataset.card, label: [...c.querySelectorAll('.bt-take')].map(b => b.textContent.trim()), covered: !!c.querySelector('.bt-covered'), text: c.textContent.replace(/\s+/g, ' ').trim() })));
    // 點卡上的按鈕之後的結果：看板還開不開、說明卡開不開、有沒有進入錄製、最上層是不是吐司、吐司的字
    const afterTake = async (s, how, sel) => {
      await s.page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
      if (how === 'tap') await s.page.tap(sel); else await s.page.click(sel);
      await s.page.waitForFunction(() => !!document.querySelector('#toasts .toast.show'), null, { timeout: 5000 }).catch(() => {});
      await sleep(450);
      return topIsToast(s.page);
    };
    // 現行 App 殼：三種語言各一輪
    for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH24-shell-${lang}`, async () => {
      const X = T24[lang];
      const s = await openBoard24({ app: true }, { lang });
      const f = await flags24(s.page), b = await readBoard(s.page), lab = await takeLabels(s.page);
      ok(`CH24a-${lang} [fixture] 現行 App 殼：懸賞旗標開、IS_NATIVE_APP 真、不是 ?demo=bounty；共用的判定 BOUNTY_APP_NEEDS_UPDATE 為真；看板 3 張卡`,
        f.flag === true && f.native === true && f.demo === false && f.update === true && b.cards.length === 3, JSON.stringify({ f, n: b.cards.length }));
      ok(`CH24b-${lang} 看板副標整句是「${X.subShell}」（這一版還不能接、更新到最新版才能接、現在可以先看看）；不是網頁那句、不是 App 那句`,
        b.sub === X.subShell && b.sub !== X.subWeb, b.sub);
      const open = lab.filter(c => !c.covered);
      ok(`CH24c-${lang} 每張可接的卡（${open.length} 張）按鈕字是「${X.btnShell}」；已收滿的卡沒有按鈕、那句改成「${X.covered}」（這一版錄不了程；網頁那句照舊由 CH28 驗）`,
        open.length === 2 && open.every(c => c.label.length === 1 && c.label[0] === X.btnShell) && lab.filter(c => c.covered).length === 1 && lab.filter(c => c.covered).every(c => c.label.length === 0 && c.text.includes(X.covered)), JSON.stringify(lab));
      // 已接下的卡也一樣（比照網頁不分）：用頁面自己的存取函式寫進一筆還沒過期的認領，再重畫
      await s.page.evaluate(id => { const bb = loadBounty(); bb.claims[id] = { cardId: id, claimId: 'seed', units: 1, points: 1, expiresAt: Date.now() + 86400000, u: userDataNow() }; saveBounty(bb); renderBountyBoard(); }, CARD_P.id);
      const lab2 = await takeLabels(s.page);
      const liveSeed = await s.page.evaluate(id => !!bountyLiveClaim(id), CARD_P.id);
      ok(`CH24d-${lang} [fixture] 本機有一筆還沒過期的認領（${CARD_P.id}）；已接下的卡按鈕字照樣是「${X.btnShell}」（不是「已接下・看說明」）`,
        liveSeed === true && lab2.filter(c => !c.covered).every(c => c.label.length === 1 && c.label[0] === X.btnShell), JSON.stringify(lab2));
      const before = await lsGet(s.page, KEY_B);
      const r = await afterTake(s, 'click', takeSel(CARD_R.id));
      const after = await lsGet(s.page, KEY_B);
      ok(`CH24e-${lang} 點可接的卡：看板收起來、「${X.update}」那一句在最上層（左／中／右三點的 elementFromPoint 都是這張提示）、整張卡在視窗內；沒有送認領（${s.claims.length} 發）、本機認領紀錄沒有變、說明卡沒開、沒有進入錄製`,
        !!r.toast && r.toast.text === X.update && r.toast.onTop && r.toast.inView && !r.toast.clipped && !r.boardOpen && !r.briefOpen && !r.recording && s.claims.length === 0 && before === after && before !== null,
        JSON.stringify({ r, claims: s.claims.length, same: before === after, hadRecord: before !== null }));
      await s.page.evaluate(() => openBountyBoard());
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 });
      const r2 = await afterTake(s, 'click', takeSel(CARD_P.id));
      const after2 = await lsGet(s.page, KEY_B);
      ok(`CH24f-${lang} 點已接下的卡：同樣收起看板、同一句提示、不送認領、不開說明卡、本機認領紀錄不變`,
        !!r2.toast && r2.toast.text === X.update && r2.toast.onTop && !r2.boardOpen && !r2.briefOpen && !r2.recording && s.claims.length === 0 && after2 === before, JSON.stringify({ r2, claims: s.claims.length, same: after2 === before }));
      ok(`CH24g-${lang} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 另一個平台訊號（只有 Capacitor.isNativePlatform() 回 true、沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE）單獨成立也算現行 App 殼
    await attempt('CH24-capacitor', async () => {
      const X = T24['zh-TW'];
      const s = await openBoard24({ capacitor: true }, {});
      const f = await flags24(s.page), b = await readBoard(s.page), lab = await takeLabels(s.page);
      const sig = await s.page.evaluate(() => ({ key: typeof window.RAIL_ONLINE_BASEMAPS_AVAILABLE !== 'undefined', cap: !!(window.Capacitor && window.Capacitor.isNativePlatform()) }));
      const r = await afterTake(s, 'click', takeSel(CARD_R.id));
      ok('CH24h 另一個平台訊號單獨成立（沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE、Capacitor.isNativePlatform() 回 true）：判定為真；副標、按鈕字、點擊結果與現行 App 殼相同（看板收起、提示是更新那句、沒有認領、沒開說明卡）',
        sig.key === false && sig.cap === true && f.update === true && b.sub === X.subShell && lab.filter(c => !c.covered).every(c => c.label[0] === X.btnShell) &&
          !!r.toast && r.toast.text === X.update && !r.boardOpen && !r.briefOpen && !r.recording && s.claims.length === 0 && s.errors.length === 0, JSON.stringify({ sig, f, sub: b.sub, r, claims: s.claims.length, errors: s.errors }));
      await s.ctx.close();
    });
    // 網頁（旗標開、兩個平台訊號都沒有）：副標、按鈕字、點擊結果與改之前完全相同
    for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH24-web-${lang}`, async () => {
      const X = T24[lang];
      const s = await openBoard24({}, { lang });
      const f = await flags24(s.page), b = await readBoard(s.page), lab = await takeLabels(s.page);
      const before = await lsGet(s.page, KEY_B);
      const r = await afterTake(s, 'click', takeSel(CARD_R.id));
      ok(`CH24i-${lang} 網頁（旗標開）：判定為假；副標整句仍是「${X.subWeb}」；每張可接的卡按鈕字仍是「${X.btnWeb}」；已收滿的卡沒有按鈕`,
        f.flag === true && f.native === false && f.demo === false && f.update === false && b.sub === X.subWeb &&
          lab.filter(c => !c.covered).length === 2 && lab.filter(c => !c.covered).every(c => c.label.length === 1 && c.label[0] === X.btnWeb) && lab.filter(c => c.covered).every(c => c.label.length === 0), JSON.stringify({ f, sub: b.sub, lab }));
      ok(`CH24j-${lang} 網頁點卡：看板收起、提示仍是「${X.webTake}」（不是更新那句）、在最上層；不送認領、不寫本機資料、不開說明卡、不進入錄製`,
        !!r.toast && r.toast.text === X.webTake && r.toast.text !== X.update && r.toast.onTop && !r.boardOpen && !r.briefOpen && !r.recording && s.claims.length === 0 && (await lsGet(s.page, KEY_B)) === before && s.errors.length === 0,
        JSON.stringify({ r, claims: s.claims.length, errors: s.errors }));
      await s.ctx.close();
    });
    // ?demo=bounty（網頁、與 App 殼裡）：備援站看設計的假資料流程，整條「接下 → 說明卡 → 開始錄製」照走；副標、按鈕字不變
    for (const [tag, arg] of [['web', {}], ['app', { app: true }]]) await attempt(`CH24-demo-${tag}`, async () => {
      const X = T24['zh-TW'];
      const s = await openBoard24(arg, { qs: '&demo=bounty', n: 5 });
      const f = await flags24(s.page), b = await readBoard(s.page), lab = await takeLabels(s.page);
      const ids = await s.page.evaluate(() => ({ dwell: (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id, track: (bountyBoardMem.cards.find(c => c.kind === 'track') || {}).id }));
      ok(`CH24k-${tag} ?demo=bounty${tag === 'app' ? '（App 殼裡）' : ''}：判定為假（備援站看設計的流程不被擋）；副標整句不變（示範那句＋接一張那句）；按鈕字是「${X.btnTrack}」「${X.btnDwell}」、沒有「${X.btnShell}」「${X.btnWeb}」`,
        f.flag === true && f.demo === true && f.update === false && f.native === (tag === 'app') && b.sub === X.subDemo + X.subApp &&
          lab.filter(c => !c.covered).length >= 4 && lab.filter(c => !c.covered).every(c => c.label.length === 1 && [X.btnTrack, X.btnDwell].includes(c.label[0])), JSON.stringify({ f, sub: b.sub, labels: lab.map(c => c.label) }));
      const before = await lsGet(s.page, KEY_BD);
      const r = await afterTake(s, 'click', takeSel(ids.dwell));
      const mid = await s.page.evaluate(() => ({ brief: !document.getElementById('bountyBriefModal').hidden, rec: !!state.recording }));
      const afterRaw = await lsGet(s.page, KEY_BD), after = JSON.parse(afterRaw || '{}');
      ok(`CH24l-${tag} ?demo=bounty 點停站卡：說明卡開了、提示是「${X.demoClaimed}」、本機（示範專用那把）多了一筆認領；沒有送認領請求（${s.claims.length} 發）；還沒有進入錄製`,
        mid.brief === true && mid.rec === false && !!r.toast && r.toast.text === X.demoClaimed && !!after.claims && !!after.claims[ids.dwell] && afterRaw !== before && s.claims.length === 0, JSON.stringify({ mid, toast: r.toast && r.toast.text, claims: s.claims.length, keys: Object.keys(after.claims || {}) }));
      await s.page.click('#bountyBriefGo');
      await s.page.waitForFunction(() => !!state.recording, null, { timeout: 15000 });
      ok(`CH24m-${tag} ?demo=bounty 說明卡按「開始錄製」照樣進入錄製（沒有被「請更新」擋下、提示裡沒有那一句）；頁面沒有未捕捉的例外`,
        (await s.page.evaluate(() => !!state.recording)) && !(await s.page.evaluate(upd => document.getElementById('toasts').textContent.includes(upd), X.update)) && s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 旗標關：判定恆假；同一個 App 殼、直接畫板子，副標與按鈕字與改之前相同（旗標關時沒有入口，這裡只驗兩個字串不被新判定動到）
    await attempt('CH24-off', async () => {
      const X = T24['zh-TW'];
      for (const [tag, arg, wantSub, wantBtn] of [['app', { app: true }, X.subApp, X.btnTrack], ['web', {}, X.subWeb, X.btnWeb]]) {
        const s = await newSession(arg, {}, { ctx: { locale: 'zh-TW' } });
        await s.page.goto(`${BASE}/?lang=zh-TW`);
        await bootDone(s.page);
        const out = await s.page.evaluate(card => {
          bountyBoardMem = { cards: [card] };
          renderBountyBoard();
          return { flag: BOUNTY_ENABLED, update: typeof BOUNTY_APP_NEEDS_UPDATE === 'undefined' ? null : BOUNTY_APP_NEEDS_UPDATE, sub: document.getElementById('bountySub').textContent.replace(/\s+/g, ' ').trim(),
            label: [...document.querySelectorAll('#bountyList .bt-take')].map(b => b.textContent.trim()) };
        }, CARD_OPEN);
        ok(`CH24n-${tag} 旗標關（${tag === 'app' ? 'App 殼' : '網頁'}）：判定為假；直接畫板子，副標「${wantSub.slice(0, 14)}…」與按鈕字「${wantBtn}」與改之前相同`,
          out.flag === false && out.update === false && out.sub === wantSub && out.label.length === 1 && out.label[0] === wantBtn && s.errors.length === 0, JSON.stringify(out));
        await s.ctx.close();
      }
    });
    // 手機：旗標開、現行 App 殼的看板與說明卡、?demo=bounty 的說明卡；360／375／414／768 × Chromium／WebKit。真觸控（isMobile＋hasTouch、page.tap）
    const MOBILE24 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      const X = T24['zh-TW'];
      const ctxOpts = { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
      // 一個元素有沒有被截掉：文字沒有溢出（scrollWidth／scrollHeight 不超過 client）、整個矩形在視窗左右邊之內
      const fits = (page, sel) => page.evaluate(q => [...document.querySelectorAll(q)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return { t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 16), wOver: e.scrollWidth > e.clientWidth + 1, hOver: e.scrollHeight > e.clientHeight + 1, inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0, ell: cs.textOverflow === 'ellipsis' };
      }), sel);
      const hs = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, box: (document.querySelector('#bountyModal .tk-box') || {}).scrollWidth - (document.querySelector('#bountyModal .tk-box') || {}).clientWidth }));
      // 說明卡裡合格那兩句：各自捲到畫面中央，整個矩形在說明卡的捲動區之內、字沒有溢出
      const qualify = page => page.evaluate(() => {
        const body = document.getElementById('bountyBriefBody');
        const lis = [...body.querySelectorAll('li')].filter(l => /合格的一趟要同時做到|沒達到門檻/.test(l.textContent));
        return lis.map(l => {
          l.scrollIntoView({ block: 'center' });
          const r = l.getBoundingClientRect(), c = body.getBoundingClientRect();
          return { t: l.textContent.replace(/\s+/g, ' ').trim().slice(0, 12), inBox: r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5, inView: r.left >= -0.5 && r.right <= innerWidth + 0.5, wOver: l.scrollWidth > l.clientWidth + 1 };
        });
      });
      // ① 現行 App 殼：看板（副標、按鈕字不被截、沒有水平捲動、按鈕 elementFromPoint 回到自己）→ 真觸控點按鈕 → 說明卡（直接開，這一版走不到）
      await attempt(`CH24-mobile-shell-${tag}`, async () => {
        const s = await newSession({ app: true }, {}, ctxOpts);
        s.board = BOARD_V2;
        await goBounty(s); await bootDone(s.page); await sleep(300);
        await s.page.evaluate(() => openBountyBoard());
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 3, null, { timeout: 15000 });
        await sleep(400);
        const sub = await fits(s.page, '#bountySub'), btn = await fits(s.page, '#bountyList .bt-take'), h = await hs(s.page);
        const reach = await s.page.evaluate(() => [...document.querySelectorAll('#bountyList .bt-take')].map(el => {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        }));
        ok(`CH24o-${tag} 現行 App 殼的看板（手機 ${width} 寬）：副標整句在、沒有被截掉（沒有溢出、在視窗內）；${btn.length} 顆按鈕字是「${X.btnShell}」、沒有被截掉；頁面與看板框沒有水平捲動；每顆按鈕的中心點 elementFromPoint 回到自己`,
          (await readBoard(s.page)).sub === X.subShell && sub.length === 1 && sub.every(x => !x.wOver && !x.hOver && x.inView && !x.ell) &&
            btn.length === 2 && btn.every(x => x.t === X.btnShell && !x.wOver && !x.hOver && x.inView && !x.ell) && h.doc <= 1 && h.box <= 1 && reach.length === 2 && reach.every(Boolean), JSON.stringify({ sub, btn, h, reach }));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-shell-board-${tag}.png`) });
        const before = await lsGet(s.page, KEY_B);
        const r = await afterTake(s, 'tap', takeSel(CARD_R.id));
        ok(`CH24p-${tag} 真觸控點按鈕：看板收起來、「${X.update}」在最上層（左／中／右三點的 elementFromPoint 都是這張提示）、整張卡在視窗內、字沒有被截掉；沒有送認領、本機認領紀錄沒變、說明卡沒開、沒有進入錄製`,
          !!r.toast && r.toast.text === X.update && r.toast.onTop && r.toast.inView && !r.toast.clipped && !r.boardOpen && !r.briefOpen && !r.recording && s.claims.length === 0 && (await lsGet(s.page, KEY_B)) === before, JSON.stringify({ r, claims: s.claims.length }));
        await s.page.evaluate(card => { document.getElementById('toasts').innerHTML = ''; showBountyBrief(card); }, CARD_R);
        await briefOpen(s.page);
        const q = await qualify(s.page), hb = await hs(s.page);
        ok(`CH24q-${tag} 現行 App 殼的說明卡（直接開；手機 ${width} 寬）：合格那兩句都在、各自捲到畫面中央時整個矩形在說明卡的捲動區內、字沒有溢出、不超出視窗左右邊；頁面沒有水平捲動`,
          q.length === 2 && q.every(x => x.inBox && x.inView && !x.wOver) && hb.doc <= 1, JSON.stringify({ q, hb }));
        ok(`CH24r-${tag} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
        await s.ctx.close();
      });
      // ② ?demo=bounty（網頁，備援站上手機看的就是這個）：真觸控點「接下」開說明卡，合格那兩句不被截掉
      await attempt(`CH24-mobile-demo-${tag}`, async () => {
        const s = await newSession({}, {}, ctxOpts);
        await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
        await bootDone(s.page); await sleep(300);
        await s.page.evaluate(() => openBountyBoard());
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
        await sleep(400);
        const sub = await fits(s.page, '#bountySub'), h = await hs(s.page);
        const dwell = await s.page.evaluate(() => (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id);
        await s.page.evaluate(id => document.querySelector(`#bountyList .bt-card[data-card="${id}"] .bt-take`).scrollIntoView({ block: 'center' }), dwell);
        await s.page.tap(takeSel(dwell));
        await briefOpen(s.page);
        const q = await qualify(s.page), hb = await hs(s.page);
        const claimed = await s.page.evaluate(id => !!(JSON.parse(localStorage.getItem('trainmap-bounty-demo-v1') || '{}').claims || {})[id], dwell);
        ok(`CH24s-${tag} ?demo=bounty（手機 ${width} 寬）：副標沒被截掉、沒有水平捲動；真觸控點「接下」→ 說明卡開了、本機（示範專用那把）多了這張卡的認領、沒有送認領請求；合格那兩句都在、不被截掉；說明卡沒有水平捲動`,
          sub.length === 1 && sub.every(x => !x.wOver && !x.hOver && x.inView) && h.doc <= 1 && !!dwell && claimed && s.claims.length === 0 &&
            q.length === 2 && q.every(x => x.inBox && x.inView && !x.wOver) && hb.doc <= 1, JSON.stringify({ sub, h, dwell, claimed, claims: s.claims.length, q, hb }));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-demo-brief-${tag}.png`) });
        ok(`CH24t-${tag} 頁面沒有未捕捉的例外`, s.errors.length === 0, JSON.stringify(s.errors));
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE24('chromium', browser, w);
    await attempt('CH24-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE24('webkit', wk, w);
    });
  }
  // ═══ CH25：停站卡的說明卡講清楚「怎麼錄才會達到籌碼門檻」 ═════════════════════════════════════════════════════════
  // 停站卡的籌碼與路段卡同一套規則：整趟（同一班車、同一條線）錄滿門檻才有。所以說明卡請人從前一站或更早就開始錄、一直錄到離開要錄的站；
  // 只在站上錄一小段，停站的資料照樣能用，只是湊不滿門檻、沒有籌碼。這一句的兩個門檻數字，與同一張卡上「合格的一趟」那句是同一份。
  // 規則檔讀不到、或門檻不是正數：只講怎麼錄，不寫數字、不提籌碼。
  // 期望值有兩種來源，都不呼叫 index.html 的函式：① 字面對照表（手算寫死）；
  //   ② 把畫面上的數字換回秒與公尺，必須不低於規則檔、多出來的不到一個進位單位，再丟進伺服器入帳用的純函式 tripChips。
  if (want('CH25')) {
    const CARD_D = { ...CARD_OPEN, id: 'card-dwell-open', kind: 'dwell', slot: 'peak', unitKeys: ['tra_sched|南迴線|加祿|加祿'], units: 1, points: 5 };
    const BOARD_D = { ...BOARD, cards: [CARD_D, CARD_R] };
    const U25 = {
      'zh-TW': { withNum: (t, d) => `從前一站或更早上車就開始錄，一直錄到離開要錄的站。整趟要錄滿 ${t}、在同一條線上移動 ${d} 才有籌碼；只通過、不停靠不算停站樣本。`,
        bare: '從前一站或更早上車就開始錄，一直錄到離開要錄的站；只通過、不停靠不算停站樣本。' },
      en: { withNum: (t, d) => `Start recording when you board at the previous station or earlier, and keep recording until you leave the station you’re recording. The whole trip needs at least ${t} of recording and at least ${d} of travel along the same line to earn chips; passing through without stopping doesn’t count as a dwell sample.`,
        bare: 'Start recording when you board at the previous station or earlier, and keep recording until you leave the station you’re recording; passing through without stopping doesn’t count as a dwell sample.' },
      ja: { withNum: (t, d) => `前の駅か、それより前で乗車したときから記録を始め、記録したい駅を出るまで続けてください。チップをもらうには、1回の乗車全体で ${t} 以上記録し、同じ路線上で ${d} 以上移動する必要があります。通過するだけで停車しない場合は、停車サンプルになりません。`,
        bare: '前の駅か、それより前で乗車したときから記録を始め、記録したい駅を出るまで続けてください。通過するだけで停車しない場合は、停車サンプルになりません。' },
    };
    const T25 = [   // 規則檔的秒數與公尺數 → 畫面上該出現的字（手算；進位只往上）
      { id: 'a', sec: 900, m: 2500, zh: ['15 分鐘', '2.5 公里'], en: ['15 min', '2.5 km'], ja: ['15分', '2.5km'], why: '整分鐘、2.5 公里' },
      { id: 'b', sec: 650, m: 1500, zh: ['11 分鐘', '1.5 公里'], en: ['11 min', '1.5 km'], ja: ['11分', '1.5km'], why: '650 秒＝10.83 分鐘，往上取 11（往下會是 10）' },
      { id: 'c', sec: 601, m: 1001, zh: ['11 分鐘', '1.1 公里'], en: ['11 min', '1.1 km'], ja: ['11分', '1.1km'], why: '只多 1 秒、多 1 公尺，各往上進一格' },
      { id: 'd', sec: 60, m: 999, zh: ['1 分鐘', '999 公尺'], en: ['1 min', '999 m'], ja: ['1分', '999m'], why: '剛好 1 分鐘；不到 1 公里寫公尺、不進位成 1 公里' },
      { id: 'e', sec: 1, m: 1, zh: ['1 分鐘', '1 公尺'], en: ['1 min', '1 m'], ja: ['1分', '1m'], why: '最小的正數也不會寫成 0' },
      { id: 'f', sec: 3600, m: 12345, zh: ['60 分鐘', '12.4 公里'], en: ['60 min', '12.4 km'], ja: ['60分', '12.4km'], why: '12.345 公里往上取 12.4（四捨五入會是 12.3）' },
    ];
    const BAD25 = [   // 規則檔讀到了、但門檻缺、不是正數、不是數字，或每趟不給籌碼；最後一列是連 chips 區塊都沒有
      ['沒有 minTripSec', { drop: 'minTripSec' }], ['沒有 minTripMoveM', { drop: 'minTripMoveM' }], ['minTripSec 是 0', { set: { minTripSec: 0 } }],
      ['minTripMoveM 是 0', { set: { minTripMoveM: 0 } }], ['minTripSec 是負數', { set: { minTripSec: -600 } }], ['minTripMoveM 不是數字', { set: { minTripMoveM: 'abc' } }],
      ['每趟 0 顆', { set: { perTrip: 0 } }], ['沒有 chips 區塊', { whole: true }],
    ];
    const dwellNums = text => {
      const m = text.match(/整趟要錄滿 ([\d.]+) 分鐘、在同一條線上移動 ([\d.]+) (公里|公尺) 才有籌碼/);
      if (!m) return null;
      const km = m[3] === '公里';
      return { sec: Math.round(Number(m[1]) * 60), m: km ? Math.round(Number(m[2]) * 10) * 100 : Math.round(Number(m[2])), km };
    };
    const qualNums = text => {
      const mt = text.match(/至少 ([\d.]+) 分鐘/), md = text.match(/至少移動 ([\d.]+) (公里|公尺)/);
      if (!mt || !md) return null;
      const km = md[2] === '公里';
      return { sec: Math.round(Number(mt[1]) * 60), m: km ? Math.round(Number(md[1]) * 10) * 100 : Math.round(Number(md[1])), km };
    };
    const rangeOk25 = (n, sec, m) => !!n && n.sec >= sec && n.sec - sec < 60 && n.m >= m && n.m - m < (n.km ? 100 : 1);
    const gets25 = (n, rules) => tripChips({ verdict: 'ok', lineKeys: ['none|x'], durationSec: n.sec, moveM: n.m, day: '2026-10-02' }, rules.chips);
    const chipsOf = o => { const c = { ...RULES.chips, ...(o.set || {}) }; if (o.drop) delete c[o.drop]; return c; };
    const sameNums = (a, b) => !!a && !!b && a.sec === b.sec && a.m === b.m;
    // 開某張卡的說明卡（直接呼叫，說明卡的內容與怎麼走到它無關），可先把規則檔記憶體換成指定內容；回第一節（這趟要做什麼）與整張卡的字
    const show25 = (page, cardId, over = null) => page.evaluate(({ id, over }) => {
      if (over) bountyRulesMem = over.whole ? { v: 1 } : { ...bountyRulesMem, chips: over.chips };
      showBountyBrief(bountyBoardMem.cards.find(c => c.id === id));
      const secs = [...document.querySelectorAll('#bountyBriefBody .bb-sec')];
      return { first: secs[0] ? secs[0].textContent.replace(/\s+/g, ' ').trim() : '', all: document.getElementById('bountyBriefBody').textContent.replace(/\s+/g, ' ').trim() };
    }, { id: cardId, over });
    const rulesIs = (page, rules) => page.evaluate(r => { const c = bountyRulesMem && bountyRulesMem.chips; return !!c && c.minTripSec === r.sec && c.minTripMoveM === r.m; }, { sec: rules.chips.minTripSec, m: rules.chips.minTripMoveM });
    // 從「從前一站或更早」那句的開頭，截到「不算停站樣本。」的結尾（含）：整句取出來，比對時不會被前後的句子混淆
    const sentenceOf = (text, lang) => {
      const head = { 'zh-TW': '從前一站或更早上車就開始錄', en: 'Start recording when you board', ja: '前の駅か、それより前で乗車したとき' }[lang];
      const tail = { 'zh-TW': '不算停站樣本。', en: 'doesn’t count as a dwell sample.', ja: '停車サンプルになりません。' }[lang];
      const a = text.indexOf(head), b = text.indexOf(tail);
      return a >= 0 && b > a ? text.slice(a, b + tail.length) : null;
    };

    await attempt('CH25-real', async () => {
      const s = await boardSession({}, { board: BOARD_D });
      const r = await show25(s.page, CARD_D.id);
      const dn = dwellNums(r.first), qn = qualNums(r.all);
      ok(`CH25a [fixture] 讀到的規則檔就是真的那份（${RULES.chips.minTripSec} 秒、${RULES.chips.minTripMoveM} 公尺）；開出來的是停站卡（第一節有「只通過、不停靠不算停站樣本」、有「平日尖峰・1 站」）`,
        (await rulesIs(s.page, RULES)) && r.first.includes('只通過、不停靠不算停站樣本') && r.first.includes('平日尖峰・1 站'), r.first);
      ok('CH25b 停站卡的說明卡有「從前一站或更早上車就開始錄，一直錄到離開要錄的站。整趟要錄滿 N 分鐘、在同一條線上移動 M 才有籌碼；只通過、不停靠不算停站樣本。」整句；' +
        '數字換回秒與公尺後不低於規則檔、多出的不到一個進位單位，達到它的那一趟伺服器給籌碼',
        !!sentenceOf(r.first, 'zh-TW') && !!dn && rangeOk25(dn, RULES.chips.minTripSec, RULES.chips.minTripMoveM) && gets25(dn, RULES) > 0, JSON.stringify({ sentence: sentenceOf(r.first, 'zh-TW'), dn }));
      ok('CH25c 同一張卡上，停站那句的兩個數字與「合格的一趟」那句的兩個數字一樣（同一份、不各算各的）；「錄到一半中斷沒關係」「合格的一趟要同時做到」「沒達到門檻」「即使這次的資料不能用」四句照在、依序出現在停站那句之後',
        sameNums(dn, qn) && ['從前一站或更早上車就開始錄', '錄到一半中斷沒關係', '合格的一趟要同時做到：', '沒達到門檻', '即使這次的資料不能用'].map(x => r.all.indexOf(x)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1])),
        JSON.stringify({ dn, qn }));
      ok('CH25d 舊的錄法說明（進站前就開始錄、列車停穩後繼續錄到出站）整張卡裡一個字都不在；停站那句不含「至少」（不跟「合格」那句搶同一個詞）',
        !r.all.includes('進站前就開始錄') && !r.all.includes('列車停穩後繼續錄到出站') && !(sentenceOf(r.first, 'zh-TW') || '至少').includes('至少'), r.all);
      ok('CH25e 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      // 對照：路段卡的錄法說明沒被動到，也沒有停站那句
      const t = await show25(s.page, CARD_R.id);
      ok('CH25f 路段卡（對照）：錄法說明還是「搭上那班車之後開始錄，到站就結束。」，沒有停站那句、沒有「整趟要錄滿」',
        t.first.includes('搭上那班車之後開始錄，到站就結束。') && !t.all.includes('從前一站或更早上車') && !t.all.includes('整趟要錄滿') && !t.all.includes('進站前就開始錄'), t.first);
      await s.ctx.close();
    });
    // 換一份規則檔、畫面跟著變（寫死的數字換一份就對不上）：把頁面自己讀規則檔的那個變數換成各種數字
    await attempt('CH25-table', async () => {
      const s = await boardSession({}, { board: BOARD_D });
      for (const row of T25) {
        const rules = { ...RULES, chips: { ...RULES.chips, minTripSec: row.sec, minTripMoveM: row.m } };
        const r = await show25(s.page, CARD_D.id, { chips: rules.chips });
        const dn = dwellNums(r.first), qn = qualNums(r.all);
        ok(`CH25g-${row.id} 規則檔 ${row.sec} 秒、${row.m} 公尺 → 停站那句是「${U25['zh-TW'].withNum(row.zh[0], row.zh[1])}」（${row.why}）；與「合格」那句同數字、換算回去不低於規則檔且達到的那一趟有籌碼`,
          r.first.includes(U25['zh-TW'].withNum(row.zh[0], row.zh[1])) && sameNums(dn, qn) && rangeOk25(dn, row.sec, row.m) && gets25(dn, rules) > 0, JSON.stringify({ sentence: sentenceOf(r.first, 'zh-TW'), dn, qn }));
      }
      // 規則檔讀到了、但門檻缺、不是正數、不是數字，或每趟不給籌碼：只講怎麼錄，整句不寫數字、不提籌碼；「合格」那兩句也不在
      const outs = [];
      for (const [label, o] of BAD25) {
        const r = await show25(s.page, CARD_D.id, o.whole ? { whole: true } : { chips: chipsOf(o) });
        const sen = sentenceOf(r.first, 'zh-TW');
        outs.push([label, sen === U25['zh-TW'].bare && !r.all.includes('整趟要錄滿') && !r.all.includes('才有籌碼') && !r.all.includes('合格的一趟要同時做到') && r.all.includes('錄到一半中斷沒關係') && r.all.includes('即使這次的資料不能用')]);
      }
      ok('CH25h 規則檔讀到了但門檻缺、是 0、是負數、不是數字、每趟不給籌碼、或連 chips 區塊都沒有：停站那句只剩「從前一站或更早上車就開始錄，一直錄到離開要錄的站；只通過、不停靠不算停站樣本。」，沒有數字、沒有「籌碼」；「合格」那兩句不在，中斷與承諾那兩句照在',
        outs.length === 8 && outs.every(x => x[1]), JSON.stringify(outs));
      ok('CH25i 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 規則檔讀不到（404）：說明卡照樣開、停站那句只講怎麼錄
    await attempt('CH25-404', async () => {
      const s = await boardSession({}, { rules: '404', board: BOARD_D });
      const r = await show25(s.page, CARD_D.id);
      ok('CH25j 規則檔讀不到：說明卡照樣開、停站那句只剩不帶數字、不提籌碼的那一句；沒有「合格」那兩句與獎勵句（顆籌碼）；期限、中斷、承諾那幾句照在；頁面沒有未捕捉的例外',
        sentenceOf(r.first, 'zh-TW') === U25['zh-TW'].bare && !r.all.includes('籌碼') && !r.all.includes('合格的一趟要同時做到') && r.all.includes('錄到一半中斷沒關係') && r.all.includes('接下的卡 24 小時內有效。') &&
          r.all.includes('即使這次的資料不能用') && s.errors.length === 0, r.first);
      await s.ctx.close();
    });
    // 英文、日文介面：整句（含數字與單位）對得上；英文整句沒有漏出中文、日文整句沒有中文原句；規則檔缺的時候是不帶數字的那一句
    for (const lang of ['en', 'ja']) await attempt(`CH25-${lang}`, async () => {
      const row = T25[0], U = U25[lang];
      const rules = { ...RULES, chips: { ...RULES.chips, minTripSec: row.sec, minTripMoveM: row.m } };
      const s = await boardSession({}, { board: BOARD_D, lang, rules });
      const r = await show25(s.page, CARD_D.id);
      const sen = sentenceOf(r.first, lang);
      const b = await show25(s.page, CARD_D.id, { whole: true });
      const senBare = sentenceOf(b.first, lang);
      ok(`CH25k-${lang} ${lang} 介面：規則檔 ${row.sec} 秒、${row.m} 公尺 → 整句是「${U.withNum(row[lang][0], row[lang][1]).slice(0, 60)}…」；整句裡沒有中文原句` + (lang === 'en' ? '、沒有任何中文字' : ''),
        sen === U.withNum(row[lang][0], row[lang][1]) && !sen.includes('從前一站') && !sen.includes('才有籌碼') && (lang !== 'en' || !/[㐀-鿿]/.test(sen)), JSON.stringify({ sen }));
      ok(`CH25l-${lang} ${lang} 介面：規則檔缺時整句是不帶數字、不提籌碼的那一句；頁面沒有未捕捉的例外`,
        senBare === U.bare && !/chip|チップ|\d/.test(senBare) && s.errors.length === 0, JSON.stringify({ senBare, errors: s.errors }));
      await s.ctx.close();
    });
    // ?demo=bounty（網頁，備援站上手機看的就是這個）：真的點「接下」開出的停站卡，也有這一句，數字與「合格」那句一樣
    await attempt('CH25-demo', async () => {
      const s = await newSession({ app: false }, {}, { ctx: { locale: 'zh-TW' } });
      await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
      await bootDone(s.page);
      await s.page.click('#passport [data-act="bountyboard"]');
      await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
      const dwell = await s.page.evaluate(() => (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id);
      await s.page.click(takeSel(dwell));
      await briefOpen(s.page);
      const r = await readBrief(s.page).then(x => ({ all: x.text }));
      const dn = dwellNums(r.all), qn = qualNums(r.all);
      ok('CH25m ?demo=bounty（停站卡）：真的點「接下」開出的說明卡有停站那一句，數字不低於規則檔、與「合格」那句同數字；舊的錄法說明不在；頁面沒有未捕捉的例外',
        !!dwell && !!sentenceOf(r.all, 'zh-TW') && rangeOk25(dn, RULES.chips.minTripSec, RULES.chips.minTripMoveM) && sameNums(dn, qn) && !r.all.includes('進站前就開始錄') && s.errors.length === 0, JSON.stringify({ dwell, dn, qn }));
      await s.ctx.close();
    });
    // 手機：?demo=bounty 的停站卡，360／375／414／768 × Chromium／WebKit；真觸控點「接下」。停站那句整句都在說明卡的捲動區之內、沒被截、沒有水平捲動
    const MOBILE25 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      await attempt(`CH25-mobile-${tag}`, async () => {
        const s = await newSession({}, {}, { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        await s.page.goto(`${BASE}/?lang=zh-TW&demo=bounty`);
        await bootDone(s.page); await sleep(300);
        await s.page.evaluate(() => openBountyBoard());
        await s.page.waitForFunction(() => document.querySelectorAll('#bountyList .bt-card').length >= 5, null, { timeout: 15000 });
        await sleep(400);
        const dwell = await s.page.evaluate(() => (bountyBoardMem.cards.find(c => c.kind === 'dwell') || {}).id);
        await s.page.evaluate(id => document.querySelector(`#bountyList .bt-card[data-card="${id}"] .bt-take`).scrollIntoView({ block: 'center' }), dwell);
        await s.page.tap(takeSel(dwell));
        await briefOpen(s.page);
        const m = await s.page.evaluate(() => {
          const body = document.getElementById('bountyBriefBody');
          const p = [...body.querySelectorAll('.bb-sec p')].find(x => x.textContent.includes('從前一站或更早上車就開始錄'));
          if (!p) return null;
          p.scrollIntoView({ block: 'center' });
          const r = p.getBoundingClientRect(), c = body.getBoundingClientRect();
          return { text: p.textContent.replace(/\s+/g, ' ').trim(), inBox: r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5,
            inView: r.left >= -0.5 && r.right <= innerWidth + 0.5, wOver: p.scrollWidth > p.clientWidth + 1, doc: document.documentElement.scrollWidth - innerWidth };
        });
        ok(`CH25n-${tag} ?demo=bounty（手機 ${width} 寬）真觸控點「接下」：停站那一句整句在說明卡的捲動區之內、沒溢出、沒被截、頁面沒有水平捲動；頁面沒有未捕捉的例外`,
          !!m && /整趟要錄滿 [\d.]+ 分鐘、在同一條線上移動 [\d.]+ (公里|公尺) 才有籌碼；只通過、不停靠不算停站樣本。/.test(m.text) && m.inBox && m.inView && !m.wOver && m.doc <= 1 && s.errors.length === 0, JSON.stringify({ m, errors: s.errors }));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-dwell-brief-${tag}.png`) });
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE25('chromium', browser, w);
    await attempt('CH25-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE25('webkit', wk, w);
    });
  }
  // ═══ CH26：護照的校正貢獻——只錄過停站卡的人也有校正者章 ═══════════════════════════════════════════════════════════
  // bounty-me 的回應新增 dwellStops（停站記錄涵蓋的不同站數，只增不改；corrected.segs 與 lines[].segs 仍然只算路段）。
  // 護照拿它判斷有沒有章：路段數或停站數有一個大於 0，就不是空狀態。只有停站記錄時：數字那一行寫「校正停站 N 站」、不畫逐線的「0 段」，
  // 原因說明（為什麼不能用、怎麼改善）照給。有路段的人（只有路段、路段加停站）畫面一個字都不變；舊版回應沒有這個欄位時，畫面與以前一樣。
  // 三句「章還是你的」的承諾改成「錄得夠完整」才成立（只錄到一小段、沒有覆蓋段的那一批不留章）。
  if (want('CH26')) {
    const WHY = { code: 'acc_blocked', title: '訊號被遮蔽了', how: '手機放在包包裡或車廂中央會擋住訊號，靠窗會好很多' };
    const trip26 = (id, verdict, quality = null) => ({ id, tripDate: '2026-10-01', trainNo: String(100 + id), sys: 'tra_sched', lnId: '南迴線', verdict, quality });
    const ME_D = { actor: 'x', points: 0, corrected: { segs: 0, adopted: 0 }, dwellStops: 3, lines: [{ sys: 'tra_sched', lnId: '南迴線', segs: 0, adopted: 0 }], firsts: [], trips: [trip26(1, 'unusable', WHY), trip26(2, 'ok')] };
    const ME_SEG = { ...ME, trips: [trip26(3, 'unusable', WHY)] };                                                // 只有路段（沒有 dwellStops 欄位）：12 段、採用 9
    const ME_NONE = { actor: 'x', points: 0, corrected: { segs: 0, adopted: 0 }, lines: [], firsts: [], trips: [] };   // 什麼都沒有
    const readCorr = page => page.evaluate(() => {
      const el = document.querySelector('#passport .ph-correct');
      if (!el) return null;
      return { html: el.innerHTML, text: el.textContent.replace(/\s+/g, ' ').trim(), empty: !!el.querySelector('.ph-empty'),
        nums: (el.querySelector('.corr-nums') || {}).textContent ? el.querySelector('.corr-nums').textContent.replace(/\s+/g, ' ').trim() : null,
        wall: !!el.querySelector('.seal-wall'), chips: [...el.querySelectorAll('.corr-line small')].map(x => x.textContent.trim()),
        why: [...el.querySelectorAll('.corr-why')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), injected: el.querySelectorAll('img, script, [onerror]').length };
    });
    // 在同一個頁面把「我的成果」記憶體換成指定的回應、重畫護照再讀（網路那一段由各組開頭的真請求驗，這裡只換輸入）
    const setMe = (page, me) => page.evaluate(m => { bountyMeMem = m; renderPassport(); }, me).then(() => readCorr(page));
    const meReady = page => page.waitForFunction(() => { try { return bountyMeMem !== null; } catch (e) { return false; } }, null, { timeout: 30000 });
    const PL26 = { 'zh-TW': /我們|咱們|我方/, en: /\b(?:we|us|our|ours|ourselves)\b/i, ja: /私たち|私達|我々|わたしたち|弊社|当社|当方|私ども|私共/ };   // 與 CH21 同一份
    const L26 = {
      'zh-TW': { nums: n => `校正停站 ${n} 站`, empty: '錄得夠完整就有校正者章', segs: '校正 12 段', tip: '只要錄得夠完整，校正者章還是你的' },
      en: { nums: n => n === 1 ? 'Calibrated 1 dwell stop' : `Calibrated ${n} dwell stops`, empty: 'Record enough of a trip to earn the calibrator stamp', segs: 'Calibrated 12 segments', tip: 'as long as you recorded enough of the trip you keep the calibrator stamp' },
      ja: { nums: n => `${n}駅の停車を校正`, empty: '十分に記録できると校正者スタンプがもらえます', segs: '12区間を校正', tip: '十分に記録できていれば、校正者スタンプはあなたのものです' },
    };

    await attempt('CH26-dwell-only', async () => {
      const s = await boardSession({ app: false }, { me: ME_D });   // 網頁殼：空狀態寫的是「錄得夠完整就有章」（現行 App 殼寫請更新，由 CH27 驗）
      await meReady(s.page);
      await s.page.evaluate(() => renderPassport());
      const c = await readCorr(s.page);
      ok('CH26a [fixture] 這個頁面的「我的成果」讀進來的是只有停站的那一份（路段 0、停站 3 站）——真的走了 bounty-me 的請求',
        await s.page.evaluate(() => bountyMeMem && bountyMeMem.corrected.segs === 0 && bountyMeMem.dwellStops === 3), JSON.stringify(c && c.text));
      ok('CH26b 只錄過停站卡的人：護照校正貢獻不是空狀態（有章）；數字那一行是「校正停站 3 站」；沒有逐線的「0 段」、沒有「校正 0 段」；為什麼不能用與怎麼改善照給（訊號被遮蔽了＋靠窗那句）；沒有空狀態那句承諾',
        !!c && !c.empty && c.nums === L26['zh-TW'].nums(3) && !c.wall && c.chips.length === 0 && !/0 段/.test(c.text) && c.why.length === 1 && c.why[0].includes('訊號被遮蔽了') && c.why[0].includes('靠窗會好很多') && !c.text.includes('錄得夠完整就有校正者章'),
        JSON.stringify(c));
      // 對照：同一個頁面把停站數改成 0、或整個欄位不給（舊版 Worker）→ 回到空狀態：章是這個新欄位換來的
      const zero = await setMe(s.page, { ...ME_D, dwellStops: 0 });
      const absent = await setMe(s.page, (() => { const m = { ...ME_D }; delete m.dwellStops; return m; })());
      const none = await setMe(s.page, ME_NONE);
      ok('CH26c 對照（網頁殼）：同一份回應把 dwellStops 改成 0、或拿掉這個欄位（舊版 Worker）、或本來就什麼都沒有：護照回到空狀態（有「錄得夠完整就有校正者章」那句）、沒有數字那一行；三種畫面完全相同',
        [zero, absent, none].every(x => x && x.empty && x.nums === null && x.text.includes(L26['zh-TW'].empty)) && zero.html === absent.html && absent.html === none.html, JSON.stringify({ zero: zero && zero.text, absent: absent && absent.text, none: none && none.text }));
      ok('CH26d 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 有路段的人：畫面一個字都不變
    await attempt('CH26-segments', async () => {
      const s = await boardSession({}, { me: ME_SEG });
      await meReady(s.page);
      const base = await setMe(s.page, ME_SEG);
      const with0 = await setMe(s.page, { ...ME_SEG, dwellStops: 0 });
      const with5 = await setMe(s.page, { ...ME_SEG, dwellStops: 5 });
      ok('CH26e [fixture] 有路段的那一份（12 段、採用 9、南迴線 8 段）：護照畫出「校正 12 段（其中 9 段已採用）」、逐線的章、「8 段」、原因說明一則——不是空狀態',
        !!base && !base.empty && base.nums === '校正 12 段（其中 9 段已採用）' && base.wall && base.chips.includes('8 段') && base.why.length === 1, JSON.stringify({ nums: base && base.nums, chips: base && base.chips }));
      ok('CH26f 只有路段：回應沒有 dwellStops、dwellStops 是 0、dwellStops 是 5（路段加停站），三種畫面完全相同（innerHTML 全等）；停站數只決定「有沒有章」，不改有路段的人的任何一個字',
        base.html === with0.html && with0.html === with5.html && base.html.length > 100, JSON.stringify({ n: [base.html.length, with0.html.length, with5.html.length] }));
      // 路段加停站、而且停站在別的線上：lines 裡有 0 段的那一條照舊畫（這是舊行為，不屬於這次的改動）
      const mixed = await setMe(s.page, { ...ME_SEG, dwellStops: 2, lines: [...ME_SEG.lines, { sys: 'tra_sched', lnId: '屏東線', segs: 0, adopted: 0 }] });
      const mixedOld = await setMe(s.page, { ...ME_SEG, lines: [...ME_SEG.lines, { sys: 'tra_sched', lnId: '屏東線', segs: 0, adopted: 0 }] });
      ok('CH26g 路段加停站、停站那條線的段數是 0（在 lines 裡照舊畫一枚「0 段」）：加了 dwellStops 與沒加，畫面完全相同', mixed.html === mixedOld.html && mixed.chips.includes('0 段'), JSON.stringify({ chips: mixed.chips }));
      ok('CH26h 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 亂值：dwellStops 不是有限整數時，不會長出章、也不會把字串當 HTML 執行
    await attempt('CH26-garbage', async () => {
      const s = await boardSession({}, { me: ME_NONE });
      await meReady(s.page);
      const CASES = [['abc', null], [-3, null], [null, null], [undefined, null], ['<img src=x onerror=window.__x=1>', null], [1e9, null], [{}, null], [[], null], ['7', 7], [3.9, 3]];
      const outs = [];
      for (const [v, exp] of CASES) {
        const c = await setMe(s.page, { ...ME_NONE, dwellStops: v });
        const x = await s.page.evaluate(() => window.__x || null);
        outs.push([JSON.stringify(v), exp === null ? (!!c && c.empty && c.nums === null) : (!!c && !c.empty && c.nums === L26['zh-TW'].nums(exp)), c && c.injected === 0 && x === null]);
      }
      ok('CH26i dwellStops 是字串、負數、null、不給、含標籤的字串、超大、物件、陣列：都是空狀態、沒有長出 img／script／onerror、沒有執行；數字字串 "7" 收斂成 7 站、3.9 收斂成 3 站（與其他欄位同一個 bountyNum）',
        outs.every(o => o[1] && o[2]), JSON.stringify(outs));
      ok('CH26j 頁面沒有未捕捉的例外', s.errors.length === 0, JSON.stringify(s.errors));
      await s.ctx.close();
    });
    // 英文、日文：停站那一行、空狀態、說明中心的承諾句
    for (const lang of ['en', 'ja']) await attempt(`CH26-${lang}`, async () => {
      const s = await boardSession({ app: false }, { lang, me: ME_D });   // 網頁殼，理由同上
      await meReady(s.page);
      await s.page.evaluate(() => renderPassport());
      const X = L26[lang];
      const c = await readCorr(s.page);
      const one = await setMe(s.page, { ...ME_D, dwellStops: 1 });
      const none = await setMe(s.page, ME_NONE);
      await s.page.evaluate(() => openHelp('bountyme'));
      const tip = await s.page.evaluate(() => { const e = document.querySelector('#helpBody .help-sec[data-sec="bountyme"] .tip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
      ok(`CH26k-${lang} ${lang} 介面：只有停站的人，數字那一行是「${X.nums(3)}」、一站時是「${X.nums(1)}」；原因說明有翻譯` + (lang === 'en' ? '；整節沒有任何中文字' : ''),
        !!c && c.nums === X.nums(3) && one.nums === X.nums(1) && c.why.length === 1 && (lang !== 'en' || (!/[㐀-鿿]/.test(c.text) && !/[㐀-鿿]/.test(one.text))), JSON.stringify({ nums: c && c.nums, one: one && one.nums, why: c && c.why }));
      ok(`CH26o-${lang} ${lang} 介面（網頁殼）：空狀態那句承諾沒有提點數、沒有第一人稱複數（這兩條原本由 CH16j、CH21c 在 App 殼裡驗，現在那裡寫的是請更新那句）`,
        !!none && none.empty && !POINTS_RE_I18N.test(none.text) && !POINT_MARKS.test(none.text) && !PL26[lang].test(none.text), JSON.stringify(none && none.text));
      ok(`CH26l-${lang} ${lang} 介面（網頁殼）：空狀態那句承諾是「${X.empty}…」、說明中心「護照裡的校正貢獻」那則有「${X.tip}」；頁面沒有未捕捉的例外`,
        !!none && none.empty && none.text.includes(X.empty) && tip !== null && tip.includes(X.tip) && s.errors.length === 0, JSON.stringify({ none: none && none.text, tip, errors: s.errors }));
      await s.ctx.close();
    });
    // 繁中的說明中心與空狀態：新的承諾句
    await attempt('CH26-zh-copy', async () => {
      const s = await boardSession({ app: false }, { me: ME_NONE });   // 網頁殼
      await meReady(s.page);
      await s.page.evaluate(() => renderPassport());
      const noneZh = await readCorr(s.page);
      ok('CH26o-zh-TW 繁中（網頁殼）：空狀態那句承諾沒有提點數、沒有第一人稱複數；有「錄得夠完整就有校正者章」（這兩條原本由 CH16j、CH21c 在 App 殼裡驗，現在那裡寫的是請更新那句）',
        !!noneZh && noneZh.empty && noneZh.text.includes('錄得夠完整就有校正者章') && !POINTS_RE.test(noneZh.text) && !POINT_MARKS.test(noneZh.text) && !PL26['zh-TW'].test(noneZh.text), JSON.stringify(noneZh && noneZh.text));
      await s.page.evaluate(() => openHelp('bountyme'));
      const tip = await s.page.evaluate(() => { const e = document.querySelector('#helpBody .help-sec[data-sec="bountyme"] .tip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
      ok('CH26m 繁中：說明中心「護照裡的校正貢獻」那則寫「但只要錄得夠完整，校正者章還是你的」、舊的寫法（沒有條件）不在', tip !== null && tip.includes('但只要錄得夠完整，校正者章還是你的') && !tip.includes('但校正者章還是你的'), String(tip));
      await s.ctx.close();
    });
    // 手機：只有停站的護照，360／375／414／768 × Chromium／WebKit；真觸控進「護照」分頁、點開「校正貢獻」這一節
    const MOBILE26 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      await attempt(`CH26-mobile-${tag}`, async () => {
        const s = await newSession({ passportClosed: true, app: true }, {}, { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        s.board = BOARD_V2; s.meBody = ME_D;
        await goBounty(s); await loggedIn(s.page); await chipsLoaded(s.page); await meReady(s.page); await sleep(300);
        await s.page.tap('#tabRide');
        await s.page.waitForFunction(() => { const p = document.getElementById('ridePanel'); return p && !p.hidden && p.querySelector('.ph-sec[data-sec="correct"]'); }, null, { timeout: 15000 });
        await s.page.evaluate(() => document.querySelector('#ridePanel .ph-sec[data-sec="correct"]').scrollIntoView({ block: 'center' }));
        await sleep(300);
        const wasClosed = await s.page.evaluate(() => document.querySelector('#ridePanel .ph-sec[data-sec="correct"]').classList.contains('closed'));
        if (wasClosed) { await s.page.tap('#ridePanel .ph-sec[data-sec="correct"] .ph-caret'); await sleep(300); }
        const m = await s.page.evaluate(() => {
          const root = document.querySelector('#ridePanel .ph-correct');
          if (!root) return null;
          root.scrollIntoView({ block: 'center' });
          const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && r.width > 0 && r.height > 0; };
          const box = [...root.querySelectorAll('.corr-nums, .corr-why')].map(e => {
            const r = e.getBoundingClientRect(), x = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2, hit = document.elementFromPoint(x, y);
            return { cls: e.className, t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 14), vis: vis(e), inView: r.left >= -0.5 && r.right <= innerWidth + 0.5, wOver: e.scrollWidth > e.clientWidth + 1, hOver: e.scrollHeight > e.clientHeight + 1, reach: !!hit && (hit === e || e.contains(hit)) };
          });
          return { box, text: root.textContent.replace(/\s+/g, ' ').trim(), doc: document.documentElement.scrollWidth - innerWidth, empty: !!root.querySelector('.ph-empty') };
        });
        ok(`CH26n-${tag} 手機 ${width} 寬、只有停站的護照（真觸控進「護照」、點開「校正貢獻」）：「校正停站 3 站」與原因說明都看得到、沒被截、沒溢出、點得到（elementFromPoint 回到自己）、頁面沒有水平捲動；不是空狀態；頁面沒有未捕捉的例外`,
          !!m && !m.empty && m.box.length === 2 && m.box.every(b => b.vis && b.inView && !b.wOver && !b.hOver && b.reach) && m.text.includes('校正停站 3 站') && m.doc <= 1 && s.errors.length === 0, JSON.stringify({ m, errors: s.errors }));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-passport-dwell-${tag}.png`) });
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE26('chromium', browser, w);
    await attempt('CH26-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE26('webkit', wk, w);
    });
  }
  // ═══ CH27：現行 App 殼剩下三個還在教人錄程的地方——說明中心、護照空狀態、開機接回錄製 ═══════════════════════════════════
  // 現行 App 殼（BOUNTY_APP_NEEDS_UPDATE：懸賞開著、不是 ?demo=bounty、IS_NATIVE_APP 真）錄不了程。看板與開始錄製的提示已經請人更新，
  // 這一組驗剩下的三處也讀同一個判定：
  //   ・說明中心「懸賞板」「錄一趟校正旅程」兩節：不再教怎麼接、怎麼錄，改請人更新（懸賞板那節留第一步，看板現在還可以看）
  //   ・護照校正貢獻的空狀態：不許諾「錄就有章」，改請人更新
  //   ・開機接回錄製：不接回舊的錄製、不開始取樣；裝置上保存的那一筆不碰
  // 網頁、?demo=bounty（含在 App 殼裡）、旗標關：一個字不變。每一處都有「判定不成立」的對照組。
  if (want('CH27')) {
    const O27 = {   // 沒改之前的兩節（網頁與 ?demo=bounty 照舊）
      bountySteps: ['打開「護照」，在「校正貢獻」那一列按「懸賞板」', '挑一段你本來就要搭的', '按下去接下來，出發前會有一張說明卡告訴你要準備什麼'],
      bountyTip: '接下來的段 24 小時內有效，過期會放回板上給別人。看板不用 App，實際錄製要用 App。',
      recSteps: ['先在懸賞板接一段', '真的搭上那班車之後，按說明卡的「開始錄製」', '錄製畫面上的燈號保持綠色就好——手機靠窗，別放在包包裡或車廂中央', '到站按「停止錄製」'],
      recTipHead: '燈號變橘色會直接告訴你怎麼改善',
    };
    const U27 = {
      'zh-TW': { bountyTip: '這一版的軌島 App 還不能接下來錄，要更新到最新版才行；懸賞板現在可以先看。', recTip: '這一版的軌島 App 還不能錄程，要更新到最新版才行。', empty: '這一版的軌島 App 還不能錄程，要更新到最新版才行。', promise: '錄得夠完整就有校正者章' },
      en: { bountyTip: 'This version of the Rail Island app can’t claim and record yet — update to the latest version to do that. You can still browse the bounty board.', recTip: 'This version of the Rail Island app can’t record trips yet — update to the latest version to record.', empty: 'This version of the Rail Island app can’t record trips yet — update to the latest version to record.', promise: 'Record enough of a trip to earn the calibrator stamp' },
      ja: { bountyTip: 'この版の軌島アプリではまだ受け取って記録できません。最新版に更新してください。懸賞板は今も見られます。', recTip: 'この版の軌島アプリではまだ記録できません。最新版に更新してください。', empty: 'この版の軌島アプリではまだ記録できません。最新版に更新してください。', promise: '十分に記録できると校正者スタンプがもらえます' },
    };
    const TEACH = /開始錄製|按說明卡|24 小時內有效|燈號|停止錄製|出發前會有一張說明卡|Start recording|start recording|24 hours|signal light|開始|記録を開始/;
    const ME_NONE27 = { actor: 'x', points: 0, corrected: { segs: 0, adopted: 0 }, lines: [], firsts: [], trips: [] };   // 什麼校正記錄都沒有
    const readHelp27 = page => page.evaluate(() => {
      openHelp('bountyme');
      const out = {};
      for (const el of document.querySelectorAll('#helpBody .help-sec')) {
        const tip = el.querySelector('.tip');
        out[el.dataset.sec] = { text: el.textContent.replace(/\s+/g, ' ').trim(), one: (el.querySelector('.one') || {}).textContent || '', steps: [...el.querySelectorAll('ol li')].map(x => x.textContent.trim()),
          tip: tip ? tip.textContent.replace(/\s+/g, ' ').trim() : null, tryBtn: !!el.querySelector('.help-try'), badge: (el.querySelector('.help-badge') || {}).textContent || null };
      }
      return out;
    });
    const readEmpty27 = page => page.evaluate(() => { renderPassport(); const e = document.querySelector('#passport .ph-correct .ph-empty'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
    const sess27 = async (kind, lang = 'zh-TW', me = ME_NONE27) => {
      const locale = lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
      const s = await newSession({ app: kind !== 'web' }, {}, { ctx: { locale } });
      s.meBody = me;
      const qs = kind === 'demo' ? `lang=${lang}&demo=bounty` : kind === 'off' ? `lang=${lang}` : `bounty=1&lang=${lang}`;
      await s.page.goto(`${BASE}/?${qs}`);
      await bootDone(s.page); await sleep(300);
      return s;
    };

    await attempt('CH27-help-zh', async () => {
      const shell = await sess27('shell'), web = await sess27('web'), demo = await sess27('demo'), off = await sess27('off');
      const hs = await readHelp27(shell.page), hw = await readHelp27(web.page), hd = await readHelp27(demo.page), ho = await readHelp27(off.page);
      const X = U27['zh-TW'];
      ok('CH27a 現行 App 殼：說明中心「懸賞板」只留第一步（打開護照按懸賞板）、小提示改成「這一版還不能接下來錄，要更新到最新版才行；懸賞板現在可以先看」、「試一次」（開看板）還在；整節沒有教怎麼接、怎麼錄的字',
        !!hs.bounty && JSON.stringify(hs.bounty.steps) === JSON.stringify(O27.bountySteps.slice(0, 1)) && hs.bounty.tip === X.bountyTip && hs.bounty.tryBtn && hs.bounty.one.includes('缺哪一段就掛在懸賞板上') && !TEACH.test(hs.bounty.text), JSON.stringify(hs.bounty));
      ok('CH27b 現行 App 殼：說明中心「錄一趟校正旅程」沒有步驟、小提示是「這一版的軌島 App 還不能錄程，要更新到最新版才行。」、沒有「試一次」、角標「App」還在；整節沒有教怎麼錄的字（開始錄製、燈號、停止錄製、24 小時）',
        !!hs.bountyrec && hs.bountyrec.steps.length === 0 && hs.bountyrec.tip === X.recTip && !hs.bountyrec.tryBtn && hs.bountyrec.badge === 'App' && !TEACH.test(hs.bountyrec.text), JSON.stringify(hs.bountyrec));
      ok('CH27c 對照（網頁）：兩節都跟改之前一個字不變——「懸賞板」三步＋原小提示＋「試一次」；「錄一趟校正旅程」整節不出現（網頁沒有它，與以前一樣）',
        !!hw.bounty && JSON.stringify(hw.bounty.steps) === JSON.stringify(O27.bountySteps) && hw.bounty.tip === O27.bountyTip && hw.bounty.tryBtn && !hw.bountyrec, JSON.stringify({ bounty: hw.bounty, rec: !!hw.bountyrec }));
      ok('CH27d 對照（?demo=bounty，含在 App 殼裡）：兩節都跟改之前一個字不變——「懸賞板」三步＋原小提示、「錄一趟校正旅程」四步＋原小提示（以「燈號變橘色會直接告訴你怎麼改善」開頭）＋「試一次」',
        !!hd.bounty && JSON.stringify(hd.bounty.steps) === JSON.stringify(O27.bountySteps) && hd.bounty.tip === O27.bountyTip && !!hd.bountyrec && JSON.stringify(hd.bountyrec.steps) === JSON.stringify(O27.recSteps) &&
          hd.bountyrec.tip.startsWith(O27.recTipHead) && hd.bountyrec.tryBtn, JSON.stringify({ bounty: hd.bounty && hd.bounty.steps.length, rec: hd.bountyrec && hd.bountyrec.steps.length }));
      ok('CH27e 對照（旗標關、App 殼）：三節（懸賞板、錄一趟校正旅程、護照裡的校正貢獻）都不出現；同一頁的另一節（車站收集章）照在——說明中心不是整個壞掉',
        !ho.bounty && !ho.bountyrec && !ho.bountyme && !!ho.stncollect, JSON.stringify(Object.keys(ho)));
      ok('CH27f 護照裡的校正貢獻那一節（三種有它的情境）不受影響：現行 App 殼、網頁、?demo=bounty 的小提示都有新的承諾句「但只要錄得夠完整，校正者章還是你的」',
        [hs, hw, hd].every(h => !!h.bountyme && h.bountyme.tip.includes('但只要錄得夠完整，校正者章還是你的')), JSON.stringify([hs, hw, hd].map(h => h.bountyme && h.bountyme.tip.slice(0, 30))));
      ok('CH27g 四個頁面都沒有未捕捉的例外', [shell, web, demo, off].every(s => s.errors.length === 0), JSON.stringify([shell, web, demo, off].map(s => s.errors)));
      for (const s of [shell, web, demo, off]) await s.ctx.close();
    });
    for (const lang of ['en', 'ja']) await attempt(`CH27-help-${lang}`, async () => {
      const shell = await sess27('shell', lang), web = await sess27('web', lang);
      const hs = await readHelp27(shell.page), hw = await readHelp27(web.page);
      const X = U27[lang];
      ok(`CH27h-${lang} ${lang} 介面、現行 App 殼：「懸賞板」的小提示與「錄一趟校正旅程」的小提示是譯好的整句；「錄一趟校正旅程」沒有步驟、沒有「試一次」` + (lang === 'en' ? '；兩節沒有中文字' : ''),
        !!hs.bounty && !!hs.bountyrec && hs.bounty.tip === X.bountyTip && hs.bountyrec.tip === X.recTip && hs.bountyrec.steps.length === 0 && !hs.bountyrec.tryBtn && hs.bounty.steps.length === 1 &&
          (lang !== 'en' || (!/[㐀-鿿]/.test(hs.bounty.text) && !/[㐀-鿿]/.test(hs.bountyrec.text))), JSON.stringify({ bounty: hs.bounty && hs.bounty.tip, rec: hs.bountyrec && hs.bountyrec.tip }));
      ok(`CH27i-${lang} ${lang} 介面、網頁（對照）：「懸賞板」還是三步、沒有請更新的那句；頁面沒有未捕捉的例外`,
        !!hw.bounty && hw.bounty.steps.length === 3 && !hw.bounty.text.includes(X.recTip) && !hw.bounty.tip.includes(X.bountyTip) && shell.errors.length === 0 && web.errors.length === 0, JSON.stringify({ steps: hw.bounty && hw.bounty.steps.length, errors: [shell.errors, web.errors] }));
      await shell.ctx.close(); await web.ctx.close();
    });

    await attempt('CH27-passport', async () => {
      for (const lang of ['zh-TW', 'en', 'ja']) {
        const shell = await sess27('shell', lang), web = await sess27('web', lang), demo = await sess27('demo', lang);
        const es = await readEmpty27(shell.page), ew = await readEmpty27(web.page), ed = await readEmpty27(demo.page);
        const X = U27[lang];
        ok(`CH27j-${lang} 護照校正貢獻的空狀態（${lang}）：現行 App 殼是「…看看有哪些路段缺資料」＋請更新那句，沒有「錄得夠完整就有校正者章」的承諾；網頁與 ?demo=bounty（對照）跟以前一樣有承諾、沒有請更新那句`,
          es !== null && es.includes(X.empty) && !es.includes(X.promise) && ew !== null && ew.includes(X.promise) && !ew.includes(X.empty) && ed !== null && ed.includes(X.promise) && !ed.includes(X.empty) && shell.errors.length + web.errors.length + demo.errors.length === 0,
          JSON.stringify({ es, ew, ed }));
        if (lang === 'en') ok('CH27k-en 英文介面現行 App 殼的空狀態整句沒有中文字', !/[㐀-鿿]/.test(es), es);
        for (const s of [shell, web, demo]) await s.ctx.close();
      }
      // 有章的人不受影響：同一份有路段的回應，現行 App 殼與網頁畫出來的校正貢獻完全相同
      const shell = await sess27('shell', 'zh-TW', ME), web = await sess27('web', 'zh-TW', ME);
      const hs = await shell.page.evaluate(() => { renderPassport(); return document.querySelector('#passport .ph-correct').innerHTML; });
      const hw = await web.page.evaluate(() => { renderPassport(); return document.querySelector('#passport .ph-correct').innerHTML; });
      ok('CH27l 對照：已經有校正記錄的人（12 段），現行 App 殼與網頁畫出來的校正貢獻內容完全相同（請更新只出現在空狀態）', hs.length > 100 && hs === hw && !hs.includes('還不能錄程'), JSON.stringify({ a: hs.length, b: hw.length }));
      await shell.ctx.close(); await web.ctx.close();
    });

    // 開機接回錄製：裝置上保存著一筆沒結束的錄製。現行 App 殼不接回、不開始取樣、保存的那一筆原封不動；?demo=bounty 照舊接回（對照）
    await attempt('CH27-restore', async () => {
      const rec = demo => JSON.stringify({ card: { ...CARD_R, id: 'card-restore' }, sys: 'tra_sched', lnId: '南迴線', trainNo: '123', dir: 0, tripDate: '2026-10-02', startedAt: Date.now() - 120000,
        dNow: 1000, segs: {}, cov: {}, points: 0, quality: 'none', buf: [], recent: [], lastFix: 0, lastFlush: Date.now() - 60000, batch: 0, demo });
      const boot = async (kind, demo) => {
        const s = await newSession({ app: kind !== 'web' }, {}, { ctx: { locale: 'zh-TW' } });
        const stored = rec(demo);
        await s.ctx.addInitScript(([k, v]) => {
          try { localStorage.setItem(k, v); } catch (e) {}
          window.__watchCalls = 0;
          Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: () => { window.__watchCalls++; return 1; }, clearWatch: () => {}, getCurrentPosition: () => {} } });
        }, ['trainmap-bounty-recording-v1', stored]);
        await s.page.goto(`${BASE}/?${kind === 'demo' ? 'lang=zh-TW&demo=bounty' : 'bounty=1&lang=zh-TW'}`);
        await bootDone(s.page); await sleep(1500);
        const st = await s.page.evaluate(() => ({ recording: !!state.recording, demoFlag: !!(state.recording && state.recording.demo), watch: window.__watchCalls, barHidden: document.getElementById('recordBar').hidden,
          bodyRec: document.body.classList.contains('recording'), saved: localStorage.getItem('trainmap-bounty-recording-v1') }));
        return { s, st, stored };
      };
      const shell = await boot('shell', false);
      ok('CH27m 現行 App 殼、裝置上保存著一筆沒結束的錄製（不是示範的）：開機不接回（state.recording 空、body 沒有 recording、常駐錄製列藏著）、沒有開始取樣（定位的監看一次都沒呼叫）；保存的那一筆原封不動（字串逐位元組相同、沒有被刪）',
        !shell.st.recording && !shell.st.bodyRec && shell.st.barHidden && shell.st.watch === 0 && shell.st.saved === shell.stored && shell.s.errors.length === 0, JSON.stringify({ st: shell.st, errors: shell.s.errors }));
      // 對照一：這個頁面的定位替身真的會計數（不是因為替身壞了才是 0）
      const ctl = await shell.s.page.evaluate(() => { const n0 = window.__watchCalls; navigator.geolocation.watchPosition(() => {}); return [n0, window.__watchCalls]; });
      ok('CH27n [fixture] 對照：同一個頁面直接呼叫定位的監看，計數從 0 變 1——上一條的「0 次」不是替身壞了', ctl[0] === 0 && ctl[1] === 1, JSON.stringify(ctl));
      // 對照二：?demo=bounty（含在 App 殼裡）同樣一筆示範的保存錄製，開機照舊接回
      const demo = await boot('demo', true);
      ok('CH27o 對照：?demo=bounty（在 App 殼裡）保存著一筆示範的錄製：開機照舊接回（state.recording 有、是示範的、body 有 recording、錄製列出現）；頁面沒有未捕捉的例外',
        demo.st.recording && demo.st.demoFlag && demo.st.bodyRec && !demo.st.barHidden && demo.s.errors.length === 0, JSON.stringify({ st: { ...demo.st, saved: !!demo.st.saved }, errors: demo.s.errors }));
      await shell.s.ctx.close(); await demo.s.ctx.close();
    });

    // 手機：現行 App 殼的說明中心兩節與護照空狀態，360／375／414／768 × Chromium／WebKit；真觸控
    const MOBILE27 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      const ctxOpts = { browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
      const fit = (page, sel) => page.evaluate(q => [...document.querySelectorAll(q)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => {
        e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect();
        return { t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 16), wOver: e.scrollWidth > e.clientWidth + 1, hOver: e.scrollHeight > e.clientHeight + 1, inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0 };
      }), sel);
      await attempt(`CH27-mobile-${tag}`, async () => {
        const s = await newSession({ passportClosed: true, app: true }, {}, ctxOpts);
        s.board = BOARD_V2; s.meBody = ME_NONE27;
        await s.page.goto(`${BASE}/?bounty=1&lang=zh-TW&help=1`);
        await loggedIn(s.page); await bootDone(s.page);
        await s.page.waitForFunction(() => { const m = document.getElementById('helpModal'); return m && !m.hidden && document.querySelector('#helpBody .help-sec[data-sec="bountyrec"]'); }, null, { timeout: 20000 });
        const grp = await s.page.evaluate(() => { const g = document.querySelector('#helpBody .help-sec[data-sec="bountyrec"]').closest('.help-grp'); return g ? { key: g.dataset.grp, open: g.classList.contains('open') } : null; });
        if (grp && !grp.open) { await s.page.tap(`#helpBody .help-grp[data-grp="${grp.key}"] .help-grph`); await sleep(300); }
        const secs = {};
        for (const key of ['bounty', 'bountyrec']) {
          const sel = `#helpBody .help-sec[data-sec="${key}"]`;
          await s.page.evaluate(q => document.querySelector(q).scrollIntoView({ block: 'center' }), sel);
          await sleep(200);
          secs[key] = { box: await fit(s.page, `${sel} .one, ${sel} .tip, ${sel} ol li`), text: await s.page.evaluate(q => document.querySelector(q).textContent.replace(/\s+/g, ' ').trim(), sel) };
        }
        const hs = await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(`CH27p-${tag} 手機 ${width} 寬、現行 App 殼（真網址 ?help=1 開說明中心、真觸控展開那一組）：「懸賞板」「錄一趟校正旅程」兩節的句子都完整看得到、沒被截、沒溢出、沒有水平捲動；兩節都是請更新的版本`,
          secs.bounty.box.length >= 2 && secs.bountyrec.box.length >= 2 && [...secs.bounty.box, ...secs.bountyrec.box].every(b => !b.wOver && !b.hOver && b.inView) && hs <= 1 &&
            secs.bounty.text.includes('懸賞板現在可以先看') && secs.bountyrec.text.includes('還不能錄程') && !secs.bountyrec.text.includes('開始錄製'), JSON.stringify({ secs, hs }));
        await s.page.tap('#helpX'); await sleep(300);
        await s.page.tap('#tabRide');
        await s.page.waitForFunction(() => { const p = document.getElementById('ridePanel'); return p && !p.hidden && p.querySelector('.ph-sec[data-sec="correct"]'); }, null, { timeout: 15000 });
        await s.page.evaluate(() => document.querySelector('#ridePanel .ph-sec[data-sec="correct"]').scrollIntoView({ block: 'center' }));
        await sleep(300);
        if (await s.page.evaluate(() => document.querySelector('#ridePanel .ph-sec[data-sec="correct"]').classList.contains('closed'))) { await s.page.tap('#ridePanel .ph-sec[data-sec="correct"] .ph-caret'); await sleep(300); }
        const em = await fit(s.page, '#ridePanel .ph-correct .ph-empty');
        const emText = await s.page.evaluate(() => { const e = document.querySelector('#ridePanel .ph-correct .ph-empty'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
        const hs2 = await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(`CH27q-${tag} 手機 ${width} 寬、現行 App 殼的護照：校正貢獻的空狀態（真觸控進「護照」、點開那一節）整段看得到、沒被截、沒溢出、沒有水平捲動、是請更新的版本；頁面沒有未捕捉的例外`,
          em.length === 1 && !em[0].wOver && !em[0].hOver && em[0].inView && hs2 <= 1 && !!emText && emText.includes('還不能錄程') && !emText.includes('錄得夠完整就有校正者章') && s.errors.length === 0, JSON.stringify({ em, emText, hs2, errors: s.errors }));
        if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-shell-passport-empty-${tag}.png`) });
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE27('chromium', browser, w);
    await attempt('CH27-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE27('webkit', wk, w);
    });
  }
  // ═══ CH28：現行 App 殼看板上，已收滿的卡也請人更新 ═══════════════════════════════════════════════════════════════════
  // 收滿的卡（covered:true）原本寫「照樣可以錄程拿籌碼」，現行 App 殼這一版錄不了程，不能再叫人去錄。判定與看板其他幾處是同一份
  // （BOUNTY_APP_NEEDS_UPDATE：懸賞開著、不是 ?demo=bounty、IS_NATIVE_APP 真）：真時那一句改成收滿了、這一版錄不了程、要更新到最新版。
  //   ・網頁、?demo=bounty（網頁與扮成 App 殼的）、旗標關：一個字不變
  //   ・另一個平台訊號（只有 Capacitor）單獨成立也算現行 App 殼
  //   ・中英日；手機 360／375／414／768 × Chromium／WebKit：那一句完整看得到、不溢出、不與別的元素重疊、沒有水平捲動
  if (want('CH28')) {
    const U28 = {
      'zh-TW': { shell: '已收滿。這一版的軌島 App 還不能錄程，要更新到最新版才行。', web: '已收滿，照樣可以錄程拿籌碼', stale: '照樣可以錄程拿籌碼' },
      en: { shell: 'Fully covered. This version of the Rail Island app can’t record trips yet — update to the latest version to record.', web: 'Fully covered — you can still record a trip and earn chips', stale: 'you can still record a trip and earn chips' },
      ja: { shell: '収集済みです。この版の軌島アプリではまだ記録できません。最新版に更新してください。', web: '収集済みですが、旅程を記録すればチップがもらえます', stale: '旅程を記録すればチップがもらえます' },
    };
    const CJK28 = /[㐀-鿿]/;
    const locale28 = lang => lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW';
    // 開看板（走頁面自己的入口）；回 session。qs：網址後面接的（&demo=bounty）
    const open28 = async (arg, { lang = 'zh-TW', qs = '', n = 3, ctx = {}, browser: br = null } = {}) => {
      const s = await newSession(arg, {}, { ...(br ? { browser: br } : {}), ctx: { locale: locale28(lang), ...ctx } });
      s.board = BOARD_V2;
      await s.page.goto(`${BASE}/?${qs.includes('demo=bounty') ? '' : 'bounty=1&'}lang=${lang}${qs}`);
      if (qs.includes('demo=bounty')) await bootDone(s.page); else { await loggedIn(s.page); await chipsLoaded(s.page); }
      await s.page.evaluate(() => { openBountyBoard(); });
      await s.page.waitForFunction(k => document.querySelectorAll('#bountyList .bt-card').length >= k, n, { timeout: 15000 });
      return s;
    };
    const covers28 = page => page.evaluate(() => ({
      flag: BOUNTY_ENABLED, native: IS_NATIVE_APP, demo: DEMO_AS_APP, update: typeof BOUNTY_APP_NEEDS_UPDATE === 'undefined' ? null : BOUNTY_APP_NEEDS_UPDATE,
      board: document.getElementById('bountyList').textContent.replace(/\s+/g, ' ').trim(),
      covered: [...document.querySelectorAll('#bountyList .bt-card')].filter(c => c.querySelector('.bt-covered')).map(c => ({ id: c.dataset.card, txt: c.querySelector('.bt-covered').textContent.replace(/\s+/g, ' ').trim(), take: c.querySelectorAll('.bt-take').length })),
    }));
    // 直接把一張收滿的卡畫上看板（示範資料與旗標關的板子沒有收滿的卡），量那一句
    const inject28 = (page, card) => page.evaluate(c => {
      bountyBoardMem = { cards: [c] }; renderBountyBoard();
      return { flag: BOUNTY_ENABLED, demo: DEMO_AS_APP, native: IS_NATIVE_APP, update: typeof BOUNTY_APP_NEEDS_UPDATE === 'undefined' ? null : BOUNTY_APP_NEEDS_UPDATE,
        covered: [...document.querySelectorAll('#bountyList .bt-covered')].map(e => e.textContent.replace(/\s+/g, ' ').trim()) };
    }, card);

    // 三種語言：現行 App 殼（新句）與網頁（原句，對照）
    for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH28-${lang}`, async () => {
      const X = U28[lang];
      const sh = await open28({ app: true }, { lang });
      const a = await covers28(sh.page);
      ok(`CH28a-${lang} 現行 App 殼：判定為真；收滿的卡（${a.covered.length} 張）沒有接單鈕、那一句整句是「${X.shell}」；整個看板沒有舊句「${X.stale}」` + (lang === 'en' ? '；那一句沒有中文字' : '') + '；頁面沒有未捕捉的例外',
        a.flag === true && a.native === true && a.demo === false && a.update === true && a.covered.length === 1 && a.covered.every(c => c.take === 0 && c.txt === X.shell) &&
          !a.board.includes(X.stale) && (lang !== 'en' || !CJK28.test(a.covered[0].txt)) && sh.errors.length === 0, JSON.stringify({ a, errors: sh.errors }));
      await sh.ctx.close();
      const web = await open28({}, { lang });
      const w = await covers28(web.page);
      ok(`CH28b-${lang} 對照（網頁、旗標開）：判定為假；收滿的卡沒有接單鈕、那一句仍是原句「${X.web}」、不是請更新那句；頁面沒有未捕捉的例外`,
        w.flag === true && w.native === false && w.update === false && w.covered.length === 1 && w.covered.every(c => c.take === 0 && c.txt === X.web) && !w.board.includes(X.shell) && web.errors.length === 0, JSON.stringify({ w, errors: web.errors }));
      await web.ctx.close();
    });

    // 其他情境：?demo=bounty（網頁、扮成 App 殼）與旗標關的 App 殼仍是原句；只有 Capacitor 那個平台訊號也算現行 App 殼
    for (const [tag, arg] of [['web', {}], ['app', { app: true }]]) await attempt(`CH28-demo-${tag}`, async () => {
      const X = U28['zh-TW'];
      const s = await open28(arg, { qs: '&demo=bounty', n: 5 });
      const r = await inject28(s.page, CARD_COVERED);
      ok(`CH28c-${tag} 對照：?demo=bounty${tag === 'app' ? '（扮成 App 殼）' : ''}：判定為假（備援站看設計的流程不被擋）；收滿的卡那一句仍是原句「${X.web}」`,
        r.flag === true && r.demo === true && r.update === false && r.native === (tag === 'app') && r.covered.length === 1 && r.covered[0] === X.web && s.errors.length === 0, JSON.stringify({ r, errors: s.errors }));
      await s.ctx.close();
    });
    await attempt('CH28-off', async () => {
      const X = U28['zh-TW'];
      for (const [tag, arg] of [['app', { app: true }], ['web', {}]]) {
        const s = await newSession(arg, {}, { ctx: { locale: 'zh-TW' } });
        await s.page.goto(`${BASE}/?lang=zh-TW`);
        await bootDone(s.page);
        const r = await inject28(s.page, CARD_COVERED);
        ok(`CH28d-${tag} 對照：旗標關（${tag === 'app' ? 'App 殼' : '網頁'}）：判定為假；直接畫板子，收滿的卡那一句仍是原句「${X.web}」`,
          r.flag === false && r.update === false && r.covered.length === 1 && r.covered[0] === X.web && s.errors.length === 0, JSON.stringify({ r, errors: s.errors }));
        await s.ctx.close();
      }
    });
    await attempt('CH28-capacitor', async () => {
      const X = U28['zh-TW'];
      const s = await open28({ capacitor: true }, {});
      const r = await covers28(s.page);
      const sig = await s.page.evaluate(() => ({ key: typeof window.RAIL_ONLINE_BASEMAPS_AVAILABLE !== 'undefined', cap: !!(window.Capacitor && window.Capacitor.isNativePlatform()) }));
      ok(`CH28e 只有 Capacitor 那個平台訊號（沒有 RAIL_ONLINE_BASEMAPS_AVAILABLE、Capacitor.isNativePlatform() 回 true）也算現行 App 殼：判定為真；收滿的卡那一句是「${X.shell}」`,
        sig.key === false && sig.cap === true && r.update === true && r.covered.length === 1 && r.covered[0].txt === X.shell && s.errors.length === 0, JSON.stringify({ sig, r, errors: s.errors }));
      await s.ctx.close();
    });

    // 手機：現行 App 殼的看板，那一句完整看得到、不溢出、不與別的元素重疊、沒有水平捲動；360／375／414／768 × Chromium／WebKit × 中英日
    const MOBILE28 = async (engineName, br, width) => {
      const tag = `${engineName}-${width}`;
      for (const lang of ['zh-TW', 'en', 'ja']) await attempt(`CH28-mobile-${tag}-${lang}`, async () => {
        const X = U28[lang];
        const s = await open28({ app: true }, { lang, browser: br, ctx: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
        await sleep(400);
        const m = await s.page.evaluate(() => {
          const shown = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const nm = el => (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]) + ':' + el.textContent.replace(/\s+/g, ' ').trim().slice(0, 10);
          // 先量兩兩相交（捲動位置在最上面時、版面座標）
          const items = [...document.querySelectorAll('#bountySub, #bountyList .bt-r, #bountyList .bt-meta, #bountyList .bt-pt, #bountyList .bt-take, #bountyList .bt-covered')].filter(shown);
          const pairs = [];
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (a.contains(b) || b.contains(a)) continue;
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (w > 0.5 && h > 0.5) pairs.push([nm(a), nm(b), Math.round(w), Math.round(h)]);
          }
          const box = document.querySelector('#bountyModal .tk-box');
          const cov = [...document.querySelectorAll('#bountyList .bt-covered')].map(e => {
            e.scrollIntoView({ block: 'center' });
            const r = e.getBoundingClientRect(), card = e.closest('.bt-card').getBoundingClientRect(), cs = getComputedStyle(e), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { txt: e.textContent.replace(/\s+/g, ' ').trim(), wOver: e.scrollWidth > e.clientWidth + 1, hOver: e.scrollHeight > e.clientHeight + 1, ell: cs.textOverflow === 'ellipsis',
              inView: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0, inCard: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5, hitSelf: !!hit && (hit === e || e.contains(hit)) };
          });
          return { n: items.length, pairs, cov, doc: document.documentElement.scrollWidth - innerWidth, box: box ? box.scrollWidth - box.clientWidth : null, list: document.getElementById('bountyList').scrollWidth - document.getElementById('bountyList').clientWidth };
        });
        ok(`CH28m-${tag}-${lang} 手機 ${width} 寬、現行 App 殼的看板（${lang}）：收滿的卡那一句整句是「${X.shell}」、沒被截（沒有溢出、沒有省略號、整句在視窗與卡片之內）；掃了 ${m.n} 個元素兩兩沒有互相蓋住、那一句的中心點 elementFromPoint 回到自己；頁面、看板框、卡片列表沒有水平捲動；頁面沒有未捕捉的例外`,
          m.n >= 10 && m.cov.length === 1 && m.cov.every(c => c.txt === X.shell && !c.wOver && !c.hOver && !c.ell && c.inView && c.inCard && c.hitSelf) && m.pairs.length === 0 &&
            m.doc <= 1 && m.box !== null && m.box <= 1 && m.list <= 1 && s.errors.length === 0, JSON.stringify({ m, errors: s.errors }));
        if (SHOT_DIR && lang === 'zh-TW') await s.page.screenshot({ path: path.join(SHOT_DIR, `bounty-shell-covered-${tag}.png`) });
        await s.ctx.close();
      });
    };
    for (const w of [360, 375, 414, 768]) await MOBILE28('chromium', browser, w);
    await attempt('CH28-webkit-launch', async () => {
      if (!wk) wk = await webkit.launch({ headless: true });
      for (const w of [360, 375, 414, 768]) await MOBILE28('webkit', wk, w);
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

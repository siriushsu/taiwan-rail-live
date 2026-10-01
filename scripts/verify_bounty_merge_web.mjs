// 路段懸賞 v2 · 網頁端「登入後併帳號」驗收——Playwright 真引擎（無視窗）＋ node 靜態伺服器 ＋ 打樁的 Firebase 與 /api。
//
// 驗的是 index.html 的 bountyMergeOnLogin()：登入成功（onAuthStateChanged 解出 user）之後，只在 BOUNTY_ENABLED 時、
// 對 POST /api/bounty-merge 恰好通知一次（帶裝置 id 與 Firebase idToken），失敗不影響登入、也不記「已併」旗標。
// 判準驗【行為】：量的是「瀏覽器實際發出了幾個 /api/bounty-merge 請求、帶什麼」，不是原始碼裡有沒有那串字。
// 每個「0 次」都有對照組（同一個環境下打開旗標就是 1 次）；每個「不送」的情境都有 fixture 判準證明情境真的成立
// （BOUNTY_ENABLED 的值、bountyActor() 的值、登入真的解出了 user），不會因為登入根本沒發生而假綠。
//
// 打樁慣例照 scripts/verify_metro_widget_plus_sync.mjs：window.RAIL_FIREBASE_CONFIG＋window.RAIL_FIREBASE_TEST_MODULES；
// localStorage['trainmap-account-uid'] 讓開機走 accountEnsureInit（回訪者分支）。
// 跑法：node scripts/verify_bounty_merge_web.mjs（自己在空的埠起靜態伺服器、跑完自己關）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync, statSync } from 'node:fs';
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

const UID_A = 'uid-web-aaaa0001', UID_B = 'uid-web-bbbb0002';
const THSR = readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'));

// ── 靜態伺服器（node http，空的埠，跑完由 finally 關掉）────────────────────────────────────────────
// 原本用 python3 -m http.server：它的 listen backlog 只有 5（socketserver 的 request_queue_size），冷開機一次湧進上百個請求時，
// 溢出的連線被 RST。機器忙的時候（出貨鏈、並行驗收）偶發 net::ERR_CONNECTION_RESET，W7 的 page.reload 直接丟例外。node 的 backlog 511。
// 語意照 python：只服 ROOT 底下的檔、/ 給 index.html、query 不看、找不到 404；Content-Type 照副檔名。
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
let browser = null;
try {
  browser = await chromium.launch({ headless: true });

  // Firebase 替身與環境打樁。🔴 addInitScript 把函式序列化後在頁面裡跑，引用不到本檔的外層繫結 ⇒ 一切寫在函式體內，
  // 情境差異靠 arg。uid 也可以由 localStorage.__test_uid 覆蓋（換帳號登入的情境靠它，重新整理後生效）。
  const STUB = (arg) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    const uid = (() => { try { return localStorage.getItem('__test_uid'); } catch (e) { return null; } })() || arg.uid;
    window.__authFired = 0;
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };          // accountConfigured() 要求的三欄
    const user = { uid, email: 't@example.com', getIdToken: async () => 'fake-id-token' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      getIdToken: async () => 'fake-id-token',
      onAuthStateChanged: (auth, cb) => {
        const fire = () => { window.__authFired++; cb(arg.noUser ? null : user); };
        setTimeout(fire, 50);
        if (arg.twice) setTimeout(fire, 120);          // session 還原＋登入事件連發兩次
      },
    };
    // returning＝本機留著 ACCOUNT_UID_KEY：開機走 accountEnsureInit()，onAuthStateChanged 才會來
    try { localStorage.setItem('trainmap-account-uid', uid); } catch (e) {}
    if (arg.deviceIdBlocked) {                           // 本機存不下裝置 id：userDataDeviceId() 會退回字面 'ephemeral'
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'trainmap-device-id') throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
    }
  };

  // 一個獨立情境：自己的 localStorage／sessionStorage、自己的 /api 打樁與請求紀錄
  async function newSession(arg = {}, merge = 'ok') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(STUB, { uid: UID_A, ...arg });
    const s = { ctx, merges: [], bme: [], seq: 0, mode: { merge, bme: 'ok' }, errors: [] };
    await ctx.route('**/*', async route => {
      const rq = route.request(), u = new URL(rq.url());
      if (u.hostname !== '127.0.0.1') return route.abort();                                  // 地圖磚、字型等外部資源一律不連
      if (u.pathname === '/api/bounty-me') {                                                   // W10：誰、帶什麼去讀懸賞彙總
        s.bme.push({ seq: ++s.seq, search: u.search, auth: rq.headers()['authorization'] || null });
        if (s.mode.bme === '401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"auth_required"}' });
        if (s.mode.bme === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"actor":"x","points":5,"corrected":{"segs":0,"adopted":0},"lines":[]}' });
      }
      if (u.pathname === '/api/bounty-merge') {
        const m = { seq: ++s.seq, method: rq.method(), path: u.pathname, auth: rq.headers()['authorization'], ct: rq.headers()['content-type'], body: rq.postData() };
        s.merges.push(m);
        if (s.mode.merge === 'abort') return route.abort();
        if (s.mode.merge === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"merge_failed"}' });
        if (s.mode.merge === 'slow') await sleep(700);
        m.doneSeq = ++s.seq;                                                                   // W10：合併「完成」的時點（回應送出前）
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"uid":"x","points":0,"merged":true}' });
      }
      if (u.pathname === '/api/thsr-schedule') return route.fulfill({ status: 200, contentType: 'application/json', body: THSR });
      if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    s.page = await ctx.newPage();
    s.page.on('pageerror', e => s.errors.push(String(e && e.message || e)));
    return s;
  }
  // 登入真的解出 user（fixture：沒有這一步，「0 次」什麼都證明不了）
  const loggedIn = (page) => page.waitForFunction(() => { try { return !!(state.account && state.account.user && state.account.user.uid); } catch (e) { return false; } }, null, { timeout: 30000 });
  const uidOf = (page) => page.evaluate(() => state.account.user.uid);
  const dev = (page) => page.evaluate(() => localStorage.getItem('trainmap-device-id'));
  const flagOf = (page, uid) => page.evaluate(u => localStorage.getItem('trainmap-bounty-merged-' + u), uid);

  // ═══ W1／W2：旗標關 → 0 次；旗標開 → 恰好 1 次（同一個環境的正反對照）═══════════════════════════════════════
  await attempt('W1', async () => {
    const s = await newSession();
    await s.page.goto(BASE + '/');
    await loggedIn(s.page);
    await sleep(1500);
    ok('W1a [fixture] 登入真的解出 user，而且 BOUNTY_ENABLED 是 false（沒帶 ?bounty=1）',
      (await uidOf(s.page)) === UID_A && (await s.page.evaluate(() => BOUNTY_ENABLED)) === false);
    ok('W1b 旗標關：登入後 /api/bounty-merge 請求 0 次（懸賞下架期間不打這支 Worker）', s.merges.length === 0, JSON.stringify(s.merges));
    await s.ctx.close();
  });

  await attempt('W2', async () => {
    const s = await newSession();
    await s.page.goto(BASE + '/?bounty=1');
    await loggedIn(s.page);
    await sleep(1200);
    const d = await dev(s.page);
    ok('W2a [fixture] 登入解出 user、BOUNTY_ENABLED 是 true、裝置 id 存在且不是 ephemeral',
      (await uidOf(s.page)) === UID_A && (await s.page.evaluate(() => BOUNTY_ENABLED)) === true && !!d && d !== 'ephemeral' && (await s.page.evaluate(() => bountyActor())) === d, String(d));
    ok('W2b 旗標開：登入後 /api/bounty-merge 恰好 1 次', s.merges.length === 1, JSON.stringify(s.merges));
    const m = s.merges[0] || {};
    let body = null; try { body = JSON.parse(m.body); } catch (e) {}
    ok('W2c 這 1 次是 POST、路徑 /api/bounty-merge、Authorization 是 Bearer＋Firebase idToken、內容是 JSON',
      m.method === 'POST' && m.path === '/api/bounty-merge' && m.auth === 'Bearer fake-id-token' && /application\/json/.test(m.ct || ''), JSON.stringify(m));
    ok('W2d body 恰好只有 actor、且等於 localStorage 的 trainmap-device-id（不是 uid、不含座標或其他欄位）',
      !!body && Object.keys(body).length === 1 && body.actor === d, JSON.stringify(body) + ' dev=' + d);
    ok('W2e 成功（200）後記下「這一組 (uid, 裝置) 併過了」的旗標：localStorage[trainmap-bounty-merged-<uid>]＝裝置 id', (await flagOf(s.page, UID_A)) === d, String(await flagOf(s.page, UID_A)));

    // W3 重新整理：旗標讓同一組不再送（BOUNTY_ENABLED 靠 sessionStorage 撐過重新整理，所以擋下它的是 localStorage 旗標）
    await s.page.reload();
    await loggedIn(s.page);
    await sleep(1500);
    ok('W3a [fixture] 重新整理後 BOUNTY_ENABLED 仍是 true、登入再次解出 user（不是因為旗標關了才沒送）',
      (await s.page.evaluate(() => BOUNTY_ENABLED)) === true && (await uidOf(s.page)) === UID_A);
    ok('W3b 重新整理後不再送：請求總數仍是 1', s.merges.length === 1, String(s.merges.length));

    // W4 換一個帳號登入同一台裝置：另一組 (uid, 裝置)，要再併一次；裝置 id 不變
    await s.page.evaluate(u => localStorage.setItem('__test_uid', u), UID_B);
    await s.page.reload();
    await loggedIn(s.page);
    await sleep(1200);
    let b2 = null; try { b2 = JSON.parse((s.merges[1] || {}).body); } catch (e) {}
    ok('W4a 換成另一個 uid 登入：再送 1 次（總數 2），body 的 actor 仍是同一個裝置 id，旗標另記在新 uid 名下',
      (await uidOf(s.page)) === UID_B && s.merges.length === 2 && !!b2 && b2.actor === d && (await flagOf(s.page, UID_B)) === d, JSON.stringify(s.merges.map(x => x.body)));
    await s.page.reload();
    await loggedIn(s.page);
    await sleep(1200);
    ok('W4b 新 uid 也只送一次：再重新整理後總數仍是 2', s.merges.length === 2, String(s.merges.length));
    await s.ctx.close();
  });

  // ═══ W5：onAuthStateChanged 連發兩次、第一個請求還在途 → 仍只有 1 個請求（_busy）══════════════════════════════
  await attempt('W5', async () => {
    const s = await newSession({ twice: true }, 'slow');
    await s.page.goto(BASE + '/?bounty=1');
    await loggedIn(s.page);
    await sleep(1800);
    const fired = await s.page.evaluate(() => window.__authFired);
    ok('W5 登入事件連發 2 次、第一個請求（延遲 700ms）還沒回來時第二次也到了：仍只送 1 個請求',
      fired >= 2 && s.merges.length === 1, JSON.stringify({ fired, merges: s.merges.length }));
    await s.ctx.close();
  });

  // ═══ W6／W7：合併失敗（伺服器 503／連線斷）不影響登入、不記旗標、下次開機再試 ═════════════════════════════════
  for (const [tag, mode] of [['W6', '503'], ['W7', 'abort']]) {
    await attempt(tag, async () => {
      const s = await newSession({}, mode);
      await s.page.goto(BASE + '/?bounty=1');
      await loggedIn(s.page);
      await sleep(1200);
      ok(`${tag}a 合併請求失敗（${mode}）：登入不受影響（user 仍在）、頁面沒有任何未捕捉的例外、沒有記下已併旗標`,
        s.merges.length === 1 && (await uidOf(s.page)) === UID_A && s.errors.length === 0 && (await flagOf(s.page, UID_A)) === null,
        JSON.stringify({ merges: s.merges.length, errors: s.errors, flag: await flagOf(s.page, UID_A) }));
      await s.page.reload();
      await loggedIn(s.page);
      await sleep(1200);
      ok(`${tag}b 失敗沒記旗標 → 下次開機再試：重新整理後多送 1 次（總數 2）`, s.merges.length === 2, String(s.merges.length));
      s.mode.merge = 'ok';
      await s.page.reload();
      await loggedIn(s.page);
      await sleep(1200);
      ok(`${tag}c 這次成功（200）：總數 3、旗標記下`, s.merges.length === 3 && (await flagOf(s.page, UID_A)) === (await dev(s.page)), String(s.merges.length));
      await s.page.reload();
      await loggedIn(s.page);
      await sleep(1200);
      ok(`${tag}d 成功之後不再送：總數仍是 3`, s.merges.length === 3, String(s.merges.length));
      await s.ctx.close();
    });
  }

  // ═══ W8：本機存不下裝置 id（bountyActor()＝'ephemeral'，所有這種裝置共用的值）→ 不送 ═══════════════════════════
  await attempt('W8', async () => {
    const s = await newSession({ deviceIdBlocked: true });
    await s.page.goto(BASE + '/?bounty=1');
    await loggedIn(s.page);
    await sleep(1500);
    ok('W8a [fixture] 情境成立：旗標開、登入解出 user、bountyActor() 是字面 ephemeral',
      (await s.page.evaluate(() => BOUNTY_ENABLED)) === true && (await uidOf(s.page)) === UID_A && (await s.page.evaluate(() => bountyActor())) === 'ephemeral');
    ok('W8b 不送（把不相干的人的資料併進這個帳號＝資料外洩）：請求 0 次', s.merges.length === 0, JSON.stringify(s.merges));
    await s.ctx.close();
  });

  // ═══ W9：沒登入（auth 解出 null）→ 就算旗標開也不送（登入才是觸發點）═══════════════════════════════════════════
  await attempt('W9', async () => {
    const s = await newSession({ noUser: true });
    await s.page.goto(BASE + '/?bounty=1');
    await s.page.waitForFunction(() => { try { return window.__authFired >= 1 && state.account && state.account.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
    await sleep(1500);
    ok('W9 [fixture＋驗收] auth 已解出「沒有登入」（user 為 null）、旗標開著：請求 0 次',
      (await s.page.evaluate(() => BOUNTY_ENABLED)) === true && (await s.page.evaluate(() => state.account.user)) === null && s.merges.length === 0, JSON.stringify(s.merges));
    await s.ctx.close();
  });
  // ═══ W10：懸賞彙總（/api/bounty-me）的讀法═══════════════════════════════════════════════════
  // 伺服器對「帳號」與「併進帳號的裝置」的 ?actor= 讀取回 401（裝置 token 不是憑證）。所以登入後一定要帶 Bearer 讀、
  // 合併完成後要再讀一次（登入那一刻讀到的是還沒併進來的帳）；沒登入才用 ?actor=裝置 id。401 清掉手上那份，其他失敗保留。
  await attempt('W10', async () => {
    const s = await newSession({}, 'slow');                                   // 合併延遲 700ms：登入那一次讀取一定早於合併完成
    await s.page.goto(BASE + '/?bounty=1');
    await loggedIn(s.page);
    await sleep(2000);
    const d = await dev(s.page);
    const bearer = s.bme.filter(x => x.auth === 'Bearer fake-id-token');
    const doneSeq = (s.merges[0] || {}).doneSeq || 0;
    ok('W10a 登入後讀懸賞彙總帶 Bearer、不帶 ?actor=；合併（延遲 700ms）完成之前讀過一次、完成之後再讀一次（登入那一刻讀到的是還沒併進來的帳）',
      s.merges.length === 1 && doneSeq > 0 && bearer.length >= 2 && bearer.every(x => !/actor=/.test(x.search)) && bearer.some(x => x.seq > doneSeq) && bearer.some(x => x.seq < doneSeq),
      JSON.stringify({ bme: s.bme, doneSeq }));
    ok('W10b 登入後沒有任何「帶 ?actor= 卻不帶 Bearer」的讀取排在登入之後（開機那一次可能早於登入就緒，只允許出現在第一個 Bearer 讀取之前）',
      s.bme.filter(x => !x.auth && x.seq > (bearer[0] || {}).seq).length === 0, JSON.stringify(s.bme));
    await s.ctx.close();
    const n = await newSession({ noUser: true });
    await n.page.goto(BASE + '/?bounty=1');
    await n.page.waitForFunction(() => { try { return window.__authFired >= 1 && state.account && state.account.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
    await sleep(1500);
    const dn = await dev(n.page);
    ok('W10c 沒登入：讀懸賞彙總用 ?actor=＜這台裝置的 id＞、不帶 Authorization',
      n.bme.length >= 1 && n.bme.every(x => !x.auth && x.search === '?actor=' + encodeURIComponent(dn)), JSON.stringify({ bme: n.bme, dn }));
    // 同一頁直接呼叫 fetchBountyMe：先 200（拿到 5 點）→ 503（保留 5 點：暫時性錯誤不清）→ 401（清成 null：你現在看不到這個帳）
    const r200 = await n.page.evaluate(async () => { const m = await fetchBountyMe(); return m && m.points; });
    n.mode.bme = '503';
    const r503 = await n.page.evaluate(async () => { const m = await fetchBountyMe(); return m && m.points; });
    n.mode.bme = '401';
    const r401 = await n.page.evaluate(async () => fetchBountyMe());
    ok('W10d 回應 200 拿到 5 點；503 保留原值 5（暫時性錯誤不清）；401 清成 null（登出後不再顯示帳號的資料）',
      r200 === 5 && r503 === 5 && r401 === null && n.errors.length === 0, JSON.stringify({ r200, r503, r401, errors: n.errors }));
    await n.ctx.close();
  });
} finally {
  if (browser) await browser.close().catch(() => {});
  server.closeAllConnections(); server.close();                        // 只關本輪自己起的這一個伺服器
  console.log(`[G0] 靜態伺服器：${served.n} 個請求、404 ${served.missing.size} 個路徑${served.missing.size ? '：' + [...served.missing].sort().join(' ') : ''}`);
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);

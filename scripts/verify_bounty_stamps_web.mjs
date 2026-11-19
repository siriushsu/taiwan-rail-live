// 搭乘集章 · 網頁車庫「印章簿＋集滿領車」驗收（契約 v3 3.0.1；畫面照 App GarageStamps，native claude/ride-stamps-app-1119）
// ——Playwright 真引擎（無視窗）＋ node 靜態伺服器 ＋ 打樁的 Firebase 與 /api（打樁寫法同 verify_bounty_chips_web.mjs）。
//
//   SW1 已登入、chips-me 有 stamps、規則檔有 chips.stamps：車庫有印章簿，兩組照規則檔順序；已蓋的格子寫第一次日期車次與搭過幾次，
//       沒蓋的寫「還沒搭過」；日常通勤寫「x / y」與「還差…」、沒有領車鈕；台鐵自強四款蓋滿、有「選一款車」
//   SW2 選一款車 → 清單是規則檔 chips.items 的順序、去掉已經有的；點一款開兌換視窗「領走「…」」「免費領走」；
//       送出 POST /api/stamp-claim（Bearer、actor＝帳號 uid、set、item、requestId）；200 之後「已入庫！這次沒有扣點數。」，
//       關掉視窗後那一組寫「已領過獎勵車」、領車鈕消失，車款格那一款變已入庫
//   SW3 409 claimed：「這組的獎勵之前就領過了…」；409 already：「你已經有這款車了…」；503：重試沿用同一個 requestId
//   SW4 對照：規則檔沒有 chips.stamps、chips-me 沒有 stamps、沒登入——三種都不出印章簿（同一頁 SW1 有）
//   SW5 英文介面：標題、組名（規則檔 names.en）、按鈕是英文，沒有漏中文
//   SW6 手機版：360／375／414／768 × Chromium／WebKit，車庫捲到印章簿、沒有水平捲動、格子不超出卡片；600 以下 2 欄、768 4 欄；
//       STAMPS_SHOT_DIR 設了就每個組合存一張截圖
// 跑法：node scripts/verify_bounty_stamps_web.mjs
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync, statSync, mkdirSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const attempt = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 15000, step = 100) {
  const t0 = Date.now();
  for (;;) { try { const v = await fn(); if (v) return v; } catch (e) {} if (Date.now() - t0 > timeout) return false; await sleep(step); }
}
const SHOT_DIR = process.env.STAMPS_SHOT_DIR || '';
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

// 期望值讀規則檔本身，不呼叫頁面的函式。
const RULES = JSON.parse(readFileSync(path.join(ROOT, 'data/bounty_rules.json'), 'utf8'));
const SETS = RULES.chips.stamps.sets, NAMES = RULES.chips.stamps.names, ITEM_IDS = Object.keys(RULES.chips.items);
const UID = 'uid-stamps-aaaa0001';
const OWNED = ITEM_IDS[1];                       // 已經換到的那一款：清單裡不能有它
const CHOSEN = ITEM_IDS[0];
const stamp = (id, n, day, train) => ({ id, n, first: { day, train } });
// tc4 四章全蓋；daily 只有 local、dr3100（700t、juguang 沒蓋）。日期車次刻意不同，判準才分得出是哪一格。
const CARS = [stamp('emu3000', 3, '2026-10-02', '123'), stamp('temu2000', 1, '2026-10-05', '408'), stamp('e1000', 2, '2026-10-07', '111'),
  stamp('temu1000', 1, '2026-10-09', '272'), stamp('local', 12, '2026-09-30', '1203'), stamp('dr3100', 1, '2026-10-11', '3671')];
const CHIPS = (over = {}) => ({ unit: 'point', balance: 40, unlocked: [], nextCost: 150, items: [{ item: OWNED }], stamps: { cars: CARS, claimed: [] }, ...over });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let f = null;
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); f = path.join(ROOT, p === '/' ? 'index.html' : p); if (!f.startsWith(ROOT + path.sep) || !statSync(f).isFile()) f = null; } catch (e) { f = null; }
  if (!f) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  createReadStream(f).on('error', () => res.destroy()).pipe(res);
});
const port = await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => res(server.address().port)); });
const BASE = `http://127.0.0.1:${port}`;

const STUB = (arg) => {
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
  const user = { uid: arg.uid, email: 't@example.com', getIdToken: async () => 'fake-id-token' };
  window.RAIL_FIREBASE_TEST_MODULES = {
    initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}), getIdToken: async () => 'fake-id-token',
    onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(arg.noUser ? null : user), 50); }, signOut: async () => {},
  };
  try { if (!arg.noUser) localStorage.setItem('trainmap-account-uid', arg.uid); } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { try { ofmNoticeShown = true; } catch (e) {} });
};

let chromiumBr = null, webkitBr = null;
async function newSession(br, arg = {}, ctxOpts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-TW', ...ctxOpts });
  await ctx.addInitScript(STUB, { uid: UID, ...arg });
  const s = { ctx, chipsBody: CHIPS(), rules: RULES, claims: [], claimMode: 'ok', errors: [] };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/*', async route => {
    const rq = route.request(), u = new URL(rq.url());
    if (u.hostname !== '127.0.0.1') return route.abort();
    if (u.pathname === '/api/chips-me') return json(route, 200, s.chipsBody);
    if (u.pathname === '/data/bounty_rules.json') return json(route, 200, s.rules);
    if (u.pathname === '/api/stamp-claim') {
      let body = null; try { body = JSON.parse(rq.postData()); } catch (e) {}
      s.claims.push({ body, auth: rq.headers()['authorization'] || null, method: rq.method() });
      const m = s.claimMode;
      if (m === 'claimed') return json(route, 409, { error: 'claimed' });
      if (m === 'already') return json(route, 409, { error: 'already' });
      if (m === '503') return json(route, 503, { error: 'claim_failed' });
      const items = [...s.chipsBody.items, { item: body.item }], stamps = { cars: CARS, claimed: [body.set] };
      s.chipsBody = { ...s.chipsBody, items, stamps };                 // 之後重讀錢包也是領完的狀態
      return json(route, 200, { ok: true, set: body.set, item: body.item, items, stamps });
    }
    if (u.pathname.startsWith('/api/')) return json(route, 200, {});
    return route.continue();
  });
  s.page = await ctx.newPage();
  s.page.on('pageerror', e => s.errors.push(String(e && e.message || e)));
  return s;
}
const boot = async (s, q = 'lang=zh-TW') => {
  await s.page.goto(`${BASE}/?${q}`);
  await s.page.waitForFunction(() => { try { return state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000 });
};
const openGarage = async (s, logged = true) => {
  if (logged) await s.page.waitForFunction(() => { try { return !!state.account?.user?.uid; } catch (e) { return false; } }, null, { timeout: 30000 });
  await s.page.evaluate(() => openTrainGarage());
  await s.page.waitForFunction(() => !!document.querySelector('#trainGarage .g-stamps'), null, { timeout: 30000 });
};
const book = page => page.evaluate(() => {
  const box = document.querySelector('#trainGarage .g-stamps');
  if (!box || box.hidden) return null;
  return { title: box.querySelector('h2').textContent, note: box.querySelector('.g-stamps-note').textContent,
    sets: [...box.querySelectorAll('.g-st-set')].map(x => ({ id: x.dataset.set, name: x.querySelector('.g-st-head b').textContent, sub: x.querySelector('.g-st-head small').textContent,
      slots: [...x.querySelectorAll('.g-st-slot')].map(el => ({ id: el.dataset.stamp, on: el.classList.contains('on'), text: [...el.querySelectorAll('b,small')].map(n => n.textContent).join('|') })),
      foot: x.querySelector('.g-st-foot').textContent, full: x.querySelector('.g-st-full')?.textContent || '', pick: !!x.querySelector('[data-stamp-pick]') })) };
});
const bookShown = page => until(() => book(page), 20000);

try {
  chromiumBr = await chromium.launch({ headless: true });

  await attempt('SW1', async () => {
    const s = await newSession(chromiumBr);
    await boot(s); await openGarage(s);
    const b = await bookShown(s.page);
    ok('SW1a 印章簿出現：標題、說明、兩組照規則檔順序（組名讀 names.zh）', !!b && b.title === '印章簿' && b.note === '懸賞錄程判定合格的每一趟，照班表的車種蓋一個章。'
      && b.sets.map(x => x.id).join() === SETS.map(x => x.id).join() && b.sets.every(x => x.name === NAMES[x.id].zh), JSON.stringify(b?.sets.map(x => [x.id, x.name])));
    const tc4 = b?.sets.find(x => x.id === 'tc4'), daily = b?.sets.find(x => x.id === 'daily');
    ok('SW1b 台鐵自強四款：四格照規則檔順序全蓋，EMU3000 那格寫「10/02 · 123 次」「搭過 3 次」；底列「4 / 4」、「蓋滿了！選一款兌換車…」、有「選一款車」',
      !!tc4 && tc4.slots.map(x => x.id).join() === SETS[0].cars.join() && tc4.slots.every(x => x.on) && /\|10\/02 · 123 次\|搭過 3 次$/.test(tc4.slots[0].text)
      && tc4.foot.trim() === '4 / 4' && tc4.full === '蓋滿了！選一款兌換車，不扣點數。' && tc4.pick && tc4.sub === '蓋滿 4 個，送一款兌換車自選', JSON.stringify(tc4));
    ok('SW1c 日常通勤：local（區間車通用章，名稱讀 names）與 DR3100 蓋了、700T 與莒光號寫「還沒搭過」；底列「2 / 4」「還差700T、莒光號」；只蓋章、沒有領車鈕',
      !!daily && daily.slots.map(x => (x.on ? '+' : '-') + x.id).join() === '+local,-700t,-juguang,+dr3100' && daily.slots[0].text.startsWith(NAMES.local.zh + '|09/30 · 1203 次|搭過 12 次')
      && daily.slots[1].text.endsWith('|還沒搭過') && /^2 \/ 4還差.+、.+$/.test(daily.foot.trim()) && !daily.pick && daily.full === '' && daily.sub === '只蓋章，不換車', JSON.stringify(daily));
    ok('SW1d 沒有頁面錯誤', s.errors.length === 0, s.errors.join(' | '));

    // ── SW2：選車 → 兌換視窗 → 領走 ──
    await s.page.click('#trainGarage [data-stamp-pick="tc4"]');
    const list = await until(() => s.page.evaluate(() => { const p = document.querySelector('#trainGarage .g-pick'); return p && !p.hidden && p.querySelector('.g-pick-car') ?
      { title: p.querySelector('h2').textContent, desc: p.querySelector('.g-pick-desc').textContent, items: [...p.querySelectorAll('.g-pick-car')].map(x => x.dataset.item) } : null; }));
    const expect = ITEM_IDS.filter(x => x !== OWNED);
    ok('SW2a 選一款車：清單是規則檔 chips.items 的順序、去掉已經有的那款；說明寫組名', !!list && list.title === '選一款車' && list.items.join() === expect.join()
      && list.desc.startsWith(`「${NAMES.tc4.zh}」蓋滿了`), JSON.stringify({ list, expect }));
    await s.page.click(`#trainGarage .g-pick-car[data-item="${CHOSEN}"]`);
    const dlg = await until(() => s.page.evaluate(() => { const r = document.querySelector('#trainGarage .g-redeem'), p = document.querySelector('#trainGarage .g-pick');
      return r && !r.hidden ? { pickHidden: p.hidden, title: r.querySelector('h2').textContent, desc: r.querySelector('.g-redeem-desc').textContent, msg: r.querySelector('.g-redeem-msg').textContent,
        go: r.querySelector('.g-redeem-go').textContent, goOn: !r.querySelector('.g-redeem-go').disabled && !r.querySelector('.g-redeem-go').hidden } : null; }));
    ok('SW2b 兌換視窗：選車卡關掉、標題「領走「…」」、說明不扣點數、按鈕「免費領走」可按', !!dlg && dlg.pickHidden && /^領走「.+」$/.test(dlg.title) && dlg.go === '免費領走' && dlg.goOn
      && dlg.desc === '蓋滿印章簿這一組的獎勵：不扣點數，換到就永久收進車庫。' && dlg.msg === '蓋滿這組的獎勵：不扣點數，一組只能領一款。', JSON.stringify(dlg));
    await s.page.click('#trainGarage .g-redeem-go');
    const after = await until(() => s.page.evaluate(() => { const m = document.querySelector('#trainGarage .g-redeem-msg').textContent; return /已入庫/.test(m) ? m : null; }));
    const c = s.claims[0];
    ok('SW2c 送出 POST /api/stamp-claim 一次：Bearer、actor＝帳號 uid、set tc4、item 是選的那款、有 requestId', s.claims.length === 1 && c.method === 'POST' && c.auth === 'Bearer fake-id-token'
      && c.body.actor === UID && c.body.set === 'tc4' && c.body.item === CHOSEN && typeof c.body.requestId === 'string' && c.body.requestId.length >= 16, JSON.stringify(s.claims));
    ok('SW2d 200 之後：「已入庫！這次沒有扣點數。」', after === '已入庫！這次沒有扣點數。', after);
    await s.page.click('#trainGarage .g-redeem-close');
    const b2 = await until(async () => { const x = await book(s.page); const t = x?.sets.find(y => y.id === 'tc4'); return t && !t.pick ? t : null; });
    const cell = await s.page.evaluate(id => { const row = document.querySelector(`#trainGarage .g-car[data-model="${id}"]`); return row ? row.textContent : null; }, CHOSEN.replace(/^train:/, ''));
    ok('SW2e 關掉視窗後：台鐵自強四款寫「已領過獎勵車」、沒有領車鈕；車款格那一款變已入庫', !!b2 && /已領過獎勵車/.test(b2.foot) && b2.full === '' && (cell === null || /已入庫/.test(cell)), JSON.stringify({ b2, cell }));
    ok('SW2f 沒有頁面錯誤', s.errors.length === 0, s.errors.join(' | '));
    await s.ctx.close();
  });

  await attempt('SW3', async () => {
    for (const [mode, re] of [['claimed', /^這組的獎勵之前就領過了，一組只能領一次。$/], ['already', /^你已經有這款車了，換一款吧。$/]]) {
      const s = await newSession(chromiumBr); s.claimMode = mode;
      await boot(s); await openGarage(s); await bookShown(s.page);
      await s.page.click('#trainGarage [data-stamp-pick="tc4"]');
      await s.page.waitForSelector(`#trainGarage .g-pick-car[data-item="${CHOSEN}"]`);
      await s.page.click(`#trainGarage .g-pick-car[data-item="${CHOSEN}"]`);
      await s.page.click('#trainGarage .g-redeem-go');
      const m = await until(() => s.page.evaluate(r => { const t = document.querySelector('#trainGarage .g-redeem-msg').textContent; return new RegExp(r).test(t) ? t : null; }, re.source));
      ok(`SW3-${mode} 409 ${mode}：訊息照 App 的說法`, !!m, m || await s.page.evaluate(() => document.querySelector('#trainGarage .g-redeem-msg').textContent));
      await s.ctx.close();
    }
    const s = await newSession(chromiumBr); s.claimMode = '503';
    await boot(s); await openGarage(s); await bookShown(s.page);
    await s.page.click('#trainGarage [data-stamp-pick="tc4"]');
    await s.page.waitForSelector(`#trainGarage .g-pick-car[data-item="${CHOSEN}"]`);
    await s.page.click(`#trainGarage .g-pick-car[data-item="${CHOSEN}"]`);
    await s.page.click('#trainGarage .g-redeem-go');
    const retry = await until(() => s.page.evaluate(() => { const g = document.querySelector('#trainGarage .g-redeem-go'); return g.dataset.do === 'RETRY' && !g.disabled ? g.textContent : null; }));
    s.claimMode = 'ok';
    await s.page.click('#trainGarage .g-redeem-go');
    const done = await until(() => s.page.evaluate(() => /已入庫/.test(document.querySelector('#trainGarage .g-redeem-msg').textContent)));
    ok('SW3-503 503 之後出「重試」，重試成功；兩次送的是同一個 requestId', retry === '重試' && done && s.claims.length === 2 && s.claims[0].body.requestId === s.claims[1].body.requestId, JSON.stringify(s.claims.map(x => x.body.requestId)));
    await s.ctx.close();
  });

  await attempt('SW4', async () => {
    const noRules = JSON.parse(JSON.stringify(RULES)); delete noRules.chips.stamps;
    const cases = [['規則檔沒有 chips.stamps', s => { s.rules = noRules; }, true], ['chips-me 沒有 stamps', s => { const b = CHIPS(); delete b.stamps; s.chipsBody = b; }, true], ['沒登入', () => {}, false]];
    for (const [name, set, logged] of cases) {
      const s = await newSession(chromiumBr, logged ? {} : { noUser: true }); set(s);
      await boot(s); await openGarage(s, logged);
      if (logged) await until(() => s.page.evaluate(() => { const b = document.querySelector('#trainGarage .g-scenes'); return b && !b.hidden; }));
      await sleep(1200);
      const hidden = await s.page.evaluate(() => document.querySelector('#trainGarage .g-stamps').hidden);
      ok(`SW4 ${name}：不出印章簿`, hidden === true);
      await s.ctx.close();
    }
  });

  await attempt('SW5', async () => {
    const s = await newSession(chromiumBr, {}, { locale: 'en-US' });
    await boot(s, 'lang=en'); await openGarage(s);
    const b = await bookShown(s.page);
    const txt = await s.page.evaluate(() => document.querySelector('#trainGarage .g-stamps').innerText);
    ok('SW5 英文：標題 Stamp book、組名讀 names.en、按鈕 Pick a train、整本沒有中文字', !!b && b.title === 'Stamp book' && b.sets[0].name === NAMES.tc4.en
      && /Pick a train/.test(txt) && !/[一-鿿]/.test(txt), txt.slice(0, 400));
    await s.ctx.close();
  });

  webkitBr = await webkit.launch({ headless: true });
  await attempt('SW6', async () => {
    for (const [engine, br] of [['chromium', chromiumBr], ['webkit', webkitBr]]) for (const w of [360, 375, 414, 768]) {
      const s = await newSession(br, {}, { viewport: { width: w, height: 800 }, isMobile: engine === 'chromium' && w < 768, hasTouch: true });
      await boot(s); await openGarage(s); await bookShown(s.page);
      await s.page.evaluate(() => document.querySelector('#trainGarage .g-stamps').scrollIntoView({ block: 'start' }));
      await sleep(300);
      const m = await s.page.evaluate(() => {
        const d = document.querySelector('#trainGarage'), box = document.querySelector('#trainGarage .g-stamps');
        const sets = [...box.querySelectorAll('.g-st-set')];
        const over = sets.some(set => { const r = set.getBoundingClientRect(); return [...set.querySelectorAll('.g-st-slot,.g-st-pick,.g-st-foot')].some(el => { const q = el.getBoundingClientRect(); return q.left < r.left - 0.5 || q.right > r.right + 0.5; }); });
        const cols = getComputedStyle(sets[0].querySelector('.g-st-grid')).gridTemplateColumns.split(' ').length;
        const pick = box.querySelector('.g-st-pick').getBoundingClientRect();
        return { hscroll: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1, over, cols, pickH: pick.height };
      });
      ok(`SW6 ${engine} ${w}px：沒有水平捲動、格子不超出卡片、${w <= 600 ? 2 : 4} 欄、領車鈕至少 44 px 高`, !m.hscroll && !m.over && m.cols === (w <= 600 ? 2 : 4) && m.pickH >= 44, JSON.stringify(m));
      if (SHOT_DIR) await s.page.screenshot({ path: path.join(SHOT_DIR, `stamps-${engine}-${w}.png`) });
      await s.ctx.close();
    }
  });
} finally {
  await chromiumBr?.close(); await webkitBr?.close(); server.close();
}
const fail = R.filter(x => !x.p);
console.log(`\n[stamps_web] ${R.length - fail.length}/${R.length} 通過`);
process.exit(fail.length ? 1 : 0);

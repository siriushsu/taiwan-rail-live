// 跟車即時動態(Live Activity LA-0)JS 側驗證(2026-08-02,Plus 開賣 Task 5)——Playwright 真引擎 + 本機靜態伺服器。
//
// 背景:Swift 那半(版面、ActivityKit)只能靠模擬器手測、無法迴歸;但 index.html 裡
//   laSync()／laPayload()／liveActivityAllowed() 的行為**全部**測得到——注入一個假的
//   window.RAIL_NATIVE_LIVEACTIVITY 當記錄器,然後驅動「真實的」跟車流程
//   (followTrainNo／updateFollowPanel／clearFollow 都是產品函式)。
//   本檔是模擬器實測的**補充,不是取代**。
//
// 判準寫在效果上,不寫在「有沒有寫測試」上——三條自我約束:
//  (1) 斷言一律落在產品程式碼的行為上(記錄器收到的呼叫序列),不是落在腳本自己塞進去的 state。
//      唯二注入的東西是「訂閱旗標」(state.plus.active,瀏覽器裡買不到真訂閱)與「假橋接」
//      (瀏覽器裡沒有原生 plugin)——它們是環境,不是被測邏輯。中間的 key 判斷、節流、收卡
//      全部走真的 index.html。
//  (2) 每條斷言都配一發瞄準它語意的突變(見檔尾對照表),突變打在**產品碼**上,不是打在 DOM/state。
//  (3) 凡「必須是 0／必須沒被呼叫」型的斷言一律配正向對照(同一支記錄器要能在對照情境真的記到東西),
//      否則分不出「真的沒發生」與「記錄器根本沒掛上」。
//
// G0 自檢(心得32):ROOT 由本檔自身路徑推導,不吃 --root/env——結構上不可能驗到別的 worktree
//   (本機 30+ 個並行)。伺服器直接 readFileSync 這個 ROOT 底下的檔案,不連任何既有 dev server;
//   連接埠取 0(由 OS 指派)故不可能撞到別的 session 釘死的 5178/5179。
//   斷言「伺服器吐出來的 index.html 位元組 === ROOT/index.html」,本檔可原封不動複製進突變
//   worktree 跑(ROOT 自動跟著指過去、md5 也會如實印出被動過手腳的那份)。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// G0 第二半:證明「等一下瀏覽器抓到的」就是 ROOT 這棵樹的檔案(不是別人 session 的 server)
{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  ok('G0 伺服器吐出的 index.html 與 ROOT 逐 byte 相同', served === INDEX_MD5, `served=${served} root=${INDEX_MD5}`);
}

// 假橋接必須在頁面腳本執行「之前」就位——index.html 的
// `const LIVE_ACTIVITY_ENABLED = !!window.RAIL_NATIVE_LIVEACTIVITY` 是求值一次的常數。
async function boot(browser, { bridge = true, plus = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ bridge }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    if (!bridge) return;
    window.__laCalls = [];
    const rec = (m, p) => {
      window.__laCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null, t: Date.now() });
      return Promise.resolve({ ok: true });
    };
    window.RAIL_NATIVE_LIVEACTIVITY = {
      start: p => rec('start', p),
      update: p => rec('update', p),
      end: () => rec('end', null),
    };
  }, { bridge });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  if (plus) await setPlus(page, true);
  return { ctx, page, errors };
}

// 唯一注入的「環境」:訂閱資格。形狀比照 index.html plusState() 的初值。
const setPlus = (page, on) => page.evaluate(v => {
  state.plus = { active: v, founding: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
}, on);

const calls = (page, m) => page.evaluate(mm => (window.__laCalls || []).filter(c => !mm || c.m === mm), m);
const clearCalls = page => page.evaluate(() => { window.__laCalls = []; });

// 挑一班「此刻真的在跑」的台鐵車,交給真的 followTrainNo()
const followRunningTRA = (page, pick = 0) => page.evaluate(p => {
  const run = state.trains.filter(t => {
    if (t.sys !== 'tra_sched' || t.loop) return false;
    const e = effTLive(t), s = t.stops;
    return e > s[0].depSec + 60 && e < s[s.length - 1].arrSec - 300;
  });
  if (!run.length) return null;
  const tr = run[Math.min(run.length - 1, Math.floor(run.length * (p === 0 ? 0.3 : 0.7)))];
  followTrainNo(String(tr.train), { sys: tr.sys });   // ← 真實產品函式
  return state.followTrain ? { no: String(state.followTrain.train), sys: state.followTrain.sys } : null;
}, pick);

const cr = await chromium.launch();

// ══════════ T0：橋接在位(後面所有斷言的前提) ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const en = await page.evaluate(() => LIVE_ACTIVITY_ENABLED);
  ok('T0 有原生橋接時 LIVE_ACTIVITY_ENABLED===true', en === true, `值=${en}`);
  ok('T0 開站無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T1：Plus 跟車 → 開一張卡,payload 對得上跟隨面板 ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  await clearCalls(page);
  const f = await followRunningTRA(page);
  ok('T1 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForTimeout(600);
  const st = await calls(page, 'start');
  ok('T1 跟車後 start 恰好 1 次', st.length === 1, `start=${st.length} 全部=${JSON.stringify((await calls(page)).map(c => c.m))}`);
  // 🔴 這一條專門給 followTrainNo() 裡的 laSync(tr,true) 留牙:少了它序列只會是 ['start']
  //    (卡片還是開得起來,因為 setFollow→showFollowPanel→updateFollowPanel 那條路已經 start 過),
  //    所以「start 恰好 1 次」照樣會綠 ⇒ 那個呼叫點等於沒被驗到。force 的可觀測效果就是緊接著的這一發 update。
  const seq = (await calls(page)).map(c => c.m);
  ok('T1 呼叫序列恰為 [start, update](followTrainNo 的 force 立刻補推一次)',
    JSON.stringify(seq) === JSON.stringify(['start', 'update']), JSON.stringify(seq));
  const p = st[0] ? st[0].p : null;
  ok('T1 payload.trainNo/sys 與實際跟隨的車相符', !!p && f && p.trainNo === f.no && p.sys === f.sys, JSON.stringify(p));
  // 獨立來源交叉比對:#fpNext 是跟隨面板自己的渲染器寫的,不是本腳本重算的
  const panelNext = await page.evaluate(() => document.getElementById('fpNext').textContent.trim());
  ok('T1 payload.nextStop === 跟隨面板 #fpNext(獨立渲染器)', !!p && p.nextStop === panelNext, `payload=${p && p.nextStop} 面板=${panelNext}`);
  const iso = p && Date.parse(p.arrivalIso);
  ok('T1 arrivalIso 是未來且 3 小時內的合法時刻', !!iso && iso > Date.now() - 1000 && iso < Date.now() + 3 * 3600e3, String(p && p.arrivalIso));
  ok('T1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T2：同一台車不重開卡(_laKey 相同 ⇒ 只 update) ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  await clearCalls(page);
  const f = await followRunningTRA(page);
  ok('T2 前置:成功跟車', !!f, JSON.stringify(f));
  await page.waitForTimeout(400);
  // 再跟同一台車一次 + 連打真正的 updateFollowPanel(每秒被叫的那支)
  await page.evaluate(no => followTrainNo(no, { sys: state.followTrain.sys }), f.no);
  await page.evaluate(() => { for (let i = 0; i < 20; i++) updateFollowPanel(state.followTrain); });
  await page.waitForTimeout(300);
  const st = await calls(page, 'start');
  ok('T2 同一台車重複跟隨/重複 tick:start 仍只有 1 次(不重開卡)', st.length === 1, `start=${st.length}`);
  ok('T2 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T3：換車 → 開新卡 ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  await clearCalls(page);
  const a = await followRunningTRA(page, 0);
  await page.waitForTimeout(300);
  const b = await followRunningTRA(page, 1);
  await page.waitForTimeout(300);
  ok('T3 前置:兩班不同的車', !!a && !!b && a.no !== b.no, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  const st = await calls(page, 'start');
  ok('T3 換車後 start 累計 2 次', st.length === 2, `start=${st.length}`);
  ok('T3 第 2 張卡的車次 === 後來那班', st.length === 2 && b && st[1].p.trainNo === b.no, JSON.stringify(st.map(s => s.p.trainNo)));
  ok('T3 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T4：車次撞號但系統別不同 ⇒ 必須是兩張卡(_laKey 一定要含 sys) ══════════
// 專案鐵則:台鐵與高鐵真的有同號車。這條若沒牙,跨系統跟車會沿用前一張卡。
// 走 laSync() 本人而不繞 followTrainNo:切換時刻表系統會經過 clearFollow()(它自己就會重設 _laKey),
// 那樣不論 key 有沒有含 sys 都會開新卡 ⇒ 判準會變成永遠的假綠。
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const pair = await page.evaluate(() => {
    const bySys = {};
    for (const s of state.systems.filter(x => x.mode === 'sched')) {
      const ts = (s.data && s.data.trains) || [];
      if (ts.length) bySys[s.id] = ts;
    }
    const tra = bySys['tra_sched'] || [], thsr = bySys['thsr_sched'] || [];
    const win = t => { const s = t.stops; return [s[0].depSec + 120, s[s.length - 1].arrSec - 300]; };
    for (const a of tra) {
      if (a.loop) continue;
      const b = thsr.find(x => String(x.train) === String(a.train) && !x.loop);
      if (!b) continue;
      const [a0, a1] = win(a), [b0, b1] = win(b);
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (hi - lo < 300) continue;          // 需要一段兩班同時在跑的時間窗
      state.simSec = Math.floor((lo + hi) / 2); state.clockAtNow = false;
      window.__laCalls = [];
      laSync(a, true);                       // ← 真實產品函式
      laSync(b, true);
      return { no: String(a.train), simSec: state.simSec };
    }
    return null;
  });
  if (!pair) {
    ok('T4 台鐵/高鐵同號車:兩張卡(key 含 sys)', false, '找不到同時在跑的撞號車對 ⇒ 判準無法執行(視為未通過,勿當成綠燈)');
  } else {
    const cs = await calls(page);
    const st = cs.filter(c => c.m === 'start');
    ok('T4 前置:找到撞號車對並各推一次', cs.length >= 2, `車次=${pair.no} 序列=${JSON.stringify(cs.map(c => c.m))}`);
    ok('T4 同號但不同系統 ⇒ start 2 次(不是 1 次 start + 1 次 update)', st.length === 2,
      `車次=${pair.no} start=${st.length} 序列=${JSON.stringify(cs.map(c => c.m))}`);
    ok('T4 兩張卡的 sys 不同、車次相同', st.length === 2 && st[0].p.sys !== st[1].p.sys && st[0].p.trainNo === st[1].p.trainNo,
      JSON.stringify(st.map(s => s.p.sys + '#' + s.p.trainNo)));
  }
  ok('T4 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T5：10 秒節流(倒數由系統自走,逐秒推是浪費) ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T5 前置:成功跟車', !!f, JSON.stringify(f));
  await page.waitForTimeout(400);
  await clearCalls(page);
  // 連打 30 次真正的 updateFollowPanel(它結尾就是 laSync(tr,false))
  await page.evaluate(() => { for (let i = 0; i < 30; i++) updateFollowPanel(state.followTrain); });
  await page.waitForTimeout(200);
  const burst = (await calls(page, 'update')).length;
  ok('T5 10 秒窗內連打 30 次 tick:update ≤ 1 次(節流生效)', burst <= 1, `update=${burst}`);
  ok('T5 節流期間不會誤開新卡', (await calls(page, 'start')).length === 0, `start=${(await calls(page, 'start')).length}`);
  // 正向對照:節流窗過了就必須真的推得出去(證明上面的「≤1」不是因為整條路徑死掉)
  await clearCalls(page);
  await page.waitForTimeout(10500);
  await page.evaluate(() => updateFollowPanel(state.followTrain));
  await page.waitForTimeout(200);
  const after = (await calls(page, 'update')).length;
  ok('T5 正向對照:超過 10 秒後的 tick 真的推得出 update(≥1)', after >= 1, `update=${after}`);
  ok('T5 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T6：clearFollow() 收卡,而且 key 有重設 ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T6 前置:成功跟車', !!f, JSON.stringify(f));
  await page.waitForTimeout(400);
  await clearCalls(page);
  await page.evaluate(() => clearFollow());          // ← 真實產品函式
  await page.waitForTimeout(200);
  ok('T6 停止跟車 ⇒ end 被呼叫(≥1)', (await calls(page, 'end')).length >= 1, `end=${(await calls(page, 'end')).length}`);
  // 收卡後再跟同一台車:必須是 start(證明 _laKey 真的被清掉,不是只送了個 end)
  await clearCalls(page);
  await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), f.no);
  await page.waitForTimeout(400);
  ok('T6 收卡後再跟同一台車 ⇒ 重新 start(_laKey 已重設)', (await calls(page, 'start')).length === 1,
    `start=${(await calls(page, 'start')).length}`);
  ok('T6 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T7：抵達終點(nextStopInfo 回 null)⇒ 收卡,不是靜默不動 ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T7 前置:成功跟車', !!f, JSON.stringify(f));
  await page.waitForTimeout(400);
  await clearCalls(page);
  const moved = await page.evaluate(() => {
    const tr = state.followTrain; if (!tr) return null;
    state.simSec = tr.stops[tr.stops.length - 1].arrSec % 86400 + 30; // 撥到終點之後
    state.clockAtNow = false;
    const info = nextStopInfo(tr, effTLive(tr));
    laSync(tr, false);                                // ← 真實產品函式
    return { infoNull: info === null };
  });
  ok('T7 前置:時鐘撥到終點後 nextStopInfo 真的回 null', !!moved && moved.infoNull === true, JSON.stringify(moved));
  ok('T7 算不出下一站 ⇒ end 被呼叫', (await calls(page, 'end')).length >= 1, `end=${(await calls(page, 'end')).length}`);
  ok('T7 算不出下一站時不會送出 start/update', (await calls(page, 'start')).length === 0 && (await calls(page, 'update')).length === 0,
    `start=${(await calls(page, 'start')).length} update=${(await calls(page, 'update')).length}`);
  ok('T7 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T8：未訂閱 ⇒ 完全不開卡(附正向對照,否則零分不出「沒發生」與「沒掛上」) ══════════
{
  const { ctx, page, errors } = await boot(cr, { plus: false });
  await setPlus(page, false);
  await clearCalls(page);
  const f = await followRunningTRA(page);
  ok('T8 前置:未訂閱也要能正常跟車(功能本身不受影響)', !!f, JSON.stringify(f));
  await page.evaluate(() => { for (let i = 0; i < 10; i++) updateFollowPanel(state.followTrain); });
  await page.waitForTimeout(300);
  const st0 = (await calls(page, 'start')).length;
  ok('T8 未訂閱:start 零次', st0 === 0, `start=${st0}`);
  ok('T8 未訂閱:update 零次', (await calls(page, 'update')).length === 0, `update=${(await calls(page, 'update')).length}`);
  // 🔴 正向對照:同一頁、同一支記錄器,開通後必須真的記到 start。
  // ⚠️ clearCalls 必須在 setPlus(true) 之「前」:跟車期間每秒都有自然 tick 在跑,
  //    若先開通再清空,那一發自然 tick 開的卡會被 clearCalls 抹掉,而接著這一發明示呼叫
  //    又因為 key 已存在且在 10 秒節流窗內而不送 ⇒ start=0 的**偶發假紅**(實測重現過一次)。
  await clearCalls(page);
  await setPlus(page, true);
  await page.evaluate(() => updateFollowPanel(state.followTrain));
  await page.waitForTimeout(300);
  const st1 = (await calls(page, 'start')).length;
  ok('T8 正向對照:同一支記錄器在開通 Plus 後真的記到 start(證明上面的零不是假綠)', st1 >= 1, `start=${st1}`);
  ok('T8 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T9：純網站(沒有原生橋接)⇒ 安靜地什麼都不做、零 console 錯誤 ══════════
{
  const { ctx, page, errors } = await boot(cr, { bridge: false, plus: true });
  const en = await page.evaluate(() => LIVE_ACTIVITY_ENABLED);
  ok('T9 沒有橋接時 LIVE_ACTIVITY_ENABLED===false', en === false, `值=${en}`);
  const f = await followRunningTRA(page);
  ok('T9 前置:純網站照樣跟得了車', !!f, JSON.stringify(f));
  await page.evaluate(() => { for (let i = 0; i < 10; i++) updateFollowPanel(state.followTrain); });
  await page.evaluate(() => clearFollow());
  await page.waitForTimeout(300);
  ok('T9 純網站跟車→停車全程零 JS 例外', errors.length === 0, errors.slice(0, 5).join(' | '));
  // 正向對照:證明這一頁的錯誤收集器真的在收(否則「零例外」是假綠)。
  // ⚠️ page.evaluate(() => { throw }) 的例外會被 Playwright 以 rejection 接回 Node,一筆都收不到,
  //    必須丟在頁面自己的 task 裡(setTimeout)。
  await page.evaluate(() => { setTimeout(() => { throw new Error('__collector_probe__'); }, 0); });
  await page.waitForTimeout(400);
  ok('T9 正向對照:錯誤收集器抓得到故意丟的例外', errors.some(s => s.includes('__collector_probe__')), `收到 ${errors.length} 筆`);
  await ctx.close();
}

await cr.close();
server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);

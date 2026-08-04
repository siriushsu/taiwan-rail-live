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
import { chromium, webkit } from 'playwright';
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
async function boot(browser, { bridge = true, plus = false, startResult = null, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ bridge, startResult }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    if (!bridge) return;
    window.__laCalls = [];
    // 原生端的三條失敗路徑是 resolve 而不是 reject(見 RailLiveActivityPlugin.swift 的
    // ios<17.6／disabled／request 丟錯),所以這裡也用 resolve 回傳 {ok:false, why} 來模擬。
    window.__laStartResult = startResult || { ok: true };
    const rec = (m, p) => {
      window.__laCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null, t: Date.now() });
      return Promise.resolve(m === 'start' ? window.__laStartResult : { ok: true });
    };
    window.RAIL_NATIVE_LIVEACTIVITY = {
      start: p => rec('start', p),
      update: p => rec('update', p),
      end: () => rec('end', null),
    };
  }, { bridge, startResult });
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
  // 🔴 上面那條只驗「落在一個很寬的區間裡」,把 min*60000 誤寫成 min*1000 照樣會綠。
  //    這一條把 arrivalIso 換算回分鐘,與跟隨面板 #fpEta 自己算的 Math.round(info.min) 對帳
  //    (面板是獨立渲染器,不是本腳本重算的)——單位錯一個量級就會當場現形。
  {
    const panel = await page.evaluate(() => {
      const b = document.querySelector('#fpEta b');
      return { bold: b ? b.textContent.trim() : '', txt: document.getElementById('fpEta').textContent.trim() };
    });
    const payMin = iso ? (iso - Date.now()) / 60000 : NaN;
    let pass, detail;
    if (panel.bold) {
      const pm = parseFloat(panel.bold);
      pass = Number.isFinite(pm) && Math.abs(payMin - pm) < 1;      // 面板取整,容差 1 分
      detail = `payload=${payMin.toFixed(2)} 分,面板=${pm} 分`;
    } else {
      // 面板在 <1 分時顯示「即將進站」而不畫粗體分鐘數——這一支也要判,不能靜默跳過
      pass = /即將進站/.test(panel.txt) && payMin < 1.5 && payMin > -0.2;
      detail = `面板顯示「${panel.txt}」,payload=${payMin.toFixed(2)} 分`;
    }
    ok('T1 arrivalIso 換算的分鐘數 === 跟隨面板顯示的分鐘數(獨立渲染器,差 <1 分)', pass, detail);
  }
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
      // 🔴 clockAtNow 必須留 true:laSync 有一道「非跟著現在＋1× 就收卡」的閘門(時光機防護),
      //    這裡若把它設 false,兩發 laSync 都會被閘門吃掉 ⇒ start=0,這條判準就變成在驗閘門
      //    而不是在驗 key 含不含 sys。把「現在」當成那段重疊時間窗的中點才是這個情境的忠實模型。
      state.simSec = Math.floor((lo + hi) / 2); state.clockAtNow = true;
      window.__laCalls = [];
      laSync(a, true);                       // ← 真實產品函式
      laSync(b, true);
      return { no: String(a.train), simSec: state.simSec, gateOpen: state.clockAtNow && state.playing && state.speedMult === 1 };
    }
    return null;
  });
  if (!pair) {
    ok('T4 台鐵/高鐵同號車:兩張卡(key 含 sys)', false, '找不到同時在跑的撞號車對 ⇒ 判準無法執行(視為未通過,勿當成綠燈)');
  } else {
    const cs = await calls(page);
    const st = cs.filter(c => c.m === 'start');
    ok('T4 前置:找到撞號車對並各推一次(且時光機閘門是開的,不是它造成的結果)',
      cs.length >= 2 && pair.gateOpen === true, `車次=${pair.no} 閘門開=${pair.gateOpen} 序列=${JSON.stringify(cs.map(c => c.m))}`);
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
    // 🔴 clockAtNow 留 true:這條要驗的是「nextStopInfo 回 null ⇒ 收卡」,不是時光機閘門。
    //    設 false 的話收卡會變成閘門造成的,判準等於被抽掉。真實世界裡這個情境本來就是
    //    「跟著現在、時間自己走到終點」,把時間快轉正是它的忠實模型。
    state.clockAtNow = true;
    const info = nextStopInfo(tr, effTLive(tr));
    laSync(tr, false);                                // ← 真實產品函式
    return { infoNull: info === null, gateOpen: state.clockAtNow && state.playing && state.speedMult === 1 };
  });
  ok('T7 前置:時鐘撥到終點後 nextStopInfo 真的回 null(且時光機閘門是開的)',
    !!moved && moved.infoNull === true && moved.gateOpen === true, JSON.stringify(moved));
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
  // 🔴 未訂閱者跟車時 laSync 每秒都會走到收卡那一支。從沒開過卡就不該過橋——
  //    無條件送 end 等於每秒一發跨語言呼叫做白工(掃孤兒住在原生端 load(),與這裡無關)。
  ok('T8 未訂閱且從未開過卡:end 也是零次(不做每秒一發的白工)',
    (await calls(page, 'end')).length === 0, `end=${(await calls(page, 'end')).length}`);
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
  // 🔴 上面「end 零次」的正向對照,同時也是「訂閱中途失效那一刻卡片收得掉」的證明:
  //    此刻 _laKey 非空 ⇒ 第一發 end 必須送得出去,之後才安靜(不是從頭到尾都不送)。
  await page.waitForTimeout(300);
  await clearCalls(page);
  await setPlus(page, false);
  await page.evaluate(() => { for (let i = 0; i < 10; i++) updateFollowPanel(state.followTrain); });
  await page.waitForTimeout(300);
  const endN = (await calls(page, 'end')).length;
  ok('T8 正向對照:訂閱失效後連打 10 次 tick ⇒ end 恰好 1 次(收得掉,而且只送一次)', endN === 1, `end=${endN}`);
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

// ══════════ T10：原生端「resolve 但 ok:false」的開卡失敗 ⇒ 依 why 分流 ══════════
// 背景:plugin 有三條 resolve(不是 reject)的失敗路徑——裝置低於 17.6、使用者在系統設定關掉
// 即時動態、Activity.request 丟錯。不看回傳就等於「_laKey 已寫入 ⇒ 之後只走 update ⇒ 每發都
// 回 noactivity」,這台車直到換車前永遠不會有卡片,而且零診斷零重試。
{
  // ── (a) disabled(使用者關掉即時動態):可回復 ⇒ 清鍵,節流窗到期後自然重試 ──
  const { ctx, page, errors } = await boot(cr, { plus: true, startResult: { ok: false, why: 'disabled' } });
  await clearCalls(page);
  const f = await followRunningTRA(page);
  ok('T10a 前置:成功跟車(原生端會回報開卡失敗)', !!f, JSON.stringify(f));
  await page.waitForTimeout(3000);              // 期間每秒都有自然 tick 在跑
  const early = await calls(page);
  ok('T10a 失敗後 3 秒內不重試(每秒一發的重試洗版要被節流擋住)',
    early.filter(c => c.m === 'start').length === 1, `start=${early.filter(c => c.m === 'start').length}`);
  await page.waitForTimeout(8200);              // 跨過 10 秒節流窗
  await page.evaluate(() => updateFollowPanel(state.followTrain));
  await page.waitForTimeout(300);
  const late = await calls(page);
  const lateStart = late.filter(c => c.m === 'start').length;
  // 起跟那一瞬間的 [start, update] 是**設計行為**(followTrainNo 的 force,T1 就是在釘它):
  // start 是同步發出的、_laKey 也同步寫入,失敗回呼要到微任務才跑得到,所以那一發 update
  // 攔不掉也不必攔(原生端沒有卡片,它是 no-op)。真正要判的是**那之後**發生什麼。
  const t0 = (late.find(c => c.m === 'start') || {}).t || 0;
  const after = late.filter(c => c.t > t0 + 2000);
  // 🔴 這兩條分別鎖住修法的兩半:重試真的發生(≥2 次 start)＋重試走的是 start 不是 update
  //    (沒清鍵的話 key 還在,起跟兩秒後的每一發都會是 update ⇒ 原生端一律回 noactivity)
  ok('T10a 節流窗到期後真的重試(start ≥2)', lateStart >= 2, `start=${lateStart}`);
  ok('T10a 起跟 2 秒後的呼叫全是 start、至少一發(_laKey 真的被清掉,不是改推 update)',
    after.length >= 1 && after.every(c => c.m === 'start'),
    `2 秒後=${JSON.stringify(after.map(c => c.m))} 全序列=${JSON.stringify(late.map(c => c.m))}`);
  ok('T10a 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // ── (b) ios<17.6(裝置本來就不支援):永久放棄,重試只是浪費 ──
  // 「start 停在 1」是零型斷言,正向對照＝上面 T10a 用同一支記錄器、同一條流程跑出 start ≥2。
  const { ctx, page, errors } = await boot(cr, { plus: true, startResult: { ok: false, why: 'ios<17.6' } });
  await clearCalls(page);
  const f = await followRunningTRA(page);
  ok('T10b 前置:成功跟車', !!f, JSON.stringify(f));
  await page.waitForTimeout(11500);             // 跨過節流窗:可回復的失敗到這裡早就重試了
  await page.evaluate(() => updateFollowPanel(state.followTrain));
  await page.waitForTimeout(300);
  const cs = await calls(page);
  const b0 = (cs.find(c => c.m === 'start') || {}).t || 0;
  const bAfter = cs.filter(c => c.t > b0 + 2000);   // 同 T10a:起跟那發 [start, update] 是設計行為
  ok('T10b 裝置不支援 ⇒ 不重試(start 停在 1,對照 T10a 的 ≥2)',
    cs.filter(c => c.m === 'start').length === 1, `start=${cs.filter(c => c.m === 'start').length}`);
  ok('T10b 裝置不支援 ⇒ 起跟 2 秒後整條路徑安靜(零呼叫,對照 T10a 的 ≥1)',
    bAfter.length === 0, `2 秒後=${JSON.stringify(bAfter.map(c => c.m))} 全序列=${JSON.stringify(cs.map(c => c.m))}`);
  ok('T10b 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T11：時光機/加速中不得出現倒數(護照灰章重播) ══════════
// 鎖定畫面的倒數是以真實時鐘 1× 自走的;模擬時鐘撥回發車前並轉 30× 之後,推出去的
// arrivalIso 是一個憑空捏造、而且真的在走的倒數——與 plugin 刻意擋掉的 nil-fallback 同一類傷害。
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  await clearCalls(page);
  // 🔴 重播的必須是**另一台**車:重播同一台車時 _laKey 不變,「start 零次」在有沒有閘門的版本
  //    都會成立 ⇒ 那條斷言等於沒牙(實測突變 M16 抓到這件事,已改成兩台不同的車)。
  const two = await page.evaluate(() => {
    const run = state.trains.filter(t => {
      if (t.sys !== 'tra_sched' || t.loop) return false;
      const e = effTLive(t), s = t.stops;
      return e > s[0].depSec + 60 && e < s[s.length - 1].arrSec - 300;
    });
    if (run.length < 2) return null;
    const a = run[Math.floor(run.length * 0.3)], b = run[Math.floor(run.length * 0.7)];
    if (String(a.train) === String(b.train)) return null;
    followTrainNo(String(a.train), { sys: a.sys });       // 先正常跟 A(真實產品函式)
    return { a: String(a.train), b: String(b.train), bsys: b.sys };
  });
  await page.waitForTimeout(600);
  const warm = (await calls(page, 'start')).length;
  // 這一條同時是下面三條零型斷言的正向對照:同一頁、同一支記錄器,正常跟車時記得到 start
  ok('T11 前置/正向對照:正常跟 A 車先開出一張真的卡', !!two && warm >= 1, `start=${warm} ${JSON.stringify(two)}`);
  await clearCalls(page);
  await page.evaluate(t => followTrainNo(t.b, { fromStart: true, sys: t.bsys }), two); // ← 護照灰章的真實呼叫(換 B 車)
  await page.waitForTimeout(700);
  const tm = await page.evaluate(() => ({ atNow: state.clockAtNow, spd: state.speedMult, playing: state.playing }));
  ok('T11 前置:重播真的進了時光機(clockAtNow=false 且 30×)',
    tm.atNow === false && tm.spd === 30, JSON.stringify(tm));
  const cs = await calls(page);
  ok('T11 灰章重播 B 車(時光機＋30×)⇒ start 零次(換了車也不開卡,不推假倒數)',
    cs.filter(c => c.m === 'start').length === 0, `序列=${JSON.stringify(cs.map(c => c.m))}`);
  ok('T11 灰章重播 ⇒ 既有的真卡片被收掉(end ≥1)',
    cs.filter(c => c.m === 'end').length >= 1, `end=${cs.filter(c => c.m === 'end').length}`);
  ok('T11 灰章重播 ⇒ update 也零次(不是「卡片留著但推假時間」)',
    cs.filter(c => c.m === 'update').length === 0, `update=${cs.filter(c => c.m === 'update').length}`);
  ok('T11 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await cr.close();

// ══════════ T12：更新紀錄兩條 li 的四寬度幾何(WebKit) ══════════
// 本次唯一的 DOM 變更就是更新紀錄那兩條 li(第一層摘要 + 巢狀主題組正本)。專案鐵則:任何 UI
// 變更都要掃 360/375/414/768 且至少一路 WebKit(macOS/iOS 使用者的引擎)。這一區沒有新控件,
// 所以驗的是幾何與存在性,不做觸控命中測試。
{
  const wk = await webkit.launch();
  const rows = [];
  for (const w of [360, 375, 414, 768]) {
    const { ctx, page } = await boot(wk, { plus: false, viewport: { width: w, height: 800 } });
    // 頁面橫捲要在「原始狀態」量:先把所有 details 展開再量,量到的會是展開造成的既有溢出,不是本次變更
    const natural = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    // 🔴 ≤900 是手機殼:placeFootBoxes() 把更新紀錄搬進「更多」抽屜的「關於」段,抽屜沒開時
    //    整段是收起來的(量到的高度會是 0)。要驗它就得先照使用者的路徑把抽屜打開——點真的那顆鈕。
    await page.click('#tabMore');
    await page.waitForTimeout(500);
    const geo = await page.evaluate(() => {
      document.querySelectorAll('details').forEach(d => { d.open = true; });
      // 🔴 2026-08-04 改判準:原本用 /鎖定畫面/ 文字比對並寫死「恰好 2 條」(第一層一條＋第二層正本
      //    一條)。第一層是「最近更新」,有 8 條上限、新功能一來舊的就會被擠進第二層——那是設計,
      //    不是缺陷(CL1 保證擠出去之前正本必須先存在)。所以條數是會漂移的量,綁它等於讓這條判準
      //    在下一次有人加更新紀錄時假紅。改成綁身分:正本(data-cl)必須在,第一層那條(data-cl-of)
      //    有就一起量幾何、沒有也不算錯。
      const lis = [...document.querySelectorAll('li[data-cl="liveactivity"], li[data-cl-of="liveactivity"]')];
      return lis.map(li => {
        const r = li.getBoundingClientRect(), pr = li.parentElement.getBoundingClientRect();
        return { h: Math.round(r.height), overRight: Math.round(r.right - pr.right), overLeft: Math.round(pr.left - r.left),
          canon: !!li.getAttribute('data-cl') };
      });
    });
    rows.push({ w, natural, geo });
    await ctx.close();
  }
  await wk.close();
  const fmt = rows.map(r => `${r.w}px:找到${r.geo.length}條 高=${r.geo.map(g => g.h).join('/')} 右溢=${r.geo.map(g => g.overRight).join('/')} 捲寬${r.natural.sw}/${r.natural.cw}`).join(' ; ');
  ok('T12 四寬度(360/375/414/768,WebKit):Live Activity 更新紀錄的第二層正本恰好一條、且抓到的每一條都渲染得出來(高度 >0)',
    rows.every(r => r.geo.filter(g => g.canon).length === 1 && r.geo.length > 0 && r.geo.every(g => g.h > 0)), fmt);
  ok('T12 四寬度:更新紀錄 li 不超出容器左右緣',
    rows.every(r => r.geo.every(g => g.overRight <= 1 && g.overLeft <= 1)), fmt);
  ok('T12 四寬度:頁面無橫向捲動',
    rows.every(r => r.natural.sw <= r.natural.cw + 1), fmt);
}

server.close();

// ══════════ 斷言總數閘門(比照 verify_founding_seal.mjs 的形狀) ══════════
// 用途:條件式區塊整批消失時,分母跟著變小、收尾只印「N/N PASS」⇒ 會被當成全綠。
// 注意 T4 走「找不到撞號車對」那一支時只產 2 條(其中一條刻意記 FAIL),這道閘門會跟著紅——
// 那是預期行為:資料裡沒有撞號車對時,那條判準本來就沒被執行,不該當成通過。
const EXPECTED_COUNTS = { G0: 1, T0: 2, T1: 8, T2: 3, T3: 4, T4: 4, T5: 5, T6: 4, T7: 5, T8: 7, T9: 4, T10a: 5, T10b: 4, T11: 6, T12: 3 };
const actualCounts = {};
// `T\d+[ab]?`:T10a/T10b 是兩個獨立情境(可回復 vs 不可回復),分開記數才不會互相掩護
for (const r of results) { const m = /^([GT]\d+[ab]?)/.exec(r.name); const k = m ? m[1] : '(未分組)'; actualCounts[k] = (actualCounts[k] || 0) + 1; }
const groupKeys = [...new Set([...Object.keys(EXPECTED_COUNTS), ...Object.keys(actualCounts)])].sort();
const countMismatch = groupKeys.filter(g => (EXPECTED_COUNTS[g] || 0) !== (actualCounts[g] || 0));
ok('T13 斷言總數閘門:每組實跑條數符合預期(條件式區塊整批消失時,分母變小不會被當成全綠)',
  countMismatch.length === 0,
  countMismatch.length
    ? countMismatch.map(g => `${g}:預期 ${EXPECTED_COUNTS[g] || 0} 實跑 ${actualCounts[g] || 0}`).join(' ; ')
    : groupKeys.map(g => `${g}=${actualCounts[g]}`).join(' '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);

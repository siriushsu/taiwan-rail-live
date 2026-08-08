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
  // 高鐵班表自 2026-08-07(9f05f2f)改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
  // 空物件是 200 ⇒ fetchJSONAt 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的
  // sys.data.trains 拋錯 ⇒ boot 停在 state.ready=true 之前 ⇒ waitReady 逾時。這裡吐打包的那份(同 schema)。
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
async function boot(browser, { bridge = true, plus = false, startResult = null, sandboxBuild = '', viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ bridge, startResult, sandboxBuild }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    // 🔴 最終複審 C-1:PLUS_SANDBOX_OK/PLUS_SANDBOX_BUILD 是頁面腳本【求值一次】的 const
    // (index.html:7778/7781),所以只能在這裡、頁面腳本執行之前設。預設不設(維持原行為);
    // T25b 用它證明 laBind 走的是 plusApiHeaders() 而不是手寫的 Authorization。
    if (sandboxBuild) { window.RAIL_PLUS_SANDBOX_OK = true; window.RAIL_PLUS_SANDBOX_BUILD = sandboxBuild; }
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
    // 假橋接補上事件通道:讓測試能模擬原生端送回 push token
    window.__laListeners = {};
    window.RAIL_NATIVE_LIVEACTIVITY.addListener = (ev, cb) => {
      (window.__laListeners[ev] = window.__laListeners[ev] || []).push(cb);
      return Promise.resolve({ remove: () => {} });
    };
    window.__laEmit = (ev, payload) => (window.__laListeners[ev] || []).forEach(f => f(payload));
    // 攔截 bind/unbind 的網路請求,記錄下來(不真的打後端)
    // 🔴 不能寫死帶前導斜線的 '/api/la/':apiUrl() 在非原生環境(API_BASE='')原樣回傳
    //    'api/la/bind' 這種「無前導斜線」的相對路徑(index.html 全部 fetch(apiUrl(...)) 呼叫點都是
    //    這樣傳的),帶斜線的比對永遠對不上,請求會穿透到假伺服器的 /api/* 兜底(回 200 {}、
    //    不進這支記錄器)——實測踩到過,bindCalls 恆 0 且零例外,很難從結果反推。
    window.__laBindCalls = [];
    // 修復輪次1 Important 8:替身原本不論 payload 長什麼樣一律回 200,契約壞掉也測不出來。
    // 補一個最小契約檢查器(不是 worker.js 全套規則,理由見報告)——挑最會被未來改壞的四條:
    //  1) token 格式(偶數個小寫 hex、32–128 bytes)——bind/unbind 的鍵,錯了後端整包 400。
    //     🔴 這一條原本寫死 64 碼,與 worker.js 當時的規則逐字同源。真實 ActivityKit token
    //     是 80 bytes(160 碼),於是【正式環境每一發都 400,而這條斷言永遠是綠的】——替身
    //     用的是自己造的假 token,測的是「前端有沒有照抄我抄錯的那條規則」。判準必須跟著
    //     worker.js 的 LA_TOKEN_RE 走,不可再各寫一份。
    //  2) sys 在白名單(tra_sched/thsr_sched)——afr_sched 等未支援系統送出去必被拒,曾是真的踩過的坑。
    //  3) stopCodes.length===stops.length——兩處各自 filter(stop!==false)算出來的,兩處改動
    //     不同步就會悄悄不一致(laBind 與 buildStopCodes 是兩個獨立函式)。
    //  4) stops 非空且 at 嚴格遞增——這正是本輪 laBind 域校正/gate 出過真代數 bug 的那個維度,
    //     最貼近「未來會被改壞」的機率。不挑的四項(byte 上限、staMap 鍵數上限):真實台鐵車次
    //     資料量遠低於那些門檻,復刻確切位元組數只是把後端實作細節硬編進前端測試,自己先脆。
    window.__laCheckBindContract = function (b) {
      if (!b || typeof b !== 'object') return ['body 不是物件'];
      const errs = [];
      if (!/^(?:[0-9a-f]{2}){32,128}$/.test(String(b.token || ''))) errs.push('token 格式錯(非 32–128 bytes 的小寫 hex)');
      if (b.sys !== 'tra_sched' && b.sys !== 'thsr_sched') errs.push('sys 不在白名單(tra_sched/thsr_sched)');
      if (!Array.isArray(b.stops) || !b.stops.length) errs.push('stops 非陣列或為空');
      else if (!b.stops.every((s, i) => i === 0 || (typeof s.at === 'number' && s.at > b.stops[i - 1].at))) errs.push('stops[].at 未嚴格遞增');
      // 🔴 最終複審 P2:只驗「遞增」擋不住【整體平移】——把服務日午夜當成 epoch 原點、
      // 或漏掉跨午夜 +86400,算出來的一整串 at 仍然嚴格遞增,契約檢查照樣 0 錯。
      // 這一條是絕對軸的錨:每一站都必須落在「現在前後一天」內(台鐵最長班次遠短於此)。
      else {
        const nowS = Math.floor(Date.now() / 1000);
        if (!b.stops.every(s => Math.abs(s.at - nowS) < 86400)) errs.push('stops[].at 偏離現在超過一天(絕對 epoch 軸算錯)');
      }
      if (!Array.isArray(b.stopCodes) || !Array.isArray(b.stops) || b.stopCodes.length !== b.stops.length) errs.push('stopCodes.length!==stops.length');
      return errs;
    };
    // 修復輪次1 Important 3/5 用:測試可強制下一發 bind 回應的狀態(不看契約),或延後回應時間。
    window.__laForceBindStatus = null;   // {status, body} —— 設了就無條件蓋過契約檢查的結果
    window.__laBindDelayMs = 0;          // >0 時 bind 回應延後這麼久才 resolve,製造「回應還沒回來就被取消」的競態窗
    const _fetch = window.fetch;
    window.fetch = (u, o) => {
      const s = String(u);
      if (s.includes('api/la/bind')) {
        const body = o && o.body ? JSON.parse(o.body) : null;
        const errs = window.__laCheckBindContract(body);
        // 🔴 最終複審 C-1:headers 原本【一個字都沒記】,於是「bind 少帶 Authorization」對這套
        //    判準完全不可見(整條 LA-1 在正式環境 100% 回 401 卻兩套驗收全綠的根因之一)。
        window.__laBindCalls.push({ url: s, body, headers: Object.assign({}, (o && o.headers) || {}), contractErrors: errs });
        const respond = () => {
          if (window.__laForceBindStatus) {
            const f = window.__laForceBindStatus;
            return new Response(JSON.stringify(f.body || {}), { status: f.status, headers: { 'content-type': 'application/json' } });
          }
          if (errs.length) return new Response(JSON.stringify({ error: 'contract_violation', errs }), { status: 400, headers: { 'content-type': 'application/json' } });
          return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
        };
        const delay = window.__laBindDelayMs || 0;
        return delay > 0 ? new Promise(res => setTimeout(() => res(respond()), delay)) : Promise.resolve(respond());
      }
      if (s.includes('api/la/')) {
        window.__laBindCalls.push({ url: s, body: o && o.body ? JSON.parse(o.body) : null, headers: Object.assign({}, (o && o.headers) || {}) });
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return _fetch(u, o);
    };
  }, { bridge, startResult, sandboxBuild });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  if (plus) await setPlus(page, true);
  return { ctx, page, errors };
}

// 注入的「環境」:訂閱資格 ＋ 登入身分。形狀比照 index.html plusState() 與 state.account 的初值。
// 🔴 最終複審 C-1:身分是本輪【新增】的注入。laBind 現在必須先取 Firebase ID token 才送 bind
// (舊版沒帶 Authorization ⇒ 正式環境恆 401),沒有身分就不送——所以替身環境要有一個假身分,
// 否則整批 T14–T24 會因為「根本沒送出 bind」而全紅。假 getIdToken 掛在 fb 上,走的是與
// plusRefresh()/delay-history 相同的主要分支。
const setPlus = (page, on) => page.evaluate(v => {
  state.plus = { active: v, founding: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
  state.account = Object.assign(state.account || {}, {
    ready: true, gen: 0,
    user: { uid: 'la-verify-uid' },
    fb: { getIdToken: async () => 'LA-VERIFY-IDTOKEN' },
  });
}, on);
// 反向:把身分拿掉(訂閱資格保留)。用來驗「沒有登入身分就不送 bind」這半——
// 兩側都驗才不會在旗標機制改變時只剩散落各處、互相矛盾的前置條件。
const clearIdentity = page => page.evaluate(() => { if (state.account) { state.account.user = null; state.account.fb = null; } });

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
  // 獨立來源交叉比對:#fpNext／#fpStatus 都是跟隨面板自己的渲染器寫的,不是本腳本重算的。
  // 🔴 抓到的是「此刻真的在跑的車」,它可能正好停靠在站內 ⇒ 卡片刻意顯示【正停靠的那一站】
  //    (與後端觀測到在站上時的行為一致),而 #fpNext 指的是下一站,兩者本來就不該相等。
  //    分支不是為了讓紅的變綠——停靠那半改比 #fpStatus(面板自己寫的「⏸ 停靠 X」),
  //    並額外要求它與 #fpNext 不同,證明卡片是刻意換了一站而不是照抄面板。
  //    停靠這條路走到的機率靠真實資料碰運氣,所以另有 T27 用撥時鐘的方式必定走到。
  const panel1 = await page.evaluate(() => ({
    next: document.getElementById('fpNext').textContent.trim(),
    status: document.getElementById('fpStatus').textContent.trim(),
  }));
  if (p && p.stopping) {
    ok('T1 停靠中:payload.nextStop === 面板 #fpStatus 的停靠站,且刻意不同於 #fpNext(獨立渲染器)',
      panel1.status.includes(`停靠 ${p.nextStop}`) && p.nextStop !== panel1.next,
      `payload=${p.nextStop} 面板狀態=「${panel1.status}」 面板下一站=${panel1.next}`);
  } else {
    ok('T1 行進中:payload.nextStop === 跟隨面板 #fpNext(獨立渲染器)',
      !!p && p.nextStop === panel1.next, `payload=${p && p.nextStop} 面板=${panel1.next}`);
  }
  const iso = p && Date.parse(p.arrivalIso);
  if (p && p.stopping) {
    // 🔴 停靠中不得送出未來時刻:Widget 在 stopping=true 時畫徽章不畫倒數,但「App 更新前開的卡」
    //    解不出 stopping(Optional ⇒ nil ⇒ 當成 false)會回頭吃 arrivalDate——送未來值就會憑空長出
    //    一個假倒數。前端把它鉗在 now(Math.max(0,…)),這條就是那個鉗子的牙。
    ok('T1 停靠中:arrivalIso 是合法時刻且不在未來(舊版 App 不會畫出假倒數)',
      !!iso && iso <= Date.now() + 1000 && iso > Date.now() - 3 * 3600e3, String(p.arrivalIso));
  } else {
    ok('T1 行進中:arrivalIso 是未來且 3 小時內的合法時刻',
      !!iso && iso > Date.now() - 1000 && iso < Date.now() + 3 * 3600e3, String(p && p.arrivalIso));
  }
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
    if (p && p.stopping) {
      // 停靠中兩邊講的不是同一站(見上),分鐘數對帳不成立。改驗那個鉗子的算術面:
      // arrivalIso 被鉗在「現在」⇒ 換算 ≈0 分;而面板顯示的是【另一站】的分鐘數。
      pass = Math.abs(payMin) < 1 && p.nextStop !== panel1.next;
      detail = `停靠中:payload=${payMin.toFixed(2)} 分(應≈0),面板「${panel.txt}」講的是 ${panel1.next}`;
    } else if (panel.bold) {
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

// ══════════ T14：收到 token → 送出 bind,payload 含四個必要欄位 ══════════
// 🔴 brief 原稿寫死車次 554——只有它真的在跑的那幾小時才會成立,其餘時間 followTrainNo
//    會把它當成「今天已跑完/還沒發車」而撥時鐘進時光機(setFollow 的既有行為,見 laSync 開頭的
//    註解),liveClock 閘門就會擋下 api.start(),__laCalls 永遠等不到 'start' 而卡死在 waitForFunction。
//    改用既有的 followRunningTRA(此刻真的在跑的車),T1-T11 都是這樣做,理由相同。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T14 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: 'deadbeef'.repeat(8), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 10000 }).catch(() => {});
  const b = await page.evaluate(() => window.__laBindCalls[0] || {});
  ok('T14a token 到達後送出 bind', /api\/la\/bind$/.test(b.url), b.url);
  ok('T14b bind payload 四欄齊備',
     !!(b.body && b.body.token && b.body.trainNo && Array.isArray(b.body.stops) && b.body.staMap && Array.isArray(b.body.stopCodes)),
     JSON.stringify(Object.keys(b.body || {})));
  const nowS = Math.floor(Date.now() / 1000);
  const st14 = (b.body && b.body.stops) || [];
  ok('T14c stops 帶的是【絕對 epoch】且遞增',
     st14.length > 1
     && st14.every(s => Number.isFinite(s.at) && Math.abs(s.at - nowS) < 86400)
     && st14.every((s, i) => i === 0 || s.at > st14[i - 1].at),
     `${st14.length} 站,首站 at=${st14[0] && st14[0].at}(now=${nowS})`);
  await ctx.close();
}

// T14d 跨午夜車次:arrSec 超過 86400 的班次,換算出來的 at 仍在「現在前後一天內」
// (若用「台北今日午夜＋arrSec」的算法,這裡會整整差一天——這條就是為了 gate 那個做法)
// 同 T14 的理由:候選車必須是「此刻真的在跑」的,否則一樣卡在時光機閘門。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const cross = await page.evaluate(() => {
    const run = state.trains.filter(t => {
      if (t.sys !== 'tra_sched' || t.loop) return false;
      const e = effTLive(t), s = t.stops;
      return e > s[0].depSec + 60 && e < s[s.length - 1].arrSec - 300;
    });
    const t = run.find(x => (x.stops || []).some(s => s.arrSec > 86400));
    return t ? String(t.train) : null;
  });
  if (!cross) { ok('T14d 跨午夜車次換算正確', true, '此刻沒有正在跑的跨午夜車次,略過'); }
  else {
    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), cross);
    await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
    const k = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
    await page.evaluate(kk => window.__laEmit('pushToken', { token: 'dd'.repeat(32), key: kk }), k);
    await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 10000 }).catch(() => {});
    const bb = await page.evaluate(() => (window.__laBindCalls[0] || {}).body || null);
    const n2 = Math.floor(Date.now() / 1000);
    const worst = bb && bb.stops ? Math.max(...bb.stops.map(s => Math.abs(s.at - n2))) : NaN;
    ok('T14d 跨午夜車次換算正確', worst < 86400, `車次 ${cross},最遠一站距現在 ${(worst / 3600).toFixed(1)} 小時`);
  }
  await ctx.close();
}

// T14e/T14f:上面 T14c/d 的容差(< 86400 秒)只夠擋「差一整天」,擋不住「差幾分鐘~幾十分鐘」
// 的代數錯誤(例如把 nextStopInfo 回傳的 ref.min 重複計入位移)。這裡改用手工 tr(不吃今日班表,
// 結果不受「今天有沒有跨午夜車」影響),直接控制 state.simSec 與 Date.now() 的關係,拿獨立手算的
// 期望值比對——不重用 laBind 內部的任何一步。容差 6 秒只是留給「evaluate 呼叫本身的延遲」。
{
  const { ctx, page } = await boot(cr, { plus: true });
  // T14e:模擬「真實時鐘已跨過午夜、state.simSec 回捲到 00:30(=1800)」,但車次昨晚 23:00 出發、
  // stops 仍是從發車日午夜起算(不回捲)。四站手算距now應為 -90/-60/-25/+5 分。
  await page.evaluate(() => {
    state.simSec = 1800; state.clockAtNow = true;
    window.__laBindCalls = [];
    laBind('a'.repeat(64), 'tra_sched#FAKE1', {
      sys: 'tra_sched', train: 'FAKE1',
      stops: [
        { name: 'A起站23:00', arrSec: 82800, depSec: 82800, stop: true },
        { name: 'B23:30', arrSec: 84600, depSec: 84620, stop: true },
        { name: 'C跨日00:05', arrSec: 86700, depSec: 86720, stop: true },
        { name: 'D跨日終點00:35', arrSec: 88500, depSec: 88500, stop: true },
      ],
    });
  });
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 5000 }).catch(() => {});
  {
    const b = await page.evaluate(() => (window.__laBindCalls[0] || {}).body || null);
    const nowS = Math.floor(Date.now() / 1000);
    const expectMin = [-90, -60, -25, 5];
    const got = ((b && b.stops) || []).map(s => (s.at - nowS) / 60);
    const diffs = got.map((g, i) => Math.abs(g - expectMin[i]));
    ok('T14e 跨午夜(simSec 回捲過午夜)換算的四站分鐘數精確符合獨立手算(容差 6 秒)',
      got.length === expectMin.length && diffs.every(d => d < 0.1),
      `期望=${expectMin.join('/')} 實際=${got.map(x => x.toFixed(2)).join('/')}`);
  }
  // T14f:非跨午夜的乾淨情境,單獨驗證 ref 站本身不會被算成「現在」(0 分)——
  // t 恰好等於第一站 arrSec,ref 應落在第二站(5 分後),第三站應為 15 分後。
  await page.evaluate(() => {
    state.simSec = 100; state.clockAtNow = true;
    window.__laBindCalls = [];
    laBind('b'.repeat(64), 'tra_sched#FAKE2', {
      sys: 'tra_sched', train: 'FAKE2',
      stops: [
        { name: 'X已過', arrSec: 100, depSec: 100, stop: true },
        { name: 'Yref', arrSec: 400, depSec: 420, stop: true },
        { name: 'Z', arrSec: 1000, depSec: 1000, stop: true },
      ],
    });
  });
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 5000 }).catch(() => {});
  {
    const b = await page.evaluate(() => (window.__laBindCalls[0] || {}).body || null);
    const nowS = Math.floor(Date.now() / 1000);
    const got = ((b && b.stops) || []).map(s => (s.at - nowS) / 60);
    ok('T14f 非跨午夜:ref 站(5 分後)的 at 精確落在 now+5 分,不是 now+0 分(容差 6 秒)',
      got.length === 3 && Math.abs(got[1] - 5) < 0.1, `Y(ref)距now=${got[1] && got[1].toFixed(2)}分(重複計入 ref.min 的錯誤會給出 0 分)`);
    ok('T14f 非跨午夜:再下一站精確落在 now+15 分(容差 6 秒)',
      got.length === 3 && Math.abs(got[2] - 15) < 0.1, `Z距now=${got[2] && got[2].toFixed(2)}分`);
  }
  await ctx.close();
}

// ══════════ T18：環島車(loop)域校正——修復輪次1 Important 1 的手工 fixture ══════════
// effTLive 對 loop 車有獨立分支(映回單一圈長 loopSec,見 index.html 9206-9209 一帶),laBind 域校正
// 原本完全沒有這個分支,00:00–08:00(LOOP_DEP=08:00 之前)一律誤差整整一圈 loopSec。用手工 tr
// (不吃真的 8888/8889,結果不受「此刻真的有沒有環島車在跑」影響)獨立手算比對。
{
  const { ctx, page } = await boot(cr, { plus: true });
  await page.evaluate(() => {
    // 仿 8888/8889 的形狀:loopSec=43200(12 小時),s[0].arrSec=28800(08:00 發車)
    state.simSec = 3600; state.clockAtNow = true;                 // 台北時間 01:00,LOOP_DEP 前
    window.__laBindCalls = [];
    laBind('e'.repeat(64), 'tra_sched#FAKELOOP', {
      sys: 'tra_sched', train: 'FAKELOOP', loop: true, loopSec: 43200,
      stops: [
        { name: 'P0起站', arrSec: 28800, depSec: 28800, stop: true },   // 08:00
        { name: 'P1', arrSec: 32400, depSec: 32420, stop: true },        // 09:00
        { name: 'P2終點', arrSec: 72000, depSec: 72000, stop: true },    // 20:00(=一圈終點)
      ],
    });
  });
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 5000 }).catch(() => {});
  const b = await page.evaluate(() => (window.__laBindCalls[0] || {}).body || null);
  const nowS = Math.floor(Date.now() / 1000);
  // simSec=3600(01:00)映回本圈:28800+((3600-28800)%43200+43200)%43200=28800+18000=46800(13:00)。
  // 三站距映回後的 t(46800)分鐘數:P0=(28800-46800)/60=-300,P1=(32400-46800)/60=-240,P2=(72000-46800)/60=+420。
  // 沒修 loop 分支的舊碼會落到非 loop 分支算出 t=3600(見下方註解推導),三站全部偏差整整
  // 720 分鐘(=43200 秒=一圈)——這正是 Important 1 要抓的量級,不是幾分鐘的代數誤差。
  const expectMin = [-300, -240, 420];
  const got = ((b && b.stops) || []).map(s => (s.at - nowS) / 60);
  const diffs = got.map((g, i) => Math.abs(g - expectMin[i]));
  ok('T18 環島車(loop)域校正:00:00–08:00 窗內映回本圈,三站分鐘數精確符合獨立手算(容差 6 秒;偏差 720 分=未修的 loop 分支缺失)',
    got.length === expectMin.length && diffs.every(d => d < 0.1),
    `期望=${expectMin.join('/')} 實際=${got.map(x => x.toFixed(2)).join('/')}`);
  await ctx.close();
}

// ══════════ T19：誤點車剛過表定終點、但實際還沒到——修復輪次1 Important 2 的手工 fixture ══════════
// laBind 原本用「純表定 t」判斷已過終點,與 laPayload/全站台一致採用的 effTLive(delay-aware)不同軸
// ——誤點車在「表定終點已過、但實際還沒到」的窗口內會被誤判成已過終點而永遠不交班。用
// monkey-patch liveDelaySec 精確控制誤點秒數,不吃真實即時資料(才不會被「此刻有沒有誤點車」左右)。
{
  const { ctx, page } = await boot(cr, { plus: true });
  await page.evaluate(() => {
    liveDelaySec = tr => (tr.train === 'FAKEDELAY' ? 300 : 0); // 固定誤點 5 分鐘
    state.simSec = 1030; state.clockAtNow = true;   // 表定終點(1000)已過 30 秒,但誤點 5 分還沒真的到
    window.__laBindCalls = [];
    laBind('f'.repeat(64), 'tra_sched#FAKEDELAY', {
      sys: 'tra_sched', train: 'FAKEDELAY',
      stops: [
        { name: '起站', arrSec: 700, depSec: 700, stop: true },
        { name: '終點', arrSec: 1000, depSec: 1000, stop: true },
      ],
    });
  });
  // 沒修的舊碼:純表定 t=1030≥終點 1000,nextStopInfo 回 null 提早 return,__laBindCalls 永遠 0 筆——
  // 用 .catch 讓「等不到」變乾淨的 FAIL,不要讓整支腳本連後面測項的紀錄都沒留就當掉。
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 5000 }).catch(() => {});
  const n = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /api\/la\/bind$/.test(c.url)).length);
  ok('T19 誤點車剛過表定終點但未真的到站(effTLive 仍在行程內)⇒ 照樣交班,不被純表定 t 誤判已過終點擋下',
    n === 1, `bind 呼叫 ${n} 次(0 次即為未修的 bug)`);
  const b = n === 1 ? await page.evaluate(() => (window.__laBindCalls[0] || {}).body || null) : null;
  const nowS = Math.floor(Date.now() / 1000);
  const gotTerminus = b && b.stops && b.stops.length ? (b.stops[b.stops.length - 1].at - nowS) : NaN;
  ok('T19 payload 的 at 仍是【純表定】軸(終點 at-now≈-30 秒,不是誤把 effTLive 的 730 拿去換算 at)',
    b !== null && Math.abs(gotTerminus - (-30)) < 6,
    `終點 at-now=${gotTerminus}秒(期望≈-30;若誤用 effTLive 換算 at 會落在 +270 附近;未交班則此欄為 NaN)`);
  await ctx.close();
}

// ══════════ T15：key 不符的 token 被丟掉(換車競態)——負向斷言,配 T14 當正向對照 ══════════
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T15 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__laEmit('pushToken', { token: 'aa'.repeat(32), key: 'tra_sched#9999' }));
  await page.waitForTimeout(600);
  const n = await page.evaluate(() => (window.__laBindCalls || []).length);
  ok('T15 key 不符的 token 不送 bind', n === 0, `bind 呼叫 ${n} 次(T14 證明同一支記錄器抓得到)`);
  await ctx.close();
}

// ══════════ T16：停止跟車 → 送出 unbind,payload 帶正確 token(修復輪次1 Important 6/7) ══════════
// 🔴 原斷言 ok('T16 停止跟車送出 unbind', true) 是恆真陳述,前面那發 waitForFunction 沒等到
//    才會讓整支腳本連流程帶測試總數都不留紀錄地當掉(Important 6)——真牙全部活在那發
//    等待裡,而且從未檢查送出去的 body 到底裝了什麼(Important 7,送 {} 一樣會綠)。
//    改成:等待本身加 .catch 讓「沒等到」變成乾淨的 FAIL 而不是整支炸掉,並且對 payload 的
//    token 欄位做實質斷言。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T16 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  const tok = '66'.repeat(32);
  await page.evaluate(({ k, t }) => window.__laEmit('pushToken', { token: t, key: k }), { k: key, t: tok });
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /api\/la\/bind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => clearFollow());
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /unbind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const un = await page.evaluate(() => (window.__laBindCalls || []).find(c => /unbind$/.test(c.url)));
  ok('T16 停止跟車送出 unbind,payload 的 token 與交班時相同(送空物件{}一樣會被舊斷言判過,見 Important 6/7)',
    !!(un && un.body && un.body.token === tok), JSON.stringify(un && un.body));
  await ctx.close();
}

// ══════════ T21：換車時舊卡的 binding 要收掉——修復輪次1 Important 4 的手工情境 ══════════
// followTrainNo() 只呼叫 setFollow+laSync,從不呼叫 clearFollow/laStop——換車時舊卡在後端的
// binding 原本沒有任何清理路徑,一直留到 8 小時 TTL 過期。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const a = await followRunningTRA(page, 0);
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const keyA = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  const tokenA = '22'.repeat(32);
  await page.evaluate(({ k, t }) => window.__laEmit('pushToken', { token: t, key: k }), { k: keyA, t: tokenA });
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /api\/la\/bind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const b = await followRunningTRA(page, 1);            // ← 真實產品函式,觸發換車
  ok('T21 前置:兩班不同的車,A 已交班成功', !!a && !!b && a.no !== b.no, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /unbind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const un = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /unbind$/.test(c.url)));
  ok('T21 換到 B 車 ⇒ A 車的 binding 收到 unbind(不是留著孤兒到 TTL 才過期,沒有牙的版本這裡是 0 次)',
    un.length >= 1 && un[0].body && un[0].body.token === tokenA,
    `unbind 次數=${un.length}${un[0] ? ` token相符=${un[0].body && un[0].body.token === tokenA}` : ''}`);
  await ctx.close();
}

// ══════════ T22：飛行中的 bind 被 clearFollow() 取消——修復輪次1 Important 5 的手工情境 ══════════
// 用 __laBindDelayMs 讓 bind 回應延後,製造「回應還沒回來、就被 clearFollow() 收掉」的競態窗——
// 原本 _laBound 只在 bind 的 .then() 裡設,clearFollow 那一刻讀到還是空字串,laUnbind() 的
// !_laBound 早退會整個跳過清理;之後遲到的 .then() 才把 _laBound 設成已經沒人要的 key,
// 從此再也沒有人會替它送 unbind,伺服器那筆孤兒到 TTL 才過期。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T22 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  const token = '33'.repeat(32);
  await page.evaluate(() => { window.__laBindDelayMs = 1500; });
  await page.evaluate(({ k, t }) => window.__laEmit('pushToken', { token: t, key: k }), { k: key, t: token });
  await page.waitForTimeout(200);   // 確保 bind fetch 已經發出、但因為延遲還沒 resolve
  const midBindCount = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /api\/la\/bind$/.test(c.url)).length);
  ok('T22 前置:bind 請求已送出但回應還在飛(製造競態窗)', midBindCount === 1, `bind=${midBindCount}`);
  await page.evaluate(() => clearFollow());               // 這一刻 _laBound 還是空的(bind 還沒 resolve)
  await page.waitForTimeout(2200);                        // 等過 1500ms 延遲,讓 bind 的 .then() 真的跑完
  const unbinds = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /unbind$/.test(c.url)));
  ok('T22 clearFollow() 發生在 bind 回應回來之前 ⇒ bind 成功後補一發清理 unbind(沒有牙的版本這裡是 0 次)',
    unbinds.length >= 1 && unbinds[unbinds.length - 1].body && unbinds[unbinds.length - 1].body.token === token,
    `unbind 次數=${unbinds.length} 明細=${JSON.stringify(unbinds.map(u => u.body))}`);
  await page.evaluate(() => { window.__laBindDelayMs = 0; });
  await ctx.close();
}

// ══════════ T17：未訂閱者不送 bind(負向,對照 T14) ══════════
// 🔴 未訂閱時 laSync 的 liveActivityAllowed() 一開始就是 false,走 laStop() 分支,_laKey 從頭到尾
//    是空字串——不管跟不跟得到車、車在不在跑都一樣。emit 的 key 若沿用 brief 原稿寫死的
//    'tra_sched#554',回呼裡 `key !== _laKey` 這半(空字串比車次字串,恆不等)自己就會擋下,
//    根本測不到後半的 `!liveActivityAllowed()`——brief 表列的第 5 發突變(拿掉 liveActivityAllowed
//    那半)會因此測不出來(key 不符那半照樣擋人,是假綠)。改 emit key='' 與 _laKey 對上,
//    讓「未訂閱」是唯一擋下 bind 的原因,才真的驗到 liveActivityAllowed() 那半。
{
  const { ctx, page } = await boot(cr, { plus: false });
  const followed = await page.evaluate(() => {
    followTrainNo('554', { sys: 'tra_sched' });
    return state.followTrain ? String(state.followTrain.train) : null;
  });
  ok('T17 前置:未訂閱也能正常跟車(state.followTrain 有值,否則下面測的是假陽性)', followed === '554', String(followed));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__laEmit('pushToken', { token: 'cc'.repeat(32), key: '' }));
  await page.waitForTimeout(600);
  const n = await page.evaluate(() => (window.__laBindCalls || []).length);
  ok('T17 未訂閱者零 bind', n === 0, `bind 呼叫 ${n} 次`);
  await ctx.close();
}

// ══════════ T20：bind 回應非 2xx 不可標記已交班——修復輪次1 Important 3 的手工情境 ══════════
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T20 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(() => { window.__laForceBindStatus = { status: 400, body: { error: 'bad_sys' } }; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: '77'.repeat(32), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /api\/la\/bind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const bindN = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /api\/la\/bind$/.test(c.url)).length);
  ok('T20 前置:bind 請求確實發出(400 是後端拒絕,不是前端沒送出去)', bindN === 1, `bind=${bindN}`);
  await page.waitForTimeout(300);   // 等 fetch 的 .then() 真的跑完
  const bound = await page.evaluate(() => _laBound);
  ok('T20 bind 回應 400(非 2xx)⇒ 不標記已交班,_laBound 仍是空字串(沒看 r.ok 的版本這裡會是 key)',
    bound === '', `_laBound=${JSON.stringify(bound)}`);
  await page.evaluate(() => { window.__laForceBindStatus = null; });   // 只擋這一發,後面不受影響
  await page.evaluate(() => clearFollow());
  await page.waitForTimeout(600);   // 沒有牙的話仍會送出 unbind,固定等待+讀值取代 waitForFunction 避免掛死
  const unN = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /unbind$/.test(c.url)).length);
  ok('T20 正向對照(行為面):交班失敗 ⇒ clearFollow() 之後沒有 unbind 可送(對照 T16——真交班成功時一定送得出 unbind)',
    unN === 0, `unbind 呼叫 ${unN} 次`);
  await ctx.close();
}

// ══════════ T23：真實跟車的 bind payload 通過契約檢查——修復輪次1 Important 8(正向對照) ══════════
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T23 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: '44'.repeat(32), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 10000 }).catch(() => {});
  const errs = await page.evaluate(() => (window.__laBindCalls[0] || {}).contractErrors || null);
  ok('T23 真實跟車產生的 bind payload 通過全部四條契約檢查(token 格式/sys 白名單/stopCodes 長度/at 遞增)',
    Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));
  await ctx.close();
}

// ══════════ T24：契約檢查器本身有牙——修復輪次1 Important 8(檢查器單元測試) ══════════
// 直接餵檢查器合法/五種各自違規的 payload,不經過 laBind——證明它不是永遠回空陣列的裝飾品。
// 🔴 最終複審 P2:base 的 at 從 100/200 改成【現在的 epoch】——新增的「絕對軸」那條會判
// 100/200 偏離現在超過一天,舊 fixture 會讓 good 恆假(自己把自己判紅)。順帶多一種違規:at越界。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const cases = await page.evaluate(() => {
    const n = Math.floor(Date.now() / 1000);
    const base = { token: '5'.repeat(64), sys: 'tra_sched', stops: [{ at: n + 100 }, { at: n + 200 }], stopCodes: ['a', 'b'] };
    const bad = {
      token格式: Object.assign({}, base, { token: 'zz'.repeat(32) }),           // 非 hex
      sys白名單: Object.assign({}, base, { sys: 'afr_sched' }),                 // 未支援系統(林鐵)
      stopCodes長度: Object.assign({}, base, { stopCodes: ['a'] }),             // 長度不符
      at遞增: Object.assign({}, base, { stops: [{ at: n + 200 }, { at: n + 100 }] }),   // 未遞增
      at絕對軸: Object.assign({}, base, { stops: [{ at: 100 }, { at: 200 }] }), // 遞增但整串偏離現在(P2)
    };
    return {
      good: window.__laCheckBindContract(base).length === 0,
      bad: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, window.__laCheckBindContract(v).length > 0])),
    };
  });
  ok('T24 契約檢查器本身有牙:合法 payload 判 0 錯,五種各自違規的 payload 都判出 ≥1 個錯',
    cases.good && Object.values(cases.bad).every(Boolean), JSON.stringify(cases));
  await ctx.close();
}

// ══════════ T25(最終複審 C-1):bind 請求必須帶 Authorization ══════════
// 🔴 這一組存在的唯一理由:整條 LA-1 在正式環境 100% 回 401(bind 沒帶 Authorization ⇒
// checkPlusEntitlement 第一行就擋),而【兩套驗收都是綠的】——後端測試一律自帶
// LA_TEST_BEARER 旁路(結構上驗不到真實客戶端的 header),前端替身只斷言 URL 與 body、
// o.headers 一個字都沒讀。缺口正好落在兩者的交界,兩邊各自把對方該驗的那一半當成外部前提。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T25 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: '66'.repeat(32), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /api\/la\/bind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const binds = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /api\/la\/bind$/.test(c.url)));
  ok('T25 前置:真的送出了 bind 請求(沒送出的話下面的 header 斷言會退化成同義反覆)',
    binds.length >= 1, `bind 呼叫 ${binds.length} 次`);
  // 正向對照:證明替身真的看得到 headers 這個物件(不是恆為 undefined 而讓下面的斷言恆假/恆真)
  ok('T25 正向對照:替身確實記錄到 headers 物件,且 content-type 在裡面',
    binds.length >= 1 && binds.every(c => c.headers && c.headers['content-type'] === 'application/json'),
    JSON.stringify(binds.map(c => Object.keys(c.headers || {}))));
  ok('T25(關鍵)每一發 bind 都帶 Authorization: Bearer <非空>——少了它正式環境恆 401、整條 LA-1 靜默失效',
    binds.length >= 1 && binds.every(c => /^Bearer\s+\S+/.test(String((c.headers || {}).Authorization || ''))),
    JSON.stringify(binds.map(c => String((c.headers || {}).Authorization || '(缺)').slice(0, 24))));
  await ctx.close();
}

// T25b:證明 header 是用既有的 plusApiHeaders() 產生的,不是手寫的 Authorization。
// 🔴 為什麼這件事重要:plusApiHeaders() 會【同時】帶 X-Rail-Plus-Sandbox-Build,少了它,
// sandbox／TestFlight 的購買者即使帶了 Authorization 仍會被後端的 sandboxPlusRequested() 判為
// 無資格。手寫一行 Authorization 會通過 T25 卻在這裡現形——這是兩者唯一分得開的地方。
{
  const { ctx, page } = await boot(cr, { plus: true, sandboxBuild: '9999' });
  const f = await followRunningTRA(page);
  ok('T25b 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: '77'.repeat(32), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).some(c => /api\/la\/bind$/.test(c.url)), null, { timeout: 10000 }).catch(() => {});
  const hdr = await page.evaluate(() => {
    const c = (window.__laBindCalls || []).find(x => /api\/la\/bind$/.test(x.url));
    return c ? c.headers : null;
  });
  ok('T25b(關鍵)sandbox build 下 bind 一併帶 X-Rail-Plus-Sandbox-Build(＝真的走 plusApiHeaders,不是手寫 Authorization)',
    !!hdr && hdr['X-Rail-Plus-Sandbox-Build'] === '9999', JSON.stringify(hdr));
  await ctx.close();
}

// T25c(反向):有訂閱資格但【沒有登入身分】⇒ 不送 bind。
// 後端只會回 401,發它等於白打;而且這一側證明上面兩條不是「反正它一定會送」的恆真斷言。
{
  const { ctx, page } = await boot(cr, { plus: true });
  await clearIdentity(page);
  const f = await followRunningTRA(page);
  ok('T25c 前置:成功跟上一班在跑的台鐵車(訂閱資格在、身分被拿掉)', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: '88'.repeat(32), key: k }), key);
  await page.waitForTimeout(1200);   // 給它足夠時間送出(有牙的話這裡會出現一發 bind)
  const n = await page.evaluate(() => (window.__laBindCalls || []).filter(c => /api\/la\/bind$/.test(c.url)).length);
  ok('T25c(反向)沒有登入身分就不送 bind(送了也只會拿到 401)', n === 0, `bind 呼叫 ${n} 次`);
  const bound = await page.evaluate(() => _laBound);
  ok('T25c 沒交班 ⇒ _laBound 維持空字串(本機 update 會照常繼續,卡片不會死)', bound === '', JSON.stringify(bound));
  await ctx.close();
}

// ══════════ T26(最終複審 B-I1＋B-I2):交班成功後停止送本機 update ══════════
// 🔴 本機那份 nextStop 一律是【推算】的(表定＋誤點位移),後端則是「有觀測用觀測」。
// 前景每 ≤10 秒推一次會用推算蓋掉後端剛推的觀測站名,而後端的 last_idx 已更新 ⇒「沒變就不推」
// 讓它不會再推同一站 ⇒ 錯的站名黏住一整腿,直接違反「站名來自觀測,不來自推算」。
{
  const { ctx, page } = await boot(cr, { plus: true });
  const f = await followRunningTRA(page);
  ok('T26 前置:成功跟上一班在跑的台鐵車', !!f, JSON.stringify(f));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 }).catch(() => {});
  const key = await page.evaluate(() => { const s = (window.__laCalls || []).find(c => c.m === 'start'); return s ? s.p.sys + '#' + s.p.trainNo : ''; });
  // 正向對照:交班【之前】本機 update 必須推得出來——沒有這一條,下面的 `=== 0` 會退化成
  // 「反正這個環境本來就不會 update」的恆真斷言(盲點形態 2)。
  await page.evaluate(() => { window.__laCalls = []; _laLast = 0; });
  await page.evaluate(() => { if (state.followTrain) laSync(state.followTrain, true); });
  await page.waitForTimeout(200);
  const beforeN = await page.evaluate(() => (window.__laCalls || []).filter(c => c.m === 'update').length);
  ok('T26 正向對照:尚未交班時,本機 update 推得出來(證明下面的「零 update」不是恆真)',
    beforeN >= 1, `update ${beforeN} 次`);
  // 交班
  await page.evaluate(k => window.__laEmit('pushToken', { token: '99'.repeat(32), key: k }), key);
  await page.waitForFunction(() => _laBound !== '', null, { timeout: 10000 }).catch(() => {});
  const bound = await page.evaluate(() => _laBound);
  ok('T26 前置:交班成功,_laBound 已設定', bound === key && !!key, `_laBound=${JSON.stringify(bound)} key=${JSON.stringify(key)}`);
  await page.evaluate(() => { window.__laCalls = []; _laLast = 0; });
  await page.evaluate(() => { if (state.followTrain) laSync(state.followTrain, true); });
  await page.evaluate(() => { if (state.followTrain) laSync(state.followTrain, false); });
  await page.waitForTimeout(800);
  const afterN = await page.evaluate(() => (window.__laCalls || []).filter(c => c.m === 'update').length);
  ok('T26(關鍵)交班成功後不再送本機 update(讓後端獨佔卡片內容,推算不得蓋掉觀測)',
    afterN === 0, `update ${afterN} 次`);
  // 恢復條件:停止跟車 ⇒ laUnbind() 清掉 _laBound ⇒ 下一台車的本機 update 必須恢復,否則卡片會死
  await page.evaluate(() => clearFollow());
  await page.waitForTimeout(300);
  const bound2 = await page.evaluate(() => _laBound);
  ok('T26(關鍵)停止跟車後 _laBound 被清空——本機 update 的恢復條件成立(否則下一張卡會凍住)',
    bound2 === '', JSON.stringify(bound2));
  await ctx.close();
}

// ══════════ T27：停靠中(撥時鐘必定走到,不靠真實資料碰運氣) ══════════
// T1 的停靠分支要不要走到,取決於當下抓到的車剛好在不在站上——沒被走到的分支等於沒驗。
// 這一組把時鐘撥進一段真實的停站窗裡,讓 laPayload 的停靠路徑必定執行,並附「跑行段」反向對照。
{
  const { ctx, page, errors } = await boot(cr, { plus: true });
  const r = await page.evaluate(() => {
    const cand = state.trains.filter(t => {
      if (t.sys !== 'tra_sched' || t.loop) return false;
      const s = t.stops;
      return s && s.length >= 4;
    });
    for (const tr of cand) {
      const s = tr.stops;
      // 要有一站停 ≥30 秒(才進得了 dwellInfoOf 的門檻),且它的前一個停靠站也停 ≥30 秒——
      // 前一站的停站時間就是 depSec 與 arrSec 的差,有了它,departedIso 取錯欄位才會被這條抓到。
      for (let i = 2; i < s.length - 1; i++) {
        if (s[i].stop === false || s[i].depSec - s[i].arrSec < 30) continue;
        let pi = -1;
        for (let k = i - 1; k >= 0; k--) if (s[k].stop !== false) { pi = k; break; }
        if (pi < 0 || s[pi].depSec - s[pi].arrSec < 30) continue;
        // effTLive 對 simSec 有一個固定偏移(誤點校正等),先量出來再反解要撥到哪
        const off = effTLive(tr) - state.simSec;
        const target = s[i].arrSec + Math.floor((s[i].depSec - s[i].arrSec) / 2);   // 停站窗正中央
        state.simSec = target - off; state.clockAtNow = true;
        const t = effTLive(tr);
        const dw = dwellInfoOf(tr, t);
        const nx = nextStopInfo(tr, t);
        const t0 = Date.now();
        const pay = laPayload(tr);                       // ← 真實產品函式
        // 反向對照:同一台車撥到「兩站之間」的跑行段,停靠旗標必須熄掉(證明上面那條不是恆真)
        const mid = Math.floor((s[i].depSec + s[i + 1].arrSec) / 2);
        state.simSec = mid - off; state.clockAtNow = true;
        const payRun = laPayload(tr);
        return {
          no: String(tr.train), t0,
          dwelling: !!(dw && dw.i === i), dwellName: s[i].name, nextName: nx ? nx.name : null,
          prevName: s[pi].name, prevDepSec: s[pi].depSec, prevArrSec: s[pi].arrSec, tAtCall: t,
          pay, runStopping: payRun ? payRun.stopping : null, runName: payRun ? payRun.nextStop : null,
        };
      }
    }
    return null;
  });
  if (!r) {
    ok('T27 停靠中', false, '找不到「連續兩站都停 ≥30 秒」的台鐵車 ⇒ 判準無法執行(視為未通過,勿當成綠燈)');
    ok('T27 停靠中(其餘 5 條隨前置一併不成立)', false, '前置未成立');
    ok('T27 停靠中', false, '前置未成立'); ok('T27 停靠中', false, '前置未成立');
    ok('T27 停靠中', false, '前置未成立'); ok('T27 停靠中', false, '前置未成立');
  } else {
    ok('T27 前置:時鐘已撥進停站窗,產品自己的 dwellInfoOf 也認同(判準不與 laPayload 同源)',
      r.dwelling === true, `車次=${r.no} 停靠站=${r.dwellName}`);
    ok('T27 停靠中 ⇒ payload.stopping===true', !!r.pay && r.pay.stopping === true, JSON.stringify(r.pay));
    // 🔴 這一條才是重點:nextStopInfo 在停站期間【已經跳到下一站】,直接用它卡片就會與後端
    //    (觀測到在站上就顯示該站)打架。要求 nextStop 等於停靠站、且不等於 nextStopInfo 的站。
    ok('T27 停靠中 ⇒ nextStop 是【正停靠的那一站】,不是 nextStopInfo 的下一站',
      !!r.pay && r.pay.nextStop === r.dwellName && r.pay.nextStop !== r.nextName,
      `payload=${r.pay && r.pay.nextStop} 停靠站=${r.dwellName} nextStopInfo=${r.nextName}`);
    // departedIso 必須取上一站的【發車】。取成抵達會早 (depSec-arrSec) 秒——上面挑車時已要求
    // 那個差 ≥30 秒,所以容差 5 秒的這條在取錯欄位時一定紅。
    {
      const gotDelta = r.pay ? (Date.parse(r.pay.departedIso) - r.t0) / 1000 : NaN;
      const wantDep = r.prevDepSec - r.tAtCall, wantArr = r.prevArrSec - r.tAtCall;
      ok('T27 departedIso 取上一站【發車】而非抵達(進度條左端;差的就是那段停站時間)',
        Math.abs(gotDelta - wantDep) < 5 && Math.abs(gotDelta - wantArr) >= 25,
        `got=${gotDelta.toFixed(1)}s 發車=${wantDep}s 抵達=${wantArr}s`);
    }
    ok('T27 prevStop === 前一個停靠站(進度條左端的站名)',
      !!r.pay && r.pay.prevStop === r.prevName, `payload=${r.pay && r.pay.prevStop} 應為=${r.prevName}`);
    ok('T27 反向對照:同一台車撥到跑行段 ⇒ stopping 熄掉、站名換成下一站(證明上面不是恆真)',
      r.runStopping === false && r.runName !== r.dwellName,
      `stopping=${r.runStopping} 站名=${r.runName}(停靠站=${r.dwellName})`);
  }
  ok('T27 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
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
const EXPECTED_COUNTS = { G0: 1, T0: 2, T1: 8, T2: 3, T3: 4, T4: 4, T5: 5, T6: 4, T7: 5, T8: 7, T9: 4, T10a: 5, T10b: 4, T11: 6, T12: 3, T14a: 1, T14b: 1, T14: 6, T15: 2, T16: 2, T17: 2, T18: 1, T19: 2, T20: 4, T21: 2, T22: 3, T23: 2, T24: 1, T25: 7, T25b: 2, T26: 5, T27: 7 };
const actualCounts = {};
// `T\d+[ab]?`:T10a/T10b 是兩個獨立情境(可回復 vs 不可回復),分開記數才不會互相掩護。
// T14a/T14b 同理各自獨立記數;T14c/d/e/f 沒有 a/b 字尾,一律落回裸「T14」桶(見上面正規式)。
// 同理 T25c 落回裸「T25」桶(T25 4 條＋T25c 3 條=7);T25b 有 b 字尾故自成一桶。
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

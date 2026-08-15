// verify_plus_ctas.mjs — 「付費功能有沒有講出來」的行為驗收(2026-08-16)
//
// 背景:2026-08-15 的資格稽核發現六個通行證功能裡有兩個是【不給用也不說】——跟車鎖定畫面
// (liveActivityAllowed() 直接回 false,免費層從頭到尾看不到它存在)與衛星高解析(切過去只是
// 「看起來比較糊」)。同一輪還發現方案面板列了 7 項功能、完全沒提捷運小工具——而「多站」與
// 「自動(最近的站)」正是這一版最有差異化的功能。使用者裁示「加上提示」。
//
// 本檔驗的是【提示真的到得了使用者面前】,不是「原始碼裡有那段字串」:
//   · verify_plus_features.mjs 管的是「清單項 ↔ 真實資格判定 ↔ 條款/說明」三方一致(靜態對映)。
//   · 本檔管的是「在對的情境下,那個提示真的渲染出來、真的點得到、點了真的發生對的事」。
//     兩者刻意分工,不互相取代——前者照不到「元素存在但被遮住/點了跑錯地方」。
//
// 判準設計(對照 assertion-blindspot-taxonomy 與心得 33/37):
//  (1) 互動一律用 page.click() 真的點(Playwright 會等可見、穩定、能收事件),不用
//      elementFromPoint 充當「點得到」——後者對祖先容器恆真,答不了「做得到嗎」。
//  (2) 每一條「應該出現」都配一條【反向對照】(換一個情境應該不出現),否則判準無法分辨
//      「條件對了才出現」與「永遠都出現」。
//  (3) 點擊的斷言落在【結果狀態】上(哪個面板開了、toast 內容、state 有沒有被改),不落在
//      「有沒有被點到」——後者是受測物下游。
//  (4) 🔴 L2/L5 是一對:跟車鎖屏 CTA 借用了誤點履歷的 .fp-dhlink 樣式類,#followPanel 的
//      委派 handler 必須先攔 #fpLaCta 再輪到 .fp-dhlink。少了排序,點 CTA 會跑去開誤點履歷,
//      而且【兩條各自單獨看都是綠的】——L2 驗新的去對地方,L5 驗舊的沒被搶走。
//
// G0 自檢(心得32):ROOT 由本檔自身路徑推導,不吃 --root/env;埠取 0;斷言伺服器吐出的
//   index.html 位元組 === ROOT/index.html。
//
// 環境條件(心得34:紅的三種原因要能分辨):
//   · PLUS_ENABLED 是【頁面載入當下凍結】的 const(原生殼恆真,網站看 ?plus=1)⇒ 一律在
//     goto 的網址帶 ?plus=1,不能在 evaluate 裡補。
//   · SAT_RETINA 同樣是載入當下的 const(讀 window.RAIL_APP_CONFIG.satRetina)⇒ addInitScript。
//   · LIVE_ACTIVITY_ENABLED 讀 window.RAIL_NATIVE_LIVEACTIVITY,同上。
//   · 🔴 /api/basemap-token 必須回真的有 esri 欄位的物件:回 {} 會走 catch ⇒ 頁面把 #satBtn
//     整顆 remove 掉 ⇒ S 組全部「找不到按鈕」而紅,那是【本機沒金鑰】不是產品缺陷(心得34
//     引用的正是這個案例)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    // 高鐵班表:回 {} 會讓 fallbackUrl 永不啟動 ⇒ applySchedSystems 迭代 undefined ⇒ boot 拋錯
    // ⇒ 永遠等不到 state.ready(全 repo 同類腳本共用的慣例,見 verify_metro_wait_entry.mjs)。
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    if (url.pathname === '/api/basemap-token') return res.end('{"esri":"VERIFY-FAKE-TOKEN"}'); // 見檔頭環境條件
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

{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  ok('G0 伺服器吐出的 index.html 與 ROOT 逐 byte 相同', served === INDEX_MD5, `served=${served} root=${INDEX_MD5}`);
}

// plus=1 才有 PLUS_ENABLED(見檔頭);widget=有 RailMetroWait plugin;la=有跟車即時動態橋接;
// satRetina=這個平台建得出高解析衛星層。四者都必須在頁面腳本執行【之前】就位。
async function boot(browser, { plus = true, widget = false, la = false, satRetina = false, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ widget, la, satRetina }) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} // 首訪教學卡會蓋住整張地圖
    if (satRetina) window.RAIL_APP_CONFIG = { satRetina: true };
    if (widget) {
      // 只給 Plugins,刻意不給 isNativePlatform:PLUS_ENABLED 才會維持由 ?plus=1 決定,
      // 這一組情境變數就完全握在測試手上(不會被「注入了 Capacitor 就自動變原生」綁在一起)。
      window.__waitCalls = [];
      const rec = (m, p) => { window.__waitCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null }); return Promise.resolve({ ok: true }); };
      window.Capacitor = { Plugins: { RailMetroWait: {
        start: p => rec('start', p), stop: () => rec('stop', null),
        setPlus: p => rec('setPlus', p),
        addListener: () => Promise.resolve({ remove: () => {} }),
      } } };
    }
    if (la) {
      window.__laCalls = [];
      const recla = (m, p) => { window.__laCalls.push({ m, p: p ? JSON.parse(JSON.stringify(p)) : null }); return Promise.resolve({ ok: true }); };
      window.RAIL_NATIVE_LIVEACTIVITY = {
        start: p => recla('start', p), update: p => recla('update', p), end: () => recla('end', null),
        addListener: () => Promise.resolve({ remove: () => {} }),
      };
    }
  }, { widget, la, satRetina });
  const page = await ctx.newPage();
  // 假 token 送出去的衛星圖磚請求會真的打到 Esri(必然被拒),擋在這裡:不打外網、不製造雜訊。
  // 只擋這一個 host——外部 CDN 的 Leaflet 必須照常載入(心得37:全攔式 route 會讓 boot 拋錯)。
  await page.route('**ibasemaps-api.arcgis.com/**', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of/.test(m.text())) return;
    if (/net::ERR_FAILED/.test(m.text())) return; // 上面 abort 掉的圖磚
    errors.push('console:' + m.text().slice(0, 200));
  });
  await page.goto(base + (plus ? '?plus=1' : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  return { ctx, page, errors };
}

// 形狀比照 index.html plusState() 的初值(與 verify_plus_features.mjs 同一份)。
const setPlus = (page, v) => page.evaluate(vv => {
  state.plus = { active: !!vv, founding: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
}, v);
// 🔴 點不到就記一條 FAIL 然後往下走,不讓 page.click 的 TimeoutError 把整支腳本以未捕捉例外
// 中止——中止會讓它後面所有斷言連同總計行一起消失(「拋例外中止＝整段零覆蓋卻沒人發現」是
// verify-fixture-stub-drift 記過的形狀);突變測試也才看得到完整的紅落在哪幾條。
// 逾時刻意壓到 5 秒:這些元素若存在都是同步渲染好的,等 30 秒只是把失敗變慢。
async function clickOk(page, sel, name) {
  try { await page.click(sel, { timeout: 5000 }); ok(name, true, sel); return true; }
  catch (e) { ok(name, false, `點不到 ${sel}:${String(e).split('\n')[0].slice(0, 70)}`); return false; }
}
const toastText = page => page.evaluate(() => { const t = document.getElementById('toasts'); return t ? t.textContent : ''; });
const clearToasts = page => page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.innerHTML = ''; });
// 開捷運分頁裡某站的看板(比照 verify_metro_wait_entry.mjs 的 openFreqStation)。
const openFreqStation = (page, name) => page.evaluate(n => {
  const g = GROUPS.find(x => x.id === 'metro'); if (g) selectGroup(g);
  const key = n.replace(/臺/g, '台');
  for (const ln of state.lines) for (const s of ln.stations || []) {
    if (s.name.replace(/臺/g, '台') === key) { openBoard({ name: s.name, lat: s.lat, lon: s.lon, sys: 'freq' }); return true; }
  }
  return false;
}, name);
// 挑一班台鐵車交給真的 followTrainNo()(比照 verify_live_activity.mjs)。
// 🔴 深夜沒有任何「此刻在跑」的台鐵車:只挑在跑的會讓整個 L 組在 00:30 之後【因為時間】全紅,
//    而那是環境條件不是產品缺陷(心得34 的三分法;實測 00:55 起 no=null,連突變測試的判定都被
//    污染成無效)。本檔驗的是「入口出不出現/點了去哪裡」,與那班車跑到哪一段無關 ⇒ 找不到在跑的
//    就退而取今天任何一班台鐵車(followTrainNo 會自己把模擬時鐘撥過去),讓判準與牆鐘脫鉤。
const followAnyTRA = page => page.evaluate(() => {
  const g = GROUPS.find(x => x.id === 'tra'); if (g) selectGroup(g);
  const all = state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && t.stops && t.stops.length > 1);
  const run = all.filter(t => {
    const e = effTLive(t), s = t.stops;
    return e > s[0].depSec + 60 && e < s[s.length - 1].arrSec - 300;
  });
  const pool = run.length ? run : all;
  if (!pool.length) return null;
  const tr = pool[Math.floor(pool.length * 0.3)];
  followTrainNo(String(tr.train), { sys: tr.sys });
  return state.followTrain ? { no: String(state.followTrain.train), running: run.length > 0 } : null;
});

// 預設兩引擎都跑;CTA_ENGINES=chromium 只跑一顆(突變測試要跑 5 輪,兩引擎會拖成 15 分鐘)。
// 這個旋鈕只縮小【在哪些引擎上驗】,不改任何期望值,而且實跑的清單會印出來——出貨用的那一次
// 必須是預設值(兩引擎),見報告。
const ENGINE_FILTER = (process.env.CTA_ENGINES || 'chromium,webkit').split(',').map(s => s.trim());
const ENGINES = [['chromium', chromium], ['webkit', webkit]].filter(e => ENGINE_FILTER.includes(e[0]));
console.log(`[engines] ${ENGINES.map(e => e[0]).join(', ')}`);
for (const [engName, launcher] of ENGINES) {
  const browser = await launcher.launch();

  // ══════════ W:捷運站看板的小工具引導(#boardWidgetTip) ══════════
  {
    const { ctx, page, errors } = await boot(browser, { widget: true });
    const opened = await openFreqStation(page, '十四張');
    await page.waitForTimeout(200);
    ok(`[${engName}] W0 前置:開得了捷運站看板`, opened === true, `opened=${opened}`);
    const exists = await page.evaluate(() => !!document.getElementById('boardWidgetTip'));
    ok(`[${engName}] W1 有小工具的 App 上,捷運站看板出現「放上主畫面」引導`, exists === true, `exists=${exists}`);
    await clearToasts(page);
    await clickOk(page, '#boardWidgetTip', `[${engName}] W1b 引導鈕真的點得到(可見、可命中、收得到事件)`);
    await page.waitForTimeout(120);
    const t = await toastText(page);
    // 三個關鍵字缺一不可:少了「自動（最近的站）」與「多站」,這個提示就沒有講到使用者裁示要
    // 強調的那兩個功能;少了「通行證」,就變成宣傳一個他點下去才發現要付錢的東西。
    ok(`[${engName}] W2 點下去真的出現提示,且講到自動選站`, t.includes('自動（最近的站）'), JSON.stringify(t.slice(0, 80)));
    ok(`[${engName}] W2b 提示講到多站`, t.includes('多站'), JSON.stringify(t.slice(0, 80)));
    ok(`[${engName}] W2c 提示講到需要通行證`, t.includes('通行證'), JSON.stringify(t.slice(0, 80)));
    // 反向:這一顆不可以順手把「追蹤這站」按下去(它就在隔壁,共用同一個 h3 的點擊區)。
    const started = await page.evaluate(() => ({
      wait: state.metroWait, calls: (window.__waitCalls || []).filter(c => c.m === 'start').length,
      boardOpen: !!document.getElementById('board') && !document.getElementById('board').hidden,
    }));
    ok(`[${engName}] W3 點引導不會誤觸「追蹤這站」(未開卡、看板仍開著)`,
      !started.wait && started.calls === 0 && started.boardOpen, JSON.stringify(started));
    ok(`[${engName}] W 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 反向對照:沒有小工具的環境(網站/舊版原生殼)不該冒出這個引導——網站根本沒有主畫面小工具這回事。
  {
    const { ctx, page, errors } = await boot(browser, { widget: false });
    await openFreqStation(page, '十四張');
    await page.waitForTimeout(200);
    const exists = await page.evaluate(() => !!document.getElementById('boardWidgetTip'));
    ok(`[${engName}] W4 反向:沒有小工具的環境不出現引導`, exists === false, `exists=${exists}`);
    ok(`[${engName}] W4 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ══════════ L:跟車鎖定畫面的通行證入口(#fpLaCta) ══════════
  {
    const { ctx, page, errors } = await boot(browser, { la: true });
    const f = await followAnyTRA(page);
    ok(`[${engName}] L0 前置:跟得到一班台鐵車`, !!f, `f=${JSON.stringify(f)}`);
    const shown = await page.evaluate(() => {
      const el = document.getElementById('fpLaCta');
      return el ? { hidden: el.hidden, text: el.textContent } : null;
    });
    ok(`[${engName}] L1 未訂閱＋原生殼有此能力＋跟車中 ⇒ 入口出現且說得出是什麼`,
      !!shown && shown.hidden === false && shown.text.includes('鎖定畫面'), JSON.stringify(shown));
    // 點下去要開【通行證】面板,而不是誤點履歷卡(見檔頭 (4))。
    await clickOk(page, '#fpLaCta .fp-dhlink', `[${engName}] L1b 入口真的點得到`);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      plus: !!document.getElementById('plusModal') && !document.getElementById('plusModal').hidden,
      dh: !!document.getElementById('delayHistPanel') && !document.getElementById('delayHistPanel').hidden,
    }));
    ok(`[${engName}] L2 點了開通行證面板`, after.plus === true, JSON.stringify(after));
    ok(`[${engName}] L2b 點了【不會】跑去開誤點履歷(委派順序)`, after.dh === false, JSON.stringify(after));
    // 反向一:已訂閱的人不看廣告。
    await page.evaluate(() => { const m = document.getElementById('plusModal'); if (m) m.hidden = true; });
    await setPlus(page, true);
    await page.evaluate(() => renderLaCta());
    const whenPaid = await page.evaluate(() => document.getElementById('fpLaCta').hidden);
    ok(`[${engName}] L3 反向:已訂閱就不再出現這個入口`, whenPaid === true, `hidden=${whenPaid}`);
    // 反向二:沒跟車就沒有「這班車」可講。
    await setPlus(page, false);
    await page.evaluate(() => { clearFollow(); renderLaCta(); });
    const whenIdle = await page.evaluate(() => document.getElementById('fpLaCta').hidden);
    ok(`[${engName}] L4 反向:沒在跟車時不出現`, whenIdle === true, `hidden=${whenIdle}`);
    ok(`[${engName}] L 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 反向三:網站(沒有跟車鎖定畫面這個能力)不該宣傳一個它給不了的東西。
  {
    const { ctx, page, errors } = await boot(browser, { la: false });
    const f = await followAnyTRA(page);
    const hidden = await page.evaluate(() => document.getElementById('fpLaCta').hidden);
    ok(`[${engName}] L5 前置:跟得到一班台鐵車`, !!f, `f=${JSON.stringify(f)}`);
    ok(`[${engName}] L5 反向:網站(無原生即時動態)不出現這個入口`, hidden === true, `hidden=${hidden}`);
    ok(`[${engName}] L5 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 🔴 回歸對照:新入口借用了 .fp-dhlink 這個類名並插隊在委派 handler 的最前面——
  // 舊的「誤點履歷 ›」必須還是打得開誤點履歷。這一條與 L2b 是一對,少一條就照不到搶事件。
  {
    const { ctx, page, errors } = await boot(browser, { la: true });
    const f = await followAnyTRA(page);
    // 前置要具名斷言:跟不到車時下面的注入會用 "null" 當鍵,rowShown 恆假——那是環境,不是回歸。
    ok(`[${engName}] L6 前置:跟得到一班台鐵車`, !!f, `f=${JSON.stringify(f)}`);
    const no = f ? f.no : '';
    // 🔴 注入前必須等頁面自己那發 ensureDelayStats() 落地:它 .finally 會把 state.delayStats
    // 設成 {} 並重跑 renderDelayRow ⇒ 早注入的假統計會被【非同步洗掉】,而且洗掉的時間點落在
    // 「前置斷言已經綠了」與「click」之間 ⇒ 症狀是 click 逾時找不到元素,不是斷言轉紅
    // (verify-fixture-stub-drift 家族:替身被頁面自己的請求覆蓋)。
    await page.waitForFunction(() => !!state.delayStats && !state._delayStatsFetching, null, { timeout: 20000 });
    // 注入一份足量的統計(d>=5 是 renderDelayRow 的顯示門檻)。
    const rowShown = await page.evaluate(n => {
      state.delayStats = Object.assign({}, state.delayStats, { [n]: { a: 6.2, p: 55, d: 20, m: 31 } });
      renderDelayRow();
      const el = document.getElementById('fpDelay');
      return !!el && !el.hidden && !!el.querySelector('.fp-dhlink');
    }, no);
    ok(`[${engName}] L6 前置:誤點履歷入口渲染得出來`, rowShown === true, `rowShown=${rowShown}`);
    await clickOk(page, '#fpDelay .fp-dhlink', `[${engName}] L6a 誤點履歷入口真的點得到`);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      dh: !!document.getElementById('delayHistPanel') && !document.getElementById('delayHistPanel').hidden,
      plus: !!document.getElementById('plusModal') && !document.getElementById('plusModal').hidden,
    }));
    ok(`[${engName}] L6 回歸:「誤點履歷 ›」仍然打開誤點履歷(沒被新入口攔走)`, after.dh === true, JSON.stringify(after));
    ok(`[${engName}] L6b 回歸:它不會反過來開成通行證面板`, after.plus === false, JSON.stringify(after));
    ok(`[${engName}] L6 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ══════════ S:切到衛星時說明高解析屬通行證 ══════════
  {
    const { ctx, page, errors } = await boot(browser, { satRetina: true });
    await page.waitForFunction(() => { try { return satTokenState === 'ready'; } catch (e) { return false; } }, null, { timeout: 20000 });
    const btn = await page.evaluate(() => !!document.getElementById('satBtn'));
    ok(`[${engName}] S0 前置:衛星鈕還在(token 拿得到;拿不到頁面會把它 remove)`, btn === true, `btn=${btn}`);
    await clearToasts(page);
    await clickOk(page, '#satBtn', `[${engName}] S0b 衛星鈕點得到`);
    await page.waitForTimeout(150);
    const t1 = await toastText(page);
    ok(`[${engName}] S1 未訂閱切進衛星:講出有更清楚的版本`, t1.includes('高解析'), JSON.stringify(t1.slice(0, 60)));
    ok(`[${engName}] S1b 同一句要說得出去哪裡開通`, t1.includes('通行證'), JSON.stringify(t1.slice(0, 60)));
    // 一輩子只講一次:切底圖是高頻動作,第二次就是騷擾。
    await clearToasts(page);
    await clickOk(page, '#satBtn', `[${engName}] S2a 切回一般地圖`);
    await clickOk(page, '#satBtn', `[${engName}] S2b 再切進衛星`);
    await page.waitForTimeout(150);
    const t2 = await toastText(page);
    ok(`[${engName}] S2 第二次切進衛星不再重複提示`, !t2.includes('高解析'), JSON.stringify(t2.slice(0, 60)));
    ok(`[${engName}] S 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 反向一:已訂閱的人本來就拿得到高解析,不該被通知。
  {
    const { ctx, page, errors } = await boot(browser, { satRetina: true });
    await page.waitForFunction(() => { try { return satTokenState === 'ready'; } catch (e) { return false; } }, null, { timeout: 20000 });
    await setPlus(page, true);
    await clearToasts(page);
    await clickOk(page, '#satBtn', `[${engName}] S3a 衛星鈕點得到`);
    await page.waitForTimeout(150);
    const t = await toastText(page);
    ok(`[${engName}] S3 反向:已訂閱不出現這個提示`, !t.includes('高解析'), JSON.stringify(t.slice(0, 60)));
    ok(`[${engName}] S3 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 反向二:網站的 SAT_RETINA 預設 false ⇒ 那裡根本沒有「更清楚的版本」可買,不可以宣傳。
  {
    const { ctx, page, errors } = await boot(browser, { satRetina: false });
    await page.waitForFunction(() => { try { return satTokenState === 'ready'; } catch (e) { return false; } }, null, { timeout: 20000 });
    await clearToasts(page);
    await clickOk(page, '#satBtn', `[${engName}] S4a 衛星鈕點得到`);
    await page.waitForTimeout(150);
    const t = await toastText(page);
    ok(`[${engName}] S4 反向:平台建不出高解析層時不出現這個提示`, !t.includes('高解析'), JSON.stringify(t.slice(0, 60)));
    ok(`[${engName}] S4 無 JS 例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
}

await new Promise(r => server.close(r));

const passN = results.filter(r => r.pass).length;
const failN = results.length - passN;
console.log(`\n──────── ${passN}/${results.length} PASS ────────`);
if (failN > 0) {
  console.log('[FAILED]');
  for (const r of results) if (!r.pass) console.log(`  - ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  process.exitCode = 1;
}

// 捷運等車卡「開了卻沒出現」的行為驗證——Playwright 真引擎 + 本機靜態伺服器 + 凍結樣本。
// 2026-08-22 建立。對應使用者回報:「點桌面小工具又鎖 App 時可能不會出現動態島跟卡片,
// 打開 App 重新追蹤有時也不會出現」。
//
// 本腳本先寫、後修:寫的當下 T1b/T2a/T2b 必紅(那就是缺陷本身),修法後必綠。
//
// ── 供判準依據的關鍵事實(從 index.html 讀出,非本腳本實作) ──────────────────────────
//   · metroWaitStartFor(sys, st, lines, isDeco, dest, sourceBundle, durationMin) 是唯一的開卡入口;
//     它拿到 bundle 後組 payload,呼叫原生 Capacitor.Plugins.RailMetroWait.start(payload)。
//   · 北捷的 bundle 來自 metroWaitTrtcBundle → trtcOfficialBoardView,而後者第一行就吃
//     trtcOfficialBoardRealNow():要求 clockAtNow && playing && speedMult===1 && !_scrubTime
//     && |simSec-now|<=120。setSpeed(v!==1) 會把 clockAtNow 設 false,而【轉回 1× 不會設回來】。
//   · 深連結(小工具點擊)走 ensureMetroWaitListener() 掛的 'waitOpen' 事件,handler 內有一個
//     最多 66×300ms 的等待迴圈,舊版條件含 document.hidden。
//   · iOS 規定 Activity.request 只能在前景成功(ActivityAuthorizationError.visibility:
//     "The app tried to start the Live Activity while it was in the background.")
//     ⇒ 背景呼叫 start 必敗,而且失敗只有 toast、鎖屏看不到 ⇒ 正確行為是【不要在背景呼叫】。
//
// ── 判準設計 ─────────────────────────────────────────────────────────────────────
//   · 一律量「原生 start() 有沒有被呼叫、被呼叫幾次、payload 內容」,不看 clockAtNow 之類的內部
//     旗標——旗標是實作,量它等於覆述實作(judgment 心得 29)。
//   · 每一條「該開卡」的斷言都配一條「不該開卡」的反向對照(T1d/T2c),否則「乾脆無條件開卡」
//     也能全綠(cross-runtime-entitlement-flag-sync 的同款教訓)。
//   · 凍結樣本的時戳由伺服器動態平移到「現在」,測試才不依賴當下真的有沒有車。

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// G0 自檢(心得 32):ROOT 由本檔自身路徑推導,不吃 --root/env,結構上不會驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${IDX_MD5}`);

const FIX = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/trtc-live-wait.json'), 'utf8'));
// 樣本基準時刻＝board 裡最大的 at(資料產生的那一刻)
const FIX_BASE = Math.max(...FIX.board.map(r => Number(r.at) || 0));
if (!Number.isFinite(FIX_BASE) || FIX_BASE <= 0) { console.error('fixture 壞了:算不出基準時刻'); process.exit(1); }

// 平移到現在:board 的 eta/at 同步位移,頂層 at 一起換,其餘欄位不動(等車卡只吃 board)。
const shiftedBoard = (emptyBoard = false) => {
  const now = Math.floor(Date.now() / 1000);
  const d = now - FIX_BASE;
  const board = emptyBoard ? [] : FIX.board.map(r => ({ ...r, eta: Number(r.eta) + d, at: Number(r.at) + d }));
  return JSON.stringify({ ...FIX, at: new Date(now * 1000).toISOString(), board });
};

let EMPTY_BOARD = false;   // T1d 用:讓官方看板真的空掉
const PORT = Number(process.env.PORT || 0);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/trtc-live') return res.end(shiftedBoard(EMPTY_BOARD));
    // 高鐵班表現在以 api 為主來源,空物件會讓 boot 在 state.ready 之前拋錯(既有 harness 的教訓)
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((r, j) => { server.on('error', j); server.listen(PORT, r); });
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log(`[G0] server=${BASE}`);

const results = [];
const check = (id, desc, pass, detail = '') => {
  results.push({ id, pass, desc, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${desc}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();

// 每個情境都用乾淨的 page:互動累積狀態會互相污染(judgment 心得 28)。
const newPage = async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    // 可控的 document.hidden——真鎖屏在瀏覽器裡無法重現,但頁面所有相關分支讀的就是這兩顆。
    let _h = false;
    Object.defineProperty(document, 'hidden', { get: () => _h, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => (_h ? 'hidden' : 'visible'), configurable: true });
    window.__setHidden = (v) => { _h = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    // 假的原生等車卡 plugin:記錄每一發 start/stop/status,並可回放 waitOpen 深連結事件。
    const calls = { start: [], stop: 0, status: 0 };
    const listeners = {};
    window.__mwCalls = calls;
    window.__mwFire = (name, evt) => { (listeners[name] || []).forEach(fn => fn(evt)); };
    window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.RailMetroWait = {
      start: async (payload) => {
        calls.start.push({ payload, hiddenAtCall: document.hidden, t: Date.now() });
        return { ok: true, id: 'stub', endAt: Math.round(Date.now() / 1000) + 1800 };
      },
      stop: async () => { calls.stop++; return { ok: true }; },
      status: async () => { calls.status++; return { active: false }; },
      addListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return { remove() {} }; },
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, { timeout: 90000 })
    .catch(() => { throw new Error('boot 未 ready;pageerror=' + JSON.stringify(errs)); });
  // 切到捷運群組(等車卡只服務捷運;不切的話 pollTrtcLive 的 pool 條件不成立)
  await page.evaluate(() => {
    const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => x.id === 'metro');
    if (g && typeof selectGroup === 'function') selectGroup(g);
  });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.trtcOfficialBoard
       && Array.isArray(state.trtcOfficialBoard.rows) && state.trtcOfficialBoard.rows.length > 0,
    { timeout: 60000 }
  ).catch(() => {});
  return { ctx, page, errs };
};

// 挑一個樣本裡真的有倒數、且頁面找得到的北捷站
const pickStation = async (page) => page.evaluate(() => {
  const rows = (state.trtcOfficialBoard && state.trtcOfficialBoard.rows) || [];
  for (const r of rows) {
    const st = metroWaitFindStation(r.name) || metroWaitFindStation(String(r.name).replace(/站$/, ''));
    if (st) return { name: st.name, raw: r.name };
  }
  return null;
});

const startFor = async (page, stName) => page.evaluate(async (n) => {
  const st = metroWaitFindStation(n);
  await metroWaitStartFor('trtc', st, state.lines, state.deco);
}, stName);

// ── T1:時鐘閘門 ────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await newPage();
  const st = await pickStation(page);
  check('T1-0', '樣本裡找得到可追蹤的北捷站', !!st, st ? `${st.raw} → ${st.name}` : '找不到任何站');
  if (st) {
    // T1a 正向對照:什麼都沒動,本來就該開得成
    await startFor(page, st.name);
    let c = await page.evaluate(() => window.__mwCalls.start.length);
    check('T1a', '時鐘在「現在」時,追蹤這站會呼叫原生開卡', c === 1, `start 被呼叫 ${c} 次`);

    const pay = await page.evaluate(() => window.__mwCalls.start[0] && window.__mwCalls.start[0].payload);
    check('T1a-2', '開卡 payload 帶著官方絕對到站時刻(nextEta)', !!(pay && Number(pay.nextEta) > 0),
      pay ? `nextEta=${pay.nextEta}` : '無 payload');

    // T1b 缺陷情境:動過速度滑桿再轉回 1×
    await page.evaluate(() => { setSpeed(4); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { setSpeed(1); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__mwCalls.start.length = 0; });
    await startFor(page, st.name);
    await page.waitForTimeout(1200);
    c = await page.evaluate(() => window.__mwCalls.start.length);
    check('T1b', '動過速度滑桿再轉回 1× 之後,追蹤這站【仍然】開得成', c === 1, `start 被呼叫 ${c} 次`);

    // T1c 修法不可作弊:必須是把時鐘帶回「現在」才拿到資料,不是繞過閘門硬送
    const realNow = await page.evaluate(() => trtcOfficialBoardRealNow());
    check('T1c', '開得成的原因是時鐘真的回到「現在」,不是繞過閘門', realNow === true, `trtcOfficialBoardRealNow()=${realNow}`);
  }
  await ctx.close();
}

// T1d 反向對照:官方真的沒有這一站的班次時,不可以開卡
{
  EMPTY_BOARD = true;
  const { ctx, page } = await newPage();
  const any = await page.evaluate(() => {
    const ln = (state.lines || []).find(l => (l.stations || []).length);
    const s = ln && ln.stations && ln.stations[0];
    return s ? s.name : null;
  });
  if (any) {
    await page.evaluate(async (n) => {
      const st = metroWaitFindStation(n);
      if (st) await metroWaitStartFor('trtc', st, state.lines, state.deco);
    }, any);
    await page.waitForTimeout(6000);   // 讓內建三輪補抓跑完
    const c = await page.evaluate(() => window.__mwCalls.start.length);
    check('T1d', '官方真的沒有班次時,不可以開卡(反向對照)', c === 0, `start 被呼叫 ${c} 次`);
  } else check('T1d', '官方真的沒有班次時,不可以開卡(反向對照)', false, '找不到任何站可測');
  await ctx.close();
  EMPTY_BOARD = false;
}

// ── T2:背景(鎖屏)不得開卡,回前景要補開 ──────────────────────────────────────────
{
  const { ctx, page } = await newPage();
  const st = await pickStation(page);
  if (st) {
    // 模擬「點小工具之後立刻鎖屏」:先進背景,再送深連結事件
    await page.evaluate(() => window.__setHidden(true));
    const t0 = Date.now();
    await page.evaluate((n) => window.__mwFire('waitOpen', { sys: 'trtc', station: n }), st.name);

    // T2a-2 專測「空轉迴圈」那條修法。🔴 補這一項是因為做突變測試時才發現:其餘九項【沒有
    //    一項】測得到它——它們都在 boot 已 ready 之後跑,而舊版迴圈條件是
    //    (document.hidden || !state.ready),鎖屏時前半恆真,所以照樣空轉滿 19.8 秒,
    //    但沒有任何斷言在量時間 ⇒ 把那條修法整個還原回去也會全綠(心得 37:突變由實作者
    //    自己設計,會系統性漏掉他沒想到的維度)。
    //    判準取 openBoard 的副作用 state.boardStation:它在 metroWaitStartFor 之前執行,
    //    背景擋下/補開/過期哪一條分支都會經過 ⇒ 只反映迴圈本身,不與其他三條修法糾纏。
    const handled = await page.waitForFunction(
      (n) => typeof state !== 'undefined' && !!state.boardStation && state.boardStation.name === n,
      st.name, { timeout: 30000, polling: 100 }
    ).then(() => true).catch(() => false);
    const handledMs = Date.now() - t0;
    check('T2a-2', '鎖屏送達的深連結不會先空轉 20 秒才處理', handled && handledMs < 5000,
      handled ? `事件送達到看板開好 ${handledMs} ms` : '30 秒內都沒處理');

    // 🔴 必須等超過 19.8 秒(66×300ms)。舊版是靠那個逾時才往下走的,等 9 秒就宣告「沒呼叫」
    //    等於還沒跑到就判它通過——無牙的斷言(judgment 心得 37)。逾時後 bundle 仍在 45 秒
    //    保鮮期內,舊版會真的在背景呼叫 start,這一項才有鑑別力。
    await page.waitForTimeout(26000);
    // 🔴 判準分辨前景/背景兩種呼叫,不看總數:舊版在背景送出的那一發也會讓「總數===1」成立,
    //    只數總數會讓 T2b 綠得跟修好一樣(第一版就是這樣假綠的)。
    let bg = await page.evaluate(() => window.__mwCalls.start.filter(c => c.hiddenAtCall).length);
    check('T2a', '畫面不可見(鎖屏)時,不可以呼叫原生開卡', bg === 0, `背景送出 ${bg} 發`);

    // 回到前景:應該補開一次
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(8000);
    const fg = await page.evaluate(() => window.__mwCalls.start.filter(c => !c.hiddenAtCall).length);
    check('T2b', '回到前景時,把剛才被擋下的那張卡補開起來', fg === 1, `前景送出 ${fg} 發`);
    bg = await page.evaluate(() => window.__mwCalls.start.filter(c => c.hiddenAtCall).length);
    check('T2b-2', '整段過程沒有任何一發是在背景送出的', bg === 0, `背景送出 ${bg} 發`);
  } else check('T2a', '畫面不可見時不可以呼叫原生開卡', false, '找不到站');
  await ctx.close();
}

// T2c 反向對照:待辦太舊就不該補開(使用者隔了很久才回來,不該憑空冒出一張卡)
{
  const { ctx, page } = await newPage();
  const st = await pickStation(page);
  if (st) {
    await page.evaluate(() => window.__setHidden(true));
    await page.evaluate((n) => window.__mwFire('waitOpen', { sys: 'trtc', station: n }), st.name);
    await page.waitForTimeout(26000);
    // 把待辦的時戳往回撥 30 分鐘(超過保鮮期),再回前景
    const aged = await page.evaluate(() => {
      if (typeof _mwPendingOpen === 'undefined' || !_mwPendingOpen) return false;
      _mwPendingOpen.at -= 30 * 60 * 1000;
      return true;
    });
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(6000);
    const fg = await page.evaluate(() => window.__mwCalls.start.filter(c => !c.hiddenAtCall).length);
    check('T2c', '待辦過期(隔太久才回前景)就不補開(反向對照)', aged && fg === 0,
      aged ? `前景送出 ${fg} 發` : '找不到待辦變數 _mwPendingOpen(修法尚未實作?)');
  } else check('T2c', '待辦過期就不補開(反向對照)', false, '找不到站');
  await ctx.close();
}

// ── T3:原生沒有回應時,不可以永遠卡住 ──────────────────────────────────────────────
// RailMetroWaitPlugin 的 start/stop/status 共用一條 Task 佇列,任一 job 不完成三支就全部
// 不 resolve。這裡直接做出那個狀態(start 回一個永不 resolve 的 promise),量「開卡流程有沒有
// 自己收尾」。判準不看 toast 文字(那是實作),看的是使用者感受得到的那件事:流程有沒有結束。
{
  const { ctx, page } = await newPage();
  const st = await pickStation(page);
  if (st) {
    const ms = await Promise.race([
      page.evaluate(async (n) => {
        window.Capacitor.Plugins.RailMetroWait.start = () => new Promise(() => {});
        const stn = metroWaitFindStation(n);
        const t0 = Date.now();
        await metroWaitStartFor('trtc', stn, state.lines, state.deco);
        return Date.now() - t0;
      }, st.name).catch(() => Infinity),
      // page.evaluate 預設不會自己逾時 ⇒ 沒有這一層,缺陷版會讓整支腳本永遠掛著(而不是報紅)
      new Promise(r => setTimeout(() => r(Infinity), 25000)),
    ]);
    check('T3', '原生沒有回應時,開卡會自己收尾,不會永遠卡住', Number.isFinite(ms) && ms < 15000,
      Number.isFinite(ms) ? `${ms} ms 後收尾` : '25 秒仍未收尾(等於使用者眼中的「點了沒反應」)');
  } else check('T3', '原生沒有回應時,開卡會自己收尾', false, '找不到站');
  await ctx.close();
}

await browser.close();
server.close();

const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,通過 ${results.length - bad.length},未過 ${bad.length}`);
if (bad.length) { console.log('未過:', bad.map(b => b.id).join(', ')); process.exit(1); }

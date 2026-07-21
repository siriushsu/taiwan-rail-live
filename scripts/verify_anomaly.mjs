// 自家營運異常偵測驗證(index.html)——Playwright chromium。
// 起一個「純靜態」本機伺服器(不載 worker.js,與正在被改動的 worker 隔離),載入 index.html 到 state.ready,
// 再用 page.evaluate 注入合成資料、直接呼叫內部函式驗狀態機(不打真 API)。
// 合成 diff 由 stub nearestArrDiff 依序回傳(applyMetroLive 每個可取樣 row 消費一個),
// 每個情境用獨立 _sys(異常狀態機 key=_sys+':'+id)彼此隔離,不需清模組級 Map。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5188);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('no api in verify'); } // 測試不打真 API,一律 404(app 端 catch 保留舊資料)
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const URLROOT = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); });
const page = await ctx.newPage();
const pageErrors = [], consoleErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(URLROOT, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
await page.waitForTimeout(500);
const baseConsole = consoleErrors.length, basePageErr = pageErrors.length;

// ── 在頁面裝上 stub 與假線工廠;凍結 draw 避免注入假線後繪製報錯 ──
await page.evaluate(() => {
  window.__origNAD = nearestArrDiff;
  window.nearestArrDiff = () => (window.__dq && window.__dq.length) ? window.__dq.shift() : 0; // 依序回傳合成 diff
  window.mkFake = (sys) => ({
    id: 'BL', _sys: sys, name: '測試線', color: '#0044cc', loop: false,
    stations: Array.from({ length: 20 }, (_, i) => ({ name: 'S' + i, lat: 25 + i * 0.001, lon: 121 })),
    _tt: [[0, 30000, 5, 30300, 10, 30600, 19, 30900]],
  });
  window.feedMetro = (sys, diffs) => { // 模擬一次 poll:每個 diff 一 row(s='S5'→d='S10' 前進向),stub 依序回傳
    window.__dq = diffs.slice();
    applyMetroLive(sys, diffs.map(() => ({ op: 'TRTC', l: 'BL', s: 'S5', d: 'S10', st: 0, e: 3 })));
  };
  state.ready = false;
});

const BIMODAL = [540, 540, 540, 540, -360, -360, -360, -360]; // 半數 +9 分、半數 −6 分(機捷 9 分誤點型)→ MAD 大
const NORMAL = [30, -30, 45, -45, 60, -60];                    // 群聚 ±60s → MAD 小
const OVER = [900, 900, 900, 900, 900, 900];                   // 全部 +15 分 > ±10 分窗 → 全 reject

// 情境 1:正常 rows 連 3 次 → 無異常、徽章非異常
{
  const r = await page.evaluate(({ NORMAL }) => {
    const sys = 'anom_s1', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, NORMAL); feedMetro(sys, NORMAL); feedMetro(sys, NORMAL);
    updateMetroBadge();
    const b = document.getElementById('metroBadge');
    return { anom: anomalyOf(fake), badgeAnom: b.classList.contains('anom') };
  }, { NORMAL });
  ok('S1 正常樣本連 3 次:無異常、徽章非異常', r.anom === null && !r.badgeAnom, JSON.stringify(r));
}

// 情境 2:雙峰 rows 連 2 次 → 進異常(spread)、徽章「異常推定」、橫幅「疑似營運異常」
{
  const r = await page.evaluate(({ BIMODAL }) => {
    const sys = 'anom_s2', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, BIMODAL); feedMetro(sys, BIMODAL);
    updateMetroBadge(); renderAlertBanner();
    const b = document.getElementById('metroBadge'), ban = document.getElementById('alertBanner');
    return { anom: anomalyOf(fake), badgeText: b.textContent, badgeAnom: b.classList.contains('anom'), bannerHidden: ban.hidden, bannerHtml: ban.innerHTML };
  }, { BIMODAL });
  ok('S2 雙峰連 2 次:進異常 kind=spread', !!(r.anom && r.anom.kind === 'spread'), JSON.stringify(r.anom));
  ok('S2 徽章轉「異常推定」', /異常推定/.test(r.badgeText) && r.badgeAnom, r.badgeText);
  ok('S2 橫幅顯示「疑似營運異常」', !r.bannerHidden && /疑似營運異常/.test(r.bannerHtml), r.bannerHtml.slice(0, 90));
}

// 情境 3:超窗 rows 連 2 次 → 進異常(reject)
{
  const r = await page.evaluate(({ OVER }) => {
    const sys = 'anom_s3', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, OVER); feedMetro(sys, OVER);
    return { anom: anomalyOf(fake) };
  }, { OVER });
  ok('S3 超窗連 2 次:進異常 kind=reject', !!(r.anom && r.anom.kind === 'reject'), JSON.stringify(r.anom));
}

// 情境 4:進異常後正常 rows 連 2 次 → 清除、徽章復原
{
  const r = await page.evaluate(({ BIMODAL, NORMAL }) => {
    const sys = 'anom_s4', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, BIMODAL); feedMetro(sys, BIMODAL);
    const entered = anomalyOf(fake);
    feedMetro(sys, NORMAL); feedMetro(sys, NORMAL);
    updateMetroBadge();
    const b = document.getElementById('metroBadge');
    return { entered, cleared: anomalyOf(fake), badgeAnom: b.classList.contains('anom') };
  }, { BIMODAL, NORMAL });
  ok('S4 進異常→正常連 2 次:清除、徽章復原', !!(r.entered && r.entered.kind === 'spread') && r.cleared === null && !r.badgeAnom, JSON.stringify({ e: r.entered, c: r.cleared }));
}

// 情境 5:台鐵系統級 —— 80 車、12 車誤點≥10 分、最高 25 → 規模門檻(d10≥8)連 2 次進;恢復 d10=0 → 連 2 次清除
{
  const r = await page.evaluate(() => {
    state.mode = 'sched'; state.deco = false; state.decoLines = null;
    state.schedSystems = [{ id: 'tra_sched', live: 'x', label: '台鐵' }];
    state.simSec = nowSecOfDay(); state.speedMult = 1;
    state.live = { map: new Map(), at: Date.now(), delayed: 30, srcAt: '2026-07-17T20:00' };
    state.alert = { list: [] }; state.metroAlert = null; state.traAnomaly = null;
    evalTraAnomaly(80, 12, 25); const after1 = state.traAnomaly ? { ...state.traAnomaly } : null; // strike=1 不觸發
    evalTraAnomaly(80, 12, 25); const after2 = state.traAnomaly ? { ...state.traAnomaly } : null; // strike=2 進
    renderAlertBanner();
    const ban = document.getElementById('alertBanner');
    const enteredBanner = { hidden: ban.hidden, html: ban.innerHTML };
    evalTraAnomaly(80, 0, 3); evalTraAnomaly(80, 0, 3); // 連 2 次 clear(d10=0)
    renderAlertBanner();
    return { after1, after2, enteredBanner, cleared: state.traAnomaly, clearedHidden: ban.hidden };
  });
  ok('S5 台鐵:單次不觸發、連 2 次進', r.after1 === null && !!(r.after2 && r.after2.d10 === 12 && r.after2.maxDelay === 25), JSON.stringify({ a1: r.after1, a2: r.after2 }));
  ok('S5 橫幅顯示「台鐵大面積誤點…滿 10 分」', !r.enteredBanner.hidden && /台鐵大面積誤點.*滿 10 分/.test(r.enteredBanner.html), r.enteredBanner.html.slice(0, 90));
  ok('S5 恢復連 2 次:清除、橫幅收起', r.cleared === null && r.clearedHidden, JSON.stringify({ c: r.cleared, h: r.clearedHidden }));
}

// 情境 5b:回歸——判定只看誤點≥10 分。今早實測 151 車、0 車≥10 分、最高 9 分(舊「任何誤點≥20 班且≥25%」會誤報)→ 不觸發;
// 離峰 45 車、8 車≥10 分(18%)→ 比例門檻(≥6 車且≥15%)觸發。
{
  const r = await page.evaluate(() => {
    state.traAnomaly = null;
    evalTraAnomaly(151, 0, 9); evalTraAnomaly(151, 0, 9); // 大量 1~4 分輕微誤點、0 車滿 10 分 → 連 2 次仍不觸發
    const trivial = state.traAnomaly;
    evalTraAnomaly(45, 8, 18); evalTraAnomaly(45, 8, 18); // 8/45=18% ≥15% 且 8≥6 → 比例門檻連 2 次進
    const ratio = state.traAnomaly ? { ...state.traAnomaly } : null;
    state.traAnomaly = null;
    return { trivial, ratio };
  });
  ok('S5b 大量輕微誤點不觸發(只認≥10 分)', r.trivial === null, JSON.stringify(r.trivial));
  ok('S5b 離峰比例門檻(8 車≥10 分/45=18%)觸發', !!(r.ratio && r.ratio.d10 === 8), JSON.stringify(r.ratio));
}

// 情境 6:單次異常樣本(strike=1)不觸發(防抖)
{
  const r = await page.evaluate(({ BIMODAL }) => {
    const sys = 'anom_s6', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, BIMODAL); // 只 1 次
    return { anom: anomalyOf(fake) };
  }, { BIMODAL });
  ok('S6 單次異常樣本(strike=1)不觸發', r.anom === null, JSON.stringify(r));
}

// 情境 7:全台同框 sched + metro-alert 注入 → 橫幅顯示捷運公告
{
  const r = await page.evaluate(() => {
    state.mode = 'sched'; state.deco = true;
    state.decoLines = [{ id: 'C', _sys: 'klrt', name: '高雄輕軌', stations: [] }];
    state.alert = { list: [] }; state.traAnomaly = null; state.live = null;
    state.metroAlert = { at: '', list: [{ sys: 'klrt', status: 0, title: '汽車闖入輕軌軌道區', desc: 'x' }] };
    renderAlertBanner();
    const ban = document.getElementById('alertBanner');
    return { hidden: ban.hidden, html: ban.innerHTML, titles: activeAlertList().map(a => a.title) };
  });
  ok('S7 全台同框顯示捷運公告', !r.hidden && /汽車闖入輕軌軌道區/.test(r.html), JSON.stringify(r.titles));
}

// 情境 8(回歸):倖存樣本健康時 reject 不觸發 —— 2026-07-17 淡海綠山線實測誤報案
// (分岔線/末班時段有結構性對不上的看板列:acc 6 個健康樣本 + rej 7 → 54% 棄置率,但該線追蹤明明正常)
{
  const GREEN = [-8, -6, 16, 39, 42, 125, 900, 900, 900, 900, 900, 900, 900]; // acc6(健康) + rej7
  const r = await page.evaluate(({ GREEN }) => {
    const sys = 'anom_s8', fake = mkFake(sys);
    state.mode = 'freq'; state.deco = false; state.decoLines = null; state.lines = [fake]; state.freqSel = new Set([sys]); state.sysId = sys;
    feedMetro(sys, GREEN); feedMetro(sys, GREEN);
    return { anom: anomalyOf(fake) };
  }, { GREEN });
  ok('S8 倖存樣本健康(acc≥5):高棄置率不觸發 reject(綠山線回歸)', r.anom === null, JSON.stringify(r.anom));
}

// 情境 U:狀態機直接單測 —— 無資料維持現狀 / 交管不停(skip)
{
  const r = await page.evaluate(() => {
    const fake = mkFake('anom_unit');
    evalLineAnomaly(fake, [10, 20], 0, 0); const a1 = anomalyOf(fake);        // n<6 且無 st2 → 不進不出
    evalLineAnomaly(fake, [], 0, 3); evalLineAnomaly(fake, [], 0, 3); const a2 = anomalyOf(fake); // st2>=2 連 2 次
    return { a1, a2 };
  });
  ok('U1 樣本不足視為無資料(不觸發)', r.a1 === null, JSON.stringify(r.a1));
  ok('U2 交管不停連 2 次:進異常 kind=skip', !!(r.a2 && r.a2.kind === 'skip'), JSON.stringify(r.a2));
}

// ── 錯誤基線 ──
const newPageErr = pageErrors.length - basePageErr, newConsole = consoleErrors.length - baseConsole;
ok('Z1 測試期間無新 pageerror', newPageErr === 0, `新增 ${newPageErr}(基線 ${basePageErr})`);
ok('Z2 測試期間無新 console error', newConsole === 0, `新增 ${newConsole}(基線 ${baseConsole}:多為 /api 404 等既有雜訊)`);

await browser.close();
await new Promise(r => server.close(r));

const failed = results.filter(r => !r.pass);
console.log(`\n${'═'.repeat(40)}\n總計 ${results.length} 項,PASS ${results.length - failed.length},FAIL ${failed.length}`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join('; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);

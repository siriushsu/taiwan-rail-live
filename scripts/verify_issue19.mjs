// issue #19 驗收：跟車面板的時間軸不得比地圖上的車落後一個誤點量。
//
// 判準刻意不與實作同源（心得 29）：不拿 nextStopInfo 去驗 journeyProgress（兩者同軸、必然自洽），
// 而是拿「地圖實際繪製的車輛座標」當外部真值——把面板宣稱的已行駛里程換算回路線上的一點，
// 量它與繪製點的實地距離；另一路用幾何投影把繪製點反算成里程，兩路互相對帳。
// 時間軸是唯一的自變數，里程/軌道幾何兩邊共用（那是量尺，不是待驗的假設）。
//
// 用法：node scripts/verify_issue19.mjs   ← 伺服器自己起，不必先開 dev_server
//       VURL=http://localhost:<PORT>/index.html node scripts/verify_issue19.mjs   ← 指向已在跑的 server
// 環境變數：DELAY_MIN 注入誤點（預設 7，對齊使用者影片的台鐵 2619）、OUT 落檔路徑、ENGINES 引擎清單
//
// 🔴 語系必須釘死 zh-TW（2026-09-08）。B1／B2／C* 讀的是「使用者眼睛看到的那行字」，
//    而 Playwright 的 chromium／webkit 預設 navigator.language=en-US ⇒ index.html 的 I18N_LANG
//    變成 en，狀態列成了「⏸ At Luye · departs in 29 sec」、下一站成了「Shanli」，五條判準同時
//    假紅、而且長得跟產品回歸一模一樣（實測 5 紅全出於此）。兩道一起下：
//      * 網址帶 ?lang=zh-TW —— index.html 自己的最高優先語系開關（query > localStorage >
//        navigator），top-level 就讀完，boot 途中 clearFollow() 清掉 query string 也影響不到它。
//      * context locale: 'zh-TW' —— 讓 navigator.language 與沒帶 locale 的 Intl／toLocaleString
//        也不隨跑測試的機器語系漂移。
//    刻意【不】改成「驗結構旗標不驗文案」：B1／B2／C* 守的就是那行字有沒有說謊。文案耦合的代價
//    由 G1 那道具名前置閘門承擔——語系釘不住時它直接指名，不會讓五條判準各報各的英文字串。
import { chromium, webkit } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 伺服器自己起（照 verify_afr.mjs 的做法），埠由 OS 指派。
// 舊版預設連 5288，而這台機器同時有 30+ 個並行 worktree 在跑 dev server——連到別人的埠就是
// 一聲不響地驗**別棵樹**（下面 G0 的 md5 閘門會擋下來，但那是「炸掉」不是「不會發生」）。
// ROOT 由本檔自身路徑推導，不吃呼叫端 cwd，結構上只可能服務自己這棵樹。
// VURL 仍可覆寫（指向已在跑的 server），但那條路要自己負責樹對不對，G0 一樣會跑。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(res => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
let child = null;
const URL = process.env.VURL || `http://localhost:${await freePort()}/index.html`;
if (!process.env.VURL) {
  const port = new global.URL(URL).port;
  child = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: port }, stdio: ['ignore', 'ignore', 'inherit'] });
  process.on('exit', () => child?.kill());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(1); });
  for (let i = 0; ; i++) {                       // 等它真的聽得到，不用固定秒數
    try { if ((await fetch(URL)).ok) break; } catch (e) {}
    if (i > 100) { console.error(`✗ dev server 起不來（${URL}）`); child?.kill(); process.exit(1); }
    await new Promise(r => setTimeout(r, 100));
  }
}
const PAGE_LOCALE = 'zh-TW';
// G0 的 md5 自檢仍打裸網址（dev_server 對靜態檔忽略 query，兩者同一份 bytes）；瀏覽器一律走這個。
const NAV_URL = (() => { const u = new global.URL(URL); u.searchParams.set('lang', PAGE_LOCALE); return u.toString(); })();
const DM = +(process.env.DELAY_MIN || 7), DS = DM * 60;
const ENGINES = (process.env.ENGINES || 'chromium').split(',').filter(Boolean);
const GAP_KM = 0.5;                 // 驗收門檻：面板里程換算回的點 vs 繪製點
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

// ── G0 自檢：確認 server 端的就是「當前工作區」那份 index.html。
// 這台機器同時有 20+ 個 worktree 在跑 server，驗到別人的檔案而全綠是真的發生過的事（心得 32）。
// 自起 server 的路徑結構上不可能錯，但 VURL 那條路會，所以這道閘門兩條路都跑。
const md5 = b => createHash('md5').update(b).digest('hex');
const diskHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const servedHash = md5(Buffer.from(await (await fetch(URL)).arrayBuffer()));
console.log(`G0 目標自檢：${URL}\n   工作區 ${ROOT}\n   disk=${diskHash} served=${servedHash}`);
if (diskHash !== servedHash) { console.log('  ✗ G0 服務中的檔案不是當前工作區——VURL 指到別棵樹了，拿掉它讓腳本自己起'); process.exit(1); }
console.log('  ✓ G0 驗的就是當前工作區');

// 在頁面內注入的量測工具：全部只依賴軌道幾何與繪製函式，不碰面板的時間軸。
const PROBE = `
// 面板宣稱的里程 → 路線上的一點（純單位換算，用與繪製同一套軌道幾何）
window.__posAtDone = function (tr, doneKm) {
  const s = tr.stops;
  let cum = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const k = tr._segKm[i];
    if (doneKm <= cum + k || i === s.length - 2) {
      const f = k > 0 ? Math.max(0, Math.min(1, (doneKm - cum) / k)) : 0;
      return s[i].segLn ? schedSegmentPos(s[i], f)
        : { lat: s[i].lat + (s[i + 1].lat - s[i].lat) * f, lon: s[i].lon + (s[i + 1].lon - s[i].lon) * f };
    }
    cum += k;
  }
  return null;
};
// 繪製點 → 里程（幾何投影，與任何時間軸無關）
window.__geoDone = function (tr, P) {
  const s = tr.stops;
  let cum = 0, best = null;
  for (let i = 0; i < s.length - 1; i++) {
    const seg = s[i], segKm = tr._segKm[i];
    let along, err;
    if (seg.segLn) {
      const pr = projectOntoShape(seg.segLn, P.lat, P.lon);
      const lo = Math.min(seg.dA, seg.dB), hi = Math.max(seg.dA, seg.dB);
      const dc = Math.max(lo, Math.min(hi, pr.d));
      along = Math.abs(dc - seg.dA);
      err = pr.perpKm + Math.abs(dc - pr.d);   // 垂距 + 被夾出segment 的量
    } else {
      const A = s[i], B = s[i + 1];
      const kx = Math.cos(P.lat * Math.PI / 180) * 111.32, ky = 111.32;
      const ax = (A.lon - P.lon) * kx, ay = (A.lat - P.lat) * ky;
      const bx = (B.lon - P.lon) * kx, by = (B.lat - P.lat) * ky;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0;
      along = t * Math.sqrt(L2);
      err = Math.hypot(ax + vx * t, ay + vy * t);
    }
    if (!best || err < best.err) best = { km: cum + along, err };
    cum += segKm;
  }
  return best;
};
// 一次 tick 內同時取「地圖實況」與「面板實況」，避免兩者取樣時刻錯開
window.__snap = function () {
  const tr = state.followTrain;
  if (!tr) return { err: 'no followTrain' };
  journeyProgress(tr, 0);                       // 暖 _segKm/_totalKm
  const simSec = state.simSec;
  const dl = liveDelaySec(tr), hold = blockHoldSec(tr);
  const P = trainPos(tr, simSec);               // 地圖實際繪製的座標（index.html:5297 同一支）
  const pr = journeyProgress(tr, effTLive(tr)); // 面板進度（index.html:12440 同一支）
  const info = nextStopInfo(tr, effTLive(tr));
  const dw = dwellInfoOf(tr, effTLive(tr));
  const segMap = trainSeg(tr, simSec - dl - hold);   // 地圖側的段別（純幾何/時間，未經面板）
  const pPanel = P ? window.__posAtDone(tr, pr.done) : null;
  const geo = P ? window.__geoDone(tr, P) : null;
  const pa = trainPos(tr, simSec), pb = trainPos(tr, simSec + 20);
  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / 20 * 3600, speedCapOf(tr)) : 0;
  const txt = id => { const e = document.getElementById(id); return e ? (e.textContent || '') : null; };
  return {
    train: String(tr.train), sys: tr.sys, simSec, dl, hold,
    P, kmh,
    donePanel: pr.done, total: pr.total,
    gapKm: (P && pPanel) ? haversineKm(P, pPanel) : null,      // 主判準
    geoKm: geo ? geo.km : null, geoErr: geo ? geo.err : null,  // 對帳用
    geoGapKm: (geo && pr) ? Math.abs(geo.km - pr.done) : null,
    mapDwell: segMap ? !!segMap.dwell : null,
    mapDwellName: (segMap && segMap.dwell) ? tr.stops[segMap.i].name : null,
    panelDwellName: dw ? dw.st.name : null,
    nextName: info ? info.name : null, nextMin: info ? info.min : null,
    dom: { next: txt('fpNext'), eta: txt('fpEta'), status: txt('fpStatus'),
           prog: txt('fpProgTxt'), spd: txt('fpSpd'),
           tcNext: txt('tcLiveNext'), tcSpd: txt('tcLiveSpd'), tcDelay: txt('tcLiveDelay') },
  };
};
`;

const out = { url: URL, diskHash, delayMin: DM, engines: {} };

for (const eng of ENGINES) {
  const launcher = eng === 'webkit' ? webkit : chromium;
  console.log(`\n===== ${eng} =====`);
  const br = await launcher.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: PAGE_LOCALE });
  const pg = await ctx.newPage();
  // 此驗收要有行進中的台鐵樣本；午夜不保證找得到。固定台灣當日正午起跑，
  // 時鐘仍自然推進，保留真實 rAF／計時器及四次行進取樣；模擬 API 同步使用這個時鐘。
  const scenarioDay = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' });
  await pg.clock.install({ time: new Date(scenarioDay + 'T12:00:00+08:00') });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));

  // 營運公告不屬於誤點時間軸情境；用有效的空公告避免上游連線影響這支驗收。
  await pg.route(/\/api\/(?:tra|thsr|metro)-alert(?:\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [] }),
  }));

  let mockNo = null;
  await pg.route('**/api/tra-live*', async route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date(await pg.evaluate(() => Date.now())).toISOString(), trains: mockNo ? [{ no: mockNo, delay: DM }] : [] }),
  }));
  await pg.addInitScript(PROBE);

  const boot = async () => {
    await pg.goto(NAV_URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
  };
  await boot();
  const scenarioSec = await pg.evaluate(() => nowSecOfDay());
  ck(scenarioSec >= 12 * 3600 && scenarioSec < 12 * 3600 + 120,
    `G2 候選列車使用白天情境，不受部署時間影響：${scenarioDay} ${scenarioSec}s`);

  // ── G1 具名語系閘門：B1／B2／C* 全部在讀畫面上那行中文，語系一漂它們會同時假紅而各報不同的
  //    英文字串，計分板上看不出共同上游。把前提抽出來單獨判一次，紅的時候一眼看得出是語系沒釘住。
  //    🔴 不可拿 location.search 當「網址有帶 ?lang」的證據——boot 途中 clearFollow() 會
  //    replaceState 把整條 query 抹掉，事後讀恆為空字串，閘門會因為產品的正常行為而恆紅。
  //    🔴 樣本要挑真的在訊息表裡的詞：t('跟隨系統') 在 zh-TW/en 都回中文（不在表內），拿它當
  //    樣本就是一條恆真判準。下面兩個樣本各守一條翻譯路徑，且都實測過在 en 之下會變值：
  //      stationName('松山') → 'Songshan'（B2 讀的站名走這條）
  //      t('即將進站') → 'Arriving soon'（C* 讀的遙測列文案走這條）
  const langState = await pg.evaluate(() => ({
    i18n: window.__i18n ? window.__i18n.lang : null,
    doc: document.documentElement.lang,
    nav: navigator.language,
    station: window.__i18n ? window.__i18n.stationName('松山') : null,
    arriving: window.__i18n ? window.__i18n.t('即將進站') : null,
  }));
  //    🔴 nav 這一條守的是【第二道釘子】(context locale)。上面四項全部由第一道釘子(網址 ?lang)
  //    決定——姊妹腳本 verify_font_scale 的 T0L 少了這一條,2026-09-08 突變實測「只把 context
  //    locale 改成 en-US、網址 ?lang 留 zh-TW」整條閘門照樣 PASS,而 detail 就印著 "nav":"en-US"。
  //    context locale 管的是 navigator.language 與沒帶 locale 參數的 Intl/toLocaleString(時刻、
  //    數字格式),它漂成跑測試那台機器的語系時,前四項一個都不會倒,閘門卻宣稱兩道釘子都在。
  ck(langState.i18n === PAGE_LOCALE && langState.doc === PAGE_LOCALE && langState.nav === PAGE_LOCALE &&
     langState.station === '松山' && langState.arriving === '即將進站',
    `G1 語系釘死在 zh-TW（B1／B2／C* 的文案判準前提）：${JSON.stringify(langState)}`);

  // ── 選車：台鐵、非環島、此刻在旅途中、且扣掉注入誤點後仍在旅途中（全程短於誤點量的車扣完會落在發車前）。
  // 另要求後段還有一個「停靠 ≥30 秒」的停站，供情境 B（車停在站上）使用。
  //
  // 🔴 排除「跨系統撞號」的車次：easedShift 的鍵是 'tra:'+車次、不含系統別，車次 1 同時存在於台鐵與
  // 林鐵時兩者共用同一個 entry，林鐵那班的 target=0 會把台鐵的誤點一路拖回去（實測 7 分 → 6 分且持續下滑）。
  // 那是 issue #19 以外、已知未修的另一條缺陷；拿它當樣本會讓本測的誤點量在量測途中漂移。
  const cand = await pg.evaluate(({ ds }) => {
    const now = nowSecOfDay(), out = [];
    const seen = new Map();                       // 車次 → 擁有它的 sched 系統集合
    for (const sy of state.systems.filter(x => x.mode === 'sched'))
      for (const t of ((sy.data && sy.data.trains) || [])) {
        const k = String(t.train);
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k).add(sy.id);
      }
    for (const tr of state.trains) {
      if (tr.loop || !tr.stops || tr.stops.length < 4) continue;
      if (tr.sys !== 'tra_sched') continue;
      const s = tr.stops, first = s[0], last = s[s.length - 1];
      if (s.length > 60) continue;                                  // 環島觀光班次（195 站）不當樣本
      if (/環島/.test(last.name) || first.name === last.name) continue;
      if ((seen.get(String(tr.train)) || new Set()).size > 1) continue; // 跨系統撞號 → easedShift 共鍵，誤點會漂
      const live = now - ds;
      if (!(first.depSec < now && now < last.arrSec - 600)) continue;      // 現在在跑，且離終點還有 10 分
      if (!(live > first.depSec + 300 && live < last.arrSec - 600)) continue; // 扣完誤點也還在跑
      // 地圖時間（now-ds）之後還有停靠 ≥30 秒的停站
      const dwells = s.map((st, i) => ({ i, name: st.name, arrSec: st.arrSec, depSec: st.depSec,
        total: st.depSec - st.arrSec, stop: st.stop }))
        .filter(d => d.stop !== false && d.total >= 30 && d.arrSec > live + 120 && d.arrSec < last.arrSec);
      if (!dwells.length) continue;
      out.push({ no: String(tr.train), name: tr.typeName, from: first.name, to: last.name,
        dwells: dwells.slice(0, 4), stops: s.length });
    }
    return out.slice(0, 5);
  }, { ds: DS });

  if (!cand.length) { console.log('  找不到候選車次（時段問題），中止'); await br.close(); process.exit(2); }
  const pick = cand[0];
  console.log(`  候選：${pick.no} ${pick.name} ${pick.from}→${pick.to}（${pick.stops} 站）`);

  // 重新載入，讓即時名單在「閘門開啟瞬間」就帶著誤點——easedShift 的 snap 路徑才會直接對齊，
  // 否則上升鉗制會讓誤點以 1 秒/秒 慢慢爬（位置恆不倒退的設計）。
  mockNo = pick.no;
  await boot();
  await pg.evaluate(async no => { await pollLive(); followTrainNo(no, { sys: 'tra_sched' }); }, pick.no);
  await pg.waitForFunction(() => state.followTrain && !document.getElementById('followPanel').hidden,
    null, { timeout: 15000 });
  await pg.waitForTimeout(1200);

  const dlNow = await pg.evaluate(() => liveDelaySec(state.followTrain));
  ck(dlNow > DS * 0.9, `注入誤點已套用：liveDelaySec=${(dlNow / 60).toFixed(2)} 分（目標 ${DM}）`);

  // ── 情境 A：行進中，量「面板里程 vs 繪製座標」
  const A = [];
  for (let k = 0; k < 4; k++) {
    const s = await pg.evaluate(() => window.__snap());
    if (s.P && !s.mapDwell) A.push(s);
    await pg.waitForTimeout(700);
  }
  // 自然取樣可能整段落在停靠窗內（區間車站距短、長停多），那樣 A1/A2 根本沒被執行到＝沒驗。
  // 取不到就把時鐘撥到某個跑段正中央，強制製造行進中的狀態（只往未來撥，維持 liveActive）。
  if (!A.length) {
    const ok = await pg.evaluate(async () => {
      const tr = state.followTrain, s = tr.stops;
      const mapNow = state.simSec - liveDelaySec(tr) - blockHoldSec(tr);
      for (let i = 0; i < s.length - 1; i++) {
        const run = s[i + 1].arrSec - s[i].depSec;
        if (run < 90 || s[i].depSec < mapNow + 30) continue;      // 取夠長、且還沒跑過的跑段
        const mid = s[i].depSec + run / 2;
        for (let k = 0; k < 5; k++) {
          setSimSec(mid + liveDelaySec(tr) + blockHoldSec(tr));
          await new Promise(r => setTimeout(r, 220));
          const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
          if (g && !g.dwell) return true;
        }
      }
      return false;
    });
    console.log(`    自然取樣全落在停靠窗 → 撥到跑段正中央重取（${ok ? '成功' : '失敗'}）`);
    for (let k = 0; k < 4 && ok; k++) {
      const s2 = await pg.evaluate(() => window.__snap());
      if (s2.P && !s2.mapDwell) A.push(s2);
      await pg.waitForTimeout(400);
    }
  }
  ck(A.length > 0, `情境 A 取得 ${A.length} 個行進中樣本`);
  for (const s of A) {
    const holdNote = s.hold > 0 ? `（阻擋 ${s.hold.toFixed(0)}s，issue #17 契約下面板本就不含 hold）` : '';
    console.log(`    t=${s.simSec} 誤點=${(s.dl / 60).toFixed(1)}分 時速=${s.kmh.toFixed(0)} ` +
      `面板=${s.donePanel.toFixed(2)}km 幾何=${s.geoKm == null ? '—' : s.geoKm.toFixed(2)}km ` +
      `落差=${s.gapKm == null ? '—' : s.gapKm.toFixed(2)}km ${holdNote}`);
  }
  // hold 是 issue #17 刻意的非對稱（只進 trainPos），把它折算回里程當容差，不讓它變成假紅
  const holdKm = s => (s.hold || 0) / 3600 * (s.kmh || 0);
  const worst = A.length ? A.reduce((m, s) => (s.gapKm - holdKm(s)) > (m.gapKm - holdKm(m)) ? s : m) : null;
  if (worst) {
    const eff = worst.gapKm - holdKm(worst);
    ck(eff < GAP_KM, `A1 面板里程換算回的點與繪製點落差 ${eff.toFixed(3)} km < ${GAP_KM}` +
      `（扣兩次的預期落差約 ${(worst.dl / 3600 * worst.kmh).toFixed(1)} km）`);
    // 幾何投影對帳：兩路量法必須說同一件事，否則是 harness 自己壞了
    const gv = A.filter(s => s.geoErr != null && s.geoErr < 0.3);
    if (gv.length) {
      const gw = gv.reduce((m, s) => s.geoGapKm > m.geoGapKm ? s : m);
      ck(gw.geoGapKm - holdKm(gw) < GAP_KM,
        `A2 幾何投影里程 vs 面板里程落差 ${(gw.geoGapKm - holdKm(gw)).toFixed(3)} km < ${GAP_KM}`);
    } else console.log('    （幾何投影垂距過大，該路對帳略過——不影響 A1）');
    // DOM 與計算值一致：證明量的是真的面板管線，不是我自己另算一份
    const domKm = worst.dom.prog ? +String(worst.dom.prog).split('/')[0].trim() : null;
    ck(domKm != null && Math.abs(domKm - worst.donePanel) <= 1.5,
      `A3 面板 DOM「${worst.dom.prog}」與計算值 ${worst.donePanel.toFixed(1)} km 一致（量到的是真面板）`);
  }

  // ── 情境 B：把時鐘撥到「地圖上的車正停在某站」的那一刻（＝使用者影片裡壞掉的畫面）。
  // 只往未來撥：liveActive 要求 simSec 不得落後現在 120 秒以上，往回撥會把誤點校正整個關掉。
  // 撥完鐘後動畫仍在推進、誤點量也可能微調，故用「撥→回讀→再撥」收斂到停靠窗正中央，
  // 而不是拿撥鐘當下的誤點值一次算死（前置不成立會讓 B1/B2 變成假紅，見心得 34）。
  const B = await pg.evaluate(async () => {
    const tr = state.followTrain, s = tr.stops;
    const mapNow = state.simSec - liveDelaySec(tr) - blockHoldSec(tr);
    // 優先取 ≥60 秒的停靠窗：時速讀數用 ±20 秒位移差算，窗太短會探到開車後、讀出非 0 的合法值
    const ahead = s.map((st, i) => ({ i, st })).filter(x => x.st.stop !== false &&
      (x.st.depSec - x.st.arrSec) >= 30 && x.st.arrSec > mapNow + 60);
    const d = ahead.find(x => (x.st.depSec - x.st.arrSec) >= 60) || ahead[0];
    if (!d) return { err: 'no dwell ahead' };
    const total = d.st.depSec - d.st.arrSec, mid = d.st.arrSec + total / 2;
    let ok = false;
    for (let k = 0; k < 5 && !ok; k++) {
      setSimSec(mid + liveDelaySec(tr) + blockHoldSec(tr)); // 讓地圖時間落在停靠窗正中央
      await new Promise(r => setTimeout(r, 220));
      const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
      ok = !!(g && g.dwell && s[g.i] === d.st);
    }
    return { targetName: d.st.name, idx: d.i, total, converged: ok,
      nextStopName: (s.slice(d.i + 1).find(x => x.stop !== false) || {}).name || null };
  });
  if (B.err) { console.log(`  情境 B 略過：${B.err}`); }
  else {
    await pg.waitForTimeout(900);
    const s = await pg.evaluate(() => window.__snap());
    console.log(`    撥到 ${B.targetName} 停靠窗中央（停 ${B.total}s）：` +
      `地圖停靠=${s.mapDwellName || '行進中'} 時速=${s.kmh.toFixed(0)} 狀態列「${s.dom.status}」下一站「${s.dom.next}」`);
    ck(s.mapDwell === true && s.mapDwellName === B.targetName,
      `B0 前置成立：地圖上的車確實停在 ${B.targetName}`);
    ck(/^⏸ 停靠 /.test(s.dom.status || '') && (s.dom.status || '').includes(B.targetName),
      `B1 狀態列為「⏸ 停靠 ${B.targetName}」而非「▶ 行進中」`);
    ck(s.dom.next === B.nextStopName,
      `B2 下一站為 ${B.nextStopName}（該站的下一站），實得「${s.dom.next}」`);
    if (B.total >= 60) ck(Math.round(s.kmh) === 0, `B3 時速讀數 0（與停靠一致），實得 ${s.kmh.toFixed(1)}`);
    else console.log(`    B3 略過：停靠窗僅 ${B.total}s，±20 秒時速探針必然探到開車後（實得 ${s.kmh.toFixed(1)} km/h）`);
    out.engines[eng] = { ...(out.engines[eng] || {}), B: s, Bplan: B };
  }


  // ── 情境 C：手機寬度下「列車」sheet 的遙測列（tcLiveNext）必須與跟隨小卡（fpNext）說同一件事。
  // 兩者同一 tick 寫入但落在不同 DOM，改動若只修好其一就會在這裡現形。
  const C = {};
  for (const w of [360, 375, 414]) {
    try {
      await pg.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
      await pg.waitForTimeout(300);
      await pg.setViewportSize({ width: w, height: 780 });
    } catch (e) { console.log(`    ${w}px：無法調整視窗（${String(e.message).split('\n')[0]}），略過`); continue; }
    await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => new Promise(res => {
      openTrainSheet();
      setTimeout(() => {
        const txt = id => { const e = document.getElementById(id); return e ? (e.textContent || '') : null; };
        const tr = state.followTrain, info = tr ? nextStopInfo(tr, effTLive(tr)) : null;
        res({ open: document.body.classList.contains('train-open'), fs: document.body.classList.contains('fs'),
          next: txt('fpNext'), tcNext: txt('tcLiveNext'), spd: txt('fpSpd'), tcSpd: txt('tcLiveSpd'),
          infoName: info ? info.name : null, infoMin: info ? Math.round(info.min) : null });
      }, 800);
    }));
    C[w] = r;
    if (!r.open) { console.log(`    ${w}px：「列車」sheet 未開（fs=${r.fs}），略過`); continue; }
    const expect = r.infoName == null ? '已抵達終點'
      : (r.infoMin < 1 ? `即將進站 · ${r.infoName}` : `${r.infoName} · ${r.infoMin} 分`);
    ck(r.tcNext === expect && (r.infoName == null || r.next === r.infoName),
      `C${w} 遙測列「${r.tcNext}」與小卡「${r.next}」一致（期望「${expect}」）`);
    ck(r.tcSpd === r.spd, `C${w} 時速兩處一致：小卡「${r.spd}」/ 遙測列「${r.tcSpd}」`);
  }
  try {
    await pg.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
    await pg.setViewportSize({ width: 1280, height: 800 });
  } catch (e) { /* 全螢幕鎖住視窗大小，還原失敗不影響已完成的量測 */ }

  out.engines[eng] = { ...(out.engines[eng] || {}), pick, dlNow, A, C };
  ck(errs.length === 0, `無 pageerror${errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''}`);
  await br.close();
}

if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.log(`\n${fail === 0 ? '✅ 全部通過' : `❌ ${fail} 項失敗`}`);
process.exit(fail === 0 ? 0 : 1);

// 跟隨面板速度曲線的「游標對位」驗收（缺陷⑥）。
//
// 缺陷：曲線的 x 軸是純表定軸（t 從 t0 走到 t1），但取樣時卻用 t - liveDelaySec(tr) 去問位置；
// 而 drawSpark 的游標吃的是 effTLive(tr)，effTLive 自己已經扣過一次誤點。於是誤點 D 的車，
// 游標指到的那一格代表的是「表定時刻 - 2D」的速度。曲線還會被永久快取在 tr._spdProf 上，
// 所以錯多少取決於它是在誤點多少的時候被建起來的。
//
// 判準（非同源）：曲線第 i 格的值，必須等於「純表定軸上 t_i 到 t_i+30s 之間的實際位移換算速度」，
// 上限 speedCapOf。位移由 trainPosAt 直接算，不經 speedProfile 自己。
//
// 用法：PORT=6400 ROOT=<受測樹> node scripts/verify_spark_cursor.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6400);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
// 單引擎一輪(整支是線性流程,不繞成迴圈);要雙引擎就跑兩次 ENGINE=chromium / ENGINE=webkit。
// macOS／iOS 使用者預設 WebKit,而 E 判準讀的是畫布像素——headless chromium 對「有沒有畫出來」
// 說過謊不只一次(心得 20/21),游標這一豎一定要在 WebKit 也真的量到。
const ENGINE = process.env.ENGINE || 'chromium';
const pw = req('playwright');

const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

const browser = await pw[ENGINE].launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.length),
  null, { timeout: 180000 });

const r = await page.evaluate(() => {
  const cand = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 5 && !t.loop).slice(0, 12);
  const out = { checked: 0, bad: [], drift: [], delaySeen: 0 };

  // ── 不變量：曲線是「表定旅程的函式」,同一班車在零誤點與大誤點下必須逐值相同。
  //    這條最強、也最不看實作細節：曲線只要還跟誤點有關,它就會紅。
  const noDelay = new Map();
  state.live = { map: new Map(), at: Date.now(), delayed: 0, srcAt: '' };
  _easedShift.clear();
  for (const tr of cand) { tr._spdProf = null; noDelay.set(tr, speedProfile(tr).v.slice()); }

  const DELAY_MIN = 10;
  state.live = { map: new Map(cand.map(t => [String(t.train), DELAY_MIN])), at: Date.now(), delayed: cand.length, srcAt: '' };
  _easedShift.clear();
  for (const tr of cand) {
    const key = (tr.sys || 'tra_sched') + ':' + tr.train;
    _easedShift.set(key, { cur: DELAY_MIN * 60, at: performance.now(), sim: state.simSec, ep: _traGateEp.ep }); // 直接把偏移設到穩態
    out.delaySeen = Math.max(out.delaySeen, liveDelaySec(tr));
    tr._spdProf = null;
    const v = speedProfile(tr).v;
    const base = noDelay.get(tr);
    for (let i = 0; i < v.length; i++)
      if (Math.abs(v[i] - base[i]) > 1e-9) { out.drift.push({ train: String(tr.train), i, delayed: Math.round(v[i]), clean: Math.round(base[i]) }); break; }
  }
  out.driftN = out.drift.length; out.drift = out.drift.slice(0, 8); // 先記真數再截斷:截斷後的 length 是假的（心得 31）

  // ── 絕對值：曲線每一格＝純表定軸同一時刻的 30 秒有限差分（oracle 不呼叫 speedProfile）
  for (const tr of cand) {
    const { v, t0, t1 } = speedProfile(tr);
    for (let i = 0; i < v.length; i += 7) {
      const t = t0 + (t1 - t0) * i / (v.length - 1);
      const a = trainPosAt(tr, t), b = trainPosAt(tr, Math.min(t + 30, t1));
      const want = a && b ? Math.min(haversineKm(a, b) / 30 * 3600, speedCapOf(tr)) : 0;
      out.checked++;
      if (Math.abs(v[i] - want) > 1e-6) out.bad.push({ train: String(tr.train), i, got: Math.round(v[i]), want: Math.round(want) });
    }
  }
  out.badN = out.bad.length; out.bad = out.bad.slice(0, 8); // 同上
  return out;
});

check(`[${ENGINE}] A 曲線與誤點無關：同一班車在零誤點與 10 分鐘誤點下逐值相同`,
  r.driftN === 0,
  r.driftN === 0 ? `${12} 班逐格比對全數相同`
    : `${r.driftN} 班的曲線隨誤點而變；例：${JSON.stringify(r.drift.slice(0, 3))}`);

check(`[${ENGINE}] B 曲線每一格＝純表定軸同一時刻的實際位移速度`,
  r.badN === 0,
  r.badN === 0 ? `比對 ${r.checked} 格全數相符` : `比對 ${r.checked} 格，${r.badN} 格不符；例：${JSON.stringify(r.bad.slice(0, 3))}`);

check(`[${ENGINE}] C 分母閘門：受測車真的帶著誤點（否則 A/B 在零誤點下恆綠）`,
  r.delaySeen > 60, `最大偏移 ${Math.round(r.delaySeen)} 秒`);

// ── 游標半場。A/B 只驗曲線；曲線對了不代表游標對——曲線的 x 軸是純表定軸，游標的引數必須是
//    effTLive（已扣誤點）。把三個呼叫端的 effTLive 換成 effT，A/B/C 三項全綠而游標實際偏掉
//    面板寬度的 8.55%（140 格差 12 格、同一時刻讀成 28 而非 63 km/h）。所以這裡兩層都驗：
//    D 攔真正的呼叫端看它傳什麼進來，E 直接讀畫布像素看那一豎畫在哪（心得 24：computed 值
//    不算數，浮動元件要像素證據）。
const cu = await page.evaluate(async () => {
  const out = { spy: [], err: '' };
  try {
    const hw = document.getElementById('howtoWrap'); if (hw) hw.remove(); // 首訪教學卡會蓋住面板
    state.playing = false;          // 凍住模擬時鐘，呼叫端傳的 t 才能與稍後讀的 effTLive 逐值比對
    // 🔴 撥鐘錨定 08:00 平日尖峰(2026-08-15):深夜實跑時「此刻在跑」的只剩跨午夜車,
    //   它們的 depSec 停在昨天的座標系,下面的裸比較一班都收不到 ⇒ D 分母為零假紅
    //   (實測 554/452/281 全數被濾掉——當下唯一在跑的車恰好就是這個過濾式收不到的那一類)。
    //   本支驗的是游標「軸」的對錯,不是深夜名冊;錨定到車多的時刻即可,判準本身不變。
    //   直接寫 simSec 必須同時 clockAtNow=false(撥時鐘必清 clockAtNow 契約,否則亂蓋完乘章)。
    state.simSec = 8 * 3600; state.clockAtNow = false;
    // 只挑「此刻真的在跑」的車：setFollow 對未發車的班會撥鐘（丁批次的跨午夜例外），會動 effTLive
    const running = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 5 && !t.loop
      && state.simSec > t.stops[0].depSec + 300 && state.simSec < t.stops[t.stops.length - 1].arrSec - 300);
    out.runningN = running.length;
    // 🔴 選車判準:E 要求正確/錯誤位置差 >2% 面板寬,而偏移固定 600 秒(DELAY_MIN=10)
    //   ⇒ 分得開的條件=旅程 (t1-t0) ≤ 600/0.03(取 3% 留餘裕)。盲取 running[0] 踩過
    //   長途車 600 秒只佔 1.27% 面板寬的紅。真的一班都不合格就退回 running[0],
    //   讓 E 的「分母不足」訊息如實亮出來,不硬湊門檻。
    const tr = running.find(t => { const p = speedProfile(t); return (p.t1 - p.t0) <= 600 / 0.03; })
      || running[0];
    if (!tr) return out;
    out.train = String(tr.train);
    const DELAY_MIN = 10, key = (tr.sys || 'tra_sched') + ':' + tr.train;
    state.live = { map: new Map([[String(tr.train), DELAY_MIN]]), at: Date.now(), delayed: 1, srcAt: '' };
    _easedShift.set(key, { cur: DELAY_MIN * 60, at: performance.now(), sim: state.simSec, ep: _traGateEp.ep });
    tr._spdProf = null;

    const orig = window.drawSpark;  // 頂層 function 宣告 ⇒ 掛在 window 上，未限定的呼叫會走這裡
    window.drawSpark = function (t2, t) { out.spy.push({ train: String(t2.train), t }); return orig.apply(this, arguments); };
    setFollow(tr);
    await new Promise(r => setTimeout(r, 400));   // 呼叫端有一個 setTimeout(...,0) 與每秒重畫
    window.drawSpark = orig;

    out.effTLive = effTLive(tr); out.effT = effT(tr); out.shift = liveDelaySec(tr);
    const { t0, t1 } = speedProfile(tr);
    out.wantFrac = (out.effTLive - t0) / (t1 - t0);
    out.wrongFrac = (out.effT - t0) / (t1 - t0);   // 用錯軸（effT）游標會落在這裡
    out.spyBad = out.spy.filter(s => Math.abs(s.t - out.effTLive) > 1).length;

    const el = document.getElementById('tcSpark');
    const cs = getComputedStyle(el);
    const rgb = (cs.getPropertyValue('--spark-cursor').trim() || '#d23c2a').replace('#', '').match(/../g).map(x => parseInt(x, 16));
    const img = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let best = -1, bestN = 0;
    for (let x = 0; x < el.width; x++) {          // 游標是一整豎，取同色像素最多的那一行
      let n = 0;
      for (let y = 2; y < el.height; y++) {
        const p = (y * el.width + x) * 4;
        if (img[p + 3] > 200 && Math.abs(img[p] - rgb[0]) < 24 && Math.abs(img[p + 1] - rgb[1]) < 24 && Math.abs(img[p + 2] - rgb[2]) < 24) n++;
      }
      if (n > bestN) { bestN = n; best = x; }
    }
    out.pxRun = bestN; out.canvasW = el.width;
    out.gotFrac = bestN >= 3 ? best / (el.width - 1) : null;   // 找不到夠長的豎線＝游標沒畫出來
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
});

check(`[${ENGINE}] D 游標的引數必須是「已扣誤點」的時間軸（真正的呼叫端傳什麼就驗什麼）`,
  !cu.err && cu.spy.length > 0 && cu.spyBad === 0 && Math.abs(cu.effT - cu.effTLive) > 60,
  cu.err ? `例外：${cu.err}`
    : cu.spy.length === 0 ? `分母為零：跟隨面板沒觸發任何一次重畫（在跑的車 ${cu.runningN} 班），D 無效`
      : Math.abs(cu.effT - cu.effTLive) <= 60 ? `分母不足：effT 與 effTLive 只差 ${Math.round(cu.effT - cu.effTLive)} 秒，兩軸分不開`
        : cu.spyBad === 0 ? `${cu.spy.length} 次重畫全數傳 effTLive（=${Math.round(cu.effTLive)}），與 effT（=${Math.round(cu.effT)}）差 ${Math.round(cu.shift)} 秒`
          : `${cu.spyBad}/${cu.spy.length} 次重畫傳的不是 effTLive；例：${JSON.stringify(cu.spy.slice(0, 3))}`);

check(`[${ENGINE}] E 游標像素真的畫在誤點後的位置（讀畫布，不是讀變數）`,
  cu.gotFrac != null && Math.abs(cu.gotFrac - cu.wantFrac) <= 0.01 && Math.abs(cu.wantFrac - cu.wrongFrac) > 0.02,
  cu.gotFrac == null ? `畫布上找不到游標豎線（最長同色 ${cu.pxRun} 像素），E 無效`
    : Math.abs(cu.wantFrac - cu.wrongFrac) <= 0.02 ? `分母不足：正確位置與錯誤位置只差 ${(Math.abs(cu.wantFrac - cu.wrongFrac) * 100).toFixed(2)}% 面板寬，分不開`
      : `游標在 ${(cu.gotFrac * 100).toFixed(2)}%，應在 ${(cu.wantFrac * 100).toFixed(2)}%（用錯軸會落在 ${(cu.wrongFrac * 100).toFixed(2)}%，差 ${(Math.abs(cu.wantFrac - cu.wrongFrac) * 100).toFixed(2)}% 面板寬）`);

await browser.close();
const bad = results.filter(x => !x.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);

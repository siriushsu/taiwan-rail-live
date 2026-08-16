// issue #17 驗收：後車不得在開放路段穿過前車。
//
// 判準的獨立性是這支腳本的重點（心得 29：判準與實作同源會集體失明）。所以：
//   * 順序判定**只吃 trainPos 吐出的經緯度**——兩車連線向量與行進向量的內積正負號，
//     完全不碰 trainSeg 的 d/dir 簿記，也不碰 _blockHold。
//   * 「這班車是不是被擋住了」用「畫面位置 vs 純表定位置有沒有差」判，不讀 hold 表。
//   * 「可以被超越」的條件用「被超越的那班離最近車站多遠」判，不讀 dwell 旗標。
//     這正是對外承諾的原話：月台待避（車停在側線上）可以被超越，開放路段不行。
//     ——第一版用「畫面速度<1km/h」當代理，量到才發現不對：剛駛離月台、還在 2.5km/h 爬行的車
//     被特快超過，離站中心只有 4m，那是不折不扣的月台待避，速度代理卻把它判成違規。
//   * 分組（哪條線、哪個方向）仍用 trainSeg——分組不是判準，判準是分組之後那些量。
//
// 誤點用釘死的 JSON 快照注入，不打線上 API：同一支腳本每分鐘結果不同的話，紅了也無從歸因
// （心得 34：紅有產品回歸／環境條件／判準過期三種互斥原因）。
//
// 跑法：先在受測樹起 static server，再
//   PORT=<port> ROOT=<受測樹> node scripts/verify_no_overtake.mjs
// （T2／T3 的基準預設讀 `fixtures/baseline_pre_block.json`，不必也不該靠環境變數帶；
//   要換基準才傳 T2_BASE_FILE／T3_BASE。）
// 可選：STEP=<秒，預設 2>  LIVE=<誤點快照 json，預設 fixtures/tra_live_fixture.json>
//       DELAY=none 關掉誤點注入（純表定模式）
//       BASE=1 只輸出 JSON 統計（給控制組比對用）
//
// `fixtures/baseline_pre_block.json` 是**耦合機制加入前**（`04a1c2a`）跑 BASE=1 的產物，
// T2/T3 拿它當基準。位置模型本身若之後改了（跑段曲線、線形、班表結構），這份基準會過期 →
// 症狀是 T2 的「不見的車次對」清單暴增。那時要做的是**對當時的 HEAD~1 重新產一份**，
// 不是把門檻調鬆（心得 34：紅有產品回歸／環境條件／判準過期三種原因，修法完全相反）。
//   git worktree add --detach <tmp> <改動前的 commit> && 起 server && BASE=1 … > baseline_pre_block.json

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire('/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 5361;
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const STEP = Number(process.env.STEP || 2);
const BASE_ONLY = process.env.BASE === '1';
const LIVE_FILE = process.env.LIVE || path.join(ROOT, 'scripts/fixtures/tra_live_fixture.json');
const USE_DELAY = process.env.DELAY !== 'none';

// 判準門檻。刻意都不是「幾個／幾 px」而是物理上有意義的分界，且各自都印出實測分布，
// 讓「餘裕有多大」看得見，而不是假設它很大。
const STILL_KMH = 1;        // 畫面速度低於此＝實質靜止（停站中的車位置完全不動，速度恆 0）
// 站區半徑。尺度取「一列車自己的長度」——城際 8~12 節 × 20m ≈ 160~240m：對調或停等發生在自己
// 車身範圍內，畫面上就還在月台邊，不是「停在隧道裡」。刻意不取「量到的最大值」當門檻（那會隨
// 資料漂移、且把缺陷寫進規格），實測分布會全部印出來，餘裕多大看得見。
const STATION_M = 200;
// 只在這個距離內判前後。用「兩車連線向量 · 行進向量」的正負號判順序，在彎道上弦與切線會分家，
// 距離越遠誤差越大——第一版取 3km 量到一堆假對調（例：車距 2.9km 卻報「對調」）。
// 真正的穿越必然經過 0m，所以窗開小不會漏：接近速差 55km/h ⇒ 每 2 秒才靠近 30m，
// 從 +250m 到 −250m 有三十幾個取樣點。
const PAIR_NEAR_KM = 0.25;
const DEADBAND_M = 25;      // 兩車幾乎重合時正負號本身就是噪音，不採計
const PROJ_MAX_KM = 1;      // 畫面 vs 純表定位置的前後投影同理，超過這個距離不判（弦≠切線）

const log = [];
const say = s => { if (!BASE_ONLY) console.log(s); log.push(s); };
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); say(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

// ── G0：確認伺服器吐的就是受測樹的檔（本機 20+ worktree 並行，port 撞到別人的樹會靜默驗錯目標）
const diskHash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const srvBuf = Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer());
const srvHash = crypto.createHash('md5').update(srvBuf).digest('hex');
if (!BASE_ONLY) {
  console.log(`G0 target=${ROOT}\n   disk=${diskHash}\n   serve=${srvHash}`);
}
if (diskHash !== srvHash) {
  console.log(`FAIL  G0 — 伺服器吐的 index.html 不是受測樹的檔，驗下去等於驗別人的樹`);
  process.exit(1);
}

const delays = {};
if (USE_DELAY) {
  const live = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  for (const t of live.trains || []) if (t.delay > 0) delays[String(t.no)] = t.delay;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(e.message));
// 🔴 只擋 tra-live(其餘走真網路):本腳本注入 state.live 假誤點,頁面自己的
//   setInterval(pollLive, 60e3) 會用真資料把注入值整顆洗掉——同族假紅的根因與擋法
//   照 verify_tra_motion(acbb7c3);pollLive 有 try/catch,abort 不會產生 pageerror。
await page.route('**/*tra-live*', r => r.abort());
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('typeof state !== "undefined" && state.trains && state.trains.length > 300', null, { timeout: 180000 });

const R = await page.evaluate(({ delays, STEP, STILL_KMH, STATION_M, PAIR_NEAR_KM, DEADBAND_M, PROJ_MAX_KM, useDelay }) => {
  const KMH = 3.6;
  const hav = (a, b) => {                       // km
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  // 平面近似（判方向正負號用，不需大圓精度）
  const vec = (a, b) => ({ x: (b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), y: b.lat - a.lat });

  if (useDelay) {
    state.live = { map: new Map(Object.entries(delays)), at: Date.now(), delayed: Object.keys(delays).length, srcAt: '' };
    // liveActive() 要求「模擬時鐘貼近現在」，但我們要掃一整天 → 把「現在」接到模擬時鐘上。
    // 這是替時間裝測試替身，不是改被測邏輯：liveDelaySec 本身一行沒動。
    nowSecOfDay = () => state.simSec;
  }
  state.playing = false;

  // 控制組（改動前的 HEAD）沒有這三個東西。補上等價的替身，讓同一套判準能對兩個版本各跑一次
  // ——控制組必須紅在 T1、綠在 T2/T6/T7，否則就是判準沒有牙（心得 35：突變測試＋控制組）。
  const hasBlock = typeof updateBlockHolds === 'function';
  // 舊版沒有「純表定軸」入口：它的 trainPos(tr,t) 自己就會扣掉誤點，所以等價的替身要先把誤點加回去，
  // 否則 raw 會被扣兩次誤點 → 憑空生出「畫面落後」，T4/T6/T7 全部假紅（第一版就是這樣，紅了 62800 次）。
  const posAt = typeof trainPosAt === 'function' ? trainPosAt : (tr, t) => trainPos(tr, t + liveDelaySec(tr));
  const holdOf = typeof blockHoldSec === 'function' ? blockHoldSec : () => 0;
  const bump = hasBlock ? updateBlockHolds : () => {};
  const segOf = typeof trainSeg === 'function' ? trainSeg : (tr, t) => {
    // 舊版沒有 trainSeg。分組與排序只需要「在哪條線形、里程多少、往哪走」，用停站里程線性內插
    // 就夠——判準（對調、離站距離、畫面速度）一律吃經緯度，不吃這裡的 d。
    if (tr.loop) t = tr.stops[0].arrSec + ((t - tr.stops[0].arrSec) % tr.loopSec + tr.loopSec) % tr.loopSec;
    const s = tr.stops, n = s.length;
    if (t < s[0].arrSec && t + 86400 <= s[n - 1].depSec) t += 86400;
    if (t < s[0].arrSec || t > s[n - 1].depSec) return null;
    for (let i = 0; i < n; i++) {
      if (t >= s[i].arrSec && t <= s[i].depSec) {
        const seg = s[i].segLn ? s[i] : (i > 0 && s[i - 1].segLn ? s[i - 1] : null);
        if (!seg) return { i, dwell: true, seg: null };
        return { i, dwell: true, seg, ln: seg.segLn, d: seg === s[i] ? seg.dA : seg.dB, dir: Math.sign(seg.dB - seg.dA) || 1 };
      }
      if (i < n - 1 && t > s[i].depSec && t < s[i + 1].arrSec) {
        const seg = s[i], span = s[i + 1].arrSec - s[i].depSec;
        const f = span > 0 ? (t - s[i].depSec) / span : 0;
        if (!seg.segLn) return { i, dwell: false, seg: null, f };
        return { i, dwell: false, seg, f, ln: seg.segLn, dir: Math.sign(seg.dB - seg.dA) || 1, d: seg.dA + (seg.dB - seg.dA) * f };
      }
    }
    return null;
  };

  const trains = state.trains.filter(t => t.sys === 'tra_sched');
  const prev = new Map();      // key → {pos, ln, dir, raw}
  const pairSign = new Map();  // "a|b" → 正負號
  const out = {
    steps: 0, liveOn: false, delayedApplied: 0,
    flipOpen: [], flipStill: 0,                  // 開放路段對調（違規） / 車站區被超越（合法待避）
    flipOpenCapped: 0, flipOpenReal: 0,          // 開放路段對調中：撞 hold 上限的（已宣告邊界）／不可歸因的（真違規）
    overcap: 0, overcapMax: 0, overcapHeld: 0, overcapHeldDiag: [],                   // 畫面速度超過車種極速的取樣數
    aheadOfRaw: 0, aheadMaxM: 0,                 // 畫面位置跑到純表定位置前面的次數（不該有）
    projAmbiguous: 0,                            // 弦幾乎垂直於航向（彎道），投影正負號無意義而不判的次數
    heldSamples: 0, heldStopped: 0, heldStoppedOpen: 0, frozeMaxSec: 0, frozeWorst: null,
    heldNoLeader: 0, heldOnsets: 0, heldLeaderVanished: 0, heldMaxM: 0,
    flipStillPairs: {}, flipOpenM: [], flipOpenLag: [], flipLeaderSpeeds: [], flipStationM: [], heldStopM: [],
    stopDiag: [], noLeadDiag: [], overcapAt: [], projSkipped: 0,
    capped: 0, everHeld: 0,
  };
  const nearStationM = rec => {                  // 畫面位置到該線最近車站的距離（m）。站點座標來自線資料，
    let n = 1e9;                                 // 與夾持簿記完全無關 → 這是獨立於實作的那一路判準。
    for (const st of (rec.ln.stations || [])) { const dm = hav(rec.shown, st) * 1000; if (dm < n) n = dm; }
    return n;
  };
  const heldSet = new Set(), froze = new Map();
  const CAP_SEC = typeof BLOCK_CAP_SEC !== 'undefined' ? BLOCK_CAP_SEC : 120;   // 已宣告的參數，不是內部狀態
  out.capSec = CAP_SEC;
  // 這台車的畫面位置，相當於把純表定軸往回撥了幾秒？不讀 hold 表，用純表定位置沿行進方向掃出來：
  // s 越大位置越後面，投影單調遞減，二分求零點。撞上限的車會逼近 CAP_SEC。
  const impliedLagSec = (rec, t) => {
    if (!rec.mv) return null;
    const mvn = Math.hypot(rec.mv.x, rec.mv.y); if (mvn < 1e-12) return null;
    const dl = liveDelaySec(rec.tr);
    const f = s => { const p = posAt(rec.tr, t - dl - s); if (!p) return null;
      const v = vec(rec.shown, p); return (v.x * rec.mv.x + v.y * rec.mv.y) / mvn; };
    let lo = 0, hi = CAP_SEC + 30;
    const fh = f(hi); if (fh == null || fh > 0) return null;
    for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2, fm = f(mid);
      if (fm == null) hi = mid; else if (fm >= 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };

  for (let t = 0; t < 86400; t += STEP) {
    state.simSec = t;
    bump();
    if (t === 43200) out.liveOn = liveActive(), out.delayedApplied = trains.filter(x => liveDelaySec(x) > 1).length;
    const cur = new Map(), groups = new Map();
    for (const tr of trains) {
      const g = segOf(tr, state.simSec - liveDelaySec(tr) - holdOf(tr));
      const shown = trainPos(tr, t);
      if (!shown || !g || !g.ln) { prev.delete(tr); continue; }
      const raw = posAt(tr, t - liveDelaySec(tr));
      const p = prev.get(tr);
      const rec = { tr, shown, raw, ln: g.ln, dir: g.dir, g };
      // 畫面速度（km/h）：只由畫出來的兩點差分，不碰模型內部
      rec.kmh = (p && p.ln === g.ln) ? hav(p.shown, shown) / STEP * 3600 : null;
      rec.mv = p ? vec(p.shown, shown) : null;
      // 「被擋住」＝畫面位置與純表定位置有差（不讀 hold 表）
      rec.lagM = raw ? hav(shown, raw) * 1000 : 0;
      cur.set(tr, rec);
      const k = g.ln.id + '|' + g.dir;
      let a = groups.get(k); if (!a) groups.set(k, a = []);
      a.push(rec);

      if (rec.kmh != null) {
        const cap = speedCapOf(tr);
        if (rec.kmh > cap + 1e-6) {
          out.overcap++; out.overcapMax = Math.max(out.overcapMax, rec.kmh);
          out.overcapAt.push(t + ':' + tr.train + ':' + rec.kmh.toFixed(0));
          // 這一格超標，是不是夾持造成的？夾持能做的只有「變慢」與「追回」。所以要比的是
          // 「同一台車在**畫面所在的那個時刻**，模型本身跑多快」——不是「模型此刻在別處跑多快」。
          // 撞上限的車畫面落後 120 秒＝落在 3.9km 外的另一段線形上，拿它此刻的速度來比是張冠李戴
          // （第一版就是這樣，把純粹的跑段交界跳變誤報成夾持瞬移）。
          const sHat = impliedLagSec(rec, t);
          const back = sHat == null ? null : posAt(tr, t - liveDelaySec(tr) - sHat - STEP);
          const modelKmh = back ? hav(back, shown) / STEP * 3600 : null;
          if (modelKmh != null && rec.kmh > modelKmh + 1) {
            out.overcapHeld++;
            if (out.overcapHeldDiag.length < 10) out.overcapHeldDiag.push({ t, me: tr.train, kmh: +rec.kmh.toFixed(1),
              modelKmh: +modelKmh.toFixed(1), cap, lagSec: +sHat.toFixed(1), lagM: Math.round(rec.lagM) });
          }
        }
      }
      // 「正在被擋」＝落後量還在變大。純粹「落後量在縮小」是解除之後的追回過程，
      // 那時前面本來就可能已經沒有車了（前車轉進下一條線形），不能算違規。
      rec.engaging = p ? rec.lagM > p.lagM + 0.5 : false;
      // 「開始被擋的那一刻」。T6 只能問這一刻——一旦擋成立，落後量會在解除後繼續變大（前車走了，
      // 後車還在追回、而且愈跑愈快，shown 與 raw 的距離自然拉開），拿持續期問「前面有沒有車」
      // 會把 21 台碰上限的車全部誤報成違規。
      rec.onset = p ? (p.lagM <= 1 && rec.lagM > 1) : false;
      if (rec.lagM > 1) {
        out.heldSamples++; heldSet.add(tr);
        out.heldMaxM = Math.max(out.heldMaxM, rec.lagM);
        // T4：畫面位置必須落在純表定位置的「後方」——沿行進方向的投影不得為正
        // 環島車的 trainSeg 會把時間映回本圈,落後夠多時 shown 會落在「上一圈」,前後投影沒有意義 → 排除。
        if (rec.mv && !tr.loop && rec.lagM > 5 && rec.lagM < PROJ_MAX_KM * 1000) {
          const toRaw = vec(shown, raw), mvn = Math.hypot(rec.mv.x, rec.mv.y);
          const chord = Math.hypot(toRaw.x, toRaw.y);
          if (mvn > 1e-9 && chord > 1e-12) {
            // 弦與航向的夾角餘弦。+1＝純表定位置在正前方（正常落後）；-1＝真的跑到前面去了。
            // 0 附近＝弦與航向垂直，投影的正負號沒有意義：PROJ_MAX_KM 那道 1 km 的閘門擋不住
            // 「距離夠近但軌道很彎」——宜蘭線髮夾彎在 60 秒（約 2.2 km）內轉了 130 度，
            // 落後 954 m 的車量到 cos=-0.011（夾角 90.6 度）＝只有 11 m 的假超前。
            // 所以判準改問「弦真的指向後方嗎」（偏離航線反向 60 度以內），不收捨入級的負值。
            const cos = (toRaw.x * rec.mv.x + toRaw.y * rec.mv.y) / (mvn * chord);
            if (cos < -0.5) {
              out.aheadOfRaw++;
              out.aheadMaxM = Math.max(out.aheadMaxM, -cos * rec.lagM);   // 真正的超前分量，不是總間距
            } else if (cos < 0) out.projAmbiguous++;
          }
        } else if (rec.lagM >= PROJ_MAX_KM * 1000 || (tr.loop && rec.lagM > 5)) out.projSkipped++;
      }
    }

    for (const arr of groups.values()) {
      arr.sort((x, y) => (y.g.d - x.g.d) * x.g.dir);  // 分組排序用簿記（只為了找鄰居與屏障，不是判準）
      for (let i = 0; i < arr.length; i++) {
        const A = arr[i], lead = arr[i - 1];
        // T6：正在被擋的車，前面必須真的有同線同向的鄰居（對向車不該擋得到任何人）
        // 前車也可能就在這一幀跑到線形盡頭而從分組消失（實測內灣線：擋人的那台在終點站 d≈0、
        // 下一格 trainSeg 就回 null）。夾持是上一幀決定的，所以上一幀有鄰居也算數。
        if (A.onset) {
          out.heldOnsets++;
          let had = !!lead, nearest = 1e9;
          if (!had) for (const [, r] of prev) {   // 退一步：上一幀同線同向、一個標準車距內有鄰居也算
            if (r.ln.id === A.ln.id && r.dir === A.dir && r.tr !== A.tr) nearest = Math.min(nearest, hav(r.shown, A.shown) * 1000);
          }
          if (!had && nearest <= 400) { had = true; out.heldLeaderVanished++; }
          if (!had) { out.heldNoLeader++; if (out.noLeadDiag.length < 12) out.noLeadDiag.push({ t, ln: A.ln.id, me: A.tr.train, lagM: Math.round(A.lagM), groupN: arr.length, nearestM: Math.round(nearest) }); }
        }
        // T7：正在被擋且畫面上停住的車，必須停在車站區裡——對外承諾的原話是「不要停在隧道裡」，
        // 停在月台邊等前車過去正是我們要的行為。（第一版判「前車也要幾乎停著」是錯的：
        // 西勢實測 3140 停在月台上等自強 110 通過，前車當然在跑，那不是缺陷。）
        if (A.engaging && A.kmh != null && A.kmh < STILL_KMH) {
          out.heldStopped++;
          const stM = nearStationM(A);
          out.heldStopM.push(Math.round(stM));
          if (stM > STATION_M) {
            out.heldStoppedOpen++;
            // 連續停住幾秒才是使用者看得到的東西：一兩格的凍結沒有人看得出來，停死一分鐘才是缺陷。
            const e = froze.get(A.tr);
            if (e && t - e.last <= STEP * 1.5) { e.last = t; e.sec += STEP; }
            else froze.set(A.tr, { last: t, sec: STEP, t0: t, ln: A.ln.id, stM: Math.round(stM),
              lead: lead ? lead.tr.train : null, leadKmh: lead && lead.kmh != null ? +lead.kmh.toFixed(1) : null });
            const ee = froze.get(A.tr);
            if (ee.sec > out.frozeMaxSec) { out.frozeMaxSec = ee.sec; out.frozeWorst = { me: A.tr.train, meType: A.tr.typeName, ...ee }; }
            if (out.stopDiag.length < 25) out.stopDiag.push({ t, ln: A.ln.id, me: A.tr.train, meType: A.tr.typeName,
              lagM: Math.round(A.lagM), stationM: Math.round(stM), contSec: ee.sec,
              lead: lead ? lead.tr.train : null, leadKmh: lead && lead.kmh != null ? +lead.kmh.toFixed(1) : null,
              gapM: lead ? Math.round(hav(A.shown, lead.shown) * 1000) : null });
          }
        }
      }
      // 順序對調：同組內所有「夠近」的配對都要看，不能只看陣列相鄰——第三班車插進中間時
      // 相鄰關係會斷掉，只追相鄰會漏掉真正的穿越。key 用車次排序後的正規形，兩車互換也還是同一把鑰匙。
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const A = arr[i], B = arr[j];
        const gapKm = hav(A.shown, B.shown);
        const key = (A.tr.train < B.tr.train ? A.tr.train + '|' + B.tr.train : B.tr.train + '|' + A.tr.train);
        if (gapKm > PAIR_NEAR_KM || gapKm * 1000 < DEADBAND_M) continue;
        const mv = (A.mv && Math.hypot(A.mv.x, A.mv.y) > 1e-9) ? A.mv
          : (B.mv && Math.hypot(B.mv.x, B.mv.y) > 1e-9) ? B.mv : null;   // 方向取有在動的那台
        if (!mv) continue;
        // 正負號必須綁在「車次小的那台」上，不能綁排序陣列的 A/B 角色——兩車對調時角色也跟著換，
        // 用角色當基準等於把要抓的那件事濾掉（第一版就是這樣：T1 零違規、T2 也零，全都沒觀測到）。
        const [P, Q] = A.tr.train < B.tr.train ? [A, B] : [B, A];
        const pq = vec(P.shown, Q.shown);    // 正=Q 在行進方向前方
        const sign = (pq.x * mv.x + pq.y * mv.y) >= 0 ? 1 : -1;
        const p = pairSign.get(key);
        // 連同「這一刻兩台各離最近車站多遠」一起記。穿越的瞬間兩車幾乎重合、會被 DEADBAND 跳過幾格，
        // 等正負號翻過來才記的話，被超越的那台早就駛離月台加速到 40km/h、離站 200m 了——量到的
        // 「離站距離」會系統性偏大，把月台待避誤判成開放路段超車。所以取「跨越前後兩格」的較小值。
        const stP = nearStationM(P), stQ = nearStationM(Q);
        pairSign.set(key, { sign, step: out.steps, stP, stQ });
        // 穿越的那一瞬間兩車幾乎重合、會落進 DEADBAND 而被跳過幾步，所以不能要求「上一步」，
        // 給 30 秒的容許窗；超過就當成重新觀測而不是對調。
        if (!p || (out.steps - p.step) * STEP > 30 || p.sign === sign) continue;
        const passed = p.sign === 1 ? Q : P;   // 原本在前方的那台＝被超越的
        const passer0 = passed === P ? Q : P;
        const passedKmh = passed.kmh == null ? 0 : passed.kmh;
        const near = Math.min(p.sign === 1 ? p.stQ : p.stP, p.sign === 1 ? stQ : stP);
        out.flipStationM.push(Math.round(near));
        if (near <= STATION_M) { out.flipStill++; out.flipStillPairs[passer0.tr.train + '|' + passed.tr.train] = 1; }
        else {
          // 已宣告的邊界：碰到 hold 上限的車鬆開後就攔不住了（設計 §3 明講，T8 另計數）。
          // 判「有沒有碰上限」不讀 _blockHold，而是重建它：畫面位置若與「往回撥滿上限秒數的
          // 純表定位置」重合，那台就是撐在上限上。用的全是公開的位置函式＋已宣告的常數。
          const passer = passer0;
          const lagSec = impliedLagSec(passer, t);
          // 容差 2 格：hold 每格最多動一個取樣步，而「畫面落後幾秒」本身也是由前後兩格的位移方向
          // 反推的、自帶一格誤差。真違規的落後量會落在 0~30s，離 120s 十萬八千里，容差不會讓它漏網。
          const atCap = lagSec != null && lagSec >= CAP_SEC - 2 * STEP;
          out.flipOpenLag.push(lagSec == null ? null : +lagSec.toFixed(1));
          out.flipLeaderSpeeds.push(+passedKmh.toFixed(1));
          out.flipOpenM.push(Math.round(near));
          if (atCap) out.flipOpenCapped++;
          else {
            out.flipOpenReal++;
            if (out.flipOpen.length < 40)
              out.flipOpen.push({ t, ln: A.ln.id, a: A.tr.train, at: A.tr.typeName, b: B.tr.train, bt: B.tr.typeName,
                passed: passed.tr.train, passer: passer.tr.train, passedKmh: +passedKmh.toFixed(1),
                  gapM: Math.round(gapKm * 1000), passedStationM: Math.round(near) });
          }
        }
      }
    }
    for (const [tr, rec] of cur) prev.set(tr, rec);
    out.steps++;
  }
  out.capped = state._block ? state._block.capped.size : (hasBlock ? -1 : 0);
  out.everHeld = heldSet.size;
  out.flipOpenN = out.flipOpen.length;
  out.flipOpen = out.flipOpen.filter(Boolean);
  return out;
}, { delays, STEP, STILL_KMH, STATION_M, PAIR_NEAR_KM, DEADBAND_M, PROJ_MAX_KM, useDelay: USE_DELAY });

if (BASE_ONLY) { console.log(JSON.stringify(R)); await browser.close(); process.exit(0); }

const q = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
console.log(`\n掃了 ${R.steps} 個時刻（每 ${STEP}s，共一整天）  誤點注入=${USE_DELAY ? '是' : '否'}  liveActive(正午)=${R.liveOn}  該刻套到誤點的車 ${R.delayedApplied} 班`);
console.log(`曾被擋過的車 ${R.everHeld} 班／被擋取樣 ${R.heldSamples}，畫面最大落後 ${Math.round(R.heldMaxM)} m，碰上限 ${R.capped} 班\n`);

check(`T1 開放路段不得對調順序（站區＝離最近車站 ≤${STATION_M}m；撞 ${R.capSec}s 上限是已宣告邊界，須另計）`,
  R.flipOpenReal === 0,
  `全部對調 ${R.flipStill + R.flipOpenCapped + R.flipOpenReal} 次：站區內 ${R.flipStill}（離站中位 ${q(R.flipStationM, .5)}m／p90 ${q(R.flipStationM, .9)}m）、` +
  `開放路段 ${R.flipOpenCapped + R.flipOpenReal}（離站 ${JSON.stringify(R.flipOpenM)}m、超車那台的畫面落後 ${JSON.stringify(R.flipOpenLag)}s／上限 ${R.capSec}s）；` +
  (R.flipOpenReal === 0
    ? `開放路段那些全部可歸因到 ${R.capSec}s 上限（${R.flipOpenCapped} 次），不可歸因 0 次`
    : `其中 ${R.flipOpenReal} 次不可歸因＝真違規；例：${JSON.stringify(R.flipOpen.slice(0, 3))}`));

// T2 的判準是「事件集合與改動前一致」，不是「次數大於零」——次數門檻抓不到「掉到剩 1 次」
// （突變測試 M7 實測：把月台待避整批擋掉後只剩 1 次，`>0` 照樣綠燈）。基準是改動前那一版
// 實際量到的「哪兩班車在月台上對調」的集合，存活率門檻取實測落差的中間值，不是手打的常數。
// 基準檔預設就指向釘死的那份，不靠呼叫端記得傳環境變數——漏傳的話 T2 退化成「>0 就算過」、
// T3 完全不對基準，兩條判準會靜默失去牙齒而且全綠（獨立驗收者指出的脆弱點）。
const BASE_FILE = process.env.T2_BASE_FILE || path.join(HERE, 'fixtures/baseline_pre_block.json');
const baseJson = fs.existsSync(BASE_FILE) ? JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) : null;
const t2base = baseJson ? Object.keys(baseJson.flipStillPairs || {}) : null;
const nowPairs = new Set(Object.keys(R.flipStillPairs));
const gone = t2base ? t2base.filter(k => !nowPairs.has(k)) : [];
const survive = t2base && t2base.length ? (t2base.length - gone.length) / t2base.length : null;
check('T2 表定待避仍成立（月台上的對調車次對，與改動前同一組）',
  t2base == null ? R.flipStill > 0 : survive >= 0.9,
  t2base == null
    ? `${R.flipStill} 次站區內對調、${nowPairs.size} 組車次對（未給 T2_BASE_FILE，只報數；控制組請對 HEAD~1 跑 BASE=1）`
    : `改動前 ${t2base.length} 組車次對，現在還在 ${t2base.length - gone.length} 組（${(survive * 100).toFixed(1)}%），` +
      `現在共 ${nowPairs.size} 組／${R.flipStill} 次` + (gone.length ? `；不見的：${JSON.stringify(gone.slice(0, 10))}` : '；一組都沒少'));

// T3 是「不得增加」而不是「必須為零」：跑段交界本來就有既有的位置跳變（另列 issue），
// 拿零當門檻只會量到那個舊缺陷。基準值預設從釘死的基準檔讀，不靠呼叫端傳環境變數。
const t3base = process.env.T3_BASE != null ? Number(process.env.T3_BASE)
  : (baseJson && baseJson.overcapMax != null ? Number(baseJson.overcapMax) : null); // 改動前的『最大超標速度』，非次數
check('T3 不瞬移（畫面速度超標不得由夾持造成）',
  R.overcapHeld === 0 && (t3base == null || R.overcapMax <= t3base + 1e-6),
  `超標取樣 ${R.overcap} 次、最大 ${R.overcapMax.toFixed(1)} km/h；其中「畫面比模型在同一時刻還快」的 ${R.overcapHeld} 次` +
  (R.overcapHeld ? `（例：${JSON.stringify(R.overcapHeldDiag.slice(0, 3))}）` : '（其餘全是既有的跑段交界跳變，另列 issue）') +
  (t3base == null ? '；未給 T3_BASE，最大值未對基準' : `；改動前最大 ${t3base} km/h`));

check('T4 不憑空前進（畫面位置恆不在純表定位置前方）',
  R.aheadOfRaw === 0,
  (R.aheadOfRaw === 0 ? '零次' : `${R.aheadOfRaw} 次，最大超前分量 ${Math.round(R.aheadMaxM)} m`) +
  `；彎道上弦垂直於航向而不判 ${R.projAmbiguous} 次，太遠／環島而不判 ${R.projSkipped} 次`);

check('T6 開始被擋的那一刻，前面一定有同線同向的鄰居',
  R.heldNoLeader === 0,
  `${R.heldOnsets} 次夾持成立（其中 ${R.heldLeaderVanished} 次前車在同一幀跑到線形盡頭而消失，改認上一幀 400m 內的鄰居），` + (R.heldNoLeader === 0 ? '零次「前面沒有車卻被擋」'
    : `其中 ${R.heldNoLeader} 次前面沒有車；例：${JSON.stringify(R.noLeadDiag.slice(0, 4))}`));

// 「停在隧道裡」是使用者看得出來的那種停：站區外連續凍結。停站時間本身就是這個尺度
// （表定停站 20~60 秒），拿它當上界＝「絕不能久到看起來像停靠」。單格凍結不算。
const FROZE_MAX_SEC = 20;
check(`T7 不停在隧道裡（站區 ${STATION_M}m 外連續停住不得超過 ${FROZE_MAX_SEC}s）`,
  R.frozeMaxSec <= FROZE_MAX_SEC,
  `被擋且畫面停住 ${R.heldStopped} 取樣，離站 中位 ${q(R.heldStopM, .5)}m／p90 ${q(R.heldStopM, .9)}m／最大 ${Math.max(0, ...R.heldStopM)}m；` +
  `站區外 ${R.heldStoppedOpen} 取樣、最長連續 ${R.frozeMaxSec}s` +
  (R.frozeMaxSec > FROZE_MAX_SEC ? `；最壞：${JSON.stringify(R.frozeWorst)}` : ''));

check('T8 上限觸發有計數（不得是隱藏截斷）',
  R.capped >= 0,
  `碰到 ${120}s 上限的車 ${R.capped} 班；這些是「時刻表要它超車但中間沒有站」的情形，屬已知邊界`);

check('無 runtime 錯誤', pageErrs.length === 0, pageErrs.length ? pageErrs.slice(0, 3).join(' | ') : '零 pageerror');

const fail = results.filter(r => !r.ok).length;
console.log(`\n合計 ${results.length - fail} PASS / ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);

// issue #17 第二顆：並排偏移的驗收。
//
// 偏移量**不從 _blockSideEase 讀**，而是從「畫出來的那顆」減「未偏移的投影點」：
//   off = state._trainHits[tr] − map.latLngToContainerPoint(trainPos(tr))
// _trainHits 是使用者點得到的那個點，也是 drawTag/drawDot 實際落筆的點。拿實作自己的簿記當判準，
// 就是心得 29 的「判準與實作同源 ⇒ 集體失明」。
//
// 法線方向的真值同理另尋來源：實作用「兩車的經緯度差」當切線，判準改用**線形自己的切線**
// （posAlongShape(ln, d±ε)）——兩條推導路徑不共用任何假設，內積為零才有意義。
//
// _blockSide 只用來**找場景**（哪個時刻哪兩班貼在一起），找到之後的每一個量都自己重算。
// 找場景不是判準；跟 verify_no_overtake 用 trainSeg 分組是同一個道理。
//
// 跑法：PORT=<改動後> [BPORT=<偏移加入前，驗位置零變化>] node scripts/verify_side_offset.mjs
//      可選 ROOT=<受測樹>  LIVE=<誤點快照>  DELAY=none

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire('/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium, webkit, devices } = require('playwright');

const PORT = process.env.PORT || 5361;
const BPORT = process.env.BPORT || '';
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const LIVE_FILE = process.env.LIVE || path.join(ROOT, 'scripts/fixtures/tra_live_fixture.json');
const USE_DELAY = process.env.DELAY !== 'none';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

// ── G0：伺服器吐的必須就是受測樹的檔（本機 20+ worktree 並行，port 撞到別人的樹＝靜默驗錯目標）
const diskHash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const srvHash = crypto.createHash('md5')
  .update(Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskHash}\n   serve=${srvHash}`);
if (diskHash !== srvHash) { console.log('FAIL  G0 — 伺服器吐的不是受測樹的檔'); process.exit(1); }
// B6 的基準樹也要自檢：它必須是「已經有耦合、還沒有並排偏移」的那一版。用內容判身分而不是
// 記住某個 hash——第一次跑就把 BPORT 指到耦合之前的樹，B6 於是拿耦合造成的位移當成偏移的鍋
// （6738 點中 1 點不同，數字小到看起來像雜訊）。判準對象錯了，數字再漂亮都是假的（心得 32）。
if (BPORT) {
  const bTxt = await (await fetch(`http://127.0.0.1:${BPORT}/index.html`)).text();
  const bHash = crypto.createHash('md5').update(Buffer.from(bTxt)).digest('hex');
  const hasBlock = bTxt.includes('function updateBlockHolds'), hasSide = bTxt.includes('function blockSideShift');
  console.log(`   base=${bHash}  耦合=${hasBlock ? '有' : '無'}  並排偏移=${hasSide ? '有' : '無'}`);
  if (!hasBlock || hasSide) {
    console.log(`FAIL  G0 — B6 的基準樹不對：要「有耦合、無並排偏移」的版本（port ${BPORT}）`); process.exit(1);
  }
}

const delays = {};
if (USE_DELAY) {
  const live = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  for (const t of live.trains || []) if (t.delay > 0) delays[String(t.no)] = t.delay;
}

// 頁面內共用的前置：注入釘死的誤點快照、停掉時鐘
const PRELUDE = `(d, useDelay) => {
  // 首訪教學卡(#howtoWrap, z800)蓋住整張地圖 ⇒ 不關掉的話任何地圖內觸控都打不到東西
  const hw = document.getElementById('howtoWrap'); if (hw) hw.hidden = true;
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  if (useDelay) {
    state.live = { map: new Map(Object.entries(d)), at: Date.now(), delayed: Object.keys(d).length, srcAt: '' };
    nowSecOfDay = () => state.simSec;         // liveActive() 要求模擬時鐘貼近現在：替時間裝測試替身
  }
  state.playing = false;
  // 誤點漸變層 easedShift 有狀態、而且吃真實時鐘（每次呼叫都往目標推進一點）。不釘死的話
  // liveDelaySec → trainSeg → dwell 會隨「這一輪跑多快」漂移：同一份程式碼連跑兩次，B16 一次
  // 30 筆兩筆站錯邊、一次 28 筆全對。判準若會隨執行速度變色，紅綠都不能當證據（心得 31 的親戚：
  // 比幾何之前要先把即時狀態旗標全部釘死，這裡釘的是「誤點推進到哪」）。
  if (typeof easedShift === 'function') easedShift = (k, target) => target;
  // 量測期間把 trainPos 對 (車, 時刻) 記憶化，模擬時鐘一動就整批作廢。
  // 為什麼要：誤點漸變層吃真實時鐘，同一個 (tr, t) 隔幾百毫秒問會給出不同的位置，
  // 於是「畫的時候」與「量的時候」差到 1.41px（x/y 各一個取整格）——實測 929 班結構上
  // 不可能有偏移的車也一樣量得到。這不是改被測邏輯：同一幀裡同一班車本來就只該有一個位置。
  const _tp = trainPos; let _memo = new WeakMap(), _memoAt = null;
  trainPos = (tr, t) => {
    if (_memoAt !== state.simSec) { _memo = new WeakMap(); _memoAt = state.simSec; }
    let m = _memo.get(tr); if (!m) _memo.set(tr, m = new Map());
    if (!m.has(t)) m.set(t, _tp(tr, t));
    return m.get(t);
  };
}`;

async function open(port, engine = chromium, ctxOpts) {
  const b = await engine.launch();
  const c = ctxOpts ? await b.newContext(ctxOpts) : await b.newContext();
  const page = await c.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined" && state.trains && state.trains.length > 300', null, { timeout: 180000 });
  await page.evaluate(`(${PRELUDE})(${JSON.stringify(delays)}, ${USE_DELAY})`);
  return { b, page, errs };
}

const A = await open(PORT);

// ── 主量測：找場景 → 逐場景重算偏移、法線、對稱性、命中、漸變
const M = await A.page.evaluate(() => {
  const keyOf = tr => (tr.sys || '') + ':' + tr.train;
  const settle = (n = 40) => { for (let k = 0; k < n; k++) draw(); };   // 漸變收斂到穩態
  const rawCp = tr => { const p = trainPos(tr, state.simSec); return p ? map.latLngToContainerPoint([p.lat, p.lon]) : null; };
  const drawnCp = tr => { for (const h of state._trainHits) if (h.tr === tr) return h; return null; };
  const offOf = tr => { const a = rawCp(tr), b = drawnCp(tr); return (a && b) ? { x: b.x - a.x, y: b.y - a.y } : null; };
  const mag = v => v ? Math.hypot(v.x, v.y) : 0;
  // 判準用的尺度＝「車號牌的對角線」：兩顆牌中心距離超過它，無論軌道是什麼角度都不可能相疊。
  // 這是畫布上量得到的幾何事實，與實作那條門檻（一對車的平均牌寬）是不同的量，不同源。
  const diagOf = tr => { ctx.font = '700 10px ' + FONT; return Math.hypot(ctx.measureText(String(tr.train)).width + 10, 15); };

  // 判準用的切線。獨立性到哪為止要講清楚：`posAlongShape` 是「軌道畫在哪」這個事實本身，
  // 兩邊共用它不構成同源；會出錯的是「這班車在哪條線、里程多少、往哪走」——那部分判準自己
  // 用 trainSeg 重算一次，而且取樣尺度刻意不同（判準 ±20m vs 實作 ±50m），
  // 實作若把 ln/d 取錯或跨過急彎，這裡就對不上。
  const shapeTangent = tr => {
    const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
    if (!g || !g.ln) return null;
    // 帶 g.dir ⇒ 切線朝「這班車實際前進的方向」。B2 只看垂直（絕對值），差 180° 照樣過；
    // B15 要比的是箭頭指哪邊，方向反了會整批量到約 180°（首次跑就是這樣，配對車與對照組同時 173°
    //  ⇒ 兩組都錯＝判準的參考方向錯，不是產品錯）。
    const a = posAlongShape(g.ln, g.d - 0.02 * g.dir), b = posAlongShape(g.ln, g.d + 0.02 * g.dir);
    if (!a || !b) return null;
    const cl = Math.cos(a.lat * Math.PI / 180);
    const x = (b.lon - a.lon) * cl, y = -(b.lat - a.lat), L = Math.hypot(x, y);
    return L > 1e-9 ? { x: x / L, y: y / L } : null;
  };

  // ── 找場景（定位用，不是判準）：掃一天取「有並排配對」的時刻，每個時刻挑一對
  const byKey = new Map();
  const scenes = [];
  for (let t = 0; t < 86400 && scenes.length < 45; t += 149) {
    state.simSec = t; updateBlockHolds();
    if (!_blockSide.size) continue;
    byKey.clear(); for (const tr of state.trains) byKey.set(keyOf(tr), tr);
    for (const [k, info] of _blockSide) {
      const me = byKey.get(k); if (!me || !info.other) continue;
      const p = trainPos(me, t), q = trainPos(info.other, t);
      if (!p || !q) continue;
      scenes.push({ t, a: me.train, b: info.other.train, lat: (p.lat + q.lat) / 2, lon: (p.lon + q.lon) / 2 });
      break;
    }
  }

  const out = { scenes: scenes.length, sym: [], norm: [], zoom: [], step: [], pick: [], follow: [], runs3: 0, dot: [], ctrl: [], coin: [], arrow: [], arrowCtrl: [], yield: [], yieldSkip: [], solo: [] };

  for (const sc of scenes) {
    state.simSec = sc.t; updateBlockHolds();
    byKey.clear(); for (const tr of state.trains) byKey.set(keyOf(tr), tr);
    const trA = state.trains.find(t => t.train === sc.a && t.sys === 'tra_sched');
    const trB = state.trains.find(t => t.train === sc.b && t.sys === 'tra_sched');
    if (!trA || !trB) continue;
    // 三台以上的「之」字形車列不做兩兩對稱檢查（會被誤判），但要計數不得靜默略過
    const run = new Set([keyOf(trA), keyOf(trB)]);
    for (const [k, info] of _blockSide) if (info.other === trA || info.other === trB) run.add(k);
    const pair2 = run.size === 2;
    if (!pair2) out.runs3++;

    // 縮放掃描：同一個時刻只改 zoom → 螢幕距離變、其他一切不變。
    // 這是「偏移只在標記會疊到時才出現」最乾淨的實驗旋鈕。
    for (const z of [16, 15, 14, 13, 12, 11, 10, 9]) {
      map.setView([sc.lat, sc.lon], z, { animate: false });
      settle();
      const oa = offOf(trA), ob = offOf(trB);
      const ca = rawCp(trA), cb = rawCp(trB);
      if (!ca || !cb) continue;
      const dpx = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      const diag = Math.max(diagOf(trA), diagOf(trB));
      out.zoom.push({ t: sc.t, z, dpx: +dpx.toFixed(1), diag: +diag.toFixed(1), r: +(dpx / diag).toFixed(3),
        m: +Math.max(mag(oa), mag(ob)).toFixed(2) });
      if (z <= 10) out.dot.push(+Math.max(mag(oa), mag(ob)).toFixed(3));   // 圓點模式必須恆零
      // 噪音底線的對照組：同一幀裡**沒有並排配對**的台鐵車，結構上偏移必為零，
      // 量到的任何非零都是量測噪音（latLngToContainerPoint 取整 × 誤點漸變層每次呼叫微動）。
      // 有了它，「≥一條對角線就不該偏」才判得出是真的偏了還是量測誤差——不必去猜一個門檻。
      let c = 0;
      for (const h of state._trainHits) {
        if (h.tr.sys !== 'tra_sched' || _blockSide.has(keyOf(h.tr))) continue;
        const a2 = rawCp(h.tr); if (a2) out.ctrl.push(+Math.hypot(h.x - a2.x, h.y - a2.y).toFixed(3));
        if (++c >= 4) break;
      }
    }

    // 以下都在「標記真的會疊到」的縮放下量
    map.setView([sc.lat, sc.lon], 14, { animate: false });
    settle();
    const oa = offOf(trA), ob = offOf(trB);
    if (!oa || !ob) continue;
    if (mag(oa) < 0.2 && mag(ob) < 0.2) continue;                          // 這一對在 z14 沒疊到，跳過

    // 對稱＝「兩台偏一樣多、而且偏向軌道的相反側」。刻意不寫成「向量和為零」——
    // 那隱含兩台的法線平行，在彎道上不成立（各自的法線本來就差幾度，實測到 5.7%）。
    // 「相反側」用內積為負表達，與軌道曲率無關。
    if (pair2) {
      // 分成兩種形狀分別記：恰好一台停站＝讓位,那一台整台退出線、另一台留在線上不動；
      // 其餘(都在跑、或兩台都停在同一站)沒有誰在讓誰,仍是各偏一半的對稱形。
      const sa = trainSeg(trA, state.simSec - liveDelaySec(trA) - blockHoldSec(trA));
      const sb = trainSeg(trB, state.simSec - liveDelaySec(trB) - blockHoldSec(trB));
      const one = sa && sb && (!!sa.dwell !== !!sb.dwell);
      if (one) {
        const [dw, run] = sa.dwell ? [oa, ob] : [ob, oa];
        out.solo.push({ t: sc.t, a: sc.a, b: sc.b,
          dwellM: +mag(dw).toFixed(2), runM: +mag(run).toFixed(2) });
      } else out.sym.push({ t: sc.t, a: sc.a, b: sc.b,
        m: +((mag(oa) + mag(ob)) / 2).toFixed(2),
        dpx: +Math.abs(mag(oa) - mag(ob)).toFixed(2),
        dmag: +(Math.abs(mag(oa) - mag(ob)) / Math.max(mag(oa), mag(ob), 1e-9)).toFixed(4),
        cos: +((oa.x * ob.x + oa.y * ob.y) / Math.max(mag(oa) * mag(ob), 1e-9)).toFixed(4) });
    }

    // 法線：偏移向量與「線形切線」垂直 ⇒ 單位內積為零
    for (const [tr, o] of [[trA, oa], [trB, ob]]) {
      const tg = shapeTangent(tr); const m = mag(o);
      if (!tg || m < 1) continue;
      out.norm.push({ t: sc.t, tr: tr.train, m: +m.toFixed(2),
        dot: +Math.abs((o.x / m) * tg.x + (o.y / m) * tg.y).toFixed(4) });
    }

    // 完全重合：兩班車停在同一站時經緯度一模一樣。這是兩顆標記百分之百合體、最需要並排的一刻，
    // 也是最容易靜默失效的一刻（任何「兩車連線方向」的算法在這裡長度都是 0）。
    {
      const pa = trainPos(trA, state.simSec), pb = trainPos(trB, state.simSec);
      if (pa && pb) {
        const dM = Math.hypot((pb.lon - pa.lon) * Math.cos(pa.lat * Math.PI / 180), pb.lat - pa.lat) * 111000;
        if (dM < 1) {
          // 偏移後兩顆牌的矩形還相不相交（就是「看起來是不是兩班車」這件事本身）
          const ha = drawnCp(trA), hb = drawnCp(trB);
          const rect = (h, tr) => ({ x0: h.x - tagW(tr) / 2, x1: h.x + tagW(tr) / 2, y0: h.y - 7.5, y1: h.y + 7.5 });
          let ov = null;
          if (ha && hb) { const r1 = rect(ha, trA), r2 = rect(hb, trB);
            ov = Math.max(0, Math.min(r1.x1, r2.x1) - Math.max(r1.x0, r2.x0)) *
                 Math.max(0, Math.min(r1.y1, r2.y1) - Math.max(r1.y0, r2.y0)); }
          out.coin.push({ t: sc.t, a: sc.a, b: sc.b, dM: +dM.toFixed(2),
            ma: +mag(oa).toFixed(2), mb: +mag(ob).toFixed(2), ov: ov == null ? null : +ov.toFixed(1) });
        }
      }
    }

    // 讓位的那班固定靠行進方向的右邊；兩台一列時經過的那班留在線上不動——使用者回報「同一台車被兩班自強超越，
    // 兩次閃的邊不一樣」。根因是號誌的相位綁在沿線順序上，待避時後車超過前車、順序一翻就整組對調。
    // 判準用自己算的右法線（切線轉 90°；螢幕 y 向下 ⇒ (−ty, tx) 指向行進方向的右手邊），
    // 不讀 `_blockSide` 的 s（那是實作自己的簿記）。
    {
      const segOf = tr => trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
      const ga = segOf(trA), gb = segOf(trB);
      if (ga && gb && !!ga.dwell !== !!gb.dwell) {              // 一方停站一方在跑＝這就是「讓位」
        // 「讓位的那班」只有在**附近恰好一班停著**時才指得出來。實測 7:27 的 107 與 4107：
        // 兩班先後停在同一個月台（里程都是 35.675），這一刻誰在讓誰無法定義，兩班也不可能
        // 都靠右（會疊在一起）。這種取樣要排除，但要把排除了幾筆講出來，免得判準悄悄變空。
        // 「附近」要照**串**算不是照半徑算：A—B—C 每段各 0.4km 以內就串成一列，C 離 A 可以 0.8km。
        // 先用半徑寫，於是漏掉 0.5km 外那台也停著的車，這一筆照樣被當成「只有一班在停」判紅。
        const near = state.trains.map(tr => ({ tr, g: segOf(tr) }))
          .filter(x => x.g && x.g.ln === ga.ln && x.g.dir === ga.dir)
          .sort((x, y) => (y.g.d - x.g.d) * ga.dir);
        let nd = 0;
        for (let i = 0; i < near.length;) {
          let j = i + 1;
          while (j < near.length && (near[j - 1].g.d - near[j].g.d) * near[j].g.dir <= 0.4) j++;
          if (near.slice(i, j).some(x => x.tr === trA)) nd = near.slice(i, j).filter(x => x.g.dwell).length;
          i = j;
        }
        // 零偏移的那班**也要記**：非對稱畫法下「經過的那班留在線上」正是要驗的事，
        // 沿用舊的「m < 1 就跳過」會把整個經過側悄悄丟光（實測經過側 0 筆卻照樣綠）。
        for (const [tr, o, g] of [[trA, oa, ga], [trB, ob, gb]]) {
          const tg = shapeTangent(tr), m = mag(o);
          if (!tg) continue;
          if (nd !== 1) { out.yieldSkip.push({ t: sc.t, tr: tr.train, nd }); continue; }
          out.yield.push({ t: sc.t, tr: tr.train, dwell: !!g.dwell, pair2, m: +m.toFixed(2),
            proj: m < 1 ? null : +((o.x * -tg.y + o.y * tg.x) / m).toFixed(3) });
        }
      }
    }

    // 箭頭：橫向偏移是平移，不是前進，不得被算進「往哪走」。兩條判準各走一條路——
    // B14 是恆等式（同一時刻把配對整個拿掉重量一次，角度必須一模一樣），沒有任何門檻可調；
    // B15 拿線形切線當外部真值，門檻取自同一幀沒配對的車（它們結構上沒有偏移，量到的偏差
    //     就是「八秒弦線 vs 切線 ＋ dirAngOf 平滑」的固有底線，不必手打一個度數）。
    {
      const angOf = tr => { delete tr._dirAng; draw(); return tr._dirAng; };  // 清掉再畫一幀＝拿到未平滑的當幀角度
      const devOf = tr => {
        const tg = shapeTangent(tr), a = tr._dirAng;
        if (!tg || a === undefined) return null;
        let d = a - Math.atan2(tg.y, tg.x);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return +(Math.abs(d) * 180 / Math.PI).toFixed(2);
      };
      const ctrlTr = [];
      for (const h of state._trainHits) {
        if (h.tr.sys !== 'tra_sched' || _blockSide.has(keyOf(h.tr))) continue;
        ctrlTr.push(h.tr); if (ctrlTr.length >= 6) break;   // 先抓名單：draw() 會重建 _trainHits
      }
      const withOff = [];
      for (const tr of [trA, trB]) withOff.push({ tr, a: angOf(tr), m: mag(offOf(tr)), dev: devOf(tr) });
      for (const tr of ctrlTr) { angOf(tr); const d = devOf(tr); if (d != null) out.arrowCtrl.push(d); }
      const keepSide = new Map(_blockSide);
      _blockSide.clear(); _blockSideEase.clear();          // 偏移歸零（updateBlockHolds 才會重建，draw 不會）
      for (const w of withOff) {
        const a0 = angOf(w.tr);
        if (w.a === undefined || a0 === undefined) continue;
        let d = w.a - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        out.arrow.push({ t: sc.t, tr: w.tr.train, m: +w.m.toFixed(2), dev: w.dev,
          ddeg: +(Math.abs(d) * 180 / Math.PI).toFixed(3) });
      }
      for (const [k, v] of keepSide) _blockSide.set(k, v);
      _blockSideEase.clear(); settle();
    }

    // 命中：點畫出來的那顆，選到的必須是它自己（心得 33：驗按鈕不是驗它在哪，是驗點它會發生什麼）
    // 失手時不許只記「失手」就算數：同一個場景、同一個縮放，把 _blockSide 清空(＝偏移不存在)
    // 重畫再點一次當**對照組**。對照組也點不到 ⇒ 那個重疊本來就在(常見是反向車、跨線車,
    // 它們根本不在配對群組裡),與這套機制無關；對照組點得到 ⇒ 才是偏移害的。
    for (const tr of [trA, trB]) {
      const h = drawnCp(tr); if (!h) continue;
      const got = trainAt({ x: h.x, y: h.y });
      const ok = !!got && got.tr === tr;
      let ctrl = null;
      if (!ok) {
        const keep = new Map(_blockSide);
        _blockSide.clear(); _blockSideEase.clear(); settle();
        const h0 = drawnCp(tr), g0 = h0 ? trainAt({ x: h0.x, y: h0.y }) : null;
        ctrl = { hit: g0 ? g0.tr.train : null, ok: !!g0 && g0.tr === tr };
        for (const [k, v] of keep) _blockSide.set(k, v);
        _blockSideEase.clear(); settle();
      }
      out.pick.push({ t: sc.t, tr: tr.train, hit: got ? got.tr.train : null, ok, ctrl });
    }

    // 漸變：從零起步不得一幀到位（清掉緩動狀態，逐幀記錄偏移量）
    _blockSideEase.clear();
    const seq = [];
    for (let k = 0; k < 12; k++) { draw(); seq.push(+mag(offOf(trA)).toFixed(2)); }
    const full = mag(oa);
    out.step.push({ t: sc.t, tr: sc.a, full: +full.toFixed(2), f1: seq[0], f3: seq[2],
      maxStep: +Math.max(...seq.map((v, i) => i ? v - seq[i - 1] : v)).toFixed(2) });

    // 跟隨中的主角是鏡頭錨點：不得被偏移
    settle();
    const keep = state.followTrain; state.followTrain = trA;
    settle(6);
    out.follow.push({ t: sc.t, tr: sc.a, m: +mag(offOf(trA)).toFixed(3) });
    state.followTrain = keep; settle(6);
  }
  out.scene0 = scenes[0] || null;   // 給 B11 當「確定有並排」的落點
  return out;
});

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const q = (arr, p) => arr.length ? arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

// B1 對稱：偏一樣多 ＋ 偏向相反側。
// 「一樣多」用**畫面上差幾個 px**表達，不用百分比：兩台各自沿自己所在位置的法線偏，
// 彎道上兩條法線本來就差幾度，位移量跟著差一點點（實測最大 3.6%＝0.14px，肉眼不存在）。
// 百分比會把「小位移的微小差異」放大成假紅；一個像素則是這件事真正的視覺單位。
const symBad = M.sym.filter(s => s.dpx > 1 || s.cos > -0.9);
check('B1 沒有誰在讓誰時（都在跑／兩台都停同站）各偏一半：偏移量相等、且偏向軌道的相反側',
  M.sym.length > 0 && symBad.length === 0,
  `${M.sym.length} 對，兩台偏移量差距 p90 ${q(M.sym.map(s => s.dpx), 0.9)}px、` +
  `最大 ${Math.max(0, ...M.sym.map(s => s.dpx))}px（＝${(100 * Math.max(0, ...M.sym.map(s => s.dmag))).toFixed(1)}%）；` +
  `方向內積最大（越接近 −1 越是正對面）` +
  `${Math.max(-1, ...M.sym.map(s => s.cos))}；偏移量中位 ${q(M.sym.map(s => s.m), 0.5)}px` +
  `${M.runs3 ? `；另有 ${M.runs3} 組三台以上的車列（之字形，不做兩兩對稱檢查）` : ''}` +
  (symBad.length ? `；不對稱 ${symBad.length} 對，例：${JSON.stringify(symBad.slice(0, 3))}` : ''));

// B1b 讓位時是非對稱的：讓的那班整台退出軌道線，過的那班**留在線上完全不動**（2026-07-29 使用者裁示）。
// ⚠ 這裡刻意**不**寫「位移大到足以讓兩顆牌完全分開」的幾何式判準——寫過，在真程式碼上就紅 22/75。
// 原因是實作的淡出權重 `w=(near−距離)/near` 按**總距離**打折，但只有「橫越軌道」那個分量才真的
// 幫忙分開牌；同線兩台車的距離幾乎都是**沿著軌道**的，於是折扣白付、深疊時仍留約 1px 的細縫。
// 那是對稱版就有的既有精度問題（總分離量兩版相同），與這次改動無關，不在這次範圍內。
// 「分離量被砍半」這種壞法由 B1b 的下限＋B16 的投影一起接（突變 N22 實測會紅）。
// 「過的那班不動」寫成 0px 而不是「比較小」——它是這個設計的重點：在主線上跑的那班,
// 它的標記位置就是它真正的位置,一個像素都不該被推走。0px 量得到（螢幕座標取整,噪音底線就是 0）。
const soloBad = M.solo.filter(s => s.runM > 0 || s.dwellM < 1);
check('B1b 讓位時：讓的那班整台退出軌道線、過的那班留在線上零位移',
  M.solo.length > 0 && soloBad.length === 0,
  `${M.solo.length} 對「恰好一台停站」，讓位側位移中位 ${q(M.solo.map(s => s.dwellM), 0.5)}px、` +
  `最小 ${Math.min(...M.solo.map(s => s.dwellM))}px；經過側位移最大 ${Math.max(0, ...M.solo.map(s => s.runM))}px` +
  (soloBad.length ? `；不合 ${soloBad.length} 對，例：${JSON.stringify(soloBad.slice(0, 3))}` : ''));

// B2 法線：與線形切線的單位內積
const normBad = M.norm.filter(n => n.dot > 0.08);
check('B2 偏移沿軌道法線（與線形切線垂直，切線取自 posAlongShape 不是兩車連線）',
  M.norm.length > 0 && normBad.length === 0,
  `${M.norm.length} 筆，|cos| 中位 ${q(M.norm.map(n => n.dot), 0.5)}、p90 ${q(M.norm.map(n => n.dot), 0.9)}、最大 ${Math.max(0, ...M.norm.map(n => n.dot))}` +
  (normBad.length ? `；超標 ${normBad.length} 筆，例：${JSON.stringify(normBad.slice(0, 3))}` : ''));

// B3 只在標記會疊到時才偏，且越疊越偏。
// 自變數是「兩顆標記的螢幕距離 ÷ 車號牌對角線」，不是縮放層級——第一版誤把縮放當代理，
// 結果撞到「兩班車就停在同一點（端站接續）」，拉到 z16 螢幕距離仍是 0，判準自己紅了。
// 縮放只是把同一對車推過各種螢幕距離的旋鈕，不是判準本身。
// 用對角線而不是寬度：中心距離超過對角線，兩顆牌無論軌道角度都不可能相疊 ⇒ 這時還偏就是無謂地動車。
const tag = M.zoom.filter(r => r.z >= 11);          // 圓點模式另有 B7
const apart = tag.filter(r => r.r >= 1), lap = tag.filter(r => r.r < 1);
const apartMax = Math.max(0, ...apart.map(r => r.m));
const bucket = f => { const s = lap.filter(r => r.r >= f - 0.25 && r.r < f); return s.length ? q(s.map(r => r.m), 0.5) : null; };
const b = [0.25, 0.5, 0.75, 1].map(bucket);
const mono = b.filter(v => v != null);
const noise = Math.max(0, ...M.ctrl);   // 對照組量到的噪音底線（結構上不可能有偏移的車）
check('B3 兩顆牌不可能相疊時就不偏、疊得越深偏得越多（自變數＝螢幕距離 ÷ 車號牌對角線）',
  apart.length > 0 && lap.length > 0 && M.ctrl.length > 100 && apartMax <= noise &&
  mono.length >= 2 && mono.every((v, i) => i === 0 || v <= mono[i - 1]),
  `距離≥一條對角線 ${apart.length} 筆偏移最大 ${apartMax}px（對照組：${M.ctrl.length} 筆結構上不可能偏移的車，` +
  `量測噪音底線 ${noise}px ← 螢幕座標取整）；可能相疊的 ${lap.length} 筆，` +
  `依疊入深度（距離/對角線 0–.25/.25–.5/.5–.75/.75–1）偏移中位 ${b.map(v => v == null ? '—' : v).join(' → ')}px`);

// B7 遠景圓點模式恆零
const dotMax = Math.max(0, ...M.dot);
check('B7 遠景圓點模式（z≤10）不偏——那個縮放下 9px 是好幾公里',
  M.dot.length > 0 && dotMax === 0, `${M.dot.length} 筆取樣，最大 ${dotMax}px`);

// B4 漸變：從零到滿不得在一幀內完成
const jumpy = M.step.filter(s => s.full > 1 && (s.f1 > s.full * 0.5 || s.maxStep > s.full * 0.5));
check('B4 進出偏移是漸變不是跳（第一幀不得超過整段的一半）',
  M.step.length > 0 && jumpy.length === 0,
  `${M.step.length} 筆，第一幀佔比中位 ${(100 * q(M.step.filter(s => s.full > 1).map(s => s.f1 / s.full), 0.5)).toFixed(0)}%、` +
  `三幀後 ${(100 * q(M.step.filter(s => s.full > 1).map(s => s.f3 / s.full), 0.5)).toFixed(0)}%` +
  (jumpy.length ? `；一幀到位 ${jumpy.length} 筆，例：${JSON.stringify(jumpy.slice(0, 3))}` : ''));

// B5 命中：點畫出來的位置選到的是它自己
const missPick = M.pick.filter(p => !p.ok);
const pickByOff = missPick.filter(p => !p.ctrl || p.ctrl.ok);     // 關掉偏移就點得到 ⇒ 偏移害的
const pickPre = missPick.filter(p => p.ctrl && !p.ctrl.ok);       // 關掉也點不到 ⇒ 既有重疊
check('B5 點偏移後的標記選到的是它自己；失手的必須在「關掉偏移」的對照組也一樣失手',
  M.pick.length > 0 && pickByOff.length === 0,
  `${M.pick.length} 次點擊，命中率 ${pct(M.pick.length - missPick.length, M.pick.length)}` +
  (pickPre.length ? `；${pickPre.length} 次失手在對照組(關掉偏移)也一樣失手＝既有重疊，` +
    `例：${JSON.stringify(pickPre.slice(0, 2))}` : '') +
  (pickByOff.length ? `；偏移造成 ${pickByOff.length} 次，例：${JSON.stringify(pickByOff.slice(0, 3))}` : ''));

// B8 跟隨中的主角不偏
const fBad = M.follow.filter(f => f.m > 0.05);
check('B8 跟隨中的主角是鏡頭錨點，不得被偏移',
  M.follow.length > 0 && fBad.length === 0,
  `${M.follow.length} 筆，最大 ${Math.max(0, ...M.follow.map(f => f.m))}px`);

// B12 兩車位置完全重合（同站待避）時仍要並排——這一條是看實際畫面才發現的：
// 數字判準全綠的那一版，兩班停在同一站的車仍然畫在同一個像素上。
// 非對稱畫法下「兩台各自都要有位移」不再成立（經過的那班本來就該是 0）——
// 要驗的是**這一對有沒有被分開**，所以看兩者位移的總和而不是各自的最小值。
const coinBad = M.coin.filter(c => c.ma + c.mb < 1);
check('B12 兩班車位置完全重合（同站）時仍然要並排，不得靜默合體',
  M.coin.length > 0 && coinBad.length === 0,
  `${M.coin.length} 對完全重合（相距 <1m），兩台偏移量總和的中位 ` +
  `${q(M.coin.map(c => c.ma + c.mb), 0.5)}px` +
  (coinBad.length ? `；仍合體 ${coinBad.length} 對，例：${JSON.stringify(coinBad.slice(0, 3))}` : ''));

// B13 偏移之後兩顆牌不可以還疊在一起——這條是「看實際畫面」得到的：位移量若寫成固定 px，
// 只夠讓開牌高（15px）；軌道垂直時法線是水平的，要讓開的是牌寬（32px），兩顆牌照樣疊著。
const lapBad = M.coin.filter(c => c.ov == null || c.ov > 0);
check('B13 並排之後兩顆車號牌不得再相疊（矩形交集為零）',
  M.coin.length > 0 && lapBad.length === 0,
  `${M.coin.length} 對完全重合的車，偏移後矩形交集面積最大 ${Math.max(0, ...M.coin.map(c => c.ov || 0))}px²` +
  (lapBad.length ? `；仍相疊 ${lapBad.length} 對，例：${JSON.stringify(lapBad.slice(0, 3))}` : ''));

// B16 讓位的那班固定靠右。判準寫「誰在哪一側」而不是「有沒有換邊」——後者要靠時間序列才問得出來，
// 而「恆在右側」比「不換邊」強：它同時排除了「一路都在錯邊」與「中途換邊」兩種壞法。
// 兩台一列時是非對稱的（讓位那班獨自退到右邊、經過那班零位移）；三台以上還在線上的那幾台
// 會互相疊，仍是左右交替——兩種形狀分開驗，而且都要有樣本，不能哪一邊悄悄變空。
const yieldSolo = M.yield.filter(y => y.pair2), yieldMulti = M.yield.filter(y => !y.pair2);
const yBad = [
  ...yieldSolo.filter(y => y.dwell ? !(y.proj > 0) : y.m !== 0),
  ...yieldMulti.filter(y => y.proj == null || (y.dwell ? y.proj <= 0 : y.proj >= 0)),
];
check('B16 讓位的那班（停站中）固定在行進方向的右側；兩台一列時經過的那班留在線上零位移',
  yieldSolo.some(y => y.dwell) && yieldSolo.some(y => !y.dwell) && yBad.length === 0,
  `${M.yield.length} 筆（兩台一列 ${yieldSolo.length}：讓位 ${yieldSolo.filter(y => y.dwell).length}／` +
  `經過 ${yieldSolo.filter(y => !y.dwell).length}；三台以上 ${yieldMulti.length}），` +
  `讓位側投影最小 ${Math.min(1, ...yieldSolo.filter(y => y.dwell).map(y => y.proj))}、` +
  `經過側位移最大 ${Math.max(0, ...yieldSolo.filter(y => !y.dwell).map(y => y.m))}px` +
  `；另排除 ${M.yieldSkip.length} 筆「附近不只一班停著、指不出誰在讓」的取樣` +
  (M.yieldSkip.length ? `（例：${JSON.stringify(M.yieldSkip.slice(0, 3))}）` : '') +
  `；取樣時刻 ${[...new Set(M.yield.map(y => y.t))].length} 個` +
  (yBad.length ? `；站錯邊 ${yBad.length} 筆，例：${JSON.stringify(yBad.slice(0, 3))}` : ''));

// B14 恆等式：偏移是純橫向平移，方向是「現在減八秒前」——兩頭一起平移，差向量不變。
// 只偏其中一頭（原本的寫法）等於把橫向位移當成前進量算進去，箭頭會轉去指偏移的方向。
// 非對稱畫法讓「經過的那班」偏移恆為 0——它進得來這份取樣，但對這條恆等式**沒有牙**
// （拿掉一個等於 0 的東西當然不會轉）。所以要求真的有位移的樣本存在，否則判紅。
const arrMoved = M.arrow.filter(a => a.ddeg > 0.01);
// 實測（40 筆取樣）：停站中的車一台都不畫方向箭頭（0/26），而非對稱畫法下有位移的幾乎都是
// 停站那班 ⇒ 這條恆等式真正測得到的是「兩台都在跑」的對稱場景。樣本會少但不會沒有；
// 真的歸零時上面那個閘門會判紅，而不是留一句「10 筆」看起來很飽滿其實全在對 0 做實驗。
const arrLive = M.arrow.filter(a => a.m > 1);
check('B14 並排偏移不得轉動箭頭：同一時刻拿掉偏移重量，角度必須一模一樣',
  arrLive.length > 0 && arrMoved.length === 0,
  `${M.arrow.length} 筆（其中真的有位移的 ${arrLive.length} 筆，位移中位 ${q(arrLive.map(a => a.m), 0.5)}px），` +
  `最大角度差 ${Math.max(0, ...M.arrow.map(a => a.ddeg))}°` +
  (arrLive.length ? '' : '；沒有任何有位移的樣本＝這條判準這一輪沒測到東西') +
  (arrMoved.length ? `；轉動 ${arrMoved.length} 筆，例：${JSON.stringify(arrMoved.slice(0, 3))}` : ''));

// B15 外部真值：箭頭要指著鐵軌。門檻不手打，取同一幀沒配對的車當對照組——
// 它們結構上沒有偏移，量到的偏差就是「八秒弦線 vs 切線 ＋ 平滑」的固有底線。
const acMax = M.arrowCtrl.length ? Math.max(...M.arrowCtrl) : null;
const arrOff = acMax == null ? [] : M.arrow.filter(a => a.dev != null && a.dev > acMax);
check('B15 箭頭指的是鐵軌的方向（真值取線形切線，門檻取自同幀未配對車的對照組）',
  M.arrow.filter(a => a.m > 1 && a.dev != null).length > 0 && M.arrowCtrl.length > 0 && arrOff.length === 0,
  `配對車 ${M.arrow.filter(a => a.dev != null).length} 筆最大偏差 ` +
  `${Math.max(0, ...M.arrow.map(a => a.dev || 0))}°、中位 ${q(M.arrow.filter(a => a.dev != null).map(a => a.dev), 0.5)}°；` +
  `對照組 ${M.arrowCtrl.length} 筆最大 ${acMax}°、中位 ${q(M.arrowCtrl, 0.5)}°` +
  (arrOff.length ? `；超出 ${arrOff.length} 筆，例：${JSON.stringify(arrOff.slice(0, 3))}` : ''));

check('B9 無 runtime 錯誤', A.errs.length === 0, A.errs.length ? A.errs[0] : '零 pageerror');

// ── B11 時鐘真的在跑的時候（上面全部是固定時刻的靜態場景——只驗乾淨初始狀態＝沒驗，心得 28）。
// 動起來之後配對每幀都在換，真正的風險是「偏移在相鄰兩幀之間整段翻面」＝畫面閃爍。
await A.page.evaluate(() => {
  window.__rec = []; const _draw = draw;
  draw = () => {
    _draw();
    const f = {};
    for (const h of state._trainHits) {
      const k = (h.tr.sys || '') + ':' + h.tr.train;
      if (!_blockSide.has(k)) continue;
      const p = trainPos(h.tr, state.simSec); if (!p) continue;
      const c = map.latLngToContainerPoint([p.lat, p.lon]);
      f[k] = [h.x - c.x, h.y - c.y];
    }
    window.__rec.push(f);
  };
  state.speedMult = 30; state.playing = true;
}, null);
await A.page.evaluate(s => { map.setView([s.lat, s.lon], 12, { animate: false }); state.simSec = s.t; }, M.scene0);
await A.page.waitForTimeout(9000);
const MO = await A.page.evaluate(() => {
  state.playing = false;
  const rec = window.__rec, jumps = [], amps = [];
  for (let i = 1; i < rec.length; i++) for (const k in rec[i]) {
    const a = rec[i][k], b = rec[i - 1][k];
    amps.push(Math.hypot(a[0], a[1]));
    if (b) jumps.push(+Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(2));
  }
  // 上界＝「標記自己的半徑＋縫」：位移不得超過標記自身尺寸，這是幾何事實不是手打的門檻
  let wmax = 0; for (const f of rec) for (const k in f) { const tr = state.trains.find(t => (t.sys || '') + ':' + t.train === k);
    if (tr) wmax = Math.max(wmax, tagW(tr)); }
  // 非對稱畫法下讓位那班獨自扛整段分離量(倍率 2),上界跟著從「半個牌寬」變成「整個牌寬」。
  // 仍是從實際量到的 tagW 推出來的幾何事實,不是手打的門檻。
  return { frames: rec.length, n: jumps.length, maxJump: Math.max(0, ...jumps), amp: +(wmax + BLOCK_SIDE_GAP).toFixed(2),
    maxAmp: +Math.max(0, ...amps).toFixed(2), p99: jumps.sort((x, y) => x - y)[Math.floor(jumps.length * 0.99)] || 0 };
});
check('B11 時鐘在跑時偏移不閃爍（相鄰兩幀不得整段翻面）',
  MO.frames > 60 && MO.n > 0 && MO.maxAmp <= MO.amp && MO.maxJump < MO.maxAmp,
  `連續 ${MO.frames} 幀（30× 快轉）共 ${MO.n} 筆逐幀比較：偏移量最大 ${MO.maxAmp}px（上界＝整個牌寬＋縫 ${MO.amp}px），` +
  `幀間變化 p99 ${MO.p99}px、最大 ${MO.maxJump}px（整段翻面會是 ${(2 * MO.maxAmp).toFixed(1)}px）`);

// ── B17 一整段待避的時間序列。使用者看到的是「同一台車被兩班自強超越，兩次閃的邊不一樣」——
// 那是**換邊**，只有沿著時間走才問得出來（B16 是 45 個獨立時刻的快照，照不到換邊）。
// 判準自帶「有沒有真的踩到」的閘門：區間內必須真的發生超越（沿線前後關係換號），
// 沒換號就代表這條判準根本沒測到它要測的東西，直接判 FAIL 而不是靜靜地綠。
const OV = await A.page.evaluate(() => {
  const keyOf = tr => (tr.sys || '') + ':' + tr.train;
  const settle = (n = 30) => { for (let k = 0; k < n; k++) draw(); };
  const segOf = tr => trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
  const tangent = tr => {
    const g = segOf(tr); if (!g || !g.ln) return null;
    const a = posAlongShape(g.ln, g.d - 0.02 * g.dir), b = posAlongShape(g.ln, g.d + 0.02 * g.dir);
    if (!a || !b) return null;
    const cl = Math.cos(a.lat * Math.PI / 180);
    const x = (b.lon - a.lon) * cl, y = -(b.lat - a.lat), L = Math.hypot(x, y);
    return L > 1e-9 ? { x: x / L, y: y / L } : null;
  };
  // 找場景要找「真的會超越」的那一種，不是「有停站車配對」就好——第一版只找後者，
  // 挑到兩班停在同一站的（潮州 3138/198），整段沒換號，判準等於沒踩到 bug（它自己講出來了）。
  const cands = [];
  for (let t = 0; t < 86400 && cands.length < 60; t += 47) {
    state.simSec = t; updateBlockHolds();
    if (!_blockSide.size) continue;
    const byKey = new Map(); for (const tr of state.trains) byKey.set(keyOf(tr), tr);
    for (const [k, info] of _blockSide) {
      const m0 = byKey.get(k); if (!m0 || !info.other) continue;
      const gm = segOf(m0), go = segOf(info.other);
      if (!gm || !go || !gm.dwell || go.dwell) continue;          // me 在讓、other 在跑
      const p = trainPos(m0, t); if (!p) continue;
      cands.push({ t, me: m0, other: info.other, lat: p.lat, lon: p.lon });
      break;
    }
  }
  // 便宜的預掃（不畫圖）：兩種場景各要一個
  //   overtake＝區間內沿線前後關係真的換號（測「停站錨」那條規則）
  //   depart  ＝停站在區間內真的結束、而且結束後還配著（測「相位黏著」那條規則——
  //             停站錨一消失，相位就得有人接手，不然讓完的瞬間會換邊）
  const scan = (c, from, to) => {
    const orders = new Set(); let sawDwell = false, sawRun = false;
    for (let dt = from; dt <= to; dt += 6) {
      state.simSec = c.t + dt; updateBlockHolds();
      if (!_blockSide.has(keyOf(c.me))) continue;
      const gm = segOf(c.me), go = segOf(c.other); if (!gm || !go) continue;
      // 只收非零的號：兩班停在同一站時里程差恰好是 0，把 Math.sign 的 0 也算成一種「號」
      // 會讓 {0, 1} 通過「有兩種」的閘門 ⇒ 挑到根本沒發生超越的場景（第一版就是這樣過關的）
      const s = Math.sign((go.d - gm.d) * gm.dir); if (s) orders.add(s);
      if (gm.dwell) sawDwell = true; else if (sawDwell) sawRun = true;
    }
    return { overtook: orders.has(1) && orders.has(-1), departed: sawDwell && sawRun };
  };
  const walk = (hit, from, to) => {
    // 鏡頭對準**這個窗的中段**而不是候選時刻：窗長 300 秒，沿用舊中心會讓車跑出畫面，
    // _trainHits 找不到它，整段一列都收不到（看起來像「沒踩到」，其實是鏡頭沒跟上）。
    const mid = trainPos(hit.me, hit.t + (from + to) / 2) || hit;
    map.setView([mid.lat, mid.lon], 13, { animate: false });
    const me = hit.me, other = hit.other, rows = [];
    for (let dt = from; dt <= to; dt += 3) {                      // 逐 3 秒走過整段
      state.simSec = hit.t + dt; updateBlockHolds(); settle(dt === from ? 40 : 8);
      const info = _blockSide.get(keyOf(me));
      if (!info) continue;                                        // me 還在並排的時候才有側別可言
      const gPartner = segOf(info.other);
      if (!gPartner || gPartner.dwell) continue;                  // 現在的鄰居也在停＝不是待避，規則不適用
      const gm = segOf(me), go = segOf(other), tg = tangent(me);
      const p = trainPos(me, state.simSec); if (!gm || !go || !tg || !p) continue;
      const c = map.latLngToContainerPoint([p.lat, p.lon]);
      const h = state._trainHits.find(x => x.tr === me); if (!h) continue;
      const ox = h.x - c.x, oy = h.y - c.y, m = Math.hypot(ox, oy);
      rows.push({ dt, dwell: !!gm.dwell, m: +m.toFixed(2),
        partner: info.other.train, pDwell: !!gPartner.dwell,      // 角色有沒有換人，要看這兩個
        order: Math.sign((go.d - gm.d) * gm.dir),                 // +1＝對方在前，−1＝對方在後
        proj: m < 1 ? null : +((ox * -tg.y + oy * tg.x) / m).toFixed(3) });
    }
    const orders = new Set(rows.filter(r => r.m >= 1).map(r => r.order));
    return { ok: true, me: me.train, other: other.train, t: hit.t, rows,
      overtook: orders.has(1) && orders.has(-1),
      departed: rows.some(r => r.dwell && r.m >= 1) && rows.some(r => !r.dwell && r.m >= 1) };
  };
  let ov = null;
  for (const c of cands) {
    if (scan(c, -150, 150).overtook) { const r = walk(c, -150, 150); if (r.overtook) { ov = r; break; } }
  }
  return {
    ov: ov || { ok: false, why: `${cands.length} 個待避候選裡沒有一個在 ±150 秒內真的發生超越` },
  };
});
const hhmm = t => `${Math.floor(t / 3600)}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}`;
const seqOf = R => (R.rows || []).filter(r => r.proj != null);
const badOf = R => (R.rows || []).filter(r => r.dwell && r.proj != null && r.proj <= 0);
// 「換邊」只算**情境沒變卻換了邊**。情境用「錨是誰」描述——錨＝唯一那台停站中的車；
// 兩台都停（或都沒停）就沒有誰在讓誰，錨＝無。換邊唯一合法的理由是「換了一個新的錨」（角色真的對調）。
// 這個定義是試出來的，兩次都被真資料修正：
//   ・只要「停站狀態變了就算合法」⇒ 把「讓完、大家都在跑」那一刻排除掉，而那正是黏著唯一在管的一刻
//     ⇒ 拿掉黏著的突變(N18)完全照不到（全綠）。
//   ・只要「我在停站就算有錨」⇒ 兩台都停在同一站（實測 107 與 3151 同為 20.841）也算，
//     於是「對方開走、剩我在讓」被誤判成閃爍。
const anchorOf = r => r.dwell === r.pDwell ? 'none' : (r.dwell ? 'me' : 'you');
const flipOf = R => { const s = seqOf(R); return s.filter((r, i) => i && Math.sign(r.proj) !== Math.sign(s[i - 1].proj)
  && r.partner === s[i - 1].partner && r.dt - s[i - 1].dt === 3
  && !(anchorOf(r) !== 'none' && anchorOf(r) !== anchorOf(s[i - 1]))); };
const say = (R, gate, win) => R.ok
  ? `${R.me} 讓 ${R.other}（${hhmm(R.t)} 起 ${win}），${seqOf(R).length} 個取樣點有偏移；${gate}；` +
    `讓位側投影最小 ${Math.min(1, ...(R.rows || []).filter(r => r.dwell && r.proj != null).map(r => r.proj))}；` +
    `全程換邊 ${flipOf(R).length} 次` +
    (badOf(R).length ? `；站錯邊 ${badOf(R).length} 筆，例：${JSON.stringify(badOf(R).slice(0, 4))}` : '') +
    (flipOf(R).length ? `；換邊於 dt=${flipOf(R).map(r => r.dt).slice(0, 6).join(',')}` : '')
  : R.why;

const OVv = OV.ov;
check('B17 一整段待避走完（逐 3 秒），讓位那班全程待在同一側——且區間內真的發生過超越',
  !!OVv.ok && OVv.overtook && seqOf(OVv).length > 0 && badOf(OVv).length === 0 && flipOf(OVv).length === 0,
  say(OVv, OVv.overtook ? '沿線前後關係有換號（超越確實發生）' : '**沒換號＝這條判準沒踩到 bug**', '±150 秒'));

// ── B18 讓完之後也不得換邊——「黏著上一幀的號誌」那條規則唯一的判準。
//
// 這一條**讀 `_blockSide` 的號誌，不量畫面**，與本檔其他每一條相反，理由要講清楚：
// 待避結束的那一刻，讓的那班一開走就與對方拉開到一個車距（耦合機制的目的就是這個），
// 兩顆牌不再相疊 ⇒ 螢幕偏移歸零 ⇒ 螢幕上量不到「它換到哪一邊」。實走六個候選、每個 191 個
// 取樣點，讓完之後可量的列全部是 0 筆。號誌對應到畫面哪一側，由 B1/B2/B12/B13/B16/B17
// 用畫面像素獨立證過；這裡只問「同一個情境下號誌穩不穩」，那是時間軸上的性質。
// 侷限照實記：這條與實作同源（心得 29），它證明的是「規則有被遵守」，不是「畫面是對的」。
//
// 刻意不挑場景：全日所有「一方停站、鄰居在跑」的配對都走一遍。挑單一場景會踩空——
// 第一版挑到 2114/1706 那段，拿掉黏著與有黏著的結果一模一樣（探針實測），判準於是永遠綠。
const ST = await A.page.evaluate(() => {
  const keyOf = tr => (tr.sys || '') + ':' + tr.train;
  const segOf = tr => trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
  const seeds = [], seen = new Set();
  for (let t = 0; t < 86400; t += 53) {
    state.simSec = t; updateBlockHolds();
    for (const [k, info] of _blockSide) {
      if (!info.other) continue;
      const me = state.trains.find(x => keyOf(x) === k); if (!me) continue;
      const gm = segOf(me), go = segOf(info.other);
      if (gm && go && gm.dwell && !go.dwell) {
        const tag = me.train + '/' + info.other.train;
        if (!seen.has(tag)) { seen.add(tag); seeds.push({ t, no: me.train, other: info.other.train }); }
        break;
      }
    }
  }
  const out = [];
  for (const sd of seeds) {
    const me = state.trains.find(x => x.train === sd.no && x.sys === 'tra_sched');
    const you = state.trains.find(x => x.train === sd.other && x.sys === 'tra_sched');
    if (!me || !you) continue;
    const rows = [];
    // 每一段各自從乾淨狀態起走。耦合停等與號誌記憶都是跨呼叫累積的，544 段接力掃下來，
    // 前一段留下的狀態會漏進下一段：第一版就這樣掃出 2 次「換邊」（2134/270、112/1174），
    // 單獨重走同樣的區間卻完全穩定＝那 2 次是掃描順序的產物，不是產品的行為。
    // 真實使用是時間往前連續跑，不會這樣跳；跳完就要清乾淨，否則量到的是自己的殘留。
    _blockHold.clear(); _blockGap.clear(); _blockPrevD.clear(); _blockSideEase.clear(); _blockSideSign.clear();
    _blockSim = null;
    for (let dt = -90; dt <= 480; dt += 3) {
      state.simSec = sd.t + dt; updateBlockHolds();
      const info = _blockSide.get(keyOf(me));
      if (!info || info.other !== you) continue;
      const gm = segOf(me), go = segOf(you); if (!gm || !go) continue;
      // 車列成員也記下來：第三台車加入／離開會讓每個人的位次改變，那是情境真的變了不是閃爍
      const arr = state.trains.map(tr => ({ tr, g: segOf(tr) }))
        .filter(x => x.g && x.g.ln === gm.ln && x.g.dir === gm.dir)
        .sort((x, y) => (y.g.d - x.g.d) * gm.dir);
      let mem = '';
      for (let i = 0; i < arr.length;) {
        let j = i + 1;
        while (j < arr.length && (arr[j - 1].g.d - arr[j].g.d) * arr[j].g.dir <= 0.4) j++;
        if (arr.slice(i, j).some(x => x.tr === me)) mem = arr.slice(i, j).map(x => x.tr.train).sort().join(',');
        i = j;
      }
      // 存號誌不存倍率：非對稱畫法讓倍率取 2(讓位)／0(留在線上)／±1(對稱),
      // 「2 → 1」是分離量變了不是換邊,「0」則是根本沒有邊。換邊只看正負號。
      rows.push({ dt, s: Math.sign(info.s), mem, dwell: !!gm.dwell, pDwell: !!go.dwell });
    }
    if (rows.length) out.push({ t: sd.t, me: sd.no, you: sd.other, rows });
  }
  return out;
});
// 情境＝(錨是誰, 車列成員)。換邊唯一合法的理由是「換了一個新的錨」（角色真的對調）。
// 「換錨」允許 ±1 個取樣點的時差：判準每 3 秒問一次「誰在停站」，而實作在自己那一幀用的是
// **上一幀**的停等值，兩邊對「角色什麼時候換人」的認定天生差一拍。實測 112/1174 12:02 就是
// 這樣：112 讓完換成 1174 停站，判準已經認定新錨、實作還沒，於是合法的角色對調被算成閃爍。
// 這個容差不會放過 N18——拿掉黏著的換邊發生在「錨變成沒有人」的那一刻，附近沒有新錨出現。
const anchorNear = (rows, i) => {
  for (let j = Math.max(1, i - 1); j <= Math.min(rows.length - 1, i + 1); j++) {
    if (rows[j].dt - rows[j - 1].dt !== 3) continue;
    const a = anchorOf(rows[j]);
    if (a !== 'none' && a !== anchorOf(rows[j - 1])) return true;
  }
  return false;
};
const badFlips = ST.flatMap(R => R.rows.filter((r, i) => i && R.rows[i - 1].dt === r.dt - 3
  && r.s && R.rows[i - 1].s && r.s !== R.rows[i - 1].s && r.mem === R.rows[i - 1].mem && !anchorNear(R.rows, i))
  .map(r => `${R.me}/${R.you} ${hhmm(R.t)}+${r.dt}`));
// 閘門：全日必須真的出現「錨從某一班變成沒有人、而且還配著對」——那一刻只剩黏著撐著。
// 沒出現過就代表這條判準沒踩到規則，要判紅而不是靜靜地綠。
const stEnds = ST.filter(R => R.rows.some((r, i) => i && R.rows[i - 1].dt === r.dt - 3
  && anchorOf(r) === 'none' && anchorOf(R.rows[i - 1]) !== 'none'));
check('B18 讓完之後（讓的那班開走、沒有人在讓了）也不得換邊——相位黏著唯一的判準',
  ST.length > 0 && stEnds.length > 0 && badFlips.length === 0,
  `全日 ${ST.length} 段待避（共 ${ST.reduce((a, R) => a + R.rows.length, 0)} 個配對取樣點），` +
  `其中 ${stEnds.length} 段走到「讓完、沒有人在讓了」那一刻` +
  (stEnds.length ? '' : '　←**一段都沒有＝這條判準沒踩到規則**') +
  `；情境沒變卻換邊 ${badFlips.length} 次` + (badFlips.length ? `：${badFlips.slice(0, 8).join('、')}` : ''));

// ── B6 位置零變化：偏移是純畫面的，trainPos 逐值必須與「偏移加入前」相同
if (BPORT) {
  const sample = `() => {
    // 誤點漸變層 easedShift 是有狀態的（每次呼叫都推進 e.cur，且吃 performance.now()），
    // 且它的鍵是 'tra:'+車次不含系統 ⇒ 林鐵 1 次會沿用台鐵 1 次的條目並反過來把它拉回去。
    // 這是既有缺陷（a4d1d8f／04a1c2a／708ea44 三顆都有，本次改動沒碰它），另立 issue 處理；
    // 這裡把它換成純函式的替身，逐值比較才有意義——不是放寬判準，是拿掉一個與本題無關的變因。
    easedShift = (k, target) => target;
    const o = [];
    for (const t of [7200, 21600, 28800, 43200, 61200, 75600]) {
      state.simSec = t; if (typeof updateBlockHolds === 'function') updateBlockHolds();
      for (const tr of state.trains) {
        const p = trainPos(tr, t);
        o.push((tr.sys||'') + ':' + tr.train + '@' + t + '=' + (p ? p.lat.toFixed(7) + ',' + p.lon.toFixed(7) : 'null'));
      }
    }
    return o.join('|');
  }`;
  // 對照仍要跑：同一份 build 的另一頁（sa2）必須逐值相同，否則就是取樣本身還有變因沒拿掉，
  // 「改動前後相同」這句話會失去意義（心得 32：不該相同卻相同、該相同卻不同，兩邊都是紅旗）。
  const B = await open(BPORT), C = await open(PORT);
  const [sa, sb, sa2] = await Promise.all([A.page, B.page, C.page].map(p => p.evaluate(`(${sample})()`)));
  await Promise.all([B.b.close(), C.b.close()]);
  const diffs = (x, y) => { const a = x.split('|'), b = y.split('|');
    return a.filter((v, i) => v !== b[i]); };
  const ctrl = diffs(sa, sa2), ab = diffs(sa, sb);
  check('B6 位置零變化（偏移純畫面：trainPos 與改動前逐值相同）',
    ctrl.length === 0 && ab.length === 0,
    `${sa.split('|').length} 個取樣點（${new Set(sa.split('|').map(s => s.split('@')[0])).size} 班車 × 6 個時刻）；` +
    `同版兩頁對照 ${ctrl.length} 筆不同${ctrl.length ? '（取樣仍有變因，下面那個數字不可信）：' + ctrl.slice(0, 2).join(' / ') : '（取樣乾淨）'}；` +
    `改動前 vs 改動後 ${ab.length} 筆不同${ab.length ? '：' + ab.slice(0, 3).join(' / ') : ''}`);
} else console.log('SKIP  B6 位置零變化 — 未給 BPORT');

await A.b.close();

// ── 手機版：360/375/414/768 四寬度 × Chromium/WebKit，實點觸控
// （SKIP_MOBILE=1 給突變測試用：八次瀏覽器啟動太慢，B10 的牙另以「命中點不跟著偏」那一發驗）
const WIDTHS = [360, 375, 414, 768];
for (const [name, eng] of (process.env.SKIP_MOBILE ? [] : [['chromium', chromium], ['webkit', webkit]])) {
  const rows = [];
  for (const w of WIDTHS) {
    const { b, page, errs } = await open(PORT, eng, { viewport: { width: w, height: 780 }, hasTouch: true, isMobile: w < 768 });
    const r = await page.evaluate(() => {
      const keyOf = tr => (tr.sys || '') + ':' + tr.train;
      const settle = (n = 40) => { for (let k = 0; k < n; k++) draw(); };
      for (let t = 0; t < 86400; t += 149) {
        state.simSec = t; updateBlockHolds();
        if (!_blockSide.size) continue;
        const byKey = new Map(); for (const tr of state.trains) byKey.set(keyOf(tr), tr);
        for (const [k, info] of _blockSide) {
          const me = byKey.get(k); if (!me || !info.other) continue;
          const p = trainPos(me, t), qq = trainPos(info.other, t); if (!p || !qq) continue;
          map.setView([(p.lat + qq.lat) / 2, (p.lon + qq.lon) / 2], 14, { animate: false });
          settle();
          const h = state._trainHits.find(x => x.tr === me); if (!h) continue;
          const raw = map.latLngToContainerPoint([p.lat, p.lon]);
          const off = Math.hypot(h.x - raw.x, h.y - raw.y);
          if (off < 1) continue;                              // 這一對在這個縮放沒疊到，換下一個場景
          const box = map.getContainer().getBoundingClientRect();
          return { t, tr: me.train, off: +off.toFixed(2), px: box.left + h.x, py: box.top + h.y };
        }
      }
      return null;
    });
    if (!r) { rows.push(`${w}px: 找不到並排場景`); await b.close(); continue; }
    // 實點觸控：點畫出來的那顆。合法結果有兩種——直接跟隨，或車站太近而彈歧義選單
    // （選單是既有規格，不是缺陷）。彈選單時要再點穿「跟隨 N 次」那一列，端到端確認點到的是它。
    await page.touchscreen.tap(r.px, r.py);
    await page.waitForTimeout(400);
    const menu = await page.evaluate(tn => {
      const el = document.getElementById('tapPick');
      if (!el || el.hidden) return null;
      const rows = [...el.querySelectorAll('.tp-row')].map(x => x.textContent.trim());
      return { rows, i: rows.findIndex(s => s.includes('跟隨 ' + tn + ' 次')) };
    }, r.tr);
    if (menu && menu.i >= 0) {
      const bx = await page.evaluate(i => { const b = document.querySelectorAll('#tapPick .tp-row')[i].getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, menu.i);
      await page.touchscreen.tap(bx.x, bx.y);
      await page.waitForTimeout(300);
    }
    const picked = await page.evaluate(() => state.followTrain && state.followTrain.train);
    // 沒點到就把「觸控點下面是誰」印出來——不然只會看到 null，查不出是被誰擋住
    const under = picked ? '' : await page.evaluate(p => { const e = document.elementFromPoint(p.x, p.y);
      return e ? (e.id || e.className || e.tagName) : 'none'; }, { x: r.px, y: r.py });
    rows.push({ w, off: r.off, tr: r.tr, picked, via: menu ? '歧義選單' : '直接', errs: errs.length, under,
      ok: r.off > 1 && String(picked) === String(r.tr) });
    await b.close();
  }
  const bad = rows.filter(r => typeof r === 'object' && !r.ok);
  check(`B10 手機版 ${name}：${WIDTHS.join('/')} 四寬度都會並排，且實點觸控點到的是那一班`,
    rows.every(r => typeof r === 'object') && bad.length === 0,
    rows.map(r => typeof r === 'string' ? r
      : `${r.w}px 偏移 ${r.off}px→${r.via}點到 ${r.picked}（該班 ${r.tr}）${r.under ? `［觸點下方＝${r.under}］` : ''}${r.errs ? ` ⚠${r.errs} 錯誤` : ''}`).join('；'));
}

const fail = results.filter(r => !r.ok).length;
console.log(`\n合計 ${results.length - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

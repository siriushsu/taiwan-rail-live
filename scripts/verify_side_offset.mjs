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
    const a = posAlongShape(g.ln, g.d - 0.02), b = posAlongShape(g.ln, g.d + 0.02);
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

  const out = { scenes: scenes.length, sym: [], norm: [], zoom: [], step: [], pick: [], follow: [], runs3: 0, dot: [], ctrl: [], coin: [] };

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
    if (pair2) out.sym.push({ t: sc.t, a: sc.a, b: sc.b,
      m: +((mag(oa) + mag(ob)) / 2).toFixed(2),
      dpx: +Math.abs(mag(oa) - mag(ob)).toFixed(2),
      dmag: +(Math.abs(mag(oa) - mag(ob)) / Math.max(mag(oa), mag(ob), 1e-9)).toFixed(4),
      cos: +((oa.x * ob.x + oa.y * ob.y) / Math.max(mag(oa) * mag(ob), 1e-9)).toFixed(4) });

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

    // 命中：點畫出來的那顆，選到的必須是它自己（心得 33：驗按鈕不是驗它在哪，是驗點它會發生什麼）
    for (const tr of [trA, trB]) {
      const h = drawnCp(tr); if (!h) continue;
      const got = trainAt({ x: h.x, y: h.y });
      out.pick.push({ t: sc.t, tr: tr.train, hit: got ? got.tr.train : null, ok: !!got && got.tr === tr });
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
check('B1 一對並排的兩車各偏一半：偏移量相等、且偏向軌道的相反側',
  M.sym.length > 0 && symBad.length === 0,
  `${M.sym.length} 對，兩台偏移量差距 p90 ${q(M.sym.map(s => s.dpx), 0.9)}px、` +
  `最大 ${Math.max(0, ...M.sym.map(s => s.dpx))}px（＝${(100 * Math.max(0, ...M.sym.map(s => s.dmag))).toFixed(1)}%）；` +
  `方向內積最大（越接近 −1 越是正對面）` +
  `${Math.max(-1, ...M.sym.map(s => s.cos))}；偏移量中位 ${q(M.sym.map(s => s.m), 0.5)}px` +
  `${M.runs3 ? `；另有 ${M.runs3} 組三台以上的車列（之字形，不做兩兩對稱檢查）` : ''}` +
  (symBad.length ? `；不對稱 ${symBad.length} 對，例：${JSON.stringify(symBad.slice(0, 3))}` : ''));

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
check('B5 點偏移後的標記選到的是它自己（不是原位、也不是隔壁那班）',
  M.pick.length > 0 && missPick.length === 0,
  `${M.pick.length} 次點擊，命中率 ${pct(M.pick.length - missPick.length, M.pick.length)}` +
  (missPick.length ? `；失手例：${JSON.stringify(missPick.slice(0, 3))}` : ''));

// B8 跟隨中的主角不偏
const fBad = M.follow.filter(f => f.m > 0.05);
check('B8 跟隨中的主角是鏡頭錨點，不得被偏移',
  M.follow.length > 0 && fBad.length === 0,
  `${M.follow.length} 筆，最大 ${Math.max(0, ...M.follow.map(f => f.m))}px`);

// B12 兩車位置完全重合（同站待避）時仍要並排——這一條是看實際畫面才發現的：
// 數字判準全綠的那一版，兩班停在同一站的車仍然畫在同一個像素上。
const coinBad = M.coin.filter(c => Math.min(c.ma, c.mb) < 1);
check('B12 兩班車位置完全重合（同站）時仍然要並排，不得靜默合體',
  M.coin.length > 0 && coinBad.length === 0,
  `${M.coin.length} 對完全重合（相距 <1m），兩台偏移量最小值的中位 ` +
  `${q(M.coin.map(c => Math.min(c.ma, c.mb)), 0.5)}px` +
  (coinBad.length ? `；仍合體 ${coinBad.length} 對，例：${JSON.stringify(coinBad.slice(0, 3))}` : ''));

// B13 偏移之後兩顆牌不可以還疊在一起——這條是「看實際畫面」得到的：位移量若寫成固定 px，
// 只夠讓開牌高（15px）；軌道垂直時法線是水平的，要讓開的是牌寬（32px），兩顆牌照樣疊著。
const lapBad = M.coin.filter(c => c.ov == null || c.ov > 0);
check('B13 並排之後兩顆車號牌不得再相疊（矩形交集為零）',
  M.coin.length > 0 && lapBad.length === 0,
  `${M.coin.length} 對完全重合的車，偏移後矩形交集面積最大 ${Math.max(0, ...M.coin.map(c => c.ov || 0))}px²` +
  (lapBad.length ? `；仍相疊 ${lapBad.length} 對，例：${JSON.stringify(lapBad.slice(0, 3))}` : ''));

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
  return { frames: rec.length, n: jumps.length, maxJump: Math.max(0, ...jumps), amp: +(wmax / 2 + BLOCK_SIDE_GAP).toFixed(2),
    maxAmp: +Math.max(0, ...amps).toFixed(2), p99: jumps.sort((x, y) => x - y)[Math.floor(jumps.length * 0.99)] || 0 };
});
check('B11 時鐘在跑時偏移不閃爍（相鄰兩幀不得整段翻面）',
  MO.frames > 60 && MO.n > 0 && MO.maxAmp <= MO.amp && MO.maxJump < MO.maxAmp,
  `連續 ${MO.frames} 幀（30× 快轉）共 ${MO.n} 筆逐幀比較：偏移量最大 ${MO.maxAmp}px（上界＝半個牌寬＋縫 ${MO.amp}px），` +
  `幀間變化 p99 ${MO.p99}px、最大 ${MO.maxJump}px（整段翻面會是 ${(2 * MO.maxAmp).toFixed(1)}px）`);

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

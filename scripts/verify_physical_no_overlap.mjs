// 出貨管線（實體股道）上的「兩列車互相穿越」閘門。
//
// 為什麼要另開一支：`verify_no_overtake.mjs`（issue #17 專屬）量的是**示意線形**那條管線
// ——它只等 `state.trains.length > 300`（+670 ms 就成立），而 `railIslandPhysical` 要到
// +2041 ms 才就緒，接著整天的掃描在同一個 evaluate 裡同步跑完、中間不讓出事件迴圈，
// 於是 `window.railIslandPhysical` 對它永遠是 undefined。結果 2026-09-12 實測：它報
// 「187 班被擋過」全綠，而正式站上台鐵**一班都沒被擋**（`has()` 918/918 成立，防追撞是死碼）。
// 那是「判準沒在量出貨的那個東西」的教科書實例，所以這支的第一件事就是**具名斷言 physical
// 已就緒且覆蓋率夠**，分母不准無聲縮水。
//
// 判準（刻意不與實作同源，而且**沒有門檻**）：
//   * 位置只吃 `trainPos()` —— 畫面用的同一個入口，不讀 `_blockHold`、不讀 `trainSeg` 的簿記。
//   * 「互相穿越」＝兩列車的車身佔用了**同一個 `resource`**（`system:節點A:節點B`，＝一段實體
//     股道；`route-runtime.js:12` 造的那把鍵，也是派車求解器用的同一把）。兩列車同時佔同一段
//     股道在物理上不可能，所以這條判準不需要距離門檻，也不會隨線形精度漂移。
//   * 🔴 一度改用「車廂軸線最短距離 < 0.5 m」，被實測打掉：道岔前兩股道是**連續收攏**到同一個
//     節點的，相鄰月台上的兩列車軸線距離照樣趨近 0（實測未達門檻的最近一筆 0.51 m，門檻 0.5 m
//     ——餘裕等於沒有）。距離型門檻在這個幾何上結構性地分不開「同軌」與「鄰軌」。
//   * 分組（同向／對向／停站中）用 `trainSeg`；分組不是判準，判準是分組之後量到的佔用交集。
//
// 🔴 120 秒上限是**對外宣告過的誠實邊界**（issue #17 回文寫過：撞上限就攔不住），所以 A 類的
// 斷言是**棘輪**（不得比實測基線更糟）而不是「必須為 0」：2026-09-12 實測全日 570 個時點，
// 防追撞接回來之後 A 類從 12 筆降到 5 筆，剩下的 5 筆裡 2 筆 hold 已經頂在 120 秒、
// 1 筆正在往上限爬（278/6652 兩分鐘內 65→114 秒）。**不准為了讓它變綠而調大上限**；
// 真正要清掉這 5 筆得從派車表下手（278 與 6652 被指派了同一條 pathIds，見下面 B 那一段）。
// 每一筆的 hold 都印出來，人看得到它是不是頂到上限了。
//
// 已知**仍未修**、故意只申報不斷言的兩族（改它們要動派車表或要裁示，不在本閘門範圍）：
//   B 兩車同時停在**同一個停車節點**：全日每 2 分抽樣 199 筆／去重 152 對。63% 是
//     「中途/中途」（不是折返接力），`dispatch.handoffs` 全表只有 1 筆（而且是林鐵），
//     所以這是派車的月台指派沒有把停站佔用算進去，要重跑 optimize_physical_dispatch。
//   A′ 對向同一條股道：全日 19 筆（枋野/大武 411/162 共用 145 m）。時間 hold 修不了
//     （兩台互為障礙會鎖死），要先裁示「這代表資料錯，該藏還是該顯示」。
//   兩族都用棘輪守住（不得比基線更糟），基線寫在 BASE_B／BASE_OPP。
//
// 跑法（自帶 node:http 靜態站，不需要外部 server）：
//   node scripts/verify_physical_no_overlap.mjs
//   可選 PORT=／STEP=（重放步長秒，預設 4）／SAMPLE=（取樣間隔秒，預設 120）
//   FROM=／TO= 只給除錯用：縮小視窗會讓 G3 的分母斷言紅（那是刻意的，全日才是契約）。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5531);
const STEP = Number(process.env.STEP || 4);
const SAMPLE = Number(process.env.SAMPLE || 120);
const FROM = Number(process.env.FROM || 5 * 3600);
const TO = Number(process.env.TO || 24 * 3600 - 1);
const BASE_A = 5;             // 同向在途互穿:實測基線(對照組關掉防追撞是 12 筆)。棘輪,只准往下
const BASE_B = 240;           // 已知未修:兩車同停同一節點,全日取樣數上限(棘輪)
const BASE_C = 60;           // 已知未修:一停一跑在站區道岔共用一小段,全日取樣數上限(棘輪)
const BLOCK_CAP = 120;        // 與 index.html 的 BLOCK_CAP_SEC 同值,只用來寫進訊息
const BASE_OPP = 24;          // 已知未修:對向同股道,全日取樣數上限(棘輪,實測 19)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
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
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const hhmm = s => String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// 即時誤點釘死成「沒有」:同一支腳本每分鐘結果不同的話,紅了也無從歸因。
await page.route('**/api/delay-stats*', r => r.abort());
await page.route('**/*tra-live*', r => r.abort());

// ── G0 身分自檢:本機並行 20+ worktree,port 撞到別人的樹會靜默驗錯目標 ──────────────
const md5 = b => createHash('md5').update(b).digest('hex');
const disk = md5(readFileSync(path.join(ROOT, 'index.html')));
const served = md5(Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer()));
ok('G0 伺服器吐的是受測樹', disk === served, `${ROOT} md5=${disk.slice(0, 12)}`);

await page.goto(`http://127.0.0.1:${PORT}/?g=all&scene=3d&lang=zh-TW&at=24.6,121.8&z=13&t=09:56`);
await page.waitForFunction(() => state.ready && state.trains?.length > 0 && window.railIslandPhysical, null, { timeout: 180000 });

const setup = await page.evaluate(async () => {
  const F = await import('/rail-3d/integration/formations.js');
  const P = await import('/rail-3d/integration/train-path.js');
  const catalog = await (await fetch('/rail-3d/assets/blender-map-v1/manifest.json')).json();
  const models = new WeakMap();
  const modelOf = tr => { if (models.has(tr)) return models.get(tr); const f = F.formationFor({ systemId: tr.sys, typeName: tr.typeName, carName: tr.carName }, 'actual'); const m = f ? F.assembleFormation(f, catalog) : null; models.set(tr, m); return m; };
  // 車廂軸線:以公尺平面座標表示的線段(兩端＝該節車廂前後端)
  const axis = (p, half) => { const mx = 111320 * Math.cos(p.coordinate[1] * Math.PI / 180), x = p.coordinate[0] * mx, y = p.coordinate[1] * 111320, dx = Math.cos(p.angle) * half, dy = Math.sin(p.angle) * half; return [[x - dx, y - dy], [x + dx, y + dy]]; };
  const ptSeg = (p, a, b) => { const x = b[0] - a[0], y = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y || 1))); return Math.hypot(p[0] - a[0] - x * t, p[1] - a[1] - y * t); };
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const segDist = (a, b, c, d) => (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) ? 0 : Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
  window.__reset = () => { _blockHold.clear(); _blockGap.clear(); _blockPrevD.clear(); _blockCapped.clear(); _blockSim = null; };
  window.__step = (sec) => { state.playing = false; setSimSec(sec); updateBlockHolds(); };
  // 車身佔用的實體股道:鍵取 edgeId(來源 way ＋ 節點序號,全網唯一且與方向無關),
  // 值是「這段 edge 被車身蓋到的區間」——只比鍵不比區間會假陽性:同一段 400 公尺長的 edge 上
  // 一頭一台,兩台都「佔用」它,實測量出「共用 60 公尺」而軸線其實差 53 公尺。
  // 區間用 edge 自己的參數 t∈[0,1] 表示,兩列車即使沿線里程原點不同也能直接比。
  const occupancy = (route, chainageM, lenM) => {
    const d = route.path.d, s0 = Math.max(0, chainageM - lenM / 2), s1 = Math.min(route.path.length, chainageM + lenM / 2), res = new Map();
    for (let i = 0; i < route.edges.length && i < d.length - 1; i++) {
      const a = d[i], b = d[i + 1]; if (b <= s0 || a >= s1) continue;
      const e = route.edges[i], span = (b - a) || 1, wspan = Math.abs(e.b - e.a) || 1, lo0 = Math.min(e.a, e.b);
      const u0 = (Math.max(a, s0) - a) / span, u1 = (Math.min(b, s1) - a) / span;
      const t0 = (e.a + (e.b - e.a) * u0 - lo0) / wspan, t1 = (e.a + (e.b - e.a) * u1 - lo0) / wspan;
      const prev = res.get(e.edgeId), cur = [Math.min(t0, t1), Math.max(t0, t1), span];
      res.set(e.edgeId, prev ? [Math.min(prev[0], cur[0]), Math.max(prev[1], cur[1]), span] : cur);
    }
    return res;
  };
  const sharedMetres = (ra, rb) => { let m = 0; const keys = [];
    for (const [k, ta] of ra) { const tb = rb.get(k); if (!tb) continue;
      const ov = Math.min(ta[1], tb[1]) - Math.max(ta[0], tb[0]); if (ov > 1e-9) { m += ov * ta[2]; keys.push(k); } }
    return { m, keys }; };
  window.__scan = (useHold) => {
    const vs = [];
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || tr.loop) continue;
      // 位置走畫面同一個入口。useHold=false 是正向對照組(把防追撞關掉重量一次)。
      const p = useHold ? trainPos(tr, state.simSec) : trainPosAt(tr, state.simSec - liveDelaySec(tr));
      if (!p || !p.physical) continue;
      const m = modelOf(tr); if (!m) continue;
      const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - (useHold ? blockHoldSec(tr) : 0));
      const res = occupancy(p.route, p.chainageM, m.lengthM);
      const hold = blockHoldSec(tr);
      vs.push({ no: String(tr.train), dwell: !!p.dwell, dir: g?.dir ?? null, lat: p.lat, lon: p.lon,
        stop: tr.stops[p.stopIndex]?.name, lenM: m.lengthM, res, hold: +hold.toFixed(1),
        parts: m.parts, chainageM: p.chainageM, facing: (p.railDirection || 1) * (p.formationFacing || 1), path: p.route.path });
    }
    const hits = [];
    let compared = 0;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const A = vs[i], B = vs[j];
      if (Math.hypot((A.lon - B.lon) * 111320 * Math.cos(A.lat * Math.PI / 180), (A.lat - B.lat) * 111320) > A.lenM + B.lenM + 60) continue;
      compared++;
      const { m: shared, keys } = sharedMetres(A.res, B.res);
      if (shared <= 0.01) continue;
      // 只給被抓到的配對算車廂軸線距離(純粹當現場顏色,不是判準)
      let min = Infinity;
      const posesOf = v => P.formationPoses(v.path, v.chainageM, v.facing, v.parts) || [];
      const pa = posesOf(A), pb = posesOf(B), ax = (v, ps) => ps.map((q, i) => axis(q, v.parts[i].lengthM / 2));
      const aa = ax(A, pa), bb = ax(B, pb);
      for (const a of aa) for (const b of bb) { const t = segDist(a[0], a[1], b[0], b[1]); if (t < min) min = t; }
      // 車頭距＝使用者看到的那件事的強度(截圖那一對量到 0.39 m:兩列車的車廂互相穿插)
      const headM = pa.length && pb.length ? haversineKm({ lat: pa[0].coordinate[1], lon: pa[0].coordinate[0] }, { lat: pb[0].coordinate[1], lon: pb[0].coordinate[0] }) * 1000 : null;
      hits.push({ a: A.no, b: B.no, sharedM: +shared.toFixed(1), resources: keys.length,
        minM: Number.isFinite(min) ? +min.toFixed(2) : null, dwellA: A.dwell, dwellB: B.dwell,
        sameDir: A.dir === B.dir, holds: A.hold + '/' + B.hold, headM: headM === null ? null : +headM.toFixed(2),
        centreM: +(haversineKm(A, B) * 1000).toFixed(1), stop: A.stop + '/' + B.stop });
    }
    return { running: vs.length, compared, hits };
  };
  // 接線自檢:hold 真的有進到畫面用的 trainPos(不是只寫在 _blockHold 裡)
  window.__wired = () => {
    let moved = 0, held = 0;
    for (const tr of state.trains) {
      const h = blockHoldSec(tr); if (!(h > 0.5)) continue; held++;
      const a = trainPos(tr, state.simSec), b = trainPosAt(tr, state.simSec - liveDelaySec(tr));
      if (a && b && haversineKm(a, b) * 1000 > 1) moved++;
    }
    return { held, moved };
  };
  return { trains: state.trains.length,
    traTotal: state.trains.filter(t => t.sys === 'tra_sched' && !t.loop).length,
    hasCovered: state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && railIslandPhysical.has(t)).length,
    physicalReady: !!window.railIslandPhysical, live: liveActive() };
});
ok('G1 physical 已就緒且覆蓋台鐵全班',
  setup.physicalReady && setup.traTotal >= 800 && setup.hasCovered / setup.traTotal >= 0.99,
  `台鐵 ${setup.hasCovered}/${setup.traTotal} 走實體股道, 全系統 ${setup.trains} 班, liveActive=${setup.live}`);

// ── 連續重放（棘輪要演化,快照掃描量不到真實動態）────────────────────────────────
await page.evaluate(([f]) => { __reset(); __step(f); }, [FROM]);
const cls = h => h.dwellA && h.dwellB ? 'B 兩車都停站' : (!h.sameDir ? 'A′ 對向' : (h.dwellA || h.dwellB ? 'C 一停一跑' : 'A 同向在途'));
const counts = {}, uniq = new Map();
let samples = 0, runSum = 0, comparedSum = 0, wiredHeld = 0, wiredMoved = 0, capped = 0;
for (let hour = FROM; hour <= TO; hour += 3600) {
  const end = Math.min(TO, hour + 3600 - 1);
  const chunk = await page.evaluate(([from, to, step, sample]) => {
    const out = [];
    for (let s = from; s <= to; s += step) {
      __step(s);
      if ((s - from) % sample < step) out.push({ s, ...__scan(true), wired: __wired() });
    }
    return out;
  }, [hour, end, STEP, SAMPLE]);
  for (const r of chunk) {
    samples++; runSum += r.running; comparedSum += r.compared;
    wiredHeld += r.wired.held; wiredMoved += r.wired.moved;
    for (const h of r.hits) {
      const k = cls(h); counts[k] = (counts[k] || 0) + 1;
      if (k === 'A 同向在途' && (h.holds || '').split('/').some(v => +v >= BLOCK_CAP - 1)) capped++;
      const id = [h.a, h.b].sort().join('/') + '@' + h.stop + '|' + k;
      if (!uniq.has(id)) uniq.set(id, { ...h, k, t: r.s, n: 0 });
      uniq.get(id).n++;
    }
  }
}
const A = counts['A 同向在途'] || 0, Ap = counts['A′ 對向'] || 0, B = counts['B 兩車都停站'] || 0, C = counts['C 一停一跑'] || 0;
const list = (k) => [...uniq.values()].filter(v => v.k === k).sort((a, b) => b.sharedM - a.sharedM).slice(0, 6)
  .map(v => `${hhmm(v.t)} ${v.a}/${v.b}@${v.stop} 共用${v.sharedM}m 車頭距${v.headM}m 軸距${v.minM}m hold=${v.holds}×${v.n}`).join('; ');

ok(`G2 同向在途的台鐵列車互穿不得比基線更糟 ≤${BASE_A}`, A <= BASE_A,
  `取樣 ${samples} 個時點、比對 ${comparedSum} 對次, 互穿 ${A} 筆(其中 ${capped} 筆已把 hold 頂到 ${BLOCK_CAP} 秒上限)`
  + ` ← ${list('A 同向在途')}`);
ok('G3 分母沒有無聲縮水', samples >= 500 && runSum / samples >= 100 && comparedSum >= 3000,
  `每時點在跑 ${(runSum / samples).toFixed(0)} 班, 平均比對 ${(comparedSum / samples).toFixed(1)} 對/時點`);
ok('G4 hold 真的進到畫面用的 trainPos', wiredHeld > 0 && wiredMoved === wiredHeld,
  `被擋取樣 ${wiredHeld} 筆, 其中畫面位置確實位移 ${wiredMoved} 筆`);
ok(`G5 已知未修 C（一停一跑同軌,站區道岔）不得比基線更糟 ≤${BASE_C}`, C <= BASE_C, `${C} 筆 ← ${list('C 一停一跑')}`);
ok(`G6 已知未修 B（同停站同節點）不得比基線更糟 ≤${BASE_B}`, B <= BASE_B, `${B} 筆 ← ${list('B 兩車都停站')}`);
ok(`G7 已知未修 A′（對向同股道）不得比基線更糟 ≤${BASE_OPP}`, Ap <= BASE_OPP, `${Ap} 筆 ← ${list('A′ 對向')}`);

// ── 正向對照:把防追撞關掉重量同一批時點,A 類必須明顯變多,否則這條判準沒有牙 ─────────
const control = await page.evaluate(([from, to, step, sample]) => {
  __reset(); let a = 0, n = 0;
  for (let s = from; s <= to; s += step) {
    __step(s);
    if ((s - from) % sample < step) { n++; for (const h of __scan(false).hits) if (h.sameDir && !h.dwellA && !h.dwellB) a++; }
  }
  return { a, n };
}, [FROM, TO, STEP, SAMPLE]);
ok('G8 正向對照:關掉防追撞,同向在途互穿必須明顯變多', control.a > A,
  `對照組 ${control.n} 個時點量到 ${control.a} 筆（有防追撞時 ${A} 筆）`);
ok('G9 頁面沒有 JS 例外', errors.length === 0, errors.slice(0, 2).join(' | ') || '0');

console.log(`\n分類統計 A=${A}(撞上限 ${capped}) A′=${Ap} B=${B} C=${C}｜判準＝共用同一段實體股道(無門檻)`);
await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n合計 ${results.length - bad.length} PASS / ${bad.length} FAIL`);
process.exit(bad.length ? 1 : 0);

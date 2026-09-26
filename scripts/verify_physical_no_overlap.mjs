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
// 判準（比車身交集，另設既有數量棘輪）：
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
// 既有 B／A′／C 仍有殘餘，棘輪只代表不得惡化，不代表零互穿。
// 2026-09-12 補回太麻里來源月台股道與四段路徑，固定重放的 B 48→42、A′ 19→17。
// 兩分鐘取樣會漏掉短暫衝突；具名案例另由 verify_verified_station_routes_browser 逐秒檢查。
// 不能把西部雙線的錯股指派概括為「官方班表錯」或「單線無解」。
//
// 跑法（自帶 node:http 靜態站，不需要外部 server）：
//   node scripts/verify_physical_no_overlap.mjs
//   可選 PORT=／STEP=（重放步長秒，預設 4）／SAMPLE=（取樣間隔秒，預設 120）
//   TEST_DATE=YYYY-MM-DD 用磁碟上的班表重放該服務日（探真實日子用）；不給就重放釘死的班表快照
//   （FIXTURE_REF 那顆 commit 的 tra_schedule_dense.json、FIXTURE_DATE 那一天）。
//   🔴 2026-09-22：棘輪基線是拿 9/13 那份班表量的，但台鐵班表是每週滾動的 14 天窗，拿「今天」
//   重放等於每週換一份考卷——9/22、9/23 全日連對照組都是 0 筆（G8 結構性紅）、9/25 中秋加班日
//   A=12／C=21（比基線多一倍）——四個日期沒有一天全綠，出貨鏈整條被擋。棘輪要量的是**程式與派軌
//   有沒有退步**，輸入就得釘死；真實日子的互穿另有 check-physical-overlap-families 逐日看。
//   FORMATION_PROBE=long 只在瀏覽器試驗長編組，不寫回產品。
//   ENGINE=webkit 可換真實引擎；REPORT= 指定完整事件報告。
//   FROM=／TO= 只給除錯用：縮小視窗會讓 G3 的分母斷言紅（那是刻意的，全日才是契約）。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = Number(process.env.PORT || 0);
// 釘死的考卷：132e1ebb 是 9/9 抓的班表（窗 09-09～09-22），9/13 就是 BASE_* 那幾條棘輪量基線的服務日。
// 換基線時這兩個值與 BASE_* 一起改，並在 commit 訊息附新舊四個數字。
const FIXTURE_REF = '132e1ebb', FIXTURE_DATE = '2026-09-13';
const FIXTURE = !process.env.TEST_DATE;
const TEST_DATE = process.env.TEST_DATE || FIXTURE_DATE;
if (!/^\d{4}-\d{2}-\d{2}$/.test(TEST_DATE)) throw Error('TEST_DATE 必須為 YYYY-MM-DD');
const fixtureSchedule = FIXTURE ? execFileSync('git', ['-C', ROOT, 'show', `${FIXTURE_REF}:data/tra_schedule_dense.json`], { maxBuffer: 64 << 20 }) : null;
// 🔴 2026-09-26：只釘班表不夠。重放時頁面還會讀 tra_pass_obs.json（7 天實測通過時刻）與
//   tra_run_profiles.json（跑段剖面），兩個都是 npm run fetch-schedule 每次整份重產的——9/26 重抓後
//   同一份 9/13 考卷量到 C 13→19、B 37→38、A′ 9→4，程式一行沒動。這兩個釘在 09-22 量基線時磁碟上
//   那一份（0ef6fa24：pass_obs 是 8f228a09 重抓的、run_profiles 是 0ef6fa24 重算的），重放回到
//   13／37／9 逐項相同。換基線時這個 ref 跟 FIXTURE_REF 一起改。
const FIXTURE_DERIVED_REF = '0ef6fa24';
const fixtureDerived = FIXTURE ? new Map(['data/tra_pass_obs.json', 'data/tra_run_profiles.json'].map(p =>
  ['/' + p, execFileSync('git', ['-C', ROOT, 'show', `${FIXTURE_DERIVED_REF}:${p}`], { maxBuffer: 64 << 20 })])) : null;
const STEP = Number(process.env.STEP || 4);
const SAMPLE = Number(process.env.SAMPLE || 120);
const FROM = Number(process.env.FROM || 5 * 3600);
const TO = Number(process.env.TO || 24 * 3600 - 1);
// 2026-09-22 重量基線（使用者 go）：輸入釘死之後重放是決定性的（同一份快照在 main 與正式站 v0920e
// 兩棵樹各跑一次，四個數字逐一相同），所以棘輪直接取實測值，不留餘裕。舊值 5／55／10／18 是 9/12–13
// 在短編組、各自不同服務日量的，9/14 開放完整編組後車身變長、互穿本來就會多，只是之後每次出貨
// 剛好都在數字夠低的日子跑過。要動這四個值，先在正式站那顆 commit 的乾淨樹跑同一支當對照組。
const BASE_A = 7;             // 同向在途互穿(對照組關掉防追撞是 16 筆)。棘輪,只准往下
const BASE_B = 37;            // 兩車都停站同節點
const BASE_C = 13;            // 一停一跑同軌(站區道岔)
const BLOCK_CAP = 120;        // 與 index.html 的 BLOCK_CAP_SEC 同值,只用來寫進訊息
const BASE_OPP = 9;           // 對向同股道
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  if (fixtureSchedule && url.pathname === '/data/tra_schedule_dense.json') { res.setHeader('content-type', MIME['.json']); return res.end(fixtureSchedule); }
  if (fixtureDerived && fixtureDerived.has(url.pathname)) { res.setHeader('content-type', MIME['.json']); return res.end(fixtureDerived.get(url.pathname)); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
PORT = server.address().port; // 預設 0＝系統挑空埠並綁 127.0.0.1：原本寫死 5531 又不給 host，別棵樹的孤兒佔著 127.0.0.1:5531 時這裡照樣 listen 成功、請求卻被孤兒接走

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const hhmm = s => String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');

const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
const page = await ctx.newPage();
const clockStart = new Date(TEST_DATE + 'T12:00:00+08:00');
await page.clock.install({time:clockStart});
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

// 9/14 完整編組已成產品預設。long 現在直接驗產品；legacy-three 只重播既有短編組基線。
// 不改產品磁碟或預設，不把短編組結果冒充完整編組結果。
if (process.env.FORMATION_PROBE === 'legacy-three') {
  const source=readFileSync(path.join(ROOT,'rail-3d/integration/formations.js'),'utf8');
  const legacy={commuter:"spec('emu800',repeat(3,20),2.9)",chukuang:"spec('e200',[17,20,20],2.9)",
    blue:"spec('blue',[17,20,20],2.9)",haifeng:"spec('haifeng',repeat(3,20),2.9)",shanlan:"spec('shanlan',repeat(3,20),2.9)",
    mingri:"spec('mingri',[17,20,20],2.9)",star:"spec('e500',[17,20,20],2.9)",forest:"spec('dl25',[10,12,12],2)"};
  let candidate=source;
  for(const [key,value] of Object.entries(legacy)) {
    const pattern=new RegExp('^  '+key+':.*,$','m');
    if(!pattern.test(candidate))throw Error('舊編組探針找不到 '+key);
    candidate=candidate.replace(pattern,'  '+key+':'+value+',');
  }
  await page.route('**/rail-3d/integration/formations.js',r=>r.fulfill({contentType:'text/javascript',body:candidate}));
}
for (const [env,file] of [['NETWORK','network.json'],['DISPATCH','dispatch.json']]) if(process.env[env]) await page.route('**/rail-3d/physical/'+file,r=>r.fulfill({contentType:'application/json',body:readFileSync(process.env[env])}));
await page.goto(`http://127.0.0.1:${PORT}/?g=all&scene=3d&lang=zh-TW&at=24.6,121.8&z=13&t=09:56`);
await page.waitForFunction(() => state.ready && state.trains?.length > 0 && window.railIslandPhysical, null, { timeout: 180000 });

// 凍結自動 rAF／計時器，避免兩個重放 chunk 之間多呼叫一次 dSim=0 的 snap 改變 hold。
await page.clock.pauseAt(new Date(clockStart.getTime()+60000));
const setup = await page.evaluate(async () => {
  const F = await import('/rail-3d/integration/formations.js');
  const P = await import('/rail-3d/integration/train-path.js');
  const catalog = await (await fetch('/rail-3d/assets/blender-map-v1/manifest.json')).json();
  const models = new WeakMap();
  const modelOf = tr => { if (models.has(tr)) return models.get(tr); const f = F.formationFor({ systemId: tr.sys, typeName: tr.typeName, carName: tr.carName, stockId: specialOf(tr)?.stock?.id, branchId: specialOf(tr)?.branch?.id, namedId: specialOf(tr)?.named?.id }, 'actual'); const m = f ? F.assembleFormation(f, catalog) : null; models.set(tr, m); return m; };
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
  window.__occupancy = occupancy; window.__sharedMetres = sharedMetres; window.__modelOf = modelOf; // G10 用
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
      hits.push({ a: A.no, b: B.no, sharedM: +shared.toFixed(1), resources: keys.length, edgeIds: keys,
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
  // 獨立的具名判準：支線與觀光車不能因主線區間車放長而一起變成 8 節。
  const identityRoster=(await (await fetch('/data/tra_schedule_dense.json')).json()).trains;
  const identities = ['2','1839','6652'].map(no => {const raw=identityRoster.find(t=>String(t.train)===no),tr=raw&&{...raw,sys:'tra_sched'};const m=tr&&modelOf(tr);return {no,id:m?.id,lengthM:m?.lengthM};});
  return { identities, serviceDate: state.trains.find(t=>t.sys==='tra_sched'&&!t.loop&&!t.stops._prevNight)?._rday, trains: state.trains.length,
    traTotal: state.trains.filter(t => t.sys === 'tra_sched' && !t.loop).length,
    hasCovered: state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && railIslandPhysical.has(t)).length,
    physicalReady: !!window.railIslandPhysical, live: liveActive() };
});
ok('G1 physical 已就緒且覆蓋台鐵全班',
  setup.physicalReady && setup.traTotal >= 800 && setup.hasCovered / setup.traTotal >= 0.99,
  `台鐵 ${setup.hasCovered}/${setup.traTotal} 走實體股道, 全系統 ${setup.trains} 班, liveActive=${setup.live}`);

ok('G1b 判準使用畫面的支線與具名車型', setup.identities.every((r,i)=>r.id===['e500','dr1000','haifeng'][i] && Math.abs(r.lengthM-(process.env.FORMATION_PROBE==='legacy-three'?[57,60,60]:[137,60,80])[i])<1e-6), JSON.stringify(setup.identities));
ok('G1c 班表服務日與固定重放日一致', setup.serviceDate===TEST_DATE, `${setup.serviceDate} / ${TEST_DATE}${FIXTURE ? `（班表快照 ${FIXTURE_REF}，通過時刻與跑段剖面快照 ${FIXTURE_DERIVED_REF}）` : '（磁碟班表）'}`);
// ── 連續重放（棘輪要演化,快照掃描量不到真實動態）────────────────────────────────
await page.evaluate(([f]) => { __reset(); __step(f); }, [FROM]);
const cls = h => h.dwellA && h.dwellB ? 'B 兩車都停站' : (!h.sameDir ? 'A′ 對向' : (h.dwellA || h.dwellB ? 'C 一停一跑' : 'A 同向在途'));
const counts = {}, uniq = new Map(), events = [];
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
      events.push({timeSec:r.s,...h});
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
// ── G10／G11 派車表沒有的中途停靠站（2026-10 起的平鎮臨時站 1105）────────────────────────────────────────────
// 立體地圖讓官方停靠這種站的班次停在原本那一段路徑上（motion.js 的 cuts），那裡沒有月台待避這回事。現行資料沒有這種站，
// 出貨鏈只有這裡跑得到：取一班真車 T 的一段站間，複製出 L（在該段實體路徑上插一個停 60 秒的陌生站，其後各站 +120 秒）與
// F（整班 +75 秒、不停陌生站），讓 F 在 L 停站時追上，逐秒量兩車車身有沒有共用股道，量到 L 抵達下一個正式站為止——兩班
// 複製車在那一站被派到同一股道，F 會照規則 (1) 從停站中的 L 旁邊越過，那是正式站的既有行為（上面 G5 的 C 類），不歸這裡管。
// 每條各有對照組：把受測的那一道防線換成改動前的行為，必須量到互穿，證明情境真的走到那條路徑。量測期間 T 移出名冊。
//   G10 防線 blockDwellOnLine：前車停在那裡是主線上的實體障礙，不能照規則 (1) 放行。陌生站放在實體路徑 45% 處往左 20 m。
//   G11 防線 blockSep3d：同一段 2D 車距不等於立體車距（L 在 2D 停在示意線的投影點、立體停在實體路徑的投影點）。陌生站
//       挑全網「示意線比例比實體比例前面最多」的一點（投影離示意線 50 m 內），F 照真實通過車帶著這一站（通過），兩班都用
//       自強 3000 編組（245.7 m）：2D 車距守在標準 400 m 時，立體車距短到不夠兩個半車長。
await page.evaluate(() => {
  window.__pinch = ({ T, I, U, f, fPass, carName, guard, fake }) => {
    const P = railIslandPhysical, s0 = T.stops, K = I + 1, run = s0[K].arrSec - s0[I].depSec;
    const uArr = Math.round(s0[I].depSec + run * f + 30), st = { name: '派車表沒有的測試停靠站', lat: U[1], lon: U[0] };
    const mk = (train, stops) => ({ ...T, train, stops, ...(carName && { carName }) });
    const L = mk('TEST-C2-L', [...s0.slice(0, K).map(x => ({ ...x })), { ...st, arrSec: uArr, depSec: uArr + 60, stop: true },
      ...s0.slice(K).map(x => ({ ...x, arrSec: x.arrSec + 120, depSec: x.depSec + 120 }))]);
    const fs = s0.map(x => ({ ...x, arrSec: x.arrSec + 75, depSec: x.depSec + 75 }));
    if (fPass) { const tp = Math.round(fs[I].depSec + run * f); fs.splice(K, 0, { ...st, arrSec: tp, depSec: tp, stop: false }); }
    const F = mk('TEST-C2-F', fs);
    assignSchedShapePathsFor([L, F], state.trackLines.filter(l => l.sys === 'tra_sched'));
    const rl = P.has(L) && P.record(L), rf = P.has(F) && P.record(F);
    if (!rl || !rf || !rl.cuts?.[I]?.some(x => x.k === K) || (fPass && !rf.stopIndexes))
      return { error: `合成車沒綁上實體股道或沒在陌生站切開（L=${!!rl} F=${!!rf}）` };
    const saved = state.trains, orig = window[guard];
    state.trains = saved.filter(x => x !== T).concat([L, F]);
    const go = real => {
      window[guard] = real ? orig : fake;
      __reset();
      const o = { lDwellU: 0, fHeld: 0, maxHoldF: 0, shared: 0, maxSharedM: 0 };
      for (let t = s0[I].depSec - 120; t < L.stops[K + 1].arrSec; t++) {
        __step(t);
        const pl = trainPos(L, t), pf = trainPos(F, t);
        if (!pl?.physical || !pf?.physical) continue;
        const hf = blockHoldSec(F);
        if (pl.dwell && pl.stopIndex === K) { o.lDwellU++; if (hf > .5) o.fHeld++; }
        if (hf > o.maxHoldF) o.maxHoldF = +hf.toFixed(1);
        const m = __sharedMetres(__occupancy(pl.route, pl.chainageM, __modelOf(L).lengthM), __occupancy(pf.route, pf.chainageM, __modelOf(F).lengthM)).m;
        if (m > .01) { o.shared++; o.maxSharedM = Math.max(o.maxSharedM, +m.toFixed(1)); }
      }
      return o;
    };
    let withFix, control;
    try { withFix = go(true); control = go(false); } finally { window[guard] = orig; state.trains = saved; __reset(); }
    return { T: String(T.train), seg: `${s0[I].name}→${s0[K].name}`, lenM: +__modelOf(L).lengthM.toFixed(1), withFix, control };
  };
});
const pinchMsg = r => r.error || `${r.T} 次 ${r.seg}${r.note || ''}：L 在陌生站停 ${r.withFix.lDwellU} 秒、其間 F 被擋 ${r.withFix.fHeld} 秒`
  + `（hold 最高 ${r.withFix.maxHoldF} 秒），兩車車身共用股道 ${r.withFix.shared} 秒；對照組 ${r.control.shared} 秒、最多共用 ${r.control.maxSharedM} m`;
const pinchOk = r => !r.error && r.withFix.lDwellU >= 55 && r.withFix.fHeld > 0 && r.withFix.shared === 0 && r.control.shared > 0;
const g10 = await page.evaluate(() => {
  const P = railIslandPhysical;
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched' || tr.loop || tr.stops._prevNight || !P.has(tr) || P.record(tr).stopIndexes) continue;
    const s = tr.stops, r = P.record(tr);
    for (let i = 1; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1];
      if (a.stop === false || b.stop === false || b.arrSec - a.depSec < 300 || a.depSec - a.arrSec > 40 || a.depSec < 36000 || a.depSec > 72000) continue;
      const path = P.geometry.unfold(String(r.plan.pathIds[i])).path;
      if (path.length < 3000) continue;
      const sU = path.length * .45, [pa, pb, pc] = [sU - 5, sU + 5, sU].map(x => path.at(x).coordinate), mx = 111320 * Math.cos(pc[1] * Math.PI / 180);
      const ex = (pb[0] - pa[0]) * mx, ny = (pb[1] - pa[1]) * 111320, nn = Math.hypot(ex, ny);
      return __pinch({ T: tr, I: i, U: [pc[0] - ny / nn * 20 / mx, pc[1] + ex / nn * 20 / 111320], f: .45, guard: 'blockDwellOnLine', fake: () => false });
    }
  }
  return { error: '找不到合用的站間' };
});
ok('G10 派車表沒有的中途停靠站：前車停在主線上時後車在後面等，不開進它的車身', pinchOk(g10), pinchMsg(g10));
const g11 = await page.evaluate(() => {
  const P = railIslandPhysical;
  let c = null;
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched' || tr.loop || tr.stops._prevNight || !P.has(tr) || P.record(tr).stopIndexes) continue;
    const s = tr.stops, r = P.record(tr);
    for (let i = 1; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1];
      if (a.stop === false || b.stop === false || b.arrSec - a.depSec < 300 || a.depSec - a.arrSec > 40 || a.depSec < 36000 || a.depSec > 72000 || !a.segLn || a.bridgeTo) continue;
      const path = P.geometry.unfold(String(r.plan.pathIds[i])).path;
      if (path.length < 3000) continue;
      for (let k = 5; k <= 15; k++) {
        const f = k / 20, q = path.at(path.length * f).coordinate, pr = projectOntoShape(a.segLn, q[1], q[0]);
        if (pr.d == null || pr.perpKm > .05) continue;
        const mis = ((pr.d - a.dA) / (a.dB - a.dA) - f) * path.length;
        if (!c || mis > c.mis) c = { tr, i, f, U: q, mis };
      }
    }
  }
  if (!c) return { error: '找不到合用的站間' };
  const res = __pinch({ T: c.tr, I: c.i, U: c.U, f: c.f, fPass: true, carName: '自強(3000)', guard: 'blockSep3d', fake: () => Infinity });
  return { ...res, note: `實體 ${Math.round(c.f * 100)}% 處（示意線比例前面 ${Math.round(c.mis)} m，編組 ${res.lenM} m）` };
});
ok('G11 派車表沒有的中途停靠站那一段：2D 車距縮水時照立體車距擋，後車不開進前車車身', pinchOk(g11) && g11.lenM > 240, pinchMsg(g11));
ok('G9 頁面沒有 JS 例外', errors.length === 0, errors.slice(0, 2).join(' | ') || '0');

console.log(`\n分類統計 A=${A}(撞上限 ${capped}) A′=${Ap} B=${B} C=${C}｜判準＝車身共用股道；數量採棘輪上限`);
const reportPath=process.env.REPORT || path.join(ROOT,'output/physical-no-overlap.json');
mkdirSync(path.dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify({serviceDate:setup.serviceDate,formationProbe:process.env.FORMATION_PROBE||'production',setup,step:STEP,sample:SAMPLE,samples,counts,events,results},null,2));
await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n合計 ${results.length - bad.length} PASS / ${bad.length} FAIL`);
process.exit(bad.length ? 1 : 0);

// 輕軌 GPS 逐車校正驗收
//
// 判準來源刻意與實作不同源(心得 29):真值＝TDX LivePosition 的原始經緯度,不是我們算出來的任何東西。
// 三個對照臂,同一份 GPS 快照評分:
//   off   = 新版但餵 src:null    ⇒ 純班表(校正完全不生效)
//   board = 基準版(HEAD)+真 LiveBoard ⇒ 今天正式站的行為
//   gps   = 新版 + 真 LivePosition   ⇒ 這批要上的東西
// 指標:每台 GPS 車 → 同方向最近的一台「畫面上的車」的沿線距離(公尺)。gps 臂沒有明顯優於
// board 臂,這個功能就不值得上。
//
// 🔴 時間留出法(hold-out):餵給頁面的是快照 A,評分卻一律用 90 秒後才抓的**獨立**快照 B。
//    逐班估計器的作法就是「解出讓模型正好落在 GPS 點上的位移」,若拿 A 評分就是拿它自己的目標
//    函數當判準,必然接近 0 公尺、零資訊(心得 29 同源陷阱)。用 B 才問得到真正的問題:
//    「這個校正撐得過一個輪詢間隔嗎?」——正式站的資料本來就最舊會差一個輪詢。
//
// 時間對齊:GPS 時戳落後 17–45 秒,所以模型一律在「該筆 GPS 自己的時刻」求值,不是在 now 求值。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ROOT 一律推導自本檔位置=「當前工作區」,不寫死任何暫存副本(心得 32:驗收腳本第一件事是確認驗的是誰)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(path.join(ROOT, 'node_modules/playwright/index.mjs'));
const PORT = Number(process.env.VPORT || 45871);

// ── Step 0:自檢驗的是誰(心得 32:驗收腳本第一道 gate 是「我在驗什麼」)
const md5 = f => execFileSync('md5', ['-q', f]).toString().trim();
console.log('驗證目標 ', ROOT + '/index.html', md5(ROOT + '/index.html'));
// 基準預設 HEAD(功能還沒 commit 的階段);功能一旦進了 HEAD 就要指到功能之前的 ref,
// 否則兩邊相同、下面那道 gate 會讓這支腳本從此再也跑不起來。VBASE=origin/main 即可。
const BASE = process.env.VBASE || 'HEAD';
const baseHtml = execFileSync('git', ['-C', ROOT, 'show', BASE + ':index.html'], { maxBuffer: 64 << 20 }).toString();
fs.writeFileSync(ROOT + '/baseline.html', baseHtml);
console.log(`基準(${BASE})`, md5(ROOT + '/baseline.html'), execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', BASE]).toString().trim());
if (md5(ROOT + '/index.html') === md5(ROOT + '/baseline.html')) { console.log('FAIL: 新版與基準相同=沒有改動,驗了也沒意義'); process.exit(1); }
const newSrc = fs.readFileSync(ROOT + '/index.html', 'utf8');
for (const need of ['applyKlrtPos', 'pollKlrtPos', 'klrtGpsLive', '_gpsShifts'])
  if (!newSrc.includes(need)) { console.log('FAIL: 新版缺少 ' + need); process.exit(1); }
if (baseHtml.includes('applyKlrtPos')) { console.log('FAIL: 基準版竟然已有 applyKlrtPos'); process.exit(1); }

// ── 取真值:TDX LivePosition(GPS)＋ LiveBoard(給 board 臂)
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const tk = (await (await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET }),
})).json()).access_token;
// 429 要退避重試:TDX 限流被誤讀成「對照組拿不到資料」會變成假 FAIL(環境條件偽裝成產品回歸)
const tdx = async (u, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(u, { headers: { authorization: 'Bearer ' + tk } });
    if (r.status === 200) return r.json();
    if (r.status !== 429) throw new Error(u.split('/').pop().split('?')[0] + ' → HTTP ' + r.status);
    await new Promise(s => setTimeout(s, 3000 * (i + 1)));
  }
  throw new Error(u.split('/').pop().split('?')[0] + ' → 429 重試耗盡');
};
// 🔴 C 線的營運代碼是 KLRT 不是 KRTC(worker 的 METRO_LIVE_OPS.krtc 是兩家一起抓);
//    只抓 KRTC 會讓 board 臂拿到 0 列、悄悄退化成純班表=無效對照組
const [live, bKrtc, bKlrt] = await Promise.all([
  tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LivePosition/KLRT?%24format=JSON'),
  tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/KRTC?%24top=5000&%24format=JSON'),
  tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/KLRT?%24top=5000&%24format=JSON'),
]);
const mapGps = live => (live.LivePositions || []).map(x => ({
  t: String(x.TripID), dir: x.Direction,
  lat: x.TrainPosition && x.TrainPosition.PositionLat, lon: x.TrainPosition && x.TrainPosition.PositionLon,
  sp: x.Speed, az: x.Azimuth, st: x.TrainStatus, gt: x.GPSTime,
})).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
const gpsRows = mapGps(live);
const bdRow = op => x => ({ l: x.LineID, s: (x.StationName && x.StationName.Zh_tw) || '', d: (x.DestinationStationName && x.DestinationStationName.Zh_tw) || '', e: x.EstimateTime, st: x.ServiceStatus, op });
const boardRows = [...(Array.isArray(bKrtc) ? bKrtc : []).map(bdRow('KRTC')), ...(Array.isArray(bKlrt) ? bKlrt : []).map(bdRow('KLRT'))];
const cBoard = boardRows.filter(r => r.op === 'KLRT').length;
console.log(`\n真值快照:GPS ${gpsRows.length} 台(dir0 ${gpsRows.filter(r => r.dir === 0).length} / dir1 ${gpsRows.filter(r => r.dir === 1).length})、LiveBoard 共 ${boardRows.length} 列(其中 C 線 ${cBoard} 列)`);
if (gpsRows.length < 6) { console.log('FAIL: GPS 台數過少,現在可能非營運時段,無法驗'); process.exit(1); }
if (cBoard < 5) { console.log('FAIL: board 對照臂拿不到 C 線看板列,對照組無效'); process.exit(1); }

// ── 留出快照 B:等一個輪詢間隔後另抓一份,只用來評分,絕不餵給頁面
const HOLD = Number(process.env.HOLD_SEC || 90);
console.log(`等 ${HOLD} 秒後抓留出快照 B(評分只用 B)...`);
await new Promise(r => setTimeout(r, HOLD * 1000));
const gpsEval = mapGps(await tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LivePosition/KLRT?%24format=JSON'));
const dt = (new Date(gpsEval[0].gt) - new Date(gpsRows[0].gt)) / 1000;
console.log(`留出快照 B:${gpsEval.length} 台,與 A 相隔 ${dt} 秒`);
if (gpsEval.length < 6 || dt < 45) { console.log('FAIL: 留出快照無效(台數不足或間隔太短)'); process.exit(1); }

// ── 靜態 server(乾淨 worktree;只服務檔案,API 一律由 page.route 供給)
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e, b) => e ? res.writeHead(404).end() : (res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }), res.end(b)));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();

// 🔴 LiveBoard 的 EstimateTime 是**相對倒數**,不是絕對時刻。原版在留出等待「之前」抓一次 board,
//    等 90 秒後才餵給頁面、還蓋上當下的 at 時戳 ⇒ 每個倒數都憑空多了 90 秒以上(而且逐臂累加),
//    board 對照臂被系統性灌上約 90 秒懲罰(≒1500 公尺),整組比較對 gps 臂有利。
//    改成每一臂開跑前重抓 ⇒ 每臂的 board 新鮮度都與正式站相當。
async function freshBoard() {
  const [k, l] = await Promise.all([
    tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/KRTC?%24top=5000&%24format=JSON'),
    tdx('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/KLRT?%24top=5000&%24format=JSON'),
  ]);
  const rows = [...(Array.isArray(k) ? k : []).map(bdRow('KRTC')), ...(Array.isArray(l) ? l : []).map(bdRow('KLRT'))];
  const c = rows.filter(r => r.op === 'KLRT').length;
  if (c < 5) throw new Error('board 重抓後 C 線只有 ' + c + ' 列,對照組無效');
  return rows;
}

// arm: { page:'index.html'|'baseline.html', klrt:'real'|'null'|'500', metro:boolean }
async function runArm(name, arm) {
  const armBoard = arm.metro ? await freshBoard() : [];      // 每臂各自新鮮,不用留出前那份
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const hits = { klrt: 0, metro: 0 };
  await page.route('**/api/klrt-position*', async r => {
    hits.klrt++;
    if (arm.klrt === '500') return r.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    if (arm.klrt === 'null') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ at: new Date().toISOString(), src: null, rows: [] }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ at: new Date().toISOString(), src: 'tdx', rows: gpsRows }) });
  });
  await page.route('**/api/metro-live*', async r => {
    hits.metro++;
    if (!arm.metro) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ at: new Date().toISOString(), rows: armBoard }) });
  });
  for (const p of ['**/api/metro-alert*', '**/api/hazard-alert*', '**/api/plus-status*', '**/api/bounty-board*', '**/api/today-board*', '**/api/trtc-live*', '**/api/ntmetro-live*'])
    await page.route(p, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

  await page.goto(`http://127.0.0.1:${PORT}/${arm.page}?sys=krtc`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const c = document.getElementById('count'); return c && c.textContent.trim().length > 0; }, null, { timeout: 90000 });
  // 健全性閘門(心得:對照組沒有閘門就是無聲的假綠)
  const sane = await page.evaluate(() => ({ hidden: document.hidden, hasC: !!metroLivePool().find(l => freqSysIdOf(l) === 'krtc' && l.id === 'C' && l._tt && l._tt.length) }));
  if (sane.hidden) throw new Error(name + ': document.hidden=true,輪詢閘門不會開');
  if (!sane.hasC) throw new Error(name + ': C 線班表沒備妥');

  // 等 shift 收斂到目標。🔴 前一版這道閘門在「還沒收到校正」時 tgt=cur=0 就直接通過,量到的是
  //    easedShift 爬到一半的狀態(上升受 sim 前進速度鉗制,+46s 要爬 46 秒真實時間)。
  //    ⇒ 期望有校正的臂必須先等到 _liveShift 真的到位,再等 cur 追上 tgt;期望沒校正的臂則要
  //      反過來斷言「等了還是沒有」——兩側都驗,不然閘門只是裝飾。
  const wantShift = arm.klrt === 'real' || arm.metro;
  const wantSrc = arm.klrt === 'real' ? 'klrt' : (arm.metro ? undefined : null);
  const conv = await page.waitForFunction(want => {
    const ln = metroLivePool().find(l => freqSysIdOf(l) === 'krtc' && l.id === 'C');
    if (!ln) return false;
    const on = !!(ln._liveShift && metroLiveOn(ln));
    if (want && !on) return false;                       // 還沒收到校正:繼續等,不准當「已收斂於 0」
    const tgt = on ? (ln._liveShift.all || 0) : 0;
    const cur = metroShiftSec(ln, ln._tt[0]);
    return Math.abs(cur - tgt) <= 2 ? { tgt, cur: Math.round(cur * 10) / 10, on, src: on ? ln._liveShift.src : null, n: on ? ln._liveShift.n : 0 } : false;
  }, wantShift, { timeout: 200000, polling: 500 }).then(h => h.jsonValue()).catch(() => null);
  if (wantShift && !conv) throw new Error(name + ': 等不到校正收斂(期望這一臂要有校正)');
  if (!wantShift) { // 反向:這一臂本來就不該有校正,若冒出來代表對照組被汙染
    const leaked = await page.evaluate(() => { const ln = metroLivePool().find(l => freqSysIdOf(l) === 'krtc' && l.id === 'C'); return !!(ln && ln._liveShift); });
    if (leaked) throw new Error(name + ': 對照臂不該有 _liveShift 卻有了');
  }

  const res = await page.evaluate(gps => {   // gps = 留出快照 B
    const ln = metroLivePool().find(l => freqSysIdOf(l) === 'krtc' && l.id === 'C');
    const n = ln.stations.length, L = ln.loopLen || ln.cum[ln.cum.length - 1];
    const gtSec = s => { const m = String(s).match(/(\d{2}):(\d{2}):(\d{2})/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null; };
    const trDir = tr => ((((tr[2] - tr[0]) % n) + n) % n) === 1 ? 1 : -1;
    const wrap = d => { const x = ((d % L) + L) % L; return Math.min(x, L - x); };
    // 有號差:沿「行進方向」為正 ⇒ 正=畫面上的車跑在 GPS 前面(畫太前),負=落後。
    // 絕對值會把一致偏差與隨機散開混成同一個數字,分不出「可用單一 shift 修好」與「修不掉」。
    const signed = (mdD, gdD, dir) => { let x = ((mdD - gdD) % L + L) % L; if (x > L / 2) x -= L; return dir > 0 ? x : -x; };
    const out = [];
    for (const want of [1, -1]) {
      const gs = gps.filter(g => (g.dir === 0 ? 1 : -1) === want).map(g => ({ g, t: gtSec(g.gt), p: projectOntoShape(ln, g.lat, g.lon) }))
        .filter(o => o.t != null && o.p.perpKm <= 0.2);
      const cands = ln._tt.filter(tr => trDir(tr) === want);
      const used = new Set();
      // 一對一貪婪配對:先把所有 (GPS, 班次) 距離排序,近的先配,配過的不再用
      const all = [];
      for (const o of gs) for (const tr of cands) {
        const pos = freqTrainPosAt(ln, tr, o.t); if (!pos) continue;  // 名冊來自班表:未發車/已到終點=沒有這台車
        const md = projectOntoShape(ln, pos.lat, pos.lon);
        all.push({ o, tr, d: wrap(md.d - o.p.d), s: signed(md.d, o.p.d, want) });
      }
      all.sort((a, b) => a.d - b.d);
      const done = new Set();
      for (const c of all) {
        if (done.has(c.o) || used.has(c.tr)) continue;
        done.add(c.o); used.add(c.tr);
        out.push({ dir: want, m: Math.round(c.d * 1000), sg: Math.round(c.s * 1000), perp: Math.round(c.o.p.perpKm * 1000) });
      }
      for (const o of gs) if (!done.has(o)) out.push({ dir: want, m: null, sg: null, unmatched: true });
    }
    // 神諭掃描:直接用「未套校正」的 freqTrainPosRaw(ln, tr, t - s) 掃 s,找真正讓誤差最小的位移。
    // 判準完全不經任何 _liveShift、不經 easedShift ⇒ 與受測的估計器零共用假設(心得 29)。
    // 各臂算出來的神諭應該一模一樣(同一份班表+同一份 GPS),不一樣就是這支腳本自己有問題。
    const errAt = s => {
      const es = [];
      for (const want of [1, -1]) {
        const gs = gps.filter(g => (g.dir === 0 ? 1 : -1) === want).map(g => ({ t: gtSec(g.gt), p: projectOntoShape(ln, g.lat, g.lon) })).filter(o => o.t != null && o.p.perpKm <= 0.2);
        const cands = ln._tt.filter(tr => trDir(tr) === want);
        const all = [];
        for (const o of gs) for (const tr of cands) {
          const pos = freqTrainPosRaw(ln, tr, o.t - s); if (!pos) continue;
          all.push({ o, tr, d: wrap(projectOntoShape(ln, pos.lat, pos.lon).d - o.p.d) });
        }
        all.sort((a, b) => a.d - b.d);
        const done = new Set(), used = new Set();
        for (const c of all) { if (done.has(c.o) || used.has(c.tr)) continue; done.add(c.o); used.add(c.tr); es.push(c.d * 1000); }
      }
      if (!es.length) return null;
      const so = es.sort((a, b) => a - b);
      return Math.round(so[so.length >> 1]);
    };
    let oracle = null;
    for (let s = -120; s <= 300; s += 5) { const e = errAt(s); if (e != null && (!oracle || e < oracle.err)) oracle = { s, err: e }; }
    const curve = [0, 30, 45, 60, 75, 90, 105, 120].map(s => s + 's=' + errAt(s) + 'm').join(' ');
    const active = ln._tt.filter(tr => freqTrainPosAt(ln, tr, nowSecOfDay())).length;
    return { pairs: out, active, oracle, curve, shift: ln._liveShift ? { ...ln._liveShift } : null, liveOn: metroLiveOn(ln), fresh: metroFresh(ln), applied: Math.round(metroShiftSec(ln, ln._tt[0]) * 10) / 10 };
  }, gpsEval);

  await ctx.close();
  return { name, ...res, conv, hits, errs };
}

const stat = a => { a = a.filter(x => x != null); if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y); return { n: a.length, med: s[s.length >> 1], p90: s[Math.min(s.length - 1, Math.floor(.9 * s.length))], max: s[s.length - 1] }; };
const sstat = a => { a = a.filter(x => x != null); if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y); return { n: a.length, 中位: s[s.length >> 1], 平均: Math.round(a.reduce((p, c) => p + c, 0) / a.length), 最小: s[0], 最大: s[s.length - 1] }; };
// metro:true = 連 LiveBoard 一起餵(正式站真實條件)。gps 臂維持 metro:true 才驗得到
// 「C 線的逐線 LiveBoard 校正真的被擋掉了」——擋不掉的話 src 會變成 undefined 而不是 klrt。
// dead 臂則要驗反向:GPS 掛掉時 C 線要退回 LiveBoard,不能整個掉成沒校正。
const arms = [
  ['off  (純班表)', { page: 'index.html', klrt: 'null', metro: false }],
  ['board(現行正式站)', { page: 'baseline.html', klrt: 'null', metro: true }],
  ['gps  (本批新做)', { page: 'index.html', klrt: 'real', metro: true }],
  ['dead (GPS 掛,退 LiveBoard)', { page: 'index.html', klrt: '500', metro: true }],
];
const results = [];
for (const [name, arm] of arms) {
  try { const r = await runArm(name, arm); results.push(r); }
  catch (e) { console.log(`\n${name}  ERROR ${e.message}`); results.push({ name, error: e.message }); }
}
console.log('\n════ 對 GPS 原始經緯度的沿線誤差(公尺) ════');
for (const r of results) {
  if (r.error) { console.log(`${r.name.padEnd(20)} ERROR ${r.error}`); continue; }
  const unm = r.pairs.filter(p => p.unmatched).length;
  console.log(`${r.name.padEnd(20)} 絕對值 ${JSON.stringify(stat(r.pairs.map(p => p.m)))}`);
  console.log(`${''.padEnd(20)} 有號(正=畫太前) ${JSON.stringify(sstat(r.pairs.map(p => p.sg)))}`);
  console.log(`${''.padEnd(20)} 順向 ${JSON.stringify(sstat(r.pairs.filter(p => p.dir > 0).map(p => p.sg)))}  逆向 ${JSON.stringify(sstat(r.pairs.filter(p => p.dir < 0).map(p => p.sg)))}`);
  console.log(`${''.padEnd(20)} 在線車數=${r.active} 未配對=${unm} shift=${r.shift ? `${r.shift.all}s src=${r.shift.src} n=${r.shift.n}` : '(無)'} 實際套用=${r.applied}s liveOn=${r.liveOn} fresh=${r.fresh}`);
  console.log(`${''.padEnd(20)} 神諭最佳位移=${r.oracle ? r.oracle.s + 's → ' + r.oracle.err + 'm' : 'n/a'}   誤差曲線 ${r.curve}`);
  console.log(`${''.padEnd(20)} 收斂=${JSON.stringify(r.conv)} 命中=${JSON.stringify(r.hits)} err=${r.errs.length}`);
}
srv.close(); await browser.close();
fs.unlinkSync(ROOT + '/baseline.html');

// ════════ 具名斷言 ════════
// 🔴 原版到上面就結束了:四臂全部 ERROR、gps 根本沒生效、gps 比 board 還差,通通 exit 0。
//    「印在輸出裡」不是 gate——會看的人只有當下在看的人。以下每一條都要有名字、都要能讓它紅。
const checks = [];
// soft=true：既存問題哨兵——會印 FAIL、但不擋這批（這批沒把它弄糟就不該被它擋住）
const chk = (name, ok, detail, soft) => { checks.push({ name, ok: !!ok, detail, soft: !!soft }); };
const R = n => results.find(r => r.name.startsWith(n));
const med = r => { const a = r.pairs.map(p => p.m).filter(x => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };

chk('四個對照臂全部跑完（沒有 ERROR）', results.every(r => !r.error),
  results.filter(r => r.error).map(r => r.name + ':' + r.error).join(' / '));

if (results.every(r => !r.error)) {
  const off = R('off'), board = R('board'), gps = R('gps'), dead = R('dead');

  chk('gps 臂真的吃到 GPS（src=klrt）', gps.shift && gps.shift.src === 'klrt',
    'src=' + (gps.shift && gps.shift.src));
  chk('board 臂沒有誤吃 GPS', !(board.shift && board.shift.src === 'klrt'),
    'src=' + (board.shift && board.shift.src));
  chk('dead 臂（GPS 掛）退回 LiveBoard、不是退成沒校正',
    dead.shift && dead.shift.src !== 'klrt' && dead.liveOn && Math.abs(dead.applied) > 0,
    'src=' + (dead.shift && dead.shift.src) + ' applied=' + dead.applied + 's liveOn=' + dead.liveOn);
  chk('off 臂真的沒有校正（對照組有效）', !off.liveOn && off.applied === 0,
    'liveOn=' + off.liveOn + ' applied=' + off.applied);

  // 名冊不變式:四臂在線車數必須一致——校正只該動位置,不該讓車冒出來或不見
  const acts = results.map(r => r.active);
  chk('名冊不變式:四臂在線車數一致（校正不得增減列車）', new Set(acts).size === 1,
    '各臂在線車數 ' + acts.join('/'));
  // 未配對＝GPS 說有這台車、但畫面上同方向找不到對應。這支腳本是**回歸閘門**,問的是
  // 「這批有沒有把事情弄糟」,所以判準是「不比基準版差」。絕對值若 >0 是既存問題
  // (班表名冊比實際少車),要另案處理——但那不是這批造成的,不該擋這批。
  const baseUnm = board.pairs.filter(p => p.unmatched).length;   // board 臂＝基準版(baseline.html)
  chk('未配對數不比基準版差（回歸閘門）', gps.pairs.filter(p => p.unmatched).length <= baseUnm,
    'gps ' + gps.pairs.filter(p => p.unmatched).length + ' vs 基準 ' + baseUnm);
  chk('⚠️ 既存問題哨兵:未配對=0（紅了不擋這批,但要記錄）', baseUnm === 0,
    'GPS 回報 ' + gpsEval.length + ' 台、畫面 ' + gps.active + ' 台,同方向配不到的有 ' + baseUnm + ' 台', true);
  chk('零 pageerror', results.every(r => r.errs.length === 0),
    results.map(r => r.name.trim() + ':' + r.errs.length).join(' '));
  chk('每臂都真的被打過對應的 API', results.every(r => r.hits.metro > 0) && gps.hits.klrt > 0,
    results.map(r => r.name.trim() + ' klrt=' + r.hits.klrt + ' metro=' + r.hits.metro).join(' | '));

  // 🔴 效果斷言——這才是這批要不要上的判準。沒有這條,功能整個失效也會全綠。
  const mg = med(gps), mb = med(board), mo = med(off);
  chk('效果:gps 中位誤差優於現行 LiveBoard', mg != null && mb != null && mg < mb,
    `gps ${mg}m vs board ${mb}m`);
  chk('效果:gps 中位誤差優於純班表（有校正比沒校正好）', mg != null && mo != null && mg < mo,
    `gps ${mg}m vs off ${mo}m`);
  // 神諭是「任何線級位移的理論最佳」。逐班的價值就在能突破它;突破不了就不值得多這套機制。
  const orc = gps.oracle && gps.oracle.err;
  chk('效果:gps 突破線級位移的理論最佳（神諭）', orc == null || (mg != null && mg < orc),
    `gps ${mg}m vs 神諭 ${orc}m`);
}

console.log('\n════ 判定 ════');
for (const c of checks) console.log(`${c.ok ? 'PASS' : (c.soft ? 'WARN' : 'FAIL')}  ${c.name}${c.detail ? '   〔' + c.detail + '〕' : ''}`);
const bad = checks.filter(c => !c.ok && !c.soft).length;
const warn = checks.filter(c => !c.ok && c.soft).length;
console.log(`\n總計 ${checks.length} 項,FAIL ${bad} 項,WARN(既存問題,不擋這批) ${warn} 項`);
process.exit(bad ? 1 : 0);

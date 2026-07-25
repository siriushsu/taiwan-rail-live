// 回放原型：拿 D1 的逐站觀測（service_date=2026-07-24）還原列車當日真實位置，
// 與同一車次的表定版並排跑，量「差多少、順不順、能不能看」。
// 跑法：node proto_replay.mjs [base]      預設 base=http://127.0.0.1:5178
//
// 還原法：班表的結構（哪些站、停不停、線形投影）＋紀錄的逐站誤點（每站把 arr/dep 往後平移）。
// 刻意不用 obs_at 當時刻——那是觀測時刻（受上游刷新間隔量化），TDX 自報的 delay 才與表定同基準。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const SP = '/private/tmp/claude-501/-Users-xuxiang-Code------/9806cec5-61fe-410f-b75a-9046662eec7b/scratchpad';
const EVENTS = JSON.parse(readFileSync(SP + '/ev0724.json', 'utf8'))[0].results;
console.log(`載入 ${EVENTS.length} 列觀測事件（2026-07-24）`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });

// ── 注入回放列車 ──
const built = await page.evaluate(events => {
  const idToName = {};
  for (const [name, v] of Object.entries(state.stnInfoMap || {})) if (v && v.id) idToName[v.id] = name;

  const byTrain = {};
  for (const e of events) (byTrain[e.train_no] = byTrain[e.train_no] || []).push(e);

  const out = [];
  for (const [no, evs] of Object.entries(byTrain)) {
    const orig = state.trains.find(t => String(t.train) === no && t.sys === 'tra_sched');
    if (!orig) { out.push({ no, ok: false, why: '今天沒有這個車次（平日限定／改點）' }); continue; }

    // 站名 → 觀測誤點（分）。同站多筆取最後一筆（PK 已按 status 去重，同站最多一兩筆）
    const dByName = new Map();
    for (const e of evs) { const n = idToName[e.sta]; if (n) dByName.set(n, e.delay); }

    // 逐站填誤點：有觀測用觀測，沒觀測的在前後已知值之間線性內插；頭尾用最近已知值延伸
    const s = orig.stops, known = s.map(st => (dByName.has(st.name) ? dByName.get(st.name) : null));
    const idx = known.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
    if (!idx.length) { out.push({ no, ok: false, why: '觀測站名對不上班表停靠站' }); continue; }
    const dly = known.slice();
    for (let i = 0; i < s.length; i++) {
      if (dly[i] != null) continue;
      const prev = idx.filter(j => j < i).pop(), next = idx.find(j => j > i);
      if (prev == null && next != null) dly[i] = dly[next];
      else if (next == null && prev != null) dly[i] = dly[prev];
      else if (prev != null && next != null) {
        const f = (i - prev) / (next - prev);
        dly[i] = dly[prev] + (dly[next] - dly[prev]) * f;
      } else dly[i] = 0;
    }

    // 離群值先殺：只砍「與前後兩站都差 >10 分」的孤點（1237 有 126→82→126 這種明顯錯報），
    // 真實的爬升趨勢（0→17→20→24）不會被動到。
    let outliers = 0;
    for (let i = 1; i < dly.length - 1; i++) {
      const a = dly[i - 1], b = dly[i], c = dly[i + 1];
      if (Math.abs(b - a) > 10 && Math.abs(b - c) > 10 && Math.sign(b - a) === Math.sign(b - c)) {
        dly[i] = (a + c) / 2; outliers++;
      }
    }

    // 平移時刻，再套物理下限。下限不是「表定跑時的某個比例」——真實列車確實能追回時間
    // （表定含餘裕），拿表定當下限會把合理的回收硬壓成失真。改用該車種的極速與加減速算
    // 「這段最快可能跑幾秒」：長段=加速+巡航+減速，短段=加速到峰值就減速。
    const perf = resolvePerf(orig);
    const tMinOf = km => {
      const L = km * 1000, a = perf.a / 3.6, b = perf.b / 3.6, v = perf.v / 3.6;
      if (!(L > 0)) return 0;
      const dAcc = v * v / (2 * a), dDec = v * v / (2 * b);
      return L >= dAcc + dDec ? L / v + v / (2 * a) + v / (2 * b) : Math.sqrt(2 * L * (1 / a + 1 / b));
    };
    let clamped = 0, fudgeSec = 0;
    const stops = s.map((st, i) => Object.assign({}, st, {
      arrSec: st.arrSec + Math.round(dly[i] * 60), depSec: st.depSec + Math.round(dly[i] * 60),
    }));
    // 下限套在「真停靠站之間的整個跑段」——通過站是巡航經過，不該被當成起停一次
    // （對自強這種一路通過小站的車，逐段套起停下限會把 100+ 段全部誤判成超速）。
    const isStop = i => i === 0 || i === s.length - 1 || s[i].stop !== false;
    let prevStop = 0;
    for (let i = 1; i < stops.length; i++) {
      if (!isStop(i)) continue;
      let runKm = 0;
      for (let j = prevStop; j < i; j++) runKm += schedSegKmOf(s, j);
      const min = stops[prevStop].depSec + Math.max(20, Math.ceil(tMinOf(runKm)));
      if (stops[i].arrSec < min) { fudgeSec += min - stops[i].arrSec; stops[i].arrSec = min; clamped++; }
      if (stops[i].depSec < stops[i].arrSec) stops[i].depSec = stops[i].arrSec; // 回收優先吃掉停站時間
      prevStop = i;
    }

    // 時刻改了就必須重跑跑段曲線：rp/rpDep/rpOff/rpSegKm 是蓋在 stop 物件上的快取，
    // 沿用舊的會讓 segProg 的 runT=(新 depSec − 舊 rpDep) 爆掉 → 列車站在段末不動、換段瞬移。
    for (const st of stops) { st.rp = null; st.rpDep = st.rpOff = st.rpSegKm = undefined; }
    assignRunProfiles(stops, resolvePerf(orig));

    const clone = Object.assign({}, orig, { train: no + 'R', stops, color: '#c0392b', _replay: true });
    state.trains.push(clone);
    out.push({ no, ok: true, stations: s.length, observed: idx.length, clamped, outliers, fudgeSec,
               d0: Math.round(dly[0]), dMax: Math.round(Math.max(...dly)), dEnd: Math.round(dly[dly.length - 1]),
               curve: dly.map(v => Math.round(v)),
               schedStart: s[0].arrSec, schedEnd: s[s.length - 1].depSec,
               replayEnd: stops[stops.length - 1].depSec, typeName: orig.typeName });
  }
  return out;
}, EVENTS);

console.log('\n── 還原結果 ──');
for (const b of built) {
  if (!b.ok) { console.log(`  ✗ ${b.no}：${b.why}`); continue; }
  const hm = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  console.log(`  ✓ ${b.no}（${b.typeName}）${b.stations} 停靠站／${b.observed} 站有觀測，誤點 ${b.d0}→峰 ${b.dMax}→終 ${b.dEnd} 分`);
  console.log(`      表定 ${hm(b.schedStart)}–${hm(b.schedEnd)}　還原終點 ${hm(b.replayEnd)}　` +
    `物理下限修正 ${b.clamped} 段（共 ${b.fudgeSec}s＝${(b.fudgeSec / 60).toFixed(1)} 分）　離群點剔除 ${b.outliers}`);
  console.log(`      逐站誤點曲線：${b.curve.join(' ')}`);
}

// ── 量測：同一時刻，表定版與還原版差多少 ──
const ok = built.filter(b => b.ok);
const measure = await page.evaluate(nos => {
  const R = [];
  for (const no of nos) {
    const a = state.trains.find(t => String(t.train) === no && !t._replay);
    const b = state.trains.find(t => String(t.train) === no + 'R');
    if (!a || !b) continue;
    const span = [];
    for (let t = a.stops[0].arrSec; t <= b.stops[b.stops.length - 1].depSec; t += 600) {
      const pa = trainPos(a, t), pb = trainPos(b, t);
      span.push({ t, ga: !!pa, gb: !!pb, km: pa && pb ? +haversineKm(pa, pb).toFixed(2) : null });
    }
    R.push({ no, span });
  }
  return R;
}, ok.map(b => b.no));

console.log('\n── 表定 vs 還原：同一時刻的位置差（每 10 分取樣）──');
for (const m of measure) {
  const hm = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  const withKm = m.span.filter(x => x.km != null);
  const maxKm = withKm.length ? Math.max(...withKm.map(x => x.km)) : 0;
  const onlyReplay = m.span.filter(x => x.gb && !x.ga).length;
  console.log(`  ${m.no}：最大差距 ${maxKm} km；表定已到站但紀錄還在路上的取樣點 ${onlyReplay} 個`);
  console.log('      ' + withKm.filter((_, i) => i % 2 === 0).map(x => `${hm(x.t)} ${x.km}km`).join('  '));
}

// ── 平順度：逐台每 2 秒取樣，並定位最糟的跳躍發生在哪兩站之間（不把超標值當噪音）──
const smooth = await page.evaluate(nos => {
  const R = [];
  // 對照組：同一車次的「表定版」用完全一樣的取樣法量一遍——若表定版也跳，就不是回放造成的
  for (const no of nos.flatMap(n => [n + 'R', n])) {
    const b = state.trains.find(t => String(t.train) === no);
    if (!b) continue;
    const t0 = b.stops[0].arrSec, t1 = b.stops[b.stops.length - 1].depSec;
    const pts = [];
    for (let t = t0; t <= t1; t += 2) { const p = trainPos(b, t); if (p) pts.push({ t, p }); }
    const spd = [];
    for (let i = 1; i < pts.length; i++)
      spd.push({ t: pts[i].t, v: haversineKm(pts[i - 1].p, pts[i].p) / ((pts[i].t - pts[i - 1].t) / 3600) });
    const sorted = spd.map(x => x.v).sort((x, y) => x - y);
    const q = f => +sorted[Math.floor(f * (sorted.length - 1))].toFixed(1);
    const worst = spd.slice().sort((x, y) => y.v - x.v)[0];
    // 最糟跳躍落在哪兩個停靠站之間？把該時刻前後的 stop 找出來看時刻是否被壓縮
    let ctx = null;
    if (worst) {
      const s = b.stops, base = state.trains.find(t => String(t.train) === no.replace(/R$/, '') && !t._replay);
      const o = (base || b).stops;
      for (let i = 1; i < s.length; i++) if (worst.t >= s[i - 1].depSec && worst.t <= s[i].arrSec) {
        ctx = { from: s[i - 1].name, to: s[i].name,
                replaySec: s[i].arrSec - s[i - 1].depSec, schedSec: o[i].arrSec - o[i - 1].depSec };
        break;
      }
    }
    R.push({ no, replay: !!b._replay, loop: !!b.loop, loopSec: b.loopSec || null, samples: spd.length, max: q(1), p99: q(0.99),
             median: q(0.5), zero: sorted.filter(v => v < 0.5).length, over200: sorted.filter(v => v > 200).length,
             worstAt: worst ? worst.t : null, worstV: worst ? Math.round(worst.v) : null, ctx });
  }
  return R;
}, ok.map(b => b.no));
console.log('\n── 還原版速度曲線（每 2 秒取樣）──');
for (const s of smooth) {
  const hm = x => String(Math.floor(x / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(x / 60) % 60).padStart(2, '0');
  console.log(`  ${s.no}${s.loop ? '（環島 loop，loopSec=' + s.loopSec + '）' : ''}：中位 ${s.median} p99 ${s.p99} 最大 ${s.max} km/h　` +
    `靜止 ${s.zero} 點　>200km/h 鬼跳 ${s.over200} 個`);
  if (s.over200) console.log(`      最糟 ${s.worstV} km/h @ ${hm(s.worstAt)}` +
    (s.ctx ? `，${s.ctx.from}→${s.ctx.to}：還原給 ${s.ctx.replaySec}s／表定 ${s.ctx.schedSec}s` : '（不在跑段內＝落在停站區間）'));
}

// ── 截圖：挑差距最大的時刻，把兩台車框進畫面 ──
// 挑「全部車次裡差距最大」的那一刻（不是第一台車的最大值——那可能是最無趣的一台）
let best = null, bestNo = null;
for (const m of measure) for (const x of m.span) if (x.km != null && (!best || x.km > best.km)) { best = x; bestNo = m.no; }
if (best) {
  await page.evaluate(({ t, no }) => {
    state.playing = false;
    setSimSec(t);
    const a = state.trains.find(x => String(x.train) === no && !x._replay);
    const b = state.trains.find(x => String(x.train) === no + 'R');
    const pa = trainPos(a, t), pb = trainPos(b, t);
    map.fitBounds(L.latLngBounds([[pa.lat, pa.lon], [pb.lat, pb.lon]]), { padding: [90, 90], animate: false });
  }, { t: best.t, no: bestNo });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SP + '/replay_gap.png' });
  const hm = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  console.log(`\n截圖：${bestNo} 在 ${hm(best.t)} 的表定 vs 還原（差 ${best.km} km）→ ${SP}/replay_gap.png`);
  writeFileSync(SP + '/replay_report.json', JSON.stringify({ built, measure, smooth, shotAt: best }, null, 2));
}

// ── 運行圖：距離(沿線里程) × 時間，表定 vs 還原並排。判「還原合不合理」最直接的圖 ──
const diag = await page.evaluate(no => {
  const series = {};
  for (const key of [no, no + 'R']) {
    const tr = state.trains.find(t => String(t.train) === key);
    if (!tr) continue;
    const pts = [];
    let cum = 0, prev = null;
    for (let t = tr.stops[0].arrSec; t <= tr.stops[tr.stops.length - 1].depSec; t += 30) {
      const p = trainPos(tr, t);
      if (!p) continue;
      if (prev) cum += haversineKm(prev, p);
      prev = p;
      pts.push([t, +cum.toFixed(3)]);
    }
    series[key] = pts;
  }
  return series;
}, ok.find(b => b.dMax > 30) ? ok.find(b => b.dMax > 30).no : ok[0].no);

{
  const keys = Object.keys(diag);
  const all = keys.flatMap(k => diag[k]);
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  const kmMax = Math.max(...all.map(p => p[1]));
  const W = 900, H = 460, L = 64, B = 44;
  const X = t => L + (t - t0) / (t1 - t0) * (W - L - 20);
  const Y = km => H - B - km / kmMax * (H - B - 24);
  const hm = s => String(Math.floor(s / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  const path = k => diag[k].map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  const ticks = [];
  for (let t = Math.ceil(t0 / 1800) * 1800; t <= t1; t += 1800)
    ticks.push(`<line x1="${X(t)}" y1="24" x2="${X(t)}" y2="${H - B}" stroke="#e6e0d4"/>` +
      `<text x="${X(t)}" y="${H - B + 16}" font-size="11" fill="#7b7365" text-anchor="middle">${hm(t)}</text>`);
  const kmTicks = [];
  for (let km = 0; km <= kmMax; km += 50)
    kmTicks.push(`<line x1="${L}" y1="${Y(km)}" x2="${W - 20}" y2="${Y(km)}" stroke="#efeade"/>` +
      `<text x="${L - 8}" y="${Y(km) + 4}" font-size="11" fill="#7b7365" text-anchor="end">${km}km</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="-apple-system,PingFang TC,sans-serif">
<rect width="${W}" height="${H}" fill="#faf7f0"/>${kmTicks.join('')}${ticks.join('')}
<path d="${path(keys.find(k => !k.endsWith('R')))}" fill="none" stroke="#1f3864" stroke-width="2"/>
<path d="${path(keys.find(k => k.endsWith('R')))}" fill="none" stroke="#c0392b" stroke-width="2.4"/>
<text x="${L}" y="17" font-size="13" font-weight="700" fill="#1f3864">車次 ${keys[0]} · 2026-07-24 運行圖
<tspan fill="#1f3864">━ 表定</tspan>　<tspan fill="#c0392b">━ 依當日紀錄還原</tspan></text></svg>`;
  writeFileSync(SP + '/replay_diagram.svg', svg);
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: W, height: H });
  await p2.goto('file://' + SP + '/replay_diagram.svg');
  await p2.screenshot({ path: SP + '/replay_diagram.png' });
  await p2.close();
  console.log(`運行圖：${SP}/replay_diagram.png（${keys.join(' vs ')}，全程 ${kmMax.toFixed(0)}km）`);
}

await ctx.close(); await browser.close();

#!/usr/bin/env node

/**
 * 高雄輕軌(C 線)逐車 GPS → 捷運／輕軌共用梯形的 a / b 校正。
 *
 * 原料:launchd `tw.railisland.klrt-coverage` 每 60 秒一筆的快照 JSONL(主樹 tmp/klrt-coverage/data/,
 * 未進版控)。每筆快照含當下所有在線車的 { t, dir, lat, lon, sp, st, gt }。
 *
 * 🔴 為什麼不是「逐趟解加速曲線」:60 秒一筆 ⇒ 一趟起步(0→巡航約 15 秒)平均只會被取樣到 0～1 次,
 * 單趟看不出加速過程。改為把所有筆數投影到環狀線形上、換算成「離開前站多遠 / 距下一站多遠」,
 * 全部疊成同一條 v(s) 剖面再解 a、b —— 每一筆都是 v(s) 上的一個獨立樣本,不需要知道發車時刻。
 *
 * ⚠️ GPS 時戳落後 17–45 秒(見 scripts/verify_klrt_gps.mjs)對本法【無害】:我們用的是
 * 同一筆裡成對的「位置與速度」,不對時間做微分,時戳只拿來去重。
 *
 * 用法:
 *   node scripts/calibrate_klrt_accel.mjs --data <快照目錄>   逐筆校正並印報告
 *   node scripts/calibrate_klrt_accel.mjs --selftest         以已知 a/b 的合成資料驗估計量
 *   選用:--json <輸出檔>  --off <離線形上限公尺,預設 60>  --bin <分箱公尺,預設 10>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KMH = 3.6;                    // m/s → km/h
const BIN_MAX_M = 500;              // 只看站前後 500 公尺;再遠就是巡航或號誌區
const MIN_BIN_N = 30;               // 樣本太少的分箱不進擬合
const OFF_DEFAULT_M = 60;           // 離線形超過此距離視為機廠／雜訊,丟棄
const Q_ENVELOPE = 0.50;            // a_i 取第幾分位當估計值。由 --selftest 以已知真值校過:
                                    // 視窗收在巡航起點之前後,窗內幾乎全是加速中的樣本,雜訊對稱
                                    // ⇒ 中位數才是無偏的,p90 會高估約 7%(見自檢輸出的分位階梯)

// ── CLI
const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (argv.includes('--' + name) ? true : dflt);
};

// ── 幾何:把經緯度投影到 C 線環狀線形 ────────────────────────────────────────────
const R_KM = 6371.0088;
function havKm(a, b) {
  const t = Math.PI / 180;
  const dla = (b[0] - a[0]) * t, dlo = (b[1] - a[1]) * t;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dlo / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}
function buildRoute() {
  const krtc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'krtc.json'), 'utf8'));
  const ln = krtc.lines.find(l => l.id === 'C');
  if (!ln) throw new Error('data/krtc.json 裡找不到 C 線');
  const sh = ln.shape, cum = [0];
  for (let i = 1; i < sh.length; i++) cum.push(cum[i - 1] + havKm(sh[i - 1], sh[i]));
  const loopLen = cum[cum.length - 1];
  // 站的 d 已與線形同源(投影誤差 < 2 公尺,見下方自檢),直接沿用官方 d 保留與網站一致的語意
  const stations = ln.stations.map(s => ({ name: s.name, d: s.d, lat: s.lat, lon: s.lon }))
    .sort((p, q) => p.d - q.d);
  return { shape: sh, cum, loopLen, stations, dwellDeclared: ln.stations.map(s => s.dwell) };
}
// 投影:回傳 { d(km, 沿線), off(公尺, 垂距) }。線形 457 點,逐段線性搜尋足夠快(8 萬筆 < 2 秒)
function projectOnRoute(route, lat, lon) {
  const { shape: sh, cum } = route;
  const kx = 111.320 * Math.cos(lat * Math.PI / 180), ky = 110.574;
  let bestOff = Infinity, bestD = 0;
  for (let i = 1; i < sh.length; i++) {
    const a = sh[i - 1], b = sh[i];
    const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky;
    const bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, py = ay + t * dy, off = Math.hypot(px, py);
    if (off < bestOff) { bestOff = off; bestD = cum[i - 1] + t * Math.sqrt(L2); }
  }
  return { d: bestD, off: bestOff * 1000 };
}

// ── 讀快照 ────────────────────────────────────────────────────────────────────
// 快照格式在取樣期間可能換過形狀,所以幾種常見包法都認:
//   { gps: { rows:[…] } } / { rows:[…] } / { LivePositions:[…] } / 裸陣列
function extractRows(rec) {
  const cands = [rec && rec.gps && rec.gps.rows, rec && rec.rows, rec && rec.LivePositions,
    rec && rec.gps && rec.gps.LivePositions, Array.isArray(rec) ? rec : null];
  const arr = cands.find(Array.isArray);
  if (!arr) return [];
  return arr.map(g => {
    // 原始 TDX 形狀(TrainPosition 包一層)與我們存的扁平形狀都接
    const lat = g.lat != null ? g.lat : (g.TrainPosition && g.TrainPosition.PositionLat);
    const lon = g.lon != null ? g.lon : (g.TrainPosition && g.TrainPosition.PositionLon);
    return {
      t: String(g.t != null ? g.t : g.TripID != null ? g.TripID : ''),
      dir: g.dir != null ? g.dir : g.Direction,
      lat, lon,
      sp: g.sp != null ? g.sp : g.Speed,
      st: g.st != null ? g.st : g.TrainStatus,
      gt: g.gt != null ? g.gt : g.GPSTime,
    };
  }).filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon) && g.t);
}
function loadSnapshots(dir) {
  const files = fs.readdirSync(dir).filter(n => /\.(jsonl|ndjson|json)$/.test(n)).sort();
  if (!files.length) throw new Error(`${dir} 裡沒有 .jsonl/.json 快照`);
  const seen = new Set(), rows = [];
  let lines = 0, bad = 0, dup = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const chunks = f.endsWith('.json') ? [text] : text.split('\n');
    for (const l of chunks) {
      if (!l.trim()) continue;
      lines++;
      let rec; try { rec = JSON.parse(l); } catch { bad++; continue; }
      for (const g of extractRows(rec)) {
        const k = g.t + '|' + g.gt;                 // 同一筆 GPS 會被相鄰快照重複抓到
        if (seen.has(k)) { dup++; continue; }
        seen.add(k); rows.push(g);
      }
    }
  }
  return { rows, files: files.length, lines, bad, dup };
}

// ── 方向:不假設 dir 的正負,從資料本身量出來 ───────────────────────────────────
// 同一車號相鄰兩筆的沿線位移(取環狀最短路)累加,看各 dir 值倒底往 d 增還是減走。
function inferDirSigns(samples, loopLen) {
  const byTrain = new Map();
  for (const s of samples) {
    if (!byTrain.has(s.t)) byTrain.set(s.t, []);
    byTrain.get(s.t).push(s);
  }
  const tally = new Map();
  for (const arr of byTrain.values()) {
    arr.sort((p, q) => p.gtMs - q.gtMs);
    for (let i = 1; i < arr.length; i++) {
      const p = arr[i - 1], q = arr[i];
      if (p.dir !== q.dir) continue;
      const dt = (q.gtMs - p.gtMs) / 1000;
      if (!(dt > 20 && dt < 200)) continue;          // 跨越太久的兩筆不知道繞了幾圈
      let dd = q.d - p.d;
      if (dd > loopLen / 2) dd -= loopLen;
      if (dd < -loopLen / 2) dd += loopLen;
      if (Math.abs(dd) < 0.01) continue;             // 停著不算票
      const key = String(q.dir);
      const cur = tally.get(key) || { plus: 0, minus: 0 };
      if (dd > 0) cur.plus++; else cur.minus++;
      tally.set(key, cur);
    }
  }
  const signs = new Map();
  for (const [k, v] of tally) signs.set(k, v.plus >= v.minus ? 1 : -1);
  return { signs, tally };
}

// ── 站距:某點在行進方向上「離開前站多遠、距下一站多遠」 ───────────────────────
function stationGap(route, d, sign) {
  const st = route.stations, n = st.length, L = route.loopLen;
  // 先找出 d 落在哪兩站之間(依 d 遞增的站序)
  let i = 0;
  while (i < n && st[i].d <= d) i++;
  const aheadIdx = i % n, behindIdx = (i - 1 + n) % n;
  const fwd = (from, to) => { let x = to - from; while (x < 0) x += L; while (x >= L) x -= L; return x; };
  if (sign > 0) {
    return { prev: st[behindIdx], next: st[aheadIdx],
      sPrev: fwd(st[behindIdx].d, d) * 1000, sNext: fwd(d, st[aheadIdx].d) * 1000 };
  }
  // 反向行駛:前站是 d 較大的那一站
  return { prev: st[aheadIdx], next: st[behindIdx],
    sPrev: fwd(d, st[aheadIdx].d) * 1000, sNext: fwd(st[behindIdx].d, d) * 1000 };
}

// ── 統計工具 ──────────────────────────────────────────────────────────────────
const quant = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : NaN;
function binProfile(pairs, binM) {           // pairs: [{s(公尺), v(km/h)}]
  const bins = new Map();
  for (const { s, v } of pairs) {
    if (!(s >= 0 && s <= BIN_MAX_M)) continue;
    const k = Math.floor(s / binM);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(v);
  }
  return [...bins.entries()].map(([k, vs]) => {
    vs.sort((a, b) => a - b);
    return { s: (k + 0.5) * binM, n: vs.length,
      p50: quant(vs, .5), p75: quant(vs, .75), p90: quant(vs, .9), p95: quant(vs, .95), max: vs[vs.length - 1] };
  }).sort((a, b) => a.s - b.s);
}
/**
 * 由逐筆樣本解加速度。等加速段滿足 v² = 2·a·s ⇒ 每一筆各自給一個 a_i = v²/(2s)。
 *
 * 🔴 為什麼不用分箱曲線去擬合:一個 10 公尺的箱裡 v 本來就在變,取分位數會取到箱的上緣,
 *    再拿箱心當 s ⇒ 系統性高估(第一版自檢量到 +21%)。逐筆算 a_i 就沒有這個偏差,
 *    因為每一筆用的是它自己的 s。分箱曲線留著只當診斷用。
 *
 * 汙染一律是【單向】的:巡航中、短段提早煞車、號誌停等的樣本 v 都比「同一個 s 上全力加速」低
 * ⇒ a_i 偏小。真值是 a_i 的【上包絡】,所以取高分位數;取多高由自檢用已知真值定(見 selftest)。
 * 反過來 GPS 位置誤差會讓小 s 的 a_i 爆掉(s=5m 配 ±4m 誤差就是 ±80%),所以 s 有下限。
 */
const S_MIN_M = 30;                                  // 位置誤差在此之下會主導 a_i
function accelSamples(pairs, sMax) {
  const out = [];
  for (const { s, v } of pairs) {
    if (!(s >= S_MIN_M && s <= sMax && v > 3)) continue;
    const ms = v / KMH;
    out.push((ms * ms) / (2 * s));
  }
  return out.sort((a, b) => a - b);
}
// a_i 隨 s 的走勢。理想梯形下應該持平;真車在高速端出力會衰(定功率區)⇒ a_i 會往下掉。
// 掉得明顯就代表「一個常數 a」本來就配不上這條線,要據實回報,而不是硬擬一個數字。
function accelByBand(pairs, sMax) {
  const bands = [[30, 50], [50, 75], [75, 100], [100, 150], [150, 250]];
  return bands.filter(([lo]) => lo < sMax + 50).map(([lo, hi]) => {
    const ai = [];
    for (const { s, v } of pairs) if (s >= lo && s < hi && v > 3) { const ms = v / KMH; ai.push((ms * ms) / (2 * s)); }
    ai.sort((a, b) => a - b);
    return { lo, hi, n: ai.length, p50: quant(ai, .5) * KMH, p90: quant(ai, .9) * KMH };
  });
}
function fitAccel(pairs, vcKmh, q) {
  // 取樣視窗要止於「巡航開始」附近,否則整段巡航樣本會把上包絡稀釋掉。
  // sMax 依賴 a、a 又依賴 sMax ⇒ 疊代三次即收斂。
  let aSI = 1.0, sMax = 150, ai = [];
  for (let it = 0; it < 3; it++) {
    const vc = vcKmh / KMH;
    sMax = Math.max(60, Math.min(250, (vc * vc) / (2 * aSI)));
    ai = accelSamples(pairs, sMax);
    if (ai.length < 50) return null;
    aSI = quant(ai, q);
  }
  return {
    aSI, aKmhs: aSI * KMH, sMax, n: ai.length, bands: accelByBand(pairs, sMax),
    ladder: { p50: quant(ai, .5) * KMH, p75: quant(ai, .75) * KMH, p90: quant(ai, .9) * KMH,
      p95: quant(ai, .95) * KMH, p99: quant(ai, .99) * KMH },
  };
}

// ── 靈敏度:改 a/b 到底會讓畫出來的車位移多少 ────────────────────────────────
// 校正值得不值得做,取決於「改了以後畫面差多少」。梯形的端點被時刻表釘死(段長 L、段時間 T 不變),
// a/b 只改段內形狀 ⇒ 位移有上限。下面拿 C 線真實的站間距與 data/krtc.json 的 segs[].run,
// 把兩組參數各自解出的位置逐秒相減。buildProfile / profTimeToProg 與 index.html 同式(純梯形分支)。
function buildProfileTrapezoid(Lkm, T, aK, bK, vK) {
  const L = Lkm * 1000, a = aK / 3.6, b = bK / 3.6, vmax = vK / 3.6;
  if (!(L > 0) || !(T > 0) || !(a > 0) || !(b > 0)) return null;
  const D = 1 / (2 * a) + 1 / (2 * b);
  const disc = T * T - 4 * D * L;
  if (disc < 0) return null;                          // 這組加減速在 T 內跑不完 L
  const vc = (T - Math.sqrt(disc)) / (2 * D);
  if (!(vc > 0) || vc > vmax) return null;            // 需超過極速 ⇒ index.html 會退回等速
  const tAcc = vc / a, tDec = vc / b, dAcc = vc * vc / (2 * a), dDec = vc * vc / (2 * b);
  const tCru = T - tAcc - tDec;
  if (!(tCru >= 0)) return null;
  return { L, T, a, b, vc, tAcc, tCru, tDec, dAcc, dCru: vc * tCru };
}
function profDist(p, t) {
  if (t < p.tAcc) return 0.5 * p.a * t * t;
  if (t < p.tAcc + p.tCru) return p.dAcc + p.vc * (t - p.tAcc);
  const td = t - p.tAcc - p.tCru;
  return p.dAcc + p.dCru + p.vc * td - 0.5 * p.b * td * td;
}
function sensitivity(base, cand) {
  const route = buildRoute();
  const krtc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'krtc.json'), 'utf8'));
  const ln = krtc.lines.find(l => l.id === 'C');
  const st = ln.stations, segs = ln.segs || [];
  const diffs = [], perSeg = [];
  let linearBase = 0, linearCand = 0;
  for (let i = 0; i < st.length; i++) {
    const j = (i + 1) % st.length;
    let Lkm = (j === 0 ? ln.loopLen : st[j].d) - st[i].d;
    if (Lkm <= 0) Lkm += ln.loopLen;
    const T = segs[i] && segs[i].run;
    if (!(T > 0)) continue;
    const pb = buildProfileTrapezoid(Lkm, T, base.a, base.b, base.v);
    const pc = buildProfileTrapezoid(Lkm, T, cand.a, cand.b, cand.v);
    if (!pb) linearBase++;
    if (!pc) linearCand++;
    if (!pb || !pc) continue;
    let mx = 0;
    for (let t = 0; t <= T; t++) {
      const dd = Math.abs(profDist(pb, t) - profDist(pc, t));
      diffs.push(dd); if (dd > mx) mx = dd;
    }
    perSeg.push({ from: st[i].name, to: st[j].name, Lkm, T, maxM: mx, vcBase: pb.vc * KMH, vcCand: pc.vc * KMH });
  }
  diffs.sort((x, y) => x - y);
  perSeg.sort((x, y) => y.maxM - x.maxM);
  return { diffs, perSeg, linearBase, linearCand,
    p50: quant(diffs, .5), p90: quant(diffs, .9), max: diffs[diffs.length - 1] };
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
function analyse(rawRows, opts) {
  const route = buildRoute();
  const offMax = Number(opts.off || OFF_DEFAULT_M), binM = Number(opts.bin || 10);
  const stats = { raw: rawRows.length, offRoute: 0, noTime: 0, kept: 0, stStatus: new Map() };
  const samples = [];
  for (const g of rawRows) {
    const p = projectOnRoute(route, g.lat, g.lon);
    if (p.off > offMax) { stats.offRoute++; continue; }
    const gtMs = Date.parse(g.gt);
    if (!Number.isFinite(gtMs)) { stats.noTime++; continue; }
    const k = String(g.st);
    stats.stStatus.set(k, (stats.stStatus.get(k) || 0) + 1);
    samples.push({ ...g, d: p.d, off: p.off, gtMs, sp: Number(g.sp) });
    stats.kept++;
  }
  const { signs, tally } = inferDirSigns(samples, route.loopLen);
  const dep = [], arr = [], cruise = [];
  let noDir = 0;
  for (const s of samples) {
    const sign = signs.get(String(s.dir));
    if (!sign) { noDir++; continue; }
    const g = stationGap(route, s.d, sign);
    s.sPrev = g.sPrev; s.sNext = g.sNext;
    if (!Number.isFinite(s.sp)) continue;
    dep.push({ s: g.sPrev, v: s.sp });
    arr.push({ s: g.sNext, v: s.sp });
    if (g.sPrev > 200 && g.sNext > 200) cruise.push(s.sp);
  }
  const depProfile = binProfile(dep, binM), arrProfile = binProfile(arr, binM);
  cruise.sort((a, b) => a - b);
  return {
    route, stats, signs, tally, noDir, samples,
    depProfile, arrProfile,
    fits: (() => {
      const vc = quant(cruise, .9);                 // 巡航速度用巡航段的 p90,不用車種標稱極速
      return { a: fitAccel(dep, vc, Q_ENVELOPE), b: fitAccel(arr, vc, Q_ENVELOPE), vcKmh: vc };
    })(),
    cruise: { n: cruise.length, p50: quant(cruise, .5), p90: quant(cruise, .9), p99: quant(cruise, .99), max: cruise[cruise.length - 1] },
  };
}

function report(res, load) {
  const L = [];
  const f2 = x => x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(2);
  L.push('── 原料 ──────────────────────────────────────────');
  if (load) L.push(`快照檔 ${load.files} 個、行 ${load.lines}(壞行 ${load.bad}、重複 ${load.dup} 筆已去重)`);
  L.push(`逐車筆數 ${res.stats.raw}；離線形 >${OFF_DEFAULT_M}m 丟 ${res.stats.offRoute}、無時戳丟 ${res.stats.noTime} ⇒ 可用 ${res.stats.kept}`);
  L.push(`TrainStatus 分佈 ${[...res.stats.stStatus].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  L.push(`方向判定 ${[...res.tally].map(([k, v]) => `dir${k}→${res.signs.get(k) > 0 ? '+' : '-'}(${v.plus}/${v.minus})`).join(' ')}；無法定向 ${res.noDir} 筆`);
  L.push('');
  L.push('── 離站側 v(s):s＝離開前站的距離 ──────────────────');
  L.push('  s(m)     n    p50    p90    max');
  for (const b of res.depProfile) if (b.s <= 320) L.push(`  ${String(Math.round(b.s)).padStart(4)} ${String(b.n).padStart(6)} ${f2(b.p50).padStart(6)} ${f2(b.p90).padStart(6)} ${f2(b.max).padStart(6)}`);
  L.push('');
  L.push('── 進站側 v(s):s＝距下一站的距離 ──────────────────');
  L.push('  s(m)     n    p50    p90    max');
  for (const b of res.arrProfile) if (b.s <= 320) L.push(`  ${String(Math.round(b.s)).padStart(4)} ${String(b.n).padStart(6)} ${f2(b.p50).padStart(6)} ${f2(b.p90).padStart(6)} ${f2(b.max).padStart(6)}`);
  L.push('');
  L.push(`── 解出的加減速(km/h/s,與 TRTC_BOARD_PERF 同單位;上包絡取 p${Math.round(Q_ENVELOPE * 100)}) ──`);
  for (const k of ['a', 'b']) {
    const v = res.fits[k];
    if (!v) { L.push(`  ${k}: 樣本不足`); continue; }
    L.push(`  ${k} = ${f2(v.aKmhs)} km/h/s (${f2(v.aSI)} m/s²)  取樣視窗 s≤${Math.round(v.sMax)}m、${v.n} 筆`);
    L.push(`     逐筆 a_i 分位 p50 ${f2(v.ladder.p50)} / p75 ${f2(v.ladder.p75)} / p90 ${f2(v.ladder.p90)} / p95 ${f2(v.ladder.p95)} / p99 ${f2(v.ladder.p99)}`);
    L.push(`     a_i 隨距離(持平＝常數 a 成立;遞減＝高速端出力衰減) ` +
      v.bands.map(b => `${b.lo}-${b.hi}m:${f2(b.p50)}(n=${b.n})`).join('  '));
  }
  L.push('');
  L.push(`── 巡航段速度(離前後站都 >200m,n=${res.cruise.n}) p50 ${f2(res.cruise.p50)} / p90 ${f2(res.cruise.p90)} / p99 ${f2(res.cruise.p99)} / max ${f2(res.cruise.max)} km/h`);
  L.push('  對照現行 TRTC_BOARD_PERF = { a: 3.6, b: 4.3, v: 80 }(index.html)');
  return L.join('\n');
}

// ── 自檢:用已知 a/b 合成資料,驗這支估計量到底準不準 ──────────────────────────
// 合成時刻意加進兩件真實世界的事:①60 秒取樣的隨機相位 ②街道號誌造成的段中停等。
// 若估計量只在「乾淨資料」上成立,拿去跑真資料就是在騙自己。
function synth({ aSI = 1.0, bSI = 1.2, vmaxKmh = 50, dwell = 25, days = 6, signalStopProb = 0.25, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const route = buildRoute();
  const st = route.stations, L = route.loopLen * 1000;
  const vmax = vmaxKmh / KMH;
  // 一台車繞一圈的完整 (t, 沿線位置 m, 速度 m/s) 軌跡。
  // 🔴 車一定停在【真的站位】上:從站 i 走到站 i±1,位置直接由 st[i].d 推,不從任意起點累加,
  //    否則合成出來的「站」會整體偏移,估計量看到的 s 全錯(第一版自檢就是這樣 FAIL 的)。
  function lap(startIdx, sign) {
    const tr = []; let t = 0, n = st.length;
    for (let k = 0; k < n; k++) {
      const i = ((startIdx + sign * k) % n + n) % n;
      const j = ((i + sign) % n + n) % n;
      const from = st[i].d * 1000, to = st[j].d * 1000;
      let segLen = sign > 0 ? to - from : from - to;
      if (segLen <= 0) segLen += L;
      const legs = rnd() < signalStopProb ? (() => { const c = segLen * (0.3 + 0.4 * rnd()); return [c, segLen - c]; })() : [segLen];
      let done = 0;
      for (let li = 0; li < legs.length; li++) {
        const Lm = legs[li];
        const vPeak = Math.min(vmax, Math.sqrt(2 * aSI * bSI * Lm / (aSI + bSI)));
        const tA = vPeak / aSI, dA = vPeak * vPeak / (2 * aSI);
        const tB = vPeak / bSI, dB = vPeak * vPeak / (2 * bSI);
        const dC = Math.max(0, Lm - dA - dB), tC = dC / vPeak;
        const total = tA + tC + tB;
        for (let u = 0; u <= total; u += 1) {          // 1 秒一格的真軌跡,之後再抽樣
          let x, v;
          if (u < tA) { v = aSI * u; x = 0.5 * aSI * u * u; }
          else if (u < tA + tC) { v = vPeak; x = dA + vPeak * (u - tA); }
          else { const w = u - tA - tC; v = Math.max(0, vPeak - bSI * w); x = dA + dC + vPeak * w - 0.5 * bSI * w * w; }
          const along = done + x;
          tr.push({ t: t + u, d: ((sign > 0 ? from + along : from - along) % L + L) % L, v });
        }
        t += total; done += Lm;
        const hold = li < legs.length - 1 ? 15 + 20 * rnd() : dwell;   // 號誌停等比站停短
        for (let u = 0; u < hold; u += 1) tr.push({ t: t + u, d: ((sign > 0 ? from + done : from - done) % L + L) % L, v: 0 });
        t += hold;
      }
    }
    return tr;
  }
  // 沿線公尺 → 經緯度(投影的反函式,用線形逐段內插)
  const cumM = route.cum.map(k => k * 1000);
  const toLatLon = dm => {
    let x = dm % (route.loopLen * 1000); if (x < 0) x += route.loopLen * 1000;
    let i = 1; while (i < cumM.length && cumM[i] < x) i++;
    const a = route.shape[i - 1], b = route.shape[Math.min(i, route.shape.length - 1)];
    const seg = Math.max(1e-9, cumM[Math.min(i, cumM.length - 1)] - cumM[i - 1]);
    const f = (x - cumM[i - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const recs = [];
  const t0 = Date.parse('2026-09-06T06:00:00+08:00');
  for (let day = 0; day < days; day++) {
    const trains = [];
    for (let k = 0; k < 8; k++) trains.push({ id: `SYN${day}-${k}`, dir: k % 2,
      tr: lap(Math.floor(st.length * k / 8), k % 2 === 0 ? 1 : -1), phase: rnd() * 60 });
    for (let poll = 0; poll < 700; poll++) {          // 每 60 秒一發
      const rows = [];
      for (const tn of trains) {
        const want = poll * 60 + tn.phase;
        const p = tn.tr[Math.floor(want) % tn.tr.length];   // 一圈跑完接著下一圈,模擬整個營運日
        if (!p) continue;
        const [lat, lon] = toLatLon(p.d);
        rows.push({
          t: tn.id, dir: tn.dir,
          lat: lat + (rnd() - .5) * 8e-5, lon: lon + (rnd() - .5) * 8e-5,   // 約 ±4 公尺
          sp: Math.max(0, p.v * KMH + (rnd() - .5) * 2),                     // 速度雜訊 ±1 km/h
          st: 0,
          gt: new Date(t0 + day * 86400000 + (poll * 60 + tn.phase) * 1000 - (17 + rnd() * 28) * 1000).toISOString(),
        });
      }
      recs.push({ at: new Date(t0 + day * 86400000 + poll * 60000).toISOString(), gps: { rows } });
    }
  }
  return { recs, truth: { aSI, bSI, aKmhs: aSI * KMH, bKmhs: bSI * KMH, vmaxKmh } };
}

function selftest() {
  const { recs, truth } = synth();
  const rows = [], seen = new Set();
  for (const r of recs) for (const g of extractRows(r)) { const k = g.t + '|' + g.gt; if (seen.has(k)) continue; seen.add(k); rows.push(g); }
  console.log(`合成 ${rows.length} 筆(真值 a=${truth.aKmhs.toFixed(2)}、b=${truth.bKmhs.toFixed(2)} km/h/s、vmax=${truth.vmaxKmh})`);
  console.log('合成時刻意帶進三件真實世界的事:60 秒取樣的隨機相位、GPS 時戳落後 17–45 秒、街道號誌造成的段中停等。\n');
  const res = analyse(rows, {});
  console.log(report(res, null));
  console.log('\n── 自檢:上包絡分位數各還原成什麼 ──────────────────');
  const rows2 = [];
  for (const [k, want] of [['a', truth.aKmhs], ['b', truth.bKmhs]]) {
    const f = res.fits[k];
    if (!f) { console.log(`  ${k}: 樣本不足`); continue; }
    const cells = ['p50', 'p75', 'p90', 'p95', 'p99'].map(q => {
      const got = f.ladder[q], err = (got - want) / want * 100;
      return `${q} ${got.toFixed(2)}(${err >= 0 ? '+' : ''}${err.toFixed(0)}%)`;
    });
    console.log(`  ${k} 真值 ${want.toFixed(2)}: ${cells.join('  ')}`);
    rows2.push({ k, want, got: f.aKmhs });
  }
  console.log(`\n  採用的 p${Math.round(Q_ENVELOPE * 100)}:`);
  let ok = rows2.length === 2;
  for (const r of rows2) {
    const err = (r.got - r.want) / r.want * 100;
    console.log(`    ${r.k}: 估 ${r.got.toFixed(2)} / 真 ${r.want.toFixed(2)} km/h/s  偏差 ${err >= 0 ? '+' : ''}${err.toFixed(1)}%`);
    if (Math.abs(err) > 15) ok = false;
  }
  // 汙染掃描:真資料的段中停等比例未知,所以要知道估計量在不同汙染程度下漂多少
  console.log('\n── 汙染掃描:段中號誌停等比例 → 各分位還原的偏差 ──────');
  console.log('  停等比例    a:p50      a:p75      a:p90   |   b:p50      b:p75      b:p90');
  for (const prob of [0, 0.25, 0.5, 0.75]) {
    const sim = synth({ signalStopProb: prob, seed: 11 });
    const rs = [], sn = new Set();
    for (const r of sim.recs) for (const g of extractRows(r)) { const k = g.t + '|' + g.gt; if (sn.has(k)) continue; sn.add(k); rs.push(g); }
    const r2 = analyse(rs, {});
    const cell = (f, want, q) => f ? `${((f.ladder[q] - want) / want * 100).toFixed(0).padStart(4)}%` : '  n/a';
    console.log(`  ${String(Math.round(prob * 100)).padStart(6)}%   `
      + ['p50', 'p75', 'p90'].map(q => cell(r2.fits.a, sim.truth.aKmhs, q).padStart(9)).join(' ') + '  |'
      + ['p50', 'p75', 'p90'].map(q => cell(r2.fits.b, sim.truth.bKmhs, q).padStart(9)).join(' '));
  }
  console.log('  讀法:某一欄在各汙染程度下都貼近 0% ⇒ 那一分位可以直接當估計值;');
  console.log('        整列一起往負跑 ⇒ 該汙染程度下所有分位都會低估,真值要往上修。');
  console.log(ok ? '\nPASS:在 ±15% 內還原已知真值 ⇒ 這支估計量可以拿去跑真資料(真值本身的不確定度要照這個量級報)。'
    : '\nFAIL:沒還原真值,不要拿這支去解真資料。');
  process.exit(ok ? 0 : 1);
}

// ── 進入點
if (argv.includes('--selftest')) {
  selftest();
} else if (argv.includes('--sensitivity')) {
  const spec = flag('sensitivity');
  const parse = t => { const [a, b, v] = String(t).split(',').map(Number); return { a, b, v: v || 80 }; };
  const base = { a: 3.6, b: 4.3, v: 80 };                       // 現行 TRTC_BOARD_PERF
  const cands = (spec === true ? '3.0,3.6|2.5,3.0|1.8,2.2|4.5,5.5' : String(spec)).split('|').map(parse);
  console.log('C 線逐段:現行 { a:3.6, b:4.3, v:80 } 對各候選值,畫出來的位置差多少(公尺)');
  console.log('段長與段時間取自 data/krtc.json(stations[].d 與 segs[].run);端點被時刻表釘死,差的只有段內形狀\n');
  console.log('  候選 a,b        位置差 p50    p90     最大   |  退回等速的段數(現行/候選)');
  for (const c of cands) {
    const r = sensitivity(base, c);
    console.log(`  ${String(c.a + ',' + c.b).padEnd(12)} ${r.p50.toFixed(1).padStart(10)} ${r.p90.toFixed(1).padStart(7)} ${r.max.toFixed(1).padStart(7)}   |  ${r.linearBase} / ${r.linearCand}`);
  }
  const r0 = sensitivity(base, parse(cands[0] === undefined ? '3.0,3.6' : cands[0].a + ',' + cands[0].b));
  console.log(`\n差最大的五段(對 ${cands[0].a},${cands[0].b}):`);
  for (const s2 of r0.perSeg.slice(0, 5)) {
    console.log(`  ${s2.from}→${s2.to}  L=${(s2.Lkm * 1000).toFixed(0)}m T=${s2.T}s  最大差 ${s2.maxM.toFixed(1)}m  巡航 ${s2.vcBase.toFixed(1)}→${s2.vcCand.toFixed(1)} km/h`);
  }
} else {
  const dir = flag('data');
  if (!dir || dir === true) {
    console.error('用法:node scripts/calibrate_klrt_accel.mjs --data <快照目錄>\n      node scripts/calibrate_klrt_accel.mjs --selftest');
    process.exit(2);
  }
  const load = loadSnapshots(dir);
  const res = analyse(load.rows, { off: flag('off'), bin: flag('bin') });
  const text = report(res, load);
  console.log(text);
  const out = flag('json');
  if (out && out !== true) {
    fs.writeFileSync(out, JSON.stringify({
      generatedAt: new Date().toISOString(), load: { files: load.files, lines: load.lines, dup: load.dup },
      stats: { ...res.stats, stStatus: Object.fromEntries(res.stats.stStatus) },
      depProfile: res.depProfile, arrProfile: res.arrProfile, fits: res.fits, cruise: res.cruise,
    }, null, 2));
    console.log(`\n剖面與擬合結果已寫到 ${out}`);
  }
}

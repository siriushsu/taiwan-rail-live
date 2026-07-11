#!/usr/bin/env node
// 捷運實際時刻表:TDX StationTimeTable(逐站發車時刻)→ 逐班車清單,供前端以真實時鐘定位列車。
//   輸入 data/tdx/{OP}_StationTimeTable.json + {OP}_Station.json + 前端線檔 data/*.json
//   輸出 data/{trtc,krtc,tymc,ntdlrt,ntalrt,tmrt,sanying}_times.json
// 重建法:每條營運路線(RouteID×方向×目的地×營運日)沿站序做「單調鏈匹配」——
//   相鄰站的預期行駛秒(線檔 segs.run+停站)開時間窗,發車時刻逐站串成一班車;
//   窗前多出的發車=中途始發(如板南線亞東醫院加班車),缺配對=通過不停(機捷直達)。
// 台中捷運/三鶯線無 StationTimeTable → 以官方班距+首末班合成(estimated 標記)。
// 輸出格式:lines[id] = { days:[週日..週六 → set 名], sets:{名:[班...]}};
//   一班 = [idx,sec, idx,sec, ...] 攤平的 (線檔站序 index, 當日發車秒) 對,跨午夜 sec>86400。
// 用法:node scripts/build_metro_times.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const DWELL = 25; // 缺值時的停站秒(與前端 DWELL_SEC 一致)
const DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; // index = JS getDay()
const toSec = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };

// ── 線檔工具:站名→index、相鄰站行駛秒 ──
function lineCtx(line) {
  const idxOf = new Map();
  line.stations.forEach((s, i) => {
    if (idxOf.has(s.name)) throw new Error(`${line.id}: 站名重複 ${s.name}`);
    idxOf.set(s.name, i);
  });
  const n = line.stations.length;
  // runs[i] = 站 i→i+1 行駛秒(環線 runs[n-1]=閉合段);缺 TDX 值以站距/35km/h 估
  const nRuns = line.loop ? n : n - 1;
  const runs = [];
  for (let i = 0; i < nRuns; i++) {
    const sg = line.segs && line.segs[i];
    if (sg && sg.run > 0) { runs.push(sg.run); continue; }
    const a = line.stations[i], b = line.stations[(i + 1) % n];
    const d = i === n - 1 && line.loop ? (line.loopLen - a.d) : Math.abs((b.d ?? 0) - (a.d ?? 0));
    runs.push(Math.max(30, Math.round((d || 1) / 35 * 3600)));
  }
  const dwellOf = i => Math.min(60, line.stations[i].dwell || DWELL); // 終端折返數分鐘不算沿途停站
  return { idxOf, runs, dwellOf, n };
}
// 行進方向上的預期秒與步數:非環線雙向皆可;環線依 asc 繞行(含跨縫)
function makeDirFns(ctx, loop, asc) {
  const { runs, dwellOf, n } = ctx;
  const steps = (a, b) => loop ? (asc ? (b - a + n) % n : (a - b + n) % n) : Math.abs(b - a);
  const expected = (a, b) => {
    const k = steps(a, b);
    let t = 0, cur = a;
    for (let s = 0; s < k; s++) {
      if (!loop) { const lo = Math.min(a, b) + s; t += runs[lo]; }
      else if (asc) { t += runs[cur]; cur = (cur + 1) % n; }
      else { cur = (cur - 1 + n) % n; t += runs[cur]; }
      if (s < k - 1) t += dwellOf(loop ? cur : Math.min(a, b) + s + 1);
    }
    return t;
  };
  return { steps, expected };
}

// ── 單一記錄的發車清單:凌晨 4 點前一律視為跨午夜(+86400)後整段排序去重。
// 不信 Sequence:TDX 偶見亂序(淡海假日把 00:0x 擺在清晨段中間)與整段重複(環狀線幸福站假日)。
// 04:00–05:29 與 25h 後物理上無班(台灣捷運首班≥05:30、末班≤01:00)→ 髒值剔除;
// 髒值 ≥3 筆代表整筆記錄損壞(如環狀線頭前庄假日),回傳 null 整筆跳過。
function depsOf(rec) {
  const set = new Set();
  let junk = 0;
  for (const t of rec.Timetables) {
    let s = toSec(t.DepartureTime ?? t.ArrivalTime);
    if (s < 4 * 3600) s += 86400;
    if ((s >= 4 * 3600 && s < 5.5 * 3600) || s > 25 * 3600) { junk++; continue; }
    set.add(s);
  }
  if (junk >= 3) return null;
  return [...set].sort((a, b) => a - b);
}

// 相鄰記錄站的「典型發車間隔」:對前站每班找後站最近的下一班,取中位數。
// 自我校準,不信 S2S(高捷橘線 S2S 有 240s 但實跑 120s 的髒值);樣本不足退回線檔預期。
function calibrate(stns, dir) {
  const exp = [];
  for (let k = 0; k + 1 < stns.length; k++) {
    const A = stns[k].deps, B = stns[k + 1].deps;
    const ds = [];
    let j = 0;
    for (const a of A) {
      while (j < B.length && B[j] < a + 15) j++;
      if (j < B.length && B[j] - a <= 1800) ds.push(B[j] - a);
    }
    ds.sort((a, b) => a - b);
    exp.push(ds.length >= 5 ? ds[Math.floor(ds.length / 2)]
      : dir.expected(stns[k].idx, stns[k + 1].idx) + 25);
  }
  const prefix = [0];
  for (let k = 0; k < exp.length; k++) prefix.push(prefix[k] + exp[k]);
  return prefix; // prefix[k] = 從 stns[0] 累計到 stns[k] 的典型秒數
}

// ── 鏈匹配:一條路線(站序已沿行進方向)×一種營運日 → 班車陣列 ──
function chainRoute(stns, dir, stats, dbg) {
  const chains = [];
  const prefix = calibrate(stns, dir);
  if (dbg) console.log(`  [dbg] ${dbg} 校準間隔:`, prefix.map((p, i) => i ? p - prefix[i - 1] : 0).slice(1).join(','));
  let active = [];
  for (let k = 0; k < stns.length; k++) {
    const st = stns[k];
    const bBefore = chains.length;
    for (const c of active) {
      const E = prefix[k] - prefix[c.lastK];
      const gap = k - c.lastK;
      c.pred = c.last + E;
      c.lo = c.last + Math.max(20, E - Math.max(90, E * 0.45)); // 多站跳點(直達車)少算停站時間,窗前緣放寬
      c.hi = c.last + E + 90 + 40 * (gap - 1);
    }
    // 自由配對(不假設先發先到):直達車會在站間超車,嚴格順序會把窗前緣的班誤判成新生。
    // 每個發車在「窗含它的未配對活鏈」中挑 pred 最近的;沒有就是本站始發。
    const born = [];
    for (const dep of st.deps) {
      let best = null;
      for (const c of active) {
        if (c._mk === k || dep < c.lo || dep > c.hi) continue;
        if (!best || Math.abs(c.pred - dep) < Math.abs(best.pred - dep)) best = c;
      }
      if (best) {
        best.stops.push([st.idx, dep]);
        best.last = dep; best.lastIdx = st.idx; best.lastK = k; best._mk = k; best._miss = 0;
      } else {
        const c = { stops: [[st.idx, dep]], last: dep, lastIdx: st.idx, lastK: k, pred: dep, _mk: k, _miss: 0 };
        chains.push(c); born.push(c);
        if (k > 0) stats.midStart++;
      }
    }
    for (const c of active) if (c._mk !== k) c._miss++;
    if (dbg) console.log(`  [dbg] ${dbg} k${k} idx${st.idx} deps=${st.deps.length} 新生=${chains.length - bBefore} 活鏈=${active.length}`);
    active = active.concat(born).filter(c => c._miss <= 15); // 連 15 站沒配到=已收班/出廠殘鏈
  }
  return chains;
}

// ── 主流程:一組營運路線 → 某前端線的 sets ──
// routeSpecs 項可帶:destIs(只收此終點的記錄)、only(只收這些 StationID)、
// as(虛擬路線名:跨 RouteID 合併記錄,治淡海回程幹線被亂拆在 V-1/V-2/空編號)、
// stitchTo(本組鏈尾接到目標組的中途始發鏈,治藍海支線頭與幹線分家)、noDestOk(不計缺終點)。
function buildLineTimes(line, routeSpecs, sttCache, stnNameCache, notes, allStop) {
  const ctx = lineCtx(line);
  const groups = new Map();
  for (const spec of routeSpecs) {
    const { op, routeId } = spec;
    const stnName = stnNameCache(op);
    for (const rec of sttCache(op)) {
      if (routeId !== '*' && rec.RouteID !== routeId) continue;
      if (spec.only && !spec.only.includes(rec.StationID)) continue;
      const name = stnName.get(rec.StationID);
      if (!ctx.idxOf.has(name)) continue; // 不在此前端線的站(未通車段等)
      const dest = stnName.get(rec.DestinationStaionID || rec.DestinationStationID) ||
        (rec.DestinationStationName && rec.DestinationStationName.Zh_tw) || '';
      if (spec.destIs && stnNameCache(op).get(spec.destIs) !== dest) continue;
      const days = DAY_KEYS.map(k => rec.ServiceDay[k] ? '1' : '0').join('');
      if ((spec.drop || []).some(x => x.station === rec.StationID && x.dir === rec.Direction && x.tag === rec.ServiceDay.ServiceTag)) {
        notes.push(`${line.id} ${rec.StationID}/dir${rec.Direction}/${rec.ServiceDay.ServiceTag}: 已知損壞記錄,整筆排除`);
        continue;
      }
      const deps = depsOf(rec);
      if (!deps) {
        notes.push(`${line.id} ${rec.StationID}/dir${rec.Direction}/${rec.ServiceDay.ServiceTag}: 髒值過多(時間亂碼),整筆排除`);
        continue;
      }
      const gname = spec.as || routeId;
      const key = [gname, spec.as ? '' : rec.Direction, dest, days].join('|');
      if (!groups.has(key)) groups.set(key, { routeId: gname, dir: rec.Direction ?? 0, dest, days, tag: rec.ServiceDay.ServiceTag, spec, stns: new Map() });
      const g = groups.get(key);
      const idx = ctx.idxOf.get(name);
      if (g.stns.has(idx)) { // 同組同站多筆記錄(虛擬路線合併時)→ 取聯集
        const merged = new Set([...g.stns.get(idx).deps, ...deps]);
        g.stns.set(idx, { idx, deps: [...merged].sort((a, b) => a - b) });
      } else g.stns.set(idx, { idx, deps });
    }
  }
  // 異常偵測(只警告不動手):某站班距中位數孤立地低於同組其他站 → 疑似重複互疊的髒記錄
  for (const g of groups.values()) {
    const meds = [...g.stns.values()].map(s => {
      const gaps = s.deps.slice(1).map((v, i) => v - s.deps[i]).sort((a, b) => a - b);
      return { idx: s.idx, med: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0 };
    });
    if (meds.length < 4) continue;
    const all = meds.map(m => m.med).sort((a, b) => a - b);
    const gm = all[Math.floor(all.length / 2)];
    for (const m of meds) if (m.med && m.med < gm * 0.6 && !meds.some(o => o.idx !== m.idx && Math.abs(o.idx - m.idx) <= 1 && o.med < gm * 0.75))
      console.warn(`  ⚠ ${line.id} ${g.routeId}/${g.dir}/${g.tag} idx${m.idx}: 班距中位數 ${Math.round(m.med / 60)}分 孤立偏低(組中位 ${Math.round(gm / 60)}分),疑似髒記錄`);
  }
  const byDay = Array.from({ length: 7 }, () => []);
  const tagOfDay = Array.from({ length: 7 }, () => new Set());
  const stats = { midStart: 0, noDest: 0, dropped: 0, trains: 0, stitched: 0, merged: 0 };
  // 第一遍:各組先鏈起來(暫存,供 stitch)
  const built = [];
  for (const g of groups.values()) {
    const destIdx = ctx.idxOf.get(g.dest);
    let stns = [...g.stns.values()].sort((a, b) => a.idx - b.idx);
    let asc;
    if (line.loop) {
      asc = g.dir === 0; // 環線:Direction 0=站序遞增繞行(速度品質閘會抓出方向誤判)
      if (!asc) stns.reverse();
      if (destIdx != null) { // 起(=終)點旋到最前:一班=一圈,不跨縫
        const oi = stns.findIndex(s => s.idx === destIdx);
        if (oi > 0) stns = stns.slice(oi).concat(stns.slice(0, oi));
      }
    } else {
      const maxI = stns[stns.length - 1].idx, minI = stns[0].idx;
      asc = destIdx == null ? true : destIdx >= maxI;
      if (!asc && destIdx > minI) { console.warn(`  ⚠ ${line.id} ${g.routeId}/${g.dir}: 終點 ${g.dest} 落在路線中段,略過`); continue; }
      if (!asc) stns.reverse();
    }
    const dir = makeDirFns(ctx, !!line.loop, asc);
    const dbg = process.env.DEBUG_GROUP && `${line.id}|${g.routeId}|${g.dir}|${g.tag}`.includes(process.env.DEBUG_GROUP)
      ? `${line.id} ${g.routeId}/${g.dir}/${g.tag}` : null;
    // 錨定傳播:該營運日各站清單互相矛盾(如環狀線假日,offset 整天漂移)→
    // 只取起點站真實發車時刻(首末班/班距為真),沿線以行駛+停站時間推進,不硬配矛盾的中途站
    const anchored = !!(g.spec.anchorTags && g.spec.anchorTags.includes(g.tag) && destIdx != null && !line.loop);
    let useStns = stns, chains;
    if (anchored) {
      useStns = [stns[0]];
      chains = useStns[0].deps.map(dep => {
        const stops = [[useStns[0].idx, dep]];
        let t = dep, cur = useStns[0].idx;
        const step = destIdx > cur ? 1 : -1;
        while (cur !== destIdx) {
          t += dir.expected(cur, cur + step);
          stops.push([cur + step, Math.round(t)]);
          cur += step;
          if (cur !== destIdx) t += ctx.dwellOf(cur);
        }
        return { stops, last: t, lastIdx: destIdx, lastK: 0 };
      });
      notes.push(`${line.id} ${g.routeId}/${g.dir}/${g.tag}: 各站時刻互相矛盾,以起點站 ${useStns[0].idx} 實際發車錨定傳播 ${chains.length} 班`);
    } else chains = chainRoute(stns, dir, stats, dbg);
    built.push({ g, stns: useStns, asc, dir, destIdx, chains });
  }
  // 碎片合併(組內):一班車在某站漏配會被切成前後兩段——
  // 鏈尾到另一鏈頭若站序相接(1~3 步)且時間吻合行駛預期,併回同一班
  for (const b of built) {
    if (b.g.spec.anchorTags && b.g.spec.anchorTags.includes(b.g.tag)) continue;
    const byStart = b.chains.slice().sort((x, y) => x.stops[0][1] - y.stops[0][1]);
    for (const x of b.chains) {
      for (;;) {
        const y = byStart.find(y => !y._merged && y !== x && y.stops[0][1] > x.last &&
          !(line.loop && y.stops[0][0] === b.destIdx) && // 環線不跨縫合併:圈尾接圈頭=把整天縫成一台車
          b.dir.steps(x.lastIdx, y.stops[0][0]) >= 1 && b.dir.steps(x.lastIdx, y.stops[0][0]) <= 3 &&
          y.stops[0][1] - x.last >= b.dir.expected(x.lastIdx, y.stops[0][0]) * 0.5 &&
          y.stops[0][1] - x.last <= b.dir.expected(x.lastIdx, y.stops[0][0]) + 240);
        if (!y || x._merged) break;
        x.stops = x.stops.concat(y.stops);
        x.last = y.last; x.lastIdx = y.lastIdx;
        y._merged = true; stats.merged++;
      }
    }
    b.chains = b.chains.filter(c => !c._merged);
  }
  // 縫合:支線頭組的鏈尾 → 目標組「中途始發」鏈的頭(同營運日、行進方向一致、時間吻合)
  for (const b of built) {
    if (!b.g.spec.stitchTo) continue;
    const tgt = built.find(x => x.g.routeId === b.g.spec.stitchTo && x.g.days === b.g.days && x.asc === b.asc);
    if (!tgt) continue;
    const heads = b.chains.slice().sort((x, y) => x.last - y.last);
    const cands = tgt.chains.filter(c => c.stops[0][0] !== tgt.stns[0].idx) // 中途始發才需要接頭
      .sort((x, y) => x.stops[0][1] - y.stops[0][1]);
    for (const h of heads) {
      const c = cands.find(c => !c._stitched && c.stops[0][1] > h.last &&
        b.dir.steps(h.lastIdx, c.stops[0][0]) >= 1 && b.dir.steps(h.lastIdx, c.stops[0][0]) <= 4 &&
        c.stops[0][1] - h.last <= b.dir.expected(h.lastIdx, c.stops[0][0]) + 300);
      if (!c) continue;
      c.stops = h.stops.concat(c.stops);
      c._stitched = true; h._consumed = true;
      stats.stitched++;
    }
    b.chains = b.chains.filter(h => !h._consumed);
  }
  for (const { g, stns, asc, dir, destIdx, chains } of built) {
    // 末端補終點到達(終點站本身無發車記錄)
    if (destIdx != null) for (const c of chains) {
      const li = c.lastIdx;
      if (li === destIdx) continue;
      const k = dir.steps(li, destIdx);
      if (k >= 1 && k <= 3) c.stops.push([destIdx, c.last + dir.expected(li, destIdx)]);
      else if (!g.spec.noDestOk) stats.noDest++;
    }
    // 起點站整份缺記錄(如環狀線大坪林)→ 對「從第一個有記錄站發車」的鏈回推始發
    if (!line.loop && destIdx != null && stns.length) {
      const firstIdx = stns[0].idx;
      const originIdx = asc ? firstIdx - 1 : firstIdx + 1;
      if (originIdx >= 0 && originIdx < ctx.n && !g.stns.has(originIdx)) {
        let fixed = 0;
        for (const c of chains) {
          const [fi, fs] = c.stops[0];
          if (fi !== firstIdx) continue;
          c.stops.unshift([originIdx, fs - dir.expected(originIdx, fi) - ctx.dwellOf(fi)]);
          fixed++;
        }
        if (fixed) notes.push(`${line.id} ${g.routeId}/${g.dir}: 起點站無發車記錄,${fixed} 班以行駛時間回推始發`);
      }
    }
    // 品質閘:至少 2 停靠點、時間嚴格遞增、逐段速度 ≤100km/h;
    // allStop 線(乘客列車站站停)不准跳過「該組有記錄」的站——跳站鏈=髒資料湊出的幻影班次
    const good = [];
    for (const c of chains) {
      if (c.stops.length < 2) { stats.dropped++; continue; }
      let ok = true;
      for (let i = 1; i < c.stops.length; i++) {
        const [ia, ta] = c.stops[i - 1], [ib, tb] = c.stops[i];
        const dKm = line.loop
          ? Math.min(Math.abs(line.stations[ib].d - line.stations[ia].d), line.loopLen - Math.abs(line.stations[ib].d - line.stations[ia].d))
          : Math.abs((line.stations[ib].d ?? 0) - (line.stations[ia].d ?? 0));
        if (tb <= ta || (dKm > 0.3 && dKm / ((tb - ta) / 3600) > 100)) { ok = false; break; }
        if (allStop && Math.abs(ib - ia) > 1 && !line.loop) {
          const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
          for (let m = lo + 1; m < hi; m++) if (g.stns.has(m)) { ok = false; break; }
          if (!ok) break;
        }
      }
      if (ok) good.push(c.stops.flat()); else stats.dropped++;
    }
    stats.trains += good.length;
    for (let w = 0; w < 7; w++) if (g.days[w] === '1') {
      byDay[w].push(...good);
      tagOfDay[w].add(g.tag);
    }
  }
  // 各曜日班表去重成 sets(內容相同共用一份)
  const sets = {}; const days = []; const seen = new Map();
  for (let w = 0; w < 7; w++) {
    const trains = byDay[w].slice().sort((a, b) => a[1] - b[1]);
    const sig = trains.map(t => t[1] + '.' + t[0] + '.' + t.length).join(',');
    if (!seen.has(sig)) {
      const tag = [...tagOfDay[w]].sort().join('+') || '無班次';
      let key = tag, i = 2;
      while (key in sets) key = tag + i++;
      sets[key] = trains; seen.set(sig, key);
    }
    days.push(seen.get(sig));
  }
  return { days, sets, stats };
}

// ── 班距合成(TMRT/三鶯線):首末班+時段班距 → 推算班表 ──
function synthTimes(line, cfg) {
  const ctx = lineCtx(line);
  const dirF = makeDirFns(ctx, false, true);
  const sets = {};
  for (const [tag, sc] of Object.entries(cfg.services)) {
    const trains = [];
    for (const rev of [false, true]) {
      const idxs = [...line.stations.keys()];
      if (rev) idxs.reverse();
      let t = sc.first, guard = 0;
      while (t <= sc.last && guard++ < 500) {
        const stops = [[idxs[0], Math.round(t)]];
        let cur = t;
        for (let i = 1; i < idxs.length; i++) {
          cur += dirF.expected(idxs[i - 1], idxs[i]);
          stops.push([idxs[i], Math.round(cur)]);
          if (i < idxs.length - 1) cur += ctx.dwellOf(idxs[i]);
        }
        trains.push(stops.flat());
        const band = sc.bands.find(b => t >= b[0] && t < b[1]);
        t += band ? band[2] : sc.bands[sc.bands.length - 1][2];
      }
    }
    sets[tag] = trains.sort((a, b) => a[1] - b[1]);
  }
  return { days: cfg.dayMap, sets };
}

// TDX 班距+首末班 → synthTimes 的 cfg(文湖線/台中捷運這類無逐站時刻表的線)
function tdxSynthCfg({ freqFile, routeId, lineIdF, flFile, terminals }) {
  const freq = J(freqFile), fl = J(flFile);
  const services = {};
  for (const [tag, dayKey] of [['平日', 'Monday'], ['假日', 'Saturday']]) {
    const f = freq.find(x => (!routeId || x.RouteID === routeId) && (!lineIdF || x.LineID === lineIdF)
      && x.ServiceDay && (x.ServiceDay.ServiceTag === tag || x.ServiceDay.ServiceTag === '每日' || x.ServiceDay[dayKey]));
    if (!f || !f.Headways || !f.Headways.length) continue;
    const bands = f.Headways.filter(h => h.MinHeadwayMins > 0).map(h => {
      const a = toSec(h.StartTime); let b = toSec(h.EndTime);
      if (b <= a) b += 86400;
      return [a, b, Math.round((h.MinHeadwayMins + h.MaxHeadwayMins) / 2 * 60)];
    });
    const ends = fl.filter(x => terminals.includes(x.StationID) && (!x.ServiceDay || x.ServiceDay[dayKey]));
    if (!ends.length || !bands.length) continue;
    const first = Math.min(...ends.map(x => toSec(x.FirstTrainTime)));
    const last = Math.max(...ends.map(x => { const s = toSec(x.LastTrainTime); return s < 4 * 3600 ? s + 86400 : s; }));
    services[tag] = { first, last, bands };
  }
  return { services, dayMap: ['假日', '平日', '平日', '平日', '平日', '平日', '假日'] };
}

// ═══════════════ 系統定義與執行 ═══════════════
const _stt = new Map(), _stn = new Map();
const sttCache = op => { if (!_stt.has(op)) _stt.set(op, J(`data/tdx/${op}_StationTimeTable.json`)); return _stt.get(op); };
const stnNameCache = op => {
  if (!_stn.has(op)) {
    const m = new Map();
    for (const s of J(`data/tdx/${op}_Station.json`)) m.set(s.StationID, s.StationName.Zh_tw);
    _stn.set(op, m);
  }
  return _stn.get(op);
};

const SYSTEMS = [
  { file: 'data/trtc.json', out: 'data/trtc_times.json',
    src: '台北捷運/新北捷運(環狀線)各站時刻表:交通部TDX運輸資料流通服務(2026-07-11 抓取);班次依平日/週六/週日對應,國定假日未特別處理(以週幾歸類);文湖線無逐站時刻表,以官方班距與首末班推算(非公告時刻)',
    synth: [{ lineId: 'BR', freqFile: 'data/tdx/TRTC_Frequency.json', routeId: 'BR-1',
      flFile: 'data/tdx/TRTC_FirstLastTimetable.json', terminals: ['BR01', 'BR24'] }],
    lines: {
      R: [{ op: 'TRTC', routeId: 'R-1' }, { op: 'TRTC', routeId: 'R-2' }],
      R_XBT: [{ op: 'TRTC', routeId: 'R-3' }],
      G: [{ op: 'TRTC', routeId: 'G-1' }, { op: 'TRTC', routeId: 'G-2' }],
      G_XBT: [{ op: 'TRTC', routeId: 'G-3' }],
      O_XINZHUANG: [{ op: 'TRTC', routeId: 'O-1' }],
      O_LUZHOU: [{ op: 'TRTC', routeId: 'O-2' }],
      BL: [{ op: 'TRTC', routeId: 'BL-1' }, { op: 'TRTC', routeId: 'BL-2' }],
      // 假日資料各站互相矛盾(offset 整天漂移、幸福站雙倍互疊、頭前庄時間亂碼)→ 假日走錨定傳播
      Y: [{ op: 'NTMC', routeId: 'Y-1', anchorTags: ['假日'], drop: [{ station: 'Y19', dir: 1, tag: '假日' }] }],
    } },
  { file: 'data/krtc.json', out: 'data/krtc_times.json',
    src: '高雄捷運/高雄輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-11 抓取);高捷班表分平日(週一~四)/假日前一天(週五)/假日(週六)/週日',
    lines: {
      KR: [{ op: 'KRTC', routeId: 'R' }],
      KO: [{ op: 'KRTC', routeId: 'O' }],
      C: [{ op: 'KLRT', routeId: 'C' }],
    } },
  { file: 'data/tymc.json', out: 'data/tymc_times.json', allStop: false, // 直達車合法跳站
    src: '桃園機場捷運各站時刻表:交通部TDX運輸資料流通服務(2026-07-11 抓取);普通車與直達車皆依實際時刻',
    lines: { A: [{ op: 'TYMC', routeId: 'A-1' }, { op: 'TYMC', routeId: 'A-2' }, { op: 'TYMC', routeId: 'A-3' }] } },
  { file: 'data/ntdlrt.json', out: 'data/ntdlrt_times.json', allStop: false, // 藍海線跨崁頂段+縫合班次有合法跳點
    src: '淡海輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-11 抓取);綠山線/藍海線各依實際時刻',
    // 回程(往紅樹林)的幹線記錄被 TDX 亂拆在 V-1/V-2/空路線編號 → 合併成虛擬路線再鏈;
    // 藍海支線頭(漁人碼頭-台北海洋大學)獨立成組,鏈完縫回幹線的中途始發鏈。
    lines: { V: [
      // 新市一路(V06)假日去程記錄是兩線混班(班距減半)→ 兩路線都排除,列車過站以行駛時間內插
      { op: 'NTDLRT', routeId: 'V-1', destIs: 'V11', drop: [{ station: 'V06', dir: 0, tag: '假日' }] },
      { op: 'NTDLRT', routeId: 'V-2', destIs: 'V26', drop: [{ station: 'V06', dir: 0, tag: '假日' }] },
      { op: 'NTDLRT', routeId: '*', destIs: 'V01', as: 'V-回程幹線',
        only: ['V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10'] },
      { op: 'NTDLRT', routeId: '*', destIs: 'V01', as: 'V-藍海頭', stitchTo: 'V-回程幹線', noDestOk: true,
        only: ['V26', 'V27', 'V28'] },
    ] } },
  { file: 'data/ntalrt.json', out: 'data/ntalrt_times.json',
    src: '安坑輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-11 抓取)',
    lines: { K: [{ op: 'NTALRT', routeId: 'K-1' }] } },
  { file: 'data/tmrt.json', out: 'data/tmrt_times.json', estimated: true,
    src: '台中捷運無公開逐班時刻表:以交通部TDX官方班距(各時段)與首末班車推算班次(2026-07-11 抓取),非公告時刻',
    synth: [{ lineId: 'TG', freqFile: 'data/tdx/TMRT_Frequency.json', lineIdF: 'G',
      flFile: 'data/tdx/TMRT_FirstLastTimetable.json', terminals: ['G0', 'G17'] }],
    lines: {} },
  { file: 'data/sanying.json', out: 'data/sanying_times.json', estimated: true,
    src: '三鶯線試營運,無公開逐班時刻表:以公告班距(尖峰約6分/離峰約8分)與推定營運時段(06:00-23:30)合成,非公告時刻',
    synth: [{ lineId: 'LB', cfg: (() => {
      const mk = peak => [[toSec('06:00'), toSec('09:00'), peak ? 360 : 480], [toSec('09:00'), toSec('17:00'), 480],
        [toSec('17:00'), toSec('20:00'), peak ? 360 : 480], [toSec('20:00'), toSec('24:00'), 480]];
      return { services: { '平日': { first: toSec('06:00'), last: toSec('23:30'), bands: mk(true) },
        '假日': { first: toSec('06:00'), last: toSec('23:30'), bands: mk(false) } },
        dayMap: ['假日', '平日', '平日', '平日', '平日', '平日', '假日'] };
    })() }],
    lines: {} },
];

for (const sys of SYSTEMS) {
  const data = J(sys.file);
  const out = { system: data.system, source_notes: sys.src, lines: {} };
  if (sys.estimated) out.estimated = true;
  const notes = [];
  console.log(`== ${sys.file}`);
  for (const [lid, specs] of Object.entries(sys.lines)) {
    const line = data.lines.find(l => l.id === lid);
    if (!line) { console.warn(`  ⚠ 線檔缺 ${lid}`); continue; }
    const r = buildLineTimes(line, specs, sttCache, stnNameCache, notes, sys.allStop !== false);
    out.lines[lid] = { days: r.days, sets: r.sets };
    const setInfo = Object.entries(r.sets).map(([k, v]) => `${k}:${v.length}班`).join(' ');
    console.log(`  ${lid.padEnd(12)} ${setInfo}  (中途始發${r.stats.midStart} 併碎片${r.stats.merged} 缺終點${r.stats.noDest} 剔除${r.stats.dropped})`);
  }
  for (const s of sys.synth || []) {
    const line = data.lines.find(l => l.id === s.lineId);
    if (!line) { console.warn(`  ⚠ 線檔缺 ${s.lineId}`); continue; }
    const cfg = s.cfg || tdxSynthCfg(s);
    if (!Object.keys(cfg.services).length) { console.warn(`  ⚠ ${s.lineId}: 班距/首末班資料不足,無法合成`); continue; }
    const r = synthTimes(line, cfg);
    out.lines[s.lineId] = { days: r.days, sets: r.sets, estimated: true };
    console.log(`  ${s.lineId.padEnd(12)} ${Object.entries(r.sets).map(([k, v]) => `${k}:${v.length}班`).join(' ')}  (班距合成)`);
  }
  for (const n of notes) console.log(`  ℹ ${n}`);
  writeFileSync(path.join(ROOT, sys.out), JSON.stringify(out));
  console.log(`  → ${sys.out} ${(JSON.stringify(out).length / 1024).toFixed(0)}KB`);
}
console.log('done');

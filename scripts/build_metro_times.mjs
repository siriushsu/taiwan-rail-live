#!/usr/bin/env node
// 捷運實際時刻表:TDX StationTimeTable(逐站發車時刻)→ 逐班車清單,供前端以真實時鐘定位列車。
//   輸入 data/tdx/{OP}_StationTimeTable.json + {OP}_Station.json + 前端線檔 data/*.json
//   輸出 data/{trtc,krtc,tymc,ntdlrt,ntalrt,tmrt,sanying}_times.json
// 重建法:每條營運路線(RouteID×方向×目的地×營運日)沿站序做「單調鏈匹配」——
//   相鄰站的預期行駛秒(線檔 segs.run+停站)開時間窗,發車時刻逐站串成一班車;
//   窗前多出的發車=中途始發(如板南線亞東醫院加班車),缺配對=通過不停(機捷直達)。
// 台中捷運/三鶯線無 StationTimeTable → 以官方班距+首末班合成(estimated 標記)。
// 輸出格式:lines[id] = { days:[週日..週六 → set 名], sets:{名:[班...]}, holiday:國定假日 set 名,
//   kinds:{名:車種字串} };
//   一班 = [idx,sec, idx,sec, ...] 攤平的 (線檔站序 index, 當日發車秒) 對,跨午夜 sec>86400。
//   kinds 只在上游有 TrainType 時輸出(目前只有機捷):與同名 set 等長同序,一班一字元
//   —— 機捷 '1'=普通車 '2'=直達車(TDX TrainType 原值),'0'=官方未標。
// 用法:node scripts/build_metro_times.mjs [--force-trtc] [--only=<字串>]
//   --force-trtc:無視下面的 TRTC 來源閘門硬重建北捷(補齊前只用於驗證,不要拿產物出貨)。
//   --only=<字串>:只重建輸出檔名含該字串的系統(如 --only=sanying)。data/tdx 是未追蹤快照,
//     工作樹裡常常是空的,這時整份重跑會在第一個吃 TDX 的系統就 ENOENT 中斷,連不吃 TDX 的
//     合成線(三鶯線)都重建不了;要重跑全部就先 python3 scripts/fetch_tdx.py 補快照。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySpecialOps } from './special_ops.mjs';

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
function depsOf(timetables) {
  const set = new Set();
  let junk = 0;
  for (const t of timetables) {
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
// stitchTo(本組鏈尾接到目標組的中途始發鏈,治藍海支線頭與幹線分家)、noDestOk(不計缺終點)、
// requireFirst(只留從此站發起的鏈:幹線記錄混含多線班次時,擋掉對方線造成的幻影中途始發車)、
// destByPattern/originByPattern(StoppingPatternID → 該停靠模式的官方端點 StationID):
//   StoppingPatternID 只在同一個 RouteID 內唯一;覆寫不得掛在 routeId:'*' 或帶 as: 的合併 spec 上
//   (反例:TYMC A-2/dir0 也使用 SP2,且其記錄級終點是 A13),否則會跨路線誤命中。
//   TDX 的 DestinationStaionID 是**記錄級**標籤,一筆記錄裡混著多種停靠模式時它只會是其中一種
//   (機捷 A-1 的 SP1 普通車與 SP5 直達車共用 DestinationStaionID=A22),拿它當直達車的終點
//   就會南下少補一站(鏈尾 A18 到記錄級終點 A22 是四步,被補終點的三步門檻擋掉,於是連正確的
//   終點 A21 都沒補上;A18→A21 其實只有三步,在窗內)、北上憑空多一站
//   (起點回推規則往前補了 A22,而官方 A22 的直達車欄位整欄都是「-」)。
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
      const nh = !!rec.ServiceDay.NationalHolidays; // 國定假日適用的班表(高捷=假日(週六型),多數系統=週末型)
      if ((spec.drop || []).some(x => x.station === rec.StationID && x.dir === rec.Direction && x.tag === rec.ServiceDay.ServiceTag)) {
        notes.push(`${line.id} ${rec.StationID}/dir${rec.Direction}/${rec.ServiceDay.ServiceTag}: 已知損壞記錄,整筆排除`);
        continue;
      }
      // 依 StoppingPatternID 分流成組:同一(RouteID/方向/終點)裡混著直達與普通車時,
      // chainRoute 的最近時間配對會在直達車超車路段(機捷南下 長庚→台北)把兩種車的到站時刻串錯
      // (issue #9:普通車過長庚只停新北產業、直達車過長庚卻站站停)。同一停靠模式內無超車、
      // FIFO,分開串接才精確。只有機捷(TYMC)帶此欄位;其餘各線 Timetables 無 StoppingPatternID
      // → 全落單一 '' 桶,分組與行為與先前完全一致(no-op)。
      const patBuckets = new Map();
      for (const t of rec.Timetables) {
        const pat = t.StoppingPatternID ?? '';
        if (!patBuckets.has(pat)) patBuckets.set(pat, []);
        patBuckets.get(pat).push(t);
      }
      for (const [pat, tts] of patBuckets) {
        const deps = depsOf(tts);
        if (!deps) {
          notes.push(`${line.id} ${rec.StationID}/dir${rec.Direction}/${rec.ServiceDay.ServiceTag}${pat ? '/' + pat : ''}: 髒值過多(時間亂碼),整筆排除`);
          continue;
        }
        const gname = spec.as || routeId;
        // 記錄級的 dest 對混模式記錄不成立 → 該停靠模式有官方端點就以它為準(見 destByPattern 註解)
        const destId = spec.destByPattern && spec.destByPattern[pat];
        const patternDest = destId && stnName.get(destId);
        if (destId && !patternDest)
          console.warn(`  ⚠ ${line.id} ${routeId}/${pat || "''"}: destByPattern 站號 ${destId} 查不到站名`);
        const groupDest = patternDest || dest;
        const key = [gname, spec.as ? '' : rec.Direction, groupDest, days, nh ? 'H' : '', pat].join('|');
        // 車種:TDX 每筆發車帶 TrainType(機捷 1=普通車 2=直達車),同一 StoppingPatternID 內恆一致
        // → 掛在組上,讓前端不必再用停靠站序回推車種(首末班的跳站普通車回推不出來)。
        const trainType = tts[0].TrainType ?? null;
        if (!groups.has(key)) groups.set(key, { routeId: gname, dir: rec.Direction ?? 0, dest: groupDest, days, nh, tag: rec.ServiceDay.ServiceTag, pat, trainType, spec, stns: new Map(),
          reqFirstIdx: spec.requireFirst ? ctx.idxOf.get(stnName.get(spec.requireFirst)) : null });
        const g = groups.get(key);
        if (g.trainType !== trainType)
          console.warn(`  ⚠ ${line.id} ${routeId}/${pat || "''"}: 同組出現兩種 TrainType(${g.trainType} vs ${trainType}),車種標記以先到者為準`);
        const idx = ctx.idxOf.get(name);
        if (g.stns.has(idx)) { // 同組同站多筆記錄(虛擬路線合併時)→ 取聯集
          const merged = new Set([...g.stns.get(idx).deps, ...deps]);
          g.stns.set(idx, { idx, deps: [...merged].sort((a, b) => a - b) });
        } else g.stns.set(idx, { idx, deps });
      }
    }
  }
  // pattern 端點覆寫若完全沒對到任何實際 group,上游 pattern 改名時必須明確告警
  for (const spec of routeSpecs) for (const field of ['destByPattern', 'originByPattern']) {
    const byPattern = spec[field];
    if (!byPattern) continue;
    const declared = Object.keys(byPattern);
    const actual = [...new Set([...groups.values()].filter(g => g.spec === spec).map(g => g.pat))];
    if (!actual.some(pat => Object.prototype.hasOwnProperty.call(byPattern, pat)))
      console.warn(`  ⚠ ${line.id} ${spec.routeId} ${field}: 覆寫從未命中;宣告 pattern=${declared.join(',') || '(無)'},實際 pattern=${actual.map(pat => pat || "''").join(',') || '(無)'}`);
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
  const byHol = [], holTags = new Set(); // NationalHolidays 記錄另聚一份:國定假日(含落在平日者)適用
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
  // 支線端過濾(requireFirst):幹線記錄混含兩線班次(拆線後的淡海)→
  // 只留從本線支線端發起的鏈,對方線的幹線段/雜訊碎片不會生成幻影班次
  for (const b of built) {
    if (b.g.reqFirstIdx == null) continue;
    const before = b.chains.length;
    b.chains = b.chains.filter(c => c.stops[0][0] === b.g.reqFirstIdx);
    stats.dropped += before - b.chains.length;
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
      // 該停靠模式有官方起點就用它;沒有才退回「往前補一站」的通用推測。機捷 SP2 北上直達車的
      // 官方起點是 A21 環北,而 A21 本來就在這個 group 裡 ⇒ 下面的 !g.stns.has(originIdx) 會擋掉
      // 回推,不再憑空生出 A22 老街溪(官方 A22 的直達車欄整欄都是「-」)。
      const originId = g.spec.originByPattern && g.spec.originByPattern[g.pat];
      const originIdx = originId
        ? ctx.idxOf.get(stnNameCache(g.spec.op).get(originId))
        : (asc ? firstIdx - 1 : firstIdx + 1);
      // 與 destByPattern 同一組防呆:站號查不到就會靜默退化成「完全不回推」,不叫的話看不出來
      if (originId && originIdx == null)
        console.warn(`  ⚠ ${line.id} ${g.routeId}/${g.pat || "''"}: originByPattern 站號 ${originId} 在此線查不到站序`);
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
      if (!ok) { stats.dropped++; continue; }
      const tr = c.stops.flat();
      if (g.trainType != null) tr.kind = g.trainType; // 陣列的非索引屬性不會被 JSON.stringify 輸出
      good.push(tr);
    }
    stats.trains += good.length;
    for (let w = 0; w < 7; w++) if (g.days[w] === '1') {
      byDay[w].push(...good);
      tagOfDay[w].add(g.tag);
    }
    if (g.nh) { byHol.push(...good); holTags.add(g.tag); }
  }
  // 各曜日班表去重成 sets(內容相同共用一份)
  const sets = {}; const kinds = {}; const days = []; const seen = new Map();
  // kinds[set 名] = 與該 set 等長同序的車種字串,一班一字元('0'=官方未標);無車種資料的線不輸出
  const kindStr = trains => { const s = trains.map(t => t.kind || 0).join(''); return /[^0]/.test(s) ? s : null; };
  for (let w = 0; w < 7; w++) {
    const trains = byDay[w].slice().sort((a, b) => a[1] - b[1]);
    const sig = trains.map(t => t[1] + '.' + t[0] + '.' + t.length + '.' + (t.kind || 0)).join(',');
    if (!seen.has(sig)) {
      const tag = [...tagOfDay[w]].sort().join('+') || '無班次';
      let key = tag, i = 2;
      while (key in sets) key = tag + i++;
      sets[key] = trains; seen.set(sig, key);
      const ks = kindStr(trains); if (ks) kinds[key] = ks;
    }
    days.push(seen.get(sig));
  }
  // 國定假日 set:內容通常與某週末 set 相同(共用一份,不增檔案大小);高捷=假日(週六型)≠週日,靠 NH 旗標選對
  let holiday = null;
  if (byHol.length) {
    const trains = byHol.slice().sort((a, b) => a[1] - b[1]);
    const sig = trains.map(t => t[1] + '.' + t[0] + '.' + t.length + '.' + (t.kind || 0)).join(',');
    if (!seen.has(sig)) {
      const tag = [...holTags].sort().join('+') || '國定假日';
      let key = tag, i = 2;
      while (key in sets) key = tag + i++;
      sets[key] = trains; seen.set(sig, key);
      const ks = kindStr(trains); if (ks) kinds[key] = ks;
    }
    holiday = seen.get(sig);
  }
  return { days, sets, holiday, kinds, stats };
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
      const runAt = dep => { // 一班車:自起點 dep 秒發車,逐站累加行駛秒與停站秒
        const stops = [[idxs[0], Math.round(dep)]];
        let cur = dep;
        for (let i = 1; i < idxs.length; i++) {
          cur += dirF.expected(idxs[i - 1], idxs[i]);
          stops.push([idxs[i], Math.round(cur)]);
          if (i < idxs.length - 1) cur += ctx.dwellOf(idxs[i]);
        }
        return stops.flat();
      };
      let t = sc.first, guard = 0, lastDep = null;
      while (t <= sc.last && guard++ < 500) {
        trains.push(runAt(t));
        lastDep = t;
        const band = sc.bands.find(b => t >= b[0] && t < b[1]);
        t += band ? band[2] : sc.bands[sc.bands.length - 1][2];
      }
      // 末班補一班:班距格點不一定落在 sc.last 上,落不到就等於把官方公告的末班發車時刻整個
      // 抹掉。三鶯線平日 6 分/8 分混排,最後一班停在 23:54,而官方逐站表寫明兩端點末班都是
      // 00:00(2026-09-11 實查 node=863 的 1150814 圖)。first 照官方抄、last 也照官方抄,
      // 兩端都要有車;格點本來就命中 last 的(三鶯線假日、整點整除的班距)不會多出一班。
      if (lastDep !== null && lastDep < sc.last) trains.push(runAt(sc.last));
    }
    sets[tag] = trains.sort((a, b) => a[1] - b[1]);
  }
  return { days: cfg.dayMap, sets, holiday: cfg.dayMap[0] }; // 班距合成線:國定假日=週日型班距
}

// 文湖線是全網唯一沒有官方逐班時刻的線(TDX StationTimeTable 端點說明明文寫「臺北捷運目前無提供
// 文湖線站別時刻表,建議您可使用取得捷運路線發車班距頻率資料」),只能合成。而 TDX 公告的是「範圍」,
// 取中點對 BR 系統性偏疏 ⇒ 畫面比實際少約三成車。下表是 2026-08-02/08-03 用官方逐車 feed 累積
// 8 萬筆到站事件實測的各時段實際班距(中位),對照組 BL 0.93/R 0.99/G 0.98/O 0.99 皆在 0.9~1.1。
// 🔴 這是「只覆蓋 BR 一線」,不是把中點公式改成取範圍下限——後者實測會讓 18 組線×日型中
//    超標的從 4 組變 12 組(小碧潭公告 12~20 卻實際跑 18 分=貼上限)。見
//    memory/metro-offpeak-headway-formula.md。要覆蓋別條線必須先有同等級的實測與對照組。
// 沒量到的時段(平日 06-07、19:30-23、23-24)刻意留空,自動落回公告中點:bands 查表是
// `.find` 取第一個命中,實測帶排在公告帶前面即可,不必去切公告帶。
const BR_MEASURED_HEADWAY = {
  平日: [['07:00', '09:00', 132], ['09:00', '17:00', 276], ['17:00', '19:30', 144]],
  假日: [['06:00', '07:00', 390], ['07:00', '09:00', 366], ['09:00', '17:00', 252],
    ['17:00', '19:30', 240], ['19:30', '23:00', 300], ['23:00', '24:00', 450]],
};

// TDX 班距+首末班 → synthTimes 的 cfg(文湖線/台中捷運這類無逐站時刻表的線)
function tdxSynthCfg({ freqFile, routeId, lineIdF, flFile, terminals, measured }) {
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
    const obs = ((measured || {})[tag] || []).map(([a, b, sec]) => [toSec(a), toSec(b) || 86400, sec]);
    services[tag] = { first, last, bands: [...obs, ...bands] }; // 實測帶優先，其餘落回公告中點
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
    src: '台北捷運/新北捷運(環狀線)各站時刻表:交通部TDX運輸資料流通服務(2026-07-16 抓取);班次依平日/週六/週日/國定假日對應;文湖線無逐站時刻表,以官方班距與首末班推算(非公告時刻)',
    synth: [{ lineId: 'BR', freqFile: 'data/tdx/TRTC_Frequency.json', routeId: 'BR-1',
      flFile: 'data/tdx/TRTC_FirstLastTimetable.json', terminals: ['BR01', 'BR24'],
      measured: BR_MEASURED_HEADWAY }],
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
    src: '高雄捷運/高雄輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-16 抓取);高捷班表分平日(週一~四)/假日前一天(週五)/假日(週六)/週日,國定假日跑假日班表',
    lines: {
      KR: [{ op: 'KRTC', routeId: 'R' }],
      KO: [{ op: 'KRTC', routeId: 'O' }],
      C: [{ op: 'KLRT', routeId: 'C' }],
    } },
  { file: 'data/tymc.json', out: 'data/tymc_times.json', allStop: false, // 直達車合法跳站
    src: '桃園機場捷運各站時刻表:交通部TDX運輸資料流通服務(2026-07-16 抓取);普通車與直達車皆依實際時刻',
    lines: { A: [
      // SP5=南下直達、SP2=北上直達,兩者都與 SP1 普通車共用同一筆記錄的 DestinationStaionID=A22。
      // 官方(tymetro.com.tw 各站時刻表)：直達車兩端是 A1 台北車站 ↔ A21 環北,不到 A22 老街溪。
      { op: 'TYMC', routeId: 'A-1', destByPattern: { SP5: 'A21' }, originByPattern: { SP2: 'A21' } },
      { op: 'TYMC', routeId: 'A-2' },
      { op: 'TYMC', routeId: 'A-3' },
    ] } },
  { file: 'data/ntdlrt.json', out: 'data/ntdlrt_times.json', allStop: false,
    src: '淡海輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-16 抓取);綠山線/藍海線各依實際時刻',
    // 線檔已拆綠山線(V)/藍海線(VB)兩條實際營運線(分岔在濱海沙崙),各自站序連續。
    // 回程(往紅樹林)的幹線記錄被 TDX 亂拆在 V-1/V-2/空路線編號 → 合併成虛擬路線再鏈;
    // 幹線記錄混含兩線班次 → requireFirst 只留從本線支線端(V10淡海新市鎮/V26漁人碼頭)發起的鏈。
    lines: { V: [
      // 新市一路(V06)假日去程記錄是兩線混班(班距減半)→ 兩路線都排除,列車過站以行駛時間內插
      { op: 'NTDLRT', routeId: 'V-1', destIs: 'V11', drop: [{ station: 'V06', dir: 0, tag: '假日' }] },
      { op: 'NTDLRT', routeId: '*', destIs: 'V01', as: 'V-回程', requireFirst: 'V10',
        only: ['V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10'] },
    ], VB: [
      { op: 'NTDLRT', routeId: 'V-2', destIs: 'V26', drop: [{ station: 'V06', dir: 0, tag: '假日' }] },
      { op: 'NTDLRT', routeId: '*', destIs: 'V01', as: 'VB-回程', requireFirst: 'V26',
        only: ['V26', 'V27', 'V28', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09'] },
    ] } },
  { file: 'data/ntalrt.json', out: 'data/ntalrt_times.json',
    src: '安坑輕軌各站時刻表:交通部TDX運輸資料流通服務(2026-07-16 抓取)',
    lines: { K: [{ op: 'NTALRT', routeId: 'K-1' }] } },
  { file: 'data/tmrt.json', out: 'data/tmrt_times.json', estimated: true,
    src: '台中捷運無公開逐班時刻表:以交通部TDX官方班距(各時段)與首末班車推算班次(2026-07-16 抓取),非公告時刻',
    synth: [{ lineId: 'TG', freqFile: 'data/tdx/TMRT_Frequency.json', lineIdF: 'G',
      flFile: 'data/tdx/TMRT_FirstLastTimetable.json', terminals: ['G0', 'G17'] }],
    lines: {} },
  { file: 'data/sanying.json', out: 'data/sanying_times.json', estimated: true,
    src: '三鶯線無公開逐班時刻表:營運時段06:00-24:00(各站首末班)與站間行駛時間取自交通部TDX運輸資料流通服務(新北捷運三鶯線,2026-09-12 抓取),班距依新北捷運公司公告(平日尖峰06:30-08:30、17:30-19:30 6分/平日離峰及假日8分)合成,非公告時刻',
    // 首末班自 2026-09-12 起改吃 TDX 官方逐站首末班表(該日 TDX 以 NTMC 營運商上架三鶯線):
    //   兩端點 LB01 頂埔 / LB12 鶯桃福德,平日假日都是 06:00 首班、00:00 末班,與先前照抄官方
    //   node=863 公告「6時至24時」得到的值相同,但自此隨官方更新,不必再有人記得回來改。
    //   沿用本檔既有慣例:首/末班是【發車】時刻,故末班 24:00 前發車、跑完全程約 00:28 到站。
    // ⏰ 班距仍是會過期的手抄值,到期必重查 https://www.ntmetro.com.tw/basic/?mode=detail&node=863
    //   官方 node=863 逐字:「將以尖峰(06:30~08:30;17:30~19:30)約 6分鐘、離峰及假日約8分鐘的
    //   班距運行。並視搭乘人潮狀況機動加班。」——本處逐字照抄該組數字,不自行詮釋。
    //   TDX 的 Frequency/NTMC 查無 LB(2026-09-12 實查),所以班距還接不上官方機讀資料。
    //   兩個已知的到期訊號:
    //   (1) 官方站 node=863/10165 換新班距文字時,以官方文字為準覆蓋本處;
    //   (2) 官方稱「視搭乘人潮狀況機動加班」→ 班距是公告值,不等於實際發車。
    //   注意反例:v0711j 把「正式營運後」的規劃當成現況寫死 06:00-23:30,每天生出 7.5 小時
    //   不存在的幽靈列車(使用者 2026-07-18 回報)——公告的【現況】才能抄,規劃不能。
    synth: [{ lineId: 'LB', cfg: (() => {
      const OFF = 480, PEAK = 360;
      // 端點首末班取官方值:同 tdxSynthCfg 的取法(首班取兩端最早、末班取兩端最晚,跨午夜補一日)
      const fl = J('data/tdx/NTMC_FirstLastTimetable.json')
        .filter(x => ['LB01', 'LB12'].includes(x.StationID));
      const flOf = dayKey => {
        const ends = fl.filter(x => !x.ServiceDay || x.ServiceDay[dayKey]);
        if (!ends.length) throw new Error(`三鶯線首末班:NTMC_FirstLastTimetable 查無端點(${dayKey})`);
        return {
          first: Math.min(...ends.map(x => toSec(x.FirstTrainTime))),
          last: Math.max(...ends.map(x => { const t = toSec(x.LastTrainTime); return t < 4 * 3600 ? t + 86400 : t; })),
        };
      };
      const wd = flOf('Monday'), we = flOf('Saturday');
      // 平日雙尖峰(06:30-08:30 早、17:30-19:30 晚)6 分;假日全天 8 分,無尖峰
      return { services: {
        '平日': { ...wd, bands: [[wd.first, toSec('06:30'), OFF], [toSec('06:30'), toSec('08:30'), PEAK],
          [toSec('08:30'), toSec('17:30'), OFF],
          [toSec('17:30'), toSec('19:30'), PEAK], [toSec('19:30'), wd.last, OFF]] },
        '假日': { ...we, bands: [[we.first, we.last, OFF]] } },
        dayMap: ['假日', '平日', '平日', '平日', '平日', '平日', '假日'] };
    })() }],
    lines: {} },
];

// 🔴 TRTC 來源閘門(2026-09-08 使用者裁示「把 TRTC 排除在自動重建之外」)
// TDX 的 TRTC 快照自 v38 起就缺信義線東延段新站 R01 廣慈/奉天宮(北捷自己在 data.taipei 發布的
// 是完整的,缺口在 TDX 匯入端);拿它重建會讓 R 線班次數掉 38%、幹線最大空檔 13→400+ 分。
// 這道閘門的存在理由是:build 一次重建「所有」系統,所以別家(淡海/安坑/環狀線)一有班表變動,
// 就會連帶用這份殘缺快照把 trtc_times.json 一起重建掉——2026-09-08 巡檢就是這樣被 gate 擋下的。
// 判準是「StationTimeTable/TRTC 查不查得到 R01」:TDX 補齊的那天閘門自動失效,不必有人回來拆。
// 🔴 判準原本掛在 Station/TRTC,2026-09-12 巡檢實查發現它已經失明:TDX 於 09-10 把 R01 補進
//    Station 與 StationOfLine,但 StationTimeTable 至今仍無 R01(當日實打端點,614 筆零命中)。
//    也就是說舊判準會在缺口還在的時候就放行重建,正好放掉它要擋的那件事(R 線班次掉 38%)。
//    判準要盯的是「這次重建真正要讀的那份資料」,不是同一個上游的另一份。
const FORCE_TRTC = process.argv.includes('--force-trtc');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length);
const trtcSourceHasR01 = () => {
  try {
    const st = J('data/tdx/TRTC_StationTimeTable.json');
    return (Array.isArray(st) ? st : st.value || []).some(r => String(r.StationID) === 'R01');
  } catch { return false; } // 快照不在就當作沒補齊——寧可不重建,不要產出壞班表
};

for (const sys of SYSTEMS) {
  if (ONLY && !sys.out.includes(ONLY)) continue;
  if (sys.out === 'data/trtc_times.json' && !FORCE_TRTC && !trtcSourceHasR01()) {
    console.log(`== ${sys.file}`);
    console.log('  ⏭ 跳過重建:TDX 的 TRTC 快照仍缺 R01 廣慈/奉天宮(信義線東延段),重建會產生殘缺 R 線班表。');
    console.log('     TDX 上架 R01 後本閘門自動失效;要強制重建加 --force-trtc。');
    continue;
  }
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
    if (r.holiday) out.lines[lid].holiday = r.holiday;
    if (Object.keys(r.kinds).length) out.lines[lid].kinds = r.kinds;
    const setInfo = Object.entries(r.sets).map(([k, v]) => `${k}:${v.length}班`).join(' ');
    console.log(`  ${lid.padEnd(12)} ${setInfo}  (中途始發${r.stats.midStart} 併碎片${r.stats.merged} 缺終點${r.stats.noDest} 剔除${r.stats.dropped})`);
  }
  for (const s of sys.synth || []) {
    const line = data.lines.find(l => l.id === s.lineId);
    if (!line) { console.warn(`  ⚠ 線檔缺 ${s.lineId}`); continue; }
    const cfg = s.cfg || tdxSynthCfg(s);
    if (!Object.keys(cfg.services).length) { console.warn(`  ⚠ ${s.lineId}: 班距/首末班資料不足,無法合成`); continue; }
    const r = synthTimes(line, cfg);
    out.lines[s.lineId] = { days: r.days, sets: r.sets, holiday: r.holiday, estimated: true };
    console.log(`  ${s.lineId.padEnd(12)} ${Object.entries(r.sets).map(([k, v]) => `${k}:${v.length}班`).join(' ')}  (班距合成)`);
  }
  for (const n of notes) console.log(`  ℹ ${n}`);
  applySpecialOps(out, sys.out, ROOT);
  writeFileSync(path.join(ROOT, sys.out), JSON.stringify(out));
  console.log(`  → ${sys.out} ${(JSON.stringify(out).length / 1024).toFixed(0)}KB`);
}
console.log('done');

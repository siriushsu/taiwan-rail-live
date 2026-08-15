// 北捷「官方即時優先」名冊的純函式核心。
//
// 這裡刻意不讀班表，也不接受 tripKey。每一筆 collapseClaims() 輸出的 row 都是一台
// 當輪應顯示的車；班表車次若日後能辨認，只能在本名冊之外附加標籤，不能決定車的存在。

export const OFFICIAL_ROSTER_SCHEMA = 4;
export const OFFICIAL_COAST_DWELL_DEFAULT_SEC = 25;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`official roster row 的 ${label} 必須是有限數字`);
  return number;
}

function stationCount(model, lineId) {
  const line = model && model.lines instanceof Map ? model.lines.get(lineId) : model && model.lines && model.lines[lineId];
  const count = line && Array.isArray(line.stations) ? line.stations.length : 0;
  if (count < 2) throw new TypeError(`official roster 找不到 ${lineId} 的路線站序`);
  return count;
}

function normalizeRow(model, raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('official roster row 必須是物件');
  const line = String(raw.line || '').trim();
  const dir = finite(raw.dir, 'dir');
  const from = finite(raw.from, 'from');
  const to = finite(raw.to, 'to');
  const dest = finite(raw.dest ?? raw.destIdx, 'dest');
  const run = finite(raw.run, 'run');
  const arrEpoch = finite(raw.arrEpoch, 'arrEpoch');
  if (!line || (dir !== 1 && dir !== 2) || !Number.isInteger(from) || !Number.isInteger(to) ||
      !Number.isInteger(dest) || run < 0) {
    throw new TypeError('official roster row 的 line/dir/from/to/dest/run 形狀不合法');
  }
  const count = stationCount(model, line);
  if (from < 0 || from >= count || to < 0 || to >= count || dest < 0 || dest >= count) {
    throw new RangeError(`official roster row 超出 ${line} 站序`);
  }
  const terminal = Boolean(raw.terminal) || (from === to && run === 0);
  const sourceNo = String(raw.no || '').trim();
  const step = dir === 2 ? 1 : -1;
  if (!terminal && to !== from + step) throw new TypeError('official roster 非停站 row 必須是相鄰區間');
  const ownSegment = { from, to, depEpoch: terminal ? arrEpoch : arrEpoch - run, arrEpoch, terminal };
  const rawTimeline = Array.isArray(raw.timeline) && raw.timeline.length ? [...raw.timeline, ownSegment] : [ownSegment];
  const timelineByLeg = new Map();
  for (const item of rawTimeline) {
    const eventFrom = finite(item && item.from, 'timeline.from');
    const eventTo = finite(item && item.to, 'timeline.to');
    const eventDep = finite(item && item.depEpoch, 'timeline.depEpoch');
    const eventArr = finite(item && item.arrEpoch, 'timeline.arrEpoch');
    const eventTerminal = Boolean(item && item.terminal) || eventFrom === eventTo;
    if (!Number.isInteger(eventFrom) || !Number.isInteger(eventTo) || eventFrom < 0 || eventFrom >= count ||
        eventTo < 0 || eventTo >= count || (!eventTerminal && eventTo !== eventFrom + step) ||
        (eventTerminal ? eventDep !== eventArr : !(eventDep < eventArr))) {
      throw new TypeError('official roster timeline 形狀不合法');
    }
    const segment = { from: eventFrom, to: eventTo, depEpoch: eventDep, arrEpoch: eventArr,
      terminal: eventTerminal };
    const key = `${eventFrom}>${eventTo}`, old = timelineByLeg.get(key);
    if (!old || segment.arrEpoch > old.arrEpoch) timelineByLeg.set(key, segment);
  }
  const timeline = [...timelineByLeg.values()].sort((a, b) =>
    step * (a.to - b.to) || a.arrEpoch - b.arrEpoch);
  return { line, dir, from, to, dest, run, arrEpoch, terminal, sourceNo, timeline };
}

function routePosition(item) {
  return Number(item.dir) === 2 ? Number(item.to) : -Number(item.to);
}

function rowKey(row) {
  return JSON.stringify([row.line, row.dir, row.dest, routePosition(row), row.from, row.to,
    row.arrEpoch, row.run, row.terminal ? 1 : 0, row.sourceNo,
    row.timeline.map(item => [item.from, item.to, item.depEpoch, item.arrEpoch, item.terminal ? 1 : 0])]);
}

function compareRows(a, b) {
  return a.line.localeCompare(b.line) || a.dir - b.dir || a.dest - b.dest ||
    routePosition(a) - routePosition(b) || a.arrEpoch - b.arrEpoch || a.from - b.from ||
    a.to - b.to || a.run - b.run || a.sourceNo.localeCompare(b.sourceNo) || a.occurrence - b.occurrence;
}

function canonicalRows(model, rows) {
  const normalized = (rows || []).map(row => normalizeRow(model, row)).sort((a, b) => {
    const ak = rowKey(a), bk = rowKey(b);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  // 完全相同的列合一（fail closed）：line/dir/起訖/dest/ETA/車號/timeline 全同的兩筆，
  // 現有證據無法證明是兩個身分；各發一個 ID 就是 2026-08-15 斷訊恢復後幽靈車的來源之一。
  // 顯示一台永遠比製造幽靈安全；合掉幾筆記進 duplicateRowsCollapsed 供哨兵監看。
  const byKey = new Map();
  let duplicateRowsCollapsed = 0;
  for (const row of normalized) {
    const key = rowKey(row);
    if (byKey.has(key)) { duplicateRowsCollapsed++; continue; }
    row.occurrence = 0;
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()].sort(compareRows), duplicateRowsCollapsed };
}

// 一台車從起點到終點只有一個身分。官方修訂終點標示時，不得因 dest 換群而重發 ID。
function groupKey(item) { return `${item.line}|${Number(item.dir)}`; }

function previousVehicles(prior, day) {
  if (!prior || String(prior.day || '') !== String(day)) return [];
  return Array.isArray(prior.vehicles) ? prior.vehicles.filter(Boolean) : [];
}

function initialSequence(prior, day) {
  if (prior && String(prior.day || '') === String(day) && Number.isInteger(Number(prior.nextSequence)) &&
      Number(prior.nextSequence) > 0) return Number(prior.nextSequence);
  return 1;
}

function allocateVehicleId(state) {
  let id;
  do {
    id = `ov:${state.day}:${state.nextSequence.toString(36).padStart(6, '0')}`;
    state.nextSequence += 1;
  } while (state.reservedIds.has(id));
  state.reservedIds.add(id);
  return id;
}

function terminalOccurrenceRolled(prior, current, nowEpoch) {
  if (!prior.terminal || !current.terminal || Number(prior.from) !== Number(current.from)) return false;
  // 舊車的發車時刻已過，而同方向起點又出現一個未來倒數，這就是另一趟新發車。
  // 不用任意秒數門檻：同一筆仍停在過去的舊資料可接回，真正的未來倒數才出生。
  return Number(prior.arrEpoch) <= nowEpoch && Number(current.arrEpoch) > nowEpoch;
}

function physicallyReachable(model, prior, current, nowEpoch) {
  const before = Number(prior.routePosition ?? routePosition(prior));
  const after = routePosition(current), advance = after - before;
  // 官方 ETA 回修最多容許退一站，交給前端單調顯示水位吸收；更遠的反向跳接不是同一台車。
  if (advance < -1) return false;
  if (advance <= 0) return true;
  // 無車號線的分組邊界每 15 秒可能改變；只靠路線順序會把下一班的倒數接到前車，
  // 實測 BR 因此產生 3、7、16 秒就「抵達下一站」的假 history。相鄰站的官方到站 epoch
  // 差必須至少容得下實際路段行車秒；不符就是另一台車，不能拿來讓原車飛馳。
  const step = Number(current.dir) === 2 ? 1 : -1;
  let station = Number(prior.to), required = 0;
  for (let moved = 0; moved < advance; moved++) {
    const next = station + step;
    const run = segmentRun(model, current.line, station, next);
    if (!(run > 0)) return false;
    required += run;
    station = next;
  }
  const observed = Number(prior.observedEpoch);
  if (!Number.isFinite(observed)) return false;
  const elapsed = Math.max(0, Number(nowEpoch) - observed);
  // ETA 本身可能在兩輪之間修早幾秒；用真正經過的觀測秒補上這段修訂誤差。兩者相加仍跑不完
  // 該段才是不可能配對。這不是固定容忍門檻，輪詢 15 秒就只多 15 秒，不能放大成一整站。
  if (Number(current.arrEpoch) - Number(prior.arrEpoch) + elapsed < required) return false;
  // target station 第二格起，除了到站時軸要可達，觀測之間也必須真的已經跑完中間段。
  if (advance <= 1) return true;
  return elapsed >= required - segmentRun(model, current.line, Number(prior.to), Number(prior.to) + step);
}

function matchFeasible(model, prior, current, nowEpoch) {
  if (terminalOccurrenceRolled(prior, current, nowEpoch)) return false;
  // 新的起點倒數是新一趟，不得吸走已經離站的舊車；舊起點倒數則可接到它離站後的第一段。
  if (current.terminal && !prior.terminal) return false;
  // 車號只作標籤，絕不能凌駕物理可達距離把永安市場的車拖到丹鳳。
  return physicallyReachable(model, prior, current, nowEpoch);
}

function timelineContinuity(prior, current) {
  const previous = new Map((Array.isArray(prior && prior.timeline) ? prior.timeline : []).map(item =>
    [`${Number(item.from)}>${Number(item.to)}`, Number(item.arrEpoch)]));
  let best = Infinity;
  for (const item of Array.isArray(current && current.timeline) ? current.timeline : []) {
    const old = previous.get(`${Number(item.from)}>${Number(item.to)}`);
    if (Number.isFinite(old) && Number.isFinite(Number(item.arrEpoch)))
      best = Math.min(best, Math.abs(Number(item.arrEpoch) - old));
  }
  return Number.isFinite(best) ? best : null;
}

function pairCost(prior, current) {
  const position = routePosition(current) - Number(prior.routePosition ?? routePosition(prior));
  const destination = Number(current.dest) === Number(prior.dest) ? 0 : 1000;
  // 無車號時，前後兩輪重疊的逐站 ETA 是比「現在排在第幾台」更強的身分證據。
  // 同一車通常只修幾秒，相鄰另一車則差一個班距；先比 overlap，才比位置。
  const continuity = timelineContinuity(prior, current);
  return (continuity == null ? 1e9 : continuity * 1e6) + Math.abs(position) * 100000 + destination +
    Math.abs(Number(current.arrEpoch) - Number(prior.arrEpoch));
}

function betterAlignment(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.count !== b.count) return a.count > b.count ? a : b;
  if (Math.abs(a.cost - b.cost) > 1e-9) return a.cost < b.cost ? a : b;
  const ak = a.pairs.map(x => `${x[0]}:${x[1]}`).join(','), bk = b.pairs.map(x => `${x[0]}:${x[1]}`).join(',');
  return ak <= bk ? a : b;
}

// 最大配對數優先、成本次之的保序 DP。輸入排序與配對都只有資料內容參與，與 rows 原順序無關。
function alignOrdered(current, prior, nowEpoch, model) {
  const memo = new Map();
  const solve = (i, j) => {
    const key = `${i}|${j}`;
    if (memo.has(key)) return memo.get(key);
    if (i >= current.length || j >= prior.length) {
      const empty = { count: 0, cost: 0, pairs: [] };
      memo.set(key, empty); return empty;
    }
    let best = betterAlignment(solve(i + 1, j), solve(i, j + 1));
    if (matchFeasible(model, prior[j], current[i], nowEpoch)) {
      const tail = solve(i + 1, j + 1);
      best = betterAlignment(best, { count: tail.count + 1, cost: tail.cost + pairCost(prior[j], current[i]),
        pairs: [[i, j], ...tail.pairs] });
    }
    memo.set(key, best); return best;
  };
  return solve(0, 0).pairs;
}

function historyWith(row, base) {
  const step = row.dir === 2 ? 1 : -1;
  // extension 仍保留最後兩個真實官方 event；若同一官方 row 短暫消失後重現，沿用這段
  // history 才不會另生新 ID，又把舊 extension 留成第二台車。
  let history = base && base.line === row.line && Number(base.dir) === row.dir &&
    Array.isArray(base.history) ? base.history.map(x => ({ to: Number(x.to), arrEpoch: Number(x.arrEpoch) })) : [];
  const event = { to: row.to, arrEpoch: row.arrEpoch };
  const last = history.at(-1);
  if (!last) history = [event];
  else if (last.to === event.to) history[history.length - 1] = event;
  else if (event.to === last.to + step) history.push(event);
  else history = [event];
  return history.slice(-2);
}

function timelineWith(row, base) {
  const byLeg = new Map();
  if (base && base.line === row.line && Number(base.dir) === row.dir && Array.isArray(base.timeline)) {
    for (const item of base.timeline) byLeg.set(`${Number(item.from)}>${Number(item.to)}`, {
      from: Number(item.from), to: Number(item.to), depEpoch: Number(item.depEpoch),
      arrEpoch: Number(item.arrEpoch), terminal: !!item.terminal,
    });
  }
  for (const item of row.timeline) byLeg.set(`${item.from}>${item.to}`, { ...item });
  const step = row.dir === 2 ? 1 : -1;
  return [...byLeg.values()].filter(item =>
    step * (Number(item.to) - Number(row.dest)) <= 0 &&
    step * (Number(item.from) - Number(row.dest)) <= 0)
    .sort((a, b) => step * (Number(a.to) - Number(b.to)) || Number(a.arrEpoch) - Number(b.arrEpoch));
}

function segmentRun(model, lineId, from, to) {
  const line = model && model.lines instanceof Map ? model.lines.get(lineId) : model && model.lines && model.lines[lineId];
  const value = line && line.runs instanceof Map ? line.runs.get(`${from}>${to}`) : null;
  const run = Number(value);
  return Number.isFinite(run) && run > 0 ? run : null;
}

function coastTiming(model, row, history, timeline) {
  const step = Number(row.dir) === 2 ? 1 : -1;
  const legs = (Number(row.dest) - Number(row.to)) * step;
  if (!(legs >= 0)) return { coastCycle: null, departureRun: null, retireEpoch: null };
  const officialArrivals = (timeline || []).filter(item => !item.terminal)
    .sort((a, b) => step * (Number(a.to) - Number(b.to)) || Number(a.arrEpoch) - Number(b.arrEpoch));
  const own = officialArrivals.length >= 2
    ? Number(officialArrivals.at(-1).arrEpoch) - Number(officialArrivals.at(-2).arrEpoch)
    : history.length >= 2
      ? Number(history.at(-1).arrEpoch) - Number(history.at(-2).arrEpoch) : NaN;
  const last = history.at(-1), beforeLast = history.at(-2);
  const physicalFloor = beforeLast && last
    ? segmentRun(model, row.line, Number(beforeLast.to), Number(last.to)) : Number(row.run);
  // 實測舊的無號配對曾產生 1–20 秒一站的假 cycle。官方 epoch 可以修訂，但不能
  // 凌駕於這段路線的實際行車秒；否則續推與退場時間都會被壓成飛車速度。
  const measuredCycle = Number.isFinite(own) && own > 0
    ? Math.max(own, Number(physicalFloor) > 0 ? Number(physicalFloor) : 0)
    : Number(row.run) + OFFICIAL_COAST_DWELL_DEFAULT_SEC;
  const exactDestination = (timeline || []).filter(item => !item.terminal && Number(item.to) === Number(row.dest))
    .sort((a, b) => Number(b.arrEpoch) - Number(a.arrEpoch))[0];
  const exactRetireEpoch = exactDestination ? Number(exactDestination.arrEpoch) : null;
  if (row.terminal && Number(row.from) === Number(row.to)) {
    const next = Number(row.to) + step;
    const exactFirst = (timeline || []).find(item => !item.terminal && Number(item.from) === Number(row.to) &&
      Number(item.to) === next);
    const departureRun = exactFirst
      ? Number(exactFirst.arrEpoch) - Number(exactFirst.depEpoch)
      : segmentRun(model, row.line, Number(row.to), next);
    if (!(departureRun > 0)) return { coastCycle: null, departureRun: null, retireEpoch: null };
    const coastCycle = measuredCycle > 0 ? measuredCycle : departureRun + OFFICIAL_COAST_DWELL_DEFAULT_SEC;
    const count = stationCount(model, row.line);
    // 一段式路線永遠等不到對端到站列，才使用唯一明示的 segment fallback。
    const retireEpoch = Number.isFinite(exactRetireEpoch) ? exactRetireEpoch :
      (/_XBT$/.test(row.line) || count <= 2 ? Number(row.arrEpoch) + departureRun : null);
    return { coastCycle, departureRun, retireEpoch };
  }
  const coastCycle = measuredCycle;
  const penultimate = Number(row.dest) - step;
  const penultimateEvent = officialArrivals.filter(item => Number(item.to) === penultimate)
    .sort((a, b) => Number(b.arrEpoch) - Number(a.arrEpoch))[0];
  // 一般路線終點站不回報到站倒數：抵達倒數第二站後，才用這台車自己的最近官方站間週期
  // 補唯一最後一段。這不是缺訊 timeout，也不拿整條班表推存在；XBT 則走上面的單段專用分支。
  const inferredTerminal = penultimateEvent && coastCycle > 0
    ? Number(penultimateEvent.arrEpoch) + coastCycle : null;
  return { coastCycle, departureRun: null,
    retireEpoch: Number.isFinite(exactRetireEpoch) ? exactRetireEpoch : inferredTerminal };
}

function officialNumberState(row, base) {
  const current = String(row.displayNo || '');
  if (!base) return { officialNo: current || null, officialNoLockedOut: false };
  if (base.officialNoLockedOut) return { officialNo: null, officialNoLockedOut: true };
  const prior = String(base.officialNo || '');
  if (!prior) return { officialNo: current || null, officialNoLockedOut: false };
  // 官方不同站／不同輪不一定都帶車次號。空白不是反證：既然這台車已經由位置延續接回，
  // 就保留第一次認到的號碼；只有另一個「非空且不同」的號碼才代表標籤真的矛盾。
  if (!current) return { officialNo: prior, officialNoLockedOut: false };
  if (current === prior) return { officialNo: prior, officialNoLockedOut: false };
  // 同一 vehicleId 的非空號碼一旦變動，代表標籤已不可信：永久退回路線縮寫，
  // 不換成新號，更不能為保住舊號而把車接去遠方另一筆同號 row。
  return { officialNo: null, officialNoLockedOut: true };
}

function officialVehicle(model, row, vehicleId, base, sourceRevision, nowEpoch) {
  const history = historyWith(row, base);
  const timeline = timelineWith(row, base);
  const timing = coastTiming(model, row, history, timeline);
  const numberState = officialNumberState(row, base);
  const birthEvidence = base && base.birthEvidence || {
    source: 'official-board', sourceRevision, observedEpoch: nowEpoch,
    line: row.line, dir: row.dir, from: row.from, to: row.to, arrEpoch: row.arrEpoch,
  };
  return {
    vehicleId, line: row.line, dir: row.dir, dest: row.dest, from: row.from, to: row.to,
    run: row.run, arrEpoch: row.arrEpoch, terminal: row.terminal,
    ...numberState, source: 'official', extension: false,
    sourceRevision, observedEpoch: nowEpoch, routePosition: routePosition(row), birthEvidence,
    history, timeline, ...timing,
  };
}

function carriedVehicle(model, vehicle, sourceRevision, nowEpoch, numberContradicted = false) {
  const timing = vehicle.retireEpoch != null && Number.isFinite(Number(vehicle.retireEpoch))
    ? { coastCycle: Number(vehicle.coastCycle), departureRun: vehicle.departureRun == null
      ? null : Number(vehicle.departureRun), retireEpoch: Number(vehicle.retireEpoch) }
    : coastTiming(model, vehicle, Array.isArray(vehicle.history) ? vehicle.history : [],
      Array.isArray(vehicle.timeline) ? vehicle.timeline : []);
  // 這是「到已知終點」的時刻，不是資料齡或缺訊 timeout。
  if (timing.retireEpoch != null && Number.isFinite(Number(timing.retireEpoch)) &&
      nowEpoch >= Number(timing.retireEpoch)) return null;
  return { ...vehicle, ...timing, sourceRevision, extension: false, carried: true,
    ...(numberContradicted ? { officialNo: null, officialNoLockedOut: true } : {}) };
}

function compareVehicles(a, b) {
  return a.line.localeCompare(b.line) || Number(a.dir) - Number(b.dir) || Number(a.dest) - Number(b.dest) ||
    Number(a.routePosition) - Number(b.routePosition) || Number(a.arrEpoch) - Number(b.arrEpoch) ||
    Number(a.extension) - Number(b.extension) || String(a.vehicleId).localeCompare(String(b.vehicleId));
}

/**
 * 將一輪 collapseClaims() rows 化成官方名冊。
 *
 * prior 必須是上一輪本函式回傳值。一旦由官方倒數建立 vehicleId，
 * 後續快照只更新它；當輪沒有 row 也沿已知時間軸保留，到已知終點才收車。
 * model 只讀路線站序與一段路程缺少到站時刻時所需的段秒，不以班表決定車的存在。
 */
export function reduceOfficialRoster({ model, rows, prior = null, day, nowEpoch, sourceRevision }) {
  const normalizedDay = String(day || '').trim();
  const epoch = finite(nowEpoch, 'nowEpoch');
  if (!normalizedDay) throw new TypeError('official roster day 不可為空');
  const { rows: current, duplicateRowsCollapsed } = canonicalRows(model, rows);
  const priorVehicles = previousVehicles(prior, normalizedDay);
  const coldStart = !prior || String(prior.day || '') !== normalizedDay;
  const noCounts = new Map();
  const noKey = row => `${row.line}|${Number(row.dir)}|${String(row.sourceNo || row.officialNo || '')}`;
  for (const row of current) if (row.sourceNo) noCounts.set(noKey(row), (noCounts.get(noKey(row)) || 0) + 1);
  for (const row of current) row.displayNo = row.sourceNo && noCounts.get(noKey(row)) === 1 ? row.sourceNo : '';

  const state = { day: normalizedDay, nextSequence: initialSequence(prior, normalizedDay),
    reservedIds: new Set(priorVehicles.map(x => String(x.vehicleId || '')).filter(Boolean)) };
  const assigned = new Map(), usedIds = new Set(), priorById = new Map(priorVehicles.map(x => [String(x.vehicleId), x]));
  const numberContradictions = new Map();
  let hardNoMatches = 0;

  // 官方 no 只在同線、同方向、同一趟生命週期內是硬 alias。到終點收車後，
  // 反方向倒數必須建新 ID，不得因實體車折返而把舊方向身分復活。
  for (let index = 0; index < current.length; index++) {
    const row = current[index];
    if (!row.displayNo) continue;
    const sameNumber = priorVehicles.filter(vehicle => !usedIds.has(String(vehicle.vehicleId)) &&
      vehicle.line === row.line && Number(vehicle.dir) === Number(row.dir) &&
      String(vehicle.officialNo || '') === row.displayNo);
    for (const vehicle of sameNumber) {
      if (!physicallyReachable(model, vehicle, row, epoch)) {
        const vehicleId = String(vehicle.vehicleId);
        numberContradictions.set(vehicleId, { vehicleId, line: row.line, dir: row.dir, no: row.displayNo,
          priorFrom: Number(vehicle.from), priorTo: Number(vehicle.to), currentFrom: row.from, currentTo: row.to,
          priorObservedEpoch: Number(vehicle.observedEpoch), nowEpoch: epoch });
      }
    }
    const candidates = sameNumber.filter(vehicle => matchFeasible(model, vehicle, row, epoch));
    if (candidates.length !== 1) continue;
    const vehicleId = String(candidates[0].vehicleId);
    assigned.set(index, vehicleId); usedIds.add(vehicleId); hardNoMatches++;
  }

  // 🔴 2026-08-15 實測記錄：這裡曾加過一層「端點 occurrence 專用配對」（起點 pending ID
  // 先於全線 DP 分配）。拿當日 40 輪真語料量測，它讓車數穩定多出 6 台、births 多 6 次——
  // 貪婪搶 ID 會破壞下面 alignOrdered 的最大配對數最優解，反而製造幽靈車。已移除。
  // 起點身分的延續由 alignOrdered 負責，實測冷啟動 40 輪車數 99–109、重複出生證據 0。
  const groupNames = new Set();
  current.forEach((row, index) => { if (!assigned.has(index)) groupNames.add(groupKey(row)); });
  for (const key of [...groupNames].sort()) {
    const currentGroup = current.map((row, index) => ({ row, index }))
      .filter(x => !assigned.has(x.index) && groupKey(x.row) === key)
      .sort((a, b) => routePosition(a.row) - routePosition(b.row) || compareRows(a.row, b.row));
    const priorGroup = priorVehicles
      .filter(x => x && !usedIds.has(String(x.vehicleId)) && groupKey(x) === key)
      .sort((a, b) => Number(a.routePosition ?? routePosition(a)) - Number(b.routePosition ?? routePosition(b)) ||
        Number(a.arrEpoch) - Number(b.arrEpoch) || String(a.vehicleId).localeCompare(String(b.vehicleId)));
    for (const [ci, pi] of alignOrdered(currentGroup.map(x => x.row), priorGroup, epoch, model)) {
      const vehicleId = String(priorGroup[pi].vehicleId);
      assigned.set(currentGroup[ci].index, vehicleId); usedIds.add(vehicleId);
    }
  }

  let births = 0, ignoredObservations = 0;
  for (let index = 0; index < current.length; index++) {
    if (assigned.has(index)) continue;
    // 正常營運時只有起點倒數能生車；半途站間列只能更新既有 ID，配不到也不得複製一台。
    // 唯一例外是當日狀態完全不存在的冷啟動，讓部署／D1 初建時可一次接回線上既有車。
    if (!coldStart && !current[index].terminal) { ignoredObservations++; continue; }
    const vehicleId = allocateVehicleId(state);
    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;
  }

  const vehicles = [];
  let completed = 0, accepted = 0, numberConflicts = 0;
  for (let index = 0; index < current.length; index++) {
    const row = current[index], vehicleId = assigned.get(index);
    if (!vehicleId) continue;
    accepted++;
    const base = priorById.get(vehicleId) || null;
    const vehicle = officialVehicle(model, row, vehicleId, base, sourceRevision, epoch);
    if (base && base.officialNo && vehicle.officialNoLockedOut && !vehicle.officialNo) numberConflicts++;
    if (vehicle.retireEpoch != null && Number.isFinite(Number(vehicle.retireEpoch)) &&
        epoch >= Number(vehicle.retireEpoch)) {
      completed++; continue;
    }
    vehicles.push(vehicle);
  }

  let carried = 0, exits = 0, carriedNumberConflicts = 0;
  for (const old of priorVehicles.slice().sort(compareVehicles)) {
    if (!old.vehicleId || usedIds.has(String(old.vehicleId))) continue;
    const contradicted = numberContradictions.has(String(old.vehicleId));
    const alive = carriedVehicle(model, old, sourceRevision, epoch, contradicted);
    if (alive) {
      vehicles.push(alive); usedIds.add(String(alive.vehicleId)); carried++;
      if (contradicted && old.officialNo) { carriedNumberConflicts++; numberConflicts++; }
    }
    else exits++;
  }

  vehicles.sort(compareVehicles);
  if (vehicles.length !== accepted - completed + carried) throw new Error('official roster 名冊基數不守恆');
  const ids = vehicles.map(x => String(x.vehicleId));
  if (new Set(ids).size !== ids.length) throw new Error('official roster 同輪 vehicleId 重複');
  if (vehicles.some(x => x.tripKey != null || x.scheduleKey != null)) throw new Error('official roster 不得混入班表身分');
  if (vehicles.some(x => !x.birthEvidence || x.birthEvidence.source !== 'official-board')) {
    throw new Error('official roster 每台車都必須能追溯到官方站牌出生列');
  }
  // 復原檢查哨兵：同一份出生證據不得對應兩個活著的 ID。此值 >0 即是幽靈車正在形成，
  // 只計數不改行為（嚴重度歸嚴重度、機率歸機率），worker 端據此告警。
  const birthSignatures = new Map();
  for (const vehicle of vehicles) {
    const evidence = vehicle.birthEvidence;
    const signature = [evidence.sourceRevision, evidence.line, evidence.dir, evidence.from,
      evidence.to, evidence.arrEpoch, evidence.observedEpoch].join('|');
    birthSignatures.set(signature, (birthSignatures.get(signature) || 0) + 1);
  }
  const duplicateBirthSignatures = [...birthSignatures.values()].filter(count => count > 1).length;

  return {
    schema: OFFICIAL_ROSTER_SCHEMA, day: normalizedDay, nowEpoch: epoch, sourceRevision,
    nextSequence: state.nextSequence, vehicles,
    aliases: vehicles.filter(vehicle => vehicle.officialNo).map(vehicle => ({ line: vehicle.line,
      dir: Number(vehicle.dir), no: String(vehicle.officialNo), vehicleId: String(vehicle.vehicleId) }))
      .sort((a, b) => a.line.localeCompare(b.line) || a.dir - b.dir || a.no.localeCompare(b.no) ||
        a.vehicleId.localeCompare(b.vehicleId)),
    diagnostics: {
      rows: current.length, accepted, ignoredObservations, extensions: 0, carried, completed, births,
      matches: accepted - births, hardNoMatches, exits, numberConflicts, carriedNumberConflicts,
      rejectedNumberJumps: numberContradictions.size,
      rejectedNumberJumpDetails: [...numberContradictions.values()].sort((a, b) =>
        a.line.localeCompare(b.line) || a.dir - b.dir || a.vehicleId.localeCompare(b.vehicleId)),
      duplicateOfficialNos: [...noCounts.values()].filter(count => count > 1).length,
      duplicateRowsCollapsed, duplicateBirthSignatures,
    },
  };
}

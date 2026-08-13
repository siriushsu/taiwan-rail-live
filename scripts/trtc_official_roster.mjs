// 北捷「官方即時優先」名冊的純函式核心。
//
// 這裡刻意不讀班表，也不接受 tripKey。每一筆 collapseClaims() 輸出的 row 都是一台
// 當輪應顯示的車；班表車次若日後能辨認，只能在本名冊之外附加標籤，不能決定車的存在。

export const OFFICIAL_ROSTER_SCHEMA = 1;
export const TERMINAL_OCCURRENCE_ROLLOVER_SEC = 90;
export const EXTENSION_REAPPEAR_ETA_TOLERANCE_SEC = 30;
export const OFFICIAL_OWN_SPAN_MAX_SEC = 600;

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
  return { line, dir, from, to, dest, run, arrEpoch, terminal, sourceNo };
}

function routePosition(item) {
  return Number(item.dir) === 2 ? Number(item.to) : -Number(item.to);
}

function rowKey(row) {
  return JSON.stringify([row.line, row.dir, row.dest, routePosition(row), row.from, row.to,
    row.arrEpoch, row.run, row.terminal ? 1 : 0, row.sourceNo]);
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
  const occurrences = new Map();
  for (const row of normalized) {
    const key = rowKey(row);
    row.occurrence = occurrences.get(key) || 0;
    occurrences.set(key, row.occurrence + 1);
  }
  return normalized.sort(compareRows);
}

function groupKey(item) { return `${item.line}|${Number(item.dir)}|${Number(item.dest)}`; }

function previousVehicles(prior, day) {
  if (!prior || String(prior.day || '') !== String(day)) return [];
  return Array.isArray(prior.vehicles) ? prior.vehicles.filter(Boolean) : [];
}

function previousAliases(prior, day) {
  if (!prior || String(prior.day || '') !== String(day) || !Array.isArray(prior.aliases)) return new Map();
  return new Map(prior.aliases.filter(x => x && x.no && x.vehicleId)
    .map(x => [String(x.no), String(x.vehicleId)]));
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
  // 同一個起點停站預報的 ETA 可小幅校正；舊 occurrence 已到期且 ETA 跳到下一班時才換 ID。
  return Number(prior.arrEpoch) <= nowEpoch &&
    Number(current.arrEpoch) - Number(prior.arrEpoch) > TERMINAL_OCCURRENCE_ROLLOVER_SEC;
}

function matchFeasible(prior, current, nowEpoch) {
  const priorNo = String(prior.officialNo || '');
  const currentNo = String(current.displayNo || '');
  if (priorNo && currentNo && priorNo !== currentNo) return false;
  if (terminalOccurrenceRolled(prior, current, nowEpoch)) return false;
  // 同向車只能沿站序前進；這條硬約束讓新增起點車與離開終點車不會造成整排換號。
  return routePosition(current) + 1e-9 >= Number(prior.routePosition ?? routePosition(prior));
}

function pairCost(prior, current) {
  const position = routePosition(current) - Number(prior.routePosition ?? routePosition(prior));
  return position * 100000 + Math.abs(Number(current.arrEpoch) - Number(prior.arrEpoch));
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
function alignOrdered(current, prior, nowEpoch) {
  const memo = new Map();
  const solve = (i, j) => {
    const key = `${i}|${j}`;
    if (memo.has(key)) return memo.get(key);
    if (i >= current.length || j >= prior.length) {
      const empty = { count: 0, cost: 0, pairs: [] };
      memo.set(key, empty); return empty;
    }
    let best = betterAlignment(solve(i + 1, j), solve(i, j + 1));
    if (matchFeasible(prior[j], current[i], nowEpoch)) {
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

function officialVehicle(row, vehicleId, base, sourceRevision, nowEpoch) {
  return {
    vehicleId, line: row.line, dir: row.dir, dest: row.dest, from: row.from, to: row.to,
    run: row.run, arrEpoch: row.arrEpoch, terminal: row.terminal,
    officialNo: row.displayNo || null, source: 'official', extension: false,
    sourceRevision, observedEpoch: nowEpoch, routePosition: routePosition(row),
    history: historyWith(row, base),
  };
}

function isTwoStationShuttle(line, count) {
  return /_XBT$/.test(line) || count <= 2;
}

function finalExtension(model, vehicle, nowEpoch, sourceRevision) {
  const count = stationCount(model, vehicle.line);
  if (isTwoStationShuttle(vehicle.line, count)) return null;
  const step = Number(vehicle.dir) === 2 ? 1 : -1;
  const terminal = Number(vehicle.dir) === 2 ? count - 1 : 0;
  const penultimate = terminal - step;
  if (Number(vehicle.to) !== penultimate || Number(vehicle.from) !== penultimate - step) return null;
  const history = Array.isArray(vehicle.history) ? vehicle.history : [];
  if (history.length < 2) return null;
  const previous = history.at(-2), last = history.at(-1);
  if (Number(last.to) !== Number(previous.to) + step || Number(last.to) !== penultimate) return null;
  // 缺少終點看板時，唯一允許的補段：只複用同一台車自己最近兩個相鄰官方到站 epoch。
  const ownLastSpan = Number(last.arrEpoch) - Number(previous.arrEpoch);
  // 與官方事件校準既有結構界線相同；超過10分鐘多半已串到下一班，寧可不補末段。
  if (!(ownLastSpan > 0 && ownLastSpan <= OFFICIAL_OWN_SPAN_MAX_SEC)) return null;
  const depEpoch = Number(last.arrEpoch), arrEpoch = depEpoch + ownLastSpan;
  if (nowEpoch >= arrEpoch) return null;
  return {
    ...vehicle, from: penultimate, to: terminal, run: ownLastSpan, depEpoch, arrEpoch,
    terminal: false, source: 'official-derived-own-last-span', extension: true,
    sourceRevision, observedEpoch: Number(vehicle.observedEpoch), routePosition: Number(vehicle.dir) === 2 ? terminal : -terminal,
    ownLastSpan,
  };
}

function compareVehicles(a, b) {
  return a.line.localeCompare(b.line) || Number(a.dir) - Number(b.dir) || Number(a.dest) - Number(b.dest) ||
    Number(a.routePosition) - Number(b.routePosition) || Number(a.arrEpoch) - Number(b.arrEpoch) ||
    Number(a.extension) - Number(b.extension) || String(a.vehicleId).localeCompare(String(b.vehicleId));
}

function matchingPriorVehicle(vehicle, currentGroup) {
  if (!vehicle.extension) return vehicle;
  const history = Array.isArray(vehicle.history) ? vehicle.history : [];
  if (history.length < 2) return null;
  const previous = history.at(-2), last = history.at(-1);
  const step = Number(vehicle.dir) === 2 ? 1 : -1;
  if (Number(last.to) !== Number(previous.to) + step) return null;
  // 只把「同一筆官方預報的小幅 ETA 修訂」視為短暫重現；下一班的 headway 不得被
  // 上一班 extension 收回。30秒是 feed 輪距，且只用於 continuity，不改官方 deadline。
  if (!(currentGroup || []).some(item => Number(item.row.from) === Number(previous.to) &&
      Number(item.row.to) === Number(last.to) &&
      Math.abs(Number(item.row.arrEpoch) - Number(last.arrEpoch)) <= EXTENSION_REAPPEAR_ETA_TOLERANCE_SEC)) return null;
  // extension 的 from/to 已是推導末段；matching 必須還原成最後一筆真正官方區間。
  return { ...vehicle, extension: false, from: Number(previous.to), to: Number(last.to),
    arrEpoch: Number(last.arrEpoch), terminal: false,
    routePosition: Number(vehicle.dir) === 2 ? Number(last.to) : -Number(last.to) };
}

/**
 * 將一輪 collapseClaims() rows 化成官方名冊。
 *
 * prior 必須是上一輪本函式回傳值；回傳 vehicles 就是當輪官方車列，加上可逐筆說明的終點末段。
 * model 只讀路線站序長度，完全不讀 runs／班表時間。
 */
export function reduceOfficialRoster({ model, rows, prior = null, day, nowEpoch, sourceRevision }) {
  const normalizedDay = String(day || '').trim();
  const epoch = finite(nowEpoch, 'nowEpoch');
  if (!normalizedDay) throw new TypeError('official roster day 不可為空');
  const current = canonicalRows(model, rows);
  const priorVehicles = previousVehicles(prior, normalizedDay);
  const aliases = previousAliases(prior, normalizedDay);
  const noCounts = new Map();
  for (const row of current) if (row.sourceNo) noCounts.set(row.sourceNo, (noCounts.get(row.sourceNo) || 0) + 1);
  for (const row of current) row.displayNo = row.sourceNo && noCounts.get(row.sourceNo) === 1 ? row.sourceNo : '';

  const state = { day: normalizedDay, nextSequence: initialSequence(prior, normalizedDay),
    reservedIds: new Set([...aliases.values(), ...priorVehicles.map(x => String(x.vehicleId || '')).filter(Boolean)]) };
  const assigned = new Map(), usedIds = new Set(), priorById = new Map(priorVehicles.map(x => [String(x.vehicleId), x]));
  let hardNoMatches = 0;

  // 官方 no 是硬 alias；同輪 no 重複則只保留車、標籤 fail closed，不讓兩列共用一個身分。
  for (let index = 0; index < current.length; index++) {
    const row = current[index];
    if (!row.displayNo) continue;
    const vehicleId = aliases.get(row.displayNo);
    if (!vehicleId || usedIds.has(vehicleId)) continue;
    assigned.set(index, vehicleId); usedIds.add(vehicleId); hardNoMatches++;
  }

  const groupNames = new Set();
  current.forEach((row, index) => { if (!assigned.has(index)) groupNames.add(groupKey(row)); });
  for (const key of [...groupNames].sort()) {
    const currentGroup = current.map((row, index) => ({ row, index })).filter(x => !assigned.has(x.index) && groupKey(x.row) === key)
      .sort((a, b) => compareRows(a.row, b.row));
    const priorGroup = priorVehicles.map(vehicle => matchingPriorVehicle(vehicle, currentGroup))
      .filter(x => x && !usedIds.has(String(x.vehicleId)) && groupKey(x) === key)
      .sort((a, b) => Number(a.routePosition ?? routePosition(a)) - Number(b.routePosition ?? routePosition(b)) ||
        Number(a.arrEpoch) - Number(b.arrEpoch) || String(a.vehicleId).localeCompare(String(b.vehicleId)));
    for (const [ci, pi] of alignOrdered(currentGroup.map(x => x.row), priorGroup, epoch)) {
      const vehicleId = String(priorGroup[pi].vehicleId);
      assigned.set(currentGroup[ci].index, vehicleId); usedIds.add(vehicleId);
    }
  }

  let births = 0;
  for (let index = 0; index < current.length; index++) {
    if (assigned.has(index)) continue;
    const vehicleId = allocateVehicleId(state);
    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;
  }

  const vehicles = [];
  for (let index = 0; index < current.length; index++) {
    const row = current[index], vehicleId = assigned.get(index), base = priorById.get(vehicleId) || null;
    const vehicle = officialVehicle(row, vehicleId, base, sourceRevision, epoch);
    vehicles.push(vehicle);
    if (row.displayNo) aliases.set(row.displayNo, vehicleId);
  }

  let extensions = 0, exits = 0;
  for (const old of priorVehicles.slice().sort(compareVehicles)) {
    if (!old.vehicleId || usedIds.has(String(old.vehicleId))) continue;
    let extension = null;
    if (old.extension) {
      if (epoch < Number(old.arrEpoch)) extension = { ...old, sourceRevision };
    } else {
      extension = finalExtension(model, old, epoch, sourceRevision);
    }
    if (extension) { vehicles.push(extension); usedIds.add(String(extension.vehicleId)); extensions++; }
    else exits++;
  }

  vehicles.sort(compareVehicles);
  if (vehicles.length !== current.length + extensions) throw new Error('official roster 名冊基數不守恆');
  const ids = vehicles.map(x => String(x.vehicleId));
  if (new Set(ids).size !== ids.length) throw new Error('official roster 同輪 vehicleId 重複');
  if (vehicles.some(x => x.tripKey != null || x.scheduleKey != null)) throw new Error('official roster 不得混入班表身分');

  return {
    schema: OFFICIAL_ROSTER_SCHEMA, day: normalizedDay, nowEpoch: epoch, sourceRevision,
    nextSequence: state.nextSequence, vehicles,
    aliases: [...aliases].map(([no, vehicleId]) => ({ no, vehicleId }))
      .sort((a, b) => a.no.localeCompare(b.no) || a.vehicleId.localeCompare(b.vehicleId)),
    diagnostics: {
      rows: current.length, extensions, births, matches: current.length - births,
      hardNoMatches, exits, duplicateOfficialNos: [...noCounts.values()].filter(count => count > 1).length,
    },
  };
}

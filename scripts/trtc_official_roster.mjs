// 北捷「官方即時優先」名冊的純函式核心。
//
// 這裡刻意不讀班表，也不接受 tripKey。每一筆 collapseClaims() 輸出的 row 都是一台
// 當輪應顯示的車；班表車次若日後能辨認，只能在本名冊之外附加標籤，不能決定車的存在。

export const OFFICIAL_ROSTER_SCHEMA = 4;
export const OFFICIAL_COAST_DWELL_DEFAULT_SEC = 25;
// 「這台車自己的官方資料，證明它早該離開這裡了」——殘骸退場地板（2026-08-17）。
// 單位是**這台車自己的站間週期**（coastCycle，由它自己的官方到站時刻量出來、且不得低於
// 這條線該段的實際行車秒）。停滯超過這麼多個週期 ⇒ 依它自己的官方資料，它不可能還在原地。
//
// 🔴 這不是「缺訊 timeout」也不是「資料齡」，那兩條仍然永久廢棄——差別是量的東西不同：
//   * 資料齡量「我們有沒有收到」：同一條線別台車在不在報都會影響它，斷線就整批誤殺。
//   * 這條量「這台車自己的官方到站時刻有沒有前進」：官方還在報它，配對就會用掉這個 ID，
//     結構上根本走不到這道地板；斷訊時全線一起停滯，也只會等它恢復（realignLines 另管）。
// 用週期倍數而不是固定秒數：各線站距不同（BR 約 104 秒／站、BL 更長），寫死秒數就是
// 下次改點會被推翻的魔術數字（心得 35）。
export const OFFICIAL_STALL_RETIRE_CYCLES = 3;
// 「兩站之間有兩台車就已經要懷疑了，我們一堆三台連在一起的」——使用者 2026-08-17 給的判準。
// 一個行進中的區間（from!=to）同時容納幾台車是**物理事實**：號誌閉塞讓兩台車不可能貼在
// 同一段軌道上，三台更不可能。端點（from==to，車停在起訖站等發車）本來就會排隊，不算。
//
// 這個數字量的是**我們畫出來的結果荒不荒謬**，不是任何一台車的資料多舊——所以它不是
// 廢棄的資料齡規則，而是「拿官方現在說的重排一次」的觸發條件（使用者 08-17 明示要的重置）。
export const OFFICIAL_CROWD_SEGMENT_LIMIT = 3;

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
  // 🔴 完全相同的兩筆官方列＝官方報了兩台車，不准合一——「車子有官方數據就是在」。
  // 無車號路線（BR／Y）的起點列天天出現逐 byte 相同的兩筆，上游 collapseClaims() 也原樣送過來
  // （2026-08-15 實測：raw 2 → resolved 2 → claims 2 → collapsed 2）。合一就是少畫一台真車。
  // occurrence 讓它們成為可區分的身分，也讓 birthEvidence 帶得動鑑別子：
  // 同一份證據被重放時認得出是舊車，官方同時報的兩台車則證據不同、各自出生。
  const occurrences = new Map();
  let duplicateRowsObserved = 0;
  for (const row of normalized) {
    const key = rowKey(row);
    row.occurrence = occurrences.get(key) || 0;
    if (row.occurrence > 0) duplicateRowsObserved++;
    occurrences.set(key, row.occurrence + 1);
  }
  return { rows: normalized.sort(compareRows), duplicateRowsObserved };
}

// 出生證據＝「哪一份官方觀測建立了這個身分」。officialVehicle() 與重放閘門共用同一支，
// 兩邊的簽章不可能漂移。occurrence 是必要欄位：少了它，官方同時報的兩台無車號車會共用
// 同一份證據，重放閘門會把第二台真車誤擋成重放。
function birthEvidenceFor(row, sourceRevision, nowEpoch) {
  return { source: 'official-board', sourceRevision, observedEpoch: nowEpoch,
    line: row.line, dir: row.dir, from: row.from, to: row.to, arrEpoch: row.arrEpoch,
    occurrence: Number(row.occurrence) || 0 };
}

// sourceRevision 與 observedEpoch 在正式站是同一個值（兩者都由 trtcBoardEpoch(rows) 導出），
// 所以真正在做鑑別的是 line/dir/起訖/arrEpoch/occurrence；那兩欄是同源冗餘，留著不花成本，
// 但別誤以為它們各自被驗過——突變測試瞄準的是 arrEpoch（漏掉它會把下一班誤擋成重放）。
function birthSignature(evidence) {
  return [evidence.sourceRevision, evidence.line, evidence.dir, evidence.from, evidence.to,
    evidence.arrEpoch, evidence.observedEpoch, Number(evidence.occurrence) || 0].join('|');
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
  // 起點列的 arrEpoch 是「列車進站」的當下（車停在月台、每輪都報 now），不是發車錨點；
  // 官方第一段（起點→第一站）到站間隔因此普遍短於模型段秒（2026-08-15 語料實測 BL/G/O/R
  // 逐列比值 0.5–0.8、中途段 p50 1.28；舊門檻會拒絕 15/20 次真實的起點→第一段接手）。
  // 拿段秒門檻擋起點車接自己的第一段＝把真車永遠釘在起點（1 筆 timeline、永不退場，
  // 前端沿線續推成幽靈），第一段身分反被後方舊車搶走。
  // 起點車前進一站一律可達；同起點的新舊兩趟由 terminalOccurrenceRolled 分辨，
  // 不同終點的第一段列由 pairCost 的終點項壓後（08-15／08-13 尖峰兩份語料實測起點→第一段
  // 接手 31＋112 次，經本條放行而終點不同者 0 次）。
  if (prior.terminal && advance === 1) return true;
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
  // 起點站每個終點各報一班：兩筆終點不同的起點倒數是兩台車（頂埔／亞東醫院、新店／台電大樓…）。
  // 沒有這條時，另一終點的列偶爾缺一輪，這台起點車就會被 DP 拿去配另一終點的倒數（同位置、
  // 只差 1000 成本），下一輪原終點的列回來就得重新出生——多一台釘在起點的無號車。
  if (prior.terminal && current.terminal && Number(prior.dest) !== Number(current.dest)) return false;
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

// 從 from 走到 dest 還需要多少秒，逐段取這條線的實際行車秒（不是班表）。
// 任何一段缺秒數就回 null——寧可維持現行「不退場」也不用猜出來的數字推估退場。
function remainingRun(model, lineId, from, dest, step) {
  let total = 0;
  for (let station = Number(from); station !== Number(dest); station += step) {
    const run = segmentRun(model, lineId, station, station + step);
    if (!(run > 0)) return null;
    total += run + OFFICIAL_COAST_DWELL_DEFAULT_SEC;
  }
  return total > 0 ? total : null;
}

// 這台車自己的官方到站時刻 + 它自己的站間週期 × 允許停滯的週期數。
// 另外壓一道物理天花板：不論如何都不會活過「走完剩餘里程所需的實際行車秒」的兩倍——
// 週期量不出來（單筆 timeline）時由它兜底。
// 🔴 只給 carriedVehicle() 當地板用，觀測到的車永遠不受它影響——結構上不可能刪掉
// 官方正在報的車（「車子有官方數據就是在」）。
function projectedRetireOf(model, row, step, coastCycle) {
  const anchor = Number(row.arrEpoch);
  if (!Number.isFinite(anchor)) return null;
  // 🔴 週期必須有物理下限。coastCycle 在單筆 timeline 時會退化成 OFFICIAL_COAST_DWELL_DEFAULT_SEC
  // （25 秒）——停在起點等發車的車 run=0 正是這種，門檻會被壓成 75 秒而誤殺真車
  // （2026-08-15 語料實測：環狀線兩台只停滯 104／238 秒的真車被收掉）。
  // 取「這台車下一段的實際行車秒」當地板：捷運不可能 25 秒跑完一站。
  const nextRun = segmentRun(model, row.line, Number(row.to), Number(row.to) + step);
  const cycle = Math.max(Number(coastCycle) || 0, Number(nextRun) || 0);
  const byStall = cycle > 0 ? anchor + cycle * OFFICIAL_STALL_RETIRE_CYCLES : null;
  const remaining = remainingRun(model, row.line, Number(row.to), Number(row.dest), step);
  const byJourney = remaining > 0 ? anchor + remaining * 2 : null;
  const candidates = [byStall, byJourney].filter(value => value != null && Number.isFinite(value));
  return candidates.length ? Math.min(...candidates) : null;
}

function coastTiming(model, row, history, timeline) {
  const step = Number(row.dir) === 2 ? 1 : -1;
  const legs = (Number(row.dest) - Number(row.to)) * step;
  if (!(legs >= 0)) return { coastCycle: null, departureRun: null, retireEpoch: null, projectedRetireEpoch: null };
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
  // 殘骸退場地板：用這台車自己量出來的站間週期，不是資料齡（見常數宣告處）。
  const projectedRetireEpoch = projectedRetireOf(model, row, step, measuredCycle);
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
    if (!(departureRun > 0)) return { coastCycle: null, departureRun: null, retireEpoch: null, projectedRetireEpoch };
    const coastCycle = measuredCycle > 0 ? measuredCycle : departureRun + OFFICIAL_COAST_DWELL_DEFAULT_SEC;
    const count = stationCount(model, row.line);
    // 一段式路線永遠等不到對端到站列，才使用唯一明示的 segment fallback。
    const retireEpoch = Number.isFinite(exactRetireEpoch) ? exactRetireEpoch :
      (/_XBT$/.test(row.line) || count <= 2 ? Number(row.arrEpoch) + departureRun : null);
    return { coastCycle, departureRun, retireEpoch, projectedRetireEpoch };
  }
  const coastCycle = measuredCycle;
  const penultimate = Number(row.dest) - step;
  const penultimateEvent = officialArrivals.filter(item => Number(item.to) === penultimate)
    .sort((a, b) => Number(b.arrEpoch) - Number(a.arrEpoch))[0];
  // 一般路線終點站不回報到站倒數：抵達倒數第二站後，才用這台車自己的最近官方站間週期
  // 補唯一最後一段。這不是缺訊 timeout，也不拿整條班表推存在；XBT 則走上面的單段專用分支。
  const inferredTerminal = penultimateEvent && coastCycle > 0
    ? Number(penultimateEvent.arrEpoch) + coastCycle : null;
  return { coastCycle, departureRun: null, projectedRetireEpoch,
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
  const birthEvidence = base && base.birthEvidence || birthEvidenceFor(row, sourceRevision, nowEpoch);
  return {
    vehicleId, line: row.line, dir: row.dir, dest: row.dest, from: row.from, to: row.to,
    run: row.run, arrEpoch: row.arrEpoch, terminal: row.terminal,
    ...numberState, source: 'official', extension: false,
    sourceRevision, observedEpoch: nowEpoch, routePosition: routePosition(row), birthEvidence,
    history, timeline, ...timing,
  };
}

function carriedVehicle(model, vehicle, sourceRevision, nowEpoch, numberContradicted = false,
  lineAlive = false) {
  // 已有 retireEpoch 就沿用既存值（原始短路路徑，不得因為新欄位而改變既有行為）。
  // projectedRetireEpoch 錨在「這台車最後一次官方到站」上，carried 期間那個錨不會變，
  // 所以直接沿用；D1 舊名冊沒有這一欄時才補算，且只呼叫不會擲例外的那支。
  const timing = vehicle.retireEpoch != null && Number.isFinite(Number(vehicle.retireEpoch))
    ? { coastCycle: Number(vehicle.coastCycle), departureRun: vehicle.departureRun == null
      ? null : Number(vehicle.departureRun), retireEpoch: Number(vehicle.retireEpoch),
      projectedRetireEpoch: vehicle.projectedRetireEpoch ?? projectedRetireOf(model, vehicle,
        Number(vehicle.dir) === 2 ? 1 : -1, vehicle.coastCycle) }
    : coastTiming(model, vehicle, Array.isArray(vehicle.history) ? vehicle.history : [],
      Array.isArray(vehicle.timeline) ? vehicle.timeline : []);
  // 這是「到已知終點」的時刻，不是資料齡或缺訊 timeout。
  if (timing.retireEpoch != null && Number.isFinite(Number(timing.retireEpoch)) &&
      nowEpoch >= Number(timing.retireEpoch)) return null;
  // 🔴 退場地板（2026-08-17）：官方 timeline 半途中斷的車永遠等不到終點事件 ⇒ retireEpoch
  // 恆為 null ⇒ 上面那道退場檢查結構上永遠不成立，殘骸整天只進不出（實測早上 1.5 小時
  // 累積 37 台原地不動的車，畫面上就是使用者看到的「重複的車」）。
  //
  // 三道前提缺一不可，每一道都對應一個被實測打臉過的失效：
  //   (1) lineAlive：**這條線這一輪確實有官方列**。斷訊時整條線一起沉默，這時停滯是
  //       「我們沒收到」不是「車不在」——沒有這道閘，verify_trtc_ghost_fix 的整輪無列情境
  //       一次殺掉 58 台車，正是永久廢棄的「缺訊 timeout」。有這道閘才是在問
  //       「別的車都在報，就它不動」，量的是真實世界不是傳輸狀態。
  //   (2) retireEpoch 尚不可得：已經算得出確切終點時刻的車（含 XBT 兩站接駁的單段特例）
  //       由上面那道精確判斷處理，地板不得搶在它前面收車。
  //   (3) 停滯超過它自己的站間週期 × N。
  if (!lineAlive) return carried(timing);
  if (timing.retireEpoch != null && Number.isFinite(Number(timing.retireEpoch))) return carried(timing);
  if (timing.projectedRetireEpoch != null && Number.isFinite(Number(timing.projectedRetireEpoch)) &&
      nowEpoch >= Number(timing.projectedRetireEpoch)) return null;
  return carried(timing);

  function carried(t) {
    return { ...vehicle, ...t, sourceRevision, extension: false, carried: true,
      ...(numberContradicted ? { officialNo: null, officialNoLockedOut: true } : {}) };
  }
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
export function reduceOfficialRoster({ model, rows, prior = null, day, nowEpoch, sourceRevision,
  realignSec = 0, forceRealignLines = null }) {
  const normalizedDay = String(day || '').trim();
  const epoch = finite(nowEpoch, 'nowEpoch');
  if (!normalizedDay) throw new TypeError('official roster day 不可為空');
  const { rows: current, duplicateRowsObserved } = canonicalRows(model, rows);
  const priorVehicles = previousVehicles(prior, normalizedDay);
  const coldStart = !prior || String(prior.day || '') !== normalizedDay;
  const noCounts = new Map();
  const noKey = row => `${row.line}|${Number(row.dir)}|${String(row.sourceNo || row.officialNo || '')}`;
  for (const row of current) if (row.sourceNo) noCounts.set(noKey(row), (noCounts.get(noKey(row)) || 0) + 1);
  for (const row of current) row.displayNo = row.sourceNo && noCounts.get(noKey(row)) === 1 ? row.sourceNo : '';

  // 斷訊是**逐條路線**發生的：2026-08-15 06:27–07:00 只有環狀線（新北捷運自己的 feed）還在報，
  // 北捷自家八條線同時歸零，而全域 sourceRevision 因為環狀線仍有列而全程正常前進——
  // 只看全域落差的判準對那場真事故一次都不會觸發。所以逐線記「最後一次出現官方列的時刻」。
  const priorSeen = prior && prior.feedSeen && typeof prior.feedSeen === 'object' ? prior.feedSeen : {};
  const feedSeen = { ...priorSeen };
  const linesWithRows = new Set(current.map(row => row.line));
  // 訊號回來就以訊號為準（使用者裁示）：這條線消失夠久又回來了，它斷訊期間續推的位置是虛構的。
  // 冷啟動沒有 prior 可比，從沒見過的線也不算「回來」。
  const realignLines = new Set();
  if (realignSec > 0 && !coldStart) {
    for (const line of linesWithRows) {
      const last = Number(priorSeen[line]);
      if (Number.isFinite(last) && epoch - last >= realignSec) realignLines.add(line);
    }
  }
  // 外部指定的立即重排（2026-08-17 使用者要求的「迅速重置」）。與斷訊恢復共用同一條路徑：
  // 清掉這條線上官方沒報到的車、放行站間官方列生車＝完全照當下官方資料重建這條線。
  // 🔴 只認**這一輪真的有官方列**的線：對沒有官方列的線重排＝把整條線清空又補不回來，
  // 那正是永久廢棄的「缺訊就刪車」。冷啟動本來就整批接回，不需要也不應該再重排。
  // 先記下「因為斷訊而重排」的那幾條，再疊上外部指定的——兩者在 realignLines 裡混在一起之後
  // 就分不出來了，而 worker 要靠這個分辨才知道該不該對使用者說「即時訊號已恢復」。
  const gapRealigned = new Set(realignLines);
  const forced = forceRealignLines instanceof Set ? forceRealignLines
    : Array.isArray(forceRealignLines) ? new Set(forceRealignLines.map(String)) : null;
  if (forced && !coldStart) for (const line of linesWithRows) if (forced.has(line)) realignLines.add(line);
  for (const line of linesWithRows) feedSeen[line] = epoch;

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

  // 🔴 2026-08-15 記錄：這裡曾加過一層「端點 occurrence 專用配對」（起點 pending ID 先於
  // 全線 DP 分配），已移除、不要再加回來。貪婪先搶 ID 會讓下面 alignOrdered 的最優配對失效；
  // 起點身分的延續本來就由 alignOrdered 負責（合成情境「起點倒數 ETA 逐輪修訂不得換 ID」
  // 與「起點車被第一段官方列帶走後，下一班才輪到新 ID」是它的具名契約）。
  // 實測冷啟動 40 輪車數 99–109、重複出生證據 0 組。
  const groupNames = new Set();
  current.forEach((row, index) => { if (!assigned.has(index)) groupNames.add(groupKey(row)); });
  // 同一位置的多筆（起點站各終點的倒數、同一區段的兩台車）以到站時刻**遞減**排：愈早到站的排愈後、
  // 緊鄰前方下一個位置。alignOrdered 是保序 DP——位置前進的那台必須是同位置群的最後一個，否則它的
  // 第一段列會與留在原位的車「交叉」而配不到，只好另生新 ID、舊 ID 釘死在起點永不退場。
  // 兩邊排序鍵必須一致：舊碼 rows 走 dest 序、名冊走 arr 遞增序，起點兩筆終點不同的倒數天天交叉
  // （2026-08-15 實測：亞東 08:14:32 的車在兩輪間被 DP 丟掉重生一台）。
  const laterFirst = (a, b) => Number(b.arrEpoch) - Number(a.arrEpoch);
  for (const key of [...groupNames].sort()) {
    const currentGroup = current.map((row, index) => ({ row, index }))
      .filter(x => !assigned.has(x.index) && groupKey(x.row) === key)
      .sort((a, b) => routePosition(a.row) - routePosition(b.row) || laterFirst(a.row, b.row) || compareRows(a.row, b.row));
    const priorGroup = priorVehicles
      .filter(x => x && !usedIds.has(String(x.vehicleId)) && groupKey(x) === key)
      .sort((a, b) => Number(a.routePosition ?? routePosition(a)) - Number(b.routePosition ?? routePosition(b)) ||
        laterFirst(a, b) || String(a.vehicleId).localeCompare(String(b.vehicleId)));
    for (const [ci, pi] of alignOrdered(currentGroup.map(x => x.row), priorGroup, epoch, model)) {
      const vehicleId = String(priorGroup[pi].vehicleId);
      assigned.set(currentGroup[ci].index, vehicleId); usedIds.add(vehicleId);
    }
  }

  // 🔴 同一份官方出生證據只能建立一次身分。worker 的 CAS 重試會把較早的 frame 疊在已經
  // 前進過的名冊上（2026-08-15 對照組實測：修 assembly 之前就存在，不是新引入的）；此時原車
  // 已離開起點、配對判為不可行，同一列就會第二次生車＝幽靈車。這道閘只認證據，
  // 官方同時報的兩台車 occurrence 不同 ⇒ 證據不同 ⇒ 照樣各自出生，不受影響。
  // 比對範圍含已退場的 prior：證據用掉就是用掉，車到終點收了更不該被重放復活。
  const priorBirthSignatures = new Set(priorVehicles
    .map(vehicle => vehicle && vehicle.birthEvidence)
    .filter(evidence => evidence && evidence.source === 'official-board')
    .map(birthSignature));

  let births = 0, ignoredObservations = 0, replayBirthsBlocked = 0, recoveryBirths = 0;
  // 逐線分開記：同一輪可能既有斷訊恢復、又有自我察覺重置，兩者要能拆開算，
  // 否則前端那句「訊號恢復、清掉 N 台」會把重置清掉的車一起算進去（數字對使用者不誠實）。
  const realignedByLine = {}, recoveryBirthsByLine = {};
  for (let index = 0; index < current.length; index++) {
    if (assigned.has(index)) continue;
    // 正常營運時只有起點倒數能生車；半途站間列只能更新既有 ID，配不到也不得複製一台。
    // 唯一例外是當日狀態完全不存在的冷啟動，讓部署／D1 初建時可一次接回線上既有車。
    //
    // 第二個例外＝剛從斷訊恢復的那幾條線（2026-08-15 實測：恢復輪有 11 筆官方站間列
    // 配不到任何舊 ID，其中 9 筆還帶官方車號）。這條線上斷訊期間推估的車剛被上面清光，
    // 這些列再被擋掉就是「官方有車、畫面沒車」，直接牴觸「車子有官方數據就是在」。
    // 位置取自官方那一列本身，不是我們推估的。範圍只限 realignLines：正常輪照舊只認起點，
    // 否則每輪十幾筆站間列都會生出重複的車。
    const recoverable = !coldStart && realignLines.has(current[index].line);
    if (!coldStart && !current[index].terminal && !recoverable) { ignoredObservations++; continue; }
    if (priorBirthSignatures.has(birthSignature(birthEvidenceFor(current[index], sourceRevision, epoch)))) {
      replayBirthsBlocked++; continue;
    }
    const vehicleId = allocateVehicleId(state);
    assigned.set(index, vehicleId); usedIds.add(vehicleId); births++;
    // 只數「恢復例外放行的」那些：冷啟動本來就整批放行站間列，算進來會讓每天第一輪
    // 看起來像剛從斷訊恢復（實測健康語料誤報 82 台）。
    if (recoverable && !current[index].terminal) {
      recoveryBirths++;
      recoveryBirthsByLine[current[index].line] = (recoveryBirthsByLine[current[index].line] || 0) + 1;
    }
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

  let carried = 0, exits = 0, carriedNumberConflicts = 0, realigned = 0;
  for (const old of priorVehicles.slice().sort(compareVehicles)) {
    if (!old.vehicleId || usedIds.has(String(old.vehicleId))) continue;
    // 🔴 訊號回來就以訊號為準（2026-08-15 使用者裁示）：這條線斷訊期間續推出來的位置是虛構的，
    // 官方名單沒有的車一律不留，畫面上不能有多的。判準是「這條線剛從長時間消失中回來」，
    // 不是資料齡——那條規則仍然永久廢棄。只清剛回來的那幾條線：正常輪每輪都有十幾台真車
    // 合法地暫時離板（實測 carried 10–17／121），誤殺它們才是災難。
    if (realignLines.has(old.line)) {
      realigned++; realignedByLine[old.line] = (realignedByLine[old.line] || 0) + 1; continue;
    }
    const contradicted = numberContradictions.has(String(old.vehicleId));
    const alive = carriedVehicle(model, old, sourceRevision, epoch, contradicted, linesWithRows.has(old.line));
    if (alive) {
      vehicles.push(alive); usedIds.add(String(alive.vehicleId)); carried++;
      if (contradicted && old.officialNo) { carriedNumberConflicts++; numberConflicts++; }
    }
    else exits++;
  }

  vehicles.sort(compareVehicles);
  if (vehicles.length !== accepted - completed + carried) throw new Error('official roster 名冊基數不守恆');
  // 「剛回來的線不得留下未經官方確認的車」是結構不變量（realigned 與 carried 互斥分支），
  // 資料無法觸發它，所以**不在這裡擲例外**——今天正是 reducer 擲例外每天丟掉 22/38 輪。
  // 這條由 verify_trtc_outage_recovery.mjs 在測試期把關，執行期只把數字送出去讓人看得到。
  const ids = vehicles.map(x => String(x.vehicleId));
  if (new Set(ids).size !== ids.length) throw new Error('official roster 同輪 vehicleId 重複');
  if (vehicles.some(x => x.tripKey != null || x.scheduleKey != null)) throw new Error('official roster 不得混入班表身分');
  if (vehicles.some(x => !x.birthEvidence || x.birthEvidence.source !== 'official-board')) {
    throw new Error('official roster 每台車都必須能追溯到官方站牌出生列');
  }
  // 復原檢查哨兵：同一份出生證據不得對應兩個活著的 ID。上面的重放閘門補上之後這裡應恆為 0，
  // 它就是那道閘的事後證明。**只計數不擲例外**——擲例外會整輪丟掉整份官方名冊，
  // 那正是 2026-08-15 每天丟掉 22/38 輪的 assembly-error 失效模式，代價遠大於記一筆告警。
  const birthSignatures = new Map();
  for (const vehicle of vehicles) {
    const signature = birthSignature(vehicle.birthEvidence);
    birthSignatures.set(signature, (birthSignatures.get(signature) || 0) + 1);
  }
  const duplicateBirthSignatures = [...birthSignatures.values()].filter(count => count > 1).length;

  return {
    schema: OFFICIAL_ROSTER_SCHEMA, day: normalizedDay, nowEpoch: epoch, sourceRevision,
    // 逐線最後見到官方列的時刻要跟著名冊一起持久化，否則每個 isolate 都從零開始記，
    // 「這條線消失多久了」永遠算不出來。
    nextSequence: state.nextSequence, feedSeen, vehicles,
    aliases: vehicles.filter(vehicle => vehicle.officialNo).map(vehicle => ({ line: vehicle.line,
      dir: Number(vehicle.dir), no: String(vehicle.officialNo), vehicleId: String(vehicle.vehicleId) }))
      .sort((a, b) => a.line.localeCompare(b.line) || a.dir - b.dir || a.no.localeCompare(b.no) ||
        a.vehicleId.localeCompare(b.vehicleId)),
    diagnostics: {
      rows: current.length, accepted, ignoredObservations, replayBirthsBlocked,
      extensions: 0, carried, completed, births, realigned, recoveryBirths,
      realignedByLine, recoveryBirthsByLine,
      realignedLines: [...realignLines].sort(), linesWithRows: linesWithRows.size,
      // 「這條線是被斷訊恢復自動抓到的，還是被外部指定重置的」要分得開，
      // 否則自動重置每觸發一次就會被 worker 當成一次斷訊恢復告警（語意污染）。
      // 真的斷訊過的線即使同時超標，也算斷訊恢復（那句通知是真的，不能被自癒吞掉）。
      forcedRealignLines: forced
        ? [...realignLines].filter(line => forced.has(line) && !gapRealigned.has(line)).sort() : [],
      matches: accepted - births, hardNoMatches, exits, numberConflicts, carriedNumberConflicts,
      rejectedNumberJumps: numberContradictions.size,
      rejectedNumberJumpDetails: [...numberContradictions.values()].sort((a, b) =>
        a.line.localeCompare(b.line) || a.dir - b.dir || a.vehicleId.localeCompare(b.vehicleId)),
      duplicateOfficialNos: [...noCounts.values()].filter(count => count > 1).length,
      duplicateRowsObserved, duplicateBirthSignatures,
    },
  };
}

/**
 * 一段行進中的軌道上塞了幾台車——使用者 2026-08-17 的判準。
 * 回傳 { lines:Set<線代碼>, worst:最擠的那一段有幾台, over:超標的區間清單 }。
 * 端點（from==to）排隊合法，不計入。
 */
export function segmentCrowding(vehicles, limit = OFFICIAL_CROWD_SEGMENT_LIMIT) {
  const counts = new Map();
  for (const vehicle of vehicles || []) {
    const from = Number(vehicle.from), to = Number(vehicle.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    const key = `${vehicle.line}|${Number(vehicle.dir)}|${from}|${to}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const lines = new Set(), over = [];
  let worst = 0, suspicious = 0;
  for (const [key, count] of counts) {
    if (count > worst) worst = count;
    if (count >= 2) suspicious++;
    if (count >= limit) { lines.add(key.split('|')[0]); over.push({ segment: key, count }); }
  }
  over.sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment));
  return { lines, worst, suspicious, over };
}

/**
 * reduceOfficialRoster ＋ 自我察覺重置（使用者 2026-08-17：「我們需要一個迅速重置的方式，
 * 就像我昨天要求的斷訊後回歸，依照現在當下的北捷資訊來判斷現在路線上有哪些車」）。
 *
 * 先照常推進一輪；若結果出現「同一行進中區間 >= crowdLimit 台車」這種物理上不可能的畫面，
 * 就對**那幾條線**用同一輪的資料重跑一次、強制走斷訊恢復那條路徑。因為是拿同一份 prior
 * 與同一輪 rows 重跑，結果具決定性、可重放，也不會與 worker 的 CAS 重試打架。
 *
 * 只重排一次、不迴圈：重排後仍然超標代表官方自己就這樣報，那是資料不是我們的錯，
 * 記進 diagnostics 讓人看得到，不再繼續動它（避免每輪反覆清空同一條線）。
 */
export function reduceOfficialRosterSelfHealing({ crowdLimit = OFFICIAL_CROWD_SEGMENT_LIMIT, ...args }) {
  const first = reduceOfficialRoster(args);
  if (!(Number(crowdLimit) > 0)) return first;
  const before = segmentCrowding(first.vehicles, Number(crowdLimit));
  if (!before.lines.size) {
    first.diagnostics.crowdWorst = before.worst;
    first.diagnostics.crowdSuspicious = before.suspicious;
    first.diagnostics.crowdHealedLines = [];
    first.diagnostics.crowdUnhealable = [];
    return first;
  }
  const healed = reduceOfficialRoster({ ...args, forceRealignLines: before.lines });
  const after = segmentCrowding(healed.vehicles, Number(crowdLimit));
  // 🔴 真正被重排了哪幾條線由 reducer 自己回報（它會擋掉「這輪沒有官方列」的線——
  // 對那種線重排＝把整條線清空又補不回來）。這裡不得自己另算一份，否則診斷會謊報。
  healed.diagnostics.crowdHealedLines = (healed.diagnostics.forcedRealignLines || []).slice();
  healed.diagnostics.crowdUnhealable = [...before.lines]
    .filter(line => !healed.diagnostics.crowdHealedLines.includes(line)).sort();
  healed.diagnostics.crowdWorst = after.worst;
  healed.diagnostics.crowdSuspicious = after.suspicious;
  healed.diagnostics.crowdWorstBefore = before.worst;
  healed.diagnostics.crowdRemaining = after.over.slice(0, 10);
  return healed;
}

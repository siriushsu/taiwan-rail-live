// 北捷看板事件帳本的純函式核心。Worker cron 與 /api/trtc-live 共用；本模組不碰網路與 D1。

export const DEFAULT_DWELL_SEC = 25;
export const ALIGN_GAP_METERS = 1500;
const O_TRUNK_MAX = 11;

export const TRTC_LEDGER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trtc_events (
    day TEXT NOT NULL, line TEXT NOT NULL, dir INTEGER NOT NULL,
    train_key TEXT NOT NULL, station_idx INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('arr','dep')),
    epoch INTEGER NOT NULL, src TEXT NOT NULL CHECK(src IN ('board','cw')),
    crowd TEXT,
    state TEXT NOT NULL DEFAULT 'forecast' CHECK(state IN ('forecast','elapsed','observed')),
    observed_epoch INTEGER NOT NULL,
    updated_epoch INTEGER NOT NULL,
    UNIQUE(day, line, dir, train_key, station_idx, kind, src)
  )`,
  `CREATE INDEX IF NOT EXISTS trtc_events_day_track_epoch
     ON trtc_events(day, train_key, epoch)`,
  `CREATE TABLE IF NOT EXISTS trtc_tracks (
    day TEXT NOT NULL, track_id TEXT NOT NULL,
    line TEXT NOT NULL, dir INTEGER NOT NULL,
    station_idx INTEGER NOT NULL, progress REAL NOT NULL,
    official_no TEXT, crowd TEXT, evidence TEXT NOT NULL,
    evidence_epoch INTEGER NOT NULL, last_seen_epoch INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY(day, track_id)
  )`,
  `CREATE INDEX IF NOT EXISTS trtc_tracks_day_line_dir
     ON trtc_tracks(day, line, dir, last_seen_epoch)`,
  `CREATE TABLE IF NOT EXISTS trtc_track_aliases (
    day TEXT NOT NULL, alias_type TEXT NOT NULL CHECK(alias_type IN ('hw_no','br_cn1')),
    alias TEXT NOT NULL, track_id TEXT NOT NULL,
    first_seen_epoch INTEGER NOT NULL, last_seen_epoch INTEGER NOT NULL,
    PRIMARY KEY(day, alias_type, alias)
  )`,
];

export function normStationName(value) {
  return String(value == null ? '' : value).trim().replace(/臺/g, '台').replace(/站$/, '');
}

export function countdownSec(value) {
  const text = String(value == null ? '' : value);
  const m = text.match(/^(\d+):(\d+)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return text === '列車進站' ? 0 : null;
}

export function taipeiParts(epochSec) {
  const d = new Date(Number(epochSec) * 1000 + 8 * 3600e3);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}

const ymd = p => `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
function addDay(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// 00:00–01:20 仍屬前一個營運日；04:00 是兩個營運窗間的安全切日點。
export function trtcServiceDay(epochSec) {
  const p = taipeiParts(epochSec);
  const day = ymd(p);
  return p.hour < 4 ? addDay(day, -1) : day;
}

export function trtcOperatingState(epochSec) {
  const p = taipeiParts(epochSec);
  const minute = p.hour * 60 + p.minute;
  return {
    open: minute >= 5 * 60 + 40 || minute <= 80,
    prune: p.hour === 3 && p.minute === 30,
    minute,
    serviceDay: trtcServiceDay(epochSec),
  };
}

const median = values => {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

function timetableRuns(timesLine, stations) {
  const buckets = new Map();
  for (const set of Object.values((timesLine && timesLine.sets) || {})) {
    for (const train of set || []) {
      for (let p = 0; p + 3 < train.length; p += 2) {
        const a = Number(train[p]), ta = Number(train[p + 1]);
        const b = Number(train[p + 2]), tb = Number(train[p + 3]);
        if (Math.abs(a - b) !== 1 || !(tb > ta)) continue;
        const from = a, to = b;
        // *_times 是各站發車秒；發車→發車差 = run + 目的站 dwell。
        const pure = tb - ta - ((stations[to] && stations[to].dwell) || DEFAULT_DWELL_SEC);
        if (!(pure >= 20 && pure <= 600)) continue;
        const key = `${from}>${to}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(pure);
      }
    }
  }
  return new Map([...buckets].map(([key, values]) => [key, median(values)]));
}

export function buildTrtcModel(trtc, times, codes) {
  const lines = new Map();
  const stationNameIndex = new Map();
  for (const source of (trtc && trtc.lines) || []) {
    if (!source || source.id === 'Y') continue;
    const stations = (source.stations || []).map(s => ({
      name: normStationName(s.name), dwell: Number(s.dwell) > 0 ? Number(s.dwell) : DEFAULT_DWELL_SEC,
      d: Number.isFinite(Number(s.d)) ? Number(s.d) : null,
    }));
    const fallback = timetableRuns(times && times.lines && times.lines[source.id], stations);
    const runs = new Map();
    for (let i = 0; i < stations.length - 1; i++) {
      const seg = source.segs && source.segs[i];
      const forward = seg && Number(seg.run) > 0 ? Number(seg.run) : fallback.get(`${i}>${i + 1}`);
      const backward = seg && Number(seg.run) > 0 ? Number(seg.run) : fallback.get(`${i + 1}>${i}`);
      if (forward > 0) runs.set(`${i}>${i + 1}`, forward);
      if (backward > 0) runs.set(`${i + 1}>${i}`, backward);
    }
    const line = { id: source.id, stations, runs };
    lines.set(line.id, line);
    stations.forEach((s, i) => {
      const key = s.name;
      if (!stationNameIndex.has(key)) stationNameIndex.set(key, []);
      stationNameIndex.get(key).push({ line: line.id, i });
    });
  }
  const codeMap = new Map();
  for (const [code, rec] of Object.entries(codes || {})) {
    const on = (rec && rec.on || []).filter(x => x && lines.has(x.ln) && Number.isInteger(Number(x.i)))
      .map(x => ({ line: x.ln, i: Number(x.i) }));
    if (on.length) codeMap.set(code, { name: normStationName(rec.name), on });
  }
  return { lines, stationNameIndex, codeMap };
}

function boardCandidates(model, stationName, destName) {
  const station = model.stationNameIndex.get(stationName) || [];
  const dest = model.stationNameIndex.get(destName) || [];
  const byDest = new Map(dest.map(x => [x.line, x.i]));
  return station.filter(x => byDest.has(x.line) && byDest.get(x.line) !== x.i)
    .map(x => ({ line: x.line, stationIdx: x.i, destIdx: byDest.get(x.line) }));
}

function pickBoardCandidate(candidates, trainNo) {
  if (candidates.length === 1) return candidates[0];
  const ids = candidates.map(x => x.line).sort().join('+');
  if (ids === 'BL+BR') return candidates.find(x => x.line === (trainNo ? 'BL' : 'BR')) || null;
  if (ids === 'O_LUZHOU+O_XINZHUANG') {
    const x = candidates.find(v => v.line === 'O_XINZHUANG');
    return x && x.stationIdx <= O_TRUNK_MAX && x.destIdx <= O_TRUNK_MAX ? x : null;
  }
  return null;
}

export function resolveBoardRows(model, rows, epochOf) {
  const out = [], dropped = { countdown: 0, time: 0, station: 0, ambiguous: 0 };
  for (const raw of rows || []) {
    const sec = countdownSec(raw && raw.CountDown);
    if (sec == null) { dropped.countdown++; continue; }
    const baseEpoch = epochOf(raw && raw.NowDateTime);
    if (!Number.isFinite(baseEpoch)) { dropped.time++; continue; }
    const no = String(raw && raw.TrainNumber || '');
    const candidates = boardCandidates(model, normStationName(raw && raw.StationName), normStationName(raw && raw.DestinationName));
    if (!candidates.length) { dropped.station++; continue; }
    const pick = pickBoardCandidate(candidates, no);
    if (!pick) { dropped.ambiguous++; continue; }
    const dir = pick.destIdx > pick.stationIdx ? 2 : 1;
    out.push({
      line: pick.line, dir, stationIdx: pick.stationIdx, destIdx: pick.destIdx,
      destName: normStationName(raw.DestinationName), no,
      arrEpoch: baseEpoch + sec, baseEpoch, sec, atStation: sec === 0,
    });
  }
  return { rows: out, dropped };
}

export function calibrationKey(line, dir, from, to) { return `${line}|${dir}|${from}>${to}`; }

export function runSeconds(model, lineId, dir, from, to, calibrations) {
  const measured = calibrations && calibrations.get(calibrationKey(lineId, dir, from, to));
  if (Number(measured) > 0) return Number(measured);
  const line = model.lines.get(lineId);
  return line && Number(line.runs.get(`${from}>${to}`)) > 0 ? Number(line.runs.get(`${from}>${to}`)) : null;
}

export function claimBoardRows(model, resolvedRows, nowEpoch, calibrations) {
  const claims = [], unclaimed = [];
  for (const row of resolvedRows || []) {
    const step = row.dir === 2 ? 1 : -1;
    const from = row.stationIdx - step;
    const line = model.lines.get(row.line);
    if (!line) continue;
    if (from < 0 || from >= line.stations.length) {
      claims.push({ ...row, from: row.stationIdx, to: row.stationIdx, run: 0, progress: 0,
        ix: row.stationIdx, terminal: true, eventClaims: [] });
      continue;
    }
    const run = runSeconds(model, row.line, row.dir, from, row.stationIdx, calibrations);
    if (!(run > 0)) { unclaimed.push({ row, reason: 'no_run' }); continue; }
    const dwell = line.stations[from].dwell || DEFAULT_DWELL_SEC;
    const remain = row.arrEpoch - nowEpoch;
    if (remain >= run + dwell) { unclaimed.push({ row, reason: 'behind', remain, threshold: run + dwell }); continue; }
    const progress = Math.max(0, Math.min(1, 1 - remain / run));
    claims.push({ ...row, from, to: row.stationIdx, run, progress,
      ix: from + step * progress, terminal: false, eventClaims: [] });
  }
  return { claims, unclaimed };
}

export function collapseClaims(claims) {
  const grouped = new Map();
  for (const claim of claims || []) {
    const key = `${claim.line}|${claim.dir}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(claim);
  }
  const out = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => (a.dir === 2 ? 1 : -1) * (a.ix - b.ix));
    const deleted = new Set(), events = group.map(c => [c]);
    const byNo = new Map();
    group.forEach((c, i) => { if (c.no) { if (!byNo.has(c.no)) byNo.set(c.no, []); byNo.get(c.no).push(i); } });
    for (const indices of byNo.values()) {
      const keep = indices[indices.length - 1]; // 沿行進方向較前面的一列
      for (const i of indices) if (i !== keep) { deleted.add(i); events[keep].push(...events[i]); }
    }
    for (let i = 0; i + 1 < group.length; i++) {
      if (deleted.has(i)) continue;
      for (let j = i + 1; j < group.length; j++) {
        if (deleted.has(j)) continue;
        const a = group[i], b = group[j];
        if ((a.dir === 2 ? 1 : -1) * (b.ix - a.ix) > 0.6) break;
        if (a.no && b.no) continue;
        const hit = (a.to === b.from && a.progress >= 0.94 && b.progress <= 0.25) ||
          (a.terminal && b.from === a.to && b.progress <= 0.25);
        if (!hit) continue;
        deleted.add(i); events[j].push(...events[i]); break; // 保留較前面的 b
      }
    }
    group.forEach((claim, i) => { if (!deleted.has(i)) out.push({ ...claim, eventClaims: events[i] }); });
  }
  return out;
}

function chooseCodePosition(model, code, priorLine) {
  const rec = model.codeMap.get(String(code || ''));
  if (!rec || !rec.on.length) return null;
  if (priorLine) {
    const hit = rec.on.find(x => x.line === priorLine);
    if (hit) return hit;
  }
  if (rec.on.length === 1) return rec.on[0];
  const preferred = rec.on.find(x => !/_XBT$/.test(x.line) && x.line !== 'O_LUZHOU');
  return preferred || rec.on[0];
}

export function normalizeCarRows(model, hwRows, brRows, epochOf, priorLineByAlias = new Map()) {
  const newest = (rows, identityOf, timeField, sys) => {
    const map = new Map();
    for (const raw of rows || []) {
      const alias = String(identityOf(raw) || '');
      const epoch = epochOf(raw && raw[timeField]);
      if (!alias || !Number.isFinite(epoch)) continue;
      const prev = map.get(alias);
      if (!prev || epoch > prev.epoch) map.set(alias, { raw, epoch, alias, sys });
    }
    return [...map.values()];
  };
  const hw = newest(hwRows, r => r && r.TrainNumber, 'utime', 'hw');
  const br = newest(brRows, r => r && r.CN1, 'UpdateTime', 'br');
  const out = [];
  for (const item of hw.concat(br)) {
    const aliasType = item.sys === 'br' ? 'br_cn1' : 'hw_no';
    const pos = chooseCodePosition(model, item.raw.StationID, priorLineByAlias.get(`${aliasType}:${item.alias}`));
    const dir = Number(item.raw.CID);
    if (!pos || (dir !== 1 && dir !== 2)) continue;
    const keys = item.sys === 'br' ? ['Car1', 'Car2', 'Car3', 'Car4'] : ['Cart1L', 'Cart2L', 'Cart3L', 'Cart4L', 'Cart5L', 'Cart6L'];
    const crowdValues = keys.map(k => Number(item.raw[k]));
    const crowd = crowdValues.every(x => Number.isInteger(x) && x >= 1 && x <= 4) ? crowdValues : null;
    out.push({ sys: item.sys, aliasType, alias: item.alias, no: item.sys === 'hw' ? item.alias : null,
      line: pos.line, dir, stationIdx: pos.i, ix: pos.i, epoch: item.epoch, crowd });
  }
  return out;
}

// 逐車資料可舊到數分鐘；它不當顯示位置，但做身分保序指派前要先投影到看板時刻。
// 投影只決定「哪個身分對哪個看板位置」；對外 frame 仍以看板內插為準。
export function projectCarPositions(model, cars, nowEpoch, calibrations = new Map(), boardRows = []) {
  const boardByNo = new Map();
  for (const row of boardRows || []) if (row.no) {
    if (!boardByNo.has(row.no)) boardByNo.set(row.no, []);
    boardByNo.get(row.no).push(row);
  }
  for (const list of boardByNo.values()) list.sort((a, b) => a.arrEpoch - b.arrEpoch);
  for (const car of cars || []) {
    const line = model.lines.get(car.line); if (!line) continue;
    const step = car.dir === 2 ? 1 : -1;
    const dwell0 = line.stations[car.stationIdx].dwell || DEFAULT_DWELL_SEC;
    const leave = car.epoch + dwell0;
    // 高運量逐車號若在同批 TrackInfo 有下一站 ETA，沿用現行產品的兩端內插；
    // 這是身分對齊層，不是 B2 對外位置來源。
    const nextBoard = (boardByNo.get(car.alias) || []).find(r => r.line === car.line && r.dir === car.dir &&
      r.stationIdx !== car.stationIdx && (r.stationIdx - car.stationIdx) * step > 0);
    if (nextBoard && nowEpoch > leave && nextBoard.arrEpoch > leave) {
      const f = Math.max(0, Math.min(1, (nowEpoch - leave) / (nextBoard.arrEpoch - leave)));
      car.ix = car.stationIdx + (nextBoard.stationIdx - car.stationIdx) * f;
      continue;
    }
    let i = car.stationIdx, elapsed = Math.max(0, nowEpoch - car.epoch), guard = line.stations.length + 1;
    while (guard-- > 0) {
      const dwell = line.stations[i].dwell || DEFAULT_DWELL_SEC;
      if (elapsed <= dwell) { car.ix = i; break; }
      elapsed -= dwell;
      const to = i + step;
      if (to < 0 || to >= line.stations.length) { car.ix = i; break; }
      const run = runSeconds(model, car.line, car.dir, i, to, calibrations);
      if (!(run > 0)) { car.ix = i; break; }
      if (elapsed < run) { car.ix = i + step * Math.max(0, Math.min(1, elapsed / run)); break; }
      elapsed -= run; i = to; car.ix = i;
    }
  }
  return cars;
}

function stationMeters(model, lineId, ix) {
  const line = model.lines.get(lineId);
  if (!line || !line.stations.length) return Number(ix) * 1000;
  const lo = Math.max(0, Math.min(line.stations.length - 1, Math.floor(ix)));
  const hi = Math.max(0, Math.min(line.stations.length - 1, Math.ceil(ix)));
  const a = line.stations[lo].d, b = line.stations[hi].d;
  if (Number.isFinite(a) && Number.isFinite(b)) return (a + (b - a) * (ix - lo)) * 1000;
  return Number(ix) * 1000;
}

// 帶 gap 的保序 DP。回溯只留距離 <= gap 的配對，避免「硬配得完」。
export function alignOrdered(model, lineId, left, right, gap = ALIGN_GAP_METERS) {
  const line = model.lines.get(lineId);
  if (!line || !left.length || !right.length) return [];
  const m = left.length, n = right.length;
  const cost = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const prev = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));
  cost[0][0] = 0;
  for (let i = 0; i <= m; i++) for (let j = 0; j <= n; j++) {
    const cur = cost[i][j]; if (!Number.isFinite(cur)) continue;
    if (i < m && j < n) {
      const d = Math.abs(stationMeters(model, lineId, left[i].ix) - stationMeters(model, lineId, right[j].ix));
      if (cur + d < cost[i + 1][j + 1]) { cost[i + 1][j + 1] = cur + d; prev[i + 1][j + 1] = 1; }
    }
    if (i < m && cur + gap < cost[i + 1][j]) { cost[i + 1][j] = cur + gap; prev[i + 1][j] = 2; }
    if (j < n && cur + gap < cost[i][j + 1]) { cost[i][j + 1] = cur + gap; prev[i][j + 1] = 3; }
  }
  const pairs = []; let i = m, j = n;
  while (i || j) {
    const p = prev[i][j];
    if (p === 1) {
      const a = left[i - 1], b = right[j - 1];
      const distance = Math.abs(stationMeters(model, lineId, a.ix) - stationMeters(model, lineId, b.ix));
      if (distance <= gap) pairs.push({ left: a, right: b, distance });
      i--; j--;
    } else if (p === 2) i--;
    else if (p === 3) j--;
    else break;
  }
  return pairs.reverse();
}

function directionSort(dir) { return (a, b) => (dir === 2 ? 1 : -1) * (a.ix - b.ix); }
function aliasKey(type, alias) { return `${type}:${alias}`; }
function synthId(day, claim) {
  const minute = Math.floor(claim.arrEpoch / 60);
  const dest = [...claim.destName].reduce((h, ch) => ((h * 33) ^ ch.charCodeAt(0)) >>> 0, 5381).toString(36);
  return `synth:${day}:${claim.line}:${claim.dir}:${claim.to}:${minute}:${dest}`;
}

function groupItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.line}|${item.dir}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function nearestPrior(model, item, prior, used, gap) {
  let best = null;
  for (const p of prior) {
    if (used.has(p.track_id) || p.line !== item.line || Number(p.dir) !== item.dir) continue;
    const d = Math.abs(stationMeters(model, item.line, item.ix) - stationMeters(model, item.line, Number(p.progress)));
    if (d <= gap && (!best || d < best.distance)) best = { p, distance: d };
  }
  return best && best.p;
}

export function assignLedgerFrame({ model, claims, cars, priorTracks = [], aliases = [], day, nowEpoch, calibrations = new Map() }) {
  const aliasToTrack = new Map(aliases.map(a => [aliasKey(a.alias_type, String(a.alias)), String(a.track_id)]));
  const priorById = new Map(priorTracks.map(p => [String(p.track_id), p]));
  const usedPrior = new Set();
  const aliasUpdates = [];

  // 先讓逐車 alias 接上已有蹤跡；沒 alias 時可吸附既有 synth，但 track_id 永不改名。
  for (const car of cars) {
    const akey = aliasKey(car.aliasType, car.alias);
    let trackId = aliasToTrack.get(akey);
    if (!trackId) {
      const p = nearestPrior(model, car, priorTracks, usedPrior, ALIGN_GAP_METERS);
      trackId = p ? String(p.track_id) : `trk:${day}:${car.sys}:${car.alias}`;
      aliasToTrack.set(akey, trackId);
    }
    car.trackId = trackId;
    usedPrior.add(trackId);
    aliasUpdates.push({ day, aliasType: car.aliasType, alias: car.alias, trackId, epoch: nowEpoch });
  }

  const carGroups = groupItems(cars);
  const claimGroups = groupItems(claims);
  const claimedCar = new Set();
  for (const [groupKey, groupClaims] of claimGroups) {
    const [line, dirText] = groupKey.split('|'); const dir = Number(dirText);
    const groupCars = (carGroups.get(groupKey) || []).slice().sort(directionSort(dir));
    const sortedClaims = groupClaims.slice().sort(directionSort(dir));

    // 已有官方號的看板列先用 alias；首次出現時允許貼到附近 synth。
    for (const claim of sortedClaims.filter(c => c.no)) {
      const akey = aliasKey('hw_no', claim.no);
      let trackId = aliasToTrack.get(akey);
      const sameCar = groupCars.find(c => c.aliasType === 'hw_no' && c.alias === claim.no);
      if (!trackId && sameCar) trackId = sameCar.trackId;
      if (!trackId) {
        const p = nearestPrior(model, claim, priorTracks, usedPrior, ALIGN_GAP_METERS);
        trackId = p ? String(p.track_id) : `trk:${day}:hw:${claim.no}`;
      }
      claim.trackId = trackId; claim.officialNo = claim.no;
      aliasToTrack.set(akey, trackId); usedPrior.add(trackId);
      aliasUpdates.push({ day, aliasType: 'hw_no', alias: claim.no, trackId, epoch: nowEpoch });
      if (sameCar) claimedCar.add(sameCar);
    }

    // 無號列與逐車做一對一保序指派；文湖線會自然對到 CN1。
    const unlabeled = sortedClaims.filter(c => !c.trackId);
    const availableCars = groupCars.filter(c => !claimedCar.has(c));
    for (const pair of alignOrdered(model, line, unlabeled, availableCars)) {
      pair.left.trackId = pair.right.trackId;
      pair.left.officialNo = pair.right.no;
      pair.left.matchedCar = pair.right;
      claimedCar.add(pair.right); usedPrior.add(pair.right.trackId);
    }

    // 逐車當輪沒對上時，再對帳上已有蹤跡；接不上才開決定性 synth。
    for (const claim of sortedClaims.filter(c => !c.trackId)) {
      const p = nearestPrior(model, claim, priorTracks, usedPrior, ALIGN_GAP_METERS);
      claim.trackId = p ? String(p.track_id) : synthId(day, claim);
      claim.officialNo = p && p.official_no ? String(p.official_no) : null;
      usedPrior.add(claim.trackId);
    }
  }

  const events = [];
  const frame = [];
  const trackUpdates = [];
  const pushEvent = event => events.push({ day, ...event, observedEpoch: nowEpoch, updatedEpoch: nowEpoch });
  const priorCrowd = trackId => {
    const raw = priorById.get(trackId) && priorById.get(trackId).crowd;
    if (Array.isArray(raw)) return raw;
    try { const value = JSON.parse(raw); return Array.isArray(value) ? value : null; } catch { return null; }
  };

  for (const claim of claims) {
    const car = claim.matchedCar || cars.find(c => c.trackId === claim.trackId);
    const crowd = car && car.crowd || priorCrowd(claim.trackId);
    for (const ev of claim.eventClaims.length ? claim.eventClaims : [claim]) {
      if (ev.terminal) {
        pushEvent({ line: ev.line, dir: ev.dir, trackId: claim.trackId, stationIdx: ev.to,
          kind: 'dep', epoch: ev.arrEpoch, src: 'board', crowd: null,
          state: ev.atStation || ev.arrEpoch <= nowEpoch ? 'observed' : 'forecast' });
      } else {
        const run = runSeconds(model, ev.line, ev.dir, ev.from, ev.to, calibrations) || ev.run;
        pushEvent({ line: ev.line, dir: ev.dir, trackId: claim.trackId, stationIdx: ev.to,
          kind: 'arr', epoch: ev.arrEpoch, src: 'board', crowd: null,
          state: ev.atStation || ev.arrEpoch <= nowEpoch ? 'observed' : 'forecast' });
        pushEvent({ line: ev.line, dir: ev.dir, trackId: claim.trackId, stationIdx: ev.from,
          kind: 'dep', epoch: ev.arrEpoch - run, src: 'board', crowd: null,
          state: ev.arrEpoch - run <= nowEpoch ? 'elapsed' : 'forecast' });
      }
    }
    const evidence = car ? 'board+cw' : 'board';
    const payload = { key: claim.trackId, no: claim.officialNo || null, line: claim.line, dir: claim.dir,
      from: claim.from, to: claim.to, arrEpoch: claim.arrEpoch,
      depEpoch: claim.terminal ? claim.arrEpoch : claim.arrEpoch - claim.run,
      crowd, evidence, ageSec: Math.max(0, nowEpoch - claim.baseEpoch) };
    frame.push(payload);
    trackUpdates.push({ day, trackId: claim.trackId, line: claim.line, dir: claim.dir,
      stationIdx: claim.to, progress: claim.ix, officialNo: payload.no, crowd,
      evidence, evidenceEpoch: claim.baseEpoch, lastSeenEpoch: nowEpoch, payload });
  }

  // 逐車是身分／擁擠度／補位來源；沒被看板認領也不丟。
  for (const car of cars) {
    pushEvent({ line: car.line, dir: car.dir, trackId: car.trackId, stationIdx: car.stationIdx,
      kind: 'arr', epoch: car.epoch, src: 'cw', crowd: car.crowd, state: 'observed' });
    if (claimedCar.has(car) || frame.some(x => x.key === car.trackId)) continue;
    const line = model.lines.get(car.line), step = car.dir === 2 ? 1 : -1;
    const to = car.stationIdx + step;
    const validTo = line && to >= 0 && to < line.stations.length;
    const run = validTo ? runSeconds(model, car.line, car.dir, car.stationIdx, to, calibrations) : null;
    const dwell = line && line.stations[car.stationIdx] ? line.stations[car.stationIdx].dwell : DEFAULT_DWELL_SEC;
    const payload = { key: car.trackId, no: car.no, line: car.line, dir: car.dir,
      from: car.stationIdx, to: validTo ? to : car.stationIdx,
      arrEpoch: validTo && run ? car.epoch + dwell + run : car.epoch,
      depEpoch: validTo ? car.epoch + dwell : car.epoch,
      crowd: car.crowd, evidence: 'cw', ageSec: Math.max(0, nowEpoch - car.epoch) };
    frame.push(payload);
    trackUpdates.push({ day, trackId: car.trackId, line: car.line, dir: car.dir,
      stationIdx: car.stationIdx, progress: car.ix, officialNo: car.no, crowd: car.crowd,
      evidence: 'cw', evidenceEpoch: car.epoch, lastSeenEpoch: nowEpoch, payload });
  }

  frame.sort((a, b) => a.line.localeCompare(b.line) || a.dir - b.dir || a.from - b.from || a.key.localeCompare(b.key));
  return { frame, events, trackUpdates, aliasUpdates, cars, claims };
}

// 當日已凍結的相鄰到站差，轉成「純行駛 run」：arrival→arrival = dwell(prev) + run。
export function calibrationsFromEvents(model, rows) {
  const byTrack = new Map();
  for (const row of rows || []) {
    if (row.kind !== 'arr' || row.state === 'forecast') continue;
    const key = `${row.line}|${row.dir}|${row.train_key}|${row.src}`;
    if (!byTrack.has(key)) byTrack.set(key, []);
    byTrack.get(key).push(row);
  }
  const buckets = new Map();
  for (const list of byTrack.values()) {
    list.sort((a, b) => Number(a.epoch) - Number(b.epoch));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const step = Number(a.dir) === 2 ? 1 : -1;
      if (Number(b.station_idx) !== Number(a.station_idx) + step) continue;
      const line = model.lines.get(a.line); if (!line) continue;
      const pure = Number(b.epoch) - Number(a.epoch) - line.stations[Number(a.station_idx)].dwell;
      if (!(pure >= 20 && pure <= 600)) continue;
      const key = calibrationKey(a.line, Number(a.dir), Number(a.station_idx), Number(b.station_idx));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(pure);
    }
  }
  return new Map([...buckets].map(([key, values]) => [key, median(values)]));
}

export function buildLedgerFromRaw({ model, boardRows, hwRows, brRows, epochOf, priorTracks, aliases,
  historicalEvents, nowEpoch, day = trtcServiceDay(nowEpoch) }) {
  const calibrations = calibrationsFromEvents(model, historicalEvents || []);
  const priorLineByAlias = new Map();
  const trackById = new Map((priorTracks || []).map(x => [String(x.track_id), x]));
  for (const a of aliases || []) {
    const track = trackById.get(String(a.track_id));
    if (track) priorLineByAlias.set(aliasKey(a.alias_type, String(a.alias)), track.line);
  }
  const resolved = resolveBoardRows(model, boardRows, epochOf);
  // 支線共站的 StationID 本身無法分支；同批看板已有終點，先用它提示官方號所屬線。
  for (const row of resolved.rows) if (row.no) priorLineByAlias.set(aliasKey('hw_no', row.no), row.line);
  const claimed = claimBoardRows(model, resolved.rows, nowEpoch, calibrations);
  const claims = collapseClaims(claimed.claims);
  const cars = projectCarPositions(model,
    normalizeCarRows(model, hwRows, brRows, epochOf, priorLineByAlias), nowEpoch, calibrations, resolved.rows);
  const assigned = assignLedgerFrame({ model, claims, cars, priorTracks, aliases, day, nowEpoch, calibrations });
  return { ...assigned, diagnostics: { resolved: resolved.rows.length, claims: claims.length,
    unclaimed: claimed.unclaimed.length, dropped: resolved.dropped } };
}

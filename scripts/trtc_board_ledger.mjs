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
  // 逐班綁定(工項1-3):關係表低頻寫(只在 bind/rebind/done 時 upsert,不含 lastShift 等每輪都變的欄位—
  // 那些動態延續狀態改放 trtc_state['trip_dyn'],見下一表)。
  `CREATE TABLE IF NOT EXISTS trtc_trip_bindings (
    day TEXT NOT NULL, line TEXT NOT NULL, dir INTEGER NOT NULL,
    trip_key TEXT NOT NULL,
    track_id TEXT NOT NULL,
    bound_epoch INTEGER NOT NULL, birth TEXT NOT NULL,
    done INTEGER DEFAULT 0, rebinds INTEGER DEFAULT 0,
    PRIMARY KEY(day, line, dir, trip_key)
  )`,
  // 動態單列:每輪整包覆寫(訪客 join 與冷啟動重建都讀這裡,不需要 prune—恆 1 列)。
  `CREATE TABLE IF NOT EXISTS trtc_state (
    k TEXT PRIMARY KEY, v TEXT
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

// opts.includeY:環狀線 Y 屬新北捷,D1 帳本刻意不收(寫入額度只留給北捷八線)。
// 但 TrackInfo 本來就夾帶 Y 的倒數列,拿來當前端位置錨點不需要多打一次上游、也不多寫一筆帳本,
// 所以「產錨點」這條路徑單獨用 includeY:true 建模,帳本路徑維持預設排除。
export function buildTrtcModel(trtc, times, codes, opts = {}) {
  const lines = new Map();
  const stationNameIndex = new Map();
  for (const source of (trtc && trtc.lines) || []) {
    if (!source || (source.id === 'Y' && !opts.includeY)) continue;
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

function pickBoardCandidate(candidates, trainNo, lineHints) {
  if (candidates.length === 1) return candidates[0];
  const ids = candidates.map(x => x.line).sort().join('+');
  if (ids === 'BL+BR') return candidates.find(x => x.line === (trainNo ? 'BL' : 'BR')) || null;
  if (ids === 'O_LUZHOU+O_XINZHUANG') {
    const hintedLine = trainNo && lineHints && lineHints.get(String(trainNo));
    const hinted = hintedLine && candidates.find(v => v.line === hintedLine);
    if (hinted) return hinted;
    const x = candidates.find(v => v.line === 'O_XINZHUANG');
    return x && x.stationIdx <= O_TRUNK_MAX && x.destIdx <= O_TRUNK_MAX ? x : null;
  }
  return null;
}

export function resolveBoardRows(model, rows, epochOf, seedLineHints = new Map()) {
  const out = [], dropped = { countdown: 0, time: 0, station: 0, ambiguous: 0 };
  const prepared = [], directLines = new Map(), lineHints = new Map(seedLineHints || []);
  for (const raw of rows || []) {
    const sec = countdownSec(raw && raw.CountDown);
    if (sec == null) { dropped.countdown++; continue; }
    const baseEpoch = epochOf(raw && raw.NowDateTime);
    if (!Number.isFinite(baseEpoch)) { dropped.time++; continue; }
    const no = String(raw && raw.TrainNumber || '');
    const candidates = boardCandidates(model, normStationName(raw && raw.StationName), normStationName(raw && raw.DestinationName));
    if (!candidates.length) { dropped.station++; continue; }
    prepared.push({ raw, sec, baseEpoch, no, candidates });
    if (no && candidates.length === 1 && /^O_(?:LUZHOU|XINZHUANG)$/.test(candidates[0].line)) {
      if (!directLines.has(no)) directLines.set(no, new Set());
      directLines.get(no).add(candidates[0].line);
    }
  }
  const conflicts = new Set();
  for (const [no, lines] of directLines) {
    if (lines.size === 1) lineHints.set(no, [...lines][0]);
    else { conflicts.add(no); lineHints.delete(no); }
  }
  let hinted = 0, fallback = 0;
  for (const { raw, sec, baseEpoch, no, candidates } of prepared) {
    const orangeAmbiguous = candidates.length > 1 &&
      candidates.map(x => x.line).sort().join('+') === 'O_LUZHOU+O_XINZHUANG';
    const hasHint = orangeAmbiguous && no && lineHints.has(no) && !conflicts.has(no);
    const pick = pickBoardCandidate(candidates, no, conflicts.has(no) ? null : lineHints);
    if (!pick) { dropped.ambiguous++; continue; }
    if (orangeAmbiguous) { if (hasHint) hinted++; else fallback++; }
    const dir = pick.destIdx > pick.stationIdx ? 2 : 1;
    out.push({
      line: pick.line, dir, stationIdx: pick.stationIdx, destIdx: pick.destIdx,
      destName: normStationName(raw.DestinationName), no,
      arrEpoch: baseEpoch + sec, baseEpoch, sec, atStation: sec === 0,
    });
  }
  return { rows: out, dropped, lineHints,
    branch: { hinted, fallback, conflicts: conflicts.size, learned: directLines.size } };
}

// 橘線車進入大橋頭以南共線段後，站碼與終點「南勢角」都無法再分出蘆洲／新莊。
// 看板官方車號才是跨輪身分；這份 hint 只改錨點屬於哪一支，不參與列車存在性。
export function branchLineHintsFromLedger(priorTracks = [], aliases = []) {
  const byId = new Map((priorTracks || []).map(x => [String(x.track_id), x]));
  const hints = new Map();
  const accept = (no, line) => {
    if (no && /^O_(?:LUZHOU|XINZHUANG)$/.test(String(line || ''))) hints.set(String(no), String(line));
  };
  for (const track of priorTracks || []) accept(track.official_no, track.line);
  for (const alias of aliases || []) {
    if (alias.alias_type !== 'hw_no') continue;
    const track = byId.get(String(alias.track_id));
    if (track) accept(alias.alias, track.line);
  }
  return hints;
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
  const resolved = resolveBoardRows(model, boardRows, epochOf, branchLineHintsFromLedger(priorTracks, aliases));
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

// ═══ 逐班綁定器(工項1):track(已有跨輪身分)→ 當日班表班次(tripKey)的黏性配對 ═══
// 分層鐵則(memory train-spawn-vanish-invariants §六):名冊恆由班表(tripSets)決定;
// 本模組只回答「這個 trackId 現在對應班表上的哪一班、shift 多少」,永不生車滅車、
// 永不發明班表沒有的 tripKey、不含任何時間窗/保留秒數/信心分數這類存在性旋鈕——
// 找不到合適班次就是 unbound(前端退回中位數,現行行為),不是「這班車消失了」。

const TRIP_BIND_REF_WINDOW_SEC = 20 * 60;   // ref 只採「最近 20 分鐘內已綁」的班次(§5.1)
const TRIP_BIND_MAX_EARLY_SEC = -90;        // 禁早發:提早超過 90 秒的候選不可綁
const TRIP_BIND_COST_CAP_SEC = 600;         // cost=|shift-ref| 上限
const TRIP_BIND_ABS_CAP_SEC = 1800;         // |shift| 絕對上限(雙保險,防 ref 本身跑掉)
const TRIP_BIND_BAD_STREAK_LIMIT = 4;       // 安全閥:連續幾輪 cost 超標才解綁重配(§5.2)
const TRIP_BIND_DONE_GRACE_SEC = 120;       // 收班寬限(§5.3)
const TRIP_BIND_RECLAIM_COST_CAP_SEC = 180; // 認回:cost=|shift-lastShift| 上限(§5.3,v1.1)

// 與前端 freqTripKey 後綴同構(index.html:14499-14501):line/dir 由呼叫端欄位攜帶,這裡只回線內局部鍵。
export function tripKeyOf(tr) {
  return `${tr[0]}@${tr[1]}>${tr[tr.length - 2]}@${tr[tr.length - 1]}`;
}
// 站序遞增(起點索引<終點索引)為 dir=2,遞減為 dir=1——同 resolveBoardRows 既有慣例(dir = destIdx>stationIdx?2:1)。
export function tripDirOf(tr) { return tr[0] < tr[tr.length - 2] ? 2 : 1; }

// port 自前端 freqTrainTime(index.html:14182-14186):跨午夜正規化,秒值可 >86400。
function tripTimeAt(tr, t) {
  const n = tr.length;
  if (t < tr[1] && t + 86400 <= tr[n - 1]) t += 86400;
  return (t < tr[1] || t > tr[n - 1]) ? null : t;
}
export function tripRosterActive(tr, nowSec) { return tripTimeAt(tr, nowSec) != null; }
// port 自前端 trtcTripPair(index.html:14623-14626):(from,to) 是否為 tr 內連續一段,回傳段序 k(否則 -1)。
export function tripLegIndex(tr, from, to) {
  for (let k = 1; k < tr.length / 2; k++) if (tr[(k - 1) * 2] === from && tr[k * 2] === to) return k;
  return -1;
}

// 與前端 trtcServiceSec(index.html:14643-14648)同構的後端獨立實作:台北 00:00-04:00 仍算前一營運日,
// 秒值相應 +86400,好讓跨夜班次與 tr 陣列的秒值維持同一單調座標系可直接比較。
export function trtcServiceSecOfEpoch(epochSec) {
  const p = taipeiParts(epochSec);
  const sec = p.hour * 3600 + p.minute * 60 + p.second;
  return p.hour < 4 ? sec + 86400 : sec;
}

// 與前端 prepFreqTimes(index.html:4169-4179)逐行同構:輸入單線 { days, sets, holiday }(來自
// data/trtc_times.json)與 dayTypeTable(data/tw_daytype.json,TW_DAYTYPE 的後端副本——前端本單不改,
// 兩份手抄本留給下一單換源時統一),回傳 sets 的鍵('週日'/'平日'/'週六'等)。查無日型走一般星期幾規則。
export function trtcDayKeyForLine(lineTimes, dayTypeTable, serviceDay) {
  if (!lineTimes) return null;
  const dt = dayTypeTable && dayTypeTable[serviceDay];
  if (dt === 1) return lineTimes.holiday || (lineTimes.days && lineTimes.days[0]) || null;
  if (dt === 2) return (lineTimes.days && lineTimes.days[1]) || null;
  return lineTimes.days ? lineTimes.days[new Date(`${serviceDay}T00:00:00Z`).getUTCDay()] : null;
}

// 逐線選定當日班表後,依每班自己的站序方向拆成 "${line}|${dir}" 桶——候選池以 line+dir
// 分組是綁定演算法的基本單位(§5.1)。各線 days/holiday 實測並不完全相同(3 種組合共存於
// data/trtc_times.json,2026-08-07 查證),故日型選擇必須逐線各自解析,不可只算一次全域值。
export function buildTripSetsByLineDir(times, dayTypeTable, serviceDay) {
  const tripSets = new Map(), dayKeys = new Map();
  for (const [lineId, rec] of Object.entries((times && times.lines) || {})) {
    const dayKey = trtcDayKeyForLine(rec, dayTypeTable, serviceDay);
    dayKeys.set(lineId, dayKey);
    for (const tr of (dayKey && rec.sets && rec.sets[dayKey]) || []) {
      const gk = `${lineId}|${tripDirOf(tr)}`;
      if (!tripSets.has(gk)) tripSets.set(gk, []);
      tripSets.get(gk).push(tr);
    }
  }
  return { tripSets, dayKeys };
}

function tripBindKey(line, dir, tripKey) { return `${line}|${dir}|${tripKey}`; }

// 純函式核心。輸入:
//   model      - buildTrtcModel(...,{includeY:true}) 的那顆(既有 trtcBoardModel);本單 Y 尚無 tracks
//                流入是預期現象,只是先接好介面(工項 4 才會真的送 Y 的 claims 進來)。
//   tripSets   - buildTripSetsByLineDir(...).tripSets,Map<"line|dir", trip[]>。
//   dayType    - 呼叫端選定的日型標籤,本函式不用它做綁定判斷(候選是否 roster-active 已經
//                由 tripSets+nowEpoch 完全決定),只原樣帶進 audit 供上層/前端一致性檢查用。
//   tracks     - 這一輪的物理觀測,形狀取自 buildLedgerFromRaw(...).claims 的欄位子集:
//                { trackId, line, dir(1|2), from, to, destIdx, arrEpoch, run, terminal }。
//   priorBindings - 上一輪(或冷啟動重建)的 bindings 陣列,形狀與本函式回傳的 bindings 相同,
//                可整包原樣傳回下一輪(reducer 模式:nextState = bindTracksToTrips(prevState, ...))。
//   nowEpoch/day - 本輪基準時刻與營運日。
// 輸出 { bindings, events, audit }。
export function bindTracksToTrips({ model, tripSets, dayType, tracks, priorBindings, nowEpoch, day }) {
  const nowSec = trtcServiceSecOfEpoch(nowEpoch);
  const audit = { bound: 0, unbound: 0, rebinds: 0, capped: 0, done: 0, legMiss: 0, malformed: 0, reattach: 0 };
  const events = [];

  // 1) 展開 prior 狀態成可變工作副本。
  const records = new Map(); // fullKey -> record
  for (const p of priorBindings || []) {
    if (!p || !p.line || !p.tripKey || (Number(p.dir) !== 1 && Number(p.dir) !== 2)) continue;
    records.set(tripBindKey(p.line, Number(p.dir), p.tripKey), {
      line: p.line, dir: Number(p.dir), tripKey: p.tripKey,
      trackId: p.trackId != null ? String(p.trackId) : null,
      boundEpoch: Number.isFinite(Number(p.boundEpoch)) ? Number(p.boundEpoch) : nowEpoch,
      birth: p.birth === 'seed' ? 'seed' : 'terminal',
      lastShift: Number.isFinite(Number(p.lastShift)) ? Number(p.lastShift) : 0,
      lastTo: Number.isFinite(Number(p.lastTo)) ? Number(p.lastTo) : null,
      lastArrEpoch: Number.isFinite(Number(p.lastArrEpoch)) ? Number(p.lastArrEpoch) : null,
      badStreak: Number.isFinite(Number(p.badStreak)) ? Number(p.badStreak) : 0,
      done: !!p.done,
      rebinds: Number.isFinite(Number(p.rebinds)) ? Number(p.rebinds) : 0,
    });
  }

  // 2) trackId -> fullKey,僅現役(非 done)綁定;一個 trackId 同時只服役一個 tripKey。
  const trackToFullKey = new Map();
  for (const [fullKey, rec] of records) if (!rec.done && rec.trackId) trackToFullKey.set(rec.trackId, fullKey);

  // 3) fullKey -> 今天的 tr 陣列,供沿用中的綁定續算用。
  const tripByFullKey = new Map();
  for (const [gk, trips] of tripSets || []) {
    const sep = gk.lastIndexOf('|'); const line = gk.slice(0, sep), dir = Number(gk.slice(sep + 1));
    for (const tr of trips) tripByFullKey.set(tripBindKey(line, dir, tripKeyOf(tr)), tr);
  }

  // 4) 這一輪的觀測分成「沿用中」與「全新」兩批。
  const stickyTracks = [], freshTracks = [], seenTrackIds = new Set();
  for (const t of tracks || []) {
    const trackId = t && t.trackId != null ? String(t.trackId) : null;
    const line = t && t.line, dir = Number(t && t.dir);
    const destIdx = Number(t && t.destIdx), from = Number(t && t.from), to = Number(t && t.to);
    const arrEpoch = Number(t && t.arrEpoch), run = Number(t && t.run) || 0, terminal = !!(t && t.terminal);
    if (!trackId || !line || (dir !== 1 && dir !== 2) || !Number.isInteger(destIdx) ||
        !Number.isInteger(from) || !Number.isInteger(to) || !Number.isFinite(arrEpoch) ||
        (!terminal && !(run > 0))) { audit.malformed++; continue; }
    if (model && model.lines && model.lines.has(line)) {
      const n = model.lines.get(line).stations.length;
      if (destIdx < 0 || destIdx >= n || from < 0 || from >= n || to < 0 || to >= n) { audit.malformed++; continue; }
    }
    if (seenTrackIds.has(trackId)) continue; // 同輪同 trackId 只取第一筆(防上游異常重複)
    seenTrackIds.add(trackId);
    // tr[] 陣列的座標系是「服務日秒數」(可 >86400),不是原始 epoch;shift 必須在同一座標系下
    // 相減才有意義(同構前端 etaSec=trtcServiceSec(arrEpoch) 再減 scheduledEvent 的做法)。
    // depSec 用 arrSec 直接減 run(單一轉換點),不對 depEpoch 另外獨立轉換——避開 04:00 服務日
    // 切點理論上的不連續(儘管營運時段 05:40-01:20 實務上不會有 claim 落在切點附近)。
    const arrSec = trtcServiceSecOfEpoch(arrEpoch);
    const depSec = terminal ? arrSec : arrSec - run;
    const claim = { trackId, line, dir, from, to, destIdx, arrEpoch, arrSec, depSec, terminal };
    (trackToFullKey.has(trackId) ? stickyTracks : freshTracks).push(claim);
  }

  const evictedRebinds = new Map(); // trackId -> 離開前那個 tripKey 累積的 rebinds(供新綁定接續累加)

  // 5) Pass A,沿用中的綁定:目的地不符 ⇒ 標記驅逐(§5.2「dest 改變」);找不到 leg ⇒ 整輪跳過不動它
  //    (legMiss,防禦性:正常不應觸發);否則就地更新 shift/lastTo/lastArrEpoch——此時還不判安全閥,
  //    因為 ref 要等這一輪全部沿用值更新完才算得出來。
  const updatedFullKeys = new Set(); // 這輪真的重算過 shift 的 fullKey,才需要跑安全閥判斷
  for (const claim of stickyTracks) {
    const fullKey = trackToFullKey.get(claim.trackId);
    const rec = records.get(fullKey);
    const tr = tripByFullKey.get(fullKey);
    if (!rec || !tr) { freshTracks.push(claim); continue; } // 防禦:priorBindings 與 tripSets 對不上(誤餵跨日資料)
    if (claim.destIdx !== tr[tr.length - 2]) {
      evictedRebinds.set(claim.trackId, rec.rebinds);
      records.delete(fullKey);
      freshTracks.push(claim);
      continue;
    }
    let scheduledEvent;
    if (claim.terminal) {
      if (tr[0] !== claim.from) { audit.legMiss++; continue; }
      scheduledEvent = tr[1];
    } else {
      const k = tripLegIndex(tr, claim.from, claim.to);
      if (k < 0) { audit.legMiss++; continue; }
      scheduledEvent = tr[(k - 1) * 2 + 1];
    }
    rec.lastShift = claim.depSec - scheduledEvent;
    rec.lastTo = claim.to;
    rec.lastArrEpoch = claim.arrEpoch;
    rec._reachedEnd = !claim.terminal && claim.to === tr[tr.length - 2] && claim.arrEpoch <= nowEpoch;
    updatedFullKeys.add(fullKey);
  }

  // 6) ref:依 line+dir 分組,採「boundEpoch 落在最近 20 分鐘內」且非 done 的紀錄之 lastShift 中位數。
  const refByGroup = new Map();
  {
    const byGroup = new Map();
    for (const rec of records.values()) {
      if (rec.done || nowEpoch - rec.boundEpoch > TRIP_BIND_REF_WINDOW_SEC) continue;
      const gk = `${rec.line}|${rec.dir}`;
      if (!byGroup.has(gk)) byGroup.set(gk, []);
      byGroup.get(gk).push(rec.lastShift);
    }
    for (const [gk, values] of byGroup) refByGroup.set(gk, median(values) || 0);
  }

  // 7) 安全閥:只對這輪真的重算過 shift 的沿用中綁定判斷(§5.2)。連續 4 輪 cost 超標才解綁,
  //    條件刻意窄——寬了就回到每輪重猜(這正是本設計要根治的現行 bug)。
  for (const fullKey of updatedFullKeys) {
    const rec = records.get(fullKey); if (!rec) continue;
    const ref = refByGroup.get(`${rec.line}|${rec.dir}`) || 0;
    if (Math.abs(rec.lastShift - ref) > TRIP_BIND_COST_CAP_SEC) {
      rec.badStreak++;
      if (rec.badStreak >= TRIP_BIND_BAD_STREAK_LIMIT) {
        evictedRebinds.set(rec.trackId, rec.rebinds);
        records.delete(fullKey);
        const claim = stickyTracks.find(c => c.trackId === rec.trackId);
        if (claim) freshTracks.push(claim);
      }
    } else {
      rec.badStreak = 0;
    }
  }

  // 8) 無反轉約束(§5.1(b),v1.2改):候選(tr,shift)與同(line,dir)班表序相鄰的「活躍」綁定
  //    比較修正後**發車**時刻(tr[1]+各自 shift),只查緊鄰前後兩班,該班未綁或已收班則不構成約束。
  //    取代 v1.0 的「前驅單調水位線」——語料實測水位線會把終點折返靜默重生的車永久擋死
  //    (unbound 67.8%,98.2% 有合理候選卻被水位/連鎖佔用擋掉;水位線把「出生順序」當成
  //    「發車順序」,兩者在 track 折返/碎裂重生時脫鉤)。FIFO 的目的是時序不反轉,不是出生序單調。
  //    v1.1 曾比較「修正後末站時刻」,短程/長程班交錯發車時(如 R 線北投/淡水)不同路線長度的
  //    末站時刻不可比,系統性誤判假反轉(語料實測 21.3% 相鄰班次對 destIdx 不同,cost=11 的
  //    近乎完美匹配被短程鄰班擋下)。改比「修正後發車時刻」:同 (line,dir) 班次同起點
  //    (分支已拆獨立線 id),發車序即物理進入共線段的 FIFO 序,跨目的地天生可比,且仍保留
  //    跨目的地真反轉偵測能力(這是不採 destIdx 分組方案的原因——分組會連這個能力一併失去)。
  const scheduleNeighbors = new Map(); // fullKey -> { prevKey, nextKey }(依 tr[1] 班表序)
  for (const [gk, trips] of tripSets || []) {
    const sep = gk.lastIndexOf('|'); const line = gk.slice(0, sep), dir = Number(gk.slice(sep + 1));
    const sorted = [...trips].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < sorted.length; i++) {
      const fullKey = tripBindKey(line, dir, tripKeyOf(sorted[i]));
      scheduleNeighbors.set(fullKey, {
        prevKey: i > 0 ? tripBindKey(line, dir, tripKeyOf(sorted[i - 1])) : null,
        nextKey: i < sorted.length - 1 ? tripBindKey(line, dir, tripKeyOf(sorted[i + 1])) : null,
      });
    }
  }
  function violatesNoReversal(fullKey, tr, shift) {
    const nb = scheduleNeighbors.get(fullKey);
    if (!nb) return false;
    const candDep = tr[1] + shift;
    if (nb.prevKey) {
      const prevRec = records.get(nb.prevKey);
      const prevTr = prevRec && !prevRec.done && tripByFullKey.get(nb.prevKey);
      if (prevTr && prevTr[1] + prevRec.lastShift > candDep) return true;
    }
    if (nb.nextKey) {
      const nextRec = records.get(nb.nextKey);
      const nextTr = nextRec && !nextRec.done && tripByFullKey.get(nb.nextKey);
      if (nextTr && nextTr[1] + nextRec.lastShift < candDep) return true;
    }
    return false;
  }

  // 9) 認回 reclaim(§5.3,v1.1新增):出生綁定之前,先讓「已綁但這輪沒收到更新」的班次
  //    (line+dir+dest 相同、cost=|shift-lastShift|≤180s 取最小者)優先認回新 track——
  //    track_id 更新、boundEpoch 延續、badStreak 歸零(新連續性起點),不走出生的
  //    ref-relative cost/cap,但仍過 (8) 無反轉檢查。處理「同一班次中途斷連、track 換 id
  //    重現」(Y 的 synth 碎裂、CW alias 斷檔、終點折返靜默後在路線中段以新 id 重見)。
  const reclaimEdges = [];
  for (const claim of freshTracks) {
    for (const [fullKey, rec] of records) {
      if (rec.done || updatedFullKeys.has(fullKey)) continue; // 本輪仍在回報中的不算「失聯」
      if (rec.line !== claim.line || rec.dir !== claim.dir) continue;
      const tr = tripByFullKey.get(fullKey); if (!tr || tr[tr.length - 2] !== claim.destIdx) continue;
      let scheduledEvent;
      if (claim.terminal) {
        if (tr[0] !== claim.from) continue;
        scheduledEvent = tr[1];
      } else {
        const k = tripLegIndex(tr, claim.from, claim.to);
        if (k < 0) continue;
        scheduledEvent = tr[(k - 1) * 2 + 1];
      }
      const shift = claim.depSec - scheduledEvent;
      const cost = Math.abs(shift - rec.lastShift);
      if (cost > TRIP_BIND_RECLAIM_COST_CAP_SEC) continue;
      if (violatesNoReversal(fullKey, tr, shift)) continue; // (8) 無反轉檢查仍要過
      reclaimEdges.push({ claim, fullKey, tr, shift, cost });
    }
  }
  reclaimEdges.sort((a, b) => a.cost - b.cost);
  const reclaimedTracks = new Set(), reclaimedKeys = new Set();
  for (const e of reclaimEdges) {
    if (reclaimedTracks.has(e.claim.trackId) || reclaimedKeys.has(e.fullKey)) continue;
    if (violatesNoReversal(e.fullKey, e.tr, e.shift)) continue; // 同輪較早認回可能已改變鄰居活躍狀態,重驗
    reclaimedTracks.add(e.claim.trackId); reclaimedKeys.add(e.fullKey);
    const rec = records.get(e.fullKey);
    rec.trackId = e.claim.trackId; rec.lastShift = e.shift; rec.lastTo = e.claim.to;
    rec.lastArrEpoch = e.claim.arrEpoch; rec.badStreak = 0;
    rec._reachedEnd = !e.claim.terminal && e.claim.to === e.tr[e.tr.length - 2] && e.claim.arrEpoch <= nowEpoch;
    updatedFullKeys.add(e.fullKey);
    events.push({ type: 'reattach', day, line: rec.line, dir: rec.dir, tripKey: rec.tripKey,
      trackId: e.claim.trackId, epoch: nowEpoch });
    audit.reattach++;
  }
  const birthTracks = reclaimedTracks.size ? freshTracks.filter(c => !reclaimedTracks.has(c.trackId)) : freshTracks;

  // 10) 出生綁定(§5.1):候選池排除已佔用(records 現存的所有 fullKey,含剛認回的)。
  const occupiedTripKeys = new Set(records.keys());
  const edges = [];
  for (const claim of birthTracks) {
    const gk = `${claim.line}|${claim.dir}`;
    const ref = refByGroup.get(gk) || 0;
    for (const tr of (tripSets && tripSets.get(gk)) || []) {
      if (!tripRosterActive(tr, nowSec) || tr[tr.length - 2] !== claim.destIdx) continue;
      const fullKey = tripBindKey(claim.line, claim.dir, tripKeyOf(tr));
      if (occupiedTripKeys.has(fullKey)) continue;
      let scheduledEvent;
      if (claim.terminal) {
        if (tr[0] !== claim.from) continue;
        scheduledEvent = tr[1];
      } else {
        const k = tripLegIndex(tr, claim.from, claim.to);
        if (k < 0) continue;
        scheduledEvent = tr[(k - 1) * 2 + 1];
      }
      const shift = claim.depSec - scheduledEvent;
      if (shift < TRIP_BIND_MAX_EARLY_SEC) continue; // (a) 禁早發
      if (violatesNoReversal(fullKey, tr, shift)) continue; // (b) 無反轉約束
      const cost = Math.abs(shift - ref);
      if (cost > TRIP_BIND_COST_CAP_SEC || Math.abs(shift) > TRIP_BIND_ABS_CAP_SEC) { audit.capped++; continue; } // (c) cap
      edges.push({ claim, tr, fullKey, shift, cost });
    }
  }
  edges.sort((a, b) => a.cost - b.cost);
  const usedTracks = new Set(), usedTripKeys = new Set(occupiedTripKeys);
  for (const e of edges) {
    if (usedTracks.has(e.claim.trackId) || usedTripKeys.has(e.fullKey)) continue;
    if (violatesNoReversal(e.fullKey, e.tr, e.shift)) continue; // 同輪較早出生可能已改變鄰居活躍狀態,重驗
    usedTracks.add(e.claim.trackId); usedTripKeys.add(e.fullKey);
    const priorRebinds = evictedRebinds.get(e.claim.trackId);
    records.set(e.fullKey, {
      line: e.claim.line, dir: e.claim.dir, tripKey: tripKeyOf(e.tr), trackId: e.claim.trackId,
      boundEpoch: nowEpoch, birth: e.claim.terminal ? 'terminal' : 'seed',
      lastShift: e.shift, lastTo: e.claim.to, lastArrEpoch: e.claim.arrEpoch, badStreak: 0,
      done: false, rebinds: priorRebinds != null ? priorRebinds + 1 : 0,
    });
    events.push({ type: 'bind', day, line: e.claim.line, dir: e.claim.dir, tripKey: tripKeyOf(e.tr),
      trackId: e.claim.trackId, epoch: nowEpoch, birth: e.claim.terminal ? 'terminal' : 'seed' });
    audit.bound++;
    if (priorRebinds != null) audit.rebinds++;
  }
  audit.unbound += birthTracks.filter(c => !usedTracks.has(c.trackId)).length;

  // 11) 收班判定(§5.3):對所有存活(非 done)紀錄跑一次,涵蓋沉默(本輪沒有沿用列的失聯 track)
  //    與剛出生的兩種情況。「觀測到達終點」或「修正後末站時刻已過+120s 寬限」任一成立即收班。
  for (const [fullKey, rec] of records) {
    if (rec.done) continue;
    const tr = tripByFullKey.get(tripBindKey(rec.line, rec.dir, rec.tripKey));
    if (!tr) continue;
    const reachedEnd = updatedFullKeys.has(fullKey) && !!rec._reachedEnd;
    const scheduleGraceOver = nowSec >= tr[tr.length - 1] + rec.lastShift + TRIP_BIND_DONE_GRACE_SEC;
    if (reachedEnd || scheduleGraceOver) {
      rec.done = true;
      events.push({ type: 'done', day, line: rec.line, dir: rec.dir, tripKey: rec.tripKey,
        trackId: rec.trackId, epoch: nowEpoch });
      audit.done++;
    }
  }

  const bindings = [...records.values()].map(({ _reachedEnd, ...rest }) => rest);
  return { bindings, events, audit: { ...audit, dayType } };
}

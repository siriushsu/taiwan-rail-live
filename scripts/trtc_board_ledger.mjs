// 北捷看板事件帳本的純函式核心。Worker cron 與 /api/trtc-live 共用；本模組不碰網路與 D1。

export const DEFAULT_DWELL_SEC = 25;
export const ALIGN_GAP_METERS = 1500;
const O_TRUNK_MAX = 11;
// 中和新蘆線的兩支在索引 0..O_TRUNK_MAX 共用同一段實體軌道（站名、座標完全相同），所以
// 「這筆觀測屬於哪一支」在共線段上是資料本身答不出來的問題。branchAmbiguous 回答的就是
// 「這筆觀測有沒有資格『寫』分支歸屬」，歧義的權威定義取自 pickBoardCandidate——站在幹線上
// **而且**終點也在幹線上，才真的分不出蘆洲／迴龍。終點是蘆洲／迴龍的列 boardCandidates 只會
// 給一個候選，那是權威證據，即使車此刻人在幹線上也必須放行；一併鎖住會把既有的錯歸屬凍成
// 永久（實測幹線站官方列有 47% 屬於這類）。destIdx 缺漏時保守視為歧義，避免資料異常時
// 退回舊的回饋迴圈。
const O_BRANCH_LINES = new Set(['O_LUZHOU', 'O_XINZHUANG']);
const branchAmbiguous = item => O_BRANCH_LINES.has(item.line) &&
  Number(item.from) <= O_TRUNK_MAX && Number(item.to) <= O_TRUNK_MAX &&
  !(Number(item.destIdx) > O_TRUNK_MAX);

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

// opts.includeY:環狀線 Y 屬新北捷。呼叫端(worker.js trtcLedgerModel/trtcBoardModel)工項4起
// 兩者皆傳 includeY:true——Y 的 tracks/bindings 與其他八線同一條路徑處理,只有 events 表在
// D1 寫入層(persistTrtcLedger)另外過濾排除(設計書 §6.1,寫入額度考量)。opts 預設 false
// 只留給「刻意不含 Y」的呼叫端(如本檔的單元測試)使用。
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

// ── 從官方每站倒數切段還原逐車位置（2026-08-18 使用者裁示）─────────────────────
// 裁示原文：「BR你車號沒認出來就算了，我們就有倒數時間 知道車子在哪兩站之間 知道有多少車
// 所以就算沒有編號 有資訊就一定要對 不可能拿什麼carweight慢那麼多的時間去顯示給人看」
//
// 文湖線在 TrackInfo 的 TrainNumber 恆為空字串 ⇒ 建不出 per-vehicle path，舊做法只好退回
// CarWeightBR 的粗站碼畫車（`UpdateTime` 實測落後 96–265 秒，而 TrackInfo 的 NowDateTime
// 只落後約 15 秒）——把最新的資料拿去畫看板、把最舊的拿去畫車，方向是反的。
//
// 幾何推導（本函式的全部依據，不含任何經驗常數）：
//   同向不能超車 ⇒ 車沿線有序 p1 < p2 < …（以行進方向為序）。
//   某站 s 的「下一班」＝ s 後方最近的那台車 ⇒ 在同一台車的責任區內，站愈遠到站時刻愈晚；
//   跨過下一台車的位置時，責任者換成更近的那台 ⇒ 到站時刻**跌回小值**。
//   ⇒ 沿行進方向掃過各站，一段「到站時刻遞增」＝一台車；跌值處＝分界。
//   ⇒ 該台車就在「該段第一站的前一站」與「該段第一站」之間，且 arrEpoch 秒後到第一站。
// 段數＝車數，可與 CarWeightBR 去重後的列數交叉檢核（兩個獨立來源，判準不同源）。
//
// 🔴 只對「TrackInfo 不給 TrainNumber」的線使用（目前只有 BR）。高運量本來就有 per-vehicle
// path 且同樣新鮮，不要順手改掉——那會把一條已驗證的路徑換成未驗證的。
// 🔴 起點列不生車：官方每個終點各有一筆「下一班」列，它的進站時刻不是發車錨點，直接採信
// 就是幽靈車來源（見 memory trtc-origin-identity-ghosts）。段首落在線端 ⇒ from 會掉出線外，
// 本函式據此丟棄並計入 diagnostics，不另設經驗門檻。
export const SAME_TRAIN_MIN_RUN_RATIO = 0.5;

// 沿行進方向累加 a→b 的區間行車秒；任一段缺值就回 null（不猜、不用距離頂替），
// 呼叫端在 null 時只靠「嚴格遞增」判斷。環狀線 Y 的 segs 全缺就是走這條退路。
function cumulativeRunSec(line, a, b, step) {
  let total = 0;
  for (let i = a; i !== b; i += step) {
    const sec = line.runs && line.runs.get(step > 0 ? `${i}>${i + 1}` : `${i}>${i - 1}`);
    if (!(sec > 0)) return null;
    total += sec;
  }
  return total;
}

// 把「倒數切出來的段」對應到「CarWeight 的逐車列」。
//
// 兩邊都必須先依行進方向由前到後排好。倒數切段**只會少不會多**（實測 08-15 語料 80 個方向：
// 差 0 佔 38%、−1 佔 49%、−2 佔 14%，+1／+2 各 0 次），少的那 1–2 台是端點附近結構上觀測不到的
// （跑最後一段沒有前方站可報、剛要發車的起點列被丟），必定落在頭或尾 ⇒ 正確對應只可能是
// vehicles 裡的一段**連續視窗**，候選僅 N−M+1 個。
//
// 評分：CarWeight 的站碼落後（實測 96–265 秒），所以推導位置應該在它**前方**；
// 落後多少秒直接量（段的基準時刻 − 該列的 UpdateTime），除以中位區間秒得到「最多可能前進幾站」。
// 容忍 −1 是站碼本身的整站量化誤差（車已過站但站碼還沒跳，或反之）。
// 回傳最佳位移；沒有任何視窗說得通就回 -1（寧可整個方向不配，也不貼錯位置）。
// 🔴 2026-08-18 06:15 正式站實測訂正：段數**也會多**（切段 15 vs CarWeight 14）。
// 先前「只會少不會多」是拿 fixture 的 `.board`（**清洗後**的看板列）反推 TrackInfo 量的，
// 而產品是對**原始** TrackInfo 切段——判準的輸入與產品不同源，於是量不到這一側。
// ⇒ 兩側都要能滑：哪一邊長就在哪一邊開視窗，短的那串保持完整（與原本同一個假設：
// 缺／多的都在端點）。回傳 { dOff, vOff, n }；沒有任何視窗說得通就回 null。
export function alignSegmentsToVehicles(derived, vehicles, step, medianRun) {
  if (!Array.isArray(derived) || !Array.isArray(vehicles)) return null;
  if (!derived.length || !vehicles.length || !(medianRun > 0)) return null;
  const n = Math.min(derived.length, vehicles.length);
  const dMax = derived.length - n, vMax = vehicles.length - n; // 其中一個必為 0
  let best = null, bestScore = Infinity;
  for (let dOff = 0; dOff <= dMax; dOff++) {
    for (let vOff = 0; vOff <= vMax; vOff++) {
      let score = 0, ok = true;
      for (let i = 0; i < n; i++) {
        const d = derived[dOff + i], v = vehicles[vOff + i];
        const lag = Math.max(0, Number(d.baseEpoch) - Number(v.at));
        const ahead = (Number(d.to) - Number(v.idx)) * step;
        if (!Number.isFinite(ahead) || ahead < -1 || ahead > lag / medianRun + 2) { ok = false; break; }
        score += Math.abs(ahead);
      }
      if (ok && score < bestScore) { bestScore = score; best = { dOff, vOff, n }; }
    }
  }
  return best;
}

export function segmentVehiclesFromCountdowns(model, resolvedRows, opts = {}) {
  const only = new Set(opts.lines || []);
  const groups = new Map(); // `${line}|${dir}` → rows[]
  for (const r of resolvedRows || []) {
    if (only.size && !only.has(r.line)) continue;
    const key = `${r.line}|${r.dir}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const vehicles = [], diagnostics = { originRows: 0, groups: 0, rowsUsed: 0, duplicateStations: 0 };
  for (const [key, rows] of groups) {
    const sep = key.lastIndexOf('|');
    const lineId = key.slice(0, sep), dir = Number(key.slice(sep + 1));
    const line = model && model.lines && model.lines.get(lineId);
    if (!line || !Array.isArray(line.stations) || !line.stations.length) continue;
    const step = dir === 2 ? 1 : -1;
    // 同一站同方向理論上只有一列（官方限制：一個目的地一班）；真的多列就取最早到站那筆，
    // 因為「下一班」的定義就是最近的那台。
    const byStation = new Map();
    for (const r of rows) {
      const prev = byStation.get(r.stationIdx);
      if (prev) diagnostics.duplicateStations++;
      if (!prev || r.arrEpoch < prev.arrEpoch) byStation.set(r.stationIdx, r);
    }
    const ordered = [...byStation.values()].sort((a, b) => (a.stationIdx - b.stationIdx) * step);
    if (!ordered.length) continue;
    diagnostics.groups++;
    diagnostics.rowsUsed += ordered.length;
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const head = run[0], from = head.stationIdx - step;
      if (from < 0 || from >= line.stations.length) { diagnostics.originRows++; run = []; return; }
      vehicles.push({
        line: lineId, dir, from, to: head.stationIdx, arrEpoch: head.arrEpoch,
        // 這條 path 的時間基準＝官方自己的 NowDateTime，不是我方 fetch 時刻。下游拿它當
        // 新鮮度判準，才不會用 CarWeight 的時鐘去量 TrackInfo 的資料。
        baseEpoch: head.baseEpoch,
        destIdx: head.destIdx, destName: head.destName, observed: run.length,
        // 與高運量 meta.path 同形狀（{name, eta}，行進方向排序），下游一行都不用改。
        path: run.map(r => ({ name: line.stations[r.stationIdx].name, eta: r.arrEpoch })),
      });
      run = [];
    };
    for (const r of ordered) {
      const prev = run.length ? run[run.length - 1] : null;
      if (prev) {
        // 條件一：嚴格遞增。同一台車到相鄰兩站至少差一個區間行車秒，不可能相等或變小。
        // 條件二：**跑得到**。遞增還不夠——起點列（「下一班」）的時刻可能比後方真車還早，
        // 兩者會被「遞增」誤併成同一段，把真車整台吃掉（本函式初版實測踩到）。
        // 同一台車從 prev 站走到 r 站至少要花該區間的行車秒；差額遠小於它就是物理上跑不到，
        // 必為另一台車。門檻取「線上已知區間秒」的一半：實測區間秒 47–172，真車與公告值的
        // 偏差不會到一半，而誤併案例的比值只有 7%（25 秒 vs 應走 360 秒）——(0.3, 0.9) 之間
        // 任何值都能分開，取中點。🔴 這個比例要在營運時段用實測倒數校正（見 memory
        // trtc-position-from-countdown 的待驗項），不是永久常數。
        const expected = cumulativeRunSec(line, prev.stationIdx, r.stationIdx, step);
        const tooFast = expected != null && (r.arrEpoch - prev.arrEpoch) < expected * SAME_TRAIN_MIN_RUN_RATIO;
        if (r.arrEpoch <= prev.arrEpoch || tooFast) flush();
      }
      run.push(r);
    }
    flush();
  }
  return { vehicles, diagnostics };
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

// ── 小工具「再下一班」：從在途官方名冊推導第二班到站時刻（2026-08-22 使用者裁示）────
// 裁示原文：「下一班我覺得可以寫『約N分』每條線每個方向都可以做到這樣。當小工具選擇某
// 方向的時候至少要有兩班車」「但還沒發車的時候 離峰的時候 確實可以留白」。
// ⇒ 官方看板每（站,終點）只給一列「下一班」；第二班只從**已發車在途**的官方名冊車推導
//   （未發車起點列不算車，08-18 裁示），推不出就留白——不用班表補（08-14 裁示：班表只是
//   斷訊備案），第一列的官方原文一個字不動。
// 候選＝同線同向**同終點**且本站仍在其剩餘路徑上的在途車（同終點才能掛在該列下面而不說謊；
// 區間車會出現在官方自己的另一列，不歸這裡）。到站時刻＝候選車下一站 arrEpoch 沿線累加
// （停靠秒＋區間行車秒），任一段 run 缺值就放棄該候選（不猜、不用距離頂替；環狀線 Y 的
// runs 全缺 ⇒ 整線自然留白）。第一班自己必然以 ≈0 間隔出現在候選裡，靠 MIN_GAP 濾掉——
// 北捷最密實際班距 ≥66 秒，30 秒只會濾掉自己，不會誤殺真第二班。
export const NEXT2_MIN_GAP_SEC = 30;
export const NEXT2_MAX_HORIZON_SEC = 60 * 60; // 超過一小時的投影不出手（跨半條路網的累積誤差）
export function deriveSecondArrivals(model, resolvedRows, vehicles, calibrations = new Map()) {
  const inTransit = (vehicles || []).filter(v =>
    !(v.from === v.to && v.terminal === true && Number(v.run) === 0));
  const out = [];
  for (const r of resolvedRows || []) {
    const line = model.lines.get(r.line);
    if (!line) continue;
    const step = r.dir === 2 ? 1 : -1;
    if ((r.destIdx - r.stationIdx) * step < 0) continue;
    let best = null;
    for (const v of inTransit) {
      if (v.line !== r.line || Number(v.dir) !== r.dir || Number(v.dest) !== r.destIdx) continue;
      const to = Number(v.to);
      if (!Number.isFinite(to) || (r.stationIdx - to) * step < 0) continue; // 已駛過本站
      let eta = Number(v.arrEpoch);
      if (!Number.isFinite(eta)) continue;
      let ok = true;
      for (let i = to; i !== r.stationIdx; i += step) {
        const run = runSeconds(model, r.line, r.dir, i, i + step, calibrations);
        if (!(run > 0)) { ok = false; break; }
        eta += ((line.stations[i] && line.stations[i].dwell) || DEFAULT_DWELL_SEC) + run;
      }
      if (!ok) continue;
      if (eta <= r.arrEpoch + NEXT2_MIN_GAP_SEC) continue;
      if (eta - r.baseEpoch > NEXT2_MAX_HORIZON_SEC) continue;
      if (!best || eta < best.eta2) best = { eta2: Math.round(eta), v2: String(v.vehicleId) };
    }
    if (best) {
      const st = line.stations[r.stationIdx];
      out.push({ s: st ? st.name : String(r.stationIdx), d: r.destName, eta2: best.eta2, v2: best.v2 });
    }
  }
  return out;
}

export function claimBoardRows(model, resolvedRows, nowEpoch, calibrations) {
  const claims = [], unclaimed = [];
  const claimOne = (row, allowBehind = false) => {
    const step = row.dir === 2 ? 1 : -1;
    const from = row.stationIdx - step;
    const line = model.lines.get(row.line);
    if (!line) return null;
    if (from < 0 || from >= line.stations.length) {
      return { ...row, from: row.stationIdx, to: row.stationIdx, run: 0, depEpoch: row.arrEpoch,
        progress: 0, ix: row.stationIdx, terminal: true, eventClaims: [] };
    }
    const run = runSeconds(model, row.line, row.dir, from, row.stationIdx, calibrations);
    if (!(run > 0)) { unclaimed.push({ row, reason: 'no_run' }); return null; }
    const dwell = line.stations[from].dwell || DEFAULT_DWELL_SEC;
    const remain = row.arrEpoch - nowEpoch;
    if (!allowBehind && remain >= run + dwell) {
      unclaimed.push({ row, reason: 'behind', remain, threshold: run + dwell }); return null;
    }
    const progress = Math.max(0, Math.min(1, 1 - remain / run));
    return { ...row, from, to: row.stationIdx, run, depEpoch: row.arrEpoch - run, progress,
      ix: from + step * progress, terminal: false, eventClaims: [] };
  };

  // 有官方車號的列仍由 collapseClaims() 以 no 精確合成；它們只需要留下最靠近列車
  // 當下位置的 claim，其餘逐站時間會由 attachOfficialTimelines() 依同一 no 全數接回。
  const anonymousGroups = new Map();
  const numberedStreams = new Set((resolvedRows || []).filter(row => row.no)
    .map(row => `${row.line}|${Number(row.dir)}|${Number(row.destIdx)}`));
  for (const row of resolvedRows || []) {
    if (row.no) {
      const claim = claimOne(row, false);
      if (claim) claims.push(claim);
      continue;
    }
    const key = `${row.line}|${Number(row.dir)}|${Number(row.destIdx)}`;
    // 紅／橘等有車號的 stream 偶爾只漏一列 TrainNumber；那是同一股資料的標籤缺口，
    // 不能把整股改套無號線分群，否則會擾動既有 ledger 配對。只有整股完全無號（Y／BR）
    // 才使用下方逐站 epoch 規則。
    if (numberedStreams.has(key)) {
      const claim = claimOne(row, false);
      if (claim) claims.push(claim);
      continue;
    }
    if (!anonymousGroups.has(key)) anonymousGroups.set(key, []);
    anonymousGroups.get(key).push(row);
  }

  // 文湖線／環狀線沒有 TrainNumber。官方在每站只給「下一班」倒數；沿行進方向看，
  // 同一台車的到站 epoch 必須逐站遞增，epoch 回落就是下一台車的邊界。直接用這條
  // 官方逐站時間不變式分群，不能再拿「倒數是否小於本地估計的一段 run」各站獨立生車；
  // 後者在環狀線橋和—中和等段秒估計偏長時，會把同一台車畫成相鄰兩台。
  for (const group of anonymousGroups.values()) {
    if (!group.length) continue;
    const dir = Number(group[0].dir), step = dir === 2 ? 1 : -1;
    group.sort((a, b) => step * (Number(a.stationIdx) - Number(b.stationIdx)) ||
      Number(a.arrEpoch) - Number(b.arrEpoch) || Number(a.baseEpoch) - Number(b.baseEpoch));
    const partitions = [];
    for (const row of group) {
      const block = partitions.at(-1), previous = block && block.at(-1);
      const forward = previous && step * (Number(row.stationIdx) - Number(previous.stationIdx)) > 0;
      if (!previous || !forward || Number(row.arrEpoch) <= Number(previous.arrEpoch)) partitions.push([row]);
      else block.push(row);
    }
    for (const block of partitions) {
      const events = block.map(row => claimOne(row, true)).filter(Boolean);
      if (!events.length) continue;
      // 兩站到站時間都已知時，下一段發車＝上一站到站＋停站；第一段才退回本地 run。
      // 這讓動畫真正依官方逐站時間走，不受舊班表段秒誤差拉出第二台車。
      for (let i = 1; i < events.length; i++) {
        const previous = events[i - 1], current = events[i];
        if (Number(previous.to) !== Number(current.from)) continue;
        const line = model.lines.get(current.line);
        const dwell = previous.terminal ? 0 : (line.stations[Number(previous.to)].dwell || DEFAULT_DWELL_SEC);
        const depEpoch = Number(previous.arrEpoch) + dwell;
        if (depEpoch < Number(current.arrEpoch)) {
          current.depEpoch = depEpoch;
          current.run = Number(current.arrEpoch) - depEpoch;
        }
      }
      const representative = events[0];
      claims.push({ ...representative, eventClaims: events.map(event => ({ ...event, eventClaims: [] })),
        timelinePartitioned: true });
    }
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
    const deleted = new Set(), events = group.map(c =>
      Array.isArray(c.eventClaims) && c.eventClaims.length ? c.eventClaims.map(x => ({ ...x })) : [c]);
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
        // 起點列（a.terminal）與它的第一段列可以隔到整段（見下方時間軸條件），不受 0.6 站近站窗限制。
        if ((a.dir === 2 ? 1 : -1) * (b.ix - a.ix) > 0.6 && !a.terminal) break;
        if (a.no && b.no) continue;
        // 無號線已由完整逐站 epoch 的單調區段分群；不得再用舊的近站門檻把下一班
        // 起點倒數吞進前車，或把同一區段拆回兩台。
        if (a.timelinePartitioned || b.timelinePartitioned) continue;
        // 官方站牌每站每個終點只報「下一班」：同一站兩筆不同終點的列＝兩台車（起點站天天如此：
        // 頂埔／亞東醫院、新店／台電大樓…）。2026-08-15 實測：起點兩筆終點不同的倒數在這裡被合成
        // 一筆（arr 取一班、timeline 取另一班的 chimera），被吃掉的那班在官方翻回來時又以新 ID 出生，
        // 舊 ID 釘死在起點永不退場——畫面上同段擠三台、其中一台無號的幽靈車就是這樣來的。
        if (Number(a.destIdx) !== Number(b.destIdx)) continue;
        // 起點列（a）與第一段列（b）是同一台車的判準是時間軸自洽：一台車不可能比抵達起點更早抵達
        // 下一站，所以 b.arr ≥ a.arr 才是同一台；b.arr < a.arr 是前一班已離站、a 是還沒進站的下一班。
        // 舊判準 progress<=0.25 兩邊都錯：起點列的 arrEpoch 是「進站」時刻而非發車錨點、官方第一段
        // 間隔又普遍短於模型段秒（08-15 語料 BL/G/O/R 逐列比值 0.5–0.8），progress 0.31 的同一台車被拆成兩筆；
        // 而剛離站 25% 內的前一班反而會把下一班的未來倒數吞進去。
        const hit = (a.to === b.from && a.progress >= 0.94 && b.progress <= 0.25) ||
          (a.terminal && !b.terminal && b.from === a.to && Number(b.arrEpoch) >= Number(a.arrEpoch));
        if (!hit) continue;
        deleted.add(i); events[j].push(...events[i]); break; // 保留較前面的 b
      }
    }
    group.forEach((claim, i) => { if (!deleted.has(i)) out.push({ ...claim, eventClaims: events[i] }); });
  }
  return out;
}

// 同一官方車號會同時出現在前方多個站牌倒數；它們是同一輛車的逐站時間軸，不能各自生車。
// collapsedClaims 決定「這輪有幾輛車」，resolvedRows 只補上同車未來各站的官方 dep/arr，
// 絕不單獨增加名冊列。無車號列仍只採 collapseClaims 已能相鄰合併的 eventClaims。
export function attachOfficialTimelines(model, collapsedClaims, resolvedRows, calibrations = new Map()) {
  const numbered = new Map();
  for (const raw of resolvedRows || []) {
    if (!raw || !raw.no || !model.lines.has(raw.line)) continue;
    const key = `${raw.line}|${Number(raw.dir)}|${String(raw.no)}`;
    if (!numbered.has(key)) numbered.set(key, []);
    numbered.get(key).push(raw);
  }
  const segmentOf = raw => {
    const line = model.lines.get(raw.line), dir = Number(raw.dir), step = dir === 2 ? 1 : -1;
    const to = Number(raw.stationIdx ?? raw.to), arrEpoch = Number(raw.arrEpoch);
    if (!line || (dir !== 1 && dir !== 2) || !Number.isInteger(to) || !Number.isFinite(arrEpoch)) return null;
    const from = raw.terminal ? Number(raw.from) : to - step;
    if (raw.terminal || from < 0 || from >= line.stations.length) {
      return { from: to, to, depEpoch: arrEpoch, arrEpoch, terminal: true };
    }
    const run = Number(raw.run) > 0 ? Number(raw.run) : runSeconds(model, raw.line, dir, from, to, calibrations);
    if (!(run > 0)) return null;
    const explicitDep = Number(raw.depEpoch);
    return { from, to, depEpoch: Number.isFinite(explicitDep) && explicitDep < arrEpoch ? explicitDep : arrEpoch - run,
      arrEpoch, terminal: false };
  };
  return (collapsedClaims || []).map(claim => {
    const key = claim.no ? `${claim.line}|${Number(claim.dir)}|${String(claim.no)}` : null;
    const sources = key && numbered.has(key)
      ? numbered.get(key)
      : (Array.isArray(claim.eventClaims) && claim.eventClaims.length ? claim.eventClaims : [claim]);
    const segments = sources.map(segmentOf).filter(Boolean).sort((a, b) =>
      (Number(claim.dir) === 2 ? 1 : -1) * (Number(a.to) - Number(b.to)) ||
      Number(a.arrEpoch) - Number(b.arrEpoch));
    for (let i = 1; i < segments.length; i++) {
      const previous = segments[i - 1], current = segments[i];
      if (Number(previous.to) !== Number(current.from)) continue;
      // 起點列的 depEpoch 依定義等於 arrEpoch（車還停在起點）。同一起點排兩班發車時，
      // 這裡曾把後一班的 dep 改寫成前一班的到站時刻，做出 dep<arr 的終點列，
      // reducer 當場擲「timeline 形狀不合法」整輪丟掉、退回 held。
      // 2026-08-15 實測 38 個有效輪次中 22 輪因此丟失（holdReason=assembly-error）。
      if (current.terminal) continue;
      const line = model.lines.get(claim.line);
      const dwell = previous.terminal ? 0 : (line.stations[Number(previous.to)].dwell || DEFAULT_DWELL_SEC);
      const depEpoch = Number(previous.arrEpoch) + dwell;
      if (depEpoch < Number(current.arrEpoch)) current.depEpoch = depEpoch;
    }
    const byLeg = new Map();
    for (const segment of segments) {
      const leg = `${segment.from}>${segment.to}`;
      const old = byLeg.get(leg);
      // 同車、同站若上游意外重複，選較新的 ETA；排序與原陣列順序無關。
      if (!old || Number(segment.arrEpoch) > Number(old.arrEpoch)) byLeg.set(leg, segment);
    }
    const timeline = [...byLeg.values()].sort((a, b) =>
      (Number(claim.dir) === 2 ? 1 : -1) * (Number(a.to) - Number(b.to)) ||
      Number(a.arrEpoch) - Number(b.arrEpoch));
    return { ...claim, timeline };
  });
}

function chooseCodePosition(model, code, priorLine) {
  const rec = model.codeMap.get(String(code || ''));
  if (!rec || !rec.on.length) return null;
  if (priorLine) {
    const hit = rec.on.find(x => x.line === priorLine);
    if (hit) return hit;
  }
  if (rec.on.length === 1) return rec.on[0];
  // 共線段（南勢角…大橋頭）的站碼在蘆洲／迴龍兩支上都成立。這裡猜一支等於憑空造出分支歸屬，
  // 而那個歸屬會經 nearestPrior → trackUpdates → branchLineHintsFromLedger 回頭決定下一輪
  // 看板列該歸哪一支——猜錯一次就自我維持（2026-08-16 車號 436：D1 今日 55 條 O 線 track
  // 只有它「鑄造分支≠現行 line」，畫面上就是景安—南勢角那對疊車）。沒有可信 priorLine 就不採用：
  // 逐車資料只是身分／擁擠度來源，少一輪不影響列車存在性（存在性只由官方站牌決定）。
  if (rec.on.filter(x => O_BRANCH_LINES.has(x.line)).length > 1) return null;
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
      // 這裡曾經加過「跨分支就拒絕接管、改鑄新 track」的守衛，08-16 複審後移除：它結構上不可能
      // 生效，而且會製造新問題。三個理由都實跑驗過——(1) 下一行的 sameCar 會把剛清掉的舊 track
      // 原樣接回來（正式站常態有逐車資料，等於守衛不存在）；(2) D1 的 alias upsert 只更新
      // last_seen_epoch、不換 track_id，另鑄之後 alias 仍指舊 track，下輪再鑄＝每輪 identity churn；
      // (3) synthId 不含車號，同分鐘兩台跨分支另鑄會撞成同一個 id。要真的做，得一起改 worker.js
      // 的 alias 時效與 upsert，那是另一個批次。分支歸屬的保護改由 trackLine 那道（見下方）承擔。
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
    // 分支歸屬一趟一鎖：站與終點都在幹線上的 claim 只是「這台車現在在幹線上」，證明不了它
    // 屬於哪一支。讓它改寫 track.line 就等於讓下一輪的 branchLineHintsFromLedger 讀到自己
    // 上一輪的猜測，整條鏈沒有任何獨立錨點（08-16 根因）。反之終點是蘆洲／迴龍的列帶著權威
    // 證據，照常放行——否則既有的錯歸屬會被凍住，永遠等不到能更正它的那一筆。
    const boundPrior = priorById.get(claim.trackId);
    const trackLine = branchAmbiguous(claim) && boundPrior && O_BRANCH_LINES.has(boundPrior.line)
      ? boundPrior.line : claim.line;
    trackUpdates.push({ day, trackId: claim.trackId, line: trackLine, dir: claim.dir,
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

export const TRIP_BIND_REF_WINDOW_SEC = 20 * 60; // ref 只採「最近 20 分鐘內已綁」的班次(§5.1);工項6影子量測需原樣覆用此窗寬,故導出
const TRIP_BIND_MAX_EARLY_SEC = -90;        // 禁早發:提早超過 90 秒的候選不可綁
const TRIP_BIND_COST_CAP_SEC = 600;         // cost=|shift-ref| 上限
const TRIP_BIND_ABS_CAP_SEC = 1800;         // |shift| 絕對上限(雙保險,防 ref 本身跑掉)
const TRIP_BIND_BAD_STREAK_LIMIT = 4;       // 安全閥:連續幾輪 cost 超標才解綁重配(§5.2)
const TRIP_BIND_DONE_GRACE_SEC = 120;       // 收班寬限(§5.3)
export const TRIP_BIND_FEED_SILENCE_SEC = 3 * 60; // 官方 feed 沉默滿 3 分鐘後才可收班(§5.3)
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
//   model      - buildTrtcModel(...,{includeY:true}) 的那顆(既有 trtcBoardModel,工項4起
//                trtcLedgerModel 也用這個 opts);Y 與其他八線同一條路徑處理,無特判。
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
  const audit = { bound: 0, unbound: 0, rebinds: 0, capped: 0, done: 0, legMiss: 0, malformed: 0,
    reattach: 0, evictedDest: 0, evictedSafety: 0 };
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
      // 舊 trip_dyn／關係表 fallback 沒有 liveness 欄位時，從本輪重新給完整沉默窗；不可把
      // lastArrEpoch 當觀測時間（它是看板預報的到站 epoch）。fast path 後續會原樣 round-trip。
      lastSeenEpoch: p.lastSeenEpoch != null && Number.isFinite(Number(p.lastSeenEpoch))
        ? Number(p.lastSeenEpoch) : nowEpoch,
      reachedEndEpoch: p.reachedEndEpoch != null && Number.isFinite(Number(p.reachedEndEpoch))
        ? Number(p.reachedEndEpoch) : null,
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

  // 5) Pass A,沿用中的綁定:目的地不符 ⇒ 標記驅逐(§5.2「dest 改變」);找不到 leg ⇒
  //    不更新 shift，但同線同向官方 feed 仍算活著，不得因此被收班或被 reclaim 取代
  //    (legMiss,防禦性:正常不應觸發);否則就地更新 shift/lastTo/lastArrEpoch——此時還不判安全閥,
  //    因為 ref 要等這一輪全部沿用值更新完才算得出來。
  const updatedFullKeys = new Set(); // 這輪真的重算過 shift 的 fullKey,才需要跑安全閥判斷
  const observedFullKeys = new Set(); // 同線同向本輪仍被官方 feed 看見；legMiss 也算 liveness
  for (const claim of stickyTracks) {
    const fullKey = trackToFullKey.get(claim.trackId);
    const rec = records.get(fullKey);
    const tr = tripByFullKey.get(fullKey);
    if (!rec || !tr) { freshTracks.push(claim); continue; } // 防禦:priorBindings 與 tripSets 對不上(誤餵跨日資料)
    if (claim.destIdx !== tr[tr.length - 2]) {
      evictedRebinds.set(claim.trackId, rec.rebinds);
      // BINDER_HANDOFF_BEGIN：verify_binder_done.mjs 以此既有交棒區塊做 mutation control。
      events.push({ type: 'evict', reason: 'destMismatch', day, line: rec.line, dir: rec.dir,
        tripKey: rec.tripKey, trackId: rec.trackId, epoch: nowEpoch });
      audit.evictedDest++;
      records.delete(fullKey);
      freshTracks.push(claim);
      // BINDER_HANDOFF_END
      continue;
    }
    if (claim.line === rec.line && claim.dir === rec.dir) {
      rec.lastSeenEpoch = nowEpoch;
      observedFullKeys.add(fullKey);
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
    rec.reachedEndEpoch = !claim.terminal && claim.to === tr[tr.length - 2] && claim.arrEpoch <= nowEpoch
      ? nowEpoch : null;
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
        events.push({ type: 'evict', reason: 'badStreak', day, line: rec.line, dir: rec.dir,
          tripKey: rec.tripKey, trackId: rec.trackId, epoch: nowEpoch });
        audit.evictedSafety++;
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
      if (rec.done || observedFullKeys.has(fullKey)) continue; // legMiss 也代表本輪仍被 feed 看見
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
    rec.lastArrEpoch = e.claim.arrEpoch; rec.lastSeenEpoch = nowEpoch; rec.badStreak = 0;
    rec.reachedEndEpoch = !e.claim.terminal && e.claim.to === e.tr[e.tr.length - 2] && e.claim.arrEpoch <= nowEpoch
      ? nowEpoch : null;
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
      lastSeenEpoch: nowEpoch,
      reachedEndEpoch: !e.claim.terminal && e.claim.to === e.tr[e.tr.length - 2] && e.claim.arrEpoch <= nowEpoch
        ? nowEpoch : null,
      done: false, rebinds: priorRebinds != null ? priorRebinds + 1 : 0,
    });
    events.push({ type: 'bind', day, line: e.claim.line, dir: e.claim.dir, tripKey: tripKeyOf(e.tr),
      trackId: e.claim.trackId, epoch: nowEpoch, birth: e.claim.terminal ? 'terminal' : 'seed' });
    audit.bound++;
    if (priorRebinds != null) audit.rebinds++;
  }
  audit.unbound += birthTracks.filter(c => !usedTracks.has(c.trackId)).length;

  // 11) 收班判定(§5.3):到達終點／修正後末站時刻+120s 只是候選；官方 feed 同線同向仍在
  //    回報時必須否決。候選在 feed 沉默滿 3 分鐘後才收班，既不提早收工也不無限延命。
  //    reachedEndEpoch 必須跨輪保存，不能再用回傳前會消失的暫存欄位。
  // BINDER_DONE_GUARD_BEGIN：verify_binder_done.mjs 以此區塊做 mutation control。
  for (const [fullKey, rec] of records) {
    if (rec.done) continue;
    const tr = tripByFullKey.get(tripBindKey(rec.line, rec.dir, rec.tripKey));
    if (!tr) continue;
    const reachedEnd = rec.reachedEndEpoch != null;
    const scheduleGraceOver = nowSec >= tr[tr.length - 1] + rec.lastShift + TRIP_BIND_DONE_GRACE_SEC;
    const feedSilent = nowEpoch - rec.lastSeenEpoch >= TRIP_BIND_FEED_SILENCE_SEC;
    if ((reachedEnd || scheduleGraceOver) && feedSilent) {
      rec.done = true;
      const reason = reachedEnd && scheduleGraceOver ? 'reachedEnd+scheduleGraceOver'
        : reachedEnd ? 'reachedEnd' : 'scheduleGraceOver';
      events.push({ type: 'done', reason, day, line: rec.line, dir: rec.dir, tripKey: rec.tripKey,
        trackId: rec.trackId, epoch: nowEpoch });
      audit.done++;
    }
  }
  // BINDER_DONE_GUARD_END

  const bindings = [...records.values()];
  return { bindings, events, audit: { ...audit, dayType } };
}

// 關係表是「目前狀態」的低頻 fallback，不是事件歷史。因此每輪依 events 觸及的 key
// 與最終 bindings 做 final-state 規劃：最終還在就 UPSERT，已被驅逐就 DELETE。同輪先驅逐後
// 重生同一 tripKey 時，最終 record 勝出，不會被前一個 evict event 誤刪。
export function planTrtcTripBindingPersistence(bindings, events, relationalBindings = null, reconcileAll = false) {
  const finalByKey = new Map();
  for (const rec of bindings || []) {
    if (!rec || !rec.line || !rec.tripKey || (Number(rec.dir) !== 1 && Number(rec.dir) !== 2)) continue;
    finalByKey.set(tripBindKey(rec.line, Number(rec.dir), rec.tripKey), rec);
  }
  const touched = new Map();
  for (const ev of events || []) {
    if (!ev || !ev.line || !ev.tripKey || (Number(ev.dir) !== 1 && Number(ev.dir) !== 2)) continue;
    const dir = Number(ev.dir);
    touched.set(tripBindKey(ev.line, dir, ev.tripKey), { line: ev.line, dir, tripKey: ev.tripKey });
  }
  // 部署當天可能已有舊版「只刪記憶體、沒刪關係表」留下的 zombie。每輪寫入前把低頻表
  // 與最終 trip_dyn 對帳：關係表還在、final binding 已不在的 key 也要刪。這不依賴新版
  // evict event，因此修復上線前已存在的 zombie；只比對同一 service day 的查詢結果。
  const relationalByKey = new Map();
  for (const rec of relationalBindings || []) {
    const line = rec && rec.line, dir = Number(rec && rec.dir);
    const tripKey = rec && (rec.tripKey ?? rec.trip_key);
    if (!line || !tripKey || (dir !== 1 && dir !== 2)) continue;
    const key = tripBindKey(line, dir, tripKey);
    relationalByKey.set(key, rec);
    if (!finalByKey.has(key)) touched.set(key, { line, dir, tripKey });
  }
  // 新版對帳 marker 尚未建立時，不只刪 DB-only zombie，也要把權威 final state
  // 全數寫回。完成後關係表才能成為 trip_dyn 遺失時可信的 fallback。
  if (reconcileAll) for (const [key, rec] of finalByKey) {
    const old = relationalByKey.get(key);
    const same = old && String(old.trackId ?? old.track_id) === String(rec.trackId) &&
      Number(old.boundEpoch ?? old.bound_epoch) === Number(rec.boundEpoch) &&
      String(old.birth) === String(rec.birth) && !!Number(old.done) === !!rec.done &&
      Number(old.rebinds || 0) === Number(rec.rebinds || 0);
    if (!same) touched.set(key, { line: rec.line, dir: Number(rec.dir), tripKey: rec.tripKey });
  }
  const upserts = [], deletes = [];
  for (const [key, identity] of touched) {
    const rec = finalByKey.get(key);
    if (rec) upserts.push(rec);
    else deletes.push(identity);
  }
  return { upserts, deletes };
}

// ═══ 訪客唯讀 join(工項5):15秒新鮮看板列 × ≤60秒舊 cron 綁定快照,worker 內完成,絕不寫 D1 ═══
// 設計書 §7:有官方車號的列 no→alias→binding,精確查表(識別靠車號,不設容忍窗);無號列沿用
// 現行候選掃描結構,但 cost 換成 |rowShift-binding.lastShift|、僅限已綁班次、窗 45s(BR 尖峰頭距
// 132s > 2×45s,相鄰班次不可混淆)。join 不到就丟棄該列(不產 trip 校正),存在性零影響。
export const TRIP_BIND_VISITOR_JOIN_WINDOW_SEC = 45;

function buildTripByFullKeyForJoin(tripSets) { // 與 bindTracksToTrips 內部同名區塊同構(本檔:749-753)
  const map = new Map();
  for (const [gk, trips] of tripSets || []) {
    const sep = gk.lastIndexOf('|'); const line = gk.slice(0, sep), dir = Number(gk.slice(sep + 1));
    for (const tr of trips) map.set(tripBindKey(line, dir, tripKeyOf(tr)), tr);
  }
  return map;
}

// row 形狀取自 collapseClaims 輸出子集:{line,dir,from,to,destIdx,run,arrEpoch,no,terminal}(即
// worker.js trtcBoardPositionAnchors 組 9 欄位 rows 用的同一批 collapsed claims)。
// bindings 形狀取自 trtc_state['trip_dyn'] 快照(bindTracksToTrips 回傳的 bindings 原樣)。
// aliasByHwNo 形狀 Map<官方車號字串, trackId字串>(trtc_track_aliases,alias_type='hw_no')。
export function joinBoardRowsToTrips({ tripSets, rows, bindings, aliasByHwNo = new Map(), windowSec = TRIP_BIND_VISITOR_JOIN_WINDOW_SEC }) {
  const tripByFullKey = buildTripByFullKeyForJoin(tripSets);
  const activeByFullKey = new Map(), activeByLineDir = new Map(), activeByTrackId = new Map();
  const staged = [], fullKeyCounts = new Map(), trackIdCounts = new Map();
  for (const b of bindings || []) {
    if (!b || b.done || !b.line || !b.tripKey || (Number(b.dir) !== 1 && Number(b.dir) !== 2)) continue;
    // trackId 是後端 binder 提供的實體車身份，不得拿班次 key 冒充。
    // 身分缺席或命名空間混用時 fail closed：這筆 binding 不參與訪客 join。
    const trackId = b.trackId == null ? '' : String(b.trackId).trim();
    if (!trackId || trackId === String(b.tripKey).trim()) continue;
    const fullKey = tripBindKey(b.line, Number(b.dir), b.tripKey);
    staged.push({ b, fullKey, trackId, gk: `${b.line}|${b.dir}` });
    fullKeyCounts.set(fullKey, (fullKeyCounts.get(fullKey) || 0) + 1);
    trackIdCounts.set(trackId, (trackIdCounts.get(trackId) || 0) + 1);
  }
  for (const { b, fullKey, trackId, gk } of staged) {
    // 同一班次出現兩個實體車、或同一實體車同時佔兩班，皆不可由陣列順序決定勝者。
    // 任一側不唯一就整組 fail closed；下一輪資料恢復唯一後會自然重新接回。
    if (fullKeyCounts.get(fullKey) !== 1 || trackIdCounts.get(trackId) !== 1) continue;
    activeByFullKey.set(fullKey, b);
    if (!activeByLineDir.has(gk)) activeByLineDir.set(gk, []);
    activeByLineDir.get(gk).push(fullKey);
    activeByTrackId.set(trackId, fullKey);
  }

  // 與 bindTracksToTrips Pass A(本檔 798-806)同構:算「這筆觀測若屬於 tr,發車時刻偏移多少秒」。
  function rowShiftAgainstTrip(row, tr) {
    const arrSec = trtcServiceSecOfEpoch(row.arrEpoch);
    const depSec = row.terminal ? arrSec : arrSec - row.run;
    let scheduledEvent;
    if (row.terminal) {
      if (tr[0] !== row.from) return null;
      scheduledEvent = tr[1];
    } else {
      const k = tripLegIndex(tr, row.from, row.to);
      if (k < 0) return null;
      scheduledEvent = tr[(k - 1) * 2 + 1];
    }
    return depSec - scheduledEvent;
  }

  const stagedTrips = [];
  for (const row of rows || []) {
    if (!row || !row.line || (Number(row.dir) !== 1 && Number(row.dir) !== 2) || !Number.isFinite(Number(row.arrEpoch))) continue;
    let matchedFullKey = null, matchedShift = null;
    if (row.no) {
      // 有官方車號:no→alias→binding,精確查表;line/dir 須與 binding 相符(防禦性:alias 誤帶跨線資料)。
      const trackId = aliasByHwNo.get(String(row.no));
      const fullKey = trackId != null ? activeByTrackId.get(String(trackId)) : null;
      const binding = fullKey ? activeByFullKey.get(fullKey) : null;
      if (binding && binding.line === row.line && Number(binding.dir) === Number(row.dir)) {
        const tr = tripByFullKey.get(fullKey);
        const shift = tr ? rowShiftAgainstTrip(row, tr) : null;
        if (shift != null) { matchedFullKey = fullKey; matchedShift = shift; }
      }
    } else {
      // 無號列:同 line+dir 底下,對每個已綁班次算 cost=|rowShift-lastShift|,取最小者且需 ≤windowSec。
      const gk = `${row.line}|${row.dir}`;
      let best = null, bestCount = 0;
      for (const fullKey of activeByLineDir.get(gk) || []) {
        const binding = activeByFullKey.get(fullKey);
        const tr = tripByFullKey.get(fullKey);
        if (!tr) continue;
        const shift = rowShiftAgainstTrip(row, tr);
        if (shift == null) continue;
        const cost = Math.abs(shift - binding.lastShift);
        if (cost > windowSec) continue;
        if (!best || cost < best.cost - 1e-9) { best = { fullKey, shift, cost }; bestCount = 1; }
        else if (Math.abs(cost - best.cost) <= 1e-9) bestCount++;
      }
      if (best && bestCount === 1) { matchedFullKey = best.fullKey; matchedShift = best.shift; }
    }
    if (!matchedFullKey) continue;
    const binding = activeByFullKey.get(matchedFullKey);
    const trackId = String(binding.trackId).trim(); // 已在 active binding 建表時做過非空/異於 trip key 篩選。
    stagedTrips.push({ line: binding.line, dir: binding.dir, key: binding.tripKey, trackId, shift: matchedShift,
      eta: { from: row.from, to: row.to, run: row.run, arrEpoch: row.arrEpoch } });
  }
  // 同一台車同時出現在多站看板是正常情況；每個合法的 trip/track 身分只留最近一筆到站約束。
  // 先用雙向關係區分「同一身分的多列預報」與真正一對多損壞，再以完整內容作固定次序決勝。
  const fullKeysByTrackId = new Map(), trackIdsByFullKey = new Map();
  const stagedWithFullKey = stagedTrips.map(trip => {
    const fullKey = tripBindKey(trip.line, Number(trip.dir), trip.key);
    if (!fullKeysByTrackId.has(trip.trackId)) fullKeysByTrackId.set(trip.trackId, new Set());
    fullKeysByTrackId.get(trip.trackId).add(fullKey);
    if (!trackIdsByFullKey.has(fullKey)) trackIdsByFullKey.set(fullKey, new Set());
    trackIdsByFullKey.get(fullKey).add(trip.trackId);
    return { trip, fullKey };
  });
  function compareJoinPick(a, b) {
    // 最早到站的列最接近列車當下位置，對動畫是最即時的官方約束；其餘欄位只負責完全同時時的
    // total-order tie-break。排序鍵全由列內容組成，所以 rows 洗牌不會改變勝者。
    const epochDiff = Number(a.eta.arrEpoch) - Number(b.eta.arrEpoch);
    if (epochDiff) return epochDiff;
    const stableKey = trip => JSON.stringify([trip.line, Number(trip.dir), trip.key, trip.trackId, trip.shift,
      trip.eta.from, trip.eta.to, trip.eta.run, trip.eta.arrEpoch]);
    const ak = stableKey(a), bk = stableKey(b);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  }

  // JOIN_DEDUPE_BEGIN：verify_join_parity.mjs 以此區塊做 mutation control。
  const winnerByIdentity = new Map();
  for (const { trip, fullKey } of stagedWithFullKey) {
    // track→多 trip 或 trip→多 track 才是身分資料損壞；同一 pair 的多個站點列可安全決勝。
    if (fullKeysByTrackId.get(trip.trackId).size !== 1 || trackIdsByFullKey.get(fullKey).size !== 1) continue;
    const identity = `${fullKey}\u0000${trip.trackId}`;
    const prior = winnerByIdentity.get(identity);
    if (!prior || compareJoinPick(trip, prior) < 0) winnerByIdentity.set(identity, trip);
  }
  const winners = [...winnerByIdentity.values()];
  winners.sort((a, b) => {
    const ak = `${tripBindKey(a.line, Number(a.dir), a.key)}\u0000${a.trackId}`;
    const bk = `${tripBindKey(b.line, Number(b.dir), b.key)}\u0000${b.trackId}`;
    return ak < bk ? -1 : ak > bk ? 1 : compareJoinPick(a, b);
  });
  return winners;
  // JOIN_DEDUPE_END
}

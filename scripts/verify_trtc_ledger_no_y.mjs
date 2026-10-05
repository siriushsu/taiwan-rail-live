#!/usr/bin/env node
// 北捷帳本（D1）不存環狀線（Y）守門人。
//
// 環狀線的即時資料只能即用即丟、不留歷史，所以帳本裡逐日累積的表一律不收 Y：
//   trtc_tracks、trtc_events（原本就排除）、trtc_track_aliases、trtc_trip_bindings。
// 例外是兩列每輪覆寫的工作狀態，每晚 03:30 收班後整列刪掉、不跨營運日：
//   trtc_state['official_roster_v4']：畫車的跨 isolate／跨機房身分來源，拿掉 Y 的話環狀線每一輪都會換一批
//     新 vehicleId。名冊裡只有還在跑（或暫時沒報到）的車與它們這一趟的資料，到終點就移出。
//   trtc_state['trip_dyn']：綁定器跨輪接續與訪客 join（車上的 tripKey，站牌「跟隨往 X 的班次」要用）都讀它；
//     只留最近 30 分鐘內還被看板看見的 Y 綁定。
//
// 檢查項：
//   U1 persistTrtcLedger：餵藍線＋環狀線的 track／event／車號別名，寫進 D1 的只有藍線。
//   U2 persistTrtcTripBindingRound：關係表只有藍線；trip_dyn 留藍線全部、環狀線只留 30 分鐘內看見的。
//   E1 cron 整條路徑（trtcLedgerScheduled，合成看板兩幀）：trip_dyn 以外的每一筆 D1 寫入都不帶 Y（名冊也算，
//      cron 不寫名冊），且藍線的 track 與綁定確實寫進去了（正向對照）；trip_dyn 帶著這一輪看見的 Y。
//   E2 cron 連跑兩輪（同一個 D1，中間車過了兩站、track 全換新 id）：Y 的 track 沒落 D1，下一輪仍認回同一班
//      （tripKey、boundEpoch 不變）。
//   V1 訪客路徑（trtcBoardPositionAnchors）連跑兩輪：名冊裡環狀線的車 vehicleId 不變；名冊以外的寫入不帶 Y。
//   V2 cron 兩輪之後的訪客路徑：環狀線的車都帶 tripKey（站牌跟隨要用）。
//   P1 每晚 03:30 的清理整列刪掉名冊與 trip_dyn；03:29、03:31 不刪。
//   突變：每一道防線各拿掉一次，必須只打紅它自己那幾項；未突變的副本走同一條載入路徑必須全綠（控制組）。
//
// 看板資料全部是合成的（站名取自 data/trtc.json、倒數自己編），不放任何錄下來的上游回應。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTrtcModel, buildLedgerFromRaw } from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const ROSTER_KEY = 'official_roster_v4';

// ── 時間：2026-10-05（週一）10:00 台北，營運窗內 ──
const tpeEpoch = s => {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600;
};
const tpeText = epoch => {
  const d = new Date((epoch + 8 * 3600) * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};
const NOW = tpeEpoch('2026-10-05 10:00:00');
const DAY = '2026-10-05';

// ── 合成看板：藍線一台往南港展覽館；環狀線往新北產業園區、往大坪林各一台 ──
function board(baseEpoch) {
  const at = tpeText(baseEpoch);
  const shift = baseEpoch - NOW;
  const cd = sec => {
    const s = sec - shift;
    return s === 0 ? '列車進站' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  // 每個方向只有一台車：車過站之後，那一站的列就不見了。
  const row = (StationName, DestinationName, sec, TrainNumber = '') => sec - shift < 0 ? null
    : ({ StationName, DestinationName, CountDown: cd(sec), NowDateTime: at, TrainNumber });
  return [
    row('西門', '南港展覽館', 70, '117'), row('台北車站', '南港展覽館', 190, '117'),
    row('善導寺', '南港展覽館', 300, '117'),
    row('中和', '新北產業園區', 70), row('橋和', '新北產業園區', 170), row('中原', '新北產業園區', 270),
    row('景平', '大坪林', 80), row('秀朗橋', '大坪林', 180), row('十四張', '大坪林', 280),
  ].filter(Boolean);
}

// ── 記錄每一筆寫入的假 D1 ──
class RecordingD1 {
  constructor() { this.kv = new Map(); this.writes = []; }
  prepare(sql) {
    const db = this;
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async first() { return db.read(sql, stmt.args, true); },
      async all() { return { results: db.read(sql, stmt.args, false) }; },
      async run() { return db.exec(sql, stmt.args); },
    };
    return stmt;
  }
  async batch(list) {
    const out = [];
    for (const stmt of list) out.push(await stmt.run());
    return out;
  }
  read(sql, args, single) {
    const lit = sql.match(/FROM trtc_state WHERE k='([^']+)'/);
    if (lit || /FROM trtc_state WHERE k=\?/.test(sql)) {
      const key = lit ? lit[1] : String(args[0]);
      const v = this.kv.get(key);
      return single ? (v == null ? null : { v }) : (v == null ? [] : [{ v }]);
    }
    return single ? null : [];
  }
  exec(sql, args) {
    const ok = changes => ({ meta: { changes } });
    if (/^\s*CREATE /i.test(sql)) return ok(0);
    let m = sql.match(/INSERT INTO trtc_state \(k,v\)\s*VALUES \('([^']+)',\?\)/);
    if (m) { this.kv.set(m[1], String(args[0])); this.writes.push({ table: 'trtc_state', key: m[1], value: String(args[0]) }); return ok(1); }
    if (/INSERT INTO trtc_state \(k,v\)\s*VALUES \(\?,\?\)/.test(sql)) {
      const [key, value] = args.map(String);
      if (/DO NOTHING/.test(sql) && this.kv.has(key)) return ok(0);
      this.kv.set(key, value); this.writes.push({ table: 'trtc_state', key, value }); return ok(1);
    }
    if (/UPDATE trtc_state SET v=\? WHERE k=\? AND v=\?/.test(sql)) {
      const [value, key, old] = args.map(String);
      if (this.kv.get(key) !== old) return ok(0);
      this.kv.set(key, value); this.writes.push({ table: 'trtc_state', key, value }); return ok(1);
    }
    m = sql.match(/DELETE FROM trtc_state WHERE k=(?:'([^']+)'|\?)/);
    if (m) {
      const key = m[1] || String(args[0]);
      const had = this.kv.delete(key);
      this.writes.push({ table: 'trtc_state', key, deleted: true });
      return ok(had ? 1 : 0);
    }
    m = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES/);
    if (m) {
      const cols = m[2].split(',').map(s => s.trim());
      const rows = [];
      for (let i = 0; i < args.length; i += cols.length) {
        rows.push(Object.fromEntries(cols.map((c, j) => [c, args[i + j]])));
      }
      this.writes.push({ table: m[1], rows });
      return ok(rows.length);
    }
    m = sql.match(/^\s*(UPDATE|DELETE FROM) (\w+)/);
    if (m) { this.writes.push({ table: m[2], op: m[1], args }); return ok(0); }
    throw new Error(`RecordingD1 不認得的寫入：${sql.slice(0, 80)}`);
  }
}

// 一筆寫入裡有沒有環狀線：關係表看 line 欄；trtc_state 看 JSON 裡任何 line:'Y' 或以 Y 為鍵的物件。
function hasY(value) {
  if (Array.isArray(value)) return value.some(hasY);
  if (value && typeof value === 'object') {
    if (value.line === 'Y' || Object.prototype.hasOwnProperty.call(value, 'Y')) return true;
    return Object.values(value).some(hasY);
  }
  return false;
}
function yWrites(writes, { skipKeys = [] } = {}) {
  const out = [];
  for (const w of writes) {
    if (w.rows) {
      const n = w.rows.filter(r => r.line === 'Y').length;
      if (n) out.push(`${w.table} ${n} 列 line=Y`);
    } else if (w.table === 'trtc_state' && w.value != null && !skipKeys.includes(w.key)) {
      let parsed = null;
      try { parsed = JSON.parse(w.value); } catch { /* 非 JSON 值（如 marker）不會有 Y */ }
      if (hasY(parsed)) out.push(`trtc_state['${w.key}'] 帶 Y`);
    }
  }
  return out;
}
const rowsOf = (writes, table) => writes.filter(w => w.table === table && w.rows).flatMap(w => w.rows);
const lineSet = rows => [...new Set(rows.map(r => r.line))].sort().join(',');

// ── 假 env：資產從 repo 讀，上游由假的集中輪詢者回合成看板 ──
function makeEnv(db, frames, now = NOW) {
  let call = 0;
  return {
    TRTC_LEDGER: db,
    TRTC_NOW_EPOCH: String(now),
    TRTC_BOARD_SAMPLE_DELAY_MS: '0',
    ASSETS: {
      async fetch(req) {
        const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
        const file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
        return new Response(fs.readFileSync(file));
      },
    },
    TRTC_POLLER: {
      idFromName: name => name,
      get: () => ({
        async fetch() {
          const rows = frames[Math.min(call++, frames.length - 1)];
          return new Response(JSON.stringify({ tk: { ok: true, rows }, hw: [], hwThisRound: [], br: [], colo: 'TPE', ageMs: 0 }));
        },
      }),
    },
  };
}

// worker 自己的 [cron …] 日誌只在檢查拋例外時才印出來，平常不洗版。
async function quietly(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const captured = [];
  for (const k of Object.keys(saved)) console[k] = (...a) => captured.push(a.map(String).join(' '));
  try { return await fn(); }
  catch (e) { for (const line of captured) saved.error(line); throw e; }
  finally { Object.assign(console, saved); }
}

// ── 檢查本體：對一份 worker 模組跑全部檢查，回傳 {名稱: 通過與否, 細節} ──
async function runChecks(api) {
  const results = new Map();
  const put = (name, pass, detail) => results.set(name, { pass: !!pass, detail });

  // U1
  {
    const db = new RecordingD1();
    const track = (line, trackId) => ({ day: DAY, trackId, line, dir: 2, stationIdx: 3, progress: 3.5,
      officialNo: null, crowd: null, evidence: 'board', evidenceEpoch: NOW, lastSeenEpoch: NOW,
      payload: { trackId, line } });
    const event = (line, trackId) => ({ day: DAY, line, dir: 2, trackId, stationIdx: 4, kind: 'arr',
      epoch: NOW + 60, src: 'board', crowd: null, state: 'forecast', observedEpoch: NOW, updatedEpoch: NOW });
    const alias = (alias, trackId) => ({ day: DAY, aliasType: 'hw_no', alias, trackId, epoch: NOW });
    const part = { trackUpdates: [track('BL', 't-bl'), track('Y', 't-y')], events: [event('BL', 't-bl'), event('Y', 't-y')],
      aliasUpdates: [alias('117', 't-bl'), alias('901', 't-y')] };
    await api.persistTrtcLedger({ TRTC_LEDGER: db }, [part], NOW);
    const tracks = rowsOf(db.writes, 'trtc_tracks'), events = rowsOf(db.writes, 'trtc_events');
    put('U1 tracks 不寫 Y', tracks.some(r => r.line === 'BL') && !tracks.some(r => r.line === 'Y'),
      `trtc_tracks 寫入線別=${lineSet(tracks) || '（無）'}`);
    put('U1 events 不寫 Y', events.some(r => r.line === 'BL') && !events.some(r => r.line === 'Y'),
      `trtc_events 寫入線別=${lineSet(events) || '（無）'}`);
    const aliases = rowsOf(db.writes, 'trtc_track_aliases').map(r => r.track_id);
    put('U1 車號別名不寫 Y 的 track', aliases.includes('t-bl') && !aliases.includes('t-y'),
      `trtc_track_aliases 寫入 track=${aliases.join(',') || '（無）'}`);
  }

  // U2
  {
    const db = new RecordingD1();
    const binding = (line, tripKey, { done = false, seenAgo = 0 } = {}) => ({ line, dir: 2, tripKey,
      trackId: `t-${tripKey}`, boundEpoch: NOW - 3600, birth: 'terminal', done, rebinds: 0, lastShift: 12, lastTo: 4,
      lastArrEpoch: NOW + 60, lastSeenEpoch: NOW - seenAgo, reachedEndEpoch: null, badStreak: 0 });
    const ev = (line, tripKey) => ({ type: 'bind', line, dir: 2, tripKey, trackId: `t-${tripKey}` });
    const STALE = 31 * 60;
    const round = {
      bindings: [binding('BL', 'bl-run'), binding('BL', 'bl-done', { done: true, seenAgo: 2 * 3600 }),
        binding('Y', 'y-run'), binding('Y', 'y-done-recent', { done: true, seenAgo: 10 * 60 }),
        binding('Y', 'y-done-old', { done: true, seenAgo: STALE }), binding('Y', 'y-lost', { seenAgo: STALE }),
        // 邊界：剛好 30 分鐘還留，多 1 秒就丟。
        binding('Y', 'y-edge-keep', { seenAgo: 30 * 60 }), binding('Y', 'y-edge-drop', { seenAgo: 30 * 60 + 1 })],
      events: [ev('BL', 'bl-run'), ev('Y', 'y-run')] };
    await api.persistTrtcTripBindingRound({ TRTC_LEDGER: db }, DAY, NOW, 'weekday', { bindings: [], events: [] }, round);
    const relLines = rowsOf(db.writes, 'trtc_trip_bindings').map(r => r.line);
    const dyn = JSON.parse(db.kv.get('trip_dyn') || 'null');
    const dynKeys = dyn ? dyn.bindings.map(b => b.tripKey).sort().join(',') : '（未寫）';
    put('U2 關係表不寫 Y', relLines.includes('BL') && !relLines.includes('Y'),
      `trtc_trip_bindings 寫入線別=${[...new Set(relLines)].sort().join(',') || '（無）'}`);
    // 藍線不論新舊都留（不受這條規則管）；環狀線只留 30 分鐘內看見的，收班已久與斷訊已久的都丟。
    put('U2 trip_dyn 只留 30 分鐘內看見的 Y', dynKeys === 'bl-done,bl-run,y-done-recent,y-edge-keep,y-run',
      `trip_dyn 綁定=${dynKeys}`);
    // 關係表的 DELETE 參數是 [day,line,dir,trip_key]。Y 的 track 不落 D1，換站後要靠認回接上同一班，
    // 認回也會發事件；若事件不濾，就會為環狀線車多發無效的寫入句。
    const yStatements = db.writes.filter(w => w.table === 'trtc_trip_bindings' &&
      ((w.rows || []).some(r => r.line === 'Y') || (w.args || []).includes('Y'))).length;
    put('U2 綁定事件不為 Y 產生寫入句', yStatements === 0, `Y 寫入句 ${yStatements} 句`);
  }

  // E1：cron 整條路徑
  {
    const db = new RecordingD1();
    const out = await api.trtcLedgerScheduled({ scheduledTime: NOW * 1000 }, makeEnv(db, [board(NOW), board(NOW + 30)]));
    const violations = yWrites(db.writes, { skipKeys: ['trip_dyn'] });
    const tracks = rowsOf(db.writes, 'trtc_tracks');
    // 正向對照：藍線的 track 與綁定都真的寫進去了（記錄器看得到寫入、綁定器有跑完），「沒有 Y」才有意義。
    const dyn = JSON.parse(db.kv.get('trip_dyn') || 'null');
    const dynOf = line => (dyn ? dyn.bindings : []).filter(b => b.line === line);
    put('E1 cron 除 trip_dyn 外的寫入都不帶 Y', out && out.skipped === false && out.bind &&
      tracks.some(r => r.line === 'BL') && dynOf('BL').length > 0 && violations.length === 0,
      `違規=${violations.join('；') || '無'}；tracks 線別=${lineSet(tracks) || '（無）'}；trip_dyn 藍線綁定 ${dynOf('BL').length} 筆`);
    put('E1 trip_dyn 帶著這一輪看見的 Y', dynOf('Y').length > 0 && dynOf('Y').every(b => b.lastSeenEpoch >= NOW),
      `trip_dyn 環狀線綁定 ${dynOf('Y').length} 筆`);
  }

  // E2／V2：cron 連跑兩輪（同一個 D1），第二輪時環狀線的車都已經過了兩站，再走一次訪客路徑
  {
    const db = new RecordingD1();
    const yBindings = () => (JSON.parse(db.kv.get('trip_dyn') || 'null')?.bindings || []).filter(b => b.line === 'Y');
    const ident = list => list.map(b => `${b.tripKey}@${b.boundEpoch}`).sort().join(',');
    await api.trtcLedgerScheduled({ scheduledTime: NOW * 1000 }, makeEnv(db, [board(NOW), board(NOW + 30)]));
    const first = yBindings();
    await api.trtcLedgerScheduled({ scheduledTime: (NOW + 180) * 1000 },
      makeEnv(db, [board(NOW + 180), board(NOW + 210)], NOW + 180));
    const second = yBindings();
    // track id 是由下一站與到站分鐘算出來的；過了站就換新 id，這時還接得上同一班，靠的是認回。
    const trackRenewed = second.length > 0 && second.every(b => !first.some(f => f.trackId === b.trackId));
    put('E2 Y 換 track 後仍認回同一班', first.length > 0 && ident(first) === ident(second) && trackRenewed,
      `第一輪 ${ident(first) || '（無）'}；第二輪 ${ident(second) || '（無）'}；track 全換新=${trackRenewed}`);
    const visit = await api.trtcBoardPositionAnchors(makeEnv(db, [], NOW + 215), board(NOW + 215), 'official',
      (NOW + 215) * 1000);
    const yVehicles = (visit.vehicles || []).filter(v => v.line === 'Y');
    const withTrip = yVehicles.filter(v => v.tripKey != null).length;
    put('V2 訪客端環狀線車帶 tripKey', yVehicles.length > 0 && withTrip === yVehicles.length,
      `環狀線 ${yVehicles.length} 台、帶 tripKey ${withTrip} 台`);
  }

  // V1：訪客路徑兩輪，名冊留 Y 且身分不變
  {
    const db = new RecordingD1();
    const env = makeEnv(db, []);
    const r1 = await api.trtcBoardPositionAnchors(env, board(NOW), 'official', NOW * 1000);
    const r2 = await api.trtcBoardPositionAnchors(env, board(NOW + 15), 'official', (NOW + 15) * 1000);
    const ids = r => (r.vehicles || []).filter(v => v.line === 'Y').map(v => String(v.vehicleId)).sort().join(',');
    const id1 = ids(r1), id2 = ids(r2);
    const stored = JSON.parse(db.kv.get(ROSTER_KEY) || 'null');
    const storedY = stored ? stored.vehicles.filter(v => v.line === 'Y').length : 0;
    const violations = yWrites(db.writes, { skipKeys: [ROSTER_KEY] });
    put('V1 名冊留 Y、兩輪身分不變', id1 && id1 === id2 && storedY > 0,
      `第一輪 Y=${id1 || '（無）'}；第二輪 Y=${id2 || '（無）'}；D1 名冊裡 Y ${storedY} 台`);
    put('V1 名冊以外不寫 Y', violations.length === 0, `違規=${violations.join('；') || '無'}`);
  }

  // P1：03:30 清理整列刪掉名冊與 trip_dyn
  {
    const at = clock => tpeEpoch(`2026-10-06 ${clock}`);
    const prune = async epoch => {
      const db = new RecordingD1();
      db.kv.set(ROSTER_KEY, JSON.stringify({ schema: 4, day: DAY, vehicles: [{ vehicleId: 'ov:x', line: 'Y' }] }));
      db.kv.set('trip_dyn', JSON.stringify({ at: NOW, day: DAY, bindings: [{ line: 'Y', dir: 2, tripKey: 'y-x' }] }));
      await api.trtcLedgerScheduled({ scheduledTime: epoch * 1000 }, { TRTC_LEDGER: db });
      return { roster: !db.kv.has(ROSTER_KEY), dyn: !db.kv.has('trip_dyn') };
    };
    const runs = [await prune(at('03:29:00')), await prune(at('03:30:00')), await prune(at('03:31:00'))];
    for (const [key, name] of [['roster', 'P1 03:30 刪名冊'], ['dyn', 'P1 03:30 刪 trip_dyn']]) {
      const [before, atPrune, after] = runs.map(r => r[key]);
      put(name, atPrune && !before && !after, `03:29 刪=${before}；03:30 刪=${atPrune}；03:31 刪=${after}`);
    }
  }
  return results;
}

// 正向對照：同一份合成看板在記憶體裡確實長得出環狀線的 track（否則 E1 的「沒有 Y」是空集合）。
async function inMemoryYTracks() {
  const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const model = buildTrtcModel(read('data/trtc.json'), read('data/trtc_times.json'), read('data/trtc_codes.json'),
    { includeY: true });
  const built = buildLedgerFromRaw({ model, boardRows: board(NOW), hwRows: [], brRows: [], epochOf: tpeEpoch,
    priorTracks: [], aliases: [], historicalEvents: [], nowEpoch: NOW, day: DAY });
  return built.trackUpdates.filter(t => t.line === 'Y').length;
}

// 載入一份 worker：把相對 import 改成指向 repo 的絕對路徑，寫到暫存目錄再 import。
// 控制組與突變走同一條路，載入方式本身不會造成紅綠差異。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trtc-no-y-'));
let copySeq = 0;
async function loadWorkerVariant(source) {
  const scriptsUrl = pathToFileURL(path.join(ROOT, 'scripts')).href + '/';
  const rewritten = source.replace(/from '\.\/scripts\//g, `from '${scriptsUrl}`);
  const file = path.join(TMP, `worker-${++copySeq}.mjs`);
  fs.writeFileSync(file, rewritten);
  const mod = await import(pathToFileURL(file).href);
  return mod._trtcLedger;
}

// 每道防線一個突變；expect＝它必須打紅、而且只打紅的那幾項。
const E1W = 'E1 cron 除 trip_dyn 外的寫入都不帶 Y';
const DYN_TTL = 'trtcLedgerStorable(b) ||\n    nowEpoch - Number(b.lastSeenEpoch) <= TRTC_TRIP_DYN_UNSTORED_TTL_SEC';
const MUTATIONS = [
  { name: 'tracks 不濾 Y', find: 'ledgerTrackRows(x.trackUpdates.filter(trtcLedgerStorable))',
    replace: 'ledgerTrackRows(x.trackUpdates)', expect: ['U1 tracks 不寫 Y', E1W] },
  { name: 'events 不濾 Y', find: 'ledgerEventRows(x.events.filter(trtcLedgerStorable))',
    replace: 'ledgerEventRows(x.events)', expect: ['U1 events 不寫 Y', E1W] },
  { name: '車號別名不濾 Y', find: '.filter(x => !unstoredTracks.has(`${x.day}|${x.trackId}`))',
    replace: '', expect: ['U1 車號別名不寫 Y 的 track'] },
  // 關係表平常只在綁定事件觸及時寫（事件已濾），每日對帳那一輪才會把最終綁定整批寫回——這道守的是對帳那條路。
  { name: '關係表不濾 Y', find: 'const bindings = finalBindings.filter(trtcLedgerStorable);',
    replace: 'const bindings = finalBindings;', expect: ['U2 關係表不寫 Y', 'U2 綁定事件不為 Y 產生寫入句'] },
  { name: '綁定事件不濾 Y', find: '...((round2 && round2.events) || [])]\n    .filter(trtcLedgerStorable)',
    replace: '...((round2 && round2.events) || [])]', expect: ['U2 綁定事件不為 Y 產生寫入句'] },
  { name: 'trip_dyn 的 Y 不設時限', find: DYN_TTL, replace: 'true', expect: ['U2 trip_dyn 只留 30 分鐘內看見的 Y'] },
  // 反方向：把 Y 整個拿出 trip_dyn——環狀線就認不回同一班、訪客端也拿不到 tripKey。
  { name: 'trip_dyn 不收 Y', find: `finalBindings.filter(b => ${DYN_TTL});`, replace: 'bindings;',
    expect: ['U2 trip_dyn 只留 30 分鐘內看見的 Y', 'E1 trip_dyn 帶著這一輪看見的 Y', 'E2 Y 換 track 後仍認回同一班',
      'V2 訪客端環狀線車帶 tripKey'] },
  { name: '03:30 不刪名冊', find: "    db.prepare('DELETE FROM trtc_state WHERE k=?').bind(TRTC_OFFICIAL_ROSTER_KEY),\n",
    replace: '', expect: ['P1 03:30 刪名冊'] },
  { name: '03:30 不刪 trip_dyn', find: `    db.prepare("DELETE FROM trtc_state WHERE k='trip_dyn'"),\n`,
    replace: '', expect: ['P1 03:30 刪 trip_dyn'] },
];

let failures = 0;
const say = (pass, label, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

const source = fs.readFileSync(WORKER_PATH, 'utf8');
const yTracks = await inMemoryYTracks();
say(yTracks > 0, '正向對照：合成看板在記憶體裡長得出環狀線的 track', `Y track ${yTracks} 條`);

console.log('\n── 產品碼（worker.js）──');
const { _trtcLedger: realApi } = await import(pathToFileURL(WORKER_PATH).href);
const real = await quietly(() => runChecks(realApi));
for (const [name, r] of real) say(r.pass, name, r.detail);

console.log('\n── 控制組（未突變的副本，走與突變相同的載入路徑）──');
const control = await quietly(async () => runChecks(await loadWorkerVariant(source)));
const controlRed = [...control].filter(([, r]) => !r.pass).map(([n]) => n);
say(controlRed.length === 0, '控制組全綠', controlRed.length ? `紅燈=${controlRed.join('、')}` : '');

console.log('\n── 突變（每道防線拿掉一次）──');
for (const m of MUTATIONS) {
  const hits = source.split(m.find).length - 1;
  if (hits !== 1) { say(false, `突變 ${m.name} 找得到唯一錨點`, `命中 ${hits} 次`); continue; }
  const results = await quietly(async () => runChecks(await loadWorkerVariant(source.replace(m.find, m.replace))));
  const red = [...results].filter(([, r]) => !r.pass).map(([n]) => n).sort();
  const want = [...m.expect].sort();
  say(red.join('|') === want.join('|'), `突變 ${m.name} 只打紅 ${want.join('、')}`, `實際紅燈=${red.join('、') || '無'}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} 項未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);

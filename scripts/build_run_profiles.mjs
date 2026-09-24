// 離線預算台鐵跑段速度剖面（buildObsProfile／彎道速限／梯形），寫進班表檔。
//
// 為什麼要離線算：這些剖面是【每日靜態輸入的純函數】——表定時刻＋貼軌里程＋車種參數
// ＋實測通過折點＋彎道速限。即時誤點是事後另一層（easedShift）疊上去的，跟剖面無關。
// 所以它沒有理由每次開機在每台裝置上重算一遍；更要緊的是：算在前端就代表【改演算法要重出
// App build】才修得到已安裝的使用者，而算在這裡只要重跑資料＋部署。
//
// 模型本身不在這裡：本腳本把 index.html 的頂層宣告原封不動切進 vm 沙箱執行（見
// lib/extract_from_index.mjs），所以離線算的與瀏覽器跑的【是同一段原始碼】，不可能漂移。
//
// 範圍：只做 tra_sched。高鐵班表走 API（SYS_DEFS 的 url 是 apiUrl('api/thsr-schedule')）
// 不是 bundle 檔，環島號是前端 buildLoopTrains 合成的、且在貼軌後才 retime ⇒ 兩者都不在
// 這份檔案裡，前端對它們維持現算。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, loadIndexSource } from './lib/extract_from_index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 頂層宣告依 index.html 的原始順序無關（函式提升），但 const 必須排在用到它的執行之前。
const CONSTS = ['PERF_DEFAULT', 'PERF_HSR', 'HSR_DEP_MID_SEC', 'PERF_RULES', 'PERF_BY_TYPE', 'PERF_DR1000',
  'DIESEL_BRANCH_IDS',
  'SPEED_ZONES', 'ZONE_KNOT_GAP', '_rpPre', 'MEET_HEADWAY_SEC', 'MEET_NEAR_SEC',
  'OVERTAKE_LOOKAHEAD_KM', 'OVERTAKE_CLEAR_SEC', 'OVERTAKE_MAX_WAIT_SEC'];
const FUNCS = ['haversineKm', 'ensureCum', 'posAlongShape', 'isHSR', 'specialOf', 'namedTrainNosOn', 'isDr1000', 'resolvePerf',
  'speedZoneClassOf', 'runSpeedZones', 'zoneProfileOk', 'zoneNatural', 'speedZoneKnots',
  'buildProfile', 'buildObsProfile', 'profTimeToProg', 'profProgToTime',
  'schedSegmentKm', 'schedSegKmOf', 'assignRunProfiles', 'canonicalizeAliasTrains',
  'projectOntoShape', 'assignSchedShapePathsFor', 'traSectionKey',
  'inferMeetPassTimes', 'inferMeetRun', 'reanchorRunProfile', 'applyRunProfile'];
FUNCS.push('clearPlannedOvertakes', 'reassignTrainProfile', 'overtakeRunBuildable',
  'planSameDirectionOvertakes', 'resolveTraTraffic');

// 🔴 前端存進 state.passObs 的是檔案的 .trains 子物件，不是根物件（index.html:26667）。
// 傳整份進去不會報錯，只會讓每一次查表都落空、全部跑段靜默退回梯形——實測 236 台車的
// 剖面因此與瀏覽器不同，而畫面照樣有車。凡「餵給模型的東西」都要照前端的取法取，不要照檔案的形狀猜。
export function readPassObs(path) {
  return JSON.parse(readFileSync(path, 'utf8'))?.trains || null;
}
// 同理:前端存的是 .pairs（index.html 的 state.trackSections），照前端的取法取。
export function readTrackSections(path) {
  return JSON.parse(readFileSync(path, 'utf8'))?.pairs || null;
}

// 支線表：resolvePerf 靠它認出 DR1000 柴油客車（班表只標「區間車」）。照前端開機的取法——
// 整份掛 state.special、每條支線補 _set。少了它不會報錯，支線車只會靜默拿到電聯車參數。
export function readSpecial(path) {
  return prepSpecial(JSON.parse(readFileSync(path, 'utf8')));
}
function prepSpecial(sd) {
  sd.branchLines.forEach(b => { b._set = new Set(b.matchStations); });
  return sd;
}

export function makeSandbox(indexPath, special) {
  const lines = loadIndexSource(indexPath);
  const src = extract(lines, [...CONSTS, ...FUNCS]);
  const ctx = createContext({
    console,
    state: { _segStats: { onShape: 0, straight: 0, bridged: 0 }, passObs: null,
      special: special || readSpecial(join(ROOT, 'data/tra_special_trains.json')) },
  });
  runInContext(src, ctx, { filename: 'index.html(extracted)' });
  return ctx;
}

// 前端 applySchedSystems 對台鐵做的事，只留會影響剖面的那些：標 tr.sys、掛 passObs。
// （站等分級、共構站群、車種可見度…都不進剖面，刻意不做。）
// trackSections 不傳就讀 repo 內那份（每個呼叫端都該吃同一張表，交會推論才與前端一致）；
// 傳 null 代表「刻意不用」（前端缺檔時的行為）。
export function computeProfiles({ indexPath, schedule, track, passObs, mutate, trackSections, special }) {
  const ctx = makeSandbox(indexPath, special);
  ctx.state.passObs = passObs;
  ctx.state.trackSections = trackSections === undefined ? readTrackSections(join(ROOT, 'data/tra_track_sections.json')) : trackSections;
  ctx.trains = schedule.trains;
  ctx.lines = track.lines;
  for (const tr of schedule.trains) tr.sys = 'tra_sched';
  if (mutate) runInContext(mutate, ctx);   // 只給突變測試用：故意弄壞輸入，確認閘門真的會紅
  // 🔴 併官方別名站（臺北-環島→臺北）。前端 applySchedSystems 在貼軌【之前】就併了
  //    （index.html 的 canonicalizeAliasStops 那一行在 assignSchedShapePathsFor 之上），
  //    漏在這裡就是離線與前端餵給同一段模型的輸入不同 —— 環島之星 1／2 次的末站正是
  //    臺北-環島，實測跑段長度差 0.36 公尺，check-run-profiles 的逐字比對會紅、
  //    那兩台車在使用者手上靜默退回現算。順序也要照前端：併完才貼軌。
  runInContext('canonicalizeAliasTrains(trains)', ctx);
  runInContext('clearPlannedOvertakes(trains); assignSchedShapePathsFor(trains, lines)', ctx);
  // 交會／待避推論：與前端 applySchedSystems 同一個呼叫（聯集班表＋dates＋單雙線表），跑在貼軌之後。
  ctx.union = { trains: schedule.trains, dates: schedule.dates };
  // 預排同向待避取決於某一天實際同場的車群，不烤進跨日共用檔；前端選完站後會讓該班整車現算。
  const meetStats = runInContext('inferMeetPassTimes(trains, union, state.trackSections)', ctx);
  return { segStats: ctx.state._segStats, meetStats };
}

// 只收【實測型】剖面（obs:true）。梯形是 34 行閉式解，輸入前端全都有、算起來也快，
// 送它純粹是浪費頻寬：20982 條剖面裡 18308 條是梯形，全送要 gzip 1.31MB（班表本身才 0.52MB），
// 只送實測型是 183KB。而彎道速限調整過的剖面【一律】是實測型（speedZoneKnots 走 buildObsProfile），
// 所以「調校要能不出 build 就修正」這個目的完全被涵蓋。
// 🔴 車次號不是唯一鍵：14 天聯集裡有 4 個車次號各對到兩筆停站型態（實測 445／270／281／4041，
// 差異在通過站的推估時刻）。用車次號當鍵會靜默覆蓋，前端就可能拿到另一個版本的剖面。
// 前端那道 T/L 閘門擋得掉大部分，但「T 與 L 恰好相同、折點卻不同」擋不掉——而那正是會把車
// 畫錯位置的那種。所以這裡自檢：同號各版本算出來的剖面必須【完全一致】才收，
// 不一致就整個不收、讓前端現算。丟了幾個一律印出來，不做無聲截斷。
export function collectProfiles(schedule) {
  const byNo = new Map();
  let obsRuns = 0, plainRuns = 0, knots = 0;
  for (const tr of schedule.trains) {
    const seen = new Set(), per = {};
    // 預排待避取決於當日實際同場的車群，不能把多日聯集算出的結果烤成所有日期共用的剖面。
    // 前端看到 _plannedDwell 的列車會整班現算；這裡同樣不收，避免快取反過來左右選站。
    const transient = tr.stops.some(st => st._plannedDwell);
    tr.stops.forEach((st, i) => {
      if (!st.rp || seen.has(st.rp)) return;
      seen.add(st.rp);
      if (!st.rp.obs) { plainRuns++; return; }
      obsRuns++; knots += st.rp.xs.length;
      if (transient) return;
      // 這顆 rp 第一次出現的 stop index 就是跑段起點 k0（assignRunProfiles 從 k0 開始逐站掛同一顆）
      // h 與 obs 不送：h 恆等於 diff(xs)（index.html:7771，整數相減 ⇒ 重建逐 bit 精確）、
      // obs 對收錄的每一條都是 true。兩者合計省下約三分之一的體積。
      per[i] = { T: st.rp.T, L: st.rp.L, xs: st.rp.xs, ys: st.rp.ys, m: st.rp.m };
    });
    const k = String(tr.train);
    if (!byNo.has(k)) byNo.set(k, []);
    byNo.get(k).push(per);
  }
  const out = {};
  const dropped = [];
  for (const [k, variants] of byNo) {
    const a = JSON.stringify(variants[0]);
    if (variants.every(v => JSON.stringify(v) === a)) { if (variants[0] && Object.keys(variants[0]).length) out[k] = variants[0]; }
    else dropped.push(k);
  }
  return { table: out, obsRuns, plainRuns, knots, dropped };
}

// ── 交會推論棘輪（MR1）───────────────────────────────────────────────────
// buildObsProfile 的節點閘門有一條「超標區間內側是受保護節點（彎道／交會錨點）⇒ 改丟外側」。
// 拿掉它，車速照樣守得住、剖面表照樣可以重產到與模型一致，唯一的症狀是交會推論靜默退步
// （2026-09-19 實測：夾回 192→108、重建不合格 16→92）——速度閘門與上面的逐 byte 比對都看不到。
// 夾回數與重建不合格數本身會跟著每週重抓的班表漂移，所以不跟「今天的資料」比：基線記的是
// 量測當下那幾個資料檔的 git blob，每次都拿【目前的程式碼】重跑那份凍結資料再比。
// 資料更新不會讓它紅，只有程式碼退步會。門檻由 --update-meet-ratchet 實測寫入，不手打。
const RATCHET_PATH = join(ROOT, 'scripts/meet_ratchet.json');
const RATCHET_INPUTS = {
  schedule: 'data/tra_schedule_dense.json', track: 'data/tra.json', passObs: 'data/tra_pass_obs.json',
  trackSections: 'data/tra_track_sections.json', special: 'data/tra_special_trains.json',
};
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });

function meetStatsOnBlobs(indexPath, blobs) {
  const j = k => JSON.parse(git('cat-file', 'blob', blobs[k]));
  return computeProfiles({ indexPath, schedule: j('schedule'), track: j('track'),
    passObs: j('passObs')?.trains || null, trackSections: j('trackSections')?.pairs || null,
    special: prepSpecial(j('special')) }).meetStats;
}

function updateMeetRatchet(indexPath) {
  const head = git('rev-parse', 'HEAD').trim();
  const inputs = {};
  for (const [k, rel] of Object.entries(RATCHET_INPUTS)) {
    const blob = git('rev-parse', `HEAD:${rel}`).trim();
    // 基線必須指向已 commit 的內容：磁碟上改過沒 commit 的資料，blob 日後不保證還在。
    if (git('hash-object', join(ROOT, rel)).trim() !== blob) throw new Error(`${rel} 與 HEAD 不同——先 commit 資料再量基線`);
    inputs[k] = { path: rel, blob };
  }
  const st = meetStatsOnBlobs(indexPath, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.blob])));
  writeFileSync(RATCHET_PATH, JSON.stringify({
    note: '由 node scripts/build_run_profiles.mjs --update-meet-ratchet 實測寫入，不要手改。'
      + '--check 用目前的程式碼重跑 inputs 這幾個凍結的資料 blob：夾回數不得少於 snapped、重建不合格不得多於 unbuildable。',
    measured_at: head, inputs, snapped: st.snapped, unbuildable: st.unbuildable,
  }, null, 1) + '\n');
  console.log(`MR1 基線已寫入 ${RATCHET_PATH}：夾回 ${st.snapped}｜重建不合格 ${st.unbuildable}（凍結資料＝${head.slice(0, 8)}）`);
}

// 回傳 true＝通過。任何讀不到基線或凍結資料的情況都算不通過，不准靜默略過。
function checkMeetRatchet(indexPath) {
  let base;
  try { base = JSON.parse(readFileSync(RATCHET_PATH, 'utf8')); }
  catch (e) { console.error(`✗ MR1 交會推論棘輪：讀不到基線 ${RATCHET_PATH}（${e.message}）`); return false; }
  let st;
  try { st = meetStatsOnBlobs(indexPath, Object.fromEntries(Object.entries(base.inputs).map(([k, v]) => [k, v.blob]))); }
  catch (e) { console.error(`✗ MR1 交會推論棘輪：凍結資料重跑失敗（${e.message.split('\n')[0]}）`); return false; }
  const tag = `凍結資料＝${base.measured_at.slice(0, 8)}`;
  if (st.snapped < base.snapped || st.unbuildable > base.unbuildable) {
    console.error(`✗ MR1 交會推論棘輪：夾回 ${st.snapped}（基線 ≥${base.snapped}）｜重建不合格 ${st.unbuildable}（基線 ≤${base.unbuildable}）｜${tag}`
      + '——同一份資料、只換程式碼，交會推論退步了。先查 buildObsProfile 的節點閘門（受保護內側節點改丟外側）'
      + '與 reanchorRunProfile；確定是刻意的取捨才跑 --update-meet-ratchet 重量基線');
    return false;
  }
  const better = st.snapped > base.snapped || st.unbuildable < base.unbuildable;
  console.log(`✓ MR1 交會推論棘輪：夾回 ${st.snapped}（基線 ≥${base.snapped}）｜重建不合格 ${st.unbuildable}（基線 ≤${base.unbuildable}）｜${tag}`
    + (better ? '｜比基線好，可跑 --update-meet-ratchet 收緊' : ''));
  return true;
}

function main() {
  const indexPath = join(ROOT, 'index.html');
  if (process.argv.includes('--update-meet-ratchet')) return updateMeetRatchet(indexPath);
  const schedPath = join(ROOT, 'data/tra_schedule_dense.json');
  const raw = readFileSync(schedPath, 'utf8');
  // 解析兩份：一份拿去算（會被掛上 segLn 等含循環參照的欄位、通過站時刻也會被改寫），
  // 一份保持原樣當輸出底稿。絕不可以把算過的那份寫回檔案。
  const work = JSON.parse(raw), out = JSON.parse(raw);
  const track = JSON.parse(readFileSync(join(ROOT, 'data/tra.json'), 'utf8'));
  const passObs = readPassObs(join(ROOT, 'data/tra_pass_obs.json'));

  const t0 = Date.now();
  const { segStats, meetStats } = computeProfiles({ indexPath, schedule: work, track, passObs });
  const { table, obsRuns, plainRuns, knots, dropped } = collectProfiles(work);

  // 自我斷言：這支腳本只准【讀】班表，一個 byte 都不准改。算的時候會在 stops 上掛 segLn
  // （含循環參照）、改寫通過站時刻，那些全是暫態；真把它們寫回去，等於把「貼軌後的狀態」
  // 冒充成班表原始資料，而且 densify 下一次重產又會把它洗掉，兩邊來回打架。
  if (JSON.stringify(out, null, 1) !== raw) throw new Error('班表檔內容被動到了——本腳本不得改寫它');

  // 剖面另立一檔，不併進班表：班表用 indent=1（densify_schedule.py 的排版），
  // 把 1.7 萬個折點塞進去會讓 gzip 從 536KB 漲到 816KB。獨立檔案用緊湊編碼便宜得多，
  // 而且班表檔可以維持與 densify 產物逐 byte 相同（零 diff）。
  // 「新檔案裝好的舊 App 抓不到」（initDataFreshness 不收 bundle 裡沒有的鍵）在這裡不是問題：
  // 前端本來就要改一次才會讀預算值，那顆 build 會把新檔一起帶進 bundle 與 manifest。
  const profPath = join(ROOT, 'data/tra_run_profiles.json');
  const body = JSON.stringify({
    source_notes: '本站自算，無外部上游：由 data/tra_schedule_dense.json（表定時刻）、'
      + 'data/tra.json（軌道線形，供跑段里程）、data/tra_pass_obs.json（通過站實測時刻）與 '
      + 'data/tra_track_sections.json（單雙線供交會推論；各站對最長實體股道路徑 maxPathM 供跑段里程下限）'
      + '四者，套 index.html 的位置模型（buildObsProfile／speedZoneKnots／assignRunProfiles，'
      + '由 scripts/build_run_profiles.mjs 原封切進 vm 沙箱執行）算出。'
      + '鍵＝車次→跑段起點站序；前端只在自己算出的跑段長度與時間對得上時才採用，對不上就現算。'
      + '梯形剖面不收錄；前端依當日車群安排待避時，該班整車不採用預算、改為現算。上述任一輸入或模型改動後必須重跑本腳本。',
    built_from: { schedule_date: work.date, trains: work.trains.length },
    trains: table,
  });
  // --check：只比對、不寫。前端判斷預算值過期只看 T／L（index.html 的 _rpPre.stale），改了車種參數或
  // 位置模型卻沒重跑本腳本，舊表照樣被採用、畫面無聲沿用舊參數——DR1000 那批驗收拿舊表實測過：
  // stale 仍是 0，2703／2707 位置差到 4040 m。出貨鏈（ship_web.mjs）靠這條擋。
  if (process.argv.includes('--check')) {
    const ratchetOk = checkMeetRatchet(indexPath);   // 與逐 byte 比對各自獨立：重產過表也躲不掉這條
    if (readFileSync(profPath, 'utf8') === body) {
      console.log(`✓ 台鐵預算剖面表與目前的模型一致（收錄 ${Object.keys(table).length} 個車次號）`);
      if (!ratchetOk) process.exit(1);
      return;
    }
    const was = JSON.parse(readFileSync(profPath, 'utf8')).trains || {};
    const diff = [...new Set([...Object.keys(was), ...Object.keys(table)])]
      .filter(k => JSON.stringify(was[k]) !== JSON.stringify(table[k]));
    console.error(`✗ 台鐵預算剖面表與目前的模型不符：${diff.length} 個車次號的剖面不同`
      + (diff.length ? `（${diff.slice(0, 8).join('、')}${diff.length > 8 ? '…' : ''}）` : '（剖面相同，表頭的班表日期或班次數不同）')
      + '——修法：npm run build-run-profiles 後 npm run build-manifest，兩個檔一起 commit');
    process.exit(1);
  }
  writeFileSync(profPath, body);

  console.log(`車次 ${work.trains.length}｜實測型剖面 ${obsRuns}（折點 ${knots}）｜梯形 ${plainRuns} 條不收錄`);
  console.log(`收錄 ${Object.keys(table).length} 個車次號`
    + (dropped.length ? `｜🔴 同號多版本且剖面不一致，整個不收：${dropped.join('／')}（前端現算）` : '｜無同號衝突'));
  console.log(`貼軌 ${JSON.stringify(segStats)}｜耗時 ${Date.now() - t0}ms`);
  console.log(`交會／待避推論：夾回 ${meetStats.snapped} 處通過時刻｜窗內無解 ${meetStats.infeasible}｜`
    + `重建不合格 ${meetStats.unbuildable}｜位移超過上限 ${meetStats.tooFar}｜彎道跑段略過 ${meetStats.zoneSkipped}`);
  console.log(`已寫入 ${profPath}（班表檔未動）`);
}

if (process.argv[1] && process.argv[1].endsWith('build_run_profiles.mjs')) main();

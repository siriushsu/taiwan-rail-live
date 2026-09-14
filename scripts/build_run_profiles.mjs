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
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, loadIndexSource } from './lib/extract_from_index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 頂層宣告依 index.html 的原始順序無關（函式提升），但 const 必須排在用到它的執行之前。
const CONSTS = ['PERF_DEFAULT', 'PERF_HSR', 'HSR_DEP_MID_SEC', 'PERF_RULES', 'PERF_BY_TYPE',
  'SPEED_ZONES', 'ZONE_KNOT_GAP', '_rpPre'];
const FUNCS = ['haversineKm', 'ensureCum', 'posAlongShape', 'isHSR', 'resolvePerf',
  'speedZoneClassOf', 'runSpeedZones', 'zoneProfileOk', 'zoneNatural', 'speedZoneKnots',
  'buildProfile', 'buildObsProfile', 'profTimeToProg', 'profProgToTime',
  'schedSegmentKm', 'schedSegKmOf', 'assignRunProfiles', 'canonicalizeAliasTrains',
  'projectOntoShape', 'assignSchedShapePathsFor'];

// 🔴 前端存進 state.passObs 的是檔案的 .trains 子物件，不是根物件（index.html:26667）。
// 傳整份進去不會報錯，只會讓每一次查表都落空、全部跑段靜默退回梯形——實測 236 台車的
// 剖面因此與瀏覽器不同，而畫面照樣有車。凡「餵給模型的東西」都要照前端的取法取，不要照檔案的形狀猜。
export function readPassObs(path) {
  return JSON.parse(readFileSync(path, 'utf8'))?.trains || null;
}

export function makeSandbox(indexPath) {
  const lines = loadIndexSource(indexPath);
  const src = extract(lines, [...CONSTS, ...FUNCS]);
  const ctx = createContext({
    console,
    state: { _segStats: { onShape: 0, straight: 0, bridged: 0 }, passObs: null },
  });
  runInContext(src, ctx, { filename: 'index.html(extracted)' });
  return ctx;
}

// 前端 applySchedSystems 對台鐵做的事，只留會影響剖面的那些：標 tr.sys、掛 passObs。
// （站等分級、共構站群、車種可見度…都不進剖面，刻意不做。）
export function computeProfiles({ indexPath, schedule, track, passObs, mutate }) {
  const ctx = makeSandbox(indexPath);
  ctx.state.passObs = passObs;
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
  runInContext('assignSchedShapePathsFor(trains, lines)', ctx);
  return { segStats: ctx.state._segStats };
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
    tr.stops.forEach((st, i) => {
      if (!st.rp || seen.has(st.rp)) return;
      seen.add(st.rp);
      if (!st.rp.obs) { plainRuns++; return; }
      obsRuns++; knots += st.rp.xs.length;
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

function main() {
  const indexPath = join(ROOT, 'index.html');
  const schedPath = join(ROOT, 'data/tra_schedule_dense.json');
  const raw = readFileSync(schedPath, 'utf8');
  // 解析兩份：一份拿去算（會被掛上 segLn 等含循環參照的欄位、通過站時刻也會被改寫），
  // 一份保持原樣當輸出底稿。絕不可以把算過的那份寫回檔案。
  const work = JSON.parse(raw), out = JSON.parse(raw);
  const track = JSON.parse(readFileSync(join(ROOT, 'data/tra.json'), 'utf8'));
  const passObs = readPassObs(join(ROOT, 'data/tra_pass_obs.json'));

  const t0 = Date.now();
  const { segStats } = computeProfiles({ indexPath, schedule: work, track, passObs });
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
  writeFileSync(profPath, JSON.stringify({
    source_notes: '本站自算，無外部上游：由 data/tra_schedule_dense.json（表定時刻）、'
      + 'data/tra.json（軌道線形，供跑段里程）與 data/tra_pass_obs.json（通過站實測時刻）'
      + '三者，套 index.html 的位置模型（buildObsProfile／speedZoneKnots／assignRunProfiles，'
      + '由 scripts/build_run_profiles.mjs 原封切進 vm 沙箱執行）算出。'
      + '鍵＝車次→跑段起點站序；前端只在自己算出的跑段長度與時間對得上時才採用，對不上就現算。'
      + '梯形剖面不收錄（前端閉式解即得）。上述任一輸入或模型改動後必須重跑本腳本。',
    built_from: { schedule_date: work.date, trains: work.trains.length },
    trains: table,
  }));

  console.log(`車次 ${work.trains.length}｜實測型剖面 ${obsRuns}（折點 ${knots}）｜梯形 ${plainRuns} 條不收錄`);
  console.log(`收錄 ${Object.keys(table).length} 個車次號`
    + (dropped.length ? `｜🔴 同號多版本且剖面不一致，整個不收：${dropped.join('／')}（前端現算）` : '｜無同號衝突'));
  console.log(`貼軌 ${JSON.stringify(segStats)}｜耗時 ${Date.now() - t0}ms`);
  console.log(`已寫入 ${profPath}（班表檔未動）`);
}

if (process.argv[1] && process.argv[1].endsWith('build_run_profiles.mjs')) main();

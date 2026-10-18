// 台南地面鐵道重播的日期設定。build_tainan_memory、build_tainan_track_ambiguities、seal_tainan_memory、
// verify_tainan_memory 與 tainan_actuals.py 都從這裡讀參數；沒帶 --date 時一律是 2026-09-12，既有封存的行為不變。
// 路徑：file 相對 repo 根目錄；cache 相對 .cache（不進版控，worktree 底下沒有，見 cacheRoot）。
//   node scripts/tainan_memory_config.mjs --json [--date YYYY-MM-DD]   印出解析後的設定（tainan_actuals.py 用）
// 另外匯出 generationFields／generationConfigSha256：build 把「產生資料所用的設定欄位」的雜湊記進 snapshot.sources，verify 重算比對（說明見該段）。
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DATE = '2026-09-12';
const BOUNDS = [120.19, 22.928, 120.255, 23.023], ORIGIN = [120.21295, 22.99681];

const CONFIGS = {
  // 已上線的封存：只供 verify／seal 重現既有驗收，build 一律拒跑（sealed）。
  '2026-09-12': {
    date: '2026-09-12', previous: '2026-09-11', dir: 'memories/tainan-2026-09-12', sealed: true,
    bounds: BOUNDS, origin: ORIGIN, timing: 'scheduled',
    verify: {
      trains: 227, directions: {北上: 114, 南下: 113}, overnight: 2, uncertaintyIntervals: 22,
      // 主站 index.html 的入口（id="…"、data-cl="…"）。
      entry: {id: 'tainanMemoryLink', cl: 'tainanmemory0912'},
    },
    // 重建演算法的回測：當天秒級歷史當真值（tainan_actuals.py --backtest）。班表是 9/12 封存時 build 讀的那一份，
    // sha256 與 snapshot.sources 記錄的 data/tra_schedule_dense.json 相同。
    backtest: {
      hist: 'tra_hist/2026-09-12.jsonl.gz',
      schedule: {cache: 'tainan-1016-work/inputs/tra_schedule_dense_132e1ebb.json', sha256: 'b53416cdaea9c90953f0474dd67d23ca727b8e72c1fccb29ecc6c0f3af601d00'},
      stations: 'tainan-1016-raw/stations.json',
      // 回測結果（JSON）寫到這裡；10/16 的 snapshot.timingSource.calibration 讀它，不手抄數字。
      out: 'tainan-1016-work/backtest-2026-09-12.json',
    },
  },
  // 地面鐵道最後一天：到離站時刻全天依實測紀錄重建（docs/tainan-memory-2026-10-16-design.md）。
  '2026-10-16': {
    date: '2026-10-16', previous: '2026-10-15', dir: 'memories/tainan-2026-10-16',
    bounds: BOUNDS, origin: ORIGIN, timing: 'observed',
    // 選班：大橋、臺南、保安任一站（停靠或通過）的時刻落在當天 0–86399 秒內。截短到保安的班次不經過臺南，
    // 9/12 的「有臺南站」規則會漏掉它們。
    selection: {stations: ['大橋', '臺南', '保安']},
    // 營運日 → 密化班表。10/15 跨午夜的班次要用 10/15 那一版（樹裡的 data/ 只有 10/16 起）。
    schedules: {
      '2026-10-15': {cache: 'tainan-1016-work/inputs/tra_schedule_dense_32244b8a.json', commit: '32244b8a', path: 'data/tra_schedule_dense.json',
        sha256: 'c8735753a8e062979a1b87a4326ca27a153e85386fb1e7f98626383ad3172efa'},
      '2026-10-16': {file: 'data/tra_schedule_dense.json'},
      '2026-10-17': {file: 'data/tra_schedule_dense.json'},
    },
    actuals: {
      out: 'tainan-1016-work/actuals-2026-10-16.json',
      runFloor: 'tainan-1016-work/run-floor-2026-10-16.json',
      stations: 'tainan-1016-raw/stations.json',
      // 秒級歷史為主、D1 分鐘級為輔（同站兩者都有時以歷史為準）。封存時 tra_hist 的 10-17 那份還不存在、當時被略過；
      // 現在 tainan_actuals.py 遇到列了卻不在磁碟上的檔會停下來報錯。
      hist: ['tra_hist/2026-10-15.jsonl.gz', 'tra_hist/2026-10-16.jsonl.gz', 'tra_hist/2026-10-17.jsonl.gz'],
      d1: ['tainan-1016-raw/d1-tra_station_events-2026-10-15.json', 'tainan-1016-raw/d1-tra_station_events-2026-10-16.json',
        'tainan-1016-raw/d1-tra_station_events-2026-10-17.json'],
      // 只記雜湊的原始檔（重建沒有直接讀，但 snapshot.sources 要能追到下載當下的版本）。
      recordOnly: ['tainan-1016-raw/20261016.json', 'tainan-1016-raw/20261017.json', 'tainan-1016-raw/SHA256SUMS', 'tainan-1016-raw/README.txt'],
      calibration: 'tainan-1016-work/backtest-2026-09-12.json',
      report: 'tainan-1016-work/build-report-2026-10-16.json',
    },
    // 標註以車次號＋營運日比對（train id 含班表索引，換班表就會變）。build 另外從重建結果複驗這兩班的身分。
    marks: [{train: '3782', serviceDate: '2026-10-16', mark: 'last-ground'}, {train: '145', serviceDate: '2026-10-16', mark: 'last-south'}],
    singleLine: {
      section: ['永康', '保安'],
      stations: ['永康', '大橋', '臺南', '保安'],   // 北→南；占用檢查以相鄰兩站為一個子區間
      // 官方：22:00 先封鎖東正線，23:00 全面封鎖。單線雙向的起點不寫在這裡：build 從重建時刻找最後一組
      // 對向重疊（同一子區間、方向相反、時間重疊）結束的時刻，取下一個整分。
      officialSec: 79200, fullClosureSec: 82800,
      // 推定：南下那組 way 位在北上那組東側約 5–25 公尺，所以當成東正線；股道資料本身沒有東西正線的屬性。
      // 臺南月台、大橋側、站南三段的 way（北上／南下）。北上組＝西正線，單線期間南下列車反向行駛在這一組上。
      ways: {
        north: [1176543136, 1413625262, 347018826, 350845572, 1176543137, 347019916, 347019912, 374528514, 346746535],
        south: [152086608, 747411514, 903047509, 108071684, 350845571, 1176543138, 1176543139, 108037248, 161325956, 161325955, 197614795, 172225920, 346746536],
      },
      tainanPlatformWay: 1176543136,
    },
    // 時間軸裡的官方事項（觀測類由 build 從重建結果算，不寫在這裡）。text 不含時刻，頁面自己從 t 顯示。
    officialEvents: [
      {id: 'east-line-closed', t: 79200, text: '東正線封鎖', kind: 'official'},
      {id: 'underground-opens', t: 86400 + 21600, text: '地下化通車', kind: 'official'},
    ],
    // 觀測類時間軸：時刻由 build 從重建結果取（train 在 station 的 field），text 的 {wait} 由 build 找出那段時間在同站交會的對向車。
    // follow: 'other'＝這一列的車次欄（train）記 other 那班，時刻仍取 train 那班在該站的紀錄。
    observedEvents: [
      {id: 'south-waits-yongkang', train: '145', serviceDate: '2026-10-16', station: '永康', field: 'arrSec', text: '{train} 到永康，等 {wait}', wait: {direction: '北上', at: '永康'}},
      {id: 'south-at-tainan', train: '145', serviceDate: '2026-10-16', station: '臺南', field: 'arrSec', text: '{train} 到臺南'},
      {id: 'last-waits-baoan', train: '3782', serviceDate: '2026-10-16', station: '保安', field: 'arrSec', text: '{train} 到保安，等 {wait}', wait: {direction: '南下', at: '保安'}},
      {id: 'meet-baoan', train: '145', serviceDate: '2026-10-16', station: '保安', field: 'arrSec', text: '{other}、{train} 在保安交會', other: {train: '3782', serviceDate: '2026-10-16'}, follow: 'other'},
      {id: 'last-at-tainan', train: '3782', serviceDate: '2026-10-16', station: '臺南', field: 'arrSec', text: '{train} 到臺南'},
      {id: 'last-leaves-tainan', train: '3782', serviceDate: '2026-10-16', station: '臺南', field: 'depSec', text: '{train} 開出臺南，地面臺南站最後一班', claim: 'last-departure'},
      {id: 'last-leaves-yongkang', train: '3782', serviceDate: '2026-10-16', station: '永康', field: 'depSec', text: '{train} 離開永康，地面鐵道營運結束', claim: 'last-section-exit'},
    ],
    defaultSec: 79200,
    // 股道重疊（uncertainty.json 的 track-overlap）：兩車車身要共用同一條 way 才算（way 由路段座標對上 snapshot.rails）。
    // 岔心旁的近接不算；但兩條 way 的中心線相距不到 closeWayM 超過 closeWaySec 秒的，可能是同一條實體股道畫成兩條，照樣標。
    ambiguity: {criterion: 'shared-way', closeWayM: 1.5, closeWaySec: 3, report: 'tainan-1016-work/ambiguity-report-2026-10-16.json'},
    verify: {
      trains: 226, overnight: 2, anchorToleranceSec: 60, markedTrains: ['145', '3782'],
      // 主站 index.html 的入口（id="…"、data-cl="…"），在 9/12 那列（#tainanMemoryLink）的下一列，另取 id 以免重複。
      // 設計第 9 節：入口等使用者看過頁面才加；還沒加時這裡設 null，完整模式會印一行略過入口檢查。
      entry: {id: 'tainanMemory1016Link', cl: 'tainanmemory1016'},
      // 時間軸每一列的說明與報導連結，放在封存目錄的這個檔（以事件 id 對應），不寫進 snapshot：說明是事後補的文字，
      // 不是重建結果，改說明不必重建快照。驗收要求每一列都有說明、連結欄位齊全。
      eventNotes: 'event-notes.json',
    },
    note: '依 TDX 即時動態的逐站紀錄推算 2026-10-16 的到離站時刻（到站誤差約半分鐘；大橋、仁德站不回報，時間為內插），不是 GPS 軌跡；股道位置與單線雙向的進路是推演。編組依車種推估。道路與輪廓為封存時 OSM 資料，背景高度簡化；範圍為大橋至保安周邊，非工程計畫邊界。',
  },
  // 地下化後第一個週五（與 10/16 同星期）的對照重播。預覽版：到離站時刻是臺鐵 ODS 預覽版逐日班表的表定值，沒有實測；
  // 定版班表與實測要等 10/24 下午才有。換成定版的步驟見 docs/tainan-memory-2026-10-23-design.md 第 5 節。
  '2026-10-23': {
    date: '2026-10-23', previous: '2026-10-22', dir: 'memories/tainan-2026-10-23',
    bounds: BOUNDS, origin: ORIGIN, timing: 'scheduled',
    // 預覽標記：有這一項＝整份資料沒有實測，頁面與 verify 都要照預覽處理。換定版時整項刪掉（不是改成 null），再把 timing 改 'observed'。
    preview: {
      kind: 'ods-preview',
      reason: '臺鐵 ODS 預覽版逐日班表（2026-10-17 手動下載），定版班表與實測紀錄 10/24 下午才有',
    },
    selection: {stations: ['大橋', '臺南', '保安']},
    // 營運日 → 密化班表（scripts/tainan_ods_to_dense.py 由 ODS 逐日檔轉出）。10/22 跨午夜的班次用 10/22 那一版。
    // convertedFrom:'ods'：這份班表由轉換腳本轉出，build 把轉換用的三支腳本也記進 snapshot.sources（定版班表同樣保留這一項）。
    // temporary：預覽期間的暫代來源，定版時要換掉（換法見設計文件第 5 節）。
    schedules: {
      '2026-10-22': {cache: 'tainan-1023-work/inputs/tra_schedule_dense_0bc3cfae.json', commit: '0bc3cfae', path: 'data/tra_schedule_dense.json',
        sha256: '3e206490220b94619e16b892fb277ad8f03bef44c8d95f6f7d9bf004954515bb',
        temporary: '10/16 上架的 14 天班表（ODS UpdateTime 2026-10-15 14:24:59）裡的 10/22，只供跨午夜班次；定版時換成 10/22 當天的逐日檔轉出的密化班表'},
      '2026-10-23': {cache: 'tainan-1023-work/inputs/tra_schedule_dense_ods1017.json', convertedFrom: 'ods',
        sha256: '2bbfeb38d84b5534d6177f99aa418a72af8833c5552fd0add06b44673f8551b7',
        temporary: 'ODS 預覽版逐日檔 20261023.json（UpdateTime 2026-10-15 16:33:22，2026-10-17 01:31 下載）轉出；定版時換成 10/24 抓到的定版逐日檔轉出的密化班表'},
    },
    actuals: {
      out: 'tainan-1023-work/actuals-2026-10-23.json',
      runFloor: 'tainan-1023-work/run-floor-2026-10-23.json',
      stations: 'tainan-1023-raw/prelim-20261017/stations.json',
      // 預覽沒有實測：兩項為空，tainan_actuals.py 讀不到任何紀錄，每班整班照表定。換定版時填入 TDX 歷史與 D1 的檔案。
      hist: [], d1: [],
      // 只記雜湊的原始檔（重建沒有直接讀，但 snapshot.sources 要能追到下載當下的版本）。
      recordOnly: ['tainan-1023-raw/prelim-20261017/20261023.json', 'tainan-1023-raw/prelim-20261017/SHA256SUMS',
        'tainan-1023-raw/prelim-20261017/DOWNLOADED_AT', 'tainan-1023-raw/README.txt'],
      report: 'tainan-1023-work/build-report-2026-10-23.json',
    },
    // 地下化結構與高程剖面（model.json／profile.json）。build 用它算軌道面高程 z 與臺南月台的停靠點，並把兩份的雜湊記進 snapshot.sources。
    underground: {
      model: 'memories/tainan-2026-10-23/underground/model.json',
      profile: 'memories/tainan-2026-10-23/underground/profile.json',
      footprintKinds: ['tunnel', 'station', 'trough'],
      // 停靠點換到月台中央的車站（profile.json 的 derived.platform）。
      stopStation: '臺南',
    },
    // 開頁的時刻 08:27:00：畫面內 4 班全在地下（北上 2、南下 2），其中 3 班同時停在臺南月台，另 1 班在月台以南的隧道裡；
    // 前後 30 秒也各有 4 班在地下，而且不在不確定時段內（預覽班表的選擇；定版班表換上後要重挑，見設計文件第 5 節）。
    defaultSec: 30420,
    // 股道重疊的判準同 10/16。另加 deepOverlapM：兩車車身橫向重疊的深度（兩車車寬的平均，減去兩車車身中心線之間的最短距離）超過它的秒也算，
    // 不論共不共用 way——車身中心已離開道岔、車尾還壓在道岔上的秒，只看共用 way 抓不到。門檻是量出來的：預覽班表與兩個以實測日彩排的日期，
    // 整天逐秒、所有車對，相遇段的最大深度只有兩群，一般並行與道岔上的近接 ≤0.84 m（其中 38 段 ≤0.37 m），車身壓在一起 ≥2.8 m；1 m 放在兩群之間。
    ambiguity: {criterion: 'shared-way', closeWayM: 1.5, closeWaySec: 3, deepOverlapM: 1, report: 'tainan-1023-work/ambiguity-report-2026-10-23.json'},
    verify: {
      // 預覽班表的門檻；換定版班表後照 build 報表的數字更新（設計文件第 5 節）。
      trains: 232, overnight: 2, directions: {'北上': 117, '南下': 115}, uncertaintyIntervals: 4,
      // 地下化資料的門檻（verify_tainan_memory_1023_data.mjs）：臺南站有停靠的班數（畫面內）、穿過地下段的班數，與位置誤差上限。
      // abruptArrivals：到站那一秒從行駛速度直接停住的班數（前一站是通過站、時刻排得很緊的班次，既有物理模型的樣子），數字變了要重看。
      underground: {tainanStops: {'北上': 116, '南下': 114}, offscreenStops: 2, trainsUnderground: {'北上': 117, '南下': 115}, abruptArrivals: 8, centerToleranceM: 1, zToleranceM: 0.05,
        // 開頁時刻的畫面：畫面內的班數、在地下的班數（依方向）、停在臺南月台的班數。
        defaultScene: {inView: 4, underground: {'北上': 2, '南下': 2}, dwellAtTainan: 3}},
      // 主站入口等重播頁確認過才加；設 null＝還沒加（設計文件第 5 節）。
      entry: null,
    },
    note: '2026-10-23 的到離站時刻是臺鐵 10/15 發布的預覽版班次表的表定時刻，不是實際運行的紀錄；定版班表與實測要等 10/24 下午才有，到時會更新。南下與北上列車依地下化後的線形行駛，臺南站停靠位置在月台中央；地下段高程、車站與隧道尺寸為示意。編組依車種推估。道路與輪廓為 OSM 資料，背景高度簡化；範圍為大橋至保安周邊，非工程計畫邊界。',
  },
};

// 彩排用的暫時設定（不進版控）：TAINAN_EXTRA_CONFIG 指到一個 JSON 檔，內容是 {日期: 設定}，欄位同上。
// 只能加新的日期，不能蓋掉上面已有的；沒設這個環境變數時什麼都不變。build、tainan_actuals.py、build_tainan_track_ambiguities、verify
// 都讀這支設定，整條鏈要帶同一個值（快取另放時再設 TAINAN_CACHE_DIR），例：TAINAN_EXTRA_CONFIG=<設定檔> node scripts/build_tainan_memory.mjs --date <彩排日期>。
if (process.env.TAINAN_EXTRA_CONFIG) {
  for (const [date, c] of Object.entries(JSON.parse(fs.readFileSync(process.env.TAINAN_EXTRA_CONFIG, 'utf8')))) {
    if (CONFIGS[date]) throw Error('TAINAN_EXTRA_CONFIG 不能蓋掉既有的日期：' + date);
    CONFIGS[date] = c;
  }
}

// .cache 不進版控：worktree 底下沒有，回到主樹找（git common dir 的上一層）。TAINAN_CACHE_DIR 可覆寫。
let cached;
export function cacheRoot() {
  if (cached) return cached;
  if (process.env.TAINAN_CACHE_DIR) return (cached = path.resolve(process.env.TAINAN_CACHE_DIR));
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).trim();
    const dir = path.join(path.dirname(common), '.cache');
    if (fs.existsSync(dir)) return (cached = dir);
  } catch {}
  return (cached = path.join(ROOT, '.cache'));
}

// --date YYYY-MM-DD 與 --date=YYYY-MM-DD 都收。只認空格分隔時，寫成等號會被默默當成預設日期，
// 對著已封存的那一天跑 seal 之類會寫檔的指令。
export function dateFromArgv(argv = process.argv) {
  const i = argv.indexOf('--date'), eq = argv.filter(a => a.startsWith('--date='));
  if (eq.length + argv.filter(a => a === '--date').length > 1) throw Error('--date 只能給一次');
  if (i < 0 && !eq.length) return DEFAULT_DATE;
  const d = eq.length ? eq[0].slice('--date='.length) : argv[i + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw Error('--date 要接 YYYY-MM-DD');
  return d;
}

function rawConfig(date) {
  const c = CONFIGS[date];
  if (!c) throw Error('沒有 ' + date + ' 的台南重播設定；可用：' + Object.keys(CONFIGS).join('、'));
  return c;
}

// 回傳深拷貝，並補上 root、cacheRoot 與絕對路徑解析函式。
export function configFor(date = DEFAULT_DATE) {
  const cfg = structuredClone(rawConfig(date));
  cfg.root = ROOT; cfg.cacheRoot = cacheRoot(); cfg.outDir = path.join(ROOT, cfg.dir);
  return cfg;
}
export const knownDates = () => Object.keys(CONFIGS);
// {file} → repo 內路徑；{cache} 或字串 → .cache 內路徑。
export function resolveInput(cfg, ref) {
  if (typeof ref === 'string') return path.join(cfg.cacheRoot, ref);
  if (ref.file) return path.join(cfg.root, ref.file);
  if (ref.cache) return path.join(cfg.cacheRoot, ref.cache);
  throw Error('無法解析的輸入：' + JSON.stringify(ref));
}

// ── snapshot.sources 的設定檔紀錄 ──
// 記整個設定檔的雜湊，會在改註解、加 verify.entry 時無故過期。改記「產生資料所用的設定欄位」：該日期設定的全部頂層欄位，
// 扣掉 NOT_GENERATION（verify＝驗收門檻與主站入口）；註解不在設定的內容裡。內容做成鍵遞迴排序的 JSON（canonicalJson）再取 sha256。
// 只看原始設定（CONFIGS），不看 configFor 補上的絕對路徑，所以換一棵工作樹雜湊不變。
// build 把欄位名單（generationFields）與雜湊寫進 snapshot.sources；verify 照「快照記的欄位名單」重算比對：
// 日後設定多出的欄位、verify 內的改動與註解都不影響已封存的紀錄，只有名單內的欄位改了才不符（＝設定改了而快照沒有重建）。
const NOT_GENERATION = ['verify'];
// 物件鍵依 UTF-16 碼位遞迴排序（與 Array#sort 預設相同），陣列保持原順序，其餘同 JSON.stringify。
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}
export const generationFields = date => Object.keys(rawConfig(date)).filter(k => !NOT_GENERATION.includes(k)).sort();
export function generationConfigSha256(date, fields = generationFields(date)) {
  const c = rawConfig(date), picked = Object.fromEntries(fields.filter(k => k in c).map(k => [k, c[k]]));
  return crypto.createHash('sha256').update(canonicalJson(picked)).digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(configFor(dateFromArgv())) + '\n');
}

// DR1000 柴油客車的運動參數守門人。
// 平溪、深澳、集集、內灣（竹中以南）沒有電車線，跑的是 DR1000 柴油客車，但台鐵班表一律標「區間車」。
// 車種介紹 7/17 起就認得 DR1000，運動模型卻沒接上，照「區間車」給電聯車的加減速與極速（2.5／3.0／120），
// 2026-09-18 使用者指出才補。這支把「認得出來的 DR1000 必須拿到 DR1000 的參數」釘住，而且驗到
// 【建好的跑段剖面】為止：剖面走 assignRunProfiles 另一條路徑建出來，接線斷在哪一層都要紅。
//
// 真值來源刻意不從實作取（同源的「相等」是零資訊）：
//  - 哪些車是 DR1000：停靠未電化車站的區間車／區間快。未電化車站抄自維基各線條目——平溪線、深澳線、
//    集集線「電化區間：無」，內灣線「非電氣化（竹中~內灣）」。實作靠 data/tra_special_trains.json 的
//    matchStations 認支線，這份清單比它多了內灣線的上員、榮華，兩份各自獨立。
//  - DR1000 的參數：維基 DR1000 資訊框「減速度（正常）2.448 km/h/s」「營運最高速度 110」。
//    起動加速度中、日、德文維基都空白，採柴聯自強同一個估值 1.5——這一項是實作者的決定、不是外部事實，
//    所以只拿來驗「有沒有接上」，不當物理真值。
//  - 反向對照：六家線、沙崙線已電化，停那裡的區間車必須維持電聯車參數，免得判準寫寬了把電車也吃進來。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContext } from 'node:vm';
import { makeSandbox, computeProfiles, readPassObs } from './build_run_profiles.mjs';
import { extract, loadIndexSource } from './lib/extract_from_index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const NON_ELECTRIFIED = new Set(['大華', '十分', '望古', '嶺腳', '平溪', '菁桐',   // 平溪線（三貂嶺在宜蘭線上，已電化）
  '海科館', '八斗子',                                                        // 深澳線（瑞芳已電化）
  '源泉', '濁水', '龍泉', '集集', '水里', '車埕',                               // 集集線（二水已電化）
  '上員', '榮華', '竹東', '橫山', '九讚頭', '合興', '富貴', '內灣']);             // 內灣線竹中以南
const ELECTRIFIED_BRANCH = { '六家線': ['六家'], '沙崙線': ['長榮大學', '沙崙'] };
const DR1000 = { a: 1.5, b: 2.448, v: 110 };
const EMU = { a: 2.5, b: 3.0, v: 120 };   // PERF_RULES 的「電車|區間」那一列
const isQu = tr => /區間/.test(tr.typeName || tr.carName || '');
const isDr = tr => isQu(tr) && tr.stops.some(s => NON_ELECTRIFIED.has(s.name));
const same = (p, want) => p && ['a', 'b', 'v'].every(k => p[k] === want[k]);
const fmt = p => p ? `a=${p.a} b=${p.b} v=${p.v}` : String(p);

const failures = [];
const schedule = read('data/tra_schedule_dense.json');
const dr = schedule.trains.filter(isDr);
// 覆蓋率要有具名斷言：分母無聲縮成 0 時，下面每一條都會空轉成綠。
if (!dr.length) failures.push('班表裡找不到任何停靠未電化車站的區間車——分母是 0，這支閘門等於沒跑');

// 1. resolvePerf：跟離線預算同一個沙箱（載好支線資料，與前端開機時的 state.special 相同）
const ctx = makeSandbox(join(ROOT, 'index.html'));
for (const tr of schedule.trains) tr.sys = 'tra_sched';
const wrong = dr.filter(tr => !same(ctx.resolvePerf(tr), DR1000));
if (wrong.length) failures.push(`${wrong.length}/${dr.length} 班 DR1000 沒拿到 DR1000 參數，例：${wrong[0].train} 次`
  + `（${wrong[0].stops[0].name}→${wrong[0].stops.at(-1).name}）拿到 ${fmt(ctx.resolvePerf(wrong[0]))}`);
// 支線上的非區間車（觀光專開之類）照自己的 carName 走 PERF_RULES，不因為停了支線就變 DR1000。
// 班表裡常常一班都沒有，所以用一班合成的莒光號釘住這條規則，不靠當天剛好有樣本。
// （不用柴聯自強當對照：它在 PERF_RULES 的數字與 DR1000 相同，比不出差別。）
const CHU = { a: 1.5, b: 2.6, v: 120 };   // PERF_RULES 的「莒光|復興」那一列
const tour = { train: '9901', sys: 'tra_sched', carName: '莒光', typeName: '莒光/復興', stops: [{ name: '瑞芳' }, { name: '平溪' }] };
if (!same(ctx.resolvePerf(tour), CHU))
  failures.push(`停平溪線的莒光號沒照自己的車種走，拿到 ${fmt(ctx.resolvePerf(tour))}——判準漏了「區間車／區間快」這個條件`);
for (const [line, stations] of Object.entries(ELECTRIFIED_BRANCH)) {
  const ctl = schedule.trains.filter(tr => isQu(tr) && !isDr(tr) && tr.stops.some(s => stations.includes(s.name)));
  if (!ctl.length) { failures.push(`反向對照缺樣本：班表裡沒有停${line}的區間車`); continue; }
  const bad = ctl.filter(tr => !same(ctx.resolvePerf(tr), EMU));
  if (bad.length) failures.push(`${line}已電化，卻有 ${bad.length}/${ctl.length} 班沒拿電聯車參數，例：${bad[0].train} 次 ${fmt(ctx.resolvePerf(bad[0]))}`);
}

// 2. 建好的剖面：梯形剖面身上的 a／b 就是建它時用的參數（buildProfile 存 m/s²），直接讀出來比
const fresh = read('data/tra_schedule_dense.json');
computeProfiles({ indexPath: join(ROOT, 'index.html'), schedule: fresh, track: read('data/tra.json'),
  passObs: readPassObs(join(ROOT, 'data/tra_pass_obs.json')) });
let trap = 0, obs = 0, linear = 0;
const badRp = [];
for (const tr of fresh.trains.filter(isDr)) {
  const seen = new Set();
  let k0 = 0;
  for (let k1 = 1; k1 < tr.stops.length; k1++) {
    const st = tr.stops[k1];
    if (st.stop === false && !st._plannedDwell && k1 < tr.stops.length - 1) continue;
    const rp = tr.stops[k0].rp;
    k0 = k1;
    if (!rp) { linear++; continue; }
    if (seen.has(rp)) continue;
    seen.add(rp);
    if (rp.obs) { obs++; continue; }   // 實測型剖面不存 a／b；它吃的極速已由上面的 resolvePerf 斷言涵蓋
    trap++;
    const aK = rp.a * 3.6, bK = rp.b * 3.6, vK = rp.vc * 3.6;
    if (Math.abs(aK - DR1000.a) > 1e-9 || Math.abs(bK - DR1000.b) > 1e-9 || vK > DR1000.v + 1e-9)
      badRp.push(`${tr.train} 次 ${tr.stops.indexOf(st)} 站前的跑段：a=${aK.toFixed(3)} b=${bK.toFixed(3)} 巡航=${vK.toFixed(1)}`);
  }
}
if (!trap) failures.push('DR1000 一條梯形剖面都沒檢查到——分母是 0');
if (badRp.length) failures.push(`${badRp.length}/${trap} 條 DR1000 梯形剖面不是用 DR1000 參數建的，例：${badRp[0]}`);

// 3. 列車卡：trainIntro 對 DR1000 不得回 stock。列車卡（renderTrainCard）的車種名／故事／小知識都以 stock 優先，
//    回了就顯示成「區間車（通勤電聯車）」或「區間快車」的電聯車故事——7/18 正名只改了 kind／desc，跟車面板對了、
//    列車卡沒對，09-19 瀏覽器驗收才抓到。語系函式換成恆等替身：比的是中文正本，不是翻譯。
runInContext('var t = s => s; var i18nNumber = n => String(n);', ctx);
runInContext(extract(loadIndexSource(join(ROOT, 'index.html')),
  ['SPECIAL_TRAINS', 'KIND_RULES', 'TYPE_DESC', 'AMEN_FLAGS', 'DR1000_KIND', 'DR1000_DESC', 'trainIntro']), ctx);
const cardBad = dr.filter(tr => { const it = ctx.trainIntro(tr); return it.stock !== null || it.kind !== 'DR1000 型柴油客車'; });
if (cardBad.length) {
  const it = ctx.trainIntro(cardBad[0]);
  failures.push(`${cardBad.length}/${dr.length} 班 DR1000 的列車卡會顯示成「${it.stock ? it.stock.name : it.kind}」，例：${cardBad[0].train} 次`);
}
// 反向對照：其餘台鐵車的 stock 原樣傳給列車卡（修法只准碰 DR1000）；其中要真的有帶 stock 的，否則這條恆綠。
const passBad = schedule.trains.filter(tr => !isDr(tr) && ctx.trainIntro(tr).stock !== ctx.specialOf(tr).stock);
const withStock = schedule.trains.filter(tr => !isDr(tr) && ctx.trainIntro(tr).stock).length;
if (passBad.length) failures.push(`${passBad.length} 班非 DR1000 的列車卡沒拿到自己的車型介紹，例：${passBad[0].train} 次`);
if (!withStock) failures.push('反向對照缺樣本：非 DR1000 的車一班都沒帶車型介紹（stock），「原樣傳遞」那條等於沒驗');

console.log(`DR1000 ${dr.length} 班｜梯形剖面 ${trap} 條、實測型 ${obs} 條、等速退路 ${linear} 段｜列車卡反向對照帶車型介紹 ${withStock} 班`);
if (failures.length) {
  for (const f of failures) console.error('✗ ' + f);
  process.exit(1);
}
console.log('✓ DR1000 拿到自己的加減速與極速、列車卡顯示 DR1000，已電化支線維持電聯車');

#!/usr/bin/env node
// 自製列車：my-train-plan.js 與儲存純函式的守門腳本（純 Node，幾秒內跑完）。
// 用法：node scripts/verify_my_train_plan.mjs → 全綠 exit 0；任何一條紅 exit 1。
// 🔴 被借用的產品程式（buildProfile、PERF_RULES、traStnKey、resolveScheduleDay…）一律從 index.html 抽出來跑，不准重寫一份。
// 🔴 被驗的東西（站等、統計組的段數與中位數、退路選哪一組、物理下限）期望值由這支腳本自己從原始 JSON 算，
//    不准拿 my-train-plan.js 的對應函式當期望值（期望值不跟實作同源）。
// 🔴 跟真車比只出報表（output/my-train-plan-report.tsv，gitignored），硬斷言只有樣本數。
// 🔴 golden fixture 寫到 output/golden/mytrain/（gitignored）；原生端（Kotlin 逐字翻譯版）的對應位置是
//    native/parity/golden/modules/mytrain/（另一個私有 repo），複製這裡的 JSON 過去即可，本腳本不寫 native/ 底下任何東西。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJSON = rel => JSON.parse(read(rel));
const INDEX = read('index.html');

let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
// 一段測試整段包起來：還沒實作的函式會丟 TypeError，記成一條紅，後面的段落照跑。
function section(title, fn) {
  console.log(`\n── ${title} ──`);
  try { fn(); } catch (e) {
    failures++;
    console.log(`❌ ${title}：丟錯 ${e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e}`);
  }
}
// 大量同型斷言：逐筆累積，段落結束時每一種各印一行（含總筆數與前三筆失敗）。
// roster（可選）：這個 tally 這一輪「應該」出現的標籤清單。report() 時，roster 裡登記過、但這一輪
// 從沒被 expect() 呼叫過的標籤 → 直接印一條❌「一筆都沒量到」——這是原本 `r.n > 0` 想擋、卻擋不到的
// 情境：能進 Map 的項目一定 n>=1（先 r.n++ 才可能被 set），`r.n > 0` 恆真，真正會漏掉的是「整個迴圈
// 一圈都沒跑、標籤連 Map 都沒進去」，只有跟 roster 比對才抓得到。
// minN（expect 的第 4 個參數，可選）：這個標籤這一輪至少該出現幾筆，換掉恆真的 r.n > 0；不給就是 1
// （等於原本的行為，只防「完全沒進 Map」，不防「進了但比預期少」）。
function tally(roster) {
  const m = new Map();
  return {
    expect(label, pass, detail, minN = 1) {
      if (!m.has(label)) m.set(label, { n: 0, bad: [], minN });
      const r = m.get(label); r.n++;
      if (minN > r.minN) r.minN = minN;
      if (!pass) r.bad.push(detail);
    },
    report() {
      for (const [label, r] of m) {
        check(r.n >= r.minN && r.bad.length === 0, `${label}（${r.n} 筆）`,
          r.bad.length ? `${r.bad.length} 筆不過，例：${r.bad.slice(0, 3).join('；')}` : (r.n < r.minN ? `筆數 ${r.n} 低於門檻 ${r.minN}` : ''));
      }
      for (const label of roster || []) if (!m.has(label)) check(false, label, '這一類一筆都沒量到（roster 裡登記過，這輪從沒呼叫 expect——迴圈可能整圈沒跑到）');
    },
  };
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} 未閉合`);
}
function extractConst(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!match) throw new Error(`找不到 const ${name}`);
  return match[0];
}
// 多行的陣列／物件常數。PERF_RULES 的註解裡有分號，extractConst 的 [^;]+ 會在那裡切斷，所以另寫一支配對括號的。
function extractLiteral(source, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(source);
  if (!m) throw new Error(`找不到 const ${name}`);
  const open = m.index + m[0].length, oc = source[open], cc = oc === '[' ? ']' : oc === '{' ? '}' : null;
  if (!cc) throw new Error(`const ${name} 不是陣列或物件字面值`);
  let depth = 0, mode = 'code', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') ||
          (mode === 'template' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === oc) depth++;
    if (c === cc && --depth === 0) return source.slice(m.index, i + 1) + ';';
  }
  throw new Error(`const ${name} 未閉合`);
}

// ── 借用的產品程式（從 index.html 原樣抽出，在沙箱裡跑）──
const TIMING = read('rail-3d/physical/timing.js');
const product = vm.createContext({ console: { log() {}, warn() {} } });
vm.runInContext([
  extractLiteral(INDEX, 'PERF_RULES'),
  extractConst(INDEX, 'PERF_HSR'),
  extractConst(INDEX, 'PERF_DR1000'),
  extractFunction(INDEX, 'buildProfile'),
  extractFunction(INDEX, 'traStnKey'),
  extractFunction(INDEX, 'haversineKm'),
  extractFunction(INDEX, 'canonicalizeAliasTrains'),
  extractFunction(INDEX, 'schedWeekday'),
  extractFunction(INDEX, 'nearestSameWeekday'),
  extractFunction(INDEX, 'resolveScheduleDay'),
  extractFunction(INDEX, 'schedWrapT'),
  // stationKey 的真值來源不是 index.html：要對齊的是網頁 rail-3d/physical/timing.js 那一份
  // （railcore PhysicalJs.stationKey 的 KDoc 逐字引用同一行），原樣借出來跑，不是重寫一份、也不准
  // 呼叫 MyTrainPlan.stationKey——同源比較是零資訊。
  extractConst(TIMING, 'stationKey'),
  'var state = { clockAtNow: true, wallDay: "" };',
  'function todayStr() { return globalThis.__pinDay; }',
  'globalThis.__product = { PERF_RULES, PERF_HSR, PERF_DR1000, buildProfile, traStnKey, haversineKm,',
  '  canonicalizeAliasTrains, resolveScheduleDay, schedWrapT, state, stationKey };',
].join('\n'), product);
const P = product.__product;

// ── 資料 ──
// 班表三個檔釘在一顆 commit，不讀磁碟：台鐵班表每週例行重抓（npm run fetch-schedule 整份重產），讀磁碟會讓
// golden 的人工核可值、「當天切得出跨夜借班」「有段被強制單調壓過」這些前提跟著資料窗漂——班表重抓成
// 9/26～10/9 之後，這支紅了五條，程式一行沒動。FIXTURE_REF＝golden 核可時那一份（8f228a09，窗 9/18～10/1）。
// 軌道、站等、車種色表照舊讀磁碟：那些變了是路線或車牌真的變了，該紅、該重新核可。
// MYTRAIN_DATA=disk 改讀磁碟上的班表（看真實資料用，不當出貨判準）。換 FIXTURE_REF 要連 golden 兩個表一起核對。
const FIXTURE_REF = '8f228a09';
const FROM_DISK = process.env.MYTRAIN_DATA === 'disk';
// -C 指到 data 目錄：從 repo 外用符號連結借 data 跑這支時，git 一樣找得到 repo。
const readSchedule = rel => (FROM_DISK ? readJSON(rel)
  : JSON.parse(execFileSync('git', ['-C', path.join(ROOT, 'data'), 'show', `${FIXTURE_REF}:${rel}`], { maxBuffer: 256 << 20, encoding: 'utf8' })));
const SYSTEMS = ['tra_sched', 'thsr_sched', 'afr_sched'];
const RAW = {
  tra_sched: readSchedule('data/tra_schedule_dense.json'),
  thsr_sched: readSchedule('data/thsr_schedule_dense.json'),
  afr_sched: readSchedule('data/afr_schedule_dense.json'),
};
const TRACK = { tra_sched: readJSON('data/tra.json'), thsr_sched: readJSON('data/thsr_track.json'), afr_sched: readJSON('data/afr.json') };
const STN_CLASS = readJSON('data/tra_station_class.json');
const CATALOG = (() => {
  const c = vm.createContext({ window: {} });
  vm.runInContext(read('train-garage-catalog.js'), c);
  return c.window.RailGarageCatalog;
})();
const TRA_DATES = Object.keys(RAW.tra_sched.dates).sort();
product.__pinDay = TRA_DATES[1];   // 資料裡的第二天：前一天也在資料裡，才切得出跨夜借班（_prevNight）
const DAY = Object.fromEntries(SYSTEMS.map(s => [s, P.resolveScheduleDay(RAW[s])]));
// 跑時樣本：台鐵多日聯集，高鐵、林鐵當天那一份。
const SAMPLE = { tra_sched: DAY.tra_sched._denseTrains, thsr_sched: DAY.thsr_sched.trains, afr_sched: DAY.afr_sched.trains };

section('資料釘死', () => {
  check(FROM_DISK || (TRA_DATES[0] === '2026-09-18' && TRA_DATES.at(-1) === '2026-10-01'),
    `台鐵班表讀的是釘死的那一份（${FROM_DISK ? '磁碟' : FIXTURE_REF}）`, `${TRA_DATES[0]}～${TRA_DATES.at(-1)}`);
  check(DAY.tra_sched.date === TRA_DATES[1], `台鐵當天班表釘在 ${TRA_DATES[1]}`, `resolveScheduleDay 給 ${DAY.tra_sched.date}`);
  check(DAY.tra_sched._schedStale === false, '釘的日期在資料範圍內（不是退回同週幾）');
  const prevNight = DAY.tra_sched.trains.filter(tr => tr.stops._prevNight).length;
  check(prevNight >= 1, '當天班表切出了跨夜借班（排除規則才有東西可排除）', `${prevNight} 班`);
  check(SAMPLE.tra_sched === RAW.tra_sched.trains && SAMPLE.tra_sched.length > DAY.tra_sched.trains.length,
    '台鐵跑時樣本是整份多日聯集', `${SAMPLE.tra_sched.length} 班（當天 ${DAY.tra_sched.trains.length} 班）`);
});

// ── 被測的模組 ──
const PLAN_PATH = path.join(ROOT, 'my-train-plan.js');
const planCtx = vm.createContext({ console });
check(fs.existsSync(PLAN_PATH), 'my-train-plan.js 存在');
if (fs.existsSync(PLAN_PATH)) vm.runInContext(fs.readFileSync(PLAN_PATH, 'utf8'), planCtx, { filename: 'my-train-plan.js' });
const MyTrainPlan = planCtx.MyTrainPlan || {};

// ── 腳本自己的車種類別（契約 3.1 的 classOf 定義；PERF_RULES 從 index.html 抽）──
function traClassOf(tr) {
  const cn = tr.carName || '';
  for (const [re] of P.PERF_RULES) if (re.test(cn)) return re.source;
  return 'type:' + tr.typeName;
}
const classOfFor = sys => (sys === 'thsr_sched' ? () => 'hsr' : sys === 'afr_sched' ? () => 'afr' : traClassOf);
const ruleSource = word => P.PERF_RULES.find(([re]) => re.source.includes(word))[0].source;
const IDEO = String.fromCharCode(0x3000);   // 全形空白

// ═══ 車款表、名字、站鍵 ═══
// 預期的車款表逐列抄在這裡（獨立於 my-train-plan.js）：[系統, 跑時類別, 性能表那一列, 車款極速]。
// 類別與性能列用 PERF_RULES 的關鍵字指到 index.html 那一列，不抄數字：數字一律從 index.html 抽。
const APPENDIX_A = {
  dr1000: ['tra_sched', '區間', 'DR1000', 110], dr2700: ['tra_sched', '區間', '區間', 110],
  emu100: ['tra_sched', '區間', '區間', 120], emu1200: ['tra_sched', '區間', '區間', 120],
  emu500: ['tra_sched', '區間', '區間', 110], emu600: ['tra_sched', '區間', '區間', 110],
  emu700: ['tra_sched', '區間', '區間', 130], emu800: ['tra_sched', '區間', '區間', 130],
  emu800r: ['tra_sched', '區間', '區間', 130], emu900: ['tra_sched', '區間', '區間', 130],
  haifeng: ['tra_sched', '區間', '區間', 110], shanlan: ['tra_sched', '區間', '區間', 110],
  ck124: ['tra_sched', '莒光', '莒光', 85], ct273: ['tra_sched', '莒光', '莒光', 100], dt668: ['tra_sched', '莒光', '莒光', 85],
  e200: ['tra_sched', '莒光', '莒光', 110], e300: ['tra_sched', '莒光', '莒光', 110], e400: ['tra_sched', '莒光', '莒光', 110],
  r150: ['tra_sched', '莒光', '莒光', 110], r180: ['tra_sched', '莒光', '莒光', 110], r200: ['tra_sched', '莒光', '莒光', 110],
  blue: ['tra_sched', '普快', '普快', 100], dhl100: ['tra_sched', '普快', '普快', 75],
  r100: ['tra_sched', '普快', '普快', 100], r20: ['tra_sched', '普快', '普快', 100],
  temu1000: ['tra_sched', '(太', '(太', 135], temu2000: ['tra_sched', '(普', '(普', 135],
  e1000: ['tra_sched', '(PP', '(PP', 130], e500: ['tra_sched', '(PP', '(PP', 130],
  emu3000: ['tra_sched', '(3000', '(3000', 135], dr3100: ['tra_sched', '(D', '(D', 110],
  mingri: ['tra_sched', '自強', '自強', 130],
  '700t': ['thsr_sched', 'hsr', 'HSR', 300],
  dl25: ['afr_sched', 'afr', '阿里山', 45], dl38: ['afr_sched', 'afr', '阿里山', 45],
  dl39: ['afr_sched', 'afr', '阿里山', 45], dl45: ['afr_sched', 'afr', '阿里山', 45],
};
// 能開的 family；metro／tram 是捷運與輕軌；coach／forestcoach 是純客車。
const OWN_FAMILY = { railcar: 'drivable', express: 'drivable', electric: 'drivable', hood: 'drivable', forestloco: 'drivable',
  steam: 'drivable', metro: 'metro', tram: 'metro', coach: 'coach', forestcoach: 'coach' };
const CATALOG_SYS = { '台鐵': 'tra_sched', '台灣高鐵': 'thsr_sched', '阿里山林鐵': 'afr_sched' };
// 點數兌換的車款這一版還不能自己排班（車庫入口不出排班鈕），不進 MODELS 與車款表；要開放時從這裡拿掉，再補 MODELS 與車款表那一列。
const NOT_SCHEDULED = ['ct250', 'dr3000', 'emu300', 'tengyun'];
function ownRow(word) {
  if (word === 'DR1000') return P.PERF_DR1000;
  if (word === 'HSR') return P.PERF_HSR;
  return P.PERF_RULES.find(([re]) => re.source.includes(word.replace(/[()]/g, m => '\\' + m)))[1];
}
function ownCls(sys, word) {
  if (sys === 'thsr_sched') return 'hsr';
  if (sys === 'afr_sched') return 'afr';
  return P.PERF_RULES.find(([re]) => re.source.includes(word.replace(/[()]/g, m => '\\' + m)))[0].source;
}

section('車款表', () => {
  const families = [...new Set(Object.values(CATALOG).map(e => e.family))];
  const unknown = families.filter(f => !(f in OWN_FAMILY));
  check(unknown.length === 0, '車庫目錄的每一個 family 都有登記', unknown.join('、'));
  for (const f of families) check(MyTrainPlan.familyStatus(f) === OWN_FAMILY[f], `familyStatus('${f}') = ${OWN_FAMILY[f]}`, String(MyTrainPlan.familyStatus(f)));
  check(NOT_SCHEDULED.every(id => OWN_FAMILY[CATALOG[id]?.family] === 'drivable' && !(id in MyTrainPlan.MODELS)),
    '還不能自己排的兌換車款都在目錄裡、屬於能開的 family、不在 MODELS', NOT_SCHEDULED.join('、'));
  const drivable = Object.keys(CATALOG).filter(id => OWN_FAMILY[CATALOG[id].family] === 'drivable' && !NOT_SCHEDULED.includes(id)).sort();
  const models = Object.keys(MyTrainPlan.MODELS).sort();
  console.log(`   車庫目錄能開的車款：${drivable.length} 款`);
  check(JSON.stringify(models) === JSON.stringify(drivable), 'MODELS 恰好是車庫目錄裡能開的那幾款',
    `多：${models.filter(x => !drivable.includes(x)).join('、') || '無'}；少：${drivable.filter(x => !models.includes(x)).join('、') || '無'}`);
  check(JSON.stringify(Object.keys(APPENDIX_A).sort()) === JSON.stringify(drivable), '車款表涵蓋車庫目錄每一款能開的車');
  check(Object.isFrozen(MyTrainPlan.MODELS), 'MODELS 凍結');
  check(!Object.isFrozen(planCtx.MyTrainPlan), 'MyTrainPlan 本身沒有凍結（隔離腳本要包計數替身）');
  for (const id of drivable) {
    const m = MyTrainPlan.MODELS[id], [sys, clsWord, rowWord, vmax] = APPENDIX_A[id], row = ownRow(rowWord);
    const want = { a: row.a, b: row.b, v: Math.min(row.v, vmax) };
    if (row.aAlt != null) { want.aAlt = row.aAlt; want.bAlt = row.bAlt; }
    if (row.coast) want.coast = { c: row.coast.c, rho: row.coast.rho };
    const got = m && m.perf ? { ...m.perf, ...(m.perf.coast ? { coast: { ...m.perf.coast } } : {}) } : null;
    const same = got && JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort());
    check(!!m && m.sys === sys && m.sys === CATALOG_SYS[CATALOG[id].system] && m.cls === ownCls(sys, clsWord)
      && m.vmax === vmax && m.pushDown === (vmax < row.v) && same,
      `${id}：${sys}／${ownCls(sys, clsWord)}／v ${want.v}${vmax < row.v ? '（往下壓）' : ''}`, m ? JSON.stringify(m) : '沒有這一款');
  }
});

section('名字規則', () => {
  const FAMILY_EMOJI = String.fromCodePoint(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467);
  const blocked = [['', 'empty'], ['   ', 'empty'], [IDEO + IDEO, 'empty'], ['\n\t', 'empty'],
    ['一二三四五六七八九十一二三', 'too_long'],
    // 5 字上限的邊界案例(6 字各種組合都該擋)。
    ['一二三四五六', 'too_long'], ['ABCDEF', 'too_long'], ['自強ABCD', 'too_long']];
  for (const [raw, reason] of blocked) {
    const r = MyTrainPlan.validateName(raw);
    check(r.ok === false && r.reason === reason, `擋下 ${JSON.stringify(raw)}（${reason}）`, JSON.stringify(r));
  }
  const passed = [['123', '123'], ['自強520', '自強520'],
    // 家族 emoji 算 1 個字素,跟 4 個 CJK 字合計剛好 5 字(regression:確保算字數走 grapheme 不是 code point)。
    ['一二三四' + FAMILY_EMOJI, '一二三四' + FAMILY_EMOJI],
    [IDEO + ' 520' + IDEO, '520'], ['52\n0', '520'], ['5' + String.fromCharCode(0x2028) + '20', '520'],
    // 5 字上限的邊界案例(剛好 5 字，各種組合都該過)。
    ['一二三四五', '一二三四五'], ['ABCDE', 'ABCDE'], ['自強ABC', '自強ABC']];
  for (const [raw, name] of passed) {
    const r = MyTrainPlan.validateName(raw);
    check(r.ok === true && r.reason === null && r.name === name, `通過 ${JSON.stringify(raw)} → ${JSON.stringify(name)}`, JSON.stringify(r));
  }
  check(MyTrainPlan.nameLength(FAMILY_EMOJI) === 1, '家族 emoji 算一個字（Intl.Segmenter）');
  // 沒有 Intl.Segmenter 的環境：退回 code point（家族 emoji 是 5 個 code point）。
  const noSeg = vm.createContext({ Intl: {} });
  vm.runInContext(fs.readFileSync(PLAN_PATH, 'utf8'), noSeg);
  check(vm.runInContext('typeof Intl.Segmenter', noSeg) === 'undefined', '對照組沙箱裡確實沒有 Intl.Segmenter');
  check(noSeg.MyTrainPlan.nameLength(FAMILY_EMOJI) === 5 && noSeg.MyTrainPlan.nameLength('自強520') === 5,
    '沒有 Intl.Segmenter 時退回 code point', String(noSeg.MyTrainPlan.nameLength(FAMILY_EMOJI)));
  // 契約 3.1：模組內部也經由 MyTrainPlan.xxx 呼叫（計數替身要包得到）。
  const orig = MyTrainPlan.normalizeName;
  let calls = 0;
  planCtx.MyTrainPlan.normalizeName = s => { calls++; return orig(s); };
  MyTrainPlan.validateName('520');
  planCtx.MyTrainPlan.normalizeName = orig;
  check(calls === 1, 'validateName 經由 MyTrainPlan.normalizeName 呼叫（替身包得到）', `${calls} 次`);
});

section('車牌顏色色盤（只能選自己系統的色盤）', () => {
  // 色盤期望值獨立讀三個資料檔的 .types，不是拿 my-train-plan.js 的 COLOR_PALETTE 當期望值。
  const wantByFile = {
    tra_sched: readJSON('data/tra_schedule.json').types,
    thsr_sched: readJSON('data/thsr_schedule_dense.json').types,
    afr_sched: readJSON('data/afr_schedule_dense.json').types,
  };
  for (const sys of SYSTEMS) {
    const want = Object.fromEntries((wantByFile[sys] || []).map(t => [t.key, t.color]));
    const got = MyTrainPlan.COLOR_PALETTE[sys] || {};
    const wantKeys = Object.keys(want).sort(), gotKeys = Object.keys(got).sort();
    check(JSON.stringify(wantKeys) === JSON.stringify(gotKeys), `${sys} 色盤鍵集合跟資料檔 .types 一致`, JSON.stringify({ got: gotKeys, want: wantKeys }));
    for (const k of wantKeys) check(got[k] === want[k], `${sys}／${k} 顏色跟資料檔一致`, `${got[k]} ≠ ${want[k]}`);
  }
  check(JSON.stringify(Object.keys(MyTrainPlan.COLOR_PALETTE.tra_sched || {})) === JSON.stringify(['自強', '莒光/復興', '區間車', '區間快', '其他']),
    'TRA 色盤鍵序＝表單色鈕由左到右的顯示順序（自強／莒光‧復興／區間車／區間快／其他）',
    JSON.stringify(Object.keys(MyTrainPlan.COLOR_PALETTE.tra_sched || {})));

  // 車款預設色：37 款逐一列出期望值（逐一寫死，不是從 cls 反推）。
  const DEFAULT_COLOR_EXPECT = {
    '#2E6FB0': ['dr1000', 'dr2700', 'emu100', 'emu1200', 'emu500', 'emu600', 'emu700', 'emu800', 'emu800r', 'emu900', 'haifeng', 'shanlan'],
    '#E8792B': ['ck124', 'ct273', 'dt668', 'e200', 'e300', 'e400', 'r150', 'r180', 'r200'],
    '#8E44AD': ['blue', 'dhl100', 'r100', 'r20'],
    '#C0392B': ['temu1000', 'temu2000', 'e1000', 'e500', 'emu3000', 'dr3100', 'mingri'],
    '#E85D0D': ['700t'],
    '#B03A2E': ['dl25', 'dl38', 'dl39', 'dl45'],
  };
  const tDefault = tally(['預設色跟預期色表一致']);
  let total = 0;
  for (const [hex, ids] of Object.entries(DEFAULT_COLOR_EXPECT)) {
    for (const id of ids) {
      total++;
      tDefault.expect('預設色跟預期色表一致', MyTrainPlan.defaultColor(id) === hex, `${id}：${MyTrainPlan.defaultColor(id)} ≠ ${hex}`, 37);
    }
  }
  check(total === Object.keys(MyTrainPlan.MODELS).length, '預期色表覆蓋全部車款（37 款）', `${total}／${Object.keys(MyTrainPlan.MODELS).length}`);
  tDefault.report();

  // normalizeColor：合法值（含小寫）轉成色盤原文寫法；別系統的顏色／亂填／undefined／null／型別不對／
  // 舊紀錄沒這欄，一律退回這台車的預設色，不是原樣收下。
  check(MyTrainPlan.normalizeColor('emu800', '#2E6FB0') === '#2E6FB0', '合法值原樣通過');
  check(MyTrainPlan.normalizeColor('emu800', '#2e6fb0') === '#2E6FB0', '小寫合法值轉成色盤原文寫法（大小寫不拘）');
  check(MyTrainPlan.normalizeColor('emu800', '#E85D0D') === MyTrainPlan.defaultColor('emu800'), '別系統的顏色（高鐵橘）不合法→退回預設色');
  check(MyTrainPlan.normalizeColor('emu800', '#ff2bd6') === MyTrainPlan.defaultColor('emu800'), '亂填的顏色（舊版螢光色）→退回預設色');
  check(MyTrainPlan.normalizeColor('emu800', undefined) === MyTrainPlan.defaultColor('emu800'), '沒有 color 欄（舊紀錄）→退回預設色');
  check(MyTrainPlan.normalizeColor('emu800', null) === MyTrainPlan.defaultColor('emu800'), 'null→退回預設色');
  check(MyTrainPlan.normalizeColor('emu800', 123) === MyTrainPlan.defaultColor('emu800'), '型別不對（數字）→退回預設色');
  check(MyTrainPlan.normalizeColor('nope', '#2E6FB0') === null, '車款不存在→null（跟 defaultColor 對稱）');
  check(MyTrainPlan.defaultColor('nope') === null, 'defaultColor 車款不存在→null');
});

section('站鍵（跟 railcore PhysicalJs.stationKey／網頁 rail-3d/physical/timing.js 同語意）', () => {
  // 廣泛回歸：三個系統、班表＋軌道資料裡出現過的所有站名，逐一跟借來的 timing.js stationKey 比對
  // （不是跟 index.html 的 traStnKey 比——那支是給 stnInfoMap 查站碼用的另一個函式，語意故意不同：
  // 只認半形括號、括號只去結尾、不去「-環島」、只有台鐵系統才換臺→台）。
  const names = { tra_sched: new Set(), thsr_sched: new Set(), afr_sched: new Set() };
  for (const sys of SYSTEMS) {
    for (const ln of TRACK[sys].lines) for (const st of ln.stations) names[sys].add(st.name);
    for (const tr of RAW[sys].trains) for (const st of tr.stops) names[sys].add(st.name);
  }
  let total = 0;
  for (const sys of SYSTEMS) {
    const bad = [...names[sys]].filter(n => MyTrainPlan.stationKey(sys, n) !== P.stationKey(sys, n));
    total += names[sys].size;
    check(names[sys].size > 0 && bad.length === 0, `${sys} 站鍵跟 rail-3d/physical/timing.js 的 stationKey 逐字相同（${names[sys].size} 個站名）`,
      bad.slice(0, 5).map(n => `${n}：實作 ${MyTrainPlan.stationKey(sys, n)}／真值 ${P.stationKey(sys, n)}`).join('；'));
  }
  check(total > 200, '三個系統合計掃過的站名夠多，不是空集合矇混過去', String(total));

  // 邊界案例：逐一跟借來的 stationKey（不是呼叫 MyTrainPlan.stationKey）比對。
  const STATIONKEY_CASES = [
    ['tra_sched', '臺北'], ['tra_sched', '臺北-環島'],
    ['tra_sched', '新城 (太魯閣)'], ['tra_sched', '左營(舊城)'], ['tra_sched', '左營（舊城）'],
    ['tra_sched', '甲(乙)丙'],                                // 括號在字串中間
    ['tra_sched', '甲(乙\n丙)丁(戊)'],                         // 括號內含換行：第一個開頭配不到，找下一個
    ['tra_sched', IDEO + ' 臺北 ' + IDEO],                     // 前後空白含 U+3000
    ['thsr_sched', '臺北'], ['afr_sched', '臺北'],             // 非台鐵系統的「臺」也要換成「台」
  ];
  for (const [sys, name] of STATIONKEY_CASES) {
    const got = MyTrainPlan.stationKey(sys, name), want = P.stationKey(sys, name);
    check(got === want, `stationKey(${sys}, ${JSON.stringify(name)})`, `實作 ${JSON.stringify(got)}／真值 ${JSON.stringify(want)}`);
  }
  // 具名斷言幾個看得懂的結果，不是只比對得上：
  check(MyTrainPlan.stationKey('tra_sched', '臺北') === 'tra_sched:台北', 'sys 前綴＋臺→台', MyTrainPlan.stationKey('tra_sched', '臺北'));
  check(MyTrainPlan.stationKey('tra_sched', '臺北-環島') === MyTrainPlan.stationKey('tra_sched', '臺北'), '「臺北-環島」跟「臺北」是同一把鍵');
  check(MyTrainPlan.stationKey('tra_sched', '新城 (太魯閣)') === 'tra_sched:新城', '半形括號（含前導空白）整段去掉');
  check(MyTrainPlan.stationKey('tra_sched', '左營（舊城）') === 'tra_sched:左營', '全形括號也去掉');
  check(MyTrainPlan.stationKey('thsr_sched', '臺北') === 'thsr_sched:台北' && MyTrainPlan.stationKey('afr_sched', '臺北') === 'afr_sched:台北',
    '高鐵、林鐵一樣換臺→台（不是只有台鐵，不分系統）');
});

// ═══ 站點圖、最短路徑、山線／海線 ═══
// 腳本自己的站點圖：Floyd–Warshall（實作用 Dijkstra，演算法不同源）。站鍵借 rail-3d/physical/timing.js
// 真正的 stationKey（三個系統同語意），不是 index.html 的 traStnKey——那支是給 stnInfoMap
// 查站碼用的另一個函式，故意不去「-環島」（見下面「站鍵」段落的說明）。
const ownKey = (sys, name) => P.stationKey(sys, name);
function ownGraph(sys, bannedLine = null) {
  const keys = [], idx = new Map(), lineOf = new Map(), lineIdx = new Map(), edges = [];
  for (const ln of TRACK[sys].lines) {
    const sts = (ln.stations || []).filter(st => st && st.name != null && Number.isFinite(st.d));
    const pos = new Map();
    sts.forEach((st, i) => {
      const k = ownKey(sys, st.name);
      if (!idx.has(k)) { idx.set(k, keys.length); keys.push(k); lineOf.set(k, new Set()); }
      lineOf.get(k).add(ln.id);
      pos.set(k, { i, d: st.d });
      if (i > 0 && ln.id !== bannedLine) edges.push([ownKey(sys, sts[i - 1].name), k, Math.abs(st.d - sts[i - 1].d)]);
    });
    lineIdx.set(ln.id, pos);
  }
  const n = keys.length, D = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) D[i][i] = 0;
  for (const [a, b, km] of edges) {
    const i = idx.get(a), j = idx.get(b);
    if (i !== j && km < D[i][j]) { D[i][j] = km; D[j][i] = km; }
  }
  for (let k = 0; k < n; k++) {
    const Dk = D[k];
    for (let i = 0; i < n; i++) {
      const Dik = D[i][k];
      if (Dik === Infinity) continue;
      const Di = D[i];
      for (let j = 0; j < n; j++) { const v = Dik + Dk[j]; if (v < Di[j]) Di[j] = v; }
    }
  }
  const dist = (a, b) => (idx.has(a) && idx.has(b) ? D[idx.get(a)][idx.get(b)] : null);
  return { keys, lineOf, lineIdx, dist };
}
const OWN = Object.fromEntries(SYSTEMS.map(s => [s, ownGraph(s)]));
const OWN_VIA = { mountain: ownGraph('tra_sched', '海線'), coast: ownGraph('tra_sched', '山線') };
const onLine = (sys, lineId, key) => OWN[sys].lineIdx.get(lineId) && OWN[sys].lineIdx.get(lineId).has(key);
// 真車在同一條線上相鄰兩站的最大距離（「不能跳站」）：班表相鄰兩筆、在某條線上也相鄰，就記那條線的站距。
const MAX_REAL_GAP = new Map();
for (const sys of SYSTEMS) for (const tr of SAMPLE[sys]) {
  const s = tr.stops;
  for (let i = 0; i + 1 < s.length; i++) {
    const a = ownKey(sys, s[i].name), b = ownKey(sys, s[i + 1].name);
    for (const [lineId, pos] of OWN[sys].lineIdx) {
      const pa = pos.get(a), pb = pos.get(b);
      if (pa && pb && Math.abs(pa.i - pb.i) === 1) {
        const k = sys + '|' + lineId, gap = Math.abs(pa.d - pb.d);
        if (!(MAX_REAL_GAP.get(k) >= gap)) MAX_REAL_GAP.set(k, gap);
      }
    }
  }
}
const GRAPH = {};   // 實作的站點圖，站點圖那一段建好之後給後面的段落用
const K = (sys, name) => ownKey(sys, name);

section('站點圖與最短路徑', () => {
  for (const sys of SYSTEMS) {
    GRAPH[sys] = MyTrainPlan.buildGraph(TRACK[sys].lines, sys);
    const keys = [...GRAPH[sys].nodes.keys()].sort();
    check(JSON.stringify(keys) === JSON.stringify([...OWN[sys].keys].sort()), `${sys} 站點圖的站鍵跟腳本自己建的一致（${keys.length} 站）`);
  }
  let threw = false;
  try { MyTrainPlan.buildGraph(TRACK.tra_sched.lines, 'krtc'); } catch { threw = true; }
  check(threw, 'buildGraph 不認得的系統會丟錯');
  const g = GRAPH.tra_sched;
  const r0 = MyTrainPlan.findRoute(g, '不存在站', K('tra_sched', '臺北'), {});
  check(r0.ok === false && r0.reason === 'unknown_station', '起站不存在 → unknown_station', JSON.stringify(r0));
  const r1 = MyTrainPlan.findRoute(g, K('tra_sched', '臺北'), K('tra_sched', '臺北'), {});
  check(r1.ok === false && r1.reason === 'same', '起訖相同 → same', JSON.stringify(r1));
  const island = MyTrainPlan.buildGraph([
    { id: 'A', stations: [{ name: '甲', lat: 0, lon: 0, d: 0 }, { name: '乙', lat: 0, lon: 0, d: 1 }] },
    { id: 'B', stations: [{ name: '丙', lat: 0, lon: 0, d: 0 }, { name: '丁', lat: 0, lon: 0, d: 2 }] },
  ], 'afr_sched');
  const r2 = MyTrainPlan.findRoute(island, K('afr_sched', '甲'), K('afr_sched', '丙'), {});
  check(r2.ok === false && r2.reason === 'no_path', '兩站之間沒有路 → no_path', JSON.stringify(r2));
  const r3 = MyTrainPlan.findRoute(island, K('afr_sched', '甲'), K('afr_sched', '乙'), {});
  check(r3.ok === true && r3.stops.length === 2 && r3.km === 1, '對照組：同一條線上的兩站找得到路', JSON.stringify(r3));
});

// 前兩組有切換，後四組沒有。
const VIA_CASES = [['臺北', '高雄', true], ['竹南', '彰化', true], ['臺北', '臺中', false], ['苗栗', '彰化', false],
  ['新竹', '大甲', false], ['臺北', '花蓮', false]];
section('山線／海線', () => {
  const g = GRAPH.tra_sched, T = 'tra_sched';
  const mountainOnly = new Set([...OWN[T].lineIdx.get('山線').keys()].filter(k => !onLine(T, '海線', k)));
  const coastOnly = new Set([...OWN[T].lineIdx.get('海線').keys()].filter(k => !onLine(T, '山線', k)));
  check(mountainOnly.size > 5 && coastOnly.size > 5, '山線、海線各有自己的站', `${mountainOnly.size}／${coastOnly.size}`);
  for (const [a, b, choice] of VIA_CASES) {
    const dflt = MyTrainPlan.findRoute(g, K(T, a), K(T, b), { via: null });
    const coast = MyTrainPlan.findRoute(g, K(T, a), K(T, b), { via: 'coast' });
    check(dflt.ok && dflt.viaChoice === choice, `${a}→${b} ${choice ? '有' : '沒有'}山海線切換`, JSON.stringify({ viaChoice: dflt.viaChoice }));
    if (choice) {
      const mid = r => r.stops.slice(1, -1).map(s => s.key);
      check(dflt.via === 'mountain' && mid(dflt).some(k => mountainOnly.has(k)) && !mid(dflt).some(k => coastOnly.has(k)),
        `${a}→${b} 預設走山線`, dflt.via);
      check(coast.via === 'coast' && mid(coast).some(k => coastOnly.has(k)) && !mid(coast).some(k => mountainOnly.has(k)),
        `${a}→${b} 選海線就走海線`, coast.via);
      check(Math.abs(dflt.km - OWN_VIA.mountain.dist(K(T, a), K(T, b))) < 1e-6
        && Math.abs(coast.km - OWN_VIA.coast.dist(K(T, a), K(T, b))) < 1e-6, `${a}→${b} 山線、海線里程跟腳本自己算的一致`,
        `${dflt.km.toFixed(1)}／${coast.km.toFixed(1)} km`);
    } else {
      check(dflt.via === null && coast.via === null, `${a}→${b} via 一律 null（傳 coast 也一樣）`, `${dflt.via}／${coast.via}`);
      check(Math.abs(dflt.km - OWN[T].dist(K(T, a), K(T, b))) < 1e-6, `${a}→${b} 里程是最短路徑`, `${dflt.km.toFixed(1)} km`);
    }
  }
});

// 順行／逆行：環島那一圈上的兩站，繞島兩個方向都到得了。
// 期望值來源：一圈的長度用腳本自己的 Floyd–Warshall 圖拆三段加總（臺北→高雄走山線／海線、高雄→臺東、臺東→臺北，
// 三段各自都是那一段的最短路），不碰實作的 Dijkstra；「順行是哪一邊」用地理事實（台鐵順行＝逆時針：
// 西部南下、東部北上，所以臺北往臺東的順行要經過高雄）。
section('順行／逆行', () => {
  const g = GRAPH.tra_sched, T = 'tra_sched', k = n => K(T, n);
  const arc = OWN[T].dist(k('高雄'), k('臺東')) + OWN[T].dist(k('臺東'), k('臺北'));
  const LOOP = { mountain: OWN_VIA.mountain.dist(k('臺北'), k('高雄')) + arc, coast: OWN_VIA.coast.dist(k('臺北'), k('高雄')) + arc };
  check(LOOP.mountain > 800 && LOOP.mountain < 950 && LOOP.coast > LOOP.mountain, '環島一圈的長度（腳本自己算）',
    `山線 ${LOOP.mountain.toFixed(1)}／海線 ${LOOP.coast.toFixed(1)} km`);
  const has = (r, n) => r.stops.some(s => s.name === n);
  const zh = d => (d === 'shun' ? '順行' : '逆行');
  const GEO = [   // [起, 訖, 預設方向, 預設要經過, 預設不經過, 另一邊, 另一邊要經過, 另一邊不經過]
    ['臺北', '臺東', 'ni', ['宜蘭', '花蓮'], ['高雄'], 'shun', ['新竹', '高雄', '枋寮'], ['宜蘭', '花蓮']],
    ['高雄', '花蓮', 'shun', ['枋寮', '臺東'], ['臺北'], 'ni', ['彰化', '臺北', '宜蘭'], ['臺東']],
    ['臺北', '新竹', 'shun', [], ['宜蘭'], 'ni', ['宜蘭', '花蓮', '臺東', '高雄'], []],
    ['基隆', '宜蘭', 'ni', ['八堵'], ['臺北'], 'shun', ['八堵', '臺北', '高雄', '臺東'], []],
  ];
  for (const [a, b, dflt, dIn, dOut, alt, aIn, aOut] of GEO) {
    const r0 = MyTrainPlan.findRoute(g, k(a), k(b), {}), r1 = MyTrainPlan.findRoute(g, k(a), k(b), { dir: alt });
    check(r0.ok && r0.dirChoice && r0.dir === dflt && dIn.every(n => has(r0, n)) && !dOut.some(n => has(r0, n)),
      `${a}→${b} 預設走最短那邊＝${zh(dflt)}（經 ${dIn.join('、') || '—'}，不經 ${dOut.join('、')}）`, `${r0.dir} ${r0.km && r0.km.toFixed(1)} km`);
    check(r0.ok && Math.abs(r0.km - OWN[T].dist(k(a), k(b))) < 1e-6, `${a}→${b} 預設里程＝最短路徑`, `${r0.km && r0.km.toFixed(1)} km`);
    check(r1.ok && r1.dirChoice && r1.dir === alt && aIn.every(n => has(r1, n)) && !aOut.some(n => has(r1, n)),
      `${a}→${b} 選${zh(alt)}就繞另一邊（經 ${aIn.join('、')}）`, `${r1.dir} ${r1.km && r1.km.toFixed(1)} km`);
    const same = MyTrainPlan.findRoute(g, k(a), k(b), { dir: dflt });
    check(same.ok && same.km === r0.km && same.dir === dflt, `${a}→${b} 明講${zh(dflt)}＝不講（預設）`);
  }
  const bad = MyTrainPlan.findRoute(g, k('臺北'), k('臺東'), { dir: 'east' });
  check(bad.ok && bad.dir === 'ni' && Math.abs(bad.km - OWN[T].dist(k('臺北'), k('臺東'))) < 1e-6, '不認得的 dir → 當沒講，走最短那邊', `${bad.dir}`);

  // 兩端都在環上（不在支線、盡頭段、山海線中間）的站：兩個方向的里程加起來＝一圈。
  const RING = ['臺北', '松山', '七堵', '八堵', '瑞芳', '宜蘭', '和平', '花蓮', '玉里', '臺東', '大武', '枋寮', '屏東', '高雄', '臺南',
    '嘉義', '彰化', '竹南', '新竹', '桃園'];
  const t = tally(['兩端都在環上 → 有順行／逆行可選', '預設＝最短那邊', '選了方向，回傳的 dir 就是那個方向',
    '兩個方向的里程加起來＝一圈（山線）', '另一邊不比預設短', '有山海線可選的那一邊選海線：加上另一邊＝一圈（海線）']);
  for (const a of RING) for (const b of RING) {
    if (a === b) continue;
    const tag = `${a}→${b}`, r0 = MyTrainPlan.findRoute(g, k(a), k(b), {});
    t.expect('兩端都在環上 → 有順行／逆行可選', r0.ok && r0.dirChoice, tag, RING.length * (RING.length - 1));
    if (!r0.ok || !r0.dirChoice) continue;
    const alt = r0.dir === 'shun' ? 'ni' : 'shun', r1 = MyTrainPlan.findRoute(g, k(a), k(b), { dir: alt });
    t.expect('預設＝最短那邊', Math.abs(r0.km - OWN[T].dist(k(a), k(b))) < 1e-6, `${tag} ${r0.km.toFixed(1)}`);
    t.expect('選了方向，回傳的 dir 就是那個方向', r1.ok && r1.dir === alt, `${tag} ${r1.dir}`);
    if (!r1.ok) continue;
    t.expect('兩個方向的里程加起來＝一圈（山線）', Math.abs(r0.km + r1.km - LOOP.mountain) < 1e-6, `${tag} ${r0.km.toFixed(1)}+${r1.km.toFixed(1)}`);
    t.expect('另一邊不比預設短', r1.km >= r0.km - 1e-9, tag);
    for (const [r, other] of [[r0, r1], [r1, r0]]) if (r.viaChoice) {
      const c = MyTrainPlan.findRoute(g, k(a), k(b), { dir: r.dir, via: 'coast' });
      t.expect('有山海線可選的那一邊選海線：加上另一邊＝一圈（海線）', c.ok && c.dir === r.dir && c.via === 'coast'
        && Math.abs(c.km + other.km - LOOP.coast) < 1e-6, `${tag} ${r.dir}`, 20);
    }
  }
  t.report();

  for (const [a, b, why] of [['十分', '菁桐', '兩端都在支線上'], ['內灣', '六家', '兩條支線接在同一個地方'],
    ['臺中', '大甲', '最短路經成追線，中途換方向']]) {
    const [r0, r1, r2] = [{}, { dir: 'shun' }, { dir: 'ni' }].map(o => MyTrainPlan.findRoute(g, k(a), k(b), o));
    check(r0.ok && !r0.dirChoice && r0.dir === null && [r1, r2].every(r => r.ok && r.dir === null && r.km === r0.km),
      `${a}→${b} 沒有順行／逆行可選（${why}），傳 dir 也一樣`, JSON.stringify([r0, r1, r2].map(r => [r.dir, r.km && r.km.toFixed(1)])));
  }
  // 剛好繞半圈的站：臺北到加祿兩邊只差不到 1 公里。選順行＋海線要照樣走西部海線，不能掉頭走東部。
  const jl = MyTrainPlan.findRoute(g, k('臺北'), k('加祿'), { dir: 'shun', via: 'coast' });
  check(jl.ok && jl.dir === 'shun' && jl.via === 'coast' && has(jl, '大甲') && !has(jl, '花蓮'), '臺北→加祿選順行＋海線：走西部海線，沒有掉頭走東部',
    `${jl.dir}／${jl.via}`);
  const tm = MyTrainPlan.findRoute(g, k('臺中'), k('苗栗'), { dir: 'shun', via: 'coast' });
  check(tm.ok && tm.dir === 'shun' && !tm.viaChoice && tm.via === null && has(tm, '高雄') && has(tm, '竹南'),
    '臺中→苗栗選順行：繞一圈從竹南回山線，只走得了山線，不給山海線選（傳海線也照走）', `${tm.dir}／${tm.viaChoice}`);
  const zc = MyTrainPlan.findRoute(g, k('竹南'), k('彰化'), { dir: 'ni' });
  check(zc.ok && zc.dir === 'ni' && !zc.viaChoice && has(zc, '臺北') && has(zc, '臺東'),
    '竹南→彰化選逆行（繞一圈）：兩端都經過但沒走到山線海線，不給山海線選', `${zc.dir}／${zc.viaChoice}`);
  const hsr = MyTrainPlan.findRoute(GRAPH.thsr_sched, K('thsr_sched', '南港'), K('thsr_sched', '左營'), { dir: 'ni' });
  check(hsr.ok && !hsr.dirChoice && hsr.dir === null, '高鐵沒有順行／逆行（只有台鐵環島有）');
});

section('停站表的欄位與不跳站', () => {
  const cases = [['tra_sched', '基隆', '枋寮'], ['tra_sched', '臺北', '菁桐'], ['tra_sched', '臺北', '花蓮'], ['tra_sched', '竹南', '彰化'],
    ['tra_sched', '臺北', '臺東', 'shun'], ['tra_sched', '基隆', '宜蘭', 'shun'], ['tra_sched', '臺北', '松山', 'shun'],
    ['thsr_sched', '南港', '左營'], ['afr_sched', '嘉義', '阿里山'], ['afr_sched', '阿里山', '祝山']];
  const t = tally(['找得到路', '第一站 km 0、最後一站 km＝全程', '起訖站鍵對得上', '站名不帶括號註記、有座標',
    '相鄰兩站在同一條線上也相鄰（不跳站）', '相鄰兩站的里程差等於那條線的 d 差', '站距不超過真車在同一條線上相鄰兩站的最大距離']);
  let fallback = 0;
  for (const [sys, a, b, dir] of cases) for (const via of [null, 'coast']) {
    const r = MyTrainPlan.findRoute(GRAPH[sys], K(sys, a), K(sys, b), { via, dir });
    const tag = `${a}→${b}${dir === 'shun' ? '（順行）' : ''}${via ? '（海線）' : ''}`;
    t.expect('找得到路', r.ok, tag, cases.length * 2);
    if (!r.ok) continue;
    t.expect('第一站 km 0、最後一站 km＝全程', r.stops[0].km === 0 && Math.abs(r.stops.at(-1).km - r.km) < 1e-9, tag);
    t.expect('起訖站鍵對得上', r.stops[0].key === K(sys, a) && r.stops.at(-1).key === K(sys, b), tag);
    for (let i = 0; i < r.stops.length; i++) {
      const s = r.stops[i];
      t.expect('站名不帶括號註記、有座標', !/[()（）]/.test(s.name) && Number.isFinite(s.lat) && Number.isFinite(s.lon), `${tag} ${s.name}`);
      if (i === 0) continue;
      const p = r.stops[i - 1], pa = OWN[sys].lineIdx.get(s.line), gap = s.km - p.km;
      const adjacent = pa && pa.has(p.key) && pa.has(s.key) && Math.abs(pa.get(p.key).i - pa.get(s.key).i) === 1;
      t.expect('相鄰兩站在同一條線上也相鄰（不跳站）', adjacent, `${tag} ${p.name}→${s.name} ${s.line}`);
      t.expect('相鄰兩站的里程差等於那條線的 d 差', adjacent && Math.abs(gap - Math.abs(pa.get(s.key).d - pa.get(p.key).d)) < 1e-9, `${tag} ${p.name}→${s.name}`);
      const cap = MAX_REAL_GAP.get(sys + '|' + s.line);
      if (cap == null) { fallback++; continue; }
      t.expect('站距不超過真車在同一條線上相鄰兩站的最大距離', gap <= cap + 1e-9, `${tag} ${p.name}→${s.name} ${gap.toFixed(2)} > ${cap.toFixed(2)}`);
    }
  }
  t.report();
  console.log(`   真車沒跑過、沒有站距上限可比的區間：${fallback} 段（只列出，不當通過證據）`);
  const r = MyTrainPlan.findRoute(GRAPH.tra_sched, K('tra_sched', '臺北'), K('tra_sched', '花蓮'), {});
  check(r.ok && r.stops.some(s => s.name === '新城'), '臺北→花蓮經過「新城」（軌道資料的「新城 (太魯閣)」去掉括號）');
});

// ═══ 站等與停站方式 ═══
// 腳本自己算站等（不呼叫 MyTrainPlan.stationTiers）。
const OWN_CLS_TIER = { '特等': 0, '一等': 1, '二等': 2, '三等': 3 };
function ownTiers(sys, trains, classMap) {
  const table = new Map();
  if (sys === 'tra_sched') for (const [k, v] of Object.entries(classMap || {})) {
    const nk = k.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
    if (!table.has(nk)) table.set(nk, v);
  }
  const count = new Map(), names = new Set();
  for (const tr of trains) {
    for (const s of tr.stops) names.add(s.name);
    if (tr.loop || tr.est || tr.stops._prevNight) continue;
    for (const s of tr.stops) if (s.stop !== false) count.set(s.name, (count.get(s.name) || 0) + 1);
  }
  const out = new Map();
  for (const name of names) {
    const variants = [name, name.replace(/台/g, '臺'), name.replace(/臺/g, '台')];
    const c = sys === 'tra_sched' ? variants.map(v => table.get(v)).find(Boolean) : undefined;
    if (c) { out.set(name, c in OWN_CLS_TIER ? OWN_CLS_TIER[c] : 4); continue; }
    const n = count.get(name) || 0;
    out.set(name, n >= 200 ? 1 : n >= 90 ? 2 : n >= 30 ? 3 : 4);
  }
  return out;
}
const OWN_TIERS = Object.fromEntries(SYSTEMS.map(s => [s, ownTiers(s, DAY[s].trains, STN_CLASS)]));
const TIERS = {};   // 實作算的站等，給後面的段落用

section('站等', () => {
  for (const sys of SYSTEMS) {
    TIERS[sys] = MyTrainPlan.stationTiers(sys, DAY[sys].trains, STN_CLASS);
    const own = OWN_TIERS[sys], diff = [];
    for (const [name, tier] of own) if (TIERS[sys].get(name) !== tier) diff.push(`${name} 腳本 ${tier}／實作 ${TIERS[sys].get(name)}`);
    for (const name of TIERS[sys].keys()) if (!own.has(name)) diff.push(`${name} 腳本沒有`);
    check(own.size > 0 && diff.length === 0, `${sys} 站等跟腳本自己算的逐站相同（${own.size} 站）`, diff.slice(0, 5).join('、'));
  }
  check(OWN_TIERS.tra_sched.get('新城') === 2, '新城是二等（站等表的「新城 (太魯閣)」去括號後對得到）', String(OWN_TIERS.tra_sched.get('新城')));
  const guessed = [...OWN_TIERS.tra_sched].filter(([n, t]) => t <= 2
    && ![n, n.replace(/台/g, '臺'), n.replace(/臺/g, '台')].some(v => Object.keys(STN_CLASS).some(k => k.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim() === v)));
  console.log(`   不在站等表、靠停靠班次算成二等以上的台鐵站：${guessed.map(([n]) => n).join('、') || '無'}`);
  // 合成資料：只看規則，不看今天的班表。
  const mk = (n, name, extra = {}, stopsProp = null) => Array.from({ length: n }, () => {
    const stops = [{ name, stop: true }];
    if (stopsProp) stops[stopsProp] = true;
    return { ...extra, stops };
  });
  const syn = (trains, map) => MyTrainPlan.stationTiers('tra_sched', trains, map);
  check(syn(mk(200, '測站'), {}).get('測站') === 1, '對照組：200 班停靠 → 一等');
  check(syn(mk(90, '測站'), {}).get('測站') === 2 && syn(mk(30, '測站'), {}).get('測站') === 3 && syn(mk(29, '測站'), {}).get('測站') === 4,
    '停靠班次門檻 90／30');
  check(syn(mk(200, '測站', { loop: true }), {}).get('測站') === 4, '環島車（loop）不算班次');
  check(syn(mk(200, '測站', { est: true }), {}).get('測站') === 4, '推估班（est）不算班次');
  check(syn(mk(200, '測站', {}, '_prevNight'), {}).get('測站') === 4, '跨夜借班（stops._prevNight）不算班次');
  check(syn([{ stops: [{ name: '測站', stop: false }] }].concat(mk(29, '測站')), {}).get('測站') === 4, '通過（stop:false）不算班次');
  const map = { '甲站 (註)': '一等', '乙站（全形註）': '二等', '臺東': '特等', '丁站': '簡易站' };
  const tiers = syn([...mk(1, '甲站'), ...mk(1, '乙站'), ...mk(1, '台東'), ...mk(1, '丁站')], map);
  check(tiers.get('甲站') === 1 && tiers.get('乙站') === 2, '站等表的鍵去掉半形、全形括號註記');
  check(tiers.get('台東') === 0, '站名台／臺兩種寫法都試');
  check(tiers.get('丁站') === 4, '其他等級算 4');
  check(MyTrainPlan.stationTiers('thsr_sched', mk(1, '臺東'), map).get('臺東') === 4, '高鐵不查台鐵站等表');
});

section('停站方式', () => {
  const T = 'tra_sched', r = MyTrainPlan.findRoute(GRAPH[T], K(T, '臺北'), K(T, '花蓮'), {});
  const all = MyTrainPlan.applyPattern(r.stops, 'all', TIERS[T], T);
  const major = MyTrainPlan.applyPattern(r.stops, 'major', TIERS[T], T);
  const express = MyTrainPlan.applyPattern(r.stops, 'express', TIERS[T], T);
  check(all.length === r.stops.length && major.length === r.stops.length && express.length === r.stops.length, '站一律不刪，只改停／通過');
  check(all.every(s => s.stop === true), '站站停：每一站都停');
  check(express.every((s, i) => s.stop === (i === 0 || i === express.length - 1)), '直達：只停起訖兩站');
  const want = r.stops.map((s, i) => i === 0 || i === r.stops.length - 1 || (OWN_TIERS[T].get(s.name) ?? 4) <= 2);
  check(major.every((s, i) => s.stop === want[i]), '只停大站：恰好是腳本算的站等 ≤ 2 加起訖站',
    major.filter((s, i) => s.stop !== want[i]).map(s => s.name).join('、'));
  check(major.find(s => s.name === '新城').stop === true, '臺北→花蓮只停大站有停新城');
  check(major.some(s => !s.stop) && major.some((s, i) => s.stop && i > 0 && i < major.length - 1), '對照組：只停大站有停也有過');
  check(r.stops.every(s => !('stop' in s)), '不改動傳進去的站');
  let threwAfr = false, threwBad = false;
  const ar = MyTrainPlan.findRoute(GRAPH.afr_sched, K('afr_sched', '嘉義'), K('afr_sched', '阿里山'), {});
  try { MyTrainPlan.applyPattern(ar.stops, 'major', TIERS.afr_sched, 'afr_sched'); } catch { threwAfr = true; }
  try { MyTrainPlan.applyPattern(r.stops, 'fast', TIERS[T], T); } catch { threwBad = true; }
  check(threwAfr, '林鐵沒有只停大站（丟錯）');
  check(threwBad, '不認得的停站方式丟錯');
  const hr = MyTrainPlan.findRoute(GRAPH.thsr_sched, K('thsr_sched', '南港'), K('thsr_sched', '左營'), {});
  const hmajor = MyTrainPlan.applyPattern(hr.stops, 'major', TIERS.thsr_sched, 'thsr_sched');
  console.log(`   高鐵只停大站跳過：${hmajor.filter(s => !s.stop).map(s => s.name).join('、') || '無'}（預期苗栗、彰化、雲林；只列出）`);
});

// ═══ 跑時統計、退路、停車時間、物理下限 ═══
// 腳本自己從班表重算每一組：同一套排除規則、同一把里程尺（腳本自己的站點圖）、同樣五個長度桶。
const OWN_BUCKETS = ['0-5', '5-10', '10-20', '20-40', '40+'];
const ownBucket = km => (km < 5 ? 0 : km < 10 ? 1 : km < 20 ? 2 : km < 40 ? 3 : 4);
const ownMedian = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// 台鐵的別名站（臺北-環島）用 index.html 的 canonicalizeAliasTrains 在複本上併好再量；原資料不動。
function aliasCanonicalClone(trains) {
  const clone = trains.map(tr => ({ ...tr, stops: Object.assign(tr.stops.map(s => ({ ...s })), { _prevNight: tr.stops._prevNight }) }));
  P.canonicalizeAliasTrains(clone);
  return clone;
}
function ownStats(sys, trains) {
  const classOf = classOfFor(sys), og = OWN[sys], speeds = new Map(), dwells = new Map();
  const push = (map, c, b, v) => {
    if (!map.has(c)) map.set(c, new Map());
    const m = map.get(c);
    if (!m.has(b)) m.set(b, []);
    m.get(b).push(v);
  };
  for (const tr of trains) {
    if (tr.loop || tr.est || tr.stops._prevNight) continue;
    const s = tr.stops, c = classOf(tr), stopIdx = [];
    s.forEach((x, i) => { if (x.stop !== false) stopIdx.push(i); });
    for (let k = 0; k + 1 < stopIdx.length; k++) {
      const i = stopIdx[k], j = stopIdx[k + 1];
      const sec = s[j].arrSec - (s[i].dep0 != null ? s[i].dep0 : s[i].depSec);
      if (!(sec > 0)) continue;
      let km = 0;
      for (let q = i; q < j; q++) {
        const d = og.dist(ownKey(sys, s[q].name), ownKey(sys, s[q + 1].name));
        if (d == null || d === Infinity) { km = null; break; }
        km += d;
      }
      if (!(km > 0)) continue;
      const v = km / (sec / 3600), b = OWN_BUCKETS[ownBucket(km)];
      push(speeds, c, b, v); push(speeds, '*', b, v); push(speeds, '*', '*', v);
    }
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i].stop === false) continue;
      const d = (s[i].dep0 != null ? s[i].dep0 : s[i].depSec) - s[i].arrSec;
      if (d >= 0) { push(dwells, c, '*', d); push(dwells, '*', '*', d); }
    }
  }
  const memo = new Map();   // 中位數每組只排序一次
  const group = (map, c, b) => {
    const a = map.get(c) && map.get(c).get(b);
    if (!a) return { n: 0, v: null };
    if (!memo.has(a)) memo.set(a, { n: a.length, v: ownMedian(a) });
    return memo.get(a);
  };
  return {
    speed: (c, b) => group(speeds, c, b),
    dwell: c => group(dwells, c, '*'),
    classes: [...speeds.keys()].filter(c => c !== '*'),
  };
}
const OWN_STATS = {
  tra_sched: ownStats('tra_sched', aliasCanonicalClone(SAMPLE.tra_sched)),
  thsr_sched: ownStats('thsr_sched', SAMPLE.thsr_sched),
  afr_sched: ownStats('afr_sched', SAMPLE.afr_sched),
};
// 退路順序，腳本自己照順序找第一個 ≥ 20 段的組。
function ownPick(sys, cls, km) {
  const b = ownBucket(km), order = [[cls, OWN_BUCKETS[b]]];
  if (b > 0) order.push([cls, OWN_BUCKETS[b - 1]]);
  if (b < OWN_BUCKETS.length - 1) order.push([cls, OWN_BUCKETS[b + 1]]);
  order.push(['*', OWN_BUCKETS[b]], ['*', '*']);
  for (const [c, bk] of order) {
    const g = OWN_STATS[sys].speed(c, bk);
    if (g.n >= 20) return { sys, cls: c, bucket: bk, n: g.n, kmh: g.v };
  }
  return null;
}
// 普快例外：普快只在南迴線的站（含枋寮、臺東兩端）用類別中位數，
// 其他站用全系統的。南迴線有哪些站由腳本自己從 data/tra.json 讀（onLine），不看實作塞在停站上的 lines。
const PK = ruleSource('普快');
function ownDwell(sys, cls, key) {
  const g = OWN_STATS[sys].dwell(cls), a = OWN_STATS[sys].dwell('*');
  const all = a.n > 0 ? Math.round(a.v) : 0;
  if (!(g.n > 0)) return all;
  if (cls === PK && !(sys === 'tra_sched' && key && onLine(sys, '南迴線', key))) return all;
  return Math.round(g.v);
}
// 物理下限的封閉解：buildProfile 可不可行只看 ρ=1 的梯形那一步（disc ≥ 0 且巡航 ≤ 極速），
// 所以最小可行時間＝三角形 2√(DL)（尖峰沒超過極速時）或 L/v + D·v（會碰到極速時），D＝1/(2a)+1/(2b)。
function closedPhysMin(km, perf) {
  if (!(km > 0)) return 0;
  const L = km * 1000, a = perf.a / 3.6, b = perf.b / 3.6, v = perf.v / 3.6, D = 1 / (2 * a) + 1 / (2 * b);
  return L >= D * v * v ? L / v + D * v : 2 * Math.sqrt(D * L);
}
const STATS = {};   // 實作算的統計，給後面的段落用
// 高雄到臺東那條路上的一站（實作 findRoute 給的停站物件，帶 lines）；找不到回 null。
const probeStop = name => {
  const r = MyTrainPlan.findRoute(GRAPH.tra_sched, K('tra_sched', '高雄'), K('tra_sched', '臺東'), {});
  return (r.ok && r.stops.find(x => x.name === name)) || null;
};
const KM_GRID = [0.8, 2.5, 4.99, 5, 7.5, 10, 15, 19.99, 20, 30, 40, 55, 120];

section('跑時統計跟腳本重算的一致（硬斷言）', () => {
  for (const sys of SYSTEMS) STATS[sys] = MyTrainPlan.buildRunStats(sys, SAMPLE[sys], classOfFor(sys), GRAPH[sys]);
  const t = tally(['有 20 段以上的組可用（腳本自己找）', '選的組跟腳本照退路順序找的一致', '段數跟腳本重算的一致',
    '均速跟腳本重算的差 0.1 km/h 以內', '沒有用到少於 20 段的組', '停車時間跟腳本重算的一致']);
  for (const sys of SYSTEMS) {
    const classes = new Set([...OWN_STATS[sys].classes,
      ...Object.values(MyTrainPlan.MODELS).filter(m => m.sys === sys).map(m => m.cls), 'type:不存在的車種']);
    for (const cls of classes) for (const km of KM_GRID) {
      const got = MyTrainPlan.runSpeed(STATS[sys], cls, km), want = ownPick(sys, cls, km);
      const g = got && got.group, tag = `${sys} ${cls} ${km}km`;
      t.expect('有 20 段以上的組可用（腳本自己找）', !!want, tag);
      if (!want) continue;
      t.expect('選的組跟腳本照退路順序找的一致', g && g.sys === sys && g.cls === want.cls && g.bucket === want.bucket,
        `${tag} 實作 ${g && g.cls}/${g && g.bucket}，腳本 ${want.cls}/${want.bucket}`);
      t.expect('段數跟腳本重算的一致', g && g.n === want.n, `${tag} ${g && g.n} vs ${want.n}`);
      t.expect('均速跟腳本重算的差 0.1 km/h 以內', g && Math.abs(got.kmh - want.kmh) <= 0.1 && Math.abs(g.kmh - want.kmh) <= 0.1,
        `${tag} ${got.kmh} vs ${want.kmh}`);
      t.expect('沒有用到少於 20 段的組', g && g.n >= 20, tag);
    }
    // 普快例外看站：台鐵另外拿高雄到臺東那條路上的屏東（南迴線外）、枋寮（屏東線與南迴線交界）、知本（南迴線上）各試一次。
    const probes = [undefined];
    if (sys === 'tra_sched') for (const nm of ['屏東', '枋寮', '知本']) probes.push(probeStop(nm));
    for (const cls of classes) for (const st of probes) {
      const got = MyTrainPlan.dwellSec(STATS[sys], cls, st), want = ownDwell(sys, cls, st ? K(sys, st.name) : null);
      t.expect('停車時間跟腳本重算的一致', st !== null && got === want, `${sys} ${cls} ${st ? st.name : '不給站'} ${got} vs ${want}`);
    }
  }
  t.report();
  // 例外有牙：這份資料裡普快在南迴線上、線外的停車時間要真的不一樣，不然上面南迴線內外都會對、驗不出東西。
  // 對照組：莒光在南迴線外照樣用自己類別的中位數（例外只給普快）。
  const T = 'tra_sched', on = ownDwell(T, PK, K(T, '知本')), off = ownDwell(T, PK, K(T, '屏東'));
  check(on !== off, '普快停車時間：南迴線上、線外確實不同（例外有在作用）', `知本 ${on} 秒／屏東 ${off} 秒`);
  const JG = ruleSource('莒光'), jg = MyTrainPlan.dwellSec(STATS[T], JG, probeStop('屏東'));
  check(jg === Math.round(OWN_STATS[T].dwell(JG).v) && jg !== ownDwell(T, '*不存在的類別*', null),
    '對照組：莒光在南迴線外用自己類別的中位數（跟全系統的不同）', `${jg} 秒`);
  // 舊版的坑：區間車 40 公里以上那一組不到 20 段，不准退到「同類別不分長度」。
  const local = ruleSource('區間'), own40 = OWN_STATS.tra_sched.speed(local, '40+');
  const pick = MyTrainPlan.runSpeed(STATS.tra_sched, local, 60).group;
  console.log(`   區間車 40 公里以上：${own40.n} 段；60 km 的區間用 ${pick.cls}/${pick.bucket}（${pick.n} 段、${pick.kmh.toFixed(1)} km/h）`);
  check(!(pick.cls === local && pick.bucket === '*'), '沒有退到「同類別、不分長度」這一組');
});

section('退路與排除規則（合成資料）', () => {
  // 一條線：甲 0、乙 3、丙 10、丁 25、戊 70 公里。
  const line = [{ id: 'L', stations: [['甲', 0], ['乙', 3], ['丙', 10], ['丁', 25], ['戊', 70]].map(([name, d]) => ({ name, lat: 0, lon: 0, d })) }];
  const g = MyTrainPlan.buildGraph(line, 'afr_sched');
  const mk = (cls, a, b, sec, n, extra = {}) => Array.from({ length: n }, () => ({ cls, ...extra,
    stops: [{ name: a, arrSec: 1000, depSec: 1000, stop: true }, { name: b, arrSec: 1000 + sec, depSec: 1000 + sec, stop: true }] }));
  const base = [
    ...mk('X', '乙', '丙', 700, 25), ...mk('X', '丙', '丁', 900, 5),     // X：5–10 有 25 段（36 km/h），10–20 只有 5 段
    ...mk('Y', '乙', '丙', 600, 5), ...mk('Y', '丙', '丁', 1200, 25),    // Y：5–10 只有 5 段，10–20 有 25 段（45 km/h）
    ...mk('Z', '丁', '戊', 1800, 3), ...mk('W', '丁', '戊', 2700, 22),   // 40+：Z 3 段（90 km/h）、W 22 段（60 km/h）
  ];
  const classOf = tr => tr.cls;
  const s = MyTrainPlan.buildRunStats('afr_sched', base, classOf, g);
  const pick = (cls, km) => { const r = MyTrainPlan.runSpeed(s, cls, km); return `${r.group.cls}/${r.group.bucket}/${r.group.n}/${Math.round(r.kmh)}`; };
  check(pick('X', 7) === 'X/5-10/25/36', '本桶夠 → 用本桶', pick('X', 7));
  check(pick('X', 15) === 'X/5-10/25/36', '本桶不夠 → 同類別短一級', pick('X', 15));
  check(pick('Y', 7) === 'Y/10-20/25/45', '短一級也不夠 → 同類別長一級', pick('Y', 7));
  check(pick('Z', 45) === '*/40+/25/60', '同類別都不夠 → 同系統同桶', pick('Z', 45));
  check(pick('Z', 3) === '*/*/85/45', '同系統同桶也不夠 → 同系統不分長度', pick('Z', 3));
  check(pick('Q', 15) === '*/10-20/30/45', '沒見過的類別 → 同系統同桶', pick('Q', 15));
  // 排除規則：每一種各塞 30 段荒謬的 X 5–10 樣本，n 與均速都不能動；對照組拿掉旗標就會動。
  const junk = [
    ...mk('X', '乙', '丙', 10, 30, { loop: true }), ...mk('X', '乙', '丙', 10, 30, { est: true }),
    ...Array.from({ length: 30 }, () => { const tr = mk('X', '乙', '丙', 10, 1)[0]; tr.stops._prevNight = true; return tr; }),
    ...mk('X', '乙', '丙', 0, 30), ...mk('X', '乙', '丙', -60, 30),
  ];
  const s2 = MyTrainPlan.buildRunStats('afr_sched', base.concat(junk), classOf, g);
  const r2 = MyTrainPlan.runSpeed(s2, 'X', 7);
  check(r2.group.n === 25 && Math.round(r2.kmh) === 36, '環島車、推估班、跨夜借班、時間差 ≤ 0 的區間都不進統計', `${r2.group.n} 段`);
  const s3 = MyTrainPlan.buildRunStats('afr_sched', base.concat(mk('X', '乙', '丙', 10, 30)), classOf, g);
  check(MyTrainPlan.runSpeed(s3, 'X', 7).group.n === 55, '對照組：同樣的樣本沒有旗標就會進統計');
  // 區間里程＝班表相鄰兩筆在站點圖上的最短路徑加總：甲→丙中間沒列乙，里程照樣是 10。
  const s4 = MyTrainPlan.buildRunStats('afr_sched', mk('X', '甲', '丙', 1000, 20), classOf, g);
  const r4 = MyTrainPlan.runSpeed(s4, 'X', 7);
  check(r4.group.bucket === '10-20' && Math.round(r4.kmh) === 36, '中間站沒列在班表上時，里程照站點圖算', `${r4.group.bucket} ${r4.kmh}`);
  // 停車時間：類別的中間停靠站中位數；該類別沒有樣本 → 同系統。
  const dw = n => Array.from({ length: n }, (_, i) => ({ cls: 'X', stops: [
    { name: '甲', arrSec: 0, depSec: 0, stop: true }, { name: '乙', arrSec: 300, depSec: 340 + i, stop: true },
    { name: '丙', arrSec: 900, depSec: 900, stop: false }, { name: '丁', arrSec: 1500, depSec: 1500, stop: true }] }));
  const s5 = MyTrainPlan.buildRunStats('afr_sched', dw(3), classOf, g);
  check(MyTrainPlan.dwellSec(s5, 'X') === 41, '停車時間取類別中位數（通過站不算）', String(MyTrainPlan.dwellSec(s5, 'X')));
  check(MyTrainPlan.dwellSec(s5, 'Y') === 41, '類別沒有停車樣本 → 同系統中位數');
});

section('高鐵發車取中點、別名站不影響統計', () => {
  // index.html assignSchedShapePathsFor 會把高鐵停靠站的 depSec 改成 dep0 + 30（HSR_DEP_MID_SEC），原值留在 dep0。
  const shifted = SAMPLE.thsr_sched.map(tr => ({ ...tr, stops: tr.stops.map(s => ({ ...s, dep0: s.depSec, depSec: s.depSec + 30 })) }));
  const noDep0 = shifted.map(tr => ({ ...tr, stops: tr.stops.map(({ dep0, ...s }) => s) }));
  const cOf = classOfFor('thsr_sched');
  const a = MyTrainPlan.buildRunStats('thsr_sched', shifted, cOf, GRAPH.thsr_sched);
  const b = MyTrainPlan.buildRunStats('thsr_sched', noDep0, cOf, GRAPH.thsr_sched);
  const sig = st => KM_GRID.map(km => MyTrainPlan.runSpeed(st, 'hsr', km).kmh.toFixed(4)).join(',') + '|' + MyTrainPlan.dwellSec(st, 'hsr');
  check(sig(a) === sig(STATS.thsr_sched), '高鐵 depSec 被改成中點之後，統計照 dep0 算，結果不變');
  check(sig(b) !== sig(STATS.thsr_sched), '對照組：沒有 dep0 時結果確實會變');
  // 別名站：把一班真車的「臺北」改成「臺北-環島」（index.html canonicalizeAliasTrains 會併回臺北的那種名字）。
  const T = 'tra_sched', victim = SAMPLE[T].findIndex(tr => tr.stops.some(s => s.name === '臺北'));
  const renamed = SAMPLE[T].map((tr, i) => (i !== victim ? tr
    : { ...tr, stops: tr.stops.map(s => (s.name === '臺北' ? { ...s, name: '臺北-環島' } : s)) }));
  const c = MyTrainPlan.buildRunStats(T, renamed, classOfFor(T), GRAPH[T]);
  const cls = traClassOf(SAMPLE[T][victim]);
  const sigT = st => KM_GRID.map(km => { const r = MyTrainPlan.runSpeed(st, cls, km); return r.group.n + ':' + r.kmh.toFixed(4); }).join(',');
  check(victim >= 0 && sigT(c) === sigT(STATS[T]), '「臺北-環島」照「臺北」量里程，統計不變', `第 ${victim} 班 ${cls}`);
});

// 「臺北-環島」是之前刻意整併的站——併站是對的，但要照 index.html
// canonicalizeAliasTrains 的三個條件（存在＋距離 ≤0.2km），不是只靠 stationKey 硬編碼的
// 「-環島$」。這裡直接測 MyTrainPlan.aliasBaseName／nameLocations 本身，跟上面「別名站不影響統計」
// （只測到「臺北-環島」剛好被 stationKey 自己解掉、根本沒走到這裡）分開。
section('別名站合併（跟 index.html canonicalizeAliasTrains 同三條件）', () => {
  // 存在＋距離 0 都過 → 併回「甲」。
  const near = MyTrainPlan.nameLocations([{ stops: [{ name: '甲', lat: 25, lon: 121 }, { name: '甲-支線', lat: 25, lon: 121 }] }]);
  check(MyTrainPlan.aliasBaseName('甲-支線', near) === '甲', '存在＋距離 0 → 併回「甲」');
  // 距離守衛（正向對照）：「-」前面那段存在，但相距約 5.6km（緯度差 0.05 度）→ 不准併。
  const far = MyTrainPlan.nameLocations([{ stops: [{ name: '甲', lat: 25, lon: 121 }, { name: '甲-遠站', lat: 25.05, lon: 121 }] }]);
  check(MyTrainPlan.aliasBaseName('甲-遠站', far) === null, '距離守衛：存在但相距遠遠超過 0.2km → 不併（缺這條就是沒有守衛）');
  // 存在檢查：「-」前面那段不是任何站名 → 不併。
  const noBase = MyTrainPlan.nameLocations([{ stops: [{ name: '乙-支線', lat: 25, lon: 121 }] }]);
  check(MyTrainPlan.aliasBaseName('乙-支線', noBase) === null, '存在檢查："-" 前面那段不是站名 → 不併');
  // 對照組：沒有 "-"、或 "-" 在開頭，不算別名。
  check(MyTrainPlan.aliasBaseName('丙', new Map()) === null, '沒有 "-" → 不算別名');
  check(MyTrainPlan.aliasBaseName('-丁', new Map([['丁', { lat: 0, lon: 0 }]])) === null, '"-" 在開頭 → 不算別名');

  // 端到端（真實資料）：「臺北-環島」併回「臺北」，經 stationKey 後跟「台北」同一把鍵。
  const realLoc = MyTrainPlan.nameLocations(SAMPLE.tra_sched);
  check(MyTrainPlan.aliasBaseName('臺北-環島', realLoc) === '臺北', '真實資料：「臺北-環島」併回「臺北」（刻意整併）');
  check(MyTrainPlan.stationKey('tra_sched', MyTrainPlan.aliasBaseName('臺北-環島', realLoc)) === 'tra_sched:台北',
    '併回的「臺北」經 stationKey 後是 tra_sched:台北');

  // 端到端（合成資料，接上 buildRunStats／keyOfName 的接線）：站點圖只有「甲」「乙」，班表用非「-環島」
  // 的別名「甲-副線」——stationKey 自己解不掉，一定要靠這裡的三條件併站才找得到路。
  const gAlias = MyTrainPlan.buildGraph(
    [{ id: 'L', stations: [{ name: '甲', lat: 24, lon: 121, d: 0 }, { name: '乙', lat: 24, lon: 121.05, d: 5 }] }], 'afr_sched');
  const anchorTrain = { stops: [{ name: '甲', lat: 24, lon: 121, arrSec: -600, depSec: -600, stop: true }] };
  const trainWith = (name, lat, lon) => ({ stops: [
    { name, lat, lon, arrSec: 0, depSec: 0, stop: true },
    { name: '乙', lat: 24, lon: 121.05, arrSec: 600, depSec: 600, stop: true },
  ] });
  const okStats = MyTrainPlan.buildRunStats('afr_sched', [anchorTrain, trainWith('甲-副線', 24, 121)], () => 'X', gAlias);
  check(okStats.skipped.unmeasured === 0, '端到端：非「-環島」的別名，存在＋距離都過 → keyOfName 靠三條件併站解出里程', JSON.stringify(okStats.skipped));
  const farStats = MyTrainPlan.buildRunStats('afr_sched', [anchorTrain, trainWith('甲-遠站', 24.05, 121)], () => 'X', gAlias);
  check(farStats.skipped.unmeasured === 1, '端到端對照組：距離守衛擋下 → 這一段量不到里程、算跳過', JSON.stringify(farStats.skipped));
  const noBaseStats = MyTrainPlan.buildRunStats('afr_sched', [trainWith('丑-支線', 24, 121)], () => 'X', gAlias);
  check(noBaseStats.skipped.unmeasured === 1, '端到端對照組："-" 前面那段不是任何站名 → 量不到里程、算跳過', JSON.stringify(noBaseStats.skipped));
});

section('物理下限（buildProfile 從 index.html 抽）', () => {
  const t = tally(['物理下限跟封閉解差 0.01 秒以內', '下限那一刻 buildProfile 可行', '比下限快 0.5 秒 buildProfile 就不可行（對照組）']);
  const perfs = Object.entries(MyTrainPlan.MODELS).map(([id, m]) => [id, m.perf]);
  const physKms = [0.3, 1, 2.7, 6, 13, 31, 58, 140], wantPhysN = perfs.length * physKms.length;
  for (const [id, perf] of perfs) for (const km of physKms) {
    const got = MyTrainPlan.physMinSec(km, perf, P.buildProfile), want = closedPhysMin(km, perf);
    t.expect('物理下限跟封閉解差 0.01 秒以內', Math.abs(got - want) <= 0.01, `${id} ${km}km ${got} vs ${want}`, wantPhysN);
    t.expect('下限那一刻 buildProfile 可行', !!P.buildProfile(km, got, perf.a, perf.b, perf.v, perf.coast), `${id} ${km}km`, wantPhysN);
    t.expect('比下限快 0.5 秒 buildProfile 就不可行（對照組）', !P.buildProfile(km, want - 0.5, perf.a, perf.b, perf.v, perf.coast), `${id} ${km}km`, wantPhysN);
  }
  t.report();
  check(MyTrainPlan.physMinSec(0, MyTrainPlan.MODELS.emu800.perf, P.buildProfile) === 0, '距離 0 的下限是 0');
  const steam = MyTrainPlan.physMinSec(40, MyTrainPlan.MODELS.ck124.perf, P.buildProfile);
  const jg = closedPhysMin(40, { a: 1.5, b: 2.6, v: 120 });
  check(steam > jg, '極速比較低的車（CK124 85 km/h）下限比同一列的 120 km/h 慢', `${steam.toFixed(0)} > ${jg.toFixed(0)} 秒`);
});

// ═══ 時刻表、強制單調、跨午夜；組合全掃；跟真車比的報表 ═══
const ctxFor = sys => ({
  lines: TRACK[sys].lines, trains: DAY[sys].trains, denseTrains: SAMPLE[sys], stnClassMap: STN_CLASS,
  classOf: classOfFor(sys), buildProfile: P.buildProfile, catalog: CATALOG,
  stats: STATS[sys], graph: GRAPH[sys], tiers: TIERS[sys],
});
const savedFor = (modelId, from, to, pattern, extra = {}) => {
  const sys = MyTrainPlan.MODELS[modelId] ? MyTrainPlan.MODELS[modelId].sys : 'tra_sched';
  return { id: 'my:0f8e2d1c-aaaa-4bbb-8ccc-123456789abc', name: '520', modelId, sys, from: K(sys, from), to: K(sys, to),
    via: null, pattern, depSec: 8 * 3600, ...extra };
};
const PATTERNS_OF = sys => (sys === 'afr_sched' ? ['all', 'express'] : ['all', 'major', 'express']);
const ROUTES = { tra_sched: [], thsr_sched: [], afr_sched: [] };
for (const sys of SYSTEMS) for (const ln of TRACK[sys].lines) if (ln.stations.length >= 2) ROUTES[sys].push([ln.stations[0].name, ln.stations.at(-1).name, null]);
ROUTES.tra_sched.push(['基隆', '枋寮', null], ['竹南', '彰化', 'coast'], ['臺北', '菁桐', null], ['臺北', '花蓮', null], ['臺北', '高雄', null],
  ['臺北', '高雄', 'coast'], ['新竹', '臺中', null], ['臺北', '臺中', null], ['苗栗', '彰化', null], ['新竹', '大甲', null], ['臺東', '臺北', null]);
ROUTES.thsr_sched.push(['台北', '左營', null], ['南港', '台中', null], ['台中', '左營', null], ['左營', '南港', null]);
ROUTES.afr_sched.push(['嘉義', '阿里山', null], ['阿里山', '嘉義', null], ['神木', '阿里山', null], ['沼平', '阿里山', null]);
for (const sys of SYSTEMS) {
  const seen = new Set();
  ROUTES[sys] = ROUTES[sys].filter(([a, b, v]) => { const k = `${K(sys, a)}|${K(sys, b)}|${v}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
const RESULTS = [];   // { id, sys, from, to, via, byPattern: { all, major, express } }

section('planTrain 的失敗原因與記錄形狀', () => {
  const T = 'tra_sched', ctx = ctxFor(T);
  const reason = (saved, c = ctx) => { const r = MyTrainPlan.planTrain(saved, c); return r.ok ? 'ok' : r.reason; };
  check(reason(null) === 'bad_saved', '沒有 saved → bad_saved');
  check(reason(savedFor('emu800', '臺北', '花蓮', 'major', { modelId: 'nope' })) === 'model_gone', '車款不在表裡 → model_gone');
  check(reason(savedFor('emu800', '臺北', '花蓮', 'major', { sys: 'thsr_sched' })) === 'sys_mismatch', '系統跟車款不合 → sys_mismatch');
  check(reason(savedFor('emu800', '臺北', '花蓮', 'fast')) === 'bad_pattern', '不認得的停站方式 → bad_pattern');
  check(reason(savedFor('dl25', '嘉義', '阿里山', 'major'), ctxFor('afr_sched')) === 'bad_pattern', '林鐵只停大站 → bad_pattern');
  for (const dep of [-1, 86400, 1.5, '28800']) check(reason(savedFor('emu800', '臺北', '花蓮', 'all', { depSec: dep })) === 'bad_dep', `出發時刻 ${JSON.stringify(dep)} → bad_dep`);
  check(reason(savedFor('emu800', '臺北', '花蓮', 'all', { name: ' \n ' })) === 'bad_name', '空名字 → bad_name');
  check(reason(savedFor('emu800', '臺北', '花蓮', 'all', { from: '不存在站' })) === 'station_gone', '起站不存在 → station_gone');
  check(reason(savedFor('emu800', '臺北', '臺北', 'all')) === 'same', '起訖相同 → same');
  const island = { ...ctx, graph: null, lines: [
    { id: 'A', stations: [{ name: '甲', lat: 0, lon: 0, d: 0 }, { name: '乙', lat: 0, lon: 0, d: 1 }] },
    { id: 'B', stations: [{ name: '丙', lat: 0, lon: 0, d: 0 }, { name: '丁', lat: 0, lon: 0, d: 2 }] }] };
  check(reason({ ...savedFor('emu800', '臺北', '花蓮', 'all'), from: K('tra_sched', '甲'), to: K('tra_sched', '丙') }, island) === 'no_path', '找不到路 → no_path');
  check(reason(savedFor('emu800', '臺北', '花蓮', 'all')) === 'ok', '對照組：同一班正常的設定排得出來');
  for (const [id, zone] of [['temu2000', 'puyuma'], ['temu1000', 'tilting'], ['emu800', 'regular']]) {
    const res = MyTrainPlan.planTrain(savedFor(id, '臺北', '花蓮', 'major', { name: IDEO + '自強520' }), ctx);
    const rec = res.record, m = MyTrainPlan.MODELS[id];
    check(res.ok && rec.train === 'my:0f8e2d1c-aaaa-4bbb-8ccc-123456789abc' && rec.label === '自強520' && rec.mine === true
      && rec.modelId === id && rec.sys === T && rec.zoneClass === zone && rec.typeName === CATALOG[id].name && rec.carName === ''
      && rec.color === MyTrainPlan.defaultColor(id) && rec._ownPattern === 'major' && rec._ownVia === null,
      `${id} 的執行時記錄欄位（zoneClass ${zone}，color 預設 ${MyTrainPlan.defaultColor(id)}）`, JSON.stringify({ ...rec, stops: rec && rec.stops.length }));
    check(JSON.stringify(rec.perf) === JSON.stringify(m.perf) && rec.perf !== m.perf && !Object.isFrozen(rec.perf),
      `${id} 的 perf 是 MODELS 那一份的複本`);
    check(rec.stops === res.timetable.stops && rec.stops.every(s => Object.keys(s).sort().join() === 'arrSec,depSec,lat,lon,name,stop'),
      `${id} 的 stops 是時刻表那一份（name/lat/lon/arrSec/depSec/stop）`);
    check(res.stats === STATS[T], `${id} 回傳的 stats 就是傳進去的快取`);
  }
  const via = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '高雄', 'all', { via: 'coast' }), ctx);
  check(via.ok && via.record._ownVia === 'coast', '選海線 → _ownVia coast');
  // 順行／逆行：record 帶 _ownDir（面板用來標方向）；沒得選的路線是 null。
  const d0 = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '臺東', 'major'), ctx);
  const d1 = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '臺東', 'major', { dir: 'shun' }), ctx);
  const via2 = r => r.record.stops.map(s => s.name);
  check(d0.ok && d0.record._ownDir === 'ni' && !via2(d0).includes('高雄') && d1.ok && d1.record._ownDir === 'shun' && via2(d1).includes('高雄'),
    '臺北→臺東：預設 _ownDir ni（不經高雄），選順行 _ownDir shun（經高雄）', `${d0.record && d0.record._ownDir}／${d1.record && d1.record._ownDir}`);
  const dn = MyTrainPlan.planTrain(savedFor('emu800', '十分', '菁桐', 'all', { dir: 'shun' }), ctx);
  check(dn.ok && dn.record._ownDir === null, '沒有方向可選的路線 _ownDir null（傳了 dir 也一樣）');
  // 全程超過一天就不給排（這班每天都開）：用合成的 5000 公里長線，跟資料無關；300 公里那段是對照組。
  const longLine = { id: 'X', stations: Array.from({ length: 51 }, (_, i) => ({ name: '長' + i, lat: 23, lon: 121, d: i * 100 })) };
  const synth = { ...ctx, graph: null, lines: [longLine] };
  const far = MyTrainPlan.planTrain({ ...savedFor('emu800', '臺北', '花蓮', 'all'), from: K(T, '長0'), to: K(T, '長50') }, synth);
  const near = MyTrainPlan.planTrain({ ...savedFor('emu800', '臺北', '花蓮', 'all'), from: K(T, '長0'), to: K(T, '長3') }, synth);
  check(!far.ok && far.reason === 'over_day', '合成的 5000 公里站站停 → over_day', JSON.stringify({ ok: far.ok, reason: far.reason }));
  check(near.ok && near.timetable.totalSec < 86400, '對照組：同一條合成線只跑 300 公里 → 排得出來', JSON.stringify({ ok: near.ok, reason: near.reason }));
  // 「超過 24 小時」的文字契約邊界：固定回傳三個時長，黑箱走完 planTrain。
  // 期望值是寫死的真值表，不從產品的比較運算子推導，才能抓到 > 被改回 >= 的回歸。
  const realBuildTimetable = MyTrainPlan.buildTimetable;
  try {
    for (const [seconds, allowed] of [[86399, true], [86400, true], [86401, false]]) {
      planCtx.MyTrainPlan.buildTimetable = (...args) => ({ ...realBuildTimetable(...args), totalSec: seconds });
      const res = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'all'), ctx);
      check(allowed ? res.ok : (!res.ok && res.reason === 'over_day'),
        `24 小時邊界 ${seconds} 秒${allowed ? '可排' : '阻擋'}`, JSON.stringify({ ok: res.ok, reason: res.reason }));
    }
  } finally {
    planCtx.MyTrainPlan.buildTimetable = realBuildTimetable;
  }
  // 車牌顏色：record.color 讀 saved.color（過 normalizeColor），不是 ctx.color。
  const withColor = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'all', { color: '#8E44AD' }), ctx);
  check(withColor.ok && withColor.record.color === '#8E44AD', 'saved.color 是合法值→原樣進 record（不是 ctx.color）');
  const badColor = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'all', { color: '#ff2bd6' }), ctx);
  check(badColor.ok && badColor.record.color === MyTrainPlan.defaultColor('emu800'), 'saved.color 是舊版螢光色（不合法）→退回這台車的預設色');
  const noColor = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'all'), { ...ctx, color: '#1f6feb' });
  check(noColor.ok && noColor.record.color === MyTrainPlan.defaultColor('emu800'), 'ctx.color 就算給了也不讀（防止走回頭路）：record.color 仍是預設色');
  // 契約 3.1：planTrain 經由 MyTrainPlan.xxx 呼叫其他函式（隔離腳本的計數替身要包得到）。
  const names = ['buildGraph', 'findRoute', 'stationTiers', 'applyPattern', 'buildRunStats', 'runSpeed', 'dwellSec', 'physMinSec', 'buildTimetable', 'validateName'];
  const orig = {}, calls = {};
  for (const n of names) { orig[n] = MyTrainPlan[n]; calls[n] = 0; planCtx.MyTrainPlan[n] = (...a) => { calls[n]++; return orig[n](...a); }; }
  try {
    MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'express'),
      { ...ctx, stats: undefined, graph: undefined, tiers: undefined });
  } finally { for (const n of names) planCtx.MyTrainPlan[n] = orig[n]; }
  check(names.every(n => calls[n] >= 1), 'planTrain 對每個函式都經由 MyTrainPlan.xxx 呼叫', JSON.stringify(calls));
});
// 站站停的全程秒數，腳本自己照公式算：每段 ceil(max(距離÷均速, 物理下限))，加上中間每站的停車時間（ownDwell）。
// 站站停沒有比它更密的停站方式，不會有被壓的段，所以是精確值（每段差 1 秒內）。
function ownAllStopTotal(sys, m, route) {
  if (!route || !route.ok) return null;
  const st = route.stops;
  let sec = 0;
  for (let i = 1; i < st.length; i++) {
    const km = st[i].km - st[i - 1].km, want = ownPick(sys, m.cls, km);
    sec += Math.ceil(Math.max(km / want.kmh * 3600, closedPhysMin(km, m.perf)));
  }
  for (let i = 1; i < st.length - 1; i++) sec += ownDwell(sys, m.cls, K(sys, st[i].name));
  return sec;
}
const PLAN_OK = '排得出來（超過一天而被擋的只准是站站停，而且腳本自己算的全程也超過一天）';
const PK_SEEN = { on: 0, off: 0 };   // 掃描裡普快的中間停靠站，在南迴線上／線外各驗了幾站
section('時刻表（每款車 × 每條路線 × 每種停站方式）', () => {
  const t = tally([PLAN_OK, '全程不超過一天（這班每天都開）', '停站表跟路線同長、同站名', '起站 arr＝dep＝出發時刻', '訖站有停、arr＝dep',
    '時刻只能往後走', '中間停靠站有停車時間（腳本重算的中位數，> 0）', '通過站沒有停車時間',
    '「all」停的站跟腳本算的一致', '「major」停的站跟腳本算的一致', '「express」停的站跟腳本算的一致',
    '每一段＝停靠站到下一個停靠站', '每段用的組跟腳本照退路找的一致（系統、類別、長度桶、段數）',
    '每段用的組均速跟腳本重算的差 0.1 km/h 以內', '沒有一段用到少於 20 段的組',
    '每段不快過物理下限（封閉解）', '每段的時間 buildProfile 解得出來', '段的時間＝到站減發車',
    '通過站時刻照距離比例內插', '沒被壓的段＝ceil(max(距離÷均速, 物理下限))（差 1 秒內）',
    '全程時間＝訖站到站減出發', '每段不超過比較密的停站方式在同一段路上的行駛時間總和',
    '被壓的段恰好等於那個總和', '直達 ≤ 站站停', '直達 ≤ 只停大站 ≤ 站站停']);
  for (const [id, m] of Object.entries(MyTrainPlan.MODELS)) {
    const sys = m.sys, ctx = ctxFor(sys);
    for (const [from, to, via] of ROUTES[sys]) {
      const entry = { id, sys, from, to, via, byPattern: {}, overDay: new Set() };
      for (const pattern of PATTERNS_OF(sys)) {
        const res = MyTrainPlan.planTrain(savedFor(id, from, to, pattern, { via }), ctx);
        const tag = `${id} ${from}→${to}${via === 'coast' ? '（海線）' : ''} ${pattern}`;
        // 加上「全程超過一天就不給排」（這班每天都開，隔天發車時上一趟不能還在路上）。over_day 只准在腳本照
        // 同一套公式自己算出來也超過一天時才出現，而且只准出現在站站停（沒有被壓的段，公式是精確值）。
        const over = !res.ok && res.reason === 'over_day';
        const est = over ? ownAllStopTotal(sys, m, MyTrainPlan.findRoute(GRAPH[sys], K(sys, from), K(sys, to), { via })) : null;
        if (over) entry.overDay.add(pattern);
        t.expect(PLAN_OK, res.ok || (over && pattern === 'all' && est > 86400),
          `${tag} ${res.reason}${est != null ? `（腳本算 ${(est / 3600).toFixed(1)} 小時）` : ''}`);
        if (!res.ok) continue;
        t.expect('全程不超過一天（這班每天都開）', res.timetable.totalSec <= 86400, `${tag} ${res.timetable.totalSec}`);
        entry.byPattern[pattern] = res;
        const st = res.timetable.stops, rs = res.route.stops, n = st.length;
        t.expect('停站表跟路線同長、同站名', n === rs.length && st.every((s, i) => s.name === rs[i].name), tag);
        t.expect('起站 arr＝dep＝出發時刻', st[0].arrSec === 8 * 3600 && st[0].depSec === 8 * 3600 && st[0].stop, tag);
        t.expect('訖站有停、arr＝dep', st[n - 1].stop && st[n - 1].arrSec === st[n - 1].depSec, tag);
        let mono = true, dwellBad = null, passOk = true;
        for (let i = 1; i < n; i++) {
          if (!(st[i].arrSec >= st[i - 1].depSec && st[i].depSec >= st[i].arrSec)) mono = false;
          if (i < n - 1 && st[i].stop) {
            const key = K(sys, rs[i].name), dwell = ownDwell(sys, m.cls, key), got = st[i].depSec - st[i].arrSec;
            if (!(got === dwell && dwell > 0)) dwellBad = dwellBad || `${rs[i].name} ${got} 秒，期望 ${dwell} 秒`;
            if (m.cls === PK) PK_SEEN[onLine(sys, '南迴線', key) ? 'on' : 'off']++;
          }
          if (!st[i].stop && st[i].depSec !== st[i].arrSec) passOk = false;
        }
        t.expect('時刻只能往後走', mono, tag);
        t.expect('中間停靠站有停車時間（腳本重算的中位數，> 0）', !dwellBad, `${tag} ${dwellBad}`);
        t.expect('通過站沒有停車時間', passOk, tag);
        const wantStop = rs.map((s, i) => i === 0 || i === n - 1 || pattern === 'all'
          || (pattern === 'major' && (OWN_TIERS[sys].get(s.name) ?? 4) <= 2));
        t.expect(`「${pattern}」停的站跟腳本算的一致`, st.every((s, i) => s.stop === wantStop[i]), tag);
        const segs = res.timetable.segs, stopIdx = wantStop.map((w, i) => (w ? i : -1)).filter(i => i >= 0);
        t.expect('每一段＝停靠站到下一個停靠站', segs.length === stopIdx.length - 1
          && segs.every((g, k) => g.fromIdx === stopIdx[k] && g.toIdx === stopIdx[k + 1]), tag);
        for (const g of segs) {
          const km = rs[g.toIdx].km - rs[g.fromIdx].km, want = ownPick(sys, m.cls, km);
          const gtag = `${tag} ${rs[g.fromIdx].name}→${rs[g.toIdx].name} ${km.toFixed(1)}km`;
          t.expect('每段用的組跟腳本照退路找的一致（系統、類別、長度桶、段數）', want && g.group.sys === sys && g.group.cls === want.cls
            && g.group.bucket === want.bucket && g.group.n === want.n, `${gtag} ${JSON.stringify(g.group)} vs ${JSON.stringify(want)}`);
          t.expect('每段用的組均速跟腳本重算的差 0.1 km/h 以內', want && Math.abs(g.group.kmh - want.kmh) <= 0.1, gtag);
          t.expect('沒有一段用到少於 20 段的組', g.group.n >= 20, gtag);
          const phys = closedPhysMin(km, m.perf);
          t.expect('每段不快過物理下限（封閉解）', g.runSec >= phys - 1e-6, `${gtag} ${g.runSec} < ${phys.toFixed(1)}`);
          t.expect('每段的時間 buildProfile 解得出來', !!P.buildProfile(km, g.runSec, m.perf.a, m.perf.b, m.perf.v, m.perf.coast), gtag);
          const t0 = st[g.fromIdx].depSec;
          t.expect('段的時間＝到站減發車', st[g.toIdx].arrSec - t0 === g.runSec, gtag);
          let interp = true;
          for (let q = g.fromIdx + 1; q < g.toIdx; q++) if (st[q].arrSec !== Math.round(t0 + g.runSec * (rs[q].km - rs[g.fromIdx].km) / km)) interp = false;
          t.expect('通過站時刻照距離比例內插', interp, gtag);
          if (!g.capped) {
            const raw = Math.ceil(Math.max(km / want.kmh * 3600, phys));
            t.expect('沒被壓的段＝ceil(max(距離÷均速, 物理下限))（差 1 秒內）', Math.abs(g.runSec - raw) <= 1, `${gtag} ${g.runSec} vs ${raw}`);
          }
        }
        t.expect('全程時間＝訖站到站減出發', res.timetable.totalSec === st[n - 1].arrSec - 8 * 3600, tag);
      }
      // 停的站越少一定越快；比較密的那一種在同一段路上的行駛時間總和是上限。
      const bp = entry.byPattern, chain = sys === 'afr_sched' ? [['all', 'express']] : [['all', 'major'], ['major', 'express']];
      for (const [fine, coarse] of chain) {
        if (!bp[fine] || !bp[coarse]) continue;
        for (const g of bp[coarse].timetable.segs) {
          const cap = bp[fine].timetable.segs.filter(f => f.fromIdx >= g.fromIdx && f.toIdx <= g.toIdx).reduce((s, f) => s + f.runSec, 0);
          t.expect('每段不超過比較密的停站方式在同一段路上的行駛時間總和', g.runSec <= cap, `${id} ${from}→${to} ${coarse} ${g.fromIdx}-${g.toIdx} ${g.runSec} > ${cap}`);
          if (g.capped) t.expect('被壓的段恰好等於那個總和', g.runSec === cap, `${id} ${from}→${to} ${coarse}`);
        }
      }
      const tot = p => (bp[p] ? bp[p].timetable.totalSec : entry.overDay.has(p) ? Infinity : null);   // 排不進一天＝比任何排得出來的都久
      if (sys === 'afr_sched') t.expect('直達 ≤ 站站停', tot('express') <= tot('all'), `${id} ${from}→${to}`);
      else t.expect('直達 ≤ 只停大站 ≤ 站站停', tot('express') <= tot('major') && tot('major') <= tot('all'),
        `${id} ${from}→${to} ${tot('express')}/${tot('major')}/${tot('all')}`);
      RESULTS.push(entry);
    }
  }
  t.report();
  check(RESULTS.length >= 37, `掃過的車款×路線組合：${RESULTS.length} 組`);
  check(SYSTEMS.every(s => RESULTS.some(r => r.sys === s)), '台鐵、高鐵、林鐵都有掃到');
  check(RESULTS.some(r => Object.values(r.byPattern).some(res => res.timetable.segs.some(g => g.capped))), '對照組：確實有段被強制單調壓過（上限規則有在作用）');
  check(PK_SEEN.on > 0 && PK_SEEN.off > 0, '普快的中間停靠站，南迴線上、線外都有逐站驗到停車時間', JSON.stringify(PK_SEEN));
});

section('指名的案例', () => {
  const T = 'tra_sched', ctx = ctxFor(T);
  // EMU800 這四組在舊版退路下「直達比只停大站慢」。只斷言方向，不寫死分鐘數。
  for (const [a, b] of [['臺北', '花蓮'], ['臺北', '高雄'], ['新竹', '臺中'], ['基隆', '枋寮']]) {
    const min = p => MyTrainPlan.planTrain(savedFor('emu800', a, b, p), ctx).timetable.totalSec / 60;
    const [e, mj, al] = [min('express'), min('major'), min('all')];
    check(e <= mj && mj <= al, `EMU800 ${a}→${b}：直達 ≤ 只停大站 ≤ 站站停`, `${e.toFixed(1)}／${mj.toFixed(1)}／${al.toFixed(1)} 分`);
  }
  // 普快停車時間只在南迴線用類別中位數：藍皮臺北到高雄站站停原本每站都停普快的中位數、開超過一天排不出來。
  const bl = MyTrainPlan.planTrain(savedFor('blue', '臺北', '高雄', 'all'), ctx);
  check(bl.ok && bl.timetable.totalSec < 86400, '藍皮 臺北→高雄 站站停排得出來、不到一天',
    bl.ok ? `${(bl.timetable.totalSec / 3600).toFixed(1)} 小時` : bl.reason);
  const sb = MyTrainPlan.planTrain(savedFor('blue', '潮州', '太麻里', 'all'), ctx);
  const dw = nm => { const x = sb.ok && sb.record.stops.find(q => q.name === nm); return x ? x.depSec - x.arrSec : null; };
  const pkOn = ownDwell(T, PK, K(T, '金崙')), pkOff = ownDwell(T, PK, K(T, '崁頂'));
  check(sb.ok && dw('崁頂') === pkOff && dw('東海') === pkOff, '藍皮 潮州→太麻里：屏東線上的站停全系統中位數',
    `崁頂 ${dw('崁頂')}／東海 ${dw('東海')}，期望 ${pkOff}`);
  check(sb.ok && dw('枋寮') === pkOn && dw('金崙') === pkOn && pkOn !== pkOff, '藍皮 潮州→太麻里：枋寮（交界）與南迴線上的站停普快中位數',
    `枋寮 ${dw('枋寮')}／金崙 ${dw('金崙')}，期望 ${pkOn}（線外 ${pkOff}）`);
  const hl = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '花蓮', 'major'), ctx);
  check(hl.ok && hl.record.stops.find(s => s.name === '新城').stop === true, 'EMU800 臺北→花蓮只停大站有停新城');
  // 跨午夜：23:50 發車，時刻直接超過 86400，schedWrapT 接得起來。
  const night = MyTrainPlan.planTrain(savedFor('emu800', '臺北', '高雄', 'all', { depSec: 85800 }), ctx);
  const s = night.record.stops, last = s.at(-1).arrSec;
  check(night.ok && s[0].depSec === 85800 && last > 86400, '23:50 發車的時刻跨過 86400（不折回 0）', `抵達 ${last}`);
  check(s.every((x, i) => i === 0 || x.arrSec >= s[i - 1].depSec), '跨午夜的時刻照樣只往後走');
  P.state.clockAtNow = true;
  check(P.schedWrapT(s, 1800, 0) === 88200, '凌晨 00:30 的模擬時刻，schedWrapT 解讀成這班車的第二天（+86400）', String(P.schedWrapT(s, 1800, 0)));
  check(P.schedWrapT(s, 86000, 0) === 86000, '對照組：23:53 照原值');
});

section('跟真車比（只出報表；硬斷言只有樣本數）', () => {
  const T = 'tra_sched';
  const mOnly = new Set([...OWN[T].lineIdx.get('山線').keys()].filter(k => !onLine(T, '海線', k)));
  const cOnly = new Set([...OWN[T].lineIdx.get('海線').keys()].filter(k => !onLine(T, '山線', k)));
  const real = {};
  for (const sys of SYSTEMS) {
    const idx = new Map(), cOf = classOfFor(sys);
    const trains = sys === T ? aliasCanonicalClone(SAMPLE[sys]) : SAMPLE[sys];
    for (const tr of trains) {
      if (tr.loop || tr.est || tr.stops._prevNight) continue;
      const s = tr.stops, cls = cOf(tr), stopIdx = [];
      s.forEach((x, i) => { if (x.stop !== false) stopIdx.push(i); });
      for (let x = 0; x < stopIdx.length; x++) {
        let via = null;
        for (let y = x + 1; y < stopIdx.length; y++) {
          const i = stopIdx[x], j = stopIdx[y];
          for (let q = stopIdx[y - 1] + 1; q < j; q++) {
            const k = ownKey(sys, s[q].name);
            if (mOnly.has(k)) via = 'mountain'; else if (cOnly.has(k)) via = 'coast';
          }
          if (y > x + 1) { const k = ownKey(sys, s[stopIdx[y - 1]].name); if (mOnly.has(k)) via = 'mountain'; else if (cOnly.has(k)) via = 'coast'; }
          const sec = s[j].arrSec - (s[i].dep0 != null ? s[i].dep0 : s[i].depSec);
          if (!(sec > 0)) continue;
          const key = `${cls}\t${ownKey(sys, s[i].name)}\t${ownKey(sys, s[j].name)}`;
          if (!idx.has(key)) idx.set(key, []);
          idx.get(key).push({ sec, mid: y - x - 1, via });
        }
      }
    }
    real[sys] = idx;
  }
  const rows = [], perSys = { tra_sched: 0, thsr_sched: 0, afr_sched: 0 };
  let outside = 0, minR = null, maxR = null;
  for (const e of RESULTS) {
    const m = MyTrainPlan.MODELS[e.id];
    for (const [pattern, res] of Object.entries(e.byPattern)) {
      const route = res.route, key = `${m.cls}\t${route.stops[0].key}\t${route.stops.at(-1).key}`;
      let pool = (real[e.sys].get(key) || []).filter(r => !route.viaChoice || r.via === route.via);
      if (pattern === 'express') pool = pool.filter(r => r.mid === 0);
      if (pool.length < 3) continue;
      const ourMid = res.timetable.stops.slice(1, -1).filter(s => s.stop).length;
      const mids = pool.map(r => r.mid);
      if (ourMid < Math.min(...mids) || ourMid > Math.max(...mids)) continue;
      perSys[e.sys]++;
      const secs = pool.map(r => r.sec), fast = Math.min(...secs), slow = Math.max(...secs), ours = res.timetable.totalSec;
      const rf = ours / fast, rsl = ours / slow, tag = `${e.id} ${e.from}→${e.to}${route.via === 'coast' ? '（海線）' : ''} ${pattern}`;
      if (rf < 0.9 || rsl > 1.1) outside++;
      if (!minR || rf < minR.v) minR = { v: rf, tag };
      if (!maxR || rsl > maxR.v) maxR = { v: rsl, tag };
      if (m.pushDown && rf >= 0.9) continue;   // 往下壓的車款只列比最快那班 0.9 倍還快的
      rows.push([e.id, e.from, e.to, route.via || '', pattern, (ours / 60).toFixed(1), (fast / 60).toFixed(1), (slow / 60).toFixed(1),
        rf.toFixed(3), rsl.toFixed(3), pool.length].join('\t'));
    }
  }
  const total = perSys.tra_sched + perSys.thsr_sched + perSys.afr_sched;
  console.log(`   有真車可比的組合：台鐵 ${perSys.tra_sched}、高鐵 ${perSys.thsr_sched}、林鐵 ${perSys.afr_sched}，合計 ${total}`);
  if (minR) console.log(`   落在「最快 ×0.9～最慢 ×1.1」以外：${outside} 組；最小（÷最快）${minR.v.toFixed(3)} ${minR.tag}；最大（÷最慢）${maxR.v.toFixed(3)} ${maxR.tag}`);
  for (const sys of SYSTEMS) check(perSys[sys] >= 1, `${sys} 至少一組有真車可比`, String(perSys[sys]));
  check(total >= 10, '有真車可比的組合合計至少 10 組', String(total));
  // 報表寫到 gitignored 的 output/，而且確認 .assetsignore 也擋著（不會被當靜態資產上傳）。
  const REPORT_REL = 'output/my-train-plan-report.tsv';
  const ignored = spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', REPORT_REL]).status === 0;
  const assets = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8').split('\n').some(l => ['output', 'output/'].includes(l.trim()));
  check(ignored, `${REPORT_REL} 被 .gitignore 擋住（不進版控）`);
  check(assets, '.assetsignore 有 output（不會被上傳）');
  if (ignored && assets) {
    fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, REPORT_REL),
      ['車款\t起站\t訖站\t經由\t停站方式\t自製車分鐘\t真車最快分鐘\t真車最慢分鐘\t除以最快\t除以最慢\t真車班數', ...rows].join('\n') + '\n');
    console.log(`   報表：${REPORT_REL}（${rows.length} 行）`);
  }
});

// ═══ 儲存（my-train-ui.js 的 load／save）═══
// 只抽儲存那五個函式＋兩個常數出來跑（檔案其他部分會碰 DOM）；localStorage 用替身，MyTrainPlan 用上面載入的那一份。
section('儲存', () => {
  const src = read('my-train-ui.js');
  const store = new Map();
  const flags = { failGet: false, failSet: false };
  const localStorage = {
    getItem: k => { if (flags.failGet) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (flags.failSet) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  const ctx = vm.createContext({ localStorage, MyTrainPlan: planCtx.MyTrainPlan });
  vm.runInContext([extractConst(src, 'STORAGE_KEY'), extractConst(src, 'HALO_SIZES'),
    ...['storeDefaults', 'storeSanitizeTrain', 'storeSanitize', 'storeLoad', 'storeSave'].map(n => extractFunction(src, n)),
    'globalThis.__ui = { STORAGE_KEY, load: storeLoad, save: storeSave };'].join('\n'), ctx);
  const UI = ctx.__ui, KEY = 'trainmap-my-train-v1';
  const js = x => JSON.stringify(x);
  const DEFAULTS = { v: 1, appearance: { haloOn: true, haloSize: 'std' }, train: null };
  check(UI.STORAGE_KEY === KEY, `localStorage 鍵是 ${KEY}`);
  check(/globalThis\.MyTrainUI\s*=\s*\{/.test(src) && /\bSTORAGE_KEY\s*[,}\n]/.test(src) && /load:\s*storeLoad\b/.test(src) && /save:\s*storeSave\b/.test(src),
    'MyTrainUI 對外的 STORAGE_KEY／load／save 就是這幾個函式');
  // color 用 emu800 自己系統的合法值(且恰為它的預設色)，round-trip 才會是 no-op，才能拿 TRAIN 原樣當期望值比對。
  const TRAIN = { id: 'my:0f8e2d1c-aaaa-4bbb-8ccc-123456789abc', name: '520', modelId: 'emu800', sys: 'tra_sched',
    from: '台北', to: '花蓮', via: null, dir: null, pattern: 'major', depSec: 27000, color: '#2E6FB0' };
  const put = obj => store.set(KEY, typeof obj === 'string' ? obj : js(obj));
  store.clear();
  check(js(UI.load()) === js(DEFAULTS), '沒有存過 → 預設值（光環開、標準、沒有車）', js(UI.load()));
  flags.failGet = true;
  let threw = false, got = null;
  try { got = UI.load(); } catch { threw = true; }
  flags.failGet = false;
  check(!threw && js(got) === js(DEFAULTS), '讀 localStorage 丟錯 → 預設值、不丟錯');
  for (const bad of ['{', '"x"', 'null', '[]', js({ v: 2, appearance: { haloOn: false }, train: TRAIN })]) {
    put(bad);
    check(js(UI.load()) === js(DEFAULTS), `壞掉的內容 ${bad.slice(0, 24)} → 當作沒有自製車`);
  }
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: TRAIN });
  check(js(UI.load()) === js({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: TRAIN }), '對照組：完整的內容原樣讀回');
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: { ...TRAIN, name: IDEO + '自強520\n' } });
  check(UI.load().train.name === '自強520', '名字讀回來是正規化過的');
  // 車牌顏色：color 欄位存檔/讀回的三種邊界情況（跟 my-train-ui.js 的 storeSanitizeTrain 對）。
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: (() => { const { color, ...rest } = TRAIN; return rest; })() });
  check(UI.load().train.color === MyTrainPlan.defaultColor('emu800'), '舊紀錄沒有 color 欄 → 補上這款車的預設色');
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: { ...TRAIN, color: '#ff2bd6' } });
  check(UI.load().train.color === MyTrainPlan.defaultColor('emu800'), '存檔內容混進不合法的顏色（舊版螢光色）→ 回退預設色，不是原樣收下');
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: { ...TRAIN, color: '#e8792b' } });
  check(UI.load().train.color === '#E8792B', '合法值大小寫不拘 → 回傳色盤標準寫法');
  // 順行／逆行：dir 欄位。舊紀錄沒有這欄＝走最短那邊（null）。
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: (() => { const { dir, ...rest } = TRAIN; return rest; })() });
  check(UI.load().train && UI.load().train.dir === null, '舊紀錄沒有 dir 欄 → dir null（走最短那邊）');
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: { ...TRAIN, dir: 'shun' } });
  check(UI.load().train && UI.load().train.dir === 'shun', 'dir 順行原樣讀回');
  put({ v: 1, appearance: { haloOn: false, haloSize: 'xl' }, train: { ...TRAIN, modelId: 'retired-model' } });
  check(UI.load().train && UI.load().train.modelId === 'retired-model', '車款不在表裡的照樣讀回（失效提示要用名字）');
  const broken = [['id', 'x'], ['id', 'my:'], ['name', ''], ['name', '一二三四五六七八九十一二三'], ['modelId', ''], ['sys', 'krtc'],
    ['from', ''], ['to', 5], ['via', 'sea'], ['dir', 'east'], ['dir', 1], ['pattern', 'fast'], ['depSec', 86400], ['depSec', -1], ['depSec', 1.5], ['depSec', '27000']];
  for (const [k, v] of broken) {
    put({ v: 1, appearance: { haloOn: false, haloSize: 'lg' }, train: { ...TRAIN, [k]: v } });
    const r = UI.load();
    check(r.train === null && r.appearance.haloOn === false && r.appearance.haloSize === 'lg', `train.${k} = ${js(v)} → 沒有車、外觀留著`);
  }
  put({ v: 1, appearance: { haloOn: 'yes', haloSize: 'huge' }, train: null });
  check(js(UI.load().appearance) === js({ haloOn: true, haloSize: 'std' }), '外觀的值不認得 → 用預設');
  store.clear();
  check(UI.save({ appearance: { haloOn: false, haloSize: 'lg' }, train: TRAIN }) === true
    && store.get(KEY) === js({ v: 1, appearance: { haloOn: false, haloSize: 'lg' }, train: TRAIN }), 'save 寫進去的是正規化後的完整內容');
  const before = store.get(KEY);
  check(UI.save({ appearance: { haloOn: true, haloSize: 'std' }, train: { ...TRAIN, depSec: 99999 } }) === false && store.get(KEY) === before,
    '不合格的車 → save 回 false、原本存的不動');
  check(UI.save({ appearance: { haloOn: false, haloSize: 'lg' }, train: null }) === true && JSON.parse(store.get(KEY)).train === null
    && JSON.parse(store.get(KEY)).appearance.haloSize === 'lg', '刪掉這班（train: null）→ 外觀留著');
  flags.failSet = true;
  threw = false; let ok = null;
  try { ok = UI.save({ appearance: { haloOn: true, haloSize: 'std' }, train: TRAIN }); } catch { threw = true; }
  flags.failSet = false;
  check(!threw && ok === false, '寫 localStorage 丟錯 → 回 false、不丟錯');
});

// ═══ golden fixture，給原生 App（Kotlin 逐字翻譯版）驗收用 ═══
// 期望值不跟實作同源：golden 的關鍵衍生數字（stops/km/totalSec/dep/arr）另外寫死在
// GOLDEN_EXPECTED，人工核對過才能更新這個表格，不是腳本自己算出來再存回去自己比自己（那樣資料一換、
// 台鐵 14 天滾動窗一滾過去，golden 就被無聲覆寫、原生端對著沒人看過的新基準驗收照樣全綠）。
// GOLDEN_PINNED_TRA_DATE：台鐵那一班（emu800）依賴的日期，本輪核可時等於 TRA_DATES[1]。班表已釘在
// FIXTURE_REF（見檔頭「資料」段），不會自己滾走；換 FIXTURE_REF 時下面這條會轉紅——那是提醒人工核對
// 新一天的排班合理之後，同時更新這個常數跟 GOLDEN_EXPECTED，不是自動跟著資料漂移。高鐵、林鐵那兩班
// 用的是單一快照日期（data/thsr_schedule_dense.json、afr_schedule_dense.json 的 .date），不是滾動窗，
// 不需要另外釘。
const GOLDEN_PINNED_TRA_DATE = '2026-09-19';
const GOLDEN_EXPECTED = {
  'emu800-taipei-hualien-major': { stops: 46, km: 194.662372, totalSec: 9709, depSec: 28800, arrSec: 38509 },
  '700t-nangang-zuoying-express': { stops: 12, km: 349.3049, totalSec: 5597, depSec: 32400, arrSec: 37997 },
  'dl25-chiayi-fenchihu-all': { stops: 10, km: 45.8806, totalSec: 15458, depSec: 27000, arrSec: 42458 },
};
section('golden fixture（三班代表車，寫到 output/golden/mytrain）', () => {
  check(DAY.tra_sched.date === GOLDEN_PINNED_TRA_DATE,
    `golden fixture 釘的台鐵日期跟班表快照一致（${GOLDEN_PINNED_TRA_DATE}）`,
    `resolveScheduleDay 現在給 ${DAY.tra_sched.date}——班表換了一份（FIXTURE_REF 或 MYTRAIN_DATA=disk），emu800 那班 golden 的期望值可能整批要換；` +
    '人工核對新一天的排班合理之後，同時更新 FIXTURE_REF、GOLDEN_PINNED_TRA_DATE 與 GOLDEN_EXPECTED，不要讓它自己跟著漂');

  const goldenDir = process.env.MYTRAIN_GOLDEN_DIR || path.join(ROOT, 'output', 'golden', 'mytrain');
  fs.mkdirSync(goldenDir, { recursive: true });

  // 三班代表車：saved 原文與釘死的時鐘（depSec）都寫死在這裡，不吃當下時間、不吃環境。
  const GOLDEN_CASES = [
    { key: 'emu800-taipei-hualien-major', label: 'EMU800 臺北→花蓮 只停大站',
      // from/to 一律是站鍵（MyTrainPlan.stationKey 的結果），不是顯示名：台鐵「臺北」的站鍵是「台北」（臺→台）。
      saved: { id: 'my:golden0001-aaaa-bbbb-cccc-000000000001', name: '520', modelId: 'emu800', sys: 'tra_sched',
        from: MyTrainPlan.stationKey('tra_sched', '臺北'), to: MyTrainPlan.stationKey('tra_sched', '花蓮'),
        via: null, pattern: 'major', depSec: 8 * 3600 } },
    { key: '700t-nangang-zuoying-express', label: '700T 南港→左營 直達',
      saved: { id: 'my:golden0002-aaaa-bbbb-cccc-000000000002', name: '700T', modelId: '700t', sys: 'thsr_sched',
        from: MyTrainPlan.stationKey('thsr_sched', '南港'), to: MyTrainPlan.stationKey('thsr_sched', '左營'),
        via: null, pattern: 'express', depSec: 9 * 3600 } },
    { key: 'dl25-chiayi-fenchihu-all', label: '林鐵機車(DL25) 嘉義→奮起湖 站站停',
      saved: { id: 'my:golden0003-aaaa-bbbb-cccc-000000000003', name: '嘉義號', modelId: 'dl25', sys: 'afr_sched',
        from: MyTrainPlan.stationKey('afr_sched', '嘉義'), to: MyTrainPlan.stationKey('afr_sched', '奮起湖'),
        via: null, pattern: 'all', depSec: 7 * 3600 + 1800 } },
  ];

  // JSON 要 stable：物件鍵排序固定、浮點數固定到小數 6 位（整數與布林、字串原樣）。
  const roundFloat = n => Math.round(n * 1e6) / 1e6;
  const canon = v => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v).sort()) out[k] = canon(v[k]); return out; }
    if (typeof v === 'number' && !Number.isInteger(v)) return roundFloat(v);
    return v;
  };
  const stripUnderscore = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));
  // buildRunStats 用到的分組統計摘要：這班車時刻表每一段實際用到的組（組名／樣本數／中位數），加停車時間那一組。
  const summarize = (res, m) => {
    const seen = new Map();
    for (const g of res.timetable.segs) {
      const key = `${g.group.sys}|${g.group.cls}|${g.group.bucket}`;
      if (!seen.has(key)) seen.set(key, { group: key, n: g.group.n, kmhMedian: g.group.kmh });
    }
    const dw = res.stats.dwell[m.cls];
    const dwellGroup = dw && dw.n > 0 ? { group: `${m.sys}|${m.cls}|dwell`, n: dw.n, secMedian: dw.sec }
      : { group: `${m.sys}|*|dwell`, n: res.stats.sysDwell.n, secMedian: res.stats.sysDwell.sec };
    return { speedGroups: [...seen.values()], dwellGroup };
  };

  const t = tally(['golden fixture 排得出來', '關鍵衍生數字對得上人工核可過的期望值（不是自己跟自己比）']);
  const built = new Map();   // key → canon(payload)，寫檔與讀回比對都用同一份，不重算
  for (const c of GOLDEN_CASES) {
    const sys = c.saved.sys, m = MyTrainPlan.MODELS[c.saved.modelId], ctx = ctxFor(sys);
    const res = MyTrainPlan.planTrain(c.saved, ctx);
    t.expect('golden fixture 排得出來', res.ok, `${c.key} ${res.ok ? '' : res.reason}`);
    if (!res.ok) continue;
    const want = GOLDEN_EXPECTED[c.key];
    const got = { stops: res.timetable.stops.length, km: roundFloat(res.route.km), totalSec: res.timetable.totalSec,
      depSec: c.saved.depSec, arrSec: res.timetable.stops.at(-1).arrSec };
    t.expect('關鍵衍生數字對得上人工核可過的期望值（不是自己跟自己比）',
      !!want && got.stops === want.stops && Math.abs(got.km - want.km) < 1e-6 && got.totalSec === want.totalSec
        && got.depSec === want.depSec && got.arrSec === want.arrSec,
      `${c.key}：新 ${JSON.stringify(got)} vs 舊（人工核可過的）${JSON.stringify(want)}`);
    const payload = canon({
      meta: { key: c.key, label: c.label, pinnedDate: DAY[sys].date, sys, modelId: c.saved.modelId, generatedBy: 'scripts/verify_my_train_plan.mjs' },
      saved: c.saved,
      record: stripUnderscore(res.record),
      timetable: res.timetable,
      statsSummary: summarize(res, m),
    });
    built.set(c.key, payload);
    fs.writeFileSync(path.join(goldenDir, c.key + '.json'), JSON.stringify(payload, null, 2) + '\n');
  }
  t.report();
  check(built.size === GOLDEN_CASES.length, `golden fixture 全部寫出：${built.size}／${GOLDEN_CASES.length}`);

  // 腳本自己加斷言：golden 檔存在、可 JSON.parse、三班都在、而且同一輪內寫出後再讀回來與記憶體中的物件深度相等。
  const filesExist = GOLDEN_CASES.every(c => fs.existsSync(path.join(goldenDir, c.key + '.json')));
  check(filesExist, '三個 golden 檔都存在');
  let parseOk = true, roundtripOk = true;
  for (const c of GOLDEN_CASES) {
    const p = path.join(goldenDir, c.key + '.json');
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { parseOk = false; continue; }
    if (JSON.stringify(parsed) !== JSON.stringify(built.get(c.key))) roundtripOk = false;
  }
  check(parseOk, '三個 golden 檔都能 JSON.parse');
  check(roundtripOk, '寫出後讀回來，與記憶體中的物件深度相等（逐 byte 穩定）');
  console.log(`   golden fixture 目錄：${goldenDir}`);
  console.log('   原生端對應位置：native/parity/golden/modules/mytrain/（另一個私有 repo，複製過去即可，本腳本不寫）');
});

// ── 事件列的時間運算。期望值全部手算、寫成字面，不拿實作當期望值 ──
section('事件列的時間運算', () => {
  const M = MyTrainPlan;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // tripRel＝距離本趟發車幾秒
  check(M.tripRel(27000, 27000) === 0, 'tripRel：發車那一刻是 0', String(M.tripRel(27000, 27000)));
  check(M.tripRel(26980, 27000) === 86380, 'tripRel：發車前 20 秒是 86380（不是 -20）', String(M.tripRel(26980, 27000)));
  check(M.tripRel(600, 85800) === 1200, 'tripRel：23:50 發車、00:10 是第 1200 秒（跨午夜不歸零）', String(M.tripRel(600, 85800)));

  // scanSpan：只有「連續前進」才掃；上限＝牆鐘秒數 × 倍速 + 5
  const sp = (...a) => M.scanSpan(...a).continuous;
  check(sp(null, 100, 0.5, 60) === false, 'scanSpan：還沒有上一次（剛打開）→ 不連續');
  check(sp(100, 130, 0.5, 60) === true, 'scanSpan：往前 30 秒 ≤ 0.5×60+5=35 → 連續');
  check(sp(100, 200, 0.5, 60) === false, 'scanSpan：往前 100 秒 > 35 → 不連續（往前跳）');
  check(sp(86390, 5, 0.5, 60) === true, 'scanSpan：跨午夜往前 15 秒 → 連續');
  check(sp(5000, 4000, 0.5, 60) === false, 'scanSpan：往回 1000 秒 → 不連續');
  check(sp(100, 104, 0.5, 1) === true && sp(100, 106, 0.5, 1) === false, 'scanSpan：1 倍速時上限是 0.5+5=5.5 秒（4 過、6 不過）');
  const s1 = M.scanSpan(100, 130, 0.5, 60);
  check(s1.from === 100 && s1.to === 130, 'scanSpan：from／to 原樣回傳上一次與這一次的模擬時刻', JSON.stringify(s1));

  // tripDay：牆鐘已過發車時刻＝今天，還沒過＝昨天
  check(M.tripDay(27000, 43200, 'D', 'D-1') === 'D', 'tripDay：07:30 那班、中午回來看 → 今天');
  check(M.tripDay(85800, 7200, 'D', 'D-1') === 'D-1', 'tripDay：23:50 那班、凌晨 2 點回來看 → 昨天那趟');
  check(M.tripDay(27000, 27000, 'D', 'D-1') === 'D', 'tripDay：牆鐘剛好等於發車時刻 → 今天');

  // stopEventsBetween：甲 10:00 發 → 乙 10:10 到 10:10:30 開 → 丙 通過 → 丁 10:30 到
  const TT = { stops: [
    { name: '甲', arrSec: 36000, depSec: 36000, stop: true },
    { name: '乙', arrSec: 36600, depSec: 36630, stop: true },
    { name: '丙', arrSec: 37200, depSec: 37200, stop: false },
    { name: '丁', arrSec: 37800, depSec: 37800, stop: true },
  ] };
  const kinds = evs => evs.map(e => `${e.kind}:${e.name}@${e.rel}`).join(',');
  const e1 = M.stopEventsBetween(TT, 86380, 30);
  check(kinds(e1) === 'depart:甲@0', 'stopEventsBetween：跨過發車點（86380→30）只有發車', kinds(e1));
  const e2 = M.stopEventsBetween(TT, 0, 1800);
  check(kinds(e2) === 'depart:甲@0,stop:乙@600,arrive:丁@1800', 'stopEventsBetween：整趟（0→1800）發車、停靠、抵達各一，通過站丙不出現', kinds(e2));
  const e3 = M.stopEventsBetween(TT, 601, 1799);
  check(e3.length === 0, 'stopEventsBetween：兩個時刻之間沒有停靠類事件就回空陣列', kinds(e3));
  const e4 = M.stopEventsBetween(TT, 1790, 86000);
  check(kinds(e4) === 'arrive:丁@1800', 'stopEventsBetween：抵達之後的空檔（1790→86000）只有抵達', kinds(e4));
  check(e2.every(e => typeof e.key === 'string' && e.key.length > 0), 'stopEventsBetween：每一筆都有 key（去重用）', JSON.stringify(e2));
  // 23:50 發車、跨午夜的班：本趟秒數照樣連續
  const TN = { stops: [
    { name: '甲', arrSec: 85800, depSec: 85800, stop: true },
    { name: '乙', arrSec: 86700, depSec: 86730, stop: true },
    { name: '丁', arrSec: 87600, depSec: 87600, stop: true },
  ] };
  const e5 = M.stopEventsBetween(TN, 0, 1000);
  check(kinds(e5) === 'depart:甲@0,stop:乙@900', 'stopEventsBetween：23:50 發車的班，乙在第 900 秒（00:05）', kinds(e5));

  // addEvent：去重前後都算、照 rel 插入、超過上限丟 rel 最小的
  const ev = (kind, key, rel) => ({ rel, simT: rel, kind, key, text: kind + key });
  const items = [];
  check(M.addEvent(items, ev('depart', '甲', 0)) === 0, 'addEvent：第一條插在 0');
  check(M.addEvent(items, ev('stop', '乙', 600)) === 1, 'addEvent：比最後一條大的插在最後');
  check(M.addEvent(items, ev('stop', '乙', 600)) === -1, 'addEvent：同一站的停靠第二次回 -1');
  check(M.addEvent(items, ev('stop', '乙', 640)) === -1, 'addEvent：同一站、時刻不同也只記一次（一趟一次）');
  check(M.addEvent(items, ev('meet', '123', 1000)) === 2, 'addEvent：交會插在最後');
  check(M.addEvent(items, ev('meet', '123', 1899)) === -1, 'addEvent：同一真車交會相隔 899 秒回 -1');
  check(M.addEvent(items, ev('meet', '123', 101)) === -1, 'addEvent：同一真車交會「早」899 秒也回 -1（前後都算）');
  check(M.addEvent(items, ev('pass', '123', 1200)) === -1, 'addEvent：交會與從旁通過共用去重（同一個 key 在 900 秒內）');
  check(M.addEvent(items, ev('meet', '123', 1901)) === 3, 'addEvent：同一真車相隔 901 秒可以再記');
  check(M.addEvent(items, ev('meet', '456', 700)) === 2, 'addEvent：rel 比最後一條小時插在中間');
  check(same(items.map(x => x.rel), [0, 600, 700, 1000, 1901]), 'addEvent：整串照 rel 由小到大', JSON.stringify(items.map(x => x.rel)));
  const capped = [ev('stop', 'a', 10), ev('stop', 'b', 20), ev('stop', 'c', 30)];
  const ci = M.addEvent(capped, ev('stop', 'd', 25), 3);
  check(ci === 1 && same(capped.map(x => x.rel), [20, 25, 30]), 'addEvent：超過上限丟 rel 最小的那條，回傳丟完之後的位置', `ret=${ci} rels=${JSON.stringify(capped.map(x => x.rel))}`);
  const capped2 = [ev('stop', 'a', 10), ev('stop', 'b', 20), ev('stop', 'c', 30)];
  const ci2 = M.addEvent(capped2, ev('stop', 'z', 5), 3);
  check(ci2 === -1 && same(capped2.map(x => x.rel), [10, 20, 30]), 'addEvent：新的那條本身就是最小、超過上限被丟掉 → 回 -1、原本三條不動', `ret=${ci2} rels=${JSON.stringify(capped2.map(x => x.rel))}`);
});

// ── 事件列：什麼時候要判斷「是不是新的一趟」──
// 一班 07:30 發車、全程 571 秒。期望值手算、寫成字面。
section('什麼時候判斷新的一趟', () => {
  const M = MyTrainPlan;
  check(M.tripDayCheck(true, 86380, 20, 571, 'D') === true, 'tripDayCheck：連續前進走過發車點 → 要判斷');
  check(M.tripDayCheck(true, 100, 130, 571, 'D') === false, 'tripDayCheck：連續前進、車在路上、已有發車日 → 不判斷（倍速跑到一半牆鐘過了發車時刻也不會中途清空）');
  check(M.tripDayCheck(true, 100, 130, 571, null) === true, 'tripDayCheck：還沒有發車日、第一次掃到車在路上 → 要判斷');
  check(M.tripDayCheck(false, NaN, 300, 571, 'D') === true, 'tripDayCheck：跳動落在路上（例如背景過夜、隔天回前景）→ 要判斷');
  check(M.tripDayCheck(false, NaN, 1000, 571, 'D') === false, 'tripDayCheck：跳動落在路外 → 不判斷');
  check(M.tripDayCheck(true, 600, 630, 571, null) === false, 'tripDayCheck：連續前進但車不在路上、沒走過發車點 → 不判斷');
  check(M.tripDayCheck(true, 571, 571, 571, null) === true, 'tripDayCheck：剛好停在抵達那一秒也算在路上');
});

// ── 總結 ──
console.log(`\n${failures === 0 ? '✅ 全部通過' : `❌ ${failures} 項不通過`}`);
process.exit(failures === 0 ? 0 : 1);

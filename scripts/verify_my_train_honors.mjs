#!/usr/bin/env node
// 自製列車成就的守門腳本（純 Node，幾秒內跑完）。
// 用法：node scripts/verify_my_train_honors.mjs → 全綠 exit 0；任何一條紅 exit 1。
// 🔴 37 枚每一枚都要有「該亮」與「不該亮」的案例，目錄裡有、案例沒有的會紅。
// 🔴 期望值不跟實作同源：除夕對 Intl 的農曆，路線標籤跑真實路網，日出日落用 rail-3d/environment/sun.mjs 的真太陽。
// 🔴 golden 寫到 output/golden/mytrain/honors.json（gitignored）。App 移植判定時拿這份逐枚比對。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { sunPosition } from '../rail-3d/environment/sun.mjs';
import { FORMATIONS, formationFor } from '../rail-3d/integration/formations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
let failures = 0;
function check(pass, label, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}
function section(title, fn) {
  console.log(`\n── ${title} ──`);
  try { fn(); } catch (e) {
    failures++;
    console.log(`❌ ${title}：丟錯 ${e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e}`);
  }
}

const ctx = vm.createContext({ console, atob });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'my-train-plan.js'), 'utf8'), ctx, { filename: 'my-train-plan.js' });
const P = ctx.MyTrainPlan;
const js = x => JSON.stringify(x);

// ── 案例的零件 ──
const LEG = { day: '2026-01-01', km: 100, stops: 5, dep: 8 * 3600, dur: 3600, tags: [], rise: null, set: null, meets: 0, twin: false, kin: [] };
const leg = over => ({ ...LEG, ...over });
const segment = over => { const { day, ...rest } = leg(over); return rest; };   // legOf 回傳的形狀：還沒有起始日
const train = over => ({ id: 'my:aaaaaaaa', name: '甲', modelId: 'emu800', sys: 'tra_sched', from: 'a', to: 'b', via: null, dir: null, pattern: 'all',
  depSec: LEG.dep, color: '#2E6FB0', ...P.fleetFields({ track: 0, firstDay: '2026-01-01', legs: [LEG] }), ...over });
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const noon = 12 * 3600, D0 = '2026-01-01';
const msOf = (day, sec = 0) => Date.parse(day + 'T00:00:00+08:00') + sec * 1000;
const golden = [];
const judge = (t, today, nowSec = 0, sun) => {
  const out = P.judgeTrain(t, today, nowSec, sun);
  golden.push({ fn: 'judgeTrain', train: t, today, nowSec, sun: !!sun, earned: out.earned, judged: out.judged });
  return out;
};
const earnedAt = (t, today, nowSec, sun) => judge(t, today, nowSec, sun).earned;
const hand = (t, run, l, today) => {
  const out = P.addHandRun(t, 'dev-aaaaaaaa', run, l, today);
  golden.push({ fn: 'addHandRun', train: t, run, leg: l, today, earned: out.earned, hand: out.hand, firstDay: out.firstDay });
  return out;
};
const finish = (t, sun) => {
  const out = P.finishRun(t, sun);
  golden.push({ fn: 'finishRun', train: t, sun: !!sun, earned: out.earned });
  return out;
};
const fleetJudge = (trains, today = D0, nowSec = 0, nowMs = msOf(today, nowSec), earned = {}, sun) => {
  const out = P.judgeFleet({ trains, earned }, today, nowSec, nowMs, sun);
  golden.push({ fn: 'judgeFleet', fleet: { trains, earned }, today, nowSec, nowMs, sun: !!sun, earned: out.earned, trains: out.trains.map(t => t.earned), fresh: out.fresh });
  return out;
};
const weather = (samples, start, end) => {
  const out = P.weatherHonors(samples, start, end);
  golden.push({ fn: 'weatherHonors', samples, start, end, out });
  return Object.fromEntries(out.map(k => [k, D0]));
};
// 真實路網
const G = { tra: P.buildGraph(readJSON('data/tra.json').lines, 'tra_sched'), afr: P.buildGraph(readJSON('data/afr.json').lines, 'afr_sched') };
const key = (sys, name) => P.stationKey(sys === 'afr' ? 'afr_sched' : 'tra_sched', name);
// 時刻只要拿來算經過太麻里與海線的秒數，1 公里 1 分鐘就夠。
function realLeg(sys, from, to, opts, dep = 8 * 3600) {
  const route = P.findRoute(G[sys], key(sys, from), key(sys, to), opts);
  if (!route.ok) throw new Error(`${from}→${to} 找不到路：${route.reason}`);
  const stops = route.stops.map(s => ({ arrSec: dep + Math.round(s.km * 60), depSec: dep + Math.round(s.km * 60) }));
  return leg({ ...P.routeTraits(G[sys], route, stops), dep, dur: Math.round(route.km * 60), km: route.km, _route: route });
}
const tags = (...a) => realLeg(...a).tags;
const ran = (l, day = '2026-03-10') => {
  const { _route, ...plain } = l;
  return train({ firstDay: day, legs: [{ ...plain, day }] });
};
const afterRun = (l, day = '2026-03-10', sun) => earnedAt(ran(l, day), addDays(day, 1), 0, sun);

// ── 37 枚的案例：id → { yes: [[說明, 回傳 earned 的函式]…], no: […] } ──
const nDays = (n, over = {}) => train({ legs: [leg(over)], ...over._t }), todayAfter = n => addDays(D0, n);
const stat = (n, over) => () => earnedAt(nDays(n, over), todayAfter(n));
const handTimes = n => train({ hand: { 'dev-aaaaaaaa': { n, km: 0, stops: 0, meets: 0 } } });
const press = dep => () => hand(train({ legs: [], firstDay: '2026-03-10' }), { at: msOf('2026-03-09', dep), dep, dur: 3600 }, LEG, '2026-03-09').earned;
const sunDay = '2026-11-05';
// 太麻里的日出時刻：真太陽逐分鐘掃到高度角過 0。
const riseSec = (() => { for (let s = 3 * 3600; s < 9 * 3600; s += 60) if (sunPosition(msOf(sunDay, s), 22.619, 121.005).elevation >= 0) return s; throw new Error('掃不到日出'); })();
const setSec = (() => { for (let s = 15 * 3600; s < 20 * 3600; s += 60) if (sunPosition(msOf(sunDay, s), 24.492, 120.678).elevation <= -.83) return s; throw new Error('掃不到日落'); })();
const eastbound = dep => realLeg('tra', '枋寮', '臺東', null, dep);   // 這段經過太麻里
const atTaimali = sec => { const l = eastbound(0); return eastbound(sec - l.rise); };
const coastRun = (startSec, spanSec) => { const l = realLeg('tra', '竹南', '彰化', { via: 'coast' }, startSec); return { ...l, set: [0, spanSec], dur: spanSec + 600 }; };
const fleetOf = n => Array.from({ length: n }, (_, i) => train({ id: `my:bbbbbbb${i}`, track: i, modelId: `m${i}`, legs: [leg({ dep: i * 3600 })] }));
const CASES = {
  maiden: {
    yes: [['當天的班次跑完', () => earnedAt(train(), D0, LEG.dep + LEG.dur)], ['親手發車按下去就拿到', () => hand(train({ legs: [] }), { at: msOf(D0, noon), dep: noon, dur: 60 }, LEG, D0).earned]],
    no: [['當天的班次還沒跑完', () => earnedAt(train(), D0, LEG.dep + LEG.dur - 1)], ['首航日還沒到', () => earnedAt(train({ firstDay: '2026-01-02' }), D0, noon)]],
  },
  days10: { yes: [['跑滿 10 天', stat(10)]], no: [['9 天', stat(9)]] },
  days100: { yes: [['跑滿 100 天', stat(100)]], no: [['99 天', stat(99)]] },
  days365: { yes: [['跑滿 365 天', stat(365)]], no: [['364 天', stat(364)]] },
  km1k: { yes: [['累計 1,000 公里', stat(10)]], no: [['900 公里', stat(9)]] },
  km10k: { yes: [['累計 10,000 公里', stat(100)]], no: [['9,900 公里', stat(99)]] },
  earth: { yes: [['41,000 公里', stat(41, { km: 1000 })]], no: [['40,000 公里', stat(40, { km: 1000 })]] },
  moon: { yes: [['385,000 公里', stat(385, { km: 1000 })]], no: [['384,000 公里', stat(384, { km: 1000 })]] },
  hand100: { yes: [['親手 100 次', () => earnedAt(handTimes(100), D0)]], no: [['99 次', () => earnedAt(handTimes(99), D0)]] },
  dawn: { yes: [['5:59:59 發車', press(6 * 3600 - 1)]], no: [['6:00 發車', press(6 * 3600)]] },
  late: { yes: [['23:00 發車', press(23 * 3600)]], no: [['22:59:59 發車', press(23 * 3600 - 1)]] },
  east: { yes: [['花蓮到臺東', () => afterRun(realLeg('tra', '花蓮', '臺東'))], ['臺東到花蓮，反方向', () => afterRun(realLeg('tra', '臺東', '花蓮'))]], no: [['只跑到玉里', () => afterRun(realLeg('tra', '花蓮', '玉里'))]] },
  south: { yes: [['枋寮到臺東', () => afterRun(realLeg('tra', '枋寮', '臺東'))], ['臺東到枋寮，反方向', () => afterRun(realLeg('tra', '臺東', '枋寮'))]], no: [['只到大武', () => afterRun(realLeg('tra', '枋寮', '大武'))]] },
  loop: {
    yes: [['七堵繞一圈到八堵', () => afterRun(realLeg('tra', '七堵', '八堵', { dir: 'shun' }))], ['八堵繞一圈到七堵，反方向', () => afterRun(realLeg('tra', '八堵', '七堵', { dir: 'ni' }))]],
    no: [['臺北到臺東只走半圈', () => afterRun(realLeg('tra', '臺北', '臺東'))]],
  },
  coast: { yes: [['竹南到彰化走海線', () => afterRun(realLeg('tra', '竹南', '彰化', { via: 'coast' }))]], no: [['走山線', () => afterRun(realLeg('tra', '竹南', '彰化', { via: 'mountain' }))], ['只到大甲', () => afterRun(realLeg('tra', '竹南', '大甲', { via: 'coast' }))]] },
  alishan: { yes: [['嘉義到奮起湖', () => afterRun(realLeg('afr', '嘉義', '奮起湖'))]], no: [['神木到阿里山不算開上主線', () => afterRun(realLeg('afr', '神木', '阿里山'))]] },
  meet1: { yes: [['一趟交會一班', stat(1, { meets: 1 })]], no: [['掃過但沒有交會', stat(10, { meets: 0 })], ['還沒掃', stat(10, { meets: null })]] },
  meet100: { yes: [['100 次', stat(100, { meets: 1 })]], no: [['99 次', stat(99, { meets: 1 })]] },
  meet1k: { yes: [['1,000 次', stat(100, { meets: 10 })]], no: [['990 次', stat(99, { meets: 10 })]] },
  twin: { yes: [['路上有同款真車', () => afterRun(leg({ twin: true }))]], no: [['沒有同款真車', () => afterRun(leg())]] },
  kin: {
    yes: [['路上遇到自己另一列', () => afterRun(leg({ kin: ['my:bbbbbbbb'] }))], ['被另一列掃到也算', () => fleetJudge([train(), train({ id: 'my:bbbbbbbb', track: 1, legs: [leg({ kin: ['my:aaaaaaaa'] })] })]).trains[0].earned]],
    no: [['沒遇到', () => afterRun(leg())]],
  },
  sunrise: {
    yes: [['日出時經過太麻里', () => afterRun(atTaimali(riseSec), sunDay, sunPosition)]],
    no: [['中午經過', () => afterRun(atTaimali(noon), sunDay, sunPosition)], ['傍晚太陽一樣低', () => afterRun(atTaimali(17 * 3600 - 300), sunDay, sunPosition)], ['走別的路線', () => afterRun(leg({ dep: riseSec }), sunDay, sunPosition)]],
  },
  sunset: {
    yes: [['進海線時太陽還在、出海線時落了', () => afterRun(coastRun(setSec - 1800, 3600), sunDay, sunPosition)]],
    no: [['整段都在太陽落下前', () => afterRun(coastRun(setSec - 7200, 3600), sunDay, sunPosition)], ['進海線時太陽已經落了', () => afterRun(coastRun(setSec + 600, 3600), sunDay, sunPosition)]],
  },
  tropic: { yes: [['臺北到高雄', () => afterRun(realLeg('tra', '臺北', '高雄'))], ['高雄到臺北，反方向', () => afterRun(realLeg('tra', '高雄', '臺北'))]], no: [['臺北到臺中', () => afterRun(realLeg('tra', '臺北', '臺中'))]] },
  midnight: { yes: [['23:30 開一小時', () => afterRun(leg({ dep: 23.5 * 3600 }))]], no: [['22:00 開一小時', () => afterRun(leg({ dep: 22 * 3600 }))]] },
  newyear: {
    yes: [['12/31 跨過午夜', () => afterRun(leg({ dep: 23.5 * 3600 }), '2026-12-31')]],
    no: [['12/30 跨過午夜', () => afterRun(leg({ dep: 23.5 * 3600 }), '2026-12-30')], ['12/31 白天', () => afterRun(leg(), '2026-12-31')]],
  },
  lunar: {
    yes: [['除夕晚上', () => afterRun(leg({ dep: 20 * 3600 }), '2027-02-05')], ['17:30 開、18:30 到', () => afterRun(leg({ dep: 17.5 * 3600 }), '2027-02-05')], ['前一天開過來，隔天晚上才到', () => afterRun(leg({ dep: 23 * 3600, dur: 20 * 3600 }), '2027-02-04')]],
    no: [['除夕早上', () => afterRun(leg(), '2027-02-05')], ['除夕前一晚', () => afterRun(leg({ dep: 20 * 3600 }), '2027-02-04')]],
  },
  birthday: {
    yes: [['首航週年', () => earnedAt(train({ legs: [leg()] }), '2027-01-02')], ['02-29 的車平年算 02-28', () => earnedAt(train({ firstDay: '2028-02-29', legs: [leg({ day: '2028-02-29' })] }), '2029-03-01')]],
    no: [['週年前一天', () => earnedAt(train({ legs: [leg()] }), '2027-01-01')], ['首航當天不算', () => earnedAt(train({ legs: [leg()] }), '2026-01-02')]],
  },
  rain: { yes: [['取樣到雨', () => weather([{ at: 0, rain: true, fog: 0 }], 0, 3600e3)]], no: [['都沒下', () => weather([{ at: 0, rain: false, fog: 0 }], 0, 3600e3)]] },
  fog: {
    yes: [['隔 5 分鐘都在霧裡', () => weather([{ at: 0, rain: false, fog: .6 }, { at: 300e3, rain: false, fog: .6 }], 0, 3600e3)]],
    no: [['只碰到一下', () => weather([{ at: 0, rain: false, fog: .6 }, { at: 299e3, rain: false, fog: .6 }], 0, 3600e3)], ['霧太淡', () => weather([{ at: 0, rain: false, fog: .4 }, { at: 600e3, rain: false, fog: .4 }], 0, 3600e3)]],
  },
  clear: {
    yes: [['出發下雨、抵達放晴', () => weather([{ at: 300e3, rain: true, fog: 0 }, { at: 3300e3, rain: false, fog: 0 }], 0, 3600e3)]],
    no: [['抵達還在下', () => weather([{ at: 300e3, rain: true, fog: 0 }, { at: 3300e3, rain: true, fog: 0 }], 0, 3600e3)], ['出發時沒下', () => weather([{ at: 1800e3, rain: true, fog: 0 }, { at: 3300e3, rain: false, fog: 0 }], 0, 3600e3)], ['中途下車沒看到抵達', () => weather([{ at: 300e3, rain: true, fog: 0 }, { at: 1800e3, rain: false, fog: 0 }], 0, 3600e3)]],
  },
  full: { yes: [['六股都有車', () => fleetJudge(fleetOf(6)).earned]], no: [['五股', () => fleetJudge(fleetOf(5)).earned]] },
  five: {
    yes: [['5 列的時段重疊', () => fleetJudge(fleetOf(5).map(t => ({ ...t, legs: [leg({ dur: 10 * 3600 })] }))).earned]],
    no: [['4 列重疊', () => fleetJudge(fleetOf(5).map((t, i) => ({ ...t, legs: [leg({ dep: i < 4 ? 3600 : 8 * 3600, dur: 3600 })] }))).earned]],
  },
  three: {
    yes: [['三個系統都有', () => fleetJudge(fleetOf(3).map((t, i) => ({ ...t, sys: ['tra_sched', 'thsr_sched', 'afr_sched'][i] }))).earned]],
    no: [['少一個系統', () => fleetJudge(fleetOf(3).map((t, i) => ({ ...t, sys: ['tra_sched', 'thsr_sched', 'tra_sched'][i] }))).earned]],
  },
  dex: { yes: [['6 款都不同', () => fleetJudge(fleetOf(6)).earned]], no: [['有 2 列同款', () => fleetJudge(fleetOf(6).map((t, i) => (i === 5 ? { ...t, modelId: 'm0' } : t))).earned]] },
  km100k: {
    yes: [['車隊加總 100,000 公里', () => fleetJudge(fleetOf(2).map(t => ({ ...t, hand: { 'dev-aaaaaaaa': { n: 1, km: 5e4, stops: 0, meets: 0 } } })), D0).earned]],
    no: [['99,999.8 公里', () => fleetJudge(fleetOf(2).map(t => ({ ...t, hand: { 'dev-aaaaaaaa': { n: 1, km: 49999.9, stops: 0, meets: 0 } } })), D0).earned]],
  },
  sun: {
    yes: [['四列接成一整天', () => fleetJudge(fleetOf(4).map((t, i) => ({ ...t, legs: [leg({ dep: i * 6 * 3600, dur: 6 * 3600 })] }))).earned], ['過午夜那段補到清晨', () => fleetJudge(fleetOf(2).map((t, i) => ({ ...t, legs: [leg({ dep: i ? 18 * 3600 : 6 * 3600, dur: i ? 12 * 3600 : 12 * 3600 })] }))).earned]],
    no: [['中間差一秒', () => fleetJudge(fleetOf(4).map((t, i) => ({ ...t, legs: [leg({ dep: i * 6 * 3600 + (i === 3 ? 1 : 0), dur: 6 * 3600 - (i === 3 ? 1 : 0) - (i === 2 ? 1 : 0) })] }))).earned]],
  },
};

section('37 枚各有該亮與不該亮', () => {
  const ids = [...P.HONOR_GROUPS.flatMap(g => g.list), ...P.FLEET_HONORS].map(h => h.id);
  check(ids.length === 37 && new Set(ids).size === 37, '目錄 37 枚、id 不重複', `${ids.length}`);
  for (const id of ids) {
    const c = CASES[id];
    if (!c || !c.yes?.length || !c.no?.length) { check(false, `${id} 缺案例`); continue; }
    for (const [label, run] of c.yes) check(!!run()[id], `${id} 該亮：${label}`);
    for (const [label, run] of c.no) check(!run()[id], `${id} 不該亮：${label}`);
  }
  for (const id of Object.keys(CASES)) if (!ids.includes(id)) check(false, `案例 ${id} 不在目錄裡`);
});

section('目錄的形狀', () => {
  const list = P.HONOR_GROUPS.flatMap(g => g.list);
  check(list.length === 31 && P.FLEET_HONORS.length === 6, '每列 31 枚、車隊 6 枚');
  check(P.MARK_IDS.length === 18 && P.MARK_IDS.every(id => list.find(h => h.id === id).mark), '頭牌 18 款，都掛在成就上');
  const plates = Object.entries(P.PLATES).filter(([, p]) => p.by);
  check(plates.length === 7 && Object.keys(P.PLATES).length === 8, '車牌框 8 款，原色以外 7 款是成就給的');
  check(plates.every(([id, p]) => list.find(h => h.id === p.by)?.plate === id), '車牌框跟成就互相指得到');
  check(list.filter(h => h.mark || h.plate).length === 25, '有獎勵的 25 枚');
  check(P.HONOR_SHELF.length === 6 && P.HONOR_SHELF.every(id => list.some(h => h.id === id)), '畫框六枚都在目錄裡');
  check(js(P.HONOR_SHELF) === js(['maiden', 'days10', 'km1k', 'km10k', 'days100', 'days365']), '畫框六枚：首航、十日、千里、萬里、百日、週年');
  check(P.FLEET_HONORS.every(h => h.deco), '車隊成就各給一件車庫佈置');
});

// ICU 的新月算到分鐘級，貼著午夜的兩年會落到隔壁一天。Meeus 第 49 章算出來 UTC+8 是 2027-02-06 23:56、2030-02-03 00:07，
// 對到的正月初一是 2/6、2/3，判定表照這個。其他 19 年 Intl 與判定表要逐年相同。
const ICU_OFF = { '2027-02-06': '2027-02-05', '2030-02-01': '2030-02-02' };
section('除夕對 Intl 農曆', () => {
  const fmt = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
  let miss = 0, n = 0;
  for (let y = 2026; y <= 2046; y++) {
    for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d = new Date(+d + 864e5)) {
      const part = t => fmt.formatToParts(t).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
      const next = part(new Date(+d + 864e5 + 4 * 3600e3));
      const isNewYear = next.day === '1' && next.month === '1';
      if (!isNewYear) continue;
      n++;
      const iso = d.toISOString().slice(0, 10), day = ICU_OFF[iso] || iso, t = train({ firstDay: day, legs: [leg({ day, dep: 20 * 3600 })] });
      if (!earnedAt(t, addDays(day, 1)).lunar) { miss++; console.log(`  ${day} 判定沒認出除夕`); }
      const off = train({ firstDay: addDays(day, -1), legs: [leg({ day: addDays(day, -1), dep: 20 * 3600 })] });
      if (P.judgeTrain({ ...off, judged: null }, day, 0).earned.lunar) { miss++; console.log(`  ${addDays(day, -1)} 不是除夕卻亮了`); }
    }
  }
  check(n === 21 && miss === 0, '2026–2046 共 21 個除夕逐年對上', `${n} 個，錯 ${miss}`);
});

section('累計的規則', () => {
  const s = (t, today, nowSec) => P.fleetStats(t, today, nowSec);
  const two = train({ legs: [leg({ km: 100, stops: 5, meets: 2 }), leg({ day: '2026-01-11', km: 10, stops: 1, meets: 0 })] });
  const a = s(two, '2026-01-21');
  check(a.days === 20 && a.km === 1100 && a.stops === 60 && a.meets === 20, '改路線：舊段收到前一天、新段當天起算', js(a));
  const before = s({ ...two, legs: [two.legs[0]] }, '2026-01-11'), after = s({ ...two, legs: P.syncLegs([two.legs[0]], segment({ km: 999 }), D0, '2026-01-11') }, '2026-01-11');
  check(before.km === 1000 && after.km === 1000, '改路線當天累計不歸零', js(after));
  const three = P.syncLegs(two.legs, segment({ km: 50 }), '2026-01-01', '2026-02-01');
  check(three.length === 3 && s({ ...two, legs: three }, '2026-02-01').km === 1000 + 21 * 10, '再改一次，前兩段加總不動');
  check(s(train(), D0, LEG.dep + LEG.dur - 1).days === 0 && s(train(), D0, LEG.dep + LEG.dur).days === 1, '當天的班次跑完才算進累計');
  const owl = train({ legs: [leg({ dep: 23.5 * 3600, dur: 3600 })] });
  check(s(owl, D0, 86399).days === 0 && s(owl, '2026-01-02', 0).days === 1, '過午夜的班隔天才算');
  check(s(train({ hand: { x: { n: 2, km: 30, stops: 4, meets: 1 } } }), D0).trips === 2 && s(train({ hand: { x: { n: 2, km: 30, stops: 4, meets: 1 } } }), '2026-01-03').trips === 4, '趟數＝天數＋親手次數');
  check(P.firstRunDay(8 * 3600, 7 * 3600, D0) === D0 && P.firstRunDay(8 * 3600, 8 * 3600, D0) === '2026-01-02', '首航日：今天的時刻還沒到是今天，過了是明天');
  const early = hand(train({ firstDay: '2026-01-02', legs: [] }), { at: 1, dep: 1, dur: 1 }, LEG, D0);
  check(early.firstDay === D0, '親手發車把首航日提前到當天');
  check(hand(train({ legs: [] }), { at: 1, dep: 1, dur: 1 }, LEG, '2026-05-01').firstDay === D0, '跑過的車親手發車不動首航日');
  check(hand(train({ legs: [] }), { at: 1, dep: 1, dur: 1 }, { ...LEG, meets: 3 }, D0).hand['dev-aaaaaaaa'].meets === 3, '親手趟也算這段的交會數');
});

section('判斷的時機', () => {
  const late = earnedAt(train(), '2026-03-01');
  check(late.days10 === '2026-01-10' && late.km1k === '2026-01-10', '隔很久才打開，日期還是當天的', js(late));
  const once = judge(train(), '2026-01-20', 0);
  const again = fleetJudge([once], '2026-01-20', 0, msOf('2026-01-20'), {}).fresh.filter(f => f.train);
  check(again.length === 0, '判斷過的不再給一次');
  const twice = fleetJudge([train()], '2026-01-20');
  const third = fleetJudge(twice.trains, '2026-01-20', 0, msOf('2026-01-20'), twice.earned);
  check(twice.changed && twice.fresh.length > 0 && !third.changed && !third.fresh.length, '同一刻判斷兩次，第二次沒有變動');
  const next = fleetJudge(third.trains, '2026-01-21', 0, msOf('2026-01-21'), third.earned);
  check(next.changed && !next.fresh.length, '隔天判斷：沒有新成就，但判到哪一天有變');
  const run = { ...train({ legs: [leg({ dep: 20 * 3600, tags: ['east'] })] }), outRun: { at: msOf(D0, noon), dep: noon, dur: 3600 } };
  const going = fleetJudge([run], D0, noon, msOf(D0, noon + 3599));
  check(going.trains[0].outRun !== null && !going.trains[0].earned.east, '親手趟還在跑：不收、不給');
  const ended = fleetJudge([run], D0, noon, msOf(D0, noon + 3600));
  check(ended.trains[0].outRun === null && ended.trains[0].earned.east === D0 && ended.changed, '親手趟跑完：收掉、這一趟的路線成就給了');
  check(!!finish({ ...run, legs: [leg({ dep: noon, kin: ['my:b'] })] }).earned.kin, '親手趟跑完也看手足');
  check(earnedAt(train({ earned: { days10: '2025-01-01' } }), '2026-03-01').days10 === '2025-01-01', '拿過的日期不被往後改');
  const sync = P.earnedOf({ a: '2026-01-01', b: 'x', c: 3 });
  check(js(sync) === js({ a: '2026-01-01' }), '成就存檔：日期不合法的丟掉，不認得的 id 留著');
  const bad = P.fleetFields({ look: { mark: 'nope', plate: 'nope' }, judged: 'x', hand: { 'dev-aaaaaaaa': { n: 1, km: 1, stops: 1, meets: -1 } } });
  check(bad.look.mark === null && bad.look.plate === null && bad.judged === null && bad.hand['dev-aaaaaaaa'].meets === 0, '存檔的外觀與判斷日形狀錯了回空值');
  const good = P.fleetFields({ look: { mark: 'east', plate: 'gold' }, judged: '2026-01-01' });
  check(good.look.mark === 'east' && good.look.plate === 'gold' && good.judged === '2026-01-01', '合法的外觀與判斷日留著');
});

section('路線特徵', () => {
  const l = realLeg('tra', '枋寮', '臺東');
  check(l.rise !== null && l.rise > 0, '枋寮到臺東有經過太麻里', `第 ${l.rise} 秒`);
  check(realLeg('tra', '臺東', '花蓮').rise === null, '臺東到花蓮沒有');
  const c = realLeg('tra', '竹南', '彰化', { via: 'coast' });
  check(c.set && c.set[0] === 0 && c.set[1] > 0, '海線有進出時刻', js(c.set));
  check(realLeg('tra', '竹南', '彰化', { via: 'mountain' }).set === null, '山線沒有');
  check(tags('tra', '七堵', '八堵', { dir: 'shun' }).includes('tropic'), '繞一圈同時穿過北回歸線');
  check(tags('tra', '斗六', '大林').length === 0, '短程沒有路線標籤');
  const same = realLeg('tra', '花蓮', '臺東'), { _route, ...plain } = same;
  const { day: _d, ...body } = plain;
  check(P.syncLegs([{ ...plain, meets: 4, twin: true }], { ...body, meets: null }, D0, '2026-02-01').length === 1, '交會數不一樣不算改路線');
  check(P.syncLegs([plain], { ...body, rise: 5 }, D0, '2026-02-01').length === 2, '路線特徵不一樣算改路線');
});

section('本尊車款對編組表', () => {
  const real = new Set(Object.values(FORMATIONS).map(f => f.id));
  const want = Object.keys(P.MODELS).filter(id => real.has(formationFor({ modelId: id }, 'actual')?.id)).sort();
  check(js([...P.TWIN_MODELS].sort()) === js(want), `路上有同款真車的 ${want.length} 款`, want.join(' '));
});

section('天氣資料', () => {
  const W = 6, cells = new Uint8Array(W * W);
  cells[3 * W + 3] = 25; cells[0] = 255; cells[5 * W] = 19;
  const body = { radar: { at: '2026-01-01T00:00:00+08:00', res: .1, w: W, h: W, lon0: 120, lat0: 23, data: Buffer.from(cells).toString('base64') },
    obs: { fields: ['id', 'lon', 'lat', 'weather', 'vis'], rows: [['a', 120.3, 23.3, '有霧', '<1'], ['b', 123, 26, '晴', '>30'], ['c', 'x', 23, '霧', '1'], ['d', 121, 24, null, null]] } };
  const frame = P.weatherFrame(body), at = (lon, lat) => { const out = P.weatherAt(frame, lon, lat); golden.push({ fn: 'weatherAt', body, lon, lat, out }); return out; };
  check(frame && frame.radar && frame.stations.length === 2, '格式正確的資料讀得進來，座標或天氣缺的站不算');
  check(at(120.3, 23.3).rain, '站在回波上有雨');
  check(at(120.4, 23.4).rain, '旁邊一格算進去（3×3）');
  check(!at(120.5, 23.3).rain, '隔兩格沒有');
  check(!at(120, 23.5).rain, '19 dBZ 不算雨');
  check(!at(120, 23).rain, '雷達範圍外不算雨');
  check(!at(119, 22).rain, '出了格子不算雨');
  check(at(120.3, 23.3).fog > .8, '站上看到霧');
  check(at(121.5, 23.3).fog === 0, '25 公里內沒有站就當無霧');
  const two = P.weatherFrame({ ...body, obs: { fields: body.obs.fields, rows: [['a', 120, 23, '霧', '1'], ['b', 120.1, 23, '晴', '>30']] } });
  const near = P.weatherAt(two, 120.01, 23).fog, far = P.weatherAt(two, 120.09, 23).fog;
  check(near > far && near < 1 && far > 0, '兩站之間照距離內插', `${near.toFixed(3)} > ${far.toFixed(3)}`);
  check(P.weatherFrame(null) === null && P.weatherFrame({}) === null && P.weatherFrame({ radar: { at: 'x' } }) === null, '時間不對回 null');
  check(P.weatherFrame({ radar: { ...body.radar, data: '%%' } })?.radar === null, 'base64 壞掉只丟雷達');
  check(P.weatherFrame({ radar: { ...body.radar, w: 5 } })?.radar === null, '長寬對不上只丟雷達');
  const fog = (vis, weather) => P.weatherAt(P.weatherFrame({ radar: body.radar, obs: { fields: body.obs.fields, rows: [['a', 120, 23, weather, vis]] } }), 120, 23).fog;
  check(fog('<1', '') > fog('2-5', '') && fog('2-5', '') > fog('>30', ''), '能見度級距排得出順序', `${fog('<1', '')} ${fog('2-5', '')} ${fog('>30', '')}`);
  check(fog('>30', '有霾') === .3 && fog('>30', '霧') === .85, '天氣描述蓋過好的能見度');
  check(fog('>30', '晴') === 0 && fog('15', '晴') === 0, '能見度好就沒有霧');
});

fs.mkdirSync(path.join(ROOT, 'output/golden/mytrain'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'output/golden/mytrain/honors.json'), JSON.stringify(golden));
console.log(`\ngolden ${golden.length} 筆 → output/golden/mytrain/honors.json`);
console.log(failures ? `\n❌ 紅 ${failures} 條` : '\n✅ 全綠');
process.exit(failures ? 1 : 0);

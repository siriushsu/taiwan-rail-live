// 臨時營運調整:把 data/special_ops.json 描述的「特定日期例外班表」套進已建好的 *_times.json。
// 為什麼獨立一層:build_metro_times.mjs 每次都從 TDX 全量重建,例外若寫在資料檔裡會被靜默洗掉
// (幽靈列車家族的老坑)。這一層在寫檔前套用,重建幾次都在。
// 產出:lines[id].sets[setName] = 例外班表;lines[id].dates = { 'YYYY-MM-DD': setName }。
// 前端 prepFreqTimes() 先查 dates,命中就用該 set,沒命中才走原本的 週幾/國定假日 判定。
import { readFileSync } from 'node:fs';
import path from 'node:path';

const toSec = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const depOf = tr => tr[1];                       // 首站發車秒
const endOf = tr => tr[tr.length - 1];           // 末站到達秒
const ascOf = tr => tr[tr.length - 2] > tr[0];   // 站索引遞增 = asc

// 該班次在「站索引 >= from」的支線上最晚出現的時刻(沒經過支線回 -Infinity)
function branchLast(tr, from) {
  let t = -Infinity;
  for (let i = 0; i < tr.length; i += 2) if (tr[i] >= from) t = Math.max(t, tr[i + 1]);
  return t;
}

// 班距稀釋:from 之後的班次,同方向只留間隔 >= headway 的
function thin(trains, fromSec, headwaySec) {
  const keep = [], byDir = new Map();
  for (const tr of [...trains].sort((a, b) => depOf(a) - depOf(b))) {
    if (depOf(tr) < fromSec) { keep.push(tr); continue; }
    const d = ascOf(tr) ? 'a' : 'd', last = byDir.get(d);
    // 允許 60 秒寬容:官方班表本來就不是整分對齊,嚴格比會多砍一班
    if (last != null && depOf(tr) - last < headwaySec - 60) continue;
    byDir.set(d, depOf(tr)); keep.push(tr);
  }
  return keep;
}

// 支線停駛:from 起支線(站索引 >= branchFrom)不再有車;from 之後也不再有本線發車
function suspend(trains, fromSec, branchFrom) {
  return trains.filter(tr => depOf(tr) < fromSec && branchLast(tr, branchFrom) < fromSec);
}

// 加密:from 之後改用固定班距,行駛型態沿用同方向停站最多的一班當模板,服務時間跨度不變
function densify(trains, fromSec, headwaySec) {
  const keep = trains.filter(tr => depOf(tr) < fromSec);
  const out = [...keep];
  for (const asc of [true, false]) {
    const same = trains.filter(tr => ascOf(tr) === asc);
    if (!same.length) continue;
    const spanEnd = Math.max(...same.map(depOf));   // 末班發車時刻:官方沒說要延長,跨度照舊
    if (spanEnd < fromSec) continue;
    const tpl = same.reduce((a, b) => (b.length > a.length ? b : a));
    const rel = []; for (let i = 0; i < tpl.length; i += 2) rel.push([tpl[i], tpl[i + 1] - depOf(tpl)]);
    for (let dep = fromSec; dep <= spanEnd; dep += headwaySec) {
      const tr = []; for (const [idx, off] of rel) tr.push(idx, dep + off);
      out.push(tr);
    }
  }
  return out;
}

// 常態加班(op 沒有 dates):官方公告的新增班次 TDX 還沒上架時,直接併進基準 set(不是例外日)。
// 例外日(op 有 dates)也走這裡,加進該日的例外 set。
// 行駛型態複製同 set 裡「從同一站、於 like 發車」的那班,整班平移到 dep;kinds 同步插入同一位置。
// 同一型態多班時用 deps 列出各班起站發車時刻(照官方時刻表字面抄)。
// TDX 已有同站同刻發車的班次 ⇒ 跳過並提示可刪,不會疊出兩班。
function addTrips(L, setName, adds, id, log) {
  const trains = L.sets[setName];
  for (const a of adds) {
    const from = a.from ?? 0, like = toSec(a.like);
    let added = 0;
    for (const hm of a.deps || [a.dep]) {
      const dep = toSec(hm);
      if (trains.some(tr => tr[0] === from && depOf(tr) === dep)) {
        log(`  ⚑ ${id}: ${setName} 已有 ${hm} 發車班次(TDX 已上架),本條可刪`);
        continue;
      }
      const ti = trains.findIndex(tr => tr[0] === from && depOf(tr) === like);
      if (ti < 0) throw new Error(`special_ops ${id}: ${setName} 找不到 ${a.like} 發車的模板班次`);
      const tr = trains[ti].map((v, i) => (i % 2 ? v - like + dep : v));
      let at = trains.findIndex(t => depOf(t) > dep); if (at < 0) at = trains.length;
      trains.splice(at, 0, tr);
      const ks = L.kinds?.[setName];
      if (ks) L.kinds[setName] = ks.slice(0, at) + ks[ti] + ks.slice(at);
      added++;
    }
    if (added) log(`  ⚑ ${id}: ${setName} 加 ${a.deps ? `${added} 班` : `${a.dep} 班`}(型態同 ${a.like})`);
  }
}

// 例外日取消班次(官方那天沒開的):用「起站 + 發車時刻」逐班指名(照官方時刻表字面抄),只刪該日的例外 set。
// 找不到或同刻多班 ⇒ 直接失敗:基準 set 換版了,這條要重新對官網,不能默默少刪或多刪。
function dropTrips(trains, drops, id, setName) {
  for (const d of drops) {
    const from = d.from ?? 0;
    for (const hm of d.deps) {
      const dep = toSec(hm), hit = trains.filter(tr => tr[0] === from && depOf(tr) === dep);
      if (hit.length !== 1) throw new Error(`special_ops ${id}: ${setName} 站 ${from} ${hm} 發車的班次有 ${hit.length} 班(要恰好 1 班才能取消)`);
      trains.splice(trains.indexOf(hit[0]), 1);
    }
  }
  return trains;
}

// 臺北日期;SPECIAL_OPS_TODAY=YYYY-MM-DD 覆寫(測過期路徑)
const taipeiToday = () => process.env.SPECIAL_OPS_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

export function applySpecialOps(out, outPath, ROOT, log = console.log) {
  let cfg;
  try { cfg = JSON.parse(readFileSync(path.join(ROOT, 'data/special_ops.json'), 'utf8')); }
  catch { return; }                                 // 沒有例外檔就什麼都不做
  const today = taipeiToday();
  for (const op of cfg.ops || []) {
    if (op.out !== outPath) continue;
    // 例外日全都過了、而基準已換版(TDX 改點)套不上 ⇒ 跳過並提示可刪,不擋整個建置:
    // 否則沒人記得刪的過期條目會讓巡檢的 sync-metro 在 TDX 換版那天整批失敗,新班表同步不進來。
    // 還沒過的例外套不上照樣直接失敗——那是要重新對官網的訊號。
    const expired = !!op.dates && op.dates.every(d => d < today);
    for (const [lid, rule] of Object.entries(op.lines)) {
      const L = out.lines[lid];
      if (op.from) { applyRange(L, lid, rule, op, outPath, ROOT, log); continue; }
      try { applyLine(L, lid, rule, op, outPath, log); }
      catch (e) {
        if (!expired) throw e;
        if (L) { delete L.sets[op.setName]; if (L.kinds) delete L.kinds[op.setName]; }
        log(`  ⚑ ${op.id}: 例外日 ${op.dates.join(' ')} 都已過、基準已換版套不上,這次不套用,本條可刪(${e.message})`);
      }
    }
  }
}

function applyLine(L, lid, rule, op, outPath, log) {
  if (!L) throw new Error(`special_ops ${op.id}: 線 ${lid} 不存在於 ${outPath}`);
  const base = L.sets[op.base];
  if (!base) throw new Error(`special_ops ${op.id}: ${lid} 沒有基準 set「${op.base}」`);
  if (!op.dates) { addTrips(L, op.base, rule.add || [], op.id, log); return; }
  let trains = base.map(tr => tr.slice());
  // 車種(目前只有機捷有 kinds)跟著班次走:前端要求 kinds 與 set 等長同序,缺了那天整天留白。
  // 稀釋/停駛只是挑掉班次;加密生出的新班不知車種,記 '0'(前端當未標)。
  const bk = L.kinds?.[op.base], kindOf = new Map(bk ? trains.map((tr, i) => [tr, bk[i]]) : []);
  if (rule.thin) trains = thin(trains, toSec(rule.thin.from), rule.thin.headwayMin * 60);
  if (rule.suspend) trains = suspend(trains, toSec(rule.suspend.from), rule.suspend.branchFrom);
  if (rule.densify) trains = densify(trains, toSec(rule.densify.from), rule.densify.headwaySec);
  if (rule.drop) trains = dropTrips(trains, rule.drop, op.id, op.setName);
  trains.sort((a, b) => depOf(a) - depOf(b) || endOf(a) - endOf(b));
  L.sets[op.setName] = trains;
  if (bk) L.kinds[op.setName] = trains.map(tr => kindOf.get(tr) ?? '0').join('');
  addTrips(L, op.setName, rule.add || [], op.id, log);
  L.dates = L.dates || {};
  for (const d of op.dates) L.dates[d] = op.setName;
  log(`  ⚑ ${lid} 例外「${op.setName}」${base.length}→${trains.length} 班 (${op.dates.join(' ')})`);
}

// 改版區間(op 有 from/until、沒有 dates):官方某日起整份班表換版,TDX 卻還掛著舊版(TDX 班表沒有生效日期)。
// op.snapshot 是新版各日型的完整班表(含車種),rule.replace = { 基準日型: 輸出 set 名 }。
// from～until 每一天照前端 prepFreqTimes() 的挑法(國定假日/補假→holiday、補班→days[1]、其餘看週幾)
// 算出原本走哪個日型,有對應的就在 dates 改指快照。已被其他 op 指定的日子不動(單日例外優先)。
// 基準換版就停用:某日型的基準(TDX)已經沒有 rule.untilBaseLacks 兩站之間的區間車,代表 TDX 已換成新版,
// 那個日型不再套用並印「本條可刪」——不重複套,也不讓巡檢的 sync-metro 在 TDX 換版那天失敗。
function applyRange(L, lid, rule, op, outPath, ROOT, log) {
  if (!L) throw new Error(`special_ops ${op.id}: 線 ${lid} 不存在於 ${outPath}`);
  const snap = JSON.parse(readFileSync(path.join(ROOT, op.snapshot), 'utf8'));
  const DT = JSON.parse(readFileSync(path.join(ROOT, 'data/tw_daytype.json'), 'utf8'));
  const [a, b] = rule.untilBaseLacks;
  const between = tr => (tr[0] === a && tr[tr.length - 2] === b) || (tr[0] === b && tr[tr.length - 2] === a);
  const live = {};
  for (const [day, setName] of Object.entries(rule.replace)) {
    const base = L.sets[day];
    if (!base) throw new Error(`special_ops ${op.id}: ${lid} 沒有基準 set「${day}」`);
    if (!base.some(between)) {
      log(`  ⚑ ${op.id}: 基準「${day}」已沒有站 ${a}↔${b} 的區間車(TDX 已換版),不再套「${setName}」,本條可刪`);
      continue;
    }
    const sp = snap.sets?.[day], ks = snap.kinds?.[day];
    if (!sp?.length) throw new Error(`special_ops ${op.id}: 快照 ${op.snapshot} 沒有「${day}」`);
    if (L.kinds && ks?.length !== sp.length) throw new Error(`special_ops ${op.id}: 快照「${day}」車種 ${ks?.length} 字、班表 ${sp.length} 班,要等長`);
    L.sets[setName] = sp.map(tr => tr.slice());
    if (L.kinds) L.kinds[setName] = ks;
    live[day] = setName;
  }
  if (!Object.keys(live).length) return;
  L.dates = L.dates || {};
  const next = d => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  let n = 0;
  for (let d = op.from; d <= op.until; d = next(d)) {
    const day = DT[d] === 1 ? (L.holiday || L.days[0]) : DT[d] === 2 ? L.days[1] : L.days[new Date(d + 'T00:00:00Z').getUTCDay()];
    if (!live[day] || L.dates[d]) continue;
    L.dates[d] = live[day]; n++;
  }
  log(`  ⚑ ${lid} 改版「${Object.values(live).join('／')}」${op.from}～${op.until} 共 ${n} 天`);
}

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

export function applySpecialOps(out, outPath, ROOT, log = console.log) {
  let cfg;
  try { cfg = JSON.parse(readFileSync(path.join(ROOT, 'data/special_ops.json'), 'utf8')); }
  catch { return; }                                 // 沒有例外檔就什麼都不做
  for (const op of cfg.ops || []) {
    if (op.out !== outPath) continue;
    for (const [lid, rule] of Object.entries(op.lines)) {
      const L = out.lines[lid];
      if (!L) throw new Error(`special_ops ${op.id}: 線 ${lid} 不存在於 ${outPath}`);
      const base = L.sets[op.base];
      if (!base) throw new Error(`special_ops ${op.id}: ${lid} 沒有基準 set「${op.base}」`);
      if (!op.dates) { addTrips(L, op.base, rule.add || [], op.id, log); continue; }
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
  }
}

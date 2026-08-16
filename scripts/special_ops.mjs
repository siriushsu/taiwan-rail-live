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
      let trains = base.map(tr => tr.slice());
      if (rule.thin) trains = thin(trains, toSec(rule.thin.from), rule.thin.headwayMin * 60);
      if (rule.suspend) trains = suspend(trains, toSec(rule.suspend.from), rule.suspend.branchFrom);
      if (rule.densify) trains = densify(trains, toSec(rule.densify.from), rule.densify.headwaySec);
      trains.sort((a, b) => depOf(a) - depOf(b) || endOf(a) - endOf(b));
      L.sets[op.setName] = trains;
      L.dates = L.dates || {};
      for (const d of op.dates) L.dates[d] = op.setName;
      log(`  ⚑ ${lid} 例外「${op.setName}」${base.length}→${trains.length} 班 (${op.dates.join(' ')})`);
    }
  }
}

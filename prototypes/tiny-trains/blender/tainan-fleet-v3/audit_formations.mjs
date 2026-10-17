// 盤點 10/16 重播範圍內每班車的 formationFor(v,'actual')。
// v 的寫法與主站 index.html 的 carModelOf 相同：經 specialOf 傳 stockId／branchId／namedId。
// specialOf 依賴瀏覽器端狀態，這裡照它的三個查表重做（data/tra_special_trains.json）：
//   namedTrains 依營運日的車次、rollingStock 依 carName、branchLines 依停靠站名。
// 用法：node audit_formations.mjs [--json <輸出檔>]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const SCHEDULE_COMMIT_1015 = '32244b8a';   // 10/15 班表（含跨午夜的 3297、3786）所在的 commit
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const tai = s => s.name.replace('台', '臺');

export async function loadFormationModule() {
  return import(pathToFileURL(path.join(ROOT, 'rail-3d/integration/formations.js')).href);
}
export const loadManifest = () => readJson(path.join(ROOT, 'rail-3d/assets/blender-map-v1/manifest.json'));

export function loadSchedules() {
  const sched16 = readJson(path.join(ROOT, 'data/tra_schedule_dense.json'));
  const sched15 = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${SCHEDULE_COMMIT_1015}:data/tra_schedule_dense.json`], {maxBuffer: 1 << 28}).toString('utf8'));
  return {sched15, sched16};
}

// 範圍＝停靠表含大橋、臺南或保安任一站的班次（10/16 共 224 班），加上 10/15 跨午夜、
// 且臺南站 23:30 以後才離站的班次（建檔規則與 9/12 相同）；其中真正有一段落在範圍內的是 3297、3786。
export function selectTrains({sched15, sched16}) {
  const pick = [];
  for (const i of sched16.dates['2026-10-16']) {
    const tr = sched16.trains[i];
    if (tr.stops.some(s => ['大橋', '臺南', '保安'].includes(tai(s)))) pick.push({day: '2026-10-16', index: i, tr});
  }
  for (const i of sched15.dates['2026-10-15']) {
    const tr = sched15.trains[i], stop = tr.stops.find(s => tai(s) === '臺南');
    if (stop && stop.depSec >= 86400 - 1800) pick.push({day: '2026-10-15', index: i, tr});
  }
  return pick;
}

export function makeSpecialOf() {
  const sd = readJson(path.join(ROOT, 'data/tra_special_trains.json'));
  for (const b of sd.branchLines) b._set = new Set(b.matchStations);
  const namedOn = (n, day) => n.trainNosByDate ? (day && n.trainNosByDate[day]) || [] : n.trainNos;
  return (tr, day) => ({
    named: sd.namedTrains.find(n => namedOn(n, day).includes(String(tr.train))) || null,
    stock: sd.rollingStock.find(r => r.carNames.includes(tr.carName)) || null,
    branch: sd.branchLines.find(b => tr.stops.some(s => b._set.has(s.name))) || null,
  });
}

// 回傳每班的 {day, train, typeName, carName, stockId, namedId, branchId, id, count, caption}
export async function auditRows({withSpecial = true} = {}) {
  const F = await loadFormationModule(), manifest = loadManifest(), specialOf = makeSpecialOf();
  return selectTrains(loadSchedules()).map(({day, index, tr}) => {
    const sp = specialOf(tr, day);
    const v = withSpecial
      ? {systemId: 'tra_sched', carName: tr.carName, typeName: tr.typeName, stockId: sp.stock?.id, branchId: sp.branch?.id, namedId: sp.named?.id}
      : {systemId: 'tra_sched', carName: tr.carName};
    const spec = F.formationFor(v, 'actual'), formation = F.assembleFormation(spec, manifest);
    return {day, index, train: String(tr.train), typeName: tr.typeName, carName: tr.carName,
      stockId: sp.stock?.id || '', namedId: sp.named?.id || '', branchId: sp.branch?.id || '',
      id: spec.id, count: formation.parts.length, lengthsCount: spec.lengths.length, caption: spec.caption,
      parts: formation.parts.map(p => p.mesh)};
  });
}

export function summarize(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.id}:${r.count}`;
    if (!by.has(k)) by.set(k, {id: r.id, count: r.count, caption: r.caption, trains: []});
    by.get(k).trains.push(r.train + (r.day === '2026-10-15' ? '(10/15)' : ''));
  }
  return [...by.values()].sort((a, b) => b.trains.length - a.trains.length);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const rows = await auditRows(), rowsPlain = await auditRows({withSpecial: false});
  const days = {};
  for (const r of rows) days[r.day] = (days[r.day] || 0) + 1;
  console.log('範圍內班次', rows.length, JSON.stringify(days));
  console.log('\n[含 specialOf 的輸入（與主站 carModelOf 相同）] formation.id:parts 數 → 班數');
  for (const s of summarize(rows)) console.log(`  ${s.id}:${s.count}\t${s.trains.length} 班\t${s.caption}\t${s.trains.length <= 14 ? s.trains.join(',') : s.trains.slice(0, 14).join(',') + '…'}`);
  console.log('\n[只傳 systemId＋carName（9/12 建檔寫法）] 對照');
  for (const s of summarize(rowsPlain)) console.log(`  ${s.id}:${s.count}\t${s.trains.length} 班`);
  console.log('\n兩種輸入結果不同的班次：', rows.filter((r, i) => r.id !== rowsPlain[i].id).map(r => `${r.train}:${rowsPlain[rows.indexOf(r)].id}→${r.id}`).join(' ') || '（無）');
  console.log('具名列車命中：', rows.filter(r => r.namedId).map(r => `${r.train}=${r.namedId}`).join(' ') || '（無）');
  console.log('CarClass 1130 的 6631–6633：', rows.filter(r => ['6631', '6632', '6633'].includes(r.train)).map(r => `${r.train}(${r.typeName}/${r.carName})→${r.id}:${r.count}`).join(' '));
  console.log('重點車：', rows.filter(r => ['145', '3782'].includes(r.train)).map(r => `${r.train}(${r.carName})→${r.id}:${r.count}`).join(' '));
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), {recursive: true}); fs.writeFileSync(jsonOut, JSON.stringify({rows, summary: summarize(rows)}, null, 1) + '\n'); console.log('\n已寫入', jsonOut); }
}

// 標準編組的節數守門人。2026-09-09 使用者回報「推拉式自強號似乎都只有顯示三節」——
// PP 當時被標成「當班編組待確認」，實際模式也只畫 3 節。這裡把有官方依據的節數釘住，
// 順便擋掉「模型部件不夠、實際模式默默退回 3 節」那種不會拋錯的退化。
// 依據逐條寫在 rail-3d/integration/FORMATIONS.md。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {formationFor, assembleFormation} from '../rail-3d/integration/formations.js';

const catalog = JSON.parse(fs.readFileSync('rail-3d/assets/blender-map-v1/manifest.json'));
// 每列：說明、辨識用的車輛欄位、實際模式應有節數、首／中／尾應該用的部件 mesh。
// 中間節多半是 `<id>-mid`（後半車體鏡射的通用中間車）；PP 的中間節用的是另一款 `ppcoach`。
const cases = [
  ['高鐵 700T', {systemId: 'thsr_sched'}, 12, ['700t', '700t-mid', '700t']],
  ['EMU3000 新自強', {systemId: 'tra_sched', carName: '自強(3000障)'}, 12, ['emu3000', 'emu3000-mid', 'emu3000']],
  ['普悠瑪 TEMU2000', {systemId: 'tra_sched', carName: '自強(普,障)'}, 8, ['temu2000', 'temu2000-mid', 'temu2000']],
  ['太魯閣 TEMU1000', {systemId: 'tra_sched', carName: '自強(太,障)'}, 8, ['temu1000', 'temu1000-mid', 'temu1000']],
  ['PP 推拉式自強', {systemId: 'tra_sched', carName: '自強(PP障12)'}, 14, ['e1000', 'ppcoach', 'e1000']],
  ['PP 推拉式自強（無註記）', {systemId: 'tra_sched', carName: '自強(PP障)'}, 14, ['e1000', 'ppcoach', 'e1000']],
  ['北捷高運量主線', {systemId: 'mrt', routeId: 'BL'}, 6, ['c321', 'c321-mid', 'c321']],
  ['文湖線', {systemId: 'mrt', routeId: 'BR'}, 4, ['wenhu', 'wenhu-mid', 'wenhu']],
];
// 沒有固定標準編組的車種：維持 3 節示意，而且必須明示「待確認」，不可默默升格成實測。
const provisional = [
  ['一般區間車', {systemId: 'tra_sched', carName: '區間車'}],
  ['莒光號', {systemId: 'tra_sched', carName: '莒光'}],
  ['柴聯自強 DR3100', {systemId: 'tra_sched', carName: '自強(D31)'}],
  ['阿里山林鐵', {systemId: 'afr_sched'}],
];

const failures = [];
for (const [label, vehicle, cars, meshes] of cases) {
  const spec = formationFor(vehicle, 'actual');
  if (!spec) { failures.push(`${label} 沒有對應編組`); continue; }
  const model = assembleFormation(spec, catalog);
  if (model.parts.length !== cars) failures.push(`${label} 實際模式畫 ${model.parts.length} 節，應為 ${cars} 節`);
  if (spec.actualCarCount !== cars) failures.push(`${label} actualCarCount=${spec.actualCarCount}，應為 ${cars}`);
  if (spec.countBasis !== 'standard') failures.push(`${label} countBasis=${spec.countBasis}，應為 standard`);
  const seen = [model.parts[0]?.mesh, model.parts[Math.floor(cars / 2)]?.mesh, model.parts.at(-1)?.mesh];
  if (seen.join(',') !== meshes.join(',')) failures.push(`${label} 首／中／尾部件為 ${seen.join('／')}，應為 ${meshes.join('／')}`);
  // 三節示意模式仍必須是三節，而且取的是首、中、尾，不是把整列壓扁。
  const short = assembleFormation(formationFor(vehicle, 'three'), catalog);
  if (short.parts.length !== 3) failures.push(`${label} 三節示意畫了 ${short.parts.length} 節`);
  if ([short.parts[0].mesh, short.parts[1].mesh, short.parts[2].mesh].join(',') !== meshes.join(',')) failures.push(`${label} 三節示意的部件不是首中尾`);
}
for (const [label, vehicle] of provisional) {
  const spec = formationFor(vehicle, 'actual');
  if (!spec) { failures.push(`${label} 沒有對應編組`); continue; }
  if (spec.lengths.length !== 3) failures.push(`${label} 當班編組未知，應維持 3 節示意，實為 ${spec.lengths.length} 節`);
  if (spec.actualCarCount !== null) failures.push(`${label} 當班編組未知，actualCarCount 必須留 null`);
  if (!spec.caption.includes('待確認')) failures.push(`${label} 未標示「待確認」：${spec.caption}`);
}
// 具名覆蓋率斷言：這兩張表是手寫的，少一列不會有任何錯誤訊息。
assert.equal(cases.length, 8, '標準編組檢查表被改動，請同時更新這個數字');
assert.equal(provisional.length, 4, '示意編組檢查表被改動，請同時更新這個數字');

if (failures.length) {
  console.error(`列車編組驗收失敗（${failures.length} 項）`);
  for (const f of failures) console.error('- ' + f);
  process.exit(1);
}
console.log(`列車編組驗收通過：${cases.length} 種標準編組節數與首中尾部件相符，${provisional.length} 種維持 3 節示意並標示待確認`);

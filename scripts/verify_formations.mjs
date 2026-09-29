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
  ['海風號', {systemId:'tra_sched',namedId:'haifeng'},4,['haifeng','haifeng-mid','haifeng']],
  ['山嵐號', {systemId:'tra_sched',namedId:'shanlan'},4,['shanlan','shanlan-mid','shanlan']],
  ['高鐵 700T', {systemId: 'thsr_sched'}, 12, ['700t', '700t-mid', '700t']],
  ['EMU3000 新自強', {systemId: 'tra_sched', carName: '自強(3000障)'}, 12, ['emu3000', 'emu3000-mid', 'emu3000']],
  ['普悠瑪 TEMU2000', {systemId: 'tra_sched', carName: '自強(普,障)'}, 8, ['temu2000', 'temu2000-mid', 'temu2000']],
  ['太魯閣 TEMU1000', {systemId: 'tra_sched', carName: '自強(太,障)'}, 8, ['temu1000', 'temu1000-mid', 'temu1000']],
  ['PP 推拉式自強', {systemId: 'tra_sched', carName: '自強(PP障12)'}, 14, ['e1000', 'ppcoach', 'e1000']],
  ['PP 推拉式自強（無註記）', {systemId: 'tra_sched', carName: '自強(PP障)'}, 14, ['e1000', 'ppcoach', 'e1000']],
  ['北捷高運量主線', {systemId: 'mrt', routeId: 'BL'}, 6, ['c321', 'c321-mid', 'c321']],
  ['北捷淡水信義線', {systemId: 'mrt', routeId: 'R'}, 6, ['c381', 'c381-mid', 'c381']],
  ['北捷高運量支線', {systemId: 'mrt', routeId: 'R_XBT'}, 3, ['c381', 'c381-mid', 'c381']],
  ['文湖線', {systemId: 'mrt', routeId: 'BR'}, 4, ['wenhu', 'wenhu-mid', 'wenhu']],
  ['環狀線', {systemId: 'mrt', routeId: 'Y'}, 4, ['y100', 'y100-mid', 'y100']],
  ['機捷普通車', {systemId: 'tymc', airportService: 'local'}, 4, ['airportlocal', 'airportlocal-mid', 'airportlocal']],
  ['機捷直達車', {systemId: 'tymc', airportService: 'express'}, 5, ['airportexpress', 'airportexpress-mid', 'airportexpress']],
  ['高捷紅橘線', {systemId: 'krtc', routeId: 'R'}, 3, ['kaohsiung', 'kaohsiung-mid', 'kaohsiung']],
  ['臺中捷運綠線', {systemId: 'tmrt'}, 2, ['taichung', 'taichung', 'taichung']],
  ['三鶯線', {systemId: 'sanying'}, 2, ['sanying', 'sanying', 'sanying']],
  ['高雄輕軌', {systemId: 'krtc', routeId: 'C'}, 5, ['caf-section-0', 'caf-section-2', 'caf-section-4']],
  ['淡海輕軌', {systemId: 'ntdlrt'}, 5, ['danhai-section-0', 'danhai-section-2', 'danhai-section-4']],
  ['安坑輕軌', {systemId: 'ntalrt'}, 5, ['ankeng-section-0', 'ankeng-section-2', 'ankeng-section-4']],
];
// 推估編組：節數有出處，但班表分不出當班是哪一代車／掛幾組。必須畫出推估的節數、標明「推估」，
// 而且不可以偽裝成「標準編組」。逐條依據與信心寫在 FORMATIONS.md。
// 柴聯兩列節數維持 3，仍需驗證 countBasis，避免與未知編組混淆。
// 其餘推估與具名列車在 9/14 依使用者要求開放，來源見 FORMATIONS.md。
const estimated = [
  ['一般區間車', {systemId:'tra_sched',carName:'區間車'},8],
  ['區間快', {systemId:'tra_sched',carName:'區間快'},8],
  ['莒光號', {systemId:'tra_sched',carName:'莒光'},9],
  ['林鐵', {systemId:'afr_sched'},6],
  ['機捷車種缺值', {systemId:'tymc'},4],
  ['藍皮', {systemId:'tra_sched',namedId:'blue-train'},5],
  ['鳴日', {systemId:'tra_sched',namedId:'mingri'},6],
  ['環島之星', {systemId:'tra_sched',namedId:'star'},7],
  ['山海號', {systemId:'tra_sched',namedId:'shanhai'},6],
  ['平原號', {systemId:'tra_sched',namedId:'pingyuan'},6],
  ['柴聯自強 DR3100', {systemId: 'tra_sched', carName: '自強(D31)'}, 3],
  ['支線柴聯 DR1000', {systemId: 'tra_sched', carName: '區間車', branchId: 'pingxi'}, 3],
];
// 推估值會過期而且不會有人發現（audit_train_types.py 檔頭的 issue#7 就是這樣過期的），
// 所以綁一個到期日：台鐵慣例 4／7／10 月改點，下一次是 2026-10。改點後請重查
// FORMATIONS.md「推估編組」那一節的來源，確認還成立再把日期往後推。
const ESTIMATE_RECHECK = '2026-10-20';
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
  // 三節示意模式取的是首、中、尾，不是把整列壓扁；本來就不到三節的維持原節數，不可以變長。
  const shortCars = Math.min(3, cars);
  const short = assembleFormation(formationFor(vehicle, 'three'), catalog);
  if (short.parts.length !== shortCars) failures.push(`${label} 三節示意畫了 ${short.parts.length} 節，應為 ${shortCars} 節`);
  const shortSeen = [short.parts[0], short.parts[Math.floor(shortCars / 2)], short.parts.at(-1)].map(p => p?.mesh);
  if (shortSeen.join(',') !== meshes.join(',')) failures.push(`${label} 三節示意的部件為 ${shortSeen.join('／')}，應為 ${meshes.join('／')}`);

  // 五分節輕軌的第 2、4 節沒有轉向架，原始網格的底部本來就懸在軌面上方。
  // 若載入時把每節各自的 minZ 壓到 0，這兩節會被下拉約 36 cm，整列屋頂就會凹凸。
  // 所有鉸接分節必須共用整列最低點的軌面基準，並保留無轉向架車節的離地高。
  if (spec.articulated) {
    const sourceGroundZ = Math.min(...model.parts.map(p => catalog.meshes[p.mesh].min[2]));
    const clearances = model.parts.map(p => {
      const mesh = catalog.meshes[p.mesh];
      const scale = model.widthM / (mesh.max[1] - mesh.min[1]);
      if (!Number.isFinite(p.groundAnchorZ) || Math.abs(p.groundAnchorZ - sourceGroundZ) > 1e-9)
        failures.push(`${label} ${p.mesh} 沒有共用整列軌面基準`);
      return (mesh.min[2] - p.groundAnchorZ) * scale;
    });
    if (clearances.some(v => !Number.isFinite(v)) || Math.min(...clearances) > .01 || Math.max(...clearances) < .3)
      failures.push(`${label} 沒有同時保留轉向架車節與懸掛車節的原始離地高：${clearances.join('／')}`);
  }
}
for (const [label, vehicle, cars] of estimated) {
  const spec = formationFor(vehicle, 'actual');
  if (!spec) { failures.push(`${label} 沒有對應編組`); continue; }
  const model = assembleFormation(spec, catalog);
  if (model.parts.length !== cars) failures.push(`${label} 實際模式畫 ${model.parts.length} 節，應為 ${cars} 節`);
  if (spec.actualCarCount !== cars) failures.push(`${label} actualCarCount=${spec.actualCarCount}，應為 ${cars}`);
  if (spec.countBasis !== 'estimated') failures.push(`${label} countBasis=${spec.countBasis}，應為 estimated`);
  if (!spec.caption.includes('推估')) failures.push(`${label} 沒有標示「推估」：${spec.caption}`);
  if (/標準編組|待確認/.test(spec.caption)) failures.push(`${label} 推估值被寫成標準或待確認：${spec.caption}`);
  const short = assembleFormation(formationFor(vehicle, 'three'), catalog);
  if (short.parts.length !== Math.min(3, cars)) failures.push(`${label} 三節示意畫了 ${short.parts.length} 節`);
}
// ── 具名觀光列車的外觀：名冊有車次就一定要對得到自己的外觀 ──────────────
// 為什麼有這一節：2026-07-25 環島之星（車次 1／2）補進 namedTrains 的 trainNos，
// 但 formations.js 的 named 對照表沒跟著加 star ⇒ 它落到「車型未知的台鐵車」那條路，
// 被畫成 EMU800 通勤電聯車。這條退化不拋錯、不少畫車，七週沒有任何訊號。
// 另一種更糟的寫法是把對照表指到 FORMATIONS 沒有的鍵（例如 star:'star' 而沒有 FORMATIONS.star）：
// formationFor 回 null，map3d.js 拿它當候選過濾條件，整台列車直接從 3D 消失。兩種都要擋。
// 期望值來源是磁碟上的 data/tra_special_trains.json，與對照表不同源（判準盲點 1）。
const NAMED = JSON.parse(fs.readFileSync('data/tra_special_trains.json')).namedTrains;
// id → [班表車種名, 應有的外觀, 首／中／尾部件]。車種名帶真值是刻意的：藍皮的「普通車(專)」
// 會命中下面的 /莒光|普通車/ 分支，帶著它才驗得到「具名比對排在車種比對前面」。
const namedLook = {
  'blue-train': ['普通車(專)', 'blue', ['blue', 'bluecoach', 'bluecoach']],
  haifeng: ['電車(專)', 'haifeng', ['haifeng', 'haifeng-mid', 'haifeng']],
  shanlan: ['電車(專)', 'shanlan', ['shanlan', 'shanlan-mid', 'shanlan']],
  star: ['自強(商專)', 'e500', ['e500', 'juguang', 'juguang']],
  shanhai: ['', 'mingri', ['mingri', 'mingricoach', 'mingricoach']],
  pingyuan: ['', 'mingri', ['mingri', 'mingricoach', 'mingricoach']],
};
const withNos = NAMED.filter(n => n.trainNos.length).map(n => n.id).sort();
// 反向閘門：名冊長出新的具名列車（或某輛補上固定車次）時當場紅，而不是讓它默默退回代表外觀。
assert.deepEqual(withNos, Object.keys(namedLook).sort(),
  `namedTrains 裡有固定車次的是 ${withNos.join('、')}，與本表不符——新增具名列車時要同時決定它的外觀`);
for (const id of withNos) {
  const [carName, wantModel, wantMeshes] = namedLook[id];
  const spec = formationFor({systemId: 'tra_sched', namedId: id, carName}, 'actual');
  if (!spec) { failures.push(`具名列車 ${id} 對不到編組——它會整台從 3D 消失`); continue; }
  if (spec.id !== wantModel) failures.push(`具名列車 ${id} 的外觀是 ${spec.id}，應為 ${wantModel}`);
  const parts = assembleFormation(spec, catalog).parts;
  const seen = [parts[0],parts[Math.floor(parts.length/2)],parts.at(-1)].map(p=>p.mesh);
  if (seen.join(',') !== wantMeshes.join(',')) failures.push(`具名列車 ${id} 的首／中／尾部件為 ${seen.join('／')}，應為 ${wantMeshes.join('／')}`);
  if (!Number.isInteger(spec.actualCarCount) || spec.actualCarCount < 4) failures.push(`具名列車 ${id} 未顯示完整或推估編組`);
}

// 具名覆蓋率斷言：這兩張表是手寫的，少一列不會有任何錯誤訊息。
assert.equal(cases.length, 21, '標準編組檢查表被改動，請同時更新這個數字');
assert.equal(estimated.length, 12, '推估編組檢查表被改動，請同時更新這個數字');
assert.ok(new Date() < new Date(ESTIMATE_RECHECK + 'T00:00:00+08:00'),
  `推估編組的重驗期限 ${ESTIMATE_RECHECK} 已到：台鐵改點後請重查 FORMATIONS.md「推估編組」那一節的依據，確認仍成立再把這個日期往後推`);

// ── 機捷車種：只准讀官方 TrainType ──────────────────────────────────
// 「跳站＝直達車」是錯的：官方另有跳站的普通車（114/10/16 起平日 07:00 環北北上那班），
// 回推在 2026-09-12 兩種日型的 607 班裡 11 班判不出、6 班判錯。這裡守三件事——
// 官方值真的覆蓋全部班次、產品端真的讀它、回推那支函式沒有偷偷回來。
const tymc = JSON.parse(fs.readFileSync('data/tymc_times.json')).lines.A;
const coverage = Object.entries(tymc.sets).map(([key, set]) => ({key, trips: set.length, tagged: [...(tymc.kinds?.[key] || '')].filter(c => c !== '0').length}));
// special_ops 的特定日期例外 set（lines.A.dates 指到的）不是日型，不算；它們照樣要逐班帶車種（下一段）
assert.equal(coverage.filter(c => !Object.values(tymc.dates || {}).includes(c.key)).length, 2, '機捷日型數量改變（原本平日／假日兩種），請同時更新這個數字');
for (const {key, trips, tagged} of coverage)
  assert.equal(tagged, trips, `機捷 ${key} 只有 ${tagged}/${trips} 班帶官方車種，沒有官方值的會退成推估編組`);
const rail3d = fs.readFileSync('rail-3d.js', 'utf8');
const wiring = rail3d.split('\n').find(line => line.includes('airportService:'));
assert.ok(wiring?.includes('tymcKindOf('), '3D 的機捷車種不是讀官方 tymcKindOf：' + (wiring ?? '(找不到 airportService 那行)'));
assert.ok(!rail3d.includes('airportServiceForTrip'), 'rail-3d.js 又改回用停靠樣態回推機捷車種');
assert.ok(!fs.readFileSync('rail-3d/integration/formations.js', 'utf8').includes('airportServiceForTrip'), 'formations.js 的停靠樣態回推又被加回來');

if (failures.length) {
  console.error(`列車編組驗收失敗（${failures.length} 項）`);
  for (const f of failures) console.error('- ' + f);
  process.exit(1);
}
console.log(`列車編組驗收通過：${cases.length} 種標準編組節數與首中尾部件相符，${estimated.length} 種推估編組標明推估；`
  + `${withNos.length} 輛有固定車次的具名觀光列車各自對到專屬外觀（${withNos.join('、')}）；`
  + `機捷 ${coverage.map(c => `${c.key} ${c.tagged}/${c.trips}`).join('、')} 班帶官方車種，3D 讀的是官方值`);

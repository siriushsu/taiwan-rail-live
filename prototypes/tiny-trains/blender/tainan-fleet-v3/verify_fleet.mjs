// 驗證 10/16 版 fleet/ 目錄。全部通過才 exit 0。
//   A 檔案：目錄裡只有 catalog 列出的檔；每個 .bin.gz 解壓後的雜湊、長度、頂點數、三角形數、包圍盒、gz 大小都與 catalog 一致；totals 正確。
//   B 編組：範圍內每班車用 formationFor(v,'actual')＋assembleFormation 算出的 formation.id 與 parts 數，
//           照 memories/tainan-2026-09-12/replay.js arrange() 的條件比對（catalog.formations[id] 存在且 cars.length === parts.length），
//           每個 cars[].mesh 都在 catalog.meshes 裡且 pitchM 有限。
//   C 集電弓：EMU800 三種網格的車頂高度分佈——集電弓只在 emu800-ep；8 節編組裡兩具集電弓都靠中間那兩輛 EMB。
//   D 對照組：同樣的比對用在 9/12 的 catalog，必須在 emu800、e200、e500 三型失敗（確認這個檢查真的會紅）。
//   E 封存清單：照 scripts/seal_tainan_memory.mjs 的規則（.bin.gz 取解壓後雜湊、鍵名去 .gz）印出 fleet/ 每個檔的 sha256。
// 用法：node verify_fleet.mjs [--fleet <目錄>] [--control <目錄>] [--snapshot <snapshot.json>] [--json <輸出檔>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ROOT, auditRows} from './audit_formations.mjs';

const arg = (k, d) => process.argv.includes(k) ? path.resolve(process.argv[process.argv.indexOf(k) + 1]) : d;
const FLEET = arg('--fleet', path.join(ROOT, 'memories/tainan-2026-10-16/fleet'));
const CONTROL = arg('--control', path.join(ROOT, 'memories/tainan-2026-09-12/fleet'));
const SNAPSHOT = arg('--snapshot', null), JSON_OUT = arg('--json', null);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fails = [], notes = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); return ok; };

function loadMesh(dir, file, kind) {
  const gz = fs.readFileSync(path.join(dir, `${file}.gz`)), raw = zlib.gunzipSync(gz);
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  return {gz, raw, f, kind};
}

// ---------------------------------------------------------------- A 檔案
function checkFiles(dir, catalog) {
  const expected = new Set(['catalog.json']);
  for (const id of Object.keys(catalog.meshes)) for (const k of ['near', 'far']) expected.add(`${id}.${k}.bin.gz`);
  const have = new Set(fs.readdirSync(dir));
  check([...have].every(n => expected.has(n)), `目錄有清單以外的檔案：${[...have].filter(n => !expected.has(n))}`);
  check([...expected].every(n => have.has(n)), `目錄缺檔：${[...expected].filter(n => !have.has(n))}`);
  let all = 0, far = 0;
  const rows = [];
  for (const [id, m] of Object.entries(catalog.meshes)) {
    for (const k of ['near', 'far']) {
      const e = m[k], name = `${id}.${k}.bin.gz`, {gz, raw, f} = loadMesh(dir, `${id}.${k}.bin`, k);
      check(e.file === `${id}.${k}.bin`, `${name} catalog 檔名不符`);
      check(sha(raw) === e.sha256, `${name} 解壓後雜湊與 catalog 不符`);
      check(raw.length === e.byteLength, `${name} 長度與 catalog 不符`);
      check(raw.length % 40 === 0 && raw.length / 40 === e.vertexCount, `${name} 頂點數不符`);
      check(e.vertexCount / 3 === e.triangles, `${name} 三角形數不符`);
      check(gz.length === e.gzBytes, `${name} gz 大小與 catalog 不符`);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < f.length; i += 10) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], f[i + a]); mx[a] = Math.max(mx[a], f[i + a]); }
      check(mn.every((v, a) => Math.abs(v - e.min[a]) < 1e-3) && mx.every((v, a) => Math.abs(v - e.max[a]) < 1e-3), `${name} 包圍盒與 catalog 不符`);
      all += gz.length; if (k === 'far') far += gz.length;
      rows.push({mesh: id, lod: k, triangles: e.triangles, gzBytes: e.gzBytes, size: [+(mx[0] - mn[0]).toFixed(3), +(mx[1] - mn[1]).toFixed(3), +(mx[2] - mn[2]).toFixed(3)], min: e.min, max: e.max});
    }
  }
  check(catalog.totals.gzBytesAll === all && catalog.totals.gzBytesFar === far && catalog.totals.gzBytesNear === all - far, `totals 不正確：catalog ${JSON.stringify(catalog.totals)} 實際 ${all}/${far}/${all - far}`);
  return rows;
}

// ---------------------------------------------------------------- B 編組（模擬 replay.js arrange()）
function simulateArrange(catalog, items) {
  // items: [{id, count, label}]；回傳每型 {id, rule 節數, parts 節數, 班數, ok}
  const out = new Map();
  for (const it of items) {
    const rule = catalog.formations[it.id];
    const ok = !!rule && rule.cars.length === it.count;
    const k = `${it.id}:${it.count}`;
    if (!out.has(k)) out.set(k, {id: it.id, parts: it.count, rule: rule ? rule.cars.length : null, trains: [], ok});
    out.get(k).trains.push(it.label);
  }
  return [...out.values()];
}
function checkFormationParts(catalog) {
  for (const [id, f] of Object.entries(catalog.formations)) {
    for (const c of f.cars) {
      check(!!catalog.meshes[c.mesh], `編組 ${id} 用到不存在的網格 ${c.mesh}`);
      check(typeof c.flip === 'boolean', `編組 ${id} 的 flip 不是布林`);
      check(Number.isFinite(catalog.meshes[c.mesh]?.pitchM), `網格 ${c.mesh} 沒有有限的 pitchM`);
    }
  }
}
const trainLength = (catalog, id) => +catalog.formations[id].cars.reduce((a, c) => a + catalog.meshes[c.mesh].pitchM, 0).toFixed(3);

// ---------------------------------------------------------------- C 集電弓
function roofProfile(dir, id, kind) {
  const {f} = loadMesh(dir, `${id}.${kind}.bin`, kind);
  let zmax = 0, above = 0, xs = [];
  for (let i = 0; i < f.length; i += 10) { zmax = Math.max(zmax, f[i + 2]); }
  const limit = 3.995;   // 車頂冷氣的最高點約 3.99；超過這個高度的頂點只可能是集電弓
  for (let i = 0; i < f.length; i += 10) if (f[i + 2] > limit) { above++; xs.push(f[i]); }
  return {zmax: +zmax.toFixed(4), above, xRange: xs.length ? [+Math.min(...xs).toFixed(3), +Math.max(...xs).toFixed(3)] : null};
}
function checkPantographs(dir, catalog) {
  const res = {};
  for (const id of ['emu800', 'emu800-mid', 'emu800-ep']) for (const k of ['near', 'far']) res[`${id}.${k}`] = roofProfile(dir, id, k);
  for (const k of ['near', 'far']) {
    check(res[`emu800.${k}`].above === 0, `emu800.${k} 有超過車頂的頂點`);
    check(res[`emu800-mid.${k}`].above === 0, `emu800-mid.${k} 有超過車頂的頂點（不該有集電弓）`);
    check(res[`emu800-ep.${k}`].above > 0, `emu800-ep.${k} 找不到集電弓`);
  }
  // 編組：集電弓在 EP 的 -X 端；flip 後在 +X 端。它旁邊那輛必須是中間那兩輛 EMB（1 起算的第 4、5 輛）。
  const cars = catalog.formations.emu800.cars, panto = [];
  const epX = res['emu800-ep.near'].xRange;
  const side = (epX[0] + epX[1]) / 2 < 0 ? -1 : 1;   // 網格裡集電弓在哪一端
  cars.forEach((c, i) => {
    if (c.mesh !== 'emu800-ep') return;
    const towardFront = (c.flip ? -side : side) > 0;   // 世界座標：+X 是列車前方
    const neighbour = towardFront ? i - 1 : i + 1;
    panto.push({car: i + 1, flip: c.flip, neighbourCar: neighbour + 1, neighbourMesh: cars[neighbour]?.mesh});
    check(neighbour + 1 === 4 || neighbour + 1 === 5, `第 ${i + 1} 輛 EP 的集電弓旁邊不是 EMB（第 4、5 輛）：旁邊是第 ${neighbour + 1} 輛`);
  });
  check(panto.length === 2, `8 節編組應有 2 具集電弓，實際 ${panto.length}`);
  const withPanto = cars.filter(c => c.mesh === 'emu800-ep').length, others = cars.filter(c => c.mesh !== 'emu800-ep').length;
  return {profiles: res, panto, epCount: withPanto, noPantoCount: others};
}

// ---------------------------------------------------------------- E 封存清單
function sealMap(dir) {
  const files = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const b = fs.readFileSync(path.join(dir, name)), gzFile = name.endsWith('.bin.gz');
    files[`fleet/${gzFile ? name.slice(0, -3) : name}`] = sha(gzFile ? zlib.gunzipSync(b) : b);
  }
  return files;
}

// ---------------------------------------------------------------- 執行
const catalog = readJson(path.join(FLEET, 'catalog.json')), control = readJson(path.join(CONTROL, 'catalog.json'));
const meshRows = checkFiles(FLEET, catalog);
checkFormationParts(catalog);
const rows = await auditRows(), items = rows.map(r => ({id: r.id, count: r.count, label: r.train + (r.day === '2026-10-15' ? '(10/15)' : '')}));
const arranged = simulateArrange(catalog, items);
for (const a of arranged) check(a.ok, `編組 ${a.id}：catalog ${a.rule} 節，actual ${a.parts} 節（${a.trains.slice(0, 5)}…）`);
const panto = checkPantographs(FLEET, catalog);
const controlArranged = simulateArrange(control, items);
const controlFailIds = controlArranged.filter(a => !a.ok).map(a => a.id).sort();
const controlOk = JSON.stringify(controlFailIds) === JSON.stringify(['e200', 'e500', 'emu800']);
check(controlOk, `對照組（9/12 catalog）應只在 emu800、e200、e500 失敗，實際失敗：${controlFailIds}`);
const snapshotResult = [];
if (SNAPSHOT) {
  const snap = readJson(SNAPSHOT), seen = new Map();
  for (const tr of snap.trains) {
    const rule = catalog.formations[tr.formation.id], ok = !!rule && rule.cars.length === tr.formation.parts.length;
    const k = `${tr.formation.id}:${tr.formation.parts.length}`;
    if (!seen.has(k)) seen.set(k, {id: tr.formation.id, parts: tr.formation.parts.length, rule: rule?.cars.length ?? null, trains: [], ok});
    seen.get(k).trains.push(tr.train);
    if (!ok) fails.push(`snapshot 班次 ${tr.train}：${tr.formation.id} parts ${tr.formation.parts.length}，catalog ${rule ? rule.cars.length : '無此編組'}`);
  }
  snapshotResult.push(...seen.values());
}
const seal = sealMap(FLEET);

// ---------------------------------------------------------------- 輸出
const pad = (s, n) => String(s).padEnd(n);
console.log(`fleet：${FLEET}\ncontrol：${CONTROL}${SNAPSHOT ? `\nsnapshot：${SNAPSHOT}` : ''}\n`);
console.log('[B] 每型編組：catalog.formations[id].cars 節數 vs 範圍內 formationFor(v,"actual") 的 parts 數（模擬 arrange() 條件）');
console.log(pad('formation.id', 14), pad('catalog 節數', 12), pad('actual parts', 13), pad('班數', 6), pad('通過', 5), pad('畫面列長(m)', 12), '名稱');
for (const a of arranged.sort((x, y) => y.trains.length - x.trains.length)) console.log(pad(a.id, 14), pad(a.rule, 12), pad(a.parts, 13), pad(a.trains.length, 6), pad(a.ok ? 'PASS' : 'FAIL', 5), pad(a.rule ? trainLength(catalog, a.id) : '-', 12), catalog.formations[a.id]?.name ?? '（無）');
console.log('\n[D] 對照組（9/12 catalog）失敗的型：', controlFailIds.join(', ') || '（無）', controlOk ? '→ 符合預期，檢查有效' : '→ 不符預期');
for (const a of controlArranged) console.log('   ', pad(a.id, 10), `rule=${a.rule} parts=${a.parts}`, a.ok ? 'pass' : 'FAIL');
console.log('\n[C] 集電弓（車頂超過 3.995 m 的頂點數／最高點 z／x 範圍）');
for (const [k, v] of Object.entries(panto.profiles)) console.log('   ', pad(k, 18), `above=${v.above}`, `zmax=${v.zmax}`, `x=${JSON.stringify(v.xRange)}`);
console.log('    8 節編組 EP 位置與集電弓旁邊的車：', JSON.stringify(panto.panto), `EP ${panto.epCount} 輛、無集電弓 ${panto.noPantoCount} 輛`);
console.log('\n[A] 網格（三角形數／gz 位元組／包圍盒 長×寬×高 m）');
for (const r of meshRows) console.log('   ', pad(r.mesh, 14), pad(r.lod, 5), pad(r.triangles, 6), pad(r.gzBytes, 7), r.size.join(' × '));
console.log('\n[E] 封存用 sha256（.bin.gz 為解壓後雜湊，鍵名去掉 .gz）');
for (const [k, v] of Object.entries(seal)) console.log('   ', k, v);
if (SNAPSHOT) { console.log('\n[snapshot] 逐班比對（replay.js arrange() 條件）'); for (const s of snapshotResult) console.log('   ', pad(s.id, 10), `parts=${s.parts} rule=${s.rule}`, `${s.trains.length} 班`, s.ok ? 'PASS' : 'FAIL'); }
if (JSON_OUT) {
  fs.mkdirSync(path.dirname(JSON_OUT), {recursive: true});
  fs.writeFileSync(JSON_OUT, JSON.stringify({fleet: FLEET, formations: arranged, control: {failIds: controlFailIds, rows: controlArranged}, panto, meshes: meshRows, seal, snapshot: snapshotResult, fails}, null, 1) + '\n');
}
console.log(fails.length ? `\nFAIL（${fails.length}）\n  - ${fails.join('\n  - ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

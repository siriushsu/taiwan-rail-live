// 台南地下化重播（設定有 underground 的日期）的資料驗收：軌道面高程 z、臺南月台的停靠點、兩個方向都穿過地下、位置連續，
// 另加預覽標記與來源紀錄。由 verify_tainan_memory.mjs 在實測檢查之後呼叫，判準與門檻讀設定的 underground 與 verify.underground。
// 每條斷言的訊息都以「地下化：」開頭，突變測試靠它辨認是哪一條紅。
//
// 與 build_tainan_memory.mjs 各算各的：z(d)、框內判斷、月台位置都照 profile.json 的 howToComputeZ 與 derived.platform 在這裡再實作一次，
// 不引用 build 的任何函式。座標換算是 profile.json 的 axes.plan（x=(lon−lon0)·111320·cos(lat0)、y=(lat−lat0)·111320）；
// 里程到座標用頁面同一份 vendor/train-path.js 的 makePath（haversine 里程），不是平面距離——兩者差約千分之一，會讓月台位置差好幾公尺。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {generationConfigSha256} from './tainan_memory_config.mjs';

// 外框邊上的頂點算框內（南洞口的節點剛好落在 U 槽與隧道兩個外框的共用邊上）：與 build 的 EDGE_M 相同。
const EDGE_M = 0.02;
// 點速變化上限（m/s²）：相鄰兩秒的點速增加不得超過它（模型裡班次的加速都在 1.1 以下）；點速減少則只有「停下來的到站那一秒」（停靠站，或被留置的通過站）可以超過。
// 這個例外是既有物理模型的樣子：前一站是通過站、時刻又排得很緊的班次，會在到站那一秒從行駛速度直接停住
// （把臺南停靠點留在原位置的建置也一樣）。這種到站的班數釘在 verify.underground.abruptArrivals，數字變了就要重看。
// 這一條抓的是位置跳點（例如停靠點事後平移），不是驗速度剖面本身。
const ACCEL_MAX = 2.5;

export function checkUndergroundData(ctx) {
  const {cfg, dir, data, paths, fleet, arranged, formationPoses, distanceM, read} = ctx;
  const ok = (c, m) => assert.ok(c, '地下化：' + m);
  const U = cfg.underground, V = cfg.verify.underground;
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const norm = n => String(n).replace(/臺/g, '台').replace(/\s+/g, '');
  const summary = {};

  // ── 1. 地下化輸入：snapshot.underground 記的兩份檔，雜湊要與目錄裡的檔、設定指的檔、snapshot.sources 一致 ──
  ok(data.underground && data.underground.model && data.underground.profile, 'snapshot 沒有 underground 區塊');
  const modelFile = path.join(dir, data.underground.model.file), profileFile = path.join(dir, data.underground.profile.file);
  ok(fs.existsSync(modelFile) && fs.existsSync(profileFile), 'underground 區塊指到的 model／profile 不存在');
  ok(sha(modelFile) === data.underground.model.sha256 && sha(profileFile) === data.underground.profile.sha256, 'underground 區塊記的雜湊與檔案不符');
  ok(sha(modelFile) === sha(path.join(cfg.root, U.model)) && sha(profileFile) === sha(path.join(cfg.root, U.profile)), '目錄裡的 model／profile 與設定指的檔不同');
  for (const f of [U.model, U.profile]) ok(data.sources.some(s => s.file === f && s.sha256 === sha(path.join(cfg.root, f))), 'snapshot.sources 沒記 ' + f + ' 或雜湊不符');
  const model = JSON.parse(fs.readFileSync(modelFile, 'utf8')), profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  const plat = profile.derived.platform, C = plat.centerD;
  ok(JSON.stringify(data.underground.platform) === JSON.stringify({centerD: plat.centerD, d0: plat.d0, d1: plat.d1, lengthM: plat.lengthM}), 'underground.platform 與 profile.json 的 derived.platform 不同');
  ok(data.underground.maxAbsSlopePermille === profile.maxAbsSlopePermille, 'underground.maxAbsSlopePermille 與 profile.json 不同');
  ok(String(profile.origin) === String(data.origin) && String(model.origin) === String(data.origin), 'model／profile 的原點與 snapshot 不同');
  // 設定檔的來源紀錄：照快照記的欄位名單重算雜湊，要等於 snapshot.sources 那一筆（verify 的門檻與註解不在欄位內）。
  // 產生資料所用的設定欄位改了而快照沒有重建，這裡會紅。
  const CR = data.sources.filter(s => s.config === 'scripts/tainan_memory_config.mjs');
  ok(CR.length === 1 && CR[0].date === cfg.date && Array.isArray(CR[0].fields) && CR[0].fields.length > 0 && !CR[0].fields.includes('verify'), 'snapshot.sources 沒有（或有多筆）設定檔的來源紀錄，或欄位名單不對');
  ok(generationConfigSha256(cfg.date, CR[0].fields) === CR[0].sha256, 'snapshot.sources 記的設定欄位雜湊與目前的 tainan_memory_config.mjs 不符（產生資料所用的設定改了，快照沒有重建）');

  // ── 2. 預覽標記與班表來源 ──
  const sched = read('source-schedule.json');
  if (cfg.preview) {
    ok(JSON.stringify(data.preview) === JSON.stringify(cfg.preview), 'snapshot.preview 與設定的 preview 不同');
    const TS = data.timingSource;
    ok(TS.primary === 'scheduled' && TS.calibration === null && TS.histRows === 0 && TS.d1Rows === 0, '預覽的 timingSource 應為全表定、沒有校準與實測列');
    ok(TS.scheduledTimeSource?.kind === cfg.preview.kind && TS.scheduledTimeSource?.reason === cfg.preview.reason, 'timingSource.scheduledTimeSource 沒標預覽來源');
    ok(JSON.stringify(TS.scheduledTimeSource.schedules) === JSON.stringify(sched.schedules), 'scheduledTimeSource.schedules 與 source-schedule.json 不同');
    ok(sched.schedules.length >= 1 && sched.schedules.every(s => typeof s.temporary === 'string' && s.temporary.length > 0), 'source-schedule.json 的班表沒有逐筆標暫代（temporary）');
    for (const s of sched.schedules) ok(data.sources.some(x => x.file === s.file && x.sha256 === s.sha256 && x.temporary === s.temporary), 'snapshot.sources 沒有這份班表（含暫代標記）：' + s.file);
    ok(data.trains.every(t => t.timing === 'scheduled' && t.stops.every(s => s.src === 'sched')), '預覽的每班車、每一站都應是表定');
    ok(data.singleLine === undefined && Array.isArray(data.events) && data.events.length === 0, '預覽不該有單線雙向與時間軸事件');
    ok(TS.scheduledTrains.length === data.trains.length, 'timingSource.scheduledTrains 應涵蓋全部班次');
  } else ok(data.preview === undefined, '沒有 preview 設定的日期不該有 snapshot.preview');

  // ── 3. 世界座標、參考線、z(d)、外框（照 profile.json 的 howToComputeZ 再實作一次） ──
  const [lon0, lat0] = profile.origin, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const world = c => [(c[0] - lon0) * kx, (c[1] - lat0) * 111320];
  const P = profile.reference.points, CP = profile.controlPoints;
  const project = ([x, y]) => {
    let best = null;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay, ad] = P[i], [bx, by, bd] = P[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)) : 0, dist = Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
      if (!best || dist < best.dist) best = {d: ad + t * (bd - ad), dist};
    }
    return best;
  };
  const zOfD = d => {
    if (d <= CP[0].d) return CP[0].z;
    for (let i = 1; i < CP.length; i++) if (d <= CP[i].d) return CP[i - 1].z + (CP[i].z - CP[i - 1].z) * (d - CP[i - 1].d) / (CP[i].d - CP[i - 1].d);
    return CP.at(-1).z;
  };
  const rings = model.footprints.filter(f => U.footprintKinds.includes(f.kind)).map(f => f.ring);
  const inRing = ([x, y], ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const segDist = ([x, y], [ax, ay], [bx, by]) => {
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)) : 0;
    return Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
  };
  const ringEdgeDist = (q, ring) => Math.min(...ring.map((a, i) => segDist(q, ring[(i + ring.length - 1) % ring.length], a)));
  const insideFootprint = q => rings.some(r => inRing(q, r) || ringEdgeDist(q, r) <= EDGE_M);
  const clearOfFootprints = q => rings.every(r => !inRing(q, r) && ringEdgeDist(q, r) > EDGE_M + 0.01);
  const expectedZ = c => { const q = world(c); return insideFootprint(q) ? zOfD(project(q).d) : 0; };

  // ── 4. routes、rails 的 z：逐頂點與獨立重算相符、框外是 0、坡度不超過上限、全在地面的不寫 z、路線與模型用同一組股道 ──
  const zTol = V.zToleranceM, slopeMax = profile.maxAbsSlopePermille / 1000, minControlZ = Math.min(...CP.map(c => c.z));
  const al = model.params.alignment;
  const modelWays = new Set([...al.referenceChain.ways, ...al.eastChain, ...['tunnel', 'cuttingSouth', 'cuttingNorth', 'atGradeSouth', 'atGradeNorth', 'stationLoops'].flatMap(k => Object.values(al[k]))].map(String));
  const key = c => c[0].toFixed(7) + ',' + c[1].toFixed(7);
  const railSeg = new Map();
  for (const r of data.rails) for (let i = 0; i + 1 < r.coordinates.length; i++) { const a = key(r.coordinates[i]), b = key(r.coordinates[i + 1]); railSeg.set(a + '|' + b, r.id); railSeg.set(b + '|' + a, r.id); }
  const zStats = {};
  const checkZ = (list, label) => {
    const st = {items: list.length, withZ: 0, vertices: 0, inFootprint: 0, minZ: 0, maxAbsErrM: 0, worstSlopeExcessM: -Infinity, edgeMaxAbsZ: 0, lateralMaxM: 0, waysOutside: {}};
    for (const it of list) {
      const n = it.coordinates.length, W = it.coordinates.map(world), exp = it.coordinates.map(expectedZ);
      st.vertices += n;
      if (it.z === undefined) {
        ok(exp.every(v => Math.abs(v) <= zTol), label + ' ' + it.id + ' 有頂點落在隧道、站體或 U 槽外框內，卻沒有 z');
      } else {
        ok(Array.isArray(it.z) && it.z.length === n && it.z.every(Number.isFinite), label + ' ' + it.id + ' 的 z 長度與 coordinates 不同或不是數字');
        ok(it.z.some(v => v !== 0), label + ' ' + it.id + ' 的 z 全是 0，應省略這個欄位');
        st.withZ++;
        // 先看相鄰頂點的坡度（z 尖刺、斷層先在這裡紅），再逐頂點對獨立重算的 z（整條偏移、歸零先在這裡紅）。
        for (let k = 1; k < n; k++) {
          const dist = Math.hypot(W[k][0] - W[k - 1][0], W[k][1] - W[k - 1][1]), ex = Math.abs(it.z[k] - it.z[k - 1]) - slopeMax * dist;
          ok(ex <= zTol, label + ' ' + it.id + ' 第 ' + (k - 1) + '→' + k + ' 頂點坡度超過上限 ' + profile.maxAbsSlopePermille + '‰：dz=' + (it.z[k] - it.z[k - 1]).toFixed(3) + ' m，距離 ' + dist.toFixed(1) + ' m');
          st.worstSlopeExcessM = Math.max(st.worstSlopeExcessM, ex);
        }
        for (let k = 0; k < n; k++) {
          const err = Math.abs(it.z[k] - exp[k]);
          ok(err <= zTol, label + ' ' + it.id + ' 第 ' + k + ' 個頂點的 z=' + it.z[k] + '，獨立重算是 ' + exp[k].toFixed(3) + '（差 ' + err.toFixed(3) + ' m）');
          st.maxAbsErrM = Math.max(st.maxAbsErrM, err);
          ok(it.z[k] <= zTol && it.z[k] >= minControlZ - zTol, label + ' ' + it.id + ' 第 ' + k + ' 個頂點的 z 超出剖面範圍：' + it.z[k]);
          st.minZ = Math.min(st.minZ, it.z[k]);
        }
      }
      // 框外是 0（含沒有 z 欄位的整條）：離所有外框都有一段距離的頂點，z 必須恰為 0。
      for (let k = 0; k < n; k++) {
        const inF = insideFootprint(W[k]);
        if (inF) {
          st.inFootprint++; st.lateralMaxM = Math.max(st.lateralMaxM, project(W[k]).dist);
          // 外框邊緣（鄰頂點已在框外）的 z：記下最大絕對值，回到地面的過渡由上面的坡度檢查把關。
          if ((k + 1 < n && !insideFootprint(W[k + 1])) || (k > 0 && !insideFootprint(W[k - 1]))) st.edgeMaxAbsZ = Math.max(st.edgeMaxAbsZ, Math.abs(it.z?.[k] ?? 0));
        } else if (clearOfFootprints(W[k])) ok((it.z?.[k] ?? 0) === 0, label + ' ' + it.id + ' 第 ' + k + ' 個頂點在所有外框之外，z 應為 0，實為 ' + it.z?.[k]);
      }
      // 路線與模型用的是同一組 OSM 股道：框內的線段，way 要在模型 params.alignment 列的那一組。
      if (label === 'routes') {
        for (let k = 0; k + 1 < n; k++) if (insideFootprint(W[k]) && insideFootprint(W[k + 1])) {
          const w = railSeg.get(key(it.coordinates[k]) + '|' + key(it.coordinates[k + 1]));
          ok(w !== undefined, 'route ' + it.id + ' 第 ' + k + ' 段在 rails 裡找不到對應的 way');
          if (!modelWays.has(String(w))) st.waysOutside[w] = (st.waysOutside[w] || 0) + 1;
        }
      } else if (W.some(insideFootprint) && !modelWays.has(String(it.id))) st.waysOutside[it.id] = (st.waysOutside[it.id] || 0) + 1;
    }
    ok(Object.keys(st.waysOutside).length === 0, label + ' 在外框內的線段有不屬於模型用的那一組股道（OSM way）：' + JSON.stringify(st.waysOutside));
    ok(st.withZ > 0 && st.inFootprint > 0, label + ' 沒有任何頂點落在地下外框內，判準失明');
    st.maxAbsErrM = +st.maxAbsErrM.toFixed(4); st.worstSlopeExcessM = +st.worstSlopeExcessM.toFixed(4); st.edgeMaxAbsZ = +st.edgeMaxAbsZ.toFixed(3); st.lateralMaxM = +st.lateralMaxM.toFixed(2);
    zStats[label] = st;
  };
  checkZ(data.routes, 'routes');
  checkZ(data.rails, 'rails');
  summary.z = zStats;

  // ── 5. 每班車逐秒取樣：位置（里程→座標）、離參考線的 d、z；速度與加速度連續；臺南停靠點；兩個方向穿過地下 ──
  const caps = new Map(data.timingSource.speedCaps.caps.map(c => [JSON.stringify([c.carName, c.typeName]), c.capKmh]));
  const lenOf = tr => arranged(tr).reduce((t, p) => t + p.lengthM, 0);
  const stopsTainan = {北上: 0, 南下: 0}, underTrains = {北上: 0, 南下: 0};
  const tainan = {maxCenterDevM: 0, maxLateralM: 0, dRangeM: [Infinity, -Infinity], longestM: 0, longest: null, offscreen: []};
  const cont = {maxStepRatio: 0, maxRise: 0, maxDrop: 0, tainanLocalMaxRise: 0, tainanLocalMaxDrop: 0, samples: 0}, abrupt = [];
  const scene = {inView: 0, underground: {北上: 0, 南下: 0}, dwellAtTainan: 0};   // 開頁時刻 defaultSec 的畫面
  for (const tr of data.trains) {
    const cap = caps.get(JSON.stringify([String(tr.carName ?? ''), String(tr.typeName ?? '')]));
    ok(cap > 0, '找不到車種極速的凍結值：' + tr.carName + ' ' + tr.typeName);
    const at = new Map();   // 秒 → {s, route, coordinate}
    for (const sp of tr.spans) for (let i = 0; i < sp.s.length; i++) {
      const p = paths[sp.route].at(sp.s[i]);
      ok(p, '里程超出路線：' + tr.train);
      at.set(sp.start + i, {s: sp.s[i], route: sp.route, coordinate: p.coordinate});
    }
    // 位置連續：相鄰兩秒的位移 ≤ 極速；點速增加 ≤ ACCEL_MAX；點速減少超過 ACCEL_MAX 只准發生在停靠站的到站那一秒（同一秒在兩個路段的重疊點不算兩次）。
    const T = tr.stops.find(s => norm(s.name) === norm(U.stopStation));
    const near = t => T && T.stop && t >= T.arrSec - 180 && t <= T.depSec + 180;
    // 停下來的到站：停靠站，和實測日被留置的通過站（stop 為 false，但 holdSec > 0，到站後真的停了一段時間）。預覽班表的通過站沒有留置。
    const arrivalAt = new Map(tr.stops.filter(s => s.stop || s.holdSec > 0).map(s => [s.arrSec, s.name]));
    const here = at.get(data.defaultSec);
    if (here) {
      scene.inView++;
      const q = world(here.coordinate), pr = project(q);
      if (pr.dist <= 30 && insideFootprint(q) && zOfD(pr.d) <= -7 + zTol) scene.underground[tr.direction]++;
      if (T && T.stop && data.defaultSec >= T.arrSec && data.defaultSec <= T.depSec) scene.dwellAtTainan++;
    }
    let prevV = null;
    for (const [t, a] of at) {
      const b = at.get(t + 1);
      if (!b) { prevV = null; continue; }
      const v = distanceM(a.coordinate, b.coordinate);
      ok(v <= cap / 3.6 + 0.01, '位置跳點：' + tr.train + ' ' + t + ' 秒位移 ' + v.toFixed(2) + ' m，超過極速 ' + cap + ' km/h');
      cont.maxStepRatio = Math.max(cont.maxStepRatio, v / (cap / 3.6));
      if (prevV !== null) {
        const dv = v - prevV;
        ok(dv <= ACCEL_MAX, '點速突然增加：' + tr.train + ' ' + t + ' 秒由 ' + prevV.toFixed(2) + ' 增為 ' + v.toFixed(2) + ' m/s（上限 ' + ACCEL_MAX + ' m/s²）');
        cont.maxRise = Math.max(cont.maxRise, dv);
        if (near(t)) cont.tainanLocalMaxRise = Math.max(cont.tainanLocalMaxRise, dv);
        if (dv < -ACCEL_MAX) {
          ok(arrivalAt.has(t), '點速突然減少，而且不是停靠站的到站那一秒：' + tr.train + ' ' + t + ' 秒由 ' + prevV.toFixed(2) + ' 降為 ' + v.toFixed(2) + ' m/s（上限 ' + ACCEL_MAX + ' m/s²）');
          abrupt.push({train: tr.id, station: arrivalAt.get(t), fromMps: +prevV.toFixed(2)});
        } else {
          cont.maxDrop = Math.max(cont.maxDrop, -dv);
          if (near(t)) cont.tainanLocalMaxDrop = Math.max(cont.tainanLocalMaxDrop, -dv);
        }
      }
      prevV = v; cont.samples++;
    }
    // 穿過地下：整班車有沒有任何一秒落在隧道、站體外框內（z ≤ 洞口的 −7 m）。
    let deepest = 0;
    for (const [, a] of at) { const q = world(a.coordinate), pr = project(q); if (pr.dist <= 30 && insideFootprint(q)) deepest = Math.min(deepest, zOfD(pr.d)); }
    if (deepest <= -7 + zTol) underTrains[tr.direction]++;

    // 臺南停靠點
    if (!(T && T.stop)) continue;
    const dwell = [...at].filter(([t]) => t >= T.arrSec && t <= T.depSec);
    if (!dwell.length) {
      ok(T.arrSec > 86399 || T.depSec < 0, '臺南停靠的時段（' + T.arrSec + '–' + T.depSec + '）在當天之內，卻沒有取樣：' + tr.id);
      tainan.offscreen.push(tr.id); continue;
    }
    stopsTainan[tr.direction]++;
    const s0 = dwell[0][1].s;
    for (const [t, a] of dwell) {
      ok(Math.abs(a.s - s0) <= 0.002, '臺南停站期間位置在動：' + tr.id + ' ' + t + ' 秒里程差 ' + (a.s - s0).toFixed(3) + ' m');
      const pr = project(world(a.coordinate)), dev = pr.d - C;
      ok(Math.abs(dev) <= V.centerToleranceM, '臺南停靠點不在月台中央：' + tr.id + ' 整列中心 d=' + pr.d.toFixed(2) + '，月台中央 ' + C + '（差 ' + dev.toFixed(2) + ' m，上限 ' + V.centerToleranceM + '）');
      tainan.maxCenterDevM = Math.max(tainan.maxCenterDevM, Math.abs(dev)); tainan.maxLateralM = Math.max(tainan.maxLateralM, pr.dist);
    }
    // 整列：長度＝車輛目錄各節 pitchM 加總；取樣點必須是整列中心（頁面的 formationPoses 實跑，不信公式）；前後端的 d 在月台範圍內。
    const parts = arranged(tr), L = lenOf(tr), mid = dwell[Math.floor(dwell.length / 2)][1], route = paths[mid.route];
    ok(Math.abs(L - fleet.formations[tr.formation.id].cars.reduce((t, c) => t + fleet.meshes[c.mesh].pitchM, 0)) < 1e-9, '編組長度不是車輛目錄 pitchM 的加總：' + tr.id);
    const poses = formationPoses(route, mid.s, 1, parts);
    ok(poses, '臺南停靠的整列落在路線之外：' + tr.id);
    const front = Math.max(...poses.map((p, i) => p.s + parts[i].lengthM / 2)), back = Math.min(...poses.map((p, i) => p.s - parts[i].lengthM / 2));
    ok(Math.abs((front + back) / 2 - mid.s) < 1e-6 && Math.abs(front - back - L) < 1e-6, '取樣點不是整列中心：' + tr.id);
    const dF = project(world(route.at(front).coordinate)).d, dB = project(world(route.at(back).coordinate)).d, lo = Math.min(dF, dB), hi = Math.max(dF, dB);
    ok(lo >= plat.d0 - zTol && hi <= plat.d1 + zTol, '臺南停靠的整列超出月台範圍 d ' + plat.d0 + '–' + plat.d1 + '：' + tr.id + ' 長 ' + L.toFixed(1) + ' m，前後端 d ' + lo.toFixed(1) + '–' + hi.toFixed(1));
    tainan.dRangeM = [Math.min(tainan.dRangeM[0], lo), Math.max(tainan.dRangeM[1], hi)];
    if (L > tainan.longestM) { tainan.longestM = L; tainan.longest = tr.id; }
  }
  for (const d of ['北上', '南下']) ok(underTrains[d] === V.trainsUnderground[d], '穿過地下段的' + d + '班數應為 ' + V.trainsUnderground[d] + '，實為 ' + underTrains[d]);
  for (const d of ['北上', '南下']) ok(stopsTainan[d] === V.tainanStops[d], '臺南有停靠的' + d + '班數應為 ' + V.tainanStops[d] + '，實為 ' + stopsTainan[d]);
  ok(tainan.offscreen.length === V.offscreenStops, '臺南停靠點落在當天之外的班數應為 ' + V.offscreenStops + '，實為 ' + tainan.offscreen.length + '：' + tainan.offscreen);
  // 開頁時刻：設定值＝snapshot 值；畫面內的班數、在地下的班數、停在臺南月台的班數照設定；前後 30 秒不在不確定時段內。
  ok(data.defaultSec === cfg.defaultSec, 'defaultSec 應為 ' + cfg.defaultSec + '，實為 ' + data.defaultSec);
  const DS = V.defaultScene;
  ok(scene.inView === DS.inView && scene.underground['北上'] === DS.underground['北上'] && scene.underground['南下'] === DS.underground['南下'] && scene.dwellAtTainan === DS.dwellAtTainan,
    '開頁時刻 ' + data.defaultSec + ' 的畫面應為 ' + JSON.stringify(DS) + '，實為 ' + JSON.stringify(scene));
  ok(!read('uncertainty.json').intervals.some(i => i.start <= data.defaultSec + 30 && i.end >= data.defaultSec - 30), '開頁時刻前後 30 秒落在不確定時段內：' + data.defaultSec);
  ok(abrupt.length === V.abruptArrivals, '到站那一秒從行駛速度直接停住的班數應為 ' + V.abruptArrivals + '，實為 ' + abrupt.length + '：' + abrupt.map(x => x.train + '@' + x.station + ' ' + x.fromMps + ' m/s'));
  summary.tainan = {stops: stopsTainan, offscreen: tainan.offscreen, maxCenterDevM: +tainan.maxCenterDevM.toFixed(4), maxLateralToReferenceM: +tainan.maxLateralM.toFixed(2),
    formationDRange: tainan.dRangeM.map(v => +v.toFixed(1)), platformD: [plat.d0, plat.d1], longestFormationM: +tainan.longestM.toFixed(2), longestFormation: tainan.longest};
  summary.trainsUnderground = underTrains;
  summary.defaultScene = {sec: data.defaultSec, ...scene};
  const abruptByStation = {};
  for (const x of abrupt) abruptByStation[x.station] = (abruptByStation[x.station] || 0) + 1;
  summary.continuity = {samples: cont.samples, maxStepToCapRatio: +cont.maxStepRatio.toFixed(4), limitMps2: ACCEL_MAX,
    maxRiseMps2: +cont.maxRise.toFixed(3), maxDropMps2ExceptAbrupt: +cont.maxDrop.toFixed(3),
    tainanWithin180s: {maxRiseMps2: +cont.tainanLocalMaxRise.toFixed(3), maxDropMps2ExceptAbrupt: +cont.tainanLocalMaxDrop.toFixed(3)},
    abruptArrivals: {count: abrupt.length, byStation: abruptByStation, maxFromMps: Math.max(0, ...abrupt.map(x => x.fromMps)), trains: abrupt.map(x => x.train)}};
  return summary;
}

#!/usr/bin/env node
// 逐車名冊驗收：對真實 payload 跑 buildCensusRoster，驗它宣稱的契約。
// 判準刻意包含「帳要平」與「跨輪不倒退」，因為那兩件正是舊名冊出事的地方。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel } from './trtc_board_ledger.mjs';
import { buildCensusRoster } from './trtc_census_roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.TRTC_LIVE_URL || 'https://railisland.tw/api/trtc-live';
const ROUNDS = Number(process.env.CENSUS_ROUNDS || 2);
const GAP_MS = Number(process.env.CENSUS_GAP_MS || 45000);

let failures = 0, assertions = 0;
const check = (pass, label, detail = '') => {
  assertions++; if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

const j = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const model = buildTrtcModel(j('data/trtc.json'), j('data/trtc_times.json'), j('data/trtc_codes.json'), { includeY: true });
const day = new Date().toISOString().slice(0, 10);

console.log('【自檢】');
console.log(`  model：${model.lines.size} 線、codeMap ${model.codeMap.size} 個站碼`);
check(model.lines.size >= 8 && model.codeMap.size > 100, '自檢：模型載入完整');

const snaps = [];
for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(res => setTimeout(res, GAP_MS));
  const live = await (await fetch(LIVE, { headers: { 'cache-control': 'no-cache' } })).json();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const built = buildCensusRoster({ model, trains: live.trains || [], nowEpoch, day,
    prior: snaps.length ? snaps[snaps.length - 1].vehicles : null });
  snaps.push({ live, nowEpoch, ...built });
  console.log(`  第 ${r + 1} 輪：逐車 ${(live.trains || []).length} 筆 → 名冊 ${built.vehicles.length} 台` +
    `｜${JSON.stringify(built.diagnostics.byLine)}`);
}

const s = snaps[0], d = s.diagnostics, V = s.vehicles;

// 1. 帳要平：每一筆逐車清單都要有去處，不准靜默消失
const accounted = d.built + d.noCode + d.unresolved + d.stale + d.duplicates;
check(accounted === d.input, '每一筆逐車資料都有交代（建車／無站碼／解不出／過舊／重複）',
  `輸入 ${d.input}＝建 ${d.built}＋無站碼 ${d.noCode}＋解不出 ${d.unresolved}＋過舊 ${d.stale}＋重複 ${d.duplicates}`);

// 2. 建車率：官方說有這麼多台，我們就該畫這麼多台
check(d.built / d.input >= .9, '建車率 ≥ 90%', `${d.built}/${d.input}＝${(d.built / d.input * 100).toFixed(0)}%`);

// 3. 身分唯一
check(new Set(V.map(v => v.vehicleId)).size === V.length, 'vehicleId 無重複', `${V.length} 台`);

// 4. 幾何合法：相鄰兩站或停在端點
const badSeg = V.filter(v => !(v.from === v.to ? v.terminal : Math.abs(v.to - v.from) === 1));
check(!badSeg.length, '每台車都落在相鄰兩站之間（或停在端點）',
  badSeg.length ? JSON.stringify(badSeg.slice(0, 3).map(v => ({ v: v.vehicleId, from: v.from, to: v.to }))) : `${V.length} 台`);

// 5. dir 與實際行進方向一致（不是照抄可能落後的 dir 欄位）
const badDir = V.filter(v => !v.terminal && ((v.to > v.from) ? v.dir !== 2 : v.dir !== 1));
check(!badDir.length, 'dir 與 from→to 的實際方向一致', badDir.length ? `${badDir.length} 台不符` : '全數一致');
console.log(`   （方向來源：path ${d.dirFromPath} 台、dir 欄位 ${d.dirFromField} 台；` +
  `其中 dir 欄位與 path 矛盾 ${d.dirFieldDisagreed} 台 ⇒ 若照抄 dir 就會畫反向）`);

// 6. timeline 時間單調且方向一致
const badTl = V.filter(v => {
  const tl = v.timeline || []; if (tl.length < 2) return false;
  for (let i = 1; i < tl.length; i++) {
    if (!(tl[i].arrEpoch > tl[i - 1].arrEpoch)) return true;
    if (Math.sign(tl[i].to - tl[i].from) !== Math.sign(tl[i - 1].to - tl[i - 1].from)) return true;
  }
  return false;
});
check(!badTl.length, 'timeline 時刻遞增且不換方向', badTl.length ? `${badTl.length} 台` : `多段車 ${V.filter(v => (v.timeline || []).length > 1).length} 台`);

// 7. 同段可以有兩台（使用者明示：下一站看到兩個倒數就是有兩台），但不可疊在同一個點上。
// 判準因此是「進度要分得開」而不是「一段只准一台」。
const slots = new Map();
for (const v of V) {
  if (v.terminal) continue;
  const k = `${v.line}|${v.dir}|${v.from}>${v.to}`;
  if (!slots.has(k)) slots.set(k, []);
  slots.get(k).push(v);
}
const overlap = [];
for (const [k, a] of slots) {
  if (a.length < 2) continue;
  const prog = a.map(v => ({ id: v.vehicleId, f: v.run > 0 ? (v.arrEpoch - s.nowEpoch) / v.run : 0 }))
    .sort((x, y) => x.f - y.f);
  for (let i = 1; i < prog.length; i++)
    if (Math.abs(prog[i].f - prog[i - 1].f) < .12) overlap.push(`${k} ${prog[i - 1].id}~${prog[i].id}`);
}
const shared = [...slots.values()].filter(a => a.length > 1).length;
check(!overlap.length, '同一區間的兩台車進度分得開（不會疊成同一個點）',
  overlap.length ? overlap.slice(0, 4).join('、') : `共用區間 ${shared} 段、${slots.size} 個區間`);

// 8. 車號留白只發生在文湖線（高運量一律要有車次）
const hwBlank = V.filter(v => v.line !== 'BR' && !v.officialNo);
check(!hwBlank.length, '高運量每一台都有官方車次（文湖線留白是預期的）',
  hwBlank.length ? `${hwBlank.length} 台無號` : `BR 留白 ${V.filter(v => !v.officialNo).length} 台`);

// 9. 跨輪：同一台車不得倒退，身分不得跳號
if (snaps.length > 1) {
  const a = new Map(snaps[0].vehicles.map(v => [v.vehicleId, v]));
  let compared = 0, back = [], kept = 0;
  for (const v of snaps[1].vehicles) {
    const p = a.get(v.vehicleId); if (!p) continue;
    kept++;
    if (v.terminal || p.terminal) continue;
    if (v.dir !== p.dir || v.line !== p.line) continue;   // 終點站折返會換方向，那是正常的
    compared++;
    // 沿行進方向的進度：以 to 的站序為準，同段則比 arrEpoch 是否往前推進
    const step = v.dir === 2 ? 1 : -1;
    if ((v.to - p.to) * step < 0) back.push({ v: v.vehicleId, from: p.to, to: v.to });
  }
  check(kept > 0, '兩輪之間身分有延續', `${kept}/${snaps[1].vehicles.length} 台同 id`);
  check(!back.length, '兩輪之間沒有車倒退',
    back.length ? JSON.stringify(back.slice(0, 5)) : `比對 ${compared} 台`);
}

console.log(`\n斷言 ${assertions} 條，失敗 ${failures} 條`);
if (assertions === 0) { console.log('❌ 零斷言＝沒跑起來'); process.exit(2); }
process.exit(failures ? 1 : 0);

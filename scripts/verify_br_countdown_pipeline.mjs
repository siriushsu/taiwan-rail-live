#!/usr/bin/env node
// 整合驗收：真實 data/ 模型 + 真實 BR 站名 → resolveBoardRows → segmentVehiclesFromCountdowns。
// 單元測試用的是造出來的 S0..S11，照不到「官方站名 vs 我方站名正規化」這一層——而那正是最容易斷的地方。
// 用法：node scripts/verify_br_countdown_pipeline.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel, resolveBoardRows, segmentVehiclesFromCountdowns } from './trtc_board_ledger.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const model = buildTrtcModel(J('data/trtc.json'), J('data/trtc_times.json'), J('data/trtc_codes.json'), { includeY: true });
const BR = model.lines.get('BR');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log(`\n模型自檢：BR ${BR.stations.length} 站，${BR.stations[0].name} → ${BR.stations[BR.stations.length - 1].name}`);
ok('BR 站數 24（讀到的是真模型不是替身）', BR.stations.length === 24, `實得 ${BR.stations.length}`);
ok('BR 區間行車秒齊全（契約第 8 條的資料底）',
  [...Array(23).keys()].every(i => BR.runs.get(`${i}>${i + 1}`) > 0));

// trtcEpoch 與 worker 同一份實作（複製，避免 import worker.js 拖進 Cloudflare 相依）
const trtcEpoch = s => {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : NaN;
};
const NOW_STR = '2026-08-18 08:00:00', NOW = trtcEpoch(NOW_STR);
const mmss = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// 正向產生器：擺車 → 依真實區間秒算各站倒數 → 產生官方格式的 TrackInfo 列（TrainNumber 恆空）
function brRows(trains, dir) {
  const step = dir === 2 ? 1 : -1, last = dir === 2 ? 23 : 0;
  const destName = BR.stations[last].name;
  const sorted = trains.slice().sort((a, b) => (a.to - b.to) * step);
  const rows = [];
  for (let t = 0; t < sorted.length; t++) {
    const tr = sorted[t];
    const limit = t + 1 < sorted.length ? sorted[t + 1].to - step : last;
    let sec = tr.headSec;
    for (let s = tr.to; (s - limit) * step <= 0; s += step) {
      rows.push({ StationName: BR.stations[s].name, DestinationName: destName,
        CountDown: sec === 0 ? '列車進站' : mmss(sec), NowDateTime: NOW_STR, TrainNumber: '' });
      const r = BR.runs.get(step > 0 ? `${s}>${s + 1}` : `${s}>${s - 1}`);
      if (!(r > 0)) break;
      sec += r;
    }
  }
  return rows;
}

function run(label, trains, dir) {
  const raw = brRows(trains, dir);
  const resolved = resolveBoardRows(model, raw, trtcEpoch, new Map());
  const brResolved = resolved.rows.filter(r => r.line === 'BR');
  // 🔴 唯一合法的丟列＝「終點站自己那一列」（StationName === DestinationName）：站＝終點推不出
  // 方向，是退化列，上游語意上本來就該拒收（實測逐站掃描 24 站只有 i=23 這一列解不出）。
  // 真正的後果：跑在最後一段（倒數第二站→終點）的車沒有前方站可觀測 ⇒ 偵測不到。
  // 那台車正要到終點收車，依 08-14 裁示本來就要拿掉，所以不補。這條不是「容忍誤差」，
  // 是把已知且有解釋的邊界寫成期望值——若哪天丟的不只這一列，這個斷言就會轉紅。
  const degenerate = raw.filter(r => r.StationName === r.DestinationName).length;
  ok(`${label}：除了終點退化列，官方站名全部解析成功`,
    brResolved.length === raw.length - degenerate,
    `解析 ${brResolved.length}/${raw.length}，應丟 ${degenerate}，實丟 ${JSON.stringify(resolved.dropped)}`);
  ok(`${label}：方向全部判成 ${dir}`, brResolved.every(r => r.dir === dir),
    [...new Set(brResolved.map(r => r.dir))].join(','));
  const seg = segmentVehiclesFromCountdowns(model, resolved.rows, { lines: ['BR'] });
  const want = trains.slice().sort((a, b) => (a.to - b.to) * (dir === 2 ? 1 : -1));
  const got = seg.vehicles.slice().sort((a, b) => (a.to - b.to) * (dir === 2 ? 1 : -1));
  ok(`${label}：還原車數 ${want.length}`, got.length === want.length, `實得 ${got.length}`);
  if (got.length !== want.length) return;
  ok(`${label}：每台的 to 站正確`, got.every((g, i) => g.to === want[i].to),
    got.map(g => g.to).join(',') + ' vs ' + want.map(w => w.to).join(','));
  ok(`${label}：到站時刻 = 官方倒數（一秒不差）`,
    got.every((g, i) => g.arrEpoch === NOW + want[i].headSec));
  ok(`${label}：path 站名對得回線上站序`,
    got.every(g => g.path.every(p => BR.stations.some(s => s.name === p.name))));
}

console.log('\n【1】往南港展覽館（dir 2）六台車');
run('dir2', [{ to: 2, headSec: 40 }, { to: 6, headSec: 25 }, { to: 9, headSec: 70 },
  { to: 13, headSec: 15 }, { to: 17, headSec: 55 }, { to: 21, headSec: 30 }], 2);

console.log('\n【2】往動物園（dir 1）六台車');
run('dir1', [{ to: 21, headSec: 40 }, { to: 17, headSec: 25 }, { to: 13, headSec: 70 },
  { to: 9, headSec: 15 }, { to: 6, headSec: 55 }, { to: 2, headSec: 30 }], 1);

console.log('\n【3】「列車進站」(倒數 0) 也要算得出車');
run('進站中', [{ to: 5, headSec: 0 }, { to: 12, headSec: 45 }], 2);

console.log('\n【4】🔴 突變：把區間秒下限檢查關掉，起點列就會吃掉真車');
{
  const raw = brRows([{ to: 8, headSec: 90 }], 2);
  raw.push({ StationName: BR.stations[0].name, DestinationName: BR.stations[23].name,
    CountDown: '00:20', NowDateTime: NOW_STR, TrainNumber: '' }); // 起點「下一班」列，時刻更早
  const resolved = resolveBoardRows(model, raw, trtcEpoch, new Map());
  const seg = segmentVehiclesFromCountdowns(model, resolved.rows, { lines: ['BR'] });
  ok('起點列被丟、真車保留（1 台）', seg.vehicles.length === 1, `實得 ${seg.vehicles.length}`);
  ok('真車的 to 仍是 8（沒被起點列併走）', seg.vehicles[0] && seg.vehicles[0].to === 8,
    String(seg.vehicles[0] && seg.vehicles[0].to));
  ok('起點列計入 diagnostics', seg.diagnostics.originRows === 1);
}

console.log('\n【5】🔴 反向對照：資料本身沒有車時不准無中生有');
{
  const seg = segmentVehiclesFromCountdowns(model, [], { lines: ['BR'] });
  ok('空輸入 ⇒ 零台（不是憑班表補）', seg.vehicles.length === 0);
}

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (!pass) { console.error('🔴 零斷言＝沒驗'); process.exit(3); }
process.exit(fail ? 1 : 0);

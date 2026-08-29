// 兩站接駁支線（小碧潭 G_XBT／新北投 R_XBT）發車後必須是一段「可內插」的區間，
// 而且這個修法不得外溢到任何其他路線。
//
// 背景（2026-08-29 實測正式站）：這兩條線兩端都是終點站，官方只公布各站的**發車**倒數，
// 永遠不會有對端到站列（整份 feed 就 4 列，全部落在自己的起點）⇒ 帳本一律判成起點列 run=0。
// coastForward() 讓它前進成 from≠to 之後 run 仍是 0，於是 Metro Core（100% 吃
// boardPos.vehicles）只能把車釘在原地：Core 給兩條支線的座標逐輪一字不變，而同一時刻
// legacy（有前端獨有的 trtcOfficialRosterRepairRun 修復）的位置是連續前進的。
//
// 判準四層，缺一不可：
//   A 正向：支線車發車後 run 必須等於該線段的實際行車秒（不是「大於 0」——那連亂數都會過）。
//   B 反向控制：一般路線的 coasted 車必須與修前逐欄位相同。
//   C 真實 payload 不外溢：拿正式站當下的 boardPos.vehicles 跑修前／修後，
//     差異必須「只出現在 _XBT 車、且只有 run 這一欄」。
//   D 突變控制：把「只對一段式路線補」的閘門拿掉，C 必須轉紅——證明是那道閘門在圍堵，
//     不是剛好沒有其他車走到這條路徑（判準有沒有牙，只有突變測得出來）。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'scripts/trtc_official_roster.mjs';
const LIVE = process.env.XBT_LIVE_URL || 'https://railisland.tw/api/trtc-live';
let pass = 0, fail = 0;
const ok = (name, cond, got) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '　實測：' + got}`); };

const dir = mkdtempSync(join(tmpdir(), 'xbt-'));
const fixedSrc = readFileSync(SRC, 'utf8');
// 🔴 三個版本全部從【當前原始碼】的同一個旗標長出來，不用 `git show HEAD:` 當基準——
// 那樣一旦這個修法 commit 進 HEAD，基準就會退化成「修後對修後」，A 層會永遠自我證明
// （判斷力心得 23：基準必須取改動前的行為，不能拿改後狀態自比）。
// 這裡的 singleSegmentLine() 就是修法的唯一開關：
//   關掉 = 修法之前的行為（任何線都不補 run）  開到全開 = 拿掉圍堵（每條線都補）
const GATE = '  try { return stationCount(model, lineId) <= 2; } catch (e) { return false; }';
if (!fixedSrc.includes(GATE)) {
  console.log(`❌ 找不到 singleSegmentLine() 的閘門那一行 —— 本腳本的三版對照全部失效。\n` +
    `   （${SRC} 被改過就要同步更新這裡的 GATE 常數，不要讓它靜默退化成單版自比）`);
  process.exit(1);
}
const baselineSrc = fixedSrc.replace(GATE, '  return false;');
const mutantSrc = fixedSrc.replace(GATE, '  return true;');
const paths = { baseline: join(dir, 'baseline.mjs'), fixed: join(dir, 'fixed.mjs'), mutant: join(dir, 'mutant.mjs') };
writeFileSync(paths.baseline, baselineSrc);
writeFileSync(paths.fixed, fixedSrc);
writeFileSync(paths.mutant, mutantSrc);
const mods = {
  baseline: await import(paths.baseline),
  fixed: await import(paths.fixed),
  mutant: await import(paths.mutant),
};
const ledger = await import('./trtc_board_ledger.mjs');
const jsonOf = f => JSON.parse(readFileSync(f, 'utf8'));
// 與 worker 的 trtcBoardModel() 同一組來源與旗標；少了 includeY 會缺環狀線，
// C 層就會在真實 payload 上炸掉（或更糟：靜默少驗一條線）。
const model = ledger.buildTrtcModel(jsonOf('data/trtc.json'), jsonOf('data/trtc_times.json'),
  jsonOf('data/trtc_codes.json'), { includeY: true });
const segOf = (line, from, to) => Number(model.lines.get(line).runs.get(`${from}>${to}`));

const DAY = '2026-08-29';
const run1 = (mod, vehicles, nowEpoch) => mod.reduceOfficialRoster({
  model, rows: [], prior: { day: DAY, vehicles }, day: DAY, nowEpoch, sourceRevision: nowEpoch });
const byId = out => new Map((out.vehicles || []).map(v => [String(v.vehicleId), v]));

// ── A 正向：兩條支線各一台,發車 30 秒後 ──────────────────────────────────────────
const T = 1788000000;
for (const [line, dir1From] of [['G_XBT', 1], ['R_XBT', 1]]) {
  const expect = segOf(line, dir1From, dir1From - 1);
  const v = { vehicleId: `t:${line}`, line, dir: 1, dest: 0, from: dir1From, to: dir1From, run: 0,
    arrEpoch: T, terminal: true, source: 'official', officialNo: null, extension: false,
    birthEvidence: { source: 'official-board', sourceRevision: T, observedEpoch: T, line, dir: 1,
      from: dir1From, to: dir1From, arrEpoch: T, occurrence: 0 },
    history: [{ to: dir1From, arrEpoch: T }],
    timeline: [{ from: dir1From, to: dir1From, depEpoch: T, arrEpoch: T, terminal: true }] };
  const now = T + OFFICIAL_DWELL() + 5;
  const before = byId(run1(mods.baseline, [v], now)).get(`t:${line}`);
  const after = byId(run1(mods.fixed, [v], now)).get(`t:${line}`);
  ok(`A ${line}：修前確實是壞的（發車後 from≠to 但 run=0）`,
    before && Number(before.from) !== Number(before.to) && Number(before.run) === 0,
    before ? `from=${before.from} to=${before.to} run=${before.run}` : '車不見了');
  ok(`A ${line}：修後 run＝該線段實際行車秒 ${expect}`,
    after && Number(after.run) === expect, after ? `run=${after.run}` : '車不見了');
  ok(`A ${line}：幾何合格（非同站且 run>0,前端整包驗證器才收）`,
    after && Number(after.to) === Number(after.from) - 1 && Number(after.run) > 0,
    after ? `from=${after.from} to=${after.to} run=${after.run}` : '車不見了');
}
function OFFICIAL_DWELL() { return Number(mods.fixed.OFFICIAL_COAST_DWELL_DEFAULT_SEC); }

// ── B 反向控制：一般路線（淡水信義線 R）的 coasted 車必須逐欄位相同 ─────────────────
// 🔴 控制車要挑「現在這一段」與「下一段」秒數**不同**的區間：兩段恰好相等時，突變體
// 把 run 換成下一段秒數等於沒換，D 層就會誤報「閘門有牙」（實測 R 線 5→6 與 6→7 都是
// 同一個值，第一版控制車就是這樣自己失效的）。這裡自動挑，並在下面把前提寫成斷言。
const CONTROL_SEG = (() => {
  for (const line of ['R', 'BL', 'G', 'O_XINZHUANG']) {
    const L = model.lines.get(line);
    if (!L) continue;
    for (let i = 1; i + 1 < L.stations.length; i++) {
      const a = segOf(line, i - 1, i), b = segOf(line, i, i + 1);
      if (a > 0 && b > 0 && a !== b) return { line, from: i - 1, to: i, run: a, nextRun: b };
    }
  }
  return null;
})();
const CONTROL_R = (() => {
  const { line, from, to } = CONTROL_SEG;
  return { vehicleId: 't:R', line, dir: 2, dest: L_LAST(line), from, to, run: segOf(line, from, to),
    arrEpoch: T, terminal: false, source: 'official', officialNo: '999', extension: false,
    birthEvidence: { source: 'official-board', sourceRevision: T - 200, observedEpoch: T - 200,
      line, dir: 2, from, to, arrEpoch: T, occurrence: 0 },
    history: [{ to: from, arrEpoch: T - 200 }, { to, arrEpoch: T }],
    timeline: [{ from, to, depEpoch: T - 90, arrEpoch: T, terminal: false }] };
})();
function L_LAST(line) { return model.lines.get(line).stations.length - 1; }
ok('B 前提：找得到「前後兩段秒數不同」的一般路線控制區間（否則 D 層咬不到）',
  CONTROL_SEG != null && CONTROL_SEG.run !== CONTROL_SEG.nextRun,
  CONTROL_SEG ? `${CONTROL_SEG.line} ${CONTROL_SEG.from}>${CONTROL_SEG.to} ${CONTROL_SEG.run}s／下一段 ${CONTROL_SEG.nextRun}s` : '找不到');
{
  const { line, from, to } = CONTROL_SEG, expect = segOf(line, to, to + 1), v = CONTROL_R;
  const now = T + OFFICIAL_DWELL() + 5;
  const before = byId(run1(mods.baseline, [v], now)).get('t:R');
  const after = byId(run1(mods.fixed, [v], now)).get('t:R');
  ok('B 一般路線：這台車真的有 coast 前進（控制組本身有效）',
    before && Number(before.to) === to + 1, before ? `to=${before.to}` : '車不見了');
  ok('B 一般路線：修前修後逐欄位完全相同（不外溢）',
    JSON.stringify(before) === JSON.stringify(after),
    `run ${before && before.run} → ${after && after.run}`);
  ok('B 一般路線：修後的 run 沒有被換成新一段的秒數（那才是外溢的形狀）',
    after && Number(after.run) !== expect || segOf(line, from, to) === expect,
    after ? `run=${after.run} 新段=${expect}` : '車不見了');
}

// ── C 真實 payload：差異只准出現在 _XBT 的 run ────────────────────────────────────
const res = await fetch(`${LIVE}?bust=${Date.now()}`);
if (!res.ok) { console.log(`❌ 取不到正式站 payload（HTTP ${res.status}）——C/D 兩層無法評估`); process.exit(1); }
const live = await res.json();
// tripKey／scheduleKey 是逐班綁定器在名冊之後才貼上的欄位，reducer 明確拒收（「不得混入
// 班表身分」）。這裡把它們剝掉還原成名冊當下的形狀，不是放寬判準。
const liveVehicles = (live.boardPos && live.boardPos.vehicles || []).map(v => {
  const { tripKey, scheduleKey, ...rest } = v;
  return rest;
});
ok('C 前提：正式站 payload 拿得到車，且含兩條支線',
  liveVehicles.length > 0 && liveVehicles.some(v => /_XBT$/.test(String(v.line))),
  `${liveVehicles.length} 台，支線 ${liveVehicles.filter(v => /_XBT$/.test(String(v.line))).length} 台`);
const nowLive = Math.floor(Date.now() / 1000);
const diffFields = (a, b) => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter(k => JSON.stringify(a && a[k]) !== JSON.stringify(b && b[k]));
};
const compare = (variant, fleet = liveVehicles) => {
  const base = byId(run1(mods.baseline, fleet, nowLive));
  const other = byId(run1(mods[variant], fleet, nowLive));
  const changed = [];
  for (const [id, v] of base) {
    const f = diffFields(v, other.get(id));
    if (f.length) changed.push({ id, line: v.line, fields: f });
  }
  return changed;
};
const changedFixed = compare('fixed');
const spill = changedFixed.filter(c => !/_XBT$/.test(String(c.line)));
const badField = changedFixed.filter(c => c.fields.some(f => f !== 'run'));
ok('C 不外溢：修前修後的差異一台都沒落在非支線上',
  spill.length === 0, `${spill.length} 台外溢：${spill.slice(0, 5).map(c => c.line + '/' + c.id).join(' ')}`);
ok('C 只動 run：差異欄位只有 run',
  badField.length === 0, badField.slice(0, 3).map(c => c.line + ':' + c.fields.join(',')).join(' | '));

// C 的分母要講清楚：這一輪真實 payload 裡實際走到 coastForward 的有幾台。
// 只印在 detail 等於沒 gate（分母會無聲縮水），所以下面 D 直接用「保證會 coast 的控制車」施測。
const baseOut = byId(run1(mods.baseline, liveVehicles, nowLive));
const coasted = [...baseOut.values()].filter(v => v && v.coasted === true);
console.log(`   （分母）本輪真實 payload ${liveVehicles.length} 台，實際 coast 前進 ${coasted.length} 台：` +
  `支線 ${coasted.filter(v => /_XBT$/.test(String(v.line))).length} 台、` +
  `其他線 ${coasted.filter(v => !/_XBT$/.test(String(v.line))).length} 台`);

// ── D 突變控制：拿掉閘門後，非支線必須也被改到（證明閘門有牙）─────────────────────
// 🔴 真實 payload 常常沒有任何一般路線的車正在 coast（2026-08-29 實測就是 0 台），
// 那時候「突變也沒外溢」只是碰巧沒車可咬 ⇒ 會把「沒有牙」誤讀成「有牙」。
// 所以突變一律對「真實車隊 ＋ 一台保證正在 coast 的一般路線控制車」施測。
const FLEET_D = liveVehicles.concat([CONTROL_R]);
const mutantSpill = compare('mutant', FLEET_D).filter(c => !/_XBT$/.test(String(c.line)));
const fixedSpillD = compare('fixed', FLEET_D).filter(c => !/_XBT$/.test(String(c.line)));
ok('D 突變：閘門拿掉後非支線確實被改到（所以 C 的綠是閘門擋出來的，不是碰巧沒車）',
  mutantSpill.some(c => c.id === 't:R'), `突變後外溢 ${mutantSpill.length} 台（期望含 t:R）`);
ok('D 同一份車隊下，修後版本仍然零外溢',
  fixedSpillD.length === 0, `${fixedSpillD.length} 台：${fixedSpillD.slice(0, 5).map(c => c.line + '/' + c.id).join(' ')}`);

console.log(`\n通過 ${pass}／失敗 ${fail}`);
process.exit(fail ? 1 : 0);

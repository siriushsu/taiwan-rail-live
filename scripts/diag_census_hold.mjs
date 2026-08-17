// 量 census 的 hold 到底發生多少、持續多久：hold 是「這輪算不出位置就沿用上一輪」，
// 使用者質疑它會不會變成過去那種幽靈車。要回答的是三個量：
//   1. 每輪 hold 幾台（規模）
//   2. 同一台連續被 hold 幾輪（會不會變成長期停在舊位置的殭屍）
//   3. hold 的那台，官方清單是不是還列著它（＝它有沒有可能變成「官方沒說卻還在畫」）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrtcModel } from './trtc_board_ledger.mjs';
import { buildCensusRoster } from './trtc_census_roster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const model = buildTrtcModel(j('data/trtc.json'), j('data/trtc_times.json'), j('data/trtc_codes.json'), { includeY: true });
const day = new Date().toISOString().slice(0, 10);
const ROUNDS = Number(process.argv[2] || 10), GAP = Number(process.argv[3] || 20);

let prior = null;
const holdStreak = new Map();     // vehicleId → 連續被 hold 幾輪
let maxStreak = 0, totalHold = 0, orphanHold = 0;

for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const live = await (await fetch('https://railisland.tw/api/trtc-live', { headers: { 'cache-control': 'no-cache' } })).json();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const trains = live.trains || [];
  const officialNos = new Set(trains.map(t => `${t.sys === 'br' ? 'br' : 'hw'}:${String(t.no || '').trim()}`));
  const { vehicles, diagnostics } = buildCensusRoster({ model, trains, nowEpoch, day, prior });

  const held = vehicles.filter(v => v.source === 'census-hold');
  totalHold += held.length;
  const nowHeld = new Set(held.map(v => v.vehicleId));
  for (const id of nowHeld) {
    const n = (holdStreak.get(id) || 0) + 1;
    holdStreak.set(id, n); if (n > maxStreak) maxStreak = n;
  }
  for (const id of [...holdStreak.keys()]) if (!nowHeld.has(id)) holdStreak.delete(id);
  // 被 hold 的那台，官方這一輪還列著嗎？（結構上必然為真——hold 只在官方列裡觸發——
  // 但這是「不會變成幽靈」的關鍵性質，要有量測不是只有推論）
  for (const v of held) {
    const [, , sys, no] = String(v.vehicleId).split(':');
    if (!officialNos.has(`${sys}:${no}`)) orphanHold++;
  }
  const why = {};
  for (const v of held) why[v.holdReason] = (why[v.holdReason] || 0) + 1;
  console.log(`[${new Date().toTimeString().slice(0, 8)}] 逐車 ${trains.length} → 名冊 ${vehicles.length}` +
    `（hold ${held.length}${held.length ? ' ' + JSON.stringify(why) : ''}）` +
    `｜最長連 hold ${maxStreak} 輪｜官方沒列卻被 hold ${orphanHold} 台次`);
  prior = vehicles;
}
console.log(`\n合計：${ROUNDS} 輪 hold ${totalHold} 台次（平均每輪 ${(totalHold / ROUNDS).toFixed(1)} 台）`);
console.log(`最長連續 hold ${maxStreak} 輪＝約 ${maxStreak * GAP} 秒`);
console.log(`官方沒列卻被 hold：${orphanHold} 台次　${orphanHold ? '❌ 這就是幽靈' : '✅ 沒有孤兒 hold'}`);

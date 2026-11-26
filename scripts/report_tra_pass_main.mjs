// 台鐵「通過不停的列車走正線」現況表：逐站、逐方向數通過列車的接點落在帶 service 標記股道（側線、渡線、站場）上的班次，
// 以及那一班在那一站有沒有接點在正線的可行走法。修復器 repair_tra_pass_main.mjs 改前改後各跑一次，表格與判準同一份。
//
// 名冊：預設讀磁碟上現行的班表（使用者今天看到的）；ROSTER=pinned 改用待避閘門釘的班表（SCHEDULE_REF 14 天＋9/13 考卷）。
// 用法：node scripts/report_tra_pass_main.mjs            （NETWORK=、DISPATCH= 可換輸入，OUT= 換輸出檔）
// 產物：output/pass-main/status-<名冊>.json 與同名 .md。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStationConflictModel } from './lib/tra_station_conflicts.mjs';
import { SCHEDULE_REF, loadOvertakeInputs, makeOvertakeJudge } from './lib/tra_overtake_pairs.mjs';
import { makePassMain } from './lib/tra_pass_main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinned = process.env.ROSTER === 'pinned', tag = process.env.TAG || (pinned ? 'pinned' : 'current');
const I = loadOvertakeInputs({ scheduleRef: pinned ? SCHEDULE_REF : null, withExam: pinned,
  network: process.env.NETWORK || 'rail-3d/physical/network.json', dispatch: process.env.DISPATCH || 'rail-3d/physical/dispatch.json' });
const S = createStationConflictModel({ net: I.net, dispatch: I.dispatch, sched: I.sched, timed: I.timed, protectedPlanKeys: new Set(Object.keys(I.protectedPlans)),
  report: { materialised: 0 }, stats: {}, roster: 'f2b', base: I.base, extraDays: I.extraDays });
const J = makeOvertakeJudge(S), P = makePassMain(S, J);
const rows = P.table();
const tot = { groups: rows.length, sideGroups: 0, sideGroupsWithMain: 0, passRuns: 0, sideRuns: 0, sideRunsWithMain: 0, keys: 0, sideKeys: 0, sideKeysWithMain: 0 };
for (const r of rows) {
  tot.passRuns += r.passRuns; tot.sideRuns += r.sideRuns; tot.sideRunsWithMain += r.sideRunsWithMain; tot.keys += r.keys; tot.sideKeys += r.sideKeys; tot.sideKeysWithMain += r.sideKeysWithMain;
  if (r.sideRuns) tot.sideGroups++; if (r.sideRunsWithMain) tot.sideGroupsWithMain++;
}
const out = path.resolve(ROOT, process.env.OUT || `output/pass-main/status-${tag}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ roster: pinned ? 'pinned:' + SCHEDULE_REF : 'current', days: [...S.cells.keys()], rosterStats: S.rosterStats, total: tot, rows }, null, 1));
const md = ['| 站 | 方向 | 通過班次（車次鍵／天次） | 走側線（車次鍵／天次） | 其中有正線走法（車次鍵／天次） |', '|---|---|---|---|---|',
  ...rows.filter(r => r.sideRuns).sort((a, b) => b.sideRuns - a.sideRuns).map(r => `| ${r.station} | ${r.dir} | ${r.keys}／${r.passRuns} | ${r.sideKeys}／${r.sideRuns} | ${r.sideKeysWithMain}／${r.sideRunsWithMain} |`)];
fs.writeFileSync(out.replace(/\.json$/, '.md'), md.join('\n') + '\n');
console.log(`名冊 ${pinned ? '釘版' : '現行'}：${S.cells.size} 天、${S.rosterStats.keys} 個車次鍵（綁不到 ${S.rosterStats.unbound}、跨日對不上 ${S.rosterStats.misaligned.length}）`);
console.log(`站×方向 ${tot.groups} 組；有通過列車走側線的 ${tot.sideGroups} 組，其中有正線走法的 ${tot.sideGroupsWithMain} 組`);
console.log(`通過站次（天次）${tot.passRuns}；走側線 ${tot.sideRuns}，其中有正線走法 ${tot.sideRunsWithMain}`);
console.log(`通過站次（車次鍵）${tot.keys}；走側線 ${tot.sideKeys}，其中有正線走法 ${tot.sideKeysWithMain}`);
console.log('寫入', out);

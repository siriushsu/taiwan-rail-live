#!/usr/bin/env node
// 「官方名冊被前端擋掉(malformed)」的回歸測試。
// 真實事故:2026-08-18 08:48 那輪 230 台裡有一台 Y#ov:2026-08-18:0000g1 行駛中卻 run=0,
// 而驗證器 ROSTER_FRONTEND_GEOMETRY 是全有全無 ⇒ 整包名冊被丟掉、全網停在舊快照。
// 實測 260 輪中 23 輪(8.8%)如此。
// 判準不寫死「幾條線受影響」——那是會漂移的量;改成問身分與結構:
//   1. 修補後,每一條看板線的「行駛中 run=0」都要能被救回(對照組:修補前有線救不回)
//   2. 救不回時驗證器仍要擋(三發突變:沒有 timeline / 時距=0 / timeline 對不到這一跳)
// 用法: node scripts/verify_roster_repair_run.mjs [url] [--payload <實際被擋的 payload.json>]
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.argv.find(a => a.startsWith('http')) || 'https://railisland.tw/';
const pi = process.argv.indexOf('--payload');
const PAYLOAD = pi > 0 ? process.argv[pi + 1] : null;

const CUR = fs.readFileSync('index.html', 'utf8');
// 對照組=只把本次改動還原,其餘完全相同(一次只動一個變因)
const PATCHED_BLOCK = CUR.match(/  const run = Number\(seg && seg\.run\);\n  if \(run > 0\)[\s\S]*?\n  return vehicle;\n\}/);
if (!PATCHED_BLOCK) { console.log('❌ 找不到修補後的 trtcOfficialRosterRepairRun,腳本與程式碼已脫節'); process.exit(2); }
const PRE = CUR.replace(PATCHED_BLOCK[0],
  '  const run = Number(seg && seg.run);\n  return run > 0 ? { ...vehicle, run } : vehicle;\n}');
if (PRE === CUR) { console.log('❌ 對照組還原失敗'); process.exit(2); }

async function probe(html, label) {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(URL).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
  const real = PAYLOAD ? JSON.parse(fs.readFileSync(PAYLOAD, 'utf8')) : null;
  const out = await p.evaluate(({ real }) => {
    const valid = vs => trtcOfficialRosterPayloadValid(
      { feedMode: 'official', sourceRevision: 1, vehicles: vs.map(trtcOfficialRosterRepairRun) });
    const lines = [...TRTC_BOARD_LINES].map(id => {
      const g = trtcOfficialRosterGeometryLine(id);
      const n = g && g.stations && g.stations.length;
      if (!(n > 2)) return null;
      const segRun = Number(g.segs && g.segs[0] && g.segs[0].run) || 0;
      const base = { vehicleId: `t:${id}`, line: id, dir: 2, dest: n - 1, from: 0, to: 1, run: 0,
        arrEpoch: 1787014163, timeline: [{ from: 0, to: 1, depEpoch: 1787013995, arrEpoch: 1787014163 }] };
      return { id, n, segRun,
        ok: valid([base]),
        mut_noTimeline: valid([{ ...base, timeline: [] }]),
        mut_zeroSpan: valid([{ ...base, timeline: [{ from: 0, to: 1, depEpoch: 1787014163, arrEpoch: 1787014163 }] }]),
        mut_wrongHop: valid([{ ...base, timeline: [{ from: 5, to: 6, depEpoch: 1787013995, arrEpoch: 1787014163 }] }]) };
    }).filter(Boolean);
    let realOk = null;
    if (real && Array.isArray(real.vehicles)) realOk = valid(real.vehicles);
    return { lines, realOk };
  }, { real: real && (real.vehicles ? real : { vehicles: real.raw || [] }) });
  await b.close();
  return { ...out, errs, label };
}

const A = await probe(PRE, '修補前');
const B = await probe(CUR, '修補後');
if (A.errs.length || B.errs.length) console.log('  ⚠️ pageerror:', [...A.errs, ...B.errs].slice(0, 3).join(' | '));

const noSeg = A.lines.filter(l => !(l.segRun > 0));
const preFail = A.lines.filter(l => !l.ok).map(l => l.id);
const postFail = B.lines.filter(l => !l.ok).map(l => l.id);
console.log(`線形沒帶站間行駛秒的線：${noSeg.length ? noSeg.map(l => l.id).join('、') : '無'}（共 ${A.lines.length} 條看板線）`);
console.log(`修補前救不回而整包被擋：${preFail.length ? preFail.join('、') : '無'}`);
console.log(`修補後救不回而整包被擋：${postFail.length ? postFail.join('、') : '無'}`);

let fail = 0;
// 1. 對照組必須真的有紅(否則這支測試沒有牙)
if (!preFail.length) { console.log('❌ 對照組(修補前)全綠 ⇒ 這支測試對本次改動沒有鑑別力,判準本身有問題'); fail++; }
else console.log(`✅ 對照組有牙：修補前 ${preFail.length} 條線的行駛中 run=0 救不回`);
// 2. 修補後全數救回
if (postFail.length) { console.log(`❌ 修補後仍有線救不回：${postFail.join('、')}`); fail++; }
else console.log('✅ 修補後：每一條看板線的行駛中 run=0 都救得回來');
// 3. 突變:救不回的情況驗證器仍要擋
for (const k of ['mut_noTimeline', 'mut_zeroSpan', 'mut_wrongHop']) {
  const leaked = B.lines.filter(l => !(l.segRun > 0) && l[k]).map(l => l.id);
  if (leaked.length) { console.log(`❌ 突變 ${k}：本該被擋卻放行 ⇒ ${leaked.join('、')}`); fail++; }
  else console.log(`✅ 突變 ${k}：救不回時驗證器仍然擋下`);
}
if (!noSeg.length) console.log('ℹ️ 目前沒有任何線缺站間行駛秒 ⇒ 突變項無分母,上面三條突變不構成證據');
if (A.realOk !== null) {
  console.log(`實際被擋的那包 payload：修補前 valid=${A.realOk}　修補後 valid=${B.realOk}`);
  if (A.realOk !== false || B.realOk !== true) { console.log('❌ 真實 payload 的前後對照不成立'); fail++; }
  else console.log('✅ 真實 payload：修補前被擋、修補後放行');
}
console.log(fail ? `\n❌ ${fail} 項未過` : '\n✅ 全部通過');
process.exit(fail ? 1 : 0);

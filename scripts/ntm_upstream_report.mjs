// 查「新北捷運官網實際被打了幾次、間隔多長」——讀 worker.js 的 ntmLiveFetch 每打一次官網寫的那筆帳
// (Analytics Engine dataset railisland_ntm_upstream:blob1=系統、blob2=誰打的、blob3=結果、
// double1=開始查詢的毫秒時間、double2=耗時)。
//
// 為什麼需要這支:查詢頻率的上限是全站的(淡海、安坑約每 55 秒一次、環狀線約每 60 秒一次),
// 而全站的次數只有這份帳數得到——各 colo 的 log、DO 的 /ntm-status 都只看得到自己那一份。
// 判定以「全站相鄰兩次開始查詢的間隔」為準,集中出口(do:<colo>)與 per-colo 退路(direct:<原因>)
// 一起排序:退路打的那幾次一樣算在官網頭上。DO 在查詢途中被重置時那一發可能來不及記,所以這份帳是下限;
// 對外回報次數時另外對照 Cloudflare GraphQL 的 workersSubrequestsAdaptiveGroups:以 hostname=trainstatus.ntmetro.com.tw
// 過濾、按 scriptName 分(應只有 poller,主站 0)。那份是取樣的,偶爾一列帶權重,比逐筆時間點、不比總數。不要拿
// durableObjectsPeriodicGroups 的 subrequests 比:它把 DO 量落點用的 cloudflare.com trace 也算進去,會比帳多出一截。
//
// 用法:node scripts/ntm_upstream_report.mjs [--minutes=30] [--since=<ISO 時間>] [--sql]
//       node scripts/ntm_upstream_report.mjs --self-test   (離線自驗判定邏輯,不碰 Cloudflare)
// 有任何一個間隔低於下限、或某個系統一筆都沒有(無從判定)就以 1 退出。憑證同 usage_split.mjs(scripts/lib/cf_analytics.mjs)。
//
// 間隔容許 0.1 秒:double1 取在 ntmLiveFetch 開頭,集中出口那邊的間隔把關用的是寫進 storage 之前的時間,
// 兩者差幾毫秒(寫入 storage 的時間每次不同),所以量到 54.99x 秒仍是同一個間隔。容許只收這幾毫秒的差,
// 54.9 秒以下一律判不合格。最短間隔一律照實印出。
import fs from 'node:fs';
import { requireTokens, makeClient, n, pad, padL } from './lib/cf_analytics.mjs';

const DATASET = 'railisland_ntm_upstream';
const GAP_MS = { danhai: 55e3, ankeng: 55e3, circular: 60e3 }; // 與 worker.js 的 NTM_LIVE_MIN_GAP_MS 相同(--self-test 會比對)
const TOLERANCE_MS = 100;

// 純函式:rows=[{ sys, via, outcome, started, si }] → 每個系統的統計與違規。
export function analyze(rows, sinceMs = -Infinity) {
  const out = {};
  for (const sys of Object.keys(GAP_MS)) {
    const mine = rows.filter(r => r.sys === sys);
    // 開始時間讀不出數字的列不能默默濾掉(濾掉就看不到它是不是違規的那一發):另外計數,有就不准通過。
    const unreadable = mine.filter(r => !Number.isFinite(r.started)).length;
    const list = mine.filter(r => Number.isFinite(r.started) && r.started >= sinceMs).sort((a, b) => a.started - b.started);
    const via = {}, outcome = {};
    let sampled = 0;
    for (const r of list) {
      via[r.via] = (via[r.via] || 0) + 1;
      outcome[r.outcome] = (outcome[r.outcome] || 0) + 1;
      if (r.si !== 1) sampled++;
    }
    const gaps = [];
    for (let i = 1; i < list.length; i++) gaps.push(list[i].started - list[i - 1].started);
    const tooShort = gaps.filter(g => g < GAP_MS[sys] - TOLERANCE_MS);
    // 多打的次數:這段時間照下限最多容得下幾次,超過的就是多打的(多打一次會造成兩個過短的間隔,所以另外算)。
    const allowed = list.length ? Math.floor((list[list.length - 1].started - list[0].started) / (GAP_MS[sys] - TOLERANCE_MS)) + 1 : 0;
    out[sys] = {
      count: list.length, via, outcome, sampled, unreadable,
      first: list.length ? list[0].started : null, last: list.length ? list[list.length - 1].started : null,
      minGap: gaps.length ? Math.min(...gaps) : null, maxGap: gaps.length ? Math.max(...gaps) : null,
      tooShort: tooShort.length, excess: Math.max(0, list.length - allowed),
      // 取樣過的帳(_sample_interval≠1)少了列,間隔量不準,不准當成通過;少於兩筆量不到任何間隔＝無從判定,也不算通過。
      pass: list.length >= 2 && tooShort.length === 0 && sampled === 0 && unreadable === 0,
    };
  }
  return out;
}

function selfTest() {
  const fails = [];
  const mk = (sys, startS, via = 'do:NRT', outcome = 'ok', si = 1) => ({ sys, via, outcome, started: startS * 1e3, si });
  // 正常:每 55.01 秒一次(淡海)、每 60 秒一次(環狀線,含失敗與逾時)、安坑剛好 54.995 秒(容許內)
  const good = [0, 55.01, 110.02, 165.03].map(s => mk('danhai', s))
    .concat([0, 60, 120].map((s, i) => mk('circular', s, 'do:NRT', ['ok', 'fail', 'timeout'][i])))
    .concat([mk('ankeng', 0), mk('ankeng', 54.995)]);
  const g = analyze(good);
  if (!(g.danhai.pass && g.circular.pass && g.ankeng.pass)) fails.push('正常間隔被判成不合格');
  if (g.circular.outcome.fail !== 1 || g.circular.outcome.timeout !== 1) fails.push('失敗與逾時沒有各算一次');
  // 反向對照:同一間隔裡退路又打一次(3 秒後)→ 必須不合格
  const dup = analyze(good.concat([mk('danhai', 58.01, 'direct:error')]));
  if (dup.danhai.pass || dup.danhai.tooShort !== 2 || dup.danhai.excess !== 1) fails.push(`間隔內多打一次沒被抓到(過短間隔 ${dup.danhai.tooShort}、多打 ${dup.danhai.excess})`);
  if (dup.danhai.via['direct:error'] !== 1) fails.push('退路那一次沒有分開計數');
  // 反向對照:被取樣的帳不准判通過
  const sampled = analyze([mk('danhai', 0, 'do:NRT', 'ok', 2), mk('danhai', 60)]);
  if (sampled.danhai.pass) fails.push('取樣過的帳被判成通過');
  // 反向對照:--since 之前的列不算
  const since = analyze([mk('danhai', 0), mk('danhai', 10), mk('danhai', 70)], 5e3);
  if (since.danhai.count !== 2 || !since.danhai.pass) fails.push('--since 之前的列沒有排除');
  // 反向對照:一筆都沒有不准判通過(資料集名稱打錯時 AE 也是回空陣列、不報錯)
  if (analyze([]).danhai.pass) fails.push('沒有資料被判成通過');
  // 反向對照:只有一筆量不到間隔,不准判通過
  if (analyze([mk('danhai', 0)]).danhai.pass) fails.push('只有一筆被判成通過');
  // 反向對照:開始時間讀不出數字的列不准被默默濾掉
  const junk = analyze(good.concat([{ sys: 'danhai', via: 'direct:error', outcome: 'ok', started: NaN, si: 1 }]));
  if (junk.danhai.pass || junk.danhai.unreadable !== 1) fails.push('開始時間讀不出數字的列被默默濾掉');
  // 反向對照:比下限短 0.15 秒(超過容許)要判不合格
  if (analyze([mk('ankeng', 0), mk('ankeng', 54.85)]).ankeng.pass) fails.push('54.85 秒的間隔被判成通過(容許太寬)');
  // 下限要與 worker.js 的 NTM_LIVE_MIN_GAP_MS 相同:改了那邊沒改這裡,這份報表就用錯的下限在判。
  const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  // 只認行首那一行(註解掉的舊版不算),而且要恰好一行;每一項都要讀得出來,讀不出的項目不准默默略過。
  const lines = [...src.matchAll(/^const NTM_LIVE_MIN_GAP_MS = new Map\(\[(.*)\]\);$/gm)];
  if (lines.length !== 1) fails.push(`worker.js 的 NTM_LIVE_MIN_GAP_MS 要恰好一行,實際 ${lines.length} 行`);
  const line = lines.length ? lines[0][1] : '';
  const entryRe = /\[\s*(['"])(.*?)\1\s*,\s*([^\]]+?)\s*\]/g;
  const inWorker = Object.fromEntries([...line.matchAll(entryRe)].map(m => [m[2], Number(m[3])]));
  if (line.replace(entryRe, '').replace(/[\s,]/g, '') !== '') fails.push(`worker.js 的 NTM_LIVE_MIN_GAP_MS 有讀不出的項目:${line}`);
  // 逐項比:Map 裡的順序不同不算不同;多一項、少一項或值不同都算。
  const gapKeys = Object.keys(GAP_MS);
  if (Object.keys(inWorker).length !== gapKeys.length || !gapKeys.every(k => Object.hasOwn(inWorker, k) && inWorker[k] === GAP_MS[k])) fails.push(`GAP_MS ${JSON.stringify(GAP_MS)} 與 worker.js 的 NTM_LIVE_MIN_GAP_MS ${JSON.stringify(inWorker)} 不同`);
  if (fails.length) { console.error('自驗失敗:\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS ntm_upstream_report 自驗:正常間隔判通過、失敗與逾時各算一次、間隔內多打一次判不合格且算出多打 1 次、取樣過的帳、沒有資料、只有一筆、時間讀不出數字、短於下限 0.15 秒都不准通過、--since 之前不算、下限與 worker.js 相同');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) { selfTest(); process.exit(0); }

const minutes = Math.max(1, Math.min(60 * 24 * 7, parseInt((args.find(a => a.startsWith('--minutes=')) || '').split('=')[1], 10) || 30));
const sinceArg = (args.find(a => a.startsWith('--since=')) || '').slice('--since='.length);
const sinceMs = sinceArg ? Date.parse(sinceArg) : -Infinity;
if (sinceArg && !Number.isFinite(sinceMs)) { console.error('--since 看不懂:' + sinceArg); process.exit(2); }

// 筆數上限寫明:回滿這個數＝被截掉(依開始時間排序,截掉的是最新那段),整份不准判通過,改縮短時間範圍重查。
const ROW_LIMIT = 10000;
const SQL = `SELECT blob1 AS sys, blob2 AS via, blob3 AS outcome, double1 AS started, double2 AS dur, _sample_interval AS si
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${minutes}' MINUTE
ORDER BY started
LIMIT ${ROW_LIMIT}`;
if (args.includes('--sql')) console.log(SQL + '\n');

const { aeSql } = makeClient(requireTokens());
const rows = (await aeSql(SQL)).map(r => ({ ...r, started: Number(r.started), dur: Number(r.dur), si: Number(r.si) }));
const truncated = rows.length >= ROW_LIMIT;
const res = analyze(rows, sinceMs);
const fmtT = ms => ms == null ? '—' : new Date(ms).toISOString().slice(11, 19) + 'Z';
const fmtS = ms => ms == null ? '—' : (ms / 1e3).toFixed(3) + ' 秒';

console.log(`\n新北捷運官網實際查詢(${DATASET},過去 ${minutes} 分鐘${sinceArg ? `,${sinceArg} 之後` : ''})\n`);
let bad = 0;
for (const [sys, r] of Object.entries(res)) {
  if (!r.pass) bad++;
  console.log(`${pad(sys, 10)} ${truncated ? '被截斷' : r.pass ? 'PASS' : r.count >= 2 || r.unreadable ? 'FAIL' : '無從判定'}  下限 ${GAP_MS[sys] / 1e3} 秒  共 ${n(r.count)} 次  ${fmtT(r.first)}–${fmtT(r.last)}`);
  console.log(`  最短間隔 ${fmtS(r.minGap)}、最長 ${fmtS(r.maxGap)}、低於下限的間隔 ${r.tooShort} 個、多打 ${r.excess} 次${r.sampled ? `、⚠ ${r.sampled} 列被取樣(間隔量不準)` : ''}${r.unreadable ? `、⚠ ${r.unreadable} 列開始時間讀不出數字` : ''}`);
  if (r.count < 2) console.log(`  只有 ${r.count} 筆,量不到間隔:可能這段時間沒有人要這個系統的資料(環狀線平常只有連線狀態頁會要),也可能帳沒記到——分不出來,所以不算通過。`);
  console.log(`  誰打的:${Object.entries(r.via).map(([k, v]) => `${k} ${v}`).join('、') || '—'}`);
  console.log(`  結果:${Object.entries(r.outcome).map(([k, v]) => `${k} ${v}`).join('、') || '—'}`);
}
if (!rows.length) console.log('沒有任何一筆(資料集名稱打錯時 AE 也是回空)。剛部署的話等一兩分鐘再查:AE 寫入有延遲,也不回溯部署前。');
if (truncated) { bad++; console.log(`⚠ 回了 ${ROW_LIMIT} 筆＝被截掉了(最新那段不在裡面),這份不算數:縮短 --minutes 重查。`); }
console.log('\n註:這份帳是下限——DO 在查詢途中被重置時,那一發可能來不及記。對外回報次數前,另外對照 Cloudflare GraphQL workersSubrequestsAdaptiveGroups(hostname=trainstatus.ntmetro.com.tw,按 scriptName 分);DO 的 subrequests 含量落點的 trace,不能拿來比。');
process.exit(bad ? 1 : 0);

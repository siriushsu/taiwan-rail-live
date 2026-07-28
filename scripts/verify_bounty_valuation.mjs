// 懸賞估值驗收。判準刻意不與實作同源（心得 29）：L1／L2 的期望值由測試自己手算寫死，
// 不呼叫實作的估值函式去產生期望值。
// 跑法：node scripts/verify_bounty_valuation.mjs
import { readFileSync, existsSync } from 'node:fs';
import { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

const { bountyMedian, bountyL1, bountyL2, bountyPointsOf, bountyUnlocked, bountyValuationCron } = _bounty;
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const DAY = 86400000;

// ── D 組：純函式 ─────────────────────────────────────────────────────────
ok('D1 中位數（偶數筆取中間兩筆平均）', bountyMedian([1, 2, 3, 4]) === 2.5 && bountyMedian([5, 1, 3]) === 3);
// 全網中位 60 班/日、南迴自強 4 班/日 → 60/4=15 → clamp 到上限 3
ok('D2 L1 稀疏路線頂到 3', bountyL1(4, 60) === 3, String(bountyL1(4, 60)));
// 西部幹線 60 班/日 = 中位數 → 1
ok('D3 L1 中位數路線＝1', bountyL1(60, 60) === 1, String(bountyL1(60, 60)));
// 比中位還密 → 仍是 1（下限）
ok('D4 L1 有下限 1', bountyL1(120, 60) === 1, String(bountyL1(120, 60)));
// 30 班 → 60/30 = 2
ok('D5 L1 中間值不被 clamp', bountyL1(30, 60) === 2, String(bountyL1(30, 60)));
ok('D6 L1 沒有班次資料視同最難（3）', bountyL1(0, 60) === 3 && bountyL1(null, 60) === 3);

// L2 = min(1.2^floor(天數/7), 5)。手算：第 0–6 天 → 1.2^0=1；第 7 天 → 1.2；第 56 天 → 1.2^8=4.29981696；
// 第 63 天 → 1.2^9=5.159780352 → 封頂 5
{
  const t0 = 1700000000000;
  ok('D7 L2 第 0 天＝1', bountyL2(t0, t0) === 1, String(bountyL2(t0, t0)));
  ok('D8 L2 第 6 天仍＝1', bountyL2(t0 + 6 * DAY, t0) === 1, String(bountyL2(t0 + 6 * DAY, t0)));
  ok('D9 L2 第 7 天＝1.2', Math.abs(bountyL2(t0 + 7 * DAY, t0) - 1.2) < 1e-9, String(bountyL2(t0 + 7 * DAY, t0)));
  ok('D10 L2 第 56 天＝1.2^8', Math.abs(bountyL2(t0 + 56 * DAY, t0) - 4.29981696) < 1e-6, String(bountyL2(t0 + 56 * DAY, t0)));
  ok('D11 L2 第 63 天封頂 5', bountyL2(t0 + 63 * DAY, t0) === 5, String(bountyL2(t0 + 63 * DAY, t0)));
  // 🔴 這一條是規格 §4 的鐵則：沒人能接的期間 L2 不准漲
  ok('D12 first_claimable_at 為 NULL 時 L2 恆為 1（不准用假訊號漲價）',
    bountyL2(t0 + 999 * DAY, null) === 1 && bountyL2(t0 + 999 * DAY, 0) === 1);
}

// 點數 = round(1 × L1 × L2)，最低 1
ok('D13 點數 3×1＝3', bountyPointsOf(3, 1) === 3);
ok('D14 點數 3×1.2＝3.6→4', bountyPointsOf(3, 1.2) === 4, String(bountyPointsOf(3, 1.2)));
ok('D15 點數有下限 1', bountyPointsOf(1, 0.1) === 1, String(bountyPointsOf(1, 0.1)));

// 自動開關：三個條件同時成立才置 1
{
  const t = 1700000000000, base = { l2: 5, sample_count: 0, l2_capped_at: t };
  ok('D16 到頂滿 30 天且零覆蓋 → 開', bountyUnlocked(base, t + 30 * DAY) === 1);
  ok('D17 到頂但只過 29 天 → 不開', bountyUnlocked(base, t + 29 * DAY) === 0);
  ok('D18 有樣本就不開', bountyUnlocked({ ...base, sample_count: 1 }, t + 60 * DAY) === 0);
  ok('D19 l2 沒到頂就不開', bountyUnlocked({ ...base, l2: 4.3 }, t + 60 * DAY) === 0);
  ok('D20 沒有 l2_capped_at 就不開', bountyUnlocked({ ...base, l2_capped_at: null }, t + 60 * DAY) === 0);
}

// ── E 組：清單檔與 cron ───────────────────────────────────────────────────
ok('E1 data/bounty_units.json 存在', existsSync('data/bounty_units.json'));
let M = null;
if (existsSync('data/bounty_units.json')) {
  M = JSON.parse(readFileSync('data/bounty_units.json', 'utf8'));
  ok('E2 有 units 與 lines', Array.isArray(M.units) && M.units.length > 100 && M.lines && Object.keys(M.lines).length > 3,
    `units=${M.units && M.units.length} lines=${M.lines && Object.keys(M.lines).length}`);
  ok('E3 每個 unit 五個鍵欄位齊全',
    M.units.every(u => u.segKey && u.sys && u.trainKind && (u.dir === 0 || u.dir === 1) &&
      (u.kind === 'track' || u.kind === 'dwell') && typeof u.perDay === 'number'),
    JSON.stringify(M.units[0]));
  ok('E4 track 的兩端站相異、dwell 的兩端站相同（全計畫共用的鍵約定）',
    M.units.every(u => { const p = u.segKey.split('|'); return u.kind === 'dwell' ? p[2] === p[3] : p[2] !== p[3]; }));
  ok('E5 lines 帶站里程（驗證閘要靠它把里程換回站）',
    Object.values(M.lines).every(l => Array.isArray(l.stations) && l.stations.every(s => s.name && typeof s.d === 'number')));
  ok('E6 segKey 的前兩段對得上 lines 的鍵',
    M.units.every(u => { const p = u.segKey.split('|'); return !!M.lines[p[0] + '|' + p[1]]; }));
}

// E7–E10 cron：第一次跑會建列，第二次跑不重複建、只更新
{
  const manifest = { generatedAt: 1, schedDate: '2026-07-28', lines: { 'tra_sched|南迴線': { sys: 'tra_sched', lnId: '南迴線', name: '南迴線', stations: [] } },
    units: [
      { segKey: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 4 },
      { segKey: 'tra_sched|南迴線|大武|枋寮', sys: 'tra_sched', trainKind: '自強', dir: 0, kind: 'track', slot: '', perDay: 60 },
    ] };
  const ASSETS = { fetch: async r => new Response(String(r.url).includes('bounty_units')
    ? JSON.stringify(manifest) : readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
  const { db, DELAY_DB } = openTestDb();

  const r1 = await bountyValuationCron({ DELAY_DB, ASSETS });
  const rows = db.prepare('SELECT * FROM bounty_board ORDER BY seg_key').all();
  ok('E7 第一次跑建了兩列', r1.inserted === 2 && rows.length === 2, JSON.stringify(r1));
  // 中位數 = (4+60)/2 = 32；南迴 32/4 = 8 → clamp 3；西部 32/60 = 0.53 → clamp 1
  const nh = rows.find(x => x.seg_key === 'tra_sched|南迴線|大武|太麻里');
  const wl = rows.find(x => x.seg_key === 'tra_sched|南迴線|大武|枋寮');
  ok('E8 L1 用清單自己的中位數算（手算：中位 32 → 3 與 1）', nh.l1 === 3 && wl.l1 === 1, `${nh.l1} / ${wl.l1}`);
  ok('E9 未設 BOUNTY_CLAIMABLE_FROM → first_claimable_at 為 NULL 且 L2＝1',
    nh.first_claimable_at === null && nh.l2 === 1, JSON.stringify({ f: nh.first_claimable_at, l2: nh.l2 }));

  const r2 = await bountyValuationCron({ DELAY_DB, ASSETS });
  const n2 = db.prepare('SELECT COUNT(*) c FROM bounty_board').get().c;
  ok('E10 第二次跑不重複建列（冪等）', n2 === 2 && r2.inserted === 0, `rows=${n2} ${JSON.stringify(r2)}`);

  // E11 設了 secret 之後才開始計時
  const r3 = await bountyValuationCron({ DELAY_DB, ASSETS, BOUNTY_CLAIMABLE_FROM: String(Date.now() - 63 * DAY) });
  const nh3 = db.prepare("SELECT * FROM bounty_board WHERE seg_key='tra_sched|南迴線|大武|太麻里'").get();
  ok('E11 設了起算點後 L2 封頂 5、points＝round(3×5)＝15 且記下 l2_capped_at',
    nh3.l2 === 5 && nh3.points === 15 && nh3.l2_capped_at > 0, JSON.stringify({ l2: nh3.l2, p: nh3.points, c: nh3.l2_capped_at }));
  ok('E12 剛到頂還沒滿 30 天 → 自動開關不開', nh3.unlocked_offer === 0, String(nh3.unlocked_offer));
}

// ── F 組：seg_key 鍵空間硬 gate（controller 任務指令額外要求，brief 沒有給）───────────
// 判準與 build_bounty_units.mjs 完全獨立重寫（不 import 它、不 import worker.js 的任何 canonicalSegs
// 邏輯），真值來源＝index.html 的 lineNetwork()/segKey()（index.html:9099,9166——已用
// `diff` 逐行核對過與這裡的邏輯等價，見 task-5-report.md 前置檢查）。同源判準會一起失明（心得29），
// 這裡刻意換一條獨立算路：直接從三個 track json 重新掃一次站表與相鄰站對。
//
// 🔴 track 與 dwell 是兩種不同形狀的鍵，真值來源也不同（schema/0002_bounty.sql 的註解 + 上面
// E4 本身就是證據）：track 的 A≠B，真值＝「正規區間」集合（相鄰站對，去同名與<0.05km）；
// dwell 的 A==B，真值＝「這是一座真實存在的站」，不是任何一個正規區間鍵——兩者結構上互斥，
// 不可能有任何 dwell 鍵是 275 個區間鍵之一。這是一開始的誤判：若把「每個 seg_key 都必須落在
// 275 個區間鍵集合」逐字當成唯一判準，兩千多個 dwell 單位會全數判 miss（見下方「RED/GREEN 實測
// 佐證」）——但那些鍵其實完全正確，只是驗法問錯了真值來源。
if (M) {
  const SOURCES = [
    { track: 'data/tra.json', sys: 'tra_sched' },
    { track: 'data/thsr_track.json', sys: 'thsr_sched' },
    { track: 'data/afr.json', sys: 'afr_sched' },
  ];
  const realSegKeys = new Set();          // track 的真值："sys|lnId|A|B"（A<B 字典序），275 個
  const realStations = {};                // dwell 的真值："sys|lnId" → Set(站名)
  const bySys = {};
  for (const src of SOURCES) {
    const t = JSON.parse(readFileSync(src.track, 'utf8'));
    for (const ln of (t.lines || [])) {
      const sts = (ln.stations || []).filter(s => s.d != null && s.name).slice().sort((a, b) => a.d - b.d);
      const lk = `${src.sys}|${ln.id}`;
      realStations[lk] = new Set(sts.map(s => s.name));
      for (let i = 1; i < sts.length; i++) {
        const a = sts[i - 1], b = sts[i];
        if (a.name === b.name || Math.abs(b.d - a.d) < 0.05) continue;
        const key = a.name < b.name ? `${src.sys}|${ln.id}|${a.name}|${b.name}` : `${src.sys}|${ln.id}|${b.name}|${a.name}`;
        realSegKeys.add(key);
        bySys[src.sys] = (bySys[src.sys] || 0) + 1;
      }
    }
  }
  ok('F1 獨立重算的真實區間鍵數與參考值一致（275：tra_sched 244／thsr_sched 11／afr_sched 20）',
    realSegKeys.size === 275 && bySys.tra_sched === 244 && bySys.thsr_sched === 11 && bySys.afr_sched === 20,
    JSON.stringify({ total: realSegKeys.size, ...bySys }));

  const missTrack = [], missDwell = [];
  let hitTrack = 0, hitDwell = 0;
  for (const u of M.units) {
    const p = u.segKey.split('|');
    if (u.kind === 'track') {
      if (p[2] !== p[3] && realSegKeys.has(u.segKey)) hitTrack++; else missTrack.push(u.segKey);
    } else {
      const lk = p[0] + '|' + p[1];
      if (p[2] === p[3] && realStations[lk] && realStations[lk].has(p[2])) hitDwell++; else missDwell.push(u.segKey);
    }
  }
  const nTrack = M.units.filter(u => u.kind === 'track').length;
  const nDwell = M.units.length - nTrack;
  ok('F2 所有 track 單位的 seg_key 都落在真實區間鍵集合內',
    hitTrack === nTrack, `命中 ${hitTrack}/${nTrack}，miss 前 5：${JSON.stringify(missTrack.slice(0, 5))}`);
  ok('F3 所有 dwell 單位的站名都是真實存在的站',
    hitDwell === nDwell, `命中 ${hitDwell}/${nDwell}，miss 前 5：${JSON.stringify(missDwell.slice(0, 5))}`);

  // ── 驗收條件 5：產出數量級人眼檢查（純資訊列印，不是斷言——由人眼判斷合不合理）──────────
  // 🔴 刻意不對真實 data/bounty_units.json 再跑一次 bountyValuationCron:worker.js 的
  // bountyUnits() 有模組級快取 bountyUnitsMem(比照既有 bountyRulesMem 的既定設計,見
  // task-2-report.md 風險 #4 已記錄的同一種跨測試污染)——上面 E7-E12 已經用兩筆 stub 資料
  // 呼叫過一次 bountyValuationCron,快取已鎖住那份 2 筆的 manifest;同一個 process 裡再呼叫
  // 一次、換一顆全新 D1、換 ASSETS 指到真實檔案,拿到的仍是快取住的 stub(不會真的重讀檔案)。
  // 這不是實作的 bug(生產環境本來就該全程重用同一份、不必每個請求重抓一次靜態資產),只是我
  // 這支測試腳本沒辦法在同一個 process 內把「stub 版 cron 正確性」與「全量真實資料的 cron」
  // 都跑到——已用 RED 實測過(見 task-5-report.md):照 brief 字面加一段對真實資料再跑一次
  // cron,inserted 回來是 2 不是 4166,就是被快取鎖死。改用「直接組合已驗過的純函式
  // (bountyMedian/bountyL1/bountyL2/bountyPointsOf,D 組已手算核對過)去跑同一份真實 M.units」
  // ——效果一樣是「真實資料跑過真實估值公式」,但不必經過會被快取污染的 bountyUnits()/D1 那層。
  const sysDist = {};
  for (const u of M.units) sysDist[u.sys] = (sysDist[u.sys] || 0) + 1;
  console.log(`\n[量級檢查] units 總數=${M.units.length}（track ${nTrack}／dwell ${nDwell}） sys 分佈=${JSON.stringify(sysDist)}`);

  // F4：PK 五元組(seg_key,train_kind,dir,kind,slot,對齊 schema 的 PRIMARY KEY)在整份清單裡
  // 不重複——這是「灌進 D1 不會互相覆蓋」真正在乎的不變量,直接在清單上驗,不必經過 D1。
  const pkSet = new Set(M.units.map(u => `${u.segKey}|${u.trainKind}|${u.dir}|${u.kind}|${u.slot || ''}`));
  ok('F4 每個 unit 的 PK 五元組在清單內唯一（無重複會互相覆蓋）',
    pkSet.size === M.units.length, `unique=${pkSet.size} total=${M.units.length}`);

  // points min/median/max：未設 BOUNTY_CLAIMABLE_FROM 時的「現況」(claimableFrom=0 → L2 恆 1，
  // 見 bountyL2/D12)——用已被 D 組驗過的同一批純函式，跑在真實的 4166 筆 perDay 分佈上。
  const med = bountyMedian(M.units.map(u => Number(u.perDay)));
  const now = Date.now();
  const pts = M.units.map(u => bountyPointsOf(bountyL1(u.perDay, med), bountyL2(now, 0))).sort((a, b) => a - b);
  const pMin = pts[0], pMax = pts[pts.length - 1], pMed = pts.length % 2
    ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
  console.log(`[量級檢查] points(未設 BOUNTY_CLAIMABLE_FROM，L2 恆 1) min=${pMin} median=${pMed} max=${pMax}（n=${pts.length}）`);
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);

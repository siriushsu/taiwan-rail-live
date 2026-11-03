// 懸賞設定檔的結構檢查（v3 點數制）：每個線鍵真的在題庫裡、場景 id 真的在車庫場景表裡、價格是正整數、
// 去重門檻不含捷運（捷運不列入懸賞）。跑法：node scripts/verify_bounty_rules.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const rules = JSON.parse(read('data/bounty_rules.json'));
const units = JSON.parse(read('data/bounty_units.json'));
// 可兌換的場景要是做好了的那幾座：train-garage-scenes.js 檔尾的 RailGarageSceneRules（每座跑哪個系統的車、地名）。
const sceneIds = new Set(Object.keys((() => { const window = {}; runInNewContext(read('train-garage-scenes.js'), { window }); return window.RailGarageSceneRules || {}; })()));
const c = rules.chips || {};

ok('R1 coverDistinct 台鐵 50、高鐵 15，沒有捷運鍵',
  rules.coverDistinct && rules.coverDistinct.TRA === 50 && rules.coverDistinct.THSR === 15 &&
  Object.keys(rules.coverDistinct).sort().join() === 'THSR,TRA', JSON.stringify(rules.coverDistinct));
ok('R2 舊客端讀的 coverN 仍在', rules.coverN && typeof rules.coverN.TRA === 'number');
for (const f of ['remoteLines', 'evergreen']) {
  const bad = (c[f] || []).filter(k => !units.lines[k]);
  ok(`R3 chips.${f} 每個鍵都在 bounty_units.lines`, Array.isArray(c[f]) && c[f].length > 0 && bad.length === 0,
    `${(c[f] || []).length} 個，缺：${bad.join(',') || '無'}`);
}
ok('R4 prices 是非空正整數陣列', Array.isArray(c.prices) && c.prices.length > 0 &&
  c.prices.every(p => Number.isInteger(p) && p > 0), JSON.stringify(c.prices));
{
  const bad = (c.scenes || []).filter(s => !sceneIds.has(s));
  ok('R5 chips.scenes 每個 id 都在 train-garage-scenes.js 的場景規則', Array.isArray(c.scenes) && c.scenes.length > 0 &&
    bad.length === 0 && new Set(c.scenes).size === c.scenes.length,
    `場景規則 ${sceneIds.size} 座；缺：${bad.join(',') || '無'}`);
}
{
  // chips.items 是車款兌換的上線開關（列了價格的那款才賣）：鍵要是車款表裡用點數兌換的那款，價格是正整數；
  // 寫成陣列、打錯 id、價格寫成字串或 0，伺服器與三端都會當成沒列（不賣），不會報錯，所以在這裡擋。
  const redeem = new Set([...read('train-garage.js').matchAll(/"metric":"redeem","item":"(train:[a-z0-9]+)"/g)].map(m => m[1]));
  const items = c.items === undefined ? {} : c.items;
  const bad = items && typeof items === 'object' && !Array.isArray(items)
    ? Object.entries(items).filter(([k, p]) => !redeem.has(k) || !Number.isInteger(p) || p <= 0).map(([k, p]) => `${k}=${JSON.stringify(p)}`)
    : ['不是物件：' + JSON.stringify(items)];
  ok('R5b chips.items 每個鍵都是車款表的兌換車款、價格是正整數', redeem.size > 0 && bad.length === 0,
    `車款表兌換車款 ${redeem.size} 款、列價 ${Object.keys(items || {}).length} 款；不對：${bad.join(',') || '無'}`);
}
// multiplier 必須是正整數：帳本 delta 是 INTEGER，倍率是整數時 tripPoints 全程整數運算（小數倍率要靠捨去前的 1e-9 才不少給）。
ok('R6 events 是陣列，每筆有 id/from/to、multiplier 是正整數', Array.isArray(c.events) &&
  c.events.every(e => e.id && /^\d{4}-\d\d-\d\d$/.test(e.from) && /^\d{4}-\d\d-\d\d$/.test(e.to) &&
    Number.isInteger(e.multiplier) && e.multiplier > 0));
// perTrip 0 是給舊客端讀的相容值（v3 不按趟給點；舊網頁讀到 0 就不畫「一趟得 N 顆」），所以只要求非負整數；
// cloud.perChip 也是相容值，App 1.7.3 的雲端搭乘要它是 ≥ 1 的整數。
ok('R7 整數欄位：點數相關的都是正整數、perTrip 是非負整數', ['perKm', 'minTripSec', 'remoteMultiplier', 'dailyChipCap', 'chipToPoints'].every(k => Number.isInteger(c[k]) && c[k] > 0) &&
  Number.isInteger(c.perTrip) && c.perTrip >= 0 &&
  ['minSec', 'dailyMax', 'perChip', 'points'].every(k => c.cloud && Number.isInteger(c.cloud[k]) && c.cloud[k] > 0),
  JSON.stringify({ perKm: c.perKm, perTrip: c.perTrip, chipToPoints: c.chipToPoints, cloud: c.cloud }));
// 整趟停在一站不給點數（tripPoints 比各線里程加總 ≥ minTripMoveM）：少了這個鍵比較式恆為假，所有錄程都是 0 點，所以釘住它是正的有限數。
ok('R7b chips.minTripMoveM 是正的有限數', typeof c.minTripMoveM === 'number' && Number.isFinite(c.minTripMoveM) && c.minTripMoveM > 0,
  JSON.stringify({ minTripMoveM: c.minTripMoveM }));
ok('R8 設定檔不含金額欄位（PUBLIC repo）', !/price(Twd|NTD)|NT\$|lifetime|訂閱/i.test(JSON.stringify(rules)));
// 都卜勒那一重（worker.js integrityGate 第四重）：相關係數＞dopplerCorrMax 而且逐點差中位數 ≤ dopplerResidMaxMps 才判。
// 設定檔一定要有 dopplerResidMaxMps：少了它比較式恆為假，所以在這裡釘住兩個鍵都在、而且是合理的數，缺鍵時閘門先紅。
{
  const I = rules.integrity || {};
  ok('R9 integrity.dopplerCorrMax 在 (0, 1)、dopplerResidMaxMps 是正的有限數（兩個鍵都要在）',
    typeof I.dopplerCorrMax === 'number' && I.dopplerCorrMax > 0 && I.dopplerCorrMax < 1 &&
      typeof I.dopplerResidMaxMps === 'number' && Number.isFinite(I.dopplerResidMaxMps) && I.dopplerResidMaxMps > 0,
    JSON.stringify({ dopplerCorrMax: I.dopplerCorrMax, dopplerResidMaxMps: I.dopplerResidMaxMps }));
}
// 停靠判定的位置微分否決（worker.js coverageOf 與 index.html bountyUpdateDwellProgress）：回報的速度再低，位置微分超過 posSpeedVetoMps 就不信它。
// 少了這個鍵兩邊都直接中止（Worker 丟 invalid bounty rule、前端丟 dwell rules unavailable）；比 stopSpeedMaxMps 小的話否決會蓋掉真的停靠。
{
  const D = (rules.quality || {}).dwell || {};
  ok('R10 quality.dwell.posSpeedVetoMps 是有限數、而且大於 stopSpeedMaxMps（Android 沒有速度送 0 時靠它擋掉假停靠）',
    typeof D.posSpeedVetoMps === 'number' && Number.isFinite(D.posSpeedVetoMps) && D.posSpeedVetoMps > D.stopSpeedMaxMps,
    JSON.stringify({ posSpeedVetoMps: D.posSpeedVetoMps, stopSpeedMaxMps: D.stopSpeedMaxMps }));
  // 位置微分跟「至少 posSpeedWindowSec 秒以前的那一點」比：少了、不是數字、或不在 1–10 秒，兩邊一樣直接中止。
  ok('R12 quality.dwell.posSpeedWindowSec 是 1–10 的數字（停靠判定的位置微分跟幾秒前的點比）',
    typeof D.posSpeedWindowSec === 'number' && Number.isFinite(D.posSpeedWindowSec) && D.posSpeedWindowSec >= 1 && D.posSpeedWindowSec <= 10,
    JSON.stringify({ posSpeedWindowSec: D.posSpeedWindowSec }));
}
// 站表同源：Worker 判停靠用 bounty_units.json 的 lines，前端錄製當下用軌道檔（lineNetwork()）——
// 兩邊的站里程只要差過站窗，同一趟車就一邊算停靠、一邊不算（09-14 改過 tra.json、units 沒重產，汐科差了 326 m）。
// 期望值直接讀前端載入的那三份軌道檔（index.html SYS_DEFS 的 track），照 build_bounty_units.mjs 的篩法（有站名、有里程）排好比對。
{
  const SRC = [['data/tra.json', 'tra_sched'], ['data/thsr_track.json', 'thsr_sched'], ['data/afr.json', 'afr_sched']];
  const bad = [];
  let nLines = 0, nSts = 0;
  for (const [file, sys] of SRC) {
    const t = JSON.parse(read(file));
    const want = new Map((t.lines || []).map(ln => [`${sys}|${ln.id}`,
      (ln.stations || []).filter(s => s.d != null && s.name).map(s => ({ name: s.name, d: s.d })).sort((a, b) => a.d - b.d)]));
    for (const [lk, sts] of want) {
      nLines++; nSts += sts.length;
      const got = units.lines[lk];
      if (!got) { bad.push(`${lk} 不在 units`); continue; }
      if (JSON.stringify(got.stations) === JSON.stringify(sts)) continue;
      const gm = new Map((got.stations || []).map(s => [s.name, s.d]));
      const diff = sts.filter(s => gm.get(s.name) !== s.d).slice(0, 3).map(s => `${s.name} 軌道 ${s.d}／units ${gm.get(s.name)}`);
      bad.push(`${lk}：${diff.join('、') || '站序或站數不同'}`);
    }
    for (const lk of Object.keys(units.lines)) if (lk.startsWith(sys + '|') && !want.has(lk)) bad.push(`${lk} 只在 units`);
  }
  ok('R11 bounty_units.json 的站表與前端的軌道檔逐站相同（站名、里程；台鐵、高鐵、林鐵），不同就要重跑 npm run build-bounty-units',
    nLines > 0 && nSts > 100 && bad.length === 0, `${nLines} 條線、${nSts} 站；不同：${bad.slice(0, 5).join('；') || '無'}${bad.length > 5 ? `（共 ${bad.length} 條）` : ''}`);
}
// 區段檔 data/bounty_sections.json（build_bounty_units.mjs 同一發產出；網頁與 App 都讀它分組，計畫 2.2、4.2）。切法本身由 R15 拿手寫的線釘住，這裡驗版控裡那一份。
// R14：形狀、每條線從頭鋪到尾、站名與里程跟 bounty_units.json 的 lines 同一套、地區對得上車站資訊檔地址的縣市。
//   縣市 → 地區照計畫 2.2 在這裡另寫一份（不讀建置腳本的表），兩邊各自照規格寫、對得上才算。
// R14b：長度。8–30 km 以外的段只准是高鐵站距、整條一段的線（支線、林鐵短線），或下面列名的例外（理由寫在懸賞 v3 交接檔）；
//   支線一定整條一段、高鐵一定每站一段。
{
  const S = JSON.parse(read('data/bounty_sections.json'));
  const REG = ['north', 'central', 'south', 'east', 'thsr', 'afr'];
  const regionOf = {};
  for (const [r, cs] of Object.entries({ north: '基隆市 臺北市 新北市 桃園市 新竹縣 新竹市', central: '苗栗縣 臺中市 彰化縣 南投縣 雲林縣',
    south: '嘉義縣 嘉義市 臺南市 高雄市 屏東縣', east: '宜蘭縣 花蓮縣 臺東縣' })) for (const cty of cs.split(' ')) regionOf[cty] = r;
  const info = JSON.parse(read('data/tra_station_info.json'));
  const traRegion = name => {
    const n = name.replace(/臺/g, '台'), i = info[n] || info[n.replace(/[（(].*$/, '').trim()];
    const m = i && String(i.address).match(/^\d*\s*(..[縣市])/);
    return m ? regionOf[m[1].replace(/台/g, '臺')] : undefined;
  };
  const bad = [], wantKeys = Object.keys(units.lines).filter(k => units.lines[k].stations.length >= 2).sort();
  if (JSON.stringify(Object.keys(S.lines || {}).sort()) !== JSON.stringify(wantKeys)) bad.push(`線鍵跟 units 裡有兩站以上的線不同`);
  let nSec = 0;
  for (const [lk, ss] of Object.entries(S.lines || {})) {
    const ln = units.lines[lk];
    if (!ln) continue;
    const st = ln.stations, idx = new Map(st.map((s, i) => [s.name, i]));
    if (!ss.length || ss[0].a !== st[0].name || ss[ss.length - 1].b !== st[st.length - 1].name) bad.push(`${lk} 沒有從第一站鋪到最後一站`);
    ss.forEach((s, k) => {
      nSec++;
      if (k && s.a !== ss[k - 1].b) bad.push(`${lk} ${ss[k - 1].a}–${ss[k - 1].b} 接不上 ${s.a}–${s.b}`);
      const ia = idx.get(s.a), ib = idx.get(s.b);
      if (ia == null || ib == null || !(ia < ib) || s.dA !== st[ia].d || s.dB !== st[ib].d) bad.push(`${lk} ${s.a}–${s.b} 站名或里程跟 units 對不上`);
      if (s.km !== Math.round((s.dB - s.dA) * 10) / 10) bad.push(`${lk} ${s.a}–${s.b} km ${s.km}`);
      const want = ln.sys === 'thsr_sched' ? ['thsr'] : ln.sys === 'afr_sched' ? ['afr'] : REG.filter(r => r === traRegion(s.a) || r === traRegion(s.b));
      if (!want.length || JSON.stringify(s.regions) !== JSON.stringify(want)) bad.push(`${lk} ${s.a}–${s.b} 地區 ${JSON.stringify(s.regions)}，照地址是 ${JSON.stringify(want)}`);
    });
  }
  ok('R14 區段檔：v 1、六個地區分頁照順序、每條有兩站以上的線都在而且從頭鋪到尾、站名里程跟 bounty_units.json 同一套、km 是里程差取一位、地區對得上兩端站地址的縣市',
    S.v === 1 && JSON.stringify((S.regions || []).map(r => r.id)) === JSON.stringify(REG) && typeof S.rule === 'string' && S.rule.length > 0 && nSec > 50 && bad.length === 0,
    `${Object.keys(S.lines || {}).length} 條線、${nSec} 段；不對：${bad.slice(0, 5).join('；') || '無'}${bad.length > 5 ? `（共 ${bad.length} 條）` : ''}`);
  const WHOLE = ['NEIWAN', 'LIUJIA', 'PINGXI', 'SHENAO', 'JIJI', 'SHALUN', 'chengzhui'].map(id => `tra_sched|${id}`);
  const LISTED = ['tra_sched|南迴線 枋山–大武'];   // 兩邊都留 8 km 的切點只剩沒有車停的號誌站（枋野）
  const out = [], seen = [];
  for (const lk of WHOLE) if (!S.lines[lk] || S.lines[lk].length !== 1) out.push(`${lk} 不是整條一段`);
  for (const [lk, ss] of Object.entries(S.lines || {})) {
    const ln = units.lines[lk];
    if (!ln) continue;
    if (ln.sys === 'thsr_sched' && ss.length !== ln.stations.length - 1) out.push(`${lk} 不是每站一段`);
    for (const s of ss) {
      const km = s.dB - s.dA;
      if (km >= 8 && km <= 30) continue;
      seen.push(`${lk} ${s.a}–${s.b} ${km.toFixed(1)}`);
      if (ln.sys !== 'thsr_sched' && ss.length !== 1 && !LISTED.includes(`${lk} ${s.a}–${s.b}`)) out.push(`${lk} ${s.a}–${s.b} ${km.toFixed(1)} km`);
    }
  }
  ok('R14b 區段長度：8–30 km 以外只有高鐵站距、整條一段的線、列名的例外；支線整條一段、高鐵每站一段',
    out.length === 0 && seen.length > 0, `8–30 km 以外 ${seen.length} 段；不准的：${out.join('；') || '無'}`);
}

// 單位檔的 perDay 是「各日班次數的中位數」：台鐵班表是 14 天逐日的聯集
// （trains＝跨日去重的班次定義、dates＝日期 → 當天的班次索引），整份當成一天算的話，只開一天的臨時車、同車次改點的第二份定義
// 都會被算成每天一班，還會把尖峰時段推走。拿一份手寫的小班表在暫存目錄跑 build_bounty_units.mjs，期望值是手算的常數：
//   軌道檔一條線 甲(0)–乙(1)–丙(2)。五天（d1–d5）：
//   ・區間車：5–23 時每小時一班 甲→乙→丙（三站都停，同一小時內）；6、7、8、17、18、19 時再各加兩班。
//     d4 那天 12 時那一班改點成 12:10（另一份定義，當天取代原本那一份）→ 甲|乙、乙|丙 每天 31 班，中位數 31（聯集會是 32）。
//   ・其他：d4 才有的二十班 20 時 甲→乙（每兩分鐘一班，都在 20 時內）→ 中位數 0，不出單位（聯集會出一個 perDay 20 的單位、把 20 時變成尖峰；
//     尖峰改拿各日加總來切的話，20 時一樣會被切進去）。
//   ・自強：d1–d3 的 10 時 甲→丙、乙通過（stop:false）→ 中位數 1：甲|乙、乙|丙 各一個軌道單位；停站只有甲、丙。
//   ・莒光：d1、d5 才有 → 中位數 0，不出單位。
//   每小時停站數的中位數：尖峰 9、其他營運時段 3 → 尖峰＝6、7、8、17、18、19。
//   另十份壞班表要讓腳本非零離開，而且是腳本自己的檢查擋下（錯誤訊息指名是哪一種、哪一天、哪個索引），不是跑到後面才崩：
//   車次自帶行駛日（days）、dates 裡有超出範圍的索引、同一天同一個索引出現兩次；
//   dates 不是物件、dates 是空的、鍵不是日曆上的日期（2026-02-30）、某一天一班車都沒有；
//   台鐵的檔 dates 缺鍵（帶 dateRange）、台鐵的檔 dates 是 null、高鐵的檔帶 dateRange 卻沒有 dates。
//   擋下的時候舊的 data/bounty_units.json 原封不動（壞的一份不能寫出半套清單）。
//   高鐵、林鐵的軌道檔與班表放空的（一條線、一班車都沒有）：七個輸入檔少一個腳本就停（見 R13b）。
//   車站資訊檔（區段的縣市用）只放甲乙丙三站，地址都在臺北市。
//   偶數天（台鐵實際是 14 天）另跑一份：四天裡兩天有莒光 → 中位數取中間兩個的平均 0.5，出單位（取下面那一個會是 0、不出）。
{
  const SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'build_bounty_units.mjs');
  const TRACK = { lines: [{ id: 'L', name: 'L', stations: [{ name: '甲', d: 0 }, { name: '乙', d: 1 }, { name: '丙', d: 2 }] }] };
  const STN = Object.fromEntries(['甲', '乙', '丙'].map(n => [n, { name: n, address: '100臺北市中正區' }]));
  const tr = (kind, h, names, passAt = '', m = 0) => ({ train: `${kind}${h}${m}`, typeName: kind, carName: kind,
    stops: names.map((name, i) => ({ name, depSec: h * 3600 + m * 60 + i * 300, stop: name !== passAt })) });
  const trains = [], base = [];
  for (let h = 5; h <= 23; h++) base.push(trains.push(tr('區間車', h, ['甲', '乙', '丙'])) - 1);
  for (const h of [6, 7, 8, 17, 18, 19]) for (let k = 0; k < 2; k++) base.push(trains.push(tr('區間車', h, ['甲', '乙', '丙'], '', 20 + k)) - 1);
  const noon = base[7], noonMoved = trains.push(tr('區間車', 12, ['甲', '乙', '丙'], '', 10)) - 1;   // base[7]＝12 時那一班
  const other = Array.from({ length: 20 }, (_, k) => trains.push(tr('其他', 20, ['甲', '乙'], '', 2 * k)) - 1);
  const tze = trains.push(tr('自強', 10, ['甲', '乙', '丙'], '乙', 30)) - 1;
  const kg = trains.push(tr('莒光', 14, ['甲', '乙', '丙'])) - 1;
  const dates = {
    '2026-01-05': [...base, tze, kg], '2026-01-06': [...base, tze], '2026-01-07': [...base, tze],
    '2026-01-08': [...base.filter(i => i !== noon), noonMoved, ...other], '2026-01-09': [...base, kg],
  };
  const OLD = 'old-units-file';           // 預先放一份舊的單位檔：擋下的時候它要原封不動
  const run = (sched, { omit = [], files = {} } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'bounty-units-'));
    try {
      mkdirSync(join(dir, 'data'));
      const inputs = { 'data/tra.json': TRACK, 'data/tra_schedule_dense.json': sched,
        'data/thsr_track.json': { lines: [] }, 'data/thsr_schedule_dense.json': { date: '', trains: [] },
        'data/afr.json': { lines: [] }, 'data/afr_schedule_dense.json': { date: '', trains: [] }, 'data/tra_station_info.json': STN, ...files };
      for (const [f, v] of Object.entries(inputs)) if (!omit.includes(f)) writeFileSync(join(dir, f), JSON.stringify(v));
      writeFileSync(join(dir, 'data/bounty_units.json'), OLD);
      const p = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
      const raw = readFileSync(join(dir, 'data/bounty_units.json'), 'utf8');
      let out = null, sec = null;
      try { out = JSON.parse(raw); } catch (e) {}
      try { sec = JSON.parse(readFileSync(join(dir, 'data/bounty_sections.json'), 'utf8')); } catch (e) {}
      const se = String(p.stderr || '');
      return { status: p.status, out, sec, kept: raw === OLD, err: (se.match(/^Error: (.*)$/m) || [])[1] || se.split('\n').find(l => /Error/.test(l)) || '' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const list = r => r.out ? r.out.units.map(u => `${u.segKey.split('|').slice(2).join('')}|${u.trainKind}|${u.kind}|${u.dir}|${u.slot}=${u.perDay}`).sort() : [];
  const good = run({ date: '2026-01-05', trains, dates }), got = list(good);
  const want = ['乙甲|區間車|track|0|=31', '丙乙|區間車|track|0|=31', '乙甲|自強|track|0|=1', '丙乙|自強|track|0|=1',   // segKey 兩站依字碼排序
    ...['甲甲', '乙乙', '丙丙'].flatMap(s => [`${s}|區間車|dwell|0|peak=18`, `${s}|區間車|dwell|0|off=13`, `${s}|區間車|dwell|0|holiday=31`]),
    ...['甲甲', '丙丙'].flatMap(s => [`${s}|自強|dwell|0|off=1`, `${s}|自強|dwell|0|holiday=1`])].sort();
  const peak = good.out && good.out.peakHoursBySys && good.out.peakHoursBySys.tra_sched;
  const even = run({ date: '2026-01-05', trains, dates: { '2026-01-05': [...base, kg], '2026-01-06': [...base, kg], '2026-01-07': base, '2026-01-08': base } });
  const gotEven = list(even), peakEven = even.out && even.out.peakHoursBySys && even.out.peakHoursBySys.tra_sched;
  const wantEven = ['乙甲|區間車|track|0|=31', '丙乙|區間車|track|0|=31', '乙甲|莒光|track|0|=0.5', '丙乙|莒光|track|0|=0.5',
    ...['甲甲', '乙乙', '丙丙'].flatMap(s => [`${s}|區間車|dwell|0|peak=18`, `${s}|區間車|dwell|0|off=13`, `${s}|區間車|dwell|0|holiday=31`,
      `${s}|莒光|dwell|0|off=0.5`, `${s}|莒光|dwell|0|holiday=0.5`])].sort();
  const WANT_ERR = { days: /帶了逐車行駛日/, index: new RegExp(`2026-01-09 有壞的班次索引：${trains.length}$`), dup: new RegExp(`2026-01-06 重複列了班次索引：${base[0]}$`),
    notObj: /dates 不是「日期 → 班次索引」$/, empty: /dates 是空的$/, badKey: /dates 有不是日期的鍵：2026-02-30$/, emptyDay: /2026-01-07 一班車都沒有$/,
    noDates: /^data\/tra_schedule_dense\.json 沒有 dates：/, nullDates: /^data\/tra_schedule_dense\.json 沒有 dates：/,
    thsrRange: /^data\/thsr_schedule_dense\.json 沒有 dates：/ };
  const bad = [
    ['days', run({ date: '2026-01-05', trains: trains.map((t, i) => i ? t : { ...t, days: ['2026-01-05'] }), dates })],
    ['index', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-09': [...dates['2026-01-09'], trains.length] } })],
    ['dup', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-06': [...dates['2026-01-06'], base[0]] } })],
    ['notObj', run({ date: '2026-01-05', trains, dates: Object.values(dates) })],
    ['empty', run({ date: '2026-01-05', trains, dates: {} })],
    ['badKey', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-02-30': base } })],
    ['emptyDay', run({ date: '2026-01-05', trains, dates: { ...dates, '2026-01-07': [] } })],
    ['noDates', run({ date: '2026-01-05', trains, dateRange: ['2026-01-05', '2026-01-09'] })],
    ['nullDates', run({ date: '2026-01-05', trains, dates: null })],
    ['thsrRange', run({ date: '2026-01-05', trains, dates }, { files: { 'data/thsr_schedule_dense.json': { date: '', trains: [], dateRange: ['2026-01-05', '2026-01-09'] } } })],
  ];
  ok('R13 單位檔的 perDay＝各日班次數的中位數：手寫的五天班表跑 build_bounty_units，只開一天的臨時車與兩天的車不出單位、改點的第二份定義不多算、尖峰照各日中位數切；四天班表開兩天的車 perDay 0.5；' +
    '十份壞班表（車次與班次索引三份：車次自帶行駛日、索引超出範圍、同一天重複；dates 欄位四份：不是物件、是空的、鍵不是日期、某天沒車；缺 dates 三份：台鐵缺 dates、台鐵 dates 是 null、高鐵帶 dateRange 卻沒有 dates）都由腳本自己的檢查擋下、非零離開，舊的單位檔原封不動',
    good.status === 0 && JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(peak) === '[6,7,8,17,18,19]' &&
      even.status === 0 && JSON.stringify(gotEven) === JSON.stringify(wantEven) && JSON.stringify(peakEven) === '[6,7,8,17,18,19]' &&
      bad.length === 10 && bad.every(([k, r]) => r.status !== 0 && WANT_ERR[k].test(r.err) && r.kept),
    JSON.stringify({ status: good.status, peak, extra: got.filter(x => !want.includes(x)), missing: want.filter(x => !got.includes(x)),
      even: { status: even.status, peak: peakEven, extra: gotEven.filter(x => !wantEven.includes(x)), missing: wantEven.filter(x => !gotEven.includes(x)) },
      bad: bad.map(([k, r]) => `${k}:${r.status}:${r.kept ? 'kept' : 'OVERWRITTEN'}:${r.err.slice(0, 80)}`) }));
  // R13b：七個輸入檔少一個 → 停下來、點名缺哪一個、舊的單位檔原封不動。
  // 舊版印「略過」照樣寫出清單：少掉的系統在下一發估值會整個退場。軌道檔與班表各缺一次，分屬不同系統；車站資訊檔（區段的縣市）另缺一次。
  const miss = [['data/thsr_track.json', run({ date: '2026-01-05', trains, dates }, { omit: ['data/thsr_track.json'] })],
    ['data/afr_schedule_dense.json', run({ date: '2026-01-05', trains, dates }, { omit: ['data/afr_schedule_dense.json'] })],
    ['data/tra_station_info.json', run({ date: '2026-01-05', trains, dates }, { omit: ['data/tra_station_info.json'] })]];
  ok('R13b 輸入檔少一個（高鐵軌道檔、林鐵班表、車站資訊檔各試一次）→ 非零離開、錯誤訊息點名缺的那個檔、舊的單位檔原封不動',
    miss.every(([f, r]) => r.status !== 0 && r.err.startsWith(`缺 ${f}：`) && r.kept),
    JSON.stringify(miss.map(([f, r]) => `${f}:${r.status}:${r.kept ? 'kept' : 'OVERWRITTEN'}:${r.err.slice(0, 90)}`)));

  // R15：區段切法（data/bounty_sections.json，計畫 2.2）。手寫的線與班表跑 build_bounty_units，期望值是手算的常數。
  //   台鐵線 T（甲 0 ─ 酉 128 km）各站每天的自強停靠（五天都一樣，丁除外）：
  //     乙 5 km 20 班（分界，但離線頭甲只有 5 km：併的時候線的端點不拿，拿乙）、丙 14 km 7 班（不到 8，不是分界）、
  //     丁 22 km 只有兩天各 10 班（中位數 0，不是分界）、戊 30 km 8 班（甲–戊 剛好 30 km 不切）、己 40 km 12 班、
  //     庚 46 km 9 班＋區間車 2、辛 48 km 9 班＋區間車 5（庚–辛 2 km 要併：自強一樣多就比全部車種，拿掉庚；併完己–辛剛好 8 km 不再併）、壬 60 km 12 班；
  //     壬–酉 68 km 要切：癸 65 km 6 班最多，但離壬不到 8 km 不能切；寅 90、卯 96 都是 3 班，卯離中點 94 近 → 切卯；
  //     壬–卯 36 km 再切：只剩臺丑 70 km 2 班（寅離卯不到 8 km）；卯–酉 32 km 再切：辰 120 km 1 班（離酉剛好 8 km 可以切），巳 125 km 5 班離酉太近。
  //     → 甲–戊 30、戊–己 10、己–辛 8、辛–壬 12、壬–臺丑 10、臺丑–卯 26、卯–辰(舊) 24、辰(舊)–酉 8。
  //   台鐵線 U（午一 0、午二 12、午三 24 km）：午二剛好 8 班 → 是分界，兩段各 12 km（不是分界的話整條 24 km 一段）。
//   支線 JIJI（子一 ─ 子三 35 km，中間子二每天 20 班自強）整條一段。高鐵線 H（高一 0、高二 5、高三 50 km）每站一段，不併不切。
  //   林鐵線 A（林一 0、林二 4、林三 20、林四 30、林五 41 km）：全線來回各一班，另一班林二發車、林四到底 →
  //     分界林一、林二、林四、林五；林一–林二 4 km 併掉林二 → 林一–林四 30、林四–林五 11（林三停得跟林四一樣多，但沒有車在那裡發、到）。
  //   地區看車站資訊檔的地址（郵遞區號接縣市）：甲乙丙丁戊己臺北市、庚辛苗栗縣、壬寫成「台中市」、臺丑在資訊檔的鍵是「台丑」（嘉義市）、
  //     寅卯高雄市、辰(舊)在資訊檔的鍵是「辰」（臺東縣）、巳酉宜蘭縣、癸臺中市；午一午二午三花蓮縣；子一子二子三南投縣。兩端分屬兩區就兩區都列。
  // R15b：同一份班表，車站資訊檔少了酉 → 腳本自己擋下（點名酉）、非零離開，舊的單位檔原封不動、區段檔不寫。
  {
    const st = list => list.map(([name, d]) => ({ name, d }));
    const T = [['甲', 0], ['乙', 5], ['丙', 14], ['丁', 22], ['戊', 30], ['己', 40], ['庚', 46], ['辛', 48], ['壬', 60], ['癸', 65],
      ['臺丑', 70], ['寅', 90], ['卯', 96], ['辰(舊)', 120], ['巳', 125], ['酉', 128]];
    const tra = { lines: [{ id: 'T', name: 'T', stations: st(T) }, { id: 'U', name: 'U', stations: st([['午一', 0], ['午二', 12], ['午三', 24]]) },
      { id: 'JIJI', name: 'JIJI', stations: st([['子一', 0], ['子二', 15], ['子三', 35]]) }] };
    const thsr = { lines: [{ id: 'H', name: 'H', stations: st([['高一', 0], ['高二', 5], ['高三', 50]]) }] };
    const afrSts = [['林一', 0], ['林二', 4], ['林三', 20], ['林四', 30], ['林五', 41]];
    const afr = { lines: [{ id: 'A', name: 'A', stations: st(afrSts) }] };
    // 一站一班的「車」就夠算各站的停靠數（區段只看停靠數，不看區間）
    const one = (kind, name, k) => ({ train: `${kind}${name}${k}`, typeName: kind, carName: kind, stops: [{ name, depSec: 8 * 3600 + k * 60, stop: true }] });
    const daily = [], dOnly = [];
    for (const [name, n] of [['乙', 20], ['丙', 7], ['戊', 8], ['己', 12], ['庚', 9], ['辛', 9], ['壬', 12], ['癸', 6], ['臺丑', 2], ['寅', 3], ['卯', 3], ['辰(舊)', 1], ['巳', 5], ['午二', 8], ['子二', 20]])
      for (let k = 0; k < n; k++) daily.push(one('自強', name, k));
    for (const [name, n] of [['庚', 2], ['辛', 5]]) for (let k = 0; k < n; k++) daily.push(one('區間車', name, k));
    for (let k = 0; k < 10; k++) dOnly.push(one('自強', '丁', k));
    const secTrains = [...daily, ...dOnly], all = daily.map((_, i) => i), two = [...all, ...dOnly.map((_, i) => daily.length + i)];
    const secSched = { date: '2026-01-05', trains: secTrains,
      dates: { '2026-01-05': two, '2026-01-06': two, '2026-01-07': all, '2026-01-08': all, '2026-01-09': all } };
    const afrTrain = (id, names) => ({ train: id, typeName: '阿里山號', carName: '阿里山號', stops: names.map((name, i) => ({ name, depSec: 9 * 3600 + i * 600, stop: true })) });
    const afrNames = afrSts.map(([n]) => n);
    const afrSched = { date: '2026-01-05', trains: [afrTrain('A1', afrNames), afrTrain('A2', afrNames.slice().reverse()), afrTrain('A3', ['林二', '林三', '林四'])] };
    const addr = { 臺北市: '100臺北市中正區', 苗栗縣: '350苗栗縣竹南鎮', 台中市: '400001台中市中區', 嘉義市: '600嘉義市東區', 高雄市: '800高雄市新興區',
      臺東縣: '950臺東縣臺東市', 宜蘭縣: '260宜蘭縣宜蘭市', 臺中市: '400臺中市中區', 南投縣: '540南投縣南投市', 花蓮縣: '970花蓮縣花蓮市' };
    const STN2 = Object.fromEntries([['甲', '臺北市'], ['乙', '臺北市'], ['丙', '臺北市'], ['丁', '臺北市'], ['戊', '臺北市'], ['己', '臺北市'], ['庚', '苗栗縣'], ['辛', '苗栗縣'],
      ['壬', '台中市'], ['癸', '臺中市'], ['台丑', '嘉義市'], ['寅', '高雄市'], ['卯', '高雄市'], ['辰', '臺東縣'], ['巳', '宜蘭縣'], ['酉', '宜蘭縣'],
      ['午一', '花蓮縣'], ['午二', '花蓮縣'], ['午三', '花蓮縣'], ['子一', '南投縣'], ['子二', '南投縣'], ['子三', '南投縣']].map(([n, c]) => [n, { name: n, address: addr[c] }]));
    const files = { 'data/tra.json': tra, 'data/thsr_track.json': thsr, 'data/afr.json': afr, 'data/afr_schedule_dense.json': afrSched, 'data/tra_station_info.json': STN2 };
    const secOf = r => r.sec && r.sec.lines ? Object.entries(r.sec.lines).flatMap(([lk, ss]) => ss.map(s => `${lk}:${s.a}–${s.b}:${s.km}:${s.regions.join(',')}`)) : [];
    const good15 = run(secSched, { files }), got15 = secOf(good15);
    const want15 = ['tra_sched|T:甲–戊:30:north', 'tra_sched|T:戊–己:10:north', 'tra_sched|T:己–辛:8:north,central', 'tra_sched|T:辛–壬:12:central',
      'tra_sched|T:壬–臺丑:10:central,south', 'tra_sched|T:臺丑–卯:26:south', 'tra_sched|T:卯–辰(舊):24:south,east', 'tra_sched|T:辰(舊)–酉:8:east',
      'tra_sched|U:午一–午二:12:east', 'tra_sched|U:午二–午三:12:east', 'tra_sched|JIJI:子一–子三:35:central', 'thsr_sched|H:高一–高二:5:thsr', 'thsr_sched|H:高二–高三:45:thsr',
      'afr_sched|A:林一–林四:30:afr', 'afr_sched|A:林四–林五:11:afr'];
    const s15 = good15.sec || {};
    ok('R15 區段切法：手寫的台鐵線跑 build_bounty_units，自強各日中位數 ≥ 8 的站為界、< 8 km 從最短的併（線的端點不拿、拿停得少的、自強一樣多比全部車種）、' +
      '> 30 km 在兩邊都留 8 km 的站裡挑停得最多的切（一樣多挑離中點近的、切完兩半再查；剛好 8、剛好 30 km 不動）；支線整條一段、高鐵每站一段、' +
      '林鐵以有車發、到的站為界；地區照車站資訊檔地址的縣市（臺／台、括號註記都對得上），兩端分屬兩區就兩區都列',
      good15.status === 0 && JSON.stringify(got15) === JSON.stringify(want15) && s15.v === 1 && typeof s15.rule === 'string' && s15.rule.length > 0 &&
        JSON.stringify((s15.regions || []).map(r => r.id + r.name)) === JSON.stringify(['north北部', 'central中部', 'south南部', 'east東部', 'thsr高鐵', 'afr阿里山林鐵']) &&
        Object.values(s15.lines || {}).flat().every(s => s.dA === Object.fromEntries([...T, ...afrSts, ['午一', 0], ['午二', 12], ['子一', 0], ['子三', 35], ['高一', 0], ['高二', 5], ['高三', 50]])[s.a]),
      JSON.stringify({ status: good15.status, err: good15.err.slice(0, 120), extra: got15.filter(x => !want15.includes(x)), missing: want15.filter(x => !got15.includes(x)) }));
    const noYou = run(secSched, { files: { ...files, 'data/tra_station_info.json': Object.fromEntries(Object.entries(STN2).filter(([n]) => n !== '酉')) } });
    ok('R15b 車站資訊檔查不到區段端點的縣市 → 腳本自己擋下（錯誤訊息點名那一站）、非零離開，舊的單位檔原封不動、區段檔不寫',
      noYou.status !== 0 && /^區段：酉 在 data\/tra_station_info\.json 查不到縣市/.test(noYou.err) && noYou.kept && noYou.sec === null,
      `${noYou.status}:${noYou.kept ? 'kept' : 'OVERWRITTEN'}:${noYou.sec ? 'SECTIONS WRITTEN' : 'no sections'}:${noYou.err.slice(0, 90)}`);
  }
}

const failed = R.filter(r => !r.p);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);

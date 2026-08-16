// 逐線完乘率驗收:共構軌道(同一組相鄰站對同時屬於兩條線)不得讓任何一條線集不滿。
//
// 背景:貼軌(attachShapes)一段只會判給一條線,新竹–北新竹 這段實體軌道被判給內灣線,
// 於是縱貫線北段的最細區間「北新竹–新竹」沒有任何真實列車蓋得到 → 完乘率永遠停在 99%
// (唯一蓋得到的 8889 平原號是虛構班次,且 loop 車在 startRiding 第一行就被擋掉)。
//
// 用法:node scripts/verify_line_completion.mjs   (先在同一棵樹起 dev_server;PORT 預設 5292)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5292);
const URL = `http://127.0.0.1:${PORT}/index.html`;
const FICTION = ['8888', '8889']; // 山海號/平原號:虛構班次,且 loop 車不能上車收集

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

// ── Gate 0:先證明「我驗的是哪一棵樹」(心得 32:驗錯目標會全綠) ──────────────
const served = await fetch(URL).then(r => r.text());
const onDisk = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = s => createHash('md5').update(s).digest('hex');
console.log(`目標 ${URL}`);
console.log(`  伺服器供應 index.html md5 ${md5(served)}`);
console.log(`  本工作區    index.html md5 ${md5(onDisk)}`);
ok('G0 驗的就是本工作區的檔案', md5(served) === md5(onDisk));
if (md5(served) !== md5(onDisk)) { console.log('\n驗錯目標,中止'); process.exit(1); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ bypassCSP: true })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  try { return typeof state !== 'undefined' && state.ready && (state.trains || []).length > 0; } catch (e) { return false; }
}, null, { timeout: 90000 });

// ── 共構群組盤點:先確認這個現象真的存在,否則後面的斷言全是空轉 ──────────────
const shared = await page.evaluate(() => {
  const byPair = new Map();
  for (const rec of lineNetwork().values()) for (const s of rec.segs) {
    const p = rec.sys + '|' + (s.a < s.b ? s.a + '|' + s.b : s.b + '|' + s.a);
    let arr = byPair.get(p); if (!arr) byPair.set(p, arr = []);
    arr.push({ line: rec.name.replace(/（.*$/, ''), key: s.key, a: s.a, b: s.b });
  }
  return [...byPair.values()].filter(v => v.length > 1)
    .map(v => ({ pair: v[0].a + '–' + v[0].b, lines: v.map(x => x.line), keys: v.map(x => x.key) }));
});
console.log(`\n共構軌道群組 ${shared.length} 組:`);
shared.forEach(g => console.log(`   ${g.pair}  ←  ${g.lines.join(' / ')}`));
ok('G1 共構軌道確實存在(判準有對象可驗)', shared.length > 0, `${shared.length} 組`);

// ── T1:搭完整條縱貫線北段就該 100% ────────────────────────────────────────
const t1 = await page.evaluate(() => {
  localStorage.removeItem('trainmap-checkins-v1');
  const tr = state.trains.find(t => String(t.train) === '1251' && t.sys === 'tra_sched')
    || state.trains.find(t => t.sys === 'tra_sched' && t.stops[0].name === '基隆'
      && t.stops.some(s => s.name === '竹南'));
  if (!tr) return null;
  writeSegments(tr, 0, tr.stops.length - 1, 1);
  const l = lineCompletion().find(x => x.id === '縱貫線北段');
  return { route: tr.stops[0].name + '→' + tr.stops[tr.stops.length - 1].name, train: tr.train,
    pct: l ? Math.round(l.pct * 100) : -1, ridN: l ? l.ridN : -1, nSeg: l ? l.nSeg : -1 };
});
ok('T1 搭完基隆→竹南全程 → 縱貫線北段 100%', !!t1 && t1.pct === 100,
  t1 ? `車次 ${t1.train} ${t1.route} → ${t1.pct}% (${t1.ridN}/${t1.nSeg} 段)` : '找不到全程車次');

// ── T2:每條線的「真實列車完乘上限」都必須是 100%(窮舉,不抽樣) ───────────────
const t2 = await page.evaluate((FICTION) => {
  const net = lineNetwork(), fic = new Set(FICTION), rows = [];
  for (const [lid, rec] of net) {
    localStorage.removeItem('trainmap-checkins-v1');
    for (const tr of state.trains) {
      if (fic.has(String(tr.train))) continue;
      if (!tr.stops.some(s => s.segLn && s.segLn.sys + '|' + s.segLn.id === lid)) continue;
      writeSegments(tr, 0, tr.stops.length - 1, 1);   // 真實列車全都搭一遍
    }
    const l = lineCompletion().find(x => x.sys + '|' + x.id === lid);
    rows.push({ lid, name: rec.name.replace(/（.*$/, ''), pct: l ? l.pct * 100 : 0,
      ridN: l ? l.ridN : 0, nSeg: rec.segs.length });
  }
  return { rows, netSize: net.size };
}, FICTION);
const bad = t2.rows.filter(r => r.ridN !== r.nSeg);
console.log('');
bad.forEach(r => console.log(`   集不滿: ${r.name}  ${r.ridN}/${r.nSeg} 段  ${r.pct.toFixed(2)}%`));
ok('T2 全部路線的真實列車完乘上限皆為 100%', bad.length === 0,
  `${t2.rows.length - bad.length}/${t2.rows.length} 條線`);
// 覆蓋率本身要有斷言(心得 37d:分母會無聲縮水)
ok('T2c 每一條線都真的被驗到', t2.rows.length === t2.netSize && t2.netSize > 0,
  `檢查 ${t2.rows.length} 條 / 路網 ${t2.netSize} 條`);

// ── T3:既有收集也要認帳,而且不准動使用者存的資料 ──────────────────────────
const t3 = await page.evaluate(() => {
  const g = (() => {
    const byPair = new Map();
    for (const rec of lineNetwork().values()) for (const s of rec.segs) {
      const p = rec.sys + '|' + (s.a < s.b ? s.a + '|' + s.b : s.b + '|' + s.a);
      let arr = byPair.get(p); if (!arr) byPair.set(p, arr = []);
      arr.push(s.key);
    }
    return [...byPair.values()].find(v => v.length > 1);
  })();
  if (!g) return null;
  // 只植入群組中的第一個鍵,模擬「舊資料只記到其中一條線」
  const stored = { v: 2, st: {}, sg: { [g[0]]: { n: 3, nv: 1, u: 1750000000000 } } };
  localStorage.setItem('trainmap-checkins-v1', JSON.stringify(stored));
  const sg = segmentCollection();
  const after = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
  return { group: g, seen: g.map(k => sg[k] || 0),
    storedKeys: Object.keys(after.sg || {}), srcN: (after.sg[g[0]] || {}).n };
});
ok('T3a 舊資料的共構段互相認帳(不必重搭)', !!t3 && t3.seen.every(n => n > 0),
  t3 ? t3.group.map((k, i) => k.split('|')[1] + '=' + t3.seen[i]).join('  ') : '找不到共構群組');
ok('T3b 沒有改寫使用者存檔(只在讀取端補)', !!t3 && t3.storedKeys.length === 1 && t3.srcN === 3,
  t3 ? `存檔仍為 ${t3.storedKeys.length} 鍵、n=${t3.srcN}` : '');

// ── T4:反向控制組——不得多給不相干的線 ────────────────────────────────────
const t4 = await page.evaluate(() => {
  localStorage.removeItem('trainmap-checkins-v1');
  const tr = state.trains.find(t => t.sys === 'tra_sched'
    && t.stops.every(s => !s.segLn || s.segLn.id === 'JIJI'));   // 集集線純線內車,無共構
  if (!tr) return null;
  writeSegments(tr, 0, tr.stops.length - 1, 1);
  const sg = segmentCollection();
  const jiji = lineNetwork().get('tra_sched|JIJI');
  const keys = Object.keys(sg);
  return { train: tr.train, keys: keys.length, jijiSegs: jiji.segs.length,
    foreign: keys.filter(k => !k.startsWith('tra_sched|JIJI|')) };
});
ok('T4a 無共構的路線:一段都不多給(鍵全屬本線)', !!t4 && t4.foreign.length === 0,
  t4 ? `車次 ${t4.train} → ${t4.keys} 鍵,外線 ${t4.foreign.length}` : '找不到集集線純線內車');
ok('T4b 無共構的路線:段數等於該線最細區間數', !!t4 && t4.keys === t4.jijiSegs,
  t4 ? `${t4.keys}/${t4.jijiSegs}` : '');

const t4c = await page.evaluate(() => {
  localStorage.removeItem('trainmap-checkins-v1');
  return Object.keys(segmentCollection()).length;
});
ok('T4c 空收集不會憑空生出段', t4c === 0, `${t4c} 鍵`);

// ── T5:顯示層真的印出 100%(不是只有內部數字對) ─────────────────────────────
const t5 = await page.evaluate(() => {
  localStorage.removeItem('trainmap-checkins-v1');
  const tr = state.trains.find(t => String(t.train) === '1251' && t.sys === 'tra_sched');
  if (!tr) return null;
  writeSegments(tr, 0, tr.stops.length - 1, 1);
  const host = document.createElement('div');
  host.innerHTML = buildLineBars();
  const row = [...host.querySelectorAll('.ph-line')]
    .find(e => e.textContent.includes('縱貫線北段'));
  return { text: row ? row.textContent.trim().replace(/\s+/g, ' ') : null,
    done: row ? !!row.querySelector('.pl-pct.done') : false,
    all: [...host.querySelectorAll('.ph-line')].map(e => e.textContent.trim().replace(/\s+/g, ' ')) };
});
console.log('\n護照「路線完乘」渲染:', t5 ? t5.all.join(' | ') : '(無)');
ok('T5 護照那一列印出 100% 且標記完成', !!t5 && /100%$/.test(t5.text || '') && t5.done,
  t5 ? t5.text : '');

ok('Z 全程零 JS 例外', errs.length === 0, errs.slice(0, 3).join(' / '));

console.log(`\n總計 ${pass} PASS / ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);

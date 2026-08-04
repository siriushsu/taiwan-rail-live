// 林鐵車次撞號驗證(issue#23)——阿里山林鐵 1/2 次被當成台鐵環島之星 1/2 次。
//
// 判準來源刻意獨立於實作:兩份資料檔各自宣告「我有 1 次和 2 次」這件事,由本腳本自己讀出來,
// 不看 index.html 怎麼比對。撞號清單也在這裡重算一次,實作若日後改用別的 key,這裡照樣抓得到。
//
// 反向控制組(第 C 節)是本腳本的重點:只證明「林鐵不再顯示環島之星」不夠——修法若寫成
// 「整個特別列車檔停用」也會過,所以必須同時證明台鐵那邊的具名列車一個都沒少。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5311;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

// ── 第一道閘:確認驗的是哪一棵樹 ──(驗收腳本驗到別的 worktree 的舊檔是真的發生過的事)
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`驗證目標：${ROOT}\nindex.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); process.exit(1); }

// ── 資料層:撞號清單自己算一次 ──
const afr = JSON.parse(readFileSync(path.join(ROOT, 'data/afr_schedule_dense.json'), 'utf8'));
const sp = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_special_trains.json'), 'utf8'));
const afrNos = new Set(afr.trains.map(t => String(t.train)));
const namedNos = new Map();
for (const n of sp.namedTrains) for (const no of n.trainNos) namedNos.set(no, n.name);
const collide = [...afrNos].filter(no => namedNos.has(no)).sort();
console.log('\n═══ A. 撞號盤點（資料層）═══');
ok(collide.length > 0, `林鐵與台鐵具名列車的撞號車次：${collide.map(n => `${n}=${namedNos.get(n)}`).join('、') || '無'}`);

const page = await (await chromium.launch()).newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE + '/?_cb=afrno', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.systems
  && state.systems.some(s => s.id === 'afr_sched'), { timeout: 30000 });
await page.waitForFunction(() => state.ready === true, { timeout: 30000 }).catch(() => {});
// 「台」分頁＝台鐵＋林鐵同框,正是使用者回報時的畫面,也是撞號真的會發生的組態
await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
await page.waitForFunction(() => state.trains.some(t => t.sys === 'afr_sched')
  && state.trains.some(t => t.sys === 'tra_sched') && state.special, { timeout: 30000 });
await page.waitForTimeout(800);

// 讀「地圖下方列車資訊卡」實際渲染出來的字(renderTrainCard 就是使用者截圖的那張卡)
const card = async (no, sys) => page.evaluate(([no, sys]) => {
  const tr = state.trains.find(t => t.sys === sys && String(t.train) === no);
  if (!tr) return { missing: true };
  renderTrainCard(tr);
  const el = document.getElementById('tcIntro');
  const spd = specialOf(tr);
  return {
    kind: document.getElementById('tcKind').textContent,
    intro: el.textContent,
    named: (el.querySelector('b.tn') || {}).textContent || null,
    spNull: spd === null,
    namedId: spd && spd.named ? spd.named.id : null,
    // 收藏標籤與搜尋結果列共用的那條 fallback,一起驗(它們不走 renderTrainCard)
    favLabel: (() => { const s = (spd && spd.named) || SPECIAL_TRAINS[no]; return s ? s.name : tr.typeName; })(),
  };
}, [no, sys]);

console.log('\n═══ B. 林鐵撞號車次不得掛上台鐵具名列車 ═══');
for (const no of collide) {
  const c = await card(no, 'afr_sched');
  ok(!c.missing, `林鐵 ${no} 次存在於畫面`);
  if (c.missing) continue;
  ok(!/環島之星|萌旅|藍皮解憂|海風號|山海號|平原號/.test(c.intro),
    `林鐵 ${no} 次的介紹不含任何台鐵具名列車名（實際開頭：「${c.intro.slice(0, 24)}…」）`);
  ok(c.named === null, `林鐵 ${no} 次沒有具名列車標題（實際：${c.named ?? '無'}）`);
  ok(c.spNull, `林鐵 ${no} 次的 specialOf 回 null（特別列車檔是台鐵專屬）`);
  ok(c.favLabel === c.kind || !/環島之星|藍皮解憂/.test(c.favLabel),
    `林鐵 ${no} 次的收藏／搜尋標籤是「${c.favLabel}」而非台鐵具名列車`);
}
// 全林鐵掃一遍:不能有任何一班掛到台鐵檔,且每班都仍有自己的車種說明
const allAfr = await page.evaluate(() => {
  const bad = [], noDesc = [];
  for (const tr of state.trains.filter(t => t.sys === 'afr_sched')) {
    if (specialOf(tr) !== null) bad.push(tr.train);
    const it = trainIntro(tr);
    if (it.special || !it.desc) noDesc.push(tr.train);
  }
  return { n: state.trains.filter(t => t.sys === 'afr_sched').length, bad, noDesc };
});
ok(allAfr.bad.length === 0, `全部 ${allAfr.n} 班林鐵車次都不吃台鐵特別列車檔（例外：${allAfr.bad.join(',') || '無'}）`);
ok(allAfr.noDesc.length === 0, `全部林鐵車次仍有自己的車種介紹（缺：${allAfr.noDesc.join(',') || '無'}）`);

console.log('\n═══ C. 控制組：台鐵那邊一個都不能少 ═══');
// 期望值直接由 data/tra_special_trains.json 推導,不是抄當下實測值
const expect = [];
for (const n of sp.namedTrains) for (const no of n.trainNos) expect.push([no, n.name]);
for (const [no, name] of expect) {
  const c = await card(no, 'tra_sched');
  if (c.missing) { ok(true, `台鐵 ${no} 次（${name}）今日班表沒有這班，略過`); continue; }
  ok(c.named === name, `台鐵 ${no} 次仍認得「${name}」（實際：${c.named ?? '無'}）`);
}
const traNamed = await page.evaluate(() => state.trains.filter(t =>
  t.sys === 'tra_sched' && specialOf(t) && specialOf(t).named).map(t => t.train));
ok(traNamed.length > 0, `台鐵仍有 ${traNamed.length} 班具名列車被認出（${traNamed.join(',')}）`);
const traBranch = await page.evaluate(() => state.trains.filter(t =>
  t.sys === 'tra_sched' && specialOf(t) && specialOf(t).branch).length);
ok(traBranch > 0, `台鐵支線比對仍運作（${traBranch} 班命中支線）`);
const traStock = await page.evaluate(() => state.trains.filter(t =>
  t.sys === 'tra_sched' && specialOf(t) && specialOf(t).stock).length);
ok(traStock > 0, `台鐵車型圖鑑比對仍運作（${traStock} 班命中車型）`);

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass}／失敗 ${fail}`);
process.exit(fail === 0 ? 0 : 1);

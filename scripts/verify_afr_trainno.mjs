// 林鐵車次撞號驗證(issue#23＋2026-09-08 收集章)——阿里山林鐵 1/2 次被當成台鐵環島之星 1/2 次。
//
// 用法：node scripts/verify_afr_trainno.mjs [目標目錄]
//   PORT 有值＝改連既有 server（本機同時 30+ 個 worktree，各有自己的 dev server）；
//   空／未設＝自己起一個由 OS 指派埠的 server，G0 的 md5 閘門兩條路都會跑。
//
// 判準來源刻意獨立於實作:兩份資料檔各自宣告「我有 1 次和 2 次」這件事,由本腳本自己讀出來,
// 不看 index.html 怎麼比對。撞號清單也在這裡重算一次,實作若日後改用別的 key,這裡照樣抓得到。
//
// 反向控制組(第 C 節與 D2/D4)是本腳本的重點:只證明「林鐵不再顯示環島之星」不夠——修法若寫成
// 「整個特別列車檔停用」或「dexCandidates 一律回空」也會過,所以必須同時證明台鐵那邊一個都沒少。
//
// D 節(2026-09-08)守的是**第二個消費端**:issue#23 當時只在 specialOf() 加了系統閘門,而護照／
// 成就頁的收集章走的是 dexCandidates()——它直接讀 state.special 再對 state.trains 比車次,
// 完全沒經過 specialOf。「台」分頁把台鐵與林鐵載進同一個 state.trains,環島之星的 trainNos
// ['1','2'] 於是撈到林鐵的 1/2 次;而環島之星並非天天開,今日名冊沒有台鐵 1/2 時,林鐵那兩班
// 就是僅有的候選 ⇒ 點下去 100% 跑成阿里山林鐵。使用者 2026-09-08 回報。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

// ── server:PORT 有值就連既有的,否則自己起 ──────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.geojson': 'application/json' };
let server = null, PORT = Number(process.env.PORT || 0);
if (!PORT) {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
      return res.end('{}');
    }
    let fp = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
  await new Promise(r => server.listen(0, r));
  PORT = server.address().port;
}
const BASE = `http://localhost:${PORT}`;
const done = code => { if (server) server.close(); process.exit(code); };

// ── G0:確認驗的是哪一棵樹 ──(驗收腳本驗到別的 worktree 的舊檔是真的發生過的事)
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const BUILD = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
console.log(`驗證目標：${ROOT}\nBUILD ${BUILD}／index.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); done(1); }

// ── 資料層:撞號清單與「今日應有的候選」自己算一次 ──────────────────────────
const afr = JSON.parse(readFileSync(path.join(ROOT, 'data/afr_schedule_dense.json'), 'utf8'));
const sp = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_special_trains.json'), 'utf8'));
const afrNos = new Set(afr.trains.map(t => String(t.train)));
const namedNos = new Map();
for (const n of sp.namedTrains) for (const no of n.trainNos) namedNos.set(no, n.name);
const collide = [...afrNos].filter(no => namedNos.has(no)).sort();
console.log('\n═══ A. 撞號盤點（資料層）═══');
ok(collide.length > 0, `林鐵與台鐵具名列車的撞號車次：${collide.map(n => `${n}=${namedNos.get(n)}`).join('、') || '無'}`);

// 今日台鐵名冊:產品讀 data/tra_schedule_dense.json，trains[] 是 14 天聯集，dates[今天] 才是當日。
// 拿整份聯集當期望值會說「環島之星今天有車」而使用者的畫面沒有——判準會對著錯的分母綠。
const dense = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const DAY_KEY = dense.dates && dense.dates[TODAY] ? TODAY
  : Object.keys(dense.dates || {}).sort((a, b) => Math.abs(Date.parse(a) - Date.parse(TODAY)) - Math.abs(Date.parse(b) - Date.parse(TODAY)))[0];
const roster = (dense.dates[DAY_KEY] || []).map(i => dense.trains[i]).filter(Boolean);
console.log(`（今日名冊：${DAY_KEY} 共 ${roster.length} 班；全檔 ${dense.trains.length} 班是 ${dense.dateRange.join('～')} 的聯集）`);
// 每一枚章「今日台鐵應有哪些車次」——由磁碟推導，不問頁面（頁面另有兩班虛構環島車 tr.loop，
// 那是產品刻意注入的額外候選，所以下面用「⊇ 期望」而不是等號）。
const expectOf = new Map();
for (const n of sp.namedTrains) if (n.trainNos.length)
  expectOf.set('named:' + n.id, new Set(roster.filter(t => n.trainNos.includes(String(t.train))).map(t => String(t.train))));
for (const s of sp.rollingStock)
  expectOf.set('stock:' + s.id, new Set(roster.filter(t => s.carNames.includes(t.carName)).map(t => String(t.train))));
for (const b of sp.branchLines) {
  const ss = new Set(b.matchStations);
  expectOf.set('branch:' + b.id, new Set(roster.filter(t => t.stops.some(x => ss.has(x.name))).map(t => String(t.train))));
}

// ── 開頁:「台」分頁＝台鐵＋林鐵同框,正是使用者回報時的畫面,也是撞號真的會發生的組態 ──
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
// 語系釘 zh-TW:B 節比對的是中文列車名,跟隨機器語系跑會整段假紅(既有踩坑)。
// 護照展開:D 節要真的點到 .seal,收合狀態下點不到。
await ctx.addInitScript(() => { try {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-appearance', 'light');
  localStorage.setItem('trainmap-passport-open', '1');
} catch (e) {} });
const page = await ctx.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e).slice(0, 200)));
await page.goto(BASE + '/?lang=zh-TW&_cb=afrno', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.systems
  && state.systems.some(s => s.id === 'afr_sched'), { timeout: 30000 });
await page.waitForFunction(() => state.ready === true, { timeout: 30000 }).catch(() => {});
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

console.log('\n═══ D. 護照／成就的收集章：點下去只能跟台鐵的車 ═══');
// D0 前置閘門:證明「這一輪真的量得到撞號」——沒有這條，林鐵沒載進來時 D1 會恆綠。
const inv = await page.evaluate(() => ({
  afr: state.trains.filter(t => t.sys === 'afr_sched').length,
  tra: state.trains.filter(t => t.sys === 'tra_sched').length,
  seals: [...document.querySelectorAll('#passport .seal[data-cat]')].map(e => e.dataset.cat + ':' + e.dataset.id),
}));
ok(inv.afr > 0 && inv.tra > 0, `D0 同框名冊同時有台鐵 ${inv.tra} 班與林鐵 ${inv.afr} 班（撞號才可能發生）`);
const collideStamps = sp.namedTrains.filter(n => n.trainNos.length && n.trainNos.some(no => afrNos.has(no)));
ok(collideStamps.length > 0, `D0 有 ${collideStamps.length} 枚具名章的車次與林鐵撞號（${collideStamps.map(n => n.name).join('、')}）`);
ok(inv.seals.length > 0, `D0 護照上渲染出 ${inv.seals.length} 枚收集章可點`);

// D1(核心，反向判準):三本圖鑑每一枚章的候選裡，非台鐵的數量必須是 0。
const cands = await page.evaluate(() => {
  const sd = state.special, out = {};
  const add = (cat, id) => { out[cat + ':' + id] = dexCandidates(cat, id).map(t => ({ no: String(t.train), sys: t.sys })); };
  sd.namedTrains.filter(n => n.trainNos.length).forEach(n => add('named', n.id));
  sd.rollingStock.forEach(s => add('stock', s.id));
  sd.branchLines.forEach(b => add('branch', b.id));
  return out;
});
const dirty = Object.entries(cands).map(([k, v]) => [k, v.filter(c => c.sys !== 'tra_sched')]).filter(([, v]) => v.length);
ok(dirty.length === 0, `D1 全部 ${Object.keys(cands).length} 枚章的候選都是台鐵（越界：${dirty.map(([k, v]) => `${k}→${v.map(c => c.sys + '#' + c.no).join('/')}`).join('；') || '無'}）`);

// D2(正向對照):防「dexCandidates 一律回空」的假修法。期望值由磁碟今日名冊推導，
// 用 ⊇ 而非等號——產品另外注入兩班虛構環島車(tr.loop)當候選，那是刻意的。
let covered = 0;
for (const [key, want] of expectOf) {
  if (!want.size) continue;
  covered++;
  const got = new Set((cands[key] || []).map(c => c.no));
  const miss = [...want].filter(no => !got.has(no));
  ok(miss.length === 0, `D2 ${key} 仍涵蓋今日名冊算出的 ${want.size} 班（缺：${miss.join(',') || '無'}）`);
}
ok(covered > 0, `D2 具名分母：今日有候選的章共 ${covered} 枚（為 0 表示這一輪什麼都沒驗到）`);

// D3(真做一次那個互動):實際點護照上的撞號章，量使用者真正感受到的東西——跟到哪一班車。
// 判準寫成通用形式，不寫死「今天環島之星沒車」：有台鐵候選就必須跟台鐵，沒有就一班都不准跟。
for (const n of collideStamps) {
  const sel = `#passport .seal[data-cat="named"][data-id="${n.id}"]`;
  const el = page.locator(sel);
  if (!await el.count()) { ok(false, `D3 護照上找不到「${n.name}」的章（${sel}）`); continue; }
  await page.evaluate(() => { state.followTrain = null; });
  await el.click();
  await page.waitForTimeout(300);
  const ft = await page.evaluate(() => state.followTrain ? { no: String(state.followTrain.train), sys: state.followTrain.sys } : null);
  const want = expectOf.get('named:' + n.id) || new Set();
  if (want.size) ok(ft && ft.sys === 'tra_sched' && want.has(ft.no),
    `D3 點「${n.name}」跟到台鐵 ${[...want].join('/')} 其中一班（實際：${ft ? ft.sys + '#' + ft.no : '沒跟到車'}）`);
  else ok(ft === null,
    `D3 「${n.name}」今日台鐵無班次，點下去不得跟任何車（實際：${ft ? ft.sys + '#' + ft.no : '沒跟到車'}）`);
}

// D4(控制組):挑一枚今日確定有台鐵候選的章真的點一次，證明修法沒把功能整個關掉。
const ctrlKey = [...expectOf].find(([k, v]) => k.startsWith('named:') && v.size) || [...expectOf].find(([, v]) => v.size);
if (!ctrlKey) ok(false, 'D4 今日名冊算不出任何有候選的章，控制組無法成立');
else {
  const key = ctrlKey[0], cat = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
  const el = page.locator(`#passport .seal[data-cat="${cat}"][data-id="${id}"]`);
  await page.evaluate(() => { state.followTrain = null; });
  await el.click();
  await page.waitForTimeout(300);
  const ft = await page.evaluate(() => state.followTrain ? { no: String(state.followTrain.train), sys: state.followTrain.sys } : null);
  ok(!!ft && ft.sys === 'tra_sched', `D4 控制組：點 ${key} 仍跟得到台鐵的車（實際：${ft ? ft.sys + '#' + ft.no : '沒跟到車'}）`);
}
console.log('\n═══ E. 探索面板「今日亮點」：特別列車／支線列也只能是台鐵的車 ═══');
// 同一個缺陷的第二個消費端(2026-09-08 與 D 節同輪抓到):computeHighlights 也是直接對
// state.trains 比車次／車型／站名。實測「台」分頁下它把林鐵 1/2 次標成「環島之星 萌旅號」,
// 點下去跟到的就是阿里山林鐵——與使用者回報的收集章症狀一模一樣,只是入口不同。
const hi = await page.evaluate(() => {
  const o = computeHighlights(), m = x => ({ title: x.title, no: String(x.tr.train), sys: x.tr.sys });
  return { special: o.special.map(m), branches: o.branches.map(m) };
});
const hiBad = [...hi.special, ...hi.branches].filter(x => x.sys !== 'tra_sched');
ok(hiBad.length === 0, `E1 亮點的特別列車 ${hi.special.length} 列＋支線 ${hi.branches.length} 列全是台鐵（越界：${hiBad.map(x => `${x.title}=${x.sys}#${x.no}`).join('、') || '無'}）`);
// E2 正向對照:防「整段拿掉就不會越界」的假修法。期望值一樣由磁碟今日名冊推導。
const wantNamedRows = [...expectOf].filter(([k, v]) => k.startsWith('named:') && v.size)
  .flatMap(([k, v]) => [...v].map(no => ({ id: k.slice(6), no })));
const gotNamedNos = new Set(hi.special.map(x => x.no));
const missRows = wantNamedRows.filter(r => !gotNamedNos.has(r.no));
ok(wantNamedRows.length > 0 && missRows.length === 0,
  `E2 今日名冊算出的 ${wantNamedRows.length} 班具名列車都還在亮點裡（缺：${missRows.map(r => r.id + '#' + r.no).join(',') || '無'}）`);
const wantBranch = [...expectOf].filter(([k, v]) => k.startsWith('branch:') && v.size).length;
ok(hi.branches.length === wantBranch, `E2 支線列 ${hi.branches.length} 條＝今日名冊算出的 ${wantBranch} 條`);

console.log('\n═══ F. 完乘記錄的支線章：跨系統站名撞號不得蓋到台鐵的章 ═══');
// recordRide() 的 stockId/namedId 走 specialOf() 自帶閘門，branchIds 卻是自己比對 stops 的站名。
// 今日資料裡林鐵站名恰好一個都沒撞到六條支線的 matchStations ⇒ 直接量今天的資料是**零資訊**
// （判準盲點 1：真值恆為 0 的反向判準）。所以這裡**構造**一條 matchStations 指向林鐵實際停靠站
// 的假支線，逼出這條路徑；正向對照同時證明台鐵那半仍照常蓋章。
const f = await page.evaluate(() => {
  const afrTr = state.trains.find(t => t.sys === 'afr_sched' && t.stops && t.stops.length > 1);
  const traTr = state.trains.find(t => t.sys === 'tra_sched' && !t.loop
    && state.special.branchLines.some(b => t.stops.some(s => b._set.has(s.name))));
  if (!afrTr || !traTr) return { setup: false };
  const fake = { id: '__probe__', name: '測試支線', section: '', matchStations: afrTr.stops.map(s => s.name), story: '' };
  fake._set = new Set(fake.matchStations);
  state.special.branchLines.push(fake);
  const grab = tr => {
    const before = loadRides().length;
    recordRide(tr);
    const rides = loadRides();
    return rides.length > before ? rides[rides.length - 1] : null;
  };
  const afrRide = grab(afrTr), traRide = grab(traTr);
  state.special.branchLines.pop();
  return { setup: true, afrNo: String(afrTr.train), traNo: String(traTr.train),
    afrBranch: afrRide ? (afrRide.branchIds || null) : 'no-ride',
    afrNamed: afrRide ? (afrRide.namedId ?? null) : 'no-ride',
    traBranch: traRide ? (traRide.branchIds || null) : 'no-ride' };
});
ok(f.setup, `F0 前置：取得林鐵與台鐵各一班可完乘的車（${f.setup ? `林鐵 ${f.afrNo}／台鐵 ${f.traNo}` : '取不到'}）`);
if (f.setup) {
  ok(f.afrBranch === null, `F1 林鐵 ${f.afrNo} 次完乘不得蓋到支線章——即使站名對得上（實際：${JSON.stringify(f.afrBranch)}）`);
  ok(f.afrNamed === null, `F1 林鐵 ${f.afrNo} 次完乘不得帶具名列車 id（實際：${JSON.stringify(f.afrNamed)}）`);
  ok(Array.isArray(f.traBranch) && f.traBranch.length > 0,
    `F2 控制組：台鐵 ${f.traNo} 次完乘仍蓋得到支線章（實際：${JSON.stringify(f.traBranch)}）`);
}

console.log('\n═══ G. 今天沒有這一類的車時：說明卡＋下次開行日（2026-09-08 使用者要求）═══');
// 使用者：「點下去應該要資訊/故事卡出現,然後提示今天沒有這班車,請再有的時刻來搭乘。」
// 期望值一律由磁碟的 dates 索引自己算(與 index.html 的實作不同源);_schedStale 與窗尾兩個
// 邊界另外用注入的方式逼出來——真實資料今天不會走到那兩條路,不逼就是零資訊。
const DAY_KEYS = Object.keys(dense.dates).sort();
const WINDOW_END = DAY_KEYS[DAY_KEYS.length - 1];
const futureOf = (pred, limit = 3) => {
  const out = [];
  for (const day of DAY_KEYS) {
    if (day <= DAY_KEY) continue;
    if ((dense.dates[day] || []).some(i => { const t = dense.trains[i]; return t && pred(t); })) out.push(day);
    if (out.length >= limit) break;
  }
  return out;
};
const predOf = key => {
  const [cat, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (cat === 'named') { const n = sp.namedTrains.find(x => x.id === id); return t => n.trainNos.includes(String(t.train)); }
  if (cat === 'stock') { const r = sp.rollingStock.find(x => x.id === id); return t => r.carNames.includes(t.carName); }
  const b = sp.branchLines.find(x => x.id === id), ss = new Set(b.matchStations);
  return t => t.stops.some(x => ss.has(x.name));
};
// 今天沒車、但窗內還有的章——這正是使用者點下去會出事的那一種。G1 拿它逐日比對。
const missKeys = [...expectOf].filter(([k, v]) => !v.size).map(([k]) => k).filter(k => futureOf(predOf(k)).length);
ok(!dense.dates[TODAY] === false, `G0 班表窗涵蓋今天（${TODAY} ∈ ${dense.dateRange.join('～')}）——不涵蓋時產品不報日期,下面的 G1/G3 也不成立`);
console.log(`  · 磁碟算出「今天沒車、窗內還有」的章 ${missKeys.length} 枚：${missKeys.join('、') || '無'}（G1 的比對對象）`);

// G3／G5／G7 要真的點一枚「今天沒有班次」的章。舊寫法把樣本綁死在 missKeys 上並硬斷言它非空,
// 兩個後果:①那一組在真實班表上是浮動的——同一份磁碟資料實算 2026-09-09 有 2 枚、09-10 有 1 枚、
// 09-11 起連三天 0 枚 ⇒ 每半個月有幾天 G0 直接紅掉把整條出貨鏈擋住(2026-09-11 實際發生);
// ②0 枚那幾天 G5／G7 是靜靜地不跑,連紅都沒有,覆蓋率無聲縮水。
// 🔴 樣本的判準還要問產品,不能只看磁碟:2026-09-11 磁碟說 named:shanhai／named:pingyuan 今天沒車,
//    產品卻跟得到 tra_sched#8888——那兩班是本站原創的虛構列車,根本不在台鐵班表檔裡。
// 沒有天然樣本時改用注入(與 G5／G6 同一套手法):挑一枚今天有車、窗內也還有車的章,把它的車從
// state.trains 濾掉。dexCandidates 讀 state.trains(今天有沒有車)、dexRunDates 讀 d.dates
// (未來哪幾天有車),兩邊來源不同 ⇒ 濾掉前者就精準造出「今天沒車、窗內還有」,日期期望值一行都不用改。
// state.trains 在 index.html 只有一個寫入點(切換系統時重建),動畫 tick 不會把濾掉的車放回來。
const keyList = [...expectOf.keys()];
const pageNone = await page.evaluate(ks => ks.filter(k => {
  const i = k.indexOf(':'); return dexCandidates(k.slice(0, i), k.slice(i + 1)).length === 0;
}), keyList);
const gNatural = missKeys.find(k => pageNone.includes(k)) || pageNone[0] || null;
const gKey = gNatural || keyList.find(k => !pageNone.includes(k) && futureOf(predOf(k)).length) || null;
const gSynth = !gNatural && !!gKey;
ok(!!gKey, `G0 取得「今天沒有班次」的樣本章：${gKey || '(取不到)'}${gKey ? (gSynth ? '（注入:濾掉它今天的車）' : '（天然）') : ''}`);
// 注入與還原。回傳注入後的今日候選數,呼叫端拿它當正向對照——沒濾成 0 就代表下面驗的是別條路。
const synthOn = (pg, key) => pg.evaluate(k => {
  const i = k.indexOf(':'), m = dexMatcher(k.slice(0, i), k.slice(i + 1));
  window.__afrSynthSaved = state.trains;
  state.trains = state.trains.filter(t => !(t.sys === 'tra_sched' && m(t)));
  return dexCandidates(k.slice(0, i), k.slice(i + 1)).length;
}, key);
const synthOff = pg => pg.evaluate(() => {
  if (window.__afrSynthSaved) { state.trains = window.__afrSynthSaved; window.__afrSynthSaved = null; }
});
const denseOk = await page.evaluate(() => {
  const d = (state.systems.find(s => s.id === 'tra_sched') || {}).data;
  return { kept: Array.isArray(d && d._denseTrains), len: (d && d._denseTrains || []).length, stale: !!(d && d._schedStale) };
});
ok(denseOk.kept && denseOk.len === dense.trains.length,
  `G0 resolveScheduleDay 留住了 14 天聯集：頁面 ${denseOk.len} 班＝磁碟 ${dense.trains.length} 班（沒留住就問不出下次開行日）`);
ok(denseOk.stale === false, `G0 頁面判定班表未過期（_schedStale=${denseOk.stale}）`);

// G1(正向,核心):下次開行日必須逐日等於磁碟算出來的那幾天。
for (const key of missKeys) {
  const [cat, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const want = futureOf(predOf(key));
  const got = await page.evaluate(([c, i]) => dexRunDates(c, i), [cat, id]);
  ok(got && JSON.stringify(got.days) === JSON.stringify(want),
    `G1 ${key} 的下次開行日＝${want.join('、')}（實際：${got ? got.days.join('、') || '無' : 'null'}）`);
}
// G2(掃描機制的正向對照):同一支述詞套在「今天」那格索引上,要復現今日候選。
// 這條把 dexRunDates 的索引解參考路徑與 dexCandidates 綁在一起——兩邊漂開就紅。
let g2 = 0;
for (const [key, want] of expectOf) {
  if (!want.size) continue;
  const [cat, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const got = await page.evaluate(([c, i]) => {
    const d = (state.systems.find(s => s.id === 'tra_sched') || {}).data, m = dexMatcher(c, i);
    return (d.dates[d._schedDay] || []).map(x => d._denseTrains[x]).filter(t => t && m(t)).map(t => String(t.train));
  }, [cat, id]);
  const miss = [...want].filter(no => !got.includes(no));
  if (miss.length) ok(false, `G2 ${key} 用同一支述詞掃今天那格,漏掉 ${miss.join(',')}`);
  else g2++;
}
ok(g2 > 0 && g2 === [...expectOf].filter(([, v]) => v.size).length,
  `G2 ${g2} 枚有候選的章,述詞掃今日索引的結果與 dexCandidates 一致`);

// G3(真做一次那個互動):點下去要看到卡,而且不准跟到任何車。
if (!gKey) ok(false, 'G3 取不到樣本章,跳過');
else {
  const [cat, id] = [gKey.slice(0, gKey.indexOf(':')), gKey.slice(gKey.indexOf(':') + 1)];
  const rec = (cat === 'named' ? sp.namedTrains : cat === 'stock' ? sp.rollingStock : sp.branchLines).find(x => x.id === id);
  if (gSynth) ok(await synthOn(page, gKey) === 0, `G3 注入生效:${gKey} 今天的候選被濾成 0（沒濾成 0 就代表下面驗的是「有車可搭」那條路）`);
  const wantDay = futureOf(predOf(gKey))[0];
  // 窗內還有 ⇒ 卡上要出現那一天;窗內都沒有 ⇒ 要改口講窗尾(與 G6 驗同一條產品路徑,差別在這裡是真的章、真的點擊)。
  const endLabel = `${Number(WINDOW_END.slice(5, 7))}/${Number(WINDOW_END.slice(8, 10))}`;
  const wantLabel = wantDay ? `${Number(wantDay.slice(5, 7))}/${Number(wantDay.slice(8, 10))}` : endLabel;
  const el = page.locator(`#passport .seal[data-cat="${cat}"][data-id="${id}"]`);
  await page.evaluate(() => { state.followTrain = null; hideHelpPop(); });
  await el.click();
  await page.waitForTimeout(300);
  const g3 = await page.evaluate(() => { const p = document.getElementById('helpPop');
    return { hidden: p.hidden, sticky: !!state._helpPopSticky, text: (p.textContent || '').replace(/\s+/g, ' '),
             follow: state.followTrain ? state.followTrain.sys + '#' + state.followTrain.train : null }; });
  ok(g3.hidden === false, `G3 點「${rec.name}」之後說明卡出現（helpPop.hidden=${g3.hidden}）`);
  ok(g3.follow === null, `G3 點下去不跟任何車（實際：${g3.follow || '沒跟到車'}）`);
  ok(g3.text.includes(rec.name), `G3 卡上有章名「${rec.name}」`);
  ok(g3.text.includes('今天沒有班次'), 'G3 卡上明講「今天沒有班次」');
  ok(g3.text.includes(wantLabel), wantDay
    ? `G3 卡上有下次開行日 ${wantLabel}（磁碟算出的 ${wantDay}）`
    : `G3 這枚章窗內都沒有班次,卡上改口講窗尾 ${wantLabel}（${WINDOW_END}）`);
  if (!wantDay) ok(!g3.text.includes('下一班'), 'G3 窗內都沒有時不得出現「下一班」字樣');
  ok(rec.story && g3.text.includes(rec.story.slice(0, 16)),
    `G3 卡上有這班車的故事（比對資料檔開頭 16 字：「${(rec.story || '').slice(0, 16)}」）`);
  // G3b:游標移開不能讓卡消失(.help-pop 是 pointer-events:none,不黏住就讀不完)
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.getElementById('helpPop').hidden) === false, 'G3b 游標移開後卡片仍在(sticky)');
  // G3c:點別處要收得掉,不能賴在畫面上。用 body 上的合成事件而不是真的點地圖——
  // 點地圖會順手把護照收起來,後面 G4 就沒有章可點了(第一版寫成 mouse.click 時當場踩到)。
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.getElementById('helpPop').hidden) === true, 'G3c 點別處後卡片收起');
  if (gSynth) await synthOff(page);   // 還原:G4 的控制組要有車可搭
}

// G4(反向控制組):今天有車的章照舊直接跟車,卡不准出現——防「一律改成開卡」的假修法。
const g4Key = [...expectOf].find(([k, v]) => k.startsWith('named:') && v.size) || [...expectOf].find(([, v]) => v.size);
if (!g4Key) ok(false, 'G4 今天算不出有候選的章,控制組無法成立');
else {
  const [cat, id] = [g4Key[0].slice(0, g4Key[0].indexOf(':')), g4Key[0].slice(g4Key[0].indexOf(':') + 1)];
  await page.evaluate(() => { state.followTrain = null; hideHelpPop(); });
  await page.locator(`#passport .seal[data-cat="${cat}"][data-id="${id}"]`).click();
  await page.waitForTimeout(300);
  const g4 = await page.evaluate(() => { const p = document.getElementById('helpPop');
    return { pop: p.hidden, sticky: !!state._helpPopSticky, text: (p.textContent || '').replace(/\s+/g, ' '),
      follow: state.followTrain ? state.followTrain.sys + '#' + state.followTrain.train : null }; });
  ok(g4.follow !== null && g4.follow.startsWith('tra_sched#'), `G4 控制組：點 ${g4Key[0]} 仍直接跟台鐵的車（實際：${g4.follow || '沒跟到車'}）`);
  // 🔴 這裡不能斷言「卡不存在」:桌面 hover 本來就會開一般提示卡(既有行為,滑鼠移過去點就會觸發),
  //    第一版寫成 pop===true 當場假紅。要分辨的是「那張是不是『今天沒有班次』那一張」。
  ok(g4.pop === true || (!g4.sticky && !g4.text.includes('今天沒有班次')),
    `G4 控制組：有車可搭時不開「今天沒有班次」卡（hidden=${g4.pop}／sticky=${g4.sticky}／「${g4.text.slice(0, 30)}」）`);
}

// G5(邊界,注入):班表過期退回同週幾時,名冊根本不是今天的 ⇒ 一個日期都不准報。
if (gKey) {
  const [cat, id] = [gKey.slice(0, gKey.indexOf(':')), gKey.slice(gKey.indexOf(':') + 1)];
  const g5 = await page.evaluate(([c, i]) => {
    const d = (state.systems.find(s => s.id === 'tra_sched') || {}).data;
    d._schedStale = true;
    const r = { run: dexRunDates(c, i), html: dexMissHtml(c, i, 'X') };
    d._schedStale = false;
    return r;
  }, [cat, id]);
  ok(g5.run === null, `G5 _schedStale 時 dexRunDates 回 null（實際：${JSON.stringify(g5.run)}）`);
  ok(!/\d+\/\d+/.test(g5.html), `G5 _schedStale 時卡上不出現任何日期（實際：「${g5.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 70)}」）`);
  ok(/今天沒有班次/.test(g5.html), 'G5 _schedStale 時仍然講「今天沒有班次」與故事,只是不報日期');
}
// G6(邊界,注入):窗內完全找不到 ⇒ 說「窗尾之前都沒有」,不准寫成「沒有下一班」也不准亂猜。
const g6 = await page.evaluate(() => {
  const sd = state.special;
  sd.namedTrains.push({ id: '__probe_never__', name: '測試列車', trainNos: ['9999999'], story: '測試故事' });
  const r = { run: dexRunDates('named', '__probe_never__'), html: dexMissHtml('named', '__probe_never__', '測試列車') };
  sd.namedTrains.pop();
  return r;
});
ok(g6.run && g6.run.days.length === 0, `G6 窗內找不到任何開行日時 days 為空（實際：${JSON.stringify(g6.run && g6.run.days)}）`);
ok(g6.html.includes(`${Number(WINDOW_END.slice(5, 7))}/${Number(WINDOW_END.slice(8, 10))}`),
  `G6 改口講窗尾 ${WINDOW_END}（實際：「${g6.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 90)}」）`);
ok(!g6.html.includes('下一班'), 'G6 找不到時不得出現「下一班」字樣');

// G7(手機):觸控殼跑的是另一條路——護照在 sheet 裡、沒有 hover、而且原本點章第一件事是關面板。
// 關掉面板就等於毀掉卡片的錨點,所以「沒車可搭」時不准關;再點同一枚要收起來。
// 另開 context:isMobile 會讓 any-pointer:coarse 成立 ⇒ HELP_POP_HOVER 為 false,正是要驗的那一格。
if (gKey) {
  const [cat, id] = [gKey.slice(0, gKey.indexOf(':')), gKey.slice(gKey.indexOf(':') + 1)];
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mctx.addInitScript(() => { try {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', 'zh-TW');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-passport-open', '1');
  } catch (e) {} });
  const mp = await mctx.newPage();
  const mErrs = [];
  mp.on('pageerror', e => mErrs.push(String(e).slice(0, 200)));
  await mp.goto(BASE + '/?lang=zh-TW&_cb=afrno-m', { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, { timeout: 60000 });
  await mp.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
  await mp.waitForFunction(() => state.trains.some(t => t.sys === 'tra_sched') && state.special, { timeout: 30000 });
  ok(await mp.evaluate(() => HELP_POP_HOVER) === false, 'G7 手機殼確實沒有 hover（HELP_POP_HOVER=false,否則下面驗的是桌面那條路）');
  await mp.evaluate(() => openRidePanel());
  await mp.waitForTimeout(400);
  if (gSynth) ok(await synthOn(mp, gKey) === 0, `G7 注入生效:手機頁 ${gKey} 今天的候選被濾成 0`);
  const msel = `#ridePanel .seal[data-cat="${cat}"][data-id="${id}"]`;
  const mel = mp.locator(msel);
  if (!await mel.count()) ok(false, `G7 手機護照 sheet 裡找不到樣本章（${msel}）`);
  else {
    await mel.scrollIntoViewIfNeeded();
    await mel.click();
    await mp.waitForTimeout(350);
    const m1 = await mp.evaluate(() => ({ pop: document.getElementById('helpPop').hidden,
      panel: document.getElementById('ridePanel').hidden,
      text: (document.getElementById('helpPop').textContent || '').replace(/\s+/g, ' ') }));
    ok(m1.pop === false && m1.text.includes('今天沒有班次'), `G7 手機點下去出現「今天沒有班次」卡（hidden=${m1.pop}／「${m1.text.slice(0, 24)}」）`);
    ok(m1.panel === false, 'G7 手機不得先關護照面板——關掉就毀了卡片的錨點,畫面上會變成「點了沒反應」');
    await mel.click();
    await mp.waitForTimeout(350);
    ok(await mp.evaluate(() => document.getElementById('helpPop').hidden) === true, 'G7 手機再點同一枚收起卡片');
  }
  ok(mErrs.length === 0, `G7 手機殼期間無未捕捉例外（${mErrs.slice(0, 2).join(' | ') || '無'}）`);
  await mctx.close();
}

ok(pageErrs.length === 0, `D／E／F 節期間頁面無未捕捉例外（${pageErrs.slice(0, 2).join(' | ') || '無'}）`);

await browser.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass}／失敗 ${fail}`);
done(fail === 0 ? 0 : 1);

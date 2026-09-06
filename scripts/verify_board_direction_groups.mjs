// 車站看板的方向分組（台鐵／高鐵／林鐵）：南下／北上／支線終點方向必須分開顯示，
// 而且顏色要照台鐵 2026-08-29 新版標示設計手冊「以藍色代表北上，綠色代表南下」。
//
// 判準設計的三條紀律（踩過的坑）：
//   1. 先證明「我在量的是誰」——D0 印出目標與 index.html 的 md5 並斷言與工作區逐 byte 相同，
//      否則驗收腳本會對著幾個 commit 前的暫存副本全綠。
//   2. 判準寫【身分】不寫數字——D1 咬的是「哪幾條線必須落在幹線／支線側」，不是「門檻是 0.15」。
//      線網改了（加線、改站）會轉紅，而不是靜默沿用一個過期的魔術數字。
//   3. 每條正向斷言都配反向對照——「支線必須不含南下北上」「非分歧站必須不出現線名」
//      「支線組必須沒有方向色」。少了反向，「乾脆全部都標南下」也會全綠。
//
// 語系一律釘 zh-TW（context locale + ?lang=zh-TW）：Playwright 預設 en-US，
// 比對中文字面的判準在預設語系下會整支恆真空過（見 verify-locale-must-be-pinned 的教訓）。
//
// 用法：node scripts/verify_board_direction_groups.mjs [URL]
//       MUTATE=<名稱> 跑突變自檢（見檔尾 MUTATIONS 說明）
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TARGET = process.argv[2] || 'http://127.0.0.1:5399/';   // 🔴 不可叫 URL：會遮蔽全域 URL 建構子
let pass = 0, fail = 0;
const ok = (name, cond, got) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '　實測：' + got}`); };

// ── D0 目標自檢 ─────────────────────────────────────────────────────
const localHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const localMd5 = createHash('md5').update(localHtml).digest('hex');
const served = await (await fetch(new URL('index.html', TARGET))).text();
const servedMd5 = createHash('md5').update(served).digest('hex');
const build = (localHtml.match(/const BUILD = '([^']+)'/) || [])[1] || '(未知)';
console.log(`目標 ${TARGET}　BUILD ${build}　工作區 md5 ${localMd5.slice(0, 12)}　線上 md5 ${servedMd5.slice(0, 12)}`);
ok('D0 驗收目標與工作區逐 byte 相同（不是某個暫存副本）', localMd5 === servedMd5, `${localMd5} vs ${servedMd5}`);
if (localMd5 !== servedMd5) { console.log('\n目標不對，後面全部不跑。'); process.exit(1); }

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'zh-TW', viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const pageErrors = [];
p.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await p.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await p.goto(TARGET + (TARGET.includes('?') ? '&' : '?') + 'lang=zh-TW', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.waitForTimeout(3000);

// 🔴 突變一律【改原始碼】再重跑本腳本，不在頁面注入旗標：boardGroupOf／BOARD_TRUNK_LAT_SPAN
//    都是 top-level 宣告，`window.X = ...` 蓋不到 renderBoard 內部走 lexical scope 的呼叫，
//    注入式突變會「全綠」而讓人誤以為判準沒牙——其實是突變根本沒生效。用法見檔尾 MUTATIONS。

// 讀一站的看板結構
const readBoard = (name, sys, expand = false) => p.evaluate(([n, sy, ex]) => {
  const st = (state.schedStations || []).find(s => s.name === n && s.sys === sy);
  if (!st) return { err: '找不到站 ' + n };
  const el = document.getElementById('board');
  el.classList.toggle('expand', !!ex);
  state.boardStation = st;
  renderBoard();
  const groups = [...el.querySelectorAll('.bgrp')].map(n2 => {
    let c = 0, x = n2.nextElementSibling;
    while (x && x.classList.contains('row')) { c++; x = x.nextElementSibling; }
    const cs = getComputedStyle(n2);
    const mins = []; let y = n2.nextElementSibling;
    while (y && y.classList.contains('row')) { // 「即將」＝0 分、「停駛」沒有分鐘（回 null 不參與門檻比較）
      const txt = y.querySelector('.min').textContent.trim();
      mins.push(txt === '即將' ? 0 : txt === '停駛' ? null : (txt.match(/-?\d+/) ? +txt.match(/-?\d+/)[0] : null));
      y = y.nextElementSibling;
    }
    return { label: n2.textContent, rows: c, mins, cls: n2.className, color: cs.color };
  });
  return { groups, rows: el.querySelectorAll('.row').length };
}, [name, sys, expand]);

// ── D1 幹線／支線的身分（不是門檻數字）────────────────────────────
const sides = await p.evaluate(() => {
  const out = { trunk: [], branch: [] };
  for (const ln of (state.trackLines || [])) {
    if (!['tra_sched', 'thsr_sched', 'afr_sched'].includes(ln.sys)) continue;
    const short = ln.name.replace(/[（(].*$/, '');
    (boardLineLatSpan(ln) >= BOARD_TRUNK_LAT_SPAN ? out.trunk : out.branch).push(short);
  }
  out.trunk.sort(); out.branch.sort();
  return out;
});
const MUST_TRUNK = ['北迴線', '南迴線', '宜蘭線', '屏東線', '山線', '海線', '縱貫線北段', '縱貫線南段', '臺東線'];
const MUST_BRANCH = ['內灣線', '六家線', '平溪線', '成追線', '沙崙線', '深澳線', '集集線'];
ok('D1a 九條環島幹線全部落在幹線側（南下／北上有意義）',
  MUST_TRUNK.every(x => sides.trunk.includes(x)), JSON.stringify(sides.trunk));
ok('D1b 七條台鐵支線全部落在支線側（改用終點站方向）',
  MUST_BRANCH.every(x => sides.branch.includes(x)), JSON.stringify(sides.branch));
ok('D1c 支線側不得混進任何幹線（反向對照）',
  !MUST_TRUNK.some(x => sides.branch.includes(x)), JSON.stringify(sides.branch));

// ── D2 非分歧站：只有南下／北上，不得出現線名 ──────────────────────
const taipei = await readBoard('臺北', 'tra_sched');
const tpDir = taipei.groups.filter(g => /dir-[ns]/.test(g.cls)).map(g => g.label);
ok('D2a 臺北恰有「南下」「北上」兩個方向組', tpDir.length === 2 && tpDir.includes('南下') && tpDir.includes('北上'), JSON.stringify(tpDir));
ok('D2b 非分歧站的方向組不得帶線名（反向對照）', tpDir.every(l => !l.includes('·')), JSON.stringify(tpDir));

// ── D3 分歧站：同方向多條幹線才補線名 ─────────────────────────────
const zhunan = (await readBoard('竹南', 'tra_sched')).groups.map(g => g.label);
ok('D3a 竹南南下拆成山線與海線兩組',
  zhunan.includes('南下 · 山線') && zhunan.includes('南下 · 海線'), JSON.stringify(zhunan));
ok('D3b 竹南北上只有一條幹線，故不補線名（反向對照）',
  zhunan.includes('北上') && !zhunan.some(l => l.startsWith('北上 ·')), JSON.stringify(zhunan));
const ershui = (await readBoard('二水', 'tra_sched')).groups.map(g => g.label);
ok('D3c 二水＝南下／北上／往車埕（幹線用方向、支線用終點）',
  ershui.includes('南下') && ershui.includes('北上') && ershui.some(l => l.includes('車埕')), JSON.stringify(ershui));

// ── D4 支線一律不寫南下北上（使用者 2026-08-31 裁示）───────────────
for (const [name, sys] of [['集集', 'tra_sched'], ['竹中', 'tra_sched'], ['阿里山', 'afr_sched']]) {
  const g = (await readBoard(name, sys)).groups.map(x => x.label);
  ok(`D4 ${name}：純支線站不得出現「南下」「北上」`,
    g.length > 0 && !g.some(l => l.includes('南下') || l.includes('北上')), JSON.stringify(g));
}

// ── D5 逐組配額（一般 3、展開 6），且冷門方向不被熱門擠掉 ───────────
const zn = await readBoard('竹南', 'tra_sched', false);
ok('D5a 一般段每組至多 3 班', zn.groups.every(g => g.rows <= 3), JSON.stringify(zn.groups.map(g => g.rows)));
const znx = await readBoard('竹南', 'tra_sched', true);
ok('D5b 展開段每組至多 6 班', znx.groups.every(g => g.rows <= 6), JSON.stringify(znx.groups.map(g => g.rows)));
ok('D5c 展開後總列數確實變多（配額真的有作用）', znx.rows > zn.rows, `${zn.rows} → ${znx.rows}`);
ok('D5d 每一組都至少有一班（空組不畫）', znx.groups.every(g => g.rows >= 1), JSON.stringify(znx.groups.map(g => g.rows)));

// ── D10 「抵達本站」只列 60 分鐘內（使用者 2026-08-31 裁示 b）──────────
// 判準刻意不寫死「應該有幾班」——班數是會漂移的量（心得 35）。改成：在同一個 tick 裡從
// tr.stops 獨立重算「這站 60 分內／60~180 分的終到車數」，再要求看板恰好等於 min(前者, 配額)。
// 那份重算不經過 boardGroupOf／配額／上限任何一行（受測的是分組與上限，不是 dtm 算術）。
const ARR_STN = ['樹林', '潮州', '花蓮', '基隆', '新竹', '七堵', '彰化', '嘉義', '臺東', '竹南'];
const arrScan = await p.evaluate((STN) => {
  const res = [];
  for (const ex of [false, true]) for (const name of STN) {
    const st = (state.schedStations || []).find(s => s.name === name && s.sys === 'tra_sched');
    if (!st) { res.push({ name, ex, err: '找不到站' }); continue; }
    const el = document.getElementById('board');
    el.classList.toggle('expand', ex);
    state.boardStation = st; renderBoard();
    const gs = [...el.querySelectorAll('.bgrp')].map(n2 => {
      const mins = []; let y = n2.nextElementSibling;
      while (y && y.classList.contains('row')) {
        const txt = y.querySelector('.min').textContent.trim();
        mins.push(txt === '即將' ? 0 : txt === '停駛' ? null : (txt.match(/-?\d+/) ? +txt.match(/-?\d+/)[0] : null));
        y = y.nextElementSibling;
      }
      return { label: n2.textContent, mins };
    });
    let within = 0, beyond = 0;                       // 獨立重算，與看板同一個 tick
    for (const tr of state.trains.concat(state.traCancelled || [])) {
      if (tr.sys !== 'tra_sched' || tr.loop) continue; // 環島車末站＝起點，看板本來就不列
      const s = tr.stops[tr.stops.length - 1];
      if (!s || s.name !== name || s.stop === false) continue;
      let d = s.arrSec + Math.round((tr._cancelled ? 0 : liveDelaySec(tr)) / 60) * 60 - state.simSec;
      if (d > 43200) d -= 86400; else if (d < -43200) d += 86400;
      if (d < -30) continue;
      if (d <= 3600) within++; else if (d <= 10800) beyond++;
    }
    res.push({ name, ex, within, beyond, gs });
  }
  return res;
}, ARR_STN);
const arrOf = r => r.gs.find(g => g.label === '抵達本站');
const bad10a = arrScan.filter(r => !r.err).filter(r => (arrOf(r)?.mins || []).some(v => v != null && v > 60));
ok('D10a 「抵達本站」組不得出現 60 分以上的班次',
  bad10a.length === 0, JSON.stringify(bad10a.map(r => [r.ex ? '展開' : '一般', r.name, arrOf(r).mins])));
ok('D10b 正向對照：至少一站真的畫出「抵達本站」組（否則 D10a 是空過）',
  arrScan.some(r => !r.err && (arrOf(r)?.mins.length || 0) > 0),
  JSON.stringify(arrScan.map(r => r.name + ':' + (arrOf(r)?.mins.length ?? '無'))));
ok('D10c 反向對照：確實有 60~180 分的終到車被擋掉（否則這輪沒有鑑別力）',
  arrScan.some(r => !r.err && r.beyond > 0), JSON.stringify(arrScan.map(r => `${r.name}:${r.beyond}`)));
const bad10d = arrScan.filter(r => !r.err)
  .filter(r => (arrOf(r)?.mins.filter(v => v != null).length || 0) !== Math.min(r.within, r.ex ? 6 : 3));
ok('D10d 抵達組班次數＝min(獨立量到的 60 分內終到車, 每組配額)——是濾掉超時，不是整組砍半',
  bad10d.length === 0,
  JSON.stringify(bad10d.map(r => [r.ex ? '展開' : '一般', r.name, arrOf(r)?.mins ?? null, r.within])));
ok('D10e 誤傷對照：其他組仍看得到 60 分以上的班次（上限只套抵達組）',
  arrScan.some(r => !r.err && r.gs.filter(g => g.label !== '抵達本站').some(g => g.mins.some(v => v != null && v > 60))),
  JSON.stringify(arrScan.map(r => r.name + ':' + Math.max(0, ...r.gs.filter(g => g.label !== '抵達本站').flatMap(g => g.mins).filter(v => v != null)))));

// ── D6 官方方向色：北上藍、南下綠；支線無方向色（反向對照）─────────
const rgb = s => (s.match(/\d+/g) || []).map(Number);
const near = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 2);
for (const theme of ['light', 'dark']) {
  await p.evaluate(t => t === 'dark' ? document.documentElement.setAttribute('data-theme', 'dark')
    : document.documentElement.removeAttribute('data-theme'), theme);
  const want = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('span'); document.body.appendChild(probe);
    const val = v => { probe.style.color = v; const c = getComputedStyle(probe).color; return c; };
    const r = { n: val(cs.getPropertyValue('--dir-north')), s: val(cs.getPropertyValue('--dir-south')) };
    probe.remove(); return r;
  });
  const g = (await readBoard('二水', 'tra_sched')).groups;
  const north = g.find(x => x.cls.includes('dir-n')), south = g.find(x => x.cls.includes('dir-s'));
  const branch = g.find(x => !/dir-[ns]/.test(x.cls));
  ok(`D6a ${theme}：北上是官方藍`, !!north && near(rgb(north.color), rgb(want.n)), `${north && north.color} vs ${want.n}`);
  ok(`D6b ${theme}：南下是官方綠`, !!south && near(rgb(south.color), rgb(want.s)), `${south && south.color} vs ${want.s}`);
  ok(`D6c ${theme}：支線組不得帶方向色（反向對照）`,
    !!branch && !near(rgb(branch.color), rgb(want.n)) && !near(rgb(branch.color), rgb(want.s)), `${branch && branch.color}`);
}
await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));

// ── D11 共構段不得決定線別（網友回報 issue #46，2026-09-05）─────────────────
// 新竹–北新竹是縱貫線北段與內灣線【共用的同一段實體軌道】，貼軌時一段只會判給其中一條線，
// 於是往基隆／七堵的縱貫線車被貼到內灣線上、整批掉進「往內灣」組（北新竹同理，生出假的
// 「往新竹」組）。修法：共構段不決定線別，改用最近的非共構段。
// 🔴 判準的真值來源刻意【不是】segLn——那正是被驗的實作，同源比對「相等」是零資訊。
//    這裡用「終點站 × 各線站列」與「這班車有沒有真的走進支線專屬區間」兩組獨立資料。
const d11 = await p.evaluate(() => {
  const norm = s => String(s || '').replace(/臺/g, '台');
  const stationsOf = id => new Set((((state.trackLines || []).find(l => l.id === id) || {}).stations || [])
    .map(x => norm(x.name)));
  const readGroups = name => {
    const st = (state.schedStations || []).find(s => s.name === name && s.sys === 'tra_sched');
    if (!st) return [{ label: '找不到站 ' + name, dests: [] }];
    const el = document.getElementById('board');
    el.classList.add('expand'); state.boardStation = st; renderBoard();
    return [...el.querySelectorAll('.bgrp')].map(gn => {
      const dests = []; let x = gn.nextElementSibling;
      while (x && x.classList.contains('row')) {
        const to = x.querySelector('.dest .to');
        if (to) dests.push(norm(to.textContent).replace(/^往\s*/, ''));
        x = x.nextElementSibling;
      }
      return { label: gn.textContent.trim(), dests };
    });
  };
  // 「只能搭幹線到達」＝【所有幹線】的站列扣掉內灣線站列。新竹／北新竹本身兩邊都有，自動排除。
  // 🔴 這裡原本只扣「縱貫線北段」，於是污染北新竹的那批車（終點苗栗／彰化，在山線上）落在
  //    分母外，M9 突變下 D11d 照樣綠——分母漏一塊，全稱斷言就等於沒有。
  // 🔴 前提：內灣線與六家線的車全部終到新竹，不直通幹線。哪天真的直通了這條會轉紅——那是
  //    要重想判準的訊號，不是誤報（平溪線直通八堵就是這種形態，故本判準只用在這兩站）。
  const trunkStationsAll = new Set();
  for (const ln of (state.trackLines || []))
    if (boardLineLatSpan(ln) >= BOARD_TRUNK_LAT_SPAN)
      for (const x of (ln.stations || [])) trunkStationsAll.add(norm(x.name));
  const neiwan = stationsOf('NEIWAN');
  const trunkOnly = new Set([...trunkStationsAll].filter(n => !neiwan.has(n)));
  const branchOf = groups => groups.filter(g => g.label.startsWith('往') && !g.label.includes('抵達'));
  const hsinchu = readGroups('新竹'), beihsinchu = readGroups('北新竹');
  // 🔴 畫面每組只畫得下 perGroup 班，拿「畫出來那幾列」當全稱斷言的分母 ⇒ 分母會漂：
  //    同一個缺陷有時前 6 列剛好都乾淨就整條空過（M9 突變下 D11d 就是這樣假綠的）。
  //    故全稱斷言掃【整組】——資料仍走 schedBoardRows 這條產線，只是不套配額。
  const allBranchDests = name => {
    const st = (state.schedStations || []).find(s => s.name === name && s.sys === 'tra_sched');
    if (!st) return null;
    return schedBoardRows(st).filter(r => r.g.kind === 'branch')
      .map(r => norm(r.tr.loop ? r.loopDest : r.dest));
  };

  // D11e：全網。每個支線組的班次，都必須真的走進「這條支線專屬」的區間（＝該線有、任何幹線
  // 都沒有的站）。只借道共構段的幹線車走不到那裡，就會被咬住。
  const trunkStations = trunkStationsAll;   // 與 D11a/D11d 同一份，避免同一個量算兩次而分岔
  const own = new Map(), branchIds = [];
  for (const ln of (state.trackLines || [])) {
    const set = new Set((ln.stations || []).map(x => norm(x.name)));
    own.set(ln.id, set);
    if (boardLineLatSpan(ln) < BOARD_TRUNK_LAT_SPAN) branchIds.push(ln.id);
  }
  // 兩站都在幹線上的短連絡線（成追線）結構上沒有專屬區間，這條判準對它驗不到——列成豁免，
  // 並在 D11f 斷言豁免清單恰好是誰，免得清單無聲長大把整條判準吃掉。
  // 🔴 只在【支線】裡挑：幹線的站當然全在 trunkStations 裡，把它們算進來會讓豁免清單失去意義。
  const noExclusive = branchIds.filter(id => [...own.get(id)].every(n => trunkStations.has(n)));
  const bad = [], covered = new Set();
  for (const tr of state.trains) {
    const st = tr.stops;
    for (let i = 0; i + 1 < st.length; i++) {
      if (st[i].stop === false) continue;
      const g = boardGroupOf(tr, i, false);
      if (g.kind !== 'branch' || noExclusive.includes(g.lnId)) continue;
      covered.add(g.lnId);
      const set = own.get(g.lnId) || new Set();
      if (!st.some(x => set.has(norm(x.name)) && !trunkStations.has(norm(x.name))))
        bad.push(st[i].name + ' ' + tr.no + ' 往' + norm(st[st.length - 1].name) + ' → ' + g.lnId);
    }
  }
  return { hsinchu, beihsinchu, branchOf: branchOf(hsinchu), beiBranch: branchOf(beihsinchu),
    hsinchuAll: allBranchDests('新竹'), beiAll: allBranchDests('北新竹'),
    trunkOnly: [...trunkOnly], bad: bad.slice(0, 6), nBad: bad.length,
    nCovered: covered.size, noExclusive };
});
const trunkOnlySet = new Set(d11.trunkOnly);
const strayOf = list => [...new Set((list || []).filter(d => trunkOnlySet.has(d)))];
ok('D11a 新竹的支線組不得出現「只能搭縱貫線到達」的終點（issue #46 的病灶；掃整組不套配額）',
  (d11.hsinchuAll || []).length > 0 && strayOf(d11.hsinchuAll).length === 0,
  `${(d11.hsinchuAll || []).length} 列，混進來的終點：` + JSON.stringify(strayOf(d11.hsinchuAll)));
ok('D11b 正向對照：新竹確實畫得出支線組且組內有班次（否則 D11a 恆真空過）',
  d11.branchOf.length > 0 && d11.branchOf.flatMap(g => g.dests).length > 0,
  JSON.stringify(d11.branchOf.map(g => g.label)));
const hsinchuNb = d11.hsinchu.find(g => g.label === '北上');
ok('D11c 反向對照：新竹「北上」組確實收得到縱貫線終點（修法沒把那些車弄不見）',
  !!hsinchuNb && hsinchuNb.dests.some(d => trunkOnlySet.has(d)),
  JSON.stringify(hsinchuNb && hsinchuNb.dests));
ok('D11d 北新竹（共構段另一頭）的支線組同樣不得混進縱貫線的車（掃整組不套配額）',
  (d11.beiAll || []).length > 0 && strayOf(d11.beiAll).length === 0,
  `${(d11.beiAll || []).length} 列，混進來的終點：` + JSON.stringify(strayOf(d11.beiAll)));
ok('D11e 全網：支線組的每一班都必須真的走進該支線的專屬區間',
  d11.nBad === 0, `${d11.nBad} 列，例：` + JSON.stringify(d11.bad));
ok('D11f 覆蓋率具名斷言：D11e 真的驗到多條支線，且豁免清單恰為成追線（兩站都在幹線上，結構上驗不到）',
  d11.nCovered >= 5 && d11.noExclusive.length === 1 && d11.noExclusive[0] === 'chengzhui',
  `covered=${d11.nCovered} 豁免=${JSON.stringify(d11.noExclusive)}`);

// ── D7 捷運看板零回歸：它走 renderFreqBoard，不該長出方向組 ─────────
const metro = await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
  return true;
});
await p.waitForTimeout(2500);
const metroBoard = await p.evaluate(() => {
  const ln = (state.lines || [])[0]; const st = ln && (ln.stations || [])[1];
  if (!st) return { err: '沒有捷運站' };
  state.boardStation = st; renderBoard();
  const el = document.getElementById('board');
  return { bgrp: el.querySelectorAll('.bgrp').length, rows: el.querySelectorAll('.row').length };
});
ok('D7 捷運看板不受影響（零方向組、仍有班次列）',
  metroBoard.bgrp === 0 && metroBoard.rows > 0, JSON.stringify(metroBoard));

// ── D8 外語：新字串要有譯文，不得漏字典（反向對照＝畫面不得出現中文原文）──
const en = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const ep = await en.newPage();
await ep.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await ep.goto(TARGET + (TARGET.includes('?') ? '&' : '?') + 'lang=en', { waitUntil: 'domcontentloaded' });
await ep.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await ep.waitForTimeout(2500);
const enLabels = await ep.evaluate(() => {
  const st = (state.schedStations || []).find(s => s.name === '竹南' && s.sys === 'tra_sched');
  state.boardStation = st; renderBoard();
  return [...document.getElementById('board').querySelectorAll('.bgrp')].map(n => n.textContent);
});
ok('D8a 英文語系有 Southbound／Northbound',
  enLabels.some(l => l.includes('Southbound')) && enLabels.some(l => l.includes('Northbound')), JSON.stringify(enLabels));
ok('D8b 英文語系的組標題不得殘留中文（反向對照：線名也要有譯文）',
  enLabels.length > 0 && !enLabels.some(l => /[一-鿿]/.test(l)), JSON.stringify(enLabels));
await en.close();

ok('D9 全程零 pageerror', pageErrors.length === 0, JSON.stringify(pageErrors));

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass}／${pass + fail}`);
// MUTATIONS（在隔離 worktree 改 index.html 後重跑，確認紅在預期那幾項、其餘維持綠；改完務必還原並再跑一次全綠）：
//   M1 BOARD_TRUNK_LAT_SPAN 改成 0        → 支線被當幹線 ⇒ D1b/D1c 與 D4 轉紅
//   M2 BOARD_TRUNK_LAT_SPAN 改成 9        → 幹線被當支線 ⇒ D1a 與 D2a/D3a 轉紅
//   M3 boardGroupLabel 的 sameDir 門檻 2→9 → 同方向多幹線不補線名 ⇒ D3a 轉紅
//   M4 perGroup 改成 rows.length          → 逐組配額失效 ⇒ D5a/D5b 轉紅
//   M5 拿掉 .bgrp.dir-n/.dir-s 兩條 CSS    → 方向色消失 ⇒ D6a/D6b 轉紅
//   M6 boardGroupOf 一律回同一個 key      → 全部併成一組 ⇒ D2a/D3a/D3c 轉紅
//   M7 刪掉 i18n 的 '南下' 鍵             → 英文殘留中文 ⇒ D8a/D8b 轉紅
//   M8 BOARD_ARRIVE_MAX_SEC 改成 10800   → 60 分上限失效 ⇒ D10a/D10d 轉紅
//   M9 boardGroupOf 的 boardDecidingSeg(tr, i) 改回 tr.stops[i]
//                                        → 共構段又決定線別 ⇒ D11a/D11d/D11e 轉紅（issue #46 回歸）
//   M10 boardDecidingSeg 只刪掉【往後找】那一圈
//                                        → 在本站終到的車失去來時路證據 ⇒ D11d/D11e 轉紅、D11a 仍綠
process.exit(fail ? 1 : 0);

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
    return { label: n2.textContent, rows: c, cls: n2.className, color: cs.color };
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
process.exit(fail ? 1 : 0);

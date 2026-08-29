// 手動營運公告(CURATED_NOTICES)是否真的送到該看見的那個分頁——Playwright chromium。
// 為什麼要有這支:2026-08-29 加高鐵那則公告時才發現,activeAlertList() 判「sched 模式看得到
// 哪幾家」用的是 state.sysId,而那顆在 loadSchedGroup/loadAllGroup 裡恆等於 list[0].id
// (收藏與成就沿用的主系統 key,台鐵),與群內實際勾了哪幾家無關 ⇒ 掛 thsr_sched 的公告
// 在「國家鐵路」與「全台同框」兩個群組永遠不顯示,而它在只有高鐵一家的 hsr 群組又剛好會顯示,
// 所以單測 hsr 分頁是綠的。判準因此一律「同一群組、只差勾選狀態」成對驗(該出現／該消失)。
//
// 每則公告都有 from/until 有效期,過期後整支測試會變成空過——G0 就是那道分母閘門。
// 尾端跑一次突變控制組(把 visSys 換回舊寫法),確認咬得到的正是 G2/G9 而不是別的。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5231);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const INDEX = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// 兩個突變:①原始寫法(sched 模式只看裝飾層,沒開裝飾層就是空集合)
//           ②中途那個看似對的修法(改用 state.sysId)——它在只有高鐵一家的 hsr 群組會過,
//             唯獨在 nat／all 這種「sysId 恆等於 list[0]」的群組漏掉,正是本次要防的形態。
const MUT_LEGACY = `  const visSys = state.mode === 'sched'
    ? (state.deco ? new Set((state.decoLines || []).map(freqSysIdOf)) : new Set())
    : (state.freqSel || new Set(state.sysId ? [state.sysId] : []));`;
const MUT_SYSID = `  const visSys = state.mode === 'sched'
    ? new Set([...(state.sysId ? [state.sysId] : []),
        ...(state.deco ? (state.decoLines || []).map(freqSysIdOf) : [])])
    : (state.freqSel || new Set(state.sysId ? [state.sysId] : []));`;
const NEW_VIS_RE = /  const visSys = state\.mode === 'sched'\n    \? new Set\(\[\.\.\.\(state\.schedSel[\s\S]*?\n    : \(state\.freqSel \|\| new Set\(state\.sysId \? \[state\.sysId\] : \[\]\)\);/;
if (!NEW_VIS_RE.test(INDEX)) { console.error('FAIL 找不到 visSys 現行寫法——突變控制組無法建立,測試不算數'); process.exit(1); }
const MUTANTS = { legacy: INDEX.replace(NEW_VIS_RE, MUT_LEGACY), sysid: INDEX.replace(NEW_VIS_RE, MUT_SYSID) };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('no api in verify'); }
  const mut = /^\/mutant-([a-z]+)\.html$/.exec(url.pathname);
  if (mut) {
    if (!MUTANTS[mut[1]]) { res.statusCode = 404; return res.end('no such mutant'); }
    res.setHeader('content-type', 'text/html'); return res.end(MUTANTS[mut[1]]);
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}/`;

const browser = await chromium.launch();

// 三則公告各用一段夠獨特的字辨識(對 #alertDetail 的實際文字,不是對 JS 物件)
const MARK = {
  thsr: '台中車站軌道大修',
  sanying: '三鶯線 9/1 起正式收費',
  mrt: '廣慈/奉天宮',
};

async function runSuite(pageFile) {
  const results = [];
  const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); return pass; };
  // 🔴 語言要釘死成繁中:Playwright 預設 locale 是 en-US,頁面會自動切英文,
  // 分頁短標變 All/TRA/HSR/Metro、公告字串走 t() ⇒ 對中文字面的比對全部照不到(整支假紅)。
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
  await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-language', 'zh');
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  const boot = async (query) => {
    await page.goto(base + pageFile + (query || ''), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 40000 });
    await page.waitForTimeout(400);
  };
  // 公告詳情:走真實入口(點橫幅/晶片),不直接呼叫 renderAlertDetail
  const detailText = async () => {
    await page.evaluate(() => {
      const det = document.getElementById('alertDetail');
      if (det && det.hidden) {
        const b = document.getElementById('alertBanner');
        const chip = document.getElementById('alertChip');
        if (b && !b.hidden) b.click(); else if (chip && !chip.hidden) chip.click();
      }
    });
    await page.waitForTimeout(120);
    return page.evaluate(() => {
      const det = document.getElementById('alertDetail');
      return (det && !det.hidden) ? det.innerText : '';
    });
  };
  const clickTab = async (short) => {
    await page.evaluate((s) => {
      const b = [...document.querySelectorAll('#systems .gtab')].find(x => x.textContent.trim() === s);
      if (!b) throw new Error('找不到分頁 ' + s);
      b.click();
    }, short);
    await page.waitForTimeout(600);
  };
  const clickMember = async (id) => {
    await page.evaluate((i) => {
      const b = document.querySelector('#systems .mem[data-id="' + i + '"]');
      if (!b) throw new Error('找不到成員鈕 ' + i);
      b.click();
    }, id);
    await page.waitForTimeout(600);
  };

  await boot('');
  const lang = await page.evaluate(() => document.documentElement.lang || 'zh');
  ok('G0a 頁面是中文(公告字串未被翻譯層換掉,下面的字面比對才有效)', /^zh/.test(lang), `lang=${lang}`);

  // 分母閘門:三則公告今天都在有效期內,否則整支測試是空過的
  const win = await page.evaluate(() => {
    const today = todayStr('Asia/Taipei');
    return { today, rows: CURATED_NOTICES.map(n => ({ sys: n.sys, title: n.title, live: today >= n.from && today <= n.until })) };
  });
  ok('G0b 三則公告今天都在有效期內(分母不為空)', win.rows.length >= 3 && win.rows.every(r => r.live),
    `今天 ${win.today}｜` + win.rows.map(r => `${r.sys}:${r.live ? '有效' : '過期'}`).join(' '));

  const seen = new Set();
  const check = (label, text, want, notWant) => {
    const has = k => text.includes(MARK[k]);
    const good = want.every(has) && notWant.every(k => !has(k));
    want.forEach(k => { if (has(k)) seen.add(k); });
    return ok(label, good, want.map(k => `${k}=${has(k) ? '有' : '無'}`).concat(notWant.map(k => `!${k}=${has(k) ? '有(不該有)' : '無'}`)).join(' '));
  };

  // 高鐵單獨分頁
  await clickTab('高');
  check('G1 高鐵分頁看得到高鐵公告,且看不到捷運那兩則', await detailText(), ['thsr'], ['sanying', 'mrt']);

  // 國家鐵路(台鐵＋高鐵＋林鐵同框):sysId 恆為 tra_sched,舊碼在這裡會漏掉高鐵公告
  await boot('?g=nat');
  const natSel = await page.evaluate(() => [...(state.schedSel || [])]);
  ok('G2a 國家鐵路群組確實同時載了高鐵(前置條件)', natSel.includes('thsr_sched'), `schedSel=${natSel.join(',')}`);
  check('G2 國家鐵路同框(勾了高鐵)看得到高鐵公告', await detailText(), ['thsr'], []);

  // 正向對照:同一群組,只把高鐵取消勾選,其餘輸入完全相同
  await clickMember('thsr_sched');
  const natSel2 = await page.evaluate(() => [...(state.schedSel || [])]);
  ok('G3a 取消勾選後高鐵真的不在 schedSel(對照組成立)', !natSel2.includes('thsr_sched'), `schedSel=${natSel2.join(',')}`);
  check('G3 同群組取消勾選高鐵後,高鐵公告消失', await detailText(), [], ['thsr']);

  // 台鐵分頁(群內沒有高鐵)
  await clickTab('台');
  check('G4 台鐵分頁看不到高鐵公告', await detailText(), [], ['thsr']);

  // 北部捷運:三鶯線與台北捷運
  await boot('?g=north');
  const fs1 = await page.evaluate(() => [...(state.freqSel || [])]);
  ok('G5a 北部捷運群組預設勾了三鶯線與台北捷運(前置條件)', fs1.includes('sanying') && fs1.includes('mrt'), `freqSel=${fs1.join(',')}`);
  check('G5 北部捷運看得到三鶯線公告與信義東延段公告,且看不到高鐵那則', await detailText(), ['sanying', 'mrt'], ['thsr']);

  await clickMember('sanying');
  const fs2 = await page.evaluate(() => [...(state.freqSel || [])]);
  ok('G6a 取消勾選後三鶯線真的不在 freqSel(對照組成立)', !fs2.includes('sanying'), `freqSel=${fs2.join(',')}`);
  check('G6 取消勾選三鶯線後,三鶯線公告消失而信義東延段仍在', await detailText(), ['mrt'], ['sanying']);

  // 全台同框:sched＋裝飾層,兩邊的公告都該看得到
  await boot('?g=all');
  check('G7 全台同框同時看得到高鐵、三鶯線與信義東延段三則', await detailText(), ['thsr', 'sanying', 'mrt'], []);

  ok('G8 三則公告在本輪各至少被驗到出現一次(覆蓋率,分母不會無聲縮水)',
    ['thsr', 'sanying', 'mrt'].every(k => seen.has(k)), `驗到 ${[...seen].join(',')}／共 3`);
  ok('G9 全程無 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  await ctx.close();
  return results;
}

const real = await runSuite('index.html');
const mLegacy = await runSuite('mutant-legacy.html');
const mSysid = await runSuite('mutant-sysid.html');
await browser.close();
server.close();

for (const r of real) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
const realFail = real.filter(r => !r.pass);

// 突變控制組:每個突變都要「恰好」咬到指定那幾條——多咬到與少咬到都算判準沒對準。
// 🔴 指名考哪一條:sysid 那顆的意義全在「G1 仍綠、G2/G7 轉紅」,它證明 G2/G7 不是靠 G1 順便抓到的。
const reds = rs => new Set(rs.filter(r => !r.pass).map(r => r.name.split(' ')[0]));
const ALL = ['G0a', 'G0b', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'];
const teethCheck = (label, rs, wantRed) => {
  const got = reds(rs);
  const pass = wantRed.every(k => got.has(k)) && ALL.filter(k => !wantRed.includes(k)).every(k => !got.has(k));
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label} — 期望轉紅 ${wantRed.join('/')}；實際 ${[...got].join(',') || '無'}`);
  return pass;
};
const t1 = teethCheck('M1 突變①原始寫法(sched 一律空集合)', mLegacy, ['G1', 'G2', 'G7', 'G8']);
// M2 不列 G8:sysid 那顆在 hsr 分頁仍會顯示高鐵公告,三則各被驗到過一次的覆蓋率本來就仍成立
// ——G8 管的是「分母沒縮水」,不是「每個群組都對」,那是 G2/G7 的職責。
const t2 = teethCheck('M2 突變②改用 state.sysId(高鐵單獨分頁仍綠,同框漏掉)', mSysid, ['G2', 'G7']);
const teeth = t1 && t2;

const total = real.length + 2, fails = realFail.length + (t1 ? 0 : 1) + (t2 ? 0 : 1);
console.log(`\n${fails ? 'FAIL' : '總計'} ${total - fails}/${total} 通過`);
process.exit(fails ? 1 : 0);

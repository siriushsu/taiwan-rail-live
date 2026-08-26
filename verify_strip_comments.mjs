// 去註解出貨檔的 A/B 驗收：原版(index_orig.html) vs 去註解版(index.html) 並排開，比行為。
// 跑法：先在本 worktree 起 static server，然後 STRIP_BASE=http://127.0.0.1:<port> node verify_strip_comments.mjs
//
// 判準刻意不比「列車數」這種即時值（每次載入都不同，比了只會假紅）。比的是：
//  A. 兩版都零 pageerror／零 console error（去註解砍到程式碼的話這裡會爆）
//  B. 兩版都真的 boot 完成（#count 有值＝班表算完、車畫出來）
//  C. 結構指紋逐項相同（工具列鈕 id 清單、說明中心節數、更新紀錄條數、關鍵元素的 computed style）
//  D. 去註解版真的沒有註解了，而 App build 錨點與法律署名還在
//
// 控制組：每一項都對「原版」也量一次。只有「原版過、去註解版沒過」才算回歸；
// 兩版一起紅＝本來就紅，不是這次改的（心得 34：紅有三種互斥原因）。
import { chromium, webkit } from 'playwright';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STRIP_BASE || 'http://127.0.0.1:8931';

// 控制組自己生，不靠人記得手動 cp——忘了 cp 的話兩邊都會 404，
// 而「兩版一起紅」看起來跟「本來就紅」一模一樣（心得 34：紅有三種互斥原因要分得開）。
// 基準取 git HEAD 的 index.html＝還沒去註解的原始碼，這也順便證明控制組真的是「改動前那份」。
const ORIG = ROOT + '/index_orig.html';
writeFileSync(ORIG, execFileSync('git', ['show', 'HEAD:index.html'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
process.on('exit', () => { try { rmSync(ORIG); } catch (e) {} });
const res = [];
const chk = (g, cond, msg) => { res.push({ g, pass: !!cond }); console.log(`  ${cond ? 'PASS' : 'FAIL'} ${g} ${msg}`); };

async function probe(engine, file) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 180)));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  let booted = false;
  try {
    await p.goto(`${BASE}/${file}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { const c = document.getElementById('count'); return c && c.textContent.trim().length > 0; }, { timeout: 45000 });
    booted = true;
  } catch (e) { errs.push('boot: ' + String(e).slice(0, 160)); }
  // 結構指紋：全部與即時資料無關。刻意不用「數量>0」這種弱判準——每一項都要能列出**內容**，
  // 否則兩版一起壞成 0 也會全綠（第一版的 helpSections/groupTabs 就是這樣，兩版都 0＝沒有牙）。
  const fp = booted ? await p.evaluate(() => {
    const ids = sel => [...document.querySelectorAll(sel)].map(b => b.id || b.className || b.textContent.trim().slice(0, 6)).join(',');
    const cs = (sel, ...props) => { const e = document.querySelector(sel); if (!e) return 'MISSING'; const s = getComputedStyle(e); return props.map(k => s[k]).join('|'); };
    // 真的把說明中心叫出來：這一步會跑 HELP_GROUPS 渲染、needs/avail 過濾與 escHtml，
    // 是「去註解沒砍到程式碼」最有力的行為證據（比數 DOM 節點有意義得多）。
    let helpSections = 'openHelp-missing';
    try {
      if (typeof openHelp === 'function') {
        openHelp();
        const hb = document.getElementById('helpBody');
        // 取「渲染出什麼」而不是「有幾個」：內容變了、渲染壞了、節被旗標吃掉了，這串都會變。
        // 先前寫成 `#helpBody h3` 的數量，兩版都回 0（節標題不是 h3）＝那條判準沒有牙。
        helpSections = hb ? [...hb.children].map(c => c.tagName + '.' + (c.className || '-')).join(',') + '#chars=' + hb.textContent.length : 'no-helpBody';
      }
    } catch (e) { helpSections = 'THREW:' + e.message; }
    return {
      stageTools: ids('.stage-tools button'),
      grpItems: ids('.grp'),
      helpSections,
      changelogItems: document.querySelectorAll('[data-cl]').length,
      topbar: cs('.tb-plate', 'fontSize', 'flexGrow', 'display'),
      controls: cs('.controls', 'overflowX', 'zIndex'),
      hasMap: !!document.querySelector('.leaflet-container'),
      buildStamp: (document.body.innerHTML.match(/v0\d{3}[a-z]/) || [])[0] || null,
    };
  }) : null;
  await browser.close();
  return { errs, booted, fp };
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n── ${name} ──`);
  const orig = await probe(engine, 'index_orig.html');
  const strip = await probe(engine, 'index.html');

  chk(`A1-${name}`, orig.errs.length === 0, `原版(控制組) 錯誤數 ${orig.errs.length} ${orig.errs.slice(0, 2).join(' / ')}`);
  chk(`A2-${name}`, strip.errs.length === 0, `去註解版 錯誤數 ${strip.errs.length} ${strip.errs.slice(0, 2).join(' / ')}`);
  chk(`B1-${name}`, orig.booted, '原版(控制組) boot 完成');
  chk(`B2-${name}`, strip.booted, '去註解版 boot 完成');

  if (orig.fp && strip.fp) {
    for (const k of Object.keys(orig.fp)) {
      const a = JSON.stringify(orig.fp[k]), b = JSON.stringify(strip.fp[k]);
      chk(`C-${name}-${k}`, a === b, `${k}  ${a === b ? String(a).slice(0, 60) : `原版=${String(a).slice(0, 50)} vs 去註解=${String(b).slice(0, 50)}`}`);
    }
  } else chk(`C-${name}`, false, '指紋取不到（有一版沒 boot 起來）');
}

// D. 檔案層斷言
const now = readFileSync(ROOT + '/index.html', 'utf8');
const before = readFileSync(ORIG, 'utf8');
const jsLineComments = s => (s.match(/(?<=\n)\s*\/\/[^\n]*/g) || []).length;
chk('D1', jsLineComments(now) < jsLineComments(before) * 0.02, `行註解 ${jsLineComments(before)} → ${jsLineComments(now)}`);
chk('D2', (now.match(/<!-- APP_(REPLACE|STRIP)_(START|END)/g) || []).length === (before.match(/<!-- APP_(REPLACE|STRIP)_(START|END)/g) || []).length,
  `App build 錨點數量不變 (${(now.match(/<!-- APP_(REPLACE|STRIP)_(START|END)/g) || []).length})`);
chk('D3', now.includes('臺灣輪廓：內政部') && now.includes('OpenStreetMap'), '法律署名仍在');
// D4/D5 刻意不寫死「要縮小幾 %」——那種魔術數字下次改文案就被推翻（心得 35）。
// 判準改成「該不見的真的不見了、該留的一個沒少」，體積只印出來供人看。
const blockComments = s => (s.match(/\/\*[\s\S]*?\*\//g) || []).length;
chk('D4', now.length < before.length, `體積 ${before.length.toLocaleString()} → ${now.length.toLocaleString()}（省 ${((before.length - now.length) / before.length * 100).toFixed(1)}%）`);
chk('D5', blockComments(now) < blockComments(before) * 0.05, `區塊註解 ${blockComments(before)} → ${blockComments(now)}`);
chk('D6', now.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter(l => /^\s*\/\//.test(l)).length === 0, '出貨檔沒有任何整行 JS 註解');

const fail = res.filter(r => !r.pass);
console.log(`\n總計 ${res.length - fail.length}/${res.length} 通過`);
if (fail.length) { console.log('FAILED: ' + fail.map(f => f.g).join(', ')); process.exit(1); }

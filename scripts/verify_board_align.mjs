// 車站看板欄位對齊驗收(使用者 2026-08-31:「擁擠度跟時間,會因為最後面倒數那邊時間會變成
// 『即將進站』而擠壓到,變成歪掉」;同一則裁示的後半:「如果特大字的時候需要精簡,就精簡
// 後面進站那邊」)。
//
// 為什麼要有這一支:修法本身是「量出全板最寬那一列、寫進 CSS 變數」,而它會壞在兩種
// 完全不會拋錯的形態——(1) 有人把 .min／.t 的 width 拿掉或改回寫死的 em,版面靜靜歪掉;
// (2) 特大字級那兩條 attr() 換字樣的 CSS 被別的重構掃掉,倒數欄默默變回 78px 把車次擠出去。
// 兩種都是「看起來還在跑」,只有量幾何才抓得到。
//
// 判準寫「怎麼排」不寫「幾 px」(魔術數字會被下一次改文案推翻):
//   G1 同一張板裡 .t(時刻)寬度逐列相同——被 flex 壓縮就會不同
//   G2 .t 右緣、.min 左緣逐列相同;有擁擠度的列彼此右緣也相同
//   G3 沒有任何一列橫向溢出看板內容盒
//   S3 特大字級:畫面上看到的是短字、欄真的變窄(對照組=同樣特大但拆掉精簡)、標準字級不動
// 每條都配突變對照(拆掉修法必須轉紅),否則判準沒有牙。
//
// 用法:node scripts/verify_board_align.mjs   (BOARDALIGN_ENGINES=chromium 只跑單引擎)
// 退出碼:0＝全過;1＝有判準紅;2＝跑不起來(G0 自檢不過)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// ── G0 自檢:先證明我在量的是誰(驗到別棵樹一樣全綠的話,這支等於裝飾) ──────────
const SRC = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log(`目標 ROOT = ${ROOT}`);
for (const [frag, why] of [
  ['function boardAlignColumns(', '逐板量欄寬的函式'],
  ["el.style.setProperty('--min-col'", '倒數欄寬寫進 CSS 變數'],
  ["el.style.setProperty('--t-col'", '時刻欄寬寫進 CSS 變數'],
  ['width: var(--min-col, auto)', '.min 真的吃那個變數'],
  ['width: var(--t-col, auto)', '.t 真的吃那個變數'],
  ['html[data-fs=xlarge] .board .row .min[data-soon]', '特大字級的精簡'],
  ['content: attr(data-soon)', '精簡用 attr() 換字樣'],
]) if (!SRC.includes(frag)) {
  console.error(`❌ [G0] 這份 index.html 沒有「${why}」(${frag})——驗錯目標,或改動沒落地`);
  process.exit(2);
}
console.log('[G0] 七項機制都在這份檔裡');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // /api/* 回 404 而不是空 200:回「成功但空」會讓前端以為拿到了而不走 data/*.json 退路,
  // boot 拋錯 ⇒ 等不到 state.ready ⇒ 全部逾時(與 verify_train_overlap_pick 同一個坑)。
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end('{"error":"stubbed"}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));            // 埠交給 OS:硬編埠會撞到其他 worktree 的 server
const BASE = `http://localhost:${server.address().port}`;

// 🔴 語系釘死。下面所有判準都靠中文字串(「即將進站」)認那一列,而 playwright 的 chromium
//    預設 navigator.language=en-US ⇒ 整組 S3 會拿到 Arriving 而空轉。兩道一起下:
//    context locale ＋ 網址 ?lang=zh-TW(index.html 自己的最高優先開關),另加 G-lang 具名閘門。
const PAGE_LOCALE = 'zh-TW';
const VIEWPORTS = [{ tag: '桌面1280', width: 1280, height: 900 }, { tag: '手機390', width: 390, height: 844 }];
const ENGINES = Object.entries({ chromium, webkit })
  .filter(([n]) => !process.env.BOARDALIGN_ENGINES || process.env.BOARDALIGN_ENGINES.split(',').includes(n));

const results = [];
const ok = (n, pass, d = '') => { results.push({ n, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

const measure = () => {
  const el = document.getElementById('board');
  if (!el || el.hidden) return null;
  const box = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const inner = { left: box.left + parseFloat(cs.paddingLeft), right: box.right - parseFloat(cs.paddingRight) };
  const rows = [...el.querySelectorAll('.row')].map(r => {
    const g = sel => { const n = r.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return { l: +b.left.toFixed(2), r: +b.right.toFixed(2), w: +b.width.toFixed(2) }; };
    const rb = r.getBoundingClientRect();
    const mn = r.querySelector('.min');
    return { txt: r.textContent.replace(/\s+/g, ' ').trim(), t: g('.t'), min: g('.min'), crowd: g('.crowd'),
             minTxt: mn ? mn.textContent.trim() : '',
             // 畫面上真正看到的字:特大時本體 font-size:0,字在 ::after。textContent 在那裡會說謊。
             minShown: (() => {
               if (!mn) return '';
               if (parseFloat(getComputedStyle(mn).fontSize) > 0) return mn.textContent.trim();
               const c = getComputedStyle(mn, '::after').content;
               return (c && c !== 'none' ? c.replace(/^["']|["']$/g, '') : '').trim();
             })(),
             left: +rb.left.toFixed(2), right: +rb.right.toFixed(2), scrollW: r.scrollWidth, clientW: r.clientWidth };
  });
  return { inner: { left: +inner.left.toFixed(2), right: +inner.right.toFixed(2) }, minCol: el.style.getPropertyValue('--min-col'), rows };
};

// 官方 ETA 列＋班表退路列同框(使用者實際看到的那張板:三種列寬混在一起)
const injectOfficial = () => {
  const now = Math.floor(Date.now() / 1000);
  applyTrtcOfficialBoard([
    { name: '忠孝復興', dest: '頂埔', eta: now + 30, at: now, no: 'A101' },
    { name: '忠孝復興', dest: '頂埔', eta: now + 300, at: now, no: 'A102' },
    { name: '忠孝復興', dest: '南港展覽館', eta: now + 120, at: now, no: 'A103' },
  ], Date.now(), [{ no: 'A101', cars: [1, 2, 3, 4, 2, 1] }, { no: 'A103', cars: [3, 3, 2, 1] }]);
  let target = null;
  for (const ln of state.lines) for (const s of (ln.stations || [])) if (s.name === '忠孝復興') { target = s; break; }
  openBoard(target);
};

function judge(m) {
  if (!m || m.rows.length < 2) return null;
  const eq = (a, b) => Math.abs(a - b) <= 0.5;
  const same = a => a.length < 2 || a.every(v => eq(v, a[0]));
  const sp = a => a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(2) : 0;
  const tW = m.rows.filter(r => r.t).map(r => r.t.w);
  const tR = m.rows.filter(r => r.t).map(r => r.t.r);
  const minL = m.rows.filter(r => r.min).map(r => r.min.l);
  const crR = m.rows.filter(r => r.crowd).map(r => r.crowd.r);
  return {
    g1: same(tW), g2: same(tR) && same(minL) && same(crR),
    g3: m.rows.every(r => r.right <= m.inner.right + 0.5 && r.scrollW <= r.clientW + 0.5),
    detail: `列=${m.rows.length} 擁擠列=${crR.length} t寬散佈=${sp(tW)} t右緣散佈=${sp(tR)} min左緣散佈=${sp(minL)} 擁擠右緣散佈=${sp(crR)} --min-col=${m.minCol || '(未設)'} 倒數字樣=${[...new Set(m.rows.map(r => r.minTxt))].join('/')}`,
  };
}

// 判準用【外部常數】:這兩個字串是產品文案,不是從實作推導出來的(判準與實作同源會集體失明)。
const LONG_MIN = new Set(['即將進站', '列車進站']);
const longMin = r => r.min && LONG_MIN.has(r.minTxt);

for (const [engName, engine] of ENGINES) {
  const browser = await engine.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: PAGE_LOCALE });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}   // 首訪教學卡會蓋住看板
    });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}/?g=metro&lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return state && state.ready && (state.lines || []).length > 0; } catch (e) { return false; } }, null, { timeout: 45000 });
    const tag = `[${engName}·${vp.tag}]`;
    ok(`${tag} 開機無例外`, errs.length === 0, errs.slice(0, 2).join(' | '));
    // 具名語系閘門:語系再飄一次要紅在這一條,而不是散落在下面十幾條互相矛盾的判準上。
    const langOk = await page.evaluate(() => t('即將進站') === '即將進站' && t('{n} 分', { n: 3 }, 3) === '3 分');
    ok(`${tag} G-lang 這一頁真的是中文`, langOk, `t('即將進站')=${await page.evaluate(() => t('即將進站'))}`);

    const run = (mutate = null) => page.evaluate(({ inj, fn, mut }) => {
      let undo = null;
      if (mut) undo = eval('(' + mut + ')')();
      eval('(' + inj + ')')();
      const out = eval('(' + fn + ')')();
      if (undo) undo();
      return out;
    }, { inj: injectOfficial.toString(), fn: measure.toString(), mut: mutate && mutate.toString() });

    const v = judge(await run());
    ok(`${tag} S2 前提:官方 ETA 列與班表退路列同框`, !!v && v.detail.includes('擁擠列=3'), v && v.detail);
    ok(`${tag} S2·G1 時刻欄逐列等寬`, !!v && v.g1, v && v.detail);
    ok(`${tag} S2·G2 時刻/倒數/擁擠度逐列同一欄`, !!v && v.g2, v && v.detail);
    ok(`${tag} S2·G3 沒有列橫向溢出`, !!v && v.g3, v && v.detail);

    // ── S1:自然情境——找一張同時有「即將進站」與「N 分」的板(使用者說的那種擠壓) ──
    const hit = await page.evaluate(() => {
      const seen = new Set();
      for (const ln of state.lines) for (const s of (ln.stations || [])) {
        if (seen.has(s.name)) continue; seen.add(s.name);
        openBoard(s);
        const mins = [...document.querySelectorAll('#board .row .min')].map(n => n.textContent.trim());
        if (mins.length >= 2 && mins.some(x => x === '即將進站' || x === '列車進站') && mins.some(x => /^\d+ 分$/.test(x))) return { name: s.name, mins };
      }
      return null;
    });
    ok(`${tag} S1 前提:找得到「即將進站」與「N 分」同板`, !!hit, hit && `${hit.name}(${hit.mins.join('/')})`);

    const runAt = (name, fs, mutate = null) => page.evaluate(({ name, fn, mut, fs }) => {
      let undo = null;
      if (mut) undo = eval('(' + mut + ')')();
      const prev = document.documentElement.getAttribute('data-fs');
      if (fs === 'std') document.documentElement.removeAttribute('data-fs');
      else if (fs) document.documentElement.setAttribute('data-fs', fs);
      let target = null;
      for (const ln of state.lines) for (const s of (ln.stations || [])) if (s.name === name) { target = s; break; }
      openBoard(target);
      const out = eval('(' + fn + ')')();
      if (prev === null) document.documentElement.removeAttribute('data-fs');
      else document.documentElement.setAttribute('data-fs', prev);
      if (undo) undo();
      return out;
    }, { name, fn: measure.toString(), mut: mutate && mutate.toString(), fs });

    if (hit) {
      const v1 = judge(await runAt(hit.name, null));
      ok(`${tag} S1·G1 時刻欄逐列等寬`, !!v1 && v1.g1, v1 && v1.detail);
      ok(`${tag} S1·G2 時刻/倒數逐列同一欄`, !!v1 && v1.g2, v1 && v1.detail);
      ok(`${tag} S1·G3 沒有列橫向溢出`, !!v1 && v1.g3, v1 && v1.detail);
      // 突變 A 放在 S1(那裡的倒數字樣長短真的不同,突變才有牙)
      const va = judge(await runAt(hit.name, null, () => {
        const st = document.createElement('style');
        st.textContent = '.board .row .min { width: auto !important; }';
        document.head.appendChild(st);
        return () => st.remove();
      }));
      ok(`${tag} S1 突變A(倒數欄不等寬) G2 必須紅`, !!va && !va.g2, va && va.detail);

      // ── S3:特大字級把倒數欄精簡(使用者:「特大字的時候…精簡後面進站那邊」) ──
      // 🔴 用 S1 這張自然板,不用 S2 的注入板——注入板的倒數是官方秒級的「0:30／5:00」,
      //    拿長度當判準會量到不相干的列而整組空轉(第一版就是這樣全紅)。
      const KILL_SOON = () => {
        const st = document.createElement('style');
        st.textContent = 'html[data-fs=xlarge] .board .row .min[data-soon] { font-size: inherit !important; }'
                       + 'html[data-fs=xlarge] .board .row .min[data-soon]::after { content: none !important; }';
        document.head.appendChild(st);
        return () => st.remove();
      };
      const mStd = await runAt(hit.name, 'std');
      const mXL = await runAt(hit.name, 'xlarge');
      const mXLk = await runAt(hit.name, 'xlarge', KILL_SOON);   // 特大但拆掉精簡
      const soonRows = (mXL ? mXL.rows : []).filter(longMin);
      ok(`${tag} S3 前提:板上真的有「即將進站」這種長倒數`, soonRows.length > 0,
         mXL && [...new Set(mXL.rows.map(r => r.minTxt))].join('/'));
      ok(`${tag} S3a 特大時看到的是短字`,
         soonRows.length > 0 && soonRows.every(r => r.minShown && r.minShown.length <= 2 && r.minShown !== r.minTxt),
         soonRows.map(r => `${r.minTxt}→${r.minShown}`).join(' '));
      ok(`${tag} S3b 精簡真的讓倒數欄變窄(對照:同樣特大但拆掉精簡)`,
         !!mXL && !!mXLk && parseFloat(mXL.minCol) < parseFloat(mXLk.minCol) - 0.5,
         `精簡後 --min-col=${mXL && mXL.minCol} vs 不精簡=${mXLk && mXLk.minCol}`);
      const jXL = judge(mXL);
      ok(`${tag} S3c 特大時沒有列橫向溢出`, !!jXL && jXL.g3, jXL && jXL.detail);
      ok(`${tag} S3d 特大時各欄仍逐列對齊`, !!jXL && jXL.g2, jXL && jXL.detail);
      const stdLong = (mStd ? mStd.rows : []).filter(longMin);
      ok(`${tag} S3e 標準字級不動:長倒數仍寫全字`, stdLong.length > 0 && stdLong.every(r => r.minShown === r.minTxt),
         stdLong.map(r => `${r.minTxt}→${r.minShown}`).join(' '));
      const kRows = (mXLk ? mXLk.rows : []).filter(longMin);
      ok(`${tag} S3 突變C(拆掉精簡) S3a 必須紅`, kRows.length > 0 && kRows.every(r => r.minShown === r.minTxt),
         kRows.map(r => `${r.minTxt}→${r.minShown}`).join(' '));
    }

    // 突變 B:拿掉「時刻欄逐板等寬」(＝修法前的自然寬)。
    // 這一項在字型本來就有 tnum 的引擎上是【無效突變】(自然寬本來就相同),據實標明不假裝有牙。
    const vb = judge(await run(() => {
      const st = document.createElement('style');
      st.textContent = '.board .row .t { width: auto !important; }';
      document.head.appendChild(st);
      return () => st.remove();
    }));
    if (vb && vb.g1) ok(`${tag} 突變B(時刻欄不等寬):此引擎數字本來就等寬,突變無效`, true, vb.detail);
    else ok(`${tag} 突變B(時刻欄不等寬) G1 必須紅`, !!vb && !vb.g1, vb && vb.detail);
    await ctx.close();
  }
  await browser.close();
}
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n=== 總計 ${results.length - bad.length}/${results.length} 通過 ===`);
if (bad.length) console.log('失敗:', bad.map(b => b.n).join(' / '));
process.exit(bad.length ? 1 : 0);

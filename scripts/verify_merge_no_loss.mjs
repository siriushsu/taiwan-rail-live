// 合併零遺失閘門：這顆合併有沒有把某一側的東西整批弄不見。
//
// 為什麼需要它（2026-08-23 的事故，見 memory ship-regression-evil-merge）：
//   一顆合併把 index.html **整檔取單邊**，凡「只活在另一側」的東西當場全消失，而 build／
//   archive／既有 verify 全綠，使用者是在**上架之後**才發現少了 18 項。既有的兩道防線各有
//   結構性盲點：`app/scripts/verify_no_ship_regression.mjs` 只比「候選 vs 已上架基線」，
//   看不到「還沒上架、只活在另一條分支」的東西；`scripts/scan_merge_gaps.mjs` 只比
//   「分支 vs origin/main」，看不到你手上這顆正在合併的結果。這支補的是「合併當下、對兩個
//   父分支同時負責」那一格——正是要把兩條線併起來時唯一該跑的那道閘門。
//
// 第二種形態（2026-08-31 補上 G3，見 memory index-merge-duplicate-const）：
//   合併也可能不是「少一份」而是「多一份」——兩條線各自新增同一個宣告，git 判成兩個互不衝突
//   的 hunk 而全部收下（`const BUILD` 就這樣被留了兩行），開機直接 SyntaxError。**下面那七類
//   無損式判準對這件事結構上瞎：它們問「還在不在」，重複一份也算「在」，所以會全綠。**
//   G3 因此改用「真的 parse 一次」當判準，而不是再加一類識別字。
//
// 判準沿用 verify_no_ship_regression 的七類**識別字**（函式／元素 id／更新紀錄條目／說明中心
// 節／方案面板功能項／旗標常數／URL 參數）：行會被重排、改寫、搬檔，逐行比對噴滿假陽性，
// 「這個東西還在不在」對搬家免疫。每一類都對映到 08-23 真的丟掉過的東西，不是憑空想的維度。
//
// 用法：
//   node scripts/verify_merge_no_loss.mjs --parents <refA> <refB> [--cand <index.html>]
//   node scripts/verify_merge_no_loss.mjs --parents HEAD^1 HEAD^2          # 剛做完的合併
//   node scripts/verify_merge_no_loss.mjs --parents A B --allow id1,id2    # 刻意移除的要逐筆列
// 退出碼：0＝兩側的東西都還在；1＝有東西不見了；2＝跑不起來（參數錯／讀不到檔）。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { inventory } from '../app/scripts/verify_no_ship_regression.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const LABEL = {
  functions: '函式', elementIds: '元素 id', changelog: '更新紀錄條目',
  helpKeys: '使用說明中心的節', plusFeats: '方案面板功能項',
  gates: '旗標／閘門常數', urlParams: 'URL 參數契約',
};

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const pi = argv.indexOf('--parents');
if (pi < 0 || !argv[pi + 1] || !argv[pi + 2] || argv[pi + 2].startsWith('--')) {
  console.error('✋ 用法：node scripts/verify_merge_no_loss.mjs --parents <refA> <refB> [--cand <index.html>] [--allow a,b]');
  process.exit(2);
}
const REFS = [argv[pi + 1], argv[pi + 2]];
const CAND = resolve(arg('--cand') || join(REPO, 'index.html'));
const ALLOW = new Set((arg('--allow') || '').split(',').map(s => s.trim()).filter(Boolean));

if (!existsSync(CAND)) { console.error(`✋ 讀不到候選 ${CAND}`); process.exit(2); }
const candHtml = readFileSync(CAND, 'utf8');
const md5 = s => createHash('md5').update(s).digest('hex');

// 🔴 第一道 gate：先證明「我驗的是哪一份、對照的是哪兩顆」。驗錯目標而全綠是這個 repo 踩過的坑。
console.log(`[G0] 候選 ${CAND} md5=${md5(candHtml).slice(0, 10)}`);
const sides = REFS.map(ref => {
  let html, sha;
  try {
    sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: REPO }).toString().trim();
    html = execFileSync('git', ['show', `${ref}:index.html`], { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }).toString();
  } catch (e) { console.error(`✋ 讀不到 ${ref}:index.html —— ${String(e).split('\n')[0]}`); process.exit(2); }
  console.log(`[G0] 父 ${ref} (${sha}) md5=${md5(html).slice(0, 10)}`);
  return { ref, sha, html, inv: inventory(html) };
});

// 正向對照：兩側都要真的解析出東西。git show 拿到空檔時聯集會是空的 ⇒ 下面每一條都免費通過。
let bad = 0;
for (const s of sides) {
  const n = Object.values(s.inv).reduce((a, v) => a + v.length, 0);
  const okSide = n >= 200 && s.inv.functions.length >= 50 && s.inv.elementIds.length >= 50;
  console.log(`${okSide ? 'PASS' : 'FAIL'} G1 前置·${s.ref} 解析得到識別字 — 共 ${n} 個（函式 ${s.inv.functions.length}／id ${s.inv.elementIds.length}）`);
  if (!okSide) bad++;
}
// 「整檔取單邊」的一句話檢查（08-23 那顆合併的形態）：候選與某一側逐 byte 相同就是它。
for (const s of sides) {
  const same = md5(s.html) === md5(candHtml);
  console.log(`${same ? 'FAIL' : 'PASS'} G2 候選不是「整檔取 ${s.ref} 那一側」 — ${same ? '逐 byte 相同＝另一側的改動全數消失' : 'md5 不同'}`);
  if (same) bad++;
}

// 🔴 G3：候選的 inline script 真的 parse 得過（2026-08-31 的事故）。
//   下面的主判準是**無損式**的——它問「兩側的東西都還在嗎」，而**重複一份也算「還在」**，
//   所以它對「合併把兩邊的同一個宣告都留下來」結構上瞎。實際踩到的形態：兩條線各自在自己的
//   更新紀錄註解區塊下面新增一行 `const BUILD = ...`，git 判成兩個互不衝突的 hunk 而全部收下
//   ⇒ `Identifier 'BUILD' has already been declared` ⇒ 整份 index.html 開機就拋錯、state 從不
//   存在 ⇒ 會出一顆開不了機的 App bundle，而底下七類判準全部 PASS。
//   不用 regex 猜「頂層 const」（會被字串／樣板字面／縮排騙過）——直接丟給 V8 parse，
//   等同瀏覽器：重複宣告、括號沒收、合併殘留的衝突標記，一次全攔。
//   classic script 共用同一個 global scope，所以除了逐塊 parse，還要 parse 它們的**串接**
//   ——跨 <script> 標籤的重複宣告只有串接才照得到。
{
  const blocks = [...candHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .map(m => ({ attrs: m[1], body: m[2] }));
  const isExternal = a => /\bsrc\s*=/i.test(a);
  const typeOf = a => (a.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [, ''])[1].toLowerCase();
  const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
  const inline = blocks.filter(b => !isExternal(b.attrs) && JS_TYPES.has(typeOf(b.attrs)));
  const classic = inline.filter(b => typeOf(b.attrs) !== 'module');
  const modules = inline.filter(b => typeOf(b.attrs) === 'module');
  // 不認得的型別**不准靜默跳過**：合併把 type 改掉、或打錯字，會讓整塊程式碼從此不被 parse
  // 而覆蓋率一點都不掉（突變測試 M4 就是這樣穿過第一版的）。真的要放資料進 script 標籤的，
  // 把型別加進這張白名單——那是一次刻意的動作，不是預設放行。
  const NON_JS_OK = new Set(['application/json', 'application/ld+json', 'text/template', 'text/x-template']);
  const skipped = blocks.filter(b => !isExternal(b.attrs) && !JS_TYPES.has(typeOf(b.attrs)));
  const unknown = skipped.filter(b => !NON_JS_OK.has(typeOf(b.attrs)));

  const parse = (src, what) => {
    try { new Script(src); return null; }
    catch (e) { return `${what}：${String(e.message).split('\n')[0]}`; }
  };

  const errs = [];
  classic.forEach((b, i) => { const e = parse(b.body, `第 ${i + 1} 塊 classic script`); if (e) errs.push(e); });
  // 串接時每塊之間補換行，避免把兩塊的首尾行黏成一行而產生假的語法錯。
  if (classic.length > 1) {
    const e = parse(classic.map(b => b.body).join('\n;\n'), '全部 classic script 串接（跨標籤的重複宣告只有這裡照得到）');
    if (e) errs.push(e);
  }
  // module 有自己的 scope 且 import/export 不能用 Script 編，逐塊只驗「有沒有衝突標記」。
  modules.forEach((b, i) => {
    if (/^(<<<<<<<|=======|>>>>>>>)/m.test(b.body)) errs.push(`第 ${i + 1} 塊 module script 殘留合併衝突標記`);
  });

  // 覆蓋率要有具名斷言：分母無聲縮水（正則失效、標籤寫法改變、body 抓成空字串）不可以長得
  // 跟全綠一樣。門檻不寫死成「幾個標籤」——那是會隨改版漂移的魔術數字；改問「parse 到的位元組
  // 佔全檔多數」，這是這份單檔巨石的結構事實（實測 77.7%），正則一失效就會直接掉到 0。
  const parsedBytes = inline.reduce((a, b) => a + b.body.length, 0);
  const share = parsedBytes / candHtml.length;
  const covered = classic.length >= 1 && share >= 0.5 && unknown.length === 0;
  const why = unknown.length ? `🔴 有 ${unknown.length} 塊 inline script 的型別不認得而被跳過：${unknown.map(b => JSON.stringify(typeOf(b.attrs))).join('、')}` : '';
  console.log(`${covered ? 'PASS' : 'FAIL'} G3a 候選的 inline script 真的被掃到 — script 標籤 ${blocks.length} 個（外部 ${blocks.filter(b => isExternal(b.attrs)).length}／inline classic ${classic.length}／inline module ${modules.length}／已知非 JS ${skipped.length - unknown.length}），parse 到 ${parsedBytes} bytes＝全檔 ${(share * 100).toFixed(1)}%（需 ≥50%）${why}`);
  if (!covered) bad++;
  console.log(`${errs.length ? 'FAIL' : 'PASS'} G3b 候選 parse 得過（重複宣告／衝突標記／語法錯）${errs.length ? ` — ${errs.length} 條：${errs.join('；')}` : ''}`);
  if (errs.length) bad++;
}

// 主判準：候選必須是「A ∪ B」的超集。
// 次級過濾：識別字若以**任何形式**出現在候選裡（改宣告形式、搬進物件、改成 const）就不算不見
// ——沒有這道過濾，光「不再寫成 function foo(」一個就會噴一堆假陽性（scan_merge_gaps 實測擋掉 127 次）。
let missTotal = 0;
for (const k of Object.keys(sides[0].inv)) {
  const gone = [];
  for (const s of sides) {
    for (const x of s.inv[k]) {
      if ((inventory(candHtml)[k] || []).includes(x)) continue;
      if (ALLOW.has(x)) continue;
      if (candHtml.includes(x)) continue; // 換了宣告形式但東西還在
      gone.push(`${x}（來自 ${s.ref}）`);
    }
  }
  const uniq = [...new Set(gone)];
  console.log(`${uniq.length ? 'FAIL' : 'PASS'} ${LABEL[k]}：兩側聯集都還在 — ${uniq.length ? `少了 ${uniq.length} 個：${uniq.join('、')}` : `${new Set([...sides[0].inv[k], ...sides[1].inv[k]]).size} 個`}`);
  missTotal += uniq.length;
}
bad += missTotal ? 1 : 0;
console.log(missTotal
  ? `\n✋ 合併把東西弄不見了（少 ${missTotal} 個識別字）。不准調基線放行——先回去把該側的內容併回來，真的刻意移除的用 --allow 逐筆列出並在 commit 訊息說明被什麼取代。`
  : bad
    ? `\n✋ 識別字一個都沒少，但上面有 gate 沒過（看 FAIL 那幾行）。G3 紅＝候選根本 parse 不過，開機就會拋錯，不是「少東西」而是「多了一份」。`
    : `\n✅ 兩個父分支的識別字聯集在候選裡一個都不少，且候選 parse 得過。`);
process.exit(bad ? 1 : 0);

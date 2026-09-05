#!/usr/bin/env node
// 出貨前把 index.html 內嵌 <script>／<style> 的註解拿掉。
//
// 為什麼要有這條:index.html 是單檔內嵌全部程式碼,而註解佔全檔 38%(壓縮後仍佔 42%)。
// 那些註解是給維護者看的工程推理,對使用者零價值,卻連同「哪個旗標關著、哪次改壞過」
// 一起送到每個訪客的瀏覽器。原始碼保留註解,出貨的那份不帶。
//
// 🔴 這支只在「出貨用的乾淨 worktree」裡跑,直接改寫該樹的 index.html。
//    絕不在開發樹跑——註解是原始碼的一部分,不進版控就等於刪掉。
//
// 🔴 三件刻意不做的事:
//  1. **不碰 HTML 註解**。`<!-- APP_REPLACE_START ... -->` / `APP_STRIP_*` 是 App build
//     (app/scripts/prepare-web.mjs)的錨點,拿掉 App 就換不了底圖署名與狀態頁連結。
//     HTML 註解只佔 10KB,不值得為它冒這個險。
//  2. **不 minify**。不改識別字、不重排、不壓空白——只刪註解字元,diff 逐段可讀。
//     minify 對這種 1.4MB 單檔應用的行為風險遠大於它多省的那點頻寬。
//  3. **不移除 console**。那是另一個決定,不混在這條裡。
//
// 安全性不靠「我的 lexer 寫對了」,靠出口的等價性證明:對每一段 <script>/<style>,
// 用 esbuild 分別重印原版與去註解版,兩者必須 **逐 byte 相同**。esbuild 是從 AST 重印的,
// 註解在兩邊都會消失 ⇒ 輸出相同 ⇒ 去註解版與原版語意等價。lexer 只要判錯一個字元,
// 不是重印結果不同就是根本 parse 不過,兩種都會讓這支非零退出。

import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const ROOT = process.argv[2] || process.cwd();
const FILE = path.join(ROOT, 'index.html');

// ── JS 註解掃描 ──────────────────────────────────────────────────────────
// 回傳 code 狀態下的註解區間。字串／樣板字串／regex 字面值內的 // 與 /* 不算註解——
// 那正是「用 regex 掃 //」會砍掉網址與 regex 的地方,所以這裡必須真的走一遍狀態機。
//
// regex vs 除法的消歧:看前一個有意義的字元。識別字/數字/`)`/`]`/`}` 之後的 `/` 是除法,
// 其餘是 regex 開頭。`}` 有歧義(區塊結尾 vs 物件字面值結尾),這裡取「可以是 regex」那側,
// 判錯的話會被出口的等價性證明擋下來。
function scanJsComments(src) {
  const out = [];
  let i = 0, prev = '';                 // prev = 前一個有意義的 token 尾字元或關鍵字
  const tmpl = [];                      // 樣板字串巢狀深度堆疊
  const KW = /(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  const isRegexPos = () => {
    if (!prev) return true;
    if (/[)\]}]$/.test(prev)) return prev.endsWith('}');   // `}` 取 regex 側
    if (/[A-Za-z0-9_$]$/.test(prev)) return KW.test(prev); // 關鍵字後面是 regex,識別字後面是除法
    return true;                                            // 運算子/標點後面是 regex
  };
  const bump = (ch) => {
    if (/\s/.test(ch)) return;
    if (/[A-Za-z0-9_$]/.test(ch)) prev = (/[A-Za-z0-9_$]$/.test(prev) ? prev : '') + ch;
    else prev = ch;
  };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    // 樣板字串:`${` 進 code、`}` 回樣板,所以巢狀樣板內的註解也照樣抓得到
    if (tmpl.length && tmpl[tmpl.length - 1].inExpr === false) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { tmpl.pop(); prev = '`'; i++; continue; }
      if (c === '$' && d === '{') { tmpl[tmpl.length - 1].inExpr = true; tmpl.push({ expr: true }); i += 2; prev = '{'; continue; }
      i++; continue;
    }
    if (c === '/' && d === '/') {
      const s = i; while (i < src.length && src[i] !== '\n') i++;
      out.push({ start: s, end: i, type: 'line' }); continue;
    }
    if (c === '/' && d === '*') {
      const s = i; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, src.length);
      out.push({ start: s, end: i, type: 'block' }); continue;
    }
    if (c === '"' || c === "'") {
      i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; prev = 'x'; continue;
    }
    if (c === '`') { tmpl.push({ inExpr: false }); i++; continue; }
    if (c === '}' && tmpl.length && tmpl[tmpl.length - 1].expr) {
      tmpl.pop();
      if (tmpl.length) tmpl[tmpl.length - 1].inExpr = false;
      i++; prev = '`'; continue;
    }
    if (c === '/' && isRegexPos()) {
      i++; let cls = false;
      while (i < src.length) {
        const r = src[i];
        if (r === '\\') { i += 2; continue; }
        if (r === '[') cls = true;
        else if (r === ']') cls = false;
        else if (r === '/' && !cls) break;
        else if (r === '\n') break;                 // 換行=不是 regex,交給等價性證明抓
        i++;
      }
      i++; while (i < src.length && /[a-z]/.test(src[i])) i++;
      prev = 'x'; continue;
    }
    bump(c); i++;
  }
  return out;
}

// CSS 只有 /* */ 一種註解;字串內的 /* 不算(url() 內的裸網址不含 /*,但字串要處理)
function scanCssComments(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const s = i; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, src.length);
      out.push({ start: s, end: i, type: 'block' }); continue;
    }
    if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; continue; }
    i++;
  }
  return out;
}

// 套用區間。整行只有註解的那種連同該行一起刪(不留空行);行尾註解只刪註解本身。
// 跨行區塊註解換成一個 \n——ASI 看的是「兩個 token 之間有沒有換行」,不能直接刪掉。
function applySpans(src, spans) {
  let out = src;
  for (const sp of [...spans].sort((a, b) => b.start - a.start)) {
    const ls = out.lastIndexOf('\n', sp.start - 1) + 1;
    let le = out.indexOf('\n', sp.end); if (le === -1) le = out.length;
    const before = out.slice(ls, sp.start), after = out.slice(sp.end, le);
    const wholeLine = /^\s*$/.test(before) && /^\s*$/.test(after);
    if (wholeLine) { out = out.slice(0, ls) + out.slice(Math.min(le + 1, out.length)); continue; }
    const spans_text = out.slice(sp.start, sp.end);
    const repl = sp.type === 'line' ? '' : (spans_text.includes('\n') ? '\n' : ' ');
    out = out.slice(0, sp.start) + repl + out.slice(sp.end);
  }
  return out;
}

// ── 出口閘門:esbuild 重印必須逐 byte 相同 ────────────────────────────────
function proveEquivalent(orig, stripped, loader, label) {
  // minifyWhitespace 才是對的判準:它把**兩邊的註解都丟掉**、同時保留識別字與程式結構。
  // 用 minify:false 會失敗——esbuild 重印時會保留物件字面值內的註解,於是原版帶著註解、
  // 去註解版沒有,兩邊必然不同(2026-08-26 第一版就是這樣假紅的)。也不要用 minify:true,
  // 那會合併宣告、重寫語法,等價性仍成立但差異來源變多,出問題時看不出是誰的錯。
  const opt = { loader, minifyWhitespace: true, minifyIdentifiers: false, minifySyntax: false, legalComments: 'none' };
  let a, b;
  try { a = esbuild.transformSync(orig, opt).code; }
  catch (e) { throw new Error(`[${label}] 原版就 parse 不過(這支不該是元凶):${e.message}`); }
  try { b = esbuild.transformSync(stripped, opt).code; }
  catch (e) { throw new Error(`[${label}] 去註解後 parse 不過——lexer 砍到程式碼了:${e.message}`); }
  if (a !== b) {
    let k = 0; while (k < a.length && a[k] === b[k]) k++;
    throw new Error(`[${label}] 去註解改變了語意,偏離於第 ${k} 字元\n  原版: ${JSON.stringify(a.slice(Math.max(0, k - 60), k + 60))}\n  新版: ${JSON.stringify(b.slice(Math.max(0, k - 60), k + 60))}`);
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const html = fs.readFileSync(FILE, 'utf8');
const regions = [];
const tagRe = /<(script|style)\b([^>]*)>/gi;
let m;
while ((m = tagRe.exec(html))) {
  const [tag, , attrs] = [m[0], m[1], m[2]];
  const kind = m[1].toLowerCase();
  if (kind === 'script' && /\bsrc\s*=/i.test(attrs)) continue;          // 外部檔,沒有內文
  if (kind === 'script' && /type\s*=\s*["']?(application\/json|text\/)/i.test(attrs)) continue; // 非 JS 內文
  const start = m.index + tag.length;
  const close = html.indexOf(kind === 'script' ? '</script' : '</style', start);
  if (close === -1) continue;
  regions.push({ kind, start, end: close });
}
if (!regions.length) { console.error('找不到任何內嵌 <script>/<style>——檔案結構變了,拒絕出貨'); process.exit(1); }

let out = html, removed = 0, nJs = 0, nCss = 0;
for (const r of [...regions].sort((a, b) => b.start - a.start)) {
  const body = html.slice(r.start, r.end);
  const spans = r.kind === 'script' ? scanJsComments(body) : scanCssComments(body);
  if (!spans.length) continue;
  const stripped = applySpans(body, spans);
  proveEquivalent(body, stripped, r.kind === 'script' ? 'js' : 'css', `${r.kind}@${r.start}`);
  removed += body.length - stripped.length;
  if (r.kind === 'script') nJs += spans.length; else nCss += spans.length;
  out = out.slice(0, r.start) + stripped + out.slice(r.end);
}

// 後置斷言:App build 錨點與法律署名一個都不能少(前者砍了 App 換不了區塊,後者是授權生效要件)
const MUST_KEEP = [
  '<!-- APP_REPLACE_START basemap-credit', '<!-- APP_REPLACE_END basemap-credit',
  // M4-B(2026-09-05)：leaflet-cdn 區塊已隨 Leaflet 一起從 index.html 拔掉，這裡跟著移除；
  // 留著會讓出貨鏈在「必要字串遺失」這一關直接 exit 1。
  '<!-- APP_REPLACE_START status-link', '<!-- APP_REPLACE_END status-link',
  '臺灣輪廓：內政部', 'OpenStreetMap',
];
for (const s of MUST_KEEP) {
  if (!out.includes(s)) { console.error(`出貨檔遺失必要字串:${s}`); process.exit(1); }
}
const stripCount = (html.match(/<!-- APP_(REPLACE|STRIP)_(START|END)/g) || []).length;
const stripCount2 = (out.match(/<!-- APP_(REPLACE|STRIP)_(START|END)/g) || []).length;
if (stripCount !== stripCount2) { console.error(`App build 錨點數量改變:${stripCount} → ${stripCount2}`); process.exit(1); }

fs.writeFileSync(FILE, out);
const pct = (removed / html.length * 100).toFixed(1);
console.log(`去註解完成:JS ${nJs} 段 / CSS ${nCss} 段,刪除 ${removed.toLocaleString()} 字元（原檔 ${pct}%）`);
console.log(`  ${html.length.toLocaleString()} → ${out.length.toLocaleString()} 字元`);
console.log(`  等價性:每段 <script>/<style> 的 esbuild 重印逐 byte 相同`);

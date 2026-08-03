// Plus 功能清單與文案校正驗證(2026-08-02,Plus 開賣 Task 6)——Playwright 真引擎 + 本機靜態伺服器。
//
// 背景:plusRender() 的 feats 陣列是給使用者看的訂閱賣點清單,過去曾經寫了「衛星底圖」「App 進階
//   定位與 Live Activity」這種對不上任何真實資格判定的項目(前者該是「高解析」、後者定位根本免費、
//   Live Activity 才剛做)。本檔的核心判準:清單上的每一項都要能在程式裡指到一個真的資格判定,
//   而且反過來每個真的資格判定也都要出現在清單裡(防「做了功能但忘了寫進清單」)。
//
// 判準寫在效果上,三條自我約束(比照 verify_live_activity.mjs):
//  (1) 斷言一律落在產品程式碼的行為上(plusRender() 實際渲染出的 DOM 文字、plusRefresh() 實際
//      改動的 state.plus.active),不是落在腳本自己塞進去的字串。REQUIRED 的 check() 雖然是對
//      index.html/worker.js 原始碼做比對,但那正是本檔刻意要驗的東西——「清單與實作有沒有脫鉤」
//      問的就是原始碼裡指不指得到真的判定式,不是 DOM;而且一律驗「函式 body 裡真的呼叫
//      plusIsActive()」,不是只驗宣告存在(複審抓到的洞:宣告存在型 regex 對「把閘門 body 換成
//      return true」語意失明,只對語法敏感——見檔尾 M11/M12/M13/M14/M15/M16 對照表)。
//  (2) 每條斷言都配一發瞄準它語意的突變(見檔尾對照表),突變打在**產品碼**上,不是打在 DOM/state。
//  (3) 凡「必須是 0/必須不存在」型的斷言一律配正向對照(G2 用 setTimeout 丟例外自證
//      pageerror 收集器真的抓得到,不是一直靜靜地綠——page.evaluate(()=>{throw})不會觸發
//      pageerror,例外會被 Playwright 接回 Node 端 rejection,踩過這個坑)。
//  (4) 涉及 FOUNDING_UNTIL_MS 的斷言一律從頁面「現讀」該常數(G1),不在本檔另外寫死一份日期
//      複本——複審抓到的洞:寫死「今天在創始期內」會在截止時點之後變成「為了正確的理由
//      轉紅」,判準要跟著那個時間點自己換檔,不是被動等改壞。
//
// G0 自檢(心得32):ROOT 由本檔自身路徑推導,不吃 --root/env;伺服器連接埠取 0(OS 指派);
//   斷言「伺服器吐出來的 index.html 位元組 === ROOT/index.html」。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const WSRC = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const TSRC = readFileSync(path.join(ROOT, 'terms.html'), 'utf8'); // 付費視窗法務列直接連到它,見 T1T
const ASRC = readFileSync(path.join(ROOT, 'app-support.html'), 'utf8'); // B-1 稽核修復:這頁的導覽文案要對 index.html 的槽位標籤真值,見 T8
// 條款頁的**可見內文**(剝掉 head／style／script)。
// 為什麼要剝:全文 4280 字裡有一半以上是 head＋CSS ⇒ 抽取器的「非空」對照近乎恆真,
// 而且 FAIL 訊息會指向一堆樣式碼、看不出違規在哪一句。
const TERMS_BODY_TEXT = (() => {
  const noHead = TSRC
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(noHead);
  return (m ? m[1] : noHead).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
})();
const INDEX_MD5 = createHash('md5').update(SRC).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

// 最小 JS 註解剝除(逐字元掃描,分辨字串/樣板字面量 vs // 與 /* */ 註解,尊重跳脫字元)——
// 不剝註解會被自己的說明文字反咬:M16 突變測試撞到過,buildFoundingSeal() 緊鄰的註解本身就在
// 講「不依賴 plusIsActive() 的內部短路」,把 code 裡的呼叫拿掉之後,body 字串裡仍然透過
// 註解含有 needle 子字串,naive includes() 照樣判定「有呼叫」,把突變測試想抓的缺陷徹底蓋掉。
function stripComments(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], c2 = code[i + 1];
    if (c === '/' && c2 === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < code.length && code[i] !== q) { if (code[i] === '\\') { out += code[i]; i++; if (i >= code.length) break; } out += code[i]; i++; }
      if (i < code.length) { out += code[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}
// 抓「function fnName(...) { ... }」這個宣告的完整 body(大括號配對計數,這幾個函式都短、
// 無跨行巢狀物件字面量,簡單配對足夠),回傳「剝掉註解後的」body 字串是否包含 needle。
// 抓不到宣告本身就是 false——這正是要抓「宣告被改寫成別的語法/被砍掉」的那一種缺陷
// (呼應 M11 的發現);needle 只在程式碼裡才算數,只在註解裡提到不算(呼應 M16 的發現)。
function fnBodyContains(src, fnName, needle) {
  const m = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) return false;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return stripComments(src.slice(m.index, i)).includes(needle);
}
// 同一種「function fnName(...) { ... }」大括號配對抓法,但回傳**原始碼片段本身**(含註解、不比對
// 子字串)——給 T8 丟進 new Function 真的求值用。執行期不在乎註解,只有 fnBodyContains 那種
// 「拿字串去 includes()」才需要先剝。抓不到宣告回 null,呼叫端要顯式判斷(不當成空字串靜默通過)。
function extractFnSrc(src, fnName) {
  const m = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// G0 第二半:證明「等一下瀏覽器抓到的」就是 ROOT 這棵樹的檔案
{
  const served = createHash('md5').update(Buffer.from(await (await fetch(base)).arrayBuffer())).digest('hex');
  ok('G0 伺服器吐出的 index.html 與 ROOT 逐 byte 相同', served === INDEX_MD5, `served=${served} root=${INDEX_MD5}`);
}

async function boot(browser, { viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror:' + String(e)));
  // T4a/T4b 故意用 page.route 模擬 /api/plus-status 回非 200——Chromium 自己會為那個請求印一則
  // 「Failed to load resource: ...」的診斷 console.error,那不是頁面程式碼的例外,是瀏覽器對被
  // 我們自己弄壞的請求的內建記錄,過濾掉它才不會把「刻意模擬故障」誤判成「頁面壞了」。
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of/.test(m.text())) return;
    errors.push('console:' + m.text().slice(0, 200));
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  return { ctx, page, errors };
}

// 唯一注入的「環境」:訂閱資格。形狀比照 index.html plusState() 的初值。
const setPlus = (page, v) => page.evaluate(vv => {
  state.plus = { active: !!vv, founding: false, loading: false, error: '', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
}, v);

// 說明中心的 Plus 節(HELP_GROUPS 的 key='plus'):從頁面現讀該節本身,不讀整份原始碼——
// 讀整份會讓「命中」變成永遠成立(功能字串在 plusRender/terms 裡本來就有),判準當場失明。
// T1H 與 T2a 共用同一支抽取器:兩條判準看的是同一份對外文案,分開各寫一份遲早會漂開。
const readHelpPlusText = page => page.evaluate(() => {
  try {
    const sec = HELP_GROUPS.flatMap(g => g.secs || []).find(s => s.key === 'plus');
    return sec ? JSON.stringify(sec) : '';
  } catch (e) { return ''; }
});

// 真正呼叫產品函式 plusRender(),讀它實際寫進 DOM 的文字——不是腳本自己組字串比對。
const renderFeats = page => page.evaluate(() => {
  plusRender();
  return {
    feats: [...document.querySelectorAll('.plus-feature')].map(el => el.textContent),
    trust: (document.querySelector('.plus-trust') || {}).textContent || '',
  };
});

const cr = await chromium.launch();

// REQUIRED 的「創始會員」conditional() 會讀這兩個模組層級變數;G1 區塊負責賦值。
// 用 let 在這裡先宣告只是讓讀者一眼看到它們的生命週期,實際賦值前不會有任何 closure 被呼叫。
let FOUNDING_UNTIL_MS_LIVE, inFounding;

// ══════════ G1:FOUNDING_UNTIL_MS 現讀(供 T1/T3a/REQUIRED[創始會員] 判斷創始期是否已過)——
// 只驗「讀得到、是有限數字」,不驗「晚於今天」。原本 T3 那條斷言驗的是「晚於今天」,但
// 截止時點過了之後這個常數合法變成過去式,那條斷言會為了正確的理由轉紅(複審 Important 5)。
// 判準要能撐過那個時間點,不能只撐到那天為止。 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  FOUNDING_UNTIL_MS_LIVE = await page.evaluate(() => FOUNDING_UNTIL_MS);
  inFounding = Date.now() < FOUNDING_UNTIL_MS_LIVE;
  ok('G1 FOUNDING_UNTIL_MS 可從頁面讀到且是有限數字', Number.isFinite(FOUNDING_UNTIL_MS_LIVE),
    `FOUNDING_UNTIL_MS=${FOUNDING_UNTIL_MS_LIVE} inFounding=${inFounding}`);
  ok('G1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ G2:page.on('pageerror') 收集器的正向對照——下面 9 條「無 JS 例外」斷言都靠它,
// 但從沒有人證明過它真的抓得到東西。本專案踩過的坑:page.evaluate(() => { throw ... }) 不會
// 觸發 pageerror(例外被 Playwright 接回 Node 端 rejection,chromium/webkit 皆同),要
// setTimeout 讓例外真的在頁面自己的事件循環裡丟出來才會。壞掉的探針會讓人去修一個沒壞的東西,
// 這裡先自證探針本身是活的。 ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await page.evaluate(() => { setTimeout(() => { throw new Error('verify-probe-should-be-caught'); }, 0); });
  await page.waitForTimeout(300);
  ok('G2 error 收集器正向對照:setTimeout 丟出的例外真的被 pageerror 收集器抓到', errors.length === 1, JSON.stringify(errors));
  ok('G2 收集到的內容確實是我們丟的那個例外(不是巧合抓到別的東西)',
    errors.length === 1 && errors[0].includes('verify-probe-should-be-caught'), JSON.stringify(errors));
  await ctx.close();
}

// ══════════ REQUIRED 對映表(逐項對映驗證見 task-6-brief.md Step 1 表格;2026-08-02 複審後改版——
// 原始六條 regex 全部只驗「字串存在於原始碼」,兩項指錯了函式、四項只驗宣告不驗 body,見下方
// 各項註解與檔尾 M11-M16 突變表) ══════════
// needle 必須是「feats 那一項文案裡真的出現的子字串」——對映靠它,不是靠人眼。
// check() 才是真正的資格判定驗證,一律驗「body 裡真的呼叫 plusIsActive()」或等價的伺服器強制,
// 不是「這個名字的函式存在」——名字存在 body 卻是 `return true` 的閘門報廢,舊版驗不出來。
const REQUIRED = [
  {
    needle: '誤點履歷',
    // 清單裡唯一有伺服器強制的一項(其餘都是純客端 UI 閘門)。原本的 symbol 只命中
    // index.html 裡「訂閱 Plus 解鎖完整履歷」按鈕的 click handler(upsell 入口,不是閘門)。
    // 真正的兩道閘:client 端 renderDelayHist() 裡決定要不要模糊圖表的 plusIsActive() 分支;
    // server 端 worker.js delayHistory() 呼叫 checkPlusEntitlement() 且在 !check.ok 時擋掉資料
    // (擋在共享 edge 快取 match 之前,見 worker.js:557-561 註解)。兩邊都要驗到,少驗一邊,
    // 刪掉另一邊照樣綠燈。
    check: () => {
      const clientOk = fnBodyContains(SRC, 'renderDelayHist', 'plusIsActive()');
      const serverOk = /async function delayHistory[\s\S]{0,900}?checkPlusEntitlement\(request,\s*env\)/.test(WSRC)
        && /if \(!check\.ok\) return jsonRes\(\{ error: check\.error \}, check\.status/.test(WSRC);
      return clientOk && serverOk;
    },
  },
  {
    needle: '雲端同步',
    // 原本的 symbol 只命中 accountSyncNow() 裡 logout 例外子句的文字,那句話跟 Plus 完全無關——
    // 就算把 `&& !plusIsActive()` 整段刪掉(閘門報廢、雲端同步變成人人可用),那句話還在,舊版
    // 照樣綠燈。改成整條件式一起比對:少了 `&& !plusIsActive()` 這整條 regex 就不成立。
    check: () => /if \(!reason\.startsWith\('logout'\) && !plusIsActive\(\)\) return false;/.test(SRC),
  },
  { needle: '行程分享', check: () => fnBodyContains(SRC, 'tripShareVisible', 'plusIsActive()') },
  {
    needle: '已儲存清單',
    // Google Takeout 清單匯入。入口在 setupTakeoutUi():有購買通道時把 takeoutOpen 包進
    // plusRequire('takeout', …),資格判定在 plusRequire 內的 plusIsActive()。兩段都要驗——
    // 只驗 setupTakeoutUi 有寫 plusRequire,把 plusRequire 內的 plusIsActive() 拿掉照樣綠;
    // 只驗 plusRequire,把 setupTakeoutUi 改成直接 takeoutOpen() 也照樣綠。
    check: () => fnBodyContains(SRC, 'setupTakeoutUi', "plusRequire('takeout'")
      && fnBodyContains(SRC, 'plusRequire', 'plusIsActive()'),
  },
  { needle: '高解析', check: () => fnBodyContains(SRC, 'satRetinaAllowed', 'plusIsActive()') },
  {
    needle: '創始會員',
    // 原本的 symbol 指向 foundingFrom()——那是純函式,只從購買資訊算「這筆訂閱起始於創始期內
    // 嗎」,body 裡本來就不會、也不應該呼叫 plusIsActive()(它甚至不讀 state)。真正決定「徽章
    // 要不要畫出來」的閘門是 buildFoundingSeal(),見其 `if (!plusIsActive() || !(state.plus &&
    // state.plus.founding)) return '';`——這才是清單那句話對映到的真實資格判定。
    check: () => fnBodyContains(SRC, 'buildFoundingSeal', 'plusIsActive()'),
    conditional: () => inFounding, // 過了 FOUNDING_UNTIL_MS,清單不再宣傳這項是設計行為,見 G1/T1
  },
  { needle: '動態島', check: () => fnBodyContains(SRC, 'liveActivityAllowed', 'plusIsActive()') },
];
// 「清單此刻應該有幾項」一律從 REQUIRED 推導,全檔不再各處寫死數字——2026-08-03 補
// 「Google 清單匯入」那一項時,T1／T3b／T5／T6 四處寫死的 5/6 同時過期,正是這個坑。
// (目前唯一的 conditional 是創始會員那項,故以 founding 布林代入;日後若多一種條件,
//  這支要改成傳入完整情境,而不是再多寫一個常數。)
function expectedFeatCount(founding) { return REQUIRED.filter(r => !r.conditional || founding).length; }

// ══════════ 反方向的揭露集合(T1G,見 T1 區塊):每一道付費閘門都必須對應到已揭露的功能 ══════════
// REQUIRED 那張表走的是「清單列了 ⇒ 程式裡要有真閘門」,以及 T1T/T1H 的「清單列了 ⇒ 條款/說明也要寫」。
// 三條都是同一個方向,結構上照不到相反的缺陷:程式裡多了一道付費牆,卻沒出現在任何一份對外清單裡
// ——那正是「有付費牆卻沒揭露」這件事本身的形狀。plusRequire() 是「攔下來要資格」的唯一入口,
// 所以「有付費牆」在原始碼裡就等於「有人呼叫了它」,拿它的呼叫點當集合。
// 🔴 三種引號都要吃:此前只認單引號,複審實測 `plusRequire("probe-dq", …)` 加一道未登記的付費牆
// ⇒ 88/88 全綠,差別只有一個字元。正向對照證明得了「抽取器不會永遠回空」,**證明不了它不會漏抓**
// (under-matching),所以除了擴大 regex,下面再加一條「呼叫點總數 === 抓到的字面值數」的守門員——
// 那條連 `plusRequire(varName, fn)` 這種非字面值寫法都擋得住:抽取器結構上抓不到的,就讓它對不上帳。
const GATE_SRC = stripComments(SRC);
const GATE_CALL_RE = /plusRequire\(\s*(['"`])([^'"`]+)\1/g;
const GATE_CALLS = [...new Set([...GATE_SRC.matchAll(GATE_CALL_RE)].map(m => m[2]))].sort();
const GATE_LITERALS = [...GATE_SRC.matchAll(GATE_CALL_RE)].length;
const GATE_CALL_SITES = (GATE_SRC.match(/\bplusRequire\s*\(/g) || []).length
  - (GATE_SRC.match(/function\s+plusRequire\s*\(/g) || []).length; // 扣掉宣告自己
// 每個呼叫點要嘛對映到一個已揭露的功能(needle),要嘛掛在一個目前為 false 的功能旗標下
// (功能整個不存在 ⇒ 沒有東西要揭露)。旗標一旦翻成 true,T1G 那條就會要求它補上 needle。
const GATE_DISCLOSURE = {
  takeout: { needle: '已儲存清單' },
  'record-music': { flag: 'RECORDING_ENABLED' },
};

// ══════════ T0:Step 0 新符號 plusIsActive() 本身的正確性(既有 5 支腳本沒有專門測到這個符號) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  const off = await page.evaluate(() => { state.plus = { active: false }; return plusIsActive(); });
  ok('T0a state.plus.active=false 時 plusIsActive()===false', off === false, String(off));
  const on = await page.evaluate(() => { state.plus = { active: true }; return plusIsActive(); });
  ok('T0b state.plus.active=true 時 plusIsActive()===true', on === true, String(on));
  const nullPlus = await page.evaluate(() => { state.plus = null; return plusIsActive(); });
  ok('T0c state.plus 為 null 時 plusIsActive() 不丟例外且回 false(短路求值不變)', nullPlus === false, String(nullPlus));
  ok('T0 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T1:清單↔實作雙向對映(正向:feats 每項都對得到 REQUIRED 且 check() 通過;反向:REQUIRED 每項都在 feats 裡) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const { feats, trust } = await renderFeats(page);
  const HELP_PLUS_TEXT = await readHelpPlusText(page);
  // 條數從 REQUIRED 推導,不寫死:寫死的數字只要清單一長就過期,而換成另一個寫死的數字只是把坑
  // 往後推一格(2026-08-03 補「Google 清單匯入」那一項時實際踩到)。真正的判準是下面 T1F／T1R
  // 的逐項身分對映,這一條只負責抓「多了一項沒對映的東西」。
  const expectCount = expectedFeatCount(inFounding);
  ok(`T1 前置:feats 陣列項數＝REQUIRED 此刻應出現的項數(inFounding=${inFounding}→${expectCount} 項;多了是塞了沒對映的東西,少了是漏對映)`,
    feats.length === expectCount, JSON.stringify(feats));
  // 正向:每一項 feats 文字都能在 REQUIRED 找到唯一對應的 needle,且 check() 通過(真的有資格判定,不是空話)
  feats.forEach((text, i) => {
    const match = REQUIRED.find(r => text.includes(r.needle));
    ok(`T1F feats[${i}] 對得到 REQUIRED 裡的某個 needle`, !!match, text);
    ok(`T1F feats[${i}] 對應的 check() 通過(真的有資格判定,不是空話)`, match ? match.check() : false, match ? match.needle : '(無對應項目)');
    // T1T:付費視窗的法務列直接連到 terms.html ⇒ 使用者是在決定付錢的當下讀到那份條款的。
    // 面板列了、條款沒寫(或反之)就是在付款決定點做不一致宣稱。這一條是 2026-08-03「有付費牆卻
    // 不在任何對外清單裡」那件事的根因判準——舊的對映是單向的(清單項→閘門),照不到揭露這一側。
    ok(`T1T feats[${i}] 在 terms.html 的 Plus 敘述裡也找得到`, !!match && TSRC.includes(match.needle),
      match ? `needle=${match.needle} inTerms=${TSRC.includes(match.needle)}` : '(無對應項目)');
    // T1H:說明中心也是付款決定點之一(HELP_GROUPS 的 plus 節本身就寫著這句)。條款被納入判準、
    // 說明中心沒有,等於留了一個沒有機械保障的第三份對外清單。
    // 🔴 具名容忍:條件式項目(創始會員徽章)刻意豁免——它會在期限後從清單消失,寫進靜態說明文案
    //    只會變成過期的教學。豁免寫在這裡而不是靜靜跳過,才看得出容忍了什麼、為什麼。
    const exempt = !!(match && match.conditional);
    ok(`T1H feats[${i}] 在使用說明中心的 Plus 節裡也找得到${exempt ? '(條件式項目已具名豁免:期限後會從清單消失,不寫進靜態說明)' : ''}`,
      !!match && (exempt || HELP_PLUS_TEXT.includes(match.needle)),
      match ? `needle=${match.needle} inHelp=${HELP_PLUS_TEXT.includes(match.needle)} exempt=${exempt}` : '(無對應項目)');
  });
  // T1H 的正向對照:上面那組「找得到」若因為抽取器壞掉(節被改名、欄位換名)而拿到空字串,會全部
  // 變成紅——但若有人把抽取器改成回傳整份 index.html,就會全部變成假綠。兩頭各釘一條。
  ok('T1H 正向對照:說明中心 Plus 節抽得出非空文字,且不會把不相干的字串也認成命中',
    HELP_PLUS_TEXT.length > 20 && !HELP_PLUS_TEXT.includes('verify-probe-not-in-help'),
    `len=${HELP_PLUS_TEXT.length} head=${JSON.stringify(HELP_PLUS_TEXT.slice(0, 60))}`);

  // ══ T1G:反方向——每一個付費閘門都必須對應到已揭露的功能(集合與對映表定義在 REQUIRED 旁) ══
  ok('T1G0 plusRequire() 的呼叫點名單與揭露對映表一致(新增一道付費牆而沒登記,這裡先紅)',
    JSON.stringify(GATE_CALLS) === JSON.stringify(Object.keys(GATE_DISCLOSURE).sort()),
    `原始碼=${JSON.stringify(GATE_CALLS)} 對映表=${JSON.stringify(Object.keys(GATE_DISCLOSURE).sort())}`);
  const flagVals = await page.evaluate(names => Object.fromEntries(names.map(n => {
    try { return [n, eval(n)]; } catch (e) { return [n, 'ReferenceError']; }
  })), Object.values(GATE_DISCLOSURE).filter(d => d.flag).map(d => d.flag));
  for (const src of GATE_CALLS) {
    const d = GATE_DISCLOSURE[src];
    const byNeedle = !!(d && d.needle) && feats.some(t => t.includes(d.needle)) && TSRC.includes(d.needle);
    const byFlag = !!(d && d.flag) && flagVals[d.flag] === false;
    ok(`T1G plusRequire('${src}') 這道付費閘門有被揭露(在清單與條款裡都找得到)${d && d.flag ? `,或它掛的 ${d.flag} 目前為 false(功能不存在,無可揭露)` : ''}`,
      byNeedle || byFlag, `needle=${d && d.needle} byNeedle=${byNeedle} flag=${d && d.flag}=${d && d.flag ? flagVals[d.flag] : '-'} byFlag=${byFlag}`);
  }
  // 抽取器的正向對照:regex 打錯字會讓 GATE_CALLS 變成空陣列,而空陣列在上面的迴圈裡一條都不跑
  // ⇒ 整組靜默消失。逐種引號列出來,是因為「換一種寫法就繞過」正是這條防線實際被繞過的方式,
  // 而「不會永遠回空」這種對照結構上照不到漏抓——要照到,就得把每一種該抓到的寫法都餵一次。
  const quoteProbe = [...stripComments(
    'x(); plusRequire(\'probe-sq\', a); plusRequire("probe-dq", b); plusRequire(`probe-tp`, c);'
  ).matchAll(GATE_CALL_RE)].map(m => m[2]);
  ok('T1G 正向對照:呼叫點抽取器對單引號／雙引號／樣板字面值三種寫法都抓得到(換一種引號就繞過)',
    GATE_CALLS.length > 0 && JSON.stringify(quoteProbe) === JSON.stringify(['probe-sq', 'probe-dq', 'probe-tp']),
    `樣本抓到=${JSON.stringify(quoteProbe)} 實際抓到=${JSON.stringify(GATE_CALLS)}`);
  // 守門員:抽取器只認字面值,`plusRequire(name, fn)` 這種寫法它結構上看不到。
  // 與其假裝抓得到,不如讓帳對不上——呼叫點數與抓到的字面值數不等,就是「有一道閘門沒被登記」。
  ok('T1G0b plusRequire() 的呼叫點數 === 抽取器抓到的字面值數(非字面值寫法不會被靜默略過)',
    GATE_CALL_SITES === GATE_LITERALS && GATE_CALL_SITES > 0,
    `呼叫點=${GATE_CALL_SITES} 字面值=${GATE_LITERALS}`);
  // 反向:REQUIRED 每一項都出現在 feats 裡(防「做了功能但忘了寫進清單」)——除非該項有 conditional()
  // 且目前不成立(創始會員過了 FOUNDING_UNTIL_MS),那種情況下正確行為是「不出現」,一樣要驗到,
  // 不是跳過不驗。
  REQUIRED.forEach(r => {
    const shouldAppear = !r.conditional || r.conditional();
    ok(`T1R REQUIRED[${r.needle}] ${shouldAppear ? '出現在' : '(創始期後正確不再出現在)'} feats 陣列裡`,
      feats.some(t => t.includes(r.needle)) === shouldAppear, JSON.stringify(feats));
  });
  ok('T1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T2:文案 gate(窄承諾 + 衛星用詞 + 準確度免費承諾 + 第1項不越界宣稱免費集合) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const { feats, trust } = await renderFeats(page);
  // ══ 絕對承諾偵測器(T2a) ══
  // 🔴 這是**絆線,不是證明**:綠只代表「沒踩到已知的措辭家族」,不代表文案裡沒有絕對承諾。
  //    要證明後者需要人讀。判準的價值在於「同一句話換一個寫法就繞過」這件事不再發生。
  //
  // 為什麼從單詞清單改成家族＋極性:上一版是純字面比對,複審實測「永久／終身／無限期」
  // 三種同義寫法全部 91/91 全綠——改一個字就繞過;而為了避開誤咬又把輸入縮到只剩一節,
  // 那是繞過症狀。根因是「不分極性」,所以極性要正面處理。
  //
  // 三層(2026-08-03 修復輪 4 改版)。**每一層都必須在 POS_SAMPLES 與 NEG_SAMPLES 兩邊各有樣本**——
  // 上一版的雙向規矩是不對稱的:正向樣本蓋兩層、反向樣本只蓋保證那一層,於是「永久刪除」這種
  // 完全正常的條款寫法被誤紅,而常駐的反向對照結構上照不到那一層(複審端到端實測 90/91)。
  // 雙向條件要跟著**每一層**走,不是跟著每一輪走。
  //
  //  A 永久性詞 + **價格對象**:「永久免費」是絕對承諾;「永久刪除」「絕不出售個資」「永不追蹤」
  //    修飾的是資料處置與否定義務,不是價格,那是這類文件的標準句。上一版 A 層完全不看上下文,
  //    把整批正常法律用語誤紅——誤紅會讓下一個人把整條判準調鬆或刪掉,比漏抓更危險。
  //  B 保證性詞 + 承諾對象,且該詞沒有被**直接修飾它的**否定標記關掉。
  //    上一版問的是「子句前綴含不含否定字」,於是「軌島不販售個人資料,並保證行程分享免費。」
  //    整句被放行(那個「不」修飾的是「販售」,關不掉後面的「保證」)。
  //  C 否定式價格承諾:「不會再收費」字面是否定、語意是「此後永遠不收錢」。
  //    A/B 兩層都以「肯定的絕對詞」當抓握點,結構上看不見這一類。
  //
  // 🔴 追不到的形態一律寫進下方「已知不咬」清單,不要再加規則去追——這是自然語言分類問題,
  //    不存在完備的那一天,而每加一條規則就多一份誤紅風險。清單比規則有價值。
  const ABS_PERMANENT = ['永遠', '永久', '終身', '無限期', '永不', '絕不', '一輩子', '不限期'];
  // 本專案過去實際踩過的具體措辭:語意已經窄到沒有合法用法,故**不**套價格條件——
  // 套了等於把回歸樣本一起放行。
  const BANNED_PHRASES = ['一個都不會拿走', '更清晰'];
  const ABS_GUARANTEE = ['保證', '一律', '必定', '確保', '絕對', '一直'];
  const NEG_MARKERS = ['不', '未', '無', '非', '沒'];
  // 價格對象:A／C 兩層共用。問的是「這句在講錢嗎」,不是「這句有沒有絕對詞」。
  const PRICE_OBJ = ['免費', '收費', '收取', '費用', '付費', '計費', '價格', '費率', '收錢', '要錢'];
  const COMMIT_OBJ = ['免費', '收費', '收取', '費用', '不會', '可用', '有效', '提供', '正確', '成功', '同步', '支援', '開放', '保留', '存在', '失敗', '中斷'];
  // 兩種子句粒度,各自對應一個問題:
  //   句級——B 層用。否定要跨得過讀點才管得住「軌島以現況提供,但不保證完全正確」這種寫法。
  //   讀點級——A／C 層用。跨過一個讀點就換了修飾對象:「本服務免費提供,資料刪除後永久無法復原」
  //           的「永久」修飾的是復原不是價格。
  const CLAUSE_SEP = /[。！？；\n]/;
  const FINE_SEP = /[。！？；，、,\n]/;
  // 否定標記與被修飾詞之間允許夾的副詞性襯字(「並不保證」「無法保證」「未能保證」「沒有保證」都算否定)。
  // 只有這一類襯字跨得過去:F2 那句中間隔的是另一個動詞加一個讀點,那不是襯字。
  const NEG_FILLER = /[並也都還又再會能可將要法夠是有很太更]*$/;
  const negatedRightBefore = before => NEG_MARKERS.includes(before.replace(NEG_FILLER, '').slice(-1));
  // C 層抓的是**序列**不是單詞:否定標記 → 時間性副詞 → 收費類動詞。
  // 少了時間性副詞就只是在陳述現況(「網站不收費」),不是「此後永遠不收錢」的承諾。
  //
  // 🔴 2026-08-03 修復輪 5 收斂:副詞只留「再／又」,拿掉「另外／額外」。
  //    兩者語意不同類——「再／又」是**時間性重複**(承諾未來不再發生);
  //    「另外／額外」是**加成性**(陳述範圍:除了這個以外不多收)。
  //    「瀏覽地圖與查看列車位置不另外收費。」是在描述免費層的範圍,不是承諾,上一版把它誤紅。
  const NEG_PRICE_RE = /(不|未|無|沒|非).{0,4}(再|又).{0,4}(收費|收取|計費|加價|漲價|收錢|要錢)/;
  // 🔴 取消／退訂語境豁免。「取消訂閱後不會再收費。」與「行程分享不會再收費。」**字面同構**,
  //    只有條件語境分得開:前者是 App Store 要求的取消揭露(而且是正確的),後者是絕對承諾。
  //    這是本判準第一次與合規要求衝突——條款頁 §3 現在寫成「如需停止扣款…」正是為了繞開它,
  //    下一個人把它改回白話就會紅。語境要在**句級**看,不是讀點級:
  //    「取消訂閱後,我們不會再收費。」的條件在讀點的另一邊。
  const CANCEL_CTX = ['取消', '退訂', '解約', '終止訂閱', '停止訂閱', '不續訂'];
  const sentenceAt = (s, i) => {
    let a = i, b = i;
    while (a > 0 && !CLAUSE_SEP.test(s[a - 1])) a--;
    while (b < s.length && !CLAUSE_SEP.test(s[b])) b++;
    return s.slice(a, b);
  };
  const ctxOf = (s, i, w) => s.slice(Math.max(0, i - 30), i + w.length + 30).replace(/\s+/g, ' ').trim();
  function bannedIn(str) {
    const out = [];
    const text = String(str || '');
    for (const w of BANNED_PHRASES) {
      let i = text.indexOf(w);
      while (i >= 0) { out.push({ w, why: '過去踩過的具體措辭', ctx: ctxOf(text, i, w) }); i = text.indexOf(w, i + w.length); }
    }
    let fine = 0;
    for (const clause of text.split(FINE_SEP)) {
      const priced = PRICE_OBJ.some(p => clause.includes(p));
      for (const w of ABS_PERMANENT) {
        let i = clause.indexOf(w);
        while (i >= 0) {
          if (priced) out.push({ w, why: '永久性措辭＋價格對象', ctx: ctxOf(text, fine + i, w) });
          i = clause.indexOf(w, i + w.length);
        }
      }
      const m = NEG_PRICE_RE.exec(clause);
      if (m && !CANCEL_CTX.some(c => sentenceAt(text, fine + m.index).includes(c))) {
        out.push({ w: m[0], why: '否定式價格承諾', ctx: ctxOf(text, fine + m.index, m[0]) });
      }
      fine += clause.length + 1;
    }
    let base = 0;
    for (const clause of text.split(CLAUSE_SEP)) {
      for (const w of ABS_GUARANTEE) {
        let k = clause.indexOf(w);
        while (k >= 0) {
          const after = clause.slice(k + w.length, k + w.length + 20);
          const negated = negatedRightBefore(clause.slice(0, k));
          const committed = COMMIT_OBJ.some(c => after.includes(c));
          if (!negated && committed) out.push({ w, why: '保證性措辭＋承諾對象', ctx: ctxOf(text, base + k, w) });
          k = clause.indexOf(w, k + w.length);
        }
      }
      base += clause.length + 1;
    }
    return out;
  }
  // 🔴 已知不咬(絆線的破口,列出來讓下一個人知道綠燈的邊界在哪;**這是絆線不是證明**)。
  //   下列每一句都**實測過確實不咬**(不是憑想像列的):
  //   ・「行程分享免費使用,沒有期限。」——完全不含絕對詞,靠「沒有期限」表達永久性。
  //   ・「這項功能不設期限。」/「軌島保證行程分享不設期限。」——「不設期限」不在任何詞表裡,
  //     且「期限」不是承諾對象。
  //   ・「這項功能不設期限,也不會另外收費。」——2026-08-03 C 層收斂後**整句都不咬**了
  //     (上一版靠「另外」咬得到)。這是為了消掉「不另外收費」這種描述免費層範圍的誤紅
  //     而刻意付的代價:加成性的「另外／額外」不再算承諾。取捨已定——寧可漏抓,不要誤紅。
  //   ・「取消訂閱後不會再收費。」型的句子一律放行(取消語境豁免)。代價是有人把絕對承諾
  //     寫成「取消訂閱後也不會再收費」就繞得過去;但取消揭露是 App Store 要求的合規文案,
  //     在它上面誤紅的成本不對稱地高。
  //   ・「軌島始終讓行程分享免費。」——「始終」不在永久性家族。
  //   ・「這輩子都不會對行程分享收費。」——家族裡只有「一輩子」。
  //   ・「行程分享免費到 2099 年 12 月 31 日為止。」——用遠期日期表達永久。
  //   這幾類都不加規則去追:它們的共同點是「永久性由日常語彙承載」,詞表追不到底,
  //   而每多一條規則就多一份誤紅風險,而誤紅會讓下一個人把整條判準刪掉。要證明文案裡沒有
  //   絕對承諾,需要人讀,這支腳本只負責讓「同一句話換個寫法就繞過」這件事不再發生。
  // 🔴 四份對外文案一起驗:付費面板(feats+plus-trust)、說明中心 Plus 節、條款頁可見內文。
  // 條款這一份刻意吃**全文**不取節——縮小輸入等於把「§5 寫『行程分享永遠免費』」這種
  // 最該被抓的情況排除在外(複審實測:塞在 §5 六支閘門一條都不紅)。
  const HELP_PLUS_TEXT = await readHelpPlusText(page);
  const allTexts = [...feats, trust, HELP_PLUS_TEXT, TERMS_BODY_TEXT];
  const allHits = allTexts.flatMap(t => bannedIn(t));
  ok('T2a 付費決定點四份文案(feats、plus-trust、說明中心 Plus 節、條款頁可見內文)皆不含絕對期限／絕對保證措辭',
    allHits.length === 0,
    allHits.length ? allHits.map(h => `「${h.w}」(${h.why}) …${h.ctx}…`).join(' ｜ ') : `已驗 ${allTexts.length} 段、${allTexts.reduce((n, t) => n + t.length, 0)} 字`);
  // 正向對照:同義變體逐種餵一次。只餵一句的話,換一種寫法就繞過而對照照樣綠——
  // 那正是這一版要修的缺陷本身(under-matching,正向對照結構上照不到,只能把家族列出來)。
  const POS_SAMPLES = ['行程分享永遠免費。', '行程分享永久免費。', '行程分享終身免費、絕不收費。',
    '行程分享無限期免費。', '軌島保證帳號同步一律不會失敗。', '軌島確保行程分享必定持續可用。',
    // B 層:否定＋轉折＋肯定承諾。上一版把整句放行,因為子句前綴含「不」就關掉整個保證層。
    '軌島不販售個人資料，並保證行程分享免費。',
    '無論方案為何，軌島保證行程分享免費。',
    '軌島保證行程分享不收取任何費用。',
    // C 層:字面否定、語意是「此後永遠不收錢」。A/B 兩層結構上看不見這一類。
    '行程分享功能不會再收費。',
    '行程分享將持續提供，且不再收取任何費用。'];
  const posMiss = POS_SAMPLES.filter(x => bannedIn(x).length === 0);
  ok('T2a 正向對照:同義變體逐句都咬得住(永久性＋價格／保證＋承諾對象／否定轉折後的肯定承諾／否定式價格承諾)',
    posMiss.length === 0, posMiss.length ? `漏抓:${posMiss.join(' ')}` : `${POS_SAMPLES.length} 句全中`);
  // 🔴 反向誤紅對照:合法的否定式免責語與範圍語**不得**被咬。
  // 誤紅比漏抓更危險——它會讓下一個人把整條判準調鬆或直接刪掉(上一版靠縮小輸入迴避誤咬,
  // 就是這個壓力造成的)。所以極性正面處理,並把「不該紅」的樣本釘成常駐判準。
  // 🔴 反向樣本必須**每一層各釘至少兩句**:上一版四句用的詞全是保證性的,永久性那一層一句都沒有,
  // 於是「永久刪除」被誤紅時,這條對照照樣印「4 句全部正確放行」——沒有反向樣本的那一層,
  // 等於那一層沒有雙向規矩。
  const NEG_SAMPLES = [
    // B 層(保證性)反向:否定式免責語與範圍語
    '開發者不保證第三方服務持續可用。',
    '實際乘車、平交道與營運決策一律以交通營運單位及現場資訊為準。',
    '列車位置不是營運單位的行車控制、安全警示或官方旅運保證。',
    '軌島以現況提供,但不保證完全正確、不中斷或適合特定用途。',
    // A 層(永久性)反向:永久性詞修飾資料處置與否定義務,不是價格——這類是條款／隱私文件的標準句
    '刪除帳號後，同步資料會被永久刪除且無法復原。',
    '匯出檔案在你的裝置上保留期限為永久，除非你自行刪除。',
    '軌島絕不出售您的個人資料。',
    '你絕不得利用軌島從事違法或詐欺行為。',
    // C 層(否定式價格承諾)反向:陳述現況不是承諾——少了時間性副詞就不是「此後永遠不收錢」
    '訂閱在軌島 App 內完成，網站不收費。',
    '刪除軌島帳號不會自動取消進行中的訂閱，也不會自動產生退款。',
    // 🔴 C 層 2026-08-03 收斂後補進來的常駐對照,七句裡有**六句**在上一版是誤紅的
    //   (只有「登入本身不收費…」那句本來就綠,留著當「沒有時間性副詞」的正例)。
    //   沒進常駐樣本的,下次還會再犯。
    //   前四句:「另外／額外」是加成性(描述免費層的範圍),不是時間性重複(承諾未來)。
    '瀏覽地圖與查看列車位置不另外收費。',
    '核心地圖功能不另外收費。',
    '查看列車位置與時刻表不會另外向你收費。',
    '登入本身不收費，跨裝置同步才需要訂閱。',
    //   後三句:取消揭露。這是 App Store 要求的、而且正確的文案,與絕對承諾字面同構,
    //   只有取消語境分得開。最後一句刻意把語境放在讀點的另一邊(所以語境要在句級看)。
    '取消訂閱後不會再收費。',
    '取消後不會再向你收費。',
    '取消訂閱後，我們不會再收費。'];
  const negFalse = NEG_SAMPLES.flatMap(x => bannedIn(x).map(h => `${x} → 「${h.w}」`));
  ok('T2a 反向誤紅對照:三層各自的合法用語(否定免責／範圍語、永久性修飾資料處置、陳述現況的不收費)不得被咬',
    negFalse.length === 0, negFalse.length ? negFalse.join(' ｜ ') : `${NEG_SAMPLES.length} 句全部正確放行`);
  // 抽取器對照:條款那一份若抽成空字串或抽到整份原始碼,上面的 every 就沒有意義。
  // 兩頭各釘一次:非空、含得到 Plus 那一節的錨點、且**不含 CSS 大括號**(證明 head/style 真的被剝掉)。
  ok('T2a 抽取器對照:說明中心與條款兩支抽取器都抽得出非空可見內文,且條款那份已剝掉 head/style(不含 CSS 大括號)',
    HELP_PLUS_TEXT.length > 20 && !HELP_PLUS_TEXT.includes('verify-probe-absent')
    && TERMS_BODY_TEXT.length > 200 && TERMS_BODY_TEXT.includes('軌島 Plus 訂閱')
    && /[{}]/.test(TSRC) && !/[{}]/.test(TERMS_BODY_TEXT),
    `help=${HELP_PLUS_TEXT.length} termsBody=${TERMS_BODY_TEXT.length}/全文 ${TSRC.length} 字`);
  const satItem = feats.find(t => t.includes('高解析')) || '';
  ok('T2b 衛星那項同時含「高解析」與「Retina」', satItem.includes('高解析') && satItem.includes('Retina'), satItem);
  ok('T2c plus-trust 保留「準確度」相關的免費承諾語', trust.includes('準確度'), trust);
  // API 契約:付費項的措辭只能涵蓋受 entitlement 保護的 endpoint 輸出。/api/delay-stats
  // (30 天彙總)零資格檢查,不在 Plus 閘門之後,故第1項不得宣稱涵蓋它。只檢查「有沒有提到
  // 誤點履歷」抓不到這個偏差(它本來就提到了),要正面驗證措辭收斂在 /api/delay-history
  // 獨有的部分(90 天、逐日),且不重現把兩支 endpoint 混在一起的舊措辭。
  const item1 = feats[0] || '';
  ok('T2d 第1項文案宣稱「90天」', /90\s*天/.test(item1), item1);
  ok('T2e 第1項文案宣稱「逐日」(免費彙總是 30 天聚合值,不是逐日)', /逐日/.test(item1), item1);
  ok('T2f 第1項文案不重現舊版「統計圖表」措辭(那正是把免費彙總算進賣點的原始缺陷用詞)', !item1.includes('統計圖表'), item1);
  ok('T2 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T3:創始會員徽章條件化——必須跨過 FOUNDING_UNTIL_MS 那個時點才算驗到(只驗「今天」全綠) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const { feats } = await renderFeats(page);
  // 用 G1 現讀到的 inFounding 判斷「現在」該不該看到這項,不寫死「今天在創始期內」——
  // 那句話本身就是複審抓到的時間炸彈,見檔頭(4)。
  ok(`T3a 創始期狀態(inFounding=${inFounding}):feats ${inFounding ? '含' : '不含'}「創始會員徽章」`,
    feats.some(t => t.includes('創始會員徽章')) === inFounding, JSON.stringify(feats));
  ok('T3 前置無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const future = FOUNDING_UNTIL_MS_LIVE + 30 * 86400000; // 期限後 30 天,避開邊界的時區/精度爭議;FOUNDING_UNTIL_MS_LIVE 已在 G1 現讀,不重複打頁面
  await page.evaluate(t => { Date.now = () => t; }, future);
  const { feats } = await renderFeats(page);
  ok('T3b 創始期後(FOUNDING_UNTIL_MS+30天):feats 不再無條件出現「創始會員徽章」(過了期限才訂閱的人拿不到,清單不能繼續宣傳)',
    !feats.some(t => t.includes('創始會員徽章')), JSON.stringify(feats));
  ok(`T3b 創始期後:feats 仍有其他 ${expectedFeatCount(false)} 項(不是整個清單壞掉,只有這一項消失)`,
    feats.length === expectedFeatCount(false), JSON.stringify(feats));
  ok('T3 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T4:Step 0b——「確定沒資格」與「查不出來」不可被前端收斂成同一件事 ══════════
// 背景:worker.js plusStatus() 刻意把兩種答案分開(200{active:false}=確定沒有;非200=查不出來)。
// 前端過去把兩者都當成「不動 p.active」,於是取消訂閱/退款後暖頁面永遠保留 Plus。
// 兩條斷言缺一不可:只驗其中一條驗不到「這個區分」本身。
const fakeAccount = () => { state.account = { user: { getIdToken: async () => 'FAKE_TOKEN' }, fb: {} }; };
{
  // T4a:200{active:false} 必須清掉 p.active(true→false)
  const { ctx, page, errors } = await boot(cr);
  await page.evaluate(fakeAccount);
  await setPlus(page, true);
  await page.route('**/api/plus-status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: false }) }));
  const after = await page.evaluate(async () => { await plusRefresh(); return state.plus.active; });
  ok('T4a 200{active:false}(確定沒有資格)⇒ p.active 被清掉(true→false)', after === false, String(after));
  ok('T4a 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // T4b:503(查不出來)必須保留 p.active,不可被誤讀成「沒訂閱」
  const { ctx, page, errors } = await boot(cr);
  await page.evaluate(fakeAccount);
  await setPlus(page, true);
  await page.route('**/api/plus-status', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'entitlement_unavailable' }) }));
  const after = await page.evaluate(async () => { await plusRefresh(); return state.plus.active; });
  ok('T4b 503(上游查不出來)⇒ p.active 維持不變(true→true,不誤清付費者的資格)', after === true, String(after));
  ok('T4b 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  // T4c:正向對照——200{active:true} 必須真的把 p.active 從 false 改成 true。
  // 沒有這條,T4b「503 維持不變」分不出是「這條路徑真的在分辨兩種答案」還是「整條路徑死掉,永遠不動」。
  const { ctx, page, errors } = await boot(cr);
  await page.evaluate(fakeAccount);
  await setPlus(page, false);
  await page.route('**/api/plus-status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true }) }));
  const after = await page.evaluate(async () => { await plusRefresh(); return state.plus.active; });
  ok('T4c 正向對照:200{active:true} ⇒ p.active 從 false 真的變 true(證明整條路徑活著,T4b 的不變不是路徑死掉)', after === true, String(after));
  ok('T4c 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await cr.close();

// ══════════ T5:手機四寬度(360/375/414/768,WebKit)——清單項數與文字長度會隨揭露內容變動,不得斷行破版、不得溢出彈窗 ══════════
{
  const wk = await webkit.launch();
  const rows = [];
  for (const w of [360, 375, 414, 768]) {
    const { ctx, page, errors } = await boot(wk, { viewport: { width: w, height: 800 } });
    await setPlus(page, false);
    const geo = await page.evaluate(async () => {
      // 複審 Minor M-3:改走真正的入口 plusOpen(),不再直接翻 modal.hidden——plusOpen() 有
      // 「未登入先導去登入面板」這條分支,直接翻 hidden 會量到使用者實際到不了的佈局路徑。
      state.account = { user: { uid: 'verify-t5' }, fb: {} };
      await plusOpen('verify-t5');
      const items = [...document.querySelectorAll('.plus-feature')];
      const dialog = document.querySelector('.plus-dialog').getBoundingClientRect();
      const rects = items.map(el => el.getBoundingClientRect());
      return {
        count: items.length,
        overflow: items.map((el, i) => {
          const r = rects[i], pr = el.parentElement.getBoundingClientRect();
          return { overRight: Math.round(r.right - pr.right), overLeft: Math.round(pr.left - r.left), h: Math.round(r.height) };
        }),
        // 相鄰兩項是否垂直重疊(正常文件流裡本應結構性不可能,當防線用)
        overlaps: rects.slice(1).map((r, i) => Math.round(rects[i].bottom - r.top)),
        dialogRight: Math.round(dialog.right), viewportW: window.innerWidth,
      };
    });
    let wrap = null;
    if (w === 360) {
      // 目前的清單文案在 360px 剛好都撐得下單行(見下面 fmt 印出的高度全部相同)——這件事本身不能
      // 當「不斷行破版」的證明,那只證明了「現在還沒撞到」。真的要驗的是排版本身撐不撐得住換行,
      // 手法:直接把最後一項的文字換成刻意過長的字串強迫它換行,量換行後有沒有溢出/疊到鄰項。
      wrap = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.plus-feature')];
        const last = items[items.length - 1], prev = items[items.length - 2];
        // 複審 Minor M-2:.plus-feature 結構是 <span>✓</span>TEXT,唯一的 <span> 是勾勾圖示、
        // 剛好也是唯一的 element 子節點,CSS `span:last-child` 照樣命中它(text 節點不算入
        // :last-child 的結構性判斷)——舊寫法改到的是勾勾符號,不是使用者會讀到的功能文字。
        // lastChild 才是 DOM 順序上真正最後的節點(這裡就是那段文字節點),要用它才會改對東西。
        last.lastChild.textContent = '這是一段刻意加長用來強迫換行的測試文字，用來確認排版撐得住多行而不會破版或疊到旁邊的項目';
        const r = last.getBoundingClientRect(), pr = last.parentElement.getBoundingClientRect(), pv = prev.getBoundingClientRect();
        return { h: Math.round(r.height), overRight: Math.round(r.right - pr.right), overLeft: Math.round(pr.left - r.left), gapFromPrev: Math.round(r.top - pv.bottom) };
      });
    }
    rows.push({ w, geo, errors, wrap });
    await ctx.close();
  }
  await wk.close();
  const fmt = rows.map(r => `${r.w}px:共${r.geo.count}項 高=${r.geo.overflow.map(o => o.h).join('/')} 右溢=${r.geo.overflow.map(o => o.overRight).join('/')} 左溢=${r.geo.overflow.map(o => o.overLeft).join('/')} 重疊=${r.geo.overlaps.join('/')}`).join(' ; ');
  ok(`T5 四寬度(WebKit):Plus 清單項數符合創始期狀態(inFounding=${inFounding}→預期 ${expectedFeatCount(inFounding)} 項)`,
    rows.every(r => r.geo.count === expectedFeatCount(inFounding)), fmt);
  ok('T5 四寬度:每項功能高度>0(沒有被壓成 0)', rows.every(r => r.geo.overflow.every(o => o.h > 0)), fmt);
  ok('T5 四寬度:每項功能文字不超出容器左右緣', rows.every(r => r.geo.overflow.every(o => o.overRight <= 1 && o.overLeft <= 1)), fmt);
  ok('T5 四寬度:相鄰項目不垂直重疊', rows.every(r => r.geo.overlaps.every(gap => gap <= 1)), fmt);
  ok('T5 四寬度:彈窗本身不超出視窗右緣(不溢出彈窗)', rows.every(r => r.geo.dialogRight <= r.geo.viewportW + 1), fmt);
  ok('T5 四寬度:全程無 JS 例外', rows.every(r => r.errors.length === 0), rows.map(r => r.errors.join('|')).join(';'));
  const w360 = rows.find(r => r.w === 360).wrap;
  ok('T5w 360px 強迫換行(真的多行,高度明顯大於單行的 35px 上下):排版撐得住,不是只靠現在的文字剛好沒撞到邊界', w360.h > 50, JSON.stringify(w360));
  ok('T5w 360px 強迫換行後仍不超出容器左右緣', w360.overRight <= 1 && w360.overLeft <= 1, JSON.stringify(w360));
  ok('T5w 360px 強迫換行後與前一項仍有正常間距、沒有疊上去', w360.gapFromPrev >= -1, JSON.stringify(w360));
}

// ══════════ T7:購買/恢復購買鈕真實命中測試(複審 Important 4)——T5 只量幾何(rect 有沒有超出
// 容器),證明不了「按下去有沒有真的點到」。清單一長、文字一變長就會把這兩顆鈕往下推;
// 複審自己讀 CSS(.takeout-body overflow-y:auto)判斷「內容可捲、鈕仍可及」,但那個結論來自
// 讀原始碼不是來自跑起來驗證——這裡補上跑起來的版本。涵蓋兩種可達狀態:
//   (a) 已訂閱(p.active=true)——網站目前唯一真實會出現的狀態(plusConfigured() 因未設 Web
//       Billing key 恆 false,見 plusRefresh() 的 /api/plus-status 分支),只有「恢復購買」鈕。
//   (b) 有購買通道時(plusConfigured()=true,用既有 RAIL_PLUS_TEST_ADAPTER 慣例達成,同
//       verify_plus_subscription.mjs 的 injectPlus)——月/年方案鈕 + 恢復購買鈕,這條路徑目前
//       雖未在網站開通,原始碼仍然存在且必須驗。
// 每顆鈕:多點 elementFromPoint(中心+四角內縮)命中自己,四寬度都跑;另外在(a)(b)各挑一寬度
// 用真觸控 page.tap() 端到端點下去,並確認事件真的傳到業務邏輯(不是只證明幾何對得上)。
// 正向對照:同一批順便對話框外一點做命中測試,證明這套機制分得出「有點到」與「沒點到」。 ══════════
{
  const wk3 = await webkit.launch();
  // qs 預設空——PLUS_ENABLED 是頁面載入當下就凍結的 const(讀 URL 的 ?plus=1,見 index.html:6059-6062),
  // 不是執行期可覆寫的旗標;plusConfigured() 的第一道閘就是 PLUS_ENABLED,(b)情境要讓
  // RAIL_PLUS_TEST_ADAPTER 那支 OR 分支真的生效,必須在「頁面載入那一刻」就帶 ?plus=1,
  // 執行期才設 window.RAIL_PLUS_TEST_ADAPTER 沒用(這就是第一輪跑出「0 顆方案鈕」的真因)。
  const bootTouch = async (w, qs = '') => {
    const ctx = await wk3.newContext({ viewport: { width: w, height: 800 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror:' + String(e)));
    await page.goto(base + qs, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
    return { ctx, page, errors };
  };
  // (a) 已訂閱態:四寬度命中測試「恢復購買」鈕 + 375px 做一次真觸控
  const rowsA = [];
  for (const w of [360, 375, 414, 768]) {
    const { ctx, page, errors } = await bootTouch(w);
    const hit = await page.evaluate(async () => {
      state.account = { user: { uid: 'verify-t7a' }, fb: {} };
      // error 故意塞非空字串當「未觸發」的前態哨兵——plusRestore() 未配置通道時的早退分支會把它
      // 清成 ''(見 index.html plusRestore),tap 後若還是原始哨兵字串就代表事件根本沒傳到那支函式;
      // 一開始就塞 '' 的話這條斷言即使 tap 完全沒生效也會「巧合」通過,驗不到真相。
      state.plus = { active: true, founding: false, loading: false, error: 'sentinel-untouched', pkgMonthly: null, pkgAnnual: null, mgmtUrl: '', adapter: null, afterUnlock: null };
      await plusOpen('verify-t7a');
      const btn = document.querySelector('.plus-restore');
      if (!btn) return { found: false };
      const r = btn.getBoundingClientRect();
      const pts = [[r.left + r.width / 2, r.top + r.height / 2],
        [r.left + Math.min(6, r.width / 3), r.top + Math.min(6, r.height / 3)],
        [r.right - Math.min(6, r.width / 3), r.top + Math.min(6, r.height / 3)],
        [r.left + Math.min(6, r.width / 3), r.bottom - Math.min(6, r.height / 3)],
        [r.right - Math.min(6, r.width / 3), r.bottom - Math.min(6, r.height / 3)]];
      const hits = pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); return !!(h && (h === btn || btn.contains(h))); });
      // 正向對照:對話框標題(#plusModal 的 h3,理應在按鈕矩形之外)不該被命中成這顆按鈕
      const heroEl = document.querySelector('.plus-hero h3');
      const hr = heroEl.getBoundingClientRect();
      const outsideHit = document.elementFromPoint(hr.left + 4, hr.top + 4);
      const outsideIsBtn = !!(outsideHit && (outsideHit === btn || btn.contains(outsideHit)));
      return { found: true, rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)), hits, outsideIsBtn };
    });
    let tapOk = null;
    if (w === 375 && hit.found) {
      try { await page.tap('.plus-restore'); await page.waitForTimeout(50);
        tapOk = await page.evaluate(() => state.plus && state.plus.error === ''); // plusRestore() 未配置通道時的可觀察分支:p.error=''(見 index.html plusRestore)
      } catch (e) { tapOk = 'tap-threw:' + String(e).slice(0, 150); }
    }
    rowsA.push({ w, hit, errors, tapOk });
    await ctx.close();
  }
  ok('T7a 四寬度:「恢復購買」鈕多點 elementFromPoint 皆命中自己(不只證明幾何不重疊,是真的點得到)',
    rowsA.every(r => r.hit.found && r.hit.hits.every(Boolean)),
    rowsA.map(r => `${r.w}:${r.hit.found ? r.hit.hits.join(',') : 'NOTFOUND'}`).join(' ; '));
  ok('T7a 正向對照:對話框標題位置不會被命中成「恢復購買」鈕(證明命中測試分得出有點到/沒點到)',
    rowsA.every(r => r.hit.found && !r.hit.outsideIsBtn),
    rowsA.map(r => `${r.w}:${r.hit.outsideIsBtn}`).join(' ; '));
  ok('T7a 375px 真觸控 page.tap() 端到端點下「恢復購買」,事件確實傳到 plusRestore()(未配置通道分支可觀察到 p.error 被清空)',
    rowsA.find(r => r.w === 375).tapOk === true, JSON.stringify(rowsA.find(r => r.w === 375)));
  ok('T7a 全程無 JS 例外', rowsA.every(r => r.errors.length === 0), rowsA.map(r => r.errors.join('|')).join(';'));

  // (b) 有購買通道時:四寬度命中測試月/年方案鈕(RAIL_PLUS_TEST_ADAPTER,同 verify_plus_subscription.mjs 慣例)
  const rowsB = [];
  for (const w of [360, 375, 414, 768]) {
    const { ctx, page, errors } = await bootTouch(w, '?plus=1'); // PLUS_ENABLED 要在載入當下就是 true,見上方 bootTouch 註解
    // plusOpen() 尾端呼叫 plusRefresh() 是 fire-and-forget(沒有 await)——p.loading 這道
    // 重入閘門一開始就被那個內部呼叫佔住,若這裡再自己 await plusRefresh() 一次只會立刻撞閘門
    // 拿到 false、什麼都沒做(第一輪除錯抓到:count 恆 0)。改成不重複呼叫,只等原本那次的
    // p.loading 變回 false,讓它自己在背景把 pkgAnnual/pkgMonthly 填好、重畫出 .plus-plan 鈕。
    await page.evaluate(() => {
      state.account = { user: { uid: 'verify-t7b' }, fb: {} };
      window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
      const offering = { availablePackages: [
        // 價格字串一律用非數字 stub(同 verify_plus_subscription / verify_delay_history_ui 的慣例):
        // 測試檔在公開 repo 裡,長得像真價格的樣本會被讀成定價宣告;而且本檔沒有任何斷言在解析它的內容。
        { identifier: '$rc_monthly', packageType: 'MONTHLY', webBillingProduct: { currentPrice: { formattedPrice: 'NT$MONTH-STUB' } } },
        { identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'NT$YEAR-STUB' } } },
      ] };
      window.RAIL_PLUS_TEST_ADAPTER = {
        setUser: async () => {},
        getCustomerInfo: async () => ({ entitlements: { active: {} }, managementURL: '' }),
        getOfferings: async () => ({ all: { plus: offering }, current: offering }),
        purchase: async (pkg) => { window.__t7PurchaseCalledWith = pkg && pkg.identifier; return { customerInfo: { entitlements: { active: { plus: { identifier: 'plus' } } } } }; },
        restore: async () => ({ entitlements: { active: {} } }),
      };
      plusOpen('verify-t7b');
    });
    await page.waitForFunction(() => state.plus && state.plus.loading === false, null, { timeout: 10000 });
    const hit = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.plus-plan')];
      if (btns.length !== 2) return { found: false, count: btns.length };
      const per = btns.map(btn => {
        const r = btn.getBoundingClientRect();
        const pts = [[r.left + r.width / 2, r.top + r.height / 2],
          [r.left + Math.min(6, r.width / 3), r.top + Math.min(6, r.height / 3)],
          [r.right - Math.min(6, r.width / 3), r.top + Math.min(6, r.height / 3)],
          [r.left + Math.min(6, r.width / 3), r.bottom - Math.min(6, r.height / 3)],
          [r.right - Math.min(6, r.width / 3), r.bottom - Math.min(6, r.height / 3)]];
        const hits = pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); return !!(h && (h === btn || btn.contains(h))); });
        return { pkg: btn.dataset.pkg, rect: [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)), hits };
      });
      return { found: true, count: btns.length, per };
    });
    let tapOk = null;
    if (w === 375 && hit.found) {
      try {
        await page.tap('.plus-plan[data-pkg="annual"]');
        await page.waitForTimeout(50);
        tapOk = await page.evaluate(() => window.__t7PurchaseCalledWith === '$rc_annual'); // 真觸控事件確實傳到 plusPurchase()→adapter.purchase(),不是只證明幾何對得上
      } catch (e) { tapOk = 'tap-threw:' + String(e).slice(0, 150); }
    }
    rowsB.push({ w, hit, errors, tapOk });
    await ctx.close();
  }
  ok('T7b 四寬度:方案鈕真的是兩顆(月/年)', rowsB.every(r => r.hit.found && r.hit.count === 2),
    rowsB.map(r => `${r.w}:${r.hit.count}`).join(' ; '));
  ok('T7b 四寬度:月/年方案鈕多點 elementFromPoint 皆命中自己',
    rowsB.every(r => r.hit.found && r.hit.per.every(p => p.hits.every(Boolean))),
    rowsB.map(r => `${r.w}:${r.hit.found ? r.hit.per.map(p => p.pkg + '=' + p.hits.join(',')).join('|') : 'NOTFOUND'}`).join(' ; '));
  ok('T7b 375px 真觸控 page.tap() 端到端點下年訂閱鈕,事件確實傳到 plusPurchase()→adapter.purchase(拿到正確的 pkg)',
    rowsB.find(r => r.w === 375).tapOk === true, JSON.stringify(rowsB.find(r => r.w === 375)));
  ok('T7b 全程無 JS 例外', rowsB.every(r => r.errors.length === 0), rowsB.map(r => r.errors.join('|')).join(';'));

  await wk3.close();
}

server.close();

// ══════════ T8:app-support.html 的「導覽目標標籤」與 index.html 槽位邏輯真值比對
// (2026-08-03,B-1 稽核修復)。背景:app-support.html 從未被本檔或任何驗收腳本掃過,文案可以
// 無限漂移而不被發現——它曾寫「在『軌島帳號』→『查看 Plus』」,但那顆鈕的標籤其實依登入狀態是
// 「Plus」／「帳號」(桌面工具列)或「軌島 Plus」／「帳號同步」(手機「更多」抽屜列),見
// accountBtnSlot()/accountSlotMode()。從沒有一顆鈕真的叫「軌島帳號」——那是開啟之後面板本身
// 的標題(#accountTitle),不是入口鈕上的文字,照文案找的人找不到那顆鈕。
//
// 判準:app-support.html 用 <span data-uilabel>X</span> 明確標出每一個「宣稱是使用者真的會
// 看到的導覽標籤」的子字串——不是掃全頁所有「」引號(那會連「軌島帳號面板」這種沿用整站慣例的
// 一般性稱呼、或「刪除帳號與同步資料」這種與本次修復無關的既有按鈕文字都當成標籤宣稱來查,誤紅
// 範圍會遠超這個 task 的範疇)。data-uilabel 讓「這是一個可驗證的標籤宣稱」變成顯式標記,不必
// 靠 NLP 猜哪句話在講按鈕。
//
// 真值集合不是本檔手打的清單:讀 index.html 原始碼、抽出 accountBtnSlot() 函式體原始文字,丟進
// new Function 配一份假 DOM 真的呼叫兩次(mode='plus'/'account'),取得它實際寫入
// tl.textContent 與 label.textContent 的 4 個字串——手法比照 verify_sat_retina.mjs 的 G1
// (讀原始碼→抽錨點→new Function 真求值,不是 regex 比對字面值/讀註解)。 ══════════
{
  const fnSrc = extractFnSrc(SRC, 'accountBtnSlot');
  // 假 DOM:只給 accountBtnSlot() 實際碰到的兩個節點——#accountBtn(內含 .ti/.tl 兩個 span)
  // 與 .ms-row[data-proxy="accountBtn"](內含一個 span);.style 給空物件讓 display 賦值不出錯;
  // plusOpen/accountOpen 只被「參照」賦給 onclick、從未在函式體內被呼叫,給空函式即可——同
  // sat_retina G1 的做法:自由變數的值不重要,重要的是它存在,求值才不會因 ReferenceError 中斷。
  function callAccountBtnSlot(mode) {
    const ti = { textContent: '' }, tl = { textContent: '' }, label = { textContent: '' };
    const btn = { style: {}, querySelector: sel => (sel === '.ti' ? ti : sel === '.tl' ? tl : null) };
    const row = { style: {}, querySelector: sel => (sel === 'span' ? label : null) };
    const fakeDocument = {
      getElementById: id => (id === 'accountBtn' ? btn : null),
      querySelector: sel => (sel === '.ms-row[data-proxy="accountBtn"]' ? row : null),
    };
    new Function('document', 'accountOpen', 'plusOpen', `${fnSrc}\naccountBtnSlot(${JSON.stringify(mode)});`)
      (fakeDocument, () => {}, () => {});
    return { toolbar: tl.textContent, drawer: label.textContent };
  }
  let plusLabels = null, acctLabels = null, extractError = null;
  try {
    if (!fnSrc) throw new Error('找不到「function accountBtnSlot(...) {」——index.html 結構已變動,請更新 verify_plus_features.mjs 的抽取邏輯');
    plusLabels = callAccountBtnSlot('plus');
    acctLabels = callAccountBtnSlot('account');
  } catch (e) { extractError = e; }
  ok('T8a accountBtnSlot() 可從 index.html 原始碼抽取並在假 DOM 上真實求值(兩種 mode 皆不丟例外;抓不到宣告或求值出錯就是這格錯,不會被誤判成過關)',
    extractError === null && !!plusLabels && !!acctLabels,
    extractError ? String(extractError).slice(0, 300) : `plus=${JSON.stringify(plusLabels)} account=${JSON.stringify(acctLabels)}`);

  // 真值集合:四個槽位標籤字串,全部來自上面真的求值——沒有一個是本檔手打的。
  const SLOT_LABELS = extractError ? new Set() : new Set([plusLabels.toolbar, plusLabels.drawer, acctLabels.toolbar, acctLabels.drawer]);
  const fabricatedIn = claimList => claimList.filter(c => !SLOT_LABELS.has(c));

  // app-support.html 的宣稱:每個 <span data-uilabel>X</span> 都是一個「導覽目標標籤」宣稱。
  const claims = [...ASRC.matchAll(/<span data-uilabel>([^<]*)<\/span>/g)].map(m => m[1]);
  ok('T8b app-support.html 至少標出一個 data-uilabel 導覽標籤宣稱(不是掃描器抓空——抓空的話下面兩條會恆真恆綠,驗不到任何東西)',
    claims.length > 0, `claims=${JSON.stringify(claims)}`);

  const fabricated = fabricatedIn(claims);
  ok('T8c app-support.html 宣稱的每一個導覽目標標籤,都是 index.html 槽位邏輯真的會渲染出來的字串(不是杜撰或已過期的標籤,例如舊版寫的「軌島帳號」——那是面板標題不是入口鈕文字)',
    fabricated.length === 0,
    fabricated.length ? `杜撰/過期:${JSON.stringify(fabricated)} 真值集合=${JSON.stringify([...SLOT_LABELS])}` : `claims=${JSON.stringify(claims)} 真值集合=${JSON.stringify([...SLOT_LABELS])}`);
  // 正向對照(GLOBAL-CONSTRAINTS #10):塞一個已知不在真值集合裡的合成字串,證明「杜撰偵測」真的
  // 抓得到東西,不是因為現有文案剛好都合法而恆綠、或比對邏輯本身寫反了。
  const probe = fabricatedIn([...claims, 'verify-probe-fabricated-label']);
  ok('T8c 正向對照:杜撰標籤偵測對合成的假標籤真的會抓到(不是因為現有文案剛好都合法而恆綠)',
    probe.length === 1 && probe[0] === 'verify-probe-fabricated-label', JSON.stringify(probe));

  // 涵蓋度(brief 原文:「文案要涵蓋使用者實際會遇到的狀態，不能只寫其中一種」)——plus 模式
  // (新訪客,鈕顯示 Plus/軌島 Plus)與 account 模式(已登入或曾登入,鈕顯示 帳號/帳號同步)至少
  // 各被提到一次(桌面或手機任一形式皆可),不能只寫其中一種狀態就當作寫完了。
  const hasPlusMode = !extractError && (claims.includes(plusLabels.toolbar) || claims.includes(plusLabels.drawer));
  const hasAcctMode = !extractError && (claims.includes(acctLabels.toolbar) || claims.includes(acctLabels.drawer));
  ok('T8d app-support.html 同時涵蓋 plus 模式與 account 模式的導覽標籤,不是只寫其中一種使用者會遇到的狀態',
    hasPlusMode && hasAcctMode,
    `plus模式(${JSON.stringify([plusLabels && plusLabels.toolbar, plusLabels && plusLabels.drawer])})提到=${hasPlusMode} account模式(${JSON.stringify([acctLabels && acctLabels.toolbar, acctLabels && acctLabels.drawer])})提到=${hasAcctMode}`);
}

// ══════════ 斷言總數閘門(比照 verify_live_activity.mjs / verify_founding_seal.mjs 的形狀) ══════════
// 用途:條件式區塊整批消失時,分母跟著變小、收尾只印「N/N PASS」⇒ 會被當成全綠。
// 各組用 a/b/c…細分子情境(T0a/T0b/T0c、T2a..T2f、T4a/T4b/T4c、T7a/T7b),分組 regex 要吃任一個
// 小寫字母尾碼,不能只吃 [ab]——吃不到的字母會被靜靜併回不帶字母的裸組,分母對不上還以為是別的錯。
// (T1F/T1R 用大寫字母尾碼,不被 [a-z]? 吃掉,全部併回裸組「T1」,這是刻意的——正向/反向本來就要合看。)
// T1 的預期值是公式不是常數:創始會員那項的存在與否跟著 inFounding(G1 現讀)走,items 數會在
// 截止時點過了之後少一項,T1F/T1T/T1H 的配對數量跟著變;寫死會在那之後變成
// 「為了正確的理由跟預期值對不上」——這正是複審 Important 5 點名的時間炸彈,詳見 T1/G1 註解。
// 組成:1(前置條數) + 4×feats 項數(T1F×2 + T1T×1 + T1H×1) + 1(T1H 正向對照)
//   + 1(T1G0 名單一致) + GATE_CALLS.length(逐個閘門的揭露) + 1(T1G 正向對照)
//   + 1(T1G0b 呼叫點數對帳) + REQUIRED.length(T1R 反向) + 1(無 JS 例外)。
// 三個變數都不是手打的常數:清單一長、多一道付費閘門,分子分母一起長,不必回頭改這個數字。
const EXPECTED_COUNTS = {
  G0: 1, G1: 2, G2: 2, T0: 1, T0a: 1, T0b: 1, T0c: 1,
  T1: 6 + REQUIRED.length + GATE_CALLS.length + 4 * expectedFeatCount(inFounding),
  T2: 1, T2a: 4, T2b: 1, T2c: 1, T2d: 1, T2e: 1, T2f: 1, // T2a=4:違禁詞斷言 + 偵測器正向對照 + 抽取器對照 + 具名豁免對照
  T3: 2, T3a: 1, T3b: 2, T4a: 2, T4b: 2, T4c: 2, T5: 6, T5w: 3, T7a: 4, T7b: 4,
  T8a: 1, T8b: 1, T8c: 2, T8d: 1, // T8=app-support.html 導覽標籤真值比對(見上方 T8 區塊);T8c=核心斷言+杜撰偵測正向對照
};
const actualCounts = {};
for (const r of results) { const m = /^([GT]\d+[a-z]?)/.exec(r.name); const k = m ? m[1] : '(未分組)'; actualCounts[k] = (actualCounts[k] || 0) + 1; }
const groupKeys = [...new Set([...Object.keys(EXPECTED_COUNTS), ...Object.keys(actualCounts)])].sort();
const countMismatch = groupKeys.filter(g => (EXPECTED_COUNTS[g] || 0) !== (actualCounts[g] || 0));
ok('T6 斷言總數閘門:每組實跑條數符合預期(條件式區塊整批消失時,分母變小不會被當成全綠)',
  countMismatch.length === 0,
  countMismatch.length
    ? countMismatch.map(g => `${g}:預期 ${EXPECTED_COUNTS[g] || 0} 實跑 ${actualCounts[g] || 0}`).join(' ; ')
    : groupKeys.map(g => `${g}=${actualCounts[g]}`).join(' '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);

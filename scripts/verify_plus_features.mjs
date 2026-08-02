// Plus 功能清單與文案校正驗證(2026-08-02,Plus 開賣 Task 6)——Playwright 真引擎 + 本機靜態伺服器。
//
// 背景:plusRender() 的 feats 陣列是給使用者看的訂閱賣點清單,過去曾經寫了「衛星底圖」「App 進階
//   定位與 Live Activity」這種對不上任何真實資格判定的項目(前者該是「高解析」、後者定位根本免費、
//   Live Activity 才剛做)。本檔的核心判準:清單上的每一項都要能在程式裡指到一個真的資格判定,
//   而且反過來每個真的資格判定也都要出現在清單裡(防「做了功能但忘了寫進清單」)。
//
// 判準寫在效果上,三條自我約束(比照 verify_live_activity.mjs):
//  (1) 斷言一律落在產品程式碼的行為上(plusRender() 實際渲染出的 DOM 文字、plusRefresh() 實際
//      改動的 state.plus.active),不是落在腳本自己塞進去的字串。REQUIRED 的 symbol 檢查雖然是對
//      index.html 原始碼做 regex,但那正是本檔刻意要驗的東西——「清單與實作有沒有脫鉤」問的就是
//      原始碼裡指不指得到真的判定式,不是 DOM。
//  (2) 每條斷言都配一發瞄準它語意的突變(見檔尾對照表),突變打在**產品碼**上,不是打在 DOM/state。
//  (3) 凡「必須是 0/必須不存在」型的斷言一律配正向對照。
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
const INDEX_MD5 = createHash('md5').update(SRC).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

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

// 真正呼叫產品函式 plusRender(),讀它實際寫進 DOM 的文字——不是腳本自己組字串比對。
const renderFeats = page => page.evaluate(() => {
  plusRender();
  return {
    feats: [...document.querySelectorAll('.plus-feature')].map(el => el.textContent),
    trust: (document.querySelector('.plus-trust') || {}).textContent || '',
  };
});

const cr = await chromium.launch();

// ══════════ REQUIRED 對映表(逐項對映驗證見 task-6-brief.md Step 1 表格,已核過子字串成立) ══════════
// needle 必須是「feats 那一項文案裡真的出現的子字串」——對映靠它,不是靠人眼。
const REQUIRED = [
  { needle: '誤點履歷', symbol: /plusGateOpen\('delay-history'/ },
  { needle: '雲端同步', symbol: /!reason\.startsWith\('logout'\)/ },
  { needle: '行程分享', symbol: /function tripShareVisible\s*\(/ },
  { needle: '高解析', symbol: /function satRetinaAllowed\s*\(/ },
  { needle: '創始會員', symbol: /function foundingFrom\s*\(/ },
  { needle: '動態島', symbol: /function liveActivityAllowed\s*\(/ },
];

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

// ══════════ T1:清單↔實作雙向對映(正向:feats 每項都對得到 REQUIRED 且 symbol 存在;反向:REQUIRED 每項都在 feats 裡) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const { feats, trust } = await renderFeats(page);
  ok('T1 前置:feats 陣列恰有 6 項(舊清單 5 項,少了行程分享;多了就是塞了沒對映的東西)', feats.length === 6, JSON.stringify(feats));
  // 正向:每一項 feats 文字都能在 REQUIRED 找到唯一對應的 needle,且該 symbol 真的存在於 index.html
  feats.forEach((text, i) => {
    const match = REQUIRED.find(r => text.includes(r.needle));
    ok(`T1F feats[${i}] 對得到 REQUIRED 裡的某個 needle`, !!match, text);
    ok(`T1F feats[${i}] 對應的 symbol 存在於 index.html(真的有資格判定,不是空話)`, match ? match.symbol.test(SRC) : false, match ? match.symbol.toString() : '(無對應項目)');
  });
  // 反向:REQUIRED 六項都出現在 feats 裡(防「做了功能但忘了寫進清單」)
  REQUIRED.forEach(r => {
    ok(`T1R REQUIRED[${r.needle}] 出現在 feats 陣列裡`, feats.some(t => t.includes(r.needle)), JSON.stringify(feats));
  });
  ok('T1 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════ T2:文案 gate(窄承諾 + 衛星用詞 + 準確度免費承諾 + 第1項不越界宣稱免費集合) ══════════
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const { feats, trust } = await renderFeats(page);
  // 「永遠免費」是 Step 5 明示保留的唯一例外(它是刻意的分界承諾,不是本次要抓的絕對句)。
  const hasBannedAbsolute = s => {
    const stripped = s.replace(/永遠免費/g, '');
    return stripped.includes('永遠') || s.includes('一個都不會拿走') || s.includes('更清晰');
  };
  const allTexts = [...feats, trust];
  ok('T2a feats 與 plus-trust 皆不含窄承諾違禁詞(「永遠免費」例外)',
    allTexts.every(t => !hasBannedAbsolute(t)), JSON.stringify(allTexts));
  const satItem = feats.find(t => t.includes('高解析')) || '';
  ok('T2b 衛星那項同時含「高解析」與「Retina」', satItem.includes('高解析') && satItem.includes('Retina'), satItem);
  ok('T2c plus-trust 保留「準確度」相關的免費承諾語', trust.includes('準確度'), trust);
  // 已裁示:/api/delay-stats(30 天彙總)零資格檢查、本來就免費,第1項不能宣稱涵蓋它——
  // 只檢查「有沒有提到誤點履歷」抓不到這個缺陷(它本來就提到了),要正面驗證文案scope縮回
  // /api/delay-history 真正獨有的部分(90 天、逐日),且不能重現舊版把兩者混在一起的措辭。
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
  ok('T3a 創始期內(今天,2026-08-02):feats 含「創始會員徽章」', feats.some(t => t.includes('創始會員徽章')), JSON.stringify(feats));
  ok('T3 前置無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errors } = await boot(cr);
  await setPlus(page, false);
  const untilMs = await page.evaluate(() => FOUNDING_UNTIL_MS);
  ok('T3 前置:FOUNDING_UNTIL_MS 可讀取且是合理的未來時刻(晚於今天)', Number.isFinite(untilMs) && untilMs > Date.now(), String(untilMs));
  const future = untilMs + 30 * 86400000; // 期限後 30 天,避開邊界的時區/精度爭議
  await page.evaluate(t => { Date.now = () => t; }, future);
  const { feats } = await renderFeats(page);
  ok('T3b 創始期後(FOUNDING_UNTIL_MS+30天):feats 不再無條件出現「創始會員徽章」(過了期限才訂閱的人拿不到,清單不能繼續宣傳)',
    !feats.some(t => t.includes('創始會員徽章')), JSON.stringify(feats));
  ok('T3b 創始期後:feats 仍有其他 5 項(不是整個清單壞掉,只有這一項消失)',
    feats.length === 5, JSON.stringify(feats));
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

// ══════════ T5:手機四寬度(360/375/414/768,WebKit)——清單 5→6 項且文字變長,不得斷行破版、不得溢出彈窗 ══════════
{
  const wk = await webkit.launch();
  const rows = [];
  for (const w of [360, 375, 414, 768]) {
    const { ctx, page, errors } = await boot(wk, { viewport: { width: w, height: 800 } });
    await setPlus(page, false);
    const geo = await page.evaluate(() => {
      plusRender();
      document.getElementById('plusModal').hidden = false; // 平常靠 plusOpen() 打開,這裡直接量真實佈局要先取消隱藏
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
      // 目前六項文案在 360px 剛好都撐得下單行(見下面 fmt 印出的高度全部相同)——這件事本身不能
      // 當「不斷行破版」的證明,那只證明了「現在還沒撞到」。真的要驗的是排版本身撐不撐得住換行,
      // 手法:直接把最後一項的文字換成刻意過長的字串強迫它換行,量換行後有沒有溢出/疊到鄰項。
      wrap = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.plus-feature')];
        const last = items[items.length - 1], prev = items[items.length - 2];
        last.querySelector('span:last-child').textContent = '這是一段刻意加長用來強迫換行的測試文字，用來確認排版撐得住多行而不會破版或疊到旁邊的項目';
        const r = last.getBoundingClientRect(), pr = last.parentElement.getBoundingClientRect(), pv = prev.getBoundingClientRect();
        return { h: Math.round(r.height), overRight: Math.round(r.right - pr.right), overLeft: Math.round(pr.left - r.left), gapFromPrev: Math.round(r.top - pv.bottom) };
      });
    }
    rows.push({ w, geo, errors, wrap });
    await ctx.close();
  }
  await wk.close();
  const fmt = rows.map(r => `${r.w}px:共${r.geo.count}項 高=${r.geo.overflow.map(o => o.h).join('/')} 右溢=${r.geo.overflow.map(o => o.overRight).join('/')} 左溢=${r.geo.overflow.map(o => o.overLeft).join('/')} 重疊=${r.geo.overlaps.join('/')}`).join(' ; ');
  ok('T5 四寬度(WebKit):Plus 清單恰 6 項', rows.every(r => r.geo.count === 6), fmt);
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

server.close();

// ══════════ 斷言總數閘門(比照 verify_live_activity.mjs / verify_founding_seal.mjs 的形狀) ══════════
// 用途:條件式區塊整批消失時,分母跟著變小、收尾只印「N/N PASS」⇒ 會被當成全綠。
// 各組用 a/b/c…細分子情境(T0a/T0b/T0c、T2a..T2f、T4a/T4b/T4c),分組 regex 要吃任一個小寫字母
// 尾碼,不能只吃 [ab]——吃不到的字母會被靜靜併回不帶字母的裸組,分母對不上還以為是別的錯。
// (T1F/T1R 用大寫字母尾碼,不被 [a-z]? 吃掉,全部併回裸組「T1」,這是刻意的——正向/反向本來就要合看。)
const EXPECTED_COUNTS = {
  G0: 1, T0: 1, T0a: 1, T0b: 1, T0c: 1, T1: 20,
  T2: 1, T2a: 1, T2b: 1, T2c: 1, T2d: 1, T2e: 1, T2f: 1,
  T3: 3, T3a: 1, T3b: 2, T4a: 2, T4b: 2, T4c: 2, T5: 6, T5w: 3,
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

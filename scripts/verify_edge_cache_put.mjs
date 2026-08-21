#!/usr/bin/env node
// worker.js 邊緣快取寫入的回歸閘門。跑法:node scripts/verify_edge_cache_put.mjs
//
// 守的是 2026-08-20 升正式站當下實測到的 bug——`await edge.put(k, res.clone()); return res;`:
// clone 是把同一條 body 串流【分流】給兩個讀者,快取那一份還沒寫完時,緊接著進來的請求
// edge.match 就會讀走半寫入的內容 ⇒ 冷啟填完快取後的下一發回空字串,前端 JSON.parse 失敗。
// curl 連打 8 次會全好,只有緊接冷啟那一發壞,所以症狀看起來像「偶發、找不到」。
//
// 🔴 這個 bug 在 Node 裡【結構上】測不出來:Node 的 clone() 分流是好的,舊寫法在 Node 一樣全綠。
// 真正擋得住回歸的是 G1 的結構性斷言(原始碼裡不准把 clone 交給 cache.put),不是 G3 的端到端;
// G3 守的是另一件事——整條快取路徑真的被跑過,且交給快取那份與回給使用者那份完整且逐字相同。
// (原本各驗收腳本的假快取是 `{ match: async()=>undefined, put: async()=>{} }`,body 一次都沒被讀過,
//  等於整條快取路徑從來沒有被執行過;這裡的假快取會真的把 body 讀出來存起來。)
//
// ⚠️ 要對【正式站】驗這個 bug 有沒有復發:判準是「HTTP 200 但 body 是空字串」,不是「有沒有 502」。
// 兩件事會在同一個時間窗重疊,拿錯判準會把別人的問題當成這個 bug 復發:
//   * 本 bug 的顯形 = 冷啟填完快取後緊接的那一發回 **200 + 空 body**(前端 JSON.parse 失敗)。
//   * promote 當下各 colo 冷啟會同時換 TDX token ⇒ 撞 `tdx auth 429`,那是 **502 + 有內容的
//     錯誤 body**,十秒內自行恢復(2026-08-21 升 v0821e 當下的單次觀測,無對照組:第一發
//     /api/tra-live 回 502 {"error":"tdx auth 429"},接著 10 發全 200;/api/metro-live?sys=mrt
//     前 7 發 502、第 8 發 200)。是不是每次 promote 都這樣還沒被證實。
// ⇒ 對正式站量測請避開升版後前 30 秒,並且只用「200 而 body 為空」開火。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = path.join(ROOT, 'worker.js');
const RAW = readFileSync(SRC_PATH, 'utf8');

let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };

// ══════════════════════════ G0 剝註解(含它自己的控制組)══════════════════════════
// ⚠️ 剝註解不是裝飾:worker.js 的註解裡就白紙黑字寫著那個反例句子,不剝就會比中自己的註解而假紅
// (2026-08-20 第一版正是這樣紅的)。字串/樣板/正則裡的 `//` 不可以被當成註解 ⇒ 要走狀態機,
// 逐行 regex 會把 'https://…' 這種字串切斷。剝完送去 node --check,那是這支狀態機唯一的控制組:
// 剝壞了(把字串或正則切斷)幾乎一定不再是合法的 JS。
function stripComments(src) {
  const REGEX_OK_PUNCT = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_OK_WORD = /(^|[^\w$])(return|typeof|case|in|of|instanceof|new|delete|void|do|else|yield|await)\s*$/;
  let out = '', i = 0, mode = 'code', prevSig = '';
  const frames = [];                    // 樣板字串 ${} 內的巢狀大括號深度
  const n = src.length;
  const regexAllowed = () => REGEX_OK_PUNCT.has(prevSig) || REGEX_OK_WORD.test(out.slice(-16));
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === '/' && regexAllowed()) { mode = 'regex'; out += c; prevSig = c; i++; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '{' && frames.length) frames[frames.length - 1].depth++;
      else if (c === '}' && frames.length) {
        if (frames[frames.length - 1].depth === 0) { frames.pop(); out += c; i++; mode = 'tpl'; continue; }
        frames[frames.length - 1].depth--;
      }
      out += c; i++;
      if (!/\s/.test(c)) prevSig = c;
      continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = 'code'; i += 2; } else { if (c === '\n') out += c; i++; } continue; }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl' || mode === 'regex' || mode === 'class') {
      out += c;
      if (c === '\\') { out += (d === undefined ? '' : d); i += 2; continue; }
      if (mode === 'sq' && c === "'") { mode = 'code'; prevSig = c; }
      else if (mode === 'dq' && c === '"') { mode = 'code'; prevSig = c; }
      else if (mode === 'tpl' && c === '`') { mode = 'code'; prevSig = c; }
      else if (mode === 'tpl' && c === '$' && d === '{') { out += d; frames.push({ depth: 0 }); mode = 'code'; prevSig = '{'; i += 2; continue; }
      else if (mode === 'regex' && c === '[') mode = 'class';
      else if (mode === 'regex' && c === '/') { mode = 'code'; prevSig = c; }
      else if (mode === 'class' && c === ']') mode = 'regex';
      i++; continue;
    }
  }
  return out;
}

console.log('【G0】剝註解');
const CODE = stripComments(RAW);
{
  // 控制組 1:剝完仍是合法的 JS(證明沒有把字串/正則切斷)
  const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'edgecache-')), 'stripped.mjs');
  writeFileSync(tmp, CODE);
  let parseErr = '';
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { parseErr = String((e.stderr || '') || e.message).split('\n').slice(0, 3).join(' '); }
  ck(!parseErr, `剝完仍是合法的 JS(node --check)${parseErr ? ' — ' + parseErr : ''}`);
  // 控制組 2:註解真的被剝掉了。worker.js 的註解裡就白紙黑字寫著 `edge.put(…res.clone())` 這句反例
  // ——它在原始檔裡找得到、在剝完的碼裡找不到,才證明「剝」這件事真的發生了(不剝就會比中它而假紅)。
  const COUNTEREXAMPLE = /edge\.put\([^)]*\.clone\s*\(/;
  ck(COUNTEREXAMPLE.test(RAW), '原始檔裡確實有「edge.put(…res.clone())」這句反例(它寫在註解裡;否則下一條是空轉)');
  ck(!COUNTEREXAMPLE.test(CODE), '剝完的程式碼裡找不到那句反例(紅=它真的出現在程式碼裡了,不是剝註解失敗——看 G1 指的行號)');
  // 控制組 3:程式碼沒有被剝掉(只剝註解,不剝碼)
  ck(CODE.includes('const jsonResCached = (edge, cacheKey, obj, status, cc)'), '程式碼本體還在(抓得到 jsonResCached 定義)');
  ck(CODE.length > RAW.length * 0.5, `剝掉的是註解不是程式碼(${RAW.length} → ${CODE.length} bytes)`);
  // 控制組 4:行數不變 ⇒ 下面報出來的行號可以直接對到 worker.js(剝註解只清內容、保留換行)
  ck(CODE.split('\n').length === RAW.split('\n').length,
    `剝完行數不變(${RAW.split('\n').length} 行),報出來的行號＝worker.js 的行號`);
}

// ══════════════════════════ G1 結構性斷言 ══════════════════════════
// 判準寫「交給快取的是什麼」,不寫「有幾處」——後者會隨端點增減而過期,前者不會。
// 逐一檢查每個 `.put(` 呼叫點的第 2 個參數:
//   (a) 不可以含 .clone()  —— 就是 2026-08-20 那個 bug 的寫法
//   (b) 必須是「當場造出來的」Response(是個呼叫/new,不是裸識別字)——`edge.put(k, res); return res;`
//       是同一個 bug 換一件衣服:body 被快取讀走後,回給使用者的那顆就空了。
function readCallArgs(src, openIdx) {         // openIdx 指向 '(' ;回傳頂層逗號切開的參數字串
  let depth = 0, i = openIdx, cur = '', args = [], q = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { cur += c; if (c === '\\') { cur += src[++i] || ''; } else if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1 && c === '(') { continue; } cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0 && c === ')') { args.push(cur); return { args, end: i }; } cur += c; continue; }
    if (c === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  return { args: null, end: -1 };
}

console.log('【G1】結構性斷言:交給 cache.put 的必須是獨立造出來的 Response');
const putSites = [];
{
  // worker.js 裡的 `.put(` 目前【全部】都是邊緣快取的寫入(D1 用 prepare/bind、記憶體快取用 Map.set),
  // 所以這裡刻意不挑名字(edge/cache/caches.default)而是掃所有 .put( ——換個變數名不會讓斷言失明。
  const re = /\.put\s*\(/g;
  let m;
  while ((m = re.exec(CODE))) {
    const open = m.index + m[0].length - 1;
    const { args } = readCallArgs(CODE, open);
    const line = CODE.slice(0, m.index).split('\n').length;
    putSites.push({ line, args, text: CODE.slice(m.index, m.index + 60).split('\n')[0] });
  }
  const rawCount = (CODE.match(/\.put\s*\(/g) || []).length;
  ck(putSites.length >= 1, `掃到 ${putSites.length} 個 cache.put 呼叫點(0 個代表這整段斷言在空轉)`);
  ck(putSites.length === rawCount, `每個 .put( 都被解析到(${putSites.length}/${rawCount})`);
  ck(putSites.every(s => s.args && s.args.length >= 2), '每個 put 都拿得到第 2 個參數');
}
// 這兩條是核心判準,同一支偵測器等一下會拿去跑突變測試(G2),證明它真的有牙。
const cloneOffenders = s => (s.args || []).slice(1, 2).filter(a => /\.clone\s*\(/.test(a));
const notFreshOffenders = s => (s.args || []).slice(1, 2).filter(a => !/[\w$)\]]\s*\(/.test(a.trim()) && !/^\s*new\s+/.test(a));
{
  const bad = putSites.filter(s => cloneOffenders(s).length);
  ck(bad.length === 0, `沒有把 clone() 交給 cache.put${bad.length ? ' — ' + bad.map(b => `第 ${b.line} 行 ${b.text}`).join('; ') : ''}`);
  const stale = putSites.filter(s => notFreshOffenders(s).length);
  ck(stale.length === 0, `交給 cache.put 的都是當場造出來的 Response,不是回給使用者的那一顆${stale.length ? ' — ' + stale.map(b => `第 ${b.line} 行「${b.args[1].trim()}」`).join('; ') : ''}`);
}
// 呼叫端一律 `return await`。這不是風格:helper 是 async,而這些呼叫幾乎都在 try 裡——
// `return helper(...)`(少了 await)的 rejection【不會】被同一層的 catch 接住(實測:return await → caught,
// return → 例外逃出整個函式),於是 edge.put 一丟例外,「上游掛掉退回舊值/軟失敗」那條退路就整條失效。
const helperCallLines = CODE.split('\n').map((l, i) => ({ n: i + 1, l }))
  .filter(x => /\b(jsonResCached|bodyResCached)\s*\(\s*edge\s*,/.test(x.l) && !/^const\s+(jsonRes|bodyRes)Cached\b/.test(x.l.trim()));
const missingAwait = x => !/return\s+await\s+(json|body)ResCached\s*\(/.test(x.l);
{
  ck(helperCallLines.length >= 10, `掃到 ${helperCallLines.length} 個 helper 呼叫點(太少代表這條斷言在空轉)`);
  const bad = helperCallLines.filter(missingAwait);
  ck(bad.length === 0, `每個呼叫點都是 return await${bad.length ? ' — ' + bad.map(b => `第 ${b.n} 行`).join(', ') : ''}`);
}
{
  // 修法本身的不變量:同一份不可變 body 造兩顆 Response(一顆給快取、一顆回使用者)。
  const helper = CODE.slice(CODE.indexOf('const bodyResCached'), CODE.indexOf('const jsonResCached'));
  ck(helper.length > 100, '抓得到 bodyResCached 本體');
  ck((helper.match(/mk\(\)/g) || []).length >= 2, 'bodyResCached 造了兩顆各自獨立的 Response(mk() 被呼叫兩次)');
  ck((helper.match(/new Response\(/g) || []).length === 1 && /new Response\(body,/.test(helper),
    '兩顆都是從同一個不可變字串 body 造出來的');
}

// ══════════════════════════ G2 突變測試:證明 G1 的偵測器有牙 ══════════════════════════
// 只斷言「找不到壞寫法」而不驗偵測器抓不抓得到,等於用一條永遠為真的規則假裝有守門。
// 三個方向都要:兩種壞寫法必須被抓到,好寫法必須不被抓到(沒有反向對照,「全部都紅」也會通過)。
console.log('【G2】突變測試(偵測器有沒有牙)');
{
  const probe = (snippet) => {
    const open = snippet.indexOf('.put(') + '.put'.length;
    const { args } = readCallArgs(snippet, open);
    const site = { args, line: 0, text: snippet };
    return { clone: cloneOffenders(site).length > 0, notFresh: notFreshOffenders(site).length > 0 };
  };
  const mutantClone = probe('await edge.put(cacheKey, res.clone());');
  ck(mutantClone.clone, '突變①:`edge.put(cacheKey, res.clone())` 會被抓到');
  const mutantBare = probe('await edge.put(cacheKey, res);');
  ck(mutantBare.notFresh, '突變②:`edge.put(cacheKey, res)`(裸識別字)會被抓到');
  const good1 = probe('await edge.put(cacheKey, mk());');
  ck(!good1.clone && !good1.notFresh, '反向對照①:`edge.put(cacheKey, mk())` 不會被誤報');
  const good2 = probe("await edge.put(cacheKey, new Response(body, { status: 200 }));");
  ck(!good2.clone && !good2.notFresh, '反向對照②:`edge.put(cacheKey, new Response(...))` 不會被誤報');
  ck(missingAwait({ l: '    return jsonResCached(edge, cacheKey, x, 200, "cc");' }),
    '突變④:呼叫點少了 await 會被抓到');
  ck(!missingAwait({ l: '    return await jsonResCached(edge, cacheKey, x, 200, "cc");' }),
    '反向對照③:`return await jsonResCached(...)` 不會被誤報');
  // 剝註解那一步的突變:把反例句子從註解搬進程式碼,G1 必須紅
  const injected = stripComments(RAW.replace('async function traLive(request, env, ctx) {',
    'async function traLive(request, env, ctx) {\n  if (0) { const res = jsonRes({}, 200, "x"); await edge.put(cacheKey, res.clone()); return res; }'));
  const injectedSites = [];
  { const re = /\.put\s*\(/g; let m; while ((m = re.exec(injected))) { const { args } = readCallArgs(injected, m.index + m[0].length - 1); injectedSites.push({ args }); } }
  ck(injectedSites.some(s => cloneOffenders(s).length), '突變③:把壞寫法注入真的 worker.js 原始碼,整套 G1 管線(剝註解→解析→判定)會紅');
}

// ══════════════════════════ G3 端到端:整條快取路徑真的跑過一遍 ══════════════════════════
// 假快取的 put 會真的把 body 讀出來存起來(這是 2026-08-20 的教訓:
// `put: async () => {}` 等於整條快取路徑一次都沒被執行過,任何斷言都是空轉)。
console.log('【G3】端到端:交給快取那份與回給使用者那份,完整且逐字相同');
const putLog = [];
globalThis.caches = { default: {
  match: async () => undefined,                       // 永遠 miss,讓每個端點都走完整路徑
  put: async (key, res) => {
    if (res.bodyUsed) throw new Error('cache.put 收到的 Response body 已經被別人讀過了');
    putLog.push({ url: typeof key === 'string' ? key : key.url, status: res.status,
      ct: res.headers.get('content-type'), cc: res.headers.get('cache-control'), body: await res.text() });
  },
} };

// 上游一律走替身:NCDR 給正常回應(走 200 那條),其餘全部丟例外(走各端點的軟失敗/負向快取那條)。
globalThis.fetch = async (input) => {
  const u = String((input && input.url) || input);
  if (u.includes('fixture.local/ncdr')) {
    return new Response(JSON.stringify({ feed: { updated: '2026-08-21T10:00:00+08:00', entry: [] } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('上游替身:刻意打不通 ' + u.slice(0, 60));
};

const mod = await import(path.join(ROOT, 'worker.js'));
const worker = mod.default;
const { openTestDb } = await import(path.join(ROOT, 'scripts/d1_local.mjs'));

const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const YMD = TODAY.replace(/-/g, '');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const statsBlob = JSON.stringify({ at: '2026-08-21', days: 30, trains: [{ no: '123', onTime: 0.93 }, { no: '456', onTime: 0.81 }] });
const schedBlob = JSON.stringify({ days: { [YMD]: { system: '高鐵時刻表', date: YMD, trains: [{ no: '0801', stops: [] }] } } });
const { DELAY_DB } = openTestDb(`
  INSERT INTO kv_blobs (k, v, updated) VALUES ('tra_delay_stats_30d', ${q(statsBlob)}, '2026-08-21');
  INSERT INTO kv_blobs (k, v, updated) VALUES ('thsr_sched', ${q(schedBlob)}, '2026-08-21');
  INSERT INTO tra_station_events (service_date, train_no, sta, status, delay, delay_max, obs_at)
    VALUES ('${TODAY}', '123', '1000', '進站', 3, 5, '${TODAY}T09:00:00Z'),
           ('${TODAY}', '123', '1010', '離站', 4, 5, '${TODAY}T09:20:00Z');
`);
const ASSETS = { fetch: async () => new Response(readFileSync(path.join(ROOT, 'data/bounty_rules.json'), 'utf8'), { status: 200 }) };

// 一次呼叫的完整判定。回傳失敗原因陣列(空=通過)——G4 會拿同一支去驗它抓不抓得到壞掉的情況。
function judge(put, gotBody, gotRes) {
  const bad = [];
  if (!put) { bad.push('快取根本沒被寫入(edge.put 沒被呼叫)'); return bad; }
  if (!put.body || put.body.length === 0) bad.push('交給快取的 body 是空的');
  if (put.body !== gotBody) bad.push(`快取那份與回給使用者那份不同(${put.body.length} vs ${gotBody.length} bytes)`);
  if (put.status !== gotRes.status) bad.push(`status 不同(${put.status} vs ${gotRes.status})`);
  if (put.cc !== gotRes.headers.get('cache-control')) bad.push('cache-control 不同');
  if (put.ct !== gotRes.headers.get('content-type')) bad.push('content-type 不同');
  try { JSON.parse(put.body); } catch (e) { bad.push('交給快取的 body 不是完整的 JSON'); }
  return bad;
}

async function hit(label, urlPath, env, wantStatus) {
  const before = putLog.length;
  let res, body;
  try {
    res = await worker.fetch(new Request('https://railisland.tw' + urlPath), env, { waitUntil() {} });
    body = await res.text();
  } catch (e) { ck(false, `${label} — 端點丟例外 ${String(e && e.message || e)}`); return; }
  const puts = putLog.slice(before);
  ck(res.status === wantStatus, `${label} → ${res.status}`);
  ck(puts.length === 1, `${label} 寫了 1 次邊緣快取(實際 ${puts.length} 次)`);
  const bad = judge(puts[0], body, res);
  ck(bad.length === 0, `${label} 快取那份與回給使用者那份完整且逐字相同(${puts[0] ? puts[0].body.length : 0} bytes)${bad.length ? ' — ' + bad.join('; ') : ''}`);
}

// jsonResCached 路徑(D1 唯讀)
await hit('/api/station-events', '/api/station-events?train=123', { DELAY_DB }, 200);
await hit('/api/today-board', '/api/today-board', { DELAY_DB }, 200);
await hit('/api/thsr-schedule', '/api/thsr-schedule', { DELAY_DB }, 200);
await hit('/api/bounty-board', '/api/bounty-board', { DELAY_DB, ASSETS }, 200);
// bodyResCached 路徑(D1 存的 JSON 字串原樣送出,不經 JSON.stringify)——形狀與上面那組不同,要各驗一次
await hit('/api/delay-stats', '/api/delay-stats', { DELAY_DB }, 200);
// catch 分支的軟失敗/負向快取(上游打不通)——這些路徑同樣會寫快取,同樣會踩到同一個 bug
await hit('/api/ntmetro-live(上游掛)', '/api/ntmetro-live?sys=circular', {}, 200);
await hit('/api/klrt-position(上游掛)', '/api/klrt-position', {}, 200);
await hit('/api/hazard-alert(上游掛→502 負向快取)', '/api/hazard-alert', {}, 502);
mod._hazard.resetHazardMem();
await hit('/api/hazard-alert(正常)', '/api/hazard-alert', { NCDR_ALERT_URL: 'https://fixture.local/ncdr.json' }, 200);
{
  const stats = putLog.find(p => p.url.includes('/api/delay-stats'));
  ck(stats && stats.body === statsBlob, 'delay-stats 交給快取的就是 D1 裡那個字串本身(逐字)');
}

// ══════════════════════════ G4 反向對照:G3 的判定真的抓得到壞掉的情況 ══════════════════════════
console.log('【G4】反向對照(G3 的判定有沒有牙)');
{
  const mkRes = (b, cc) => new Response(b, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc } });
  const good = { status: 200, ct: 'application/json; charset=utf-8', cc: 'public, s-maxage=30', body: '{"a":1}' };
  ck(judge(good, '{"a":1}', mkRes('{"a":1}', 'public, s-maxage=30')).length === 0, '完整且相同 → 判定通過');
  ck(judge({ ...good, body: '' }, '{"a":1}', mkRes('{"a":1}', 'public, s-maxage=30')).length > 0, '快取那份是空 body(就是那個 bug 的顯形)→ 判定會紅');
  ck(judge({ ...good, body: '{"a":1' }, '{"a":1}', mkRes('{"a":1}', 'public, s-maxage=30')).length > 0, '快取那份被截斷 → 判定會紅');
  ck(judge(null, '{"a":1}', mkRes('{"a":1}', 'public, s-maxage=30')).length > 0, '整條快取路徑沒被執行 → 判定會紅');
}

console.log(fail ? `\nFAIL ${fail}` : `\n✅ 全部通過(結構性斷言掃過 ${putSites.length} 個 cache.put 呼叫點)`);
process.exit(fail ? 1 : 0);

// laPushAll(cron 推播主迴圈)的補充驗收——task-6-brief.md 本身沒有替這條迴圈排自動測試
// (Step 6 是手動、待 Task 0 真金鑰才能做的煙測),但它是全功能唯一沒有純函式覆蓋的部分,
// 且 brief 自己點名最容易錯的地方:「把剛 bind 還沒被 TDX 回報的車誤判成走完全程而刪掉」
// (idx<0 的處理)。本檔就是為了在不打真 APNs、不吃 workerd 自簽憑證限制的前提下,把這條
// 迴圈的分支邏輯與「cron 實際傳給三支純函式的欄位形狀」都跑一次真的程式碼路徑。
//
// 為什麼不能用 verify_la_backend.mjs 那套(對 wrangler dev 打 HTTP)：實測 workerd 的
// fetch() 會拒絕自簽 HTTPS 憑證(純 HTTP 到 localhost 正常,自簽 HTTPS 一律回
// "internal error"),而 laPushAll 打 APNs 的 URL scheme 是寫死的 https://。改用
// wrangler 套件的 getPlatformProxy() 在 Node 端直接取得真的 D1 binding、直接呼叫
// laPushAll(不經 HTTP),此時 fetch 只是一般的 Node 全域函式,可以整個換掉——
// 換掉的 fetch 會攔到 laPushAll 打 APNs、以及(tra_sched 情境)traLive 打 TDX 的兩段
// upstream 呼叫,兩者都回傳我們自己控制的假回應,同時把呼叫參數記下來供斷言。
//
// 判準獨立性(心得29):arrivalDate/departedDate 的期望值一律用 Date 算術直接算,
// 不呼叫 laArrivalIso 自己——那樣會變成「驗證這支函式跟自己一致」而不是「驗證值對不對」。
//
// 本檔只讀/寫本機 D1(la_bindings),不影響 verify_la_backend.mjs 既有的 34 條斷言。
//
// 修復輪次1(獨立驗收 1 Critical + 9 Important 之後):P1/P1host/P1log/P5/P6/P6c 是原地
// 改寫(Critical1 的刪列改看 reason 不看 status、Important8/9 的兩側閘門與欄位契約),
// P13-P17 是新增的 Group C,逐項收 Important1/2/4/5/6(3 併入 P1log/P15、7 在
// verify_la_backend.mjs 的 J4/J5——JWT 簽章邏輯的家在那邊)。
import { getPlatformProxy } from 'wrangler';
import { readFileSync } from 'node:fs';

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
let printed = false;
function summary(reason) {
  if (printed) return;
  printed = true;
  const bad = results.filter(r => !r.p).length;
  console.log(reason
    ? `\n總計(補充/中止,未完成) ${results.length} 項,FAIL ${bad} — 原因:${reason}`
    : `\n總計(補充) ${results.length} 項,FAIL ${bad}`);
}
function abort(reason) { console.error(reason); summary(reason); process.exit(2); }
const fatal = (tag) => (e) => {
  console.error(e && e.stack ? e.stack : String(e));
  abort(`${tag}:${String((e && e.message) || e).split('\n')[0]}`);
};
process.on('uncaughtException', fatal('未攔截例外,腳本中止'));
process.on('unhandledRejection', fatal('未處理的 promise rejection,腳本中止'));
process.on('exit', () => { if (!printed) { summary('行程在印出「總計」之前就結束了'); process.exitCode = 2; } });

const WT = process.env.LA_WT;
if (!WT) abort('請設 LA_WT=<git worktree add --detach 起的乾淨副本絕對路徑,且已套用 schema/*.sql>');

// ── 時間與網路都換成可控的假身:laPushAll 內部用 Date.now()/fetch,兩者在 Node 都是
// 一般可覆寫的全域,換掉之後整條迴圈的時間與上游呼叫都在我們手上 ──
let mockNowSec = 1_800_000_000;
const realDateNow = Date.now;
Date.now = () => mockNowSec * 1000;

const AUTH_URL_FRAG = 'openid-connect/token';
const TDX_API_FRAG = 'TrainLiveBoard';
const APNS_FRAG = '/3/device/';
const calls = [];               // 每次 fetch 的紀錄:{dest,url,init}
let apnsNextStatus = 200;       // 下一發 APNs 呼叫要回的狀態碼
let apnsNextReason = '';        // 修復輪次1(Critical1):非 2xx 時的 body.reason,delPushAll 現在看這個決定要不要刪列
let apnsRejectToken = null;     // 修復輪次1(Important2):設了就讓「打到這個 token」的那發 fetch 直接 reject(模擬網路層失敗)
let apnsHangToken = null;       // 最終複審 A-I2:設了就讓「打到這個 token」的那發 fetch【永遠不 resolve】
                                 // (模擬 APNs 端 stall/連線黑洞——Cloudflare 明文對單一 subrequest 沒有時間上限)。
                                 // 與 apnsRejectToken 是兩種不同的失效:reject 會立刻回來,hang 不會。
let apnsPerToken = {};          // 修復輪次2(批次熔斷):token → {status,reason} 覆寫,不在表裡的 token 走全域 apnsNextStatus/apnsNextReason——
                                 // 熔斷的「少數列失效、其餘成功」情境需要同一批裡不同列拿到不同回應,原本的全域兩個變數做不到。
let apnsAdvanceMs = 0;          // 修復輪次4(牆鐘預算):每發一次 APNs 就把假時鐘往前推這麼多毫秒。
                                 // laPushAll 的單 tick 成本上界改成「牆鐘預算」之後,要驗它就必須讓時間在迴圈中真的前進;
                                 // 刻意放在成功/失敗兩條路徑之前——真實世界的一次網路往返不管結果如何都要花時間,
                                 // 而「上界與失敗樣態無關」正是這個修法要證明的性質。
let tdxBoard = null;            // null=TDX 呼叫要失敗(模擬上游掛掉);否則是 TrainLiveBoards 陣列
let tdxAuthFail = false;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.includes(APNS_FRAG)) {
    if (apnsAdvanceMs) mockNowSec += apnsAdvanceMs / 1000;
    if (apnsRejectToken && u.includes(apnsRejectToken)) throw new Error('[verify_la_push_loop] 模擬 APNs 網路層 reject(Important2 測試)');
    if (apnsHangToken && u.includes(apnsHangToken)) return new Promise(() => {});   // 永不 resolve(A-I2 測試)
    const overrideTok = Object.keys(apnsPerToken).find(t => u.includes(t));
    const status = overrideTok ? apnsPerToken[overrideTok].status : apnsNextStatus;
    const reason = overrideTok ? apnsPerToken[overrideTok].reason : apnsNextReason;
    return new Response(JSON.stringify({ reason }), { status });
  }
  if (u.includes(AUTH_URL_FRAG)) {
    if (tdxAuthFail) return new Response('unauthorized', { status: 401 });
    return new Response(JSON.stringify({ access_token: 'fake-tdx-token', expires_in: 86400 }), { status: 200 });
  }
  if (u.includes(TDX_API_FRAG)) {
    if (tdxBoard === null) return new Response('bad gateway', { status: 502 });
    return new Response(JSON.stringify({ UpdateTime: new Date(mockNowSec * 1000).toISOString(), TrainLiveBoards: tdxBoard }), { status: 200 });
  }
  throw new Error(`[verify_la_push_loop] 未預期的 fetch 目標(測試設計漏配):${u}`);
};

// 修復輪次1(Important3):暫時接管 console.log/error,讓斷言能檢查「有沒有留下 log」,
// 而不是只看回傳值——laPushAll 是 cron 內部呼叫,回傳值會被 ctx.waitUntil 吞掉,
// 出問題時營運端唯一看得到的只有 log。
async function captureConsole(fn) {
  const origLog = console.log, origErr = console.error;
  const logLines = [], errLines = [];
  console.log = (...a) => { logLines.push(a.map(String).join(' ')); };
  console.error = (...a) => { errLines.push(a.map(String).join(' ')); };
  try { return { result: await fn(), logLines, errLines }; }
  finally { console.log = origLog; console.error = origErr; }
}

// caches.default:traLive 進來第一件事就查邊緣快取。Node 沒有這個全域,補一個永遠 miss 的假身,
// 讓它照真實邏輯往下走到 fetch(不是為了測快取本身——快取行為不在本檔範圍)。
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const { env, dispose } = await getPlatformProxy({ configPath: `${WT}/wrangler.jsonc` });
// 修復輪次1(Important8 延伸):沒有 APNS_KEY_P8 時 laPushAll 在 worker.js 第一行就早退成
// no-op(回 {sent:0,dropped:0}),後面一大堆 `=== 0` 的斷言會全數假綠——缺這道 gate 的話,
// 整支腳本可能自始至終都在驗證「函式沒被呼叫過」而不是「函式行為正確」。
if (!env.APNS_KEY_P8) abort('目標 worktree 的 .dev.vars 沒有設定 APNS_KEY_P8——laPushAll 會早退成 no-op,後面所有斷言都會假綠,請先確認 .dev.vars');
// 修復輪次1(Important8):拿掉 worktree .dev.vars 可能帶的 APNS_HOST,讓本檔其餘測試的
// 「預設打 production host」假設不被本機 dev 設定牽動;APNS_HOST 兩側各自的驗證在下面
// P1host 區塊用 env 複本獨立測,不依賴這裡的狀態。
if ('APNS_HOST' in env) delete env.APNS_HOST;
const worker = await import(`${WT}/worker.js`);
const { laPushAll } = worker._la;
if (typeof laPushAll !== 'function') abort('worker.js 沒有導出 _la.laPushAll,無法測試(檢查 worker.js 底部 export 區塊)');

const fakeCtx = { waitUntil(p) { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
const BASE_URL = 'https://dummy.invalid';   // laPushAll 只用它組 Request URL,實際發哪支上游由上面的假 fetch 決定

async function delRow(token) { await env.DELAY_DB.prepare('DELETE FROM la_bindings WHERE token=?').bind(token).run(); }
async function insRow(row) {
  await env.DELAY_DB.prepare(
    // last_obs_idx(工項 B)預設 -1＝「還沒有任何觀測」,last_notice(複審 C-1)預設 0＝
    // 「上一次送出去的卡沒有掛告知」,兩者都與 laBind 新綁的列一致;
    // 要造「表定已經推過頭」「上一輪掛過告知」的情境就顯式傳值。
    'INSERT INTO la_bindings (token,uid,sys,train_no,stops,sta_map,stop_codes,last_idx,last_obs_idx,last_delay,last_notice,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(row.token, row.uid || 'u1', row.sys, row.train_no, JSON.stringify(row.stops),
    JSON.stringify(row.staMap || {}), JSON.stringify(row.stopCodes || []),
    row.last_idx, row.last_obs_idx == null ? -1 : row.last_obs_idx,
    row.last_delay, row.last_notice == null ? 0 : row.last_notice,
    row.bound_at, row.expire_at).run();
}
async function getRow(token) {
  const rs = await env.DELAY_DB.prepare('SELECT * FROM la_bindings WHERE token=?').bind(token).all();
  return rs.results[0] || null;
}
function tok(tag) { return (tag + '0'.repeat(64)).slice(0, 64); }   // 湊成 64 字元,laPushAll 本身不驗格式,純粹方便辨識

// 修復輪次4:把「這一 tick 到底打了哪些 token」直接從 fetch 紀錄還原成集合。
// 舊 P23 用「last_idx 還是 -1」當作「這列沒被碰過」的證據,但那個值在「被打過但失敗」時
// 同樣成立 ⇒ 對「有沒有被碰過」恆真、完全沒有牙。凡是要斷言「誰被服務到/誰沒有」,
// 一律用這個集合當證據(它直接來自受測物真的發出去的請求,不是下游狀態的推論)。
const servedSet = (list) => new Set(list.filter(c => c.url.includes(APNS_FRAG)).map(c => c.url.split(APNS_FRAG)[1]));
// 修復輪次4:旋轉起始偏移(見 worker.js LA_TICK_BUDGET_MS 附近註解)讓「這一 tick 先服務誰」
// 取決於 rows.length,所以凡是要斷言「服務到的是哪幾列」的區塊,必須先把表清乾淨、再自檢
// 列數真的等於自己插入的數量——否則前面區塊殘留的列會讓偏移算出別的值(心得32:驗收腳本的
// 第一道 gate 就要自檢「驗的對象是不是我以為的那個」)。
async function resetTable() { await env.DELAY_DB.prepare('DELETE FROM la_bindings').run(); }
async function rowCount() { const rs = await env.DELAY_DB.prepare('SELECT COUNT(*) AS n FROM la_bindings').all(); return rs.results[0].n; }
// 一批同形狀的列:stops 都是「兩站、第一站還沒到」⇒ laSchedIdx 回 0,與 last_idx(-1)不同 ⇒ 每列都會真的推。
async function insBatch(tokens, base) {
  for (let i = 0; i < tokens.length; i++) {
    await insRow({
      token: tokens[i], sys: 'thsr_sched', train_no: '9' + String(i).padStart(3, '0'),
      stops: [{ name: 'A' + i, at: base + 100 }, { name: 'B' + i, at: base + 200 }],
      last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 + i,   // expire_at 遞增 ⇒ ORDER BY expire_at ASC 的順序＝陣列順序
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// SCHEMA(第一道 gate,心得 32／複審 M-3):被測的那個 D1 到底有沒有這支腳本假設的欄位?
// 少一欄的症狀是「推播成功後那發 UPDATE 拋 no such column ⇒ 落進 per-row catch ⇒
// 一堆斷言以『沒推』的形式假綠」,而 schema 檔分成 0003 建表 ＋ 0004/0005/0006 補丁兩條路
// (欄位順序還不一樣),很容易套漏一支。這條把「驗的對象結構正確」變成具名斷言。
// 只比對【欄位名集合】不比對順序:所有存取都是具名的(SELECT * ＋ 具名 INSERT/UPDATE),
// 順序不同不影響正確性,但少一欄一定要紅。
{
  const rs = await env.DELAY_DB.prepare("SELECT name FROM pragma_table_info('la_bindings')").all();
  const cols = (rs.results || []).map(r => r.name).sort();
  const WANT = ['token', 'uid', 'sys', 'train_no', 'stops', 'sta_map', 'stop_codes',
    'last_idx', 'last_obs_idx', 'last_delay', 'last_notice', 'fail_streak', 'bound_at', 'expire_at'].sort();
  ok('SCHEMA 本機 D1 的 la_bindings 欄位集合與 schema/0003＋0004/0005/0006 一致(套漏補丁會讓整批斷言以「沒推」假綠)',
    JSON.stringify(cols) === JSON.stringify(WANT),
    `實際=${JSON.stringify(cols)}${JSON.stringify(cols) === JSON.stringify(WANT) ? '' : ` 期望=${JSON.stringify(WANT)}`}`);

  // 🔴 複審 N(把關2):上面那條看的永遠是【本機這顆用 ALTER 一路拼出來的庫】(欄位順序也是
  // 補丁路徑的)。正式庫走的是另一條路——全新庫直接套 0003 建表。那條路徑從來沒有任何自動
  // 檢查跑過:0003 與補丁檔日後只改其中一支(漂移)不會有東西轉紅,而症狀是【只在正式庫發生】
  // 的「no such column」。這條直接讀 0003 的 CREATE TABLE 區塊解出欄位名,與同一份 WANT 對照。
  // 分母閘門比照 PSWIFT:解出 0 欄(檔案搬家／regex 失配)也必須 FAIL,不可以因為空集合而假綠。
  let sqlCols = [];
  try {
    const sql = readFileSync(`${WT}/schema/0003_live_activity.sql`, 'utf8');
    const blk = sql.match(/CREATE\s+TABLE[^(]*la_bindings\s*\(([\s\S]*?)\n\);/i);
    if (blk) {
      const body = blk[1].split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      sqlCols = [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(?:TEXT|INTEGER)\b/gim)].map(x => x[1]);
    }
  } catch (e) { sqlCols = []; }
  ok('SCHEMA 前置(分母閘門):從 schema/0003_live_activity.sql 的 CREATE TABLE 解得出欄位(解不出＝這條核對等於沒有)',
    sqlCols.length >= 10, `解到 ${sqlCols.length} 個:${JSON.stringify(sqlCols)}`);
  ok('SCHEMA(把關2)全新庫路徑:schema/0003 建表的欄位集合 === 同一份 WANT(0003 與補丁檔漂移只會在正式庫現形,本機那顆 ALTER 拼出來的庫照不到)',
    JSON.stringify(sqlCols.slice().sort()) === JSON.stringify(WANT),
    `0003=${JSON.stringify(sqlCols.slice().sort())}${JSON.stringify(sqlCols.slice().sort()) === JSON.stringify(WANT) ? '' : ` 期望=${JSON.stringify(WANT)}`}`);
}

// ══════════════════════════════════════════════════════════════════
// PSWIFT(跨行程契約):content-state 的欄位集合必須逐字等於 Swift ContentState 的屬性名。
// 這條契約失效時【兩端都看不到】:裝置端 JSONDecoder 靜默失敗(整張卡不再更新)、伺服器端
// APNs 照樣回 200。舊寫法是把 Swift 的欄位【手抄】成 CONTRACT_KEYS 常數,兩邊各改各的
// 不會有人報警——這裡改成直接讀 Swift 原始碼解出屬性名,讓它變成機器核對的。
// 分母閘門:解不出屬性(regex 失配、檔案搬家)一律 FAIL,不可以因為解出空集合而假綠。
// ══════════════════════════════════════════════════════════════════
const SWIFT_ATTRS_PATH = `${WT}/app/ios/App/App/RailFollowAttributes.swift`;
let swiftProps = [];
try {
  const src = readFileSync(SWIFT_ATTRS_PATH, 'utf8');
  // 只取 struct ContentState 的大括號區塊(下一個同縮排的 `}` 為止),避免掃到 Attributes 本身的欄位
  const m = src.match(/struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s{4}\}/);
  if (m) swiftProps = [...m[1].matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(x => x[1]);
} catch (e) { swiftProps = []; }
ok(`PSWIFT 前置(分母閘門):從 ${SWIFT_ATTRS_PATH.split('/').slice(-1)[0]} 解得出 ContentState 的屬性(解不出＝這條契約檢查等於沒有)`,
  swiftProps.length >= 5, `解到 ${swiftProps.length} 個:${JSON.stringify(swiftProps)}`);
// 期望值獨立寫死一份(心得29:判準不可與被測物同源)——Swift 側與 worker.js 側都要對上它,
// 三方任何一方漂移都會現形,而不是「兩邊一起改壞、對照組跟著錯」。
const CONTRACT_KEYS_EXPECT = ['arrivalDate', 'delaySec', 'departedDate', 'nextStop', 'terminus', 'notice'];
const CONTRACT_KEYS_SORTED = CONTRACT_KEYS_EXPECT.slice().sort();
ok('PSWIFT(跨行程契約)Swift ContentState 的屬性集合 === 後端 content-state 的契約欄位集合',
  JSON.stringify(swiftProps.slice().sort()) === JSON.stringify(CONTRACT_KEYS_SORTED),
  `swift=${JSON.stringify(swiftProps.slice().sort())} expect=${JSON.stringify(CONTRACT_KEYS_SORTED)}`);
// notice 必須是 Optional:非 Optional 的新欄位會讓「App 更新前就開著的卡」整包解不出來。
const noticeDecl = (readFileSync(SWIFT_ATTRS_PATH, 'utf8').match(/^\s*var\s+notice\s*:.*$/m) || ['(全檔找不到 var notice 的宣告)'])[0].trim();
ok('PSWIFT(跨行程契約)notice 在 Swift 側宣告成 Optional(String?)——非 Optional 會讓舊卡整包解碼失敗',
  /^var\s+notice\s*:\s*String\?$/.test(noticeDecl), noticeDecl);

// ══════════════════════════════════════════════════════════════════
// PNOTICE1(複審 N(把關1)):last_notice 只存布林(0/1),而布林只夠表達「目前全系統只有一句
// 告知」。這條約束的形態是「未來有人新增第二句文案」,而寫在 schema 註解裡的警告只在那個人
// 剛好讀到時才生效。照 PSWIFT 的手法直接讀 worker.js 原始碼數告知常數,把它變成機器核對:
// 出現第二句 ⇒ 這裡當場紅,那個人會被擋下來,而不是靜默留下「換一句話不會觸發推播」的 bug。
// (現況刻意【不】改成存字串或雜湊——只有一句話時那是替還沒發生的需求付結構成本。)
// 分母閘門比照 PSWIFT:解出 0 個(檔案搬家／改名／regex 失配)也要 FAIL。
// ══════════════════════════════════════════════════════════════════
const noticeConsts = [...readFileSync(`${WT}/worker.js`, 'utf8')
  .matchAll(/^const\s+(LA_NOTICE_[A-Z0-9_]+)\s*=/gm)].map(x => x[1]);
ok('PNOTICE1 前置(分母閘門):從 worker.js 解得出告知文案常數(解不出＝這條把關等於沒有)',
  noticeConsts.length >= 1, `解到 ${noticeConsts.length} 個:${JSON.stringify(noticeConsts)}`);
ok('PNOTICE1(把關1)worker.js 的 LA_NOTICE_* 告知常數恰好 1 個——出現第二句文案時 last_notice 必須改存字串或雜湊,否則「換一句話」不會觸發推播(判定式比的是布林,兩句話都是 1)',
  noticeConsts.length === 1, JSON.stringify(noticeConsts));

// ══════════════════════════════════════════════════════════════════
// Group A:thsr_sched(表定退路 laSchedIdx),不觸發 traLive/TDX
// ══════════════════════════════════════════════════════════════════
{
  const T = tok('p1');
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [
    { name: '南港', at: mockNowSec + 600 },
    { name: '台北', at: mockNowSec + 1200 },
    { name: '板橋', at: mockNowSec + 1800 },
  ];
  await insRow({ token: T, sys: 'thsr_sched', train_no: '101', stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 8 * 3600 });

  // P1:新綁定,第一站還沒到 → laSchedIdx 回 0,與 last_idx(-1)不同 → 應該推播
  calls.length = 0; apnsNextStatus = 200;
  const r1 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P1 新綁定進度前進(-1→0)觸發推播', r1.sent === 1 && r1.dropped === 0, JSON.stringify(r1));
  const apnsCalls1 = calls.filter(c => c.url.includes(APNS_FRAG));
  ok('P1 恰好打了一次 APNs', apnsCalls1.length === 1, `count=${apnsCalls1.length}`);
  if (apnsCalls1.length === 1) {
    const { url, init } = apnsCalls1[0];
    ok('P1 APNs URL 含 device token', url === `https://api.push.apple.com/3/device/${T}`, url);
    const h = init.headers;
    ok('P1 apns-topic 帶 liveactivity 後綴', h['apns-topic'] === 'tw.railisland.app.push-type.liveactivity', h['apns-topic']);
    ok('P1 apns-push-type=liveactivity', h['apns-push-type'] === 'liveactivity', h['apns-push-type']);
    ok('P1 apns-priority=5(不計入更新預算)', h['apns-priority'] === '5', h['apns-priority']);
    ok('P1 authorization 是 bearer+JWT(三段式)', /^bearer [^.]+\.[^.]+\.[^.]+$/.test(h.authorization), h.authorization.slice(0, 20) + '…');
    const body = JSON.parse(init.body);
    ok('P1 body.aps.content-state.nextStop = 南港(idx0)', body.aps['content-state'].nextStop === '南港', JSON.stringify(body.aps['content-state']));
    // 🔴 修復輪次1(Important9):欄位集合照 Swift ContentState 契約獨立驗(design.md §5.1),
    // 不是照實作目前送什麼反推——這樣才抓得到「少送一個欄位」或「多送一個沒人要的欄位」。
    const csKeys = Object.keys(body.aps['content-state']).sort();
    const CONTRACT_KEYS = CONTRACT_KEYS_SORTED;
    ok('P1(Important9)content-state 欄位集合與 Swift ContentState 契約完全一致(不多不少)',
      JSON.stringify(csKeys) === JSON.stringify(CONTRACT_KEYS), JSON.stringify(csKeys));
    // 🔴 工項 A:notice 只在【上游整批失效的台鐵列】才可以有值。高鐵本來就沒有即時資料,
    // 掛「即時資料中斷」是說謊。這條是「斷線才送」的反面守衛(正面在 P36)。
    ok('P1(工項A 反向)高鐵列(無即時資料來源)的 notice 必須是 null,不可誤掛斷線告知',
      body.aps['content-state'].notice === null, String(body.aps['content-state'].notice));
    // 🔴 修復輪次1(資料契約變更):arrivalDate/departedDate 改送 epoch 秒數字,不送 ISO 字串
    // ——Swift 端 JSONDecoder 預設 .deferredToDate 解的是 timeIntervalSinceReferenceDate,
    // 不是 ISO 8601。期望值獨立用算術算,不呼叫 laArrivalEpoch 自己(心得29:判準不可與被測物同源)。
    const expectArrival = stops[0].at;   // delaySec=0,還沒到站 ⇒ 就是表定時刻本身
    ok('P1 arrivalDate 是 epoch 秒數字且獨立算術核對(未過站)',
      body.aps['content-state'].arrivalDate === expectArrival && typeof body.aps['content-state'].arrivalDate === 'number',
      String(body.aps['content-state'].arrivalDate));
    ok('P1 departedDate=null(idx=0 無前一站)', body.aps['content-state'].departedDate === null, String(body.aps['content-state'].departedDate));
    ok('P1 terminus=板橋(最後一站)', body.aps['content-state'].terminus === '板橋', body.aps['content-state'].terminus);
  } else {
    // 🔴 最終複審 C1-Minor-5:這個條件式區塊原本【沒有 else】,APNs 呼叫數不是 1 的時候
    // 裡面 10 條斷言(含守 Swift ContentState 欄位契約的那條)會【無聲消失】,總計行的分母
    // 跟著縮水而沒有任何人報警。同形狀的 P3/P10/P13 本來就有回填,這裡補齊。
    for (const n of ['P1 APNs URL 含 device token', 'P1 apns-topic 帶 liveactivity 後綴',
      'P1 apns-push-type=liveactivity', 'P1 apns-priority=5(不計入更新預算)',
      'P1 authorization 是 bearer+JWT(三段式)', 'P1 body.aps.content-state.nextStop = 南港(idx0)',
      'P1(Important9)content-state 欄位集合與 Swift ContentState 契約完全一致(不多不少)',
      'P1(工項A 反向)高鐵列(無即時資料來源)的 notice 必須是 null,不可誤掛斷線告知',
      'P1 arrivalDate 是 epoch 秒數字且獨立算術核對(未過站)',
      'P1 departedDate=null(idx=0 無前一站)', 'P1 terminus=板橋(最後一站)'])
      ok(n, false, `(APNs 呼叫數=${apnsCalls1.length},結構性略過)`);
  }
  const row1 = await getRow(T);
  ok('P1 推播成功後 D1 last_idx 更新成 0', !!row1 && row1.last_idx === 0 && row1.last_delay === 0, row1 ? `last_idx=${row1.last_idx}` : '(查無列)');

  // P1log(修復輪次1 Important3):每個 tick 結束要留下 sent/dropped 摘要 log——laPushAll
  // 是 cron 內部呼叫,回傳值會被 ctx.waitUntil 吞掉,出問題時營運端唯一看得到的只有 log。
  {
    const Tlog = tok('p1log');
    await delRow(Tlog);
    mockNowSec += 1;
    const stopsLog = [{ name: 'L0', at: mockNowSec + 100 }, { name: 'L1', at: mockNowSec + 200 }];
    await insRow({ token: Tlog, sys: 'thsr_sched', train_no: '9log', stops: stopsLog, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
    calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
    const { result: rlog, logLines } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
    ok('P1log(Important3)tick 結束留下 sent/dropped 摘要 log',
      logLines.some(l => l.includes('tick 完成') && l.includes(`sent=${rlog.sent}`) && l.includes(`dropped=${rlog.dropped}`)),
      JSON.stringify(logLines));
    await delRow(Tlog);
  }

  // P1host(修復輪次1 Important8):APNS_HOST 是具名的兩側閘門——沒設要走 production,
  // 設了要真的生效,不能被忽略。用 env 複本各自獨立測,不依賴 worktree .dev.vars 的內容
  // (上面已經把 env.APNS_HOST 拿掉,所以「沒設」這一側現在不論 .dev.vars 寫什麼都成立)。
  {
    const Th = tok('p1host');
    await delRow(Th);
    mockNowSec += 1;
    const stopsH = [{ name: 'H0', at: mockNowSec + 100 }, { name: 'H1', at: mockNowSec + 200 }];
    await insRow({ token: Th, sys: 'thsr_sched', train_no: '9host', stops: stopsH, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
    calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
    await laPushAll(env, fakeCtx, BASE_URL);
    const c1 = calls.filter(c => c.url.includes(APNS_FRAG))[0];
    ok('P1host(Important8正面)沒設 APNS_HOST 時打 production host',
      !!c1 && c1.url.startsWith('https://api.push.apple.com/'), c1 ? c1.url : '(無呼叫)');
    await delRow(Th);

    await insRow({ token: Th, sys: 'thsr_sched', train_no: '9host2', stops: stopsH, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
    calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
    const envSandbox = { ...env, APNS_HOST: 'api.sandbox.push.apple.com' };
    await laPushAll(envSandbox, fakeCtx, BASE_URL);
    const c2 = calls.filter(c => c.url.includes(APNS_FRAG))[0];
    ok('P1host(關鍵,Important8反面)設了 APNS_HOST 就真的生效,不是被忽略',
      !!c2 && c2.url.startsWith('https://api.sandbox.push.apple.com/'), c2 ? c2.url : '(無呼叫)');
    await delRow(Th);
  }

  // P2:狀態沒變(idx 仍是 0、delay 仍是 0)→ 不該再推
  calls.length = 0;
  const r2 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P2 狀態未變不推播', r2.sent === 0 && r2.dropped === 0, JSON.stringify(r2));
  ok('P2 沒有任何 APNs 呼叫', calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, String(calls.length));

  // P3:時間前進到「第一站已過、第二站未到」→ laSchedIdx 回 1,應再次推播,departedDate 應該有值
  mockNowSec = stops[0].at + 5;
  calls.length = 0; apnsNextStatus = 200;
  const r3 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P3 進度前進(0→1)再次推播', r3.sent === 1, JSON.stringify(r3));
  const apnsCalls3 = calls.filter(c => c.url.includes(APNS_FRAG));
  if (apnsCalls3.length === 1) {
    const body = JSON.parse(apnsCalls3[0].init.body);
    ok('P3 nextStop=台北(idx1)', body.aps['content-state'].nextStop === '台北', body.aps['content-state'].nextStop);
    const expectDeparted = stops[0].at;   // delaySec=0 ⇒ departedDate = prev.at + 0
    ok('P3 departedDate 是 epoch 秒數字且獨立算術核對(=前一站表定時刻)',
      body.aps['content-state'].departedDate === expectDeparted && typeof body.aps['content-state'].departedDate === 'number',
      String(body.aps['content-state'].departedDate));
  } else ok('P3 APNs 呼叫次數應為 1(結構性略過後續細項)', false, `count=${apnsCalls3.length}`);

  // P4:時間前進到全部站過完 → 應收卡(D1 刪列)
  // 🔴 最終複審 B-I3:收卡現在會先送一發 event:'end' 的推播再刪列。舊斷言「沒有 APNs 呼叫」
  // 因此改成「恰好一發、而且是 end」——那一發正是修法的全部內容,不驗它等於沒驗。
  // 「背景跑到終點」是主線情境:App 不在前景時前端那條收卡路徑根本不會執行,不送 end 的話
  // 鎖屏卡片會留到 8 小時 staleDate。
  mockNowSec = stops[stops.length - 1].at + 999;
  calls.length = 0;
  const r4 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P4 全程走完不計入 sent/dropped', r4.sent === 0 && r4.dropped === 0, JSON.stringify(r4));
  const apnsCalls4 = calls.filter(c => c.url.includes(APNS_FRAG));
  ok('P4(B-I3 關鍵)全程走完恰好送一發收卡推播', apnsCalls4.length === 1, `count=${apnsCalls4.length}`);
  if (apnsCalls4.length === 1) {
    const aps4 = JSON.parse(apnsCalls4[0].init.body).aps;
    ok('P4(B-I3 關鍵)收卡推播 event=end(不是 update——update 收不掉鎖屏卡片)', aps4.event === 'end', String(aps4.event));
    ok('P4(B-I3 關鍵)收卡推播帶 dismissal-date=now(不帶的話系統仍會留著卡片)',
      aps4['dismissal-date'] === mockNowSec, String(aps4['dismissal-date']));
    ok('P4(B-I3)收卡推播打的是這一列自己的 token', apnsCalls4[0].url.endsWith('/3/device/' + T), apnsCalls4[0].url);
    ok('P4(B-I3)收卡推播的 content-state 欄位集合仍符合 Swift 契約(不多不少)',
      JSON.stringify(Object.keys(aps4['content-state']).sort()) === JSON.stringify(CONTRACT_KEYS_SORTED),
      JSON.stringify(Object.keys(aps4['content-state']).sort()));
    ok('P4(B-I3)收卡推播的 nextStop＝終點站', aps4['content-state'].nextStop === stops[stops.length - 1].name, String(aps4['content-state'].nextStop));
  } else {
    for (const n of ['P4(B-I3 關鍵)收卡推播 event=end(不是 update——update 收不掉鎖屏卡片)',
      'P4(B-I3 關鍵)收卡推播帶 dismissal-date=now(不帶的話系統仍會留著卡片)',
      'P4(B-I3)收卡推播打的是這一列自己的 token',
      'P4(B-I3)收卡推播的 content-state 欄位集合仍符合 Swift 契約(不多不少)',
      'P4(B-I3)收卡推播的 nextStop＝終點站']) ok(n, false, `(收卡推播數=${apnsCalls4.length},結構性略過)`);
  }
  const row4 = await getRow(T);
  ok('P4 全程走完後 D1 列被刪除(收卡)', row4 === null, row4 ? JSON.stringify(row4) : '(已刪除)');
  // 🔴 B-I3 的另一半:end 推播【失敗】時仍然要刪列——不可以因為推播失敗就把列留著永遠重試
  // (那會變成另一個「每分鐘重推同一張卡」的來源,正是整套設計最想防的失效模式)。
  {
    const T4b = tok('p4b');
    await delRow(T4b);
    const st4b = [{ name: 'E0', at: mockNowSec + 100 }, { name: 'E1', at: mockNowSec + 200 }];
    await insRow({ token: T4b, sys: 'thsr_sched', train_no: '9p4b', stops: st4b, last_idx: 1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
    mockNowSec = st4b[st4b.length - 1].at + 999;
    calls.length = 0; apnsNextStatus = 500; apnsNextReason = 'InternalServerError';
    const r4b = await laPushAll(env, fakeCtx, BASE_URL);
    ok('P4b(B-I3 關鍵)end 推播失敗時仍然刪列(不可因推播失敗而留著永遠重試)',
      (await getRow(T4b)) === null, JSON.stringify(r4b));
    apnsNextStatus = 200; apnsNextReason = '';
    await delRow(T4b);
  }
}

// P5/P6(修復輪次1 Critical1 重寫):是否刪列現在看 body.reason,不是看 status——
// BadTopic/PayloadEmpty/BadMessageId 一樣是 400,但那是我方 topic 字串或 payload 出錯,
// 不是這個 token 失效。正面三種(token 真的沒救了)才刪:Unregistered(410 唯一 reason)、
// BadDeviceToken、DeviceTokenNotForTopic。
for (const [tag, status, reason] of [
  ['p5', 410, 'Unregistered'],
  ['p6a', 400, 'BadDeviceToken'],
  ['p6b', 400, 'DeviceTokenNotForTopic'],
]) {
  const T = tok(tag);
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }];
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9' + tag, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = status; apnsNextReason = reason;
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok(`P5/6(${status}/${reason}) dropped 計數正確`, r.dropped === 1 && r.sent === 0, JSON.stringify(r));
  const row = await getRow(T);
  ok(`P5/6(${status}/${reason}) token 真的沒救 → D1 列被刪除`, row === null, row ? JSON.stringify(row) : '(已刪除)');
  await delRow(T);   // 防禦性清理:若上面兩條斷言其一為 FAIL(產品碼沒刪成),殘列不該汙染後面批次的計數
}

// P6c(關鍵,Critical1 本體——就是驗收回報那個「一個 tick 清空整表」的真實觸發場景):
// 400 但 reason 不在上面名單(例如我方 topic 字串打錯的 BadTopic)→ 不是這個 token 的問題,
// 不准刪列、不准計入 dropped/sent,留給下一分鐘(等我方修好設定)重試。且用兩列同時中招,
// 證明不是只驗到單列——舊 bug 的殺傷力恰恰是「同一個誤設會讓批次裡每一列都回同樣的 400」。
{
  const Ta = tok('p6ca'), Tb = tok('p6cb');
  await delRow(Ta); await delRow(Tb);
  mockNowSec = 1_800_000_000;
  const mk = (name) => [{ name: name + '0', at: mockNowSec + 100 }, { name: name + '1', at: mockNowSec + 200 }];
  await insRow({ token: Ta, sys: 'thsr_sched', train_no: '9p6ca', stops: mk('A'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  await insRow({ token: Tb, sys: 'thsr_sched', train_no: '9p6cb', stops: mk('B'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 400; apnsNextReason = 'BadTopic';
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P6c(關鍵)BadTopic 不計入 dropped 也不計入 sent', r.dropped === 0 && r.sent === 0, JSON.stringify(r));
  const apnsCallsP6c = calls.filter(c => c.url.includes(APNS_FRAG));
  ok('P6c(關鍵)兩列都真的打過 APNs(不是被提前擋掉,證明真的走過失敗路徑)', apnsCallsP6c.length === 2, `count=${apnsCallsP6c.length}`);
  const rowA = await getRow(Ta), rowB = await getRow(Tb);
  ok('P6c(關鍵)整批都沒被誤刪——這正是舊 bug「一個 tick 清空整表」的複現場景',
    !!rowA && rowA.last_idx === -1 && !!rowB && rowB.last_idx === -1,
    `A=${rowA ? JSON.stringify(rowA) : '被刪!'} B=${rowB ? JSON.stringify(rowB) : '被刪!'}`);
  await delRow(Ta); await delRow(Tb);
}

// P7:APNs 回 429/500(暫時性錯誤)→ 不刪列、不更新 last_idx,留給下一分鐘重試
for (const [tag, status] of [['p7a', 429], ['p7b', 500]]) {
  const T = tok(tag);
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }];
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9' + tag, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  // reason 清空(不是 apnsNextStatus 那種每次都設的欄位):429/500 在真實 APNs 不會帶
  // Unregistered/BadDeviceToken/DeviceTokenNotForTopic 這類 reason,留空才是寫實模擬,
  // 不然會殘留前一個情境(P6c)的 'BadTopic',把「本來就不該讀 reason」的路徑測得不乾淨。
  calls.length = 0; apnsNextStatus = status; apnsNextReason = '';
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok(`P7(${status}) 不計入 sent 也不計入 dropped(留給下一輪重試)`, r.sent === 0 && r.dropped === 0, JSON.stringify(r));
  const row = await getRow(T);
  ok(`P7(${status}) D1 列仍在且 last_idx 維持 -1(未被誤標成已推播)`, !!row && row.last_idx === -1, row ? `last_idx=${row.last_idx}` : '(查無列,不應該被刪!)');
  await delRow(T);   // 429/500 情境刻意不讓產品碼刪列,測完必須自己清,否則會汙染後面批次的 sent/dropped 計數
}

// P8:expire_at 已過期的列,應在主查詢前就被清掉,零 APNs 呼叫
{
  const T = tok('p8');
  await delRow(T);
  mockNowSec = 1_800_000_000;
  await insRow({ token: T, sys: 'thsr_sched', train_no: '999', stops: [{ name: 'X', at: mockNowSec + 100 }], last_idx: -1, last_delay: 0, bound_at: mockNowSec - 20000, expire_at: mockNowSec - 100 });
  calls.length = 0; apnsNextStatus = 200;
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P8 過期列不出現在本輪任何計數裡', r.sent === 0 && r.dropped === 0, JSON.stringify(r));
  ok('P8 過期列沒有觸發任何 APNs 呼叫', calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, String(calls.length));
  const row = await getRow(T);
  ok('P8 過期列被主動清除', row === null, row ? JSON.stringify(row) : '(已刪除)');
}

// P9:兩列同時處理,一列該推一列不該推 → 只應該看到一次 APNs 呼叫
{
  const Ta = tok('p9a'), Tb = tok('p9b');
  await delRow(Ta); await delRow(Tb);
  mockNowSec = 1_800_000_000;
  const stopsA = [{ name: 'A0', at: mockNowSec + 100 }, { name: 'A1', at: mockNowSec + 5000 }];
  const stopsB = [{ name: 'B0', at: mockNowSec + 100 }, { name: 'B1', at: mockNowSec + 5000 }];
  // Ta:狀態會變(last_idx 故意設成落後於 laSchedIdx 現在該給的值)
  await insRow({ token: Ta, sys: 'thsr_sched', train_no: '811', stops: stopsA, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  // Tb:狀態不會變(先跑一輪讓它穩定在 idx0,之後不再變動)
  await insRow({ token: Tb, sys: 'thsr_sched', train_no: '812', stops: stopsB, last_idx: 0, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200;
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P9 兩列一批處理,恰好一次推播(sent=1)', r.sent === 1 && r.dropped === 0, JSON.stringify(r));
  const apnsCallsP9 = calls.filter(c => c.url.includes(APNS_FRAG));
  ok('P9 APNs 呼叫次數=1(不是 Tb 那列被誤推)', apnsCallsP9.length === 1, `count=${apnsCallsP9.length}`);
  if (apnsCallsP9.length === 1) {
    ok('P9 被推播的是 Ta 那列(狀態真的變了的那個)', apnsCallsP9[0].url.includes(Ta), apnsCallsP9[0].url);
  } else {
    // 🔴 最終複審 C1-Minor-5:補 else 回填,與 P1 同一個理由(分母不可無聲縮水)。
    ok('P9 被推播的是 Ta 那列(狀態真的變了的那個)', false, `(APNs 呼叫數=${apnsCallsP9.length},結構性略過)`);
  }
  await delRow(Ta); await delRow(Tb);
}

// ══════════════════════════════════════════════════════════════════
// Group B:tra_sched(即時觀測 laNextIdx),會觸發 traLive→TDX 假上游。
// 這裡收斂 brief 明講「最容易錯」的那個分支:剛 bind、TDX 還沒回報過的車(idx<0)
// 絕不能被誤判成走完全程而刪掉。
// ══════════════════════════════════════════════════════════════════
// 🔴 traLive 自己有一層「isolate 記憶體快取」(mem/memAt,55 秒 TTL),鍵在 Date.now()。
// 我們把 Date.now 凍結在 mockNowSec,同一個 mockNowSec 內連打兩次 laPushAll,第二次會拿到
// 第一次快取住的 TrainLiveBoards,不會看到這裡剛換的 tdxBoard——不是產品邏輯的 bug,是
// 「凍結時間」這個測試手法本身跟 traLive 的快取語意相撞。每個要驗證「這次上游回傳了什麼」
// 的情境之間,mockNowSec 必須前進 > 55(秒),逼快取視為過期、真的重新呼叫假 fetch。
{
  const T = tok('p10');
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [{ name: '潮州', at: mockNowSec + 600 }, { name: '屏東', at: mockNowSec + 2040 }];
  const staMap = { '5050': 0, '5040': 0, '5000': 1 };     // 竹田(通過)映射到潮州之後
  const stopCodes = ['5050', '5000'];
  await insRow({ token: T, sys: 'tra_sched', train_no: '554', stops, staMap, stopCodes, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });

  // P10:即時回報車正停靠在潮州(status=1,own=0)→ laNextIdx 應給 idx=0,觸發推播
  tdxBoard = [{ TrainNo: '554', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200;
  const r10 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P10 即時觀測(在站上,own站)→觸發推播', r10.sent === 1, JSON.stringify(r10));
  ok('P10 有打 TDX TrainLiveBoard', calls.some(c => c.url.includes(TDX_API_FRAG)), JSON.stringify(calls.map(c => c.url)));
  const apnsCalls10 = calls.filter(c => c.url.includes(APNS_FRAG));
  if (apnsCalls10.length === 1) {
    const body = JSON.parse(apnsCalls10[0].init.body);
    ok('P10 nextStop=潮州(即時觀測命中 own 站,與 sta/status 型別 String/Number 轉換一致)', body.aps['content-state'].nextStop === '潮州', body.aps['content-state'].nextStop);
  } else ok('P10 APNs 呼叫次數應為 1', false, `count=${apnsCalls10.length}`);
  const row10 = await getRow(T);
  ok('P10 D1 last_idx 更新為 0', !!row10 && row10.last_idx === 0, row10 ? `last_idx=${row10.last_idx}` : '(查無列)');
  await delRow(T);   // 立刻清掉,避免它在後面幾發批次裡繼續被處理、干擾計數

  // ── P11(brief 明講最容易錯的分支):換一列全新的車,TDX 回報的站碼完全不在
  //    staMap/stopCodes 裡(剛 bind、還沒被回報過的車常見情境)→ laNextIdx 應回 lastIdx(-1),
  //    laPushAll 必須「不推也不收卡」,那一列必須繼續留在 D1 等下一分鐘,不能被誤刪。
  mockNowSec += 100;   // 前進 >55 秒,逼 traLive 真的重打一次假上游,不吃 P10 留下的快取
  const T11 = tok('p11');
  await delRow(T11);
  const stops11 = [{ name: '潮州', at: mockNowSec + 600 }, { name: '屏東', at: mockNowSec + 2040 }];
  await insRow({ token: T11, sys: 'tra_sched', train_no: '777', stops: stops11, staMap, stopCodes, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  tdxBoard = [{ TrainNo: '777', DelayTime: 0, StationID: '9999', TrainStationStatus: 2 }];  // 9999 不在 staMap/stopCodes
  calls.length = 0; apnsNextStatus = 200;
  const r11 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P11(關鍵)有真的重打 TDX(不是吃 P10 的快取)', calls.some(c => c.url.includes(TDX_API_FRAG)), JSON.stringify(calls.map(c => c.url)));
  ok('P11(關鍵)idx<0 不計入 sent/dropped', r11.sent === 0 && r11.dropped === 0, JSON.stringify(r11));
  ok('P11(關鍵)idx<0 沒有觸發 APNs 呼叫', calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, String(calls.filter(c => c.url.includes(APNS_FRAG)).length));
  const row11 = await getRow(T11);
  ok('P11(關鍵)剛 bind 未被 TDX 回報的車不會被誤刪', !!row11 && row11.last_idx === -1, row11 ? `last_idx=${row11.last_idx}` : '(查無列——若查無列代表復現了 brief 警告的那個 bug!)');
  await delRow(T11);

  // P11b(最終複審 C1-I1 補強):P11 那格其實是被下一行的「沒變就不推」攔下的,對 `idx<0` 閘門
  // 恆真(實測:把 worker.js 的 `if (idx < 0) continue;` 拿掉之後,原本 139 條全綠)。唯一真正
  // 需要那道閘門的是【idx<0 而誤點有變】——此時「沒變就不推」的兩個條件不同時成立,會一路
  // 掉到 stops[-1] 炸掉,而且 attempted 已經先 ++ 過 ⇒ 熔斷分母被一列根本沒送出請求的列灌水。
  mockNowSec += 400;   // >55 秒,逼 traLive 重打
  const T11b = tok('p11b');
  await delRow(T11b);
  const stops11b = [{ name: '潮州', at: mockNowSec + 600 }, { name: '屏東', at: mockNowSec + 2040 }];
  await insRow({ token: T11b, sys: 'tra_sched', train_no: '888', stops: stops11b,
    staMap: { '5050': 0 }, stopCodes: ['5050'], last_idx: -1, last_delay: 0,
    bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  tdxBoard = [{ TrainNo: '888', DelayTime: 5, StationID: '9999', TrainStationStatus: 2 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const { logLines: logB11, errLines: errB11 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P11b 前置:真的重打了 TDX(不是吃前一格的快取)', calls.some(c => c.url.includes(TDX_API_FRAG)), JSON.stringify(calls.map(c => c.url)));
  ok('P11b(關鍵)idx<0 且誤點有變時仍不打 APNs(這一格「沒變就不推」攔不住)',
    calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, String(calls.filter(c => c.url.includes(APNS_FRAG)).length));
  ok('P11b(關鍵)沒有留下單列例外 log——閘門若被拿掉,stops[-1].name 會當場 TypeError',
    !errB11.some(l => l.includes('單列處理失敗')), JSON.stringify(errB11));
  ok('P11b(關鍵)attempted 沒被這一列汙染(熔斷分母只能算真的送出過 APNs 的列)',
    logB11.some(l => l.includes('tick 完成') && l.includes('attempted=0')), JSON.stringify(logB11));
  const row11b = await getRow(T11b);
  ok('P11b 列沒被刪', !!row11b && row11b.last_idx === -1, row11b ? String(row11b.last_idx) : '(查無列)');
  await delRow(T11b);

  // P12:這班車根本不在本輪即時 feed 裡(不論成因是上游真的掛掉、還是 traLive 自己的
  // 「上游失敗但沿用舊快取」退路吐出一份不含這班車的舊資料——兩種成因對 laPushAll 是同一種
  // 可觀測結果:live[trainNo] 查無),應該安靜降級走 laSchedIdx,不拋例外、不崩潰、卡片仍前進。
  mockNowSec += 100;   // 再前進一輪,逼 traLive 對這次呼叫重新求值(不吃 P11 的快取)
  const T12 = tok('p12');
  await delRow(T12);
  const stops12 = [{ name: 'X', at: mockNowSec + 50 }, { name: 'Y', at: mockNowSec + 9999 }];
  await insRow({ token: T12, sys: 'tra_sched', train_no: '333', stops: stops12, staMap: { '1': 0 }, stopCodes: ['1', '2'], last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  tdxBoard = null;   // 讓假 fetch 對 TrainLiveBoard 回 502(train 333 不論如何都不會出現在 live 裡)
  calls.length = 0; apnsNextStatus = 200;
  let threw12 = false, r12 = null;
  try { r12 = await laPushAll(env, fakeCtx, BASE_URL); } catch (e) { threw12 = true; }
  ok('P12 上游查無這班車不拋例外(traLive 與 laPushAll 兩層防護至少一層接住)', !threw12, threw12 ? '拋出例外' : '正常回傳');
  ok('P12 查無即時資料時改走表定退路仍會推播(idx -1→0,有變化)', !!r12 && r12.sent === 1, JSON.stringify(r12));
  const row12 = await getRow(T12);
  ok('P12 D1 last_idx 依表定退路更新為 0', !!row12 && row12.last_idx === 0, row12 ? `last_idx=${row12.last_idx}` : '(查無列)');
  await delRow(T12);
}

// ══════════════════════════════════════════════════════════════════
// Group C(修復輪次1):獨立驗收回報 1 Critical + 9 Important 的補充覆蓋。
// Critical1(reason 而非 status)與 Important8/9 已經改在 P1/P1host/P5/P6/P6c 原地驗掉,
// 這裡收剩下的:Important1(型別)、2(單列例外隔離)、4(JWT 403 作廢)、5(LIMIT)、
// 6(cron 不污染用量分析)。Important3(log)已併入 P1log 與下面 P15。Important7(簽章)
// 在 verify_la_backend.mjs 的 J4/J5(那才是 JWT 邏輯的家)。
// ══════════════════════════════════════════════════════════════════

// P13(Important1):stops[].at 若因舊資料/字串型 bind payload 而是字串,"1800000100"+0
// 會做字串串接(不是加法),把 arrivalDate 撐成天文數字的年份,且 laSchedIdx 內部
// stops[i].at+delaySec>nowSec 的比較會被那個巨大的假數字撐到恆真 ⇒ idx 永遠卡在 0。
{
  const T13 = tok('p13');
  await delRow(T13);
  mockNowSec = 1_800_000_000;
  // 刻意把 at 存成字串(insRow 用 JSON.stringify,字串會原樣序列化成 JSON 字串,
  // 完整複現「D1 裡本來就存了字串」的情境,不只是呼叫參數型別不對)。
  const stops13 = [{ name: 'X', at: String(mockNowSec + 100) }, { name: 'Y', at: String(mockNowSec + 200) }];
  await insRow({ token: T13, sys: 'thsr_sched', train_no: '9p13', stops: stops13, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const r13 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P13(Important1)字串型 at 仍正確觸發推播', r13.sent === 1, JSON.stringify(r13));
  const apnsCalls13 = calls.filter(c => c.url.includes(APNS_FRAG));
  if (apnsCalls13.length === 1) {
    const cs = JSON.parse(apnsCalls13[0].init.body).aps['content-state'];
    ok('P13(關鍵)arrivalDate 是合理範圍內的 epoch 數字(不是字串串接出的天文數字/2540年)',
      typeof cs.arrivalDate === 'number' && Math.abs(cs.arrivalDate - (mockNowSec + 100)) < 5,
      String(cs.arrivalDate));
  } else ok('P13 APNs 呼叫次數應為 1(結構性略過細項)', false, `count=${apnsCalls13.length}`);

  // 時間前進到第一站已過:若型別沒修好,laSchedIdx 內部字串串接算出的假時刻遠在未來,
  // 比較恆真 ⇒ idx 永遠停在 0,卡片凍死。
  mockNowSec = Number(stops13[0].at) + 5;
  calls.length = 0; apnsNextStatus = 200;
  const r13b = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P13(關鍵)時間前進後 idx 真的前進(沒有因字串串接卡死在 0)', r13b.sent === 1, JSON.stringify(r13b));
  const row13 = await getRow(T13);
  ok('P13(關鍵)D1 last_idx 前進到 1', !!row13 && row13.last_idx === 1, row13 ? `last_idx=${row13.last_idx}` : '(查無列)');
  await delRow(T13);
}

// P14(Important2):某一列的 APNs fetch 網路層 reject,不得拖垮同一批次的其他列——
// 最寫實的觸發是 fetch() 對 APNs 的網路層 reject,沒有 per-row try/catch 的話第 N 列一炸,
// 後面全部本分鐘不更新。
// 🔴 修復輪次1(硬化,突變測試發現):laPushAll 呼叫在此包一層本機 try/catch——若 per-row
// 保護被改壞而讓例外逸出 laPushAll,要在這裡留下一條乾淨的 FAIL,不能讓例外一路衝到頂層
// process.on('uncaughtException') 把整支腳本 abort 掉(那樣 P15-P17 共 15 條斷言會連跑都
// 沒機會跑,訊號比「哪裡壞了」還模糊)。
{
  const Ta = tok('p14a'), Tb = tok('p14b'), Tc = tok('p14c');
  await delRow(Ta); await delRow(Tb); await delRow(Tc);
  mockNowSec = 1_800_000_000;
  const mk = (name) => [{ name: name + '0', at: mockNowSec + 100 }, { name: name + '1', at: mockNowSec + 200 }];
  await insRow({ token: Ta, sys: 'thsr_sched', train_no: '9p14a', stops: mk('A'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  await insRow({ token: Tb, sys: 'thsr_sched', train_no: '9p14b', stops: mk('B'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  await insRow({ token: Tc, sys: 'thsr_sched', train_no: '9p14c', stops: mk('C'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsRejectToken = Tb;
  let r14 = null, r14err = null, errLines14 = [];
  try {
    const cap = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
    r14 = cap.result; errLines14 = cap.errLines;
  } catch (e) { r14err = e; }
  apnsRejectToken = null;
  ok('P14(關鍵)laPushAll 不因單列 reject 而整支拋出例外(per-row try/catch 有生效)',
    r14err === null, r14err ? String((r14err && r14err.stack) || r14err).split('\n')[0] : '(無例外)');
  // 🔴 最終複審 C1-I2 的【正向對照】:證明「單列處理失敗」這個收集器真的抓得到東西。
  // 沒有這一條的話,檔尾 PEXC 那條 `!errLines.some('單列處理失敗')` 會退化成又一個沒牙的
  // `=== 0`(盲點形態 2:斷言某計數為 0 卻沒有同一支收集器的正向對照)。
  ok('P14(正向對照)網路層 reject 確實留下一則「單列處理失敗」log——證明這個訊號抓得到',
    errLines14.some(l => l.includes('單列處理失敗')), JSON.stringify(errLines14));
  if (r14) {
    ok('P14(關鍵)一列 reject 不影響其餘列的 sent 計數(sent=2,不是 0 或 1)', r14.sent === 2, JSON.stringify(r14));
    const rowA = await getRow(Ta), rowB = await getRow(Tb), rowC = await getRow(Tc);
    ok('P14 未受影響列 A 正常推播更新', !!rowA && rowA.last_idx === 0, rowA ? `last_idx=${rowA.last_idx}` : '(查無列)');
    ok('P14(關鍵)炸掉的列之後的列 C 仍正常推播(證明迴圈真的繼續往下跑,不是提前中止)', !!rowC && rowC.last_idx === 0, rowC ? `last_idx=${rowC.last_idx}` : '(查無列)');
    ok('P14 炸掉的列 B 保持原狀(下一分鐘自然重試,沒有半途寫壞 last_idx)', !!rowB && rowB.last_idx === -1, rowB ? `last_idx=${rowB.last_idx}` : '(查無列!)');
  } else {
    ok('P14 一列 reject 不影響其餘列的 sent 計數(sent=2,不是 0 或 1)', false, '(laPushAll 已拋出例外,無回傳值可驗,見上一條)');
    ok('P14 未受影響列 A 正常推播更新', false, '(laPushAll 已拋出例外,略過)');
    ok('P14(關鍵)炸掉的列之後的列 C 仍正常推播(證明迴圈真的繼續往下跑,不是提前中止)', false, '(laPushAll 已拋出例外,略過)');
    ok('P14 炸掉的列 B 保持原狀(下一分鐘自然重試,沒有半途寫壞 last_idx)', false, '(laPushAll 已拋出例外,略過)');
  }
  await delRow(Ta); await delRow(Tb); await delRow(Tc);
}

// P15(Important4+3):APNs 回 403(InvalidProviderToken,例如金鑰輪替/時鐘偏移)→
// 這把 JWT 本身壞了,不是這個 token 的問題:不刪列、不計入 sent/dropped,但要留 log,
// 且下一次 laJwt() 必須強制重簽(不能卡滿 50 分鐘快取,否則接下來全軍覆沒)。
{
  const T15a = tok('p15a');
  await delRow(T15a);
  mockNowSec = 1_800_000_000;
  const stops15a = [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }];
  await insRow({ token: T15a, sys: 'thsr_sched', train_no: '9p15a', stops: stops15a, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 403; apnsNextReason = 'InvalidProviderToken';
  const { result: r15a, errLines: errLines15 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P15 403 不計入 sent 也不計入 dropped', r15a.sent === 0 && r15a.dropped === 0, JSON.stringify(r15a));
  ok('P15(Important3)403 的失敗留下 status+reason 的 log(不能零 log 讓 cron 看起來成功)',
    errLines15.some(l => l.includes('403') && l.includes('InvalidProviderToken')), JSON.stringify(errLines15));
  const row15a = await getRow(T15a);
  ok('P15 403 不刪列(問題在 JWT,不在這個 token)', !!row15a && row15a.last_idx === -1, row15a ? `last_idx=${row15a.last_idx}` : '(查無列!)');
  const jwt1 = (calls.filter(c => c.url.includes(APNS_FRAG))[0] || {}).init?.headers?.authorization;
  ok('P15 前置:確實捕捉到第一次的 JWT', typeof jwt1 === 'string' && jwt1.startsWith('bearer '), String(jwt1));
  await delRow(T15a);

  // 換一列全新的、正常會成功的推播——時間只前進極短(遠低於 50 分鐘快取窗)。
  // 若快取沒被 403 作廢,這裡會拿到跟 jwt1 一模一樣的字串(命中快取,laJwt 不重算 iat)。
  mockNowSec += 5;
  const T15b = tok('p15b');
  await delRow(T15b);
  const stops15b = [{ name: 'C', at: mockNowSec + 100 }, { name: 'D', at: mockNowSec + 200 }];
  await insRow({ token: T15b, sys: 'thsr_sched', train_no: '9p15b', stops: stops15b, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const r15b = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P15 重置後的下一次推播正常成功', r15b.sent === 1, JSON.stringify(r15b));
  const jwt2 = (calls.filter(c => c.url.includes(APNS_FRAG))[0] || {}).init?.headers?.authorization;
  ok('P15(關鍵)403 之後拿到的是【新簽】的 JWT,不是卡住的舊快取',
    typeof jwt2 === 'string' && jwt2 !== jwt1, `jwt1===jwt2 ? ${jwt2 === jwt1}`);
  await delRow(T15b);
}

// P16(Important5):LA_ROW_LIMIT 防 tick 重疊——超過上限的列數必須被截斷且留下 log,
// 不能無聲少推。用 env.LA_ROW_LIMIT 覆寫成很小的值,不必真的塞 500+ 列進 D1。
{
  const tokens16 = [tok('p16a'), tok('p16b'), tok('p16c')];
  for (const t of tokens16) await delRow(t);
  mockNowSec = 1_800_000_000;
  for (let i = 0; i < tokens16.length; i++) {
    const stops = [{ name: 'S' + i, at: mockNowSec + 100 }, { name: 'E' + i, at: mockNowSec + 200 }];
    await insRow({ token: tokens16[i], sys: 'thsr_sched', train_no: '9p16' + i, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  }
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const envLimited = { ...env, LA_ROW_LIMIT: 2 };   // 3 列超過上限 2,不動共用 env
  const { result: r16, errLines: errLines16 } = await captureConsole(() => laPushAll(envLimited, fakeCtx, BASE_URL));
  ok('P16(關鍵)超過上限時只處理 LIMIT 筆(sent=2,不是 3)', r16.sent === 2, JSON.stringify(r16));
  ok('P16(Important3延伸)觸頂必須留下 log,不能無聲截斷', errLines16.some(l => l.includes('列數觸頂')), JSON.stringify(errLines16));
  const rows16 = await Promise.all(tokens16.map(getRow));
  const stillMinus1 = rows16.filter(r => r && r.last_idx === -1).length;
  ok('P16 被截斷的那一列留給下一分鐘(last_idx 仍是 -1,沒被跳過當作已處理)', stillMinus1 === 1, JSON.stringify(rows16.map(r => r && r.last_idx)));
  for (const t of tokens16) await delRow(t);
}

// P17(Important6):cron 呼叫 traLive 不可污染用量分析 dataset(railisland_usage)。
// 用一個假的 env.USAGE 觀察 writeDataPoint 有沒有被呼叫。正向對照:直接呼叫 traLive
// (模擬真人前景請求,不帶 _src=cron)必須真的觸發一次寫入——不然「cron 沒觸發」這條斷言
// 可能只是因為假 USAGE 綁定本身永遠不會被叫到(=== 0 的常見假綠陷阱)。
{
  const usageCalls = [];
  const envWithUsage = { ...env, USAGE: { writeDataPoint: (...a) => { usageCalls.push(a); } } };

  mockNowSec += 200;   // 前進>55秒逼真的重打上游,不吃前面測試留下的 traLive mem 快取
  tdxBoard = [{ TrainNo: '1', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  usageCalls.length = 0;
  await worker._la.traLive(new Request('https://dummy.invalid/api/tra-live?cam=follow&z=12'), envWithUsage, fakeCtx);
  ok('P17(正向對照)真人前景請求(無 _src=cron)確實觸發用量埋點', usageCalls.length === 1, `count=${usageCalls.length}`);

  const T17 = tok('p17');
  await delRow(T17);
  const stops17 = [{ name: '潮州', at: mockNowSec + 600 }, { name: '屏東', at: mockNowSec + 2040 }];
  await insRow({ token: T17, sys: 'tra_sched', train_no: '1', stops: stops17, staMap: { '5050': 0 }, stopCodes: ['5050', '5000'], last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  mockNowSec += 200;   // 再前進一輪,逼 laPushAll 這次真的重打上游(不吃上面 traLive 留下的快取)
  tdxBoard = [{ TrainNo: '1', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  usageCalls.length = 0; calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  await laPushAll(envWithUsage, fakeCtx, BASE_URL);
  ok('P17(關鍵)cron(laPushAll 內部呼叫 traLive)不寫入用量分析,不污染 railisland_usage', usageCalls.length === 0, `count=${usageCalls.length}`);
  await delRow(T17);
}

// ══════════════════════════════════════════════════════════════════
// Group D(修復輪次2):獨立 re-review 確認輪次1全數 ADDRESSED 之後的新工作——批次熔斷、
// 三個無聲失敗小洞、LIMIT 截斷改依到期時間排序。
// ══════════════════════════════════════════════════════════════════

// P18(無聲失敗 a):APNS_KEY_P8 未設定時整支不動,但必須留一行 log——舊版零 log,
// tick 摘要 log 在這條 early return 之後,cron 面板照樣顯示成功。
{
  const envNoKey = { ...env };
  delete envNoKey.APNS_KEY_P8;
  const { result: rNoKey, errLines: errLinesNoKey } = await captureConsole(() => laPushAll(envNoKey, fakeCtx, BASE_URL));
  ok('P18(關鍵)APNS_KEY_P8 未設定仍要留一行 log,不能零訊號', errLinesNoKey.some(l => l.includes('APNS_KEY_P8')), JSON.stringify(errLinesNoKey));
  ok('P18 未設定時仍照常回傳 {sent:0,dropped:0},不拋例外', rNoKey.sent === 0 && rNoKey.dropped === 0, JSON.stringify(rNoKey));
}

// P19(無聲失敗 b):LA_ROW_LIMIT 設了但解不出合法正數(手滑打成非數字字串,或 0/負數)時
// 必須留 log——舊版 Number('abc')||500 靜默退回預設值,設錯值完全零訊號。同時驗證「根本
// 沒設」這個正常情況不會被誤觸發同一條 log(沒設不是錯,不該報)。
{
  const T19 = tok('p19');
  await delRow(T19);
  mockNowSec = 1_800_000_000;
  await insRow({ token: T19, sys: 'thsr_sched', train_no: '9p19', stops: [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }], last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const envBadLimit = { ...env, LA_ROW_LIMIT: 'abc' };
  const { result: rBadLimit, errLines: errLinesBadLimit } = await captureConsole(() => laPushAll(envBadLimit, fakeCtx, BASE_URL));
  ok('P19(關鍵)LA_ROW_LIMIT 設了但解不出數字時要留 log', errLinesBadLimit.some(l => l.includes('LA_ROW_LIMIT') && l.includes('abc')), JSON.stringify(errLinesBadLimit));
  ok('P19 仍照樣退回預設值運作(這一列正常被處理,不因為設定錯而整支跳過)', rBadLimit.sent === 1, JSON.stringify(rBadLimit));
  await delRow(T19);

  const T19b = tok('p19b');
  await delRow(T19b);
  await insRow({ token: T19b, sys: 'thsr_sched', train_no: '9p19b', stops: [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }], last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const { errLines: errLinesUnset } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));   // env 本身沒設 LA_ROW_LIMIT
  ok('P19(對照)LA_ROW_LIMIT 根本沒設時不該觸發「不是合法正數」的 log(沒設不是錯)', !errLinesUnset.some(l => l.includes('LA_ROW_LIMIT')), JSON.stringify(errLinesUnset));
  await delRow(T19b);
}

// P20(無聲失敗 c 的正面驗證,延伸 Important5/P16):LIMIT 觸頂時,被截斷的必須是「最新綁定」
// (expire_at 最晚)的列,最快到期的列永遠不能被截斷——否則舊 bug(同一批尾端列每次都被砍,
// 直到自己 expire_at 到期)還在,只是換了個無關的排序面貌。刻意用「新、中、快到期」的插入
// 順序(不照 expire_at 順序插入),證明排序看的是 expire_at 欄位值,不是 rowid/插入序。
{
  const T20soon = tok('p20soon'), T20mid = tok('p20mid'), T20new = tok('p20new');
  for (const t of [T20soon, T20mid, T20new]) await delRow(t);
  mockNowSec = 1_800_000_000;
  const mk = (n) => [{ name: n + '0', at: mockNowSec + 100 }, { name: n + '1', at: mockNowSec + 200 }];
  await insRow({ token: T20new, sys: 'thsr_sched', train_no: '9p20n', stops: mk('N'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 7200 });
  await insRow({ token: T20mid, sys: 'thsr_sched', train_no: '9p20m', stops: mk('M'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  await insRow({ token: T20soon, sys: 'thsr_sched', train_no: '9p20s', stops: mk('S'), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 100 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  const envLimited2 = { ...env, LA_ROW_LIMIT: 2 };
  const r20 = await laPushAll(envLimited2, fakeCtx, BASE_URL);
  ok('P20 3 列超過上限 2,仍只處理 2 列(sent=2)', r20.sent === 2, JSON.stringify(r20));
  const rowSoon = await getRow(T20soon), rowMid = await getRow(T20mid), rowNew = await getRow(T20new);
  ok('P20(關鍵)最快到期的列一定被處理到(last_idx 從 -1 變成 0,不會被截斷)', !!rowSoon && rowSoon.last_idx === 0, rowSoon ? `last_idx=${rowSoon.last_idx}` : '(查無列!)');
  ok('P20 中間到期時間的列也被處理到', !!rowMid && rowMid.last_idx === 0, rowMid ? `last_idx=${rowMid.last_idx}` : '(查無列!)');
  ok('P20(關鍵)最新綁定(expire_at 最晚)的列才是被截斷、本輪未推播的那個', !!rowNew && rowNew.last_idx === -1, rowNew ? `last_idx=${rowNew.last_idx}` : '(查無列!)');
  for (const t of [T20soon, T20mid, T20new]) await delRow(t);
}

// P21(批次熔斷,關鍵——re-review 這輪的主要工作):三側缺一不可。
// P21a:少數列失效(2/10,ratio=20%)→ attempted 達到 LA_BREAKER_MIN_ATTEMPTED(10)但比例遠低於
//       LA_BREAKER_RATIO(50%)→ 不熔斷,照常刪那 2 列。刻意選「樣本過門檻但比例不過」,
//       才能單獨驗到比例守門有沒有牙(跟 P21c/P27 的「比例過但樣本太小」互為對照)。
//       (修復輪次4:常數名從 LA_BREAKER_MIN_FAILS 改成 LA_BREAKER_MIN_ATTEMPTED,樣本恰好
//       仍在門檻上,這條測試的數字與判準都不用改。)
{
  const N = 10, FAIL_COUNT = 2;
  const tokens = Array.from({ length: N }, (_, i) => tok('p21a' + i));
  for (const t of tokens) await delRow(t);
  mockNowSec = 1_800_000_000;
  for (let i = 0; i < N; i++) {
    const stops = [{ name: 'A' + i, at: mockNowSec + 100 }, { name: 'B' + i, at: mockNowSec + 200 }];
    await insRow({ token: tokens[i], sys: 'thsr_sched', train_no: '9p21a' + i, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 + i });
  }
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  for (let i = 0; i < FAIL_COUNT; i++) apnsPerToken[tokens[i]] = { status: 410, reason: 'Unregistered' };
  const { result: r21a, errLines: errLines21a } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsPerToken = {};
  ok('P21a(關鍵)少數列失效(2/10=20%,未達 50% 門檻)→ 不熔斷,dropped=2', r21a.dropped === 2 && (r21a.heldBack || 0) === 0, JSON.stringify(r21a));
  ok('P21a sent=8(其餘 8 列正常推播成功)', r21a.sent === 8, JSON.stringify(r21a));
  const rows21a = await Promise.all(tokens.map(getRow));
  ok('P21a(關鍵)那 2 列真的被刪除(候選數過門檻但比例不過,不熔斷,照常刪)', rows21a.slice(0, FAIL_COUNT).every(r => r === null), JSON.stringify(rows21a.slice(0, FAIL_COUNT)));
  ok('P21a 其餘 8 列都還在且已標記推播成功', rows21a.slice(FAIL_COUNT).every(r => r && r.last_idx === 0), JSON.stringify(rows21a.slice(FAIL_COUNT).map(r => r && r.last_idx)));
  ok('P21a 沒有熔斷 log(這條不該出現)', !errLines21a.some(l => l.includes('熔斷觸發')), JSON.stringify(errLines21a));
  for (const t of tokens) await delRow(t);
}

// P21b:整批失效(12/12=100%)→ attempted 與比例都過門檻 → 熔斷觸發,一列都不刪,且留下含
//       比例與總列數的 log。這是驗收報告點名的真實觸發場景本身(host/topic 打錯,每一列都
//       同一種 reason 失敗)。
// 🔴 修復輪次4:列數從 4 改成 12——舊值是照舊門檻(候選數 >= 2)寫的,新門檻要求
//    attempted >= LA_BREAKER_MIN_ATTEMPTED(10) 才做比例判定(理由見 worker.js 常數註解:
//    高鐵那種 attempted 只有 3~5 的 tick,2 個自然汰換的死 token 就是 50%,舊門檻會每分鐘
//    誤觸發一次)。改的是這條測試的樣本大小,不是它要證明的事——「整批同一種 reason 失敗
//    ⇒ 熔斷,一列都不刪」的判準本身原封不動。
{
  const N_B = 12;
  const tokensB = Array.from({ length: N_B }, (_, i) => tok('p21b' + String(i).padStart(2, '0')));
  for (const t of tokensB) await delRow(t);
  mockNowSec = 1_800_000_000;
  for (let i = 0; i < tokensB.length; i++) {
    const stops = [{ name: 'A' + i, at: mockNowSec + 100 }, { name: 'B' + i, at: mockNowSec + 200 }];
    await insRow({ token: tokensB[i], sys: 'thsr_sched', train_no: '9p21b' + i, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 + i });
  }
  calls.length = 0; apnsNextStatus = 400; apnsNextReason = 'BadDeviceToken'; apnsPerToken = {};
  const { result: r21b, errLines: errLines21b } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P21b(關鍵)整批同時失效(12/12=100%)→ 熔斷觸發,dropped=0(不是 12)', r21b.dropped === 0, JSON.stringify(r21b));
  ok('P21b(關鍵)heldBack 回報實際被擋下的列數=12', r21b.heldBack === N_B, JSON.stringify(r21b));
  const rowsB = await Promise.all(tokensB.map(getRow));
  ok('P21b(關鍵)十二列一列都沒被刪——這正是「一個 tick 清空整表」的批次版重現場景', rowsB.every(r => !!r && r.last_idx === -1), JSON.stringify(rowsB.map(r => r && r.last_idx)));
  ok('P21b(關鍵)熔斷 log 含比例與總列數,不是空泛的一句話', errLines21b.some(l => l.includes('熔斷觸發') && l.includes('12/12') && l.includes('100%')), JSON.stringify(errLines21b));
  for (const t of tokensB) await delRow(t);
}

// P21c:表裡只有 1 列且該列真的失效(1/1=100%)→ 比例是滿分,但 attempted=1 遠低於
//       LA_BREAKER_MIN_ATTEMPTED(10)→ 不熔斷,照常刪。證明小樣本沒被熔斷誤擋——這正是
//       re-review 特別點名要處理的邊界,單一列失敗這件事本身永遠不足以判斷是設定錯誤
//       還是這唯一一個 token 真的沒救了,兩者從機率上根本無法區分,只能保守地當作後者處理。
//       (修復輪次4 只換了讓它通過的那道閘門的名字與數值,行為與判準不變;attempted 從 3~9
//       的中間地帶由新增的 P27 專門守。)
{
  const T21c = tok('p21c');
  await delRow(T21c);
  mockNowSec = 1_800_000_000;
  await insRow({ token: T21c, sys: 'thsr_sched', train_no: '9p21c', stops: [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }], last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 410; apnsNextReason = 'Unregistered'; apnsPerToken = {};
  const r21c = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P21c(關鍵)表裡只有 1 列且它真的失效(1/1=100%)→ 未達最低候選數,不熔斷,dropped=1', r21c.dropped === 1 && (r21c.heldBack || 0) === 0, JSON.stringify(r21c));
  const row21c = await getRow(T21c);
  ok('P21c(關鍵)唯一那一列真的被刪除(小樣本沒被熔斷誤擋)', row21c === null, row21c ? JSON.stringify(row21c) : '(已刪除)');
  await delRow(T21c);
}

// ══════════════════════════════════════════════════════════════════
// Group E(修復輪次3,獨立 re-review scoped 再審——C-1/C-2 是本輪新問題,不是輪次2漏項)
// ══════════════════════════════════════════════════════════════════

// P22(C-1,關鍵):熔斷分母原本是 rows.length(本輪掃到的列數),但「沒變就不推」的跳過路徑
// 是主要路徑,真正打 APNs 的只是少數——分母用錯會讓熔斷在它唯一要防的情境(host/topic 打錯,
// 真的打了的列全部失敗)算出偏低的比例,反而不觸發。40 列走跳過路徑(last_idx 已經等於這輪會
// 算出的 idx,delaySec 對 thsr_sched 恆等於 last_delay,兩條件都「沒變」不會打 APNs)＋12 列
// 真的推且回 BadDeviceToken、4 列真的推且成功,構造 attempted=16、rows.length=56 的落差:
// 分母用 rows.length 算出 12/56≈21%(不觸發,錯),分母用 attempted 算出 12/16=75%(觸發,對)。
// 🔴 修復輪次4:樣本從 8+2 放大到 40+12——舊值的 attempted=2 在新門檻下低於
//    LA_BREAKER_MIN_ATTEMPTED(10),兩種分母都不會觸發,這條測試會失去分辨力(變成兩邊都綠
//    的假通過)。放大後兩種分母仍然給出相反的判定,它證明的事情原封不動。
// 🔴 修復輪次5(判準被自己的新功能遮蔽,跑突變才發現):輪次5 給熔斷補了一條【全敗】OR 條件
//    (candidates === attempted 就觸發,不看比例)。40+12 的組合恰好是「全敗」⇒ 熔斷由那條新
//    條件決定,與比例的分母【無關】⇒「分母退回 rows.length」這發突變不再讓這裡的行為斷言轉紅
//    (實測紅集從 3 掉到 1,只剩 log 文字那條)。補 4 列會成功的 attempted 列,把比例壓成
//    12/16=75%(≠100%)⇒ 全敗條件不成立、判定重新回到比例那一條,分母才又守得住。
//    教訓:新增一條 OR 進判定式,要回頭檢查有沒有舊測試因此走到新分支而失去分辨力。
{
  const SKIP_N = 40, FAIL_N = 12, OK_N = 4, ATTEMPTED_N = FAIL_N + OK_N;
  // 🔴 索引一律 padStart(2,'0'):tok() 對短 tag 補零到 64 字元,tag "1" 與 tag "10" 補完
  // 是同一個字串,索引跨個位數/兩位數邊界就會撞主鍵(樣本從 8+2 放大到 40+12 才會踩到)。
  const skipTokens = Array.from({ length: SKIP_N }, (_, i) => tok('p22skip' + String(i).padStart(2, '0')));
  const failTokens = Array.from({ length: FAIL_N }, (_, i) => tok('p22fail' + String(i).padStart(2, '0')));
  const okTokens = Array.from({ length: OK_N }, (_, i) => tok('p22ok' + String(i).padStart(2, '0')));
  for (const t of [...skipTokens, ...failTokens, ...okTokens]) await delRow(t);
  mockNowSec = 1_800_000_000;
  const mkStops = (n) => [{ name: n + '0', at: mockNowSec + 100 }, { name: n + '1', at: mockNowSec + 200 }];
  // 跳過路徑:last_idx 直接設成這輪會算出的值(0)。thsr_sched 沒有即時觀測,delaySec 在
  // laPushAll 內恆等於 row.last_delay——兩個「沒變」條件都滿足,連 APNs 都不會打。
  for (let i = 0; i < SKIP_N; i++) {
    await insRow({ token: skipTokens[i], sys: 'thsr_sched', train_no: '9p22s' + i, stops: mkStops('S' + i), last_idx: 0, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 + i });
  }
  // 真的推:last_idx=-1(剛綁定),這輪會算出 idx=0,與 last_idx 不同 → 觸發推播。
  for (let i = 0; i < FAIL_N; i++) {
    await insRow({ token: failTokens[i], sys: 'thsr_sched', train_no: '9p22f' + i, stops: mkStops('F' + i), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3700 + i });
  }
  // 也真的推、但會成功:把比例壓到 75%(≠全敗),判定才會落在【比例】那一條而不是全敗那一條。
  for (let i = 0; i < OK_N; i++) {
    await insRow({ token: okTokens[i], sys: 'thsr_sched', train_no: '9p22k' + i, stops: mkStops('K' + i), last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3800 + i });
  }
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  for (const t of failTokens) apnsPerToken[t] = { status: 400, reason: 'BadDeviceToken' };
  const { result: r22, errLines: errLines22 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsPerToken = {};
  const apnsCalls22 = calls.filter(c => c.url.includes(APNS_FRAG));
  ok('P22 只有 16 列真的打了 APNs(40 列跳過路徑零呼叫)', apnsCalls22.length === ATTEMPTED_N, `count=${apnsCalls22.length}`);
  ok('P22(關鍵)分母是「真的打了 APNs 的列數」不是「本輪掃到的列數」→ 12/16=75% 觸發熔斷,不刪',
    r22.dropped === 0 && r22.heldBack === FAIL_N, JSON.stringify(r22));
  const failRows22 = await Promise.all(failTokens.map(getRow));
  ok('P22(關鍵)那 12 列沒被刪(熔斷擋下)', failRows22.every(r => r && r.last_idx === -1), JSON.stringify(failRows22.map(r => r && r.last_idx)));
  ok('P22 熔斷 log 用 attempted 當分母顯示 12/16,不是 12/56', errLines22.some(l => l.includes('熔斷觸發') && l.includes('12/16') && l.includes('75%')), JSON.stringify(errLines22));
  ok('P22(關鍵)判定確實落在【比例】那一條,不是輪次5 的全敗那一條(4 列成功 ⇒ 比例 75%≠100%)', r22.sent === OK_N, JSON.stringify(r22));
  for (const t of [...skipTokens, ...failTokens, ...okTokens]) await delRow(t);
}

// ══════════════════════════════════════════════════════════════════
// Group F(修復輪次4):輪次3 用「連續永久失敗達 10 筆就 break」當停手訊號,那個訊號同時
// 承擔兩個互斥職責(判斷像不像系統性設錯 vs 封住單 tick 成本),兩邊都不成立——見 worker.js
// LA_TICK_BUDGET_MS 附近的長註解。本組取代舊 P23/P24(它們斷言的正是被移除的那個機制),
// 並補上輪次3 十四條熔斷測試共同的結構性盲點:**沒有任何一條放置「失敗串之後還有健康列」**。
// ══════════════════════════════════════════════════════════════════

// P23(修復輪次4,關鍵——本輪的紅燈起點):失敗串後面的健康列必須照樣被服務。
// 20 列:前 10 列永久失敗、後 10 列會成功。輪次3 的實作在第 10 個連續失敗就 break,
// 後 10 列一發都打不到、last_idx 永不更新;而掃描是 ORDER BY expire_at ASC 的確定性排序,
// 下一個 tick 同一批又排最前、又早退——「排在死 token 後面的所有列每個 tick 都拿不到推播」,
// 正是本功能要解決的問題本身。這條測試就是那個退化的直接複現。
{
  const FAIL_N = 10, OK_N = 10, N = FAIL_N + OK_N;
  const tokens = Array.from({ length: N }, (_, i) => tok('p23n' + String(i).padStart(2, '0')));
  mockNowSec = 1_800_000_000;
  await resetTable();
  await insBatch(tokens, mockNowSec);
  ok('P23 前置:表裡恰好 20 列(旋轉偏移與比例判定都依賴這個數,先自檢再驗)', (await rowCount()) === N, `count=${await rowCount()}`);
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  for (let i = 0; i < FAIL_N; i++) apnsPerToken[tokens[i]] = { status: 400, reason: 'BadDeviceToken' };
  const { result: r23, errLines: errLines23 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsPerToken = {};
  const served23 = servedSet(calls);
  ok('P23(關鍵)失敗串不再截斷迴圈:20 列全部真的被嘗試(輪次3 只打 10 發就 break)', served23.size === N, `count=${served23.size}`);
  ok('P23(關鍵)失敗串【之後】的 10 列每一列都真的收到 APNs 請求(用實際發出的 URL 當證據,不是用 last_idx 推論)',
    tokens.slice(FAIL_N).every(t => served23.has(t)), `未被服務到的=${JSON.stringify(tokens.slice(FAIL_N).filter(t => !served23.has(t)).map(t => t.slice(0, 8)))}`);
  const rows23 = await Promise.all(tokens.map(getRow));
  ok('P23(關鍵)後 10 列的 last_idx 真的被更新成 0——它們沒有被前面的失敗串餓死',
    rows23.slice(FAIL_N).every(r => r && r.last_idx === 0), JSON.stringify(rows23.slice(FAIL_N).map(r => r && r.last_idx)));
  ok('P23 sent=10(後 10 列全部推播成功)', r23.sent === 10, JSON.stringify(r23));
  ok('P23 熔斷仍照它自己的規則走:10/20=50% 達門檻 ⇒ 觸發,dropped=0、heldBack=10', r23.dropped === 0 && r23.heldBack === FAIL_N, JSON.stringify(r23));
  ok('P23(關鍵)熔斷觸發【不再】連坐健康列:前 10 列被擋下不刪(last_idx 維持 -1),後 10 列照樣拿到推播',
    rows23.slice(0, FAIL_N).every(r => r && r.last_idx === -1), JSON.stringify(rows23.slice(0, FAIL_N).map(r => r && r.last_idx)));
  ok('P23 熔斷 log 的分母是真實 attempted(20),不是被失敗串截斷後的小分母', errLines23.some(l => l.includes('熔斷觸發') && l.includes('10/20') && l.includes('50%')), JSON.stringify(errLines23));
}

// P24(修復輪次4,關鍵):死 token 真的被回收——這是餓死迴圈的另一半後果。
// 輪次3 的早退把 attempted 截在 10、比例推到 100% ⇒ 熔斷必然觸發 ⇒ 一列都不刪,
// 那些永遠不會成功的列就一路留到 expire_at(最長 8 小時)還在每個 tick 重打。
// 24 列(10 死 + 14 健康)⇒ 10/24≈42% 未達 50% ⇒ 不熔斷 ⇒ 死 token 當場清掉、系統自癒。
{
  const FAIL_N = 10, OK_N = 14, N = FAIL_N + OK_N;
  const tokens = Array.from({ length: N }, (_, i) => tok('p24n' + String(i).padStart(2, '0')));
  mockNowSec = 1_800_000_000;
  await resetTable();
  await insBatch(tokens, mockNowSec);
  ok('P24 前置:表裡恰好 24 列', (await rowCount()) === N, `count=${await rowCount()}`);
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  for (let i = 0; i < FAIL_N; i++) apnsPerToken[tokens[i]] = { status: 400, reason: 'BadDeviceToken' };
  const { result: r24, errLines: errLines24 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsPerToken = {};
  ok('P24 24 列全部真的被嘗試(分母沒被失敗串截斷)', servedSet(calls).size === N, `count=${servedSet(calls).size}`);
  ok('P24(關鍵)10/24≈42% 未達門檻 ⇒ 不熔斷,那 10 個死 token 當場被回收(dropped=10)', r24.dropped === FAIL_N && (r24.heldBack || 0) === 0, JSON.stringify(r24));
  const rows24 = await Promise.all(tokens.map(getRow));
  ok('P24(關鍵)10 個死 token 的列真的從 D1 消失(輪次3 會因為假熔斷而一列都刪不掉)', rows24.slice(0, FAIL_N).every(r => r === null), JSON.stringify(rows24.slice(0, FAIL_N)));
  ok('P24 其餘 14 列正常推播且 last_idx 更新', r24.sent === OK_N && rows24.slice(FAIL_N).every(r => r && r.last_idx === 0), JSON.stringify(r24));
  ok('P24 沒有熔斷 log(這是正常汰換,不該噴設定錯誤告警)', !errLines24.some(l => l.includes('熔斷觸發')), JSON.stringify(errLines24));
}

// P25(修復輪次4,關鍵):單 tick 成本上界改用【牆鐘預算】,而且這個上界與失敗樣態無關。
// 同一批 30 列、同樣每發往返 5 秒的假時鐘,跑兩次:一次全部成功、一次全部永久失敗。
// 兩次的 APNs 往返次數必須【相同】——這正是輪次3 那個「連續失敗數」訊號做不到的事
// (它在全敗時停在 10、在成功穿插時上界直接失效)。
// 45000ms 預算 / 3000ms 每發 ⇒ 迴圈在第 16 發之後的檢查點才超出 ⇒ 恰好 16 發。
// 🔴 每發 3000ms(而不是隨手取的 5000ms)是刻意的:5000ms 會讓預算恰好切在第 10 發,與輪次3
// 那個「連續失敗達 10 就 break」的門檻【數值相同】——於是「全敗與全成功的往返次數相同」這條
// 斷言在退回舊實作時仍然成立(兩邊都是 10),整條斷言變成沒有牙的裝飾。取 16 讓兩個機制的
// 產出數值分開,退回舊實作時全敗=10、全成功=16,這條斷言才真的守得住它宣稱的性質。
{
  const N = 30, EXPECT = 16;
  const runBudget = async (tag, allFail) => {
    const tokens = Array.from({ length: N }, (_, i) => tok(tag + String(i).padStart(2, '0')));
    mockNowSec = 1_800_000_000;
    await resetTable();
    await insBatch(tokens, mockNowSec);
    calls.length = 0; apnsPerToken = {};
    apnsNextStatus = allFail ? 400 : 200; apnsNextReason = allFail ? 'BadDeviceToken' : '';
    apnsAdvanceMs = 3000;
    const { result, errLines } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
    apnsAdvanceMs = 0; apnsNextStatus = 200; apnsNextReason = '';
    return { tokens, result, errLines, served: servedSet(calls) };
  };
  const okRun = await runBudget('p25ok', false);
  ok('P25a(關鍵)全部成功時,牆鐘預算把單 tick 壓在 16 發(30 列沒有全打完)', okRun.served.size === EXPECT, `count=${okRun.served.size}`);
  ok('P25a 被服務到的恰好是旋轉後的前 16 列,其餘 14 列一發都沒打到(用實際 URL 集合當證據)',
    okRun.tokens.slice(0, EXPECT).every(t => okRun.served.has(t)) && okRun.tokens.slice(EXPECT).every(t => !okRun.served.has(t)),
    `served=${okRun.served.size}`);
  ok('P25a 預算用盡必須留 log,不能無聲截斷(本專案鐵則:沒有無聲的上限)',
    okRun.errLines.some(l => l.includes('本輪預算用盡')), JSON.stringify(okRun.errLines.filter(l => l.includes('la-push'))));
  const failRun = await runBudget('p25ng', true);
  ok('P25b(關鍵)全部永久失敗時,往返次數與全部成功時【完全相同】——上界與失敗樣態無關',
    failRun.served.size === okRun.served.size, `全敗=${failRun.served.size} 全成功=${okRun.served.size}`);
  ok('P25b 全敗時的 attempted 仍是預算截出來的 16(不是被失敗串截出來的)',
    failRun.result.heldBack === EXPECT && failRun.result.dropped === 0, JSON.stringify(failRun.result));
}

// P26(修復輪次4):預算被吃滿時,被截掉的不能永遠是同一批尾端列。旋轉起始偏移讓每個 tick
// 從不同位置開始服務(rows 已依 expire_at 確定性排序,不旋轉的話尾端結構性永遠拿不到服務)。
// 30 列全部永久失敗(⇒ last_idx 不會更新、不會被刪、兩個 tick 面對的表完全一樣),
// 兩個 tick 相隔 60 秒 ⇒ 偏移 +1 ⇒ 服務窗從 [0,16) 移到 [1,17)。
// 每發 3000ms 的理由與 P25 相同(避開輪次3 那個門檻的數值 10,見上一區塊註解)。
{
  const N = 30, EXPECT = 16;
  const tokens = Array.from({ length: N }, (_, i) => tok('p26n' + String(i).padStart(2, '0')));
  const T0 = 1_800_000_000;                       // floor(T0/60)%30 === 0 ⇒ 第一個 tick 的偏移是 0(下面自檢)
  mockNowSec = T0;
  await resetTable();
  await insBatch(tokens, mockNowSec);
  ok('P26 前置:表裡恰好 30 列,且第一個 tick 的旋轉偏移確定是 0', (await rowCount()) === N && Math.floor(T0 / 60) % N === 0, `count=${await rowCount()} off=${Math.floor(T0 / 60) % N}`);
  apnsNextStatus = 400; apnsNextReason = 'BadDeviceToken'; apnsPerToken = {}; apnsAdvanceMs = 3000;
  calls.length = 0;
  await laPushAll(env, fakeCtx, BASE_URL);
  const servedT1 = servedSet(calls);
  mockNowSec = T0 + 60;                            // 下一個 cron tick
  calls.length = 0;
  await laPushAll(env, fakeCtx, BASE_URL);
  const servedT2 = servedSet(calls);
  apnsAdvanceMs = 0; apnsNextStatus = 200; apnsNextReason = '';
  ok('P26 前置:兩個 tick 都確實被預算截在 16 發', servedT1.size === EXPECT && servedT2.size === EXPECT, `t1=${servedT1.size} t2=${servedT2.size}`);
  ok('P26(關鍵)第一個 tick 沒服務到的 tokens[16],在下一個 tick 真的被服務到(偏移有旋轉)',
    !servedT1.has(tokens[EXPECT]) && servedT2.has(tokens[EXPECT]), `t1有=${servedT1.has(tokens[EXPECT])} t2有=${servedT2.has(tokens[EXPECT])}`);
  ok('P26(關鍵)整個服務窗真的整條往前移:tokens[0] 在第一個 tick 有、第二個 tick 沒有',
    servedT1.has(tokens[0]) && !servedT2.has(tokens[0]), `t1有=${servedT1.has(tokens[0])} t2有=${servedT2.has(tokens[0])}`);
  // 🔴 修復輪次5:上面兩條只證明「窗有移動」,步長改成 +2 仍然全綠(窗 [2,18) 一樣含
  // tokens[16]、一樣不含 tokens[0])。逐一釘死整個服務窗的成員,步長才真的被判準綁住。
  ok('P26(關鍵)第二個 tick 的服務窗【逐一】等於 tokens[1..16]——步長恰好 +1,不是「有動就好」',
    servedT2.size === EXPECT && tokens.slice(1, EXPECT + 1).every(t => servedT2.has(t)),
    `多出來的=${JSON.stringify([...servedT2].filter(t => !tokens.slice(1, EXPECT + 1).includes(t)).map(t => t.slice(0, 8)))}`);
}

// P27(修復輪次4,關鍵):比例在極小分母上沒有資訊量。輪次3 把分母換成 attempted 之後,
// 舊門檻(候選數>=2 且比例>=50%)沒有跟著校準——高鐵那種「delaySec 恆等於 last_delay、
// 絕大多數列走跳過路徑」的 tick,attempted 可能只有 3~5,任何 2 個自然汰換的死 token
// 就是 50%,每分鐘誤觸發一次熔斷:正常回收被封死、還噴一則假的「懷疑設定錯誤」告警。
// 4 列 attempted、2 列死 ⇒ 舊門檻觸發(錯)、新門檻因 attempted<10 不做比例判定(對)。
{
  const N = 4, FAIL_N = 2;
  const tokens = Array.from({ length: N }, (_, i) => tok('p27n' + String(i).padStart(2, '0')));
  mockNowSec = 1_800_000_000;
  await resetTable();
  await insBatch(tokens, mockNowSec);
  ok('P27 前置:表裡恰好 4 列', (await rowCount()) === N, `count=${await rowCount()}`);
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  for (let i = 0; i < FAIL_N; i++) apnsPerToken[tokens[i]] = { status: 410, reason: 'Unregistered' };
  const { result: r27, errLines: errLines27 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsPerToken = {};
  ok('P27(關鍵)attempted=4(小於最低分母 10)⇒ 不做比例判定,2 個自然汰換的死 token 照常回收', r27.dropped === FAIL_N && (r27.heldBack || 0) === 0, JSON.stringify(r27));
  const rows27 = await Promise.all(tokens.map(getRow));
  ok('P27(關鍵)那 2 列真的被刪掉(舊門檻下 2/4=50% 會誤熔斷,一列都刪不掉)', rows27.slice(0, FAIL_N).every(r => r === null), JSON.stringify(rows27.slice(0, FAIL_N)));
  ok('P27 另外 2 列正常推播', r27.sent === N - FAIL_N && rows27.slice(FAIL_N).every(r => r && r.last_idx === 0), JSON.stringify(r27));
  ok('P27(關鍵)沒有噴假的「懷疑設定錯誤」告警——小分母誤熔斷會每分鐘噴一次', !errLines27.some(l => l.includes('熔斷觸發')), JSON.stringify(errLines27));
  await resetTable();
}

// ══════════════════════════════════════════════════════════════════
// Group G(修復輪次5):輪次4 的兩個結構性缺口——一個是行為回歸,一個是判準盲點。
// ══════════════════════════════════════════════════════════════════

// P28(修復輪次5,關鍵):attempted 落在 3~9 且【全敗】必須熔斷。
// 輪次4 那道 attempted>=10 是平坦的,把「比例>=0.5」與「比例==1.0」當成同一件事一起關掉
// ⇒ 設定錯誤(APNS_HOST/apns-topic 打錯,每一列以同一 reason 失敗)碰上小表時,整張表當場
// 被刪光、使用者全部要重新跟車——那正是熔斷被創造出來要擋的場景,相對輪次3 是回歸。
// 時機還最不利:本功能還沒上線,初期綁定數必然遠低於每 tick 10 次嘗試。
// 🔴 這一格(3~9 且 ratio==1.0)在輪次4 【不論正確行為是刪還是不刪都沒有任何斷言釘住】,
//    是本輪補上的;沒有它,下次有人改門檻會無聲翻面。
{
  const N = 4;
  const tokens = Array.from({ length: N }, (_, i) => tok('p28n' + String(i).padStart(2, '0')));
  mockNowSec = 1_800_000_000;
  await resetTable();
  await insBatch(tokens, mockNowSec);
  ok('P28 前置:表裡恰好 4 列(落在 3~9 這一格,兩道門檻都要看得到)', (await rowCount()) === N, `count=${await rowCount()}`);
  calls.length = 0; apnsNextStatus = 400; apnsNextReason = 'BadDeviceToken'; apnsPerToken = {};
  const { result: r28, errLines: errLines28 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  apnsNextStatus = 200; apnsNextReason = '';
  ok('P28 4 列都真的被嘗試(attempted=4)', servedSet(calls).size === N, `count=${servedSet(calls).size}`);
  ok('P28(關鍵)4/4 全敗 ⇒ 熔斷觸發:heldBack=4、dropped=0(輪次4 因 attempted<10 會整張刪光)',
    r28.heldBack === N && r28.dropped === 0, JSON.stringify(r28));
  const rows28 = await Promise.all(tokens.map(getRow));
  ok('P28(關鍵)四列一列都沒被刪——設定修好後卡片自己接上,不必要求使用者重開 App 重新跟車',
    rows28.every(r => !!r && r.last_idx === -1), JSON.stringify(rows28.map(r => r && r.last_idx)));
  ok('P28 熔斷 log 照樣留下(4/4=100%)', errLines28.some(l => l.includes('熔斷觸發') && l.includes('4/4') && l.includes('100%')), JSON.stringify(errLines28));
  await resetTable();
}

// P29(修復輪次5,關鍵):旋轉偏移必須套在【LIMIT 截斷之後】。
// 🔴 判準盲點:全檔其他區塊都用 mockNowSec = 1_800_000_000,而 floor(1.8e9/60) = 30,000,000
//    = 2⁷·3·5⁷ —— 它整除本檔用到的所有列數(4/10/12/20/24/30),於是那些區塊的 rotate 恆為 0,
//    「把旋轉搬到截斷之前」這種回歸【一條都照不到】(連 P20 都不行:它的 %3 與 %2 同為 0)。
//    本區塊刻意把時鐘挪 60 秒讓偏移非零,把這件事真的釘住。
// 搬到截斷之前會破壞輪次2 立的保證:5 列、上限 4,rows 取回 5 列後先旋轉(偏移 30,000,001%5=1)
// 再 slice(0,4) ⇒ 候選集合變成 [r1,r2,r3,r4],最快到期的 r0 被踢出、最新綁定的 r4 反而進來。
{
  const N = 5, LIMIT = 4;
  const T = 1_800_000_060;                          // floor(T/60)%4 === 1 ⇒ 截斷後的旋轉偏移非零(下面自檢)
  const tokens = Array.from({ length: N }, (_, i) => tok('p29n' + String(i).padStart(2, '0')));
  mockNowSec = T;
  await resetTable();
  await insBatch(tokens, mockNowSec);               // expire_at 遞增 ⇒ tokens[0] 最快到期、tokens[4] 最新綁定
  ok('P29 前置:5 列在表裡,且截斷後(4 列)的旋轉偏移確定非零——偏移是 0 的話這條測試沒有分辨力',
    (await rowCount()) === N && Math.floor(T / 60) % LIMIT !== 0, `count=${await rowCount()} off=${Math.floor(T / 60) % LIMIT}`);
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {}; apnsAdvanceMs = 0;
  const { result: r29, errLines: errLines29 } = await captureConsole(() => laPushAll({ ...env, LA_ROW_LIMIT: LIMIT }, fakeCtx, BASE_URL));
  const served29 = servedSet(calls);
  ok('P29(關鍵)最快到期的 tokens[0] 一定被服務到——旋轉若跑到截斷之前,它會被擠出候選集合',
    served29.has(tokens[0]), `有=${served29.has(tokens[0])}`);
  ok('P29(關鍵)最新綁定的 tokens[4] 一列都沒被打到——旋轉若跑到截斷之前,它會被擠進候選集合',
    !served29.has(tokens[N - 1]), `有=${served29.has(tokens[N - 1])}`);
  ok('P29 候選集合【逐一】等於最快到期的前 4 列(旋轉只換服務順序,不換誰是候選)',
    served29.size === LIMIT && tokens.slice(0, LIMIT).every(t => served29.has(t)), `served=${served29.size}`);
  ok('P29 觸頂仍然留 log,且截斷的仍是 1 列', errLines29.some(l => l.includes('列數觸頂') && l.includes('5>4')), JSON.stringify(errLines29));
  ok('P29 sent=4(4 個候選都推播成功)', r29.sent === LIMIT, JSON.stringify(r29));
  await resetTable();
}

// ══════════════════════════════════════════════════════════════════
// Group H(最終複審 C-2):誤點軸線。
// 既有 139 條的 last_delay 一律 0、四個 TDX fixture 的 DelayTime 也全是 0 ⇒ worker.js 裡
// 五處消費誤點的程式碼(單位換算 ×60、「沒變就不推」的誤點那一半、arrivalDate、departedDate、
// 成功後寫回 last_delay)【六發突變全部紅集 0】。本組把「誤點」這條軸線釘住,
// 它與 idx 是彼此獨立的更新觸發源,而「台鐵含誤點 offset」正是使用者定的核心規格。
// ══════════════════════════════════════════════════════════════════

// 🔴 Group H 起把假時鐘設成一個【絕對】的、必定晚於前面所有區塊的值。
// 理由:前面很多區塊用 `mockNowSec = 1_800_000_000` 絕對重設、又有很多 `+= 100`,誰先誰後
// 取決於區塊順序;而 traLive 的 isolate 記憶體快取鍵是 Date.now(),時鐘一旦【往回走】,
// `Date.now() - memAt > 55e3` 恆假 ⇒ 這裡拿到的是別的區塊留下的舊看板,情境完全不成立。
// 用絕對值起手就跟前面的區塊順序解耦(之後有人在中間插新區塊也不會靜默弄壞這一組)。
const H_BASE = 1_800_010_000;

// 🔴 複審 N(把關3):上面那段規矩(「Group H 之後時鐘只准往前」)原本【只靠人記得】,
// 而檔案裡其實已經違反過一次——PEXC 用 H_BASE+8000,而它前一格 P41 已經跑到 H_BASE+17310,
// 一次往回撥 9,310 秒;現在無害純粹因為 PEXC 是 thsr_sched、根本不呼叫 traLive。
// 下一個人在後面插一格 tra_sched、看到「8000 這個號沒人用」順手拿去,就會靜默拿到別格
// 留下的舊看板,而所有斷言照樣全綠(實測過:P40 第一版就是這樣 sent=0 的)。
// useSlot 把那條規矩變成機器檢查,兩條都查:
//   ① N 必須嚴格大於所有用過的 N —— 擋「號碼倒退」,診斷訊息直接指出撞到誰;
//   ② H_BASE + N 不得小於【當下的 mockNowSec】—— 擋真正的危害本身(區塊內部還會用
//      base+900 之類往前跑,光看 N 遞增看不出來 P39 其實已經跑到 16030)。
// 只管 Group H 之後這一段:前面 22 處絕對重設回 1_800_000_000 一行都不用改(它們都遠小於
// H_BASE,②恆成立),不會逼出既有情境重排時序。
const usedSlots = new Map();     // N → 用它的區塊標籤
function useSlot(n, label) {
  for (const [prev, who] of usedSlots) {
    if (n <= prev) abort(`[useSlot] ${label} 想用 H_BASE+${n},但 ${who} 已經用過 H_BASE+${prev}——` +
      'Group H 之後的假時鐘只准往前走(traLive 的 isolate 快取鍵是 Date.now(),往回撥會靜默拿到別格留下的舊看板)。請改用更大的號碼。');
  }
  if (H_BASE + n < mockNowSec) abort(`[useSlot] ${label} 想把時鐘設到 H_BASE+${n},但上一格已經跑到 H_BASE+${mockNowSec - H_BASE}` +
    '——區塊內部還會往前跑,光看號碼遞增看不出來。請改用更大的號碼。');
  usedSlots.set(n, label);
  return n;
}

// P30(關鍵):idx 不動、只有誤點變 —— 唯一能觸發推播的原因就是誤點。
{
  const T = tok('p30');
  await resetTable();
  mockNowSec = H_BASE + useSlot(0, 'P30');                                 // 遠晚於前面所有區塊,逼 traLive 重打假上游
  const base = mockNowSec;
  const stops = [{ name: '潮州', at: base + 600 }, { name: '屏東', at: base + 2040 }];
  await insRow({ token: T, sys: 'tra_sched', train_no: '556', stops,
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: 0, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  // 在站上(status1)且該站是停靠站 ⇒ own=0=last_idx ⇒ idx 不變;變的只有 DelayTime。
  tdxBoard = [{ TrainNo: '556', DelayTime: 5, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r30 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P30(關鍵)idx 沒變但誤點變了 ⇒ 仍然要推(「沒變就不推」的誤點那一半)', r30.sent === 1, JSON.stringify(r30));
  const c30 = calls.filter(c => c.url.includes(APNS_FRAG));
  if (c30.length === 1) {
    const cs = JSON.parse(c30[0].init.body).aps['content-state'];
    // 期望值一律獨立算術,不呼叫 laArrivalEpoch 自己(心得29:判準不可與被測物同源)
    ok('P30(關鍵)delaySec 是【秒】不是【分】:DelayTime=5 ⇒ 300', cs.delaySec === 300, String(cs.delaySec));
    ok('P30(關鍵)arrivalDate 獨立算術核對＝表定＋誤點秒數', cs.arrivalDate === base + 600 + 300, String(cs.arrivalDate));
  } else {
    ok('P30(關鍵)delaySec 是【秒】不是【分】:DelayTime=5 ⇒ 300', false, `APNs 呼叫數=${c30.length}`);
    ok('P30(關鍵)arrivalDate 獨立算術核對＝表定＋誤點秒數', false, `APNs 呼叫數=${c30.length}`);
  }
  const row30 = await getRow(T);
  ok('P30(關鍵)成功後 last_delay 真的寫回 300——沒寫回的話每個 tick 都會重推同一張卡',
    !!row30 && row30.last_delay === 300 && row30.last_idx === 0,
    row30 ? `last_idx=${row30.last_idx} last_delay=${row30.last_delay}` : '(查無列)');
  // 第二個 tick:誤點與站序都沒再變 ⇒ 必須安靜。這條是「last_delay 有沒有寫回」的直接後果,
  // 也是本專案最怕的失效模式(每分鐘重推 ⇒ 吃滿牆鐘預算 ⇒ 餓死後面的列)的端到端證據。
  mockNowSec += 100;
  tdxBoard = [{ TrainNo: '556', DelayTime: 5, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0;
  const r30b = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P30(關鍵)下一個 tick 誤點沒再變 ⇒ 零 APNs(不會每分鐘重推同一張卡)',
    r30b.sent === 0 && calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, JSON.stringify(r30b));
  await resetTable();
}

// P30b:departedDate 也要吃誤點(idx>0 才有前一站,P30 那格 idx=0 照不到)。
{
  const T = tok('p30b');
  await resetTable();
  mockNowSec = H_BASE + useSlot(1000, 'P30b');
  const base = mockNowSec;
  const stops = [{ name: '潮州', at: base + 600 }, { name: '屏東', at: base + 2040 }];
  await insRow({ token: T, sys: 'tra_sched', train_no: '557', stops,
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: 0, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = [{ TrainNo: '557', DelayTime: 3, StationID: '5000', TrainStationStatus: 0 }];  // 進站中屏東 ⇒ idx=1
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  const c = calls.filter(x => x.url.includes(APNS_FRAG));
  ok('P30b 前置:進站中屏東 ⇒ idx 前進到 1 並推播', r.sent === 1 && c.length === 1, JSON.stringify(r));
  if (c.length === 1) {
    const cs = JSON.parse(c[0].init.body).aps['content-state'];
    ok('P30b(關鍵)departedDate 獨立算術核對＝前一站表定＋誤點秒數', cs.departedDate === base + 600 + 180, String(cs.departedDate));
    ok('P30b nextStop=屏東', cs.nextStop === '屏東', String(cs.nextStop));
  } else {
    ok('P30b(關鍵)departedDate 獨立算術核對＝前一站表定＋誤點秒數', false, '(無 APNs 呼叫)');
    ok('P30b nextStop=屏東', false, '(無 APNs 呼叫)');
  }
  await resetTable();
}

// P30c(最終複審 B-Minor):delaySec 是 ContentState 裡唯一的非 Optional 數值欄,Swift 的 Int
// 解不了小數 ⇒ 餵一個小數進去會讓【整包 content-state 解碼失敗】(不是那一欄變 nil,是整張卡
// 不更新)。TDX 目前給整數分,但這條契約不該靠上游的型別自律。
{
  const T = tok('p30c');
  await resetTable();
  mockNowSec = H_BASE + useSlot(2000, 'P30c');
  const base = mockNowSec;
  const stops = [{ name: '潮州', at: base + 600 }, { name: '屏東', at: base + 2040 }];
  await insRow({ token: T, sys: 'tra_sched', train_no: '558', stops,
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: 0, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  // 🔴 這個值必須讓「×60 之後仍然不是整數」才有分辨力:2.5 分 ×60 = 150 恰好是整數,
  //    拿它當測資的話拿掉 Math.round 也照樣全綠(實測踩過)。2.51 分 ×60 = 150.6 ⇒ 四捨五入 151。
  tdxBoard = [{ TrainNo: '558', DelayTime: 2.51, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  await laPushAll(env, fakeCtx, BASE_URL);
  const c = calls.filter(x => x.url.includes(APNS_FRAG));
  if (c.length === 1) {
    const cs = JSON.parse(c[0].init.body).aps['content-state'];
    ok('P30c(B-Minor 關鍵)delaySec 一定是整數——小數會讓 Swift 整包 ContentState 解碼失敗',
      Number.isInteger(cs.delaySec) && cs.delaySec === 151, String(cs.delaySec));
  } else ok('P30c(B-Minor 關鍵)delaySec 一定是整數——小數會讓 Swift 整包 ContentState 解碼失敗', false, `APNs 呼叫數=${c.length}`);
  await resetTable();
}

// ══════════════════════════════════════════════════════════════════
// Group I(最終複審 A-I1～A-I4):後端四則 Important 修法各自的釘死者。
// ══════════════════════════════════════════════════════════════════

// P31(A-I1):熔斷的「全敗」規則在「本輪只有死 token 在嘗試」的 tick 會恆成立
// ⇒ 舊碼下該被清掉的死 token 永遠清不掉。修法＝連續失敗輪數 >= LA_FAIL_STREAK_MAX(5) 就照刪。
// 這一格連跑 5 個 tick,前 4 輪必須被熔斷擋住(否則等於熔斷沒生效),第 5 輪必須真的刪掉。
{
  await resetTable();
  mockNowSec = H_BASE + useSlot(3000, 'P31');
  const base = mockNowSec;
  const toks = ['p31a', 'p31b', 'p31c'].map(tok);
  for (let i = 0; i < toks.length; i++) {
    await insRow({ token: toks[i], sys: 'thsr_sched', train_no: '9i31' + i,
      stops: [{ name: 'A' + i, at: base + 100 }, { name: 'B' + i, at: base + 200 }],
      last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 + i });
  }
  // 三列全數 BadDeviceToken ⇒ attempted=3=候選數 ⇒ 全敗分支必然觸發(LA_BREAKER_ALL_FAIL_MIN=3)
  apnsNextStatus = 400; apnsNextReason = 'BadDeviceToken'; apnsPerToken = {}; apnsAdvanceMs = 0;
  let survived = [];
  for (let round = 1; round <= 4; round++) {
    calls.length = 0;
    const r = await laPushAll(env, fakeCtx, BASE_URL);
    survived.push(`r${round}:dropped=${r.dropped},heldBack=${r.heldBack}`);
  }
  const stillThere = (await Promise.all(toks.map(getRow))).filter(Boolean).length;
  ok('P31(A-I1 前置)前 4 輪全敗:熔斷確實擋住刪列,三列都還在——這是「熔斷有生效」的正向對照',
    stillThere === 3, `${stillThere} 列還在 / ${JSON.stringify(survived)}`);
  const rowStreak = await getRow(toks[0]);
  ok('P31(A-I1 關鍵)fail_streak 真的每輪累加(4 輪後＝4)——不累加的話下面那條門檻永遠到不了',
    !!rowStreak && rowStreak.fail_streak === 4, rowStreak ? `fail_streak=${rowStreak.fail_streak}` : '(查無列)');
  calls.length = 0;
  const { result: r5, errLines: err5 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const left = (await Promise.all(toks.map(getRow))).filter(Boolean).length;
  ok('P31(A-I1 關鍵)第 5 輪連續失敗達上限 ⇒ 死 token 終於被清掉(舊碼在這種 tick 永遠清不掉)',
    left === 0 && r5.dropped === 3, `剩 ${left} 列 / ${JSON.stringify(r5)}`);
  ok('P31(A-I1)熔斷仍然觸發、且告警文字改成陳述事實(帶連續失敗輪數),不是斷言「懷疑是設定錯誤」',
    err5.some(l => l.includes('熔斷觸發') && l.includes('連續失敗輪數') && !l.includes('懷疑是設定錯誤')), JSON.stringify(err5));
  apnsNextStatus = 200; apnsNextReason = '';
  await resetTable();
}

// P32(A-I1 的另一半):成功推播要把 fail_streak 歸零。不歸零的話,一列偶發失敗幾次之後
// 就會帶著高 streak 一路走,下次任何一次失敗都直接跳過熔斷保護被刪掉。
{
  const T = tok('p32');
  await resetTable();
  mockNowSec = H_BASE + useSlot(4000, 'P32');
  const base = mockNowSec;
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9i32',
    stops: [{ name: 'A', at: base + 100 }, { name: 'B', at: base + 200 }],
    last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  await env.DELAY_DB.prepare('UPDATE la_bindings SET fail_streak=4 WHERE token=?').bind(T).run();
  const pre32 = await getRow(T);
  ok('P32 前置:手動把 fail_streak 撥成 4 生效(撥值失敗會讓下面的歸零斷言退化成同義反覆)',
    !!pre32 && pre32.fail_streak === 4, pre32 ? `fail_streak=${pre32.fail_streak}` : '(查無列)');
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = '';
  await laPushAll(env, fakeCtx, BASE_URL);
  const post32 = await getRow(T);
  ok('P32(A-I1 關鍵)推播成功後 fail_streak 歸零', !!post32 && post32.fail_streak === 0 && post32.last_idx === 0,
    post32 ? `fail_streak=${post32.fail_streak} last_idx=${post32.last_idx}` : '(查無列)');
  await resetTable();
}

// P33(A-I2):APNs fetch 沒有 timeout 的話,單一列可以把整個 tick 吊住(Cloudflare 明文
// 「There is no set time limit on individual subrequests」)⇒ 45 秒預算不是上界,tick 會與
// 下一分鐘的 tick 重疊而重複推播。這一格讓第二列的 fetch 永遠不 resolve,驗 laPushAll 仍
// 在有限時間內跑完、而且第三列照樣被服務到。
// 🔴 這一格吃的是【真實時鐘】(setTimeout),不是 mockNowSec ⇒ 會真的花掉約 LA_APNS_TIMEOUT_MS。
{
  await resetTable();
  mockNowSec = H_BASE + useSlot(5000, 'P33');
  const base = mockNowSec;
  const toks = ['p33a', 'p33b', 'p33c'].map(tok);
  for (let i = 0; i < toks.length; i++) {
    await insRow({ token: toks[i], sys: 'thsr_sched', train_no: '9i33' + i,
      stops: [{ name: 'A' + i, at: base + 100 }, { name: 'B' + i, at: base + 200 }],
      last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 + i });
  }
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {}; apnsHangToken = toks[1];
  // 🔴 自帶看門狗:沒有逾時的話 laPushAll 會【永遠不 resolve】,這一格若直接 await 就會讓
  // 整支腳本掛住 ⇒ 沒有總計行、非綠非紅,批次判讀會誤以為通過(本專案明確踩過的坑)。
  // 用 race 把「掛住」轉成一條乾淨的 FAIL。看門狗要明顯大於 LA_APNS_TIMEOUT_MS(5 秒),
  // 才不會把「逾時有生效但機器很慢」誤判成回歸。
  const WATCHDOG_MS = 30_000;
  // 🔴 這裡【不能】直接用 captureConsole 包住 race——captureConsole 是在自己的 finally 裡還原
  // console 的,而看門狗贏的時候那個 finally 永遠不會執行 ⇒ 之後整支腳本的輸出全被吞進
  // 那個陣列裡,變成「exit 1 但看不到任何 FAIL」的假象(實測踩到)。改成自己接管、自己在
  // finally 還原,保證不論誰先回來 console 都會回到正常狀態。
  const origLog33 = console.log, origErr33 = console.error;
  const logLines33 = [], errLines33 = [];
  let done33 = false, r33 = { sent: -1 }, wallMs = -1;
  const wall0 = realDateNow();
  try {
    console.log = (...a) => { logLines33.push(a.map(String).join(' ')); };
    console.error = (...a) => { errLines33.push(a.map(String).join(' ')); };
    const race33 = await Promise.race([
      laPushAll(env, fakeCtx, BASE_URL).then(x => ({ done: true, result: x })),
      new Promise(res => setTimeout(() => res({ done: false }), WATCHDOG_MS)),
    ]);
    done33 = race33.done;
    if (race33.done) r33 = race33.result;
  } finally { console.log = origLog33; console.error = origErr33; wallMs = realDateNow() - wall0; }
  apnsHangToken = null;
  ok('P33(A-I2 關鍵)單列的 APNs 請求永遠不回應時,laPushAll 仍在有限時間內跑完(逾時真的有生效)',
    done33 && wallMs < WATCHDOG_MS, done33 ? `牆鐘 ${wallMs}ms` : `看門狗 ${WATCHDOG_MS}ms 到期,laPushAll 仍未回來(＝單列可以吊住整個 tick)`);
  const err33 = errLines33;
  ok('P33(A-I2 關鍵)被吊住的那列之後的列仍然被服務到(整個 tick 沒有被單列吃掉)',
    servedSet(calls).has(toks[2]) && r33.sent === 2, `sent=${r33.sent} served=${servedSet(calls).size}`);
  ok('P33(A-I2)逾時被歸類成暫時性失敗:那一列留在表裡等下一分鐘重試,不刪列',
    !!(await getRow(toks[1])), '(查無列＝被誤刪)');
  ok('P33(A-I2)逾時留下可診斷的 log(訊息含 apns timeout)',
    err33.some(l => l.includes('apns timeout')), JSON.stringify(err33));
  await resetTable();
}

// P34(A-I3):traLive【整批】失效時,laPushAll 拿到的東西長什麼樣?
// 🔴 查證後的真相(比複審報告更精確):traLive 上游掛掉【不會】回 502,也【不會】拋例外——
// 它有「上游失敗但沿用舊快取」的退路,回的是 200 ＋一份【舊的】看板。所以舊碼看到的是
// 「一份看起來正常的觀測資料」,所有台鐵列靜默從當下觀測退回舊觀測/表定推算,零 log。
// 唯一分得出來的訊號是資料本身的觀測時刻(TDX 的 UpdateTime)。這一格就造那個情境:
// 先讓一次成功的呼叫把快取暖起來,再讓上游掛掉並把時鐘往前推超過門檻,驗偵測與 log 都在。
{
  const T = tok('p34');
  await resetTable();
  mockNowSec = H_BASE + useSlot(6000, 'P34');
  // ① 先暖一次快取:上游正常,看板的 UpdateTime＝現在
  await insRow({ token: tok('p34w'), sys: 'tra_sched', train_no: '560',
    stops: [{ name: '潮州', at: mockNowSec + 600 }, { name: '屏東', at: mockNowSec + 2040 }],
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: 0, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  tdxBoard = [{ TrainNo: '560', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const cap34a = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P34 前置(正向對照):上游正常＋資料新鮮時,摘要 log 【不】標 traLiveDown——證明這個旗標不是恆真',
    cap34a.logLines.some(l => l.includes('tick 完成') && !l.includes('traLiveDown')), JSON.stringify(cap34a.logLines));
  ok('P34 前置:此時 tra-live 相關的 ERROR log 一則都沒有', !cap34a.errLines.some(l => l.includes('tra-live')), JSON.stringify(cap34a.errLines));
  await resetTable();

  // ② 上游掛掉,時鐘前進超過 traLive 的 55 秒快取窗與 LA_LIVE_STALE_SEC(300 秒)門檻
  //    ⇒ traLive 重打上游失敗 ⇒ 走「沿用舊快取」退路回 200 ＋ 舊的 UpdateTime。
  const base = mockNowSec + 900;
  mockNowSec = base;
  await insRow({ token: T, sys: 'tra_sched', train_no: '559',
    stops: [{ name: '潮州', at: base - 100 }, { name: '屏東', at: base + 2040 }],
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = null;                       // ⇒ TDX 回 502 ⇒ traLive 沿用舊快取回 200(關鍵!)
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const { result: r34, logLines: log34, errLines: err34 } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P34(A-I3 關鍵)上游整批失效(被舊快取頂著、HTTP 仍是 200)時留下可診斷的 ERROR log——舊碼零 log',
    err34.some(l => l.includes('tra-live 資料過舊')), JSON.stringify(err34));
  ok('P34(A-I3 關鍵)摘要 log 標記 traLiveDown,且把表定推算與觀測推播分開計數(sched=1 obs=0)',
    log34.some(l => l.includes('tick 完成') && l.includes('traLiveDown') && l.includes('obs=0 sched=1')), JSON.stringify(log34));
  ok('P34(A-I3)現行政策(LA_SCHED_FALLBACK_ON_UPSTREAM_DOWN=true)下卡片仍然前進',
    r34.sent === 1, JSON.stringify(r34));
  await resetTable();
}

// P35(A-I4):持續 403 時每個 tick 都 laJwtReset() ⇒ 每分鐘重簽一把 provider token,
// 撞上 Apple「更新頻率不得高於每 20 分鐘」的硬限制(429 TooManyProviderTokenUpdates),
// 把一個「改個設定就好」的故障延長成「改好之後還要等節流解除」。修法＝20 分鐘冷卻。
// 前一格 P15 已經在本檔更早的位置觸發過一次 reset,所以這裡量的是【冷卻期內】的行為。
{
  const T = tok('p35');
  await resetTable();
  mockNowSec = H_BASE + useSlot(7000, 'P35');
  const base = mockNowSec;
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9i35',
    stops: [{ name: 'A', at: base + 100 }, { name: 'B', at: base + 200 }],
    last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  // 連跑三輪 403。第 1 輪的 reset 是【合法的】(距上一次 reset 已超過 20 分鐘的模擬時間),
  // 所以真正的判準是第 2、3 輪:冷卻生效時它們共用同一把 JWT;沒有冷卻的話每輪都重簽,
  // 而 ECDSA 每次簽出來的位元組都不同(即使 header/payload 一字不差)⇒ 兩者一定分得出來。
  const jwtOf = () => (calls.filter(c => c.url.includes(APNS_FRAG))[0] || {}).init?.headers?.authorization;
  apnsNextStatus = 403; apnsNextReason = 'InvalidProviderToken';
  calls.length = 0;
  const cap35a = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const jwtA = jwtOf();
  calls.length = 0;
  await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const jwtB = jwtOf();
  calls.length = 0;
  const cap35c = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const jwtC = jwtOf();
  ok('P35 前置:三輪都真的送出了 APNs 請求(才有 JWT 可比)',
    [jwtA, jwtB, jwtC].every(x => typeof x === 'string' && x.startsWith('bearer ')),
    [jwtA, jwtB, jwtC].map(x => String(x).slice(0, 14) + '…').join(' / '));
  ok('P35 前置(正向對照):第 1 輪的 403 確實作廢了快取 ⇒ 第 2 輪拿到的是【新的】JWT',
    jwtA !== jwtB, jwtA === jwtB ? '(兩輪同一把,代表 403 根本沒觸發重簽)' : '(已重簽)');
  ok('P35(A-I4 關鍵)冷卻期內連續 403 的下一輪【沿用快取的 JWT】,不再每分鐘重簽(Apple 硬限制 20 分鐘)',
    jwtB === jwtC, jwtB === jwtC ? '(同一把)' : '(又重簽了!)');
  ok('P35(A-I4)冷卻期內留下一則說明用的 log(否則看不出「已停止重簽、正在等冷卻」)',
    cap35c.errLines.some(l => l.includes('冷卻期')), JSON.stringify(cap35c.errLines));
  ok('P35(A-I4)第一輪的 403 本身仍照舊留下 status+reason 的 log',
    cap35a.errLines.some(l => l.includes('403') && l.includes('InvalidProviderToken')), JSON.stringify(cap35a.errLines));
  apnsNextStatus = 200; apnsNextReason = '';
  await resetTable();
}

// ══════════════════════════════════════════════════════════════════
// Group I(2026-08-08 工項 A/B):上游斷線告知 ＋ 觀測回復時往回修站序
// ══════════════════════════════════════════════════════════════════
// 取 content-state 的小工具。刻意在「APNs 呼叫數不是 1」時回 null 而不是丟例外或靜默略過
// ——回 null 會讓下面每一條斷言【變紅】,不會讓它們消失(心得37(d)/C1-Minor-5 家族)。
const csOne = (list) => {
  const c = list.filter(x => x.url.includes(APNS_FRAG));
  if (c.length !== 1) return null;
  try { return JSON.parse(c[0].init.body).aps['content-state']; } catch (e) { return null; }
};
const NOTICE_EXPECT = '即時資料中斷，位置為預估。實際動態請查台鐵官網';   // 使用者逐字核可,獨立寫死一份

// P36(工項 A 關鍵 + 實作時查出的凍住漏洞):上游整批失效,而【舊快取裡有這台車】。
// 🔴 這是真實斷線的形態,既有的 P34 照不到:P34 的舊快取裡剛好沒有那台車(t 為 undefined),
//    所以它走到了表定推算;真實世界的舊看板是同一份看板,那台車一定在裡面 ⇒ t 是 truthy
//    ⇒ 舊碼拿【舊觀測】算索引 ⇒ 算出跟 last_idx 一樣的值 ⇒「沒變就不推」⇒ 卡片整段
//    斷線期間凍住,正面違反使用者裁示「不能讓火車凍住」。
//    (實測的上游斷線:22 天內三次,全在週一早高峰,長 95／86／65 分鐘。)
{
  const T = tok('p36');
  await resetTable();
  mockNowSec = H_BASE + useSlot(9000, 'P36');
  // ① 暖快取:上游正常,看板裡就有 561,而且時刻是新鮮的
  const warmBase = mockNowSec;
  await insRow({ token: tok('p36w'), sys: 'tra_sched', train_no: '561',
    stops: [{ name: 'A', at: warmBase + 600 }, { name: 'B', at: warmBase + 1200 }, { name: 'C', at: warmBase + 2040 }],
    staMap: { '5050': 0, '5000': 1, '5010': 2 }, stopCodes: ['5050', '5000', '5010'],
    last_idx: -1, last_obs_idx: -1, last_delay: 0, bound_at: warmBase, expire_at: warmBase + 3600 });
  tdxBoard = [{ TrainNo: '561', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const capWarm = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const csWarm = csOne(calls);
  // 正向對照(工項 A 的反面):資料新鮮的台鐵列【必須】notice=null。少了這條,「斷線才送」
  // 就分不出「真的只在斷線送」與「每一發都送」。
  ok('P36 正向對照:上游正常＋資料新鮮的台鐵列,notice 必須是 null',
    !!csWarm && csWarm.notice === null, csWarm ? `notice=${JSON.stringify(csWarm.notice)}` : '(APNs 呼叫數不是 1)');
  ok('P36 正向對照:此時摘要 log 記成觀測(obs=1 sched=0)',
    capWarm.logLines.some(l => l.includes('tick 完成') && l.includes('obs=1 sched=0')), JSON.stringify(capWarm.logLines));
  await resetTable();

  // ② 上游掛掉,時鐘前進超過 traLive 的 55 秒快取窗與 LA_LIVE_STALE_SEC(300 秒)
  //    ⇒ traLive 沿用舊快取回 200 ＋【含 561 的舊看板】。
  const base = warmBase + 900;
  mockNowSec = base;
  // 舊觀測說車在 5050(索引 0);表定則說現在該到索引 2(前兩站的表定時刻都已過)。
  // 兩者刻意分岔,才分得出「用了舊觀測(凍住)」與「照表定前進」。
  await insRow({ token: T, sys: 'tra_sched', train_no: '561',
    stops: [{ name: 'A', at: base - 600 }, { name: 'B', at: base - 100 }, { name: 'C', at: base + 2040 }],
    staMap: { '5050': 0, '5000': 1, '5010': 2 }, stopCodes: ['5050', '5000', '5010'],
    last_idx: 0, last_obs_idx: 0, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = null;                       // ⇒ TDX 回 502 ⇒ traLive 沿用舊快取回 200(關鍵!)
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const cap36 = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs36 = csOne(calls);
  ok('P36(關鍵)上游整批失效但舊看板裡仍有這台車時,卡片【不凍住】:照表定前進到 C(舊碼會停在舊觀測的 A)',
    cap36.result.sent === 1 && !!cs36 && cs36.nextStop === 'C',
    `sent=${cap36.result.sent} nextStop=${cs36 ? cs36.nextStop : '(無 APNs 呼叫)'}`);
  ok('P36(關鍵)content-state 帶上使用者核可的斷線告知(逐字比對)',
    !!cs36 && cs36.notice === NOTICE_EXPECT, cs36 ? JSON.stringify(cs36.notice) : '(APNs 呼叫數不是 1)');
  ok('P36(關鍵)舊觀測不得被記成觀測:摘要 log 是 obs=0 sched=1',
    cap36.logLines.some(l => l.includes('tick 完成') && l.includes('obs=0 sched=1')), JSON.stringify(cap36.logLines));
  const row36 = await getRow(T);
  ok('P36(工項B 的另一半)表定推算【不得】寫 last_obs_idx:last_idx 前進到 2,last_obs_idx 仍是 0',
    !!row36 && row36.last_idx === 2 && row36.last_obs_idx === 0,
    row36 ? `last_idx=${row36.last_idx} last_obs_idx=${row36.last_obs_idx}` : '(查無列)');
  await resetTable();
}

// P37(工項 B 關鍵):表定推過頭之後,觀測恢復要能把站序【往回】修。
// 舊碼的單調閘門地板是 last_idx ⇒ Math.max(觀測, 推過頭的值) 恆等於推過頭的值
// ⇒ 錯的站名黏到列車真的追上為止(斷線 95 分鐘 ⇒ 卡片可能整整一個多小時顯示沒發生的事)。
{
  const T = tok('p37');
  await resetTable();
  mockNowSec = H_BASE + useSlot(10000, 'P37');
  const base = mockNowSec;
  const stops = [0, 1, 2, 3, 4].map(i => ({ name: 'S' + i, at: base + 600 + i * 600 }));
  await insRow({ token: T, sys: 'tra_sched', train_no: '562', stops,
    staMap: { C0: 1, C1: 2, C2: 3, C3: 4 }, stopCodes: ['C0', 'C1', 'C2', 'C3', 'C4'],
    last_idx: 4, last_obs_idx: 1,        // 4＝斷線期間表定推過頭;1＝最後一次真的觀測到的站
    last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = [{ TrainNo: '562', DelayTime: 0, StationID: 'C2', TrainStationStatus: 1 }];   // 真實位置:索引 2
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r37 = await laPushAll(env, fakeCtx, BASE_URL);
  const cs37 = csOne(calls);
  ok('P37(工項B 關鍵)觀測恢復後把表定推過頭的站序往回修:4 → 2(舊碼會卡在 4 不動)',
    r37.sent === 1 && !!cs37 && cs37.nextStop === 'S2',
    `sent=${r37.sent} nextStop=${cs37 ? cs37.nextStop : '(無 APNs 呼叫)'}`);
  const row37 = await getRow(T);
  ok('P37(工項B 關鍵)往回修之後 last_idx 與 last_obs_idx 一起落在 2(地板跟著觀測走)',
    !!row37 && row37.last_idx === 2 && row37.last_obs_idx === 2,
    row37 ? `last_idx=${row37.last_idx} last_obs_idx=${row37.last_obs_idx}` : '(查無列)');
  await resetTable();
}

// P37b(工項 B 的守門,與 P37 同樣關鍵):閘門原本要擋的東西一格都不准放進來。
// 上一個索引【本身就是觀測來的】(last_obs_idx === last_idx)時,行為必須與舊碼逐字相同:
// 觀測回報較早的站 ⇒ 不動。這是「觀測序列單調不減」這條不變式的釘死者。
{
  const T = tok('p37b');
  await resetTable();
  mockNowSec = H_BASE + useSlot(11000, 'P37b');
  const base = mockNowSec;
  const stops = [0, 1, 2, 3, 4].map(i => ({ name: 'S' + i, at: base + 600 + i * 600 }));
  await insRow({ token: T, sys: 'tra_sched', train_no: '563', stops,
    staMap: { C0: 1, C1: 2, C2: 3, C3: 4 }, stopCodes: ['C0', 'C1', 'C2', 'C3', 'C4'],
    last_idx: 4, last_obs_idx: 4,        // 4 是【觀測】來的 ⇒ 閘門全額生效
    last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = [{ TrainNo: '563', DelayTime: 0, StationID: 'C2', TrainStationStatus: 1 }];   // 觀測抖動:回報較早的站
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r37b = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P37b(工項B 守門)上一個索引也是觀測來的時候,觀測回報較早的站【不倒退】⇒ 零 APNs',
    r37b.sent === 0 && calls.filter(c => c.url.includes(APNS_FRAG)).length === 0,
    `sent=${r37b.sent} apns=${calls.filter(c => c.url.includes(APNS_FRAG)).length}`);
  const row37b = await getRow(T);
  ok('P37b(工項B 守門)D1 的 last_idx 仍是 4,沒有被抖動拉低',
    !!row37b && row37b.last_idx === 4 && row37b.last_obs_idx === 4,
    row37b ? `last_idx=${row37b.last_idx} last_obs_idx=${row37b.last_obs_idx}` : '(查無列)');
  await resetTable();
}

// P37c(工項 B 的地板):往回修有下限——最低只能修回【上一次真的觀測到】的那一站。
// 這條把本輪選的做法(地板＝last_obs_idx)與「上一次是推算就整個放行」的做法分開:
// 後者會讓一發落後的觀測把卡片一路拉回 S1,比推過頭更難看。
{
  const T = tok('p37c');
  await resetTable();
  mockNowSec = H_BASE + useSlot(12000, 'P37c');
  const base = mockNowSec;
  const stops = [0, 1, 2, 3, 4, 5].map(i => ({ name: 'S' + i, at: base + 600 + i * 600 }));
  await insRow({ token: T, sys: 'tra_sched', train_no: '564', stops,
    staMap: { C0: 1, C1: 2, C2: 3, C3: 4, C4: 5 }, stopCodes: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'],
    last_idx: 5, last_obs_idx: 3,        // 5＝表定推過頭;3＝最後一次真的觀測到的站
    last_delay: 0, bound_at: base, expire_at: base + 3600 });
  tdxBoard = [{ TrainNo: '564', DelayTime: 0, StationID: 'C1', TrainStationStatus: 1 }];   // 落後的觀測:索引 1
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r37c = await laPushAll(env, fakeCtx, BASE_URL);
  const cs37c = csOne(calls);
  ok('P37c(工項B 地板)落後的觀測只能把站序修回 S3(最後一次真的觀測到的站),不是一路掉到 S1',
    r37c.sent === 1 && !!cs37c && cs37c.nextStop === 'S3',
    `sent=${r37c.sent} nextStop=${cs37c ? cs37c.nextStop : '(無 APNs 呼叫)'}`);
  await resetTable();
}

// PBIND(工項 B 的另一個必要條件):同一顆 device token 換綁另一台車時,last_obs_idx 必須
// 與 last_idx 一起歸零。laBind 的 UPSERT 是全專案【唯一】會重設 last_idx 的地方;漏了這一欄,
// 單調閘門的地板會停在【上一台車】的索引,新車的第一發觀測被 Math.max 直接抬上去
// ⇒ 卡片一開就跳到中途某一站。這條盯的是「新增狀態欄位卻忘了在重設點一起重設」這個形態。
{
  // 🔴 這一格與其他格不同:laBind 會【真的驗】token 格式(64 碼小寫 hex),
  //    tok() 造出來的可讀標籤(含非 hex 字母)會被擋在 bad_token,端點根本不會跑到 UPSERT。
  const T = 'bdbd' + '0'.repeat(60);
  await resetTable();
  mockNowSec = H_BASE + useSlot(13000, 'PBIND');
  const base = mockNowSec;
  // 先造出「上一台車已經跑到第 5 站、而且卡上正掛著斷線告知」的狀態。
  // 🔴 每一個狀態欄位都必須設成【非預設值】,否則「漏了重設這一欄」的突變會因為
  //    「本來就等於預設值」而看起來像通過(實測:last_notice 留在預設 0 時,
  //    拿掉 UPSERT 裡的 last_notice=0 這一發突變紅集是 0 ——斷言等於沒有)。
  await insRow({ token: T, sys: 'tra_sched', train_no: '565',
    stops: [0, 1, 2, 3, 4, 5].map(i => ({ name: 'X' + i, at: base + i * 600 })),
    staMap: { C0: 1 }, stopCodes: ['C0'],
    last_idx: 5, last_obs_idx: 5, last_delay: 180, last_notice: 1, bound_at: base, expire_at: base + 3600 });
  // 同一顆 token 換綁另一台車。走【真的 laBind 端點函式】,不是自己寫一發 SQL——
  // 要驗的正是那句 UPSERT 的 DO UPDATE SET 有沒有把新欄位一起歸零。
  const bindEnv = Object.assign(Object.create(Object.getPrototypeOf(env) || Object.prototype), env);
  bindEnv.LA_TEST_BEARER = 'pbind-local-test';      // 具名本機測試閘門(正式環境不設這顆 secret)
  delete bindEnv.LA_LIMITER;                        // 限流替身在這個 harness 不存在,拿掉才是確定性的
  const bindRes = await worker._la.laBind(new Request('https://dummy.invalid/api/la/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer pbind-local-test' },
    body: JSON.stringify({
      token: T, sys: 'tra_sched', trainNo: '566',
      stops: [{ name: 'Y0', at: base + 300 }, { name: 'Y1', at: base + 900 }],
      stopCodes: ['D0', 'D1'], staMap: { D0: 1 },
    }),
  }), bindEnv);
  const bindBody = await bindRes.clone().text();
  ok('PBIND 前置(正向對照):換綁真的成功了(200),否則下面兩條在「端點根本沒跑」時也會通過',
    bindRes.status === 200, `status=${bindRes.status} body=${bindBody}`);
  const rowB = await getRow(T);
  ok('PBIND 前置:換綁確實覆寫了這一列(train_no 565 → 566)',
    !!rowB && rowB.train_no === '566', rowB ? `train_no=${rowB.train_no}` : '(查無列)');
  // 🔴 複審 N-3:本條自述的目的就是盯「新增狀態欄位卻忘了在重設點一起重設」這個形態,
  //    而本輪新增的 last_notice 正好是這個形態的下一個受害者(換綁後實測 last_notice=1 黏著)。
  //    它的傷害比另兩欄輕(下一輪因 last_idx=-1 必推、順手寫回 0 ⇒ 會自愈),但把新欄位一併
  //    納入斷言才是這條的意義——留一個例外就是留給下一個新欄位的坑。
  ok('PBIND(關鍵)換綁時三個狀態欄位一起歸零(last_idx／last_obs_idx=-1、last_delay／last_notice=0)——地板沒歸零的話新車一開卡就跳到第 5 站',
    !!rowB && rowB.last_idx === -1 && rowB.last_obs_idx === -1 && rowB.last_delay === 0 && Number(rowB.last_notice) === 0,
    rowB ? `last_idx=${rowB.last_idx} last_obs_idx=${rowB.last_obs_idx} last_delay=${rowB.last_delay} last_notice=${rowB.last_notice}` : '(查無列)');
  await resetTable();
}

// ══════════════════════════════════════════════════════════════════
// Group J(2026-08-08 複審修復輪次 1):C-1／I-1／I-2／I-3
// ══════════════════════════════════════════════════════════════════
// 依 token 取 content-state。同一 tick 有多列時 csOne() 不夠用——必須指名是哪一列的那一發。
const csOfTok = (tk) => {
  const c = calls.filter(x => x.url.includes(APNS_FRAG + tk));
  if (c.length !== 1) return null;
  try { return JSON.parse(c[0].init.body).aps['content-state']; } catch (e) { return null; }
};

// P36b(複審 I-2):`notice` 判定式裡的 `row.sys === 'tra_sched'` 原本【零紅集】——
// harness 裡 liveDown 為真的每一格批次都只有台鐵列,唯一驗高鐵 notice=null 的 P1 卻跑在
// 沒斷線的批次 ⇒「高鐵不掛告知」其實只被「沒有斷線」保證,沒有被 sys 閘門保證。
// 正式運轉的每個 tick 掃的是同一張表(SELECT * 無 sys 過濾),台鐵與高鐵混在一起;
// 這一格就是那個【同 tick 併發對照組】:一列台鐵、一列高鐵,同一次斷線,結果必須相反。
{
  const Ttra = tok('p36btra'), Tthsr = tok('p36bthsr');
  await resetTable();
  mockNowSec = H_BASE + useSlot(14000, 'P36b');
  const warmBase = mockNowSec;
  await insRow({ token: tok('p36bw'), sys: 'tra_sched', train_no: '571',
    stops: [{ name: 'A', at: warmBase + 600 }, { name: 'B', at: warmBase + 1200 }],
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: -1, last_delay: 0, bound_at: warmBase, expire_at: warmBase + 3600 });
  tdxBoard = [{ TrainNo: '571', DelayTime: 0, StationID: '5050', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  await laPushAll(env, fakeCtx, BASE_URL);          // 只為了暖 traLive 的快取
  await resetTable();

  const base = warmBase + 900;
  mockNowSec = base;
  await insRow({ token: Ttra, sys: 'tra_sched', train_no: '571',
    stops: [{ name: 'A', at: base - 600 }, { name: 'B', at: base + 2040 }],
    staMap: { '5050': 0, '5000': 1 }, stopCodes: ['5050', '5000'],
    last_idx: 0, last_obs_idx: 0, last_delay: 0, bound_at: base, expire_at: base + 3600 });
  await insRow({ token: Tthsr, sys: 'thsr_sched', train_no: '9571',
    stops: [{ name: 'H0', at: base + 600 }, { name: 'H1', at: base + 2040 }],
    last_idx: -1, last_delay: 0, bound_at: base, expire_at: base + 3601 });
  tdxBoard = null;                                   // 台鐵上游整批失效
  calls.length = 0;
  const cap36b = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const served36b = servedSet(calls);
  ok('P36b 前置(正向對照):同一個斷線 tick 裡台鐵與高鐵【兩列都真的推了】——否則下面兩條在「根本沒推」時也會通過',
    cap36b.result.sent === 2 && served36b.has(Ttra) && served36b.has(Tthsr),
    `sent=${cap36b.result.sent} served=${JSON.stringify([...served36b].map(x => x.slice(0, 8)))}`);
  ok('P36b(I-2 關鍵)同一個斷線 tick 裡,【台鐵】列掛上核可文案',
    (csOfTok(Ttra) || {}).notice === NOTICE_EXPECT, JSON.stringify((csOfTok(Ttra) || {}).notice));
  ok('P36b(I-2 關鍵)同一個斷線 tick 裡,【高鐵】列的 notice 必須是 null——高鐵本來就沒有台鐵即時資料,掛「請查台鐵官網」是雙重錯誤',
    (csOfTok(Tthsr) || { notice: '(這一列沒推)' }).notice === null,
    JSON.stringify((csOfTok(Tthsr) || { notice: '(這一列沒推)' }).notice));

  // 第二輪:什麼都沒變(斷線持續)。這是 C-1 修法的【陷阱守門】——
  // 用 last_obs_idx !== last_idx 之類的代理旗標會讓高鐵／支線(last_obs_idx 恆 -1)每分鐘重推。
  mockNowSec = base + 30;
  calls.length = 0;
  const cap36b2 = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P36b(C-1 陷阱守門)斷線持續且站序／誤點都沒變的下一輪:零 APNs——告知只在【變化】時推,不是每分鐘重推',
    cap36b2.result.sent === 0 && calls.filter(c => c.url.includes(APNS_FRAG)).length === 0,
    `sent=${cap36b2.result.sent} apns=${calls.filter(c => c.url.includes(APNS_FRAG)).length}`);
  const rowThsr2 = await getRow(Tthsr);
  ok('P36b(C-1 陷阱守門)高鐵列的 last_notice 全程是 0(它永遠不掛告知)⇒ 判定式對它退化成原本的兩項',
    !!rowThsr2 && Number(rowThsr2.last_notice) === 0,
    rowThsr2 ? `last_notice=${rowThsr2.last_notice} last_obs_idx=${rowThsr2.last_obs_idx} last_idx=${rowThsr2.last_idx}` : '(查無列)');
  await resetTable();
}

// P39(複審 C-1 關鍵):斷線結束後,卡片上的「即時資料中斷」必須被清掉。
// 舊碼的「沒變就不推」只看 idx 與 delaySec ⇒ 準點車在上游恢復那一輪,若真觀測恰好等於表定
// 猜的那一站(常態:表定推算本來就常猜對)且誤點沒變(準點車全程 0),就零推播
// ⇒ 卡片持續宣稱資料中斷並把人導去查台鐵官網,直到列車真的換站(自強號跨站可達 20–40 分)。
{
  const T = tok('p39');
  await resetTable();
  mockNowSec = H_BASE + useSlot(15000, 'P39');
  const warmBase = mockNowSec, base = warmBase + 900;
  // 表定刻意安排成:斷線那一輪 laSchedIdx 會推到 3(前三站的表定時刻都已過)
  const stops = [
    { name: 'S0', at: base - 1800 }, { name: 'S1', at: base - 1200 }, { name: 'S2', at: base - 600 },
    { name: 'S3', at: base + 1200 }, { name: 'S4', at: base + 3000 },
  ];
  const staMap = { C0: 1, C1: 2, C2: 3, C3: 4 }, stopCodes = ['C0', 'C1', 'C2', 'C3', 'C4'];
  await insRow({ token: T, sys: 'tra_sched', train_no: '570', stops, staMap, stopCodes,
    last_idx: -1, last_obs_idx: -1, last_delay: 0, bound_at: warmBase, expire_at: base + 7200 });

  // ① 上游正常:觀測說車在 C2(索引 2)⇒ 推 S2、notice=null
  mockNowSec = warmBase;
  tdxBoard = [{ TrainNo: '570', DelayTime: 0, StationID: 'C2', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const cap39a = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs39a = csOne(calls);
  ok('P39 前置:① 上游正常時推到 S2 且 notice=null',
    cap39a.result.sent === 1 && !!cs39a && cs39a.nextStop === 'S2' && cs39a.notice === null,
    `sent=${cap39a.result.sent} ${cs39a ? `nextStop=${cs39a.nextStop} notice=${JSON.stringify(cs39a.notice)}` : '(無 APNs 呼叫)'}`);

  // ② 斷線:表定推到 S3 並掛上告知
  mockNowSec = base;
  tdxBoard = null;
  calls.length = 0;
  const cap39b = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs39b = csOne(calls);
  ok('P39 前置:② 斷線時表定推到 S3 且掛上核可文案',
    cap39b.result.sent === 1 && !!cs39b && cs39b.nextStop === 'S3' && cs39b.notice === NOTICE_EXPECT,
    `sent=${cap39b.result.sent} ${cs39b ? `nextStop=${cs39b.nextStop} notice=${JSON.stringify(cs39b.notice)}` : '(無 APNs 呼叫)'}`);

  // ③ 上游恢復,而真觀測【恰好等於】表定猜的那一站(C3＝索引 3),誤點也沒變(準點車)
  //    ⇒ idx 與 delaySec 兩項都相同 ⇒ 舊碼在這裡 continue、告知永遠留在卡上。
  mockNowSec = base + 100;
  tdxBoard = [{ TrainNo: '570', DelayTime: 0, StationID: 'C3', TrainStationStatus: 1 }];
  calls.length = 0;
  const cap39c = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs39c = csOne(calls);
  ok('P39 前置:③ 這一輪上游【真的】恢復了(摘要 log 已無 traLiveDown)',
    cap39c.logLines.some(l => l.includes('tick 完成') && !l.includes('traLiveDown')), JSON.stringify(cap39c.logLines));
  ok('P39(C-1 關鍵)恢復當輪 idx 與誤點都沒變,仍必須推恰好一發把告知清掉(notice=null),站名維持 S3',
    cap39c.result.sent === 1 && !!cs39c && cs39c.notice === null && cs39c.nextStop === 'S3',
    `sent=${cap39c.result.sent} ${cs39c ? `nextStop=${cs39c.nextStop} notice=${JSON.stringify(cs39c.notice)}` : '(無 APNs 呼叫)'}`);
  const row39c = await getRow(T);
  ok('P39(C-1)清掉之後 D1 的 last_notice 寫回 0(下一輪才安靜得下來)',
    !!row39c && Number(row39c.last_notice) === 0,
    row39c ? `last_notice=${row39c.last_notice} last_idx=${row39c.last_idx} last_obs_idx=${row39c.last_obs_idx}` : '(查無列)');

  // ④ 再下一輪:什麼都沒變 ⇒ 必須安靜。這條擋的是「為了清告知而每分鐘重推」。
  mockNowSec = base + 130;
  calls.length = 0;
  const cap39d = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('P39(C-1 關鍵)清掉之後的下一輪回到零 APNs——修法沒有把它變成每分鐘重推',
    cap39d.result.sent === 0 && calls.filter(c => c.url.includes(APNS_FRAG)).length === 0,
    `sent=${cap39d.result.sent} apns=${calls.filter(c => c.url.includes(APNS_FRAG)).length}`);
  await resetTable();
}

// P40(複審 I-1 關鍵):觀測「認不出站碼」不是觀測,不得寫進單調閘門的地板。
// laNextIdx 在認不出站碼時回 lastIdx——那可能是斷線期間表定推過頭的值。舊碼只看 useObs
// 就把它寫成 last_obs_idx ⇒ 地板被毒化 ⇒ 之後真觀測再也拉不回來 ⇒ 工項 B 對這一趟永久失效。
{
  const T = tok('p40');
  await resetTable();
  // 🔴 必須晚於 P39 最後一輪(H_BASE+16030):假時鐘一旦往回走,traLive 的
  //    `Date.now() - memAt > 55e3` 恆假 ⇒ 拿到的是上一格留下的看板,情境完全不成立
  //    (見 H_BASE 的註解)。這裡刻意留 170 秒餘裕。
  mockNowSec = H_BASE + useSlot(16200, 'P40');
  const base = mockNowSec;
  const stops = [0, 1, 2, 3, 4].map(i => ({ name: 'S' + i, at: base + 600 + i * 600 }));
  await insRow({ token: T, sys: 'tra_sched', train_no: '573', stops,
    staMap: { C0: 1, C1: 2, C2: 3, C3: 4 }, stopCodes: ['C0', 'C1', 'C2', 'C3', 'C4'],
    last_idx: 4, last_obs_idx: 1,          // 4＝斷線期間表定推過頭;1＝最後一次真的觀測到的站
    last_delay: 0, bound_at: base, expire_at: base + 7200 });
  // 上游恢復的第一發:站碼不在 staMap／stopCodes 裡(通過站漏編／支線缺口／終點之後),
  // 同時誤點值變了 ⇒「沒變就不推」不成立 ⇒ 這一列【真的會推】,也就真的會寫 UPDATE。
  tdxBoard = [{ TrainNo: '573', DelayTime: 3, StationID: 'ZZZZ', TrainStationStatus: 2 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r40a = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P40 前置(正向對照):認不出站碼但誤點變了的那一輪【真的推了一發】——否則下面兩條在「根本沒推」時也會通過',
    r40a.sent === 1, JSON.stringify(r40a));
  const row40a = await getRow(T);
  ok('P40(I-1 關鍵)認不出站碼＝這一發沒有新觀測:last_obs_idx 必須維持 1,不得被寫成表定推過頭的 4',
    !!row40a && row40a.last_obs_idx === 1 && row40a.last_idx === 4,
    row40a ? `last_idx=${row40a.last_idx} last_obs_idx=${row40a.last_obs_idx}` : '(查無列)');
  // 下一輪真觀測回來說車在 C1(索引 2 的前一站對應 idx 2)⇒ 地板沒被毒化的話要能修回 S2
  mockNowSec = base + 100;
  tdxBoard = [{ TrainNo: '573', DelayTime: 3, StationID: 'C2', TrainStationStatus: 1 }];
  calls.length = 0;
  const r40b = await laPushAll(env, fakeCtx, BASE_URL);
  const cs40b = csOne(calls);
  ok('P40(I-1 關鍵)地板沒被毒化 ⇒ 下一輪真觀測說 S2 時卡片真的修回 S2(舊碼會永遠卡在 S4)',
    r40b.sent === 1 && !!cs40b && cs40b.nextStop === 'S2',
    `sent=${r40b.sent} nextStop=${cs40b ? cs40b.nextStop : '(無 APNs 呼叫)'}`);
  await resetTable();
}

// P41(複審 I-3):liveDown 的後果本輪被放大成「整批丟棄觀測＋對使用者宣告中斷」,
// 但新鮮度這條軸原本只取了 0 秒與 900 秒兩個極端點,門檻(LA_LIVE_STALE_SEC=300)附近一發都沒有。
// 上游延遲＋isolate 快取 55 秒＋邊緣 stale-while-revalidate 300 疊起來有越界空間,
// 越界的代價是全台鐵卡片同時掛上假告知。這一格在門檻兩側各釘一格。
{
  const Tlo = tok('p41lo'), Thi = tok('p41hi');
  await resetTable();
  mockNowSec = H_BASE + useSlot(17000, 'P41');
  const warmBase = mockNowSec;
  await insRow({ token: tok('p41w'), sys: 'tra_sched', train_no: '572',
    stops: [{ name: 'W0', at: warmBase + 600 }, { name: 'W1', at: warmBase + 1200 }],
    staMap: { C0: 1 }, stopCodes: ['C0', 'C1'],
    last_idx: -1, last_delay: 0, bound_at: warmBase, expire_at: warmBase + 7200 });
  tdxBoard = [{ TrainNo: '572', DelayTime: 0, StationID: 'C1', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  await laPushAll(env, fakeCtx, BASE_URL);          // 暖快取:UpdateTime = warmBase
  await resetTable();

  // ① 觀測時刻距今 290 秒(< 門檻 300)⇒【不算】斷線:照常用觀測、不掛告知
  mockNowSec = warmBase + 290;
  await insRow({ token: Tlo, sys: 'tra_sched', train_no: '572',
    stops: [{ name: 'S0', at: mockNowSec + 600 }, { name: 'S1', at: mockNowSec + 1200 }],
    staMap: { C0: 1 }, stopCodes: ['C0', 'C1'],
    last_idx: 0, last_obs_idx: 0, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 7200 });
  tdxBoard = null;                                   // 上游打不通 ⇒ traLive 沿用舊快取回 200
  calls.length = 0;
  const cap41a = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs41a = csOne(calls);
  ok('P41(I-3 邊界)觀測距今 290 秒(門檻 300 之下):不算斷線——摘要 log 不得出現 traLiveDown',
    cap41a.logLines.some(l => l.includes('tick 完成') && !l.includes('traLiveDown')), JSON.stringify(cap41a.logLines));
  ok('P41(I-3 邊界)門檻之下仍走觀測(nextStop=S1)且 notice=null——差 10 秒不該讓全台鐵卡片掛上假告知',
    cap41a.result.sent === 1 && !!cs41a && cs41a.nextStop === 'S1' && cs41a.notice === null,
    `sent=${cap41a.result.sent} ${cs41a ? `nextStop=${cs41a.nextStop} notice=${JSON.stringify(cs41a.notice)}` : '(無 APNs 呼叫)'}`);
  await resetTable();

  // ② 觀測時刻距今 310 秒(> 門檻 300)⇒ 算斷線:退表定並掛告知
  mockNowSec = warmBase + 310;
  await insRow({ token: Thi, sys: 'tra_sched', train_no: '572',
    stops: [{ name: 'S0', at: mockNowSec - 600 }, { name: 'S1', at: mockNowSec + 2040 }],
    staMap: { C0: 1 }, stopCodes: ['C0', 'C1'],
    last_idx: 0, last_obs_idx: 0, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 7200 });
  calls.length = 0;
  const cap41b = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs41b = csOne(calls);
  ok('P41(I-3 邊界)觀測距今 310 秒(門檻 300 之上):算斷線——摘要 log 標記 traLiveDown',
    cap41b.logLines.some(l => l.includes('tick 完成') && l.includes('traLiveDown')), JSON.stringify(cap41b.logLines));
  ok('P41(I-3 邊界)門檻之上掛上核可文案(與 ① 只差 20 秒,兩側各釘一格才擋得住門檻被改壞)',
    cap41b.result.sent === 1 && !!cs41b && cs41b.notice === NOTICE_EXPECT,
    `sent=${cap41b.result.sent} ${cs41b ? `notice=${JSON.stringify(cs41b.notice)}` : '(無 APNs 呼叫)'}`);
  await resetTable();
}

// PEXC(最終複審 C1-I2):全域尾閘。worker.js 的 per-row try/catch 會把任何例外變成一行 log
// 就 continue、不改任何回傳計數 ⇒ 例外通道對既有斷言【結構性隱形】(實測:讓每一列都拋
// TypeError,139 條照樣全綠)。這條把「沒有我沒預期到的例外」變成具名斷言。
// 正向對照在 P14(網路層 reject 必須留下同一個訊號),兩者缺一這條就沒有牙。
// 🔴 複審 N(把關3):這一格原本用 H_BASE+8000,比它前面的 P41(17000)早了 9,310 秒——
// 檔案裡唯一一次違反「時鐘只准往前」的地方。當時無害純粹因為本格是 thsr_sched、不呼叫
// traLive,但它留下一個「8000 這個號沒人用」的陷阱給下一個人。這裡選擇【改號搬到尾端】
// 而不是加明示豁免:本格完全自足(自己 resetTable → 設鐘 → 插自己的列 → 斷言 → resetTable),
// 改號零行為風險;留一個有理由的豁免等於在檔案裡留一個可以被 cargo-cult 的倒退先例。
{
  const T = tok('pexc');
  await resetTable();
  mockNowSec = H_BASE + useSlot(18000, 'PEXC');
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9exc',
    stops: [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }],
    last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {}; apnsRejectToken = null;
  const { errLines: errExc } = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  ok('PEXC(關鍵)正常情境零「單列處理失敗」——例外通道有具名 gate,不再隱形',
    !errExc.some(l => l.includes('單列處理失敗')), JSON.stringify(errExc));
  await resetTable();
}

// P42(複審 N-1 關鍵):告知【出現】那一半原本零斷言。複審自設突變 MX(把判定式第三項的
// `===` 改成 `>=`,語意＝「告知消失才推、出現不推」)跑出 219 項 FAIL 0——因為 P39 只驗消失,
// 而 P36b／P41 的斷線輪 idx 都同時變了 ⇒ 判定式前兩項自己就會觸發,第三項全程搭便車。
// 失效情境是常態不是邊角:列車大半時間在兩站之間跑(laSchedIdx 整段回同一索引),準點車
// delay 又恆為 0 ⇒ 斷線開始那一輪前兩項本來就都沒變 ⇒ 退化成「斷線了卻不說」。
{
  const T = tok('p42');
  await resetTable();
  mockNowSec = H_BASE + useSlot(19000, 'P42');
  const warmBase = mockNowSec;
  // 暖 traLive 快取:UpdateTime = warmBase(之後把鐘推到 +900 就會判定成上游整批失效)
  await insRow({ token: tok('p42w'), sys: 'tra_sched', train_no: '574',
    stops: [{ name: 'W0', at: warmBase + 600 }, { name: 'W1', at: warmBase + 1200 }],
    staMap: { C0: 0 }, stopCodes: ['C0', 'C1'],
    last_idx: -1, last_delay: 0, bound_at: warmBase, expire_at: warmBase + 7200 });
  tdxBoard = [{ TrainNo: '574', DelayTime: 0, StationID: 'C0', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  await laPushAll(env, fakeCtx, BASE_URL);
  await resetTable();

  // 斷線那一輪:車在 S1→S2 之間(S1 表定已過、S2 還沒到)⇒ laSchedIdx 回 2 ＝ last_idx;
  // 準點車 DelayTime 恆 0 ⇒ delaySec 0 ＝ last_delay。判定式前兩項【都沒變】,
  // 唯一變的是告知從無到有 ⇒ 這一發推播只可能是第三項觸發的。
  mockNowSec = warmBase + 900;
  const base = mockNowSec;
  await insRow({ token: T, sys: 'tra_sched', train_no: '574',
    stops: [{ name: 'S0', at: base - 1200 }, { name: 'S1', at: base - 600 },
      { name: 'S2', at: base + 900 }, { name: 'S3', at: base + 2400 }],
    staMap: { C0: 0, C1: 1 }, stopCodes: ['C0', 'C1', 'C2', 'C3'],
    last_idx: 2, last_obs_idx: 1, last_delay: 0, last_notice: 0,
    bound_at: base, expire_at: base + 7200 });
  tdxBoard = null;                                   // 上游打不通 ⇒ traLive 沿用舊快取回 200
  calls.length = 0;
  const cap42 = await captureConsole(() => laPushAll(env, fakeCtx, BASE_URL));
  const cs42 = csOne(calls);
  ok('P42 前置:這一輪【真的】被判定成上游斷線(否則下面驗到的不是「告知出現」)',
    cap42.logLines.some(l => l.includes('tick 完成') && l.includes('traLiveDown')), JSON.stringify(cap42.logLines));
  ok('P42(N-1 關鍵)斷線【開始】那一輪:站序與誤點都沒變(車在兩站之間＋準點車＝常態),仍必須推恰好一發把告知【掛上去】',
    cap42.result.sent === 1 && !!cs42 && cs42.notice === NOTICE_EXPECT && cs42.nextStop === 'S2',
    `sent=${cap42.result.sent} ${cs42 ? `nextStop=${cs42.nextStop} notice=${JSON.stringify(cs42.notice)}` : '(無 APNs 呼叫)'}`);
  const row42 = await getRow(T);
  ok('P42(N-1)掛上之後 D1 的 last_notice 寫成 1(下一輪才安靜得下來)',
    !!row42 && Number(row42.last_notice) === 1,
    row42 ? `last_notice=${row42.last_notice}` : '(查無列)');
  // 🔴 正向對照:證明推播的原因【真的只有】告知——前兩項若其實變了,上面那條就只是搭便車,
  //    跟 MX 全綠是同一種病。寫回的 last_idx／last_delay 必須逐字等於插入時的值。
  ok('P42(N-1 正向對照)前兩項確實沒變:寫回的 last_idx 仍是 2、last_delay 仍是 0(它們若變了,這一格就證明不了是告知本身觸發推播)',
    !!row42 && Number(row42.last_idx) === 2 && Number(row42.last_delay) === 0,
    row42 ? `last_idx=${row42.last_idx} last_delay=${row42.last_delay}` : '(查無列)');
  await resetTable();
}

// P43(複審 N-2 關鍵):地板原本只在「真的推了」的輪次前進——走「沒變就不推」那條 continue 的
// 輪次,即使這一發觀測真的解出了索引,last_obs_idx 也不會吸收它。於是「上一次真的觀測到的
// 那一站」與地板脫鉤,下一發抖動觀測會拿一個過時的低地板把卡片往回拉好幾站,
// 直接打破工項 B 自己講死的界線。使用者看到的是鎖屏上列車倒退三站。
{
  const T = tok('p43'), Tctl = tok('p43ctl');
  await resetTable();
  mockNowSec = H_BASE + useSlot(20000, 'P43');
  const base = mockNowSec;
  const stops = [0, 1, 2, 3, 4, 5].map(i => ({ name: 'S' + i, at: base + 600 + i * 600 }));
  const staMap = { C0: 0, C1: 1, C2: 2, C3: 3, C4: 4, C5: 5 };
  const stopCodes = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
  // last_idx=5 但 last_obs_idx=1:先前上游短暫不回報這班車、走表定推算推到第 5 站
  //(那一段不是 liveDown ⇒ 不掛告知 ⇒ last_notice 仍是 0)。
  await insRow({ token: T, sys: 'tra_sched', train_no: '575', stops, staMap, stopCodes,
    last_idx: 5, last_obs_idx: 1, last_delay: 0, last_notice: 0,
    bound_at: base, expire_at: base + 7200 });

  // ① 觀測回來說 C5(索引 5)⇒ idx=5=last_idx、誤點 0=last_delay、無告知 ⇒ 三項全等 ⇒ 不推。
  //    但這一發【是】真觀測,地板必須吸收它。
  tdxBoard = [{ TrainNo: '575', DelayTime: 0, StationID: 'C5', TrainStationStatus: 1 }];
  calls.length = 0; apnsNextStatus = 200; apnsNextReason = ''; apnsPerToken = {};
  const r43a = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P43 前置:這一輪卡片內容確實沒變 ⇒ 零推播(修法不可以為了推進地板而變成每分鐘重推)',
    r43a.sent === 0 && calls.filter(c => c.url.includes(APNS_FRAG)).length === 0,
    `sent=${r43a.sent} apns=${calls.filter(c => c.url.includes(APNS_FRAG)).length}`);
  const row43a = await getRow(T);
  ok('P43(N-2 關鍵)跳過推播的那一輪,地板仍必須吸收這一發真觀測:last_obs_idx 由 1 前進到 5',
    !!row43a && Number(row43a.last_obs_idx) === 5,
    row43a ? `last_obs_idx=${row43a.last_obs_idx} last_idx=${row43a.last_idx}` : '(查無列)');

  // ② 下一發【抖動】觀測報 C2(索引 2)。地板正確(5)時 max(2,5)=5 ⇒ 卡片不動;
  //    地板停在 1 時 max(2,1)=2 ⇒ 卡片從 S5 倒退到 S2。
  //    同 tick 併發正向對照 Tctl:地板【本來就真的】只到 1(沒吃到 ① 那一發),
  //    同一塊看板必須把它拉回 S2——證明這塊看板是活的、機制真的會動,
  //    上面那條的「沒動」不是因為 fixture 根本沒送到(心得29:判準要有正向對照)。
  mockNowSec = base + 100;                            // >55 秒,逼 traLive 重打(仍遠小於 300 秒門檻)
  await insRow({ token: Tctl, sys: 'tra_sched', train_no: '575', stops, staMap, stopCodes,
    last_idx: 5, last_obs_idx: 1, last_delay: 0, last_notice: 0,
    bound_at: base, expire_at: base + 7200 });
  tdxBoard = [{ TrainNo: '575', DelayTime: 0, StationID: 'C2', TrainStationStatus: 1 }];
  calls.length = 0;
  const r43b = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P43(N-2 關鍵)地板吸收之後,抖動觀測拉不動卡片:這一列一發 APNs 都沒有(舊碼會推 S2＝鎖屏上列車倒退三站)',
    csOfTok(T) === null, `本列 APNs 呼叫數=${calls.filter(c => c.url.includes(APNS_FRAG + T)).length}`);
  const row43b = await getRow(T);
  ok('P43(N-2)寫回的 last_idx 仍是 5(單調閘門守住,不是靠沒推才看起來沒退)',
    !!row43b && Number(row43b.last_idx) === 5, row43b ? `last_idx=${row43b.last_idx}` : '(查無列)');
  const cs43ctl = csOfTok(Tctl);
  ok('P43(N-2 正向對照)同一塊抖動看板對【地板真的只到 1】的那一列確實生效(拉回 S2)——證明看板是活的,上面的「沒動」不是 fixture 沒送到',
    !!cs43ctl && cs43ctl.nextStop === 'S2' && r43b.sent === 1,
    `sent=${r43b.sent} ${cs43ctl ? `nextStop=${cs43ctl.nextStop}` : '(對照列無 APNs 呼叫)'}`);
  await resetTable();
}

// 🔴 覆蓋率 gate(最終複審 C1-Minor-5,心得 37(d)):總斷言數本來只印在總計行、從無斷言。
// 條件式區塊被跳過(例如「APNs 呼叫數不是 1」而該區塊沒寫 else 回填)會讓分母【無聲縮水】:
// 實測某一發突變讓總計從 139 掉到 128,11 條斷言消失而沒有任何人報警。
// 這條把「每一格都真的跑到了」變成具名斷言。改動本檔的斷言數時要一併更新這個常數。
{
  const EXPECT_TOTAL = 231;   // 不含本條;本條自己會讓總計 +1(2026-08-08 工項 A/B:181 → 199;複審修復輪次1:→ 218;輪次2(N-1/N-2＋三個把關):→ 231)
  ok(`COV 覆蓋率 gate:本輪斷言總數必須恰好等於預期 ${EXPECT_TOTAL}(區塊被跳過或條件式吞掉會讓分母無聲縮水)`,
    results.length === EXPECT_TOTAL, `actual=${results.length}`);
}

await dispose();
Date.now = realDateNow;
globalThis.fetch = realFetch;
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

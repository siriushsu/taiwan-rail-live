// 台鐵等站卡推播鏈的驗收。受測物是 worker.js 的 traWaitPushAll／traWaitBind／traWaitUnbind
// ——三者都吃 D1、APNs 與 /api/tra-live 三個 IO,沒有純函式測試蓋得到
// (純邏輯那一層另有 scripts/verify_tra_wait_core.mjs,48 項＋11 發突變)。
//
// 手法沿用 verify_metro_wait_push.mjs(同一組 IO、同一組限制):
//   getPlatformProxy() 在 Node 端取得真的 D1 binding,直接呼叫函式,不經 HTTP
//   ——workerd 的 fetch 拒絕自簽憑證,而 APNs 的 URL scheme 寫死 https,用 wrangler dev 打不通。
//
// 🔴 官方即時動態攔在 `caches.default.match` 這一層(同 verify_metro_wait_push):正式環境的
//    cron 絕大多數時候本來就是邊緣快取命中,攔這一層跑到的是更接近真實的路徑;而造假 TDX
//    上游等於把 traLive 的實作細節抄進判準(心得 29 明令禁止的同源)。
//
// 判準獨立性(心得 29):期望值一律直接寫字面量或用獨立算術算出來,不呼叫 tra_wait_core 的
// 任何函式來產生「期望」——那會退化成「驗證這支函式跟自己一致」。
//
// ── 本機前置(缺任何一項這支腳本會 abort,不會假綠) ──────────────────────────
//   1) 本機 D1 套 schema(wrangler dev/getPlatformProxy 都不會自動建表):
//      arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --local \
//        --file=schema/0010_tra_wait.sql
//      arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --local \
//        --file=schema/0013_tra_wait_prev_dep.sql
//   2) .dev.vars 要有三顆 APNs 假 secret(值不會送到 Apple,但 APNS_KEY_P8 必須是真的
//      P-256 PKCS8,否則 crypto.subtle.importKey 會拋)。產生一把丟棄式的:
//      node -e "const{generateKeyPairSync}=require('crypto');const{privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});\
//        const pem=privateKey.export({type:'pkcs8',format:'pem'}).trim().replace(/\n/g,'\\\\n');\
//        console.log('APNS_KEY_P8=\"'+pem+'\"\nAPNS_KEY_ID=FAKELOCAL1\nAPNS_TEAM_ID=FAKELOCALTEAM')" >> .dev.vars
//   3) 跑:  node scripts/verify_tra_wait_push.mjs
//      (TW_WT=<其他 worktree 絕對路徑> 可覆寫受測目標;預設就是這支腳本所在的那棵樹)
import { getPlatformProxy } from 'wrangler';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
let printed = false;
function summary(reason) {
  if (printed) return;
  printed = true;
  const bad = results.filter(r => !r.p).length;
  console.log(reason ? `\n總計(中止,未完成) ${results.length} 項,FAIL ${bad} — 原因:${reason}`
                     : `\n總計 ${results.length} 項,FAIL ${bad}`);
}
function abort(reason) { console.error(reason); summary(reason); process.exit(2); }
const fatal = (tag) => (e) => { console.error(e && e.stack ? e.stack : String(e)); abort(`${tag}:${String((e && e.message) || e).split('\n')[0]}`); };
process.on('uncaughtException', fatal('未攔截例外,腳本中止'));
process.on('unhandledRejection', fatal('未處理的 promise rejection,腳本中止'));
process.on('exit', () => { if (!printed) { summary('行程在印出「總計」之前就結束了'); process.exitCode = 2; } });

// ══════════════════════════════════════════════════════════════════
// G0(第一道 gate,心得 32):驗的到底是哪一棵樹的哪一份 worker.js?
// 預設指向【這支腳本自己所在的樹】而不是任何暫存副本——釘死的目標會讓「當輪改動一項都沒被
// 驗到」長得跟全綠一模一樣。路徑與 md5 一律印出來。
// ══════════════════════════════════════════════════════════════════
const WT = process.env.TW_WT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerSrc = readFileSync(`${WT}/worker.js`, 'utf8');
console.log(`受測目標:${WT}/worker.js  md5=${createHash('md5').update(workerSrc).digest('hex')}`);
ok('G0(自檢)受測的 worker.js 真的含有 traWaitPushAll(驗錯目標時這一條先紅)',
  /async function traWaitPushAll\(/.test(workerSrc));

// ── 假時鐘與假網路 ──────────────────────────────────────────────────
let mockNowSec = 1_800_000_000;
Date.now = () => mockNowSec * 1000;

const APNS_FRAG = '/3/device/';
let apnsCalls = [];
let apnsNextStatus = 200, apnsNextReason = '';
let apnsAdvanceSec = 0;          // 每一發 APNs 讓假時鐘往前走幾秒(預設 0＝不走)
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes(APNS_FRAG)) {
    const token = u.split(APNS_FRAG)[1];
    const host = u.includes('api.sandbox.push.apple.com') ? 'sandbox' : 'prod';
    apnsCalls.push({ token, host, body: JSON.parse(init.body), headers: init.headers, at: mockNowSec });
    if (apnsAdvanceSec) mockNowSec += apnsAdvanceSec;   // 模擬「第一輪跑很久」(S 組)
    return new Response(JSON.stringify({ reason: apnsNextReason }), { status: apnsNextStatus });
  }
  // 🔴 刻意讓其他目標一律拋:上游造假只走 caches.default 那一層。這一拋同時是 D 組
  //    「tra-live 整個拿不到」的模擬手段(traLive 的 catch 會回 502)。
  throw new Error(`[verify_tra_wait_push] 未預期的 fetch 目標(受測物打了不該打的地方,或測試設計漏配):${u}`);
};

// ── /api/tra-live 的替身:攔在邊緣快取這一層 ──────────────────────────
const jsonResp = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
let srcLive = null;              // null = 快取沒有這一筆 ⇒ 落到 fetch ⇒ 上面那一拋 ⇒ 502
let cacheMatches = [];
globalThis.caches = {
  default: {
    async match(req) {
      const u = String((req && req.url) || req);
      cacheMatches.push(u);
      if (u.includes('/api/tra-live')) return srcLive ? jsonResp(srcLive) : undefined;
      return undefined;
    },
    async put() {},
  },
};

async function captureConsole(fn) {
  const origLog = console.log, origErr = console.error;
  const logLines = [], errLines = [];
  console.log = (...a) => { logLines.push(a.map(String).join(' ')); };
  console.error = (...a) => { errLines.push(a.map(String).join(' ')); };
  try { return { result: await fn(), logLines, errLines }; }
  finally { console.log = origLog; console.error = origErr; }
}

const { env, dispose } = await getPlatformProxy({ configPath: `${WT}/wrangler.jsonc` });
if (!env.APNS_KEY_P8) abort('.dev.vars 沒有 APNS_KEY_P8 ⇒ traWaitPushAll 會在第一行早退成 no-op,後面所有「沒推播」的斷言都會假綠。請照檔頭前置步驟 2 產生一把丟棄式金鑰。');
if ('APNS_HOST' in env) delete env.APNS_HOST;
// 用量埋點的替身:cron 內部呼叫 /api/tra-live 帶 _src=cron 就不該寫任何一筆
// (否則每分鐘一筆合成的假前景資料會污染 railisland_usage,那個 dataset 正是用來算成本的)。
let usageWrites = 0;
env.USAGE = { writeDataPoint() { usageWrites++; } };
const worker = await import(`${WT}/worker.js`);
if (!worker._tw || typeof worker._tw.traWaitPushAll !== 'function') abort('worker.js 沒有導出 _tw.traWaitPushAll');
const { traWaitPushAll, traWaitPushWithHalf, traWaitBind, traWaitUnbind } = worker._tw;
if (typeof traWaitPushWithHalf !== 'function') abort('worker.js 沒有導出 _tw.traWaitPushWithHalf');
const fakeCtx = { waitUntil(p) { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
const BASE = 'https://dummy.invalid';

// ══════════════════════════════════════════════════════════════════
// G1(第二道 gate):被測的 D1 到底有沒有這支腳本假設的欄位?少一欄的症狀是每列都拋進
// per-row catch ⇒ 一堆斷言以「沒推」的形式假綠。期望值直接寫死,不從 schema 檔解析。
// ══════════════════════════════════════════════════════════════════
{
  let cols = [];
  try {
    const rs = await env.DELAY_DB.prepare('PRAGMA table_info(tra_wait_bindings)').all();
    cols = (rs.results || []).map(r => r.name).sort();
  } catch (e) { cols = []; }
  const want = ['apns_env', 'bound_at', 'end_at', 'expire_at', 'fail_streak', 'last_state', 'prev_dep_sec', 'sched_sec', 'station', 'token', 'train_no'].sort();
  if (!cols.length) abort('本機 D1 沒有 tra_wait_bindings 這張表——請照檔頭前置步驟 1 套 schema/0010_tra_wait.sql');
  if (!cols.includes('prev_dep_sec')) abort('本機 D1 的 tra_wait_bindings 沒有 prev_dep_sec——請照檔頭前置步驟 1 套 schema/0013_tra_wait_prev_dep.sql');
  ok('G1(schema gate)tra_wait_bindings 的欄位集合正確', JSON.stringify(cols) === JSON.stringify(want),
    `實際=${JSON.stringify(cols)}`);
}

// ══════════════════════════════════════════════════════════════════
// G2-G5(跨行程契約):推播的 content-state 欄位集合必須逐字等於 Swift ContentState 的屬性名。
// 這條契約失效時【兩端都看不到】:裝置端 JSONDecoder 靜默失敗(整張卡不再更新),APNs 照回 200。
// ══════════════════════════════════════════════════════════════════
const SWIFT_PATH = `${WT}/app/ios/App/App/TraWaitAttributes.swift`;
const swiftSrc = readFileSync(SWIFT_PATH, 'utf8');
let swiftProps = [];
{
  const m = swiftSrc.match(/struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s{4}\}/);
  if (m) swiftProps = [...m[1].matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(x => x[1]);
}
ok('G2 前置(分母閘門):解得出 TraWaitAttributes.ContentState 的屬性(解不出＝這條契約檢查等於沒有)',
  swiftProps.length >= 4, `解到 ${swiftProps.length} 個:${JSON.stringify(swiftProps)}`);
const CONTRACT_KEYS = ['delayMin', 'dataAt', 'notice', 'pushed', 'tick'];
const CONTRACT_SORTED = CONTRACT_KEYS.slice().sort();
ok('G3(跨行程契約)Swift ContentState 的屬性集合 === 後端 content-state 的契約欄位集合',
  JSON.stringify(swiftProps.slice().sort()) === JSON.stringify(CONTRACT_SORTED),
  `swift=${JSON.stringify(swiftProps.slice().sort())} expect=${JSON.stringify(CONTRACT_SORTED)}`);
{
  const stateBlock = (swiftSrc.match(/struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s{4}\}/) || [, ''])[1];
  const nonOptional = [...stateBlock.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n]+)$/gm)]
    .filter(x => !x[2].replace(/\/\/.*$/, '').trim().endsWith('?'))
    .map(x => x[1]);
  ok('G4(跨行程契約)ContentState 每一欄都是 Optional', nonOptional.length === 0,
    nonOptional.length ? `非 Optional:${JSON.stringify(nonOptional)}` : '全部 Optional');
}
{
  // 🔴 G5 精度反向對照(原始碼層):台鐵沒有秒級精度,ContentState 不准出現任何「秒」語意的欄位。
  //    只掃 ContentState 區塊——attributes 的 schedSec/endAt 是絕對時刻不是倒數,合法。
  //    這是名稱層的粗篩;卡片【渲染輸出】不得出現 mm:ss 的那條在步驟 5 另外掃。
  const stateBlock = (swiftSrc.match(/struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s{4}\}/) || [, ''])[1];
  const smells = [...stateBlock.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)]
    .map(x => x[1]).filter(n => /sec|second|countdown|remain|eta/i.test(n));
  ok('G5(精度反向對照)ContentState 沒有任何秒級倒數欄位(台鐵官方沒有這個精度)',
    smells.length === 0, smells.length ? `可疑欄位:${JSON.stringify(smells)}` : '(無)');
}

// ── D1 小工具 ───────────────────────────────────────────────────────
// token 必須是【合法的 64 碼小寫 hex】:bind 端點會驗格式(LA_TOKEN_RE),而 traWaitPushAll
// 不驗(它讀的是 D1 已存在的列)。把 tag 轉成 hex,任何 tag 都合法。
const T = tag => (Buffer.from(String(tag), 'utf8').toString('hex') + '0'.repeat(64)).slice(0, 64);
ok('G0b(自檢)測試用 token 通過 worker 的格式驗證(不合法的話端點那組會以 bad_token 的形式假紅)',
  /^(?:[0-9a-f]{2}){32,128}$/.test(T('a1')), T('a1'));

async function resetTable() { await env.DELAY_DB.prepare('DELETE FROM tra_wait_bindings').run(); }
async function insRow(r) {
  await env.DELAY_DB.prepare(
    'INSERT INTO tra_wait_bindings (token,station,train_no,sched_sec,prev_dep_sec,end_at,last_state,fail_streak,apns_env,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(r.token, r.station || '臺北', r.train_no, r.sched_sec, r.prev_dep_sec == null ? null : r.prev_dep_sec, r.end_at,
    r.last_state == null ? null : JSON.stringify(r.last_state), r.fail_streak || 0,
    r.apns_env == null ? null : r.apns_env, r.bound_at == null ? mockNowSec : r.bound_at,
    r.expire_at == null ? r.end_at + 300 : r.expire_at).run();
}
async function getRow(token) {
  const rs = await env.DELAY_DB.prepare('SELECT * FROM tra_wait_bindings WHERE token=?').bind(token).all();
  return rs.results[0] || null;
}
async function tick() {
  apnsCalls = []; cacheMatches = [];
  const cap = await captureConsole(() => traWaitPushAll(env, fakeCtx, BASE));
  return { ...cap, apns: apnsCalls.slice(), matches: cacheMatches.slice() };
}
// cron 真正跑的那一條:第一輪＋同一次執行內 +30 秒那一輪(worker.js waitCardHalfMinute)。
// 睡眠用假的:把假時鐘往前撥,並記下「第二輪起跑前已經查過幾次來源」——第二輪結束時多出來的
// 就是第二輪自己打的上游(必須是 0,TDX 點數不准多花)。halfHook 在第二輪起跑前執行。
let halfHook = null;
async function tickHalf() {
  apnsCalls = []; cacheMatches = [];
  const sleeps = [];
  let before = null;
  const sleep = async ms => {
    sleeps.push(ms);
    mockNowSec += ms / 1000;
    if (halfHook) await halfHook();
    before = cacheMatches.length;
  };
  const cap = await captureConsole(() => traWaitPushWithHalf(env, fakeCtx, BASE, sleep));
  return { ...cap, apns: apnsCalls.slice(), matches: cacheMatches.slice(), sleeps,
    halfMatches: before == null ? null : cacheMatches.length - before };
}
// 官方即時動態的替身。at 預設就是「現在」。
const feed = (trains, atSec = mockNowSec) => ({ at: new Date(atSec * 1000).toISOString(), srv: mockNowSec * 1000, trains });

// 表訂 = 現在 + 20 分鐘(等車的人最典型的位置)。全部期望值都從這兩個字面量算,不引用受測碼。
const SCHED = () => mockNowSec + 1200;

// ══════════════════════════════════════════════════════════════════
// A 首發:誤點照抄、實際到站、跨行程契約、精度
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  srcLive = feed([{ no: '123', delay: 3, sta: '1000', status: 2 },
                  { no: '456', delay: 0, sta: '1010', status: 2 }], mockNowSec - 40);
  await insRow({ token: T('a1'), train_no: '123', sched_sec: sched, end_at: sched + 1800 });
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('A1 首發:有推一發,且 event=update', r.apns.length === 1 && r.apns[0].body.aps.event === 'update',
    `apns=${r.apns.length}`);
  ok('A2 content-state 的 key 集合 === 跨行程契約',
    cs && JSON.stringify(Object.keys(cs).sort()) === JSON.stringify(CONTRACT_SORTED), JSON.stringify(cs));
  ok('A3 誤點照抄官方(3 分)', cs && cs.delayMin === 3, JSON.stringify(cs));
  ok('A4 dataAt 用【上游自己的資料時刻】,不是我方的 now',
    cs && cs.dataAt === mockNowSec - 40, `dataAt=${cs && cs.dataAt} now=${mockNowSec}`);
  ok('A5 pushed=true(伺服器餵的每一發都要標,視圖靠它決定要不要說「不會自己更新」)', cs && cs.pushed === true);
  // 🔴 精度:誤點是【整數分鐘】。送出秒數或小數就是在製造官方沒有的精度。
  ok('A6(精度)delayMin 是整數', cs && Number.isInteger(cs.delayMin), String(cs && cs.delayMin));
  // 🔴 stale-date = 實際約到站 = 表訂 + 誤點。期望值用字面算術獨立算(sched + 3*60)。
  ok('A7 stale-date === 表訂 + 誤點分鐘×60(視圖靠 isStale 翻成「已進站」)',
    r.apns[0].body.aps['stale-date'] === sched + 180, String(r.apns[0].body.aps['stale-date']));
  ok('A8 apns-topic 是 liveactivity(topic 打錯會整批 DeviceTokenNotForTopic)',
    r.apns[0].headers['apns-topic'] === 'tw.railisland.app.push-type.liveactivity');
  ok('A9 apns-priority=5(5 不計入更新預算)', r.apns[0].headers['apns-priority'] === '5');
  ok('A10 推播成功後 last_state 存的是【真的送出去的那一包】',
    JSON.parse((await getRow(T('a1'))).last_state).delayMin === 3);
  ok('A11 只打一次 /api/tra-live(所有列共用同一份,零新增上游成本)',
    r.matches.filter(u => u.includes('/api/tra-live')).length === 1, JSON.stringify(r.matches));
  ok('A11b cron 內部呼叫不寫用量埋點(少了 _src=cron 就會每分鐘產生一筆假的前景資料)',
    usageWrites === 0, `usageWrites=${usageWrites}`);
}
{
  // 正向對照:準點必須是 0,不是 null。這一條與 A13 是同一件事的兩面。
  await resetTable();
  const sched = SCHED();
  await insRow({ token: T('a2'), train_no: '456', sched_sec: sched, end_at: sched + 1800 });
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('A12 準點(官方 delay=0)⇒ delayMin=0 而不是 null', cs && cs.delayMin === 0, JSON.stringify(cs));
  ok('A12b 準點時 stale-date === 表訂本人', r.apns[0].body.aps['stale-date'] === sched, String(r.apns[0].body.aps['stale-date']));
}
{
  // 🔴 全檔最重要的一條:不在官方動態窗裡的車不可以被畫成準點。
  await resetTable();
  const sched = SCHED();
  await insRow({ token: T('a3'), train_no: '999', sched_sec: sched, end_at: sched + 1800 });
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('A13 查不到這班車(且沒有上一次的值)⇒ delayMin=null,絕不等於準點',
    cs && cs.delayMin === null, JSON.stringify(cs));
  ok('A13b 誤點未知時 stale-date 退回表訂(唯一有的官方值)',
    r.apns[0].body.aps['stale-date'] === sched, String(r.apns[0].body.aps['stale-date']));
  // 車次比對是字串等值:'99' / '0999' 都不可以吃到 '999'。
  await resetTable();
  srcLive = feed([{ no: '999', delay: 7 }]);
  await insRow({ token: T('a4'), train_no: '99', sched_sec: sched, end_at: sched + 1800 });
  const r2 = await tick();
  ok('A14 車次嚴格比對(99 不可以吃到 999 那班的誤點)',
    r2.apns[0].body.aps['content-state'].delayMin === null);
}

// ══════════════════════════════════════════════════════════════════
// B 推播遲滯:什麼值得再推一發
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  const AT = mockNowSec - 30;
  srcLive = feed([{ no: '123', delay: 3 }], AT);
  await insRow({ token: T('b1'), train_no: '123', sched_sec: sched, end_at: sched + 1800 });
  const r1 = await tick();
  ok('B1 第一輪必推(last_state 是 NULL)', r1.apns.length === 1, `apns=${r1.apns.length}`);
  mockNowSec += 60;
  const r2 = await tick();
  ok('B2 誤點與資料時刻都沒變 ⇒ 不推', r2.apns.length === 0, `apns=${r2.apns.length}`);
  // 資料時刻漂 599 秒不推、600 秒推(門檻 TW_DATA_AT_EPS_SEC,期望值寫死不引用常數)
  srcLive = feed([{ no: '123', delay: 3 }], AT + 599);
  const r3 = await tick();
  ok('B3 資料時刻只漂 599 秒 ⇒ 不推(推一發只為了把「更新」時刻撥一格是純浪費)',
    r3.apns.length === 0, `apns=${r3.apns.length}`);
  srcLive = feed([{ no: '123', delay: 3 }], AT + 600);
  const r4 = await tick();
  ok('B4 資料時刻漂 600 秒 ⇒ 推(卡片上的「HH:mm 更新」不能越來越假)',
    r4.apns.length === 1, `apns=${r4.apns.length}`);
  ok('B4b 推出去之後 last_state 換成新的 dataAt(遲滯基準是「上次送出的」不是「上一輪算的」)',
    JSON.parse((await getRow(T('b1'))).last_state).dataAt === AT + 600);
  // 誤點變了一定要推,不看資料時刻漂多少。
  srcLive = feed([{ no: '123', delay: 4 }], AT + 600);
  const r5 = await tick();
  ok('B5 誤點 3→4 分 ⇒ 推(即使資料時刻一秒沒動)', r5.apns.length === 1, `apns=${r5.apns.length}`);
}
{
  // 🔴 0 與 null 是兩種事實,轉換必須推。用數值比較(Number(null)===0)會讓這兩條靜默漏掉。
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  srcLive = feed([{ no: '123', delay: 0 }]);
  await insRow({ token: T('b2'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
    last_state: { delayMin: null, dataAt: mockNowSec, notice: null, pushed: true } });
  const r = await tick();
  ok('B6 「沒有資訊」→「準點」要推(兩者是不同的事實)', r.apns.length === 1
    && r.apns[0].body.aps['content-state'].delayMin === 0, `apns=${r.apns.length}`);
  // 反向:準點 → 沒有資訊。用資料過舊來造(fresh=false ⇒ 不 hold,照常翻成無資訊)。
  await resetTable();
  await insRow({ token: T('b3'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
    last_state: { delayMin: 0, dataAt: mockNowSec, notice: null, pushed: true } });
  srcLive = feed([{ no: '123', delay: 0 }], mockNowSec - 1801);
  const r2 = await tick();
  ok('B7 「準點」→「沒有資訊」也要推(資料過舊時繼續宣稱準點就是說謊)',
    r2.apns.length === 1 && r2.apns[0].body.aps['content-state'].delayMin === null,
    JSON.stringify(r2.apns[0] && r2.apns[0].body.aps['content-state']));
}

// ══════════════════════════════════════════════════════════════════
// C 收卡
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  // 表訂 10 分鐘前、誤點 3 分 ⇒ 實際到站 = 表訂+180 = 現在 - 420。已過 420 秒 > 180 寬限。
  const sched = mockNowSec - 600;
  srcLive = feed([{ no: '123', delay: 3 }]);
  // 🔴 last_state 刻意用【舊版 worker 存下來的殘缺形狀】(只有兩個 key):end 那一發的欄位
  //    集合必須以現算的為準,直接送 prev 會讓舊資料決定跨行程契約 ⇒ 卡片少收兩欄。
  await insRow({ token: T('c1'), train_no: '123', sched_sec: sched, end_at: mockNowSec + 3600,
    last_state: { delayMin: 3, dataAt: mockNowSec - 60 } });
  const r = await tick();
  const aps = r.apns[0] && r.apns[0].body.aps;
  ok('C1 實際到站已過 180 秒寬限 ⇒ 推 end', r.apns.length === 1 && aps.event === 'end', `event=${aps && aps.event}`);
  ok('C2 end 帶 dismissal-date=now(不帶的話卡片會留在鎖屏上到 staleDate 才灰掉)',
    aps && aps['dismissal-date'] === mockNowSec, String(aps && aps['dismissal-date']));
  ok('C3 end 的 content-state key 集合完整——即使這一列的 last_state 是舊版存的殘缺形狀', aps
    && JSON.stringify(Object.keys(aps['content-state']).sort()) === JSON.stringify(CONTRACT_SORTED),
    JSON.stringify(aps && aps['content-state']));
  ok('C3b end 的【值】沿用上次送出去的那一包(卡片被收走前的最後一瞬不該變成一排空白)',
    aps && aps['content-state'].delayMin === 3 && aps['content-state'].dataAt === mockNowSec - 60);
  ok('C4 收卡後那一列被刪掉(不刪會每分鐘再推一次 end)', (await getRow(T('c1'))) === null);
}
{
  // 邊界對照:證明 C1 的紅是「寬限期」造成的,不是整段路徑不通。
  await resetTable();
  const sched = mockNowSec - 359;    // 實際到站 = sched+180 = now-179,還沒過 180 秒
  srcLive = feed([{ no: '123', delay: 3 }]);
  await insRow({ token: T('c2'), train_no: '123', sched_sec: sched, end_at: mockNowSec + 3600 });
  const r = await tick();
  ok('C5(邊界對照)實際到站才過 179 秒 ⇒ 不收卡,照常推更新',
    r.apns.length === 1 && r.apns[0].body.aps.event === 'update', `event=${r.apns[0] && r.apns[0].body.aps.event}`);
  ok('C5b 那一列還在', !!(await getRow(T('c2'))));
}
{
  // 🔴 本卡特有的精度紅線:誤點【未知】時不可以拿「表訂+180 秒」收卡。
  //    我們從來沒告訴使用者車幾點到,憑什麼說它到了?這種列只能靠 end_at 收。
  await resetTable();
  const sched = mockNowSec - 600;
  srcLive = feed([{ no: '777', delay: 0 }]);      // 看板是新的,但沒有我們追的 123
  await insRow({ token: T('c3'), train_no: '123', sched_sec: sched, end_at: mockNowSec + 3600 });
  const r = await tick();
  ok('C6(精度)誤點未知 ⇒ 表訂早就過了也不准當成「已到站」收卡',
    r.apns.length === 1 && r.apns[0].body.aps.event === 'update', `event=${r.apns[0] && r.apns[0].body.aps.event}`);
  ok('C6b 那一列還在(它只能靠 end_at 收,不會變成殭屍)', !!(await getRow(T('c3'))));
}
{
  // end_at 到點:硬上限,與誤點無關。
  await resetTable();
  const sched = mockNowSec + 1200;
  srcLive = feed([{ no: '123', delay: 3 }]);
  await insRow({ token: T('c4'), train_no: '123', sched_sec: sched, end_at: mockNowSec });
  const r = await tick();
  ok('C7 end_at 到點 ⇒ 推 end(即使車還沒到)', r.apns.length === 1 && r.apns[0].body.aps.event === 'end');
  ok('C7b 收卡後刪列', (await getRow(T('c4'))) === null);
}
{
  // end 推播失敗仍要刪列——不刪就會每分鐘重試一次 end,永遠刪不掉。
  await resetTable();
  const sched = mockNowSec + 1200;
  srcLive = feed([{ no: '123', delay: 3 }]);
  await insRow({ token: T('c5'), train_no: '123', sched_sec: sched, end_at: mockNowSec });
  apnsNextStatus = 400; apnsNextReason = 'BadCollapseId';
  const r = await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  ok('C8 end 推播非 2xx 仍然刪列', (await getRow(T('c5'))) === null);
  ok('C8b end 失敗有留下可診斷的 log', r.errLines.some(l => l.includes('收卡 end 推播非 2xx')),
    JSON.stringify(r.errLines));
  ok('C8c log 前綴分得出是哪一條迴圈(tw-push 不是 mw-push)',
    r.errLines.some(l => l.includes('[cron tw-push]')), JSON.stringify(r.errLines));
}

// ══════════════════════════════════════════════════════════════════
// D 缺訊:什麼時候 hold、什麼時候老實說沒有資訊
// ══════════════════════════════════════════════════════════════════
{
  // 看板是新的,只是這一刻沒有這班車的事件(南迴那種站間長跑)⇒ hold,不改內容。
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  const prevState = { delayMin: 3, dataAt: mockNowSec - 120, notice: null, pushed: true };
  srcLive = feed([{ no: '777', delay: 0 }]);
  await insRow({ token: T('d1'), train_no: '123', sched_sec: sched, end_at: sched + 1800, last_state: prevState });
  const r = await tick();
  ok('D1 看板新鮮但查無此車、且上次有值 ⇒ hold(不推,主角時刻不會來回跳)',
    r.apns.length === 0, `apns=${r.apns.length}`);
  ok('D1b hold 不刪列', !!(await getRow(T('d1'))));
  ok('D1c hold 期間 last_state 原封不動',
    JSON.stringify(JSON.parse((await getRow(T('d1'))).last_state)) === JSON.stringify(prevState));
  // 🔴 反向對照:同一列、同樣查不到,但資料【過舊】⇒ 必須翻成「沒有資訊」而不是繼續 hold。
  //    兩條除了「看板時刻」之外每一格輸入都一樣(心得 39(b)):否則「乾脆一律 hold」也會全綠。
  srcLive = feed([{ no: '777', delay: 0 }], mockNowSec - 1801);
  const r2 = await tick();
  ok('D2(反向對照)同一列同樣查不到,但整份資料過舊 ⇒ 翻成「沒有資訊」,不再沿用舊誤點',
    r2.apns.length === 1 && r2.apns[0].body.aps['content-state'].delayMin === null,
    `apns=${r2.apns.length} cs=${JSON.stringify(r2.apns[0] && r2.apns[0].body.aps['content-state'])}`);
}
{
  // tra-live 整個拿不到(快取沒有、fetch 拋)⇒ 不推、不刪列,且留下可診斷的 log。
  await resetTable();
  const sched = SCHED();
  srcLive = null;
  await insRow({ token: T('d3'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
    last_state: { delayMin: 3, dataAt: mockNowSec - 120, notice: null, pushed: true } });
  const r = await tick();
  ok('D3 tra-live 整個不可用 ⇒ 不刪列', !!(await getRow(T('d3'))));
  ok('D3b 有留下可診斷的 log', r.errLines.some(l => l.includes('tra-live 不可用') || l.includes('tra-live 取得失敗')),
    JSON.stringify(r.errLines));
  srcLive = feed([{ no: '123', delay: 3 }]);
}

// ══════════════════════════════════════════════════════════════════
// E end_at 隨誤點延長(這張卡與捷運卡最大的行為差異)
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const bound = mockNowSec;
  const sched = mockNowSec + 1200;
  // 綁的時候是準點 ⇒ end_at = 表訂 + 30 分。現在官方說誤點 40 分。
  srcLive = feed([{ no: '123', delay: 40 }]);
  await insRow({ token: T('e1'), train_no: '123', sched_sec: sched, end_at: sched + 1800, bound_at: bound });
  await tick();
  const row = await getRow(T('e1'));
  // 期望值用字面算術獨立算:實際到站 = sched + 40*60,再 + 1800。
  ok('E1 誤點把實際到站推遠 ⇒ end_at 跟著延到「實際到站 + 30 分」',
    Number(row.end_at) === sched + 40 * 60 + 1800, `end_at=${row.end_at} expect=${sched + 40 * 60 + 1800}`);
  ok('E1b expire_at 跟著往後(不然 cron 的兜底清理會先把列刪掉)',
    Number(row.expire_at) === Number(row.end_at) + 300, `expire_at=${row.expire_at}`);
  // 誤點縮回來:end_at 只准往後,不准縮(縮會在使用者還在等車時提前收卡)。
  srcLive = feed([{ no: '123', delay: 5 }]);
  await tick();
  const row2 = await getRow(T('e1'));
  ok('E2 誤點縮回 5 分 ⇒ end_at 不縮短', Number(row2.end_at) === Number(row.end_at),
    `${row2.end_at} vs ${row.end_at}`);
}
{
  // 封頂:bound_at + 3.5 小時(12600 秒,期望值寫死不引用常數)。
  await resetTable();
  const bound = mockNowSec;
  const sched = mockNowSec + 1200;
  srcLive = feed([{ no: '123', delay: 300 }]);   // 誤點 5 小時
  await insRow({ token: T('e2'), train_no: '123', sched_sec: sched, end_at: sched + 1800, bound_at: bound });
  await tick();
  const row = await getRow(T('e2'));
  ok('E3 延長封頂在 bound_at + 3.5 小時(灌假誤點也養不出永生的列)',
    Number(row.end_at) === bound + 12600, `end_at=${row.end_at} expect=${bound + 12600}`);
}
{
  // 🔴 延長與推播是兩件獨立的事:內容一模一樣(不推)時,end_at 照樣要延。
  //    少了這一條,「把延長塞進推播成功那一支」會全綠通過,而那正是會在誤點穩定不變時
  //    讓 end_at 永遠停在原地、把還沒到的車收掉的寫法。
  await resetTable();
  const bound = mockNowSec;
  const sched = mockNowSec + 1200;
  srcLive = feed([{ no: '123', delay: 40 }], mockNowSec - 60);
  await insRow({ token: T('e3'), train_no: '123', sched_sec: sched, end_at: sched + 1800, bound_at: bound,
    last_state: { delayMin: 40, dataAt: mockNowSec - 60, notice: null, pushed: true } });
  const r = await tick();
  const row = await getRow(T('e3'));
  ok('E4 內容沒變(不推)時 end_at 照樣延長', r.apns.length === 0
    && Number(row.end_at) === sched + 40 * 60 + 1800, `apns=${r.apns.length} end_at=${row.end_at}`);
}

// ══════════════════════════════════════════════════════════════════
// F APNs 失敗處理
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  srcLive = feed([{ no: '123', delay: 3 }]);
  await insRow({ token: T('f1'), train_no: '123', sched_sec: sched, end_at: sched + 1800, apns_env: 'prod' });
  apnsNextStatus = 410; apnsNextReason = 'Unregistered';
  await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  ok('F1 永久失敗(Unregistered:卡片已被使用者收掉)⇒ 刪列', (await getRow(T('f1'))) === null);

  await resetTable();
  await insRow({ token: T('f2'), train_no: '123', sched_sec: sched, end_at: sched + 1800, apns_env: 'prod' });
  apnsNextStatus = 400; apnsNextReason = 'BadTopic';
  const r = await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  ok('F2 我方設定錯(BadTopic)不是 token 死了 ⇒ 不刪列', !!(await getRow(T('f2'))));
  ok('F2b fail_streak 累加(連續失敗到上限才可能被熔斷放行刪除)',
    Number((await getRow(T('f2'))).fail_streak) === 1, String((await getRow(T('f2'))).fail_streak));
  ok('F2c 有留下可診斷的 log', r.errLines.some(l => l.includes('APNs 非 2xx')), JSON.stringify(r.errLines));
}

// ══════════════════════════════════════════════════════════════════
// H bind / unbind 端點
// ══════════════════════════════════════════════════════════════════
const post = (fn, body) => fn(new Request(`${BASE}/api/tra-wait/bind`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env);
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = mockNowSec + 1200;
  const good = { token: T('h1'), station: '臺北', trainNo: '123', schedSec: sched, endAt: sched + 1800 };
  const res = await post(traWaitBind, good);
  ok('H1 合法 bind 回 200', res.status === 200, String(res.status));
  const row = await getRow(T('h1'));
  ok('H1b 欄位逐一落地', row && row.station === '臺北' && row.train_no === '123'
    && Number(row.sched_sec) === sched && Number(row.end_at) === sched + 1800
    && Number(row.bound_at) === mockNowSec && Number(row.expire_at) === sched + 1800 + 300,
    JSON.stringify(row));
  ok('H1c last_state 起始為 NULL(第一輪必推)', row && row.last_state === null);
  ok('H1d 舊版 App 不送 prevDepSec ⇒ prev_dep_sec=NULL(照舊只在誤點變了才推)', row && row.prev_dep_sec === null, String(row && row.prev_dep_sec));
  const withPrev = { ...good, token: T('h1p'), prevDepSec: sched - 480 };
  const resP = await post(traWaitBind, withPrev);
  const rowP = await getRow(T('h1p'));
  ok('H6 送了上一站表定發車 ⇒ 200 且原值落地', resP.status === 200 && rowP && Number(rowP.prev_dep_sec) === sched - 480,
    `${resP.status} ${JSON.stringify(rowP)}`);
  // 🔴 站間跑將近六小時的班次是真的(2026-09-20 的 6022 次臺南 11:48 開→南港 17:40 到):
  //    若把下限綁在 3.5 小時的追蹤上限,這張卡會整包 400、連誤點都收不到。
  const longRun = await post(traWaitBind, { ...good, token: T('h1l'), prevDepSec: sched - (5 * 3600 + 52 * 60) });
  ok('H6b 站間將近六小時(6022 次臺南→南港)也收', longRun.status === 200, String(longRun.status));

  const bad = async (patch, why) => {
    const r = await post(traWaitBind, { ...good, ...patch });
    return { status: r.status, err: (await r.json()).error, why };
  };
  const cases = [
    await bad({ token: 'nothex' }, 'bad_token'),
    await bad({ station: '' }, 'bad_station'),
    await bad({ station: '一'.repeat(25) }, 'bad_station'),
    await bad({ trainNo: '' }, 'bad_train'),
    await bad({ trainNo: '12-3' }, 'bad_train'),
    await bad({ trainNo: '123456789' }, 'bad_train'),
    await bad({ schedSec: mockNowSec - 3601 }, 'bad_sched'),
    await bad({ schedSec: mockNowSec + 12601 }, 'bad_sched'),
    await bad({ schedSec: 'x' }, 'bad_sched'),
    await bad({ endAt: mockNowSec - 1 }, 'bad_end'),
    await bad({ endAt: mockNowSec + 12661 }, 'bad_end'),
    await bad({ prevDepSec: 'x' }, 'bad_prev'),
    await bad({ prevDepSec: good.schedSec }, 'bad_prev'),
    await bad({ prevDepSec: good.schedSec - 86401 }, 'bad_prev'),
  ];
  const wrong = cases.filter(c => c.status !== 400 || c.err !== c.why);
  ok('H2 十四種不合法輸入各自回 400 與正確的 error 代碼', wrong.length === 0, JSON.stringify(wrong));
  // 🔴 分母閘門:上面那一批必須真的是「本來會成功、只差這一格」——否則 wrong.length===0
  //    也可能只是因為每一筆都因為別的理由被擋。good 本身回 200 已由 H1 證明。
  ok('H2b(分母閘門)不合法清單涵蓋全部六個欄位', new Set(cases.map(c => c.why)).size === 6,
    JSON.stringify([...new Set(cases.map(c => c.why))]));
}
{
  // 換綁另一班車:狀態欄要全部重設,apns_env 要留著。
  await resetTable();
  const sched = mockNowSec + 1200;
  await insRow({ token: T('h3'), train_no: '123', sched_sec: sched, prev_dep_sec: sched - 600, end_at: sched + 1800,
    last_state: { delayMin: 9, dataAt: mockNowSec, notice: null, pushed: true }, fail_streak: 3,
    apns_env: 'sandbox', bound_at: mockNowSec - 5000 });
  const sched2 = mockNowSec + 2400;
  await post(traWaitBind, { token: T('h3'), station: '板橋', trainNo: '456', schedSec: sched2, endAt: sched2 + 1800 });
  const row = await getRow(T('h3'));
  ok('H3 換綁另一班車 ⇒ last_state 與 fail_streak 歸零(不然新車第一輪可能不推)',
    row && row.last_state === null && Number(row.fail_streak) === 0, JSON.stringify(row));
  ok('H3b bound_at 重設(3.5 小時上限是「這張卡」的,不是「這顆 token」的)',
    Number(row.bound_at) === mockNowSec, String(row.bound_at));
  ok('H3c apns_env 保留(環境是這個 App 安裝的屬性,重設只會白付一次雙環境退路)',
    row.apns_env === 'sandbox', String(row.apns_env));
  ok('H3d 車次與表訂換成新的', row.train_no === '456' && Number(row.sched_sec) === sched2);
  // 🔴 換綁到一班沒送上一站的車(舊版 App／起點站)⇒ 舊車的上一站必須清掉,
  //    否則新車會拿舊車的時段每分鐘推。
  ok('H3e 換綁到沒有上一站的車 ⇒ prev_dep_sec 清成 NULL', row.prev_dep_sec === null, String(row.prev_dep_sec));
}
{
  await resetTable();
  const sched = mockNowSec + 1200;
  await insRow({ token: T('h4'), train_no: '123', sched_sec: sched, end_at: sched + 1800 });
  const r1 = await traWaitUnbind(new Request(`${BASE}/api/tra-wait/unbind`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: T('h4') }),
  }), env);
  ok('H4 unbind 回 200 且刪列', r1.status === 200 && (await getRow(T('h4'))) === null);
  const r2 = await traWaitUnbind(new Request(`${BASE}/api/tra-wait/unbind`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: T('h4') }),
  }), env);
  ok('H4b unbind 冪等(再送一次照樣 200)', r2.status === 200);
  const r3 = await traWaitBind(new Request(`${BASE}/api/tra-wait/bind`, { method: 'GET' }), env);
  ok('H5 GET 打 bind 回 405', r3.status === 405, String(r3.status));
}

// ══════════════════════════════════════════════════════════════════
// G 兜底清理:收卡推播整發失敗時,唯一能讓孤兒列消失的出路
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const sched = SCHED();
  srcLive = feed([{ no: '123', delay: 3 }]);
  // end_at 還在未來、但 expire_at 已過:只有兜底 DELETE 掃得掉它。
  await insRow({ token: T('g1'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
    expire_at: mockNowSec - 1 });
  const r = await tick();
  ok('G1 expire_at 已過的列被兜底清掉(收卡推播整發失敗時的唯一出路)', (await getRow(T('g1'))) === null);
  ok('G1b 而且不為它推任何一發(它已經不是一張活著的卡)', r.apns.length === 0, `apns=${r.apns.length}`);
  // 反向對照:expire_at 還沒到的列不可以被掃掉。
  await resetTable();
  await insRow({ token: T('g2'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
    expire_at: mockNowSec + 1 });
  await tick();
  ok('G1r(反向對照)expire_at 還沒到的列不可以被掃掉', !!(await getRow(T('g2'))));
}

// ══════════════════════════════════════════════════════════════════
// I 零成本:沒有卡的時候 cron 不該花任何東西
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  const r = await tick();
  ok('I1 一張卡都沒有 ⇒ 零上游、零 APNs(cron 每分鐘跑但不花任何成本)',
    r.matches.length === 0 && r.apns.length === 0, `matches=${r.matches.length} apns=${r.apns.length}`);
}

// ══════════════════════════════════════════════════════════════════
// J traLive 的 in-flight 去重:cron 的三條推播迴圈在同一分鐘【並行】起跑,兩條都要
//   /api/tra-live。邊緣快取 s-maxage=55、mem 也是 55 秒,而 cron 每分鐘一發 ⇒ 兩邊在
//   同一瞬間都會「剛好過期」。沒有去重就是每分鐘把同一份資料向 TDX 買兩次,而 TDX 是
//   點數制、105% 是硬斷線不是超額計費(memory: tdx-points-quota)。
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  srcLive = null;                       // 邊緣快取沒有這一筆 ⇒ 一定走上游
  let tdxHits = 0;
  const apnsFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes(APNS_FRAG)) return apnsFetch(url, init);
    if (u.includes('/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'fake', expires_in: 86400 }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('TrainLiveBoard')) {
      tdxHits++;
      await new Promise(r => setTimeout(r, 30));   // 讓兩發真的在時間上重疊
      return new Response(JSON.stringify({
        UpdateTime: new Date(mockNowSec * 1000).toISOString(),
        TrainLiveBoards: [{ TrainNo: '123', DelayTime: 3, StationID: '1000', TrainStationStatus: 2 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`[verify_tra_wait_push] J 組未預期的 fetch:${u}`);
  };
  const rq = () => new Request(`${BASE}/api/tra-live?_src=cron`);
  const [r1, r2] = await Promise.all([worker._la.traLive(rq(), env, fakeCtx), worker._la.traLive(rq(), env, fakeCtx)]);
  const j1 = await r1.json(), j2 = await r2.json();
  ok('J1 同一 tick 並行兩發 ⇒ 只向 TDX 買一次(點數制,105% 是硬斷線)', tdxHits === 1, `tdxHits=${tdxHits}`);
  ok('J1b 兩發都拿到同一份資料(去重不可以讓其中一發拿到空的或舊的)',
    j1.trains.length === 1 && j2.trains.length === 1 && j1.at === j2.at,
    `${JSON.stringify(j1.at)} / ${JSON.stringify(j2.at)}`);
  ok('J1c 去重也不寫用量埋點(_src=cron)', usageWrites === 0, `usageWrites=${usageWrites}`);
  globalThis.fetch = apnsFetch;
}

// ══════════════════════════════════════════════════════════════════
// R 等車卡 B:行駛段(上一站→本站)每分鐘推一發(2026-09-23 使用者裁示「先改伺服器每分鐘推播」)
//   卡片上的車只在收到推播時往前挪,所以【只有】車在上一站與本站之間那一段要每分鐘推;
//   車還沒從上一站開出來時它是靜止的,不准白推;到站之後由 stale-date 接手,也不推。
//   期望值一律從字面量排出來(第幾分鐘推、推幾發),不呼叫 tra_wait_core。
// ══════════════════════════════════════════════════════════════════
// 逐分鐘跑 cron,回傳每一輪的推播。資料時刻【釘死】在開卡前 40 秒:這樣 twShouldPush 的
// 遲滯(誤點變了／資料時刻漂 10 分鐘)一輪都不會觸發,任何一發推播都只可能來自行駛段。
async function runMinutes(token, from, n, feedFn) {
  const out = [];
  for (let k = 0; k < n; k++) {
    mockNowSec = from + k * 60;
    srcLive = feedFn(mockNowSec);
    const r = await tick();
    out.push({ t: mockNowSec, apns: r.apns, alive: !!(await getRow(token)) });
  }
  return out;
}
{
  // 表訂:開卡後 20 分到本站,上一站 7 分鐘前開(自強 172 板橋→臺北的形狀);官方誤點 1 分。
  // ⇒ 行駛段 = [開卡+14 分, 開卡+21 分),到站寬限 3 分 ⇒ 開卡+24 分收卡。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 1200, prevDep = sched - 420;
  const fixedAt = t0 - 40;
  const feedFn = () => feed([{ no: '172', delay: 1, sta: '1020', status: 2 }], fixedAt);
  await insRow({ token: T('r1'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 });
  const run = await runMinutes(T('r1'), t0, 26, feedFn);
  const pushedAt = run.filter(x => x.apns.some(a => a.body.aps.event === 'update')).map(x => (x.t - t0) / 60);
  // 期望(字面量):第 0 分鐘首發;第 14–20 分鐘行駛段每分鐘一發;其餘一發都沒有。
  const want = [0, 14, 15, 16, 17, 18, 19, 20];
  ok('R1 只有首發與行駛段(第 14–20 分鐘)有推,其餘分鐘零推播',
    JSON.stringify(pushedAt) === JSON.stringify(want), `實際推播分鐘=${JSON.stringify(pushedAt)}`);
  ok('R1b 車還沒從上一站開出來(第 1–13 分鐘)⇒ 13 輪全部不推',
    run.slice(1, 14).every(x => x.apns.length === 0), run.slice(1, 14).map(x => x.apns.length).join(''));
  const runPushes = run.slice(14, 21).map(x => x.apns[0]);
  ok('R2 行駛段每一輪恰好一發 event=update',
    run.slice(14, 21).every(x => x.apns.length === 1 && x.apns[0].body.aps.event === 'update'),
    run.slice(14, 21).map(x => x.apns.length).join(''));
  const bodies = runPushes.map(a => JSON.stringify(a && a.body.aps['content-state']));
  ok('R3 行駛段相鄰兩發的 content-state 都不一樣(內容相同時系統不保證重畫)',
    bodies.every((b, i) => i === 0 || b !== bodies[i - 1]), bodies.join(' | '));
  ok('R3b 每一發的 tick＝送出當下,誤點與資料時刻照舊(只換 tick,不造新值)',
    // 🔴 沒推的那一輪 a 是 undefined:要判紅,不可以拋例外把整支腳本(含後面的重放)中止掉。
    runPushes.every((a, i) => { const cs = a && a.body.aps['content-state'];
      return !!cs && cs.tick === t0 + (14 + i) * 60 && cs.delayMin === 1 && cs.dataAt === fixedAt && cs.pushed === true; }),
    bodies[0]);
  ok('R3c 行駛段每一發都帶 stale-date＝實際約到站(表訂＋1 分)',
    runPushes.every(a => a && a.body.aps['stale-date'] === sched + 60), String(runPushes.map(a => a && a.body.aps['stale-date'])));
  ok('R4 到站後(第 21–23 分鐘)不再每分鐘推(「車應已到」由 stale-date 翻)',
    run.slice(21, 24).every(x => x.apns.length === 0), run.slice(21, 24).map(x => x.apns.length).join(''));
  ok('R5 到站 + 3 分鐘(第 24 分鐘)照舊收卡:推 end、刪列',
    run[24].apns.length === 1 && run[24].apns[0].body.aps.event === 'end' && run[24].alive === false,
    `apns=${run[24].apns.map(a => a.body.aps.event)} alive=${run[24].alive}`);

  // 🔴 R6 反向對照:同一班車、同一份資料,只差「沒有上一站」(舊版 App)⇒ 行駛段一發都不推。
  //    少了這條,「每分鐘都推」也能讓 R1–R3 全綠。
  await resetTable();
  await insRow({ token: T('r6'), train_no: '172', sched_sec: sched, end_at: sched + 1800, bound_at: t0 });
  const ctl = await runMinutes(T('r6'), t0, 26, feedFn);
  const ctlAt = ctl.filter(x => x.apns.some(a => a.body.aps.event === 'update')).map(x => (x.t - t0) / 60);
  ok('R6(反向對照)沒有上一站 ⇒ 只有首發,行駛段零推播', JSON.stringify(ctlAt) === '[0]', `實際=${JSON.stringify(ctlAt)}`);
  ok('R6b(反向對照)收卡分鐘與有上一站的那張完全一樣(到站收卡不變)',
    ctl[24].apns.length === 1 && ctl[24].apns[0].body.aps.event === 'end' && ctl[23].alive === true);
}
{
  // 🔴 R7 精度紅線:官方誤點未知(這班車不在動態窗裡、從沒拿到過值)⇒ 沒有「車在哪」,
  //    表定時段內也一發都不推。照表定每分鐘推等於宣稱這班車準點。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 1200, prevDep = sched - 420;
  await insRow({ token: T('r7'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 });
  const run = await runMinutes(T('r7'), t0, 21, () => feed([{ no: '999', delay: 0 }], t0 - 40));
  const at = run.filter(x => x.apns.length).map(x => (x.t - t0) / 60);
  ok('R7 誤點未知 ⇒ 表定行駛段(第 13–19 分鐘)也不推', JSON.stringify(at) === '[0]', `實際=${JSON.stringify(at)}`);
  ok('R7b 首發老實寫「沒有資訊」(delayMin=null)', run[0].apns[0] && run[0].apns[0].body.aps['content-state'].delayMin === null);
}
{
  // 🔴 R8 hold × 行駛段:南迴那種站間長跑正是會整段掉出 TDX 動態窗的地方,也正是車最需要走的地方。
  //    看板新鮮但查無此車 ⇒ 內容 hold(誤點、資料時刻照舊),但仍每分鐘推一發只換 tick。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 1800, prevDep = sched - 3600;           // 上一站 1 小時前開,現在正跑在中間
  const prevState = { delayMin: 3, dataAt: t0 - 300, notice: null, pushed: true, tick: t0 - 60 };
  await insRow({ token: T('r8'), train_no: '165', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800,
    last_state: prevState, bound_at: t0 - 3600 });
  mockNowSec = t0;
  srcLive = feed([{ no: '777', delay: 0 }]);                  // 新鮮,但沒有 165
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('R8 hold 中的車在行駛段 ⇒ 仍推一發(車要往前走)', r.apns.length === 1 && r.apns[0].body.aps.event === 'update',
    `apns=${r.apns.length}`);
  ok('R8b 那一發的誤點與資料時刻照抄上一次送出去的(不翻成無資訊、不造新值),只換 tick',
    cs && cs.delayMin === 3 && cs.dataAt === t0 - 300 && cs.tick === t0 && cs.pushed === true && cs.notice === null,
    JSON.stringify(cs));
  ok('R8c 欄位集合仍是完整契約', cs && JSON.stringify(Object.keys(cs).sort()) === JSON.stringify(CONTRACT_SORTED),
    JSON.stringify(cs && Object.keys(cs).sort()));
  ok('R8d stale-date 用 hold 住的誤點(表訂＋3 分)', r.apns[0] && r.apns[0].body.aps['stale-date'] === sched + 180,
    String(r.apns[0] && r.apns[0].body.aps['stale-date']));
  const saved = JSON.parse((await getRow(T('r8'))).last_state);
  ok('R8e last_state 只有 tick 變了', JSON.stringify({ ...saved, tick: null }) === JSON.stringify({ ...prevState, tick: null })
    && saved.tick === t0, JSON.stringify(saved));
  // 同一分鐘 cron 重跑(排程觸發是至少一次)⇒ 不重推。
  mockNowSec = t0 + 15;
  const r2 = await tick();
  ok('R9 同一分鐘重跑(15 秒後)⇒ 不重推同一格', r2.apns.length === 0, `apns=${r2.apns.length}`);
}

// ══════════════════════════════════════════════════════════════════
// S 半分鐘那一輪(2026-09-23 使用者裁示「那就改30秒吧」)
//   行駛段的車從每分鐘挪一格改成每 30 秒挪一格:cron 仍每分鐘一次,同一次執行內 +30 秒再跑一輪
//   只挪車的。期望值一律寫字面量,不引用 TW_RUN_PUSH_GAP_SEC 或 WAIT_HALF_TICK_MS(心得 29)。
// ══════════════════════════════════════════════════════════════════
ok('S0(出貨路徑)cron 用的是帶半分鐘那一輪的版本,而且沒有留下舊的直接呼叫',
  /traWaitPushWithHalf\(env, ctx, 'https:\/\/railisland\.tw'\)/.test(workerSrc)
  && !/traWaitPushAll\(env, ctx, 'https:\/\/railisland\.tw'\)/.test(workerSrc));
{
  // 與 R1 同一個形狀:開卡後 20 分到本站,上一站 7 分鐘前開,官方誤點 1 分
  // ⇒ 行駛段 = [開卡+14 分, 開卡+21 分),到站寬限 3 分 ⇒ 開卡+24 分收卡。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 1200, prevDep = sched - 420;
  const fixedAt = t0 - 40;
  await insRow({ token: T('s1'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 });
  const runs = [];
  for (let k = 0; k < 26; k++) {
    mockNowSec = t0 + k * 60;
    srcLive = feed([{ no: '172', delay: 1, sta: '1020', status: 2 }], fixedAt);
    const r = await tickHalf();
    runs.push({ ...r, t: t0 + k * 60, alive: !!(await getRow(T('s1'))) });
  }
  const upd = runs.flatMap(r => r.apns.filter(a => a.body.aps.event === 'update').map(a => a.at - t0));
  // 期望(字面量):第 0 秒首發;行駛段 840–1230 秒每 30 秒一發(14 發);其餘零推播。
  const want = [0];
  for (let x = 840; x <= 1230; x += 30) want.push(x);
  ok('S1 行駛段每 30 秒一發(第 840、870 … 1230 秒共 14 發),其餘時段只有首發',
    JSON.stringify(upd) === JSON.stringify(want), `實際=${JSON.stringify(upd)}`);
  const halfs = runs.flatMap(r => r.apns.filter(a => (a.at - t0) % 60 === 30));
  const mins = runs.flatMap(r => r.apns.filter(a => (a.at - t0) % 60 === 0 && a.at - t0 >= 840));
  const strip = cs => JSON.stringify({ ...cs, tick: null });
  ok('S2 半分鐘那一發的誤點、資料時刻與同一分鐘第一發逐字相同,只換 tick(不造新值)',
    halfs.length === 7 && halfs.every((a, i) => strip(a.body.aps['content-state']) === strip(mins[i].body.aps['content-state'])
      && a.body.aps['content-state'].tick === a.at),
    JSON.stringify(halfs.map(a => a.body.aps['content-state'])));
  ok('S2b 半分鐘那一發也帶 stale-date＝實際約到站(表訂＋1 分)',
    halfs.every(a => a.body.aps['stale-date'] === sched + 60), JSON.stringify(halfs.map(a => a.body.aps['stale-date'])));
  // 只看卡還在的那幾次執行(第 0–24 分鐘;第 24 分鐘那一輪收卡,之後表是空的,本來就什麼都不做)。
  const live = runs.slice(0, 25);
  ok('S3 第二輪零上游:一次都沒有再查 /api/tra-live(TDX 點數不准多花)',
    live.every(r => r.halfMatches === 0), JSON.stringify(live.map(r => r.halfMatches)));
  ok('S3b(正向對照)第一輪每一次都查了恰好一次 /api/tra-live',
    live.every(r => r.matches.filter(u => u.includes('/api/tra-live')).length === 1),
    JSON.stringify(live.map(r => r.matches.filter(u => u.includes('/api/tra-live')).length)));
  ok('S3c 每一次執行只睡一次、恰好 30 秒', runs.slice(0, 24).every(r => JSON.stringify(r.sleeps) === '[30000]'),
    JSON.stringify(runs.map(r => r.sleeps)));
  ok('S4 收卡分鐘不變(第 24 分鐘那一輪推 end、刪列),半分鐘那一輪從不收卡',
    runs[24].apns.length === 1 && runs[24].apns[0].body.aps.event === 'end' && runs[24].apns[0].at === t0 + 1440
      && runs[23].alive === true && runs[24].alive === false,
    JSON.stringify(runs.slice(22, 25).map(r => [r.apns.map(a => [a.at - t0, a.body.aps.event]), r.alive])));
}
{
  // 收卡條件在兩輪之間成立(到站 + 3 分落在第 10 秒)⇒ 第二輪不收,下一分鐘第一輪才收(與改版前相同)。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 - 230;                                     // 表訂＋誤點 1 分＋寬限 3 分 = t0 + 10
  const prevState = { delayMin: 1, dataAt: t0 - 40, notice: null, pushed: true, tick: t0 - 600 };
  await insRow({ token: T('s5'), train_no: '172', sched_sec: sched, prev_dep_sec: sched - 420, end_at: sched + 1800,
    last_state: prevState, bound_at: t0 - 1800 });
  mockNowSec = t0;
  srcLive = feed([{ no: '172', delay: 1, sta: '1020', status: 2 }], t0 - 40);
  const r1 = await tickHalf();
  ok('S5 收卡條件在第二輪之前成立 ⇒ 第二輪不推 end、不刪列',
    !r1.apns.some(a => a.body.aps.event === 'end') && !!(await getRow(T('s5'))),
    JSON.stringify(r1.apns.map(a => [a.at - t0, a.body.aps.event])));
  mockNowSec = t0 + 60;
  srcLive = feed([{ no: '172', delay: 1, sta: '1020', status: 2 }], t0 + 20);
  const r2 = await tickHalf();
  ok('S5b 下一分鐘第一輪照舊收卡', r2.apns.length === 1 && r2.apns[0].body.aps.event === 'end' && !(await getRow(T('s5'))),
    JSON.stringify(r2.apns.map(a => [a.at - t0, a.body.aps.event])));
}
{
  // 第二輪的 APNs 失敗不記失敗次數(否則熔斷的「連續失敗輪數」以兩倍速到頂)。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 300, prevDep = sched - 420;              // 已在行駛段
  await insRow({ token: T('s6'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 - 600 });
  mockNowSec = t0;
  srcLive = feed([{ no: '172', delay: 0, sta: '1020', status: 2 }], t0 - 40);
  halfHook = async () => { apnsNextStatus = 410; apnsNextReason = 'Unregistered'; };
  const r = await tickHalf();
  halfHook = null; apnsNextStatus = 200; apnsNextReason = '';
  const row = await getRow(T('s6'));
  const saved = row && JSON.parse(row.last_state);
  ok('S6 第二輪真的推了(前提,不然下面兩條量不到東西)', r.apns.some(a => a.at === t0 + 30),
    JSON.stringify(r.apns.map(a => a.at - t0)));
  ok('S6b 第二輪的永久失敗不刪列、fail_streak 不加', !!row && Number(row.fail_streak) === 0,
    row ? `fail_streak=${row.fail_streak}` : '列被刪了');
  ok('S6c last_state 停在第一輪真的送出去的那一發(tick＝第一輪)', !!saved && saved.tick === t0, JSON.stringify(saved));
}
{
  // 兩輪之間才開的卡(last_state 為空)第二輪不碰;已經在走的那張照推(正向對照)。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 300, prevDep = sched - 420;
  await insRow({ token: T('s7a'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 - 600 });
  mockNowSec = t0;
  srcLive = feed([{ no: '172', delay: 0, sta: '1020', status: 2 }], t0 - 40);
  halfHook = async () => { await insRow({ token: T('s7b'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: mockNowSec }); };
  const r = await tickHalf();
  halfHook = null;
  ok('S7 兩輪之間才開的卡 ⇒ 第二輪不推它', !r.apns.some(a => a.token === T('s7b')),
    JSON.stringify(r.apns.map(a => [a.token.slice(0, 6), a.at - t0])));
  ok('S7b(正向對照)已經在走的那張第二輪照推', r.apns.some(a => a.token === T('s7a') && a.at === t0 + 30));
}
{
  // 排程「至少一次」:同一分鐘第二次執行晚 15 秒起跑、兩次執行交錯 ⇒ 同一格不推兩次。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 300, prevDep = sched - 420;
  await insRow({ token: T('s8'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 - 600 });
  srcLive = feed([{ no: '172', delay: 0, sta: '1020', status: 2 }], t0 - 40);
  const seq = [];
  const run = async (sec, half) => { mockNowSec = sec; apnsCalls = [];
    const cap = await captureConsole(() => traWaitPushAll(env, fakeCtx, BASE, half)); seq.push([sec - t0, apnsCalls.length]); return cap.result; };
  const a1 = await run(t0, null);
  const b1 = await run(t0 + 15, null);
  await run(t0 + 30, { ...a1.handoff, deadlineMs: (t0 + 55) * 1000 });
  await run(t0 + 45, { ...b1.handoff, deadlineMs: (t0 + 70) * 1000 });
  ok('S8 重跑交錯(0/15/30/45 秒)⇒ 只有第 0 與第 30 秒推', JSON.stringify(seq) === '[[0,1],[15,0],[30,1],[45,0]]', JSON.stringify(seq));
  // cron 起跑時刻會抖:下一分鐘那一次早到 8 秒(第 52 秒起跑),離第二輪那一發只有 22 秒 ⇒ 仍要推得出去。
  mockNowSec = t0 + 52; apnsCalls = [];
  await captureConsole(() => traWaitPushAll(env, fakeCtx, BASE));
  ok('S8b 下一分鐘的 cron 早到 8 秒(離上一發 22 秒)⇒ 仍推得出去', apnsCalls.length === 1, `apns=${apnsCalls.length}`);
}
{
  // 第一輪跑超過 40 秒 ⇒ 本分鐘不跑第二輪。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 300, prevDep = sched - 420;
  await insRow({ token: T('s9'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800, bound_at: t0 - 600 });
  mockNowSec = t0;
  srcLive = feed([{ no: '172', delay: 0, sta: '1020', status: 2 }], t0 - 40);
  apnsAdvanceSec = 41;
  const r = await tickHalf();
  apnsAdvanceSec = 0;
  ok('S9 第一輪跑了 41 秒 ⇒ 不睡、不跑第二輪', r.sleeps.length === 0 && r.apns.length === 1,
    `sleeps=${JSON.stringify(r.sleeps)} apns=${r.apns.length}`);
  ok('S9b 並留下一行說明', r.errLines.some(l => l.includes('本分鐘不跑半分鐘那一輪')), JSON.stringify(r.errLines));
  await resetTable();
  mockNowSec = t0 + 120;
  const r3 = await tickHalf();
  ok('S9d 一張卡都沒有 ⇒ 不睡、零上游、零 APNs', r3.sleeps.length === 0 && r3.matches.length === 0 && r3.apns.length === 0,
    `sleeps=${r3.sleeps.length} matches=${r3.matches.length} apns=${r3.apns.length}`);
}

{
  // 第二輪不因內容變化補推:第一輪那發(誤點 0→3)被 APNs 暫時拒收(500),第二輪時 APNs 已恢復——
  // 車不在行駛段 ⇒ 第二輪不補推,留給下一分鐘第一輪(失敗處理與遲滯都是每分鐘一次的事)。
  await resetTable();
  const t0 = 1_800_000_000;
  const sched = t0 + 3600, prevDep = sched - 420;             // 車還遠,不在行駛段
  const prevState = { delayMin: 0, dataAt: t0 - 300, notice: null, pushed: true, tick: t0 - 300 };
  await insRow({ token: T('s10'), train_no: '172', sched_sec: sched, prev_dep_sec: prevDep, end_at: sched + 1800,
    last_state: prevState, bound_at: t0 - 600 });
  mockNowSec = t0;
  srcLive = feed([{ no: '172', delay: 3, sta: '1020', status: 2 }], t0 - 40);
  apnsNextStatus = 500; apnsNextReason = 'InternalServerError';
  halfHook = async () => { apnsNextStatus = 200; apnsNextReason = ''; };
  const r = await tickHalf();
  halfHook = null; apnsNextStatus = 200; apnsNextReason = '';
  ok('S10 第一輪真的推了誤點變化而且失敗(前提)', r.apns.filter(a => a.at === t0).length >= 1,
    JSON.stringify(r.apns.map(a => a.at - t0)));
  ok('S10b 車不在行駛段 ⇒ 第二輪不補推內容變化(留給下一分鐘)', !r.apns.some(a => a.at === t0 + 30),
    JSON.stringify(r.apns.map(a => a.at - t0)));
}

// ══════════════════════════════════════════════════════════════════
// RP 真實資料重放:TDX 台鐵即時動態原始紀錄(本機 .cache/tra_hist/2026-09-13.jsonl.gz,
//   TrainLiveBoard 每分鐘輪詢、只記有變的列)＋ data/tra_schedule.json 同星期幾(2026-09-20)的表定。
//   每筆 = [UpdateTime, SrcUpdateTime, DelayTime],台北時間,原值照抄、只取開卡之後那段。
//   逐分鐘把「當下看板上這班車的最新一筆」餵給 cron(SrcUpdateTime 超過 30 分鐘就當作掉出動態窗),
//   同一班車跑兩次:有上一站(新版 App)vs 沒有上一站(＝改版前的行為,當控制組)。
//   cron 跑的是正式那一條(第一輪＋同一次執行內 +30 秒那一輪,tickHalf)。
// ══════════════════════════════════════════════════════════════════
const RP_DAY = '2026-09-13';
const hms = x => Math.round(Date.parse(`${RP_DAY}T${x}+08:00`) / 1000);
const hm = sec => new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
  .format(new Date(sec * 1000));
const hms2 = sec => new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  .format(new Date(sec * 1000));
// 期望的推播時刻用字串列舉(與受測碼的算術無關)。
// 半分鐘清單:a:00 起每 30 秒一個,到 b:30 為止(行駛段推播的送出時刻)。
const halfList = (a, b) => { const out = []; for (let t = hms(a + ':00'); t <= hms(b + ':30'); t += 30) out.push(hms2(t)); return out; };
const RP_172 = [
    ['15:01:02','15:00:34',0],['15:04:02','15:03:18',0],['15:05:02','15:04:06',0],['15:06:02','15:05:24',0],
    ['15:09:02','15:08:30',0],['15:10:02','15:09:02',0],['15:11:02','15:10:51',0],['15:12:02','15:11:29',0],
    ['15:15:02','15:14:22',0],['15:16:02','15:15:56',0],['15:18:02','15:17:30',0],['15:19:02','15:18:10',0],
    ['15:26:02','15:25:58',0],['15:27:02','15:26:30',1],['15:29:02','15:28:45',1],['15:30:02','15:29:21',0],
    ['15:32:02','15:31:47',1],['15:33:02','15:32:07',0],['15:36:02','15:35:33',0],['15:37:02','15:35:59',0],
    ['15:38:02','15:37:07',0],['15:39:02','15:38:29',0],['15:40:02','15:38:59',0],['15:42:02','15:41:57',0],
    ['15:43:02','15:42:17',0],['15:45:02','15:44:45',0],['15:46:02','15:44:59',0],['15:48:02','15:47:39',0],
    ['15:50:02','15:49:53',0],['15:54:02','15:53:43',0],['15:55:02','15:54:01',0],['15:56:02','15:55:39',0],
];
const RP_165 = [
    ['17:50:02','17:49:26',1],['17:52:02','17:51:54',1],['17:55:02','17:54:37',1],['17:56:02','17:55:11',1],
    ['17:57:02','17:56:47',1],['17:58:02','17:57:53',1],['18:01:02','18:00:58',0],['18:06:02','18:05:28',0],
    ['18:10:02','18:09:45',0],['18:12:02','18:11:21',0],['18:13:02','18:12:43',1],['18:17:02','18:16:56',0],
    ['18:22:02','18:21:38',0],['18:23:02','18:22:41',2],['18:25:02','18:24:48',2],['18:31:02','18:30:42',2],
    ['18:32:02','18:31:28',2],['18:35:02','18:34:46',2],['18:36:02','18:35:50',2],['18:38:02','18:37:44',2],
    ['18:43:02','18:42:28',1],['18:44:02','18:43:16',0],['18:47:02','18:46:42',0],['18:52:02','18:51:50',0],
    ['18:57:02','18:56:45',0],['18:58:02','18:57:03',0],['19:00:32','18:59:10',0],['19:13:02','19:12:48',0],
    ['19:15:02','19:14:17',0],['19:16:02','19:15:52',0],['19:17:02','19:16:24',0],['19:25:02','19:24:54',0],
    ['19:26:02','19:25:12',0],['19:31:02','19:30:21',0],['19:37:02','19:36:54',0],['19:38:02','19:37:14',0],
    ['19:44:02','19:43:48',0],['19:45:02','19:44:04',0],
];
function rpFeed(recs, trainNo, t) {
  let cur = null;
  for (const r of recs) if (hms(r[0]) <= t) cur = r;
  const trains = cur && t - hms(cur[1]) <= 1800 ? [{ no: trainNo, delay: cur[2], sta: '0000', status: 2 }] : [];
  return feed(trains, t - 58);   // 看板在每分鐘 :02 輪詢 ⇒ cron(:00)拿到的是 58 秒前那一份
}
// D1 計量:整個換掉 env.DELAY_DB(本機 binding 是 Proxy,覆寫它的 prepare 屬性不會生效——
// 第一版就是這樣量出「0 條語句」)。只在 cron 那一輪量(resetTable/getRow 不算)。
// 每條語句記 { 動詞, rows_read, rows_written }:後兩者取 D1 回傳的 meta(D1 就是照這兩個數計費)。
const realDB = env.DELAY_DB;
let d1Stmts = null;
const wrapStmt = (st, verb) => new Proxy(st, { get(t, k) {
  const v = t[k];
  if (k === 'bind') return (...a) => wrapStmt(v.apply(t, a), verb);
  if (k === 'run' || k === 'all' || k === 'first') return async (...a) => {
    const r = await v.apply(t, a);
    if (d1Stmts) d1Stmts.push({ verb, read: Number(r && r.meta && r.meta.rows_read), written: Number(r && r.meta && r.meta.rows_written) });
    return r;
  };
  return typeof v === 'function' ? v.bind(t) : v;
} });
env.DELAY_DB = new Proxy(realDB, { get(t, k) {
  if (k === 'prepare') return sql => wrapStmt(t.prepare(sql), String(sql).trim().split(/\s+/)[0].toUpperCase());
  const v = t[k];
  return typeof v === 'function' ? v.bind(t) : v;
} });
// 開卡直接寫列(bind 端點有每分鐘 20 次的真限流,重放一跑就撞;端點本身由 H1/H6 驗過)。
// 欄位值照 bind 會寫的:end_at＝表訂＋30 分、bound_at＝開卡時刻。
async function replay({ trainNo, station, bindAt, sched, prevDep, recs, withPrev }) {
  await resetTable();
  mockNowSec = hms(bindAt);
  const token = T(`rp${trainNo}${withPrev ? 'p' : 'c'}`);
  await insRow({ token, station, train_no: trainNo, sched_sec: hms(sched), end_at: hms(sched) + 1800,
    prev_dep_sec: withPrev ? hms(prevDep) : null, bound_at: hms(bindAt) });
  const log = [];
  for (let t = hms(bindAt); t < hms(bindAt) + 4 * 3600; t += 60) {
    mockNowSec = t;
    srcLive = rpFeed(recs, trainNo, t);
    d1Stmts = [];
    const r = await tickHalf();
    const stmts = d1Stmts; d1Stmts = null;
    log.push({ hm: hm(t), events: r.apns.map(a => a.body.aps.event), cs: r.apns.map(a => a.body.aps['content-state']),
      pushes: r.apns.map(a => ({ at: hms2(a.at), event: a.body.aps.event })),
      live: r.matches.filter(u => u.includes('/api/tra-live')).length,
      stmts: stmts.length,
      read: stmts.reduce((acc, x) => acc + (Number.isFinite(x.read) ? x.read : NaN), 0),
      written: stmts.reduce((acc, x) => acc + (Number.isFinite(x.written) ? x.written : NaN), 0) });
    if (!(await getRow(token))) break;
  }
  return log;
}
const upd = log => log.flatMap(x => x.pushes.filter(p => p.event === 'update').map(p => p.at));
const RP_REPORT = [];
for (const c of [
  // 自強 172 在臺北等:時刻表上一站是板橋(15:38 開),臺北 15:46 到;15:10 開卡(車還在中壢一帶)。
  { name: '自強172@臺北(上一站板橋)', trainNo: '172', station: '臺北', bindAt: '15:10:00', prevDep: '15:38:00', sched: '15:46:00',
    recs: RP_172, wantRun: halfList('15:38', '15:45'), wantEnd: '15:49' },
  // 自強 165 在臺東等:上一站潮州 18:22 開,臺東 19:53 到——站間跑 1 小時 31 分(南迴),誤點 2→1→0。
  // 18:22、18:23 兩輪看板上還是誤點 0(潮州那筆 18:23:02 才進來)⇒ 窗口從表定 18:22 起算。
  { name: '自強165@臺東(上一站潮州,南迴 91 分)', trainNo: '165', station: '臺東', bindAt: '18:00:00', prevDep: '18:22:00', sched: '19:53:00',
    recs: RP_165, wantRun: halfList('18:22', '19:52'), wantEnd: '19:56' },
]) {
  const exp = await replay({ ...c, withPrev: true });
  const ctl = await replay({ ...c, withPrev: false });
  const tag = c.trainNo;
  const runSet = new Set(c.wantRun);
  const expUpd = upd(exp), ctlUpd = upd(ctl);
  ok(`RP${tag}a 行駛段每 30 秒都推(${c.wantRun[0]}–${c.wantRun[c.wantRun.length - 1]} 共 ${c.wantRun.length} 發)`,
    c.wantRun.every(m => expUpd.includes(m)), `缺:${JSON.stringify(c.wantRun.filter(m => !expUpd.includes(m)))}`);
  const preExp = expUpd.filter(m => m < c.wantRun[0]), preCtl = ctlUpd.filter(m => m < c.wantRun[0]);
  ok(`RP${tag}b 還沒到上一站那段:推播分鐘與改版前逐一相同(不多推一發)`,
    JSON.stringify(preExp) === JSON.stringify(preCtl), `新=${JSON.stringify(preExp)} 舊=${JSON.stringify(preCtl)}`);
  const postExp = expUpd.filter(m => m > c.wantRun[c.wantRun.length - 1]);
  ok(`RP${tag}c 到站之後到收卡前零推播`, postExp.length === 0, JSON.stringify(postExp));
  const endExp = exp.find(x => x.events.includes('end')), endCtl = ctl.find(x => x.events.includes('end'));
  ok(`RP${tag}d 收卡分鐘不變(${c.wantEnd}),新舊都收在同一分鐘`,
    endExp && endCtl && endExp.hm === c.wantEnd && endCtl.hm === c.wantEnd, `新=${endExp && endExp.hm} 舊=${endCtl && endCtl.hm}`);
  const runCs = exp.flatMap(x => x.pushes.map((p, i) => ({ p, cs: x.cs[i] }))).filter(o => runSet.has(o.p.at)).map(o => JSON.stringify(o.cs));
  ok(`RP${tag}e 行駛段相鄰兩發內容都不同`, runCs.every((b, i) => i === 0 || b !== runCs[i - 1]));
  ok(`RP${tag}f 上游呼叫與改版前一樣:每次執行(含半分鐘那一輪)恰好一次 /api/tra-live(零新增 TDX 點數)`,
    exp.every(x => x.live === 1) && ctl.every(x => x.live === 1), `新 ${exp.length} 輪/舊 ${ctl.length} 輪`);
  const sum = (log, k) => log.reduce((a, x) => a + x[k], 0);
  const hours = exp.length / 60;
  RP_REPORT.push({ 班次: c.name, 追蹤分鐘: exp.length,
    APNs_舊: ctl.reduce((a, x) => a + x.events.length, 0), APNs_新: exp.reduce((a, x) => a + x.events.length, 0),
    行駛段分鐘: c.wantRun.length,
    D1語句_舊: sum(ctl, 'stmts'), D1語句_新: sum(exp, 'stmts'),
    D1讀列_舊: sum(ctl, 'read'), D1讀列_新: sum(exp, 'read'), D1寫列_舊: sum(ctl, 'written'), D1寫列_新: sum(exp, 'written'),
    TDX經手_舊: sum(ctl, 'live'), TDX經手_新: sum(exp, 'live'),
    每小時APNs_舊: +(ctl.reduce((a, x) => a + x.events.length, 0) / hours).toFixed(1),
    每小時APNs_新: +(exp.reduce((a, x) => a + x.events.length, 0) / hours).toFixed(1) });
}
env.DELAY_DB = realDB;
// 🔴 計量本身要有分母閘門:包裝沒生效時所有數字都是 0,看起來像「零成本」。
ok('RPg(計量自檢)D1 包裝真的量到語句與列數(不是 0、不是 NaN)',
  RP_REPORT.every(r => r.D1語句_新 > 0 && Number.isFinite(r.D1讀列_新) && r.D1讀列_新 > 0 && Number.isFinite(r.D1寫列_新)),
  JSON.stringify(RP_REPORT.map(r => [r.D1語句_新, r.D1讀列_新, r.D1寫列_新])));
console.log('\n── 重放成本(同一班車、同一份資料,新＝有上一站／舊＝改版前) ──');
for (const r of RP_REPORT) console.log(JSON.stringify(r));
console.log('');

await resetTable();
await dispose();
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

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
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes(APNS_FRAG)) {
    const token = u.split(APNS_FRAG)[1];
    const host = u.includes('api.sandbox.push.apple.com') ? 'sandbox' : 'prod';
    apnsCalls.push({ token, host, body: JSON.parse(init.body), headers: init.headers });
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
const { traWaitPushAll, traWaitBind, traWaitUnbind } = worker._tw;
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
  const want = ['apns_env', 'bound_at', 'end_at', 'expire_at', 'fail_streak', 'last_state', 'sched_sec', 'station', 'token', 'train_no'].sort();
  if (!cols.length) abort('本機 D1 沒有 tra_wait_bindings 這張表——請照檔頭前置步驟 1 套 schema/0010_tra_wait.sql');
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
const CONTRACT_KEYS = ['delayMin', 'dataAt', 'notice', 'pushed'];
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
    'INSERT INTO tra_wait_bindings (token,station,train_no,sched_sec,end_at,last_state,fail_streak,apns_env,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(r.token, r.station || '臺北', r.train_no, r.sched_sec, r.end_at,
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
  ];
  const wrong = cases.filter(c => c.status !== 400 || c.err !== c.why);
  ok('H2 十一種不合法輸入各自回 400 與正確的 error 代碼', wrong.length === 0, JSON.stringify(wrong));
  // 🔴 分母閘門:上面那一批必須真的是「本來會成功、只差這一格」——否則 wrong.length===0
  //    也可能只是因為每一筆都因為別的理由被擋。good 本身回 200 已由 H1 證明。
  ok('H2b(分母閘門)不合法清單涵蓋全部五個欄位', new Set(cases.map(c => c.why)).size === 5,
    JSON.stringify([...new Set(cases.map(c => c.why))]));
}
{
  // 換綁另一班車:狀態欄要全部重設,apns_env 要留著。
  await resetTable();
  const sched = mockNowSec + 1200;
  await insRow({ token: T('h3'), train_no: '123', sched_sec: sched, end_at: sched + 1800,
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

await resetTable();
await dispose();
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

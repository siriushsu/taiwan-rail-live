// 捷運等車卡推播鏈(task-10)的驗收。受測物是 worker.js 的 metroWaitPushAll／metroWaitBind／
// metroWaitUnbind ——三者都吃 D1、APNs 與官方看板三個 IO,沒有純函式測試蓋得到。
//
// 手法沿用 verify_la_push_loop.mjs(同一組 IO、同一組限制):
//   getPlatformProxy() 在 Node 端取得真的 D1 binding,直接呼叫函式,不經 HTTP
//   ——workerd 的 fetch 拒絕自簽憑證,而 APNs 的 URL scheme 寫死 https,用 wrangler dev 打不通。
//
// 🔴 與 verify_la_push_loop 的一個關鍵差異:官方看板【不從 TDX/北捷上游】造假,而是攔在
//    `caches.default.match` 這一層回一份現成的 /api/trtc-live、/api/metro-live 回應。
//    理由:(a) 這支腳本的受測物是「等車卡迴圈怎麼挑班次」,不是「上游原始列怎麼變成 board」
//    ——後者是 trtcLive 自己的職責,有它自己的驗收;(b) 正式環境的 cron 絕大多數時候本來就是
//    邊緣快取命中,攔這一層跑到的是【更接近真實】的路徑;(c) 造假上游要複製 TrackInfo/CarWeight
//    的原始欄位形狀,那是把 trtcLive 的實作細節抄進判準,心得 29 明令禁止的同源。
//
// 判準獨立性(心得 29):期望值一律直接寫字面量或用獨立算術算出來,不呼叫 metro_wait_core 的
// 任何函式來產生「期望」——那會退化成「驗證這支函式跟自己一致」。
//
// ── 本機前置(缺任何一項這支腳本會 abort,不會假綠) ──────────────────────────
//   1) 本機 D1 套 schema(這一步不會自動發生,wrangler dev/getPlatformProxy 都不會建表):
//      arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --local \
//        --file=schema/0009_metro_wait.sql
//   2) .dev.vars 要有三顆 APNs 假 secret(值不會送到 Apple,但 APNS_KEY_P8 必須是真的
//      P-256 PKCS8,否則 crypto.subtle.importKey 會拋)。產生一把丟棄式的:
//      node -e "const{generateKeyPairSync}=require('crypto');const{privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});\
//        const pem=privateKey.export({type:'pkcs8',format:'pem'}).trim().replace(/\n/g,'\\\\n');\
//        console.log('APNS_KEY_P8=\"'+pem+'\"\nAPNS_KEY_ID=FAKELOCAL1\nAPNS_TEAM_ID=FAKELOCALTEAM')" >> .dev.vars
//   3) 跑:  node scripts/verify_metro_wait_push.mjs
//      (MW_WT=<其他 worktree 絕對路徑> 可覆寫受測目標;預設就是這支腳本所在的那棵樹)
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
const WT = process.env.MW_WT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerSrc = readFileSync(`${WT}/worker.js`, 'utf8');
console.log(`受測目標:${WT}/worker.js  md5=${createHash('md5').update(workerSrc).digest('hex')}`);
ok('G0(自檢)受測的 worker.js 真的含有 metroWaitPushAll(驗錯目標時這一條先紅)',
  /async function metroWaitPushAll\(/.test(workerSrc));

// ── 假時鐘與假網路(兩者在 Node 都是可覆寫的全域) ──────────────────────────
let mockNowSec = 1_800_000_000;
Date.now = () => mockNowSec * 1000;

const APNS_FRAG = '/3/device/';
let apnsCalls = [];              // [{token, host, body}]
let apnsNextStatus = 200, apnsNextReason = '';
let apnsTokenEnv = {};           // token → 'prod'|'sandbox';打錯環境回 400 BadDeviceToken(真實 APNs 行為)
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes(APNS_FRAG)) {
    const token = u.split(APNS_FRAG)[1];
    const host = u.includes('api.sandbox.push.apple.com') ? 'sandbox' : 'prod';
    apnsCalls.push({ token, host, body: JSON.parse(init.body), headers: init.headers });
    const want = apnsTokenEnv[token];
    if (want) {
      return host === want ? new Response('{}', { status: 200 })
                           : new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 });
    }
    return new Response(JSON.stringify({ reason: apnsNextReason }), { status: apnsNextStatus });
  }
  throw new Error(`[verify_metro_wait_push] 未預期的 fetch 目標(受測物打了不該打的地方,或測試設計漏配):${u}`);
};

// ── 官方看板的替身:攔在邊緣快取這一層(見檔頭說明) ────────────────────────
const jsonResp = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
let srcTrtc = null;              // /api/trtc-live 的回應物件
let srcLive = {};                // sys → /api/metro-live 的回應物件
let srcThrow = null;             // 設成 'trtc-live' 之類的片段:match 到就丟例外(模擬來源整個拿不到)
let cacheMatches = [];           // 這一輪查過哪些來源(用來斷言「沒有那個系統的列就不去拿它的看板」)
globalThis.caches = {
  default: {
    async match(req) {
      const u = String((req && req.url) || req);
      cacheMatches.push(u);
      if (srcThrow && u.includes(srcThrow)) throw new Error('[verify] 模擬來源失效');
      if (u.includes('/api/trtc-live')) return srcTrtc ? jsonResp(srcTrtc) : undefined;
      const m = u.match(/\/api\/metro-live\?sys=([a-z]+)/);
      if (m) return srcLive[m[1]] ? jsonResp(srcLive[m[1]]) : undefined;
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
if (!env.APNS_KEY_P8) abort('.dev.vars 沒有 APNS_KEY_P8 ⇒ metroWaitPushAll 會在第一行早退成 no-op,後面所有「沒推播」的斷言都會假綠。請照檔頭前置步驟 2 產生一把丟棄式金鑰。');
if ('APNS_HOST' in env) delete env.APNS_HOST;   // 讓「環境未知先試 production」這個假設不被本機設定牽動
const worker = await import(`${WT}/worker.js`);
if (!worker._mw || typeof worker._mw.metroWaitPushAll !== 'function') abort('worker.js 沒有導出 _mw.metroWaitPushAll');
const { metroWaitPushAll, metroWaitBind, metroWaitUnbind } = worker._mw;
const fakeCtx = { waitUntil(p) { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
const BASE = 'https://dummy.invalid';

// ══════════════════════════════════════════════════════════════════
// G1(第二道 gate):被測的 D1 到底有沒有這支腳本假設的欄位?少一欄的症狀是每列都拋進
// per-row catch ⇒ 一堆斷言以「沒推」的形式假綠。只比欄位名集合不比順序(存取全是具名的)。
// 期望值直接寫死在這裡,不從 schema 檔解析——那會變成「schema 跟自己一致」。
// ══════════════════════════════════════════════════════════════════
{
  let cols = [];
  try {
    const rs = await env.DELAY_DB.prepare('PRAGMA table_info(metro_wait_bindings)').all();
    cols = (rs.results || []).map(r => r.name).sort();
  } catch (e) { cols = []; }
  const want = ['apns_env', 'bound_at', 'dest', 'end_at', 'expire_at', 'fail_streak', 'last_state', 'station', 'sys', 'token'].sort();
  if (!cols.length) abort('本機 D1 沒有 metro_wait_bindings 這張表——請照檔頭前置步驟 1 套 schema/0009_metro_wait.sql');
  ok('G1(schema gate)metro_wait_bindings 的欄位集合正確', JSON.stringify(cols) === JSON.stringify(want),
    `實際=${JSON.stringify(cols)}`);
}

// ══════════════════════════════════════════════════════════════════
// G2-G4(跨行程契約):推播的 content-state 欄位集合必須逐字等於 Swift ContentState 的屬性名。
// 這條契約失效時【兩端都看不到】:裝置端 JSONDecoder 靜默失敗(整張卡不再更新),APNs 照回 200。
// 期望值獨立寫死一份(心得 29:三方任一漂移都要現形,而不是兩邊一起改壞)。
// 分母閘門:解不出屬性(檔案搬家、regex 失配)一律 FAIL,不可以因為解出空集合而假綠。
// ══════════════════════════════════════════════════════════════════
const SWIFT_PATH = `${WT}/app/ios/App/App/MetroWaitAttributes.swift`;
const swiftSrc = readFileSync(SWIFT_PATH, 'utf8');
let swiftProps = [];
{
  const m = swiftSrc.match(/struct\s+ContentState\s*:[^{]*\{([\s\S]*?)\n\s{4}\}/);
  if (m) swiftProps = [...m[1].matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(x => x[1]);
}
ok('G2 前置(分母閘門):解得出 MetroWaitAttributes.ContentState 的屬性(解不出＝這條契約檢查等於沒有)',
  swiftProps.length >= 8, `解到 ${swiftProps.length} 個:${JSON.stringify(swiftProps)}`);
const CONTRACT_KEYS = ['nextEta', 'nextMinutes', 'secondEta', 'secondMinutes', 'nextDest', 'secondDest',
  'crowd', 'dataAt', 'notice', 'pushed'];
const CONTRACT_SORTED = CONTRACT_KEYS.slice().sort();
ok('G3(跨行程契約)Swift ContentState 的屬性集合 === 後端 content-state 的契約欄位集合',
  JSON.stringify(swiftProps.slice().sort()) === JSON.stringify(CONTRACT_SORTED),
  `swift=${JSON.stringify(swiftProps.slice().sort())} expect=${JSON.stringify(CONTRACT_SORTED)}`);
{
  // 每一欄都必須是 Optional:非 Optional 的欄位會讓「App 更新前就開著的卡」整包解碼失敗
  // ——那不是那一欄變 nil,是整張卡不再更新(Swift 檔自己的註解就寫死了這條)。
  // 🔴 必須先剝掉行尾註解再判斷:這些宣告幾乎每一行都帶 `// 說明`,不剝的話「以 ? 結尾」
  //    對全部欄位都不成立 ⇒ 這條斷言會對【正確的】程式碼恆紅(第一次跑就是這樣紅的)。
  const nonOptional = [...swiftSrc.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n]+)$/gm)]
    .filter(x => swiftProps.includes(x[1]))
    .filter(x => !x[2].replace(/\/\/.*$/, '').trim().endsWith('?'))
    .map(x => x[1]);
  ok('G4(跨行程契約)ContentState 每一欄都是 Optional', nonOptional.length === 0,
    nonOptional.length ? `非 Optional:${JSON.stringify(nonOptional)}` : '全部 Optional');
}

// ── D1 小工具 ───────────────────────────────────────────────────────
// 🔴 token 必須是【合法的 64 碼小寫 hex】:bind 端點會驗格式(LA_TOKEN_RE),而 metroWaitPushAll
//    不驗(它讀的是 D1 已存在的列)。第一版用 `tag + 'a'.repeat(64)` 造 token,對迴圈那半邊沒事,
//    到了端點那半邊卻讓 'g'/'h' 開頭的 token 一律先被 bad_token 擋下 ⇒ G7–G14 八條全紅,
//    而且紅的理由是【測試資料不合法】不是產品有問題。改成把 tag 轉成 hex,任何 tag 都合法。
const T = tag => (Buffer.from(String(tag), 'utf8').toString('hex') + '0'.repeat(64)).slice(0, 64);
ok('G0b(自檢)測試用 token 通過 worker 的格式驗證(不合法的話端點那組會以 bad_token 的形式假紅)',
  /^(?:[0-9a-f]{2}){32,128}$/.test(T('g1')) && /^(?:[0-9a-f]{2}){32,128}$/.test(T('h1')), T('g1'));
async function resetTable() { await env.DELAY_DB.prepare('DELETE FROM metro_wait_bindings').run(); }
async function insRow(r) {
  await env.DELAY_DB.prepare(
    'INSERT INTO metro_wait_bindings (token,sys,station,dest,end_at,last_state,fail_streak,apns_env,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(r.token, r.sys, r.station, r.dest == null ? null : r.dest, r.end_at,
    r.last_state == null ? null : JSON.stringify(r.last_state), r.fail_streak || 0,
    r.apns_env == null ? null : r.apns_env, r.bound_at || mockNowSec, r.expire_at || (r.end_at + 300)).run();
}
async function getRow(token) {
  const rs = await env.DELAY_DB.prepare('SELECT * FROM metro_wait_bindings WHERE token=?').bind(token).all();
  return rs.results[0] || null;
}
async function tick() {
  apnsCalls = []; cacheMatches = [];
  const cap = await captureConsole(() => metroWaitPushAll(env, fakeCtx, BASE));
  return { ...cap, apns: apnsCalls.slice(), matches: cacheMatches.slice() };
}
// 北捷看板列的形狀就是 /api/trtc-live 的 board 元素:{name,dest,eta,at,no}
const bRow = (name, dest, etaOffset, atOffset = -5, no = '') =>
  ({ name, dest, eta: mockNowSec + etaOffset, at: mockNowSec + atOffset, no });
const liveRow = (s, d, e, st = 0, l = 'BL') => ({ l, s, d, e, st, op: 'KRTC' });

// ══════════════════════════════════════════════════════════════════
// Group A:北捷挑班次與 content-state 內容
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  // 站名故意用官方帶尾碼的「台北車站」,而綁定存的是靜態站名「台北」——去尾正規化要能接上
  srcTrtc = {
    at: new Date(mockNowSec * 1000).toISOString(), src: 'trtc',
    board: [
      bRow('台北車站', '淡水', 180, -8, 'A1'),
      bRow('台北車站', '象山', 420, -6, 'A2'),
      bRow('民權西路', '淡水', 60, -5, 'B1'),      // 別站,不可混進來
    ],
    trains: [{ no: 'A1', dest: '淡水', cars: [1, 2, 3, 4, 2, 1] }, { no: 'Z', dest: '象山', cars: [3, 3, 3, 3, 3, 3] }],
  };
  await insRow({ token: T('a1'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  const r = await tick();
  ok('A1 首發:有推一發,且 event=update', r.apns.length === 1 && r.apns[0].body.aps.event === 'update',
    `apns=${r.apns.length}`);
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('A2 content-state 的 key 集合 === 跨行程契約',
    !!cs && JSON.stringify(Object.keys(cs).sort()) === JSON.stringify(CONTRACT_SORTED),
    cs ? JSON.stringify(Object.keys(cs).sort()) : '(沒有 content-state)');
  ok('A3 首班取 eta 最小的那一列(絕對 epoch 秒),方向正確',
    cs && cs.nextEta === mockNowSec + 180 && cs.nextDest === '淡水', JSON.stringify([cs && cs.nextEta, cs && cs.nextDest]));
  ok('A4 次班取第二小', cs && cs.secondEta === mockNowSec + 420 && cs.secondDest === '象山',
    JSON.stringify([cs && cs.secondEta, cs && cs.secondDest]));
  ok('A5(精度誠實)北捷不送分鐘欄,恆 null', cs && cs.nextMinutes === null && cs.secondMinutes === null);
  ok('A6 stale-date === 首班到站瞬間(視圖靠它把倒數翻成「進站」,少送就會停在 0:00)',
    r.apns[0].body.aps['stale-date'] === mockNowSec + 180, String(r.apns[0].body.aps['stale-date']));
  ok('A7 dataAt 用【上游自己的資料時刻】(所選列 at 的最大值),不是我方的 now',
    cs && cs.dataAt === mockNowSec - 6, `dataAt=${cs && cs.dataAt} now=${mockNowSec}`);
  ok('A8 crowd 由 trains[].cars 依【官方車號】逐車 join(與看板/小工具同一套)',
    cs && JSON.stringify(cs.crowd) === JSON.stringify([1, 2, 3, 4, 2, 1]), JSON.stringify(cs && cs.crowd));
  ok('A9 別站的列沒有混進來(民權西路的 60 秒那班不可以變成首班)', cs && cs.nextEta !== mockNowSec + 60);
  ok('A10 推播成功後 last_state 存的是【真的送出去的那一包】',
    JSON.stringify(JSON.parse((await getRow(T('a1'))).last_state)) === JSON.stringify(cs));
  ok('A11 apns-topic 是 liveactivity(topic 打錯會整批 DeviceTokenNotForTopic)',
    r.apns[0].headers['apns-topic'] === 'tw.railisland.app.push-type.liveactivity', r.apns[0].headers['apns-topic']);
  ok('A12 apns-priority=5(5 不計入更新預算)', r.apns[0].headers['apns-priority'] === '5');
}
{
  // A8b 負對照:與 A8【除了 trains[].no 以外每一格輸入完全相同】——首班那列的車號是 A1,
  // 而唯一往淡水且有 cars 的車改成 ZZ。逐車 join ⇒ 必須留白;舊的同終點 join 會回 [1,2,3,4,2,1]。
  // 沒有這一條,A8 的「有值」無法區分兩種 join,整組判準對這次修的 bug 沒有牙。
  // (真實形狀:忠孝復興往南港展覽館有文湖線與板南線兩列,文湖線那列會拿到板南線那台的 6 格。)
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = {
    at: new Date(mockNowSec * 1000).toISOString(), src: 'trtc',
    board: [
      bRow('台北車站', '淡水', 180, -8, 'A1'),
      bRow('台北車站', '象山', 420, -6, 'A2'),
      bRow('民權西路', '淡水', 60, -5, 'B1'),
    ],
    trains: [{ no: 'ZZ', dest: '淡水', cars: [1, 2, 3, 4, 2, 1] }, { no: 'Z', dest: '象山', cars: [3, 3, 3, 3, 3, 3] }],
  };
  await insRow({ token: T('a8b'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('A8b 前提:這一發有推出去,而且首班仍是 A1 那列(否則下面那條是零資訊)',
    r.apns.length === 1 && cs && cs.nextEta === mockNowSec + 180 && cs.nextDest === '淡水',
    `apns=${r.apns.length} nextEta=${cs && cs.nextEta} nextDest=${cs && cs.nextDest}`);
  ok('A8b 前提:那台同終點的車確實有 cars(可被借,這個陷阱才成立)',
    Array.isArray(srcTrtc.trains[0].cars) && srcTrtc.trains[0].cars.length === 6);
  ok('A8b 負對照:同終點但不是同一台車 ⇒ crowd 必須留白,不准拿別台頂替',
    cs && cs.crowd === null, JSON.stringify(cs && cs.crowd));
}
{
  // 資料齡:at 比 now 早超過 45 秒的列一律不可採(與前端 TRTC_OFFICIAL_BOARD_MAX_AGE_MS 同一條)
  await resetTable();
  srcTrtc = { board: [bRow('台北', '淡水', 180, -46)], trains: [] };
  await insRow({ token: T('a2'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  const r = await tick();
  ok('A13 資料齡超過 45 秒的列不可採 ⇒ 挑不到班次 ⇒ hold(不推)', r.apns.length === 0, `apns=${r.apns.length}`);
  ok('A14 hold 不刪列(缺訊只 hold,不可以讓卡片憑空消失)', !!(await getRow(T('a2'))));
  srcTrtc = { board: [bRow('台北', '淡水', 180, -44)], trains: [] };
  const r2 = await tick();
  ok('A15(邊界對照)at 早 44 秒就採得到——證明 A13 的紅是門檻造成的,不是整段路徑不通', r2.apns.length === 1);
}
{
  // 進站寬限:已到站 30 秒內的列仍留在板上(卡片停在「進站」),超過就換下一班
  await resetTable();
  srcTrtc = { board: [bRow('台北', '淡水', -29, -5), bRow('台北', '象山', 300, -5)], trains: [] };
  await insRow({ token: T('a3'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  let r = await tick();
  ok('A16 到站後 29 秒:那一班仍是首班(卡片維持「進站」)',
    r.apns[0] && r.apns[0].body.aps['content-state'].nextDest === '淡水');
  await resetTable();
  srcTrtc = { board: [bRow('台北', '淡水', -31, -5), bRow('台北', '象山', 300, -5)], trains: [] };
  await insRow({ token: T('a4'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  r = await tick();
  ok('A17 到站後 31 秒:那一班離開板上,次班遞補成首班',
    r.apns[0] && r.apns[0].body.aps['content-state'].nextDest === '象山',
    r.apns[0] ? r.apns[0].body.aps['content-state'].nextDest : '(沒推)');
}
{
  // 方向過濾:綁定存的 dest 是使用者在選單挑的那一個
  await resetTable();
  srcTrtc = { board: [bRow('台北', '淡水', 120), bRow('台北', '象山', 200), bRow('台北', '淡水', 600)], trains: [] };
  await insRow({ token: T('a5'), sys: 'trtc', station: '台北', dest: '象山', end_at: mockNowSec + 1800, apns_env: 'prod' });
  const r = await tick();
  const cs = r.apns[0].body.aps['content-state'];
  ok('A18 指定方向時只採該方向(120 秒那班往淡水,不可以變成首班)',
    cs.nextDest === '象山' && cs.nextEta === mockNowSec + 200, JSON.stringify([cs.nextDest, cs.nextEta]));
  ok('A19 該方向只有一班時,次班欄全 null(不可以拿別的方向來湊)',
    cs.secondEta === null && cs.secondDest === null, JSON.stringify([cs.secondEta, cs.secondDest]));
}
{
  // 每方向最多兩班(與看板 group.rows.slice(0,2) 一致):同方向三班進站時,
  // 不可以吃掉另一方向在卡片上的位置
  await resetTable();
  srcTrtc = { board: [bRow('台北', '淡水', 60, -5, 'x1'), bRow('台北', '淡水', 120, -5, 'x2'),
                      bRow('台北', '淡水', 180, -5, 'x3'), bRow('台北', '象山', 200, -5, 'y1')], trains: [] };
  await insRow({ token: T('a6'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 1800, apns_env: 'prod' });
  const r = await tick();
  const cs = r.apns[0].body.aps['content-state'];
  ok('A20 每方向取兩班後再全域排序(首班 60 秒往淡水、次班 120 秒往淡水)',
    cs.nextEta === mockNowSec + 60 && cs.secondEta === mockNowSec + 120, JSON.stringify([cs.nextEta, cs.secondEta]));
}

// ══════════════════════════════════════════════════════════════════
// Group B:推不推的判定(遲滯)。這一組是整條鏈的頻率預算所在。
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const mk = (etaOff, at) => ({ board: [bRow('台北', '淡水', etaOff, at)], trains: [] });
  srcTrtc = mk(300, -5);
  await insRow({ token: T('b1'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  let r = await tick();
  ok('B1 第一輪必推(last_state 是 NULL)', r.apns.length === 1);
  mockNowSec += 60; srcTrtc = mk(240, -5);          // 同一班車,eta 絕對值不變
  r = await tick();
  ok('B2 內容沒變就不推(同一班車、同一個絕對到站時刻)', r.apns.length === 0, `apns=${r.apns.length}`);
  mockNowSec += 60; srcTrtc = { board: [{ name: '台北', dest: '淡水', eta: mockNowSec + 190, at: mockNowSec - 5, no: '' }], trains: [] };
  r = await tick();                                  // 相對上次送出的 eta 漂 10 秒
  ok('B3 eta 只漂 10 秒(< 20 秒門檻)不推——這就是頻率預算的來源', r.apns.length === 0, `apns=${r.apns.length}`);
  mockNowSec += 60; srcTrtc = { board: [{ name: '台北', dest: '淡水', eta: mockNowSec + 155, at: mockNowSec - 5, no: '' }], trains: [] };
  r = await tick();                                  // 相對上次送出的 eta 漂 25 秒
  ok('B4 eta 漂 25 秒(>= 20 秒門檻)就推', r.apns.length === 1, `apns=${r.apns.length}`);
  ok('B5 推出去之後 last_state 換成新的 eta(遲滯的基準是「上次送出的」不是「上一輪算的」)',
    JSON.parse((await getRow(T('b1'))).last_state).nextEta === mockNowSec + 155);
}
{
  // 累積漂移:每輪只漂 8 秒,跟「上一輪」比永遠不到門檻,跟「上次送出的」比會在第三輪跨過。
  // 這一條就是在證明基準選的是後者——選錯的話卡片會無限期漂下去,而且測不出來。
  await resetTable();
  mockNowSec = 1_800_000_000;
  const base = mockNowSec + 600;
  srcTrtc = { board: [{ name: '台北', dest: '淡水', eta: base, at: mockNowSec - 5, no: '' }], trains: [] };
  await insRow({ token: T('b2'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  await tick();                                     // 首發,送出 eta=base
  const seen = [];
  for (let i = 1; i <= 3; i++) {
    mockNowSec += 60;
    srcTrtc = { board: [{ name: '台北', dest: '淡水', eta: base + 8 * i, at: mockNowSec - 5, no: '' }], trains: [] };
    seen.push((await tick()).apns.length);
  }
  ok('B6 每輪漂 8 秒:前兩輪不推、第三輪(累積 24 秒)推 ⇒ 遲滯基準是「上次送出的那一包」',
    JSON.stringify(seen) === JSON.stringify([0, 0, 1]), JSON.stringify(seen));
}
{
  // 逐班翻面:首班開走之後次班遞補,這是推播鏈存在的主要理由
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = { board: [bRow('台北', '淡水', 60), bRow('台北', '象山', 400)], trains: [] };
  await insRow({ token: T('b3'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  await tick();
  mockNowSec += 120;                                 // 首班已到站超過寬限 ⇒ 從板上消失
  srcTrtc = { board: [bRow('台北', '象山', 280), bRow('台北', '淡水', 500)], trains: [] };
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('B7 首班開走 ⇒ 推一發,首班換成原本的次班', r.apns.length === 1 && cs.nextDest === '象山',
    `apns=${r.apns.length} next=${cs && cs.nextDest}`);
  ok('B8 翻面那一發的 stale-date 跟著換成新首班的到站時刻',
    r.apns[0].body.aps['stale-date'] === mockNowSec + 280);
}
{
  // 擁擠度變了也要推(它就畫在卡片上)
  await resetTable();
  mockNowSec = 1_800_000_000;
  const board = [bRow('台北', '淡水', 300, -5, 'A1')];
  srcTrtc = { board, trains: [{ no: 'A1', dest: '淡水', cars: [1, 1, 1, 1, 1, 1] }] };
  await insRow({ token: T('b4'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  await tick();
  mockNowSec += 60;
  srcTrtc = { board: [{ name: '台北', dest: '淡水', eta: mockNowSec + 240, at: mockNowSec - 5, no: 'A1' }],
    trains: [{ no: 'A1', dest: '淡水', cars: [4, 4, 4, 4, 4, 4] }] };
  const r = await tick();
  ok('B9 eta 沒變但擁擠度變了 ⇒ 要推(它畫在卡片上,不推就是顯示過期的資訊)', r.apns.length === 1,
    `apns=${r.apns.length}`);
}

// ══════════════════════════════════════════════════════════════════
// Group C:收卡(這是「追蹤時段到點準時收」的唯一實作)
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = { board: [bRow('台北', '淡水', 300)], trains: [] };
  // 🔴 last_state 故意只有兩個 key——模擬「這一列是舊版 worker 存下來的」。收卡那一發如果直接
  //    沿用它,欄位集合就會跟著缺(而欄位集合是跨行程契約)。突變測試 M6 正是從這個缺口穿過去的:
  //    把一個 key 從 mwContentState 拿掉,更新那發紅了、收卡那發卻全綠。改成完整的 last_state
  //    會讓 C3 對這件事恆真——判準必須擺在「最不利的輸入」上才有牙。
  const last = { nextEta: mockNowSec, nextDest: '淡水' };
  await insRow({ token: T('c1'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec, last_state: last, apns_env: 'prod' });
  const r = await tick();
  const aps = r.apns[0] && r.apns[0].body.aps;
  ok('C1 追蹤時段到點:推 end', r.apns.length === 1 && aps.event === 'end', `event=${aps && aps.event}`);
  ok('C2 end 帶 dismissal-date=now(不帶的話卡片會留在鎖屏上到 staleDate 才灰掉)',
    aps && aps['dismissal-date'] === mockNowSec, String(aps && aps['dismissal-date']));
  ok('C3 end 的 content-state key 集合完整——即使這一列的 last_state 是舊版存的殘缺形狀'
     + '(形狀以現算的為準,不可以讓 D1 裡的舊資料決定契約)',
    aps && JSON.stringify(Object.keys(aps['content-state']).sort()) === JSON.stringify(CONTRACT_SORTED),
    aps ? JSON.stringify(Object.keys(aps['content-state']).sort()) : '(沒有 content-state)');
  ok('C3b end 的【值】沿用上次送出去的那一包(卡片被收走前的最後一瞬不該變成一排空白)',
    aps && aps['content-state'].nextDest === '淡水' && aps['content-state'].nextEta === last.nextEta,
    aps ? JSON.stringify([aps['content-state'].nextDest, aps['content-state'].nextEta]) : '');
  ok('C4 收卡後那一列被刪掉(不刪會每分鐘再推一次 end)', (await getRow(T('c1'))) === null);
}
{
  // 收卡推播失敗仍然要刪列——不可以因為推播失敗就把列留著永遠重試
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = { board: [], trains: [] };
  apnsNextStatus = 400; apnsNextReason = 'BadDeviceToken';
  await insRow({ token: T('c2'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec - 1, apns_env: 'prod' });
  const r = await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  ok('C5 end 推播非 2xx 仍然刪列', (await getRow(T('c2'))) === null);
  ok('C6 end 失敗有留下可診斷的 log', r.errLines.some(l => l.includes('收卡 end 推播非 2xx')),
    JSON.stringify(r.errLines.slice(0, 2)));
}
{
  // 官方明說末班已過(只有 krtc/tymc 有這個欄位)
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcLive.krtc = { at: new Date(mockNowSec * 1000).toISOString(),
    rows: [liveRow('美麗島', '南岡山', null, 3), liveRow('美麗島', '小港', null, 3)] };
  await insRow({ token: T('c3'), sys: 'krtc', station: '美麗島', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  const r = await tick();
  ok('C7 該站每一列都回報「末班已過」⇒ 推 end 收卡', r.apns.length === 1 && r.apns[0].body.aps.event === 'end');
  ok('C8 末班收卡後刪列', (await getRow(T('c3'))) === null);
  // 只有一部分列收班(另一條線還在跑)就【不可以】收卡
  await resetTable();
  srcLive.krtc = { at: new Date(mockNowSec * 1000).toISOString(),
    rows: [liveRow('美麗島', '南岡山', null, 3), liveRow('美麗島', '大寮', 4, 0)] };
  await insRow({ token: T('c4'), sys: 'krtc', station: '美麗島', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  const r2 = await tick();
  ok('C9(對照組)只有一條線收班時不可收卡,照常推更新',
    r2.apns.length === 1 && r2.apns[0].body.aps.event === 'update', `event=${r2.apns[0] && r2.apns[0].body.aps.event}`);
  ok('C10(對照組)那一列還在', !!(await getRow(T('c4'))));
}

// ══════════════════════════════════════════════════════════════════
// Group D:缺訊只 hold(使用者裁示:車子不會憑空消失)
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const last = { nextEta: mockNowSec + 100, nextMinutes: null, secondEta: null, secondMinutes: null,
    nextDest: '淡水', secondDest: null, crowd: null, dataAt: mockNowSec, notice: null, pushed: true };
  srcTrtc = { board: [], trains: [] };
  await insRow({ token: T('d1'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, last_state: last, apns_env: 'prod' });
  const r = await tick();
  ok('D1 看板整個空(深夜/上游降級)⇒ 不推、不收卡', r.apns.length === 0);
  const row = await getRow(T('d1'));
  ok('D2 hold 期間 last_state 原封不動(下一次有資料時才比對)',
    row && JSON.parse(row.last_state).nextEta === last.nextEta);
  // 來源整個拿不到(丟例外)
  srcThrow = '/api/trtc-live';
  const r2 = await tick();
  srcThrow = null;
  ok('D3 來源整個失效 ⇒ 不推、不刪列', r2.apns.length === 0 && !!(await getRow(T('d1'))));
  ok('D4 來源失效有留下可診斷的 log', r2.errLines.some(l => l.includes('trtc-live 取得失敗')),
    JSON.stringify(r2.errLines.slice(0, 2)));
}

// ══════════════════════════════════════════════════════════════════
// Group E:高捷/機捷(分鐘級)
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcLive.tymc = { at: new Date(mockNowSec * 1000).toISOString(), rows: [
    liveRow('三重站', '環北', 7), liveRow('三重站', '台北車站', 3),
    liveRow('三重', '迴龍', 1),                    // 中和新蘆線的「三重」是【另一個物理站】
    liveRow('三重站', '環北', null),                // e 為 null:官方沒給,不可採
    liveRow('三重站', '環北', 2, 2),                // st=2(交管不停):不可採
  ] };
  await insRow({ token: T('e1'), sys: 'tymc', station: '三重站', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  const r = await tick();
  const cs = r.apns[0] && r.apns[0].body.aps['content-state'];
  ok('E1(精度誠實)分鐘級系統只送 nextMinutes,eta 欄恆 null',
    cs && cs.nextMinutes === 3 && cs.nextEta === null && cs.secondEta === null,
    JSON.stringify([cs && cs.nextMinutes, cs && cs.nextEta]));
  ok('E2 次班取第二小的分鐘', cs && cs.secondMinutes === 7 && cs.secondDest === '環北');
  ok('E3🔴 站名【嚴格】比對:機捷「三重站」不可以吃到中和新蘆線「三重」的那一班(1 分鐘那列)',
    cs && cs.nextMinutes !== 1, `nextMinutes=${cs && cs.nextMinutes}`);
  ok('E4 e 為 null 與 st!==0 的列都不可採(採了就會出現假倒數)',
    cs && cs.nextMinutes === 3 && cs.secondMinutes === 7);
  ok('E5 stale-date = now + 分鐘數×60(分鐘級沒有秒級真值,只能這樣近似)',
    r.apns[0].body.aps['stale-date'] === mockNowSec + 180, String(r.apns[0].body.aps['stale-date']));
  ok('E6 分鐘級系統沒有官方逐節資料 ⇒ crowd 恆 null(不准造)', cs && cs.crowd === null);
  ok('E7 dataAt 用 feed 自己的時刻', cs && cs.dataAt === mockNowSec);
}
{
  // 整份 LiveBoard 過舊 ⇒ hold(與前端 150 秒門檻同一條)
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcLive.krtc = { at: new Date((mockNowSec - 151) * 1000).toISOString(), rows: [liveRow('美麗島', '小港', 3)] };
  await insRow({ token: T('e2'), sys: 'krtc', station: '美麗島', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  const r = await tick();
  ok('E8 LiveBoard 資料齡 151 秒(> 150 門檻)⇒ hold', r.apns.length === 0, `apns=${r.apns.length}`);
  srcLive.krtc = { at: new Date((mockNowSec - 149) * 1000).toISOString(), rows: [liveRow('美麗島', '小港', 3)] };
  const r2 = await tick();
  ok('E9(邊界對照)149 秒就採得到——證明 E8 的紅是門檻造成的', r2.apns.length === 1);
}

// ══════════════════════════════════════════════════════════════════
// Group F:APNs 失敗處理與雙環境退路
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = { board: [bRow('台北', '淡水', 300)], trains: [] };
  apnsNextStatus = 410; apnsNextReason = 'Unregistered';
  await insRow({ token: T('f1'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  ok('F1 永久失敗(Unregistered:卡片已被使用者收掉)⇒ 刪列', (await getRow(T('f1'))) === null);

  await resetTable();
  apnsNextStatus = 429; apnsNextReason = 'TooManyRequests';
  await insRow({ token: T('f2'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  await tick();
  apnsNextStatus = 200; apnsNextReason = '';
  const row = await getRow(T('f2'));
  ok('F2 暫時性失敗(429)不刪列,只把連續失敗數 +1', row && Number(row.fail_streak) === 1,
    row ? `fail_streak=${row.fail_streak}` : '(列不見了)');
  ok('F3 失敗時不可以寫 last_state(寫了就等於宣稱「這包送到了」,下一輪會誤判成沒變而不重試)',
    row && row.last_state === null, row ? String(row.last_state) : '');
}
{
  // 雙環境:開發簽章的 build 拿到 sandbox token,打 production 一律 BadDeviceToken。
  // 這條退路的存在理由見 worker.js laApnsSend 的長註解(2026-08-08 上架卡住的那次)。
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcTrtc = { board: [bRow('台北', '淡水', 300)], trains: [] };
  apnsTokenEnv = { [T('f4')]: 'sandbox' };
  await insRow({ token: T('f4'), sys: 'trtc', station: '台北', dest: null, end_at: mockNowSec + 3600 });  // apns_env=NULL
  const r = await tick();
  ok('F4 環境未知:先打 production 被退回,再打 sandbox 成功(兩發)',
    r.apns.length === 2 && r.apns[0].host === 'prod' && r.apns[1].host === 'sandbox',
    JSON.stringify(r.apns.map(c => c.host)));
  ok('F5 成功後把環境寫回這一列(每顆 token 一生最多只多付一次請求)',
    (await getRow(T('f4'))).apns_env === 'sandbox');
  mockNowSec += 60;
  srcTrtc = { board: [bRow('台北', '淡水', 30)], trains: [] };   // eta 大幅變動 ⇒ 一定會推
  const r2 = await tick();
  ok('F6 環境已知:直接打對的那一邊,不再付退路那一次', r2.apns.length === 1 && r2.apns[0].host === 'sandbox',
    JSON.stringify(r2.apns.map(c => c.host)));
  apnsTokenEnv = {};
}

// ══════════════════════════════════════════════════════════════════
// Group G:交班/註銷端點
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  const post = (body, path = 'bind') => new Request(`${BASE}/api/metro-wait/${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const good = { token: T('g1'), sys: 'trtc', station: '台北', dest: '淡水', endAt: mockNowSec + 1800 };
  const call = async (body, path) => {
    const res = await (path === 'unbind' ? metroWaitUnbind : metroWaitBind)(post(body, path), env);
    return { status: res.status, json: await res.json() };
  };
  ok('G5 GET 一律 405', (await metroWaitBind(new Request(`${BASE}/api/metro-wait/bind`), env)).status === 405);
  ok('G6 token 格式不合 ⇒ 400 bad_token', (await call({ ...good, token: 'nope' })).json.error === 'bad_token');
  ok('G7 sys 不在白名單 ⇒ 400 bad_sys', (await call({ ...good, sys: 'mrt' })).json.error === 'bad_sys');
  ok('G8 station 空 ⇒ 400 bad_station', (await call({ ...good, station: '  ' })).json.error === 'bad_station');
  ok('G9 endAt 已經過去 ⇒ 400 bad_end', (await call({ ...good, endAt: mockNowSec - 1 })).json.error === 'bad_end');
  ok('G10 endAt 超過 3 小時上限 ⇒ 400 bad_end',
    (await call({ ...good, endAt: mockNowSec + 3 * 3600 + 120 })).json.error === 'bad_end');
  const okRes = await call(good);
  const row = await getRow(T('g1'));
  ok('G11 合法交班寫進一列,四個欄位逐一正確', okRes.json.ok === true && row
    && row.sys === 'trtc' && row.station === '台北' && row.dest === '淡水' && Number(row.end_at) === good.endAt,
    row ? JSON.stringify([row.sys, row.station, row.dest, row.end_at]) : '(沒有列)');
  // 換站/換方向:狀態欄要一起重設,否則新站的第一輪可能因為「內容碰巧與舊站相同」而不推
  await env.DELAY_DB.prepare("UPDATE metro_wait_bindings SET last_state='{\"nextDest\":\"舊\"}', fail_streak=3, apns_env='sandbox' WHERE token=?")
    .bind(T('g1')).run();
  await call({ ...good, station: '中山', dest: null });
  const row2 = await getRow(T('g1'));
  ok('G12 同一顆 token 換站:last_state 與 fail_streak 一起歸零(規矩:重設點要重設全部狀態欄)',
    row2 && row2.last_state === null && Number(row2.fail_streak) === 0,
    row2 ? JSON.stringify([row2.last_state, row2.fail_streak]) : '');
  ok('G13 換站【不】重設 apns_env(環境是這個 App 安裝的屬性,不是這張卡的)',
    row2 && row2.apns_env === 'sandbox', row2 ? String(row2.apns_env) : '');
  ok('G14 dest 省略 ⇒ 存 NULL(＝最快一班,全部方向)', row2 && row2.dest === null, row2 ? String(row2.dest) : '');
  const u1 = await call({ token: T('g1') }, 'unbind');
  const u2 = await call({ token: T('g1') }, 'unbind');
  ok('G15 註銷刪列且冪等(重複送一樣回 200)',
    u1.json.ok === true && u2.json.ok === true && (await getRow(T('g1'))) === null);
}

// ══════════════════════════════════════════════════════════════════
// Group H:成本(沒有那個系統的卡就不去拿它的看板 ⇒ 沒人開卡＝零上游成本)
// ══════════════════════════════════════════════════════════════════
{
  await resetTable();
  mockNowSec = 1_800_000_000;
  srcLive.krtc = { at: new Date(mockNowSec * 1000).toISOString(), rows: [liveRow('美麗島', '小港', 3)] };
  await insRow({ token: T('h1'), sys: 'krtc', station: '美麗島', dest: null, end_at: mockNowSec + 3600, apns_env: 'prod' });
  const r = await tick();
  ok('H1 只有高捷的卡 ⇒ 完全不去拿北捷看板', !r.matches.some(u => u.includes('/api/trtc-live')),
    JSON.stringify(r.matches));
  ok('H2 也不去拿機捷看板(只拿真的有卡的那一個系統)', !r.matches.some(u => u.includes('sys=tymc')));
  await resetTable();
  const r2 = await tick();
  ok('H3 一張卡都沒有 ⇒ 零上游、零 APNs(cron 每分鐘跑但不花任何成本)',
    r2.matches.length === 0 && r2.apns.length === 0, `matches=${r2.matches.length} apns=${r2.apns.length}`);
}

await resetTable();
await dispose();
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

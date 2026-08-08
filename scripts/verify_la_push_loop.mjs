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
    'INSERT INTO la_bindings (token,uid,sys,train_no,stops,sta_map,stop_codes,last_idx,last_delay,bound_at,expire_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(row.token, row.uid || 'u1', row.sys, row.train_no, JSON.stringify(row.stops),
    JSON.stringify(row.staMap || {}), JSON.stringify(row.stopCodes || []),
    row.last_idx, row.last_delay, row.bound_at, row.expire_at).run();
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
    const CONTRACT_KEYS = ['arrivalDate', 'delaySec', 'departedDate', 'nextStop', 'terminus'].sort();
    ok('P1(Important9)content-state 欄位集合與 Swift ContentState 契約完全一致(不多不少)',
      JSON.stringify(csKeys) === JSON.stringify(CONTRACT_KEYS), JSON.stringify(csKeys));
    // 🔴 修復輪次1(資料契約變更):arrivalDate/departedDate 改送 epoch 秒數字,不送 ISO 字串
    // ——Swift 端 JSONDecoder 預設 .deferredToDate 解的是 timeIntervalSinceReferenceDate,
    // 不是 ISO 8601。期望值獨立用算術算,不呼叫 laArrivalEpoch 自己(心得29:判準不可與被測物同源)。
    const expectArrival = stops[0].at;   // delaySec=0,還沒到站 ⇒ 就是表定時刻本身
    ok('P1 arrivalDate 是 epoch 秒數字且獨立算術核對(未過站)',
      body.aps['content-state'].arrivalDate === expectArrival && typeof body.aps['content-state'].arrivalDate === 'number',
      String(body.aps['content-state'].arrivalDate));
    ok('P1 departedDate=null(idx=0 無前一站)', body.aps['content-state'].departedDate === null, String(body.aps['content-state'].departedDate));
    ok('P1 terminus=板橋(最後一站)', body.aps['content-state'].terminus === '板橋', body.aps['content-state'].terminus);
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

  // P4:時間前進到全部站過完 → 應收卡(D1 刪列),不推播
  mockNowSec = stops[stops.length - 1].at + 999;
  calls.length = 0;
  const r4 = await laPushAll(env, fakeCtx, BASE_URL);
  ok('P4 全程走完不計入 sent/dropped', r4.sent === 0 && r4.dropped === 0, JSON.stringify(r4));
  ok('P4 全程走完沒有 APNs 呼叫', calls.filter(c => c.url.includes(APNS_FRAG)).length === 0, String(calls.length));
  const row4 = await getRow(T);
  ok('P4 全程走完後 D1 列被刪除(收卡)', row4 === null, row4 ? JSON.stringify(row4) : '(已刪除)');
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
  let r14 = null, r14err = null;
  try { r14 = await laPushAll(env, fakeCtx, BASE_URL); } catch (e) { r14err = e; }
  apnsRejectToken = null;
  ok('P14(關鍵)laPushAll 不因單列 reject 而整支拋出例外(per-row try/catch 有生效)',
    r14err === null, r14err ? String((r14err && r14err.stack) || r14err).split('\n')[0] : '(無例外)');
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

await dispose();
Date.now = realDateNow;
globalThis.fetch = realFetch;
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

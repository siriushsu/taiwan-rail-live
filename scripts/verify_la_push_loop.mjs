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
let tdxBoard = null;            // null=TDX 呼叫要失敗(模擬上游掛掉);否則是 TrainLiveBoards 陣列
let tdxAuthFail = false;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.includes(APNS_FRAG)) {
    return new Response(JSON.stringify({}), { status: apnsNextStatus });
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

// caches.default:traLive 進來第一件事就查邊緣快取。Node 沒有這個全域,補一個永遠 miss 的假身,
// 讓它照真實邏輯往下走到 fetch(不是為了測快取本身——快取行為不在本檔範圍)。
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

const { env, dispose } = await getPlatformProxy({ configPath: `${WT}/wrangler.jsonc` });
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
    const expectArrival = new Date(stops[0].at * 1000).toISOString();
    ok('P1 arrivalDate 獨立算術核對(未過站)', body.aps['content-state'].arrivalDate === expectArrival, body.aps['content-state'].arrivalDate);
    ok('P1 departedDate=null(idx=0 無前一站)', body.aps['content-state'].departedDate === null, String(body.aps['content-state'].departedDate));
    ok('P1 terminus=板橋(最後一站)', body.aps['content-state'].terminus === '板橋', body.aps['content-state'].terminus);
  }
  const row1 = await getRow(T);
  ok('P1 推播成功後 D1 last_idx 更新成 0', !!row1 && row1.last_idx === 0 && row1.last_delay === 0, row1 ? `last_idx=${row1.last_idx}` : '(查無列)');

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
    const expectDeparted = new Date(stops[0].at * 1000).toISOString();
    ok('P3 departedDate 獨立算術核對(=前一站表定時刻)', body.aps['content-state'].departedDate === expectDeparted, body.aps['content-state'].departedDate);
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

// P5/P6:APNs 回 410/400 → 視為 token 失效,刪列、計入 dropped
for (const [tag, status] of [['p5', 410], ['p6', 400]]) {
  const T = tok(tag);
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }];
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9' + tag, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = status;
  const r = await laPushAll(env, fakeCtx, BASE_URL);
  ok(`P5/6(${status}) dropped 計數正確`, r.dropped === 1 && r.sent === 0, JSON.stringify(r));
  const row = await getRow(T);
  ok(`P5/6(${status}) token 失效後 D1 列被刪除`, row === null, row ? JSON.stringify(row) : '(已刪除)');
  await delRow(T);   // 防禦性清理:若上面兩條斷言其一為 FAIL(產品碼沒刪成),殘列不該汙染後面批次的計數
}

// P7:APNs 回 429/500(暫時性錯誤)→ 不刪列、不更新 last_idx,留給下一分鐘重試
for (const [tag, status] of [['p7a', 429], ['p7b', 500]]) {
  const T = tok(tag);
  await delRow(T);
  mockNowSec = 1_800_000_000;
  const stops = [{ name: 'A', at: mockNowSec + 100 }, { name: 'B', at: mockNowSec + 200 }];
  await insRow({ token: T, sys: 'thsr_sched', train_no: '9' + tag, stops, last_idx: -1, last_delay: 0, bound_at: mockNowSec, expire_at: mockNowSec + 3600 });
  calls.length = 0; apnsNextStatus = status;
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

await dispose();
Date.now = realDateNow;
globalThis.fetch = realFetch;
summary();
process.exit(results.filter(r => !r.p).length ? 1 : 0);

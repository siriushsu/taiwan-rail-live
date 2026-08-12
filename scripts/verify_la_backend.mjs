// LA 後端驗收。本檔【不打正式站】,一律對本機 wrangler dev 跑。
// 起 server 的指令見計畫 Task 4 Step 3;埠由呼叫端指定並傳進 LA_BASE。
import { execFileSync } from 'node:child_process';
import { laNextIdx, laSchedIdx, laArrivalEpoch, laJwt } from './la_push_core.mjs';

// results/ok/abort 三個必須排在最前面——連 LA_BASE/LA_WT 都還沒驗證前就要能用,
// 否則環境參數缺失那幾條 early-exit 沒有「總計」行可印(批次工具 grep 不到、真人也看不出腳本有跑過)。
const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
// 「總計」行的唯一產生點,不論從哪條路徑抵達都只印一次(printed 旗標)。兩個讀者要同時滿足:
// (a) 批次工具只 grep "總計" 認定腳本跑過一輪——中止也要有這行,不然這個維度會靜默零覆蓋;
// (b) 真人要一眼看出這不是「完整跑完」的結果,不能被 FAIL 0 誤讀成全過——所以行內明寫「中止,未完成」。
let printed = false;
function summary(reason) {
  if (printed) return;
  printed = true;
  const bad = results.filter(r => !r.p).length;
  console.log(reason
    ? `\n總計(中止,未完成) ${results.length} 項,FAIL ${bad} — 原因:${reason}`
    : `\n總計 ${results.length} 項,FAIL ${bad}`);
}
// 中止的統一出口。exit code 用 2 跟「完整跑完但有 FAIL」的 1、「全過」的 0 分開,
// 批次工具不必解析文字就能三態分流。
function abort(reason) {
  console.error(reason);
  summary(reason);
  process.exit(2);
}
// 🔴 例外防護掛在【行程層】,不是逐一包住每個 fetch/post/d1Exec 呼叫點——涵蓋範圍要跟著
// 「這支腳本」走,而不是跟著「當初記得包起來的那幾行」走。之後任何人在本檔新增第 N 個
// fetch/await/斷言,不必做任何防護動作就自動被涵蓋。各路徑的落點是實測的(node v24.14):
//   - top-level await 的 rejection(fetch 連線失敗、JSON.parse 失敗)→ uncaughtException
//   - 斷言或 helper 內部的同步例外                                  → uncaughtException
//   - 沒 await 的浮動 promise rejection                            → unhandledRejection
// 三者的預設 exit code 都是 1,會跟本腳本「跑完但有 FAIL」的 1 相撞(批次工具光看 exit code
// 會把「半途炸裂、完全沒跑完」誤讀成「跑到底、剛好幾項 FAIL」),所以一律改判 2。
const fatal = (tag) => (e) => {
  console.error(e && e.stack ? e.stack : String(e));   // 掛了 handler 就沒有預設 stack trace,自己補
  abort(`${tag}:${String((e && e.message) || e).split('\n')[0]}`);
};
process.on('uncaughtException', fatal('未攔截例外,腳本中止'));
process.on('unhandledRejection', fatal('未處理的 promise rejection,腳本中止'));
// 最後一道網:任何繞過上面兩者的結束路徑(例如日後有人直接在中間 process.exit()),
// 只要「總計」還沒印就補印,並改判 2(實測 exit 事件裡改 process.exitCode 有效)。
process.on('exit', () => {
  if (printed) return;
  summary('行程在印出「總計」之前就結束了');
  process.exitCode = 2;
});

const BASE = process.env.LA_BASE;
// 🔴 base 必須是 https(worker.js 有 http→https 301,純 http 會讓所有 /api/* 無限重導),
//    且呼叫端要帶 NODE_TLS_REJECT_UNAUTHORIZED=0(本機自簽憑證)。起 server 的完整方式見計畫 Task 4 Step 3。
if (!BASE) abort('請設 LA_BASE=https://127.0.0.1:<port>');
if (!BASE.startsWith('https://')) abort('LA_BASE 必須是 https,純 http 會被 301 無限重導');
// LA_WT:起 wrangler dev 那個乾淨 worktree 的絕對路徑——B14 要直查本機 D1(la_bindings 的
// last_idx/last_delay 沒有對應的讀取端點),得在同一個 cwd 下用 wrangler d1 execute --local
// 才能打到「這台正在跑的 server」用的那份 .wrangler/state/v3/d1。
const WT = process.env.LA_WT;
if (!WT) abort('請設 LA_WT=<起 wrangler dev 的乾淨 worktree 絕對路徑>');
function d1Exec(sql) {
  try {
    const out = execFileSync('arch',
      ['-arm64', 'node', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DELAY_DB', '--local', '--json', '--command', sql],
      { cwd: WT, encoding: 'utf8' });
    return JSON.parse(out);   // --json 讓 stdout 只有乾淨 JSON,banner/警告都在 stderr
  } catch (e) {
    // wrangler 子行程失敗(非 0 exit)或 --json 輸出解析失敗,都收斂到同一個中止出口——
    // 這是環境/基礎設施層失敗,不是某條產品行為斷言的 FAIL,沒有天然對應的斷言名稱可掛。
    abort(`d1Exec 失敗(wrangler 子行程或 JSON 解析出錯):${String(e.message || e).split('\n')[0]}`);
  }
}
function d1FirstRow(sql) {
  const res = d1Exec(sql);
  return res[0] && res[0].results && res[0].results[0];
}
const post = (path, body, hdr = {}) => fetch(BASE + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body),
});
const AUTH = { authorization: 'Bearer LA-LOCAL-TEST' };   // 對上 .dev.vars 的 LA_TEST_BEARER
const VALID = {
  token: 'ab'.repeat(32), sys: 'tra_sched', trainNo: '554',
  // at 是絕對 epoch 秒,且必須在現在前後一天內(端點會擋)——所以測資從 now 算,不寫死
  stops: [{ name: '潮州', at: Math.floor(Date.now() / 1000) + 600 },
          { name: '屏東', at: Math.floor(Date.now() / 1000) + 2040 }],
  staMap: { 5050: 1 }, stopCodes: ['5050', '5000'],
};

// ── 測試旁路的閘門必須【兩側都驗】,否則旗標機制一改,轉紅的會是散落各處的前置條件 ──
// B0 正向:旁路開著時,正確的 bearer 進得來(這條同時是 B1/B2 的正向對照)
{
  const r = await post('/api/la/bind', VALID, AUTH);
  ok('B0 齊備＋有效身分 → 200', r.status === 200, `HTTP ${r.status}`);
}
// B1 反向:完全不帶 authorization → 擋
{
  const r = await post('/api/la/bind', VALID);
  ok('B1 未帶 authorization 被拒', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
// B2 反向:帶了但值不對 → 擋(證明旁路認的是值,不是「有沒有這個 header」)
{
  const r = await post('/api/la/bind', VALID, { authorization: 'Bearer WRONG' });
  ok('B2 錯誤 bearer 被拒', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
// B3 欄位不全 → 400(與 B0 同身分,所以差異只可能來自欄位檢查)
{
  const r = await post('/api/la/bind', { token: VALID.token }, AUTH);
  ok('B3 欄位不全的 bind 被拒', r.status === 400, `HTTP ${r.status}`);
}
// B4 token 格式不對 → 400
{
  const r = await post('/api/la/bind', { ...VALID, token: 'nope' }, AUTH);
  ok('B4 token 格式錯被拒', r.status === 400, `HTTP ${r.status}`);
}
// B5 不支援的系統 → 400(台鐵/高鐵以外不收,避免默默收下一張永遠推不動的卡)
{
  const r = await post('/api/la/bind', { ...VALID, sys: 'trtc_live' }, AUTH);
  ok('B5 不支援的 sys 被拒', r.status === 400, `HTTP ${r.status}`);
}
// B6 at 離現在超過一天 → 400(擋掉「服務日算錯整整差一天」那類壞資料)
{
  const far = { ...VALID, stops: VALID.stops.map(s => ({ ...s, at: s.at + 86400 * 2 })) };
  const r = await post('/api/la/bind', far, AUTH);
  ok('B6 at 離現在太遠被拒', r.status === 400, `HTTP ${r.status}`);
}
// B9 stops 序列化超過大小上限 → 400(筆數上限只界定陣列長度,單一欄位仍可能被塞爆;
// 只改 name 長度,shape/count/時間範圍都維持合法,隔離出「只有大小上限這條斷言」在擋)
{
  const bigStops = [{ ...VALID.stops[0], name: 'X'.repeat(12500) }, VALID.stops[1]];
  const r = await post('/api/la/bind', { ...VALID, stops: bigStops }, AUTH);
  ok('B9 stops 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B10 staMap 鍵數超過上限 → 400(鍵多但單筆值小,JSON 總大小仍遠小於 8000,
// 隔離出「鍵數」與下面 B11「序列化大小」是兩條獨立斷言,不是同一條檢查的兩個名字)
{
  const manyKeysMap = {};
  for (let i = 0; i <= 400; i++) manyKeysMap[String(i)] = 1;   // 401 筆
  const r = await post('/api/la/bind', { ...VALID, staMap: manyKeysMap }, AUTH);
  ok('B10 staMap 鍵數超過上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B11 staMap 序列化超過大小上限 → 400(鍵數僅 1,不會被 B10 那條鍵數上限擋到)
{
  const bigValueMap = { '5050': 'X'.repeat(8500) };
  const r = await post('/api/la/bind', { ...VALID, staMap: bigValueMap }, AUTH);
  ok('B11 staMap 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B12 stopCodes 序列化超過大小上限 → 400(筆數仍等於 stops.length,不會被筆數檢查擋到)
{
  const bigStopCodes = ['X'.repeat(4500), VALID.stopCodes[1]];
  const r = await post('/api/la/bind', { ...VALID, stopCodes: bigStopCodes }, AUTH);
  ok('B12 stopCodes 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B13/B14 同一 token 重複 bind、換不同車次:B13 驗 HTTP 200(upsert 分支不 503),
// B14 直查 D1 驗 last_idx/last_delay 真的歸零——只驗 200 證明不了 SET 子句沒有被改寫成
// 保留舊值(SQLite UPSERT 允許 SET 右側直接引用目標表現值,那樣改寫一樣會成功回 200)。
// 依賴 B0 已先綁定過 VALID.token——腳本本來就依序執行,B8 的冪等測試也同樣依賴 B0 的綁定存在。
// 必須排在 B8 之前:B8 會把 VALID.token 從表裡刪掉,順序反了這裡測到的就是首次 insert 不是 upsert。
{
  // 前置狀態:B14 唯一會失效的方式是「重新 bind 之前 last_idx 剛好已經是 -1」——那樣「歸零」
  // 與「保留舊值」兩種行為結果相同,突變測不出來。所以先手動把 last_idx/last_delay 撥成非預設值
  // (7/180,不是 -1/0),且撥值後【先查一次確認真的生效】才繼續——撥值本身失敗(token 打錯、
  // 列不存在)會讓後面的歸零斷言退化成同義反覆,必須先排除、不能假設它一定成功。
  d1Exec(`UPDATE la_bindings SET last_idx=7, last_delay=180 WHERE token='${VALID.token}'`);
  const pre = d1FirstRow(`SELECT last_idx, last_delay FROM la_bindings WHERE token='${VALID.token}'`);
  const preOk = !!pre && pre.last_idx === 7 && pre.last_delay === 180;
  ok('B14 前置:手動撥值 last_idx=7/last_delay=180 生效', preOk,
    pre ? `last_idx=${pre.last_idx} last_delay=${pre.last_delay}` : '(查無列,token 尚未綁定?)');
  if (!preOk) abort('B14 前置狀態鋪設失敗,中止——後續的歸零斷言在此狀態下毫無意義');

  const r = await post('/api/la/bind', { ...VALID, trainNo: '999' }, AUTH);
  ok('B13 同 token 重複 bind 換車次 → 200', r.status === 200, `HTTP ${r.status}`);

  const post_ = d1FirstRow(`SELECT last_idx, last_delay FROM la_bindings WHERE token='${VALID.token}'`);
  ok('B14 重複 bind 後 last_idx/last_delay 真的歸零(不是保留舊值)',
    !!post_ && post_.last_idx === -1 && post_.last_delay === 0,
    post_ ? `last_idx=${post_.last_idx} last_delay=${post_.last_delay}` : '(查無列)');
}
// B7 GET 打 bind → 405(端點只收 POST;順帶證明 API_POST_ALLOWED 真的有掛上)
{
  const r = await fetch(BASE + '/api/la/bind');
  ok('B7 GET 打 bind 回 405', r.status === 405, `HTTP ${r.status}`);
}
// B8 unbind 冪等(重複送不報錯)
{
  const a = await post('/api/la/unbind', { token: VALID.token });
  const b = await post('/api/la/unbind', { token: VALID.token });
  ok('B8 unbind 冪等', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
}

// N 系列:換站決策純函式。不經 HTTP,直接測邏輯。
const MAP = { '5050': 1, '5040': 1, '5030': 1, '5000': 2 };   // 潮州→1, 竹田/西勢(通過)→1, 屏東→2
const CODES = ['5050', '5000', '4340'];                        // 停靠站:潮州(0) 屏東(1) 新左營(2)
const nx = (...a) => laNextIdx(...a);

ok('N1 已離站(status2)→下一個停靠站', nx('5050', 2, MAP, CODES, -1) === 1, String(nx('5050', 2, MAP, CODES, -1)));
ok('N2 進站中(status0)且該站是停靠站→就是它自己', nx('5050', 0, MAP, CODES, -1) === 0, String(nx('5050', 0, MAP, CODES, -1)));
// N3 是設計書 §8 明列的案例:在站上仍顯示該站(月台顯示器語意),不是提前翻到下一站
ok('N3 在站上(status1)且該站是停靠站→仍是它自己', nx('5050', 1, MAP, CODES, -1) === 0, String(nx('5050', 1, MAP, CODES, -1)));
ok('N4 通過站不論 status 都走映射', nx('5040', 0, MAP, CODES, -1) === 1, String(nx('5040', 0, MAP, CODES, -1)));
ok('N5 單調閘門:回報較早的站不倒退', nx('5050', 2, MAP, CODES, 2) === 2, String(nx('5050', 2, MAP, CODES, 2)));
ok('N6 認不出的站碼→維持現狀', nx('9999', 2, MAP, CODES, 1) === 1, String(nx('9999', 2, MAP, CODES, 1)));
ok('N7 終點之後(映射無值)→維持現狀', nx('4340', 2, MAP, CODES, 2) === 2, String(nx('4340', 2, MAP, CODES, 2)));

// ── 車不在 feed 的退路:必須【繼續前進】,不是凍住(設計書 §6) ──
const T0 = 1_800_000_000;
const SCH = [{ at: T0 + 600 }, { at: T0 + 1800 }, { at: T0 + 3600 }];
ok('N8 表定推進:第一站還沒到 → idx 0', laSchedIdx(SCH, 0, T0, -1) === 0, String(laSchedIdx(SCH, 0, T0, -1)));
// 🔴 最終複審 C1-Minor-1:N8/N9 取樣點各差 300 秒,`>` 寫成 `>=` 完全測不出來(兩條照樣綠)。
// 這一條就站在邊界上:now 恰等於 at+delay ⇒ 依 `>` 的語意算「已過」,要前進到 idx 1。
ok('N8b 表定推進邊界:now 恰等於第一站 at(±0 秒)⇒ 算已過,前進到 idx 1(`>` 改成 `>=` 會回 0)',
   laSchedIdx(SCH, 0, T0 + 600, -1) === 1, String(laSchedIdx(SCH, 0, T0 + 600, -1)));
ok('N9 表定推進:第一站已過 → 前進到 idx 1', laSchedIdx(SCH, 0, T0 + 900, 0) === 1, String(laSchedIdx(SCH, 0, T0 + 900, 0)));
ok('N10 表定推進吃誤點:誤點 10 分 ⇒ 同一時刻仍在 idx 0', laSchedIdx(SCH, 600, T0 + 900, 0) === 0, String(laSchedIdx(SCH, 600, T0 + 900, 0)));
ok('N11 表定推進也守單調閘門', laSchedIdx(SCH, 0, T0, 2) === 2, String(laSchedIdx(SCH, 0, T0, 2)));
ok('N12 全部過完 → 回 stops.length(呼叫端據此收卡)', laSchedIdx(SCH, 0, T0 + 9999, 0) === 3, String(laSchedIdx(SCH, 0, T0 + 9999, 0)));

// ── 到站時刻已過 → arrivalDate = nil(設計書 §6 那條吃掉交會待避/停站不更新的規則) ──
// 🔴 修復輪次1(資料契約變更):laArrivalIso 改名 laArrivalEpoch,回傳值從 ISO 字串改成
// epoch 秒數字——Swift 端 JSONDecoder 預設 .deferredToDate 解的是 timeIntervalSinceReferenceDate
// 不是 ISO 8601,詳見 la_push_core.mjs 該函式的註解。N13-N15 同步改成驗新契約。
ok('N13 未到站 → 回 epoch 秒數字', laArrivalEpoch(T0 + 600, 0, T0) === T0 + 600, String(laArrivalEpoch(T0 + 600, 0, T0)));
ok('N14 到站時刻已過 → 回 null', laArrivalEpoch(T0 + 600, 0, T0 + 601) === null, String(laArrivalEpoch(T0 + 600, 0, T0 + 601)));
// 🔴 最終複審 C1-Minor-1:N13/N14 取樣點只差 1 秒卻各自離邊界 600/1 秒,`>` 寫成 `>=`
// 仍然兩條全綠。N14b 站在邊界上,而且它與 N8b 必須是【同一個約定】——laSchedIdx 判「已過」
// 的那一刻,laArrivalEpoch 就得回 null,否則卡片會出現「下一站已翻到 B、抵達時刻卻還印著 A 的」。
ok('N14b 到站邊界:now 恰等於 at+delay(±0 秒)⇒ 回 null,與 N8b 同一個約定(`>=` 會回數字)',
   laArrivalEpoch(T0 + 600, 0, T0 + 600) === null, String(laArrivalEpoch(T0 + 600, 0, T0 + 600)));
ok('N15 誤點把到站推到未來 → 又回數字(不是永久 null)', typeof laArrivalEpoch(T0 + 600, 600, T0 + 700) === 'number', String(laArrivalEpoch(T0 + 600, 600, T0 + 700)));

// J 系列:APNs JWT。只驗結構與可解性,不驗 Apple 會不會接受(那要真金鑰,見 Step 6)。
{
  // 測試用的 EC P-256 金鑰(僅供本檔驗結構,不是任何真實憑證)
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8))).replace(/(.{64})/g, '$1\n');
  const fakeEnv = { APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`, APNS_KEY_ID: 'ABC1234567', APNS_TEAM_ID: 'TEAM123456' };
  const jwt = await laJwt(fakeEnv);
  const [h, p, s] = String(jwt).split('.');
  const dec = x => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
  ok('J1 JWT 三段結構', !!(h && p && s), `len=${String(jwt).length}`);
  ok('J2 header alg=ES256 且帶 kid', dec(h).alg === 'ES256' && dec(h).kid === 'ABC1234567', JSON.stringify(dec(h)));
  ok('J3 payload iss=TeamID 且 iat 是現在', dec(p).iss === 'TEAM123456' && Math.abs(dec(p).iat - Math.floor(Date.now() / 1000)) < 60, JSON.stringify(dec(p)));
  // 🔴 修復輪次1(Important 7):J1-J3 只驗結構(三段、欄位),79 條斷言裡沒有一條真的驗過
  // 簽章可否驗證——把 hash 算法偷改成 SHA-512、或把簽章編碼改成 DER,J1-J3 全部照樣綠,
  // 但 Apple 會用 403 拒絕。用同一把金鑰對的 publicKey 實際 crypto.subtle.verify 一次,
  // 且簽章位元組數要是 P-256 raw(IEEE P1363,64 bytes:r‖s)——DER 編碼長度不固定但恆不等 64,
  // 這條同時卡住「編碼格式錯」與「算法錯」兩種突變。
  const sigBytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  ok('J4 簽章位元組數=64(P-256 raw r‖s,不是 DER)', sigBytes.length === 64, `len=${sigBytes.length}`);
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sigBytes, new TextEncoder().encode(`${h}.${p}`));
  ok('J5 簽章可用對應公鑰驗證通過(SHA-256)', verified === true, String(verified));
  // 🔴 修復輪次1(Important 4 根因,不是 worker.js 那條 403 重置——這裡驗的是快取本身):
  // 換掉 APNS_KEY_ID/APNS_TEAM_ID 在同一個 50 分鐘快取窗內再呼叫 laJwt(),舊版拿到的是
  // 舊快取的 token(快取沒有以 env 為鍵)。金鑰輪替後這會保證失敗 50 分鐘。
  const jwt2 = await laJwt({ ...fakeEnv, APNS_KEY_ID: 'ROTATED9999' });
  ok('J6(關鍵)換 KEY_ID 後在快取窗內仍拿到新簽的 JWT(快取以 KEY_ID/TEAM_ID 為鍵)',
    jwt2 !== jwt && dec(String(jwt2).split('.')[0]).kid === 'ROTATED9999',
    jwt2 === jwt ? '拿到舊快取!' : JSON.stringify(dec(String(jwt2).split('.')[0])));
}

summary();   // 走到這裡＝完整跑完,印不帶「中止」字樣的總計行
process.exit(results.filter(r => !r.p).length ? 1 : 0);

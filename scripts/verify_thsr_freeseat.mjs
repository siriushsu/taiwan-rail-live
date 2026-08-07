#!/usr/bin/env node
// 高鐵自由座車廂提示——驗收。跑法:node scripts/verify_thsr_freeseat.mjs [--only=B,C,D,E] [--no-e]
//
// 分層(依「需不需要真的網路/wrangler」由輕到重,同 verify_thsr_schedule.mjs 的分層哲學):
//   B  純函式 thsrConvertFreeSeat/thsrFreeSeatUrl 直接 import worker.js 測,零網路/wrangler。
//      用委制的真實 fixture(scripts/fixtures/thsr_freeseat_fixture.json,2026-08-08 實測擷取,
//      非杜撰)+ 一組合成邊界案例。
//   C  端點層 thsrFreeSeat(request, env) 直接呼叫,自備 fetch()/caches/Date.now 替身
//      (globalThis.caches 補 mock,沿用 verify_bounty_api.mjs/dev_server.mjs 既有慣例)。
//      isolate 記憶體快取(thsrFreeSeatMem 等)是模組私有變數,測試從外部重置不了,改用「桌 Date.now()
//      跳到不同台北日期」逼快取自然失效——這個技巧同時證明日期把關與 TTL 把關是兩道獨立防線。
//   D  Playwright(chromium+webkit)+ dev_server.mjs(直接 import worker.js 跑 /api/*,見該檔),
//      驗前端顯示/跨系統閘門(含突變測試)/降級三路徑/手機四寬度;並內嵌重跑
//      verify_punctual.mjs 與 verify_my_trains.mjs 證明零回歸(bc7bfd5 的既有慣例)。
//   E  真的 wrangler dev(乾淨 detached worktree,覆寫 worker.js 為工作樹當下內容,避開重載風暴
//      陷阱)——E1 用真 TDX 憑證(.dev.vars)打真上游驗 200+形狀;E2 用本機 fixture server覆寫
//      THSR_FREESEAT_BASE_URL_OVERRIDE/TDX_AUTH_URL_OVERRIDE 讓上游回 400,驗證我們的錯誤處理
//      在真 workerd 裡也不會變成裸的 500(這個專案吃過一次「本機 Node 測不出 workerd 差異」的
//      正式站事故,見 worker.js 開頭「redirect:'error'」那段記載,所以後端一定要有一支真 runtime
//      冒煙測試,不能只信 D 段跑在 Node 裡的替身)。
//
// 全綠 exit 0,任一 FAIL exit 1。
import { createHash } from 'node:crypto';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const md5 = buf => createHash('md5').update(buf).digest('hex');

const argOnly = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const SECTIONS = new Set(argOnly ? argOnly.split(',') : ['B', 'C', 'D', 'E']);
if (process.argv.includes('--no-e')) SECTIONS.delete('E');

let fails = 0, total = 0;
const ok = (name, pass, detail = '') => {
  total++; if (!pass) fails++;
  console.log(`  ${pass ? 'PASS' : '❌FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
};
const note = (name, detail) => console.log(`  ·NOTE  ${name} — ${detail}`);

console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5(readFileSync(WORKER_PATH))}(工作樹當下內容,含未 commit 的改動)`);
console.log(`[G0] 跑的區段:${[...SECTIONS].join(', ')}`);

// ══════════════════════════ B:純函式(零網路/wrangler) ══════════════════════════
if (SECTIONS.has('B')) {
  console.log('\n===== B 純函式:thsrConvertFreeSeat / thsrFreeSeatUrl =====');
  const { _thsr } = await import('../worker.js');
  const { thsrConvertFreeSeat, thsrFreeSeatUrl } = _thsr;

  // B1:真實 fixture(2026-08-08 實測擷取的 TDX 原始回應,非杜撰)——結構與筆數雙重獨立核算,
  // 不呼叫 thsrConvertFreeSeat 半步(判準不得與實作同源)。
  const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/thsr_freeseat_fixture.json');
  if (existsSync(FIXTURE_PATH)) {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const list = raw.FreeSeatingCars;
    const indepExpected = {};
    for (const rec of list) {
      const cars = rec.Cars.filter(n => Number.isInteger(n) && n > 0);
      if (cars.length) indepExpected[String(rec.TrainNo)] = cars;
    }
    const got = thsrConvertFreeSeat(raw);
    ok('B1a 真實 fixture 188 筆全部轉出(無筆數流失)', Object.keys(got).length === Object.keys(indepExpected).length,
      `got=${Object.keys(got).length} expected=${Object.keys(indepExpected).length}`);
    const mismatches = Object.keys(indepExpected).filter(k => JSON.stringify(got[k]) !== JSON.stringify(indepExpected[k]));
    ok('B1b 每一筆 Cars 陣列逐值相符(獨立重算,非呼叫實作)', mismatches.length === 0,
      mismatches.length ? `不符的車次:${mismatches.slice(0, 5).join(',')}` : `核對 ${Object.keys(indepExpected).length} 筆`);
    // 這支 fixture 本身就證明了「TrainNo 不補零」的真實上游行為(108,不是 0108)——B1c 釘住這件事,
    // 免得日後有人「順手」在 thsrConvertFreeSeat 裡補零,悄悄改掉這個已知的跨端點格式差異。
    ok('B1c 真實資料證實 TrainNo 不補零("108" 而非 "0108")', Object.prototype.hasOwnProperty.call(got, '108') && !Object.prototype.hasOwnProperty.call(got, '0108'));
    ok('B1d 真實資料裡「108」車廂為 [10,11,12](與任務給的範例一致)', JSON.stringify(got['108']) === JSON.stringify([10, 11, 12]));
    // 車廂數分布獨立核算,與任務描述的「3節×111、4節×36、5節×28、9節×7、8節×5、2節×1」比對。
    const distGot = {}; for (const k of Object.keys(got)) distGot[got[k].length] = (distGot[got[k].length] || 0) + 1;
    const distExpected = { 3: 111, 4: 36, 5: 28, 9: 7, 8: 5, 2: 1 };
    ok('B1e 車廂數分布與任務給的實測事實一致', JSON.stringify(distGot) === JSON.stringify(distExpected) ||
      Object.keys(distExpected).every(k => distGot[k] === distExpected[k]),
      `got=${JSON.stringify(distGot)}`);
  } else {
    note('B1 真實 fixture', `找不到 ${FIXTURE_PATH},略過真實資料核對(仍會跑下面的合成邊界案例)`);
  }

  // B2:合成邊界案例——空 Cars、缺 TrainNo、非法值、非陣列輸入、裸陣列輸入(不包 FreeSeatingCars)。
  ok('B2a 空 Cars 陣列的車次整班不進表', !('9999' in thsrConvertFreeSeat({ FreeSeatingCars: [{ TrainNo: '9999', Cars: [] }] })));
  ok('B2b 缺 TrainNo 的紀錄整筆跳過(不拋錯)', (() => {
    try { return Object.keys(thsrConvertFreeSeat({ FreeSeatingCars: [{ Cars: [1, 2] }] })).length === 0; }
    catch (e) { return false; }
  })());
  ok('B2c 非整數/負數/零濾掉,合法值保留', JSON.stringify(thsrConvertFreeSeat({ FreeSeatingCars: [{ TrainNo: '1', Cars: [3, -1, 0, 4.5, 5] }] })['1']) === JSON.stringify([3, 5]));
  ok('B2d 頂層非陣列/非物件輸入回空表,不拋錯', (() => {
    try { return [null, undefined, {}, 'x', 123].every(v => JSON.stringify(thsrConvertFreeSeat(v)) === '{}'); }
    catch (e) { return false; }
  })());
  ok('B2e 裸陣列輸入(不包 FreeSeatingCars)也支援,同 traLive 的雙形狀慣例', JSON.stringify(thsrConvertFreeSeat([{ TrainNo: '7', Cars: [1] }])) === '{"7":[1]}');
  ok('B2f Cars 非陣列(如字串/物件)的車次整班跳過', Object.keys(thsrConvertFreeSeat({ FreeSeatingCars: [{ TrainNo: '5', Cars: 'nope' }] })).length === 0);

  // B3:thsrFreeSeatUrl——預設網址與覆寫 hook。
  ok('B3a 預設網址指向 TDX 官方 DailyFreeSeatingCar', thsrFreeSeatUrl({}, '2026-08-08') === 'https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyFreeSeatingCar/TrainDate/2026-08-08?%24format=JSON');
  ok('B3b env.THSR_FREESEAT_BASE_URL_OVERRIDE 覆寫生效(供本機測試指向 fixture server)', thsrFreeSeatUrl({ THSR_FREESEAT_BASE_URL_OVERRIDE: 'http://127.0.0.1:9/x' }, '2026-08-08') === 'http://127.0.0.1:9/x/2026-08-08?%24format=JSON');
}

// ══════════════════════════ C:端點層(fetch/caches/Date 替身,零 wrangler) ══════════════════════════
if (SECTIONS.has('C')) {
  console.log('\n===== C 端點層:thsrFreeSeat(request, env) 直接呼叫 =====');
  const { _thsr } = await import('../worker.js');
  const { thsrFreeSeat } = _thsr;

  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

  const realNow = Date.now.bind(Date);
  let fakeNowMs = null;
  Date.now = () => (fakeNowMs != null ? fakeNowMs : realNow());
  // 台北日期字串 → 對應的 UTC ms(供建構「跨午夜僅差 2 分鐘」的精確時間戳):00:00 台北=前一天 16:00 UTC。
  const taipeiMs = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);

  const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/thsr_freeseat_fixture.json');
  const REAL_SAMPLE = existsSync(FIXTURE_PATH) ? JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) : { FreeSeatingCars: [{ TrainNo: '108', Cars: [10, 11, 12] }] };

  function makeFetchMock(behavior) {
    const calls = { auth: 0, freeseat: 0 };
    const fn = async (url) => {
      const u = String(url);
      if (u.includes('openid-connect/token')) {
        calls.auth++;
        if (behavior.auth === 'fail') return new Response('unauthorized', { status: 401 });
        return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 86400 }), { status: 200 });
      }
      if (u.includes('DailyFreeSeatingCar')) {
        calls.freeseat++;
        if (behavior.freeseat === 'network-error') throw new Error('simulated network failure');
        if (behavior.freeseat === '400') return new Response(JSON.stringify({ message: 'RequestTrainDate error' }), { status: 400 });
        if (behavior.freeseat === '401') return new Response('', { status: 401 });
        if (behavior.freeseat === 'malformed') return new Response(JSON.stringify({ not: 'the right shape' }), { status: 200 });
        return new Response(JSON.stringify(REAL_SAMPLE), { status: 200 });
      }
      throw new Error('mock fetch 收到未預期的 URL: ' + u);
    };
    fn.calls = calls;
    return fn;
  }
  const req = () => new Request('https://railisland.tw/api/thsr-freeseat');

  // C1:auth 失敗(401)——這是第一個測試,此時模組私有的 tok/tokExp 尚未被任何成功呼叫填過。
  fakeNowMs = taipeiMs(2020, 1, 1, 12, 0);
  {
    const fm = makeFetchMock({ auth: 'fail' });
    globalThis.fetch = fm;
    const res = await thsrFreeSeat(req(), {});
    ok('C1 TDX 驗證失敗(401)→ 回合理錯誤,不是裸 500/拋例外', res instanceof Response && res.status === 502);
    const body = await res.json().catch(() => null);
    ok('C1b 錯誤回應是結構化 JSON(有 error 欄位)', !!(body && typeof body.error === 'string'));
  }

  // C2:happy path——auth 成功、freeseat 成功,回 200+正確形狀,且與真實 fixture 逐值相符。
  fakeNowMs = taipeiMs(2020, 1, 2, 12, 0);
  let happyCalls;
  {
    const fm = makeFetchMock({ auth: 'ok', freeseat: 'ok' });
    globalThis.fetch = fm; happyCalls = fm.calls;
    const res = await thsrFreeSeat(req(), {});
    ok('C2a 成功路徑回 200', res.status === 200);
    const body = await res.json();
    ok('C2b 回應形狀為 {at,date,cars}', typeof body.at === 'string' && typeof body.date === 'string' && typeof body.cars === 'object');
    ok('C2c date 欄位=呼叫當下的台北日期(2020-01-02)', body.date === '2020-01-02');
    ok('C2d cars 內容與 fixture 一致(108→[10,11,12])', JSON.stringify(body.cars['108']) === JSON.stringify([10, 11, 12]));
    ok('C2e cars 筆數與 fixture 的 FreeSeatingCars 筆數同量級(>100)', Object.keys(body.cars).length > 100);
  }

  // C3:打不存在的日期/壞參數——freeseat 端回 400(對應真實觀察:查沒有資料的日期,TDX 就是回 400)。
  fakeNowMs = taipeiMs(2020, 1, 3, 12, 0); // 換日期繞過 isolate 快取,強迫真的重打
  {
    const fm = makeFetchMock({ auth: 'ok', freeseat: '400' });
    globalThis.fetch = fm;
    const res = await thsrFreeSeat(req(), {});
    ok('C3a 上游回 400(模擬「查不到資料的日期」)→ 端點回合理錯誤而非 500', res instanceof Response && res.status === 502);
    const body = await res.json().catch(() => null);
    ok('C3b 錯誤回應仍是結構化 JSON,沒有讓例外逸出', !!(body && typeof body.error === 'string'));
  }

  // C4:上游 200 但資料形狀不對(壞參數的另一種顯形)→ 優雅退化成空表,仍是 200,不是錯誤。
  fakeNowMs = taipeiMs(2020, 1, 4, 12, 0);
  {
    globalThis.fetch = makeFetchMock({ auth: 'ok', freeseat: 'malformed' });
    const res = await thsrFreeSeat(req(), {});
    ok('C4a 上游回傳形狀不對 → 仍回 200(不是錯誤,只是沒資料)', res.status === 200);
    const body = await res.json();
    ok('C4b cars 優雅退化成空物件(不是 null/拋錯)', body.cars && typeof body.cars === 'object' && Object.keys(body.cars).length === 0);
  }

  // C5:上游網路層失敗(fetch 直接 throw,不是回應非 2xx)→ 同樣回合理錯誤。
  fakeNowMs = taipeiMs(2020, 1, 5, 12, 0);
  {
    globalThis.fetch = makeFetchMock({ auth: 'ok', freeseat: 'network-error' });
    const res = await thsrFreeSeat(req(), {});
    ok('C5 上游網路層失敗(fetch 拋例外)→ 端點回合理錯誤而非未捕捉例外', res instanceof Response && res.status === 502);
  }

  // C6:isolate 記憶體快取有牙——同一天連打兩次,第二次不應該再打上游。
  fakeNowMs = taipeiMs(2020, 1, 6, 9, 0);
  {
    const fm = makeFetchMock({ auth: 'ok', freeseat: 'ok' });
    globalThis.fetch = fm;
    await thsrFreeSeat(req(), {});
    const firstCalls = fm.calls.freeseat;
    fakeNowMs = taipeiMs(2020, 1, 6, 9, 30); // 同一天,30 分鐘後,遠低於 6 小時 TTL
    await thsrFreeSeat(req(), {});
    ok('C6 同一台北日期、TTL 內第二次呼叫不重打上游(cache 有牙)', fm.calls.freeseat === firstCalls, `first=${firstCalls} second=${fm.calls.freeseat}`);
  }

  // C7:跨午夜換日期,即使實際經過時間遠小於 6 小時 TTL,也要強制重打(日期把關獨立於 TTL 把關)。
  {
    const fm = makeFetchMock({ auth: 'ok', freeseat: 'ok' });
    globalThis.fetch = fm;
    fakeNowMs = taipeiMs(2020, 2, 1, 23, 59); // 台北 2020-02-01 23:59
    await thsrFreeSeat(req(), {});
    const beforeMidnight = fm.calls.freeseat;
    fakeNowMs = taipeiMs(2020, 2, 2, 0, 1);   // 台北 2020-02-02 00:01——只過 2 分鐘,但已跨日期
    await thsrFreeSeat(req(), {});
    ok('C7 跨午夜換日期(僅隔 2 分鐘,遠低於 TTL)仍強制重打上游', fm.calls.freeseat === beforeMidnight + 1, `跨日前=${beforeMidnight} 跨日後=${fm.calls.freeseat}`);
  }

  // C8:同一天內,超過 TTL(6 小時)也要重打——與 C7 互補,證明 TTL 把關獨立於日期把關。
  {
    const fm = makeFetchMock({ auth: 'ok', freeseat: 'ok' });
    globalThis.fetch = fm;
    fakeNowMs = taipeiMs(2020, 3, 1, 8, 0);
    await thsrFreeSeat(req(), {});
    const t0 = fm.calls.freeseat;
    fakeNowMs = taipeiMs(2020, 3, 1, 15, 1); // 同一天,7 小時 1 分後(> 6 小時 TTL)
    await thsrFreeSeat(req(), {});
    ok('C8 同日但超過 6 小時 TTL 仍重打上游', fm.calls.freeseat === t0 + 1, `TTL前=${t0} TTL後=${fm.calls.freeseat}`);
  }

  Date.now = realNow;
  console.log(`  (happyCalls 供除錯:auth=${happyCalls.auth} freeseat=${happyCalls.freeseat})`);
}

// ══════════════════════════ D:Playwright 前端(dev_server.mjs) ══════════════════════════
if (SECTIONS.has('D')) {
  console.log('\n===== D 前端:Playwright(chromium+webkit)+ dev_server.mjs =====');
  const PORT = 8932; // 與 verify_punctual.mjs/verify_my_trains.mjs 的既有慣例同一個埠,結尾直接借它們驗零回歸
  const BASE = `http://127.0.0.1:${PORT}`;

  const devLog = { text: '' };
  const dev = spawn('node', [path.join(ROOT, 'scripts/dev_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  dev.stdout.on('data', d => { devLog.text += d; });
  dev.stderr.on('data', d => { devLog.text += d; });

  const waitReady = async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try { const r = await fetch(BASE + '/index.html'); if (r.ok) return true; } catch (e) {}
      await new Promise(res => setTimeout(res, 300));
    }
    return false;
  };
  const ready = await waitReady();
  ok('D0 dev_server.mjs 起得來且回應 HTTP', ready, ready ? BASE : `log 尾巴:${devLog.text.slice(-300)}`);

  if (ready) {
    // 高鐵免劃位 mock:'108' 對應 dense.json 的高鐵車次 '0108'(驗證前導零剝除);'1214' 是台鐵
    // data/tra_schedule_dense.json 真實存在的車次號,故意也放進這張表,專供 D3 突變測試用——
    // 這不是杜撰的巧合,2026-08-08 實測真上游資料裡「1214」確實同時是台鐵與高鐵的車次號
    // (dev_server.mjs 直連真 TDX 驗證過),這裡固定寫死純粹是為了測試決定性(不依賴當天上游資料)。
    const MOCK_FREESEAT = { at: '2026-08-08T00:00:00.000Z', date: '2026-08-08', cars: { '108': [10, 11, 12], '1214': [3, 4] } };
    const EMPTY_FREESEAT = { at: '2026-08-08T00:00:00.000Z', date: '2026-08-08', cars: {} };

    // ── 為什麼「零 console error」只看 /api/thsr-freeseat,不是看全部 ──────────────────
    // 原始寫法是「頁面全程零 console error」,結果在 D1/D2/D5(mock:'ok',thsr-freeseat 本身
    // 不可能失敗)也大量翻紅。用獨立診斷腳本(完全不跟車、不碰這次新功能,只等開機)重現了
    // 一模一樣的失敗組合,證實這些是本機環境既有、與這次改動無關的噪音,逐一查證來源:
    //   /api/basemap-token 404 — 本機 .env 給的是 ESRI_API_KEY,worker 要的是 ESRI_WEB_TOKEN,
    //     兩者對不上版(見 memory esri-key-dead-confirmed.md),與高鐵自由座無關。
    //   /api/thsr-schedule 404 — 該既有端點自己的冷啟動 not_ready 狀態(curl 直接證實回
    //     {"error":"not_ready"}),與這次新增的 /api/thsr-freeseat 是兩個不同端點。
    //   /api/delay-stats 503 — 本機 dev_server.mjs 沒有真正的 D1 binding。
    //   /api/metro-live、/api/tra-alert、/api/thsr-alert 502 — 這幾支即時輪詢在本機短時間內
    //     重複實打真上游時偶發(懷疑是本機重複測試造成的 TDX/來源端瞬間抖動,見下面 E 段
    //     踩到的 TDX 認證端點 429 速率限制,是同一類「本機測試量太大→外部限流/抖動」)。
    // 這四類都在這次改動之前就存在、也都不是本腳本管轄的端點,判斷準則是「用完全不碰新功能
    // 的空白開機,能不能重現同一批失敗」——能重現就是既有環境噪音,不能重現才是這次的回歸。
    //
    // 修法選了「只認領自己的端點+未捕捉例外」,沒有選「把上面四類路徑列白名單」,原因是:
    // 白名單需要每次新發現一個既有端點的本機小狀況就回來加一條,長期只會越長越長；更嚴重的是,
    // 白名單一旦寫上某條路徑,就算那個端點哪天真的因為我們的改動而壞掉,白名單也會照樣放行、
    // 靜默吃掉那個訊號——等於把一個本來會叫的警報,永久性地拔掉電池。而「只認領自己的端點」
    // 不會有這個問題:不管本機環境將來新冒出哪個既有端點的哪種新噪音,都自動被排除在外;
    // 反過來只要 /api/thsr-freeseat 自己壞了(或有任何未捕捉例外),一定還是抓得到。
    // 下一個 session 如果要判斷這條準則還對不對:先確認「這支端點是不是本功能新增/擁有的」
    // 這個前提沒變(如果之後把 thsr-freeseat 的職責搬到別的端點,這裡要跟著改),既有端點的
    // 零回歸本來就该交給它們各自的驗收腳本負責(這裡的 D6 只是重跑 verify_punctual.mjs/
    // verify_my_trains.mjs 做二次確認),不是這支腳本的管轄範圍。
    async function openPage(browser, { viewport = { width: 1280, height: 800 }, mock = 'ok', watchFreeseatFail = true } = {}) {
      const ctx = await browser.newContext({ viewport, hasTouch: viewport.width <= 768 });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
      page.on('console', m => {
        if (m.type() !== 'error') return;
        // 瀏覽器自動的「Failed to load resource」訊息不含 URL,無法歸因是不是我方端點,
        // 改由下面的 response 監聽依 pathname 精確判斷;這裡只留真正的 console.error(...)自訂文字。
        if (/Failed to load resource/.test(m.text())) return;
        consoleErrors.push('console.error: ' + m.text());
      });
      page.on('response', r => {
        if (!watchFreeseatFail || r.status() < 400) return;
        let p; try { p = new URL(r.url()).pathname; } catch { p = r.url(); }
        if (p !== '/api/thsr-freeseat') return; // 只看我方新端點,其餘既有端點不歸本腳本管
        consoleErrors.push(`console.error(resource ${r.status()}): ${p}`);
      });
      if (mock === 'ok') await page.route('**/api/thsr-freeseat*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FREESEAT) }));
      else if (mock === '500') await page.route('**/api/thsr-freeseat*', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
      else if (mock === 'empty') await page.route('**/api/thsr-freeseat*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_FREESEAT) }));
      // mock==='real':不攔截,直接吃 dev_server.mjs 背後的真 worker.js(有 .env 真憑證)
      await page.goto(BASE + '/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500, null, { timeout: 30000 });
      await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); state.playing = false; });
      await page.waitForTimeout(150);
      return { ctx, page, consoleErrors };
    }

    // 挑車:高鐵 '0108'(dense.json 真實存在)、台鐵 '1214'(真實存在,且與上面 mock 表故意撞號)。
    const followHSR = page => page.evaluate(() => {
      const tr = (state.trains || []).find(t => t.sys === 'thsr_sched' && t.train === '0108');
      if (!tr) return { err: 'no thsr 0108' };
      setFollow(tr, false, true);
      return { train: tr.train, sys: tr.sys };
    });
    const followTRA1214 = page => page.evaluate(() => {
      const tr = (state.trains || []).find(t => t.sys === 'tra_sched' && t.train === '1214');
      if (!tr) return { err: 'no tra 1214' };
      setFollow(tr, false, true);
      return { train: tr.train, sys: tr.sys };
    });
    const fsState = page => page.evaluate(() => {
      const box = document.getElementById('tcFreeseat');
      return {
        hidden: box.hidden,
        text: document.getElementById('fsText').textContent,
        onBoxes: [...document.querySelectorAll('#fsCars .fs-box')].map(b => b.classList.contains('on')),
      };
    });

    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      console.log(`  -- 引擎:${engineName} --`);
      const browser = await engine.launch();

      // D1:happy path——跟高鐵 0108,mock 表用不補零的 '108',驗證 thsrTrainKey 前導零剝除有效。
      {
        const { ctx, page, consoleErrors } = await openPage(browser, { mock: 'ok' });
        const picked = await followHSR(page);
        ok(`D1a[${engineName}] 場上存在高鐵車次 0108(dense.json 真實資料)`, !picked.err, JSON.stringify(picked));
        await page.waitForTimeout(200); // renderFreeSeat 的 loadThsrFreeSeat().then() 是非同步,等一輪
        const st = await fsState(page);
        ok(`D1b[${engineName}] 跟高鐵車時 #tcFreeseat 顯示`, st.hidden === false, JSON.stringify(st));
        ok(`D1c[${engineName}] 文字正確反映「自由座 10–12 車」(含前導零剝除:mock 用 '108' 對應 tr.train='0108')`, st.text === '自由座 10–12 車', st.text);
        ok(`D1d[${engineName}] 車廂方塊總數=12(THSR 700T 固定編組)`, st.onBoxes.length === 12, `len=${st.onBoxes.length}`);
        ok(`D1e[${engineName}] 第 10/11/12 節 highlight,其餘不 highlight`, JSON.stringify(st.onBoxes) === JSON.stringify([false, false, false, false, false, false, false, false, false, true, true, true]), JSON.stringify(st.onBoxes));
        ok(`D1f[${engineName}] 跟車期間零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }

      // D2:跨系統閘門(正向)——跟台鐵 1214(mock 表裡也有這個鍵,是刻意的撞號測試件),不得顯示。
      {
        const { ctx, page, consoleErrors } = await openPage(browser, { mock: 'ok' });
        const picked = await followTRA1214(page);
        ok(`D2a[${engineName}] 場上存在台鐵車次 1214(真實資料)`, !picked.err, JSON.stringify(picked));
        await page.waitForTimeout(150);
        const st = await fsState(page);
        ok(`D2b[${engineName}] 跟台鐵車時 #tcFreeseat 不顯示(即使 mock 表裡剛好也有 1214 這個鍵)`, st.hidden === true, JSON.stringify(st));
        ok(`D2c[${engineName}] 跟台鐵車零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }

      // D3:突變測試——證明 D2 的閘門「有牙」:拿掉 isHSR 判斷後,同一班台鐵車必須翻紅(錯誤顯示)。
      {
        const { ctx, page } = await openPage(browser, { mock: 'ok' });
        await followTRA1214(page);
        await page.waitForTimeout(150);
        const before = await fsState(page);
        await page.evaluate(() => { window.__origIsHSR = window.isHSR; window.isHSR = () => true; renderFreeSeat(state.followTrain); });
        await page.waitForTimeout(150);
        const mutated = await fsState(page);
        ok(`D3a[${engineName}] 突變前(閘門正常):台鐵車不顯示`, before.hidden === true);
        ok(`D3b[${engineName}] 突變後(拿掉 isHSR 判斷):台鐵 1214 錯誤顯示了高鐵的自由座資料——證明閘門真的在擋東西`, mutated.hidden === false && mutated.text === '自由座 3–4 車', JSON.stringify(mutated));
        await page.evaluate(() => { window.isHSR = window.__origIsHSR; renderFreeSeat(state.followTrain); });
        await page.waitForTimeout(150);
        const restored = await fsState(page);
        ok(`D3c[${engineName}] 還原閘門後:台鐵車恢復不顯示`, restored.hidden === true, JSON.stringify(restored));
        await ctx.close();
      }

      await browser.close();
    }

    // D4:降級三路徑(500/空表/該車次不在清單)——只跑 chromium,任務要求「不可壞、不可有 console error」。
    {
      console.log('  -- D4 降級路徑(chromium)--');
      const browser = await chromium.launch();
      for (const [label, mock, followFn, watchFreeseatFail] of [
        // 這一格故意把 /api/thsr-freeseat 自己 mock 成 500,瀏覽器一定會對它自動打一則
        // resource-load-failed 訊息(這是瀏覽器網路層行為,跟前端程式碼寫得好不好無關)——
        // 這正是我們要驗的降級情境本身,不是意外噪音,故這一格不監看這條路徑的失敗。
        ['上游 500', '500', followHSR, false],
        ['上游 200 但空表', 'empty', followHSR, true],
        ['該車次不在清單', 'ok', followTRA1214.name === 'followTRA1214' ? (page => page.evaluate(() => {
          // 跟一班確定不在 mock 表裡的高鐵車(0109 沒放進 MOCK_FREESEAT)
          const tr = (state.trains || []).find(t => t.sys === 'thsr_sched' && t.train === '0109');
          if (!tr) return { err: 'no thsr 0109' };
          setFollow(tr, false, true);
          return { train: tr.train, sys: tr.sys };
        })) : null, true],
      ]) {
        const { ctx, page, consoleErrors } = await openPage(browser, { mock, watchFreeseatFail });
        const picked = await followFn(page);
        await page.waitForTimeout(250);
        const st = await fsState(page);
        ok(`D4[${label}] #tcFreeseat 安靜不顯示(不留空框)`, st.hidden === true, JSON.stringify({ picked, st }));
        ok(`D4[${label}] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }
      await browser.close();
    }

    // D5:手機四寬度雙引擎——展開「列車」sheet,量 #tcFreeseat 不造成橫向溢出。
    {
      console.log('  -- D5 手機四寬度 =');
      for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await engine.launch();
        for (const width of [360, 375, 414, 768]) {
          const { ctx, page, consoleErrors } = await openPage(browser, { viewport: { width, height: 800 }, mock: 'ok' });
          await followHSR(page);
          const opened = await page.evaluate(() => { openTrainSheet(); return document.getElementById('trainCard').classList.contains('tc-sheet'); });
          await page.waitForTimeout(250);
          const geo = await page.evaluate(() => {
            const tc = document.getElementById('trainCard');
            const box = document.getElementById('tcFreeseat');
            const r = box.getBoundingClientRect();
            return {
              hidden: box.hidden,
              tcScrollW: tc.scrollWidth, tcClientW: tc.clientWidth,
              boxScrollW: box.scrollWidth, boxClientW: box.clientWidth,
              rectRight: r.right, viewportW: window.innerWidth,
            };
          });
          ok(`D5[${engineName} ${width}px] 手機「列車」sheet 展開成功`, opened === true);
          ok(`D5[${engineName} ${width}px] #tcFreeseat 顯示`, geo.hidden === false, JSON.stringify(geo));
          ok(`D5[${engineName} ${width}px] 卡片本身不橫向溢出(scrollWidth<=clientWidth+1)`, geo.tcScrollW <= geo.tcClientW + 1, JSON.stringify(geo));
          ok(`D5[${engineName} ${width}px] 自由座列本身不橫向溢出`, geo.boxScrollW <= geo.boxClientW + 1, JSON.stringify(geo));
          ok(`D5[${engineName} ${width}px] 右緣沒有超出視窗`, geo.rectRight <= geo.viewportW + 1, JSON.stringify(geo));
          ok(`D5[${engineName} ${width}px] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
          await ctx.close();
        }
        await browser.close();
      }
    }

    // D6:零回歸——直接子行程重跑前兩項批次的權威驗收腳本,不重寫一份弱化的檢查。
    console.log('  -- D6 零回歸(重跑既有驗收腳本)--');
    for (const script of ['verify_punctual.mjs', 'verify_my_trains.mjs']) {
      try {
        const out = execSync(`node "${path.join(ROOT, 'scripts', script)}" "${BASE}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
        const lastLines = out.trim().split('\n').slice(-3).join(' / ');
        ok(`D6 ${script} 全綠(零回歸)`, !/FAIL/.test(out), lastLines);
      } catch (e) {
        const out = String((e && e.stdout) || (e && e.message) || e);
        ok(`D6 ${script} 全綠(零回歸)`, false, out.trim().split('\n').slice(-5).join(' / '));
      }
    }
  }

  dev.kill('SIGTERM');
}

// ══════════════════════════ E:真 wrangler runtime 冒煙測試 ══════════════════════════
if (SECTIONS.has('E')) {
  console.log('\n===== E 真 wrangler runtime 冒煙測試 =====');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 本機 wrangler 自簽憑證

  const freePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });

  // 起一台乾淨 worktree 的 wrangler dev,把「工作樹當下的 worker.js」覆寫進去(可能未 commit),
  // 回讀比對 md5 確保驗的是這次改動,不是 HEAD 的舊版(心得 32)。devVars 是要寫進 .dev.vars 的
  // 內容(物件),undefined 則複製(不是 symlink!)ROOT 既有的 .dev.vars/.env(供 E1 用真憑證)。
  // 這裡曾經用 symlinkSync 連回 ROOT 的真檔——結果撞上這個 repo 是多 session 並行共用的
  // worktree(見 verify_thsr_freeseat.mjs 開發過程的踩坑記錄):wrangler dev 的檔案監看疑似
  // 循 symlink 反查回 ROOT 的實際路徑並監看該目錄,只要 ROOT 目錄裡有任何檔案異動(哪怕是
  // 別的 session 在改完全無關的檔案),就觸發一輪「⎔ Reloading local server...」;如果那個
  // session 持續在存檔,reload 幾乎連續發生,實測整整 300 秒都沒能穩定回應一次 HTTP 請求。
  // 複製成獨立檔案後,temp worktree 與 ROOT 之間除了同一份 .git 物件庫,不再有任何路徑關聯,
  // 這個 reload 來源就被結構性排除。
  async function startServer(label, devVars) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'thsr-fs-smoke-'));
    const tree = path.join(dir, 'vtree');
    execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', tree, 'HEAD'], { stdio: 'ignore' });
    if (devVars) {
      writeFileSync(path.join(tree, '.dev.vars'), Object.entries(devVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    } else {
      for (const f of ['.dev.vars', '.env']) {
        if (existsSync(path.join(ROOT, f)) && !existsSync(path.join(tree, f))) writeFileSync(path.join(tree, f), readFileSync(path.join(ROOT, f)));
      }
    }
    const workerSrc = readFileSync(WORKER_PATH);
    const target = path.join(tree, 'worker.js');
    writeFileSync(target, workerSrc);
    const landed = md5(readFileSync(target));
    ok(`[${label}] 起 server 的樹裡 worker.js 逐 byte 等於工作樹當下內容`, landed === md5(workerSrc), `md5=${landed}`);

    const port = await freePort();
    const inspectorPort = await freePort();
    const proc = spawn('arch', ['-arm64', 'node', path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local-protocol', 'https', '--port', String(port), '--inspector-port', String(inspectorPort)],
    { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });

    const base = `https://127.0.0.1:${port}`;
    const stop = () => {
      try { proc.kill('SIGTERM'); } catch (e) {}
      try { execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch (e) {}
      try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    };

    const t0 = Date.now();
    const deadline = t0 + 300000;
    let ready = false;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break;
      try {
        const r = await fetch(`${base}/api/delay-stats`, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        await r.text();
        ready = true; break; // 只要有回應就算就緒,不看狀態碼(見 verify_worker_runtime_smoke.mjs 的既有理由)
      } catch (e) {}
      await new Promise(res => setTimeout(res, 1000));
    }
    const 起服務秒 = Math.round((Date.now() - t0) / 1000);
    ok(`[${label}] wrangler dev 起得來且真的回應 HTTP`, ready, ready ? `${base}(耗時 ${起服務秒}s)` : `等了 ${起服務秒}s 仍無回應;退出碼=${proc.exitCode};log 尾巴:${log.slice(-400)}`);
    return { base, stop, log: () => log, ready };
  }

  // E1:真 TDX 憑證(.dev.vars,由本腳本開頭複製自同機其他 worktree 的既有金鑰)——驗 200+形狀。
  const hasCreds = existsSync(path.join(ROOT, '.dev.vars'));
  if (!hasCreds) {
    note('E1', '找不到 .dev.vars,略過真憑證 200 驗證(仍會跑 E2 的錯誤路徑測試,E2 不需要真憑證)');
  } else {
    console.log('\n-- E1:真 TDX 憑證,驗 200+形狀 --');
    const s1 = await startServer('E1', null); // null=沿用 ROOT 既有 .dev.vars(真憑證)
    if (s1.ready) {
      try {
        // 這裡的 fetch 曾經在真上游卡住(TDX 認證端點在速率限制壓力下不保證秒回 429,
        // 沒有逾時的話整支腳本會無限期掛住,連 FAIL 都印不出來)——加逾時讓「卡住」變成
        // 乾淨可診斷的 FAIL,不是無限等待。
        const r = await fetch(s1.base + '/api/thsr-freeseat', { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(25000) });
        const status = r.status;
        const body = await r.json().catch(() => null);
        ok('E1a /api/thsr-freeseat 在真 wrangler runtime 上回 200', status === 200, `status=${status}`);
        ok('E1b 回應形狀正確({at,date,cars},cars 非空物件)', !!(body && typeof body.at === 'string' && typeof body.date === 'string' && body.cars && typeof body.cars === 'object' && Object.keys(body.cars).length > 0),
          body ? `keys=${Object.keys(body.cars || {}).length}` : '無法解析 JSON');
      } catch (e) { ok('E1 真 wrangler runtime 200+形狀', false, String((e && e.message) || e)); }
    }
    s1.stop();
  }

  // E2:本機 fixture server 讓上游回 400(對應真實觀察到的「查不到資料的日期」行為)——驗證真
  // workerd 裡也走到我們的錯誤處理,不是裸的 500(這正是這支冒煙測試存在的理由)。
  console.log('\n-- E2:上游回 400(fixture server),驗真 workerd 裡也回合理錯誤 --');
  const fixturePort = await freePort();
  const fixtureServer = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/auth/token') return res.end(JSON.stringify({ access_token: 'fixture-token', expires_in: 86400 }));
    if (u.pathname.startsWith('/Rail/THSR/DailyFreeSeatingCar/TrainDate/')) { res.statusCode = 400; return res.end(JSON.stringify({ message: 'no data for this date' })); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => fixtureServer.listen(fixturePort, '127.0.0.1', resolve));
  try {
    const s2 = await startServer('E2', {
      TDX_AUTH_URL_OVERRIDE: `http://127.0.0.1:${fixturePort}/auth/token`,
      THSR_FREESEAT_BASE_URL_OVERRIDE: `http://127.0.0.1:${fixturePort}/Rail/THSR/DailyFreeSeatingCar/TrainDate`,
    });
    if (s2.ready) {
      try {
        const r = await fetch(s2.base + '/api/thsr-freeseat', { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(25000) });
        const status = r.status;
        const bodyText = await r.text();
        ok('E2a 上游回 400 時,端點不是裸的 500(真 workerd 裡實測)', status !== 500, `status=${status} body=${bodyText.slice(0, 200)}`);
        ok('E2b 回應是結構化 JSON 錯誤(有 error 欄位),不是未捕捉例外的預設錯誤頁', (() => {
          try { const j = JSON.parse(bodyText); return typeof j.error === 'string'; } catch (e) { return false; }
        })(), bodyText.slice(0, 200));
      } catch (e) { ok('E2 上游 400 → 合理錯誤', false, String((e && e.message) || e)); }
    }
    s2.stop();
  } finally {
    fixtureServer.close();
  }
}

console.log(`\n──────── ${fails ? `${fails}/${total} 條 FAIL` : `全部 PASS(${total}/${total})`} ────────`);
process.exit(fails ? 1 : 0);

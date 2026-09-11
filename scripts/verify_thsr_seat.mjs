#!/usr/bin/env node
// 高鐵對號座餘位徽章與票價——驗收(單元 A,2026-09-11)。跑法:
//   node scripts/verify_thsr_seat.mjs [--only=B,C,D,R] [--real]
//
// 分層(同 scripts/verify_thsr_freeseat.mjs 的分層哲學,由輕到重):
//   B  純函式(thsrConvertSeatList/isThsrSeatCode/thsrSeatUrl)+ data/thsr_fare.json 靜態表,
//      零網路/wrangler。真實 fixture(scripts/fixtures/thsr_seat_fixture.json,2026-09-11 對
//      AvailableSeatStatusList 實測擷取,非杜撰)。
//   C  端點層 thsrSeat(request, env) 直接呼叫,自備 fetch()/caches/Date 替身——這次的 caches.default
//      替身會【真的】模擬 s-maxage TTL(不是永遠 miss):雙層 TTL 算式(edge 300／mem 310 秒
//      → 實際重打上游最小間隔 600 秒)的證明需要邊緣層真的把回應存住一段時間再過期,只驗 mem
//      這一層測不出「600」這個數字本身。另外用暫存檔突變測試證明空表守門人真的有牙(驗收條件3)。
//   D  Playwright(chromium+webkit)+ dev_server.mjs:語系與時鐘雙釘(memory:
//      verify-locale-must-be-pinned.md)、徽章 O/L/X 三態、票價鈕展開/收合/其他票種(獨立試算比對,
//      不跟頁面的 thsrFareDefaultTrio 同源)、大/特大字級隱藏規則、手機四寬度、零回歸重跑。
//   R  真上游(預設不跑,--real 才跑,避免每次除錯都重打 TDX 認證端點——它有節流):直接呼叫
//      worker 的 default.fetch(真 Request, 真 env),證明 /api/thsr-seat 這條路由真的打得通 TDX
//      (驗收條件1),並印出前兩筆真實紀錄與這次抓到的 O/L/X 即時分布(驗收條件2的即時佐證;
//      B1d 已經用 fixture 提供逐一比對過的真實樣本,這裡不重複比對值,只確認「現在也打得通」)。
//
// 全綠 exit 0,任一 FAIL exit 1。
import { createHash } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const md5 = buf => createHash('md5').update(buf).digest('hex');

const argOnly = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const SECTIONS = new Set(argOnly ? argOnly.split(',') : ['B', 'C', 'D']);
if (process.argv.includes('--real')) SECTIONS.add('R');

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

// ══════════════════════════ B:純函式 + 靜態票價表(零網路/wrangler) ══════════════════════════
if (SECTIONS.has('B')) {
  console.log('\n===== B 純函式:thsrConvertSeatList / isThsrSeatCode / thsrSeatUrl =====');
  const { _thsr } = await import('../worker.js');
  const { thsrConvertSeatList, isThsrSeatCode, thsrSeatUrl } = _thsr;

  // B1:真實 fixture——獨立重算 key/值,判準不得跟實作同源(judgment.md 第七節第 1 條)。
  const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/thsr_seat_fixture.json');
  if (existsSync(FIXTURE_PATH)) {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const list = raw.AvailableSeats;
    const indep = {};
    for (const rec of list) {
      const trainNo = String(rec.TrainNo);
      const origin = rec.StationName && rec.StationName.Zh_tw;
      for (const s of (rec.StopStations || [])) {
        const dest = s.StationName && s.StationName.Zh_tw;
        const std = ['O', 'L', 'X'].includes(s.StandardSeatStatus) ? s.StandardSeatStatus : null;
        const biz = ['O', 'L', 'X'].includes(s.BusinessSeatStatus) ? s.BusinessSeatStatus : null;
        if (!std && !biz) continue;
        indep[`${trainNo}|${origin}|${dest}`] = { std, biz };
      }
    }
    const got = thsrConvertSeatList(raw);
    ok('B1a 真實 fixture 全部轉出(獨立重算筆數相符)', Object.keys(got).length === Object.keys(indep).length,
      `got=${Object.keys(got).length} indep=${Object.keys(indep).length}`);
    const mismatches = Object.keys(indep).filter(k => JSON.stringify(got[k]) !== JSON.stringify(indep[k]));
    ok('B1b 每一筆 {std,biz} 逐值相符(獨立重算,非呼叫實作)', mismatches.length === 0,
      mismatches.length ? `不符:${mismatches.slice(0, 5).join(',')}` : `核對 ${Object.keys(indep).length} 筆`);
    ok('B1c TrainNo 1202 在頂層出現 5 筆(每個可上車站各一筆,OD 矩陣攤平的直接證據)',
      list.filter(r => String(r.TrainNo) === '1202').length === 5);

    // 驗收條件2:O/L/X 三態各至少一筆真實樣本,逐一比對(2026-09-11 實測記錄,見實作筆記-A)。
    const samples = {
      '1202|台北|南港': { std: 'O', biz: 'O' },
      '1202|台中|台北': { std: 'L', biz: 'O' },
      '1210|台中|板橋': { std: 'X', biz: 'X' },
    };
    for (const [key, expected] of Object.entries(samples)) {
      ok(`B1d 真實樣本 ${key} = ${JSON.stringify(expected)}(驗收條件2)`, JSON.stringify(got[key]) === JSON.stringify(expected), JSON.stringify(got[key]));
    }
  } else {
    note('B1 真實 fixture', `找不到 ${FIXTURE_PATH},略過真實資料核對`);
  }

  // B2:合成邊界案例。
  ok('B2a isThsrSeatCode 只認 O/L/X,大小寫/其他字元/空值一律 false',
    isThsrSeatCode('O') && isThsrSeatCode('L') && isThsrSeatCode('X') &&
    !isThsrSeatCode('o') && !isThsrSeatCode('A') && !isThsrSeatCode('') && !isThsrSeatCode(null) && !isThsrSeatCode(undefined));
  ok('B2b 只有其中一態有值時仍保留該筆(不因缺另一態而整筆丟棄)', (() => {
    const got = thsrConvertSeatList({ AvailableSeats: [{ TrainNo: '1', StationName: { Zh_tw: '台北' }, StopStations: [{ StationName: { Zh_tw: '台中' }, StandardSeatStatus: 'O' }] }] });
    return JSON.stringify(got['1|台北|台中']) === JSON.stringify({ std: 'O', biz: null });
  })());
  ok('B2c 非法代碼值(如小寫/非官方字元)視同無值,兩態皆非法則整筆跳過', Object.keys(thsrConvertSeatList({
    AvailableSeats: [{ TrainNo: '1', StationName: { Zh_tw: '台北' }, StopStations: [{ StationName: { Zh_tw: '台中' }, StandardSeatStatus: 'o', BusinessSeatStatus: 'z' }] }],
  })).length === 0);
  ok('B2d 缺 TrainNo 或缺起站站名的紀錄整筆跳過(不拋錯)', (() => {
    try {
      const a = thsrConvertSeatList({ AvailableSeats: [{ StationName: { Zh_tw: '台北' }, StopStations: [{ StationName: { Zh_tw: '台中' }, StandardSeatStatus: 'O' }] }] });
      const b = thsrConvertSeatList({ AvailableSeats: [{ TrainNo: '1', StopStations: [{ StationName: { Zh_tw: '台中' }, StandardSeatStatus: 'O' }] }] });
      return Object.keys(a).length === 0 && Object.keys(b).length === 0;
    } catch (e) { return false; }
  })());
  ok('B2e 頂層非陣列/非物件輸入回空表,不拋錯', (() => {
    try { return [null, undefined, {}, 'x', 123].every(v => JSON.stringify(thsrConvertSeatList(v)) === '{}'); }
    catch (e) { return false; }
  })());
  ok('B2f 裸陣列輸入(不包 AvailableSeats)也支援', (() => {
    const got = thsrConvertSeatList([{ TrainNo: '9', StationName: { Zh_tw: 'A' }, StopStations: [{ StationName: { Zh_tw: 'B' }, StandardSeatStatus: 'O' }] }]);
    return JSON.stringify(got) === '{"9|A|B":{"std":"O","biz":null}}';
  })());

  // B3:thsrSeatUrl——預設網址與覆寫 hook。
  ok('B3a 預設網址指向 TDX 官方 AvailableSeatStatusList(List 版,無參數,非 OD 版)',
    thsrSeatUrl({}) === 'https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/AvailableSeatStatusList?%24format=JSON');
  ok('B3b env.THSR_SEAT_BASE_URL_OVERRIDE 覆寫生效(供本機測試指向 fixture server)',
    thsrSeatUrl({ THSR_SEAT_BASE_URL_OVERRIDE: 'http://127.0.0.1:9/x' }) === 'http://127.0.0.1:9/x');

  // B4:票價靜態表(data/thsr_fare.json)——結構完整性 + 驗收條件4 的逐值核對。
  console.log('\n===== B4 靜態票價表:data/thsr_fare.json =====');
  const FARE_PATH = path.join(ROOT, 'data/thsr_fare.json');
  const fare = JSON.parse(readFileSync(FARE_PATH, 'utf8'));
  ok('B4a 12 站', Object.keys(fare.stations).length === 12, `got=${Object.keys(fare.stations).length}`);
  const stationIds = Object.keys(fare.stations);
  const expectedPairs = stationIds.length * (stationIds.length - 1) / 2;
  ok('B4b 站對數 = C(12,2) = 66(無序站對,單一方向存兩站小到大排序後的鍵)', Object.keys(fare.fares).length === expectedPairs, `got=${Object.keys(fare.fares).length}`);
  ok('B4c 每個站對都恰好 8 組票價(2026-09-11 對 66 個站對逐一實測的真實筆數,不是理論上限 8x9x3=216)',
    Object.values(fare.fares).every(arr => Array.isArray(arr) && arr.length === 8));
  ok('B4d 代碼表筆數 = 8/9/3(TicketType/FareClass/CabinClass,逐字抄 TDX swagger description)',
    Object.keys(fare.codes.ticketType).length === 8 && Object.keys(fare.codes.fareClass).length === 9 && Object.keys(fare.codes.cabinClass).length === 3);
  // 觀察到的真實子集是既有的已知情境(同 memory 的 gates-blocked-by-todays-data 精神反過來用:
  // 這裡不是怕樣本變動,是怕欄位/代碼表哪天真的擴充了卻沒人發現)——不是失敗,是提醒。
  const ttSet = new Set(), fcSet = new Set(), ccSet = new Set();
  for (const arr of Object.values(fare.fares)) for (const f of arr) { ttSet.add(f.ticketType); fcSet.add(f.fareClass); ccSet.add(f.cabinClass); }
  ok('B4e 實際出現的 TicketType/FareClass/CabinClass 子集與 2026-09-11 建置時的已知情境一致({1,8}/{1,9}/{1,2,3})',
    JSON.stringify([...ttSet].sort()) === '[1,8]' && JSON.stringify([...fcSet].sort()) === '[1,9]' && JSON.stringify([...ccSet].sort()) === '[1,2,3]',
    `tt=${[...ttSet]} fc=${[...fcSet]} cc=${[...ccSet]}`);
  // 驗收條件4:台北(1000)→左營(1070),一般票成人:標準 1490、商務 2440、自由座 1445。
  const tpeZuoying = fare.fares['1000|1070'] || [];
  const findPrice = (tt, fc, cc) => { const f = tpeZuoying.find(x => x.ticketType === tt && x.fareClass === fc && x.cabinClass === cc); return f ? f.price : null; };
  ok('B4f 驗收條件4—台北→左營 一般票成人 標準座=1490', findPrice(1, 1, 1) === 1490, `got=${findPrice(1, 1, 1)}`);
  ok('B4g 驗收條件4—台北→左營 一般票成人 商務座=2440', findPrice(1, 1, 2) === 2440, `got=${findPrice(1, 1, 2)}`);
  ok('B4h 驗收條件4—台北→左營 一般票成人 自由座=1445', findPrice(1, 1, 3) === 1445, `got=${findPrice(1, 1, 3)}`);
  ok('B4i 鍵是「小站碼|大站碼」字典序(1000<1070,不會同時存在 1070|1000)', !!fare.fares['1000|1070'] && !fare.fares['1070|1000']);
}

// ══════════════════════════ C:端點層(fetch/caches/Date 替身,零 wrangler) ══════════════════════════
if (SECTIONS.has('C')) {
  console.log('\n===== C 端點層:thsrSeat(request, env) 直接呼叫 =====');
  const { _thsr } = await import('../worker.js');
  const { thsrSeat } = _thsr;

  // 🔴 這次的 caches.default 替身要「真的」模擬 s-maxage TTL(不是永遠 miss)——雙層 TTL 算式
  // 的證明需要邊緣層真的把回應存住一段時間再過期,只驗 mem 那一層測不出「600」這個數字本身。
  function makeEdgeCache() {
    let stored = null; // { body, status, headers, expiresAt }
    return {
      async match() {
        if (!stored || Date.now() >= stored.expiresAt) return undefined;
        return new Response(stored.body, { status: stored.status, headers: stored.headers });
      },
      async put(key, res) {
        const cc = res.headers.get('cache-control') || '';
        const m = /s-maxage=(\d+)/.exec(cc);
        const maxage = m ? parseInt(m[1], 10) : 0;
        const body = await res.clone().text();
        stored = { body, status: res.status, headers: res.headers, expiresAt: Date.now() + maxage * 1000 };
      },
    };
  }

  const realNow = Date.now.bind(Date);
  let fakeNowMs = 0;
  Date.now = () => fakeNowMs;
  // C 全程會反覆整段覆寫 globalThis.fetch/caches(下面 makeFetchMock/makeEdgeCache 都是整個換掉,
  // 不是包一層)——跟 B/D 不同段但共用同一個 Node process,--only=B,C,D 一起跑時,C 結束後若不還原,
  // D 的 dev_server waitReady() 自己呼叫的 fetch() 會被 C 留下的最後一個 mock 攔截(對 /index.html
  // 這種未預期網址直接 throw),D0 因此每次必假紅——已實測「單跑 --only=D 綠、跟 B,C 一起跑必紅」
  // 兩相對照抓到,不是本題份內的邏輯錯,是這支測試腳本自己的全域污染,跟 Date.now 一樣要還原。
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;

  const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/thsr_seat_fixture.json');
  const REAL_SAMPLE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

  function makeFetchMock(behavior) {
    const calls = { auth: 0, seat: 0 };
    const fn = async (url) => {
      const u = String(url);
      if (u.includes('openid-connect/token')) {
        calls.auth++;
        if (behavior.auth === 'fail') return new Response('unauthorized', { status: 401 });
        return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 86400 }), { status: 200 });
      }
      if (u.includes('AvailableSeatStatusList')) {
        calls.seat++;
        if (behavior.seat === 'network-error') throw new Error('simulated network failure');
        if (behavior.seat === '500') return new Response(JSON.stringify({ message: 'server error' }), { status: 500 });
        if (behavior.seat === '401') return new Response('', { status: 401 });
        if (behavior.seat === 'empty-array') return new Response(JSON.stringify({ UpdateTime: '2026-09-11T00:00:00+08:00', AvailableSeats: [] }), { status: 200 });
        if (behavior.seat === 'malformed') return new Response(JSON.stringify({ not: 'the right shape' }), { status: 200 });
        return new Response(JSON.stringify(REAL_SAMPLE), { status: 200 });
      }
      throw new Error('mock fetch 收到未預期的 URL: ' + u);
    };
    fn.calls = calls;
    return fn;
  }
  const req = () => new Request('https://railisland.tw/api/thsr-seat');

  // C1:auth 失敗(401)——第一個測試,此時模組私有的 tok/tokExp 尚未被任何成功呼叫填過。
  globalThis.caches = { default: makeEdgeCache() };
  fakeNowMs = 0;
  {
    const fm = makeFetchMock({ auth: 'fail' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C1a TDX 驗證失敗(401)→ 回合理錯誤,不是裸 500/拋例外', res instanceof Response && res.status === 502);
    const body = await res.json().catch(() => null);
    ok('C1b 錯誤回應是結構化 JSON(有 error 欄位)', !!(body && typeof body.error === 'string'));
  }

  // C2(驗收條件3之一):冷啟動(thsrSeatMem 仍是 null,C1 沒有成功過)+ 上游回空陣列
  // → 空表守門人擋下來,此時沒有舊值可退,必須是結構化錯誤,不能悄悄回 200+空表。
  fakeNowMs = 1000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: 'empty-array' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C2a 冷啟動時上游回空陣列 → 502(不是 200+空表),驗收條件3的正向對照之一', res.status === 502, `status=${res.status}`);
    const body = await res.json().catch(() => null);
    ok('C2b 錯誤訊息點名「轉換後為空表」(不是泛用錯誤,方便未來排查)', !!(body && /空表/.test(body.error || '')), JSON.stringify(body));
  }

  // C3:happy path——auth 成功、seat 成功,回 200+{at,table},且與真實 fixture 逐值相符。此後
  // thsrSeatMem 首次被填入真實資料,供後面幾條「有舊值可退」的測試使用。
  fakeNowMs = 2000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: 'ok' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C3a 成功路徑回 200', res.status === 200);
    const body = await res.json();
    ok('C3b 回應形狀為 {at, table}', typeof body.at === 'string' && typeof body.table === 'object');
    ok('C3c table 內容與 fixture 一致(1202|台北|南港 → O/O)', JSON.stringify(body.table['1202|台北|南港']) === JSON.stringify({ std: 'O', biz: 'O' }));
    ok('C3d table 筆數與 fixture 轉換後同量級(>100)', Object.keys(body.table).length > 100, `got=${Object.keys(body.table).length}`);
  }

  // C4(驗收條件3之二):跨過雙層 TTL(> mem 310s 且 edge 也已過期)後,上游改回空陣列 →
  // 守門人一樣擋下來,但這次【有】舊值可退,應優雅退回 C3 那份真實舊資料,不是裸錯誤、
  // 更不可以是新的空表——跟 C2 互補,證明兩種「有無舊值」情境都不會把空表當合法新資料放行。
  fakeNowMs = 2000 + 312000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: 'empty-array' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C4a 有舊值時,上游回空陣列 → 退回舊值(200),不是把空表當新資料放行', res.status === 200, `status=${res.status}`);
    const body = await res.json();
    ok('C4b 退回的內容就是 C3 那份舊資料(1202|台北|南港 仍是 O/O),不是空表', JSON.stringify(body.table && body.table['1202|台北|南港']) === JSON.stringify({ std: 'O', biz: 'O' }));
    ok('C4c 這次確實有嘗試重打上游(fm.calls.seat=1,不是繼續沿用 mem 沒發request)', fm.calls.seat === 1, `calls=${fm.calls.seat}`);
  }

  // C5:網路層失敗(fetch 直接 throw)與上游 500——同樣要走「有舊值退舊值、沒舊值回結構化錯誤」的路。
  fakeNowMs = 2000 + 312000 + 312000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: 'network-error' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C5a 上游網路層失敗(fetch 拋例外)且有舊值 → 退回舊值,不是未捕捉例外', res.status === 200);
  }
  fakeNowMs += 312000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: '500' });
    globalThis.fetch = fm;
    const res = await thsrSeat(req(), {});
    ok('C5b 上游回 500 且有舊值 → 退回舊值', res.status === 200);
  }

  // C6:上游回 401(seat 呼叫本身,不是 auth 呼叫)→ 令牌重置,下一次呼叫要重新走一次 auth。
  fakeNowMs += 312000;
  {
    const fm = makeFetchMock({ auth: 'ok', seat: '401' });
    globalThis.fetch = fm;
    await thsrSeat(req(), {});
    const authCallsAfter401 = fm.calls.auth;
    fakeNowMs += 312000;
    const fm2 = makeFetchMock({ auth: 'ok', seat: 'ok' });
    globalThis.fetch = fm2;
    await thsrSeat(req(), {});
    ok('C6 seat 呼叫回 401 後,令牌被重置,下一次呼叫會重新走 auth(而不是沿用壞掉的舊令牌)', fm2.calls.auth === 1, `後續 auth 呼叫=${fm2.calls.auth}`);
  }

  // C7:雙層 TTL 算式(驗收要求:必須寫成程式碼註解,且這裡要真的驗過)。重開一份乾淨的 edge cache
  // (前面幾條測試留下的 edge 內容不該干擾這裡的時序),用一次「定錨」呼叫把 thsrSeatMemAt 釘在
  // 已知的 T0,才能精確控制後續 +300000ms/+600000ms 的相對時間。
  console.log('\n-- C7 雙層 TTL 算式:edge=300／mem=310 → 實際重打上游最小間隔=600 秒 --');
  {
    globalThis.caches = { default: makeEdgeCache() };
    const T0 = 1e9; // 遠遠晚於前面所有測試用過的時間戳,確保 thsrSeatMem 在這個時間點必然視為過期
    fakeNowMs = T0;
    const fm = makeFetchMock({ auth: 'ok', seat: 'ok' });
    globalThis.fetch = fm;
    await thsrSeat(req(), {}); // 定錨:thsrSeatMemAt=T0,edge 存到 T0+300000
    const afterAnchor = fm.calls.seat;
    ok('C7a 定錨呼叫確實打了一次上游', afterAnchor === 1, `calls=${afterAnchor}`);

    fakeNowMs = T0 + 300000; // edge 恰好過期(t=+300s),mem 年齡=300s(<310s,仍新鮮)
    await thsrSeat(req(), {});
    ok('C7b t=+300s(edge 過期但 mem 仍新鮮):不重打上游——edge 只是用 mem 重新墊,不是打 TDX', fm.calls.seat === afterAnchor, `calls=${fm.calls.seat}`);

    fakeNowMs = T0 + 600000; // edge(在 +300s 重墊過)再次過期,此時 mem 年齡=600s(>310s,過期)
    await thsrSeat(req(), {});
    ok('C7c t=+600s(edge 再次過期且 mem 過期):重打上游——實測證實 edge=300/mem=310 → 真實間隔恰為 600 秒',
      fm.calls.seat === afterAnchor + 1, `calls=${fm.calls.seat}`);
  }

  // C8(驗收條件3,最重要):突變測試——證明空表守門人「有牙」。做法:讀 worker.js 原始碼,
  // 把守門人那一行原樣替換掉,寫成暫存檔重新 import,在同樣的「上游回空陣列、冷啟動」情境下
  // 比較有無守門人的行為差異(對照組正是上面的 C2:同樣情境,有守門人時是 502,不是 200+空表)。
  console.log('\n-- C8 突變測試(驗收條件3):拿掉空表守門人,證明它原本真的在擋東西 --');
  {
    const workerSrc = readFileSync(WORKER_PATH, 'utf8');
    const guardNeedle = "if (Object.keys(table).length === 0) throw new Error('thsr-seat 轉換後為空表(疑似上游或解析異常,非「今天真的沒有高鐵」)');";
    const guardCount = workerSrc.split(guardNeedle).length - 1;
    ok('C8a 守門人程式碼存在且唯一(突變前置檢查:找不到就無從突變,也代表程式碼已經改了)', guardCount === 1, `count=${guardCount}`);
    if (guardCount === 1) {
      const mutatedSrc = workerSrc.replace(guardNeedle, '/* [C8 突變測試] 空表守門人已移除,見 scripts/verify_thsr_seat.mjs */');
      // 🔴 worker.js 開頭一串 `import ... from './scripts/xxx.mjs'` 是相對路徑,寫進 os.tmpdir()
      // 會解不到那些檔案(ERR_MODULE_NOT_FOUND)——暫存檔必須跟 worker.js 同一層資料夾(ROOT),
      // 相對 import 才解得到。這棵樹以內建立/刪除暫存檔沒有牴觸鐵則(鐵則管的是樹以外),finally
      // 一定要刪掉,不留痕跡進 git status。
      const tmpPath = path.join(ROOT, `.thsr-seat-mutated-tmp-${process.pid}-${Date.now()}.mjs`);
      writeFileSync(tmpPath, mutatedSrc);
      try {
        const { _thsr: mutated } = await import(tmpPath);
        globalThis.caches = { default: makeEdgeCache() };
        fakeNowMs = 0; // 這是全新的模組實例,thsrSeatMem 本來就是 null(冷啟動),對齊 C2 的情境
        globalThis.fetch = makeFetchMock({ auth: 'ok', seat: 'empty-array' });
        const res = await mutated.thsrSeat(req(), {});
        const body = await res.json().catch(() => null);
        ok('C8b 拿掉守門人後,同樣的「冷啟動+上游回空陣列」情境變成 200+真的空表——這正是守門人原本要擋的 bug,證明它有牙(對照見 C2:同樣情境、有守門人時是 502)',
          res.status === 200 && body && body.table && Object.keys(body.table).length === 0,
          `status=${res.status} body=${JSON.stringify(body)}`);
      } finally {
        try { unlinkSync(tmpPath); } catch (e) {}
      }
    } else {
      note('C8', '找不到守門人原始碼字面,略過突變測試——這本身就該視為警訊,不是略過就沒事');
    }
  }

  Date.now = realNow;
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}

// ══════════════════════════ D:Playwright 前端(dev_server.mjs) ══════════════════════════
if (SECTIONS.has('D')) {
  console.log('\n===== D 前端:Playwright(chromium+webkit)+ dev_server.mjs =====');
  const PORT = 8933; // 借 verify_thsr_freeseat.mjs 的 8932 旁邊一個新埠,避免併行時撞埠
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
    // 語系與時鐘雙釘(memory: verify-locale-must-be-pinned.md)——網址帶 ?lang=zh-TW/en/ja(index.html
    // 自己的最高優先語系開關,query > localStorage > navigator)＋ Playwright context locale 對齊
    // (避免沒帶 locale 的 Intl/toLocaleString 也漂)。時鐘用 setSimSec 釘在白天(高鐵營運時段),
    // 避免深夜真的沒車導致看板空板。全程用 class/dataset/aria-label 定位元件,不用中文字面找東西
    // (那是隱形的語系相依,見 memory 同檔「形態總表」那段)。
    async function openPage(browser, { viewport = { width: 1280, height: 800 }, lang = 'zh-TW', mockTable = {} } = {}) {
      const ctx = await browser.newContext({ viewport, locale: lang, hasTouch: viewport.width <= 768 });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
      page.on('console', m => {
        if (m.type() !== 'error') return;
        if (/Failed to load resource/.test(m.text())) return;
        consoleErrors.push('console.error: ' + m.text());
      });
      page.on('response', r => {
        if (r.status() < 400) return;
        let p; try { p = new URL(r.url()).pathname; } catch { p = r.url(); }
        if (p !== '/api/thsr-seat') return; // 只認領自己的端點(同 verify_thsr_freeseat.mjs 的既有理由)
        consoleErrors.push(`console.error(resource ${r.status()}): ${p}`);
      });
      await page.route('**/api/thsr-seat*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ at: new Date().toISOString(), table: mockTable }) }));
      await page.goto(`${BASE}/index.html?lang=${lang}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500, null, { timeout: 30000 });
      await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); state.playing = false; setSimSec(10 * 3600); });
      await page.waitForTimeout(150);
      return { ctx, page, consoleErrors };
    }

    // A0:語系閘門——必須先過,否則後面任何一條紅都分不清是回歸還是語系沒釘住(同檔慣例)。
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch();
      for (const lang of ['zh-TW', 'en', 'ja']) {
        const { ctx, page } = await openPage(browser, { lang });
        const got = await page.evaluate(() => ({ i18nLang: window.__i18n.lang, docLang: document.documentElement.lang, fareLabel: window.__i18n.t('票價') }));
        const expectedFareLabel = { 'zh-TW': '票價', en: 'Fares', ja: '運賃' }[lang];
        ok(`A0[${engineName} ${lang}] window.__i18n.lang 對齊網址 ?lang=`, got.i18nLang === lang, JSON.stringify(got));
        ok(`A0[${engineName} ${lang}] t('票價') 正確反映語系(樣本必須真的隨語系改變,不是穿透 key)`, got.fareLabel === expectedFareLabel, JSON.stringify(got));
        await ctx.close();
      }
      await browser.close();
    }

    // 找一個目前看板上、確定有下一段行程的高鐵列(供 D1/D2 的座位徽章與票價 mock 使用)——用真實
    // 列車與終點組 mock 鍵,不是憑空捏造,確保徽章渲染邏輯本身被驗到(是否「剛好三態都在」是
    // R4 即時抓取的責任,不是這裡)。
    async function pickThsrRows(page, stationName, n) {
      return page.evaluate(({ stationName, n }) => {
        const st = { name: stationName, sys: 'thsr_sched' };
        const rows = schedBoardRows(st).filter(r => !r.off && !r.isLast);
        return rows.slice(0, n).map(r => ({ train: r.tr.train, dest: r.dest }));
      }, { stationName, n });
    }

    // 座位/票價快取由 openBoard 觸發後才非同步 fetch(loadThsrSeat/loadThsrFare 完成才 renderBoard
    // 一次),固定 waitForTimeout 用猜的時長曾在忙碌環境下量到 chromium 偶發來不及(同一支程式碼
    // 前後兩次跑出不同結果,正是「判準綁在時間長度上」的訊號,見 judgment.md 第七節第3條)——改
    // 成等實際完成訊號本身(兩個快取都不再是 undefined),到就馬上往下,不拖慢正常情況。
    async function waitThsrLoaded(page) {
      await page.waitForFunction(
        () => typeof _thsrSeatCache !== 'undefined' && typeof _thsrFareCache !== 'undefined',
        null, { timeout: 5000 }
      );
    }

    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      console.log(`  -- 引擎:${engineName} --`);
      const browser = await engine.launch();

      const probe = await openPage(browser);
      const rows = await pickThsrRows(probe.page, '台北', 3);
      await probe.ctx.close();
      ok(`D0a[${engineName}] 台北站板至少有 3 個「還有下一段」的高鐵列可供測試`, rows.length === 3, JSON.stringify(rows));
      if (rows.length !== 3) { await browser.close(); continue; }

      // D1:三態徽章。
      {
        const mockTable = {
          [`${rows[0].train}|台北|${rows[0].dest}`]: { std: 'O', biz: 'O' },
          [`${rows[1].train}|台北|${rows[1].dest}`]: { std: 'L', biz: null },
          [`${rows[2].train}|台北|${rows[2].dest}`]: { std: 'X', biz: 'X' },
        };
        const { ctx, page, consoleErrors } = await openPage(browser, { mockTable });
        await page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(page); // loadThsrSeat()/loadThsrFare() 是非同步,等實際完成訊號
        const badges = await page.evaluate(trains => trains.map(no => {
          const row = document.querySelector(`.row[data-no="${no}"]`);
          const tag = row && row.querySelector('.seatTag');
          return tag ? { cls: [...tag.classList].join(' '), text: tag.textContent, title: tag.title } : null;
        }), [rows[0].train, rows[1].train, rows[2].train]);
        ok(`D1a[${engineName}] O 態:class 含 seatTag-o,文字為「有位」`, !!badges[0] && /seatTag-o/.test(badges[0].cls) && badges[0].text === '有位', JSON.stringify(badges[0]));
        ok(`D1b[${engineName}] L 態:class 含 seatTag-l,文字為「剩不多」`, !!badges[1] && /seatTag-l/.test(badges[1].cls) && badges[1].text === '剩不多', JSON.stringify(badges[1]));
        ok(`D1c[${engineName}] X 態:class 含 seatTag-x,文字為「售完」`, !!badges[2] && /seatTag-x/.test(badges[2].cls) && badges[2].text === '售完', JSON.stringify(badges[2]));
        ok(`D1d[${engineName}] O 態 tooltip 同時帶出商務座狀態(兩態都有值時)`, !!badges[0] && badges[0].title.includes('商務座'), JSON.stringify(badges[0]));
        ok(`D1e[${engineName}] L 態商務座缺值時 tooltip 只講標準座(不瞎補商務座字樣)`, !!badges[1] && !badges[1].title.includes('商務座'), JSON.stringify(badges[1]));
        ok(`D1f[${engineName}] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }

      // D2:票價鈕/展開/收合/其他票種——沿用 rows[0](台北→rows[0].dest,O 態那一列)。
      {
        const { ctx, page, consoleErrors } = await openPage(browser);
        await page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(page);
        const rowSel = `.row[data-no="${rows[0].train}"]`;
        const before = await page.evaluate(sel => !!document.querySelector(sel + ' + .fareExpand'), rowSel);
        ok(`D2a[${engineName}] 開板當下票價展開層預設不存在`, before === false);

        await page.click(`${rowSel} .fareBtn`);
        await page.waitForTimeout(150);
        const expand = await page.evaluate(sel => {
          const el = document.querySelector(sel + ' + .fareExpand');
          if (!el) return null;
          return {
            head: el.querySelector('.fareHead')?.textContent,
            rows: [...el.querySelectorAll(':scope > .fareRow')].map(r => ({ k: r.querySelector('.fareK')?.textContent, v: r.querySelector('.fareV')?.textContent })),
            hasMore: !!el.querySelector('.fareMore'),
          };
        }, rowSel);
        ok(`D2b[${engineName}] 點「票價」後展開層出現`, !!expand, JSON.stringify(expand));

        // 獨立算出這一對站的一般票成人三車廂價(直接讀 data/thsr_fare.json 自己再算一次,
        // 不呼叫頁面的 thsrFareDefaultTrio——判準不得跟實作同源,judgment.md 第七節第1條)。
        const fareData = JSON.parse(readFileSync(path.join(ROOT, 'data/thsr_fare.json'), 'utf8'));
        const nameToId = Object.fromEntries(Object.entries(fareData.stations).map(([id, n]) => [n, id]));
        const oid = nameToId['台北'], did = nameToId[rows[0].dest];
        const pairKey = oid < did ? `${oid}|${did}` : `${did}|${oid}`;
        const list = fareData.fares[pairKey] || [];
        // 頁面用 i18nNumber(price) = Intl.NumberFormat(I18N_LANG).format(price) 千分位分隔(NT$1,490,
        // 不是 NT$1490)——這裡直接呼叫同一個瀏覽器標準 API(不是呼叫頁面的 i18nNumber 包裝函式本身)
        // 獨立重算,openPage 預設 lang='zh-TW',故釘死同一語系,不是同源判準。
        const expectPrice = cc => { const f = list.find(x => x.ticketType === 1 && x.fareClass === 1 && x.cabinClass === cc); return f ? `NT$${new Intl.NumberFormat('zh-TW').format(f.price)}` : undefined; };
        if (expand) {
          const byLabel = Object.fromEntries(expand.rows.map(r => [r.k, r.v]));
          ok(`D2c[${engineName}] 標準座價格與獨立試算相符`, byLabel['標準座'] === expectPrice(1), `got=${byLabel['標準座']} expect=${expectPrice(1)}`);
          ok(`D2d[${engineName}] 商務座價格與獨立試算相符`, byLabel['商務座'] === expectPrice(2), `got=${byLabel['商務座']} expect=${expectPrice(2)}`);
          ok(`D2e[${engineName}] 自由座價格與獨立試算相符`, byLabel['自由座'] === expectPrice(3), `got=${byLabel['自由座']} expect=${expectPrice(3)}`);
          ok(`D2f[${engineName}] 預設只顯示 3 種車廂,不含其他票種`, expand.rows.length === 3, JSON.stringify(expand.rows));
          ok(`D2g[${engineName}] 有「其他票種」按鈕(8 組扣掉預設 3 組還有 5 組)`, expand.hasMore === (list.length > 3));
        }
        if (expand && expand.hasMore) {
          await page.click(`${rowSel} + .fareExpand .fareMore`);
          await page.waitForTimeout(150);
          const otherCount = await page.evaluate(sel => document.querySelectorAll(sel + ' + .fareExpand .fareOther .fareRow').length, rowSel);
          ok(`D2h[${engineName}] 點「其他票種」後展開 ${list.length - 3} 組(總 ${list.length} 組扣掉預設 3 組)`, otherCount === list.length - 3, `got=${otherCount}`);
        }
        // 收合:再點一次票價鈕,展開層應消失。
        await page.click(`${rowSel} .fareBtn`);
        await page.waitForTimeout(150);
        const after = await page.evaluate(sel => !!document.querySelector(sel + ' + .fareExpand'), rowSel);
        ok(`D2i[${engineName}] 再點一次「票價」收合,展開層消失`, after === false);
        ok(`D2j[${engineName}] 全程零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }

      // D3:手機四寬度——比照 verify_thsr_freeseat.mjs 的 D5,量看板本身不因徽章/票價鈕橫向溢出。
      for (const width of [360, 375, 414, 768]) {
        const mockTable = { [`${rows[0].train}|台北|${rows[0].dest}`]: { std: 'X', biz: 'X' } };
        const { ctx, page, consoleErrors } = await openPage(browser, { viewport: { width, height: 800 }, mockTable });
        await page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(page);
        const geo = await page.evaluate(() => {
          const board = document.getElementById('board');
          const r = board.getBoundingClientRect();
          return { scrollW: board.scrollWidth, clientW: board.clientWidth, right: r.right, viewportW: window.innerWidth };
        });
        ok(`D3[${engineName} ${width}px] 看板本身不橫向溢出(scrollWidth<=clientWidth+1)`, geo.scrollW <= geo.clientW + 1, JSON.stringify(geo));
        ok(`D3[${engineName} ${width}px] 右緣沒有超出視窗`, geo.right <= geo.viewportW + 1, JSON.stringify(geo));
        ok(`D3[${engineName} ${width}px] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }

      await browser.close();
    }

    // D4:大/特大字級——只跑 chromium,驗證徽章/票價鈕確實整組隱藏(單元 A 的刻意範圍縮減:
    // 這一列在這兩階是全站最容易撞版的地方,決定直接收起不硬擠 grid-area,見實作筆記-A;
    // 這裡驗的是「隱藏規則有生效」,不是驗那兩階排版本身)。
    {
      console.log('  -- D4 大/特大字級隱藏(chromium)--');
      const browser = await chromium.launch();
      const probe = await openPage(browser);
      const rows = await pickThsrRows(probe.page, '台北', 1);
      await probe.ctx.close();
      for (const fs of rows.length ? ['large', 'xlarge'] : []) {
        const mockTable = { [`${rows[0].train}|台北|${rows[0].dest}`]: { std: 'O', biz: 'O' } };
        const { ctx, page, consoleErrors } = await openPage(browser, { mockTable });
        await page.evaluate(v => { document.documentElement.dataset.fs = v; }, fs);
        await page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(page);
        const visible = await page.evaluate(() => {
          const tag = document.querySelector('.seatTag'), btn = document.querySelector('.board .row .fareBtn');
          const vis = el => el && getComputedStyle(el).display !== 'none';
          return { tagVisible: vis(tag), btnVisible: vis(btn), tagExists: !!tag, btnExists: !!btn };
        });
        ok(`D4[${fs}] 徽章 DOM 仍在(不是沒渲染)但 display:none`, visible.tagExists && !visible.tagVisible, JSON.stringify(visible));
        ok(`D4[${fs}] 票價鈕 DOM 仍在但 display:none`, visible.btnExists && !visible.btnVisible, JSON.stringify(visible));
        ok(`D4[${fs}] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }
      await browser.close();
    }

    // D5:零回歸——直接子行程重跑既有的權威驗收腳本(同 verify_thsr_freeseat.mjs 的 D6 慣例),
    // 證明改動共用的 schedBoardListHtml/renderBoardBody/openBoard/closeBoard 沒有波及其他系統。
    console.log('  -- D5 零回歸(重跑既有驗收腳本)--');
    for (const script of ['verify_punctual.mjs', 'verify_my_trains.mjs']) {
      try {
        const out = execSync(`node "${path.join(ROOT, 'scripts', script)}" "${BASE}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
        const lastLines = out.trim().split('\n').slice(-3).join(' / ');
        ok(`D5 ${script} 全綠(零回歸)`, !/FAIL/.test(out), lastLines);
      } catch (e) {
        const out = String((e && e.stdout) || (e && e.message) || e);
        ok(`D5 ${script} 全綠(零回歸)`, false, out.trim().split('\n').slice(-5).join(' / '));
      }
    }
  }

  dev.kill('SIGTERM');
}

// ══════════════════════════ R:真上游(--real 才跑) ══════════════════════════
if (SECTIONS.has('R')) {
  console.log('\n===== R 真上游:直接呼叫 worker 的 default.fetch(request, env),驗收條件1 =====');
  function readDotEnv() {
    const out = {};
    for (const raw of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return out;
  }
  const env = readDotEnv();
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) {
    ok('R0 .env 有 TDX 憑證', false, '缺 TDX_CLIENT_ID/TDX_CLIENT_SECRET,無法跑真上游測試');
  } else {
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
    const worker = (await import('../worker.js')).default;
    const t0 = Date.now();
    const res = await worker.fetch(new Request('https://railisland.tw/api/thsr-seat'), env);
    const elapsed = Date.now() - t0;
    ok('R1 走完整路由(含 /api/thsr-seat 的 else-if 註冊),真上游呼叫回 200', res.status === 200, `status=${res.status} 耗時=${elapsed}ms`);
    const body = await res.json().catch(() => null);
    const tableSize = body && body.table ? Object.keys(body.table).length : 0;
    ok('R2 回應形狀為 {at, table},table 非空(正常時段應有數百筆起訖配對)', !!(body && typeof body.at === 'string' && body.table && typeof body.table === 'object' && tableSize > 100), `tableSize=${tableSize}`);
    if (body && body.table) {
      const entries = Object.entries(body.table).slice(0, 2);
      console.log('  [R3] 前兩筆真實紀錄(驗收條件1,實際貼在報告裡的就是這兩筆):');
      for (const [k, v] of entries) console.log(`         ${k} => ${JSON.stringify(v)}`);
      const dist = { O: 0, L: 0, X: 0 };
      for (const v of Object.values(body.table)) { if (v.std) dist[v.std]++; }
      console.log(`  [R4] 即時三態分布(即時抓取,佐證驗收條件2——逐值比對已由 B1d 用真實 fixture 做過):O=${dist.O} L=${dist.L} X=${dist.X}`);
      ok('R4 三態(O/L/X)在這次即時抓取中至少各出現一次', dist.O > 0 && dist.L > 0 && dist.X > 0, JSON.stringify(dist));
    }
  }
}

console.log(`\n──────── ${fails ? `${fails}/${total} 條 FAIL` : `全部 PASS(${total}/${total})`} ────────`);
process.exit(fails ? 1 : 0);

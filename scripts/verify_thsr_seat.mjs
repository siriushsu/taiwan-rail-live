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
        // 設計第二版:狀態不再是徽章框,是副列 .brow-sub 左邊的一段字,狀態走 data-s(四態)。
        const badges = await page.evaluate(trains => trains.map(no => {
          const row = document.querySelector(`.row[data-no="${no}"]`);
          const sub = row && row.nextElementSibling;
          const tag = sub && sub.classList.contains('brow-sub') ? sub.querySelector('.seatTag') : null;
          return tag ? { s: tag.dataset.s, text: tag.textContent, title: tag.title } : null;
        }), [rows[0].train, rows[1].train, rows[2].train]);
        ok(`D1a[${engineName}] O 態:data-s=avail,文字為「對號座 有位」`, !!badges[0] && badges[0].s === 'avail' && badges[0].text === '對號座 有位', JSON.stringify(badges[0]));
        ok(`D1b[${engineName}] L 態:data-s=limited,文字為「對號座 剩不多」`, !!badges[1] && badges[1].s === 'limited' && badges[1].text === '對號座 剩不多', JSON.stringify(badges[1]));
        ok(`D1c[${engineName}] X 態:data-s=soldout,文字為「對號座 售完」`, !!badges[2] && badges[2].s === 'soldout' && badges[2].text === '對號座 售完', JSON.stringify(badges[2]));
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
        const before = await page.evaluate(() => !!document.querySelector('.fare-page'));
        ok(`D2a[${engineName}] 開板當下票價子頁不存在`, before === false);
        // 🔴 設計第二版:票價不在列底下往下長,而是整個看板 body 換成子頁(卡頭變「‹ ○○看板」)。
        //    先記下捲動位置,返回時要還原——這是子頁相對於展開層的主要好處之一。
        await page.evaluate(() => { document.getElementById('board').scrollTop = 120; });
        await page.click(`${rowSel} + .brow-sub .fareBtn`);
        await page.waitForTimeout(150);
        const expand = await page.evaluate(() => {
          const el = document.querySelector('.fare-page');
          if (!el) return null;
          return {
            no: el.querySelector('.fp-no')?.textContent,
            back: !!document.getElementById('fareBack'),
            listRows: document.querySelectorAll('.board .row[data-no]').length,
            rows: [...el.querySelectorAll('.fp-main .fareRow')].map(r => ({ k: r.querySelector('.fareK')?.textContent, v: r.querySelector('.fareV')?.textContent })),
            groups: el.querySelectorAll('.fp-group').length,
            otherRows: el.querySelectorAll('.fp-group .fareRow').length,
          };
        });
        ok(`D2b[${engineName}] 點「票價」後票價子頁出現,而且是取代看板列不是插在列底下`,
          !!expand && expand.listRows === 0 && expand.back, JSON.stringify(expand));
        ok(`D2b2[${engineName}] 子頁標出的是按下去的那一班車`, !!expand && expand.no === String(rows[0].train), JSON.stringify(expand && expand.no));
        // 🔴 返回鈕住在 sticky 卡頭裡、不在 .fare-page 裡:選擇器只要少寫這一層,症狀是
        //    「一顆沒有樣式的 UA 預設按鈕」——看起來像功能還在,其實顏色、尺寸、‹ 全沒了。
        //    所以不驗「存在」,驗它真的吃到自己的樣式(量的是渲染值,不是宣告值)。
        const backStyle = await page.evaluate(() => {
          const el = document.getElementById('fareBack');
          if (!el) return null;
          const cs = getComputedStyle(el), be = getComputedStyle(el, '::before');
          return { h: Math.round(el.getBoundingClientRect().height), color: cs.color, before: be.content };
        });
        ok(`D2b3[${engineName}] 返回鈕吃到自己的樣式:淺色字、32px 高、帶「‹」`,
          !!backStyle && backStyle.h >= 32 && backStyle.before.includes('‹') && backStyle.color !== 'rgb(0, 0, 0)',
          JSON.stringify(backStyle));

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
          ok(`D2f[${engineName}] 主區只放一般票成人那 3 種車廂`, expand.rows.length === 3, JSON.stringify(expand.rows));
          // 🔴 其他票種不再藏在第二顆按鈕後面:子頁有縱向空間,全部列出來。分子分母都具名,
          //    否則「有幾組沒列出來」會無聲縮水(judgment.md 第七節第 6 條)。
          ok(`D2g[${engineName}] 其他票種全列,不再需要第二顆展開鈕(總 ${list.length} 組扣掉主區 3 組)`,
            expand.otherRows === list.length - 3 && expand.groups > 0, `otherRows=${expand.otherRows} groups=${expand.groups} expect=${list.length - 3}`);
        }
        // 返回:點「‹ ○○看板」回到看板,而且還原剛才的捲動位置。
        await page.click('#fareBack');
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => ({
          page: !!document.querySelector('.fare-page'),
          listRows: document.querySelectorAll('.board .row[data-no]').length,
          top: document.getElementById('board').scrollTop,
        }));
        ok(`D2i[${engineName}] 點「‹ 看板」返回,子頁消失、班次列回來`, after.page === false && after.listRows > 0, JSON.stringify(after));
        ok(`D2i2[${engineName}] 返回還原進入子頁前的捲動位置(不是丟回最上面)`, after.top === 120, JSON.stringify(after));
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

    // D4:大/特大字級——設計第二版把「整組 display:none」換掉了:大照常排副列,特大收進既有的
    // 「›」展開器(點開就看得到)。所以這裡驗的是「兩階都還構得到」,不是「有沒有被藏起來」。
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
        const vis = await page.evaluate(no => {
          const row = document.querySelector(`.row[data-no="${no}"]`);
          const sub = row && row.nextElementSibling;
          const seen = el => !!(el && el.getClientRects().length);
          return {
            hasSub: !!(sub && sub.classList.contains('brow-sub')),
            seatSeen: seen(sub && sub.querySelector('.seatTag')),
            fareSeen: seen(sub && sub.querySelector('.fareBtn')),
            moreSeen: seen(row && row.querySelector('.rmore')),
          };
        }, rows[0].train);
        ok(`D4[${fs}] 副列的 DOM 一直都在(不是靠不渲染來省版面)`, vis.hasSub, JSON.stringify(vis));
        if (fs === 'large') {
          ok(`D4[${fs}] 大字級照常排副列:座位與票價都看得到`, vis.seatSeen && vis.fareSeen, JSON.stringify(vis));
        } else {
          // 特大:預設收起來,但一定要有可達路徑——就是那顆只在特大出現的「›」。
          ok(`D4[${fs}] 特大預設收起副列,但「›」展開器在`, !vis.seatSeen && !vis.fareSeen && vis.moreSeen, JSON.stringify(vis));
          await page.click(`.row[data-no="${rows[0].train}"] .rmore`);
          await page.waitForTimeout(150);
          const opened = await page.evaluate(no => {
            const sub = document.querySelector(`.row[data-no="${no}"]`).nextElementSibling;
            const box = el => { const r = el && el.getBoundingClientRect(); return r ? Math.round(r.height) : 0; };
            return { seat: box(sub.querySelector('.seatTag')), fare: box(sub.querySelector('.fareBtn')) };
          }, rows[0].train);
          ok(`D4[${fs}] 點「›」之後座位與票價都出現,而且是 44px 級的觸控目標`,
            opened.seat >= 44 && opened.fare >= 44, JSON.stringify(opened));
        }
        ok(`D4[${fs}] 零 console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
        await ctx.close();
      }
      await browser.close();
    }

    // D6:暗色主題——這一批加的兩樣東西都落在「暗色會另外上漆」的地方,而暗色看板還多一層
    // 方向頁籤機制(night-board.js 的 .night-group-hidden):
    //   (a) 副列刻意做成 .row 的兄弟(列內加東西會動到三種字級的幾何),而 night-board.js 只認
    //       .row ⇒ 沒有 CSS 補位的話,選一個方向時另一個方向的座位/票價副列會獨自留在板上;
    //   (b) 返回鈕原本寫死 color:var(--paper),暗色把 --paper 翻成深色、night-theme.css 又把卡頭
    //       漆成深底 ⇒ 暗字暗底(而且尺寸、‹ 都還在,看起來完全正常)。
    // 兩條都量渲染結果、不量宣告值:(a) 量 getClientRects,(b) 直接截那顆鈕的像素量明暗跨度。
    {
      console.log('  -- D6 暗色主題(方向頁籤與返回鈕)--');
      const sharp = (await import('sharp')).default;
      // 「字看不看得見」:截那顆元件的像素,取最亮 5% 與最暗 5% 的明度差。字與底同色時整塊接近
      // 單色 ⇒ 跨度趨近 0。門檻取 90,落在實測兩態中間,而且亮色要用同一支量一次當對照。
      const inkSpread = async (page, selector) => {
        const box = await page.locator(selector).boundingBox();
        if (!box || box.width < 2 || box.height < 2) return null;
        const png = await page.screenshot({ clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        const ls = [];
        for (let i = 0; i < data.length; i += info.channels) ls.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        ls.sort((a, b) => a - b);
        const at = q => ls[Math.min(ls.length - 1, Math.floor(q * ls.length))];
        return Math.round(at(0.95) - at(0.05));
      };
      for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await engine.launch();
        const probe = await openPage(browser);
        const darkRows = await pickThsrRows(probe.page, '台北', 1);
        await probe.ctx.close();
        const mockTable = darkRows.length ? { [`${darkRows[0].train}|台北|${darkRows[0].dest}`]: { std: 'O', biz: 'L' } } : {};
        const { ctx, page, consoleErrors } = await openPage(browser, { mockTable });
        await page.evaluate(() => state._setAppearance('dark'));
        await page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(page);
        await page.evaluate(() => renderBoard());
        await page.waitForTimeout(150);

        const readSubs = () => page.evaluate(() => {
          const seen = el => !!(el && el.getClientRects().length);
          const subs = [...document.querySelectorAll('#board > .brow-sub')];
          return {
            theme: document.documentElement.dataset.theme,
            tabs: document.querySelectorAll('#board .night-directions button').length,
            subs: subs.length,
            hiddenRows: document.querySelectorAll('#board > .row.night-group-hidden').length,
            hiddenSubs: subs.filter(x => !seen(x)).length,
            orphans: subs.filter(x => seen(x) && !seen(x.previousElementSibling)).length, // 副列看得見、它的列被藏起來
          };
        });

        const d0 = await readSubs();
        // 前提先立住,否則下面的「零孤兒」是恆真的空話(judgment.md 第七節第 5 條)。
        ok(`D6a[${engineName}] 暗色高鐵板真的長出方向頁籤,而且真的藏了另一個方向的列`,
          d0.theme === 'dark' && d0.tabs >= 2 && d0.hiddenRows > 0 && d0.subs > 0, JSON.stringify(d0));
        ok(`D6b[${engineName}] 被藏起來的那幾列,副列也跟著不見(正向對照:確實有副列被藏)`,
          d0.orphans === 0 && d0.hiddenSubs > 0, JSON.stringify(d0));
        // 互動之後再量一次(只驗乾淨初始態等於沒驗,judgment.md 第七節第 4 條)。
        await page.click('#board .night-directions button:nth-child(2)');
        await page.waitForTimeout(150);
        const d1 = await readSubs();
        ok(`D6c[${engineName}] 切到第二個方向之後仍然零孤兒副列`,
          d1.orphans === 0 && d1.hiddenSubs > 0 && d1.hiddenRows > 0, JSON.stringify(d1));

        // 返回鈕:在還看得見的那個方向挑一顆票價鈕進子頁,量暗色下那顆鈕的字看不看得見。
        const opened = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('#board > .brow-sub .fareBtn')].find(b => b.getClientRects().length);
          if (!btn) return false; btn.click(); return true;
        });
        await page.waitForTimeout(200);
        const backCount = await page.locator('#fareBack').count();
        ok(`D6d[${engineName}] 暗色下點得到票價鈕,子頁與返回鈕都出來`, opened && backCount === 1, `opened=${opened} back=${backCount}`);
        const darkSpread = backCount === 1 ? await inkSpread(page, '#fareBack') : null;
        // 🔴 切暗色會把 MapLibre 的樣式整包換掉,在途的圖磚請求跟著被 abort ⇒ chromium 把
        //    「AbortError: The user aborted a request.」當 console.error 吐出來(webkit 不吐)。
        //    這是切主題本身既有的行為,不是這一批的東西——探針實證:全程不開任何看板、只切一次
        //    暗色就重現,而本批對 index.html 的改動全部住在高鐵看板副列/票價子頁與公車站牌 sheet
        //    裡,不開就跑不到;同一支探針「不切主題」的對照組是 0 筆。來源印出來是 maplibre-gl.js。
        //    只擋這一句,其他 console.error 照樣算數(全擋等於把這條判準的牙拔掉)。
        const darkErrors = consoleErrors.filter(x => !/AbortError/.test(x));
        ok(`D6g[${engineName}] 暗色全程零 console error(切主題造成的 MapLibre 圖磚 abort 除外)`, darkErrors.length === 0, darkErrors.join(' | '));
        await ctx.close();

        // 亮色對照另開一頁,不在同一頁按鈕切主題:切主題會重建底圖樣式、把在途的圖磚請求
        // abort 掉(chromium 實測吐 AbortError,webkit 不吐)——那是測試自己製造的雜訊,
        // 拿它去污染「零 console error」等於把判準的牙拔掉。另開一頁也更接近使用者實況
        // (亮色是從開頁就亮色,不是暗色頁重新上漆)。
        const lit = await openPage(browser, { mockTable });
        await lit.page.evaluate(name => openBoard({ name, sys: 'thsr_sched' }), '台北');
        await waitThsrLoaded(lit.page);
        const litOpened = await lit.page.evaluate(() => {
          const btn = [...document.querySelectorAll('#board > .brow-sub .fareBtn')].find(b => b.getClientRects().length);
          if (!btn) return false; btn.click(); return true;
        });
        await lit.page.waitForTimeout(200);
        const lightSpread = litOpened && (await lit.page.locator('#fareBack').count()) === 1 ? await inkSpread(lit.page, '#fareBack') : null;
        await lit.ctx.close();

        ok(`D6e[${engineName}] 返回鈕的字在暗色也看得見(門檻 90)`, darkSpread !== null && darkSpread >= 90, `dark=${darkSpread} light=${lightSpread}`);
        ok(`D6f[${engineName}] 亮色對照:同一顆鈕在亮色本來就看得見`, lightSpread !== null && lightSpread >= 90, `light=${lightSpread}`);
        await browser.close();
      }
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

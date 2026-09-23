// 台鐵即時動態「上游刷新去重」的守門人(2026-09-23)。
//
// traLive 把正在進行的 TDX 刷新存在模組層(traLiveInflight),讓同一分鐘的跟車卡 cron、等站卡 cron、
// 邊緣快取剛失效時湧入的訪客共搭一發——這是省 TDX 點數的刻意設計,不能拿掉。但搭便車等的是
// 【別的 request 發起的 I/O】:發起者被取消時 I/O 跟著被取消、promise 永遠不 settle,舊寫法的
// finally 也永遠不跑,之後這個 isolate 每一次刷新都陪它卡到 15 分鐘(同一晚北捷 trtcLedgerModel
// 就是這樣讓 cron 每發跑滿 15 分鐘被 exceededWallTime 砍掉)。
//
// 這支量的事(時間用可控的假時鐘,「被取消的 I/O」用永不 resolve 的 fetch 模擬):
//   C1–C3 兩道上限的關係:放掉門檻 ≥ mem 週期(卡住時也不多打 TDX)、等待上限 < 放掉門檻、
//         等待上限要替 cron 留處理時間(≤ 最小的那輪預算 − 10 秒)。
//   T1 去重仍在:兩個 request 同時要刷新,TDX 只打一次、兩邊拿到的都是新的那份(TDX 呼叫量不准增加)。
//   T2 超齡放掉:一發卡住的刷新滿放掉門檻之後,下一個 request 自己重刷並拿到新資料。
//   T3 有限等待:搭便車的人最多等到那一發滿等待上限,就回舊值,而且自己不多打 TDX。
//   T4 晚到不清新:被放掉的舊那發晚到結束時,不可以把接手的新那發清掉(否則下一個人又多打一次)。
//   T5 卡住時不多打:上游卡住的那一個 mem 週期裡,之後進來的人一律立刻回舊值、TDX 一發都不多打;
//      滿放掉門檻才重刷一次。這條是「TDX 呼叫量不准增加」在上游卡住時的樣子(09-24 複審指出兩道上限
//      若相同,上游卡住時會變成每 20 秒重打一次)。
//
// 跑法:node scripts/verify_tra_live_inflight.mjs(不需要伺服器、不打任何上游,約 3 秒)
let nowMs = 1_800_000_000_000;
Date.now = () => nowMs;
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

let apiCalls = 0, seq = 0;
let apiMode = 'ok'; // 'ok' | 'hang' | { delayMs, status }
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'fake', expires_in: 86400 }), { status: 200 });
  }
  if (u.includes('TrainLiveBoard')) {
    apiCalls++;
    const mode = apiMode, id = ++seq;
    if (mode === 'hang') return new Promise(() => {}); // 發起者被取消後,它的 I/O 在等待者眼裡就是這樣
    if (mode !== 'ok') await new Promise(r => setTimeout(r, mode.delayMs));
    if (mode !== 'ok' && mode.status && mode.status !== 200) return new Response('upstream error', { status: mode.status });
    return new Response(JSON.stringify({ UpdateTime: `U${id}`,
      TrainLiveBoards: [{ TrainNo: '123', DelayTime: 0, StationID: '1000', TrainStationStatus: 1 }] }), { status: 200 });
  }
  throw new Error('未預期的 fetch 目標:' + u);
};

const { _la: api, _tw: tw } = await import('../worker.js');
const WAIT = api.TRA_LIVE_WAIT_MAX_MS, RECLAIM = api.TRA_LIVE_RECLAIM_MS, MEM_TTL = api.TRA_LIVE_MEM_TTL_MS;
const env = { TDX_CLIENT_ID: 'x', TDX_CLIENT_SECRET: 'y' };
const ctx = { waitUntil() {} };
const call = () => api.traLive(new Request('https://verify.invalid/api/tra-live?_src=cron'), env, ctx)
  .then(async r => ({ status: r.status, body: await r.json() }));

function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(v => ({ ok: true, v }), e => ({ ok: false, err: e })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, timeout: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// traLive 在打 TDX 之前還有幾個 await(邊緣快取、token):發起者要先真的把 TDX 那發送出去,
// 才能切換假上游的行為或推時鐘——不然切換會搶在它前面,量到的是另一種情境。
async function untilApiCalls(n, ms = 2000) {
  const end = performance.now() + ms;
  while (apiCalls < n && performance.now() < end) await sleep(2);
  return apiCalls >= n;
}
let failed = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}
const why = r => r.ok ? '' : (r.timeout ? '逾時(陪一個永遠不回來的 promise 卡住)' : String(r.err));

check('兩道上限與 mem 週期有導出給測試', [WAIT, RECLAIM, MEM_TTL].every(v => Number.isFinite(v) && v > 0),
  `WAIT=${WAIT} RECLAIM=${RECLAIM} MEM_TTL=${MEM_TTL}`);
check('C1 放掉門檻 ≥ mem 週期(上游卡住時,每個 isolate 仍最多一個 mem 週期打一次 TDX)', RECLAIM >= MEM_TTL,
  `RECLAIM=${RECLAIM} MEM_TTL=${MEM_TTL}`);
check('C2 等待上限 < 放掉門檻', WAIT < RECLAIM, `WAIT=${WAIT} RECLAIM=${RECLAIM}`);
const cronBudget = Math.min(tw.TW_TICK_BUDGET_MS, api.LA_TICK_BUDGET_MS);
check('C3 等待上限替 cron 留 ≥10 秒處理列(≤ 等站卡／跟車卡最小的那輪預算 − 10 秒)',
  Number.isFinite(cronBudget) && WAIT <= cronBudget - 10e3,
  `WAIT=${WAIT} TW=${tw.TW_TICK_BUDGET_MS} LA=${api.LA_TICK_BUDGET_MS}`);

// T0 播種:先有一份成功的 mem,後面的「回舊值」才有東西可回。
nowMs += 100e3; apiMode = 'ok';
const r0 = await within(call(), 3000);
check('T0 播種成功', r0.ok && r0.v.status === 200 && r0.v.body.at === 'U1', r0.ok ? `at=${r0.v.body.at}` : why(r0));

// T1 去重(正向對照):兩個 request 同時要刷新,TDX 只打一次、兩邊拿到同一份。
nowMs += 100e3; apiMode = { delayMs: 200 };
let before = apiCalls;
const r1 = await within(Promise.all([call(), call()]), 3000);
check('T1 同時兩個刷新只打一次 TDX(去重仍在),兩邊拿到的都是新的那份',
  r1.ok && apiCalls - before === 1 && r1.v[0].body.at === `U${seq}` && r1.v[1].body.at === `U${seq}` && r1.v[0].status === 200,
  r1.ok ? `TDX +${apiCalls - before}、at=${r1.v[0].body.at}/${r1.v[1].body.at}` : why(r1));

// T2 超齡放掉:發起者的 I/O 永遠不回來;滿放掉門檻之後進來的 request 必須自己重刷、拿到新資料。
nowMs += 100e3; apiMode = 'hang';
before = apiCalls;
call(); // 被取消的那個 request:不 await
check('T2 前置:卡住的那發已送出', await untilApiCalls(before + 1));
apiMode = 'ok'; nowMs += RECLAIM;
const r2 = await within(call(), 3000);
check('T2 卡住的刷新滿放掉門檻後,下一個 request 自己重刷並拿到新資料',
  r2.ok && r2.v.status === 200 && apiCalls - before === 2 && r2.v.body.at === `U${seq}`,
  r2.ok ? `TDX +${apiCalls - before}、at=${r2.v.body.at}` : why(r2));

// T3 有限等待:搭便車的人,最多等到那一發滿等待上限就回舊值;期間不可以自己多打 TDX。
nowMs += 100e3; apiMode = 'hang';
before = apiCalls;
call(); // 又一個被取消的發起者
check('T3 前置:卡住的那發已送出', await untilApiCalls(before + 1));
nowMs += WAIT - 300; // 搭便車的人進來時,那一發離等待上限只剩 300 ms(真實時間)
const t3 = performance.now();
const r3 = await within(call(), 3000);
const t3ms = Math.round(performance.now() - t3);
check('T3 搭便車最多等到等待上限就回舊值,不陪卡死、不多打 TDX',
  r3.ok && r3.v.status === 200 && r2.ok && r3.v.body.at === r2.v.body.at && apiCalls - before === 1 && t3ms < 2000,
  r3.ok ? `${t3ms} ms、TDX +${apiCalls - before}、at=${r3.v.body.at}` : why(r3));

// T4 晚到不清新:E 被放掉之後才以錯誤結束,不可清掉 F 的那發;G 在 F 進行中進來要搭 F,不可多打 TDX。
nowMs += 100e3; apiMode = { delayMs: 600, status: 500 };
before = apiCalls;
const e = within(call(), 5000);           // E:600 ms 後上游回 500
check('T4 前置:E 已送出', await untilApiCalls(before + 1));
nowMs += RECLAIM; apiMode = { delayMs: 1500 };
const f = within(call(), 5000);           // F:E 已超過放掉門檻 ⇒ 放掉 E、自己重刷(1.5 秒)
await untilApiCalls(before + 2, 300);    // 給 F 走到 TDX 那一步的時間;沒重刷的話這裡等滿 300 ms 仍是 +1
const afterF = apiCalls - before;
await sleep(900);                          // E 已經以 500 結束(它的 finally 已經跑過)
const g = within(call(), 5000);           // G:F 還在進行、F 未超齡 ⇒ 搭 F
await untilApiCalls(before + 3, 300);    // 同上:G 若沒搭上 F、自己重刷,300 ms 內就會 +3
const afterG = apiCalls - before;
const [re, rf, rg] = await Promise.all([e, f, g]);
check('T4 超齡的那發被放掉時,接手的人立刻自己重刷', afterF === 2, `TDX +${afterF}`);
check('T4 被放掉的那發晚到結束,不清掉接手那發(G 搭便車、不多打 TDX)', afterG === 2, `TDX +${afterG}`);
check('T4 F、G 拿到同一份新資料,E 回舊值',
  rf.ok && rg.ok && re.ok && rf.v.body.at === `U${seq}` && rg.v.body.at === rf.v.body.at && re.v.status === 200 && re.v.body.at !== rf.v.body.at,
  [re, rf, rg].map(r => r.ok ? r.v.body.at : why(r)).join(' / '));

// T5 卡住時不多打:上游卡住,這一個 mem 週期裡之後進來的人(都已過等待上限)一律立刻回舊值、TDX 一發都不多打;
//    滿放掉門檻才重刷一次。
nowMs += 100e3; apiMode = 'hang';
before = apiCalls;
const t5start = nowMs;
call(); // 卡住的發起者
check('T5 前置:卡住的那發已送出', await untilApiCalls(before + 1));
const t5ages = [WAIT + 1e3, Math.round((WAIT + MEM_TTL) / 2), MEM_TTL - 1e3];
const t5res = [];
for (const age of t5ages) {
  nowMs = t5start + age;
  const t = performance.now();
  const r = await within(call(), 3000);
  t5res.push({ age, ms: Math.round(performance.now() - t), r });
}
check('T5 上游卡住的那一個 mem 週期裡,之後進來的人都立刻回舊值、TDX 一發都不多打',
  t5res.every(x => x.r.ok && x.r.v.status === 200 && x.ms < 1000) && apiCalls - before === 1,
  `TDX +${apiCalls - before};` + t5res.map(x => `${x.age / 1e3}s→${x.r.ok ? x.r.v.body.at : why(x.r)}(${x.ms}ms)`).join(' '));
apiMode = 'ok'; nowMs = t5start + RECLAIM;
const r5 = await within(call(), 3000);
check('T5 滿放掉門檻才重刷一次,並拿到新資料',
  r5.ok && r5.v.status === 200 && apiCalls - before === 2 && r5.v.body.at === `U${seq}`,
  r5.ok ? `TDX +${apiCalls - before}、at=${r5.v.body.at}` : why(r5));

console.log(failed ? `\n${failed} 項未過` : '\n全部通過');
process.exit(failed ? 1 : 0);

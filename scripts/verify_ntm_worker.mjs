// 真正呼叫 Worker 路由，mock 官方上游、Cache API、Durable Object 與時鐘；不打真實服務。
// 守查詢頻率的上限（全站合計）：淡海、安坑約每 55 秒一次、環狀線約每 60 秒一次。
// 調短或調長都會在這裡紅——頻率要改，先確認上限，再改這支的期望值。
// 第 1–9 節：per-colo 把關（集中出口不可用時的退路；env 沒有 NTM_POLLER 時走的就是它）。
// 第 10–21 節：集中出口（NtmPoller）——多個 colo 同時或先後請求，官網全站只被打一次；DO 重置、一時拿不到或掛住時
// 不准緊接著直打，一直拿不到才由各 colo 自己把關。
// 突變自驗：直接跑本檔，控制組（原始碼）全綠之後，會以 NTM_WORKER_MUTATION=<名稱> 逐一另開行程重跑本檔，
// 每個突變都必須被指定的那一節擋下（擋在別節、或根本沒擋下，都算本檔失敗）。
// 單獨跑一個突變：NTM_WORKER_MUTATION=doGap node scripts/verify_ntm_worker.mjs（預期 exit 1）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// find 在 worker.js 原始碼裡必須恰好出現 n 次；expect＝應該擋下它的那一節的判準字樣。
const MUTANTS = {
  doGap: { find: '    else if (!s || Date.now() - s.tried >= gap) {', replace: '    else if (true) {', n: 1, expect: '〔11〕' },
  noJoin: { find: 'if (s && s.inflight && Date.now() - s.tried < gap) await s.inflight;', replace: 'if (false) await s.inflight;', n: 1, expect: '〔10〕' },
  noPersist: { find: "await this.storage.put('ntm:' + sys, { tried, data: prev });", replace: '', n: 1, expect: '〔13〕' },
  noDeny: { find: 'if (colo && TRTC_POLLER_DENY_COLO.has(colo)) return Response.json({ denied: colo });', replace: '', n: 1, expect: '〔14〕' },
  fallbackUnthrottled: { find: 'if (!mem || Date.now() - mem.tried >= gap) {', replace: 'if (true) {', n: 2, expect: 'ankeng 不滿 55 秒不准再打上游' },
  fallbackBurst: { find: 'if (!mem || Date.now() - mem.tried >= gap) { // 重看之後仍過期', replace: 'if (true) {', n: 1, expect: '〔15〕' },
  noSeed: { find: '        ntmLiveMem.set(sys, mem);\n        await putEdge(mem.data, mem.tried);\n', replace: '        await putEdge(mem.data, mem.tried);\n', n: 1, expect: '〔13〕' },
  noLedger: { find: 'env.NTM_UPSTREAM.writeDataPoint(', replace: '(() => {})(', n: 1, expect: '〔14〕' },
  noHold: { find: "if (via.off !== 'unbound' && !via.off.startsWith('denied:') && !downBefore) {", replace: 'if (false) {', n: 1, expect: '〔13〕' },
  holdForever: { find: ' && !downBefore) {', replace: ') {', n: 1, expect: '〔15〕' },
  claimForgetsDown: { find: 'const claim = { data: prev, tried, down: true };', replace: 'const claim = { data: prev, tried };', n: 1, expect: '〔15〕' },
  noEdgeRecheck: { find: '      const again = await fromEdge();\n      if (again) return again;\n', replace: '', n: 1, expect: '〔16〕' },
  ignoreAskedGap: { find: 'Number.isFinite(asked) ? Math.min(asked, 3600e3) : 0', replace: '0', n: 1, expect: '〔17〕' },
  askedGapLoosens: { find: 'const gap = Math.max(NTM_LIVE_MIN_GAP_MS.get(sys), ', replace: 'const gap = Math.min(NTM_LIVE_MIN_GAP_MS.get(sys), ', n: 1, expect: '〔17〕' },
  downNeverExpires: { find: ' && tried - mem.tried < 2 * gap;', replace: ';', n: 1, expect: '〔18〕' },
  downSticky: { find: '      } else if (cur.down) ntmLiveMem.set(sys, mem);\n', replace: '      }\n', n: 1, expect: '〔18〕' },
  // 撐一輪沿用舊時間＝撐 0 秒：第 15 節先擋（舊時間讓「連續」的窗提早關上）；撐太短（5 秒）只有第 18 節 (c) 擋得到。
  holdKeepsOldTried: { find: '          mem = { data: prev, tried, down: true };', replace: '          mem = { data: prev, tried: mem ? mem.tried : tried, down: true };', n: 1, expect: '〔15〕' },
  holdTooShort: { find: '          mem = { data: prev, tried, down: true };', replace: '          mem = { data: prev, tried: tried - 50e3, down: true };', n: 1, expect: '〔18〕' },
  noPollerTimeout: { find: 'return await Promise.race([ntmPollerFrame(env, sys, gap), timeout]);', replace: 'return await ntmPollerFrame(env, sys, gap);', n: 1, expect: '〔19〕' },
  edgeOnStale: { find: '        await putEdge(mem.data, mem.tried);\n      } else if (cur.down) ntmLiveMem.set(sys, mem);\n',
    replace: '      } else if (cur.down) ntmLiveMem.set(sys, mem);\n      await putEdge(mem.data, mem.tried);\n', n: 1, expect: '〔20〕' },
};
const MUTATION = process.env.NTM_WORKER_MUTATION || '';
let workerHref = new URL('../worker.js', import.meta.url).href;
if (MUTATION) {
  const m = MUTANTS[MUTATION];
  if (!m) { console.error('未知的突變：' + MUTATION); process.exit(3); }
  const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const n = src.split(m.find).length - 1;
  if (n !== m.n) { console.error(`突變 ${MUTATION} 對不上原始碼：預期 ${m.n} 處，實際 ${n} 處（先更新 MUTANTS）`); process.exit(3); }
  // 突變版放暫存目錄；相對 import 改指回 repo 的絕對路徑，其餘模組照用原檔。
  const root = new URL('../', import.meta.url).href;
  const code = src.split(m.find).join(m.replace).replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])\.\//g, `$1$2${root}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntm-mutant-'));
  fs.writeFileSync(path.join(dir, 'worker.mjs'), code);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  workerHref = pathToFileURL(path.join(dir, 'worker.mjs')).href;
  console.log(`MUTANT ${MUTATION}：已套用 ${n} 處`);
}
const loadWorker = tag => import(workerHref + '?' + tag);

const original={Date:globalThis.Date,fetch:globalThis.fetch,caches:globalThis.caches,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
let now=Date.parse('2026-10-05T02:30:00Z'),fail=false,empty=false,useEdge=false,hold=null,hang=false,upstreamDelay=0,lastInit=null,traceColo='NRT';
const count={danhai:0,ankeng:0,circular:0};
class ClockDate extends original.Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
globalThis.Date=ClockDate;
const edge=new Map();let puts=0;
// 刻意讓 Cache API 保留超齡回覆，模擬舊部署的長 TTL，驗 handler 自己仍會拒絕。
globalThis.caches={default:{match:async req=>useEdge?edge.get(req.url)?.clone():null,
  put:async(req,res)=>{puts++;edge.set(req.url,res.clone());}}};
// hold：上游慢（等放行才回）；hang：上游不回，只在 signal abort 時失敗；upstreamDelay：上游花掉的時間；empty：上游回空。
// cdn-cgi/trace 是 DO 量自己落點用的（不是官網），回 traceColo。
globalThis.fetch=async(input,init)=>{
  if(String(input)==='https://cloudflare.com/cdn-cgi/trace')return new Response(`fl=1\nh=cloudflare.com\ncolo=${traceColo}\n`);
  const m=String(input).match(/^https:\/\/trainstatus\.ntmetro\.com\.tw\/roadmap\/(ankeng|danhai|circular)_data\.php$/);
  assert(m,'只准打三支官網端點：'+input);
  count[m[1]]++;lastInit=init;
  if(hang)return new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted'))));
  if(hold)await hold;
  now+=upstreamDelay;
  if(fail)throw Error('fixture offline');
  return new Response(JSON.stringify(empty?{data:null}:{data:{gpsData:[{K02:{routeId:1,time:50,carNum:'212'}},{}]}}));
};
const flush=()=>new Promise(r=>setImmediate(r));
const until=async cond=>{for(let i=0;i<50&&!cond();i++)await flush();assert(cond(),'等不到預期狀態');};
try{
  // 同一支 worker.js 載入兩份＝同一個 colo 裡的兩個 isolate：記憶體各自一份，邊緣快取共用。
  const isolateA=(await loadWorker('ntm-proxy-contract')).default;
  const isolateB=(await loadWorker('ntm-proxy-isolate-b')).default;
  const waits=[];const ctx={waitUntil(p){waits.push(p);}};
  const caller=(w,host='railisland.test')=>sys=>w.fetch(new Request(`https://${host}/api/ntmetro-live?sys=`+sys),{},ctx);
  const call=caller(isolateA),callB=caller(isolateB);
  const cc=r=>r.headers.get('cache-control');

  // 1. 查詢頻率的上限（記憶體這一層）：淡海、安坑 55 秒，環狀線 60 秒。
  for(const [sys,gap] of [['ankeng',55],['danhai',55],['circular',60]]){
    const first=await call(sys),a=await first.json();
    assert.equal(first.status,200);assert.equal(count[sys],1);
    assert.match(cc(first),new RegExp('s-maxage='+gap+'(?:,|$)'));
    assert(!cc(first).includes('stale-while-revalidate'));
    assert.equal(first.headers.get('x-ntm-tried'),null,'內部標頭不外露');
    now+=(gap-1)*1000;const second=await call(sys),b=await second.json();
    assert.equal(count[sys],1,`${sys} 不滿 ${gap} 秒不准再打上游`);assert.equal(b.at,a.at,'快取不能改寫 at 續命');
    assert.match(cc(second),/s-maxage=1(?:,|$)/,'記憶體快取不能多續一輪');
    now+=1000;const c=await(await call(sys)).json();
    assert.equal(count[sys],2,`${sys} 滿 ${gap} 秒要換新一批`);assert.equal(Date.parse(c.at)-Date.parse(a.at),gap*1000);
  }

  // 2. 邊緣快取：另一個 isolate 也要吃到同一份，壽命從打上游的時間起算，只交剩下的秒數。
  useEdge=true;now+=55000;
  let prior=count.ankeng;const fresh=await(await call('ankeng')).json();assert.equal(count.ankeng,prior+1);
  now+=54000;const hit=await callB('ankeng');
  assert.equal(count.ankeng,prior+1,'另一個 isolate 要吃邊緣那份，不准自己再打一次');
  assert.equal((await hit.json()).at,fresh.at);
  assert.match(cc(hit),/s-maxage=1(?:,|$)/,'Cache API 命中也不能重送完整 TTL');
  assert.equal(hit.headers.get('x-ntm-tried'),null,'內部標頭不外露');
  now+=500;assert.match(cc(await callB('ankeng')),/s-maxage=0(?:,|$)/);
  now+=500;const expired=await(await callB('ankeng')).json();
  assert.equal(count.ankeng,prior+2,'邊緣還留著超齡的那份，也須重新取數');
  assert.equal(Date.parse(expired.at)-Date.parse(fresh.at),55000);

  // 3. 舊部署留下、沒有 x-ntm-tried 的邊緣快取一律略過。
  edge.set('https://railisland.tw/api/ntmetro-live?sys=danhai',new Response(JSON.stringify({at:new Date().toISOString(),src:{legacy:true}}),
    {headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, s-maxage=55'}}));
  prior=count.danhai;const legacy=await(await callB('danhai')).json();
  assert.equal(count.danhai,prior+1);assert.equal(legacy.src.legacy,undefined);

  // 4. 上游掛掉：失敗也算一次查詢，不准每個請求重打；回舊資料時 at 不變。
  now+=55000;fail=true;prior=count.ankeng;
  const stale=await(await callB('ankeng')).json();
  assert.equal(count.ankeng,prior+1);assert.equal(stale.at,expired.at,'斷線不能把舊資料變成剛取得');
  now+=20000;await call('ankeng');await callB('ankeng');
  assert.equal(count.ankeng,prior+1,'失敗後邊緣那份同樣擋住兩個 isolate');
  useEdge=false;now+=20000;await callB('ankeng');
  assert.equal(count.ankeng,prior+1,'失敗後記憶體也要等滿間隔，不准每個請求重打');
  now+=15000;await callB('ankeng');assert.equal(count.ankeng,prior+2);

  // 5. 沒有舊資料又失敗：回 src:null，同樣等滿間隔（環狀線 60 秒）才重試。
  useEdge=true;prior=count.circular;
  const missing=await(await callB('circular')).json();assert.equal(missing.src,null);assert.equal(count.circular,prior+1);
  now+=30000;await call('circular');assert.equal(count.circular,prior+1,'另一個 isolate 也吃失敗那份');
  now+=29000;const negative=await callB('circular');assert.equal(count.circular,prior+1);
  assert.match(cc(negative),/s-maxage=1(?:,|$)/,'負快取同樣只剩餘 1 秒');
  now+=1000;await callB('circular');assert.equal(count.circular,prior+2);

  // 6. 同時進來（上游還沒回來的那段）：同一個 isolate 與同 colo 的其他 isolate 都不准再打，先拿上一份；
  //    只有發起的那一發寫邊緣，先寫佔位、再寫結果。
  fail=false;useEdge=true;now+=61000;
  prior=count.danhai;const base=await(await call('danhai')).json();assert.equal(count.danhai,prior+1);
  now+=55000;let release;hold=new Promise(r=>{release=r;});const putsBefore=puts;
  const first6=call('danhai');await until(()=>count.danhai===prior+2);
  const othersP=[call('danhai'),callB('danhai'),call('danhai'),callB('danhai')];for(let i=0;i<10;i++)await flush();
  assert.equal(count.danhai,prior+2,'上游還沒回來時，同一個 isolate 與同 colo 的其他 isolate 都不准再打');
  const others=await Promise.all(othersP.map(p=>p.then(r=>r.json())));
  for(const o of others)assert.equal(o.at,base.at,'等上游的那段回上一份資料');
  assert.equal(puts-putsBefore,1,'打上游期間只寫一次佔位，其他請求不寫邊緣');
  release();hold=null;
  const fresh6=await(await first6).json();
  assert.equal(Date.parse(fresh6.at)-Date.parse(base.at),55000,'發起的那一發拿到新資料');
  assert.equal(puts-putsBefore,2,'結果寫回邊緣');
  assert.equal((await(await callB('danhai')).json()).at,fresh6.at,'之後其他 isolate 吃到新那份');
  assert.equal(count.danhai,prior+2);
  //    沒有邊緣快取（workers.dev）時，同一個 isolate 靠記憶體佔位擋住。
  useEdge=false;now+=55000;hold=new Promise(r=>{release=r;});prior=count.danhai;const puts6b=puts;
  const first6b=call('danhai');await until(()=>count.danhai===prior+1);
  const second6b=call('danhai');for(let i=0;i<10;i++)await flush();
  assert.equal(count.danhai,prior+1,'記憶體佔位擋住同一個 isolate 的後續請求');
  const o6b=await(await second6b).json();assert.equal(o6b.at,fresh6.at);
  assert.equal(puts-puts6b,1,'跟進來的請求不准寫邊緣（會拿舊資料蓋掉發起者剛寫的新資料）');
  release();hold=null;await first6b;

  // 7. 上游掛住：打上游要帶逾時（短於前端 12 秒的 abort），逾時也算一次；掛住期間其他請求不准再打；
  //    打上游的那段交給 waitUntil（發起的訪客斷線時 handler 會被取消，結果仍要寫回）。
  const timers=[];
  globalThis.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  globalThis.clearTimeout=id=>{if(timers[id-1])timers[id-1].fn=null;};
  try{
    useEdge=true;now+=56000;hang=true;prior=count.ankeng;waits.length=0;
    const ph=call('ankeng');await until(()=>count.ankeng===prior+1);
    assert(lastInit?.signal,'打上游要帶 signal');
    const live=timers.filter(t=>t.fn);
    assert(live.length===1&&live[0].ms>=3000&&live[0].ms<12000,'逾時要短於前端的 12 秒：'+live.map(t=>t.ms));
    assert(waits.length>=1,'打上游的那段要交給 waitUntil');
    now+=30000;await callB('ankeng');await call('ankeng');
    assert.equal(count.ankeng,prior+1,'上游掛住期間，其他請求不准再打');
    live[0].fn();
    const hung=await(await ph).json();await Promise.all(waits);
    assert(Date.parse(hung.at)<now-30000,'逾時回舊資料，at 不變');
    hang=false;now+=24000;await callB('ankeng');
    assert.equal(count.ankeng,prior+1,'逾時也算一次：從開始打的時候起算，不滿 55 秒不准再打');
    now+=1000;await callB('ankeng');assert.equal(count.ankeng,prior+2);
  }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;hang=false;}

  // 8. railisland.tw 與 www 是同一個 zone，共用同一份邊緣快取，不准各打各的。
  useEdge=true;now+=61000;prior=count.circular;
  await caller(isolateA,'railisland.tw')('circular');now+=10000;await caller(isolateB,'www.railisland.tw')('circular');
  assert.equal(count.circular,prior+1,'www 要吃 apex 寫進邊緣的那份');

  // 9. 邊緣那份的 s-maxage 向上取整：上游花了 300 毫秒，邊緣那份也不能比 55 秒早過期。
  now+=56000;upstreamDelay=300;await call('danhai');upstreamDelay=0;
  assert.match(edge.get('https://railisland.tw/api/ntmetro-live?sys=danhai').headers.get('cache-control'),/s-maxage=55(?:,|$)/,'邊緣那份向上取整');

  const before=count.ankeng+count.danhai+count.circular;const invalid=await call('__proto__');
  assert.equal(invalid.status,400);assert.equal(count.ankeng+count.danhai+count.circular,before);
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert(html.includes('setInterval(pollNtmLive, 20e3)'));
  assert(html.includes('finally { state._ntmPolling = false; }'));

  // ══════════ 10–18 集中出口（NtmPoller，Durable Object）══════════
  // 每個 colo＝一份獨立載入的 worker.js（記憶體各自一份）。邊緣快取除第 16 節外一律關掉——最壞情況：colo 之間
  // 什麼都不共用，「全站只打一次」只能靠 DO 自己的把關成立。DO 跑在 poller 那顆 Worker（另一個 isolate），這裡也
  // 另外載入一份；storage 用 Map 替身。重置（部署、執行環境更新）＝換一個新實例、storage 留著：照 Cloudflare 的
  // 行為，當下還在等舊實例回覆的請求一律收到錯誤，舊實例之後的 storage 寫入一律失敗。
  // broken：DO 打不通（呼叫直接丟錯）；failGate：打不通的那一發先等這個 promise 才丟錯（排出「一個在等、一個先回」）；
  // hangAll：DO 掛住（不回也不丟錯）；lag：這一發 DO 照常算好，回覆等這個 promise 才送回（排出「先問的晚到」）。
  const ae={points:[],writeDataPoint(p){this.points.push(structuredClone(p));}};
  const {NtmPoller}=await loadWorker('ntm-do');
  assert.equal(typeof NtmPoller,'function','〔10〕worker.js 要導出 NtmPoller');
  const namespace=()=>{
    const live=new Map(),disk=new Map();
    const ns={names:[],hints:[],broken:false,failGate:null,hangAll:false,lag:null,idFromName:name=>({name}),
      restart(name){
        const e=live.get(name);if(!e)return;
        e.cell.dead=true;live.delete(name);
        for(const reject of e.pending)reject(Object.assign(Error('fixture: DO 重置'),{retryable:true}));
        e.pending.clear();
      },
      get(id,opts){
        ns.names.push(id.name);ns.hints.push(opts&&opts.locationHint);
        return{fetch:async input=>{
          if(ns.hangAll)return new Promise(()=>{});
          if(ns.broken){const gate=ns.failGate;if(gate)await gate;throw Error('fixture: DO 打不通');}
          const lag=ns.lag;
          let e=live.get(id.name);
          if(!e){
            if(!disk.has(id.name))disk.set(id.name,new Map());
            const store=disk.get(id.name),cell={dead:false};
            const storage={get:async keys=>new Map(keys.filter(k=>store.has(k)).map(k=>[k,structuredClone(store.get(k))])),
              put:async(k,v)=>{if(cell.dead)throw Error('fixture: 這個實例已重啟');store.set(k,structuredClone(v));}};
            e={cell,pending:new Set(),obj:new NtmPoller({storage,blockConcurrencyWhile:fn=>fn()},{NTM_UPSTREAM:ae})};
            live.set(id.name,e);
          }
          const res=await new Promise((resolve,reject)=>{
            e.pending.add(reject);
            e.obj.fetch(new Request(String(input))).then(resolve,reject).finally(()=>e.pending.delete(reject));
          });
          if(lag)await lag;
          return res;
        }};
      }};
    return ns;
  };
  let coloSeq=0;const newColo=async()=>(await loadWorker('ntm-colo-'+(coloSeq++))).default;
  const ask=(w,sys,env)=>w.fetch(new Request('https://railisland.test/api/ntmetro-live?sys='+sys),env,ctx);
  const total=()=>count.danhai+count.ankeng+count.circular;
  const warns=[],origWarn=console.warn;console.warn=(...a)=>{warns.push(a.join(' '));};
  try{
    useEdge=false;fail=false;empty=false;hang=false;hold=null;upstreamDelay=0;now+=120e3;
    const doBase=total();
    const ns=namespace(),env={NTM_POLLER:ns,NTM_UPSTREAM:ae};

    // 10. 12 個 colo 同時進來、官網還沒回應的那段：全站只打一次；查詢進行中進來的 colo 等同一發的結果。
    const colos=[];for(let i=0;i<12;i++)colos.push(await newColo());
    prior=count.danhai;hold=new Promise(r=>{release=r;});
    const burst=colos.map(w=>ask(w,'danhai',env));
    await until(()=>count.danhai===prior+1);for(let i=0;i<20;i++)await flush();
    assert.equal(count.danhai,prior+1,'〔10〕12 個 colo 同時進來：官網只被打一次（colo 之間什麼都不共用，只靠 DO）');
    release();hold=null;
    const firstRes=await Promise.all(burst),firstBody=await Promise.all(firstRes.map(r=>r.json()));
    assert(firstBody.every(b=>b.src&&b.at===firstBody[0].at),'〔10〕查詢進行中進來的 colo 等同一發的結果，拿到同一份新資料');
    assert.deepEqual(Object.keys(firstBody[0]).sort(),['at','src'],'〔10〕回傳欄位不變：只有 at、src');
    assert(firstRes.every(r=>/s-maxage=55(?:,|$)/.test(cc(r))&&r.headers.get('x-ntm-tried')===null),'〔10〕壽命從 DO 開始查詢起算、內部標頭不外露');
    assert.equal(new Set(ns.names).size,1,'〔10〕全站只用同一顆 DO（同一個名字）');
    // 期望值寫死字面值、不從實作 import：apac-ne 是 2026-09-02 實測唯一不落香港的提示（見 worker.js 的 TRTC_POLLER_HINT）。
    assert(ns.hints.length>0&&ns.hints.every(h=>h==='apac-ne'),'〔10〕locationHint 一律 apac-ne：'+[...new Set(ns.hints)]);

    // 11. 之後才冒出來的 colo（記憶體是空的）在間隔內問：DO 回同一份、不再打；滿 55 秒（環狀線 60 秒）才換新一批。
    prior=count.danhai;now+=54e3;
    for(let i=0;i<4;i++){
      const r=await ask(await newColo(),'danhai',env);
      assert.equal((await r.json()).at,firstBody[0].at,'〔11〕間隔內各 colo 拿到同一份');
      assert.match(cc(r),/s-maxage=1(?:,|$)/,'〔11〕只交 DO 那次查詢剩下的壽命');
    }
    for(const w of colos.slice(0,3))await ask(w,'danhai',env);
    assert.equal(count.danhai,prior,'〔11〕不滿 55 秒，DO 不准再打官網');
    now+=1e3;const second=await(await ask(await newColo(),'danhai',env)).json();
    assert.equal(count.danhai,prior+1,'〔11〕滿 55 秒換新一批');
    assert.equal(Date.parse(second.at)-Date.parse(firstBody[0].at),55e3,'〔11〕at 是向官網取回那一批的時刻');
    for(const w of colos)await ask(w,'danhai',env);
    assert.equal(count.danhai,prior+1,'〔11〕其餘 colo 過期後向 DO 要到同一份新的，不另打');
    prior=count.circular;await ask(await newColo(),'circular',env);now+=59e3;await ask(await newColo(),'circular',env);
    assert.equal(count.circular,prior+1,'〔11〕環狀線不滿 60 秒，DO 不准再打官網');
    now+=1e3;await ask(await newColo(),'circular',env);
    assert.equal(count.circular,prior+2,'〔11〕環狀線滿 60 秒換新一批');

    // 12. 失敗、回空、逾時都算一次：從 DO 開始查詢起算，間隔內別的 colo 不准再打；失敗與逾時回上一份、at 不變。
    now+=61e3;prior=count.ankeng;const okA=await(await ask(await newColo(),'ankeng',env)).json();
    now+=55e3;fail=true;const failA=await(await ask(await newColo(),'ankeng',env)).json();fail=false;
    assert.equal(count.ankeng,prior+2,'〔12〕過了間隔照打一次');assert.equal(failA.at,okA.at,'〔12〕官網失敗回上一份，at 不變');
    now+=54e3;await ask(await newColo(),'ankeng',env);
    assert.equal(count.ankeng,prior+2,'〔12〕失敗也算一次，不滿 55 秒不准再打');
    now+=1e3;empty=true;const emptyA=await(await ask(await newColo(),'ankeng',env)).json();empty=false;
    assert.equal(count.ankeng,prior+3);assert.equal(emptyA.src,null,'〔12〕官網回空照實轉送');
    now+=54e3;await ask(await newColo(),'ankeng',env);
    assert.equal(count.ankeng,prior+3,'〔12〕回空也算一次，不滿 55 秒不准再打');
    const timers12=[];
    globalThis.setTimeout=(fn,ms)=>{timers12.push({fn,ms});return timers12.length;};
    globalThis.clearTimeout=id=>{if(timers12[id-1])timers12[id-1].fn=null;};
    try{
      now+=1e3;hang=true;
      const hung=ask(await newColo(),'ankeng',env);await until(()=>count.ankeng===prior+4);
      const joined=ask(await newColo(),'ankeng',env);for(let i=0;i<10;i++)await flush();
      assert.equal(count.ankeng,prior+4,'〔12〕官網掛住期間別的 colo 不准再打');
      // 12 秒以上的是主站等 DO 回覆的逾時（第 19 節驗），這裡只看 DO 打官網的那一個。
      const live=timers12.filter(t=>t.fn&&t.ms<12e3);
      assert(live.length===1&&live[0].ms>=3000,'〔12〕DO 打官網也帶逾時：'+live.map(t=>t.ms));
      live[0].fn();
      const [h1,h2]=await Promise.all([hung,joined].map(p=>p.then(r=>r.json())));
      assert(h1.at===emptyA.at&&h2.at===emptyA.at,'〔12〕逾時回上一份，at 不變');
    }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;hang=false;}
    now+=54e3;await ask(await newColo(),'ankeng',env);
    assert.equal(count.ankeng,prior+4,'〔12〕逾時也算一次，不滿 55 秒不准再打');
    now+=1e3;await ask(await newColo(),'ankeng',env);assert.equal(count.ankeng,prior+5);

    // 13. DO 重置（部署、執行環境更新）：開始查詢的時間在打官網之前就存進 storage，重置後間隔照樣成立；
    //     查詢進行中重置時，在等的 colo 收到錯誤——這一輪回各自的上一份，不准改成自己直打。
    const NAME=ns.names[0];
    now+=61e3;prior=count.danhai;
    const k13=[];for(let i=0;i<5;i++)k13.push(await newColo());
    const base13=await(await ask(k13[0],'danhai',env)).json();
    for(const w of k13.slice(1))await ask(w,'danhai',env);
    assert.equal(count.danhai,prior+1);
    ns.restart(NAME);now+=30e3;const after13=await(await ask(await newColo(),'danhai',env)).json();
    assert.equal(count.danhai,prior+1,'〔13〕重置後不滿 55 秒不准再打');
    assert.equal(after13.at,base13.at,'〔13〕重置後回同一份（資料也存著）');
    now+=25e3;hold=new Promise(r=>{release=r;});
    const pending13=k13.map(w=>ask(w,'danhai',env));await until(()=>count.danhai===prior+2);
    for(let i=0;i<10;i++)await flush();
    // 先數再等：新實例若沒讀到開始時間而自己再打，那一發會卡在同一個 hold 上，等它回覆只會卡死不會紅。
    ns.restart(NAME);const mid13P=ask(await newColo(),'danhai',env);for(let i=0;i<10;i++)await flush();
    assert.equal(count.danhai,prior+2,'〔13〕查詢進行中重置：在等的 colo 與新實例都不准再打');
    const res13=await Promise.all(pending13.map(p=>p.then(r=>r.json())));
    assert(res13.every(b=>b.at===base13.at&&b.src),'〔13〕重置當下在等的 colo 回各自的上一份，at 不變');
    const mid13=await(await mid13P).json();
    assert.equal(mid13.at,base13.at,'〔13〕新實例回上一份');
    release();hold=null;for(let i=0;i<10;i++)await flush();
    now+=54e3;await ask(await newColo(),'danhai',env);
    assert.equal(count.danhai,prior+2,'〔13〕間隔從重置前那次查詢起算');
    now+=1e3;await ask(await newColo(),'danhai',env);assert.equal(count.danhai,prior+3);

    // 14. 落點在禁區（香港）：DO 一發都不打，各 colo 直接走 per-colo 退路；退路照樣有間隔，並記下原因。
    traceColo='HKG';
    const nsH=namespace(),envH={NTM_POLLER:nsH,NTM_UPSTREAM:ae};
    now+=61e3;prior=count.circular;let mark=ae.points.length,warned=warns.length;
    const cH=await newColo();await ask(cH,'circular',envH);await ask(cH,'circular',envH);now+=30e3;await ask(cH,'circular',envH);
    traceColo='NRT';
    const ptsH=ae.points.slice(mark);
    assert.equal(ptsH.filter(p=>p.blobs[1].startsWith('do:')).length,0,'〔14〕落點在禁區的 DO 一發都不打');
    assert.equal(count.circular,prior+1,'〔14〕退路照樣有間隔：同一個 colo 不滿 60 秒只打一次');
    assert.deepEqual(ptsH.map(p=>p.blobs[1]),['direct:denied:HKG'],'〔14〕退路那一次記下原因');
    assert(warns.slice(warned).some(w=>w.includes('denied:HKG')),'〔14〕退路寫進 log');

    // 15. DO 拿不到：
    //   切換那一刻——DO 剛替 colo A 打過，1 秒後 colo B（記憶體是更早那一份）問 DO 遇到錯誤：不准直打，回 B 的上一份；
    //   A 剛從 DO 拿到的那份還在間隔內：照用；DO 一直拿不到：B 下一個間隔起走退路直打（同時湧進來也只打一次），
    //   之後每個間隔照常直打，每一次都記下原因。
    now+=61e3;prior=count.danhai;
    const cB=await newColo();const oldB=await(await ask(cB,'danhai',env)).json();
    now+=55e3;const cA=await newColo();await ask(cA,'danhai',env);
    assert.equal(count.danhai,prior+2);
    ns.broken=true;now+=1e3;mark=ae.points.length;warned=warns.length;
    const heldB=await(await ask(cB,'danhai',env)).json();
    assert.equal(count.danhai,prior+2,'〔15〕DO 剛替別的 colo 打過、這裡一時拿不到：不准緊接著直打');
    assert(heldB.at===oldB.at&&heldB.src,'〔15〕拿不到 DO 的那個間隔回這個 colo 的上一份');
    assert(warns.slice(warned).some(w=>w.includes('error')),'〔15〕拿不到 DO 寫進 log');
    await Promise.all([1,2,3].map(()=>ask(cA,'danhai',env)));
    assert.equal(count.danhai,prior+2,'〔15〕剛從 DO 拿到的那份還在間隔內：照用，不准再打');
    now+=55e3;
    const storm=await Promise.all([1,2,3,4,5].map(()=>ask(cB,'danhai',env)));
    assert.equal(count.danhai,prior+3,'〔15〕DO 一直拿不到：下一個間隔起退路照常直打，同一個 isolate 同時湧進來也只打一次');
    assert(storm.every(r=>r.status===200),'〔15〕退路照常回 200');
    now+=30e3;await ask(cB,'danhai',env);
    assert.equal(count.danhai,prior+3,'〔15〕退路不滿 55 秒不准再打');
    now+=25e3;await ask(cB,'danhai',env);
    assert.equal(count.danhai,prior+4,'〔15〕DO 還是拿不到：之後每個間隔照常直打，不再多撐一輪');
    const ptsU=ae.points.slice(mark);
    assert(ptsU.length===2&&ptsU.every(p=>p.blobs[1]==='direct:error'),'〔15〕退路每一次都記下原因：'+ptsU.map(p=>p.blobs[1]));
    ns.broken=false;

    // 16. 同一個 colo 的兩個 isolate（邊緣快取共用）：DO 一直拿不到、兩個都撐過一輪之後，Y 還在等 DO 回錯時，
    //     X 已經直打並在邊緣佔位——Y 回錯之後要先看邊緣，不准再打一次。
    useEdge=true;edge.clear();
    const iX=await newColo(),iY=await newColo();
    now+=61e3;prior=count.ankeng;
    await ask(iX,'ankeng',env);await ask(iY,'ankeng',env);
    assert.equal(count.ankeng,prior+1);
    ns.broken=true;now+=55e3;
    await ask(iX,'ankeng',env);await ask(iY,'ankeng',env);
    assert.equal(count.ankeng,prior+1,'〔16〕DO 剛拿不到：同一個 colo 兩個 isolate 都先撐一輪');
    now+=55e3;let releaseY;ns.failGate=new Promise(r=>{releaseY=r;});
    const pY=ask(iY,'ankeng',env);for(let i=0;i<10;i++)await flush();
    ns.failGate=null;await ask(iX,'ankeng',env);
    assert.equal(count.ankeng,prior+2,'〔16〕DO 一直拿不到：X 走退路直打');
    releaseY();const rY=await pY;
    assert.equal(count.ankeng,prior+2,'〔16〕Y 在等 DO 回錯時 X 已經直打並佔位：先看邊緣，不准再打一次');
    assert.equal(rY.status,200);
    ns.broken=false;useEdge=false;

    // 17. 主站帶來的間隔：DO 取它與自己那一版較長的一個——帶較短的不准放寬，帶較長的照較長的；/status 不觸發查詢。
    const stub=ns.get(ns.idFromName(NAME),{locationHint:'apac-ne'});
    const askDo=g=>stub.fetch('https://ntm-poller/live?sys=circular&gap='+g).then(r=>r.json());
    now+=61e3;prior=count.circular;
    await askDo(60e3);assert.equal(count.circular,prior+1);
    now+=1e3;await askDo(1e3);
    assert.equal(count.circular,prior+1,'〔17〕主站帶來較短的間隔：不准放寬 DO 自己那一版的間隔');
    now+=60e3;await askDo(70e3);
    assert.equal(count.circular,prior+1,'〔17〕主站帶來較長的間隔：DO 照較長的那個，不滿 70 秒不准再打');
    now+=9e3;await askDo(70e3);assert.equal(count.circular,prior+2,'〔17〕滿 70 秒才再打');
    const st=await(await stub.fetch('https://ntm-poller/status')).json();
    assert.deepEqual(st.gaps,{danhai:55e3,ankeng:55e3,circular:60e3},'〔17〕/status 報出這一版的間隔表');
    assert.equal(count.circular,prior+2,'〔17〕/status 不觸發查詢');

    // 18. 「連續兩個間隔都拿不到」要看時間、也要看 DO 有沒有通過：
    //   (a) 撐過一輪之後閒置（或一直由邊緣供應）超過兩個間隔，才又拿不到一次＝第一次：先撐一輪，不准直打（DO 剛替別處打過）；
    //   (b) 撐一輪的同時，同一個 isolate 另一個請求從 DO 拿到較舊的一份：DO 是通的，down 要清掉，之後再錯一次照樣先撐一輪；
    //   (c) 撐一輪的那個間隔裡（量在快結束的第 54 秒）DO 仍回錯：同一個 isolate 再問、同 colo 別的 isolate 來問，都不准直打。
    now+=61e3;prior=count.danhai;
    const wA=await newColo();await ask(wA,'danhai',env);assert.equal(count.danhai,prior+1);
    now+=55e3;ns.broken=true;await ask(wA,'danhai',env);ns.broken=false;
    assert.equal(count.danhai,prior+1,'〔18〕第一次拿不到先撐一輪');
    now+=165e3;await ask(await newColo(),'danhai',env);assert.equal(count.danhai,prior+2);
    now+=1e3;ns.broken=true;const idleA=await(await ask(wA,'danhai',env)).json();ns.broken=false;
    assert.equal(count.danhai,prior+2,'〔18〕撐過一輪、隔了兩個間隔以上才又拿不到：算第一次，不准直打（DO 剛替別處打過）');
    assert(idleA.src,'〔18〕回這個 colo 的上一份');
    const wB=await newColo();now+=55e3;await ask(wB,'danhai',env);assert.equal(count.danhai,prior+3);
    now+=55e3;await ask(await newColo(),'danhai',env);assert.equal(count.danhai,prior+4);
    now+=1e3;let releaseLag;ns.lag=new Promise(r=>{releaseLag=r;});
    const lateB=ask(wB,'danhai',env);for(let i=0;i<10;i++)await flush();ns.lag=null;
    ns.broken=true;await ask(wB,'danhai',env);ns.broken=false;
    releaseLag();assert.equal((await lateB).status,200);assert.equal(count.danhai,prior+4);
    now+=55e3;ns.broken=true;await ask(wB,'danhai',env);ns.broken=false;
    assert.equal(count.danhai,prior+4,'〔18〕撐一輪時 DO 其實是通的（較舊的一份晚到）：down 要清掉，之後再拿不到一次照樣先撐一輪，不准直打');
    useEdge=true;edge.clear();
    const wC=await newColo(),wC2=await newColo();
    now+=56e3;await ask(wC,'danhai',env);assert.equal(count.danhai,prior+5);
    now+=55e3;ns.broken=true;await ask(wC,'danhai',env);
    now+=54e3;const againC=await ask(wC,'danhai',env),otherC=await ask(wC2,'danhai',env);
    ns.broken=false;useEdge=false;
    assert.equal(count.danhai,prior+5,'〔18〕撐一輪的間隔裡 DO 仍回錯：同一個 isolate 再問、同 colo 別的 isolate 來問，都不准直打');
    assert(againC.status===200&&otherC.status===200);

    // 19. DO 掛住（不回也不丟錯）：主站等 DO 要帶逾時，而且要長於 DO 那邊最壞的情況（量落點 3 秒＋打官網 8 秒）；
    //     逾時算一次拿不到——第一次先撐一輪，下一個間隔還是掛住才走退路直打，並記下原因 direct:timeout。
    const timers19=[];
    globalThis.setTimeout=(fn,ms)=>{timers19.push({fn,ms});return timers19.length;};
    globalThis.clearTimeout=id=>{if(timers19[id-1])timers19[id-1].fn=null;};
    try{
      const wH=await newColo();now+=61e3;prior=count.circular;
      await ask(wH,'circular',env);assert.equal(count.circular,prior+1);
      now+=60e3;ns.hangAll=true;mark=ae.points.length;
      const h1=ask(wH,'circular',env);for(let i=0;i<20;i++)await flush();
      const dot=timers19.filter(t=>t.fn&&t.ms>=12e3);
      assert.equal(dot.length,1,'〔19〕主站等 DO 要帶逾時，而且長於 DO 最壞的 11 秒：'+timers19.filter(t=>t.fn).map(t=>t.ms));
      // 先數再等：逾時沒接上的話請求會一直掛著，直接 await 只會讓程序卡住、不會紅。
      const settled=p=>{const s={done:false};p.then(()=>{s.done=true;},()=>{s.done=true;});return s;};
      const s1=settled(h1);dot[0].fn();for(let i=0;i<20;i++)await flush();
      assert(s1.done,'〔19〕逾時一到，請求要當成一次拿不到而結束，不准一直等 DO');
      assert.equal((await h1).status,200);
      assert.equal(count.circular,prior+1,'〔19〕DO 掛住、第一次逾時：先撐一輪，不准直打');
      now+=60e3;const h2=ask(wH,'circular',env);for(let i=0;i<20;i++)await flush();
      const dot2=timers19.filter(t=>t.fn&&t.ms>=12e3);assert.equal(dot2.length,1,'〔19〕每一次等 DO 都帶逾時');
      const s2=settled(h2);dot2[0].fn();for(let i=0;i<20;i++)await flush();
      assert(s2.done,'〔19〕第二次逾時同樣要結束');await h2;
      assert.equal(count.circular,prior+2,'〔19〕下一個間隔 DO 還是掛住：走退路直打一次');
      assert.deepEqual(ae.points.slice(mark).map(p=>p.blobs[1]),['direct:timeout'],'〔19〕退路那一次記下原因 direct:timeout');
    }finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;ns.hangAll=false;}

    // 20. 慢回的舊回覆：同一個 isolate 先問 DO 的那一發晚到，拿的是較舊的一份——記憶體與邊緣都不准被它蓋掉。
    useEdge=true;edge.clear();
    const wE=await newColo(),keyE='https://railisland.tw/api/ntmetro-live?sys=ankeng';
    now+=61e3;prior=count.ankeng;let releaseE;ns.lag=new Promise(r=>{releaseE=r;});
    const lateE=ask(wE,'ankeng',env);for(let i=0;i<10;i++)await flush();ns.lag=null;
    assert.equal(count.ankeng,prior+1);
    now+=55e3;const newE=await(await ask(wE,'ankeng',env)).json();assert.equal(count.ankeng,prior+2);
    const putsE=puts,triedE=edge.get(keyE).headers.get('x-ntm-tried');
    releaseE();await lateE;
    assert.equal(puts,putsE,'〔20〕較舊的那份晚到：不准寫邊緣（會蓋掉同 colo 剛寫進去的新那份）');
    assert.equal(edge.get(keyE).headers.get('x-ntm-tried'),triedE,'〔20〕邊緣仍是較新的那份');
    assert.equal((await(await ask(wE,'ankeng',env)).json()).at,newE.at,'〔20〕記憶體仍是較新的那份');
    useEdge=false;

    // 21. 帳：每打一次官網一筆，集中出口與退路都記。假環境裡筆數要恰好對得上；正式站的 DO 在查詢途中被重置時
    //     那一發可能來不及記，所以正式站的帳是下限（scripts/ntm_upstream_report.mjs 讀它）。
    const NTM=new Set(['danhai','ankeng','circular']);
    assert.equal(ae.points.length,total()-doBase,'〔21〕帳上的筆數＝官網實際被打的次數');
    assert(ae.points.every(p=>p.indexes[0]===p.blobs[0]&&NTM.has(p.blobs[0])&&/^(do:|direct:)/.test(p.blobs[1])&&Number.isFinite(p.doubles[0])),
      '〔21〕每筆帶系統、誰打的、開始查詢的時間');
    assert(ae.points.some(p=>p.blobs[1]==='do:NRT')&&ae.points.some(p=>p.blobs[1].startsWith('direct:')),'〔21〕兩條路都記得到（正向對照）');
  }finally{console.warn=origWarn;}

  console.log('PASS NTM Worker：查詢頻率上限（淡海、安坑 55 秒／環狀線 60 秒）、失敗與逾時都算一次查詢、同時進來的請求只打一次（同 isolate 與跨 isolate）、上游帶逾時並交給 waitUntil、邊緣快取跨 isolate 與 www 共用且只交剩餘壽命、舊部署快取略過、負快取、白名單、前端防重入；'
    +'集中出口：12 個 colo 同時或先後請求官網全站只打一次、失敗回空逾時都算一次、DO 重置間隔照樣成立且在等的 colo 不直打、'
    +'DO 一時拿不到先撐一輪、一直拿不到才由各 colo 把關（有間隔、跨 isolate 先看邊緣、每次記帳）、落點禁區直接走退路、'
    +'主站帶來較長的間隔照樣生效且不准放寬、/status 不觸發查詢、「連續拿不到」看時間且 DO 通過就清掉、'
    +'撐一輪期間同 isolate 與同 colo 都不直打、等 DO 帶逾時（逾時算一次拿不到）、慢回的舊回覆不蓋記憶體與邊緣');
}finally{Object.assign(globalThis,original);}

if(!MUTATION){
  // 突變自驗：每個突變另開一個行程重跑本檔，必須在指定的那一節以 AssertionError 退出。
  const self=fileURLToPath(import.meta.url),bad=[];
  for(const [name,m] of Object.entries(MUTANTS)){
    const r=spawnSync(process.execPath,[self],{encoding:'utf8',timeout:120e3,env:{...process.env,NTM_WORKER_MUTATION:name}});
    const out=(r.stdout||'')+(r.stderr||'');
    const applied=out.includes(`MUTANT ${name}：已套用 ${m.n} 處`);
    const msg=(out.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]*)/)||[])[1]||'';
    const killed=applied&&r.status===1&&msg.includes(m.expect);
    console.log(`${killed?'  ✓':'  ✗'} 突變 ${name} → exit ${r.status}${msg?'，擋在「'+msg.slice(0,70)+'」':'（沒有 AssertionError）'}`);
    if(!killed)bad.push(name);
  }
  if(bad.length){console.error('FAIL 突變自驗：'+bad.join('、')+' 沒有被指定的那一節擋下');process.exit(1);}
  console.log('PASS 突變自驗：'+Object.keys(MUTANTS).length+' 個突變都被指定的那一節擋下');
}

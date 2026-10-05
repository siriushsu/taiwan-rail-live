// 真正呼叫 Worker 路由，mock 官方上游、Cache API 與時鐘；不打真實服務。
// 守新北捷運 2026-09-22 核准函的查詢頻率：淡海、安坑約每 55 秒一次、環狀線約每 60 秒一次，要改須事前報准。
// 調短或調長都會在這裡紅——頻率要改，先拿到對方同意，再改這支的期望值。
import assert from 'node:assert/strict';
import fs from 'node:fs';
const original={Date:globalThis.Date,fetch:globalThis.fetch,caches:globalThis.caches,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
let now=Date.parse('2026-10-05T02:30:00Z'),fail=false,useEdge=false,hold=null,hang=false,upstreamDelay=0,lastInit=null;
const count={danhai:0,ankeng:0,circular:0};
class ClockDate extends original.Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
globalThis.Date=ClockDate;
const edge=new Map();let puts=0;
// 刻意讓 Cache API 保留超齡回覆，模擬舊部署的長 TTL，驗 handler 自己仍會拒絕。
globalThis.caches={default:{match:async req=>useEdge?edge.get(req.url)?.clone():null,
  put:async(req,res)=>{puts++;edge.set(req.url,res.clone());}}};
// hold：上游慢（等放行才回）；hang：上游不回，只在 signal abort 時失敗；upstreamDelay：上游花掉的時間。
globalThis.fetch=async(input,init)=>{
  const m=String(input).match(/^https:\/\/trainstatus\.ntmetro\.com\.tw\/roadmap\/(ankeng|danhai|circular)_data\.php$/);
  assert(m,'只准打三支官網端點：'+input);
  count[m[1]]++;lastInit=init;
  if(hang)return new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted'))));
  if(hold)await hold;
  now+=upstreamDelay;
  if(fail)throw Error('fixture offline');
  return new Response(JSON.stringify({data:{gpsData:[{K02:{routeId:1,time:50,carNum:'212'}},{}]}}));
};
const flush=()=>new Promise(r=>setImmediate(r));
const until=async cond=>{for(let i=0;i<50&&!cond();i++)await flush();assert(cond(),'等不到預期狀態');};
try{
  // 同一支 worker.js 載入兩份＝同一個 colo 裡的兩個 isolate：記憶體各自一份，邊緣快取共用。
  const isolateA=(await import('../worker.js?ntm-proxy-contract')).default;
  const isolateB=(await import('../worker.js?ntm-proxy-isolate-b')).default;
  const waits=[];const ctx={waitUntil(p){waits.push(p);}};
  const caller=(w,host='railisland.test')=>sys=>w.fetch(new Request(`https://${host}/api/ntmetro-live?sys=`+sys),{},ctx);
  const call=caller(isolateA),callB=caller(isolateB);
  const cc=r=>r.headers.get('cache-control');

  // 1. 核准頻率（記憶體這一層）：淡海、安坑 55 秒，環狀線 60 秒。
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
  console.log('PASS NTM Worker：核准頻率（淡海、安坑 55 秒／環狀線 60 秒）、失敗與逾時都算一次查詢、同時進來的請求只打一次（同 isolate 與跨 isolate）、上游帶逾時並交給 waitUntil、邊緣快取跨 isolate 與 www 共用且只交剩餘壽命、舊部署快取略過、負快取、白名單、前端防重入');
}finally{Object.assign(globalThis,original);}

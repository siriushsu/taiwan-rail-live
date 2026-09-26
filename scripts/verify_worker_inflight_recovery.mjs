#!/usr/bin/env node
// Worker 共用 inflight 的失效復原守門人（fixture-only，不打任何真實上游）。
//
// 驗的不是「有傳 AbortSignal」而已：request owner 被取消時，fetch／body 與該 request 的 timer
// 都可能永遠不 settle。NCDR 要有硬截止；公車昂貴動態上游要保留 single-flight，但每位 caller
// 有有限等待、滿正常刷新週期可放掉，且舊 owner 晚到不得清掉接手的新 owner。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workerSource=readFileSync(path.join(ROOT,'worker.js'),'utf8');
const realFetch=globalThis.fetch,realCaches=globalThis.caches;
globalThis.caches={default:{async match(){return undefined;},async put(){}}};

let fetchCalls=0,fetchMode='ok',lastSignal=null,lateResolve=null;
const feed=label=>({feed:{updated:label,entry:[]}});
const response=label=>({ok:true,status:200,json:async()=>feed(label)});
globalThis.fetch=async(_url,options={})=>{
  fetchCalls++;lastSignal=options.signal||null;
  if(fetchMode==='fetch-hang')return new Promise(()=>{});
  if(fetchMode==='body-hang')return {ok:true,status:200,json:()=>new Promise(()=>{})};
  if(fetchMode==='late')return await new Promise(resolve=>{lateResolve=resolve;});
  return response(fetchMode==='ok'?'OK':String(fetchMode));
};

const {_hazard:hazard,_busTransfer:bus}=await import('../worker.js');
let checks=0,failures=0;
function check(name,fn){
  checks++;
  try{fn();console.log('PASS '+name);}
  catch(error){failures++;console.error('FAIL '+name+' — '+error.message);}
}
const result=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

check('NCDR 子截止小於 scheduled 總截止，放掉門檻不短於正常刷新週期',()=>{
  assert(hazard.HAZARD_FETCH_TIMEOUT_MS<hazard.HAZARD_MONITOR_TIMEOUT_MS);
  assert(hazard.HAZARD_REFRESH_RECLAIM_MS>=60000);
});

hazard.resetHazardMem();fetchCalls=0;fetchMode='fetch-hang';
const hazardStarted=performance.now();
const hazardPair=await Promise.all([
  result(hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60})),
  result(hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60})),
]);
const hazardElapsed=Math.round(performance.now()-hazardStarted);
check('NCDR fetch 永不回應：同時刷新只打一發，兩位 caller 都在截止內結束',()=>{
  assert.equal(fetchCalls,1);
  assert(hazardPair.every(x=>!x.ok));
  assert(hazardElapsed<300,`實際 ${hazardElapsed}ms`);
  assert.equal(lastSignal.aborted,true);
});
fetchMode='RECOVERED';
await hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60});
const recoveredHazard=await(await hazard.hazardAlert(new Request('https://verify.invalid/api/hazard-alert'),{})).json();
check('NCDR 截止後下一輪可重抓成功',()=>{
  assert.equal(fetchCalls,2);
  assert.equal(recoveredHazard.at,'RECOVERED');
});

hazard.resetHazardMem();fetchCalls=0;fetchMode='body-hang';
const bodyHang=await result(hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60}));
await tick(); // caller 與 owner 的同毫秒 timer 都到期後再驗 abort；兩者誰先排進 queue 不是契約。
check('NCDR headers 已到但 body 永不結束，仍由同一個總截止收掉',()=>{
  assert.equal(bodyHang.ok,false);
  assert.equal(fetchCalls,1);
  assert.equal(lastSignal.aborted,true);
});

hazard.resetHazardMem();fetchCalls=0;fetchMode='late';lateResolve=null;
const oldHazard=result(hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60}));
await oldHazard;
fetchMode='NEW';
await hazard.refreshHazardMem({}, {waitMaxMs:25,reclaimMs:60});
lateResolve(response('OLD'));
await tick();
const afterLateHazard=await(await hazard.hazardAlert(new Request('https://verify.invalid/api/hazard-alert'),{})).json();
check('已截止的 NCDR 舊回應晚到，不覆寫新一輪結果',()=>{
  assert.equal(fetchCalls,2);
  assert.equal(afterLateHazard.at,'NEW');
});

// request 被取消時，連 setTimeout 都可能跟著消失。用永不觸發的 timer fixture 證明不是靠 owner
// 自己的 deadline 清場：只有到 reclaim 年齡的下一位 caller 才能 abort 舊 owner 並接手。
hazard.resetHazardMem();fetchCalls=0;fetchMode='late';lateResolve=null;
let hazardClock=5000;
const vanishedTimer=()=>Symbol('vanished-timer');
const noClear=()=>{};
const strandedHazard=result(hazard.refreshHazardMem({}, {
  waitMaxMs:25,reclaimMs:60,now:()=>hazardClock,setTimer:vanishedTimer,clearTimer:noClear,
}));
await tick();
const reclaimedHazardSignal=lastSignal;
hazardClock=5060;fetchMode='RECLAIMED';
await hazard.refreshHazardMem({}, {
  waitMaxMs:25,reclaimMs:60,now:()=>hazardClock,setTimer:vanishedTimer,clearTimer:noClear,
});
lateResolve(response('TOO_OLD'));
const strandedHazardResult=await strandedHazard;
const afterHazardReclaim=await(await hazard.hazardAlert(new Request('https://verify.invalid/api/hazard-alert'),{})).json();
check('NCDR owner 的 timer 隨 request 消失時，滿週期仍可 reclaim 且舊回應不倒灌',()=>{
  assert.equal(fetchCalls,2);
  assert.equal(reclaimedHazardSignal.aborted,true);
  assert.equal(strandedHazardResult.ok,true);
  assert.equal(afterHazardReclaim.at,'RECLAIMED');
});

hazard.resetHazardMem();fetchCalls=0;fetchMode='fetch-hang';
const monitorStarted=performance.now();
const monitor=await result(hazard.hazardMonitorWithTimeout({}, {}, 25));
const monitorElapsed=Math.round(performance.now()-monitorStarted);
check('scheduled 災害監看另有整輪總截止，不拖住同分鐘其他 cron',()=>{
  assert.equal(monitor.ok,false);
  assert.match(String(monitor.error&&monitor.error.message),/hazard timeout/);
  assert(monitorElapsed<300,`實際 ${monitorElapsed}ms`);
});
hazard.resetHazardMem();

check('公車等待上限短於放掉門檻，放掉門檻涵蓋最慢的正常節拍',()=>{
  assert(bus.BUS_INFLIGHT_WAIT_MAX_MS<bus.BUS_INFLIGHT_RECLAIM_MS);
  assert(bus.BUS_INFLIGHT_RECLAIM_MS>=60000);
});

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const busKeys=['station N1','route S2','leg A1/A2/seat','direct city','tdx StopUID cluster'];
for(const label of busKeys){
  const map=new Map(),old=deferred(),next=deferred();
  let nowMs=1000,calls=0,phase='old',oldSignal=null;
  const start=({signal})=>{calls++;if(phase==='old'){oldSignal=signal;return old.promise;}return next.promise;};
  const options={waitMaxMs:20,reclaimMs:60,now:()=>nowMs};
  const began=performance.now();
  const firstTwo=await Promise.all([
    result(bus.sharedBusInflight(map,label,start,options)),
    result(bus.sharedBusInflight(map,label,start,options)),
  ]);
  const elapsed=Math.round(performance.now()-began);
  check(`${label}：永不回應時仍併流且 caller 有截止`,()=>{
    assert.equal(calls,1);assert(firstTwo.every(x=>!x.ok));assert(elapsed<300,`實際 ${elapsed}ms`);
  });
  phase='next';nowMs=1030;
  const beforeReclaim=await result(bus.sharedBusInflight(map,label,start,options));
  check(`${label}：等待截止後、放掉門檻前不額外重打上游`,()=>{
    assert.equal(beforeReclaim.ok,false);assert.equal(calls,1);
  });
  nowMs=1060;
  const replacement=result(bus.sharedBusInflight(map,label,start,options));
  await tick();
  old.resolve('OLD');
  await tick();
  const passenger=result(bus.sharedBusInflight(map,label,start,options));
  await tick();
  check(`${label}：滿放掉門檻才開下一輪，並 abort 舊 owner`,()=>{
    assert.equal(calls,2);assert.equal(oldSignal.aborted,true);
  });
  next.resolve('NEW');
  const [newOwner,newPassenger]=await Promise.all([replacement,passenger]);
  check(`${label}：舊 owner 晚到不清新 owner，後來者共乘同一發`,()=>{
    assert.equal(calls,2);assert(newOwner.ok&&newPassenger.ok);
    assert.equal(newOwner.value,'NEW');assert.equal(newPassenger.value,'NEW');
  });
}

// Cache API 沒有 CAS。刻意讓舊 A 先進 put 後卡住、新 B 先寫完，再放 A 完成；A 必須偵測到
// 更新代並補寫 B，最終 cache 不得倒退。這就是實際 endpoint 曾漏掉的 TOCTOU。
{
  const releaseOld=deferred();let first=true,stored=null;const writes=[];
  const edge={put:async(_key,response)=>{
    const body=await response.text();
    if(first){first=false;await releaseOld.promise;}
    stored=body;writes.push(body);
  }};
  const entry=body=>[{key:new Request('https://verify.invalid/cache-race'),body,headers:{'content-type':'application/json'}}];
  const oldWrite=bus.orderedBusCachePut(edge,'cache-race',entry('OLD'));
  await tick();
  await bus.orderedBusCachePut(edge,'cache-race',entry('NEW'));
  check('公車 cache 新 owner 不必等待卡住的舊寫入',()=>{
    assert.equal(stored,'NEW');assert.deepEqual(writes,['NEW']);
  });
  releaseOld.resolve();
  await oldWrite;
  check('公車 cache 舊寫入晚完成後會重播最新版，不讓內容倒退',()=>{
    assert.equal(stored,'NEW');assert.deepEqual(writes,['NEW','OLD','NEW']);
  });
}

// match 開始與結束時都沒有 state 仍不夠：B 可能在那個 await 期間完整寫完並回收 state（ABA）。
// 第一讀刻意捕捉 OLD 後卡住，B 寫 NEW，再放第一讀回來；monotonic epoch 必須讓它重讀 NEW。
{
  const key=new Request('https://verify.invalid/cache-match-aba');
  const matchEntered=deferred(),releaseMatch=deferred();let stored='OLD',firstMatch=true,matchCalls=0;
  const edge={
    async match(){
      matchCalls++;const captured=new Response(stored);
      if(firstMatch){firstMatch=false;matchEntered.resolve();await releaseMatch.promise;}
      return captured;
    },
    async put(_key,response){stored=await response.text();},
  };
  const read=bus.matchBusCache(edge,key);
  await matchEntered.promise;
  await bus.orderedBusCachePut(edge,key.url,[{key,body:'NEW',headers:{'content-type':'text/plain'}}]);
  releaseMatch.resolve();
  const returned=await(await read).text();
  check('公車 cache match 的短寫入 ABA 會重讀，不回傳先捕捉的舊 body',()=>{
    assert.equal(stored,'NEW');assert.equal(returned,'NEW');assert.equal(matchCalls,2);
  });
}

// 同一個 ABA 也可能先捕捉 miss；若在 `if (!hit)` 就回傳，B 已寫好的 NEW 會被當成 miss，endpoint
// 在 shared owner 已清掉後多打一發上游。miss 也要看 epoch 並重讀。
{
  const key=new Request('https://verify.invalid/cache-match-miss-aba');
  const matchEntered=deferred(),releaseMatch=deferred();let stored=null,firstMatch=true,matchCalls=0;
  const edge={
    async match(){
      matchCalls++;const captured=stored==null?undefined:new Response(stored);
      if(firstMatch){firstMatch=false;matchEntered.resolve();await releaseMatch.promise;}
      return captured;
    },
    async put(_key,response){stored=await response.text();},
  };
  const read=bus.matchBusCache(edge,key);
  await matchEntered.promise;
  await bus.orderedBusCachePut(edge,key.url,[{key,body:'NEW',headers:{'content-type':'text/plain'}}]);
  releaseMatch.resolve();
  const returned=await(await read).text();
  check('公車 cache match 的 miss ABA 會重讀新值，不觸發多餘上游',()=>{
    assert.equal(stored,'NEW');assert.equal(returned,'NEW');assert.equal(matchCalls,2);
  });
}

// state 因更早的 A.put 永掛而常駐時，before 與 after 是同一個可變物件；必須另存 beforeLatest，
// 否則 match 捕捉 B 的期間 latest 原地換成 C，前後比較會一起變而錯放 B。
{
  const key=new Request('https://verify.invalid/cache-match-latest-race');
  const oldPutEntered=deferred(),matchEntered=deferred(),releaseMatch=deferred();
  let putCalls=0,stored=null,firstMatch=true,matchCalls=0;
  const edge={
    async put(_key,response){
      const body=await response.text();putCalls++;
      if(putCalls===1){oldPutEntered.resolve();return await new Promise(()=>{});}
      stored=body;
    },
    async match(){
      matchCalls++;const captured=stored==null?undefined:new Response(stored);
      if(firstMatch){firstMatch=false;matchEntered.resolve();await releaseMatch.promise;}
      return captured;
    },
  };
  void bus.orderedBusCachePut(edge,key.url,[{key,body:'A',headers:{'content-type':'text/plain'}}]);
  await oldPutEntered.promise;
  await bus.orderedBusCachePut(edge,key.url,[{key,body:'B',headers:{'content-type':'text/plain'}}]);
  const read=bus.matchBusCache(edge,key);
  await matchEntered.promise;
  await bus.orderedBusCachePut(edge,key.url,[{key,body:'C',headers:{'content-type':'text/plain'}}]);
  releaseMatch.resolve();
  const returned=await(await read).text();
  check('公車 cache 常駐 state 的 latest 在 match 期間換代時，會重讀 C 而不放行 B',()=>{
    assert.equal(stored,'C');assert.equal(returned,'C');assert.equal(matchCalls,2);
  });
}

// 同一條競態再把第三次（OLD 完成後 replay NEW）刻意打失敗。此時不能因 endpoint 吞掉 cache
// 錯誤就讓 OLD 留在長 TTL；helper 必須刪掉整組，寧可讓下一次 miss。
{
  const releaseOld=deferred();let putCall=0,stored=null,deletes=0;const writes=[];
  const edge={
    async put(_key,response){
      const body=await response.text();const call=++putCall;
      if(call===1)await releaseOld.promise;
      if(call===3)throw new Error('fixture replay failed');
      stored=body;writes.push(body);
    },
    async delete(){stored=null;deletes++;return true;},
  };
  const entry=body=>[{key:new Request('https://verify.invalid/cache-replay-error'),body,headers:{'content-type':'application/json'}}];
  const oldWrite=result(bus.orderedBusCachePut(edge,'cache-replay-error',entry('OLD')));
  await tick();
  await bus.orderedBusCachePut(edge,'cache-replay-error',entry('NEW'));
  releaseOld.resolve();
  const oldResult=await oldWrite;
  check('公車 cache replay 失敗會清掉倒退值，下一次改走 miss',()=>{
    assert.equal(oldResult.ok,false);
    assert.deepEqual(writes,['NEW','OLD']);
    assert.equal(deletes,1);
    assert.equal(stored,null);
  });
}

// 若連 delete 都壞掉，保留 quarantine state：同 isolate 後續不得命中已知可疑的 edge 值；下一輪
// 成功寫入會解除隔離並回收 state，不能永久把該 key 變成每次都 miss。
{
  const key=new Request('https://verify.invalid/cache-quarantine');
  let stored='STALE',failWrite=true,matchCalls=0;
  const edge={
    async put(_key,response){const body=await response.text();stored=body;if(failWrite)throw new Error('fixture put failed');},
    async delete(){throw new Error('fixture delete failed');},
    async match(){matchCalls++;return new Response(stored);},
  };
  const entry=body=>[{key,body,headers:{'content-type':'text/plain'}}];
  const poisoned=await result(bus.orderedBusCachePut(edge,key.url,entry('BROKEN')));
  const blockedHit=await bus.matchBusCache(edge,key);
  check('公車 cache 清除也失敗時會隔離該 key，不讀已知可疑值',()=>{
    assert.equal(poisoned.ok,false);assert.equal(blockedHit,undefined);assert.equal(matchCalls,0);
  });
  failWrite=false;
  await bus.orderedBusCachePut(edge,key.url,entry('RECOVERED'));
  const recoveredHit=await bus.matchBusCache(edge,key);
  const recoveredText=await recoveredHit.text();
  check('公車 cache 隔離後可由下一輪成功寫入解除，不永久累積 state',()=>{
    assert(recoveredHit);assert.equal(recoveredText,'RECOVERED');assert.equal(matchCalls,1);
  });
}

// 再走一次真實 route-stops IO 編排，不只驗 helper：A 已進 edge.put 才被回收，B 的 S2 新資料先寫完，
// 最後放 A 回來。若 endpoint 漏接 generation/replay，這裡會重現 cache 最後留 OLD 的退步。
{
  const priorFetch=globalThis.fetch,priorCaches=globalThis.caches,realDateNow=Date.now;
  const releaseOldPut=deferred(),oldPutEntered=deferred(),edgeRows=new Map(),writes=[];
  let fakeNow=realDateNow(),routeVersion='OLD',firstPut=true,oldRouteSignal=null;
  globalThis.caches={default:{
    async match(request){const body=edgeRows.get(request.url);return body==null?undefined:new Response(body,{headers:{'content-type':'application/json'}});},
    async put(request,response){
      const body=await response.text();
      if(firstPut){firstPut=false;oldPutEntered.resolve();await releaseOldPut.promise;}
      edgeRows.set(request.url,body);writes.push(JSON.parse(body).rows[0].marker);
    },
  }};
  globalThis.fetch=async(urlLike,options={})=>{
    const url=new URL(typeof urlLike==='string'?urlLike:urlLike.url||urlLike.href);
    if(url.hostname==='auth.verify.invalid')return Response.json({access_token:'fixture-bus-token',expires_in:3600});
    if(url.hostname==='bus.verify.invalid'){
      if(routeVersion==='OLD')oldRouteSignal=options.signal;
      return Response.json([{marker:routeVersion}]);
    }
    throw new Error(`未預期的實際 route-stops fixture URL：${url}`);
  };
  Date.now=()=>fakeNow;
  try {
    bus.resetBusTransferCaches();
    const request=new Request('https://verify.invalid/api/bus-route-stops');
    const env={
      TDX_CLIENT_ID:'fixture',TDX_CLIENT_SECRET:'fixture',
      TDX_AUTH_URL_OVERRIDE:'https://auth.verify.invalid/token',
      BUS_STOP_ROUTE_BASE_URL_OVERRIDE:'https://bus.verify.invalid/live',
    };
    const arrival={key:'route-cache-race',scope:'City/Taipei',routeUid:'TPE1',subRouteUid:'TPE101',direction:0};
    const oldCall=result(bus.cachedBusRouteStopsRaw(request,env,arrival));
    await oldPutEntered.promise;
    routeVersion='NEW';fakeNow+=bus.BUS_INFLIGHT_RECLAIM_MS;
    const newCall=await result(bus.cachedBusRouteStopsRaw(request,env,arrival));
    const cacheUrl=[...edgeRows.keys()][0];
    check('真實 route-stops：新 owner 可回應並先留下 NEW cache',()=>{
      assert.equal(newCall.ok,true);assert.equal(newCall.value.rows[0].marker,'NEW');
      assert.equal(JSON.parse(edgeRows.get(cacheUrl)).rows[0].marker,'NEW');
      assert.equal(oldRouteSignal.aborted,true);
    });
    releaseOldPut.resolve();
    const oldResult=await oldCall;
    check('真實 route-stops：舊 owner 晚寫完後 cache 仍是 NEW',()=>{
      assert.equal(oldResult.ok,true);
      assert.deepEqual(writes,['NEW','OLD','NEW']);
      assert.equal(JSON.parse(edgeRows.get(cacheUrl)).rows[0].marker,'NEW');
    });
  } finally {
    Date.now=realDateNow;globalThis.fetch=priorFetch;globalThis.caches=priorCaches;
  }
}

// 最壞情況不是 A 晚回，而是 A.put 永遠不 settle。B 接手並成功寫 cache 後，雖然 state 因 A 還在而
// 留著，C 仍要驗 body 等於 latest B 後直接命中；不能每位訪客都再打一發昂貴 S2。
{
  const priorFetch=globalThis.fetch,priorCaches=globalThis.caches,realDateNow=Date.now;
  const oldPutEntered=deferred(),edgeRows=new Map();
  let fakeNow=realDateNow(),routeVersion='HUNG_OLD',putCalls=0,matchCalls=0,routeCalls=0,oldRouteSignal=null;
  globalThis.caches={default:{
    async match(request){
      matchCalls++;const body=edgeRows.get(request.url);
      return body==null?undefined:new Response(body,{headers:{'content-type':'application/json'}});
    },
    async put(request,response){
      const body=await response.text();putCalls++;
      if(putCalls===1){oldPutEntered.resolve();return await new Promise(()=>{});}
      edgeRows.set(request.url,body);
    },
  }};
  globalThis.fetch=async(urlLike,options={})=>{
    const url=new URL(typeof urlLike==='string'?urlLike:urlLike.url||urlLike.href);
    if(url.hostname==='auth-hang.verify.invalid')return Response.json({access_token:'fixture-bus-token',expires_in:3600});
    if(url.hostname==='bus-hang.verify.invalid'){
      routeCalls++;
      if(routeVersion==='HUNG_OLD')oldRouteSignal=options.signal;
      return Response.json([{marker:routeVersion}]);
    }
    throw new Error(`未預期的永久 put fixture URL：${url}`);
  };
  Date.now=()=>fakeNow;
  try {
    bus.resetBusTransferCaches();
    const request=new Request('https://verify.invalid/api/bus-route-stops');
    const env={
      TDX_CLIENT_ID:'fixture',TDX_CLIENT_SECRET:'fixture',
      TDX_AUTH_URL_OVERRIDE:'https://auth-hang.verify.invalid/token',
      BUS_STOP_ROUTE_BASE_URL_OVERRIDE:'https://bus-hang.verify.invalid/live',
    };
    const arrival={key:'route-put-hang',scope:'City/Taipei',routeUid:'TPE2',subRouteUid:'TPE201',direction:0};
    void result(bus.cachedBusRouteStopsRaw(request,env,arrival));
    await oldPutEntered.promise;
    routeVersion='LATEST';fakeNow+=bus.BUS_INFLIGHT_RECLAIM_MS;
    const replacement=await bus.cachedBusRouteStopsRaw(request,env,arrival);
    const follower=await bus.cachedBusRouteStopsRaw(request,env,arrival);
    check('真實 route-stops：舊 put 永掛時，B 寫成功後 C 命中 B，不打第三發上游',()=>{
      assert.equal(replacement.cacheState,'miss');assert.equal(replacement.rows[0].marker,'LATEST');
      assert.equal(follower.cacheState,'hit');assert.equal(follower.rows[0].marker,'LATEST');
      assert.equal(routeCalls,2);assert.equal(putCalls,2);assert.equal(matchCalls,3);
      assert.equal(oldRouteSignal.aborted,true);
    });
  } finally {
    Date.now=realDateNow;globalThis.fetch=priorFetch;globalThis.caches=priorCaches;
  }
}

const functionBody=name=>{
  const start=workerSource.indexOf(`async function ${name}(`);
  assert(start>=0,`找不到 ${name}`);
  const next=workerSource.indexOf('\nasync function ',start+1);
  return workerSource.slice(start,next<0?workerSource.length:next);
};
for(const [name,mapName] of [
  ['cachedBusTransferRaw','busTransferInflight'],
  ['cachedBusRouteStopsRaw','busRouteStopsInflight'],
  ['cachedBusLegRaw','busLegInflight'],
  ['directBulkSnapshot','busStopInflight'],
  ['tdxStopSnapshot','busStopInflight'],
])check(`${name} 已接上有限等待 helper`,()=>{
  const body=functionBody(name);
  assert(body.includes(`sharedBusInflight(${mapName},`));
  assert(!body.includes(`${mapName}.has(`));
});
for(const name of ['cachedBusTransferRaw','cachedBusRouteStopsRaw','cachedBusLegRaw','tdxStopSnapshot'])check(`${name} 的 edge cache 寫入已防舊輪倒灌`,()=>{
  const body=functionBody(name);
  assert(body.includes('async ({ signal, isCurrent })'));
  assert(body.includes('matchBusCache(edge, cacheKey)'));
  assert(body.includes('orderedBusCachePut('));
});

// 同一張 Map 的不同 key 必須獨立；一站上游卡住不可拖垮另一站。
{
  const map=new Map(),hang=new Promise(()=>{});let nowMs=2000,calls=0;
  const options={waitMaxMs:20,reclaimMs:60,now:()=>nowMs};
  const stuck=result(bus.sharedBusInflight(map,'stuck',()=>{calls++;return hang;},options));
  const healthy=await result(bus.sharedBusInflight(map,'healthy',()=>{calls++;return Promise.resolve('OK');},options));
  check('公車不同 inflight key 互不阻塞',()=>{assert(healthy.ok);assert.equal(healthy.value,'OK');assert.equal(calls,2);});
  await stuck;
}

globalThis.fetch=realFetch;
globalThis.caches=realCaches;
console.log(`\nWorker inflight 復原 ${checks-failures}/${checks} 通過`);
if(failures)console.error(`${failures} 項未過`);
process.exit(failures?1:0); // 結束故意留下的永不 settle fixture 與其長 timer

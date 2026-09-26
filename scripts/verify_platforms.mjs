import assert from 'node:assert/strict';
import {normalizePlatformSnapshot,resolvePlatform,platformEventAt} from '../rail-platform.js';
import {
  createPlatformProxy, PLATFORM_MEM_TTL_MS, PLATFORM_REFRESH_WAIT_MAX_MS,
  PLATFORM_REFRESH_RECLAIM_MS, PLATFORM_FAIL_TTL_MS,
} from './tra_platform_proxy.mjs';
const date='2026-09-07T00:01:00+08:00',now=Date.parse(date);
const stationInfo={臺北:{id:'1000',name:'臺北'},彰化:{id:'3360',name:'彰化'}};
const record=(props={})=>({StationID:'1000',TrainNo:'123',Platform:'1A',ScheduleArrivalTime:'23:59:00',ScheduleDepartureTime:'00:03:00',UpdateTime:date,RunningStatus:0,...props});
const raw=rows=>({UpdateTime:date,SrcUpdateTime:date,StationLiveBoards:rows});
const target={sys:'tra',stationName:'台北',trainNo:'123',kind:'departure',scheduledAt:Date.parse('2026-09-07T00:03:00+08:00')};
let checks=0;
function check(name,f){f();checks++;console.log('✓ '+name);}
check('跨午夜到站與離站分屬正確日期',()=>{
  const s=normalizePlatformSnapshot(raw([record()]),stationInfo,now);
  assert.equal(s.records[0].arrivalAt,Date.parse('2026-09-06T23:59:00+08:00'));
  assert.equal(s.records[0].departureAt,target.scheduledAt);
  assert.equal(resolvePlatform(s,target,now).platform,'1A');
  assert.equal(resolvePlatform(s,{...target,kind:'arrival',scheduledAt:s.records[0].arrivalAt},now).platform,'1A');
});
check('月台改號採最新值，00、空值與取消都撤回原號碼',()=>{
  for(const [Platform,state]of [['2B','known'],['00','undecided'],['','unavailable'],[null,'unavailable']]){
    const s=normalizePlatformSnapshot(raw([record({Platform})]),stationInfo,now);
    const r=resolvePlatform(s,target,now);assert.equal(r.state,state);assert.equal(r.platform,state==='known'?'2B':null);
  }
  assert.equal(resolvePlatform(normalizePlatformSnapshot(raw([record({RunningStatus:2})]),stationInfo,now),target,now).platform,null);
});
check('車站、系統、日期、通過車及回放都不可錯配',()=>{
  const s=normalizePlatformSnapshot(raw([record()]),stationInfo,now);
  for(const patch of [{stationName:'彰化'},{sys:'thsr'},{scheduledAt:target.scheduledAt+86400000},{kind:'pass'},{live:false},{trainNo:'124'}])assert.equal(resolvePlatform(s,{...target,...patch},now).platform,null);
});
check('到期瞬間移除；舊資料重新收到不能延長',()=>{
  const s=normalizePlatformSnapshot(raw([record()]),stationInfo,now);
  assert.equal(resolvePlatform(s,target,now+179999).platform,'1A');
  assert.equal(resolvePlatform(s,target,now+180000).platform,null);
  const stale=normalizePlatformSnapshot(raw([record()]),stationInfo,now+600000);
  assert.equal(resolvePlatform(stale,target,now+600000).platform,null);
});
check('列自身停更、未來時戳、錯誤時間與格式不當都保守處理',()=>{
  const s=normalizePlatformSnapshot(raw([record({UpdateTime:'2026-09-06T23:50:00+08:00'})]),stationInfo,now);
  assert.equal(resolvePlatform(s,target,now).platform,null);
  assert.throws(()=>normalizePlatformSnapshot({...raw([]),UpdateTime:'2026-09-08T00:00:00+08:00'},stationInfo,now));
  assert.equal(platformEventAt('27:99:00',now),null);
  assert.equal(platformEventAt('12:00:00',now),null);
  assert.throws(()=>normalizePlatformSnapshot({},stationInfo,now));
});
check('同時刻互相矛盾不挑任一月台，較新空值取代舊號碼',()=>{
  let s=normalizePlatformSnapshot(raw([record(),record({Platform:'2A'})]),stationInfo,now);
  assert.equal(resolvePlatform(s,target,now).platform,null);
  s=normalizePlatformSnapshot(raw([record({UpdateTime:'2026-09-07T00:00:00+08:00'}),record({Platform:''})]),stationInfo,now);
  assert.equal(resolvePlatform(s,target,now).platform,null);
});
let calls=0,clock=now,fail=false;
const proxy=createPlatformProxy({getToken:async()=> 'fixture-token',now:()=>clock,fetcher:async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(new URL(url).searchParams.get('$top'),'10000');
  assert.equal(options.headers.authorization,'Bearer fixture-token');
  await new Promise(r=>setTimeout(r,5));return fail?new Response('',{status:302}):Response.json(raw([record()]));
}});
const request=new Request('https://example.test/api/tra-platforms');
const responses=await Promise.all(Array.from({length:8},()=>proxy(request,{},{})));
check('多人同時查月台只刷新一次上游，參數固定',()=>{assert.equal(calls,1);assert(responses.every(r=>r.status===200));});
clock+=60000;fail=true;
const fallback=await(await proxy(request,{},{})).json();
check('上游轉址不跟隨；保留舊原始有效期限供客戶端撤回',()=>{assert.equal(fallback.expiresAt,now+180000);assert.equal(calls,2);});
await proxy(request,{},{});
check('來源失敗有退避，畫面刷新不狂打 API',()=>assert.equal(calls,2));

check('刷新等待、放掉與快取週期的關係固定',()=>{
  assert(PLATFORM_REFRESH_WAIT_MAX_MS<PLATFORM_REFRESH_RECLAIM_MS);
  assert(PLATFORM_REFRESH_RECLAIM_MS>=PLATFORM_MEM_TTL_MS);
});

// 發起 request 被取消時，fetch／body 可能永遠不 settle，不能只信 AbortSignal。用一發故意不理 abort
// 的上游證明：同時查詢仍併流、caller 有總截止、下一輪能恢復，而且舊回應晚到不會覆寫新快照。
let recoveryCalls=0,recoveryClock=now,firstSignal,releaseFirst;
const firstUpstream=new Promise(resolve=>{releaseFirst=resolve;});
const recoveryProxy=createPlatformProxy({
  getToken:async()=> 'fixture-token',now:()=>recoveryClock,refreshWaitMs:30,reclaimMs:60,
  fetcher:async(url,options)=>{
    recoveryCalls++;
    if(recoveryCalls===1){firstSignal=options.signal;return await firstUpstream;}
    return Response.json(raw([record({Platform:'2B'})]));
  },
});
const recoveryStarted=performance.now();
const timedOut=await Promise.all([recoveryProxy(request,{},{}),recoveryProxy(request,{},{} )]);
const recoveryElapsed=Math.round(performance.now()-recoveryStarted);
check('上游永不回應時，同時查詢只打一發且在總截止內回退',()=>{
  assert.equal(recoveryCalls,1);
  assert(timedOut.every(response=>response.status===503));
  assert(recoveryElapsed<500,`實際等待 ${recoveryElapsed}ms`);
  assert.equal(firstSignal.aborted,true);
});
recoveryClock+=PLATFORM_FAIL_TTL_MS+1;
const recovered=await recoveryProxy(request,{},{});
const recoveredBody=await recovered.json();
check('截止後下一輪可重抓並採用新月台',()=>{
  assert.equal(recovered.status,200);
  assert.equal(recoveryCalls,2);
  assert.equal(recoveredBody.records[0].platform,'2B');
});
releaseFirst(Response.json(raw([record({Platform:'1A'})])));
await new Promise(resolve=>setTimeout(resolve,0));
const afterLate=await(await recoveryProxy(request,{},{})).json();
check('已截止的舊回應晚到不覆寫新快照',()=>assert.equal(afterLate.records[0].platform,'2B'));

// Cloudflare request 被取消時，該 request 的 timer 也可能一起消失。這裡把所有 timer 換成永不
// 觸發的 fixture，證明復原確實走 owner 年齡 reclaim，而不是前一項測試的硬截止清場。
let reclaimCalls=0,reclaimClock=now,reclaimSignal,releaseStranded;
const strandedUpstream=new Promise(resolve=>{releaseStranded=resolve;});
const reclaimProxy=createPlatformProxy({
  getToken:async()=> 'fixture-token',now:()=>reclaimClock,refreshWaitMs:30,reclaimMs:60,
  setTimer:()=>Symbol('vanished-timer'),clearTimer:()=>{},
  fetcher:async(url,options)=>{
    reclaimCalls++;
    if(reclaimCalls===1){reclaimSignal=options.signal;return await strandedUpstream;}
    return Response.json(raw([record({Platform:'3A'})]));
  },
});
const strandedCaller=reclaimProxy(request,{},{});
await new Promise(resolve=>setTimeout(resolve,0));
reclaimClock+=60;
const reclaimedResponse=await reclaimProxy(request,{},{});
const reclaimedBody=await reclaimedResponse.json();
releaseStranded(Response.json(raw([record({Platform:'1A'})])));
const oldCallerBody=await(await strandedCaller).json();
check('owner 的 timer 隨 request 消失時，滿週期可 reclaim 且舊回應不覆寫新月台',()=>{
  assert.equal(reclaimCalls,2);
  assert.equal(reclaimSignal.aborted,true);
  assert.equal(reclaimedBody.records[0].platform,'3A');
  assert.equal(oldCallerBody.records[0].platform,'3A');
});
console.log(`月台核心／代理 ${checks}/${checks} 通過`);

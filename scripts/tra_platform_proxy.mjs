import {normalizePlatformSnapshot} from '../rail-platform.js';
import stationInfo from '../data/tra_station_info.json' with {type:'json'};

// 所有看板與小工具共用全台一次快照；只在有人查看月台時刷新，不增加 cron。
// 與既有代理相同，快取是每個 colo / isolate 各一份，不是全球單一份。
const upstream='https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/StationLiveBoard?'+new URLSearchParams({
  '$select':'StationID,TrainNo,Platform,ScheduleArrivalTime,ScheduleDepartureTime,RunningStatus,UpdateTime',
  '$top':'10000','$format':'JSON'});
export const PLATFORM_MEM_TTL_MS=55000;
export const PLATFORM_REFRESH_WAIT_MAX_MS=12000;
export const PLATFORM_REFRESH_RECLAIM_MS=PLATFORM_MEM_TTL_MS;
export const PLATFORM_FAIL_TTL_MS=15000;

export function createPlatformProxy({
  getToken,invalidateToken=()=>{},fetcher=fetch,now=Date.now,
  refreshWaitMs=PLATFORM_REFRESH_WAIT_MAX_MS,reclaimMs=PLATFORM_REFRESH_RECLAIM_MS,
  setTimer=setTimeout,clearTimer=clearTimeout,
}) {
  let memo=null, fetchedAt=0, inflight=null, failedUntil=0;
  return async function(request,env,ctx) {
    const key=new Request(new URL('/api/tra-platforms',request.url)), edge=globalThis.caches?.default;
    const hit=await edge?.match(key);if(hit)return hit;
    try {
      if (now()<failedUntil) throw Error('月台來源暫時無法使用');
      if (!memo || now()-fetchedAt>=PLATFORM_MEM_TTL_MS) {
        let ride=inflight;
        // AbortSignal 只是通知，不保證 fetcher／response.json 一定 settle；發起 request 被取消時，它的
        // timer 也可能一起消失。因此每位 caller 有自己的有限等待，滿一個正常刷新週期才放掉死 owner。
        if(ride&&now()-ride.at>=reclaimMs){if(inflight===ride){ride.controller.abort();inflight=null;}ride=null;}
        if(!ride){
          const controller=new AbortController(),mine={at:now(),controller,p:null};
          inflight=mine;
          let deadlineTimer;
          const work=Promise.resolve().then(async()=>{
            const response=await fetcher(upstream,{headers:{authorization:'Bearer '+await getToken(env)},redirect:'manual',signal:controller.signal});
            if(!response.ok){const error=Error('月台來源暫時無法使用');error.unauthorized=response.status===401;throw error;}
            return normalizePlatformSnapshot(await response.json(),stationInfo,now());
          });
          const deadline=new Promise((_,reject)=>{deadlineTimer=setTimer(()=>{controller.abort();reject(Error('月台來源逾時'));},refreshWaitMs);});
          mine.p=Promise.race([work,deadline]).then(next=>{
            if(inflight===mine){memo=next;fetchedAt=now();failedUntil=0;}
          }).catch(error=>{
            if(inflight===mine){if(error.unauthorized)invalidateToken();failedUntil=now()+PLATFORM_FAIL_TTL_MS;}
            throw error;
          }).finally(()=>{clearTimer(deadlineTimer);if(inflight===mine)inflight=null;});
          ride=mine;
        }
        let waiterTimer;
        try {
          await Promise.race([ride.p,new Promise((_,reject)=>{
            waiterTimer=setTimer(()=>reject(Error('月台來源等待逾時')),Math.max(0,refreshWaitMs-(now()-ride.at)));
          })]);
        } finally { clearTimer(waiterTimer); }
      }
      const response=Response.json(memo,{headers:{'cache-control':'public, max-age=15, s-maxage=55'}});
      const put=edge?.put(key,response.clone()).catch(()=>{});if(put)ctx?.waitUntil?.(put);
      return response;
    } catch {
      // 錯誤不延長月台有效期，也不以重新收到回應的時間偽裝新鮮。
      return Response.json(memo||{schema:1,source:'TDX StationLiveBoard',at:null,expiresAt:0,records:[]},
        {status:memo?200:503,headers:{'cache-control':'no-store'}});
    }
  };
}

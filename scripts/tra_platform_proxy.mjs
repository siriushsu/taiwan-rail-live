import {normalizePlatformSnapshot} from '../rail-platform.js';
import stationInfo from '../data/tra_station_info.json' with {type:'json'};

// 所有看板與小工具共用全台一次快照；只在有人查看月台時刷新，不增加 cron。
// 與既有代理相同，快取是每個 colo / isolate 各一份，不是全球單一份。
const upstream='https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/StationLiveBoard?'+new URLSearchParams({
  '$select':'StationID,TrainNo,Platform,ScheduleArrivalTime,ScheduleDepartureTime,RunningStatus,UpdateTime',
  '$top':'10000','$format':'JSON'});
export function createPlatformProxy({getToken,invalidateToken=()=>{},fetcher=fetch,now=Date.now}) {
  let memo=null, fetchedAt=0, inflight=null, failedUntil=0;
  return async function(request,env,ctx) {
    const key=new Request(new URL('/api/tra-platforms',request.url)), edge=globalThis.caches?.default;
    const hit=await edge?.match(key);if(hit)return hit;
    try {
      if (now()<failedUntil) throw Error('月台來源暫時無法使用');
      if (!memo || now()-fetchedAt>=55000) {
        if (!inflight) inflight=(async()=>{
          const response=await fetcher(upstream,{headers:{authorization:'Bearer '+await getToken(env)},redirect:'manual',signal:AbortSignal.timeout(12000)});
          if (response.status===401) invalidateToken();
          if (!response.ok) throw Error('月台來源暫時無法使用');
          memo=normalizePlatformSnapshot(await response.json(),stationInfo,now());fetchedAt=now();
        })().catch(error=>{failedUntil=now()+15000;throw error;}).finally(()=>{inflight=null;});
        await inflight;
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

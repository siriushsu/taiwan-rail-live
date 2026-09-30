// 真正呼叫 Worker 路由，mock 官方上游、Cache API 與時鐘；不打真實服務。
import assert from 'node:assert/strict';
import fs from 'node:fs';
const original={Date:globalThis.Date,fetch:globalThis.fetch,caches:globalThis.caches};
let now=Date.parse('2026-09-30T02:30:00Z'),count=0,fail=false;
class ClockDate extends original.Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
globalThis.Date=ClockDate;
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch=async input=>{
  assert.match(String(input),/^https:\/\/trainstatus\.ntmetro\.com\.tw\/roadmap\/(ankeng|danhai)_data\.php$/);
  count++;if(fail)throw Error('fixture offline');
  return new Response(JSON.stringify({data:{gpsData:[{K02:{routeId:1,time:50,carNum:'212'}},{}]}}));
};
try{
  const worker=(await import('../worker.js?ntm-proxy-contract')).default;
  const call=sys=>worker.fetch(new Request('https://railisland.test/api/ntmetro-live?sys='+sys),{}, {waitUntil(){}});
  const first=await call('ankeng'),a=await first.json();
  assert.equal(first.status,200);assert.equal(count,1);
  assert.match(first.headers.get('cache-control'),/s-maxage=20(?:,|$)/);
  assert(!first.headers.get('cache-control').includes('stale-while-revalidate'));
  now+=19000;const b=await (await call('ankeng')).json();
  assert.equal(count,1);assert.equal(b.at,a.at,'快取不能改寫 at 續命');
  now+=1000;const c=await (await call('ankeng')).json();
  assert.equal(count,2);assert.equal(Date.parse(c.at)-Date.parse(a.at),20000);
  now+=20000;fail=true;const d=await(await call('ankeng')).json();
  assert.equal(d.at,c.at,'斷線不能把舊資料變成剛取得');
  const missing=await(await call('danhai')).json();assert.equal(missing.src,null);
  const before=count;const invalid=await call('__proto__');assert.equal(invalid.status,400);assert.equal(count,before);
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert(html.includes('setInterval(pollNtmLive, 20e3)'));
  assert(html.includes('finally { state._ntmPolling = false; }'));
  console.log('PASS NTM Worker：20 秒刷新、快取時間不重置、無 SWR 延長、失敗不續命、負快取、白名單、前端防重入');
}finally{Object.assign(globalThis,original);}

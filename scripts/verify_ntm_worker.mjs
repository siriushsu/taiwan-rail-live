// 真正呼叫 Worker 路由，mock 官方上游、Cache API 與時鐘；不打真實服務。
import assert from 'node:assert/strict';
import fs from 'node:fs';
const original={Date:globalThis.Date,fetch:globalThis.fetch,caches:globalThis.caches};
let now=Date.parse('2026-09-30T02:30:00Z'),count=0,fail=false,useEdge=false;
class ClockDate extends original.Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
globalThis.Date=ClockDate;
const edge=new Map();
// 刻意讓 Cache API 保留超齡回覆，模擬舊部署的長 TTL，驗 handler 自己仍會拒絕。
globalThis.caches={default:{match:async req=>useEdge?edge.get(req.url)?.clone():null,
  put:async(req,res)=>edge.set(req.url,res.clone())}};
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
  assert.match(first.headers.get('cache-control'),/s-maxage=18(?:,|$)/);
  assert(!first.headers.get('cache-control').includes('stale-while-revalidate'));
  now+=17000;const second=await call('ankeng'),b=await second.json();
  assert.equal(count,1);assert.equal(b.at,a.at,'快取不能改寫 at 續命');
  assert.match(second.headers.get('cache-control'),/s-maxage=1(?:,|$)/,'記憶體快取不能多續一輪');
  now+=1000;const c=await (await call('ankeng')).json();
  assert.equal(count,2);assert.equal(Date.parse(c.at)-Date.parse(a.at),18000);
  useEdge=true;
  now+=17000;const hit=await call('ankeng');assert.equal(count,2);
  assert.equal((await hit.json()).at,c.at);
  assert.match(hit.headers.get('cache-control'),/s-maxage=1(?:,|$)/,'Cache API 命中也不能重送完整 TTL');
  now+=500;const fractional=await call('ankeng');assert.match(fractional.headers.get('cache-control'),/s-maxage=0(?:,|$)/);
  now+=500;const expired=await(await call('ankeng')).json();
  assert.equal(count,3,'即使 Cache API 還回舊部署的長快取，也須重新取數');
  assert.equal(Date.parse(expired.at)-Date.parse(c.at),18000);
  // 實測前端第二次請求可能比上一輪收到回覆只晚 18.8s；不可因此延到 40s 才換批。
  for(let i=0;i<4;i++){const prior=count;now+=18800;const r=await(await call('ankeng')).json();assert.equal(count,prior+1);assert.equal(Date.parse(r.at),now);}
  const last=await(await call('ankeng')).json();
  now+=20000;fail=true;const d=await(await call('ankeng')).json();
  assert.equal(d.at,last.at,'斷線不能把舊資料變成剛取得');
  const missing=await(await call('danhai')).json();assert.equal(missing.src,null);
  const failedCount=count;now+=14000;const negative=await call('danhai');assert.equal(count,failedCount);
  assert.match(negative.headers.get('cache-control'),/s-maxage=1(?:,|$)/,'負快取同樣只剩餘 1 秒');
  const before=count;const invalid=await call('__proto__');assert.equal(invalid.status,400);assert.equal(count,before);
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert(html.includes('setInterval(pollNtmLive, 20e3)'));
  assert(html.includes('finally { state._ntmPolling = false; }'));
  console.log('PASS NTM Worker：18 秒 TTL／20 秒輪詢餘裕、記憶體及 Cache API 剩餘壽命、舊部署超齡快取拒絕、失敗不續命、負快取、白名單、前端防重入');
}finally{Object.assign(globalThis,original);}

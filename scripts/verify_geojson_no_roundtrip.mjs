// vendor/maplibre-gl.js 移植了上游的 GeoJSONWorkerSource.loadData 修正:setData 傳物件時,worker 不再把整份
// GeoJSON 送回主執行緒。5.9.0 原版每次都送回,跟車時車站遮罩每 15s 重送 remainders(台北車站約 1.4 萬分件),
// 送回＋反序列化在桌面 4x 降速佔 60–110ms,就是那格週期性長幀(2026-09-23 CDP profile 分解)。
// 換引擎版本或重新下載 vendor 時這兩行很容易被默默蓋掉,所以量行為、不比對字串:
//   A 物件 setData:worker 回應不帶資料,主執行緒 _data 是原物件,圖磚照樣畫得出新資料
//   B 網址載入(對照組,證明偵測器看得到回傳):照舊回傳,_data 換成解析後的資料
//   C updateData 差分:照舊回傳,_data 跟著差分更新
// 用法:node scripts/verify_geojson_no_roundtrip.mjs(自帶伺服器;ENGINE=chromium 只跑一個引擎)
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const square=(i,n,k=i)=>{const x=121.49+(i%n)*0.0004,y=25.04+Math.floor(i/n)*0.0004;return {type:'Feature',id:k+1,properties:{k},geometry:{type:'Polygon',coordinates:[[[x,y],[x+0.0003,y],[x+0.0003,y+0.0003],[x,y+0.0003],[x,y]]]}};};
const collection=(count,offset=0)=>({type:'FeatureCollection',features:Array.from({length:count},(_,i)=>square(i,50,i+offset))});
const page=`<!doctype html><link rel="stylesheet" href="/vendor/maplibre-gl.css"><div id="m" style="width:600px;height:400px"></div><script src="/vendor/maplibre-gl.js"></script>`;
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');
  if(u.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end(page);
  if(u.pathname==='/fc.json')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(collection(+u.searchParams.get('n'),5000)));
  const f=path.join(root,decodeURIComponent(u.pathname));
  if(!u.pathname.startsWith('/vendor/')||!fs.existsSync(f))return res.writeHead(404).end();
  res.writeHead(200,{'content-type':f.endsWith('.css')?'text/css':'text/javascript'}).end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
console.log('目標 vendor:',path.join(root,'vendor/maplibre-gl.js'));
try{
for(const [name,engine] of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
  const browser=await engine.launch(),context=await browser.newContext();
  // worker 回傳的每則訊息裡找 FeatureCollection,記最大的 features 數(遮罩那份就是這樣整份送回來的)。
  await context.addInitScript(()=>{window.__returned=[];const find=(v,d)=>{if(!v||typeof v!=='object'||d>6||ArrayBuffer.isView(v)||v instanceof ArrayBuffer)return 0;
      if(v.type==='FeatureCollection'&&Array.isArray(v.features))return v.features.length;let n=0;for(const k in v)n=Math.max(n,find(v[k],d+1));return n;};
    const W=window.Worker;window.Worker=function(...a){const w=new W(...a);w.addEventListener('message',e=>window.__returned.push(find(e.data,0)));return w;};window.Worker.prototype=W.prototype;});
  const tab=await context.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));
  await tab.goto(base);
  await tab.evaluate(()=>new Promise(done=>{window.map=new maplibregl.Map({container:'m',style:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#000'}}]},center:[121.5,25.045],zoom:14,attributionControl:false});
    map.on('load',()=>{map.addSource('g',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'g',type:'fill',source:'g',paint:{'fill-color':'#fff'}});done();});}));
  // 每一步:清空紀錄 → 呼叫 → 等 worker 做完且圖磚重載 → 回報回傳量、_data 與實際畫得出來的 feature。
  const step=(kind,arg)=>tab.evaluate(({kind,arg})=>new Promise(done=>{const src=map.getSource('g');window.__returned=[];
    const finish=()=>{if(src._isUpdatingWorker||!map.isSourceLoaded('g')||!map.areTilesLoaded())return setTimeout(finish,50);
      const ks=new Set(map.querySourceFeatures('g').map(f=>f.properties.k));const d=src._data;
      done({returned:Math.max(0,...window.__returned),sameObject:d===window.__given,dataCount:d?.features?.length??null,dataType:typeof d,rendered:ks.size,hasFirst:ks.has(arg.first),has0:ks.has(0)});};
    if(kind==='object'){window.__given=arg.fc;src.setData(arg.fc);}else if(kind==='url'){window.__given=null;src.setData(arg.url);}else{window.__given=null;src.updateData(arg.diff);}
    setTimeout(finish,100);}),{kind,arg});
  const n=2000,fc=collection(n);
  const A=await step('object',{fc,first:0});console.log(name,'A 物件 setData',JSON.stringify(A));
  assert.equal(A.returned,0,'A:setData 傳物件時 worker 不可把整份資料送回主執行緒(vendor 的上游移植被蓋掉了?)');
  assert(A.sameObject&&A.dataCount===n,'A:主執行緒 _data 必須是 setData 收到的那份物件');
  assert(A.rendered>100&&A.hasFirst,'A:不回傳之後圖磚仍須畫得出新資料');
  const B=await step('url',{url:base+'fc.json?n=300',first:5000});console.log(name,'B 網址載入',JSON.stringify(B));
  assert.equal(B.returned,300,'B 對照組:網址載入必須照舊回傳(也證明偵測器看得到回傳)');
  assert(B.dataType==='object'&&B.dataCount===300&&B.hasFirst,'B:網址載入後 _data 要換成解析後的資料');
  await step('object',{fc,first:0});
  const C=await step('diff',{diff:{add:[square(n,50)],remove:[1]},first:n});console.log(name,'C updateData',JSON.stringify(C));
  assert.equal(C.returned,n,'C:updateData 差分照舊回傳(主執行緒靠它更新 _data)');
  assert(C.dataCount===n&&C.hasFirst&&!C.has0,'C:差分後 _data 與圖磚都要反映新增／刪除');
  assert.equal(errors.length,0,'頁面錯誤:'+errors.join(' | '));
  await browser.close();
}
console.log('PASS 物件 setData 不回傳資料、網址載入與 updateData 照舊');
}finally{server.close();}

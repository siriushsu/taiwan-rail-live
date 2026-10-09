// 真實無視窗 Chromium／WebKit，測兩套線陣列、手機觸控與模型跨過閉環接點。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),html=await fs.readFile(path.join(root,'index.html'),'utf8'),expected=process.env.EXPECTED_BUILD||html.match(/const BUILD = '([^']+)'/)[1];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.bin':'application/octet-stream','.gz':'application/gzip','.geojson':'application/json','.png':'image/png','.webp':'image/webp'};
let server=null,base=process.env.BASE_URL;
if(!base){server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.join(root,pathname==='/'?'index.html':pathname);if(pathname.startsWith('/api/')||pathname.split('/').some(s=>s.startsWith('.'))||path.relative(root,file).startsWith('..')){res.writeHead(404).end();return;}const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/`;}
const rows=[],widths=process.env.KLRT_WIDTHS?process.env.KLRT_WIDTHS.split(',').map(Number):[360,375,414,600,768,1280];
try{for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch(name==='chromium'?{channel:'chromium',headless:true}:{headless:true});
 try{for(const group of ['south','all']){
  const context=await browser.newContext({viewport:{width:1280,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  await page.route('**/api/**',r=>r.fulfill({status:404,body:'{}',contentType:'application/json'}));
  await page.goto(base+`?g=${group}&scene=3d&t=07:30&at=22.6065,120.3255&z=17&lang=zh-TW`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&metroLivePool().some(l=>l.id==='C'&&l._tt?.length)&&window.railIslandPhysical?.metro&&window.railIslandIntegration?.renderer,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>BUILD),expected,'必須驗當前出貨版本');
  await page.evaluate(()=>{
   state.playing=false;const ln=metroLivePool().find(l=>l.id==='C');
   window.__klrtCase=(direction,dt=0)=>{
    const ia=direction<0?0:37,ib=direction<0?37:0,tr=ln._tt.find(t=>t.some((v,k)=>k%2===0&&v===ia&&t[k+2]===ib&&t[k+1]>=27000));let k=0;while(!(tr[k]===ia&&tr[k+2]===ib))k+=2;const ta=tr[k+1],tb=tr[k+3];
    setSimSec(ta+dt);setFreqFollow({ln,tr});setFollowLock(false);const v=railIslandIntegration.capture().vehicles.find(v=>v.followed);return {id:v.id,ta,tb,lon:v.longitude,lat:v.latitude};
   };
  });
  for(const width of widths){
   await page.setViewportSize({width,height:900});
   const numerical=await page.evaluate(()=>{
    const ln=metroLivePool().find(l=>l.id==='C'),result=[];state.playing=false;
    for(const direction of [1,-1]){
     const first=__klrtCase(direction),tr=state.freqFollow.tr;let previous=null,travel=0,maxStep=0;
     for(let dt=0;dt<=120;dt++){
      setSimSec(first.ta+dt);const v=railIslandIntegration.capture().vehicles.find(v=>v.id===first.id);if(!v||!v.route?.path?.closed)throw Error('未走完整環線');
      const p={lat:v.latitude,lon:v.longitude};if(previous){const step=haversineKm(previous,p)*1000;travel+=step;maxStep=Math.max(maxStep,step);}previous=p;
     }
     result.push({direction,travel,maxStep});
    }return result;
   });
   assert.ok(numerical.every(r=>r.travel>300&&r.travel<600&&r.maxStep<8));
   // 真正送入 renderer 並等車身到位，接點前後與段中都不能掉回號碼或消失。
   for(const direction of [1,-1])for(const dt of [0,.1,60,119.9,120]){
    const picked=await page.evaluate(args=>__klrtCase(...args),[direction,dt]);
    await page.evaluate(p=>M.raw.jumpTo({center:[p.lon,p.lat],zoom:17,pitch:45}),picked);
    await page.waitForFunction(p=>railIslandIntegration.renderer.hasModel(p.id)&&railIslandIntegration.renderer.stats.poseSamples.some(v=>v.id===p.id&&Math.abs(v.coordinate[0]-p.lon)<1e-8&&Math.abs(v.coordinate[1]-p.lat)<1e-8),picked,{timeout:30000});
    const rendered=await page.evaluate(id=>{const r=railIslandIntegration.renderer,p=r.stats.poseSamples.find(p=>p.id===id);return {cars:p.cars.length,finite:p.cars.every(c=>Number.isFinite(c.coordinate[0])&&Number.isFinite(c.height)),offset:p.avoidanceOffsetM||0};},picked.id);
    assert.equal(rendered.cars,5);assert.equal(rendered.finite,true);assert.equal(rendered.offset,0);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'手機水平溢出');
   rows.push({name,group,width,numerical});console.log(JSON.stringify(rows.at(-1)));
  }
  // 觸控真的啟動播放，再用 rAF 看同一輛車走完整段；兩種引擎、兩套陣列都驗。
  await page.setViewportSize({width:375,height:900});
  const picked=await page.evaluate(()=>{state.playing=false;setSpeed(60);return __klrtCase(-1);});
  // 長時間矩陣結束後膠囊可能已收成把手，先以觸控喚回播放鈕。
  if(!await page.locator('#pp').isVisible())await page.tap('.controls');
  await page.tap('#pp');assert.equal(await page.evaluate(()=>state.playing),true);
  const animation=await page.evaluate(async({id,tb})=>{
   const frames=[];await new Promise((resolve,reject)=>{const until=performance.now()+15000;function step(){const v=railIslandIntegration.capture().vehicles.find(v=>v.id===id);if(v)frames.push({t:state.simSec,lat:v.latitude,lon:v.longitude});if(state.simSec>=tb){state.playing=false;resolve();return;}if(performance.now()>until){reject(Error('rAF 播放未完成'));return;}requestAnimationFrame(step);}requestAnimationFrame(step);});
   let travel=0,maxStep=0;for(let i=1;i<frames.length;i++){const d=haversineKm(frames[i-1],frames[i])*1000;travel+=d;maxStep=Math.max(maxStep,d);}return {frames:frames.length,travel,maxStep};
  },picked);
  assert.ok(animation.frames>10&&animation.travel>300&&animation.maxStep<50,JSON.stringify(animation));
  console.log(JSON.stringify({name,group,touchPlayback:animation}));
  // 同一段也確認關閉立體列車後仍有正常的 2D 班表位置。
  await page.evaluate(()=>railIslandIntegration.setMode(false));
  const flat=await page.evaluate(()=>{const a=__klrtCase(-1,0),ln=state.freqFollow.ln,tr=state.freqFollow.tr,p=freqTrainPosAt(ln,tr,a.ta),q=freqTrainPosAt(ln,tr,a.tb);return {travel:haversineKm(p,q)*1000,model:railIslandIntegration.hasModel({ln,tr})};});
  assert.ok(flat.travel>400);assert.equal(!!flat.model,false);assert.deepEqual(errors,[]);
  await context.close();
 }}finally{await browser.close();}
}}finally{server?.close();}
console.log(`高雄輕軌瀏覽器驗收通過：${rows.length} 組雙向／手機矩陣，兩個引擎皆實際觸控播放`);

// BASE_URL 指向 dev_server；PERF_BASE_REV 指定對照 commit。兩份程式在同一台真 GPU、同一資料與視角量測。
// CPU_RATE 只降低 CPU，不代表某款真實裝置；FPS 分別記錄 rAF 與實際地圖 render，不能混用。
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5248/';
const revision=process.env.PERF_BASE_DIR||process.env.PERF_BASE_REV||'HEAD',rate=Number(process.env.CPU_RATE||4),duration=Number(process.env.PERF_MS||6000);
const scenarios=(process.env.PERF_SCENARIOS||'playing,paused,following,dragging').split(',');
const output=process.env.PERF_OUTPUT||'output/3d-performance';fs.mkdirSync(output,{recursive:true});
const sources=new Map(['index.html','rail-3d.js','rail-3d/integration/map3d.js','night-map.js'].map(file=>['/'+file,process.env.PERF_BASE_DIR?fs.readFileSync(path.join(revision,file),'utf8'):execFileSync('git',['show',revision+':'+file],{encoding:'utf8',maxBuffer:8*1024*1024})]));
sources.set('/',sources.get('/index.html'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
try{
 for(const variant of ['baseline','current']){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,locale:'zh-TW',timezoneId:'Asia/Taipei'});
  await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-powersave','0');});
  if(variant==='baseline')await context.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname;
   if(new URL(route.request().url()).origin===new URL(base).origin&&sources.has(path))return route.fulfill({body:sources.get(path),contentType:path==='/'||path.endsWith('.html')?'text/html':'text/javascript'});
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push({variant,message:e.stack}));
  await page.goto(base+'?g=all&scene=3d&t=12:00&at=25.0478,121.517&z=16&lang=zh-TW');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.trains.length>0&&window.railIslandIntegration?.renderer&&!railIslandIntegration.loading&&window.railIslandPhysical,null,{timeout:120000});
  await page.evaluate(()=>{document.body.classList.add('fs');M.resize();clearFollow();clearFreqFollow();M.raw.jumpTo({center:[121.517,25.0478],zoom:16,pitch:60,bearing:0});railIslandIntegration.setGroundMode('terrain');setMap3d(true);state.playing=false;setSimSec(43200);});
  await page.waitForFunction(()=>M.raw.isSourceLoaded('terrain')&&railIslandIntegration.renderer.stats.models>0,null,{timeout:60000});
  await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:60000});
  const readyFrame=await page.evaluate(()=>{const n=railIslandIntegration.renderer.stats.frames;railIslandIntegration.render();M.raw.triggerRepaint();return n;});
  await page.waitForFunction(n=>railIslandIntegration.renderer.stats.frames>n,readyFrame);
  const gpu=await page.evaluate(()=>{const gl=M.raw.painter.context.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
  const geometry=await page.evaluate(()=>{
   const r=railIslandIntegration.renderer,frame=railIslandIntegration.capture();
   const poses=r.stats.poseSamples.map(p=>({id:p.id,coordinate:p.coordinate,height:p.displayHeightM,cars:p.cars.map(c=>({coordinate:c.coordinate,height:c.height,angle:c.angle,pitch:c.pitch,underground:c.underground}))})).sort((a,b)=>a.id.localeCompare(b.id));
   const vehicles=r.projectedVehicles().filter(p=>p.z>=-1&&p.z<=1&&p.x>=0&&p.y>=0&&p.x<=M.getSize().x&&p.y<=M.getSize().y).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,coordinate:p.coordinate})).sort((a,b)=>a.id.localeCompare(b.id));
   // 實體股道兩方向各有獨立、同向的里程軸；用班表方向核對樣本確實涵蓋去程與回程。
   const ids=new Set(poses.map(p=>p.id)),directions=[...new Set(frame.vehicles.filter(v=>ids.has(v.id)).map(v=>v.direction))].sort();
   const labels=[...state._trainHits.map(h=>({key:h.tr.sys+':'+h.tr.train,x:h.x,y:h.y})),...state._freqHits.map(h=>({key:[h.ln._sys,h.ln.id,h.vehicleId??h.k??h.ln._tt?.indexOf(h.tr)].join(':'),x:h.x,y:h.y}))].sort((a,b)=>a.key.localeCompare(b.key));
   const stationLabels=labelBoxes.map(({l,r,t,b,name,opacity,isFav})=>({l,r,t,b,name,opacity,isFav}));
   const transform=M.raw.transform.currentTransform||M.raw.transform;
   return {poses,vehicles,directions,labels,stationLabels,projection:{near:transform.nearZ,far:transform.farZ,minElevation:transform.minElevationForCurrentTile,centerElevation:M.raw.getCenterElevation()}};
  });
  fs.writeFileSync(output+'/'+variant+'-geometry.json',JSON.stringify(geometry,null,2));
  await page.evaluate(()=>{
   window.__perfWork={};
   const wrap=(object,key,label)=>{const fn=object[key];object[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const row=__perfWork[label]||(__perfWork[label]={calls:0,ms:0,maxMs:0});const ms=performance.now()-start;row.calls++;row.ms+=ms;row.maxMs=Math.max(row.maxMs,ms);}};};
   wrap(railIslandIntegration,'render','integration');wrap(railIslandIntegration.renderer,'update','vehicles');wrap(M.raw.painter,'render','map');wrap(window,'draw','overlay');wrap(window,'reproject','projection');
  });
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  for(const scenario of scenarios){
   await page.evaluate(scenario=>{
    clearFollow();clearFreqFollow();setSimSec(43200);state.playing=scenario!=='paused';
    M.raw.jumpTo({center:[121.517,25.0478],zoom:16,pitch:60,bearing:0});
    if(scenario==='following'){const tr=state.trains.find(tr=>tr.sys==='tra_sched'&&tr.train==='117');if(!trainPos(tr,state.simSec))throw Error('跟車樣本必須在途');setFollow(tr,false,true);setFollowLock(true);M.raw.setZoom(16);M.raw.setPitch(60);}
   },scenario);
   await page.waitForTimeout(1800);
   // 真實滑鼠手勢持續 6 秒；量測與輸入平行進行，避免用 fake move 冒充重畫效能。
   const measure=page.evaluate(async duration=>{
    __perfWork={};const times=[],start=performance.now();let last=start;
    const frameStart=railIslandIntegration.renderer.stats.frames;
    const centerStart=M.raw.getCenter().toArray();
    await new Promise(resolve=>{const step=t=>{times.push(t-last);last=t;if(t-start<duration)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
    const elapsed=performance.now()-start;times.sort((a,b)=>a-b);
    return {elapsedMs:elapsed,rafFps:times.length*1000/elapsed,mapFps:(railIslandIntegration.renderer.stats.frames-frameStart)*1000/elapsed,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],over50ms:times.filter(t=>t>50).length,work:__perfWork,models:railIslandIntegration.renderer.stats.models,centerStart,centerEnd:M.raw.getCenter().toArray(),tickErrors:state._tickErrs||[],renderErrors:railIslandIntegration.errors};
   },duration);
   if(scenario==='dragging'){
    const until=Date.now()+duration;let n=0;
    while(Date.now()<until){const right=n++%2===0;await page.mouse.move(right?500:900,470);await page.mouse.down();await page.mouse.move(right?900:500,470,{steps:30});await page.mouse.up();}
   }
   const row={variant,scenario,cpuRate:rate,gpu,...await measure};results.push(row);console.log(JSON.stringify(row));
   assert.equal(row.tickErrors.length+row.renderErrors.length,0,'渲染例外不可當成效能提升');
   if(scenario==='following')assert.notDeepEqual(row.centerEnd,row.centerStart,'跟車效能必須量真的在移動的相機');
  }
  await context.close();
 }
 const before=JSON.parse(fs.readFileSync(output+'/baseline-geometry.json')),after=JSON.parse(fs.readFileSync(output+'/current-geometry.json'));
 assert(before.poses.length>0&&before.vehicles.length>0,'A/B 必須真的畫出列車');
 assert.deepEqual(after.poses,before.poses,'所有可見車廂的座標、高度與姿態必須逐值相同');
 assert.deepEqual(after.vehicles,before.vehicles,'畫面內的點雲投影必須逐值相同');
 assert.deepEqual(after.labels,before.labels,'畫面內可點擊的車牌不能因裁切或模型索引而改變');
 assert.deepEqual(after.stationLabels,before.stationLabels,'站名位置與避讓不能因裁切而改變');
 assert(before.directions.includes(-1)&&before.directions.includes(1),'車體姿態 A/B 必須涵蓋兩個行進方向');
 assert.equal(errors.length,0,'瀏覽器不可有未處理錯誤');
 console.log('PASS A/B 可見車廂與列車投影逐值相同、無渲染例外');
}finally{fs.writeFileSync(output+'/results.json',JSON.stringify({revision,rate,duration,results,errors},null,2));await browser.close();}

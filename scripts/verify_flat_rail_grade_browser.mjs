import fs from 'node:fs';import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:53815/',out='output/flat-rail-grade',checks=[];fs.mkdirSync(out,{recursive:true});
const check=(name,ok,detail)=>{checks.push({name,pass:!!ok,detail});console.log(ok?'PASS':'FAIL',name,JSON.stringify(detail));};
async function setup(page){
 await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
 await page.goto(base+'?g=all&scene=3d&t=22:12&sun=on');await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&window.railIslandPhysical?.portalPaths&&window.railIslandIntegration?.renderer,null,{timeout:120000});
 await page.evaluate(()=>{const tr=state.trains.find(t=>t.train==='167');setFollow(tr,false,true);setSimSec(79920);state.playing=false;railIslandIntegration.setGroundMode('flat');M.raw.setZoom(19);});
 await page.waitForFunction(()=>railIslandIntegration.renderer.stats.poseSamples.some(s=>s.id.includes(':167:')&&s.cars.length===12),null,{timeout:90000});
 await page.evaluate(()=>{const i=railIslandIntegration;window.__flatFrame=i.frame;window.__flatVehicle=i.frame.vehicles.find(v=>v.id.includes(':167:'));window.__flatOldRender=i.render;i.render=()=>{};state.followLock=false;window.__flatUpdate=(s=14728.7,dir=1)=>{const q=__flatVehicle.route.path.at(s).coordinate,v={...__flatVehicle,longitude:q[0],latitude:q[1],chainageM:s,railDirection:dir,followed:true};i.renderer.update({...__flatFrame,vehicles:[v],routes:[v.route],selectedVehicleId:v.id,followLock:false});};document.body.classList.add('fs');M.resize();M.raw.jumpTo({center:__flatVehicle.route.path.at(14728.7).coordinate,zoom:19,pitch:60,bearing:110,padding:{top:0,bottom:100,left:0,right:0}});__flatUpdate();});
 await page.waitForFunction(()=>{__flatUpdate();return !M.raw.isMoving()&&railIslandIntegration.renderer.alignment();},null,{timeout:60000});
}
for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
 const browser=await type.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-TW'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await setup(page);
 for(const dir of [1,-1]){
  const result=await page.evaluate(async dir=>{const r=railIslandIntegration.renderer;let n=0,maxPitch=0,maxStep=0,maxSpan=0,maxRailPx=0,old=[];
   for(let i=0;i<=120;i++){const s=dir===1?14600+i*3:14960-i*3;__flatUpdate(s,dir);await new Promise(requestAnimationFrame);const pose=r.stats.poseSamples.find(p=>p.id===__flatVehicle.id);if(!pose||pose.cars.length!==12)throw Error('列車模型缺失');n++;
    maxSpan=Math.max(maxSpan,Math.max(...pose.cars.map(c=>c.height))-Math.min(...pose.cars.map(c=>c.height)));
    for(let j=0;j<12;j++){maxPitch=Math.max(maxPitch,Math.abs(pose.cars[j].pitch));if(old.length)maxStep=Math.max(maxStep,Math.abs(pose.cars[j].height-old[j]));}old=pose.cars.map(c=>c.height);
    const a=r.alignment();if(!a)throw Error('沒有軌道供跨層比對');maxRailPx=Math.max(maxRailPx,Math.hypot(a.vehicle.x-a.rail.x,a.vehicle.y-a.rail.y));
   }return {n,maxPitch,maxStep,maxSpan,maxRailPx,errors:r.stats.errors,fallbacks:r.stats.modelFallbacks};},dir);
  check(engine+' 167 次雙向動畫 '+dir,result.n===121&&result.maxPitch<.012&&result.maxSpan<1.7&&result.maxStep<.04&&result.maxRailPx<1&&!result.errors.length&&!result.fallbacks.length,result);
 }
 await page.evaluate(()=>{__flatUpdate(14728.7);});await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:90000});await page.screenshot({path:`${out}/${engine}-167-fixed.png`});
 for(const id of ['194060009','146741696']){
  await page.evaluate(async id=>{const pack=await(await fetch('rail-3d/physical/network.json')).json(),wi=pack.ways.findIndex(w=>String(w.id)===id),way=pack.ways[wi],pid=Object.keys(pack.paths).find(k=>pack.paths[k].walk.some(x=>x[0]===wi)),g=railIslandPhysical.geometry,route=g.route([pid],way.system,'#C0392B',{prefixM:200,suffixM:200}),mid=way.coordinates[Math.floor(way.coordinates.length/2)],at=route.path.locate(mid).s;
   window.__groundAt=at;window.__groundRoute=route;
   // 原 167 次模型的首節 offset 為 112.175m；把首節放在具名橋面上，檢查實際算繪高度。
   const s=at-112.175,q=route.path.at(s).coordinate,v={...__flatVehicle,id:'flat-floor:'+id,route,longitude:q[0],latitude:q[1],chainageM:s,railDirection:1,followed:true};
   window.__groundUpdate=()=>railIslandIntegration.renderer.update({...__flatFrame,vehicles:[v],routes:[route],selectedVehicleId:v.id,followLock:false});M.raw.jumpTo({center:mid,zoom:19,pitch:55,bearing:70});__groundUpdate();
  },id);
  await page.waitForFunction(()=>{__groundUpdate();return railIslandIntegration.renderer.stats.poseSamples[0]?.id.startsWith('flat-floor:')&&railIslandIntegration.renderer.stats.poseSamples[0].cars.length===12;},null,{timeout:30000});
  const detail=await page.evaluate(()=>{const r=railIslandIntegration.renderer,car=r.stats.poseSamples[0].cars[0];return {height:car.height,atError:Math.abs(car.s-__groundAt),expected:__groundRoute.level(car.s).flatOffsetM+.65,models:r.stats.models,errors:r.stats.errors};});
  check(engine+' 洞口旁露天橋面不被拉入地下 '+id,detail.height>=.649&&detail.atError<.01&&Math.abs(detail.height-detail.expected)<.001&&detail.models===1&&!detail.errors.length,detail);
 }
 check(engine+' 無瀏覽器錯誤',!errors.length,errors);
 const context=await browser.newContext({viewport:{width:360,height:820},isMobile:true,hasTouch:true,locale:'zh-TW'}),mobile=await context.newPage();await setup(mobile);
 for(const width of [360,375,390,414,520,768]){
  await mobile.setViewportSize({width,height:820});await mobile.evaluate(()=>{M.resize();__flatUpdate();});
  // 手機版刻意隱藏全畫面／縮放鈕；用實際存在的「更多」抽屜驗觸控與開關後的軌道對齊。
  await mobile.tap('#tabMore');await mobile.waitForTimeout(150);await mobile.tap('#moreClose');await mobile.waitForTimeout(150);await mobile.waitForFunction(()=>{__flatUpdate();return !M.raw.isMoving()&&railIslandIntegration.renderer.alignment();});
  const detail=await mobile.evaluate(()=>{__flatUpdate();const r=railIslandIntegration.renderer,a=r.alignment(),b=document.getElementById('tabMore'),box=b.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {width:innerWidth,scroll:document.documentElement.scrollWidth,models:r.stats.models,cars:r.stats.poseSamples[0]?.cars.length,railPx:a?Math.hypot(a.vehicle.x-a.rail.x,a.vehicle.y-a.rail.y):null,reachable:b===hit||b.contains(hit),errors:r.stats.errors};});
  check(engine+' 手機觸控 '+width,detail.scroll<=detail.width+1&&detail.cars===12&&detail.railPx!==null&&detail.railPx<1&&detail.reachable&&!detail.errors.length,detail);
 }
 await mobile.screenshot({path:`${out}/${engine}-mobile-fixed.png`});await context.close();
 }catch(e){check(engine+' 測試完成',false,String(e));}finally{await browser.close();}
}
fs.writeFileSync(process.env.RESULT_FILE||`${out}/browser.json`,JSON.stringify(checks,null,2));console.log({total:checks.length,failed:checks.filter(c=>!c.pass).length});if(checks.some(c=>!c.pass))process.exitCode=1;

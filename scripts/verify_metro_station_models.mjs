import {chromium,webkit} from 'playwright';import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/',rows=[];fs.mkdirSync('output/metro-station-models',{recursive:true});
for(const [engineName,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(),context=await browser.newContext({viewport:{width:1280,height:900},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'?g=all&scene=3d&tracks=legacy');await page.waitForFunction(()=>state.ready&&state.decoLines?.length&&window.railIslandIntegration?.renderer,null,{timeout:60000});
 const alignment=await page.evaluate(()=>state.decoLines.flatMap(ln=>ln.stations.map((s,i)=>({sys:ln._sys,line:ln.id,station:s.name,off:ln.hasShape?haversineKm(s,posBetweenStations(ln,i,i,0))*1000:0}))));
 rows.push({engineName,test:'all metro stops on running geometry',pass:alignment.every(r=>r.off<.01),count:alignment.length,maxM:Math.max(...alignment.map(r=>r.off))});
 await page.evaluate(async()=>{
  state.playing=false;clearFollow();clearFreqFollow();railIslandIntegration.render=()=>{};
  const {makePath}=await import('./rail-3d/integration/train-path.js');
  window.__metroCase=(lineId,stationName,dir,phase,kind)=>{
   const ln=state.decoLines.find(l=>l.id===lineId),i=ln.stations.findIndex(s=>s.name===stationName),f=railIslandIntegration.capture(),progress=i+phase*dir,vehicle={dir:dir===1?2:1};
   const tr={vehicleId:'station-regression',lineId,trajectory:[{epoch:0,progress:i-dir*.01},{epoch:1,progress:i},{epoch:2,progress:i},{epoch:3,progress:i+dir*.01}]};
   const p=kind==='core'?metroCorePositionAt(ln,tr,phase<0?1+phase/.01:phase>0?2+phase/.01:1.5):trtcOfficialPositionAtProgress(ln,vehicle,progress*dir,{motionFrom:i-dir,motionTo:i});
   const route=f.routes.find(r=>r.routeId===lineId&&r.systemId===ln._sys),path=makePath(route.coordinates),hit=path.locate([p.lon,p.lat]),id='metro-station-regression';
   const v={id,longitude:p.lon,latitude:p.lat,route,routeId:lineId,systemId:ln._sys,color:ln.color,railDirection:dir,sourceKind:kind,followed:true};
   M.raw.jumpTo({center:[ln.stations[i].lon,ln.stations[i].lat],zoom:17,pitch:50});
   const r=railIslandIntegration.renderer;r.update({...f,vehicles:[v],selectedVehicleId:id,routes:[route],display:{...f.display,enabled:true,modelMode:'all'}});
   return {visible:r.hasModel(id),off:hit.error,models:r.stats.models,pose:r.stats.poseSamples.find(x=>x.id===id),fallbacks:r.stats.modelFallbacks};
  };
 });
 for(const width of [1280,360,375,414,768]){
  await page.setViewportSize({width,height:900});
  for(const [line,station]of [['G','南京復興'],['KR','左營']])for(const dir of [-1,1])for(const kind of ['core','official']){
   await page.waitForFunction(([line,station,dir,kind])=>__metroCase(line,station,dir,-.001,kind).visible,[line,station,dir,kind],{timeout:30000});
   let all=true,maxOff=0,last=null,maxStep=0;
   for(const phase of [-.001,-.0001,-.000001,0,0,0,.000001,.0001,.001]){const r=await page.evaluate(args=>__metroCase(...args),[line,station,dir,phase,kind]);all&&=r.visible&&r.models===1&&r.fallbacks.length===0;maxOff=Math.max(maxOff,r.off);if(last&&r.pose)maxStep=Math.max(maxStep,Math.hypot(...r.pose.coordinate.map((x,i)=>x-last[i]))*111320);last=r.pose?.coordinate;}
   const row={engineName,width,line,station,dir,kind,pass:all&&maxOff<.01,maxOff,maxStep};rows.push(row);console.log(row);
  }
 }
 rows.push({engineName,test:'page errors',pass:errors.length===0,errors});await browser.close();
}
fs.writeFileSync('output/metro-station-models/results.json',JSON.stringify(rows,null,2));console.log(rows.filter(r=>r.pass).length+'/'+rows.length);if(rows.some(r=>!r.pass))process.exitCode=1;

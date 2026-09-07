import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/',rows=[];
fs.mkdirSync('output/physical-browser',{recursive:true});
const check=(test,pass,details={})=>{rows.push({test,pass,...details});console.log(JSON.stringify(rows.at(-1)));if(!pass)throw Error(test);};
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(),context=await browser.newContext({viewport:{width:1280,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 try{
  await page.goto(base+'?g=all&scene=3d&t=08:00&at=25.0477,121.5171&z=18');
  await page.waitForFunction(()=>state.ready&&window.railIslandPhysical&&railIslandIntegration.renderer?.stats.models>0,null,{timeout:90000});
  const initial=await page.evaluate(()=>{state.playing=false;const f=railIslandIntegration.capture();return {build:BUILD,coverage:railIslandPhysical.dispatch.coverage,physical:f.vehicles.filter(v=>v.route?.physical).length,vehicles:f.vehicles.length,models:railIslandIntegration.renderer.stats.models,fallbacks:railIslandIntegration.renderer.stats.modelFallbacks,errors:railIslandIntegration.errors};});
  check(name+' default physical routes and models',initial.physical>initial.vehicles*.95&&initial.models>0&&!initial.errors.length&&!initial.fallbacks.length,initial);
  await page.screenshot({path:`output/physical-browser/${name}-taipei.png`});
  await page.evaluate(()=>{
   state.playing=false;clearFollow();clearFreqFollow();railIslandIntegration.render=()=>{};
   window.__frame=railIslandIntegration.capture();window.__clock=100000;
   window.__case=(lineId,dir,progress)=>{
    const ln=state.decoLines.find(l=>l.id===lineId),selection=railIslandPhysical.metro.routeFor(ln,dir),p=railIslandPhysical.metro.sample(ln,{progress},dir),id='metro-regression';
    const v={id,longitude:p.lon,latitude:p.lat,route:p.route,chainageM:p.chainageM,routeId:lineId,systemId:ln._sys,color:ln.color,railDirection:p.railDirection,followed:true};
    M.raw.jumpTo({center:[p.lon,p.lat],zoom:17,pitch:45});
    railIslandIntegration.renderer.update({...__frame,clock:{...__frame.clock,simSec:__clock},vehicles:[v],routes:[p.route],clearanceRoutes:[],selectedVehicleId:id,display:{...__frame.display,enabled:true,modelMode:'all'}});
    const r=railIslandIntegration.renderer;return {visible:r.hasModel(id),fallbacks:r.stats.modelFallbacks,physical:p.physical,start:selection.record.startIndex,end:selection.record.endIndex};
   };
   window.__passing=(separated=false)=>{
    const ln=state.decoLines.find(l=>l.id==='G'),p=railIslandPhysical.metro.sample(ln,{progress:8},1),r=p.route,vehicles=[1,-1].map((d,i)=>{const s=p.chainageM+(separated?i*1500:0),q=r.path.at(s);return {id:'passing-'+i,longitude:q.coordinate[0],latitude:q.coordinate[1],chainageM:s,route:r,routeId:'G',systemId:'mrt',color:ln.color,railDirection:d,followed:true};});
    M.raw.jumpTo({center:[p.lon,p.lat],zoom:18,pitch:45});
    railIslandIntegration.renderer.update({...__frame,clock:{...__frame.clock,simSec:__clock},vehicles,routes:[r],clearanceRoutes:[],selectedVehicleId:vehicles[0].id,display:{...__frame.display,enabled:true,modelMode:'all'}});
    return {models:railIslandIntegration.renderer.stats.models,poses:railIslandIntegration.renderer.stats.poseSamples,avoiding:railIslandIntegration.renderer.stats.avoiding};
   };
  });
  const lines=await page.evaluate(()=>state.decoLines.filter(l=>railIslandPhysical.metro.routeFor(l,1)).map(l=>({id:l.id,start:railIslandPhysical.metro.routeFor(l,1).record.startIndex,end:railIslandPhysical.metro.routeFor(l,1).record.endIndex})));
  for(const line of lines)for(const dir of [1,-1]){
   let count=0;
   for(const progress of [line.start,(line.start+line.end)/2,line.end]){
    await page.evaluate(()=>__clock+=100);
    await page.waitForFunction(args=>__case(...args).visible,[line.id,dir,progress],{timeout:30000});
    for(const delta of [-.00001,0,.00001]){const p=Math.max(line.start,Math.min(line.end,progress+delta)),r=await page.evaluate(args=>__case(...args),[line.id,dir,p]);if(!r.visible||!r.physical||r.fallbacks.length)throw Error(JSON.stringify({line,dir,p,r}));count++;}
   }
   check(name+' '+line.id+' '+dir+' arrival/departure/terminal models',count===9);
  }
  await page.evaluate(()=>__clock+=100);
  await page.waitForFunction(()=>__passing().models===2,null,{timeout:30000});
  const meeting=await page.evaluate(()=>__passing());
  check(name+' overlapping formations temporarily separate',meeting.avoiding===1&&Math.abs(meeting.poses[0].avoidanceOffsetM-meeting.poses[1].avoidanceOffsetM)>=4.2,{offsets:meeting.poses.map(p=>p.avoidanceOffsetM)});
  await page.waitForTimeout(150);
  const hits=await page.evaluate(()=>{const r=railIslandIntegration.renderer;return r.projectedCars().filter(c=>c.index===0).map(c=>({id:c.id,hit:r.hitTest(c.roof).some(h=>h.id===c.id)}));});
  check(name+' shifted model hit testing',hits.length===2&&hits.every(h=>h.hit),{hits});
  await page.screenshot({path:`output/physical-browser/${name}-passing.png`});
  for(let i=0;i<75;i++){await page.evaluate(()=>__passing(true));await page.waitForTimeout(20);}
  const returned=await page.evaluate(()=>__passing(true));check(name+' returns to track after passing',returned.avoiding===0,{offsets:returned.poses.map(p=>p.avoidanceOffsetM)});
  for(const width of [360,375,414,768]){
   await page.setViewportSize({width,height:900});
   for(const dir of [1,-1]){await page.waitForFunction(args=>__case(...args).visible,['G',dir,8],{timeout:30000});check(name+' mobile '+width+' direction '+dir,true);}
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);check(name+' mobile '+width+' no horizontal overflow',!overflow);
  }
  check(name+' no script errors',errors.length===0,{errors});
 }finally{await browser.close();fs.writeFileSync('output/physical-browser/results.json',JSON.stringify(rows,null,2));}
}
console.log(`${rows.filter(r=>r.pass).length}/${rows.length}`);

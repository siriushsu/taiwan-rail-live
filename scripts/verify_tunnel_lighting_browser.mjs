import fs from 'node:fs';import {chromium,webkit} from 'playwright';import {createRequire} from 'node:module';const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5256/',out='output/portal-review';fs.mkdirSync(out,{recursive:true});const rows=[];
const check=(name,pass,detail)=>{rows.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));};
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
 const b=await type.launch({headless:!process.env.HEADFUL}),page=await b.newPage({viewport:{width:1280,height:900},locale:'zh-TW'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await page.goto(base+'?g=all&scene=3d&map=landscape&t=12:00');await page.waitForFunction(()=>state.ready&&window.railIslandPhysical?.portalPaths&&window.railIslandIntegration?.renderer,null,{timeout:120000});
 await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();});
 check(engine+' 全洞口來源有綁定',await page.evaluate(()=>railIslandPhysical.portalPaths.length===railIslandPhysical.portals.length));
 await page.evaluate(async()=>{const {makePath}=await import('./rail-3d/integration/train-path.js');window.__frame=railIslandIntegration.capture();railIslandIntegration.render=()=>{};
 const ways=railIslandPhysical.geometry.drawingWays('thsr_sched','#ee7623'),parts=['197206562','922552879','197206565'].map(id=>ways.find(r=>r.routeId===id));let total=0;const chunks=parts.map(r=>{const path=makePath(r.coordinates),start=total;total+=path.length;return{r,start,end:total,path};});const coords=parts.flatMap((r,i)=>r.coordinates.slice(i?1:0));window.__path=makePath(coords);window.__portal=chunks[1].start;
 window.__route={...parts[0],id:'portal-combined',coordinates:coords,routeId:'portal-combined',level:s=>{const c=chunks.find(c=>s<=c.end)||chunks.at(-1);return c.r.level(Math.max(0,s-c.start));}};
 window.__template=__frame.vehicles.find(v=>v.systemId==='thsr_sched');window.__update=(offset=0,dir=1)=>{const s=__portal+offset,q=__path.at(s).coordinate;window.__v={...__template,id:'portal-light-test',route:__route,chainageM:s,longitude:q[0],latitude:q[1],railDirection:dir,followed:true};railIslandIntegration.renderer.update({...__frame,routes:parts,vehicles:[__v],display:{...__frame.display,enabled:true,modelMode:'all'},followLock:false,selectedVehicleId:null});};
 railIslandIntegration.setGroundMode('terrain');M.raw.jumpTo({center:[121.41105,25.0054],zoom:19.3,pitch:65,bearing:-76});__update(0,1);});
 await page.waitForFunction(()=>{__update();return railIslandIntegration.renderer.stats.poseSamples[0]?.cars.length===12&&railIslandIntegration.renderer.stats.structures.portalTracks>=2&&M.raw.areTilesLoaded();},null,{timeout:90000});
 for(const [label,sec] of [['day',12*3600],['night',21*3600]]){
  await page.evaluate(sec=>{setSimSec(sec);state.playing=false;railIslandSunlight.update(true);__update();},sec);
  await page.waitForTimeout(500);
  for(const dir of [1,-1]){
   await page.evaluate(dir=>__update(0,dir),dir);await page.waitForTimeout(200);
   const detail=await page.evaluate(()=>{const r=railIslandIntegration.renderer,p=r.stats.poseSamples[0];return{night:p.cars[0].light.night,range:p.cars.map(c=>c.light.tunnel[1]),heightError:Math.max(...p.cars.map(c=>Math.abs(c.height-__route.level(c.s).terrainHeightM-.65))),portals:r.stats.structures.portalSamples,vertices:r.stats.structures.vertices,buildMs:r.stats.structures.buildMs,errors:r.stats.errors};});
   check(engine+' '+label+' 雙向 '+dir,detail.range.some(x=>x>.9)&&detail.range.some(x=>x<.1)&&detail.heightError<.001&&detail.portals.some(x=>x.tracks===2)&&(label==='night'?detail.night>.95:detail.night<.05)&&!detail.errors.length,detail);
   await page.screenshot({path:`${out}/${engine}-${label}-${dir}.png`,timeout:60000});
  }
 }
 // 固定實際列車與鏡頭，只切換既有日夜光影開關；獨立比較車窗所在的像素。
 await page.evaluate(()=>{__update(0,1);const lead=railIslandIntegration.renderer.stats.poseSamples[0].cars[0];M.raw.setCenterClampedToGround(false);M.raw.jumpTo({center:lead.coordinate,elevation:lead.height+1.5,zoom:19.2,pitch:68,bearing:10});railIslandSunlight.setEnabled(true);railIslandSunlight.update(true);});await page.waitForTimeout(600);
 const boxes=await page.evaluate(()=>{const rect=M.raw.getCanvas().getBoundingClientRect();return railIslandIntegration.renderer.projectedCars().filter(c=>c.index<5).map(c=>({x:c.bounds.left+rect.x,y:c.bounds.top+rect.y,w:c.bounds.right-c.bounds.left,h:c.bounds.bottom-c.bounds.top}));});
 const before=PNG.sync.read(await page.screenshot({path:`${out}/${engine}-night-exterior.png`,timeout:60000}));
 await page.evaluate(()=>{railIslandSunlight.setEnabled(false);__update(0,1);});await page.waitForTimeout(400);const after=PNG.sync.read(await page.screenshot({timeout:60000}));let changed=0,warm=0;
 for(const box of boxes)for(let y=Math.max(0,Math.ceil(box.y));y<Math.min(before.height,box.y+box.h);y++)for(let x=Math.max(0,Math.ceil(box.x));x<Math.min(before.width,box.x+box.w);x++){const i=(y*before.width+x)*4,a=before.data,b=after.data;if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>30)changed++;if(a[i]>170&&a[i+1]>95&&a[i]-a[i+2]>60&&a[i]>b[i]+15)warm++;}
 check(engine+' 夜間車身與暖色車窗確實改變像素',changed>100&&warm>10,{changed,warm,boxes});
 // 逐 .5m 穿越洞口，驗平滑、可逆及保持逐節位置。
 const transition=await page.evaluate(async()=>{const {tunnelAmount}=await import('./rail-3d/integration/train-lighting.js');return Array.from({length:81},(_,i)=>tunnelAmount({...__path,level:__route.level},__portal-20+i*.5));});
 check(engine+' 進出洞口光線連續可逆',transition[0]>.99&&transition.at(-1)<.01&&Math.max(...transition.slice(1).map((v,i)=>Math.abs(v-transition[i])))<.1,{maxStep:Math.max(...transition.slice(1).map((v,i)=>Math.abs(v-transition[i])))});
 check(engine+' 無執行錯誤',!errors.length,errors);
 }catch(e){check(engine+' 執行',false,e.stack);}finally{await page.close();await b.close();}
}
fs.writeFileSync(out+'/lighting-browser.json',JSON.stringify(rows,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;

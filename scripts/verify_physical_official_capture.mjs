import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/';let tests=0;
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1280,height:900}});
 try{await page.goto(base+'?g=all&scene=3d&t=08:00&at=25.0477,121.5171&z=18&lang=zh-TW');await page.waitForFunction(()=>state.ready&&window.railIslandPhysical&&window.railIslandIntegration?.renderer,null,{timeout:60000});
  await page.evaluate(()=>{state.playing=false;railIslandIntegration.render=()=>{};window.__core=metroCoreItemsForLine;window.__official=trtcOfficialItemsForLine;});
  for(const dir of [1,-1])for(const phase of [-.00001,0,.00001]){
   const args={dir,phase};await page.evaluate(({dir,phase})=>{
    const ln=state.decoLines.find(l=>l.id==='G'),i=8,vehicle={dir:dir===1?2:1},pos=trtcOfficialPositionAtProgress(ln,vehicle,(i+phase*dir)*dir,{motionFrom:i-dir,motionTo:i});
    metroCoreItemsForLine=()=>null;trtcOfficialItemsForLine=l=>l===ln?[{vehicleId:'official-regression',officialNo:'999',vehicle,pos}]:null;
    window.__update=()=>{const f=railIslandIntegration.capture(),v=f.vehicles.find(v=>v.id.includes('official-regression'));M.raw.jumpTo({center:[v.longitude,v.latitude],zoom:18,pitch:45});railIslandIntegration.renderer.update({...f,vehicles:[{...v,followed:true}],routes:[v.route],selectedVehicleId:v.id});return {physical:v.route?.physical,model:railIslandIntegration.renderer.hasModel(v.id),fallbacks:railIslandIntegration.renderer.stats.modelFallbacks,chainage:v.chainageM,routeId:v.route.id};};
   },args);
   await page.waitForFunction(()=>__update().model,null,{timeout:30000});const r=await page.evaluate(()=>__update());if(!r.physical||r.fallbacks.length)throw Error(JSON.stringify({name,...args,r}));console.log({name,...args,pass:true,route:r.routeId});tests++;
  }
  await page.evaluate(()=>{metroCoreItemsForLine=__core;trtcOfficialItemsForLine=__official;});
 }finally{await browser.close();}
}console.log(tests+'/'+tests);

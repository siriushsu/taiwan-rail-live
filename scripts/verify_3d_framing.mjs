import {chromium,webkit} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=new URL('../output/3d-integration/',import.meta.url),results=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));};
for(const [engine,type]of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},hasTouch:true,isMobile:true,locale:'zh-TW'}),p=await context.newPage(),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-lang','zh-TW');});await p.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
  await p.goto('http://127.0.0.1:5207/?scene=3d&g=all&train=117&t=12:00&z=18&formation=actual&ground=flat&version=24');
  await p.waitForFunction(()=>window.railIslandIntegration?.renderer&&state.followTrain,null,{timeout:60000});await p.evaluate(()=>{state.playing=false;setSimSec(43200);M.raw.setZoom(17);});await p.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.models>=1,null,{timeout:30000});
  const select=async(sys,direction)=>{
   const chosen=await p.evaluate(({sys,direction})=>{clearFollow();for(let t=43200;t<46800;t+=60){setSimSec(t);const ri=railIslandIntegration,v=ri.capture().vehicles.find(v=>v.systemId===sys&&(sys==='thsr_sched'||v.stockId==='emu3000')&&v.direction===direction&&v.latitude>24.3&&v.latitude<24.7&&(()=>{const tr=state.trains.find(tr=>tr.sys===v.systemId&&String(tr.train)===v.publicLabel),a=tr&&trainPos(tr,t-5),b=tr&&trainPos(tr,t+5);return a&&b&&Math.hypot(a.lat-b.lat,a.lon-b.lon)>.00003;})());if(v){ri.select(v.id);state.playing=false;ri.renderer.map.jumpTo({center:[v.longitude,v.latitude],zoom:17});return {id:v.id,time:t,coordinate:[v.longitude,v.latitude]};}}},{sys,direction});
   if(!chosen)throw Error('無雙向案例 '+sys+' '+direction);
   await p.waitForFunction(id=>window.railIslandIntegration?.renderer?.stats.poseSamples.some(s=>s.id===id),chosen.id);
   return chosen;
  };
  const side=async(offset,zoom)=>{
   await p.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.poseSamples.some(s=>s.id===window.railIslandIntegration?.frame?.selectedVehicleId));
   await p.evaluate(({offset,zoom})=>{const ri=railIslandIntegration,r=ri.renderer,s=r.stats.poseSamples.find(s=>s.id===ri.frame.selectedVehicleId),bearing=90-s.cars[0].angle*180/Math.PI+offset;r.map.jumpTo({zoom,pitch:55,bearing});},{offset,zoom});await p.waitForTimeout(80);await p.waitForFunction(()=>!!window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.renderer?.stats.followReturning);
   return p.evaluate(()=>{const ri=railIslandIntegration,r=ri.renderer,car=r.projectedCars().find(c=>c.id===ri.frame.selectedVehicleId&&c.index===0),pad=r.map.getPadding(),cv=r.map.getCanvas(),s=r.stats.poseSamples.find(s=>s.id===ri.frame.selectedVehicleId),rect=cv.getBoundingClientRect(),b=car?.bounds,reachable=b&&[b.left,(b.left+b.right)/2,b.right].every(x=>[b.top,(b.top+b.bottom)/2,b.bottom].every(y=>document.elementFromPoint(rect.left+x,rect.top+y)===cv));return {car,reachable,viewport:{width:cv.clientWidth,height:cv.clientHeight},padding:pad,framing:r.stats.followFraming,coordinate:s.coordinate,cars:s.cars,length:s.lengthM,zoom:r.map.getZoom(),bearing:r.map.getBearing(),anchorInside:r.map.getBounds().contains(s.coordinate),models:r.stats.models};});
  };
  // 面板只占部分高度；直接驗車頭是否完整在畫面內且沒有被任何實際 UI 蓋住。
  const fits=s=>s.car&&s.reachable&&s.car.bounds.left>=6&&s.car.bounds.right<=s.viewport.width-6&&s.car.bounds.top>=6&&s.car.bounds.bottom<=s.viewport.height-6;
  for(const sys of ['tra_sched','thsr_sched'])for(const direction of [1,-1]){
   console.log('CASE',engine,sys,direction);await select(sys,direction);const original=await p.evaluate(()=>railIslandIntegration.renderer.stats.poseSamples.find(p=>p.id===railIslandIntegration.frame.selectedVehicleId).cars);
   for(const offset of [90,-90])for(const zoom of [17,18.8]){const s=await side(offset,zoom);check(engine+' / '+sys+' 方向 '+direction+' 側面 '+offset+' z'+zoom+' 車頭完整',fits(s)&&s.framing.distanceM>0&&JSON.stringify(s.cars)===JSON.stringify(original),{bounds:s.car?.bounds,padding:s.padding,shift:s.framing.distanceM,length:s.length});}
  }
  await select('tra_sched',1);
  for(const width of (process.env.WIDTHS||'360,375,390,414,520,768').split(',').map(Number)){
   await p.setViewportSize({width,height:844});await p.waitForTimeout(180);
   for(const zoom of [18.8,20])for(const offset of [90,-90]){const s=await side(offset,zoom);check(engine+' / '+width+' 手機側面 '+offset+' z'+zoom+' 車頭不裁切',fits(s)&&s.models>=1,{bounds:s.car?.bounds,padding:s.padding,shift:s.framing.distanceM,anchorInside:s.anchorInside});}
   if(width===390)await p.screenshot({path:fileURLToPath(new URL(engine+'-mobile-head.png',out))});
  }
  // 縮得很近時，整列的中心已在畫面外，車頭仍必須留在渲染候選中。
  await p.setViewportSize({width:390,height:844});const close=await side(-90,19.3);check(engine+' / 全列中心出框仍保留車頭模型',!close.anchorInside&&close.models>=1&&fits(close),{bounds:close.car?.bounds,anchorInside:close.anchorInside,shift:close.framing.distanceM});
  await p.setViewportSize({width:390,height:844});await side(-90,18.5);
  const before=await p.evaluate(()=>{const r=railIslandIntegration.renderer;window.framingEvents=[];r.map.on('render',()=>{const c=r.projectedCars().find(c=>c.id===railIslandIntegration.frame.selectedVehicleId&&c.index===0);if(c)framingEvents.push({x:c.center.x,y:c.center.y,t:performance.now()});});state.playing=true;state.speedMult=1;return {...r.getView(),coordinate:r.stats.poseSamples.find(s=>s.id===railIslandIntegration.frame.selectedVehicleId).coordinate};});
  await p.waitForTimeout(1300);const motion=await p.evaluate(()=>{state.playing=false;const a=framingEvents,steps=a.slice(1).map((s,i)=>Math.hypot(s.x-a[i].x,s.y-a[i].y));return {frames:a.length,maxStep:Math.max(...steps),bearing:railIslandIntegration.renderer.map.getBearing(),lock:state.followLock,coordinate:railIslandIntegration.renderer.stats.poseSamples.find(s=>s.id===railIslandIntegration.frame.selectedVehicleId).coordinate};});
  check(engine+' / 前段構圖行進平穩且不改視角',motion.frames>5&&motion.maxStep<3&&Math.hypot(motion.coordinate[0]-before.coordinate[0],motion.coordinate[1]-before.coordinate[1])>1e-6&&motion.lock&&Math.abs(motion.bearing-before.bearing)<.001,motion);
  // 真正使用原「更多」面板點選三節與完整編組。
  await p.tap('#tabMore');await p.locator('[data-rail3d="formation"] [data-value="three"]').scrollIntoViewIfNeeded();await p.tap('[data-rail3d="formation"] [data-value="three"]');await p.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.poseSamples[0]?.carCount===3);await p.waitForTimeout(400);
  check(engine+' / 三節示意維持原構圖',await p.evaluate(()=>railIslandIntegration.renderer.stats.followFraming.distanceM===0));
  await p.tap('[data-rail3d="formation"] [data-value="actual"]');await p.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.poseSamples[0]?.carCount===12);await p.waitForTimeout(200);
  check(engine+' / 完整編組恢復向車頭構圖',await p.evaluate(()=>railIslandIntegration.renderer.stats.followFraming.distanceM>0));await p.tap('#moreClose');
  await p.evaluate(()=>railIslandIntegration.renderer.map.jumpTo({pitch:0}));await p.waitForTimeout(180);
  check(engine+' / 俯視維持整列中心',await p.evaluate(()=>railIslandIntegration.renderer.stats.followFraming.distanceM===0));
  await p.evaluate(()=>railIslandIntegration.renderer.map.jumpTo({zoom:13,pitch:55}));await p.waitForTimeout(180);
  check(engine+' / 縮遠恢復原車號與原位置',await p.evaluate(()=>{const ri=railIslandIntegration,r=ri.renderer,b=state._trainHits.find(b=>b.tr===state.followTrain);return r.stats.models===0&&!!b;}));
  check(engine+' / 無前端例外',errors.length===0&&await p.evaluate(()=>railIslandIntegration.errors.length===0),errors);
  await context.close();
 }catch(e){check(engine+' / 構圖驗證完成',false,e.stack);}finally{await browser.close();}
}
const report={passed:results.filter(r=>r.pass).length,total:results.length,results};await writeFile(new URL('framing-verification.json',out),JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;

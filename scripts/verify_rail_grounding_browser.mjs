import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5245/',out='output/rail-grounding';fs.mkdirSync(out,{recursive:true});const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 for(const width of (process.env.QUICK?[375]:[360,375,414,768])){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
   await page.goto(base+'?g=all&scene=3d&map=landscape&t=12:00');
   await page.waitForFunction(()=>state.ready&&window.railIslandPhysical&&window.railIslandIntegration?.renderer,null,{timeout:90000});
   await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();window.__frame=railIslandIntegration.capture();railIslandIntegration.render=()=>{};});
   // 新竹市區、竹南附近與中部西線：來源只有 layer，沒有 bridge 標記，必須留在地面。
   // 966445954 是反過來的對照組：它原本也在這份名單裡，但官方橋隧幾何以 1.00 覆蓋、
   // 中位差 0.2m 證實那是高架橋，於是改成正例驗它真的畫出橋面與橋墩。找不到替代的
   // 高鐵反例——補正之後「正 layer 而兩邊都沒有結構證據」的高鐵路段是 0 條。
   for(const id of (width===375?['391706267','860092299','103544834','966445954']:['391706267'])){
    await page.evaluate(async id=>{
     const {makePath}=await import('./rail-3d/integration/train-path.js'),route=railIslandPhysical.geometry.drawingWays(id==='966445954'?'thsr_sched':'tra_sched','#547466').find(r=>String(r.routeId)===id),path=makePath(route.coordinates),s=path.length/2,q=path.at(s).coordinate;
     const template=id==='966445954'?__frame.vehicles.find(v=>v.systemId==='thsr_sched'):__frame.vehicles.find(v=>v.systemId==='tra_sched'&&String(v.publicLabel)==='114')||__frame.vehicles.find(v=>v.systemId==='tra_sched');
     window.__route=route;window.__vehicles=[1,-1].map((dir,i)=>({...template,id:'ground:'+i,route,chainageM:s+dir*Math.min(90,path.length/8),longitude:path.at(s+dir*Math.min(90,path.length/8)).coordinate[0],latitude:path.at(s+dir*Math.min(90,path.length/8)).coordinate[1],railDirection:dir,followed:false}));
     window.__update=()=>railIslandIntegration.renderer.update({...__frame,routes:[route],vehicles:__vehicles,display:{...__frame.display,enabled:true,modelMode:'all'},followLock:false,selectedVehicleId:null});
     railIslandIntegration.renderer.map.jumpTo({center:q,zoom:17.3,pitch:60,bearing:35});__update();
    },id);
    for(const mode of ['flat','terrain']){
     await page.locator(await page.locator('#toolsFab').isVisible()?'#toolsFab':'#tabMore').tap();const control=page.locator('[data-rail3d="ground"] [data-value="'+mode+'"]');await control.scrollIntoViewIfNeeded();await control.tap();await page.locator('#moreClose').tap();
     // 90s 不是 45s:45 秒是照本機磁碟調的,對正式站(BASE_URL 指遠端)webkit 跑到第四個案例時
     // 會偶發等不到兩節模型。放寬只是晚一點宣告失敗,判準本身沒有放水——仍要求 models===2。
     await page.waitForFunction(()=>{__update();return window.railIslandIntegration?.renderer?.stats.models===2;},null,{timeout:90000});
     await page.waitForTimeout(650);
     const detail=await page.evaluate(()=>{
      __update();const r=railIslandIntegration.renderer,poses=r.stats.poseSamples,terrain=r.stats.groundMode==='terrain',ground=c=>terrain?r.map.queryTerrainElevation(c.coordinate):0;
      // 期望軌面＝層位剖面的顯示高程（地形開：建置端算好的絕對高程 terrainValues，沒有才退回 DEM＋層位；地形關：層位）。
      // 09-12 露天段縱坡重算後，平面段的顯示剖面刻意平滑過、不再逐點等於 DEM，所以「留在地面」另用 lift 對 DEM 獨立驗。
      const expectedRail=c=>{const level=__route.level(c.s);if(!terrain)return level.offsetM;return Number.isFinite(level.terrainHeightM)?level.terrainHeightM:ground(c)+level.offsetM;};
      return {structures:structuredClone(r.stats.structures),poses:poses.map(p=>({id:p.id,kind:p.level.kind,cars:p.cars.length,error:Math.max(...p.cars.map(c=>Math.abs(c.height-.65-expectedRail(c)))),lift:[Math.min(...p.cars.map(c=>c.height-.65-ground(c))),Math.max(...p.cars.map(c=>c.height-.65-ground(c)))],offset:Math.max(...p.cars.map(c=>Math.abs(__route.level(c.s).offsetM)))})),errors:r.stats.errors,overflow:document.documentElement.scrollWidth>innerWidth+1};
     });
     const bridgeCase=id==='966445954';
     // lift 界線的來源：高架案例整列離 DEM > 3 公尺（求解器的離地下限 6 公尺，留 3 公尺給取樣差）；
     // 平面案例看「最低的那節」——不低於 −1 公尺（埋進地形；−1 留給 MapLibre 與建置端取樣差）、也不高於 2 公尺
     // （一列 14 節約 280 公尺，平面軌道總有一處貼近地面；整列都離地 2 公尺以上就是被當成高架抬起來了）。
     // 不能拿最高的那節設上限：平面段跨小溪、翻 DTM 上的路堤時會合理地浮到 3～6 公尺（09-12 實測 860092299 就有 3.2）。
     const pass=(bridgeCase?detail.structures.decks>0&&detail.structures.piers>0:detail.structures.piers===0&&detail.structures.decks===0)&&detail.poses.length===2&&detail.poses.every(p=>p.kind===(bridgeCase?'bridge':'surface')&&p.cars>0&&p.error<.01&&(bridgeCase?p.lift[0]>3:p.lift[0]>-1&&p.lift[0]<2&&p.offset<.001))&&!detail.errors.length&&!detail.overflow;
     results.push({engine,width,id,mode,pass,detail});console.log(engine,width,id,mode,pass);
     if(width===375)await page.screenshot({path:`${out}/${engine}-${id}-${mode}.png`});
    }
   }
   results.push({engine,width,test:'無頁面錯誤',pass:!errors.length,errors});
  }catch(e){results.push({engine,width,pass:false,error:String(e)});console.error(e.message);}finally{await page.close();}
 }
 await browser.close();
}
fs.writeFileSync(process.env.RESULT_FILE||out+'/browser.json',JSON.stringify(results,null,2));console.log({total:results.length,failed:results.filter(r=>!r.pass)});if(results.some(r=>!r.pass))process.exitCode=1;

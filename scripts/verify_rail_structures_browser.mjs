import fs from 'node:fs';import {chromium,webkit} from 'playwright';import {createRequire} from 'node:module';const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5234/',out='output/rail-structures',rows=[];fs.mkdirSync(out,{recursive:true});
for(const [engine,type]of Object.entries({chromium,webkit})){const browser=await type.launch();for(const width of (process.env.QUICK?[1280]:[1280,360,375,414,768])){const mobile=width<1000,page=await browser.newPage({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile,locale:'zh-TW'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
try{await page.goto(base+'?g=all&scene=3d&map=landscape&at=23.48,120.3247&z=17&t=12:00');await page.waitForFunction(()=>state.ready&&window.railIslandPhysical&&window.railIslandIntegration?.renderer?.stats.structures?.piers>0,null,{timeout:90000});
await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();window.__bridgeFrame=railIslandIntegration.capture();window.__bridgeRender=railIslandIntegration.render;railIslandIntegration.render=()=>{};window.__bridgeUpdate=(show=true,vehicles=[])=>railIslandIntegration.renderer.update({...__bridgeFrame,routes:show?__bridgeFrame.routes:[],vehicles,display:{...__bridgeFrame.display,enabled:true,modelMode:'all'},followLock:false,selectedVehicleId:null});});
for(const mode of ['flat','terrain']){
// 桌面寬度以前走 renderer.setGroundMode 捷徑,那條只換模式、不重建結構幾何:本機 DEM 在記憶體裡
// 所以下一次 update 就建出正確高度,對正式站則會在 DEM 還在下載時把整座高架橋建在 0m 並且不再更新。
// 兩個寬度一律改走使用者真的會按的那顆控制項(rubric 形態 0:要量使用者走的路)。
{const press=async loc=>{await loc.scrollIntoViewIfNeeded();mobile?await loc.tap():await loc.click();};
await press(page.locator(await page.locator('#toolsFab').isVisible()?'#toolsFab':'#tabMore'));
await press(page.locator('[data-rail3d="ground"] [data-value="'+mode+'"]'));
const close=page.locator('#moreClose');if(await close.isVisible())await press(close);}
await page.evaluate(()=>{railIslandIntegration.renderer.map.jumpTo({center:[120.3247,23.48],zoom:18.2,pitch:68,bearing:65});__bridgeUpdate();});
// 正向對照:terrain 這列要先證明地形真的開著、而且 DEM 在這些取樣點真的有值(此段約 10~12m)。
// 少了這兩條,「建出來的 groundM」和「當下查到的高程」在 DEM 未載入或地形沒開時都是 0,
// 一致性判準同源自洽、恆真——實測把控制項固定按 flat 時整列照樣全綠。
await page.waitForFunction(mode=>{__bridgeUpdate();const r=window.railIslandIntegration?.renderer;if(!r)return false;const s=r.stats.structures;
 if(r.stats.groundMode!==mode)return false;
 if(mode==='terrain'&&!s.samples.every(p=>r.map.queryTerrainElevation(p.coordinate)>1))return false;
 return s.piers>3&&s.samples.every(p=>Math.abs(p.groundM-(mode==='flat'?0:r.map.queryTerrainElevation(p.coordinate)))<.01);},mode,{timeout:60000});await page.waitForTimeout(700);
const detail=await page.evaluate(()=>{const r=railIslandIntegration.renderer,rect=r.map.getCanvas().getBoundingClientRect();return {stats:structuredClone(r.stats.structures),groundMode:r.stats.groundMode,errors:r.stats.errors,overflow:document.documentElement.scrollWidth>innerWidth+1,spots:r.stats.structures.samples.map(p=>{const s=r.projectCoordinate(p.coordinate,(p.groundM+p.topM)/2);return {x:s.x+rect.x,y:s.y+rect.y,z:s.z};}).filter(p=>p.x>5&&p.x<innerWidth-5&&p.y>140&&p.y<innerHeight-160&&Math.abs(p.z)<1)};});
const before=PNG.sync.read(await page.screenshot({path:out+'/'+engine+'-'+width+'-'+mode+'.png'})).data;await page.evaluate(()=>__bridgeUpdate(false));await page.waitForFunction(()=>{__bridgeUpdate(false);return window.railIslandIntegration?.renderer?.stats.structures.vertices===0;});await page.waitForTimeout(80);const after=PNG.sync.read(await page.screenshot()).data;let pixels=0;for(const spot of detail.spots)for(let y=Math.round(spot.y)-2;y<=Math.round(spot.y)+2;y++)for(let x=Math.round(spot.x)-2;x<=Math.round(spot.x)+2;x++){const i=(y*width+x)*4;if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>20)pixels++;}
rows.push({engine,width,mode,test:'只看軌道：橋面存在、橋墩接地且確實繪出',pass:detail.groundMode===mode&&detail.stats.decks>3&&detail.stats.piers>3&&!detail.overflow&&!detail.errors.length&&pixels>8,pixels,detail});console.log(engine,width,mode,rows.at(-1).pass,pixels);
await page.evaluate(()=>__bridgeUpdate());
}
// 以兩股既有高鐵股道驗雙向編組；新增結構不可更動車廂的定位與高程。
await page.evaluate(async()=>{const {makePath}=await import('./rail-3d/integration/train-path.js'),r=railIslandIntegration.renderer,ways=__bridgeFrame.routes.filter(x=>['197653374','197653373'].includes(String(x.routeId))),template=__bridgeFrame.vehicles.find(v=>v.systemId==='thsr_sched');if(ways.length!==2||!template)throw Error('缺少高鐵測例');window.__bridgeVehicles=ways.map((route,i)=>{const path=makePath(route.coordinates),s=path.locate([120.3247,23.48]).s,q=path.at(s).coordinate;return {...template,id:'bridge-direction:'+i,route,chainageM:s,longitude:q[0],latitude:q[1],railDirection:i?1:-1,followed:false};});__bridgeUpdate(true,__bridgeVehicles);});
for(const mode of ['flat','terrain']){await page.evaluate(mode=>{railIslandIntegration.renderer.setGroundMode(mode);__bridgeUpdate(true,__bridgeVehicles);},mode);await page.waitForFunction(()=>{__bridgeUpdate(true,__bridgeVehicles);return window.railIslandIntegration?.renderer?.stats.models===2;},null,{timeout:45000});const detail=await page.evaluate(()=>{const r=railIslandIntegration.renderer;return {poses:r.stats.poseSamples.map(p=>({id:p.id,cars:p.cars.length,error:Math.max(...p.cars.map(c=>Math.abs(c.height-(r.stats.groundMode==='terrain'?r.map.queryTerrainElevation(c.coordinate):0)-__bridgeVehicles.find(v=>v.id===p.id).route.level(c.s).offsetM-.65)))})),fallback:r.stats.modelFallbacks,errors:r.stats.errors};});rows.push({engine,width,mode,test:'雙向高鐵列車仍貼合同一軌面',pass:detail.poses.length===2&&detail.poses.every(p=>p.cars===12&&p.error<.00001)&&!detail.fallback.length&&!detail.errors.length,detail});}
if(width===1280){await page.evaluate(()=>{railIslandIntegration.render=__bridgeRender;setSimSec(11*3600+54*60);state.playing=false;const tr=state.trains.find(tr=>tr.sys==='tra_sched'&&String(tr.train)==='114');if(!tr)throw Error('缺少114次');setFollow(tr,false,true);M.raw.jumpTo({zoom:17.5,pitch:55,bearing:50});});
for(const mode of ['flat','terrain']){await page.evaluate(mode=>railIslandIntegration.setGroundMode(mode),mode);await page.waitForFunction(()=>{const r=window.railIslandIntegration?.renderer,id=window.railIslandIntegration?.capture().selectedVehicleId;if(!r)return false;return r.stats.poseSamples.some(p=>p.id===id)&&r.stats.structures.decks+r.stats.structures.beds>0;},null,{timeout:45000});await page.waitForTimeout(800);const detail=await page.evaluate(()=>{const r=railIslandIntegration.renderer,f=railIslandIntegration.capture(),v=f.vehicles.find(v=>v.followed),p=r.stats.poseSamples.find(p=>p.id===v?.id);return {label:v?.publicLabel,coordinate:[v?.longitude,v?.latitude],height:p?.displayHeightM,level:p?.level,structures:structuredClone(r.stats.structures),errors:r.stats.errors};});rows.push({engine,width,mode,test:'使用者114次11:54頭前溪案例',pass:detail.label==='114'&&detail.structures.decks+detail.structures.beds>0&&!detail.errors.length,detail});await page.screenshot({path:out+'/'+engine+'-114-'+mode+'.png'});}}
// 近看才長出來的鋼軌與枕木：要證明它真的長出來了，也要證明它沒把頂點預算吃爆。
// 上限 320000 的依據：同一支閘門量到的 z14.5 廣角是 144288（chromium）到 389124（webkit）個頂點，
// 而廣角一律 detail 0、這批沒動到它。近看只要待在那個量級以下，就不會是新的最重情形。
if(width===1280){
 const budget=await page.evaluate(async()=>{const r=railIslandIntegration.renderer,out={};
  for(const [key,zoom,want] of [['wide',14.5,0],['close',19.5,2]]){
   r.map.jumpTo({center:[120.6643,24.2738],zoom,pitch:62,bearing:0});
   // 等細節層級真的跟上鏡頭再讀數：程式化移動不會送出帶 originalEvent 的 moveend，
   // 重建靠算繪迴圈的下一拍，固定秒數在不同引擎會讀到不同的中間狀態。
   for(let i=0;i<40&&r.stats.structures.detail!==want;i++)await new Promise(f=>setTimeout(f,250));
   out[key]={vertices:r.stats.structures.vertices,detail:r.stats.structures.detail,ties:r.stats.structures.ties,rails:r.stats.structures.rails};}
  return out;});
 rows.push({engine,width,test:'近看長出鋼軌與枕木',pass:budget.close.detail===2&&budget.close.rails>0&&budget.close.ties>0,budget});
 rows.push({engine,width,test:'廣角不畫細節',pass:budget.wide.detail===0&&budget.wide.ties===0,budget});
 rows.push({engine,width,test:'細節沒吃爆頂點預算',pass:budget.close.vertices<320000,budget});
}
rows.push({engine,width,test:'頁面無錯誤',pass:!errors.length,errors});
}catch(e){rows.push({engine,width,pass:false,error:String(e)});console.log(engine,width,e.message);}finally{await page.close();}}await browser.close();}
fs.writeFileSync(process.env.RESULT_FILE||out+'/browser.json',JSON.stringify(rows,null,2));console.log({total:rows.length,failed:rows.filter(r=>!r.pass)});if(rows.some(r=>!r.pass))process.exitCode=1;

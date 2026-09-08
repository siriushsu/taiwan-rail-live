import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5228/',out='output/landscape-0908';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
const snap=()=>({kind:M.getStyleKind(),sim:state.simSec,id:state.followTrain?.train,center:M.raw.getCenter().toArray(),zoom:M.raw.getZoom(),bearing:M.raw.getBearing(),pose:railIslandIntegration.renderer?.stats.poseSamples.find(p=>p.id===railIslandIntegration.capture().selectedVehicleId)?.coordinate,errors:railIslandIntegration.errors});
async function settle(p,kind){await p.waitForFunction(k=>M.getStyleKind()===k&&railIslandIntegration.renderer&&!railIslandIntegration.loading,null===kind?'landscape':kind,{timeout:60000});}
async function boot(p){await p.goto(base+'?map=landscape&scene=3d&g=all&train=117&t=12:00&lang=zh-TW');await settle(p,'landscape');await p.waitForFunction(()=>state.ready&&state.followTrain);await p.evaluate(()=>{state.playing=false;setSimSec(43200);M.raw.setZoom(17);});await p.waitForFunction(()=>railIslandIntegration.renderer.stats.models>0,null,{timeout:45000});}
for(const [name,engine]of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:({chromium,webkit})[process.env.ENGINE]}:{chromium,webkit})){
 const browser=await engine.launch({headless:process.env.HEADFUL!=='1'});const context=await browser.newContext({viewport:{width:1360,height:980},locale:'zh-TW'});
 await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 // 固定營運資料退回班表，避免當下即時快照影響重複驗證；不偽造衛星授權。
 await p.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
 try{
  await boot(p);await p.evaluate(()=>setFollowLock(false));let initial=await p.evaluate(snap);
  check(name+' 地景獨立於暗色 UI',await p.evaluate(()=>document.documentElement.dataset.theme==='dark'&&M.getStyleKind()==='landscape'&&!M.raw.getLayer('building-glass-edges')&&M.raw.getPaintProperty('water','fill-color')==='#86babd'&&M.raw.getPaintProperty('building-3d','fill-extrusion-opacity')===1));
  check(name+' 地景預設山體起伏',await p.evaluate(()=>!!M.raw.getTerrain()&&railIslandIntegration.groundMode==='terrain'));
  await p.screenshot({path:out+'/'+name+'-train.png'});
  for(const kind of ['dark','light','landscape']){
    await p.evaluate(k=>chooseBasemap(k),kind);await settle(p,kind);await p.waitForFunction(()=>railIslandIntegration.renderer.stats.models>0);const s=await p.evaluate(snap);
    check(name+' 切換 '+kind+' 保留同車/時間/位置',s.id===initial.id&&s.sim===initial.sim&&JSON.stringify(s.pose)===JSON.stringify(initial.pose),{id:s.id,sim:s.sim,pose:s.pose});
  }
  await p.evaluate(()=>state._setAppearance('light'));await p.locator('#toolsFab').click();await p.locator('#msBasemapSeg button[data-map=landscape]').scrollIntoViewIfNeeded();
  check(name+' 無衛星授權時入口明確停用',await p.locator('#msBasemapSeg button[data-map=sat]').isDisabled());
  await p.locator('#moreClose').click();await p.evaluate(()=>{railIslandIntegration.setGroundMode('flat');M.raw.jumpTo({center:[121.5795,24.9968],zoom:16.5,pitch:55,bearing:0});});
  await p.waitForFunction(()=>railIslandIntegration.renderer.stats.landscape.count>100,null,{timeout:30000});await p.waitForTimeout(1500);
  const trees=await p.evaluate(()=>{const s=railIslandIntegration.renderer.stats.landscape;return {count:s.count,cap:s.cap,rebuilds:s.rebuilds,maxBuildMs:s.maxBuildMs,coordinates:s.coordinates};});
  check(name+' 真正渲染林冠且有固定數量上限',trees.count>100&&trees.count<=trees.cap,{...trees,coordinates:undefined});
  await p.screenshot({path:out+'/'+name+'-river-forest.png'});
  await p.waitForTimeout(1400);const quiet=await p.evaluate(()=>railIslandIntegration.renderer.stats.landscape.rebuilds);
  await p.waitForTimeout(1000);check(name+' 靜止不重建樹木',await p.evaluate(n=>railIslandIntegration.renderer.stats.landscape.rebuilds===n,quiet));
  // 在真正的 move 事件期間核對延後重建，不只測計時器函式。
  const box=await p.locator('#map').boundingBox();await p.mouse.move(box.x+box.width*.55,box.y+box.height*.45);await p.mouse.down();await p.mouse.move(box.x+box.width*.55+120,box.y+box.height*.45+20,{steps:12});await p.waitForTimeout(200);const moving=await p.evaluate(()=>({rebuilds:railIslandIntegration.renderer.stats.landscape.rebuilds,moving:M.raw.isMoving()}));
  check(name+' 移動中延後地景重掃',moving.moving&&moving.rebuilds===quiet,moving);await p.mouse.up();await p.waitForTimeout(1500);
  await p.evaluate(()=>M.raw.setZoom(12));await p.waitForFunction(()=>railIslandIntegration.renderer.stats.landscape.count===0);check(name+' 縮遠卸下林冠細節',true);
  await p.evaluate(()=>{railIslandIntegration.setGroundMode('terrain');M.raw.jumpTo({center:[120.731,23.518],zoom:12.5,pitch:60,bearing:-20});});await p.waitForFunction(()=>M.raw.queryTerrainElevation([120.731,23.518])>50,null,{timeout:30000});await p.waitForTimeout(1500);await p.screenshot({path:out+'/'+name+'-mountains.png'});
  check(name+' 山體使用既有 DEM 並有色彩陰影',await p.evaluate(()=>!!M.raw.getLayer('landscape-hillshade')&&M.raw.queryTerrainElevation([120.731,23.518])>50));
  for(let i=0;i<3;i++){await p.evaluate(()=>chooseBasemap('light'));await settle(p,'light');check(name+' 回切釋放地景 '+i,await p.evaluate(()=>!M.raw.getLayer('landscape-hillshade')&&!railIslandIntegration.renderer.stats.landscape));await p.evaluate(()=>chooseBasemap('landscape'));await settle(p,'landscape');}
  await p.reload();await settle(p,'landscape');check(name+' 重整保留地景偏好',await p.evaluate(()=>state.basemap==='landscape'));
  check(name+' 無頁面/3D 錯誤',errors.length===0&&(await p.evaluate(()=>railIslandIntegration.errors.length))===0,errors);
 }catch(e){check(name+' 桌面流程',false,String(e.stack));}
 await context.close();
 for(const width of (process.env.WIDTHS?process.env.WIDTHS.split(',').map(Number):[360,375,390,414,520,768])){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',isMobile:true,hasTouch:true});await ctx.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');});const page=await ctx.newPage();await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  try{
   await boot(page);await page.tap('#tabMore');const b=page.locator('#msBasemapSeg [data-map=light]');await b.scrollIntoViewIfNeeded();await page.tap('#msBasemapSeg [data-map=light]');await settle(page,'light');await page.tap('#msBasemapSeg [data-map=landscape]');await settle(page,'landscape');
   check(name+' '+width+' 真觸控切換',await page.locator('#msBasemapSeg [data-map=landscape]').getAttribute('aria-pressed')==='true');
   for(const fullscreen of [false,true]){
    await page.evaluate(fs=>document.body.classList.toggle('fs',fs),fullscreen);await page.locator('#msBasemapSeg').scrollIntoViewIfNeeded();
    const scan=await page.evaluate(()=>{
     const buttons=[...document.querySelectorAll('#msBasemapSeg button')],all=[...document.querySelectorAll('button,a,input,select,[role=button]')],hits=[],overlaps=[];
     const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&r.bottom>0&&r.top<innerHeight;};
     for(const b of buttons){const r=b.getBoundingClientRect();if(r.width<44||r.height<44||!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))hits.push(b.textContent);
      for(const e of all){if(e===b||e.contains(b)||b.contains(e)||!visible(e))continue;const q=e.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1){const h=document.elementFromPoint(Math.max(r.left,q.left)+1,Math.max(r.top,q.top)+1);if(e.contains(h))overlaps.push(e.id||e.textContent.slice(0,20));}}
     }
     return {hits,overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });check(name+' '+width+' '+(fullscreen?'全螢幕':'一般')+' 觸控命中/全控件相交/無溢出',!scan.hits.length&&!scan.overlaps.length&&!scan.overflow,scan);
   }
   await page.screenshot({path:out+'/'+name+'-'+width+'-choices.png'});
  }catch(e){check(name+' '+width+' 手機流程',false,String(e));}await ctx.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(results.filter(r=>r.pass).length+'/'+results.length+' 通過');if(results.some(r=>!r.pass))process.exitCode=1;

// 拉近之後地下列車整列消失的兩個成因（都在 rail-3d/integration/map3d.js）：
// 1. 遠裁切面：MapLibre 的遠裁切面只算到地表以下約 1%，俯角 0、拉近到 ML z16 以上時，
//    地下十幾公尺的板南線車體整列被 GPU 裁掉。車模其實建好了（stats.models=1），
//    2D 車牌又因為「已有車模」而隱藏，畫面上什麼都沒有。
// 2. 候選只看中心點：車模候選用車身中心點判斷在不在 map.getBounds() 裡，鏡頭對準頭尾車廂、
//    拉到最近時，141 m 的六節車中心點早已出框，整列不畫（跟車的那一列豁免，所以多半發生在沒跟車的瀏覽）。
// 判準分兩層：stats 是實作自己的回報（同源，只當前置條件，證明這一張真的走到那條路徑）；
// 證據是同一視角「有車 vs 沒車」的像素差，只算那一列車投影出來的範圍。
// 2D 車牌那層 canvas 會隨「有沒有車模」切換，量測時先藏起來，否則兩張截圖的差有一部分是車牌。
import fs from 'node:fs';import {chromium,webkit}from'playwright';
import {createRequire} from 'node:module';const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5179/',out='output/3d-close-zoom';fs.mkdirSync(out,{recursive:true});
const rows=[],only=process.env.ENGINES?.split(',');
// 資料最深的軌面要在地下透視的遠裁切面延伸範圍之內，不然最深那段一樣會被切掉。
{
 const src=fs.readFileSync('rail-3d/integration/map3d.js','utf8'),floor=Number(src.match(/UNDERGROUND_FLOOR_M=(\d+(?:\.\d+)?)/)?.[1]);
 const levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json','utf8')).entries;let deepest={m:Infinity};
 for(const [way,e]of Object.entries(levels))for(const field of ['offsets','flatOffsets','terrainValues','values'])for(const v of e[field]||[])if(Number.isFinite(v)&&v<deepest.m)deepest={m:v,way,field};
 // 軌面＝剖面值＋0.65 m；車底就在軌面上，車頂更高，留 5 m 餘裕。
 rows.push({test:'資料最深的軌面仍在地下透視的範圍內',pass:Number.isFinite(floor)&&deepest.m+.65>-floor+5,floor,deepest});
}
// 板南線國父紀念館一帶整段在地下，平面模式軌面約 −17～−19 m；兩個方向各取離車站最近的一列班表車。
const STATION=[121.5576,25.0414];
const VIEWS={desktop:{viewport:{width:1100,height:820}},phone:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}};
// kind 決定這一張要先證明的前置條件：far＝MapLibre 自己的遠裁切面停在車頂之上；cull＝車身中心點在 getBounds() 之外；
// control＝兩者都不成立（修正前就看得到，用來證明這套量法量得到車）。align：把列車轉成沿著畫面短邊，中心點才會出框。
// pad：中心點連「畫面外放寬四分之一」的框都出了——那個框原本拿來決定要不要替車算位置，候選放寬了它也要跟著放寬。
const SHOTS={
 desktop:[
  {name:'對照-俯角50',kind:'control',place:'d1',zoom:17,pitch:50,halo:true},
  {name:'遠裁切-z16.5',kind:'far',place:'d1',zoom:16.5,pitch:0},
  {name:'遠裁切-z18',kind:'far',place:'d1',zoom:18,pitch:0,halo:true,hit:true},
  {name:'遠裁切-另一方向-z19',kind:'far',place:'d2',zoom:19,pitch:0},
  {name:'出框加遠裁切-第1節-z19',kind:'far+cull',place:'d1',zoom:19,pitch:0,car:0,align:'short'},
 ],
 phone:[
  {name:'遠裁切-z17.5',kind:'far',place:'d1',zoom:17.5,pitch:0,halo:true,hit:true,tap:true},
  {name:'出框-第2節-z19-俯角45',kind:'cull',place:'d2',zoom:19,pitch:45,car:1,align:'short'},
  {name:'出框過寬鬆框-第1節-z19-俯角45',kind:'cull',pad:true,place:'d2',zoom:19,pitch:45,car:0,align:'short'},
  {name:'出框加遠裁切-第2節-z19',kind:'far+cull',place:'d1',zoom:19,pitch:0,car:1,align:'short'},
 ],
};
const changed=(a,b,i,limit)=>Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>limit;
// 每節車 8 個角投影到螢幕取凸包，點在凸包裡、又在地圖畫布範圍內，就算車身範圍。
function carMask(cars,W,H,clip){
 const mask=new Uint8Array(W*H);
 for(const car of cars){
  const pts=car.corners.map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
  for(const p of pts){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of pts.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  const hull=lower.slice(0,-1).concat(upper.slice(0,-1));if(hull.length<3)continue;
  const x0=Math.max(0,Math.ceil(clip.left),Math.floor(Math.min(...hull.map(p=>p[0])))),x1=Math.min(W-1,Math.floor(clip.right)-1,Math.ceil(Math.max(...hull.map(p=>p[0])))),
        y0=Math.max(0,Math.ceil(clip.top),Math.floor(Math.min(...hull.map(p=>p[1])))),y1=Math.min(H-1,Math.floor(clip.bottom)-1,Math.ceil(Math.max(...hull.map(p=>p[1]))));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){let inside=true;for(let i=0;i<hull.length&&inside;i++)inside=cross(hull[i],hull[(i+1)%hull.length],[x+.5,y+.5])>=0;if(inside)mask[y*W+x]=1;}
 }
 return mask;
}

for(const [engine,type]of Object.entries({chromium,webkit})){
 if(only&&!only.includes(engine))continue;
 const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 for(const [view,options]of Object.entries(VIEWS)){
  const context=await browser.newContext({...options,locale:'zh-TW',timezoneId:'Asia/Taipei'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const W=options.viewport.width,H=options.viewport.height;
  try{
   await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
   await page.goto(base+'?g=all&scene=3d&t=08:00');
   // 本機沒有即時來源，state.ready 不一定成立；只等 3D 這層與實體股道（開機後數秒才到）。
   await page.waitForFunction(()=>window.railIslandPhysical?.metro&&window.railIslandIntegration?.renderer&&typeof M!=='undefined',null,{timeout:120000});
   await page.waitForFunction(()=>railIslandIntegration.capture().vehicles.some(v=>v.routeId==='BL'&&v.route?.physical&&v.route?.level),null,{timeout:90000});
   const boot=await page.evaluate(station=>{
    // 停掉模擬時鐘與 3D 接點自己的重畫：之後只畫受測的那一列，背景兩張截圖之間才不會動。
    railIslandIntegration.render=()=>{};try{state.playing=false;clearFollow?.();}catch(e){}
    const frame=railIslandIntegration.capture(),bl=frame.vehicles.filter(v=>v.routeId==='BL'&&v.route?.physical&&v.route?.level);
    const nearest=dir=>bl.filter(v=>Math.sign(v.direction)===dir).sort((a,b)=>Math.hypot(a.longitude-station[0],a.latitude-station[1])-Math.hypot(b.longitude-station[0],b.latitude-station[1]))[0];
    window.__t={frame,veh:{d1:{...nearest(1),followed:false},d2:{...nearest(-1),followed:false}}};
    window.__u=(v,{train=true,halo=false}={})=>railIslandIntegration.renderer.update({...frame,vehicles:train?[v]:[],routes:[v.route],display:{...frame.display,enabled:true,modelMode:'all',trainHalo:halo},followLock:false,selectedVehicleId:null});
    return {maxZoom:M.raw.getMaxZoom(),deco:state.deco,vehicles:Object.fromEntries(Object.entries(__t.veh).map(([k,v])=>[k,{id:v.id,lon:+v.longitude.toFixed(5),lat:+v.latitude.toFixed(5)}]))};
   },STATION);
   console.log(engine,view,JSON.stringify(boot));
   await page.addStyleTag({content:'#overlay{visibility:hidden!important}'});
   const settle=async()=>{
    await page.evaluate(()=>{M.raw.triggerRepaint();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:30000}).catch(()=>{});await page.waitForTimeout(350);
   };
   for(const shot of SHOTS[view]){
    const label=`${engine}-${view}-${shot.name}`;
    try{
     // 先在安全視角把車模載好（中心點在畫面內、俯角夠大，不會被裁掉），再跳到受測視角。
     await page.evaluate(k=>{const v=__t.veh[k];M.raw.jumpTo({center:[v.longitude,v.latitude],zoom:17,pitch:50,bearing:0});__u(v);},shot.place);
     await page.waitForFunction(k=>{__u(__t.veh[k]);return railIslandIntegration.renderer.stats.models===1;},shot.place,{timeout:60000});
     // 車在地下多深要在這裡記：受測視角下車模可能根本沒建（成因 2），就讀不到。
     const safe=await page.evaluate(()=>{const cars=railIslandIntegration.renderer.stats.poseSamples[0].cars;return {heights:cars.map(c=>+c.height.toFixed(2)),underground:cars.every(c=>c.underground)};});
     await page.evaluate(([k,shot,W,H])=>{
      const v=__t.veh[k],cars=railIslandIntegration.renderer.stats.poseSamples[0].cars,target=shot.car==null?[v.longitude,v.latitude]:cars[shot.car].coordinate;
      let bearing=0;
      if(shot.align){
       // 讓「中心點 → 受測車廂」沿著畫面短邊：寬螢幕朝上、直式手機朝右，中心點落在短邊外側。
       const k2=Math.cos(v.latitude*Math.PI/180),az=Math.atan2((target[0]-v.longitude)*k2,target[1]-v.latitude)*180/Math.PI;
       bearing=W>=H?az:az-90;
      }
      M.raw.jumpTo({center:target,zoom:shot.zoom,pitch:shot.pitch,bearing});for(let i=0;i<3;i++)__u(v);
     },[shot.place,shot,W,H]);
     await page.waitForTimeout(400);await page.evaluate(k=>__u(__t.veh[k]),shot.place);await settle();await page.evaluate(k=>__u(__t.veh[k]),shot.place);await settle();
     const st=await page.evaluate(k=>{
      const v=__t.veh[k],r=railIslandIntegration.renderer,s=r.stats,t=M.raw.transform,b=M.raw.getBounds(),lat=v.latitude,pitch=M.raw.getPitch()*Math.PI/180;
      const mx=111320*Math.cos(lat*Math.PI/180),my=110574;
      // 中心點離框多遠（公尺，正值＝在框外）
      const out=Math.max(b.getWest()-v.longitude,v.longitude-b.getEast())*mx,outY=Math.max(b.getSouth()-lat,lat-b.getNorth())*my;
      const padX=(b.getEast()-b.getWest())*.25,padY=(b.getNorth()-b.getSouth())*.25,
        outsidePad=v.longitude<b.getWest()-padX||v.longitude>b.getEast()+padX||lat<b.getSouth()-padY||lat>b.getNorth()+padY;
      // MapLibre 自己的遠裁切面在畫面正中視線上能看到地表下多深（平面模式地表＝0）
      const visDepthM=(t.farZ-t.cameraToCenterDistance)*Math.cos(pitch)/t.pixelsPerMeter;
      const cars=s.poseSamples[0]?.cars||[];
      return {zoom:+M.raw.getZoom().toFixed(2),pitch:+M.raw.getPitch().toFixed(1),bearing:+M.raw.getBearing().toFixed(1),cand:s.modelCandidates,models:s.models,ug:s.undergroundModels,
       centerOutM:+Math.max(out,outY).toFixed(1),outsidePad,visDepthM:+visDepthM.toFixed(1),carHeights:cars.map(c=>+c.height.toFixed(2)),underground:cars.length>0&&cars.every(c=>c.underground),
       projected:r.projectedCars(),canvas:(({left,top,right,bottom})=>({left,top,right,bottom}))(M.raw.getCanvas().getBoundingClientRect()),errors:s.errors.slice(0,3)};
     },shot.place);
     const withTrain=PNG.sync.read(await page.screenshot({path:`${out}/${label}-有車.png`})).data;
     await page.evaluate(k=>__u(__t.veh[k],{train:false}),shot.place);await settle();
     const empty=PNG.sync.read(await page.screenshot({path:`${out}/${label}-無車.png`})).data;
     // projectedCars 是相對地圖畫布的座標；截圖是整頁，要加上畫布在頁面上的位置，畫布外（工具列等）不算。
     const mask=carMask(st.projected.map(c=>({corners:c.corners.map(p=>({x:p.x+st.canvas.left,y:p.y+st.canvas.top}))})),W,H,st.canvas);let maskPx=0,diffPx=0,screenDiff=0;
     for(let k=0,i=0;k<mask.length;k++,i+=4){const d=changed(withTrain,empty,i,30);if(d)screenDiff++;if(mask[k]){maskPx++;if(d)diffPx++;}}
     let haloPx=null,haloStats=null;
     if(shot.halo){
      await page.evaluate(k=>__u(__t.veh[k],{halo:true}),shot.place);await settle();await page.evaluate(k=>__u(__t.veh[k],{halo:true}),shot.place);await settle();
      haloStats=await page.evaluate(()=>{const h=railIslandIntegration.renderer.stats.trainHalo;return {cars:h.cars,surface:h.surface,underground:h.underground};});
      const withHalo=PNG.sync.read(await page.screenshot({path:`${out}/${label}-光暈.png`})).data;
      // 光暈很淡（白天約一成），門檻放低；兩張都有車，差的只有光暈。
      haloPx=0;for(let i=0;i<withHalo.length;i+=4)if(changed(withHalo,withTrain,i,10))haloPx++;
     }
     let hit=null,tap=null;
     if(shot.hit){
      await page.evaluate(k=>__u(__t.veh[k]),shot.place);await settle();
      // 點擊列車走的就是這個介面（index.html 的 freqTrainsAt／trainsAt），量最靠近畫面正中那一節的投影中心。
      hit=await page.evaluate(()=>{const r=M.raw.getCanvas().getBoundingClientRect(),cars=railIslandIntegration.renderer.projectedCars(),cx=r.width/2,cy=r.height/2,
        c=cars.slice().sort((a,b)=>Math.hypot(a.center.x-cx,a.center.y-cy)-Math.hypot(b.center.x-cx,b.center.y-cy))[0];
       if(!c)return {why:'沒有車模'};const hits=railIslandIntegration.hits({x:c.center.x,y:c.center.y},true);
       return {x:+(c.center.x+r.left).toFixed(1),y:+(c.center.y+r.top).toFixed(1),hits:hits.length,line:hits[0]?.ln?.name||hits[0]?.ln?.id||null};});
      // 手機上真的點一下：點得到就會開始跟這一列車。放在最後，跟車會動鏡頭。
      if(shot.tap&&hit.x!=null){
       await page.evaluate(()=>{try{clearFollow?.();}catch(e){}});
       await page.touchscreen.tap(hit.x,hit.y);await page.waitForTimeout(600);
       tap=await page.evaluate(()=>({following:!!state.freqFollow,line:state.freqFollow?.ln?.name||null}));
       await page.evaluate(()=>{try{clearFollow?.();}catch(e){}});
      }
     }
     const frac=maskPx?diffPx/maskPx:0,deep=Math.max(...safe.heights)<-10;
     // 前置條件：這一張真的走到要測的那條路徑（修正前後都要成立，跟修法無關）。車頂約在軌面上 4.5 m 內。
     const roof=-Math.max(...safe.heights)-4.5,
       pre={far:st.visDepthM<roof,cull:st.centerOutM>0,control:st.centerOutM<0&&st.visDepthM>-Math.min(...safe.heights)+1};
     const preOk=shot.kind.split('+').every(k=>pre[k])&&(!shot.pad||st.outsidePad)&&deep&&safe.underground;
     const row={engine,view,shot:shot.name,kind:shot.kind,zoom:st.zoom,pitch:st.pitch,bearing:st.bearing,cand:st.cand,models:st.models,ug:st.ug,
      centerOutM:st.centerOutM,outsidePad:st.outsidePad,visDepthM:st.visDepthM,carHeights:safe.heights.slice(0,2),maskPx,diffPx,frac:+frac.toFixed(3),screenDiff,errors:st.errors};
     rows.push({...row,test:'前置條件：車在地下、這一張真的走到受測的路徑',pass:preOk});
     rows.push({engine,view,shot:shot.name,test:'整列車畫得出來（stats 有車模＋車身範圍內的像素真的變了）',pass:st.cand>=1&&st.models===1&&maskPx>=400&&frac>=.35,
      cand:st.cand,models:st.models,maskPx,frac:+frac.toFixed(3)});
     if(shot.halo)rows.push({engine,view,shot:shot.name,test:'地下車的光暈也畫得出來',pass:haloStats.cars>=1&&haloPx>=1500,haloStats,haloPx});
     if(shot.hit)rows.push({engine,view,shot:shot.name,test:'點車身中央那一節點得到這一列',pass:hit.hits>=1,hit});
     if(shot.tap)rows.push({engine,view,shot:shot.name,test:'手機上真的點一下就開始跟這一列',pass:!!tap?.following,tap,deco:boot.deco});
     console.log(label,JSON.stringify({...row,halo:haloPx,haloStats,hit,tap}));
    }catch(e){rows.push({engine,view,shot:shot.name,pass:false,error:String(e).slice(0,300)});console.log(label,e);}
   }
   rows.push({engine,view,test:'無頁面錯誤',pass:!errors.length,errors:errors.slice(0,3)});
  }catch(e){rows.push({engine,view,pass:false,error:String(e).slice(0,300)});console.log(e);}
  finally{await context.close();}
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(rows,null,1));
const failed=rows.filter(r=>!r.pass);console.log({checks:rows.length,failed:failed.length});if(failed.length){console.log(failed.map(r=>[r.engine,r.view,r.shot,r.test,r.error].filter(Boolean).join(' | ')).join('\n'));process.exitCode=1;}

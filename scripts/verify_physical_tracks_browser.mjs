import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// 伺服器自己起、連接埠由 OS 指派:本機同時開著 30+ 個 worktree,寫死 5208 會安靜地去驗別人那棵樹
// ——全綠也毫無意義。ROOT 由本檔路徑推導,結構上只可能服務自己這棵樹;BASE_URL 仍可覆寫,
// 但那條路要自己負責樹對不對(沿用原本手動起 server 的用法)。
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(ROOT);
const freePort=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const{port}=s.address();s.close(()=>r(port));});});
let child=null,base=process.env.BASE_URL;
if(!base){const port=await freePort();base=`http://localhost:${port}/`;
 child=spawn(process.execPath,[path.join(ROOT,'scripts/dev_server.mjs')],{cwd:ROOT,env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','inherit']});
 process.on('exit',()=>child?.kill());
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{child?.kill();process.exit(1);});
 for(let i=0;;i++){try{if((await fetch(base+'index.html')).ok)break;}catch{} if(i>100){console.error('✗ dev server 起不來 '+base);child.kill();process.exit(1);} await new Promise(r=>setTimeout(r,100));}
}
const rows=[];
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
  // 近景(raw zoom>=14)會把班表線的示意線形整批抽掉、換成實體股道,並把被抽掉的 lineKey 交給
  // profileKeys() 讓 2D GL 軌道層別再畫。宣告換圖卻換不出東西來的系統,兩邊都不畫＝**線直接消失**。
  // 這是白名單分兩份時的必然結果(rail-3d.js 曾自己寫死一份 ['tra_sched','thsr_sched','afr_sched'])。
  // 這條**不是**在驗「換出來的股道在視野裡」——visibleRoutes() 有視野過濾,那樣寫會假紅。
  // 它驗的是抽換端與白名單的一致性:被抽掉的 _sched 系統有沒有全部出自 physical.systems。
  // 「線消失」這個症狀本身由 check-afr 的 H 段守(量 GL 圖層 filter,且它在 ship_web preflight 裡);
  // 這條守的是根因——名單只准有一份。
  const swap=await page.evaluate(()=>{const c=railIslandIntegration.capture();
   const sys=[...new Set((c.replacedLineKeys||[]).map(k=>k.split('|')[0]))],sched=sys.filter(s=>s.endsWith('_sched'));
   return {zoom:M.raw.getZoom(),systems:sys,sched,physical:railIslandPhysical.systems||null,
    orphan:sched.filter(s=>!(railIslandPhysical.systems||[]).includes(s))};});
  // 修好之後 orphan 恆為 0 是**結構性**的(抽換名單就是 physical.systems 本身),所以這條只擋一件事:
  // 有人再寫第二份名單。也因此分母要具名 gate——sched 一旦是空的,它就退化成零量測的假綠。
  check(name+' 近景抽換的班表系統都出自 physical.systems 這份唯一白名單（抽換 '+swap.sched.length+' 個：'+(swap.sched.join('／')||'無')+'；名單外：'+(swap.orphan.join(',')||'無')+'）',
   swap.zoom>=14&&Array.isArray(swap.physical)&&swap.sched.length>0&&swap.orphan.length===0,swap);
  await page.screenshot({path:`output/physical-browser/${name}-taipei.png`});
  // A54 已捕獲的六組車：在同一時間與股道上重放，直接量實際模型矩陣與地圖投影。
  const fixture=JSON.parse(fs.readFileSync('scripts/fixtures/physical-taipei-0908.json'));
  await page.evaluate(fixture=>{
   state.playing=false;clearFollow();clearFreqFollow();railIslandIntegration.render=()=>{};
   const vehicles=fixture.vehicles.map(v=>{const g=v.systemId.endsWith('_sched')?railIslandPhysical.geometry:railIslandPhysical.metro.geometry;
    return {...v,route:g.route(v.pathIds,v.systemId,v.color,v.extension),followed:false};});
   const frame=railIslandIntegration.capture();
   window.__ontrackVehicles=vehicles;
   window.__ontrackUpdate=()=>{railIslandIntegration.renderer.update({...frame,clock:{...frame.clock,simSec:fixture.simSec},vehicles,routes:vehicles.map(v=>v.route),followLock:false,selectedVehicleId:null,display:{...frame.display,enabled:true,modelMode:'all'}});return railIslandIntegration.renderer.stats.models;};
   M.raw.jumpTo({center:fixture.center,zoom:16.5,pitch:60,bearing:0});__ontrackUpdate();
  },fixture);
  await page.waitForFunction(()=>__ontrackUpdate()===6,null,{timeout:30000});
  for(const view of [{bearing:0,pitch:60},{bearing:35,pitch:45},{bearing:-35,pitch:60}]){
   await page.evaluate(view=>{M.raw.jumpTo(view);__ontrackUpdate();},view);await page.waitForTimeout(100);
   const alignment=await page.evaluate(()=>{
    const r=railIslandIntegration.renderer,projected=r.projectedCars();let maxSourceM=0,maxScreenPx=0,count=0;
    const distance=(p,a,b)=>{const mx=111320*Math.cos(p[1]*Math.PI/180),x=(p[0]-a[0])*mx,y=(p[1]-a[1])*111320,dx=(b[0]-a[0])*mx,dy=(b[1]-a[1])*111320,t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-t*dx,y-t*dy);};
    for(const pose of r.stats.poseSamples){const v=__ontrackVehicles.find(v=>v.id===pose.id),g=v.systemId.endsWith('_sched')?railIslandPhysical.geometry:railIslandPhysical.metro.geometry;
     for(let i=0;i<pose.cars.length;i++){const p=pose.cars[i],point=v.route.path.at(p.s),edge=v.route.edges[point.index],w=g.wayById.get(edge.wayId),j=Number(edge.edgeId.slice(edge.edgeId.lastIndexOf(':')+1));
      maxSourceM=Math.max(maxSourceM,distance(p.coordinate,w.coordinates[j],w.coordinates[j+1]));
      const actual=projected.find(c=>c.id===v.id&&c.index===i).center,expected=M.raw.project(point.coordinate);
      maxScreenPx=Math.max(maxScreenPx,Math.hypot(actual.x-expected.x,actual.y-expected.y));count++;
     }
    }
    return {count,maxSourceM,maxScreenPx,models:r.stats.models};
   });
   // .65m 的車底高度在此倍率投影小於 1px；5–15m 的錯誤橫移會明顯超過。
   check(name+' A54 Taipei cars align with source rails '+view.bearing,alignment.count===45&&alignment.maxSourceM<.00001&&alignment.maxScreenPx<1,alignment);
  }
  await page.screenshot({path:`output/physical-browser/${name}-taipei-ontrack.png`});

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
  check(name+' overlapping formations stay on assigned track',meeting.poses.length===2&&meeting.poses.every(p=>!p.avoidanceOffsetM),{offsets:meeting.poses.map(p=>p.avoidanceOffsetM||0)});
  await page.waitForTimeout(150);
  const hits=await page.evaluate(()=>{const r=railIslandIntegration.renderer;return r.projectedCars().filter(c=>c.index===0).map(c=>({id:c.id,hit:r.hitTest(c.roof).some(h=>h.id===c.id)}));});
  check(name+' on-track model hit testing',hits.length===2&&hits.every(h=>h.hit),{hits});
  await page.screenshot({path:`output/physical-browser/${name}-passing.png`});
  await page.evaluate(()=>__passing(true));
  const returned=await page.evaluate(()=>__passing(true));check(name+' no lateral return after passing',returned.poses.every(p=>!p.avoidanceOffsetM),{offsets:returned.poses.map(p=>p.avoidanceOffsetM||0)});
  for(const width of [360,375,414,768]){
   await page.setViewportSize({width,height:900});
   for(const dir of [1,-1]){await page.waitForFunction(args=>__case(...args).visible,['G',dir,8],{timeout:30000});check(name+' mobile '+width+' direction '+dir,true);}
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);check(name+' mobile '+width+' no horizontal overflow',!overflow);
  }
  check(name+' no script errors',errors.length===0,{errors});

  // ── 低倍率(2D、z=11)＋停靠中：畫出來的軌道要蓋住列車真正的所在 ──────────────────
  // 上面那些全部是 scene=3d、z=18、只有捷運;而列車位置吃實體股道是**沒有 zoom 閘門**的
  // (index.html trainPosAt 第一行)，畫出來的線卻是 state.trackLines。2026-09-07 林鐵那個
  // 回歸(阿里山 94m、神木 164m,停靠中)就正好落在這支腳本結構上照不到的角落:非捷運、
  // 低倍率、停靠中。判準量的是「列車位置 vs 畫出來的線」，不是同一層自己跟自己比。
  const survey=await (async()=>{
   const page2=await context.newPage();
   await page2.goto(base+'?g=all&z=11&at=23.7,120.9&lang=zh-TW');
   await page2.waitForFunction(()=>typeof state!=='undefined'&&state.ready===true,null,{timeout:90000});
   await page2.waitForFunction(()=>!!window.railIslandPhysical,null,{timeout:90000});
   const out=await page2.evaluate(()=>{
    const seg=(pt,a,b)=>{const k=Math.cos(pt[0]*Math.PI/180),R=111320,px=(pt[1]-a[1])*k*R,py=(pt[0]-a[0])*R,bx=(b[1]-a[1])*k*R,by=(b[0]-a[0])*R,L2=bx*bx+by*by,t=L2?Math.max(0,Math.min(1,(px*bx+py*by)/L2)):0;return Math.hypot(px-t*bx,py-t*by);};
    const toLine=(pt,sh)=>{let m=Infinity;for(let i=1;i<sh.length;i++){const d=seg(pt,sh[i-1],sh[i]);if(d<m)m=d;}return m;};
    const shapes={};for(const ln of state.trackLines)(shapes[ln.sys]||=[]).push(ln.shape);
    const stat={},seen=new Set(),phys=new Set();
    for(const hour of [6,8,11,14,17,20])for(const tr of state.trains){
     const p=window.railIslandPhysical.sample(tr,hour*3600,{wrap:typeof schedWrapT!=='undefined'?schedWrapT:undefined});
     seen.add(tr.sys);if(p?.physical)phys.add(tr.sys);   // 有一班取到實體樣本就算這個系統有涵蓋
     if(!p?.physical||!shapes[tr.sys])continue;
     const d=Math.min(...shapes[tr.sys].map(s=>toLine([p.lat,p.lon],s))),s=stat[tr.sys]||={n:0,dwell:0,off:0,offDwell:0,worst:0,at:null};
     s.n++;if(p.dwell)s.dwell++;
     if(d>50){s.off++;if(p.dwell)s.offDwell++;}
     if(d>s.worst){s.worst=+d.toFixed(0);s.at=`${tr.train}@${hour}時${p.dwell?'停靠':'行駛'} ${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;}
    }
    return {zoom:M.getZoom(),scene:state.scene||'2d',stat,
     seen:[...seen].sort(),covered:[...phys].sort()};
   });
   await page2.close();return out;
  })();
  check(name+' low zoom survey',survey.zoom<14,survey);   // 低於實體股道換圖的 z=14 才算數
  // 覆蓋率要具名,否則分母會無聲縮水:下面那圈是 for(stat 裡有的系統),某個系統一旦退出
  // client.js 的 PHYSICAL_SYSTEMS 白名單就整個不見,而「少驗一個系統」與「全部通過」長得一模一樣。
  // 🔴 改動 PHYSICAL_SYSTEMS 必須同輪改這一行——把 afr_sched 加回去時,林鐵那條斷言才會跟著活過來。
  check(`${name} 吃實體股道的系統恰為 tra_sched／thsr_sched（實得 ${survey.covered.join('／')||'無'}，班表載到 ${survey.seen.join('／')}）`,
   survey.covered.join()==='thsr_sched,tra_sched',{covered:survey.covered,seen:survey.seen});
  for(const [sys,s] of Object.entries(survey.stat)){
   // 林鐵/高鐵的線形已經跟實體股道對齊過,一處都不准離線;台鐵還有 09-07 那批未修的路廊
   // (東澳雙坑、五堵、南港、山線),用比例當閘門而不是釘死顆數——台鐵班表每週重抓,
   // 顆數本來就會漂,比例才擋得住「整條線走鐘」這種真回歸。
   const ratio=s.off/s.n;
   check(`${name} ${sys} 實體位置落在畫出來的軌道上 (${s.n}樣本/${s.dwell}停靠, 離線${s.off}, 最遠${s.worst}m)`,
    sys==='tra_sched'?ratio<0.02:s.off===0,{...s,ratio:+ratio.toFixed(4)});
  }
 }finally{await browser.close();fs.writeFileSync('output/physical-browser/results.json',JSON.stringify(rows,null,2));}
}
console.log(`${rows.filter(r=>r.pass).length}/${rows.length}`);
child?.kill();

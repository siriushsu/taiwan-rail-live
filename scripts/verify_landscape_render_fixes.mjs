import fs from 'node:fs';import {chromium,webkit} from 'playwright';import {createRequire} from 'node:module';const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:53723/',out='output/render-fixes',results=[];fs.mkdirSync(out,{recursive:true});
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));};
for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.ENGINE&&engine!==process.env.ENGINE)continue;
 const b=await type.launch(),p=await b.newPage({viewport:{width:1280,height:900},locale:'zh-TW'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
 await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');});
 await p.goto(base+'?scene=3d&g=all&map=light&t=21:00&at=25.047,121.517&z=17');await p.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&window.railIslandIntegration?.renderer&&window.railIslandSunlight&&window.railIslandPhysical?.portalPaths,null,{timeout:120000});
 await p.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();M.raw.jumpTo({center:[121.517,25.047],zoom:17,pitch:60,bearing:160});});await p.waitForTimeout(1000);
 check(engine+' 明亮預設關閉日夜',await p.evaluate(()=>!railIslandSunlight.enabled&&!state.mapDark));
 await p.evaluate(()=>state._setAppearance('dark'));await p.waitForFunction(()=>railIslandIntegration?.renderer&&railIslandSunlight.enabled);
 check(engine+' 暗色預設開啟日夜',await p.evaluate(()=>railIslandSunlight.enabled&&state.mapDark));
 await p.evaluate(()=>document.getElementById('sunlightRow').click());await p.evaluate(()=>state._setAppearance('light'));await p.evaluate(()=>state._setAppearance('dark'));
 check(engine+' 各外觀保留手動選擇',await p.evaluate(()=>!railIslandSunlight.enabled));
 await p.evaluate(()=>{state._setAppearance('light');});await p.waitForFunction(()=>railIslandIntegration?.renderer);await p.evaluate(()=>{railIslandIntegration.setGroundMode('flat');M.raw.jumpTo({center:[121.517,25.047],zoom:17,pitch:60,bearing:160});});
 await p.waitForFunction(()=>railIslandIntegration?.renderer?.stats.undergroundRailSegments>100&&railIslandIntegration.renderer.stats.structures.piers===0,null,{timeout:30000});
 check(engine+' 台北地下路網没有孤立橋墩',true,await p.evaluate(()=>({underground:railIslandIntegration.renderer.stats.undergroundRailSegments,piers:railIslandIntegration.renderer.stats.structures.piers})));
 await p.screenshot({path:`${out}/${engine}-taipei-fixed.png`});
 // 使用者補充的位置：林口—龜山高鐵隧道，明亮底圖、地形關閉、夜间光影開啟。
 await p.evaluate(async()=>{const {makePath}=await import('./rail-3d/integration/train-path.js'),routes=railIslandPhysical.geometry.drawingWays('thsr_sched','#ef7821').filter(r=>['198049016','198049017'].includes(String(r.routeId))),path=makePath(routes[0].coordinates);window.__linkouCenter=path.at(path.length/2).coordinate;window.__linkouFrame=railIslandIntegration.capture();window.__linkouRender=railIslandIntegration.render;railIslandIntegration.render=()=>{};window.__linkouUpdate=()=>railIslandIntegration.renderer.update({...__linkouFrame,routes,vehicles:[],selectedVehicleId:null,followLock:false});railIslandSunlight.setEnabled(true);railIslandSunlight.update(true);M.raw.jumpTo({center:__linkouCenter,zoom:19.2,pitch:72,bearing:160});__linkouUpdate();});
 await p.waitForFunction(()=>{__linkouUpdate();return railIslandIntegration?.renderer?.stats.undergroundRailSegments>10&&railIslandIntegration.renderer.stats.structures.piers===0;},null,{timeout:30000});
 check(engine+' 林口隧道夜間平面圖没有橋墩',true,await p.evaluate(()=>({coordinate:__linkouCenter,underground:railIslandIntegration.renderer.stats.undergroundRailSegments,piers:railIslandIntegration.renderer.stats.structures.piers})));
 await p.screenshot({path:`${out}/${engine}-linkou-flat.png`});await p.evaluate(()=>{railIslandIntegration.render=__linkouRender;});
 // 真正的高架橋：夜間明亮底圖、低角度，量橋跨中間的像素，不能只驗橋墩存在。
 await p.evaluate(()=>{railIslandSunlight.setEnabled(true);railIslandSunlight.update(true);M.raw.jumpTo({center:[120.3247,23.48],zoom:19.2,pitch:75,bearing:65});});
 await p.waitForFunction(()=>railIslandIntegration?.renderer?.stats.structures.decks>3&&railIslandIntegration.renderer.stats.structures.piers>3&&M.raw.areTilesLoaded(),null,{timeout:120000});
 const bridge=await p.evaluate(async()=>{const THREE=await import('./rail-3d/vendor/three.module.js');window.__structureMeshes=new Set();window.__beamMeshes=new Set();const original=THREE.Mesh.prototype.onBeforeRender;
  THREE.Mesh.prototype.onBeforeRender=function(...args){if(this.geometry?.attributes.railGlow)__structureMeshes.add(this);if(this.geometry?.attributes.beamStrength)__beamMeshes.add(this);return original.apply(this,args);};
  const r=railIslandIntegration.renderer,rect=M.raw.getCanvas().getBoundingClientRect(),routes=railIslandIntegration.capture().routes.filter(x=>['197653374','197653373'].includes(String(x.routeId))),{makePath}=await import('./rail-3d/integration/train-path.js'),spots=[];
  for(const route of routes){const path=makePath(route.coordinates),center=path.locate([120.3247,23.48]).s;for(let d=-100;d<100;d+=3){const s=center+d,q=path.at(s)?.coordinate;if(!q)continue;
    if(r.stats.structures.samples.some(p=>Math.hypot((p.coordinate[0]-q[0])*101000,(p.coordinate[1]-q[1])*111320)<9))continue;
    const point=r.projectCoordinate(q,route.level(s).offsetM-.25),x=point.x+rect.x,y=point.y+rect.y;if(x>10&&x<innerWidth-10&&y>170&&y<innerHeight-170)spots.push([Math.round(x),Math.round(y)]);
  }}return {spots,decks:r.stats.structures.decks,piers:r.stats.structures.piers};});
 const bridgeLit=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-night-bridge.png`}));await p.evaluate(()=>{for(const m of __structureMeshes)m.material.colorWrite=false;M.raw.triggerRepaint();});await p.waitForTimeout(200);const bridgeHidden=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-night-bridge-hidden.png`}));await p.evaluate(()=>{for(const m of __structureMeshes)m.material.colorWrite=true;M.raw.triggerRepaint();});let bridgePixels=0;
 for(const [x,y]of bridge.spots){const i=(y*bridgeLit.width+x)*4;if([0,1,2].reduce((s,k)=>s+Math.abs(bridgeLit.data[i+k]-bridgeHidden.data[i+k]),0)>20)bridgePixels++;}
 check(engine+' 夜間低角度高架橋面確實可見',bridge.spots.length>8&&bridgePixels>8,{...bridge,bridgePixels});
 await p.evaluate(()=>{railIslandSunlight.setEnabled(false);chooseBasemap('landscape');});await p.waitForFunction(()=>railIslandIntegration?.renderer);await p.evaluate(()=>{railIslandIntegration.setGroundMode('terrain');M.raw.jumpTo({center:[121.86627,25.03412],zoom:19.3,pitch:65,bearing:6});});
 await p.waitForFunction(()=>railIslandIntegration?.renderer?.stats.structures.portalSamples.some(p=>Math.abs(p.coordinate[1]-25.03412)<.0001)&&M.raw.areTilesLoaded(),null,{timeout:120000});
 for(const bearing of [-24,6,36]){
 await p.evaluate(bearing=>M.raw.jumpTo({bearing}),bearing);await p.waitForTimeout(350);
 const points=await p.evaluate(()=>{const r=railIslandIntegration.renderer,p=r.stats.structures.portalSamples.find(p=>Math.abs(p.coordinate[1]-25.03412)<.0001),out=[],ratio=p.scale;
  const merc=maplibregl.MercatorCoordinate.fromLngLat([121,24]),unit=merc.meterInMercatorCoordinateUnits();
  for(const u of [-.65,-.3,0,.3,.65])for(const z of [1.4,2.3,3.2]){const x=p.p[0]-Math.sin(p.angle)*u*p.halfWidth*ratio,y=p.p[1]+Math.cos(p.angle)*u*p.halfWidth*ratio,q=new maplibregl.MercatorCoordinate(merc.x+x*unit,merc.y-y*unit).toLngLat(),pixel=r.projectCoordinate([q.lng,q.lat],p.p[2]/ratio+z),rect=M.raw.getCanvas().getBoundingClientRect();out.push({x:Math.round(pixel.x+rect.x),y:Math.round(pixel.y+rect.y)});}return out;});
 const after=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-portal-${bearing}.png`}));
 await p.evaluate(()=>{const l=M.raw.getLayer('live-tunnel-apertures').implementation;window.__apertureRender=l.render;l.render=()=>{};M.raw.triggerRepaint();});await p.waitForTimeout(200);
 const before=PNG.sync.read(await p.screenshot());await p.evaluate(()=>{M.raw.getLayer('live-tunnel-apertures').implementation.render=__apertureRender;M.raw.triggerRepaint();});
 const sample=png=>points.map(p=>{const i=(p.y*png.width+p.x)*4;return [...png.data.slice(i,i+3)];});const a=sample(after),bb=sample(before),dark=a.filter(c=>Math.max(...c)<120).length,changed=a.filter((c,i)=>c.some((v,k)=>Math.abs(v-bb[i][k])>20)).length;
 check(engine+' 洞口山體像素清除 '+bearing,dark>=12&&changed>=4,{dark,changed,points,after:a,before:bb});
 }
 // 取真實列車 168 的路徑與車型，固定時刻、只保留它，量頭燈的額外繪圖與地面像素。
 await p.evaluate(async()=>{setSimSec(17*3600);state.playing=false;window.__frame=railIslandIntegration.capture();window.__train=__frame.vehicles.find(v=>v.id.includes(':168:'))||__frame.vehicles.find(v=>v.systemId==='tra_sched'&&v.route?.physical);if(!__train)throw Error('找不到實際台鐵列車');railIslandIntegration.render=()=>{};window.__update=()=>railIslandIntegration.renderer.update({...__frame,vehicles:[{...__train,followed:true}],selectedVehicleId:null,followLock:false,display:{...__frame.display,modelMode:'all'}});M.raw.jumpTo({center:[__train.longitude,__train.latitude],zoom:19.7,pitch:60,bearing:20});__update();});
 await p.waitForFunction(()=>{__update();return railIslandIntegration.renderer.stats.models===1&&M.raw.areTilesLoaded();},null,{timeout:120000});
 await p.evaluate(()=>{setSimSec(21*3600);state.playing=false;railIslandSunlight.setEnabled(true);railIslandSunlight.update(true);__update();const lead=railIslandIntegration.renderer.stats.poseSamples[0].cars[0];M.raw.setCenterClampedToGround(false);M.raw.jumpTo({center:lead.coordinate,elevation:lead.height,zoom:19.7,pitch:60,bearing:90-lead.angle*180/Math.PI+55});});await p.waitForTimeout(500);
 const info=await p.evaluate(()=>({id:__train.id,stats:railIslandIntegration.renderer.stats.headlightSpill,pose:railIslandIntegration.renderer.stats.poseSamples[0].cars[0],captured:__beamMeshes.size}));
 const lit=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-headlight.png`}));await p.evaluate(()=>{for(const m of __beamMeshes)m.layers.set(4);M.raw.triggerRepaint();});await p.waitForTimeout(150);const unlit=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-headlight-off.png`}));let glow=0;for(let i=0;i<lit.data.length;i+=4)if(lit.data[i]>unlit.data[i]+8&&lit.data[i+1]>unlit.data[i+1]+4)glow++;
 check(engine+' 真實列車前方地面有柔光',info.stats.beams===1&&glow>30,{...info,glow});
 const perf=await p.evaluate(async()=>{const measure=async hide=>{for(const m of __beamMeshes)m.layers.set(hide?4:3);const frameMs=[],beamMs=[];let last=performance.now();for(let i=0;i<80;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(i>9)frameMs.push(now-last);last=now;__update();beamMs.push(railIslandIntegration.renderer.stats.headlightSpill.totalMs);}const p=(a,k)=>a.sort((a,b)=>a-b)[Math.floor(a.length*k)];return{frameP50:p(frameMs,.5),frameP90:p(frameMs,.9),beamP90:p(beamMs,.9)};};return {without:await measure(true),with:await measure(false)};});
 check(engine+' 柔光沒有新增大量算繪負擔',perf.with.beamP90<5&&perf.with.frameP50<perf.without.frameP50*1.5+4,perf);
 const directions=await p.evaluate(async()=>{const {makePath}=await import('./rail-3d/integration/train-path.js'),path=makePath(__train.route.coordinates),anchor=maplibregl.MercatorCoordinate.fromLngLat([121,24]),unit=anchor.meterInMercatorCoordinateUnits(),rows=[];
   for(const direction of [1,-1]){__train={...__train,railDirection:direction};__update();const mesh=[...__beamMeshes].find(m=>m.visible&&m.geometry.drawRange.count>0),r=railIslandIntegration.renderer,lead=r.stats.poseSamples[0].cars[0];if(!mesh){rows.push({direction,error:'光斑網格未繪出'});continue;}
     const p=mesh.geometry.attributes.position,n=mesh.geometry.drawRange.count;let x=0,y=0;for(let i=0;i<n;i++){x+=p.getX(i);y+=p.getY(i);}x=x/n+mesh.position.x;y=y/n+mesh.position.y;
     const q=new maplibregl.MercatorCoordinate(anchor.x+x*unit,anchor.y-y*unit).toLngLat(),ahead=direction*(path.locate([q.lng,q.lat]).s-lead.s);rows.push({direction,ahead,beams:r.stats.headlightSpill.beams});
   }return rows;
 });
 check(engine+' 兩個方向的地面光都在車頭前方',directions.every(r=>r.beams===1&&r.ahead>8&&r.ahead<50),directions);
 check(engine+' 無執行例外',!errors.length,errors);
 }catch(e){check(engine+' 執行',false,e.stack);}finally{await b.close();}
}
fs.writeFileSync(`${out}/regression-${process.env.ENGINE||'all'}.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

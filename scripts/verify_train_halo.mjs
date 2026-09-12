import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
import {createRequire} from 'node:module';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:53813/',out='output/train-halo',rows=[];
fs.mkdirSync(out,{recursive:true});
const check=(name,pass,detail)=>{rows.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));};
for(const [engine,type]of Object.entries({chromium,webkit})){
 if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
 const browser=await type.launch(),p=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-TW',isMobile:true,hasTouch:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  await p.goto(base+'?g=all&scene=3d&sun=on&at=22.3424,120.6167&z=20&t=17:00');
  await p.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&window.railIslandIntegration?.renderer&&window.railIslandPhysical?.portalPaths&&trainHaloStyle,null,{timeout:120000});
  await p.evaluate(async()=>{
   state.playing=false;clearFollow();clearFreqFollow();document.body.classList.add('fs');M.resize();
   const THREE=await import('./rail-3d/vendor/three.module.js'),{formationFor}=await import('./rail-3d/integration/formations.js');
   window.haloMeshes=new Set();const prior=THREE.Mesh.prototype.onBeforeRender;
   THREE.Mesh.prototype.onBeforeRender=function(...args){if(this.name==='train-halo')haloMeshes.add(this);return prior.apply(this,args);};
   window.baseFrame=railIslandIntegration.capture();window.realRender=railIslandIntegration.render;railIslandIntegration.render=()=>{};
   window.haloExamples=[baseFrame.vehicles.find(v=>v.id.includes(':168:'))];
   for(const v of baseFrame.vehicles)if(v.route&&formationFor(v)&&!haloExamples.some(x=>x?.systemId===v.systemId))haloExamples.push(v);
   window.haloTrain=haloExamples[0];window.haloVehicles=[haloTrain];
   window.updateHaloTest=()=>railIslandIntegration.renderer.update({...baseFrame,vehicles:haloVehicles,selectedVehicleId:null,followLock:false,display:{...baseFrame.display,dark:state.mapDark,enabled:true,trainHalo:trainHaloEnabled,modelMode:'all'}});
   window.haloLook=()=>{const sample=railIslandIntegration.renderer.stats.poseSamples.find(x=>x.id===haloTrain.id),c=sample.cars[Math.floor(sample.cars.length/2)];M.raw.setCenterClampedToGround(false);M.raw.jumpTo({center:c.coordinate,elevation:c.height+1.8,zoom:18.25,pitch:58,bearing:90-c.angle*180/Math.PI+65,padding:{top:0,bottom:100,left:0,right:0}});};
   M.raw.jumpTo({center:[haloTrain.longitude,haloTrain.latitude],zoom:19,pitch:58});updateHaloTest();
  });
  await p.waitForFunction(()=>{updateHaloTest();return railIslandIntegration.renderer.stats.poseSamples.length===1;},null,{timeout:90000});
  await p.evaluate(()=>haloLook());
  const pose=()=>p.evaluate(()=>JSON.stringify(railIslandIntegration.renderer.stats.poseSamples.map(s=>s.cars.map(c=>[c.coordinate,c.height,c.angle]))));
  const originalPose=await pose();
  for(const night of [true,false]){
   await p.evaluate(night=>{setSimSec((night?21:12)*3600);state.playing=false;railIslandSunlight.setEnabled(true);railIslandSunlight.update(true);updateHaloTest();},night);
   await p.waitForFunction(night=>railIslandIntegration.renderer.stats.trainHalo.night===(night?1:0),night);
   const d=await p.evaluate(()=>({stats:railIslandIntegration.renderer.stats.trainHalo,source:haloTrain.color,color:[...haloMeshes].filter(m=>m.visible).map(m=>Array.from(m.geometry.attributes.haloColor.array.slice(0,4))),materials:[...haloMeshes].map(m=>({depthTest:m.material.depthTest,depthWrite:m.material.depthWrite,layer:m.layers.mask}))}));
   const expected=night?[255,198,109]:d.source.slice(1).match(/../g).map(c=>parseInt(c,16));
   check(engine+' '+(night?'夜間100暖色':'日間70原車色'),d.stats.cars===12&&d.stats.clouds===24&&Math.abs(d.stats.strength-(night?1:.7))<1e-8&&d.color.every(c=>c.slice(0,3).every((v,i)=>Math.abs(v*255-expected[i])<.01)),d);
   check(engine+' 日夜切換原位',originalPose===await pose());
   await p.screenshot({path:`${out}/${engine}-${night?'night':'day'}.png`});
  }
  const on=PNG.sync.read(await p.screenshot());await p.evaluate(()=>{document.getElementById('trainHaloRow').click();updateHaloTest();});
  await p.waitForFunction(()=>railIslandIntegration.renderer.stats.trainHalo.clouds===0);
  const off=PNG.sync.read(await p.screenshot({path:`${out}/${engine}-off.png`}));let changed=0;
  for(let y=200;y<700;y++)for(let x=100;x<1350;x++){const i=(y*on.width+x)*4;if([0,1,2].some(k=>Math.abs(on.data[i+k]-off.data[i+k])>3))changed++;}
  check(engine+' 關閉清除柔光且不移動列車',changed>2000&&originalPose===await pose(),{changed,stats:await p.evaluate(()=>railIslandIntegration.renderer.stats.trainHalo)});
  await p.evaluate(()=>{document.getElementById('trainHaloRow').click();updateHaloTest();});
  // 隨真實編組與車廂位置測不同系統、反向編組；不依賴某種車色猜系統。
  const count=await p.evaluate(()=>haloExamples.length);
  for(let i=0;i<count;i++){
   await p.evaluate(i=>{haloTrain=haloExamples[i];haloVehicles=[haloTrain];M.raw.jumpTo({center:[haloTrain.longitude,haloTrain.latitude],zoom:19,pitch:58});updateHaloTest();},i);
   await p.waitForFunction(()=>{updateHaloTest();return railIslandIntegration.renderer.stats.poseSamples.some(s=>s.id===haloTrain.id);},null,{timeout:90000});
   await p.evaluate(()=>{haloLook();updateHaloTest();});await p.waitForTimeout(200);
   const d=await p.evaluate(()=>({sys:haloTrain.systemId,color:haloTrain.color,stats:railIslandIntegration.renderer.stats.trainHalo,cars:railIslandIntegration.renderer.stats.poseSamples[0].carCount}));
   check(engine+' 系統 '+d.sys,d.stats.trains===1&&d.stats.cars===d.cars&&d.stats.clouds===d.cars*2,d);
  }
  await p.evaluate(()=>{haloTrain=haloExamples[0];haloVehicles=[haloTrain];M.raw.jumpTo({center:[haloTrain.longitude,haloTrain.latitude],zoom:19,pitch:58});updateHaloTest();});
  await p.waitForFunction(()=>{updateHaloTest();return railIslandIntegration.renderer.stats.poseSamples.some(s=>s.id===haloTrain.id);},null,{timeout:90000});
  for(const direction of [1,-1]){
   await p.evaluate(direction=>{haloTrain={...haloTrain,railDirection:direction};haloVehicles=[haloTrain];updateHaloTest();haloLook();},direction);await p.waitForTimeout(200);
   const d=await p.evaluate(()=>({stats:railIslandIntegration.renderer.stats.trainHalo,s:railIslandIntegration.renderer.stats.poseSamples[0].cars.map(c=>c.s)}));
   check(engine+' 方向 '+direction,d.stats.cars===12&&(d.s[0]-d.s.at(-1))*direction>0,d);
  }
  // 多列車只增加批次內頂點，沒有逐車燈源、影子或逐車 draw call。
  await p.evaluate(()=>{haloVehicles=Array.from({length:24},(_,i)=>({...haloTrain,id:haloTrain.id+':stress:'+i}));updateHaloTest();});
  await p.waitForFunction(()=>{updateHaloTest();return railIslandIntegration.renderer.stats.trainHalo.trains===24;},null,{timeout:90000});
  const perf=await p.evaluate(async()=>{const times=[];for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);M.raw.triggerRepaint();times.push(railIslandIntegration.renderer.stats.trainHalo.buildMs);}times.sort((a,b)=>a-b);return {p50:times[30],p95:times[57],stats:railIslandIntegration.renderer.stats.trainHalo,meshes:[...haloMeshes].filter(m=>m.visible).length,memory:railIslandIntegration.renderer.getRenderMemory()};});
  check(engine+' 24列288車廂批次',perf.stats.cars===288&&perf.stats.clouds===576&&perf.meshes<=2&&perf.p95<20,perf);
  await p.evaluate(()=>{haloVehicles=[haloTrain];updateHaloTest();});
  // 遠景五個畫法都接同一开關；取圓點之外的像素，排除原本牌底／小外圈。
  const fallback=await p.evaluate(()=>{
   const old=ctx,scratch=document.createElement('canvas');scratch.width=scratch.height=100;ctx=scratch.getContext('2d');const p={x:50,y:50},result=[];
   const helpers=[()=>drawTag(p,'168','#C0392B','#fff'),()=>drawDot(p,'#2E6FB0'),()=>drawHSRTag(p,'140'),()=>drawHSRDot(p),()=>drawTymcKindTag(p,'com','#8242b4','#fff')];
   try{for(const helper of helpers){const pixels=[];for(const on of [true,false]){trainHaloEnabled=on;ctx.clearRect(0,0,100,100);helper();const data=ctx.getImageData(0,0,100,100).data;let sum=0;for(let y=20;y<80;y++)for(let x=20;x<80;x++)if(Math.hypot(x-50,y-50)>22)sum+=data[(y*100+x)*4+3];pixels.push(sum);}result.push(pixels);}}finally{ctx=old;trainHaloEnabled=true;syncTrainHaloUI();}return result;
  });
  check(engine+' 遠景全部車牌與圓點開關',fallback.every(([on,off])=>on>off+50),fallback);
  for(const width of [360,375,390,414,520,768]){
   await p.setViewportSize({width,height:900});
   for(const full of [false,true]){
    await p.evaluate(full=>{document.body.classList.toggle('fs',full);M.resize();},full);
    await p.locator('#tabMore').tap();await p.locator('#trainHaloRow').scrollIntoViewIfNeeded();const before=await p.evaluate(()=>trainHaloEnabled);await p.tap('#trainHaloRow');
    const d=await p.evaluate(()=>{const e=document.getElementById('trainHaloRow'),r=e.getBoundingClientRect(),overlaps=[];
     for(const other of document.querySelectorAll('button,input,select,a[href],[role="button"],[role="switch"]')){if(other===e||e.contains(other)||other.contains(e))continue;const s=other.getBoundingClientRect();if(s.width===0||s.height===0)continue;
      const x=(Math.max(r.left,s.left)+Math.min(r.right,s.right))/2,y=(Math.max(r.top,s.top)+Math.min(r.bottom,s.bottom))/2;
      if(Math.min(r.right,s.right)-Math.max(r.left,s.left)>1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1&&other.contains(document.elementFromPoint(x,y)))overlaps.push(other.id||other.textContent.slice(0,20));}
     return {enabled:trainHaloEnabled,checked:e.getAttribute('aria-checked'),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1,overlaps};});
    check(engine+' 手機 '+width+' 全畫面 '+full,d.enabled!==before&&d.checked===String(d.enabled)&&d.hit&&d.height>=44&&!d.overflow&&!d.overlaps.length,d);
    if(width===375&&full)await p.screenshot({path:`${out}/${engine}-mobile-switch.png`});await p.tap('#moreClose');
   }
  }
  await p.evaluate(()=>{trainHaloEnabled=true;document.getElementById('trainHaloRow').click();railIslandIntegration.render=realRender;state._setAppearance('dark');});
  await p.waitForFunction(()=>railIslandIntegration?.renderer&&state.mapDark&&!railIslandIntegration.loading);
  check(engine+' 換底圖保留關閉',await p.evaluate(()=>!trainHaloEnabled&&document.getElementById('trainHaloRow').getAttribute('aria-checked')==='false'&&railIslandIntegration.capture().display.trainHalo===false));
  await p.reload();await p.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&window.railIslandIntegration?.renderer,null,{timeout:120000});
  check(engine+' 重開頁面保留關閉',await p.evaluate(()=>!trainHaloEnabled&&localStorage.getItem('trainmap-train-halo')==='0'&&document.getElementById('trainHaloRow').getAttribute('aria-checked')==='false'));
  check(engine+' 無執行例外',errors.length===0,errors);
 }catch(e){check(engine+' 執行',false,e.stack);}finally{await browser.close();}
}
fs.writeFileSync(`${out}/verification-${process.env.ENGINE||'all'}.json`,JSON.stringify(rows,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.VURL||'http://127.0.0.1:5207/',results=[];
for(const[name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:375,height:900},locale:'zh-TW',isMobile:true,hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.stack));await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 try{
  await page.goto(base+'?scene=3d&z=19&g=all&train=117&t=12:00&lang=zh-TW');await page.waitForFunction(()=>window.railIslandIntegration?.renderer&&state.followTrain,null,{timeout:60000});
  results.push({name:name+' 近景深連結',pass:await page.evaluate(()=>M.getZoom()===19&&!state.followHeadingUp)});
  for(let i=0;i<16;i++){await page.evaluate(i=>{state._setAppearance(i%2?'light':'dark');M.raw.setZoom(i%3===0?16:15);},i);await page.waitForTimeout(250);}
  await page.waitForFunction(()=>!railIslandIntegration.loading&&railIslandIntegration.renderer?.stats.models>0);
  const lifecycle=await page.evaluate(()=>({errors:railIslandIntegration.errors,model:railIslandIntegration.renderer.stats.models}));
  results.push({name:name+' 快速切換亮暗仍恢復模型',pass:!errors.length&&!lifecycle.errors.length&&lifecycle.model>0,errors:[...errors,...lifecycle.errors]});
  for(const kind of ['sched','metro']){
   const id=await page.evaluate(kind=>{clearFollow();clearFreqFollow();state.playing=false;railIslandIntegration.setModelMode('all');let p,match;
    if(kind==='sched'){setSimSec(12*3600);const tr=state.trains.find(t=>t.train==='117');p=trainPos(tr,state.simSec);match=v=>v.publicLabel==='117'&&v.systemId==='tra_sched';}
    else{const ln=state.decoLines.find(l=>l._sys==='tymc'&&l._tt?.length);let tr;for(const candidate of ln._tt){for(let i=1;i<candidate.length-2;i+=2){const sec=(candidate[i]+candidate[i+2])/2,q=freqTrainPosAt(ln,candidate,sec);if(q){tr=candidate;p=q;setSimSec(sec);break;}}if(tr)break;}match=v=>v.systemId==='tymc'&&Math.abs(v.latitude-p.lat)<1e-8&&Math.abs(v.longitude-p.lon)<1e-8;}
    M.setView([p.lat,p.lon],18,{animate:false});M.setPitch(45);return railIslandIntegration.capture().vehicles.find(match).id;
   },kind);
   await page.waitForFunction(id=>railIslandIntegration.renderer?.hasModel(id),id);await page.waitForTimeout(500);
   const pt=await page.evaluate(id=>{const renderer=railIslandIntegration.renderer,r=M.getContainer().getBoundingClientRect();for(const car of renderer.projectedCars().filter(c=>c.id===id)){const p=car.roof,x=p.x+r.left,y=p.y+r.top,hits=renderer.hitTest(p),el=document.elementFromPoint(x,y);if(x>30&&x<innerWidth-30&&y>60&&y<innerHeight-90&&el?.closest('#map')&&hits.length===1&&hits[0].id===id)return{x,y};}return null;},id);
   if(!pt)throw Error(kind+' 沒有可觸控模型樣本');await page.tap('body',{position:pt});await page.waitForTimeout(500);
   const selected=await page.evaluate(()=>railIslandIntegration.capture().selectedVehicleId);results.push({name:name+' '+kind+' 實際點車體沿用跟車',pass:selected===id,selected});
  }
 }catch(e){results.push({name:name+' lifecycle',pass:false,error:e.stack});}finally{await browser.close();}
}
fs.mkdirSync('output/3d-integration',{recursive:true});fs.writeFileSync('output/3d-integration/lifecycle-results.json',JSON.stringify(results,null,2));for(const r of results)console.log(r.pass?'PASS':'FAIL',JSON.stringify(r));if(results.some(r=>!r.pass))process.exitCode=1;

// 正式 renderer 驗收：六款共用模型在場景中發光，中間車不共用端燈材質。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.GARAGE_URL||'http://127.0.0.1:5287/',out=process.env.GARAGE_LIGHT_OUT||'output/fleet-lighting';mkdirSync(out,{recursive:true});
const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 const b=await type.launch();try{
 const p=await b.newPage({viewport:{width:960,height:540}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/__fleet_lights',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><canvas style="width:960px;height:540px"></canvas>'}));await p.goto(new URL('/__fleet_lights',base).href);
 const rows=await p.evaluate(async()=>{
 const T=await import('/rail-3d/vendor/three.module.js');let frame;const previous=T.Scene.prototype.onAfterRender;T.Scene.prototype.onAfterRender=function(r,s,c){frame={r,s,c};previous.call(this,r,s,c);};
 const {createRenderer}=await import('/rail-3d/garage-renderer.js'),r=createRenderer(),canvas=document.querySelector('canvas'),rows=[];
 try{for(const id of ['emu3000','dr1000','dl38','blue']){await r.load(id,'track');for(const mode of ['track','loop'])for(const direction of [1,-1])for(const period of ['day','night']){
 r.draw(canvas,{id,owned:true},-1.1,{mode,period,direction,elevation:.35,distance:7});
 const lights=[];frame.s.traverseVisible(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData.railLightingRole&&m.emissiveIntensity>0)lights.push(m.userData.railLightingRole);});
 const day=period==='day';rows.push({id,mode,direction,period,lights,pass:day?lights.length===0:lights.includes('window')&&lights.some(x=>x.startsWith('head'))});
 }}return rows;}finally{r.dispose();T.Scene.prototype.onAfterRender=previous;}
 });
 results.push(...rows.map(r=>({engine,...r})),{engine,pass:!errors.length,errors});console.log(engine,rows.length,'項',rows.filter(r=>!r.pass));
 }finally{await b.close();}
}
writeFileSync(out+'/verification.json',JSON.stringify(results,null,2));console.log(results.filter(r=>r.pass).length+'/'+results.length+' 通過');if(results.some(r=>!r.pass))process.exitCode=1;

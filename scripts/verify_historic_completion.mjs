// 驗泰安的真實模型世界座標與地形切換，並逐一留下本輪補件的地圖畫面。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5242/',out='output/historic-completion';fs.mkdirSync(out,{recursive:true});const rows=[];
const catalog=JSON.parse(fs.readFileSync('rail-3d/assets/historic-buildings-v2/catalog.json'));
const changed=catalog.map(c=>JSON.parse(fs.readFileSync('rail-3d/assets/historic-buildings-v2/'+c.metadata))).filter(m=>m.completionReview);
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
 const b=await type.launch({headless:process.env.HEADED!=='1'}),p=await b.newPage({viewport:{width:1280,height:900},locale:'zh-TW'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark')});
 try{
  await p.goto(base+'?scene=3d&g=all&lang=zh-TW');await p.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer&&!railIslandIntegration.loading,null,{timeout:60000});
  await p.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();setMap3d(true)});
  for(const meta of process.env.TERRAIN_ONLY?[]:changed){
   await p.evaluate(anchor=>railIslandIntegration.renderer.map.jumpTo({center:anchor,zoom:18,pitch:50,bearing:0}),meta.anchor);
   await p.waitForFunction(id=>railIslandIntegration.renderer.getStations().entries.some(e=>e.id===id&&e.ready&&e.visible&&e.lod==='near'),meta.id,{timeout:45000});
   const result=await p.evaluate(id=>{const layer=railIslandIntegration.renderer.getStations(),m=layer.getModel(id),parts=new Set();m.traverse(o=>{if(o.isMesh&&o.visible&&o.material.opacity>0)parts.add(o.userData.component)});return {parts:[...parts],failures:layer.failures}},meta.id);
   assert.deepEqual(result.parts.sort(),meta.calibration.parts.map(p=>p.id).sort());assert.equal(result.failures.length,0);
   await p.screenshot({path:`${out}/${engine}-${meta.id}-map.png`});rows.push({engine,id:meta.id,parts:result.parts.length,pass:true});console.log('PASS',engine,meta.id);
  }
  await p.evaluate(()=>railIslandIntegration.renderer.map.jumpTo({center:[120.7491,24.32265],zoom:18,pitch:58,bearing:0}));
  await p.waitForFunction(()=>railIslandIntegration.renderer.getStations().entries.some(e=>e.id==='taian-old'&&e.ready&&e.visible),null,{timeout:45000});
  for(const mode of ['flat','terrain','flat']){
   await p.evaluate(mode=>chooseBasemap(mode==='terrain'?'landscape':'dark'),mode);
   await p.waitForFunction(()=>window.railIslandIntegration?.renderer&&!railIslandIntegration.loading,null,{timeout:45000});
   await p.evaluate(()=>railIslandIntegration.renderer.map.jumpTo({center:[120.7491,24.32265],zoom:18,pitch:58,bearing:0}));
   if(mode==='terrain')await p.waitForFunction(()=>railIslandIntegration.renderer.map.queryTerrainElevation([120.74911150328163,24.32252234980541])>0,null,{timeout:45000});
   await p.waitForFunction(()=>{const r=railIslandIntegration.renderer,l=r.getStations();l.refresh();const m=l.getModel('taian-old'),meshes=[];m?.traverse(o=>{if(o.isMesh)meshes.push(o)});return m?.visible&&meshes.length&&meshes.every(o=>o.visible)},null,{timeout:45000});
   await p.evaluate(()=>railIslandIntegration.renderer.getStations().refresh());
   const z=await p.evaluate(()=>{const r=railIslandIntegration.renderer,m=r.getStations().getModel('taian-old'),parts={};m.updateMatrixWorld(true);m.traverse(o=>{if(!o.isMesh)return;const key=o.userData.component,part=parts[key]||(parts[key]={min:Infinity,max:-Infinity});const pos=o.geometry.attributes.position,range=o.geometry.drawRange;for(let i=range.start;i<range.start+range.count;i++){const v=m.position.clone().set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(o.matrixWorld);part.min=Math.min(part.min,v.z);part.max=Math.max(part.max,v.z)}});return {parts,ground:r.map.queryTerrainElevation([120.74911150328163,24.32252234980541])}});
   if(mode==='flat'){assert(Math.abs(z.parts['保存月台'].min)<.02);assert(z.parts['保存月台'].max>5&&z.parts['月台雨庇'].min>5);assert(z.parts['舊站房'].min<.2)}
   else {assert(z.ground>0);assert(Math.abs(z.parts['保存月台'].min-(z.ground-4.5))<.02)}
   assert(Math.abs(z.parts['月台雨庇'].min-z.parts['保存月台'].max)<.15,'棚柱底端必須接到月台面');
   rows.push({engine,mode,z,pass:true});await p.screenshot({path:`${out}/${engine}-taian-${mode}.png`});
  }
  assert.deepEqual(errors,[]);
 }catch(e){rows.push({engine,pass:false,error:e.stack,errors});console.error(e)}finally{await b.close()}
}
fs.writeFileSync(out+(process.env.TERRAIN_ONLY?'/terrain-results.json':'/completion-results.json'),JSON.stringify(rows,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;

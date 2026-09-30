// 真實地圖上的材質、手機操作與相機不變性；所有瀏覽器均無視窗執行。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {chromium,webkit} from 'playwright';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5234/',out='output/rail-bed-preview',rows=[];
fs.mkdirSync(out,{recursive:true});
function measurePixels(a,b){
  const p=PNG.sync.read(a),q=PNG.sync.read(b);assert.equal(p.width,q.width);assert.equal(p.height,q.height);
  let changed=0,total=0,difference=0;
  // 只量地圖中央，排除頁首的樣式按鈕與時鐘／工具列。
  for(let y=Math.ceil(p.height*.15);y<p.height*.8;y++)for(let x=Math.ceil(p.width*.1);x<p.width*.85;x++){
    const i=(y*p.width+x)*4,d=Math.abs(p.data[i]-q.data[i])+Math.abs(p.data[i+1]-q.data[i+1])+Math.abs(p.data[i+2]-q.data[i+2]);
    total++;if(d>3){changed++;difference+=d/3;}
  }
  return {changed,total,mean:changed?difference/changed:0};
}
const engines={chromium,webkit};
for(const [engine,type] of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:engines[process.env.ENGINE]}:engines)){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const context=await browser.newContext({viewport:{width:360,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'});
  await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');});
  const page=await context.newPage(),errors=[],shaderErrors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|VALIDATE_STATUS|WebGLProgram/i.test(m.text()))shaderErrors.push(m.text());});
  await page.goto(base+'rail-bed-preview.html');
  const frame=await (await page.locator('#map').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer?.stats.structures.bedStyle==='gravel'&&railIslandIntegration.renderer.stats.structures.beds>0,null,{timeout:90000});
  assert.equal(await page.locator('[data-style="quiet"]').count(),0);
  for(const width of [360,375,414,600,768,1280]){
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(150);
   for(const style of ['original','gravel']){
    // 以實際觸控操作選項，不使用 DOM click 捷徑。
    await page.tap('[data-style="'+style+'"]');
    await frame.waitForFunction(s=>railIslandIntegration.renderer.stats.structures.bedStyle===s,style);
   }
   const geometry=await page.evaluate(()=>{
    const controls=[...document.querySelectorAll('button,select')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.style||el.id,x:r.x,y:r.y,w:r.width,h:r.height,reachable:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
    const iframe=document.getElementById('map'),box=iframe.getBoundingClientRect(),w=iframe.contentWindow;
    const old=[...w.document.querySelectorAll('button,input,select,a,summary,[role=button]')].flatMap(el=>{const r=el.getBoundingClientRect(),s=w.getComputedStyle(el);if(!r.width||!r.height||s.visibility==='hidden'||Number(s.opacity)<.1)return [];const x=Math.max(0,r.left),y=Math.max(0,r.top),right=Math.min(box.width,r.right),bottom=Math.min(box.height,r.bottom);return right>x&&bottom>y?[{x:x+box.x,y:y+box.y,w:right-x,h:bottom-y,id:el.id||el.className}]:[];});
    const hit=(a,b)=>a.x<b.x+b.w-.5&&a.x+a.w>b.x+.5&&a.y<b.y+b.h-.5&&a.y+a.h>b.y+.5;
    const overlaps=[];for(let i=0;i<controls.length;i++){for(let j=i+1;j<controls.length;j++)if(hit(controls[i],controls[j]))overlaps.push([controls[i].id,controls[j].id]);for(const b of old)if(hit(controls[i],b))overlaps.push([controls[i].id,b.id]);}
    return {controls,existing:old.length,overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1,frameTop:box.top,headerBottom:document.querySelector('header').getBoundingClientRect().bottom};
   });
   assert.ok(!geometry.overflow);assert.equal(geometry.overlaps.length,0);assert.ok(geometry.controls.every(c=>c.reachable&&c.h>=43.9),JSON.stringify({engine,width,geometry}));assert.ok(geometry.existing>5);assert.ok(geometry.frameTop>=geometry.headerBottom-.5);
   rows.push({engine,width,pass:true,controls:geometry.controls.length,existing:geometry.existing});
   console.log('PASS',engine,width,'觸控／可及性／全部既有控件相交掃描');
  }
  // 與站場資料無關的獨立正向對照：同一個固定鏡頭，碎石確實增加近景像素細節。
  await page.setViewportSize({width:1280,height:900});
  await page.selectOption('#place','花蓮');await page.tap('#close');
  await frame.waitForFunction(()=>railIslandIntegration.renderer.stats.structures.detail===2&&M.raw.areTilesLoaded(),null,{timeout:60000});
  await page.waitForTimeout(750);
  await frame.waitForFunction(()=>railIslandIntegration.renderer.stats.models>0,null,{timeout:45000});
  const samples=[];
  for(const style of ['original','gravel']){
   await page.tap('[data-style="'+style+'"]');
   const before=await frame.evaluate(()=>railIslandIntegration.renderer.stats.frames);
   await frame.waitForFunction(n=>railIslandIntegration.renderer.stats.frames>n+2,before);
   samples.push({style,png:await page.screenshot({path:out+'/'+engine+'-close-'+style+'.png'}),info:await frame.evaluate(()=>{const r=railIslandIntegration.renderer;return {view:r.getView(),vertices:r.stats.structures.vertices,beds:r.stats.structures.beds,pose:r.stats.poseSamples.map(p=>({id:p.id,cars:p.cars.map(c=>({coordinate:c.coordinate,height:c.height}))})),errors:r.stats.errors,models:r.stats.models};})});
  }
  const change=measurePixels(samples[0].png,samples[1].png);
  assert.ok(change.changed>500,'碎石版必須真正改變地圖像素');
  for(const sample of samples.slice(1)){assert.deepEqual(sample.info.view,samples[0].info.view);assert.deepEqual(sample.info.pose,samples[0].info.pose);assert.equal(sample.info.vertices,samples[0].info.vertices);assert.equal(sample.info.beds,samples[0].info.beds);assert.equal(sample.info.errors.length,0);}
  // 在獨立固定光源的 WebGL 場景關閉顆粒作對照，不在產品留下另一款道床選項。
  const grain=await frame.evaluate(async()=>{
   const THREE=await import('./rail-3d/vendor/three.module.js'),{createRailStructures}=await import('./rail-3d/integration/rail-structures.js');
   const scene=new THREE.Scene(),bed=createRailStructures(scene),segments=[{a:[0,0,.65],b:[10,0,.65],groundA:0,groundB:0,bridge:false}];
   bed.set(segments,[],2);const mesh=scene.children[0],compile=mesh.material.onBeforeCompile;let shader;
   mesh.material.onBeforeCompile=(s,...args)=>{compile(s,...args);shader=s;};
   scene.add(new THREE.AmbientLight(0xffffff,2));const render=new THREE.WebGLRenderer({antialias:false});render.setSize(480,240);
   const camera=new THREE.OrthographicCamera(-5,5,2.5,-2.5,.1,20);camera.position.set(5,0,10);camera.lookAt(5,0,.3);
   const gl=render.getContext(),pixels=()=>{const p=new Uint8Array(480*240*4);gl.readPixels(0,0,480,240,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
   try{
    render.render(scene,camera);const textured=pixels(),nearAmount=shader.uniforms.railGravelAmount.value;
    shader.uniforms.railGravelAmount.value=0;render.render(scene,camera);const plain=pixels();let changed=0,total=0;
    for(let i=0;i<plain.length;i+=4){const d=Math.abs(plain[i]-textured[i])+Math.abs(plain[i+1]-textured[i+1])+Math.abs(plain[i+2]-textured[i+2]);if(d>3){changed++;total+=d/3;}}
    bed.set(segments,[],0);render.render(scene,camera);
    return {changed,mean:changed?total/changed:0,nearAmount,farAmount:shader.uniforms.railGravelAmount.value,defaultStyle:bed.stats.bedStyle};
   }finally{bed.destroy();render.dispose();render.forceContextLoss();}
  });
  assert.ok(grain.changed>100,'必須真正繪出碎石顆粒');assert.ok(grain.mean<30,'碎石保持低對比');assert.equal(grain.nearAmount,1);assert.equal(grain.farAmount,0);assert.equal(grain.defaultStyle,'gravel');
  rows.push({engine,pass:true,test:'預設碎石／原版像素對照／相機與列車定位不變／幾何頂點數相同／顆粒獨立像素驗證',grain,change,models:samples[0].info.models,vertices:samples[0].info.vertices});
  assert.equal(errors.length,0);assert.equal(shaderErrors.length,0);
  await context.close();
 }finally{await browser.close();}
}
fs.writeFileSync(out+'/verification.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.filter(r=>r.test),null,2));

import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.GARAGE_BASE_URL||'http://127.0.0.1:5251';
const out='output/fleet-refinement-20260912';fs.mkdirSync(out,{recursive:true});
const results=[];const check=(name,pass,detail)=>{results.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));};
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 try{
  for(const [scene,id,apiName] of [['viaduct','emu3000','viaductPreview'],['shifen','dr1000','shifenPreview'],['alishan','dl38','alishanPreview'],['south-coast','blue','southCoastPreview']]){
   const page=await browser.newPage({viewport:{width:1280,height:900},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/prototypes/garage-${scene}/`);
   // 藍皮 API 在原型中名為 southCoastPreview，從頁面定義核對。
   await page.waitForFunction(name=>window[name]?.state.ready,apiName,{timeout:90000});
   await page.tap('[data-period="night"]');await page.tap('[data-view="train"]');
   const live=await page.evaluate(name=>window[name].state,apiName);
   check(`${engine} ${id} 夜景角色已啟用`,live.lighting.windows>0&&live.lighting.heads>0,live.lighting);
   const t0=live.time;await page.waitForTimeout(250);
   const later=await page.evaluate(name=>window[name].state,apiName);
   check(`${engine} ${id} 夜景仍在行駛`,later.time>t0,{before:t0,after:later.time});
   await page.screenshot({path:`${out}/${engine}-${id}-night.png`});
   for(const width of [360,375,414,768]){
    await page.setViewportSize({width,height:900});await page.tap('[data-period="day"]');await page.tap('[data-period="night"]');
    const hit=await page.evaluate(()=>{const controls=[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&!e.disabled);const bad=controls.filter(e=>{const r=e.getBoundingClientRect();return !e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});return{bad:bad.map(e=>e.id||e.textContent),overflow:document.documentElement.scrollWidth>innerWidth};});
    check(`${engine} ${id} ${width} 觸控`,!hit.bad.length&&!hit.overflow,hit);
   }
   const probe=await page.evaluate(async id=>{
    const T=await import('/rail-3d/vendor/three.module.js'),M=await import('/rail-3d/garage-model.js');
    const primary=await M.loadGarageModel(id),train=await M.createConsist(id,primary,undefined,{locoAtTail:id==='dl38'});
    const rows=[];
    for(const direction of [1,-1])for(const period of ['day','sunrise','sunset','night']){
     train.lighting.update(period,direction);rows.push({...train.lighting.state});
    }
    // 同車型三節共用 geometry，但發光材質必須獨立；中間車不點頭燈。
    train.lighting.update('night',1);
    const middle=train.cars[1].body.material.filter(m=>m.userData.railLightingRole?.startsWith('head')).map(m=>m.emissiveIntensity);
    const shared=train.cars.some((a,i)=>train.cars.some((b,j)=>j>i&&a.body.material.some(m=>m.userData.railLightingRole&&b.body.material.includes(m))));
    // 黑暗隔離渲染：只有發光表面能產生亮像素，排除場景環境光造成假陽性。
    const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true,antialias:true});renderer.setSize(640,300);renderer.outputColorSpace=T.SRGBColorSpace;
    const scene=new T.Scene();scene.background=new T.Color('black');scene.add(train.root);train.straight(-1);
    const camera=new T.OrthographicCamera(-train.length*.6,train.length*.6,train.length*.6*300/640,-train.length*.6*300/640,.1,200);camera.up.set(0,0,1);camera.position.set(12,-40,15);camera.lookAt(0,0,1);camera.updateMatrixWorld();
    const pixels=[];for(const period of ['day','night']){train.lighting.update(period,1);renderer.render(scene,camera);const gl=renderer.getContext(),data=new Uint8Array(640*300*4);gl.readPixels(0,0,640,300,gl.RGBA,gl.UNSIGNED_BYTE,data);let bright=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>180)bright++;pixels.push(bright);}
    train.update(false);train.lighting.update('night',1,false);const locked=train.lighting.state;
    const disposed=[];for(const c of train.cars)for(const m of c.litMaterials)if(m.userData.railLightingRole)m.addEventListener('dispose',()=>disposed.push(m.uuid));
    const expected=new Set(train.cars.flatMap(c=>c.litMaterials.filter(m=>m.userData.railLightingRole).map(m=>m.uuid))).size;
    train.dispose();primary.dispose();renderer.dispose();
    return{rows,middle,shared,pixels,locked,disposeCount:new Set(disposed).size,expected};
   },id);
   check(`${engine} ${id} 四時段正反向`,probe.rows.every(r=>r.period==='day'?r.heads===0&&r.windows===0:r.windows>0&&(r.direction===1||id!=='blue'?r.heads>0:true)),probe.rows);
   check(`${engine} ${id} 光從模型表面出現`,probe.pixels[0]===0&&probe.pixels[1]>50,probe.pixels);
   check(`${engine} ${id} 各車燈光隔離`,!probe.shared&&probe.middle.every(x=>x===0),{shared:probe.shared,middle:probe.middle});
   check(`${engine} ${id} 未解鎖不發光`,probe.locked.windows===0&&probe.locked.heads===0,probe.locked);
   check(`${engine} ${id} 發光材質釋放`,probe.disposeCount===probe.expected,probe.disposeCount);
   check(`${engine} ${id} 無程式錯誤`,errors.length===0,errors);
   await page.close();
  }
 }finally{await browser.close();}
}
fs.writeFileSync(`${out}/lighting-verification.json`,JSON.stringify(results,null,2));
const fails=results.filter(r=>!r.pass);console.log(`共 ${results.length} 項，失敗 ${fails.length}`);if(fails.length)process.exitCode=1;

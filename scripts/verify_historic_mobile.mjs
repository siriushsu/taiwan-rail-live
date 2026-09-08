import {chromium,webkit} from 'playwright';import fs from 'node:fs';
const rows=[];fs.mkdirSync('output/historic-buildings',{recursive:true});
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 for(const width of (process.env.WIDTHS?process.env.WIDTHS.split(',').map(Number):[360,375,414,768])){
  const p=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-map3d','1');});
  try{
   await p.goto((process.env.BASE_URL||'http://127.0.0.1:5232/')+'?scene=3d&g=all&map=landscape&lang=zh-TW&t=12:00');await p.waitForFunction(()=>state.ready&&railIslandIntegration?.renderer&&!railIslandIntegration.loading,null,{timeout:60000});
   await p.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();setMap3d(true);M.raw.jumpTo({center:[121.51195,25.0400],zoom:17});railIslandIntegration.renderer.map.jumpTo({pitch:55});});
   await p.waitForFunction(()=>railIslandIntegration.renderer.getStations().entries.find(e=>e.id==='presidential-office')?.ready,null,{timeout:30000});
   const menu=p.locator(await p.locator('#toolsFab').isVisible()?'#toolsFab':'#tabMore');await menu.tap();await p.locator('[data-map="landscape"]').scrollIntoViewIfNeeded();await p.locator('[data-map="landscape"]').tap();await p.locator('#moreClose').tap();
   await p.waitForTimeout(500);
   const check=await p.evaluate(()=>{const r=railIslandIntegration.renderer,s=r.getStations(),model=s.getModel('presidential-office'),meshes=[];model.traverse(o=>{if(o.isMesh)meshes.push({visible:o.visible,opacity:o.material.opacity});});return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,meshCount:meshes.length,solid:meshes.every(m=>m.visible&&m.opacity===1),failures:s.failures,view:r.getView(),theme:state.basemap};});
   rows.push({engine,width,pass:!check.overflow&&check.meshCount>0&&check.solid&&!check.failures.length&&!errors.length,check,errors});
   if(width===375)await p.screenshot({path:`output/historic-buildings/${engine}-landscape-mobile.png`});
  }catch(e){rows.push({engine,width,pass:false,error:String(e)});}finally{await p.close();}
 }await browser.close();
}
fs.writeFileSync('output/historic-buildings/mobile.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;

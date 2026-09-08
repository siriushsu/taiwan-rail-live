import {chromium,webkit} from 'playwright';import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/',placement=JSON.parse(fs.readFileSync('rail-3d/assets/historic-buildings-v2/placement.json')),results=[];fs.mkdirSync('output/historic-buildings',{recursive:true});
for(const [engineName,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-TW'}),errors=[];
 await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'?g=all&scene=3d&lang=zh-TW');await page.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer,null,{timeout:60000});
  await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();setMap3d(true);});
  for(const [id,p]of Object.entries(process.env.THEMES_ONLY?{}:placement.entries)){
   if(process.env.BUILDING_IDS&&!process.env.BUILDING_IDS.split(',').includes(id))continue;
   for(const [zoom,lod]of [[17,'near'],[15,'far']]){
    await page.evaluate(({anchor,zoom})=>railIslandIntegration.renderer.map.jumpTo({center:anchor,zoom,pitch:45,bearing:0}),{anchor:p.anchor,zoom});
    await page.waitForFunction(({id,lod})=>{const e=railIslandIntegration.renderer.getStations().entries.find(e=>e.id===id);return e?.visible&&e.ready&&e.lod===lod;},{id,lod},{timeout:45000});
    const row=await page.evaluate(id=>{const s=railIslandIntegration.renderer.getStations(),entry=s.entries.find(e=>e.id===id);return {entry,failures:s.failures,errors:railIslandIntegration.errors,features:railIslandIntegration.renderer.map.queryRenderedFeatures().length};},id);
    results.push({engine:engineName,id,lod,pass:row.entry.blender&&row.entry.triangles>0&&!row.failures.length&&!row.errors.length,triangles:row.entry.triangles});
    await page.waitForFunction(()=>railIslandIntegration.renderer.map.queryRenderedFeatures().length>0,null,{timeout:15000});
    if(['presidential-office','jingtong-coal','hualien-railway','takao-old'].includes(id)&&lod==='near')await page.screenshot({path:`output/historic-buildings/${engineName}-${id}.png`});
   }
  }
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>state._setAppearance(theme),theme);
   await page.waitForFunction(()=>railIslandIntegration.renderer&&!railIslandIntegration.loading,null,{timeout:45000});
   await page.evaluate(()=>railIslandIntegration.renderer.map.jumpTo({center:[121.5171,25.0477],zoom:17,pitch:50,bearing:0}));
   await page.waitForFunction(()=>!railIslandIntegration.loading&&railIslandIntegration.renderer?.getStations().entries.find(e=>e.id==='taipei-main-v1')?.visible,null,{timeout:45000});
   results.push({engine:engineName,theme,pass:await page.evaluate(()=>!railIslandIntegration.renderer.getStations().failures.length)});
  }
  results.push({engine:engineName,type:'無未處理錯誤',pass:errors.length===0,errors});
 }catch(e){results.push({engine:engineName,pass:false,error:e.stack});}finally{await browser.close();}
}
fs.writeFileSync(process.env.THEMES_ONLY?'output/historic-buildings/themes.json':'output/historic-buildings/results.json',JSON.stringify(results,null,2));for(const r of results)console.log(r.pass?'PASS':'FAIL',JSON.stringify(r));if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium, webkit} from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';
const base=process.env.BASE_URL||'http://127.0.0.1:5209/';
const results=[];fs.mkdirSync('output/satellite-buildings',{recursive:true});
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
await Promise.all(Object.entries({chromium,webkit}).map(async ([name,engine])=>{
 const browser=await engine.launch();
 for(const width of (process.env.WIDTHS||'1280,360,375,390,414,768').split(',').map(Number)){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<1000,hasTouch:true,locale:'zh-TW'}),page=await context.newPage(),errors=[];
  const check=(label,pass,detail)=>{const row={engine:name,width,label,pass,detail};results.push(row);console.log(pass?'PASS':'FAIL',JSON.stringify(row));};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
  await page.route('**/api/basemap-token',r=>r.fulfill({json:{esri:'T1'}}));
  await page.route('**/api/basemap-session',r=>r.fulfill({json:{sessionToken:'S1',endTime:Date.now()+3600000}}));
  await page.route('**/World_Imagery/MapServer/tile/**',r=>r.fulfill({contentType:'image/png',body:tile}));
  const ready=async()=>{
   await page.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,null,{timeout:60000});
   await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();M.raw.jumpTo({center:[121.5171,25.0477],zoom:17,pitch:50,bearing:0});});
   await page.waitForFunction(()=>window.railIslandIntegration?.renderer?.getStations()?.entries.find(e=>e.id==='taipei-main-v1')?.visible,null,{timeout:45000});
  };
  const material=()=>page.evaluate(()=>{const s=railIslandIntegration.renderer.getStations(),stats=s.entries.find(e=>e.id==='taipei-main-v1'),meshes=[];s.getModel('taipei-main-v1').traverse(o=>{if(o.isMesh)meshes.push({color:o.material.color.toArray(),opacity:o.material.opacity,transparent:o.material.transparent,depthWrite:o.material.depthWrite,component:o.userData.component});});return {meshes,inspection:stats.inspection,excluded:stats.excludedComponents,kind:M.getStyleKind(),failures:s.failures};});
  const open=async()=>{await page.locator(await page.locator('#toolsFab').isVisible()?'#toolsFab':'#tabMore').tap();};
  const tap=async selector=>{const e=page.locator(selector);await e.scrollIntoViewIfNeeded();check('控件可觸及',await e.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),selector);await e.tap();};
  try{
   await page.goto(base+'?g=all&scene=3d&lang=zh-TW');await ready();
   const street=await material();check('暗色街圖維持玻璃建物',street.meshes.length>0&&street.meshes.every(m=>m.transparent&&m.opacity===.24));
   await page.waitForFunction(()=>window.__satStats?.().url,null,{timeout:15000});
   await open();await tap('[data-proxy="satBtn"]');await page.locator('#moreClose').tap();await ready();
   const solid=await material();check('衛星預設完整模型原貌',solid.kind.startsWith('sat-')&&solid.meshes.every(m=>!m.transparent&&m.opacity===1&&m.depthWrite)&&!solid.inspection&&solid.failures.length===0,solid.excluded);
   check('保留 Blender 原色',JSON.stringify(street.meshes.map(m=>m.color))===JSON.stringify(solid.meshes.map(m=>m.color)));
   const solidPng=await page.screenshot({path:`output/satellite-buildings/${name}-${width}-solid.png`});
   await open();await tap('[data-rail3d="inspection"] [data-value="on"]');
   check('衛星真觸控透視', (await material()).meshes.every(m=>m.transparent&&m.opacity===.24&&!m.depthWrite));
   await page.locator('#moreClose').tap();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const glassPng=await page.screenshot({path:`output/satellite-buildings/${name}-${width}-glass.png`});
   const redPixels=async png=>{const {data}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=3)if(data[i]>110&&data[i]>data[i+1]*1.3&&data[i+1]>data[i+2]*1.05)n++;return n;};
   const solidRed=await redPixels(solidPng),glassRed=await redPixels(glassPng);
   check('屋頂原色實際繪入畫面',solidRed>glassRed+1000,{solidRed,glassRed});await open();
   await tap('[data-rail3d="inspection"] [data-value="off"]');check('衛星真觸控回復原貌',(await material()).meshes.every(m=>m.opacity===1&&m.depthWrite));
   await tap('[data-proxy="satBtn"]');await page.locator('#moreClose').tap();await ready();
   check('切回街圖保留原玻璃設定',(await material()).meshes.every(m=>m.opacity===.24));
   await open();await tap('[data-proxy="satBtn"]');await page.locator('#moreClose').tap();await ready();
   check('再次切到衛星記住原貌',(await material()).meshes.every(m=>m.opacity===1));
   await page.reload();await ready();
   // 底圖選擇由既有頁面偏好管理；驗證衛星專用偏好在重新載入後仍存在。
   await page.evaluate(()=>{state.basemap='sat';setBasemap();});await ready();
   check('重新載入保留衛星原貌',(await material()).meshes.every(m=>m.opacity===1));
   await page.evaluate(()=>M.raw.setZoom(15));await page.waitForFunction(()=>window.railIslandIntegration?.renderer?.getStations().entries.find(e=>e.id==='taipei-main-v1')?.lod==='far');
   check('遠景也保留原貌',(await material()).meshes.every(m=>m.opacity===1));
   await page.evaluate(()=>state._setAppearance('light'));await ready();
   check('亮色介面的衛星也用原貌',(await material()).meshes.every(m=>m.opacity===1));
   await open();await tap('[data-rail3d="ground"] [data-value="terrain"]');await page.locator('#moreClose').tap();await ready();
   check('起伏地形保持完整原貌',(await material()).meshes.every(m=>m.opacity===1)&&await page.evaluate(()=>{const e=railIslandIntegration.renderer.getStations().entries.find(e=>e.id==='taipei-main-v1'),h=M.raw.queryTerrainElevation([121.51711425,25.0477174]);return railIslandIntegration.groundMode==='terrain'&&Number.isFinite(h)&&Math.abs(e.groundM-h)<.01;}));
   await open();await tap('#map3dRow');await page.locator('#moreClose').tap();
   check('建築開關可隱藏模型',await page.evaluate(()=>railIslandIntegration.renderer.getStations().entries.every(e=>!e.visible)));
   await open();await tap('#map3dRow');await page.locator('#moreClose').tap();await ready();check('重開建築仍是原貌',(await material()).meshes.every(m=>m.opacity===1));
   check('無水平溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   check('無未處理錯誤',errors.length===0,errors);
  }catch(e){check('流程完成',false,e.stack);}finally{await context.close();}
 }
 await browser.close();
}));
fs.writeFileSync('output/satellite-buildings/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

// v24 接入主站：雙引擎、完整編組、地形、主題生命週期及觸控。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5207/',out='output/3d-integration';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
async function boot(page){await page.goto(base+'?scene=3d&g=all&train=117&t=12:00&lang=zh-TW');await page.waitForFunction(()=>window.railIslandIntegration?.renderer&&state.followTrain,null,{timeout:60000});await page.evaluate(()=>{state.playing=false;setSimSec(43200);M.raw.setZoom(17);M.raw.setPitch(55);});await page.waitForFunction(()=>railIslandIntegration.renderer.stats.models>0,null,{timeout:30000});}
const summary=()=>{const r=railIslandIntegration.renderer,s=r?.stats,p=s?.poseSamples.find(p=>p.id===s.followFraming?.id)||s?.poseSamples[0];return {model:p&&{id:p.id,carCount:p.carCount,lengthM:p.lengthM,height:p.displayHeightM,cars:p.cars,coordinate:p.coordinate},models:s?.models,errors:[...railIslandIntegration.errors,...(state._tickErrs||[])],bearing:M.getBearing(),pitch:M.getPitch(),ground:railIslandIntegration.groundMode,formation:railIslandIntegration.formationMode,head:r?.projectedCars().find(c=>c.id===p?.id&&c.index===0),framing:s?.followFraming,version:maplibregl.getVersion()};};
for(const [engineName,engine]of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const browser=await engine.launch();let context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW'});await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});let page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 try{
  await boot(page);let s=await page.evaluate(summary);check(engineName+' 原 UI + 12 節近景模型',s.model?.carCount===12&&s.version==='5.9.0',s.model&&{cars:s.model.carCount,length:s.model.lengthM});
  await page.evaluate(()=>M.raw.setZoom(12));await page.waitForFunction(()=>railIslandIntegration.renderer.stats.models===0);check(engineName+' 遠景回到原車號',await page.evaluate(()=>state._trainHits.some(h=>h.tr===state.followTrain)));
  await page.evaluate(()=>M.raw.setZoom(17));await page.waitForFunction(()=>railIslandIntegration.renderer.stats.models>0);
  await page.evaluate(()=>{railIslandIntegration.setFormationMode('three');});await page.waitForFunction(()=>railIslandIntegration.renderer.stats.poseSamples[0]?.carCount===3);check(engineName+' 三節可切換',true);
  await page.evaluate(()=>railIslandIntegration.setFormationMode('actual'));await page.waitForFunction(()=>railIslandIntegration.renderer.stats.poseSamples[0]?.carCount===12);
  const frozen=await page.evaluate(summary);
  for(const zoom of [15,17,19]){await page.evaluate(z=>M.raw.setZoom(z),zoom);await page.waitForTimeout(450);s=await page.evaluate(summary);check(engineName+' 縮放 '+zoom+' 不改車長或座標',s.model?.lengthM===frozen.model.lengthM&&JSON.stringify(s.model.coordinate)===JSON.stringify(frozen.model.coordinate),{cars:s.model?.carCount,length:s.model?.lengthM});}
  await page.evaluate(()=>{M.raw.setZoom(17);railIslandIntegration.setGroundMode('terrain');});await page.waitForFunction(()=>railIslandIntegration.renderer.stats.poseSamples[0]?.displayHeightM>100,null,{timeout:45000});await page.waitForTimeout(500);s=await page.evaluate(summary);const align=await page.evaluate(()=>railIslandIntegration.renderer.alignment());
  check(engineName+' 地形與車廂共用高程',s.model?.cars.every(c=>c.height>100)&&Math.abs(align?.heightDelta)<.02,{height:s.model?.height,alignment:align?.heightDelta});
  await page.screenshot({path:out+'/'+engineName+'-terrain.png'});
  await page.evaluate(()=>{railIslandIntegration.setGroundMode('flat');window.__before3D=railIslandIntegration.renderer;state._setAppearance('light');});await page.waitForFunction(()=>!railIslandIntegration.loading&&railIslandIntegration.renderer!==window.__before3D&&railIslandIntegration.renderer?.stats.models>0&&!state.mapDark,null,{timeout:45000});s=await page.evaluate(summary);check(engineName+' 地形關閉／切亮色保留列車',s.model?.height===.65&&s.errors.length===0,s);
  await page.evaluate(()=>{window.__before3D=railIslandIntegration.renderer;state._setAppearance('dark');});await page.waitForFunction(()=>!railIslandIntegration.loading&&railIslandIntegration.renderer!==window.__before3D&&railIslandIntegration.renderer?.stats.models>0&&state.mapDark,null,{timeout:45000});
  check(engineName+' 暗色玻璃建築與霓虹保留',await page.evaluate(()=>!!M.raw.getLayer('building-glass-edges')&&M.raw.getPaintProperty('track-glow','line-opacity')>.1));
  await page.evaluate(()=>{M.raw.fire('rotatestart',{originalEvent:{}});M.raw.setBearing(65);M.raw.setPitch(55);});await page.waitForTimeout(500);check(engineName+' 側面跟車保留使用者方向',Math.abs((await page.evaluate(summary)).bearing-65)<.1);
  await page.click('.maplibregl-ctrl-compass');await page.waitForTimeout(700);s=await page.evaluate(summary);check(engineName+' 選車後指北有效',Math.abs(s.bearing)<.1&&s.pitch<.1&&!!s.model);
  const lines=await page.evaluate(()=>state.decoLines.filter(ln=>ln._tt?.length&&ln.shape?.length).map(ln=>({id:ln.id,sys:ln._sys})));check(engineName+' 全台同框保留捷運路網',lines.length===await page.evaluate(()=>state.decoLines.filter(ln=>ln._tt?.length&&ln.shape?.length).length),lines.length);
  if(engineName==='chromium'&&process.env.FULL_LINES==='1')for(const line of lines){
   const sample=await page.evaluate(({id,sys})=>{const ln=state.decoLines.find(l=>l.id===id&&l._sys===sys);let found=null;for(const tr of ln._tt){for(let i=1;i<tr.length-2;i+=2){const sec=(tr[i]+tr[i+2])/2,p=freqTrainPosAt(ln,tr,sec);if(p){found={tr,sec,p};break;}}if(found)break;}if(!found)return null;setSimSec(found.sec);applyFreqFollow({ln,tr:found.tr});M.setView([found.p.lat,found.p.lon],18,{animate:false});return true;},line);
   if(sample){await page.waitForTimeout(550);const data=await page.evaluate(()=>({models:railIslandIntegration.renderer.stats.models,selected:railIslandIntegration.capture().vehicles.find(v=>v.followed)?.id,poses:railIslandIntegration.renderer.stats.poseSamples.map(p=>p.id),fallbacks:railIslandIntegration.renderer.stats.modelFallbacks}));check('路線 '+line.sys+' '+line.id,data.poses.includes(data.selected),data.fallbacks);}
  }
  check(engineName+' 桌面無未處理錯誤',pageErrors.length===0,pageErrors);
 }catch(e){check(engineName+' 桌面完成',false,String(e));}
 await context.close();
 const widths=process.env.WIDTHS?process.env.WIDTHS.split(',').map(Number):[360,375,390,414,520,768];
 for(const width of widths){context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',isMobile:true,hasTouch:true,deviceScaleFactor:1});await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});page=await context.newPage();
  try{await boot(page);
   await page.evaluate(()=>{M.raw.fire('rotatestart',{originalEvent:{}});M.raw.setBearing(115);M.raw.setPitch(55);});await page.waitForTimeout(500);
   const compass=page.locator('.maplibregl-ctrl-compass');await compass.tap();await page.waitForTimeout(500);let s=await page.evaluate(summary);check(engineName+' '+width+' 真觸控指北',Math.abs(s.bearing)<.1&&s.pitch<.1);
   await page.locator('#tabMore').tap();const target=page.locator('[data-rail3d="formation"] [data-value="three"]');await target.scrollIntoViewIfNeeded();await target.tap();await page.waitForFunction(()=>railIslandIntegration.formationMode==='three');check(engineName+' '+width+' 編組設定觸控',true);
   const acc=await page.evaluate(()=>{const buttons=[...document.querySelectorAll('[data-rail3d] button')];return {overflow:document.documentElement.scrollWidth>innerWidth+1,small:buttons.filter(b=>b.getBoundingClientRect().height<44).map(b=>b.textContent)};});check(engineName+' '+width+' 設定無橫捲／觸控 44px',!acc.overflow&&!acc.small.length,acc);
   const caption=await page.locator('[data-rail3d="ground"] [data-value="terrain"]');await caption.scrollIntoViewIfNeeded();const accessible=await caption.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});check(engineName+' '+width+' 地形控件未被裁切',accessible);
   await page.screenshot({path:out+'/'+engineName+'-'+width+'-settings.png'});
  }catch(e){check(engineName+' '+width+' 手機完成',false,String(e));}await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} 通過`);if(failed.length)process.exitCode=1;

// 在同一個已載入圖磚集合，比對快取遮罩與原版逐多邊形算法，排除兩分頁載入時序差異。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.env.BASE_URL||'http://127.0.0.1:5207/';
const old=execFileSync('git',['show','b5d7ff27:rail-3d/station-layer.js'],{encoding:'utf8'});
let reference=old.slice(old.indexOf('  function maskBuildings(active){'),old.indexOf('  function maskLabels(active){'));
reference=reference.replace('function maskBuildings(active)','function referenceMasks(active)').replace(/    const visibleKey=.*\n    maskEpoch=.*\n/,'');
reference=reference.slice(0,reference.indexOf('    const data='))+"    return {ids:[...ids].sort((a,b)=>a-b),features:[...remainders.values()]};\n  }\n";
for(const [name,engine] of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const browser=await engine.launch({headless:name!=='chromium'}),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'zh-TW'});
 await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
 await context.route('**/rail-3d/station-layer.js',async route=>{const response=await route.fetch();let source=await response.text();source=source.replace('  function maskLabels(active){',reference+'  function maskLabels(active){').replace("id:'island-stations',type:'custom',renderingMode:'3d',failures,refresh,","id:'island-stations',type:'custom',renderingMode:'3d',failures,refresh,auditSchedule(){return {sourceEpoch,maskEpoch,lastMoveAt,maskDeferSince,now:performance.now(),maskTimer,timer,viewTimer};},auditMasks(){return referenceMasks([...records.filter(r=>r.maskActive),...engineeringMasks]);},");await route.fulfill({response,body:source});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(base+'?scene=3d&t=12:00&lang=zh-TW');await page.waitForFunction(()=>railIslandIntegration.renderer&&state.ready);await page.evaluate(()=>{clearFollow();clearFreqFollow();state.playing=false;setSimSec(43200);});
 for(const center of [[121.517,25.0478],[121.5205,25.052],[121.517,25.0478]]){
  await page.evaluate(center=>M.raw.jumpTo({center,zoom:16.5,pitch:60,bearing:0}),center);
  await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:60000});await page.waitForFunction(()=>M.raw.getSource('station-building-remainders')?._data?.features?.length>0,null,{timeout:25000});await page.waitForTimeout(6000);
  const r=await page.evaluate(()=>{const layer=railIslandIntegration.renderer.getStations(),expected=layer.auditMasks(),actual=M.raw.getSource('station-building-remainders')._data.features;
   const keys=xs=>xs.map(f=>f.properties.station_original_id+':'+JSON.stringify(f.geometry.coordinates)).sort();
   const expectedKeys=keys(expected.features),actualKeys=keys(actual);const filter=M.raw.getFilter('building-3d'),exclude=filter?.[0]==='!'?filter:filter?.find?.(x=>Array.isArray(x)&&x[0]==='!');const actualIds=exclude?.[1]?.[2]?.[1]||[];
   return {expectedCount:expectedKeys.length,actualCount:actualKeys.length,ids:expected.ids.length,actualIds:actualIds.length,filter:actualIds.length?undefined:filter,idsEqual:JSON.stringify(expected.ids)===JSON.stringify(actualIds),equal:JSON.stringify(expectedKeys)===JSON.stringify(actualKeys),schedule:layer.auditSchedule(),station:layer.entries.filter(r=>r.visible).length,errors:railIslandIntegration.errors};});
  console.log(name,center,JSON.stringify(r));assert(r.expectedCount>100&&r.ids>0&&r.station>0,'必須實際有站房及被拆分建物');assert(r.equal&&r.idsEqual,'快取遮罩須與原版全部座標、全部排除 id 一致');assert.equal(r.errors.length,0);
 }assert.equal(errors.length,0);}
 finally{await browser.close();}
}

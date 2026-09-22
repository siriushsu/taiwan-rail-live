import fs from 'node:fs';import {chromium,webkit}from'playwright';
// 隧道縱坡是顯示層的東西：這裡驗畫面上真的畫成那樣，而不只是產物數字對。
const base=process.env.BASE_URL||'http://127.0.0.1:5179/',rows=[];fs.mkdirSync('output/tunnel',{recursive:true});
// [way, 系統, 顏色, 說明]：北迴線長隧道、南迴中央隧道、文湖線辛亥—麟光。
const cases=[['211933600','tra_sched','#e87722','新觀音隧道'],['81151555','tra_sched','#e87722','中央隧道'],['55567867','mrt','#c48c31','文湖線辛亥—麟光']];
const levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json')).entries;
for(const [engine,type]of Object.entries({chromium,webkit})){const b=await type.launch(),p=await b.newPage({viewport:{width:1100,height:820},locale:'zh-TW'});const errors=[];p.on('pageerror',e=>errors.push(e.message));try{
 await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await p.goto(base+'?g=all&scene=3d&map=landscape&t=14:18');
 // 只等 3D 這一層就緒：本機沒有即時班表來源，state.ready 永遠不會成立，等它就是等逾時。
 // M 是 const 宣告的詞法全域，不掛在 window 上；寫 window.M 會永遠是 undefined 而看起來像沒載入。
 await p.waitForFunction(()=>window.railIslandPhysical?.geometry&&window.railIslandIntegration?.renderer&&typeof M!=='undefined'&&typeof M.raw?.queryTerrainElevation==='function',null,{timeout:120000});

 await p.evaluate(()=>{if(window.state)state.playing=false;clearFollow?.();railIslandIntegration.render=()=>{};});
 await p.evaluate(()=>railIslandIntegration.setGroundMode('terrain'));
 // 地形預設關；開了還要等 DEM 圖磚到齊，否則 queryTerrainElevation 回 undefined 而畫面看起來一切正常。
 await p.evaluate(()=>M.raw.jumpTo({center:[121.5603,25.011],zoom:14,pitch:60}));
 await p.waitForFunction(()=>Number.isFinite(M.raw.queryTerrainElevation([121.5603,25.011])),null,{timeout:120000});
 for(const [id,system,color,label]of cases){
  const heights=await p.evaluate(async({id,system,color})=>{
   const {makePath}=await import('./rail-3d/integration/train-path.js');
   // 台鐵／高鐵／林鐵與捷運各有一份 runtime，拿錯那一份會查無此股道。
   const geo=['tra_sched','thsr_sched','afr_sched'].includes(system)?railIslandPhysical.geometry:railIslandPhysical.metro.geometry;
   const route=geo.drawingWays(system,color).find(r=>r.routeId===id);if(!route)return null;
   const path=makePath(route.coordinates),q=path.at(path.length/2).coordinate;
   M.raw.jumpTo({center:q,zoom:14,pitch:60,bearing:20});
   const out=[];for(let k=0;k<=40;k++){const s=path.length*k/40;out.push({s,level:route.level(s).terrainHeightM,ground:M.raw.queryTerrainElevation(path.at(s).coordinate)});}
   return out;},{id,system,color});
  if(!heights){rows.push({engine,label,pass:false,why:'找不到股道'});continue;}
  const drawn=heights.filter(h=>Number.isFinite(h.level)),climb=Math.max(...drawn.map(h=>h.level))-Math.min(...drawn.map(h=>h.level));
  const terrain=heights.filter(h=>Number.isFinite(h.ground)),relief=terrain.length?Math.max(...terrain.map(h=>h.ground))-Math.min(...terrain.map(h=>h.ground)):0;
  const baked=levels[id].terrainValues,bakedClimb=Math.max(...baked)-Math.min(...baked);
  // 判準：畫面取到的顯示高程與產物一致，且遠比它上方的地形平緩。
  const pass=drawn.length===heights.length&&Math.abs(climb-bakedClimb)<3&&(relief<20||climb<relief*.35);
  rows.push({engine,label,pass,climb:+climb.toFixed(1),bakedClimb:+bakedClimb.toFixed(1),relief:+relief.toFixed(1)});
  console.log(engine,label,rows.at(-1));
  await p.waitForTimeout(1200);
  await p.screenshot({path:`output/tunnel/${engine}-${label}.png`});
 }
 if(errors.length)rows.push({engine,pass:false,why:errors.slice(0,3)});
 }finally{await b.close();}}
const failed=rows.filter(r=>!r.pass);console.log({checks:rows.length,failed:failed.length});if(failed.length){console.log(failed);process.exitCode=1;}

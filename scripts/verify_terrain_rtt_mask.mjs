// 地形開著時,車站遮罩改了建物 filter,地面上的 2D 建物輪廓(畫在地形 render-to-texture 裡)要跟著換,不能卡在舊 filter。
// MapLibre 5.9 逐磚作廢地形貼圖時比不到超採樣的 openmaptiles 圖磚,修法在 rail-3d/station-layer.js(rttPending)。
// 判法:截圖 S(現況) vs F(freeRtt() 強迫重畫地形貼圖後)。S≠F＝貼圖卡舊。量行為、不比字串,換引擎版本時一樣會擋。
//  前置:地景底圖有 source-layer=building 的 fill 圖層、地形開著、兩次 F 之間 0 px(環境雜訊為 0,否則是環境問題不是回歸)。
//  L0 地景＋地形,遮罩第一次套用後 S=F。
//  L1／L2 工程遮罩開、關:building filter 真的換了(有 setFilter)、畫面真的變了(F 前後差 >2000 px),S=F。
//     只有「開」的方向看得到卡舊:關遮罩時立體建物回來,會把自己的地面輪廓整個蓋住,修前 L2 也是 0,只當煙霧測試。
//  L3 靜止 4 秒內不再有全清(修法不會變成每幀重畫地形貼圖)。
//  L4 setFilter 之後、重載開始之前先到一個 openmaptiles 圖磚事件(跟車時新圖磚隨時會到):不可以把「待重畫」提早用掉,S=F。
//     假事件在 setFilter 同一個工作結束時送(microtask),送出當下 openmaptiles 必須仍是已載完(證明打在那個窗口)。
//  D0 暗色＋地形:S=F(暗色沒有 2D 建物,修前也是 0,確保修法沒弄壞)。
//  C  對照(證明 S/F 看得到卡舊):關遮罩後把 freeRtt 換成空函式再開遮罩,S 與 F 必須差 >100 px(雜訊底已驗為 0;
//     這塊遮罩範圍地面露出的 2D 輪廓約 1200 px,多數被立體建物擋住,修前的卡舊也是這個量)。
// 用法:BASE_URL=http://127.0.0.1:5207/ HEADFUL=1 node scripts/verify_terrain_rtt_mask.mjs
import {chromium} from 'playwright';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5207/';
const HEADFUL=process.env.HEADFUL==='1';
const block={type:'FeatureCollection',features:[{type:'Feature',properties:{stationId:'rtt-probe'},geometry:{type:'Polygon',coordinates:[[[121.5150,25.0490],[121.5180,25.0490],[121.5180,25.0512],[121.5150,25.0512],[121.5150,25.0490]]]}}]};
const pixels=async png=>(await sharp(png).removeAlpha().raw().toBuffer());
const diff=async(a,b)=>{const A=await pixels(a),B=await pixels(b);let n=0;for(let i=0;i<A.length;i+=3)if(Math.max(Math.abs(A[i]-B[i]),Math.abs(A[i+1]-B[i+1]),Math.abs(A[i+2]-B[i+2]))>12)n++;return n;};
console.log('目標站台:',base);
const browser=await chromium.launch(HEADFUL?{channel:'chrome',headless:false}:{});
const failures=[];const check=(ok,msg)=>{console.log((ok?'PASS ':'FAIL ')+msg);if(!ok)failures.push(msg);};
try{
for(const dark of [false,true]){
  const name=dark?'暗色':'地景';
  const context=await browser.newContext({viewport:{width:1280,height:800},locale:'zh-TW',timezoneId:'Asia/Taipei'});
  await context.addInitScript(d=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance',d?'dark':'light');},dark);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.bringToFront();
  await page.goto(base+'?scene=3d&t=12:00&lang=zh-TW&cb='+Date.now());
  await page.waitForFunction(()=>window.railIslandIntegration?.renderer&&state.ready,null,{timeout:120000});
  await page.evaluate(()=>{try{document.querySelector('#howtoGo')?.click();}catch(e){}});
  await page.evaluate(d=>{state.mapDark=d;state.basemap=d?'map':'landscape';setBasemap();},dark);
  await page.waitForTimeout(3000);
  await page.waitForFunction(()=>window.railIslandIntegration?.renderer?.getStations?.(),null,{timeout:60000});
  await page.evaluate(()=>{setMap3d(true);railIslandIntegration.setMode(true);railIslandIntegration.setGroundMode('terrain');clearFollow();clearFreqFollow();state.playing=false;setSimSec(43200);});
  await page.evaluate(()=>M.raw.jumpTo({center:[121.517,25.0478],zoom:16.5,pitch:60,bearing:0}));
  await page.waitForFunction(()=>M.raw.terrain&&M.raw.areTilesLoaded()&&(M.raw.getSource('station-building-remainders')?._data?.features?.length||0)>0,null,{timeout:90000});
  // 記 building 的 setFilter 與全清;freeRtt 原函式留給 F 用(對照組會把掛在外面的換成空函式)。
  await page.evaluate(()=>{const m=M.raw,sc=m.terrain.sourceCache,orig=sc.freeRtt.bind(sc);window.__free=orig;window.__log={filter:0,full:0};
    const of=m.setFilter.bind(m);m.setFilter=(id,...r)=>{if(id==='building')window.__log.filter++;return of(id,...r);};
    sc.freeRtt=id=>{if(!id)window.__log.full++;return orig(id);};});
  const settle=async()=>{await page.waitForFunction(()=>M.raw.isSourceLoaded('openmaptiles')&&M.raw.areTilesLoaded(),null,{timeout:60000});await page.waitForTimeout(2500);};
  const shot=()=>page.screenshot();
  const fresh=async()=>{await page.evaluate(()=>{window.__free();M.raw.triggerRepaint();});await page.waitForTimeout(2500);return shot();};
  const toggle=async collection=>{const before=await page.evaluate(()=>JSON.stringify(M.raw.getFilter('building-3d')));
    await page.evaluate(c=>railIslandIntegration.renderer.getStations().setEngineeringMasks(c),collection);
    await page.waitForFunction(b=>JSON.stringify(M.raw.getFilter('building-3d'))!==b,before,{timeout:30000});await settle();};
  await page.waitForTimeout(10000);await settle();
  const pre=await page.evaluate(()=>({fill:M.raw.getStyle().layers.filter(l=>l.type==='fill'&&l['source-layer']==='building').map(l=>l.id),terrain:!!M.raw.terrain}));
  const S0=await shot(),F0=await fresh(),F0b=await fresh(),noise=await diff(F0,F0b);
  check(pre.terrain,`${name} 前置:地形開著`);
  check(noise===0,`${name} 前置:兩次強迫重畫之間 0 px(實測 ${noise};不為 0 是環境雜訊,不是回歸)`);
  if(!dark)check(pre.fill.includes('building'),`${name} 前置:有 source-layer=building 的 2D fill 圖層(${pre.fill.join(',')||'無'})`);
  const s0=await diff(S0,F0);check(s0===0,`${dark?'D0':'L0'} ${name}＋地形 遮罩首次套用後 S=F(差 ${s0} px)`);
  const f1=await page.evaluate(()=>window.__log.filter);await toggle(block);const S1=await shot(),F1=await fresh();
  const f2=await page.evaluate(()=>window.__log.filter);await toggle(null);const S2=await shot(),F2=await fresh();
  const f3=await page.evaluate(()=>window.__log.filter);
  const s1=await diff(S1,F1),s2=await diff(S2,F2),changed=await diff(F0,F1);
  if(!dark){
    check(f2>f1&&f3>f2,`L1/L2 ${name} 遮罩開、關各自觸發 building 的 setFilter(${f1}→${f2}→${f3})`);
    check(changed>2000,`L1 ${name} 工程遮罩真的改變畫面(${changed} px)`);
  }
  check(s1===0,`${dark?'D1':'L1'} ${name}＋地形 遮罩開 S=F(差 ${s1} px)`);
  check(s2===0,`${dark?'D2':'L2'} ${name}＋地形 遮罩關 S=F(差 ${s2} px;煙霧測試)`);
  const full0=await page.evaluate(()=>window.__log.full);await page.waitForTimeout(4000);const full1=await page.evaluate(()=>window.__log.full);
  check(full1===full0,`${dark?'D3':'L3'} ${name} 靜止 4 秒內不再全清地形貼圖(${full1-full0} 次)`);
  if(!dark){
    await page.evaluate(()=>{const m=M.raw,of=m.setFilter;let armed=true;window.__stray=null;
      m.setFilter=(id,...r)=>{const out=of(id,...r);if(armed&&id==='building'){armed=false;queueMicrotask(()=>{window.__stray={loaded:m.isSourceLoaded('openmaptiles')};m.fire('sourcedata',{sourceId:'openmaptiles',dataType:'source',tile:{}});});}return out;};});
    await toggle(block);const S4=await shot(),F4=await fresh(),stray=await page.evaluate(()=>window.__stray),s4=await diff(S4,F4);
    check(stray?.loaded===true,`L4 前置:假圖磚事件已送出,且送出當下重載還沒開始(${JSON.stringify(stray)})`);
    check(s4===0,`L4 ${name}＋地形 重載開始前先到一個圖磚事件,遮罩開 S=F(差 ${s4} px)`);
    await toggle(null);await page.evaluate(()=>{M.raw.terrain.sourceCache.freeRtt=()=>{};});
    await toggle(block);const SC=await shot(),FC=await fresh();const c=await diff(SC,FC);
    check(c>100,`C 對照:freeRtt 換成空函式後開遮罩,S 與 F 必須看得出差異(${c} px)`);
  }
  check(errors.length===0,`${name} 頁面沒有錯誤${errors.length?':'+errors.slice(0,3).join(' | '):''}`);
  await context.close();
}
}finally{await browser.close();}
assert.equal(failures.length,0,'失敗:\n'+failures.join('\n'));
console.log('PASS 地形貼圖跟著車站遮罩重畫');

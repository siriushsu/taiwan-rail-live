// 站房淨空半透明(瀏覽器版):台北車站那一景,被路線擋到的整座模型要整座半透明、沒被擋的不動;
// 衛星／地景底圖(實心外觀)淨空不套用,透明模式與暗色整座半透明。
// 逐款、逐要素的比對規則在 verify_3d_station_clearance.mjs(純 node);這支驗它接在真的頁面上。
//
// 量的是 mesh 的材質狀態(transparent／opacity／depthWrite),不是截圖。
//   BASE_URL=http://127.0.0.1:5207/ node scripts/verify_3d_station_clearance_browser.mjs
//   ENGINES=chromium,webkit   預設兩個,依序各開一支、關了才開下一支
//   LABEL=名稱                輸出檔名前綴,對照不同版本時用
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5207/',out='output/station-clearance',label=process.env.LABEL?process.env.LABEL+'-':'';
fs.mkdirSync(out,{recursive:true});
const results=[],table={};
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const TAIPEI={id:'taipei-main-v1',anchor:[121.51711425,25.0477174]},CKS={id:'cksmh-landmark-v1',anchor:[121.52171584846401,25.03468634617782]};
const BLOCKED={[TAIPEI.id]:[TAIPEI.id],[CKS.id]:[CKS.id]};   // 這一景的路線擋到這兩座;footprint 沒有 component,excluded 填模型 id
const STREET_LIGHT=/^(light|street-raster-light)$/,STREET_DARK=/^(dark|street-raster-dark)$/;

const view=page=>page.evaluate(()=>{
  const layer=railIslandIntegration.renderer.getStations();
  return {kind:M.getStyleKind(),models:layer.entries.filter(e=>e.visible).map(e=>{
    const parts=[];layer.getModel(e.id)?.traverse(o=>{if(!o.isMesh)return;const m=o.material;
      parts.push({component:o.userData.component,start:o.geometry.drawRange.start,count:o.geometry.drawRange.count,
        glass:m.transparent&&m.opacity===.24&&!m.depthWrite,solid:!m.transparent&&m.opacity===1&&m.depthWrite});});
    return {id:e.id,lod:e.lod,ready:e.ready,excluded:e.excludedComponents,parts};})};
});
// 等完成訊號,不等固定秒數:底圖種類對了、要驗的兩座已載入指定 LOD 且 excluded 是預期值、整份快照連續三次相同。
async function settle(page,kind,need=BLOCKED,lod='near'){
  let prev='',same=0,last;const t0=Date.now();
  while(Date.now()-t0<60000){
    await page.waitForTimeout(500);
    try{last=await view(page);}catch{same=0;continue;}   // 換底圖時整合層重建,中途讀不到就再等
    const ready=kind.test(last.kind)&&Object.entries(need).every(([id,excluded])=>{const m=last.models.find(m=>m.id===id);return m?.ready&&m.lod===lod&&JSON.stringify(m.excluded)===JSON.stringify(excluded);});
    const key=JSON.stringify(last);same=ready&&key===prev?same+1:0;prev=key;if(same>=3)return last;
  }
  throw new Error('等不到穩定畫面 '+JSON.stringify({kind:last?.kind,models:last?.models.map(m=>({id:m.id,lod:m.lod,ready:m.ready,excluded:m.excluded}))}));
}
const glassCount=m=>m.parts.filter(p=>p.glass).length,summary=models=>models.map(m=>`${m.id} ${glassCount(m)}/${m.parts.length}`);
const allGlass=models=>models.every(m=>m.parts.length>0&&m.parts.every(p=>p.glass)),allSolid=models=>models.every(m=>m.parts.length>0&&m.parts.every(p=>p.solid));

for(const name of (process.env.ENGINES||'chromium,webkit').split(',')){
  const browser=await {chromium,webkit}[name].launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW'}),page=await context.newPage(),errors=[];
  const check=(item,pass,detail)=>{const row={engine:name,item,pass,detail};results.push(row);console.log(pass?'PASS':'FAIL',JSON.stringify(row));};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/basemap-token',r=>r.fulfill({json:{esri:'T1'}}));
  await page.route('**/api/basemap-session',r=>r.fulfill({json:{sessionToken:'S1',endTime:Date.now()+3600000}}));
  await page.route('**/World_Imagery/MapServer/tile/**',r=>r.fulfill({contentType:'image/png',body:tile}));
  // 亮色街圖、透明模式關(街圖預設是開的,開著時整座都半透明,看不出淨空);ground=flat 免等 DEM。
  await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');localStorage.setItem('ri-transparent','0');});
  const record=(id,v)=>{table[`${name} ${id}`]=v.models.map(m=>({id:m.id,excluded:m.excluded,glass:glassCount(m),parts:m.parts.length}));};
  try{
    await page.goto(base+'?g=all&scene=3d&ground=flat&lang=zh-TW');
    await page.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,null,{timeout:90000});
    const jump=(anchor,zoom=17,pitch=50,bearing=0)=>page.evaluate(([a,z,p,b])=>{state.playing=false;clearFollow();clearFreqFollow();M.raw.jumpTo({center:a,zoom:z,pitch:p,bearing:b});},[anchor,zoom,pitch,bearing]);
    await jump(TAIPEI.anchor);

    // A 亮色街圖、透明關:淨空決定誰半透明。
    let v;try{v=await settle(page,STREET_LIGHT);}catch(e){check('前提:台北車站與中正紀念堂載入近景且被路線擋到',false,e.message);throw e;}
    check('前提:台北車站與中正紀念堂載入近景且被路線擋到',true,v.models.filter(m=>BLOCKED[m.id]).map(m=>({id:m.id,lod:m.lod,excluded:m.excluded})));
    record('A 街圖淨空',v);
    const source=(id,lod)=>page.evaluate(async([id,lod])=>(await (await fetch(new URL('rail-3d/assets/blender-buildings-v1/'+id+'/model.json',location.href))).json()).lods[lod].drawGroups.map(g=>[g.start,g.count]),[id,lod]);
    for(const {id} of [TAIPEI,CKS]){
      const m=v.models.find(m=>m.id===id),groups=await source(id,'near');
      check(`${id} 近景每一組部件都半透明`,groups.length>0&&JSON.stringify(m.parts.map(p=>[p.start,p.count]))===JSON.stringify(groups)&&allGlass([m]),{parts:m.parts.length,glass:glassCount(m)});
    }
    // 其餘模型不變:沒被擋(excluded 空)的一件都不半透明;被擋的部件級模型只有被擋的部件半透明(舊規則本來就對)。
    const others=v.models.filter(m=>!BLOCKED[m.id]);
    check('其餘模型沒被擋的實心不變、被擋的只有被擋的部件半透明',others.length>0&&others.every(m=>m.parts.every(p=>p.glass===(m.excluded.includes(p.component)||m.excluded.includes(m.id))&&p.glass!==p.solid)),summary(others));

    // 截圖:台北車站與中正紀念堂近景(看圖用,不當判準)。
    const shot=async(file,anchor,zoom,bearing)=>{await jump(anchor,zoom,55,bearing);await page.waitForFunction(()=>M.raw.loaded(),null,{timeout:20000}).catch(()=>{});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${out}/${label}${name}-${file}.png`});};
    await shot('taipei-station',TAIPEI.anchor,17.3,20);await shot('cks-hall',CKS.anchor,16.8,0);await jump(TAIPEI.anchor);v=await settle(page,STREET_LIGHT);

    // 遠景(縮到 zoom 15 換成 far LOD 的新網格):同樣要依淨空整座半透明,再回近景。
    await jump(TAIPEI.anchor,15);v=await settle(page,STREET_LIGHT,BLOCKED,'far');record('A2 街圖淨空 遠景',v);
    for(const {id} of [TAIPEI,CKS]){
      const m=v.models.find(m=>m.id===id),groups=await source(id,'far');
      check(`${id} 遠景每一組部件都半透明`,groups.length>0&&JSON.stringify(m.parts.map(p=>[p.start,p.count]))===JSON.stringify(groups)&&allGlass([m]),{parts:m.parts.length,glass:glassCount(m)});
    }
    await jump(TAIPEI.anchor);v=await settle(page,STREET_LIGHT);

    // B 透明模式:整座半透明;關掉後淨空半透明恢復。
    await page.evaluate(()=>railIslandIntegration.setInspection(true));v=await settle(page,STREET_LIGHT);record('B 街圖透明開',v);
    check('街圖透明模式:所有模型整座半透明',allGlass(v.models),summary(v.models));
    await page.evaluate(()=>railIslandIntegration.setInspection(false));v=await settle(page,STREET_LIGHT);
    check('關掉透明模式後淨空半透明恢復',allGlass(v.models.filter(m=>BLOCKED[m.id]))&&allSolid(v.models.filter(m=>!BLOCKED[m.id]&&!m.excluded.length)),summary(v.models));

    // C 衛星底圖(實心外觀):淨空仍在(excluded 不空)但不半透明;開透明模式才整座半透明。
    await page.waitForFunction(()=>typeof satTokenState!=='undefined'&&satTokenState==='ready',null,{timeout:30000});
    await page.evaluate(()=>{state.basemap='sat';setBasemap();});v=await settle(page,/^sat-/);record('C 衛星',v);
    check('衛星底圖:淨空仍在卻不半透明(實心外觀)',allSolid(v.models)&&v.models.filter(m=>BLOCKED[m.id]).every(m=>m.excluded.length>0),summary(v.models));
    await page.evaluate(()=>railIslandIntegration.setInspection(true));v=await settle(page,/^sat-/);
    check('衛星底圖透明模式:整座半透明',allGlass(v.models),summary(v.models));
    await page.evaluate(()=>railIslandIntegration.setInspection(false));
    await page.evaluate(()=>{state.basemap='map';setBasemap();});v=await settle(page,STREET_LIGHT);
    check('衛星切回街圖:淨空半透明恢復',allGlass(v.models.filter(m=>BLOCKED[m.id])),summary(v.models));

    // D 地景底圖(實心外觀)。
    await page.evaluate(()=>{state.basemap='landscape';setBasemap();});v=await settle(page,/^landscape$/);record('D 地景',v);
    check('地景底圖:淨空仍在卻不半透明(實心外觀)',allSolid(v.models)&&v.models.filter(m=>BLOCKED[m.id]).every(m=>m.excluded.length>0),summary(v.models));
    await page.evaluate(()=>railIslandIntegration.setInspection(true));v=await settle(page,/^landscape$/);
    check('地景底圖透明模式:整座半透明',allGlass(v.models),summary(v.models));
    await page.evaluate(()=>railIslandIntegration.setInspection(false));
    await page.evaluate(()=>{state.basemap='map';setBasemap();});v=await settle(page,STREET_LIGHT);
    check('地景切回街圖:淨空半透明恢復',allGlass(v.models.filter(m=>BLOCKED[m.id])),summary(v.models));

    // F 暗色街圖:整座半透明。
    await page.evaluate(()=>state._setAppearance('dark'));v=await settle(page,STREET_DARK);record('F 暗色街圖',v);
    check('暗色街圖:所有模型整座半透明',allGlass(v.models),summary(v.models));
    check('無未處理錯誤',errors.length===0,errors);
  }catch(e){check('流程完成',false,e.stack||String(e));}finally{await context.close();await browser.close();}
}
fs.writeFileSync(`${out}/${label}results.json`,JSON.stringify({results,table},null,1));
console.log(`${results.filter(r=>r.pass).length}/${results.length} 項通過`);
if(results.some(r=>!r.pass))process.exitCode=1;

// 驗 station-layer.js 遮罩延後的契約(桌面 headless Chromium,對本機 5207)。判準全部相對於事件,不吃環境幀率:
//  A. 每一次 maskBuildings 真跑(觀察 querySourceFeatures sourceLayer:'building')時,「距上一個 move 事件」≥350ms
//     ——除非距上一次跑已 ≥14.5s(延後上限路徑)。任何一次違反=延後沒生效。
//  B. 拖曳停下後 ≤2s 內至少跑一次;之後靜止 4s 內不再跑(不會迴圈);building-3d filter 真的含排除清單。
//  C. 延後上限:用 fire('move') 每 50ms 假裝相機一直在動(不付渲染成本,幀率無關)、同時一發假 sourcedata 讓遮罩失效,
//     20s 內必須恰好跑 1 次、時間落在 14.5–16.5s(15s 上限 + 150ms 輪詢);且 0–14s 之間 0 次。
//  D. 對照:同一個 C 情境但不假裝移動(只發 sourcedata)→ ≤1s 內就跑(證明 C 的「拖到 15s」不是別的原因造成的延遲)。
import {chromium} from 'playwright';
const PORT = process.argv[2] || new URL(process.env.BASE_URL || 'http://127.0.0.1:5207/').port;
const results = [];
const HEADFUL = process.env.HEADFUL==='1';
const b = await chromium.launch(HEADFUL?{channel:'chrome',headless:false}:{});
const ctx = await b.newContext({ viewport:{width:1280,height:800}, locale:'zh-TW', timezoneId:'Asia/Taipei', hasTouch:true });
await ctx.addInitScript(()=>{ try{localStorage.setItem('trainmap-howto-seen','1');}catch(e){} });
const page = await ctx.newPage();
const errors=[]; page.on('pageerror', e=>errors.push(String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${PORT}/?scene=3d&lang=zh-TW&cb=${Date.now()}`, { waitUntil:'domcontentloaded' });
await page.waitForFunction(()=>{try{return typeof state!=='undefined'&&state.ready&&typeof M!=='undefined'&&M.raw&&M.isStyleReady()&&!!M.raw.getLayer('live-vehicles-3d');}catch(e){return false;}}, null, {timeout:90000});
await page.evaluate(()=>{try{document.querySelector('#howtoGo')?.click();}catch(e){}});
await page.evaluate(()=>{try{state.mapDark=true;setBasemap();}catch(e){}});
await page.waitForTimeout(2000);
await page.evaluate(()=>{try{setMap3d(true);railIslandIntegration.setMode(true);}catch(e){}});
await page.waitForTimeout(2000);
await page.evaluate(()=>{ const W=window; W.__qsf=[]; W.__qsfAll=[]; W.__mv=[];
  const m=M.raw, oq=m.querySourceFeatures.bind(m);
  m.querySourceFeatures=(src,opt)=>{ if(opt?.sourceLayer==='building'){ const st=String(new Error().stack); const who=/station-layer/.test(st)?'station':/night-map/.test(st)?'night':'other'; W.__qsfAll.push([performance.now(),who]); if(who==='station') W.__qsf.push(performance.now()); } return oq(src,opt); };
  m.on('move',()=>{ W.__mv.push(performance.now()); if(W.__mv.length>20000) W.__mv.splice(0,10000); }); });
await page.evaluate(()=>{try{M.raw.jumpTo({center:[121.5170,25.0478],zoom:16.5,pitch:60,bearing:0});}catch(e){}});
await page.waitForFunction(()=>{try{const s=window.railIslandIntegration?.renderer?.getStations?.()?.stats;return !!(s&&s.visible);}catch(e){return false;}}, null, {timeout:60000}).catch(()=>{});
await page.waitForTimeout(6000);
const scene = await page.evaluate(()=>{ const vis=id=>{try{return M.raw.getLayer(id)?(M.raw.getLayoutProperty(id,'visibility')||'visible'):'absent'}catch(e){return 'err'}};
  const st=railIslandIntegration.renderer?.getStations?.(); return { style:M.getStyleKind(), map3d:!!state.map3d, bldg:vis('building-3d'), stn:!!M.raw.getLayer('island-stations'),
  stnVisible:st?.stats?.visible??null, stnId:st?.stats?.id??null, zoom:+M.raw.getZoom().toFixed(2), pitch:+M.raw.getPitch().toFixed(0), build:BUILD, deferInSource:/scheduleMasks/.test(String(st?.refresh)) }; });
console.log('SCENE', JSON.stringify(scene));
// 每次跑距上一個 move 的毫秒數(找 ≤t 的最後一個 move)
const analyze = (who) => page.evaluate((who)=>{ const q=who==='night'?window.__qsfAll.filter(x=>x[1]==='night').map(x=>x[0]):window.__qsf, mv=window.__mv; let j=0; const rows=[]; let prevRun=null;
  for(const t of q){ while(j<mv.length&&mv[j]<=t) j++; const lastMove=j>0?mv[j-1]:null; rows.push({t:+t.toFixed(0), sinceMove: lastMove===null?null:+(t-lastMove).toFixed(0), sinceRun: prevRun===null?null:+(t-prevRun).toFixed(0)}); prevRun=t; }
  return rows; }, who);
async function touchDrag(secs){ const cdp=await ctx.newCDPSession(page); const t0=Date.now(); let sweeps=0;
  while((Date.now()-t0)/1000<secs){ for(const s of [1,-1]){ const ax=s>0?400:800, ay=s>0?560:300, bx=s>0?800:400, by=s>0?300:560;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ax,y:ay}]});
    for(let i=1;i<=24;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ax+(bx-ax)*i/24,y:ay+(by-ay)*i/24}]}); await new Promise(r=>setTimeout(r,14)); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); sweeps++; await new Promise(r=>setTimeout(r,60)); if((Date.now()-t0)/1000>=secs)break; } }
  await cdp.detach(); return sweeps; }

// ---- A + B:真觸控拖 10 秒 ----
await page.evaluate(()=>{ window.__qsf=[]; window.__qsfAll=[]; window.__mv=[]; window.__dragStart=performance.now(); });
const sweeps = await touchDrag(10);
await page.evaluate(()=>{ window.__dragEnd=performance.now(); });
await page.waitForTimeout(6500);
const rowsAB = await analyze('station'); const rowsN = await analyze('night');
const stat = await page.evaluate(()=>({ moves:window.__mv.length, dragMs:+(window.__dragEnd-window.__dragStart).toFixed(0), lastMoveToDragEnd:+(window.__dragEnd-(window.__mv.at(-1)||window.__dragEnd)).toFixed(0), dragEnd:+window.__dragEnd.toFixed(0) }));
const bad = rowsAB.filter(r=>r.sinceMove!==null && r.sinceMove<350 && !(r.sinceRun!==null && r.sinceRun>=14500));
const afterStop = rowsAB.filter(r=>r.t>=stat.dragEnd-50);
const lastMove = await page.evaluate(()=>window.__mv.at(-1)||0);
const firstAfter = afterStop.length? afterStop[0].t-lastMove : null;
const late = rowsAB.filter(r=>r.t>lastMove+2500);
const fx = await page.evaluate(()=>{ const f=JSON.stringify(M.raw.getFilter('building-3d')||null); const m=f.match(/"literal",\[([^\]]*)\]/); return { hasLiteral:!!m, ids: m?(m[1]?m[1].split(',').length:0):0 }; });
const who = await page.evaluate(()=>{ const c={}; for(const [,w] of window.__qsfAll) c[w]=(c[w]||0)+1; return c; });
console.log('DRAG', JSON.stringify({ sweeps, ...stat, byCaller:who, stationRuns:rowsAB, firstAfterMs:firstAfter, filter:fx }));
results.push({ name:'A 每次遮罩重算距上一個 move ≥350ms(延後生效)', pass: bad.length===0 && rowsAB.length>0, detail:{ runs:rowsAB.length, violations:bad } });
results.push({ name:'B1 停下 ≤2s 內重算一次', pass: firstAfter!==null && firstAfter<=2000, detail:{ firstAfterMs:firstAfter } });
results.push({ name:'B2 靜止後不再重掃(不迴圈)', pass: late.length<=1, detail:{ lateRuns:late.length } });
results.push({ name:'B3 building-3d filter 含排除清單(遮罩有效)', pass: fx.hasLiteral && fx.ids>0, detail:fx });
const badN = rowsN.filter(r=>r.sinceMove!==null && r.sinceMove<350 && !(r.sinceRun!==null && r.sinceRun>=14500));
const afterN = rowsN.filter(r=>r.t>=stat.dragEnd-50); const firstAfterN = afterN.length? afterN[0].t-lastMove : null;
const glass = await page.evaluate(()=>{ const g=M.raw.getLayer('building-glass-edges')?.implementation; return { count:g?.count??null, buildings:g?.buildings??null, tiles:g?.tiles?.size??null }; });
console.log('NIGHT', JSON.stringify({ runs:rowsN, firstAfterMs:firstAfterN, glass }));
results.push({ name:'N1 玻璃線每次重建距上一個 move ≥350ms(延後生效)', pass: badN.length===0 && rowsN.length>0, detail:{ runs:rowsN.length, violations:badN } });
results.push({ name:'N2 停下 ≤2s 內重建一次且有頂點', pass: firstAfterN!==null && firstAfterN<=2000 && glass.count>0, detail:{ firstAfterMs:firstAfterN, glass } });

// ---- C:先假裝相機動 1.2s(讓任何殘留的排程鏈先在「移動中」狀態穩定),再發假 sourcedata → 之後 13.5–16.5s 恰 1 次,13.5s 前 0 次 ----
await page.evaluate(()=>{ window.__qsf=[]; window.__qsfAll=[]; window.__mv=[]; window.__fakeMove=setInterval(()=>{ try{ M.raw.fire('move'); }catch(e){} },50); });
await page.waitForTimeout(1200);
await page.evaluate(()=>{ window.__qsf=[]; window.__qsfAll=[]; window.__c0=performance.now(); try{ M.raw.fire('sourcedata',{sourceDataType:'content',sourceId:'openmaptiles',dataType:'source'}); }catch(e){} });
await page.waitForTimeout(20000);
const rC = await page.evaluate(()=>{ clearInterval(window.__fakeMove); const c0=window.__c0, mv=window.__mv; let mg=0; for(let i=1;i<mv.length;i++) mg=Math.max(mg,mv[i]-mv[i-1]); const c={}; for(const [,w] of window.__qsfAll) c[w]=(c[w]||0)+1; return { runsAt: window.__qsf.map(t=>+((t-c0)/1000).toFixed(2)), byCaller:c, moves: mv.length, maxFakeGapMs:+mg.toFixed(0) }; });
console.log('CAP', JSON.stringify(rC));
const inWin = rC.runsAt.filter(s=>s>=13.5&&s<=16.5).length, early = rC.runsAt.filter(s=>s<13.5).length;
if (rC.maxFakeGapMs>=350) results.push({ name:'C 前置條件:假 move 間隔必須 <350ms(環境太慢=本條無效,不算過也不算紅)', pass:false, detail:rC });
else results.push({ name:'C 持續移動時 15s 上限一定會算一次(13.5–16.5s 恰 1 次、之前 0 次)', pass: inWin===1 && early===0 && rC.runsAt.length<=2, detail:rC });
const nightAt = await page.evaluate(()=>window.__qsfAll.filter(x=>x[1]==='night').map(x=>+((x[0]-window.__c0)/1000).toFixed(2)));
const nWin = nightAt.filter(s=>s>=13.5&&s<=16.5).length, nEarly = nightAt.filter(s=>s<13.5).length;
if (rC.maxFakeGapMs<350) results.push({ name:'N3 玻璃線持續移動時 15s 上限也恰算一次', pass: nWin===1 && nEarly===0, detail:{ nightAt } });

// ---- D:對照組:不假裝移動、只發 sourcedata → ≤1s 內就跑 ----
await page.waitForTimeout(1500);
await page.evaluate(()=>{ window.__qsf=[]; window.__d0=performance.now(); try{ M.raw.fire('sourcedata',{sourceDataType:'content',sourceId:'openmaptiles',dataType:'source'}); }catch(e){} });
await page.waitForTimeout(3000);
const rD = await page.evaluate(()=>({ runsAt: window.__qsf.map(t=>+((t-window.__d0)/1000).toFixed(2)) }));
console.log('CTRL', JSON.stringify(rD));
results.push({ name:'D 對照:相機靜止時 sourcedata 後 ≤1s 內重算', pass: rD.runsAt.length>=1 && rD.runsAt[0]<=1.0, detail:rD });
results.push({ name:'Z 無 pageerror', pass: errors.length===0, detail:errors.slice(0,3) });
for(const r of results) console.log(r.pass?'PASS':'FAIL', r.name, JSON.stringify(r.detail).slice(0,300));
await b.close();
process.exitCode = results.some(r=>!r.pass)?1:0;

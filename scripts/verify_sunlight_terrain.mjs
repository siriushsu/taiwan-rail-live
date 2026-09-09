import {chromium,webkit} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5236/',out='output/sunlight-terrain';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
// 鋪面真值取自 vendor/ofm-landscape.json 的原始配色，不問模組自己現在是什麼值。
const style=JSON.parse(fs.readFileSync('vendor/ofm-landscape.json','utf8'));
const PAVED=[['highway_minor','line-color'],['highway_major_casing','line-color'],['highway_motorway_inner','line-color'],
 ['highway_path','line-color'],['railway','line-color'],['building','fill-color'],['aeroway-runway-casing','line-color']]
 .map(([id,prop])=>[id,prop,style.layers.find(l=>l.id===id).paint[prop]]);
const originalPaint={'hillshade-exaggeration':.42,'hillshade-shadow-color':'#5c785f','hillshade-highlight-color':'#fff4d6','hillshade-accent-color':'#90a580','hillshade-illumination-direction':315};
const snap=()=>({terrain:M.raw.getTerrain(),center:M.raw.getCenter().toArray(),zoom:M.raw.getZoom(),pitch:M.raw.getPitch(),bearing:M.raw.getBearing(),height:M.raw.queryTerrainElevation([120.731,23.518]),layers:M.raw.getStyle().layers.map(l=>l.id)});
for(const [name,engine] of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:({chromium,webkit})[process.env.ENGINE]}:{chromium,webkit})){
 const b=await engine.launch();const ctx=await b.newContext({viewport:{width:1000,height:800},locale:'zh-TW'});await ctx.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));const p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.stack));p.on('console',m=>{if(m.type()==='error'&&/unknown property|hillshade|sky-color|light\.position/.test(m.text()))errors.push(m.text());});await p.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
 try{
  await p.goto(base+'?map=landscape&scene=3d&ground=terrain&at=23.518,120.731&z=12.5&t=12:00&sun=on&lang=zh-TW');
  await p.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer&&sunlight?.current&&M.raw.queryTerrainElevation([120.731,23.518])>50,null,{timeout:90000});
  await p.evaluate(()=>{state.playing=false;window.__sunTestCtx={date:'2026-09-08'};document.body.classList.add('fs');M.resize();M.raw.jumpTo({center:[120.731,23.518],zoom:12.5,pitch:75,bearing:75});setSimSec(43200);});await p.waitForFunction(()=>M.raw.isSourceLoaded('terrain')&&!!window.railIslandIntegration&&!window.railIslandIntegration?.loading,null,{timeout:60000});await p.waitForTimeout(800);
  const before=await p.evaluate(snap),readings={};
  const boundary=await p.evaluate(()=>{const tr=M.raw.transform;let ridge=0,sky=0;for(let x=40;x<tr.width-40;x+=40)for(let y=80;y<180;y+=5)if(!tr.isPointOnMapSurface({x,y})&&M.isOnSurface({x,y}))ridge++;for(let x=40;x<tr.width-40;x+=80)if(!M.isOnSurface({x,y:20}))sky++;return {ridge,sky,clip:M.surfaceTop()};});
  check(name+' 起伏山稜可點／天空拒收／不水平切字',boundary.ridge>0&&boundary.sky>0&&boundary.clip===0,boundary);
  check(name+' 實際山區 DEM 起伏',before.height>1000&&before.terrain?.exaggeration===1,before.height);
  for(const h of [6,12,18,0]){
   await p.evaluate(h=>{state.playing=false;setSimSec(h*3600);},h);await p.waitForTimeout(450);
   readings[h]=await p.evaluate(P=>({sun:sunlight.current,paint:M.raw.getLayer('landscape-hillshade').serialize().paint,paved:Object.fromEntries(P.map(([id,prop])=>[id,M.raw.getPaintProperty(id,prop)]))}),PAVED);
   await p.screenshot({path:`${out}/${name}-${h}.png`});
  }
  check(name+' 四時段山坡共用太陽方位與高度',Object.values(readings).every(r=>r.paint['hillshade-illumination-anchor']==='map'&&Math.abs(r.paint['hillshade-illumination-direction']-r.sun.azimuth)<1.01&&r.paint['hillshade-illumination-altitude']===Math.max(0,r.sun.elevation)&&r.paint['hillshade-method']==='basic'));
  check(name+' 夜間降低坡面對比且保留起伏',readings[0].paint['hillshade-exaggeration']<readings[12].paint['hillshade-exaggeration']&&JSON.stringify(await p.evaluate(snap))===JSON.stringify(before),{height:before.height,afterHeight:(await p.evaluate(snap)).height});
  // 2026-09-09：入夜後道路等鋪面畫在 hillshade 之上，原本整夜維持白天的淺色，蓋過軌道與列車。
  // 白天必須逐字等於樣式檔的原色（真值取自 vendor/ofm-landscape.json，不是問模組自己）。
  check(name+' 白天鋪面維持樣式原色',PAVED.every(([id,,day])=>readings[12].paved[id]===day),
    PAVED.filter(([id,,day])=>readings[12].paved[id]!==day).map(([id,,day])=>[id,day,readings[12].paved[id]]));
  // 亮度自己算，不借模組的解析器（借了就變成拿實作驗實作）。樣式裡三種寫法都要認得。
  const lum=v=>{const t=String(v).trim().toLowerCase();let c;
   if(t[0]==='#'){const h=t.length===4?[...t.slice(1)].map(x=>x+x).join(''):t.slice(1,7);c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}
   else{const n=t.match(/-?\d*\.?\d+/g).map(Number);
    if(t.startsWith('hsl')){const h=((n[0]%360)+360)%360/360,sa=n[1]/100,l=n[2]/100,q=l<.5?l*(1+sa):l+sa-l*sa,pp=2*l-q;
     const ch=x=>{x=(x+1)%1;return (x<1/6?pp+(q-pp)*6*x:x<.5?q:x<2/3?pp+(q-pp)*(2/3-x)*6:pp)*255;};c=[ch(h+1/3),ch(h),ch(h-1/3)];}
    else c=n.slice(0,3);}
   return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  check(name+' 午夜鋪面壓暗',PAVED.every(([id,,day])=>lum(readings[0].paved[id])<lum(day)-40),
    Object.fromEntries(PAVED.map(([id,,day])=>[id,[day,readings[0].paved[id]]]).slice(0,4)));
  // 反向對照：不能壓到跟地面一樣暗，路網要還看得出走向。地面吃 hillshade 陰影 rgb(23,38,59)。
  check(name+' 午夜鋪面仍亮於地面陰影',PAVED.every(([id])=>lum(readings[0].paved[id])>lum('#17263b')+8),
    Object.fromEntries(PAVED.map(([id])=>[id,Math.round(lum(readings[0].paved[id]))]).slice(0,4)));
  check(name+' 黃昏鋪面介於兩者之間',PAVED.every(([id,,day])=>lum(readings[18].paved[id])<=lum(day)&&lum(readings[18].paved[id])>=lum(readings[0].paved[id])));
  await p.evaluate(()=>sunlight.setEnabled(false));
  check(name+' 關閉還原完整地景陰影',JSON.stringify(await p.evaluate(()=>M.raw.getLayer('landscape-hillshade').serialize().paint))===JSON.stringify(originalPaint));
  check(name+' 關閉還原鋪面原色',await p.evaluate(P=>P.every(([id,prop,day])=>M.raw.getPaintProperty(id,prop)===day),PAVED));
  await p.evaluate(()=>{sunlight.setEnabled(true);setSimSec(28800);M.raw.setBearing(155);});await p.waitForTimeout(400);
  check(name+' 旋轉鏡頭不旋轉太陽',await p.evaluate(()=>M.raw.getPaintProperty('landscape-hillshade','hillshade-illumination-anchor')==='map'&&M.raw.getPaintProperty('landscape-hillshade','hillshade-illumination-direction')===sunlight.current.azimuth));
  // 同一真實 DEM 的東西坡，在正上方固定鏡頭用像素驗證迎光面交換。
  // 暫時隱藏道路/符號等圖層，以免列車移動或標籤遮擋被算成光照差異。
  await p.evaluate(()=>{M.raw.jumpTo({center:[120.731,23.518],zoom:13,pitch:0,bearing:0});document.getElementById('overlay').style.visibility='hidden';for(const l of M.raw.getStyle().layers)if(!['background','hillshade'].includes(l.type))M.raw.setLayoutProperty(l.id,'visibility','none');M.raw.setPaintProperty('background','background-color','#a0b38b');});
  await p.waitForTimeout(1500);
  const samples=await p.evaluate(()=>{const a=[];for(let y=80;y<M.raw.transform.height-100;y+=14)for(let x=110;x<M.raw.transform.width-110;x+=14){const ll=M.raw.unproject([x,y]),d=.001,east=M.raw.queryTerrainElevation([ll.lng+d,ll.lat]),west=M.raw.queryTerrainElevation([ll.lng-d,ll.lat]),north=M.raw.queryTerrainElevation([ll.lng,ll.lat+d]),south=M.raw.queryTerrainElevation([ll.lng,ll.lat-d]),dx=(east-west)/(2*d*111320*Math.cos(ll.lat*Math.PI/180)),dy=(north-south)/(2*d*111320);if([east,west,north,south].every(Number.isFinite)&&Math.abs(dx)>.25&&Math.abs(dx)>Math.abs(dy)*1.5)a.push({x,y,side:dx<0?'east':'west'});}return a;});
  const shots={};for(const h of [8,16]){await p.evaluate(h=>setSimSec(h*3600),h);await p.waitForTimeout(450);shots[h]=PNG.sync.read(await p.locator('.maplibregl-canvas').screenshot({path:`${out}/${name}-slopes-${h}.png`}));}
  const changes={east:[],west:[]};for(const s of samples){const lum=h=>{let v=0;const png=shots[h];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((s.y+dy)*png.width+s.x+dx)*4;v+=.2126*png.data[i]+.7152*png.data[i+1]+.0722*png.data[i+2];}return v/9;};changes[s.side].push(lum(8)-lum(16));}
  const detail=Object.fromEntries(Object.entries(changes).map(([k,a])=>[k,{count:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,correct:a.filter(v=>k==='east'?v>3:v< -3).length/a.length}]));
  check(name+' 真實 DEM 東坡晨亮／西坡夕亮像素驗證',detail.east.count>20&&detail.west.count>20&&detail.east.mean>8&&detail.west.mean< -8&&detail.east.correct>.7&&detail.west.correct>.7,detail);
  for(const kind of ['light','landscape']){await p.evaluate(k=>chooseBasemap(k),kind);await p.waitForFunction(k=>M.getStyleKind()===k&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,kind,{timeout:60000});}
  check(name+' 樣式重建恢復山坡光照',await p.evaluate(()=>M.raw.getPaintProperty('landscape-hillshade','hillshade-illumination-direction')===sunlight.current.azimuth));
  await p.evaluate(()=>{setSimSec(0);sunlight.update(true);});await p.waitForTimeout(400);
  check(name+' 樣式重建後夜色重新套到鋪面',await p.evaluate(P=>P.every(([id,prop,day])=>M.raw.getPaintProperty(id,prop)!==day),PAVED));
  await p.evaluate(()=>sunlight.setEnabled(false));
  // 重建後還原要回到【樣式原色】：存原值的時機若晚於塗色，這裡會停在夜色。
  check(name+' 樣式重建後仍還原得回原色',await p.evaluate(P=>P.every(([id,prop,day])=>M.raw.getPaintProperty(id,prop)===day),PAVED));
  // 🔴 positron／dark 與地景共用同一批道路圖層 id,但沒有 landscape-hillshade ⇒ 它們的地面
  //    整夜維持原色。若夜色沒綁「有沒有那層」,淺色底圖入夜會變成亮底配暗路,比原本更糟。
  await p.evaluate(()=>{sunlight.setEnabled(true);setSimSec(0);});await p.waitForTimeout(300);
  await p.evaluate(()=>chooseBasemap('light'));
  await p.waitForFunction(()=>M.getStyleKind()==='light'&&!window.railIslandIntegration?.loading,null,{timeout:60000});
  await p.evaluate(()=>sunlight.update(true));await p.waitForTimeout(400);
  const positron=JSON.parse(fs.readFileSync('vendor/ofm-positron.json','utf8'));
  const lightPaved=PAVED.map(([id,prop])=>[id,prop,positron.layers.find(l=>l.id===id)?.paint?.[prop]]).filter(([,,v])=>v!==undefined);
  // positron 有些道路是 expression（陣列），用 JSON 比對而不是 ===，否則兩個相等的陣列也算不同。
  const same='(a,b)=>JSON.stringify(a)===JSON.stringify(b)';
  check(name+' 淺色底圖午夜不動道路（沒有 hillshade 壓暗地面）',
    await p.evaluate(([P,f])=>{const eq=eval(f);return P.every(([id,prop,day])=>!M.raw.getLayer(id)||eq(M.raw.getPaintProperty(id,prop),day));},[lightPaved,same]),
    await p.evaluate(([P,f])=>{const eq=eval(f);return P.filter(([id,prop,day])=>M.raw.getLayer(id)&&!eq(M.raw.getPaintProperty(id,prop),day)).map(([id,prop,day])=>[id,day,M.raw.getPaintProperty(id,prop)]);},[lightPaved,same]));
  await p.evaluate(()=>chooseBasemap('landscape'));
  await p.waitForFunction(()=>M.getStyleKind()==='landscape'&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,null,{timeout:60000});
  await p.evaluate(()=>sunlight.update(true));await p.waitForTimeout(400);
  check(name+' 切回地景夜色重新套上',await p.evaluate(P=>P.every(([id,prop,day])=>M.raw.getPaintProperty(id,prop)!==day),PAVED));
  await p.evaluate(()=>{sunlight.setEnabled(true);setSimSec(28800);});await p.waitForTimeout(300);
  await p.evaluate(()=>{sunlight.setEnabled(false);railIslandIntegration.setGroundMode('flat');});check(name+' 切平坦並關閉保留原本配色',await p.evaluate(()=>!M.raw.getTerrain())&&JSON.stringify(await p.evaluate(()=>M.raw.getLayer('landscape-hillshade').serialize().paint))===JSON.stringify(originalPaint));
  await p.evaluate(()=>{railIslandIntegration.setGroundMode('terrain');sunlight.setEnabled(true);});check(name+' 切回起伏保留光照',await p.evaluate(()=>M.raw.getTerrain()?.exaggeration===1&&M.raw.getPaintProperty('landscape-hillshade','hillshade-method')==='basic'));
  check(name+' 無頁面／樣式錯誤',errors.length===0,errors);
 }catch(e){check(name+' 地形流程完成',false,String(e.stack));}finally{await b.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5236/',out='output/sunlight-terrain';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
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
   readings[h]=await p.evaluate(()=>({sun:sunlight.current,paint:M.raw.getLayer('landscape-hillshade').serialize().paint}));
   await p.screenshot({path:`${out}/${name}-${h}.png`});
  }
  check(name+' 四時段山坡共用太陽方位與高度',Object.values(readings).every(r=>r.paint['hillshade-illumination-anchor']==='map'&&Math.abs(r.paint['hillshade-illumination-direction']-r.sun.azimuth)<1.01&&r.paint['hillshade-illumination-altitude']===Math.max(0,r.sun.elevation)&&r.paint['hillshade-method']==='basic'));
  check(name+' 夜間降低坡面對比且保留起伏',readings[0].paint['hillshade-exaggeration']<readings[12].paint['hillshade-exaggeration']&&JSON.stringify(await p.evaluate(snap))===JSON.stringify(before),{height:before.height,afterHeight:(await p.evaluate(snap)).height});
  await p.evaluate(()=>sunlight.setEnabled(false));
  check(name+' 關閉還原完整地景陰影',JSON.stringify(await p.evaluate(()=>M.raw.getLayer('landscape-hillshade').serialize().paint))===JSON.stringify(originalPaint));
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
  await p.evaluate(()=>{sunlight.setEnabled(false);railIslandIntegration.setGroundMode('flat');});check(name+' 切平坦並關閉保留原本配色',await p.evaluate(()=>!M.raw.getTerrain())&&JSON.stringify(await p.evaluate(()=>M.raw.getLayer('landscape-hillshade').serialize().paint))===JSON.stringify(originalPaint));
  await p.evaluate(()=>{railIslandIntegration.setGroundMode('terrain');sunlight.setEnabled(true);});check(name+' 切回起伏保留光照',await p.evaluate(()=>M.raw.getTerrain()?.exaggeration===1&&M.raw.getPaintProperty('landscape-hillshade','hillshade-method')==='basic'));
  check(name+' 無頁面／樣式錯誤',errors.length===0,errors);
 }catch(e){check(name+' 地形流程完成',false,String(e.stack));}finally{await b.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

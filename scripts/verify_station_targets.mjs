// 車站近景：雙引擎實際繪圖、放大前後觸控、全台同框與捷運分頁、列車點選回歸。
import {chromium,webkit} from 'playwright';
import sharp from 'sharp';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output/station-targets');fs.mkdirSync(out,{recursive:true});
const mime={'.mjs':'text/javascript','.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/thsr-schedule'){res.setHeader('content-type','application/json');return fs.createReadStream(path.join(root,'data/thsr_schedule_dense.json')).pipe(res);}return res.writeHead(503).end('{}');}let p=path.resolve(root,'.'+decodeURI(u.pathname));if(!p.startsWith(root+path.sep)&&p!==root)return res.writeHead(404).end();if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('content-type',mime[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
const results=[];function ok(name,pass,detail=''){results.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);}
const boot=async page=>{await page.goto(base+'?g=all&t=09:01&lang=zh-TW');await page.waitForFunction(()=>window.__state?.ready&&window.__glTracks?.ready&&state.trains.length>0,null,{timeout:60000});};
const prepare=({kind,zoom})=>{
 closeBoard();clearFollow();clearFreqFollow();
 selectGroup(GROUPS.find(g=>g.id===(kind==='freq'?'metro':'all')));setSimSec(3*3600+300);state.playing=false;
 let st;
 if(kind==='freq'||kind==='deco'){const lines=kind==='freq'?state.lines:state.decoLines;const ln=lines.find(l=>l._sys==='mrt'&&l.stations.some(s=>s.name==='關渡'));st=ln.stations.find(s=>s.name==='關渡');}
 else st=state.schedStations.find(s=>s.sys===kind&&s.name.replace(/臺/g,'台')===(kind==='thsr_sched'?'桃園':'萬華'));
 window.__targetStation=st;M.setView([st.lat,st.lon],zoom,{animate:false});M.raw.setPitch(45);reproject();draw();return {lat:st.lat,lon:st.lon,name:st.name};
};
const tapPoint=()=>{const st=window.__targetStation,p=M.toScreen([st.lat,st.lon]),r=M.getContainer().getBoundingClientRect();for(const [dx,dy]of [[22,0],[-22,0],[0,22],[0,-22]]){const cp=M.point(p.x+dx,p.y+dy);const stations=[...(state.schedStations||[]),...(state.mode==='sched'?state.decoLines:state.lines).flatMap(l=>l.stations||[])];const other=stations.some(s=>{const q=M.toScreen([s.lat,s.lon]);return Math.hypot(q.x-p.x,q.y-p.y)>1&&Math.hypot(q.x-cp.x,q.y-cp.y)<=16;});if(!other&&!trainAt(cp)&&!freqTrainAt(cp))return {x:r.left+cp.x,y:r.top+cp.y,center:{x:r.left+p.x,y:r.top+p.y}};}throw new Error('本站周邊全被列車佔用');};
let browser;
try{
 for(const [en,engine]of Object.entries({chromium,webkit})){
  browser=await engine.launch();const ctx=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW'});await ctx.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
  // 使用正式 Canvas 繪圖函式量出像素邊界，不用半徑公式自己驗自己。
  for(const tier of [0,4]){
   const sizes=[];for(const zoom of [12,16,18]){await page.evaluate(prepare,{kind:'tra_sched',zoom});sizes.push(await page.evaluate(tier=>{ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,100,100);drawStationIcon({x:50,y:50},tier);const d=ctx.getImageData(0,0,100,100).data;let lo=100,hi=0;for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(d[(y*100+x)*4+3]>100){lo=Math.min(lo,x);hi=Math.max(hi,x);}ctx.restore();return hi-lo+1;},tier));}
   ok(en+' 台鐵站等 '+tier+' 近景放大且有上限',sizes[1]>=sizes[0]+7&&sizes[2]===sizes[1],sizes);
  }
  // GL 車站在真實地圖上像素 A/B。只留站點與深色底，移除道路/列車等混淆像素。
  await page.evaluate(prepare,{kind:'freq',zoom:16});
  await page.evaluate(()=>{document.getElementById('overlay').style.visibility='hidden';M.raw.setStyle({version:8,sources:{},layers:[{id:'test-bg',type:'background',paint:{'background-color':'#0C1322'}}]});});
  await page.waitForFunction(()=>M.raw.getLayer('track-stations')&&M.raw.getPaintProperty('track-stations','circle-pitch-scale')==='viewport');
  await page.evaluate(()=>{for(const id of M.raw.getLayersOrder())if(id.startsWith('track-')&&id!=='track-stations')M.raw.setLayoutProperty(id,'visibility','none');});
  const pixels=[];
  for(const zoom of [12,16]){await page.evaluate(zoom=>{const s=window.__targetStation;M.setView([s.lat,s.lon],zoom,{animate:false});},zoom);await page.waitForTimeout(250);const center=await page.evaluate(()=>{const s=window.__targetStation,p=M.toScreen([s.lat,s.lon]),r=M.getContainer().getBoundingClientRect();return{x:r.left+p.x,y:r.top+p.y};});const image=await page.screenshot({clip:{x:Math.round(center.x)-15,y:Math.round(center.y)-15,width:30,height:30}});fs.writeFileSync(path.join(out,en+'-metro-z'+zoom+'.png'),image);const data=await sharp(image).raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.data.length;i+=data.info.channels)if(data.data[i]>40||data.data[i+1]>50||data.data[i+2]>65)n++;pixels.push(n);}
  ok(en+' 捷運站圈近景實際像素明顯加大',pixels[1]>pixels[0]*2&&pixels[1]>80,pixels);
  await ctx.close();
  const mobile=await browser.newContext({viewport:{width:375,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'});await mobile.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});const touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(e.message));await boot(touch);
  for(const width of [360,375,390,414,540,768]){
   await touch.setViewportSize({width,height:900});
   for(const kind of ['tra_sched','thsr_sched','freq','deco']){
    const st=await touch.evaluate(prepare,{kind,zoom:12});await touch.waitForTimeout(100);let point=await touch.evaluate(tapPoint);await touch.touchscreen.tap(point.x,point.y);
    const far=await touch.evaluate(()=>({station:state.boardStation?.name,train:state.followTrain?.train,freq:!!state.freqFollow,zoom:M.getZoom(),radius:stationHitRadius()}));ok(en+` ${width} ${kind} 遠景保留原命中範圍`,!far.station&&!far.train&&!far.freq,far);
    await touch.evaluate(prepare,{kind,zoom:16});await touch.waitForTimeout(100);point=await touch.evaluate(tapPoint);
    const target=await touch.evaluate(p=>{const el=document.elementFromPoint(p.x,p.y);return !!el?.closest('#map');},point);
    ok(en+` ${width} ${kind} 新熱區沒有被 UI 遮住`,target,point);
    await touch.touchscreen.tap(point.x,point.y);
    const selected=await touch.evaluate(()=>({name:state.boardStation?.name,sys:state.boardStation?.sys,metro:state.boardStation?.metroSysId}));
    ok(en+` ${width} ${kind} 22px 外緣真觸控能開正確看板`,selected.name===st.name&&selected.sys===kind,selected);
    if(width===375&&kind==='tra_sched')await touch.screenshot({path:path.join(out,en+'-station-board.png')});
   }
   ok(en+' '+width+' 無水平捲動',await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  // 列車本體與優先序不變：挑離站的真實班次直接點車牌。
  await touch.evaluate(()=>{closeBoard();clearFollow();selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(9*3600);state.playing=false;const tr=state.trains.find(tr=>{const p=trainPos(tr,state.simSec);return p&&state.schedStations.every(s=>haversineKm(s,p)>.4);});window.__targetTrain=tr;const p=trainPos(tr,state.simSec);M.setView([p.lat,p.lon],16,{animate:false});reproject();draw();});await touch.waitForTimeout(200);
  const train=await touch.evaluate(()=>{const tr=window.__targetTrain,p=trainPos(tr,state.simSec),q=M.toScreen([p.lat,p.lon]),r=M.getContainer().getBoundingClientRect();return{no:tr.train,x:r.left+q.x,y:r.top+q.y};});await touch.touchscreen.tap(train.x,train.y);
  ok(en+' 放大站圈後仍能直接跟隨離站列車',await touch.evaluate(no=>state.followTrain?.train===no,train.no));
  ok(en+' 無執行例外',errors.length===0,errors);await mobile.close();await browser.close();browser=null;
 }
}catch(e){ok('驗收執行',false,e.stack);}finally{if(browser)await browser.close();server.close();}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

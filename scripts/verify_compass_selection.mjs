// 指北回歸：真按鈕、選站／兩套跟車形狀、面板同開、手機可及性與跨層像素驗證。
import {chromium,webkit} from 'playwright';
import sharp from 'sharp';
import {probeCentroids} from './probe_centroids.mjs';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output/compass-selection'+(process.env.COMPASS_WIDTHS?'-'+process.env.COMPASS_WIDTHS.replace(/,/g,'-'):''));fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/thsr-schedule'){res.setHeader('content-type','application/json');return fs.createReadStream(path.join(root,'data/thsr_schedule_dense.json')).pipe(res);}return res.writeHead(503).end('{}');}let p=path.resolve(root,'.'+decodeURI(u.pathname));if(!p.startsWith(root+path.sep)&&p!==root)return res.writeHead(404).end();if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('content-type',mime[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
const results=[];function ok(name,pass,detail=''){results.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);}
const boot=async page=>{await page.goto(base+'?g=all&t=09:01&lang=zh-TW&aligndot=follow');await page.waitForFunction(()=>window.__state?.ready&&window.__glTracks?.ready&&state.trains.length>0,null,{timeout:60000});};
const prepare=kind=>{
 closeBoard();clearFollow();clearFreqFollow();selectGroup(GROUPS.find(g=>g.id===((kind==='freq'||kind==='metro-board')?'metro':'all')));setSimSec(9*3600);state.playing=true;state.speedMult=1;
 resetFollowHeading({immediate:true});state._setAppearance(kind==='board-light'?'light':'dark');
 if(kind.includes('board')){
  let st;if(kind==='metro-board'){const ln=state.lines.find(l=>l._sys==='mrt'&&l.stations.some(s=>s.name==='關渡'));st={...ln.stations.find(s=>s.name==='關渡'),sys:'freq',metroSysId:'mrt'};}else st=state.schedStations.find(s=>s.sys==='tra_sched'&&s.name==='萬華');
  M.setView([st.lat,st.lon],16,{animate:false,bearing:79,pitch:45});openBoard(st);setSheetSize(document.getElementById('board'),kind==='board-small'?'small':'medium');
 }else if(kind==='freq'||kind==='deco'){
  const lines=kind==='freq'?state.lines:state.decoLines;let found;
  for(const ln of lines){if(!ln._tt||isTrtcBoardLine(ln))continue;for(const tr of ln._tt){for(let i=1;i+2<tr.length;i+=2){const sec=tr[i]+5,info=freqTrainInfoAt(ln,tr,sec),a=freqTrainInfoAt(ln,tr,sec-5).pos,b=freqTrainInfoAt(ln,tr,sec+5).pos;if(!a||!b||!info.pos)continue;const heading=initialBearing(a,b);if(Number.isFinite(heading)&&Math.abs(heading)>30){found={ln,tr,sec};break;}}if(found)break;}if(found)break;}
  if(!found)throw Error('沒有捷運行駛樣本');setSimSec(found.sec);if(!applyFreqFollow(found))throw Error('無法跟車');M.setPitch(45);M.raw.setZoom(15);
 }else{
  const tr=state.trains.find(tr=>{const a=trainPos(tr,state.simSec-5),b=trainPos(tr,state.simSec+5);if(!a||!b)return false;const heading=initialBearing(a,b);return kind==='sched-n'?heading>30:heading< -30;});
  if(!tr)throw Error('沒有指定方向的列車');if(kind==='combined')openBoard(state.schedStations.find(s=>s.sys==='tra_sched'&&s.name==='萬華'));setFollow(tr,false,true);if(kind==='train-sheet')openTrainSheet();M.raw.setZoom(15);M.setPitch(45);
 }
 reproject();draw();window.__compassSelection={board:state.boardStation,train:state.followTrain,freq:state.freqFollow};return {board:state.boardStation?.name,train:state.followTrain?.train,freq:!!state.freqFollow};
};
let browser;
try{
 for(const[en,engine]of Object.entries({chromium,webkit})){
  browser=await engine.launch();let context,page,errors;
  for(const [width,height] of [[1280,900],[360,900],[375,900],[390,900],[414,900],[540,900],[768,900],[900,414]].filter(([w])=>!process.env.COMPASS_WIDTHS||process.env.COMPASS_WIDTHS.split(',').includes(String(w)))){
   const mobile=width<1000;
   if(!context||width===360){if(context)await context.close();context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:'zh-TW'});await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});page=await context.newPage();errors=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);}else await page.setViewportSize({width,height});
   for(const kind of ['board','metro-board','sched-n','sched-s','freq','deco','combined','train-sheet','board-small','board-light'].filter(k=>!process.env.COMPASS_KINDS||process.env.COMPASS_KINDS.split(',').includes(k))){
    const selected=await page.evaluate(prepare,kind);await page.waitForTimeout(450);
    const compass=page.locator('.maplibregl-ctrl-compass');
    const area=await compass.boundingBox();
    const reachable=area&&await page.evaluate(r=>{const x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&!!document.elementFromPoint(x,y)?.closest('.maplibregl-ctrl-compass');},area);
    ok(`${en} ${width} ${kind} 指北按鈕可點`,reachable,area);
    if(!reachable){await page.screenshot({path:path.join(out,`${en}-${width}-${kind}-blocked.png`)});continue;}
    const collisions=await page.evaluate(r=>[...document.querySelectorAll('button,input,select,[role=button]')].filter(el=>!el.closest('.maplibregl-ctrl-compass')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[hidden]')).filter(el=>{if(getComputedStyle(el).pointerEvents==='none')return false;for(let p=el;p;p=p.parentElement)if(+getComputedStyle(p).opacity<.5)return false;const b=el.getBoundingClientRect();return b.width&&b.height&&Math.min(b.right,r.x+r.width)-Math.max(b.left,r.x)>1&&Math.min(b.bottom,r.y+r.height)-Math.max(b.top,r.y)>1;}).map(el=>el.id||el.className),area);ok(`${en} ${width} ${kind} 指北與既有操作控件不重疊`,!collisions.length,collisions);
    if(mobile)await compass.tap();else await compass.click();
    const result=await page.evaluate(()=>new Promise(resolve=>{const start=performance.now(),frames=[];function sample(now){frames.push({b:M.getBearing(),p:M.getPitch()});if(now-start<650)return requestAnimationFrame(sample);const ref=window.__compassSelection;resolve({frames:frames.length,late:frames.slice(-8),selection:state.boardStation===ref.board&&state.followTrain===ref.train&&state.freqFollow===ref.freq,locked:!(ref.train||ref.freq)||state.followLock});}requestAnimationFrame(sample);}));
    ok(`${en} ${width} ${kind} 回北回水平且保持選取與跟隨`,result.frames>=4&&result.late.every(v=>Math.abs(v.b)<.1&&Math.abs(v.p)<.1)&&result.selection&&result.locked,result);
    if(width===1280&&(kind==='sched-n'||kind==='sched-s')){
     await page.waitForFunction(()=>{const p=window.__alignProbe?.state();return p?.live&&!p.offscreen&&!p.pending&&!p.next;},null,{timeout:15000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const png=await page.screenshot();fs.writeFileSync(path.join(out,`${en}-${kind}.png`),png);const{data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});const c=probeCentroids(data,info.width,info.height,{magR:18,magInR:12,cynR:5});const distance=c.mag&&c.cyn?Math.hypot(c.mag.x-c.cyn.x,c.mag.y-c.cyn.y):null;ok(`${en} ${kind} 指北後 GL 與 Canvas 真實像素對齊`,distance!==null&&distance<=2,{distance});
    }
   }
   ok(`${en} ${width} 無水平溢出或執行例外`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&!errors.length,errors);
  }
  await context.close();await browser.close();browser=null;
 }
}catch(e){ok('指北驗收執行',false,e.stack);}finally{if(browser)await browser.close();server.close();}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

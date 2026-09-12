// 台北密集斜視：以同一份已載入圖磚 A/B 舊版，並直接讀 GL 像素驗近景線條。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'output/glass-priority');fs.mkdirSync(out,{recursive:true});
const instrument=s=>s.replace('const parts=','this.auditPicked=[];const parts=').replaceAll('parts.push(b.v);','this.auditPicked.push(b.hash);parts.push(b.v);');
const current=instrument(fs.readFileSync(path.join(root,'night-map.js'),'utf8'));
const old=instrument(execFileSync('git',['show','f08226df:night-map.js'],{cwd:root,encoding:'utf8'}));
const method=s=>'({'+s.slice(s.indexOf('      rebuild() {'),s.indexOf('      render(gl,args)'))+'}).rebuild';
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');
if(u.pathname.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});return res.end('{}');}
if(u.pathname==='/night-map.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(current);}
const p=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile())return res.writeHead(404).end();
res.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`,results=[];
function check(name,pass,data){console.log(pass?'PASS':'FAIL',name,JSON.stringify(data));results.push({name,pass,data});assert(pass,name);}
async function settle(page){await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:60000});await page.waitForFunction(()=>{const l=M.raw.getLayer('building-glass-edges');return (l?.implementation||l)?.buildings>0},null,{timeout:30000});}
async function audit(page,bearing,zoom=18.5,pitch=75){
await page.evaluate(({bearing,zoom,pitch})=>M.raw.jumpTo({center:[121.5164,25.041],zoom,pitch,bearing}),{bearing,zoom,pitch});await settle(page);
return page.evaluate(({baseline})=>{
 const m=M.raw,g=m.getLayer('building-glass-edges').implementation;clearTimeout(g.timer);g.timer=null;
 const fresh=g.rebuild,legacy=(0,eval)(baseline);
 const stats=()=>{const selected=new Set(g.auditPicked),visible=[],all=[];const canvas=m.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;
 for(const list of g.tiles.values())for(const b of list){const [west,south,east,north]=b.bounds,p=m.project([(west+east)/2,(south+north)/2]);if(p.x>=0&&p.x<=w&&p.y>=0&&p.y<=h){const item={key:b.hash,y:p.y,x:p.x,picked:selected.has(b.hash)};visible.push(item);}all.push(b);}
 const unique=[...new Map(visible.map(x=>[x.key,x])).values()],near=unique.filter(x=>x.y>h/2),bottom=unique.sort((a,b)=>b.y-a.y).slice(0,20);
 return {buildings:g.buildings,vertices:g.count,near:near.length,nearPicked:near.filter(x=>x.picked).length,bottom:bottom.length,bottomPicked:bottom.filter(x=>x.picked).length,selected:g.auditPicked};};
 legacy.call(g);const before=stats();const start=performance.now();fresh.call(g);const coldMs=performance.now()-start,after=stats();
 const times=[];for(let i=0;i<5;i++){const t=performance.now();fresh.call(g);times.push(performance.now()-t);}times.sort((a,b)=>a-b);
 const selected=JSON.stringify(g.auditPicked);const q=m.querySourceFeatures;m.querySourceFeatures=function(...args){return q.apply(this,args).reverse();};fresh.call(g);const orderIndependent=selected===JSON.stringify(g.auditPicked);m.querySourceFeatures=q;fresh.call(g);
 return {before:{...before,selected:undefined},after:{...after,selected:undefined},coldMs,warmMedianMs:times[2],orderIndependent};
},{baseline:method(old)});
}
async function pixels(page){return page.evaluate(()=>new Promise(resolve=>{
const m=M.raw,g=m.getLayer('building-glass-edges').implementation,original=g.render;
g.render=function(gl,args){const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);original.call(this,gl,args);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);let changed=0,lower=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12){changed++;if(y<h/2)lower++;}}g.render=original;resolve({changed,lower,width:w,height:h});};m.triggerRepaint();}));}
let browser;
try{for(const [engineName,engine] of Object.entries({chromium,webkit})){
browser=await engine.launch({headless:true});
for(const mobile of [false,true]){
const context=await browser.newContext({viewport:{width:mobile?375:1920,height:mobile?844:1080},isMobile:mobile,hasTouch:mobile,locale:'zh-TW'});
await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'?lang=zh-TW',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__state?.ready&&state.trains.length>0&&M.raw,null,{timeout:60000});
await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();setMap3d(true);document.body.classList.add('fs');M.raw.resize();});
for(const width of mobile?[360,375,390,414,520,768]:[1920]){
await page.setViewportSize({width,height:mobile?844:1080});await page.evaluate(()=>M.raw.resize());
for(const bearing of mobile?[0]:[0,180]){
const a=await audit(page,bearing);const label=`${engineName} ${width}px bearing ${bearing}`;
check(label+' 近景保留、額度與順序',a.after.buildings<=(mobile?700:1600)&&a.after.vertices<=161000&&a.after.bottomPicked===a.after.bottom&&a.orderIndependent,a);
if(!mobile&&bearing===0)check(label+' 舊版漏線確實重現',a.before.bottomPicked<a.after.bottomPicked,a);
const px=await pixels(page);check(label+' 近景實際像素',px.lower>20,px);
}
if(mobile){
for(const full of [false,true]){await page.evaluate(full=>{document.body.classList.toggle('fs',full);M.resize();},full);
await page.tap('#tabMore');await page.locator('#map3dRow').scrollIntoViewIfNeeded();await page.tap('#map3dRow');
const valid=await page.evaluate(()=>{const e=document.getElementById('map3dRow'),r=e.getBoundingClientRect();return {off:!state.map3d,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),overflow:document.documentElement.scrollWidth>innerWidth+1};});
check(`${engineName} ${width}px ${full?'全畫面':'一般'} 真觸控`,valid.off&&valid.hit&&!valid.overflow,valid);await page.tap('#map3dRow');await page.tap('#moreClose');}
if(width===375){const dense=await audit(page,180,17);check(`${engineName} 手機密集市區`,dense.after.buildings===700&&dense.after.bottomPicked===dense.after.bottom&&dense.orderIndependent,dense);}
}
if(width===(mobile?375:1920))await page.screenshot({path:path.join(out,`${engineName}-${width}.png`)});
}
if(!mobile){for(const [zoom,pitch] of [[16,0],[15.4,60]]){const a=await audit(page,90,zoom,pitch);check(`${engineName} 俯視／無樓層線 ${zoom}`,a.after.buildings>0&&a.after.buildings<=1600&&a.orderIndependent,a);}}
check(`${engineName} ${mobile?'手機':'桌面'} 執行例外`,errors.length===0,errors);await context.close();
}
await browser.close();browser=null;
}}finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}

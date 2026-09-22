// 暗色 2.0：真實班次、雙向切換、材質像素、亮色不變與觸控版面。
import {chromium,webkit} from 'playwright';
import sharp from 'sharp';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output/dark20');fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/thsr-schedule'){res.setHeader('content-type','application/json');return fs.createReadStream(path.join(root,'data/thsr_schedule_dense.json')).pipe(res);}return res.writeHead(503).end('{}');}let p=path.resolve(root,'.'+decodeURI(u.pathname));if(!p.startsWith(root+path.sep)&&p!==root)return res.writeHead(404).end();if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('content-type',mime[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
const results=[];function ok(name,pass,detail=''){results.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);}
const setup=()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');};
const board=()=>{const st=state.schedStations.find(s=>s.name.replace(/臺/g,'台')==='台北'&&s.sys==='tra_sched');openBoard(st);};
const boot=async page=>{await page.goto(base+'?lang=zh-TW');await page.waitForFunction(()=>window.__state?.ready&&window.__glTracks?.ready&&state.trains.length>0,null,{timeout:60000});await page.evaluate(()=>{selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(9*3600+60);state.playing=false;});};
function geometry(){
 const panel=document.getElementById('board'), r=panel.getBoundingClientRect();
 const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
 const name=n=>n.id||n.className||n.tagName;
 const boxes=[...document.querySelectorAll('.stage button,.stage input,.stage select,.stage [role=button]')].filter(n=>{const s=getComputedStyle(n),b=n.getBoundingClientRect();return !n.closest('[hidden]')&&s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0&&b.top>=0&&b.bottom<=innerHeight;}).map(n=>({n,b:n.getBoundingClientRect()}));
 const overlap=[];
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];if(a.n.contains(b.n)||b.n.contains(a.n)||!intersects(a.b,b.b))continue;
  // 滾動內容裁切後互不相交；elementFromPoint 判真正可見部分。
  const x=(Math.max(a.b.left,b.b.left)+Math.min(a.b.right,b.b.right))/2,y=(Math.max(a.b.top,b.b.top)+Math.min(a.b.bottom,b.b.bottom))/2;
  const hit=document.elementFromPoint(x,y);if((a.n.contains(hit)||b.n.contains(hit))&&!a.n.closest('.maplibregl-ctrl-attrib')&&!b.n.closest('.maplibregl-ctrl-attrib'))overlap.push([name(a.n),name(b.n)]);
 }
 const controls=[...panel.querySelectorAll('.night-directions button,.night-next,#boardClose,#boardStar')].filter(n=>n.offsetWidth&&n.offsetHeight&&!n.hidden).map(n=>{const b=n.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{id:name(n),w:b.width,h:b.height,hit:n===hit||n.contains(hit),visible:y>=r.top&&y<r.bottom};});
 return {overflow:document.documentElement.scrollWidth>innerWidth+1,panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,h:r.height},controls,overlap};
}
let browser;
try{
 for(const [en,engine]of Object.entries({chromium,webkit})){
  browser=await engine.launch();
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW'});await ctx.addInitScript(setup);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
  await page.evaluate(()=>{M.setView([25.0478,121.5164],17,{animate:false});setMap3d(true);M.raw.setPitch(55);});
  await page.waitForFunction(()=>M.raw.getLayer('building-glass-edges')?.implementation?.count>0||M.raw.getLayer('building-glass-edges')?.count>0,null,{timeout:30000}).catch(()=>{});
  const glass=await page.evaluate(()=>{const g=M.raw.getLayer('building-glass-edges');return{keys:Object.keys(g||{}),count:g?.implementation?.count??g?.count,alpha:M.raw.getPaintProperty('building-3d','fill-extrusion-opacity'),color:M.raw.getPaintProperty('building-3d','fill-extrusion-color'),source:M.raw.getLayer('building-3d').source};});
  ok(en+' 透明藍色建築使用原始建築資料',glass.alpha===.30&&glass.color==='#638BC5'&&glass.source==='openmaptiles',glass);
  ok(en+' 屋頂與樓層線確實產生頂點',glass.count>0&&glass.count<=161000,glass);
  const order=await page.evaluate(()=>{const ids=M.raw.getLayersOrder();return {glass:ids.indexOf('building-glass-edges'),track:ids.indexOf('track-glow'),labels:ids.filter(id=>M.raw.getLayer(id).type==='symbol').map(id=>ids.indexOf(id))};});
  ok(en+' 玻璃細線在所有軌道與站名之下',order.glass>=0&&order.glass<order.track&&order.labels.every(i=>i>order.glass),order);
  // 凍結其他移動層，將細線層 draw count 歸零作像素 A/B，避免只驗樣式參數。
  await page.evaluate(()=>{document.getElementById('overlay').style.visibility='hidden';M.raw.setPaintProperty('building-3d','fill-extrusion-opacity-transition',{duration:0});});
  async function shot(){await page.waitForTimeout(300);return sharp(await page.screenshot({clip:{x:100,y:250,width:500,height:400}})).raw().toBuffer();}
  const on=await shot();await page.screenshot({path:path.join(out,en+'-glass.png')});
  await page.evaluate(()=>{const g=M.raw.getLayer('building-glass-edges'),impl=g.implementation||g;impl.savedCount=impl.count;impl.count=0;M.raw.triggerRepaint();});
  const off=await shot();let changed=0;for(let i=0;i<on.length;i++)if(on[i]-off[i]>5)changed++;
  ok(en+' 玻璃細線有實際像素輸出',changed>120,changed);
  await page.evaluate(()=>{const g=M.raw.getLayer('building-glass-edges'),impl=g.implementation||g;impl.count=impl.savedCount;document.getElementById('overlay').style.visibility='';});
  await page.evaluate(board);await page.evaluate(()=>M.setView([25.047,121.517],13,{animate:false}));
  for(const direction of ['南下','北上']){
   await page.getByRole('button',{name:direction,exact:true}).click();
   const match=await page.evaluate(()=>{const h=document.querySelector('.night-next'),r=[...document.querySelectorAll('#board > .row')].find(x=>!x.classList.contains('night-group-hidden')&&!x.classList.contains('off'));return{hero:h?.querySelector('.night-next-detail')?.textContent,no:r?.querySelector('b')?.textContent,active:document.querySelector('.night-directions [aria-pressed=true]')?.textContent,visibleGroups:[...document.querySelectorAll('#board .bgrp')].filter(n=>getComputedStyle(n).display!=='none').length};});
   ok(en+' '+direction+' 大字卡與同方向首班一致',match.active===direction&&match.hero?.includes(match.no)&&match.visibleGroups===1,match);
  }
  await page.evaluate(()=>renderBoard());ok(en+' 重繪保留方向',await page.locator('.night-directions [aria-pressed=true]').innerText()==='北上');
  await page.screenshot({path:path.join(out,en+'-board.png')});
  for(const mode of ['deco','freq']) {
   await page.evaluate(async mode=>{if(mode==='freq')selectGroup(GROUPS.find(g=>g.id==='metro'));setSimSec(9*3600+60);state.playing=false;const lines=mode==='deco'?state.decoLines:state.lines;const ln=lines.find(l=>l._sys==='mrt'&&l.stations.some(s=>s.name==='中山'));const st={...ln.stations.find(s=>s.name==='中山'),sys:mode,metroSysId:'mrt'};openBoard(st);},mode);
   const tabs=page.locator('.night-directions button');const count=await tabs.count();ok(en+' '+mode+' 捷運方向頁籤',count>=2,count);
   for(let i=0;i<Math.min(count,2);i++){await tabs.nth(i).click();const good=await page.evaluate(()=>{const h=document.querySelector('.night-next-detail')?.textContent;const r=[...document.querySelectorAll('#board > .row')].find(r=>!r.classList.contains('night-group-hidden'));return h&&h.includes(r.querySelector('b').textContent);});ok(en+' '+mode+' 方向 '+i+' 下一班沿用實際列',good);}
  }
  await page.evaluate(async()=>{await selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(9*3600+60);});await page.evaluate(board);
  await page.evaluate(()=>state._setAppearance('light'));
  const light=await page.evaluate(()=>({hero:getComputedStyle(document.querySelector('.night-next')||document.createElement('div')).display,boardWidth:getComputedStyle(document.getElementById('board')).width,alpha:M.raw.getLayer('building-3d')&&M.raw.getPaintProperty('building-3d','fill-extrusion-opacity'),rows:[...document.querySelectorAll('#board .bgrp')].filter(n=>getComputedStyle(n).display!=='none').length}));
  ok(en+' 切亮色恢復原看板寬與完整方向',light.boardWidth==='360px'&&light.rows>=2,light);
  await page.waitForFunction(()=>M.raw.getLayer('track-glow')&&M.raw.getPaintProperty('track-glow','line-opacity')===0&&M.raw.getPaintProperty('track-casing-'+glTracks.ranks[0],'line-opacity')===1);
  ok(en+' 亮色無霓虹',await page.evaluate(()=>M.raw.getPaintProperty('track-glow-inner','line-opacity')===0&&M.raw.getPaintProperty('track-casing-'+glTracks.ranks[0],'line-opacity')===1));
  await page.evaluate(()=>state._setAppearance('dark'));
  await page.waitForFunction(()=>M.raw.getLayer('building-glass-edges'));
  ok(en+' 主題切換重建玻璃層',await page.evaluate(()=>M.raw.getPaintProperty('building-3d','fill-extrusion-opacity')===.3));
  ok(en+' 無執行例外',errors.length===0,errors);await ctx.close();
  // 手機使用真觸控。面板／全畫面／橫幅／抽屜組合逐一掃描；所有可見互動元件做兩兩相交。
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-TW'});await mobile.addInitScript(setup);
  const touch=await mobile.newPage();await boot(touch);
  for(const width of [360,375,390,414,540,768,900]){
   await touch.setViewportSize({width,height:900});
   for(const fsMode of [true]){
    await touch.evaluate(fsMode=>{if(!document.body.classList.contains('fs'))throw new Error('手機殼應自動全畫面');M.raw.resize();closeBoard();},fsMode);await touch.evaluate(board);await touch.waitForTimeout(120);
    const geo=await touch.evaluate(geometry);
    ok(en+` ${width}/${fsMode?'全畫面':'一般'} 無溢出`,!geo.overflow&&geo.panel.left>=0&&geo.panel.right<=width+1&&geo.panel.bottom<=900,geo.panel);
    ok(en+` ${width}/${fsMode?'全畫面':'一般'} 新控件可觸達`,geo.controls.filter(c=>c.id!=='night-next').every(c=>c.hit&&c.visible),geo.controls);
    ok(en+` ${width}/${fsMode?'全畫面':'一般'} 互動元件不重疊`,geo.overlap.length===0,geo.overlap);
    await touch.tap('.night-directions button:last-child');ok(en+` ${width}/${fsMode?'全畫面':'一般'} 真觸控方向切換`,await touch.locator('.night-directions [aria-pressed=true]').innerText()==='北上');
   }
   await touch.tap('#tabMore');ok(en+' '+width+' 抽屜開啟',await touch.evaluate(()=>document.body.classList.contains('tools-open')));await touch.tap('#moreClose');ok(en+' '+width+' 抽屜關閉後仍可讀站板',await touch.locator('.night-directions button').first().isVisible());
   if([375,768].includes(width))await touch.screenshot({path:path.join(out,en+'-mobile-'+width+'.png')});
  }
  await touch.setViewportSize({width:390,height:844});await touch.evaluate(board);
  for(const scale of ['large','xlarge']){await touch.evaluate(scale=>{document.documentElement.dataset.fs=scale;renderBoard();},scale);const g=await touch.evaluate(geometry);ok(en+' '+scale+' 無水平溢出與可關閉',!g.overflow&&g.controls.find(x=>x.id==='boardClose')?.hit,g.controls);}
  await touch.evaluate(()=>{document.documentElement.removeAttribute('data-fs');renderBoard();});

  await touch.tap('.night-next');
  ok(en+' 點大字卡仍跟隨真實班次',await touch.evaluate(()=>!!state.followTrain));
  await mobile.close();await browser.close();browser=null;
 }
}catch(e){ok('驗收執行',false,e.stack);}finally{if(browser)await browser.close();server.close();}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));if(results.some(x=>!x.pass))process.exitCode=1;

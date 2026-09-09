import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const out='output/sunlight-preview';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
for(const [name,engine] of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:({chromium,webkit})[process.env.ENGINE]}:{chromium,webkit})){
 const b=await engine.launch();
 const ctx=await b.newContext({viewport:{width:360,height:1000},locale:'zh-TW',isMobile:true,hasTouch:true});const page=await ctx.newPage();await page.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));await ctx.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await page.goto('http://127.0.0.1:5236/sunlight-preview.html');await page.waitForFunction(()=>!document.querySelector('[data-hour]').disabled,null,{timeout:90000});const f=page.frames()[1];
 for(const width of (process.env.WIDTHS||'360,375,390,414,520,768,1280').split(',').map(Number)){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);
  try{
   check(`${name} ${width} 預覽真正開啟起伏`,await f.evaluate(()=>M.getStyleKind()==='landscape'&&M.raw.getTerrain()?.exaggeration===1&&Number.isFinite(M.raw.queryTerrainElevation(M.raw.getCenter()))));
   for(const hour of (width===360?[6,12,0,18]:[18])){await page.tap(`[data-hour="${hour}"]`);const r=await f.evaluate(()=>({time:state.simSec,pitch:M.getPitch(),shade:M.raw.getPaintProperty('landscape-hillshade','hillshade-illumination-direction'),az:sunlight.current.azimuth}));if(r.time!==hour*3600||r.pitch!==75||Math.abs(r.shade-r.az)>.001)throw Error(JSON.stringify(r));}
   check(`${name} ${width} 時段按鈕真觸控`,true);
   for(const scene of (width===360?['city','mountains','tainan']:['tainan'])){await page.tap(`[data-scene="${scene}"]`);await page.waitForFunction(()=>!document.querySelector('[data-hour]').disabled);const r=await f.evaluate(()=>({time:state.simSec,terrain:!!M.raw.getTerrain(),center:M.raw.getCenter()}));check(`${name} ${width} 切換${scene==='city'?'平坦':'起伏'}且保留時間`,r.time===64800&&r.terrain===(scene!=='city'),r);}
   const scan=await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')],miss=[],overlap=[];for(const b of buttons){const r=b.getBoundingClientRect();if(r.height<44||!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))miss.push(b.textContent);for(const other of buttons){if(b===other)continue;const q=other.getBoundingClientRect();if(Math.min(q.right,r.right)-Math.max(q.left,r.left)>1&&Math.min(q.bottom,r.bottom)-Math.max(q.top,r.top)>1)overlap.push([b.textContent,other.textContent]);}}const frame=document.querySelector('iframe').getBoundingClientRect();return {miss,overlap,overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1,frameInside:frame.bottom<=innerHeight+1&&frame.height>400&&frame.top>=document.querySelector('header').getBoundingClientRect().bottom};});
   check(`${name} ${width} 全控件可點／無重疊／無溢出`,!scan.miss.length&&!scan.overlap.length&&!scan.overflow&&scan.frameInside,scan);
   if([360,1280].includes(width))await page.screenshot({path:`${out}/${name}-${width}.png`});
  }catch(e){check(`${name} ${width} 預覽流程`,false,String(e.stack));}
 }
 await b.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

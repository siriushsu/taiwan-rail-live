// 實際正式頁載入兩款新資產，驗證手機近看、照片來源與藍皮兩方向的行車模型。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base=process.env.BASE_URL||'http://127.0.0.1:5226/';
const out=process.env.BLUE_QA_OUT||'output/blue-release';fs.mkdirSync(out,{recursive:true});
const result=[];const check=(name,pass,detail)=>{result.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail?JSON.stringify(detail):'');};
const meta=Object.fromEntries(['blue','bluecoach'].map(id=>[id,JSON.parse(fs.readFileSync(`rail-3d/assets/garage-blender-v1/${id}.json`))]));
const manifest=JSON.parse(fs.readFileSync('rail-3d/assets/blender-map-v1/manifest.json'));
const style={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9ede5'}}]};
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 try{
  for(const width of [1280,360,375,390,414,768]){
   const ctx=await browser.newContext({viewport:{width,height:950},locale:'zh-TW',isMobile:width<1000,hasTouch:true});
   await ctx.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');});
   await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({contentType:'application/json',body:JSON.stringify(style)});return r.abort();});
   const page=await ctx.newPage(),errors=[],seen=new Map();page.on('pageerror',e=>errors.push(e.message));
   page.on('response',async r=>{if(/blender-map-v1\/blue(?:coach)?\.bin$/.test(new URL(r.url()).pathname)&&r.ok()){try{seen.set(new URL(r.url()).pathname.split('/').at(-1),createHash('sha256').update(await r.body()).digest('hex'));}catch{}}});
   await page.goto(base+'?lang=zh-TW&g=all');await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.trains.length>0,null,{timeout:60000});
   await page.evaluate(()=>{saveRides(Array.from({length:100},(_,i)=>({train:String(i),date:'2026-09-08',km:100,sys:'tra_sched'})));openTrainGarage();});
   for(const id of ['blue','bluecoach']){
    const card=page.locator(`.g-car[data-model="${id}"]`);await card.scrollIntoViewIfNeeded();await card.tap();
    await page.waitForFunction(id=>document.querySelector('.g-view')?.dataset.rendered===id,id);
    await page.locator('.g-showcase').scrollIntoViewIfNeeded();
    const look=await page.evaluate(()=>{const c=document.querySelector('.g-view'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0,left=c.width,right=-1,top=c.height,bottom=-1,hash=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i+3]){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);hash=(hash*31+d[i]+d[i+1]*3+d[i+2]*7)>>>0;}}return{count,left,right,top,bottom,w:c.width,h:c.height,hash,vertices:Number(c.dataset.vertices),lock:c.dataset.lock,overflow:document.documentElement.scrollWidth>innerWidth};});
    check(`${engine} ${width} ${id} 新網格全貌及塗裝`,look.vertices===meta[id].mesh.vertexCount&&look.lock==='off'&&look.count>500&&look.left>1&&look.top>1&&look.right<look.w-2&&look.bottom<look.h-2&&!look.overflow,look);
    await page.locator('.g-right').tap();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(width===375||width===1280)await page.screenshot({path:`${out}/${engine}-${width}-${id}.png`});
    await page.locator('.g-sources summary').scrollIntoViewIfNeeded();if(!await page.locator('.g-sources').evaluate(e=>e.open))await page.locator('.g-sources summary').tap();
    const sources=await page.locator('.g-source-body a').evaluateAll(es=>es.map(e=>e.href));
    check(`${engine} ${width} ${id} 新來源`,sources.some(s=>id==='blue'?s.includes('commons.wikimedia.org/wiki/File:'):s.includes('2023/09/blog-post_97')));
   }
   await page.locator('.g-close').tap();
   if(width===1280){
    for(const no of ['5898','5899']){
     const chosen=await page.evaluate(no=>{const tr=state.trains.find(t=>String(t.train)===no&&t.sys==='tra_sched');if(!tr)return null;const sec=tr.stops[0].depSec+300;state.playing=false;setSimSec(sec);followTrainNo(no,{sys:'tra_sched'});railIslandIntegration.setMode(true);railIslandIntegration.setGroundMode('flat');M.raw.setZoom(18);M.raw.setPitch(55);return{no,sec,from:tr.stops[0].name,to:tr.stops.at(-1).name};},no);
     await page.waitForFunction(no=>{const api=window.railIslandIntegration,v=api?.capture().vehicles.find(v=>v.followed&&v.publicLabel===no);return !!v&&api.renderer?.stats.poseSamples.some(p=>p.id===v.id&&p.carCount===3);},no,{timeout:45000});
     const pose=await page.evaluate(()=>{const api=railIslandIntegration,v=api.capture().vehicles.find(v=>v.followed);const p=api.renderer.stats.poseSamples.find(p=>p.id===v.id);return{id:v.id,named:v.namedId,label:v.publicLabel,cars:p.carCount,coordinate:p.coordinate,errors:[...api.errors,...api.renderer.stats.errors]};});
     check(`${engine} ${no} 雙向實際班次載入藍皮短編組`,pose.named==='blue-train'&&pose.label===no&&pose.cars===3&&pose.errors.length===0,{...chosen,...pose});
     await page.screenshot({path:`${out}/${engine}-map-${no}.png`});
    }
    for(const id of ['blue','bluecoach'])check(`${engine} 地圖 ${id} 實際下載新版雜湊`,seen.get(id+'.bin')===manifest.meshes[id].sha256,{sha256:seen.get(id+'.bin')});
   }
   check(`${engine} ${width} 無頁面例外`,errors.length===0,errors);await ctx.close();
  }
 }catch(e){check(engine+' 執行完成',false,e.stack);}finally{await browser.close();}
}
fs.writeFileSync(out+'/report.json',JSON.stringify({base,result},null,2)+'\n');
console.log(`${result.filter(r=>r.pass).length}/${result.length} 通過`);if(result.some(r=>!r.pass))process.exitCode=1;

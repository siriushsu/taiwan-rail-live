import {chromium,webkit} from 'playwright';import sharp from 'sharp';import fs from 'node:fs';
// 透明建築與地表道路同框，量測真正列車像素；不以圖層順序自洽取代渲染驗證。
const results=[],out='output/road-occlusion';fs.mkdirSync(out,{recursive:true});
const base=process.env.BASE_URL||'http://127.0.0.1:5208/';
for(const [name,engine] of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const browser=await engine.launch();const page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-TW'});await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
 try{
 await page.goto(base+'?scene=3d&g=all&train=117&t=12:00&lang=zh-TW');await page.waitForFunction(()=>window.railIslandIntegration?.renderer&&state.followTrain,null,{timeout:60000});await page.evaluate(()=>{state.playing=false;setSimSec(43200);railIslandIntegration.setFormationMode('three');M.raw.setZoom(18);M.raw.setPitch(55);M.raw.fire('rotatestart',{originalEvent:{}});M.raw.setBearing(0);});await page.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.poseSamples.some(p=>p.carCount===3));await page.waitForTimeout(800);
 const clip=await page.evaluate(()=>{const r=railIslandIntegration.renderer,car=r.projectedCars().find(c=>c.index===1),el=M.getContainer().getBoundingClientRect(),b=car.bounds;return {left:Math.floor(el.left+b.left)-2,top:Math.floor(el.top+b.top)-2,width:Math.ceil(b.right-b.left)+4,height:Math.ceil(b.bottom-b.top)+4};});
 const count=async label=>{await page.waitForTimeout(350);const file=out+'/'+name+'-'+label+'.png';await page.screenshot({path:file});const {data}=await sharp(file).extract(clip).removeAlpha().raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=3)if(data[i]>160&&data[i+1]>160&&data[i+2]>160)n++;return n;};
 const clear=await count('clear');
 await page.evaluate(()=>{const [x,y]=railIslandIntegration.renderer.stats.poseSamples[0].cars[1].coordinate,dx=.0005,dy=.00035;window.qaPoly={type:'Feature',geometry:{type:'Polygon',coordinates:[[[x-dx,y-dy],[x+dx,y-dy],[x+dx,y+dy],[x-dx,y+dy],[x-dx,y-dy]]]},properties:{}};M.raw.addSource('qa-blocker',{type:'geojson',data:qaPoly});M.raw.addLayer({id:'qa-blocker',type:'fill-extrusion',source:'qa-blocker',paint:{'fill-extrusion-height':20,'fill-extrusion-color':'#254872','fill-extrusion-opacity':.24}},'building-3d');});await page.waitForFunction(()=>M.raw.isSourceLoaded('qa-blocker'));const glass=await count('glass');
 await page.evaluate(()=>{M.raw.addSource('qa-road',{type:'geojson',data:qaPoly});M.raw.addLayer({id:'qa-road',type:'fill',source:'qa-road',paint:{'fill-color':'#243249','fill-opacity':1}},'track-glow');railIslandIntegration.syncLayerOrder?.();});await page.waitForFunction(()=>M.raw.isSourceLoaded('qa-road'));const roadGlass=await count('road-glass');
 await page.evaluate(()=>M.raw.setPaintProperty('qa-blocker','fill-extrusion-opacity',1));const opaque=await count('road-opaque');
 await page.evaluate(()=>M.raw.setLayoutProperty('qa-blocker','visibility','none'));const outside=await count('road-outside');
 const pass=clear>20&&glass>clear*.4&&roadGlass>glass*.75&&opaque<roadGlass*.4&&outside>clear*.8;
 results.push({name,pass,clear,glass,roadGlass,opaque,outside});console.log(results.at(-1));
 }catch(e){results.push({name,pass:false,error:String(e)});console.log(results.at(-1));}await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

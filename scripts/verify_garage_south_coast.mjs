import {chromium,webkit} from 'playwright';
import {panChecks} from './lib/garage_pan_checks.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const OUT='output/south-coast',URL='http://127.0.0.1:5251/prototypes/garage-south-coast/';mkdirSync(OUT,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));}
const state=p=>p.evaluate(()=>southCoastPreview.state);
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const p=await b.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,isMobile:true,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(URL);await p.waitForFunction(()=>window.southCoastPreview?.state.ready,null,{timeout:90000});await p.tap('#play');await settle(p);await p.evaluate(()=>southCoastPreview.setDistance(0));
  check(engine+' 藍皮與兩節客車',JSON.stringify((await state(p)).poses.map(c=>c.id))===JSON.stringify(['blue','bluecoach','bluecoach']));
  const pixel=await p.evaluate(async()=>{
   const api=southCoastPreview,c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');
   const read=async()=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
   api.trainVisible(false);const empty=await read();api.trainVisible(true);const full=await read();
   const cars=api.state.bounds.map(b=>{let n=0,changed=0;for(let y=Math.max(0,Math.floor(b.top));y<Math.min(c.height,b.bottom);y++)for(let x=Math.max(0,Math.floor(b.left));x<Math.min(c.width,b.right);x++){const i=(y*c.width+x)*4;n++;if(Math.abs(full[i]-empty[i])+Math.abs(full[i+1]-empty[i+1])+Math.abs(full[i+2]-empty[i+2])>25)changed++;}return{n,changed};});
   const point=api.project([-4,-14,-.61]),i=(Math.round(point.y)*c.width+Math.round(point.x))*4;return{cars,water:[full[i],full[i+1],full[i+2]]};
  });check(engine+' 三節車體實際像素與海面',pixel.cars.every(c=>c.changed>30)&&pixel.water[2]>pixel.water[0]+10,pixel);
  // 09-28 站房精修第二版新增：窗框/玻璃改用 Blender 真挖洞設計後，「玻璃會不會被窗框整片擋住」這件事
  // 已經在幾何層級不可能發生（見 verify_garage_south_coast_stop.mjs 檔頭理由 2），改成量這條唯一真正
  // 還需要驗的事——夜間 emissiveIntensity 切到 1.2 是否真的讓玻璃像素變亮，不是只讀 state.period
  // 字串。取樣點用中間那扇窗（world [-4.4,-2.05,1.05]，跟 south-coast.js 的 WX[1]/WY/WZ 同一個點，
  // 剛好是窗框洞口＋玻璃共用的擺放中心），沿用本檔案已有的 canvas.toDataURL()+getImageData 讀像素模式
  // （跟上面「三節車體實際像素」同一套手法，不是另外發明的量測方式）。
  const glowSamples={};
  for(const period of ['day','sunset','night']){await p.tap('button[data-period="'+period+'"]');await settle(p);await p.screenshot({path:`${OUT}/${engine}-${period}.png`});check(engine+' '+period+' 切換', (await state(p)).period===period);
   if(period==='day'||period==='night')glowSamples[period]=await p.evaluate(async()=>{
    const api=southCoastPreview,c=document.querySelector('#scene'),pt=api.project([-4.4,-2.05,1.05]);
    const out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');
    const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);
    const x=Math.max(0,Math.min(c.width-5,Math.round(pt.x)-2)),y=Math.max(0,Math.min(c.height-5,Math.round(pt.y)-2));
    const d=ctx.getImageData(x,y,5,5).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}return{r:r/n,g:g/n,b:b/n};
   });
  }
  const dayBright=glowSamples.day.r+glowSamples.day.g+glowSamples.day.b,nightBright=glowSamples.night.r+glowSamples.night.g+glowSamples.night.b;
  check(engine+' 南迴-站房 夜間窗玻璃像素確實比白天亮（採樣中間那扇窗中心 5×5，評審判準：夜晚窗玻璃的像素確實發光）',nightBright>dayBright+40,{day:glowSamples.day,night:glowSamples.night,dayBright,nightBright});
  await p.tap('button[data-period="day"]');await p.tap('[data-view="train"]');await settle(p);check(engine+' 跟車三節完整構圖',await p.evaluate(()=>{const c=document.querySelector('#scene');return southCoastPreview.state.bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);}));await p.screenshot({path:`${OUT}/${engine}-follow.png`});
  check(engine+' 環線沒有倒退入口',await p.locator('#reverse').count()===0);
  const before=await state(p);await p.tap('#play');
  // 本景會在小站停靠（Part A）：setDistance(0) 剛好落在停站起點，最長需等 brake+dwell+accel（timetable.phases.cruiseAt）
  // 這麼多「模擬秒」才會再次前進，不能沿用「車永不停」年代的預設 30s timeout。另外實測這台機器目前
  // 用預設 headless（無 channel，SwiftShader 軟體算繪）跑本頁時，模擬時間／真實時間比值遠低於 1
  // （量到約 0.26~0.32，即時鐘只用真實時間的三分之一不到），這個比值在 before（無棕櫚）就已經很低，
  // 棕櫚只是再疊加了一點，不是主因；真實等待時間要用這個比值換算，用一個保守的下界。
  const tphases=await p.evaluate(()=>southCoastPreview.timetable.phases);
  await p.waitForFunction(d=>southCoastPreview.state.distance>d+.4,before.distance,{timeout:Math.ceil(tphases.cruiseAt*1000/0.2)+20000});
  await p.tap('#play');await settle(p);const after=await state(p);check(engine+' 環線固定向前且車廂不瞬移',after.distance>before.distance&&after.poses.every((c,i)=>Math.hypot(c.x-before.poses[i].x,c.y-before.poses[i].y)<3));
  await p.evaluate(()=>southCoastPreview.setDistance(34));await p.tap('#reset');await settle(p);check(engine+' 彎道仍三節且無非有限座標',(await state(p)).poses.every(c=>[c.x,c.y,c.heading].every(Number.isFinite)));await p.screenshot({path:`${OUT}/${engine}-curve.png`});
  await panChecks({b,engine,URL,api:'southCoastPreview',check,settle,trainTarget:c=>[c[0],c[1],1.4]});   // 鏡頭平移（四頁共用的判準，在自己開的桌面頁與觸控頁上量）
  await p.evaluate(()=>southCoastPreview.setDistance(28));await p.tap('#play');
  const turn=await p.evaluate(()=>new Promise(resolve=>{const samples=[],start=performance.now(),distance=southCoastPreview.state.distance;function sample(now){samples.push(southCoastPreview.state.cameraYaw);if(southCoastPreview.state.distance-distance<1&&now-start<10000)requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);}));
  await p.tap('#play');await settle(p);
  const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  check(engine+' 彎道行駛鏡頭持續旋轉且無跳轉',angle(turn.at(-1),turn[0])>.08&&turn.slice(1).every((a,i)=>angle(a,turn[i])<.1),{rotation:angle(turn.at(-1),turn[0]),maxStep:Math.max(...turn.slice(1).map((a,i)=>angle(a,turn[i])))});
  await p.tap('[data-view="world"]');await p.evaluate(()=>southCoastPreview.setDistance(0));
  for(const width of [360,375,390,414,520,768,1280]){
   await p.setViewportSize({width,height:width>800?900:900});await settle(p);await p.tap('#in');await p.tap('#out');await p.tap('#reset');await settle(p);
   const ui=await p.evaluate(()=>{const els=[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length),r=e=>e.getBoundingClientRect(),bad=[],overlap=[];for(const e of els){const b=r(e),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!e.contains(hit)||b.width<43||b.height<43)bad.push(e.textContent);}for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=r(els[i]),b=r(els[j]);if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([els[i].textContent,els[j].textContent]);}return{bad,overlap,overflow:document.documentElement.scrollWidth>innerWidth};});check(engine+' '+width+' 真觸控／控件可及／無重疊溢出',!ui.bad.length&&!ui.overlap.length&&!ui.overflow,ui);
   if([360,768,1280].includes(width))await p.screenshot({path:`${OUT}/${engine}-${width}.png`,fullPage:true});
  }
  const mem=(await state(p)).memory;for(let i=0;i<3;i++){await p.tap('[data-view="train"]');await p.tap('button[data-period="night"]');await p.tap('[data-view="world"]');await p.tap('button[data-period="day"]');}await settle(p);check(engine+' 換景不累積幾何／貼圖',JSON.stringify(mem)===JSON.stringify((await state(p)).memory),{before:mem,after:(await state(p)).memory});
  const d=(await state(p)).draws;await p.waitForTimeout(250);check(engine+' 暫停後停止繪製',(await state(p)).draws===d);check(engine+' 無 JS／WebGL 錯誤',errors.length===0,errors);
  await p.close();const reduce=await b.newPage({viewport:{width:375,height:900},reducedMotion:'reduce'});await reduce.goto(URL);await reduce.waitForFunction(()=>window.southCoastPreview?.state.ready,null,{timeout:90000});check(engine+' 減少動態預設不行駛',!(await state(reduce)).running);await reduce.evaluate(()=>southCoastPreview.setDistance(0));check(engine+' 手機預設跟車且三節完整',await reduce.evaluate(()=>{const c=document.querySelector('#scene'),s=southCoastPreview.state;return s.view==='train'&&s.bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);}));await reduce.screenshot({path:`${OUT}/${engine}-mobile-entry.png`,fullPage:true});await reduce.close();
 }catch(e){check(engine+' 驗證流程',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

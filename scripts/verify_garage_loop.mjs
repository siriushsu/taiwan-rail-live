// 用真實 WebGL 畫完整閉合路徑；另由 UI 驗收行駛、反向、跨場景與手機觸控。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-loop';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const ready=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
async function boot(b,width=1280,height=940,lang='zh-TW',reducedMotion='no-preference'){
 const c=await b.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000,locale:lang,reducedMotion}),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
 await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');window.__garageFrames=0;const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...a){if(this.canvas.classList.contains('g-view'))__garageFrames++;return draw.apply(this,a);};});
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
 await p.goto(BASE+'?garage=demo&lang='+lang);await ready(p);return{c,p,errors};
}
const snap=p=>p.locator('.g-view').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0,count=0;for(let i=0;i<d.length;i+=4)if(d[i+3]){count++;hash=(hash*31+d[i]*3+d[i+1]*5+d[i+2]*7)>>>0;}return{...c.dataset,poses:JSON.parse(c.dataset.poses||'[]'),hash,count,frames:__garageFrames,width:c.width,height:c.height};});
const pause=async p=>{if(await p.locator('.g-auto').getAttribute('aria-pressed')==='true')await p.click('.g-auto');await settle(p);};
const audit=p=>p.evaluate(()=>{
 const d=document.getElementById('trainGarage'),failures=[],els=[...d.querySelectorAll('button,select,summary,a')].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.width&&r.height&&r.top>=70&&r.bottom<=innerHeight;});
 for(const e of els){const r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))failures.push('hit:'+e.className);if(r.height<43.5)failures.push('target:'+e.className);if(r.left<0||r.right>innerWidth+.5)failures.push('edge:'+e.className);}
 for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){if(els[i].contains(els[j])||els[j].contains(els[i]))continue;const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)failures.push('overlap:'+els[i].className+'/'+els[j].className);}
 for(const e of document.querySelectorAll('button,a,input,select,[role="button"]')){if(d.contains(e)||!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.width&&r.height&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))failures.push('background:'+e.id);}
 return{failures,overflow:d.scrollWidth>innerWidth||document.documentElement.scrollWidth>innerWidth};
});
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const {c,p,errors}=await boot(b),original=await p.evaluate(()=>JSON.stringify({rides:loadRides(),checkins:loadCheckins()}));
  await p.click('[data-view="loop"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='loop');const start=await snap(p);await p.waitForTimeout(1500);await pause(p);const moved=await snap(p);
  check(engine+' UI 三節車確實沿環形向前行駛',moved.carCount==='3'&&+moved.distance>+start.distance+1&&moved.hash!==start.hash&&moved.poses.some((v,i)=>Math.hypot(v.x-start.poses[i].x,v.y-start.poses[i].y)>.8));
  await p.waitForTimeout(200);const still=await snap(p);check(engine+' 暫停停止位置及重畫',still.distance===moved.distance&&still.hash===moved.hash&&still.frames===moved.frames);
  await p.click('.g-reverse');await settle(p);const reversed=await snap(p);check(engine+' 反向不瞬移三節車，只轉車身朝向',reversed.poses.every((v,i)=>Math.hypot(v.x-still.poses[i].x,v.y-still.poses[i].y)<1e-8&&Math.abs(Math.abs(v.heading-still.poses[i].heading)-Math.PI)<1e-8)&&reversed.hash!==still.hash);
  await p.click('.g-auto');await p.waitForTimeout(1200);await pause(p);check(engine+' 逆向沿同一閉合跑道行駛',+(await snap(p)).distance<+reversed.distance-1);
  const before=await snap(p);for(let i=0;i<12;i++)await p.click('.g-right');await settle(p);const rotated=await snap(p);check(engine+' 視角可以環繞完整一圈',Math.abs(+rotated.yaw-+before.yaw-Math.PI*2)<1e-8);
  for(let i=0;i<6;i++)await p.click('.g-up');await settle(p);const high=await snap(p);for(let i=0;i<8;i++)await p.click('.g-down');await settle(p);check(engine+' 俯仰範圍保護地面且可俯視',+high.elevation===1.35&&+(await snap(p)).elevation===.25);
  await p.click('.g-reset-view');await settle(p);check(engine+' 重設回環形場景起始視角',(await snap(p)).yaw==='-0.9'&&(await snap(p)).elevation==='0.8');
  await p.screenshot({path:OUT+'/'+engine+'-desktop.png'});
  await p.click('[data-view="track"]');await ready(p);await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='track');await pause(p);const coast=await snap(p);
  check(engine+' 海岸保存為三節直線且可切回',coast.projection==='perspective'&&coast.carCount==='3'&&coast.count===coast.width*coast.height);
  await p.click('[data-view="loop"]');await ready(p);await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='loop');await pause(p);check(engine+' 海岸返回跑道沒有留下天空覆蓋',(await snap(p)).count<(await snap(p)).width*(await snap(p)).height*.85);
  await p.click('[data-view="model"]');await ready(p);check(engine+' 近看維持單車',(await snap(p)).carCount==='1');check(engine+' 場景切換不寫入護照',await p.evaluate(()=>JSON.stringify({rides:loadRides(),checkins:loadCheckins()}))===original);
  // 同一正式 renderer 在真實 canvas 掃過所有彎道與視角，檢查實際像素與閉合接縫。
  const sweep=await p.evaluate(async()=>{
   const {createRenderer}=await import('/rail-3d/garage-renderer.js'),{createLoop}=await import('/rail-3d/garage-loop.js');const r=createRenderer(),loop=createLoop(),canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:720px;height:420px';document.getElementById('trainGarage').append(canvas);
   const failures=[],hashes=new Set();let maxJump=0,maxAxleError=0,curved=0;
   function draw(id,s,d,yaw=-.9,pitch=.8){r.draw(canvas,{id,owned:true},yaw,{mode:'loop',distance:s,direction:d,elevation:pitch});return JSON.parse(canvas.dataset.poses);}
   for(const id of ['e200','emu3000','700t','danhai']){
    await r.load(id,'loop');
    for(const direction of [1,-1]){
     const a=draw(id,-.001,direction),z=draw(id,loop.length+.001,direction);maxJump=Math.max(maxJump,...a.map((v,i)=>Math.hypot(v.x-z[i].x,v.y-z[i].y)));
     for(let i=0;i<48;i++){
      const s=i/48*loop.length,poses=draw(id,s,direction);if(Math.abs(Math.sin(poses[0].heading-poses[1].heading))>.1)curved++;
      for(const v of poses)for(const sign of [-1,1]){const x=v.x+sign*Math.cos(v.heading)*v.length*.30,y=v.y+sign*Math.sin(v.heading)*v.length*.30;const error=Math.abs(Math.hypot(Math.max(Math.abs(x)-loop.half,0),y)-loop.radius);maxAxleError=Math.max(maxAxleError,error);}
      if(i%12===0){const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let hash=0;for(let k=0;k<pixels.length;k+=4)hash=(hash*31+pixels[k]*3+pixels[k+1]*5+pixels[k+2]*7)>>>0;hashes.add(hash);}
     }
    }
   }
   await r.load('e200','loop');
   for(const pitch of [.25,.8,1.35])for(let i=0;i<12;i++){
    draw('e200',loop.length*.28,1,i*Math.PI/6,pitch);const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0,edge=0;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(d[(y*canvas.width+x)*4+3]){count++;if(x<2||y<2||x>=canvas.width-2||y>=canvas.height-2)edge++;}
    if(count<5000||edge)failures.push({pitch,i,count,edge});
   }
   r.dispose();loop.dispose();canvas.remove();return{failures,maxJump,maxAxleError,curved,hashes:hashes.size};
  });
  check(engine+' 四種編組雙向閉合接縫無跳位',sweep.maxJump<.003,sweep.maxJump);check(engine+' 前後轉向架貼合彎道，三節各自轉向',sweep.maxAxleError<.04&&sweep.curved>100,sweep);
  check(engine+' 兩方向所有彎道有不同車體像素',sweep.hashes>=28,sweep.hashes);check(engine+' 36 組視角完整畫出跑道不裁切',!sweep.failures.length,sweep.failures);
  check(engine+' 無 JS 或 WebGL 例外',!errors.length,errors);await c.close();
  for(const width of [360,375,390,414,600,768,844]){
   const height=width===844?390:width===360?640:width===375?667:width===414?736:900,{c,p,errors}=await boot(b,width,height);
   await p.evaluate(()=>{document.body.classList.add('fs');const a=document.getElementById('alertBanner');a.hidden=false;a.textContent='營運公告';openRidePanel();});await p.tap('[data-view="loop"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='loop');await p.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);await settle(p);
   const first=await p.locator('.g-view').evaluate(c=>{const r=c.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight,scroll:document.getElementById('trainGarage').scrollTop};});check(engine+' '+width+' 第一屏完整看到跑道',first.top>0&&first.bottom<=first.height&&first.scroll===0,first);
   await p.locator('.g-auto').scrollIntoViewIfNeeded();await p.tap('.g-auto');await settle(p);const old=await snap(p);await p.tap('.g-up');await settle(p);const up=await snap(p);check(engine+' '+width+' 真觸控暫停及提高視角',+up.elevation>+old.elevation&&up.hash!==old.hash&&up.distance===old.distance);
   await p.locator('.g-reverse').scrollIntoViewIfNeeded();await p.tap('.g-reverse');await settle(p);check(engine+' '+width+' 真觸控反向',await p.locator('.g-reverse').getAttribute('aria-pressed')==='true');
   for(const lang of ['zh-TW','en','ja']){await p.evaluate(l=>setLanguage(l),lang);await settle(p);await p.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);const a=await audit(p);check(engine+' '+width+' '+lang+' 三個場景可命中、無溢出與背景遮擋',!a.failures.length&&!a.overflow,a);}
   await p.evaluate(()=>{document.documentElement.dataset.theme='dark';state.mapDark=true;TrainGarage.refresh();});await settle(p);const a=await audit(p);check(engine+' '+width+' 深色模式命中與邊界',!a.failures.length&&!a.overflow,a);
   if(width===390)await p.screenshot({path:OUT+'/'+engine+'-mobile.png'});
   const bad=[];for(const e of await p.locator('#trainGarage button:visible:not(.g-car),#trainGarage select:visible').all()){await e.scrollIntoViewIfNeeded();if(!await e.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}))bad.push(await e.getAttribute('class'));}check(engine+' '+width+' 每顆控件可捲入並命中',!bad.length,bad);
   if(engine==='chromium'&&width===375){await p.locator('.g-reset-view').scrollIntoViewIfNeeded();await p.tap('.g-reset-view');await settle(p);await p.locator('.g-view').scrollIntoViewIfNeeded();const r=await p.locator('.g-view').boundingBox(),client=await c.newCDPSession(p),old=await snap(p),x=r.x+r.width/2,y=r.y+r.height*.65;await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*4,y:y-i*8}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);const next=await snap(p);check(engine+' 手指拖曳同時控制水平及俯仰',+next.elevation>+old.elevation&&+next.yaw>+old.yaw&&next.hash!==old.hash);await client.detach();}
   await p.locator('.g-close').scrollIntoViewIfNeeded();await p.tap('.g-close');check(engine+' '+width+' 返回原面板且沒有例外',await p.evaluate(()=>!TrainGarage.isOpen&&!document.getElementById('ridePanel').hidden)&&!errors.length,errors);await c.close();
  }
  const {c:q,p:qpage}=await boot(b,375,667,'zh-TW','reduce');await qpage.tap('[data-view="loop"]');await qpage.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='loop');await settle(qpage);const a=await snap(qpage);await qpage.waitForTimeout(250);const z=await snap(qpage);check(engine+' 減少動態效果時預設暫停',a.frames===z.frames&&a.distance===z.distance&&await qpage.locator('.g-auto').getAttribute('aria-pressed')==='false');await qpage.locator('.g-auto').scrollIntoViewIfNeeded();await qpage.tap('.g-auto');await qpage.waitForTimeout(180);check(engine+' 減少動態效果仍可手動開始',+(await snap(qpage)).distance>+z.distance);await q.close();
 }catch(e){check(engine+' loop suite',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

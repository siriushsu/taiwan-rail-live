// 車庫試跑與自由視角：以真實引擎量車體像素、路徑連續性、觸控命中與停止繪製。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-motion';
mkdirSync(OUT,{recursive:true});const results=[];
const check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const waitModel=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
async function boot(b,width=1280,height=900,reducedMotion='no-preference'){
 const c=await b.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000,locale:'zh-TW',reducedMotion});
 await c.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');window.__garageFrames=0;const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...a){if(this.canvas.classList.contains('g-view'))__garageFrames++;return draw.apply(this,a);};});
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});await p.goto(BASE+'?garage=demo&lang=zh-TW');await waitModel(p);return{c,p,errors};
}
const snapshot=p=>p.locator('.g-view').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0,count=0,left=c.width,right=0,top=c.height,bottom=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i+3]){hash=(hash*31+d[i]*3+d[i+1]*5+d[i+2]*7)>>>0;count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}return{...c.dataset,hash,count,left,right,top,bottom,width:c.width,height:c.height,frames:__garageFrames};});
const framed=s=>s.count>500&&s.left>1&&s.top>1&&s.right<s.width-2&&s.bottom<s.height-2;
const stop=async p=>{if(await p.locator('.g-auto').getAttribute('aria-pressed')==='true')await p.click('.g-auto');await settle(p);};
async function audit(p){return p.evaluate(()=>{
 const d=document.getElementById('trainGarage'),failures=[],els=[...d.querySelectorAll('button,select,summary,a')].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.width&&r.height&&r.top>=70&&r.bottom<=innerHeight;});
 for(const e of els){const r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))failures.push('hit:'+e.className);if(r.height<43.5)failures.push('target:'+e.className);if(r.left<0||r.right>innerWidth+.5)failures.push('edge:'+e.className);}
 for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){if(els[i].contains(els[j])||els[j].contains(els[i]))continue;const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)failures.push('overlap:'+els[i].className+'/'+els[j].className);}
 for(const e of document.querySelectorAll('button,a,input,select,[role="button"]')){if(d.contains(e)||!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.width&&r.height&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))failures.push('background:'+e.id);}
 return {failures,overflow:d.scrollWidth>innerWidth||document.documentElement.scrollWidth>innerWidth};
});}
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const {c,p,errors}=await boot(b);const original=await p.evaluate(()=>JSON.stringify({rides:loadRides(),checkins:loadCheckins()}));
  const before=await snapshot(p),box=await p.locator('.g-view').boundingBox();
  await p.mouse.move(box.x+box.width/2,box.y+box.height*.65);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+box.height*.35,{steps:8});await p.mouse.up();await settle(p);
  const raised=await snapshot(p);check(engine+' 垂直拖曳確實改變俯仰與車體像素',Number(raised.elevation)>Number(before.elevation)+.3&&raised.hash!==before.hash&&raised.yaw===before.yaw);
  await p.locator('.g-view').focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowDown');await settle(p);const keyed=await snapshot(p);
  check(engine+' 鍵盤可控制水平與垂直視角',keyed.yaw!==raised.yaw&&Number(keyed.elevation)<Number(raised.elevation));
  for(let i=0;i<8;i++)await p.click('.g-up');await settle(p);const high=await snapshot(p);
  for(let i=0;i<10;i++)await p.click('.g-down');await settle(p);const low=await snapshot(p);
  check(engine+' 俯視與平視有界限且車體不裁切',Number(high.elevation)===1.48&&Number(low.elevation)===.08&&framed(high)&&framed(low),{high,low});
  await p.click('.g-reset-view');await settle(p);const reset=await snapshot(p);check(engine+' 一鍵重設視角',reset.yaw==='-0.55'&&reset.elevation==='0.39');
  await p.click('[data-view="track"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='track');const start=await snapshot(p);
  await p.waitForTimeout(1500);await stop(p);const forward=await snapshot(p);
  check(engine+' 小車由右向左行駛，側面鏡頭持續跟拍',Number(forward.distance)>Number(start.distance)+1&&Number(forward.trackX)<Number(start.trackX)&&Math.abs(Number(forward.trackHeading)-Math.PI)<.001&&forward.hash!==start.hash&&forward.count===forward.width*forward.height,{start:start.distance,end:forward.distance,heading:forward.trackHeading});
  check(engine+' 精修網格試跑維持約 30 fps 上限',forward.frames-start.frames<=52,{frames:forward.frames-start.frames});
  const stable=await snapshot(p);await p.waitForTimeout(250);const paused=await snapshot(p);check(engine+' 暫停後位置與畫面不持續重畫',paused.distance===stable.distance&&paused.hash===stable.hash&&paused.frames===stable.frames);
  await p.click('.g-reverse');await settle(p);const reversed=await snapshot(p);
  check(engine+' 反向留在原地，車頭方向改變',reversed.distance===paused.distance&&reversed.trackX===paused.trackX&&reversed.trackY===paused.trackY&&Math.abs(Math.abs(Number(reversed.trackHeading)-Number(paused.trackHeading))-Math.PI)<.001&&reversed.hash!==paused.hash);
  await p.click('.g-auto');await p.waitForTimeout(1200);await stop(p);const backward=await snapshot(p);
  check(engine+' 逆向沿原路連續行駛',Number(backward.distance)<Number(reversed.distance)-1&&backward.hash!==reversed.hash);
  for(let i=0;i<9;i++)await p.click('.g-left');await settle(p);const edgeLeft=await snapshot(p);
  for(let i=0;i<18;i++)await p.click('.g-right');await settle(p);const edgeRight=await snapshot(p);
  for(let i=0;i<6;i++)await p.click('.g-up');await settle(p);const edgeUp=await snapshot(p);
  check(engine+' 海岸相機只朝海，水平與俯仰不會轉到背面',Math.abs(Number(edgeLeft.yaw)+Math.PI/2+.20)<.001&&Math.abs(Number(edgeRight.yaw)+Math.PI/2-.20)<.001&&Number(edgeUp.elevation)===.30);
  await p.click('.g-reverse');await p.click('.g-reset-view');await p.screenshot({path:OUT+'/'+engine+'-desktop.png'});
  for(const lang of ['en','ja']){await p.evaluate(l=>setLanguage(l),lang);await settle(p);check(engine+' '+lang+' 試跑控件翻譯',await p.locator('[data-view="track"]').textContent()===(lang==='en'?'Coastal journey':'海辺の旅'));}
  await p.evaluate(()=>setLanguage('zh-TW'));await p.click('[data-filter="all"]');await p.click('.g-auto');await p.locator('.g-footer').scrollIntoViewIfNeeded();await p.waitForTimeout(150);const off=await snapshot(p);await p.waitForTimeout(300);const off2=await snapshot(p);
  check(engine+' 展示台捲出畫面後停止渲染',off.frames===off2.frames&&off.distance===off2.distance);
  await p.locator('.g-filters').scrollIntoViewIfNeeded();await p.waitForTimeout(150);const back=await snapshot(p);check(engine+' 返回展示台從原地續跑',back.frames>off.frames&&Number(back.distance)-Number(off.distance)<.8);
  check(engine+' 試跑不寫入旅程或收藏',await p.evaluate(()=>JSON.stringify({rides:loadRides(),checkins:loadCheckins()}))===original);
  await p.click('.g-close');await p.waitForTimeout(150);const closed=await p.evaluate(()=>__garageFrames);await p.waitForTimeout(250);check(engine+' 關閉車庫停止動畫',await p.evaluate(()=>__garageFrames)===closed);
  check(engine+' 無 JS 例外',!errors.length,errors);await c.close();
  for(const width of [360,375,390,414,600,768,844]){
   const {c,p,errors}=await boot(b,width,width===844?390:width===360?640:width===375?667:width===414?736:900);
   await p.evaluate(()=>{document.body.classList.add('fs');const a=document.getElementById('alertBanner');a.hidden=false;a.textContent='營運公告';openRidePanel();});
   await p.tap('[data-view="track"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='track');await p.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);await settle(p);
   const first=await p.locator('.g-view').evaluate(c=>{const r=c.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight,scroll:document.getElementById('trainGarage').scrollTop};});
   check(engine+' '+width+' 試跑場第一屏完整可見',first.top>0&&first.bottom<=first.height&&first.scroll===0,first);
   await p.locator('.g-auto').scrollIntoViewIfNeeded();await p.tap('.g-auto');await settle(p);
   const low=await snapshot(p);await p.locator('.g-up').scrollIntoViewIfNeeded();await p.tap('.g-up');await settle(p);const high=await snapshot(p);
   check(engine+' '+width+' 真觸控提高視角',Number(high.elevation)>Number(low.elevation)&&high.hash!==low.hash);
   await p.locator('.g-reverse').scrollIntoViewIfNeeded();await p.tap('.g-reverse');await settle(p);check(engine+' '+width+' 真觸控反向',await p.locator('.g-reverse').getAttribute('aria-pressed')==='true');
   let a=await audit(p);check(engine+' '+width+' 試跑控件與全背景命中檢查',!a.failures.length&&!a.overflow,a);
   await p.evaluate(()=>{document.documentElement.dataset.theme='dark';state.mapDark=true;TrainGarage.refresh();});await settle(p);a=await audit(p);check(engine+' '+width+' 深色模式控件與邊界',!a.failures.length&&!a.overflow,a);
   if(width===390){await p.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);await p.screenshot({path:OUT+'/'+engine+'-mobile.png'});}
   const bad=[];for(const el of await p.locator('#trainGarage button:visible:not(.g-car),#trainGarage select:visible').all()){await el.scrollIntoViewIfNeeded();if(!await el.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}))bad.push(await el.getAttribute('class'));}
   check(engine+' '+width+' 全部控件可捲動觸及',!bad.length,bad);
   if(engine==='chromium'&&width===375){await p.locator('.g-reset-view').scrollIntoViewIfNeeded();await p.tap('.g-reset-view');await settle(p);await p.locator('.g-view').scrollIntoViewIfNeeded();const box=await p.locator('.g-view').boundingBox(),client=await c.newCDPSession(p),old=await snapshot(p);const x=box.x+box.width/2,y=box.y+box.height*.65;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*4,y:y-i*8}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);const now=await snapshot(p);
    check(engine+' 手指上下左右拖曳可轉視角且不被頁面捲動取消',Number(now.elevation)>Number(old.elevation)&&Number(now.yaw)>Number(old.yaw)&&now.hash!==old.hash);await client.detach();
   }
   await p.locator('.g-close').scrollIntoViewIfNeeded();await p.tap('.g-close');check(engine+' '+width+' 返回護照與無例外',await p.evaluate(()=>!TrainGarage.isOpen&&!document.getElementById('ridePanel').hidden)&&!errors.length,errors);await c.close();
  }
  const quiet=await boot(b,375,667,'reduce');await quiet.p.tap('[data-view="track"]');await settle(quiet.p);await quiet.p.waitForTimeout(100);const q1=await snapshot(quiet.p);await quiet.p.waitForTimeout(250);const q2=await snapshot(quiet.p);
  check(engine+' 減少動態效果時試跑預設暫停',q1.distance===q2.distance&&q1.frames===q2.frames&&await quiet.p.locator('.g-auto').getAttribute('aria-pressed')==='false');await quiet.p.locator('.g-auto').scrollIntoViewIfNeeded();await quiet.p.tap('.g-auto');await quiet.p.waitForTimeout(150);check(engine+' 減少動態效果仍可手動開始行駛',Number((await snapshot(quiet.p)).distance)>Number(q2.distance));await quiet.c.close();
 }catch(e){check(engine+' motion suite',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

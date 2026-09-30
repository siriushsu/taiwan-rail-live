// 台南重播頁：自由方位與傾斜的驗收（無視窗 Chromium＋WebKit；使用者 2026-09-30「角度跟傾斜應該要能夠自由旋轉」）。
// 用法：node scripts/verify_tainan_memory_camera.mjs；自己起 dev_server 子程序（PORT 預設 5587），結束時只停它。VURL 有給就不起 server。
// 其他環境變數：ENGINES=chromium,webkit、PAGE_PATH（突變測試指到複本頁）、RESULTS（結果檔路徑）。結果與截圖寫到 output/tainan-memory/camera/。
// 桌機：右鍵／Shift＋左鍵拖曳改方位與仰角、左鍵平移時地面點跟著游標、仰角上下限、舊站近景重設、滾輪縮放。
// 手機：Chromium 用 CDP 真的雙指觸控；WebKit 沒有 CDP，改對畫布送合成 PointerEvent（只驗手勢數學，不驗瀏覽器的觸控轉換）。
import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const WT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(WT,'output/tainan-memory/camera');fs.mkdirSync(path.join(OUT,'shots'),{recursive:true});
const PORT=+(process.env.PORT||5587),base=process.env.VURL||`http://127.0.0.1:${PORT}`;
const PAGE=base+(process.env.PAGE_PATH||'/memories/tainan-2026-09-12/index.html');
const TILT0=Math.atan2(6800,8000),TMIN=10*Math.PI/180,TMAX=89*Math.PI/180;
let server=null;
if(!process.env.VURL){
 server=spawn(process.execPath,[path.join(WT,'scripts/dev_server.mjs')],{cwd:WT,env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
 let ok=false;for(let i=0;i<100&&!ok;i++){try{ok=(await fetch(PAGE)).ok;}catch{}if(!ok)await new Promise(r=>setTimeout(r,100));}
 if(!ok){server.kill();throw Error('dev_server 沒起來：'+PAGE);}
}
const results=[];let fails=0;
const check=(engine,view,name,pass,detail='')=>{results.push({engine,view,name,pass,detail});if(!pass)fails++;console.log(`${pass?'PASS':'FAIL'} [${engine} ${view}] ${name}${detail?' — '+detail:''}`);};
const dAng=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const deg=r=>(r*180/Math.PI).toFixed(2)+'°';
const cam=page=>page.evaluate(()=>{const c=window.tainanMemory.camera,e=c.matrixWorld.elements;return {tilt:Math.asin(e[10]),az:Math.atan2(e[9],e[8]),span:c.top-c.bottom};});
const rectOf=page=>page.evaluate(()=>{const r=window.tainanMemory.renderer.domElement.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};});
// 螢幕點 → 地面（z=0）上的世界座標；世界座標 → 螢幕點。正交相機：射線方向一律是相機前方。
const groundAt=(page,x,y)=>page.evaluate(([x,y])=>{const c=window.tainanMemory.camera,r=window.tainanMemory.renderer.domElement.getBoundingClientRect();const o=c.position.clone().set((x-r.left)/r.width*2-1,-((y-r.top)/r.height*2-1),-1).unproject(c);const d=c.position.clone().set(0,0,-1).transformDirection(c.matrixWorld);const t=-o.z/d.z;return [o.x+d.x*t,o.y+d.y*t,0];},[x,y]);
const screenOf=(page,p)=>page.evaluate(p=>{const c=window.tainanMemory.camera,r=window.tainanMemory.renderer.domElement.getBoundingClientRect();const v=c.position.clone().set(...p).project(c);return [r.left+(v.x+1)/2*r.width,r.top+(1-v.y)/2*r.height];},p);
async function open(browser,opts){const context=await browser.newContext(opts),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push('pageerror: '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 await page.goto(PAGE,{waitUntil:'load'});await page.waitForFunction(()=>window.tainanMemory?.state?.ready===true,null,{timeout:90000});
 await page.evaluate(()=>{window.tainanMemory.state.playing=false;});return {context,page,errors};}
async function hintCheck(engine,view,page){const h=await page.evaluate(()=>({fine:matchMedia('(hover:hover) and (pointer:fine)').matches,touch:getComputedStyle(document.querySelector('.note-touch')).display,mouse:getComputedStyle(document.querySelector('.note-mouse')).display}));
 check(engine,view,'操作提示跟輸入裝置一致（hover＋pointer:fine 顯示滑鼠版，否則觸控版）',h.fine?(h.mouse!=='none'&&h.touch==='none'):(h.touch!=='none'&&h.mouse==='none'),JSON.stringify(h));return h;}

for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
 const browser=await type.launch(engine==='chromium'?{channel:'chromium',headless:true}:{headless:true});
 // ── 桌機 ──
 {const view='1280x800';const {context,page,errors}=await open(browser,{viewport:{width:1280,height:800}});
  const r=await rectOf(page),cx=r.x+r.w/2,cy=r.y+r.h/2;
  const c0=await cam(page);
  check(engine,view,'預設仰角＝改版前固定角度 40.36°',Math.abs(c0.tilt-TILT0)<1e-3,deg(c0.tilt));
  check(engine,view,'預設方位 3.6 rad',Math.abs(dAng(c0.az,3.6))<1e-3,c0.az.toFixed(4));
  await hintCheck(engine,view,page);
  await page.mouse.move(cx,cy);await page.mouse.down({button:'right'});await page.mouse.move(cx+100,cy+60,{steps:10});await page.mouse.up({button:'right'});
  const c1=await cam(page);
  check(engine,view,'右鍵拖曳右移 100 px：方位 −0.6 rad',Math.abs(dAng(c1.az,c0.az)+.6)<.03,dAng(c1.az,c0.az).toFixed(4));
  check(engine,view,'右鍵拖曳下移 60 px：仰角 +0.3 rad（更接近俯視）',Math.abs(c1.tilt-c0.tilt-.3)<.03,(c1.tilt-c0.tilt).toFixed(4));
  check(engine,view,'右鍵拖曳不改縮放',Math.abs(c1.span/c0.span-1)<1e-9);
  // macOS／Linux 在按下右鍵當下就送 contextmenu（還沒拖曳）：等過拖曳後的 500 ms 攔截窗，只剩畫布自己的 handler 在擋
  await page.waitForTimeout(600);
  const menu=await page.evaluate(()=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});return !window.tainanMemory.renderer.domElement.dispatchEvent(ev);});
  check(engine,view,'畫布上不跳右鍵選單（contextmenu 被取消）',menu);
  await page.keyboard.down('Shift');await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx-100,cy-60,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');
  const c2=await cam(page);
  check(engine,view,'Shift＋左鍵拖曳：方位 +0.6、仰角 −0.3',Math.abs(dAng(c2.az,c1.az)-.6)<.03&&Math.abs(c2.tilt-c1.tilt+.3)<.03,`${dAng(c2.az,c1.az).toFixed(4)} / ${(c2.tilt-c1.tilt).toFixed(4)}`);
  // 平移：拖曳起點底下的地面點，放開後要停在游標下（預設仰角與低仰角各一次）
  for(const [label,lower] of [['預設仰角',0],['低仰角',1]]){
   if(lower){await page.mouse.move(cx,cy+40);await page.mouse.down({button:'right'});await page.mouse.move(cx,cy-60,{steps:10});await page.mouse.up({button:'right'});}
   const before=await cam(page),start=[cx-20,cy+60],end=[cx+30,cy-50],g=await groundAt(page,...start);
   await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:12});await page.mouse.up();
   const s=await screenOf(page,g),after=await cam(page),miss=Math.hypot(s[0]-end[0],s[1]-end[1]);
   check(engine,view,`左鍵平移（${label} ${deg(before.tilt)}）：起點的地面點停在游標下`,miss<2,`差 ${miss.toFixed(2)} px`);
   check(engine,view,`左鍵平移（${label}）：方位、仰角、縮放都不變`,Math.abs(dAng(after.az,before.az))<1e-9&&Math.abs(after.tilt-before.tilt)<1e-9&&Math.abs(after.span/before.span-1)<1e-9);
  }
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-desktop-low-tilt.png`)});
  for(let i=0;i<3;i++){await page.mouse.move(cx,r.y+30);await page.mouse.down({button:'right'});await page.mouse.move(cx,r.y+r.h-30,{steps:8});await page.mouse.up({button:'right'});}
  const hi=await cam(page);check(engine,view,'仰角上限 89°',Math.abs(hi.tilt-TMAX)<1e-3,deg(hi.tilt));
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-desktop-top.png`)});
  for(let i=0;i<3;i++){await page.mouse.move(cx,r.y+r.h-30);await page.mouse.down({button:'right'});await page.mouse.move(cx,r.y+30,{steps:8});await page.mouse.up({button:'right'});}
  const lo=await cam(page);check(engine,view,'仰角下限 10°',Math.abs(lo.tilt-TMIN)<1e-3,deg(lo.tilt));
  await page.click('#station');const st=await cam(page);
  check(engine,view,'按「舊站近景」仰角與方位回預設',Math.abs(st.tilt-TILT0)<1e-3&&Math.abs(dAng(st.az,3.6))<1e-3,`${deg(st.tilt)} ${st.az.toFixed(4)}`);
  await page.click('#rotate');const ro=await cam(page);check(engine,view,'「旋轉」鈕仍是 +45°、仰角不變',Math.abs(dAng(ro.az,st.az)-Math.PI/4)<1e-3&&Math.abs(ro.tilt-st.tilt)<1e-9);
  await page.mouse.move(cx,cy);await page.mouse.wheel(0,300);await page.waitForTimeout(150);const wh=await cam(page);
  check(engine,view,'滾輪仍可縮放',wh.span/ro.span>1.2,(wh.span/ro.span).toFixed(3));
  // Windows 在放開右鍵時才送 contextmenu、目標是游標底下的元素（驗收 09-30）：右鍵拖曳轉向到「旋轉」鈕上才放開，接著送的選單事件要被擋；
  // 對照：過了 600 ms 在同一顆鈕上按右鍵，選單照常（不能把整頁的右鍵選單都關掉）
  {const b=await page.locator('#rotate').boundingBox(),bx=b.x+b.width/2,by=b.y+b.height/2,menuAt=()=>page.evaluate(()=>!document.querySelector('#rotate').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
   await page.mouse.move(cx,cy);await page.mouse.down({button:'right'});await page.mouse.move(bx,by,{steps:10});await page.mouse.up({button:'right'});const blocked=await menuAt();
   await page.waitForTimeout(600);const normal=await menuAt();
   check(engine,view,'Windows 右鍵：拖曳轉向後在按鈕上放開不跳選單',blocked);
   check(engine,view,'Windows 右鍵對照：沒拖曳時按鈕上的右鍵選單照常',!normal);}
  check(engine,view,'零錯誤',errors.length===0,errors.slice(0,3).join(' | '));
  await context.close();}
 // ── 手機（390×844、觸控）──
 {const view='390x844 touch';const {context,page,errors}=await open(browser,{viewport:{width:390,height:844},isMobile:engine==='chromium',hasTouch:true,deviceScaleFactor:2});
  await hintCheck(engine,view,page);
  const r=await rectOf(page),cx=r.x+r.w/2,cy=r.y+r.h/2;
  const cdp=engine==='chromium'?await context.newCDPSession(page):null;
  async function gesture(frames){// frames：[[ax,ay],[bx,by]] 陣列，第 0 格是按下位置
   if(cdp){const pts=f=>f.map((p,i)=>({x:p[0],y:p[1],id:i+1}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(frames[0])});
    for(const f of frames.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(f)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else await page.evaluate(frames=>{const el=window.tainanMemory.renderer.domElement,n=frames[0].length;
    const fire=(type,id,p)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:p[0],clientY:p[1],pointerType:'touch',isPrimary:id===1,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
    for(let i=0;i<n;i++)fire('pointerdown',i+1,frames[0][i]);
    for(const f of frames.slice(1))for(let i=0;i<n;i++)fire('pointermove',i+1,f[i]);
    const last=frames[frames.length-1];for(let i=0;i<n;i++)fire('pointerup',i+1,last[i]);},frames);
   await page.waitForTimeout(50);}
  const steps=12,lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  // 轉動：兩指繞中心順時針轉 30°
  let c0=await cam(page);
  await gesture(Array.from({length:steps+1},(_,i)=>{const t=i/steps*Math.PI/6;return [[cx-50*Math.cos(t),cy-50*Math.sin(t)],[cx+50*Math.cos(t),cy+50*Math.sin(t)]];}));
  let c1=await cam(page);
  check(engine,view,'雙指順時針轉 30°：方位 +0.524 rad',Math.abs(dAng(c1.az,c0.az)-Math.PI/6)<.03,dAng(c1.az,c0.az).toFixed(4));
  check(engine,view,'雙指轉動：縮放不變（±3%）、仰角不變',Math.abs(c1.span/c0.span-1)<.03&&Math.abs(c1.tilt-c0.tilt)<1e-9,`span×${(c1.span/c0.span).toFixed(3)}`);
  // 捏合：兩指距離 100 → 200
  await gesture(Array.from({length:steps+1},(_,i)=>{const t=i/steps;return [lerp([cx-50,cy],[cx-100,cy],t),lerp([cx+50,cy],[cx+100,cy],t)];}));
  let c2=await cam(page);
  check(engine,view,'雙指張開一倍：可見範圍減半（±3%）',Math.abs(c2.span/c1.span-.5)<.015,(c2.span/c1.span).toFixed(3));
  check(engine,view,'雙指張開：方位、仰角不變',Math.abs(dAng(c2.az,c1.az))<.03&&Math.abs(c2.tilt-c1.tilt)<1e-9,dAng(c2.az,c1.az).toFixed(4));
  // 傾斜：兩指一起往上推 60 px（更接近地平）
  await gesture(Array.from({length:steps+1},(_,i)=>{const t=i/steps;return [lerp([cx-50,cy+80],[cx-50,cy+20],t),lerp([cx+50,cy+80],[cx+50,cy+20],t)];}));
  let c3=await cam(page);
  check(engine,view,'雙指一起上推 60 px：仰角 −0.3 rad',Math.abs(c3.tilt-c2.tilt+.3)<.03,(c3.tilt-c2.tilt).toFixed(4));
  check(engine,view,'雙指上推：方位、縮放不變',Math.abs(dAng(c3.az,c2.az))<1e-9&&Math.abs(c3.span/c2.span-1)<1e-9);
  // 快速推（驗收 09-30：每個事件每指走 17～25 px 時，第一指的事件自己就過判定門檻、另一指還是舊座標，舊版誤鎖成捏合，整個手勢沒反應）：先往下 4×17 px，再往上 3×25 px
  await gesture(Array.from({length:5},(_,i)=>[[cx-50,cy-40+17*i],[cx+50,cy-40+17*i]]));
  const c4=await cam(page);
  check(engine,view,'雙指快速下推（每步 17 px）68 px：仰角 +0.34 rad',Math.abs(c4.tilt-c3.tilt-.34)<.03,(c4.tilt-c3.tilt).toFixed(4));
  await gesture(Array.from({length:4},(_,i)=>[[cx-50,cy+40-25*i],[cx+50,cy+40-25*i]]));
  const c5=await cam(page);
  check(engine,view,'雙指快速上推（每步 25 px）75 px：仰角 −0.375 rad',Math.abs(c5.tilt-c4.tilt+.375)<.03,(c5.tilt-c4.tilt).toFixed(4));
  check(engine,view,'雙指快速推：方位、縮放不變',Math.abs(dAng(c5.az,c3.az))<1e-9&&Math.abs(c5.span/c3.span-1)<1e-9);
  // 三指（驗收 09-30：兩指捏合中第三指碰到、再抬起第一指，舊版剩下兩指沿用舊基準，1 px 的移動就讓方位跳 116°）：兩引擎都用合成 PointerEvent
  const tf=await page.evaluate(([cx,cy])=>{const el=window.tainanMemory.renderer.domElement,c=window.tainanMemory.camera;
   const fire=(type,id,x,y)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',isPrimary:id===11,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
   const now=()=>{const e=c.matrixWorld.elements;return {tilt:Math.asin(e[10]),az:Math.atan2(e[9],e[8]),span:c.top-c.bottom};};
   fire('pointerdown',11,cx-50,cy);fire('pointerdown',12,cx+50,cy);
   for(let i=1;i<=4;i++){fire('pointermove',11,cx-50-5*i,cy);fire('pointermove',12,cx+50+5*i,cy);}      // 兩指先捏合開一點（100→140 px）
   fire('pointerdown',13,cx,cy+120);fire('pointerup',11,cx-70,cy);
   const a=now();fire('pointermove',12,cx+71,cy);const b=now();
   const p2=[cx+71,cy],p3=[cx,cy+120];      // 剩下兩指：13 沿連線往內走到一半距離（往內捏，避開 34 m 的放大極限；這台手機此時約 50 m）
   for(let i=1;i<=10;i++){const t=1-i/20;fire('pointermove',13,p2[0]+(p3[0]-p2[0])*t,p2[1]+(p3[1]-p2[1])*t);}
   const d=now();fire('pointerup',12,...p2);fire('pointerup',13,p2[0]+(p3[0]-p2[0])*.5,p2[1]+(p3[1]-p2[1])*.5);return {a,b,d};},[cx,cy]);
  check(engine,view,'三指：放下第三指再抬起第一指，剩下的指頭動 1 px 鏡頭不跳',Math.abs(dAng(tf.b.az,tf.a.az))<.01&&Math.abs(tf.b.span/tf.a.span-1)<.01&&Math.abs(tf.b.tilt-tf.a.tilt)<1e-9,`Δ方位 ${dAng(tf.b.az,tf.a.az).toFixed(4)}、span×${(tf.b.span/tf.a.span).toFixed(4)}`);
  check(engine,view,'三指後剩下兩指照常捏合（距離減半→可見範圍加倍）',Math.abs(tf.d.span/tf.b.span-2)<.04&&Math.abs(dAng(tf.d.az,tf.b.az))<.03,`span×${(tf.d.span/tf.b.span).toFixed(3)}、Δ方位 ${dAng(tf.d.az,tf.b.az).toFixed(4)}`);
  // 單指平移：起點地面點停在手指下
  const start=[cx-10,cy+60],end=[cx+20,cy-40],g=await groundAt(page,...start);
  await gesture(Array.from({length:steps+1},(_,i)=>[lerp(start,end,i/steps)]));
  const s=await screenOf(page,g),miss=Math.hypot(s[0]-end[0],s[1]-end[1]);
  check(engine,view,'單指平移：起點的地面點停在手指下',miss<2,`差 ${miss.toFixed(2)} px`);
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-mobile-after-gestures.png`)});
  await page.tap('#station');const st=await cam(page);
  check(engine,view,'點「舊站近景」回預設仰角與方位',Math.abs(st.tilt-TILT0)<1e-3&&Math.abs(dAng(st.az,3.6))<1e-3);
  check(engine,view,'零錯誤',errors.length===0,errors.slice(0,3).join(' | '));
  await context.close();}
 // ── 手機寬度掃描：操作提示整段在畫面內、不壓到視角按鈕 ──
 for(const w of [360,375,414,768]){const view=`${w} 寬`;const {context,page,errors}=await open(browser,{viewport:{width:w,height:w<700?800:1024},isMobile:engine==='chromium',hasTouch:true});
  const m=await page.evaluate(()=>{const n=document.querySelector('.scene-note').getBoundingClientRect(),vw=innerWidth,btns=[...document.querySelectorAll('.view-controls button')].filter(b=>!b.hidden).map(b=>b.getBoundingClientRect());return {note:[n.left,n.top,n.right,n.bottom],vw,overlap:btns.some(b=>b.left<n.right&&b.right>n.left&&b.top<n.bottom&&b.bottom>n.top),visible:getComputedStyle(document.querySelector('.scene-note')).display!=='none'};});
  check(engine,view,'操作提示在畫面內、不壓視角按鈕',!m.visible||(m.note[0]>=0&&m.note[2]<=m.vw&&!m.overlap),JSON.stringify(m));
  check(engine,view,'零錯誤',errors.length===0,errors.slice(0,3).join(' | '));
  await context.close();}
 await browser.close();
}
fs.writeFileSync(process.env.RESULTS||path.join(OUT,'cam-results.json'),JSON.stringify({page:PAGE,fails,results},null,2)+'\n');
console.log(`相機驗收：${results.length-fails}/${results.length} 過；結果 ${path.join(OUT,'cam-results.json')}`);
if(server)server.kill();
process.exitCode=fails?1:0;

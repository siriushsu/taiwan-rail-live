// 台南重播頁：自由方位與傾斜的驗收（無視窗 Chromium＋WebKit）。
// 用法：node scripts/verify_tainan_memory_camera.mjs；自己起 dev_server 子程序（PORT 預設 5587），結束時只停它。VURL 有給就不起 server。
// 其他環境變數：ENGINES=chromium,webkit、PAGE_PATH（突變測試指到複本頁）、RESULTS（結果檔路徑）、CHROMIUM_CHANNEL（Chromium 的 channel，預設 chromium）。結果與截圖寫到 <out>/camera/。
// 日期與資料夾參數化（不給參數＝9/12 封存版，行為與改版前相同）：--date=…、--dir=…、--out=…，或環境變數 MEMORY_DATE／MEMORY_DIR／MEMORY_OUT；
//   dir 預設 memories/tainan-<date>；out 預設 9/12 → output/tainan-memory、其他日期 → output/tainan-memory-MMDD。PAGE_PATH 有給就蓋過 dir。
// 手勢、滑鼠照網頁主地圖（MapLibre 5.9.0 的做法與常數，map-gestures.js）：
// 桌機：右鍵／Ctrl＋左鍵拖曳＝轉盤式轉向 0.8°/px、往上拖鏡頭放低 0.5°/px，中鍵不動，Shift／Alt／⌘＋左鍵跟一般左鍵一樣平移；左鍵平移時地面點跟著游標、
//   放手前還在動就有慣性；滾輪、雙擊以游標為準縮放；仰角上下限、舊站近景重設、右鍵選單攔截；按鈕改鏡頭會停掉慣性。
// 手機：Chromium 用 CDP 真的觸控；WebKit 沒有 CDP，改對畫布送合成 PointerEvent（只驗手勢數學，不驗瀏覽器的觸控轉換）。
//   雙指扭轉、捏合繞兩指中點（各有門檻），兩指一起上下推改仰角（兩指上下疊著不算），雙點放大、雙指點一下縮小，只認最先放上的兩指。
import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const opt=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)||process.env[`MEMORY_${name.toUpperCase()}`]||'';
const DATE=opt('date')||'2026-09-12',DIR=(opt('dir')||`memories/tainan-${DATE}`).replace(/^\/+|\/+$/g,''),OUTDIR=opt('out')||(DATE==='2026-09-12'?'output/tainan-memory':`output/tainan-memory-${DATE.slice(5).replace('-','')}`);
const WT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.resolve(WT,OUTDIR,'camera');fs.mkdirSync(path.join(OUT,'shots'),{recursive:true});
const PORT=+(process.env.PORT||5587),base=process.env.VURL||`http://127.0.0.1:${PORT}`;
const PAGE=base+(process.env.PAGE_PATH||'/'+DIR+'/index.html');
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
const hms=t=>new Date(Math.round(t)*1000).toISOString().slice(11,19);
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
 const browser=await type.launch(engine==='chromium'?{channel:process.env.CHROMIUM_CHANNEL||'chromium',headless:true}:{headless:true});
 // ── 桌機 ──
 {const view='1280x800';const {context,page,errors}=await open(browser,{viewport:{width:1280,height:800}});
  const r=await rectOf(page),cx=r.x+r.w/2,cy=r.y+r.h/2,D=Math.PI/180;
  const centerGround=async()=>{const q=await rectOf(page);return groundAt(page,q.x+q.w/2,q.y+q.h/2);};
  // 拖曳：放手前停 hold ms（照主地圖，停住再放就沒有慣性），量的是拖曳本身。
  const drag=async(from,to,{button='left',mods=[],steps=10,hold=250}={})=>{for(const k of mods)await page.keyboard.down(k);await page.mouse.move(...from);await page.mouse.down({button});await page.mouse.move(...to,{steps});if(hold)await page.waitForTimeout(hold);await page.mouse.up({button});for(const k of mods)await page.keyboard.up(k);};
  // 甩：每 16 ms 動一步（瀏覽器同一幀的移動會併成一筆）、最後一步後馬上放開。
  const fling=async(from,dx)=>{await page.mouse.move(...from);await page.mouse.down();for(let i=1;i<=6;i++){await page.mouse.move(from[0]+i*dx,from[1]);await page.waitForTimeout(16);}await page.mouse.up();};
  const c0=await cam(page);
  check(engine,view,'預設仰角＝改版前固定角度 40.36°',Math.abs(c0.tilt-TILT0)<1e-3,deg(c0.tilt));
  check(engine,view,'預設方位 3.6 rad',Math.abs(dAng(c0.az,3.6))<1e-3,c0.az.toFixed(4));
  await hintCheck(engine,view,page);
  // 右鍵拖曳＝轉盤：在畫面中心下方往右拖，畫面逆時針轉（方位變小），上方往右拖順時針；0.8°/px，仰角、縮放不變
  const ROT=50*.8*D;
  await drag([cx-25,cy+60],[cx+25,cy+60],{button:'right'});const c1=await cam(page);
  check(engine,view,'右鍵在中心下方往右拖 50 px：畫面逆時針 40°（方位 −0.698 rad），仰角、縮放不變',Math.abs(dAng(c1.az,c0.az)+ROT)<1e-6&&Math.abs(c1.tilt-c0.tilt)<1e-9&&Math.abs(c1.span/c0.span-1)<1e-9,dAng(c1.az,c0.az).toFixed(4));
  await drag([cx-25,cy-60],[cx+25,cy-60],{button:'right'});const c2=await cam(page);
  check(engine,view,'右鍵在中心上方往右拖 50 px：畫面順時針 40°（方位 +0.698 rad）',Math.abs(dAng(c2.az,c1.az)-ROT)<1e-6,dAng(c2.az,c1.az).toFixed(4));
  await drag([cx-25,cy+60],[cx+25,cy+60],{mods:['Control']});const c3=await cam(page);
  check(engine,view,'Ctrl＋左鍵拖曳跟右鍵一樣',Math.abs(dAng(c3.az,c2.az)+ROT)<1e-6,dAng(c3.az,c2.az).toFixed(4));
  await drag([cx,cy+20],[cx,cy-10],{button:'right'});const c4=await cam(page);
  check(engine,view,'右鍵往上拖 30 px：鏡頭放低 15°（0.5°/px），方位不變',Math.abs(c4.tilt-c3.tilt+15*D)<1e-6&&Math.abs(dAng(c4.az,c3.az))<1e-9,(c4.tilt-c3.tilt).toFixed(4));
  {const g0=await centerGround();await drag([cx,cy],[cx+40,cy+30],{button:'middle'});const c5=await cam(page),g1=await centerGround();
   check(engine,view,'中鍵拖曳不動鏡頭',dAng(c5.az,c4.az)===0&&c5.tilt===c4.tilt&&c5.span===c4.span&&Math.hypot(g1[0]-g0[0],g1[1]-g0[1])<1e-9);}
  // macOS／Linux 在按下右鍵當下就送 contextmenu（還沒拖曳）：等過拖曳後的 500 ms 攔截窗，只剩畫布自己的 handler 在擋
  await page.waitForTimeout(600);
  const menu=await page.evaluate(()=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});return !window.tainanMemory.renderer.domElement.dispatchEvent(ev);});
  check(engine,view,'畫布上不跳右鍵選單（contextmenu 被取消）',menu);
  // Shift／Alt／⌘＋左鍵不再當右鍵：照主地圖，跟一般左鍵一樣平移
  for(const k of ['Shift','Alt','Meta']){const b=await cam(page),start=[cx-40,cy+30],end=[cx+20,cy-10],g=await groundAt(page,...start);await drag(start,end,{mods:[k]});
   const a=await cam(page),s=await screenOf(page,g),miss=Math.hypot(s[0]-end[0],s[1]-end[1]);
   check(engine,view,`${k}＋左鍵拖曳＝平移（不轉向、不傾斜）`,miss<2&&Math.abs(dAng(a.az,b.az))<1e-9&&Math.abs(a.tilt-b.tilt)<1e-9&&Math.abs(a.span/b.span-1)<1e-9,`差 ${miss.toFixed(2)} px`);}
  // 平移：拖曳起點底下的地面點，放開後要停在游標下（預設仰角與低仰角各一次）
  await page.click('#station');
  for(const [label,lower] of [['預設仰角',0],['低仰角',1]]){
   if(lower)await drag([cx,cy+40],[cx,cy-60],{button:'right'});
   const before=await cam(page),start=[cx-20,cy+60],end=[cx+30,cy-50],g=await groundAt(page,...start);
   await drag(start,end,{steps:12});
   const s=await screenOf(page,g),after=await cam(page),miss=Math.hypot(s[0]-end[0],s[1]-end[1]);
   check(engine,view,`左鍵平移（${label} ${deg(before.tilt)}）：起點的地面點停在游標下`,miss<2,`差 ${miss.toFixed(2)} px`);
   check(engine,view,`左鍵平移（${label}）：方位、仰角、縮放都不變`,Math.abs(dAng(after.az,before.az))<1e-9&&Math.abs(after.tilt-before.tilt)<1e-9&&Math.abs(after.span/before.span-1)<1e-9);
  }
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-desktop-low-tilt.png`)});
  // 放手前還在動：照主地圖的慣性多滑一段，方向不變
  {const start=[cx-60,cy],g=await groundAt(page,...start);await fling(start,12);await page.waitForTimeout(30);const s1=await screenOf(page,g);await page.waitForTimeout(900);const s2=await screenOf(page,g);
   check(engine,view,'左鍵甩動放手後照主地圖的慣性多滑一段（方向不變）',s2[0]>s1[0]+2&&Math.abs(s2[1]-s1[1])<1,`放手後 x ${s1[0].toFixed(1)} → ${s2[0].toFixed(1)} px`);}
  for(let i=0;i<3;i++){await page.mouse.move(cx,r.y+30);await page.mouse.down({button:'right'});await page.mouse.move(cx,r.y+r.h-30,{steps:8});await page.mouse.up({button:'right'});}
  const hi=await cam(page);check(engine,view,'仰角上限 89°',Math.abs(hi.tilt-TMAX)<1e-3,deg(hi.tilt));
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-desktop-top.png`)});
  for(let i=0;i<3;i++){await page.mouse.move(cx,r.y+r.h-30);await page.mouse.down({button:'right'});await page.mouse.move(cx,r.y+30,{steps:8});await page.mouse.up({button:'right'});}
  const lo=await cam(page);check(engine,view,'仰角下限 10°',Math.abs(lo.tilt-TMIN)<1e-3,deg(lo.tilt));
  await page.click('#station');const st=await cam(page);
  check(engine,view,'按「舊站近景」仰角與方位回預設',Math.abs(st.tilt-TILT0)<1e-3&&Math.abs(dAng(st.az,3.6))<1e-3,`${deg(st.tilt)} ${st.az.toFixed(4)}`);
  await page.click('#rotate');const ro=await cam(page);check(engine,view,'「旋轉」鈕仍是 +45°、仰角不變',Math.abs(dAng(ro.az,st.az)-Math.PI/4)<1e-3&&Math.abs(ro.tilt-st.tilt)<1e-9);
  // 滾輪一格（deltaY 100）：拉遠 2/(1+e^(−100/450)) 倍（200 ms 平滑），游標下的地面不動
  {const W=[cx+110,cy-45],g=await groundAt(page,...W);await page.mouse.move(...W);await page.mouse.wheel(0,100);await page.waitForTimeout(700);const wh=await cam(page),s=await screenOf(page,g),miss=Math.hypot(s[0]-W[0],s[1]-W[1]);
   check(engine,view,'滾輪一格以游標為準拉遠 1.111 倍，游標下的地面不動',Math.abs(wh.span/ro.span-2/(1+Math.exp(-100/450)))<.004&&miss<2,`×${(wh.span/ro.span).toFixed(4)}、差 ${miss.toFixed(2)} px`);
   // 雙擊放大一級（可見範圍減半），點的地方不動
   const Q=[cx-120,cy+30],gq=await groundAt(page,...Q);await page.mouse.dblclick(...Q);await page.waitForTimeout(600);const dc=await cam(page),sq=await screenOf(page,gq),mq=Math.hypot(sq[0]-Q[0],sq[1]-Q[1]);
   check(engine,view,'雙擊放大一級（可見範圍減半），點的地方不動',Math.abs(dc.span/wh.span-.5)<1e-6&&mq<2,`×${(dc.span/wh.span).toFixed(4)}、差 ${mq.toFixed(2)} px`);}
  // Windows 在放開右鍵時才送 contextmenu、目標是游標底下的元素（驗收 09-30）：右鍵拖曳轉向到「旋轉」鈕上才放開，接著送的選單事件要被擋；
  // 對照：過了 600 ms 在同一顆鈕上按右鍵，選單照常（不能把整頁的右鍵選單都關掉）
  {const b=await page.locator('#rotate').boundingBox(),bx=b.x+b.width/2,by=b.y+b.height/2,menuAt=()=>page.evaluate(()=>!document.querySelector('#rotate').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
   await page.mouse.move(cx,cy);await page.mouse.down({button:'right'});await page.mouse.move(bx,by,{steps:10});await page.mouse.up({button:'right'});const blocked=await menuAt();
   await page.waitForTimeout(600);const normal=await menuAt();
   check(engine,view,'Windows 右鍵：拖曳轉向後在按鈕上放開不跳選單',blocked);
   check(engine,view,'Windows 右鍵對照：沒拖曳時按鈕上的右鍵選單照常',!normal);}
  // 「下一班到臺南」「臺南發車」只跳時間：跳到下一班到臺南（不算臺南始發）前 25 秒／下一班臺南始發的車開車前 25 秒、取消跟車、畫面中心移回臺南站，方位、仰角、縮放照按之前的。
  // 9/12 封存版按了會連視角一起回舊站近景，封存不改，只驗其他日期。畫面中心每次照畫布當下的位置算（點按鈕可能捲動頁面）。
  if(DATE!=='2026-09-12'){
   await page.click('#station');const home=await centerGround();
   const BTN={'#next':'下一班到臺南','#depart':'臺南發車'};
   const pressNext=async(label,btn='#next')=>{const name=BTN[btn],b=await cam(page),o=await centerGround(),sec0=await page.evaluate(()=>tainanMemory.state.sec),away=Math.hypot(o[0]-home[0],o[1]-home[1]);
    check(engine,view,`「${name}」之前（${label}）：方位、仰角、縮放、畫面中心都不是預設`,Math.abs(dAng(b.az,3.6))>.1&&Math.abs(b.tilt-TILT0)>.1&&Math.abs(b.span/140-1)>.1&&away>5,`${deg(b.tilt)} ${b.az.toFixed(3)} span ${b.span.toFixed(1)} 離站 ${away.toFixed(1)} m`);
    await page.click(btn);await page.waitForTimeout(100);
    const a=await cam(page),c=await centerGround(),s=await page.evaluate(()=>({sec:tainanMemory.state.sec,follow:tainanMemory.state.follow,sel:document.getElementById('train').value})),miss=Math.hypot(c[0]-home[0],c[1]-home[1]);
    // 期望值直接從資料算：「下一班到臺南」取停臺南、不是在臺南始發（end 'origin'）的到站秒數，「臺南發車」取在臺南始發的開車秒數；取第一個晚於按之前 25 秒的，沒有就回到當天第一班（頁面的時間範圍 0–86399）
    const exp=await page.evaluate(([t0,dep])=>{const a=tainanMemory.data.trains.flatMap(tr=>tr.stops.filter(st=>st.name.replace('台','臺')==='臺南'&&(st.end==='origin')===dep).map(st=>dep?st.depSec:st.arrSec)).sort((x,y)=>x-y);return Math.max(0,Math.min(86399,(a.find(x=>x>t0+25)??a[0])-25));},[sec0,btn==='#depart']);
    check(engine,view,`按「${name}」（${label}）：方位、仰角、縮放都不變`,Math.abs(dAng(a.az,b.az))<1e-9&&Math.abs(a.tilt-b.tilt)<1e-9&&Math.abs(a.span/b.span-1)<1e-9,`Δ方位 ${dAng(a.az,b.az).toExponential(1)}、Δ仰角 ${(a.tilt-b.tilt).toExponential(1)}、span ${b.span.toFixed(1)}→${a.span.toFixed(1)}`);
    check(engine,view,`按「${name}」（${label}）：畫面中心回臺南站、跟車取消`,miss<.01&&s.follow===''&&s.sel==='',`離站 ${miss.toFixed(3)} m、follow=${JSON.stringify(s.follow)}`);
    check(engine,view,`按「${name}」（${label}）：時間跳到${btn==='#depart'?'下一班臺南始發的車開車':'下一班到臺南'}前 25 秒`,s.sec===exp,`${hms(sec0)} → ${hms(s.sec)}（應為 ${hms(exp)}）`);};
   // 自由觀看：右鍵拖曳改方位與仰角、滾輪拉遠（等 200 ms 平滑跑完）、左鍵平移離開車站
   await drag([cx,cy],[cx-80,cy-50],{button:'right'});
   await page.mouse.move(cx,cy);await page.mouse.wheel(0,300);await page.waitForTimeout(700);
   await drag([cx-60,cy+40],[cx+90,cy-30]);
   await pressNext('自由觀看');
   // 跟車中：跟下拉選單第一班、按「旋轉」，等鏡頭跟上
   const fid=await page.$eval('#train',el=>el.options[1].value);await page.selectOption('#train',fid);await page.click('#rotate');await page.waitForTimeout(300);
   check(engine,view,'「下一班到臺南」之前正在跟車',await page.evaluate(id=>tainanMemory.state.follow===id,fid),fid);
   await pressNext('跟車中');
   // 23:05：3782 已到臺南，之後只剩仁德—保安的班次，下一班到臺南要回到當天第一班；先平移離開車站
   await page.evaluate(()=>tainanMemory.jump(83100));await drag([cx-60,cy+40],[cx+90,cy-30]);
   await pressNext('23:05 之後');
   // 22:26：下一班停臺南的是 22:28:30 在臺南始發的 3783，「下一班到臺南」要跳過它、「臺南發車」要跳到它；23:05 之後沒有臺南始發的車，「臺南發車」回到當天第一班。每次先平移離開車站
   const awayAt=async sec=>{await page.evaluate(s=>tainanMemory.jump(s),sec);await drag([cx-60,cy+40],[cx+90,cy-30]);};
   await awayAt(80760);await pressNext('22:26，下一班停臺南的是臺南始發');
   await awayAt(80760);await pressNext('22:26','#depart');
   await awayAt(83100);await pressNext('23:05 之後','#depart');
   // 慣性滑行中按「下一班到臺南」：按鈕改鏡頭會先停掉慣性（同主地圖按鈕走 easeTo 會先 stop），畫面中心停在臺南站
   await fling([cx-60,cy],12);await page.click('#next');await page.waitForTimeout(900);
   {const c=await centerGround(),miss=Math.hypot(c[0]-home[0],c[1]-home[1]);check(engine,view,'慣性滑行中按「下一班到臺南」：慣性停下，畫面中心停在臺南站',miss<.01,`離站 ${miss.toFixed(3)} m`);}}
  check(engine,view,'零錯誤',errors.length===0,errors.slice(0,3).join(' | '));
  await context.close();}
 // ── 手機（390×844、觸控）──
 {const view='390x844 touch';const {context,page,errors}=await open(browser,{viewport:{width:390,height:844},isMobile:engine==='chromium',hasTouch:true,deviceScaleFactor:2});
  await hintCheck(engine,view,page);
  const r=await rectOf(page),cx=r.x+r.w/2,cy=r.y+r.h/2,D=Math.PI/180;
  const centerGround=async()=>{const q=await rectOf(page);return groundAt(page,q.x+q.w/2,q.y+q.h/2);};
  const cdp=engine==='chromium'?await context.newCDPSession(page):null;
  // frames：[[ax,ay],[bx,by]] 陣列，第 0 格是按下位置。Chromium 用 CDP 真觸控，放開前停 hold ms（照主地圖，停住再放就沒有慣性）；
  // WebKit 送合成 PointerEvent，一次送完（同一幀，不會有慣性）。
  async function gesture(frames,hold=250){
   if(cdp){const pts=f=>f.map((p,i)=>({x:p[0],y:p[1],id:i+1}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(frames[0])});
    for(const f of frames.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(f)});
    if(hold)await page.waitForTimeout(hold);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else await page.evaluate(frames=>{const el=window.tainanMemory.renderer.domElement,n=frames[0].length;
    const fire=(type,id,p)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:p[0],clientY:p[1],pointerType:'touch',isPrimary:id===1,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
    for(let i=0;i<n;i++)fire('pointerdown',i+1,frames[0][i]);
    for(const f of frames.slice(1))for(let i=0;i<n;i++)fire('pointermove',i+1,f[i]);
    const last=frames[frames.length-1];for(let i=0;i<n;i++)fire('pointerup',i+1,last[i]);},frames);
   await page.waitForTimeout(50);}
  // 點一下：points＝各指位置；count 下，間隔 80 ms
  async function taps(points,count){
   for(let k=0;k<count;k++){
    if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points.map((p,i)=>({x:p[0],y:p[1],id:i+1}))});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else await page.evaluate(points=>{const el=window.tainanMemory.renderer.domElement;const fire=(type,id,p)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:p[0],clientY:p[1],pointerType:'touch',isPrimary:id===1,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
     points.forEach((p,i)=>fire('pointerdown',i+1,p));points.forEach((p,i)=>fire('pointerup',i+1,p));},points);
    await page.waitForTimeout(80);}
   await page.waitForTimeout(600);}
  const steps=12,lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],M=[cx+20,cy+15];
  const miss=(s,p)=>Math.hypot(s[0]-p[0],s[1]-p[1]);
  // 扭轉：兩指繞 M 順時針轉 60°（沿兩指圓周 25 px 之前是門檻，不算），畫面跟著順時針轉、方位變大；兩指中點下的地面不動，縮放、仰角不變
  let c0=await cam(page),g=await groundAt(page,...M);
  await gesture(Array.from({length:13},(_,i)=>{const a=i*5*D;return [[M[0]+60*Math.cos(a),M[1]+60*Math.sin(a)],[M[0]-60*Math.cos(a),M[1]-60*Math.sin(a)]];}));
  let c1=await cam(page),s=await screenOf(page,g);
  check(engine,view,'雙指順時針扭轉 60°：畫面跟著轉（扣掉門檻，方位 +30°～+41°）、繞兩指中點，縮放與仰角不變',dAng(c1.az,c0.az)>30*D&&dAng(c1.az,c0.az)<41*D&&miss(s,M)<2&&Math.abs(c1.span/c0.span-1)<1e-9&&Math.abs(c1.tilt-c0.tilt)<1e-9,`方位 ${(dAng(c1.az,c0.az)/D).toFixed(1)}°、差 ${miss(s,M).toFixed(2)} px`);
  // 捏合：兩指以 M 為中點從相距 80 張到 150（距離變 2^0.1 倍才開始算：一指一個事件，第一指走完是 85、還沒過門檻，第二指走完 90 才開始）。
  // 每指要走超過 30 px：主地圖的雙指點一下（每指移動不超過 30 px、500 ms 內放開）不會被捏合擋掉，走剛好 30 px 放開會再縮小一級。
  c0=await cam(page);g=await groundAt(page,...M);
  await gesture(Array.from({length:8},(_,i)=>[[M[0]-40-i*5,M[1]],[M[0]+40+i*5,M[1]]]));
  c1=await cam(page);s=await screenOf(page,g);
  check(engine,view,'雙指張開 80→150 px：可見範圍 ×85/150、繞兩指中點，方位與仰角不變',Math.abs(c1.span/c0.span-85/150)<.002&&miss(s,M)<2&&Math.abs(dAng(c1.az,c0.az))<1e-9&&Math.abs(c1.tilt-c0.tilt)<1e-9,`×${(c1.span/c0.span).toFixed(4)}、差 ${miss(s,M).toFixed(2)} px`);
  // 兩指一起往上推 40 px（每步 5 px）：鏡頭放低 20°（0.5°/px），只改仰角，畫面中心的地面不動
  c0=await cam(page);let g0=await centerGround();
  await gesture(Array.from({length:9},(_,i)=>[[cx-50,cy+20-5*i],[cx+50,cy+20-5*i]]));
  c1=await cam(page);let g1=await centerGround();
  check(engine,view,'雙指一起上推 40 px：仰角 −20°，方位、縮放、畫面中心都不變',Math.abs(c1.tilt-c0.tilt+20*D)<1e-6&&Math.abs(dAng(c1.az,c0.az))<1e-9&&Math.abs(c1.span/c0.span-1)<1e-9&&Math.hypot(g1[0]-g0[0],g1[1]-g0[1])<1e-6,(c1.tilt-c0.tilt).toFixed(4));
  // 快速推（驗收 09-30：每個事件每指走 17～25 px）：先往下 4×17 px，再往上 3×25 px
  c0=await cam(page);await gesture(Array.from({length:5},(_,i)=>[[cx-50,cy-40+17*i],[cx+50,cy-40+17*i]]));c1=await cam(page);
  check(engine,view,'雙指快速下推（每步 17 px）68 px：仰角 +34°',Math.abs(c1.tilt-c0.tilt-34*D)<1e-6,(c1.tilt-c0.tilt).toFixed(4));
  let c2=c1;await gesture(Array.from({length:4},(_,i)=>[[cx-50,cy+40-25*i],[cx+50,cy+40-25*i]]));c1=await cam(page);
  check(engine,view,'雙指快速上推（每步 25 px）75 px：仰角 −37.5°',Math.abs(c1.tilt-c2.tilt+37.5*D)<1e-6,(c1.tilt-c2.tilt).toFixed(4));
  check(engine,view,'雙指快速推：方位、縮放不變',Math.abs(dAng(c1.az,c0.az))<1e-9&&Math.abs(c1.span/c0.span-1)<1e-9);
  // 兩指靠近（驗收 09-30：間距 50 px、每步 8 px）
  c0=await cam(page);await gesture(Array.from({length:9},(_,i)=>[[cx-25,cy-40+8*i],[cx+25,cy-40+8*i]]));c1=await cam(page);
  check(engine,view,'雙指靠近（間距 50 px）每步 8 px 下推 64 px：仰角 +32°',Math.abs(c1.tilt-c0.tilt-32*D)<1e-6,(c1.tilt-c0.tilt).toFixed(4));
  c2=c1;await gesture(Array.from({length:7},(_,i)=>[[cx-25,cy+40-8*i],[cx+25,cy+40-8*i]]));c1=await cam(page);
  check(engine,view,'雙指靠近（間距 50 px）每步 8 px 上推 48 px：仰角 −24°，方位、縮放不變',Math.abs(c1.tilt-c2.tilt+24*D)<1e-6&&Math.abs(dAng(c1.az,c0.az))<1e-9&&Math.abs(c1.span/c0.span-1)<1e-9,(c1.tilt-c2.tilt).toFixed(4));
  // 兩指上下疊著一起往下拖：照主地圖不算推仰角（開始時兩指連線偏垂直就不推），是平移——兩指中點下的地面跟著走
  {c0=await cam(page);const A=[cx,cy-90],B=[cx,cy+10],m0=[cx,cy-40],gm=await groundAt(page,...m0);
   await gesture(Array.from({length:9},(_,i)=>[[A[0],A[1]+8*i],[B[0],B[1]+8*i]]));c1=await cam(page);const sm=await screenOf(page,gm);
   check(engine,view,'兩指上下疊著往下拖 64 px：不改仰角，是平移（中點下的地面跟著手指）',Math.abs(c1.tilt-c0.tilt)<1e-9&&Math.abs(dAng(c1.az,c0.az))<1e-9&&Math.abs(c1.span/c0.span-1)<1e-6&&miss(sm,[cx,cy+24])<2,`仰角 ${(c1.tilt-c0.tilt).toFixed(4)}、差 ${miss(sm,[cx,cy+24]).toFixed(2)} px`);}
  // 對照：一指按著只抖 1 px、另一指往上移 60 px＝繞著按住的那指轉，不能當成傾斜
  c0=await cam(page);await gesture(Array.from({length:11},(_,i)=>[[cx-50,cy-(i?1:0)],[cx+50,cy-6*i]]));c1=await cam(page);
  check(engine,view,'一指按著（只抖 1 px）、另一指上移 60 px：不改仰角，畫面逆時針轉（方位變小）',Math.abs(c1.tilt-c0.tilt)<1e-9&&dAng(c1.az,c0.az)<0,`仰角 ${(c1.tilt-c0.tilt).toFixed(4)}、方位 ${dAng(c1.az,c0.az).toFixed(4)}`);
  // 三指（驗收 09-30：兩指捏合中第三指碰到、再抬起第一指，舊版剩下兩指沿用舊基準，1 px 的移動就讓方位跳 116°）：兩引擎都用合成 PointerEvent。
  // 照主地圖：雙指手勢只認最先放上的兩指，其中一指離開就結束，剩下的指頭只平移，要再放下一指才重新算捏合、扭轉。
  const tf=await page.evaluate(([cx,cy])=>{const el=window.tainanMemory.renderer.domElement,c=window.tainanMemory.camera;
   const fire=(type,id,x,y)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',isPrimary:id===11,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
   const now=()=>{const e=c.matrixWorld.elements;return {tilt:Math.asin(e[10]),az:Math.atan2(e[9],e[8]),span:c.top-c.bottom};};
   const z0=now();fire('pointerdown',11,cx-50,cy);fire('pointerdown',12,cx+50,cy);
   for(let i=1;i<=4;i++){fire('pointermove',11,cx-50-5*i,cy);fire('pointermove',12,cx+50+5*i,cy);}      // 兩指先捏合開一點（100→140 px）
   const z1=now();fire('pointerdown',13,cx,cy+120);fire('pointerup',11,cx-70,cy);
   const a=now();fire('pointermove',12,cx+71,cy);const b=now();
   const p2=[cx+71,cy],p3=[cx,cy+120];      // 剩下兩指：13 沿連線往內走到一半距離
   for(let i=1;i<=10;i++){const t=1-i/20;fire('pointermove',13,p2[0]+(p3[0]-p2[0])*t,p2[1]+(p3[1]-p2[1])*t);}
   const d=now();fire('pointerup',12,...p2);fire('pointerup',13,p2[0]+(p3[0]-p2[0])*.5,p2[1]+(p3[1]-p2[1])*.5);return {z0,z1,a,b,d};},[cx,cy]);
  check(engine,view,'三指之前兩指捏合有作用（相距 100→140）',tf.z1.span<tf.z0.span*.8,`span×${(tf.z1.span/tf.z0.span).toFixed(3)}`);
  check(engine,view,'三指：放下第三指再抬起第一指，剩下的指頭動 1 px 鏡頭不跳',Math.abs(dAng(tf.b.az,tf.a.az))<1e-9&&Math.abs(tf.b.span/tf.a.span-1)<1e-9&&Math.abs(tf.b.tilt-tf.a.tilt)<1e-9,`Δ方位 ${dAng(tf.b.az,tf.a.az).toFixed(4)}、span×${(tf.b.span/tf.a.span).toFixed(4)}`);
  check(engine,view,'三指後剩下兩指不接著捏合、扭轉（同主地圖：只認最先放上的兩指）',Math.abs(tf.d.span/tf.b.span-1)<1e-9&&Math.abs(dAng(tf.d.az,tf.b.az))<1e-9,`span×${(tf.d.span/tf.b.span).toFixed(3)}、Δ方位 ${dAng(tf.d.az,tf.b.az).toFixed(4)}`);
  // 單指平移：起點地面點停在手指下
  {const start=[cx-10,cy+60],end=[cx+20,cy-40],gs=await groundAt(page,...start);
   await gesture(Array.from({length:steps+1},(_,i)=>[lerp(start,end,i/steps)]));
   const ss=await screenOf(page,gs);check(engine,view,'單指平移：起點的地面點停在手指下',miss(ss,end)<2,`差 ${miss(ss,end).toFixed(2)} px`);}
  // 雙點放大一級、雙指點一下縮小一級，都以點的位置為準。先回舊站近景（span 140）：前面的捏合已經縮到接近下限 34，再放大一級會被下限截住
  await page.tap('#station');
  {const T=[cx-30,cy-20],gt=await groundAt(page,...T),b=await cam(page);await taps([T],2);const a=await cam(page),st=await screenOf(page,gt);
   check(engine,view,'雙點放大一級（可見範圍減半），點的地方不動',Math.abs(a.span/b.span-.5)<1e-6&&miss(st,T)<2,`×${(a.span/b.span).toFixed(4)}、差 ${miss(st,T).toFixed(2)} px`);
   await taps([[cx-40,cy],[cx+40,cy]],1);const z=await cam(page);
   check(engine,view,'雙指點一下縮小一級（可見範圍加倍）',Math.abs(z.span/a.span-2)<1e-6,`×${(z.span/a.span).toFixed(4)}`);}
  // 單指甩動：照主地圖的慣性多滑一段（只有 CDP 真觸控有時間差；合成事件一次送完沒有慣性）
  if(cdp){const start=[cx-50,cy],gs=await groundAt(page,...start);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start[0],y:start[1],id:1}]});
   for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start[0]+i*14,y:start[1],id:1}]});await page.waitForTimeout(16);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(30);const s1=await screenOf(page,gs);await page.waitForTimeout(900);const s2=await screenOf(page,gs);
   check(engine,view,'單指甩動放手後照主地圖的慣性多滑一段',s2[0]>s1[0]+2,`放手後 x ${s1[0].toFixed(1)} → ${s2[0].toFixed(1)} px`);}
  await page.screenshot({path:path.join(OUT,'shots',`${engine}-mobile-after-gestures.png`)});
  await page.tap('#station');const st=await cam(page);
  check(engine,view,'點「舊站近景」回預設仰角與方位',Math.abs(st.tilt-TILT0)<1e-3&&Math.abs(dAng(st.az,3.6))<1e-3);
  if(DATE!=='2026-09-12'){// 「下一班到臺南」保留視角（說明見桌機那段）：點「旋轉」「＋」、單指平移、雙指往上推壓低仰角之後再點
   const home=await centerGround();await page.tap('#rotate');await page.tap('#zoomin');
   await gesture(Array.from({length:steps+1},(_,i)=>[lerp([cx-10,cy+60],[cx+30,cy-30],i/steps)]));
   await gesture(Array.from({length:steps+1},(_,i)=>{const t=i/steps;return [lerp([cx-60,cy+40],[cx-60,cy-40],t),lerp([cx+60,cy+40],[cx+60,cy-40],t)];}));
   const b=await cam(page),o=await centerGround(),away=Math.hypot(o[0]-home[0],o[1]-home[1]);await page.tap('#next');await page.waitForTimeout(100);
   const a=await cam(page),c=await centerGround(),f=await page.evaluate(()=>tainanMemory.state.follow),off=Math.hypot(c[0]-home[0],c[1]-home[1]);
   check(engine,view,'「下一班到臺南」之前：方位、仰角、縮放、畫面中心都不是預設',Math.abs(dAng(b.az,3.6))>.1&&Math.abs(b.tilt-TILT0)>.05&&Math.abs(b.span/140-1)>.1&&away>2,`${deg(b.tilt)} ${b.az.toFixed(3)} span ${b.span.toFixed(1)} 離站 ${away.toFixed(1)} m`);
   check(engine,view,'點「下一班到臺南」：方位、仰角、縮放都不變，畫面中心回臺南站',Math.abs(dAng(a.az,b.az))<1e-9&&Math.abs(a.tilt-b.tilt)<1e-9&&Math.abs(a.span/b.span-1)<1e-9&&off<.01&&f==='',`Δ方位 ${dAng(a.az,b.az).toExponential(1)}、Δ仰角 ${(a.tilt-b.tilt).toExponential(1)}、離站 ${off.toFixed(3)} m`);}
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

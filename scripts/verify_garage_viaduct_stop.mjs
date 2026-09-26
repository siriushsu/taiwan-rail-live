// 高架停站開門：瀏覽器判準。用法：node --no-warnings scripts/verify_garage_viaduct_stop.mjs [S1 S2 …]；不帶參數跑全部。
// 伺服器：preview_start garage-5251（worktree 根目錄）。瀏覽器一律無視窗：Chrome channel:'chrome'＋headless:true、WebKit headless。
import {chromium,webkit} from 'playwright';
import {mkdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createStopTimetable} from '../rail-3d/garage-scenes/stop-timetable.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),BASE_SHA='65682ab6b492f8ede13b890f3689de468ed69bb2';
// 頁面網址不命名為 URL：那會蓋掉 Node 的全域 URL 類別。
const SITE=process.env.GARAGE_BASE_URL||'http://127.0.0.1:5251',PAGE=process.env.GARAGE_VIADUCT_URL||SITE+'/prototypes/garage-viaduct/';
const OUT=path.join(ROOT,'output/viaduct-stop');mkdirSync(OUT,{recursive:true});
const want=new Set(process.argv.slice(2)),on=k=>!want.size||want.has(k);
const ENGINES={chromium:()=>chromium.launch({channel:'chrome',headless:true}),webkit:()=>webkit.launch({headless:true})};
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,400));}
// 設計書第 7 節的常數，與實作分開另抄一份：S1 用它獨立算出「應該是什麼」。
const SPEC={brake:5,dwell:15,accel:6,doorMove:3,settle:.8,closeHold:.5,speed:2.1};
const st=p=>p.evaluate(()=>viaductPreview.state);
// 頁面內的像素工具：截圖留在頁面裡，只把統計值傳回 Node（整張 1280×900 搬回來太慢）。
function pixelTools(){const shots=new Map(),canvas=()=>document.querySelector('#scene');
 const box=(s,r)=>({x0:Math.max(0,Math.floor(r?r.x:0)),y0:Math.max(0,Math.floor(r?r.y:0)),x1:Math.min(s.w,Math.ceil(r?r.x+r.w:s.w)),y1:Math.min(s.h,Math.ceil(r?r.y+r.h:s.h))});
 const far=(A,B,i,thr)=>Math.max(Math.abs(A.d[i]-B.d[i]),Math.abs(A.d[i+1]-B.d[i+1]),Math.abs(A.d[i+2]-B.d[i+2]))>thr;
 window.__px={
  // 先重畫、同一個 task 內讀 WebGL 緩衝（不需要 preserveDrawingBuffer）。
  async shot(name){viaductPreview.render();return window.__px.load(name,canvas().toDataURL());},
  async load(name,url){const im=new Image();im.src=url;await im.decode();const o=document.createElement('canvas');o.width=im.width;o.height=im.height;const x=o.getContext('2d');x.drawImage(im,0,0);shots.set(name,{w:o.width,h:o.height,d:x.getImageData(0,0,o.width,o.height).data,url});return{w:o.width,h:o.height};},
  url:name=>shots.get(name).url,
  // rect 內任一通道差 >thr 的像素比例；thr=0 時回傳差異像素的個數。
  diff(a,b,r,thr=24){const A=shots.get(a),B=shots.get(b),{x0,y0,x1,y1}=box(A,r);let n=0,all=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){all++;if(far(A,B,(y*A.w+x)*4,thr))n++;}return thr===0?n:n/Math.max(1,all);},
  // rect（可省略）內的平均色與亮度；mask=[a,b,thr] 時只算 a、b 兩張不同的像素。
  mean(name,r,mask){const S=shots.get(name),M=mask&&[shots.get(mask[0]),shots.get(mask[1]),mask[2]??24],{x0,y0,x1,y1}=box(S,r);let R=0,G=0,B=0,n=0;
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*S.w+x)*4;if(M&&!far(M[0],M[1],i,M[2]))continue;R+=S.d[i];G+=S.d[i+1];B+=S.d[i+2];n++;}
   const k=Math.max(1,n);return{n,r:R/k,g:G/k,b:B/k,l:(.2126*R+.7152*G+.0722*B)/k};},
  // 洋紅背景下的車身遮罩：交集／聯集，與聯集內色差像素的比例。
  carIoU(a,b,thr=24){const A=shots.get(a),B=shots.get(b),car=(d,i)=>Math.abs(d[i]-255)+d[i+1]+Math.abs(d[i+2]-255)>60;let I=0,U=0,off=0;
   for(let i=0;i<A.d.length;i+=4){const x=car(A.d,i),y=car(B.d,i);if(x||y){U++;if(x&&y)I++;if(far(A,B,i,thr))off++;}}
   return{iou:I/Math.max(1,U),offShare:off/Math.max(1,U),union:U};}
 };}
async function open(b,opts={},before){const ctx=await b.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1,...opts});if(before)await before(ctx);
 // 無視窗 Chrome（channel:'chrome'）會自動要 /favicon.ico，原型頁本來就沒有這個檔；那一筆 404 不是頁面的錯，只濾它。
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error'&&!/\/favicon\.ico(\?|$)/.test(m.location()?.url||''))errors.push(m.text());});
 await p.addInitScript(pixelTools);await p.goto(PAGE);await p.waitForFunction(()=>window.viaductPreview?.state.ready,null,{timeout:90000});
 if((await st(p)).running)await p.click('#play');   // 從暫停開始：畫面只由 setTime 決定
 return{p,ctx,errors};}
const settled=p=>p.waitForFunction(()=>{const s=viaductPreview.state;return s.canopyOpacity===s.canopyTarget;},null,{timeout:10000});
async function at(p,t){await p.evaluate(t=>viaductPreview.setTime(t),t);await settled(p);return st(p);}
async function cam(p,o){await p.evaluate(o=>viaductPreview.setCamera(o),o);await settled(p);return st(p);}
// 車門在畫面上的方框：門中心與它上方 0.35 世界單位兩點投影；高＝2×距離、寬＝0.6×距離（落在門洞內）。
const doorRects=(p,which='platform')=>p.evaluate(which=>{const api=viaductPreview,c=document.querySelector('#scene');
 return api.doorPoints(which).map(q=>{const a=api.project(q),b=api.project([q[0],q[1],q[2]+.35]),h=Math.abs(a.y-b.y),w=.6*h,r={x:a.x-w/2,y:a.y-h,w,h:2*h};r.on=r.x>=0&&r.y>=0&&r.x+r.w<=c.width&&r.y+r.h<=c.height;return r;});},which);
const SECTIONS=[];const section=(id,fn,engines=['chromium','webkit'])=>SECTIONS.push({id,fn,engines});

// S1 時刻表接線：頁面的階段、門、速度、圈數與另抄的規格一致；停站時中間車在月台中心。
section('S1',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const L=(await st(p)).pathLength,v=SPEC.speed,depart=SPEC.brake+SPEC.dwell,cruise=depart+SPEC.accel,lap=cruise+(L-v*SPEC.brake/2-v*SPEC.accel/2)/v;
 const openS=SPEC.brake+SPEC.settle,openE=openS+SPEC.doorMove,closeE=depart-SPEC.closeHold,closeS=closeE-SPEC.doorMove;
 const expect=u=>u<SPEC.brake?{phase:'braking',v:v*(1-u/SPEC.brake),doors:0}:u<depart?{phase:'stopped',v:0,doors:u<openS||u>=closeE?0:u<openE?(u-openS)/SPEC.doorMove:u<closeS?1:1-(u-closeS)/SPEC.doorMove}:u<cruise?{phase:'accelerating',v:v*(u-depart)/SPEC.accel,doors:0}:{phase:'cruising',v,doors:0};
 for(const n of [0,1])for(const u of [.1,2.5,5.4,7.3,12,18,19.7,23,40]){const s=await at(p,n*lap+u),w=expect(u);
  check(`${engine} S1 第 ${n} 圈 u=${u}：階段、門、速度、停車位置`,s.lap===n&&s.phase===w.phase&&Math.abs(s.doors-w.doors)<1e-6&&Math.abs(s.currentSpeed-w.v)<1e-6&&(s.phase!=='stopped'||Math.abs(s.poses[1].x)<.01),{got:{lap:s.lap,phase:s.phase,doors:s.doors,v:s.currentSpeed,x:s.poses[1].x},want:w});}
 check(engine+' S1 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S2 月台貼齊（設計書 12.2）：停站時車身側面到月台邊的間隙、車門踏板對月台面。
section('S2',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await at(p,12);
 const r=await p.evaluate(()=>{const api=viaductPreview;return{minY:Math.min(...api.cars().map(c=>c.min[1])),edge:api.platform.edge,top:api.platform.top,sill:api.sill()};});
 const gap=r.minY-r.edge;
 check(`${engine} S2 車身側面到月台邊間隙 0.03～0.1`,gap>=.03&&gap<=.1,{gap,...r});
 check(`${engine} S2 車門踏板與月台面高度差 <0.01`,Math.abs(r.sill-r.top)<.01,{diff:r.sill-r.top,...r});
 check(engine+' S2 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S3 雨棚淡出與門口可見（12.5）：全景、跟車擋到門就淡，月台低角度不淡；門口的像素要真的看得到車。
section('S3',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await p.evaluate(()=>viaductPreview.peopleVisible?.(false));
 // 量在「停穩、門還沒開」的 5.5 秒（煞停 5、開門 5.8）：雨棚擋不擋只看停車位置，跟門開沒開無關。
 // 09-26 起門框取真實車門位置、門也真的會開；門全開時淺色門洞跟後方淺色高架差不到 24，沒被擋也量成看不到（實測 0.17～0.49），所以不量在開門中。
 await at(p,5.5);
 // 同一個鏡頭、同一個時刻：有車與沒車兩張，比月台側每個畫面內門框的差異比例。
 const seenDoors=async()=>{await p.evaluate(async()=>{await __px.shot('on');viaductPreview.trainVisible(false);await __px.shot('off');viaductPreview.trainVisible(true);});
  const rects=(await doorRects(p,'platform')).filter(r=>r.on),seen=[];for(const r of rects)seen.push(await p.evaluate(r=>__px.diff('on','off',r),r));return seen;};
 for(const view of ['world','train','platform']){const s=await cam(p,{view}),seen=await seenDoors();
  const opacityOk=view==='platform'?s.canopyOpacity===1:s.canopyOpacity<=.3;
  check(`${engine} S3 ${view}：雨棚不透明度${view==='platform'?'＝1':' ≤0.3'}，≥2 扇畫面內的門、每扇都看得到（seen>0.3）`,opacityOk&&seen.length>=2&&seen.every(x=>x>.3),{opacity:s.canopyOpacity,seen});}
 // 對照組：關掉淡出，全景看停站時雨棚不透明，至少一扇門被擋住。證明上面的判準分得出擋與不擋。
 await cam(p,{view:'world'});await p.evaluate(()=>viaductPreview.setCanopyFade(false));await settled(p);
 const s=await st(p),seen=await seenDoors();
 check(`${engine} S3 對照組：關掉淡出時雨棚不透明，至少一扇門被擋（seen<0.2）`,s.canopyOpacity===1&&seen.some(x=>x<.2),{opacity:s.canopyOpacity,seen});
 await p.evaluate(()=>viaductPreview.setCanopyFade(true));await settled(p);
 check(engine+' S3 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S4 看月台（12.8、Review Focus 1）：手機觸控實際點按鈕。巡航中快轉到下一次進站；減速、停站中不跳；連按兩次不再跳。
section('S4',async(b,engine)=>{const {p,ctx,errors}=await open(b,{viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{
 const T=await p.evaluate(()=>viaductPreview.timetable);
 await p.evaluate(t=>viaductPreview.setTime(t),T.phases.cruiseAt+10);await p.tap('#platform');let s=await st(p);
 check(`${engine} S4 巡航中按看月台：切月台低角度、開始播放、快轉到下一次進站減速`,s.view==='platform'&&s.running===true&&s.lap===1&&s.time>=T.lap&&s.time<T.lap+1&&s.phase==='braking',{view:s.view,running:s.running,lap:s.lap,time:s.time,lapLen:T.lap,phase:s.phase});
 const t1=s.time;await p.tap('#platform');s=await st(p);
 check(`${engine} S4 再按一次看月台：不再跳`,s.lap===1&&s.time-t1>=0&&s.time-t1<1.5,{lap:s.lap,dt:s.time-t1});
 await p.tap('#play');await p.evaluate(t=>viaductPreview.setTime(t),2*T.lap+2);await p.tap('#platform');s=await st(p);
 check(`${engine} S4 減速中按看月台：時間不跳`,s.time>=2*T.lap+2&&s.time<2*T.lap+3.5,{time:s.time,from:2*T.lap+2});
 await p.tap('#play');await p.evaluate(t=>viaductPreview.setTime(t),2*T.lap+12);await p.tap('#platform');s=await st(p);
 check(`${engine} S4 停站中按看月台：時間不跳`,s.time>=2*T.lap+12&&s.time<2*T.lap+13.5&&s.phase==='stopped',{time:s.time,from:2*T.lap+12,phase:s.phase});
 // 畫布自己也帶 data-view（draw() 寫的狀態標記），所以只數按鈕；畫布是 role="img"，不該被標成「按下」。
 const pressed=await p.evaluate(()=>({platform:document.querySelector('#platform').getAttribute('aria-pressed'),views:[...document.querySelectorAll('button[data-view]')].map(b=>b.getAttribute('aria-pressed')),canvas:document.querySelector('#scene').getAttribute('aria-pressed')}));
 await p.tap('[data-view="world"]');const after=await p.evaluate(()=>document.querySelector('#platform').getAttribute('aria-pressed'));
 check(`${engine} S4 aria-pressed：看月台時只有 #platform 按下，切回全景就放開`,pressed.platform==='true'&&pressed.views.length>0&&pressed.views.every(v=>v==='false')&&pressed.canvas===null&&after==='false',{pressed,after});
 check(engine+' S4 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S5 暫停中拖鏡頭（Review Focus 2）：雨棚跟著新角度淡入淡出、時間不動；漸變結束就停止重繪。
section('S5',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await cam(p,{view:'world'});let s=await at(p,12);const t0=s.time;
 check(`${engine} S5 全景停站：雨棚淡掉`,s.canopyOpacity<=.3,{opacity:s.canopyOpacity});
 s=await cam(p,{elevation:.2,yaw:-1.35});
 check(`${engine} S5 暫停中轉到低角度：雨棚回到不透明、時間不動、仍暫停`,s.canopyOpacity===1&&s.time===t0&&s.running===false,{opacity:s.canopyOpacity,time:s.time,t0,running:s.running});
 const d0=(await st(p)).draws;await p.waitForTimeout(400);const d1=(await st(p)).draws;
 check(`${engine} S5 淡完就停止重繪（400 ms 內 draws 不變）`,d0===d1,{d0,d1});
 check(engine+' S5 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S6 檢查點 1 截圖：進站減速、停站雨棚淡（全景、跟車）、看月台。
section('S6',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const dir=path.join(OUT,'checkpoint-1');mkdirSync(dir,{recursive:true});
 const shots=[['1-進站減速-全景.png','world',2.5],['2-停站雨棚淡-全景.png','world',12],['3-停站雨棚淡-跟車.png','train',12],['4-看月台.png','platform',12]],sizes=[];
 for(const [name,view,t] of shots){await cam(p,{view});await at(p,t);const file=path.join(dir,name);await p.screenshot({path:file});sizes.push([name,readFileSync(file).length]);}
 check(`${engine} S6 檢查點 1 四張截圖都在且各 >20 KB`,sizes.length===4&&sizes.every(([,n])=>n>20*1024),sizes);
 check(engine+' S6 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}},['chromium']);

const shotIn=(p,name)=>p.evaluate(n=>__px.shot(n),name);
const baseFile=f=>execFileSync('git',['-C',ROOT,'show',BASE_SHA+':'+f],{encoding:'buffer',maxBuffer:64<<20});

// S7 車門開關（12.3）：月台側門口關門／全開兩張逐像素差異大、另一側差異近 0（不能只信程式記錄的門位置）。
// 開門過程逐格截圖（設計書 §14：門扇內退時可能與門洞邊緣互搶深度），破面與閃爍由檢查點 2 與 Task 9 目視。
section('S7',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const T=await p.evaluate(()=>viaductPreview.timetable),dir=path.join(OUT,'checkpoint-2');mkdirSync(path.join(dir,'開門過程'),{recursive:true});
 const snap=async name=>{if(engine==='chromium')await p.screenshot({path:path.join(dir,name)});};
 await p.evaluate(()=>viaductPreview.peopleVisible?.(false));await cam(p,{view:'platform'});
 await at(p,T.phases.openStart-.3);await shotIn(p,'closed');await snap('5-關門.png');
 await at(p,T.phases.openStart+1);await shotIn(p,'opening1');
 await at(p,T.phases.openStart+1.5);await snap('6-開門中.png');
 await at(p,T.phases.openStart+2);await shotIn(p,'opening2');
 await at(p,T.showcase);await shotIn(p,'open');await snap('7-全開.png');
 const near=(await doorRects(p,'platform')).filter(r=>r.on),nd=[],md=[];for(const r of near){nd.push(await p.evaluate(r=>__px.diff('closed','open',r),r));md.push(await p.evaluate(r=>__px.diff('opening1','opening2',r),r));}
 check(`${engine} S7 月台側：畫面內 ≥3 扇門、每扇關門與全開差異 >0.25`,near.length>=3&&nd.every(x=>x>.25),{doors:near.length,diff:nd});
 // 門扇 0.4 s 後開始滑進壁袋，1.0 s 與 2.0 s 之間滑了約四成行程，門口畫面一定要變。
 // 09-26 實例：門洞被車殼的封板擋住，門扇一內退就看不見，1.0 s 到全開每一格都一樣，只比關門與全開的判準照不到。
 check(`${engine} S7 月台側開門過程：每扇門 1.0 s 與 2.0 s 的門口差異 >0.05（看得到門扇在滑）`,near.length>=3&&md.every(x=>x>.05),{doors:near.length,diff:md});
 await cam(p,{view:'train',yaw:-1.12+Math.PI,elevation:.3});
 await at(p,T.phases.openStart-.3);await shotIn(p,'farClosed');await at(p,T.showcase);await shotIn(p,'farOpen');
 const far=(await doorRects(p,'far')).filter(r=>r.on),fd=[];for(const r of far)fd.push(await p.evaluate(r=>__px.diff('farClosed','farOpen',r),r));
 check(`${engine} S7 另一側：畫面內 ≥4 扇門、每扇差異 <0.03（不開）`,far.length>=4&&fd.every(x=>x<.03),{doors:far.length,diff:fd});
 if(engine==='chromium'){await cam(p,{view:'platform',zoom:1.6});const sizes=[];
  for(const dt of [.1,.2,.3,.4,.6,1,2,3]){await at(p,T.phases.openStart+dt);const file=path.join(dir,'開門過程',dt.toFixed(1)+'.png');await p.screenshot({path:file});sizes.push([dt,readFileSync(file).length]);}
  check(`${engine} S7 開門過程八格截圖都在且各 >20 KB`,sizes.length===8&&sizes.every(([,n])=>n>20*1024),sizes);}
 check(engine+' S7 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S8 舊程式相容（12.4）：改動前的 garage-model.js 載入新車模＝關門的完整車身，與「舊程式＋舊車模」逐像素幾乎相同。
// A 頁舊程式＋新車模；B 頁舊程式＋舊車模（BASE 的 json／bin.gz）。舊程式另外轉出現在的 loadGarageParts，主程式照樣能 import。
// 對照組：新程式同一頁開門與關門，證明開門的差別量得出來。
section('S8',async(b,engine)=>{
 const OLD=execFileSync('git',['-C',ROOT,'show',BASE_SHA+':rail-3d/garage-model.js'],{encoding:'utf8'}),js=body=>({status:200,contentType:'text/javascript',body});
 const oldLoader=async ctx=>{await ctx.route('**/rail-3d/garage-model.js*',r=>r.fulfill(js(OLD+"\nexport {loadGarageParts} from './garage-model-now.js';\n")));
  await ctx.route('**/rail-3d/garage-model-now.js*',r=>r.fulfill(js(readFileSync(path.join(ROOT,'rail-3d/garage-model.js'),'utf8'))));};
 const frame=async p=>{await p.evaluate(()=>viaductPreview.isolate(true));await cam(p,{view:'train'});await at(p,12);};
 let url;
 {const {p,ctx,errors}=await open(b,{},oldLoader);try{await frame(p);await shotIn(p,'a');url=await p.evaluate(()=>__px.url('a'));
  check(engine+' S8 A 頁（舊程式＋新車模）沒有 JS 錯誤',errors.length===0,errors);}finally{await ctx.close();}}
 {const {p,ctx,errors}=await open(b,{},async ctx=>{await oldLoader(ctx);
   await ctx.route('**/garage-blender-v1/emu3000.json',r=>r.fulfill({status:200,contentType:'application/json',body:baseFile('rail-3d/assets/garage-blender-v1/emu3000.json')}));
   await ctx.route('**/garage-blender-v1/emu3000.bin.gz',r=>r.fulfill({status:200,contentType:'application/gzip',body:baseFile('rail-3d/assets/garage-blender-v1/emu3000.bin.gz')}));});
  try{await frame(p);await shotIn(p,'b');const r=await p.evaluate(async url=>{await __px.load('a',url);return __px.carIoU('a','b');},url);
   check(`${engine} S8 舊程式載入新車模＝關門完整車身（與舊程式＋舊車模 IoU ≥0.995、色差像素 ≤1%）`,r.iou>=.995&&r.offShare<=.01,r);
   check(engine+' S8 B 頁（舊程式＋舊車模）沒有 JS 錯誤',errors.length===0,errors);}finally{await ctx.close();}}
 {const {p,ctx,errors}=await open(b);try{const T=await p.evaluate(()=>viaductPreview.timetable);await p.evaluate(()=>viaductPreview.isolate(true));await cam(p,{view:'train'});
  await at(p,T.showcase);await shotIn(p,'o');await at(p,T.phases.openStart-.3);await shotIn(p,'c');const r=await p.evaluate(()=>__px.carIoU('o','c'));
  check(`${engine} S8 對照組：新程式開門與關門的車身色差像素 ≥3%（量得出開門）`,r.offShare>=.03,r);
  check(engine+' S8 對照組沒有 JS 錯誤',errors.length===0,errors);}finally{await ctx.close();}}
});

// S9 高架集電弓（12.6）：弓頭貼住電車線（高度差 ≤0.02）、電車線是平的；沒有電車線就降弓。
section('S9',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await at(p,12);
 const r=await p.evaluate(()=>({panto:viaductPreview.pantographs(),wire:viaductPreview.wireBox(),z:viaductPreview.contactWireZ})),h=r.panto[0];
 check(`${engine} S9 一支集電弓、升到電車線（reached）`,r.panto.length===1&&h.reached&&!h.folded,r.panto);
 check(`${engine} S9 電車線是平的、弓頭與線底高度差 ≤0.02`,!!h&&r.wire.max[2]-r.wire.min[2]<1e-4&&Math.abs(r.wire.min[2]-h.head[2])<=.02,{wire:r.wire,head:h?.head,z:r.z});
 const down=await p.evaluate(()=>{viaductPreview.setContactWire(null);return viaductPreview.pantographs();});
 check(`${engine} S9 沒有電車線時降弓（folded、弓頭離鉸鏈 <0.05）`,down.length===1&&down[0].folded&&down[0].head[2]-down[0].hinge[2]<.05,down);
 await p.evaluate(()=>viaductPreview.setContactWire(viaductPreview.contactWireZ));
 check(engine+' S9 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S10 夜晚開門（Review Focus 3）：門內頂燈（window 發光角色）在開門時透出暖光，關門時不透；窗燈照常。
section('S10',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const T=await p.evaluate(()=>viaductPreview.timetable);
 await p.click('button[data-period="night"]');await p.evaluate(()=>viaductPreview.peopleVisible?.(false));await cam(p,{view:'platform'});
 await at(p,T.phases.openStart-.3);await shotIn(p,'nc');const s=await at(p,T.showcase);await shotIn(p,'no');
 const rects=(await doorRects(p,'platform')).filter(r=>r.on),m=[];for(const r of rects)m.push(await p.evaluate(r=>({closed:__px.mean('nc',r),open:__px.mean('no',r)}),r));
 check(`${engine} S10 夜晚：畫面內 ≥2 扇月台側門，開門後門口變亮（+8）且偏暖（R>B）`,m.length>=2&&m.every(x=>x.open.l>x.closed.l+8&&x.open.r>x.open.b),m.map(x=>({closed:+x.closed.l.toFixed(1),open:+x.open.l.toFixed(1),r:+x.open.r.toFixed(1),b:+x.open.b.toFixed(1)})));
 check(`${engine} S10 夜晚窗燈亮著（lighting.windows>0）`,s.lighting.windows>0,s.lighting);
 check(engine+' S10 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S11 多良、平交道（12.6、§11、Review Focus 4）：選 EMU3000 拿到車庫中間車、整列長度不變（平交道遮斷時序靠它）；
// 集電弓升到線，整段路線正上方第一個東西就是電車線，不穿過腕臂、電桿或隧道頂。
section('S11',async(b,engine)=>{
 const manifest=JSON.parse(readFileSync(path.join(ROOT,'rail-3d/assets/blender-map-v1/manifest.json'),'utf8')),head=JSON.parse(baseFile('rail-3d/assets/garage-blender-v1/emu3000.json').toString('utf8'));
 const mm=manifest.meshes['emu3000-mid'],expected=(mm.max[0]-mm.min[0]+2*head.sizeM[0])*1.25/head.sizeM[1]+.28;
 for(const kind of ['duoliang','crossing']){
  const ctx=await b.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1,reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],urls=[];
  p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error'&&!/\/favicon\.ico(\?|$)/.test(m.location()?.url||''))errors.push(m.text());});p.on('request',r=>urls.push(r.url()));
  try{
   await p.goto(SITE+'/prototypes/garage-'+kind+'/');await p.waitForFunction(()=>window.newScenePreview?.state.ready,null,{timeout:90000});
   await p.selectOption('#train','emu3000');await p.waitForFunction(()=>{const s=newScenePreview.state;return s.ready&&s.model==='emu3000'&&!s.changing;},null,{timeout:90000});
   const mid=urls.filter(u=>u.includes('/garage-blender-v1/emu3000-mid.json')),lod=urls.filter(u=>u.includes('/blender-map-v1/')&&u.includes('emu3000-mid'));
   check(`${engine} S11 ${kind}：中間車讀車庫資產、不再借地圖 LOD`,mid.length>0&&lod.length===0,{mid:mid.length,lod});
   const len=(await p.evaluate(()=>newScenePreview.state)).trainLength;
   check(`${engine} S11 ${kind}：整列長度不變（差 <0.03）`,Math.abs(len-expected)<.03,{len,expected});
   const t0=30/2.6,now=await p.evaluate(t=>{newScenePreview.setTime(t);return newScenePreview.pantographs().map(h=>({train:h.train,reached:h.reached,z:h.head[2],up:newScenePreview.probeUp([h.head[0],h.head[1],h.head[2]-.05])}));},t0);
   check(`${engine} S11 ${kind}：${kind==='crossing'?2:1} 支集電弓都升到線，正上方第一個東西就是電車線（差 ≤0.02）`,now.length===(kind==='crossing'?2:1)&&now.every(h=>h.reached&&h.up!==null&&Math.abs(h.up-h.z)<=.02),now);
   // 整段路線掃 40 個時刻；只看畫面內的集電弓。seen>0 是正向對照：一支都沒掃到時「沒有擋住」不算數。
   const bad=[];let seen=0;
   for(let k=0;k<40;k++){const t=k*(180/2.6)/40,rows=await p.evaluate(t=>{newScenePreview.setTime(t);return newScenePreview.pantographs().filter(h=>h.visible).map(h=>({train:h.train,z:h.head[2],up:newScenePreview.probeUp([h.head[0],h.head[1],h.head[2]-.05])}));},t);
    for(const h of rows){seen++;if(!(h.up===null||h.up>=h.z-.02))bad.push({t:+t.toFixed(2),...h});}}
   check(`${engine} S11 ${kind}：整段路線 40 個時刻，集電弓上方沒有腕臂、電桿或隧道頂擋住`,seen>0&&bad.length===0,{seen,bad:bad.slice(0,5)});
   if(engine==='chromium'){await p.evaluate(t=>{newScenePreview.setPeriod('day');newScenePreview.setView('train');newScenePreview.setTime(t);},t0);
    mkdirSync(path.join(OUT,'checkpoint-2'),{recursive:true});await p.screenshot({path:path.join(OUT,'checkpoint-2','8-'+kind+'-集電弓.png')});}
   check(`${engine} S11 ${kind}：沒有 JS 錯誤`,errors.length===0,errors);
  }finally{await ctx.close();}
 }
});

// S12 效能（12.10）：夜晚、跟車、門全開：draw calls ≤125、三角形 ≤22 萬。
section('S12',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const T=await p.evaluate(()=>viaductPreview.timetable);
 await p.click('button[data-period="night"]');await cam(p,{view:'train'});await at(p,T.showcase);
 const s=await p.evaluate(()=>{viaductPreview.render();return viaductPreview.state;});
 check(`${engine} S12 夜晚跟車停站：draw calls ≤125、三角形 ≤22 萬`,s.drawCalls<=125&&s.triangles<=220000,{drawCalls:s.drawCalls,triangles:s.triangles});
 check(engine+' S12 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S13 乘客不變式（12.7）：用頁面實際量到的停站車門跑同一份劇本判準（Node 那份 T8 用的是 probe 的車門）。
section('S13',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const g=await p.evaluate(()=>({doors:viaductPreview.passengers.stopDoors,platform:viaductPreview.platform,L:viaductPreview.state.pathLength,v:viaductPreview.state.speed}));
 check(`${engine} S13 頁面量到 6 扇月台側停站車門`,g.doors.length===6,g.doors);
 const plan=await import('../rail-3d/garage-people-plan.js'),{peopleInvariants,peopleChecks}=await import('./lib/people_invariants.mjs');
 const v=peopleInvariants({plan,timetable:createStopTimetable({pathLength:g.L,speed:g.v}),doors:g.doors,platform:g.platform,stops:12});
 for(const [name,pass,detail]of peopleChecks(v,plan.PEOPLE.spacing))check(engine+' S13 '+name,pass,detail);
 check(engine+' S13 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S14 乘客看得到、夜裡被月台燈照亮（12.7）：夜晚看月台、展示時刻。有人與沒人兩張的差異像素 ≥400；關掉月台燈後，同一批像素暗 8 以上。
section('S14',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await p.click('button[data-period="night"]');await cam(p,{view:'platform'});
 const q=await p.evaluate(()=>viaductPreview.passengers);await at(p,q.showcaseTime);
 await shotIn(p,'pOn');await p.evaluate(()=>viaductPreview.peopleVisible(false));await shotIn(p,'pOff');await p.evaluate(()=>viaductPreview.peopleVisible(true));
 await p.evaluate(()=>viaductPreview.lampsVisible(false));await shotIn(p,'lOff');await p.evaluate(()=>viaductPreview.lampsVisible(true));
 const m1=await p.evaluate(()=>__px.mean('pOn',null,['pOn','pOff'])),m2=await p.evaluate(()=>__px.mean('lOff',null,['pOn','pOff']));
 check(`${engine} S14 夜晚看月台：乘客佔 ≥400 個像素`,m1.n>=400,{n:m1.n});
 check(`${engine} S14 關掉月台燈，乘客那些像素暗 8 以上（被月台燈照亮）`,m1.l>m2.l+8,{lampsOn:+m1.l.toFixed(1),lampsOff:+m2.l.toFixed(1)});
 check(engine+' S14 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S15 長跑可重現（Review Focus 5）：跳到三小時後、跳回開頭、再跳回同一刻，畫面逐像素相同、乘客狀態相同。
section('S15',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 await cam(p,{view:'platform'});
 await at(p,10800.3);await shotIn(p,'a');const ja=JSON.stringify(await p.evaluate(()=>viaductPreview.passengers));
 await at(p,50);
 await at(p,10800.3);await shotIn(p,'b');const jb=JSON.stringify(await p.evaluate(()=>viaductPreview.passengers));
 const d=await p.evaluate(()=>__px.diff('a','b',null,0));
 check(`${engine} S15 t=10800.3 跳走再跳回：畫面逐像素相同、乘客狀態相同`,d===0&&ja===jb,{diff:d,a:ja.slice(0,160),b:jb.slice(0,160)});
 check(engine+' S15 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S16 最擠時的效能（12.10）：夜晚跟車，在第 3 站前後 ±30 秒每 0.5 秒找月台上人最多的一刻；那一刻整頁 draw calls ≤125、三角形 ≤22 萬，乘客 ≤17 個 draw call、≤1 萬個三角形。
section('S16',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const T=await p.evaluate(()=>viaductPreview.timetable);
 await p.click('button[data-period="night"]');await cam(p,{view:'train'});
 const peak=await p.evaluate(lap=>{let best={t:0,on:-1};for(let u=-30;u<30;u+=.5){const t=3*lap+u;viaductPreview.setTime(t);const on=viaductPreview.passengers.onPlatform;if(on>best.on)best={t,on};}return best;},T.lap);
 await at(p,peak.t);
 const r=await p.evaluate(()=>{viaductPreview.render();const s=viaductPreview.state,q=viaductPreview.passengers;return{drawCalls:s.drawCalls,triangles:s.triangles,people:{drawCalls:q.drawCalls,triangles:q.triangles}};});
 check(`${engine} S16 最擠時：整頁 draw calls ≤125、三角形 ≤22 萬，乘客 draw calls ≤17、三角形 ≤1 萬`,peak.on>0&&r.drawCalls<=125&&r.triangles<=220000&&r.people.drawCalls<=17&&r.people.triangles<=10000,{peak,...r});
 check(engine+' S16 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}});

// S17 手機、減少動態（§7、12.8、12.9）：一打開就停在展示時刻——不播放、門全開、有人正在上車。
// 不用 open()：它會把播放中的頁面按暫停，那樣「減少動態時一開始就不播放」就量不到了。
section('S17',async(b,engine)=>{const ctx=await b.newContext({viewport:{width:375,height:812},reducedMotion:'reduce',isMobile:true,hasTouch:true}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error'&&!/\/favicon\.ico(\?|$)/.test(m.location()?.url||''))errors.push(m.text());});
 try{await p.goto(PAGE);await p.waitForFunction(()=>window.viaductPreview?.state.ready,null,{timeout:90000});
  const s=await st(p);
  check(`${engine} S17 手機減少動態：不播放、門全開、有人正在上車`,s.running===false&&s.doors===1&&s.passengers?.boarding>=1,{running:s.running,doors:s.doors,passengers:s.passengers});
  // 09-26 驗收：ready 當下雨棚還沒開始淡（不透明度 1、目標 .25），約 0.3 s 後才淡完；截圖前後都要已經等於目標。
  if(engine==='chromium'){const dir=path.join(OUT,'checkpoint-4');mkdirSync(dir,{recursive:true});const file=path.join(dir,'手機-減少動態.png');
   await settled(p);const before=await st(p);await p.screenshot({path:file});const after=await st(p);
   check(`${engine} S17 手機截圖在且 >20 KB`,readFileSync(file).length>20*1024,readFileSync(file).length);
   check(`${engine} S17 手機截圖前後雨棚都已淡完（不透明度＝目標）`,[before,after].every(s=>s.canopyOpacity===s.canopyTarget),{before:[before.canopyOpacity,before.canopyTarget],after:[after.canopyOpacity,after.canopyTarget]});}
  check(engine+' S17 沒有 JS 錯誤',errors.length===0,errors);
 }finally{await ctx.close();}});

// S18 檢查點 4 截圖：白天、夜晚 × 看月台、跟車、全景，都在展示時刻（有人正在上車）。
section('S18',async(b,engine)=>{const {p,ctx,errors}=await open(b);try{
 const dir=path.join(OUT,'checkpoint-4');mkdirSync(dir,{recursive:true});const q=await p.evaluate(()=>viaductPreview.passengers),sizes=[];
 for(const period of ['day','night']){await p.click(`button[data-period="${period}"]`);
  for(const view of ['platform','train','world']){await cam(p,{view});await at(p,q.showcaseTime);const file=path.join(dir,`${period}-${view}.png`);await p.screenshot({path:file});sizes.push([period+'-'+view,readFileSync(file).length]);}}
 check(`${engine} S18 檢查點 4 六張截圖都在且各 >20 KB`,sizes.length===6&&sizes.every(([,n])=>n>20*1024),sizes);
 check(engine+' S18 沒有 JS 錯誤',errors.length===0,errors);
}finally{await ctx.close();}},['chromium']);

// ── 各段（Task 3：S1–S6；Task 6：S7–S12；Task 8：S13–S18）一律插在這一行之上 ──
for(const [engine,launch] of Object.entries(ENGINES)){const b=await launch();
 try{for(const s of SECTIONS)if(on(s.id)&&s.engines.includes(engine)){try{await s.fn(b,engine);}catch(e){check(engine+' '+s.id+' 執行沒有例外',false,String(e&&e.stack||e));}}}
 finally{await b.close();}}
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;

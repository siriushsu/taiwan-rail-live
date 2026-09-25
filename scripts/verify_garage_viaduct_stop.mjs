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
 await at(p,12);
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

// ── 各段（Task 3：S1–S6；Task 6：S7–S12；Task 8：S13–S18）一律插在這一行之上 ──
for(const [engine,launch] of Object.entries(ENGINES)){const b=await launch();
 try{for(const s of SECTIONS)if(on(s.id)&&s.engines.includes(engine)){try{await s.fn(b,engine);}catch(e){check(engine+' '+s.id+' 執行沒有例外',false,String(e&&e.stack||e));}}}
 finally{await b.close();}}
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;

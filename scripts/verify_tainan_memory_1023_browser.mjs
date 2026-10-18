// 臺南 10/23 重播頁（地下化後的第一個週五）專屬驗收：地下結構的材質與畫序、地面面紗、車廂高程與俯仰、臺南站停靠位置、
// 標籤與鏡頭的高度、深度衝突（z-fighting）、鋼軌與道碴的逐頂點高程、路面讓位、手機版面、「下一班到臺南」與「臺南發車」的跳轉。無視窗 Chromium＋WebKit。
// 用法：node scripts/verify_tainan_memory_1023_browser.mjs；自己起 dev_server 子程序（PORT 預設 5611），結束時只停它。VURL 有給就不起 server。
// DIR 指到別的資料夾（預設 memories/tainan-2026-10-23；彩排的輸出資料夾要先放進最新的頁面檔並封存）：期望值讀那個資料夾的資料檔，頁面模式（預覽／實測）看它的 snapshot.json 有沒有 preview。
//   DIR 的路徑含 . 開頭的資料夾時 dev_server 會 404，要另起靜態 server 並給 VURL。
// 環境變數：ENGINES=chromium,webkit；ONLY=health,materials,veil,order,rails,roads,elevation,stop,labels,camera,depth,jumps,card,uncertain,about,layout（逗號分隔，挑段落跑）；
//   CONTROLS=0 略過突變對照（只有除錯時用，驗收一律要跑）；CHROMIUM_CHANNEL（預設 chrome）；RESULTS（結果檔路徑，預設寫到 output/tainan-memory-1023/verify-1023/；關於視窗的截圖存在結果檔旁邊）。
// 期望值一律來自磁碟上的資料檔（snapshot.json、underground/model.json、underground/profile.json），不問頁面載入後的副本；
// 突變對照（CONTROLS）用 page.route 對瀏覽器端換掉資料或程式（並補上對應的 integrity.json 雜湊），檢查該變紅，還原後該變綠；不改任何檔案。
//
// 深度衝突的量法（沿視線前後微移）：正交相機沿著視線方向前後移動，所有點的深度同時平移、畫面上的位置完全不變。
// 沒有衝突的場景，影像幾乎不變；兩個面深度差小於一格深度解析度（24 位元約 0.003 m）時，哪一面勝出取決於捨入，
// 平移幾分之一格就會讓一部分像素換面。所以：同一視角各畫一張原位影像與沿視線平移 0.4／0.9／1.7／3.1 mm 的影像，數「顏色差總和超過門檻」的像素。
// 乾淨頁面也量得到零星孤立的像素，所以門檻是畫面的一個很小的比例（DEPTH_MAX_FRAC），不是 0。
// 對照組：把面紗抬到路面柏油的高度（真的共面）——拿掉 polygonOffset 要變紅，保留 polygonOffset 要仍然是綠。
// 單獨拿掉面紗（z＝0）或殼的 polygonOffset 量不出差異（現有幾何裡沒有與它們共面的大面積不透明面），所以不當對照。
import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const WT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DIR=process.env.DIR||'memories/tainan-2026-10-23',ABS=path.resolve(WT,DIR),REL=path.relative(WT,ABS).split(path.sep).join('/');
if(!process.env.VURL&&REL.split('/').some(x=>x.startsWith('.')))throw Error('dev_server 不送 . 開頭的路徑（'+REL+'）：請另起一個靜態 server，再用 VURL 指過去。');
const PORT=+(process.env.PORT||5611),BASE=process.env.VURL||`http://127.0.0.1:${PORT}`,DIR_URL=`${BASE}/${REL}/`,PAGE_URL=DIR_URL+'index.html';
const OUT=path.join(WT,'output/tainan-memory-1023/verify-1023');fs.mkdirSync(OUT,{recursive:true});
const RESULTS=process.env.RESULTS||path.join(OUT,'results.json');
const ONLY=process.env.ONLY?new Set(process.env.ONLY.split(',')):null,want=id=>!ONLY||ONLY.has(id);
const WITH_CONTROLS=process.env.CONTROLS!=='0';

let server=null;
if(!process.env.VURL){
 server=spawn(process.execPath,[path.join(WT,'scripts/dev_server.mjs')],{cwd:WT,env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
 let ok=false;for(let i=0;i<100&&!ok;i++){try{ok=(await fetch(PAGE_URL)).ok;}catch{}if(!ok)await new Promise(r=>setTimeout(r,100));}
 if(!ok){server.kill();throw Error('dev_server 沒起來：'+PAGE_URL);}
}

// ── 磁碟上的期望資料 ──
const jsonCache=new Map(),readJson=f=>{if(!jsonCache.has(f))jsonCache.set(f,JSON.parse(fs.readFileSync(path.join(ABS,f),'utf8')));return jsonCache.get(f);};
const SNAP=readJson('snapshot.json'),MODEL=readJson('underground/model.json'),PROF=readJson('underground/profile.json');
const PLAT=SNAP.underground.platform,P=PROF.reference.points,C=PROF.controlPoints,ORIGIN=SNAP.origin;
const SX=111320*Math.cos(ORIGIN[1]*Math.PI/180),world=c=>[(c[0]-ORIGIN[0])*SX,(c[1]-ORIGIN[1])*111320];
const cd=id=>C.find(c=>c.id===id).d,cxy=id=>C.find(c=>c.id===id).xy;
const D_SOUTH_CUT=cd('south-cut-outer'),D_SOUTH_PORTAL=cd('south-portal'),D_NORTH_PORTAL=cd('north-portal'),D_NORTH_CUT=cd('north-cut-outer');
// 參考線投影＋剖面高程：Node 與頁面兩邊用同一份算式（頁面那邊用 Function 重建）；算式只讀 profile.json 的 reference.points／controlPoints。
const geomFactory=(P,C)=>{
 const refProject=(x,y)=>{let best=null;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy,f=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(L2||1))),px=a[0]+dx*f,py=a[1]+dy*f,dist=Math.hypot(x-px,y-py);if(!best||dist<best.dist)best={dist,d:a[2]+(b[2]-a[2])*f,x:px,y:py};}return best;};
 const zProf=d=>{let i=0;while(i<C.length-2&&C[i+1].d<=d)i++;const a=C[i],b=C[i+1],f=Math.max(0,Math.min(1,(d-a.d)/((b.d-a.d)||1)));return a.z+(b.z-a.z)*f;};
 return {refProject,zProf};
};
const GEOM_SRC=geomFactory.toString(),G=geomFactory(P,C);
const NEAR_REF=40;   // 離參考線超過這麼遠（或超出參考線兩端）的車廂在地面，期望高度＝地面＋0.16
const region=d=>d>=PLAT.d0&&d<=PLAT.d1?'platform':d<D_SOUTH_CUT?'south-ground':d<D_SOUTH_PORTAL?'south-trough':d<=D_NORTH_PORTAL?'tunnel':d<=D_NORTH_CUT?'north-trough':'north-ground';
const REGIONS=['south-ground','south-trough','tunnel','platform','north-trough','north-ground'];
const platformXY=(()=>{const a=P.findIndex(q=>q[2]>=PLAT.centerD),p0=P[a-1],p1=P[a],f=(PLAT.centerD-p0[2])/(p1[2]-p0[2]);return [p0[0]+(p1[0]-p0[0])*f,p0[1]+(p1[1]-p0[1])*f];})();
const platformZ=G.zProf(PLAT.centerD);

// ── 記錄 ──
const results=[];let fails=0;
const record=(engine,section,name,pass,detail='')=>{results.push({engine,section,name,pass,detail});if(!pass)fails++;console.log(`${pass?'PASS':'FAIL'} [${engine} ${section}] ${name}${detail?' — '+detail:''}`);};
const controlsLog=[];
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const f1=(v,n=3)=>Number.isFinite(v)?v.toFixed(n):String(v);

// ── 突變：page.route 換掉資料或程式，並補上 integrity.json 的雜湊（頁面載入資料時會比對） ──
const MIME={json:'application/json',js:'text/javascript',css:'text/css',html:'text/html'};
function buildMutation(spec){
 const files=new Map();
 for(const [f,fn] of Object.entries(spec.json||{})){const obj=structuredClone(readJson(f));fn(obj);files.set(f,Buffer.from(JSON.stringify(obj)));}
 for(const [f,reps] of Object.entries(spec.text||{})){let s=fs.readFileSync(path.join(ABS,f),'utf8');for(const [a,b] of reps){const n=s.split(a).length-1;if(n!==1)throw Error(`突變的原文要恰好出現 1 次：${f} 出現 ${n} 次：${a.slice(0,50)}`);s=s.replace(a,()=>b);}files.set(f,Buffer.from(s));}
 const integ=structuredClone(readJson('integrity.json'));for(const [f,buf] of files)if(f.endsWith('.json'))integ.files[f]=sha(buf);
 files.set('integrity.json',Buffer.from(JSON.stringify(integ)));
 return {files,status:spec.status||{}};
}
async function applyMutation(context,m){
 for(const [f,buf] of m.files)await context.route(u=>u.href===new URL(f,DIR_URL).href,route=>route.fulfill({status:200,contentType:MIME[f.split('.').pop()]||'application/octet-stream',body:buf}));
 for(const [f,code] of Object.entries(m.status))await context.route(u=>u.href===new URL(f,DIR_URL).href,route=>route.fulfill({status:code,body:'x'}));
}

// ── 開頁面 ──
async function openPage(browser,{viewport={width:1280,height:800},mobile=false,mutation=null,readyTimeout=90000}={}){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,...(mobile?{isMobile:true,hasTouch:true}:{})});
 if(mutation)await applyMutation(context,mutation);
 const page=await context.newPage(),o={context,page,errors:[],responses:[],failed:[],ready:false};
 page.on('pageerror',e=>o.errors.push('pageerror: '+e.message));
 page.on('console',m=>{if(m.type()==='error')o.errors.push('console: '+m.text());});
 page.on('response',r=>o.responses.push([r.status(),r.url()]));
 page.on('requestfailed',r=>o.failed.push(r.url()+' '+(r.failure()?.errorText||'')));
 await page.goto(PAGE_URL,{waitUntil:'load'});
 try{await page.waitForFunction(()=>window.tainanMemory?.state?.ready===true||/無法載入/.test(document.getElementById('loading')?.textContent||''),null,{timeout:readyTimeout});}catch{}
 o.ready=await page.evaluate(()=>window.tainanMemory?.state?.ready===true);
 if(o.ready)await page.evaluate(()=>{window.tainanMemory.state.playing=false;});
 return o;
}
async function reloadPage(o,readyTimeout=90000){
 await o.page.goto('about:blank');await new Promise(r=>setTimeout(r,100));
 o.errors.length=0;o.responses.length=0;o.failed.length=0;
 await o.page.goto(PAGE_URL,{waitUntil:'load'});
 try{await o.page.waitForFunction(()=>window.tainanMemory?.state?.ready===true||/無法載入/.test(document.getElementById('loading')?.textContent||''),null,{timeout:readyTimeout});}catch{}
 o.ready=await o.page.evaluate(()=>window.tainanMemory?.state?.ready===true);
 if(o.ready)await o.page.evaluate(()=>{window.tainanMemory.state.playing=false;});
}
// 等頁面自己畫完新的一幀（state.frames 增加）：位置、標籤與鏡頭都是在 draw 裡依目前的時間算出來的。
const drawnSrc=`(()=>{const t=window.tainanMemory;return new Promise((res,rej)=>{const f0=t.state.frames,t0=performance.now();const f=()=>{if(t.state.frames>f0)res();else if(performance.now()-t0>8000)rej(Error('頁面 8 秒沒有畫新的一幀'));else requestAnimationFrame(f);};requestAnimationFrame(f);});})()`;
const drawn=page=>page.evaluate(drawnSrc);
const settle=async page=>{await drawn(page);await drawn(page);};

// ───────────────────────── 檢查：載入乾淨 ─────────────────────────
const EXPECT_ASSETS=['snapshot.json','integrity.json','underground/model.json','underground/profile.json','underground/near.mesh.bin.gz','surroundings/near.mesh.bin.gz','station/near.mesh.bin.gz','fleet/catalog.json','uncertainty.json'];
async function checkHealth(o){
 const off=o.responses.filter(([s,u])=>!u.startsWith(BASE+'/')&&!u.startsWith('data:')),bad=o.responses.filter(([s])=>s>=400),got=new Set(o.responses.filter(([s])=>s===200).map(([,u])=>u.replace(DIR_URL,'')));
 const missing=EXPECT_ASSETS.filter(a=>!got.has(a));
 const pass=o.ready&&!o.errors.length&&!bad.length&&!o.failed.length&&!off.length&&!missing.length;
 return {pass,detail:`請求 ${o.responses.length} 個，非 200 ${bad.length}，失敗 ${o.failed.length}，站外 ${off.length}，缺必要檔 ${missing.join(',')||'無'}；console error／pageerror ${o.errors.length} 個${o.errors[0]?'：'+o.errors[0].slice(0,120):''}；ready=${o.ready}`};
}

// ───────────────────────── 檢查：材質、畫序、面紗 ─────────────────────────
const FRONT=0,DOUBLE=2;
async function checkMaterials(o){
 const rows=await o.page.evaluate(()=>{const u=window.tainanMemory.underground;return Object.entries(u.meshes).map(([name,m])=>({name,type:m.material.type,side:m.material.side,opacity:m.material.opacity,transparent:m.material.transparent,depthWrite:m.material.depthWrite,renderOrder:m.renderOrder,po:m.material.polygonOffset,color:[m.material.color.r,m.material.color.g,m.material.color.b],roughness:m.material.roughness,metalness:m.material.metalness,start:m.geometry.drawRange.start,count:m.geometry.drawRange.count,inScene:!!m.parent,visible:m.visible}));});
 const groups=MODEL.lods.near.drawGroups,errs=[],table=[];
 if(rows.length!==groups.length)errs.push(`網格數 ${rows.length}≠drawGroups ${groups.length}`);
 for(const g of groups){const r=rows.find(x=>x.name===g.name);if(!r){errs.push('缺 '+g.name);continue;}
  const o1=g.opacity??1,eside=g.doubleSided?DOUBLE:FRONT,e={transparent:o1<1,opacity:o1,depthWrite:!(o1<1),side:eside};
  for(const k of Object.keys(e))if(Math.abs(Number(r[k])-Number(e[k]))>1e-9)errs.push(`${g.name}.${k}＝${r[k]}，model.json 要 ${e[k]}`);
  if(r.start!==g.start||r.count!==g.count)errs.push(`${g.name} 範圍 ${r.start}+${r.count}≠${g.start}+${g.count}`);
  g.color.forEach((v,i)=>{if(Math.abs(r.color[i]-v)>1e-6)errs.push(`${g.name} 顏色分量 ${i}`);});if(Math.abs(r.roughness-g.roughness)>1e-9||Math.abs(r.metalness-g.metalness)>1e-9)errs.push(g.name+' 粗糙度／金屬度');
  if(!r.inScene||!r.visible)errs.push(g.name+' 不在場景或不可見');if(o1<1&&!r.po)errs.push(g.name+' 半透明但沒有 polygonOffset');
  table.push(`${g.name.padEnd(15)} side=${r.side === DOUBLE?'Double':r.side===FRONT?'Front':r.side} opacity=${f1(r.opacity,2)} transparent=${r.transparent} depthWrite=${r.depthWrite} renderOrder=${r.renderOrder} range=${r.start}+${r.count}`);}
 const trough=rows.find(x=>x.name==='ug_trough');if(trough?.side!==FRONT)errs.push('ug_trough 必須是 FrontSide（U 槽的牆是兩層反向法線，雙面會把內外兩層一起畫）');
 const total=rows.reduce((a,r)=>a+r.count,0);if(total!==MODEL.lods.near.vertexCount)errs.push(`頂點總數 ${total}≠${MODEL.lods.near.vertexCount}`);
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`${groups.length} 個 drawGroup 的 side／opacity／transparent／depthWrite／範圍／顏色與 model.json 一致`,table};
}
// 畫序：實際渲染一次，掛 onBeforeRender 記下每個物件被畫的順序：不透明的都在半透明之前，半透明依序是 殼 → B1 → 面紗 → 站房外罩。
async function checkOrder(o){
 const r=await o.page.evaluate(()=>{const t=window.tainanMemory,scene=t.underground.veil.parent,log=[],saved=[];
  t.homeView();
  scene.traverse(x=>{if(x.isMesh||x.isLineSegments){const prev=x.onBeforeRender;saved.push([x,prev]);x.onBeforeRender=function(rd,sc,cam,geo,mat){log.push([x===t.wrap?'wrap':(x.name||x.type),!!mat.transparent,x.renderOrder]);};}});
  t.renderer.render(scene,t.camera);for(const [x,prev] of saved)x.onBeforeRender=prev;
  return {log,order:t.underground.order};});
 const T=r.log.filter(l=>l[1]).map(l=>l[0]),idx=n=>T.indexOf(n),lastOpaque=r.log.map(l=>l[1]).lastIndexOf(false),firstTrans=r.log.findIndex(l=>l[1]);
 const errs=[];for(const n of ['ug_shell','ug_b1','ground-veil','wrap'])if(idx(n)<0)errs.push('這一幀沒有畫到（半透明）'+n);
 if(!errs.length){if(!(idx('ug_shell')<idx('ug_b1')&&idx('ug_b1')<idx('ground-veil')&&idx('ground-veil')<idx('wrap')))errs.push('半透明的順序不是 殼 → B1 → 面紗 → 外罩：'+T.join('>'));}
 if(firstTrans<=lastOpaque)errs.push('有不透明物件排在半透明之後');
 if(!(r.order.ug_shell<r.order.ug_b1&&r.order.ug_b1<r.order.veil&&r.order.veil<r.order.above))errs.push('renderOrder 常數不是 殼<B1<面紗<地面以上：'+JSON.stringify(r.order));
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`實際繪製順序（半透明）：${T.filter((n,i)=>T.indexOf(n)===i).join(' → ')}；不透明 ${r.log.filter(l=>!l[1]).length} 筆全在它們之前`};
}
// 面紗（幾何）：z＝0、蓋住 snapshot.bounds、半透明且不寫深度、挖掉 model.json 的 cutouts（面積＝外框面積減各環面積，探點在環內沒有三角形、環外恰好 1 個）；不透明度可在執行時改。
const shoelace=ring=>{let a=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];a+=p[0]*q[1]-q[0]*p[1];}return Math.abs(a)/2;};
const inRing=(pt,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
// 每個環取最長邊的中點 M 與朝內的單位法向 n；環內探點 M+2n、環外探點 M−2n（2 公尺），供幾何與像素兩種檢查共用。
function ringProbes(){return MODEL.cutouts.map(c=>{const ring=c.ring;let best=null;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||L>best.L)best={a,b,L};}
  const m=[(best.a[0]+best.b[0])/2,(best.a[1]+best.b[1])/2],nx=-(best.b[1]-best.a[1])/best.L,ny=(best.b[0]-best.a[0])/best.L;let s=1;if(!inRing([m[0]+nx,m[1]+ny],ring))s=-1;
  return {id:c.id,ring,m,inside:[m[0]+s*nx*2,m[1]+s*ny*2],outside:[m[0]-s*nx*2,m[1]-s*ny*2]};});}
async function checkVeil(o){
 const probes=ringProbes(),b=SNAP.bounds,[bx0,by0]=world([b[0],b[1]]),[bx1,by1]=world([b[2],b[3]]);
 const errs=[];for(const p of probes){if(!inRing(p.inside,p.ring)||inRing(p.outside,p.ring))errs.push('測試的探點本身不在預期的一側 '+p.id);}
 const r=await o.page.evaluate(({probes})=>{const t=window.tainanMemory,v=t.underground.veil,g=v.geometry,pos=g.attributes.position.array,idx=g.index?Array.from(g.index.array):null,n=idx?idx.length/3:pos.length/9,tri=[];
  let zmin=1e9,zmax=-1e9,x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(let i=0;i<pos.length;i+=3){x0=Math.min(x0,pos[i]);x1=Math.max(x1,pos[i]);y0=Math.min(y0,pos[i+1]);y1=Math.max(y1,pos[i+1]);zmin=Math.min(zmin,pos[i+2]);zmax=Math.max(zmax,pos[i+2]);}
  let area=0;for(let k=0;k<n;k++){const a=idx?idx[k*3]:k*3,b=idx?idx[k*3+1]:k*3+1,c=idx?idx[k*3+2]:k*3+2,A=[pos[a*3],pos[a*3+1]],B=[pos[b*3],pos[b*3+1]],Cc=[pos[c*3],pos[c*3+1]];tri.push([A,B,Cc]);area+=Math.abs((B[0]-A[0])*(Cc[1]-A[1])-(Cc[0]-A[0])*(B[1]-A[1]))/2;}
  const count=pt=>tri.filter(([A,B,Cc])=>{const s=(p,q,r)=>(p[0]-r[0])*(q[1]-r[1])-(q[0]-r[0])*(p[1]-r[1]),d1=s(pt,A,B),d2=s(pt,B,Cc),d3=s(pt,Cc,A);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));}).length;
  const mat=v.material,before=[mat.opacity,v.visible];t.underground.setVeilOpacity(.7);const at7=[mat.opacity,v.visible];t.underground.setVeilOpacity(0);const at0=[mat.opacity,v.visible];t.underground.setVeilOpacity(before[0]);const back=[mat.opacity,v.visible];
  return {zmin,zmax,x0,x1,y0,y1,area,inside:probes.map(p=>count(p.inside)),outside:probes.map(p=>count(p.outside)),inScene:!!v.parent,type:mat.type,transparent:mat.transparent,depthWrite:mat.depthWrite,before,at7,at0,back};},{probes});
 if(Math.abs(r.zmin)>1e-9||Math.abs(r.zmax)>1e-9)errs.push(`面紗不在 z＝0：${r.zmin}～${r.zmax}`);
 if(!(r.x0<=bx0&&r.x1>=bx1&&r.y0<=by0&&r.y1>=by1))errs.push(`面紗沒有蓋住 snapshot.bounds：面紗 x ${f1(r.x0,0)}～${f1(r.x1,0)} y ${f1(r.y0,0)}～${f1(r.y1,0)}，bounds x ${f1(bx0,0)}～${f1(bx1,0)} y ${f1(by0,0)}～${f1(by1,0)}`);
 const expectArea=(r.x1-r.x0)*(r.y1-r.y0)-probes.reduce((a,p)=>a+shoelace(p.ring),0);if(Math.abs(r.area-expectArea)/expectArea>.002)errs.push(`面紗面積 ${f1(r.area,0)}≠外框減去各環 ${f1(expectArea,0)}`);
 r.inside.forEach((n,i)=>{if(n!==0)errs.push(`環 ${probes[i].id} 內的探點被 ${n} 個三角形蓋住（該是挖空）`);});r.outside.forEach((n,i)=>{if(n!==1)errs.push(`環 ${probes[i].id} 外的探點被 ${n} 個三角形蓋住（該恰好 1 個）`);});
 if(!r.inScene||r.type!=='MeshBasicMaterial'||!r.transparent||r.depthWrite!==false)errs.push(`面紗材質：inScene=${r.inScene} ${r.type} transparent=${r.transparent} depthWrite=${r.depthWrite}`);
 if(!(r.before[0]>0&&r.before[0]<1&&r.before[1]===true))errs.push('預設不透明度要在 0～1 之間且可見：'+r.before);
 if(!(r.at7[0]===.7&&r.at7[1]===true&&r.at0[0]===0&&r.at0[1]===false&&r.back[0]===r.before[0]&&r.back[1]===true))errs.push('setVeilOpacity 沒有照設定改不透明度／可見：'+JSON.stringify([r.at7,r.at0,r.back]));
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`面紗 z＝0、蓋住 bounds、面積＝外框 ${f1(r.x1-r.x0,0)}×${f1(r.y1-r.y0,0)} 減 ${probes.length} 個環（${probes.map(p=>f1(shoelace(p.ring),0)+' m²').join('＋')}），環內探點 ${r.inside.join('／')} 個三角形、環外 ${r.outside.join('／')} 個；預設不透明度 ${r.before[0]}，可改成 0.7／0`};
}
// 面紗（像素）：只留面紗、改成不透明紅色從正上方畫，環內探點該是清除色、環外探點該是紅色；另外面紗保持原色時，在空地上和背景一模一樣（不透明度 0.2／0.45／0.7／1 都量）。
async function checkVeilPixels(o){
 const probes=ringProbes(),errs=[],info=[];
 const r=await o.page.evaluate(({probes})=>{const t=window.tainanMemory,v=t.underground.veil,scene=v.parent,r=t.renderer,gl=r.getContext(),cam=t.camera,out={};
  const saved=scene.children.map(c=>c.visible),v0=t.getView(),color0=v.material.color.getHex(),op0=v.material.opacity;
  const px=(x,y,z)=>{const q=cam.position.clone().set(x,y,z).project(cam),rect=r.domElement.getBoundingClientRect(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,sx=Math.round((q.x*.5+.5)*W),sy=Math.round((q.y*.5+.5)*H),b=new Uint8Array(4);gl.readPixels(Math.max(0,Math.min(W-1,sx)),Math.max(0,Math.min(H-1,sy)),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return {rgb:Array.from(b.slice(0,3)),on:sx>=0&&sx<W&&sy>=0&&sy<H};};
  const only=()=>{for(const c of scene.children)c.visible=(c===v);};   // setView 會依縮放開關路面標線，所以每次改視角後都要重新只留面紗
  // 背景（清除色）：面紗關掉時的像素
  t.setView({x:0,y:0,z:0,span:40,azimuth:3.6,tilt:80*Math.PI/180});only();v.visible=false;r.render(scene,cam);out.bg=px(0,0,0).rgb;v.visible=true;
  // 空地：面紗不透明度 0.2／0.45／0.7／1 下，整格畫面（取 9x9 格點）和背景的最大差
  out.empty=[];for(const op of [.2,.45,.7,1]){t.underground.setVeilOpacity(op);t.setView({x:0,y:0,z:0,span:260,azimuth:3.6,tilt:55*Math.PI/180});only();r.render(scene,cam);let mx=0;const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,b=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);for(let i=0;i<b.length;i+=4)mx=Math.max(mx,Math.abs(b[i]-out.bg[0]),Math.abs(b[i+1]-out.bg[1]),Math.abs(b[i+2]-out.bg[2]));out.empty.push([op,mx]);}
  // 環內外：面紗改成不透明紅色
  v.material.color.setHex(0xff0000);t.underground.setVeilOpacity(1);out.holes=[];
  for(const p of probes){t.setView({x:p.m[0],y:p.m[1],z:0,span:30,azimuth:3.6,tilt:89*Math.PI/180});only();r.render(scene,cam);out.holes.push({id:p.id,inside:px(p.inside[0],p.inside[1],0),outside:px(p.outside[0],p.outside[1],0)});}
  for(let i=0;i<scene.children.length;i++)scene.children[i].visible=saved[i];v.material.color.setHex(color0);t.underground.setVeilOpacity(op0);t.setView(v0);return out;},{probes});
 const dist=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
 for(const [op,mx] of r.empty){info.push(`${op}→${mx}`);if(mx>2)errs.push(`面紗不透明度 ${op} 時空地和背景差 ${mx}（要 ≤2：面紗的顏色就是背景色，在空地上必須看不出來）`);}
 for(const h of r.holes){if(!h.inside.on||!h.outside.on)errs.push(`環 ${h.id} 的探點不在畫面內`);else{if(dist(h.inside.rgb,r.bg)>2)errs.push(`環 ${h.id} 內的像素 ${h.inside.rgb} 不是背景色 ${r.bg}（挖空失敗）`);if(!(h.outside.rgb[0]>200&&h.outside.rgb[1]<60&&h.outside.rgb[2]<60))errs.push(`環 ${h.id} 外的像素 ${h.outside.rgb} 不是面紗（紅）`);}}
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`空地上面紗和背景最大差（不透明度→差）${info.join('、')}；${r.holes.length} 個環：環內像素＝背景色、環外像素＝面紗色`};
}

// ───────────────────────── 檢查：鋼軌、道碴、路面 ─────────────────────────
async function checkRails(o){
 const exp=[];for(const r of SNAP.rails)for(let i=1;i<r.coordinates.length;i++){const a=world(r.coordinates[i-1]),b=world(r.coordinates[i]);if(!Math.hypot(b[0]-a[0],b[1]-a[1]))continue;const za=.13+(r.z?.[i-1]??0),zb=.13+(r.z?.[i]??0);for(const side of [-1,1])exp.push(za,zb);}
 const ballast=new Set();for(const r of SNAP.rails)for(let i=1;i<r.coordinates.length;i++){const a=world(r.coordinates[i-1]),b=world(r.coordinates[i]);if(!Math.hypot(b[0]-a[0],b[1]-a[1]))continue;ballast.add(Math.round((.05+(r.z?.[i-1]??0))*1000));ballast.add(Math.round((.05+(r.z?.[i]??0))*1000));}
 const r=await o.page.evaluate(()=>{const scene=window.tainanMemory.underground.veil.parent,ls=scene.children.find(c=>c.isLineSegments),zs=[],p=ls.geometry.attributes.position.array;for(let i=2;i<p.length;i+=3)zs.push(p[i]);
  const bm=scene.children.find(c=>c.isMesh&&c.material.color&&c.material.color.getHexString&&c.material.color.getHexString()==='aaa99b'),set=new Set(),bp=bm?bm.geometry.attributes.position.array:[];for(let i=2;i<bp.length;i+=3)set.add(Math.round(bp[i]*1000));return {zs,ballast:Array.from(set),hasBallast:!!bm};});
 const errs=[];if(r.zs.length!==exp.length)errs.push(`鋼軌頂點數 ${r.zs.length}≠期望 ${exp.length}`);
 else{let bad=0,maxd=0;for(let i=0;i<exp.length;i++){const d=Math.abs(r.zs[i]-exp[i]);maxd=Math.max(maxd,d);if(d>1e-4)bad++;}if(bad)errs.push(`鋼軌 ${bad} 個頂點的 z 與 rails[i].z＋0.13 不符（最大差 ${f1(maxd)}）`);}
 if(!r.hasBallast)errs.push('找不到道碴網格（顏色 aaa99b）');else{const have=new Set(r.ballast),lack=[...ballast].filter(z=>!have.has(z)),extra=r.ballast.filter(z=>!ballast.has(z));if(lack.length||extra.length)errs.push(`道碴頂點的 z 與 rails[i].z＋0.05 不符：缺 ${lack.length} 種、多 ${extra.length} 種高度`);}
 const under=exp.filter(z=>z<-1).length;if(under<100)errs.push(`地下的鋼軌頂點只有 ${under} 個，這項檢查沒有鑑別力`);
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`鋼軌 ${exp.length} 個頂點的 z 逐一等於 rails[i].z＋0.13（其中地下 ${under} 個）；道碴 ${ballast.size} 種頂點高度與 rails[i].z＋0.05 逐一相符`};
}
const ROAD_LAYERS=['asphalt','sidewalk','curb','white','yellow'];
// 各層路面的水平投影面積（m²）：路面被股道「讓位」時是被切掉一段，面積變小（三角形數反而可能因為多了斷頭而變多，所以不比三角形數）。
async function roadAreas(page){return page.evaluate(names=>{const m=window.tainanMemory.roads.meshes,out={};for(const k of names){const p=m[k].geometry.attributes.position.array;let a=0;for(let i=0;i+8<p.length;i+=9)a+=Math.abs((p[i+3]-p[i])*(p[i+7]-p[i+1])-(p[i+6]-p[i])*(p[i+4]-p[i+1]))/2;out[k]=a;}return out;},ROAD_LAYERS);}
// 路面讓位：地下的股道不該讓地面的人行道、路緣、標線讓位。對照：把 rails 的 z 全拿掉（當成地面股道）重畫，各層面積只會變小或持平，且至少一層明顯變小。
function checkRoads(area,cf){const errs=[];let less=0;for(const k of ROAD_LAYERS){if(area[k]<cf[k]-1e-3)errs.push(`${k} 層面積 ${f1(area[k],1)} m² 比「股道都當地面」的 ${f1(cf[k],1)} m² 還小`);less+=Math.max(0,area[k]-cf[k]);}
 if(less<1)errs.push('把地下股道當地面重畫，路面面積沒有任何變化，這項對照沒有鑑別力（或地下股道讓路面讓位了）');
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`路面各層水平面積（${ROAD_LAYERS.map(k=>k+' '+f1(area[k],0)).join('、')} m²）；把地下股道當地面重畫會少 ${f1(less,1)} m²（${ROAD_LAYERS.map(k=>k+' '+f1(area[k]-cf[k],1)).join('、')}）`};
}

// ───────────────────────── 檢查：車廂高程與俯仰、臺南站停靠 ─────────────────────────
const TARGETS=[100,450,780,3000,5000,PLAT.centerD,5700,6500,7300,7450,7600,7700];
// 取樣的列車：每個方向 perDir 班，等距挑；byFormation 時每種編組先挑一班（涵蓋各車型的長度與連結器間距）。
const pickTrains=(perDir,byFormation)=>{const sel=[];for(const dir of ['北上','南下']){const all=SNAP.trains.filter(t=>t.direction===dir),pick=new Set(),seen=new Set();if(byFormation)for(const t of all)if(!seen.has(t.formation.id)){seen.add(t.formation.id);pick.add(t.id);}const stride=Math.max(1,Math.floor(all.length/perDir));for(let i=0;i<all.length&&pick.size<perDir;i+=stride)pick.add(all[i].id);sel.push(...pick);}return sel;};
// 頁面內：先在不畫圖的情況下找出每班車最接近各目標里程的時刻，再逐一 jump → 等頁面畫完 → 讀整列車廂。
async function sampleElevation(page,{ids,targets=TARGETS,full=false}){
 return page.evaluate(async({src,P,C,ids,targets,full,drawnSrc})=>{
  const G=(new Function('return '+src))()(P,C),t=window.tainanMemory,d=t.data,sx=111320*Math.cos(d.origin[1]*Math.PI/180),w=c=>[(c[0]-d.origin[0])*sx,(c[1]-d.origin[1])*111320],drawn=()=>eval(drawnSrc);
  t.state.playing=false;t.state.follow='';const out=[];let skipped=0;
  for(const tr of d.trains){if(!ids.includes(tr.id))continue;
   const best=targets.map(()=>({gap:1e9,sec:null}));
   for(const sp of tr.spans)for(let sec=sp.start;sec<=sp.start+sp.s.length-1;sec+=2){const p=t.sample(tr,sec);if(!p)continue;const [x,y]=w(p.coordinate),pr=G.refProject(x,y);if(pr.dist>40)continue;targets.forEach((tg,k)=>{const gap=Math.abs(pr.d-tg);if(gap<best[k].gap)best[k]={gap,sec};});}
   if(full&&(best[0].gap>150||best[targets.length-1].gap>150))continue;   // full：只取南北兩端都經過的班次
   for(const [k,b] of best.entries()){if(b.sec==null||b.gap>60)continue;t.jump(b.sec);await drawn();const m=t.models.get(tr.id);if(!m.group.visible){skipped++;continue;}
    const cars=m.cars.map(c=>{const e=c.matrixWorld.elements;return [c.position.x,c.position.y,c.position.z,Math.asin(Math.max(-1,Math.min(1,e[2]))),e[0],e[1]];});
    out.push({id:tr.id,train:tr.train,dir:tr.direction,sec:b.sec,target:targets[k],cars,lens:m.parts.map(p=>p.lengthM)});}}
  return {out,skipped};},{src:GEOM_SRC,P,C,ids,targets,full,drawnSrc});
}
// 門檻的來源（實測）：車廂 z 與剖面 z(d)＋0.16 最大差 0.084 m，出現在 d≈5690 的剖面折點附近（路線頂點間的線性內插對剖面折線）；
// 俯仰對 ±8 m 窗坡度最大差 0.0047 rad。兩個門檻各留一點餘裕；超過就是頁面的高程或俯仰偏離剖面，不是量測雜訊。
const PITCH_TOL=.008,Z_TOL=.1;
function analyzeElevation(rows,minCov=20){
 const cov={},errs=[];let maxDz=0,maxDp=0,maxDzAt='',maxDpAt='',cars=0,signChecks=0;
 for(const r of rows){const sign=r.dir==='北上'?1:-1;
  for(const [x,y,z,pitch] of r.cars){cars++;const pr=G.refProject(x,y),near=pr.dist<=NEAR_REF,d=pr.d,ez=(near?G.zProf(d):0)+.16,dz=Math.abs(z-ez);
   const exp=near?Math.atan2(G.zProf(d+8)-G.zProf(d-8),16)*sign:0,dp=Math.abs(pitch-exp),reg=near?region(d):(d<=1e-6?'south-ground':d>=P[P.length-1][2]-1e-6?'north-ground':null);
   if(dz>maxDz){maxDz=dz;maxDzAt=`${r.train} ${r.dir} t=${r.sec} d=${f1(d,0)} z=${f1(z)} 期望 ${f1(ez)}`;}if(dp>maxDp){maxDp=dp;maxDpAt=`${r.train} ${r.dir} t=${r.sec} d=${f1(d,0)} pitch=${f1(pitch,4)} 期望 ${f1(exp,4)}`;}
   if(dz>Z_TOL)errs.push(`z 差 ${f1(dz)}：${r.train} ${r.dir} t=${r.sec} d=${f1(d,0)} z=${f1(z)} 期望 ${f1(ez)}`);
   if(dp>PITCH_TOL)errs.push(`俯仰差 ${f1(dp,4)}：${r.train} ${r.dir} t=${r.sec} d=${f1(d,0)} pitch=${f1(pitch,4)} 期望 ${f1(exp,4)}`);
   if(Math.abs(exp)>=PITCH_TOL){signChecks++;if(Math.sign(pitch)!==Math.sign(exp))errs.push(`俯仰方向相反：${r.train} ${r.dir} t=${r.sec} d=${f1(d,0)} pitch=${f1(pitch,4)} 期望 ${f1(exp,4)}`);}
   if(reg){const key=r.dir+'|'+reg;cov[key]=(cov[key]||0)+1;}}}
 const lack=[];for(const dir of ['北上','南下'])for(const reg of REGIONS)if((cov[dir+'|'+reg]||0)<minCov)lack.push(`${dir}${reg}只有 ${cov[dir+'|'+reg]||0} 輛次`);
 if(lack.length)errs.push(`涵蓋不足（每個方向每個區段至少 ${minCov} 輛次）：`+lack.join('、'));
 if(signChecks<200)errs.push(`有明顯坡度（|期望俯仰|≥${PITCH_TOL}）的輛次只有 ${signChecks}，方向檢查沒有鑑別力`);
 return {errs,maxDz,maxDp,maxDzAt,maxDpAt,cars,cov,signChecks};
}
async function checkElevation(o,{ids,full=false,minCov=20}){
 const {out,skipped}=await sampleElevation(o.page,{ids,full}),a=analyzeElevation(out,minCov);
 const unique=[...new Set(a.errs.map(e=>e.split('：')[0].replace(/[\d.]+/g,'#')))];
 return {pass:!a.errs.length,detail:a.errs.length?`${a.errs.length} 項不符（${unique.join('、')}）；例：${a.errs.slice(0,3).join('；')}`:`${ids.length} 班車、${out.length} 個時刻、${a.cars} 輛次：車廂 z 與 剖面z(d)＋0.16 最大差 ${f1(a.maxDz)} m（${a.maxDzAt}）；俯仰與剖面坡度（±8 m 窗）最大差 ${f1(a.maxDp,4)} rad（${a.maxDpAt}）；有坡度的 ${a.signChecks} 輛次方向全對；涵蓋 ${REGIONS.map(r=>r+' '+['北上','南下'].map(d=>a.cov[d+'|'+r]||0).join('/')).join('、')}；略過不可見 ${skipped}`,rows:out};
}
// 臺南停靠：整列的中心（首輛前端與末輛後端的中點）投影到參考線，距 centerD ≤1 m；兩端都在 d0～d1 內（容許 0.5 m）；車廂 z＝月台軌道面＋0.16。
async function sampleStop(page,{ids}){
 return page.evaluate(async({src,P,C,ids,drawnSrc})=>{
  const t=window.tainanMemory,d=t.data,drawn=()=>eval(drawnSrc),tn=s=>s.name.replace('台','臺')==='臺南';
  t.state.playing=false;t.state.follow='';const out=[];let skipped=0;
  for(const tr of d.trains){if(!ids.includes(tr.id))continue;const st=tr.stops.find(s=>tn(s)&&s.stop!==false);if(!st)continue;
   const dwell=st.depSec-st.arrSec,sec=dwell>=60?Math.round((st.arrSec+st.depSec)/2):st.arrSec;if(!t.sample(tr,sec)){skipped++;continue;}
   t.jump(sec);await drawn();const m=t.models.get(tr.id);if(!m.group.visible){skipped++;continue;}
   const cars=m.cars.map(c=>{const e=c.matrixWorld.elements;return [c.position.x,c.position.y,c.position.z,e[0],e[1]];});
   out.push({id:tr.id,train:tr.train,dir:tr.direction,sec,dwell,end:st.end||'',cars,lens:m.parts.map(p=>p.lengthM)});}
  return {out,skipped};},{src:GEOM_SRC,P,C,ids,drawnSrc});
}
function analyzeStop(rows,minN=150){
 const errs=[];let maxC=0,maxCAt='',minE=1e9,maxE=-1e9,maxZ=0,n=0,short=0,seen=new Set();
 for(const r of rows){n++;seen.add(r.dir);const c0=r.cars[0],cN=r.cars[r.cars.length-1],n0=Math.hypot(c0[3],c0[4]),nN=Math.hypot(cN[3],cN[4]),
   front=[c0[0]+c0[3]/n0*r.lens[0]/2,c0[1]+c0[4]/n0*r.lens[0]/2],back=[cN[0]-cN[3]/nN*r.lens[r.lens.length-1]/2,cN[1]-cN[4]/nN*r.lens[r.lens.length-1]/2],mid=[(front[0]+back[0])/2,(front[1]+back[1])/2],
   dC=G.refProject(...mid),dF=G.refProject(...front).d,dB=G.refProject(...back).d,lo=Math.min(dF,dB),hi=Math.max(dF,dB);
  if(r.dwell<60)short++;
  const off=Math.abs(dC.d-PLAT.centerD);if(off>maxC){maxC=off;maxCAt=`${r.train} ${r.dir} t=${r.sec} 中心 d=${f1(dC.d,2)}`;}minE=Math.min(minE,lo);maxE=Math.max(maxE,hi);
  if(off>1)errs.push(`中心離 centerD ${f1(off,2)} m：${r.train} ${r.dir} t=${r.sec}（停站 ${r.dwell} 秒${r.end?'，'+r.end:''}）`);
  if(lo<PLAT.d0-.5||hi>PLAT.d1+.5)errs.push(`車身超出月台 ${PLAT.d0}～${PLAT.d1}：${r.train} ${r.dir} 兩端 d ${f1(lo,1)}～${f1(hi,1)}`);
  for(const c of r.cars){const dz=Math.abs(c[2]-(platformZ+.16));maxZ=Math.max(maxZ,dz);if(dz>Z_TOL){errs.push(`停站時車廂 z ${f1(c[2])}≠月台 ${f1(platformZ+.16)}：${r.train}`);break;}}}
 if(n<minN)errs.push(`量到的停靠班次只有 ${n}（要 ≥${minN}）`);if(!(seen.has('北上')&&seen.has('南下')))errs.push('停靠班次沒有同時涵蓋南北兩個方向');
 return {errs,n,maxC,maxCAt,minE,maxE,maxZ,short};
}
async function checkStop(o,{ids,minN=150}){
 const {out,skipped}=await sampleStop(o.page,{ids}),a=analyzeStop(out,minN);
 return {pass:!a.errs.length,detail:a.errs.length?`${a.errs.length} 項不符；例：${a.errs.slice(0,3).join('；')}`:`${a.n} 班（含 ${a.short} 班停站不足 60 秒的終點／起點班，取到站那一秒）：整列中心離 centerD ${PLAT.centerD} 最大 ${f1(a.maxC,3)} m（${a.maxCAt}）；兩端 d 在 ${f1(a.minE,1)}～${f1(a.maxE,1)}，月台 ${PLAT.d0}～${PLAT.d1}；車廂 z 離月台軌道面＋0.16 最大 ${f1(a.maxZ)}；略過 ${skipped}`};
}

// ───────────────────────── 檢查：標籤、跟車鏡頭高度、平移高度 ─────────────────────────
// 從高程取樣挑 6 個代表（南北向 × 隧道／U 槽／月台），跟車後讀標籤位置與鏡頭目標。
function pickFollowCases(rows){const pick=[];for(const dir of ['北上','南下'])for(const [tg,name] of [[450,'南 U 槽'],[3000,'隧道'],[PLAT.centerD,'月台'],[7450,'北 U 槽']]){const r=rows.find(x=>x.dir===dir&&x.target===tg);if(r)pick.push({id:r.id,train:r.train,dir,sec:r.sec,name});}return pick;}
async function sampleFollow(page,cases){
 return page.evaluate(async({src,P,C,cases,drawnSrc})=>{
  const G=(new Function('return '+src))()(P,C),t=window.tainanMemory,d=t.data,sx=111320*Math.cos(d.origin[1]*Math.PI/180),w=c=>[(c[0]-d.origin[0])*sx,(c[1]-d.origin[1])*111320],drawn=()=>eval(drawnSrc),out=[];
  t.state.playing=false;
  for(const c of cases){const tr=d.trains.find(x=>x.id===c.id);t.followTrain(c.id);t.jump(c.sec);await drawn();await drawn();
   const p=t.sample(tr,c.sec),[x,y]=w(p.coordinate),pr=G.refProject(x,y),zExp=pr.dist<=40?G.zProf(pr.d):0,m=t.models.get(c.id),l=m.label,rect=t.renderer.domElement.getBoundingClientRect(),
    q=t.camera.position.clone().set(x,y,7+zExp).project(t.camera),ex=(q.x*.5+.5)*rect.width,ey=(-q.y*.5+.5)*rect.height,tm=/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(l.e.style.transform),v=t.getView();
   out.push({...c,x,y,zExp,hidden:l.e.hidden,ex,ey,ax:tm?+tm[1]:NaN,ay:tm?+tm[2]:NaN,view:v,follow:t.state.follow});}
  t.followTrain('');return out;},{src:GEOM_SRC,P,C,cases,drawnSrc});
}
function checkLabels(rows){const errs=[];let maxE=0,deep=0;for(const r of rows){const e=Math.hypot(r.ax-r.ex,r.ay-r.ey);maxE=Math.max(maxE,e);if(r.hidden)errs.push(`${r.train} ${r.name} 的標籤被隱藏`);else if(!(e<=1.5))errs.push(`${r.train} ${r.dir} ${r.name}：標籤在 (${f1(r.ax,1)},${f1(r.ay,1)})，依 3D 位置（含 z＝${f1(r.zExp,1)}）投影該在 (${f1(r.ex,1)},${f1(r.ey,1)})，差 ${f1(e,1)} px`);if(Math.abs(r.zExp)>=5)deep++;}
 if(rows.length<6)errs.push(`代表案例只有 ${rows.length} 個`);if(deep<4)errs.push(`深度 ≥5 m 的案例只有 ${deep} 個，這項檢查沒有鑑別力`);
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`${rows.length} 個案例（${rows.map(r=>r.train+r.dir+r.name).join('、')}）：標籤位置與 (x,y,7＋剖面z) 的投影最大差 ${f1(maxE,2)} px（門檻 1.5），其中深度 ≥5 m 的 ${deep} 個`};}
function checkFollowZ(rows){const errs=[];let maxZ=0,maxXY=0;for(const r of rows){const dz=Math.abs(r.view.z-r.zExp),dxy=Math.hypot(r.view.x-r.x,r.view.y-r.y);maxZ=Math.max(maxZ,dz);maxXY=Math.max(maxXY,dxy);
  if(r.follow!==r.id)errs.push(r.train+' 沒有進入跟車');if(dz>Z_TOL)errs.push(`${r.train} ${r.dir} ${r.name}：鏡頭目標 z＝${f1(r.view.z)}，列車軌道面該是 ${f1(r.zExp)}`);if(dxy>.01)errs.push(`${r.train} 鏡頭目標 xy 離列車 ${f1(dxy,3)} m`);}
 return {pass:!errs.length,detail:errs.length?errs.join('；'):`${rows.length} 個案例：跟車時鏡頭目標 z 與列車軌道面（剖面 z）最大差 ${f1(maxZ)} m、xy 最大差 ${f1(maxXY,4)} m`};}
// 平移：單指／左鍵拖曳不改鏡頭目標的 z（目標在地下時，平移後仍在原來那個水平面上），且該水平面上的點跟著游標走。
async function checkPan(o){
 const page=o.page,errs=[],info=[];
 for(const [z,tilt,az] of [[-6,55,3.6],[-18,30,1.2],[-12,80,5.5]]){
  await page.evaluate(([z,tilt,az])=>{const t=window.tainanMemory;t.followTrain('');t.setView({x:30,y:60,z,span:200,azimuth:az,tilt:tilt*Math.PI/180});},[z,tilt,az]);await settle(page);
  const ground=(x,y,z0)=>page.evaluate(([x,y,z0])=>{const c=window.tainanMemory.camera,r=window.tainanMemory.renderer.domElement.getBoundingClientRect(),o=c.position.clone().set((x-r.left)/r.width*2-1,-((y-r.top)/r.height*2-1),-1).unproject(c),d=c.position.clone().set(0,0,-1).transformDirection(c.matrixWorld),t=(z0-o.z)/d.z;return [o.x+d.x*t,o.y+d.y*t];},[x,y,z0]);
  const rect=await page.evaluate(()=>{const r=window.tainanMemory.renderer.domElement.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}),cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;
  const v0=await page.evaluate(()=>window.tainanMemory.getView()),g0=await ground(cx,cy,z);
  await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+70,cy+45,{steps:8});await page.mouse.up();await settle(page);
  const v1=await page.evaluate(()=>window.tainanMemory.getView()),g1=await ground(cx+70,cy+45,z),moved=Math.hypot(v1.x-v0.x,v1.y-v0.y),follow=Math.hypot(g1[0]-g0[0],g1[1]-g0[1]);
  info.push(`z=${z} 仰角 ${tilt}°：z 變化 ${(v1.z-v0.z).toExponential(1)}，目標平移 ${f1(moved,1)} m，游標下的點偏差 ${f1(follow,3)} m`);
  if(Math.abs(v1.z-v0.z)>1e-9)errs.push(`z=${z} 仰角 ${tilt}°：平移後目標 z 從 ${v0.z} 變成 ${v1.z}`);if(moved<3)errs.push(`z=${z} 仰角 ${tilt}°：拖曳後目標只動了 ${f1(moved,2)} m`);if(follow>.05)errs.push(`z=${z} 仰角 ${tilt}°：該水平面上，游標按下的點在放開時偏離游標 ${f1(follow,3)} m`);}
 await page.evaluate(()=>window.tainanMemory.homeView());
 return {pass:!errs.length,detail:errs.length?errs.join('；'):info.join('；')};
}

// ───────────────────────── 檢查：深度衝突（沿視線微移） ─────────────────────────
const D2R=Math.PI/180,JITTER=[.0004,.0009,.0017,.0031],PIX_T=30;
const mkViews=(secS,secN)=>{const S=cxy('south-portal'),N=cxy('north-portal'),views=[];
 for(const [name,xy,sec] of [['南洞口',S,secS],['北洞口',N,secN]])for(const [tilt,az,span] of [[18,3.6,90],[35,.9,70],[60,3.6,60],[85,3.6,60]])views.push({name:`${name} 仰角${tilt}° 方位${az}`,sec,view:{x:xy[0],y:xy[1],z:-3.5,span,azimuth:az,tilt:tilt*D2R},core:true});
 for(const [tilt,az,span] of [[55,3.6,110],[30,.9,90],[80,3.6,140]])views.push({name:`月台 仰角${tilt}° 方位${az}`,sec:30420,view:{x:platformXY[0],y:platformXY[1],z:-16,span,azimuth:az,tilt:tilt*D2R},core:true});
 views.push({name:'預設鏡頭',sec:30420,view:'home',core:false},{name:'中景 1500 m',sec:30420,view:{x:400,y:-1500,z:-5,span:1500,azimuth:3.6,tilt:50*D2R},core:false},{name:'全線',sec:30420,view:{x:400,y:-3250,z:0,span:10500,azimuth:3.6,tilt:Math.atan2(6800,8000)},core:false});
 return views;};
const depthMeasureSrc=`(({deltas,T})=>{const t=window.tainanMemory,r=t.renderer,cam=t.camera,scene=t.underground.veil.parent,gl=r.getContext();
 const snap=()=>{r.render(scene,cam);const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,b=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);return {b,W,H};};
 const base=snap(),dir=cam.position.clone().set(0,0,-1).transformDirection(cam.matrixWorld),res=[];
 for(const dl of deltas){cam.position.addScaledVector(dir,dl);cam.updateMatrixWorld(true);const s=snap();cam.position.addScaledVector(dir,-dl);cam.updateMatrixWorld(true);
  let n=0,mx=0,x0=1e9,x1=-1,y0=1e9,y1=-1;for(let i=0,k=0;i<base.b.length;i+=4,k++){const dd=Math.abs(s.b[i]-base.b[i])+Math.abs(s.b[i+1]-base.b[i+1])+Math.abs(s.b[i+2]-base.b[i+2]);if(dd>0)mx=Math.max(mx,dd);if(dd>T){n++;const x=k%base.W,y=base.H-1-Math.floor(k/base.W);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  res.push({delta:dl,n,max:mx,bbox:n?[x0,y0,x1,y1]:null});}
 cam.updateMatrixWorld(true);return {W:base.W,H:base.H,res};})`;
async function measureDepth(page,views){
 const out=[];
 for(const v of views){await page.evaluate(([sec,view])=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.jump(sec);if(view==='home')t.homeView();else t.setView(view);},[v.sec,v.view]);await settle(page);
  const r=await page.evaluate(`${depthMeasureSrc}(${JSON.stringify({deltas:JITTER,T:PIX_T})})`);
  const worst=r.res.reduce((a,b)=>b.n>a.n?b:a);out.push({...v,W:r.W,H:r.H,worst:worst.n,bbox:worst.bbox,frac:worst.n/(r.W*r.H),res:r.res});
  if(process.env.DEPTH_DEBUG)console.log('  [深度] '+v.name+'：'+r.res.map(x=>x.delta*1000+'mm→'+x.n).join(' ')+`（${r.W}×${r.H}）`);}
 await page.evaluate(()=>window.tainanMemory.homeView());
 return out;
}
// 沒有深度衝突時，沿視線平移後影像幾乎不變；乾淨頁面仍會有零星孤立的像素變色（量到最多 7 個，約 0.001%），
// 真正的共面衝突是成片閃動（量到最少 0.39%）。門檻取畫面的 0.02%，兩邊各留 20 倍以上。
const DEPTH_MAX_FRAC=.0002;
async function checkDepth(o,{secS,secN}){
 const rows=await measureDepth(o.page,mkViews(secS,secN)),core=rows.filter(r=>r.core),errs=[];
 for(const r of core)if(r.frac>DEPTH_MAX_FRAC)errs.push(`${r.name}：沿視線微移後有 ${r.worst} 個像素變色（${f1(r.frac*100,3)}%），範圍 ${r.bbox}`);
 const info=rows.filter(r=>!r.core).map(r=>`${r.name} ${r.worst}`).join('、'),peak=Math.max(...core.map(r=>r.worst));
 return {pass:!errs.length,detail:errs.length?`${errs.length}／${core.length} 個視角不穩：${errs.slice(0,3).join('；')}`:`${core.length} 個地下結構視角（南北洞口各 4 種仰角方位、月台 3 種）沿視線平移 ${JITTER.map(v=>v*1000).join('／')} mm 後，顏色差總和 >${PIX_T} 的像素最多 ${peak} 個（門檻：畫面的 ${DEPTH_MAX_FRAC*100}%）；另量（不計入）：${info}`,rows};
}

// ───────────────────────── 檢查：手機版面（尺寸 × 狀態 × 觸控） ─────────────────────────
// 直立：360、375、390（介於中間）、414、500（介於中間）、640（介於中間）、768、834（介於中間）；橫向：同一批尺寸對調；再加寬不到 700 的橫向手機與矮螢幕。
const SIZES=[[360,780],[375,812],[390,844],[414,896],[500,900],[640,960],[768,1024],[834,1112],[780,360],[812,375],[844,390],[896,414],[900,500],[960,640],[1024,768],[1112,834],[667,375],[640,360],[568,320],[844,340],[740,340],[932,430]];
// 視窗寬以設定值（vw，來自 page.viewportSize）為準，不以 innerWidth 為準：Chromium 的行動模擬在內容比視窗寬時會把整頁縮小，innerWidth 跟著變大，
// 只比 scrollWidth 與 innerWidth 的話溢出看不出來。所以先直接斷言 innerWidth＝vw、visualViewport.scale＝1，再比 scrollWidth 與 vw。
const layoutSrc=`((scope,vw)=>{
 const errs=[],q=s=>document.querySelector(s),vis=e=>!!e&&e.getClientRects().length>0;
 if(innerWidth!==vw)errs.push('innerWidth＝'+innerWidth+'，不等於設定的視窗寬 '+vw+'（內容過寬，整頁被縮小）');
 if(window.visualViewport&&Math.abs(window.visualViewport.scale-1)>.001)errs.push('visualViewport.scale＝'+window.visualViewport.scale.toFixed(3)+'，頁面被縮放');
 const root=q(scope),all=[...root.querySelectorAll('button,a,input,select')].filter(e=>vis(e)&&!e.closest('dialog:not([open])'));
 const boxes=all.map(e=>({id:e.id||(e.textContent||'').trim().slice(0,16)||e.tagName,e,r:e.getBoundingClientRect()})).filter(v=>v.r.width&&v.r.height);
 for(const b of boxes){if(b.r.left<-.1||b.r.right>innerWidth+.1||b.r.top<-.1||b.r.bottom>innerHeight+.1)errs.push('溢出:'+b.id);const hit=document.elementFromPoint(b.r.x+b.r.width/2,b.r.y+b.r.height/2);if(hit!==b.e&&!b.e.contains(hit))errs.push('無法觸及:'+b.id);if(b.r.width<24||b.r.height<24)errs.push('觸控目標過小:'+b.id);}
 const ov=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;if(ov(a.r,b.r))errs.push('相交:'+a.id+'/'+b.id);}
 if(scope==='body'){
  const R=s=>{const e=q(s);return vis(e)?e.getBoundingClientRect():null;},hd=R('header'),pb=R('.playback'),sc=R('#scene'),fpEl=q('#fpanel'),fp=fpEl&&!fpEl.hidden&&vis(fpEl)?fpEl.getBoundingClientRect():null,note=R('.scene-note');
  if(hd&&sc&&ov(hd,sc))errs.push('標頭與場景相交');if(pb&&sc&&ov(pb,sc))errs.push('重播控制與場景相交');if(hd&&pb&&ov(hd,pb))errs.push('標頭與重播控制相交');
  if(sc&&!(sc.width>100&&sc.height>60))errs.push('場景太小 '+Math.round(sc.width)+'×'+Math.round(sc.height));
  if(fp){const floating=getComputedStyle(fpEl).position==='absolute';
   if(floating){if(fp.left<sc.left-.5||fp.right>sc.right+.5||fp.top<sc.top-.5||fp.bottom>sc.bottom+.5)errs.push('浮動的逐站時刻鈕超出場景');}
   else{if(sc&&ov(fp,sc))errs.push('逐站時刻面板與場景相交');if(pb&&ov(fp,pb))errs.push('逐站時刻面板與重播控制相交');if(hd&&ov(fp,hd))errs.push('逐站時刻面板與標頭相交');}
   if(fp.left<-.5||fp.right>innerWidth+.5||fp.top<-.5||fp.bottom>innerHeight+.5)errs.push('逐站時刻面板超出視窗');}
  if(note)for(const b of boxes)if(ov(note,b.r))errs.push('操作提示與控件相交:'+b.id);
 }
 if(document.documentElement.scrollWidth>vw||document.body.scrollWidth>vw)errs.push('水平捲動');
 return {count:boxes.length,ids:boxes.map(b=>b.id),errs};})`;
const layoutErrors=(page,scope='body')=>page.evaluate(`${layoutSrc}(${JSON.stringify(scope)},${page.viewportSize().width})`);
// 覆蓋斷言：版面掃描一定要掃到頁面的每個控件（掃不到就是分母縮水，沒有重疊也不代表沒問題）。「關於」鈕在窄版叫 about、寬螢幕橫放叫 aboutNav；逐站時刻鈕只在跟車時出現。
const CTRL_IDS=['live','station','overview','rotate','zoomin','zoomout','wrap','timeline','play','time','speed','next','depart','train'];
const coverageMiss=(state,ids)=>[...CTRL_IDS,ids.includes('aboutNav')?'aboutNav':'about',...(state==='default'?[]:['fpToggle'])].filter(i=>!ids.includes(i));
// 狀態：default（預設鏡頭、08:27）、follow（跟著一班停臺南的車、面板預設）、follow-open（跟車且展開逐站時刻）、dialog（打開「關於」）
function followCase(){const tr=SNAP.trains.find(t=>t.direction==='北上'&&t.stops.some(s=>s.name.replace('台','臺')==='臺南'&&s.stop!==false&&s.depSec-s.arrSec>=120));const s=tr.stops.find(x=>x.name.replace('台','臺')==='臺南');return {id:tr.id,train:tr.train,sec:Math.round((s.arrSec+s.depSec)/2)};}
async function toState(page,state,fc){
 await page.evaluate(({state,fc})=>{const t=window.tainanMemory,dlg=document.getElementById('details');if(dlg.open)dlg.close();t.state.playing=false;t.panel.setOpen(null);
  if(state==='default'){t.followTrain('');t.jump(30420);t.homeView();}else{t.jump(fc.sec);t.followTrain(fc.id);if(state==='follow-open')t.panel.setOpen(true);}},{state,fc});
 await settle(page);
 if(state==='dialog'){const sel=await page.evaluate(()=>{const a=document.getElementById('about');return a.getClientRects().length?'#about':'#aboutNav';});await page.tap(sel,{timeout:4000});await page.waitForFunction(()=>document.getElementById('details').open,null,{timeout:4000});}
}
// 「關於」視窗：每個連結與按鈕捲得到、座標點得到自己、高度 ≥44（觸控目標）。
async function dialogErrors(page){
 const errs=[],n=await page.locator('#details a,#details button').count();
 for(let i=0;i<n;i++){const c=page.locator('#details a,#details button').nth(i);await c.scrollIntoViewIfNeeded();const ok=await c.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {ok:b.height>=44&&(e===h||e.contains(h)),h:Math.round(b.height),inView:b.top>=-.5&&b.bottom<=innerHeight+.5};});if(!ok.ok)errs.push(`說明視窗第 ${i} 個控件點不到或太矮（高 ${ok.h}）`);if(!ok.inView)errs.push(`說明視窗第 ${i} 個控件捲動後仍不在視窗內`);}
 const d=await page.evaluate(()=>{const r=document.getElementById('details').getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5&&r.top>=-.5&&r.bottom<=innerHeight+.5;});if(!d)errs.push('說明視窗超出視窗');
 return errs;
}
// 逐一用觸控點每個控件，並核對效果（臺南站月台、鏡頭高度等 10/23 才有的語意）。
// 「下一班到臺南」只算停臺南、不是在臺南始發（stops[].end 不是 'origin'）的班次，取到站秒；「臺南發車」只算在臺南始發的班次，取開車秒。
// 兩者都取第一個晚於「按之前的時間＋25 秒」的，沒有就回到當天第一班，跳到那一秒之前 25 秒（夾在 0–86399）；畫面中心移到月台中央（含高度），取消跟車。
// 始發車沒有到站、開車那一秒才出現：「下一班到臺南」若把它算進去，跳過去會先看到 25 秒的空月台。
// 兩者都只算 23:59:59 以前到站／開車的班次（頁面同樣只算這些）：隔天凌晨才到臺南的跨午夜車跳不過去，算進去的話按了會停在 23:59:59。
const TAINAN_STOPS=SNAP.trains.map(t=>t.stops.find(s=>s.name.replace('台','臺')==='臺南')).filter(Boolean);
const TAINAN_ARR=TAINAN_STOPS.filter(s=>s.end!=='origin'&&s.arrSec<=86399).map(s=>s.arrSec).sort((a,b)=>a-b);
const TAINAN_DEP=TAINAN_STOPS.filter(s=>s.end==='origin'&&s.depSec<=86399).map(s=>s.depSec).sort((a,b)=>a-b);
const LEAD=25,expJump=(list,t0)=>Math.max(0,Math.min(86399,(list.find(x=>x>t0+LEAD)??list[0])-LEAD));
// 測試時刻都從資料找，不寫死：
//  ORIGIN_FIRST＝下一個會停臺南的班次是臺南始發車（它開車前 35 秒內沒有別班到站），按之前站在它開車前 60 秒；而且「把始發車算進去」的舊算法會跳到不同的秒數（這個案例分得出對錯）。
//  DEPART_WRAP＝最後一班始發車開走之後 60 秒：「臺南發車」要回到當天第一班始發車。
//  NEXT_WRAP＝當天最後一班到臺南的班次到站前 25 秒（之後當天沒有任何一班）：「下一班到臺南」要回到當天第一班，不能停在 23:59:59。
const ORIGIN_FIRST=(()=>{for(const o of TAINAN_DEP){if(TAINAN_ARR.some(a=>a>o-35&&a<=o))continue;const t0=o-60;if(t0>=0&&expJump(TAINAN_ARR,t0)!==o-LEAD)return {t0,dep:o};}return null;})();
const DEPART_WRAP=TAINAN_DEP.length>1&&TAINAN_DEP[TAINAN_DEP.length-1]+60<=86399?{t0:TAINAN_DEP[TAINAN_DEP.length-1]+60,first:TAINAN_DEP[0]}:null;
const NEXT_WRAP=TAINAN_ARR.length>1?{t0:TAINAN_ARR[TAINAN_ARR.length-1]-LEAD,first:TAINAN_ARR[0]}:null;
const STATION_XY=world(readJson('station/model.json').anchor);
async function tapSuite(page,fc){
 const errs=[],E=m=>errs.push(m),near=(a,b,t)=>Math.abs(a-b)<=t;
 const tap=async sel=>{try{await page.tap(sel,{timeout:4000});return true;}catch(e){E('點不到 '+sel+'：'+e.message.split('\n')[0]);return false;}};
 const st=()=>page.evaluate(()=>{const t=window.tainanMemory;return {sec:t.state.sec,playing:t.state.playing,follow:t.state.follow,view:t.getView(),wrap:t.wrap?.visible,wrapText:document.getElementById('wrap').textContent,panel:t.panel.isOpen(),expanded:document.getElementById('fpToggle').getAttribute('aria-expanded'),play:document.getElementById('play').textContent,speed:t.state.speed,clock:document.getElementById('clock').textContent,dlg:document.getElementById('details').open,span:t.camera.top-t.camera.bottom};});
 await toState(page,'default',fc);
 let a,b;
 if(await tap('#play')){a=await st();if(!a.playing||a.play!=='暫停')E('按「暫停／播放」第一下：state.playing＝'+a.playing+'、按鈕字＝'+a.play);}
 if(await tap('#play')){a=await st();if(a.playing||a.play!=='播放')E('按「暫停／播放」第二下：state.playing＝'+a.playing+'、按鈕字＝'+a.play);}
 // 下一班到臺南（不含臺南始發的車）：時間跳到下一班到站前 25 秒，畫面中心移到月台中央（含深度）
 const s0=(await st()).sec,wantSec=expJump(TAINAN_ARR,s0);
 if(await tap('#next')){await settle(page);a=await st();if(!near(a.sec,wantSec,1.5))E(`「下一班到臺南」：時間 ${f1(a.sec,1)}，該是 ${wantSec}`);if(!near(a.view.x,platformXY[0],.02)||!near(a.view.y,platformXY[1],.02)||!near(a.view.z,platformZ,.02))E(`「下一班到臺南」：畫面中心 (${f1(a.view.x,2)},${f1(a.view.y,2)},${f1(a.view.z,2)})，該是月台中央 (${f1(platformXY[0],2)},${f1(platformXY[1],2)},${f1(platformZ,2)})`);}
 // 臺南發車：時間跳到下一班臺南始發的車開車前 25 秒，畫面中心同樣移到月台中央
 const s1=(await st()).sec,wantDep=expJump(TAINAN_DEP,s1);
 if(await tap('#depart')){await settle(page);a=await st();if(!near(a.sec,wantDep,1.5))E(`「臺南發車」：時間 ${f1(a.sec,1)}，該是 ${wantDep}`);if(!near(a.view.x,platformXY[0],.02)||!near(a.view.y,platformXY[1],.02)||!near(a.view.z,platformZ,.02))E(`「臺南發車」：畫面中心 (${f1(a.view.x,2)},${f1(a.view.y,2)},${f1(a.view.z,2)})，該是月台中央 (${f1(platformXY[0],2)},${f1(platformXY[1],2)},${f1(platformZ,2)})`);}
 a=await st();if(await tap('#zoomin')){b=await st();if(!near(b.span,Math.max(34,a.span/1.5),.01))E(`放大：視野 ${f1(a.span,1)}→${f1(b.span,1)}`);}
 a=await st();if(await tap('#zoomout')){b=await st();if(!near(b.span,Math.min(14000,a.span*1.5),.01))E(`縮小：視野 ${f1(a.span,1)}→${f1(b.span,1)}`);}
 a=await st();if(await tap('#rotate')){b=await st();const dz=Math.atan2(Math.sin(b.view.azimuth-a.view.azimuth),Math.cos(b.view.azimuth-a.view.azimuth));if(!near(dz,Math.PI/4,1e-6))E('旋轉：方位角該加 45°，實際 '+f1(dz*180/Math.PI,2)+'°');}
 if(await tap('#overview')){b=await st();if(!near(b.span,10500,.01)||!near(b.view.x,400,.01)||!near(b.view.y,-3250,.01)||!near(b.view.z,0,.01))E('全線：鏡頭不是全線預設 '+JSON.stringify(b.view));}
 if(await tap('#station')){b=await st();if(!near(b.span,140,.01)||!near(b.view.x,STATION_XY[0]+18,.01)||!near(b.view.y,STATION_XY[1],.01)||!near(b.view.z,0,.01)||!near(b.view.azimuth,3.6,1e-9))E('舊站近景：鏡頭不是舊站預設 '+JSON.stringify(b.view));}
 a=await st();if(await tap('#wrap')){b=await st();if(b.wrap===a.wrap||b.wrapText===a.wrapText)E('外罩鈕沒有切換');await tap('#wrap');b=await st();if(b.wrap!==a.wrap)E('外罩鈕按兩下沒有回到原狀');}
 await page.selectOption('#speed','60');b=await st();if(b.speed!==60)E('播放速度選單沒有生效 '+b.speed);
 await page.fill('#time','17:30:00');await page.dispatchEvent('#time','change');b=await st();if(b.clock!=='17:30:00')E('時間欄輸入 17:30:00 後時鐘是 '+b.clock);
 const tl=await page.locator('#timeline').boundingBox();await page.touchscreen.tap(tl.x+tl.width*.75,tl.y+tl.height/2);b=await st();if(!(b.sec>60000))E('點時間軸 75% 處，時間是 '+f1(b.sec,0));
 await page.evaluate(([id,sec])=>{const t=window.tainanMemory;t.jump(sec);},[fc.id,fc.sec]);
 await page.selectOption('#train',fc.id);await settle(page);b=await st();if(b.follow!==fc.id)E('下拉選單選車後沒有進入跟車');
 const toggleOk=await page.evaluate(()=>!document.getElementById('fpanel').hidden);if(!toggleOk)E('跟車後逐站時刻面板沒有出現');
 else{a=await st();if(await tap('#fpToggle')){b=await st();if(b.expanded===a.expanded||b.panel===a.panel)E('逐站時刻的展開鈕沒有切換');await tap('#fpToggle');b=await st();if(b.expanded!==a.expanded)E('逐站時刻的展開鈕按兩下沒有回到原狀');}}
 await page.selectOption('#train','');b=await st();if(b.follow!=='')E('下拉選單選「不跟車」後仍在跟車');
 const sel=await page.evaluate(()=>document.getElementById('about').getClientRects().length?'#about':'#aboutNav');
 if(await tap(sel)){await page.waitForFunction(()=>document.getElementById('details').open,null,{timeout:4000}).catch(()=>E('按「關於」沒有打開說明視窗'));errs.push(...await dialogErrors(page));if(await tap('#details button')){b=await st();if(b.dlg)E('說明視窗的關閉鈕沒有關掉視窗');}}
 const href=await page.getAttribute('#live','href');if(href!=='../../?scene=3d&g=all&at=22.99681,120.21295&z=17')E('「回即時地圖」的連結不對：'+href);
 return errs;
}
async function checkLayoutMatrix(browser,engine,fc){
 const o=await openPage(browser,{viewport:{width:390,height:844},mobile:true}),page=o.page,errs=[];let scanned=Infinity;
 try{
  for(const [w,h] of SIZES){await page.setViewportSize({width:w,height:h});await settle(page);
   for(const state of ['default','follow','follow-open','dialog']){await toState(page,state,fc);
    const r=state==='dialog'?{count:0,ids:[],errs:await dialogErrors(page)}:await layoutErrors(page,'body');
    for(const e of r.errs)errs.push(`${w}×${h} ${state}：${e}`);
    if(state!=='dialog'){const miss=coverageMiss(state,r.ids);if(miss.length)errs.push(`${w}×${h} ${state}：版面掃描沒有掃到控件 ${miss.join('、')}`);scanned=Math.min(scanned,r.count);}}
   const t=await tapSuite(page,fc);for(const e of t)errs.push(`${w}×${h} 觸控：${e}`);
   await toState(page,'default',fc);}
 }finally{await o.context.close();}
 if(o.errors.length)errs.push('頁面 console error／pageerror：'+o.errors[0].slice(0,120));
 return {pass:!errs.length,detail:errs.length?`${errs.length} 項不符：${errs.slice(0,6).join('；')}`:`${SIZES.length} 種尺寸（直立 360／375／390／414／500／640／768／834 與橫向對調，另加 ${SIZES.slice(16).map(s=>s.join('×')).join('、')}）× 4 種狀態（預設、跟車、跟車展開、關於視窗）：每個狀態都掃到全部控件（最少 ${scanned} 個）：不溢出、座標點得到自己、互不相交、innerWidth＝設定的視窗寬且沒有縮放（visualViewport.scale＝1）、無水平捲動、區塊不重疊；每個尺寸另以 page.tap 逐一點控件並核對效果`};
}
// 版面對照：在 390×844 的預設與跟車展開兩個狀態跑同一個版面檢查
async function layoutQuick(o,fc){const errs=[];for(const state of ['default','follow-open']){await toState(o.page,state,fc);const r=await layoutErrors(o.page,'body');for(const e of r.errs)errs.push(`${state}：${e}`);const miss=coverageMiss(state,r.ids);if(miss.length)errs.push(`${state}：版面掃描沒有掃到控件 ${miss.join('、')}`);}return {pass:!errs.length,detail:errs.length?errs.slice(0,4).join('；'):'390×844 預設與跟車展開都沒有重疊／溢出，且掃到全部控件'};}
async function tapQuick(o,fc){const errs=await tapSuite(o.page,fc);return {pass:!errs.length,detail:errs.length?errs.slice(0,4).join('；'):'390×844 逐一觸控每個控件，效果都符合'};}

// ───────────────────────── 檢查：「下一班到臺南」「臺南發車」的跳轉（期望值從 snapshot 算） ─────────────────────────
// 桌機頁、用滑鼠點；每個案例先把時間放到指定秒、把畫面中心移離月台（才看得出按鈕有把它移回來），再按。
const hms=t=>new Date(Math.round(t)*1000).toISOString().slice(11,19);
async function checkJumps(o,fc){
 const page=o.page,errs=[],E=m=>errs.push(m),near=(a,b,t)=>Math.abs(a-b)<=t,NAME={'#next':'下一班到臺南','#depart':'臺南發車'};
 const st=()=>page.evaluate(()=>{const t=window.tainanMemory,d=document.getElementById('depart');return {sec:t.state.sec,follow:t.state.follow,sel:document.getElementById('train').value,view:t.getView(),hidden:d.hidden,shown:d.getClientRects().length>0};});
 const setup=async(sec,follow)=>{await page.evaluate(([s,f])=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.homeView();t.jump(s);if(f)t.followTrain(f);},[sec,follow||'']);await settle(page);};
 const press=async sel=>{await page.click(sel);await settle(page);return st();};
 const verdict=(label,sel,list,t0,a,extra='')=>{const want=expJump(list,t0),n=NAME[sel];
  if(!near(a.sec,want,1.5))E(`${label}：按「${n}」，時間 ${f1(a.sec,1)}（${hms(a.sec)}），該是 ${want}（${hms(want)}）${extra}`);
  if(!near(a.view.x,platformXY[0],.02)||!near(a.view.y,platformXY[1],.02)||!near(a.view.z,platformZ,.02))E(`${label}：按「${n}」，畫面中心 (${f1(a.view.x,2)},${f1(a.view.y,2)},${f1(a.view.z,2)}) 不是月台中央`);
  if(a.follow!==''||a.sel!=='')E(`${label}：按「${n}」之後還在跟車`);return want;};
 const s00=await st();if(s00.hidden||!s00.shown)E(`「臺南發車」鈕沒有顯示（hidden＝${s00.hidden}，有版面＝${s00.shown}）；這一天有 ${TAINAN_DEP.length} 班臺南始發的車`);
 const lines=[];
 // 1. 下一個會停臺南的班次是臺南始發車：「下一班到臺南」要跳過它（始發車沒有到站），「臺南發車」要跳到它
 if(!ORIGIN_FIRST)E('資料裡找不到「下一班停臺南的是臺南始發車」的時刻，這一項驗不了');
 else{const {t0,dep}=ORIGIN_FIRST;
  await setup(t0);const home=(await st()).view;if(near(home.x,platformXY[0],1)&&near(home.y,platformXY[1],1))E('起點的畫面中心就在月台中央，看不出按鈕有沒有移動畫面');
  let a=await press('#next');const wantN=verdict(hms(t0),'#next',TAINAN_ARR,t0,a,near(a.sec,dep-LEAD,1.5)?'（跳到臺南始發的車開車前 25 秒了：始發車沒有到站，不該算進「下一班到臺南」）':'');
  await setup(t0);a=await press('#depart');const wantD=verdict(hms(t0),'#depart',TAINAN_DEP,t0,a);if(!near(wantD,dep-LEAD,1.5))E(`${hms(t0)}：臺南始發的車 ${hms(dep)} 開車，「臺南發車」該跳到 ${hms(dep-LEAD)}`);
  lines.push(`${hms(t0)}：下一班停臺南的是 ${hms(dep)} 始發的車；「下一班到臺南」跳到 ${hms(wantN)}（跳過始發車）、「臺南發車」跳到 ${hms(wantD)}`);}
 // 2. 連按兩次：第二次要跳到再下一班（剛跳到前 25 秒，不能停在原地）
 for(const sel of ['#next','#depart']){const list=sel==='#next'?TAINAN_ARR:TAINAN_DEP;await setup(30420);let a=await press(sel);verdict('08:27 第一次',sel,list,30420,a);const t1=a.sec;a=await press(sel);verdict('連按第二次',sel,list,t1,a);
  if(near(a.sec,t1,.5))E(`連按「${NAME[sel]}」：第二次沒有往後跳（停在 ${hms(a.sec)}）`);lines.push(`08:27 連按「${NAME[sel]}」：${hms(t1)} → ${hms(a.sec)}`);}
 // 3. 最後一班臺南始發車開走之後：「臺南發車」回到當天第一班
 if(!DEPART_WRAP)E('資料裡沒有「最後一班始發車開走之後」的時刻，「臺南發車」繞回當天第一班驗不了');
 else{await setup(DEPART_WRAP.t0);const a=await press('#depart');verdict(hms(DEPART_WRAP.t0)+'（最後一班始發車開走之後）','#depart',TAINAN_DEP,DEPART_WRAP.t0,a,`（要繞回當天第一班始發車 ${hms(DEPART_WRAP.first)}）`);
  if(!near(a.sec,DEPART_WRAP.first-LEAD,1.5))E(`${hms(DEPART_WRAP.t0)}：「臺南發車」沒有繞回當天第一班（該是 ${hms(DEPART_WRAP.first-LEAD)}，實際 ${hms(a.sec)}）`);lines.push(`${hms(DEPART_WRAP.t0)}：「臺南發車」繞回 ${hms(a.sec)}`);}
 // 4. 當天最後一班到臺南之後：「下一班到臺南」回到當天第一班，不能停在 23:59:59（跨午夜才到站的車不算）
 if(!NEXT_WRAP)E('資料裡沒有「當天最後一班到臺南之前」的時刻，「下一班到臺南」繞回當天第一班驗不了');
 else{await setup(NEXT_WRAP.t0);const a=await press('#next');verdict(hms(NEXT_WRAP.t0)+'（當天最後一班到臺南之前）','#next',TAINAN_ARR,NEXT_WRAP.t0,a,`（要繞回當天第一班 ${hms(NEXT_WRAP.first)}）`);
  if(!near(a.sec,Math.max(0,NEXT_WRAP.first-LEAD),1.5))E(`${hms(NEXT_WRAP.t0)}：「下一班到臺南」沒有繞回當天第一班（該是 ${hms(Math.max(0,NEXT_WRAP.first-LEAD))}，實際 ${hms(a.sec)}）`);lines.push(`${hms(NEXT_WRAP.t0)}：「下一班到臺南」繞回 ${hms(a.sec)}`);}
 // 5. 跟車中按：取消跟車、畫面中心到月台中央
 for(const sel of ['#next','#depart']){await setup(fc.sec,fc.id);const b=await st();if(b.follow!==fc.id)E(`跟車中按「${NAME[sel]}」的起點：沒有進入跟車（${b.follow}）`);const a=await press(sel);verdict('跟車中',sel,sel==='#next'?TAINAN_ARR:TAINAN_DEP,b.sec,a);}
 lines.push('跟車中按兩顆鈕：都取消跟車並移到月台中央');
 return {pass:!errs.length,detail:errs.length?errs.slice(0,4).join('；'):lines.join('｜')};
}
// ───────────────────────── 檢查：跟車卡、字幕、徽章（預覽班表／實測重建兩種模式） ─────────────────────────
// 模式看磁碟上 snapshot.json 有沒有頂層 preview（頁面也是照這個欄位切換）。期望值全從 snapshot.json 推，不讀頁面裡的副本：
// 每一班、每一列的表定／重播／來源／差／留置都逐格比，不抽樣。
// 預覽班表沒有實測：停靠站照表定（差「準點」、來源「表定」）；通過站的重播時刻是行駛推算，來源標內插、差記「—」。
// 實測重建裡沒有任何即時動態紀錄的班次（timing scheduled）整班照表定，通過站同預覽：來源標內插、差記「—」。
// 實測重建：obs 站顯示實測時刻（開車時刻是推定）、沒有紀錄的站標內插、通過站照資料算差；有實測的停靠列差欄整排都是「—」就是壞了。
const PREVIEW=!!SNAP.preview,MODE=PREVIEW?'preview':'observed';
const SRC_NAME={obs:'實測',interp:'內插',sched:'表定',est:'推定'},DEP_SRC={obs:'est',interp:'interp',est:'est',sched:'sched'};
const clk=s=>[Math.floor(s/3600),Math.floor(s/60)%60,Math.floor(s)%60].map(v=>String(v).padStart(2,'0')).join(':');
const tmx=sec=>{if(!Number.isFinite(sec))return '—';const r=Math.round(sec),d=Math.floor(r/86400);return (d<0?'前日 ':d>0?'次日 ':'')+clk(r-d*86400);};
const durx=sec=>{const s=Math.round(Math.abs(sec)),m=Math.floor(s/60),r=s%60;return (m?m+'分':'')+(r||!m?r+'秒':'');};
const diffx=d=>!Number.isFinite(d)?'—':Math.abs(d)<5?'準點':(d>0?'晚':'早')+durx(d);
// 一列的期望文字：各欄是逐行（.ln）的字串陣列。起點站沒有到站、終點站沒有開車，那一行記「—」；通過站只有一行；留置 ≥90 秒的通過站照停靠站兩行。
function expectRow(s,tr){
 const pass=s.stop===false,hold=Number(s.holdSec)>=90?Number(s.holdSec):0,passed=pass&&!hold,has=Number.isFinite(s.schedArrSec),
  interp=passed&&(PREVIEW||tr.timing==='scheduled'),
  noArr=s.end==='origin'&&s.arrSec===s.depSec,noDep=s.end==='terminal'&&s.arrSec===s.depSec,ad=(a,d)=>[noArr?'—':a,noDep?'—':d];
 const srcKeys=passed?[interp?'interp':s.src]:ad(s.src,DEP_SRC[s.src]);
 return {passed,hold,has,interp,
  sched:has?(pass?['通過',tmx(s.schedArrSec)]:ad(tmx(s.schedArrSec),tmx(s.schedDepSec))):['—'],
  act:passed?['通過',tmx(s.arrSec)]:ad(tmx(s.arrSec),tmx(s.depSec)),
  src:srcKeys.map(k=>SRC_NAME[k]||'—'),
  diff:has?(passed?[interp?'—':diffx(s.arrSec-s.schedArrSec)]:ad(diffx(s.arrSec-s.schedArrSec),diffx(s.depSec-s.schedDepSec))):['—'],
  held:[hold?durx(hold):'—']};
}
// 頁面內一次跟過每一班，逐班讀出跟車卡（跟車對象一換，下一幀就重畫卡片；每班等兩幀）。
async function readCards(page,ids){
 return page.evaluate(async ids=>{
  const t=window.tainanMemory,out={};
  const frame=()=>new Promise((res,rej)=>{const f0=t.state.frames,t0=performance.now();const f=()=>{if(t.state.frames>f0)res();else if(performance.now()-t0>8000)rej(Error('頁面 8 秒沒有畫新的一幀'));else requestAnimationFrame(f);};requestAnimationFrame(f);});
  t.state.playing=false;t.followTrain('');await frame();
  for(const id of ids){
   t.followTrain(id);await frame();await frame();
   const c=document.getElementById('followcard');
   if(!c||c.hidden){out[id]=null;continue;}
   const rows=[...c.querySelectorAll('tbody tr')];
   out[id]={h:c.querySelector('h3')?.textContent||'',st:c.querySelector('.st')?.textContent||'',note:c.querySelector('.note')?.textContent||'',
    heads:[...c.querySelectorAll('thead th')].map(th=>th.textContent),names:rows.map(r=>r.dataset.name),
    cells:rows.map(r=>[...r.children].slice(1).map(td=>[...td.querySelectorAll('.ln')].map(x=>x.textContent)))};
  }
  t.followTrain('');await frame();
  return out;
 },ids);
}
const CLEAR_SECS=[SNAP.defaultSec,30420,40000,50000,12000,70000,20000,86000];
const clearOfIntervals=sec=>Number.isFinite(sec)&&!readJson('uncertainty.json').intervals.some(i=>sec>=i.start-2&&sec<=i.end+2);
// 跟車卡全部班次、全部列＋註記＋狀態列；再核對字幕尾句、預設字幕、跟車字幕與徽章。every＞1 時只取每 every 班的一班（突變對照用）。
async function checkCard(o,{every=1}={}){
 const page=o.page,errs=[],agg=[],E=m=>errs.push(m),lines=[];
 const trains=SNAP.trains.filter((_,i)=>i%every===0),cards=await readCards(page,trains.map(t=>t.id));
 let nRows=0,nPass=0,nStop=0,nHold=0,obsRows=0,obsDash=0;
 const HEADS=['站','表定到／開','重播到／開','來源到／開','差重播−表定','留置'];
 for(const tr of trains){
  const card=cards[tr.id];
  if(!card){E(`${tr.train} 次：跟車卡沒有出現`);continue;}
  if(card.heads.join('|')!==HEADS.join('|'))E(`${tr.train} 次：表頭是「${card.heads.join('|')}」，要是「${HEADS.join('|')}」`);
  if(card.h!==`${tr.train} 次${tr.typeName} ${tr.direction}`)E(`${tr.train} 次：卡片標題是「${card.h}」`);
  if(card.names.length!==tr.stops.length){E(`${tr.train} 次：卡上 ${card.names.length} 列，資料 ${tr.stops.length} 站`);continue;}
  tr.stops.forEach((s,i)=>{
   const x=expectRow(s,tr),J=a=>a.join('／'),cols=[['表定',card.cells[i][0],x.sched],['重播',card.cells[i][1],x.act],['來源',card.cells[i][2],x.src],['差',card.cells[i][3],x.diff],['留置',card.cells[i][4],x.held]];
   nRows++;
   if(card.names[i]!==s.name){E(`${tr.train} 次第 ${i+1} 列是 ${card.names[i]}，資料是 ${s.name}`);return;}
   if(x.passed)nPass++;else if(x.hold)nHold++;else nStop++;
   for(const [col,got,exp] of cols){if(J(got)===J(exp))continue;
    const kind=x.passed?'通過':x.hold?'留置':'停靠';
    if(x.interp&&col==='差')E(`${tr.train} 次 ${s.name}（通過）：差欄是「${J(got)}」，${PREVIEW?'預覽班表':'沒有即時動態紀錄的車'}的通過站要記「—」`);
    else if(x.interp&&col==='來源')E(`${tr.train} 次 ${s.name}（通過）：來源是「${J(got)}」，${PREVIEW?'預覽班表':'沒有即時動態紀錄的車'}的通過站要標內插`);
    else E(`${tr.train} 次 ${s.name}（${kind}）：${col}欄是「${J(got)}」，資料推得「${J(exp)}」`);}
   if(!PREVIEW&&!x.passed&&!x.hold&&s.src==='obs'&&x.has&&s.end!=='origin'){obsRows++;if(card.cells[i][3][0]==='—')obsDash++;}
  });
  const sched=tr.timing==='scheduled';
  if(PREVIEW){if(!(card.note.includes('停靠站照表定')&&card.note.includes('通過站')&&card.note.includes('內插')))E(`${tr.train} 次：註記沒有寫明停靠站照表定、通過站內插：「${card.note.slice(0,60)}」`);}
  else if(sched){if(!(card.note.startsWith('這班車沒有任何即時動態紀錄，整班照時刻表畫')&&card.note.includes('停靠站照表定')&&card.note.includes('通過站')&&card.note.includes('內插')))E(`${tr.train} 次（無即時動態紀錄）：註記沒有寫明整班照表定、停靠站照表定、通過站內插：「${card.note.slice(0,60)}」`);}
  else if(!(card.note.startsWith('時刻依即時動態紀錄推算，到站誤差約半分鐘。')&&['實測＝','內插＝','推定＝','留置＝'].every(k=>card.note.includes(k))))E(`${tr.train} 次：註記沒有寫明實測、內插、推定、留置的意思：「${card.note.slice(0,60)}」`);
  const stTail=sched?(PREVIEW?'；預覽班表，照表定時刻':'；沒有即時動態紀錄，照表定時刻'):'';
  if(sched?!card.st.endsWith(stTail):card.st.includes('照表定時刻'))E(`${tr.train} 次：狀態列「${card.st}」${sched?'要以「'+stTail+'」結尾':'不該寫照表定時刻'}`);
 }
 if(!nPass)E('一列通過站都沒驗到');
 if(!nStop)E('一列停靠站都沒驗到');
 if(!PREVIEW){
  if(every===1&&!obsRows)agg.push('沒有任何「有實測、有表定」的停靠列，差欄驗不了');
  else if(obsRows&&obsDash===obsRows)agg.push(`有實測的停靠列 ${obsRows} 列，差欄整排都是「—」`);
 }
 lines.push(`${trains.length} 班、${nRows} 列（通過 ${nPass}、停靠 ${nStop}、留置 ${nHold}）逐格比對${PREVIEW?'':`；有實測的停靠列 ${obsRows} 列（差欄是「—」的 ${obsDash} 列）`}`);
 // 徽章
 const badge=await page.evaluate(()=>document.getElementById('badge').textContent),badgeExp=PREVIEW?'預覽班表・表定時刻':'實測時刻重建';
 if(badge!==badgeExp)E(`徽章是「${badge}」，${PREVIEW?'預覽班表':'實測重建'}要寫「${badgeExp}」`);
 // 股道待確認時段的字幕尾句：預覽沒有重建，位置依表定時刻；實測位置依重建的時刻
 const U=readJson('uncertainty.json').intervals;
 if(!U.length)lines.push('uncertainty.json 沒有股道待確認的時段，字幕尾句略過');
 else{const iv=U[0],mid=Math.round((iv.start+iv.end)/2);
  await page.evaluate(s=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.jump(s);},mid);await settle(page);
  const cap=await page.evaluate(()=>document.getElementById('caption').textContent);
  if(!cap.includes(PREVIEW?'依表定時刻推演':'依重建的時刻推演'))E(`${hms(mid)} 的字幕「${cap.slice(0,70)}」沒有寫${PREVIEW?'表定':'重建的'}時刻`);
  if(!iv.trainNos.every(n=>cap.includes(n)))E(`${hms(mid)} 的字幕沒有列出 ${iv.trainNos.join('、')}：「${cap.slice(0,70)}」`);
  lines.push(`${hms(mid)} 字幕：${cap.slice(0,40)}`);}
 // 預設字幕與跟車字幕（挑一個離股道待確認時段夠遠的整秒）
 const sec0=CLEAR_SECS.find(clearOfIntervals);
 if(sec0===undefined)E('找不到離股道待確認時段夠遠的整秒，預設字幕驗不了');
 else{
  await page.evaluate(s=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.jump(s);},sec0);await settle(page);
  const cap=await page.evaluate(()=>document.getElementById('caption').textContent),exp=PREVIEW?'預覽版：依 10/15 發布的預覽班表、照表定時刻行駛；實際到離站紀錄之後補上。':`封存 ${SNAP.trains.length} 班 · 時刻依即時動態紀錄重建，非 GPS 軌跡；區間車與莒光號的編組為推估。`;
  if(cap!==exp)E(`${hms(sec0)} 的預設字幕是「${cap.slice(0,80)}」，要寫「${exp.slice(0,80)}」`);
  lines.push(`${hms(sec0)} 預設字幕對`);
  for(const tr of [SNAP.trains.find(t=>t.timing==='scheduled'),SNAP.trains.find(t=>t.timing!=='scheduled')].filter(Boolean)){
   const secs=[];for(const sp of tr.spans)for(const f of [3,Math.floor(sp.s.length/2)])secs.push(sp.start+f);
   const sec=secs.find(s=>clearOfIntervals(s)&&presentAt(tr.id,s));
   if(sec===undefined){E(`${tr.train} 次找不到離股道待確認時段夠遠、又在畫面內的整秒，跟車字幕驗不了`);continue;}
   await page.evaluate(([id,s])=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.jump(s);t.followTrain(id);},[tr.id,sec]);await settle(page);
   const fcap=await page.evaluate(()=>document.getElementById('caption').textContent),
    suffix=tr.timing==='scheduled'?(PREVIEW?'預覽班表，照表定時刻':'無即時動態紀錄，照表定時刻'):'時刻依即時動態紀錄重建',fexp=[tr.train+' 次',tr.formation.caption,suffix].join(' · ');
   if(fcap!==fexp)E(`${tr.train} 次的跟車字幕是「${fcap}」，要寫「${fexp}」`);
   lines.push(`${tr.train} 次跟車字幕對`);}
 }
 await page.evaluate(()=>window.tainanMemory.followTrain(''));
 const all=[...agg,...errs];
 return {pass:!all.length,detail:all.length?`${all.length} 項不符：${all.slice(0,4).join('；')}`:lines.join('｜')};
}
// ───────────────────────── 檢查：股道待確認時段的字幕與車次標記 ─────────────────────────
// 同一時段裡此刻至少兩班都在畫面上（snapshot 的 spans 涵蓋該秒）才藏成車次標記並列進字幕；只有一班在場（另一班還沒進場或已離場）時
// 照常畫出、字幕不列。每段時段取起點、中間、終點三個整秒；在場與否從磁碟上的 snapshot.json 算，隱藏旗標、active 與字幕都對照它。
const TRAIN_BY_ID=new Map(SNAP.trains.map(t=>[t.id,t]));
const presentAt=(id,sec)=>{const t=TRAIN_BY_ID.get(id);return !!t&&t.spans.some(sp=>sec>=sp.start&&sec<=sp.start+sp.s.length-1);};
function expectHidden(sec){
 const byReason={'single-line-unresolved':[],'track-overlap':[]},all=new Set();
 for(const iv of readJson('uncertainty.json').intervals){
  if(sec<iv.start||sec>iv.end)continue;
  const here=iv.trains.filter(id=>presentAt(id,sec));
  if(here.length<2)continue;
  for(const id of here){all.add(id);(byReason[iv.reason||'track-overlap']||byReason['track-overlap']).push(TRAIN_BY_ID.get(id).train);}}
 return {all,byReason};
}
const intervalSecs=()=>readJson('uncertainty.json').intervals.flatMap(iv=>[['起點',iv.start],['中間',Math.floor((iv.start+iv.end)/2)],['終點',iv.end]].map(([tag,sec])=>({iv,tag,sec})));
const INTERVAL_EDGE_SINGLE=intervalSecs().some(({iv,sec})=>iv.trains.filter(id=>presentAt(id,sec)).length===1);
async function checkIntervals(o){
 const page=o.page,errs=[],E=m=>errs.push(m),cases=intervalSecs();
 if(!cases.length)return {pass:true,detail:'uncertainty.json 沒有股道待確認的時段，這項略過'};
 let single=0,hiddenCases=0;
 for(const {iv,tag,sec} of cases){
  const exp=expectHidden(sec),where=`${hms(sec)}（${iv.trainNos.join('、')} 的${tag}）`;
  if(iv.trains.filter(id=>presentAt(id,sec)).length===1)single++;
  if(exp.all.size)hiddenCases++;
  await page.evaluate(s=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');t.jump(s);},sec);await settle(page);
  const got=await page.evaluate(ids=>{const t=window.tainanMemory;return {cap:document.getElementById('caption').textContent,vis:Object.fromEntries(ids.map(id=>[id,t.models.get(id).group.visible])),pend:t.active.filter(a=>a.trackUncertain).map(a=>a.id)};},iv.trains);
  if([...got.pend].sort().join(',')!==[...exp.all].sort().join(','))E(`${where} 被藏的班次是「${got.pend.join('、')||'無'}」，在場且被藏的是「${[...exp.all].join('、')||'無'}」`);
  for(const id of iv.trains){const want=presentAt(id,sec)&&!exp.all.has(id);if(got.vis[id]!==want)E(`${where} ${id.split(':')[1]} 次的車身${got.vis[id]?'畫出':'藏起來'}了，應該${want?'畫出':'藏起來'}（${presentAt(id,sec)?'在場':'不在場'}）`);}
  const capNos=label=>{const m=got.cap.match(new RegExp(label+'：(.+?) 次暫以'));return m?m[1].split('、'):[];};
  for(const [label,key] of [['股道安排待確認','track-overlap'],['封鎖初期股道安排不明','single-line-unresolved']]){
   const a=capNos(label).sort().join('、'),b=exp.byReason[key].slice().sort().join('、');
   if(a!==b)E(`${where} 字幕「${label}」列的是「${a||'無'}」，在場且被藏的是「${b||'無'}」`);}
  if(!exp.all.size&&got.cap.includes('股道安排'))E(`${where} 沒有班次被藏，字幕卻還寫股道安排：「${got.cap.slice(0,60)}」`);
 }
 return {pass:!errs.length,detail:errs.length?`${errs.length} 項不符：${errs.slice(0,4).join('；')}`:`${cases.length} 個整秒（${new Set(cases.map(c=>c.iv)).size} 段 × 起點／中間／終點）：其中 ${single} 個整秒只有一班在場、沒藏它也沒列進字幕，${hiddenCases} 個整秒兩班都在場、車身藏起來且字幕列出`};
}
// ───────────────────────── 檢查：關於視窗（預覽／實測各顯示自己的段落與來源行） ─────────────────────────
// 期望全從磁碟上的 snapshot.json 推：模式（有沒有 preview）、沒有即時動態紀錄的車次（timingSource.scheduledTrains）、哪幾站有實測。
// 實測段說「X與Y兩站不回報」：X、Y 在快照裡所有非整班表定的車都沒有 obs 到站，其餘站至少一筆。
const normSta=n=>n.replace('台','臺');
// 同一車次在快照裡不只一班（跨午夜的前一營運日尾段與當天）時，關於視窗要加註營運日「（M/D 營運日）」，只列車次會把有紀錄的那一班也說成沒有。
const SCHED_NOS=[...new Set(SNAP.timingSource?.scheduledTrains||[])].map(String).map(id=>({date:id.slice(0,10),no:id.slice(11)}))
 .sort((a,b)=>Number(a.no)-Number(b.no)||a.date.localeCompare(b.date))
 .map(({date,no})=>SNAP.trains.filter(t=>t.train===no).length>1?`${no}（${Number(date.slice(5,7))}/${Number(date.slice(8,10))} 營運日）`:no);
const SCHED_ONLY_PASS=!PREVIEW&&SNAP.trains.some(t=>t.timing==='scheduled'&&t.stops.some(s=>s.stop===false&&!(Number(s.holdSec)>=90)&&Number.isFinite(s.schedArrSec)));
// 有實測的車的通過列：沒有這種列時（例如實測檔缺當天、只剩前一營運日尾段的車有紀錄），「實測重建的通過站也照預覽處理」的突變改不到任何一列，對照不適用。
const OBS_PASS=!PREVIEW&&SNAP.trains.some(t=>t.timing==='observed'&&t.stops.some(s=>s.stop===false&&!(Number(s.holdSec)>=90)&&Number.isFinite(s.schedArrSec)));
function obsCountsByStation(){
 const c=new Map();for(const t of SNAP.trains)for(const s of t.stops)c.set(normSta(s.name),0);   // 站名單取所有車停靠表上出現的站（含場景外的鄰站永康、仁德）
 for(const t of SNAP.trains){if(t.timing==='scheduled')continue;for(const s of t.stops)if(s.src==='obs')c.set(normSta(s.name),(c.get(normSta(s.name))||0)+1);}
 return c;
}
async function checkAbout(o,{shot=null}={}){
 const page=o.page,errs=[],E=m=>errs.push(m),lines=[];
 await page.evaluate(()=>{const t=window.tainanMemory;t.state.playing=false;t.followTrain('');});
 const btn=await page.evaluate(()=>document.getElementById('about').getClientRects().length?'#about':'#aboutNav');
 await page.click(btn,{timeout:4000});await page.waitForFunction(()=>document.getElementById('details').open,null,{timeout:4000});
 const d=await page.evaluate(()=>{
  const dlg=document.getElementById('details'),info=e=>({show:e.dataset.show||'',fill:e.dataset.fill||'',hidden:e.hidden,shown:e.getClientRects().length>0,text:e.textContent});
  return {badge:document.getElementById('badge').textContent,text:dlg.innerText,modes:[...dlg.querySelectorAll('[data-show]')].map(info),fills:[...dlg.querySelectorAll('[data-fill="scheduled"]')].map(info),
   paras:[...dlg.querySelectorAll('.detail-body > p')].map(info)};});
 const T=d.text;
 // 兩種模式的段落都要在頁面裡，而且只有目前模式的看得到
 for(const m of ['preview','observed'])if(!d.modes.some(x=>x.show===m))E(`關於視窗沒有 data-show="${m}" 的段落`);
 for(const x of d.modes)if(x.shown!==(x.show===MODE))E(`data-show="${x.show}" 的段落「${x.text.slice(0,24)}…」${x.shown?'看得到':'看不到'}，${MODE==='preview'?'預覽':'實測'}模式下應該${x.show===MODE?'看得到':'看不到'}`);
 if(T.split('時刻與站點來源：').length!==2)E(`關於視窗要恰好一句「時刻與站點來源」，實有 ${T.split('時刻與站點來源：').length-1} 句`);
 if(!T.includes('封存資料、渲染程式與模型獨立保存'))E('關於視窗少了結尾「封存資料、渲染程式與模型獨立保存」');
 if(PREVIEW){
  if(!T.includes('目前的時刻是預覽版'))E('預覽模式的關於視窗沒有預覽說明段');
  if(!T.includes('時刻與站點來源：臺鐵（預覽班表取自臺鐵公開的逐日班表檔）'))E('預覽模式的來源行不是「臺鐵（預覽班表取自臺鐵公開的逐日班表檔）」');
  for(const w of ['TDX','不是 GPS 軌跡','不回報'])if(T.includes(w))E(`預覽模式的關於視窗不該出現「${w}」`);
  lines.push('預覽段與預覽來源行');
 }else{
  for(const w of ['依交通部 TDX 的臺鐵即時動態逐站紀錄推算','不是 GPS 軌跡','到站時間的誤差約半分鐘','標「推定」','也一樣內插'])if(!T.includes(w))E(`實測模式的關於視窗少了「${w}」`);
  if(!T.includes('時刻與站點來源：交通部 TDX／臺鐵（班表取自臺鐵公開的逐日班表檔）'))E('實測模式的來源行不是「交通部 TDX／臺鐵（班表取自臺鐵公開的逐日班表檔）」');
  if(T.includes('預覽'))E('實測模式的關於視窗還寫著「預覽」');
  // 沒有即時動態紀錄的車次＝ timingSource.scheduledTrains（再與 trains[].timing 互核）；一班都沒有就整句不出現
  const byTiming=new Set(SNAP.trains.filter(t=>t.timing==='scheduled').map(t=>t.serviceDate+':'+t.train)),fromList=new Set((SNAP.timingSource?.scheduledTrains||[]).map(String));
  if([...byTiming].sort().join(',')!==[...fromList].sort().join(','))E(`timingSource.scheduledTrains（${[...fromList].length} 班）與 trains[].timing 為 scheduled 的班次（${byTiming.size} 班）不同`);
  const f=d.fills[0];
  if(!f)E('實測段少了列出無即時動態紀錄車次的位置（data-fill="scheduled"）');
  else if(!SCHED_NOS.length){if(f.shown||f.text)E(`一班都沒有無即時動態紀錄的車次，該句卻出現：「${f.text.slice(0,40)}」`);lines.push('沒有無即時動態紀錄的車次，整句不出現');}
  else{const m=f.text.match(/^(.+?) 次沒有任何即時動態紀錄，只能照時刻表畫，標籤會註明「無即時動態紀錄」。$/),got=m?m[1].split('、'):[];
   if(!f.shown||!m)E(`無即時動態紀錄的車次那句不對或看不到：「${f.text.slice(0,60)}」`);
   else if(got.join(',')!==SCHED_NOS.join(','))E(`關於視窗列的車次是「${got.join('、')}」，timingSource.scheduledTrains 是「${SCHED_NOS.join('、')}」`);
   else lines.push(`無即時動態紀錄的車次 ${SCHED_NOS.length} 班（${SCHED_NOS.slice(0,6).join('、')}${SCHED_NOS.length>6?'…':''}）與 scheduledTrains 一致`);}
  // 「X與Y兩站不回報」對資料
  const m=T.match(/([^\s、，。；：]{2,6})與([^\s、，。；：]{2,6})兩站不回報/);
  if(!m)E('實測段沒有「X與Y兩站不回報」那句');
  else{const named=[m[1],m[2]].map(normSta),cnt=obsCountsByStation(),rest=[...cnt.keys()].filter(k=>!named.includes(k));
   for(const n of named){if(!cnt.has(n))E(`「${n}」不在快照的站名單裡`);else if(cnt.get(n)>0)E(`說「${n}」不回報，快照裡它卻有 ${cnt.get(n)} 筆實測到站`);}
   for(const k of rest)if(!cnt.get(k))E(`快照裡「${k}」一筆實測到站都沒有，關於視窗卻沒說它不回報`);
   if(!rest.length)E('快照裡除了不回報的站，沒有別的站可對照');
   lines.push(`不回報：${named.join('、')}（實測到站 ${named.map(n=>cnt.get(n)).join('、')} 筆）；其餘 ${rest.map(k=>k+' '+cnt.get(k)).join('、')}`);}
 }
 const badgeExp=PREVIEW?'預覽班表・表定時刻':'實測時刻重建';
 if(d.badge!==badgeExp)E(`徽章是「${d.badge}」，要寫「${badgeExp}」`);
 if(shot){await page.setViewportSize({width:1000,height:3200});await settle(page);await page.screenshot({path:shot});await page.setViewportSize({width:1280,height:800});lines.push('截圖 '+path.basename(shot));}
 await page.evaluate(()=>document.getElementById('details').close());
 return {pass:!errs.length,detail:errs.length?`${errs.length} 項不符：${errs.slice(0,4).join('；')}`:`${MODE==='preview'?'預覽':'實測'}模式：`+lines.join('｜')};
}
// 過寬對照用：版面掃描之外，另外記下舊斷言（scrollWidth＞innerWidth）當時是紅還是綠，證明新斷言抓得到舊斷言看不到的溢出。
async function wideProbe(o,fc){const r=await layoutQuick(o,fc);const old=await o.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth),w=await o.page.evaluate(()=>[innerWidth,window.visualViewport?.scale]);
 return {pass:r.pass,detail:`舊斷言（scrollWidth＞innerWidth）${old?'紅':'綠'}；innerWidth＝${w[0]}、scale＝${w[1]?.toFixed?.(3)}｜${r.detail}`};}

// ───────────────────────── 突變對照 ─────────────────────────
const REP=(from,to)=>[[from,to]];
const M={
 noRouteZ:{json:{'snapshot.json':s=>{for(const r of s.routes)delete r.z;}}},
 noRailZ:{json:{'snapshot.json':s=>{for(const r of s.rails)delete r.z;}}},
 noAnyZ:{json:{'snapshot.json':s=>{for(const r of s.routes)delete r.z;for(const r of s.rails)delete r.z;}}},
 allFront:{json:{'underground/model.json':m=>{for(const g of m.lods.near.drawGroups)delete g.doubleSided;}}},
 troughDouble:{json:{'underground/model.json':m=>{m.lods.near.drawGroups.find(g=>g.name==='ug_trough').doubleSided=true;}}},
 shellOpaque:{json:{'underground/model.json':m=>{delete m.lods.near.drawGroups.find(g=>g.name==='ug_shell').opacity;}}},
 noCutouts:{json:{'underground/model.json':m=>{m.cutouts=[];}}},
 shiftStop:{json:{'snapshot.json':s=>{for(const t of s.trains)for(const sp of t.spans)sp.s=sp.s.map(v=>v+5);}}},
 pitchFlip:{text:{'replay.js':REP("rotation.set(0,-pose.pitch,pose.angle,'ZYX')","rotation.set(0,pose.pitch,pose.angle,'ZYX')")}},
 pitchZero:{text:{'replay.js':REP("rotation.set(0,-pose.pitch,pose.angle,'ZYX')","rotation.set(0,0,pose.angle,'ZYX')")}},
 labelZ:{text:{'replay.js':REP("new THREE.Vector3(...xy,7+(l.z||0))","new THREE.Vector3(...xy,7)")}},
 followZ:{text:{'replay.js':REP("target.set(...world(p.coordinate),p.z)","target.set(...world(p.coordinate),0)")}},
 panZ:{text:{'replay.js':REP("target.addScaledVector(up,dy/(h*h));target.z=z0;","target.addScaledVector(up,dy/(h*h));")}},
 veilColor:{text:{'replay.js':REP("new THREE.MeshBasicMaterial({color:BG,transparent:true,opacity:VEIL_OPACITY","new THREE.MeshBasicMaterial({color:'#dd3333',transparent:true,opacity:VEIL_OPACITY")}},
 orderSwap:{text:{'replay.js':REP("UG_ORDER={ug_shell:1,ug_b1:2,veil:3,above:4}","UG_ORDER={ug_shell:3,ug_b1:2,veil:1,above:4}")}},
 // 面紗抬到路面柏油的高度（roads.js 的 asphaltZ）：製造一個真的共面的對手；有沒有 polygonOffset 是唯一差別。
 veilAtAsphalt:{text:{'replay.js':[["veil.name='ground-veil';","veil.name='ground-veil';veil.position.z=.015;"],["polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:8","polygonOffset:false,polygonOffsetFactor:2,polygonOffsetUnits:8"]]}},
 veilAtAsphaltOffsetOn:{text:{'replay.js':REP("veil.name='ground-veil';","veil.name='ground-veil';veil.position.z=.015;")}},
 roadsAllRails:{text:{'roads.js':REP("const onGround=p=>!(p[2]<0);","const onGround=p=>true;")}},
 nextNotPlatform:{text:{'replay.js':REP("jump(at(next)-LEAD);centerPlatform();view();","jump(at(next)-LEAD);view();")}},
 // 「下一班到臺南」把臺南始發的車也算進去（回到只過濾「有停臺南」的舊寫法）
 nextIncludesOrigin:{text:{'replay.js':REP("toTainan=byArrival.filter(tr=>tainanStop(tr)&&tainanStop(tr).end!=='origin')","toTainan=byArrival.filter(tr=>tainanStop(tr))")}},
 // 「下一班到臺南」把跨午夜才到站的車也算進去：當天最後一班之後按下去會停在 23:59:59
 nextBeyondDay:{text:{'replay.js':REP(".filter(tr=>tainanStop(tr).arrSec<=86399)","")}},
 // 跟車卡：預覽班表的通過站照舊算差、來源照資料標表定；字幕尾句不分預覽
 cardPassDiff:{text:{'replay.js':REP("prePass?'—':DIFF(s.arrSec-s.schedArrSec)","DIFF(s.arrSec-s.schedArrSec)")}},
 cardPassSrc:{text:{'replay.js':REP("prePass?'interp':s.src","s.src")}},
 tailPreview:{text:{'replay.js':REP("(data.preview?'表定':'重建的')","'重建的'")}},
 // 找不到下一班時不回到當天第一班，改取最後一班
 departNoWrap:{text:{'replay.js':REP("at(tr)>state.sec+LEAD)||list[0];","at(tr)>state.sec+LEAD)||list[list.length-1];")}},
 departUnwired:{text:{'replay.js':REP("$('depart').onclick=()=>jumpNext(fromTainan,tr=>tainanStop(tr).depSec);","$('depart').onclick=()=>{};")}},
 departHidden:{text:{'replay.css':REP("[hidden]{display:none!important}","[hidden]{display:none!important}#depart{display:none!important}")}},
 // 塞一個比視窗寬 1.5 倍的元素：Chromium 的行動模擬會把整頁縮小，innerWidth 跟著變大
 wideCss:{text:{'replay.css':REP("[hidden]{display:none!important}","[hidden]{display:none!important}#caption{display:block!important;width:150vw!important;white-space:nowrap!important}")}},
 // viewport meta 把版面寬度撐到 640：不靠內容寬度，直接讓 innerWidth≠設定的視窗寬（兩個引擎都會）
 metaWide:{text:{'index.html':REP('width=device-width,initial-scale=1,viewport-fit=cover','width=640,initial-scale=1,viewport-fit=cover')}},
 overlapCss:{text:{'replay.css':REP("[hidden]{display:none!important}","[hidden]{display:none!important}#zoomin,#zoomout{position:fixed!important;left:8px!important;top:60px!important}")}},
 hideRotate:{text:{'replay.css':REP("[hidden]{display:none!important}","[hidden]{display:none!important}#rotate{display:none!important}")}},
 notFound:{status:{'underground/near.mesh.bin.gz':404}},
 // 跟車卡（兩種模式都要紅）：通過列的重播時刻改成表定；停靠列的差欄全改成「—」
 cardPassActSched:{text:{'replay.js':REP("lines('td','通過',T(s.arrSec))","lines('td','通過',T(s.schedArrSec))")}},
 cardStopDiffDash:{text:{'replay.js':REP("lines('td',...ad(DIFF(s.arrSec-s.schedArrSec),DIFF(s.depSec-s.schedDepSec)))","lines('td',...ad('—','—'))")}},
 // 實測重建：通過站也照預覽的寫法（差記「—」、來源標內插）；字幕尾句、徽章照預覽
 cardObservedAsPreview:{text:{'replay.js':REP("prePass=(!!data.preview||tr.timing==='scheduled')&&passed","prePass=passed")}},
 // 實測重建裡沒有紀錄的車：通過站照舊算差、來源標表定（回到只看 snapshot.preview 的舊寫法）
 cardSchedOnlyOldRule:{text:{'replay.js':REP("prePass=(!!data.preview||tr.timing==='scheduled')&&passed","prePass=!!data.preview&&passed")}},
 tailObservedAsPreview:{text:{'replay.js':REP("(data.preview?'表定':'重建的')","'表定'")}},
 badgeObservedAsPreview:{text:{'replay.js':REP("data.preview?'預覽班表・表定時刻':'實測時刻重建'","'預覽班表・表定時刻'")}},
 badgePreviewAsObserved:{text:{'replay.js':REP("data.preview?'預覽班表・表定時刻':'實測時刻重建'","'實測時刻重建'")}},
 // 股道待確認：回到舊寫法（時段裡有一班在場就把整個時段的車都藏起來、列進字幕）
 uncertainOldRule:{text:{'replay.js':REP("if(here.length>=2)for(const id of here)uncertain.add(id);","for(const id of iv.trains)uncertain.add(id);")}},
 // 關於視窗：段落顯示的模式顛倒；實測段的車次清單少一班；來源行寫成另一種模式的；「不回報」的站名換成有實測的站
 aboutInverted:{text:{'replay.js':REP("e.hidden=e.dataset.show!==MODE","e.hidden=e.dataset.show===MODE")}},
 aboutSchedDrop:{text:{'replay.js':REP("nos.join('、')+' 次沒有任何","nos.slice(1).join('、')+' 次沒有任何")}},
 // 同一車次有兩班時不加註營運日（回到只列車次的舊寫法）
 aboutSchedNoDate:{text:{'replay.js':REP("?no+'（'+Number(d[1])+'/'+Number(d[2])+' 營運日）':no","?no:no")}},
 aboutSourceObservedAsPreview:{text:{'index.html':REP('交通部 TDX／臺鐵（班表取自','臺鐵（預覽班表取自')}},
 aboutSourcePreviewAsObserved:{text:{'index.html':REP('時刻與站點來源：臺鐵（預覽班表取自臺鐵公開的逐日班表檔）','時刻與站點來源：交通部 TDX／臺鐵（班表取自臺鐵公開的逐日班表檔）')}},
 aboutWrongStations:{text:{'index.html':REP('大橋與仁德兩站不回報','大橋與臺南兩站不回報')}},
};
async function runControl(browser,engine,c){
 const m=buildMutation(c.mutation),o=await openPage(browser,{...(c.open||{}),mutation:m,readyTimeout:c.readyTimeout||90000});
 let red,green;
 try{red=await c.run(o);}catch(e){red={pass:false,detail:'例外：'+e.message.split('\n')[0]};}
 await o.context.unrouteAll({behavior:'wait'});await reloadPage(o);
 try{green=await c.run(o);}catch(e){green={pass:false,detail:'例外：'+e.message.split('\n')[0]};}
 await o.context.close();
 // keepGreen：這一項是「改了也不該紅」的對照（證明某個防線真的在擋），所以突變後要綠。
 const want=c.expect&&typeof c.expect==='object'?c.expect[engine]:c.expect;
 const redOk=c.keepGreen?red.pass:!red.pass&&(!want||red.detail.includes(want)),greenOk=green.pass;
 controlsLog.push({engine,name:c.name,red:!red.pass,keepGreen:!!c.keepGreen,reason:red.detail.slice(0,200),restoredGreen:green.pass});
 record(engine,'對照',c.name,redOk&&greenOk,`突變後${c.keepGreen?(red.pass?'仍綠：'+red.detail.slice(0,150):'變紅了（本來該維持綠）：'+red.detail.slice(0,150)):red.pass?'沒有變紅（'+red.detail.slice(0,100)+'）':redOk?'變紅：'+red.detail.slice(0,150):'紅了但不是預期原因（要含「'+want+'」）：'+red.detail.slice(0,150)}｜還原後${green.pass?'綠':'仍紅：'+green.detail.slice(0,120)}`);
}

// ───────────────────────── 主流程 ─────────────────────────
const CHANNEL=process.env.CHROMIUM_CHANNEL||'chrome';
const IDS_ALL=pickTrains(30,true);
const fc=followCase();
let exitCode=1;
try{
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
  const browser=await type.launch(engine==='chromium'?{channel:CHANNEL,headless:true}:{headless:true});
  const run=async(section,name,fn)=>{if(!want(section))return null;let r;try{r=await fn();}catch(e){r={pass:false,detail:'例外：'+(e.stack||e.message).split('\n').slice(0,3).join(' / ')};}record(engine,section,name,r.pass,r.detail);return r;};
  const base=await openPage(browser,{viewport:{width:1280,height:800}});
  await run('health','載入乾淨：console error／pageerror 0、全部請求 200 且都在本站、地下檔案都讀到',()=>checkHealth(base));
  const mat=await run('materials','地下結構每個 drawGroup 的材質（side／opacity／transparent／depthWrite／範圍／顏色）與 model.json 一致；ug_trough 是 FrontSide',()=>checkMaterials(base));
  if(mat?.table)for(const l of mat.table)console.log('  '+l);
  await run('order','實際繪製順序：不透明在先；半透明依 殼 → B1 → 面紗 → 站房外罩',()=>checkOrder(base));
  await run('veil','地面面紗：z＝0、蓋住 bounds、半透明不寫深度、挖掉 cutouts、不透明度可在執行時改',()=>checkVeil(base));
  await run('veil','面紗像素：空地上看不出來、環內挖空、環外有蓋',()=>checkVeilPixels(base));
  await run('rails','鋼軌與道碴的逐頂點高程等於 rails[i].z＋0.13／＋0.05',()=>checkRails(base));
  let roadsBase=null,roadsCf=null;
  if(want('roads')){roadsBase=await roadAreas(base.page);const cf=await openPage(browser,{mutation:buildMutation(M.noRailZ)});roadsCf=await roadAreas(cf.page);await cf.context.close();
   await run('roads','地下股道不讓地面路面（人行道、路緣、標線）讓位',async()=>checkRoads(roadsBase,roadsCf));}
  let elevRows=null;
  const el=await run('elevation',`車廂高程與俯仰：${IDS_ALL.length} 班車 × ${TARGETS.length} 個里程，離剖面 z(d)＋0.16 ≤${Z_TOL} m、俯仰符合坡度（±${PITCH_TOL} rad）、南北向各區段都量到`,()=>checkElevation(base,{ids:IDS_ALL}));
  elevRows=el?.rows||null;
  await run('stop','臺南站停靠：整列中心在 centerD ±1 m、兩端在月台範圍內、車廂在月台軌道面',()=>checkStop(base,{ids:SNAP.trains.map(t=>t.id)}));
  let follow=null;
  if(want('labels')||want('camera')){if(!elevRows){const r=await sampleElevation(base.page,{ids:IDS_ALL});elevRows=r.out;}
   follow=await sampleFollow(base.page,pickFollowCases(elevRows));
   await run('labels','列車標籤依 (x,y,7＋軌道面高程) 投影到畫面',async()=>checkLabels(follow));
   await run('camera','跟車時鏡頭目標的高度＝列車軌道面高度',async()=>checkFollowZ(follow));
   await run('camera','平移不改鏡頭目標的高度，且該水平面上的點跟著游標',()=>checkPan(base));}
  let depthRes=null;
  if(want('depth')){
   const secOf=(dir,tg)=>elevRows?.find(r=>r.dir===dir&&r.target===tg)?.sec??30420,secS=secOf('北上',450),secN=secOf('北上',7450);
   depthRes=await run('depth','深度衝突：地下結構各視角沿視線微移後影像幾乎不變（變動像素 ≤ 畫面的 '+DEPTH_MAX_FRAC*100+'%）',()=>checkDepth(base,{secS,secN}));
  }
  await run('jumps','「下一班到臺南」不算臺南始發的車、「臺南發車」只算始發車；連按、繞回當天第一班、跟車中按都對（期望值從 snapshot 算）',()=>checkJumps(base,fc));
  await run('card',`跟車卡（${MODE==='preview'?'預覽班表':'實測重建'}）：全部班次、每一列的表定／重播／來源／差／留置逐格對 snapshot；註記、狀態列、徽章、字幕尾句、預設與跟車字幕`,()=>checkCard(base));
 await run('uncertain','股道待確認時段：每段起點、中間、終點，字幕與車身標記＝此刻在場且被藏的班次（一班在場不藏）',()=>checkIntervals(base));
 await run('about',`關於視窗（${MODE==='preview'?'預覽':'實測'}模式）：只看得到自己模式的段落與來源行；${MODE==='preview'?'':'無即時動態紀錄車次＝ scheduledTrains、「不回報」的站對資料；'}存截圖`,()=>checkAbout(base,{shot:path.join(path.dirname(RESULTS),`about-${MODE}-${engine}.png`)}));
  // 還原頁面狀態後，整輪沒有 console error／pageerror
  if(want('health')){const late=base.errors.length;record(engine,'health','整輪（含所有取樣、拖曳、渲染）console error／pageerror 仍為 0',late===0,late?base.errors[0].slice(0,160):'');}
  await base.context.close();
  // 突變對照
  if(WITH_CONTROLS){
   const small={ids:pickTrains(14,false),full:true,minCov:12},smallStop={ids:SNAP.trains.filter((_,i)=>i%6===0).map(t=>t.id),minN:20};
   const ctl=[
    {sec:'health',name:'載入：地下網格 404 → 載入檢查變紅',mutation:M.notFound,readyTimeout:25000,run:o=>checkHealth(o),expect:'ready=false'},
    {sec:'materials',name:'材質：所有 drawGroup 都當單面 → 變紅',mutation:M.allFront,run:o=>checkMaterials(o),expect:'ug_shell.side'},
    {sec:'materials',name:'材質：ug_trough 改成雙面 → 變紅',mutation:M.troughDouble,run:o=>checkMaterials(o),expect:'ug_trough'},
    {sec:'materials',name:'材質：ug_shell 改成不透明 → 變紅',mutation:M.shellOpaque,run:o=>checkMaterials(o),expect:'ug_shell.transparent'},
    {sec:'order',name:'畫序：殼與面紗對調 → 變紅',mutation:M.orderSwap,run:o=>checkOrder(o)},
    {sec:'veil',name:'面紗幾何：拿掉 cutouts（不挖空）→ 變紅',mutation:M.noCutouts,run:o=>checkVeil(o),expect:'挖空'},
    {sec:'veil',name:'面紗像素：拿掉 cutouts（不挖空）→ 變紅',mutation:M.noCutouts,run:o=>checkVeilPixels(o),expect:'挖空失敗'},
    {sec:'veil',name:'面紗像素：面紗改成紅色（不是背景色）→ 空地檢查變紅',mutation:M.veilColor,run:o=>checkVeilPixels(o),expect:'空地和背景差'},
    {sec:'rails',name:'鋼軌／道碴：rails 的 z 全拿掉 → 變紅',mutation:M.noRailZ,run:o=>checkRails(o)},
    {sec:'roads',name:'路面讓位：地下股道也當地面 → 變紅',mutation:M.roadsAllRails,run:async o=>checkRoads(await roadAreas(o.page),roadsCf),expect:'沒有任何變化'},
    {sec:'elevation',name:'高程：routes 的 z 全拿掉（列車全在地面）→ 變紅',mutation:M.noRouteZ,run:o=>checkElevation(o,small),expect:'z 差'},
    {sec:'elevation',name:'俯仰：方向反過來 → 變紅',mutation:M.pitchFlip,run:o=>checkElevation(o,small),expect:'俯仰'},
    {sec:'elevation',name:'俯仰：不傾斜 → 變紅',mutation:M.pitchZero,run:o=>checkElevation(o,small),expect:'俯仰'},
    {sec:'stop',name:'停靠位置：整批列車沿軌道多走 5 m → 變紅',mutation:M.shiftStop,run:o=>checkStop(o,smallStop),expect:'中心離 centerD'},
    {sec:'labels',name:'標籤：投影時忽略 z → 變紅',mutation:M.labelZ,run:async o=>checkLabels(await sampleFollow(o.page,fcases)),expect:'標籤在'},
    {sec:'camera',name:'跟車：鏡頭目標 z 固定 0 → 變紅',mutation:M.followZ,run:async o=>checkFollowZ(await sampleFollow(o.page,fcases)),expect:'鏡頭目標 z'},
    {sec:'camera',name:'平移：平移後把目標 z 重設回原值的那行拿掉 → 變紅',mutation:M.panZ,run:o=>checkPan(o),expect:'目標 z'},
    {sec:'depth',name:'深度衝突：面紗抬到柏油高度且拿掉 polygonOffset（真的共面）→ 變紅',mutation:M.veilAtAsphalt,run:async o=>checkDepth(o,{secS:30420,secN:30420}),expect:'沿視線微移'},
    {sec:'depth',name:'深度衝突：面紗抬到柏油高度但保留 polygonOffset → 仍綠（偏移真的在擋）',mutation:M.veilAtAsphaltOffsetOn,keepGreen:true,run:async o=>checkDepth(o,{secS:30420,secN:30420})},
    {sec:'layout',name:'版面：兩顆視角鈕疊在一起 → 版面檢查變紅',mutation:M.overlapCss,open:{viewport:{width:390,height:844},mobile:true},run:o=>layoutQuick(o,fc),expect:'相交'},
    {sec:'layout',name:'版面：旋轉鈕被藏起來 → 版面掃描的覆蓋斷言變紅',mutation:M.hideRotate,open:{viewport:{width:390,height:844},mobile:true},run:o=>layoutQuick(o,fc),expect:'沒有掃到控件 rotate'},
    {sec:'layout',name:'觸控：「下一班到臺南」不再移到月台 → 觸控檢查變紅',mutation:M.nextNotPlatform,open:{viewport:{width:390,height:844},mobile:true},run:o=>tapQuick(o,fc),expect:'下一班到臺南'},
    {sec:'layout',name:'版面：「臺南發車」鈕被藏起來 → 版面掃描的覆蓋斷言變紅',mutation:M.departHidden,open:{viewport:{width:390,height:844},mobile:true},run:o=>layoutQuick(o,fc),expect:'沒有掃到控件 depart'},
    {sec:'layout',name:'版面：有元素比視窗寬 1.5 倍 → 版面檢查變紅（Chromium 縮小整頁，由 innerWidth 斷言抓到；WebKit 不縮小，由水平捲動抓到）',mutation:M.wideCss,open:{viewport:{width:390,height:844},mobile:true},run:o=>wideProbe(o,fc),expect:{chromium:'不等於設定的視窗寬',webkit:'水平捲動'}},
    {sec:'layout',name:'版面：viewport meta 把版面寬撐到 640 → innerWidth 不等於設定寬的斷言變紅',mutation:M.metaWide,open:{viewport:{width:390,height:844},mobile:true},run:o=>wideProbe(o,fc),expect:'不等於設定的視窗寬'},
    {sec:'jumps',name:'跳轉：「下一班到臺南」把臺南始發的車也算進去 → 變紅',mutation:M.nextIncludesOrigin,run:o=>checkJumps(o,fc),expect:'臺南始發'},
    {sec:'jumps',name:'跳轉：「臺南發車」找不到下一班時不繞回當天第一班 → 變紅',mutation:M.departNoWrap,run:o=>checkJumps(o,fc),expect:'沒有繞回當天第一班'},
    {sec:'jumps',name:'跳轉：「下一班到臺南」把跨午夜才到站的車算進去 → 變紅',mutation:M.nextBeyondDay,run:o=>checkJumps(o,fc),expect:'「下一班到臺南」沒有繞回當天第一班'},
    {sec:'card',mode:'preview',name:'跟車卡：預覽班表的通過站照舊算差 → 變紅',mutation:M.cardPassDiff,run:o=>checkCard(o,{every:6}),expect:'預覽班表的通過站要記「—」'},
    {sec:'card',mode:'preview',name:'跟車卡：預覽班表的通過站來源照資料標表定 → 變紅',mutation:M.cardPassSrc,run:o=>checkCard(o,{every:6}),expect:'預覽班表的通過站要標內插'},
    {sec:'card',mode:'preview',name:'字幕：預覽時尾句仍寫重建的時刻 → 變紅',mutation:M.tailPreview,run:o=>checkCard(o,{every:6}),expect:'沒有寫表定時刻'},
    {sec:'card',name:'跟車卡：通過列的重播時刻改成表定 → 變紅',mutation:M.cardPassActSched,run:o=>checkCard(o,{every:6}),expect:'重播欄'},
    {sec:'card',name:'跟車卡：停靠列的差欄全改成「—」 → 變紅',mutation:M.cardStopDiffDash,run:o=>checkCard(o,{every:6}),expect:'差欄'},
    {sec:'card',mode:'observed',when:OBS_PASS,name:'跟車卡：實測重建的通過站也照預覽記「—」、標內插 → 變紅',mutation:M.cardObservedAsPreview,run:o=>checkCard(o,{every:6})},
    {sec:'card',mode:'observed',when:SCHED_ONLY_PASS,name:'跟車卡：沒有紀錄的車的通過站照舊算差、來源標表定 → 變紅',mutation:M.cardSchedOnlyOldRule,run:o=>checkCard(o),expect:'沒有即時動態紀錄的車的通過站'},
    {sec:'card',mode:'observed',name:'字幕：實測重建時尾句寫成表定時刻 → 變紅',mutation:M.tailObservedAsPreview,run:o=>checkCard(o,{every:6}),expect:'沒有寫重建的時刻'},
    {sec:'card',mode:'observed',name:'徽章：實測重建時仍寫預覽班表 → 變紅',mutation:M.badgeObservedAsPreview,run:o=>checkCard(o,{every:6}),expect:'徽章'},
    {sec:'card',mode:'preview',name:'徽章：預覽班表時寫成實測重建 → 變紅',mutation:M.badgePreviewAsObserved,run:o=>checkCard(o,{every:6}),expect:'徽章'},
    {sec:'uncertain',when:INTERVAL_EDGE_SINGLE,name:'股道待確認：時段起訖只有一班在場也藏起來並列進字幕（舊寫法）→ 變紅',mutation:M.uncertainOldRule,run:o=>checkIntervals(o),expect:'在場且被藏的是'},
    {sec:'about',name:'關於視窗：兩種模式的段落顯示顛倒 → 變紅',mutation:M.aboutInverted,run:o=>checkAbout(o)},
    {sec:'about',mode:'observed',when:SCHED_NOS.length>0,name:'關於視窗：實測段的車次清單少一班 → 變紅',mutation:M.aboutSchedDrop,run:o=>checkAbout(o),expect:'timingSource.scheduledTrains'},
    {sec:'about',mode:'observed',when:SCHED_NOS.some(x=>x.includes('營運日')),name:'關於視窗：同一車次有兩班時沒加註營運日 → 變紅',mutation:M.aboutSchedNoDate,run:o=>checkAbout(o),expect:'timingSource.scheduledTrains'},
    {sec:'about',mode:'observed',name:'關於視窗：實測模式的來源行寫成預覽的 → 變紅',mutation:M.aboutSourceObservedAsPreview,run:o=>checkAbout(o),expect:'來源行'},
    {sec:'about',mode:'preview',name:'關於視窗：預覽模式的來源行寫成實測的 → 變紅',mutation:M.aboutSourcePreviewAsObserved,run:o=>checkAbout(o),expect:'來源行'},
    {sec:'about',mode:'observed',name:'關於視窗：「不回報」換成有實測的站 → 變紅',mutation:M.aboutWrongStations,run:o=>checkAbout(o),expect:'不回報'},
    {sec:'jumps',name:'跳轉：「臺南發車」鈕按了沒反應 → 變紅',mutation:M.departUnwired,run:o=>checkJumps(o,fc),expect:'臺南發車'},
    {sec:'jumps',name:'跳轉：兩顆鈕都不再移到月台 → 變紅',mutation:M.nextNotPlatform,run:o=>checkJumps(o,fc),expect:'不是月台中央'},
   ];
   // labels／followZ 對照用的案例：沿用基準頁取到的代表案例
   var fcases=follow?follow.map(({id,train,dir,sec,name})=>({id,train,dir,sec,name})):[];
   for(const c of ctl){if(!want(c.sec))continue;if(c.mode&&c.mode!==MODE)continue;if(c.when===false){console.log(`略過對照（這份資料不適用）：${c.name}`);continue;}await runControl(browser,engine,{...c,run:c.run});}
  }
  if(want('layout')){const r=await checkLayoutMatrix(browser,engine,fc);record(engine,'layout','手機版面矩陣（尺寸 × 狀態 × 觸控）',r.pass,r.detail);}
  await browser.close();
 }
 fs.writeFileSync(RESULTS,JSON.stringify({results,controls:controlsLog},null,1));
 const total=results.length,passed=results.filter(r=>r.pass).length;
 console.log(`\n10/23 專屬驗收：${passed}/${total} 項通過，${fails} 項失敗；突變對照 ${controlsLog.length} 項（突變後如預期且還原後變綠：${controlsLog.filter(c=>(c.keepGreen?!c.red:c.red)&&c.restoredGreen).length}）；結果 ${path.relative(WT,RESULTS)}`);
 exitCode=fails?1:0;
}finally{
 if(server)server.kill();
}
process.exit(exitCode);

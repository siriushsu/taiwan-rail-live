// 新車模、中間車、集電弓、乘客零件庫的離線判準（不開瀏覽器）。用法：node --no-warnings scripts/verify_garage_stop_assets.mjs [D M P]；不帶參數跑全部。
// 判準定義在 docs/superpowers/plans/2026-09-24-viaduct-stop-doors.md 的 Task 4／5／7；BASE＝改動前的 commit。
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildDoorGlow} from '../rail-3d/garage-doors.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),BASE='65682ab6b492f8ede13b890f3689de468ed69bb2',DIR='rail-3d/assets/garage-blender-v1/';
const want=new Set(process.argv.slice(2)),on=k=>!want.size||want.has(k);
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,400));}
const now=f=>readFileSync(path.join(ROOT,f)),then=f=>execFileSync('git',['-C',ROOT,'show',BASE+':'+f],{maxBuffer:1<<28});
// 資產＝JSON＋解壓後的 float32（每頂點 位置3＋法向量3）；長度或 sha256 不符直接丟錯。
function load(read,dir,id){const meta=JSON.parse(read(dir+id+'.json').toString()),raw=gunzipSync(read(dir+meta.mesh.file));
 if(raw.length!==meta.mesh.vertexCount*24)throw Error(id+' 長度不符');if(createHash('sha256').update(raw).digest('hex')!==meta.mesh.sha256)throw Error(id+' 雜湊不符');
 return{meta,f:new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),count:meta.mesh.vertexCount};}
const vtx=(a,v,off)=>{const o=off?off(v):null;return[a.f[v*6]+(o?o[0]:0),a.f[v*6+1]+(o?o[1]:0),a.f[v*6+2]+(o?o[2]:0)];};
// 射線與三角形（Möller–Trumbore，雙面、不剔除背面）：回傳距離或 null。
// 重心座標留 1e-9 的容差：取樣點剛好落在兩個三角形的共用邊上時（門扇對角線正好經過門中心），至少一邊算命中，不會兩邊都漏掉。
function hit(o,d,a,b,c){const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];
 if(Math.abs(det)<1e-12)return null;const inv=1/det,s=[o[0]-a[0],o[1]-a[1],o[2]-a[2]],u=(s[0]*p[0]+s[1]*p[1]+s[2]*p[2])*inv;if(u<-1e-9||u>1+1e-9)return null;
 const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])*inv;if(v<-1e-9||u+v>1+1e-9)return null;
 const t=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*inv;return t>1e-9?t:null;}
// 最近命中：tris＝要測的三角形（首頂點索引）；off(v)＝頂點位移（驗開門時把門扇移到全開）。回傳 {t,v} 或 null。
function cast(a,tris,o,d,off,maxT=Infinity){let best=null;for(const v of tris){const t=hit(o,d,vtx(a,v,off),vtx(a,v+1,off),vtx(a,v+2,off));if(t!==null&&t<maxT&&(!best||t<best.t))best={t,v};}return best;}
// 某扇門附近的三角形（x 範圍與 cx±r 有交集）：先篩掉其餘九成，免得每條射線掃五萬多個三角形。
// 用 x 範圍不用重心：挖洞後的車殼側面常是一條跨過門洞的長三角形，重心落在 r 外，用重心篩會把它漏掉、讓射線穿牆假綠。
const near=(a,cx,r=1.5)=>{const out=[];for(let v=0;v<a.count;v+=3){const x0=a.f[v*6],x1=a.f[v*6+6],x2=a.f[v*6+12];if(Math.min(x0,x1,x2)<cx+r&&Math.max(x0,x1,x2)>cx-r)out.push(v);}return out;};
const inRanges=(d,v)=>d.ranges.some(r=>v>=r.start&&v<r.start+r.count);
const openOffset=d=>[0,1,2].map(k=>d.inward[k]+d.slide[k]*d.travel);   // 全開位移；判準自己算，不 import 實作
const groupOf=(a,v)=>a.meta.mesh.drawGroups.find(g=>v>=g.start&&v<g.start+g.count);
// 正交光線追蹤（D12 用）：在過 c、垂直於 dir 的像平面上每 px 一格射一條；回傳每格 {q：像平面上的點, h：第一個命中 {t,g,front,n} 或 null}。
// n＝插值頂點法向量（three.js 打光用的就是它）；front＝射到三角形正面（FrontSide 材質看得到）。三角形先依像平面投影分到 2 cm 的格子，每條射線只測自己那格。
const sub3=(p,q)=>[p[0]-q[0],p[1]-q[1],p[2]-q[2]],dot3=(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2],cross3=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],unit3=p=>{const l=Math.hypot(...p);return l>0?p.map(x=>x/l):p;};
// off(v)＝頂點位移（同 cast，D13 用來把門扇移到全開）；命中另帶三角形首頂點索引 v。
function ortho(a,tris,c,dir,half,px,off){const right=unit3(cross3(dir,[0,0,1])),up=cross3(right,dir),B=.02,nx=Math.ceil(2*half[0]/B),ny=Math.ceil(2*half[1]/B),bins=Array.from({length:nx*ny},()=>[]);
 for(const v of tris){let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;for(let k=0;k<3;k++){const p=sub3(vtx(a,v+k,off),c),x=dot3(p,right)+half[0],y=half[1]-dot3(p,up);a0=Math.min(a0,x);a1=Math.max(a1,x);b0=Math.min(b0,y);b1=Math.max(b1,y);}
  for(let i=Math.max(0,Math.floor(a0/B));i<=Math.min(nx-1,Math.floor(a1/B));i++)for(let j=Math.max(0,Math.floor(b0/B));j<=Math.min(ny-1,Math.floor(b1/B));j++)bins[j*nx+i].push(v);}
 const out=[],W=Math.round(2*half[0]/px),H=Math.round(2*half[1]/px);
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){const x=(i+.5)*px,y=(j+.5)*px,q=[0,1,2].map(k=>c[k]+right[k]*(x-half[0])+up[k]*(half[1]-y)),o=q.map((v,k)=>v-dir[k]*6),r=cast(a,bins[Math.floor(y/B)*nx+Math.floor(x/B)],o,dir,off);
  let h=null;if(r){const A=vtx(a,r.v,off),e1=sub3(vtx(a,r.v+1,off),A),e2=sub3(vtx(a,r.v+2,off),A),p=sub3(o.map((v,k)=>v+dir[k]*r.t),A),d00=dot3(e1,e1),d01=dot3(e1,e2),d11=dot3(e2,e2),d20=dot3(p,e1),d21=dot3(p,e2),den=d00*d11-d01*d01,u=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den,wt=[1-u-w,u,w];
   h={t:r.t,v:r.v,g:groupOf(a,r.v).name,front:dot3(cross3(e1,e2),dir)<0,n:unit3([0,1,2].map(k=>wt.reduce((s,wk,m)=>s+wk*a.f[(r.v+m)*6+3+k],0)))};}
  out.push({q,h});}
 return out;}

// 對每一扇門跑 fn(d,s,cx,w,h,basez)；回傳不合格的門與數值（fn 回 null＝合格）。
const eachDoor=(items,fn)=>{const bad=[];for(const d of items){const r=fn(d,d.side,d.center[0],d.width,d.height,d.center[2]-d.height/2);if(r)bad.push({id:d.id,...r});}return bad;};
// 門把凸出門扇到車身最寬處（原車 Y 邊界 1.5155 就是它撐出來的），它跟門扇一起動，所以 range 頂點的外緣上限取 BASE 頭車的車寬＋.01。
const yOutOf=o=>Math.max(o.meta.bounds.max[1],-o.meta.bounds.min[1])+.01;
const sameGroup=(g,h)=>g.name===h.name&&g.lightingRole===h.lightingRole&&g.color.length===h.color.length&&g.color.every((c,k)=>Math.abs(c-h.color[k])<=1e-6)&&g.metalness===h.metalness&&g.roughness===h.roughness&&g.clearcoat===h.clearcoat;
// 可動車門判準本體：D 段驗頭車、M4 驗中間車，同一套。回傳 D1、D4～D9、D11 各自的 [合格, 明細]。
function doorChecks(a,yOut){const doors=a.meta.doors,items=Array.isArray(doors?.items)?doors.items:[],none='沒有 doors',G=a.meta.mesh.drawGroups,each=fn=>eachDoor(items,fn),R={};
 // id：+Y 側 L、−Y 側 R；−X 端 1、+X 端 2（Task 6 的 garage-doors.js 依這個格式）。
 const idOk=items.length===4&&items.every(d=>{const end=items.filter(e=>e.side===d.side).sort((x,y)=>x.center[0]-y.center[0]).indexOf(d)+1;return d.id===(d.side===1?'L':'R')+end;});
 R.D1=[doors?.schema==='garage-doors-v1'&&doors?.type==='slide-pocket'&&items.length===4&&items.filter(d=>d.side===1).length===2&&items.filter(d=>d.side===-1).length===2&&idOk,doors?{schema:doors.schema,type:doors.type,doors:items.map(d=>[d.id,d.side,d.center?.[0]]),idOk}:none];
 const ranges=items.flatMap(d=>(Array.isArray(d.ranges)?d.ranges:[]).map(r=>({id:d.id,...r}))),bad4=[];
 for(const r of ranges){const g=G.find(g=>r.start>=g.start&&r.start+r.count<=g.start+g.count);
  if(!Number.isInteger(r.start)||!Number.isInteger(r.count)||r.start<0||r.count<3||r.count%3||r.start+r.count>a.count)bad4.push([r.id,r.group,'越界或不是 3 的倍數',r.start,r.count]);
  else if(!g||g.name!==r.group)bad4.push([r.id,r.group,'不在同名 drawGroup 內',g?.name??null]);}
 const byStart=[...ranges].sort((x,y)=>x.start-y.start);for(let i=1;i<byStart.length;i++)if(byStart[i].start<byStart[i-1].start+byStart[i-1].count)bad4.push(['重疊',byStart[i-1].id,byStart[i-1].group,byStart[i].id,byStart[i].group]);
 R.D4=[items.length>0&&items.every(d=>d.ranges?.length>0)&&bad4.length===0,items.length?{ranges:ranges.length,bad:bad4}:none];
 const bad5=each((d,s,cx,w,h,bz)=>{let out=0,stray=0,eo=null,es=null;
  for(let v=0;v<a.count;v++){const x=a.f[v*6],y=s*a.f[v*6+1],z=a.f[v*6+2];
   if(inRanges(d,v)){if(!(Math.abs(x-cx)<=w/2+.01&&y>=1.44&&y<=yOut&&z>=bz-.01&&z<=bz+h+.01)){out++;eo??=[x,y,z];}}
   // 門扇體積往外算到門把外緣（yOut）：開門後門口前方留下的任何東西（09-25 實例：固定門把）都算在這裡。射線格會從小零件旁邊穿過，頂點不會。
   else if(Math.abs(x-cx)<w/2-.01&&y>1.452&&y<yOut&&z>bz+.01&&z<bz+h-.01){stray++;es??=[x,y,z];}}
  return out||stray?{rangeVertsOutside:out,firstOutside:eo,strayInside:stray,firstStray:es}:null;});
 R.D5=[items.length>0&&bad5.length===0,items.length?bad5:none];
 const bad6=each((d,s,cx,w,h,bz)=>{const tris=near(a,cx);let miss=0,first=null;
  for(let i=0;i<=6;i++)for(let j=0;j<=14;j++){const x=cx+w*(i/6-.5)*.9,z=bz+h*(.05+.9*j/14),r=cast(a,tris,[x,s*3,z],[0,-s,0]);
   if(!r||!inRanges(d,r.v)){miss++;first??={x,z,hit:r?{t:r.t,group:groupOf(a,r.v)?.name}:null};}}
  return miss?{miss,of:105,first}:null;});
 R.D6=[items.length>0&&bad6.length===0,items.length?bad6:none];
 // 取樣格與 D6 相同、鋪滿整個門口：只取左右兩直行會漏掉門口中間留下的東西（09-25 實例：原位留了一個固定門把）。
 // 門口到門廳背牆（body，s·y 約 .89）之間只准有扶手（metal）。09-26 實例：挖洞的切刀內面在 s·y 1.40 留成 body 封板，
 // 舊判準「命中在 .8～1.44」把 1.40 也算門內，門內從來沒露出來過。
 const bad7=each((d,s,cx,w,h,bz)=>{const tris=near(a,cx),off0=openOffset(d),off=v=>inRanges(d,v)?off0:null;let bad=0,first=null;
  for(let i=0;i<=6;i++)for(let j=0;j<=14;j++){const x=cx+w*(i/6-.5)*.9,z=bz+h*(.05+.9*j/14),r=cast(a,tris,[x,s*3,z],[0,-s,0],off),sy=r?3-r.t:null,g=r?groupOf(a,r.v)?.name:null;
   if(!r||sy<.8||(g==='metal'?sy>1.44:g!=='body'||sy>1.0)){bad++;first??={x,z,sy,group:g};}}
  return bad?{bad,of:105,first}:null;});
 R.D7=[items.length>0&&bad7.length===0,items.length?bad7:none];
 const th=doors?.threshold;
 const bad8=each((d,s,cx)=>{const r=cast(a,near(a,cx),[cx,s*1.343,3],[0,0,-1]),z=r?3-r.t:null;return z!==null&&Math.abs(z-th)<=.002?null:{z,threshold:th,group:r?groupOf(a,r.v)?.name:null};});
 R.D8=[items.length>0&&typeof th==='number'&&th>=.915&&th<=.925&&bad8.length===0,items.length?{threshold:th,bad:bad8}:none];
 const bad9=each((d,s,cx,w,h,bz)=>{const off0=openOffset(d),sig=d.slide[0];let outside=0,firstY=null;
  for(let v=0;v<a.count;v++)if(inRanges(d,v)){const y=s*(a.f[v*6+1]+off0[1]);if(y<1.29||y>1.40){outside++;firstY??=y;}}
  const tris=near(a,cx).filter(v=>!inRanges(d,v));let blocked=0,first=null;
  for(const y0 of [1.316,1.326,1.336])for(const f of [.1,.3,.5,.7,.9]){const o0=[cx-sig*(w/2-.02),s*y0,bz+h*f],r=cast(a,tris,o0,[sig,0,0],null,w+d.travel-.02);
   if(r){blocked++;first??={y0,z:o0[2],t:r.t,group:groupOf(a,r.v)?.name};}}
  return outside||blocked?{vertsOutsidePocket:outside,firstY,blocked,of:15,first}:null;});
 R.D9=[items.length>0&&bad9.length===0,items.length?bad9:none];
 const win=G.filter(g=>g.lightingRole==='window');
 const bad11=each((d,s,cx)=>{let n=0;for(const g of win)for(let v=g.start;v<g.start+g.count;v+=3){let ok=true;
   for(let k=0;k<3;k++){const x=a.f[(v+k)*6],y=s*a.f[(v+k)*6+1],z=a.f[(v+k)*6+2];if(!(y>=.875&&y<=1.425&&z>=2.9&&z<=3.13&&Math.abs(x-cx)<=.5)){ok=false;break;}}if(ok)n++;}
  return n>=2?null:{lampTris:n};});
 R.D11=[items.length>0&&win.length>0&&bad11.length===0,items.length?bad11:none];
 // D13 門廳透光（設計書 §9；09-26 複驗項 6）：夜裡從門洞看進去，門廳背牆、地板、兩側端牆要整片亮，亮的面也只能從門洞看得到。
 // 背牆與地板都是一整片跨過門洞的四邊形，舊規則看三角形重心、只點亮其中一部分，每個門口都有一條斜的明暗交界；端牆在門洞範圍外，斜看時佔門洞大半，舊規則整片不亮。
 // 用正式 buildDoorGlow 算每個三角形亮不亮；那扇門全開，D12 同一套正交光線追蹤（正面、兩個 30° 斜角，再加兩個 60° 斜角與鏡頭最低的俯角 1.0）每 2 cm 一格：
 // 穿過門框內緣 s·y 1.40 平面的點在門洞內（內縮 2 cm）、第一個命中是門廳背牆（body、s·y .8～1.0、面朝門口＝法向量沿 y）、地板（水平面、門檻高度 ±1 cm、s·y .8～1.4）或端牆（body、直立且正對車身方向 |n_x|≥.99、s·y .88～1.40、離門中心 ≤ 門寬/2＋.35）→ 要亮；第一個命中是亮的面 → 穿過點要在門洞外擴 6 cm 以內（同 D12）。
 // 穿過點量在 1.40 不用 D12 的 1.44：60° 斜看時車殼外那 4 cm 會橫移 7 cm，門洞角落看進去的門內地板會被算成門洞外。
 // 車頭那扇門斜看會看到車頭流線外殼的背面（|n_x| .93、離門中心 .86 以外），那是車外的面，不算端牆、也不能亮。
 // 地板外緣與車殼之間有一道約 1 cm 的縫，俯看會看到縫下的裙板內側（z .90、整節車長的一個三角形），那是車身結構不是地板，不要求亮。
 // 客室地板（chassis）伸進門廳的台階——直立面 s·y 1.026、頂面 z 1.01，都是整節車長的三角形——不算門廳面，現在是暗的（帳本 Task 9 的已知項）。
 const index=new Float32Array(a.count);items.forEach((d,k)=>{for(const r of d.ranges??[])for(let v=r.start;v<r.start+r.count&&v<a.count;v++)index[v]=k+1;});
 const glow=items.length?buildDoorGlow({count:a.count,getX:v=>a.f[v*6],getY:v=>a.f[v*6+1],getZ:v=>a.f[v*6+2]},items,index):null,view={...dirs,前深斜:s=>unit3([-.85,-s*.5,-.15]),後深斜:s=>unit3([.85,-s*.5,-.15]),俯角:s=>[0,-s*Math.cos(1),-Math.sin(1)]};
 const bad13=each((d,s,cx,w,h,bz)=>{const off0=openOffset(d),off=v=>inRanges(d,v)?off0:null,tris=near(a,cx,3);let wall=0,dark=0,lit=0,stray=0,firstDark=null,firstStray=null;
  for(const [name,f] of Object.entries(view)){const dir=f(s);
   for(const {q,h:x} of ortho(a,tris,[cx,s*1.44,2.15],dir,[1.4,1.35],.02,off)){if(!x)continue;
    const lam=(1.40-s*q[1])/(s*dir[1]),pc=q.map((v,k)=>v+dir[k]*lam),sy=s*(q[1]+dir[1]*(x.t-6));
    if(Math.abs(pc[0]-cx)<=w/2-.02&&pc[2]>=bz+.02&&pc[2]<=bz+h-.02){const n=unit3(cross3(sub3(vtx(a,x.v+1,off),vtx(a,x.v,off)),sub3(vtx(a,x.v+2,off),vtx(a,x.v,off)))),hz=q[2]+dir[2]*(x.t-6);
     const face=x.g==='body'&&sy>=.8&&sy<=1.0&&Math.abs(n[1])>=.9?'背牆':Math.abs(n[2])>=.9&&Math.abs(hz-bz)<=.01&&sy>=.8&&sy<=1.4?'地板':x.g==='body'&&Math.abs(n[0])>=.99&&sy>=.88&&sy<=1.40&&Math.abs(q[0]+dir[0]*(x.t-6)-cx)<=w/2+.35?'端牆':null;
     if(face){wall++;if(!glow[x.v]){dark++;firstDark??={face,dir:name,dx:+(pc[0]-cx).toFixed(3),z:+pc[2].toFixed(3)};}}}
    if(glow[x.v]){lit++;if(!(Math.abs(pc[0]-cx)<=w/2+.06&&pc[2]>=bz-.06&&pc[2]<=bz+h+.06)){stray++;firstStray??={dir:name,dx:+(pc[0]-cx).toFixed(3),z:+pc[2].toFixed(3),sy:+sy.toFixed(3),g:x.g};}}}}
  return wall&&!dark&&lit&&!stray?null:{wall,dark,lit,stray,firstDark,firstStray};});
 R.D13=[items.length>0&&bad13.length===0,items.length?bad13:none];
 return R;}
// 門口以外逐格比外觀（D12 對 BASE、M9 對頭車）。09-25 實例：門廳盒子的外側平板做在 |y| 1.425（車殼外表面），在車殼上下圓弧處凸出 3～8 cm（底部一整條橡膠、頂部一片車身），
// 在平直處跟車殼共面（框條與車身搶深度＝閃爍黑線）；重建時車頭折線的法向量被抹平（整片側板變漸層）、車端端牆被切成不同的三角形（整面明暗改變）——D1～D11 全綠照不到。
// 正面＋前後各一個斜角，6 mm 一格；射線穿過 s·y=1.44 平面的點落在門洞外擴 6 cm 以內的不比（門扇、門框、門內本來就會變），其餘每一格都要跟參考：
// 同樣有沒有命中、同群組、距離差 ≤3 mm、同正反面、插值法向量夾角 ≤12°。回傳 null＝相同，否則 {diffPx,kinds,first}。zTop：穿過點高於它的不比（D12 不設、M9 見下）。
// 外擴 6 cm＝門框環寬 4 cm（到門中心 .3525）＋斜角視差：環比原門框板內縮 6 mm（1.446 對 1.452，看不出來、允許），斜射時命中點會橫移約 7 mm。
const dirs={正面:s=>[0,-s,0],前斜:s=>unit3([-.5,-s*.85,-.15]),後斜:s=>unit3([.5,-s*.85,-.15])};
function exteriorDiff(a,ref,s,cx,w,h,bz,zTop=Infinity){const c=[cx,s*1.44,2.15],tA=near(a,cx,3),tR=near(ref,cx,3),first=[],kinds={};let n=0;
 for(const [name,f] of Object.entries(dirs)){const dir=f(s),A=ortho(a,tA,c,dir,[1.4,1.35],.006),O=ortho(ref,tR,c,dir,[1.4,1.35],.006);
  for(let i=0;i<A.length;i++){const {q,h:x}=A[i],y=O[i].h,lam=(1.44-s*q[1])/(s*dir[1]),pc=q.map((v,k)=>v+dir[k]*lam);
   if(pc[2]>zTop||Math.abs(pc[0]-cx)<=w/2+.06&&pc[2]>=bz-.06&&pc[2]<=bz+h+.06)continue;
   const k=!x!==!y?'有無命中':!x?null:x.g!==y.g?'群組':Math.abs(x.t-y.t)>.003?'深度':x.front!==y.front?'正反面':Math.acos(Math.max(-1,Math.min(1,dot3(x.n,y.n))))>12*Math.PI/180?'法向量':null;
   if(!k)continue;n++;kinds[k]=(kinds[k]||0)+1;
   if(first.length<4)first.push({dir:name,dx:+(pc[0]-cx).toFixed(3),z:+pc[2].toFixed(3),k,now:x&&{g:x.g,sy:+(s*(q[1]+dir[1]*(x.t-6))).toFixed(3)},base:y&&{g:y.g,sy:+(s*(q[1]+dir[1]*(y.t-6))).toFixed(3)}});}}
 return n?{diffPx:n,kinds,first}:null;}
// 對 x 鏡射的資產（M9 拿頭車鏡射當中間車 +X 端的參考）：x 與法向量 x 取負；每個三角形交換後兩個頂點，正反面不變。
function mirrorX(a){const f=new Float32Array(a.f.length);
 for(let v=0;v<a.count;v+=3)for(let k=0;k<3;k++){const o=(v+k)*6,i=(v+[0,2,1][k])*6;f[o]=-a.f[i];f[o+1]=a.f[i+1];f[o+2]=a.f[i+2];f[o+3]=-a.f[i+3];f[o+4]=a.f[i+4];f[o+5]=a.f[i+5];}
 return{meta:a.meta,f,count:a.count};}

// D：頭尾車 emu3000 的可動車門（Task 4）。四扇門的結果合併在同一項，D 段固定 13 項（D13 是 Task 9 複驗後加的，見帳本）。
if(on('D')){const a=load(now,DIR,'emu3000'),o=load(then,DIR,'emu3000'),R=doorChecks(a,yOutOf(o));
 const items=Array.isArray(a.meta.doors?.items)?a.meta.doors.items:[],none='沒有 doors',G=a.meta.mesh.drawGroups,G0=o.meta.mesh.drawGroups;
 check('D1 doors：schema garage-doors-v1、type slide-pocket；4 扇門，每側 2 扇',...R.D1);
 const pairs=[...a.meta.bounds.min.map((v,i)=>[v,o.meta.bounds.min[i]]),...a.meta.bounds.max.map((v,i)=>[v,o.meta.bounds.max[i]]),...a.meta.sizeM.map((v,i)=>[v,o.meta.sizeM[i]])];
 check('D2 bounds、sizeM 與 BASE 各分量差 ≤1e-4',pairs.length===9&&pairs.every(([x,y])=>Math.abs(x-y)<=1e-4),{bounds:a.meta.bounds,sizeM:a.meta.sizeM,base:{bounds:o.meta.bounds,sizeM:o.meta.sizeM}});
 const bad3=G.length!==G0.length?[`個數 ${G.length}≠${G0.length}`]:G.flatMap((g,i)=>sameGroup(g,G0[i])?[]:[`${i}:${g.name}≠${G0[i].name}`]);
 check('D3 drawGroups 與 BASE 同個數、同順序；名稱、lightingRole、材質值相同',bad3.length===0,bad3);
 check('D4 ranges：start≥0、count 為 3 的倍數、不越界、互不重疊、完整落在同名 drawGroup 內',...R.D4);
 check('D5 門扇完整：range 內頂點都在門扇外框內，range 外沒有頂點落在門扇內部',...R.D5);
 check('D6 關門完全蓋住門洞：105 條射線第一個命中都是這扇門',...R.D6);
 check('D7 全開露出門內：105 條射線第一個命中是門廳背牆（body，s·y .8～1.0）或扶手（metal）',...R.D7);
 check('D8 門內地板＝踏板高：往下射第一個命中與 threshold 差 ≤.002，threshold 在 .915～.925',...R.D8);
 check('D9 壁袋收得下：全開門扇 s·y 在 1.29～1.40，滑動路徑上沒有別的三角形',...R.D9);
 const tri=a.count/3,tri0=o.count/3;
 check('D10 三角形數 ≤ BASE＋6000',tri<=tri0+6000&&a.meta.mesh.triangleCount===tri,{now:tri,meta:a.meta.mesh.triangleCount,base:tri0,limit:tri0+6000});
 check('D11 門內頂燈：每扇門 ≥2 個 window 角色三角形在門廳天花板',...R.D11);
 const bad12=eachDoor(items,(d,s,cx,w,h,bz)=>exteriorDiff(a,o,s,cx,w,h,bz));
 check('D12 門口以外的外觀與 BASE 相同：正面＋兩個斜角光線追蹤，群組、深度、正反面、法向量逐格一致',items.length>0&&bad12.length===0,items.length?bad12:none);
 for(const b of bad12)console.log('   D12',b.id,JSON.stringify({diffPx:b.diffPx,kinds:b.kinds}),JSON.stringify(b.first));   // check() 的明細只印 400 字，四扇門看不全
 check('D13 門廳透光：從門洞看進去的門廳背牆、地板、端牆整片亮、亮的面只從門洞看得到（正式 buildDoorGlow；正面、30° 與 60° 斜角、俯角 1.0 光線追蹤）',...R.D13);
}

// M：中間車 emu3000-mid 與集電弓零件庫 emu3000-pantograph（Task 5）。M 段固定 9 項。
// scale＝場景把頭車車寬 sizeM[1] 畫成 1.25 世界單位；電車線高度 H 是世界單位、離軌頂，使用者 09-25 選方案 A，只驗 1.95。
if(on('M')){const hd=load(now,DIR,'emu3000'),o=load(then,DIR,'emu3000'),m=load(now,DIR,'emu3000-mid'),p=load(now,DIR,'emu3000-pantograph');
 const mm=m.meta,pan=mm.pantograph,mount=pan?.mount,items=Array.isArray(mm.doors?.items)?mm.doors.items:[];
 check('M1 emu3000-mid 讀得到（長度、雜湊對）；有 doors 與 pantograph{parts:emu3000-pantograph,mount}',!!mm.doors&&pan?.parts==='emu3000-pantograph'&&Array.isArray(mount)&&mount.length===3&&mount.every(Number.isFinite),{doors:!!mm.doors,pantograph:pan??null});
 const man=JSON.parse(now('rail-3d/assets/blender-map-v1/manifest.json')).meshes['emu3000-mid'],mapLen=man.max[0]-man.min[0];
 check('M2 車寬與頭車差 ≤.01；車長與地圖中間車差 ≤.05',Math.abs(mm.sizeM[1]-hd.meta.sizeM[1])<=.01&&Math.abs(mm.sizeM[0]-mapLen)<=.05,{sizeM:mm.sizeM,head:hd.meta.sizeM[1],mapLen});
 const roles=mm.mesh.drawGroups.filter(g=>g.lightingRole==='headFront'||g.lightingRole==='tailFront').map(g=>g.name);
 check('M3 沒有頭燈、尾燈角色，lighting 省略或 null；features.pantographsOnThisAsset＝1',roles.length===0&&mm.lighting==null&&mm.features?.pantographsOnThisAsset===1,{roles,lighting:mm.lighting??null,pantographs:mm.features?.pantographsOnThisAsset??null});
 const R=doorChecks(m,yOutOf(o)),failed=Object.entries(R).filter(([,r])=>!r[0]).map(([k,r])=>({[k]:r[1]})),HG=hd.meta.mesh.drawGroups,foreign=mm.mesh.drawGroups.filter(g=>!HG.some(h=>sameGroup(g,h))).map(g=>g.name);
 check('M4 中間車車門過 D1、D4～D9、D11、D13；每個 drawGroup 的名稱與材質值都在頭車裡找得到',failed.length===0&&foreign.length===0,{failed,foreign});
 check('M5 集電弓座：x 取負（肘朝 +x）且 |x| 在 2.0～3.5、|y|<.05、z 在 3.3～3.7',Array.isArray(mount)&&mount[0]<0&&-mount[0]>=2&&-mount[0]<=3.5&&Math.abs(mount[1])<.05&&mount[2]>=3.3&&mount[2]<=3.7,{mount:mount??null});
 const pm=p.meta,rig=pm.rig??{},parts=Array.isArray(pm.parts)?pm.parts:[],ext={};
 for(const q of parts){if(!Number.isInteger(q.start)||!Number.isInteger(q.count)||q.start<0||q.count<3||q.count%3||q.start+q.count>p.count){ext[q.name]='越界或不是 3 的倍數';continue;}
  const e={x0:Infinity,x1:-Infinity,z1:-Infinity};for(let v=q.start;v<q.start+q.count;v++){e.x0=Math.min(e.x0,p.f[v*6]);e.x1=Math.max(e.x1,p.f[v*6]);e.z1=Math.max(e.z1,p.f[v*6+2]);}ext[q.name]=e;}
 const spans=(e,L)=>typeof e==='object'&&Math.abs(e.x0)<=.05&&Math.abs(e.x1-L)<=.05;
 check('M6 集電弓零件庫：garage-parts-v1，rig＝1.10／.81／.052（方案 A）；base、lower、upper、head 各一；lower 伸 0～rig.lower、upper 伸 0～rig.upper（兩端各容許 .05）；head 最高點＝rig.headRise±.01',
  pm.schema==='garage-parts-v1'&&pm.id==='emu3000-pantograph'&&rig.lower===1.10&&rig.upper===.81&&rig.headRise===.052&&['base','lower','upper','head'].every(k=>parts.filter(q=>q.name===k).length===1&&typeof ext[k]==='object')&&spans(ext.lower,rig.lower)&&spans(ext.upper,rig.upper)&&Math.abs(ext.head.z1-rig.headRise)<=.01,
  {schema:pm.schema,id:pm.id,rig,ext});
 const scale=1.25/hd.meta.sizeM[1],reach=[1.95].map(H=>{const z=H/scale-(mount?.[2]??NaN)-rig.headRise,dd=Math.hypot(rig.lower-rig.upper,z);return{H,z:+z.toFixed(4),dd:+dd.toFixed(4),ok:z>0&&Math.abs(rig.lower-rig.upper)<=dd&&dd<=rig.lower+rig.upper-1e-6};});
 check('M7 電車線 1.95（方案 A）伸得到：z＝H/scale−mount.z−headRise>0 且 |lower−upper|≤hypot(lower−upper,z)≤lower+upper；headRise≤.1',reach.every(r=>r.ok)&&rig.headRise<=.1,{scale:+scale.toFixed(5),reach});
 const mt=m.count/3,pt=p.count/3;
 check('M8 中間車三角形 ≤56106、集電弓 ≤1500',mt<=56106&&mm.mesh.triangleCount===mt&&pt<=1500,{mid:mt,meta:mm.mesh.triangleCount,pantograph:pt});
 // M9：中間車兩端都是貫通道端，跟頭車門 1 那一端同一個設計，門口附近要逐格相同（D12 同一套光線追蹤）；+X 端的門拿對 x 鏡射的頭車比。
 // 頭車那一端已由 D12 對 BASE 驗過；這裡驗中間車有沒有重新做出 09-25 那幾種缺陷（凸出、共面閃爍、法向量、切法）。M4 只看門口裡面，照不到。
 // 車頂帶（穿過點 z>3.35，車頂 3.4 以上）不比：設計書規定中間車只有一個車頂單元、集電弓在一端轉向架上方，兩端車頂本來就跟頭車（尾端有車頂單元）不同。
 // 3.35 以下的斜射線一路往下，碰不到 3.4 以上的車頂設備，所以側面車身照樣逐格比。
 const hm=mirrorX(hd),bad9=eachDoor(items,(d,s,cx,w,h,bz)=>{const r=hd.meta.doors.items.find(e=>e.id===(s===1?'L':'R')+'1');
  if(!r||Math.abs(Math.abs(cx)-Math.abs(r.center[0]))>1e-4)return{門位:cx,頭車門1:r?.center[0]??null};return exteriorDiff(m,cx<0?hd:hm,s,cx,w,h,bz,3.35);});
 check('M9 中間車兩端門口附近的外觀與頭車貫通道端（門 1）相同（車頂帶除外）：D12 同一套光線追蹤，+X 端對鏡射的頭車比',items.length>0&&bad9.length===0,items.length?bad9:'沒有 doors');
 for(const b of bad9)console.log('   M9',b.id,JSON.stringify(b.diffPx?{diffPx:b.diffPx,kinds:b.kinds}:b),JSON.stringify(b.first??''));
}

// P：乘客零件庫 garage-people-v1/people（Task 7）。P 段固定 9 項（P6～P9 是主對話加的，見帳本 Task 7 的 Ruling）。
// 人的座標＝零件頂點＋該零件的轉軸（每個零件以自己的轉軸為原點匯出）；成對零件的第二份放在 y 取負的轉軸、幾何不鏡像（Task 8 的畫法），兩份都照這個規則算。
if(on('P')){const p=load(now,'rail-3d/assets/garage-people-v1/','people'),pm=p.meta,rig=pm.rig??{},parts=Array.isArray(pm.parts)?pm.parts:[];
 const NAMES=['head','hair-short','hair-long','hair-bun','torso-shirt','torso-jacket','torso-hoodie','torso-dress','arm','hand','leg','shoe','acc-backpack','acc-suitcase','acc-handbag','acc-hat'],
  TINTS=['top','bottom','skin','hair','accent','fixed'],PAIRED=['arm','hand','leg','shoe'],RIG={hip:[0,.1,.86],shoulder:[0,.2,1.36],neck:[0,0,1.42]};
 // 轉軸表（計畫 Task 7 Interfaces）：頭、髮型、帽子在 neck；手臂、手、手提包在 shoulder（+Y 側）；腿、鞋在 hip（+Y 側）；上身、後背包、行李箱在原點。
 // rig 的 hip／shoulder／neck 照 Interfaces 逐值比：Task 8 坐下用 rig.hip[2]、拖行李箱用 rig.shoulder[1]，零件轉軸也必須等於它們。
 const pivotFor=n=>n==='head'||n.startsWith('hair-')||n==='acc-hat'?RIG.neck:n==='arm'||n==='hand'||n==='acc-handbag'?RIG.shoulder:n==='leg'||n==='shoe'?RIG.hip:[0,0,0];
 const same3=(u,v)=>Array.isArray(u)&&u.length===3&&u.every((x,k)=>Math.abs(x-v[k])<=1e-6),rangeOk=q=>Number.isInteger(q?.start)&&Number.isInteger(q?.count)&&q.start>=0&&q.count>=3&&q.count%3===0&&q.start+q.count<=p.count;
 const byName={},bad={},flag=(k,v)=>(bad[k]??=[]).push(v);
 for(const q of parts){if(byName[q.name])flag('重複',q.name);byName[q.name]=q;if(!NAMES.includes(q.name))flag('多出',q.name);
  if(!TINTS.includes(q.tint))flag('tint',q.name+':'+q.tint);
  if(q.tint==='fixed'&&!(Array.isArray(q.color)&&q.color.length===3&&q.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1)))flag('fixed 缺 color',q.name);
  if(q.perPerson!==(PAIRED.includes(q.name)?2:1))flag('perPerson',q.name+':'+q.perPerson);
  if(!same3(q.pivot,pivotFor(q.name)))flag('轉軸',q.name+':'+JSON.stringify(q.pivot));
  if(!rangeOk(q))flag('區段',q.name);}
 for(const n of NAMES)if(!byName[n])flag('缺',n);
 const sorted=parts.filter(rangeOk).sort((a,b)=>a.start-b.start);for(let i=1;i<sorted.length;i++)if(sorted[i].start<sorted[i-1].start+sorted[i-1].count)flag('區段重疊',sorted[i-1].name+'/'+sorted[i].name);
 for(const k of ['hip','shoulder','neck'])if(!same3(rig[k],RIG[k]))flag('rig',k+':'+JSON.stringify(rig[k]??null));
 check('P1 people 讀得到（長度、雜湊對）；garage-parts-v1、id／kind people、units model；16 個零件名恰好齊全；tint 在集合內、fixed 有 color；perPerson 與轉軸照表；rig 的 hip／shoulder／neck 照 Interfaces',
  pm.schema==='garage-parts-v1'&&pm.id==='people'&&pm.kind==='people'&&pm.units==='model'&&pm.mesh?.file==='people.bin.gz'&&!Object.keys(bad).length,{schema:pm.schema,id:pm.id,kind:pm.kind,units:pm.units,file:pm.mesh?.file,bad});
 // 零件在自己座標系裡的外框（原點＝轉軸）與三角形數；區段不合法回 null，後面各項就判不合格而不是丟錯。
 const E={};for(const n of NAMES){const q=byName[n];if(!rangeOk(q)||!Array.isArray(q.pivot)||q.pivot.length!==3){E[n]=null;continue;}
  const e={y0:Infinity,y1:-Infinity,z0:Infinity,z1:-Infinity,tris:q.count/3,pv:q.pivot};for(let v=q.start;v<q.start+q.count;v++){const y=p.f[v*6+1],z=p.f[v*6+2];e.y0=Math.min(e.y0,y);e.y1=Math.max(e.y1,y);e.z0=Math.min(e.z0,z);e.z1=Math.max(e.z1,z);}E[n]=e;}
 // P2：第二份只把轉軸的 y 取負，z 不變，所以每個零件算一次。
 const basic=['head','hair-short','torso-shirt',...PAIRED],miss2=basic.filter(n=>!E[n]);let z0=Infinity,z1=-Infinity;for(const n of basic)if(E[n]){z0=Math.min(z0,E[n].z0+E[n].pv[2]);z1=Math.max(z1,E[n].z1+E[n].pv[2]);}
 check('P2 基本組合（head、hair-short、torso-shirt，arm、hand、leg、shoe 各兩份）靜止：min z∈[−.02,.02]、max z−min z∈[1.65,1.75]、rig.height∈[1.65,1.75]',
  !miss2.length&&z0>=-.02&&z0<=.02&&z1-z0>=1.65&&z1-z0<=1.75&&rig.height>=1.65&&rig.height<=1.75,{minZ:+z0.toFixed(4),height:+(z1-z0).toFixed(4),rigHeight:rig.height??null,miss:miss2});
 // P3：任一種組合的最大 |y| 就是各非配件零件（成對的兩份都算）最大 |y| 的最大值，所以逐零件驗就等於驗遍所有組合。
 // 另驗成對零件對自己的 xz 平面左右對稱（外框 |y0+y1|≤.01）：第二份不鏡像幾何，不對稱的話另一側的手腳會陷進身體或往外撐，只驗 |y| 上限照不到。
 const wide={},asym={};let maxY=0;for(const n of NAMES.filter(n=>!n.startsWith('acc-'))){const e=E[n];if(!e){wide[n]='缺';continue;}
  const m=Math.max(...(PAIRED.includes(n)?[e.pv[1],-e.pv[1]]:[e.pv[1]]).flatMap(py=>[Math.abs(e.y0+py),Math.abs(e.y1+py)]));maxY=Math.max(maxY,m);if(m>.25)wide[n]=+m.toFixed(4);
  if(PAIRED.includes(n)&&Math.abs(e.y0+e.y1)>.01)asym[n]=[+e.y0.toFixed(4),+e.y1.toFixed(4)];}
 check('P3 任一種組合（配件除外）靜止時最大 |y| ≤.25；成對零件對 xz 平面左右對稱（外框 |y0+y1|≤.01）',!Object.keys(wide).length&&!Object.keys(asym).length,{maxY:+maxY.toFixed(4),wide,asym});
 const T=n=>E[n]?.tris??NaN,big=pre=>Math.max(...NAMES.filter(n=>n.startsWith(pre)).map(T)),worst=T('head')+big('hair-')+big('torso-')+2*PAIRED.reduce((s,n)=>s+T(n),0)+big('acc-');
 check('P4 最壞組合（head＋最大髮型＋最大上身＋2×(arm＋hand＋leg＋shoe)＋最大配件）≤600 三角形',worst<=600,{worst,tris:Object.fromEntries(NAMES.map(n=>[n,T(n)]))});
 let degen=0;const firstBad=[];for(let v=0;v+2<p.count;v+=3){const A=vtx(p,v),ar=Math.hypot(...cross3(sub3(vtx(p,v+1),A),sub3(vtx(p,v+2),A)))/2;if(!(ar>1e-10)){degen++;if(firstBad.length<5)firstBad.push(v);}}
 check('P5 沒有退化三角形（面積 >1e-10）',p.count>0&&p.count%3===0&&degen===0,{triangles:p.count/3,degen,first:firstBad});
 // P6：Task 8 的乘客材質是 three.js 預設的 FrontSide，只畫逆時針（正面）的三角形；Blender 算繪預設兩面都畫，一覽圖照不到繞向反了的零件。
 // (a) 面法向量（依繞向）與三個頂點法向量的和同向：繞向與法向量不一致會缺面或打光反了；(b) 以零件頂點重心算的有號體積 >0：整個零件裡外翻（繞向與法向量一起反）時 (a) 照不到。
 const flip={};for(const n of NAMES){const q=byName[n];if(!rangeOk(q)){flip[n]='缺';continue;}let c=[0,0,0];for(let v=q.start;v<q.start+q.count;v++)for(let k=0;k<3;k++)c[k]+=p.f[v*6+k]/q.count;
  let bad6=0,vol=0;for(let v=q.start;v<q.start+q.count;v+=3){const A=vtx(p,v),B=vtx(p,v+1),C=vtx(p,v+2),fn=cross3(sub3(B,A),sub3(C,A)),vn=[0,1,2].map(k=>p.f[v*6+3+k]+p.f[v*6+9+k]+p.f[v*6+15+k]);
   if(!(dot3(fn,vn)>0))bad6++;vol+=dot3(sub3(A,c),cross3(sub3(B,c),sub3(C,c)))/6;}
  if(bad6||!(vol>0))flip[n]={反向三角形:bad6,有號體積:+vol.toExponential(3)};}
 check('P6 每個零件三角形朝外：面法向量與頂點法向量同向、以重心算的有號體積 >0（FrontSide 只畫正面）',!Object.keys(flip).length,flip);
 // P7～P9 是 Task 7 第二輪收件時加的雙向判準（帳本 Task 7 的 Ruling）。第一輪只量「頭頂有沒有頭髮」「上身頂面平不平」這類單向的數，
 // 第二輪照著數字做，數字全過，結果臉被頭髮整個蓋住、頭浮在上身上方 9 公分、手臂頂端凸出肩線 16 公分。所以每個外觀要求都配一個反方向的量。
 // W(n)＝零件第一份的三角形（頂點＋轉軸，人座標）；BB(n)＝它的外框 [x0,x1,y0,y1,z0,z1]；ray＝Möller–Trumbore，回傳沿 d 最近的距離，沒打到回 Infinity。
 const W=n=>{const q=byName[n],t=[];if(!rangeOk(q)||!Array.isArray(q.pivot)||q.pivot.length!==3)return t;for(let v=q.start;v<q.start+q.count;v+=3)t.push([0,1,2].map(k=>vtx(p,v+k).map((x,i)=>x+q.pivot[i])));return t;};
 const BB=n=>{const b=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];for(const t of W(n))for(const v of t)for(let k=0;k<3;k++){b[2*k]=Math.min(b[2*k],v[k]);b[2*k+1]=Math.max(b[2*k+1],v[k]);}return b;};
 const ray=(o,d,T)=>{let best=Infinity;for(const [a,b,c] of T){const e1=sub3(b,a),e2=sub3(c,a),h=cross3(d,e2),det=dot3(e1,h);if(Math.abs(det)<1e-12)continue;
  const s=sub3(o,a),u=dot3(s,h)/det;if(u<0||u>1)continue;const q=cross3(s,e1),w=dot3(d,q)/det;if(w<0||u+w>1)continue;const t=dot3(e2,q)/det;if(t>1e-9&&t<best)best=t;}return best;};
 // P7：從正面（+X 往 −X）平行射，網格 1 公分。頭頂上 1/3 先打到頭髮 ≥.9；臉部帶（頭寬中間 60%、頭高 15%～55%）先打到頭（皮膚）≥.9；
 // 從正上方往下射，頭頂（以頭外框中心、頭半寬 70% 為半徑的圓內）先打到頭髮 ≥.95。三種髮型都驗。
 // 頭頂那條是第三輪收件加的：頭髮做成繞在頭上半部的一圈、頭頂從髮帽穿出來（像禿頂戴髮帶），正面上 1/3 仍量到 .82，.6 的門檻放過了它。
 // 帽子要罩住三種髮型：帽簷以上的頭髮頂點都在帽子外框內（容差 .005），頭髮不高過帽頂。臉部帶跟著頭的外框走，換頭型不必改數字。
 const H=W('head'),hat=BB('acc-hat'),v7={},p7={};
 if(!H.length||!(hat[0]<hat[1]))p7.缺=['head','acc-hat'].filter(n=>!W(n).length);
 else{const [hx0,hx1,hy0,hy1,Z0,Z1]=BB('head'),Hh=Z1-Z0,Hw=hy1-hy0,Yc=(hy0+hy1)/2,Xc=(hx0+hx1)/2,Rc=.7*Hw/2;
  for(const h of ['hair-short','hair-long','hair-bun']){const R=W(h);if(!R.length){p7[h]='缺';continue;}
   const shoot=(y,z)=>[ray([3,y,z],[-1,0,0],H),ray([3,y,z],[-1,0,0],R)];let n1=0,hair=0,n2=0,skin=0;
   for(let y=Yc-Hw/2;y<=Yc+Hw/2+1e-9;y+=.01)for(let z=Z1-Hh/3;z<=Z1+.05+1e-9;z+=.01){const [a,b]=shoot(y,z);if(a===Infinity&&b===Infinity)continue;n1++;if(b<a)hair++;}
   for(let y=Yc-.3*Hw;y<=Yc+.3*Hw+1e-9;y+=.01)for(let z=Z0+.15*Hh;z<=Z0+.55*Hh+1e-9;z+=.01){const [a,b]=shoot(y,z);if(a===Infinity&&b===Infinity)continue;n2++;if(a<=b)skin++;}
   let n3=0,crown=0;for(let x=Xc-Rc;x<=Xc+Rc+1e-9;x+=.01)for(let y=Yc-Rc;y<=Yc+Rc+1e-9;y+=.01){if(Math.hypot(x-Xc,y-Yc)>Rc)continue;const o=[x,y,Z1+3],a=ray(o,[0,0,-1],H),b=ray(o,[0,0,-1],R);if(a===Infinity&&b===Infinity)continue;n3++;if(b<a)crown++;}
   const hv=R.flat(),out=hv.filter(v=>v[2]>hat[4]+.02&&(v[0]<hat[0]-.005||v[0]>hat[1]+.005||v[1]<hat[2]-.005||v[1]>hat[3]+.005)).length,over=Math.max(...hv.map(v=>v[2]))-hat[5];
   v7[h]={top:+(hair/Math.max(n1,1)).toFixed(3),face:+(skin/Math.max(n2,1)).toFixed(3),crown:+(crown/Math.max(n3,1)).toFixed(3),outHat:out,overHat:+over.toFixed(3)};
   if(!(v7[h].top>=.9&&v7[h].face>=.9&&v7[h].crown>=.95&&out===0&&over<=0))p7[h]=v7[h];}}
 check('P7 正面看：頭頂上 1/3 先打到頭髮 ≥.9、臉部帶（頭寬中間 60%、頭高 15%～55%）先打到皮膚 ≥.9；正上方看：頭頂（頭半寬 70% 的圓內）先打到頭髮 ≥.95；三種髮型都驗；帽子罩住三種髮型（帽簷以上的頭髮在帽子外框內、不高過帽頂）',!Object.keys(p7).length,Object.keys(p7).length?p7:v7);
 // P8：四種上身各驗（只量 +Y 側，P3 已驗左右對稱）。top＝上身頂在中心（往下射）；sh＝肩線＝手臂內緣往內 1 公分處上身頂的高度（打不到＝上身不夠寬）。
 // neck＝頭最低點−top ≤.005（頭坐在上身上）；slope＝top−sh ≥.02（圓肩或斜肩，不是一整片平台）；arm＝手臂頂−sh ∈[−.02,.04]（不凸出成尖角，也不掛在肩線下）；
 // gap＝手臂內緣−上身在手臂上段高度（肩轉軸下 .06～.16）的最大半寬 ≤.005（手臂和上身之間看不到縫）；頭寬 ≥.9×最寬的肩寬（上身在肩轉軸下 .16 到頂之間的最大半寬×2）。
 // 半寬用水平射線量（從 +Y 往 −Y，x 取 −.06～.06 五點、z 每 2 公分），不用頂點：粗網格在那個高度可能一個頂點都沒有，會量成 0。
 const ab=BB('arm'),apv=byName.arm?.pivot,hdb=BB('head'),v8={},p8={};
 if(!Array.isArray(apv)||!(ab[0]<ab[1])||!(hdb[0]<hdb[1]))p8.缺=['arm','head'].filter(n=>!W(n).length);
 else{const armR=Math.max(Math.abs(ab[2]-apv[1]),Math.abs(ab[3]-apv[1])),yIn=apv[1]-armR,sz=apv[2];let maxSW=0;
  const halfAt=(T,z0,z1)=>{let m=0;for(let z=z0;z<=z1+1e-9;z+=.02)for(const x of [-.06,-.03,0,.03,.06]){const u=ray([x,1,z],[0,-1,0],T);if(u!==Infinity)m=Math.max(m,1-u);}return m;};
  for(const t of ['torso-shirt','torso-jacket','torso-hoodie','torso-dress']){const T=W(t);if(!T.length){p8[t]='缺';continue;}
   const topAt=y=>{const u=ray([.001,y,3],[0,0,-1],T);return u===Infinity?null:3-u;},c=topAt(.001),sh=topAt(yIn-.01);
   const half=halfAt(T,sz-.16,sz-.06);maxSW=Math.max(maxSW,2*halfAt(T,sz-.16,c??sz));
   const r=v8[t]={top:c===null?null:+c.toFixed(3),sh:sh===null?null:+sh.toFixed(3),neck:c===null?null:+(hdb[4]-c).toFixed(3),slope:c===null||sh===null?null:+(c-sh).toFixed(3),arm:sh===null?null:+(ab[5]-sh).toFixed(3),gap:+(yIn-half).toFixed(3)};
   if(!(c!==null&&sh!==null&&r.neck<=.005&&r.slope>=.02&&r.arm>=-.02&&r.arm<=.04&&r.gap<=.005))p8[t]=r;}
  v8.head=+((hdb[3]-hdb[2])/Math.max(maxSW,1e-9)).toFixed(3);if(!(v8.head>=.9))p8.head=v8.head;}
 check('P8 頭坐在上身上、圓肩、手臂貼身（四種上身）：頭最低點−上身頂 ≤.005；上身頂−肩線 ≥.02；手臂頂−肩線 ∈[−.02,.04]；手臂與上身之間的縫 ≤.005；頭寬 ≥.9×最寬肩寬',!Object.keys(p8).length,Object.keys(p8).length?p8:v8);
 // P9：Task 8 拖行李箱的變換 T(−.35,−rig.shoulder[1],0)·Ry(.35)（計畫 Task 8）下，箱子最高點（拉桿頂）離右手（hand 第二份）外框中心 ≤.05，箱底著地 min z∈[−.02,.02]。
 const sc=W('acc-suitcase'),hd=byName.hand;let v9=null;
 if(sc.length&&rangeOk(hd)&&Array.isArray(hd.pivot)&&Array.isArray(rig.shoulder)){const c=Math.cos(.35),s=Math.sin(.35),S=sc.flat().map(([x,y,z])=>[x*c+z*s-.35,y-rig.shoulder[1],-x*s+z*c]),top=S.reduce((a,v)=>v[2]>a[2]?v:a);
  const hv=[];for(let v=hd.start;v<hd.start+hd.count;v++){const w=vtx(p,v);hv.push([w[0]+hd.pivot[0],w[1]-hd.pivot[1],w[2]+hd.pivot[2]]);}
  const mid=k=>(Math.min(...hv.map(v=>v[k]))+Math.max(...hv.map(v=>v[k])))/2,hc=[0,1,2].map(mid);
  v9={top:top.map(x=>+x.toFixed(3)),hand:hc.map(x=>+x.toFixed(3)),dist:+Math.hypot(...sub3(top,hc)).toFixed(3),minZ:+Math.min(...S.map(v=>v[2])).toFixed(4)};}
 check('P9 行李箱照 Task 8 的變換 T(−.35,−rig.shoulder[1],0)·Ry(.35) 擺：拉桿頂離右手（hand 第二份）外框中心 ≤.05、箱底 min z∈[−.02,.02]',!!v9&&v9.dist<=.05&&Math.abs(v9.minZ)<=.02,v9??'缺 acc-suitcase／hand／rig.shoulder');
}

// （D、M、P 各段插在這一行之上）
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;

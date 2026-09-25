// 新車模、中間車、集電弓、乘客零件庫的離線判準（不開瀏覽器）。用法：node --no-warnings scripts/verify_garage_stop_assets.mjs [D M P]；不帶參數跑全部。
// 判準定義在 docs/superpowers/plans/2026-09-24-viaduct-stop-doors.md 的 Task 4／5／7；BASE＝改動前的 commit。
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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
function ortho(a,tris,c,dir,half,px){const right=unit3(cross3(dir,[0,0,1])),up=cross3(right,dir),B=.02,nx=Math.ceil(2*half[0]/B),ny=Math.ceil(2*half[1]/B),bins=Array.from({length:nx*ny},()=>[]);
 for(const v of tris){let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;for(let k=0;k<3;k++){const p=sub3(vtx(a,v+k),c),x=dot3(p,right)+half[0],y=half[1]-dot3(p,up);a0=Math.min(a0,x);a1=Math.max(a1,x);b0=Math.min(b0,y);b1=Math.max(b1,y);}
  for(let i=Math.max(0,Math.floor(a0/B));i<=Math.min(nx-1,Math.floor(a1/B));i++)for(let j=Math.max(0,Math.floor(b0/B));j<=Math.min(ny-1,Math.floor(b1/B));j++)bins[j*nx+i].push(v);}
 const out=[],W=Math.round(2*half[0]/px),H=Math.round(2*half[1]/px);
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){const x=(i+.5)*px,y=(j+.5)*px,q=[0,1,2].map(k=>c[k]+right[k]*(x-half[0])+up[k]*(half[1]-y)),o=q.map((v,k)=>v-dir[k]*6),r=cast(a,bins[Math.floor(y/B)*nx+Math.floor(x/B)],o,dir);
  let h=null;if(r){const A=vtx(a,r.v),e1=sub3(vtx(a,r.v+1),A),e2=sub3(vtx(a,r.v+2),A),p=sub3(o.map((v,k)=>v+dir[k]*r.t),A),d00=dot3(e1,e1),d01=dot3(e1,e2),d11=dot3(e2,e2),d20=dot3(p,e1),d21=dot3(p,e2),den=d00*d11-d01*d01,u=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den,wt=[1-u-w,u,w];
   h={t:r.t,g:groupOf(a,r.v).name,front:dot3(cross3(e1,e2),dir)<0,n:unit3([0,1,2].map(k=>wt.reduce((s,wk,m)=>s+wk*a.f[(r.v+m)*6+3+k],0)))};}
  out.push({q,h});}
 return out;}

// D：頭尾車 emu3000 的可動車門（Task 4）。四扇門的結果合併在同一項，D 段固定 12 項。
if(on('D')){const a=load(now,DIR,'emu3000'),o=load(then,DIR,'emu3000');
 const doors=a.meta.doors,items=Array.isArray(doors?.items)?doors.items:[],none='沒有 doors',G=a.meta.mesh.drawGroups,G0=o.meta.mesh.drawGroups;
 // 對每一扇門跑 fn(d,s,cx,w,h,basez)；回傳不合格的門與數值（fn 回 null＝合格）。
 const each=fn=>{const bad=[];for(const d of items){const r=fn(d,d.side,d.center[0],d.width,d.height,d.center[2]-d.height/2);if(r)bad.push({id:d.id,...r});}return bad;};
 // id：+Y 側 L、−Y 側 R；−X 端 1、+X 端 2（Task 6 的 garage-doors.js 依這個格式）。
 const idOk=items.length===4&&items.every(d=>{const end=items.filter(e=>e.side===d.side).sort((x,y)=>x.center[0]-y.center[0]).indexOf(d)+1;return d.id===(d.side===1?'L':'R')+end;});
 check('D1 doors：schema garage-doors-v1、type slide-pocket；4 扇門，每側 2 扇',doors?.schema==='garage-doors-v1'&&doors?.type==='slide-pocket'&&items.length===4&&items.filter(d=>d.side===1).length===2&&items.filter(d=>d.side===-1).length===2&&idOk,doors?{schema:doors.schema,type:doors.type,doors:items.map(d=>[d.id,d.side,d.center?.[0]]),idOk}:none);
 const pairs=[...a.meta.bounds.min.map((v,i)=>[v,o.meta.bounds.min[i]]),...a.meta.bounds.max.map((v,i)=>[v,o.meta.bounds.max[i]]),...a.meta.sizeM.map((v,i)=>[v,o.meta.sizeM[i]])];
 check('D2 bounds、sizeM 與 BASE 各分量差 ≤1e-4',pairs.length===9&&pairs.every(([x,y])=>Math.abs(x-y)<=1e-4),{bounds:a.meta.bounds,sizeM:a.meta.sizeM,base:{bounds:o.meta.bounds,sizeM:o.meta.sizeM}});
 const bad3=G.length!==G0.length?[`個數 ${G.length}≠${G0.length}`]:G.flatMap((g,i)=>{const h=G0[i];return g.name===h.name&&g.lightingRole===h.lightingRole&&g.color.length===h.color.length&&g.color.every((c,k)=>Math.abs(c-h.color[k])<=1e-6)&&g.metalness===h.metalness&&g.roughness===h.roughness&&g.clearcoat===h.clearcoat?[]:[`${i}:${g.name}≠${h.name}`];});
 check('D3 drawGroups 與 BASE 同個數、同順序；名稱、lightingRole、材質值相同',bad3.length===0,bad3);
 const ranges=items.flatMap(d=>(Array.isArray(d.ranges)?d.ranges:[]).map(r=>({id:d.id,...r}))),bad4=[];
 for(const r of ranges){const g=G.find(g=>r.start>=g.start&&r.start+r.count<=g.start+g.count);
  if(!Number.isInteger(r.start)||!Number.isInteger(r.count)||r.start<0||r.count<3||r.count%3||r.start+r.count>a.count)bad4.push([r.id,r.group,'越界或不是 3 的倍數',r.start,r.count]);
  else if(!g||g.name!==r.group)bad4.push([r.id,r.group,'不在同名 drawGroup 內',g?.name??null]);}
 const byStart=[...ranges].sort((x,y)=>x.start-y.start);for(let i=1;i<byStart.length;i++)if(byStart[i].start<byStart[i-1].start+byStart[i-1].count)bad4.push(['重疊',byStart[i-1].id,byStart[i-1].group,byStart[i].id,byStart[i].group]);
 check('D4 ranges：start≥0、count 為 3 的倍數、不越界、互不重疊、完整落在同名 drawGroup 內',items.length>0&&items.every(d=>d.ranges?.length>0)&&bad4.length===0,items.length?{ranges:ranges.length,bad:bad4}:none);
 // 門把凸出門扇到車身最寬處（原車 Y 邊界 1.5155 就是它撐出來的），它跟門扇一起動，所以 range 頂點的外緣上限取 BASE 的車寬＋.01。
 const yOut=Math.max(o.meta.bounds.max[1],-o.meta.bounds.min[1])+.01;
 const bad5=each((d,s,cx,w,h,bz)=>{let out=0,stray=0,eo=null,es=null;
  for(let v=0;v<a.count;v++){const x=a.f[v*6],y=s*a.f[v*6+1],z=a.f[v*6+2];
   if(inRanges(d,v)){if(!(Math.abs(x-cx)<=w/2+.01&&y>=1.44&&y<=yOut&&z>=bz-.01&&z<=bz+h+.01)){out++;eo??=[x,y,z];}}
   // 門扇體積往外算到門把外緣（yOut）：開門後門口前方留下的任何東西（09-25 實例：固定門把）都算在這裡。射線格會從小零件旁邊穿過，頂點不會。
   else if(Math.abs(x-cx)<w/2-.01&&y>1.452&&y<yOut&&z>bz+.01&&z<bz+h-.01){stray++;es??=[x,y,z];}}
  return out||stray?{rangeVertsOutside:out,firstOutside:eo,strayInside:stray,firstStray:es}:null;});
 check('D5 門扇完整：range 內頂點都在門扇外框內，range 外沒有頂點落在門扇內部',items.length>0&&bad5.length===0,items.length?bad5:none);
 const bad6=each((d,s,cx,w,h,bz)=>{const tris=near(a,cx);let miss=0,first=null;
  for(let i=0;i<=6;i++)for(let j=0;j<=14;j++){const x=cx+w*(i/6-.5)*.9,z=bz+h*(.05+.9*j/14),r=cast(a,tris,[x,s*3,z],[0,-s,0]);
   if(!r||!inRanges(d,r.v)){miss++;first??={x,z,hit:r?{t:r.t,group:groupOf(a,r.v)?.name}:null};}}
  return miss?{miss,of:105,first}:null;});
 check('D6 關門完全蓋住門洞：105 條射線第一個命中都是這扇門',items.length>0&&bad6.length===0,items.length?bad6:none);
 // 取樣格與 D6 相同、鋪滿整個門口：只取左右兩直行會漏掉門口中間留下的東西（09-25 實例：原位留了一個固定門把）。
 const bad7=each((d,s,cx,w,h,bz)=>{const tris=near(a,cx),off0=openOffset(d),off=v=>inRanges(d,v)?off0:null;let bad=0,first=null;
  for(let i=0;i<=6;i++)for(let j=0;j<=14;j++){const x=cx+w*(i/6-.5)*.9,z=bz+h*(.05+.9*j/14),r=cast(a,tris,[x,s*3,z],[0,-s,0],off),sy=r?3-r.t:null;
   if(!r||sy<.8||sy>1.44){bad++;first??={x,z,sy,group:r?groupOf(a,r.v)?.name:null};}}
  return bad?{bad,of:105,first}:null;});
 check('D7 全開露出門內：105 條射線都命中門內（s·y 在 .8～1.44）',items.length>0&&bad7.length===0,items.length?bad7:none);
 const th=doors?.threshold;
 const bad8=each((d,s,cx)=>{const r=cast(a,near(a,cx),[cx,s*1.343,3],[0,0,-1]),z=r?3-r.t:null;return z!==null&&Math.abs(z-th)<=.002?null:{z,threshold:th,group:r?groupOf(a,r.v)?.name:null};});
 check('D8 門內地板＝踏板高：往下射第一個命中與 threshold 差 ≤.002，threshold 在 .915～.925',items.length>0&&typeof th==='number'&&th>=.915&&th<=.925&&bad8.length===0,items.length?{threshold:th,bad:bad8}:none);
 const bad9=each((d,s,cx,w,h,bz)=>{const off0=openOffset(d),sig=d.slide[0];let outside=0,firstY=null;
  for(let v=0;v<a.count;v++)if(inRanges(d,v)){const y=s*(a.f[v*6+1]+off0[1]);if(y<1.29||y>1.40){outside++;firstY??=y;}}
  const tris=near(a,cx).filter(v=>!inRanges(d,v));let blocked=0,first=null;
  for(const y0 of [1.316,1.326,1.336])for(const f of [.1,.3,.5,.7,.9]){const o0=[cx-sig*(w/2-.02),s*y0,bz+h*f],r=cast(a,tris,o0,[sig,0,0],null,w+d.travel-.02);
   if(r){blocked++;first??={y0,z:o0[2],t:r.t,group:groupOf(a,r.v)?.name};}}
  return outside||blocked?{vertsOutsidePocket:outside,firstY,blocked,of:15,first}:null;});
 check('D9 壁袋收得下：全開門扇 s·y 在 1.29～1.40，滑動路徑上沒有別的三角形',items.length>0&&bad9.length===0,items.length?bad9:none);
 const tri=a.count/3,tri0=o.count/3;
 check('D10 三角形數 ≤ BASE＋6000',tri<=tri0+6000&&a.meta.mesh.triangleCount===tri,{now:tri,meta:a.meta.mesh.triangleCount,base:tri0,limit:tri0+6000});
 const win=G.filter(g=>g.lightingRole==='window');
 const bad11=each((d,s,cx)=>{let n=0;for(const g of win)for(let v=g.start;v<g.start+g.count;v+=3){let ok=true;
   for(let k=0;k<3;k++){const x=a.f[(v+k)*6],y=s*a.f[(v+k)*6+1],z=a.f[(v+k)*6+2];if(!(y>=.875&&y<=1.425&&z>=2.9&&z<=3.13&&Math.abs(x-cx)<=.5)){ok=false;break;}}if(ok)n++;}
  return n>=2?null:{lampTris:n};});
 check('D11 門內頂燈：每扇門 ≥2 個 window 角色三角形在門廳天花板',items.length>0&&win.length>0&&bad11.length===0,items.length?bad11:none);
 // D12：門口以外的外觀跟 BASE 一模一樣。09-25 實例：門廳盒子的外側平板做在 |y| 1.425（車殼外表面），在車殼上下圓弧處凸出 3～8 cm（底部一整條橡膠、頂部一片車身），
 // 在平直處跟車殼共面（框條與車身搶深度＝閃爍黑線）；重建時車頭折線的法向量被抹平（整片側板變漸層）——D1～D11 全綠照不到。
 // 正面＋前後各一個斜角，6 mm 一格；射線穿過 s·y=1.44 平面的點落在門洞外擴 6 cm 以內的不比（門扇、門框、門內本來就會變），其餘每一格都要跟 BASE：
 // 同樣有沒有命中、同群組、距離差 ≤3 mm、同正反面、插值法向量夾角 ≤12°。
 // 外擴 6 cm＝門框環寬 4 cm（到門中心 .3525）＋斜角視差：環比原門框板內縮 6 mm（1.446 對 1.452，看不出來、允許），斜射時命中點會橫移約 7 mm。
 const dirs={正面:s=>[0,-s,0],前斜:s=>unit3([-.5,-s*.85,-.15]),後斜:s=>unit3([.5,-s*.85,-.15])};
 const bad12=each((d,s,cx,w,h,bz)=>{const c=[cx,s*1.44,2.15],tA=near(a,cx,3),tO=near(o,cx,3),first=[],kinds={};let n=0;
  for(const [name,f] of Object.entries(dirs)){const dir=f(s),A=ortho(a,tA,c,dir,[1.4,1.35],.006),O=ortho(o,tO,c,dir,[1.4,1.35],.006);
   for(let i=0;i<A.length;i++){const {q,h:x}=A[i],y=O[i].h,lam=(1.44-s*q[1])/(s*dir[1]),pc=q.map((v,k)=>v+dir[k]*lam);
    if(Math.abs(pc[0]-cx)<=w/2+.06&&pc[2]>=bz-.06&&pc[2]<=bz+h+.06)continue;
    const k=!x!==!y?'有無命中':!x?null:x.g!==y.g?'群組':Math.abs(x.t-y.t)>.003?'深度':x.front!==y.front?'正反面':Math.acos(Math.max(-1,Math.min(1,dot3(x.n,y.n))))>12*Math.PI/180?'法向量':null;
    if(!k)continue;n++;kinds[k]=(kinds[k]||0)+1;
    if(first.length<4)first.push({dir:name,dx:+(pc[0]-cx).toFixed(3),z:+pc[2].toFixed(3),k,now:x&&{g:x.g,sy:+(s*(q[1]+dir[1]*(x.t-6))).toFixed(3)},base:y&&{g:y.g,sy:+(s*(q[1]+dir[1]*(y.t-6))).toFixed(3)}});}}
  return n?{diffPx:n,kinds,first}:null;});
 check('D12 門口以外的外觀與 BASE 相同：正面＋兩個斜角光線追蹤，群組、深度、正反面、法向量逐格一致',items.length>0&&bad12.length===0,items.length?bad12:none);
 for(const b of bad12)console.log('   D12',b.id,JSON.stringify({diffPx:b.diffPx,kinds:b.kinds}),JSON.stringify(b.first));   // check() 的明細只印 400 字，四扇門看不全
}

// （D、M、P 各段插在這一行之上）
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;

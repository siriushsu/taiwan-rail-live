// 乘客與配件不穿出車殼：給 verify_garage_stop_node.mjs T8（probe 的車門）與 verify_garage_viaduct_stop.mjs S13（頁面量到的車門）用。
// 車門座標系（車模公尺）：u＝沿車身往車廂中心（從門中心量）、w＝離車中心線的距離（門扇中心面 1.466、車殼外表面約 1.425）、z＝高度（門檻 .915）。
// 劇本座標換到車模同 T8 的可見性檢查：u＝a/scale＋du、w＝1.466−(e/scale＋dv)、z＝.921＋走路起伏＋零件高度。
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
export const OPENING={half:.3175,z0:.915,z1:3.125};
// 正式車模頭車與中間車、每一側車門全開時的三角形（車模座標）：每扇門一筆 {id,dd,T,n}，T 每個三角形 9 個數。dir＝車模資料夾的 URL。
export function openDoorCars(dir){const cars=[];
 for(const id of ['emu3000','emu3000-mid']){const m=JSON.parse(readFileSync(new URL(id+'.json',dir),'utf8')),g=gunzipSync(readFileSync(new URL(m.mesh.file,dir))),f=new Float32Array(g.buffer,g.byteOffset,g.byteLength/4);
  const n=m.mesh.vertexCount/3,inR=(x,v)=>x.ranges.some(r=>v>=r.start&&v<r.start+r.count);
  for(const s of [1,-1]){const own=m.doors.items.filter(x=>x.side===s),T=new Float64Array(n*9);
   for(let v=0;v<n*3;v++){const o=own.find(x=>inR(x,v));for(let j=0;j<3;j++)T[v*3+j]=f[v*6+j]+(o?o.inward[j]+o.slide[j]*o.travel:0);}
   for(const dd of own)cars.push({id,dd,T,n});}}
 return cars;}
// 在給定的停站車門上，用正式零件庫與畫面每幀用的 posePerson 跑下面的判準；另回傳沒量到的角色×配件×車門方向（miss）。
export async function clipOnDoors({doors,platform,timetable,stops=30,dt=.02}){
 const R3=new URL('../../rail-3d/',import.meta.url),plan=await import(new URL('garage-people-plan.js',R3).href),{buildGarageParts}=await import(new URL('garage-parts.js',R3).href),{posePerson}=await import(new URL('garage-people.js',R3).href);
 const pm=JSON.parse(readFileSync(new URL('assets/garage-people-v1/people.json',R3),'utf8')),gz=gunzipSync(readFileSync(new URL('assets/garage-people-v1/people.bin.gz',R3)));
 const kit=buildGarageParts(pm,gz.buffer.slice(gz.byteOffset,gz.byteOffset+gz.byteLength)),scale=1.25/JSON.parse(readFileSync(new URL('assets/garage-blender-v1/emu3000.json',R3),'utf8')).sizeM[1];
 const r=peopleClip({plan,pose:(q,v,t)=>posePerson(q,v,t,v.heading,kit,scale),kit,skins:skinFields(openDoorCars(new URL('assets/garage-blender-v1/',R3))),doors,platform,timetable,scale,stops,dt}),miss=[];
 for(const role of ['alight','board'])for(const acc of ['none','backpack','handbag','hat','suitcase'])for(const g of ['+','-'])if(!(r.groups[role+'/'+acc+'/'+g]?.inCar>0))miss.push(role+'/'+acc+'/'+g);
 kit.dispose();return{...r,miss};}
// 車殼外表面高度場：每扇門附近 u、z 每 0.02 一格，從車外水平往車內看，第一個碰到的面（任何群組，s·y>1.2）的 s·y；
// 碰不到（車端以外、門洞裡）記 NaN。cars＝[{id,dd,T,n}]，T＝門全開時的三角形座標（每個三角形 9 個數）。
export function skinFields(cars,{u0=-1.2,u1=2.4,z0=.84,z1=3.26,step=.02}={}){
 const nu=Math.round((u1-u0)/step)+1,nz=Math.round((z1-z0)/step)+1;
 return cars.map(({id,dd,T,n})=>{
  const s=dd.side,sig=Math.sign(dd.slide[0]),cx=dd.center[0],F=new Float32Array(nu*nz).fill(NaN);
  const xa=cx+sig*u0,xb=cx+sig*u1,xlo=Math.min(xa,xb)-step,xhi=Math.max(xa,xb)+step,cand=[];
  for(let t=0;t<n;t++){const o=t*9;if(Math.max(T[o],T[o+3],T[o+6])<xlo||Math.min(T[o],T[o+3],T[o+6])>xhi)continue;if(Math.max(s*T[o+1],s*T[o+4],s*T[o+7])<=1.2)continue;cand.push(t);}
  for(let i=0;i<nu;i++){const x=cx+sig*(u0+i*step);
   for(const t of cand){const o=t*9,ax=T[o],az=T[o+2],bx=T[o+3],bz=T[o+5],qx=T[o+6],qz=T[o+8];
    if(x<Math.min(ax,bx,qx)||x>Math.max(ax,bx,qx))continue;
    const det=(bx-ax)*(qz-az)-(qx-ax)*(bz-az);if(Math.abs(det)<1e-14)continue;
    const zhi=Math.max(az,bz,qz);
    for(let j=Math.max(0,Math.ceil((Math.min(az,bz,qz)-z0)/step-1e-9));j<nz;j++){const z=z0+j*step;if(z>zhi+1e-12)break;
     const l1=((x-ax)*(qz-az)-(qx-ax)*(z-az))/det,l2=((bx-ax)*(z-az)-(x-ax)*(bz-az))/det;if(l1<-1e-9||l2<-1e-9||l1+l2>1+1e-9)continue;
     const y=s*(T[o+1]+l1*(T[o+4]-T[o+1])+l2*(T[o+7]-T[o+1]));if(y<=1.2)continue;
     const k=i*nz+j;if(!(F[k]>=y))F[k]=y;}}}
  return{id,door:dd.id,F,nu,nz,u0,z0,step};});
}
// 點在車門座標系的哪一邊：門洞裡（O）、車殼內（I）、車殼外或車端以外（E）；d＝w−車殼（車端以外 NaN）。取最近的格。
function side(S,u,w,z){
 if(Math.abs(u)<=OPENING.half&&z>=OPENING.z0&&z<=OPENING.z1)return[0,NaN];
 const i=Math.round((u-S.u0)/S.step),j=Math.round((Math.min(Math.max(z,S.z0),S.z0+(S.nz-1)*S.step)-S.z0)/S.step),k=i>=0&&i<S.nu?S.F[i*S.nz+j]:NaN;
 return k===k?[w<k?1:2,w-k]:[2,NaN];
}
// 每位上下車者（不含不搭車的人）在 stops 站內、每 dt 秒，人的中心離自家門扇中心面往月台不到 near（世界單位）或已在車內時，
// 用畫法模組的真實姿勢（pose(q,v,t) 回傳 personPose 格式）把每個零件換到每一扇門的座標系：車殼是高度場 w＝skin(u,z)，
// 零件任何一條邊在門洞（|u|≤.3175、z .915～3.125）以外跨過車殼（一邊在內、一邊在外；每 1 公分取一點），這個零件就穿殼了。
// 嚴重度＝min(外側最遠, 內側最深)，超過 tol 才算（貼著車殼滑過不算）。車端以外（沒有車殼資料）算車外，所以穿出車端也抓得到。
// 同時量跳動：朝向每 dt 的變化（turn）、行李箱外框 8 個角每 dt 的位移（caseStep，車模公尺），以及位移裡人自己轉身與平移解釋不了的部分
//（caseJump＝角的位移 −（這一步轉的角度 × 那一角離人中心的水平距離 ＋ 人中心的位移）；箱子被人拖著一起轉不算跳）。
// 只記從月台看得到的範圍：人的中心往車內不到 visible（.24＝門廳後牆那條線，再往裡只剩隔間後的走道，從門口看不到腿和箱子）。
export function peopleClip({plan,pose,kit,skins,doors,platform,timetable,scale,stops=20,dt=.02,near=-.25,tol=.01,visible=.24}){
 const out=Math.sign(platform.outer-platform.edge),V=new Map();
 for(const [name,p]of kit.parts){const a=p.geometry.getAttribute('position'),f=new Float64Array(a.count*3);for(let i=0;i<a.count;i++){f[i*3]=a.getX(i);f[i*3+1]=a.getY(i);f[i*3+2]=a.getZ(i);}
  const E=[];for(let t=0;t<a.count;t+=3)for(const [i,j]of [[t,t+1],[t+1,t+2],[t+2,t]])E.push(i,j,Math.max(1,Math.ceil(Math.hypot(f[i*3]-f[j*3],f[i*3+1]-f[j*3+1],f[i*3+2]-f[j*3+2])*1.06/.01)));
  V.set(name,{f,E:Int32Array.from(E),n:a.count});}
 const groups=new Map(),bad=[];let samples=0,turn={step:0},caseStep={step:0},caseJump={step:-Infinity};
 const U=new Float64Array(4096),Wv=new Float64Array(4096),Z=new Float64Array(4096);
 for(let n=0;n<stops;n++)for(const q of plan.planStop(n,{timetable,doors,platform}).people){if(q.role==='idle')continue;
  const fd=doors.find(d=>d.id===q.door),key=q.role+'/'+(q.look.accessory??'none')+'/'+(fd.inboard>0?'+':'-');
  const g=groups.get(key)??groups.set(key,{people:0,samples:0,inCar:0,bad:0,max:0}).get(key);g.people++;
  let prevHeading=null,prevCase=null,prevRoot=null;
  for(let t=q.appear;t<q.vanish;t+=dt){const v=plan.personAt(q,t);if(!v){prevHeading=prevCase=null;continue;}
   const parts=pose(q,v,t),a=(v.x-fd.x)*fd.inboard,e=(fd.y-v.y)*out,seen=e<=visible,ls=v.look.scale,c=Math.cos(v.heading),sn=Math.sin(v.heading);
   const dh=prevHeading===null?0:Math.abs(Math.atan2(Math.sin(v.heading-prevHeading),Math.cos(v.heading-prevHeading)));
   if(prevHeading!==null&&seen&&dh>turn.step)turn={step:dh,id:q.id,t:+t.toFixed(3),x:+v.x.toFixed(3),y:+v.y.toFixed(3)};
   prevHeading=v.heading;
   // 行李箱跳動：箱子零件外框 8 個角的世界位置（換成車模公尺）。
   const cs=parts.find(p=>p.name==='acc-suitcase');
   if(cs){const b=kit.parts.get('acc-suitcase').geometry.boundingBox,m=cs.matrix.elements,pts=[];
    for(const X of [b.min.x,b.max.x])for(const Y of [b.min.y,b.max.y])for(const Zc of [b.min.z,b.max.z]){
     const lx=(m[0]*X+m[4]*Y+m[8]*Zc+m[12])*ls,ly=(m[1]*X+m[5]*Y+m[9]*Zc+m[13])*ls,lz=(m[2]*X+m[6]*Y+m[10]*Zc+m[14])*ls;pts.push([v.x/scale+c*lx-sn*ly,v.y/scale+sn*lx+c*ly,lz]);}
    const rx=v.x/scale,ry=v.y/scale;
    if(prevCase&&seen){const dr=Math.hypot(rx-prevRoot[0],ry-prevRoot[1]);let d=0,x=-Infinity;
     for(let k=0;k<8;k++){const m=Math.hypot(pts[k][0]-prevCase[k][0],pts[k][1]-prevCase[k][1],pts[k][2]-prevCase[k][2]),R=Math.max(Math.hypot(pts[k][0]-rx,pts[k][1]-ry),Math.hypot(prevCase[k][0]-prevRoot[0],prevCase[k][1]-prevRoot[1]));
      d=Math.max(d,m);x=Math.max(x,m-(dh*R+dr));}
     if(d>caseStep.step)caseStep={step:d,id:q.id,t:+t.toFixed(3)};if(x>caseJump.step)caseJump={step:x,id:q.id,t:+t.toFixed(3)};}
    prevCase=pts;prevRoot=[rx,ry];}else prevCase=null;
   if(e<near)continue;samples++;g.samples++;if(e>0)g.inCar++;
   const f0=fd.inboard*c,f1=-out*sn,l0=-fd.inboard*sn,l1=-out*c,ua=a/scale,we=1.466-e/scale;
   const bob=v.walking&&v.pose!=='sit'?.015*Math.abs(Math.sin(v.stride/(.25*ls)*Math.PI))/scale:0;
   let worst=null;
   for(const pe of parts){const {f,E,n}=V.get(pe.name),m=pe.matrix.elements;
    for(let i=0;i<n;i++){const x=f[i*3],y=f[i*3+1],z=f[i*3+2],lx=(m[0]*x+m[4]*y+m[8]*z+m[12])*ls,ly=(m[1]*x+m[5]*y+m[9]*z+m[13])*ls;
     U[i]=ua+lx*f0+ly*l0;Wv[i]=we-(lx*f1+ly*l1);Z[i]=.921+bob+(m[2]*x+m[6]*y+m[10]*z+m[14])*ls;}
    for(const S of skins){let cross=null,outMax=0,inMax=0;
     for(let i=0;i<n;i++){const [k,d]=side(S,U[i],Wv[i],Z[i]);if(k===1)inMax=Math.max(inMax,-d);else if(k===2)outMax=Math.max(outMax,d===d?d:Infinity);}
     if(!outMax||!inMax)continue;
     for(let k=0;k<E.length&&!cross;k+=3){const i=E[k],j=E[k+1],steps=E[k+2];let prev=0;
      for(let s=0;s<=steps;s++){const r=s/steps,uu=U[i]+(U[j]-U[i])*r,ww=Wv[i]+(Wv[j]-Wv[i])*r,zz=Z[i]+(Z[j]-Z[i])*r,[cl]=side(S,uu,ww,zz);
       if(cl&&prev&&cl!==prev){cross={u:+uu.toFixed(3),w:+ww.toFixed(3),z:+zz.toFixed(3)};break;}if(cl)prev=cl;else prev=0;}}
     if(!cross)continue;const sev=Math.min(outMax,inMax);
     if(!worst||sev>worst.sev)worst={sev,car:S.id,door:S.door,part:pe.name,out:+Math.min(outMax,9).toFixed(3),in:+inMax.toFixed(3),...cross};}}
   const sev=worst?worst.sev:0;g.max=Math.max(g.max,sev);
   if(sev>tol){g.bad++;if(bad.length<3000)bad.push({id:q.id,role:q.role,acc:q.look.accessory,inboard:fd.inboard,t:+t.toFixed(3),a:+a.toFixed(3),e:+e.toFixed(3),...worst,sev:+Math.min(sev,9).toFixed(4)});}}}
 return{samples,groups:Object.fromEntries([...groups].sort()),bad,turn,caseStep,caseJump};
}

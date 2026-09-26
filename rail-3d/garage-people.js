// 月台乘客的畫法：每個零件一個 InstancedMesh（全部共用一個材質），每幀照劇本擺位置與姿勢。劇本（誰、何時、走哪條路）在 garage-people-plan.js。
import * as THREE from './vendor/three.module.js';
import {planStop,personAt,idlePeople} from './garage-people-plan.js';
const CAP=24,PULL=.4;
// 一個人各零件在「人的座標系」（面向 +X、左手 +Y、腳底 z=0，車模單位）裡的變換 T(pivot′)·R；第二份零件的 pivot y 取負，幾何不鏡像。
// 走路擺動 φ＝stride/(.25·look.scale)·π：腿、鞋 Ry(±.45 sin φ)，手臂、手、手提包與同側腿反相 Ry(∓.35 sin φ)；站著、坐著不擺。坐姿的腿、鞋 Ry(−π/2)。
// 拉行李箱的人：右手固定往後 Ry(PULL)、不隨步伐擺，箱子跟著手往後拖 reach·sin(PULL)。計畫原本的擺法會讓右腳往後擺時穿進箱子、右手離開拉桿（帳本 Task 8 的 Ruling）。
// out 可傳入上一次的陣列重用（每幀不配置新物件）；回傳 [{name,copy,matrix}]。
export function personPose(v,kit,out=[]){
 const {look}=v,sit=v.pose==='sit',swing=v.walking?Math.sin(v.stride/(.25*look.scale)*Math.PI):0,pull=look.accessory==='suitcase';
 let n=0;
 const put=(name,copy,ry,at)=>{const p=at??kit.parts.get(name).pivot,e=out[n]??(out[n]={name:'',copy:0,matrix:new THREE.Matrix4()});n++;
  e.name=name;e.copy=copy;e.matrix.makeRotationY(ry).setPosition(p[0],copy?-p[1]:p[1],p[2]);};
 put('head',0,0);put('hair-'+look.hair,0,0);put('torso-'+look.torso,0,0);
 for(const c of [0,1]){const sgn=c?-1:1,leg=sit?-Math.PI/2:sgn*.45*swing,arm=pull&&c?PULL:-sgn*.35*swing;
  put('leg',c,leg);put('shoe',c,leg);put('arm',c,arm);put('hand',c,arm);}
 if(look.accessory==='suitcase'){const b=kit.parts.get('hand').geometry.boundingBox,reach=-(b.min.z+b.max.z)/2;
  put('acc-suitcase',0,.35,[-.35-reach*Math.sin(PULL),-kit.rig.shoulder[1],0]);}
 else if(look.accessory)put('acc-'+look.accessory,0,look.accessory==='handbag'?-.35*swing:0);
 out.length=n;return out;
}
const hash=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return h;};
export function createPeople({kit,timetable,doors,platform,scale,seed=20260924}){
 const group=new THREE.Group();group.name='garage-people';
 const material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.78}),meshes=new Map();
 for(const [name,part]of kit.parts){const m=new THREE.InstancedMesh(part.geometry,material,CAP*part.perPerson);
  m.name='people-'+name;m.castShadow=false;m.receiveShadow=false;m.frustumCulled=false;m.count=0;m.visible=false;
  meshes.set(name,{mesh:m,part,tris:part.geometry.getAttribute('position').count/3,n:0});group.add(m);}
 const shadowGeometry=new THREE.CircleGeometry(.16,12),shadowMaterial=new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.22,depthWrite:false});
 const shadow=new THREE.InstancedMesh(shadowGeometry,shadowMaterial,CAP),shadowTris=shadowGeometry.index.count/3;
 shadow.name='people-shadow';shadow.castShadow=false;shadow.receiveShadow=false;shadow.frustumCulled=false;shadow.count=0;shadow.visible=false;group.add(shadow);
 const ctx={timetable,doors,platform,seed},cache=new Map(),idle=idlePeople(platform,seed);
 const plan=n=>{if(!cache.has(n))cache.set(n,planStop(n,ctx));return cache.get(n);};
 const out=Math.sign(platform.outer-platform.edge),depth=y=>(y-platform.edge)*out;
 const state={visible:true,onPlatform:0,boarding:0,alighting:0,stop:0,drawCalls:0,triangles:0};
 const root=new THREE.Matrix4(),rz=new THREE.Matrix4(),sm=new THREE.Matrix4(),world=new THREE.Matrix4(),color=new THREE.Color(),pose=[];
 function finish(){let calls=0,tris=0;
  for(const e of meshes.values()){const m=e.mesh;m.count=e.n;m.visible=e.n>0;if(e.n){calls++;tris+=e.n*e.tris;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}
  shadow.visible=shadow.count>0;if(shadow.count){calls++;tris+=shadow.count*shadowTris;shadow.instanceMatrix.needsUpdate=true;}
  state.drawCalls=calls;state.triangles=tris;}
 function update(t){
  for(const e of meshes.values())e.n=0;shadow.count=0;
  if(!state.visible){state.onPlatform=state.boarding=state.alighting=0;finish();return;}
  const n=Math.floor(t/timetable.lap);for(const k of cache.keys())if(k<n-2)cache.delete(k);
  const who=[];
  for(const q of [...[n-1,n,n+1].filter(k=>k>=0).flatMap(k=>plan(k).people),...idle]){if(who.length===CAP)break;const v=personAt(q,t);if(v)who.push([q,v]);}
  let on=0,boarding=0,alighting=0;
  for(const [q,v]of who){const {look}=v,s=scale*look.scale,sit=v.pose==='sit';
   if(depth(v.y)>=0)on++;if(q.role==='board'&&t>=q.boardAt)boarding++;if(q.role==='alight')alighting++;
   let z0=platform.top,heading=v.heading;
   if(sit){const bench=platform.benches.reduce((a,b)=>Math.abs(b.x-v.x)<Math.abs(a.x-v.x)?b:a);z0=bench.seat-kit.rig.hip[2]*s;}
   else if(v.walking)z0+=.015*Math.abs(Math.sin(v.stride/(.25*look.scale)*Math.PI));
   else heading+=.03*Math.sin(.8*t+hash(v.id)*.001);
   root.makeTranslation(v.x,v.y,z0).multiply(rz.makeRotationZ(heading)).multiply(sm.makeScale(s,s,s));
   for(const p of personPose(v,kit,pose)){const e=meshes.get(p.name),{part}=e;
    world.multiplyMatrices(root,p.matrix);e.mesh.setMatrixAt(e.n,world);
    if(part.tint==='fixed')color.setRGB(part.color[0],part.color[1],part.color[2]);else color.set(part.tint==='hair'?look.hairColor:look[part.tint]);
    e.mesh.setColorAt(e.n,color);e.n++;}
   shadow.setMatrixAt(shadow.count++,world.makeScale(look.scale,look.scale,1).setPosition(v.x,v.y,platform.top+.003));}
  Object.assign(state,{onPlatform:on,boarding,alighting,stop:n});finish();
 }
 return{group,update,plan,state,
  setVisible(v){state.visible=v;group.visible=v;},
  dispose(){kit.dispose();material.dispose();shadowGeometry.dispose();shadowMaterial.dispose();}};
}

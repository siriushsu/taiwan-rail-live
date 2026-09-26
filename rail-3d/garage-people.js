// 月台乘客的畫法：每個零件一個 InstancedMesh（全部共用一個材質），每幀照劇本擺位置與姿勢。劇本（誰、何時、走哪條路）在 garage-people-plan.js。
import * as THREE from './vendor/three.module.js';
import {planStop,personAt,idlePeople,trailPoint} from './garage-people-plan.js';
const CAP=24,PULL=.4,ROD=.35,UP_TILT=.08,LEG_MARGIN=.03,CLAMP_FLAT=60*Math.PI/180,CLAMP_UP=48*Math.PI/180;
const rz0=new THREE.Matrix4(),cm=new THREE.Matrix4(),cv=new THREE.Vector3();
const handReach=kit=>{const b=kit.parts.get('hand').geometry.boundingBox;return-(b.min.z+b.max.z)/2;};
// 行李箱前傾 tilt 時：拉桿頂（箱子零件本地 x .03、z 最高點）離輪子的水平 rodX、垂直 rodZ，箱尾在輪子後方 back（箱子零件原點是輪子）。
const caseGeom=(kit,tilt)=>{const b=kit.parts.get('acc-suitcase').geometry.boundingBox;return{rodX:.03*Math.cos(tilt)+b.max.z*Math.sin(tilt),rodZ:-.03*Math.sin(tilt)+b.max.z*Math.cos(tilt),back:-b.min.x*Math.cos(tilt)};};
function suitcaseTrail(kit){return ROD+handReach(kit)*Math.sin(PULL);}
// 行李箱兩種拿法，m（＝v.tuck）在兩者間內插：月台上斜拖（前傾 .35、輪子離肩膀 suitcaseTrail）；門檻以內與車內立起來貼在身後
//（前傾 UP_TILT，輪子離肩膀＝手臂自然下垂剛好握到拉桿頂的距離）。
function caseMode(kit,m){const tilt=.35+(UP_TILT-.35)*m,g=caseGeom(kit,tilt),up=caseGeom(kit,UP_TILT),H=handReach(kit);
 const teUp=H*Math.sqrt(Math.max(0,1-((kit.rig.shoulder[2]-up.rodZ)/H)**2))+up.rodX;return{tilt,te:suitcaseTrail(kit)*(1-m)+teUp*m,back:g.back,rodX:g.rodX};}
// 腿往後擺最多幾度才碰不到箱子：箱子頂點在腿的左右範圍（|y|≤.25）、髖部以下的，腿當半徑 .075 的柱子繞髖部轉，留 LEG_MARGIN。
function legRoom(kit,m4){const a=kit.parts.get('acc-suitcase').geometry.getAttribute('position'),hip=kit.rig.hip[2],r=.075;let A=Infinity;
 for(let i=0;i<a.count;i++){cv.set(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(m4);if(Math.abs(cv.y)>.25||cv.z>hip)continue;
  const d=hip-cv.z,R=Math.hypot(d,r),need=-cv.x-LEG_MARGIN;A=Math.min(A,Math.max(0,need<=r?0:need>=R?Math.PI/2:Math.asin(need/R)-Math.atan2(r,d)));}
 return A;}
// 一個人各零件在「人的座標系」（面向 +X、左手 +Y、腳底 z=0，車模單位）裡的變換 T(pivot′)·Rz(yaw)·Ry；第二份零件的 pivot y 取負，幾何不鏡像。
// 走路擺動 φ＝stride/(.25·look.scale)·π：腿、鞋 Ry(±.45·k·sin φ)，手臂、手、手提包與同側腿反相 Ry(∓.35·k·sin φ)；k＝v.step（轉身時縮小）；
// 站著、坐著不擺。坐姿的腿、鞋 Ry(−π/2)。手提包：v.tuck＝1（門檻以內與車內）時繞肩膀轉到身前、左手不擺，過門不掃到門邊的車殼。
// 拉行李箱：v.hand 那隻手（1＝左、其餘＝右）握拉桿頂、不隨步伐擺；輪子在 v.wheel（人的座標系，suitcaseWheel 沿走過的路算；沒有就當一直直走），
// 箱子繞 z 轉到朝握把那側肩膀、再前傾（caseMode）。箱子太靠近腿時縮小步幅（legRoom），腿往後擺不碰到箱子（帳本 Task 8 的注意、Task 9 的 Ruling）。
// out 可傳入上一次的陣列重用（每幀不配置新物件）；回傳 [{name,copy,matrix}]。
export function personPose(v,kit,out=[]){
 const {look}=v,sit=v.pose==='sit',pull=look.accessory==='suitcase',tuck=look.accessory==='handbag'?v.tuck??0:0,sh=kit.rig.shoulder[1],hand=v.hand===1?0:1,hs=hand?-1:1;
 let wheel=null,toWheel=0,pitch=0,tilt=.35,cap=1;
 if(pull){const md=caseMode(kit,v.tuck??0),L=md.te+md.back;tilt=md.tilt;wheel=v.wheel??[-md.te*Math.sqrt(1-(sh/L)**2),hs*sh*(1-md.te/L)];
  toWheel=Math.atan2(wheel[1]-hs*sh,wheel[0]);pitch=Math.asin(Math.min(1,Math.max(0,(Math.hypot(wheel[0],wheel[1]-hs*sh)-md.rodX)/handReach(kit))));
  if(!sit)cap=Math.min(1,legRoom(kit,cm.makeRotationY(tilt).premultiply(rz0.makeRotationZ(toWheel+Math.PI)).setPosition(wheel[0],wheel[1],0))/.45);}
 const swing=v.walking?Math.min(v.step??1,cap)*Math.sin(v.stride/(.25*look.scale)*Math.PI):0;
 let n=0;
 const put=(name,copy,ry,at,yaw=0)=>{const p=at??kit.parts.get(name).pivot,e=out[n]??(out[n]={name:'',copy:0,matrix:new THREE.Matrix4()});n++;
  e.name=name;e.copy=copy;e.matrix.makeRotationY(ry);if(yaw)e.matrix.premultiply(rz0.makeRotationZ(yaw));e.matrix.setPosition(p[0],copy?-p[1]:p[1],p[2]);};
 put('head',0,0);put('hair-'+look.hair,0,0);put('torso-'+look.torso,0,0);
 for(const c of [0,1]){const sgn=c?-1:1,leg=sit?-Math.PI/2:sgn*.45*swing,held=pull&&c===hand,arm=held?pitch:-sgn*.35*swing*(c?1:1-tuck),yaw=held?toWheel-Math.PI:0;
  put('leg',c,leg);put('shoe',c,leg);put('arm',c,arm,undefined,yaw);put('hand',c,arm,undefined,yaw);}
 if(pull)put('acc-suitcase',0,tilt,[wheel[0],wheel[1],0],toWheel+Math.PI);
 else if(look.accessory)put('acc-'+look.accessory,0,look.accessory==='handbag'?-.35*swing*(1-tuck):0,undefined,-tuck*Math.PI/2);
 out.length=n;return out;
}
// 行李箱輪子在人的座標系的位置。箱尾落在走過的路上：往回弧長 √(L²−肩寬²)（L＝輪子離肩膀＋箱長，直走時箱尾剛好在路上），
// 拉桿從握把那側肩膀指向那一點。門檻以內路轉得急、那一點太近時，輪子離肩膀縮短（最短到拉桿頂的水平距離），箱尾才不會掃到門邊；
// 月台上不縮短（縮短後拉桿變陡，會穿過握把那側的大腿）。拉桿往身體另一側最多偏 CLAMP（月台上 60°，門檻以內 48°，照 v.tuck 內插），
// 轉身時箱子不甩到另一隻腳旁邊。實測範圍：月台上 75° 起會碰到腳；門檻以內 44° 箱尾掃到門邊的車殼、52° 碰到腳（帳本 Task 9 的 Ruling）。
function suitcaseWheel(q,t,v,heading,kit,scale){
 const s=scale*v.look.scale,h=kit.rig.shoulder[1],sh=(v.hand===1?1:-1)*h,c=Math.cos(heading),sn=Math.sin(heading),S=[v.x-sn*sh*s,v.y+c*sh*s];
 const m=v.tuck??0,md=caseMode(kit,m),L=md.te+md.back,[bx,by]=trailPoint(q,t,Math.sqrt(L*L-h*h)*s),dx=bx-S[0],dy=by-S[1],n=Math.hypot(dx,dy);
 if(n<1e-9)return null;
 const te=md.te*(1-m)+Math.min(md.te,Math.max(Math.min(md.rodX,md.te),n/s-md.back))*m,g=Math.sign(sh),lim=CLAMP_FLAT*(1-m)+CLAMP_UP*m;
 let px=(c*dx+sn*dy)/n,py=(-sn*dx+c*dy)/n;if(Math.atan2(-g*py,-px)>lim){px=-Math.cos(lim);py=-g*Math.sin(lim);}
 return[px*te,sh+py*te];
}
// 擺一個人：畫面每幀與驗收（verify_garage_stop_node.mjs T8）共用這個入口；拉行李箱的先沿走過的路算輪子位置。
export function posePerson(q,v,t,heading,kit,scale,out){if(v.look.accessory==='suitcase')v.wheel=suitcaseWheel(q,t,v,heading,kit,scale);return personPose(v,kit,out);}
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
   for(const p of posePerson(q,v,t,heading,kit,scale,pose)){const e=meshes.get(p.name),{part}=e;
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

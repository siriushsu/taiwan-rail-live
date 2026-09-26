// 高架停站開門：不需要瀏覽器的判準（時刻表、月台幾何、車門與集電弓數學、乘客劇本不變式）。
// 用法：node scripts/verify_garage_stop_node.mjs [T1|T2|T6|T8 …]；不帶參數跑全部。
import {readFileSync} from 'node:fs';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {createScene} from '../rail-3d/garage-scenes/viaduct.js';
import {createStopTimetable} from '../rail-3d/garage-scenes/stop-timetable.js';
const want=new Set(process.argv.slice(2)),on=k=>!want.size||want.has(k);
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,400));}
const probe=createScene(),L=probe.path.length,SPEED=2.1,tt=createStopTimetable({pathLength:L,speed:SPEED}),P=tt.phases;
const asset=JSON.parse(readFileSync(new URL('../rail-3d/assets/garage-blender-v1/emu3000.json',import.meta.url),'utf8'));
const scale=1.25/asset.sizeM[1];

if(on('T1')){
 check('T1 一圈約 80.6 秒',Math.abs(tt.lap-80.63)<.02,{lap:tt.lap});
 {let prev=tt.at(0),back=0,jump=0,dv=0,doorsMoving=0,worst=0;
  for(let t=.01;t<=3*tt.lap;t+=.01){const s=tt.at(t),step=s.distance-prev.distance;if(step<-1e-9)back++;worst=Math.max(worst,step);if(step>SPEED*.01+1e-9)jump++;if(Math.abs(s.speed-prev.speed)>SPEED/5*.01+1e-9)dv++;if(s.doors>0&&s.speed!==0)doorsMoving++;prev=s;}
  check('T1 三圈位置不倒退、不跳、速度連續',back===0&&jump===0&&dv===0,{back,jump,dv,worst});
  check('T1 門只在速度 0 時開',doorsMoving===0,{doorsMoving});}
 for(const n of [0,1,7]){const s=tt.at(n*tt.lap+P.brake+1),m=((s.distance%L)+L)%L,err=Math.min(m,L-m);check('T1 第 '+n+' 圈停在月台中心',s.phase==='stopped'&&err<.01,{err});}
 check('T1 關好 0.5 秒後才起步',P.departAt-P.closeEnd>=.5-1e-9&&tt.at(P.closeEnd).doors===0&&tt.at(P.departAt-1e-6).doors===0,P);
 check('T1 上下車可用時間約 7.7 秒',Math.abs(P.closeStart-P.openEnd-7.7)<1e-9,{window:P.closeStart-P.openEnd});
 check('T1 展示時刻門全開',tt.at(tt.showcase).doors===1,{showcase:tt.showcase});
 const cruise=P.cruiseAt+10,brake=tt.lap*2+2,dwell=tt.lap*3+12,accel=P.departAt+2;
 check('T1 看月台：巡航中跳到下一次減速起點',tt.lookTime(cruise)===tt.lap&&tt.at(tt.lookTime(cruise)).phase==='braking',{to:tt.lookTime(cruise)});
 check('T1 看月台：減速、停站中不跳；出站加速中跳下一圈',tt.lookTime(brake)===brake&&tt.lookTime(dwell)===dwell&&tt.lookTime(accel)===tt.lap,{accel:tt.lookTime(accel)});
 check('T1 看月台連按兩次不再跳',tt.lookTime(tt.lookTime(cruise))===tt.lookTime(cruise));
 {let worst=0;for(let i=0;i<200;i++){const s=i/200*L,t=tt.timeAtPosition(s),m=((tt.at(t).distance-s)%L+L)%L;worst=Math.max(worst,Math.min(m,L-m));}check('T1 timeAtPosition 往返誤差 <1e-6',worst<1e-6,{worst});}
 {const a=tt.at(10800.3),k=Math.floor(10800.3/tt.lap),b=tt.at(10800.3-k*tt.lap),m=((a.distance-b.distance)%L+L)%L;check('T1 長跑 3 小時同一圈位置一致',a.phase===b.phase&&Math.abs(a.local-b.local)<1e-6&&Math.min(m,L-m)<1e-6&&a.doors===b.doors,{a:a.local,b:b.local});}
}

if(on('T2')){
 const pf=probe.platform,railTop=probe.path.sample(0).z,threshold=asset.doors?.threshold??.921;
 const M=new THREE.Matrix4(),pos=new THREE.Vector3(),rot=new THREE.Quaternion(),scl=new THREE.Vector3(),inst=[];
 for(const o of probe.group.children)if(o.isInstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,M);M.decompose(pos,rot,scl);inst.push({m:o.material.name||'',x:pos.x,y:pos.y,z:pos.z,sx:scl.x,sy:scl.y,sz:scl.z});}
 const slab=inst.find(b=>b.m==='concrete'&&Math.abs(b.sx-probe.params.platformLength)<1e-6&&b.sy>3);
 const bridge=inst.find(b=>b.m==='concrete'&&b.x>pf.bridge.x0&&b.x<pf.bridge.x1&&b.y<pf.outer&&b.y>pf.hutFront);
 check('T2 月台方塊內緣＝platform.edge、外緣＝platform.outer、頂面＝platform.top',slab&&Math.abs(slab.y+slab.sy/2-pf.edge)<1e-6&&Math.abs(slab.y-slab.sy/2-pf.outer)<1e-6&&Math.abs(slab.z+slab.sz/2-pf.top)<1e-6,slab);
 check('T2 車身側面到月台邊間隙 0.03～0.1（車身半寬由車模尺寸推得）',Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale>=.03&&Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale<=.1,{gap:Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale});
 check('T2 月台面與車門踏板高度差 <0.01',Math.abs(pf.top-(railTop+threshold*scale))<.01,{top:pf.top,sill:railTop+threshold*scale,threshold});
 check('T2 天橋面與月台面齊平（<0.01）且接上月台外緣',bridge&&Math.abs(bridge.z+bridge.sz/2-pf.top)<.01&&Math.abs(bridge.y-bridge.sy/2-pf.hutFront)<1e-6&&Math.abs(bridge.y+bridge.sy/2-pf.outer)<1e-6,bridge);
 const yellow=inst.filter(b=>Math.abs(b.sy-.16)<1e-6&&Math.abs(b.sz-.03)<1e-6);
 check('T2 黃線在新月台邊內側 0.12、貼在月台面上',yellow.length===1&&Math.abs(yellow[0].y-(pf.edge-.12))<1e-6&&Math.abs(yellow[0].z-(pf.top+.01))<1e-6,yellow);
 const box=probe.canopyBox;
 check('T2 雨棚外框：在接觸線之上、不伸過月台邊（範圍不往內加長）',box.min.z>probe.contactWireZ+.5&&box.max.y<pf.edge-1.5,{min:box.min,max:box.max,wire:probe.contactWireZ});
 const mats=[...new Set(probe.group.children.filter(o=>o.isInstancedMesh&&/^canopy-/.test(o.material.name)).map(o=>o.material))];
 const ver=()=>mats.map(m=>m.version).join(',');
 const v0=ver();probe.setCanopyOpacity(.25);const faded=mats.every(m=>m.transparent&&!m.depthWrite&&m.opacity===.25),v1=ver();
 probe.setCanopyOpacity(.5);const v2=ver();probe.setCanopyOpacity(1);const solid=mats.every(m=>!m.transparent&&m.depthWrite&&m.opacity===1),v3=ver();
 check('T2 雨棚四種材質一起淡；只有跨過不透明的那一下才重編 shader',mats.length===4&&faded&&solid&&v0!==v1&&v1===v2&&v2!==v3&&probe.canopyOpacity===1,{names:mats.map(m=>m.name),faded,solid});
 const shadowless=probe.group.children.filter(o=>o.isInstancedMesh&&['canopy-beam','canopy-lamp'].includes(o.material.name));
 check('T2 雨棚樑與燈板不投影',shadowless.length===2&&shadowless.every(o=>!o.castShadow),shadowless.map(o=>[o.material.name,o.castShadow]));
}

if(on('T6')){
 const {doorOffset,buildDoorIndex,platformSide,INWARD_SHARE,createDoorControl}=await import('../rail-3d/garage-doors.js');
 const {pantographPose,buildGarageParts,createPantograph}=await import('../rail-3d/garage-parts.js');
 const door={id:'L1',side:1,inward:[0,-.14,0],slide:[1,0,0],travel:.66,center:[-4.2,1.466,2.02],ranges:[{start:3,count:6}]};
 const c0=doorOffset(door,0),c1=doorOffset(door,1),ci=doorOffset(door,INWARD_SHARE);
 check('T6 關門零位移',c0.every(v=>Math.abs(v)<1e-12),c0);
 check('T6 內退完成時只內退、還沒滑',Math.abs(ci[1]+.14)<1e-12&&Math.abs(ci[0])<1e-12,ci);
 check('T6 全開＝內退＋整個行程',Math.abs(c1[0]-.66)<1e-12&&Math.abs(c1[1]+.14)<1e-12,c1);
 {let prev=doorOffset(door,0),mono=true;for(let i=1;i<=300;i++){const d=doorOffset(door,i/300);if(d[0]<prev[0]-1e-12||d[1]>prev[1]+1e-12)mono=false;prev=d;}check('T6 開門過程單調（先退後滑）',mono);}
 check('T6 門索引：區段內是門號，其餘 0',[...buildDoorIndex(12,[door,{...door,id:'L2',ranges:[{start:9,count:2}]}])].join(',')==='0,0,0,1,1,1,1,1,1,2,2,0');
 let threw=0;try{buildDoorIndex(12,[door,{...door,id:'X',ranges:[{start:8,count:2}]}]);}catch{threw++;}try{buildDoorIndex(5,[door]);}catch{threw++;}
 check('T6 重疊或越界的區段丟錯',threw===2,{threw});
 const q=new THREE.Quaternion(),n=new THREE.Vector3(0,-1,0);
 check('T6 車頭朝 +x：車模 −Y 面向 y<0 的月台',platformSide(q,n)===-1);
 q.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);
 check('T6 反向連掛（轉 180°）：車模 +Y 面向月台',platformSide(q,n)===1);
 // 假車：12 個頂點、兩個材質（一個共用、一個車燈模組做的複本）、兩扇門分在兩側。
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(36),3));
 const shared=new THREE.MeshStandardMaterial(),windowMat=new THREE.MeshStandardMaterial(),lit=windowMat.clone();
 const far={...door,id:'R1',side:-1,inward:[0,.14,0],slide:[-1,0,0],center:[4.2,-1.466,2.02],ranges:[{start:9,count:2}]};
 const body=new THREE.Mesh(g,[shared,lit]),carGroup=new THREE.Group();carGroup.add(body);
 const fake={id:'emu3000',car:carGroup,body,litMaterials:[shared,lit],asset:{geometry:g,materials:[shared,windowMat],doors:{items:[door,far]}}};
 const ctl=createDoorControl([fake]);
 check('T6 共用材質換成每節車自己的複本、車燈複本原地沿用',fake.litMaterials[0]!==shared&&fake.litMaterials[1]===lit&&body.material===fake.litMaterials);
 const stub=()=>({uniforms:{},vertexShader:'#include <common>\nvoid main(){\n#include <begin_vertex>\n}'}),s0=stub(),s1=stub(),sd=stub();
 fake.litMaterials[0].onBeforeCompile(s0);fake.litMaterials[1].onBeforeCompile(s1);body.customDepthMaterial.onBeforeCompile(sd);
 check('T6 著色器加上門索引與位移、三個材質共用這節車的 uniform',s0.vertexShader.includes('attribute float doorIndex')&&s0.vertexShader.includes('doorOffsets[door-1]')&&s0.uniforms.doorOffsets===s1.uniforms.doorOffsets&&s0.uniforms.doorOffsets===sd.uniforms.doorOffsets);
 check('T6 深度材質與快取鍵',body.customDepthMaterial?.isMeshDepthMaterial&&fake.litMaterials.every(m=>m.customProgramCacheKey()==='garage-doors-v1')&&body.customDepthMaterial.customProgramCacheKey()==='garage-doors-v1');
 check('T6 doorIndex 屬性一個頂點一個值',g.getAttribute('doorIndex')?.count===12);
 carGroup.updateMatrixWorld(true);ctl.update(1,n);const offs=s0.uniforms.doorOffsets.value;
 check('T6 只開月台那一側（另一側零位移）',offs[0].length()===0&&Math.abs(offs[1].x+.66)<1e-12&&Math.abs(offs[1].y-.14)<1e-12,offs.slice(0,2));
 check('T6 月台側門中心取的是面向月台那一扇',JSON.stringify(ctl.points('platform').map(p=>p.id))==='["emu3000:R1"]'&&ctl.points('platform')[0].point.x===4.2);
 ctl.update(0,n);check('T6 門開度 0 時全部歸零',offs.every(o=>o.length()===0));
 ctl.dispose();
 const rig={lower:1.10,upper:.81,headRise:.052};
 const up=pantographPose(rig,.88);
 check('T6 升弓貼到目標高度',up.reached&&Math.abs(up.head[1]-.88)<1e-9,up.head);
 check('T6 弓頭 x 固定＝lower−upper',Math.abs(up.head[0]-(rig.lower-rig.upper))<1e-9,up.head);
 check('T6 肘在 +x、高於車頂',up.elbow[0]>0&&up.elbow[1]>0,up.elbow);
 const down=pantographPose(rig,null);
 check('T6 降弓兩臂攤平',Math.abs(down.lowerAngle)<1e-6&&Math.abs(Math.abs(down.upperAngle)-Math.PI)<1e-6,down);
 const farPose=pantographPose(rig,5);
 check('T6 目標超出臂長時 reached=false（不假裝貼線）',!farPose.reached&&farPose.head[1]<5,farPose.head);
 {let prev=pantographPose(rig,.052),worst=0;for(let i=1;i<=400;i++){const p=pantographPose(rig,.052+i/400*1.8);worst=Math.max(worst,Math.abs(p.lowerAngle-prev.lowerAngle),Math.abs(p.upperAngle-prev.upperAngle));prev=p;}check('T6 升降過程角度連續（不翻面）',worst<.2,{worst});}
 // 假零件庫：四個零件各一個三角形。組起來的接觸點世界座標要等於 IK 算的弓頭，弓頭保持水平。
 const names=['base','lower','upper','head'],buf=new Float32Array(names.length*3*6);
 const kit=buildGarageParts({schema:'garage-parts-v1',mesh:{vertexCount:names.length*3},parts:names.map((name,i)=>({name,start:i*3,count:3,color:[.5,.5,.5]})),rig},buf.buffer);
 const panto=createPantograph(kit);let worst=0,tilt=0;
 for(const target of [null,.4,.88,1.5]){const p=panto.pose(target);panto.root.updateMatrixWorld(true);const w=new THREE.Vector3().setFromMatrixPosition(panto.contact.matrixWorld),hq=new THREE.Quaternion();panto.contact.getWorldQuaternion(hq);
  worst=Math.max(worst,Math.abs(w.x-p.head[0]),Math.abs(w.z-p.head[1]),Math.abs(w.y));tilt=Math.max(tilt,2*Math.acos(Math.min(1,Math.abs(hq.w))));}
 check('T6 集電弓組裝：接觸點＝IK 弓頭、弓頭水平',worst<1e-9&&tilt<1e-6,{worst,tilt});
 let bad=0;try{buildGarageParts({schema:'garage-parts-v0',mesh:{vertexCount:12},parts:[]},buf.buffer);}catch{bad++;}try{buildGarageParts({schema:'garage-parts-v1',mesh:{vertexCount:12},parts:[{name:'x',start:10,count:3}]},buf.buffer);}catch{bad++;}
 check('T6 零件庫格式不符或區段越界丟錯',bad===2,{bad});
 panto.dispose();kit.dispose();
 // 門廳透光（設計書 §9「開門時門內透光」）：頂燈藏在門楣後、鏡頭一律俯看看不到它，three.js 的自發光也不照亮別的面；
 // 所以門洞後方、車殼內側的三角形跟著這節車的窗燈（window 發光角色）一起亮。門扇、車殼外側、門洞以外、門楣以上不亮。
 {const {buildDoorGlow}=await import('../rail-3d/garage-doors.js');
  const tri=(x,y,z)=>[x,y,z,x+.01,y,z,x,y,z+.01];
  const P=new Float32Array([...tri(-4.2,1.2,2),...tri(-4.2,1.45,2),...tri(-3,1.2,2),...tri(-4.2,1.2,2),...tri(-4.2,-1.2,2),...tri(-4.2,1.2,3.4),...tri(-4.2,-1.2,2)]);
  const gd=[{id:'L1',side:1,center:[-4.2,1.466,2.02],width:.625,height:2.2,inward:[0,-.14,0],slide:[1,0,0],travel:.66,ranges:[{start:9,count:3}]},{id:'R1',side:-1,center:[-4.2,-1.466,2.02],width:.625,height:2.2,inward:[0,.14,0],slide:[1,0,0],travel:.66,ranges:[{start:18,count:3}]}];
  const pos=new THREE.Float32BufferAttribute(P,3),glow=buildDoorGlow(pos,gd,buildDoorIndex(21,gd));
  check('T6 門廳透光：門洞後方車殼內側＝1；車殼外側、門洞以外、門扇、門楣以上＝0',[...glow].join(',')==='1,1,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0',[...glow].join(','));
  const g2=new THREE.BufferGeometry();g2.setAttribute('position',pos);
  const plain=new THREE.MeshStandardMaterial(),win=new THREE.MeshStandardMaterial();win.userData.railLightingRole='window';const winLit=win.clone();winLit.emissive.setRGB(1,.5,.25);winLit.emissiveIntensity=.5;
  const body2=new THREE.Mesh(g2,[plain,winLit]),car2=new THREE.Group();car2.add(body2);
  const fake2={id:'emu3000',car:car2,body:body2,litMaterials:[plain,winLit],asset:{geometry:g2,materials:[plain,win],doors:{items:gd}}};
  const ctl2=createDoorControl([fake2]),f0={uniforms:{},vertexShader:'#include <common>\nvoid main(){\n#include <begin_vertex>\n}',fragmentShader:'#include <common>\nvoid main(){\n#include <emissivemap_fragment>\n}'};
  fake2.litMaterials[0].onBeforeCompile(f0);car2.updateMatrixWorld(true);ctl2.update(0,n);
  const want=new THREE.Color(.5,.25,.125),got=f0.uniforms.doorGlowColor?.value;
  check('T6 門廳透光：著色器把 doorGlow 加進自發光，顏色＝這節車窗燈的 emissive×強度',g2.getAttribute('doorGlow')?.count===21&&f0.vertexShader.includes('vDoorGlow=doorGlow')&&f0.fragmentShader.includes('totalEmissiveRadiance+=doorGlowColor*vDoorGlow')&&!!got&&Math.abs(got.r-want.r)+Math.abs(got.g-want.g)+Math.abs(got.b-want.b)<1e-9,{got});
  winLit.emissiveIntensity=0;ctl2.update(0,n);
  check('T6 門廳透光：窗燈熄了（白天）門廳也不亮',!!got&&got.r===0&&got.g===0&&got.b===0,{got});
  ctl2.dispose();
 }
}

if(on('T8')){
 const plan=await import('../rail-3d/garage-people-plan.js'),{peopleInvariants,peopleChecks}=await import('./lib/people_invariants.mjs');
 const pf=probe.platform,cars=[-4.2,0,4.2],doorY=pf.trackY-1.443*scale;
 const doors=[-5.93,-2.47,-1.61,1.61,2.47,5.93].map((x,i)=>({id:'d'+i,x,y:doorY,inboard:Math.sign(cars.reduce((a,c)=>Math.abs(c-x)<Math.abs(a-x)?c:a)-x)}));
 const v=peopleInvariants({plan,timetable:tt,doors,platform:pf,stops:60});
 for(const [name,pass,detail]of peopleChecks(v,plan.PEOPLE.spacing))check('T8 '+name,pass,detail);
 // 樓梯口小屋的門洞：上車者從門洞中線走出來，下車者走進去時整個人在門洞寬度內（不穿牆）。
 const M=new THREE.Matrix4(),pos=new THREE.Vector3(),rot=new THREE.Quaternion(),scl=new THREE.Vector3();let hole=null;
 for(const o of probe.group.children)if(o.isInstancedMesh&&o.material.name==='hut-doorway'){o.getMatrixAt(0,M);M.decompose(pos,rot,scl);hole={x:pos.x,half:scl.x/2};}
 const p0=plan.planStop(0,{timetable:tt,doors,platform:pf}),R=plan.PEOPLE.radius;
 const exits=p0.people.filter(q=>q.role!=='idle').map(q=>q.role==='board'?q.keys[0].x:q.keys[q.keys.length-1].x);
 check('T8 乘客都從樓梯口小屋的門洞進出（不穿牆）',hole&&exits.every(x=>Math.abs(x-hole.x)<=hole.half-R),{hole,exits});
 // 拉行李箱的人（帳本 Task 8 的注意與 Ruling）：箱子照計畫擺在右後方 T(−.35,−shoulder.y,0)·Ry(.35)；計畫的腿擺幅 .45 讓右腳往後擺時穿進箱子，
 // 右手照計畫前後擺也會離開拉桿。用正式零件庫幾何、畫法模組的真實擺法走完一個步伐週期（64 格）：
 // 腿與鞋的三角形不碰箱子（另把腿往箱子那側多推 0.02 當餘裕）、右手外框中心離拉桿頂（箱子最高點，同 P9 的量法）≤.05、腳掌仍前後擺 ≥.1。
 // 正向對照：同一個偵測器套計畫原本的擺法（箱子 T(−.35,−shoulder.y,0)·Ry(.35)、右腿往後 Ry(.45)）必須抓到相交，證明偵測器分得出穿與不穿。
 {const {gunzipSync}=await import('node:zlib'),{buildGarageParts}=await import('../rail-3d/garage-parts.js'),{personPose,posePerson}=await import('../rail-3d/garage-people.js');
  const pm=JSON.parse(readFileSync(new URL('../rail-3d/assets/garage-people-v1/people.json',import.meta.url),'utf8')),gz=gunzipSync(readFileSync(new URL('../rail-3d/assets/garage-people-v1/people.bin.gz',import.meta.url)));
  const kit=buildGarageParts(pm,gz.buffer.slice(gz.byteOffset,gz.byteOffset+gz.byteLength));
  const tris=(name,m,shift=0)=>{const a=kit.parts.get(name).geometry.getAttribute('position'),out=[];for(let i=0;i<a.count;i+=3)out.push([0,1,2].map(k=>new THREE.Vector3(a.getX(i+k),a.getY(i+k),a.getZ(i+k)).applyMatrix4(m).add(new THREE.Vector3(shift,0,0))));return out;};
  const ray=new THREE.Ray(),hitP=new THREE.Vector3(),dir=new THREE.Vector3(),box=t=>new THREE.Box3().setFromPoints(t);
  const edgeHit=(P,T)=>{for(let k=0;k<3;k++){const p=P[k],len=dir.subVectors(P[(k+1)%3],p).length();if(len<1e-12)continue;ray.set(p,dir.multiplyScalar(1/len));if(ray.intersectTriangle(T[0],T[1],T[2],false,hitP)&&hitP.distanceTo(p)<=len)return true;}return false;};
  const hits=(A,B)=>{let n=0;const bb=B.map(box);for(const a of A){const ab=box(a);for(let j=0;j<B.length;j++)if(ab.intersectsBox(bb[j])&&(edgeHit(a,B[j])||edgeHit(B[j],a)))n++;}return n;};
  const look={torso:'shirt',hair:'short',accessory:'suitcase',top:'#6f8fa8',bottom:'#3d4450',hairColor:'#2b2320',skin:'#e9c8a8',accent:'#c9463d',scale:1};
  let collide=0,margin=0,far=0,footMin=Infinity,footMax=-Infinity;
  for(let k=0;k<64;k++){const pose=personPose({id:'suitcase',walking:true,stride:k/64*.5,pose:'stand',look},kit),get=(n,c=0)=>pose.find(e=>e.name===n&&e.copy===c)?.matrix;
   const cs=tris('acc-suitcase',get('acc-suitcase')),top=cs.flat().reduce((a,v)=>v.z>a.z?v:a),hand=box(tris('hand',get('hand',1)).flat()).getCenter(new THREE.Vector3());
   const legs=c=>[...tris('leg',get('leg',c)),...tris('shoe',get('shoe',c))];
   collide+=hits([...legs(0),...legs(1)],cs);margin+=hits([...legs(0),...legs(1)].map(t=>t.map(v=>v.clone().add(new THREE.Vector3(-.02,0,0)))),cs);far=Math.max(far,hand.distanceTo(top));
   const foot=box(tris('shoe',get('shoe',1)).flat());footMin=Math.min(footMin,foot.min.x);footMax=Math.max(footMax,foot.min.x);}
  const planLeg=new THREE.Matrix4().makeTranslation(...kit.parts.get('leg').pivot.map((v,i)=>i===1?-v:v)).multiply(new THREE.Matrix4().makeRotationY(.45));
  const planCase=new THREE.Matrix4().makeTranslation(-.35,-kit.rig.shoulder[1],0).multiply(new THREE.Matrix4().makeRotationY(.35)),control=hits([...tris('leg',planLeg),...tris('shoe',planLeg)],tris('acc-suitcase',planCase));
  const pose0=personPose({id:'suitcase',walking:false,stride:0,pose:'stand',look},kit),caseMinZ=Math.min(...tris('acc-suitcase',pose0.find(e=>e.name==='acc-suitcase').matrix).flat().map(v=>v.z));
  check('T8 拉行李箱的人走路：腳與鞋不穿進箱子（含 0.02 餘裕）、右手一直握在拉桿頂（≤.05）、箱底著地（±.02）、腳掌仍前後擺 ≥.1；對照組（計畫原擺法）抓得到相交',collide===0&&margin===0&&far<=.05&&Math.abs(caseMinZ)<=.02&&footMax-footMin>=.1&&control>0,{collide,margin,handToTop:+far.toFixed(4),caseMinZ:+caseMinZ.toFixed(4),footSwing:+(footMax-footMin).toFixed(3),control});
  // 上車者消失、下車者出現的那一刻，從自家門洞看不到人（設計書 §10「被車身擋住後隱藏」）。09-26 門洞打通之後才量得到：
  // 之前門洞被封板擋住，人在門內任何地方消失都「看不到」。人用外框估：所有髮型、上身、配件、四個步伐相位擺出來的零件外框聯集
  // （乘上大人最大縮放 1.06），外框表面取樣點連到自家門洞外口 7×12 點；正式車模頭車、中間車各 4 扇門（那一側兩扇全開）都要每條線段先碰到車模。
  // 劇本座標換到車模：沿車身往車廂中心＝u、往車內＝v，v 從門扇中心面 |y|=1.466 量（T8 的門面取 1.443，這樣換偏淺 2 cm，偏保守）。
  // 拉行李箱的人：箱子沿走過的路拖在後面，不一定在外框裡，那一刻的真實箱子外框表面另外取點加進去。
  {const E=new THREE.Box3(),lk=(accessory,hair,torso)=>({torso,hair,accessory,top:'#fff',bottom:'#fff',hairColor:'#fff',skin:'#fff',accent:'#fff',scale:1});
   for(const acc of [null,'backpack','suitcase','handbag','hat'])for(const [hair,torso]of [['short','shirt'],['long','jacket'],['bun','hoodie'],['short','dress']])for(const stride of [0,.0625,.125,.1875,.375,-1]){
    for(const e of personPose({id:'env',walking:stride>=0,stride:Math.max(0,stride),pose:'stand',look:lk(acc,hair,torso)},kit))E.union(kit.parts.get(e.name).geometry.boundingBox.clone().applyMatrix4(e.matrix));}
   E.min.multiplyScalar(1.06);E.max.multiplyScalar(1.06);
   const body=[];for(let i=0;i<=5;i++)for(let j=0;j<=3;j++)for(let k=0;k<=6;k++)if(i%5===0||j%3===0||k%6===0)body.push([E.min.x+(E.max.x-E.min.x)*i/5,E.min.y+(E.max.y-E.min.y)*j/3,E.min.z+(E.max.z-E.min.z)*k/6]);
   const cars=[];for(const id of ['emu3000','emu3000-mid']){const m=JSON.parse(readFileSync(new URL(`../rail-3d/assets/garage-blender-v1/${id}.json`,import.meta.url),'utf8')),g=gunzipSync(readFileSync(new URL('../rail-3d/assets/garage-blender-v1/'+m.mesh.file,import.meta.url))),f=new Float32Array(g.buffer,g.byteOffset,g.byteLength/4);
    const n=m.mesh.vertexCount/3,inR=(x,v)=>x.ranges.some(r=>v>=r.start&&v<r.start+r.count);
    for(const s of [1,-1]){const own=m.doors.items.filter(x=>x.side===s),T=new Float64Array(n*9);
     for(let v=0;v<n*3;v++){const o=own.find(x=>inR(x,v));for(let j=0;j<3;j++)T[v*3+j]=f[v*6+j]+(o?o.inward[j]+o.slide[j]*o.travel:0);}
     for(const dd of own)cars.push({id,dd,T,n});}}
   const blocked=(T,idx,p,q)=>{const dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2],L=Math.hypot(dx,dy,dz),d0=dx/L,d1=dy/L,d2=dz/L;
    for(const t of idx){const o=t*9,ax=T[o],ay=T[o+1],az=T[o+2],e1x=T[o+3]-ax,e1y=T[o+4]-ay,e1z=T[o+5]-az,e2x=T[o+6]-ax,e2y=T[o+7]-ay,e2z=T[o+8]-az;
     const px=d1*e2z-d2*e2y,py=d2*e2x-d0*e2z,pz=d0*e2y-d1*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-12)continue;
     const inv=1/det,sx=p[0]-ax,sy=p[1]-ay,sz=p[2]-az,u=(sx*px+sy*py+sz*pz)*inv;if(u<-1e-9||u>1+1e-9)continue;
     const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,w=(d0*qx+d1*qy+d2*qz)*inv;if(w<-1e-9||u+w>1+1e-9)continue;
     const h=(e2x*qx+e2y*qy+e2z*qz)*inv;if(h>1e-4&&h<L-1e-4)return true;}
    return false;};
   const out=Math.sign(pf.outer-pf.edge),states=new Map();
   for(let n=0;n<10;n++)for(const q of plan.planStop(n,{timetable:tt,doors,platform:pf}).people){if(q.role==='idle')continue;
    const tq=q.role==='board'?q.vanish-1e-6:q.appear,st=plan.personAt(q,tq),fd=doors.find(d=>d.id===q.door),a=(st.x-fd.x)*fd.inboard,e=(fd.y-st.y)*out,extra=[];
    if(q.look.accessory==='suitcase'){const cs=posePerson(q,st,tq,st.heading,kit,scale).find(p=>p.name==='acc-suitcase'),B=kit.parts.get('acc-suitcase').geometry.boundingBox.clone().applyMatrix4(cs.matrix),ls=q.look.scale;
     for(let i=0;i<=3;i++)for(let j=0;j<=3;j++)for(let k=0;k<=3;k++)if(i%3===0||j%3===0||k%3===0)extra.push([(B.min.x+(B.max.x-B.min.x)*i/3)*ls,(B.min.y+(B.max.y-B.min.y)*j/3)*ls,(B.min.z+(B.max.z-B.min.z)*k/3)*ls]);}
    // 人的前方（本地 +X）與左方（本地 +Y）換到門的座標系：u＝沿車身往車廂中心、v＝往車內。
    const c=Math.cos(st.heading),s=Math.sin(st.heading),fwd=[fd.inboard*c,-out*s],left=[-fd.inboard*s,-out*c];
    const key=[q.role,a,e,...fwd,...left,extra.length?q.id:''].map(v=>typeof v==='number'?v.toFixed(3):v).join();
    if(!states.has(key))states.set(key,{role:q.role,id:q.id,a,e,fwd,left,extra});}
   const seen=[];let cases=0;
   for(const s0 of states.values())for(const {id,dd,T,n}of cars){cases++;const s=dd.side,sig=Math.sign(dd.slide[0]),cx=dd.center[0];
    // 車模 x＝cx+sig·u、y＝s·(1.466−v)。
    const P=[...body,...s0.extra].map(([x,y,z])=>{const du=x*s0.fwd[0]+y*s0.left[0],dv=x*s0.fwd[1]+y*s0.left[1];return[cx+sig*(s0.a/scale+du),s*(1.466-(s0.e/scale+dv)),.921+z];});
    const Q=[];for(let i=0;i<=6;i++)for(let j=0;j<=11;j++)Q.push([cx+.635*(i/6-.5)*.98,s*1.48,.915+2.21*(.02+.96*j/11)]);
    const lo=[0,1,2].map(k=>Math.min(...P.map(p=>p[k]),...Q.map(p=>p[k]))-.01),hi=[0,1,2].map(k=>Math.max(...P.map(p=>p[k]),...Q.map(p=>p[k]))+.01),idx=[];
    for(let t=0;t<n;t++){const o=t*9;let ok=true;for(let k=0;k<3&&ok;k++){const a0=T[o+k],a1=T[o+3+k],a2=T[o+6+k];if(Math.max(a0,a1,a2)<lo[k]||Math.min(a0,a1,a2)>hi[k])ok=false;}if(ok)idx.push(t);}
    const c=[cx,s*1.44,2.02],dist=t=>{let d=0;for(let k=0;k<3;k++){const m=(T[t*9+k]+T[t*9+3+k]+T[t*9+6+k])/3-c[k];d+=m*m;}return d;};idx.sort((x,y)=>dist(x)-dist(y));
    let hit=null;for(const p of P){for(const q of Q)if(!blocked(T,idx,p,q)){hit={p:p.map(v=>+v.toFixed(3)),q:q.map(v=>+v.toFixed(3))};break;}if(hit)break;}
    if(hit)seen.push({role:s0.role,person:s0.id,car:id,door:dd.id,along:+s0.a.toFixed(3),deep:+s0.e.toFixed(3),...hit});}
   check('T8 上車者消失、下車者出現的那一刻，從自家門洞看不到人（正式車模頭車與中間車 8 扇門，人以所有外型與步伐的外框估）',states.size>0&&seen.length===0,{states:states.size,cases,visible:seen.length,envelope:[E.min,E.max].map(v=>[v.x,v.y,v.z].map(n=>+n.toFixed(3))),first:seen.slice(0,3)});
   // 09-26 獨立複驗（帳本 Task 9）：行李箱在門口穿出車殼、轉身時朝向與箱子瞬間跳。用上面同一組車模（8 扇門全開）的車殼，
   // 以畫面每幀用的同一個 posePerson 逐 0.02 秒擺每位上下車者（判準在 scripts/lib/people_clip.mjs）：零件任何一條邊在門洞以外跨過車殼超過 1 cm 算穿殼。
   // 30 站：第 23 站才出現第一位往 − 方向下車的拉行李箱乘客，覆蓋率另外具名檢查。
   {const {skinFields,peopleClip}=await import('./lib/people_clip.mjs'),skins=skinFields(cars),stops=30,dt=.02;
    const run=(pose,p=plan)=>peopleClip({plan:p,pose,kit,skins,doors,platform:pf,timetable:tt,scale,stops,dt});
    const real=(q,v,t)=>posePerson(q,v,t,v.heading,kit,scale),r=run(real),miss=[];
    for(const role of ['alight','board'])for(const acc of ['none','backpack','handbag','hat','suitcase'])for(const g of ['+','-'])if(!(r.groups[role+'/'+acc+'/'+g]?.inCar>0))miss.push(role+'/'+acc+'/'+g);
    check('T8 上下車的人與配件不穿出車殼（門洞以外；正式車模頭車與中間車 8 扇門、30 站、逐 0.02 秒，超過 1 cm 算穿），每種角色×配件×車門方向都量到',r.bad.length===0&&miss.length===0,{samples:r.samples,bad:r.bad.length,worst:[...r.bad].sort((x,y)=>y.sev-x.sev).slice(0,3),miss});
    // 對照組：行李箱固定在右後方斜拖（改動前的拉法：不沿路拖、不立起來）、手提包不收到身前，都要抓到穿殼。
    const rigid=(q,v,t)=>q.look.accessory==='suitcase'?personPose({...v,wheel:undefined,hand:undefined,tuck:0},kit):real(q,v,t),count=(res,acc)=>res.bad.filter(b=>b.acc===acc).length;
    const c1=run(rigid),c2=run((q,v,t)=>q.look.accessory==='handbag'?personPose({...v,tuck:0},kit):real(q,v,t));
    check('T8 穿殼判準的對照組：行李箱固定在右後方斜拖（改動前的拉法）、手提包不收到身前，都抓得到穿殼',count(c1,'suitcase')>0&&count(c2,'handbag')>0,{suitcase:count(c1,'suitcase'),handbag:count(c2,'handbag')});
    // 轉身與行李箱不跳，只算從月台看得到的範圍（people_clip 的 visible）：朝向每 0.02 秒 ≤.35 rad（轉 90° 至少 0.09 秒）；
    // 行李箱外框各角的位移扣掉人自己轉身與平移能解釋的部分（caseJump）≤ 走路速度 3 倍。箱子被人拖著一起轉不算跳
    //（月台上短短的橫移會讓箱子跟著身體甩過去，caseStep 約 0.18）；箱子立起來、沿路跟上來都比上限慢（實測 200 站最多 0.054）。
    // 對照組：朝向在路點瞬間轉（改動前的算法）要超過轉身上限；走到一半換手（箱子瞬間換邊）要超過跳動上限。
    const jumpMax=3*plan.PEOPLE.walk*dt/scale,raw={...plan,personAt(p,t){const v=plan.personAt(p,t);if(!v)return v;const k=p.keys;let i=0;while(i<k.length-2&&t>=k[i+1].t)i++;
     const a=k[i],b=k[i+1]??a;return{...v,heading:b.t>a.t&&(b.x!==a.x||b.y!==a.y)?Math.atan2(b.y-a.y,b.x-a.x):a.face};}};
    const c3=run(real,raw),c4=run((q,v,t)=>posePerson(q,t>(q.appear+q.vanish)/2?{...v,hand:-(v.hand??-1)}:v,t,v.heading,kit,scale));
    check('T8 轉身不跳（看得到的範圍每 0.02 秒 ≤.35 rad）、行李箱不跳（人轉身與平移解釋不了的位移 ≤ 走路速度 3 倍）；對照組（路點瞬間轉身、走到一半換手）都抓得到',r.turn.step<=.35&&r.caseJump.step<=jumpMax&&c3.turn.step>.35&&c4.caseJump.step>jumpMax,{turn:r.turn,caseJump:r.caseJump,caseStep:r.caseStep,jumpMax:+jumpMax.toFixed(4),control:{turn:+c3.turn.step.toFixed(3),caseJump:+c4.caseJump.step.toFixed(3)}});
    // 拉行李箱的人沿真實路線（含轉身、門口把箱子立起來）：腳與鞋不穿進箱子（上面的三角形相交，逐 0.02 秒；停著不動時每 0.2 秒）。
    // 對照組：腿照正常步幅擺（不因箱子太近而縮小），要抓得到相交。
    const pool=new Map(),place=(name,m,key)=>{const a=kit.parts.get(name).geometry.getAttribute('position');let T=pool.get(key);
     if(!T){T=[];for(let i=0;i<a.count;i+=3)T.push([new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()]);pool.set(key,T);}
     for(let i=0;i<a.count;i+=3)for(let k=0;k<3;k++)T[i/3][k].set(a.getX(i+k),a.getY(i+k),a.getZ(i+k)).applyMatrix4(m);return T;};
    const pv=kit.parts.get('leg').pivot,legM=new THREE.Matrix4(),legR=new THREE.Matrix4(),t0=Date.now();let samples=0,hit=0,ctl=0,first=null;
    for(let n=0;n<stops;n++)for(const q of plan.planStop(n,{timetable:tt,doors,platform:pf}).people){if(q.role==='idle'||q.look.accessory!=='suitcase')continue;
     for(let t=q.appear;t<q.vanish;t+=dt){const v=plan.personAt(q,t);if(!v||(!v.walking&&Math.round((t-q.appear)/dt)%10))continue;samples++;
      const pose=real(q,v,t),get=(nm,c)=>pose.find(e=>e.name===nm&&e.copy===c).matrix,cs=place('acc-suitcase',get('acc-suitcase',0),'case');
      if(hits([0,1].flatMap(c=>[...place('leg',get('leg',c),'leg'+c),...place('shoe',get('shoe',c),'shoe'+c)]),cs)){hit++;first??={id:q.id,t:+t.toFixed(2)};}
      const phi=v.walking?Math.sin(v.stride/(.25*v.look.scale)*Math.PI):0;
      if(hits([0,1].flatMap(c=>{legM.makeTranslation(pv[0],c?-pv[1]:pv[1],pv[2]).multiply(legR.makeRotationY((c?-1:1)*.45*phi));return[...place('leg',legM,'fl'+c),...place('shoe',legM,'fs'+c)];}),cs))ctl++;}}
    check('T8 拉行李箱的人沿真實路線（含轉身、門口立起箱子）腳與鞋不穿進箱子；對照組（腿照正常步幅擺）抓得到相交',samples>0&&hit===0&&ctl>0,{samples,hit,first,control:ctl,ms:Date.now()-t0});}}
  kit.dispose();}
}

probe.dispose();
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;

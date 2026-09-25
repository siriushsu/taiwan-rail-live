// 關節零件：讀「零件＋轉軸」格式（garage-parts-v1），集電弓與乘客共用。每個零件的網格以自己的轉軸為原點匯出。
import * as THREE from './vendor/three.module.js';
// 單臂集電弓兩節連桿：轉軸在底座鉸鏈，下臂往 +x 斜上到肘、上臂折回到弓頭。
// 弓頭 x 固定＝lower−upper：降弓（目標高度＝headRise）時兩臂恰好攤平，升降是同一族解，不會中途翻面。
// targetZ 是「接觸面離鉸鏈的高度」（車模單位）；null＝場景沒有電車線→降弓。
export function pantographPose(rig,targetZ){
 const {lower,upper,headRise}=rig,headX=lower-upper;
 const z=Math.max(0,(targetZ??headRise)-headRise),want=Math.hypot(headX,z);
 const d=Math.min(lower+upper-1e-9,Math.max(Math.abs(lower-upper),want));
 const a=Math.acos(Math.min(1,Math.max(-1,(lower*lower+d*d-upper*upper)/(2*lower*d))));
 const reach=Math.atan2(z,headX),lowerAngle=reach-a;
 const ex=lower*Math.cos(lowerAngle),ez=lower*Math.sin(lowerAngle),tipX=d*Math.cos(reach),tipZ=d*Math.sin(reach);
 const upperAngle=Math.atan2(tipZ-ez,tipX-ex);
 return{lowerAngle,upperAngle,elbow:[ex,ez],head:[tipX,tipZ+headRise],reached:Math.abs(d-want)<1e-6};
}
// meta＝零件庫 JSON，buffer＝解壓後的 float32（位置＋法向量，stride 6）。區段越界或不是整數個三角形直接丟錯。
export function buildGarageParts(meta,buffer){
 if(meta.schema!=='garage-parts-v1')throw Error('garage parts: schema '+meta.schema);
 const data=new Float32Array(buffer),count=data.length/6;
 if(count!==meta.mesh.vertexCount)throw Error('garage parts: size');
 const parts=new Map(),geometries=[];
 for(const p of meta.parts){
  if(!(p.start>=0&&p.count>0&&p.count%3===0&&p.start+p.count<=count))throw Error('garage parts: range '+p.name);
  const g=new THREE.BufferGeometry(),b=new THREE.InterleavedBuffer(data.subarray(p.start*6,(p.start+p.count)*6),6);
  g.setAttribute('position',new THREE.InterleavedBufferAttribute(b,3,0));g.setAttribute('normal',new THREE.InterleavedBufferAttribute(b,3,3));g.computeBoundingBox();
  parts.set(p.name,{...p,geometry:g});geometries.push(g);
 }
 return{parts,rig:meta.rig,dispose(){geometries.forEach(g=>g.dispose());}};
}
// 集電弓：root（底座，放在車模 mount）→ 下臂轉軸 → 上臂轉軸（肘）→ 弓頭轉軸 → contact（接觸面）。
export function createPantograph(kit){
 const {rig}=kit,materials=[],root=new THREE.Group(),lowerPivot=new THREE.Group(),upperPivot=new THREE.Group(),headPivot=new THREE.Group(),contact=new THREE.Object3D();
 root.name='pantograph';root.add(lowerPivot);lowerPivot.add(upperPivot);upperPivot.position.set(rig.lower,0,0);upperPivot.add(headPivot);headPivot.position.set(rig.upper,0,0);headPivot.add(contact);contact.position.set(0,0,rig.headRise);
 const mesh=(name,parent)=>{const p=kit.parts.get(name);if(!p)throw Error('garage parts: missing '+name);
  const m=new THREE.MeshStandardMaterial({color:new THREE.Color(...p.color),metalness:p.metalness??.5,roughness:p.roughness??.45});materials.push(m);
  const o=new THREE.Mesh(p.geometry,m);o.name='pantograph-'+name;o.castShadow=true;parent.add(o);return o;};
 mesh('base',root);mesh('lower',lowerPivot);mesh('upper',upperPivot);mesh('head',headPivot);
 let last=null;
 function pose(targetZ){const p=pantographPose(rig,targetZ);lowerPivot.rotation.y=-p.lowerAngle;upperPivot.rotation.y=-(p.upperAngle-p.lowerAngle);headPivot.rotation.y=p.upperAngle;last=p;return p;}
 pose(null);
 return{root,contact,pose,get last(){return last;},dispose(){materials.forEach(m=>m.dispose());}};
}

// 同平面的面把彼此分開：兩塊顏色不同的面貼在同一個平面上，深度只差浮點誤差，鏡頭一動就互相穿插閃爍（z-fighting）。
// 場景模組建好之後跑一次，網頁 garage-diorama.js 與 native scripts/garage-scenes/bake.mjs 都呼叫，三端拿到同一份結果。
// 規則：同一平面上互相重疊的東西，小的疊在大的上面，透明與挖空的貼片再疊在不透明上面；一層抬 STEP，沿面的朝向抬，整個物件（或實例）一起動。
// 一個網格裡有多種外觀時（材質分組、頂點色）只抬那一種外觀的頂點。朝下的面鏡頭看不到（仰角最低 .2），不處理。
// STEP 要比量得出的深度精度大：鏡頭正交 near .1、far 400，24 位元深度一格約 2.4e-5，仰角 .2 時 .002 還有 16 格。
import * as THREE from '../vendor/three.module.js';
const SAME=.0015,STEP=.002,MIN_TRI=.002,MIN_OVERLAP=.002;
const hex=c=>c?c.getHexString():'';
const lookOf=m=>[hex(m.color),hex(m.emissive),m.map?.uuid??'',m.transparent?1:0,m.blending].join();
// 三角形在 2D 的重疊面積（Sutherland–Hodgman，P 被 Q 裁）。
function overlap(P,Q){
 let out=P,s=0;for(let i=0;i<3;i++){const a=Q[i],b=Q[(i+1)%3];s+=(b[0]-a[0])*(b[1]+a[1]);}const sign=s>0?-1:1;
 for(let i=0;i<3&&out.length;i++){const a=Q[i],b=Q[(i+1)%3],next=[],f=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  for(let j=0;j<out.length;j++){const u=out[j],v=out[(j+1)%out.length],fu=f(u),fv=f(v);if(fu>=0)next.push(u);if(fu>=0!==fv>=0){const k=fu/(fu-fv);next.push([u[0]+(v[0]-u[0])*k,u[1]+(v[1]-u[1])*k]);}}
  out=next;}
 let area=0;for(let i=0;i<out.length;i++){const a=out[i],b=out[(i+1)%out.length];area+=a[0]*b[1]-b[0]*a[1];}return Math.abs(area)/2;
}
// 抬過一層之後可能又貼到別的面，再掃一次；實測最多三輪就沒有衝突。
export function separateCoplanar(group){
 const clones=[];let moved=0,conflicts=0;
 for(let round=0;round<3;round++){const r=separateOnce(group);moved+=r.moved;clones.push(...r.clones);if(!round)conflicts=r.conflicts;if(!r.conflicts)break;}
 return{moved,conflicts,clones};
}
function separateOnce(group){
 group.updateMatrixWorld(true);
 const units=[],unitOf=new Map(),tris=[],geometryUsers=new Map();
 const A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3(),M=new THREE.Matrix4(),I=new THREE.Matrix4(),color=new THREE.Color();
 group.traverse(o=>{if(o.isMesh)geometryUsers.set(o.geometry,(geometryUsers.get(o.geometry)||0)+1);});
 group.traverse(o=>{
  if(!o.isMesh||o.name==='taiwan-trees')return; // 樹葉一片片互相穿插本來就不是平面，掃它只是浪費時間。
  const g=o.geometry,pos=g.attributes.position;if(!pos)return;
  const mats=[].concat(o.material),idx=g.index,count=idx?idx.count:pos.count,vc=g.attributes.color,inst=o.isInstancedMesh?o.count:1;
  const groups=g.groups.length&&Array.isArray(o.material)?g.groups:[{start:0,count,materialIndex:0}];
  for(let k=0;k<inst;k++){
   M.copy(o.matrixWorld);if(o.isInstancedMesh){o.getMatrixAt(k,I);M.multiply(I);}
   const tint=o.instanceColor?(o.getColorAt(k,color),hex(color)):'';
   for(const part of groups){
    const m=mats[part.materialIndex]||mats[0];if(!m||m.colorWrite===false||m.isShadowMaterial)continue;
    const look=lookOf(m)+tint,end=Math.min(count,part.start+part.count);
    for(let i=part.start;i+2<end;i+=3){
     const a=idx?idx.getX(i):i,b=idx?idx.getX(i+1):i+1,c=idx?idx.getX(i+2):i+2;
     A.fromBufferAttribute(pos,a).applyMatrix4(M);B.fromBufferAttribute(pos,b).applyMatrix4(M);C.fromBufferAttribute(pos,c).applyMatrix4(M);
     ab.subVectors(B,A);ac.subVectors(C,A);n.crossVectors(ab,ac);const len=n.length(),area=len/2;if(area<MIN_TRI)continue;n.multiplyScalar(1/len);
     const backSeen=m.side!==THREE.FrontSide;if(n.z<-.3&&!backSeen)continue;
     const tone=vc?`${Math.round(vc.getX(a)*32)},${Math.round(vc.getY(a)*32)},${Math.round(vc.getZ(a)*32)}`:'',lookKey=look+tone;
     const key=o.isInstancedMesh?o.id+':'+k:o.id+':'+lookKey;let u=unitOf.get(key);
     if(u===undefined){u=units.length;unitOf.set(key,u);units.push({o,instance:o.isInstancedMesh?k:-1,look:lookKey,glass:m.transparent||m.alphaTest>0,see:m.transparent,verts:null,shift:new Map(),order:0});}
     if(!o.isInstancedMesh){(units[u].verts??=new Set()).add(a).add(b).add(c);}
     const flip=n.x<-1e-3||(Math.abs(n.x)<=1e-3&&(n.y<-1e-3||(Math.abs(n.y)<=1e-3&&n.z<0)))?-1:1;
     tris.push({u,area,nx:n.x,ny:n.y,nz:n.z,flip,cd:n.dot(A)*flip,nk:`${Math.round(n.x*flip*100)},${Math.round(n.y*flip*100)},${Math.round(n.z*flip*100)}`,p:[A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z]});
    }
   }
  }
 });
 const cells=new Map();
 tris.forEach((t,i)=>{const key=t.nk+'|'+Math.floor(t.cd/SAME);let l=cells.get(key);if(!l)cells.set(key,l=[]);l.push(i);});
 const edges=new Map(),areas=new Map();
 for(const t of tris){const key=t.u+'|'+t.nk+'|'+Math.round(t.cd*250);areas.set(key,(areas.get(key)||0)+t.area);}
 for(const [key,own] of cells){
  const cut=key.lastIndexOf('|'),nk=key.slice(0,cut),list=own.concat(cells.get(nk+'|'+(+key.slice(cut+1)+1))||[]);if(list.length<2)continue;
  const ownSet=new Set(own),first=units[tris[list[0]].u].look;if(list.every(i=>units[tris[i].u].look===first))continue;
  const t0=tris[list[0]],ax=Math.abs(t0.nx),ay=Math.abs(t0.ny),az=Math.abs(t0.nz),[e,f]=ax>ay&&ax>az?[1,2]:ay>az?[0,2]:[0,1];
  const items=list.map(i=>{const t=tris[i],p=t.p;return{i,t,P:[[p[e],p[f]],[p[3+e],p[3+f]],[p[6+e],p[6+f]]],x0:Math.min(p[e],p[3+e],p[6+e]),x1:Math.max(p[e],p[3+e],p[6+e]),y0:Math.min(p[f],p[3+f],p[6+f]),y1:Math.max(p[f],p[3+f],p[6+f])};}).sort((a,b)=>a.x0-b.x0);
  for(let a=0;a<items.length;a++){const p=items[a];
   for(let b=a+1;b<items.length;b++){const q=items[b];if(q.x0>=p.x1)break;if(q.y0>=p.y1||q.y1<=p.y0)continue;if(!ownSet.has(p.i)&&!ownSet.has(q.i))continue;
    const U=units[p.t.u],V=units[q.t.u];if(p.t.u===q.t.u||U.look===V.look||Math.abs(p.t.cd-q.t.cd)>SAME)continue;
    if(overlap(p.P,q.P)<MIN_OVERLAP)continue;
    const pair=Math.min(p.t.u,q.t.u)+'|'+Math.max(p.t.u,q.t.u)+'|'+nk;if(!edges.has(pair))edges.set(pair,{a:p.t,b:q.t,nk});
   }
  }
 }
 // 同一個朝向的衝突各排一次：大的先定，小的疊在已定好的上面；透明的一律最後。
 const byNormal=new Map();
 for(const e of edges.values()){let l=byNormal.get(e.nk);if(!l)byNormal.set(e.nk,l=[]);l.push(e);}
 for(const [nk,list] of byNormal){
  const near=new Map(),info=new Map();
  const note=(t,other)=>{let l=near.get(t.u);if(!l){near.set(t.u,l=new Set());info.set(t.u,t);}l.add(other.u);};
  for(const {a,b} of list){note(a,b);note(b,a);}
  const size=u=>{const t=info.get(u);return units[u].glass?-1:areas.get(u+'|'+nk+'|'+Math.round(t.cd*250))||0;};
  const order=[...near.keys()].sort((a,b)=>size(b)-size(a)||a-b),level=new Map();
  for(const u of order){let v=0;for(const w of near.get(u))if(level.has(w))v=Math.max(v,level.get(w)+1);level.set(u,v);
   if(v){const t=info.get(u),s=units[u].shift,dir=units[u].glass?Math.sign(t.nz)||1:1,was=s.get(nk);if(!was||was.level<v)s.set(nk,{level:v,x:t.nx*dir,y:t.ny*dir,z:t.nz*dir});units[u].order=Math.max(units[u].order,v);}}
 }
 // 套用：只有一種外觀的網格與實例整個平移，混了多種外觀的只動那幾個頂點。
 const looks=new Map();for(const u of units)if(u.instance<0)looks.set(u.o,(looks.get(u.o)||0)+1);
 const inverse=new THREE.Matrix4(),move=new THREE.Vector3(),clones=[];let moved=0;
 for(const u of units){
  if(!u.shift.size)continue;moved++;move.set(0,0,0);for(const s of u.shift.values())move.add(new THREE.Vector3(s.x,s.y,s.z).multiplyScalar(s.level*STEP));
  const o=u.o;if(u.see)o.renderOrder=Math.max(o.renderOrder,u.order);
  if(u.instance>=0){o.getMatrixAt(u.instance,I);inverse.copy(o.matrixWorld).invert();const local=move.clone().transformDirection(inverse).multiplyScalar(move.length());I.elements[12]+=local.x;I.elements[13]+=local.y;I.elements[14]+=local.z;o.setMatrixAt(u.instance,I);o.instanceMatrix.needsUpdate=true;continue;}
  if(looks.get(o)===1){const parent=o.parent?inverse.copy(o.parent.matrixWorld).invert():inverse.identity(),local=move.clone().transformDirection(parent).multiplyScalar(move.length());o.position.add(local);continue;}
  if(geometryUsers.get(o.geometry)>1){geometryUsers.set(o.geometry,geometryUsers.get(o.geometry)-1);o.geometry=o.geometry.clone();geometryUsers.set(o.geometry,1);clones.push(o.geometry);}
  inverse.copy(o.matrixWorld).invert();const local=move.clone().transformDirection(inverse).multiplyScalar(move.length()),pos=o.geometry.attributes.position;
  for(const v of u.verts)pos.setXYZ(v,pos.getX(v)+local.x,pos.getY(v)+local.y,pos.getZ(v)+local.z);pos.needsUpdate=true;o.geometry.computeBoundingSphere();
 }
 group.updateMatrixWorld(true);
 return{moved,conflicts:edges.size,clones};
}

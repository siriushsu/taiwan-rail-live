import * as THREE from '../vendor/three.module.js';
import {createKit,straightPath,smooth} from './new-scene-kit.js';
import {offsetPath} from './scene-detail-kit.js';
import {taiwanStreet} from './taiwan-street.js';
import {crossingState} from './crossing-cycle.js';
// ── draw call 合併（2026-09-29，車庫「其他五景輕量精緻化」）：這一景手機吃力的是 draw call（原本 282 個，加列車 376–384），不是三角形。
// 建好場景後把 81 個 InstancedMesh 桶、遮斷桿／車輛／電車線的零件 mesh、16 張招牌貼圖攤平成 27 顆 mesh，畫出來的三角形逐個相同：
//  1. 靜態塑膠件（roughness .8、無發光、無貼圖）烘進世界座標、材質色改吃頂點色，依位置切 10 塊（視錐剔除用包圍球，塊要方正；「陪它走走」看不到的塊就不畫）。
//  2. 其他靜態件（玻璃、窗光、路燈頭、金屬、小發光色、紅閃燈）每種材質一顆，保留原材質，發光與閃爍照舊。
//  3. 會動的（6 輛車、2 支遮斷桿臂）：每種材質一顆動態 mesh，姿態變了才重寫頂點緩衝（車輛材質原本每輛各複製一份是為了掛裁切面，現在同角色共用）。
//  4. 招牌貼圖 16 張併成一張圖集（格與格之間留複製邊緣的緩衝、原點取 32 的倍數，mip 各層取樣與各自獨立時相同），亮／不亮兩顆。
// 驗收：scripts/verify_garage_crossing_drawcalls.mjs（draw call 上限、三角形不增加、遮斷桿／車輛的射線探測）。
const CHUNKS=10,HUGE=12; // 塑膠件切幾塊（含特大件那一塊）；世界座標包圍盒對角線超過 HUGE 公尺算特大件
const isPlain=m=>m.isMeshStandardMaterial&&!m.isMeshPhysicalMaterial&&m.metalness===0&&m.roughness===.8&&m.emissive.getHex()===0&&!m.map&&!m.emissiveMap&&m.side===THREE.FrontSide&&!m.flatShading&&!m.transparent&&!m.vertexColors&&!m.clippingPlanes;
// items:[{g:BufferGeometry, m:Matrix4, c:Color|null}]；c 有值就寫頂點色。頂點與法線的算法跟 shader 相同（法線＝逆轉置後正規化）。
function bakeArrays(items,withColor){
 let nv=0,ni=0;for(const {g} of items){nv+=g.attributes.position.count;ni+=g.index?g.index.count:g.attributes.position.count;}
 const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),col=withColor?new Float32Array(nv*3):null,idx=new Uint32Array(ni),nm=new THREE.Matrix3();let vo=0,io=0;
 for(const {g,m,c} of items){
  const P=g.attributes.position,N=g.attributes.normal,I=g.index,e=m.elements,n=nm.getNormalMatrix(m).elements;
  for(let i=0;i<P.count;i++){
   const x=P.getX(i),y=P.getY(i),z=P.getZ(i),o=(vo+i)*3,nx=N.getX(i),ny=N.getY(i),nz=N.getZ(i);
   pos[o]=e[0]*x+e[4]*y+e[8]*z+e[12];pos[o+1]=e[1]*x+e[5]*y+e[9]*z+e[13];pos[o+2]=e[2]*x+e[6]*y+e[10]*z+e[14];
   const ax=n[0]*nx+n[3]*ny+n[6]*nz,ay=n[1]*nx+n[4]*ny+n[7]*nz,az=n[2]*nx+n[5]*ny+n[8]*nz,l=Math.hypot(ax,ay,az)||1;nor[o]=ax/l;nor[o+1]=ay/l;nor[o+2]=az/l;
   if(col){col[o]=c.r;col[o+1]=c.g;col[o+2]=c.b;}
  }
  if(I)for(let i=0;i<I.count;i++)idx[io+i]=vo+I.getX(i);else for(let i=0;i<P.count;i++)idx[io+i]=vo+i;
  vo+=P.count;io+=I?I.count:P.count;
 }
 return{pos,nor,col,idx};
}
const staticGeometry=a=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(a.pos,3));g.setAttribute('normal',new THREE.BufferAttribute(a.nor,3));if(a.col)g.setAttribute('color',new THREE.BufferAttribute(a.col,3));g.setIndex(new THREE.BufferAttribute(a.idx,1));return g;};
// 動態零件的模板：展開成非索引三角形，頂點在 rig 的區域座標
const expand=a=>{const n=a.idx.length,pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=a.col?new Float32Array(n*3):null;for(let i=0;i<n;i++){const s=a.idx[i]*3;for(let j=0;j<3;j++){pos[i*3+j]=a.pos[s+j];nor[i*3+j]=a.nor[s+j];if(col)col[i*3+j]=a.col[s+j];}}return{pos,nor,col};};
const shown=o=>{for(;o;o=o.parent)if(!o.visible)return false;return true;};
// 一顆動態 mesh：收 N 個 rig 的模板，每幀把可見的 rig 依其 matrixWorld 寫進同一份緩衝（只有姿態或可見性變了才重寫）。
function dynamicMesh(k,material,withColor){
 const rigs=[];let cap=0,geom,mesh,P,Nr,C,last;const M=new THREE.Matrix3(),sig=[];
 return{
  add(rig,t){rigs.push({rig,t,n:t.pos.length/3});cap+=t.pos.length/3;},
  build(){P=new Float32Array(cap*3);Nr=new Float32Array(cap*3);C=withColor?new Float32Array(cap*3):null;geom=new THREE.BufferGeometry();
   const p=new THREE.BufferAttribute(P,3),n=new THREE.BufferAttribute(Nr,3);p.setUsage(THREE.DynamicDrawUsage);n.setUsage(THREE.DynamicDrawUsage);geom.setAttribute('position',p);geom.setAttribute('normal',n);
   if(C){const c=new THREE.BufferAttribute(C,3);c.setUsage(THREE.DynamicDrawUsage);geom.setAttribute('color',c);}
   geom.boundingSphere=new THREE.Sphere();geom.setDrawRange(0,0);mesh=new THREE.Mesh(k.geo(geom),material);mesh.castShadow=mesh.receiveShadow=true;mesh.visible=false;k.group.add(mesh);last=new Float64Array(rigs.length*17);},
  update(){
   let same=true;rigs.forEach((r,i)=>{r.on=shown(r.rig);if(r.on)r.rig.updateWorldMatrix(true,false);const e=r.rig.matrixWorld.elements,o=i*17;if(last[o]!==+r.on){same=false;last[o]=+r.on;}for(let j=0;j<16;j++)if(r.on&&last[o+1+j]!==e[j]){same=false;last[o+1+j]=e[j];}});
   if(same)return;
   let off=0,x0=1e9,y0=1e9,z0=1e9,x1=-1e9,y1=-1e9,z1=-1e9;
   for(const r of rigs){if(!r.on)continue;const m=r.rig.matrixWorld,e=m.elements,n=M.getNormalMatrix(m).elements,{pos,nor,col}=r.t;
    for(let i=0;i<r.n;i++){const s=i*3,d=(off+i)*3,x=pos[s],y=pos[s+1],z=pos[s+2],wx=e[0]*x+e[4]*y+e[8]*z+e[12],wy=e[1]*x+e[5]*y+e[9]*z+e[13],wz=e[2]*x+e[6]*y+e[10]*z+e[14];
     P[d]=wx;P[d+1]=wy;P[d+2]=wz;const a=nor[s],b=nor[s+1],c=nor[s+2],ax=n[0]*a+n[3]*b+n[6]*c,ay=n[1]*a+n[4]*b+n[7]*c,az=n[2]*a+n[5]*b+n[8]*c,l=Math.hypot(ax,ay,az)||1;Nr[d]=ax/l;Nr[d+1]=ay/l;Nr[d+2]=az/l;
     if(C){C[d]=col[s];C[d+1]=col[s+1];C[d+2]=col[s+2];}
     if(wx<x0)x0=wx;if(wx>x1)x1=wx;if(wy<y0)y0=wy;if(wy>y1)y1=wy;if(wz<z0)z0=wz;if(wz>z1)z1=wz;}
    off+=r.n;}
   geom.setDrawRange(0,off);mesh.visible=off>0;
   for(const a of Object.values(geom.attributes))a.needsUpdate=true;
   if(off){geom.boundingSphere.center.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);geom.boundingSphere.radius=Math.hypot(x1-x0,y1-y0,z1-z0)/2;}
  }
 };
}
export function createScene(){
 const k=createKit(),{group,mat,block,beam,mesh,props,part}=k,path=offsetPath(straightPath(.36),1.65),opposingPath=offsetPath(straightPath(.36),-1.65,true),asphalt=mat('#6c7470'),white=mat('#e5e1cf'),yellow=mat('#dfb943'),dark=mat('#333d40'),concrete=mat('#bab5a3');
 k.slab('#665440',76,46,-1.35,.35,5);k.slab('#b49c75',75.6,45.6,-1,.6,5);k.slab('#95a078',75,45,-.4,.4,5);
 block(asphalt,[6.8,34,.14],[0,0,.07]);for(const x of [-3.8,3.8])block(concrete,[.7,34,.18],[x,0,.09]);
 for(const y of [-12,-9,-6,6,9]){block(yellow,[.06,1.5,.02],[-.10,y,.155]);block(yellow,[.06,1.5,.02],[.10,y,.155]);}
 for(const side of [-1,1]){block(white,[2.65,.20,.02],[-side*1.6,side*6.0,.155]);for(let i=0;i<5;i++)block(white,[.34,1.2,.02],[-2.3+i*.95,side*11,.155]);}
 k.track(path,true);k.track(opposingPath,true);
 for(const center of [-1.65,1.65])for(const y of [-.89,0,.89])block(mat('#656966'),[6.9,.71,.21],[0,center+y,.20]);
 block(mat('#656966'),[6.9,.8,.21],[0,0,.20]);
 // 兩側橡膠鋪面之間保留鋼軌與輪緣槽，路面到軌面有平緩坡面。
 for(const side of [-1,1])block(asphalt,[6.8,2,.14],[0,side*3.6,.14],[side*-.06,0,0]);
 // 依實景把禁停區放在兩股軌道外，輪緣槽保持可見。
 for(const side of [-1,1])for(let x=-3.1;x<3.2;x+=.8){beam(yellow,[x,side*4.0,.23],[Math.min(3.25,x+1.3),side*5.5,.23],.04);beam(yellow,[x,side*5.5,.23],[Math.min(3.25,x+1.3),side*4.0,.23],.04);}
 const street=taiwanStreet(k);
 for(const [x,y]of [[-5,-9],[5,7],[-14,6],[16,6]])k.lamp(x,y,0,4.8);
 const gates=[],lamps=[],redLights=[],armRigs=[];let tipMaterial;
 for(const side of [-1,1]){
  const x=side*3.25,y=-side*4.6,pole=new THREE.Group();pole.position.set(x,y,.18);group.add(pole);
  part(pole,concrete,[.62,.62,.32],[0,0,.12]);part(pole,dark,[.16,.16,3.0],[0,0,1.6]);
  for(let z=.4;z<2.0;z+=.35)part(pole,yellow,[.175,.175,.17],[0,0,z]);
  // 警示十字、雙面紅燈、鐘罩及獨立緊急按鈕箱。
  for(const angle of [-.65,.65])part(pole,white,[1.3,.09,.17],[0,0,3.0],[0,angle,0]);
  for(const dx of [-.37,.37])for(const face of [-1,1]){part(pole,dark,[.26,.26,.13],[dx,face*.08,2.35],[Math.PI/2,0,0],k.cylinder);const m=mat(dx>0?'#ff3323':'#ff3423',{emissive:'#ff2516',emissiveIntensity:0,roughness:.4});const lamp=part(pole,m,[.18,.18,.035],[dx,face*.225,2.35],[Math.PI/2,0,0],k.cylinder);lamp.castShadow=lamp.receiveShadow=false;lamps.push({m,index:dx>0?1:0});}
  part(pole,dark,[.26,.24,.18],[0,0,2.67],[0,0,0],k.ball);part(pole,mat('#d5b263'),[.35,.25,.46],[0,0,.8]);part(pole,mat('#bb3f2d'),[.10,.04,.10],[0,-.15,.84]);
  const glow=new THREE.PointLight('#ff4631',0,3.5,2);glow.position.set(x,y,2);group.add(glow);redLights.push(glow);
  const pivot=new THREE.Group();pivot.position.z=1.15;pole.add(pivot);const arm=new THREE.Group();arm.rotation.z=side>0?Math.PI:0;pivot.add(arm);
  for(let i=0;i<10;i++)part(arm,i%2?yellow:dark,[.31,.11,.12],[.18+i*.31,0,0]);
  const tip=part(arm,mat('#eee6c8',{emissive:'#ff5830'}),[.12,.14,.15],[3.12,0,0]);tip.material.userData.role='tip';tipMaterial=tip.material;k.glowing.push(tip.material);gates.push({pivot,side});armRigs.push(arm);
 }
 // 車輛零件先照原樣用 part() 組出來（區域座標），建好後併進 5 顆共用的動態 mesh；材質角色記在 userData.role。
 function vehicle(type,color,x,y,dir=1){const g=new THREE.Group();g.position.set(x,y,.18);g.rotation.z=dir<0?Math.PI:0;group.add(g);const body=mat(color,{metalness:.15,roughness:.4}),glass=mat('#426272',{metalness:.3,roughness:.2}),head=mat('#fff0d1',{emissive:'#ffe0a4'}),tail=mat('#ad3028',{emissive:'#ff3220'});body.userData.role='body';glass.userData.role='glass';head.userData.role='head';tail.userData.role='tail';const bike=type==='scooter',L=bike?1.2:2.7,W=bike?.55:1.35;
  part(g,body,[W,L,bike?.48:.55],[0,0,bike?.48:.6]);part(g,glass,[W*.83,L*.46,bike?.1:.58],[0,-.10,bike?.65:1.13]);if(!bike)part(g,body,[W*.89,L*.50,.08],[0,-.1,1.46]);
  for(const axle of [-1,1])for(const side of bike?[0]:[-1,1])part(g,dark,[.24,.24,.16],[side*W*.48,axle*L*.32,.26],[0,Math.PI/2,0],k.cylinder);
  for(const side of bike?[0]:[-1,1]){part(g,head,[.22,.035,.15],[side*W*.33,L/2+.021,.62]);part(g,tail,[.20,.035,.12],[side*W*.33,-L/2-.021,.58]);}
  if(bike){part(g,mat('#537b84'),[.34,.28,.5],[0,0,1.02]);part(g,mat('#ddd9c5'),[.22,.23,.23],[0,.03,1.48],[0,0,0],k.ball);part(g,dark,[.57,.07,.05],[0,.41,.96]);}else{part(g,white,[.37,.04,.12],[0,L/2+.023,.34]);for(const side of [-1,1])part(g,body,[.12,.19,.10],[side*(W/2+.05),.40,1.06]);}
  let light;if(!bike){light=new THREE.SpotLight('#ffdfa5',0,10,Math.PI/7,.8,2);light.position.set(0,L/2+.1,.65);light.target.position.set(0,L/2+8,-.1);g.add(light,light.target);}
  return{g,L,initial:y,dir,light};
 }
 const cars=[vehicle('car','#e6d8b7',1.65,-8.2,1),vehicle('scooter','#7c9b9a',2.4,-11.4,1),vehicle('car','#577c95',1.55,-14,1),vehicle('car','#b75540',-1.65,8.2,-1),vehicle('scooter','#d4b054',-2.35,11.4,-1),vehicle('car','#e5dfcf',-1.6,14,-1)];
 for(const [x,y,c]of [[-4.2,-7,'#d4a655'],[4.2,5.8,'#b9705a'],[-5.2,6,'#728e9d']])k.person(x,y,.18,{color:c,angle:Math.PI/2,hat:true});
 // 雙線電車線跨距與兩股軌道對位，不落柱在軌道中心。
 // 電車線離軌頂約 1.94（與高架同一個高度），集電弓伸得到；電桿、橫樑、吊線跟著降。
 const wire=new THREE.Group();group.add(wire);
 for(let x=-28;x<=28;x+=14){for(const y of [-3.25,3.25])part(wire,dark,[.1,.1,2.97],[x,y,1.485]);part(wire,dark,[.1,6.6,.08],[x,0,2.89]);for(const y of [-1.65,1.65])part(wire,concrete,[.06,.06,.6],[x,y,2.62]);}
 for(const y of [-1.65,1.65])part(wire,dark,[70,.025,.025],[0,y,2.31]);
 k.bake();
 // ── 合併（見檔頭說明）。先收動態 rig（車輛、遮斷桿臂）的零件，再把其餘靜態的攤平，最後才建動態 mesh。
 group.updateMatrixWorld(true);
 const clips=[new THREE.Plane(new THREE.Vector3(0,1,0),17),new THREE.Plane(new THREE.Vector3(0,-1,0),17)],own=m=>k.ownMaterial(m),clipped=m=>(m.clippingPlanes=clips,m.clipShadows=true,own(m)),std=o=>new THREE.MeshStandardMaterial(o);
 const cls=(m,withColor)=>({m,withColor,d:dynamicMesh(k,m,withColor)});
 // 車輛材質原本每輛車各複製一份（為了掛裁切面）；現在同角色共用一份，裁切面照舊（y=±17，連陰影一起裁）。
 const fleet={body:cls(clipped(std({vertexColors:true,metalness:.15,roughness:.4})),true),glass:cls(clipped(std({color:'#426272',metalness:.3,roughness:.2})),false),trim:cls(clipped(std({vertexColors:true,roughness:.8})),true),head:cls(clipped(std({color:'#fff0d1',roughness:.8,emissive:'#ffe0a4'})),false),tail:cls(clipped(std({color:'#ad3028',roughness:.8,emissive:'#ff3220'})),false),tip:cls(tipMaterial,false)};
 k.glowing.push(fleet.head.m,fleet.tail.m);
 for(const rig of [...cars.map(c=>c.g),...armRigs]){
  const per=new Map(),parts=[];rig.updateWorldMatrix(true,true);const inv=rig.matrixWorld.clone().invert();
  rig.traverse(o=>{if(!o.isMesh)return;const role=o.material.userData.role||'trim';if(!per.has(role))per.set(role,[]);per.get(role).push({g:o.geometry,m:new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld),c:o.material.color});parts.push(o);});
  for(const [role,items] of per){const c=fleet[role];c.d.add(rig,expand(bakeArrays(items,c.withColor)));}
  for(const o of parts)o.parent.remove(o);
 }
 const flat=new Map(),gone=[],bbc=new Map(),ctr=new THREE.Vector3(),box=new THREE.Box3(),plainItems=[];
 group.traverse(o=>{if(!o.isMesh||o.material.map||o.material.emissiveMap)return;const m=o.material,plain=isPlain(m),flags=(o.castShadow?'C':'-')+(o.receiveShadow?'R':'-'),c=plain?m.color:null;
  const add=(g,m4)=>{if(plain){let b=bbc.get(g);if(!b){g.computeBoundingBox();b=g.boundingBox.getCenter(new THREE.Vector3());bbc.set(g,b);}ctr.copy(b).applyMatrix4(m4);plainItems.push({g,m:m4,c,flags,cast:o.castShadow,recv:o.receiveShadow,x:ctr.x,y:ctr.y,w:(g.index?g.index.count:g.attributes.position.count)/3,diag:box.copy(g.boundingBox).applyMatrix4(m4).getSize(ctr).length()});return;}
   const key=m.uuid+flags;if(!flat.has(key))flat.set(key,{m,plain,cast:o.castShadow,recv:o.receiveShadow,items:[]});flat.get(key).items.push({g,m:m4,c});};
  if(o.isInstancedMesh){for(let i=0;i<o.count;i++)add(o.geometry,new THREE.Matrix4().fromArray(o.instanceMatrix.array,i*16).premultiply(o.matrixWorld));}else add(o.geometry,o.matrixWorld.clone());
  gone.push(o);});
 for(const o of gone){o.parent.remove(o);o.dispose?.();}
 // 塑膠件依位置切成 K 塊（k-d：每次把三角形最多的一塊沿較長的邊在三角形中位數切開）；鏡頭在「陪它走走」只看得到一段，看不到的塊被視錐剔除。
 // 視錐剔除用的是包圍球，所以塊要盡量方正、不能細長；跨整個場景的大件（地基板、電車線、路面帶）另放一塊，免得把所在塊的球撐到蓋住全場。
 {const huge=plainItems.filter(i=>i.diag>HUGE),chunks=[{items:plainItems.filter(i=>i.diag<=HUGE)}];
  while(chunks.length<CHUNKS-(huge.length?1:0)){chunks.sort((a,b)=>b.items.reduce((s,i)=>s+i.w,0)-a.items.reduce((s,i)=>s+i.w,0));const c=chunks.shift(),xs=c.items.map(i=>i.x),ys=c.items.map(i=>i.y),wx=Math.max(...xs)-Math.min(...xs),wy=Math.max(...ys)-Math.min(...ys),ax=wx>=wy?'x':'y';
   c.items.sort((a,b)=>a[ax]-b[ax]);const half=c.items.reduce((s,i)=>s+i.w,0)/2;let acc=0,cut=0;while(cut<c.items.length-1&&acc+c.items[cut].w<half)acc+=c.items[cut++].w;cut=Math.max(1,cut);
   chunks.push({items:c.items.slice(0,cut)},{items:c.items.slice(cut)});}
  if(huge.length)chunks.push({items:huge});
  chunks.forEach((c,ci)=>{for(const i of c.items){const key='plain#'+ci+i.flags;if(!flat.has(key))flat.set(key,{m:null,plain:true,cast:i.cast,recv:i.recv,items:[]});flat.get(key).items.push({g:i.g,m:i.m,c:i.c});}});}
 // 招牌貼圖：16 張各自的 canvas（512×128 或 128×512）各配一個 material、一顆 mesh。併成一張圖集、亮／不亮兩個 material、兩顆 mesh。
 // 每張的內容 1:1 拷貝（不縮放），四邊各多 G 像素複製邊緣色當緩衝，原點與緩衝都取 32 的倍數：mip 第 5 層以內每個 texel 都完整落在同一張圖（或它自己的緩衝）裡，取樣結果與各自獨立時相同。
 let atlasTexture;
 {const faces=[];group.traverse(o=>{if(o.isMesh&&o.material.map)faces.push(o);});
  if(faces.length){
   const G=32,cells=faces.map(o=>{const c=o.material.map.image;return{o,c,w:c.width,h:c.height,lit:!!o.material.emissiveMap};}),wide=cells.filter(c=>c.w>=c.h),tall=cells.filter(c=>c.w<c.h);
   const cw=Math.max(...wide.map(c=>c.w))+2*G,ch=Math.max(...wide.map(c=>c.h))+2*G,rows=Math.ceil(wide.length/2),top=rows*ch,tw=tall.length?Math.max(...tall.map(c=>c.w))+2*G:0,th=tall.length?Math.max(...tall.map(c=>c.h))+2*G:0;
   wide.forEach((c,i)=>{c.x=(i%2)*cw+G;c.y=Math.floor(i/2)*ch+G;});tall.forEach((c,i)=>{c.x=i*tw+G;c.y=top+G;});
   const AW=Math.max(2*cw,tall.length*tw),AH=top+th,canvas=document.createElement('canvas');canvas.width=AW;canvas.height=AH;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
   for(const {c,x,y,w,h} of cells){ctx.drawImage(c,x,y);
    ctx.drawImage(c,0,0,1,h,x-G,y,G,h);ctx.drawImage(c,w-1,0,1,h,x+w,y,G,h);ctx.drawImage(c,0,0,w,1,x,y-G,w,G);ctx.drawImage(c,0,h-1,w,1,x,y+h,w,G);
    ctx.drawImage(c,0,0,1,1,x-G,y-G,G,G);ctx.drawImage(c,w-1,0,1,1,x+w,y-G,G,G);ctx.drawImage(c,0,h-1,1,1,x-G,y+h,G,G);ctx.drawImage(c,w-1,h-1,1,1,x+w,y+h,G,G);}
   atlasTexture=new THREE.CanvasTexture(canvas);atlasTexture.colorSpace=THREE.SRGBColorSpace;
   for(const lit of [true,false]){
    const list=cells.filter(c=>c.lit===lit);if(!list.length)continue;
    const m=own(new THREE.MeshStandardMaterial({map:atlasTexture,roughness:.85,emissiveMap:lit?atlasTexture:null,emissive:lit?'#ffffff':'#000000',emissiveIntensity:0}));if(lit)k.glowing.push(m);
    const pos=[],nor=[],uv=[],idx=[],nm=new THREE.Matrix3(),v=new THREE.Vector3();
    for(const {o,x,y,w,h} of list){const g=o.geometry,P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv,base=pos.length/3;nm.getNormalMatrix(o.matrixWorld);
     for(let i=0;i<P.count;i++){v.fromBufferAttribute(P,i).applyMatrix4(o.matrixWorld);pos.push(v.x,v.y,v.z);v.fromBufferAttribute(N,i).applyMatrix3(nm).normalize();nor.push(v.x,v.y,v.z);uv.push((x+U.getX(i)*w)/AW,1-(y+(1-U.getY(i))*h)/AH);}
     for(let i=0;i<g.index.count;i++)idx.push(base+g.index.getX(i));o.parent.remove(o);o.geometry.dispose();o.material.dispose();}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const o=new THREE.Mesh(k.geo(g),m);o.castShadow=true;o.receiveShadow=false;group.add(o);}
   for(const {c} of cells){c.width=c.height=0;}
  }}
 const plainMaterial=own(std({vertexColors:true,roughness:.8}));
 for(const {m,plain,cast,recv,items} of flat.values()){const o=new THREE.Mesh(k.geo(staticGeometry(bakeArrays(items,plain))),plain?plainMaterial:m);o.castShadow=cast;o.receiveShadow=recv;group.add(o);}
 for(const c of Object.values(fleet))c.d.build();
 let state={};return{...k,dispose(){atlasTexture?.dispose();k.dispose();},path,opposingPath,kind:'crossing',contactWireZ:2.31-.0125,focus:[0,5,1],update(time,period,train){const f=k.illumination(period),a=crossingState(train.distance,train.length,path.length,train.speed),b=crossingState(train.opposingDistance??train.distance,train.length,path.length,train.speed),s={...a,arrival:Math.max(a.arrival,b.arrival),clear:Math.min(a.clear,b.clear),closed:Math.max(a.closed,b.closed),alarm:a.alarm||b.alarm,occupied:a.occupied||b.occupied};s.phase=s.occupied?'雙向列車通過':!s.alarm?'通行開放':s.closed===1?'等待雙線清空':s.clear>.8?'遮斷桿上升':s.closed>0?'遮斷桿下降':'列車接近';for(const {pivot,side}of gates)pivot.rotation.y=side*(1-s.closed)*Math.PI/2;
  for(const l of redLights)l.intensity=s.alarm?(f?2.5:.4):0;const blink=Math.floor(time*2.2)%2;for(const {m,index}of lamps){const on=s.alarm&&blink===index;m.emissiveIntensity=on?3:0;m.color.set(on?'#ff5943':'#551c19');}
  // 車流只在全開後通行；下一次警示前回到入口，所有回繞都在道路邊界。
  const span=38,openStart=3.2,openDuration=(path.length-train.length-7)/train.speed-9.2;
  const openElapsed=s.clear>=openStart?s.clear-openStart:s.clear+path.length/train.speed-openStart;
  cars.forEach((c,i)=>{let y=c.initial;if(!s.alarm&&s.closed===0&&openElapsed<openDuration){const t=Math.max(0,openElapsed-Math.floor(i/3)*.5-(i%3)*1.25),d=t*3.2;const progress=d%span;y=c.initial+c.dir*progress;if(c.dir*y>19)y-=c.dir*span; // 回到邊界後向停止線前進並停等
   if(d>=span)y=c.initial;
  }c.g.position.y=y;c.g.visible=Math.abs(y)<17+c.L/2+.2;c.g.position.z=.18+.12*smooth((4.2-Math.abs(y))/1.2);if(c.light)c.light.intensity=f*16;fleet.tail.m.emissiveIntensity=s.alarm?1.1:f*.5;});
  wire.visible=true;for(const c of Object.values(fleet))c.d.update();state={...s,street,tracks:2,directions:[1,-1],trains:[a,b],lights:f,vehicles:cars.map(c=>({x:c.g.position.x,y:c.g.position.y,length:c.L,dir:c.dir})),gates:gates.map(g=>g.pivot.rotation.y),flashes:lamps.map(l=>l.m.emissiveIntensity),electrified:wire.visible};},get state(){return state;}};
}

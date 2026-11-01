// 通用預設車庫「田園小站」：台灣鄉間的微縮印象，不是特定車站或實際線形的重建。62 款車都能開進來，免費。
// 前直線是木造小站與平交道，環線中間是稻田、三合院、埤塘，東側彎道過溪上鋼鈑梁橋，西側彎道鑽進小山的隧道。
// 寫法照四座精緻車庫（網頁 7c8924be 的 viaduct.js／shifen.js）：程式幾何、零資產檔，同幾何同材質的方塊合批成 InstancedMesh。
// App 先做（10-27），10-31 從 native repo 搬來當唯一的一份：網頁車庫第 4 格（rail-3d/garage-diorama.js）直接載入，
// App 由 native scripts/garage-scenes/bake.mjs 讀網頁釘版烘成 paddy.rigs。改幾何 App 要重烘。原型與三個方向的比較在 native docs/m9/garage-default/。
// 11-01 精修：樹分七種樹形加檳榔、竹叢，樹冠分層、逐棵抖色；站房、三合院、土地公廟有窗框、門、瓦溝、屋脊；透天厝加磁磚縫、
// 窗台、冷氣、直立招牌；稻田改一叢叢秧苗；草地、馬路、電桿電線都有細節。.rigs 只帶幾何、實例色與材質（沒有貼圖），
// 所以「紋理」一律用細幾何與實例色做，兩平台才會長得一樣。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';

export const THEMES = {
 day:{background:'#e6e8de',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#46808a',shallow:'#8fbcae',lamp:0,window:0,signal:.15},
 sunset:{background:'#ecd8c4',sun:'#ffb672',ambient:'#d2b8b2',ground:'#74795e',power:2.8,exposure:.94,water:'#5e8189',shallow:'#a8b8a2',lamp:.45,window:.4,signal:.6},
 night:{background:'#131d2b',sun:'#9fbfe4',ambient:'#5b7390',ground:'#29323e',power:.7,exposure:.76,water:'#16384a',shallow:'#335f6b',lamp:1,window:1,signal:1.4}
};

// 工具組：底座、平面環線、道床、電車線、鋼鈑梁橋、隧道、地形、水面、光池、稻田、樹、瓦頂、電桿電線；finish() 合批。
function createKit(seedValue){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=seedValue;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stoneGeo=geo(new THREE.IcosahedronGeometry(1,0)),dodeca=geo(new THREE.DodecahedronGeometry(1,0));
 // 圓錐（底在 z=0、尖朝上）、上細下粗的樹幹（底在 z=0）、圓柱（中心在原點、軸沿 z）。
 const cone=geo(new THREE.ConeGeometry(1,1,7));cone.rotateX(Math.PI/2);cone.translate(0,0,.5);
 const trunkGeo=geo(new THREE.CylinderGeometry(.62,1,1,6));trunkGeo.rotateX(Math.PI/2);trunkGeo.translate(0,0,.5);
 const cyl=geo(new THREE.CylinderGeometry(.5,.5,1,12));cyl.rotateX(Math.PI/2);
 // 秧苗：沒有底的四角錐（4 個三角形，方塊要 12 個），底在 z=0，一叢就是一顆。
 const tuft=geo((()=>{const b=[[.5,.5],[-.5,.5],[-.5,-.5],[.5,-.5]],v=[];for(let i=0;i<4;i++){const [ax,ay]=b[i],[bx,by]=b[(i+1)%4];v.push(ax,ay,0,bx,by,0,0,0,1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();return g;})());
 // 單位三角柱：屋脊沿 x、底寬 1、高 1，給瓦斜頂用。
 const prism=geo((()=>{const v=[];for(const x of [-.5,.5])v.push(x,-.5,0,x,.5,0,x,0,1);const i=[0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5];const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);const f=g.toNonIndexed();f.computeVertexNormals();g.dispose();return f;})());
 // 檳榔羽葉：沿 +x 長 1 的 V 摺葉片，先上揚再下垂。
 const frond=geo((()=>{const v=[],idx=[],N=5;for(let i=0;i<=N;i++){const t=i/N,z=.42*t-.95*t*t,w=.16*Math.sin(Math.PI*Math.min(1,t*1.1))+.015;v.push(t,0,z,t,-w,z-.4*w,t,w,z-.4*w);}
  for(let i=0;i<N;i++){const m=i*3;idx.push(m,m+1,m+3,m+1,m+4,m+3,m,m+3,m+2,m+2,m+3,m+5);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return g;})());
 // 逐實例上色用的白材質：合批後跟其他純色材質併成一個，顏色全走 instanceColor，不多 draw。
 const paint=mat('#ffffff'),paint2=mat('#ffffff',{side:THREE.DoubleSide});
 const tone=(hex,k=1)=>new THREE.Color(hex).multiplyScalar(k),jit=(hex,a=.07)=>tone(hex,1-a+rand()*2*a);
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 const batches=new Map(),dummy=new THREE.Object3D();
 // 合批：同幾何同材質一個 InstancedMesh。color 給了就寫進 instanceColor（bake 的 INST 段有實例色）。
 // capture(fn) 把 fn 期間放下的每個實例另抄一份回傳（house() 用它找 props.townhouse 實際把窗玻璃放在哪）。
 let tap=null;const capture=fn=>{const got=[];tap=(m,pos,scale)=>got.push({m,pos,scale});try{fn();}finally{tap=null;}return got;};
 function instance(g,m,pos,scale,rot=[0,0,0],color){tap?.(m,pos,scale);if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot,color});}
 const block=(m,size,pos,rot,color)=>instance(box,m,pos,size,rot,color);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}

 // 底座：跟高架、十分、南迴同一座 66×40 的台子。
 const plinthW=66,plinthD=40,plinthR=4,outline=rounded(plinthW,plinthD,plinthR);
 const plinthTop=-2+1.05+.2,groundZ=plinthTop+.05;
 const rimX=y=>Math.abs(y)<=plinthD/2-plinthR?plinthW/2:plinthW/2-plinthR+Math.sqrt(Math.max(0,plinthR**2-(Math.abs(y)-(plinthD/2-plinthR))**2));
 // 草地是一張頂點色網格：低頻的乾濕斑塊加一點逐點抖動，不是一整片平色。每列的寬度照底座圓角收。
 function plinth(grassColor){
  mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
  mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
  const nx=48,ny=30,v=[],c=[],idx=[],base=new THREE.Color(grassColor),dry=new THREE.Color('#9fa878'),lush=new THREE.Color('#6f8858'),ph=[0,1,2,3].map(()=>rand()*6.28),k=new THREE.Color();
  for(let j=0;j<=ny;j++){const y=-plinthD/2+plinthD*j/ny,lim=rimX(y);for(let i=0;i<=nx;i++){const x=-lim+2*lim*i/nx;
   const n=.5*Math.sin(x*.21+ph[0])*Math.sin(y*.27+ph[1])+.3*Math.sin(x*.53+y*.31+ph[2])+.2*Math.sin(x*1.1-y*.9+ph[3]);
   k.copy(base).lerp(n>0?dry:lush,Math.abs(n)*.6).multiplyScalar(.97+rand()*.06);v.push(x,y,0);c.push(k.r,k.g,k.b);}}
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;idx.push(a,a+1,a+nx+2,a,a+nx+2,a+nx+1);}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setIndex(idx);g.computeVertexNormals();
  const m=mesh(g,mat('#ffffff',{vertexColors:true}),[0,0,groundZ]);m.castShadow=false;
 }

 // 平面環線（膠囊形）。軌頂＝path 的 z，車模原點就是輪底。軌距 ±.46：62 款車模底部輪對的橫向位置量出來全在 .42–.48
 // （docs/m9/garage-default/proto/fleet.json），文湖線膠輪 .56 是導引輪，照樣落在道床裡。
 // 半徑 7.6：最長的單節（蒸汽機車連煤水車 5.42）在彎道外甩 .31，內縮 .17。
 function loop({half=18,radius=7.6,cy=.5,bed=.22}={}){
  const length=half*4+2*Math.PI*radius,bedZ=groundZ+bed,railZ=bedZ+.18;
  function sample(s){
   let q=((s+half)%length+length)%length,x,y,heading;
   if(q<half*2){x=-half+q;y=cy-radius;heading=0;}
   else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
   else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}
   else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
   return{x,y,z:railZ,heading};
  }
  const samples=[];for(let i=0;i<1200;i++){const q=sample(i/1200*length);samples.push([q.x,q.y,i/1200*length]);}
  // 最近的軌道點：回傳距離與弧長。
  const nearest=(x,y)=>{let best=Infinity,bs=0;for(const [px,py,s] of samples){const d=Math.hypot(px-x,py-y);if(d<best){best=d;bs=s;}}return{d:best,s:bs};};
  // 沿環線（或其中一段 [s0,s1]）鋪帶狀面：每段給左右兩緣的橫向偏移與高度。同 viaduct.js 的 strips()。
  function strips(material,parts,{s0=0,s1=length,N}={}){
   const n=N??Math.max(8,Math.round((s1-s0)/length*520)),v=[],idx=[];
   for(const [o1,z1,o2,z2] of parts){const base=v.length/3;
    for(let i=0;i<=n;i++){const q=sample(s0+(s1-s0)*i/n),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
     v.push(q.x+sx*o1,q.y+cx*o1,z1,q.x+sx*o2,q.y+cx*o2,z2);
     if(i<n){const k=base+i*2;idx.push(k,k+2,k+1,k+1,k+2,k+3);}}}
   const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);
  }
  return{sample,length,half,radius,cy,bedZ,railZ,frontY:cy-radius,backY:cy+radius,nearest,strips,path:{sample,length}};
 }

 // 道床：道碴梯形斷面、枕木、鋼軌（軌頭＋軌腰）。gaps 是不鋪道碴的弧長區段（鐵橋），那幾段改由橋面托住。
 function track(L,{gaps=[]}={}){
  const ballast=mat('#8a8274'),sleeper=mat('#7a6a55'),steel=mat('#9aa3a4',{metalness:.6,roughness:.34}),railSide=mat('#6e6259',{metalness:.35,roughness:.6});
  sleeper.name='sleeper';
  const runs=[];let start=0;
  for(const [a,b] of [...gaps].sort((p,q)=>p[0]-q[0])){if(a>start)runs.push([start,a]);start=b;}if(start<L.length)runs.push([start,L.length]);
  for(const [s0,s1] of runs)L.strips(ballast,[[-1.45,groundZ,-1.05,L.bedZ],[-1.05,L.bedZ,1.05,L.bedZ],[1.05,L.bedZ,1.45,groundZ]],{s0,s1});
  for(let s=0;s<L.length;s+=.42){const q=L.sample(s);block(sleeper,[.18,1.4,.10],[q.x,q.y,L.bedZ+.01],[0,0,q.heading]);}
  const gauge=.46,railW=.10,railH=.12;
  L.strips(steel,[-gauge,gauge].map(o=>[o-railW/2,L.railZ,o+railW/2,L.railZ])).name='rail-head';
  L.strips(railSide,[-gauge,gauge].flatMap(o=>[[o-railW/2,L.railZ-railH,o-railW/2,L.railZ],[o+railW/2,L.railZ,o+railW/2,L.railZ-railH]])).name='rail-web';
 }

 // 電車線：電桿立在內側，每根帶懸臂與吊架；接觸線一條細帶。接觸線高 railZ+1.98：E200／E500 這類電力機車
 // 升弓的頂點量出來 1.94–1.98、輕軌 2.01，弓剛好頂到線。材質只給電車線用，合批後自成兩個 draw（名字 catenary），
 // bake.mjs 標 DRAW flag 256，原生照車款開關。skip(s) 回傳 true 的弧長不立桿（隧道裡、鐵橋上、雨棚旁）。
 function catenary(L,{skip}){
  const mast=mat('#b9bcb6',{metalness:.5,roughness:.45}),wire=mat('#4c4a46',{metalness:.5,roughness:.4});mast.name='catenary-mast';wire.name='catenary-wire';
  const offset=2.6,wireZ=L.railZ+1.98,top=wireZ+.55,n=Math.round(L.length/7.2),ds=L.length/n;
  for(let k=0;k<n;k++){const s=ds*(k+.5);if(skip(s))continue;const q=L.sample(s),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
   block(mast,[.15,.15,top-groundZ],[q.x+sx*offset,q.y+cx*offset,(top+groundZ)/2],[0,0,q.heading]);
   block(mast,[.08,offset+.2,.08],[q.x+sx*offset/2,q.y+cx*offset/2,wireZ+.42],[0,0,q.heading]);
   block(mast,[.06,.06,.42],[q.x,q.y,wireZ+.21],[0,0,q.heading]);
  }
  L.strips(wire,[[-.015,wireZ,.015,wireZ]]).name='catenary';
 }

 // 下承式鋼鈑梁橋：兩片側梁沿弧長 [s0,s1] 走（彎道上也照曲線），橋面板、加勁板、兩端橋台。
 function girderBridge(L,s0,s1){
  const girder=mat('#55626a',{metalness:.45,roughness:.5,side:THREE.DoubleSide}),deckMat=mat('#8c877c'),abut=mat('#b8b1a2');girder.name='bridge-girder';
  L.strips(deckMat,[[-1.15,L.bedZ,1.15,L.bedZ],[1.15,L.bedZ,1.15,L.bedZ-.32],[1.15,L.bedZ-.32,-1.15,L.bedZ-.32],[-1.15,L.bedZ-.32,-1.15,L.bedZ]],{s0,s1});
  const gt=L.railZ+.42,gb=L.bedZ-.36;
  L.strips(girder,[[-1.0,gb,-1.0,gt],[-1.12,gt,-1.12,gb],[-1.12,gt,-1.0,gt],[1.0,gt,1.0,gb],[1.12,gb,1.12,gt],[1.0,gt,1.12,gt]],{s0,s1});
  for(let s=s0+.3;s<s1;s+=.62){const q=L.sample(s);for(const o of [-1.16,1.16])block(girder,[.06,.07,gt-gb-.08],[q.x-Math.sin(q.heading)*o,q.y+Math.cos(q.heading)*o,(gt+gb)/2],[0,0,q.heading]);}
  for(const s of [s0,s1]){const q=L.sample(s);block(abut,[1.0,3.0,L.bedZ-groundZ+.1],[q.x,q.y,(L.bedZ+groundZ)/2-.05],[0,0,q.heading]);}
 }

 // 隧道口：一面石砌門牆，拱形開口（Shape＋hole 擠出），兩側翼牆；朝向跟著那一點的軌道切線。dir=+1 門面朝弧長增加的方向。
 function portal(L,s,dir){
  const q=L.sample(s),w=3.6,h=3.3,aw=2.3,ah=2.55,depth=.5,stone='#a39d8f';
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,h);shape.lineTo(-w/2,h);shape.closePath();
  const hole=new THREE.Path();hole.moveTo(-aw/2,0);hole.lineTo(aw/2,0);hole.lineTo(aw/2,ah-aw/2);hole.absarc(0,ah-aw/2,aw/2,0,Math.PI,false);hole.lineTo(-aw/2,0);shape.holes.push(hole);
  const g=geo(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:10}));
  // 擠出方向是 +z、牆面在 x-y：轉成牆面立在 (橫向, 上)，擠出沿軌道切線。
  g.rotateX(Math.PI/2);g.rotateZ(Math.PI/2);g.translate(-depth/2,0,0);
  const m=mesh(g,mat(stone),[q.x,q.y,L.bedZ-.05]);m.rotation.z=q.heading;m.name='tunnel-portal';
  const cap=mat('#8d877a');block(cap,[depth+.2,w+.3,.22],[q.x,q.y,L.bedZ-.05+h+.08],[0,0,q.heading]);
  for(const side of [-1,1]){const ox=-Math.sin(q.heading)*side*(w/2+1.0),oy=Math.cos(q.heading)*side*(w/2+1.0);
   block(mat(stone),[.4,2.2,2.2],[q.x+ox+Math.cos(q.heading)*dir*.6,q.y+oy+Math.sin(q.heading)*dir*.6,L.bedZ+1.0],[0,0,q.heading+side*dir*.5]);}
 }

 // 隧道內襯：兩面側牆＋頂板，深色、雙面，從門口看進去是暗的，不會透出山體網格的背面。
 function tunnelLining(L,s0,s1){
  const lining=mat('#2b2a28',{side:THREE.DoubleSide,roughness:1});lining.name='tunnel-lining';
  const top=L.railZ+2.45;L.strips(lining,[[-1.2,L.bedZ-.05,-1.2,top],[-1.2,top,1.2,top],[1.2,top,1.2,L.bedZ-.05]],{s0,s1});
 }

 // 地形網格：給一個高度函式，在 [x0,x1]×[y0,y1] 鋪格子，頂點收進底座圓角；頂點色從低到高。drop(三頂點座標) 回傳 true 的三角形不畫。
 function terrain(fn,{x0,x1,y0,y1,step=.45,colors=['#7f9068','#6c8259','#5b7349'],jitter=.06,name='hills',drop}){
  const nx=Math.round((x1-x0)/step),ny=Math.round((y1-y0)/step),v=[],c=[],idx=[],cols=colors.map(x=>new THREE.Color(x));
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){let x=x0+(x1-x0)*i/nx;const y=y0+(y1-y0)*j/ny,lim=rimX(y)-.15;x=Math.max(-lim,Math.min(lim,x));
   const h=fn(x,y);v.push(x,y,groundZ+.02+h);const t=Math.min(1,h/5),k=t<.5?cols[0].clone().lerp(cols[1],t*2):cols[1].clone().lerp(cols[2],(t-.5)*2);k.multiplyScalar(1-jitter/2+rand()*jitter);c.push(k.r,k.g,k.b);}
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*(nx+1)+i;for(const t of [[k,k+1,k+nx+1],[k+1,k+nx+2,k+nx+1]])if(!drop?.(t.map(n=>v.slice(n*3,n*3+3))))idx.push(...t);}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setIndex(idx);g.computeVertexNormals();
  const m=mesh(g,mat('#ffffff',{vertexColors:true,flatShading:true}));m.name=name;
 }

 // 溪／埤塘：跟十分老街那條基隆河同一套水面 shader（原生端的水面種類 2，參數＝寬度的一半），水面沿 x。
 function river(x0,x1,y0,y1,{water,shallow}){
  const w=y1-y0,m=mat(water,{roughness:.32,metalness:.14});
  const o=mesh(geo(new THREE.PlaneGeometry(x1-x0,w,1,1)),m,[(x0+x1)/2,(y0+y1)/2,groundZ+.04]);o.castShadow=false;o.name='river';
  m.onBeforeCompile=s=>{
   s.uniforms.seaTime={value:0};s.uniforms.shallow={value:new THREE.Color(shallow)};m.userData.shader=s;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 seaPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nseaPosition=position;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float seaTime; uniform vec3 shallow; varying vec3 seaPosition;').replace('#include <color_fragment>',`#include <color_fragment>
  float d=${(w/2).toFixed(2)}-abs(seaPosition.y);
  float wave=sin(seaPosition.x*1.7-seaTime*1.1+sin(seaPosition.y*2.3)*.8);
  float foam=smoothstep(.85,1.0,wave)*(1.0-smoothstep(0.,1.1,d));
  diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*1.4)*.7)+foam*.16;`);
  };
  return m;
 }

 // 光池：燈下一片加法混色的暖色圓盤，白天隱藏（viaduct.js 同一個作法，點光源只留少數幾盞）。
 const poolTex=typeof document==='undefined'?null:(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.5,'rgba(255,255,255,.5)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();
 const poolMat=new THREE.MeshBasicMaterial({color:'#ffd9a0',map:poolTex,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});poolMat.name='lamp-pool';materials.add(poolMat);
 const disc=geo(new THREE.CircleGeometry(1,24));
 const pool=(x,y,z,rx,ry=rx)=>instance(disc,poolMat,[x,y,z],[rx,ry,1]);
 const lights=[];
 function light(x,y,z,k=1,dist=7,color='#ffd193'){const l=new THREE.PointLight(color,0,dist,2);l.position.set(x,y,z);l.userData.k=k;group.add(l);lights.push(l);return l;}

 const props=createProps({geo,mat,instance,rand});

 // 稻田：一塊水田（每塊水色略不同），四邊田埂長幾撮草。秧苗期是一叢一叢插成格子、看得到水；黃熟期是一排排高一點的稻穗，分段、高低不齊。
 function paddy(x,y,w,d,{phase='young',tint=0}={}){
  const row=paddyMats.rows[phase][tint%paddyMats.rows[phase].length];
  block(paddyMats.mud,[w,d,.05],[x,y,groundZ+.03],[0,0,0],tone('#ffffff',.93+rand()*.12));
  for(const [dx,dy,sx,sy] of [[0,d/2,w+.24,.24],[0,-d/2,w+.24,.24],[w/2,0,.24,d],[-w/2,0,.24,d]])block(paddyMats.ridge,[sx,sy,.12],[x+dx,y+dy,groundZ+.06]);
  for(let i=0;i<7;i++){const t=rand()-.5,side=Math.floor(rand()*4),px=side<2?x+t*w:x+(side===2?w/2:-w/2),py=side<2?y+(side?d/2:-d/2):y+t*d;instance(stoneGeo,paint,[px,py,groundZ+.12],[.15,.11,.07],[0,0,rand()*3],jit('#7d9a52',.1));}
  const n=Math.max(2,Math.floor((d-.4)/.34));
  for(let i=0;i<n;i++){const ry=y-d/2+.35+i*(d-.7)/(n-1);
   if(phase==='young')for(let cx=x-w/2+.38;cx<x+w/2-.3;cx+=.3)instance(tuft,row,[cx+(rand()-.5)*.03,ry+(rand()-.5)*.03,groundZ+.05],[.21,.18,.12+rand()*.06],[0,0,rand()*.6],tone('#ffffff',.88+rand()*.22));
   else{const seg=(w-.45)/3;for(let j=0;j<3;j++){const hz=.24+rand()*.07;block(row,[seg-.06,.17,hz],[x-(w-.45)/2+seg*(j+.5),ry,groundZ+.04+hz/2],[(rand()-.5)*.12,0,0],tone('#ffffff',.88+rand()*.2));}}
  }
 }
 const paddyMats={mud:mat('#8a9a86',{roughness:.35,metalness:.05}),ridge:mat('#a99a76'),rows:{young:['#8db35a','#7fa851','#98ba63'].map(c=>mat(c)),gold:['#d1b45a','#c9a94e','#dcc06a'].map(c=>mat(c))}};
 paddyMats.mud.name='paddy-water';

 // 樹：七種樹形，不再整片同一種球。樹冠每團隨機用二十面體或十二面體、各自轉一點，下層暗、上層亮，每棵抽一個底色再逐團抖。
 const GREEN={broad:['#4e7158','#5a7a52','#668363','#73905e','#56764a'],light:['#7f9a5a','#8ea563','#9aae6c','#86a05f'],dark:['#3f6347','#466b4c','#3b5a44','#4b6a50'],grey:['#6a8064','#768a6a','#62775e']};
 const BARK='#6f6450',pick=a=>a[Math.floor(rand()*a.length)];
 const crown=(x,y,z,sx,sy,sz,yaw,color)=>instance(rand()<.7?stoneGeo:dodeca,paint,[x,y,z],[sx,sy,sz],[(rand()-.5)*.5,(rand()-.5)*.5,yaw],color);
 const branch=(x,y,z,h,a,tilt,w)=>instance(box,paint,[x+Math.cos(a)*Math.sin(tilt)*h/2,y+Math.sin(a)*Math.sin(tilt)*h/2,z+Math.cos(tilt)*h/2],[w,w,h],[0,tilt,a],jit(BARK));
 // 闊葉雜木：錐形樹幹、兩根斜枝，樹冠上下兩層共 5–7 團。
 function broadleaf(x,y,z,h=2.2,pal=GREEN.broad){
  const base=pick(pal),yaw=rand()*Math.PI*2,n=5+Math.floor(rand()*3),r=h*.24;
  instance(trunkGeo,paint,[x,y,z],[.075*h,.075*h,h*.55],[0,0,yaw],jit(BARK));
  for(const a of [yaw,yaw+Math.PI])branch(x,y,z+h*.4,h*.3,a,.6,.03*h);
  for(let j=0;j<n;j++){const top=j>=n-2,a=yaw+j*2.4,rr=top?r*.45*rand():r*(.75+rand()*.35),s=h*(top?.22:.27)*(.85+rand()*.3);
   crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(top?.88:.66)+(rand()-.5)*.08*h,s,s*(.85+rand()*.2),s*.8,a,tone(base,(top?1.12:.9)*(.93+rand()*.14)));}
 }
 // 樟樹：短粗的幹分三叉，淺黃綠的樹冠又寬又扁。
 function camphor(x,y,z,h=2.4){
  const base=pick(GREEN.light),yaw=rand()*Math.PI*2,n=7+Math.floor(rand()*3);
  instance(trunkGeo,paint,[x,y,z],[.09*h,.09*h,h*.45],[0,0,yaw],jit('#6a5f4c'));
  for(let j=0;j<3;j++)branch(x,y,z+h*.38,h*.34,yaw+j*2.09,.85,.035*h);
  for(let j=0;j<n;j++){const top=j>=n-2,a=yaw+j*2.4,rr=top?h*.12:h*(.28+rand()*.12),s=h*.24*(.85+rand()*.3);
   crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(top?.8:.66),s*1.1,s,s*.6,a,tone(base,(top?1.1:.9)*(.93+rand()*.14)));}
 }
 // 榕樹：粗短主幹加兩根副幹，深綠的樹冠又寬又低，冠下垂幾條氣根。廟口、村口那一棵。
 function banyan(x,y,z,h=2.6){
  const base=pick(GREEN.dark),yaw=rand()*Math.PI*2,n=10+Math.floor(rand()*3),R=h*.48;
  instance(trunkGeo,paint,[x,y,z],[.16*h,.16*h,h*.5],[0,0,yaw],jit('#6b6255'));
  for(const a of [yaw+.8,yaw+3.3])instance(trunkGeo,paint,[x+Math.cos(a)*.08*h,y+Math.sin(a)*.08*h,z],[.07*h,.07*h,h*.48],[0,.28,a],jit('#6b6255'));
  for(let j=0;j<n;j++){const top=j>=n-3,a=yaw+j*2.4,rr=top?R*.35*rand():R*(.55+rand()*.45),s=h*(top?.28:.24)*(.85+rand()*.3);
   crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(top?.86:.68),s*1.15,s,s*.62,a,tone(base,(top?1.12:.88)*(.93+rand()*.14)));}
  for(let j=0;j<7;j++){const a=rand()*Math.PI*2,rr=R*(.35+rand()*.5),l=h*(.25+rand()*.25);instance(box,paint,[x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*.6-l/2],[.025,.025,l],[0,0,a],jit('#7d7466'));}
 }
 // 龍柏：三節圓錐往上收，深綠、每節扭一點。
 function cypress(x,y,z,h=2.6){
  const base=pick(GREEN.dark),yaw=rand()*Math.PI*2;
  instance(trunkGeo,paint,[x,y,z],[.06*h,.06*h,h*.3],[0,0,yaw],jit(BARK));
  for(let j=0;j<3;j++){const r=h*(.22-j*.05);instance(cone,paint,[x+(rand()-.5)*.06*h,y+(rand()-.5)*.06*h,z+h*(.15+j*.25)],[r,r*(.9+rand()*.15),h*(.45-j*.07)],[0,0,yaw+j],tone(base,(.88+j*.1)*(.94+rand()*.12)));}
 }
 // 木麻黃：細高的幹，灰綠、往下垂的長橢圓樹冠（田邊、溪邊的防風林）。
 function casuarina(x,y,z,h=3.4){
  const base=pick(GREEN.grey),yaw=rand()*Math.PI*2;
  instance(trunkGeo,paint,[x,y,z],[.055*h,.055*h,h*.85],[0,0,yaw],jit('#6d6556'));
  for(let j=0;j<5;j++){const a=yaw+j*2.4,rr=j===4?0:h*.09,s=h*(.11+rand()*.03);crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(.5+j*.1),s,s*.9,s*2.1,a,tone(base,(.88+j*.05)*(.93+rand()*.14)));}
 }
 // 開花樹：鳳凰木（紅）、阿勃勒（黃）。樹冠一半綠一半花色，頂上再點幾簇花。
 function blossom(x,y,z,h,flower){
  const yaw=rand()*Math.PI*2,green=pick(GREEN.broad),n=8;
  instance(trunkGeo,paint,[x,y,z],[.08*h,.08*h,h*.5],[0,0,yaw],jit(BARK));
  for(let j=0;j<3;j++)branch(x,y,z+h*.42,h*.3,yaw+j*2.09,.8,.03*h);
  for(let j=0;j<n;j++){const top=j>=n-2,a=yaw+j*2.4,rr=top?h*.1:h*(.25+rand()*.15),s=h*.22*(.85+rand()*.3);
   crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(top?.84:.66),s*1.1,s,s*.65,a,j%2||top?jit(flower,.08):tone(green,.9*(.93+rand()*.14)));}
  for(let j=0;j<6;j++){const a=rand()*Math.PI*2,rr=h*.3*rand();crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(.86+rand()*.08),h*.08,h*.07,h*.05,a,jit(flower,.1));}
 }
 // 果樹：矮圓的深綠樹冠，掛幾個白色套袋（芒果園）。
 function fruit(x,y,z,h=1.4){broadleaf(x,y,z,h,GREEN.dark);for(let j=0;j<5;j++){const a=rand()*Math.PI*2,rr=h*(.3+rand()*.15);instance(box,paint,[x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+h*(.45+rand()*.25)],[.07,.07,.1],[0,0,a],jit('#efe9d8',.04));}}
 // 灌木：兩三團壓扁的樹冠；flower 給了就點幾朵花（九重葛、杜鵑）。
 function shrub(x,y,z,s=.5,flower){const base=pick(GREEN.broad);for(let j=0;j<3;j++){const a=rand()*Math.PI*2,rr=s*.45*rand();crown(x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+s*.35,s*(.8+rand()*.4),s*(.7+rand()*.3),s*.55,a,tone(base,.9+rand()*.2));}
  if(flower)for(let j=0;j<4;j++){const a=rand()*Math.PI*2,rr=s*.6*rand();instance(stoneGeo,paint,[x+Math.cos(a)*rr,y+Math.sin(a)*rr,z+s*.6],[s*.2,s*.2,s*.15],[0,0,a],jit(flower,.08));}}
 // 檳榔：灰白樹幹帶一圈深色節、頂端一段綠色葉鞘，七片拱形羽葉往四周垂，葉鞘下一串果。
 function betel(x,y,z=groundZ,h=3.2){
  const lean=rand()*.06,dir=rand()*Math.PI*2,ax=Math.sin(lean)*Math.cos(dir),ay=Math.sin(lean)*Math.sin(dir),az=Math.cos(lean),at=t=>[x+ax*t,y+ay*t,z+az*t],rot=[0,lean,dir];
  instance(trunkGeo,paint,[x,y,z],[.085,.085,h],rot,jit('#9a9282',.06));
  instance(trunkGeo,paint,at(h*.6),[.08,.08,.05],rot,tone('#6f6a5e'));
  instance(trunkGeo,paint,at(h-.02),[.075,.075,.42],rot,jit('#6f8f4a',.06));
  const top=at(h+.38);
  for(let k=0;k<7;k++){const len=.85+rand()*.35;instance(frond,paint2,top,[len,1.3,len],[0,-.35+rand()*.45,dir+k*Math.PI*2/7+(rand()-.5)*.3],jit(pick(['#5f7e45','#6a8a4c','#58773f']),.06));}
  instance(box,paint,at(h+.58),[.035,.035,.4],rot,jit('#6f8f4a'));
  const f=at(h-.05);instance(stoneGeo,paint,[f[0]+Math.cos(dir+2)*.1,f[1]+Math.sin(dir+2)*.1,f[2]],[.09,.09,.13],[0,0,dir],jit(rand()<.5?'#c98a3a':'#8a9a3a'));
 }
 // 竹叢：十來根細竹竿往外斜，竿頂各一團往外垂的竹葉，中段再補幾團。
 function bamboo(x,y,z=groundZ,h=3.0){
  const n=10+Math.floor(rand()*4);
  for(let k=0;k<n;k++){const a=rand()*Math.PI*2,r=rand()*.32,tilt=.05+r*.4+rand()*.1,hh=h*(.7+rand()*.35),bx=x+Math.cos(a)*r,by=y+Math.sin(a)*r,sx=Math.sin(tilt)*Math.cos(a),sy=Math.sin(tilt)*Math.sin(a),sz=Math.cos(tilt);
   instance(box,paint,[bx+sx*hh/2,by+sy*hh/2,z+sz*hh/2],[.045,.045,hh],[0,tilt,a],jit('#86a257',.1));
   instance(stoneGeo,paint,[bx+sx*hh*.95,by+sy*hh*.95,z+sz*hh*.92],[.2,.2,.55],[0,tilt+.5,a],jit(pick(['#8fae63','#7fa155','#9bb56c']),.08));}
  for(let k=0;k<4;k++){const a=rand()*Math.PI*2;instance(stoneGeo,paint,[x+Math.cos(a)*.42,y+Math.sin(a)*.42,z+h*(.45+rand()*.3)],[.5,.42,.5],[0,0,a],jit('#7fa155',.08));}
 }

 // 瓦斜頂：三角柱＋瓦溝（順坡的細條）、瓦列（橫的細條）、簷口封板、兩端破風板、屋脊；swallow 屋脊兩端燕尾翹起。
 // line 是瓦溝相對屋瓦的明暗（深色瓦用亮一點的線才看得出來）。
 function tiledRoof(x,y,z,len,span,rise,yaw,color,{rows=5,step=.26,swallow=false,line=.82}={}){
  const c=Math.cos(yaw),s=Math.sin(yaw),at=(lx,ly,lz)=>[x+c*lx-s*ly,y+s*lx+c*ly,z+lz];
  const base=jit(color,.04),dark=base.clone().multiplyScalar(line),hs=span/2,sl=Math.hypot(hs,rise),th=Math.atan2(rise,hs),off=.018;
  instance(prism,paint,[x,y,z],[len,span,rise],[0,0,yaw],base);
  for(const side of [-1,1]){const nY=side*rise/sl*off,nZ=hs/sl*off,a=-side*th;
   for(let i=1;i<rows;i++){const u=i/rows;instance(box,paint,at(0,side*hs*(1-u)+nY,rise*u+nZ),[len,.04,.03],[a,0,yaw],dark);}
   for(let lx=-len/2+step/2;lx<len/2;lx+=step)instance(box,paint,at(lx,side*hs/2+nY,rise/2+nZ),[.035,sl,.03],[a,0,yaw],dark);
   instance(box,paint,at(0,side*hs,-.04),[len+.04,.05,.1],[0,0,yaw],dark);
   for(const e of [-1,1])instance(box,paint,at(e*(len/2+.01),side*hs/2+nY,rise/2+nZ),[.05,sl+.04,.1],[a,0,yaw],dark);
  }
  instance(box,paint,at(0,0,rise+.03),[len+.06,.15,.12],[0,0,yaw],dark);
  if(swallow)for(const e of [-1,1]){instance(box,paint,at(e*(len/2+.18),0,rise+.12),[.42,.1,.08],[0,-e*.5,yaw],dark);instance(box,paint,at(e*(len/2+.4),0,rise+.28),[.2,.06,.05],[0,-e*1.0,yaw],dark);}
 }

 // 電線桿：水泥桿、橫擔垂直於電線方向（dir）、三顆礙子；trans 掛一顆變壓器。回傳三個掛線點與一個低處的電信纜掛點。
 function pole(x,y,z,{h=3.2,dir=0,trans=false}={}){
  const c=Math.cos(dir),s=Math.sin(dir);
  instance(cyl,paint,[x,y,z+h/2],[.16,.16,h],[0,0,0],jit('#b9b3a4',.04));
  instance(box,paint,[x,y,z+h-.18],[.95,.07,.07],[0,0,dir+Math.PI/2],tone('#3a4548'));
  for(const o of [-.38,0,.38])instance(box,paint,[x-s*o,y+c*o,z+h-.1],[.06,.06,.1],[0,0,dir],tone('#e9e6dc'));
  if(trans){instance(cyl,paint,[x-s*.2,y+c*.2,z+h-.95],[.3,.3,.48],[0,0,0],tone('#8f9597'));instance(box,paint,[x-s*.1,y+c*.1,z+h-.75],[.05,.22,.05],[0,0,dir],tone('#5a5f62'));}
  return{lines:[-.38,0,.38].map(o=>[x-s*o,y+c*o,z+h-.05]),cable:[x-s*.1,y+c*.1,z+h-.85]};
 }
 // 電線：兩點之間分三段、中間下垂。
 function wire(a,b,{sag=.14,w=.02,color='#34383a'}={}){
  const pts=[];for(let i=0;i<=3;i++){const t=i/3;pts.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t-sag*4*t*(1-t)]);}
  for(let i=0;i<3;i++){const p=pts[i],q=pts[i+1],dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2],hl=Math.hypot(dx,dy);
   instance(box,paint,[(p[0]+q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2],[Math.hypot(hl,dz)+.01,w,w],[0,-Math.atan2(dz,hl),Math.atan2(dy,dx)],tone(color));}
 }

 // 收尾前把「純色」材質（不自發光、不透明、沒貼圖、沒自訂 shader、沒名字）併成同幾何一個白色共用材質，
 // 原本的顏色乘進 instanceColor：畫面不變，draw 從一百多降到四十幾（四座是 25–58）。會在 update() 改色的只有水面，水面不在合批裡。
 const plain=m=>m.isMeshStandardMaterial&&!m.transparent&&!m.map&&m.onBeforeCompile===THREE.Material.prototype.onBeforeCompile&&!m.name&&m.emissive.getHex()===0&&!m.vertexColors;
 const shared=new Map();
 function mergePlain(){
  for(const [,byMaterial] of batches){const merged=new Map();
   for(const [material,items] of [...byMaterial]){if(!plain(material))continue;
    const key=`${material.roughness}|${material.metalness}|${material.side}|${material.flatShading}`;
    if(!shared.has(key)){const s=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:material.roughness,metalness:material.metalness,side:material.side,flatShading:material.flatShading});materials.add(s);shared.set(key,s);}
    const s=shared.get(key);if(!merged.has(s))merged.set(s,[]);
    for(const it of items)merged.get(s).push({...it,color:(it.color?new THREE.Color(it.color):new THREE.Color(1,1,1)).multiply(material.color)});
    byMaterial.delete(material);}
   for(const [s,items] of merged)byMaterial.set(s,items);}
 }
 function finish(){
  mergePlain();
  for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
   const o=new THREE.InstancedMesh(geometry,material,items.length);
   items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);if(it.color)o.setColorAt(i,new THREE.Color(it.color));});
   if(items.some(it=>it.color))for(let i=0;i<items.length;i++)if(!items[i].color)o.setColorAt(i,new THREE.Color(1,1,1));
   o.castShadow=o.receiveShadow=true;o.instanceMatrix.needsUpdate=true;if(material.name.startsWith('catenary'))o.name='catenary';group.add(o);
  }
  for(const o of group.children)if(o.isInstancedMesh&&o.material===poolMat)o.castShadow=o.receiveShadow=false;
 }
 const poolMesh=()=>group.children.find(o=>o.isInstancedMesh&&o.material===poolMat);
 function dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());poolTex?.dispose();}
 return{group,rand,geo,mat,box,stoneGeo,cone,cyl,paint,tone,jit,smooth,instance,block,groundZ,rimX,plinth,loop,track,catenary,girderBridge,portal,tunnelLining,terrain,river,pool,poolMat,poolMesh,light,lights,props,paddy,
  broadleaf,camphor,banyan,cypress,casuarina,blossom,fruit,shrub,betel,bamboo,GREEN,tiledRoof,pole,wire,capture,finish,dispose};
}

export function createScene(params = {}){
 const p={label:'田園小站',...params};
 const k=createKit(31847),{block,instance,mat,rand,groundZ,props,paint,tone,jit,cyl}=k;
 k.plinth('#86966c');
 const L=k.loop({half:18,radius:7.6,cy:.5});
 const sApexE=L.half+Math.PI/2*L.radius;

 // ── 東側彎道：埤塘的水從環內流出，在彎道頂點鑽過鋼鈑梁橋，流出台子邊。
 const streamY0=-.7,streamY1=1.7,bridgeHalf=2.6;
 const bridge=[sApexE-bridgeHalf,sApexE+bridgeHalf];
 // ── 西側彎道：小山蓋過彎道頂點，中間一段是隧道。山高 5.2，頂點附近的山面高過隧道內襯（軌頂上 2.45）才算隧道。
 const hill=(x,y)=>6.0*Math.max(0,1-((x+28.2)/7.2)**2-((y-.5)/8.2)**2)**1.1*k.smooth((k.rimX(y)-Math.abs(x))/2.4);
 const roofH=L.railZ-groundZ+2.6;
 let tIn=null,tOut=null;for(let s=L.half*3+Math.PI*L.radius;s<L.half*3+2*Math.PI*L.radius;s+=.05){const q=L.sample(s);if(hill(q.x,q.y)>roofH){tIn??=s;tOut=s;}}
 const inTunnel=s=>s>tIn&&s<tOut;
 k.track(L,{gaps:[bridge]});

 // 地形：西側小山（隧道口外挖出路塹，隧道段山面至少蓋過內襯），後方一排緩丘。
 const westHill=(x,y)=>{let h=hill(x,y);const n=L.nearest(x,y);if(n.d<4){if(inTunnel(n.s)){if(n.d<1.7)h=Math.max(h,roofH+.15);}else h=Math.min(h,Math.max(0,(n.d-1.75)*.9));}return h;};
 // 隧道口那一格：路塹底（0）跟隧道頂（3.15）之間會拉出一片陡坡，正好落在拱門開口裡，從外面看是一面綠牆、車開進去就不見
 // （10-27 使用者實機看到）。軌道走廊上落差超過 1.5 的三角形不畫，缺口由門牆、帽石與內襯蓋住。
 const portalRamp=t=>{const z=t.map(p=>p[2]);return Math.max(...z)-Math.min(...z)>1.5&&L.nearest((t[0][0]+t[1][0]+t[2][0])/3,(t[0][1]+t[1][1]+t[2][1])/3).d<1.75;};
 k.terrain(westHill,{x0:-33,x1:-14.5,y0:-11,y1:12,step:.42,drop:portalRamp});
 const backHill=(x,y)=>{const bumps=[[-24,19,10,5,4.2],[-10,20,11,5.5,5.4],[5,19.5,10,5,4.4],[19,20,12,5.5,5.8],[30,18,6,4,3.6]];let h=0;for(const [cx,cy,rx,ry,hz] of bumps){const d=((x-cx)/rx)**2+((y-cy)/ry)**2;h=Math.max(h,hz*Math.max(0,1-d)**1.3);}return h*k.smooth((y-12.2)/2.2)*k.smooth((20-y)/1.2)*k.smooth((k.rimX(y)-Math.abs(x))/1.5)*(Math.abs(x+28)<6&&y<14?0:1);};
 k.terrain(backHill,{x0:-33,x1:33,y0:12,y1:20,step:.55,name:'back-hills'});
 k.portal(L,tIn,-1);k.portal(L,tOut,1);k.tunnelLining(L,tIn-.3,tOut+.3);
 {const wall=mat('#a39d8f');for(const [a,b,dir] of [[tIn-4.2,tIn,-1],[tOut,tOut+4.2,1]])for(let s=a;s<b;s+=.5){const q=L.sample(s),u=dir<0?(s-a)/(b-a):1-(s-a)/(b-a),h=.5+2.3*u;for(const side of [-1,1])block(wall,[.52,.3,h],[q.x-Math.sin(q.heading)*side*1.75,q.y+Math.cos(q.heading)*side*1.75,groundZ+h/2],[0,0,q.heading]);}}

 // 溪與埤塘（原生水面種類 2，兩片各自一個材質）。
 const pondX0=9.2,pondX1=16.6,pondY0=-3.4,pondY1=3.9;
 const pondMat=k.river(pondX0,pondX1,pondY0,pondY1,{water:THEMES.day.water,shallow:THEMES.day.shallow});
 const streamMat=k.river(pondX1,32.9,streamY0,streamY1,{water:THEMES.day.water,shallow:THEMES.day.shallow});
 const gravel=mat('#a49a86'),bank=mat('#b3a98f');
 for(let i=0;i<46;i++){const t=rand();let x,y;if(i<22){x=pondX0+(pondX1-pondX0)*t;y=i%2?pondY0-.25:pondY1+.25;}else if(i<30){y=pondY0+(pondY1-pondY0)*t;x=pondX0-.25;if(y>streamY0-.3&&y<streamY1+.3)continue;}else{x=pondX1+(32-pondX1)*t;y=i%2?streamY0-.22:streamY1+.22;if(Math.abs(x-25.6)<2.8)continue;}
  block(i%3?gravel:bank,[.35+rand()*.5,.3+rand()*.35,.14+rand()*.16],[x+(rand()-.5)*.2,y+(rand()-.5)*.2,groundZ+.07],[0,0,rand()*Math.PI]);}
 for(const side of [-1,1])for(let x=pondX1;x<33;x+=1.3)if(Math.abs(x-25.6)>2.9)block(bank,[1.25,.14,.1],[x+.6,side<0?streamY0-.05:streamY1+.05,groundZ+.06]);
 // 埤塘東北角一片荷葉（幾朵粉紅荷花），塘邊幾叢蘆葦。
 for(let i=0;i<24;i++){const r=.14+rand()*.12;instance(cyl,paint,[13.2+rand()*3.1,1.0+rand()*2.6,groundZ+.055],[r*2,r*2,.02],[0,0,0],jit('#5f8a4a',.1));}
 for(let i=0;i<5;i++)instance(k.stoneGeo,paint,[13.4+rand()*2.8,1.2+rand()*2.3,groundZ+.13],[.06,.06,.07],[0,0,rand()*3],jit('#e58aa6',.06));
 for(const [x,y] of [[9.4,-3.2],[10.6,-3.55],[9.05,1.9],[12.8,4.05],[15.1,4.05],[16.4,-3.3]])for(let j=0;j<5;j++){const a=rand()*Math.PI*2,t=.12+rand()*.15,hh=.45+rand()*.25;instance(k.box,paint,[x+Math.cos(a)*(.06+Math.sin(t)*hh/2),y+Math.sin(a)*(.06+Math.sin(t)*hh/2),groundZ+Math.cos(t)*hh/2],[.025,.025,hh],[0,t,a],jit('#8a9a55',.1));}
 k.girderBridge(L,...bridge);

 // ── 前直線：木造小站（側式月台、雨棚、站房），西邊一處平交道。
 const fy=L.frontY,platTop=L.railZ+.12,platY0=fy-1.0,platY1=fy-2.9,stX0=1.5,stX1=15.5;
 const concrete=mat('#c9c2b2'),edge=mat('#ece6d6'),yellow=mat('#d8b451'),wood=mat('#8b6a4a'),woodDark=mat('#5d4634'),plaster=mat('#ece4d0'),roofTile=mat('#4e5a5e'),trim=mat('#7d5b3f'),blue=mat('#3d6fa3');
 block(concrete,[stX1-stX0,platY0-platY1,platTop-groundZ],[(stX0+stX1)/2,(platY0+platY1)/2,(groundZ+platTop)/2]);
 block(edge,[stX1-stX0,.14,.02],[(stX0+stX1)/2,platY0-.07,platTop+.01]);block(yellow,[stX1-stX0-.4,.08,.02],[(stX0+stX1)/2,platY0-.42,platTop+.01]);
 // 月台：鋪面接縫、西端斜坡、東端下到便道的階梯、背側矮欄杆。
 for(let x=stX0+1.2;x<stX1-.3;x+=1.2)block(paint,[.03,1.3,.006],[x,platY1+.65,platTop+.003],[0,0,0],tone('#aaa395'));
 block(concrete,[1.3,platY0-platY1,.06],[stX0-.55,(platY0+platY1)/2,(platTop+groundZ)/2],[0,-.41,0]);
 for(let i=0;i<3;i++){const hz=(3-i)*(platTop-groundZ)/3;block(concrete,[1.0,.24,hz],[stX1-.8,platY1-.12-i*.24,groundZ+hz/2]);}
 for(const [a,b] of [[stX0+.3,5.0],[12.0,13.9]]){const n=Math.max(1,Math.round((b-a)/.7));for(let i=0;i<=n;i++)block(paint,[.05,.05,.5],[a+(b-a)*i/n,platY1+.07,platTop+.25],[0,0,0],tone('#e9e5d8'));for(const z of [.3,.47])block(paint,[b-a,.03,.04],[(a+b)/2,platY1+.07,platTop+z],[0,0,0],tone('#e9e5d8'));}
 // 雨棚：木柱（石柱礎、兩根斜撐）、桁與椽，單斜鐵皮頂往站房那側低，頂上一條條浪板紋，高側封簷板、低側簷溝。
 const cX0=4.5,cX1=12.5,cTop=platTop+2.35,cy0=(platY0+platY1)/2-.05,slope=.1,postY=platY1+.55,roofZ=yy=>cTop+.08+(yy-cy0)*Math.tan(slope);
 for(let x=cX0;x<=cX1+.01;x+=2){
  block(wood,[.14,.14,cTop-platTop],[x,postY,platTop+(cTop-platTop)/2]);block(concrete,[.24,.24,.1],[x,postY,platTop+.05]);
  for(const s of [-1,1])block(wood,[.06,.06,.6],[x+s*.2,postY,cTop-.32],[0,s*.75,0]);
  block(wood,[.09,2.4,.09],[x,cy0,roofZ(cy0)-.095],[slope,0,0]);
 }
 block(wood,[cX1-cX0+.5,.14,.16],[(cX0+cX1)/2,postY,cTop-.1]);
 block(roofTile,[cX1-cX0+1.2,2.5,.09],[(cX0+cX1)/2,cy0,cTop+.08],[slope,0,0]);
 for(let x=cX0-.45;x<=cX1+.46;x+=.3)block(paint,[.035,2.5,.02],[x,cy0-.055*Math.sin(slope),cTop+.08+.055*Math.cos(slope)],[slope,0,0],tone('#5d6a6e'));
 block(trim,[cX1-cX0+1.2,.08,.18],[(cX0+cX1)/2,cy0+1.25,roofZ(cy0+1.25)+.02]);
 block(paint,[cX1-cX0+1.2,.12,.09],[(cX0+cX1)/2,cy0-1.27,roofZ(cy0-1.25)-.03],[0,0,0],tone('#6e767a'));
 // 雨棚下：吊鐘、兩盞吊燈、三張有靠背的長椅、兩個垃圾桶；月台兩端各一面站名牌（白板、藍帶、幾格深色當字）。
 {const x=8.5,yy=cy0+.5,top=roofZ(yy)-.045;block(paint,[.02,.02,.3],[x,yy,top-.15],[0,0,0],tone('#3a3d3f'));
  instance(cyl,paint,[x,yy,top-.5],[.42,.42,.05],[Math.PI/2,0,0],tone('#33383b'));instance(cyl,paint,[x,yy,top-.5],[.36,.36,.07],[Math.PI/2,0,0],tone('#f4f1e8'));
  for(const [l,a] of [[.13,.6],[.09,-1.2]])block(paint,[.018,.08,l],[x+Math.sin(a)*l/2,yy,top-.5+Math.cos(a)*l/2],[0,a,0],tone('#2a2c2e'));}
 const lampMat=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0}),poleMat=mat('#8d918d',{metalness:.4,roughness:.5});
 for(const x of [6.5,10.5]){const top=roofZ(cy0)-.045;block(paint,[.02,.02,.18],[x,cy0,top-.09],[0,0,0],tone('#3a3d3f'));block(lampMat,[.34,.16,.07],[x,cy0,top-.2]);}
 for(const x of [6.2,8.5,10.8]){const c=jit('#8b6a4a',.06),yy=platY1+.95;
  block(paint,[1.0,.3,.05],[x,yy,platTop+.42],[0,0,0],c);block(paint,[1.0,.05,.28],[x,yy-.17,platTop+.62],[.15,0,0],c);
  for(const dx of [-.4,.4])block(paint,[.06,.3,.4],[x+dx,yy,platTop+.2],[0,0,0],tone('#4d4f50'));}
 for(const [x,c] of [[5.4,'#3f7a5a'],[11.6,'#3d6fa3']]){instance(cyl,paint,[x,platY1+.3,platTop+.18],[.24,.24,.36],[0,0,0],tone(c));instance(cyl,paint,[x,platY1+.3,platTop+.38],[.26,.26,.04],[0,0,0],tone('#d9d6cc'));}
 for(const x of [stX0+1.4,stX1-1.5]){const yy=platY1+.4;
  for(const dx of [-.62,.62])block(woodDark,[.07,.07,1.35],[x+dx,yy,platTop+.67]);
  block(edge,[1.5,.07,.46],[x,yy,platTop+1.3]);block(blue,[1.5,.08,.09],[x,yy,platTop+1.04]);
  for(const dx of [-.42,0,.42])block(paint,[.22,.08,.2],[x+dx,yy,platTop+1.33],[0,0,0],tone('#2c3136'));}
 // 站房：石砌牆腳、灰泥牆、下半截直紋腰板、木柱與窗框窗台、對開木門（上半玻璃）、站名招牌、灰瓦兩坡頂（瓦溝、屋脊、破風板）。
 const hx=8.5,hy=platY1-2.0,hw=6.4,hd=2.8,hh=1.9,fr=hy-hd/2;
 block(paint,[hw+.12,hd+.12,.3],[hx,hy,groundZ+.15],[0,0,0],tone('#9c9484'));
 block(plaster,[hw,hd,hh],[hx,hy,groundZ+hh/2]);
 for(const x of [hx-hw/2,hx+hw/2])block(trim,[.14,hd+.04,hh],[x,hy,groundZ+hh/2]);block(trim,[hw+.04,hd+.04,.14],[hx,hy,groundZ+hh-.07]);
 for(const side of [-1,1]){const yy=hy+side*(hd/2+.012);
  block(wood,[hw-.1,.024,.52],[hx,yy,groundZ+.56]);
  for(let x=hx-hw/2+.2;x<hx+hw/2-.1;x+=.22)block(woodDark,[.02,.034,.5],[x,yy,groundZ+.56]);
  block(trim,[hw+.02,.05,.06],[hx,hy+side*(hd/2+.02),groundZ+.84]);
  for(const x of [hx-1.5,hx+1.5])block(trim,[.1,.04,hh-.3],[x,hy+side*(hd/2+.015),groundZ+.3+(hh-.3)/2]);
  for(let y=hy-hd/2+.2;y<hy+hd/2-.1;y+=.22)block(woodDark,[.02,.02,hh-.2],[hx+side*(hw/2+.072),y,groundZ+hh/2]);
 }
 const glass=props.glass;
 for(const x of [hx-2.1,hx-.9,hx+.9,hx+2.1])for(const side of [-1,1]){const yy=hy+side*hd/2;
  block(trim,[.76,.04,.86],[x,yy+side*.015,groundZ+1.22]);block(glass,[.62,.06,.72],[x,yy+side*.02,groundZ+1.22]);
  block(trim,[.03,.02,.72],[x,yy+side*.06,groundZ+1.22]);block(trim,[.62,.02,.03],[x,yy+side*.06,groundZ+1.3]);
  block(paint,[.84,.12,.05],[x,yy+side*.05,groundZ+.84],[0,0,0],tone('#d9d2c2'));}
 block(trim,[1.16,.04,1.3],[hx,fr-.015,groundZ+.95]);
 for(const dx of [-.25,.25]){block(woodDark,[.47,.05,1.18],[hx+dx,fr-.03,groundZ+.91]);block(glass,[.3,.03,.42],[hx+dx,fr-.06,groundZ+1.18]);}
 block(paint,[1.5,.42,.2],[hx,fr-.22,groundZ+.1],[0,0,0],tone('#b2ab9c'));
 block(woodDark,[1.0,.06,1.24],[hx,hy+hd/2+.02,groundZ+.92]);
 block(roofTile,[2.2,.9,.07],[hx,fr-.4,groundZ+1.7],[.18,0,0]);for(const dx of [-.9,.9])block(trim,[.05,.05,.55],[hx+dx,fr-.3,groundZ+1.45],[.98,0,0]);
 // 站名招牌立在入口雨庇上、主屋簷前面（貼牆的話會被簷口擋掉大半）。
 const signBoard=mat('#f2ead6',{emissive:'#ffe6b8',emissiveIntensity:0});block(signBoard,[2.0,.08,.36],[hx,fr-.62,groundZ+1.9]);
 for(const dx of [-.72,-.24,.24,.72])block(paint,[.3,.03,.22],[hx+dx,fr-.67,groundZ+1.9],[0,0,0],tone('#2a2f33'));
 k.tiledRoof(hx,hy,groundZ+hh,hw+.7,hd+.8,1.1,0,'#4e5a5e',{rows:6,line:1.28});
 // 站前小廣場（鋪面分格）、馬路、路燈。
 const roadY=-18.4;props.road(0,roadY,groundZ,62);
 const paving=mat('#b5ae9f'),plazaD=fr-(roadY+.95);block(paving,[10,plazaD,.04],[hx,(fr+roadY+.95)/2,groundZ+.02]);
 for(let x=hx-4.2;x<hx+4.5;x+=.8)block(paint,[.025,plazaD,.006],[x,(fr+roadY+.95)/2,groundZ+.042],[0,0,0],tone('#a39c8d'));
 for(let y=roadY+1.75;y<fr-.1;y+=.8)block(paint,[10,.025,.006],[hx,y,groundZ+.042],[0,0,0],tone('#a39c8d'));
 for(let x=-28;x<=28;x+=8){const ly=roadY+1.25;block(poleMat,[.1,.1,2.8],[x,ly,groundZ+1.4]);block(poleMat,[.07,1.0,.07],[x,ly-.5,groundZ+2.78]);block(lampMat,[.34,.3,.09],[x,ly-.95,groundZ+2.72]);k.pool(x,ly-.95,groundZ+.06,2.4,1.9);}
 for(const x of [stX0+3,stX1-3]){block(poleMat,[.08,.08,1.9],[x,platY1+.25,platTop+.95]);block(lampMat,[.3,.3,.1],[x,platY1+.25,platTop+1.92]);k.pool(x,platY1+.2,platTop+.02,1.7);}
 k.light(6.5,(platY0+platY1)/2,cTop-.3,2.2);k.light(10.5,(platY0+platY1)/2,cTop-.3,2.2);k.light(hx,hy-hd/2-1.0,groundZ+1.5,1.2,6);
 // 馬路：兩側白邊線、北側緣石與人行道、站前斑馬線、幾塊補過的柏油與人孔蓋。
 for(const dy of [-.8,.8])block(paint,[61,.05,.01],[0,roadY+dy,groundZ+.035],[0,0,0],tone('#e6e2d6'));
 const walk0=roadY+.9,walk1=roadY+1.7;
 for(const [a,b] of [[-31,-10.95],[-9.05,3.45],[13.55,31]]){block(paint,[b-a,.12,.08],[(a+b)/2,walk0+.06,groundZ+.04],[0,0,0],tone('#c8c2b4'));block(paint,[b-a,walk1-walk0-.12,.04],[(a+b)/2,(walk0+.12+walk1)/2,groundZ+.02],[0,0,0],tone('#bdb5a5'));}
 for(let i=0;i<4;i++)block(paint,[1.5,.22,.01],[hx,roadY-.6+i*.4,groundZ+.037],[0,0,0],tone('#efece4'));
 for(const [x,w] of [[-22,1.6],[-4,1.1],[17,2.0],[25,1.2]])block(paint,[w,.7+rand()*.4,.004],[x,roadY+(rand()-.5)*.6,groundZ+.031],[0,0,0],tone('#5f615d'));
 for(const x of [-26,-14,2.5,21])instance(cyl,paint,[x,roadY+.45,groundZ+.032],[.36,.36,.006],[0,0,0],tone('#4a4c4a'));
 // 站前：公車站牌、紅綠郵筒、自動販賣機（正面夜裡會亮）、一排腳踏車。
 block(paint,[.05,.05,1.3],[12.9,roadY+1.05,groundZ+.65],[0,0,0],tone('#8d918d'));block(paint,[.34,.04,.38],[12.9,roadY+1.05,groundZ+1.25],[0,0,0],tone('#2f6aa8'));block(paint,[.3,.045,.08],[12.9,roadY+1.05,groundZ+1.36],[0,0,0],tone('#f2efe6'));
 for(const [x,c] of [[3.9,'#c8372d'],[4.26,'#2f7a4f']]){block(paint,[.3,.26,.56],[x,fr-.45,groundZ+.28],[0,0,0],tone(c));block(paint,[.34,.3,.08],[x,fr-.45,groundZ+.6],[0,0,0],tone(c,.8));block(paint,[.16,.02,.03],[x,fr-.585,groundZ+.46],[0,0,0],tone('#222'));}
 block(paint,[.55,.45,.95],[4.85,fr-.35,groundZ+.475],[0,0,0],tone('#c23b31'));block(glass,[.45,.03,.55],[4.85,fr-.585,groundZ+.62]);block(paint,[.35,.03,.12],[4.85,fr-.585,groundZ+.2],[0,0,0],tone('#2b2b2b'));
 for(let i=0;i<5;i++){const x=12.15+i*.3,y=fr-.45,c=tone(['#b4402f','#3f4a63','#9aa0a3','#2f6a4a','#d9b451'][i]);
  for(const dy of [-.22,.22])instance(cyl,paint,[x,y+dy,groundZ+.17],[.34,.34,.03],[0,Math.PI/2,0],tone('#2c2e30'));
  block(paint,[.03,.42,.03],[x,y,groundZ+.3],[0,0,0],c);block(paint,[.05,.1,.03],[x,y+.1,groundZ+.43],[0,0,0],tone('#2c2e30'));block(paint,[.22,.03,.03],[x,y-.2,groundZ+.45],[0,0,0],tone('#5a5f62'));}

 // 平交道：馬路分一條往北越過鐵道，進到三合院。路面在軌道上墊高成平板，警報柱（叉形標誌、兩盞紅燈），柵欄桿升起。
 const xX=-10,asphalt=mat('#6b6d68'),panel=mat('#8a8780'),black=mat('#2c2e30'),stripeW=mat('#efece4'),stripeY=mat('#e0b23a');
 block(asphalt,[1.7,(fy-1.5)-(roadY+.9),.03],[xX,(fy-1.5+roadY+.9)/2,groundZ+.015]);
 block(panel,[1.9,3.0,L.railZ-groundZ-.012],[xX,fy,groundZ+(L.railZ-groundZ-.012)/2]);
 const farmRoad=mat('#b8ab8c');block(farmRoad,[1.3,(1.0)-(fy+1.5),.03],[xX,(1.0+fy+1.5)/2,groundZ+.015]);
 const red=mat('#6e1c16',{emissive:'#ff3a26',emissiveIntensity:0});
 for(const [x,y,face] of [[xX-1.45,fy-1.75,0],[xX+1.45,fy+1.75,Math.PI]]){
  for(let i=0;i<6;i++)block(i%2?black:stripeW,[.1,.1,.32],[x,y,groundZ+.16+i*.32]);
  block(black,[.1,.1,.9],[x,y,groundZ+2.3]);
  for(const a of [.7,-.7])block(stripeW,[.08,.07,1.0],[x,y+(face?.06:-.06),groundZ+2.55],[0,a,0]);
  block(black,[.66,.08,.22],[x,y+(face?.06:-.06),groundZ+1.98]);for(const dx of [-.24,.24])block(red,[.17,.08,.17],[x+dx,y+(face?.1:-.1),groundZ+1.98]);
  for(let i=0;i<7;i++)block(i%2?black:stripeY,[.07,.07,.3],[x+(face?-.3:.3),y,groundZ+1.0+i*.3]);   // 柵欄桿升起
  block(black,[.32,.32,.5],[x+(face?-.3:.3),y,groundZ+.25]);
 }
 k.light(xX-2.2,fy-2.6,groundZ+2.6,1.1,6);
 // 進站號誌：月台兩頭各一支，綠燈夜裡會亮，柱腳一個繼電器箱。
 const sigGreen=mat('#24503a',{emissive:'#5cffa0',emissiveIntensity:0});
 for(const x of [-2.2,17.4]){const y=fy-1.9;block(paint,[.09,.09,2.1],[x,y,groundZ+1.05],[0,0,0],tone('#9a9e9c'));block(paint,[.14,.24,.56],[x,y,groundZ+2.05],[0,0,0],tone('#2c2e30'));
  block(sigGreen,[.18,.11,.11],[x,y,groundZ+2.18]);block(paint,[.18,.11,.11],[x,y,groundZ+1.92],[0,0,0],tone('#5a1f1a'));block(paint,[.3,.25,.4],[x+.3,y,groundZ+.2],[0,0,0],tone('#9a9e9c'));}
 // 土地公廟：路口一間小廟，石台基、紅牆、兩根紅柱、燕尾脊的黃瓦頂、金色匾額，廟前一座香爐，簷下兩盞燈籠；旁邊一棵大榕樹。
 const temple=mat('#a8402f'),lanternMat=mat('#c8402e',{emissive:'#ff6a3a',emissiveIntensity:0});
 const tX=xX-3.4,tY=fy-4.2;
 block(paint,[1.8,1.6,.14],[tX,tY,groundZ+.07],[0,0,0],tone('#a8a293'));block(temple,[1.4,1.2,1.0],[tX,tY+.05,groundZ+.64]);
 k.tiledRoof(tX,tY+.05,groundZ+1.14,1.9,1.7,.55,0,'#d38a3a',{rows:3,step:.2,swallow:true,line:.8});
 for(const dx of [-.55,.55])instance(cyl,paint,[tX+dx,tY-.72,groundZ+.62],[.1,.1,.96],[0,0,0],tone('#b23a2a'));
 const shrineGlow=mat('#ffd38a',{emissive:'#ff9a4a',emissiveIntensity:0});block(shrineGlow,[.5,.06,.4],[tX,fy-4.82,groundZ+.5]);
 block(paint,[.4,.03,.12],[tX,tY-.57,groundZ+.98],[0,0,0],tone('#d9b44a'));
 block(paint,[.12,.12,.16],[tX,tY-1.15,groundZ+.08],[0,0,0],tone('#5a4a3a'));instance(cyl,paint,[tX,tY-1.15,groundZ+.25],[.24,.24,.18],[0,0,0],tone('#6b5a44'));
 for(const dx of [-.45,.45])instance(k.stoneGeo,lanternMat,[tX+dx,tY-.78,groundZ+.98],[.09,.09,.12]);
 k.light(tX,fy-5.3,groundZ+1.0,.6,4,'#ff8a5a');
 k.banyan(tX-2.3,tY+.6,groundZ,2.4);

 // 路邊一排透天厝（村子），站房兩側。透天厝本體是共用的 props.townhouse，這裡再補：磁磚縫（比牆大一點的薄片，四面都露一條線）、
 // 樓板線、鋁窗框與窗台、窗型冷氣、鐵窗的直條、直立招牌（夜裡會亮，幾格深色當字）、屋頂的太陽能熱水器與天線。
 const WALLS=['#ece4d2','#d9b9a6','#cfd0c8','#e6dcb2','#cfd8c4'];   // 同 props.js 透天厝外牆的五色
 function house(x,y,o){
  // 窗框、窗台、冷氣、鐵窗都照 props 實際放窗玻璃的高度走，不照樓高自己算：props.js 目前每層的窗、陽台、鐵窗多加了一次
  // 地面 z（整組一起低約 0.7），照樓高放會在框下露出一塊塊深色玻璃。props 修好之後抄到的高度跟著變，這裡不用改。
  const got=k.capture(()=>props.townhouse(x,y,groundZ,o));
  const {floors=3,width:w=2.6,depth:d=3.2,tint=0,roof='tin',ground='plain',balcony='rail'}=o,fh=1.05,H=floors*fh,front=y-d/2,wc=WALLS[tint%5];
  for(let f=ground==='arcade'?1:0;f<floors;f++){const zc=groundZ+f*fh;
   if(f>0)block(paint,[w+.03,d+.03,.06],[x,y,zc],[0,0,0],tone(wc,.8));
   for(const t of [.36,.7])block(paint,[w+.012,d+.012,.016],[x,y,zc+t*fh],[0,0,0],tone(wc,.9));}
  const panes=got.filter(g=>g.m===props.glass&&g.pos[1]<y&&g.scale[0]===.5),f0=ground==='plain'?0:1;
  const lift=panes.length?panes[0].pos[2]-(groundZ+(f0+.6)*fh):0,floorOf=z=>Math.round((z-lift-groundZ)/fh-.6);
  for(const {pos:[px,,pz]} of panes){if((floorOf(pz)>0&&balcony==='cage')||pz<groundZ+.3)continue;   // 鐵窗那層被鐵窗擋住；沉到地面下的不畫
   block(paint,[.6,.03,.68],[px,front-.004,pz],[0,0,0],tone('#aeb2ad'));block(paint,[.64,.12,.04],[px,front-.06,pz-.33],[0,0,0],tone('#d6d1c4'));block(paint,[.025,.015,.58],[px,front-.065,pz],[0,0,0],tone('#aeb2ad'));}
  const nw=Math.max(1,Math.round((w-.5)/.85));
  for(let f=1;f<floors;f++){const zc=groundZ+lift+f*fh;
   if(balcony==='cage'){for(let a=-w*.43;a<=w*.43;a+=.16)block(paint,[.022,.02,fh*.6],[x+a,front-.28,zc+fh*.55],[0,0,0],tone('#8d9699'));for(const z of [.26,.84])block(paint,[w*.9,.02,.025],[x,front-.28,zc+fh*z],[0,0,0],tone('#8d9699'));continue;}
   if(rand()<.4){const a=((Math.floor(rand()*nw))-(nw-1)/2)*.85;block(paint,[.4,.3,.26],[x+a,front-.13,zc+fh*.48],[0,0,0],tone('#e4e2dc'));block(paint,[.3,.01,.18],[x+a,front-.285,zc+fh*.48],[0,0,0],tone('#9a9d98'));}
  }
  if(ground!=='plain'&&floors>=2&&rand()<.65){const sx=x+(rand()<.5?-1:1)*(w/2-.18),sz=groundZ+fh+.6;
   block(paint,[.04,.3,.04],[sx,front-.15,sz+.45],[0,0,0],tone('#5a5f62'));block(props.signs[(tint+1)%3],[.08,.42,1.0],[sx,front-.62,sz]);
   for(let j=0;j<3;j++)block(paint,[.09,.16,.14],[sx,front-.62,sz+.3-j*.3],[0,0,0],tone('#2d3134'));}
  if(roof!=='pitched'){const top=groundZ+H+(roof==='tin'?.9:.24);
   if(roof==='parapet'&&rand()<.5){const sx=x-w*.15,sy=y+d*.22;block(paint,[.75,.55,.04],[sx,sy,groundZ+H+.55],[.55,0,0],tone('#2f4256'));instance(cyl,paint,[sx,sy+.32,groundZ+H+.78],[.22,.22,.8],[0,Math.PI/2,0],tone('#e8e6df'));
    for(const dx of [-.3,.3])block(paint,[.04,.04,.4],[sx+dx,sy+.1,groundZ+H+.36],[0,0,0],tone('#8d918d'));}
   if(rand()<.45){block(paint,[.025,.025,.9],[x+w*.3,y+.1,top+.45],[0,0,0],tone('#8d918d'));for(const z of [.6,.8])block(paint,[.45,.02,.02],[x+w*.3,y+.1,top+z],[0,0,.4],tone('#8d918d'));}
  }
 }
 let tx=-31;for(let i=0;tx<-13;i++){const w=2.3+rand()*1.0;house(tx+w/2,roadY+3.2,{floors:2+Math.floor(rand()*2.2),width:w,depth:3.0,tint:i,roof:['tin','parapet','pitched','tin'][i%4],ground:['shop','plain','arcade'][i%3],balcony:rand()<.4?'cage':'rail',tanks:i%3?1:0});tx+=w+(rand()<.3?.9:.04);}
 tx=-8.6;for(let i=0;tx<1.4;i++){const w=2.2+rand()*.8;house(tx+w/2,roadY+3.2,{floors:2+Math.floor(rand()*2),width:w,depth:2.9,tint:i+5,roof:['tin','pitched','parapet'][i%3],ground:['shop','arcade','shop'][i%3],balcony:rand()<.4?'cage':'rail',tanks:i%2});tx+=w+.04;}
 tx=19;for(let i=0;tx<31;i++){const w=2.4+rand()*.9;house(tx+w/2,roadY+3.2,{floors:2+Math.floor(rand()*1.8),width:w,depth:3.0,tint:i+2,roof:['parapet','tin','pitched'][i%3],ground:i%2?'shop':'plain',balcony:rand()<.5?'cage':'rail',tanks:1});tx+=w+.05;}
 // 馬路南側一排電線桿：三條電線加一條較低的電信纜，每三根掛一顆變壓器。
 {let prev=null;for(let x=-29,i=0;x<30;x+=7,i++){const pl=k.pole(x+rand()*.5,roadY-1.05,groundZ,{trans:i%3===1});if(prev){pl.lines.forEach((q,j)=>k.wire(prev.lines[j],q));k.wire(prev.cable,pl.cable,{sag:.2,w:.026,color:'#25272a'});}prev=pl;}}
 // 站前廣場：幾輛機車、兩台車（有輪子）、鳳凰木與樟樹；廣場與月台之間一條便道接階梯。
 const scooter=mat('#2f2f33'),seat=mat('#c7c2b6'),carCols=['#e9e6df','#3f4a63','#b4402f','#8f9498'].map(c=>mat(c,{roughness:.5,metalness:.15})),carGlass=mat('#2e3a44',{roughness:.3});
 for(let i=0;i<7;i++){const x=hx+3.2+i*.42;block(scooter,[.3,.7,.32],[x,roadY+2.4,groundZ+.2]);block(seat,[.26,.38,.09],[x,roadY+2.35,groundZ+.4]);}
 for(const [x,c] of [[hx-3.6,0],[hx-2.4,2]]){block(carCols[c],[.8,1.7,.46],[x,roadY+2.6,groundZ+.29]);block(carGlass,[.7,.9,.32],[x,roadY+2.6,groundZ+.66]);
  for(const dx of [-.4,.4])for(const dy of [-.55,.55])instance(cyl,paint,[x+dx,roadY+2.6+dy,groundZ+.13],[.26,.26,.08],[0,Math.PI/2,0],tone('#2a2b2d'));}
 k.blossom(hx-5.6,roadY+2.6,groundZ,2.3,'#d65a3a');k.camphor(hx+5.8,roadY+2.6,groundZ,2.2);
 {const len=platY1-.72-fr;block(paving,[1.1,len,.04],[stX1-.8,fr+len/2,groundZ+.02]);}
 // 西側菜園：幾畦菜、竹架、小工具間。
 const soil=mat('#8a6f52'),veg=['#6f9a4c','#88b05a','#5f8a45'].map(c=>mat(c));
 for(let i=0;i<9;i++){const x=-29+i*1.15;block(soil,[.8,3.6,.12],[x,-11.2,groundZ+.06]);for(let j=0;j<6;j++)instance(k.stoneGeo,veg[(i+j)%3],[x,-12.7+j*.6,groundZ+.2],[.28,.26,.16],[0,0,rand()*3]);}
 for(let i=0;i<4;i++)block(woodDark,[.05,.05,1.3],[-29.5+i*2.4,-9.2,groundZ+.65]);block(woodDark,[7.4,.04,.04],[-25.9,-9.2,groundZ+1.25]);

 // 磚造平房（三合院、田邊農舍）：石砌牆腳、紅磚牆（磚縫一圈一圈的細線）、紅瓦頂或鐵皮頂；正面開門窗，couplets 門邊貼春聯、橫批。
 // porch：正身前一道走廊（木柱、斜簷），lanterns 簷下兩盞燈籠。facing 是正面朝向（0 朝 −y），寬沿正面、深沿法向。
 function brickHouse(x,y,{width:w,depth:d,facing:f=0,height:h=1.35,roof='tile',roofColor='#b0573c',wall='#a9563f',swallow=false,porch=false,windows=[],door=true,couplets=false,lanterns=false}){
  const c=Math.cos(f),s=Math.sin(f),at=(o,a,z)=>[x+s*o+c*a,y-c*o+s*a,groundZ+z],rot=[0,0,f],wc=jit(wall,.05),o=d/2;
  instance(k.box,paint,at(0,0,.11),[w+.1,d+.1,.22],rot,jit('#a8a293',.04));
  instance(k.box,paint,at(0,0,.22+(h-.22)/2),[w,d,h-.22],rot,wc);
  const mortar=wc.clone().lerp(new THREE.Color('#e3d3c0'),.35);for(let z=.36;z<h-.06;z+=.15)instance(k.box,paint,at(0,0,z),[w+.012,d+.012,.016],rot,mortar);
  if(roof==='tile')k.tiledRoof(...at(0,0,h),w+.5,d+.6,.75,f,roofColor,{rows:4,swallow});
  else{instance(k.box,paint,at(0,0,h+.08),[w+.35,d+.35,.12],rot,jit('#5f7376',.05));for(let a=-w/2-.1;a<=w/2+.1;a+=.18)instance(k.box,paint,at(0,a,h+.15),[.03,d+.35,.03],rot,tone('#4f6164'));}
  if(door){instance(k.box,paint,at(o+.012,0,.7),[.8,.03,.96],rot,tone('#6b4a35'));for(const a of [-.18,.18])instance(k.box,paint,at(o+.03,a,.69),[.34,.03,.9],rot,tone('#7a2e22'));
   if(couplets){for(const a of [-.5,.5])instance(k.box,paint,at(o+.02,a,.67),[.12,.02,.6],rot,tone('#c8372d'));instance(k.box,paint,at(o+.02,0,1.25),[.6,.02,.1],rot,tone('#c8372d'));}}
  for(const a of windows){instance(k.box,paint,at(o+.012,a,.82),[.58,.03,.5],rot,tone('#5d4634'));instance(k.box,glass,at(o+.03,a,.82),[.48,.04,.4],rot);
   for(const b of [-.12,.12])instance(k.box,paint,at(o+.055,a+b,.82),[.025,.02,.4],rot,tone('#5d4634'));instance(k.box,paint,at(o+.055,a,.82),[.48,.02,.025],rot,tone('#5d4634'));}
  if(porch){instance(k.box,paint,at(o+.47,0,.06),[w,.95,.12],rot,jit('#b8b1a2',.03));instance(k.box,paint,at(o+.45,0,h-.12),[w+.1,.95,.06],[.25,0,f],jit(roofColor,.04));
   for(const a of [-w/2+.3,-w/6,w/6,w/2-.3])instance(cyl,paint,at(o+.85,a,.12+(h-.38)/2),[.1,.1,h-.38],rot,tone('#7a4a32'));}
  if(lanterns)for(const a of [-.9,.9])instance(k.stoneGeo,lanternMat,at(o+.75,a,h-.55),[.1,.1,.13]);
 }
 brickHouse(-19.2,-11.6,{width:2.2,depth:1.6,height:1.2,roof:'tin',wall:'#9a8f7d',windows:[.6]});
 // 東側果園：一排排矮果樹（芒果套著白袋）。
 for(let i=0;i<4;i++)for(let j=0;j<3;j++)k.fruit(19.5+i*1.9,-13.2+j*1.9,groundZ,1.2+rand()*.3);

 // ── 環內：稻田、三合院（正身有走廊、燕尾脊、春聯燈籠，兩側護龍，中間曬穀場）、田埂小路。
 const cx=xX,cyd=3.0;
 brickHouse(cx,cyd+1.9,{width:5.2,depth:2.2,facing:0,porch:true,swallow:true,couplets:true,lanterns:true,windows:[-2.05,-1.25,1.25,2.05]});
 brickHouse(cx-2.9,cyd-.4,{width:3.0,depth:1.9,facing:Math.PI/2,couplets:true,windows:[-.85,.85]});
 brickHouse(cx+2.9,cyd-.4,{width:3.0,depth:1.9,facing:-Math.PI/2,couplets:true,windows:[-.85,.85]});
 block(mat('#d9d2c0'),[4.6,3.2,.03],[cx,cyd-.1,groundZ+.02]);
 block(paint,[2.2,1.2,.02],[cx,cyd-1.0,groundZ+.04],[0,0,0],tone('#d9b65a'));for(let i=0;i<6;i++)block(paint,[2.1,.03,.006],[cx,cyd-1.5+i*.2,groundZ+.052],[0,0,0],tone('#c49f45'));
 instance(cyl,paint,[cx-1.5,cyd-1.3,groundZ+.17],[.3,.3,.32],[0,0,0],tone('#4a3b30'));
 for(const dx of [1.5,1.8]){instance(cyl,paint,[cx+dx,cyd-1.35,groundZ+.1],[.18,.18,.16],[0,0,0],tone('#a65a3c'));k.shrub(cx+dx,cyd-1.35,groundZ+.12,.22,'#c9568a');}
 for(const [x,y,ph,t] of [[-15.9,-2.9,'young',0],[-15.9,2.4,'young',1],[-3.6,-2.9,'young',2],[-3.6,2.4,'gold',0],[.9,-2.9,'young',1],[.9,2.4,'young',0],[5.4,-2.9,'gold',1],[5.4,2.4,'young',2]])k.paddy(x,y,4.0,4.8,{phase:ph,tint:t});
 for(const x of [-13.4,-1.35]){block(farmRoad,[.9,9.6,.03],[x,0,groundZ+.015]);for(const dx of [-.22,.22])block(paint,[.1,9.6,.004],[x+dx,0,groundZ+.032],[0,0,0],tone('#a8997a'));}
 // 田裡幾隻白鷺鷥、黃熟那塊田一個稻草人。
 function egret(x,y,yaw){const c=Math.cos(yaw),s=Math.sin(yaw),w=tone('#f4f2ea'),z=groundZ+.06;
  instance(k.stoneGeo,paint,[x,y,z+.17],[.11,.05,.06],[0,-.25,yaw],w);instance(k.box,paint,[x+c*.08,y+s*.08,z+.27],[.022,.022,.13],[0,.35,yaw],w);
  instance(k.stoneGeo,paint,[x+c*.11,y+s*.11,z+.33],[.03,.022,.022],[0,0,yaw],w);instance(k.box,paint,[x+c*.16,y+s*.16,z+.325],[.06,.01,.01],[0,.1,yaw],tone('#d9b13a'));
  for(const o of [-.02,.02])instance(k.box,paint,[x-s*o,y+c*o,z+.06],[.012,.012,.12],[0,0,yaw],tone('#2f2f2f'));}
 for(const [x,y,a] of [[-16.6,-3.6,.4],[-15.1,-1.9,2.6],[.2,-2.2,1.2],[1.8,3.3,-.6],[-3.0,-4.0,3.4]])egret(x,y,a);
 {const x=5.9,y=-2.6;instance(k.box,paint,[x,y,groundZ+.45],[.035,.035,.9],[0,0,0],jit('#6f6450'));instance(k.box,paint,[x,y,groundZ+.7],[.55,.03,.03],[0,0,.3],jit('#6f6450'));
  instance(k.box,paint,[x,y,groundZ+.62],[.24,.12,.28],[0,0,.3],tone('#4f6e9a'));instance(k.stoneGeo,paint,[x,y,groundZ+.86],[.08,.08,.08],[0,0,0],tone('#e2cf9a'));instance(k.cone,paint,[x,y,groundZ+.88],[.17,.17,.1],[0,0,0],tone('#cdb46e'));}
 k.camphor(-6.2,5.3,groundZ,2.3);k.broadleaf(-13.8,5.6,groundZ,2.2);k.blossom(7.6,5.5,groundZ,2.2,'#e2b93b');k.fruit(8.2,-4.7,groundZ,1.6);k.cypress(-17.4,5.6,groundZ,2.4);k.casuarina(17.4,-4.2,groundZ,3.2);
 for(const [x,y] of [[-12.7,6.1],[-11.9,6.3],[-7.4,6.2],[17.3,4.6],[17.6,5.7]])k.betel(x,y,groundZ,2.8+rand()*.8);
 k.bamboo(-6.4,5.9,groundZ,2.7);k.bamboo(15.4,5.6,groundZ,2.9);
 const straw=mat('#cdb46e');for(const [x,y] of [[-1.3,5.6],[-.4,5.9],[3.4,5.7]])instance(k.stoneGeo,straw,[x,y,groundZ+.3],[.42,.42,.5],[0,0,rand()*3]);
 // 環內兩根電線桿沿田埂，拉一條線進三合院護龍。
 {const a=k.pole(-12.6,-4.6,groundZ,{h:2.8,dir:Math.PI/2}),b=k.pole(-12.6,-1.1,groundZ,{h:2.8,dir:Math.PI/2});a.lines.forEach((q,j)=>k.wire(q,b.lines[j],{sag:.1}));k.wire(b.lines[1],[-12.6,1.08,groundZ+1.2],{sag:.12});}
 block(mat('#7a8a8c'),[1.4,1.1,1.0],[7.9,-.2,groundZ+.5]);block(mat('#556c70'),[1.6,1.3,.1],[7.9,-.2,groundZ+1.05],[.12,0,0]);
 block(paint,[.4,.03,.75],[7.9,-.77,groundZ+.375],[0,0,0],tone('#4a4f52'));block(glass,[.3,.03,.22],[8.35,-.77,groundZ+.72]);
 k.light(cx,cyd-.6,groundZ+1.6,.8,6);

 // ── 環外：後方田間小路（車轍）與水圳、檳榔園、竹叢、後山的雜木林；東側溪邊農舍與一排木麻黃。
 block(farmRoad,[48,1.0,.03],[-2,L.backY+2.45,groundZ+.015]);for(const dy of [-.22,.22])block(paint,[48,.1,.004],[-2,L.backY+2.45+dy,groundZ+.032],[0,0,0],tone('#a8997a'));
 for(const dy of [-.14,.14])block(paint,[34,.07,.12],[0,L.backY+1.7+dy,groundZ+.06],[0,0,0],tone('#bdb6a6'));block(mat('#55707a',{roughness:.3,metalness:.1}),[34,.21,.02],[0,L.backY+1.7,groundZ+.03]);
 for(let x=-13;x<15;x+=1.05)for(const y of [L.backY+3.6,L.backY+4.6])if(rand()<.85)k.betel(x+(rand()-.5)*.3,y+(rand()-.5)*.3,groundZ+(y>L.backY+4?.15:0),2.9+rand()*.9);
 for(const [x,y] of [[-15,13.5],[17,12.4],[22.5,11.5],[11,14.6],[-19,11.2]])k.bamboo(x,y,groundZ+.05,2.6+rand()*.6);
 // 山上的樹：闊葉、樟樹、龍柏、深綠雜木、木麻黃混著種，不再整片同一種球；林下補幾叢灌木。
 const forest=(x,y,z,h)=>{const r=rand();if(r<.38)k.broadleaf(x,y,z,h);else if(r<.58)k.camphor(x,y,z,h*1.05);else if(r<.74)k.cypress(x,y,z,h*1.15);else if(r<.88)k.broadleaf(x,y,z,h,k.GREEN.dark);else k.casuarina(x,y,z,h*1.3);};
 for(let n=0;n<70;){const x=-31+rand()*62,y=12.5+rand()*7;const h=backHill(x,y);if(h<.25||Math.abs(x+28)<6)continue;forest(x,y,groundZ+.02+h,1.3+rand()*1.0);n++;}
 for(let n=0;n<30;){const x=-32+rand()*15,y=-10+rand()*21;const h=westHill(x,y),nn=L.nearest(x,y);if(h<.6||nn.d<2.4)continue;forest(x,y,groundZ+.02+h,1.3+rand()*.9);n++;}
 for(let n=0;n<28;){const x=-32+rand()*64,y=12.5+rand()*7;const h=backHill(x,y);if(h<.3||Math.abs(x+28)<6)continue;k.shrub(x,y,groundZ+h,.4+rand()*.3);n++;}
 brickHouse(28.5,-7.5,{width:3.0,depth:2.3,facing:Math.PI*.5,couplets:true,windows:[-.85,.85]});k.light(27,-7.5,groundZ+1.3,.45,5);
 for(const [x,y] of [[30.8,-12.5],[-31,-13.5],[-24,-12.2],[24,-12.6],[27.5,10.4]])(rand()<.5?k.broadleaf:k.camphor)(x,y,groundZ,1.8+rand()*.9);
 for(const y of [-5.2,-3.8,3.3,4.7,6.1,7.5])k.casuarina(31.3+(rand()-.5)*.4,y,groundZ,3.0+rand()*.6);
 const flowerCol=()=>['#c9568a','#e7e3d8','#d9a441'][Math.floor(rand()*3)];
 for(let n=0;n<26;){const x=-32+rand()*64,y=-17+rand()*36;const nn=L.nearest(x,y);if(nn.d<2.3||(y<-9&&Math.abs(x-8)<9)||(Math.abs(x+10)<6.5&&y>-7&&y<7)||(x>8&&x<17&&Math.abs(y)<4.5)||(y>-17&&y<-13.5)||Math.abs(x+28)<6)continue;k.shrub(x,y,groundZ,.3+rand()*.3,rand()<.25?flowerCol():null);n++;}
 // 鐵道兩側與馬路南邊的雜草：一撮撮貼地的深淺綠。
 for(let n=0;n<150;){const x=-31+rand()*62,y=-19+rand()*38,nn=L.nearest(x,y);
  if(nn.d<1.55||nn.d>2.5||Math.abs(x-xX)<1.3||(x>1.2&&x<15.8&&y<fy)||westHill(x,y)>.3||(x>pondX0-.4&&x<pondX1&&y>pondY0-.4&&y<pondY1+.4)||(x>pondX1&&y>streamY0-.3&&y<streamY1+.3)||Math.abs(y-(L.backY+1.7))<.25)continue;
  instance(k.stoneGeo,paint,[x,y,groundZ+.04],[.22,.18,.08],[0,0,rand()*3],jit(rand()<.5?'#6f8a4e':'#8a9c5a',.08));n++;}
 for(let x=-31;x<31;x+=.9)instance(k.stoneGeo,paint,[x+(rand()-.5)*.5,roadY-1.35+(rand()-.5)*.4,groundZ+.04],[.24,.18,.08],[0,0,rand()*3],jit(rand()<.5?'#6f8a4e':'#8a9c5a',.08));

 // 電車線：環內側立桿；隧道裡、鐵橋上、雨棚旁不立桿。哪些車畫依車款（App：railcore GarageCatenary；網頁：garage-diorama.js catenaryFor）。
 k.catenary(L,{skip:s=>inTunnel(s)||(s>bridge[0]-1&&s<bridge[1]+1)||(s<L.half&&L.sample(s).x>cX0-1&&L.sample(s).x<cX1+1)});
 k.finish();
 const poolMesh=k.poolMesh();

 return{
  group:k.group,path:L.path,params:p,label:p.label,themes:THEMES,
  // 隧道的弧長範圍：App 由 bake.mjs 寫進 META 22–23、網頁由 garage-diorama.js 直接讀；碰到這段的車多畫一趟半透明，隔著山也看得到（同網頁 3D 地圖的地下列車）。
  tunnel:[tIn,tOut],
  update(time,period='day'){
   const t=THEMES[period]||THEMES.day;
   for(const m of [pondMat,streamMat]){m.color.set(t.water);const sh=m.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}}
   lampMat.emissiveIntensity=t.lamp*1.3;shrineGlow.emissiveIntensity=t.lamp*1.6;signBoard.emissiveIntensity=t.lamp*1.1;red.emissiveIntensity=t.signal;
   lanternMat.emissiveIntensity=t.lamp*1.5;sigGreen.emissiveIntensity=t.signal*.9;
   props.glass.emissiveIntensity=t.window;for(const s of props.signs)s.emissiveIntensity=t.window*.7;
   for(const l of k.lights)l.intensity=t.lamp*9*l.userData.k;
   k.poolMat.opacity=t.lamp*.8;if(poolMesh)poolMesh.visible=t.lamp>0;
   return t;
  },
  dispose:k.dispose
 };
}

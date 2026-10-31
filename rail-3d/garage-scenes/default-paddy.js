// 通用預設車庫「田園小站」：台灣鄉間的微縮印象，不是特定車站或實際線形的重建。62 款車都能開進來，免費。
// 前直線是木造小站與平交道，環線中間是稻田、三合院、埤塘，東側彎道過溪上鋼鈑梁橋，西側彎道鑽進小山的隧道。
// 寫法照四座精緻車庫（網頁 7c8924be 的 viaduct.js／shifen.js）：程式幾何、零資產檔，同幾何同材質的方塊合批成 InstancedMesh。
// App 先做（10-27），10-31 從 native repo 搬來當唯一的一份：網頁車庫第 4 格（rail-3d/garage-diorama.js）直接載入，
// App 由 native scripts/garage-scenes/bake.mjs 讀網頁釘版烘成 paddy.rigs。改幾何 App 要重烘。原型與三個方向的比較在 native docs/m9/garage-default/。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';

export const THEMES = {
 day:{background:'#e6e8de',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#46808a',shallow:'#8fbcae',lamp:0,window:0,signal:.15},
 sunset:{background:'#ecd8c4',sun:'#ffb672',ambient:'#d2b8b2',ground:'#74795e',power:2.8,exposure:.94,water:'#5e8189',shallow:'#a8b8a2',lamp:.45,window:.4,signal:.6},
 night:{background:'#131d2b',sun:'#9fbfe4',ambient:'#5b7390',ground:'#29323e',power:.7,exposure:.76,water:'#16384a',shallow:'#335f6b',lamp:1,window:1,signal:1.4}
};

// 工具組：底座、平面環線、道床、電車線、鋼鈑梁橋、隧道、地形、水面、光池、稻田、檳榔樹、竹叢；finish() 合批。
function createKit(seedValue){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=seedValue;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stoneGeo=geo(new THREE.IcosahedronGeometry(1,0));
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 const batches=new Map(),dummy=new THREE.Object3D();
 // 合批：同幾何同材質一個 InstancedMesh。color 給了就寫進 instanceColor（bake 的 INST 段有實例色）。
 function instance(g,m,pos,scale,rot=[0,0,0],color){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot,color});}
 const block=(m,size,pos,rot,color)=>instance(box,m,pos,size,rot,color);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}

 // 底座：跟高架、十分、南迴同一座 66×40 的台子。
 const plinthW=66,plinthD=40,plinthR=4,outline=rounded(plinthW,plinthD,plinthR);
 const plinthTop=-2+1.05+.2,groundZ=plinthTop+.05;
 const rimX=y=>Math.abs(y)<=plinthD/2-plinthR?plinthW/2:plinthW/2-plinthR+Math.sqrt(Math.max(0,plinthR**2-(Math.abs(y)-(plinthD/2-plinthR))**2));
 function plinth(grassColor){
  mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
  mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
  const g=mesh(geo(new THREE.ShapeGeometry(outline,24)),mat(grassColor),[0,0,groundZ]);g.castShadow=false;
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

 // 稻田：一塊水田（淺色水面）上種一排排秧苗；田埂是淺土色細條。rows 沿 x。tint 給每塊田不同的綠。
 function paddy(x,y,w,d,{phase='young',tint=0}={}){
  const mud=paddyMats.mud,ridge=paddyMats.ridge,row=paddyMats.rows[phase][tint%paddyMats.rows[phase].length];
  block(mud,[w,d,.05],[x,y,groundZ+.03]);
  for(const [dx,dy,sx,sy] of [[0,d/2,w+.24,.24],[0,-d/2,w+.24,.24],[w/2,0,.24,d],[-w/2,0,.24,d]])block(ridge,[sx,sy,.12],[x+dx,y+dy,groundZ+.06]);
  const n=Math.max(2,Math.floor((d-.4)/.34));for(let i=0;i<n;i++)block(row,[w-.45,.15,phase==='young'?.1:.26],[x,y-d/2+.35+i*(d-.7)/(n-1),groundZ+(phase==='young'?.08:.15)]);
 }
 const paddyMats={mud:mat('#8a9a86',{roughness:.35,metalness:.05}),ridge:mat('#a99a76'),rows:{young:['#8db35a','#7fa851','#98ba63'].map(c=>mat(c)),gold:['#d1b45a','#c9a94e','#dcc06a'].map(c=>mat(c))}};
 paddyMats.mud.name='paddy-water';

 // 檳榔樹：細長樹幹、頂端一叢壓扁的葉。竹叢：幾根細竹竿微傾，頂上幾團淺綠。
 const palmTrunk=mat('#8c8470'),palmLeaf=mat('#5f7e45'),bambooCane=mat('#7c9a52'),bambooLeaf=mat('#8fae63');
 function betel(x,y,z=groundZ,h=3.2){instance(box,palmTrunk,[x,y,z+h/2],[.07,.07,h]);const yaw=rand()*Math.PI;for(let k=0;k<5;k++){const a=yaw+k*Math.PI*2/5;instance(stoneGeo,palmLeaf,[x+Math.cos(a)*.32,y+Math.sin(a)*.32,z+h-.02],[.5,.14,.07],[0,-.45,a]);}instance(stoneGeo,palmLeaf,[x,y,z+h+.1],[.18,.18,.3]);}
 function bamboo(x,y,z=groundZ,h=3.0){for(let k=0;k<6;k++){const a=rand()*Math.PI*2,r=rand()*.35,tilt=.08+rand()*.12,hh=h*(.75+rand()*.3);instance(box,bambooCane,[x+Math.cos(a)*r+Math.cos(a)*tilt*hh/2,y+Math.sin(a)*r+Math.sin(a)*tilt*hh/2,z+hh/2],[.05,.05,hh],[0,tilt,a]);}
  for(let k=0;k<4;k++){const a=rand()*Math.PI*2;instance(stoneGeo,bambooLeaf,[x+Math.cos(a)*.45,y+Math.sin(a)*.45,z+h*(.7+rand()*.25)],[.55,.45,.6],[0,0,a]);}}

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
 return{group,rand,geo,mat,stoneGeo,smooth,instance,block,groundZ,rimX,plinth,loop,track,catenary,girderBridge,portal,tunnelLining,terrain,river,pool,poolMat,poolMesh,light,lights,props,paddy,betel,bamboo,finish,dispose};
}

export function createScene(params = {}){
 const p={label:'田園小站',...params};
 const k=createKit(31847),{block,instance,mat,rand,groundZ,props}=k;
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
 k.girderBridge(L,...bridge);

 // ── 前直線：木造小站（側式月台、雨棚、站房），西邊一處平交道。
 const fy=L.frontY,platTop=L.railZ+.12,platY0=fy-1.0,platY1=fy-2.9,stX0=1.5,stX1=15.5;
 const concrete=mat('#c9c2b2'),edge=mat('#ece6d6'),yellow=mat('#d8b451'),wood=mat('#8b6a4a'),woodDark=mat('#5d4634'),plaster=mat('#ece4d0'),roofTile=mat('#4e5a5e'),trim=mat('#7d5b3f');
 block(concrete,[stX1-stX0,platY0-platY1,platTop-groundZ],[(stX0+stX1)/2,(platY0+platY1)/2,(groundZ+platTop)/2]);
 block(edge,[stX1-stX0,.14,.02],[(stX0+stX1)/2,platY0-.07,platTop+.01]);block(yellow,[stX1-stX0-.4,.08,.02],[(stX0+stX1)/2,platY0-.42,platTop+.01]);
 // 雨棚：木柱、單斜鐵皮頂，往站房那側低。
 const cX0=4.5,cX1=12.5,cTop=platTop+2.35;
 for(let x=cX0;x<=cX1+.01;x+=2)block(wood,[.14,.14,cTop-platTop],[x,platY1+.55,platTop+(cTop-platTop)/2]);
 block(roofTile,[cX1-cX0+1.2,2.5,.09],[(cX0+cX1)/2,(platY0+platY1)/2-.05,cTop+.08],[-.1,0,0]);
 block(trim,[cX1-cX0+1.2,.08,.18],[(cX0+cX1)/2,platY0-.15,cTop+.15]);
 for(const x of [6.2,10.8]){block(wood,[1.0,.3,.06],[x,platY1+.95,platTop+.42]);block(woodDark,[.06,.26,.36],[x-.4,platY1+.95,platTop+.2]);block(woodDark,[.06,.26,.36],[x+.4,platY1+.95,platTop+.2]);}
 block(woodDark,[.07,.07,1.4],[stX0+1.4,platY1+.4,platTop+.7]);block(edge,[1.4,.07,.42],[stX0+1.4,platY1+.4,platTop+1.32]);block(mat('#3d6fa3'),[1.4,.08,.08],[stX0+1.4,platY1+.4,platTop+1.1]);
 // 站房：灰泥牆、木框、灰瓦兩坡頂，入口朝街。
 const hx=8.5,hy=platY1-2.0,hw=6.4,hd=2.8,hh=1.9;
 block(plaster,[hw,hd,hh],[hx,hy,groundZ+hh/2]);
 for(const x of [hx-hw/2,hx+hw/2])block(trim,[.14,hd+.04,hh],[x,hy,groundZ+hh/2]);block(trim,[hw+.04,hd+.04,.14],[hx,hy,groundZ+hh-.07]);
 const gable=k.geo((()=>{const v=[];for(const x of [-.5,.5])v.push(x,-.5,0,x,.5,0,x,0,1);const i=[0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5];const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);const f=g.toNonIndexed();f.computeVertexNormals();g.dispose();return f;})());
 instance(gable,roofTile,[hx,hy,groundZ+hh],[hw+.7,hd+.8,1.1]);
 const glass=props.glass;
 for(const x of [hx-2.1,hx-.9,hx+.9,hx+2.1])for(const side of [-1,1])block(glass,[.62,.06,.72],[x,hy+side*(hd/2+.02),groundZ+1.15]);
 block(woodDark,[1.0,.06,1.35],[hx,hy-hd/2-.02,groundZ+.68]);block(roofTile,[2.2,.9,.07],[hx,hy-hd/2-.4,groundZ+1.62],[.18,0,0]);
 const signBoard=mat('#f2ead6',{emissive:'#ffe6b8',emissiveIntensity:0});block(signBoard,[2.4,.08,.42],[hx,hy-hd/2-.06,groundZ+hh+.05]);
 // 站前小廣場、馬路、路燈。
 const roadY=-18.4;props.road(0,roadY,groundZ,62);
 const paving=mat('#b5ae9f');block(paving,[10,hy-hd/2-(roadY+.95),.04],[hx,(hy-hd/2+roadY+.95)/2,groundZ+.02]);
 const lampMat=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0}),poleMat=mat('#8d918d',{metalness:.4,roughness:.5});
 for(let x=-28;x<=28;x+=8){const ly=roadY+1.25;block(poleMat,[.1,.1,2.8],[x,ly,groundZ+1.4]);block(poleMat,[.07,1.0,.07],[x,ly-.5,groundZ+2.78]);block(lampMat,[.34,.3,.09],[x,ly-.95,groundZ+2.72]);k.pool(x,ly-.95,groundZ+.06,2.4,1.9);}
 for(const x of [stX0+3,stX1-3]){block(poleMat,[.08,.08,1.9],[x,platY1+.25,platTop+.95]);block(lampMat,[.3,.3,.1],[x,platY1+.25,platTop+1.92]);k.pool(x,platY1+.2,platTop+.02,1.7);}
 k.light(6.5,(platY0+platY1)/2,cTop-.3,2.2);k.light(10.5,(platY0+platY1)/2,cTop-.3,2.2);k.light(hx,hy-hd/2-1.0,groundZ+1.5,1.2,6);

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
 // 土地公廟：路口一間小廟，紅牆、燕尾脊，夜裡一盞紅燈。
 const temple=mat('#a8402f'),templeRoof=mat('#d38a3a');
 block(temple,[1.4,1.2,1.1],[xX-3.4,fy-4.2,groundZ+.55]);instance(gable,templeRoof,[xX-3.4,fy-4.2,groundZ+1.1],[1.9,1.6,.55]);
 for(const dx of [-1,1])block(templeRoof,[.12,.12,.35],[xX-3.4+dx*.98,fy-4.2,groundZ+1.38],[0,dx*-.6,0]);
 const shrineGlow=mat('#ffd38a',{emissive:'#ff9a4a',emissiveIntensity:0});block(shrineGlow,[.5,.06,.4],[xX-3.4,fy-4.82,groundZ+.5]);
 k.light(xX-3.4,fy-5.3,groundZ+1.0,.6,4,'#ff8a5a');

 // 路邊一排透天厝（村子），站房兩側。
 let tx=-31;for(let i=0;tx<-13;i++){const w=2.3+rand()*1.0;props.townhouse(tx+w/2,roadY+3.2,groundZ,{floors:2+Math.floor(rand()*2.2),width:w,depth:3.0,tint:i,roof:['tin','parapet','pitched','tin'][i%4],ground:['shop','plain','arcade'][i%3],balcony:rand()<.4?'cage':'rail',tanks:i%3?1:0});tx+=w+(rand()<.3?.9:.04);}
 tx=-8.6;for(let i=0;tx<1.4;i++){const w=2.2+rand()*.8;props.townhouse(tx+w/2,roadY+3.2,groundZ,{floors:2+Math.floor(rand()*2),width:w,depth:2.9,tint:i+5,roof:['tin','pitched','parapet'][i%3],ground:['shop','arcade','shop'][i%3],balcony:rand()<.4?'cage':'rail',tanks:i%2});tx+=w+.04;}
 tx=19;for(let i=0;tx<31;i++){const w=2.4+rand()*.9;props.townhouse(tx+w/2,roadY+3.2,groundZ,{floors:2+Math.floor(rand()*1.8),width:w,depth:3.0,tint:i+2,roof:['parapet','tin','pitched'][i%3],ground:i%2?'shop':'plain',balcony:rand()<.5?'cage':'rail',tanks:1});tx+=w+.05;}
 for(let x=-29;x<30;x+=7)props.pole(x+rand()*.5,roadY-1.05,groundZ);
 // 站前廣場：幾輛機車、兩台車、行道樹；廣場與月台之間一條便道。
 const scooter=mat('#2f2f33'),seat=mat('#c7c2b6'),carCols=['#e9e6df','#3f4a63','#b4402f','#8f9498'].map(c=>mat(c,{roughness:.5,metalness:.15})),carGlass=mat('#2e3a44',{roughness:.3});
 for(let i=0;i<7;i++){const x=hx+3.2+i*.42;block(scooter,[.3,.7,.32],[x,roadY+2.4,groundZ+.2]);block(seat,[.26,.38,.09],[x,roadY+2.35,groundZ+.4]);}
 for(const [x,c] of [[hx-3.6,0],[hx-2.4,2]]){block(carCols[c],[.8,1.7,.46],[x,roadY+2.6,groundZ+.29]);block(carGlass,[.7,.9,.32],[x,roadY+2.6,groundZ+.66]);}
 for(const x of [hx-5.6,hx+5.8])props.broadleaf(x,roadY+2.6,groundZ,2.1);
 block(paving,[1.1,hy-hd/2-(platY1)+.2,.04],[stX1-.8,(hy+platY1)/2+.3,groundZ+.02]);
 // 西側菜園：幾畦菜、竹架、小工具間。
 const soil=mat('#8a6f52'),veg=['#6f9a4c','#88b05a','#5f8a45'].map(c=>mat(c));
 for(let i=0;i<9;i++){const x=-29+i*1.15;block(soil,[.8,3.6,.12],[x,-11.2,groundZ+.06]);for(let j=0;j<6;j++)instance(k.stoneGeo,veg[(i+j)%3],[x,-12.7+j*.6,groundZ+.2],[.28,.26,.16],[0,0,rand()*3]);}
 for(let i=0;i<4;i++)block(woodDark,[.05,.05,1.3],[-29.5+i*2.4,-9.2,groundZ+.65]);block(woodDark,[7.4,.04,.04],[-25.9,-9.2,groundZ+1.25]);
 props.farmhouse(-19.2,-11.6,groundZ,{width:2.2,depth:1.6,tint:4,facing:0,pitched:false});
 // 東側果園：一排排矮果樹。
 for(let i=0;i<4;i++)for(let j=0;j<3;j++)props.broadleaf(19.5+i*1.9,-13.2+j*1.9,groundZ,1.2+rand()*.3,'round');

 // ── 環內：稻田、三合院、田埂小路。
 const cx=xX,cyd=3.0;
 props.farmhouse(cx,cyd+1.9,groundZ,{width:5.2,depth:2.2,tint:0,facing:0});
 props.farmhouse(cx-2.9,cyd-.4,groundZ,{width:3.0,depth:1.9,tint:3,facing:Math.PI/2});
 props.farmhouse(cx+2.9,cyd-.4,groundZ,{width:3.0,depth:1.9,tint:1,facing:-Math.PI/2});
 block(mat('#d9d2c0'),[4.6,3.2,.03],[cx,cyd-.1,groundZ+.02]);
 for(const [x,y,ph,t] of [[-15.9,-2.9,'young',0],[-15.9,2.4,'young',1],[-3.6,-2.9,'young',2],[-3.6,2.4,'gold',0],[.9,-2.9,'young',1],[.9,2.4,'young',0],[5.4,-2.9,'gold',1],[5.4,2.4,'young',2]])k.paddy(x,y,4.0,4.8,{phase:ph,tint:t});
 block(farmRoad,[.9,9.6,.03],[-13.4,0,groundZ+.015]);block(farmRoad,[.9,9.6,.03],[-1.35,0,groundZ+.015]);
 for(const [x,y] of [[-6.2,4.9],[-13.8,5.3],[7.6,5.5],[8.2,-4.7],[-17.4,5.6],[17.4,-4.2]])props.broadleaf(x,y,groundZ,1.9+rand()*.8);
 for(const [x,y] of [[-12.7,6.1],[-11.9,6.3],[-7.4,6.2],[17.3,4.6],[17.6,5.7]])k.betel(x,y,groundZ,2.8+rand()*.8);
 k.bamboo(-6.4,5.9,groundZ,2.7);k.bamboo(15.4,5.6,groundZ,2.9);
 const straw=mat('#cdb46e');for(const [x,y] of [[-1.3,5.6],[-.4,5.9],[3.4,5.7]])instance(k.stoneGeo,straw,[x,y,groundZ+.3],[.42,.42,.5],[0,0,rand()*3]);
 for(let y=-4.6;y<6;y+=3.5)props.pole(-12.6,y,groundZ,2.8);
 block(mat('#7a8a8c'),[1.4,1.1,1.0],[7.9,-.2,groundZ+.5]);block(mat('#556c70'),[1.6,1.3,.1],[7.9,-.2,groundZ+1.05],[.12,0,0]);
 k.light(cx,cyd-.6,groundZ+1.6,.8,6);

 // ── 環外：後方田間小路、檳榔園、竹叢、樹；東側溪邊農舍。
 block(farmRoad,[48,1.0,.03],[-2,L.backY+2.45,groundZ+.015]);
 for(let x=-13;x<15;x+=1.05)for(const y of [L.backY+3.6,L.backY+4.6])if(rand()<.85)k.betel(x+(rand()-.5)*.3,y+(rand()-.5)*.3,groundZ+(y>L.backY+4?.15:0),2.9+rand()*.9);
 for(const [x,y] of [[-15,13.5],[17,12.4],[22.5,11.5],[11,14.6],[-19,11.2]])k.bamboo(x,y,groundZ+.05,2.6+rand()*.6);
 for(let n=0;n<70;){const x=-31+rand()*62,y=12.5+rand()*7;const h=backHill(x,y);if(h<.25||Math.abs(x+28)<6)continue;props.broadleaf(x,y,groundZ+.02+h,1.3+rand()*1.0);n++;}
 for(let n=0;n<30;){const x=-32+rand()*15,y=-10+rand()*21;const h=westHill(x,y),nn=L.nearest(x,y);if(h<.6||nn.d<2.4)continue;props.broadleaf(x,y,groundZ+.02+h,1.3+rand()*.9);n++;}
 props.farmhouse(28.5,-7.5,groundZ,{width:3.0,depth:2.3,tint:2,facing:Math.PI*.5,pitched:true});k.light(27,-7.5,groundZ+1.3,.45,5);
 for(const [x,y] of [[30.5,-3],[29,4.5],[31,7.2],[27.5,10.4],[30.8,-12.5],[-31,-13.5],[-24,-12.2],[24,-12.6]])props.broadleaf(x,y,groundZ,1.8+rand()*.9);
 for(let n=0;n<26;){const x=-32+rand()*64,y=-17+rand()*36;const nn=L.nearest(x,y);if(nn.d<2.3||(y<-9&&Math.abs(x-8)<9)||(Math.abs(x+10)<6.5&&y>-7&&y<7)||(x>8&&x<17&&Math.abs(y)<4.5)||(y>-17&&y<-13.5)||Math.abs(x+28)<6)continue;props.bush(x,y,groundZ,.3+rand()*.3);n++;}

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
   props.glass.emissiveIntensity=t.window;for(const s of props.signs)s.emissiveIntensity=t.window*.7;
   for(const l of k.lights)l.intensity=t.lamp*9*l.userData.k;
   k.poolMat.opacity=t.lamp*.8;if(poolMesh)poolMesh.visible=t.lamp>0;
   return t;
  },
  dispose:k.dispose
 };
}

// 捷運、高鐵、機捷車庫場景的共用骨架：底座、環線與直線穿越、高架橋、四種軌道、第三軌、架空線、月台、月台門、水面、燈與光池、街上的車、高樓、合批。
// 各座場景只寫自己的地標站房與街景，骨架都從這裡拿；幾何全是程式算的，零資產檔。
// App 的場景檔是 native scripts/garage-scenes/bake.mjs 拿這些模組烘出來的（靜態幾何＋三時段材質、燈、光池），所以：
// 材質只用 MeshStandardMaterial（光池是唯一的 MeshBasicMaterial，名字要叫 lamp-pool）；會動的東西在 App 不會動；
// 不要把物件命名成 catenary（那是田園小站照車款開關的電車線，原生會依車款藏起來）。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';
import {createTaiwanTrees,MIX} from './taiwan-trees.js';

// 軌距的一半（場景單位，車寬一律 1.25）：從車模底部頂點量，輪子最密的橫向位置。
// 高運量、機捷、環狀線、三鶯線、台中、高雄、高鐵都是 .455（同 EMU3000 的 .46）；淡海、安坑、高雄輕軌 .42；
// 文湖線膠輪 APM256 .43、VAL256 .457，走行面取中間、做寬一點兩款都托得住。
export const GAUGE = {heavy:.46, light:.42, rubber:.445};

export function createKit({seed = 1, plinth = [66, 40, 4], grass = '#87956b', trees: treeMix = MIX.city} = {}) {
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),disc=geo(new THREE.CircleGeometry(1,24));
 const cylinder=geo(new THREE.CylinderGeometry(.5,.5,1,14));cylinder.rotateX(Math.PI/2);   // Z 朝上的單位圓柱：圓墩、圓柱
 // 單位屋頂：底面 x、y 各 ±.5、高 1。prism 是兩坡（屋脊沿 x 整條）；hip 是四坡（屋脊只有中間一半），宮殿式、倉庫的屋頂都用它們縮放。
 const solid=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);const flat=g.toNonIndexed();flat.computeVertexNormals();g.dispose();return geo(flat);};
 const prism=solid([-.5,-.5,0,-.5,.5,0,-.5,0,1,.5,-.5,0,.5,.5,0,.5,0,1],[0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5]);
 const hip=solid([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0,-.25,0,1,.25,0,1],[0,1,5,0,5,4,2,3,4,2,4,5,1,2,5,3,0,4,0,3,2,0,2,1]);
 // 骨架的材質。場景要別的顏色就自己 mat()；glass／lamp／sign 的夜間自發光由 period() 統一調。
 const M={
  concrete:mat('#cdc7b8'),concreteDark:mat('#a79f8e'),deck:mat('#d7d2c4'),slab:mat('#bdb8ab'),
  steel:mat('#9aa3a4',{metalness:.6,roughness:.34}),railSide:mat('#6e6259',{metalness:.35,roughness:.6}),fastener:mat('#4a4c4e',{roughness:.6}),
  ballast:mat('#8b8577'),sleeper:mat('#c6c1b4'),pad:mat('#8d8f8c',{metalness:.3,roughness:.5}),
  platform:mat('#c9c4b6'),edge:mat('#d8b451'),tactile:mat('#e3c768'),
  glass:mat('#6d8c96',{metalness:.2,roughness:.18,emissive:'#ffd79a',emissiveIntensity:0}),
  gateGlass:mat('#b4ccd3',{metalness:.1,roughness:.12,transparent:true,opacity:.4}),
  lamp:mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0}),sign:mat('#f2e6cc',{emissive:'#ffe3b0',emissiveIntensity:0}),
  wire:mat('#4c4a46',{metalness:.5,roughness:.4}),mast:mat('#b9bcb6',{metalness:.5,roughness:.45}),
  cover:mat('#d6cba2'),insulator:mat('#6f6257'),grass:mat(grass),paving:mat('#9d9a90'),
 };
 M.sleeper.name='sleeper';M.mast.name='mast';M.concrete.name='concrete';M.lamp.name='lamp';

 // 同材質的靜態方塊合批，柱子與欄杆不各佔一次 draw call（同 viaduct.js）。
 const batches=new Map(),dummy=new THREE.Object3D();
 function instance(g,m,pos,scale,rot=[0,0,0]){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot});}
 const block=(m,size,pos,rot)=>instance(box,m,pos,size,rot);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}

 // 底座與地面（同 viaduct.js）：底座頂面＝起點 −2 ＋ depth 1.05 ＋ bevelThickness .2，地面貼在它上面一點。
 const [plinthW,plinthD,plinthR]=plinth,outline=rounded(plinthW,plinthD,plinthR);
 mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(plinthW+.6,plinthD+.6,plinthR+.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
 const plinthTop=-2+1.05+.2,groundZ=plinthTop+.05;
 const ground=mesh(geo(new THREE.ShapeGeometry(outline,24)),M.grass,[0,0,groundZ]);ground.castShadow=false;
 // 點在不在底座頂面（圓角矩形）裡、離邊至少 m：亂數撒的樹與房子先問這個，才不會長到底座外面。
 const inside=(x,y,m=1)=>{const ax=Math.abs(x)-(plinthW/2-plinthR),ay=Math.abs(y)-(plinthD/2-plinthR);return Math.abs(x)<=plinthW/2-m&&Math.abs(y)<=plinthD/2-m&&(ax<=0||ay<=0||Math.hypot(ax,ay)<=plinthR-m);};

 // 環線（同 viaduct.js）：前直線 y＝cy−radius 是車站段，逆時針跑；z 是軌頂（車模原點是輪底，跟車器把車放在 path.z）。
 function loop({half=19,radius=8,cy=1.5,z=groundZ+4.18}={}){
  const length=half*4+2*Math.PI*radius;
  function sample(s){
   let q=((s+half)%length+length)%length,x,y,heading;
   if(q<half*2){x=-half+q;y=cy-radius;heading=0;}
   else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
   else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}
   else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
   return{x,y,z,heading};
  }
  return{sample,length,half,radius,cy,z,front:cy-radius,back:cy+radius};
 }
 // 直線穿越（garage-diorama.js 行駛方式 3）：沿 x 一股軌道，軌道鋪到底座邊（±half）。cycle 是一趟長（SCENES 的 pass[0]），車開出底座就繞回另一端。
 function line({y=-6.5,z=groundZ+4.18,half=plinthW/2,cycle=100}={}){
  return{sample:s=>({x:s,y,z,heading:0}),length:cycle,trackStart:-half,trackLength:half*2,half,z,front:y};
 }
 // 同一股往 −x 開（對向車）：幾何照原方向鋪，只有車走這條。
 const reversed=p=>({...p,sample:s=>{const q=p.sample(-s);return{...q,heading:q.heading+Math.PI};}});
 // 沿環線鋪帶狀面：每段給左右兩緣的橫向偏移與高度（相對軌頂），同材質的幾段合成一個網格。偏移正的往環內（行進方向左手），負的往環外（前直線上就是觀者那一側）。
 // 法向量跟著頂點順序走：偏移由小到大鋪出來朝上，反過來朝下；立面由下往上鋪朝 −偏移側，由上往下鋪朝 ＋偏移側（同 viaduct.js）。
 function strips(path,material,parts,{N=520,from=path.trackStart??0,to=from+(path.trackLength??path.length)}={}){
  const v=[],idx=[];
  for(const [o1,z1,o2,z2] of parts){const base=v.length/3;
   for(let i=0;i<=N;i++){const q=path.sample(from+(to-from)*i/N),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
    v.push(q.x+sx*o1,q.y+cx*o1,q.z+z1,q.x+sx*o2,q.y+cx*o2,q.z+z2);
    if(i<N){const n=base+i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);
 }
 const ribbon=(path,offset,width,z,material,opts)=>strips(path,material,[[offset-width/2,z,offset+width/2,z]],opts);
 // 沿環線每隔約 step 擺一次（取每格中點）；只鋪 [from, to] 這段。
 function along(path,step,fn,{from=path.trackStart??0,to=from+(path.trackLength??path.length)}={}){const n=Math.max(1,Math.round((to-from)/step)),d=(to-from)/n;for(let k=0;k<n;k++){const s=from+d*(k+.5);fn(path.sample(s),s);}}
 // 環線上某點往旁邊 offset、往上 dz 的世界座標。
 const at=(q,offset,dz=0)=>[q.x-Math.sin(q.heading)*offset,q.y+Math.cos(q.heading)*offset,q.z+dz];

 // 高架橋：橋面、往內斜的腹板、底板，兩側矮牆，下面一排橋墩。橋面在軌頂下 .23（同 viaduct.js）。
 // walls＝[外側牆高, 內側牆高]，open(q, side) 為真的地方那一側不砌牆（月台邊；side −1 外側、＋1 內側）；pier(q) 為假的地方不立墩（站體自己有柱子）。
 function viaduct(path,{half=1.75,depth=.5,walls=[.5,.5],spacing=3.4,round=false,open=()=>false,pier=()=>true}={}){
  const top=-.23,bottom=top-depth,inset=Math.min(.7,half*.4);
  ribbon(path,0,half*2,top,M.deck);
  strips(path,M.concreteDark,[[-(half-inset),bottom,-half,top],[half,top,half-inset,bottom],[half-inset,bottom,-(half-inset),bottom]],{N:360});
  along(path,1.05,q=>{for(const [side,h] of [[-1,walls[0]],[1,walls[1]]]){if(!h||open(q,side))continue;block(M.concrete,[1.06,.16,h],at(q,side*(half-.08),top+h/2),[0,0,q.heading]);}});
  // 柱身高度由「柱帽底緣減地面」推導，橋高改動時柱子不會浮空也不會插進地裡。
  const capH=.32;
  along(path,spacing,q=>{if(!pier(q))return;const capZ=q.z+bottom-capH/2,colH=capZ-capH/2-groundZ,[x,y]=at(q,0);
   if(round)instance(cylinder,M.concrete,[x,y,groundZ+colH/2],[1.25,1.25,colH]);else block(M.concrete,[1.1,1.25,colH],[x,y,groundZ+colH/2],[0,0,q.heading]);
   block(M.concreteDark,[1.5,half*2-inset*1.6,capH],[x,y,capZ],[0,0,q.heading]);
   block(M.concreteDark,[1.9,1.9,.26],[x,y,groundZ+.12],[0,0,q.heading]);});
 }
 // 鋼軌：軌頭（亮鋼）與軌腰，軌頂＝0。名字給驗收腳本在網格裡找。
 function rails(path,gauge,opts){
  const w=.10,h=.12;
  strips(path,M.steel,[-gauge,gauge].map(o=>[o-w/2,0,o+w/2,0]),opts).name='rail-head';
  strips(path,M.railSide,[-gauge,gauge].flatMap(o=>[[o-w/2,-h,o-w/2,0],[o+w/2,0,o+w/2,-h]]),opts).name='rail-web';
 }
 // 直結軌道（高架捷運、高鐵）：一整條混凝土道床，鋼軌下一格格扣件。
 function slabTrack(path,{gauge=GAUGE.heavy,half=1.0,step=.6}={}){
  strips(path,M.slab,[[-half,-.23,-half,-.15],[-half,-.15,half,-.15],[half,-.15,half,-.23]]);
  strips(path,M.fastener,[-gauge,gauge].map(o=>[o-.08,-.13,o+.08,-.13]));
  along(path,step,q=>{for(const o of [-gauge,gauge])block(M.fastener,[.12,.28,.05],at(q,o,-.135),[0,0,q.heading]);});
  rails(path,gauge);
 }
 // 道碴軌道（地面段）：梯形道碴斷面、PC 枕露出上半截、鋼軌（同 viaduct.js）。
 function ballastTrack(path,{gauge=GAUGE.heavy,step=.42}={}){
  strips(path,M.ballast,[[-1.45,-.23,-1.05,-.18],[-1.05,-.18,1.05,-.18],[1.05,-.18,1.45,-.23]],{N:360});
  along(path,step,q=>block(M.sleeper,[.18,gauge*2+.48,.10],at(q,0,-.17),[0,0,q.heading]));
  rails(path,gauge);
 }
 // 膠輪導軌（文湖線）：兩條走行面托輪胎（頂面＝軌頂），兩側導軌在導輪高度（也是供電軌），一格格支架。
 // 導軌在 ±.72：VAL256 車底最外緣到 .625，導輪與集電靴要伸得到。
 function guideway(path,{pad=GAUGE.rubber,padW=.24,guide=.72,step=1.2}={}){
  strips(path,M.slab,[[-1.0,-.23,-1.0,-.17],[-1.0,-.17,1.0,-.17],[1.0,-.17,1.0,-.23]]);
  strips(path,M.concreteDark,[-pad,pad].flatMap(o=>[[o-padW/2,-.17,o-padW/2,0],[o+padW/2,0,o+padW/2,-.17]]));
  strips(path,M.pad,[-pad,pad].map(o=>[o-padW/2,0,o+padW/2,0])).name='running-pad';
  strips(path,M.steel,[-guide,guide].flatMap(o=>[[o,.08,o,.2],[o,.2,o,.08]])).name='guide-bar';
  along(path,step,q=>{for(const o of [-guide,guide])block(M.insulator,[.08,.16,.4],at(q,o+Math.sign(o)*.07,-.03),[0,0,q.heading]);});
 }
 // 路面輕軌：鋼軌埋進路面、軌面跟路面齊；淡海、安坑鋪混凝土，高雄鋪草皮。只畫一條窄窄的軌頂與兩側溝槽。
 // 草皮軌道比底座的草深一點、兩側壓一條路緣石，不然跟地面混成一片。
 function embeddedTrack(path,{gauge=GAUGE.light,half=1.15,surface='paved'}={}){
  if(surface==='grass'){ribbon(path,0,half*2,-.012,M.lawn??=mat('#5f8a48'));strips(path,M.concrete,[[-half-.12,-.004,-half,-.004],[half,-.004,half+.12,-.004]]);}
  else ribbon(path,0,half*2,-.012,M.paving);
  strips(path,M.fastener,[-gauge,gauge].flatMap(o=>[[o-.075,-.008,o-.035,-.008],[o+.035,-.008,o+.075,-.008]]));
  strips(path,M.steel,[-gauge,gauge].map(o=>[o-.035,0,o+.035,0])).name='rail-head';
 }
 // 第三軌：裝在月台對面（side ＋1 環內、−1 環外），絕緣支架一格格，導電軌上蓋防護板。
 // 偏移 .78：車身半寬 .625，集電靴在車底外緣下方，防護板要露在車身外面看得到。
 function thirdRail(path,{side=1,offset=.78,step=1.1}={}){
  const o=side*offset;
  strips(path,M.steel,[[o-.035,.03,o+.035,.03]]).name='conductor-rail';
  strips(path,M.cover,[[o-.09,.11,o+.09,.11],...(side>0?[[o+.09,.11,o+.09,.05]]:[[o-.09,.05,o-.09,.11]])]).name='rail-cover';
  along(path,step,q=>block(M.insulator,[.07,.12,.33],at(q,o,-.06),[0,0,q.heading]));
 }
 // 架空線：接觸線離軌頂 height，電桿在 mast 偏移處、伸懸臂到軌道上方。messenger 給高度差就多一條吊線與吊弦（高鐵）。
 // 輕軌的高度：淡海、安坑車模連集電弓頂 2.01，接觸線 2.02 剛好壓著弓。
 function overhead(path,{height=2.02,mast=1.35,spacing=6.6,messenger=0,mastTop=height+.5}={}){
  strips(path,M.wire,[[-.016,height,.016,height]]).name='contact-wire';
  if(messenger){strips(path,M.wire,[[-.014,height+messenger,.014,height+messenger]]).name='messenger-wire';
   along(path,.9,q=>block(M.wire,[.025,.025,messenger],at(q,0,height+messenger/2),[0,0,q.heading]));}
  along(path,spacing,q=>{const deckZ=q.z-.23;
   block(M.mast,[.15,.15,mastTop-(deckZ-q.z)],at(q,mast,(mastTop+deckZ-q.z)/2),[0,0,q.heading]);
   block(M.mast,[.08,Math.abs(mast)+.2,.08],at(q,mast/2,height+messenger+.25),[0,0,q.heading]);
   block(M.mast,[.06,.06,messenger+.27],at(q,0,height+(messenger+.27)/2),[0,0,q.heading]);});
 }

 // 月台：沿直線段（x 方向）一側。y 是軌道中心線，side −1 往 −y、＋1 往 ＋y；邊緣離軌道中心 edge（車身半寬 .625 加縫）。
 // top 是月台面高出軌頂多少（捷運高月台 .2、輕軌低地板 .1、高鐵 .25）；bottom 是月台體的底（高架站給橋面、地面站給地面）。
 // 回傳月台各邊的座標，給場景擺站房、雨棚、月台門。
 function platform({x=0,y,z,side=-1,length=19,width=3,edge=.7,top=.2,bottom=z-.23}){
  const y0=y+side*edge,y1=y+side*(edge+width),zt=z+top;
  block(M.platform,[length,width,zt-bottom],[x,(y0+y1)/2,(zt+bottom)/2]);
  block(M.edge,[length,.14,.02],[x,y0+side*.12,zt+.01]);
  block(M.tactile,[length,.16,.02],[x,y0+side*.42,zt+.01]);
  return{x,y,y0,y1,z:zt,side,length,width};
 }
 // 半高月台閘門：一格一根不鏽鋼立柱，中間玻璃門扇，上緣一條扶手。
 function gates(p,{height=.55,bay=1.6}={}){
  const y=p.y0+p.side*.04,n=Math.round(p.length/bay),d=p.length/n;
  for(let k=0;k<=n;k++)block(M.steel,[.07,.1,height],[p.x-p.length/2+k*d,y,p.z+height/2]);
  for(let k=0;k<n;k++)block(M.gateGlass,[d-.12,.03,height-.1],[p.x-p.length/2+(k+.5)*d,y,p.z+(height-.1)/2+.02]);
  block(M.steel,[p.length,.08,.05],[p.x,y,p.z+height]);
 }
 // 全高月台門（文湖線）：玻璃牆到頂，上方門楣是一條深色箱子，一格格門框。
 function screenDoors(p,{height=2.0,bay=1.6}={}){
  const y=p.y0+p.side*.05,n=Math.round(p.length/bay),d=p.length/n,header=.32;
  for(let k=0;k<=n;k++)block(M.steel,[.08,.12,height],[p.x-p.length/2+k*d,y,p.z+height/2]);
  for(let k=0;k<n;k++)block(M.gateGlass,[d-.14,.03,height-header-.04],[p.x-p.length/2+(k+.5)*d,y,p.z+(height-header)/2]);
  block(M.fastener,[p.length,.3,header],[p.x,y,p.z+height-header/2]);
 }

 // 燈：點光源在每個材質的 shader 裡逐盞算，超過八盞 headless Chromium 開頁就掉 context、手機也吃不消（同 viaduct.js），
 // 所以路燈底下的光改用加色混合的圓盤（光池），點光源只留月台與站房入口；App 端場景燈加列車頭燈總數上限 12。
 const lights=[],addLight=(name,x,y,z,k=1,dist=7)=>{const l=new THREE.PointLight('#ffd193',0,dist,2);l.position.set(x,y,z);l.name=name;l.userData.k=k;group.add(l);lights.push(l);return l;};
 const poolTex=typeof document==='undefined'?null:(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.5,'rgba(255,255,255,.5)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();   // 驗收與烘焙在 Node 端也會 import，沒有 document 就不帶貼圖
 const poolMat=new THREE.MeshBasicMaterial({color:'#ffd9a0',map:poolTex,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});poolMat.name='lamp-pool';materials.add(poolMat);
 const pool=(x,y,z,sx,sy=sx)=>instance(disc,poolMat,[x,y,z],[sx,sy,1]);

 // 水面：沿用站前街（遠緣海，種類 1：從 y＝0 那條邊往 ＋y 漸深、近岸起浪花）與十分老街（河，種類 2：沿 x 的一條河、兩岸起浪花）的 shader。
 // App 端照 bake.mjs 的 WATER_KIND 畫同一套波紋，一座場景只能有一種水；水面物件不能旋轉或縮放。
 let water=null;
 function waterMaterial(theme,body){
  const m=mat(theme.water,{roughness:.32,metalness:.14});
  m.onBeforeCompile=s=>{
   s.uniforms.seaTime={value:0};s.uniforms.shallow={value:new THREE.Color(theme.shallow)};m.userData.shader=s;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 seaPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nseaPosition=position;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float seaTime; uniform vec3 shallow; varying vec3 seaPosition;').replace('#include <color_fragment>',`#include <color_fragment>\n${body}`);
  };
  water={material:m,update(time,t){m.color.set(t.water);const sh=m.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}}};
  return m;
 }
 // 遠緣海：shape 是 ShapeGeometry 的外形（物件座標 y＝0 是岸邊），放在 [x, y]。
 function sea(shape,[x,y],theme){
  const m=waterMaterial(theme,`float d=seaPosition.y;
   float wave=sin(d*4.1-seaTime*.7+sin(seaPosition.x*.36)*.6);
   float foam=smoothstep(.9,1.0,wave)*(1.0-smoothstep(0.,2.2,d))*smoothstep(-.15,.25,d);
   diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*.3)*.72)+foam*.18;`);
  const o=mesh(geo(new THREE.ShapeGeometry(shape,20)),m,[x,y,groundZ+.04]);o.castShadow=false;o.name='sea';return o;
 }
 // 河：沿 x 長 length、寬 width，中心在 [x, y]。
 function river(length,width,[x,y],theme){
  const m=waterMaterial(theme,`float d=${(width/2).toFixed(2)}-abs(seaPosition.y);
   float wave=sin(seaPosition.x*1.7-seaTime*1.1+sin(seaPosition.y*2.3)*.8);
   float foam=smoothstep(.85,1.0,wave)*(1.0-smoothstep(0.,1.1,d));
   diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*1.4)*.7)+foam*.16;`);
  const o=mesh(geo(new THREE.PlaneGeometry(length,width,1,1)),m,[x,y,groundZ+.04]);o.castShadow=false;o.name='river';return o;
 }

 const props=createProps({geo,mat,instance,rand});
 // 透天厝帶細節（窗楣、冷氣、落水管、直招牌）；樹一律種台灣樹種（整批一個 draw call，不吃場景亂數）。keepClear(f)：f(x,y) 為真的地方不種（高架橋底、軌道邊）。
 const plainHouse=props.townhouse,trees=createTaiwanTrees({geo,material:m=>(materials.add(m),m),shadowCap:.0015});
 let blocked=()=>false;const keepClear=f=>{blocked=f;};
 props.townhouse=(x,y,z,o={})=>plainHouse(x,y,z,{detail:true,...o});
 props.broadleaf=(x,y,z,h=2.2)=>{if(!blocked(x,y))trees.plantMix(treeMix,x,y,z,h*1.15);};

 // 街上的車：車身、車窗、車頂都是側面輪廓沿車寬擠出（車頭朝 +x、輪底在 0），輪子一軸一根貫穿、燈各一小塊。yaw 0 朝 +x。
 const extruded=(pts,w)=>{const g=new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p=>new THREE.Vector2(...p))),{depth:w,bevelEnabled:false});g.rotateX(Math.PI/2);g.translate(0,w/2,0);return geo(g);};
 const CW=.78,BODY={
  sedan:{wheel:[-.56,.56],body:extruded([[-.92,.16],[-.93,.36],[-.86,.45],[-.46,.47],[.3,.47],[.78,.41],[.92,.33],[.93,.16]],CW),
   cabin:extruded([[-.72,.45],[-.46,.66],[.06,.68],[.44,.46]],CW*.86),roof:extruded([[-.52,.65],[-.44,.7],[.08,.71],[.15,.65]],CW*.88)},
  suv:{wheel:[-.54,.54],body:extruded([[-.86,.18],[-.88,.48],[-.8,.54],[.3,.54],[.76,.48],[.9,.38],[.9,.18]],CW*1.02),
   cabin:extruded([[-.84,.52],[-.76,.8],[.14,.82],[.5,.54]],CW*.88),roof:extruded([[-.8,.79],[-.76,.85],[.16,.85],[.22,.79]],CW*.9)},
 };
 const paints=['#e9e6df','#f2f1ec','#3f4a63','#b4402f','#8f9498','#2f3236','#5c7f8f'].map(c=>mat(c,{roughness:.42,metalness:.2})),taxiPaint=mat('#e7c23c',{roughness:.42,metalness:.15});
 const carGlass=mat('#2e3a44',{roughness:.22,metalness:.25}),tyre=mat('#25272a',{roughness:.8}),hub=mat('#b8bcbe',{roughness:.4,metalness:.5}),trim=mat('#33363a',{roughness:.6}),tail=mat('#b52a28',{emissive:'#ff2c1e',emissiveIntensity:0});
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 車身座標（a 往車頭、b 往左）換到世界。
 const onCar=(x,y,yaw)=>{const c=Math.cos(yaw),s=Math.sin(yaw);return(a,b)=>[x+a*c-b*s,y+a*s+b*c];};
 function axle(P,a,r,w,z,yaw){const [x,y]=P(a,0);instance(cylinder,tyre,[x,y,z+r],[r*2,r*2,w],[Math.PI/2,0,yaw]);instance(cylinder,hub,[x,y,z+r],[r,r,w+.02],[Math.PI/2,0,yaw]);}
 function car(x,y,{yaw=0,kind=rand()<.3?'suv':'sedan',paint=pick(paints),taxi=false,z=groundZ}={}){
  const b=BODY[kind],P=onCar(x,y,yaw),rot=[0,0,yaw],m=taxi?taxiPaint:paint,at=(a,s,h)=>[...P(a,s),z+h];
  instance(b.body,m,[x,y,z],[1,1,1],rot);instance(b.cabin,carGlass,[x,y,z],[1,1,1],rot);instance(b.roof,m,[x,y,z],[1,1,1],rot);
  for(const a of b.wheel)axle(P,a,.15,CW+.02,z,yaw);
  block(trim,[.05,CW+.01,.08],at(.92,0,.22),rot);block(trim,[.05,CW+.01,.08],at(-.92,0,.22),rot);
  for(const s of [-.26,.26]){block(M.lamp,[.03,.17,.06],at(.93,s,.33),rot);block(tail,[.03,.17,.07],at(-.93,s,.37),rot);}
  for(const s of [-1,1])block(m,[.1,.05,.04],at(.3,s*(CW/2+.03),.47),rot);   // 後照鏡
  if(taxi)block(M.sign,[.26,.12,.1],at(-.15,0,.76),rot);
 }
 // 公車：車身、整排車窗、擋風玻璃、車門、車頂冷氣、車頭電子看板、色帶。len 全長。
 const busBody=extruded([[-.5,.12],[-.5,.95],[-.47,1],[.45,1],[.5,.86],[.5,.12]],1);
 function bus(x,y,{yaw=0,len=4.2,paint=paints[1],stripe=paints[3],z=groundZ}={}){
  const P=onCar(x,y,yaw),rot=[0,0,yaw],W=.98,H=1.22,at=(a,s,h)=>[...P(a,s),z+h];
  instance(busBody,paint,[x,y,z],[len,W,H],rot);
  block(carGlass,[len*.9,W+.02,.42],at(-.02,0,.84),rot);
  block(carGlass,[.04,W*.86,.5],at(len/2-.03,0,.82),rot);block(stripe,[len+.02,W+.02,.12],at(0,0,.46),rot);
  for(const a of [.33,-.05]){block(trim,[.56,.03,.74],at(len*a,-W/2-.01,.5),rot);block(carGlass,[.2,.03,.6],at(len*a-.14,-W/2-.02,.55),rot);block(carGlass,[.2,.03,.6],at(len*a+.14,-W/2-.02,.55),rot);}
  block(paints[4],[len*.42,W*.62,.14],at(-.1,0,H+.05),rot);block(M.sign,[.04,W*.6,.13],at(len/2-.02,0,H-.1),rot);
  for(const s of [-.34,.34]){block(M.lamp,[.03,.16,.08],at(len/2+.01,s,.3),rot);block(tail,[.03,.16,.1],at(-len/2-.01,s,.34),rot);}
  for(const a of [-len*.28,len*.3])axle(P,a,.2,W+.02,z,yaw);
 }
 // 機車：踏板、車殼、前擋、座墊、把手、前後輪。yaw 0 朝 +x，一格長 .7。
 const scooterPaint=['#f2f1ec','#b4402f','#3f6ea3','#8f9498','#2f3236','#d9a441'].map(c=>mat(c,{roughness:.4,metalness:.15}));
 function scooter(x,y,{yaw=0,paint=pick(scooterPaint),z=groundZ}={}){
  const P=onCar(x,y,yaw),rot=[0,0,yaw],at=(a,h)=>[...P(a,0),z+h];
  block(paint,[.36,.15,.07],at(.02,.17),rot);block(paint,[.26,.17,.18],at(-.2,.29),rot);block(paint,[.06,.17,.3],at(.21,.33),[0,-.22,yaw]);
  block(tyre,[.24,.14,.06],at(-.18,.41),rot);block(trim,[.04,.3,.03],at(.22,.52),rot);
  for(const a of [-.26,.27]){const [wx,wy]=P(a,0);instance(cylinder,tyre,[wx,wy,z+.11],[.22,.22,.06],[Math.PI/2,0,yaw]);}
 }
 const towerGlass=mat('#5f7c88',{metalness:.3,roughness:.16,emissive:'#ffd79a',emissiveIntensity:0}),towerDark=mat('#5f7c88',{metalness:.3,roughness:.16});   // 夜裡一半的窗沒開燈
 // 高樓。office：玻璃帷幕，每層一道樓板、四面豎框；home：牆面開窗（一層三扇）、正面一排陽台。都帶一樓店面、屋頂機房、水塔、天線。
 function tower(x,y,{w=3.6,d=3,h=10,body=paints[1],kind='home',floor=.98,z=groundZ}={}){
  const base=z,podium=1.05,top=base+h,n=Math.floor((h-podium)/floor);
  block(body,[w+.3,d+.3,podium],[x,y,base+podium/2]);block(towerGlass,[w*.86,d+.34,podium*.62],[x,y,base+podium*.42]);block(trim,[w+.36,d+.36,.08],[x,y,base+podium]);
  if(kind==='office'){
   block(towerDark,[w,d,h-podium],[x,y,base+podium+(h-podium)/2]);
   for(let i=0;i<=n;i++)block(body,[w+.06,d+.06,.09],[x,y,base+podium+i*(h-podium)/n]);
   for(let i=0;i<n;i++)if(rand()<.45)block(towerGlass,[w+.02,d+.02,(h-podium)/n-.12],[x,y,base+podium+(i+.5)*(h-podium)/n]);
   const zc=base+podium+(h-podium)/2,nx=Math.round(w/.72),ny=Math.round(d/.72);
   for(let i=1;i<nx;i++)block(body,[.07,d+.08,h-podium],[x-w/2+i*w/nx,y,zc]);
   for(let i=1;i<ny;i++)block(body,[w+.08,.07,h-podium],[x,y-d/2+i*d/ny,zc]);
   for(const a of [-1,1])for(const c of [-1,1])block(body,[.14,.14,h-podium],[x+a*w/2,y+c*d/2,zc]);
  }else{
   block(body,[w,d,h-podium],[x,y,base+podium+(h-podium)/2]);
   for(let i=0;i<n;i++){const z=base+podium+(i+.58)*floor;
    for(const a of [-1,0,1])block(rand()<.5?towerGlass:towerDark,[w*.24,d+.04,floor*.5],[x+a*w*.31,y,z]);
    for(const a of [-1,1])block(rand()<.5?towerGlass:towerDark,[w+.04,d*.26,floor*.5],[x,y+a*d*.27,z]);
    block(body,[w*.94,.34,.07],[x,y-d/2-.16,z-floor*.42]);block(cage,[w*.94,.03,.26],[x,y-d/2-.32,z-floor*.26]);}
  }
  block(body,[w+.12,d+.12,.2],[x,y,top+.1]);block(paints[4],[w*.44,d*.5,.62],[x-w*.14,y,top+.5]);
  instance(cylinder,hub,[x+w*.28,y+d*.2,top+.5],[.5,.5,.6]);block(M.steel,[.05,.05,1.2],[x+w*.28,y-d*.28,top+.8]);
 }
 const cage=mat('#6b7274',{metalness:.3,roughness:.5});
 let poolMesh=null;
 // 時段：玻璃、燈、招牌的自發光、點光源、光池跟著 THEMES 的 lamp／window 走（倍率同 viaduct.js）。
 function period(t){
  M.glass.emissiveIntensity=t.window*1.1;towerGlass.emissiveIntensity=t.window*.9;M.lamp.emissiveIntensity=t.lamp*1.3;M.sign.emissiveIntensity=t.lamp*1.1;tail.emissiveIntensity=t.lamp*1.1;
  props.glass.emissiveIntensity=t.window;for(const s of props.signs)s.emissiveIntensity=t.window*.7;
  for(const l of lights)l.intensity=t.lamp*9*l.userData.k;
  poolMat.opacity=t.lamp*.8;if(poolMesh)poolMesh.visible=t.lamp>0;
 }
 // 收尾：合批送進 GPU，組成 garage-diorama.js 與 bake.mjs 讀的場景物件。透明的（月台門玻璃）與光池不投影。
 function result({path,anchors,label,themes,camera,update,extra={}}){
  for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
   const o=new THREE.InstancedMesh(geometry,material,items.length);
   items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});
   o.castShadow=!material.transparent;o.receiveShadow=material!==poolMat;o.instanceMatrix.needsUpdate=true;group.add(o);
   if(material===poolMat)poolMesh=o;
  }
  batches.clear();
  if(trees.count)trees.build(group);
  return{
   group,path,anchors,label,themes,camera,...extra,
   update(time,p='day'){const t=themes[p]||themes.day;water?.update(time,t);period(t);update?.(time,t,p);},
   dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());poolTex?.dispose();}
  };
 }

 return{THREE,group,rand,geo,mat,M,box,cylinder,disc,prism,hip,instance,block,mesh,rounded,props,plinthW,plinthD,plinthR,groundZ,inside,
  loop,line,reversed,strips,ribbon,along,at,keepClear,car,bus,scooter,tower,viaduct,rails,slabTrack,ballastTrack,guideway,embeddedTrack,thirdRail,overhead,
  platform,gates,screenDoors,lights,addLight,pool,sea,river,result};
}

// 高架幹線的微縮印象；不是特定車站或實際線形的重建。
// 這是第一個「場景原型＋參數」：同一份幾何靠 params 長出不同的站，供沒有專屬場景的車款共用。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';

export const THEMES = {
 day:{background:'#e7e8e1',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#3b7f93',shallow:'#79b6b0',lamp:0,window:0},
 sunset:{background:'#ecd9c6',sun:'#ffb974',ambient:'#d2b9b4',ground:'#74795e',power:2.9,exposure:.94,water:'#5b808c',shallow:'#a3b7a6',lamp:.45,window:.4},
 night:{background:'#141f2e',sun:'#9fbfe4',ambient:'#5d7590',ground:'#2b3440',power:.72,exposure:.76,water:'#17384e',shallow:'#365f70',lamp:1,window:1}
};

// 參數的預設值就是 EMU3000 那一組；其餘車款改這裡的值即可共用同一個原型。
export const DEFAULTS = {
 platformLength:19,   // 月台長度
 pierHeight:4.0,      // 高架柱高（軌面離地）
 pierSpacing:3.4,     // 柱距
 canopy:'modern',     // 'modern' 薄平頂 ｜ 'simple' 單斜頂
 backdrop:'coast',    // 'coast' 靠海平原 ｜ 'fields' 水田平原
 label:'西部幹線高架'
};

export function createScene(params = {}) {
 const p = {...DEFAULTS, ...params};
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=20263;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1));
 const concrete=mat('#cdc7b8'),concreteDark=mat('#a79f8e'),deckSide=mat('#d7d2c4'),grass=mat('#87956b'),paddy=mat('#6f8a5a'),gravel=mat('#a49a86');
 const steel=mat('#9aa3a4',{metalness:.6,roughness:.34}),glass=mat('#6d8c96',{metalness:.2,roughness:.18,emissive:'#ffd79a',emissiveIntensity:0});
 const roof=mat('#4e6d74'),cream=mat('#ece3cd'),accent=mat('#b8593f');
 const lamp=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0}),signBoard=mat('#f2e6cc',{emissive:'#ffe3b0',emissiveIntensity:0});
 const paving=mat('#9d9a90'),bayLine=mat('#e8e6dc'),carBodies=['#e9e6df','#3f4a63','#b4402f','#8f9498'].map(c=>mat(c,{roughness:.5,metalness:.15})),carGlass=mat('#2e3a44',{roughness:.3}),scooterBody=mat('#2f2f33'),scooterSeat=mat('#c7c2b6');
 paving.name='paving';for(const m of carBodies)m.name='car';scooterBody.name='scooter';lamp.name='lamp';
 // 光池：燈底下一片加色混合的暖色圓盤，白天隱藏。點光源在每個材質的 shader 裡逐盞算，超過八盞 headless Chromium 開頁就掉 context、手機也吃不消，所以路燈的光池用圓盤畫、點光源只留月台與站房入口。
 const poolTex=typeof document==='undefined'?null:(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.5,'rgba(255,255,255,.5)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();   // 徑向漸層：光池中心亮、邊緣柔掉（驗收在 Node 端也會 import 這個模組，沒有 document 就不帶貼圖）
 const poolMat=new THREE.MeshBasicMaterial({color:'#ffd9a0',map:poolTex,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});poolMat.name='lamp-pool';materials.add(poolMat);
 const disc=geo(new THREE.CircleGeometry(1,24));
 const yellowLine=mat('#d8b451');
 // 道床與電車線的材質。sleeper／mast／concrete 有名字，驗收腳本靠名字在合批網格裡找到它們。
 const ballast=mat('#8b8577'),sleeper=mat('#c6c1b4'),railSide=mat('#6e6259',{metalness:.35,roughness:.6}),wire=mat('#4c4a46',{metalness:.5,roughness:.4}),mastSteel=mat('#b9bcb6',{metalness:.5,roughness:.45});
 sleeper.name='sleeper';mastSteel.name='mast';concrete.name='concrete';

 // 同材質的靜態方塊合批，柱子與欄杆不各佔一次 draw call。
 const batches=new Map(),dummy=new THREE.Object3D();
 function instance(g,m,pos,scale,rot=[0,0,0]){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot});}
 const block=(m,size,pos,rot)=>instance(box,m,pos,size,rot);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}

 // 底座與地面
 const plinthW=66,plinthD=40,plinthR=4;
 const outline=rounded(plinthW,plinthD,plinthR);
 mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
 // 底座頂面＝起點 -2 ＋ depth 1.05 ＋ bevelThickness .2；地面貼在它上面一點，別讓斜角把地面埋掉。
 const plinthTop=-2+1.05+.2,groundZ=plinthTop+.05;
 const ground=mesh(geo(new THREE.ShapeGeometry(outline,24)),grass,[0,0,groundZ]);ground.castShadow=false;

 // 環線幾何先定義，因為水域位置要引用它。
 const deckZ=p.pierHeight,half=19,radius=8,cy=1.5,length=half*4+2*Math.PI*radius;

 // 遠緣水域：形狀切齊底座圓角，起點推到環線外側，才不會變成環中運河或戳出底座邊。
 function farBand(w,depth,r){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,depth-r);s.quadraticCurveTo(w/2,depth,w/2-r,depth);s.lineTo(-w/2+r,depth);s.quadraticCurveTo(-w/2,depth,-w/2,depth-r);s.closePath();return s;}
 const seaY0=cy+radius+1.5,seaDepth=plinthD/2-seaY0;   // 環線遠側直線再往外 1.5

 // 背景：靠海或水田。這是 backdrop 參數唯一改變的東西。
 let waterMat=null;
 if(p.backdrop==='coast'){
  waterMat=mat(THEMES.day.water,{roughness:.32,metalness:.14});
  const sea=mesh(geo(new THREE.ShapeGeometry(farBand(plinthW-.1,seaDepth,plinthR),20)),waterMat,[0,seaY0,groundZ+.04]);sea.castShadow=false;
  waterMat.onBeforeCompile=s=>{
   s.uniforms.seaTime={value:0};s.uniforms.shallow={value:new THREE.Color(THEMES.day.shallow)};waterMat.userData.shader=s;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 seaPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nseaPosition=position;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float seaTime; uniform vec3 shallow; varying vec3 seaPosition;').replace('#include <color_fragment>',`#include <color_fragment>
   float d=seaPosition.y;
   float wave=sin(d*4.1-seaTime*.7+sin(seaPosition.x*.36)*.6);
   float foam=smoothstep(.9,1.0,wave)*(1.0-smoothstep(0.,2.2,d))*smoothstep(-.15,.25,d);
   diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*.3)*.72)+foam*.18;`);
  };
  for(let i=0;i<26;i++){const x=-30+rand()*60,y=seaY0-1.0+rand()*.9;block(gravel,[.5+rand()*.8,.4+rand()*.5,.18+rand()*.2],[x,y,groundZ+.09]);}
 } else {
  for(let i=0;i<9;i++){const y=seaY0-1.8+i*1.35;block(paddy,[52-Math.abs(i-4)*2.5,1.1,.06],[(rand()-.5)*5,y,groundZ+.04]);}
 }

 // 高架環線：前直線是月台段，後直線藏在背景側。車與軌道共用同一組弧長取樣。
 function sample(s){
  let q=((s+half)%length+length)%length,x,y,heading;
  if(q<half*2){x=-half+q;y=cy-radius;heading=0;}
  else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
  else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}
  else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
  return{x,y,z:deckZ+.18,heading};
 }
 const path={sample,length};

 // 沿環線鋪帶狀面。每段給左右兩緣各自的橫向偏移與高度：兩緣同高是平面，異高是斜面，同偏移是立面；同材質的幾段合成一個網格。
 // 法向量跟著頂點順序走：偏移由小到大鋪出來朝上，反過來朝下；立面由下往上鋪朝 −偏移側，由上往下鋪朝 ＋偏移側。
 function strips(material,parts,N=520){
  const v=[],idx=[];
  for(const [o1,z1,o2,z2] of parts){const base=v.length/3;
   for(let i=0;i<=N;i++){const q=sample(i/N*length),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
    v.push(q.x+sx*o1,q.y+cx*o1,z1,q.x+sx*o2,q.y+cx*o2,z2);
    if(i<N){const n=base+i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);
 }
 const ribbon=(offset,width,z,material,N)=>strips(material,[[offset-width/2,z,offset+width/2,z]],N);
 // 箱型梁：頂板、兩側往內斜的腹板、底板。橋面比梁底寬，從街上往上看才有梁的厚度。
 ribbon(0,6.4,deckZ-.05,deckSide);
 strips(concreteDark,[[-2.5,deckZ-.55,-3.2,deckZ-.05],[3.2,deckZ-.05,2.5,deckZ-.55],[2.5,deckZ-.55,-2.5,deckZ-.55]],360);
 // 道床：道碴鋪成梯形斷面，PC 枕一根根露出上半截，鋼軌有軌頭有軌腰。
 // 軌距 ±.46 是從車模量來的：底部頂點最密的橫向位置在 |y|=.45（驗收腳本每次重量），不是抄別的場景。
 // 軌頂＝path 的 z：車模原點就是輪底，跟車器把車放在 path.z，軌頂剛好托住輪子。
 const railZ=deckZ+.18,railH=.12,railW=.10,gauge=.46,ballastZ=deckZ,tieStep=.42;
 strips(ballast,[[-1.45,deckZ-.05,-1.05,ballastZ],[-1.05,ballastZ,1.05,ballastZ],[1.05,ballastZ,1.45,deckZ-.05]],360);
 for(let s=0;s<length;s+=tieStep){const q=sample(s);block(sleeper,[.18,1.4,.10],[q.x,q.y,ballastZ+.01],[0,0,q.heading]);}
 strips(steel,[-gauge,gauge].map(o=>[o-railW/2,railZ,o+railW/2,railZ])).name='rail-head';
 strips(railSide,[-gauge,gauge].flatMap(o=>[[o-railW/2,railZ-railH,o-railW/2,railZ],[o+railW/2,railZ,o+railW/2,railZ-railH]])).name='rail-web';
 // 防音／欄杆牆：外側高、內側低，讓月台側看得見車身
 // 月台那一段的外側不砌牆，月台邊才不會多出一道矮牆擋在車前。
 for(let s=0;s<length;s+=1.05){const q=sample(s);
  for(const [side,h] of [[-1,.95],[1,.55]]){
   if(side===-1&&q.y<cy&&Math.abs(q.x)<p.platformLength/2+.6)continue;
   const ox=q.x-Math.sin(q.heading)*side*3.15,oy=q.y+Math.cos(q.heading)*side*3.15;
   block(concrete,[1.06,.16,h],[ox,oy,deckZ-.05+h/2],[0,0,q.heading]);
  }}
 // 橋墩
 // 柱身高度由「柱帽底緣減地面」推導，pierHeight 改動時柱子不會浮空也不會插進地裡。
 const capZ=deckZ-.72,capH=.36,colH=capZ-capH/2-groundZ;
 for(let s=0;s<length;s+=p.pierSpacing){const q=sample(s);
  block(concrete,[2.0,1.5,colH],[q.x,q.y,groundZ+colH/2],[0,0,q.heading]);
  block(concreteDark,[2.9,2.1,capH],[q.x,q.y,capZ],[0,0,q.heading]);
  block(concreteDark,[2.6,1.9,.3],[q.x,q.y,groundZ+.14],[0,0,q.heading]);
 }
 // 電車線：EMU3000 是電聯車，環線上要有架空線。電桿立在內側（月台在外側），每根帶懸臂與吊架；接觸線是一條細帶。
 // 高度：車模軌頂到車頂 1.50，實車 3.92 m 的車頂對 5.1 m 的接觸線，等比放大得 1.95。
 const wireZ=railZ+1.95,mastO=2.75,mastTop=wireZ+.55,mastN=Math.round(length/7.4),mastStep=length/mastN;
 for(let k=0;k<mastN;k++){const q=sample(mastStep*(k+.5)),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
  block(mastSteel,[.16,.16,mastTop-(deckZ-.05)],[q.x+sx*mastO,q.y+cx*mastO,(mastTop+deckZ-.05)/2],[0,0,q.heading]);
  block(mastSteel,[.09,mastO+.25,.09],[q.x+sx*mastO/2,q.y+cx*mastO/2,wireZ+.42],[0,0,q.heading]);
  block(mastSteel,[.07,.07,.42],[q.x,q.y,wireZ+.21],[0,0,q.heading]);
 }
 strips(wire,[[-.015,wireZ,.015,wireZ]]).name='contact-wire';

 // 月台：沿前直線外側，長度吃 platformLength
 const pl=p.platformLength,py=cy-radius-3.1,platZ=deckZ-.05;
 block(concrete,[pl,3.0,.42],[0,py-1.5,platZ+.21]);
 block(yellowLine,[pl,.16,.03],[0,py-.12,platZ+.43]);
 for(let x=-pl/2+1;x<pl/2;x+=2.4)block(concreteDark,[.5,.5,.02],[x,py-.12,platZ+.44]);
 // 雨棚
 const columns=Math.max(3,Math.round(pl/3.2));
 for(let i=0;i<columns;i++){const x=-pl/2+.9+i*(pl-1.8)/(columns-1);
  block(steel,[.22,.22,2.5],[x,py-2.5,platZ+1.67]);
  if(p.canopy==='modern')block(steel,[.3,2.6,.12],[x,py-1.6,platZ+2.9]);
 }
 if(p.canopy==='modern'){
  block(cream,[pl-.6,4.1,.16],[0,py-1.45,platZ+3.0]);
  block(accent,[pl-.6,.12,.22],[0,py+.55,platZ+2.94]);
 } else {
  block(cream,[pl-.6,3.6,.14],[0,py-1.6,platZ+2.86],[0.12,0,0]);
 }
 // 月台上的座椅、站名牌、燈
 const lights=[],addLight=(name,x,y,z,k=1,dist=7)=>{const l=new THREE.PointLight('#ffd193',0,dist,2);l.position.set(x,y,z);l.name=name;l.userData.k=k;group.add(l);lights.push(l);return l;};
 for(let i=0;i<Math.max(2,Math.floor(pl/6));i++){const x=-pl/2+3+i*5.4;
  block(cream,[1.5,.45,.1],[x,py-2.2,platZ+.72]);block(steel,[1.5,.06,.35],[x,py-2.42,platZ+.9]);
  block(steel,[.09,.09,1.5],[x+1.8,py-2.6,platZ+1.2]);block(cream,[1.1,.1,.4],[x+1.8,py-2.6,platZ+1.95]);
  addLight('platform-lamp-'+i,x,py-1.6,platZ+2.7,2.4);
  block(lamp,[.9,.5,.08],[x,py-1.6,platZ+2.86]);
 }

 // 地面站房與連通樓梯
 // 站房入口朝街（−y，觀者這一側），天橋從背面接上月台。立面：一樓玻璃、二樓窗帶、入口雨棚、站名牌、屋頂機房。
 const stationD=5.6,stationY=-plinthD/2+stationD/2+1.6,streetY=stationY-stationD/2;
 block(cream,[11,stationD,3.2],[-1,stationY,groundZ+1.6]);
 block(roof,[11.8,stationD+.7,.34],[-1,stationY,groundZ+3.35]);
 block(glass,[9.4,.12,1.45],[-1,streetY-.02,groundZ+.95]);
 block(glass,[8.6,.12,.62],[-1,streetY-.02,groundZ+2.45]);
 block(accent,[4.6,1.2,.12],[-1,streetY-.62,groundZ+1.86]);
 for(const x of [-3.1,1.1])block(steel,[.1,.1,1.86],[x,streetY-1.14,groundZ+.93]);
 block(signBoard,[3.8,.16,.5],[-1,streetY-.06,groundZ+2.98]);
 addLight('station-entrance',-1,streetY-.7,groundZ+1.7,1.2,6);
 block(concreteDark,[2.2,1.6,.6],[2.4,stationY+.9,groundZ+3.82]);
 const bridgeBack=stationY+.3,bridgeFront=py-1.9,stairY=stationY+.9;
 block(concrete,[3.0,bridgeFront-bridgeBack,.3],[3.6,(bridgeBack+bridgeFront)/2,platZ-.1]);   // 天橋
 block(concrete,[3.0,.3,platZ-.4-groundZ],[3.6,stairY,(groundZ+platZ-.4)/2]);                 // 樓梯間
 for(let z=groundZ;z<platZ-.5;z+=.42)block(concreteDark,[2.6,.5,.1],[3.6,stairY+(z/platZ)*.3,z]);
 // 月台底下的站體（穿堂層）：月台不再懸空。一樓兩面玻璃牆、街側二樓窗帶、沿柱距一排立面柱；天橋從街側站房進到它的二樓。
 const hallD=2.6,hallY=py-1.5,hallH=platZ-groundZ,hallW=pl-1.2;
 block(cream,[hallW,hallD,hallH],[0,hallY,groundZ+hallH/2]);
 block(glass,[hallW-.8,.12,1.45],[0,hallY-hallD/2-.02,groundZ+.95]);block(glass,[hallW-1.2,.12,.62],[0,hallY-hallD/2-.02,groundZ+2.6]);
 block(glass,[hallW-.8,.12,1.45],[0,hallY+hallD/2+.02,groundZ+.95]);for(const e of [-1,1])block(glass,[.12,hallD-.7,1.45],[e*(hallW/2+.02),hallY,groundZ+.95]);
 for(let x=-hallW/2+.5;x<=hallW/2;x+=3.4)block(steel,[.22,.3,hallH],[x,hallY-hallD/2-.16,groundZ+hallH/2]);
 // 橋下停車場：站體與環線之間、高架橋底下鋪一片鋪面，畫車位線，停幾輛車與一排機車；梁底掛兩盞燈。
 const lotY=cy-radius,lotW=pl+3;let seed2=4471;const rand2=()=>((seed2=(Math.imul(seed2,1664525)+1013904223)>>>0)/4294967296);
 block(paving,[lotW,6.0,.04],[0,lotY,groundZ+.02]);
 const car=(x,y,along,tint)=>{const L=1.75,Wd=.8,rot=[0,0,along?Math.PI/2:0];block(carBodies[tint%4],[Wd,L,.48],[x,y,groundZ+.30],rot);block(carGlass,[Wd-.1,L*.52,.34],[x,y,groundZ+.68],rot);};
 const scooter=(x,y)=>{block(scooterBody,[.32,.72,.34],[x,y,groundZ+.21]);block(scooterSeat,[.28,.4,.1],[x,y-.05,groundZ+.42]);};
 for(const [row,y] of [[0,lotY-2.05],[1,lotY+2.05]]){
  for(let k=0;k<Math.floor(lotW/1.15);k++){const x=-lotW/2+.6+k*1.15;block(bayLine,[.04,1.9,.012],[x-.575,y,groundZ+.045]);
   if(Math.abs(x)<1.2)continue;   // 中間留一條走道
   if(rand2()<(row?.45:.6))car(x,y,false,Math.floor(rand2()*4));}
 }
 for(let i=0;i<8;i++)scooter(3.9+i*.45,lotY+2.6);
 for(const x of [-5.1,5.1]){block(lamp,[.5,.3,.08],[x,lotY,deckZ-.59]);instance(disc,poolMat,[x,lotY,groundZ+.065],[2.2,2.2,1]);}

 // 站區外的房子、樹、灌木、石頭，讓底座邊緣不空。道具來自共用模組，合批仍走本場景的 instance()。
 const props=createProps({geo,mat,instance,rand});
 // 站前一條馬路，路邊兩段連棟透天厝面向觀者，站房夾在中間。每棟寬深樓層屋頂一樓陽台各異，隔幾棟留一條巷子。
 const roadY=-plinthD/2+1.1,rowY=-plinthD/2+3.6;
 props.road(0,roadY,groundZ,plinthW-6);
 const pick=list=>list[Math.floor(rand()*list.length)];
 function terrace(x0,x1){let x=x0,i=0;
  while(true){const w=2.2+rand()*1.2;if(x+w>x1)break;const depth=2.9+rand()*.9;
   props.townhouse(x+w/2,rowY+(rand()-.5)*.5,groundZ,{floors:2+Math.floor(rand()*3.6),width:w,depth,tint:i,
    roof:pick(['parapet','tin','tin','pitched']),ground:pick(['plain','plain','shop','arcade']),balcony:rand()<.35?'cage':'rail',tanks:Math.floor(rand()*3)});
   x+=w+(rand()<.25?1.2:.03);i++;}
 }
 terrace(-27.5,-7.6);terrace(6.2,27.5);
 for(let x=-26;x<28;x+=6.5)props.pole(x+rand()*.6,roadY+1.15,groundZ);
 const lampY=roadY-.85,lampZ=groundZ+3.0;
 for(let x=-24.5,i=0;x<=24.5;x+=7,i++){block(steel,[.11,.11,lampZ-groundZ],[x,lampY,(lampZ+groundZ)/2]);block(steel,[.08,1.2,.08],[x,lampY+.6,lampZ-.04]);block(lamp,[.42,.36,.1],[x,lampY+1.15,lampZ-.1]);instance(disc,poolMat,[x,lampY+1.15,groundZ+.06],[3.0,2.1,1]);}
 car(-13.5,roadY-.35,true,2);car(15.2,roadY+.35,true,0);
 for(const [x,y,t] of [[-28,-9,0],[27.5,-7.6,3],[24,-12.6,2]])props.farmhouse(x,y,groundZ,{tint:t,facing:rand()*.6-.3,pitched:t!==3});
 // 樹：避開馬路與透天厝那排、站房、月台下方；環線內側當成田間樹叢。
 const clearFront=(x,y)=>(y<rowY+2.6&&Math.abs(x)<28.5)||(Math.abs(x+1)<7&&y>stationY-3.5)||(Math.abs(x)<pl/2+1.5&&y>-13.5);
 for(let n=0;n<44;){const x=-31+rand()*62,y=-plinthD/2+1+rand()*10.5;if(clearFront(x,y))continue;props.broadleaf(x,y,groundZ,1.7+rand()*1.3);n++;}
 for(let n=0;n<14;){const x=-15+rand()*30,y=-3.5+rand()*10;if(Math.abs(y-(cy+radius))<2.2)continue;props.broadleaf(x,y,groundZ,1.5+rand()*1.1);n++;}
 for(let n=0;n<40;){const x=-31+rand()*62,y=-plinthD/2+1+rand()*11.5;if(clearFront(x,y))continue;props.bush(x,y,groundZ,.35+rand()*.35);n++;}
 for(let i=0;i<30;i++)props.rock(-30+rand()*60,seaY0-1.7+rand()*1.2,groundZ,.16+rand()*.22,rand()<.4);

 // 合批送進 GPU
 for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
  const o=new THREE.InstancedMesh(geometry,material,items.length);
  items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});
  o.castShadow=o.receiveShadow=true;o.instanceMatrix.needsUpdate=true;group.add(o);
 }
 const poolMesh=group.children.find(o=>o.isInstancedMesh&&o.material===poolMat);if(poolMesh)poolMesh.castShadow=poolMesh.receiveShadow=false;

 const anchors={platform:[0,py-1.5,platZ+.4],station:[-1,stationY,groundZ+1.6],deck:[0,cy-radius,deckZ],backdrop:[0,seaY0+seaDepth/2,groundZ+.04]};

 return {
  group,path,anchors,params:p,label:p.label,themes:THEMES,
  camera:{yaw:-1.12,elevation:.58,radius:50},
  update(time,period='day'){
   const t=THEMES[period]||THEMES.day;
   if(waterMat){waterMat.color.set(t.water);const sh=waterMat.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}}
   glass.emissiveIntensity=t.window*1.1;lamp.emissiveIntensity=t.lamp*1.3;signBoard.emissiveIntensity=t.lamp*1.1;
   props.glass.emissiveIntensity=t.window;for(const s of props.signs)s.emissiveIntensity=t.window*.7;
   for(const l of lights)l.intensity=t.lamp*9*l.userData.k;   // 燭光值（cd）：月台燈 22、入口 11
   poolMat.opacity=t.lamp*.8;if(poolMesh)poolMesh.visible=t.lamp>0;
  },
  dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());poolTex?.dispose();}
 };
}

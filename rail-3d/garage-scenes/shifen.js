// 平溪線十分老街的微縮印象；不是特定車站或實際線形的重建。
// 場景 04：鐵軌從店門前穿過老街，天燈從街心升起，河對岸是吊橋與山。DR1000 是柴油小車，環線上沒有電車線。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';

export const THEMES = {
 day:{background:'#e4e7df',sun:'#fff3d8',ambient:'#c3d6dd',ground:'#7f9068',power:3.0,exposure:1.04,water:'#3f7d72',shallow:'#8dbca3',paper:.12,lantern:0,lamp:0,window:0},
 sunset:{background:'#e9d3bd',sun:'#ffb168',ambient:'#d3b7ad',ground:'#6d7458',power:2.5,exposure:.92,water:'#587f74',shallow:'#a9b79a',paper:.6,lantern:.6,lamp:.5,window:.4},
 night:{background:'#121a27',sun:'#93b3d8',ambient:'#566e88',ground:'#28313c',power:.6,exposure:.74,water:'#143536',shallow:'#2c5a55',paper:1.1,lantern:1.5,lamp:1.8,window:1.2}
};

export const DEFAULTS = {
 streetLength:22,    // 老街長度：兩排店屋沿鐵軌延伸的距離
 label:'平溪線十分老街'
};

export function createScene(params = {}) {
 const p = {...DEFAULTS, ...params};
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=10417;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1));
 const grass=mat('#7f9068'),gravel=mat('#a49a86'),hillMat=mat('#5b7a4c');
 const ballast=mat('#8a8274'),sleeper=mat('#7a6a55'),steel=mat('#9aa3a4',{metalness:.6,roughness:.34}),railSide=mat('#6e6259',{metalness:.35,roughness:.6});
 const paving=mat('#b9b2a2'),wood=mat('#8b6a4a'),plank=mat('#a98a63'),bridgeDeck=mat('#9c7c55'),tin=mat('#5d6d70'),tile=mat('#8c4a3a'),whiteLine=mat('#e9e2cf'),postMat=mat('#6b6f6a'),cable=mat('#5a5f63',{metalness:.5,roughness:.5}),dark=mat('#3a4548');
 const stringMat=mat('#4a3b30'),lanternMat=mat('#d94a3a',{emissive:'#ff7a4a',emissiveIntensity:0}),lamp=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0});
 // 有名字的材質是給驗收腳本在合批網格裡認出東西用的。
 sleeper.name='sleeper';paving.name='paving';plank.name='plank';bridgeDeck.name='bridge-deck';stringMat.name='string';lanternMat.name='lantern';postMat.name='post';

 // 同材質的靜態方塊合批。
 const batches=new Map(),dummy=new THREE.Object3D();
 function instance(g,m,pos,scale,rot=[0,0,0]){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot});}
 const block=(m,size,pos,rot)=>instance(box,m,pos,size,rot);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

 // 底座與地面（跟高架場景同一座台子）
 const plinthW=66,plinthD=40,plinthR=4;
 const outline=rounded(plinthW,plinthD,plinthR);
 mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
 const plinthTop=-2+1.05+.2,groundZ=plinthTop+.05;
 // 地表有實際厚度，向下搭入底座，低角度看外緣不會露出懸空細縫。
 const ground=mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:.08,bevelEnabled:false,steps:1,curveSegments:24})),grass,[0,0,groundZ-.08]);ground.castShadow=false;ground.name='ground-slab';

 // 平地環線：前直線穿過老街，後直線沿河走。軌頂＝path 的 z，車模原點就是輪底。
 const half=17,radius=7.5,cy=1.0,length=half*4+2*Math.PI*radius,trackY=cy-radius;
 const bedZ=groundZ+.22,railZ=bedZ+.18,railH=.12,railW=.10,gauge=.46,tieStep=.42;
 function sample(s){
  let q=((s+half)%length+length)%length,x,y,heading;
  if(q<half*2){x=-half+q;y=cy-radius;heading=0;}
  else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
  else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}
  else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}
  return{x,y,z:railZ,heading};
 }
 const path={sample,length};
 const pathSamples=[];for(let i=0;i<1200;i++){const q=sample(i/1200*length);pathSamples.push([q.x,q.y]);}
 const trackGap=(x,y)=>{let best=Infinity;for(const [px,py] of pathSamples)best=Math.min(best,Math.hypot(px-x,py-y));return best;};

 // 沿環線鋪帶狀面（與高架場景同一個作法）：每段給左右兩緣的橫向偏移與高度。
 function strips(material,parts,N=520){
  const v=[],idx=[];
  for(const [o1,z1,o2,z2] of parts){const base=v.length/3;
   for(let i=0;i<=N;i++){const q=sample(i/N*length),sx=-Math.sin(q.heading),cx=Math.cos(q.heading);
    v.push(q.x+sx*o1,q.y+cx*o1,z1,q.x+sx*o2,q.y+cx*o2,z2);
    if(i<N){const n=base+i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);
 }
 // 道床：道碴梯形斷面直接鋪在地上，木枕一根根露出上半截，鋼軌有軌頭有軌腰。軌距 ±.46 是從車模輪對量來的。
 strips(ballast,[[-1.45,groundZ,-1.05,bedZ],[-1.05,bedZ,1.05,bedZ],[1.05,bedZ,1.45,groundZ]],360);
 for(let s=0;s<length;s+=tieStep){const q=sample(s);block(sleeper,[.18,1.4,.10],[q.x,q.y,bedZ+.01],[0,0,q.heading]);}
 strips(steel,[-gauge,gauge].map(o=>[o-railW/2,railZ,o+railW/2,railZ])).name='rail-head';
 strips(railSide,[-gauge,gauge].flatMap(o=>[[o-railW/2,railZ-railH,o-railW/2,railZ],[o+railW/2,railZ,o+railW/2,railZ-railH]])).name='rail-web';

 const props=createProps({geo,mat,instance,rand});

 // 老街：前直線中段，店屋兩排貼著鐵軌。遠排兩層樓連棟；近排（觀者這一側）只做一層樓的矮店面（瓦頂或女兒牆，不加蓋鐵皮），跟車鏡頭才看得到車身；矮店面背面朝觀者，所以背面也開窗。
 const streetX0=-13,streetX1=streetX0+p.streetLength,farFront=trackY+1.75,nearFront=trackY-1.75;   // 店面離軌道中線 1.75：再近一點全景裡車身會被兩排屋簷夾成一條色帶
 for(const side of [1,-1])block(paving,[p.streetLength,.7,bedZ+.02-groundZ],[(streetX0+streetX1)/2,trackY+side*1.4,(groundZ+bedZ+.02)/2]);
 for(let x=streetX0,i=0;x<streetX1-1.4;i++){const w=Math.min(2.2+rand()*.9,streetX1-x);
  props.townhouse(x+w/2,farFront+1.6,groundZ,{floors:rand()<.2?3:2,width:w,depth:3.2,tint:i,facing:0,roof:['tin','parapet','pitched'][i%3],ground:rand()<.3?'arcade':'shop',balcony:rand()<.4?'cage':'rail',tanks:i%3===2?0:1});x+=w;}
 for(let x=streetX0,i=0;x<streetX1-1.4;i++){const w=Math.min(2.0+rand()*1.0,streetX1-x);
  props.townhouse(x+w/2,nearFront-1.3,groundZ,{floors:1,width:w,depth:2.6,tint:i*3+1+(i%4===0?1:0),facing:Math.PI,roof:i%2?'parapet':'pitched',ground:'shop',tanks:i%2,back:true});x+=w;}
 // 燈籠串橫過街心：一頭綁在遠排店屋的簷口，一頭綁在近側的燈桿。高度在車頂之上。
 const lanternGeo=geo(new THREE.CylinderGeometry(.5,.5,1,8));lanternGeo.rotateX(Math.PI/2);
 const stringZ=groundZ+2.4;
 for(let x=streetX0+1.2;x<streetX1-.5;x+=3.6){
  block(stringMat,[.03,3.5,.03],[x,trackY,stringZ]);
  block(postMat,[.09,.09,stringZ+.1-groundZ],[x,nearFront+.12,(groundZ+stringZ+.1)/2]);
  for(let k=-2;k<=2;k++)instance(lanternGeo,lanternMat,[x,trackY+k*.62,stringZ-.16],[.19,.19,.23]);
 }
 // 街後一條小路與電線桿
 const roadY=farFront+3.2+.95;
 props.road(-2,roadY,groundZ,26);
 for(const x of [-13,-7,-1,5,11])props.pole(x,roadY+1.1,groundZ);

 // 十分站：木造月台在老街東端的近側，鐵皮雨棚，站房是木屋兩片斜頂。
 const stX=13.2,stY=trackY-1.05-.8,platTop=railZ+.1;
 block(plank,[6.4,1.6,platTop-groundZ],[stX,stY,(groundZ+platTop)/2]);
 block(whiteLine,[6.4,.08,.01],[stX,trackY-1.12,platTop+.005]);
 for(const dx of [-2.7,2.7])for(const dy of [-.35,.45])block(wood,[.14,.14,2.0],[stX+dx,stY+dy,platTop+1.0]);
 block(tin,[6.2,1.8,.07],[stX,stY+.1,platTop+2.05],[.14,0,0]);
 block(wood,[1.0,.3,.08],[stX-1.6,stY-.5,platTop+.35]);block(wood,[1.0,.3,.08],[stX+1.6,stY-.5,platTop+.35]);
 const hx=stX+.3,hy=stY-2.2,ridgeZ=groundZ+2.15;
 block(wood,[4.4,2.2,1.5],[hx,hy,groundZ+.75]);
 for(const side of [-1,1])block(tile,[4.9,1.35,.08],[hx,hy+side*.593,ridgeZ-.323],[-side*.5,0,0]);
 block(dark,[.6,.06,1.1],[hx-.9,hy+1.13,groundZ+.55]);for(const dx of [.6,1.4])block(dark,[.55,.06,.5],[hx+dx,hy+1.13,groundZ+.9]);
 block(postMat,[.06,.06,1.2],[stX+3.0,stY-.2,platTop+.6]);block(whiteLine,[.9,.05,.3],[stX+3.0,stY-.2,platTop+1.15]);
 block(lamp,[.22,.22,.12],[stX+2.5,stY,platTop+1.95]);

 // 基隆河：後直線外側一條河，河面用跟海一樣的波紋 shader，兩岸有石頭。
 const riverY0=11.6,riverY1=15.2,riverW=riverY1-riverY0;
 const waterMat=mat(THEMES.day.water,{roughness:.32,metalness:.14});
 const river=mesh(geo(new THREE.PlaneGeometry(plinthW-.2,riverW,1,1)),waterMat,[0,(riverY0+riverY1)/2,groundZ+.04]);river.castShadow=false;river.name='river';
 waterMat.onBeforeCompile=s=>{
  s.uniforms.seaTime={value:0};s.uniforms.shallow={value:new THREE.Color(THEMES.day.shallow)};waterMat.userData.shader=s;
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 seaPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nseaPosition=position;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float seaTime; uniform vec3 shallow; varying vec3 seaPosition;').replace('#include <color_fragment>',`#include <color_fragment>
  float d=${(riverW/2).toFixed(2)}-abs(seaPosition.y);
  float wave=sin(seaPosition.x*1.7-seaTime*1.1+sin(seaPosition.y*2.3)*.8);
  float foam=smoothstep(.85,1.0,wave)*(1.0-smoothstep(0.,1.1,d));
  diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*1.4)*.7)+foam*.16;`);
 };
 for(let i=0;i<34;i++){const x=-31+rand()*62,y=(i%2?riverY0-.35:riverY1+.35)+(rand()-.5)*.5;if(Math.abs(x-6)<1.6&&y<riverY0)continue;block(gravel,[.4+rand()*.7,.35+rand()*.4,.16+rand()*.2],[x,y,groundZ+.08],[0,0,rand()*Math.PI]);}

 // 靜安吊橋：兩座門形塔、兩條懸索、吊桿、木板橋面，從後直線外側跨到對岸山腳。
 const bx=6,by0=riverY0-.9,by1=riverY1+.9,deckZ=groundZ+1.0,towerTop=groundZ+3.3;
 for(const y of [by0,by1]){for(const dx of [-.55,.55])block(postMat,[.18,.18,towerTop-groundZ],[bx+dx,y,(groundZ+towerTop)/2]);block(postMat,[1.3,.18,.18],[bx,y,towerTop]);}
 block(bridgeDeck,[1.0,by1-by0+.4,.08],[bx,(by0+by1)/2,deckZ]);
 for(const dx of [-.45,.45]){block(cable,[.04,by1-by0,.04],[bx+dx,(by0+by1)/2,deckZ+.5]);for(let y=by0+.3;y<by1;y+=.6)block(cable,[.04,.04,.5],[bx+dx,y,deckZ+.25]);}
 const sag=towerTop-(deckZ+.65),segs=14;
 for(const dx of [-.55,.55]){let prev=null;
  for(let i=0;i<=segs;i++){const u=i/segs,y=by0+(by1-by0)*u,z=towerTop-sag*(1-(2*u-1)**2);
   if(prev){const dy=y-prev[0],dz=z-prev[1];block(cable,[.05,Math.hypot(dy,dz),.05],[bx+dx,(y+prev[0])/2,(z+prev[1])/2],[Math.atan2(dz,dy),0,0]);}
   if(i>0&&i<segs)block(cable,[.03,.03,z-(deckZ+.04)],[bx+dx,y,(z+deckZ+.04)/2]);
   prev=[y,z];}}
 for(let i=0;i<3;i++)block(paving,[1.1,.5,(deckZ-groundZ)*(i+1)/3],[bx,by0-1.55+i*.5,groundZ+(deckZ-groundZ)*(i+1)/6]);

 // 對岸的山：一片起伏的地形，種滿樹；左右邊緣收回底座裡，後緣鋪到台子邊、立一面切面牆（見下）。
 const hills=[[-24,20.5,13,6.5,6.5],[-9,21,12,7,8],[6,20.5,11,6.5,6.2],[21,21,12,7,7.6],[31,20,9,6,5.5]];
 function hillHeight(x,y){let h=0;for(const [hx,hy,rx,ry,hz] of hills){const d=((x-hx)/rx)**2+((y-hy)/ry)**2;h=Math.max(h,hz*Math.max(0,1-d)**1.3);}return h*smooth((y-15.4)/1.6)*smooth((20.6-y)/2.2)*smooth((31-Math.abs(x))/2.2);}   // 背面也淡出：山脊留在台子裡，背坡降到後緣只剩一截矮切面
 const hillY0=15.4,hillY1=plinthD/2,hillGeo=geo(new THREE.PlaneGeometry(62,hillY1-hillY0,124,12)),hp=hillGeo.attributes.position;
 // 頂點先收進圓角底座的輪廓裡（後緣兩角 |x|>29 的那幾顆），山高在那裡本來就淡到 0。
 const rimX=y=>Math.abs(y)<=plinthD/2-plinthR?plinthW/2:plinthW/2-plinthR+Math.sqrt(Math.max(0,plinthR**2-(Math.abs(y)-(plinthD/2-plinthR))**2));
 for(let i=0;i<hp.count;i++){const y=hp.getY(i)+(hillY0+hillY1)/2,lim=rimX(y)-.15,x=Math.max(-lim,Math.min(lim,hp.getX(i)));hp.setX(i,x);const h=hillHeight(x,y);hp.setZ(i,h+(h>.2?rand()*.18:0));}
 hillGeo.computeVertexNormals();
 mesh(hillGeo,hillMat,[0,(hillY0+hillY1)/2,groundZ+.02]).name='hills';
 // 四周切面使用山面實際邊界頂點，向下搭進地表；含左右圓角與前方山腳。
 // 沿順時針邊界建立朝外的面，不靠雙面材質掩蓋缺面。
 {const cols=125,rows=13,boundary=[];
  for(let x=0;x<cols;x++)boundary.push(x);
  for(let y=1;y<rows;y++)boundary.push(y*cols+cols-1);
  for(let x=cols-2;x>=0;x--)boundary.push((rows-1)*cols+x);
  for(let y=rows-2;y>0;y--)boundary.push(y*cols);
  const v=[],c=[],idx=[],earth=new THREE.Color('#6f5a45'),bed=new THREE.Color('#8b775e');
  for(const i of boundary){v.push(hp.getX(i),hp.getY(i),hp.getZ(i),hp.getX(i),hp.getY(i),-.03);c.push(earth.r,earth.g,earth.b,bed.r,bed.g,bed.b);}
  for(let i=0;i<boundary.length;i++){const a=i*2,b=((i+1)%boundary.length)*2;idx.push(a,b,a+1,a+1,b,b+1);}
  const sg=geo(new THREE.BufferGeometry());sg.setAttribute('position',new THREE.Float32BufferAttribute(v,3));sg.setAttribute('color',new THREE.Float32BufferAttribute(c,3));sg.setIndex(idx);sg.computeVertexNormals();
  const skirt=mesh(sg,mat('#ffffff',{vertexColors:true}),[0,(hillY0+hillY1)/2,groundZ+.02]);skirt.name='hills-skirt';skirt.castShadow=false;}
 for(let n=0;n<120;){const x=-30+rand()*60,y=hillY0+.3+rand()*3.4,h=hillHeight(x,y);if(h<.35)continue;props.broadleaf(x,y,groundZ+.02+h,1.3+rand()*1.1);n++;}

 // 其餘的樹、灌木、農舍：避開軌道、老街、車站、河與吊橋。
 const clear=(x,y)=>trackGap(x,y)>2.1&&!(x>streetX0-1.5&&x<streetX1+1.5&&y>-11.6&&y<-.2)&&!(x>9&&x<18&&y>-13&&y<-6.8)&&y<11.2&&!(Math.abs(x-bx)<1.6&&y>9.4);
 props.farmhouse(-22,-13.5,groundZ,{width:3.2,depth:2.4,tint:0,facing:0});
 props.farmhouse(-27,-3,groundZ,{width:2.8,depth:2.2,tint:3,facing:Math.PI/2,pitched:false});
 props.farmhouse(22,-14.5,groundZ,{width:3.0,depth:2.4,tint:1,facing:0});
 const farmBox=(x,y)=>(Math.abs(x+22)<2.4&&Math.abs(y+13.5)<2)||(Math.abs(x+27)<2&&Math.abs(y+3)<2.2)||(Math.abs(x-22)<2.4&&Math.abs(y+14.5)<2);
 const tree=(x,y,h)=>props.broadleaf(x,y,groundZ,h);
 for(let n=0;n<16;){const x=-13+rand()*26,y=1.0+rand()*5.2;if(!clear(x,y))continue;tree(x,y,1.5+rand()*1.0);n++;}
 for(let n=0;n<16;){const x=-30+rand()*60,y=10.2+rand()*1.0;if(!clear(x,y))continue;tree(x,y,1.2+rand()*.7);n++;}
 for(let n=0;n<26;){const x=(rand()<.5?-1:1)*(26+rand()*6),y=-15+rand()*25;if(!clear(x,y)||farmBox(x,y))continue;tree(x,y,1.5+rand()*1.3);n++;}
 for(let n=0;n<22;){const x=-32+rand()*64,y=-19+rand()*6;if(!clear(x,y)||farmBox(x,y))continue;tree(x,y,1.6+rand()*1.3);n++;}
 for(let n=0;n<34;){const x=-32+rand()*64,y=-19+rand()*30;if(!clear(x,y)||farmBox(x,y))continue;props.bush(x,y,groundZ,.35+rand()*.35);n++;}
 for(let i=0;i<14;i++){const x=-32+rand()*64,y=-19+rand()*30;if(!clear(x,y)||farmBox(x,y))continue;props.rock(x,y,groundZ,.16+rand()*.22,rand()<.4);}

 // 天燈（放飛的、會往上飄的那種）09-28 起改用 Blender 資產的獨立零件庫（garage-lanterns-v1），
 // 不再是這裡的程序化幾何——createScene() 是同步的純函式，資產要非同步載入，所以搬到下面的
 // createSkyLanterns()（main.js 等 loadGarageParts() 完成後才呼叫，回傳自己的 group，跟南迴的
 // createAttendant／createPeople 同一個模式：核心場景保持同步，人／天燈是額外裝上去的一層）。
 // 這裡只留老街範圍給 createSkyLanterns() 算落點用（跟這裡種樹/種燈的隨機分布用同一個範圍）。
 // x1 09-28 從 streetX1(9) 延伸到 stX+2(≈15.2)：原本落點範圍在老街段就結束，車停十分站時
 // 「陪它走走」跟車鏡頭朝著車站方向，畫面裡幾乎看不到天燈落點；延伸到站區後緣才讓那個鏡頭也有
 // 幾盞天燈可看（實測結果見 scripts/verify_garage_shifen_stop.mjs 的站區可見度判準）。
 const lanternZone={x0:streetX0,x1:stX+2,trackY,groundZ};

 // 夜燈：每一串燈籠底下一盞暖光（照亮鋪面與兩排店面）、車站一盞、三間農舍門口各一盞小的；強度在 update 依時段調，白天是 0。
 const lampSpots=[];for(let x=streetX0+1.2;x<streetX1-.5;x+=3.6)lampSpots.push([x,trackY,1.85,1]);lampSpots.push([stX+2.5,stY,1.9,1],[-22,-15.3,1.3,.45],[-25.2,-3,1.3,.45],[22,-16.3,1.3,.45]);
 const lights=lampSpots.map(([x,y,z,k],i)=>{const l=new THREE.PointLight('#ffb570',0,k<1?6:8,2);l.position.set(x,y,groundZ+z);l.name='lamp-'+i;l.userData.k=k;group.add(l);return l;});

 // 合批送進 GPU
 for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
  const o=new THREE.InstancedMesh(geometry,material,items.length);
  items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});
  o.castShadow=o.receiveShadow=true;o.instanceMatrix.needsUpdate=true;group.add(o);
 }

 const anchors={street:[(streetX0+streetX1)/2,trackY,groundZ+1],station:[stX,stY,platTop],bridge:[bx,(by0+by1)/2,deckZ],hills:[0,18,groundZ+3],river:[0,(riverY0+riverY1)/2,groundZ+.04]};

 return {
  group,path,anchors,lanternZone,params:p,label:p.label,themes:THEMES,
  camera:{yaw:-1.12,elevation:.58,radius:50},
  update(time,period='day'){
   const t=THEMES[period]||THEMES.day;
   waterMat.color.set(t.water);const sh=waterMat.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}
   lanternMat.emissiveIntensity=t.lantern;lamp.emissiveIntensity=t.lamp;
   for(const l of lights)l.intensity=t.lamp*6*l.userData.k;props.glass.emissiveIntensity=t.window;for(const s of props.signs)s.emissiveIntensity=t.window*.7;   // 燈是燭光值（cd）；窗戶、店面玻璃與店招夜裡自發光
  },
  dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 };
}

// 天燈（Blender 資產版）：main.js 等 loadGarageParts() 讀到 garage-lanterns-v1 之後才呼叫，回傳自己
// 的 group（main.js 直接 scene.add()）與獨立的 update(time,period)（main.js 的 draw() 裡跟
// shifen.update() 一起呼叫，不掛在 shifen 自己的 update 上——這層是額外裝上去的，之後別的場景要借用
// 天燈也不用碰 createScene()，跟南迴的 createAttendant／createPeople 同一個模式）。
// scale 跟人／車同一個換算：kit 裡的幾何是「模型公尺」（跟 garage-people-v1 的 rig.height=1.7 同一個
// 基準），乘上 main.js 算好的 1.25/primary.size.y 就是這個場景的世界單位，天燈／乘客的相對大小因此
// 自動貼近真實比例，不必在這裡另外調校。位置（x/y/z、老街範圍、回收高度）留在場景既有的世界單位，
// 只有天燈自己的形狀（scale）吃 scale 換算。
// 夜裡的暖橘光暈貼圖：一張 64×64 的放射狀漸層（中心白熱、中段暖橘、邊緣透明），單一 canvas 產生、
// 所有天燈共用同一張——搭配 THREE.Points 一次 draw call畫完全部光暈實例，不隨天燈數量線性增加
// draw call（每盞天燈另開一個 THREE.Sprite 會，12 盞就是 12 個 draw call，這個場景的 draw-call
// 預算吃緊，見 rail-3d 既有效能鐵則）。
function glowTexture(){
 if(typeof document==='undefined')return null; // 純 Node 環境（verify_garage_shifen_stop.mjs 的外形／升空檢查）沒有 DOM，光暈只在瀏覽器裡需要。
 const c=document.createElement('canvas');c.width=c.height=64;
 const ctx=c.getContext('2d');
 const g=ctx.createRadialGradient(32,32,0,32,32,32);
 g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.35,'rgba(255,196,130,.6)');g.addColorStop(1,'rgba(255,150,70,0)');
 ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
 const tex=new THREE.CanvasTexture(c);tex.needsUpdate=true;return tex;
}

export function createSkyLanterns(kit,scale,zone,params={}){
 const cfg={count:12,seed:20260928,...params};
 const group=new THREE.Group();group.name='sky-lanterns-rig';
 const materials=[];
 const paperMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.9,emissive:'#ffb15a',emissiveIntensity:0});materials.push(paperMat);
 const frameMat=new THREE.MeshStandardMaterial({color:'#8a6a45',roughness:.85});materials.push(frameMat);
 const flameMat=new THREE.MeshStandardMaterial({color:'#ffd08a',emissive:'#ff8a2a',emissiveIntensity:1.6,roughness:.6});materials.push(flameMat);
 const nSky=Math.max(0,cfg.count|0);
 let seed=cfg.seed;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const colors=['#e8503a','#f2a23a','#f4d35e','#e86f9a','#f5f0e6','#6fb1e8'];
 // H／releaseZ：回收高度／放飛起點，跟舊版程序化天燈同一個飛行包絡（維持不變）。FADE：淡出/淡入各佔
 // 的爬升量（世界單位）——循環重置前後這段距離內把 scale 收到 0，避免瞬移穿幫（十分-天燈升空判準）。
 const H=13,releaseZ=zone.groundZ+1.3,FADE=1.1;
 // phase 09-28 起改成「均分＋小抖動」而非純隨機：主對話要求任何時刻老街上方都同時看得到幾盞不同
 // 高度的天燈，純隨機在數量不多時容易洗出「這一刻剛好全部擠在同一段高度」的抽樣，均分能保證任何
 // 時刻都攤開在整個爬升週期的不同位置，抖動量壓在 ±7.5% 週期，維持「錯落」的手感不會看起來機械對齊。
 const lanternSet=[];for(let k=0;k<nSky;k++)lanternSet.push({x:zone.x0+2.5+rand()*(zone.x1-zone.x0-5),y:zone.trackY+(rand()-.5)*1.6,rise:.55+rand()*.35,phase:(k/nSky)*H+(rand()-.5)*H*.15});
 let paperMesh=null,frameMesh=null,flameMesh=null,glowPoints=null,glowGeo=null,glowMat=null,glowTex=null;
 if(nSky){
  paperMesh=new THREE.InstancedMesh(kit.parts.get('lantern-paper').geometry,paperMat,nSky);paperMesh.name='sky-lantern-paper';paperMesh.castShadow=true;
  frameMesh=new THREE.InstancedMesh(kit.parts.get('lantern-frame').geometry,frameMat,nSky);frameMesh.name='sky-lantern-frame';
  flameMesh=new THREE.InstancedMesh(kit.parts.get('lantern-flame').geometry,flameMat,nSky);flameMesh.name='sky-lantern-flame';
  for(let k=0;k<nSky;k++)paperMesh.setColorAt(k,new THREE.Color(colors[k%colors.length]));
  group.add(paperMesh,frameMesh,flameMesh);
  // 夜裡發光：每盞一個 additive 暖橘光暈點，位置每幀跟著天燈本體走，亮度＝時段×該盞目前的 fade
  // （淡入/淡出時光暈跟著一起淡，不會在天燈剛出現/剛回收那一刻先亮/晚暗穿幫）。純 Node 環境
  // （verify_garage_shifen_stop.mjs 的外形／升空檢查）沒有 DOM／canvas，glowTexture() 回 null 時
  // 整組光暈跳過不建——那些檢查本來就不需要光暈，只驗形狀與 fade。
  glowTex=glowTexture();
  if(glowTex){
   glowGeo=new THREE.BufferGeometry();
   glowGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(nSky*3),3));
   glowGeo.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(nSky*3),3));
   glowMat=new THREE.PointsMaterial({map:glowTex,size:34,sizeAttenuation:false,vertexColors:true,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
   materials.push(glowMat);
   // depthTest:false 是必要的、不是可省的效能微調：THREE.Points 整個點精靈只有一個深度值（點本身
   // 的位置），釘在天燈腰身中心會被自己不透明的紙燈殼前緣整片擋掉深度測試（前緣一定比中心點更靠
   // 鏡頭），實測不關深度測試時光暈在畫面中心幾乎量不到任何貢獻（跟完全沒開光暈時同一個讀數）。
   // 柔和的 additive 光暈本來就常見不做深度測試（代表光線繞過/穿透物體邊緣散出來的觀感），代價是
   // 光暈永遠畫在最上層、不會被前方物體正確遮擋——這個場景的光暈很小很柔和，這個代價可接受。
   // sizeAttenuation:false 是刻意的：three.js 內建的 point-size shader 只在透視投影下依距離縮放
   // （isPerspectiveMatrix 分支），這個場景的三個鏡頭（全景／跟車／月台）視野跨距差很大，固定像素
   // 尺寸才能保證在每個鏡頭下都量得到、不會在某個鏡頭忽然縮到量不到。
   glowPoints=new THREE.Points(glowGeo,glowMat);glowPoints.name='sky-lantern-glow';glowPoints.frustumCulled=false;
   group.add(glowPoints);
  }
 }
 const dummy=new THREE.Object3D(),m4=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scl=new THREE.Vector3();
 function stateAt(k,time){
  const L=lanternSet[k],c=((time*L.rise+L.phase)%H+H)%H,z=releaseZ+c;
  const x=L.x+Math.sin(time*.23+k*1.3)*.5,y=L.y+Math.cos(time*.19+k*2.1)*.3;
  return{x,y,z,cycle:c,fade:Math.max(0,Math.min(1,c/FADE,(H-c)/FADE))};
 }
 const GLOW_COLOR=new THREE.Color('#ff9a4a'),GLOW_K={day:0,sunset:.5,night:1},glowMidH=kit.rig.height*.5;
 function update(time,period='day'){
  const t=THEMES[period]||THEMES.day;
  paperMat.emissiveIntensity=t.paper;
  if(!nSky)return;
  const gk=GLOW_K[period]??GLOW_K.day,gc=glowGeo&&glowGeo.attributes.color,gp=glowGeo&&glowGeo.attributes.position;
  for(let k=0;k<nSky;k++){
   const s=stateAt(k,time),sc=scale*s.fade;
   dummy.position.set(s.x,s.y,s.z);dummy.rotation.set(Math.sin(time*.5+k)*.06,Math.cos(time*.4+k)*.06,k*.7,'ZYX');
   dummy.scale.set(sc,sc,sc);dummy.updateMatrix();
   paperMesh.setMatrixAt(k,dummy.matrix);frameMesh.setMatrixAt(k,dummy.matrix);flameMesh.setMatrixAt(k,dummy.matrix);
   // 光暈點的世界座標刻意抬到天燈「腰身」高度（base z ＋ 半個模型高度×目前實際 scale），不是跟本體
   // 一樣釘在 base（原本寫成 s.z，跟本體共用同一個基準點但視覺上光暈該包著整顆燈籠鼓起的地方，
   // 不是趴在燈籠底部）；這個修正同時也是讓「關掉光暈」的驗收突變測試量得到差異的必要條件——光暈
   // 沒有跟紙燈殼中心對齊時，驗收在紙燈殼中心取樣會完全量不到光暈開關的差異（紙殼本體不透明，
   // 擋住了不同高度的光暈）。
   if(gp){const gi=gk*s.fade;gp.setXYZ(k,s.x,s.y,s.z+glowMidH*sc);gc.setXYZ(k,GLOW_COLOR.r*gi,GLOW_COLOR.g*gi,GLOW_COLOR.b*gi);}
  }
  paperMesh.instanceMatrix.needsUpdate=frameMesh.instanceMatrix.needsUpdate=flameMesh.instanceMatrix.needsUpdate=true;
  if(gp){gp.needsUpdate=true;gc.needsUpdate=true;}
 }
 update(0,'day');
 // 驗收用：直接讀「實際畫出來的東西」的世界座標／scale（用 getMatrixAt 讀回剛才 setMatrixAt 寫入的
 // 那份，不是另外重算 stateAt 的公式），跟南迴 peopleBounds() 同一個原則。
 function readInstance(k){
  if(!paperMesh||k<0||k>=nSky)return null;
  paperMesh.getMatrixAt(k,m4);m4.decompose(pos,quat,scl);
  return{position:pos.toArray(),scale:scl.x};
 }
 return{group,count:nSky,H,releaseZ,FADE,lanternSet,update,readInstance,
  dispose(){group.clear();materials.forEach(m=>m.dispose());glowTex&&glowTex.dispose();}};
}

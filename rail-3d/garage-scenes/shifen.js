// 平溪線十分老街的微縮印象；不是特定車站或實際線形的重建。
// 場景 04：鐵軌從店門前穿過老街，天燈從街心升起，河對岸是吊橋與山。DR1000 是柴油小車，環線上沒有電車線。
import * as THREE from '../vendor/three.module.js';
import {createProps} from './props.js';

export const THEMES = {
 day:{background:'#e4e7df',sun:'#fff3d8',ambient:'#c3d6dd',ground:'#7f9068',power:3.0,exposure:1.04,water:'#3f7d72',shallow:'#8dbca3',paper:.12,lantern:0,lamp:0},
 sunset:{background:'#e9d3bd',sun:'#ffb168',ambient:'#d3b7ad',ground:'#6d7458',power:2.5,exposure:.92,water:'#587f74',shallow:'#a9b79a',paper:.6,lantern:.45,lamp:.5},
 night:{background:'#121a27',sun:'#93b3d8',ambient:'#566e88',ground:'#28313c',power:.6,exposure:.74,water:'#143536',shallow:'#2c5a55',paper:1.1,lantern:.95,lamp:1.8}
};

export const DEFAULTS = {
 skyLanterns:6,      // 同時飄在老街上空的天燈數
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
 const stringMat=mat('#4a3b30'),lanternMat=mat('#d94a3a',{emissive:'#ff7a4a',emissiveIntensity:0}),paper=mat('#ffffff',{emissive:'#ffb15a',emissiveIntensity:0,roughness:.9}),flame=mat('#ffd08a',{emissive:'#ff8a2a',emissiveIntensity:1.6}),lamp=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0});
 // 有名字的材質是給驗收腳本在合批網格裡認出東西用的。
 sleeper.name='sleeper';paving.name='paving';plank.name='plank';bridgeDeck.name='bridge-deck';stringMat.name='string';lanternMat.name='lantern';paper.name='sky-lantern';postMat.name='post';

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
 const ground=mesh(geo(new THREE.ShapeGeometry(outline,24)),grass,[0,0,groundZ]);ground.castShadow=false;

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

 // 對岸的山：一片起伏的地形，種滿樹；邊緣收回底座裡，不戳出台子。
 const hills=[[-24,20.5,13,6.5,6.5],[-9,21,12,7,8],[6,20.5,11,6.5,6.2],[21,21,12,7,7.6],[31,20,9,6,5.5]];
 function hillHeight(x,y){let h=0;for(const [hx,hy,rx,ry,hz] of hills){const d=((x-hx)/rx)**2+((y-hy)/ry)**2;h=Math.max(h,hz*Math.max(0,1-d)**1.3);}return h*smooth((y-15.4)/1.6)*smooth((31-Math.abs(x))/2.2);}
 const hillY0=15.4,hillY1=19.3,hillGeo=geo(new THREE.PlaneGeometry(62,hillY1-hillY0,124,12)),hp=hillGeo.attributes.position;
 for(let i=0;i<hp.count;i++){const x=hp.getX(i),y=hp.getY(i)+(hillY0+hillY1)/2,h=hillHeight(x,y);hp.setZ(i,h+(h>.2?rand()*.18:0));}
 hillGeo.computeVertexNormals();
 mesh(hillGeo,hillMat,[0,(hillY0+hillY1)/2,groundZ+.02]).name='hills';
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

 // 天燈：老街上空幾盞紙燈慢慢往上飄，飄出畫面就從街心再放一盞。位置逐幀更新，所以是自己的 InstancedMesh，不進靜態合批。
 const H=13,releaseZ=groundZ+1.3,nSky=Math.max(0,p.skyLanterns|0);
 const skyGeo=geo(new THREE.CylinderGeometry(.5,.36,1,4,1));skyGeo.rotateX(Math.PI/2);skyGeo.rotateZ(Math.PI/4);
 const flameGeo=geo(new THREE.BoxGeometry(.16,.16,.12));
 const colors=['#e8503a','#f2a23a','#f4d35e','#e86f9a','#f5f0e6','#6fb1e8'];
 const lanternSet=[];for(let k=0;k<nSky;k++)lanternSet.push({x:streetX0+2.5+rand()*(p.streetLength-5),y:trackY+(rand()-.5)*1.6,rise:.55+rand()*.35,phase:rand()*H});
 let sky=null,flames=null;
 if(nSky){sky=new THREE.InstancedMesh(skyGeo,paper,nSky);flames=new THREE.InstancedMesh(flameGeo,flame,nSky);sky.name='sky-lanterns';flames.name='sky-flames';sky.castShadow=true;
  for(let k=0;k<nSky;k++)sky.setColorAt(k,new THREE.Color(colors[k%colors.length]));group.add(sky,flames);}

 // 夜燈：老街上三盞暖光、車站一盞。
 const lights=[[-9,trackY,2.6],[-2,trackY,2.6],[5,trackY,2.6],[stX+2.5,stY,1.9]].map(([x,y,z])=>{const l=new THREE.PointLight('#ffb570',0,9,2);l.position.set(x,y,groundZ+z);group.add(l);return l;});

 // 合批送進 GPU
 for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
  const o=new THREE.InstancedMesh(geometry,material,items.length);
  items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});
  o.castShadow=o.receiveShadow=true;o.instanceMatrix.needsUpdate=true;group.add(o);
 }

 const anchors={street:[(streetX0+streetX1)/2,trackY,groundZ+1],station:[stX,stY,platTop],bridge:[bx,(by0+by1)/2,deckZ],hills:[0,18,groundZ+3],river:[0,(riverY0+riverY1)/2,groundZ+.04]};

 return {
  group,path,anchors,params:p,label:p.label,themes:THEMES,
  camera:{yaw:-1.12,elevation:.58,radius:50},
  update(time,period='day'){
   const t=THEMES[period]||THEMES.day;
   waterMat.color.set(t.water);const sh=waterMat.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}
   paper.emissiveIntensity=t.paper;lanternMat.emissiveIntensity=t.lantern;lamp.emissiveIntensity=t.lamp;
   for(const l of lights)l.intensity=t.lamp*1.3;
   if(sky){
    for(let k=0;k<nSky;k++){const L=lanternSet[k],c=((time*L.rise+L.phase)%H+H)%H,z=releaseZ+c,x=L.x+Math.sin(time*.23+k*1.3)*.5,y=L.y+Math.cos(time*.19+k*2.1)*.3;
     dummy.position.set(x,y,z);dummy.rotation.set(Math.sin(time*.5+k)*.06,Math.cos(time*.4+k)*.06,k*.7,'ZYX');dummy.scale.set(.5,.5,.75);dummy.updateMatrix();sky.setMatrixAt(k,dummy.matrix);
     dummy.position.set(x,y,z-.42);dummy.rotation.set(0,0,0,'ZYX');dummy.scale.set(1,1,1);dummy.updateMatrix();flames.setMatrixAt(k,dummy.matrix);}
    sky.instanceMatrix.needsUpdate=flames.instanceMatrix.needsUpdate=true;
   }
  },
  dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 };
}

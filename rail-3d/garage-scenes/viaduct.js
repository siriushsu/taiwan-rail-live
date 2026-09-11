// 高架幹線的微縮印象；不是特定車站或實際線形的重建。
// 這是第一個「場景原型＋參數」：同一份幾何靠 params 長出不同的站，供沒有專屬場景的車款共用。
import * as THREE from '../vendor/three.module.js';

export const THEMES = {
 day:{background:'#e7e8e1',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#3b7f93',shallow:'#79b6b0'},
 sunset:{background:'#ecd9c6',sun:'#ffb974',ambient:'#d2b9b4',ground:'#74795e',power:2.9,exposure:.94,water:'#5b808c',shallow:'#a3b7a6'},
 night:{background:'#141f2e',sun:'#9fbfe4',ambient:'#5d7590',ground:'#2b3440',power:.72,exposure:.76,water:'#17384e',shallow:'#365f70'}
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
 const roof=mat('#4e6d74'),cream=mat('#ece3cd'),accent=mat('#b8593f'),trunk=mat('#6d6046'),leaf=mat('#4d7350');
 const lamp=mat('#f7dca6',{emissive:'#ffc87d',emissiveIntensity:0});
 const yellowLine=mat('#d8b451');

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

 function ribbon(offset,width,z,material,N=520){
  const v=[],idx=[];
  for(let i=0;i<=N;i++){const q=sample(i/N*length);for(const k of [-1,1])v.push(q.x-Math.sin(q.heading)*(offset+k*width/2),q.y+Math.cos(q.heading)*(offset+k*width/2),z);
   if(i<N){const n=i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);
 }
 // 橋面板、兩側腹版、道碴與鋼軌
 ribbon(0,7.0,deckZ-.55,concreteDark);
 ribbon(0,6.4,deckZ-.05,deckSide);
 ribbon(0,3.1,deckZ+.02,gravel);
 for(const side of [-1,1])ribbon(side*.62,.12,deckZ+.2,steel);
 // 防音／欄杆牆：外側高、內側低，讓月台側看得見車身
 for(let s=0;s<length;s+=1.05){const q=sample(s);
  for(const [side,h] of [[-1,.95],[1,.55]]){
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
 const lights=[];
 for(let i=0;i<Math.max(2,Math.floor(pl/6));i++){const x=-pl/2+3+i*5.4;
  block(cream,[1.5,.45,.1],[x,py-2.2,platZ+.72]);block(steel,[1.5,.06,.35],[x,py-2.42,platZ+.9]);
  block(steel,[.09,.09,1.5],[x+1.8,py-2.6,platZ+1.2]);block(cream,[1.1,.1,.4],[x+1.8,py-2.6,platZ+1.95]);
  const l=new THREE.PointLight('#ffd193',0,7,2);l.position.set(x,py-1.6,platZ+2.7);group.add(l);lights.push(l);
  block(lamp,[.9,.5,.08],[x,py-1.6,platZ+2.86]);
 }

 // 地面站房與連通樓梯
 const stationD=5.6,stationY=-plinthD/2+stationD/2+1.6,stationFront=stationY+stationD/2;
 block(cream,[11,stationD,3.2],[-1,stationY,groundZ+1.6]);
 block(roof,[11.8,stationD+.7,.34],[-1,stationY,groundZ+3.35]);
 block(glass,[9.4,.12,1.5],[-1,stationFront-.05,groundZ+2.05]);
 block(accent,[4.4,.16,.5],[-1,stationFront,groundZ+2.95]);
 const bridgeBack=stationY+.3,bridgeFront=py-1.9,stairY=stationY+.9;
 block(concrete,[3.0,bridgeFront-bridgeBack,.3],[3.6,(bridgeBack+bridgeFront)/2,platZ-.1]);   // 天橋
 block(concrete,[3.0,.3,platZ-.4-groundZ],[3.6,stairY,(groundZ+platZ-.4)/2]);                 // 樓梯間
 for(let z=groundZ;z<platZ-.5;z+=.42)block(concreteDark,[2.6,.5,.1],[3.6,stairY+(z/platZ)*.3,z]);

 // 站區外的樹與小屋，讓底座邊緣不空
 for(let i=0;i<34;i++){
  const x=-31+rand()*62,y=-plinthD/2+1+rand()*9;
  if(Math.abs(x)<pl/2+3&&y>stationY-3)continue;
  const h=1.5+rand()*1.1;block(trunk,[.16,.16,h*.45],[x,y,groundZ+h*.22]);
  block(leaf,[1.0+rand()*.5,1.0+rand()*.5,h],[x,y,groundZ+h*.5+h*.2]);
 }
 for(const [x,y] of [[-24,-13.5],[21,-14.6],[27,-7.2]]){block(cream,[3.0,2.4,1.5],[x,y,groundZ+.75]);block(roof,[3.4,2.8,.22],[x,y,groundZ+1.57]);}

 // 合批送進 GPU
 for(const [geometry,byMaterial] of batches)for(const [material,items] of byMaterial){
  const o=new THREE.InstancedMesh(geometry,material,items.length);
  items.forEach((it,i)=>{dummy.position.set(...it.pos);dummy.rotation.set(...it.rot,'ZYX');dummy.scale.set(...it.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});
  o.castShadow=o.receiveShadow=true;o.instanceMatrix.needsUpdate=true;group.add(o);
 }

 const anchors={platform:[0,py-1.5,platZ+.4],station:[-1,stationY,groundZ+1.6],deck:[0,cy-radius,deckZ],backdrop:[0,seaY0+seaDepth/2,groundZ+.04]};

 return {
  group,path,anchors,params:p,label:p.label,themes:THEMES,
  camera:{yaw:-1.12,elevation:.58,radius:50},
  update(time,period='day'){
   const t=THEMES[period]||THEMES.day,night=period==='night'?1:0;
   if(waterMat){waterMat.color.set(t.water);const sh=waterMat.userData.shader;if(sh){sh.uniforms.seaTime.value=time;sh.uniforms.shallow.value.set(t.shallow);}}
   glass.emissiveIntensity=night*.55;
   lamp.emissiveIntensity=night*.9;
   for(const l of lights)l.intensity=night*2.4;
  },
  dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 };
}

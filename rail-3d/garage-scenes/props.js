// 車庫場景共用道具：闊葉樹、灌木、石頭、透天厝、農舍、電線桿。全部是程式幾何，零資產檔。
// 呼叫端把自己的 geo／mat／instance／rand 交進來，幾何與材質仍由該場景持有並 dispose，合批也走該場景自己的 InstancedMesh。
import * as THREE from '../vendor/three.module.js';

// 單位三角柱：屋脊沿 x，三角形立在 y-z 平面，底寬 1、高 1、長 1。給瓦斜頂用。
function prism(){
 const v=[];for(const x of [-.5,.5])v.push(x,-.5,0, x,.5,0, x,0,1);
 const i=[0,2,1, 3,4,5, 0,1,4,0,4,3, 1,2,5,1,5,4, 2,0,3,2,3,5];
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);
 const flat=g.toNonIndexed();flat.computeVertexNormals();g.dispose();return flat;
}

export function createProps({geo,mat,instance,rand}){
 // 幾何一律轉成 Z 朝上，跟場景的座標系一致。
 const trunkGeo=geo(new THREE.CylinderGeometry(.12,.18,1,7));trunkGeo.rotateX(Math.PI/2);
 const crown=geo(new THREE.SphereGeometry(1,10,7));crown.rotateX(Math.PI/2);   // 平滑球面，樹冠不露稜
 const stoneGeo=geo(new THREE.IcosahedronGeometry(1,0));
 const tankGeo=geo(new THREE.CylinderGeometry(.5,.5,1,10));tankGeo.rotateX(Math.PI/2);
 const poleGeo=geo(new THREE.CylinderGeometry(.5,.5,1,6));poleGeo.rotateX(Math.PI/2);
 const roofGeo=geo(prism());
 const box=geo(new THREE.BoxGeometry(1,1,1));

 const trunk=mat('#6d5a44');
 const greens=[[mat('#5c8a52'),mat('#4a7345')],[mat('#7a9a5e'),mat('#5f8250')],[mat('#456f4c'),mat('#385d42')]];   // 每種各一主冠一側冠
 const shrub=mat('#5f8a55'),stone=mat('#9a9688'),moss=mat('#7f9573');
 // 透天厝的外牆：米白、淡粉磚、淺灰、淡黃、淡綠，同一排不會全一個顏色。
 const walls=[mat('#ece4d2'),mat('#d9b9a6'),mat('#cfd0c8'),mat('#e6dcb2'),mat('#cfd8c4')];
 const dark=mat('#3a4548'),railing=mat('#c4c1b4'),cage=mat('#5b6366'),tin=mat('#556c70'),tank=mat('#d8d5c8');
 const tile=[mat('#a5553f'),mat('#4a4d52')],signs=[mat('#b8593f'),mat('#3d6fa3'),mat('#d9a441')],asphalt=mat('#6b6d68'),concrete=mat('#b9b3a4');

 // 闊葉樹：一個主冠加兩瓣同高嵌進去的側冠，讀起來是一棵樹有起伏，不是三顆球。
 // kind 'round' 圓冠（樟樹）｜'umbrella' 傘冠（榕樹）：更寬更扁、樹幹更粗更短。
 function broadleaf(x,y,z,h=2.2,kind=rand()<.3?'umbrella':'round'){
  const um=kind==='umbrella',r=h*(um?.6:.42),[main,side]=greens[Math.floor(rand()*3)];
  const top=z+h*(um?.5:.42);                                   // 樹幹頂＝樹冠底附近
  instance(trunkGeo,trunk,[x,y,z+(top-z)/2],[um?1.5:1,um?1.5:1,top-z+r*.4]);
  instance(crown,main,[x,y,top+r*(um?.45:.7)],[r,r,r*(um?.55:.85)],[0,0,rand()*Math.PI]);
  for(let j=0;j<2;j++){const a=rand()*Math.PI*2,d=r*.5,k=.55+rand()*.15;
   instance(crown,side,[x+Math.cos(a)*d,y+Math.sin(a)*d,top+r*(um?.35:.55)],[r*k,r*k,r*k*(um?.6:.9)],[0,0,rand()*Math.PI]);
  }
 }
 // 灌木：單團壓扁的樹冠貼地。
 function bush(x,y,z,s=.5){instance(crown,shrub,[x,y,z+s*.45],[s*1.3,s*1.1,s*.7],[0,0,rand()*Math.PI]);}
 function rock(x,y,z,s=.3,mossy=false){instance(stoneGeo,mossy?moss:stone,[x,y,z+s*.3],[s*1.4,s,s*.7],[0,0,rand()*Math.PI]);}

 // 透天厝。facing 是正面朝向：0 朝 −y（面向觀者）。
 // roof 'parapet' 女兒牆｜'tin' 鐵皮加蓋｜'pitched' 瓦斜頂；ground 'plain'｜'arcade' 騎樓｜'shop' 店面招牌；balcony 'rail'｜'cage' 鐵窗。
 function townhouse(x,y,z,{floors=3,width=2.6,depth=3.2,tint=0,facing=0,roof='tin',ground='plain',balcony='rail',tanks=1}={}){
  const fh=1.05,H=floors*fh,wall=walls[tint%walls.length],rot=[0,0,facing];
  const fx=Math.sin(facing),fy=-Math.cos(facing),tx=Math.cos(facing),ty=Math.sin(facing);   // 正面法向量、沿立面切向量
  const put=(g,m,o,a,dz,size)=>instance(g,m,[x+fx*o+tx*a,y+fy*o+ty*a,z+dz],size,rot);
  // 樓身：騎樓把一樓往後縮、留柱子
  if(ground==='arcade'){put(box,wall,-.55,0,fh/2,[width,depth-1.1,fh]);put(box,wall,0,0,fh+(H-fh)/2,[width,depth,H-fh]);
   const n=width>2.7?3:2;for(let i=0;i<n;i++)put(box,concrete,depth/2-.14,-width/2+.22+i*(width-.44)/(n-1),fh/2,[.24,.24,fh]);
   put(box,dark,depth/2-1.05,0,fh*.5,[width*.8,.06,fh*.85]);}
  else put(box,wall,0,0,H/2,[width,depth,H]);
  // 每層窗戶（一格一格，不是一條帶）、陽台
  const nw=Math.max(1,Math.round((width-.5)/.85));
  for(let f=0;f<floors;f++){const zc=z+f*fh;
   if(f>0||ground==='plain')for(let i=0;i<nw;i++)put(box,dark,depth/2+.02,(i-(nw-1)/2)*.85,zc+fh*.6,[.5,.06,.58]);
   if(f>0){if(balcony==='rail'){put(box,wall,depth/2+.22,0,zc+.05,[width*1.02,.5,.1]);put(box,railing,depth/2+.45,0,zc+.32,[width*1.02,.04,.45]);}
    else put(box,cage,depth/2+.14,0,zc+fh*.55,[width*.9,.26,fh*.62]);}
  }
  if(ground==='shop'){put(box,signs[tint%3],depth/2+.09,0,fh-.05,[width*.94,.12,.5]);put(box,dark,depth/2+.02,0,fh*.42,[width*.82,.06,fh*.7]);}
  else if(ground==='plain')put(box,signs[0],depth/2+.3,0,fh-.1,[width*.6,.55,.06]);            // 一樓雨遮
  // 屋頂
  if(roof==='pitched')instance(roofGeo,tile[tint%2],[x,y,z+H],[width+.3,depth+.3,.9+rand()*.3],rot);
  else{put(box,wall,0,0,H+.12,[width+.08,depth+.08,.24]);
   if(roof==='tin')put(box,tin,-depth*.14,(rand()-.5)*width*.2,H+.5,[width*.82,depth*.55,.8]);}
  if(roof!=='pitched')for(let t=0;t<tanks;t++)put(tankGeo,tank,depth*.3,(t?-1:1)*width*.3,H+.55+.12,[.62,.62,1.0]);
 }
 // 農舍：矮、寬、瓦斜頂或鐵皮平頂，配在田邊。
 function farmhouse(x,y,z,{width=3.0,depth=2.4,tint=0,facing=0,pitched=true}={}){
  const rot=[0,0,facing],fx=Math.sin(facing),fy=-Math.cos(facing);
  instance(box,walls[tint%walls.length],[x,y,z+.7],[width,depth,1.4],rot);
  if(pitched)instance(roofGeo,tile[tint%2],[x,y,z+1.4],[width+.5,depth+.5,.8],rot);else instance(box,tin,[x,y,z+1.5],[width+.4,depth+.4,.22],rot);
  for(const a of [-.7,.7])instance(box,dark,[x+fx*(depth/2+.02)+Math.cos(facing)*a,y+fy*(depth/2+.02)+Math.sin(facing)*a,z+.75],[.5,.06,.5],rot);
 }
 // 電線桿：一根桿子一支橫擔。
 function pole(x,y,z,h=3.2){instance(poleGeo,concrete,[x,y,z+h/2],[.16,.16,h]);instance(box,dark,[x,y,z+h-.15],[.9,.07,.07]);}
 // 馬路：一條深灰帶子，配黃色虛線。長度沿 x。
 function road(x,y,z,length,width=1.8){instance(box,asphalt,[x,y,z+.015],[length,width,.03]);for(let s=-length/2+.6;s<length/2-.6;s+=1.4)instance(box,signs[2],[x+s,y,z+.035],[.7,.05,.01]);}
 return{broadleaf,bush,rock,townhouse,farmhouse,pole,road};
}

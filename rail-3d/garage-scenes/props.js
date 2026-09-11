// 車庫場景共用道具：闊葉樹、灌木、石頭、透天厝。全部是程式幾何，零資產檔。
// 呼叫端把自己的 geo／mat／instance／rand 交進來，幾何與材質仍由該場景持有並 dispose，合批也走該場景自己的 InstancedMesh。
import * as THREE from '../vendor/three.module.js';

export function createProps({geo,mat,instance,rand}){
 // 幾何一律轉成 Z 朝上，跟場景的座標系一致。
 const trunkGeo=geo(new THREE.CylinderGeometry(.12,.18,1,7));trunkGeo.rotateX(Math.PI/2);
 const blob=geo(new THREE.IcosahedronGeometry(1,1));
 const stoneGeo=geo(new THREE.IcosahedronGeometry(1,0));
 const tankGeo=geo(new THREE.CylinderGeometry(.5,.5,1,10));tankGeo.rotateX(Math.PI/2);
 const box=geo(new THREE.BoxGeometry(1,1,1));

 const trunk=mat('#6d5a44'),leaves=[mat('#4f7a4c'),mat('#6a8f58'),mat('#3f6a45')],shrub=mat('#5f8a55');
 const stone=mat('#9a9688'),moss=mat('#7f9573');
 // 透天厝的外牆：米白、淡粉磚、淺灰、淡黃四種，同一排不會全一個顏色。
 const walls=[mat('#ece4d2'),mat('#d9b9a6'),mat('#cfd0c8'),mat('#e6dcb2')];
 const dark=mat('#3a4548'),railing=mat('#b9b6aa'),tin=mat('#556c70'),tank=mat('#d8d5c8'),awning=mat('#b8593f');

 // 闊葉樹：一根樹幹頂三團互相咬合的樹冠，三種綠，每團略偏位讓輪廓不對稱。
 function broadleaf(x,y,z,h=2.2){
  const r=h*.42;
  instance(trunkGeo,trunk,[x,y,z+h*.28],[1,1,h*.56]);
  for(let j=0;j<3;j++){const a=rand()*Math.PI*2,d=r*.32,k=.78+rand()*.3;
   instance(blob,leaves[(j+Math.floor(rand()*3))%3],[x+Math.cos(a)*d,y+Math.sin(a)*d,z+h*.62+j*r*.22],[r*k,r*k,r*k*.85],[0,0,rand()*Math.PI]);
  }
 }
 // 灌木：單團壓扁的樹冠貼地。
 function bush(x,y,z,s=.5){instance(blob,shrub,[x,y,z+s*.5],[s*1.3,s*1.1,s*.7],[0,0,rand()*Math.PI]);}
 function rock(x,y,z,s=.3,mossy=false){instance(stoneGeo,mossy?moss:stone,[x,y,z+s*.3],[s*1.4,s,s*.7],[0,0,rand()*Math.PI]);}

 // 透天厝：窄長的樓身，每層一道陽台板與欄杆，頂樓鐵皮加蓋加水塔，正面深色窗帶。
 // facing 是正面朝向：0 朝 −y（面向觀者），Math.PI 朝 +y。
 function townhouse(x,y,z,{floors=3,width=2.6,depth=3.2,tint=0,facing=0}={}){
  const fh=1.05,H=floors*fh,wall=walls[tint%walls.length],rot=[0,0,facing];
  const fx=Math.sin(facing),fy=-Math.cos(facing);            // 正面法向量
  const front=(o,dz,size,m)=>instance(box,m,[x+fx*o,y+fy*o,z+dz],size,rot);
  instance(box,wall,[x,y,z+H/2],[width,depth,H],rot);
  for(let f=0;f<floors;f++){const zc=z+f*fh;
   front(depth/2+.02,zc+fh*.62,[width*.7,.06,fh*.34],dark);                    // 窗帶
   if(f>0){front(depth/2+.22,zc+.05,[width*1.02,.5,.1],wall);                  // 陽台板
    front(depth/2+.45,zc+.32,[width*1.02,.04,.45],railing);}                    // 欄杆
  }
  front(depth/2+.3,z+.95,[width*.6,.55,.06],awning);                            // 一樓雨遮
  instance(box,tin,[x-fx*depth*.12,y-fy*depth*.12,z+H+.42],[width*.9,depth*.62,.84],rot);   // 頂樓加蓋
  instance(tankGeo,tank,[x+fx*depth*.28,y+fy*depth*.28,z+H+.55],[.7,.7,1.1]);      // 水塔
 }
 // 農舍：矮、寬、斜屋頂，配在田邊。
 function farmhouse(x,y,z,{width=3.0,depth=2.4,tint=0,facing=0}={}){
  const rot=[0,0,facing],fx=Math.sin(facing),fy=-Math.cos(facing);
  instance(box,walls[tint%walls.length],[x,y,z+.75],[width,depth,1.5],rot);
  instance(box,tin,[x,y,z+1.6],[width+.4,depth+.4,.22],rot);
  instance(box,dark,[x+fx*(depth/2+.02),y+fy*(depth/2+.02),z+.7],[width*.55,.06,.5],rot);
 }
 return{broadleaf,bush,rock,townhouse,farmhouse};
}

// 細構件淡出：鐵軌、枕木、電線、桿子、欄杆在畫面上只有一兩個像素寬，4 倍多重取樣也蓋不住，鏡頭一動就一閃一閃。
// 場景建好、separateCoplanar 之後跑一次 splitThin：依世界座標的粗細挑出線狀的網格（包圍盒三邊排序後，中間那邊小於 LIMIT、
// 最長邊至少是它的 LONG 倍、最短邊至少是它的 FLAT 倍；牆和地板中間那邊大，人和小擺設不夠長，地上的標線、貼片太扁），換成自己的一份材質。每幀照「這個寬度在畫面上幾個像素」調不透明度：
// 寬到 FULL 像素以上照舊，越細越淡，最淡留 FLOOR，全景時細線還看得到、只是不再忽隱忽現。
// 網頁 garage-diorama.js 與 native scripts/garage-scenes/bake.mjs 都呼叫，三端拿到同一份分法；淡出公式原生照抄 thinOpacity。
import * as THREE from '../vendor/three.module.js';
export const LIMIT=.2,LONG=3,FLAT=.3,FADE=1,FULL=3.5,FLOOR=.3;
// width：世界單位；ppu：畫面每單位幾個裝置像素（正交鏡頭全畫面一樣）。
export function thinOpacity(width,ppu){const x=Math.max(0,Math.min(1,(width*ppu-FADE)/(FULL-FADE)));return FLOOR+(1-FLOOR)*x*x*(3-2*x);}
const pos=new THREE.Vector3(),scl=new THREE.Vector3(),rot=new THREE.Quaternion(),world=new THREE.Matrix4(),one=new THREE.Matrix4(),size=new THREE.Vector3();
// 線狀的回傳粗細（中間那邊），不是線回傳 Infinity。
function widthOf(geometry,matrix){if(!geometry.boundingBox)geometry.computeBoundingBox();geometry.boundingBox.getSize(size);matrix.decompose(pos,rot,scl);
 const d=[Math.abs(size.x*scl.x),Math.abs(size.y*scl.y),Math.abs(size.z*scl.z)].sort((a,b)=>a-b);return d[2]>=LONG*d[1]&&d[0]>=FLAT*d[1]?d[1]:Infinity;}
// 回傳 [{mesh, source, width}]：mesh 換成 source 的複本（transparent），width 是這批的中位數粗細。
// 透明、多材質、隱藏的網格不動；樹葉（taiwan-trees）不是線，不動。
export function splitThin(group,limit=LIMIT){
 group.updateMatrixWorld(true);const list=[],meshes=[];
 group.traverse(o=>{if(o.isMesh&&o.visible!==false&&o.name!=='taiwan-trees'&&!Array.isArray(o.material)&&!o.material.transparent&&!o.material.userData.thin)meshes.push(o);});
 for(const o of meshes){
  const source=o.material;
  if(o.isInstancedMesh){
   // 整批都細才換：只換材質、不搬實例，場景模組逐幀照編號改實例（人、柵欄、車）也不受影響。粗細混在一起的批不動。
   const widths=[];let mixed=false;
   for(let i=0;i<o.count&&!mixed;i++){o.getMatrixAt(i,one);const w=widthOf(o.geometry,world.multiplyMatrices(o.matrixWorld,one));if(w<limit)widths.push(w);else mixed=true;}
   if(mixed||!widths.length)continue;
   o.material=fadeCopy(source,median(widths));list.push({mesh:o,source,width:o.material.userData.thin});
  }else{
   const w=widthOf(o.geometry,o.matrixWorld);if(w>=limit)continue;
   o.material=fadeCopy(source,w);list.push({mesh:o,source,width:w});
  }
 }
 return list;
}
function median(a){a.sort((x,y)=>x-y);return a[a.length>>1];}
function fadeCopy(source,width){const m=source.clone();m.transparent=true;m.userData={...source.userData,thin:width};return m;}
// 每幀：先照原材質同步（場景模組會依時段改原材質的顏色、自發光），再乘淡出值。
export function applyThinFade(list,ppu){
 for(const {mesh,source,width} of list){const m=mesh.material;
  m.color.copy(source.color);if(m.emissive&&source.emissive)m.emissive.copy(source.emissive);
  if(source.emissiveIntensity!=null)m.emissiveIntensity=source.emissiveIntensity;m.opacity=source.opacity*thinOpacity(width,ppu);}
}

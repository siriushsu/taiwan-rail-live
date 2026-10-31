// 車門：讀車模 doors 中繼資料（garage-doors-v1），依門開度在頂點著色器位移門扇。門扇與車身仍是同一次繪製，draw call 不增加。
// 任何需要門位置的程式（乘客走位、驗收）都從 doorOffset 算，不讀 GPU。
import * as THREE from './vendor/three.module.js';
export const MAX_DOORS=8,INWARD_SHARE=.4/3;
const ease=t=>t*t*(3-2*t),clamp01=v=>Math.min(1,Math.max(0,v));
// 門開度 0..1 → 車模座標位移：前 0.4 秒內退到壁袋平面，後 2.6 秒滑進壁袋；關門倒過來走同一條路。
export function doorOffset(door,open){
 const i=ease(clamp01(open/INWARD_SHARE)),s=ease(clamp01((open-INWARD_SHARE)/(1-INWARD_SHARE)))*door.travel;
 return [0,1,2].map(k=>door.inward[k]*i+door.slide[k]*s);
}
// 每個頂點屬於第幾扇門（0＝不是門）；區段互相重疊或越界直接丟錯，不默默畫錯門。
export function buildDoorIndex(vertexCount,items){
 if(items.length>MAX_DOORS)throw Error('garage doors: more than '+MAX_DOORS+' doors');
 const index=new Float32Array(vertexCount);
 for(const [k,door]of items.entries())for(const r of door.ranges){
  if(!(r.start>=0&&r.count>0&&r.start+r.count<=vertexCount))throw Error('garage doors: range out of bounds '+door.id);
  for(let v=r.start;v<r.start+r.count;v++){if(index[v])throw Error('garage doors: overlapping ranges '+door.id);index[v]=k+1;}
 }
 return index;
}
// 門廳透光（設計書 §9「開門時門內透光」）：頂燈藏在門楣後、鏡頭一律俯看看不到它，three.js 的自發光也不照亮別的面；
// 所以門洞後方、車殼內側（比門扇中心面再往內 4 公分）、門檻到門楣之間的面標 1，讓它們跟著這節車的窗燈一起亮。門扇（index≠0）不算。
// 09-26 複驗項 6 起不看三角形重心：門廳背牆與地板是一整片跨過門洞的四邊形、只切兩個三角形，看重心只亮一半，還會點亮跨過門洞邊的車殼外側長條。
// 1. 整個三角形在門洞左右範圍內（外擴 5 cm）：重心深度在 .5～門扇中心面內 4 cm（原本的規則）。
// 2. 跨過門洞範圍的：整個在車內深處（離中心線 .5～1.3；車殼最往內彎的裙板也在 1.36 以外）。
// 1、2 的 z 看重心、夾在門檻與門楣之間：車殼在車肩、裙板往內彎，放寬會把門洞上下的車殼外側也標進來，夜裡車外會發亮。
// 3. 門廳盒子：沿車身＝背牆（2 的條件、面朝門口、從門檻到門楣整面高）的範圍，深 .85～門扇中心面內 4 cm，門檻到門楣上方 5 cm；整個三角形在盒內就亮，
//    （客室地板邊的底盤斜條也面朝門口、在深處，但只有 2 cm 高、整節車長；拿它量，盒子會延伸到車頭擋風玻璃框與客室裡的橫向面。）
//    但伸到 1.3 以外（貼著車殼）的只有端牆（法向量沿車身）與地板（到 1.38）。斜看時門洞裡大半是端牆；車端那扇門的端牆跟車端外側只隔 2 cm，
//    靠背牆範圍（外擴 2 mm）分開，車端外側（車與車之間的縫看得到）不會亮；車頭那扇門外面的流線外殼也在盒外。
// 載入車模時每個 geometry 跑一次（頭車約 6 萬個三角形）：先把每個三角形的包圍盒與法向量存進 T，每扇門只做純量比較，不配置物件。
// T 每個三角形 12 格：0 第一個頂點、1 |法向量 x|、2 |法向量 y|、3 水平面（1／0）、4～5 x 最小／最大、6～7 y 最小／最大、8 重心 y、9～10 z 最小／最大、11 重心 z。
export function buildDoorGlow(position,items,index){
 const glow=new Float32Array(position.count),T=new Float64Array(Math.floor(position.count/3)*12);let m=0;
 for(let v=0;v+2<position.count;v+=3){if(index[v]||index[v+1]||index[v+2])continue;
  const x0=position.getX(v),y0=position.getY(v),z0=position.getZ(v),x1=position.getX(v+1),y1=position.getY(v+1),z1=position.getZ(v+1),x2=position.getX(v+2),y2=position.getY(v+2),z2=position.getZ(v+2);
  const ax=x1-x0,ay=y1-y0,az=z1-z0,bx=x2-x0,by=y2-y0,bz=z2-z0,nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,l=Math.hypot(nx,ny,nz);
  T[m]=v;T[m+1]=l>0?Math.abs(nx)/l:0;T[m+2]=l>0?Math.abs(ny)/l:0;T[m+3]=l>0&&Math.abs(nz)/l>=.9?1:0;T[m+4]=Math.min(x0,x1,x2);T[m+5]=Math.max(x0,x1,x2);
  T[m+6]=Math.min(y0,y1,y2);T[m+7]=Math.max(y0,y1,y2);T[m+8]=(y0+y1+y2)/3;T[m+9]=Math.min(z0,z1,z2);T[m+10]=Math.max(z0,z1,z2);T[m+11]=(z0+z1+z2)/3;m+=12;}
 for(const d of items){const s=Math.sign(d.center[1]),cx=d.center[0],hw=d.width/2+.05,lim=Math.abs(d.center[1])-.04,z0=d.center[2]-d.height/2,z1=d.center[2]+d.height/2;
  // a、b＝沿車身、相對門中心的範圍；w0、w1＝往車內（s·y）的範圍；wc＝重心往車內的深度。
  let x0=Infinity,x1=-Infinity;
  for(let i=0;i<m;i+=12){const a=T[i+4]-cx,b=T[i+5]-cx,w0=Math.min(s*T[i+6],s*T[i+7]),w1=Math.max(s*T[i+6],s*T[i+7]),zc=T[i+11];
   if(T[i+2]>=.9&&zc>=z0-.01&&zc<=z1-.005&&a<=hw&&b>=-hw&&w0>.5&&w1<=1.3&&T[i+9]<=z0+.05&&T[i+10]>=z1-.05){x0=Math.min(x0,a);x1=Math.max(x1,b);}}
  for(let i=0;i<m;i+=12){const a=T[i+4]-cx,b=T[i+5]-cx,w0=Math.min(s*T[i+6],s*T[i+7]),w1=Math.max(s*T[i+6],s*T[i+7]),wc=s*T[i+8],zc=T[i+11];
   if(zc>=z0-.01&&zc<=z1-.005&&(a>=-hw&&b<=hw?wc>.5&&wc<=lim:a<=hw&&b>=-hw&&w0>.5&&w1<=1.3)
    ||a>=x0-.002&&b<=x1+.002&&w0>=.85&&w1<=lim&&T[i+9]>=z0-.01&&T[i+10]<=z1+.05&&(w1<=1.3||T[i+1]>=.9||T[i+3]&&w1<=1.38))glow.fill(1,T[i],T[i]+3);}
 }
 return glow;
}
// 車模 +Y 那一側是否面向月台：+1 是、-1 否。normal 是「從軌道指向月台」的世界方向。
const axis=new THREE.Vector3();
export function platformSide(quaternion,normal){axis.set(0,1,0).applyQuaternion(quaternion);return axis.dot(normal)>0?1:-1;}
const VERTEX_HEAD='#include <common>\nattribute float doorIndex;\nattribute float doorGlow;\nvarying float vDoorGlow;\nuniform vec3 doorOffsets['+MAX_DOORS+'];';
const VERTEX_MOVE='#include <begin_vertex>\n{int door=int(doorIndex+.5);if(door>0)transformed+=doorOffsets[door-1];}\nvDoorGlow=doorGlow;';
const FRAGMENT_HEAD='#include <common>\nuniform vec3 doorGlowColor;\nvarying float vDoorGlow;';
const FRAGMENT_GLOW='#include <emissivemap_fragment>\ntotalEmissiveRadiance+=doorGlowColor*vDoorGlow;';
// 同一段 shader 修改、同一個快取鍵；uniform 則是每節車自己一份（onBeforeCompile 對每個材質各跑一次）。
function patch(material,uniforms){
 material.onBeforeCompile=shader=>{shader.uniforms.doorOffsets=uniforms.doorOffsets;shader.uniforms.doorGlowColor=uniforms.doorGlowColor;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',VERTEX_HEAD).replace('#include <begin_vertex>',VERTEX_MOVE);
  // 深度材質沒有自發光那一段，只多宣告不使用。
  if(shader.fragmentShader)shader.fragmentShader=shader.fragmentShader.replace('#include <common>',FRAGMENT_HEAD).replace('#include <emissivemap_fragment>',FRAGMENT_GLOW);};
 material.customProgramCacheKey=()=>'garage-doors-v1';material.needsUpdate=true;return material;
}
export function createDoorControl(cars){
 const rows=[],q=new THREE.Quaternion(),v=new THREE.Vector3();
 for(const c of cars){const items=c.asset.doors?.items;if(!items?.length)continue;const g=c.asset.geometry;
  if(!g.getAttribute('doorIndex'))g.setAttribute('doorIndex',new THREE.BufferAttribute(buildDoorIndex(g.getAttribute('position').count,items),1));
  if(!g.getAttribute('doorGlow'))g.setAttribute('doorGlow',new THREE.BufferAttribute(buildDoorGlow(g.getAttribute('position'),items,g.getAttribute('doorIndex').array),1));
  const uniforms={doorOffsets:{value:Array.from({length:MAX_DOORS},()=>new THREE.Vector3())},doorGlowColor:{value:new THREE.Color(0,0,0)}},owned=[];
  // 車燈模組已替發光材質各做一份複本（它的 rows 還握著那幾份）；那幾份直接加上車門位移，其餘共用材質這裡才複製，每節車各一份。
  c.litMaterials=c.litMaterials.map((m,i)=>{if(m!==c.asset.materials[i])return patch(m,uniforms);const copy=patch(m.clone(),uniforms);owned.push(copy);return copy;});
  c.body.material=c.litMaterials;
  // 陰影跟著門走：同樣位移的深度材質。
  const depth=patch(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),uniforms);c.body.customDepthMaterial=depth;owned.push(depth);
  // 門廳跟著這節車的窗燈亮：車燈模組每個時段改的是這一份（傍晚、夜晚亮，白天 0）。
  rows.push({c,items,uniforms,owned,side:0,open:0,window:c.litMaterials.find(m=>m.userData.railLightingRole==='window')});
 }
 // open＝門開度 0..1；normal＝從軌道指向月台的世界方向。只開月台那一側。
 function update(open,normal){
  for(const r of rows){r.c.car.getWorldQuaternion(q);r.side=platformSide(q,normal);r.open=open;
   if(r.window)r.uniforms.doorGlowColor.value.copy(r.window.emissive).multiplyScalar(r.window.emissiveIntensity);
   r.items.forEach((d,k)=>{const o=d.side===r.side?doorOffset(d,open):[0,0,0];r.uniforms.doorOffsets.value[k].set(o[0],o[1],o[2]);});}
 }
 // 關門位置的門中心（世界座標）：which='platform' 取月台側，其餘取另一側。
 function points(which='platform'){
  const out=[];
  for(const r of rows){r.c.body.updateWorldMatrix(true,false);
   for(const d of r.items)if((which==='platform')===(d.side===r.side))out.push({id:r.c.id+':'+d.id,car:r.c,door:d,point:v.set(...d.center).applyMatrix4(r.c.body.matrixWorld).clone()});}
  return out;
 }
 return{update,points,
  get state(){return rows.map(r=>({car:r.c.id,side:r.side,open:r.open,moving:r.items.filter(d=>d.side===r.side&&r.open>0).map(d=>d.id)}));},
  dispose(){for(const r of rows)r.owned.forEach(m=>m.dispose());}};
}

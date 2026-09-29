// 車庫三節車的頭尾朝向：不開瀏覽器，直接用正式的 createConsist／createLoop 擺車，
// 以車模自己的車燈（lamp 材質）落在哪一端當「車頭端」的真值，逐款檢查：
// 環形試跑正反兩向、海岸行旅正反兩向，頭尾車的車頭都朝外；環形行駛時頭車在行進方向最前面。
// 9/26 網友截圖：環形試跑按 ⇄ 後每節車原地轉 180°，頭尾車頭都轉進車廂之間；舊判準只量「位置不動、朝向差 π」，量不到這個。
// 另外兩條（9/26 獨立複驗建議）：直線跑道上 follow(dir) 要跟海岸行旅 straight(dir) 逐值相同——反向＝整列掉頭，
// 同時守住「按 ⇄ 不沿軌道滑移」「車鉤接在相鄰兩節相對的那一端」「沒有車燈可判的車款頭車也朝外」；
// 福森號、栩悅號傳 locoAtTail 時兩端仍朝外（尾車 flip 排在換端之前會讓兩端全部朝內）。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const u=new URL(String(url));if(u.protocol!=='file:')return realFetch(url,opts);
 try{return new Response(fs.readFileSync(fileURLToPath(u)));}catch{return new Response('missing',{status:404});}};
const {loadGarageModel,createConsist}=await import(pathToFileURL(path.join(root,'rail-3d/garage-model.js')).href);
const {createLoop}=await import(pathToFileURL(path.join(root,'rail-3d/garage-loop.js')).href);
const THREE=await import(pathToFileURL(path.join(root,'rail-3d/vendor/three.module.js')).href);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'rail-3d/assets/blender-map-v1/manifest.json')));
const ids=Object.keys(manifest.models),loop=createLoop(),failures=[];let checked=0,models=0,clearEnds=0;
// 車燈重心離車體中心超過半長的一半才算有明確車頭端；兩端都有燈（雙頭機車、雙向單車）或沒有燈就不判。
function cabEnd(asset){
 const pos=asset.geometry.getAttribute('position'),index=asset.geometry.index;let sum=0,n=0;
 for(const g of asset.geometry.groups){const m=asset.materials[g.materialIndex];if(m?.name!=='lamp')continue;
  for(let k=g.start;k<g.start+g.count;k++){sum+=pos.getX(index?index.getX(k):k);n++;}}
 if(!n)return 0;const r=(sum/n-asset.center.x)/(asset.size.x/2);return r>.5?1:r<-.5?-1:0;
}
const at=new THREE.Vector3(),axis=new THREE.Vector3();
function pose(c){c.car.updateMatrixWorld(true);return{p:at.setFromMatrixPosition(c.car.matrixWorld).clone(),x:axis.setFromMatrixColumn(c.car.matrixWorld,0).normalize().clone()};}
function outward(consist,ends,label){
 consist.root.updateMatrixWorld(true);const poses=consist.cars.map(pose);
 for(const i of [0,2]){if(!ends[i])continue;checked++;
  const face=poses[i].x.clone().multiplyScalar(ends[i]),away=poses[i].p.clone().sub(poses[1].p);
  if(face.dot(away)<=0)failures.push(label+(i===0?' 頭車':' 尾車')+'車頭朝內');}
 return poses;
}
// 沿 −X 走的直線：straight(1) 的編組朝 −X 行駛（root 轉 π），follow 在這條線上正向也朝 −X，兩者可以逐值比。
const line={length:1e3,sample:s=>({x:-s,y:0})};
function snapshot(consist){consist.root.updateMatrixWorld(true);return consist.root.children.map(o=>o.matrixWorld.elements.slice());}
function differ(a,b){let m=0;for(let i=0;i<a.length;i++)for(let k=0;k<16;k++)m=Math.max(m,Math.abs(a[i][k]-b[i][k]));return m;}
function sameAsCoast(consist,direction){consist.follow(line,0,direction);const f=snapshot(consist);consist.straight(direction);return differ(f,snapshot(consist));}
for(const id of ids){
 const primary=await loadGarageModel(id),consist=await createConsist(id,primary);models++;
 const ends=consist.cars.map(c=>cabEnd(c.asset));clearEnds+=!!ends[0]+!!ends[2];
 for(const direction of [1,-1]){
  const tag=id+(direction===1?' 正向':' 反向');
  for(let i=0;i<8;i++){
   const s=i/8*loop.length;consist.follow(loop,s,direction);const a=outward(consist,ends,tag+'環形 s='+s.toFixed(1));
   // UI 每幀 distance+=dt*2.1*direction：往前推一小段，頭車要朝自己車頭的方向前進。
   if(ends[0]){consist.follow(loop,s+.4*direction,direction);consist.root.updateMatrixWorld(true);const b=pose(consist.cars[0]);
    if(b.p.clone().sub(a[0].p).dot(a[0].x.clone().multiplyScalar(ends[0]))<=0)failures.push(tag+'環形 s='+s.toFixed(1)+' 頭車沒有朝車頭方向前進');}
  }
  checked++;if(sameAsCoast(consist,direction)>1e-9)failures.push(tag+'直線 與海岸行旅的整列擺法不同');
  consist.straight(direction);outward(consist,ends,tag+'海岸');
 }
 consist.dispose();primary.dispose();
}
// 福森號、栩悅號在 locoAtTail 下（阿里山場景）兩端仍要朝外。
for(const id of ['fushen','xuyue']){const primary=await loadGarageModel(id),consist=await createConsist(id,primary,undefined,{locoAtTail:true}),ends=consist.cars.map(c=>cabEnd(c.asset));
 for(const direction of [1,-1]){const tag=id+' locoAtTail'+(direction===1?' 正向':' 反向');consist.follow(loop,10,direction);outward(consist,ends,tag+'環形');consist.straight(direction);outward(consist,ends,tag+'海岸');}
 consist.dispose();primary.dispose();}
// 正向對照：同一套判準對「原地各轉 180°」的舊擺法必須紅，否則判準沒有牙。
{const id='emu3000',primary=await loadGarageModel(id),consist=await createConsist(id,primary),ends=consist.cars.map(c=>cabEnd(c.asset));
 consist.follow(loop,10,1);for(const c of consist.cars)c.car.rotation.z+=Math.PI;const before=failures.length;outward(consist,ends,'對照');
 const bit=failures.length-before===2;failures.splice(before);if(!bit)failures.push('正向對照沒有紅：判準量不到頭尾車頭朝內');
 // 直線比對的對照：反向擺好之後每節再原地轉 π（舊擺法），跟 straight(-1) 必須差得出來。
 consist.follow(line,0,-1);for(const c of consist.cars)c.car.rotation.z+=Math.PI;const g=snapshot(consist);consist.straight(-1);
 if(differ(g,snapshot(consist))<.5)failures.push('直線比對的對照沒有紅：量不到每節原地轉 π');consist.dispose();primary.dispose();}
// 9/26 素材：62 款裡有 79 節頭尾車的車燈只在一端；少於此數＝車燈材質被拿掉或改名，判準會無聲變少。
if(models!==62)failures.push('車款數 '+models+'，應為 62');
if(clearEnds<79)failures.push('有明確車頭端的頭尾車 '+clearEnds+' 節 < 79（覆蓋率縮水）');
console.log('車款 '+models+'，有明確車頭端的頭尾車 '+clearEnds+' 節，受檢 '+checked+' 次，失敗 '+failures.length);
// 同一款同一種錯在環形八個位置都會出現，依車款彙總（位置改記次數）。
const byModel=new Map();for(const f of failures){const [id,...rest]=f.split(' '),kind=rest.join(' ').replace(/ s=[\d.]+/,'');const m=byModel.get(id)||new Map();m.set(kind,(m.get(kind)||0)+1);byModel.set(id,m);}
for(const [id,m]of byModel)console.log('FAIL',id,[...m].map(([k,n])=>n>1?k+'×'+n:k).join('；'));
process.exit(failures.length?1:0);

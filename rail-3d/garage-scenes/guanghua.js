import * as THREE from '../vendor/three.module.js';
import {createKit,smooth} from './new-scene-kit.js';
import {personPose} from '../garage-people.js?revision=people-0927';
import {METER,UNIT_PER_M,TORSO_LIMIT,TORSO_RATE,TAU,SEE_X} from './duoliang.js?revision=stairs-0929';
import {createScooterRider} from '../garage-scooter.js?revision=guanghua-photo-0930';
// 台南光華街涵洞（中西區光華街鐵路橋下）微縮場景・粗模（2026-09-30 第一輪，只做骨架與比例，材質是色塊）。
// 使用者原話（2026-09-30 08:16）：「附近有一個大家都在拍照的地下道 我希望做成一個3D車庫的景」；選項回覆：地下道＝光華街涵洞；時期＝地下化前（車從上面過）。
// 場景概念（主對話判讀，不是使用者原話）：台鐵車在涵洞上方的雙線鐵路橋跑，橋下一條窄巷道壓低穿過涵洞，洞口有人拍照。
// 位置：OSM way 160911822（highway=residential, service=alley, tunnel=yes，長 27.7 m 含引道）；上方縱貫線雙線、電化（OSM 108037248／347019916）。
// 幾何依據（全部「依照片估計」，照片是自由時報 2026-09-12 洪瑞琴〈台南限定倒數！「火車頭頂跑、機車橋下鑽」成最後打卡熱點〉圖一，只線上看、沒下載）：
//   淨高約 2.1 m、淨寬約 3 m 單車道無人行道、穿越長度約 8～10 m（雙線橋面）、灰色清水混凝土翼牆（有水漬）、洞口上緣黃黑斜紋警示梁、正中紅框圓形標誌（推測限高，照片上看不出字，這裡不寫字）、
//   涵洞內路面低於外側平台且遠端向右上彎出、列車底部約高出警示梁 .6～.9 m、橋面兩側電纜槽與電車線桿、周邊是二、三層透天厝。
// 比例（主對話判讀）：列車、人、結構一律真實比例，換算沿用 duoliang.js：結構 1 m ＝ METER 單位（三款車寬的平均），人跟著車款用 UNIT_PER_M（人身高與車高才照著模型的真實比）。
// 下面標「本輪自訂」的數字不是查證來的，是讓幾何自洽的假設；精修輪要重新對照片。
// 【第二輪・構圖修正，2026-09-30】使用者看完粗模截圖後選了「照這三點改」（三點內容是主對話寫的選項，不是使用者原話；以下是主對話判讀）：
//   ① 全景看不出涵洞（洞口被房子擋住、鐵路像鐵在平地上）② 洞口低角度畫面被近處房子塞滿 ③ 新聞照片洞口前是一大塊空地，粗模卻是房子貼著巷子。
//   改法（主對話判讀）：洞口前留一塊開闊鋪面空地（|x|<PX，一路到底座前緣不蓋房子），房子退到空地兩側；路堤正面貼一層灰色混凝土「擋土牆」面板（壓頂、扶壁、水漬），
//   引道翼牆加高到橋面、牆頂接路堤與鐵道；拍照者站到空地上、不擋洞口；全景預設視角轉到看得見洞口（見 guanghua-view.js）。
//   註：這份程式沒有任何「淡出」機制（不透明度只有底下接影子的地面板 ShadowMaterial 一處）；粗模截圖裡的半透明感是近處房子的淡色牆面、水塔與窗框堆疊的觀感，房子拿掉就沒了。
// 【第三輪・接機車與夜燈，2026-09-30】派工單（主對話寫的，不是使用者原話）：機車＋騎士定時穿過涵洞、方向每圈交替；入夜涵洞頂一盞燈、空地兩盞路燈、機車前後燈亮、透天厝窗戶發亮。
//   使用者原話（2026-09-30 選項回覆）：機車選「Blender 新做機車＋零件庫騎士」（該選項說明是主對話寫的）。以下數字與做法全是本輪自訂／主對話判讀：
//   ・機車＝garage-scooter.js（Blender 資產＋沿用人零件庫 kits[0] 的騎士），真實比例 scale＝METER；位置是「時間的純函數」（暫停、拖時間、看涵洞快轉都對得上），時刻表綁列車圈時鐘：本線車心經過 x＝0 的那一刻＝機車經過涵洞中心，所以三款車每一圈都會有「列車在洞上、機車在洞裡」。
//   ・靠右行駛：車身在行進方向右側、偏巷子中線 .4 m；涵洞前後與洞內約 15 km/h、其餘最多 25 km/h（smoothstep 加減速）。
//   ・前後兩端在底座緣（y＝±Y）被剪裁面切掉（同列車在 ±CLIP 的做法），起訖時整台機車都在剪裁面外，所以不會憑空冒出來。
//   ・點光源上限 3 盞（涵洞頂 1、路燈 2）；其餘夜間效果一律用自發光材質，不加點光源與光池圓盤。
export {METER,UNIT_PER_M};
export const LAP=130,SPEED=2.6,CLIP=26,PHASE=-10; // 環線長（單位）、巡航速度（單位／秒）、車體被裁掉的 x 界線（同 crossing：整列離景後才循環）；第二輪底座縮短，CLIP 由 35 縮到 26（主對話判讀）；PHASE：時間 0 時本線車中心在 x＝-10（view 的 distanceAt 與機車時刻表共用這一個常數）
export const THEMES={ // 同高架景那組色（viaduct.js），粗模沿用
 day:{background:'#e7e8e1',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04},
 sunset:{background:'#ecd9c6',sun:'#ffb974',ambient:'#d2b9b4',ground:'#74795e',power:2.9,exposure:.94},
 night:{background:'#141f2e',sun:'#9fbfe4',ambient:'#5d7590',ground:'#2b3440',power:.72,exposure:.76}
};
// 幾何規格（公尺）。「依照片估計」的與「本輪自訂」的分開標。
export const DIM={
 W:4.5,        // 涵洞淨寬（照片比對第二輪由 3.0 加寬：使用者 09-30 貼的遠景正面照，開口寬約為淨高的 2.5 倍；主對話依照片估計）
 H:2.1,        // 涵洞淨高（依照片估計）
 BANK:10.0,    // 穿越長度＝路堤頂寬（依照片估計 8～10 m 取上限：kit 的道床每股 5.3 m 寬，兩股要放得下）
 DECK:2.3,     // 橋面頂離涵洞路面（照片比對輪由 2.6 降到 2.3：軌頂跟著降 .3 m，護欄頂才剛好蓋住鋼軌、從人眼高度只看到車底，同使用者 09-30 貼的照片；數值是主對話依照片估計）
 BEAM:2.67,    // 黃黑斜紋梁頂（照片比對輪：斜紋約 .5 m 高，依照片估計；原本 2.95。r6：兩張照片量到斜紋約 .57 m，主對話依照片估計）
 FLANGE:2.9,   // 斜紋梁上的淺灰鋼梁翼板頂（依照片估計，約 .2 m 高；r6 量到約 .23 m）
 PARAPET:3.22, // 灰色混凝土護欄頂（依照片估計：翼板上露出約 .3 m；比軌頂高一點點。r6 量到約 .32 m）
 PARAPET_T:.25,// 護欄厚（本輪自訂）
 BEAM_T:.35,   // 警示梁厚（本輪自訂）
 DIP:.6,       // 涵洞路面比外側低多少（依照片估計「低於外側」，數值本輪自訂）
 CUT:4.4,      // 洞口外的引道切口長（本輪自訂；粗模是 5.2，短一點翼牆坡度陡、斜角看洞口比較不被擋）
 FLAT:1.5,     // 切口裡先平 1.5 m 再爬坡（本輪自訂）
 WALL_T:.45,   // 翼牆厚（本輪自訂；粗模是 .3，擋土牆要有分量）
 WALL_H:2.67,  // 翼牆貼路堤那一端的高＝斜紋梁頂＝錐坡頂，往外斜降到外側地面（本輪自訂；粗模是 2.2）
 ABUT:.8,      // 【r6】洞口兩側橋台正面寬：翼牆往外挪這麼多，露出貼洞口平面、正對鏡頭的鏽色橋台面（兩張照片裡緊貼開口的是這一面，主對話依照片估計）
 SPACING:4.0,  // 雙線線間距（本輪自訂：台鐵雙線一般約 4 m）
 ALLEY:4.0     // 涵洞外的巷寬（本輪自訂）
};
const STACK=.31; // new-scene-kit.js track()：道床底到軌頂 .31 單位（道床 .18＋枕木 .10＋鋼軌 .07 疊起來）

// 截面在 y–z 平面、沿 x 擠出並在 x 置中的柱體（翼牆、斜坡用）。pts 是 [y,z] 折線，順逆時針都可以。
function profile(k,pts,thick){
 const g=new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([y,z])=>new THREE.Vector2(y,z))),{depth:thick,bevelEnabled:false});
 g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0))); // 截面 u→y、v→z、擠出→x（旋轉，不鏡像）
 g.translate(-thick/2,0,0);
 return k.geo(g);
}
// 黃黑斜紋警示梁的立面＋正中紅框圓牌（一張貼圖；圓牌裡沒寫字，照片看不出）。w×h 是立面尺寸（單位），貼圖依比例開，斜紋才是 45°。
function warningFace(w,h,cf=.5){ // cf：圓牌中心在立面寬的哪個比例
 const c=document.createElement('canvas'),W=1024,H=Math.max(64,Math.round(W*h/w));c.width=W;c.height=H;
 const g=c.getContext('2d');g.fillStyle='#c98f24';g.fillRect(0,0,W,H); // r6：黃改偏琥珀（評審：截圖偏檸檬黃、照片偏琥珀）
 const p=H*.22,k=H*.55; // 黃、黑各一條的水平寬與斜紋上下兩端的水平位移（照片比對輪：依照片改窄、改陡，一組約 .35 m；原本 p＝H×.62、k＝H。r6：兩張照片量到一組約 .25 m，再改窄）
 g.fillStyle='#26282a';for(let x0=-H;x0<W+H;x0+=p*2){g.beginPath();g.moveTo(x0,H);g.lineTo(x0+p,H);g.lineTo(x0+p+k,0);g.lineTo(x0+k,0);g.closePath();g.fill();}
 const r=H*.43;g.fillStyle='#f3efe4';g.beginPath();g.arc(W*cf,H/2,r,0,Math.PI*2);g.fill();
 g.lineWidth=r*.2;g.strokeStyle='#c4342b';g.beginPath();g.arc(W*cf,H/2,r-g.lineWidth/2,0,Math.PI*2);g.stroke();
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
// 【照片比對】洞口周邊細節共用一張 1024² 貼圖（一個網格＝一次 draw call）：上 384 列是卵石錐坡（透明處露出底下草坡，外緣四分之一橢圓），下面是限高牌、黃黑桿、各色色塊。
// 卵石的顏色與疏密依使用者 09-30 貼的照片二（深灰砂漿、橘褐卵石）估計；圓牌照片看不清字，這裡不寫字。
const SWATCH={red:'#b4463c',grass:'#3b5227',grass2:'#39532a',flange:'#d3d5cf',yellow:'#d7b43a',bush:'#3a5429',bush2:'#4a6630',mirror:'#a3aaae',rim:'#43464a',blue:'#2d5d9c',white:'#eceae2'};
function detailAtlas(rand){
 const c=document.createElement('canvas');c.width=c.height=1024;const g=c.getContext('2d'),S=384;
 g.fillStyle='#393b37';g.fillRect(0,0,1024,S);
 for(let i=0;i<5000;i++){const v=38+rand()*24|0;g.fillStyle=`rgb(${v},${v+2},${v-2})`;g.fillRect(rand()*1024,rand()*S,2+rand()*4,2+rand()*4);}
 const stones=['#7e4f30','#8b5a36','#6c4630','#5b4d40','#4b4a45'];
 for(let i=0;i<150;i++){const x=rand()*1024,y=rand()*S,r=6+rand()*5;g.fillStyle=stones[rand()*stones.length|0];g.beginPath();g.ellipse(x,y,r*(1+rand()*.4),r,rand()*Math.PI,0,Math.PI*2);g.fill();}
 // 錐坡外形：靠洞口那 5% 頂緣是平的，往外近乎直線降到坡腳（照片比對第二輪：照片裡錐坡頂從洞口旁一路斜降，主對話判讀）；外側透明
 g.globalCompositeOperation='destination-in';g.beginPath();g.moveTo(0,0);g.lineTo(51,0);
 for(let x=51;x<=1024;x+=8){const f=(x-51)/(1024-51);g.lineTo(x,S*Math.pow(f,1.1));}
 g.lineTo(1024,S);g.lineTo(0,S);g.closePath();g.fill();g.globalCompositeOperation='source-over';
 const rect={stone:[0,0,1024,S],pole:[0,400,64,656],sign:[80,400,336,656]},sw={};
 Object.entries(SWATCH).forEach(([n,col],i)=>{const x=352+(i%10)*64,y=400+(i/10|0)*64;g.fillStyle=col;g.fillRect(x,y,64,64);sw[n]=[(x+32)/1024,1-(y+32)/1024];});
 for(let i=0;i<8;i++){g.fillStyle=i%2?'#26282a':'#d7b43a';g.fillRect(0,400+i*32,64,32);} // 黃黑相間的桿
 g.fillStyle='#b8b5ac';g.fillRect(80,400,256,256);g.fillStyle='#f1eee6';g.beginPath();g.arc(208,528,124,0,Math.PI*2);g.fill();
 g.lineWidth=26;g.strokeStyle='#c4342b';g.beginPath();g.arc(208,528,111,0,Math.PI*2);g.stroke();
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
 const uvRect=n=>{const [x0,y0,x1,y1]=rect[n];return[x0/1024,1-y1/1024,x1/1024,1-y0/1024];}; // [u0,v0,u1,v1]
 return{texture:t,swatch:sw,uvRect};
}
// 把多個幾何（各自先套好世界矩陣與 UV）併成一個非索引幾何。
const seeded=n=>{let v=n;return()=>((v=(Math.imul(v,1664525)+1013904223)>>>0)/4294967296);};
function mergeParts(parts){
 const P=[],N=[],U=[];
 for(const g0 of parts){const g=g0.index?g0.toNonIndexed():g0;P.push(...g.attributes.position.array);N.push(...g.attributes.normal.array);U.push(...g.attributes.uv.array);if(g!==g0)g.dispose();g0.dispose();}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));return g;
}

// ── 拍照者：garage-people-v1 的人＋garage-camera-v1 的相機（同多良 duoliang.js 的 createVisitors，只留攝影者：腳固定、上半身繞腰轉向最近車廂，上限 TORSO_LIMIT）。
// 每個零件一個 InstancedMesh；每幀照狀態擺姿勢。多良那份沒有 export，這裡照抄縮小；精修輪可以把兩份抽成共用件。
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),clampTo=(v,l)=>Math.max(-l,Math.min(l,v));
const follow=(cur,target,dt,rate)=>{const d=target-cur,step=d*(1-Math.exp(-dt/TAU)),lim=rate*dt;return cur+Math.max(-lim,Math.min(lim,step));};
const UPPER=n=>n==='head'||n.startsWith('hair-')||n.startsWith('torso-')||n==='acc-backpack'||n==='acc-hat';
const CAMERA_PARTS=['camera-body','camera-top','camera-lens','camera-glass','grip-sleeve-l','grip-sleeve-r','grip-hand-l','grip-hand-r'];
const BOTTOMS=['#384d5b','#3d4450','#6b5a48','#2f3a4c'],SKINS=['#e9c8a8','#d6a987','#b98663','#f1d3b8'],HAIRC=['#2b2320','#4a3426','#1f1f24','#7a5a3a'],ACCENTS=['#c9463d','#2f6f8f','#e0b44c','#3b3b3b'];
function createPhotographers(kits,specs){
 const [people,camera]=kits,group=new THREE.Group();group.name='guanghua-photographers';
 const peopleMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.78}),cameraMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.5,metalness:.1}),meshes=new Map();
 for(const [kit,material] of [[people,peopleMat],[camera,cameraMat]])for(const [name,part] of kit.parts){
  const m=new THREE.InstancedMesh(part.geometry,material,specs.length*(part.perPerson??1));m.name='guanghua-'+name;m.castShadow=m.receiveShadow=true;m.frustumCulled=false;m.count=0;group.add(m);meshes.set(name,{mesh:m,part,n:0});}
 const list=specs.map((sp,i)=>{
  const look={hair:sp.hair,torso:sp.torso,accessory:null,scale:1,top:sp.color,bottom:BOTTOMS[i%4],skin:SKINS[(i*3+1)%4],hairColor:HAIRC[(i*5+2)%4],accent:ACCENTS[i%4]};
  return{...sp,i,look,pv:{look,pose:'stand',walking:false,stride:0,step:1,hand:0},out:[],turn:0,car:-1,slots:{}};});
 const root=new THREE.Matrix4(),sm=new THREE.Matrix4(),rz=new THREE.Matrix4(),tw=new THREE.Matrix4(),world=new THREE.Matrix4(),color=new THREE.Color(),m4=new THREE.Matrix4(),p3=new THREE.Vector3();
 let last=null,seenCount=0;
 function put(v,name,matrix){const e=meshes.get(name),{part}=e;world.multiplyMatrices(root,matrix);e.mesh.setMatrixAt(e.n,world);
  if(part.tint==='fixed')color.setRGB(part.color[0],part.color[1],part.color[2]);else color.set(part.tint==='hair'?v.look.hairColor:v.look[part.tint]);
  e.mesh.setColorAt(e.n,color);(v.slots[name]??=[]).push(e.n);e.n++;}
 // cars：每節車廂的世界座標 [x,y,z]；scale：車模公尺→單位（人跟著車款的比例尺）。
 function update(time,cars,scale=METER){
  const dt=last===null?0:time-last,snap=last===null||dt<0||dt>.5;last=time;
  const seen=[];cars.forEach((c,i)=>{if(Math.abs(c[0])<SEE_X)seen.push({i,x:c[0],y:c[1]});});seenCount=seen.length;
  for(const e of meshes.values())e.n=0;
  for(const v of list){
   v.slots={};let target=0;
   if(seen.length){const d=c=>Math.hypot(c.x-v.x,c.y-v.y);let best=seen[0];for(const c of seen)if(d(c)<d(best))best=c;
    const keep=seen.find(c=>c.i===v.car);if(keep&&d(keep)<=d(best)*1.04)best=keep;v.car=best.i;
    target=wrap(Math.atan2(best.y-v.y,best.x-v.x)-v.yaw);
    if(Math.abs(target)>Math.PI-.5&&Math.abs(v.turn)>.05)target=Math.sign(v.turn)*Math.abs(target);}else v.car=-1;
   const goal=clampTo(target,TORSO_LIMIT);v.turn=snap?goal:follow(v.turn,goal,dt,TORSO_RATE);
   const s=scale*v.rel;root.makeTranslation(v.x,v.y,v.z).multiply(rz.makeRotationZ(v.yaw)).multiply(sm.makeScale(s,s,s));tw.makeRotationZ(v.turn);
   for(const e of personPose(v.pv,people,v.out)){
    if(e.name==='arm'||e.name==='hand')continue;
    put(v,e.name,UPPER(e.name)?m4.multiplyMatrices(tw,e.matrix):e.matrix);}
   for(const name of CAMERA_PARTS)put(v,name,tw);
  }
  for(const e of meshes.values()){e.mesh.count=e.n;e.mesh.visible=e.n>0;e.mesh.instanceMatrix.needsUpdate=true;if(e.mesh.instanceColor)e.mesh.instanceColor.needsUpdate=true;}
 }
 // 讀回實際畫出來的東西（各零件實例矩陣×零件幾何的八個角）：驗收用，不重算公式。
 function inspect(){
  return list.map(v=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],parts={};
   for(const [name,ks] of Object.entries(v.slots)){const e=meshes.get(name),b=e.part.geometry.boundingBox,pz=parts[name]={minZ:Infinity,maxZ:-Infinity};
    for(const kk of ks){e.mesh.getMatrixAt(kk,m4);for(let c=0;c<8;c++){p3.set(c&1?b.max.x:b.min.x,c&2?b.max.y:b.min.y,c&4?b.max.z:b.min.z).applyMatrix4(m4);for(let a=0;a<3;a++){min[a]=Math.min(min[a],p3.getComponent(a));max[a]=Math.max(max[a],p3.getComponent(a));}pz.minZ=Math.min(pz.minZ,p3.z);pz.maxZ=Math.max(pz.maxZ,p3.z);}}}
   return{i:v.i,kind:'photographer',pos:[v.x,v.y,v.z],rel:v.rel,bodyYaw:v.yaw,turn:v.turn,car:v.car,bbox:{min,max},parts};});
 }
 return{group,update,inspect,get seen(){return seenCount;},count:list.length,dispose(){for(const {mesh} of meshes.values())mesh.dispose();peopleMat.dispose();cameraMat.dispose();group.clear();}};
}

// ── 機車路線與時刻表（本輪自訂）。巷子中線 C(q)：由前緣（−y）直行進涵洞，出洞後在 kink 前用圓弧右彎 TH 接後段直線；車身在行進方向右側偏 LANE（靠右行駛）。
// 前進（往 +y）與返程（往 −y）各一張表：位置 (x,y)、路徑長 s、抵達時間 tt；速度是「離涵洞中心的路徑距離」的 smoothstep 函數（洞前後與洞內約 15 km/h、遠處 25 km/h）。
// 機車位置只由時間決定（純函數）：第 n 圈本線車心經過 x＝0 的時刻＝機車經過涵洞中心，偶數圈往 +y、奇數圈往 −y。兩端各多留 PAD 單位在剪裁面外，起訖時整台都被切掉。
const kmh=v=>v/3.6*METER; // 真實時速（km/h）→ 單位／秒（機車用結構尺 METER）
function createScooterRun({YC,kinkY,TH,flatEnd,rampLen,ZG,clipY,wheelbase}){
 const u=m=>m*METER,LANE=u(.4),R=u(9),PAD=1.4,STEP=.03,D1=u(12),D2=u(32),V_LO=kmh(15),V_HI=kmh(25),LOOK_Y=-1.8;
 const tg=R*Math.tan(TH/2),ya=kinkY-tg,y0=-(clipY+PAD),L1=ya-y0,La=R*TH,L3=(clipY+PAD-(kinkY+tg*Math.cos(TH)))/Math.cos(TH),U=L1+La+L3;
 const C=q=>{if(q<=L1)return{x:0,y:y0+q,phi:0};if(q<=L1+La){const phi=(q-L1)/R;return{x:R-R*Math.cos(phi),y:ya+R*Math.sin(phi),phi};}const w=q-L1-La;return{x:R*(1-Math.cos(TH))+w*Math.sin(TH),y:ya+R*Math.sin(TH)+w*Math.cos(TH),phi:TH};};
 // 路面高（依實際網格）：洞內瀝青頂 .02、引道斜坡（先讓車輪貼 .02 直到斜坡升過它）、外側地面上的瀝青帶頂 ZG+.012
 const roadZ=y=>{const a=Math.abs(y);return a<=flatEnd?.02:a<YC?Math.max(.02,ZG*(a-flatEnd)/rampLen):ZG+.012;};
 const speedAt=d=>V_LO+(V_HI-V_LO)*smooth((d-D1)/(D2-D1));
 function build(sign){
  const n=Math.ceil(U/STEP),xs=[],ys=[];
  for(let i=0;i<=n;i++){const c=C(Math.min(U,i*STEP)),o=sign*LANE;xs.push(c.x+o*Math.cos(c.phi));ys.push(c.y-o*Math.sin(c.phi));}
  if(sign<0){xs.reverse();ys.reverse();}
  const s=[0];for(let i=1;i<xs.length;i++)s.push(s[i-1]+Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]));
  let ic=0;for(let i=1;i<ys.length;i++)if(Math.abs(ys[i])<Math.abs(ys[ic]))ic=i; // 涵洞中心（y＝0）那一格
  const sc=s[ic],tt=[0];for(let i=1;i<s.length;i++)tt.push(tt[i-1]+(s[i]-s[i-1])/speedAt(Math.abs((s[i]+s[i-1])/2-sc)));
  const find=(arr,v)=>{let lo=0,hi=arr.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(arr[m]<=v)lo=m;else hi=m;}return lo;};
  const at=v=>{v=Math.max(0,Math.min(s[s.length-1],v));const i=find(s,v),f=(v-s[i])/((s[i+1]-s[i])||1);return{x:xs[i]+(xs[i+1]-xs[i])*f,y:ys[i]+(ys[i+1]-ys[i])*f};};
  const sAt=tau=>{tau=Math.max(0,Math.min(tt[tt.length-1],tau));const i=find(tt,tau);return s[i]+(s[i+1]-s[i])*((tau-tt[i])/((tt[i+1]-tt[i])||1));};
  const timeAtY=y=>{for(let i=0;i<ys.length-1;i++)if((ys[i]-y)*(ys[i+1]-y)<=0)return tt[i]+(tt[i+1]-tt[i])*((y-ys[i])/((ys[i+1]-ys[i])||1));return NaN;};
  return{at,sAt,timeAtY,S:s[s.length-1],T:tt[tt.length-1],sc,tc:tt[ic],xs,ys};
 }
 const F=build(1),B=build(-1),P=LAP/SPEED,t0=-PHASE/SPEED; // 圈長（秒）、第 0 圈車心經過 x＝0 的時刻
 const dirOf=n=>((n%2)+2)%2===0?1:-1;
 const plan=t=>{const n=Math.round((t-t0)/P),dir=dirOf(n),D=dir>0?F:B,start=t0+n*P-D.tc,tau=t-start;return{n,dir,D,start,tau,active:tau>0&&tau<D.T};};
 // 某一刻的姿態：兩個輪子各自貼路面（接地點沿路徑相距一個軸距，三維距離＝軸距），原點在兩接地點中點；yaw 朝前接地點、pitch 隨兩點高差。
 function pose(t){
  const p=plan(t);if(!p.active)return{active:false,n:p.n,dir:p.dir,tau:p.tau};
  const D=p.D,s=D.sAt(p.tau);let h=wheelbase,a,b,dz,dh;
  for(let k=0;k<4;k++){a=D.at(s-h/2);b=D.at(s+h/2);dz=roadZ(b.y)-roadZ(a.y);dh=Math.hypot(b.x-a.x,b.y-a.y);h*=wheelbase/Math.hypot(dh,dz);}
  return{active:true,n:p.n,dir:p.dir,tau:p.tau,s,x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(roadZ(a.y)+roadZ(b.y))/2,psi:Math.atan2(b.y-a.y,b.x-a.x),theta:Math.atan2(dz,dh),speed:speedAt(Math.abs(s-D.sc)),rear:{...a,z:roadZ(a.y)},front:{...b,z:roadZ(b.y)}};
 }
 // 「看涵洞」的目標時刻：下一次機車經過洞口內側 y＝LOOK_Y（此時車心在 x＝0 附近，列車在洞上）。
 const lookTime=now=>{const n0=Math.ceil((now-t0)/P)-1;for(let n=n0;n<n0+4;n++){const D=dirOf(n)>0?F:B,tt=t0+n*P-D.tc+D.timeAtY(LOOK_Y);if(tt>=now-1e-6)return tt;}return now;};
 return{pose,plan,lookTime,roadZ,speedAt,F,B,period:P,t0,LANE,LOOK_Y,clipY,PAD,length:U};
}

export function createScene(kits=null){
 const k=createKit(),{group,mat,block,props,instance}=k,u=m=>m*METER;
 const HW=u(DIM.W)/2,ZS=u(DIM.H),ZD=u(DIM.DECK),ZB=u(DIM.BEAM),ZG=u(DIM.DIP),HB=u(DIM.BANK)/2,YT=u(DIM.SPACING)/2;
 const WT=u(DIM.WALL_T),CUT=u(DIM.CUT),FLAT=u(DIM.FLAT),YC=HB+CUT,AB=u(DIM.ABUT),CX=HW+AB+WT,BT=u(DIM.BEAM_T),AH=u(DIM.ALLEY)/2;
 const RAIL_Z=ZD+STACK,WIRE_Z=RAIL_Z+1.95; // 電車線離軌頂 1.95：與 crossing／高架同一個高度，集電弓伸得到
 const X=27,Y=23.6; // 地面層比底座薄板內縮一點，圓角才不會被方塊角戳出去；第二輪把底座由 76 縮成 54 寬（主對話判讀：全景取景才能拉近到洞口與擋土牆看得清楚、又不裁到底座）
 // 材質：名字給驗收腳本（淨空、比例）辨認結構角色；房子與道具用 props 自己的材質。
 const concrete=mat('#5d5e59',{name:'concrete'}),stain=mat('#262523',{name:'stain'}),streak=mat('#94643f',{name:'streak'}),paving=mat('#a9a495',{name:'ground'}),asphalt=mat('#51534f',{name:'asphalt'}),asphaltIn=mat('#1f201e',{name:'asphalt'}); // r6：洞內再壓暗（照片的洞口近乎全黑，評審量到開口區亮度中位數照片 20、截圖 68） // 照片比對輪：混凝土調深、洞內水漬改成深色與鏽色（依照片）；第二輪再壓暗：洞內近乎黑、洞口是亮框，路面是深灰瀝青（主對話依照片估計）
 const wall=mat('#4b4a45',{name:'retaining-wall'}),wstain=mat('#6e4a30',{name:'retaining-wall-stain'}),abut=mat('#7a663b',{name:'retaining-wall-abutment'}),rust=mat('#5a4527',{name:'retaining-wall-rust'}); // r6：緊貼洞口的橋台正面改鏽黃（照片裡約 RGB 150,128,72）＋暗褐直向鏽流；翼牆改暗灰（照片裡橋台與卵石錐坡之間是一條暗灰帶）。顏色是主對話依照片估計 // 引道翼牆（照片裡洞口兩旁那段帶鏽的混凝土）與牆上的鏽水痕：名字以 retaining-wall 開頭，驗收用名字認
 const pole=mat('#3b4140',{name:'pole'}),trough=mat('#8d8b84',{name:'trough'}),hanger=mat('#bbb8a8',{name:'hanger'}),wire=mat('#4a5150',{name:'wire'});

 // ── 底座：三層薄板，頂面 z=0＝涵洞內的路面（同 crossing 的做法）。
 k.slab('#665440',54,48,-1.35,.35,0);k.slab('#b49c75',53.6,47.6,-1,.6,0);k.slab('#8f9a7c',53,47,-.4,.4,0);
 // ── 外側地面（比涵洞路面高 DIP）：切口兩旁與前後兩片。
 for(const s of [-1,1]){
  block(paving,[2*X,Y-YC,ZG],[0,s*(YC+Y)/2,ZG/2]);
  for(const sx of [-1,1])block(paving,[X-CX,YC-HB,ZG],[sx*(CX+X)/2,s*(HB+YC)/2,ZG/2]);
 }
 // ── 路堤＋涵洞：兩側實心塊（涵洞的側牆就是它們的內面），洞頂是橋面板。
 for(const sx of [-1,1])block(concrete,[X-HW,2*HB,ZD],[sx*(HW+X)/2,0,ZD/2]);
 block(concrete,[2*HW,2*HB,ZD-ZS],[0,0,(ZD+ZS)/2]);
 // 【照片比對】洞口立面由下往上（依使用者 09-30 貼的兩張照片估計）：黃黑斜紋警示梁（ZS～ZB，寬＝洞寬＋兩側各 .9 m）→ 淺灰鋼梁翼板（ZB～ZF，寬 9.2 m，在下面的細節網格）
 //   → 灰色混凝土護欄（橋面 ZD 起到 ZP，整條路堤長；翼板以外、錐坡頂 ZB 以上露出來）。護欄頂比軌頂略高，從人眼高度看只露出車底。
 //   第二輪那層「擋土牆面板＋扶壁＋壓頂」拿掉：照片裡洞口兩旁是卵石錐坡與草坡，不是整面直立的牆（主對話判讀）。
 const ZF=u(DIM.FLANGE),ZP=u(DIM.PARAPET),PT=u(DIM.PARAPET_T);
 const beamW=u(DIM.W+1.1),BX=-u(.3),beamH=ZB-ZS, // r6：斜紋上的圓牌移到 x＝+.3 m（照片二在開口寬的 57％ 處，主對話依照片估計）
  beamTex=warningFace(beamW,beamH,(u(.3)-(BX-beamW/2))/beamW),beamMat=new THREE.MeshStandardMaterial({map:beamTex,roughness:.85});k.ownMaterial(beamMat);beamMat.name='warning-beam';
 for(const s of [-1,1]){
  block(concrete,[beamW,BT,beamH],[BX,s*(HB-BT/2),(ZB+ZS)/2]); // 第二輪：斜紋梁左邊多伸 .85 m、右邊 .25 m（照片二的斜紋帶蓋過左橋台，主對話依照片估計）
  const face=k.mesh(new THREE.PlaneGeometry(beamW,beamH),beamMat,[BX,s*(HB+.004),(ZB+ZS)/2]);face.rotation.set(Math.PI/2,s>0?Math.PI:0,0);face.castShadow=false;face.name='warning-face';
  block(concrete,[2*X,PT,ZP-ZD],[0,s*(HB-PT/2),(ZP+ZD)/2]);
 }
 const rnd=k.rand;
 // 洞內路面（瀝青）＋翼牆＋引道斜坡。翼牆截面：貼路堤那端高 WALL_H，往外斜降到外側地面高 ZG。
 const flatEnd=HB+FLAT,rampLen=YC-flatEnd;
 block(asphaltIn,[2*HW,2*HB,.02],[0,0,.01]); // 第二輪：洞頂下那段路面另用深色瀝青（照片裡洞內近乎黑）；洞口外到斜坡起點照舊
 for(const s of [-1,1])block(asphalt,[2*(HW+AB),flatEnd-HB,.02],[0,s*(HB+flatEnd)/2,.01]);
 const wingGeo=profile(k,[[0,0],[0,u(DIM.WALL_H)],[CUT,ZG],[CUT,0]],WT),rampGeo=profile(k,[[0,0],[rampLen,0],[rampLen,ZG]],2*(HW+AB));
 for(const s of [-1,1]){
  for(const sx of [-1,1])instance(wingGeo,wall,[sx*(HW+AB+WT/2),s*HB,0],[1,1,1],[0,0,s>0?0:Math.PI]);
  // 【r6】橋台正面：貼洞口平面、從切口底到斜紋梁底的鏽黃面，加 4 條暗褐直向鏽流（照片二左 33–38％、右 77–87％ 寬那兩面，主對話依照片估計）
  for(const sx of [-1,1]){block(abut,[AB,.006,ZS],[sx*(HW+AB/2),s*(HB+.003),ZS/2]);
   for(let i=0;i<3;i++){const w=.012+rnd()*.012,h=ZS*(.5+rnd()*.3);block(rust,[w,.008,h],[sx*(HW+AB*(.2+.3*i+rnd()*.1)),s*(HB+.004),ZS-h/2]);}}
  instance(rampGeo,asphalt,[0,s*flatEnd,0],[1,1,1],[0,0,s>0?0:Math.PI]);
 }
 // 水漬：從邊緣往下的深淺條紋，貼在洞內側牆與翼牆（同一顆種子，每次一樣）；翼牆內面（朝巷子）加鏽水痕（照片比對輪新增，依照片）。
 for(const sx of [-1,1])block(stain,[.0015,2*HB,ZS],[sx*(HW-.00075),0,ZS/2]); // 照片比對輪：洞內側牆整面貼深色（照片裡洞內明顯比洞外暗；沿用水漬材質，不多 draw call）
 block(stain,[2*HW,2*HB,.0015],[0,0,ZS-.00075]); // 第二輪：洞頂也貼深色
 for(const sx of [-1,1])for(let i=0;i<14;i++){const w=.03+rnd()*.07,h=.2+rnd()*.5,y=(rnd()*2-1)*(HB-.15);block(rnd()<.7?stain:streak,[.006,w,h],[sx*(HW-.002),y,ZS-h/2]);}
 for(const s of [-1,1])for(const sx of [-1,1])for(let i=0;i<5;i++){const y=s*(HB+.2+rnd()*(CUT-.5)),top=ZG+(u(DIM.WALL_H)-ZG)*(1-(Math.abs(y)-HB)/CUT)-.03,w=.04+rnd()*.06,h=.15+rnd()*.3;block(wstain,[.006,w,Math.min(h,top-.05)],[sx*(CX+.002),y,top-Math.min(h,top-.05)/2]);}
 for(const s of [-1,1])for(const sx of [-1,1])for(let i=0;i<8;i++){const y=s*(HB+.05+rnd()*(CUT*.55)),top=ZG+(u(DIM.WALL_H)-ZG)*(1-(Math.abs(y)-HB)/CUT)-.02,w=.05+rnd()*.1,h=Math.min(top-.05,.3+rnd()*.5);block(rnd()<.75?wstain:stain,[.006,w,h],[sx*(HW+AB-.002),y,top-h/2]);}
 // 涵洞外的巷子：外側地面上的瀝青帶。照片比對輪曾把後段的右彎拉直（TH＝0，依 OSM 光華街出洞後直行約 70 m，主對話判讀），r7 改成 7° 緩右彎（理由見 TH 那行）。
 // 機車路線與後段房子都照彎道（kink、TH）算，L2 鋪到底座後緣 Y。
 // 【r6】洞口前（−y，照片角度那一側）的巷子收窄成 x∈[FL,FR]：兩張照片的畫面底邊，路只從左紅線左邊約 .5 m 鋪到右紅線（主對話依照片與機位擬合估計），其餘是草。
 const FL=-u(1.7),FR=u(.6);
 block(asphalt,[FR-FL,Y-YC,.012],[(FL+FR)/2,-(YC+Y)/2,ZG+.006]);
 // 【r7】後段改成緩右彎 7°：r6 評審量到照片一（B）遠處的路往右彎、消失點約在 57％ 寬，TH＝0 的截圖路盡頭在 25–39％ 寬；主對話以 B 機位實量水平視角 24° 換算兩者約差 6–7°，取 7°。先試的 35° 讓洞口正前方被轉角房子擋成死巷（r7 評審：照片 A 第 7 項 0 分）。
 const L1=u(6),TH=7*Math.PI/180,kink=[0,YC+L1],L2=(Y-.01-kink[1]-AH*Math.sin(TH))/Math.cos(TH); // 斜的那段鋪到遠端外角剛好碰到底座後緣 Y（第一輪 TH＝35° 時約 20.2）
 block(asphalt,[2*AH,L1,.012],[0,YC+L1/2,ZG+.006]);
 block(asphalt,[2*AH,L2,.012],[kink[0]+Math.sin(TH)*L2/2,kink[1]+Math.cos(TH)*L2/2,ZG+.006],[0,0,-TH]);

 // ── 鐵道：兩股，雙線，車從上面過。軌道用 kit 的 track()；路徑 z＝軌頂高。
 const track=y=>({length:LAP,trackStart:-X,trackLength:2*X,sample:s=>({x:s,y,z:RAIL_Z,heading:0})});
 const path=track(-YT),farTrack=track(YT),opposingPath={...farTrack,sample:s=>({x:-s,y:YT,z:RAIL_Z,heading:Math.PI})};
 k.track(path);k.track(farTrack);
 // 橋面兩側電纜槽（依照片）。
 for(const s of [-1,1])block(trough,[2*X,.10,.12],[0,s*(HB-.09),ZD+.06]);
 // ── 電車線：門型架（兩側桿＋橫梁），x 不落在涵洞上方，洞口視線才乾淨；線與吊架跟兩股軌道對位。
 const MAST=HB-.08,beamZ=RAIL_Z+2.53;
 for(const x of [-24,-12,12,24]){
  for(const s of [-1,1])block(pole,[.1,.1,beamZ-ZD+.04],[x,s*MAST,ZD+(beamZ-ZD+.04)/2]);
  block(pole,[.1,2*MAST,.08],[x,0,beamZ]);
  for(const y of [-YT,YT])block(hanger,[.06,.06,beamZ-WIRE_Z],[x,y,(beamZ+WIRE_Z)/2]);
 }
 for(const y of [-YT,YT])block(wire,[2*X,.025,.025],[0,y,WIRE_Z]);
 for(const y of [-YT,YT])block(wire,[2*X,.012,.012],[0,y,WIRE_Z+.45]); // 第二輪：每股加一條細承力索（照片裡車頂上方是 3～4 條細線，主對話判讀）

 // ── 透天厝（props.townhouse；facing 是正面朝向，0 朝 −y）。洞口前（−y 側）是空地：|x|<PX 從切口盡頭一路到底座前緣不蓋房子，房子退到空地兩側各兩排（內排面向空地、外排背對它）；
// 洞口後（+y 側）照舊夾著巷子，後端的房子跟著巷子右彎轉角度。
 const hz=ZG,tints=[0,1,2,3,4],roofs=['tin','pitched','parapet','tin'],grounds=['plain','shop','plain','arcade'];
 let hi=0;
 const houseList=[];
 const house=(x,y,facing,o={})=>{const i=hi++;houseList.push({i,x,y,facing,floors:o.floors??(2+(i%2))});props.townhouse(x,y,hz,{floors:o.floors??(2+(i%2)),width:o.width??2.6,depth:o.depth??3.2,tint:o.tint??tints[(i*3)%5],facing,roof:o.roof??roofs[i%4],ground:o.ground??grounds[(i+1)%4],balcony:i%3?'rail':'cage',tanks:1,back:true});};
 const PX=7; // 空地半寬（單位；本輪自訂：看涵洞鏡頭視野半寬約 3.6，再留餘裕；斜 ±20° 看洞口的視線在到底座前緣時側移約 8.4，所以內排只蓋到 y≈-17）
 // 房子從洞口前 6 單位以外才開始蓋：全景鏡頭抬高 26° 看，近處的房子會把後面的路堤正面整段擋住（本輪自訂）。
 for(let i=0;i<5;i++){const y=-(YC+6+i*2.7);if(i<3){house(-(PX+1.6),y,Math.PI/2);house(PX+1.6,y+.3,-Math.PI/2);}house(-(PX+4.8),y,-Math.PI/2);house(PX+4.8,y+.3,Math.PI/2);}
 // 照片比對輪：洞口正後方這四棟改成兩層平頂（照片裡列車上方只有天空；三層與斜屋頂會從車頂上冒出來，主對話判讀）。
 house(-2.45,YC+1.4,Math.PI/2,{floors:2,roof:'tin'});house(2.45,YC+1.4,-Math.PI/2,{floors:2,roof:'parapet'});house(-5.65,YC+1.4,-Math.PI/2,{floors:2,roof:'tin'});house(5.65,YC+1.4,Math.PI/2,{floors:2,roof:'parapet'});
 for(let i=0;i<6;i++){const s=1.6+i*2.7,cx=kink[0]+Math.sin(TH)*s,cy=kink[1]+Math.cos(TH)*s,ln=[-Math.cos(TH),Math.sin(TH)],rn=[Math.cos(TH),-Math.sin(TH)];
  const o={floors:2,roof:i%2?'tin':'parapet'}; // 照片比對輪：兩層平頂（照片角度看過去，三層與斜屋頂會從列車上方冒出來；主對話判讀）
  // r7：彎道後左側第一棟（i＝0 的左側）改淡綠牆、一樓不做店面玻璃（r7 評審描述照片一（B）出口「左邊的粉紅、黃綠房子沿著路排」，選淡綠是主對話判讀）
  house(cx+ln[0]*2.45,cy+ln[1]*2.45,Math.PI/2-TH,i?o:{...o,tint:4,ground:'plain'});house(cx+rn[0]*(2.45+(i<1?1.6:0)),cy+rn[1]*(2.45+(i<1?1.6:0)),-Math.PI/2-TH,o);}
 // 洞口後、路堤兩側外側地面上各放一棟量體，擋住空曠的路堤腳（洞口前那兩棟拿掉了，那裡是空地）。
 for(const [x,y,f,fl] of [[-9.8,YC+.9,Math.PI,2],[9.8,YC+.9,Math.PI,3]])house(x,y,f,{floors:fl,width:3.4,depth:3.0});
 // ── 周邊補景（本輪自訂）：後側（+y）路堤外沿排低矮方塊當市街背景；前側（−y）只種行道樹——前側不放高過路堤的東西，低角度才看得到路堤面。
 const fill=['#cbc3ad','#b9c1b3','#d6bfa6','#adb9b8'].map(c=>mat(c,{name:'filler'}));
 for(const sx of [-1,1])for(let i=0;i<3;i++){
  const w=3.2+(i%3)*.5,d=2.4+((i+1)%3)*.5,h=u(6.2+((i*2)%3)*2.6),x=sx>0?14+i*4.4:-14-i*4.4,y=HB+2.6+d/2+(i%2)*1.4;
  block(fill[(i+(sx>0?2:0))%4],[w,d,h],[x,y,ZG+h/2]);
 }
 // 行道樹：空地邊緣幾棵（|x|≥5.5，在看涵洞鏡頭視野外）、兩排房子外側幾棵。
 for(const [x,y,h] of [[-6,-8.6,2.4],[6.1,-13.4,2.1],[-6.1,-18.9,2.5],[6,-6.4,2.2],[-16.5,-8,2.4],[18.5,-9,2.6],[-23,-12,2.2],[23.5,-7,2.4]])props.broadleaf(x,y,ZG,h);
 // ── 夜燈（本輪自訂）：點光源只用 3 盞——涵洞頂 1 盞（照洞內路面）、空地路燈 2 盞（立在洞口前空地兩側、不擋看涵洞鏡頭）；燈泡是自發光材質，由 kit 的 illumination 統一調亮（夜 1、夕 .35、日 0）。
 // 不加光池圓盤：每盞燈都已有真的點光源，底下再疊圓盤會重複；燈桿沿用電車線桿的材質（同一批實例，不多 draw call）。
 const bulb=mat('#fff0cb',{emissive:'#ffd696',name:'lamp-bulb'});k.glowing.push(bulb);
 const lamps=[],lampSpots=[];
 const addLight=(x,y,z,peak,dist,name,decay=2)=>{const l=new THREE.PointLight('#ffd8a3',0,dist,decay);l.position.set(x,y,z);l.name=name;group.add(l);lamps.push({light:l,peak});lampSpots.push({name,x,y,z,peak,dist,decay});};
 block(bulb,[.22,.1,.03],[0,0,ZS-.015]);addLight(0,0,ZS-.09,5.5,4.2,'culvert-lamp',1); // 涵洞頂燈：貼在洞頂板下緣、洞中央。本輪自訂：衰減取 1（非物理的 2），模擬沿洞頂的長燈管——10 m 長的洞只准 1 盞點光源，衰減 2 照不到兩端洞口
 for(const [x,y,dir] of [[-4.4,-7.6,1],[4.6,-11.4,-1]]){const H=u(4.8),hx=x+dir*.36;block(pole,[.05,.05,H],[x,y,ZG+H/2]);block(pole,[.4,.04,.04],[x+dir*.2,y,ZG+H]);block(bulb,[.2,.1,.025],[hx,y,ZG+H-.03]);addLight(hx,y,ZG+H-.08,12,7.5,'street-lamp');} // 路燈：桿高 4.8 m、懸臂朝巷子

 // ── 【照片比對】洞口周邊細節（依使用者 09-30 貼的兩張照片；位置與尺寸是主對話依照片估計）：全部併成一個網格、共用一張貼圖（detailAtlas），只多一次 draw call。
 //   ・草坡：路堤正反兩面、翼牆以外整條，由錐坡頂 ZB 以 1:1 斜降到外側地面（照片裡路堤面是斜坡，不是直牆）。
 //   ・卵石錐坡：翼牆外側 7 m，貼在草坡上（深灰砂漿＋橘褐卵石，頂緣靠洞口平、往外四分之一橢圓降到坡腳）。
 //   ・淺灰鋼梁翼板（斜紋梁上方）、巷子兩側紅線（洞內、引道、洞外到底座緣）、洞口前兩側草地與草叢、左上角坡頂的灌木。
 //   ・洞口左邊黃黑桿上的圓形限高牌、右邊黃黑桿上的反光鏡與藍白路牌、路堤頂護欄上的黃色欄杆。
 //   照片裡的拒馬、交通錐不做：使用者 09-30 交代「請忽略照片中的維修圍籬之類的物件」。
 const atlas=detailAtlas(seeded(71)),parts=[],m4=new THREE.Matrix4(),qt=new THREE.Quaternion(),e3=new THREE.Euler();
 const put=(g,pos,rot=[0,0,0],scale=[1,1,1])=>{g.applyMatrix4(m4.compose(new THREE.Vector3(...pos),qt.setFromEuler(e3.set(...rot)),new THREE.Vector3(...scale)));parts.push(g);return g;};
 const paint=(g,name)=>{const [su,sv]=atlas.swatch[name],uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,su,sv);return g;};
 const fitUV=(g,[u0,v0,u1,v1])=>{const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,u0+uv.getX(i)*(u1-u0),v0+uv.getY(i)*(v1-v0));return g;};
 const boxG=(name,size,pos,rot)=>put(paint(new THREE.BoxGeometry(...size),name),pos,rot);
 const SL=ZB-ZG,LC=u(5); // 第二輪錐坡由 7 m 縮成 5 m（照片二左側錐坡約 5 m 就降到坡腳，主對話依照片估計） // 草坡水平長（1:1）、錐坡沿路堤長
 for(const s of [-1,1])for(const sx of [-1,1]){
  const g=new THREE.ExtrudeGeometry(new THREE.Shape([[0,0],[0,ZB],[SL,ZG],[SL,0]].map(([y,z])=>new THREE.Vector2(y,z))),{depth:X-CX,bevelEnabled:false});
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0)));g.translate(-(X-CX)/2,0,0);
  put(paint(g,'grass'),[sx*(CX+X)/2,s*HB,0],[0,0,s>0?0:Math.PI]);
  // 錐坡：草坡面上方沿法線 (0,s,1)/√2 抬 .012 的一片四邊形；貼圖左緣＝靠洞口那端、上緣＝坡頂
  const o=.012/Math.SQRT2,[u0,v0,u1,v1]=atlas.uvRect('stone'),x0=sx*CX,x1=sx*(CX+LC),yT=s*(HB+o),yB=s*(HB+SL+o),zT=ZB+o,zB=ZG+o;
  const P=[[x0,yT,zT],[x1,yT,zT],[x1,yB,zB],[x0,yB,zB]],U=[[u0,v1],[u1,v1],[u1,v0],[u0,v0]],n=new THREE.Vector3().subVectors(new THREE.Vector3(...P[1]),new THREE.Vector3(...P[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...P[2]),new THREE.Vector3(...P[0])));
  const idx=n.z>0?[0,1,2,0,2,3]:[0,2,1,0,3,2],c=new THREE.BufferGeometry();
  c.setAttribute('position',new THREE.Float32BufferAttribute(idx.flatMap(i=>P[i]),3));c.setAttribute('uv',new THREE.Float32BufferAttribute(idx.flatMap(i=>U[i]),2));c.computeVertexNormals();parts.push(c);
 }
 for(const s of [-1,1])boxG('flange',[u(9.2),.07,ZF-ZB],[0,s*HB,(ZB+ZF)/2]);
 const RX=u(1.2),RW=u(.04),RT=.004,ramp=Math.atan2(ZG,rampLen),rl=Math.hypot(rampLen,ZG); // r6：線寬 .1 → .04 m（評審：截圖紅線粗了約 2.5 倍）
 for(const sx of [-1,1]){const x=sx<0?-RX:u(.5); // r6：右紅線由 +1.2 移到 +.5（兩張照片的右紅線都在洞口寬約 2／3 處，主對話依照片估計）
  boxG('red',[RW,2*flatEnd,RT],[x,0,.02+RT/2]);
  for(const s of [-1,1]){boxG('red',[RW,rl,RT],[x,s*(flatEnd+rampLen/2),ZG/2+RT/2+.001],[s*ramp,0,0]);boxG('red',[RW,Y-YC,RT],[x,s*(YC+Y)/2,ZG+.012+RT/2]);}
 }
 for(const sx of [-1,1]){ // 洞口前（−y，看涵洞鏡頭那一側）兩側草地
  boxG('grass2',[u(5.5),YC-HB-SL+.02,.008],[sx*(CX+u(5.5)/2),-(HB+SL+YC)/2,ZG+.004]);
  const e=sx<0?-FL:FR,gw=AH+.03+u(6)-e-.02; // r6：草從收窄後的路緣鋪起，外緣照舊在離中線 AH＋6 m（再往外是路燈量光點所在的鋪面，驗收 V6 用）
  boxG('grass2',[gw,u(16),.008],[sx*(e+.02+gw/2),-(YC+u(8)),ZG+.004]);
  for(const s of [-1,1]){const ee=s<0?e:AH,cw=HW+AB-ee,cx=sx*(ee+cw/2); // r6：切口內也只留巷子，路緣到翼牆鋪草（照片裡洞口前兩側一路是草叢；洞後照舊接 ALLEY 寬）
   boxG('grass2',[cw,flatEnd-HB,.008],[cx,s*(HB+flatEnd)/2,.024]);
   boxG('grass2',[cw,rl,.008],[cx,s*(flatEnd+rampLen/2),ZG/2+.006],[s*ramp,0,0]);}
 }
 const bush=(x,y,z,r,c='bush')=>put(paint(new THREE.IcosahedronGeometry(1,1),c),[x,y,z],[0,0,0],[r,r,r*.75]);
 const dX=CX-.83; // 第二輪洞口加寬，洞口前與坡頂的草叢跟著翼牆外移（原座標是 CX＝.83 時定的）
 for(const [x,y,r,c] of [[-1.15,-3.45,.2,'bush2'],[-1.5,-3.2,.16,'bush'],[1.05,-3.5,.18,'bush2'],[1.45,-3.35,.2,'bush'],[-2.3,-3.15,.17,'bush2'],[2.2,-3.2,.15,'bush']])bush(x+Math.sign(x)*dX,y,ZG+r*.3,r,c);
 for(const [x,d,r] of [[-2.1,.2,.3],[-2.6,.15,.38],[-3.1,.12,.42],[-3.7,.2,.36]])bush(x-dX,-(HB+d),ZB-d+r*.3,r,'bush');
 for(const [x,y,r] of [[1.75,.8,.34],[2.15,1.05,.28],[1.45,1.1,.24]])put(paint(new THREE.IcosahedronGeometry(1,1),'bush2'),[u(x),-(HB+u(y)),.02+u(r)*.5],[0,0,0],[u(r)*.8,u(r)*.8,u(r)*1.3]); // r6：洞口右前方一叢高草（照片一右下 88–100％ 寬的芒草、照片二反光鏡桿腳的草叢；位置是主對話依照片估計）
 const PY=-(HB+u(1.2)),PZ=.02,poleG=(x,top)=>put(fitUV(new THREE.CylinderGeometry(u(.04),u(.04),top-PZ,10,1,true),atlas.uvRect('pole')),[x,PY,(PZ+top)/2],[Math.PI/2,0,0]); // r6：兩根桿立在切口平段（洞口前 1.2 m、路面 PZ），不再浮在外側地面高
 const LX=-u(2.75),MX=u(2.05); // r6：依機位擬合反推（照片二限高牌在 29–33％ 寬、反光鏡 78–86％ 寬；照片一反光鏡被右緣切一半），主對話依照片估計
 const SZ=u(1.55),MZ=u(1.75); // 第二輪：牌面與鏡面降低（照片二裡圓牌在斜紋帶高度、反光鏡在翼板高度，主對話依照片估計）
 poleG(LX,ZG+SZ+u(.25));put(fitUV(new THREE.CylinderGeometry(u(.25),u(.25),u(.03),24),atlas.uvRect('sign')),[LX,PY-u(.05),ZG+SZ]); // r6：牌面半徑 .32 → .25 m（評審：比照片大 1.3 倍） // 限高牌（照片看不清字，不寫字）
 poleG(MX,ZG+MZ);
 put(paint(new THREE.CylinderGeometry(u(.4),u(.4),u(.05),24),'rim'),[MX,PY-u(.07),ZG+MZ],[.15,0,-.35]); // 反光鏡：橘框＋鏡面，微朝巷子、略朝下
 put(paint(new THREE.CylinderGeometry(u(.36),u(.36),u(.06),24),'mirror'),[MX-u(.004),PY-u(.08),ZG+MZ],[.15,0,-.35]);
 boxG('blue',[u(.32),u(.03),u(.5)],[MX,PY-u(.06),ZG+u(1.03)]);boxG('white',[u(.28),u(.03),u(.36)],[MX,PY-u(.06),ZG+u(.58)]);
 {const f=Math.PI/2-TH,n=[Math.sin(f),-Math.cos(f)],t=[Math.cos(f),Math.sin(f)],h=houseList.find(h=>h.facing===f),c=[h.x+n[0]*1.6,h.y+n[1]*1.6]; // r7：彎道後左側第一棟正面的藍招牌與兩叢盆栽（r6 評審描述照片一（B）左側立面「綠色植物、藍招牌、黃綠牆」，位置與大小是主對話依照片估計）
  boxG('blue',[1.1,.03,.32],[c[0]+n[0]*.03-t[0]*.45,c[1]+n[1]*.03-t[1]*.45,ZG+.95],[0,0,f]);
  for(const a of [-1.05,.95])bush(c[0]+n[0]*.2+t[0]*a,c[1]+n[1]*.2+t[1]*a,ZG+.05,.18,'bush2');}
 const RH=u(.95),RP=u(1.6); // 路堤頂護欄上的黃色欄杆（照片二右上角是黃色欄杆、左上角是灌木，所以只放 +x 側，兩面都放；主對話判讀）
 for(const s of [-1,1])for(const sx of [1]){const a=CX+u(4),b=X-.3,y=s*(HB-u(.12));
  for(let x=a;x<=b+1e-6;x+=RP)boxG('yellow',[.03,.03,RH],[sx*x,y,ZP+RH/2]);
  for(const h of [RH,RH*.5])boxG('yellow',[b-a,.022,.022],[sx*(a+b)/2,y,ZP+h]);
 }
 const detailMat=new THREE.MeshStandardMaterial({map:atlas.texture,roughness:.9,alphaTest:.5,side:THREE.DoubleSide});detailMat.name='photo-detail';k.ownMaterial(detailMat);
 k.mesh(mergeParts(parts),detailMat).name='photo-details';
 k.bake();

 // ── 拍照者：洞口前空地上三位（站在切口盡頭外、偏離巷子軸線，不擋洞口），臉朝涵洞、頭朝列車。位置是本輪自訂（粗模時兩位站在洞裡／引道上，會擋住洞口）。
 // 照片比對輪：三位往兩側移到 |x|≥2.8（主對話判讀：照片角度的鏡頭在巷子中線 10～31 m 外、水平視角 24°，站在 |x|<2.4 會擋在洞口前面；照片裡洞口前沒有人）。
 const aim=(x,y)=>Math.atan2(-HB-y,-x); // 臉朝洞口正中
 const specs=kits?[
  {x:-2.9,y:-(YC+.9),z:ZG,yaw:aim(-2.9,-(YC+.9)),color:'#d8a64e',hair:'short',torso:'jacket',rel:1},
  {x:2.8,y:-(YC+1.6),z:ZG,yaw:aim(2.8,-(YC+1.6)),color:'#5c8f9b',hair:'long',torso:'shirt',rel:.97},
  {x:-3.5,y:-(YC+2.4),z:ZG,yaw:aim(-3.5,-(YC+2.4))+.12,color:'#c05d4a',hair:'short',torso:'shirt',rel:1}
 ]:[];
 const photographers=kits?createPhotographers(kits,specs):null;if(photographers)group.add(photographers.group);
 // ── 機車＋騎士（本輪自訂）：kits[2] 是機車資產（kits[0] 的人零件庫沿用，不重複載）；沒給 kits（Node 端驗收）就不放。前後端用兩個 y 剪裁面在底座緣切掉（同列車在 ±CLIP 的做法）。
 let scooter=null;
 if(kits?.[2]){
  const wb=(kits[2].rig.wheels.front[0]-kits[2].rig.wheels.rear[0])*METER,run=createScooterRun({YC,kinkY:kink[1],TH,flatEnd,rampLen,ZG,clipY:Y,wheelbase:wb});
  const rider=createScooterRider({peopleKit:kits[0],scooterKit:kits[2],scale:METER}),clip=[new THREE.Plane(new THREE.Vector3(0,1,0),Y),new THREE.Plane(new THREE.Vector3(0,-1,0),Y)];
  rider.group.traverse(o=>{if(o.material)for(const m of [].concat(o.material)){m.clippingPlanes=clip;m.clipShadows=true;}});
  rider.group.visible=false;group.add(rider.group);
  scooter={run,rider,group:rider.group,clip,pose:{active:false},last:null,wheelbase:wb};
 }
 let state={};
 return{...k,path,opposingPath,kind:'guanghua',contactWireZ:WIRE_Z-.0125,focus:[0,0,1.2],photographers,scooter,lampSpots,houseList,
  // 尺寸（單位），給視圖／驗收讀；驗收的數字仍以實際網格量，不從這裡抄。
  dims:{HW,HB,ZS,ZD,ZB,ZG,YT,RAIL_Z,WIRE_Z,YC,CX,flatEnd,rampLen,mouthY:HB},
  update(time,period,train={}){const light=k.illumination(period);for(const l of lamps)l.light.intensity=light*l.peak;photographers?.update(time,train.cars??[],train.scale??METER);
   if(scooter){const p=scooter.run.pose(time),g=scooter.group;scooter.pose=p;g.visible=p.active;
    if(p.active){g.position.set(p.x,p.y,p.z);g.rotation.set(0,-p.theta,p.psi,'ZYX');
     if(scooter.last&&scooter.last.n===p.n&&Math.abs(p.s-scooter.last.s)<1)scooter.rider.update(1,p.s-scooter.last.s); // 輪子轉角＝走過距離／半徑（update(dt,speed) 的 dt×speed＝距離）
     scooter.last={n:p.n,s:p.s};}else scooter.last=null;
    scooter.rider.setNight(period!=='day');}
   state={lights:light,photographers:specs.length,watching:photographers?.seen??0,houses:hi,scooter:scooter?{active:scooter.pose.active,trip:scooter.pose.n,dir:scooter.pose.dir,speedKmh:scooter.pose.active?scooter.pose.speed/METER*3.6:0,night:scooter.rider.state.night}:null};},
  get state(){return state;},inspect:()=>photographers?.inspect()??[],
  dispose(){beamTex.dispose();atlas.texture.dispose();k.dispose();photographers?.dispose();scooter?.rider.dispose();}};
}

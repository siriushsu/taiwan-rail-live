import * as THREE from '../vendor/three.module.js';
import {createKit} from './new-scene-kit.js';
import {personPose} from '../garage-people.js?revision=people-0927';
import {METER,UNIT_PER_M,TORSO_LIMIT,TORSO_RATE,TAU,SEE_X} from './duoliang.js?revision=stairs-0929';
// 台南光華街涵洞（中西區光華街鐵路橋下）微縮場景・粗模（2026-09-30 第一輪，只做骨架與比例，材質是色塊）。
// 使用者原話（2026-09-30 08:16）：「附近有一個大家都在拍照的地下道 我希望做成一個3D車庫的景」；選項回覆：地下道＝光華街涵洞；時期＝地下化前（車從上面過）。
// 場景概念（主對話判讀，不是使用者原話）：台鐵車在涵洞上方的雙線鐵路橋跑，橋下一條窄巷道壓低穿過涵洞，洞口有人拍照。
// 位置：OSM way 160911822（highway=residential, service=alley, tunnel=yes，長 27.7 m 含引道）；上方縱貫線雙線、電化（OSM 108037248／347019916）。
// 幾何依據（全部「依照片估計」，照片是自由時報 2026-09-12 洪瑞琴〈台南限定倒數！「火車頭頂跑、機車橋下鑽」成最後打卡熱點〉圖一，只線上看、沒下載）：
//   淨高約 2.1 m、淨寬約 3 m 單車道無人行道、穿越長度約 8～10 m（雙線橋面）、灰色清水混凝土翼牆（有水漬）、洞口上緣黃黑斜紋警示梁、正中紅框圓形標誌（推測限高，照片上看不出字，這裡不寫字）、
//   涵洞內路面低於外側平台且遠端向右上彎出、列車底部約高出警示梁 .6～.9 m、橋面兩側電纜槽與電車線桿、周邊是二、三層透天厝。
// 比例（主對話判讀）：列車、人、結構一律真實比例，換算沿用 duoliang.js：結構 1 m ＝ METER 單位（三款車寬的平均），人跟著車款用 UNIT_PER_M（人身高與車高才照著模型的真實比）。
// 下面標「本輪自訂」的數字不是查證來的，是讓幾何自洽的假設；精修輪要重新對照片。
export {METER,UNIT_PER_M};
export const LAP=130,SPEED=2.6,CLIP=35; // 環線長（單位）、巡航速度（單位／秒）、車體被裁掉的 x 界線（同 crossing：整列離景後才循環）
export const THEMES={ // 同高架景那組色（viaduct.js），粗模沿用
 day:{background:'#e7e8e1',sun:'#fff2d4',ambient:'#c6d9e2',ground:'#84936c',power:3.0,exposure:1.04},
 sunset:{background:'#ecd9c6',sun:'#ffb974',ambient:'#d2b9b4',ground:'#74795e',power:2.9,exposure:.94},
 night:{background:'#141f2e',sun:'#9fbfe4',ambient:'#5d7590',ground:'#2b3440',power:.72,exposure:.76}
};
// 幾何規格（公尺）。「依照片估計」的與「本輪自訂」的分開標。
export const DIM={
 W:3.0,        // 涵洞淨寬（依照片估計）
 H:2.1,        // 涵洞淨高（依照片估計）
 BANK:10.0,    // 穿越長度＝路堤頂寬（依照片估計 8～10 m 取上限：kit 的道床每股 5.3 m 寬，兩股要放得下）
 DECK:2.6,     // 橋面頂離涵洞路面（本輪自訂：淨高 2.1＋橋面板厚 .5）
 BEAM:2.95,    // 警示梁頂（本輪自訂：使列車底離梁頂約 .7 m，落在依照片估計的 .6～.9 m）
 BEAM_T:.35,   // 警示梁厚（本輪自訂）
 DIP:.6,       // 涵洞路面比外側低多少（依照片估計「低於外側」，數值本輪自訂）
 CUT:5.2,      // 洞口外的引道切口長（本輪自訂）
 FLAT:1.5,     // 切口裡先平 1.5 m 再爬坡（本輪自訂）
 WALL_T:.3,    // 翼牆厚（本輪自訂）
 WALL_H:2.2,   // 翼牆貼路堤那一端的高，往外斜降到外側地面（本輪自訂）
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
function warningFace(w,h){
 const c=document.createElement('canvas'),W=1024,H=Math.max(64,Math.round(W*h/w));c.width=W;c.height=H;
 const g=c.getContext('2d');g.fillStyle='#dfb63a';g.fillRect(0,0,W,H);
 const p=H*.62; // 一組黃黑的水平週期
 g.fillStyle='#26282a';for(let x0=-H;x0<W+H;x0+=p*2){g.beginPath();g.moveTo(x0,H);g.lineTo(x0+p,H);g.lineTo(x0+p+H,0);g.lineTo(x0+H,0);g.closePath();g.fill();}
 const r=H*.43;g.fillStyle='#f3efe4';g.beginPath();g.arc(W/2,H/2,r,0,Math.PI*2);g.fill();
 g.lineWidth=r*.2;g.strokeStyle='#c4342b';g.beginPath();g.arc(W/2,H/2,r-g.lineWidth/2,0,Math.PI*2);g.stroke();
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
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

export function createScene(kits=null){
 const k=createKit(),{group,mat,block,props,instance}=k,u=m=>m*METER;
 const HW=u(DIM.W)/2,ZS=u(DIM.H),ZD=u(DIM.DECK),ZB=u(DIM.BEAM),ZG=u(DIM.DIP),HB=u(DIM.BANK)/2,YT=u(DIM.SPACING)/2;
 const WT=u(DIM.WALL_T),CUT=u(DIM.CUT),FLAT=u(DIM.FLAT),YC=HB+CUT,CX=HW+WT,BT=u(DIM.BEAM_T),AH=u(DIM.ALLEY)/2;
 const RAIL_Z=ZD+STACK,WIRE_Z=RAIL_Z+1.95; // 電車線離軌頂 1.95：與 crossing／高架同一個高度，集電弓伸得到
 const X=37.6,Y=23.6; // 地面層比底座薄板內縮一點，圓角才不會被方塊角戳出去
 // 材質：名字給驗收腳本（淨空、比例）辨認結構角色；房子與道具用 props 自己的材質。
 const concrete=mat('#a4a199',{name:'concrete'}),stain=mat('#8a8880',{name:'stain'}),streak=mat('#b9b6ac',{name:'streak'}),paving=mat('#a9a495',{name:'ground'}),asphalt=mat('#62665f',{name:'asphalt'});
 const pole=mat('#3b4140',{name:'pole'}),trough=mat('#8d8b84',{name:'trough'}),hanger=mat('#bbb8a8',{name:'hanger'}),wire=mat('#4a5150',{name:'wire'});

 // ── 底座：三層薄板，頂面 z=0＝涵洞內的路面（同 crossing 的做法）。
 k.slab('#665440',76,48,-1.35,.35,0);k.slab('#b49c75',75.6,47.6,-1,.6,0);k.slab('#8f9a7c',75,47,-.4,.4,0);
 // ── 外側地面（比涵洞路面高 DIP）：切口兩旁與前後兩片。
 for(const s of [-1,1]){
  block(paving,[2*X,Y-YC,ZG],[0,s*(YC+Y)/2,ZG/2]);
  for(const sx of [-1,1])block(paving,[X-CX,YC-HB,ZG],[sx*(CX+X)/2,s*(HB+YC)/2,ZG/2]);
 }
 // ── 路堤＋涵洞：兩側實心塊（涵洞的側牆就是它們的內面），洞頂是橋面板，洞口上緣一根黃黑斜紋警示梁。
 for(const sx of [-1,1])block(concrete,[X-HW,2*HB,ZD],[sx*(HW+X)/2,0,ZD/2]);
 block(concrete,[2*HW,2*HB,ZD-ZS],[0,0,(ZD+ZS)/2]);
 const beamW=2*(HW+u(.3)),beamH=ZB-ZS,beamTex=warningFace(beamW,beamH),beamMat=new THREE.MeshStandardMaterial({map:beamTex,roughness:.85});k.ownMaterial(beamMat);beamMat.name='warning-beam';
 for(const s of [-1,1]){
  block(concrete,[beamW,BT,beamH],[0,s*(HB-BT/2),(ZB+ZS)/2]);
  const face=k.mesh(new THREE.PlaneGeometry(beamW,beamH),beamMat,[0,s*(HB+.004),(ZB+ZS)/2]);face.rotation.set(Math.PI/2,s>0?Math.PI:0,0);face.castShadow=false;face.name='warning-face';
 }
 // 洞內路面（瀝青）＋翼牆＋引道斜坡。翼牆截面：貼路堤那端高 WALL_H，往外斜降到外側地面高 ZG。
 const flatEnd=HB+FLAT,rampLen=YC-flatEnd;
 block(asphalt,[2*HW,2*flatEnd,.02],[0,0,.01]);
 const wingGeo=profile(k,[[0,0],[0,u(DIM.WALL_H)],[CUT,ZG],[CUT,0]],WT),rampGeo=profile(k,[[0,0],[rampLen,0],[rampLen,ZG]],2*HW);
 for(const s of [-1,1]){
  for(const sx of [-1,1])instance(wingGeo,concrete,[sx*(HW+WT/2),s*HB,0],[1,1,1],[0,0,s>0?0:Math.PI]);
  instance(rampGeo,asphalt,[0,s*flatEnd,0],[1,1,1],[0,0,s>0?0:Math.PI]);
 }
 // 水漬：從邊緣往下的深淺條紋，貼在路堤兩面、洞內側牆與翼牆外面（同一顆種子，每次一樣）。
 const rnd=k.rand;
 for(const s of [-1,1])for(let i=0;i<26;i++){const sx=rnd()<.5?-1:1,x=sx*(CX+.15+rnd()*5.5),w=.03+rnd()*.07,h=.25+rnd()*.6;block(rnd()<.7?stain:streak,[w,.006,h],[x,s*(HB+.002),ZD-h/2]);}
 for(const sx of [-1,1])for(let i=0;i<14;i++){const w=.03+rnd()*.07,h=.2+rnd()*.5,y=(rnd()*2-1)*(HB-.15);block(rnd()<.7?stain:streak,[.006,w,h],[sx*(HW-.002),y,ZS-h/2]);}
 for(const s of [-1,1])for(const sx of [-1,1])for(let i=0;i<5;i++){const y=s*(HB+.2+rnd()*(CUT-.5)),top=ZG+(u(DIM.WALL_H)-ZG)*(1-(Math.abs(y)-HB)/CUT)-.03,w=.04+rnd()*.06,h=.15+rnd()*.3;block(stain,[.006,w,Math.min(h,top-.05)],[sx*(CX+.002),y,top-Math.min(h,top-.05)/2]);}
 // 涵洞外的巷子：外側地面上的瀝青帶；後端在 L1 之後右彎（遠端向右上彎出，依照片）。
 block(asphalt,[2*AH,Y-YC,.012],[0,-(YC+Y)/2,ZG+.006]);
 const L1=u(6),TH=35*Math.PI/180,L2=19,kink=[0,YC+L1];
 block(asphalt,[2*AH,L1,.012],[0,YC+L1/2,ZG+.006]);
 block(asphalt,[2*AH,L2,.012],[kink[0]+Math.sin(TH)*L2/2,kink[1]+Math.cos(TH)*L2/2,ZG+.006],[0,0,-TH]);

 // ── 鐵道：兩股，雙線，車從上面過。軌道用 kit 的 track()；路徑 z＝軌頂高。
 const track=y=>({length:LAP,trackStart:-35,trackLength:70,sample:s=>({x:s,y,z:RAIL_Z,heading:0})});
 const path=track(-YT),farTrack=track(YT),opposingPath={...farTrack,sample:s=>({x:-s,y:YT,z:RAIL_Z,heading:Math.PI})};
 k.track(path);k.track(farTrack);
 // 橋面兩側電纜槽（依照片）。
 for(const s of [-1,1])block(trough,[2*X,.10,.12],[0,s*(HB-.09),ZD+.06]);
 // ── 電車線：門型架（兩側桿＋橫梁），x 不落在涵洞上方，洞口視線才乾淨；線與吊架跟兩股軌道對位。
 const MAST=HB-.08,beamZ=RAIL_Z+2.53;
 for(const x of [-30,-18,-6,6,18,30]){
  for(const s of [-1,1])block(pole,[.1,.1,beamZ-ZD+.04],[x,s*MAST,ZD+(beamZ-ZD+.04)/2]);
  block(pole,[.1,2*MAST,.08],[x,0,beamZ]);
  for(const y of [-YT,YT])block(hanger,[.06,.06,beamZ-WIRE_Z],[x,y,(beamZ+WIRE_Z)/2]);
 }
 for(const y of [-YT,YT])block(wire,[2*X,.025,.025],[0,y,WIRE_Z]);

 // ── 透天厝：巷子兩側各兩排（props.townhouse）。左排面向 +x、右排面向 −x（facing 是正面朝向，0 朝 −y）；後端的房子跟著巷子右彎轉角度。
 const hz=ZG,tints=[0,1,2,3,4],roofs=['tin','pitched','parapet','tin'],grounds=['plain','shop','plain','arcade'];
 let hi=0;
 const house=(x,y,facing,o={})=>{const i=hi++;props.townhouse(x,y,hz,{floors:o.floors??(2+(i%2)),width:o.width??2.6,depth:o.depth??3.2,tint:tints[(i*3)%5],facing,roof:roofs[i%4],ground:grounds[(i+1)%4],balcony:i%3?'rail':'cage',tanks:1,back:true});};
 for(let i=0;i<5;i++){const y=-(YC+1.4+i*2.7);house(-2.45,y,Math.PI/2);house(2.45,y+.3,-Math.PI/2);house(-5.65,y,-Math.PI/2);house(5.65,y+.3,Math.PI/2);}
 house(-2.45,YC+1.4,Math.PI/2,{floors:2});house(2.45,YC+1.4,-Math.PI/2,{floors:3});house(-5.65,YC+1.4,-Math.PI/2);house(5.65,YC+1.4,Math.PI/2);
 for(let i=0;i<6;i++){const s=1.6+i*2.7,cx=kink[0]+Math.sin(TH)*s,cy=kink[1]+Math.cos(TH)*s,ln=[-Math.cos(TH),Math.sin(TH)],rn=[Math.cos(TH),-Math.sin(TH)];
  house(cx+ln[0]*2.45,cy+ln[1]*2.45,Math.PI/2-TH);house(cx+rn[0]*(2.45+(i<1?1.6:0)),cy+rn[1]*(2.45+(i<1?1.6:0)),-Math.PI/2-TH);}
 // 涵洞兩邊、外側地面上再各放一棟量體，擋住空曠的路堤腳（前後對稱不用，避免整排一樣）。
 for(const [x,y,f,fl] of [[-9.8,-YC-.6,0,2],[9.8,-YC-.6,0,3],[-9.8,YC+.9,Math.PI,2],[9.8,YC+.9,Math.PI,3]])house(x,y,f,{floors:fl,width:3.4,depth:3.0});
 // ── 周邊補景（本輪自訂）：後側（+y）路堤外沿排低矮方塊當市街背景；前側（−y）只種行道樹——前側不放高過路堤的東西，低角度才看得到路堤面。
 const fill=['#cbc3ad','#b9c1b3','#d6bfa6','#adb9b8'].map(c=>mat(c,{name:'filler'}));
 for(const sx of [-1,1])for(let i=0;i<5;i++){
  const w=3.2+(i%3)*.5,d=2.4+((i+1)%3)*.5,h=u(6.2+((i*2)%3)*2.6),x=sx>0?17.5+i*4.4:-14.5-i*4.4,y=HB+2.6+d/2+(i%2)*1.4;
  block(fill[(i+(sx>0?2:0))%4],[w,d,h],[x,y,ZG+h/2]);
 }
 for(const [x,y,h] of [[-19,-9.5,2.4],[-11.5,-13.5,2.1],[15,-10.5,2.6],[24,-14,2.2],[-27,-12,2.5]])props.broadleaf(x,y,ZG,h);
 k.bake();

 // ── 拍照者：洞口前三位（兩位在洞裡／引道上，一位在外側地面上），臉朝涵洞、頭朝列車。位置是本輪自訂。
 const rampZ=y=>{const t=(Math.abs(y)-flatEnd)/rampLen;return t<=0?0:ZG*Math.min(1,t);}; // 引道上某處的路面高
 const specs=kits?[
  {x:-.30,y:-(HB+.32),z:0,yaw:Math.PI/2,color:'#d8a64e',hair:'short',torso:'jacket',rel:1},
  {x:.36,y:-(HB+.95),z:rampZ(HB+.95),yaw:Math.PI/2+.12,color:'#5c8f9b',hair:'long',torso:'shirt',rel:.97},
  {x:-.5,y:-(YC+.5),z:ZG,yaw:Math.PI/2-.18,color:'#c05d4a',hair:'short',torso:'shirt',rel:1}
 ]:[];
 const photographers=kits?createPhotographers(kits,specs):null;if(photographers)group.add(photographers.group);
 let state={};
 return{...k,path,opposingPath,kind:'guanghua',contactWireZ:WIRE_Z-.0125,focus:[0,0,1.2],photographers,
  // 尺寸（單位），給視圖／驗收讀；驗收的數字仍以實際網格量，不從這裡抄。
  dims:{HW,HB,ZS,ZD,ZB,ZG,YT,RAIL_Z,WIRE_Z,YC,CX,flatEnd,rampLen,mouthY:HB},
  update(time,period,train={}){const light=k.illumination(period);photographers?.update(time,train.cars??[],train.scale??METER);state={lights:light,photographers:specs.length,watching:photographers?.seen??0,houses:hi};},
  get state(){return state;},inspect:()=>photographers?.inspect()??[],
  dispose(){beamTex.dispose();k.dispose();photographers?.dispose();}};
}

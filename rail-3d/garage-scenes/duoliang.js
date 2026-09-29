import * as THREE from '../vendor/three.module.js';
import {createKit,smooth} from './new-scene-kit.js';
import {coastalPath,offsetPoint,ribbon,fence,hillside,tunnelRidge,staircase} from './scene-detail-kit.js?revision=scale-0929';
import {personPose} from '../garage-people.js?revision=people-0927';
// 遊客（garage-people-v1 的 Blender 零件＋garage-camera-v1 的相機）看經過的列車。
// 比例：真實比例，跟南迴、高架、十分放人的做法一樣——零件庫的人是車模公尺（站姿包圍盒高 1.735），乘上與列車同一個比例尺。
// createConsist 把車寬 size.y（車模公尺）縮成 1.25 單位，所以 1 公尺 ＝ 1.25／車寬 單位（south-coast-view.js：scale: 1.25/primary.size.y）。
// 三款車的車寬（車模公尺）：藍皮 2.800、DR1000 2.981、EMU3000 3.031；換車時遊客換成那款車的比例尺，人高／車身高才照著模型的真實比。
export const UNIT_PER_M={blue:1.25/2.8,dr1000:1.25/2.981,emu3000:1.25/3.031};
// 不會跟著換車的東西（欄杆、扶手、長椅）用三款車的平均：1 公尺 ＝ .426 單位（換算：欄杆頂 1.1 m ＝ .469 單位，人 1.735 m ＝ .74 單位上下）。
export const METER=.426,PERSON_SCALE=METER,HEAD_LIMIT=70*Math.PI/180,TORSO_LIMIT=75*Math.PI/180;
// 角速度上限（rad/s）：頭、攝影者上半身、走路者轉身。沒有瞬移：目標一跳，實際角度也只能照上限追。
export const HEAD_RATE=3.2,TORSO_RATE=2.4,TURN_RATE=2.0,TAU=.16,SEE_X=36;
const TRACK=true;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),clampTo=(v,l)=>Math.max(-l,Math.min(l,v));
// 一步：一階追蹤（時間常數 TAU）再夾角速度上限。rate 是 Infinity 就等於沒上限（突變測試用）。
function follow(cur,target,dt,rate){const d=target-cur,step=d*(1-Math.exp(-dt/TAU)),lim=rate*dt;return cur+Math.max(-lim,Math.min(lim,step));}

// ---- 遊客 -------------------------------------------------------------------------------------------------
// 每個零件一個 InstancedMesh（人的零件與相機零件共用同一套做法）；每幀照狀態擺姿勢。
// 一般遊客：身體朝固定方向（看海），頭在 HEAD_LIMIT 內轉向最近車廂中心。
// 攝影者：腳固定，上半身（頭、髮、上衣、彎臂、相機）繞腰一起轉，上限 TORSO_LIMIT，相機因此永遠對著頭朝的方向。
// 走路者：沿平台來回走；轉身（走向反轉）也走 TURN_RATE 的角速度上限，不瞬間掉頭。
const HEAD_PARTS=n=>n==='head'||n.startsWith('hair-')||n==='acc-hat';
const UPPER_PARTS=n=>HEAD_PARTS(n)||n.startsWith('torso-')||n==='acc-backpack';
const CAMERA_PARTS=['camera-body','camera-top','camera-lens','camera-glass','grip-sleeve-l','grip-sleeve-r','grip-hand-l','grip-hand-r'];
const TORSOS=['shirt','jacket','hoodie','dress'],HAIRS=['short','long','bun'],
 BOTTOMS=['#384d5b','#3d4450','#6b5a48','#2f3a4c'],SKINS=['#e9c8a8','#d6a987','#b98663','#f1d3b8'],HAIRC=['#2b2320','#4a3426','#1f1f24','#7a5a3a'],ACCENTS=['#c9463d','#2f6f8f','#e0b44c','#3b3b3b'];
function createVisitors(kits,specs){
 const [people,camera]=kits,group=new THREE.Group();group.name='duoliang-visitors';
 const peopleMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.78}),cameraMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.5,metalness:.1}),meshes=new Map();
 for(const [kit,material] of [[people,peopleMat],[camera,cameraMat]])for(const [name,part] of kit.parts){
  const m=new THREE.InstancedMesh(part.geometry,material,specs.length*(part.perPerson??1));m.name='duoliang-'+name;m.castShadow=m.receiveShadow=true;m.frustumCulled=false;m.count=0;group.add(m);meshes.set(name,{mesh:m,part,n:0});}
 const list=specs.map((sp,i)=>{
  const photo=sp.kind==='photographer',look={hair:HAIRS[(i*2+1)%3],torso:TORSOS[(i*3+1)%4],accessory:sp.hat&&!photo?'hat':(!photo&&i%5===2?'backpack':null),scale:1,
   top:sp.color,bottom:BOTTOMS[i%4],skin:SKINS[(i*3+1)%4],hairColor:HAIRC[(i*5+2)%4],accent:ACCENTS[i%4]};
  return{...sp,i,look,pv:{look,pose:'stand',walking:false,stride:0,step:1,hand:0},out:[],yaw:sp.yaw??0,turn:0,car:-1,s:sp.s??0,slots:{}};});
 const root=new THREE.Matrix4(),sm=new THREE.Matrix4(),rz=new THREE.Matrix4(),tw=new THREE.Matrix4(),world=new THREE.Matrix4(),color=new THREE.Color(),m4=new THREE.Matrix4(),p3=new THREE.Vector3();
 let last=null,seenCount=0;
 function put(v,name,matrix){const e=meshes.get(name),{part}=e;world.multiplyMatrices(root,matrix);e.mesh.setMatrixAt(e.n,world);
  if(part.tint==='fixed')color.setRGB(part.color[0],part.color[1],part.color[2]);else color.set(part.tint==='hair'?v.look.hairColor:v.look[part.tint]);
  e.mesh.setColorAt(e.n,color);(v.slots[name]??=[]).push(e.n);e.n++;}
 function update(time,cars,scale=PERSON_SCALE){
  const dt=last===null?0:time-last,snap=last===null||dt<0||dt>.5,moving=dt>1e-9&&!snap;last=time;
  const seen=[];cars.forEach((c,i)=>{if(Math.abs(c[0])<SEE_X)seen.push({i,x:c[0],y:c[1]});});seenCount=seen.length;
  for(const e of meshes.values())e.n=0;
  for(const v of list){
   v.slots={};
   if(v.kind==='walker'&&(moving||snap)){const s=v.base+Math.sin(time*.11+v.i)*2,ds=s-v.s;v.s=s;
    const sn=v.path.sample(s),p=offsetPoint(v.path,s,3.0,v.z);v.x=p[0];v.y=p[1];
    if(snap){v.pv.walking=false;v.yaw=sn.heading+(Math.cos(time*.11+v.i)>=0?0:Math.PI);}
    else{const want=sn.heading+(ds>=0?0:Math.PI);v.yaw+=Math.max(-TURN_RATE*dt,Math.min(TURN_RATE*dt,wrap(want-v.yaw)*(1-Math.exp(-dt/TAU))));
     v.pv.walking=Math.abs(ds)/dt>.02;if(v.pv.walking)v.pv.stride+=Math.abs(ds)/(scale*v.rel)*.38;}}
   // 目標：最近車廂中心（換目標要贏 4% 才換，不在兩節中間來回跳）；沒車就回到原本朝向。
   let target=0;
   if(TRACK&&seen.length){const d=c=>Math.hypot(c.x-v.x,c.y-v.y);let best=seen[0];for(const c of seen)if(d(c)<d(best))best=c;
    const keep=seen.find(c=>c.i===v.car);if(keep&&d(keep)<=d(best)*1.04)best=keep;v.car=best.i;
    target=wrap(Math.atan2(best.y-v.y,best.x-v.x)-v.yaw);
    if(Math.abs(target)>Math.PI-.5&&Math.abs(v.turn)>.05)target=Math.sign(v.turn)*Math.abs(target);} // 車在正後方：沿用原本轉的那一側，不在 ±180° 兩邊來回甩
   else v.car=-1;
   const photo=v.kind==='photographer',limit=photo?TORSO_LIMIT:HEAD_LIMIT,rate=photo?TORSO_RATE:HEAD_RATE,goal=clampTo(target,limit);
   v.turn=snap?goal:follow(v.turn,goal,dt,rate);
   const s=scale*v.rel;root.makeTranslation(v.x,v.y,v.z).multiply(rz.makeRotationZ(v.yaw)).multiply(sm.makeScale(s,s,s));
   tw.makeRotationZ(v.turn);
   for(const e of personPose(v.pv,people,v.out)){
    if(photo&&(e.name==='arm'||e.name==='hand'))continue;
    if(photo&&UPPER_PARTS(e.name))put(v,e.name,m4.multiplyMatrices(tw,e.matrix));
    else if(!photo&&HEAD_PARTS(e.name))put(v,e.name,m4.copy(e.matrix).multiply(tw));
    else put(v,e.name,e.matrix);}
   if(photo)for(const name of CAMERA_PARTS)put(v,name,tw);
  }
  for(const e of meshes.values()){e.mesh.count=e.n;e.mesh.visible=e.n>0;e.mesh.instanceMatrix.needsUpdate=true;if(e.mesh.instanceColor)e.mesh.instanceColor.needsUpdate=true;}
 }
 // 讀回實際畫出來的東西（各零件實例矩陣×零件幾何）：驗收與截圖檢查用，不重算公式。
 function inspect(){
  return list.map(v=>{
   const world=(name,k,point)=>{const e=meshes.get(name);e.mesh.getMatrixAt(v.slots[name][k],m4);return p3.copy(point).applyMatrix4(m4).toArray();};
   const center=name=>{const b=meshes.get(name).part.geometry.boundingBox;return b.getCenter(new THREE.Vector3());};
   const dirOf=name=>{const e=meshes.get(name);e.mesh.getMatrixAt(v.slots[name][0],m4);const d=new THREE.Vector3(1,0,0).transformDirection(m4);return Math.atan2(d.y,d.x);};
   const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
   for(const [name,ks] of Object.entries(v.slots)){const b=meshes.get(name).part.geometry.boundingBox,e=meshes.get(name);for(const k of ks){e.mesh.getMatrixAt(k,m4);
    for(let c=0;c<8;c++){p3.set(c&1?b.max.x:b.min.x,c&2?b.max.y:b.min.y,c&4?b.max.z:b.min.z).applyMatrix4(m4);for(let a=0;a<3;a++){min[a]=Math.min(min[a],p3.getComponent(a));max[a]=Math.max(max[a],p3.getComponent(a));}}}}
   const out={i:v.i,kind:v.kind,pos:[v.x,v.y,v.z],bodyYaw:v.yaw,head:{pos:world('head',0,new THREE.Vector3()),yaw:dirOf('head')},bbox:{min,max},
    feet:[0,1].map(k=>world('shoe',k,center('shoe'))),car:v.car};
   if(v.kind==='photographer'){const b=world('camera-body',0,center('camera-body')),g=world('camera-glass',0,center('camera-glass'));out.camera={pos:b,yaw:Math.atan2(g[1]-b[1],g[0]-b[0])};}
   return out;});
 }
 return{group,update,inspect,get seen(){return seenCount;},count:list.length,
  dispose(){for(const {mesh} of meshes.values())mesh.dispose();peopleMat.dispose();cameraMat.dispose();group.clear();}};
}

export function createScene(kits=null){
 const k=createKit(),{group,mat,block,beam,mesh,props,rand}=k,path=coastalPath();
 const stone=mat('#a5a18b'),red=mat('#b93f2b'),cream=mat('#c9c2ac'),wood=mat('#785d43');
 k.slab('#655442',76,48,-1.6,.45,5);k.slab('#ad9671',75.5,47.5,-1.15,.5,5);
 k.slab('#357f8c',75,47,-.65,.67,5);k.slab('#78936c',72,29.6,-.55,4.2,13);
 // 海面 roughness 1：正交相機＋平行光＋一整片平面，整片海的半角向量完全一樣，粗糙度低的話鏡面波瓣一對準太陽（黃昏、白天從山側往海看，日出從另一側）
 // 整片海同時反成白米色。roughness 1 的波瓣寬到不會亮起來；預設視角的白天海色幾乎不變（ΔE≈1）。只改多良的海，不動共用 kit 的預設。
 const sea=mat('#3b8d9d',{metalness:.2,roughness:1});block(sea,[69,14,.035],[0,-10.8,.045]);
 const waves=[],foam=mat('#bcd7c9',{transparent:true,opacity:.48,depthWrite:false});
 for(let i=0;i<30;i++){const w=mesh(new THREE.BoxGeometry(1.8+rand()*5,.045,.012),foam,[-33+rand()*66,-17+rand()*11,.09+i*.001]);waves.push({w,y:w.position.y,phase:rand()*6.28});}
 // 沿彎軌的擋土結構、排水孔與岩岸；不把階梯月台架在平板上。
 ribbon(k,path,-25,25,-2.4,4.5,.06,3.64,stone);
 ribbon(k,path,-25,25,-2.55,-1.15,3.64,4.32,cream);
 for(let s=-24;s<25;s+=1.8){const p=path.sample(s);block(mat('#878779'),[.75,.18,2.4],offsetPoint(path,s,-2.46,1.8),[0,0,p.heading]);block(mat('#484f4b'),[.16,.07,.13],offsetPoint(path,s,-2.59,2.65),[0,0,p.heading]);}
 // 欄杆與扶手的高度用真實尺寸換算（1 m ＝ METER 單位）：紅欄杆、觀景層木欄杆、藍立柱木扶手頂面都是 1.1 m，樓梯扶手頂面在踏階鼻上方 .9 m，長椅座面 .45 m、椅背頂 .85 m。
 const RAIL_TOP=1.1*METER,railH=RAIL_TOP-.035,railBars=[.17*railH,.59*railH,railH]; // 紅欄杆頂桿粗 .07，頂面才是 1.1 m
 fence(k,path,-24,24,-2.45,4.32,red,railH,railBars);
 for(let i=0;i<100;i++){const s=-35+rand()*70,p=offsetPoint(path,s,-3.4-rand()*2,.02);props.rock(...p,.3+rand()*.65);}
 k.track(path);
 // 山側下層步道與海側窄月台分開，所有欄杆都順著曲線。
 ribbon(k,path,-23.5,23.5,1.45,3.85,3.65,4.50,cream);
 fence(k,path,-23.5,23.5,1.58,4.50,red,railH,railBars);
 for(let s=-23;s<23;s+=1.4){const p=path.sample(s);block(mat('#a6a18f'),[.022,2.15,.012],offsetPoint(path,s,2.7,4.507),[0,0,p.heading]);}
 // 2018 原照的站房上方觀景層、洗石子階梯、藍扶欄與深色握把。
 block(mat('#d4c6a0'),[12,4.2,2.72],[-5,8.2,5.01]);
 block(mat('#c69643'),[12.03,.065,.92],[-5,6.065,5.80]);
 for(let x=-10.8;x<.9;x+=.44)for(let z=5.38;z<6.22;z+=.21)block(mat('#aa8246'),[.40,.012,.012],[x,6.023,z]);
 for(const x of [-9.2,-5.3,-1.4]){block(mat('#4d5957'),[1.8,.07,1.25],[x,6.018,4.68]);for(let dx=-.6;dx<=.6;dx+=.4)block(cream,[.045,.09,1.25],[x+dx,5.97,4.68]);}
 block(mat('#8c4734'),[.95,.09,2],[-7.1,6.008,4.69]);
 block(cream,[12.4,4.55,.24],[-5,8.2,6.78]);
 const deckH=RAIL_TOP-.0375; // 觀景層地板頂面 6.9；頂桿粗 .075
 for(const yy of [5.97,10.43]){for(let x=-11.1;x<=1.1;x+=.62)block(wood,[.07,.07,deckH-.005],[x,yy,6.905+(deckH-.005)/2]);for(const f of [.21,.62,1])beam(wood,[-11.15,yy,6.9+f*deckH],[1.15,yy,6.9+f*deckH],.075);}
 const stairs=[staircase(k,{x:2.6,y:4.3,z:4.5,steps:15,rise:.16,tread:.32,width:2.5,handHeight:.9*METER})];
 block(cream,[4.0,1.25,.2],[1.85,9.72,6.80]);
 block(cream,[2.5,4.8,.85],[2.6,6.7,4.075]);
 const handZ=6.9+RAIL_TOP-.04; // 扶手粗 .08
 beam(wood,[3.87,9.15,handZ],[3.87,10.29,handZ],.08);
 block(cream,[3.0,.9,.16],[2.6,3.91,4.42]);
 for(const y of [10.29]){beam(wood,[1.1,y,handZ],[3.87,y,handZ],.08);for(let x=1.25;x<3.9;x+=.6)block(mat('#408eaa'),[.07,.07,handZ-.02-6.9],[x,y,6.9+(handZ-.02-6.9)/2]);}
 k.label('多 良 車 站',-4.8,5.89,6.0,3.4,.65);
 k.label('觀 景 步 道',4.25,4.1,5.75,1.5,.5);
 const seatTop=6.9+.45*METER,backTop=6.9+.85*METER,seatT=.06,legH=seatTop-seatT-6.9+.02; // 座面 .45 m、椅背頂 .85 m；長度、椅深不變
 for(const x of [-9,-4]){block(wood,[2,.52,seatT],[x,9.45,seatTop-seatT/2]);block(wood,[2,.1,backTop-seatTop+.01],[x,9.68,(backTop+seatTop-.01)/2]);for(const dx of [-.7,.7])block(mat('#59605b'),[.10,.40,legH],[x+dx,9.45,6.9+legH/2]);}
 // 山稜連成實際坡面，低處接站房後方平台；岩面與植栽都取地形高度。
 function land(u,v){const x=-35+70*u,rail=92-Math.sqrt(92*92-x*x),front=rail+5+7*(1-smooth((Math.abs(x)-12)/10));const y=front+(28-front)*v;
  const ridge=9+5*Math.exp(-(((x+21)/12)**2))+7*Math.exp(-(((x-18)/12)**2)),z=3.65+ridge*Math.pow(Math.sin(v*Math.PI/2),.9)+(.65*Math.sin(x*.43+v*9)+.3*Math.sin(x*1.1))*Math.sin(v*Math.PI);return[x,y,z];}
 hillside(k,land);
 const tunnels=[tunnelRidge(k,path,-25,-36),tunnelRidge(k,path,25,36)];
 for(let i=0;i<160;i++){const u=.03+rand()*.94,v=.1+rand()*.85,p=land(u,v);if(Math.abs(p[0])>23&&v<.6)continue;props.broadleaf(...p,1.2+rand()*1.7);}
 for(let i=0;i<145;i++){const p=land(rand(),rand());props.bush(...p,.45+rand()*.45);}
 // 山腳護坡塊及泄水溝，不穿入遊客平台。
 for(const side of [-1,1])for(let i=0;i<9;i++){const x=side*(13+i*.6),y=path.sample(x).y+5.5;block(mat('#8e9580'),[.42,.22,.56],[x,y,4.05+i*.15],[0,.12,0]);}
 const colors=['#d8a64e','#b35042','#5c8f9b','#e7dfc6','#485e7f','#d0a5a2'];
 // 遊客：位置、人數、衣色沿用原本；攝影者（原本手上有深色方塊的那幾位）改舉真的相機，所以不戴帽子。
 const specs=[];
 for(let i=0;i<10;i++){const s=-20+i*4.2,p=offsetPoint(path,s,2.3+(i%2)*.8,4.5);specs.push({kind:i%3===0?'photographer':'visitor',x:p[0],y:p[1],z:4.5,yaw:path.sample(s).heading-Math.PI/2+(i%3-1)*.1,color:colors[i%6],hat:i%4===0,rel:i===7?.74:1+((i*7)%5-2)*.02});}
 for(let i=0;i<5;i++)specs.push({kind:i%2===0?'photographer':'visitor',x:-9.8+i*2.0,y:6.6,z:6.9,yaw:-Math.PI/2+(i%3-1)*.1,color:colors[(i+2)%6],hat:i===2,rel:1+((i*3)%5-2)*.02});
 [[-4,'#c5aa64',1,true],[2,'#799caa',.8,false]].forEach(([base,color,rel,hat],i)=>specs.push({kind:'walker',base,x:0,y:0,z:4.5,yaw:0,path,s:base,color,hat,rel}));
 const visitors=kits?createVisitors(kits,specs):null;if(visitors)group.add(visitors.group);
 for(const s of [-19,-10,11,20]){const p=offsetPoint(path,s,3.6,4.5);k.lamp(...p,2.7);}k.lamp(-10,9.8,6.9,2.5);k.lamp(4,4.4,4.5,2.4);
 const wireGroup=new THREE.Group();group.add(wireGroup);const wireMat=mat('#62685f');
 // 電車線離軌頂 1.95（與高架同一個高度），集電弓伸得到；腕臂在線上方，弓頭不會穿過它。
 for(let s=-22;s<=22;s+=8){const p=offsetPoint(path,s,1.15,5.065);k.part(wireGroup,wireMat,[.08,.08,2.13],p);const q=offsetPoint(path,s,.5,6.01);k.part(wireGroup,wireMat,[.10,1.35,.08],q,[0,0,path.sample(s).heading]);}
 for(let s=-25;s<25;s+=.5){const a=offsetPoint(path,s,0,5.95),b=offsetPoint(path,s+.5,0,5.95),v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const o=k.part(wireGroup,wireMat,[v.length(),.023,.023],a);o.position.addScaledVector(v,.5);o.rotation.z=path.sample(s).heading;}
 k.bake();let state={};return{...k,path,kind:'duoliang',contactWireZ:5.95-.0115,focus:[0,5,6],update(time,period,train){const light=k.illumination(period);sea.color.set(period==='night'?'#193e52':period==='dawn'?'#8c9999':period==='sunset'?'#658c93':'#3b8d9d');for(const {w,y,phase}of waves){w.position.y=y+Math.sin(time*.35+phase)*.18;w.scale.x=1+Math.sin(time*.5+phase)*.12;}visitors?.update(time,train.cars??[],UNIT_PER_M[train.id]??METER);wireGroup.visible=train.id==='emu3000';state={visitors:specs.length,watching:visitors?.seen??0,lights:light,electrified:wireGroup.visible,stairs,tunnels,curved:true};},get state(){return state;},inspect:()=>visitors?.inspect()??[],dispose(){k.dispose();visitors?.dispose();}};
}

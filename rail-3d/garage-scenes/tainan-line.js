import * as THREE from '../vendor/three.module.js';
import {createKit} from './metro-kit.js';
import {createScene as createStation,THEMES} from './tainan.js';
import {createScene as createCrossing} from './crossing.js';
import {createScene as createGuanghua,METER,UNIT_PER_M} from './guanghua.js';
export {THEMES,METER,UNIT_PER_M};
// 台南市區地面鐵道沿線（2026-11 色塊粗模）：小東路地下道、台南車站、青年路平交道、東門陸橋、光華街涵洞接在同一條雙線上。時期：10 月通車前最後的樣子。
// 三座既有場景照原本的 createScene 建好再搬過來，它們的程式一行不動，所以單座場景的烘焙結果不變。這裡只做三件事：
//  1. 拿掉各自的底座，換一塊長底座（地面沿線升降，小東路那段挖路塹）。
//  2. 平交道裁短（x 超出窗口的三角形丟掉、跨窗口的頂點夾回窗口），光華街轉半圈（它的 +x 是北北西）。
//  3. 空檔用自訂路徑接起來：線距 4.4 → 3.3 → 1.7，全線軌頂同高。陸橋、地下道、臨時後站、天橋、街廓是這裡新做的色塊。
// 座標：+x 往南（主路徑的行進方向）、+y 往東，軌道中線 y＝0。三座的軌頂離地不一樣（車站 .23、平交道 .36、光華街 1.03），軌頂拉平、地面跟著升降，
// 接觸線才是一個高度（garage-diorama.js 的 contactWireZ 只有一個值）。
// 比例：結構照各自原本的比例（約 1 公尺 .42 單位）；彎的路線拉直、結構之間的街景壓短，真實里程與角度寫在排版表，不在這裡。
const HALF=120,LAP=300,R=.36; // 底座半長、一趟長（SCENES 的 pass[0]）、全線軌頂高
const X_UNDER=-108,UNDER_W=7.6;                          // 小東路地下道（路沿 y，真實也幾乎正交）
const X_STATION=-63,STATION_LO=-96,STATION_HI=-30;       // 車站段＝原本的 66 單位
const X_CROSS=2.6,CROSS_LO=-24.6,CROSS_HI=23.7;          // 平交道段（窗口是平交道自己的座標）：−22 到 26.3
const X_BRIDGE=46,BRIDGE_ANGLE=55.3*Math.PI/180;         // 東門陸橋：路跟鐵路斜交（OSM way 413128684），往 +y 時往 +x 走
const X_CULVERT=93;                                      // 光華街段＝原本的 54 單位：66 到 120
const GAP_LO=STATION_HI,GAP_HI=X_CROSS+CROSS_LO,RAMP_LO=X_CROSS+CROSS_HI,RAMP_HI=X_CULVERT-27;
const Y_MIN_STATION=-27.5,Y_MIN_CROSS=-18,Y_MIN_RAMP=-24,Y_MAX=28.5;
const Z_STATION=R-.23,Z_CROSS=R-.36,Z_GUANGHUA=R-1.03;  // 各段外側地面高
const BASE=-2.35;                                        // 底座頂面（路塹路面 −2.11 要比它高）
const lerp=(a,b,t)=>a+(b-a)*Math.max(0,Math.min(1,t)),smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const groundAt=x=>x<GAP_LO?Z_STATION:x<GAP_HI?lerp(Z_STATION,Z_CROSS,(x-GAP_LO)/(GAP_HI-GAP_LO)):x<RAMP_LO?Z_CROSS:x<RAMP_HI?lerp(Z_CROSS,Z_GUANGHUA,(x-RAMP_LO)/(RAMP_HI-RAMP_LO)):Z_GUANGHUA;

// 平交道裁短：丟掉整個在窗口外的三角形，其餘頂點夾回窗口（電車線、鋼軌這種長條直接停在窗口邊）；順便丟掉三層底座板（烘平之後只剩頂點色認得出來）。
function trim(group,lo,hi,colors){
 const gone=colors.map(c=>new THREE.Color(c)),isGone=(C,i)=>gone.some(c=>Math.abs(C.getX(i)-c.r)+Math.abs(C.getY(i)-c.g)+Math.abs(C.getZ(i)-c.b)<1e-4);
 group.traverse(o=>{
  if(!o.isMesh||o.name==='headlight-pool'||o.geometry.attributes.position.usage===THREE.DynamicDrawUsage)return;
  const g=o.geometry,P=g.attributes.position,C=g.attributes.color,I=g.index,keep=[];
  for(let t=0;t<(I?I.count:P.count);t+=3){const a=I?I.getX(t):t,b=I?I.getX(t+1):t+1,c=I?I.getX(t+2):t+2,x=[P.getX(a),P.getX(b),P.getX(c)];
   if(Math.max(...x)<=lo||Math.min(...x)>=hi||C&&isGone(C,a)&&isGone(C,b)&&isGone(C,c))continue;keep.push(a,b,c);}
  for(let i=0;i<P.count;i++)P.setX(i,Math.max(lo,Math.min(hi,P.getX(i))));
  g.setIndex(keep);g.computeBoundingSphere();g.computeBoundingBox();
 });
}

export function createScene(kits){
 const station=createStation(kits[0]),crossing=createCrossing(),guanghua=createGuanghua(kits.slice(1));
 const k=createKit({seed:20261017,plinth:[2*HALF,56,3]}),{M,block,mat,along,strips,at}=k,root=new THREE.Group();
 for(const o of k.group.children.slice(0,3))k.group.remove(o);
 const YG=guanghua.dims.YT,gz=R-guanghua.dims.RAIL_Z;
 const trackY=x=>x<GAP_LO?2.2:x<GAP_HI?lerp(2.2,1.65,smooth((x-GAP_LO)/(GAP_HI-GAP_LO))):x<RAMP_LO?1.65:x<RAMP_HI?lerp(1.65,YG,smooth((x-RAMP_LO)/(RAMP_HI-RAMP_LO))):YG;
 const slopeY=x=>(trackY(x+.1)-trackY(x-.1))/.2;
 const path={length:LAP,trackStart:-HALF,trackLength:2*HALF,sample:s=>({x:s,y:trackY(s),z:R,heading:Math.atan(slopeY(s))})};
 const opposingPath={length:LAP,trackStart:-HALF,trackLength:2*HALF,sample:s=>({x:-s,y:-trackY(-s),z:R,heading:Math.PI-Math.atan(slopeY(-s))})};
 // 接線段的一股（opposing 那股也往 +x 鋪，幾何一樣）。
 const piece=(side,from,to)=>({length:LAP,trackStart:from,trackLength:to-from,sample:s=>({x:s,y:side*trackY(s),z:R,heading:side*Math.atan(slopeY(s))})});

 // ── 既有三座搬進來
 for(const o of station.group.children.slice(0,3))station.group.remove(o); // metro-kit 的底座本體、裙邊、地面
 station.group.position.set(X_STATION,-6.6,R+.47);
 for(const c of Object.values(crossing.nativeRigs.fleet))root.add(c.d.mesh); // 動態 mesh 的頂點是世界座標，不能再吃 group 的位移
 trim(crossing.group,CROSS_LO,CROSS_HI,['#665440','#b49c75','#95a078']);
 crossing.group.position.x=X_CROSS;crossing.path.length=LAP;
 for(const o of [...guanghua.group.children])if(o.isMesh&&!o.isInstancedMesh&&['665440','b49c75'].includes(o.material.color?.getHexString()))guanghua.group.remove(o);
 guanghua.group.position.set(X_CULVERT,0,gz);guanghua.group.rotation.z=Math.PI;
 // 點光：三座加起來 14 盞，手機與 headless 都吃不下，留 5 盞（路燈、其他入口靠自發光材質）。
 const keepLights=new Set(['entrance','platform-1','culvert-lamp']);
 for(const g of [station.group,guanghua.group]){const off=[];g.traverse(o=>{if(o.isLight&&!keepLights.has(o.name))off.push(o);});off.forEach(o=>o.parent.remove(o));}
 crossing.lights.slice(1).forEach(l=>l.parent.remove(l));crossing.nativeRigs.redLights.slice(1).forEach(l=>l.parent.remove(l));

 // ── 地面：一格一塊，頂面沿 x 線性升降；四面到底座。
 const sets=new Map(),quad=(m,a,b,c,d)=>{if(!sets.has(m))sets.set(m,[]);sets.get(m).push(...a,...b,...c,...a,...c,...d);};
 const soil=mat('#9a7a58'),grass=mat('#87956b'),street=mat('#95a078'),paving=mat('#a9a495'),asphalt=mat('#61635f'),concrete=mat('#bab5a6'),concreteDark=mat('#9c978b');
 function earth(x0,x1,y0,y1,z0,z1,top){
  quad(top,[x0,y0,z0],[x1,y0,z1],[x1,y1,z1],[x0,y1,z0]);
  quad(soil,[x0,y0,BASE],[x1,y0,BASE],[x1,y0,z1],[x0,y0,z0]);quad(soil,[x1,y1,BASE],[x0,y1,BASE],[x0,y1,z0],[x1,y1,z1]);
  quad(soil,[x0,y1,BASE],[x0,y0,BASE],[x0,y0,z0],[x0,y1,z0]);quad(soil,[x1,y0,BASE],[x1,y1,BASE],[x1,y1,z1],[x1,y0,z1]);
 }
 const U0=X_UNDER-UNDER_W/2,U1=X_UNDER+UNDER_W/2;
 earth(-HALF,U0,Y_MIN_STATION,Y_MAX,Z_STATION,Z_STATION,grass);earth(U1,GAP_LO,Y_MIN_STATION,Y_MAX,Z_STATION,Z_STATION,grass);
 earth(GAP_LO,GAP_HI,Y_MIN_CROSS,Y_MAX,Z_STATION,Z_CROSS,street);earth(GAP_HI,RAMP_LO,Y_MIN_CROSS,Y_MAX,Z_CROSS,Z_CROSS,street);
 earth(RAMP_LO,RAMP_HI,Y_MIN_RAMP,Y_MAX,Z_CROSS,Z_GUANGHUA,street);
 // 光華街段自己的鋪面只到 y＝±23.6，外面補一條；中間托在它留下來的最上層底板下面。
 earth(RAMP_HI,HALF,23.6,Y_MAX,Z_GUANGHUA,Z_GUANGHUA,paving);earth(RAMP_HI,HALF,Y_MIN_RAMP,-23.6,Z_GUANGHUA,Z_GUANGHUA,paving);earth(RAMP_HI,HALF,-23.6,23.6,gz-.42,gz-.42,soil);

 // ── 小東路地下道：路塹沿 y 穿過底座，路面最低處淨高 4.2 公尺；鐵路橋是一塊板。
 const LOW=-2.11,roadZ=y=>{const a=Math.abs(y),edge=y<0?-Y_MIN_STATION:Y_MAX;return lerp(LOW,Z_STATION,smooth((a-6)/(edge-6)));},WALL=Z_STATION+.3;
 for(let i=0;i<28;i++){const ya=lerp(Y_MIN_STATION,Y_MAX,i/28),yb=lerp(Y_MIN_STATION,Y_MAX,(i+1)/28),za=roadZ(ya),zb=roadZ(yb);
  quad(asphalt,[U0,ya,za],[U1,ya,za],[U1,yb,zb],[U0,yb,zb]);quad(concrete,[U0+.02,ya,za],[U0+.02,yb,zb],[U0+.02,yb,WALL],[U0+.02,ya,WALL]);quad(concrete,[U1-.02,yb,zb],[U1-.02,ya,za],[U1-.02,ya,WALL],[U1-.02,yb,WALL]);}
 quad(soil,[U0,Y_MIN_STATION,BASE],[U1,Y_MIN_STATION,BASE],[U1,Y_MIN_STATION,Z_STATION],[U0,Y_MIN_STATION,Z_STATION]);quad(soil,[U1,Y_MAX,BASE],[U0,Y_MAX,BASE],[U0,Y_MAX,Z_STATION],[U1,Y_MAX,Z_STATION]);
 block(concrete,[.28,11,.5],[X_UNDER,0,LOW+.25]);
 block(concreteDark,[UNDER_W+1.6,7.8,.42],[X_UNDER,0,Z_STATION-.21]);for(const s of [-1,1])block(concrete,[UNDER_W+1.6,.16,.46],[X_UNDER,s*3.82,Z_STATION+.23]);

 // ── 路堤：地面比道碴低的兩段（車站到平交道、平交道到光華街）墊到軌頂下 .25，兩側緩坡。
 const bank=mat('#8d887a'),slope=mat('#7f8c63');
 for(const [from,to] of [[GAP_LO,GAP_HI],[RAMP_LO,RAMP_HI]]){const n=Math.ceil((to-from)/2.4);
  for(let i=0;i<n;i++){const a=lerp(from,to,i/n),b=lerp(from,to,(i+1)/n),wa=trackY(a)+1.28,wb=trackY(b)+1.28,top=R-.25,ga=groundAt(a)-.04,gb=groundAt(b)-.04;
   quad(bank,[a,-wa,top],[b,-wb,top],[b,wb,top],[a,wa,top]);
   quad(slope,[a,-wa-1.7,ga],[b,-wb-1.7,gb],[b,-wb,top],[a,-wa,top]);quad(slope,[b,wb+1.7,gb],[a,wa+1.7,ga],[a,wa,top],[b,wb,top]);}}

 // ── 接線段的軌道與電車線：道碴、枕木、鋼軌同 metro-kit 的 ballastTrack，段數照長度算（ballastTrack 固定 880 段，空檔用不到）。
 const WIRE=1.95,GAUGE=.46,underBridge=x=>Math.abs(x-X_BRIDGE)<7||Math.abs(x-X_UNDER)<6;
 for(const [from,to] of [[-HALF,STATION_LO],[GAP_LO,GAP_HI],[RAMP_LO,RAMP_HI]])for(const side of [-1,1]){
  const p=piece(side,from,to),N=Math.ceil((to-from)/1.6);
  strips(p,M.ballast,[[-1.45,-.23,-1.05,-.18],[-1.05,-.18,1.05,-.18],[1.05,-.18,1.45,-.23]],{N});
  along(p,.42,q=>block(M.sleeper,[.18,GAUGE*2+.48,.10],at(q,0,-.17),[0,0,q.heading]));
  strips(p,M.steel,[-GAUGE,GAUGE].map(o=>[o-.05,0,o+.05,0]),{N}).name='rail-head';
  strips(p,M.railSide,[-GAUGE,GAUGE].flatMap(o=>[[o-.05,-.12,o-.05,0],[o+.05,0,o+.05,-.12]]),{N}).name='rail-web';
  strips(p,M.wire,[[-.016,WIRE,.016,WIRE]],{N}).name='contact-wire';strips(p,M.wire,[[-.014,WIRE+.34,.014,WIRE+.34]],{N}).name='messenger-wire';
  along(p,8.2,q=>{if(underBridge(q.x))return;const o=side*1.42;block(M.mast,[.15,.15,2.72],at(q,o,1.13));block(M.mast,[.08,1.62,.08],at(q,o/2,WIRE+.59));block(M.mast,[.06,.06,.6],at(q,0,WIRE+.3));});
 }

 // ── 東門陸橋：路面中段過鐵路，兩端落到底座邊；貼地那段側牆接到地面，高的那段是橋面＋橋墩。
 const CX=Math.cos(BRIDGE_ANGLE),SY=Math.sin(BRIDGE_ANGLE),BW=2.3,TOP=3.5,FLAT=6.5,U_A=Y_MIN_RAMP/SY,U_B=Y_MAX/SY;
 const deckAt=u=>{const x=X_BRIDGE+u*CX,y=u*SY,g=groundAt(x),t=(Math.abs(u)-FLAT)/(Math.abs(u<0?U_A:U_B)-FLAT);return{x,y,g,z:t<=0?TOP:lerp(TOP,g+.04,(t+smooth(t))/2)};};
 const span=44;
 for(let i=0;i<span;i++){const a=deckAt(lerp(U_A,U_B,i/span)),b=deckAt(lerp(U_A,U_B,(i+1)/span)),under=p=>p.z-p.g<1.3?p.g-.1:p.z-.46,
   L=(p,z)=>[p.x-BW/SY,p.y,z],Rr=(p,z)=>[p.x+BW/SY,p.y,z]; // 斷面取 y 等值線，兩端才跟底座邊切齊
  quad(asphalt,Rr(a,a.z),Rr(b,b.z),L(b,b.z),L(a,a.z));
  quad(concrete,L(b,under(b)),L(a,under(a)),L(a,a.z+.32),L(b,b.z+.32));quad(concrete,Rr(a,under(a)),Rr(b,under(b)),Rr(b,b.z+.32),Rr(a,a.z+.32));
  quad(concrete,L(a,a.z),L(b,b.z),L(b,b.z+.32),L(a,a.z+.32));quad(concrete,Rr(b,b.z),Rr(a,a.z),Rr(a,a.z+.32),Rr(b,b.z+.32));
  quad(concreteDark,L(a,under(a)),L(b,under(b)),Rr(b,under(b)),Rr(a,under(a)));}
 for(let u=U_A+3;u<U_B;u+=6.2){const p=deckAt(u),h=p.z-.46-p.g;if(h<1.2||Math.abs(p.y)<5)continue;block(concreteDark,[1,BW*1.5,h],[p.x,p.y,p.g+h/2],[0,0,BRIDGE_ANGLE]);}

 // ── 車站後面：臨時後站（OSM way 1381329319，離軌道約 40 公尺）、跨站天橋（OSM way 1228832635 等，樓梯下到兩座月台）、第一月台的地下道出入口（第二月台的 station-stage 已經有）。
 const rearX=X_STATION+19.5,hallZ=Z_STATION,wallRear=mat('#e6e2d6'),roofRear=mat('#8c9b9b');
 block(wallRear,[23,7,2.5],[rearX,17.5,hallZ+1.25]);block(roofRear,[23.6,7.6,.18],[rearX,17.5,hallZ+2.59]);block(M.glass,[21,.06,.8],[rearX,13.97,hallZ+1.5]);
 const bx=X_STATION+23,deckZ=3.1,platformZ=R+.42,walk=mat('#d4d0c4'),rail=mat('#8f9692'),y0=-4.1,y1=14.1,yc=(y0+y1)/2;
 block(walk,[1.5,y1-y0,.16],[bx,yc,deckZ]);for(const s of [-1,1])block(rail,[.06,y1-y0,.72],[bx+s*.72,yc,deckZ+.4]);block(roofRear,[1.8,y1-y0,.08],[bx,yc,deckZ+.98]);
 for(const y of [-4.7,4.6,10.8])block(rail,[.3,.3,deckZ-.08-Z_STATION],[bx,y,(deckZ-.08+Z_STATION)/2]);
 for(const y of [0,-3.9]){const run=3.4,rise=deckZ-platformZ;block(walk,[Math.hypot(run,rise),1.1,.12],[bx-run/2,y,(deckZ+platformZ)/2],[0,-Math.atan2(rise,run),0]);}
 block(mat('#dcd8cc'),[3.4,.9,.9],[X_STATION,-3.9,platformZ+.45]);block(M.concreteDark,[3.5,1,.06],[X_STATION,-3.9,platformZ+.93]);

 // ── 街廓：空檔與底座邊補色塊房子。避開軌道、路塹、陸橋、臨時後站。跟車鏡頭在 +y 那側，那邊第一排壓低，才不會擋到車。
 const walls=['#d9d3c4','#cfc7b4','#c7c0ae','#d8cfbd','#bfc2b6','#cdb9a6'].map(c=>mat(c)),roofs=mat('#7d8279');
 const clear=(x,y,w,d)=>Math.abs(y)-d/2>=4.6&&Math.abs(x-X_UNDER)>=UNDER_W/2+.7+w/2&&Math.abs((x-X_BRIDGE)*SY-y*CX)>=BW+.9+(w*SY+d*CX)/2&&!(x+w/2>X_STATION+6&&x-w/2<X_STATION+33&&y+d/2>13&&y-d/2<22);
 function fill(x0,x1,y0,y1,w=5.2,d=4.4){for(let x=x0+w/2;x<=x1-w/2+.01;x+=w+.3)for(let y=y0+d/2;y<=y1-d/2+.01;y+=d+.9){if(!clear(x,y,w,d))continue;
  const h=Math.min(1.8+k.rand()*2.6,y>0?(y-d/2-2.6)/1.54:9),z=groundAt(x)-.02;block(walls[Math.floor(k.rand()*walls.length)],[w,d,h],[x,y,z+h/2]);block(roofs,[w+.12,d+.12,.12],[x,y,z+h+.06]);}}
 fill(-119.4,-97,Y_MIN_STATION+.5,-5);fill(-119.4,-97,7,Y_MAX-.4);
 fill(STATION_LO+.4,STATION_HI-.4,14,Y_MAX-.4);
 fill(GAP_LO+.3,GAP_HI-.3,Y_MIN_CROSS+.4,-5,3.6);fill(GAP_LO+.3,GAP_HI-.3,7,Y_MAX-.4,3.6);
 fill(RAMP_LO+.5,RAMP_HI-.5,Y_MIN_RAMP+.4,-5);fill(RAMP_LO+.5,RAMP_HI-.5,7,Y_MAX-.4);
 fill(RAMP_HI+.5,HALF-.5,24,Y_MAX-.3,5.2,3.6);

 // ── 底座：外框跟著各段的深度走（平交道那段的路在底座邊被切掉，同單座場景）。
 for(const [m,v] of sets){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();k.mesh(k.geo(g),m);}
 const shape=new THREE.Shape([[-HALF,Y_MIN_STATION],[GAP_LO,Y_MIN_STATION],[GAP_LO,Y_MIN_CROSS],[RAMP_LO,Y_MIN_CROSS],[RAMP_LO,Y_MIN_RAMP],[HALF,Y_MIN_RAMP],[HALF,Y_MAX],[-HALF,Y_MAX]].map(p=>new THREE.Vector2(...p)));
 k.mesh(k.geo(new THREE.ExtrudeGeometry(shape,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2})),mat('#a28c6a'),[0,0,BASE-1.25]);
 k.mesh(k.geo(new THREE.ExtrudeGeometry(shape,{depth:.23,bevelEnabled:true,bevelSize:.43,bevelThickness:.1,bevelSegments:2})),mat('#614f3a'),[0,0,BASE-1.41]);

 const glue=k.result({path,anchors:{},label:'台南沿線',themes:THEMES,camera:{yaw:-1.38,elevation:.5,radius:140}});
 root.add(glue.group,station.group,crossing.group,guanghua.group);
 return{group:root,path,opposingPath,contactWireZ:R+WIRE-.0125,focus:[0,0,1.5],parts:{station,crossing,guanghua},
  update(time,period,train){
   glue.update(time,period);station.update(time,period);
   // 平交道的循環吃「車心到平交道的距離」；對向車 x＝−s。
   crossing.update(time,period,{...train,distance:train.distance-X_CROSS,opposingDistance:(train.opposingDistance??train.distance)+X_CROSS});
   // 光華街轉了半圈又搬了位置，拍照的人看車要換回它自己的座標。
   guanghua.update(time,period,{...train,cars:(train.cars??[]).map(([x,y,z])=>[X_CULVERT-x,-y,z-gz])});
  },
  get state(){return{crossing:crossing.state,guanghua:guanghua.state};},
  dispose(){glue.dispose();station.dispose();crossing.dispose();guanghua.dispose();}};
}

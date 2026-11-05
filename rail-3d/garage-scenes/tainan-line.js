import * as THREE from '../vendor/three.module.js';
import {createKit} from './metro-kit.js';
import {createStage} from './station-stage.js';
import {THEMES} from './tainan.js';
import {createScene as createCrossing} from './crossing.js';
import {createScene as createGuanghua,METER,UNIT_PER_M} from './guanghua.js';
import {META,FRAME,TRACK,OUTLINE,GROUND,BLOCKS,BUILDINGS,TREES,BRIDGE,ROADS} from './tainan-line-data.js';
export {THEMES,METER,UNIT_PER_M};
// 台南市區地面鐵道沿線：小東路地下道、台南車站、青年路平交道、東門陸橋、光華街涵洞接在同一條雙線上。時期：10 月通車前最後的樣子。
// 路線、路面、街廓、建物都是真實位置（tainan-line-data.js），世界座標：原點是青年路平交道、+x 沿那裡的鐵路往南、+y 往東，1 公尺 .42 單位。
// 地圖分三個窗口（小東路、車站、青年路到光華街），窗口內沒有變形：同一個旋轉，只有平移；窗口之間的直線段抽掉，接線區是一條綠帶。
// 軌頂全線同高（garage-diorama.js 的 contactWireZ 只有一個值），地面在青年路以南往光華街緩降：實際是路基抬高，模型改成地面降低，相對高度一樣。
const LAP=META.lap,R=.36,WIRE=1.95,GAUGE=.46,BASE=-2.35;
const {rho:RHO,xEnd:XE,kink:[K0,K1],g:[G0,G1]}=META;
const G=x=>x<=K0?G0:x>=K1?G1:G0+(G1-G0)*(x-K0)/(K1-K0);
const lerp=(a,b,t)=>a+(b-a)*Math.max(0,Math.min(1,t)),smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const color=(r,g,b)=>new THREE.Color().setRGB(r/255,g/255,b/255,THREE.SRGBColorSpace),hex=h=>new THREE.Color(h);
const tableTrack=(p,from)=>{const n=p.length/2-1,pt=s=>{const f=s-from,i=Math.max(0,Math.min(n-1,Math.floor(f))),t=f-i;return[p[i*2]+(p[i*2+2]-p[i*2])*t,p[i*2+1]+(p[i*2+3]-p[i*2+1])*t];};
 return s=>{const a=pt(s-.9),b=pt(s+.9),c=pt(s);return{x:c[0],y:c[1],z:R,heading:Math.atan2(b[1]-a[1],b[0]-a[0])};};};
// 局部框架（u 沿線往南、v 往東）→ 世界。
const frameAt=f=>{const c=Math.cos(f.h),s=Math.sin(f.h);return(u,v)=>[f.x+u*c-v*s,f.y+u*s+v*c];};
// 一批三角形：位置、頂點色，法向量照三角形算。
function soup(){const pos=[],col=[];return{pos,col,
 tri(a,b,c,ca,cb=ca,cc=ca){pos.push(...a,...b,...c);col.push(ca.r,ca.g,ca.b,cb.r,cb.g,cb.b,cc.r,cc.g,cc.b);},
 quad(a,b,c,d,ca,cb=ca,cc=cb,cd=ca){this.tri(a,b,c,ca,cb,cc);this.tri(a,c,d,ca,cc,cd);},
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();return g;}};}

function uvSoup(){const pos=[],col=[],uv=[];return{
 panel(a,b,z0,z1,c0,c1,m){const q=[[...a,z0],[...b,z0],[...b,z1],[...a,z1]],cs=[c0,c0,c1,c1],us=m.length===2?[m,m,m,m]:[[m[0],m[2]],[m[1],m[2]],[m[1],m[3]],[m[0],m[3]]];for(const i of [0,1,2,0,2,3]){pos.push(...q[i]);col.push(cs[i].r,cs[i].g,cs[i].b);uv.push(...us[i]);}},
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;}};}
// 外牆貼圖：4 開間 × 4 層一張，白底（乘頂點色）。窗、鐵窗、窗台在 albedo，晚上亮的窗在 lit。左上角兩小塊留給沒開窗的牆（白、不亮）與店面招牌（白、亮）。
function facade(size=256){const B=size/4,sheet=()=>{const c=document.createElement('canvas');c.width=c.height=size;return c;},A=sheet(),L=sheet(),a=A.getContext('2d'),l=L.getContext('2d');let seed=20261017;const rnd=()=>(seed=seed*16807%2147483647)/2147483647,pick=x=>x[Math.floor(rnd()*x.length)];
 a.fillStyle='#fff';a.fillRect(0,0,size,size);l.fillStyle='#000';l.fillRect(0,0,size,size);
 for(let fy=0;fy<4;fy++)for(let bx=0;bx<4;bx++){const x=bx*B,y=fy*B,kind=rnd();a.fillStyle='#d6d2c8';a.fillRect(x,y,B,3);if(kind<.12)continue;
  const w=kind<.62?44:28,h=kind<.62?32:38,wx=x+12+Math.floor((B-12-w)/2),wy=y+16;a.fillStyle=pick(['#39444c','#2f3a42','#46525a','#55636a']);a.fillRect(wx,wy,w,h);
  a.fillStyle='rgba(205,208,205,.72)';for(let i=1;i<4;i++)a.fillRect(wx+i*w/4-1,wy,2,h);a.fillRect(wx,wy+h/2-1,w,2);a.fillStyle='#b4b1a7';a.fillRect(wx-2,wy+h,w+4,3);
  if(rnd()<.4){l.fillStyle=pick(['#ffdf9e','#ffe9c4','#fff2dc','#ffcf85']);l.fillRect(wx+1,wy+1,w-2,h-2);}}
 l.fillStyle='#fff';l.fillRect(2,18,4,4);
 const tex=(c,srgb)=>{const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;};
 return{size,albedo:tex(A,true),lit:tex(L,true)};}

// 車站：站房模型與月台放在真實位置。u＝里程、v＝偏移（都已換成單位），群組沿站區的弦旋轉。
function buildStation(parts){
 const s=createStage({seed:20462,trees:[['delonix',.65],['ficus',.35]],plinth:[60,40,3]}),{k}=s,{M,mat,block,groundZ}=k;
 for(const o of k.group.children.slice(0,3))k.group.remove(o);
 const T={E:META.off.TE*RHO,W:META.off.TW*RHO,M:META.off.TM*RHO},edge=1.75*RHO,c=v=>v*RHO;
 s.station(parts,{scale:RHO,x:5.3,y:-21.8});
 const p2=s.platform(T.E,{side:-1,length:c(314),width:c(6.5),x:c(-29),edge}),p1=s.platform(T.W,{side:-1,length:c(324),width:c(12.4),x:c(10),edge});
 s.canopy(p2,{from:c(-141+29),to:c(97+29),color:'#7a6b58',lights:1});s.canopy(p1,{from:c(-95-10),to:c(105-10),color:'#8e918a',lights:0});
 s.furnish(p2,{name:'臺南',stairs:false});s.furnish(p1,{stairs:false,bench:7});
 const wall=mat('#dcd8cc'),white=mat('#e9e6dc'),grey=mat('#a8a79e'),col=mat('#8f9692',{metalness:.3,roughness:.6}),glass=M.glass,Z=s.railZ+2.75,TOP=1.3;
 // 站內人行地下道的兩座出入口（OSM way 1086654950）
 for(const [p,y] of [[p2,c(1.3)],[p1,c(-15)]]){block(wall,[4.2,1.5,.9],[c(38),y,p.z+.45]);block(glass,[3.8,1.54,.42],[c(38),y,p.z+.56]);block(M.concreteDark,[4.3,1.6,.06],[c(38),y,p.z+.93]);}
 // 跨線通廊：一段方盒子，地板 Z、屋頂 Z＋TOP。
 function tube(u0,u1,v0,v1,roof=white,{legs=true}={}){const du=c(u1-u0),dv=c(v1-v0),x=c(u0+u1)/2,y=c(v0+v1)/2,alongV=dv>du;
  block(grey,[du,dv,.18],[x,y,Z]);block(wall,[du-.1,dv-.1,TOP-.1],[x,y,Z+TOP/2]);block(roof,[du+.14,dv+.14,.14],[x,y,Z+TOP+.05]);
  for(const q of alongV?[[du/2+.012,0,.03,dv-.5]]:[[0,dv/2+.012,du-.5,.03]]){block(glass,[alongV?.03:q[2],alongV?q[3]:.03,.5],[x+q[0],y+q[1],Z+.8]);block(glass,[alongV?.03:q[2],alongV?q[3]:.03,.5],[x-q[0],y-q[1],Z+.8]);}
  if(legs){const n=Math.max(1,Math.round((alongV?dv:du)/6.5));for(let i=0;i<=n;i++){const a=alongV?x:x-du/2+du*i/n,b=alongV?y-dv/2+dv*i/n:y,free=[T.E,T.W,T.M].every(t=>Math.abs(b-t)>1.1);if(free)block(col,[.34,.34,Z-groundZ],[a,b,(Z+groundZ)/2]);}}}
 function ramp(u0,u1,v0,v1,zHigh,zLow){const L=c(Math.abs(u1-u0)),w=c(v1-v0),rise=zHigh-zLow,len=Math.hypot(L,rise),pitch=Math.atan2(rise,L)*(u1>u0?-1:1),x=c(u0+u1)/2,y=c(v0+v1)/2,z=(zHigh+zLow)/2;
  block(grey,[len,w,.14],[x,y,z],[0,pitch,0]);block(white,[len+.3,w+.16,.12],[x,y,z+TOP+.04],[0,pitch,0]);for(const s2 of [-1,1])block(wall,[len,.08,TOP],[x,y+s2*w/2,z+TOP/2],[0,pitch,0]);}
 // 站內跨線天橋（OSM way 575042589，影像上的白色屋頂）與兩端電梯
 tube(-16,-9,-23,3);block(wall,[1.5,1.5,Z+TOP-p2.z],[c(-12.5),c(1.5),(Z+TOP+p2.z)/2]);block(wall,[1.5,1.5,Z+TOP-p1.z],[c(-12.5),c(-21),(Z+TOP+p1.z)/2]);
 // 跨站天橋（OSM way 1228832635 等，位置照影像）：東側臨時後站接過來，越過軌道到第一月台南端的通廊
 tube(130,137,-1,44);tube(120,137,-20,-1,grey);
 ramp(120,97,-2,3,Z,p2.z);ramp(120,105,-17,-12,Z,p1.z);
 {const a=[133.5,44],b=[116,52],L=c(Math.hypot(b[0]-a[0],b[1]-a[1])),yaw=Math.atan2(b[1]-a[1],b[0]-a[0]),x=c(a[0]+b[0])/2,y=c(a[1]+b[1])/2,w=c(7);block(grey,[L,w,.18],[x,y,Z],[0,0,yaw]);block(wall,[L,w-.1,TOP-.1],[x,y,Z+TOP/2],[0,0,yaw]);block(white,[L+.2,w+.14,.14],[x,y,Z+TOP+.05],[0,0,yaw]);block(col,[.34,.34,Z-groundZ],[x,y,(Z+groundZ)/2]);}
 // 站前：站名、計程車排班、機車
 s.label('臺南車站',5.3,-28.5,groundZ+2.54,3.76,.49,{bg:'#e6dfc9',fg:'#5a4a2a',depth:.05});
 for(let x=-9;x<=4;x+=2.1)k.car(x,-30.4,{taxi:true,kind:'sedan',yaw:Math.PI});
 s.scooters(13,19,-28,.44);s.bikes(23,-27,6);
 k.addLight('entrance',5.3,-28.6,groundZ+2.2,1.3,7);
 return s;
}

export function createScene(kits){
 const stage=buildStation(kits[0]),crossing=createCrossing({bare:true,half:META.openHalf,road:52,loops:2}),guanghua=createGuanghua(kits.slice(1));
 const k=createKit({seed:20261017,plinth:[2*XE,160,3]}),{M,block,mat,along,strips,at}=k,root=new THREE.Group();
 for(const o of k.group.children.slice(0,3))k.group.remove(o);
 // ── 三股軌道。主路徑走東股往南，對向走西股往北；s＝0 都在平交道。
 const sampleE=tableTrack(TRACK.E,TRACK.from),sampleW=tableTrack(TRACK.W,TRACK.fromW),[e0,e1]=META.sEnd.E,[w0,w1]=META.sEnd.W;
 const path={length:LAP,trackStart:e0,trackLength:e1-e0,sample:sampleE};
 const opposingPath={length:LAP,trackStart:-w1,trackLength:w1-w0,sample:s=>{const q=sampleW(-s);return{...q,heading:q.heading+Math.PI};}};
 const piece=(sample,from,to)=>({length:LAP,trackStart:from,trackLength:to-from,sample});
 const pieces={E:[piece(sampleE,e0,META.ghEdge.E[0]),piece(sampleE,META.ghEdge.E[1],e1)],W:[piece(sampleW,w0,META.ghEdge.W[0]),piece(sampleW,META.ghEdge.W[1],w1)]};
 const mLen=TRACK.M.length/2-1,sampleM=(()=>{const f=tableTrack(TRACK.M,0);return s=>f(s*mLen/100);})(),mid=piece(sampleM,0,100);
 function laid(p,len=p.trackLength){const N=Math.ceil(len/1.6);
  strips(p,M.ballast,[[-1.45,-.23,-1.05,-.18],[-1.05,-.18,1.05,-.18],[1.05,-.18,1.45,-.23]],{N});
  strips(p,M.steel,[-GAUGE,GAUGE].map(o=>[o-.05,0,o+.05,0]),{N}).name='rail-head';
  strips(p,M.railSide,[-GAUGE,GAUGE].flatMap(o=>[[o-.05,-.12,o-.05,0],[o+.05,0,o+.05,-.12]]),{N}).name='rail-web';
  strips(p,M.wire,[[-.016,WIRE,.016,WIRE]],{N}).name='contact-wire';strips(p,M.wire,[[-.014,WIRE+.34,.014,WIRE+.34]],{N}).name='messenger-wire';}
 for(const list of [pieces.E,pieces.W])for(const p of list){laid(p);along(p,.46,q=>block(M.sleeper,[.18,GAUGE*2+.48,.10],at(q,0,-.17),[0,0,q.heading]));}
 laid(mid,mLen*2*1);along(mid,.46*100/(mLen*2),q=>block(M.sleeper,[.18,GAUGE*2+.48,.10],at(q,0,-.17),[0,0,q.heading]));
 // 電桿：約 50 公尺一根，平交道、天橋、陸橋下面不立。站內西股與中股共用股道間的桿。
 const inStation=q=>{const u=(q.x-FRAME.station.x)*Math.cos(FRAME.station.h)+(q.y-FRAME.station.y)*Math.sin(FRAME.station.h);return u>-70&&u<76;},nearBridge=q=>Math.hypot(q.x-136.4,q.y-31.3)<9;
 const mast=(q,o)=>{const h=[0,0,q.heading];block(M.mast,[.15,.15,2.72],at(q,o,1.13));block(M.mast,[.08,Math.abs(o)+.2,.08],at(q,o/2,WIRE+.59),h);block(M.mast,[.06,.06,.6],at(q,0,WIRE+.3));};
 for(const [list,o] of [[pieces.E,1.42],[pieces.W,-1.42]])for(const p of list)along(p,21,(q,s)=>{if(Math.abs(s)<6||nearBridge(q)||(o<0&&inStation(q)))return;mast(q,o);});
 along(piece(sampleW,-268,-60),21,q=>{if(!inStation(q))return;const a=at(q,1.6,0);block(M.mast,[.15,.15,2.72],[a[0],a[1],R+1.13]);block(M.mast,[.08,3.4,.08],at(q,1.6,WIRE+.59),[0,0,q.heading]);});
 // 工區圍籬、鐵路邊的矮牆
 const fence=mat('#bcc6c4',{side:THREE.DoubleSide,roughness:.7}),lowWall=mat('#a9a79c',{side:THREE.DoubleSide});
 for(const p of pieces.E)strips(p,fence,[[2.45,-1.2,2.45,.8]],{N:Math.ceil(p.trackLength/4)});
 for(const [a,b] of [[w0,-205],[-25,META.ghEdge.W[0]],[META.ghEdge.W[1],w1]])strips(piece(sampleW,a,b),lowWall,[[-2.2,-1.2,-2.2,.28]],{N:Math.ceil((b-a)/4)});

 // ── 地面：路面鋪滿底座，鐵路用地、工區、街廓一層層蓋上去。
 const ground=soup(),addFlat=(t,dz,c)=>{for(let i=0;i<t.length;i+=6){const a=[t[i],t[i+1],G(t[i])+dz],b=[t[i+2],t[i+3],G(t[i+2])+dz],d=[t[i+4],t[i+5],G(t[i+4])+dz];ground.tri(a,b,d,c);}};
 addFlat(GROUND.asphalt,0,hex('#63666a'));addFlat(GROUND.rail,.012,hex('#8d887b'));addFlat(GROUND.site,.022,hex('#ad9c84'));addFlat(GROUND.green,.045,hex('#869569'));
 const curbC=hex('#bdb8a8');
 for(const b of BLOCKS){addFlat(b.t,.045,color(...b.c.map(v=>v*.84)));for(const r of b.r)for(let i=0;i<r.length;i+=2){const j=(i+2)%r.length,x0=r[i],y0=r[i+1],x1=r[j],y1=r[j+1];ground.quad([x0,y0,G(x0)],[x1,y1,G(x1)],[x1,y1,G(x1)+.045],[x0,y0,G(x0)+.045],curbC);}}
 // 底座側面
 const soil=hex('#9a7a58');for(let i=0;i<OUTLINE.length;i+=2){const j=(i+2)%OUTLINE.length,x0=OUTLINE[i],y0=OUTLINE[i+1],x1=OUTLINE[j],y1=OUTLINE[j+1];ground.quad([x0,y0,BASE],[x1,y1,BASE],[x1,y1,G(x1)],[x0,y0,G(x0)],soil);}
 // 路基：地面比道碴低的那段墊到軌頂下 .25，兩側緩坡
 const bank=hex('#8d887a'),slope=hex('#7f8c63');
 for(const [a,b] of [[K0-2,META.ghEdge.E[0]],[META.ghEdge.E[1],e1]]){const n=Math.ceil((b-a)/2.4);for(let i=0;i<n;i++){const s0=lerp(a,b,i/n),s1=lerp(a,b,(i+1)/n),Ea=sampleE(s0),Eb=sampleE(s1),Wa=sampleW(s0),Wb=sampleW(s1),top=R-.25;
  const out=(q,o,z)=>[...at(q,o).slice(0,2),z];
  ground.quad(out(Wa,-1.28,top),out(Wb,-1.28,top),out(Eb,1.28,top),out(Ea,1.28,top),bank);
  ground.quad(out(Wa,-3,G(Wa.x)-.04),out(Wb,-3,G(Wb.x)-.04),out(Wb,-1.28,top),out(Wa,-1.28,top),slope);
  ground.quad(out(Eb,3,G(Eb.x)-.04),out(Ea,3,G(Ea.x)-.04),out(Ea,1.28,top),out(Eb,1.28,top),slope);}}

 // ── 小東路地下道：四孔（中間兩孔汽車淨高 4.2 公尺、外側兩孔機車 2.1 公尺），鐵路用板橋跨過去。c、o 是里程與偏移（公尺）。
 const UF=frameAt(FRAME.under),uw=(c,o)=>UF((c+493)*RHO,o*RHO),{c0:UC0,c1:UC1,oW:UOW,oE:UOE}=META.off.cut,deckBottom=-.05;
 const zLane=(o,drop)=>{const a=Math.abs(o),end=(o<0?-UOW:UOE)-6;return lerp(deckBottom-drop,G0,smooth((a-15)/(end-15)));};
 const lanes=[[-510,-501,2.1*RHO],[-499.5,-491.5,4.2*RHO],[-490.5,-484,4.2*RHO],[-482.5,-476,2.1*RHO]],walls=[[UC0,-510],[-501,-499.5],[-491.5,-490.5],[-484,-482.5],[-476,UC1]];
 const road=hex('#5a5d60'),wallC=hex('#bab5a6'),wallD=hex('#9c978b'),top=G0+.1,oStep=4;
 const floorOf=(c,o)=>{for(const l of lanes)if(c>=l[0]-.01&&c<=l[1]+.01)return zLane(o,l[2]);return G0;};
 for(let o=UOW;o<UOE-1e-6;o+=oStep){const o1=Math.min(UOE,o+oStep);
  for(const [a,b,drop] of lanes){const z0=zLane(o,drop),z1=zLane(o1,drop);ground.quad([...uw(a,o),z0],[...uw(b,o),z0],[...uw(b,o1),z1],[...uw(a,o1),z1],road);}
  for(const [a,b] of walls){ground.quad([...uw(a,o),top],[...uw(b,o),top],[...uw(b,o1),top],[...uw(a,o1),top],wallC);
   const fa=[floorOf(a-.5,o),floorOf(a-.5,o1)],fb=[floorOf(b+.5,o),floorOf(b+.5,o1)];
   ground.quad([...uw(a,o1),fa[1]],[...uw(a,o),fa[0]],[...uw(a,o),top],[...uw(a,o1),top],wallD);ground.quad([...uw(b,o),fb[0]],[...uw(b,o1),fb[1]],[...uw(b,o1),top],[...uw(b,o),top],wallD);}}
 for(const [o,s] of [[UOW,-1],[UOE,1]])for(const [a,b] of [[UC0,UC1]]){const p=uw(a,o),q=uw(b,o);ground.quad(s<0?[...p,BASE]:[...q,BASE],s<0?[...q,BASE]:[...p,BASE],s<0?[...q,G0]:[...p,G0],s<0?[...p,G0]:[...q,G0],soil);}
 const concrete=mat('#bab5a6'),concreteDark=mat('#9c978b');
 {const [cx,cy]=uw((UC0+UC1)/2,3),L=(UC1-UC0)*RHO,Wd=26*RHO,h=[0,0,FRAME.under.h];block(concreteDark,[L,Wd,G0-deckBottom],[cx,cy,(G0+deckBottom)/2],h);for(const s of [-1,1]){const [x,y]=uw((UC0+UC1)/2,3+s*13);block(concrete,[L,.18,.5],[x,y,G0+.13],h);}}

 // ── 東門陸橋：OSM 的線形（way 413128684 與西端兩支匝道），鐵路上方橋面離軌頂約 7.3 公尺，東端落在東門路一段。
 const TOPZ=3.43,asph=hex('#5f6264'),side=hex('#bab5a6'),under=hex('#9c978b');
 const bridgePier=[];
 function deck(pts,zAt,bw){const seg=[];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2.2));for(let j=0;j<n;j++)seg.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}seg.push(pts.at(-1));
  const cum=[0];for(let i=1;i<seg.length;i++)cum.push(cum[i-1]+Math.hypot(seg[i][0]-seg[i-1][0],seg[i][1]-seg[i-1][1]));const L=cum.at(-1);
  const P=seg.map((p,i)=>{const a=seg[Math.max(0,i-1)],b=seg[Math.min(seg.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/l,ny=(b[0]-a[0])/l,z=zAt(cum[i],L),g=G(p[0]);return{x:p[0],y:p[1],nx,ny,z,g,lo:z-g<1.3?g-.1:z-.46};});
  for(let i=0;i+1<P.length;i++){const a=P[i],b=P[i+1],l=(p,z)=>[p.x+p.nx*bw,p.y+p.ny*bw,z],r=(p,z)=>[p.x-p.nx*bw,p.y-p.ny*bw,z];
   ground.quad(r(a,a.z),r(b,b.z),l(b,b.z),l(a,a.z),asph);
   if(bw>2)for(const o of [-.1,.1]){const e=(p,s)=>[p.x+p.nx*(o+s*.035),p.y+p.ny*(o+s*.035),p.z+.008];ground.quad(e(a,-1),e(b,-1),e(b,1),e(a,1),hex('#d3ad45'));}ground.quad(l(a,a.lo),r(a,a.lo),r(b,b.lo),l(b,b.lo),under);
   ground.quad(r(b,b.lo),r(a,a.lo),r(a,a.z+.32),r(b,b.z+.32),side);ground.quad(l(a,a.lo),l(b,b.lo),l(b,b.z+.32),l(a,a.z+.32),side);
   ground.quad(r(a,a.z),r(b,b.z),r(b,b.z+.32),r(a,a.z+.32),side);ground.quad(l(b,b.z),l(a,a.z),l(a,a.z+.32),l(b,b.z+.32),side);}
  for(let s=6,i=0;s<L;s+=13){while(i<P.length-1&&cum[i]<s)i++;const p=P[i],h=p.z-.46-p.g;if(h<1.1)continue;const rail=Math.hypot(p.x-136.4,p.y-31.3);if(rail<7.5)continue;bridgePier.push([p.x,p.y,p.g,h,Math.atan2(p.ny,p.nx),bw]);}}
 const Lm=Math.hypot(BRIDGE.main[1][0]-BRIDGE.main[0][0],BRIDGE.main[1][1]-BRIDGE.main[0][1]),crest=Lm*.82,zJ=2.1;
 deck(BRIDGE.main,(s,L)=>{const g=G(BRIDGE.main[0][0]+(BRIDGE.main[1][0]-BRIDGE.main[0][0])*s/L)+.02;if(s<crest-6){const t=s/(crest-6);return g+(TOPZ-g)*(t*.45+smooth(t)*.55);}if(s<crest+3)return TOPZ;return lerp(TOPZ,zJ,(s-crest-3)/(L-crest-3));},2.35);
 for(const pts of [[...BRIDGE.rampA].reverse(),BRIDGE.rampB]){const end=pts.at(-1);deck(pts,(s,L)=>{const g=G(end[0])+.02,t=s/L;return zJ+(g-zJ)*(t*.5+smooth(t)*.5);},1.4);}
 for(const [x,y,g,h,yaw,bw] of bridgePier){block(concreteDark,[.9,bw*1.3,h],[x,y,g+h/2],[0,0,yaw-Math.PI/2]);}

 // ── 建物：真實輪廓擠出，屋頂色取自影像。牆分三種：貼鄰棟的是空牆，朝巷弄的開窗，朝馬路的開窗再加一樓店面與招牌；依 x 分塊，鏡頭看不到的塊不畫。
 const CHUNK=40,chunkOf=(map,x,make)=>{const c=Math.floor((x+XE)/CHUNK);if(!map.has(c))map.set(c,make());return map.get(c);};
 const wallChunks=new Map(),solidChunks=new Map(),wallsAt=x=>chunkOf(wallChunks,x,uvSoup),solidAt=x=>chunkOf(solidChunks,x,soup);
 const FLOOR=3.3*RHO,BAY=3.6*RHO,TEX=facade(),PLAIN=[2.5/TEX.size,1-10.5/TEX.size],GLOW=[3.5/TEX.size,1-20.5/TEX.size];
 const shops=['#3f4548','#4c4a46','#2f373c','#55504a','#454b4f','#5b5247'].map(hex),signs=['#b8483a','#d2ac4a','#3c6e9c','#dcd8cc','#3f8360','#c96f3a','#e9e6dc','#9c4a6c','#2f4560','#dcd8cc','#cfcabb','#e9e6dc'].map(hex);
 const tone=(r,g,b)=>{const m=(r+g+b)/3,f=v=>Math.max(0,Math.min(255,(m+(v-m)*1.5)*.9));return color(f(r),f(g),f(b));};
 const tanks=['#d8dbd9','#c9ccc8','#9db0bb'].map(hex),sheds=['#6d8aa3','#a06a4c','#9b9c96','#7a9580','#b7b6ac'].map(hex);
 const inside=(q,p)=>{let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>q[1])!==(p[j+1]>q[1])&&q[0]<(p[j]-p[i])*(q[1]-p[i+1])/(p[j+1]-p[i+1])+p[i])c=!c;return c;};
 const prism=(out,x,y,r,z0,z1,c,n=6)=>{const P=i=>[x+Math.cos(i/n*6.283)*r,y+Math.sin(i/n*6.283)*r];for(let i=0;i<n;i++){const a=P(i),b=P(i+1);out.quad([...a,z0],[...b,z0],[...b,z1],[...a,z1],c);out.tri([x,y,z1],[...a,z1],[...b,z1],c);}};
 const box=(out,x,y,sx,sy,yaw,z0,z1,c)=>{const co=Math.cos(yaw),si=Math.sin(yaw),P=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[x+a*sx*co-b*sy*si,y+a*sx*si+b*sy*co]);for(let i=0;i<4;i++){const a=P[i],b=P[(i+1)%4];out.quad([...a,z0],[...b,z0],[...b,z1],[...a,z1],c);}out.quad([...P[0],z1],[...P[1],z1],[...P[2],z1],[...P[3],z1],c);};
 for(const [h,rr,rg,rb,wr,wg,wb,p,kinds] of BUILDINGS){const n=p.length/2;let cx=0,cy=0,gl=9,gh=-9,area=0,longest=0,yaw=0;
  for(let i=0;i<n;i++){const j=(i+1)%n;cx+=p[i*2];cy+=p[i*2+1];const g=G(p[i*2]);gl=Math.min(gl,g);gh=Math.max(gh,g);area+=p[i*2]*p[j*2+1]-p[j*2]*p[i*2+1];const l=Math.hypot(p[j*2]-p[i*2],p[j*2+1]-p[i*2+1]);if(l>longest){longest=l;yaw=Math.atan2(p[j*2+1]-p[i*2+1],p[j*2]-p[i*2]);}}
  cx/=n;cy/=n;area/=2;let seed=Math.abs(Math.floor(cx*131+cy*977))+1;const rnd=()=>(seed=seed*16807%2147483647)/2147483647,pick=a=>a[Math.floor(rnd()*a.length)];
  const walls=wallsAt(cx),solid=solidAt(cx),z0=gl-.03,z1=gh+.045+h,top=color(wr,wg,wb),low=color(wr*.84,wg*.84,wb*.85),roof=tone(rr,rg,rb),at=z=>low.clone().lerp(top,(z-z0)/(z1-z0)),tall=h>7.5,zShop=z0+FLOOR*.74,zSign=z0+FLOOR*1.06,vOff=Math.floor(rnd()*4)/4;
  for(let i=0;i<n;i++){const j=(i+1)%n,a=[p[i*2],p[i*2+1]],b=[p[j*2],p[j*2+1]],len=Math.hypot(b[0]-a[0],b[1]-a[1]),kind=+kinds[i],uOff=Math.floor(rnd()*4)/4,win=(u0,u1,za,zb)=>[uOff+u0/(4*BAY),uOff+u1/(4*BAY),vOff+(za-z0)/(4*FLOOR),vOff+(zb-z0)/(4*FLOOR)];
   if(kind===0&&!tall){walls.panel(a,b,z0,z1,low,top,PLAIN);continue;}
   if(kind===2&&h>FLOOR*1.5){const m=Math.max(1,Math.round(len/2.1));
    for(let q=0;q<m;q++){const A=[a[0]+(b[0]-a[0])*q/m,a[1]+(b[1]-a[1])*q/m],B=[a[0]+(b[0]-a[0])*(q+1)/m,a[1]+(b[1]-a[1])*(q+1)/m],sc=pick(shops),gc=pick(signs);walls.panel(A,B,z0,zShop,sc,sc,GLOW);walls.panel(A,B,zShop,zSign,gc,gc,GLOW);}
    walls.panel(a,b,zSign,z1,at(zSign),top,win(0,len,zSign,z1));continue;}
   walls.panel(a,b,z0,z1,low,top,win(0,len,z0,z1));}
  const ring=[];for(let i=0;i<n;i++)ring.push(new THREE.Vector2(p[i*2],p[i*2+1]));
  for(const [a,b,d] of THREE.ShapeUtils.triangulateShape(ring,[]))solid.tri([ring[a].x,ring[a].y,z1],[ring[b].x,ring[b].y,z1],[ring[d].x,ring[d].y,z1],roof);
  // 屋頂：鐵皮加蓋、水塔。放得進去才放。
  if(area>7&&h>2){const s=Math.sqrt(area),r=rnd();
   if(r<.5){const sx=Math.min(s*.26,2.2),sy=sx*(.6+rnd()*.4);if([[0,0],[1,1],[-1,1],[1,-1],[-1,-1]].every(([u,v])=>inside([cx+(u*sx*Math.cos(yaw)-v*sy*Math.sin(yaw))*1.05,cy+(u*sx*Math.sin(yaw)+v*sy*Math.cos(yaw))*1.05],p)))box(solid,cx,cy,sx,sy,yaw,z1,z1+.85+rnd()*.3,pick(sheds));}
   const tx=cx+(rnd()-.5)*s*.6,ty=cy+(rnd()-.5)*s*.6;if(r>.15&&inside([tx,ty],p)){const c=pick(tanks);prism(solid,tx,ty,.3,z1+.3,z1+.95,c);box(solid,tx,ty,.24,.24,yaw,z1,z1+.3,hex('#8a8c86'));}}}
 // ── 樹：影像上的樹冠位置與大小；兩團低面數樹冠＋樹幹，併進同一批塊。
 const crown=new THREE.IcosahedronGeometry(1,0).toNonIndexed().attributes.position,trunkC=hex('#6d5a48'),leaf=['#5f7f4e','#6a8a55','#557547','#73925c'].map(hex);
 for(let i=0;i<TREES.length;i+=3){const x=TREES[i],y=TREES[i+1],r=TREES[i+2],out=solidAt(x),z=G(x)+.04,ht=r*1.7,t=r*.14+.05,seed=(Math.sin(x*12.9+y*78.2)*43758.5)%1,c=leaf[Math.floor(Math.abs(seed)*4)%4],cd=c.clone().multiplyScalar(.72);
  for(const [a,b] of [[0,1],[1,2],[2,0]]){const A=[[x-t,y-t],[x+t,y-t],[x,y+t]];out.quad([...A[a],z],[...A[b],z],[...A[b],z+ht],[...A[a],z+ht],trunkC);}
  for(const [ox,oy,oz,s] of [[0,0,ht+r*.25,1],[r*.5*Math.cos(seed*9),r*.5*Math.sin(seed*9),ht-.1*r,.72]])for(let v=0;v<crown.count;v+=3){const P=j=>[x+ox+crown.getX(v+j)*r*s,y+oy+crown.getY(v+j)*r*s,z+oz+crown.getZ(v+j)*r*s*.78];const up=j=>crown.getZ(v+j)>0?c:cd;out.tri(P(0),P(1),P(2),up(0),up(1),up(2));}}
 // ── 道路標線與停著的車：路面上才放。主幹道雙黃線、次要道路白虛線；騎樓前一排機車（車頭朝路緣），路上幾台汽車。
 const yellow=hex('#d3ad45'),white=hex('#d9d6cb'),strip=(a,b,o,w,c)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l,p=(q,s)=>[q[0]+nx*(o+s*w),q[1]+ny*(o+s*w),G(q[0])+.006];ground.quad(p(a,-1),p(b,-1),p(b,1),p(a,1),c);};
 let seed=20261106;const rnd=()=>(seed=seed*16807%2147483647)/2147483647,pick=a=>a[Math.floor(rnd()*a.length)];
 const paints=['#d9dbd9','#e7e7e2','#2f3338','#8b9096','#a33a2e','#2c4a6e','#c9c2b0'].map(hex),scoots=['#c4483a','#2f5f8a','#e4e1d8','#2f3338','#d6a53a','#5c8a6a','#8a8f96'].map(hex),dark=hex('#2b3036'),glass=hex('#3a4a55');
 const rings=BLOCKS.map(b=>b.r[0]),onBlock=q=>rings.some(r=>inside(q,r)),clear=(x,y)=>{if(Math.abs(x)<8&&Math.abs(y)<56||!inside([x,y],OUTLINE))return false;const t=sampleE(Math.max(e0,Math.min(e1,x)));return y<t.y-11||y>t.y+24;};
 function vehicle(x,y,yaw){const z=G(x)+.01,out=solidAt(x),c=Math.cos(yaw),s=Math.sin(yaw);box(out,x,y,.86,.32,yaw,z,z+.16,dark);box(out,x,y,.92,.37,yaw,z+.14,z+.4,pick(paints));box(out,x-.1*c,y-.1*s,.5,.33,yaw,z+.4,z+.62,glass);}
 function scooter(x,y,yaw){const z=G(x)+.01,out=solidAt(x);box(out,x,y,.36,.1,yaw,z,z+.26,pick(scoots));box(out,x-.1*Math.cos(yaw),y-.1*Math.sin(yaw),.2,.1,yaw,z+.26,z+.4,dark);}
 for(const [kind,p] of ROADS){let left=kind?1.3:0,on=true;for(let i=2;i<p.length;i+=2){const a=[p[i-2],p[i-1]],b=[p[i],p[i+1]],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(kind===0){strip(a,b,.1,.035,yellow);strip(a,b,-.1,.035,yellow);}
   else{let t=0;while(t<L){const n=Math.min(L,t+left),A=[a[0]+(b[0]-a[0])*t/L,a[1]+(b[1]-a[1])*t/L],B=[a[0]+(b[0]-a[0])*n/L,a[1]+(b[1]-a[1])*n/L];if(on&&n>t)strip(A,B,0,.04,white);left-=n-t;t=n;if(left<=1e-6){on=!on;left=on?1.3:2;}}}
   // 靠右的車道停一台（OSM 中線方向不一定是車流方向，兩邊都放）
   for(let t=rnd()*8;t<L;t+=7+rnd()*(kind?26:14)){const f=t/L,side=rnd()<.5?1:-1,yaw=Math.atan2(b[1]-a[1],b[0]-a[0])+(side<0?0:Math.PI),nx=-(b[1]-a[1])/L,ny=(b[0]-a[0])/L,o=side*(kind?1:1.5),x=a[0]+(b[0]-a[0])*f+nx*o,y=a[1]+(b[1]-a[1])*f+ny*o;if(clear(x,y)&&!onBlock([x,y]))vehicle(x,y,yaw);}}}
 for(const r of rings)for(let i=0;i<r.length;i+=2){const j=(i+2)%r.length,ax=r[i],ay=r[i+1],bx=r[j],by=r[j+1],L=Math.hypot(bx-ax,by-ay);if(L<3)continue;const nx=(by-ay)/L,ny=-(bx-ax)/L,yaw=Math.atan2(-ny,-nx);
   for(let t=1+rnd()*4;t<L-1;t+=5+rnd()*14){const n=2+Math.floor(rnd()*3);for(let q=0;q<n&&t+q*.36<L;q++){const f=(t+q*.36)/L,x=ax+(bx-ax)*f+nx*.5,y=ay+(by-ay)*f+ny*.5;if(clear(x+nx*.9,y+ny*.9)&&!onBlock([x+nx*.3,y+ny*.3]))scooter(x,y,yaw);}}}
 const vertexMat=mat('#ffffff',{vertexColors:true,roughness:.9});
 const wallMat=mat('#ffffff',{vertexColors:true,roughness:.92,map:TEX.albedo,emissive:'#ffffff',emissiveMap:TEX.lit,emissiveIntensity:0});
 wallMat.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance*=vColor;');};
 k.mesh(k.geo(ground.geometry()),vertexMat).name='tainan-ground';
 for(const [i,c] of solidChunks)k.mesh(k.geo(c.geometry()),vertexMat).name='tainan-city-'+i;
 for(const [i,c] of wallChunks)k.mesh(k.geo(c.geometry()),wallMat).name='tainan-walls-'+i;
 // ── 底座
 const shape=new THREE.Shape(Array.from({length:OUTLINE.length/2},(_,i)=>new THREE.Vector2(OUTLINE[i*2],OUTLINE[i*2+1])));
 k.mesh(k.geo(new THREE.ExtrudeGeometry(shape,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2})),mat('#a28c6a'),[0,0,BASE-1.25]);
 k.mesh(k.geo(new THREE.ExtrudeGeometry(shape,{depth:.23,bevelEnabled:true,bevelSize:.43,bevelThickness:.1,bevelSegments:2})),mat('#614f3a'),[0,0,BASE-1.41]);

 // ── 既有零件搬進來
 const stationResult=stage.finish({tracks:{main:path,other:opposingPath,contactWireZ:R+WIRE-.0115},label:'台南車站',themes:THEMES,anchors:{}});
 stationResult.group.position.set(FRAME.station.x,FRAME.station.y,R+.47);stationResult.group.rotation.z=FRAME.station.h;
 const dims=guanghua.dims,gz=R-dims.RAIL_Z,gg=guanghua.group;
 for(const o of [...gg.children])if(o.isMesh&&!o.isInstancedMesh&&['665440','b49c75'].includes(o.material.color?.getHexString()))gg.remove(o);
 gg.position.set(FRAME.culvert.x,FRAME.culvert.y,gz);gg.rotation.z=FRAME.culvert.h+Math.PI;gg.updateMatrixWorld(true);
 if(guanghua.scooter)for(const p of guanghua.scooter.clip)p.applyMatrix4(gg.matrixWorld); // 機車的裁切面是世界座標
 const toLocal=gg.matrixWorld.clone().invert(),v=new THREE.Vector3();
 // 點光上限：手機與 headless 都吃不下，留 5 盞（路燈、其他入口靠自發光材質）。
 const keep=new Set(['entrance','platform-0','culvert-lamp']);
 for(const g of [stationResult.group,gg]){const off=[];g.traverse(o=>{if(o.isLight&&!keep.has(o.name))off.push(o);});off.forEach(o=>o.parent.remove(o));}
 crossing.lights.slice(1).forEach(l=>l.parent.remove(l));crossing.nativeRigs.redLights.slice(1).forEach(l=>l.parent.remove(l));
 crossing.path.length=LAP;
 const glue=k.result({path,anchors:{},label:'台南沿線',themes:THEMES,camera:{yaw:-1.38,elevation:.5,radius:140},update:(time,t)=>{wallMat.emissiveIntensity=t.window*1.1;}});
 root.add(glue.group,stationResult.group,crossing.group,gg);
 return{group:root,path,opposingPath,contactWireZ:R+WIRE-.0125,focus:[0,30,1.5],parts:{station:stationResult,crossing,guanghua},
  update(time,period,train){
   glue.update(time,period);stationResult.update(time,period);
   crossing.update(time,period,train);
   guanghua.update(time,period,{...train,cars:(train.cars??[]).map(c=>v.set(...c).applyMatrix4(toLocal).toArray())});
  },
  get state(){return{crossing:crossing.state,guanghua:guanghua.state};},
  dispose(){TEX.albedo.dispose();TEX.lit.dispose();glue.dispose();stationResult.dispose();crossing.dispose();guanghua.dispose();}};
}

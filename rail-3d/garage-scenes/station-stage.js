// 台鐵特色車站（新竹、台南、台中舊站、嘉義、保安、集集、冬山、舊高雄、海線）的共用舞台：站房是照片校正過的模型
// （rail-3d/assets/garage-stations-v1，scripts/build_garage_stations.mjs 轉的，一種材質一個零件），舞台給軌道、月台、雨棚、站前廣場、街道與背景的零件。
// 版面：站房正面朝 −y（全景鏡頭那側），前面是廣場與馬路，軌道在站房後方（+y）。靠左行駛：主路徑是 +y 那股、往 +x，對向是 −y 那股、往 −x。
// 站房會擋住跟車的視線，所以這幾座的 SCENES 帶 trainYaw：跟車鏡頭從 +y 側看月台那面；軌道後方的東西要矮（離軌道 d 的地方高度 ≤ .447d）才不擋車。
// 同 metro-kit.js：材質只用 MeshStandardMaterial，幾何全在 createScene 裡建好，App 烘成靜態；1 公尺約 .42 單位（車寬 1.25）。
import {createKit} from './metro-kit.js';

// 三時段的底子；各座改 background 就好。
export const themes=(day='#e4ebee',sunset='#f0d4b8',night='#121c2b',water={})=>({
 day:{background:day,sun:'#fff3d8',ambient:'#c4d6e4',ground:'#8b9a72',power:3.0,exposure:1.04,lamp:0,window:0,...water.day},
 sunset:{background:sunset,sun:'#ffaa62',ambient:'#d6b8ac',ground:'#7b7a5d',power:2.9,exposure:.94,lamp:.5,window:.45,...water.sunset},
 night:{background:night,sun:'#9cbbe2',ambient:'#566f8d',ground:'#262f3b',power:.7,exposure:.78,lamp:1,window:1,...water.night}
});

export function createStage({seed=1,grass,trees,plinth}={}){
 const k=createKit({seed,grass,trees,plinth});
 const {THREE,M,mat,geo,mesh,block,instance,rand,groundZ,props,prism,cylinder,pool,inside}=k;
 const windows=[],signs=[],textures=[];
 let G=groundZ;const setGround=z=>{G=z;};   // 招牌、路燈、廣場與街上的東西站在哪個高度（地下站的街面比底座高）
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 兩點之間一根方料。
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};

 // 站房：一個零件一個網格；glass 夜裡透暖光。paint：零件名 → 換色（校正模型的色票偏淡時用）。
 function station(parts,{scale,x=0,y=0,z=groundZ,yaw=0,paint={}}){
  for(const [name,p] of parts.parts){
   const glass=name==='glass',m=mat('#ffffff',{roughness:p.roughness,metalness:p.metalness,...(glass?{emissive:'#ffd79a',emissiveIntensity:0}:{})});
   if(paint[name])m.color.set(paint[name]);else m.color.setRGB(...p.color);
   const o=mesh(p.geometry,m,[x,y,z]);o.scale.setScalar(scale);o.rotation.z=yaw;o.name='station-'+name;
   if(glass)windows.push(m);
  }
 }
 // 招牌：畫布貼圖貼在一片薄板上。facing 0 朝 −y、Math.PI 朝 +y；lit 夜裡亮。
 function label(text,x,y,z,w,h,{bg='#f6f3ea',fg='#20508f',band=null,facing=0,lit=true,vertical=false,depth=.08,size=.7}={}){
  const W=vertical?128:512,H=vertical?512:Math.max(64,Math.min(256,Math.round(512*h/w))),c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,W,H);
  if(band){g.fillStyle=band;g.fillRect(0,H-Math.round(H*.16),W,Math.round(H*.16));}
  g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';const chars=[...text];
  if(vertical){g.font=`bold ${Math.floor(Math.min(100,470/chars.length))}px sans-serif`;chars.forEach((ch,i)=>g.fillText(ch,W/2,20+(i+.5)*472/chars.length));}
  else{g.font=`bold ${Math.floor(Math.min(H*size,(W-30)/Math.max(1,chars.length)))}px sans-serif`;g.fillText(text,W/2,H*(band?.44:.52));}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;textures.push(t);
  const m=mat('#ffffff',{map:t,roughness:.8,emissive:'#ffffff',emissiveMap:t,emissiveIntensity:0});if(lit)signs.push(m);
  const nx=Math.sin(facing),ny=-Math.cos(facing);
  block(M.concreteDark,[w+.06,depth,h+.06],[x,y,z],[0,0,facing]);
  const o=mesh(geo(new THREE.PlaneGeometry(w,h)),m,[x+nx*(depth/2+.012),y+ny*(depth/2+.012),z]);o.rotateZ(facing);o.rotateX(Math.PI/2);o.castShadow=false;o.receiveShadow=false;return o;
 }
 // 路燈：一根桿子、一支臂、燈頭，地上一個光池。arm＝臂往哪邊伸（±y）。
 const lampPost=mat('#596165',{metalness:.4,roughness:.5});
 function lamp(x,y,{h=2.7,arm=1,z=G,r=2.1}={}){
  instance(cylinder,lampPost,[x,y,z+h/2],[.09,.09,h]);block(lampPost,[.05,.55,.05],[x,y+arm*.26,z+h]);block(M.lamp,[.14,.3,.05],[x,y+arm*.46,z+h-.04]);pool(x,y+arm*.46,z+.06,r);
 }

 // 軌道：y＝[對向那股, 主路徑那股]（或只有一股）。electric＝電車線；回傳兩條路徑與軌頂高。
 const railZ=groundZ+.23,chips=mat('#a39d90',{roughness:.95});
 function tracks(ys,{electric=true,bedColor=null,mast=1.4}={}){
  const list=ys.map(y=>k.line({y,z:railZ})),lo=Math.min(...ys),hi=Math.max(...ys);
  block(bedColor?mat(bedColor,{roughness:.95}):chips,[k.plinthW-.3,hi-lo+3.6,.05],[0,(lo+hi)/2,groundZ+.025]);
  for(const p of list)k.ballastTrack(p);
  if(electric)list.forEach((p,i)=>k.overhead(p,{height:1.95,messenger:.34,mast:(ys.length===1||i===1?1:-1)*mast,spacing:8.2}));
  return{main:list[list.length-1],other:list.length>1?list[0]:null,contactWireZ:electric?railZ+1.95-.0115:undefined};
 }
 // 月台（台鐵高月台，面高出軌頂 .42）：y 是軌道中心線，side −1 往 −y。
 const platform=(y,{side=-1,length=30,width=3,x=0,edge=.7,z=railZ,bottom=groundZ}={})=>k.platform({x,y,z,side,length,width,edge,top:.42,bottom});
 // 雨棚：島式中間一排柱、兩坡鐵皮頂；頂比車高一點但不超出月台，電車線才不用繞開。
 function canopy(p,{from=-p.length/2+2,to=p.length/2-2,color='#55767c',post='#8a9396',h=1.62,step=3.2,lights=3,name='platform'}={}){
  const yc=(p.y0+p.y1)/2,w=Math.abs(p.y1-p.y0)-.12,L=to-from,xc=p.x+(from+to)/2,roof=mat(color,{roughness:.55,metalness:.2}),col=mat(post,{metalness:.4,roughness:.5}),top=p.z+h;
  instance(prism,roof,[xc,yc,top],[L,w,.22]);block(col,[L,.1,.09],[xc,yc,top-.05]);
  for(const s of [-1,1])block(roof,[L,.05,.08],[xc,yc+s*w/2,top+.01]);
  const n=Math.round(L/step);for(let i=0;i<=n;i++){const x=p.x+from+i*L/n;block(col,[.12,.12,h],[x,yc,p.z+h/2]);for(const s of [-1,1])beam(col,[x,yc,top-.42],[x,yc+s*w*.46,top-.02],.06);}
  for(let i=0;i<n;i++){const x=p.x+from+(i+.5)*L/n;block(M.lamp,[.8,.07,.03],[x,yc+.42,top-.1]);block(M.lamp,[.8,.07,.03],[x,yc-.42,top-.1]);}
  for(let i=0;i<lights;i++)k.addLight(`${name}-${i}`,xc+(i-(lights-1)/2)*L/Math.max(1,lights),yc,top-.3,1.7,7);
 }
 // 月台上的東西：長椅、垃圾桶、販賣機、地下道出入口、站名牌（兩面都寫）。
 const bench=mat('#6f93a8',{roughness:.5}),bin=mat('#4c7f6d'),vend=mat('#c63b3b',{roughness:.45}),stairWall=mat('#dcd8cc');
 function furnish(p,{name,next=[],stairs=true,bench:every=4.6}={}){
  const yc=(p.y0+p.y1)/2,L=p.length-5;
  for(let x=-L/2;x<=L/2;x+=every){if(stairs&&Math.abs(x)<3.3)continue;block(bench,[1.1,.22,.05],[p.x+x,yc,p.z+.21]);block(bench,[1.1,.04,.2],[p.x+x,yc,p.z+.34]);for(const s of [-.42,.42])block(M.steel,[.05,.2,.2],[p.x+x+s,yc,p.z+.1]);}
  for(const x of [-L/2-1,L/2+1])block(bin,[.2,.2,.42],[p.x+x,yc,p.z+.21]);
  block(vend,[.42,.3,.8],[p.x+L/2-.9,yc+.26,p.z+.4]);block(M.glass,[.3,.02,.42],[p.x+L/2-.9,yc+.1,p.z+.5]);
  if(stairs){block(stairWall,[3.4,Math.abs(p.y1-p.y0)-1.3,.9],[p.x,yc,p.z+.45]);block(M.glass,[3.0,Math.abs(p.y1-p.y0)-1.25,.42],[p.x,yc,p.z+.56]);block(M.concreteDark,[3.5,Math.abs(p.y1-p.y0)-1.2,.06],[p.x,yc,p.z+.93]);}
  if(name)for(const x of [-L/2+2.2,L/2-2.2])for(const [dy,f] of [[.5,Math.PI],[-.5,0]]){const y=yc+dy;
   label(name,p.x+x,y,p.z+.86,1.5,.42,{bg:'#fbfbf7',fg:'#17396b',band:'#1f5fa8',facing:f,depth:.05});for(const s of [-.68,.68])block(M.steel,[.05,.05,.7],[p.x+x+s,y,p.z+.34]);}
 }
 // 廣場：一塊鋪面、方格線與路緣；x、y 是中心，w、d 是長寬。
 const paving=mat('#c4bfb2',{roughness:.9}),paveLine=mat('#a9a498'),curb=mat('#d5d0c2');
 function plaza(x,y,w,d,{color=null,grid=2.2}={}){
  block(color?mat(color,{roughness:.9}):paving,[w,d,.05],[x,y,G+.025]);
  for(let a=-w/2+grid;a<w/2;a+=grid)block(paveLine,[.04,d,.01],[x+a,y,G+.055]);
  for(let a=-d/2+grid;a<d/2;a+=grid)block(paveLine,[w,.04,.01],[x,y+a,G+.055]);
  for(const s of [-1,1]){block(curb,[w+.2,.14,.1],[x,y+s*d/2,G+.05]);block(curb,[.14,d,.1],[x+s*w/2,y,G+.05]);}
 }
 // 花台：矮磚框、裡面灌木。
 const planterM=mat('#a98a6c');
 function planter(x,y,w=2.2,d=.7){block(planterM,[w,d,.28],[x,y,G+.14]);block(mat('#5e4b38'),[w-.14,d-.14,.02],[x,y,G+.285]);for(let a=-w/2+.3;a<w/2-.1;a+=.46)props.bush(x+a,y,G+.26,.3+rand()*.14);}
 // 公車站：候車亭＋站牌。
 const shelter=mat('#e8ebea',{roughness:.5});
 function busStop(x,y,w=3.2){block(shelter,[w,.9,.06],[x,y,G+1.12]);block(M.gateGlass,[w-.1,.03,.8],[x,y+.42,G+.68]);for(const s of [-1,1])block(M.steel,[.06,.06,1.1],[x+s*(w/2-.1),y+.4,G+.55]);block(bench,[w*.6,.2,.04],[x,y+.2,G+.3]);block(M.sign,[.5,.05,.7],[x+w/2+.3,y+.3,G+1.1]);block(M.steel,[.05,.05,1.2],[x+w/2+.3,y+.3,G+.6]);}
 // YouBike 站：一排黃車＋站柱。
 const ubike=mat('#e6b422',{roughness:.45}),tyre=mat('#2b2d30');
 function bikes(x,y,n=6,{yaw=Math.PI/2}={}){block(mat('#7d8486'),[n*.42+.4,.12,.1],[x,y,G+.08]);block(ubike,[.16,.16,.72],[x-n*.21-.3,y,G+.36]);
  for(let i=0;i<n;i++){const bx=x-n*.21+.21+i*.42;block(ubike,[.05,.56,.08],[bx,y+.05,G+.3]);block(ubike,[.04,.05,.2],[bx,y+.12,G+.4]);for(const s of [-.26,.3])instance(cylinder,tyre,[bx,y+s,G+.13],[.25,.25,.04],[Math.PI/2,0,yaw]);}}
 // 一排機車（站前最常見的畫面）。
 function scooters(x0,x1,y,step=.44,yaw=Math.PI/2){for(let x=x0;x<=x1;x+=step)k.scooter(x,y+(rand()-.5)*.06,{yaw:yaw+(rand()-.5)*.08,z:G});}
 // 斑馬線：沿 y 方向過馬路（橫條沿 y 排在 x 上）。
 const zebra=mat('#e9e6da');
 function crosswalk(x,y,w=2,d=2.4){for(let a=-d/2+.14;a<d/2;a+=.42)block(zebra,[w,.2,.012],[x,y+a,G+.04]);}
 // 紅綠燈。
 const signalM=mat('#3a4043'),green=mat('#55c07a',{emissive:'#4fd983',emissiveIntensity:0}),red=mat('#d8402f',{emissive:'#ff3b2f',emissiveIntensity:0});
 function signal(x,y,arm=-1){block(signalM,[.08,.08,1.8],[x,y,G+.9]);block(signalM,[.05,1.3,.05],[x,y+arm*.62,G+1.78]);block(signalM,[.14,.42,.14],[x,y+arm*1.2,G+1.74]);block(red,[.15,.09,.09],[x,y+arm*1.2+.13,G+1.74]);block(green,[.15,.09,.09],[x,y+arm*1.2-.13,G+1.74]);signs.push(red,green);}
 // 馬路：底座全長一條，車流兩向，路邊畫白線。
 const laneW=mat('#dcdad0');
 function road(y,{width=2.6,cars=[[-24,-1],[-11,1],[1,-1],[13,1],[25,-1]],x=0,length=k.plinthW-.4}={}){
  props.road(x,y,G,length,width);for(const s of [-1,1])block(laneW,[length,.05,.01],[x,y+s*(width/2-.1),G+.04]);
  for(const [cx,lane] of cars)k.car(cx,y+lane*width*.25,{yaw:lane<0?0:Math.PI,z:G});
 }
 // 一排店面（騎樓透天），正面朝 facing；x 從 x0 走到 x1。
 const shops=(x0,x1,y,{facing=0,floors=[3,4,3,5,4],width=2.7,z=G,back=true,ground='arcade'}={})=>{let i=0;for(let x=x0;x<x1;x+=width+.04,i++)props.townhouse(x,y,z,{floors:floors[i%floors.length],width,depth:3.2,tint:i,facing,ground,roof:i%3?'tin':'parapet',back});};
 // 後方矮房與空地：y 之後都要低於跟車視線。
 function trackFence(y,{color='#9a9d9b',from=-k.plinthW/2+.3,to=k.plinthW/2-.3}={}){const m=mat(color,{metalness:.3,roughness:.6}),L=to-from;block(m,[L,.04,.04],[(from+to)/2,y,G+.5]);block(m,[L,.04,.04],[(from+to)/2,y,G+.24]);for(let x=from;x<=to;x+=1.5)block(m,[.06,.06,.56],[x,y,G+.28]);}
 // 整排行道樹。
 function treeRow(x0,x1,y,step=3.4,h=2.1){for(let x=x0;x<=x1;x+=step)if(inside(x,y,1))props.broadleaf(x+(rand()-.5)*.4,y+(rand()-.5)*.3,G,h+rand()*.7);}

 // 高架雙線（ys＝[對向, 主路徑]）：橋、直結軌道、電車線；站內不立墩、月台側不砌牆。deck false＝橋是站體模型自帶的。
 function overTracks(ys,{z=groundZ+4.18,station=14,deck=true,mast=1.6}={}){
  const list=ys.map(y=>k.line({y,z})),inStation=q=>Math.abs(q.x)<station;
  if(deck)list.forEach((p,i)=>k.viaduct(p,{walls:[.45,.45],open:(q,side)=>(i?side<0:side>0)&&inStation(q),pier:q=>!inStation(q)}));
  for(const p of list)k.slabTrack(p);
  list.forEach((p,i)=>k.overhead(p,{height:1.95,messenger:.34,mast:(i?1:-1)*mast,spacing:8.2}));
  return{main:list[list.length-1],other:list[0],contactWireZ:z+1.95-.0115,z};
 }
 // 拱形大屋頂：沿 x 的筒形（y0 到 y1 拱起 rise），邊緣高 z；上下兩面。
 function vault(x0,x1,y0,y1,z,rise,m,{ribs=null,step=2.4}={}){
  const N=14,v=[],idx=[],P=j=>{const u=j/N,y=y0+(y1-y0)*u;return[y,z+rise*Math.sin(Math.PI*u)];};
  for(const [zo,flip] of [[0,false],[-.06,true]]){const base=v.length/3;for(let j=0;j<=N;j++){const [y,h]=P(j);v.push(x0,y,h+zo,x1,y,h+zo);}
   for(let j=0;j<N;j++){const n=base+j*2;flip?idx.push(n,n+1,n+2,n+1,n+3,n+2):idx.push(n,n+2,n+1,n+1,n+2,n+3);}}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();mesh(g,m);
  if(ribs)for(let x=x0;x<=x1+.01;x+=step)for(let j=0;j<N;j++){const [ya,za]=P(j),[yb,zb]=P(j+1);beam(ribs,[x,ya,za-.07],[x,yb,zb-.07],.1,.14);}
 }
 // 田：一格格稻田，田埂淺色。
 const paddyM=['#9cb85f','#abc46b','#8eae57','#b7c977','#a2bb63'].map(c=>mat(c,{roughness:.92})),bund=mat('#bba981');
 function fields(x0,x1,y0,y1,w=3.4,d=2.5){
  const nx=Math.max(1,Math.round((x1-x0)/w)),ny=Math.max(1,Math.round((y1-y0)/d)),dx=(x1-x0)/nx,dy=(y1-y0)/ny;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)block(pick(paddyM),[dx-.14,dy-.14,.05],[x0+(i+.5)*dx,y0+(j+.5)*dy,groundZ+.025]);
  for(let i=0;i<=nx;i++)block(bund,[.14,y1-y0+.14,.09],[x0+i*dx,(y0+y1)/2,groundZ+.045]);
  for(let j=0;j<=ny;j++)block(bund,[x1-x0+.14,.14,.09],[(x0+x1)/2,y0+j*dy,groundZ+.045]);
 }
 // 山：高度場（平面著色、頂點色分深淺）。h(x,y) 回傳離地高度，邊上要自己收到 0；回傳查高度的函式，給種樹用。
 function terrain(x0,x1,y0,y1,h,{nx=44,ny=16,colors=['#5f7d50','#648254','#6a8758','#6f8c5c'],z=groundZ-.02}={}){
  const v=[],c=[],idx=[],col=new THREE.Color(),W=nx+1;
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const x=x0+(x1-x0)*i/nx,y=y0+(y1-y0)*j/ny,n=(Math.sin(x*.37+y*.21)+Math.sin(x*.13-y*.43)+2)/4;
   col.set(colors[Math.min(colors.length-1,Math.floor(n*colors.length))]);v.push(x,y,z+h(x,y));c.push(col.r,col.g,col.b);}
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*W+i,q=[a,a+1,a+W,a+W+1];if(Math.max(...q.map(n=>v[n*3+2]))<=z+.01)continue;idx.push(a,a+1,a+W+1,a,a+W+1,a+W);}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setIndex(idx);g.computeVertexNormals();
  const o=mesh(g,mat('#ffffff',{vertexColors:true,roughness:.95}));o.name='hill';return(x,y)=>z+h(x,y);
 }
 // 大王椰子：灰白直幹、頂上一圈羽葉。
 const palmTrunk=mat('#c9c5b8',{roughness:.8}),palmLeaf=mat('#4e7d48',{roughness:.7}),palmNeck=mat('#6d9457');
 function palm(x,y,h=3.6){instance(cylinder,palmTrunk,[x,y,G+h/2],[.2,.2,h]);instance(cylinder,palmNeck,[x,y,G+h+.2],[.15,.15,.5]);
  for(let i=0;i<9;i++){const t=i*2*Math.PI/9+x,L=1.25;block(palmLeaf,[L,.2,.035],[x+Math.cos(t)*L*.45,y+Math.sin(t)*L*.45,G+h+.5-(i%2)*.1],[0,.42,t]);}}
 // 地下站剖面：街面墊高到 top（底座前半，到 yCut）；軌道層露在後面；後方再一段矮台地（rear 高、yRear 起）。切面看得到土層與連續壁。
 const soil=mat('#9a7a58'),clay=mat('#7f6550'),wallM=mat('#c9c5ba');
 function cutaway({yCut=1,top=2.8,yRear=13,rear=1.2,streetColor='#d6d0c3',rearColor='#87956b'}){
  const {plinthW:w,plinthD:d,plinthR:r}=k,x=w/2,yb=d/2;
  const front=()=>{const s=new THREE.Shape();s.moveTo(-x,yCut);s.lineTo(-x,-yb+r);s.quadraticCurveTo(-x,-yb,-x+r,-yb);s.lineTo(x-r,-yb);s.quadraticCurveTo(x,-yb,x,-yb+r);s.lineTo(x,yCut);s.lineTo(-x,yCut);return s;};
  const back=()=>{const s=new THREE.Shape();s.moveTo(-x,yRear);s.lineTo(x,yRear);s.lineTo(x,yb-r);s.quadraticCurveTo(x,yb,x-r,yb);s.lineTo(-x+r,yb);s.quadraticCurveTo(-x,yb,-x,yb-r);s.lineTo(-x,yRear);return s;};
  const slab=(shape,z0,z1,m,name)=>{const o=mesh(geo(new THREE.ExtrudeGeometry(shape,{depth:z1-z0,bevelEnabled:false,curveSegments:10})),m,[0,0,z0]);o.name=name;return o;};
  slab(front(),groundZ,groundZ+top*.42,clay,'strata-clay');slab(front(),groundZ+top*.42,groundZ+top-.14,soil,'strata-soil');slab(front(),groundZ+top-.14,groundZ+top,mat(streetColor),'street');
  slab(back(),groundZ,groundZ+rear-.1,clay,'rear-clay');slab(back(),groundZ+rear-.1,groundZ+rear,mat(rearColor),'rear-lawn');
  block(wallM,[w-.2,.12,top-.14],[0,yCut+.06,groundZ+(top-.14)/2]);block(wallM,[w-.2,.12,rear-.1],[0,yRear-.06,groundZ+(rear-.1)/2]);
  for(let a=-x+2.4;a<x-.5;a+=2.6){block(M.concreteDark,[.05,.03,top-.14],[a,yCut+.13,groundZ+(top-.14)/2]);}
  return groundZ+top;
 }

 // 收尾：update 多處理站房窗、招牌與號誌；dispose 放掉畫布貼圖。
 function finish({tracks:t,anchors,label:name,themes:th,camera={yaw:-1.12,elevation:.58,radius:50},update,extra={}}){
  const r=k.result({path:t.main,anchors,label:name,themes:th,camera,extra:{opposingPath:t.other??undefined,contactWireZ:t.contactWireZ,...extra},
   update(time,theme,p){for(const m of windows)m.emissiveIntensity=theme.window*1.1;for(const m of signs)m.emissiveIntensity=theme.lamp*.9;update?.(time,theme,p);}});
  const {dispose}=r;r.dispose=()=>{dispose();textures.forEach(x=>x.dispose());};
  return r;
 }
 return{k,pick,beam,setGround,station,label,lamp,tracks,overTracks,platform,canopy,furnish,plaza,planter,busStop,bikes,scooters,crosswalk,signal,road,shops,trackFence,treeRow,vault,fields,terrain,palm,cutaway,finish,railZ,windows,signs};
}

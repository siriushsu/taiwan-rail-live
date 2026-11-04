// 文湖線：動物園站的微縮印象——膠輪導軌的高架端點站（全高月台門、淺拱屋頂）、環內的貓空纜車動物園站與越過環線往山上去的纜線、
// 後方種茶的貓空山頭、站前的動物園大門與園區一角。不是實際線形、方位或比例的重建。
// 纜車車廂掛在纜線上不動：App 的場景檔是烘好的靜態幾何，網頁照同一份，兩邊一樣。
// 纜線越過環線後直線的地方要比車頂高：下站出纜口 5.6、山頂上站 7.3，跨過後直線時離車頂還有 1.3 以上。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e2eae1',sun:'#fff2d2',ambient:'#c2d8df',ground:'#7f9468',power:3.0,exposure:1.04,water:'#4b8a86',shallow:'#8cbca6',lamp:0,window:0},
 sunset:{background:'#eed9c3',sun:'#ffb672',ambient:'#d3b9af',ground:'#727a5b',power:2.9,exposure:.94,water:'#5f8080',shallow:'#b3ab90',lamp:.5,window:.45},
 night:{background:'#121d29',sun:'#9dbde0',ambient:'#58718c',ground:'#28323c',power:.7,exposure:.78,water:'#163448',shallow:'#2e5a64',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20322,trees:[['acacia',.4],['trema',.3],['ficus',.15],['cyathea',.15]]});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,hip,pool,inside}=k;
 const path=k.line(),far=k.line({y:-1.78}),railZ=path.z,front=path.front;
 const inStation=q=>Math.abs(q.x)<11.6;
 k.keepClear((x,y)=>y>-9&&y<.7);   // 高架橋底不種樹

 // 高架橋、膠輪導軌：站內月台那側不砌牆、不立墩（站體撐著）。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.viaduct(far,{round:true,walls:[.45,.45],open:(q,side)=>side<0&&inStation(q),pier:q=>!inStation(q)});
 k.guideway(path);k.guideway(far);

 const white=mat('#eef0ec',{roughness:.45,metalness:.2}),cream=mat('#e9e4d6'),brown=mat('#a8742f'),plaza=mat('#bbb5a6'),dark=mat('#3b4449');
 const bench=mat('#8b6f52'),skylight=mat('#9fc2cf',{roughness:.2,metalness:.2,emissive:'#ffe0b0',emissiveIntensity:0});

 // 島式月台＋兩側全高月台門：月台邊離中心 .86，比導軌（±.72）再外面一點。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.0,edge:.86,top:.2,bottom:railZ-.73});
 k.screenDoors(p);k.screenDoors({...p,y0:p.y1,side:-1});
 for(let x=-7.5;x<=7.5;x+=5)for(const s of [-1,1]){block(bench,[1.3,.3,.12],[x,(p.y0+p.y1)/2+s*.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,(p.y0+p.y1)/2+s*.28,p.z+.52]);}

 // 穿堂層：月台底下到地面，往外延伸到高架橋外側的站前入口；正面一排圓頂窗、文湖線的棕色腰帶。
 const hallY0=-9.7,hallY1=-.1,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(cream,[22,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(mat('#cfd4d4'),[22.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);
 const arch=geo(new THREE.CylinderGeometry(.5,.5,1,16,1,false,0,Math.PI));arch.rotateY(-Math.PI/2);   // 半圓柱，軸沿 y、圓頂朝 +z
 for(let x=-9;x<=9.1;x+=2.25){block(M.glass,[1.5,.1,1.5],[x,hallY0-.03,groundZ+.95]);instance(arch,M.glass,[x,hallY0-.03,groundZ+1.7],[1.5,.1,1.0]);}   // 拱頂壓扁到 .5 高，中間三扇才不會從入口雨庇上冒出來
 block(brown,[22.1,.08,.26],[0,hallY0-.05,hallTop-.3]);
 block(white,[6.4,1.6,.14],[0,hallY0-.8,groundZ+2.2]);for(const s of [-1,1])block(white,[.12,.12,2.2],[s*3.0,hallY0-1.5,groundZ+1.1]);
 block(M.sign,[3.2,.12,.42],[0,hallY0-.07,groundZ+2.75]);
 k.addLight('entrance',0,hallY0-1.2,groundZ+2.2,1.3,6);

 // 淺拱屋頂：沿 x 一整片，橫向中間高；頂上三條採光帶（夜裡透光），外緣一條棕色封邊。屋簷離軌頂 3.0，比全高月台門（2.2）高。
 const roof={L:12.2,yOut:-9.0,yIn:-.8,z0:railZ+3.0,arch:1.0,thick:.2};
 const roofAt=(x,u,lift=0)=>[x,(roof.yOut+roof.yIn)/2+u*(roof.yIn-roof.yOut)/2,roof.z0+roof.arch*(1-u*u)+lift];
 {
  const nx=24,nu=14,v=[],idx=[],T=(i,j)=>i*(nu+1)+j,B=(i,j)=>(nx+1)*(nu+1)+T(i,j);
  for(const lift of [roof.thick,0])for(let i=0;i<=nx;i++)for(let j=0;j<=nu;j++)v.push(...roofAt(-roof.L+2*roof.L*i/nx,-1+2*j/nu,lift));
  for(let i=0;i<nx;i++)for(let j=0;j<nu;j++){idx.push(T(i,j),T(i+1,j),T(i+1,j+1),T(i,j),T(i+1,j+1),T(i,j+1));idx.push(B(i,j),B(i+1,j+1),B(i+1,j),B(i,j),B(i,j+1),B(i+1,j+1));}
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();mesh(g,white).name='station-roof';
  // 兩端的拱形封邊與外緣、內緣的封邊條。
  for(const x of [-roof.L,roof.L])for(let j=0;j<nu;j++){const a=roofAt(x,-1+2*j/nu),b=roofAt(x,-1+2*(j+1)/nu),dy=b[1]-a[1],dz=b[2]-a[2];block(brown,[.1,Math.hypot(dy,dz)+.02,roof.thick+.06],[x,(a[1]+b[1])/2,(a[2]+b[2])/2+roof.thick/2],[Math.atan2(dz,dy),0,0]);}
  for(const u of [-1,1]){const [,y,z]=roofAt(0,u);block(brown,[roof.L*2+.1,.1,roof.thick+.08],[0,y,z+roof.thick/2]);}
  for(const u of [-.45,0,.45])for(let x=-10;x<=10.1;x+=2.5){const a=roofAt(0,u-.06,roof.thick),b=roofAt(0,u+.06,roof.thick);block(skylight,[1.9,b[1]-a[1]+.1,.05],[x,(a[1]+b[1])/2,(a[2]+b[2])/2+.02],[Math.atan2(b[2]-a[2],b[1]-a[1]),0,0]);}
 }
 // 屋頂柱：月台中線一排，兩側立在橋面外緣（細，不擋車）。
 for(let x=-9.6;x<=9.7;x+=4.8){for(const [y,z0,w] of [[(p.y0+p.y1)/2,p.z,.26],[front-1.62,railZ-.23,.16],[far.front+1.62,railZ-.23,.16]]){const h=roofAt(0,(y-(roof.yOut+roof.yIn)/2)/((roof.yIn-roof.yOut)/2))[2]-z0;block(white,[w,w,h],[x,y,z0+h/2]);}}
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-4.3,z=p.z+2.4;block(M.lamp,[.8,.32,.07],[x,y,z]);k.addLight('platform-'+i,x,y,z-.15,2.6,7);}

 // 站前廣場、公車站。
 block(plaza,[23,6.8,.04],[0,-13.2,groundZ+.02]);
 const roadY=-18.6;props.road(4,roadY,groundZ,52,2.0);
 const bus=mat('#3f8f73',{roughness:.45,metalness:.15});
 for(const [x,y] of [[17,-14.2],[25,-14.2],[21,-11.6]])k.bus(x,y,{paint:bus,stripe:white});
 for(const [x,lane] of [[-3,-1],[7,1],[13,-1],[24,1]])k.car(x,roadY+lane*.5,{yaw:lane<0?0:Math.PI,taxi:x===7});
 block(white,[6,1.4,.12],[21,-16.4,groundZ+1.5]);for(const x of [18.5,23.5])block(M.steel,[.08,.08,1.5],[x,-16.9,groundZ+.75]);
 for(let x=14;x<=29;x+=7.5){block(M.steel,[.11,.11,3.0],[x,roadY+1.25,groundZ+1.5]);block(M.lamp,[.4,.34,.1],[x,roadY+.5,groundZ+2.9]);block(M.steel,[.08,.8,.08],[x,roadY+.9,groundZ+2.96]);pool(x,roadY+.5,groundZ+.06,2.6,1.9);}
 for(let i=0;i<12;i++)k.scooter(4.5+i*.5,-11.9,{yaw:Math.PI/2});

 // 左前方：動物園一角——圍欄、大門、水池、兩隻長頸鹿、一頭大象；樹只種在後緣與左緣，不擋動物。前緣讓給站前的馬路。
 const zoo={x0:-31,x1:-12.6,y0:-17.3,y1:-10.6};
 const fence=mat('#7a6a4f');
 for(const [x0,y0,x1,y1] of [[zoo.x0+1.2,zoo.y0,zoo.x1,zoo.y0],[zoo.x1,zoo.y0,zoo.x1,-15.9],[zoo.x1,-12.5,zoo.x1,zoo.y1]]){const L=Math.hypot(x1-x0,y1-y0),n=Math.max(1,Math.round(L/.9));
  for(let i=0;i<=n;i++){const t=i/n;block(fence,[.1,.1,.7],[x0+(x1-x0)*t,y0+(y1-y0)*t,groundZ+.35]);}
  block(fence,[x1-x0||.06,y1-y0||.06,.06],[(x0+x1)/2,(y0+y1)/2,groundZ+.6]);}
 // 大門朝站前廣場：兩根橘色門柱、綠色門楣與招牌，門口一小塊鋪面接上廣場。
 const gate=mat('#d9773a'),gateTop=mat('#3d7a5a');
 for(const y of [-15.7,-12.7])block(gate,[.6,.6,3.2],[zoo.x1,y,groundZ+1.6]);
 block(gateTop,[.8,4.0,.6],[zoo.x1,-14.2,groundZ+3.4]);block(M.sign,[.12,2.8,.42],[zoo.x1+.42,-14.2,groundZ+3.4]);
 block(plaza,[1.1,4.6,.04],[zoo.x1+.55,-14.2,groundZ+.02]);
 k.river(6.0,2.4,[-24.5,-12.7],THEMES.day);
 const giraffe=mat('#d9a845'),spot=mat('#9a6a33'),gray=mat('#8f908a');
 function giraffeAt(x,y,yaw){const c=Math.cos(yaw),s=Math.sin(yaw),P=(a,b,z)=>[x+c*a-s*b,y+s*a+c*b,groundZ+z];
  block(giraffe,[1.0,.42,.5],P(0,0,1.25),[0,0,yaw]);for(const [a,b] of [[-.38,-.14],[-.38,.14],[.38,-.14],[.38,.14]])block(spot,[.09,.09,1.0],P(a,b,.5),[0,0,yaw]);
  block(giraffe,[.18,.18,1.2],P(.46,0,1.9),[0,.42,yaw]);block(giraffe,[.38,.2,.2],P(.78,0,2.5),[0,0,yaw]);block(spot,[.5,.08,.06],P(.1,0,1.52),[0,0,yaw]);}
 giraffeAt(-17.2,-14.6,.4);giraffeAt(-15.4,-16.1,2.6);
 {const x=-21.5,y=-15.6;block(gray,[1.5,.95,.95],[x,y,groundZ+1.0]);block(gray,[.6,.75,.7],[x+.95,y,groundZ+1.25]);for(const s of [-1,1])block(gray,[.1,.55,.5],[x+.8,y+s*.55,groundZ+1.3]);
  block(gray,[.2,.2,.8],[x+1.3,y,groundZ+.75],[0,-.25,0]);for(const [a,b] of [[-.5,-.3],[-.5,.3],[.45,-.3],[.45,.3]])block(gray,[.3,.3,.6],[x+a,y+b,groundZ+.3]);}
 for(let n=0;n<12;){const back=n<8,x=back?-30+rand()*17:-30.2+rand()*1.4,y=back?-11.1+rand()*.3:-16.4+rand()*4.6;if(!inside(x,y,1.5))continue;props.broadleaf(x,y,groundZ,1.8+rand()*1.2);n++;}
 for(let n=0;n<8;n++){const x=-29+rand()*16,y=-17.0+rand()*.4;if(inside(x,y,1))props.bush(x,y,groundZ,.35+rand()*.25);}

 // 站後右邊：貓空纜車動物園站——高高的站房（出纜口在 5.6），兩條纜線往後接到山頂上站；纜線上掛幾節車廂。
 const gs={x:12.2,y:6.0},concrete2=mat('#c9c6bc');
 block(concrete2,[6.4,3.8,5.0],[gs.x,gs.y,groundZ+2.5]);
 for(const z of [1.0,2.7]){block(M.glass,[5.8,.1,.9],[gs.x,gs.y-1.93,groundZ+z]);for(let x=-2.4;x<=2.41;x+=1.2)block(concrete2,[.09,.14,.9],[gs.x+x,gs.y-1.95,groundZ+z]);}
 block(white,[2.0,.5,.12],[gs.x,gs.y-2.1,groundZ+1.62]);block(M.steel,[.08,.08,1.6],[gs.x-.9,gs.y-2.28,groundZ+.8]);block(M.steel,[.08,.08,1.6],[gs.x+.9,gs.y-2.28,groundZ+.8]);
 block(mat('#2b3136'),[3.2,.06,1.0],[gs.x,gs.y+1.92,groundZ+4.1]);
 block(white,[7.0,4.6,.3],[gs.x,gs.y,groundZ+5.15]);instance(hip,mat('#5f7f8c'),[gs.x,gs.y,groundZ+5.3],[6.6,4.2,1.1]);
 block(M.sign,[2.4,.12,.4],[gs.x,gs.y-1.96,groundZ+3.9]);k.addLight('gondola',gs.x,gs.y-2.6,groundZ+2.0,1.0,6);
 const hill={x:16,y:16.6,rx:10,ry:3.3,rz:6.5},hill2={x:-14,y:16.9,rx:13,ry:3.0,rz:3.4};
 const dome=geo(new THREE.SphereGeometry(1,28,8,0,Math.PI*2,0,Math.PI/2));dome.rotateX(Math.PI/2);
 const hillZ=(h,x,y)=>groundZ+h.rz*Math.sqrt(Math.max(0,1-((x-h.x)/h.rx)**2-((y-h.y)/h.ry)**2));
 instance(dome,mat('#6c8a57'),[hill.x,hill.y,groundZ],[hill.rx,hill.ry,hill.rz]);instance(dome,mat('#7b9462'),[hill2.x,hill2.y,groundZ],[hill2.rx,hill2.ry,hill2.rz]);
 const top={x:14.4,y:16.4};top.z=hillZ(hill,top.x,top.y);
 block(concrete2,[3.4,2.4,1.6],[top.x,top.y,top.z+.4]);instance(hip,mat('#5f7f8c'),[top.x,top.y,top.z+1.2],[3.8,2.8,.8]);
 const cable=mat('#3a3c3e',{metalness:.4,roughness:.5}),cabins=['#d9493f','#e5b040','#3f7fb5','#4fa36b','#ece8de'].map(c=>mat(c,{roughness:.45}));
 for(const dx of [-.5,.5]){const A=[gs.x+dx,gs.y+1.9,groundZ+5.6+.7],Bp=[top.x+dx,top.y-1.2,top.z+1.4];
  const d=[Bp[0]-A[0],Bp[1]-A[1],Bp[2]-A[2]],h=Math.hypot(d[0],d[1]),L=Math.hypot(h,d[2]),yaw=Math.atan2(d[1],d[0]),pitch=Math.atan2(d[2],h);
  block(cable,[L,.05,.05],[(A[0]+Bp[0])/2,(A[1]+Bp[1])/2,(A[2]+Bp[2])/2],[0,-pitch,yaw]);
  for(let t=.16+(dx>0?.08:0);t<.92;t+=.17){const c=[A[0]+d[0]*t,A[1]+d[1]*t,A[2]+d[2]*t];block(M.steel,[.03,.03,.36],[c[0],c[1],c[2]-.18]);
   const m=cabins[Math.floor(rand()*cabins.length)];block(m,[.52,.46,.5],[c[0],c[1],c[2]-.62],[0,0,yaw]);block(M.glass,[.54,.36,.2],[c[0],c[1],c[2]-.52],[0,0,yaw]);block(m,[.4,.36,.08],[c[0],c[1],c[2]-.34],[0,0,yaw]);}}
 // 山上：茶園（一排排矮茶樹貼著坡）、樹。
 for(let r=0;r<5;r++)for(let x=hill.x-7;x<=hill.x+7.5;x+=.75){const y=hill.y-2.9+r*.42,z=hillZ(hill,x,y);if(z<=groundZ+.2||Math.abs(x-top.x)<2.6)continue;props.bush(x,y,z-.12,.28);}
 for(let n=0;n<20;){const h=rand()<.5?hill:hill2,x=h.x-h.rx+rand()*h.rx*2,y=h.y-h.ry+rand()*h.ry*2,z=hillZ(h,x,y);if(z<=groundZ+.3||!inside(x,y,1.2)||(h===hill&&y<hill.y-1.0))continue;props.broadleaf(x,y,z-.15,1.5+rand()*1.0);n++;}
 // 站後的樹林：左邊一大片；右邊避開纜車站。
 for(let n=0;n<30;){const x=-31+rand()*38,y=1+rand()*12;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.8+rand()*1.3);n++;}
 for(let n=0;n<12;){const x=16.6+rand()*14.4,y=1+rand()*11;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.6+rand()*1.1);n++;}
 for(const [x,y] of [[13.4,-10.6],[-31,-10.2],[30.8,-10]])props.broadleaf(x,y,groundZ,2.0+rand()*.8);

 return k.result({
  path,label:'動物園站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[top.x,top.y,top.z]},
  extra:{opposingPath:k.reversed(far)},
  update(time,t){skylight.emissiveIntensity=t.window*.8;}
 });
}

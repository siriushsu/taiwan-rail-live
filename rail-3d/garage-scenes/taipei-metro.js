// 台北捷運高運量：淡水信義線劍潭站的微縮印象——龍舟造型屋頂的高架站、隔壁的北藝中心、基隆河對岸山頭的圓山大飯店、
// 站前的士林夜市街口。不是實際線形、方位或比例的重建。
// 雙線高架穿過站體（島式月台），兩股對向，車從底座一端開進、另一端開出。屋頂伸過軌道，屋簷離軌頂 3.2：
// 從正面看，屋簷外伸 d 擋掉的車身高度是 .73×(d−.63)（全景仰角 .58），外伸 2.4 還露得出 1.7，車高 1.56 整個側面看得到。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e5e9e4',sun:'#fff3d6',ambient:'#c4d8e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#4a8592',shallow:'#83b5aa',lamp:0,window:0},
 sunset:{background:'#efd8c2',sun:'#ffb36e',ambient:'#d4b8b0',ground:'#74795e',power:2.9,exposure:.94,water:'#617f8a',shallow:'#b2a993',lamp:.5,window:.45},
 night:{background:'#131d2c',sun:'#9fbfe4',ambient:'#5b7390',ground:'#29323f',power:.7,exposure:.78,water:'#15324a',shallow:'#2f5a6c',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20311,trees:[['ficus',.35],['terminalia',.3],['koelreuteria',.2],['delonix',.15]]});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,hip,pool,inside,cylinder}=k;
 const path=k.line(),far=k.line({y:-1.86}),railZ=path.z,front=path.front;
 const inStation=q=>Math.abs(q.x)<11.6;
 k.keepClear((x,y)=>y>-9&&y<.7);   // 高架橋底不種樹

 // 高架橋與道床：站內月台那側不砌牆、不立墩（站體撐著）；第三軌在月台對面。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.viaduct(far,{round:true,walls:[.45,.45],open:(q,side)=>side<0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(path);k.slabTrack(far);
 k.thirdRail(path,{side:-1});k.thirdRail(far,{side:1});

 const white=mat('#eef0ec',{roughness:.45,metalness:.2}),under=mat('#cfd4d4',{roughness:.6}),cream=mat('#e8e3d5'),lineRed=mat('#c8323b');
 const plaza=mat('#b9b3a5'),dark=mat('#3b4449'),bench=mat('#8b6f52'),seam=mat('#b4bcbc',{roughness:.5});

 // 島式月台＋兩側半高月台閘門；月台底下到地面是穿堂層，往外一路延伸到高架橋外側的站前入口。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.2,edge:.72,top:.2,bottom:railZ-.73});
 k.gates(p);k.gates({...p,y0:p.y1,side:-1});
 const hallY0=-9.7,hallY1=-.1,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(cream,[22,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(under,[22.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);   // 高架橋外側那條站體頂
 for(const y of [hallY0-.03,hallY1+.03]){
  block(M.glass,[19.4,.1,1.55],[0,y,groundZ+1.0]);block(M.glass,[18.6,.1,.55],[0,y,groundZ+2.35]);
  for(let x=-10.4;x<=10.5;x+=2.6)block(white,[.24,.22,hallH],[x,y+(y<0?-.08:.08),groundZ+hallH/2]);
 }
 block(lineRed,[22.1,.08,.22],[0,hallY0-.05,hallTop-.2]);   // 淡水信義線的紅色腰帶
 for(const x of [-5.2,5.2]){
  block(white,[3.6,1.5,.14],[x,hallY0-.75,groundZ+2.0]);for(const s of [-1,1])block(white,[.1,.1,2.0],[x+s*1.6,hallY0-1.4,groundZ+1.0]);
  block(M.sign,[2.2,.12,.42],[x,hallY0-.07,groundZ+2.42]);
 }
 k.addLight('entrance',0,hallY0-1.2,groundZ+2.1,1.3,6);

 // 月台上：座椅。
 for(let x=-7.5;x<=7.5;x+=5)for(const s of [-1,1]){block(bench,[1.3,.3,.12],[x,(p.y0+p.y1)/2+s*.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,(p.y0+p.y1)/2+s*.28,p.z+.52]);}

 // 龍舟屋頂：沿 x 長 2L，兩頭上翹、平面兩頭收窄（船形）；橫向是中間高的淺拱。殼有厚度、四周封邊，底下一道道橫肋。
 const roof={L:12.6,yOut:-8.9,yIn:-.9,z0:railZ+3.2,rise:2.4,arch:.55,thick:.22};
 const roofW=a=>(roof.yIn-roof.yOut)/2*(1-.5*a**2.5),roofYc=(roof.yOut+roof.yIn)/2;
 const roofAt=(s,u,lift=0)=>{const a=Math.abs(s);return [s*roof.L,roofYc+u*roofW(a),roof.z0+roof.rise*a**2.4+roof.arch*(1-u*u)+lift];};
 const roofBottom=(x,y)=>{const a=Math.min(1,Math.abs(x)/roof.L),u=Math.max(-1,Math.min(1,(y-roofYc)/roofW(a)));return roofAt(x/roof.L,u)[2];};
 {
  const nx=56,nu=12,shell=[],shellIdx=[],side=[],sideIdx=[],T=(i,j)=>i*(nu+1)+j,B=(i,j)=>(nx+1)*(nu+1)+T(i,j);
  for(const lift of [roof.thick,0])for(let i=0;i<=nx;i++)for(let j=0;j<=nu;j++)shell.push(...roofAt(-1+2*i/nx,-1+2*j/nu,lift));
  for(let i=0;i<nx;i++)for(let j=0;j<nu;j++){
   shellIdx.push(T(i,j),T(i+1,j),T(i+1,j+1),T(i,j),T(i+1,j+1),T(i,j+1));   // 頂面朝上
   shellIdx.push(B(i,j),B(i+1,j+1),B(i+1,j),B(i,j),B(i,j+1),B(i+1,j+1));   // 底面朝下
  }
  // 封邊：沿外框逆時針（俯視）走一圈，每段一片朝外的立面。
  const ring=[];for(let i=0;i<=nx;i++)ring.push([i,0]);for(let j=1;j<=nu;j++)ring.push([nx,j]);for(let i=nx-1;i>=0;i--)ring.push([i,nu]);for(let j=nu-1;j>0;j--)ring.push([0,j]);
  for(const [i,j] of ring)side.push(...roofAt(-1+2*i/nx,-1+2*j/nu,roof.thick),...roofAt(-1+2*i/nx,-1+2*j/nu,0));
  for(let n=0;n<ring.length;n++){const m=(n+1)%ring.length;sideIdx.push(2*n+1,2*m+1,2*m,2*n+1,2*m,2*n);}
  const surface=(v,idx,m)=>{const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,m);};
  surface(shell,shellIdx,white).name='station-roof';surface(side,sideIdx,mat('#7f8d96',{roughness:.5,metalness:.3}));   // 封邊深一點，船形的輪廓才出得來
  // 橫肋：每一道沿底面分 12 段方條，跟著拱與上翹轉角度。
  for(let r=-6;r<=6;r++){const s=r/6.6;
   for(let j=0;j<nu;j++){const a=roofAt(s,-1+2*j/nu),b=roofAt(s,-1+2*(j+1)/nu),dy=b[1]-a[1],dz=b[2]-a[2];
    block(white,[.12,Math.hypot(dy,dz)+.02,.2],[a[0],(a[1]+b[1])/2,(a[2]+b[2])/2-.1],[Math.atan2(dz,dy),0,0]);}}
 }
 // 屋面：沿船身幾道接縫，中間一條採光帶。
 for(const [u,m,w] of [[-.62,seam,.05],[-.3,seam,.05],[0,M.glass,.5],[.3,seam,.05],[.62,seam,.05]])for(let i=-20;i<20;i++){const a=roofAt((i+.1)/21,u,roof.thick+.015),b=roofAt((i+.9)/21,u,roof.thick+.015),dx=b[0]-a[0],dz=b[2]-a[2];block(m,[Math.hypot(dx,dz)+.02,w,.03],[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],[0,-Math.atan2(dz,dx),Math.atan2(b[1]-a[1],dx)]);}
 // 屋頂柱：立在月台中線，柱頭一塊托板頂住屋頂。
 for(let x=-9.6;x<=9.7;x+=4.8){const y=(p.y0+p.y1)/2,h=roofBottom(x,y)-p.z-.18;block(white,[.26,.26,h],[x,y,p.z+h/2]);block(white,[.9,.5,.18],[x,y,p.z+h+.09]);}
 // 月台吊燈：每盞一根吊桿；點光源只放四盞。
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-5.3,z=p.z+2.35;block(M.lamp,[.8,.32,.07],[x,y,z]);block(M.steel,[.03,.03,roofBottom(x,y)-z],[x,y,(z+roofBottom(x,y))/2]);k.addLight('platform-'+i,x,y,z-.15,2.8,7);}
 // 屋頂底下沿中線一條燈帶，一段段貼著底面轉角度（夜裡整片屋頂從裡面亮起來）。
 for(let x=-9.5;x<9.6;x+=1){const a=roofBottom(x-.5,-5.1),b=roofBottom(x+.5,-5.1);block(M.lamp,[1.02,.22,.04],[x,-5.1,(a+b)/2-.03],[0,-Math.atan2(b-a,1),0]);}

 // 站前：入口廣場、機車格、街口的捷運站名柱；前排是士林夜市的街屋，騎樓前一排攤車，最外面是大馬路。
 block(plaza,[23,7.0,.04],[0,-13.3,groundZ+.02]);
 block(white,[.5,.5,3.2],[10.4,-11.0,groundZ+1.6]);block(M.sign,[.56,.56,.7],[10.4,-11.0,groundZ+2.95]);block(lineRed,[.56,.56,.14],[10.4,-11.0,groundZ+2.45]);
 for(const x0 of [-9.8,2.2])for(let i=0;i<14;i++)k.scooter(x0+i*.5,-12.0,{yaw:Math.PI/2});
 const roadY=-18.5;props.road(0,roadY,groundZ,60,2.0);
 const pick=list=>list[Math.floor(rand()*list.length)];
 function terrace(x0,x1){let x=x0,i=0;
  while(true){const w=2.2+rand()*1.1;if(x+w>x1)break;
   props.townhouse(x+w/2,-14.2+(rand()-.5)*.4,groundZ,{floors:2+Math.floor(rand()*3),width:w,depth:2.9+rand()*.6,tint:i,
    roof:pick(['parapet','tin','tin']),ground:pick(['shop','shop','arcade']),balcony:rand()<.4?'cage':'rail',tanks:Math.floor(rand()*3)});
   x+=w+(rand()<.2?1.0:.03);i++;}
 }
 terrace(-30.5,-12.4);terrace(12.4,30.5);
 // 攤車：櫃台、斜斜的帆布棚（夜裡亮）、兩根支架、一盞燈；兩攤一片光池。
 const awnings=['#c8473a','#e0a63d','#3d78b0','#d36b3c','#4f9a6b'].map(c=>mat(c,{emissive:c,emissiveIntensity:0})),counter=mat('#d9d2c2');
 function stall(x,y){const a=pick(awnings);
  block(counter,[1.0,.6,.55],[x,y,groundZ+.28]);block(a,[1.18,.9,.07],[x,y-.08,groundZ+1.06],[.16,0,0]);
  for(const s of [-1,1])block(M.steel,[.05,.05,1.0],[x+s*.53,y-.45,groundZ+.5]);block(M.lamp,[.2,.2,.08],[x,y-.32,groundZ+.94]);}
 let n=0;for(const [x0,x1] of [[-30,-12.8],[-9.5,-3.2],[3.2,9.5],[12.8,30]])for(let x=x0+.6;x<x1;x+=1.3,n++){stall(x,-16.6);if(n%2)pool(x-.65,-16.9,groundZ+.06,1.6,1.1);}
 for(let x=-27.5;x<=27.5;x+=7.85){block(M.steel,[.11,.11,3.0],[x,roadY+1.25,groundZ+1.5]);block(M.steel,[.08,1.0,.08],[x,roadY+.8,groundZ+2.96]);block(M.lamp,[.4,.34,.1],[x,roadY+.35,groundZ+2.9]);pool(x,roadY+.35,groundZ+.06,2.6,1.9);}
 for(const [x,lane,taxi] of [[-23,-1],[-14.5,1,1],[-6.5,1],[4.5,-1,1],[12,-1],[17,1],[26,-1]])k.car(x,roadY+lane*.5,{yaw:lane<0?0:Math.PI,taxi:!!taxi});
 k.bus(-1.2,roadY+.5,{yaw:Math.PI,paint:mat('#e8ecec',{roughness:.42}),stripe:lineRed});

 // 站後右邊：北藝中心——中間一顆架高的波浪玻璃方塊（夜裡透光），底層架空；右邊插一顆銀色的球（球劇場），球底下兩根圓柱；後面一個大盒子（大劇院）、左邊一個藍盒子。
 // 放右後方：再往前或往左，預設鏡頭下球底的柱子會被高架橋擋住（球底要離後股高架橋 5.6 以上才看得到）。
 const tp={x:11.4,y:6.2},zp=groundZ+.5,z1=zp+1.3,cube=mat('#dfe5e4',{roughness:.22,metalness:.15,emissive:'#ffe4bd',emissiveIntensity:0}),silver=mat('#bfc4c4',{roughness:.3,metalness:.6}),blue=mat('#40618a',{roughness:.35,metalness:.2}),lobby=mat('#6f8f99',{roughness:.2,metalness:.2,emissive:'#ffdca8',emissiveIntensity:0});
 const ball=geo(new THREE.SphereGeometry(1,36,22));
 block(plaza,[15,7.8,.5],[tp.x+.9,tp.y,groundZ+.25]);
 block(lobby,[5.4,4.2,z1-zp],[tp.x,tp.y,zp+(z1-zp)/2]);   // 架空層的玻璃門廳
 for(const sx of [-1,1])for(const sy of [-1,1])instance(cylinder,white,[tp.x+sx*2.9,tp.y+sy*2.2,zp+(z1-zp)/2],[.56,.56,z1-zp]);
 block(cube,[6.6,5.4,4.3],[tp.x,tp.y,z1+2.15]);block(white,[6.72,5.52,.1],[tp.x,tp.y,z1+.05]);block(white,[6.72,5.52,.14],[tp.x,tp.y,z1+4.33]);
 // 立面的波浪玻璃：一根根貼在牆上的半圓肋。
 for(let x=-3.05;x<=3.06;x+=.61){instance(cylinder,cube,[tp.x+x,tp.y-2.7,z1+2.2],[.6,.3,4.15]);}
 for(let y=-2.44;y<=2.45;y+=.61)instance(cylinder,cube,[tp.x-3.3,tp.y+y,z1+2.2],[.3,.6,4.15]);
 // 球劇場：球底離廣場 1.7，兩根圓柱頂進球底，預設鏡頭看得到整段柱身。
 const sp={x:tp.x+5.0,y:tp.y-.7,z:z1+2.7,r:2.3};
 instance(ball,silver,[sp.x,sp.y,sp.z],[sp.r,sp.r,sp.r]);
 for(const dz of [-.95,.2,1.25]){const r=Math.sqrt(sp.r**2-dz**2)+.012;instance(geo(new THREE.TorusGeometry(1,.012,5,48)),mat('#8e9494',{roughness:.4,metalness:.6}),[sp.x,sp.y,sp.z+dz],[r,r,1]);}
 for(const dx of [-.95,.95]){const top=sp.z-Math.sqrt(sp.r**2-dx**2)+.25;instance(cylinder,white,[sp.x+dx,sp.y,(zp+top)/2],[.58,.58,top-zp]);instance(cylinder,under,[sp.x+dx,sp.y,zp+.08],[.84,.84,.16]);}
 block(dark,[4.2,1.6,5.4],[tp.x-.4,tp.y+3.2,zp+2.7]);
 block(blue,[2.5,3.0,2.5],[tp.x-4.4,tp.y+.4,z1+1.25]);for(const s of [-1,1])instance(cylinder,white,[tp.x-4.9,tp.y+.4+s*1.1,zp+(z1-zp)/2],[.3,.3,z1-zp]);
 for(let x=4.6;x<=19;x+=1.1)block(white,[.08,.08,.9],[x,tp.y-3.76,groundZ+.95]);   // 廣場欄杆
 // 站後左邊：小公園，樹、座椅、三支路燈。
 block(plaza,[13.5,1.4,.04],[-10,.2,groundZ+.02]);
 for(let i=0;i<3;i++){const x=-4.5-i*5.2;block(M.steel,[.09,.09,2.4],[x,.2,groundZ+1.2]);block(M.lamp,[.3,.3,.14],[x,.2,groundZ+2.42]);pool(x,.2,groundZ+.06,2.0);block(bench,[1.2,.36,.12],[x-1.6,.9,groundZ+.36]);}
 for(let n=0;n<16;){const x=-18+rand()*15,y=-.4+rand()*7.8;if(Math.abs(y-.2)<1.1)continue;props.broadleaf(x,y,groundZ,1.7+rand()*1.2);n++;}

 // 後方：基隆河（環線後直線再往外），對岸一座小山，山頂是紅柱金瓦的圓山大飯店。
 k.river(62,3.0,[0,12.9],THEMES.day);
 const hill={x:22,y:17.2,rx:8.4,ry:2.6,rz:2.8},hillGeo=geo(new THREE.SphereGeometry(1,28,8,0,Math.PI*2,0,Math.PI/2));hillGeo.rotateX(Math.PI/2);
 instance(hillGeo,mat('#6f8a5a'),[hill.x,hill.y,groundZ],[hill.rx,hill.ry,hill.rz]);
 const hillZ=(x,y)=>groundZ+hill.rz*Math.sqrt(Math.max(0,1-((x-hill.x)/hill.rx)**2-((y-hill.y)/hill.ry)**2));
 const gold=mat('#d9a83f',{roughness:.55,metalness:.2}),hotel=mat('#b8412f'),gh={x:22,y:17.4,z:hillZ(22,17.4)-.15};
 block(mat('#a99c86'),[14.6,3.4,1.6],[gh.x,gh.y,gh.z-.7]);   // 山頂的台基：圓頂山邊緣比中間低，房子不能直接放在曲面上
 block(hotel,[9.6,2.2,3.0],[gh.x,gh.y,gh.z+1.5]);
 for(let f=0;f<3;f++)block(M.glass,[9.0,.08,.42],[gh.x,gh.y-1.12,gh.z+.6+f*.85]);
 for(let x=-4.5;x<=4.6;x+=1.5)block(lineRed,[.16,.16,3.0],[gh.x+x,gh.y-1.2,gh.z+1.5]);
 block(gold,[10.8,3.2,.16],[gh.x,gh.y,gh.z+3.08]);
 instance(hip,gold,[gh.x,gh.y,gh.z+3.14],[10.0,2.8,1.7]);
 for(const sx of [-1,1])for(const sy of [-1,1])block(gold,[.7,.24,.12],[gh.x+sx*5.3,gh.y+sy*1.5,gh.z+3.22],[0,-sx*.45,0]);   // 翹起的屋角
 for(const sx of [-1,1]){block(hotel,[2.6,1.8,1.6],[gh.x+sx*6.4,gh.y+.3,gh.z+.8]);instance(hip,gold,[gh.x+sx*6.4,gh.y+.3,gh.z+1.6],[3.0,2.2,.9]);}
 for(let n=0;n<26;){const x=hill.x-hill.rx+rand()*hill.rx*2,y=hill.y-hill.ry+rand()*hill.ry*2;if(Math.abs(x-gh.x)<7.6&&y>gh.y-1.6)continue;const z=hillZ(x,y);if(z<=groundZ+.05)continue;props.broadleaf(x,y,z-.1,1.4+rand()*1.0);n++;}
 // 對岸左邊：河濱的樹林。
 for(let n=0;n<30;){const x=-31+rand()*43,y=14.9+rand()*4.6;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.6+rand()*1.4);n++;}
 for(let n=0;n<22;n++)props.bush(-31+rand()*62,14.6+rand()*.6,groundZ,.35+rand()*.3);
 // 河濱：自行車道、堤上欄杆與椅子；車站後方兩端的樹。
 block(mat('#c2876a'),[62,.7,.03],[0,10.8,groundZ+.02]);
 for(let x=-30;x<=30;x+=1.5)block(M.steel,[.05,.05,.5],[x,11.3,groundZ+.25]);block(M.steel,[61,.04,.04],[0,11.3,groundZ+.5]);
 for(const x of [-27,-18,-9,0,21,27]){block(bench,[1.2,.3,.1],[x,10.2,groundZ+.3]);block(M.steel,[.09,.09,2.4],[x+1.8,10.2,groundZ+1.2]);block(M.lamp,[.3,.3,.14],[x+1.8,10.2,groundZ+2.42]);pool(x+1.8,10.2,groundZ+.06,2.0);}
 for(let n=0;n<12;){const x=21+rand()*10,y=1.2+rand()*7.8;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.9+rand()*1.1);n++;}
 for(let n=0;n<14;){const x=-31+rand()*12,y=1.2+rand()*7.4;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.9+rand()*1.1);n++;}
 for(const [x,y] of [[-31,-10.4],[30.6,-10.6],[-13.5,-10.6],[13.6,-10.8],[-23,-10.4],[23.5,-10.2]])props.broadleaf(x,y,groundZ,2.0+rand()*.8);

 return k.result({
  path,label:'劍潭站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[gh.x,gh.y,gh.z]},
  extra:{opposingPath:k.reversed(far)},
  update(time,t){cube.emissiveIntensity=t.window*.55;lobby.emissiveIntensity=t.window*.9;for(const a of awnings)a.emissiveIntensity=t.lamp*.55;}
 });
}

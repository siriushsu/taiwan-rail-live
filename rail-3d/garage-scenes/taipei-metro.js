// 台北捷運高運量：淡水信義線劍潭站的微縮印象——龍舟造型屋頂的高架站、隔壁的北藝中心、基隆河對岸山頭的圓山大飯店、
// 站前的士林夜市街口。不是實際線形、方位或比例的重建。
// 車在高架環線上逆時針跑，前直線是車站段：月台與站體都在環內（車在月台前跑）。屋頂伸過軌道，屋簷離軌頂 3.2：
// 從正面看，屋簷外伸 d 擋掉的車身高度是 .73×(d−.63)（全景仰角 .58），外伸 2.4 還露得出 1.7，車高 1.56 整個側面看得到。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e5e9e4',sun:'#fff3d6',ambient:'#c4d8e2',ground:'#84936c',power:3.0,exposure:1.04,water:'#4a8592',shallow:'#83b5aa',lamp:0,window:0},
 sunset:{background:'#efd8c2',sun:'#ffb36e',ambient:'#d4b8b0',ground:'#74795e',power:2.9,exposure:.94,water:'#617f8a',shallow:'#b2a993',lamp:.5,window:.45},
 night:{background:'#131d2c',sun:'#9fbfe4',ambient:'#5b7390',ground:'#29323f',power:.7,exposure:.78,water:'#15324a',shallow:'#2f5a6c',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20311});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,hip,pool,inside}=k;
 const path=k.loop(),railZ=path.z,front=path.front;
 const inStation=q=>q.y<path.cy&&Math.abs(q.x)<11.6;

 // 高架橋與道床：站內那段內側不砌牆（月台接在那裡）、不立墩（站體撐著）；第三軌在月台對面（環外）。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(path);
 k.thirdRail(path,{side:-1});

 const white=mat('#eef0ec',{roughness:.45,metalness:.2}),under=mat('#cfd4d4',{roughness:.6}),cream=mat('#e8e3d5'),lineRed=mat('#c8323b');
 const plaza=mat('#b9b3a5'),dark=mat('#3b4449'),bench=mat('#8b6f52');

 // 月台（環內側）＋半高月台閘門；月台底下到地面是穿堂層，往外一路延伸到高架橋外側的站前入口。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.2,edge:.72,top:.2,bottom:railZ-.73});
 k.gates(p);
 const hallY0=-9.7,hallY1=-1.4,hallTop=railZ-.73,hallH=hallTop-groundZ;
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

 // 月台上：後緣玻璃欄杆、座椅、站名牌、柱子。
 block(M.gateGlass,[20,.04,.85],[0,p.y1-.04,p.z+.43]);
 for(let x=-7.5;x<=7.5;x+=5){block(bench,[1.3,.36,.12],[x,p.y1-.55,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,p.y1-.36,p.z+.52]);}

 // 龍舟屋頂：沿 x 長 2L，兩頭上翹、平面兩頭收窄（船形）；橫向是中間高的淺拱。殼有厚度、四周封邊，底下一道道橫肋。
 const roof={L:12.6,yOut:-8.9,yIn:-1.9,z0:railZ+3.2,rise:2.4,arch:.55,thick:.22};
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
 // 屋頂柱：立在月台後緣，柱頭一塊托板頂住屋頂。
 for(let x=-9.6;x<=9.7;x+=4.8){const y=p.y1-.35,h=roofBottom(x,y)-p.z-.18;block(white,[.26,.26,h],[x,y,p.z+h/2]);block(white,[.9,.5,.18],[x,y,p.z+h+.09]);}
 // 月台吊燈：每盞一根吊桿；點光源只放四盞。
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-4.3,z=p.z+2.35;block(M.lamp,[.8,.32,.07],[x,y,z]);block(M.steel,[.03,.03,roofBottom(x,y)-z],[x,y,(z+roofBottom(x,y))/2]);k.addLight('platform-'+i,x,y,z-.15,2.8,7);}
 // 屋頂底下沿中線一條燈帶，一段段貼著底面轉角度（夜裡整片屋頂從裡面亮起來）。
 for(let x=-9.5;x<9.6;x+=1){const a=roofBottom(x-.5,-5.1),b=roofBottom(x+.5,-5.1);block(M.lamp,[1.02,.22,.04],[x,-5.1,(a+b)/2-.03],[0,-Math.atan2(b-a,1),0]);}

 // 站前：入口廣場、機車格、街口的捷運站名柱；前排是士林夜市的街屋，騎樓前一排攤車，最外面是大馬路。
 block(plaza,[23,7.0,.04],[0,-13.3,groundZ+.02]);
 block(white,[.5,.5,3.2],[10.4,-11.0,groundZ+1.6]);block(M.sign,[.56,.56,.7],[10.4,-11.0,groundZ+2.95]);block(lineRed,[.56,.56,.14],[10.4,-11.0,groundZ+2.45]);
 const scooter=mat('#2f2f33'),seat=mat('#c7c2b6');
 for(const x0 of [-9.8,2.2])for(let i=0;i<14;i++){const x=x0+i*.5;block(scooter,[.3,.7,.34],[x,-12.0,groundZ+.21]);block(seat,[.26,.38,.1],[x,-12.05,groundZ+.42]);}
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
 const cars=['#e9e6df','#3f4a63','#b4402f','#8f9498','#d9c35a'].map(c=>mat(c,{roughness:.5,metalness:.15})),carGlass=mat('#2e3a44',{roughness:.3});
 for(const [x,lane] of [[-21,-1],[-6.5,1],[4.5,-1],[17,1],[26,-1]]){const c=pick(cars),y=roadY+lane*.5;block(c,[1.75,.8,.48],[x,y,groundZ+.3]);block(carGlass,[.9,.7,.34],[x,y,groundZ+.68]);}

 // 環內左邊：北藝中心——中間一顆波浪玻璃方塊（夜裡透光），左邊插一顆球（球劇場）、後面一個大盒子（大劇院）、右邊一個藍盒子。
// 放環內右邊：左邊從預設鏡頭看會整個被屋頂擋住。
 const tp={x:10.4,y:3.4},cube=mat('#dfe3df',{roughness:.3,metalness:.1,emissive:'#ffe4bd',emissiveIntensity:0}),silver=mat('#b9bdb9',{roughness:.35,metalness:.55}),blue=mat('#40618a');
 const sphere=geo(new THREE.IcosahedronGeometry(1,2));
 block(plaza,[11.4,7.6,.5],[tp.x,tp.y,groundZ+.25]);
 block(cube,[6.6,5.4,4.8],[tp.x,tp.y,groundZ+.5+2.4]);
 instance(sphere,silver,[tp.x+4.6,tp.y-.4,groundZ+.5+2.5],[2.15,2.15,2.15]);
 block(dark,[4.2,2.2,3.6],[tp.x-.4,tp.y+3.2,groundZ+.5+1.8]);
 block(blue,[2.4,3.0,2.4],[tp.x-4.3,tp.y+.4,groundZ+.5+1.2]);
 for(let x=6.4;x<=15.2;x+=1.1)block(white,[.08,.08,.9],[x,tp.y-3.9,groundZ+.95]);   // 廣場欄杆
 // 環內左邊：小公園，樹、座椅、三支路燈。
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
 // 環線兩側與前排空隙的樹。
 for(const [x,y] of [[-31,-9],[-30.5,-4],[-30,2],[30.6,-9.5],[30.8,-3],[30.2,3.5],[-13.5,-10.6],[13.6,-10.8],[-23,-10.4],[23.5,-10.2]])props.broadleaf(x,y,groundZ,2.0+rand()*.8);

 return k.result({
  path,label:'劍潭站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[gh.x,gh.y,gh.z]},
  update(time,t){cube.emissiveIntensity=t.window*.55;for(const a of awnings)a.emissiveIntensity=t.lamp*.55;}
 });
}

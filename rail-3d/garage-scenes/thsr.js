// 台灣高鐵：新竹站的微縮印象——高架站，月台上方一片葉形的風帆屋頂（內緣一排桅杆、拉索拉著外緣，屋面往站前翹起），
// 底下是玻璃帷幕的穿堂；站前廣場有接駁公車、計程車排班與一支大風車。站後是客家三合院（正身、兩條護龍、禾埕、半月池）和田，
// 後方是竹北的高樓，右後角三支風力發電機（風城）。雙線高架穿過站體，靠左行駛。不是實際線形、方位或比例的重建；屋頂造型是印象，不是照圖面做的。
// 屋面高度只跟 x、y 有關：zIn＋lift×(x/L)²＋rise×((yIn−y)/W)^1.4，葉形外緣只是把它裁出來。
// 外緣離軌頂最低 4.4、最多伸到軌道中心外 4.1：照 .73 規則還露得出 1.8（車高 1.34），跟車看得到整段車身。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e5ebee',sun:'#fff3d8',ambient:'#c4d6e4',ground:'#8b9a72',power:3.0,exposure:1.04,lamp:0,window:0},
 sunset:{background:'#f1d6bd',sun:'#ffaa62',ambient:'#d6b8ac',ground:'#7b7a5d',power:2.9,exposure:.94,lamp:.5,window:.45},
 night:{background:'#111b2a',sun:'#9cbbe2',ambient:'#566f8d',ground:'#262f3b',power:.7,exposure:.78,lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20455,trees:[['koelreuteria',.4],['terminalia',.35],['acacia',.25]]});
 const {THREE,M,mat,geo,mesh,block,instance,rand,groundZ,props,prism,cylinder,pool,inside}=k;
 const near=k.line(),far=k.line({y:-1.86}),railZ=near.z,front=near.front;
 const inStation=q=>Math.abs(q.x)<12.6;
 k.keepClear((x,y)=>y>-9&&y<.7);   // 高架橋底不種樹
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 兩點之間一根方料（沿 x 的 box 轉過去）。
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};

 // 高架橋（方墩）、直結軌道、架空線（電桿在外側、有吊線）；站內月台那側不砌牆、不立墩。
 k.viaduct(near,{walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.viaduct(far,{walls:[.45,.45],open:(q,side)=>side<0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(near);k.slabTrack(far);
 k.overhead(near,{height:1.95,messenger:.42,mast:-1.6});k.overhead(far,{height:1.95,messenger:.42,mast:1.6});

 const white=mat('#f2f3ef',{roughness:.4,metalness:.25}),silver=mat('#c3c8cc',{roughness:.35,metalness:.55}),orange=mat('#e5732d',{roughness:.5});
 const plaza=mat('#c4bfb2'),bench=mat('#8b6f52'),dark=mat('#3b4449');

 // 島式月台（高出軌頂 .25）、座椅。
 const p=k.platform({y:front,z:railZ,side:1,length:22,width:3.2,edge:.72,top:.25,bottom:railZ-.73});
 for(let x=-7.5;x<=7.5;x+=5)for(const s of [-1,1]){block(bench,[1.3,.3,.12],[x,(p.y0+p.y1)/2+s*.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,(p.y0+p.y1)/2+s*.28,p.z+.52]);}

 // 穿堂：月台底下、往外延伸到高架橋外側；前後整片玻璃帷幕、細銀框，正面頂上一條高鐵橘，中間入口一片雨棚。
 const hallY0=-10.2,hallY1=-.1,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(white,[24,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(silver,[24.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);
 for(const y of [hallY0-.03,hallY1+.03]){
  block(M.glass,[22.6,.1,hallH-.7],[0,y,groundZ+.1+(hallH-.7)/2]);
  for(let x=-11.3;x<=11.4;x+=1.13)block(silver,[.06,.14,hallH-.65],[x,y+(y<0?-.04:.04),groundZ+.1+(hallH-.7)/2]);
 }
 block(orange,[24.1,.08,.24],[0,hallY0-.05,hallTop-.24]);
 block(white,[7,1.8,.12],[0,hallY0-.9,groundZ+2.2]);block(orange,[7.04,.08,.14],[0,hallY0-1.79,groundZ+2.2]);
 for(const s of [-1,1])block(silver,[.1,.1,2.15],[s*3.2,hallY0-1.6,groundZ+1.08]);
 block(M.sign,[3.0,.12,.4],[0,hallY0-.1,groundZ+2.65]);
 k.addLight('entrance',0,hallY0-1.3,groundZ+2.0,1.3,6);

 // 風帆屋頂：平面是一片葉形（內緣沿桅杆一直線、外緣往站前鼓出去、兩端收尖），上下兩面加內外兩條側邊。
 const sail={L:14,yIn:-3.3,W:7.3,zIn:railZ+2.9,rise:1.6,lift:.9,t:.12};
 const sailZ=(x,y)=>sail.zIn+sail.lift*(x/sail.L)**2+sail.rise*Math.pow(Math.max(0,sail.yIn-y)/sail.W,1.4);   // 屋面頂在 (x, y) 的高度
 const sailEdge=x=>sail.yIn-sail.W*Math.sqrt(Math.max(0,1-(x/sail.L)**2));   // 外緣在 x 處的 y
 {
  const NX=48,NU=10,v=[],idx=[];
  const P=(i,j)=>{const x=-Math.cos(Math.PI*i/NX)*sail.L,y=sail.yIn+(sailEdge(x)-sail.yIn)*j/NU;return [x,y,sailZ(x,y)];};
  const add=q=>{v.push(...q);return v.length/3-1;};
  const T=[],B=[];
  for(let i=0;i<=NX;i++){T.push([]);B.push([]);for(let j=0;j<=NU;j++){const q=P(i,j);T[i].push(add(q));B[i].push(add([q[0],q[1],q[2]-sail.t]));}}
  for(let i=0;i<NX;i++)for(let j=0;j<NU;j++){
   idx.push(T[i][j],T[i][j+1],T[i+1][j+1],T[i][j],T[i+1][j+1],T[i+1][j]);   // 上面朝上
   idx.push(B[i][j],B[i+1][j+1],B[i][j+1],B[i][j],B[i+1][j],B[i+1][j+1]);}  // 下面朝下
  // 側邊頂點另外加，法向不跟屋面平均；外緣朝外、內緣朝 +y。
  for(const [j,out] of [[0,false],[NU,true]]){
   const tt=[],bb=[];for(let i=0;i<=NX;i++){const q=P(i,j);tt.push(add(q));bb.push(add([q[0],q[1],q[2]-sail.t]));}
   for(let i=0;i<NX;i++){if(out)idx.push(tt[i],bb[i],tt[i+1],tt[i+1],bb[i],bb[i+1]);else idx.push(tt[i],tt[i+1],bb[i],tt[i+1],bb[i+1],bb[i]);}
  }
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();mesh(g,white).name='station-roof';
 }
 // 桅杆：內緣一排五支，從穿堂頂立起、高出屋頂一截；每支兩條拉索斜拉到外緣附近，外緣一條高鐵橘。
 for(const x of [-11,-5.5,0,5.5,11]){const y=sail.yIn+.06,z1=sailZ(x,sail.yIn)+1.7;
  instance(cylinder,white,[x,y,(hallTop+z1)/2],[.3,.3,z1-hallTop]);
  for(const s of [-1,1]){const tx=x+s*1.8,ty=sail.yIn+(sailEdge(tx)-sail.yIn)*.82;beam(M.wire,[x,y,z1-.12],[tx,ty,sailZ(tx,ty)],.035);}}
 for(let i=0;i<40;i++){const x0=-sail.L+i*sail.L/20,x1=x0+sail.L/20,a=[x0,sailEdge(x0)],b=[x1,sailEdge(x1)];
  beam(orange,[a[0],a[1],sailZ(...a)+.01],[b[0],b[1],sailZ(...b)+.01],.06,.03);}
 // 月台吊燈三盞（點光源），吊桿接到屋頂底面。
 [-7,0,7].forEach((x,i)=>{const y=-4.2,z=p.z+2.1,zr=sailZ(x,y)-sail.t;
  block(M.lamp,[1.0,.3,.07],[x,y,z]);block(M.steel,[.03,.03,zr-z],[x,y,(z+zr)/2]);k.addLight('platform-'+i,x,y,z-.15,2.6,7);});

 // 站前：廣場、接駁公車（候車棚）、計程車排班、一支大風車、路燈；最外面是馬路。
 block(plaza,[30,6.2,.04],[0,-13.3,groundZ+.02]);
 for(const x of [-12.4,-7.8])k.bus(x,-11.8,{len:3.8,stripe:orange});
 block(white,[8,1.0,.08],[-10.2,-12.95,groundZ+1.6]);for(const x of [-13.8,-6.6])block(silver,[.08,.08,1.6],[x,-13.3,groundZ+.8]);
 for(let x=4.2;x<=12.2;x+=2.1)k.car(x,-12.0,{taxi:true,kind:'sedan'});
 // 大風車：四片彩色葉片在面向站前的平面上，風城的意象（不會轉）。
 const vane=['#d2453a','#e8c547','#3f8ac0','#5aa86b'].map(c=>mat(c,{roughness:.5}));
 const mill={x:0,y:-14.6,z:groundZ+3.6};
 instance(cylinder,silver,[mill.x,mill.y,groundZ+1.8],[.16,.16,3.6]);instance(cylinder,dark,[mill.x,mill.y,groundZ+.08],[1.2,1.2,.16]);
 vane.forEach((m,i)=>{const t=i*Math.PI/2+.3,c=Math.cos(t),s=Math.sin(t);block(m,[.1,.05,1.6],[mill.x+s*.8,mill.y-.14,mill.z+c*.8],[0,t,0]);
  block(m,[.62,.05,.75],[mill.x+s*1.15+c*.3,mill.y-.14,mill.z+c*1.15-s*.3],[0,t,0]);});
 for(const x of [-13,13]){block(M.steel,[.1,.1,2.6],[x,-15.8,groundZ+1.3]);block(M.lamp,[.36,.36,.1],[x,-15.8,groundZ+2.6]);pool(x,-15.8,groundZ+.06,2.2);}
 k.addLight('plaza',0,-13.2,groundZ+2.6,1.0,7);
 const roadY=-18.4;props.road(0,roadY,groundZ,62,2.0);
 for(const [x,lane] of [[-22,-1],[-9,1],[3.5,-1],[16,1],[25,-1]])k.car(x,roadY+lane*.5,{yaw:lane<0?0:Math.PI});

 // 站前左邊：生醫園區的白色研發大樓（兩層玻璃帶、屋頂綠化）與草坪；右邊：轉乘停車場。
 block(white,[11,3.6,3.2],[-23.8,-12.8,groundZ+1.6]);
 for(const z of [.9,2.2])block(M.glass,[11.04,3.64,.55],[-23.8,-12.8,groundZ+z]);
 block(mat('#7fa35e',{roughness:.9}),[10.4,3.0,.08],[-23.8,-12.8,groundZ+3.24]);
 const lot={x0:16.6,x1:29.4,y0:-16.4,y1:-10.6},line=mat('#e8e4d8');
 block(mat('#6b6d6b'),[lot.x1-lot.x0,lot.y1-lot.y0,.04],[(lot.x0+lot.x1)/2,(lot.y0+lot.y1)/2,groundZ+.02]);
 for(const [y0,dir] of [[lot.y0+.15,1],[lot.y1-.15,-1]])for(let x=lot.x0+.4;x<lot.x1-.6;x+=1.1){
  block(line,[.05,2.0,.01],[x,y0+dir*1.0,groundZ+.045]);if(rand()<.7)k.car(x+.55,y0+dir*1.05,{yaw:dir*Math.PI/2});}

 // 站後：右側是客家三合院（正身、左右護龍、紅瓦斜屋頂、白牆紅磚腳）、禾埕、正前方一口半月池，旁邊一座伯公小廟；
 // 左側是稻田，中間（風帆屋頂後面，預設視角被屋頂擋住的那塊）是菜畦。
 const wallW=mat('#efe9dc',{roughness:.85}),brick=mat('#b0573f',{roughness:.8}),tileR=mat('#a5553f',{roughness:.7}),yard=mat('#cdb08a',{roughness:.9});
 const hk={x:14.5,y:7.0};
 block(yard,[9.2,4.2,.04],[hk.x,hk.y-.2,groundZ+.02]);
 const house=(x,y,len,dep,h,rot)=>{block(wallW,[len,dep,h],[x,y,groundZ+h/2],[0,0,rot]);block(brick,[len+.02,dep+.02,.35],[x,y,groundZ+.175],[0,0,rot]);
  instance(prism,tileR,[x,y,groundZ+h],[len+.3,dep+.4,.75],[0,0,rot]);};
 house(hk.x,hk.y+2.2,8.4,1.7,1.35,0);
 for(const s of [-1,1])house(hk.x+s*3.9,hk.y-.1,3.6,1.4,1.15,Math.PI/2);
 const door=mat('#5a3b2a',{roughness:.7}),lantern=mat('#c8382e',{emissive:'#ff4a2e',emissiveIntensity:0});
 block(door,[.9,.05,.95],[hk.x,hk.y+1.33,groundZ+.48]);
 for(const s of [-1,1]){for(const dx of [1.6,2.6])block(dark,[.5,.05,.42],[hk.x+s*dx,hk.y+1.33,groundZ+.8]);
  instance(cylinder,lantern,[hk.x+s*.7,hk.y+1.22,groundZ+1.05],[.24,.24,.3]);}
 const pondM=mat('#3f6a74',{roughness:.18,metalness:.2});
 mesh(geo(new THREE.CircleGeometry(2.4,28,Math.PI,Math.PI)),pondM,[hk.x,hk.y-2.4,groundZ+.04]).castShadow=false;
 mesh(geo(new THREE.RingGeometry(2.4,2.65,28,1,Math.PI,Math.PI)),brick,[hk.x,hk.y-2.4,groundZ+.05]);
 block(brick,[5.3,.25,.1],[hk.x,hk.y-2.35,groundZ+.05]);
 k.addLight('courtyard',hk.x,hk.y,groundZ+1.9,.9,6);
 const paddy=['#9cb85f','#abc46b','#8eae57','#b7c977','#a2bb63'].map(c=>mat(c,{roughness:.92})),bund=mat('#bba981');
 function fields(x0,x1,y0,y1,w=3.4,d=2.5){
  const nx=Math.max(1,Math.round((x1-x0)/w)),ny=Math.max(1,Math.round((y1-y0)/d)),dx=(x1-x0)/nx,dy=(y1-y0)/ny;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)block(pick(paddy),[dx-.14,dy-.14,.05],[x0+(i+.5)*dx,y0+(j+.5)*dy,groundZ+.025]);
  for(let i=0;i<=nx;i++)block(bund,[.14,y1-y0+.14,.09],[x0+i*dx,(y0+y1)/2,groundZ+.045]);
  for(let j=0;j<=ny;j++)block(bund,[x1-x0+.14,.14,.09],[(x0+x1)/2,y0+j*dy,groundZ+.045]);
 }
 fields(-31,-6.4,.8,11);
 const soilM=mat('#8d6f52',{roughness:.95}),leaf=mat('#6f9c4c',{roughness:.85});
 for(let y=1;y<11;y+=.7){block(soilM,[11.2,.42,.08],[0,y,groundZ+.04]);block(leaf,[10.8,.24,.16],[0,y,groundZ+.1]);}
 block(brick,[.9,.8,.7],[8.6,2.6,groundZ+.35]);instance(prism,tileR,[8.6,2.6,groundZ+.7],[1.2,1.1,.45]);block(dark,[.36,.05,.36],[8.6,2.19,groundZ+.4]);
 for(let n=0;n<14;){const x=23.5+rand()*7.5,y=1+rand()*10;if(!inside(x,y,1.2))continue;props.broadleaf(x,y,groundZ,1.7+rand()*1.0);n++;}

 // 後方：竹北的高樓一排（窗帶夜裡會亮），右後角三支風力發電機（葉片面向站前，不會轉）。
 props.road(-4,12.6,groundZ,52,1.8);
 for(const [x,lane] of [[-24,-1],[-13,1],[-2,-1],[9,1],[17,-1]])k.car(x,12.6+lane*.45,{yaw:lane<0?0:Math.PI});
 const towerM=['#dcd8cf','#c9cfd2'].map(c=>mat(c,{roughness:.7}));
 [[-28.4,3.2,9.4],[-23.2,3.8,12.2],[-17.8,3.2,10.2],[-12.4,3.8,13.4],[-6.8,3.4,9.6],[-1.2,3.8,11.8],[4.4,3.4,10.6],[10,3.6,12.6]].forEach(([x,w,h],i)=>k.tower(x,16.4+(rand()-.5)*1.2,{w,d:3.0,h,body:pick(towerM),kind:i%3===1?'office':'home'}));
 const navRed=mat('#d23a32',{emissive:'#ff3b2f',emissiveIntensity:0});
 for(const [x,y,h,a] of [[20.2,15.2,9.2,.2],[25.4,17.8,10.4,.75],[30.2,14.8,8.6,1.3]]){const hub=groundZ+h+.1;
  instance(cylinder,white,[x,y,groundZ+h/2],[.34,.34,h]);block(white,[.42,1.0,.42],[x,y,hub]);
  for(let b=0;b<3;b++){const t=a+b*2*Math.PI/3;block(white,[.2,.06,3.0],[x+Math.sin(t)*1.5,y-.55,hub+Math.cos(t)*1.5],[0,t,0]);}
  block(navRed,[.14,.14,.1],[x,y+.2,hub+.26]);}
 for(let y=-15.5;y<=16.5;y+=2.6){for(const x of [-31.4,31.4])if(inside(x,y,1.2)&&!(x>0&&y>12))props.broadleaf(x+(rand()-.5)*.4,y,groundZ,2.0+rand()*.8);}

 return k.result({
  path:k.reversed(near),label:'高鐵新竹站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[-12.4,16.4,groundZ+13]},
  extra:{opposingPath:far},
  update(time,t){lantern.emissiveIntensity=t.lamp*1.2;navRed.emissiveIntensity=t.lamp*1.4;}
 });
}

// 淡海輕軌：淡水漁人碼頭站的微縮印象——路面輕軌（草皮軌、單條架空線）的車站，月台在環內側、白色波浪雨棚，
// 站前是漁港：漁船停在港池、情人橋（單支斜塔的斜張橋）跨過港池、岸邊一條木棧道，右前方是情人塔的廣場，後方是海景飯店。
// 不是實際線形、方位或比例的重建。橋、塔、船都不會動（App 的場景檔是烘好的靜態幾何，網頁照同一份）。
// 雨棚在軌道後面（環內側），前緣只伸到軌道中心內 .55、棚底離軌頂 2.4 以上，高過集電弓（2.01）：從正面看不擋車身。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e3eaee',sun:'#fff3d6',ambient:'#c4d8e6',ground:'#86996a',power:3.0,exposure:1.04,water:'#2f6470',shallow:'#5d9192',lamp:0,window:0},
 sunset:{background:'#f4cfae',sun:'#ff9f55',ambient:'#d9b2a0',ground:'#7a7856',power:2.9,exposure:.94,water:'#5d6f84',shallow:'#c9926f',lamp:.5,window:.45},
 night:{background:'#111a29',sun:'#9cbbe2',ambient:'#566f8d',ground:'#27303b',power:.7,exposure:.78,water:'#122d46',shallow:'#2a5368',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20366,trees:[['hibiscus',.35],['terminalia',.35],['koelreuteria',.3]]});
 const {M,mat,block,instance,rand,groundZ,props,prism,cylinder,pool,inside}=k;
 const path=k.loop({z:groundZ+.02}),railZ=path.z,front=path.front;
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 兩點之間一根方料（沿 x 的 box 轉過去），橋面、索、斜塔都用它。
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};

 // 草皮軌＋單條架空線，電桿在環外側（月台在環內側）。
 k.embeddedTrack(path,{surface:'grass'});
 k.overhead(path,{mast:-1.35});

 const white=mat('#f4f3ee',{roughness:.45}),orange=mat('#e2793a',{roughness:.5}),wood=mat('#9a7452',{roughness:.8}),woodDark=mat('#6f5139',{roughness:.8});
 const quay=mat('#c9c4b8',{roughness:.8}),paving=mat('#d3c7b0'),asphalt=mat('#5f656a'),bench=mat('#8b6f52'),tvm=mat('#2f6aa0'),line=mat('#e8e4da');
 const led=mat('#bfe9ff',{emissive:'#7fd3ff',emissiveIntensity:0}),red=mat('#d23a32',{emissive:'#ff3b2f',emissiveIntensity:0});

 // 月台（環內側、低地板 .1）：後緣玻璃擋風板、座椅、售票機、站名柱。
 const p=k.platform({y:front,z:railZ,side:1,length:19,width:2.8,edge:.7,top:.1,bottom:groundZ});
 block(M.gateGlass,[18.4,.05,1.1],[0,p.y1-.08,p.z+.55]);
 for(const x of [-6.4,0,6.4]){block(bench,[1.3,.36,.12],[x,p.y1-.55,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,p.y1-.36,p.z+.52]);}
 for(const x of [-3.2,3.2])block(tvm,[.5,.36,1.05],[x,p.y1-.32,p.z+.52]);
 block(orange,[.46,.46,2.5],[-9.0,p.y1-.7,p.z+1.25]);block(M.sign,[.05,.4,.86],[-9.0+.255,p.y1-.7,p.z+1.85]);
 // 白色波浪雨棚：沿 x 起伏三個浪，前緣一條橘色封邊；只靠後緣一排白柱撐著。
 const can={y0:p.y0-.15,y1:p.y1+.3,z:railZ+2.75,amp:.3,wave:6.4,L:9.8},canY=(can.y0+can.y1)/2;
 const canZ=x=>can.z+can.amp*Math.sin(2*Math.PI*(x+can.L)/can.wave);
 for(let i=0,N=36;i<N;i++){const xa=-can.L+2*can.L*i/N,xb=xa+2*can.L/N;
  beam(white,[xa,canY,canZ(xa)],[xb,canY,canZ(xb)],can.y1-can.y0,.1);
  beam(orange,[xa,can.y0-.03,canZ(xa)],[xb,can.y0-.03,canZ(xb)],.07,.18);}
 for(let x=-8;x<=8.1;x+=3.2){const z1=canZ(x);instance(cylinder,white,[x,p.y1-.4,(p.z+z1)/2],[.18,.18,z1-p.z]);}
 for(let i=0;i<3;i++){const x=-6.4+i*6.4,z=canZ(x)-.12;block(M.lamp,[.9,.18,.08],[x,canY,z]);k.addLight('platform-'+i,x,canY,z-.3,2.6,7);}

 // 站前：步道（電桿立在邊上）；左前方港池開口朝外，三面碼頭，後面一條木棧道；兩邊鋪面是碼頭廣場。
 block(paving,[62,2.0,.04],[0,-9.2,groundZ+.02]);
 for(let x=-27;x<=27.1;x+=9){block(M.steel,[.08,.08,2.3],[x,-9.9,groundZ+1.15]);block(M.lamp,[.32,.32,.18],[x,-9.9,groundZ+2.3]);pool(x,-9.6,groundZ+.06,2.0,1.5);}
 const bs={x0:-22,x1:-8,y0:-19.6,y1:-12.0};
 k.river(bs.x1-bs.x0,bs.y1-bs.y0,[(bs.x0+bs.x1)/2,(bs.y0+bs.y1)/2],THEMES.day);
 block(quay,[bs.x1-bs.x0+.8,.5,.26],[(bs.x0+bs.x1)/2,bs.y1+.25,groundZ+.13]);
 for(const x of [bs.x0-.2,bs.x1+.2])block(quay,[.4,bs.y1-bs.y0+.5,.26],[x,(bs.y0+bs.y1)/2+.25,groundZ+.13]);
 block(paving,[8.2,9.2,.04],[-26.5,-14.8,groundZ+.02]);block(paving,[38.1,9.2,.04],[11.45,-14.8,groundZ+.02]);
 block(wood,[18,1.3,.08],[-14.5,-10.85,groundZ+.04]);
 for(let x=-23.2;x<-5.6;x+=.6)block(woodDark,[.04,1.3,.085],[x,-10.85,groundZ+.04]);
 block(white,[bs.x1-bs.x0+.6,.05,.05],[(bs.x0+bs.x1)/2,bs.y1+.3,groundZ+.82]);
 for(let x=bs.x0;x<=bs.x1+.1;x+=1.4)block(white,[.06,.06,.56],[x,bs.y1+.3,groundZ+.54]);

 // 情人橋：橋面跨過港池、中間拱起；左岸一支白色斜塔向港池斜出，斜張索拉著橋面，兩條背索拉回岸上；夜裡橋緣燈帶亮起。
 const br={x0:-25.6,x1:-4.8,y:-16.4,w:1.3,z0:groundZ+.3,rise:1.3};
 const brZ=x=>br.z0+br.rise*(1-((2*x-br.x0-br.x1)/(br.x1-br.x0))**2);
 for(let i=0,N=26;i<N;i++){const xa=br.x0+(br.x1-br.x0)*i/N,xb=br.x0+(br.x1-br.x0)*(i+1)/N;
  beam(white,[xa,br.y,brZ(xa)],[xb,br.y,brZ(xb)],br.w,.18);
  for(const s of [-1,1]){beam(M.gateGlass,[xa,br.y+s*(br.w/2-.04),brZ(xa)+.38],[xb,br.y+s*(br.w/2-.04),brZ(xb)+.38],.04,.6);
   beam(led,[xa,br.y+s*(br.w/2+.01),brZ(xa)-.05],[xb,br.y+s*(br.w/2+.01),brZ(xb)-.05],.03,.06);}}
 for(const x of [br.x0,br.x1])block(white,[1.0,br.w+.4,.3],[x,br.y,groundZ+.15]);
 const pyB=[-24.0,-18.3,groundZ],pyT=[-19.8,-17.4,groundZ+8.4],py=t=>pyB.map((v,i)=>v+(pyT[i]-v)*t);
 beam(white,py(0),py(.34),.56);beam(white,py(.33),py(.67),.46);beam(white,py(.66),py(1),.36);
 for(let i=0;i<5;i++)beam(M.wire,py(.55+i*.1),[-21.5+i*2.5,br.y-br.w/2+.1,brZ(-21.5+i*2.5)+.05],.04);
 for(const y of [-18.9,-17.7])beam(M.wire,py(.97),[-28.6,y,groundZ+.25],.04);
 block(quay,[.7,1.8,.4],[-28.6,-18.3,groundZ+.2]);
 k.addLight('bridge',-17.5,-15.0,groundZ+2.6,1.5,9);

 // 港池裡的漁船：四艘船頭朝碼頭停著，兩艘在橋外側；V 形船身（倒放的三角柱）、白色船艙、桅桿。
 const hulls=['#f2f0ea','#2f5f9a','#b8403a','#3f8a6a'].map(c=>mat(c,{roughness:.55}));
 const boat=(x,y,yaw,len)=>{const hz=groundZ+.32,c=Math.cos(yaw),s=Math.sin(yaw);
  instance(prism,pick(hulls),[x,y,hz],[len,.95,.5],[Math.PI,0,yaw]);
  block(white,[len*.3,.66,.42],[x+c*len*.08,y+s*len*.08,hz+.21],[0,0,yaw]);block(M.glass,[len*.31,.68,.12],[x+c*len*.08,y+s*len*.08,hz+.3],[0,0,yaw]);
  block(M.steel,[.05,.05,1.3],[x-c*len*.24,y-s*len*.24,hz+.65]);};
 for(const x of [-20.6,-18.9,-17.2,-15.5])boat(x,-13.6,Math.PI/2,2.6);
 boat(-13.4,-18.4,0,2.8);boat(-10.2,-18.6,.12,2.4);

 // 左岸：海鮮餐廳（白牆藍瓦、整排窗）。
 block(white,[5.8,2.8,1.9],[-27.3,-13.0,groundZ+.95]);instance(prism,mat('#3f6f9e'),[-27.3,-13.0,groundZ+1.9],[6.2,3.2,1.0]);
 block(M.glass,[5.0,.06,.8],[-27.3,-14.42,groundZ+1.0]);block(M.sign,[2.4,.08,.34],[-27.3,-14.44,groundZ+1.62]);

 // 右前角：情人塔（放在角落，跟車時才不會擋在車前）——圓形基座、細高的塔身、繞著塔身的環形觀景艙（停在半高），塔頂紅色航空燈。
 const tw={x:25.5,y:-13.6};
 instance(cylinder,white,[tw.x,tw.y,groundZ+.6],[5.2,5.2,1.2]);instance(cylinder,M.glass,[tw.x,tw.y,groundZ+.62],[5.3,5.3,.55]);
 instance(cylinder,white,[tw.x,tw.y,groundZ+6.3],[1.3,1.3,11.2]);
 instance(cylinder,white,[tw.x,tw.y,groundZ+4.2],[4.8,4.8,.24]);instance(cylinder,M.glass,[tw.x,tw.y,groundZ+4.85],[4.6,4.6,1.06]);instance(cylinder,white,[tw.x,tw.y,groundZ+5.5],[4.8,4.8,.22]);
 instance(cylinder,white,[tw.x,tw.y,groundZ+12.2],[1.9,1.9,.6]);instance(cylinder,M.steel,[tw.x,tw.y,groundZ+13.3],[.1,.1,1.6]);block(red,[.2,.2,.2],[tw.x,tw.y,groundZ+14.15]);
 k.addLight('tower',tw.x-2.6,tw.y+1.6,groundZ+1.8,1.3,7);
 for(let i=0;i<4;i++)block(bench,[1.3,.4,.36],[tw.x+(i<2?-1:1)*4.4,tw.y+(i%2?-1.6:1.6),groundZ+.18]);
 // 椰子樹：細樹幹、一圈下垂的葉子。
 const trunk=mat('#8a7458',{roughness:.8}),frond=mat('#4f7f45',{roughness:.7});
 const palm=(x,y,h)=>{instance(cylinder,trunk,[x,y,groundZ+h/2],[.2,.2,h]);
  for(let i=0;i<7;i++){const a=i/7*Math.PI*2+rand(),c=Math.cos(a),s=Math.sin(a);beam(frond,[x,y,groundZ+h],[x+c*1.25,y+s*1.25,groundZ+h-.55],.34,.05);}};
 for(const [x,y] of [[-4.6,-12.2],[-2.2,-17.6],[3.4,-12.4],[6.8,-17.8],[10.6,-12.0],[15.0,-17.6],[19.6,-11.4],[21.2,-18.4],[-29.8,-10.8],[-24.6,-10.6]])palm(x,y,2.6+rand()*.8);

 // 環內：遊覽車停車場、小客車停車場、遊客中心、草地與椰子樹。
 block(asphalt,[11,6.6,.04],[-10.2,.4,groundZ+.02]);
 for(let x=-14.6;x<=-5.8;x+=1.8)block(line,[.06,4.6,.01],[x,.4,groundZ+.045]);
 const buses=['#f1efe9','#4c79b8','#d8b04a','#f1efe9'].map(c=>mat(c,{roughness:.5}));
 for(let i=0;i<4;i++)k.bus(-13.7+i*1.8,.4,{yaw:Math.PI/2,paint:buses[i],stripe:buses[(i+1)%4]});
 block(asphalt,[7.2,3.6,.04],[14.2,-1.2,groundZ+.02]);
 for(let x=11.2;x<=17.3;x+=1.2){block(line,[.05,1.8,.01],[x-.6,-1.2,groundZ+.045]);if(rand()<.75)k.car(x,-1.25,{yaw:Math.PI/2});}
 block(white,[5.2,3.0,1.6],[12.4,2.4,groundZ+.8]);instance(prism,mat('#3f6f9e'),[12.4,2.4,groundZ+1.6],[5.6,3.4,.9]);block(M.glass,[4.2,.06,.7],[12.4,.88,groundZ+.8]);
 for(const [x,y] of [[-2.6,1.2],[1.4,3.8],[5.4,.6],[7.6,5.4],[17.6,-.8],[19.4,4.6],[-17.8,3.4],[-20.4,-.4]])palm(x,y,2.4+rand()*.8);
 for(let n=0;n<10;){const x=-16+rand()*34,y=6.2+rand()*1.6;props.bush(x,y,groundZ,.5+rand()*.4);n++;}

 // 後方：海景飯店（白色、藍玻璃窗帶、左端圓塔）與山丘、樹。
 const hotel={x:15,y:15.6,w:17,d:4.4,h:5.4};
 block(white,[hotel.w,hotel.d,hotel.h],[hotel.x,hotel.y,groundZ+hotel.h/2]);
 for(let f=0;f<5;f++)block(M.glass,[hotel.w+.04,hotel.d+.04,.34],[hotel.x,hotel.y,groundZ+.75+f*1.0]);
 instance(prism,mat('#3f6f9e'),[hotel.x,hotel.y,groundZ+hotel.h],[hotel.w+.3,hotel.d+.3,1.1]);
 instance(cylinder,white,[hotel.x-hotel.w/2-1.4,hotel.y,groundZ+3.5],[3.4,3.4,7.0]);instance(cylinder,M.glass,[hotel.x-hotel.w/2-1.4,hotel.y,groundZ+5.6],[3.5,3.5,.5]);
 instance(cylinder,mat('#3f6f9e'),[hotel.x-hotel.w/2-1.4,hotel.y,groundZ+7.25],[3.0,3.0,.5]);
 const hill={x:-15,y:17.2,rx:12,ry:2.7,rz:3.2},dome=k.geo(new k.THREE.SphereGeometry(1,28,8,0,Math.PI*2,0,Math.PI/2));dome.rotateX(Math.PI/2);
 instance(dome,mat('#6f8a5a'),[hill.x,hill.y,groundZ],[hill.rx,hill.ry,hill.rz]);
 const hillZ=(x,y)=>groundZ+hill.rz*Math.sqrt(Math.max(0,1-((x-hill.x)/hill.rx)**2-((y-hill.y)/hill.ry)**2));
 for(let n=0;n<20;){const x=hill.x-hill.rx+rand()*hill.rx*2,y=hill.y-hill.ry+rand()*hill.ry*2,z=hillZ(x,y);if(z<=groundZ+.1||!inside(x,y,1.2))continue;props.broadleaf(x,y,z-.1,1.4+rand()*1.0);n++;}
 for(let n=0;n<8;){const x=24+rand()*6,y=12+rand()*6;if(!inside(x,y,1.4))continue;props.broadleaf(x,y,groundZ,1.6+rand()*.8);n++;}
 for(const [x,y] of [[-31,-6],[-30.6,-1],[-30.8,4.4],[30.8,-6.4],[30.6,-1.2],[30.8,4.2],[-30.4,10.4],[31,9.6]])props.broadleaf(x,y,groundZ,2.0+rand()*.8);

 return k.result({
  path,label:'淡水漁人碼頭站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,canY,can.z],deck:[0,front,railZ],backdrop:[tw.x,tw.y,groundZ+5]},
  update(time,t){led.emissiveIntensity=t.lamp*1.6;red.emissiveIntensity=t.lamp*1.5;}
 });
}

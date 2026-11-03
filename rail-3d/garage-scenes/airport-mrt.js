// 桃園機場捷運：山鼻站的微縮印象——田野中的高架站（機翼剖面的屋頂、玻璃帷幕站體、機捷紫的腰帶），
// 四周是稻田、埤塘與農舍，後方一架降落中的客機架在透明支柱上。不是實際線形、方位或比例的重建。
// 飛機不會動：App 的場景檔是烘好的靜態幾何，網頁照同一份，兩邊一樣。
// 機翼屋頂只靠月台後緣一排 Y 形柱撐著，前緣伸到環外側、離軌頂 3.8：從正面看，屋簷外伸 d 擋掉的車身高度是 .73×(d−.63)，
// 前緣外伸 2.9 還露得出 2.1，車高 1.54 整個側面看得到。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e6ebe6',sun:'#fff4d8',ambient:'#c6d9e3',ground:'#8a9a6a',power:3.0,exposure:1.04,water:'#4f7f78',shallow:'#8fb59a',lamp:0,window:0},
 sunset:{background:'#f0d9c2',sun:'#ffb46e',ambient:'#d5bab0',ground:'#7a7d5c',power:2.9,exposure:.94,water:'#62807a',shallow:'#b8ad8c',lamp:.5,window:.45},
 night:{background:'#121c2b',sun:'#9fbfe4',ambient:'#58718e',ground:'#28313c',power:.7,exposure:.78,water:'#14304a',shallow:'#2c5568',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20333});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,cylinder,pool,inside}=k;
 const path=k.loop(),railZ=path.z,front=path.front;
 const inStation=q=>q.y<path.cy&&Math.abs(q.x)<11.6;
 const pick=list=>list[Math.floor(rand()*list.length)];

 // 高架橋與道床：站內那段內側不砌牆、不立墩（站體撐著）；第三軌在月台對面（環外）。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(path);
 k.thirdRail(path,{side:-1});

 const white=mat('#eef0ec',{roughness:.45,metalness:.2}),silver=mat('#c2c7cb',{roughness:.35,metalness:.55}),purple=mat('#7f4aa6',{roughness:.5});
 const under=mat('#cfd4d4',{roughness:.6}),plaza=mat('#bab5a8'),bench=mat('#8b6f52'),dark=mat('#3b4449');

 // 月台（環內側）＋半高月台閘門；穿堂層在月台底下，往外延伸到高架橋外側的站前入口。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.2,edge:.72,top:.2,bottom:railZ-.73});
 k.gates(p);
 block(M.gateGlass,[20,.04,.85],[0,p.y1-.04,p.z+.43]);
 for(let x=-7.5;x<=7.5;x+=5){block(bench,[1.3,.36,.12],[x,p.y1-.55,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,p.y1-.36,p.z+.52]);}
 const hallY0=-9.7,hallY1=-1.4,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(white,[22,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(under,[22.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);   // 高架橋外側那條站體頂
 // 前後兩面整片玻璃帷幕、細細的銀色豎框；正面頂上一條機捷紫的腰帶。
 for(const y of [hallY0-.03,hallY1+.03]){
  block(M.glass,[20.6,.1,hallH-.75],[0,y,groundZ+.1+(hallH-.75)/2]);
  for(let x=-10.3;x<=10.4;x+=1.03)block(silver,[.06,.14,hallH-.7],[x,y+(y<0?-.04:.04),groundZ+.1+(hallH-.75)/2]);
 }
 block(purple,[22.1,.08,.26],[0,hallY0-.05,hallTop-.25]);
 for(const x of [-5.4,5.4]){
  block(white,[4.0,1.8,.12],[x,hallY0-.9,groundZ+2.1]);block(purple,[4.04,.08,.14],[x,hallY0-1.79,groundZ+2.1]);
  for(const s of [-1,1])block(silver,[.1,.1,2.05],[x+s*1.8,hallY0-1.6,groundZ+1.03]);
  block(M.sign,[2.4,.12,.4],[x,hallY0-.08,groundZ+2.55]);
 }
 k.addLight('entrance',0,hallY0-1.3,groundZ+2.0,1.3,6);

 // 機翼屋頂：翼型剖面（NACA 四位數的厚度分布、一點拱度）沿 x 擠出，前緣在環外側、往環內側降低。
 const wing={L:12.6,yOut:-9.4,yIn:-1.6,zl:railZ+3.8,zt:railZ+3.2,camber:.25,t:.08},chord=wing.yIn-wing.yOut;
 const wingAt=(u,side)=>{const th=5*wing.t*chord*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);
  return [wing.yOut+u*chord,wing.zl+(wing.zt-wing.zl)*u+wing.camber*4*u*(1-u)+side*th];};
 const roofBottom=y=>wingAt((y-wing.yOut)/chord,-1)[1];   // 屋頂底面在 y 處的高度
 {
  const N=24,us=[...Array(N+1)].map((_,i)=>(1-Math.cos(Math.PI*i/N))/2),prof=[];
  for(let i=0;i<=N;i++)prof.push(wingAt(us[i],1));for(let i=N-1;i>0;i--)prof.push(wingAt(us[i],-1));
  const n=prof.length,v=[],idx=[];
  for(const x of [-wing.L,wing.L])for(const [y,z] of prof)v.push(x,y,z);
  for(let j=0;j<n;j++){const a=j,b=(j+1)%n;idx.push(a,n+b,b,a,n+a,n+b);}   // 側面：剖面順著上緣往後緣走，法向朝外
  const base=v.length/3;for(const x of [-wing.L,wing.L])for(const [y,z] of prof)v.push(x,y,z);
  for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(prof.map(([y,z])=>new THREE.Vector2(y,z)),[])){
   const cr=(prof[b][0]-prof[a][0])*(prof[c][1]-prof[a][1])-(prof[b][1]-prof[a][1])*(prof[c][0]-prof[a][0]),[q,r]=cr>0?[b,c]:[c,b];
   idx.push(base+n+a,base+n+q,base+n+r,base+a,base+r,base+q);   // 兩頭封板：+x 那頭朝 +x、−x 那頭朝 −x
  }
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();mesh(g,white).name='station-roof';
  // 前緣上面一條機捷紫、頂上兩排採光板（夜裡透光）。
  const strip=(u0,u1,m,x0=-wing.L+.2,x1=wing.L-.2)=>{const a=wingAt(u0,1),b=wingAt(u1,1);block(m,[x1-x0,Math.hypot(b[0]-a[0],b[1]-a[1]),.04],[(x0+x1)/2,(a[0]+b[0])/2,(a[1]+b[1])/2+.02],[Math.atan2(b[1]-a[1],b[0]-a[0]),0,0]);};
  strip(.03,.11,purple);
  for(const u of [.36,.6])for(let x=-10.5;x<=10.6;x+=3)strip(u,u+.07,M.glass,x-1.2,x+1.2);
 }
 // Y 形柱：立在月台後緣，柱頭分兩叉頂住屋頂。
 for(let x=-9.6;x<=9.7;x+=4.8){const y=p.y1-.35,h=roofBottom(y)-.78-p.z;
  instance(cylinder,silver,[x,y,p.z+h/2],[.26,.26,h]);
  for(const s of [-1,1])block(silver,[.13,.13,1.05],[x+s*.35,y,p.z+h+.38],[0,s*.75,0]);}
 // 月台吊燈（點光源四盞）＋屋頂底下沿中線一條燈帶。
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-4.3,z=p.z+2.3;block(M.lamp,[.8,.32,.07],[x,y,z]);block(M.steel,[.03,.03,roofBottom(y)-z],[x,y,(z+roofBottom(y))/2]);k.addLight('platform-'+i,x,y,z-.15,2.8,7);}
 block(M.lamp,[22,.22,.04],[0,-5.1,roofBottom(-5.1)-.04]);

 // 站前：廣場、機車格、機捷紫的站名柱、轉乘停車場，最外面是馬路。
 block(plaza,[23,6.8,.04],[0,-13.2,groundZ+.02]);
 block(white,[.5,.5,3.2],[-10.6,-11.2,groundZ+1.6]);block(M.sign,[.56,.56,.7],[-10.6,-11.2,groundZ+2.95]);block(purple,[.56,.56,.14],[-10.6,-11.2,groundZ+2.45]);
 const scooter=mat('#2f2f33'),seat=mat('#c7c2b6');
 for(let i=0;i<14;i++){const x=1.5+i*.5;block(scooter,[.3,.7,.34],[x,-12.0,groundZ+.21]);block(seat,[.26,.38,.1],[x,-12.05,groundZ+.42]);}
 const roadY=-18.5;props.road(0,roadY,groundZ,60,2.0);
 const cars=['#e9e6df','#3f4a63','#b4402f','#8f9498','#d9c35a','#f0efe9'].map(c=>mat(c,{roughness:.5,metalness:.15})),carGlass=mat('#2e3a44',{roughness:.3});
 const car=(x,y,yaw=0)=>{block(pick(cars),[1.75,.8,.48],[x,y,groundZ+.3],[0,0,yaw]);block(carGlass,[.9,.7,.34],[x,y,groundZ+.68],[0,0,yaw]);};
 for(const [x,lane] of [[-21,-1],[-6.5,1],[5.5,-1],[19,1],[27,-1]])car(x,roadY+lane*.5);
 for(let x=-27.5;x<=27.5;x+=11){block(M.steel,[.11,.11,3.0],[x,roadY+1.25,groundZ+1.5]);block(M.steel,[.08,1.0,.08],[x,roadY+.8,groundZ+2.96]);block(M.lamp,[.4,.34,.1],[x,roadY+.35,groundZ+2.9]);pool(x,roadY+.35,groundZ+.06,2.6,1.9);}
 // 轉乘停車場：柏油、白線、停了大半的車。
 const lot={x0:12.6,x1:23.4,y0:-16.6,y1:-10.8},line=mat('#e8e4d8');
 block(mat('#6b6d6b'),[lot.x1-lot.x0,lot.y1-lot.y0,.04],[(lot.x0+lot.x1)/2,(lot.y0+lot.y1)/2,groundZ+.02]);
 for(const [y0,dir] of [[lot.y0+.15,1],[lot.y1-.15,-1]])for(let x=lot.x0+.4,i=0;x<lot.x1-.6;x+=1.1,i++){
  block(line,[.05,2.0,.01],[x,y0+dir*1.0,groundZ+.045]);if(rand()<.75)car(x+.55,y0+dir*1.05,Math.PI/2);}
 for(const x of [lot.x0+2.5,lot.x1-2.5]){block(M.steel,[.1,.1,2.6],[x,(lot.y0+lot.y1)/2,groundZ+1.3]);block(M.lamp,[.36,.36,.1],[x,(lot.y0+lot.y1)/2,groundZ+2.6]);pool(x,(lot.y0+lot.y1)/2,groundZ+.06,2.4);}

 // 稻田：一格格不同綠，田埂格線；農舍、防風林。
 const paddy=['#9cb85f','#abc46b','#8eae57','#b7c977','#a2bb63'].map(c=>mat(c,{roughness:.92})),bund=mat('#bba981');
 function fields(x0,x1,y0,y1,w=3.4,d=2.5){
  const nx=Math.max(1,Math.round((x1-x0)/w)),ny=Math.max(1,Math.round((y1-y0)/d)),dx=(x1-x0)/nx,dy=(y1-y0)/ny;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)block(pick(paddy),[dx-.14,dy-.14,.05],[x0+(i+.5)*dx,y0+(j+.5)*dy,groundZ+.025]);
  for(let i=0;i<=nx;i++)block(bund,[.14,y1-y0+.14,.09],[x0+i*dx,(y0+y1)/2,groundZ+.045]);
  for(let j=0;j<=ny;j++)block(bund,[x1-x0+.14,.14,.09],[(x0+x1)/2,y0+j*dy,groundZ+.045]);
 }
 fields(-24.6,-12.6,-16.8,-10.8);
 fields(11.8,19,-3.6,6.6);fields(-19,-11.8,-3.6,6.6);
 fields(2,27.4,12.4,18.6);
 props.farmhouse(-28.2,-13.2,groundZ,{width:3.2,depth:2.4,tint:1});props.farmhouse(-27.6,-9.4,groundZ,{width:2.4,depth:2.0,tint:2,pitched:false,facing:Math.PI/2});
 props.farmhouse(27.4,-13.4,groundZ,{width:3.0,depth:2.3,tint:0});
 for(let y=-15.5;y<=16.5;y+=2.6){for(const x of [-31.2,31.2])if(inside(x,y,1.2))props.broadleaf(x+(rand()-.5)*.4,y,groundZ,2.2+rand()*.8,'round');}

 // 後方左邊：埤塘（土堤、岸邊草叢、一角荷葉、小抽水站、三隻白鷺鷥），四周種樹。
 const pond={x:-13.5,y:15.6,w:16,d:5.0},rim=mat('#a99878');
 k.river(pond.w,pond.d,[pond.x,pond.y],THEMES.day);
 for(const s of [-1,1]){block(rim,[pond.w+.5,.25,.16],[pond.x,pond.y+s*(pond.d/2+.12),groundZ+.08]);block(rim,[.25,pond.d+.5,.16],[pond.x+s*(pond.w/2+.12),pond.y,groundZ+.08]);}
 for(let i=0;i<20;i++){const sd=i%2?1:-1;props.bush(pond.x+(rand()-.5)*(pond.w-.6),pond.y+sd*(pond.d/2+.4),groundZ,.28+rand()*.22);}
 const lotus=mat('#5d8c4c',{roughness:.8});
 for(let i=0;i<10;i++)instance(k.disc,lotus,[pond.x-pond.w/2+.9+rand()*3.4,pond.y-pond.d/2+.7+rand()*3.6,groundZ+.06],[.26+rand()*.14,.26+rand()*.14,1]);
 block(mat('#d8d2c2'),[1.4,1.2,1.1],[pond.x+pond.w/2+1.2,pond.y-1.6,groundZ+.55]);block(mat('#7a8c96'),[1.6,1.4,.12],[pond.x+pond.w/2+1.2,pond.y-1.6,groundZ+1.16]);
 const egret=mat('#f6f5ef');
 for(const [x,y] of [[-19.6,pond.y-2.2],[-8.2,pond.y+2.7],[-15.1,pond.y-2.25]]){block(egret,[.26,.11,.13],[x,y,groundZ+.42]);block(egret,[.05,.05,.22],[x-.12,y,groundZ+.58]);block(dark,[.03,.03,.3],[x+.02,y,groundZ+.17]);}
 for(let n=0;n<16;){const x=-30+rand()*24,y=12.6+rand()*6.6;if(!inside(x,y,1.2)||(Math.abs(x-pond.x)<pond.w/2+.8&&Math.abs(y-pond.y)<pond.d/2+.8))continue;props.broadleaf(x,y,groundZ,1.7+rand()*1.0);n++;}

 // 後方右邊：一架降落中的客機，機頭朝 −x、微微抬頭，架在一根透明支柱上（夜裡亮著落地燈與翼尖航行燈）。
 const ap={x:17,y:15.4,z:groundZ+10.2},pitch=.07,c=Math.cos(pitch),s=Math.sin(pitch);
 const P=(a,b,h)=>[ap.x+a*c+h*s,ap.y+b,ap.z-a*s+h*c];   // 機身座標（a 往機尾、b 往右翼、h 往上）換到場景
 const body=mat('#f1f2f0',{roughness:.4,metalness:.15}),fin=mat('#2f6f8f',{roughness:.45}),engine=mat('#b9bec2',{roughness:.35,metalness:.5});
 const navRed=mat('#d23a32',{emissive:'#ff3b2f',emissiveIntensity:0}),navGreen=mat('#3aa25c',{emissive:'#39ff7a',emissiveIntensity:0});
 const ball=geo(new THREE.IcosahedronGeometry(1,1));
 instance(cylinder,body,P(0,0,0),[.76,.76,5.2],[0,Math.PI/2+pitch,0]);
 instance(ball,body,P(-2.6,0,-.02),[.62,.38,.37],[0,pitch,0]);instance(ball,body,P(2.6,0,.06),[.95,.32,.3],[0,pitch,0]);
 block(carGlass,[3.9,.78,.08],P(-.3,0,.13),[0,pitch,0]);
 for(const sd of [-1,1]){
  block(body,[1.0,2.9,.08],P(.55,sd*1.6,-.22),[0,pitch,-sd*.45]);
  instance(cylinder,engine,P(-.15,sd*1.25,-.5),[.34,.34,.8],[0,Math.PI/2+pitch,0]);
  block(body,[.55,1.3,.06],P(2.55,sd*.72,.08),[0,pitch,-sd*.5]);
  block(sd<0?navRed:navGreen,[.12,.12,.1],P(1.18,sd*2.92,-.2),[0,pitch,0]);
  block(M.lamp,[.12,.18,.1],P(.05,sd*.72,-.36),[0,pitch,0]);
 }
 block(fin,[1.1,.07,1.0],P(2.4,0,.78),[0,pitch+.45,0]);
 instance(cylinder,M.gateGlass,[ap.x,ap.y,(groundZ+ap.z-.38)/2],[.1,.1,ap.z-.38-groundZ]);
 block(dark,[.7,.7,.08],[ap.x,ap.y,groundZ+.04]);

 // 環內兩端與站前空隙的樹。
 const inCurve=(x,y,cx)=>Math.hypot(x-cx,y-path.cy)<5.4;
 for(let n=0;n<10;){const x=-25+rand()*6,y=-3+rand()*9;if(!inCurve(x,y,-19))continue;props.broadleaf(x,y,groundZ,1.8+rand()*1.0);n++;}
 for(let n=0;n<8;){const x=19+rand()*6,y=-3+rand()*9;if(!inCurve(x,y,19))continue;props.broadleaf(x,y,groundZ,1.6+rand()*1.0);n++;}
 for(const [x,y] of [[-12,-10.2],[12,-10.2],[-24.8,-10.2],[25.2,-10.0]])props.broadleaf(x,y,groundZ,2.0+rand()*.6);
 for(let n=0;n<14;n++){const x=-24+rand()*11,y=-17.2+rand()*.3;props.bush(x,y,groundZ,.3+rand()*.25);}

 return k.result({
  path,label:'山鼻站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[ap.x,ap.y,ap.z]},
  update(time,t){navRed.emissiveIntensity=t.lamp*1.4;navGreen.emissiveIntensity=t.lamp*1.4;}
 });
}

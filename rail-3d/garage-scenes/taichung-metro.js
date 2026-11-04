// 台中捷運綠線：文心森林公園站的微縮印象——白色弧形大屋頂的高架站（屋頂連月台帶軌道一起蓋住，月台後緣一排樹枝狀柱撐著），
// 站體是淺灰的百葉立面、綠色腰帶；站前是文心森林公園：白色殼頂的圓形劇場與扇形草坡看台、樹林、水池與涼亭；
// 環內是透天厝與小學操場，後方是住宅大樓。不是實際線形、方位或比例的重建。
// 屋頂外緣伸到軌道中心外 2.5、底面離軌頂至少 3.2（兩端略收）：露得出的車身高度至少 3.2−.73×(2.5−.63)=1.83，整個側面看得到。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e6eae6',sun:'#fff3d8',ambient:'#c8d8e2',ground:'#86996a',power:3.0,exposure:1.04,water:'#3d6e64',shallow:'#6f9a7e',lamp:0,window:0},
 sunset:{background:'#efd5bf',sun:'#ffab66',ambient:'#d4b6ab',ground:'#787a58',power:2.9,exposure:.94,water:'#5a7a72',shallow:'#a9a283',lamp:.5,window:.45},
 night:{background:'#121b29',sun:'#9fbde2',ambient:'#58718c',ground:'#28313c',power:.7,exposure:.78,water:'#143049',shallow:'#2d5668',lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20388,trees:[['ficus',.3],['koelreuteria',.3],['terminalia',.25],['delonix',.15]]});
 const {THREE,M,mat,geo,block,instance,mesh,rand,groundZ,props,hip,cylinder,pool,inside}=k;
 const path=k.line(),far=k.line({y:-1.86}),railZ=path.z,front=path.front;
 const inStation=q=>Math.abs(q.x)<11.6;
 k.keepClear((x,y)=>y>-9&&y<.7);   // 高架橋底不種樹
 const pick=list=>list[Math.floor(rand()*list.length)];
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};
 // 曲面板：上表面 z＝fz(x,y)、厚 t、四邊封起來（側面另給頂點，邊緣才是硬角）。站的大屋頂與劇場殼頂都用它。
 function slab(fz,x0,x1,y0,y1,nx,ny,t,m,name){
  const v=[],idx=[],W=nx+1,P=(i,j)=>[x0+(x1-x0)*i/nx,y0+(y1-y0)*j/ny],id=(s,i,j)=>s*W*(ny+1)+j*W+i;
  for(const s of [0,1])for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const [x,y]=P(i,j);v.push(x,y,fz(x,y)-s*t);}
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)idx.push(id(0,i,j),id(0,i+1,j),id(0,i+1,j+1),id(0,i,j),id(0,i+1,j+1),id(0,i,j+1),
   id(1,i,j),id(1,i+1,j+1),id(1,i+1,j),id(1,i,j),id(1,i,j+1),id(1,i+1,j+1));
  const ring=[];for(let i=0;i<nx;i++)ring.push([i,0]);for(let j=0;j<ny;j++)ring.push([nx,j]);for(let i=nx;i>0;i--)ring.push([i,ny]);for(let j=ny;j>0;j--)ring.push([0,j]);
  ring.forEach(([i,j],n)=>{const a=P(i,j),b=P(...ring[(n+1)%ring.length]),base=v.length/3;   // 逆時針繞一圈，側面朝外
   v.push(a[0],a[1],fz(...a),a[0],a[1],fz(...a)-t,b[0],b[1],fz(...b)-t,b[0],b[1],fz(...b));idx.push(base,base+1,base+2,base,base+2,base+3);});
  const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();
  mesh(g,m).name=name;
 }

 // 高架橋與道床：站內月台那側不砌牆、不立墩（站體撐著）；第三軌在月台對面。
 k.viaduct(path,{round:true,walls:[.45,.45],open:(q,side)=>side>0&&inStation(q),pier:q=>!inStation(q)});
 k.viaduct(far,{round:true,walls:[.45,.45],open:(q,side)=>side<0&&inStation(q),pier:q=>!inStation(q)});
 k.slabTrack(path);k.slabTrack(far);
 k.thirdRail(path,{side:-1});k.thirdRail(far,{side:1});

 const white=mat('#f3f3ef',{roughness:.45}),grey=mat('#d6d9d6',{roughness:.6}),green=mat('#3f9b5c',{roughness:.5}),under=mat('#cfd4d4',{roughness:.6});
 const steelW=mat('#e9ebe8',{roughness:.4,metalness:.3}),plaza=mat('#c9c3b5'),bench=mat('#8b6f52'),dark=mat('#3b4449'),concrete=mat('#bdb9b0',{roughness:.8});
 const lawn=mat('#7c9c5c',{roughness:.9}),line=mat('#efeee8');

 // 島式月台＋兩側半高閘門；站體在月台底下：淺灰牆、正面玻璃前一排白色直百葉、綠色腰帶、兩個綠頂入口。
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.2,edge:.72,top:.2,bottom:railZ-.73});
 k.gates(p);k.gates({...p,y0:p.y1,side:-1});
 for(let x=-7.5;x<=7.5;x+=5)for(const s of [-1,1]){block(bench,[1.3,.3,.12],[x,(p.y0+p.y1)/2+s*.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,(p.y0+p.y1)/2+s*.28,p.z+.52]);}
 const hallY0=-9.7,hallY1=-.1,hallTop=railZ-.73,hallH=hallTop-groundZ;
 block(grey,[22,hallY1-hallY0,hallH],[0,(hallY0+hallY1)/2,groundZ+hallH/2]);
 block(under,[22.3,front-1.75-hallY0+.15,.12],[0,(hallY0+front-1.75)/2-.07,hallTop+.06]);   // 高架橋外側那條站體頂
 block(M.glass,[20.6,.08,hallH-1.0],[0,hallY0-.03,groundZ+.1+(hallH-1.0)/2]);
 for(let x=-10.2;x<=10.25;x+=.6){if(Math.abs(Math.abs(x)-5.4)<2.0)continue;block(white,[.08,.26,hallH-.8],[x,hallY0-.16,groundZ+.05+(hallH-.8)/2]);}
 block(green,[22.1,.1,.3],[0,hallY0-.06,hallTop-.3]);
 for(const x of [-5.4,5.4]){
  block(dark,[3.2,.1,1.7],[x,hallY0-.05,groundZ+.85]);block(green,[4.0,1.8,.12],[x,hallY0-.9,groundZ+2.1]);
  for(const s of [-1,1])block(white,[.1,.1,2.05],[x+s*1.8,hallY0-1.6,groundZ+1.03]);
  block(M.sign,[2.4,.12,.4],[x,hallY0-.08,groundZ+2.55]);
 }
 k.addLight('entrance',0,hallY0-1.3,groundZ+2.0,1.3,6);

 // 弧形大屋頂：橫向中間拱起、兩端略收；外緣一條綠色封邊，頂上一排採光板（夜裡透光）。
 const rf={x0:-12.4,x1:12.4,y0:-9.0,y1:-.8,z:railZ+3.7,arch:1.0,t:.25};
 const roofZ=(x,y)=>rf.z+rf.arch*(1-((2*y-rf.y0-rf.y1)/(rf.y1-rf.y0))**2)-.25*(x/rf.x1)**4;
 slab(roofZ,rf.x0,rf.x1,rf.y0,rf.y1,24,10,rf.t,white,'station-roof');
 for(let i=0;i<24;i++){const xa=rf.x0+(rf.x1-rf.x0)*i/24,xb=xa+(rf.x1-rf.x0)/24;beam(green,[xa,rf.y0-.03,roofZ(xa,rf.y0)-.12],[xb,rf.y0-.03,roofZ(xb,rf.y0)-.12],.06,.22);}
 for(let x=-10.5;x<=10.6;x+=3)block(M.glass,[2.2,.9,.06],[x,(rf.y0+rf.y1)/2,roofZ(x,(rf.y0+rf.y1)/2)+.02]);
 // 樹枝狀柱：月台中線一排，柱身到 2.1 高分出五枝頂住屋頂；兩側橋面緣幾根細柱。
 for(let x=-9.6;x<=9.7;x+=4.8){const y=(p.y0+p.y1)/2,zb=p.z+2.1;instance(cylinder,steelW,[x,y,(p.z+zb)/2],[.32,.32,zb-p.z]);
  for(const [dx,dy] of [[-1.1,-1.2],[1.1,-1.2],[-1.1,1.2],[1.1,1.2],[0,-2.0],[0,2.0]])beam(steelW,[x,y,zb],[x+dx,y+dy,roofZ(x+dx,y+dy)-rf.t],.11);
  for(const yo of [front-1.62,far.front+1.62]){const z0=railZ-.23,z1=roofZ(x,yo)-rf.t;block(steelW,[.12,.12,z1-z0],[x,yo,(z0+z1)/2]);}}
 for(let i=0;i<4;i++){const x=-7.5+i*5,y=-4.3,z=p.z+2.4,top=roofZ(x,y)-rf.t;block(M.lamp,[.5,.5,.4],[x,y,z]);block(M.steel,[.03,.03,top-z],[x,y,(z+top)/2]);k.addLight('platform-'+i,x,y,z-.15,2.8,7);}

 // 站前廣場，兩條步道通往公園。
 block(plaza,[23,4.2,.04],[0,-11.8,groundZ+.02]);
 beam(plaza,[-11.4,-12.6,groundZ+.025],[-17.6,-15.3,groundZ+.025],1.2,.04);beam(plaza,[11.4,-12.6,groundZ+.025],[13.2,-14.0,groundZ+.025],1.2,.04);
 for(const x of [-9.8,9.8]){block(M.steel,[.08,.08,2.4],[x,-13.4,groundZ+1.2]);block(M.lamp,[.3,.3,.2],[x,-13.4,groundZ+2.4]);pool(x,-13.1,groundZ+.06,2.0,1.6);}

 // 圓形劇場：舞台、後牆、白色殼頂（往觀眾那側翹高），前面扇形的草坡看台（一階比一階高、階緣一條水泥）。
 const am={x:-26.2,y:-15.3};
 block(concrete,[4.4,5.2,.5],[am.x,am.y,groundZ+.25]);
 block(white,[.4,7.6,2.4],[-29.2,am.y,groundZ+1.2]);
 const shellZ=(x,y)=>groundZ+2.4+2.4*Math.pow(Math.max(0,(x+29.0)/7.6),1.4)+.8*(1-((y-am.y)/3.9)**2);
 slab(shellZ,-29.0,-21.4,am.y-3.9,am.y+3.9,16,10,.2,white,'amphitheater-roof');
 for(const y of [am.y-3.5,am.y+3.5]){const top=shellZ(-21.8,y)-.2;block(white,[.22,.22,top-groundZ],[-21.8,y,(groundZ+top)/2]);}
 for(let r=0;r<4;r++){const R=5.0+r*.9,h=.16+r*.16,chord=2*R*Math.sin(4*Math.PI/180)+.04;
  for(let a=-32;a<=32.1;a+=8){const t=a*Math.PI/180;
   block(lawn,[.82,chord,h],[am.x+R*Math.cos(t),am.y+R*Math.sin(t),groundZ+h/2],[0,0,t]);
   block(concrete,[.12,chord,.05],[am.x+(R-.4)*Math.cos(t),am.y+(R-.4)*Math.sin(t),groundZ+h+.02],[0,0,t]);}}
 k.addLight('stage',am.x+1.6,am.y,groundZ+2.4,1.4,7);

 // 水池：偏綠的池水、土堤、荷葉、石頭，池邊一圈矮樹叢蓋住直邊（不然像游泳池），旁邊一座涼亭。
 const pd={x:20,y:-16.2,w:15,d:5.0};
 k.river(pd.w,pd.d,[pd.x,pd.y],THEMES.day);
 const rim=mat('#8f8062',{roughness:.9}),lotus=mat('#5c8a4a',{roughness:.7});
 for(const s of [-1,1]){block(rim,[pd.w+.6,.35,.08],[pd.x,pd.y+s*(pd.d/2+.12),groundZ+.04]);block(rim,[.35,pd.d+.6,.08],[pd.x+s*(pd.w/2+.12),pd.y,groundZ+.04]);}
 for(let i=0;i<24;i++)props.bush(pd.x+(rand()-.5)*(pd.w-.6),pd.y+(rand()<.5?-1:1)*(pd.d/2+.3),groundZ,.35+rand()*.3);
 for(const s of [-1,1])for(let i=0;i<3;i++)props.bush(pd.x+s*(pd.w/2+.3),pd.y+(i-1)*1.5,groundZ,.4+rand()*.25);
 for(let i=0;i<10;i++){const r=.25+rand()*.2;k.instance(k.disc,lotus,[pd.x-pd.w/2+1.2+rand()*(pd.w-2.4),pd.y-pd.d/2+.8+rand()*(pd.d-1.6),groundZ+.06],[r,r,1]);}
 for(let i=0;i<5;i++)props.rock(pd.x-pd.w/2+1+rand()*(pd.w-2),pd.y+(rand()<.5?-1:1)*(pd.d/2+.3),groundZ,.3+rand()*.2);
 const pav={x:24.6,y:-11.6};
 block(concrete,[2.4,2.4,.15],[pav.x,pav.y,groundZ+.075]);
 for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]])block(mat('#8a3b2e'),[.14,.14,1.6],[pav.x+a*.95,pav.y+b*.95,groundZ+.95]);
 instance(hip,mat('#4f6a5c',{roughness:.7}),[pav.x,pav.y,groundZ+1.7],[2.9,2.9,.9]);

 // 公園的樹林：避開水池、劇場與廣場前那塊。
 const inPond=(x,y,m)=>Math.abs(x-pd.x)<pd.w/2+m&&Math.abs(y-pd.y)<pd.d/2+m;
 for(let n=0;n<34;){const x=-30+rand()*60,y=-19.2+rand()*9.0;
  if(!inside(x,y,1.2)||inPond(x,y,1.0)||(x<-17.8&&y<-10.8)||(Math.abs(x)<12.2&&y>-14.6)||Math.hypot(x-pav.x,y-pav.y)<2.4)continue;
  props.broadleaf(x,y,groundZ,1.8+rand()*1.0);n++;}

 // 站後：左邊兩排透天厝（面向站）、右邊小學操場（紅跑道、綠球場、白線）與三層校舍；後面一條馬路。
 for(const y of [3.4,7.6])for(let x=-30;x<=-12;x+=2.7)props.townhouse(x,y,groundZ,{floors:3+Math.floor(rand()*3),tint:Math.floor(rand()*4),roof:pick(['tin','flat']),ground:y<5?'shop':'plain',depth:3.0});
 block(mat('#b9573f',{roughness:.9}),[8.6,5.0,.04],[16.4,4.6,groundZ+.02]);
 block(mat('#5f9a4f',{roughness:.9}),[6.6,3.0,.05],[16.4,4.6,groundZ+.025]);
 block(line,[.06,3.0,.07],[16.4,4.6,groundZ+.03]);
 block(mat('#ece6d8'),[7.4,1.6,2.6],[14.6,8.6,groundZ+1.3]);
 for(let f=0;f<3;f++)for(let x=-3.2;x<=3.2;x+=.8)block(M.glass,[.56,1.65,.34],[14.6+x,8.6,groundZ+.55+f*.8]);
 block(mat('#c8c2b2'),[7.6,1.8,.1],[14.6,8.6,groundZ+2.65]);
 for(const [x,y] of [[11.4,2.4],[21.8,1.4],[22.6,5],[24.8,8.6],[27.6,3.4],[30,6.6],[-8,3],[-5,6.8],[-1,3],[3,7],[6,2.4]])props.broadleaf(x,y,groundZ,1.8+rand()*.6);
 const backRoad=11.2;props.road(0,backRoad,groundZ,62,1.8);
 for(const [x,lane,taxi] of [[-24,-1],[-13,1],[-3,-1,1],[8,1],[19,-1],[27,1]])k.car(x,backRoad+lane*.45,{yaw:lane<0?0:Math.PI,taxi:!!taxi});
 k.bus(-18,backRoad-.45,{paint:mat('#e8ecec',{roughness:.42}),stripe:green});

 // 後方：住宅大樓（白、灰藍、米色），每層一條窗帶，頂上一圈女兒牆；大樓之間種樹。
 const facade=['#e9e5dc','#d6dce0','#e2d8c8','#c9d2d8'].map(c=>mat(c,{roughness:.6}));
 [[-25,15.6,4.2,3.6,8.4],[-16.5,16.2,5.0,3.8,11.6],[-7.5,15.4,4.4,3.4,7.6],[2.5,16.0,5.2,4.0,12.6],[12.5,15.6,4.6,3.6,9.4],[22.5,16.2,5.0,3.6,8.0]].forEach(([x,y,w,d,h],i)=>k.tower(x,y,{w,d,h,body:pick(facade),kind:i%3===1?'office':'home'}));
 for(let x=-29;x<=29.1;x+=2.6)if(rand()<.7)props.broadleaf(x,18.9,groundZ,1.6+rand()*.8);

 return k.result({
  path,label:'文心森林公園站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[0,hallY0,groundZ+1.6],deck:[0,front,railZ],backdrop:[-25,am.y,groundZ+4]},
  extra:{opposingPath:k.reversed(far)}
 });
}

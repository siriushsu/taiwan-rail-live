// 高雄捷運：美麗島站的微縮印象——地下站做成剖面。底座四周留一圈街面（大馬路、機車格、騎樓街屋、大樓、四座「祈禱」玻璃出入口），
// 中間挖到軌道層：車在月台前繞圈，月台在環內側、全高月台門；月台後面接大廳，大廳正中是四柱撐起的彩色玻璃淺穹頂（光之穹頂）。
// 不是實際線形、方位或比例的重建；穹頂的圖案是自己排的色塊，不是原作的畫面。左側坑壁的圓形隧道口加橘環，代表交會的橘線；
// 右後方的 85 大樓不在站旁，當港都天際線。
// 街面高出軌頂 2.77：前緣離前直線 4.7、右緣離右彎外側 2.6；穹頂頂點高出軌頂 2.78、後緣離後直線 2.7。
// 照 .73 規則（從正面看，前方的東西每往鏡頭靠近 1、視線升高 .73），預設視角與跟車都不擋車身。
import {createKit} from './metro-kit.js';

export const THEMES = {
 day:{background:'#e8e7df',sun:'#fff2d4',ambient:'#cdd9e0',ground:'#8f8f80',power:3.0,exposure:1.04,lamp:0,window:0},
 sunset:{background:'#f2d2b4',sun:'#ffa45c',ambient:'#d8b6a8',ground:'#7d7663',power:2.9,exposure:.94,lamp:.5,window:.45},
 night:{background:'#10192a',sun:'#9cbbe2',ambient:'#566f8d',ground:'#262f3b',power:.7,exposure:.78,lamp:1,window:1}
};

export function createScene(){
 const k=createKit({seed:20411,grass:'#8e8a83'});
 const {THREE,M,mat,geo,mesh,block,instance,rand,groundZ,props,cylinder,disc,pool}=k;
 // 兩股紅線從左牆的隧道口開進來、穿過坑底、鑽進右牆：前股在月台前，後股在大廳後面。
 const line={z:groundZ+.23,half:29.6,cycle:96},path=k.line(line),far=k.line({...line,y:8.52}),railZ=path.z,front=path.front;
 const pick=list=>list[Math.floor(rand()*list.length)];
 // 兩點之間一根方料（沿 x 的 box 轉過去）。
 const beam=(m,A,B,w,h=w)=>{const d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],r=Math.hypot(d[0],d[1]);
  block(m,[Math.hypot(r,d[2]),w,h],[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],[0,-Math.atan2(d[2],r),Math.atan2(d[1],d[0])]);};

 // 坑底：直結軌道＋第三軌（月台對側），軌道板底貼著坑底。
 k.slabTrack(path);k.slabTrack(far);
 k.thirdRail(path,{side:-1});k.thirdRail(far,{side:1});

 const white=mat('#f3f1ea',{roughness:.5}),redLine=mat('#d2283a',{roughness:.5}),orangeLine=mat('#f0962a',{roughness:.5});
 const stone=mat('#d4c4a8'),tile=mat('#c6b493'),inlay=mat('#ece4d3'),frame=mat('#39383a',{metalness:.4,roughness:.45}),joint=mat('#a6a298');
 const bench=mat('#8b6f52'),tvm=mat('#2f6aa0');
 const pave=mat('#d6d0c3'),soil=mat('#9a7a58'),clay=mat('#7f6550'),diaphragm=mat('#c2beb4');
 const asphalt=mat('#5d6368'),lineW=mat('#ebe7dc'),lineY=mat('#e2b64a');

 // ── 剖面：街面是底座外框一圈，中間挖到底。坑壁是連續壁（混凝土），底座外側的切面看得到土層 ──
 const Zs=groundZ+3.0,pit={x0:-29.6,x1:29.6,y0:-11.2,y1:12.2},wt=.22;
 const rect=(x0,y0,x1,y1,P=THREE.Path)=>{const s=new P();s.moveTo(x0,y0);s.lineTo(x1,y0);s.lineTo(x1,y1);s.lineTo(x0,y1);s.lineTo(x0,y0);return s;};
 const ring=(x0,y0,x1,y1)=>{const s=k.rounded(k.plinthW,k.plinthD,k.plinthR);s.holes.push(rect(x0,y0,x1,y1));return s;};
 const slab=(shape,z0,z1,m,name)=>{const o=mesh(geo(new THREE.ExtrudeGeometry(shape,{depth:z1-z0,bevelEnabled:false,curveSegments:12})),m,[0,0,z0]);o.name=name;return o;};
 const outer=[pit.x0-wt,pit.y0-wt,pit.x1+wt,pit.y1+wt];
 slab(ring(...outer),groundZ,groundZ+1.1,clay,'strata-clay');
 slab(ring(...outer),groundZ+1.1,Zs-.14,soil,'strata-soil');
 const dw=rect(...outer,THREE.Shape);dw.holes.push(rect(pit.x0,pit.y0,pit.x1,pit.y1));slab(dw,groundZ,Zs-.14,diaphragm,'diaphragm-wall');
 slab(ring(pit.x0,pit.y0,pit.x1,pit.y1),Zs-.14,Zs,pave,'street');

 // 坑壁：後牆與左牆朝鏡頭，畫連續壁的接縫、紅線色帶、燈箱；左牆一個圓形隧道口＋橘環（交會的橘線），兩側接橘色帶。
 const wallH=Zs-.14-groundZ,tunnel={y:1.5,z:groundZ+1.25,r:1.0};
 for(let x=pit.x0+2.4;x<pit.x1-.5;x+=2.6)block(joint,[.05,.03,wallH],[x,pit.y1-.015,groundZ+wallH/2]);
 for(let y=pit.y0+2.4;y<pit.y1-.5;y+=2.6)if(Math.abs(y-tunnel.y)>1.4)block(joint,[.03,.05,wallH],[pit.x0+.015,y,groundZ+wallH/2]);
 block(redLine,[pit.x1-pit.x0,.04,.16],[(pit.x0+pit.x1)/2,pit.y1-.02,groundZ+2.0]);
 for(const [y0,y1] of [[pit.y0,tunnel.y-1.35],[tunnel.y+1.35,pit.y1]])block(orangeLine,[.04,y1-y0,.16],[pit.x0+.02,(y0+y1)/2,groundZ+2.0]);
 for(const x of [-20.7,-10.3,.1,10.5,20.9])block(M.sign,[1.7,.04,.75],[x,pit.y1-.03,groundZ+1.0]);
 const torus=geo(new THREE.TorusGeometry(1,.12,8,32));
 instance(disc,mat('#1d1f24'),[pit.x0+.02,tunnel.y,tunnel.z],[tunnel.r,tunnel.r,1],[0,Math.PI/2,0]);
 instance(torus,orangeLine,[pit.x0+.03,tunnel.y,tunnel.z],[tunnel.r+.06,tunnel.r+.06,1],[0,Math.PI/2,0]);
 // 紅線的隧道口：車高 1.6、車寬 1.25，圓心比軌頂高 .75。
 for(const y of [front,far.front])for(const [x,d] of [[pit.x0,1],[pit.x1,-1]]){instance(disc,mat('#1d1f24'),[x+d*.02,y,railZ+.75],[1.5,1.5,1],[0,d*Math.PI/2,0]);instance(torus,redLine,[x+d*.03,y,railZ+.75],[1.56,1.56,1],[0,Math.PI/2,0]);}

 // ── 月台（前股內側、高月台 .2）＋全高月台門；門楣上一片天花（站體樓板的切面，前緣是紅線色帶）──
 const p=k.platform({y:front,z:railZ,side:1,length:20,width:3.35,edge:.72,top:.2,bottom:groundZ});
 k.screenDoors(p);
 const ceilY0=p.y0+.05-.15,ceilZ=p.z+2.0;   // 門楣箱的前緣與頂
 block(white,[p.length,p.y1-ceilY0,.14],[0,(ceilY0+p.y1)/2,ceilZ+.07]);
 block(redLine,[p.length,.03,.14],[0,ceilY0-.015,ceilZ+.07]);
 for(const x of [-7.5,-2.5,2.5,7.5]){block(bench,[1.3,.36,.12],[x,p.y1-.45,p.z+.36]);block(M.steel,[1.3,.05,.3],[x,p.y1-.26,p.z+.52]);}
 for(const x of [-5,5]){block(white,[1.8,.05,.42],[x,p.y1-.12,p.z+1.3]);block(redLine,[1.8,.055,.07],[x,p.y1-.12,p.z+1.47]);
  for(const s of [-1,1])block(M.steel,[.06,.06,1.1],[x+s*.8,p.y1-.12,p.z+.55]);}

 // ── 大廳（兩股之間，跟月台同高）：中間穹頂，兩側閘門與售票機，後側小店，兩端花台 ──
 const hall={y0:p.y1,y1:7.8},hc=(hall.y0+hall.y1)/2,hr=(hall.y1-hall.y0)/2;
 const st=new THREE.Shape();st.moveTo(-19,hall.y0);st.lineTo(19,hall.y0);st.absarc(19,hc,hr,-Math.PI/2,Math.PI/2,false);
 st.lineTo(-19,hall.y1);st.absarc(-19,hc,hr,Math.PI/2,Math.PI*1.5,false);
 slab(st,groundZ,p.z,stone,'concourse');
 const floorZ=p.z,C=[0,2.4],a=4.4;
 // 大廳後緣接後股：全高月台門、門上一片天花。
 k.screenDoors({x:0,y:far.front,y0:hall.y1+.01,z:p.z,side:-1,length:20});
 block(white,[20,1.1,.14],[0,hall.y1-.5,p.z+2.07]);block(redLine,[20,.03,.14],[0,hall.y1+.05,p.z+2.07]);
 // 地磚：兩色磨石子棋盤格，穹頂底下另鋪一圈淺色。
 const inHall=(x,y)=>Math.abs(x)<=19?y>=hall.y0+.1&&y<=hall.y1-.1:Math.hypot(Math.abs(x)-19,y-hc)<=hr-.2;
 for(let i=0,x=-23.4;x<=23.4;x+=1.2,i++)for(let j=0,y=hall.y0+.6;y<=hall.y1-.5;y+=1.2,j++)
  if((i+j)%2&&inHall(x-.6,y-.6)&&inHall(x+.6,y+.6)&&inHall(x-.6,y+.6)&&inHall(x+.6,y-.6)&&Math.hypot(x-C[0],y-C[1])>a+.4)block(tile,[1.18,1.18,.01],[x,y,floorZ+.005]);
 // 穹頂兩側各一排閘門（往左右進出），外側售票機；後側兩間小店；花台。
 for(const s of [-1,1]){
  for(let i=0;i<6;i++){const y=-1.3+i*.75;block(white,[.9,.18,.5],[s*6.3,y,floorZ+.25]);if(i<5)block(redLine,[.04,.4,.1],[s*6.3,y+.37,floorZ+.38]);}
  for(const y of [-1.5,-.7])block(tvm,[.4,.7,1.0],[s*8.6,y,floorZ+.5]);
  block(white,[3.2,1.0,1.1],[s*12.4,6.6,floorZ+.55]);block(props.signs[s>0?1:2],[3.2,.06,.3],[s*12.4,6.08,floorZ+.95]);
  block(M.glass,[2.6,.05,.6],[s*12.4,6.08,floorZ+.45]);
  block(white,[1.6,1.6,.4],[s*16.6,hc,floorZ+.2]);props.bush(s*16.6,hc,floorZ+.3,.6);
  for(const y of [1.2,3.6])block(bench,[.4,1.3,.36],[s*10.2,y,floorZ+.18]);}

 // 光之穹頂：四柱撐一圈環梁，上面淺穹頂（6 圈 × 24 格彩色玻璃，格縫露出深色骨架）。
 // 四象限各一個主色（藍、綠、金、紅），象限交界一格紫；中心兩圈是金色放射與紅橘。
 const rimZ=floorZ+1.3,h=1.28,R=(a*a+h*h)/(2*h),cz=rimZ+h-R,phiMax=Math.asin(a/R);
 instance(disc,inlay,[C[0],C[1],floorZ+.01],[a*.92,a*.92,1]);
 for(let i=0;i<4;i++){const t=Math.PI/4+i*Math.PI/2,cx=C[0]+Math.cos(t)*a*.72,cy=C[1]+Math.sin(t)*a*.72;
  instance(cylinder,frame,[cx,cy,(floorZ+rimZ)/2],[.3,.3,rimZ-floorZ]);
  beam(frame,[cx,cy,rimZ-.05],[C[0]+Math.cos(t)*a,C[1]+Math.sin(t)*a,rimZ-.05],.14);}
 mesh(geo(new THREE.TorusGeometry(a,.11,6,72)),frame,[C[0],C[1],rimZ]).name='dome-ring';
 const shell=geo(new THREE.SphereGeometry(R*.997,48,8,0,Math.PI*2,0,phiMax));shell.rotateX(Math.PI/2);
 mesh(shell,frame,[C[0],C[1],cz]).name='dome-frame';
 const glassCols=['#f2c14e','#d98a2b','#c8382e','#e0663a','#2c5aa0','#6fb0d8','#2f8a5b','#9bc46a','#5b3f8f'];
 const tileMats=glassCols.map(c=>mat(c,{roughness:.22,metalness:.05,emissive:c,emissiveIntensity:0}));
 const RINGS=6,SECT=24,tiles=glassCols.map(()=>({v:[],n:[]}));
 const colorOf=(i,j)=>{if(i===0)return j%2;if(i===1)return j%3?2:3;if(j%6===5)return 8;return [4,6,0,2][Math.floor(j/6)]+(i+j)%2;};
 const P=(f,t)=>[C[0]+R*Math.sin(f)*Math.cos(t),C[1]+R*Math.sin(f)*Math.sin(t),cz+R*Math.cos(f)];
 for(let i=0;i<RINGS;i++)for(let j=0;j<SECT;j++){
  const f0=phiMax*i/RINGS,f1=phiMax*(i+1)/RINGS,t0=2*Math.PI*j/SECT,t1=2*Math.PI*(j+1)/SECT,gf=(f1-f0)*.09,gt=(t1-t0)*.09;
  const q=[P(i?f0+gf:0,t0+gt),P(f1-gf,t0+gt),P(f1-gf,t1-gt),P(i?f0+gf:0,t1-gt)],out=tiles[colorOf(i,j)];
  for(const n of i?[0,1,2,0,2,3]:[0,1,2]){out.v.push(...q[n]);out.n.push((q[n][0]-C[0])/R,(q[n][1]-C[1])/R,(q[n][2]-cz)/R);}
 }
 tiles.forEach((t,c)=>{if(!t.v.length)return;const g=geo(new THREE.BufferGeometry());
  g.setAttribute('position',new THREE.Float32BufferAttribute(t.v,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(t.n,3));
  mesh(g,tileMats[c]).name='dome-glass';});

 // ── 街面 ──
 // 坑邊欄杆。
 const railing=(x0,y0,x1,y1)=>{const L=Math.hypot(x1-x0,y1-y0),n=Math.round(L/1.6),yaw=Math.atan2(y1-y0,x1-x0);
  for(let i=0;i<=n;i++)block(M.steel,[.06,.06,.42],[x0+(x1-x0)*i/n,y0+(y1-y0)*i/n,Zs+.21]);
  for(const z of [.42,.22])block(M.steel,[L,.05,.04],[(x0+x1)/2,(y0+y1)/2,Zs+z],[0,0,yaw]);};
 railing(pit.x0,pit.y0-.08,pit.x1,pit.y0-.08);railing(pit.x0,pit.y1+.08,pit.x1,pit.y1+.08);
 railing(pit.x0-.08,pit.y0,pit.x0-.08,pit.y1);railing(pit.x1+.08,pit.y0,pit.x1+.08,pit.y1);

 // 大馬路：前面一條四線道（中間雙黃線），後面一條雙線道。
 const roads=[{y:-17.3,w:2.8,L:64,two:true},{y:15.2,w:2.0,L:60,two:false}];
 for(const r of roads){block(asphalt,[r.L,r.w,.03],[0,r.y,Zs+.015]);
  for(const s of [-1,1])block(lineW,[r.L,.05,.01],[0,r.y+s*(r.w/2-.12),Zs+.035]);
  if(r.two)for(const s of [-1,1])block(lineY,[r.L,.04,.01],[0,r.y+s*.05,Zs+.035]);
  for(let x=-r.L/2+1;x<r.L/2-1;x+=2.2)for(const s of r.two?[-1,1]:[0])block(lineW,[1.0,.05,.01],[x,r.y+s*r.w/4,Zs+.035]);}
 // 車：計程車黃、白、紅，前路一台公車（車與機車共用三個車身色，少幾個 draw）。
 [[-24,-18,1],[-9,-16.6,-1],[13,-18,1],[-17,-16.6,-1],[4,-18,1],[25,-16.6,-1],[-20,14.7,1],[8,14.7,1],[-2,15.7,-1],[19,15.7,-1]]
  .forEach(([x,y,d],i)=>k.car(x,y,{yaw:d>0?0:Math.PI,z:Zs,taxi:i%3===0}));
 k.bus(-1,-16.6,{yaw:Math.PI,z:Zs,paint:white,stripe:tvm});

 // 機車格：前面人行道兩排機車（港都日常）。
 for(const [x0,x1] of [[-26,-8.6],[8.6,26]])for(let x=x0;x<=x1;x+=.6)k.scooter(x,-12.1,{yaw:Math.PI/2,z:Zs});

 // 「祈禱」出入口：兩片斜玻璃合起來像合十的手，一頭低、一頭翹高；鋼骨收邊。前面兩座翹的那頭朝坑，後面兩座左右對稱。
 const wedge=(()=>{let g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,-.5,.5,0,-.5,0,.32,.5,-.5,0,.5,.5,0,.5,0,1],3));
  g.setIndex([0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5]);g=g.toNonIndexed();g.computeVertexNormals();return geo(g);})();
 const entGlass=mat('#a6d4dc',{roughness:.1,metalness:.1,transparent:true,opacity:.5,emissive:'#ffe3b0',emissiveIntensity:0});
 const entrance=(x,y,yaw,L=2.4,W=1.7,H=1.8)=>{const c=Math.cos(yaw),s=Math.sin(yaw),lw=(u,v,w)=>[x+c*u-s*v,y+s*u+c*v,Zs+.06+w];
  block(frame,[L+.2,W+.2,.06],[x,y,Zs+.03],[0,0,yaw]);block(frame,[L*.7,W*.55,.02],[x,y,Zs+.07],[0,0,yaw]);
  instance(wedge,entGlass,[x,y,Zs+.06],[L,W,H],[0,0,yaw]);
  beam(frame,lw(-L/2,0,H*.32),lw(L/2,0,H),.07);
  for(const v of [-W/2,W/2]){beam(frame,lw(-L/2,v,0),lw(-L/2,0,H*.32),.05);beam(frame,lw(L/2,v,0),lw(L/2,0,H),.05);
   for(const u of [.25,.5,.75])beam(frame,lw(-L/2+L*u,v,0),lw(-L/2+L*u,0,H*(.32+.68*u)),.035);}};
 for(const sx of [-1,1]){entrance(sx*5.4,-14.6,Math.PI/2);entrance(sx*9.0,13.25,sx>0?0:Math.PI,2.4,1.5);}

 // 路燈（燈下光池）、椰子樹。
 const lampPost=(x,y)=>{block(M.mast,[.08,.08,1.7],[x,y,Zs+.85]);block(M.lamp,[.36,.16,.1],[x,y,Zs+1.72]);pool(x,y,Zs+.03,1.5);};
 for(const x of [-27,-19,-11,11,19,27])lampPost(x,-15.6);
 for(const x of [-24,-15,15,24])lampPost(x,13.95);
 const trunk=mat('#8a7458',{roughness:.8}),frond=mat('#4f7f45',{roughness:.7});
 const palm=(x,y,h)=>{instance(cylinder,trunk,[x,y,Zs+h/2],[.2,.2,h]);
  for(let i=0;i<7;i++){const t=i/7*Math.PI*2+rand(),c=Math.cos(t),s=Math.sin(t);beam(frond,[x,y,Zs+h],[x+c*1.2,y+s*1.2,Zs+h-.55],.34,.05);}};
 for(const x of [-27,-19.5,-4.5,4.5,19.5,27])palm(x,13.6,2.3+rand()*.5);
 for(const x of [-25,-15,-5,5,15,25])palm(x,-19.1,2.3+rand()*.5);

 // 左右兩側窄街面：左邊行道樹，右邊矮樹與灌木（右邊在鏡頭這側，樹都不高）。
 for(const y of [-9,-4.5,0,4.5,9])props.broadleaf(-31.4,y,Zs,1.7+rand()*.6);
 for(let y=-9.5;y<=9.6;y+=3.8){props.broadleaf(31.7,y,Zs,1.3+rand()*.3);props.bush(31.6,y+1.9,Zs,.5);}

 // 後面：騎樓街屋夾幾棟大樓；右後角 85 大樓（兩腳在中段併成一棟、再往上收成主塔）。
 const towerM=mat('#d6d6cf');
 [{x:-22,w:4.6,h:8.5},{x:-9.6,w:3.8,h:11.5,kind:'office'},{x:6.6,w:5.0,h:9.4}].forEach(({x,w,h,kind})=>k.tower(x,18.1,{w,d:3.0,h,body:towerM,kind,z:Zs}));
 for(const [x0,x1] of [[-29.6,-24.6],[-19.2,-12.2],[-7.2,3.6],[9.6,22.9]]){const n=Math.max(1,Math.round((x1-x0)/1.75)),w=(x1-x0)/n;
  for(let i=0;i<n;i++)props.townhouse(x0+(i+.5)*w,17.9,Zs,{floors:3+Math.floor(rand()*3),width:w-.06,depth:2.6,tint:Math.floor(rand()*4),ground:'arcade',roof:pick(['flat','tin']),back:true});}
 const sky={x:26.4,y:18.0},skyM=mat('#9fb3bf',{roughness:.3,metalness:.25});
 for(const s of [-1,1]){block(skyM,[1.5,2.2,8.0],[sky.x+s*1.55,sky.y,Zs+4.0]);for(let z=1.2;z<7.9;z+=1.2)block(M.glass,[1.54,2.24,.3],[sky.x+s*1.55,sky.y,Zs+z]);}
 block(skyM,[4.6,2.2,1.6],[sky.x,sky.y,Zs+8.8]);block(skyM,[2.1,2.0,5.0],[sky.x,sky.y,Zs+12.1]);block(skyM,[1.5,1.5,1.0],[sky.x,sky.y,Zs+15.1]);
 instance(cylinder,M.mast,[sky.x,sky.y,Zs+16.6],[.12,.12,2.0]);

 // 燈：月台三盞、穹頂下一盞、前面兩座出入口、後街一盞（共七盞）。
 for(const x of [-6.5,0,6.5])k.addLight('platform',x,-4.0,p.z+1.75,.85,6);
 k.addLight('dome',C[0],C[1],floorZ+.9,1.4,8);
 for(const s of [-1,1])k.addLight('entrance',s*5.4,-14.6,Zs+1.1,.8,5);
 k.addLight('street',0,13.6,Zs+1.5,.7,7);

 return k.result({
  path,label:'美麗島站',themes:THEMES,camera:{yaw:-1.12,elevation:.58,radius:50},
  anchors:{platform:[0,(p.y0+p.y1)/2,p.z],station:[C[0],C[1],rimZ+h],deck:[0,front,railZ],backdrop:[sky.x,sky.y,Zs+8]},
  extra:{opposingPath:k.reversed(far)},
  update(time,t){for(const m of tileMats)m.emissiveIntensity=.1+t.lamp*.85;entGlass.emissiveIntensity=t.window*.5;}
 });
}

// 靜態場景：照彰化扇形車庫的外型語彙（芥末黃混凝土、拱腋開口、高窗帶、屋頂煙囪、駝峰鋼板轉車台、紅色門架），背景是台灣市區街廓，樹用產品的台灣樹種。
// 網頁的機務段頁（rail-3d/roundhouse-stage.js）拿來畫；只蓋不動的東西，車、鏡頭、燈光在 stage。座標 y 朝上，1 單位約 1 公尺。
// label：出勤中、空股兩塊立牌的語系文字，其他招牌是現場看得到的中文，不翻。
import * as T from '../vendor/three.module.js';
export function createRoundhouseWorld({renderer,scene,G,std,phone,MATS,label=s=>s}){
const {RP,RD,RB,STEP,HS,RC,RAIL,NS,phiOf,P}=G;
const {PI,sin,cos,atan2,hypot,tan,min,max,abs,round,pow,floor,sqrt,ceil}=Math;
const lerp=(a,b,t)=>a+(b-a)*t;
const rnd=(s=>()=>(s=Math.imul(s,1664525)+1013904223>>>0)/4294967296)(2026),rr=(a,b)=>a+(b-a)*rnd(),pick=a=>a[floor(rnd()*a.length)];
const FONT='-apple-system,"PingFang TC","Noto Sans TC",sans-serif',aniso=renderer.capabilities.getMaxAnisotropy();
const canvas2=(w,h,draw,{rep=false,lin=false}={})=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=lin?T.NoColorSpace:T.SRGBColorSpace;t.anisotropy=aniso;if(rep)t.wrapS=t.wrapT=T.RepeatWrapping;return t;};
const blot=(g,x,y,r,c,a,sx=1)=>{g.save();g.translate(x,y);g.scale(sx,1);const q=g.createRadialGradient(0,0,0,0,0,r);q.addColorStop(0,`rgba(${c},${a})`);q.addColorStop(1,`rgba(${c},0)`);g.fillStyle=q;g.fillRect(-r,-r,2*r,2*r);g.restore();};
const COL=new Map(),col=c=>{if(c.isColor)return c;let v=COL.get(c);if(!v){v=new T.Color(c);COL.set(c,v);}return v;};

// 把一堆方塊併成一個網格：面朝外由實體中心判斷。xf 把局部座標轉成世界座標，uvf 自訂貼圖對應（預設依面向平面投影）。
class Bag{
 constructor(uvs=6){this.p=[];this.n=[];this.c=[];this.t=[];this.xf=null;this.uvf=null;this.uvs=uvs;}
 raw(v,n,c,uv){this.p.push(v[0],v[1],v[2]);this.n.push(n[0],n[1],n[2]);this.c.push(c.r,c.g,c.b);this.t.push(uv[0],uv[1]);}
 quad(q,uv,n,c){const k=col(c);for(const i of[0,1,2,0,2,3])this.raw(q[i],n,k,uv[i]);}
 face(q,cc,ctr){const c=col(cc),Wd=this.xf?q.map(this.xf):q,C=ctr&&this.xf?this.xf(ctr):ctr,a=Wd[0],b=Wd[1],d=Wd[2];
  let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  if(hypot(nx,ny,nz)<1e-9&&Wd[3]){const e=Wd[3];vx=e[0]-a[0];vy=e[1]-a[1];vz=e[2]-a[2];nx=uy*vz-uz*vy;ny=uz*vx-ux*vz;nz=ux*vy-uy*vx;}
  const l=hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  const fc=[0,1,2].map(k=>Wd.reduce((s,p)=>s+p[k],0)/Wd.length),flip=C&&(nx*(fc[0]-C[0])+ny*(fc[1]-C[1])+nz*(fc[2]-C[2]))<0;if(flip){nx=-nx;ny=-ny;nz=-nz;}
  const n=[nx,ny,nz],tri=q.length===3?(flip?[[0,2,1]]:[[0,1,2]]):(flip?[[0,2,1],[0,3,2]]:[[0,1,2],[0,2,3]]),ax=abs(nx),ay=abs(ny),az=abs(nz),s=this.uvs;
  for(const t of tri)for(const i of t){const v=Wd[i];this.raw(v,n,c,this.uvf?this.uvf(q[i],v,n):[(ay>.7?v[0]:ax>az?v[2]:v[0])/s,(ay>.7?v[2]:v[1])/s]);}}
 hexa(v,c){const ctr=[0,1,2].map(k=>v.reduce((s,p)=>s+p[k],0)/8);for(const f of[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])this.face(f.map(i=>v[i]),c,ctr);}
 box(x,y,z,sx,sy,sz,ry,c){const co=cos(ry),s=sin(ry),h=[sx/2,sy/2,sz/2],pt=(a,b,d)=>[x+a*h[0]*co+d*h[2]*s,y+b*h[1],z-a*h[0]*s+d*h[2]*co];this.hexa([pt(-1,-1,-1),pt(1,-1,-1),pt(1,-1,1),pt(-1,-1,1),pt(-1,1,-1),pt(1,1,-1),pt(1,1,1),pt(-1,1,1)],c);}
 b(x0,x1,y0,y1,z0,z1,c){this.hexa([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],c);}
 sector(r0,r1,a0,a1,y0,y1,c,y1b=y1,y0b=y0){this.hexa([P(r0,a0,y0),P(r1,a0,y0b),P(r1,a1,y0b),P(r0,a1,y0),P(r0,a0,y1),P(r1,a0,y1b),P(r1,a1,y1b),P(r0,a1,y1)],c);}
 prism(pts,z0,z1,c){const n=pts.length,cx=pts.reduce((s,p)=>s+p[0],0)/n,cy=pts.reduce((s,p)=>s+p[1],0)/n,ctr=[cx,cy,(z0+z1)/2];
  for(let i=0;i<n;i++){const p=pts[i],q=pts[(i+1)%n];this.face([[p[0],p[1],z0],[q[0],q[1],z0],[q[0],q[1],z1],[p[0],p[1],z1]],c,ctr);}
  for(const z of[z0,z1])for(let i=1;i<n-1;i++)this.face([[pts[0][0],pts[0][1],z],[pts[i][0],pts[i][1],z],[pts[i+1][0],pts[i+1][1],z]],c,ctr);}
 cone(x,y0,z,r0,y1,r1,c,seg=14,cap=true){const q=(i,y,r)=>{const a=i/seg*2*PI;return[x+cos(a)*r,y,z+sin(a)*r];},ctr=[x,(y0+y1)/2,z];
  for(let i=0;i<seg;i++){this.face([q(i,y0,r0),q(i+1,y0,r0),q(i+1,y1,r1),q(i,y1,r1)],c,ctr);if(cap&&r1>.01)this.face([[x,y1,z],q(i,y1,r1),q(i+1,y1,r1)],c,[x,y1-1,z]);}}
 bar(a,b,t,c){const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],L=hypot(...d)||1,n=d.map(v=>v/L),u=abs(n[1])>.9?[1,0,0]:[0,1,0],sx=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]],sl=hypot(...sx)||1,s=sx.map(v=>v/sl*t/2),w=[n[1]*s[2]-n[2]*s[1],n[2]*s[0]-n[0]*s[2],n[0]*s[1]-n[1]*s[0]],pt=(o,i,j)=>[o[0]+s[0]*i+w[0]*j,o[1]+s[1]*i+w[1]*j,o[2]+s[2]*i+w[2]*j];
  this.hexa([pt(a,-1,-1),pt(a,1,-1),pt(a,1,1),pt(a,-1,1),pt(b,-1,-1),pt(b,1,-1),pt(b,1,1),pt(b,-1,1)],c);}
 mesh(mat,cast=true){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));g.setAttribute('uv',new T.Float32BufferAttribute(this.t,2));
  const m=new T.Mesh(g,mat);m.castShadow=cast;m.receiveShadow=true;return m;}
}

// ── 貼圖 ─────────────────────────────────────
const concTex=canvas2(1024,1024,(g,N)=>{g.fillStyle='#ddd8cc';g.fillRect(0,0,N,N);
 for(let i=0;i<420;i++){const x=rnd()*N,y=rnd()*N,r=rr(24,170),dk=rnd()<.6;for(const dx of[-N,0,N])for(const dy of[-N,0,N])if(x+dx>-r&&x+dx<N+r&&y+dy>-r&&y+dy<N+r)blot(g,x+dx,y+dy,r,dk?'66,60,48':'255,250,236',rr(.04,.12));}
 for(let i=0;i<9000;i++){const v=rnd()<.5?60:245;g.fillStyle=`rgba(${v},${v},${v-10},${rr(.05,.2)})`;g.fillRect(rnd()*N,rnd()*N,rr(1,2.5),rr(1,2.5));}
 for(let i=0;i<70;i++){g.fillStyle=`rgba(54,48,38,${rr(.04,.14)})`;g.fillRect(rnd()*N,rnd()*N,rr(1,4),rr(70,360));}},{rep:true});
const FH=9.2;
const facTex=canvas2(2048,1024,(g,w,h)=>{const Y=m=>(1-m/FH)*h;
 const q=g.createLinearGradient(0,0,0,h);q.addColorStop(0,'#a4935a');q.addColorStop(.07,'#baa766');q.addColorStop(.5,'#c6b373');q.addColorStop(.88,'#b09f62');q.addColorStop(1,'#7b6f45');g.fillStyle=q;g.fillRect(0,0,w,h);
 for(let i=0;i<620;i++)blot(g,rnd()*w,rnd()*h,rr(24,150),rnd()<.62?'86,76,44':'240,228,186',rr(.025,.085),rr(.4,1));
 for(let i=0;i<90;i++)blot(g,rnd()*w,rr(.05,.5)*h,rr(10,40),'70,78,52',rr(.04,.1));
 for(let k=0;k<2;k++){const x0=k*1024;
  {const s=g.createLinearGradient(0,Y(6.6),0,Y(5.5));s.addColorStop(0,'rgba(40,34,24,0)');s.addColorStop(.6,'rgba(40,34,24,.36)');s.addColorStop(1,'rgba(30,26,18,.62)');g.fillStyle=s;g.fillRect(x0,Y(6.6),1024,Y(5.5)-Y(6.6));}
  {const s=g.createLinearGradient(0,Y(FH),0,Y(8.3));s.addColorStop(0,'rgba(30,26,18,.55)');s.addColorStop(1,'rgba(30,26,18,0)');g.fillStyle=s;g.fillRect(x0,Y(FH),1024,Y(8.3)-Y(FH));}
  for(let i=0;i<420;i++){const x=x0+rnd()*1024,y0=pick([Y(8.7),Y(6.5),Y(8),rnd()*h]),L=rr(40,300);const s=g.createLinearGradient(0,y0,0,y0+L),a=rr(.06,.26);s.addColorStop(0,`rgba(44,38,26,${a})`);s.addColorStop(1,'rgba(44,38,26,0)');g.fillStyle=s;g.fillRect(x,y0,rr(1,5),L);}}
 for(let i=0;i<4200;i++){const v=rnd()<.6?70:240;g.fillStyle=`rgba(${v},${v-6},${v-30},${rr(.05,.2)})`;g.fillRect(rnd()*w,rnd()*h,rr(1,3),rr(1,3));}
 for(let i=0;i<60;i++){g.fillStyle=`rgba(226,218,190,${rr(.25,.6)})`;const x=rnd()*w,y=rnd()*h;g.beginPath();g.moveTo(x,y);for(let k=0;k<6;k++)g.lineTo(x+rr(-16,16),y+rr(-12,12));g.fill();}});
const RT=RB+6;
const roofTex=canvas2(2048,1024,(g,w,h)=>{const X=x=>(x/(2*RT)+.5)*w,Z=z=>(1-z/RT)*h;g.fillStyle='#b4a98c';g.fillRect(0,0,w,h);
 for(let i=0;i<700;i++)blot(g,rnd()*w,rnd()*h,rr(16,150),pick(['92,84,62','72,70,52','206,196,166','120,108,70']),rr(.08,.22),rr(.5,2));
 g.lineCap='round';for(let i=0;i<=NS;i++){const a=phiOf(0)+HS-i*STEP;g.strokeStyle='rgba(44,40,32,.55)';g.lineWidth=6;g.beginPath();g.moveTo(X(sin(a)*RD),Z(cos(a)*RD));g.lineTo(X(sin(a)*RB*1.1),Z(cos(a)*RB*1.1));g.stroke();}
 for(let i=0;i<NS;i++)for(let k=0;k<9;k++){const a=phiOf(i)+rr(-HS,HS)*.9,r0=rr(RD,RB-10),r1=r0+rr(4,18);g.strokeStyle=`rgba(50,46,36,${rr(.08,.24)})`;g.lineWidth=rr(2,10);g.beginPath();g.moveTo(X(sin(a)*r0),Z(cos(a)*r0));g.lineTo(X(sin(a)*r1),Z(cos(a)*r1));g.stroke();}
 for(const r of[RD+7,RD+25]){g.strokeStyle='rgba(38,34,28,.42)';g.lineWidth=5;g.beginPath();for(let i=0;i<=60;i++){const a=lerp(-1,1,i/60);g.lineTo(X(sin(a)*r),Z(cos(a)*r));}g.stroke();}
 for(let i=0;i<9000;i++){const v=rnd()<.5?60:230;g.fillStyle=`rgba(${v},${v},${v-14},${rr(.05,.2)})`;g.fillRect(rnd()*w,rnd()*h,2,2);}});
const stoneTex=canvas2(512,512,(g,N)=>{g.fillStyle='#777';g.fillRect(0,0,N,N);for(let i=0;i<2600;i++){const x=rnd()*N,y=rnd()*N,r=rr(4,11),v=(rr(.35,1)*255)|0;for(const dx of[-N,0,N])for(const dy of[-N,0,N]){const q=g.createRadialGradient(x+dx-r*.3,y+dy-r*.3,0,x+dx,y+dy,r);q.addColorStop(0,`rgb(${v},${v},${v})`);q.addColorStop(1,'rgba(30,30,30,.0)');g.fillStyle=q;g.beginPath();g.ellipse(x+dx,y+dy,r,r*rr(.6,1),rr(0,3),0,7);g.fill();}}},{rep:true,lin:true});

const mConc=std({vertexColors:true,map:concTex,roughness:.93}),mFac=std({vertexColors:true,map:facTex,roughness:.9}),mRoof=std({vertexColors:true,map:roofTex,roughness:.96});
const mPaint=std({vertexColors:true,roughness:.5,metalness:.3}),mSteel=std({vertexColors:true,roughness:.42,metalness:.72}),mDark=std({vertexColors:true,roughness:1});
const mGlass=std({vertexColors:true,roughness:.14,metalness:.92,emissive:'#ffcf8a',emissiveIntensity:0});
const mGlow=new T.MeshStandardMaterial({color:'#39474f',emissive:'#ffcf8a',emissiveIntensity:0,roughness:.35,metalness:.3}),mSky=new T.MeshBasicMaterial({color:'#dfe9ef',fog:false});

// ── 地面：場內 ───────────────────────────────
const GR=132,GN=phone?2048:4096,COMP=64,CW=84,a0f=phiOf(0)+HS,a1f=phiOf(NS-1)-HS;
const inComp=(x,z,m=0)=>z>-20?hypot(x,z)<COMP+m:abs(x)<CW+m;
// 遠景分層：近的街屋是實體、看得清楚，後面幾圈是畫的，一圈比一圈糊、霧也一圈比一圈濃（1 單位約 1 公尺）
const TILE=['#b9b4a6','#aaa79c','#b4a696','#a89b8c','#a0a6a3','#bcaa9b','#939e9c','#b1a18b','#9d9182','#a8948a','#9aa097','#a3adb3'],TREE=['#5f7050','#687a55','#54654a','#73825a'];
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
// 縮小再放大兩次：在預乘空間裡做，邊緣不會有黑邊，轉動時也不會閃
const soften=(c,f)=>{if(!f)return c;const g=c.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';for(const k of[f,f*.62]){const a=mk(max(2,round(c.width/k)),max(2,round(c.height/k))),q=a.getContext('2d');q.imageSmoothingQuality='high';q.drawImage(c,0,0,a.width,a.height);g.clearRect(0,0,c.width,c.height);g.drawImage(a,0,0,c.width,c.height);}return c;};
const groundTex=canvas2(GN,GN,(g,N)=>{const X=v=>(v/GR+1)/2*N,L=m=>m/GR/2*N;
 g.fillStyle='#7f7b71';g.fillRect(0,0,N,N);
 // 弧形外環道
 g.strokeStyle='#44433f';g.lineWidth=L(14);g.beginPath();g.arc(X(0),X(0),L(COMP+7.5),0,7);g.stroke();
 g.strokeStyle='rgba(235,230,210,.6)';g.lineWidth=L(.18);g.setLineDash([L(3),L(4)]);g.beginPath();g.arc(X(0),X(0),L(COMP+7.5),0,7);g.stroke();g.setLineDash([]);
 g.strokeStyle='#7b7972';g.lineWidth=L(2.4);g.beginPath();g.arc(X(0),X(0),L(COMP+15.6),0,7);g.stroke();
 // 場內道碴
 g.save();g.beginPath();g.arc(X(0),X(0),L(COMP),0,7);g.rect(X(-CW),X(-GR),L(2*CW),X(-20)-X(-GR));g.clip();
 g.fillStyle='#5e5850';g.fillRect(0,0,N,N);
 for(let i=0;i<520;i++)blot(g,rnd()*N,rnd()*N,L(rr(2,16)),pick(['72,58,46','112,104,92','58,52,44','92,76,60','76,84,56']),rr(.14,.38),rr(.5,1.8));
 g.fillStyle='#7c7a72';g.fillRect(X(30),X(-GR),L(16),X(-14)-X(-GR));g.fillRect(X(-CW),X(-GR),L(14),X(-20)-X(-GR));
 for(let i=0;i<120;i++)blot(g,X(rr(30,46)),X(rr(-GR,-14)),L(rr(1,5)),'50,46,40',rr(.1,.3));
 const fan=(r0,r1,c)=>{g.fillStyle=c;g.beginPath();for(let i=0;i<=30;i++){const a=lerp(a0f,a1f,i/30);g.lineTo(X(sin(a)*r0),X(cos(a)*r0));}for(let i=30;i>=0;i--){const a=lerp(a0f,a1f,i/30);g.lineTo(X(sin(a)*r1),X(cos(a)*r1));}g.fill();};
 {const q=g.createRadialGradient(X(0),X(0),L(RP),X(0),X(0),L(RD+14));q.addColorStop(0,'rgba(104,82,66,1)');q.addColorStop(.55,'rgba(100,80,64,.9)');q.addColorStop(1,'rgba(100,80,64,0)');g.fillStyle=q;g.fillRect(0,0,N,N);}
 for(let i=0;i<260;i++){const a=rnd()*7,r=rr(RP,RD+2);blot(g,X(sin(a)*r),X(cos(a)*r),L(rr(.5,3.2)),pick(['58,44,34','132,104,82','92,70,52']),rr(.16,.4));}
 fan(RD*RC-.1,RB*RC,'#7d796e');
 for(let i=0;i<NS;i++){const a=phiOf(i),ln=(r0,r1,o,w,c)=>{const tx=cos(a)*o,tz=-sin(a)*o;g.strokeStyle=c;g.lineWidth=L(w);g.beginPath();g.moveTo(X(sin(a)*r0+tx),X(cos(a)*r0+tz));g.lineTo(X(sin(a)*r1+tx),X(cos(a)*r1+tz));g.stroke();};
  ln(RD,RB-1,0,1.5,'#26231f');for(const s of[-1,1]){ln(RD-1.6,RB-1,s*2.1,.14,'#e0652e');ln(RD,RB-1,s*1.15,.5,'#5a564e');}
  ln(RP,RD+.6,0,3.6,'rgba(52,44,36,.62)');
  for(let k=0;k<26;k++){const r=rr(RP+1,RD+16);blot(g,X(sin(a)*r+cos(a)*rr(-1.4,1.4)),X(cos(a)*r-sin(a)*rr(-1.4,1.4)),L(rr(.25,1.1)),'30,26,22',rr(.2,.45));}}
 // 場站軌床
 g.strokeStyle='rgba(50,44,38,.6)';g.lineCap='butt';for(const[ax,az,bx,bz]of G.YARD){g.lineWidth=L(4.2);g.beginPath();g.moveTo(X(ax),X(az));g.lineTo(X(bx),X(bz));g.stroke();}
 // 接觸陰影：門前、轉車台邊、圍牆
 {const q=g.createRadialGradient(X(0),X(0),L(RD-2.4),X(0),X(0),L(RD+1));q.addColorStop(0,'rgba(20,18,14,0)');q.addColorStop(1,'rgba(20,18,14,.5)');g.save();g.beginPath();for(let i=0;i<=30;i++){const a=lerp(a0f,a1f,i/30);g.lineTo(X(sin(a)*(RD-3)),X(cos(a)*(RD-3)));}for(let i=30;i>=0;i--){const a=lerp(a0f,a1f,i/30);g.lineTo(X(sin(a)*(RD+1.2)),X(cos(a)*(RD+1.2)));}g.clip();g.fillStyle=q;g.fillRect(0,0,N,N);g.restore();}
 {const q=g.createRadialGradient(X(0),X(0),L(COMP-3.6),X(0),X(0),L(COMP));q.addColorStop(0,'rgba(24,22,16,0)');q.addColorStop(1,'rgba(24,22,16,.45)');g.fillStyle=q;g.fillRect(0,0,N,N);}
 for(let i=0;i<70;i++){const a=rnd()*7;blot(g,X(sin(a)*(COMP-1.4)),X(cos(a)*(COMP-1.4)),L(rr(.8,2.4)),'82,98,54',rr(.25,.5));}
 g.restore();
 const n=GN*GN/30|0,rs=L(COMP+16);for(let i=0;i<n;i++){const x=rnd()*N,y=rnd()*N,v=(rnd()*105+45)|0;if(hypot(x-N/2,y-N/2)>rs&&y>X(-20))continue;g.fillStyle=`rgba(${v},${v-3},${v-11},.3)`;const s=rnd()<.25?2:1;g.fillRect(x,y,s,s);}});
stoneTex.repeat.set(GR/1.3,GR/1.3);
const mGround=std({map:groundTex,bumpMap:stoneTex,bumpScale:2.2,roughness:.97});
const ground=new T.Mesh(new T.RingGeometry(RP,GR,160,1),mGround);ground.rotation.x=-PI/2;ground.receiveShadow=true;scene.add(ground);

// ── 軌道 ─────────────────────────────────────
const wall=new Bag(),fac=new Bag(),roof=new Bag(),paint=new Bag(),steel=new Bag(),glass=new Bag(),glow=new Bag(),dark=new Bag(),ties=[];
roof.uvf=(l,v)=>[v[0]/(2*RT)+.5,v[2]/RT];
function track(ax,az,bx,bz,t0=.3){const L=hypot(bx-ax,bz-az),a=atan2(bx-ax,bz-az),mx=(ax+bx)/2,mz=(az+bz)/2;
 for(const s of[-1,1]){const x=mx+cos(a)*s,z=mz-sin(a)*s;steel.box(x,RAIL-.12,z,.13,.2,L,a,'#5a4638');steel.box(x,RAIL-.025,z,.085,.05,L,a,'#9a9690');}
 for(let d=t0;d<L;d+=.68)ties.push([ax+sin(a)*d,az+cos(a)*d,a]);}
for(let i=0;i<NS;i++){const a=phiOf(i);track(sin(a)*(RP+.08),cos(a)*(RP+.08),sin(a)*(RB-.7),cos(a)*(RB-.7),2.9);}
for(const[ax,az,bx,bz,t0=.3]of G.YARD)track(ax,az,bx,bz,t0);
{const im=new T.InstancedMesh(new T.BoxGeometry(2.8,.13,.3),std({roughness:.95}),ties.length),m=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),c=new T.Color();
 ties.forEach(([x,z,a],i)=>{e.set(0,a,0);q.setFromEuler(e);m.compose(new T.Vector3(x,.075,z),q,new T.Vector3(1,1,1));im.setMatrixAt(i,m);c.setHSL(.07,.14+rnd()*.1,.1+rnd()*.09,T.SRGBColorSpace);im.setColorAt(i,c);});im.receiveShadow=true;scene.add(im);}
// 轉車台外圈的黑枕木板，端頭漆橘
{const R0=RP+.18,Lb=2.5,n=round(2*PI*(R0+Lb/2)/.37),Wd=new T.BoxGeometry(.33,.1,Lb),Or=new T.BoxGeometry(.35,.13,.46),Or2=new T.BoxGeometry(.35,.13,.22);
 const a=new T.InstancedMesh(Wd,std({roughness:.86}),n),b=new T.InstancedMesh(Or,std({color:'#e4622a',roughness:.7}),n),d=new T.InstancedMesh(Or2,std({color:'#e4622a',roughness:.7}),n),m=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),c=new T.Color(),s=new T.Vector3(1,1,1);
 for(let i=0;i<n;i++){const t=i/n*2*PI+rr(-.002,.002);e.set(0,t,0);q.setFromEuler(e);const at=r=>new T.Vector3(sin(t)*r,.095,cos(t)*r);m.compose(at(R0+Lb/2),q,s);a.setMatrixAt(i,m);c.setHSL(.08,.08,.11+rnd()*.09,T.SRGBColorSpace);a.setColorAt(i,c);m.compose(at(R0+.24),q,s);b.setMatrixAt(i,m);m.compose(at(R0+Lb-.12),q,s);d.setMatrixAt(i,m);}
 a.receiveShadow=b.receiveShadow=d.receiveShadow=true;scene.add(a,b,d);
 // 門前弧形走道
 const wr=RD-2.9,wn=round((a0f-a1f)*wr/.3),w=new T.InstancedMesh(new T.BoxGeometry(.26,.09,1.7),std({roughness:.86}),wn);
 for(let i=0;i<wn;i++){const t=lerp(a1f,a0f,i/wn);e.set(0,t,0);q.setFromEuler(e);m.compose(new T.Vector3(sin(t)*wr,.118,cos(t)*wr),q,s);w.setMatrixAt(i,m);c.setHSL(.08,.08,.14+rnd()*.1,T.SRGBColorSpace);w.setColorAt(i,c);}w.receiveShadow=true;scene.add(w);
 for(const o of[-.92,.92])for(let i=0;i<40;i++){const u0=lerp(a1f,a0f,i/40),u1=lerp(a1f,a0f,(i+1)/40);paint.bar(P(wr+o,u0,.15),P(wr+o,u1,.15),.11,'#e4622a');}}

// ── 車庫本體 ─────────────────────────────────
const hw=RD*tan(HS),E0=5.7,E1=6.5,E2=8.0,E3=8.75,E4=9.05,MUST='#d8d0ba',BLUE='#5d7c92',BLUE2='#4d6a80',ORANGE='#d9622b';
const frameOf=(a,D)=>{const s=sin(a),c=cos(a);return([x,y,z])=>[s*(D-z)+c*x,y,c*(D-z)-s*x];};
// 高窗：鐵框藍漆、小格玻璃，每片微微不同色，反光才會碎
function ribbon(x0,x1,y0,y1,z,cols,rows){const dx=(x1-x0)/cols,dy=(y1-y0)/rows;
 for(let c=0;c<cols;c++)for(let r=0;r<rows;r++){const v=rr(.55,1),k=new T.Color().setRGB(.34*v,.45*v,.52*v);glass.b(x0+c*dx,x0+(c+1)*dx,y0+r*dy,y0+(r+1)*dy,z-.04,z,k);}
 for(let c=0;c<=cols;c++)paint.b(x0+c*dx-.03,x0+c*dx+.03,y0,y1,z-.02,z+.07,c%3?BLUE2:BLUE);
 for(let r=0;r<=rows;r++)paint.b(x0,x1,y0+r*dy-.03,y0+r*dy+.03,z-.02,z+.07,BLUE);}
const setF=(b,f)=>{for(const k of b)k.xf=f;};
for(let i=0;i<NS;i++){const a=phiOf(i),b0=a-HS,b1=a+HS,f=frameOf(a,RD),uoff=(i%2)*.5;
 setF([fac,paint,glass,dark,glow,wall],f);fac.uvf=l=>[(l[0]/(2*hw)+.5)*.5+uoff,l[1]/FH];
 // 門楣、拱腋、高窗帶、上帶、挑簷
 fac.b(-hw,hw,E0,E1,-.34,.36,MUST);
 for(const s of[-1,1]){const xa=s*(hw-.4);fac.prism([[xa,E0],[xa-s*1.05,E0],[xa,E0-1.05]],-.1,.3,MUST);}
 fac.b(-hw,hw,E1,E1+.14,-.34,.2,MUST);
 const wx=hw-.72;fac.b(-hw,-wx,E1,E2,-.34,.02,MUST);fac.b(wx,hw,E1,E2,-.34,.02,MUST);
 fac.b(-hw,hw,E2,E3,-.34,.22,MUST);fac.b(-hw,hw,E2-.1,E2,-.34,.1,MUST);
 ribbon(-wx,wx,E1+.14,E2-.1,-.18,7,2);
 dark.b(-wx,wx,E1+.14,E2-.1,-.34,-.24,'#17181a');
 wall.b(-hw-.1,hw+.1,E3,E4,-.6,.9,'#a39770');wall.b(-hw-.1,hw+.1,E3-.05,E3,.3,.86,'#3a372e');
 // 屋頂：平屋面、女兒牆、抬高的高窗環
 for(const k of[fac,paint,glass,dark,glow,wall])k.xf=null;
 roof.sector((RD-.55)*RC,RB*RC,b0,b1,E4-.02,E4+.03,'#ffffff');
 wall.sector((RD-.86)*RC,(RD-.55)*RC,b0,b1,E4,E4+.3,'#b5a97e');
 const rA=RD+11.5,rB=RD+24;roof.sector(rA*RC,rB*RC,b0,b1,E4+1.72,E4+1.9,i%2?'#f1ece0':'#e9e3d4');
 wall.sector(rB*RC-.5,rB*RC,b0,b1,E4,E4+1.72,'#cfc4a0');dark.sector(rA*RC+.2,rB*RC-.2,b0+.004,b1-.004,E4,E4+.1,'#1b1c1e');
 {const g2=frameOf(a,rA),h2=rA*tan(HS);setF([fac,paint,glass,dark],g2);fac.uvf=l=>[(l[0]/(2*h2)+.5)*.5+uoff,(l[1]-1)/FH];
  fac.b(-h2,h2,E4,E4+.26,-.4,.1,MUST);fac.b(-h2,h2,E4+1.5,E4+1.72,-.4,.12,MUST);for(const s of[-1,1])fac.b(s*h2-.28,s*h2+.28,E4,E4+1.72,-.4,.1,MUST);
  ribbon(-h2+.3,h2-.3,E4+.26,E4+1.5,-.12,10,2);dark.b(-h2+.3,h2-.3,E4+.26,E4+1.5,-.3,-.2,'#17181a');setF([fac,paint,glass,dark],null);}
 if(i===0||i===NS-1){const e=i===0?b1:b0,rp=(r,y)=>P(r*RC,e,y);wall.face([rp(rA,E4),rp(rB,E4),rp(rB,E4+1.72),rp(rA,E4+1.72)],'#cfc4a0',P(RD+18,a,E4));}
 // 內部：天花、後窗、吊燈、橘色工作架
 dark.sector(RD*RC-.2,RB*RC,b0,b1,E3-.04,E3,'#141517');
 {const g2=frameOf(a,RB),h2=RB*tan(HS);setF([wall,paint,glow],g2);wall.b(-h2,h2,0,E3,-.5,0,'#6d6a5c');wall.b(-h2,h2,0,E4,-.62,-.5,'#c1af70');setF([wall,paint,glow],null);}
 const sky=new Bag();sky.xf=frameOf(a,RB-.05);{const h2=RB*tan(HS);setF([dark],frameOf(a,RB-.12));for(const o of[-.55,0,.55]){const c=o*h2*1.1;sky.b(c-1.2,c+1.2,1.6,6.6,0,.02,'#fff');for(const k of[-1.2,-.4,.4,1.2])dark.b(c+k-.05,c+k+.05,1.55,6.65,-.03,.03,'#2a3036');for(let y=1.6;y<=6.61;y+=1)dark.b(c-1.25,c+1.25,y-.05,y+.05,-.03,.03,'#2a3036');}setF([dark],null);}
 scene.add(sky.mesh(mSky,false));
 setF([paint,glow],frameOf(a,RD+6));for(const s of[-1,1]){for(const z of[0,-5.2])paint.b(s*2.42-.12,s*2.42+.12,0,5.7,z-.12,z+.12,ORANGE);paint.b(s*2.42-.1,s*2.42+.1,5.5,5.72,-5.3,.1,ORANGE);paint.bar([s*2.42,4.4,-.1],[s*2.42,5.5,-1.4],.12,ORANGE);}
 paint.b(-2.5,2.5,5.54,5.72,-.14,.14,ORANGE);paint.b(-2.5,2.5,5.54,5.72,-5.34,-5.06,ORANGE);setF([paint,glow],null);
 for(const r of[RD+3.6,RD+13,RD+22]){const p=P(r,a,7.8);glow.box(p[0],7.8,p[2],1.1,.12,.42,a,'#222');steel.box(p[0],8.3,p[2],.05,.9,.05,0,'#2c2d2f');}
 // 排煙筒：底座外擴、頂上開口、蘑菇帽
 const cr=RD+3.5,cp=P(cr,a,0),cx=cp[0],cz=cp[2],CY='#d3c088';
 wall.cone(cx,E4,cz,1.15,E4+.5,.7,'#bcae80',18,false);wall.cone(cx,E4+.5,cz,.7,E4+3.05,.6,CY,18,true);
 for(let k=0;k<4;k++){const t=k*PI/2+.4;wall.box(cx+cos(t)*.48,E4+3.25,cz+sin(t)*.48,.14,.42,.14,t,CY);}
 wall.cone(cx,E4+3.44,cz,.82,E4+3.56,.92,'#5d5642',18,false);wall.cone(cx,E4+3.56,cz,.92,E4+3.92,.14,'#6f664c',18,false);
}
// 支柱與牆垛
for(let j=0;j<=NS;j++){const a=phiOf(0)+HS-j*STEP,end=j===0||j===NS,f=frameOf(a,RD*RC),e=end?1.25:1;
 setF([fac,wall,paint,steel],f);fac.uvf=l=>[(l[0]/6+.5)*.5+.25*(j%2),l[1]/FH];
 fac.b(-.46*e,.46*e,0,E3,-.5,.78,MUST);fac.b(-.29*e,.29*e,.9,E3,.78,.98,MUST);wall.b(-.6*e,.6*e,0,.92,-.55,1.08,'#7f7652');
 paint.b(.33*e,.4*e,.92,E3,.98-.2,.9,'#3f4a44');
 setF([fac,wall,paint,steel],null);
 for(const r of[RD+8.5,RD+17,RD+25.5]){const p=P(r*RC,a,0);wall.box(p[0],E3/2,p[2],end?.6:.46,E3,.46,a,'#8b8670');}
 if(end){const s=j===0?1:-1;// 端牆：高窗、壁柱，照背面照片
  setF([wall,paint,glass,dark],([x,y,z])=>{const c=cos(a),n=sin(a);const r=RD*RC-z;return[n*r+c*x,y,c*r-n*x];});
  wall.b(-.3,.3,0,E4,-(RB-RD)*RC,0,'#c1af70');
  setF([wall,paint,glass,dark],null);
  for(let k=0;k<5;k++){const r0=RD*RC+2.4+k*6.1,mkp=(r,y)=>{const n=[sin(a),cos(a)],t=[cos(a)*s*.33,-sin(a)*s*.33];return[n[0]*r+t[0],y,n[1]*r+t[1]];};
   glass.face([mkp(r0,1.4),mkp(r0+3.9,1.4),mkp(r0+3.9,7.2),mkp(r0,7.2)],new T.Color().setRGB(.16,.22,.26),[0,4,0]);
   for(let c=0;c<=4;c++){const r=r0+c*.975;paint.bar(mkp(r,1.4),mkp(r,7.2),.11,BLUE2);}for(let c=0;c<=6;c++){const y=1.4+c*.967;paint.bar(mkp(r0,y),mkp(r0+3.9,y),.11,BLUE2);}}
 }}
{// 招牌：屋頂鋼架立牌
 for(const x of[-5.4,-1.8,1.8,5.4]){paint.bar([x,E4+1.9,RD+16.5],[x,E4+4,RD+16.5],.16,'#3c4347');paint.bar([x,E4+1.9,RD+18.4],[x,E4+3.9,RD+16.5],.1,'#3c4347');}}
// 轉車台邊的水塔、看台、物料
const TWX=-44,TWZ=-32;
for(const[dx,dz]of[[-2.4,-2.4],[2.4,-2.4],[2.4,2.4],[-2.4,2.4]])paint.bar([TWX+dx*1.25,0,TWZ+dz*1.25],[TWX+dx*.9,12,TWZ+dz*.9],.3,'#464a48');
for(const y of[4,8]){const k=1.25-.35*y/12,c=[[-2.4,-2.4],[2.4,-2.4],[2.4,2.4],[-2.4,2.4]].map(([a,b])=>[TWX+a*k,y,TWZ+b*k]);for(let i=0;i<4;i++){paint.bar(c[i],c[(i+1)%4],.15,'#464a48');}}
wall.cone(TWX,12,TWZ,3.6,16.2,3.6,'#8f7559',22,true);wall.cone(TWX,16.2,TWZ,3.9,16.5,3.9,'#50493f',22,true);wall.cone(TWX,16.5,TWZ,3.9,18,.3,'#5e5649',22,false);
// 看台：鋼梯、紅欄杆
{const X=34,Z=-27,RED='#c9472e';for(const[dx,dz]of[[-6,-1.4],[6,-1.4],[6,1.4],[-6,1.4]])paint.bar([X+dx,0,Z+dz],[X+dx,4.3,Z+dz],.2,'#b5b2a8');
 paint.box(X,4.4,Z,12.6,.16,3.2,0,'#8f8d86');for(const s of[-1,1]){paint.box(X,5.4,Z+s*1.55,12.6,.06,.06,0,RED);paint.box(X,4.95,Z+s*1.55,12.6,.05,.05,0,RED);for(let k=-6;k<=6;k+=1.5)paint.box(X+k,4.95,Z+s*1.55,.06,1,.06,0,RED);}
 for(const s of[-.55,.55]){paint.bar([X+6.2,4.4,Z+s],[X+12.6,0,Z+s],.14,'#8f8d86');paint.bar([X+6.2,5.4,Z+s],[X+12.6,1,Z+s],.06,RED);}
 for(let k=0;k<12;k++)paint.box(X+6.6+k*.5,4.1-k*.34,Z,.4,.05,1.1,0,'#8f8d86');}
// 物料：枕木堆、鋼軌堆、油桶、警戒塊
{const Sx=-24,Sz=-30;for(let r=0;r<5;r++)for(let c=0;c<7-r;c++)wall.box(Sx+c*.36+r*.18,.14+r*.27,Sz,.3,.24,2.8,0,pick(['#3a332b','#2f2a24','#463c30']));
 for(let r=0;r<3;r++)for(let c=0;c<6;c++)steel.box(-31+c*.3,.1+r*.17,-24,.13,.14,9,.3,'#5e4737');
 for(const[x,z]of[[23,-24],[23.8,-24.4],[23.3,-23.2],[24.2,-23.5]])wall.cone(x,0,z,.33,.95,.33,pick(['#2f5f8a','#2f4f3a','#7a3324']),12,true);
 const stripe=canvas2(256,128,(g,w,h)=>{g.fillStyle='#e6b912';g.fillRect(0,0,w,h);g.fillStyle='#1b1b1b';for(let x=-h;x<w+h;x+=64){g.beginPath();g.moveTo(x,h);g.lineTo(x+32,h);g.lineTo(x+32+h,0);g.lineTo(x+h,0);g.fill();}});
 const bm=new T.Mesh(new T.BoxGeometry(2.4,1.3,1.1),std({map:stripe,roughness:.7}));for(const[x,z,r]of[[9,-RP-5,.1],[-9,-RP-5.4,-.2]]){const k=bm.clone();k.position.set(x,.65,z);k.rotation.y=r;k.castShadow=true;scene.add(k);}}
// 高桿投光燈
const POSTS=[[-30,-46],[56,-34],[-20,-90],[23,-150],[-22,-230]];
for(const[x,z]of POSTS){const a=atan2(-x,-z)+PI/2;paint.bar([x,0,z],[x,19,z],.42,'#6a6f72');paint.box(x,19.2,z,3.4,.18,.18,a,'#4e5356');for(const k of[-1,0,1])glow.box(x+cos(a)*k*1.1,18.9,z-sin(a)*k*1.1,.9,.5,.2,a,'#222');}
// 場站電車線：門型架、接觸線
for(let z=-110;z>-430;z-=52){paint.bar([-17,0,z],[-17,8.6,z],.34,'#6a6f72');paint.bar([17,0,z],[17,8.6,z],.34,'#6a6f72');for(const y of[7.6,8.5])paint.box(0,y,z,34,.12,.12,0,'#5f6468');for(let x=-16;x<16;x+=2)paint.bar([x,7.6,z],[x+1,8.5,z],.06,'#5f6468');}
for(const x of[-12,-6,0,6,12])steel.box(x,6.3,-270,.03,.03,320,0,'#3a3b3c');
// 圍牆：弧段＋直段
{const seg=(a,b)=>{const L=hypot(b[0]-a[0],b[1]-a[1]),t=atan2(b[0]-a[0],b[1]-a[1]);wall.box((a[0]+b[0])/2,1.3,(a[1]+b[1])/2,.3,2.6,L,t,'#b9b4a4');wall.box((a[0]+b[0])/2,2.66,(a[1]+b[1])/2,.46,.12,L,t,'#8f8b7d');};
 let pv=null;for(let i=0;i<=60;i++){const t=lerp(-(PI-.29),PI-.29,i/60),p=[sin(t)*COMP,cos(t)*COMP];if(pv&&cos(t)*COMP>-21)seg(pv,p);pv=p;}
 for(const s of[-1,1]){const x0=s*sqrt(COMP*COMP-400);seg([x0,-20],[s*CW,-20]);for(let z=-20;z>-440;z-=20)seg([s*CW,z],[s*CW,z-20]);}}
// 場內小屋：長棚、辦公室、鐵皮
function shed(x,z,w,d,h,ry,body,rf){wall.box(x,h/2,z,w,h,d,ry,body);const c=cos(ry),s=sin(ry),pt=(a,y,b)=>[x+a*c+b*s,y,z-a*s+b*c],o=.5,rh=h+w*.16;
 wall.hexa([pt(-w/2-o,h,-d/2-o),pt(0,rh,-d/2-o),pt(0,rh,d/2+o),pt(-w/2-o,h,d/2+o),pt(-w/2-o,h+.14,-d/2-o),pt(0,rh+.14,-d/2-o),pt(0,rh+.14,d/2+o),pt(-w/2-o,h+.14,d/2+o)],rf);
 wall.hexa([pt(w/2+o,h,-d/2-o),pt(0,rh,-d/2-o),pt(0,rh,d/2+o),pt(w/2+o,h,d/2+o),pt(w/2+o,h+.14,-d/2-o),pt(0,rh+.14,-d/2-o),pt(0,rh+.14,d/2+o),pt(w/2+o,h+.14,d/2+o)],rf);
 for(const e of[-1,1]){const q=e*d/2;wall.face([pt(-w/2,h,q),pt(w/2,h,q),pt(0,rh,q)],body,[x,h/2,z]);}
 for(const e of[-1,1])for(let k=-d/2+2.4;k<d/2-1.6;k+=4.2){const p=pt(e*(w/2+.02),2.4,k);glow.box(p[0],2.5,p[2],.05,1.5,2.6,ry,'#222');}}
shed(62,-64,16,64,6.4,0,'#d9d6cb','#54717f');shed(66,-166,18,90,7.4,0,'#cdcabd','#5e6e6a');shed(-66,-74,12,44,5.2,.0,'#d6d0be','#a4543a');shed(-70,-176,14,76,6,.0,'#c9c7bb','#596a78');shed(-62,-34,9,16,4.6,PI/2,'#e0d8c2','#7c5138');shed(40,-44,6,10,3.2,.2,'#d9d6cb','#4f6470');

// ── 近景：沿外環道和場站兩側蓋街屋。一批一批同款（透天就是這樣蓋的），批與批之間高度、顏色、退縮都不同，才不會連成一棟
const AW=2048,AH=phone?1024:2048,PX0=phone?8:12,PX1=phone?5:7,atD=mk(AW,AH),atL=mk(AW,AH),aD=atD.getContext('2d'),aL=atL.getContext('2d');
aL.fillStyle='#000';aL.fillRect(0,0,AW,AH);aD.fillStyle='#fff';aD.fillRect(0,0,AW,AH);
{aD.fillStyle='#9d9a90';aD.fillRect(16,0,64,64);for(let i=0;i<46;i++){blot(aD,16+rnd()*64,rnd()*64,rr(4,18),pick(['78,74,64','186,182,170','96,90,76']),rr(.1,.3));}aD.strokeStyle='#b5b1a5';aD.lineWidth=5;aD.strokeRect(18.5,2.5,59,59);}
const WU=[4/AW,1-4/AH],RU=[[20/AW,1-60/AH],[76/AW,1-60/AH],[76/AW,1-4/AH],[20/AW,1-4/AH]];
let ax=84,ay=0,ar=66;const slot=(w,h)=>{if(ax+w>AW){ax=0;ay+=ar+2;ar=0;}const s=[ax,ay,w,h];ax+=w+2;ar=max(ar,h);return s;};
const shade=(hex,k)=>{const c=new T.Color(hex);c.multiplyScalar(k);return c;},clamp01=v=>max(0,min(1,v));
function facade(w,fl,kind,PXM){const fh=rr(2.95,3.3),g0=kind<2?rr(3.1,3.6):fh,H0=g0+(fl-1)*fh+.5,pw=ceil(w*PXM),ph=ceil(H0*PXM),s=slot(pw,ph);if(s[1]+ph>AH)return null;
 const X=m=>s[0]+m*PXM,Y=m=>s[1]+(H0-m)*PXM,R=(g,x,y,a,b)=>g.fillRect(X(x),Y(y+b),a*PXM,b*PXM),base=pick(TILE),style=kind===2?0:pick([0,1,1,2]),warm=()=>`rgb(255,${196+rnd()*40|0},130)`;
 aD.save();aD.beginPath();aD.rect(s[0],s[1],pw,ph);aD.clip();aD.fillStyle=base;aD.fillRect(s[0],s[1],pw,ph);
 for(let i=0;i<9;i++)blot(aD,X(rnd()*w),Y(rnd()*H0),rr(.8,3)*PXM,rnd()<.6?'70,64,54':'226,222,212',rr(.06,.16));
 const nb=kind?max(1,round(w/rr(3.4,4.4))):w>5.4&&rnd()<.5?2:1,bw=w/nb,glass=pick(['#6e7c84','#67757e','#77838a']),core=kind&&nb>2?nb>>1:-1,coreC=pick(['rgba(255,252,244,.2)','rgba(52,46,38,.12)']),gl=(x,y,a,b)=>{aD.fillStyle=glass;R(aD,x,y,a,b);aD.fillStyle='rgba(226,234,236,.22)';R(aD,x,y+b*.45,a,b*.55);if(rnd()<.3){aL.fillStyle=warm();R(aL,x,y,a,b);}};
 for(let f=0;f<fl;f++){const y=f?g0+(f-1)*fh:0;
  if(f===0&&kind<2){if(rnd()<.5){aD.fillStyle='#8a8e90';R(aD,.3,.05,w-.6,2.5);aD.fillStyle='rgba(0,0,0,.14)';for(let k=.1;k<2.5;k+=.24)R(aD,.3,k,w-.6,.05);}
    else{aD.fillStyle='#4a4d4e';R(aD,.3,.05,w-.6,2.5);aD.fillStyle='rgba(226,214,184,.32)';R(aD,.45,.2,w-.9,2.1);if(rnd()<.7){aL.fillStyle=`rgb(255,${205+rnd()*30|0},150)`;R(aL,.3,.1,w-.6,2.4);}}
    if(rnd()<.55){const sg=pick(['#a4624f','#5d7f97','#b89a58','#6a8a72','#d6d1c3','#8d6470']);aD.fillStyle=sg;R(aD,.15,2.62,w-.3,.56);if(rnd()<.6){aL.fillStyle=sg;R(aL,.15,2.62,w-.3,.56);}}
    aD.fillStyle='rgba(0,0,0,.2)';R(aD,.1,2.5,w-.2,.12);continue;}
  if(style===2){gl(.4,y+1,w-.8,1.35);aD.fillStyle='rgba(235,233,226,.8)';for(let k=.4;k<w-.4;k+=1.15)R(aD,k,y+1,.05,1.35);aD.fillStyle='rgba(40,38,34,.2)';R(aD,.3,y+.86,w-.6,.1);}
  else for(let b=0;b<nb;b++){const x=b*bw;if(b===core){aD.fillStyle=coreC;R(aD,x+.15,y,bw-.3,fh);gl(x+bw/2-.34,y+1.75,.68,.68);continue;}if(rnd()<.1)continue;
   if((kind&&rnd()<.34?1-style:style)===0){aD.fillStyle='rgba(44,44,46,.3)';R(aD,x+.1,y+.14,bw-.2,fh-.3);gl(x+bw*.2,y+.7,bw*.6,1.9);aD.fillStyle=pick(['#cfccc2','#bdbfbc','#c7c0b2']);R(aD,x+.06,y+.2,bw-.12,.9);aD.fillStyle='rgba(60,60,60,.18)';for(let k=.2;k<bw-.1;k+=.3)R(aD,x+k,y+.24,.05,.82);aD.fillStyle='rgba(240,238,230,.7)';R(aD,x,y+.08,bw,.12);}
   else{const ww=bw*rr(.5,.68),wx=x+(bw-ww)/2,wy=y+.95,wh=1.5;gl(wx,wy,ww,wh);aD.fillStyle='rgba(205,207,204,.62)';for(let k=0;k<=ww+.01;k+=.34)R(aD,wx+k-.03,wy-.08,.05,wh+.14);R(aD,wx-.08,wy-.1,ww+.16,.08);R(aD,wx-.08,wy+wh,ww+.16,.08);aD.fillStyle='rgba(30,28,24,.16)';R(aD,wx-.06,wy-.28,ww+.12,.18);}
   if(rnd()<.26){aD.fillStyle='#c4c3bc';R(aD,x+bw*.1,y+.3,.72,.5);aD.fillStyle='rgba(40,40,40,.3)';R(aD,x+bw*.1+.5,y+.3,.22,.5);}
   if(rnd()<.55){const sx=X(x+rnd()*bw),y0=Y(y+.9),L=rr(.8,2.8)*PXM,q=aD.createLinearGradient(0,y0,0,y0+L);q.addColorStop(0,'rgba(52,44,36,.26)');q.addColorStop(1,'rgba(52,44,36,0)');aD.fillStyle=q;aD.fillRect(sx,y0,rr(.1,.34)*PXM,L);}}
  aD.fillStyle='rgba(50,46,40,.1)';R(aD,0,y,w,.08);}
 aD.fillStyle='rgba(226,224,216,.55)';R(aD,0,H0-.2,w,.2);aD.fillStyle='rgba(30,26,20,.18)';R(aD,0,H0-.28,w,.08);
 {const q=aD.createLinearGradient(0,Y(2.4),0,Y(0));q.addColorStop(0,'rgba(24,22,18,0)');q.addColorStop(1,'rgba(24,22,18,.32)');aD.fillStyle=q;aD.fillRect(s[0],Y(2.4),pw,2.4*PXM);}
 aD.restore();const u0=s[0]/AW,u1=(s[0]+pw)/AW,v0=1-(s[1]+ph)/AH,v1=1-s[1]/AH;return{uv:[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],base,h:H0};}
const tw=new Bag();
const tq=(pts,uv,c,ctr)=>{tw.uvf=p=>uv[pts.indexOf(p)];tw.face(pts,c,ctr);};
const plain=()=>{tw.uvf=()=>WU;};
// M(u,v)：沿街距離、往街屋後方的深度 → 世界座標
function house(M,u0,u1,v0,d,fc,tint,ry){const h=fc.h,a=M(u0,v0),b=M(u1,v0),c=M(u1,v0+d),e=M(u0,v0+d),p=(q,y)=>[q[0],y,q[1]],mm=M((u0+u1)/2,v0+d/2),ctr=[mm[0],h/2,mm[1]],side=shade(fc.base,.8*tint);
 const uv=rnd()<.5?fc.uv:[fc.uv[1],fc.uv[0],fc.uv[3],fc.uv[2]];
 tq([p(a,0),p(b,0),p(b,h),p(a,h)],uv,shade('#ffffff',tint),ctr);
 plain();for(const[x,y]of[[b,c],[c,e],[e,a]])tw.face([p(x,0),p(y,0),p(y,h),p(x,h)],side,ctr);
 tq([p(a,h),p(b,h),p(c,h),p(e,h)],RU,shade('#ffffff',rr(.8,1)),[ctr[0],h-1,ctr[2]]);
 plain();const L=abs(u1-u0),r=rnd();
 if(r<.3&&L>4){const w0=v0+d*rr(.3,.45),w1=v0+d*rr(.82,.95),m0=(u0+u1)/2,w=L*.42,q=(u,v,y)=>p(M(u,v),y),hh=h+2.5,rh=hh+1,cc=[mm[0],h+1,mm[1]];const wc='#aeaca2',rf=pick(['#6c8799','#8f6650','#75907f','#8f9394','#a18155']);
  for(const[x0,y0,x1,y1]of[[m0-w,w0,m0+w,w0],[m0+w,w0,m0+w,w1],[m0+w,w1,m0-w,w1],[m0-w,w1,m0-w,w0]])tw.face([q(x0,y0,h),q(x1,y1,h),q(x1,y1,hh),q(x0,y0,hh)],wc,cc);
  const o=.35,A=q(m0-w-o,w0-o,hh),B=q(m0+w+o,w0-o,hh),C=q(m0+w+o,w1+o,hh),D=q(m0-w-o,w1+o,hh),E=q(m0,w0-o,rh),F=q(m0,w1+o,rh);tw.face([A,E,F,D],rf,cc);tw.face([E,B,C,F],rf,cc);tw.face([A,B,E],wc,cc);tw.face([D,C,F],wc,cc);}
 else if(r<.72){const q=M((u0+u1)/2+rr(-.2,.2)*L,v0+d*rr(.3,.75)),x=q[0],z=q[1],st=rnd()<.6;tw.box(x,h+.3,z,1.5,.6,1.5,ry,'#85837a');tw.cone(x,h+.6,z,.72,h+2,.72,st?'#b9bcbd':'#688da6',10,true);}
 if(rnd()<.24){const q=M(u0+L*.25,v0+d*.2);tw.box(q[0],h+1.2,q[1],2.2,2.4,2.4,ry,'#b3b0a6');}}
const lowFac=[];
function street(M,len,row,low){let u=rr(0,5);const PXM=row?PX1:PX0;while(u<len){const lo=low(u);if(u>0&&rnd()<.24){u+=rr(3,7);continue;}const v0=rr(0,row?4.5:2);
 if(row&&rnd()<.5||!row&&rnd()<.1){const w=rr(12,row?20:15),fl=lo?pick([4,4,5]):row?pick([5,5,6,6,7,8,8,10]):5,f=facade(w,fl,fl>5?2:1,PXM);if(f){house(M,u,u+w,v0,rr(14,18),f,rr(.95,1.03),M.ry(u));u+=w+rr(0,1.6);continue;}}
 const n=rr(2,5.99)|0,w=rr(4.4,6.2),fl=lo?pick([2,3,3]):row?pick([3,4,4,5,5]):pick([2,3,3,4,4,5,6]),f=facade(w,fl,0,PXM)||pick(lowFac);if(f){lowFac.push(f);for(let i=0;i<n&&u<len;i++,u+=w)house(M,u,u+w,v0,rr(13,17),f,rr(.94,1.04),M.ry(u));}else u+=w;}}
{const arcM=(r0,a0)=>{const M=(u,v)=>{const a=a0+u/r0,r=r0+v;return[sin(a)*r,cos(a)*r];};M.ry=u=>a0+u/r0;return M;},AA=1.8,low=(r0,a0)=>u=>abs(a0+u/r0)<.3;
 street(arcM(83,-AA),2*AA*83,0,low(83,-AA));street(arcM(104,-AA-.08),2*(AA+.08)*104,1,low(104,-AA-.08));
 for(const s of[-1,1]){const M=(u,v)=>[s*(87+v),-24-u];M.ry=()=>0;street(M,190,0,()=>false);}}
const mTown=std({vertexColors:true,map:new T.CanvasTexture(atD),emissive:'#ffffff',emissiveMap:new T.CanvasTexture(atL),emissiveIntensity:0,roughness:.86});
mTown.map.colorSpace=mTown.emissiveMap.colorSpace=T.SRGBColorSpace;mTown.map.anisotropy=aniso;tw.uvf=null;scene.add(tw.mesh(mTown,false));

// ── 中遠景：幾圈畫出來的小鎮。第一圈還看得到窗，第二圈只剩樓層帶，再來只剩色塊，最後是霧裡的剪影。只圍到場站兩側，出庫線那頭留空
const far=new T.Mesh(new T.RingGeometry(GR-.4,2200,96,1),std({color:'#8c887d',roughness:1}));far.rotation.x=-PI/2;far.position.y=-.03;scene.add(far);
const yardTex=canvas2(512,512,(g,N)=>{g.fillStyle='#5e5850';g.fillRect(0,0,N,N);for(let i=0;i<150;i++){const x=rnd()*N,y=rnd()*N,r=rr(10,60),c=pick(['72,58,46','112,104,92','58,52,44','92,76,60','76,84,56']),a=rr(.14,.34);for(const dx of[-N,0,N])for(const dy of[-N,0,N])blot(g,x+dx,y+dy,r,c,a);}for(let i=0;i<9000;i++){const v=(rnd()*105+45)|0;g.fillStyle=`rgba(${v},${v-3},${v-11},.3)`;g.fillRect(rnd()*N,rnd()*N,1,1);}},{rep:true});yardTex.repeat.set(5,10);
const yardG=new T.Mesh(new T.PlaneGeometry(2*CW,350),std({map:yardTex,roughness:1}));yardG.rotation.x=-PI/2;yardG.position.set(0,-.015,-265);scene.add(yardG);
const mCity=[mTown],towns=[];
function ringTex(r,h,arc,W,H,soft,tall,lit){const c=mk(W,H),g=c.getContext('2d'),Lm=2*arc*r,sx=W/Lm,sy=H/h;g.scale(sx,sy);
 const block=(x,w,bh,col)=>{const y=h-bh;g.fillStyle=lit?'#161d29':col;g.fillRect(x,y,w,bh);if(lit){for(let f=y+1.2;f<h-1;f+=3.2)for(let k=x+.8;k<x+w-1;k+=3)if(rnd()<.26){g.fillStyle=`rgba(255,${190+rnd()*40|0},125,${rr(.5,1)})`;const q=1.1+soft*.5;g.fillRect(k,f,q*1.2,q);}return;}
  g.fillStyle='rgba(38,42,50,.2)';g.fillRect(x+w*.62,y,w*.38,bh);g.fillStyle='rgba(255,255,255,.28)';g.fillRect(x,y,w,.5);
  if(sy>1.3){g.fillStyle=`rgba(50,56,64,${sy>3?.34:.2})`;for(let f=y+1.4;f<h-.8;f+=3.2)g.fillRect(x+.5,f,w-1,.95);if(sy>3){g.fillStyle=col;for(let k=x+2.4;k<x+w-.6;k+=3.3)g.fillRect(k,y,.5,bh);}}
  if(rnd()<.5){g.fillStyle=rnd()<.6?'#c4c7c8':'#a9a79e';g.fillRect(x+w*rr(.15,.7),y-1.7,1.5,1.7);}};
 for(const[hi,lo,big]of[[.84,.42,1.5],[.54,.26,.7],[.34,.17,.2]])for(let x=-6;x<Lm;){const t=rnd()<tall*big,w=t?rr(15,26):rr(7,15);block(x,w,h*(t?rr(.74,1)*hi:rr(lo,hi*.72)),pick(TILE));x+=w+(rnd()<.24?rr(2,9):rr(0,1.2));}
 for(let x=0;x<Lm;x+=rr(3,12)){const s=rr(3,7.5);g.fillStyle=lit?'#0d1219':pick(TREE);g.beginPath();g.ellipse(x,h,s*1.3,s*rr(1.2,2),0,0,7);g.fill();}
 g.setTransform(1,0,0,1,0,0);soften(c,soft);g.globalCompositeOperation='destination-out';
 if(soft<3){const q=g.createLinearGradient(0,H,0,H*.9);q.addColorStop(0,'#000');q.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=q;g.fillRect(0,H*.9,W,H*.1);}
 for(const[x0,x1]of[[0,W*.03],[W,W*.97]]){const q=g.createLinearGradient(x0,0,x1,0);q.addColorStop(0,'#000');q.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=q;g.fillRect(min(x0,x1),0,W*.03,H);}
 g.globalCompositeOperation='source-over';return c;}
function leaves(r,h,arc,W,H,lit,gap){const c=mk(W,H),g=c.getContext('2d'),Lm=2*arc*r;g.scale(W/Lm,H/h);for(let x=0;x<Lm;){if(rnd()<gap){x+=rr(8,26);continue;}const R=rr(3,6.5),th=h*rr(.5,1),cx=x+R;for(let b=0,nb=rr(3,6)|0;b<nb;b++){const bx=cx+rr(-.7,.7)*R,by=h-th*rr(.45,.9),br=R*rr(.42,.72);for(let i=0;i<46;i++){const a=rnd()*7,q=sqrt(rnd()),px=bx+cos(a)*q*br,py=by+sin(a)*q*br*.8,k=clamp01(.5+(py-by)/br*.55+(px-bx)/br*.22+rr(-.2,.2));g.fillStyle=lit?'#0c1218':`rgb(${lerp(128,50,k)|0},${lerp(146,66,k)|0},${lerp(92,44,k)|0})`;g.beginPath();g.ellipse(px,py,rr(.5,1.15),rr(.35,.8),rnd()*3,0,7);g.fill();}}x+=R*rr(1.1,1.9);}return c;}
const hoop=(r,h,arc,day,lit,o)=>{const tex=c=>{const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=aniso;return t;},D=tex(day),N=tex(lit),m=new T.Mesh(new T.CylinderGeometry(r,r,h,128,1,true,-arc,2*arc),new T.MeshBasicMaterial({map:D,transparent:true,depthWrite:false,side:T.BackSide}));m.position.y=h/2-.05;m.renderOrder=o;m.userData={day:D,lit:N};scene.add(m);towns.push(m);};
hoop(101,14,1.86,leaves(101,14,1.86,2048,128,false,.34),leaves(101,14,1.86,1024,64,true,.34),-1);hoop(127,16,2.05,leaves(127,16,2.05,2048,128,false,.3),leaves(127,16,2.05,1024,64,true,.3),-2);
[[142,30,2.42,2048,128,0,.06],[205,38,2.7,2048,96,1.6,.1],[290,46,2.84,2048,72,2.4,.14],[420,58,3.24,phone?1024:2048,64,3,.18],[640,72,3.24,1024,48,3.2,.22]].forEach(([r,h,arc,W,H,soft,tall],i)=>hoop(r,h,arc,ringTex(r,h,arc,W,H,soft,tall,false),ringTex(r,h,arc,W,H,soft,tall,true),-5-i));


// 樹：葉片貼圖卡（不是球也不是塊），四種台灣街邊常見的外形
const leafTex=canvas2(1024,512,(g,w,h)=>{g.clearRect(0,0,w,h);
 for(let i=0;i<1500;i++){const a=rnd()*7,r=pow(rnd(),.62)*236,x=256+cos(a)*r,y=256+sin(a)*r*.94,v=(rr(.5,1)*255)|0;g.fillStyle=`rgb(${v},${v},${v})`;g.save();g.translate(x,y);g.rotate(rnd()*7);g.beginPath();g.ellipse(0,0,rr(8,15),rr(3.4,6.5),0,0,7);g.fill();g.restore();}
 g.strokeStyle='#d8d8d8';g.lineWidth=5;g.beginPath();g.moveTo(768,0);g.lineTo(768,h);g.stroke();
 for(let y=4;y<h;y+=7){const t=y/h,L=lerp(230,120,t)*(.8+.2*sin(y*.7));for(const s of[-1,1]){const v=(rr(.55,1)*255)|0;g.strokeStyle=`rgb(${v},${v},${v})`;g.lineWidth=rr(3,5);g.beginPath();g.moveTo(768,y);g.quadraticCurveTo(768+s*L*.5,y+6,768+s*L,y+rr(14,30));g.stroke();}}});
const leaf=new Bag(),bark=new Bag(),mLeaf=std({map:leafTex,vertexColors:true,alphaTest:.42,alphaToCoverage:true,side:T.DoubleSide,roughness:.72});
const nrm=v=>{const l=hypot(...v)||1;return v.map(k=>k/l);};
// 一張葉卡：c 中心、s 大小、n 是給光照用的法線（朝樹冠外），flat 讓卡片平躺
function card(c,s,n,cl,flat=0){const t=rnd()*7,e=lerp(rr(-1,1),1,flat),ax=nrm(flat>.6?[cos(t),rr(-.12,.12),sin(t)]:[cos(t),rr(-.5,.5),sin(t)]),az=nrm([ax[1]*e-ax[2]*.6,ax[2]*rr(-1,1)+ax[0]*.6+(flat>.6?0:.4),ax[0]*e-ax[1]]),b=flat>.6?nrm([-ax[2],rr(-.12,.12),ax[0]]):az,h=s/2,p=(i,j)=>[c[0]+ax[0]*h*i+b[0]*h*j,c[1]+ax[1]*h*i+b[1]*h*j,c[2]+ax[2]*h*i+b[2]*h*j];
 leaf.quad([p(-1,-1),p(1,-1),p(1,1),p(-1,1)],[[0,0],[.5,0],[.5,1],[0,1]],n,cl);}
function lobe(cx,cy,cz,rx,ry,n,hex,ctr,s){for(let i=0;i<n;i++){const u=rnd()*7,v=rr(-.75,1),q=sqrt(1-v*v),x=cx+cos(u)*q*rx,y=cy+v*ry,z=cz+sin(u)*q*rx,nn=nrm([x-ctr[0],(y-ctr[1])*1.5+1.2,z-ctr[2]]),k=lerp(.55,1.08,clamp01((nn[1]+.35)/1.2))*rr(.82,1.1);card([x,y,z],s*rr(.8,1.2),nn,shade(hex,k));}}
function trunk(x,z,h,r,c='#55463a'){bark.cone(x,0,z,r*1.3,h*.3,r,c,8,false);bark.cone(x,h*.3,z,r,h,r*.45,c,8,false);}
function broad(x,z,h,hex='#6f9e52'){trunk(x,z,h*.62,h*.042);const c=[x,h*.62,z],n=rr(5,7)|0;for(let i=0;i<n;i++){const a=i/n*7+rr(-.3,.3),d=rr(.16,.3)*h,ly=h*rr(.58,.74),lx=x+cos(a)*d,lz=z+sin(a)*d;bark.bar([x,h*.42,z],[lx,ly,lz],h*.028,'#55463a');lobe(lx,ly,lz,h*rr(.17,.24),h*rr(.11,.16),24,hex,c,h*.15);}lobe(x,h*.82,z,h*.22,h*.13,22,hex,c,h*.14);}
function parasol(x,z,h,hex='#8cb65e'){trunk(x,z,h*.96,h*.03,'#6a5c4d');const c=[x,h*.5,z];for(let t=0;t<5;t++){const y=h*(.42+t*.135),R=h*lerp(.42,.14,t/4),n=round(lerp(24,8,t/4));for(let b=0;b<5;b++){const a=b/5*7+t;bark.bar([x,y-.2,z],[x+cos(a)*R*.8,y,z+sin(a)*R*.8],h*.012,'#6a5c4d');}for(let i=0;i<n;i++){const a=rnd()*7,r=sqrt(rnd())*R,k=rr(.8,1.1)*lerp(.72,1.05,t/4);card([x+cos(a)*r,y+rr(-.1,.14),z+sin(a)*r],h*.17,nrm([cos(a)*.35,1,sin(a)*.35]),shade(hex,k),1);}}}
function frond(b,dir,L,droop,w,hex,k=1){const n=6;let pv=null;for(let i=0;i<=n;i++){const t=i/n,c=[b[0]+dir[0]*L*t,b[1]+dir[1]*L*t-droop*t*t,b[2]+dir[2]*L*t],sd=nrm([-dir[2],0,dir[0]]),ww=w*(t<.15?t/.15:1)*(1-t*.55),l=[c[0]-sd[0]*ww,c[1],c[2]-sd[2]*ww],r=[c[0]+sd[0]*ww,c[1],c[2]+sd[2]*ww];
  if(pv)leaf.quad([pv[0],pv[1],r,l],[[.5,1-(i-1)/n],[1,1-(i-1)/n],[1,1-t],[.5,1-t]],nrm([dir[0]*.4,1,dir[2]*.4]),shade(hex,k*lerp(1.05,.8,t)));pv=[l,r];}}
function palm(x,z,h){bark.cone(x,0,z,h*.05,h*.08,h*.038,'#8f8c84',10,false);bark.cone(x,h*.08,z,h*.038,h*.92,h*.03,'#9b988e',10,false);bark.cone(x,h*.88,z,h*.034,h*.97,h*.03,'#5e7a48',10,false);for(let i=0;i<15;i++){const a=i*2.4,e=rr(.05,.62),d=[cos(a)*cos(e),sin(e),sin(a)*cos(e)];frond([x,h*.96,z],d,h*.3,h*rr(.1,.2),h*.075,'#7aa257',rr(.85,1.1));}}
function norfolk(x,z,h){bark.cone(x,0,z,h*.03,h,h*.004,'#4d4036',8,false);for(let y=h*.2;y<h*.98;y+=h*.06){const t=(y-h*.2)/(h*.8),L=lerp(h*.27,h*.05,t),n=6,o=rnd()*7;for(let i=0;i<n;i++){const a=o+i/n*2*PI,d=nrm([cos(a),.08,sin(a)]);frond([x,y,z],d,L,L*.14,h*.034,'#4a7d5a',rr(.82,1.1));}}}
{for(let t=-2.72;t<=2.72;t+=.2){if(rnd()<.2)continue;const r=COMP+16.3+rr(-.3,.3),x=sin(t)*r,z=cos(t)*r;(rnd()<.55?parasol:broad)(x,z,rr(7.5,10.5));}
 for(const[x,z]of[[52,14],[-53,10],[-48,34],[48,36]])rnd()<.5?broad(x,z,rr(6.5,8.5),'#67944d'):parasol(x,z,rr(7,9));
 for(const[x,z,h]of[[60,-14,13],[61,-5,12],[-59,-10,13.5],[-60,-1,12.5],[-72,-46,12],[74,-44,13]])palm(x,z,h);
 for(const[x,z,h]of[[48,-8,15],[-56,-40,16],[77,-100,14]])norfolk(x,z,h);
 const lm=leaf.mesh(mLeaf),bm=bark.mesh(mConc);lm.receiveShadow=false;scene.add(lm,bm);}

// ── 轉車台 ───────────────────────────────────
const bridge=new T.Group();scene.add(bridge);
const plateTex=canvas2(2048,256,(g,w,h)=>{g.fillStyle='#6f7a82';g.fillRect(0,0,w,h);for(let i=0;i<170;i++)blot(g,rnd()*w,rnd()*h,rr(12,70),rnd()<.5?'46,52,58':'170,178,184',rr(.08,.2),rr(.6,2));
 for(let i=0;i<80;i++){const x=rnd()*w,y=rr(.1,.8)*h,L=rr(20,90),q=g.createLinearGradient(0,y,0,y+L);q.addColorStop(0,'rgba(120,64,34,.5)');q.addColorStop(1,'rgba(120,64,34,0)');g.fillStyle=q;g.fillRect(x,y,rr(1,4),L);}
 g.fillStyle='rgba(30,34,38,.65)';for(const y of[.12,.86])for(let x=4;x<w;x+=13){g.beginPath();g.arc(x,y*h,2.2,0,7);g.fill();}
 for(let x=64;x<w;x+=128){g.fillStyle='rgba(30,34,38,.28)';g.fillRect(x-2,0,4,h);g.fillStyle='rgba(30,34,38,.55)';for(let y=14;y<h;y+=17){g.beginPath();g.arc(x-8,y,1.9,0,7);g.arc(x+8,y,1.9,0,7);g.fill();}}
 const ch='禁止進入';for(const c0 of[.25,.66])for(let k=0;k<4;k++){const x=w*c0+k*100,y=h*.34;g.fillStyle='#f4f1e8';g.fillRect(x,y,64,64);g.fillStyle='#c0271f';g.font=`900 50px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(ch[k],x+32,y+35);}});
const pitTex=canvas2(1024,1024,(g,N)=>{g.fillStyle='#4a4238';g.fillRect(0,0,N,N);for(let i=0;i<420;i++)blot(g,rnd()*N,rnd()*N,rr(10,90),pick(['30,26,22','86,74,60','60,50,40']),rr(.14,.34));g.strokeStyle='rgba(28,24,20,.6)';g.lineWidth=52;g.beginPath();g.arc(N/2,N/2,N*.455,0,7);g.stroke();g.lineWidth=70;g.strokeStyle='rgba(28,24,20,.42)';g.beginPath();g.arc(N/2,N/2,N*.1,0,7);g.stroke();});
{const Lb=RP*2-.5,H=Lb/2,B=new Bag(),S=new Bag(),Pn=new Bag(),GX=2.02;
 B.box(0,-.2,0,3.86,.14,Lb,0,'#2c2f33');for(let z=-H+.3;z<H;z+=.62)B.box(0,.06,z,2.72,.12,.3,0,'#2a2520');
 B.box(0,.14,0,.96,.04,Lb-.4,0,'#7a7d7e');
 for(const s of[-1,1]){S.box(s,RAIL-.12,0,.13,.2,Lb,0,'#5a4638');S.box(s,RAIL-.025,0,.085,.05,Lb,0,'#9a9690');}
 const shp=new T.Shape();[[-H,-.34],[-H,.3],[-H*.46,1.56],[H*.46,1.56],[H,.3],[H,-.34],[H*.58,-.98],[-H*.58,-.98]].forEach(([x,y],i)=>i?shp.lineTo(x,y):shp.moveTo(x,y));shp.closePath();
 const mPl=std({map:plateTex,roughness:.62,metalness:.35});
 for(const s of[-1,1]){const eg=new T.ExtrudeGeometry(shp,{depth:.12,bevelEnabled:false}),p=eg.attributes.position,u=eg.attributes.uv;for(let i=0;i<p.count;i++)u.setXY(i,(p.getX(i)/Lb+.5)*(s>0?1:-1),(p.getY(i)+1.04)/2.7);const m=new T.Mesh(eg,mPl);m.rotation.y=PI/2;m.position.x=s*GX-.06;m.castShadow=m.receiveShadow=true;bridge.add(m);
  for(let z=-H+.9;z<H-.3;z+=1.42){const t=abs(z)/H,top=t<.46?1.56:lerp(1.56,.3,(t-.46)/.54);Pn.box(s*(GX+.12),(top-.5)/2,z,.1,top+.5,.12,0,'#59636a');}
  Pn.bar([s*(GX+.09),.3,-H],[s*(GX+.09),1.56,-H*.46],.12,'#59636a');Pn.bar([s*(GX+.09),1.56,-H*.46],[s*(GX+.09),1.56,H*.46],.12,'#59636a');Pn.bar([s*(GX+.09),1.56,H*.46],[s*(GX+.09),.3,H],.12,'#59636a');}
 for(let z=-H+1.3;z<H;z+=2.6)Pn.box(0,-.5,z,3.9,.3,.16,0,'#3a3f44');
 // 紅色門架：車從中間穿過
 const RED='#bb4a2d',leg=(s,z)=>{const a=[s*2.3,1.4,z],b=[s*.72,7.5,z];Pn.bar(a,b,.15,RED);return[a,b];};
 for(const s of[-1,1]){const[a,b]=leg(s,-.5),[c,d]=leg(s,.5),n=9;for(let k=0;k<n;k++){const u=k/n,v=(k+1)/n,p=(q,w,t)=>[lerp(q[0],w[0],t),lerp(q[1],w[1],t),lerp(q[2],w[2],t)];Pn.bar(p(a,b,u),p(c,d,v),.07,RED);Pn.bar(p(c,d,u),p(a,b,v),.07,RED);Pn.bar(p(a,b,u),p(c,d,u),.07,RED);}
  Pn.bar(a,[s*2.3,1.4,-1.6],.12,RED);Pn.bar(c,[s*2.3,1.4,1.6],.12,RED);}
 Pn.box(0,7.55,0,1.8,.2,1.2,0,RED);Pn.box(0,7.2,0,3.1,.14,.14,0,RED);Pn.box(0,6.1,-.5,3.6,.1,.1,0,RED);Pn.box(0,6.1,.5,3.6,.1,.1,0,RED);Pn.box(0,8,0,.16,.9,.16,0,'#3c3f42');
 // 操作室：灰殼、黑黃警戒底
 const cz=H-2.8;B.box(3.3,-.15,cz,2.6,.14,3.8,0,'#2c2f33');B.box(3.34,1.5,cz,2,2.9,2.8,0,'#a9aca8');B.box(3.34,3.02,cz,2.5,.14,3.3,0,'#5a5f62');
 const G=new Bag();G.box(3.34,1.95,cz-1.42,1.3,.9,.05,0,'#222');G.box(2.32,1.95,cz,.05,.9,1.8,0,'#222');
 for(const[x,z]of[[1.56,H-.6],[-1.56,H-.6],[1.56,-H+.6],[-1.56,-H+.6]])S.cone(x,-1.15,z,.3,-.6,.3,'#3a3b3d',10,true);
 bridge.add(B.mesh(mConc),Pn.mesh(mPaint),S.mesh(mSteel),G.mesh(mGlow,false));
 const pw=new T.Mesh(new T.CylinderGeometry(RP,RP,1.5,160,1,true),std({map:concTex,color:'#8f8a7e',roughness:.95,side:T.BackSide}));pw.position.y=-.75;pw.receiveShadow=true;scene.add(pw);
 const pf=new T.Mesh(new T.CircleGeometry(RP,128),std({map:pitTex,roughness:1}));pf.rotation.x=-PI/2;pf.position.y=-1.48;pf.receiveShadow=true;scene.add(pf);
 const curb=new T.Mesh(new T.RingGeometry(RP-.03,RP+.2,160),std({map:concTex,color:'#a6a092',roughness:.9}));curb.rotation.x=-PI/2;curb.position.y=.05;curb.receiveShadow=true;scene.add(curb);
 const ring=new T.Mesh(new T.TorusGeometry(RP-.9,.1,6,160),std({color:'#6b5040',metalness:.5,roughness:.55}));ring.rotation.x=-PI/2;ring.position.y=-1.38;scene.add(ring);
 const piv=new T.Mesh(new T.CylinderGeometry(1.1,1.4,1.1,28),std({map:concTex,color:'#80796a',roughness:.8}));piv.position.y=-.95;scene.add(piv);}

// ── 出庫號誌 ─────────────────────────────────
const mRed=new T.MeshStandardMaterial({color:'#401210',emissive:'#ff3a24',emissiveIntensity:3}),mGreen=new T.MeshStandardMaterial({color:'#0e2b1a',emissive:'#37e38a',emissiveIntensity:0});
{const x=3.9,z=-RP-9;paint.bar([x,0,z],[x,6.4,z],.2,'#3c3f42');paint.box(x,6.1,z,.74,1.7,.36,0,'#1e2023');paint.box(x,6.1,z-.26,1.5,2.4,.06,0,'#2a2c2e');
 const a=new T.Mesh(new T.SphereGeometry(.2,14,10),mRed),b=new T.Mesh(new T.SphereGeometry(.2,14,10),mGreen);a.position.set(x,6.48,z-.32);b.position.set(x,5.76,z-.32);scene.add(a,b);}

// ── 招牌、股道號牌、煙囪編號 ─────────────────
const numPlate=n=>canvas2(256,144,(g,w,h)=>{g.fillStyle='#2a4a73';g.fillRect(0,0,w,h);g.strokeStyle='#fffdf6';g.lineWidth=8;g.strokeRect(9,9,w-18,h-18);g.fillStyle='#fffdf6';g.font=`900 112px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(n,w/2,h/2+6);});
const mPlates=[];
for(let i=0;i<NS;i++){const a=phiOf(i),mat=std({map:numPlate(String(i+1)),emissive:'#fff',emissiveIntensity:0,roughness:.35});mat.emissiveMap=mat.map;mPlates.push(mat);
 const m=new T.Mesh(new T.PlaneGeometry(1.5,.84),mat),c=P(RD-.38,a,E0+.42);m.position.set(...c);m.rotation.y=a+PI;scene.add(m);
 const dt=canvas2(256,256,(g,w,h)=>{g.clearRect(0,0,w,h);g.fillStyle='#22221e';g.font=`900 200px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(String(i+1),w/2,h/2+10);});
 const cp=P(RD+3.5,a,0),dm=new T.Mesh(new T.CylinderGeometry(.665,.665,1.05,20,1,true,-.8,1.6),new T.MeshStandardMaterial({map:dt,transparent:true,roughness:.9,depthWrite:false}));dm.position.set(cp[0],E4+2.3,cp[2]);dm.rotation.y=a+PI;scene.add(dm);
 // 紅色牌子：停車標
 const q=P(RD-.1,a+HS*.72,0);paint.bar([q[0],0,q[2]],[q[0],1.3,q[2]],.06,'#b5271f');paint.box(q[0],1.34,q[2],.5,.3,.05,a,'#c8332a');}
{const t=canvas2(1024,176,(g,w,h)=>{g.fillStyle='#2a4a73';g.fillRect(0,0,w,h);g.strokeStyle='#fffdf6';g.lineWidth=7;g.strokeRect(12,12,w-24,h-24);g.fillStyle='#fffdf6';g.font=`900 104px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText('軌 島 機 務 段',w/2,h/2+6);});
 const mat=std({map:t,emissive:'#fff',emissiveIntensity:0,roughness:.4});mat.emissiveMap=t;mPlates.push(mat);const m=new T.Mesh(new T.PlaneGeometry(13,2.24),mat);m.position.set(0,E4+4.6,RD+16.42);m.rotation.y=PI;m.castShadow=true;scene.add(m);
 const bk=new T.Mesh(new T.PlaneGeometry(13,2.24),std({color:'#3c4347'}));bk.position.set(0,E4+4.6,RD+16.46);scene.add(bk);}
const pierSign=canvas2(64,240,(g,w,h)=>{g.fillStyle='#c62b25';g.fillRect(0,0,w,h);g.fillStyle='#fffdf6';g.font=`900 44px ${FONT}`;g.textAlign='center';g.textBaseline='middle';[...'注意行車'].forEach((c,k)=>g.fillText(c,w/2,34+k*58));});
{const mS=std({map:pierSign,roughness:.5}),gm=new T.PlaneGeometry(.34,1.28);for(let j=1;j<NS;j++){const a=phiOf(0)+HS-j*STEP,c=P(RD*RC-1,a,2.1),m=new T.Mesh(gm,mS);m.position.set(...c);m.rotation.y=a+PI;scene.add(m);}}

scene.add(wall.mesh(mConc),fac.mesh(mFac),roof.mesh(mRoof),paint.mesh(mPaint),steel.mesh(mSteel),glass.mesh(mGlass,false),dark.mesh(mDark),glow.mesh(mGlow,false));

// 鐵捲門（免費版）與空股、出勤中的立牌
const doorTex=canvas2(256,320,(g,w,h)=>{g.fillStyle='#6d7f75';g.fillRect(0,0,w,h);for(let y=0;y<h;y+=16){g.fillStyle='rgba(0,0,0,.2)';g.fillRect(0,y,w,2);g.fillStyle='rgba(255,255,255,.08)';g.fillRect(0,y+2,w,2);}for(let i=0;i<40;i++)blot(g,rnd()*w,rnd()*h,rr(8,40),'60,46,36',rr(.08,.2));});
const mDoor=std({map:doorTex,roughness:.65,metalness:.2}),doors=[];
const signTex=(txt,bg,fg)=>canvas2(320,144,(g,w,h)=>{g.fillStyle=bg;g.fillRect(0,0,w,h);g.strokeStyle=fg;g.lineWidth=8;g.strokeRect(6,6,w-12,h-12);g.fillStyle=fg;g.font=`900 68px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(txt,w/2,h/2+3);});
const mOut=std({map:signTex(label('出勤中'),'#e4e9f2','#3a5680'),roughness:.5}),mEmpty=std({map:signTex(label('空股'),'#fffdf6','#8a7c62'),roughness:.5}),signs=[];
for(let i=0;i<NS;i++){const a=phiOf(i),w=2*(hw-.42),d=new T.Mesh(new T.PlaneGeometry(w,E0),mDoor),c=P(RD-.1,a,E0/2);d.position.set(...c);d.rotation.y=a+PI;d.visible=false;d.castShadow=true;scene.add(d);doors.push(d);
 const s=new T.Mesh(new T.PlaneGeometry(3,1.35),mEmpty),p=P(RD-2.2,a,2.1);s.position.set(...p);s.rotation.y=a+PI;s.visible=false;scene.add(s);signs.push(s);
 const pst=new T.Mesh(new T.BoxGeometry(.14,1.5,.14),std({color:'#3f4347'}));pst.position.set(p[0],.75,p[2]);s.userData.post=pst;pst.visible=false;scene.add(pst);}

// 光斑（照車庫 D6：路面貼片，不開聚光燈）
const glowTex=canvas2(128,128,(g,w)=>{const r=g.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,255,255,.5)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,w,w);},{lin:true});
const add=(c,o=1)=>new T.MeshBasicMaterial({map:glowTex,color:c,transparent:true,opacity:o,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false,fog:false});
const poolMat=add('#ffc98a',0),doorGlow=add('#ffc98a',0),heads=[];
for(const[x,z,q]of[[-30,4,64],[30,4,64],[0,-34,70],[-34,-34,60],[36,-30,60]]){const m=new T.Mesh(new T.PlaneGeometry(q,q),poolMat);m.rotation.x=-PI/2;m.position.set(x,.16,z);scene.add(m);}
for(let i=0;i<NS;i++){const a=phiOf(i),m=new T.Mesh(new T.PlaneGeometry(10,10),doorGlow),c=P(RD-.6,a,3);m.position.set(...c);m.rotation.y=a+PI;scene.add(m);}
for(const[x,z]of POSTS){const m=new T.Mesh(new T.PlaneGeometry(52,52),poolMat);m.rotation.x=-PI/2;m.position.set(x,.14,z);scene.add(m);
 const s=new T.Sprite(new T.SpriteMaterial({map:glowTex,color:'#ffe2b8',transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false,fog:false}));s.position.set(x,18.9,z);s.scale.set(7,5,1);scene.add(s);heads.push(s);}

// ── 天空：漸層、雲、遠山、星 ─────────────────
const sky=new T.Mesh(new T.SphereGeometry(1900,48,24),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,fog:false,
 uniforms:{top:{value:new T.Color()},mid:{value:new T.Color()},hor:{value:new T.Color()},sunC:{value:new T.Color()},cl:{value:new T.Color()},cs:{value:new T.Color()},mt:{value:new T.Color()},sunD:{value:new T.Vector3(0,1,0)},cover:{value:.5},star:{value:0}},
 vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`varying vec3 vP;uniform vec3 top,mid,hor,sunC,cl,cs,mt,sunD;uniform float cover,star;
 float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
 float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
 float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}
 void main(){vec3 d=normalize(vP);float h=max(d.y,0.);vec3 c=mix(hor,mid,smoothstep(0.,.17,h));c=mix(c,top,smoothstep(.1,.8,h));
  float sd=max(dot(d,sunD),0.);c+=sunC*(pow(sd,220.)*1.8+pow(sd,14.)*.22);
  if(star>0.&&d.y>.03){vec3 q=d*170.,id=floor(q);float s=h21(id.xy+id.z*17.31);c+=vec3(.85,.9,1.)*step(.9965,s)*star*smoothstep(.03,.3,d.y)*smoothstep(.42,.08,length(fract(q)-.5))*(.35+.65*h21(id.zy+3.));}
  if(d.y>.006){vec2 uv=d.xz/(d.y+.14)*1.05+vec2(.3,1.7);float n=fbm(uv),n2=fbm(uv*2.4+vec2(n*1.5,6.));float den=smoothstep(cover,cover+.2,n*.74+n2*.34);float sh=smoothstep(.34,.82,fbm(uv+normalize(sunD.xz+.001)*.09));vec3 cc=mix(cl,cs,sh*.8);c=mix(c,cc,den*smoothstep(.006,.1,d.y)*.94);}
  float az=atan(d.x,d.z),r=.0135+.02*fbm(vec2(az*2.6,3.))+.006*fbm(vec2(az*11.,8.));float m=1.-smoothstep(r-.0015,r+.0015,d.y);c=mix(c,mix(hor,mt,.55),m);
  gl_FragColor=vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`}));
sky.renderOrder=-10;sky.frustumCulled=false;scene.add(sky);

return{towns,bridge,doors,signs,mOut,mEmpty,mPlates,mGlow,mGlass,mSky,mCity,poolMat,doorGlow,heads,glowTex,add,sky,mRed,mGreen,mConc};
}

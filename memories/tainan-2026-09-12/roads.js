// 臺南舊站周邊的馬路：柏油路面、標線、人行道。純 JS、不依賴 three.js：replay.js 把輸出包成網格，
// scripts/verify_tainan_memory.mjs 直接 import 這支，對封存快照重算規則並檢查幾何。
// 資料只用封存快照裡的 OSM 道路（主要、次要、三級道路）與它們的標籤，不另外下載。路寬、標線、人行道都是依標籤推的示意，不是實地測繪：
// - 路寬＝車道數×3.3 m＋兩側路肩各 0.6 m；沒標車道數的依道路等級（雙向 15／12／9 m，單行 10／9／7 m，其他 6 m）。
// - 標線：lane_markings=no 不畫。路寬 6 m 以上畫白色路面邊線；單行道車道之間白虛線；雙向道 4 車道以上（或沒標車道數的主要、次要道路）
//   中央雙黃實線，其餘雙向道黃虛線；4 車道以上同向車道之間白虛線。虛線畫 4 m、空 6 m。
// - 人行道：看 sidewalk、sidewalk:both、sidewalk:left、sidewalk:right（yes、separate 算有，no 算沒有），寬 2.5 m、比路面高 15 cm。
//   單行道多半是分隔道路的一側車道，行車方向左手邊是中央分隔島，所以左側只有明確標在左側才畫。
// - 路口與平交道：人行道與標線落在別條路的車道範圍內、或離軌道中心 2.2 m 內的地方斷開（人行道再多退 1.5 m 當轉角）。
//   跟自己夾角 25° 以內的路（同一條路切成兩段、分隔道路另一側的車道）不算穿越。
// - 地下道（tunnel=yes）整段不畫：路在軌道下面，畫在地面上會像平交道。
export const ROAD={
 laneM:3.3,shoulderM:.6,
 fallbackM:{twoWay:{primary:15,secondary:12,tertiary:9},oneWay:{primary:10,secondary:9,tertiary:7},other:6},
 sidewalkM:2.5,curbM:.15,
 lineM:.15,doubleLineM:.12,doubleGapM:.12,dashM:4,gapM:6,edgeInsetM:.4,edgeMinWidthM:6,
 sampleM:1,cornerM:1.5,markCornerM:1,parallelDeg:25,railClearM:2.2,minPieceM:{sidewalk:3,marking:.5},
 asphaltZ:.015,markingZ:.03,
 colors:{asphalt:'#74787c',sidewalk:'#c9c3b6',curb:'#a39f97',white:'#f2f2ec',yellow:'#e2b43c'}
};
export function roadWidth(t){const n=parseInt(t.lanes,10);if(n>0)return n*ROAD.laneM+2*ROAD.shoulderM;const f=t.oneway==='yes'?ROAD.fallbackM.oneWay:ROAD.fallbackM.twoWay;return f[t.highway]||ROAD.fallbackM.other;}
export function sidewalkSides(t){
 const has=v=>v==='yes'||v==='separate',s=t.sidewalk,b=t['sidewalk:both'],l=t['sidewalk:left'],r=t['sidewalk:right'];let left=false,right=false;
 if(s==='both'||s==='yes'||s==='separate')left=right=true;else if(s==='left')left=true;else if(s==='right')right=true;
 if(has(b))left=right=true;else if(b==='no')left=right=false;
 if(has(l))left=true;else if(l==='no')left=false;
 if(has(r))right=true;else if(r==='no')right=false;
 if(t.oneway==='yes')left=s==='left'||has(l);
 return {left,right};
}
// 每條線：offset＝離中心線的距離（左正右負），width＝線寬，dashed＝虛線。
export function markingLines(t,W){
 if(t.lane_markings==='no'||t.tunnel==='yes')return [];
 const r=[],n=parseInt(t.lanes,10)||0,L=ROAD.lineM;
 if(W>=ROAD.edgeMinWidthM)for(const s of [-1,1])r.push({offset:s*(W/2-ROAD.edgeInsetM),width:L,dashed:false,color:'white'});
 if(t.oneway==='yes'){for(let i=1;i<n;i++)r.push({offset:(i-n/2)*ROAD.laneM,width:L,dashed:true,color:'white'});}
 else if(n!==1){
  if(n>=4||(!n&&(t.highway==='primary'||t.highway==='secondary'))){const o=(ROAD.doubleGapM+ROAD.doubleLineM)/2;r.push({offset:-o,width:ROAD.doubleLineM,dashed:false,color:'yellow'},{offset:o,width:ROAD.doubleLineM,dashed:false,color:'yellow'});}
  else r.push({offset:0,width:ROAD.doubleLineM,dashed:true,color:'yellow'});
  for(let i=1;i<Math.floor(n/2);i++)for(const s of [-1,1])r.push({offset:s*i*ROAD.laneM,width:L,dashed:true,color:'white'});
 }
 return r;
}
function keep(len,cuts,min){const c=cuts.map(([a,b])=>[Math.max(0,a),Math.min(len,b)]).filter(([a,b])=>b>a).sort((x,y)=>x[0]-y[0]),r=[];let s=0;for(const [a,b] of c){if(a>s)r.push([s,a]);s=Math.max(s,b);}if(s<len)r.push([s,len]);return r.filter(([a,b])=>b-a>=min);}
function dashes(a,b){const P=ROAD.dashM+ROAD.gapM,r=[];for(let n=Math.floor(a/P);n*P<b;n++){const c=Math.max(a,n*P),e=Math.min(b,n*P+ROAD.dashM);if(e-c>.3)r.push([c,e]);}return r;}
export function buildRoads(features,world,rails=[]){
 const names=['asphalt','sidewalk','curb','white','yellow'],pos={},nor={};for(const n of names){pos[n]=[];nor[n]=[];}
 const tri=(layer,a,b,c)=>{const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;pos[layer].push(...a,...b,...c);nor[layer].push(nx,ny,nz,nx,ny,nz,nx,ny,nz);};
 const ways=[];
 for(const f of features){const t=f.tags;if(!t.highway)continue;const P=[];
  for(const c of f.coordinates){const p=world(c),q=P[P.length-1];if(!q||Math.hypot(p[0]-q[0],p[1]-q[1])>.01)P.push(p);}
  if(P.length<2)continue;
  const cum=[0],seg=[],dir=[];for(let i=1;i<P.length;i++){const dx=P[i][0]-P[i-1][0],dy=P[i][1]-P[i-1][1],l=Math.hypot(dx,dy);cum.push(cum[i-1]+l);seg.push([-dy/l,dx/l]);dir.push([dx/l,dy/l]);}
  // 轉折處用斜接（miter）：兩段法線的角平分線，長度放大到讓兩側平行線剛好接上；太尖的角限制在約 3 倍。
  const M=P.map((_,i)=>{const a=seg[Math.max(0,i-1)],b=seg[Math.min(seg.length-1,i)];let x=a[0]+b[0],y=a[1]+b[1];const l=Math.hypot(x,y);if(l<1e-6)return b;x/=l;y/=l;const c=Math.max(.34,x*b[0]+y*b[1]);return [x/c,y/c];});
  const W=roadWidth(t),tunnel=t.tunnel==='yes',sides=tunnel?{left:false,right:false}:sidewalkSides(t);
  ways.push({id:f.id,t,P,cum,seg,dir,M,W,tunnel,left:sides.left,right:sides.right,lines:markingLines(t,W)});}
 // 取樣用的格子索引（30 m）：不畫的地下道不算
 const CELL=30,grid=new Map(),railGrid=new Map(),cell=(x,y)=>Math.floor(x/CELL)+','+Math.floor(y/CELL);
 const put=(g,a,b,pad,item)=>{for(let i=Math.floor((Math.min(a[0],b[0])-pad)/CELL);i<=Math.floor((Math.max(a[0],b[0])+pad)/CELL);i++)for(let j=Math.floor((Math.min(a[1],b[1])-pad)/CELL);j<=Math.floor((Math.max(a[1],b[1])+pad)/CELL);j++){const k=i+','+j;if(!g.has(k))g.set(k,[]);g.get(k).push(item);}};
 ways.forEach((w,wi)=>{if(!w.tunnel)for(let k=0;k<w.P.length-1;k++)put(grid,w.P[k],w.P[k+1],w.W/2,[wi,k]);});
 for(const r of rails)for(let k=0;k<r.length-1;k++)put(railGrid,r[k],r[k+1],ROAD.railClearM,[r[k],r[k+1]]);
 const cosPar=Math.cos(ROAD.parallelDeg*Math.PI/180);
 const onOtherRoad=(x,y,self,d)=>{for(const [wi,k] of grid.get(cell(x,y))||[]){if(wi===self)continue;const w=ways[wi],a=w.P[k],e=w.dir[k],L=w.cum[k+1]-w.cum[k];if(Math.abs(e[0]*d[0]+e[1]*d[1])>cosPar)continue;const u=(x-a[0])*e[0]+(y-a[1])*e[1];if(u<0||u>L)continue;if(Math.abs((x-a[0])*e[1]-(y-a[1])*e[0])<w.W/2)return true;}return false;};
 const nearRail=(x,y)=>{for(const [a,b] of railGrid.get(cell(x,y))||[]){const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy,u=L2?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/L2)):0;if(Math.hypot(x-a[0]-dx*u,y-a[1]-dy*u)<ROAD.railClearM)return true;}return false;};
 const blocked=(x,y,self,d)=>onOtherRoad(x,y,self,d)||nearRail(x,y);
 const frame=(w,s)=>{let k=0;while(k<w.P.length-2&&w.cum[k+1]<s)k++;const L=w.cum[k+1]-w.cum[k],u=L?(s-w.cum[k])/L:0;return {p:[w.P[k][0]+(w.P[k+1][0]-w.P[k][0])*u,w.P[k][1]+(w.P[k+1][1]-w.P[k][1])*u],n:w.seg[k],d:w.dir[k]};};
 const piece=(w,s0,s1)=>{const a=frame(w,s0),b=frame(w,s1),r=[{p:a.p,m:a.n}];for(let i=0;i<w.P.length;i++)if(w.cum[i]>s0+1e-6&&w.cum[i]<s1-1e-6)r.push({p:w.P[i],m:w.M[i]});r.push({p:b.p,m:b.n});return r;};
 const at=(q,o,z)=>[q.p[0]+q.m[0]*o,q.p[1]+q.m[1]*o,z];
 const strip=(layer,pc,o0,o1,z)=>{for(let i=0;i<pc.length-1;i++){const a0=at(pc[i],o0,z),a1=at(pc[i],o1,z),b0=at(pc[i+1],o0,z),b1=at(pc[i+1],o1,z);tri(layer,a0,b0,b1);tri(layer,a0,b1,a1);}};
 // 路緣立面：faceLeft＝面朝行進方向左手邊（右側人行道的立面朝左、面向車道）。
 const curb=(pc,o,z0,z1,faceLeft)=>{for(let i=0;i<pc.length-1;i++){const a0=at(pc[i],o,z0),a1=at(pc[i],o,z1),b0=at(pc[i+1],o,z0),b1=at(pc[i+1],o,z1);if(faceLeft){tri('curb',a0,b1,b0);tri('curb',a0,a1,b1);}else{tri('curb',a0,b0,b1);tri('curb',a0,b1,a1);}}};
 // 斷開處的端面：起點面朝後、終點面朝前。
 const cap=(q,o0,o1,z0,z1,forward)=>{const a0=at(q,o0,z0),a1=at(q,o0,z1),b0=at(q,o1,z0),b1=at(q,o1,z1);if(forward){tri('curb',a0,b0,b1);tri('curb',a0,b1,a1);}else{tri('curb',b0,a0,a1);tri('curb',b0,a1,b1);}};
 const count=n=>pos[n].length/9,info=[];let sidewalkLeft=0,sidewalkRight=0,marked=0,tunnels=0;
 ways.forEach((w,wi)=>{const len=w.cum[w.cum.length-1],start=Object.fromEntries(names.map(n=>[n,count(n)]));
  if(w.tunnel){tunnels++;info.push({id:w.id,W:w.W,tunnel:true,left:false,right:false,lines:0,keep:{left:[],right:[],marking:[]},tri:Object.fromEntries(names.map(n=>[n,[start[n],0]]))});return;}
  const cutL=[],cutR=[],cutM=[],steps=Math.max(1,Math.ceil(len/ROAD.sampleM)),h=len/steps/2;
  for(let q=0;q<=steps;q++){const s=q*len/steps,{p,n,d}=frame(w,s),hit=o=>blocked(p[0]+n[0]*o,p[1]+n[1]*o,wi,d);
   for(const [on,sign,cut] of [[w.left,1,cutL],[w.right,-1,cutR]])if(on&&[w.W/2+.05,w.W/2+ROAD.sidewalkM/2,w.W/2+ROAD.sidewalkM-.05].some(o=>hit(sign*o)))cut.push([s-h-ROAD.cornerM,s+h+ROAD.cornerM]);
   if(w.lines.length&&[0,w.W/2-.2,-(w.W/2-.2)].some(hit))cutM.push([s-h-ROAD.markCornerM,s+h+ROAD.markCornerM]);}
  const keepL=w.left?keep(len,cutL,ROAD.minPieceM.sidewalk):[],keepR=w.right?keep(len,cutR,ROAD.minPieceM.sidewalk):[],keepM=w.lines.length?keep(len,cutM,ROAD.minPieceM.marking):[];
  strip('asphalt',piece(w,0,len),-w.W/2,w.W/2,ROAD.asphaltZ);
  const z0=ROAD.asphaltZ,z1=z0+ROAD.curbM;
  for(const [a,b] of keepL){const pc=piece(w,a,b),o0=w.W/2,o1=o0+ROAD.sidewalkM;strip('sidewalk',pc,o0,o1,z1);curb(pc,o0,z0,z1,false);cap(pc[0],o0,o1,z0,z1,false);cap(pc[pc.length-1],o0,o1,z0,z1,true);}
  for(const [a,b] of keepR){const pc=piece(w,a,b),o1=-w.W/2,o0=o1-ROAD.sidewalkM;strip('sidewalk',pc,o0,o1,z1);curb(pc,o1,z0,z1,true);cap(pc[0],o0,o1,z0,z1,false);cap(pc[pc.length-1],o0,o1,z0,z1,true);}
  for(const line of w.lines)for(const [a,b] of keepM)for(const [c,e] of line.dashed?dashes(a,b):[[a,b]])strip(line.color,piece(w,c,e),line.offset-line.width/2,line.offset+line.width/2,ROAD.markingZ);
  if(keepL.length)sidewalkLeft++;if(keepR.length)sidewalkRight++;if(keepM.length)marked++;
  info.push({id:w.id,W:w.W,tunnel:false,left:w.left,right:w.right,lines:w.lines.length,keep:{left:keepL,right:keepR,marking:keepM},tri:Object.fromEntries(names.map(n=>[n,[start[n],count(n)-start[n]]]))});});
 const layers=Object.fromEntries(names.map(n=>[n,{position:new Float32Array(pos[n]),normal:new Float32Array(nor[n])}]));
 return {layers,ways:info,stats:{ways:ways.length,tunnels,sidewalkLeft,sidewalkRight,marked,triangles:Object.fromEntries(names.map(n=>[n,count(n)]))}};
}

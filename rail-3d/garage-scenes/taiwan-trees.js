// 台灣常見樹種：微縮模型風的參數化低多邊形樹（平面著色、頂點色、不透明、無貼圖）。
// 每個樹種只抓一兩個一眼能認的特徵（小葉欖仁的層狀傘盤、筆筒樹的放射羽葉、林投的劍葉叢……），不求植物學精確。
//
// 用法（任何場景都一樣）：
//   const trees=createTaiwanTrees({geo,material});        // geo／material：場景登記要 dispose 的資源（例如 kit.geo、kit.ownMaterial），可省略
//   trees.plant('terminalia',x,y,z,h,{seed});             // z＝樹底地面高，h＝整棵高；seed 省略時由座標決定（同一個位置永遠長同一棵）
//   trees.plantMix(MIX.city,x,y,z,h,{seed});              // 依比例抽樹種，抽法也由座標（或 seed）決定；h 再乘上樹種的相對高 relH
//   trees.plant(...,{maxReach,maxPatch});                // 逐棵限制（可省略）：樹冠水平半徑上限（超過時 plant 只降高度；plantMix 先改試組合裡其他樹種，都放不下才取最窄的再降高）、樹下貼片半徑上限（伸出地面邊緣就不鋪）；兩者只收數字或省略，NaN、null、字串直接丟錯
//                                                         // 降到 75% 仍超過 maxReach 的樹照種，spots 的 fit.over 標 true、stats().over 計數；外框登記偏大，超過不一定穿插，要用實際幾何確認
//   const houses=trackHouses(props); houses.clearance(x,y) // 登記房子外框，回傳某點到最近房子的距離，給 maxReach 用
//   houses.outside(x,y,gap,within)                        // 樹心落在房子裡時外推；推不出去、或最後的點 within(x,y) 不成立（例如底座外；沒碰到房子的點也照樣檢查）回 null，呼叫端跳過這棵
//   trees.build(parent);                                  // 種完後呼叫一次：整批烘成一個合併幾何、一個材質、一個 Mesh
//   trees.dispose();                                      // 場景沒有代管資源時自己呼叫
// plant() 不吃場景的共用亂數；替換舊樹時，呼叫端要自己補吃舊做法消耗的亂數次數，後面東西的亂數序列才不會位移。
//
// 樹不會動，所以不用 InstancedMesh：每棵樹的三角形直接寫進同一個非索引 BufferGeometry，顏色走頂點色，整批 1 個 draw call。
// treeShape() 是純函數，回傳單棵樹在原點的幾何；build() 只是把它平移後串起來，驗收工具可以用它逐值重算、對帳。
import * as THREE from '../vendor/three.module.js';

const TAU=Math.PI*2,V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),UP=V(0,0,1);
const C=hex=>new THREE.Color(hex);

// 樹種表。budget＝每棵三角形上限（市區樹棵數少給 400，山林與海岸樹棵數多給 220）；relH＝plantMix 用的相對高度（林投、黃槿本來就矮）；
// patch:false＝不鋪樹下貼片（林投的預算常不夠鋪，有的鋪、有的沒鋪，同一片海岸看起來不一致，所以一律不鋪）。
export const SPECIES=Object.freeze([
 {id:'terminalia',name:'小葉欖仁',budget:400,relH:1.1},
 {id:'delonix',name:'鳳凰木',budget:400,relH:.95},
 {id:'koelreuteria',name:'台灣欒樹',budget:400,relH:1},
 {id:'ficus',name:'榕樹',budget:400,relH:1.05},
 {id:'acacia',name:'相思樹',budget:220,relH:1},
 {id:'trema',name:'山黃麻',budget:220,relH:1},
 {id:'cyathea',name:'筆筒樹',budget:220,relH:.85},
 {id:'macaranga',name:'血桐',budget:220,relH:.8},
 {id:'pandanus',name:'林投',budget:220,relH:.85,patch:false},
 {id:'hibiscus',name:'黃槿',budget:220,relH:.7}
].map(s=>Object.freeze(s)));
const BY_ID=new Map(SPECIES.map(s=>[s.id,s]));

// 各場景類型的預設比例。榕樹不進比例：它只該出現在廟口、公園、空地邊，由場景逐棵指定。
export const MIX=Object.freeze({
 city:Object.freeze([['terminalia',.45],['delonix',.30],['koelreuteria',.25]]),
 northForest:Object.freeze([['acacia',.45],['trema',.35],['cyathea',.20]]),
 eastCoast:Object.freeze([['macaranga',.60],['pandanus',.25],['acacia',.10],['hibiscus',.05]])
});

// mulberry32：小而決定性的亂數，種子是 32 位整數。座標雜湊沿用先前闊葉樹試作（已由本模組取代）的公式，同一個位置換新模組後種子不變。
function prng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function seedFromPosition(x,y){return(Math.imul(Math.round(x*100)|0,73856093)^Math.imul(Math.round(y*100)|0,19349663)^0x5bd1e995)>>>0;}
// 樹種名雜湊（FNV-1a）：同一個 seed 給不同樹種時，兩者的亂數序列互不相干。
const salt=id=>{let h=0x811c9dc5;for(const ch of id)h=Math.imul(h^ch.charCodeAt(0),0x01000193);return h>>>0;};
const SALT=new Map(SPECIES.map(s=>[s.id,salt(s.id)])),MIX_SALT=0x9e3779b9;

// ── 單位模板：頂點＋三角形。建好後把每個面翻成朝外（法線與面心同向），之後只做正比例縮放與旋轉，朝向不會反。
function orient(v,f){return f.map(([a,b,c])=>{const n=V().subVectors(v[b],v[a]).cross(V().subVectors(v[c],v[a])),m=V().add(v[a]).add(v[b]).add(v[c]);return n.dot(m)<0?[a,c,b]:[a,b,c];});}
// 經緯球：seg 等分、rings 層，奇數層錯開半格（輪廓較不像燈籠）。三角形數＝2·seg·(rings−1)。
function uvSphere(seg,rings){
 const v=[V(0,0,1)];
 for(let i=1;i<rings;i++){const t=Math.PI*i/rings;for(let j=0;j<seg;j++){const p=TAU*j/seg+(i%2)*Math.PI/seg;v.push(V(Math.sin(t)*Math.cos(p),Math.sin(t)*Math.sin(p),Math.cos(t)));}}
 v.push(V(0,0,-1));
 const f=[],R=i=>1+(i-1)*seg,bot=v.length-1;
 for(let j=0;j<seg;j++)f.push([0,R(1)+j,R(1)+(j+1)%seg]);
 for(let i=1;i<rings-1;i++)for(let j=0;j<seg;j++){const a=R(i)+j,b=R(i)+(j+1)%seg,c=R(i+1)+j,d=R(i+1)+(j+1)%seg;f.push([a,c,d],[a,d,b]);}
 for(let j=0;j<seg;j++)f.push([bot,R(rings-1)+(j+1)%seg,R(rings-1)+j]);
 return{v,f:orient(v,f)};
}
// 正二十面體（20 tri）：最省的「一團葉」。
function icosa(){
 const t=(1+Math.sqrt(5))/2,v=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(p=>V(...p).normalize());
 const f=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 return{v,f:orient(v,f)};
}
// 扁透鏡：一圈 n 點＋上下各一個尖，上尖高 .6、下尖低 .4（盤面上凸下平），三角形數 2n。給小葉欖仁的層盤。
function lens(n){const v=[V(0,0,.6),V(0,0,-.4)];for(let j=0;j<n;j++)v.push(V(Math.cos(TAU*j/n),Math.sin(TAU*j/n),0));const f=[];for(let j=0;j<n;j++){const a=2+j,b=2+(j+1)%n;f.push([0,a,b],[1,b,a]);}return{v,f:orient(v,f)};}
// 正四面體（4 tri）：花朵小塊。
function tetra(){const v=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(p=>V(...p).normalize());return{v,f:orient(v,[[0,1,2],[0,1,3],[0,2,3],[1,2,3]])};}
const T={ico:icosa(),s6x5:uvSphere(6,5),s6x4:uvSphere(6,4),s5x4:uvSphere(5,4),lens10:lens(10),lens8:lens(8),lens5:lens(5),tetra:tetra()};

// ── 組裝器：所有零件都寫成三角形＋每面一色（平面著色，三個頂點同色）。
// 每個三角形另記兩件事：是不是樹冠（solid／sheet 算冠；wood 與直接呼叫 tri 的算木頭），以及屬於哪一團冠（group，林投一根幹一團）。
// 只有 gradient／volume 著色會讀這兩個陣列；flat 著色完全不碰，輸出與加這兩個陣列之前逐值相同。
function builder(r){
 const P=[],K=[],KIND=[],GROUP=[];let tris=0,kind=0,group=0,base=null,rnd=r,patchR=0;
 const tri=(a,b,c,col)=>{P.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);for(let i=0;i<3;i++)K.push(col.r,col.g,col.b);KIND.push(kind);GROUP.push(group);tris++;};
 // 每面亮度小抖動：低多邊形的面與面之間有一點明暗差，看起來才像一片片切出來的。
 // 抖動是加在 HSL 亮度上的定值，很暗的底色（筆筒樹的莖）減下去會變負、被夾成純黑，所以用 dim() 限制最多只降到底色亮度的 DIM_MIN 倍。
 const facet=(base,amt)=>dim(base.clone(),(rnd()-.5)*amt);
 // 封閉體：模板頂點先做徑向抖動（共用頂點只抖一次，不會裂縫），再縮放、旋轉、平移。
 // color(cz,i)：cz 是該面在模板空間的面心高度（−1 底～+1 頂），用來做上亮下暗、或只把上半面換成花色。回傳實際的世界頂點，給花朵、大葉找掛點。
 function solid(tm,{pos,scale,yaw=0,tilt=[0,0],jit=0,color,facetAmt=.05}){
  const M=new THREE.Matrix4().compose(pos,new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0],tilt[1],yaw,'ZYX')),V(...scale));
  const loc=tm.v.map(p=>p.clone().multiplyScalar(1+(r()-.5)*2*jit)),w=loc.map(p=>p.clone().applyMatrix4(M));
  kind=1;tm.f.forEach(([a,b,c],i)=>tri(w[a],w[b],w[c],facet(color((loc[a].z+loc[b].z+loc[c].z)/3,i),facetAmt)));kind=0;
  return w;
 }
 // 木頭：n 角錐台，from→to，底不封（埋進地裡或枝根），頂預設封。三角形數 2n＋(n−2)。
 // cap 傳顏色時用那個顏色封頂、不抽亂數（後面零件的亂數序列不變）。
 function wood(from,to,r0,r1,n,col,cap=true){
  if(!base&&from.lengthSq()<1e-12)base={to:to.clone(),r0,col}; // 第一根從原點長出的木頭就是主幹：著地時幹基外擴用它的方向、粗細、顏色
  const d=V().subVectors(to,from).normalize(),u=V().crossVectors(d,Math.abs(d.z)<.9?UP:V(1,0,0)).normalize(),v=V().crossVectors(d,u),ph=rnd()*TAU;
  const ring=(c,rad)=>Array.from({length:n},(_,j)=>{const a=ph+TAU*j/n;return c.clone().addScaledVector(u,Math.cos(a)*rad).addScaledVector(v,Math.sin(a)*rad);});
  const A=ring(from,r0),B=ring(to,r1);
  for(let j=0;j<n;j++){const k=(j+1)%n,c=facet(col,.06);tri(A[j],A[k],B[k],c);tri(A[j],B[k],B[j],c);}
  if(cap)for(let j=1;j<n-1;j++)tri(B[0],B[j],B[j+1],cap.isColor?cap:facet(col,.04));
 }
 // 晚點才長的木頭：現在先照 wood() 的用量把亂數抽好（後面零件的亂數序列不變），等樹冠長好、知道枝端該伸到哪裡，再用同一組亂數長出來。
 function woodLater(from,to,r0,r1,n,col,cap=true){
  const tape=Array.from({length:1+n+(cap&&!cap.isColor?n-2:0)},()=>r());
  return(to2=to,cap2=cap)=>{let k=0;rnd=()=>tape[k++];wood(from,to2,r0,r1,n,col,cap2);rnd=r;}; // cap2=false：頂端埋進冠裡看不到時不封頂（亂數照樣先抽好）
 }
 // ── 接觸：讓零件確實碰到撐住它的東西（枝、葉盤、冠團）。三角形寫進 P 之後才量、只做平移，不抽亂數。零件用三角形區間 [t0,t1) 表示，closed＝封閉體（可判斷點在不在裡面）。
 const mark=()=>tris;
 function move([t0,t1],x,y,z){for(let i=t0*9;i<t1*9;i+=3){P[i]+=x;P[i+1]+=y;P[i+2]+=z;}}
 // 射線 o＋s·d 打到第 t 個三角形時的 s（打不到回 -1）。Möller–Trumbore。
 function hit(t,ox,oy,oz,dx,dy,dz){const i=t*9,ax=P[i],ay=P[i+1],az=P[i+2],e1x=P[i+3]-ax,e1y=P[i+4]-ay,e1z=P[i+5]-az,e2x=P[i+6]-ax,e2y=P[i+7]-ay,e2z=P[i+8]-az;
  const hx=dy*e2z-dz*e2y,hy=dz*e2x-dx*e2z,hz=dx*e2y-dy*e2x,det=e1x*hx+e1y*hy+e1z*hz;if(Math.abs(det)<1e-14)return -1;
  const f=1/det,sx=ox-ax,sy=oy-ay,sz=oz-az,u=f*(sx*hx+sy*hy+sz*hz);if(u<0||u>1)return -1;
  const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,w=f*(dx*qx+dy*qy+dz*qz);if(w<0||u+w>1)return -1;
  return f*(e2x*qx+e2y*qy+e2z*qz);}
 function box([t0,t1]){const b=[1e9,1e9,1e9,-1e9,-1e9,-1e9];for(let i=t0*9;i<t1*9;i+=3)for(let d=0;d<3;d++){b[d]=Math.min(b[d],P[i+d]);b[d+3]=Math.max(b[d+3],P[i+d]);}return b;}
 // a 碰到 b：a 的邊穿過 b 的面、a 的頂點離 b 的某一面（沿該面法線量）不到 tol，或 a 的一個頂點在封閉體 b 裡面（往略斜的上方打射線，穿過奇數次＝在裡面）。
 // 疊成魚鱗的薄葉片彼此不相交、只隔一點點，要靠 tol 才算碰到。
 // 省時：兩個測試成立時，邊（或它的起點往外 tol 內）一定和那一面的包圍框相交，所以先比包圍框（多留 1e-9），不相交的不打射線；結果不變。
 function cuts(a,b,tol){
  const nb=b[1]-b[0],bb=new Float64Array(nb*6),m=tol+1e-9;
  for(let u=0;u<nb;u++){const o=(b[0]+u)*9;for(let d=0;d<3;d++){bb[u*6+d]=Math.min(P[o+d],P[o+3+d],P[o+6+d]);bb[u*6+3+d]=Math.max(P[o+d],P[o+3+d],P[o+6+d]);}}
  for(let t=a[0];t<a[1];t++)for(let k=0;k<3;k++){const i=t*9+k*3,j=t*9+(k+1)%3*3,dx=P[j]-P[i],dy=P[j+1]-P[i+1],dz=P[j+2]-P[i+2];
   const x0=Math.min(P[i],P[j])-m,x1=Math.max(P[i],P[j])+m,y0=Math.min(P[i+1],P[j+1])-m,y1=Math.max(P[i+1],P[j+1])+m,z0=Math.min(P[i+2],P[j+2])-m,z1=Math.max(P[i+2],P[j+2])+m;
   for(let u=b[0];u<b[1];u++){const g=(u-b[0])*6;if(bb[g]>x1||bb[g+3]<x0||bb[g+1]>y1||bb[g+4]<y0||bb[g+2]>z1||bb[g+5]<z0)continue;
    const s=hit(u,P[i],P[i+1],P[i+2],dx,dy,dz);if(s>=0&&s<=1)return true;
    const o=u*9,e1x=P[o+3]-P[o],e1y=P[o+4]-P[o+1],e1z=P[o+5]-P[o+2],e2x=P[o+6]-P[o],e2y=P[o+7]-P[o+1],e2z=P[o+8]-P[o+2];
    let nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;const l=Math.hypot(nx,ny,nz);if(l<1e-14)continue;nx/=l;ny/=l;nz/=l;
    const q=hit(u,P[i],P[i+1],P[i+2],nx,ny,nz);if(q!==-1&&Math.abs(q)<tol)return true;}}
  if(b[2]){const i=a[0]*9;let n=0;for(let u=b[0];u<b[1];u++)if(hit(u,P[i],P[i+1],P[i+2],.0123,.0071,1)>0)n++;if(n%2)return true;}
  return false;}
 function touching(a,targets,tol){const A=box(a);
  return targets.some(b=>{const Bb=box(b);for(let d=0;d<3;d++)if(A[d]>Bb[d+3]+tol||Bb[d]>A[d+3]+tol)return false;return cuts(a,b,tol)||cuts(b,a,tol);});}
 // 零件 a 沒碰到任何 targets 時，沿 dir（單位向量）平移到剛好碰到再多埋 embed；回傳移動量（已經碰到回 0，沿 dir 碰不到回 -1、不動）。
 function attach(a,targets,dir,embed){
  if(touching(a,targets,embed/2))return 0;
  const s=reach(a,targets,dir),[dx,dy,dz]=[dir.x,dir.y,dir.z];
  if(s===Infinity)return -1;
  move(a,dx*(s+embed),dy*(s+embed),dz*(s+embed));return s+embed;}
 // 零件 a 沿 dir 平移多遠會碰到 targets（a 的頂點往 dir 打、targets 的頂點往反方向打，取最近；碰不到回 Infinity）。
 // 省時：沿 dir 的射線打中一面時，起點投影到垂直 dir 的平面上一定落在那一面投影的包圍框裡（多留 1e-9），不在的不打；取最小值與順序無關，結果不變。
 function reach(a,targets,dir){
  let s=Infinity;const [dx,dy,dz]=[dir.x,dir.y,dir.z],e=1e-9;
  const pu=V().crossVectors(dir,Math.abs(dz)<.9?UP:V(1,0,0)).normalize(),pw=V().crossVectors(dir,pu);
  const px=i=>P[i]*pu.x+P[i+1]*pu.y+P[i+2]*pu.z,py=i=>P[i]*pw.x+P[i+1]*pw.y+P[i+2]*pw.z;
  const flat=([t0,t1])=>{const r=new Float64Array((t1-t0)*4);for(let t=t0;t<t1;t++){const g=(t-t0)*4;r[g]=r[g+1]=Infinity;r[g+2]=r[g+3]=-Infinity;
   for(let k=0;k<3;k++){const i=t*9+k*3,x=px(i),y=py(i);r[g]=Math.min(r[g],x);r[g+1]=Math.min(r[g+1],y);r[g+2]=Math.max(r[g+2],x);r[g+3]=Math.max(r[g+3],y);}}return r;};
  const fa=flat(a);
  for(const b of targets){const fb=flat(b);
   for(let i=a[0]*9;i<a[1]*9;i+=3){const x=px(i),y=py(i);for(let u=b[0];u<b[1];u++){const g=(u-b[0])*4;if(x<fb[g]-e||y<fb[g+1]-e||x>fb[g+2]+e||y>fb[g+3]+e)continue;const h=hit(u,P[i],P[i+1],P[i+2],dx,dy,dz);if(h>0&&h<s)s=h;}}
   for(let i=b[0]*9;i<b[1]*9;i+=3){const x=px(i),y=py(i);for(let t=a[0];t<a[1];t++){const g=(t-a[0])*4;if(x<fa[g]-e||y<fa[g+1]-e||x>fa[g+2]+e||y>fa[g+3]+e)continue;const h=hit(t,P[i],P[i+1],P[i+2],-dx,-dy,-dz);if(h>0&&h<s)s=h;}}}
  return s;}
 // 一組薄片（parts：{part,dir}）接到 held 上，盡量不動：碰到 held 或碰到已經接上的薄片就不動；都沒碰到時挑離撐住物最近的那片，
 // 距離不超過 pmax 就沿 dir 平移到碰到再埋 embed，超過就不動、留給呼叫端加葉柄（加了葉柄就算接上）。回傳要加葉柄的那幾片。
 // 省時：零件加進 held 之後不再移動、還沒挑到的薄片也不動，所以「碰到沒」與「多遠碰到」只在 held 多一個零件時對那一個補算（或、取小），
 // 結果和每輪對整組 held 重算相同；「碰到沒」也只在輪到那一片時才補算（c＝已經比過 held 的前幾個）。
 // 兩零件投影到垂直 dir 的平面上包圍框不重疊時，沿 dir 平移一定碰不到，不打射線。
 function hold(parts,held,embed,pmax){
  const flat=(a,u,w,m)=>{for(let i=a[0]*9;i<a[1]*9;i+=3){const x=P[i]*u.x+P[i+1]*u.y+P[i+2]*u.z,y=P[i]*w.x+P[i+1]*w.y+P[i+2]*w.z;m[0]=Math.min(m[0],x);m[1]=Math.min(m[1],y);m[2]=Math.max(m[2],x);m[3]=Math.max(m[3],y);}return m;};
  const rest=parts.map(p=>{const u=V().crossVectors(p.dir,Math.abs(p.dir.z)<.9?UP:V(1,0,0)).normalize(),w=V().crossVectors(p.dir,u);
   return{...p,u,w,f:flat(p.part,u,w,[1e9,1e9,-1e9,-1e9]),t:false,c:0,s:null};}),out=[];
  const near=(p,bs)=>{let s=Infinity;for(const b of bs){const q=flat(b,p.u,p.w,[1e9,1e9,-1e9,-1e9]),f=p.f,e=1e-6;
   if(f[0]>q[2]+e||q[0]>f[2]+e||f[1]>q[3]+e||q[1]>f[3]+e)continue;const d=reach(p.part,[b],p.dir);if(d<s)s=d;}return s;};
  const touch=p=>{if(!p.t&&p.c<held.length){p.t=touching(p.part,held.slice(p.c),embed/2);p.c=held.length;}return p.t;};
  while(rest.length){let k=rest.findIndex(touch);
   if(k<0){let s=Infinity;rest.forEach((p,i)=>{if(p.s===null)p.s=near(p,held);if(p.s<s){s=p.s;k=i;}});
    if(k<0){out.push(...rest);break;}
    const p=rest[k];if(s<=pmax)move(p.part,p.dir.x*(s+embed),p.dir.y*(s+embed),p.dir.z*(s+embed));else out.push(p);}
   const b=rest[k].part;held.push(b);rest.splice(k,1);
   for(const p of rest)if(p.s!==null)p.s=Math.min(p.s,near(p,[b]));}
  return out;}
 // 一組零件接到 held（已經撐住的零件）上：經由彼此或 held 已經連上的不動；整團都連不上的，依序沿各自的方向（dirs，一個碰不到換下一個）
 // 平移到碰到撐住的零件，再看還有誰因此連上。只移動真的浮著的零件，接上的對象一定已經撐住（不會兩塊浮著的互相黏成一團）。
 function connect(parts,held,embed){
  const rest=parts.map(p=>({...p,seen:0}));
  while(rest.length){let k=-1;
   for(let i=0;i<rest.length&&k<0;i++){const p=rest[i];if(touching(p.part,held.slice(p.seen),embed/2))k=i;p.seen=held.length;}
   if(k<0){k=0;if(!rest[0].dirs.some(d=>attach(rest[0].part,held,d,embed)>=0)){rest.shift();continue;}} // 每個方向都碰不到的不算撐住，別的零件不能接到它上面
   held.push(rest[k].part);rest.splice(k,1);}
 }
 // 射線 o＋s·d 打到 parts 裡最近的那一面的 s（打不到回 Infinity）。
 function cast(parts,o,d){let s=Infinity;for(const a of parts)for(let t=a[0];t<a[1];t++){const h=hit(t,o.x,o.y,o.z,d.x,d.y,d.z);if(h>0&&h<s)s=h;}return s;}
 // (x,y) 往上打垂直線穿過區間 a 的各個高度（由低到高）。
 function above(a,x,y){const zs=[];for(let t=a[0];t<a[1];t++){const s=hit(t,x,y,-1e3,0,0,1);if(s>=0)zs.push(s-1e3);}return zs.sort((p,q)=>p-q);}
 // 給氣生根頂、枝端找冠的實際底面：solids 是各團冠（封閉體）的區間。水平位置 c、半徑 rad 的一圈（中心＋外圍 8 點）往上打垂直線，
 // 各團冠的進出點合成「最低那一段實心」，取整圈冠底最高的一點再往上埋 depth，整圈都在冠裡。冠沒罩到那裡、或那裡的冠薄到埋進去會穿出去，回 null。
 // deep：抖動大的冠團底下偶爾垂著一片薄皮，最低那段只是薄皮、整圈怎麼收都卡在那裡。這時改看九條線實心段的交集，取最低一段厚過 2·depth 的。
 function seat(solids,c,rad,depth,deep=false){let lo=-1e9,hi=1e9,S=null;const bx=solids.map(box);
  for(let k=-1;k<8;k++){const x=c.x+(k<0?0:Math.cos(k*TAU/8)*rad),y=c.y+(k<0?0:Math.sin(k*TAU/8)*rad),iv=[],U=[];
   solids.forEach((a,i)=>{const b=bx[i];if(x<b[0]||x>b[3]||y<b[1]||y>b[4])return;const zs=above(a,x,y);for(let j=0;j+1<zs.length;j+=2)iv.push([zs[j],zs[j+1]]);}); // 包圍盒外的冠團打不到，跳過
   if(!iv.length)return null;iv.sort((p,q)=>p[0]-q[0]);for(const [p,q] of iv){const L=U[U.length-1];if(L&&p<=L[1])L[1]=Math.max(L[1],q);else U.push([p,q]);}
   lo=Math.max(lo,U[0][0]);hi=Math.min(hi,U[0][1]);
   if(!S){S=U;continue;}const N=[];for(const [p,q] of S)for(const [u,v] of U){const l=Math.max(p,u),h=Math.min(q,v);if(h>l)N.push([l,h]);}S=N.sort((p,q)=>p[0]-q[0]);}
  if(hi-lo>depth*2)return lo+depth;if(!deep)return null;
  const g=S.find(([l,h])=>h-l>depth*2);return g?g[0]+depth:null;}
 // 薄片（羽葉、劍葉、大圓葉、枯葉柄）：每面正反兩片，反面沿法線往後退 thick。
 // 不透明材質只畫正面，所以兩面都要有自己的三角形；陰影 pass 畫背光的那一片，退開的厚度讓受光面不會被自己遮出 shadow acne。
 // 傳入的面一律先翻成法線朝上（或朝 hint 方向），正反兩面的顏色才分得開（正面亮、背面暗一點）。
 function sheet(pts,faces,thick,col,hint=UP,backDark=-.06){
  kind=1;
  for(const [i,j,k] of faces){let a=pts[i],b=pts[j],c=pts[k];let n=V().subVectors(b,a).cross(V().subVectors(c,a));if(n.dot(hint)<0){[b,c]=[c,b];n.negate();}n.normalize();
   const f=facet(col,.05);tri(a,b,c,f);
   const o=n.multiplyScalar(-thick);tri(a.clone().add(o),c.clone().add(o),b.clone().add(o),dim(f.clone(),backDark));}
  kind=0;
 }
 // 葉柄：一個細長三角形（a、b 在葉背上，c 伸進撐住它的冠團），算冠面（體積著色、冠色下限照冠的規則）。
 function stalk(a,b,c,col){kind=1;tri(a,b,c,col);kind=0;}
 // shade：{mode,seed,H,budget,ground}。mode 是 flat 時什麼都不改，直接照舊輸出。
 function finish(meta,shade={mode:'flat'}){
  const crowns=shade.mode==='flat'?null:shadeCrowns(shade);
  const position=new Float32Array(P),color=new Float32Array(K),normal=new Float32Array(P.length);
  const a=V(),b=V(),c=V(),n=V();
  for(let i=0;i<P.length;i+=9){a.fromArray(position,i);b.fromArray(position,i+3);c.fromArray(position,i+6);n.subVectors(b,a).cross(c.sub(a)).normalize();for(let k=0;k<3;k++)n.toArray(normal,i+k*3);}
  if(shade.mode==='volume')volumeNormals(position,normal,crowns);
  let reach=0,top=0;for(let i=0;i<P.length;i+=3){reach=Math.max(reach,Math.hypot(P[i],P[i+1]));top=Math.max(top,P[i+2]);}
  return{...meta,...(shade.mode==='flat'?{}:{shading:shade.mode}),tris,position,normal,color,bounds:{reach,top,patch:patchR}};
 }
 // gradient／volume 共用：量每團冠的包圍盒、把冠的頂點色調成假 AO＋每棵的色偏，再補幹基外擴與樹下貼片。回傳各團冠的中心與半軸。
 // 這裡用的亂數另外由 seed 起一條，不吃樹形的 r()：樹形與 flat 版逐值相同，只多出顏色與幾個面。
 function shadeCrowns({seed,H,budget,ground,patch=true,crownMin=CROWN_MIN}){
  const box=new Map();
  for(let t=0;t<tris;t++){if(!KIND[t])continue;const g=GROUP[t],b=box.get(g)??(box.set(g,[1e9,1e9,1e9,-1e9,-1e9,-1e9]),box.get(g));
   for(let k=0;k<3;k++){const i=t*9+k*3;for(let d=0;d<3;d++){b[d]=Math.min(b[d],P[i+d]);b[d+3]=Math.max(b[d+3],P[i+d]);}}}
  const crowns=new Map();for(const [g,b] of box)crowns.set(g,{c:[(b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2],ax:[Math.max((b[3]-b[0])/2,1e-4),Math.max((b[4]-b[1])/2,1e-4),Math.max((b[5]-b[2])/2,1e-4)],z0:b[2],z1:b[5]});
  // 先收斂葉面的逐面明暗：各樹種的「下半面壓暗」與每面亮度抖動是在線性色的 HSL 上做的，深綠葉的底面會掉到近黑（亮度只剩中位數的千分之幾）、面與面差到兩三成。
  // 綠色葉面的亮度往該團冠的中位數收：亮度比先墊到 FLOOR 以上，再取 GAMMA 次方。亮度比本來就夠的面照原色等比例調；
  // 掉到 FLOOR 以下的面已經沒有可靠的色相（被夾成近黑），改用中位數那一面的顏色。明暗改由下面的假 AO 依位置連續給；花、幼葉、枯葉這些非綠色面不收。
  // 夾到全黑或近黑灰的葉面已經不帶綠色，只靠綠色判斷會漏掉它們（榕樹、血桐的冠底都有）：亮度在中位數 FLOOR 倍以下、又不偏紅不偏藍的冠面也照葉面收。
  const Y=t=>{const i=t*9;return .2126*K[i]+.7152*K[i+1]+.0722*K[i+2];},leafy=t=>{const i=t*9;return K[i+1]>K[i]*1.05&&K[i+1]>K[i+2]*1.05;},
   hueless=t=>{const i=t*9;return K[i]<=K[i+1]*1.05+1e-4&&K[i+2]<=K[i+1]*1.05+1e-4;};
  const ys=new Map();for(let t=0;t<tris;t++)if(KIND[t]===1&&leafy(t)){const a=ys.get(GROUP[t]);if(a)a.push([Y(t),t]);else ys.set(GROUP[t],[[Y(t),t]]);}
  const yref=new Map();for(const [g,a] of ys){a.sort((p,q)=>p[0]-q[0]);const [y,t]=a[a.length>>1];yref.set(g,{y,rgb:[K[t*9],K[t*9+1],K[t*9+2]]});}
  for(let t=0;t<tris;t++){const ref=KIND[t]===1&&yref.get(GROUP[t]);if(!ref)continue;const y=Y(t),kk=y/ref.y;if(!leafy(t)&&!(kk<FLOOR&&hueless(t)))continue;const to=Math.pow(Math.max(kk,FLOOR),GAMMA);
   for(let k=0;k<3;k++){const i=t*9+k*3;for(let d=0;d<3;d++)K[i+d]=kk>=FLOOR?K[i+d]*to/kk:ref.rgb[d]*to;}}
  // 假 AO：冠內的相對高度 tz（底 0、頂 1）與離冠軸的水平距離 rxy（中心 0、外緣 1）合成一個亮度係數，冠底與冠心暗、冠頂與外緣亮。
  // 係數乘在線性色上；下限不壓太低，冠底在背光時才不會掉到近黑。
  const jr=prng((seed^0x6b43a9b5)>>>0),lum=1+(jr()-.5)*.14,warm=(jr()-.5)*.1; // 每棵的明度（±7%）與冷暖色偏（紅多藍少＝偏黃綠）
  for(let t=0;t<tris;t++){if(!KIND[t])continue;const {c,ax,z0,z1}=crowns.get(GROUP[t]);
   for(let k=0;k<3;k++){const i=t*9+k*3,tz=(P[i+2]-z0)/Math.max(z1-z0,1e-4),rxy=Math.min(1,Math.hypot((P[i]-c[0])/ax[0],(P[i+1]-c[1])/ax[1]));
    const s=Math.min(1,Math.max(0,.62*tz+.38*rxy)),f=(AO_LO+(AO_HI-AO_LO)*s*s*(3-2*s))*lum;
    K[i]*=f*(1+warm);K[i+1]*=f;K[i+2]*=f*(1-warm);}}
  // 冠的頂點色下限：下半面壓暗、收斂、假 AO 疊起來，冠底與冠心最暗的頂點只剩中位數的三成多，再碰上背光或陰影就近黑。
  // 亮度低於該團葉面中位數 crownMin 倍的頂點等比例提亮到這條線（色相不變），比它亮的頂點不動。
  // 葉色深、冠底又被上層葉遮成一大片陰影的樹種（榕樹、血桐）要把線拉高才不近黑，見 CROWN_MIN_OF。
  for(let t=0;t<tris;t++){const ref=KIND[t]===1&&yref.get(GROUP[t]);if(!ref)continue;const lo=ref.y*crownMin;
   for(let k=0;k<3;k++){const i=t*9+k*3,y=.2126*K[i]+.7152*K[i+1]+.0722*K[i+2];if(y>=lo)continue;
    if(y>1e-6){const m=lo/y;K[i]*=m;K[i+1]*=m;K[i+2]*=m;}else for(let d=0;d<3;d++)K[i+d]=ref.rgb[d]*crownMin;}}
  // 著地：樹下貼片（中心暗、外緣就是地色的扇形多邊形，抬高一點免 Z-fighting）優先，幹基外擴（三面錐台，下緣埋進地下）其次；兩者都不超過該樹種的三角形預算。
  // 沒給地色就不鋪：貼片的外緣要融進地面，猜一個預設地色在別的地面上會變成一塊色差明顯的多邊形。patch:false 的樹種（林投）一律不鋪。
  const sr=prng((seed^0x1f3a5c77)>>>0),head=budget-tris,np=ground===false||ground==null||!patch?0:head>=6?6:head>=4?head:0;
  if(np){const g=C(ground),dark=g.clone().multiplyScalar(.7),rim=g;
   let sx=0,sy=0,m=0;for(const v of crowns.values()){sx+=v.ax[0];sy+=v.ax[1];m++;}
   const R=Math.max(m?.5*(sx+sy)/(2*m):0,(base?.r0??H*.03)*4),a0=sr()*TAU,ctr=V(0,0,H*.006),ring=Array.from({length:np},(_,j)=>polar(a0+TAU*j/np,R*(.9+sr()*.2),H*.004));
   patchR=Math.max(...ring.map(p=>Math.hypot(p.x,p.y)));kind=2;for(let j=0;j<np;j++){const p=P.length;tri(ctr,ring[j],ring[(j+1)%np],rim);K[p]=dark.r;K[p+1]=dark.g;K[p+2]=dark.b;}kind=0;}
  if(base&&budget-tris>=6){const d=base.to.clone().normalize(),u=V().crossVectors(d,Math.abs(d.z)<.9?UP:V(1,0,0)).normalize(),v=V().crossVectors(d,u),ph=sr()*TAU;
   const ring=(z,rad)=>Array.from({length:3},(_,j)=>{const a=ph+TAU*j/3;return d.clone().multiplyScalar(z/Math.max(d.z,.5)).addScaledVector(u,Math.cos(a)*rad).addScaledVector(v,Math.sin(a)*rad);});
   const A=ring(-H*.05,base.r0*2.6),B=ring(H*.09,base.r0*.7);
   for(let j=0;j<3;j++){const k=(j+1)%3,col=base.col.clone().multiplyScalar(.9+sr()*.08);tri(A[j],A[k],B[k],col);tri(A[j],B[k],B[j],col);}}
  return crowns;
 }
 // 冠的體積法線：從所屬那團冠的包圍橢球往外指（橢球梯度）；朝下的分量壓小（VOL_DOWN）再整體往上偏一點（VOL_UP），
 // 冠頂仍朝上受光、冠底只略朝下，背光面不會死黑。扁的冠團（小葉欖仁的一層、相思樹與鳳凰木的扁傘）照原包圍盒算，外緣的法線會轉成水平、背陽側整圈變暗，
 // 所以橢球的垂直半軸至少取水平半軸的 VOL_ROUND 倍、頂端對齊冠頂（中心往下移），扁冠團的法線像一個淺圓頂，朝上偏外。木頭與貼片保留各自的面法線（平面著色）。
 function volumeNormals(position,normal,crowns){
  const n=V();
  for(let t=0;t<tris;t++){if(KIND[t]!==1)continue;const {c,ax,z1}=crowns.get(GROUP[t]),az=Math.max(ax[2],VOL_ROUND*(ax[0]+ax[1])/2),cz=z1-az;
   for(let k=0;k<3;k++){const i=t*9+k*3;n.set((position[i]-c[0])/(ax[0]*ax[0]),(position[i+1]-c[1])/(ax[1]*ax[1]),(position[i+2]-cz)/(az*az));
    if(n.lengthSq()<1e-12)n.set(0,0,1);n.normalize();if(n.z<0)n.z*=VOL_DOWN;n.z+=VOL_UP;n.normalize().toArray(normal,i);}}
 }
 return{tri,solid,wood,woodLater,sheet,facet,finish,mark,attach,connect,hold,seat,cast,stalk,setGroup:g=>{group=g;}};
}
// 著色參數：葉面逐面明暗的收斂下限與次方（1＝不收、越小越平）、假 AO 的亮度係數範圍（線性色）、
// 體積法線朝下分量的壓縮係數、上偏量、扁冠團的最小垂直／水平半軸比、冠頂點色的下限（該團葉面亮度中位數的倍數）。
const FLOOR=.25,GAMMA=.5,AO_LO=.74,AO_HI=1.12,VOL_DOWN=.4,VOL_UP=.2,VOL_ROUND=.6,CROWN_MIN=.62;
// 冠頂點色下限的樹種例外：側視近照裡冠面低於 20/255 的像素要 ≤1%。這兩種葉色深、冠底整片在上層葉的陰影裡，.62 不夠（榕樹 2.6%、血桐 6.9%）。
const CROWN_MIN_OF=new Map([['ficus',.9],['macaranga',.95]]);
// 亮度抖動與背面壓暗的下限（底色 HSL 亮度的倍數）；EMBED：零件接上支撐時多埋進去的深度；CROWN_IN：氣生根頂、枝端埋進冠底的深度（都是樹高的倍數）。
const DIM_MIN=.5,EMBED=.008,LEAF_PUSH=.04,STALK_W=.12,CROWN_IN=.025,DOWN=V(0,0,-1);
const dim=(c,dl)=>{const h=c.getHSL({});return c.setHSL(h.h,h.s,Math.max(h.l+dl,h.l*DIM_MIN));};

const polar=(a,d,z=0)=>V(Math.cos(a)*d,Math.sin(a)*d,z);
const lerp=(a,b,t)=>a+(b-a)*t;
const jit=(r,base,amt)=>base*(1+(r()-.5)*2*amt);
// 從陣列隨機挑 k 個（Fisher–Yates 前 k 步）。
function pick(r,arr,k){const a=arr.slice();for(let i=0;i<k&&i<a.length;i++){const j=i+Math.floor(r()*(a.length-i));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,k);}

// ── 各樹種。座標：樹底在原點、+z 朝上；h 是整棵高，每棵再有 ±8～10% 的高度變化。
const SHAPES={
 // 小葉欖仁：直幹貫穿到頂，3～4 層水平葉層。每層是一片邊緣破碎的扁平葉盤：輪生枝的方向長成葉瓣，瓣與瓣之間切出深缺口，
 // 從正上方看缺口排成輻條；每瓣上再疊一塊錯開的厚葉墊，讓葉層在斜俯視時是一塊茂密、表面起伏的綠色層板，而不是枝上插幾片葉。
 // 寬底塔形：最底層最寬，往上收窄（略凸的收法），冠寬約樹高的 0.75～0.9；層距與葉盤半徑留到斜俯視也看得到下一層露出的邊。每層方位相對上一層錯開。
 // 葉色是中綠（灰白街景裡不搶眼），只有最頂層偏亮的黃綠當特徵。
 terminalia(B,r,h){
  const H=jit(r,h,.08),leaf=C('#62893f').offsetHSL((r()-.5)*.02,(r()-.5)*.06,(r()-.5)*.04),bark=C('#776f62');
  const lean=polar(r()*TAU,H*.008*r());
  B.wood(V(),V(lean.x,lean.y,H*.98),H*.034,H*.012,4,bark);
  const tiers=3+(r()<.5?1:0),z0=H*(.42+r()*.04),z1=H*.9,R0=H*(.365+r()*.052),R1=R0*(.55+r()*.15),gap=(z1-z0)/(tiers-1);
  let a0=r()*TAU;
  for(let i=0;i<tiers;i++){
   B.setGroup(i); // 每層葉盤各算一團冠：體積法線與假 AO 以層為單位，層面朝上受光、層下緣暗（整株一顆橢球會把下層外緣的法線轉成水平、背陽側整片變暗）
   // Rb 是窄塔的層寬，再乘上由底層 1.4 倍收到頂層 1 倍的放寬係數；厚度仍照 Rb，底層放寬後不會變厚而吃掉層間空隙。
   const k=i/(tiers-1),z=lerp(z0,z1,k)+(r()-.5)*gap*.1,Rb=lerp(R0,R1,k)*(.94+r()*.12),R=Rb*(1.4-.4*Math.pow(k,1.5)),c=V(lean.x*z/H,lean.y*z/H,z);
   const n=4+Math.floor(r()*(tiers===4?2:3)),t=Rb*.13;
   // 葉盤與葉墊的底面、下緣壓到頂面亮度的約 6 成：斜俯視時每層下緣是一條暗帶，上下層才分得開。
   const tone=i===tiers-1?leaf.clone().offsetHSL(-.025,.04,.08):leaf.clone().offsetHSL(0,0,(k-.5)*.02),top=tone.clone().offsetHSL(0,0,.03),hsl=top.getHSL({}),under=new THREE.Color().setHSL(hsl.h,hsl.s,hsl.l*.6),col=cz=>cz>0?top.clone():under.clone();
   // 葉盤：每瓣 3 個外緣點（肩、尖、肩）＋瓣間 1 個深缺口點，外緣高度小起伏；上下各一個頂點，模板空間半徑 1、厚 1。
   const v=[V(0,0,.6),V(0,0,-.4)],ang=[];
   for(let j=0;j<n;j++){const a=TAU*j/n+(r()-.5)*.3,span=TAU/n,lr=.9+r()*.2;ang.push(a);
    v.push(V(...polar(a-span*.3,.8*lr,(r()-.5)*.3).toArray()),V(...polar(a,lr,(r()-.5)*.4).toArray()),V(...polar(a+span*.3,.8*lr,(r()-.5)*.3).toArray()),V(...polar(a+span*.5,.42+r()*.08).toArray()));}
   const m=v.length-2,f=[];for(let j=0;j<m;j++){const p=2+j,q=2+(j+1)%m;f.push([0,p,q],[1,q,p]);}
   const plate=[B.mark()];B.solid({v,f:orient(v,f)},{pos:c,scale:[R,R,t],yaw:a0,tilt:[(r()-.5)*.06,(r()-.5)*.06],jit:.06,color:col});plate.push(B.mark(),true);
   // 每瓣上疊一塊厚葉墊（厚約寬的 1/4），位置偏外、略高，蓋住葉盤接縫並讓層面起伏。墊落在瓣緣下凹處時會浮起來，往下放到碰到葉盤。
   for(const a of ang){const aa=a0+a+(r()-.5)*.25,pf=.3+r()*.05,pr=R*pf,p0=B.mark();
    B.solid(T.lens5,{pos:c.clone().add(polar(aa,R*(.55+r()*.12),t*(.25+r()*.3))),scale:[pr,pr*.8,Rb*pf*.4],yaw:aa,tilt:[(r()-.5)*.12,(r()-.5)*.12],jit:.15,color:col});
    B.attach([p0,B.mark(),true],[plate],DOWN,H*EMBED);}
   a0+=Math.PI/n+.4+(r()-.5)*.5; // 下一層錯開，不讓葉瓣對齊成一根柱
  }
 },
 // 鳳凰木：短幹分 3～4 根斜枝撐起寬而扁的傘冠（冠寬約樹高的 1.7～2 倍）；約三成葉簇做成開花，花只上在葉簇上半面，從下面看仍是綠的。
 // 花色是偏暗的磚紅／朱紅：在灰白街景裡當點綴，太亮太飽和會像警示燈。
 delonix(B,r,h){
  const H=jit(r,h,.1),W=H*(.85+r()*.15),leaf=C('#64844b').offsetHSL(0,(r()-.5)*.05,(r()-.5)*.04),bloom=C(r()<.5?'#96432f':'#a44f33'),bark=C('#6f6656');
  const top=V(0,0,H*(.3+r()*.05));B.wood(V(),top,H*.06,H*.045,6,bark);
  const nb=3+(r()<.5?1:0),a0=r()*TAU,crownZ=H*.68;
  for(let i=0;i<nb;i++){const a=a0+i*TAU/nb+(r()-.5)*.5;B.wood(top.clone().add(V(0,0,-H*.04)),polar(a,W*(.42+r()*.12),crownZ-H*.04),H*.032,H*.018,4,bark);}
  const lobes=[{p:V(0,0,H-H*.13),s:[W*.42,W*.38,H*.13]}];
  const ring=6+Math.floor(r()*3);
  for(let i=0;i<ring;i++){const a=a0+i*TAU/ring+(r()-.5)*.4,d=W*(.5+r()*.1);lobes.push({p:polar(a,d,crownZ+H*(.04-.03*r())),s:[W*(.42+r()*.06),W*(.34+r()*.05),H*(.11+r()*.03)]});}
  const red=new Set(pick(r,lobes.map((_,i)=>i),Math.max(2,Math.round(lobes.length*.3))));
  const parts=lobes.map((l,i)=>{const m=B.mark();B.solid(T.ico,{pos:l.p,scale:l.s,yaw:r()*TAU,tilt:[(r()-.5)*.12,(r()-.5)*.12],jit:.14,color:cz=>red.has(i)&&cz>-.25?bloom.clone().offsetHSL(0,0,(r()-.5)*.04):leaf.clone().offsetHSL(0,0,cz>0?.02:-.08)});return[m,B.mark(),true];});
  // 頂團常浮在外圈之上（外圈團靠樹心那側的頂面較低）：往下放到碰到外圈，冠心也就不會露出空洞。
  B.attach(parts[0],parts.slice(1),DOWN,H*EMBED);
 },
 // 台灣欒樹：直幹＋兩根斜枝，蛋形圓冠 5～6 團；頂上 1～2 團的上半面換成黃花或粉褐蒴果。
 koelreuteria(B,r,h){
  const H=jit(r,h,.08),leaf=C('#5e8352').offsetHSL(0,(r()-.5)*.05,(r()-.5)*.04),bark=C('#6e6152');
  const top=V((r()-.5)*H*.03,(r()-.5)*H*.03,H*.45);B.wood(V(),top,H*.04,H*.026,5,bark);
  const a0=r()*TAU;for(let i=0;i<2;i++){const a=a0+i*Math.PI+(r()-.5)*.6;B.wood(top.clone().add(V(0,0,-H*.06)),top.clone().add(polar(a,H*.14,H*.1)),H*.022,H*.014,4,bark);}
  const n=5+(r()<.5?1:0),lobes=[];
  for(let i=0;i<n-2;i++){const a=a0+i*TAU/(n-2)+(r()-.5)*.5;lobes.push({p:top.clone().add(polar(a,H*(.15+r()*.04),H*(.1+r()*.08))),s:H*(.19+r()*.04)});}
  lobes.push({p:top.clone().add(V((r()-.5)*H*.06,(r()-.5)*H*.06,H*.27)),s:H*.2});
  lobes.push({p:V(top.x+(r()-.5)*H*.08,top.y+(r()-.5)*H*.08,H-H*.15),s:H*.16});
  const order=lobes.map((l,i)=>i).sort((a,b)=>lobes[b].p.z-lobes[a].p.z),nBloom=1+(r()<.5?1:0),bloomCol=new Map();
  for(let i=0;i<nBloom;i++)bloomCol.set(order[i],C(r()<.6?'#d6b443':'#b98a6c'));
  lobes.forEach((l,i)=>{const b=bloomCol.get(i);B.solid(T.s6x5,{pos:l.p,scale:[l.s,l.s*(.9+r()*.15),l.s*(.95+r()*.15)],yaw:r()*TAU,jit:.16,color:cz=>b&&cz>-.1?b.clone().offsetHSL(0,0,(r()-.5)*.05):leaf.clone().offsetHSL(0,0,cz>.3?.03:cz<-.3?-.08:0)});});
 },
 // 榕樹：粗短幹分三根粗枝，寬而厚的圓冠 6～7 團；冠下垂 6～8 條氣生根，一半落到地面成支柱根，其餘懸在半空。
 // 氣生根是識別特徵：比樹幹淺的灰褐、四角柱，從冠底外圈垂下（方位均分，任何視角都有幾條在冠緣下露出來）；冠底抬高一點，讓根在側視露出的長度夠。
 ficus(B,r,h){
  const H=jit(r,h,.1),W=H*(.6+r()*.1),leaf=C('#46694c').offsetHSL(0,(r()-.5)*.04,(r()-.5)*.03),bark=C('#7a7466'),root=C('#a39b88');
  const top=V(0,0,H*.3);B.wood(V(),top,H*.085,H*.065,6,bark);
  // 三根主枝等冠長好再長：枝端在冠底下方懸空時往上伸進冠底（已經在冠裡的不動）。
  const a0=r()*TAU,branches=[];for(let i=0;i<3;i++){const a=a0+i*TAU/3+(r()-.5)*.5,tip=polar(a,W*.32,H*.48);branches.push([tip,B.woodLater(top.clone().add(V(0,0,-H*.05)),tip,H*.045,H*.03,5,bark)]);}
  const ring=5+(r()<.5?1:0),crown=[];
  for(let i=0;i<ring;i++){const a=a0+i*TAU/ring+(r()-.5)*.4,m=B.mark();crown.push([m]);B.solid(T.s6x4,{pos:polar(a,W*(.52+r()*.08),H*(.62+r()*.05)),scale:[W*(.42+r()*.06),W*(.38+r()*.05),H*(.22+r()*.04)],yaw:r()*TAU,jit:.14,color:cz=>leaf.clone().offsetHSL(0,0,cz>.3?.03:cz<-.3?-.08:0)});crown[i].push(B.mark());}
  crown.push([B.mark()]);B.solid(T.s6x4,{pos:V((r()-.5)*W*.1,(r()-.5)*W*.1,H-H*.24),scale:[W*.55,W*.52,H*.24],yaw:r()*TAU,jit:.12,color:cz=>leaf.clone().offsetHSL(0,0,cz>.3?.04:-.03)});crown[ring].push(B.mark());
  for(const [tip,grow] of branches){let t,z=null;
   for(const deep of [false,true]){t=tip.clone();z=B.seat(crown,t,H*.03,H*CROWN_IN,deep);for(let k=0;z===null&&k<12;k++){t.x*=.9;t.y*=.9;z=B.seat(crown,t,H*.03,H*CROWN_IN,deep);}if(z!==null)break;}
   if(z===null||z<=tip.z)t=tip;else t.z=z;grow(t);}
  // 根頂從冠團實際的底面取點（seat：整圈開口都藏進冠裡）；冠沒罩到那裡、或那裡的冠太薄，就沿半徑往內收。懸空根的下端用固定色封口（不抽亂數）。
  const nr=6+Math.floor(r()*3),ra=r()*TAU,capCol=root.clone().multiplyScalar(.85);
  for(let i=0;i<nr;i++){const a=ra+i*TAU/nr+(r()-.5)*.5,ground=i%2===0;let d=W*(.5+r()*.3);const bottom=ground?0:H*(.1+r()*.14),ta=a+(r()-.5)*.08,td=.98+r()*.06,rad=H*(ground?.034:.024);
   const d0=d;let z=null;for(const deep of [false,true]){d=d0;z=B.seat(crown,polar(a,d),rad,H*CROWN_IN,deep);for(let k=0;z===null&&k<12;k++){d*=.9;z=B.seat(crown,polar(a,d),rad,H*CROWN_IN,deep);}if(z!==null)break;}
   B.wood(polar(a,d,z??H*.48),polar(ta,d*td,bottom),rad,H*(ground?.028:.016),4,root,ground?false:capCol);}
 },
 // 相思樹：主幹斜 5～15°，在約 0.4H 分成 3 根斜枝，每根再分出一根側枝；樹冠是貼在枝端上的扁平葉墊（主枝端一大塊、側枝端與枝間各一小塊、頂上一塊），
 // 葉墊互相重疊連成一片偏扁的傘形冠，冠心整體往主幹傾斜那側偏。葉墊頂點抖動大、每面明暗差大，邊緣看起來破碎；暗灰綠，底面壓暗。
 // 葉色比山黃麻灰，但亮度壓低：太亮的灰綠種在深綠山坡上會像蒙了一層霜。
 acacia(B,r,h){
  const H=jit(r,h,.1),leaf=C('#5a6e4f').offsetHSL((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.04),bark=C('#5f564a');
  const hsl=leaf.getHSL({}),under=new THREE.Color().setHSL(hsl.h,hsl.s,hsl.l*.68),col=cz=>cz>0?leaf.clone().offsetHSL(0,0,.025):under.clone();
  const la=r()*TAU,tilt=(5+r()*10)*Math.PI/180,forkZ=H*(.4+r()*.06),top=polar(la,Math.tan(tilt)*forkZ,forkZ);
  B.wood(V(),top,H*.045,H*.03,4,bark);
  // 冠心沿傾斜方向再偏一點；W 是冠的半徑（冠寬約 1～1.15 倍樹高）。
  const cc=top.clone().add(polar(la,H*(.06+r()*.05))),W=H*(.5+r()*.07),crownZ=H*(.8+r()*.03);
  const a0=r()*TAU,pad=(p,sx,sy,sz,yaw,tm)=>{const m=B.mark();B.solid(tm,{pos:p,scale:[sx,sy,sz],yaw,tilt:[(r()-.5)*.16,(r()-.5)*.16],jit:.28,facetAmt:.12,color:col});return[m,B.mark(),true];};
  const branch=(from,to,r0,r1)=>{const m=B.mark();B.wood(from,to,r0,r1,3,bark);return[m,B.mark(),false];};
  const held=[],small=[],inward=p=>[DOWN,UP,V(cc.x-p.x,cc.y-p.y,0).normalize()];
  for(let i=0;i<3;i++){
   const a=a0+i*TAU/3+(r()-.5)*.5,d=W*(.48+r()*.16),tip=cc.clone().add(polar(a,d,0));tip.z=crownZ-H*(.03+r()*.04);
   held.push(branch(top.clone().add(V(0,0,-H*.03)),tip,H*.026,H*.014));
   // 側枝：從主枝中段岔出，往旁邊伸到冠緣。
   const s=a+(r()<.5?-1:1)*(.6+r()*.3),mid=top.clone().lerp(tip,.55),tw=cc.clone().add(polar(s,W*(.68+r()*.12),0));tw.z=crownZ-H*(.06+r()*.03);
   held.push(branch(mid,tw,H*.014,H*.008));
   // 葉墊中心略高於枝端，枝端插進葉墊底面：每塊葉都看得出是枝撐著的。
   held.push(pad(tip.clone().add(V(0,0,H*.03)),W*(.5+r()*.08),W*(.42+r()*.06),H*(.075+r()*.015),a+(r()-.5)*.6,T.ico));
   small.push({part:pad(tw.clone().add(V(0,0,H*.025)),W*(.3+r()*.06),W*(.26+r()*.05),H*.06,s,T.lens5),dirs:inward(tw)});
   // 枝與枝之間的冠緣補一塊，冠的外圈才連成一圈，不是三團。
   const g=a+TAU/6+(r()-.5)*.3,gp=cc.clone().add(polar(g,W*(.62+r()*.12),0));gp.z=crownZ-H*(.01+r()*.04);
   small.push({part:pad(gp,W*(.34+r()*.06),W*(.28+r()*.05),H*.06,g,T.lens5),dirs:inward(gp)});
  }
  small.unshift({part:pad(cc.clone().add(V(0,0,crownZ-cc.z+H*.06)),W*(.44+r()*.06),W*(.4+r()*.06),H*(.08+r()*.015),r()*TAU,T.ico),dirs:[DOWN,UP]});
  // 頂上那塊與側枝端、枝間的小葉墊，偶爾和枝、主枝葉墊、其他葉墊都沒連上（浮起來）：先往下、碰不到再往上，上下都沒東西就水平往冠心，平移到碰到已經撐住的零件。
  B.connect(small,held,H*EMBED);
 },
 // 山黃麻：直幹在約 0.34H 分出 3～4 根短斜枝，每根撐住一團圓葉團；葉團圍一圈、頂上再壓一團大的，互相重疊成一個整體的圓頂冠（花椰菜形）。
 // 冠寬約 0.9～1H、冠高約冠寬的 0.6，側視是饅頭形圓頂，和相思樹的扁傘（冠高不到冠寬的 0.3）光看輪廓就分得開。
 // 葉團頂點抖動小、面與面明暗差小，看起來圓潤；下半面壓暗，冠底有一圈陰影。中綠略黃。
 trema(B,r,h){
  const H=jit(r,h,.08),leaf=C('#678c45').offsetHSL((r()-.5)*.015,(r()-.5)*.05,(r()-.5)*.04),bark=C('#857b6c');
  const fork=V((r()-.5)*H*.02,(r()-.5)*H*.02,H*(.32+r()*.04));B.wood(V(),fork,H*.042,H*.032,4,bark);
  const n=3+(r()<.5?1:0),a0=r()*TAU,col=(hi,lo)=>cz=>leaf.clone().offsetHSL(0,0,cz>.3?hi:cz<-.25?lo:0);
  // 外圈葉團：中心離幹 0.24～0.29H、半徑約 0.28H，彼此重疊；枝端插進葉團下半部，每團都有枝撐著。四團時用面數少一級的球，壓在預算內。
  const ringT=n===4?T.s5x4:T.s6x4;
  for(let i=0;i<n;i++){
   const a=a0+i*TAU/n+(r()-.5)*.35,p=fork.clone().add(polar(a,H*(.24+r()*.05),H*(.26+r()*.04))),rh=H*(.27+r()*.03);
   B.wood(fork.clone().add(V(0,0,-H*.02)),p.clone().add(V(0,0,-H*.06)),H*.024,H*.015,3,bark);
   B.solid(ringT,{pos:p,scale:[rh,rh*(.9+r()*.1),H*(.2+r()*.03)],yaw:a,jit:.07,facetAmt:.035,color:col(.025,-.1)});
  }
  // 頂團：最大、最高，壓在外圈之上，下緣深入外圈葉團，冠頂是一個連續的圓弧。
  B.solid(T.s6x5,{pos:V(fork.x+(r()-.5)*H*.04,fork.y+(r()-.5)*H*.04,H*(.76+r()*.02)),scale:[H*(.33+r()*.03),H*(.31+r()*.03),H*(.2+r()*.02)],yaw:r()*TAU,jit:.06,facetAmt:.03,color:col(.04,-.08)});
 },
 // 筆筒樹：筆直細柱幹，深褐近黑，幹面交錯的淺色菱形葉痕；頂端 10～14 片寬大羽葉先往上斜伸再往外弓垂（羽毛球形），
 // 每片葉是三段折線的寬條帶，兩側鋸齒（羽片），和平滑細長的椰子葉分得開；冠心 2～3 顆褐色捲曲幼葉，冠下一圈短的枯葉裙。
 cyathea(B,r,h){
  const H=jit(r,h,.1),frond=C('#93ad4c').offsetHSL((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.04),stem=C('#33281f'),scar=C('#a08d70'),scarDim=C('#66574a'),dead=C('#7a5b3e'),curl=C('#8b6a3a');
  // 幹：4 稜、3 節，相鄰兩圈錯開半格，面自然排成菱形；隔一塊菱形換淺色當葉痕。
  // 莖頂比羽葉起點高 0.006H：羽葉從莖頂的側面長出來，冠底和莖頂之間不留透光縫。
  const top=V(0,0,H*(.7+r()*.04)),ns=3,nf=4,ph=r()*TAU,stemTop=top.z+H*.016;
  const ring=i=>Array.from({length:nf},(_,j)=>polar(ph+(j+(i%2)*.5)*TAU/nf,H*lerp(.032,.024,i/ns),stemTop*i/ns));
  const out=(a,b,c,col)=>{const n=V().subVectors(b,a).cross(V().subVectors(c,a)),m=V(a.x+b.x+c.x,a.y+b.y+c.y,0);if(n.dot(m)<0)[b,c]=[c,b];B.tri(a,b,c,B.facet(col,.05));};
  for(let i=0;i<ns;i++){const L=ring(i),U=ring(i+1);for(let j=0;j<nf;j++){const k=(j+1)%nf,pale=(i+j)%2===0?scar:scarDim;
   if((i+1)%2){out(L[j],L[k],U[j],stem);out(U[j],L[k],U[k],pale);}else{out(L[j],L[k],U[k],stem);out(U[j],L[j],U[k],pale);}}}
  const U=ring(ns);B.tri(U[0],U[1],U[2],stem);B.tri(U[0],U[2],U[3],stem);
  const n=10+Math.floor(r()*5),a0=r()*TAU,crown=top.clone().add(V(0,0,H*.01));
  for(let i=0;i<n;i++){
   const a=a0+i*TAU/n+(r()-.5)*.25,dir=polar(a,1),side=polar(a+Math.PI/2,1),L=H*(.5+r()*.1),seg=L/3,w=L*(.115+r()*.025);
   const e0=(i%2?1.2:1)+(r()-.5)*.2,P=[crown.clone().addScaledVector(dir,H*.015)];
   for(const e of [e0,.12+(r()-.5)*.15,-(.75+r()*.3)])P.push(P[P.length-1].clone().addScaledVector(dir,seg*Math.cos(e)).addScaledVector(UP,seg*Math.sin(e)));
   // 每段是一塊「近端窄、遠端寬」的梯形，下一段又從窄的開始：葉面連成一條，兩側輪廓卻是一級級的鋸齒，看起來像一片片羽片。末段收成尖。
   // 遠端那條邊壓低 wf·0.15，下一段的近端邊也壓低同樣的量，落在上一段的遠端邊上（段與段之間不留階差縫）。
   const pts=[],faces=[];let drop=0;
   [[.4,.8],[.45,1],[.55,.12]].forEach(([kn,kf],s)=>{const o=pts.length,wn=w*kn,wf=w*kf;
    pts.push(P[s].clone().addScaledVector(side,wn).addScaledVector(UP,-drop),P[s].clone().addScaledVector(side,-wn).addScaledVector(UP,-drop),P[s+1].clone().addScaledVector(side,wf).addScaledVector(UP,-wf*.15),P[s+1].clone().addScaledVector(side,-wf).addScaledVector(UP,-wf*.15));
    faces.push([o,o+1,o+3],[o,o+3,o+2]);drop=wf*.15;});
   B.sheet(pts,faces,H*.006,frond.clone().offsetHSL(0,0,(r()-.5)*.05));
  }
  const nc=2+(r()<.5?1:0);
  for(let i=0;i<nc;i++)B.solid(T.tetra,{pos:crown.clone().add(polar(a0+i*TAU/nc+r(),H*.018,H*(.025+r()*.03))),scale:[H*.03,H*.03,H*.045],yaw:r()*TAU,tilt:[(r()-.5)*.6,(r()-.5)*.6],color:()=>curl,facetAmt:.08});
  // 枯葉裙：上緣從莖面裡長出（離軸 0.012H，在莖的內切半徑之內）。
  for(let i=0;i<4;i++){const a=a0+(i+.5)*TAU/4+(r()-.5)*.4,dir=polar(a,1),side=polar(a+Math.PI/2,1),b=top.clone().addScaledVector(dir,H*.012).add(V(0,0,-H*.01)),w=H*.03;
   B.sheet([b.clone().addScaledVector(side,w),b.clone().addScaledVector(side,-w),b.clone().addScaledVector(dir,H*.06).add(V(0,0,-H*(.1+r()*.04)))],[[0,1,2]],H*.004,dead,dir);}
 },
 // 血桐：短幹兩枝撐起矮胖低圓的冠。冠心是 3 團大面的二十面體，外面像魚鱗一樣蓋 12 片盾形大圓葉（五邊形、中心微凸、淺一階的綠），
 // 葉片沿冠頂均勻分布、葉緣朝外下垂——大圓葉一片片的塊面就是它的識別特徵。
 macaranga(B,r,h){
  const H=jit(r,h,.08),leaf=C('#46684f').offsetHSL((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.03),big=leaf.clone().offsetHSL(-.015,0,.06),bark=C('#7f786a');
  const top=V(0,0,H*.3);B.wood(V(),top,H*.05,H*.035,5,bark);
  // 兩根枝等核心長好再長：枝端從原定位置往上伸進核心底面（核心的底面高低隨抖動與方位變，原定枝端常在核心下方懸空）。
  const a0=r()*TAU,branches=[];for(let i=0;i<2;i++){const a=a0+i*Math.PI+(r()-.5)*.6,tip=top.clone().add(polar(a,H*.2,H*.16));branches.push([tip,B.woodLater(top.clone().add(V(0,0,-H*.04)),tip,H*.025,H*.016,3,bark)]);}
  const c0=V(0,0,H*.6),rad=[H*(.4+r()*.05),H*(.38+r()*.05),H*.3],crown=[];let m=B.mark();
  B.solid(T.ico,{pos:c0.clone().add(V(0,0,H*.04)),scale:[rad[0]*.8,rad[1]*.8,rad[2]*.9],yaw:r()*TAU,jit:.08,facetAmt:.04,color:cz=>leaf.clone().offsetHSL(0,0,cz<-.3?-.08:0)});crown.push([m,B.mark(),true]);
  for(let i=0;i<2;i++){const a=a0+Math.PI/2+i*Math.PI+(r()-.5)*.5;m=B.mark();B.solid(T.ico,{pos:c0.clone().add(polar(a,rad[0]*.45,-H*.08)),scale:[rad[0]*.6,rad[1]*.55,rad[2]*.7],yaw:r()*TAU,jit:.08,facetAmt:.04,color:cz=>leaf.clone().offsetHSL(0,0,cz<-.3?-.09:-.02)});crown.push([m,B.mark(),true]);}
  // 枝端埋進核心時頂蓋在核心裡看不到，不畫（省下的面留給葉柄）。
  for(const [tip,grow] of branches){let t,z=null;for(const deep of [false,true]){t=tip.clone();z=B.seat(crown,t,H*.016,H*CROWN_IN,deep);for(let k=0;z===null&&k<12;k++){t.x*=.9;t.y*=.9;z=B.seat(crown,t,H*.016,H*CROWN_IN,deep);}if(z!==null)break;}t.z=Math.max(tip.z,z??tip.z);grow(t,z===null);}
  // 葉片方向：上半球的費氏螺旋點（12 片），葉心落在冠的外殼上，法線是外殼方向再抬一點。
  const n=12,yaw=r()*TAU,leaves=[];
  for(let i=0;i<n;i++){
   const zt=1-(i+.5)/n*.95,ring=Math.sqrt(1-zt*zt),a=yaw+i*2.39996+(r()-.5)*.3;
   const dir=V(Math.cos(a)*ring,Math.sin(a)*ring,zt),c=c0.clone().add(V(dir.x*rad[0],dir.y*rad[1],dir.z*rad[2]).multiplyScalar(.98+r()*.06));
   const nrm=V(dir.x/rad[0],dir.y/rad[1],dir.z/rad[2]).normalize().addScaledVector(UP,.25).normalize(),u=V().crossVectors(nrm,Math.abs(nrm.z)>.95?V(1,0,0):UP).normalize(),w=V().crossVectors(nrm,u),R=H*(.15+r()*.03);
   const pts=[c.clone().addScaledVector(nrm,R*.18)];
   for(let j=0;j<5;j++){const b=TAU*j/5+r()*.3;pts.push(c.clone().addScaledVector(u,Math.cos(b)*R).addScaledVector(w,Math.sin(b)*R*.92).addScaledVector(nrm,-R*.12));}
   const m=B.mark(),col=big.clone().offsetHSL(0,0,(r()-.5)*.06);B.sheet(pts,[[0,1,2],[0,2,3],[0,3,4],[0,4,5],[0,5,1]],H*.005,col,nrm);
   leaves.push({part:[m,B.mark(),false],dir:nrm.clone().negate(),top:pts[0],nrm,R,col});
  }
  // 葉心落在外殼上，核心比外殼小一圈，多數葉和核心之間有縫。葉片維持薄片：離核心或已接上的葉不到 LEAF_PUSH·H 的，整片沿法線往內推到碰到；
  // 再遠的不推（推太多冠會縮），從葉背中心伸一根細葉柄（寬 STALK_W·R）到核心。葉柄的平面含水平切線，從上方的視角都看得到。
  // LEAF_PUSH 取 .04：.02 時每棵平均 5 根葉柄，有地色時預算排在貼片之後的幹基外擴只剩 1/4 棵放得下；.04 時葉柄少一半、冠寬只縮約 0.7%。
  // 推到碰到後只再埋 0.0025H（半片葉厚）：碰到的常是另一片 0.005H 厚的葉，埋 EMBED 會整片穿過去、反而又離開。
  for(const L of B.hold(leaves,crown.slice(),H*.0025,H*LEAF_PUSH)){
   const t=V().crossVectors(UP,L.nrm);if(t.lengthSq()<1e-6)t.set(1,0,0);t.normalize();
   // 葉柄上緣放在葉片正反兩面之間（離葉心 0.06R 處葉面已往下斜 0.018R），從葉面看不到。
   const mid=L.top.clone().addScaledVector(L.nrm,-(L.R*.018+H*.0025)),a=mid.clone().addScaledVector(t,L.R*STALK_W/2),b=mid.clone().addScaledVector(t,-L.R*STALK_W/2);
   let d=L.dir,s=B.cast(crown,mid,d);if(s===Infinity){d=c0.clone().add(V(0,0,H*.04)).sub(mid).normalize();s=B.cast(crown,mid,d);}
   const tip=mid.clone().addScaledVector(d,s+H*EMBED),up=V().subVectors(b,a).cross(V().subVectors(tip,a)).z>=0;
   B.stalk(up?a:b,up?b:a,tip,dim(L.col.clone(),-.06));
  }
 },
 // 林投：2～4 根斜幹叢生（斜 15～35°），每根頂端一團 8～18 片螺旋排列的寬劍葉：葉從冠心往四面八方放射，上方的斜向上、外圈水平、下圈往下垂，
 // 整團像一顆刺球（V 形對折的細長三角，葉尖再往下彎）。冠心約在 0.45～0.6H，刺球疊起來是一叢有幹的灌木，而不是貼地的草。
 // 基部 3～4 條較粗的支持根從幹的下段斜插入地；黃綠葉、灰褐幹。
 pandanus(B,r,h){
  const H=jit(r,h,.1),blade=C('#94aa4e').offsetHSL((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.04),trunk=C('#857a6b'),root=C('#7c705f');
  const ns=2+Math.floor(r()*3),nbl=ns===2?18:ns===3?12:8,a0=r()*TAU,GOLD=2.39996;
  const bases=[];
  for(let i=0;i<ns;i++){
   B.setGroup(i); // 每根幹頂的葉叢各算一團冠（gradient／volume 著色以它為單位）
   const a=a0+i*TAU/ns+(r()-.5)*.6,b=polar(a,H*.07),lean=(15+r()*20)*Math.PI/180,tz=H*(.46+r()*.14);
   const tip=b.clone().add(polar(a,Math.tan(lean)*tz,tz));bases.push({b,a,tip});
   B.wood(b,tip,H*.05,H*.035,3,trunk);
   // 冠心一顆暗黃綠的實心葉團：場景尺度下劍葉只剩一兩個像素寬，靠它讓每團葉在遠處仍是一塊有份量的冠，而不是一撮草。
   B.solid(T.lens5,{pos:tip.clone().add(V(0,0,H*.02)),scale:[H*.12,H*.12,H*.16],yaw:r()*TAU,jit:.2,facetAmt:.08,color:cz=>blade.clone().offsetHSL(0,0,cz>0?-.04:-.12)});
   const yaw0=r()*TAU;
   for(let j=0;j<nbl;j++){
    // 仰角由上往下鋪：第 0 片近直立，最後一片下垂約 30°，中間均分；方位走黃金角，葉才不會疊成一串。
    const ya=yaw0+j*GOLD,el=lerp(1.25,-.55,j/(nbl-1))+(r()-.5)*.2,BL=H*(.34+r()*.1),w=H*.12;
    const dir=V(Math.cos(ya)*Math.cos(el),Math.sin(ya)*Math.cos(el),Math.sin(el)),side=V().crossVectors(dir,UP).normalize(),up=V().crossVectors(side,dir);
    const o=tip.clone().addScaledVector(dir,H*.01);
    const Lb=o.clone().addScaledVector(side,w*.5),Rb=o.clone().addScaledVector(side,-w*.5),K=o.clone().addScaledVector(dir,BL*.4).addScaledVector(up,-w*.3),Tp=o.clone().addScaledVector(dir,BL).addScaledVector(UP,-BL*(el<.3?.28:.12));
    B.sheet([Lb,K,Tp,Rb],[[0,1,2],[1,3,2]],H*.004,blade.clone().offsetHSL(0,0,(r()-.5)*.1),up);
   }
  }
  const nr=3+Math.floor(r()*2);
  for(let i=0;i<nr;i++){const s=bases[i%ns],a=s.a+(r()-.5)*1.6,from=s.b.clone().lerp(s.tip,.2+r()*.12);B.wood(from,polar(a,H*(.16+r()*.08),0).add(V(s.b.x,s.b.y,0)),H*.016,H*.012,3,root,false);}
 },
 // 黃槿：短幹兩枝，矮闊的扁圓冠（4～5 團扁球，外圈壓低近地）；冠面上半零星 7～10 朵黃色小塊（掛在葉簇實際頂點上）。
 hibiscus(B,r,h){
  const H=jit(r,h,.08),leaf=C('#5d7f4e').offsetHSL((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.04),flower=C('#e6c63f'),bark=C('#7d776c');
  const top=V(0,0,H*.28);B.wood(V(),top,H*.05,H*.035,5,bark);
  // 兩根枝等冠長好再長（亂數照原本的順序先抽），枝端才知道冠底實際在哪。
  const a0=r()*TAU,branches=[];for(let i=0;i<2;i++){const a=a0+i*Math.PI+(r()-.5)*.6,tip=top.clone().add(polar(a,H*.22,H*.14));branches.push([tip,B.woodLater(top.clone().add(V(0,0,-H*.04)),tip,H*.025,H*.016,3,bark)]);}
  const verts=[],n=4+(r()<.5?1:0),crown=[];
  const add=(p,s)=>{const m=B.mark();verts.push(...B.solid(T.s5x4,{pos:p,scale:s,yaw:r()*TAU,jit:.12,color:cz=>leaf.clone().offsetHSL(0,0,cz>.3?.03:cz<-.3?-.08:0)}).map(v=>({v,p})));crown.push([m,B.mark()]);};
  add(V(0,0,H*.64),[H*.4,H*.37,H*.24]);
  for(let i=1;i<n;i++){const a=a0+Math.PI/3+(i-1)*TAU/(n-1)+(r()-.5)*.5;add(polar(a,H*(.36+r()*.06),H*(.46+r()*.06)),[H*(.32+r()*.05),H*(.29+r()*.04),H*(.2+r()*.03)]);}
  // 枝端原本停在冠底下方（冠和枝之間有縫）：枝端水平位置不變，往上伸到埋進冠底；那裡沒有冠或冠太薄就往幹收。
  for(const [tip,grow] of branches){let t,z=null;
   for(const deep of [false,true]){t=tip.clone();z=B.seat(crown,t,H*.016,H*CROWN_IN,deep);for(let k=0;z===null&&k<12;k++){t.x*=.9;t.y*=.9;z=B.seat(crown,t,H*.016,H*CROWN_IN,deep);}if(z!==null)break;}
   t.z=Math.max(tip.z,z??tip.z);grow(t);}
  const cand=verts.filter(({v,p})=>v.z>p.z+H*.04);
  for(const {v} of pick(r,cand,7+Math.floor(r()*4)))B.solid(T.tetra,{pos:v,scale:[H*.055,H*.055,H*.04],yaw:r()*TAU,color:()=>flower,facetAmt:.06});
 }
};

// 單棵樹的幾何（樹底在原點）：{species,seed,h,tris,position,normal,color,bounds:{reach,top,patch}}（reach＝水平最大半徑，patch＝貼片外緣半徑、沒鋪貼片是 0）。純函數：同參數逐值相同。
// shading：'volume'（預設：冠的頂點色做假 AO＋每棵色偏＋著地，再把冠的法線換成體積法線，冠的光影成一團量體）｜'gradient'（只做頂點色與著地）｜'flat'（平面著色，留作對照）。
// ground：樹下貼片的地色（hex），貼片外緣就是這個顏色；沒傳或 false＝不鋪貼片（false 給陡坡上的樹用，平的貼片在坡上會一半埋進土裡、一半懸空）。flat 著色忽略它。
export const SHADINGS=Object.freeze(['flat','gradient','volume']);
export function treeShape(species,seed,h,{shading='volume',ground}={}){
 const def=BY_ID.get(species);if(!def)throw new Error('taiwan-trees: unknown species '+species);
 if(!SHADINGS.includes(shading))throw new Error('taiwan-trees: unknown shading '+shading);
 const r=prng((seed>>>0)^SALT.get(species)),B=builder(r);
 SHAPES[species](B,r,h);
 return B.finish({species,seed:seed>>>0,h},{mode:shading,seed:(seed>>>0)^SALT.get(species),H:h,budget:def.budget,ground,patch:def.patch!==false,crownMin:CROWN_MIN_OF.get(species)??CROWN_MIN});
}

// 房子外框登記：把 props 的 townhouse／farmhouse 包一層，記下每棟的外框（樓身加陽台、雨遮、屋簷的外伸）。
// clearance(x,y)＝(x,y) 到最近一棟外框的水平距離（外框內回 0，還沒登記房子回 Infinity）；樹的 maxReach 取它減一點餘裕。
// outside(x,y,gap,within)＝樹心落在外框裡面的樹沒有任何樹種或高度能避開房子，這時沿最近的邊把它外推到離外框 gap（不在外框裡就原樣回傳 [x,y]，有傳 within 時仍要過 within）；呼叫端要另外傳 seed，樹種與樹形才不會跟著座標變。
//   最多推四輪。推完仍在某棟外框裡（沒有間隔的連棟會左推進隔壁、隔壁又推回來），或最後的點 within(x,y) 不成立（within 省略＝不限），回 null。外框只知道房子、不知道地面，底座邊緣要靠 within 擋。
// 預設尺寸與外伸量照 props.js 的 townhouse（正面最多外伸深度的一半加 .6）與 farmhouse（屋頂外伸 .2～.25）寫的，那邊改了這裡要跟著改。
export function trackHouses(props){
 const rects=[],{townhouse,farmhouse}=props;
 const add=(x,y,facing,hw,bk,fr)=>rects.push({x,y,tx:Math.cos(facing),ty:Math.sin(facing),fx:Math.sin(facing),fy:-Math.cos(facing),hw,bk,fr});
 props.townhouse=(x,y,z,o={})=>{const {width=2.6,depth=3.2,facing=0,roof='tin'}=o,e=roof==='pitched'?.15:.05;add(x,y,facing,width/2+e,depth/2+e,depth/2+.6);return townhouse(x,y,z,o);};
 props.farmhouse=(x,y,z,o={})=>{const {width=3.0,depth=2.4,facing=0,pitched=true}=o,e=pitched?.25:.2;add(x,y,facing,width/2+e,depth/2+e,depth/2+e);return farmhouse(x,y,z,o);};
 const local=(r,x,y)=>{const dx=x-r.x,dy=y-r.y;return[dx*r.tx+dy*r.ty,dx*r.fx+dy*r.fy];}; // 房子自己的座標：沿立面 a、往正面 c
 const clearance=(x,y)=>{let d=Infinity;for(const r of rects){const [a,c]=local(r,x,y);d=Math.min(d,Math.hypot(Math.max(Math.abs(a)-r.hw,0),Math.max(c>0?c-r.fr:-c-r.bk,0)));}return d;};
 const inside=(r,[a,c])=>Math.abs(a)<r.hw&&c>-r.bk&&c<r.fr;
 function outside(x,y,gap,within){
  for(let pass=0;pass<4;pass++){let moved=false;
   for(const r of rects){const [a,c]=local(r,x,y);if(!inside(r,[a,c]))continue;
    const side=[[r.hw-Math.abs(a),Math.sign(a)||1,0],[r.fr-c,0,1],[c+r.bk,0,-1]].reduce((m,q)=>q[0]<m[0]?q:m),da=side[1]*(side[0]+gap),dc=side[2]*(side[0]+gap);
    x+=da*r.tx+dc*r.fx;y+=da*r.ty+dc*r.fy;moved=true;}
   if(!moved)break;}
  if(rects.some(r=>inside(r,local(r,x,y)))||within&&!within(x,y))return null;
  return[x,y];
 }
 return{clearance,outside};
}

// 依比例抽樹種：mix 是 [[id,權重],…]；u 是 [0,1) 的亂數。
export function pickSpecies(mix,u){let sum=0;for(const [,w] of mix)sum+=w;let t=u*sum;for(const [id,w] of mix){if(t<w)return id;t-=w;}return mix[mix.length-1][0];}

// 降高的下限：maxReach 逼不得已降高時，最多降到自然高度的這個倍數；步長是比例一步降不到合時的逐步修正量。
const FIT_FLOOR=.75,FIT_STEP=.02;
// maxReach／maxPatch 只收數字（含 ±Infinity）或省略，其他一律丟錯：NaN 在大小比較時永遠算「放得下」，null 被當成 0、字串被當成數字比，結果都不是呼叫端想要的上限。
const checkLimit=(k,v)=>{if(v!==undefined&&(typeof v!=='number'||Number.isNaN(v)))throw new Error('taiwan-trees: '+k+' must be a number, got '+v);};

// 陰影圖的深度補償（防 shadow acne）：薄葉面（小葉欖仁的層盤、榕樹冠、血桐與筆筒樹的薄葉）自己蓋自己的陰影，深度精度不夠就在葉面上出現一條條細紋。
// 做法：樹的 mesh 掛 customDepthMaterial，寫進陰影圖的深度加 min(2·fwidth(z), cap)——斜面（z 變化快）多補一點，補償量以 cap 封頂。
// cap 是正規化深度（0～1，對應該場景陰影相機 near～far），不封頂的話榕樹的地面陰影會破洞；實測 .001～.002 之間結果相同，各景傳 .0015。
// three r170 的 polygonOffset 對陰影圖無效，所以只能改 shader。沒傳 shadowCap 就不掛（場景不開陰影時用不到）。
function depthMaterial(cap){
 const m=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});m.name='taiwan-trees-depth';
 m.onBeforeCompile=sh=>{sh.uniforms.depthCap={value:cap};sh.fragmentShader=sh.fragmentShader
  .replace('void main() {','uniform float depthCap;\nvoid main() {')
  .replace('float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;','float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;\n\tfragCoordZ += min( 2.0 * fwidth( fragCoordZ ), depthCap );');};
 m.customProgramCacheKey=()=>'taiwan-trees-depth';
 return m;
}

// shading 整批共用（見 treeShape）；ground 是預設地色（沒傳就不鋪貼片），plant 可以逐棵覆寫（{ground:false} 不鋪貼片）。
// shadowCap：陰影深度補償上限（見 depthMaterial），省略＝不補。
export function createTaiwanTrees({geo=g=>g,material=m=>m,shading='volume',ground,shadowCap}={}){
 if(!SHADINGS.includes(shading))throw new Error('taiwan-trees: unknown shading '+shading);
 const spots=[];let mesh=null,geometry=null,mat=null,depthMat=null;
 const make=(id,s,h,g)=>treeShape(id,s,h,{shading,ground:g});
 // 冠幅壓進 maxReach：自然高度就合就原樣；不合先照比例一步降到合，不夠再每次降 FIT_STEP，最低到 FIT_FLOOR 倍（到底還超過就留在底線）。reach 近似與 h 成正比，多半一步就合。
 function fitReach(id,s,h,g,maxReach,first=make(id,s,h,g)){
  if(!(first.bounds.reach>maxReach))return{shape:first,h};
  let k=Math.max(FIT_FLOOR,Math.min(1,maxReach/first.bounds.reach)*.99);
  for(;;){const hh=h*k,shape=make(id,s,hh,g);if(!(shape.bounds.reach>maxReach)||k<=FIT_FLOOR)return{shape,h:hh};k=Math.max(FIT_FLOOR,k-FIT_STEP);}
 }
 // 登記一棵：貼片半徑超過 maxPatch（會伸出所在地面的邊緣）就改成不鋪貼片，位置不動。fit 只在傳了 maxReach／maxPatch 時記錄，驗收與場景對帳用；fit.over＝降到底線仍超過 maxReach。
 function settle(id,s,x,y,z,h,g,shape,maxPatch,fit){
  if(g&&shape.bounds.patch>maxPatch){shape=make(id,s,h,false);g=false;}
  fit.over=fit.reach>fit.maxReach;
  spots.push({species:id,seed:s,x,y,z,h,shading,ground:g,shape,fit});return shape;
 }
 // maxReach：樹冠水平半徑（bounds.reach）的上限，給靠近房子、牆的樹用；maxPatch：樹下貼片半徑的上限（到所在地面邊緣的距離）。兩者都省略時，行為與沒有這兩個參數逐值相同。
 function plant(species,x,y,z,h=2.2,{seed,ground:g=ground,maxReach,maxPatch}={}){
  checkLimit('maxReach',maxReach);checkLimit('maxPatch',maxPatch);
  const s=(seed??seedFromPosition(x,y))>>>0;
  if(maxReach===undefined&&maxPatch===undefined){const shape=make(species,s,h,g);spots.push({species,seed:s,x,y,z,h,shading,ground:g,shape});return shape;}
  const r=fitReach(species,s,h,g,maxReach);
  return settle(species,s,x,y,z,r.h,g,r.shape,maxPatch,{maxReach,drawn:species,h0:h,reach:r.shape.bounds.reach});
 }
 function plantMix(mix,x,y,z,h=2.2,{seed,ground:g=ground,maxReach,maxPatch}={}){
  checkLimit('maxReach',maxReach);checkLimit('maxPatch',maxPatch);
  const s=(seed??seedFromPosition(x,y))>>>0,id=pickSpecies(mix,prng(s^MIX_SALT)()),h0=h*BY_ID.get(id).relH;
  if(!(maxReach<Infinity))return plant(id,x,y,z,h0,{seed:s,ground:g,maxPatch});
  // 抽到的樹種冠幅超過上限：依序改試組合裡其他的種（權重大的先），第一個自然高度就合的勝出；都不合就取冠幅最窄的那種，再降高（見 fitReach）。
  const order=[id,...mix.filter(([m])=>m!==id).sort((a,b)=>b[1]-a[1]).map(([m])=>m)],tried=[];
  for(const c of order){const ch=h*BY_ID.get(c).relH,shape=make(c,s,ch,g);tried.push({c,ch,shape});
   if(!(shape.bounds.reach>maxReach))return settle(c,s,x,y,z,ch,g,shape,maxPatch,{maxReach,drawn:id,h0,reach:shape.bounds.reach});}
  const n=tried.reduce((a,b)=>b.shape.bounds.reach<a.shape.bounds.reach?b:a),r=fitReach(n.c,s,n.ch,g,maxReach,n.shape);
  return settle(n.c,s,x,y,z,r.h,g,r.shape,maxPatch,{maxReach,drawn:id,h0,reach:r.shape.bounds.reach});
 }
 function build(parent){
  let n=0;for(const t of spots)n+=t.shape.position.length;
  const P=new Float32Array(n),N=new Float32Array(n),K=new Float32Array(n);let o=0;
  for(const t of spots){const s=t.shape,len=s.position.length;for(let i=0;i<len;i+=3){P[o+i]=s.position[i]+t.x;P[o+i+1]=s.position[i+1]+t.y;P[o+i+2]=s.position[i+2]+t.z;}N.set(s.normal,o);K.set(s.color,o);o+=len;}
  geometry=geo(new THREE.BufferGeometry());
  geometry.setAttribute('position',new THREE.BufferAttribute(P,3));geometry.setAttribute('normal',new THREE.BufferAttribute(N,3));geometry.setAttribute('color',new THREE.BufferAttribute(K,3));
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  // volume 著色要讀頂點法線，所以關掉 flatShading；木頭與貼片的法線本來就是寫進去的面法線，照樣是平面著色。
  mat=material(new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,flatShading:shading!=='volume',roughness:.85}));mat.name='taiwan-trees';
  mesh=new THREE.Mesh(geometry,mat);mesh.name='taiwan-trees';mesh.castShadow=mesh.receiveShadow=true;
  if(shadowCap>0)mesh.customDepthMaterial=depthMat=material(depthMaterial(shadowCap));
  parent.add(mesh);
  return mesh;
 }
 function dispose(){mesh?.removeFromParent();geometry?.dispose();mat?.dispose();depthMat?.dispose();mesh=geometry=mat=depthMat=null;}
 function stats(){const by={};let tris=0;for(const t of spots){tris+=t.shape.tris;const b=by[t.species]??={count:0,tris:0,max:0};b.count++;b.tris+=t.shape.tris;b.max=Math.max(b.max,t.shape.tris);}return{trees:spots.length,tris,bySpecies:by,over:spots.filter(t=>t.fit?.over).length};}
 return{plant,plantMix,build,dispose,stats,spots,get count(){return spots.length;},get mesh(){return mesh;}};
}

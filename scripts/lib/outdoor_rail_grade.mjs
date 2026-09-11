// 露天段（高架＋平面）的顯示縱坡。舊做法是「執行期地表＋層位」：橋面逐點複製 DEM 的每一個起伏，
// 平面軌道則直接踩在 20 公尺 DTM 的雜訊上，整條線上上下下、坡度動輒兩位數。
// 這裡在每個 OSM 節點、交會點與每 100 公尺設一個節點，求「最接近 DEM＋層位、又不超過該系統縱坡上限」的剖面：
//   U＝不低於目標的最平緩剖面（上包絡）、L＝不高於目標的最平緩剖面（下包絡），取兩者中線；
//   再抬到下界包絡 B 之上（高架至少離地 CLEAR，平面不低於地表：低於 DEM 的軌道會被地形蓋住，畫了也看不見）；與已求解的林口走廊相接的節點釘死。
// 包絡都沿連線用各系統縱坡傳播，所以結果在節點上一定符合縱坡上限；分岔與交會靠共用節點自然連續。
// 交會處只抬上方股道（沿縱坡做帳篷狀抬升），下方不動；隧道稍後另解，洞口會接到這裡算出的高程。
// 只改顯示高程，不改平面線形；縱坡上限、淨空與挖深都是顯示估計，不是測量或竣工標高。
import {gradeOf} from './tunnel_rail_grade.mjs';
const STEP=100,CLEAR=6,CUT=0,GAP=7,SMOOTH_PASSES=16,DENSE=10,BURY=.25;
export async function applyOutdoorRailGrade(records,entries,groundAt,crossings){
 const done=new Set(Object.keys(entries).filter(id=>entries[id].terrainValues));
 const sample=(r,s,key)=>{const e=entries[r.w.id];if(!e?.[key])return null;let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e[key][i]*(1-t)+e[key][j]*t;};
 const outdoor=records.filter(r=>r.c.kind!=='tunnel'&&!done.has(String(r.w.id)));
 const nodeWays=new Map();for(const r of records)for(const n of r.w.nodes){const k=r.w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(r);}
 const knots=new Map(),links=[],byWay=new Map(),sources=new Map();
 for(const r of outdoor){
  const len=r.distances.at(-1),G=gradeOf(r.w.system),source=new Map(r.path.d.map((s,i)=>[s,r.w.system+':'+r.w.nodes[i]]));sources.set(r,source);
  const steps=Array.from({length:Math.max(0,Math.ceil(len/STEP)-1)},(_,i)=>(i+1)*STEP);
  const distances=[...new Set([0,...steps,...r.path.d,...r.pins.map(p=>p.s),len])].sort((a,b)=>a-b),local=[];
  for(const s of distances){
   const node=source.get(s),id=node||r.w.id+':'+s;let k=knots.get(id);
   if(!k)knots.set(id,k={h:0,n:0,ground:0,t:0,b:-Infinity,links:[],system:r.w.system});
   const ground=await groundAt(r.path.at(s).coordinate),offset=sample(r,s,'offsets')??0;
   k.ground+=ground;k.t+=ground+offset;k.n++;
   k.b=Math.max(k.b,ground+(r.c.kind==='bridge'?CLEAR:-CUT));
   // 與已求解股道（林口走廊）相接的節點：沿用它的顯示高程，接縫才不會有落差。
   if(node)for(const o of nodeWays.get(node)||[]){if(!done.has(String(o.w.id)))continue;const idx=o.w.nodes.indexOf(node.slice(node.indexOf(':')+1));const t=idx<0?null:sample(o,o.path.d[idx],'terrainValues');if(t!==null)k.fixedTo=t;}
   local.push({s,k});
  }
  const pieces=[];for(let i=1;i<local.length;i++){const a=local[i-1],b=local[i];if(a.k===b.k)continue;const link={r,start:a.s,end:b.s,len:Math.max(b.s-a.s,1e-6),G,a:a.k,b:b.k};links.push(link);pieces.push(link);a.k.links.push(link);b.k.links.push(link);}
  byWay.set(r,pieces);
 }
 for(const k of knots.values()){k.ground/=k.n;k.t/=k.n;}
 const knotOf=pin=>{const source=sources.get(pin.r);if(!source)return null;return knots.get(source.get(pin.s)||pin.r.w.id+':'+pin.s)||null;};
 // 包絡傳播：sign>0 取「來源值減縱坡×距離」的最大值，sign<0 取「來源值加縱坡×距離」的最小值。
 // 連線依里程排好，正反交替掃，單一鏈兩趟就收斂；分岔與環路多掃幾趟。
 const reversed=[...links].reverse();
 const propagate=(field,sign)=>{for(let pass=0;pass<600;pass++){let changed=false;
  for(const {a,b,len,G}of pass%2?reversed:links){const d=G*len;
   if(sign>0){if(a[field]-d>b[field]+1e-6){b[field]=a[field]-d;changed=true;}if(b[field]-d>a[field]+1e-6){a[field]=b[field]-d;changed=true;}}
   else{if(a[field]+d<b[field]-1e-6){b[field]=a[field]+d;changed=true;}if(b[field]+d<a[field]-1e-6){a[field]=b[field]+d;changed=true;}}}
  if(!changed)return pass+1;}return Infinity;};
 for(const k of knots.values()){k.U=k.t;k.L=k.t;k.B=k.b;k.lo=k.fixedTo??-Infinity;k.hi=k.fixedTo??Infinity;}
 // 上方是已求解股道（林口走廊）、下方在本圖上的交會：下方不得高過上方減淨距。這條上界也沿縱坡傳播，
 // 否則平滑與填方抬升會把下方股道頂進走廊的淨空（2026-09-11 林口閘門實際抓到 5.4 公尺）。
 for(const [u,l]of crossings){if(knotOf(u))continue;const kl=knotOf(l),high=sample(u.r,u.s,'terrainValues');if(!kl||high===null)continue;kl.hi=Math.min(kl.hi,high-GAP);}
 const passes={U:propagate('U',1),L:propagate('L',-1),B:propagate('B',1),lo:propagate('lo',1),hi:propagate('hi',-1)};
// 中線只削掉超過縱坡的部分：縱坡內的小起伏（DEM 雜訊、一公尺上下）會原封不動穿過去，橋面看起來仍在打浪。
 // 沿連線做加權拉普拉斯平滑（權重 1/距離，16 趟約等於 ±250 公尺的高斯窗），再抬回下界包絡、夾進釘死節點的錐體。
 // 正權重的平均不會放大坡度，所以平滑後仍在縱坡上限內。
 for(const k of knots.values())k.h=(k.U+k.L)/2;
 for(let pass=0;pass<SMOOTH_PASSES;pass++){for(const k of knots.values()){if(k.fixedTo!==undefined||!k.links.length)continue;let num=0,den=0;for(const l of k.links){const o=l.a===k?l.b:l.a,w=1/Math.max(l.len,1);num+=o.h*w;den+=w;}k.next=k.h+.5*(num/den-k.h);}for(const k of knots.values())if(k.next!==undefined){k.h=k.next;delete k.next;}}
 for(const k of knots.values())k.h=Math.min(Math.max(k.h,k.B,k.lo),k.hi);
 // 交會淨距：只抬上方股道。從交會點沿連線往外，抬升量隨距離以該連線的縱坡遞減（帳篷），
 // 所以抬完仍符合縱坡上限；釘死的節點不動也不傳。下方是還沒求解的隧道時交給隧道求解器（它以這裡的高程當上界）。
 const raise=(k,target)=>{const queue=[[k,0]],reached=new Map([[k,0]]);while(queue.length){const [x,d]=queue.shift();if(x.fixedTo!==undefined)continue;const want=Math.min(target-d,x.hi);if(want>x.h+1e-6)x.h=want;
  for(const l of x.links){const y=l.a===x?l.b:l.a,dy=d+l.G*l.len;if(target-dy<=y.h+1e-6||(reached.get(y)??Infinity)<=dy)continue;reached.set(y,dy);queue.push([y,dy]);}}};
 let tents=0,residual=0,blocked=0;
 for(let pass=0;pass<12;pass++){let any=false;
  for(const [u,l]of crossings){const ku=knotOf(u);if(!ku)continue;const kl=knotOf(l),low=kl?kl.h:sample(l.r,l.s,'terrainValues');if(low===null)continue;
   const deficit=low+GAP-ku.h;if(deficit<=.01)continue;raise(ku,low+GAP);tents++;any=true;}
  if(!any)break;}
 for(const [u,l]of crossings){const ku=knotOf(u);if(!ku)continue;const kl=knotOf(l),low=kl?kl.h:sample(l.r,l.s,'terrainValues');if(low===null)continue;const deficit=low+GAP-ku.h;if(deficit>.01){residual=Math.max(residual,deficit);blocked++;}}
 const tangent=(k,link)=>{const own=(link.b.h-link.a.h)/link.len,other=k.links.find(l=>l!==link);if(!other)return own;const neighbor=other.a===k?other.b:other.a,adjacent=link.a===k?(k.h-neighbor.h)/other.len:(neighbor.h-k.h)/other.len;return own*adjacent<=0?0:2*own*adjacent/(own+adjacent);};
 const hermite=(l,d)=>{const {a,b,len}=l,m0=tangent(a,l),m1=tangent(b,l),t=Math.max(0,Math.min(1,(d-l.start)/len)),t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*a.h+(t3-2*t2+t)*len*m0+(-2*t3+3*t2)*b.h+(t3-t2)*len*m1;};
 const pieceAt=(pieces,d)=>pieces.find(l=>d<=l.end)||pieces.at(-1);
 // 節點之間的 DEM 突起：節點每 100 公尺一個，兩節點之間的 20 公尺 DTM 小丘（一兩公尺高、二三十公尺寬）沒被任何節點看到，
 // 平滑後的剖面會從它底下穿過去——2026-09-12 實測臺鐵平面段 5.2 公里低於 DEM 逾 1 公尺、19.6 公里逾 .5 公尺，
 // 瀏覽器接地閘門在新竹 391706267 量到 −1.03 公尺。每 10 公尺取一次地面，埋住的地方把兩端節點以帳篷抬到地面（高架加淨空）：
 // 帳篷沿縱坡遞減、釘死節點不動、林口走廊的上界照樣管得住，抬完仍在縱坡上限內。最多三輪，剩下的計入 buried.after。
 const floors=new Map();
 for(const [r]of byWay){const len=r.distances.at(-1),clear=r.c.kind==='bridge'?CLEAR:0,rows=[];for(let s=DENSE;s<len;s+=DENSE){const g=await groundAt(r.path.at(s).coordinate);if(Number.isFinite(g))rows.push([s,g+clear]);}floors.set(r,rows);}
 const buried={before:0,after:0,raised:0};
 for(let round=0;round<3;round++){let count=0;
  for(const [r,pieces]of byWay)for(const [s,f]of floors.get(r)){const l=pieceAt(pieces,s);if(hermite(l,s)>=f-BURY)continue;count++;for(const k of [l.a,l.b])if(k.h<f-1e-6){raise(k,f);buried.raised++;}}
  if(!round)buried.before=count;if(!count)break;}
 for(const [r,pieces]of byWay)for(const [s,f]of floors.get(r))if(hermite(pieceAt(pieces,s),s)<f-BURY)buried.after++;
 const ids=[],deviation={};let below=0;
 for(const k of knots.values()){const d=Math.abs(k.h-k.t),s=k.system;deviation[s]=Math.max(deviation[s]||0,d);if(k.h<k.b-.01)below++;}
 for(const [r,pieces]of byWay){let e=entries[r.w.id];if(!e)entries[r.w.id]=e={...r.c,distances:r.distances,offsets:r.distances.map(()=>0),values:r.distances.map(d=>+r.at(d).toFixed(4))};
  e.terrainValues=e.distances.map(d=>+hermite(pieceAt(pieces,d),d).toFixed(2));
  e.terrainBasis='露天段連續縱坡（原始 DEM 加層位為目標，各系統縱坡上限內取最接近的剖面；高架至少離地 6 公尺、平面不低於地表、交會抬上方股道）';e.terrainTransition=false;ids.push(String(r.w.id));}
 return {ids,knots:knots.size,links:links.length,passes,tents,blocked,residual:+residual.toFixed(2),below,buried,deviation:Object.fromEntries(Object.entries(deviation).map(([k,v])=>[k,+v.toFixed(1)]))};
}

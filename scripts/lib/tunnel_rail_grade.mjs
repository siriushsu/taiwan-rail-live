// 隧道內部預設為直線：洞口沿用相接股道的現有顯示高程，內部沿里程調和內插。
// 舊做法把隧道畫成「地表減固定深度」，於是隧道跟著山坡爬升；offsets 平順並不代表顯示高程平順。
// 只改顯示高程，不改平面線形；覆土深度與縱坡上限都是顯示估計，不是測量或竣工標高。
export const GRADE={tra_sched:.025,thsr_sched:.025,afr_sched:.06},COVER=8,STEP=100;
export const gradeOf=system=>GRADE[system]??.04;
export async function applyTunnelGrade(records,entries,groundAt){
 const done=new Set(Object.keys(entries).filter(id=>entries[id].terrainValues));
 const sample=(r,s,key)=>{const e=entries[r.w.id];if(!e?.[key])return null;let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e[key][i]*(1-t)+e[key][j]*t;};
 const tunnels=new Set(records.filter(r=>entries[r.w.id]?.kind==='tunnel'&&!done.has(String(r.w.id))));
 // 依共用節點與同系統把隧道 way 串成一條連續隧道；洞口＝與非本段股道相接的節點。
 const nodeWays=new Map();for(const r of records)for(const n of r.w.nodes){const k=r.w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(r);}
 // 共用節點落在某條 way「中段」時,舊做法只有 way 端點用 system:node 當鍵,中段一律用私有鍵
 // wayId:cross:s ⇒ 同一個節點被兩條 way 各自內插出不同顯示高度。車廂高度是逐節取樣的,跨過這種
 // 節點的列車會當場折斷(2026-09-12 實測沿實跑路線:臺鐵板橋／萬華地下段 4.3m、高鐵臺北站 7.3m、
 // 南迴線 11.0m)。把中段共用節點也做成共用鍵,兩側由同一個 knot 決定高度,連續性由結構保證。
 const sharedNodes=new Set();for(const [k,list] of nodeWays)if(list.length>1)sharedNodes.add(k);
 const placed=new Set(),runs=[];
 for(const seed of tunnels){if(placed.has(seed))continue;const stack=[seed],run=[];placed.add(seed);
  while(stack.length){const cur=stack.pop();run.push(cur);for(const n of cur.w.nodes)for(const o of nodeWays.get(cur.w.system+':'+n)||[])if(tunnels.has(o)&&!placed.has(o)){placed.add(o);stack.push(o);}}
  runs.push(run);}
 const ids=[],report=[];
 for(const run of runs){
  const member=new Set(run.map(r=>String(r.w.id))),grade=gradeOf(run[0].w.system),knots=new Map(),links=[],byWay=new Map();
  for(const r of run){
   // 每 STEP 公尺補一個節點：只在 way 端點求解時，縱坡上限與覆土上界在長 way 中段完全不生效，
   // 內插曲線也會比兩端弦線陡得多。
   const len=r.distances.at(-1),steps=Array.from({length:Math.max(0,Math.ceil(len/STEP)-1)},(_,i)=>(i+1)*STEP);
   const midNodes=new Map();for(let i=1;i<r.w.nodes.length-1;i++){const s=r.path.d[i];if(s>0&&s<len&&sharedNodes.has(r.w.system+':'+r.w.nodes[i]))midNodes.set(s,String(r.w.nodes[i]));}
   const distances=[...new Set([0,...steps,...midNodes.keys(),...r.pins.map(p=>p.s),len])].sort((a,b)=>a-b),local=[];
   for(const s of distances){
    const end=s===0?0:s===len?-1:null,node=end===null?(midNodes.get(s)??null):String(r.w.nodes.at(end)),id=node===null?r.w.id+':cross:'+s:r.w.system+':'+node;
    let k=knots.get(id);if(!k)knots.set(id,k={h:0,n:0,links:[],ground:0,hold:0,min:-Infinity,max:Infinity,portal:false});
    const ground=await groundAt(r.path.at(s).coordinate);k.ground+=ground;k.hold+=ground+(sample(r,s,'offsets')??0);k.n++;
    // 洞口：相接的股道不在本段內。它已經畫在地表附近，隧道端點必須沿用它的顯示高程才不會出現落差。
    for(const o of node===null?[]:nodeWays.get(r.w.system+':'+node)||[])if(!member.has(String(o.w.id))){k.portal=true;const os=o.w.nodes.indexOf(node)>=0?o.path.d[o.w.nodes.indexOf(node)]:null;const t=os===null?null:sample(o,os,'terrainValues');if(t!==null)k.fixedTo=t;}
    // 保留已求解的跨線上下序：交叉約束是下限／上限，不是等式。
    for(const pin of r.pins.filter(p=>p.s===s)){const shown=sample(pin.other.r,pin.other.s,'terrainValues'),z=(shown??ground+(sample(pin.other.r,pin.other.s,'offsets')??0))+(pin.above?7:-7);if(pin.above)k.min=Math.max(k.min,z);else k.max=Math.min(k.max,z);}
    local.push({s,k});
   }
   const pieces=[];for(let i=1;i<local.length;i++){const a=local[i-1],b=local[i],link={r,start:a.s,end:b.s,len:b.s-a.s||1e-6,a:a.k,b:b.k};links.push(link);pieces.push(link);a.k.links.push(link);b.k.links.push(link);}
   byWay.set(r,pieces);
  }
  for(const k of knots.values()){k.ground/=k.n;k.hold/=k.n;k.h=k.fixedTo??k.hold;
   // 只有一條連線又不是洞口的端點＝分岔支洞接在主洞「中段」的節點。主洞那一側的節點鍵是
   // way 內部取樣（wayId:cross:s），與支洞端點的 system:node 不同鍵，所以兩邊在求解圖上沒有相連，
   // 這個端點等於自由浮動卻被當成固定值。它位在山體內部，一律壓回覆土上界，
   // 不能沿用「地表＋層位」——山岳隧道改用相鄰高架層位之後，那會把它釘到地表之上。
   if(!k.portal&&k.links.length===1)k.h=Math.min(k.h,k.ground-COVER);
   if(k.portal||k.links.length===1)k.fixed=true;else k.max=Math.min(k.max,k.ground-COVER); // 自由節點只受覆土上界，不再逐點貼著地表
   k.reach=k.fixed?k.h:-Infinity;k.floor=k.fixed?k.h:Infinity;}
  // 先求無約束的調和解：單一鏈時它就是兩端洞口之間沿里程的直線，當作初值與「無解時退回哪裡」。
  for(const k of knots.values())k.chord=k.h;
  if([...knots.values()].some(k=>k.fixed))for(let it=0;it<20000;it++){let move=0;
   for(const k of knots.values()){if(k.fixed)continue;let num=0,den=0;for(const l of k.links){const other=l.a===k?l.b:l.a,w=1/Math.max(l.len,1);num+=other.chord*w;den+=w;}const h=k.chord+1.85*(num/den-k.chord);move=Math.max(move,Math.abs(h-k.chord));k.chord=h;}
   if(move<.0005)break;}
  // 洞口高程與縱坡上限優先於覆土：沿縱坡把上下界放寬到可行，否則投影會在兩個互斥的約束之間來回震盪。
  for(let pass=0;pass<knots.size;pass++){let changed=false;
   for(const {a,b,len}of links)for(const [x,y]of [[a,b],[b,a]]){const r=x.reach-len*grade,f=x.floor+len*grade;if(r>y.reach+1e-9){y.reach=r;changed=true;}if(f<y.floor-1e-9){y.floor=f;changed=true;}}
   if(!changed)break;}
  // reach＝從洞口以上限縱坡最多能降到的高度，floor＝最多能升到的高度。兩者交錯代表洞口高差本身
  // 就超過縱坡上限（短隧道兩端地形落差大），此時洞口優先：釘在兩端連線上，另計為 steep。
  for(const k of knots.values()){if(k.fixed)continue;
   if(k.reach>k.floor+1e-6){k.h=k.chord;k.min=k.max=k.h;k.fixed=k.pinned=true;continue;}
   k.max=Math.min(Math.max(k.max,k.reach),k.floor);k.min=Math.max(Math.min(k.min,k.floor),k.reach);k.h=Math.max(k.min,Math.min(k.max,k.chord));}
  // 調和內插＋約束投影：單一鏈且無約束作用時，解就是沿里程的直線。
  // 兩端都是洞口的短隧道無自由度，縱坡由洞口地形決定；那不是未收斂，另計為 steep。
  let moved=0,steep=0;for(let it=0;it<40000;it++){
   moved=0;steep=0;
   for(const k of knots.values()){if(k.fixed)continue;let num=0,den=0;for(const l of k.links){const other=l.a===k?l.b:l.a,w=1/Math.max(l.len,1);num+=other.h*w;den+=w;}const h=Math.max(k.min,Math.min(k.max,num/den));moved=Math.max(moved,Math.abs(h-k.h));k.h=h;}
   // 縱坡投影帶阻尼：覆土上界與交會下界偶爾互斥，硬投影會在兩者之間永遠來回。
   for(const {a,b,len}of links){const delta=b.h-a.h,over=Math.abs(delta)-len*grade;if(over<=0)continue;const d=over*Math.sign(delta)*.7;if(a.fixed&&b.fixed){steep=Math.max(steep,over);continue;}moved=Math.max(moved,over);if(a.fixed)b.h-=d;else if(b.fixed)a.h+=d;else{a.h+=d/2;b.h-=d/2;}}
   for(const k of knots.values()){if(k.fixed)continue;const h=Math.max(k.min,Math.min(k.max,k.h));moved=Math.max(moved,Math.abs(h-k.h));k.h=h;}
   if(moved<.0005)break;
  }
  // 最後硬性套一次縱坡上限：迭代中它與調和項互相拉鋸，洞口附近會停在比上限陡的平衡點。
  // 只夾自由節點，所以洞口高程與釘住的弦線都不會被動到。
  for(let pass=0;pass<=knots.size;pass++){let changed=false;
   for(const {a,b,len}of links)for(const [x,y]of [[a,b],[b,a]]){if(y.fixed)continue;const lo=x.h-len*grade,hi=x.h+len*grade;
    if(y.h<lo-1e-6){y.h=lo;changed=true;}else if(y.h>hi+1e-6){y.h=hi;changed=true;}}
   if(!changed)break;}
  const tangent=(k,link)=>{const own=(link.b.h-link.a.h)/link.len,other=k.links.find(l=>l!==link);if(!other)return own;const neighbor=other.a===k?other.b:other.a,adjacent=link.a===k?(k.h-neighbor.h)/other.len:(neighbor.h-k.h)/other.len;return own*adjacent<=0?0:2*own*adjacent/(own+adjacent);};
  for(const [r,pieces]of byWay){const e=entries[r.w.id];
   e.terrainValues=e.distances.map(d=>{const l=pieces.find(l=>d<=l.end)||pieces.at(-1),{a,b,len}=l,m0=tangent(a,l),m1=tangent(b,l),t=(d-l.start)/len,t2=t*t,t3=t2*t;return +((2*t3-3*t2+1)*a.h+(t3-2*t2+t)*len*m0+(-2*t3+3*t2)*b.h+(t3-t2)*len*m1).toFixed(4);});
   e.terrainBasis='隧道洞口間連續縱坡（原始 DEM 洞口估計，內部沿里程直線，保留交會淨距）';e.terrainTransition=false;ids.push(String(r.w.id));}
  report.push({system:run[0].w.system,ways:run.map(r=>String(r.w.id)),knots:knots.size,pinned:[...knots.values()].filter(k=>k.pinned).length,error:+moved.toFixed(4),steep:+steep.toFixed(3)});
 }
 return {ids,runs:runs.length,worst:Math.max(0,...report.map(r=>r.error)),steep:report.filter(r=>r.steep>.5).length,report};
}

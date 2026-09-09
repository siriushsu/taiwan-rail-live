// 已查證之龜山／林口橋隧走廊：原始 DEM 洞口／橋端估算，不使用舊地表淨空上包絡。
// 僅改顯示高程，不改平面線形；不是測量或竣工標高。
export async function applyLinkouRailGrade(records,entries,groundAt){
 const selected=records.filter(r=>r.w.system==='thsr_sched'&&r.w.coordinates.some(([x,y])=>x>=121.298&&x<=121.412&&y>=25&&y<=25.06));
 const knots=new Map(),links=[],byWay=new Map();
 const sample=(r,s)=>{const e=entries[r.w.id];if(!e)return 0;let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e.offsets[i]*(1-t)+e.offsets[j]*t;};
 for(const r of selected){
  const len=r.distances.at(-1),distances=[...new Set([0,...r.pins.map(p=>p.s),len])].sort((a,b)=>a-b),local=[];
  for(const s of distances){
   const end=s===0?0:s===len?-1:null,id=end!==null?String(r.w.nodes.at(end)):r.w.id+':cross:'+s;
   let k=knots.get(id);if(!k)knots.set(id,k={h:0,n:0,links:[],ground:0,min:-Infinity,max:Infinity});
   const ground=await groundAt(r.path.at(s).coordinate);k.ground+=ground;k.h+=ground+(r.c.kind==='tunnel'?-3:r.c.kind==='bridge'?8:0);k.n++;
   // 保留已求解的跨線上下序；交叉約束是下限／上限，讓鄰近交叉可以共用平順橋面。
   for(const pin of r.pins.filter(p=>p.s===s)){const z=ground+sample(pin.other.r,pin.other.s)+(pin.above?7:-7);if(pin.above)k.min=Math.max(k.min,z);else k.max=Math.min(k.max,z);}
   local.push({s,k});
  }
  const pieces=[];for(let i=1;i<local.length;i++){const a=local[i-1],b=local[i],link={r,start:a.s,end:b.s,len:b.s-a.s,a:a.k,b:b.k};links.push(link);pieces.push(link);link.a.links.push(link);link.b.links.push(link);}byWay.set(r,pieces);
 }
 for(const k of knots.values()){k.h/=k.n;k.ground/=k.n;if(k.links.length===1){const l=k.links[0],s=l.a===k?l.start:l.end;k.h=k.ground+sample(l.r,s);k.fixed=true;}k.h=Math.max(k.min,Math.min(k.max,k.h));}
 for(let it=0;it<4000;it++){
  let error=0;for(const {a,b,len}of links){const delta=b.h-a.h,over=Math.abs(delta)-len*.025;if(over>0){const d=over*Math.sign(delta);error=Math.max(error,over);if(a.fixed)b.h-=d;else if(b.fixed)a.h+=d;else{a.h+=d/2;b.h-=d/2;}}}
  for(const k of knots.values()){const h=Math.max(k.min,Math.min(k.max,k.h));error=Math.max(error,Math.abs(h-k.h));k.h=h;}
  if(error<.0001)break;if(it===3999)throw Error('林口橋隧縱坡未收斂：'+error);
 }
 const tangent=(k,link)=>{const own=(link.b.h-link.a.h)/link.len,other=k.links.find(l=>l!==link);if(!other)return own;const neighbor=other.a===k?other.b:other.a,adjacent=link.a===k?(k.h-neighbor.h)/other.len:(neighbor.h-k.h)/other.len;return own*adjacent<=0?0:2*own*adjacent/(own+adjacent);};
 const ids=[];
 for(const [r,pieces]of byWay){let e=entries[r.w.id];if(!e)entries[r.w.id]=e={...r.c,distances:r.distances,offsets:r.distances.map(()=>0),values:r.distances.map(d=>r.at(d))};
  e.terrainValues=e.distances.map(d=>{const l=pieces.find(l=>d<=l.end)||pieces.at(-1),{a,b,len}=l,m0=tangent(a,l),m1=tangent(b,l),t=(d-l.start)/len,t2=t*t,t3=t2*t;return +((2*t3-3*t2+1)*a.h+(t3-2*t2+t)*len*m0+(-2*t3+3*t2)*b.h+(t3-t2)*len*m1).toFixed(4);});
  e.terrainBasis='林口台地橋隧與洞口連續縱坡（原始 DEM 端點估計，保留交會淨距）';e.terrainTransition=r.c.kind==='surface';ids.push(String(r.w.id));
 }return ids;
}

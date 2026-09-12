export function collectLevelCrossings(records){
const segments=[],grid=new Map(),seen=new Set(),crossings=[];
for(const r of records){r.pins=[];const w=r.w;
for(let i=1;i<w.coordinates.length;i++){const a=w.coordinates[i-1],b=w.coordinates[i],ix=segments.length;segments.push({r,a,b,i});for(let x=Math.floor(Math.min(a[0],b[0])*250);x<=Math.floor(Math.max(a[0],b[0])*250);x++)for(let y=Math.floor(Math.min(a[1],b[1])*250);y<=Math.floor(Math.max(a[1],b[1])*250);y++){const k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(ix);}}}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
for(const ids of grid.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=ids[i]+':'+ids[j];if(seen.has(key))continue;seen.add(key);const a=segments[ids[i]],b=segments[ids[j]];if(a.r.w.id===b.r.w.id||a.r.c.rank===b.r.c.rank)continue;const da=[a.b[0]-a.a[0],a.b[1]-a.a[1]],db=[b.b[0]-b.a[0],b.b[1]-b.a[1]],q=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(da,db);if(Math.abs(den)<1e-16)continue;let t=cross(q,db)/den,u=cross(q,da)/den;if(t< -1e-8||t>1+1e-8||u< -1e-8||u>1+1e-8)continue;t=t<1e-8?0:t>1-1e-8?1:t;u=u<1e-8?0:u>1-1e-8?1:u;
 const na=t===0?a.r.w.nodes[a.i-1]:t===1?a.r.w.nodes[a.i]:null,nb=u===0?b.r.w.nodes[b.i-1]:u===1?b.r.w.nodes[b.i]:null;if(na&&nb&&na===nb&&a.r.w.system===b.r.w.system)continue;
 const pins=[[a,t],[b,u]].map(([seg,f])=>{const r=seg.r,s=r.path.d[seg.i-1]+(r.path.d[seg.i]-r.path.d[seg.i-1])*f,pin={r,s};r.pins.push(pin);return pin;});crossings.push(pins.sort((a,b)=>b.r.c.rank-a.r.c.rank));}
return crossings;
}

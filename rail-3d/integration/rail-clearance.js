// 靜態平面檢查：未有軌道層位資料時，不能把實心外觀模型硬疊在行車走廊。
// 不移動路線／列車，也不把排除判定冒充為已完成地下或高架工程。
export const RAIL_CLEARANCE_M=18;
const CELL=.004,scaleX=101000,scaleY=111320;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function pointDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
function intersects(a,b,c,d){const ab=[cross(a,b,c),cross(a,b,d)],cd=[cross(c,d,a),cross(c,d,b)];return ab[0]*ab[1]<=0&&cd[0]*cd[1]<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]));}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function createRailClearance(){let refs=[],grid=new Map(),revision=0;const cache=new WeakMap();
  function update(routes){const unique=[...new Set(routes.map(r=>r.coordinates).filter(Boolean))];if(unique.length===refs.length&&unique.every(c=>refs.includes(c)))return false;refs=unique;grid=new Map();revision++;
    for(const coordinates of refs)for(let i=1;i<coordinates.length;i++){const a=coordinates[i-1],b=coordinates[i],segment={a,b};for(let x=Math.floor(Math.min(a[0],b[0])/CELL);x<=Math.floor(Math.max(a[0],b[0])/CELL);x++)for(let y=Math.floor(Math.min(a[1],b[1])/CELL);y<=Math.floor(Math.max(a[1],b[1])/CELL);y++){const k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(segment);}}
    return true;
  }
  function blocked(rings,padding=RAIL_CLEARANCE_M){if(!rings?.[0]?.length)return false;const ring=rings[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),w=Math.min(...xs)-padding/scaleX,e=Math.max(...xs)+padding/scaleX,s=Math.min(...ys)-padding/scaleY,n=Math.max(...ys)+padding/scaleY,segments=new Set();
    for(let x=Math.floor(w/CELL);x<=Math.floor(e/CELL);x++)for(let y=Math.floor(s/CELL);y<=Math.floor(n/CELL);y++)for(const seg of grid.get(x+','+y)||[])segments.add(seg);
    const origin=ring[0],local=p=>[(p[0]-origin[0])*scaleX,(p[1]-origin[1])*scaleY],outer=ring.map(local),holes=rings.slice(1).map(r=>r.map(local));
    for(const seg of segments){if(Math.max(seg.a[0],seg.b[0])<w||Math.min(seg.a[0],seg.b[0])>e||Math.max(seg.a[1],seg.b[1])<s||Math.min(seg.a[1],seg.b[1])>n)continue;const a=local(seg.a),b=local(seg.b);
      if([a,b].some(p=>inside(p,outer)&&!holes.some(h=>inside(p,h))))return true;
      for(const r of [outer,...holes])for(let i=0;i<r.length;i++){const c=r[i],d=r[(i+1)%r.length];if(intersects(a,b,c,d)||Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b))<=padding)return true;}}
    return false;
  }
  function model(meta,footprint){const prior=cache.get(meta);if(prior?.revision===revision)return prior.result;
    const affected=(footprint.type==='FeatureCollection'?footprint.features:[footprint]).filter(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).some(p=>blocked(p)));
    const excluded=new Set(affected.map(f=>f.properties.component));
    const components=meta.components?.filter(c=>!excluded.has(c.id));
    const result={meta:affected.length&&meta.components?{...meta,components}:meta,footprint,excluded:affected.map(f=>f.properties.component||meta.id),hidden:affected.length>0&&(!meta.components||components.length===0)};
    cache.set(meta,{revision,result});return result;
  }
  return {update,blocked,model,get revision(){return revision;}};
}

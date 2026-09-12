import {gradeOf} from './tunnel_rail_grade.mjs';
// 平坦地圖的橋面高度亦須沿整個實體路網求解，不能在每個短橋片段各自升降。
// 200m 是柔化顯示過渡的尺度，不是現地橋梁尺寸。保留原始 offsets 給地形覆土計算。
export const FLAT_SMOOTH_M=200;
export const FLAT_BASIS='平坦地圖使用 flatOffsets：全網共用節點，以 200m 尺度柔化短橋與引道，再限制露天顯示坡度（臺鐵高鐵 2.5%、林鐵 6%、捷運 4%），保留 7m 交叉淨距。地下疊層維持原 8% 約束；上述均為顯示估計，不是實測標高。';
export function applyFlatRailGrade(records,entries,crossings){
 const nodes=[],keys=new Map(),edges=[];
 for(const r of records){
  const e=entries[r.w.id],source=new Map(r.path.d.map((s,i)=>[s.toFixed(4),r.w.system+':'+r.w.nodes[i]]));
  r.flatIds=e.distances.map((s,i)=>{const key=source.get(s.toFixed(4))||r.w.id+':s:'+s;let id=keys.get(key);if(id===undefined){id=nodes.length;keys.set(key,id);nodes.push({mass:0,target:0});}return id;});
  for(let i=1;i<e.distances.length;i++){const ds=e.distances[i]-e.distances[i-1],a=r.flatIds[i-1],b=r.flatIds[i];if(a===b)continue;
   edges.push([a,b,ds,(e.kind==='tunnel'?.08:gradeOf(r.w.system))*ds]);
   for(const [id,k]of [[a,i-1],[b,i]]){nodes[id].mass+=ds/2;nodes[id].target+=ds/2*e.offsets[k];}
  }
 }
 // 極近重複取樣只會使矩陣病態；平滑權重下限 0.25m，縱坡約束仍採真實里程。
 const n=nodes.length,mass=Float64Array.from(nodes,k=>Math.max(k.mass,.0001)),rhs=Float64Array.from(nodes,k=>k.target),diag=mass.slice(),z=Float64Array.from(nodes,(k,i)=>rhs[i]/mass[i]);
 for(const e of edges){e.push(FLAT_SMOOTH_M**2/Math.max(e[2],.25));diag[e[0]]+=e[4];diag[e[1]]+=e[4];}
 const mul=(x,out)=>{for(let i=0;i<n;i++)out[i]=mass[i]*x[i];for(const [a,b,,,w]of edges){const d=w*(x[a]-x[b]);out[a]+=d;out[b]-=d;}};
 const dot=(a,b)=>{let v=0;for(let i=0;i<n;i++)v+=a[i]*b[i];return v;};
 const az=new Float64Array(n);mul(z,az);const residual=Float64Array.from(rhs,(v,i)=>v-az[i]),p=Float64Array.from(residual,(v,i)=>v/diag[i]);let rz=dot(residual,p),smoothPasses=0;
 for(;smoothPasses<2000&&rz>1e-10;smoothPasses++){
  mul(p,az);const alpha=rz/dot(p,az);let next=0;
  for(let i=0;i<n;i++){z[i]+=alpha*p[i];residual[i]-=alpha*az[i];next+=residual[i]**2/diag[i];}
  const beta=next/rz;for(let i=0;i<n;i++)p[i]=residual[i]/diag[i]+beta*p[i];rz=next;
 }
 if(rz>1e-8)throw Error('平坦軌面平滑矩陣未收斂 '+rz);
 const atPin=p=>{const ds=entries[p.r.w.id].distances;let i=0,j=ds.length-1;while(j-i>1){const m=(i+j)>>1;if(ds[m]<=p.s)i=m;else j=m;}const k=Math.abs(ds[i]-p.s)<Math.abs(ds[j]-p.s)?i:j;if(Math.abs(ds[k]-p.s)>.002)throw Error('交叉節點缺少取樣 '+p.r.w.id);return p.r.flatIds[k];};
 // 地下疊層保留原本的 8% 約束：既有來源接頭在極短距離內換層，硬套露天坡度會與
 // 7m 淨距互相矛盾（台北地下交叉會無解）。露天橋梁與引道則一律採較緩的系統上限。
 const gaps=crossings.map(([u,l])=>[atPin(u),atPin(l),7]);
 let passes=0,error=Infinity;
 for(;passes<3000;passes++){
  for(const [a,b,,limit]of edges){const d=z[b]-z[a],over=Math.abs(d)-limit;if(over>0){const shift=Math.sign(d)*over/2;z[a]+=shift;z[b]-=shift;}}
  for(const [a,b,gap]of gaps){const short=gap-z[a]+z[b];if(short>0){z[a]+=short/2;z[b]-=short/2;}}
  if(passes%20===0){error=0;for(const [a,b,,limit]of edges)error=Math.max(error,Math.abs(z[a]-z[b])-limit);for(const [a,b,gap]of gaps)error=Math.max(error,gap-z[a]+z[b]);if(error<.0003)break;}
 }
 if(error>.001)throw Error('平坦軌面縱坡未收斂 '+error);
 for(const r of records)entries[r.w.id].flatOffsets=r.flatIds.map(i=>+z[i].toFixed(5));
 return {smoothM:FLAT_SMOOTH_M,nodes:n,edges:edges.length,crossings:gaps.length,smoothPasses,passes,error};
}

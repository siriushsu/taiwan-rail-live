import {makePath,distanceM} from '../integration/train-path.js';
// 舊洞口方位是向內六個 OSM 節點的平均，彎道可能偏離入口切線數十度。
// 依原洞口座標找回同系統的隧道端點，直接讀該股道的切線與縱坡；不再向鄰線借高度。
export function bindPortalPaths(portals,runtimes){
 const grid=new Map(),cell=.00001;
 for(const runtime of runtimes)for(const w of runtime.wayById.values()){
  if(runtime.levelAt(w.id,0)?.kind!=='tunnel')continue;
  for(const index of [0,w.coordinates.length-1]){const q=w.coordinates[index],key=w.system+':'+Math.floor(q[0]/cell)+','+Math.floor(q[1]/cell);if(!grid.has(key))grid.set(key,[]);grid.get(key).push({runtime,w,index,q});}
 }
 return portals.map(([lon,lat,bearing,system])=>{
  const x=Math.floor(lon/cell),y=Math.floor(lat/cell),candidates=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const c of grid.get(system+':'+(x+dx)+','+(y+dy))||[]){const error=distanceM(c.q,[lon,lat]);if(error<.25){const cs=c.w.coordinates,inner=cs[c.index===0?Math.min(6,cs.length-1):Math.max(0,cs.length-7)],a=Math.atan2(inner[1]-c.q[1],(inner[0]-c.q[0])*Math.cos(c.q[1]*Math.PI/180));candidates.push({...c,error,turn:1-Math.cos(a-(90-bearing)*Math.PI/180)});}}
  candidates.sort((a,b)=>a.error-b.error||a.turn-b.turn||String(a.w.id).localeCompare(String(b.w.id)));
  const match=candidates[0];if(!match)return null;
  const {w,index,runtime}=match,path=makePath(w.coordinates),direction=index===0?1:-1,origin=index===0?0:path.length,adjacent=w.coordinates[index+direction],q=w.coordinates[index],angle=Math.atan2(adjacent[1]-q[1],(adjacent[0]-q[0])*Math.cos(q[1]*Math.PI/180));
  return {coordinate:q,system,angle,wayId:String(w.id),length:path.length,
    at(d){const s=Math.max(0,Math.min(path.length,origin+direction*d));return {...path.at(s),level:runtime.levelAt(w.id,s)};}};
 }).filter(Boolean);
}

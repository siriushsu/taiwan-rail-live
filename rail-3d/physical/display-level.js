import {makePath} from '../integration/train-path.js';
// 未指派股道的示意列車只借用「原位置、同方向」軌道的高度，不吸附或搬動 XY。
export function createDisplayLevelLookup(ways,levelAt){
 const cell=.004,grids=new Map(),paths=new Map();
 for(const w of ways){let grid=grids.get(w.system);if(!grid)grids.set(w.system,grid=new Map());
  const keys=new Set();for(let i=1;i<w.coordinates.length;i++){const a=w.coordinates[i-1],b=w.coordinates[i];
   for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)for(let y=Math.floor(Math.min(a[1],b[1])/cell);y<=Math.floor(Math.max(a[1],b[1])/cell);y++)keys.add(x+','+y);
  }
  for(const key of keys){if(!grid.has(key))grid.set(key,[]);grid.get(key).push(w);}
 }
 return (system,coordinate,angle)=>{
  const grid=grids.get(system);if(!grid)return null;const x=Math.floor(coordinate[0]/cell),y=Math.floor(coordinate[1]/cell),candidates=new Set();
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const w of grid.get((x+dx)+','+(y+dy))||[])candidates.add(w);
  const matches=[];for(const w of candidates){let path=paths.get(w.id);if(!path)paths.set(w.id,path=makePath(w.coordinates));const p=path.locate(coordinate);
   if(p&&p.error<3&&Math.abs(Math.cos(p.angle-angle))>Math.cos(Math.PI/12))matches.push({w,p,level:levelAt(w.id,p.s)});
  }
  matches.sort((a,b)=>a.p.error-b.p.error||String(a.w.id).localeCompare(String(b.w.id)));
  const best=matches[0];if(!best)return null;
  if(matches.some(m=>m!==best&&m.p.error<best.p.error+1&&Math.abs(m.level.offsetM-best.level.offsetM)>.5))return null;
  return {...best.level,sourceWayId:String(best.w.id),displayOnly:true};
 };
}

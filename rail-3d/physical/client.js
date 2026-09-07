import {createPhysicalMotion} from './motion.js';
import {createMetroPhysicalMotion} from './metro-motion.js';
export async function loadPhysicalMotion(){
 const json=async file=>{const r=await fetch(new URL(file,import.meta.url));if(!r.ok)throw Error('股道資料載入失敗');return r.json();};
 const [network,profiles,dispatch,metroNetwork,metroProfiles]=await Promise.all(['network.json','display-profiles.json','dispatch.json','metro-network.json','metro-display-profiles.json'].map(json)),motion=createPhysicalMotion(network,profiles,dispatch),metro=createMetroPhysicalMotion(metroNetwork,metroProfiles);
 let visibleCache=null;const boxes=new WeakMap();
 function visibleRoutes(lines,bounds){const west=bounds.getWest()-.006,east=bounds.getEast()+.006,south=bounds.getSouth()-.006,north=bounds.getNorth()+.006,systems=new Map();
  for(const line of lines){const sys=line.systemId;if(['tra_sched','thsr_sched','afr_sched'].includes(sys)&&!systems.has(sys))systems.set(sys,line.color);}
  const key=[...systems].flat().join(':');
  if(visibleCache?.key===key&&west>=visibleCache.west&&east<=visibleCache.east&&south>=visibleCache.south&&north<=visibleCache.north)return visibleCache.result;
  const area={west:west-.006,east:east+.006,south:south-.006,north:north+.006};
  const result=[...systems].flatMap(([sys,color])=>motion.geometry.drawingWays(sys,color)).filter(r=>{let b=boxes.get(r);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const c of r.coordinates){b[0]=Math.min(b[0],c[0]);b[1]=Math.min(b[1],c[1]);b[2]=Math.max(b[2],c[0]);b[3]=Math.max(b[3],c[1]);}boxes.set(r,b);}return b[0]<=area.east&&b[2]>=area.west&&b[1]<=area.north&&b[3]>=area.south;});visibleCache={key,...area,result};return result;
 }
 return {...motion,metro,dispatch,visibleRoutes};
}

import {createRouteRuntime} from './route-runtime.js';import {makePath} from '../integration/train-path.js';
import {formationFor} from '../integration/formations.js';
export function createMetroPhysicalMotion(pack,profiles){
 const geometry=createRouteRuntime(pack,profiles),lines=new WeakMap(),cache=new Map();
 function routeFor(ln,direction){const key=ln._sys+':'+ln.id+':'+direction,record=pack.routes[key];if(!record)return null;if(cache.has(key))return cache.get(key);
  const route=geometry.route(record.pathIds,ln._sys,ln.color,{prefixM:220,suffixM:220});
  // 終端的 stop_position 可能是車頭停車點。以完整編組推估停車中心，
  // 沿既有股道預留車身，不把末節車廂放到車止外，也不在到站時改成號碼。
  const spec=formationFor({systemId:ln._sys,routeId:ln.id,airportService:'express'},'actual'),half=(spec?.lengths.reduce((a,b)=>a+b,0)||0)/2+2;
  const offsets=route.offsets.map(s=>Math.max(half,Math.min(route.path.length-half,s)));
  const value={record,route,offsets};cache.set(key,value);return value;
 }
 function sample(ln,pos,direction){if(!pos||pos.physical||Math.abs(direction)!==1)return pos;const selected=routeFor(ln,direction);if(!selected)return pos;const {record,route,offsets}=selected;
  let line=lines.get(ln);if(!line){line=makePath(ln.shape.map(p=>[p[1],p[0]]),ln.loop);lines.set(ln,line);}let progress=pos.progress;
  if(!Number.isFinite(progress)){const hit=line.locate([pos.lon,pos.lat]);if(!hit||hit.error>3)return pos;let i=0;while(i<ln.stations.length-2&&ln.stations[i+1].d*1000<hit.s)i++;const a=ln.stations[i].d*1000,b=ln.stations[i+1].d*1000;progress=i+Math.max(0,Math.min(1,(hit.s-a)/(b-a||1)));}
  if(progress<record.startIndex||progress>record.endIndex)return pos;
  const local=direction===1?progress-record.startIndex:record.endIndex-progress,i=Math.min(record.pathIds.length-1,Math.floor(local)),f=local-i,chainageM=offsets[i]+(offsets[i+1]-offsets[i])*f,p=route.path.at(Math.max(0,Math.min(route.path.length,chainageM)));
  return {...pos,lat:p.coordinate[1],lon:p.coordinate[0],physical:true,route,chainageM,railDirection:1,assignmentBasis:'inferred'};
 }
 return {sample,geometry,routeFor};
}

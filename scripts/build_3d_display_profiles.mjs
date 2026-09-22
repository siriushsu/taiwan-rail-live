// 顯示高程必須高於原始地形；保留真實 XY，不能把高程平滑造成的穿地當作隧道。
import fs from 'node:fs';import {createHash} from 'node:crypto';
import {makePath,shapeKey} from '../rail-3d/integration/train-path.js';import {openRailDem} from './lib/local_rail_dem.mjs';
const root=new URL('../',import.meta.url),dem=openRailDem(root);
const systems={tra_sched:'tra',thsr_sched:'thsr_track',afr_sched:'afr',mrt:'trtc',tymc:'tymc',ntdlrt:'ntdlrt',ntalrt:'ntalrt',sanying:'sanying',krtc:'krtc',tmrt:'tmrt'};
const routes=[];for(const [sys,file]of Object.entries(systems)){const data=JSON.parse(fs.readFileSync(new URL('data/'+file+'.json',root)));for(const ln of data.lines)routes.push({id:sys+':'+ln.id,coordinates:ln.shape?ln.shape.map(c=>[c[1],c[0]]):ln.stations.map(s=>[s.lon,s.lat]),loop:!!ln.loop});}
const outputPath=new URL('rail-3d/integration/display-profiles.json',root),entries={};let points=0;
try{
 for(const r of routes){const path=makePath(r.coordinates,r.loop),n=Math.ceil(path.length/5),step=path.length/n,raw=[],floor=[];
  for(let i=0;i<=n;i++){const s=Math.min(path.length,i*step),c=path.at(s).coordinate,a=path.at(Math.max(0,s-3)).coordinate,b=path.at(Math.min(path.length,s+3)).coordinate,dx=(b[0]-a[0])*Math.cos(c[1]*Math.PI/180),dy=b[1]-a[1],angle=Math.atan2(dy,dx),x=-Math.sin(angle)*4/(111320*Math.cos(c[1]*Math.PI/180)),y=Math.cos(angle)*4/111320;
   const h=await dem.ground(c);raw.push(h);floor.push(Math.max(h,await dem.ground([c[0]+x,c[1]+y]),await dem.ground([c[0]-x,c[1]-y]))+2);
  }
  const smooth=raw.map((_,i)=>{let sum=0,wSum=0;const rad=Math.ceil(105/step);for(let j=Math.max(0,i-rad);j<=Math.min(n,i+rad);j++){const w=Math.exp(-.5*(((j-i)*step)/35)**2);sum+=raw[j]*w;wSum+=w;}return sum/wSum;});
  const deficits=floor.map((v,i)=>Math.max(0,v-smooth[i]));
  const values=smooth.map((v,i)=>{let lift=0;const rad=Math.ceil(210/step);for(let j=Math.max(0,i-rad);j<=Math.min(n,i+rad);j++)lift=Math.max(lift,deficits[j]*Math.exp(-.5*(((j-i)*step)/70)**2));return Math.ceil((v+lift)*1000)/1000;});
  entries[shapeKey(r.coordinates)]={routeId:r.id,lengthM:path.length,stepM:step,values};points+=values.length;console.log(r.id,values.length);
 }
 const output={version:2,railElevationM:null,source:{id:'taiwan-terrain-20260906-v1',zoom:12,demSha256:dem.manifest.sha256,routeSnapshotSha256:createHash('sha256').update(JSON.stringify(routes)).digest('hex'),method:'固定 z12 DEM；間距不超過 5m，含左右 4m 地表取樣。Gaussian σ35m 平滑後，以 σ70m 上包絡補足地表淨空，PCHIP 連續內插。顯示高程非實測軌面或橋隧標高。',minimumSampleClearanceM:2,lateralSampleM:4},entries};
 fs.writeFileSync(outputPath,JSON.stringify(output)+'\n');console.log({routes:Object.keys(entries).length,points});
}finally{dem.close();}

// 股道共用固定 DEM 淨空；道岔相同節點取相同高度，顯示值不代表實測軌面。
import fs from 'node:fs';
import {makePath} from '../rail-3d/integration/train-path.js';
import {openRailDem} from './lib/local_rail_dem.mjs';
const root=new URL('../',import.meta.url),network=JSON.parse(fs.readFileSync(new URL(process.env.NETWORK||'rail-3d/physical/network.json',root))),dem=openRailDem(root),records=[],junctions=new Map();
try{
 for(const [wi,w] of network.ways.entries()){
  const p=makePath(w.coordinates);if(!p.length)continue;const n=Math.max(1,Math.ceil(p.length/5)),step=p.length/n,raw=[],floor=[];
  for(let i=0;i<=n;i++){const s=i*step,c=p.at(Math.min(p.length,s)).coordinate,a=p.at(Math.max(0,s-3)).coordinate,b=p.at(Math.min(p.length,s+3)).coordinate,angle=Math.atan2(b[1]-a[1],(b[0]-a[0])*Math.cos(c[1]*Math.PI/180)),dx=-Math.sin(angle)*4/(111320*Math.cos(c[1]*Math.PI/180)),dy=Math.cos(angle)*4/111320;
   const h=await dem.ground(c);raw.push(h);floor.push(Math.max(h,await dem.ground([c[0]+dx,c[1]+dy]),await dem.ground([c[0]-dx,c[1]-dy]))+2.5);
  }
  const smooth=raw.map((_,i)=>{let sum=0,total=0;const radius=Math.ceil(105/step);for(let j=Math.max(0,i-radius);j<=Math.min(n,i+radius);j++){const k=Math.exp(-.5*((j-i)*step/35)**2);sum+=raw[j]*k;total+=k;}return sum/total;});
  const deficit=floor.map((v,i)=>Math.max(0,v-smooth[i])),values=smooth.map((v,i)=>{let lift=0;const radius=Math.ceil(210/step);for(let j=Math.max(0,i-radius);j<=Math.min(n,i+radius);j++)lift=Math.max(lift,deficit[j]*Math.exp(-.5*((j-i)*step/70)**2));return v+lift;});
  const r={id:w.id,stepM:step,lengthM:p.length,values,nodeDistances:p.d};records.push(r);
  for(let j=0;j<w.nodes.length;j++){const s=p.d[j],i=Math.min(n-1,Math.floor(s/step)),t=(s-i*step)/step,h=values[i]*(1-t)+values[i+1]*t,key=w.nodes[j];junctions.set(key,Math.max(junctions.get(key)??-Infinity,h));}
  if(wi%400===0)console.log(wi+'/'+network.ways.length);
 }
 // 每個來源節點直接納入取樣，避免相鄰 way 的均勻網格在道岔產生高差。
 const interpolate=(r,s)=>{const i=Math.min(r.values.length-2,Math.floor(s/r.stepM)),t=(s-i*r.stepM)/r.stepM;return r.values[i]*(1-t)+r.values[i+1]*t;};
 const byWay=new Map(network.ways.map(w=>[w.id,w])),entries={};
 for(const r of records){
  const w=byWay.get(r.id),distances=[...new Set([...r.values.map((_,i)=>Math.min(r.lengthM,i*r.stepM)),...r.nodeDistances])].sort((a,b)=>a-b);
  const lifts=r.nodeDistances.map((s,i)=>Math.max(0,junctions.get(w.nodes[i])-interpolate(r,s)));
  const values=distances.map(s=>{let lift=0;for(let i=0;i<r.nodeDistances.length;i++){const d=Math.abs(r.nodeDistances[i]-s);if(d<=210)lift=Math.max(lift,lifts[i]*Math.exp(-.5*(d/70)**2));}return Math.ceil((interpolate(r,s)+lift)*1000)/1000;});
  entries[r.id]={distances,values};
 }
 const maxima=new Map();for(const w of network.ways){const e=entries[w.id],p=makePath(w.coordinates);for(let i=0;i<w.nodes.length;i++){const k=e.distances.indexOf(p.d[i]);if(k>=0)maxima.set(w.nodes[i],Math.max(maxima.get(w.nodes[i])??-Infinity,e.values[k]));}}
 for(const w of network.ways){const e=entries[w.id],p=makePath(w.coordinates);for(let i=0;i<w.nodes.length;i++){const k=e.distances.indexOf(p.d[i]);if(k>=0)e.values[k]=maxima.get(w.nodes[i]);}}
 // distances 是沿線里程，原本整份 float64 寫出去——5 公尺一格寫成 4.968962155958168，
 // 這個檔 67.7% 的字元都是這種尾數（實測數字元）。收到 0.1 公釐，顯示用途下比一個像素細幾百倍。
 // 🔴 但不能整排直接收：道岔處會有兩個相距 1e-13 公尺、高度差 25 公釐的刻度，那個階梯是上面
 //    第 27 行把節點拉成共用最大值刻意留下的。整排收會把那一對併成同一個值，階梯消失，
 //    atHeight(way, path.d[i]) 就會取到階梯的下緣——實測 tra_sched:9748936112 的
 //    「同股道節點高度不連續」正是這樣來的（verify_rail_levels 抓到）。
 //    規則兩條：(1) 節點里程是查表的鍵（verify_rail_levels 用 atHeight(way, path.d[i]) 精確命中），
 //    一律原樣保留；(2) 其餘刻度收完仍要嚴格夾在前後兩個刻度之間，否則原樣保留——這樣階梯不會被併掉，
 //    順序也不會被四捨五入翻過去。
 const nodeDistances=new Map(records.map(r=>[String(r.id),new Set(r.nodeDistances)]));
 const trim=(d,exact)=>{const out=d.slice();for(let i=0;i<d.length;i++){if(exact.has(d[i]))continue;const v=+d[i].toFixed(4);
   if(v>(i?out[i-1]:-Infinity)&&v<(i+1<d.length?d[i+1]:Infinity))out[i]=v;}return out;};
 const rounded=Object.fromEntries(Object.entries(entries).map(([id,e])=>[id,{distances:trim(e.distances,nodeDistances.get(String(id))||new Set()),values:e.values}]));
 fs.writeFileSync(new URL(process.env.OUT||'rail-3d/physical/display-profiles.json',root),JSON.stringify({version:1,railElevationM:null,source:{demSha256:dem.manifest.sha256,zoom:12,minimumClearanceM:2.5,method:'固定地形淨空與共用道岔節點；顯示高程，非實測橋隧標高'},entries:rounded}));
 console.log({ways:records.length,points:records.reduce((n,r)=>n+r.values.length,0)});
}finally{dem.close();}

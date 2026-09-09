import fs from 'node:fs';
import {openRailDem} from './lib/local_rail_dem.mjs';
import {makePath} from '../rail-3d/integration/train-path.js';
// 隧道顯示縱坡的守門人。舊閘門只驗 offsets（隧道恆為 -8 ⇒ 相鄰差恆為 0 ⇒ 恆綠），
// 完全照不到「顯示高程＝地表減固定深度」讓隧道跟著山坡爬升。這裡一律驗實際顯示高程。
const GRADE={tra_sched:.025,thsr_sched:.025,afr_sched:.06},cap=s=>GRADE[s]??.04,WINDOW=100,RISE=8;
const levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json')),E=levels.entries;
const ways=[];for(const f of ['network.json','metro-network.json'])ways.push(...JSON.parse(fs.readFileSync('rail-3d/physical/'+f)).ways);
const byId=new Map(ways.map(w=>[String(w.id),w])),failures=[];
const at=(e,s,key)=>{let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e[key][i]*(1-t)+e[key][j]*t;};
const span=v=>Math.max(...v)-Math.min(...v);
// 視覺上的「爬山」是幾百公尺尺度的起伏，不是單一取樣點的抖動：縱坡量 100m 視窗。
const windowGrade=e=>{const d=e.distances,v=e.terrainValues,full=Math.min(WINDOW,d.at(-1));let g=0,j=0;
 for(let i=0;i<d.length;i++){while(j<d.length-1&&d[j]-d[i]<WINDOW)j++;const run=d[j]-d[i];if(run<full-1e-6)continue;g=Math.max(g,Math.abs(v[j]-v[i])/run);}
 return g;};
const tunnelIds=Object.keys(E).filter(id=>E[id].kind==='tunnel'&&byId.has(id));
for(const id of tunnelIds){const e=E[id];if(!e.terrainValues||e.terrainValues.length!==e.distances.length||!e.terrainValues.every(Number.isFinite))failures.push(id+':缺顯示縱坡');}
if(failures.length){console.log({failures:failures.slice(0,10)});process.exit(1);}
if(tunnelIds.length<700)failures.push('隧道數量異常 '+tunnelIds.length);

// 與產生器同一個分段法：共用節點＋同系統串成一條連續隧道；洞口＝與非本段股道相接的節點。
const nodeWays=new Map();for(const w of ways)for(const n of w.nodes){const k=w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(String(w.id));}
const tunnelSet=new Set(tunnelIds),placed=new Set(),runs=[];
for(const id of tunnelIds){if(placed.has(id))continue;const stack=[id],run=[];placed.add(id);
 while(stack.length){const cur=stack.pop();run.push(cur);const w=byId.get(cur);for(const n of w.nodes)for(const o of nodeWays.get(w.system+':'+n)||[])if(tunnelSet.has(o)&&!placed.has(o)){placed.add(o);stack.push(o);}}
 runs.push(run);}

const dem=openRailDem(new URL('../',import.meta.url));
let portals=0,joints=0,changed=0,riseWorst=0,gradeWorst=0;
try{
for(const run of runs){
 const member=new Set(run),system=byId.get(run[0]).system,shared=new Map();
 let hi=-Infinity,lo=Infinity,inner=-Infinity,grade=0,length=0,steepest=run[0];
 for(const id of run){const w=byId.get(id),e=E[id],path=makePath(w.coordinates);length+=e.distances.at(-1);
  for(const i of [0,w.nodes.length-1]){const node=w.nodes[i],z=at(e,path.d[i],'terrainValues'),neighbours=nodeWays.get(system+':'+node)||[];
   if(neighbours.some(o=>!member.has(o))){portals++;hi=Math.max(hi,z);lo=Math.min(lo,z);
    // 洞口必須接上相鄰股道畫在畫面上的高度：有 terrainValues 取它，否則是原始 DEM 加層位 offset。
    for(const o of neighbours){if(member.has(o))continue;const ow=byId.get(o),oe=E[o];if(!oe)continue;const oi=ow.nodes.indexOf(node);if(oi<0)continue;const os=makePath(ow.coordinates).d[oi];
     const oz=oe.terrainValues?at(oe,os,'terrainValues'):(await dem.ground(ow.coordinates[oi]))+at(oe,os,'offsets');
     if(Math.abs(oz-z)>1.5)failures.push(id+':洞口落差 '+(oz-z).toFixed(2)+'m vs '+o);}
   }else{inner=Math.max(inner,z);if(shared.has(node)){joints++;if(Math.abs(shared.get(node)-z)>.01)failures.push(id+':接頭不連續');}else shared.set(node,z);}}
  // 兩端高差由地形決定的短 way（洞口就差那麼多，沒有自由度）以自身弦坡為準。
  const chord=Math.abs(e.terrainValues.at(-1)-e.terrainValues[0])/Math.max(1,e.distances.at(-1));
  const wg=windowGrade(e)-Math.max(0,chord-cap(system));if(wg>grade){grade=wg;steepest=id;}
  if(Math.max(...e.terrainValues.map((x,i)=>Math.abs(x-e.values[i])))>5)changed++;
 }
 // 核心判準：隧道內部不得爬到高過自己的洞口——那正是「隧道還會爬山」的形狀。
 const rise=Number.isFinite(inner)&&Number.isFinite(hi)?inner-hi:0;
 riseWorst=Math.max(riseWorst,rise);
 if(rise>RISE)failures.push(run[0]+':內部高過洞口 '+rise.toFixed(1)+'m');
 // 縱坡上限；兩端洞口的高差本身就超過上限的短隧道由地形決定，沒有自由度，以自身弦坡為準。
 const allowed=cap(system)+.01; // 餘裕給節點之間的 Hermite 過衝；舊的貼地剖面高出上限數十倍，這點餘裕不會讓它溜過去
 gradeWorst=Math.max(gradeWorst,grade-allowed);
 if(grade>allowed)failures.push(steepest+':'+system+' 顯示縱坡 '+(grade*100).toFixed(1)+'% > '+(allowed*100).toFixed(1)+'%');
}
}finally{dem.close();}

// 具名回歸：2026-09-09 實際看到隧道爬山的四處。每一條都附「舊剖面會紅」的正向對照，
// 免得資料掉檔時判準變成恆真。
for(const [name,ids,limit]of [['新觀音隧道',['197169790','211933600'],40],['中央隧道',['81151555','575059356'],40],['永春隧道',['391706264','391706265'],20],['文湖線辛亥—麟光',['50212694','194633997','55567867'],20]]){
 const have=ids.filter(id=>E[id]?.terrainValues);if(have.length!==ids.length){failures.push(name+':來源 way 不在網路內');continue;}
 const now=Math.max(...have.map(id=>span(E[id].terrainValues))),was=Math.max(...have.map(id=>span(E[id].values)));
 if(now>limit)failures.push(name+':仍有 '+now.toFixed(1)+'m 起伏');
 if(was<=limit)failures.push(name+':對照組沒有起伏，判準失去鑑別力');
 console.log({隧道:name,舊剖面起伏:+was.toFixed(1),新縱坡起伏:+now.toFixed(1),上限:limit});
}
if(changed<400)failures.push('實際改動的 way 太少 '+changed+'，這一關可能沒跑到');
console.log({runs:runs.length,tunnelWays:tunnelIds.length,portals,joints,changed,riseWorst:+riseWorst.toFixed(1),gradeMargin:+(gradeWorst*100).toFixed(2),failures:failures.length});
if(failures.length){console.log(failures.slice(0,20));process.exitCode=1;}

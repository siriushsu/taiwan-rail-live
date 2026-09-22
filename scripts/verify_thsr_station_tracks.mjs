// 高鐵車站股道規則閘門:有通過線的車站,停靠列車停外側到發線(側線)、通過列車走內側正線,
// 停靠一律停 OSM 標的停車點、同側(左行)月台;每一條都配正向對照,分母不得為 0。
// 用法:node scripts/verify_thsr_station_tracks.mjs   (DISPATCH=<檔> 可指定別份派車做突變測試)
import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const net=read('rail-3d/physical/network.json'),dispatch=read(process.env.DISPATCH||'rail-3d/physical/dispatch.json'),track=read('data/thsr_track.json');
const THROUGH=['板橋','桃園','新竹','苗栗','台中','彰化','雲林','嘉義','台南'];
const ORDER=track.lines[0].stations.map(s=>s.name.replaceAll('臺','台')),stationCoord=Object.fromEntries(track.lines[0].stations.map(s=>[s.name.replaceAll('臺','台'),[s.lon,s.lat]]));
const R=6371000,metres=(a,b)=>Math.hypot((b[0]-a[0])*Math.PI/180*Math.cos((a[1]+b[1])/2*Math.PI/180),(b[1]-a[1])*Math.PI/180)*R;
const nodeWays=new Map(),coordOf=new Map();
net.ways.forEach((w,wi)=>{if(w.system!=='thsr_sched')return;w.nodes.forEach((id,i)=>{if(!nodeWays.has(id))nodeWays.set(id,[]);nodeWays.get(id).push(wi);coordOf.set(id,w.coordinates[i]);});});
const kinds=id=>[...new Set((nodeWays.get(id)||[]).map(wi=>net.ways[wi].tags.service||net.ways[wi].tags.usage||'?'))];
const isOsmStop=id=>net.nodeTags[id]?.railway==='stop'&&!net.nodeTags[id]._source;
// 各通過站的月台停車點(側線上的 OSM 停車點,離站 600 m 內):通過列車的路徑不得經過
const platformNodes={};for(const name of THROUGH){platformNodes[name]=new Set();for(const [id,c] of coordOf)if(isOsmStop(id)&&kinds(id).join()==='siding'&&metres(c,stationCoord[name])<600)platformNodes[name].add(id);}
const pathNodes=new Map();
const nodesOf=pid=>{if(pathNodes.has(pid))return pathNodes.get(pid);const list=[];for(const [wi,ix,steps] of net.paths[pid].walk){const w=net.ways[wi],dir=Math.sign(steps);for(let k=0;k<Math.abs(steps);k++){const e=ix+k*dir,[a,b]=dir>0?[w.nodes[e],w.nodes[e+1]]:[w.nodes[e+1],w.nodes[e]];if(!list.length)list.push(a);list.push(b);}}pathNodes.set(pid,list);return list;};
const rows=[],stat={};for(const name of ORDER)stat[name]={stopSiding:0,stopMain:0,stopEstimated:0,stopRight:0,passMain:0,passSiding:0};
const plans=Object.entries(dispatch.plans).filter(([k])=>k.startsWith('thsr_sched:'));
for(const [key,p] of plans){
 const stops=JSON.parse(p.stopSignature).map(s=>s[0].split(':')[1]);
 if(p.pathIds.length!==stops.length-1){rows.push(['FAIL',key,'路徑數與站數不符']);continue;}
 stops.forEach((name,i)=>{
  const node=i?net.paths[p.pathIds[i-1]].to:net.paths[p.pathIds[0]].from,k=kinds(node).join('+'),s=stat[name];
  if(!isOsmStop(node))s.stopEstimated++;
  if(THROUGH.includes(name)){
   if(k==='siding')s.stopSiding++;else s.stopMain++;
   // 左行:以前後站連線為行進方向,月台停車點應在行進方向左側
   const prev=stationCoord[stops[i-1]]||stationCoord[ORDER[ORDER.indexOf(name)-1]],next=stationCoord[stops[i+1]]||stationCoord[ORDER[ORDER.indexOf(name)+1]];
   const heading=stops[i+1]?[next[0]-stationCoord[name][0],next[1]-stationCoord[name][1]]:[stationCoord[name][0]-prev[0],stationCoord[name][1]-prev[1]];
   const c=coordOf.get(node),off=[(c[0]-stationCoord[name][0])*Math.cos(c[1]*Math.PI/180),c[1]-stationCoord[name][1]];
   // 站心座標在站房不一定在軌道中線:改用同站另一側月台停車點的中點當中線
   const others=[...platformNodes[name]].map(id=>coordOf.get(id)),mid=[others.reduce((v,q)=>v+q[0],0)/others.length,others.reduce((v,q)=>v+q[1],0)/others.length];
   const rel=[(c[0]-mid[0])*Math.cos(c[1]*Math.PI/180),c[1]-mid[1]],cross=heading[0]*rel[1]-heading[1]*rel[0];
   if(others.length>=2&&cross<0)s.stopRight++;
  }
 });
 // 通過站:兩個停靠站之間、班表沒列的站
 p.pathIds.forEach((pid,i)=>{
  const a=ORDER.indexOf(stops[i]),b=ORDER.indexOf(stops[i+1]),nodes=new Set(nodesOf(pid));
  for(let j=Math.min(a,b)+1;j<Math.max(a,b);j++){const name=ORDER[j];if(!THROUGH.includes(name))continue;const viaPlatform=[...platformNodes[name]].some(id=>nodes.has(id));if(viaPlatform)stat[name].passSiding++;else stat[name].passMain++;}
 });
}
const results=[];const check=(ok,label,detail)=>{results.push([ok?'PASS':'FAIL',label,detail]);};
check(plans.length>=150,'高鐵派車班次分母',plans.length+' 班');
for(const name of THROUGH){const s=stat[name];
 check(s.stopSiding>0&&s.stopMain===0,name+' 停靠列車全部停外側到發線(側線)',`側線 ${s.stopSiding}／正線 ${s.stopMain}`);
 check(s.passMain+s.passSiding===0||s.passSiding===0,name+' 通過列車全部走內側正線',`正線 ${s.passMain}／側線 ${s.passSiding}`);
 check(s.stopRight===0,name+' 停靠月台在行進方向左側(不停對向月台)',`右側 ${s.stopRight}`);
}
check(THROUGH.some(n=>stat[n].passMain>0),'正向對照:確有列車通過中途站',THROUGH.map(n=>n+' '+stat[n].passMain).join(' '));
check(ORDER.every(n=>stat[n].stopEstimated===0),'高鐵只停 OSM 標的停車點(不用推估點)',ORDER.map(n=>n+' '+stat[n].stopEstimated).join(' '));
for(const r of rows)results.push(r);
for(const [s,l,d] of results)console.log(s,l,'—',d);
const failed=results.filter(r=>r[0]==='FAIL').length;
console.log(failed?`高鐵車站股道規則:${failed} 項未通過`:`高鐵車站股道規則:${results.length} 項通過(${plans.length} 班)`);
process.exit(failed?1:0);

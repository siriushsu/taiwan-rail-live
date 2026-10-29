// 高鐵停車點改了(rebuild_physical_cache.mjs)而班表沒變時:只把端點變了的高鐵路徑換進已出貨的 network.json,
// dispatch.json 沿用原本的股道與待避,台鐵／林鐵的路徑、派車與 ways 一字不動。重跑 optimize→assemble→pack 會連帶
// 重排別站的月台與待避,pack 也會丟掉沒被派車用到、後來才補進的台鐵路徑。換完要跑 verify_thsr_reservation_motion.mjs
// 確認仍零交疊、verify_thsr_station_tracks.mjs 確認股道規則。
// 用法:node scripts/rebuild_physical_cache.mjs <逐日時刻表...> 之後 node scripts/splice_thsr_physical.mjs
import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p)),net=read('rail-3d/physical/network.json'),dispatch=read('rail-3d/physical/dispatch.json'),r=read('.cache/physical-tracks/routes.json');
const wayIndex=new Map(net.ways.map((w,i)=>[String(w.id),i]));
const nodesOf=p=>{const list=[];for(const [wi,ix,steps] of p.walk){const w=net.ways[wi],dir=Math.sign(steps);for(let k=0;k<Math.abs(steps);k++){const e=ix+k*dir,[a,b]=dir>0?[w.nodes[e],w.nodes[e+1]]:[w.nodes[e+1],w.nodes[e]];if(!list.length)list.push(a);list.push(b);}}return list;};
// 打包格式同 pack_physical_network.mjs:同一條 way 上連續同向的邊併成一段 walk
const pack=p=>{const walk=[];let prior=null;for(let i=0;i<p.edgeIds.length;i++){const e=r.edges[p.edgeIds[i]],ix=+p.edgeIds[i].split(':').at(-1),direction=e.a===p.nodeIds[i]?1:-1,w=wayIndex.get(e.wayId);if(prior&&prior[0]===w&&Math.sign(prior[2])===direction&&prior[1]+prior[2]===ix)prior[2]+=direction;else{prior=[w,ix,direction];walk.push(prior);}}
 return {from:p.from,to:p.to,fromGroup:p.fromGroup,toGroup:p.toGroup,system:p.system,lengthM:p.lengthM,preference:p.preference,walk};};
const replaced=new Map();let kept=0,plans=0;
for(const [id,plan] of Object.entries(dispatch.plans)){if(!id.startsWith('thsr_sched:'))continue;plans++;
 const stops=JSON.parse(plan.stopSignature).map(s=>s[0]);
 plan.pathIds=plan.pathIds.map((pid,i)=>{
  if(replaced.has(pid))return replaced.get(pid);
  const old=net.paths[pid],seq=nodesOf(old),options=r.pairs[stops[i]+'>'+stops[i+1]]||[];
  if(options.some(o=>r.paths[o].nodeIds.join()===seq.join())){kept++;return pid;}
  // 端點變了:同一對月台股道(fromGroup/toGroup)的候選裡,取與原路徑共用節點最多的那條
  const shared=o=>{const s=new Set(r.paths[o].nodeIds);return seq.filter(n=>s.has(n)).length;};
  const same=options.filter(o=>r.paths[o].fromGroup===old.fromGroup&&r.paths[o].toGroup===old.toGroup).sort((a,b)=>shared(b)-shared(a));
  if(!same.length||same.length>1&&shared(same[0])===shared(same[1]))throw Error('高鐵路徑找不到唯一的新候選 '+id+' '+stops[i]+'>'+stops[i+1]);
  replaced.set(pid,same[0]);return same[0];
 });
}
const stillUsed=new Set(Object.values(dispatch.plans).flatMap(p=>p.pathIds));
for(const [pid,next] of replaced){if(net.paths[next])throw Error('新路徑編號已被占用 '+next);if(!stillUsed.has(pid))delete net.paths[pid];}
for(const next of new Set(replaced.values()))net.paths[next]=pack(r.paths[next]);
fs.writeFileSync('rail-3d/physical/network.json',JSON.stringify(net));fs.writeFileSync('rail-3d/physical/dispatch.json',JSON.stringify(dispatch));
console.log({thsrPlans:plans,keptSegments:kept,replacedPaths:[...replaced].map(([a,b])=>a+'→'+b+' '+Math.round(net.paths[b].lengthM)+'m')});

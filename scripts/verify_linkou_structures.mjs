import fs from 'node:fs';
const levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json')),ways=JSON.parse(fs.readFileSync('rail-3d/physical/network.json')).ways;
// terrainValues 現在全網路的隧道都有；本檔只管林口走廊那一批，靠 terrainBasis 認人。
// 一般隧道的縱坡由 verify_rail_tunnel_grade.mjs 把關。
const special=Object.entries(levels.entries).filter(([,e])=>e.terrainBasis?.startsWith('林口台地')),nodes=new Map();let failures=[];
for(const [id,e]of special){const w=ways.find(w=>String(w.id)===id);if(w?.system!=='thsr_sched'||e.terrainValues.length!==e.distances.length||e.terrainValues.some(x=>!Number.isFinite(x)))failures.push(id+':資料');for(const i of [0,-1]){const n=w.nodes.at(i),z=e.terrainValues.at(i);if(nodes.has(n)&&Math.abs(nodes.get(n)-z)>.001)failures.push(id+':接頭');nodes.set(n,z);}const maxSlope=Math.max(...e.distances.slice(1).map((d,i)=>Math.abs(e.terrainValues[i+1]-e.terrainValues[i])/(d-e.distances[i])));if(maxSlope>.04)failures.push(id+':顯示縱坡');}
for(const id of ['198049016','198049017','197206562','105198003']){const e=levels.entries[id];if(e.kind!=='tunnel'||Math.max(...e.terrainValues)>190)failures.push(id+':隧道縱坡');}
if(special.length!==60)failures.push('走廊數量');console.log({ways:special.length,joints:nodes.size,failures});if(failures.length)process.exitCode=1;
// 龜山走廊東端跨越台鐵的四個交叉：驗實際顯示高程，而不只驗舊 offsets。
const {openRailDem}=await import('./lib/local_rail_dem.mjs'),{makePath}=await import('../rail-3d/integration/train-path.js');
const dem=openRailDem(new URL('../',import.meta.url)),crossings=[['197206565','194118026',[121.43407073475998,25.004654423613847]],['111449047','194118026',[121.43385297809675,25.00458826896832]],['197206565','194118034',[121.43377790464929,25.00462617096139]],['111449047','194118034',[121.43361115396624,25.00456616063593]]];
try{for(const [upper,lower,q]of crossings){const ground=await dem.ground(q),heights=[upper,lower].map(id=>{const w=ways.find(w=>w.id===id),s=makePath(w.coordinates).locate(q).s,e=levels.entries[id],values=e.terrainValues||e.offsets;let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]);return values[i]*(1-t)+values[j]*t+(e.terrainValues?0:ground);});const gap=heights[0]-heights[1];console.log({upper,lower,gap});if(gap<6.99)throw Error('新縱坡破壞交會淨距');}}finally{dem.close();}

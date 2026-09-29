// 全台隧道顯示縱坡盤點（issue #57 驗收條件一）。
// 以「連續隧道」為單位——共用節點且同系統的隧道 way 串成一條，對應現實中的一座隧道。
// 每條報四個數：洞口高差、內部高過洞口、內部低於洞口、最大顯示縱坡，外加與官方橋隧
// 資料不一致的段數。顯示高程取 level-profiles.json 的 terrainValues（隧道段的絕對顯示
// 高度），地面取 values−offsets；官方判定取 data/rail_structures_official.json。
// 用法：node scripts/report_tunnel_grade_stats.mjs [另一棵樹的路徑，用來做修改前後對照]
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {classifyRailStructure} from '../rail-3d/physical/structure-kind.js';

const SYS={tra_sched:'臺鐵',thsr_sched:'高鐵',afr_sched:'阿里山林鐵'};
const nameOf=s=>SYS[s]||s;

// official 一律取本樹的官方對照表：修改前那份沒有記錄「兩邊互指」的爭議段（舊規則遇到
// 就直接跳過不寫條目），拿它當分母會把 13 條不一致算成 0。官方判定來自國土測繪中心，
// 不隨我們的實作改變，兩邊共用同一份才比得出東西。
export function collect(root,official){
 const E=JSON.parse(fs.readFileSync(root+'rail-3d/physical/level-profiles.json')).entries;
 const ways=['network.json','metro-network.json'].flatMap(f=>JSON.parse(fs.readFileSync(root+'rail-3d/physical/'+f)).ways);
 const nodeWays=new Map();
 for(const w of ways)for(const n of w.nodes){const k=w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(w);}
 const isTunnel=w=>E[w.id]?.kind==='tunnel';
 const placed=new Set(),runs=[];
 for(const seed of ways){
  if(!isTunnel(seed)||placed.has(seed))continue;
  const stack=[seed],run=[];placed.add(seed);
  while(stack.length){const cur=stack.pop();run.push(cur);
   for(const n of cur.nodes)for(const o of nodeWays.get(cur.system+':'+n)||[])
    if(isTunnel(o)&&!placed.has(o)){placed.add(o);stack.push(o);}}
  runs.push(run);
 }
 const out=[];
 for(const run of runs){
  const member=new Set(run.map(r=>String(r.id)));
  const portals=[],inner=[];let len=0,grade=0,gradeAt='',mismatch=0,mismatchIds=[];
  const GRADE_SPAN_M=20;  // 取樣點間距小到 1 公尺，逐點算縱坡量到的是取樣噪音不是坡度
  for(const w of run){
   const e=E[w.id];if(!e)continue;
   const h=e.terrainValues||e.values;len+=e.distances.at(-1);
   for(let i=0;i<h.length;i++){
    const isEnd=i===0||i===h.length-1;
    const node=i===0?w.nodes[0]:i===h.length-1?w.nodes.at(-1):null;
    const portal=node!==null&&(nodeWays.get(w.system+':'+node)||[]).some(o=>!member.has(String(o.id)));
    (portal?portals:inner).push(h[i]);
    for(let j=i+1;j<h.length;j++){const ds=e.distances[j]-e.distances[i];
     if(ds<GRADE_SPAN_M)continue;
     const g=Math.abs(h[j]-h[i])/ds;if(g>grade){grade=g;gradeAt=String(w.id);}
     break;}
   }
   // 與官方不一致：來源標記與官方橋隧幾何互指橋／隧道（官方說平面的不算，那是涵蓋缺口）
   const o=official[w.id];
   if(o&&['bridge','tunnel'].includes(o.kind)){
    const src=classifyRailStructure(w.tags,null).kind;
    if(src!==o.kind&&['bridge','tunnel'].includes(src)){mismatch++;mismatchIds.push(String(w.id));}
   }
  }
  // 洞口數 0＝整條線都在地下、全網路找不到一個與非隧道股道相接的端點（例如全地下的捷運線）。
  // 這種沒有「洞口高差」可談，但不能就地丟掉，否則它的里程會從統計裡整段消失。
  if(!portals.length){out.push({system:run[0].system,ways:run.length,id:String(run[0].id),
   km:+(len/1000).toFixed(2),portals:0,洞口高差:null,內部高過洞口:null,內部低於洞口:null,
   最大縱坡:+(grade*100).toFixed(2),gradeAt,mismatch,mismatchIds});continue;}
  const hiP=Math.max(...portals),loP=Math.min(...portals);
  const all=inner.length?inner:portals;
  out.push({system:run[0].system,ways:run.length,id:String(run[0].id),km:+(len/1000).toFixed(2),
   portals:portals.length,洞口高差:+(hiP-loP).toFixed(1),
   內部高過洞口:+Math.max(0,Math.max(...all)-hiP).toFixed(1),
   內部低於洞口:+Math.max(0,loP-Math.min(...all)).toFixed(1),
   最大縱坡:+(grade*100).toFixed(2),gradeAt,mismatch,mismatchIds});
 }
 return out;
}

const pct=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
function table(all,label){
 const rows=all.filter(r=>r.portals>0),buried=all.filter(r=>!r.portals);
 const bySys=new Map();
 for(const r of rows){const k=nameOf(r.system);if(!bySys.has(k))bySys.set(k,[]);bySys.get(k).push(r);}
 console.log('\n## '+label);
 console.log('| 系統 | 連續隧道 | 總長 km | 洞口高差 中位/最大 m | 內部高過洞口 中位/最大 m | 最大顯示縱坡 % | 與官方不一致段數 |');
 console.log('|---|---:|---:|---:|---:|---:|---:|');
 const order=[...bySys.keys()].sort((a,b)=>bySys.get(b).length-bySys.get(a).length);
 for(const k of order){const g=bySys.get(k);
  const d=g.map(r=>r.洞口高差),u=g.map(r=>r.內部高過洞口);
  console.log(`| ${k} | ${g.length} | ${g.reduce((s,r)=>s+r.km,0).toFixed(1)} | ${pct(d,.5).toFixed(1)} / ${Math.max(...d).toFixed(1)} | ${pct(u,.5).toFixed(1)} / ${Math.max(...u).toFixed(1)} | ${Math.max(...g.map(r=>r.最大縱坡)).toFixed(2)} | ${g.reduce((s,r)=>s+r.mismatch,0)} |`);}
 console.log(`| **合計** | **${rows.length}** | **${rows.reduce((s,r)=>s+r.km,0).toFixed(1)}** | — | **${pct(rows.map(r=>r.內部高過洞口),.5).toFixed(1)} / ${Math.max(...rows.map(r=>r.內部高過洞口)).toFixed(1)}** | **${Math.max(...rows.map(r=>r.最大縱坡)).toFixed(2)}** | **${rows.reduce((s,r)=>s+r.mismatch,0)}** |`);
 console.log(`\n全線無洞口（整段在地下、接不到任何地面股道）：${buried.length} 條，共 ${buried.reduce((s,r)=>s+r.km,0).toFixed(1)} 公里`+
  (buried.length?`——${buried.map(r=>nameOf(r.system)+' '+r.id+' '+r.km+'km').join('、')}`:''));
}

const here=fileURLToPath(new URL('../',import.meta.url));  // 路徑含中文，不能用 .pathname（會拿到百分號編碼）
const table0=JSON.parse(fs.readFileSync(here+'data/rail_structures_official.json'));
// entries 只裝「已經照官方改判」的，兩邊互指而地形不支持任何一方的爭議段被放在
// summary.unresolved 且刻意保留來源判定。少了它，那些段會從不一致統計裡消失——
// 那正是最需要被看見的一格。
const official={...table0.entries};
for(const u of table0.summary?.unresolved||[])official[u.id]??={kind:u.official,unresolved:true};
const rows=collect(here,official);
table(rows,'修改後');
const other=process.argv[2];
if(other){
 const base=collect(other.endsWith('/')?other:other+'/',official);
 table(base,'修改前（'+other+'）');
 console.log('\n## 內部高過洞口最嚴重的十條（修改前 → 修改後）');
 const now=new Map(rows.map(r=>[r.system+':'+r.id,r]));
 console.log('| 系統 | 起始 way | 段數 | 長 km | 修改前 m | 修改後 m |');
 console.log('|---|---|---:|---:|---:|---:|');
 for(const b of base.filter(r=>r.portals).sort((a,c)=>c.內部高過洞口-a.內部高過洞口).slice(0,10)){
  const n=now.get(b.system+':'+b.id);
  console.log(`| ${nameOf(b.system)} | ${b.id} | ${b.ways} | ${b.km} | ${b.內部高過洞口} | ${n?n.內部高過洞口:'（分段不同）'} |`);}
}
console.log('\n## 顯示縱坡最陡的六條（短隧道兩端地形落差大於縱坡上限時，洞口高程優先）');
console.log('| 系統 | 起始 way | 段數 | 長 km | 洞口高差 m | 最大顯示縱坡 % |');
console.log('|---|---|---:|---:|---:|---:|');
for(const r of [...rows].sort((a,b)=>b.最大縱坡-a.最大縱坡).slice(0,6))
 console.log(`| ${nameOf(r.system)} | ${r.gradeAt} | ${r.ways} | ${r.km} | ${r.洞口高差} | ${r.最大縱坡} |`);

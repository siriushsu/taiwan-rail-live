// 僅補入公開 OSM 既有股道；接頭必須同 node ID，不補直線、不位移原軌道。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
const file='rail-3d/physical/metro-network.json',pack=JSON.parse(fs.readFileSync(file));
if(pack.routes['mrt:R:1'].startIndex===0){console.log('廣慈雙軌已納入');process.exit(0);}
const source=JSON.parse(fs.readFileSync('scripts/fixtures/guangci-osm-0909.json'));
for(const w of source.elements){assert(!pack.ways.some(p=>p.id==w.id));pack.ways.push({id:String(w.id),system:'mrt',tags:w.tags,nodes:w.nodes.map(String),coordinates:w.geometry.map(p=>[p.lon,p.lat])});}
const walk=(id,sign)=>{const wi=pack.ways.findIndex(w=>w.id==id),n=pack.ways[wi].nodes.length-1;assert(wi>=0);return [wi,sign>0?0:n-1,sign*n];};
const wiA=pack.ways.findIndex(w=>w.id==='197881274'),wiB=pack.ways.findIndex(w=>w.id==='197881275');
const plans=[
 {direction:1,from:'4498833450',to:pack.paths[pack.routes['mrt:R:1'].pathIds[0]].from,walk:[walk(1555091760,-1),walk(453081585,-1),walk(806179562,-1),[wiA,30,-1]]},
 {direction:-1,from:pack.paths[pack.routes['mrt:R:-1'].pathIds.at(-1)].to,to:'4498833448',walk:[[wiB,0,-1],walk(806179561,-1),walk(453081584,-1),walk(1555091759,-1)]}
];
for(const p of plans){const id=pack.paths.length;pack.paths.push({from:p.from,to:p.to,system:'mrt',lengthM:0,walk:p.walk});const path=createRouteRuntime(pack).unfold(id);assert.equal(path.nodeIds[0],p.from);assert.equal(path.nodeIds.at(-1),p.to);pack.paths[id].lengthM=path.path.length;const r=pack.routes['mrt:R:'+p.direction];if(p.direction===1){r.pathIds.unshift(id);r.stationNames.unshift('廣慈/奉天宮');r.stationIndices.unshift(0);}else{r.pathIds.push(id);r.stationNames.push('廣慈/奉天宮');r.stationIndices.push(0);}r.startIndex=0;}
pack.extensions=[...(pack.extensions||[]),{name:'象山—廣慈/奉天宮',source:'OpenStreetMap / Overpass',snapshot:'scripts/fixtures/guangci-osm-0909.json',date:'2026-09-09',ways:source.elements.map(w=>String(w.id)),note:'依共用來源節點接續；站台停車點與行車股道分配仍屬推估。來源部分正線保留 yard 標籤，不改寫原始標籤。'}];
fs.writeFileSync(file,JSON.stringify(pack));console.log(plans.map(p=>({direction:p.direction,from:p.from,to:p.to})));

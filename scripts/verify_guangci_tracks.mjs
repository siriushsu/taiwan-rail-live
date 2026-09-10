import fs from 'node:fs';import assert from 'node:assert/strict';
import {createMetroPhysicalMotion} from '../rail-3d/physical/metro-motion.js';
import {distanceM} from '../rail-3d/integration/train-path.js';
const pack=JSON.parse(fs.readFileSync('rail-3d/physical/metro-network.json')),profiles=JSON.parse(fs.readFileSync('rail-3d/physical/metro-display-profiles.json')),levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json'));
for(const [id,p]of Object.entries(profiles.entries))p.level=levels.entries[id];
const ln={...JSON.parse(fs.readFileSync('data/trtc.json')).lines.find(l=>l.id==='R'),_sys:'mrt'},motion=createMetroPhysicalMotion(pack,profiles);
const resources=[];for(const dir of [1,-1]){const {record,route}=motion.routeFor(ln,dir);assert.equal(record.startIndex,0);assert.equal(record.pathIds.length,ln.stations.length-1);const id=dir===1?record.pathIds[0]:record.pathIds.at(-1),extension=motion.geometry.unfold(id);assert(extension.path.length>1400&&extension.path.length<1600);resources.push(new Set(extension.edges.map(e=>e.resource)));
let previous=null;for(let i=0;i<=1100;i++){const progress=dir===1?i/1000:1.1-i/1000,pos=motion.sample(ln,{progress,lat:25.037583,lon:121.581789},dir);assert(pos.physical);if(previous)assert(distanceM([pos.lon,pos.lat],previous)<3);previous=[pos.lon,pos.lat];for(const mode of ['flat','terrain'])assert(Number.isFinite(route.elevation(pos.chainageM,mode)));assert(route.level(pos.chainageM).offsetM< -3);}
console.log({direction:dir,extensionM:extension.path.length,nodes:extension.nodeIds.length});}
assert([...resources[0]].every(r=>!resources[1].has(r)),'兩方向不得重用同一股道');
const source=JSON.parse(fs.readFileSync('scripts/fixtures/guangci-osm-0909.json'));for(const w of source.elements){const p=pack.ways.find(p=>p.id==w.id);assert.deepEqual(p.coordinates,w.geometry.map(q=>[q.lon,q.lat]));assert.deepEqual(p.nodes,w.nodes.map(String));}
console.log('廣慈雙軌：兩方向連續、來源 XY 未改、地下高度有限、無共軌。');

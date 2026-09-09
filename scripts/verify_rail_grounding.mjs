import fs from 'node:fs';
import assert from 'node:assert/strict';
import {classifyRailStructure} from '../rail-3d/physical/structure-kind.js';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
import {createDisplayLevelLookup} from '../rail-3d/physical/display-level.js';
const read=f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f));
const levels=read('level-profiles.json');let layerOnly=0,grounded=0,bridges=0;
for(const tags of [{layer:'1'},{layer:'2',bridge:'no'},{layer:'1',embankment:'yes'}])assert.equal(classifyRailStructure(tags).kind,'surface');
assert.equal(classifyRailStructure({bridge:'viaduct',layer:'1'}).kind,'bridge');
for(const [nf,pf] of [['network.json','display-profiles.json'],['metro-network.json','metro-display-profiles.json']]){
 const pack=read(nf),profiles=read(pf);for(const [id,e] of Object.entries(profiles.entries))e.level=levels.entries[id];
 const runtime=createRouteRuntime(pack,profiles);
 for(const w of pack.ways){const e=levels.entries[w.id],sourceBridge=!!w.tags.bridge&&w.tags.bridge!=='no';
  if(e?.kind==='bridge'){assert.ok(sourceBridge,'橋梁必須有來源 bridge 標記 '+w.id);bridges++;}
  if(Number(w.tags.layer)>0&&!sourceBridge&&w.tags.tunnel!=='yes'&&w.tags.location!=='underground'){layerOnly++;assert.equal(runtime.levelAt(w.id,0).kind,'surface');if(!e||e.offsets.some(v=>Math.abs(v)<.001))grounded++;}
 }
}
assert.ok(layerOnly>=190);assert.ok(grounded>100);assert.ok(bridges>0);
console.log({layerOnly,grounded,bridges});
const ways=[{id:'lower',system:'tra',coordinates:[[120,23],[120.001,23]]},{id:'cross',system:'tra',coordinates:[[120.0005,22.999],[120.0005,23.001]]},{id:'other-system',system:'hsr',coordinates:[[120,23],[120.001,23]]}];
const lookup=createDisplayLevelLookup(ways,id=>({kind:'bridge',offsetM:id==='lower'?8:24}));
assert.equal(lookup('tra',[120.0005,23],0).sourceWayId,'lower');
assert.equal(lookup('tra',[120.0005,23],Math.PI).offsetM,8);
assert.equal(lookup('tra',[120.0005,23],Math.PI/2).sourceWayId,'cross');
assert.equal(lookup('tra',[120.002,23],0),null);
const ambiguous=createDisplayLevelLookup([...ways,{...ways[0],id:'stacked'}],id=>({offsetM:id==='lower'?8:24}));
assert.equal(ambiguous('tra',[120.0005,23],0),null);
console.log('示意列車高度對應：同系統、雙向、交叉方向、遠處與歧義拒絕通過');

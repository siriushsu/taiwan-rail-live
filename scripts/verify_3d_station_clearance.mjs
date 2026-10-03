// 站房淨空半透明的比對規則(純 node、離線)。
//
// rail-clearance 的 model().excluded 對每個被路線擋到的 footprint 要素填一項:要素有 component 就填部件名,
// 沒有(整座模型只有一個要素)就填模型 id。inspectBlenderBuilding 要把這份清單對回 mesh:
// 部件名對 mesh 的 component,模型 id 命中則整座每一件都算。只比部件名的話,整座模型的記號永遠對不上。
//
// 做法:用目錄裡每一座模型真實的 footprint 與 drawGroups,逐要素餵一條穿過它的路線,
// 預期值只從「哪些 footprint 要素被擋、它們的 component 是什麼」推出來,不看 excluded 字串。
// 每座模型、每個 LOD、每條路線檢查三件事:
//   1. 被擋的部件(要素沒有 component 時是整座)半透明,其餘一件都不動
//   2. 衛星／地景底圖(solidAppearance)時淨空不套用,一律實心
//   3. 透明模式(inspection)整座半透明,不論淨空、也不論實心外觀
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRailClearance} from '../rail-3d/integration/rail-clearance.js';
import {inspectBlenderBuilding} from '../rail-3d/blender-buildings.js';
import * as THREE from '../rail-3d/vendor/three.module.js';

const collections=['blender-buildings-v1','historic-buildings-v2'];
const GLASS=m=>m.transparent&&m.opacity===.24&&!m.depthWrite,SOLID=m=>!m.transparent&&m.opacity===1&&m.depthWrite;
const features=fp=>fp.type==='FeatureCollection'?fp.features:[fp];
const polygons=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
// 穿過要素外框中線的一條東西向路線,兩端各出界約 200m。
function routeThrough(f){const ring=polygons(f)[0][0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),y=(Math.min(...ys)+Math.max(...ys))/2;return {coordinates:[[Math.min(...xs)-.002,y],[Math.max(...xs)+.002,y]]};}
function meshes(drawGroups){const group=new THREE.Group();for(const g of drawGroups){const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));mesh.userData.component=String(g.component);group.add(mesh);}return group;}
const states=group=>{const out=[];group.traverse(o=>{if(o.isMesh)out.push({component:o.userData.component,glass:GLASS(o.material),solid:SOLID(o.material)});});return out;};

let models=0,routes=0,checks=0,wholeRoutes=0;const wholeIds=new Set();
for(const collection of collections){
  const root=new URL(`../rail-3d/assets/${collection}/`,import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
  const catalog=read('catalog.json'),placement=read('placement.json');
  for(const {id} of catalog){
    const source=read(id+'/model.json'),p=placement.entries[id],footprint=p.footprint,meta={...source,anchor:p.anchor};models++;
    assert.equal(meta.id,id,id+' model.json 的 id 要等於目錄 id(淨空以 meta.id 填整座記號)');
    for(const target of features(footprint)){
      const clearance=createRailClearance();clearance.update([routeThrough(target)]);routes++;
      const hit=features(footprint).filter(f=>polygons(f).some(rings=>clearance.blocked(rings)));
      assert.ok(hit.includes(target),id+' 穿過要素的路線沒有擋到該要素,測試前提不成立');
      const wholeHit=hit.some(f=>!f.properties.component),hitComponents=new Set(hit.map(f=>f.properties.component).filter(Boolean).map(String));
      const {excluded}=clearance.model(meta,footprint);
      if(wholeHit){wholeIds.add(id);wholeRoutes++;
        // 根因的資料面:整座記號只有模型 id,drawGroups 沒有任何一件叫這個名字,單比部件名一件都對不上。
        for(const lod of ['near','far'])assert.ok(source.lods[lod].drawGroups.every(g=>String(g.component)!==id),id+' 的部件名不該等於模型 id');
        assert.ok(excluded.includes(id),id+' 整座被擋時 excluded 要含模型 id');
      }
      for(const lod of ['near','far']){
        const drawGroups=source.lods[lod].drawGroups,expectGlass=c=>wholeHit||hitComponents.has(c);
        const run=(inspection,solid)=>{const g=meshes(drawGroups);inspectBlenderBuilding(g,inspection,excluded,solid,id);return states(g);};
        const blocked=run(false,false);
        assert.equal(blocked.length,drawGroups.length);
        for(const s of blocked){assert.ok(s.glass!==s.solid,id+' 材質不是半透明也不是實心');assert.equal(s.glass,expectGlass(s.component),`${id} ${lod} 部件 ${s.component}:被擋=${expectGlass(s.component)},實際半透明=${s.glass}`);}
        if(wholeHit)assert.ok(blocked.every(s=>s.glass),`${id} ${lod} 整座被擋,${drawGroups.length} 件要全部半透明`);
        assert.ok(run(false,true).every(s=>s.solid),`${id} ${lod} 衛星／地景底圖淨空不該半透明`);
        assert.ok(run(true,false).every(s=>s.glass),`${id} ${lod} 透明模式要整座半透明`);
        assert.ok(run(true,true).every(s=>s.glass),`${id} ${lod} 透明模式優先於實心外觀`);
        checks+=4;
      }
      // 沒被擋:清單空的時候一件都不動;透明模式不靠淨空也整座半透明。
      const quiet=(inspection,solid)=>{const g=meshes(source.lods.near.drawGroups);inspectBlenderBuilding(g,inspection,[],solid,id);return states(g);};
      assert.ok(quiet(false,false).every(s=>s.solid),id+' 沒被擋卻變半透明');
      assert.ok(quiet(true,false).every(s=>s.glass),id+' 透明模式(淨空清單空)要整座半透明');checks+=2;
    }
  }
}
for(const id of ['taipei-main-v1','cksmh-landmark-v1','taipei101-landmark-v1','shinkong-landmark-v1','sunyatsen-landmark-v1','tower85-landmark-v1'])assert.ok(wholeIds.has(id),id+' 應屬 footprint 要素沒有 component 的整座模型');
console.log(`PASS ${models} 座模型／${routes} 條穿越路線／${checks} 項材質檢查;整座記號模型 ${wholeIds.size} 座(${wholeRoutes} 條路線)全部整座半透明,衛星／地景實心、透明模式整座不變`);

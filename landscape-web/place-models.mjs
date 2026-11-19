import {modelHours,mapLightClock,lightModelScene} from '../rail-3d/environment/model-hours.js';
// 實際中心點與高度來自 OSM。車廂數：三井台中港開幕專刊、麗寶天空之夢票券介紹。
// https://www.mop.com.tw/taichung/teaser/assets/pdf/MITSUI-OUTLET-PARK1102.pdf
// https://www.lihpaoresort.com/Shop/Ticket/details/2200100019
import * as THREE from './engine/vendor/three.module.js';

const wheels = [
  {name:'taichung-star', ll:[120.5173786,24.2596715], height:60, cabins:36, heading:10},
  {name:'lihpao-sky-dream', ll:[120.7004953,24.3253112], height:126, cabins:60, heading:58},
];

function wheelModel({height, cabins, heading, name}) {
  const group = new THREE.Group(), beams = [], glass = [], shells = [];
  const up = new THREE.Vector3(0,1,0), q = new THREE.Quaternion(), scale = new THREE.Vector3();
  const radius = (height-6)/2, axis = new THREE.Vector3(0,height-radius-1,0);
  const cabinW = height > 80 ? 2.9 : 2.1, half = cabinW*.7;
  const rim = (i, z) => {
    const a = i*2*Math.PI/cabins;
    return new THREE.Vector3(radius*Math.sin(a),axis.y+radius*Math.cos(a),z);
  };
  function beam(a,b,r,color) {
    const dir = b.clone().sub(a), length = dir.length();
    q.setFromUnitVectors(up, dir.normalize()); scale.set(r,length,r);
    beams.push([new THREE.Matrix4().compose(a.clone().lerp(b,.5),q,scale),color]);
  }
  for (const side of [-1,1]) {
    for (const end of [-1,1]) {
      beam(new THREE.Vector3(radius*.55*end,0,side*half*4),new THREE.Vector3(0,axis.y,side*half),height*.013,0xe2e2d8);
    }
    for (let i=0;i<cabins;i++) {
      const z=half*side;
      beam(rim(i,z),rim(i+1,z),height*.0055,0xe9e6de);
      beam(rim(i,z),rim(i+1,-z),height*.0023,0xb6c4c0);
      if(i%2===0) beam(new THREE.Vector3(0,axis.y,z),rim(i,z),height*.0024,0xc1c8c2);
    }
  }
  const box = (list,center,x,y,z,color) => list.push([new THREE.Matrix4().makeScale(x,y,z).setPosition(center),color]);
  for (let i=0;i<cabins;i++) {
    const p = rim(i,0); p.y-=1.35;
    box(glass,p,cabinW,1.35,cabinW*.88,0x657f87);
    p.y-=.82;
    box(shells,p,cabinW*.96,.6,cabinW*.85,[0xbc735f,0xcaac72,0x81988d,0x91a6b3][i%4]);
  }
  const material = new THREE.MeshStandardMaterial({roughness:.72});
  function batch(geometry,items) {
    const mesh=new THREE.InstancedMesh(geometry,material,items.length);
    items.forEach(([matrix,color],i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(color));});
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  batch(new THREE.CylinderGeometry(1,1,1,6),beams);
  batch(new THREE.BoxGeometry(),glass.concat(shells));
  group.rotation.y=(90-heading)*Math.PI/180;
  group.name='park-wheel-'+name;
  return group;
}

const station = {name:'duoliang-station', ll:[120.9588954,22.5074983], layerId:'landscape-duoliang-station'};
const buddha = {name:'foguang-buddha', ll:[120.4390043,22.7578582], layerId:'landscape-foguang-buddha'};
const wheelLayerId='landscape-park-wheel';

async function stationModel() {
  const base = new URL('./models/',import.meta.url);
  const [loader, response] = await Promise.all([import('../rail-3d/blender-buildings.js'),fetch(new URL('duoliang/model.json',base))]);
  if(!response.ok) throw Error('多良站房模型 '+response.status);
  const source=await response.json();
  const group=await loader.buildBlenderBuilding({source,base,placement:{rotationDeg:0}},'near');
  group.rotation.x=-Math.PI/2;
  return group;
}

function modelElevation(map,site) {
  if(site===station) {
    // 站房中心向南迴線投影在 way 146741887 起點後 182 公尺；月臺和列車用相同顯示高程。
    const level=globalThis.railIslandPhysical?.geometry?.levelAt('146741887',182);
    const terrain=!!(map.railIslandGround || map.getTerrain());
    if(terrain && Number.isFinite(level?.terrainHeightM)) return level.terrainHeightM+.65;
    if(!terrain) return (level?.flatOffsetM||0)+.65;
    const q=[120.959016,22.507448];
    return (map.railIslandGround?.at(...q)??map.queryTerrainElevation(q)??0)+(level?.offsetM||0)+.65;
  }
  const sampled=map.railIslandGround?.at(...site.ll);
  return Number.isFinite(sampled)?sampled:map.queryTerrainElevation(site.ll)||0;
}

function release(model) {
  const materials=new Set();
  model?.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);if(o.isInstancedMesh)o.dispose();});
  for(const material of materials) material.dispose();
}

// 在同一個 WebGL 深度緩衝區放置地景模型，移出視野即釋放網格。
export function syncPlaceModel(map, kind) {
  const c=map.getCenter(),z=map.getZoom();
  const site=kind==='landscape' && [station,buddha,...wheels].find(v=>z>=(v===station?15:14) &&
    Math.abs(c.lng-v.ll[0])<.035 && Math.abs(c.lat-v.ll[1])<.035);
  for(const id of [wheelLayerId,station.layerId,buddha.layerId]) {
    const layer=map.getLayer(id);
    if(layer && layer.implementation.modelName!==site?.name) map.removeLayer(id);
  }
  const id=site?.layerId||wheelLayerId;
  if(!site || map.getLayer(id) || !map.getLayer('place-names')) return;
  let renderer,model,scene,camera,sun,ambient,removed=false;
  const hours=modelHours(site.name);
  const matrix=new THREE.Matrix4();
  const layer={id,type:'custom',renderingMode:'3d',modelName:site.name,ready:false,
    onAdd(_,gl){
      renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl}); renderer.autoClear=false;
      scene=new THREE.Scene();camera=new THREE.Camera();
      const loaded=site===station?stationModel():site===buddha?import('./foguang-buddha.mjs').then(m=>m.seatedBuddha()):Promise.resolve(wheelModel(site));
      loaded.then(object=>{
        if(removed){release(object);return;}
        model=object;scene.add(model);layer.ready=true;map.triggerRepaint();
      }).catch(e=>{if(!removed)console.warn('[地景] '+site.name,e);});
      sun=new THREE.DirectionalLight(0xfff2d6,2);sun.position.set(-1,2,.5);
      ambient=new THREE.HemisphereLight(0xf4fcff,0xc4c1a7,1.3);scene.add(sun,ambient);
    },
    render(gl,args){
      if(!model) return;
      const altitude=modelElevation(map,site);
      if(!Number.isFinite(altitude))return;
      const anchor=maplibregl.MercatorCoordinate.fromLngLat(site.ll,altitude),u=anchor.meterInMercatorCoordinateUnits();
      matrix.set(u,0,0,anchor.x, 0,0,u,anchor.y, 0,u,0,anchor.z, 0,0,0,1);
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(matrix);
      lightModelScene(sun,ambient,hours,mapLightClock(globalThis.railIslandSunlight?.current),2,1.35);
      renderer.resetState();renderer.render(scene,camera);renderer.resetState();
    },
    onRemove(){removed=true;release(model);renderer.dispose();},
  };
  map.addLayer(layer,'place-names');
}

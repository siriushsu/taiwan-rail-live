// 區域圖磚與離島的精細廟體使用同一份近景屋面。近景模型到貨後交回原圖磚的深度與光照。
import * as THREE from './engine/vendor/three.module.js';
import {toTM2} from './engine/proj/tm2.mjs';
import {appendHeritageHall} from './heritage-geometry.mjs';
const id='landscape-heritage-halls';
import {heritageSites} from './heritage-catalog.mjs';
function makeHall(part,site,material){
  const polys=part.ring.map(ll=>toTM2(...ll)),origin=toTM2(...site.center);
  const ring=polys.map(([x,y])=>[x-origin[0],y-origin[1]]);
  const pos=[],col=[],nor=[];
  appendHeritageHall(part,ring,0,pos,col,nor);
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geom.setAttribute('color',new THREE.Uint8BufferAttribute(col,4,true));
  geom.setAttribute('normal',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(Int8Array.from(nor),4),3,0,true));
  const mesh=new THREE.Mesh(geom,material);
  const ll=part.ring.reduce(([x,y],[e,n])=>[x+e/part.ring.length,y+n/part.ring.length],[0,0]);
  const tm=toTM2(...ll);
  mesh.userData={ll,tm,tile:'E'+Math.floor(tm[0]/1280)+'_N'+Math.floor(tm[1]/1280)};
  return mesh;
}
export async function syncHeritageModels(map,kind,hour){
  const sites=await heritageSites();
  // 等待清單期間，鏡頭或底圖都可能已切換。
  if(!map.getLayer('place-names') || kind()!=='landscape' || map.getZoom()<14){
    if(map.getLayer(id))map.removeLayer(id);
    return;
  }
  const bounds=map.getBounds(),near=sites.filter(s=>bounds.contains(s.center));
  const key=near.map(s=>s.id).join('.');
  if(map.getLayer(id)?.implementation.key===key)return;
  if(map.getLayer(id))map.removeLayer(id);
  if(!near.length)return;
  let renderer,camera,material;
  const groups=[];
  map.addLayer({id,type:'custom',renderingMode:'3d',key,models:groups,
    onAdd(_,gl){
      renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});renderer.autoClear=false;
      material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,side:THREE.DoubleSide});
      camera=new THREE.Camera();
      for(const site of near){
        const scene=new THREE.Scene();
        for(const part of site.parts)scene.add(makeHall(part,site,material));
        const sun=new THREE.DirectionalLight(0xffefd8,2),sky=new THREE.HemisphereLight(0xfffaf0,0xc3b9a6,1);
        sun.position.set(-1,2,.5);scene.add(sun,sky);
        const anchor=maplibregl.MercatorCoordinate.fromLngLat(site.center,0),u=anchor.meterInMercatorCoordinateUnits();
        const local=new THREE.Matrix4().set(u,0,0,anchor.x,0,0,u,anchor.y,0,u,0,anchor.z,0,0,0,1);
        groups.push({site,scene,sun,sky,local});
      }
    },
    render(gl,args){
      const web=globalThis.railIslandLandscapeWeb,api=web?.active && web.revealed && web.api(),tiles=api?.tiles;
      const day=Math.max(0,Math.min(1,Math.sin((hour()-6)*Math.PI/12)*3));
      renderer.resetState();
      for(const {site,scene,sun,sky,local} of groups){
        let drawable=false;
        for(const m of scene.children){
          if(!m.isMesh)continue;
          const {ll,tm,tile}=m.userData;
          const native=tiles?.get?.(tile)?.near?.group;
          m.visible=!(native?.visible && native.getObjectByName('heritage-'+site.id));
          if(m.visible){
            const block=api?.index?.farM;
            const actualLand=api?.index?.tiles[tile] || (block && api.index.far?.['F'+Math.floor(tm[0]/block)+'_'+Math.floor(tm[1]/block)]);
            const h=actualLand?map.railIslandGround?.at(...ll):NaN;
            m.position.y=Number.isFinite(h)?h:(map.queryTerrainElevation(ll)||0);drawable=true;
          }
        }
        if(!drawable)continue;
        sun.intensity=2*day;sky.intensity=.5+.9*day;
        camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(local);
        renderer.render(scene,camera);
      }
      renderer.resetState();
    },
    onRemove(){
      for(const {scene} of groups)scene.traverse(o=>o.geometry?.dispose());
      material.dispose();renderer.dispose();
    },
  },'place-names');
  map.triggerRepaint();
}

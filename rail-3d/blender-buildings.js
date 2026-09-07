import * as THREE from './vendor/three.module.js';
const base=new URL('./assets/blender-buildings-v1/',import.meta.url);
const read=async name=>{const r=await fetch(new URL(name,base));if(!r.ok)throw Error('建築模型資料載入失敗 '+name);return r.json();};
export async function buildingCatalog(){const [catalog,placement]=await Promise.all([read('catalog.json'),read('placement.json')]);return Promise.all(catalog.map(async entry=>{const source=await read(entry.id+'/model.json'),p=placement.entries[entry.id];if(!p?.anchor||source.railElevationM!=null||p.railElevationM!==null)throw Error('建築定位契約不符 '+entry.id);return {entry,meta:{...source,anchor:p.anchor,rotationDeg:p.rotationDeg,displayHeightM:source.sizeM[2],railElevationM:null,blender:true},source,placement:p,footprint:p.footprint};}));}
export async function buildBlenderBuilding(record,lod){
 const {source,placement}=record,spec=source.lods[lod],r=await fetch(new URL(source.id+'/'+spec.file,base));if(!r.ok)throw Error(source.name+' Blender 網格載入失敗');const bytes=await r.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==spec.sha256||bytes.byteLength!==spec.vertexCount*24)throw Error(source.name+' Blender 網格版本不符');
 const group=new THREE.Group();group.name=source.name;group.userData.blender=true;group.userData.lod=lod;group.rotation.z=placement.rotationDeg*Math.PI/180;
 const data=new Float32Array(bytes),buffer=new THREE.InterleavedBuffer(data,6),position=new THREE.InterleavedBufferAttribute(buffer,3,0),normal=new THREE.InterleavedBufferAttribute(buffer,3,3);
 for(const part of spec.drawGroups){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',position);geometry.setAttribute('normal',normal);geometry.setDrawRange(part.start,part.count);
  const material=new THREE.MeshStandardMaterial({color:new THREE.Color(...part.color),metalness:part.metalness,roughness:part.roughness,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);mesh.userData.part='shell';mesh.userData.component=String(part.component);mesh.frustumCulled=false;group.add(mesh);
 }return group;
}
export function inspectBlenderBuilding(root,inspection,clearance=[],solidAppearance=false){const affected=new Set(clearance.map(String));root.traverse(mesh=>{if(!mesh.isMesh)return;const active=inspection||!solidAppearance&&affected.has(mesh.userData.component),m=mesh.material;m.transparent=active;m.opacity=active?.24:1;m.depthWrite=!active;m.needsUpdate=true;});}

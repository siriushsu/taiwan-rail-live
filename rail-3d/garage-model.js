// 車庫的完整 Blender 素材與既有中間車／輕軌分節共用載入器。
import * as THREE from './vendor/three.module.js';
const base=new URL('./assets/garage-blender-v1/',import.meta.url),mapBase=new URL('./assets/blender-map-v1/',import.meta.url);
async function json(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error('model metadata');return r.json();}
async function checked(url,signal,bytes,sha,gzip=false){
 const r=await fetch(url,{signal});if(!r.ok)throw Error('model mesh');let b=await r.arrayBuffer();
 if(gzip){let decoded;if(typeof DecompressionStream==='function')try{decoded=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}catch{}
  if(!decoded){const {gunzipSync}=await import('./vendor/fflate-gunzip.js');const a=gunzipSync(new Uint8Array(b));decoded=a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}b=decoded;
 }
 if(b.byteLength!==bytes)throw Error('model size');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(digest!==sha)throw Error('model hash');return b;
}
function grey(m){m.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.rgb=vec3(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722)));');};return m;}
export async function loadGarageModel(id,signal,mapMeta){
 const geometry=new THREE.BufferGeometry();let materials=[],lockedMaterials=[];
 try{
  if(mapMeta){
   const b=await checked(new URL(mapMeta.file,mapBase),signal,mapMeta.byteLength,mapMeta.sha256),data=new Float32Array(b),buffer=new THREE.InterleavedBuffer(data,10);
   // 地圖衍生 mesh 的頂點色是 sRGB；轉回線性後與車頭使用同一組 PBR 光源。
   const rgb=new Float32Array(data.length/10*3),c=new THREE.Color();for(let i=0;i<data.length/10;i++){c.setRGB(data[i*10+6],data[i*10+7],data[i*10+8],THREE.SRGBColorSpace);rgb.set([c.r,c.g,c.b],i*3);}
   geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));geometry.setAttribute('color',new THREE.BufferAttribute(rgb,3));
   materials=[new THREE.MeshPhysicalMaterial({vertexColors:true,metalness:.18,roughness:.42,side:THREE.DoubleSide})];lockedMaterials=[grey(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}))];
  }else{
   const meta=await json(new URL(id+'.json',base),signal),b=await checked(new URL(meta.mesh.file,base),signal,meta.mesh.vertexCount*24,meta.mesh.sha256,true),buffer=new THREE.InterleavedBuffer(new Float32Array(b),6);
   geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));
   const flat=v=>Math.min(1,Math.max(0,(v*.95-.5)*.45+.5));
   for(const [i,g]of meta.mesh.drawGroups.entries()){geometry.addGroup(g.start,g.count,i);materials.push(new THREE.MeshPhysicalMaterial({name:g.name,color:new THREE.Color(...g.color),metalness:g.metalness,roughness:g.roughness,clearcoat:g.clearcoat,side:THREE.DoubleSide}));
    const l=flat(.2126*g.color[0]+.7152*g.color[1]+.0722*g.color[2]);lockedMaterials.push(grey(new THREE.MeshPhysicalMaterial({name:g.name+':locked',color:new THREE.Color(l,l,l),roughness:.9,side:THREE.DoubleSide})));
   }
  }
  geometry.computeBoundingBox();geometry.computeBoundingSphere();const center=new THREE.Vector3(),size=new THREE.Vector3();geometry.boundingBox.getCenter(center);geometry.boundingBox.getSize(size);
  return{geometry,materials,lockedMaterials,center,size,dispose(){geometry.dispose();[...materials,...lockedMaterials].forEach(m=>m.dispose());}};
 }catch(e){geometry.dispose();[...materials,...lockedMaterials].forEach(m=>m.dispose());throw e;}
}
let manifestPromise;
export async function createConsist(id,primary,signal){
 // Manifest 只含已發布的素材與示意編組；不推論使用者是否真的搭過這個編組。
 const catalog=await (manifestPromise??=json(new URL('manifest.json',mapBase)).catch(e=>{manifestPromise=null;throw e;}));
 const template=catalog.models[id];if(!template)throw Error('formation missing');
 let parts=template.articulated?[template.parts[0],template.parts[2],template.parts[4]]:template.parts;
 if(parts.length===1)parts=[parts[0],{mesh:'bluecoach',flip:false},{mesh:'bluecoach',flip:false}];
 if(parts.length!==3)throw Error('formation count');
 const assets=new Map([[id,primary]]),owned=[],root=new THREE.Group(),cars=[];
 try{
  for(const part of parts){if(assets.has(part.mesh))continue;
   const derived=part.mesh.includes('-mid')||part.mesh.includes('-section-');
   const a=await loadGarageModel(part.mesh,signal,derived?catalog.meshes[part.mesh]:null);assets.set(part.mesh,a);owned.push(a);
  }
  const scale=1.25/primary.size.y,items=parts.map(part=>({...part,asset:assets.get(part.mesh)}));
  const gap=template.articulated?.08:.14,total=items.reduce((n,p)=>n+p.asset.size.x*scale,0)+gap*2;let front=total/2;
  for(const part of items){const a=part.asset,length=a.size.x*scale,car=new THREE.Group(),body=new THREE.Mesh(a.geometry,a.materials);
   body.position.set(-a.center.x,-a.center.y,-a.geometry.boundingBox.min.z);car.add(body);car.scale.setScalar(scale);car.rotation.z=part.flip?Math.PI:0;car.position.set(front-length/2,0,.18);front-=length+gap;root.add(car);cars.push({car,body,asset:a,id:part.mesh,length});
  }
  const cg=new THREE.BoxGeometry(gap+.12,.11,.11),cm=new THREE.MeshStandardMaterial({color:'#343b3c',roughness:.8});
  for(let i=0;i<2;i++){const c=new THREE.Mesh(cg,cm);c.position.set(cars[i].car.position.x-cars[i].length/2-gap/2,0,.44);root.add(c);}
  return{root,cars,length:total,update(owned){for(const c of cars)c.body.material=owned?c.asset.materials:c.asset.lockedMaterials;},dispose(){root.clear();owned.forEach(a=>a.dispose());cg.dispose();cm.dispose();}};
 }catch(e){owned.forEach(a=>a.dispose());throw e;}
}

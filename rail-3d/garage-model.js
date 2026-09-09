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
export async function loadGarageModel(id,signal,mapMeta,reference){
 const geometry=new THREE.BufferGeometry();let materials=[],lockedMaterials=[];
 try{
  if(mapMeta){
   const b=await checked(new URL(mapMeta.file,mapBase),signal,mapMeta.byteLength,mapMeta.sha256),data=new Float32Array(b),buffer=new THREE.InterleavedBuffer(data,10);
   // 地圖衍生 mesh 的頂點色是 sRGB；轉回線性後與車頭使用同一組 PBR 光源。
   const rgb=new Float32Array(data.length/10*3),c=new THREE.Color();for(let i=0;i<data.length/10;i++){c.setRGB(data[i*10+6],data[i*10+7],data[i*10+8],THREE.SRGBColorSpace);rgb.set([c.r,c.g,c.b],i*3);}
   geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));geometry.setAttribute('color',new THREE.BufferAttribute(rgb,3));
   if(reference){
    // 地圖 LOD 保留了色票與粗糙度；還原完整模型的材質，避免中間車整節共用塑膠表面。
    materials=reference.materials.map(m=>m.clone());lockedMaterials=reference.lockedMaterials.map(m=>grey(m.clone()));
    const key=(r,g,b,gloss)=>[r,g,b,gloss].map(v=>Math.round(v*10000)).join(','),palette=new Map(),swatches=[],buckets=materials.map(()=>[]);
    for(const [i,m]of materials.entries()){const s=m.color.clone().convertLinearToSRGB();palette.set(key(s.r,s.g,s.b,1-m.roughness),i);swatches.push([s.r,s.g,s.b,1-m.roughness]);}
    const a=new THREE.Vector3(),b=new THREE.Vector3(),n=new THREE.Vector3();
    for(let i=0;i<data.length/10;i+=3){
     const j=i*10,k=key(data[j+6],data[j+7],data[j+8],data[j+9]);let mi=palette.get(k);
     // Blender 與 Three 的色彩轉換有浮點近似差；只容許極小誤差，仍須同時符合粗糙度。
     if(mi===undefined){mi=swatches.findIndex(s=>s.every((v,k)=>Math.abs(v-data[j+6+k])<.0002));if(mi<0)throw Error('model material');palette.set(k,mi);}
     buckets[mi].push(i,i+1,i+2);
     if(materials[mi].name==='glass'){
      // 簡化時的平滑法線會把平面玻璃變成鼓起的反光；車窗用實際三角面方向。
      a.set(data[j+10]-data[j],data[j+11]-data[j+1],data[j+12]-data[j+2]);b.set(data[j+20]-data[j],data[j+21]-data[j+1],data[j+22]-data[j+2]);n.crossVectors(a,b).normalize();
      for(let k=0;k<3;k++)n.toArray(data,j+k*10+3);
     }
    }
    const indices=[];for(const [i,bucket]of buckets.entries())if(bucket.length){geometry.addGroup(indices.length,bucket.length,i);for(const v of bucket)indices.push(v);}geometry.setIndex(indices);
   }else{
    geometry.addGroup(0,geometry.getAttribute('position').count,0);
    materials=[new THREE.MeshPhysicalMaterial({vertexColors:true,metalness:.18,roughness:.42,side:THREE.DoubleSide})];lockedMaterials=[grey(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}))];
   }
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
   const a=await loadGarageModel(part.mesh,signal,derived?catalog.meshes[part.mesh]:null,derived?primary:null);assets.set(part.mesh,a);owned.push(a);
  }
  const scale=1.25/primary.size.y,items=parts.map(part=>({...part,asset:assets.get(part.mesh)}));
  const gap=template.articulated?.08:.14,total=items.reduce((n,p)=>n+p.asset.size.x*scale,0)+gap*2;let front=total/2;
  for(const part of items){const a=part.asset,length=a.size.x*scale,car=new THREE.Group(),body=new THREE.Mesh(a.geometry,a.materials);
   body.position.set(-a.center.x,-a.center.y,-a.geometry.boundingBox.min.z);car.add(body);car.scale.setScalar(scale);car.rotation.z=part.flip?Math.PI:0;car.position.set(front-length/2,0,.18);front-=length+gap;root.add(car);cars.push({car,body,asset:a,id:part.mesh,length,offset:car.position.x,flip:part.flip,heading:0});
  }
  const couplers=[],cg=new THREE.BoxGeometry(1,.11,.11),cm=new THREE.MeshStandardMaterial({color:'#343b3c',roughness:.8});
  for(let i=0;i<2;i++){const c=new THREE.Mesh(cg,cm);root.add(c);couplers.push(c);}
  function couple(){for(let i=0;i<2;i++){const a=cars[i],b=cars[i+1],ax=a.car.position.x-Math.cos(a.heading)*a.length/2,ay=a.car.position.y-Math.sin(a.heading)*a.length/2,bx=b.car.position.x+Math.cos(b.heading)*b.length/2,by=b.car.position.y+Math.sin(b.heading)*b.length/2,c=couplers[i];c.position.set((ax+bx)/2,(ay+by)/2,.44);c.rotation.z=Math.atan2(by-ay,bx-ax);c.scale.x=Math.hypot(bx-ax,by-ay)+.08;}}
  function straight(direction){root.rotation.z=direction===-1?0:Math.PI;for(const c of cars){c.car.position.set(c.offset,0,.18);c.car.rotation.z=c.flip?Math.PI:0;c.heading=0;}couple();}
  function follow(path,distance,direction){
   root.rotation.z=0;
   // 車身由前後轉向架之間的弦決定；反向只改朝向與速度，不瞬移車廂的位置。
   for(const c of cars){const s=distance+c.offset,a=path.sample(s+c.length*.30),b=path.sample(s-c.length*.30);c.heading=Math.atan2(a.y-b.y,a.x-b.x);c.car.position.set((a.x+b.x)/2,(a.y+b.y)/2,.18);c.car.rotation.z=c.heading+(c.flip?Math.PI:0)+(direction===-1?Math.PI:0);}
   couple();
  }
  straight(1);
  return{root,cars,length:total,straight,follow,update(owned){for(const c of cars)c.body.material=owned?c.asset.materials:c.asset.lockedMaterials;},dispose(){root.clear();owned.forEach(a=>a.dispose());cg.dispose();cm.dispose();}};
 }catch(e){owned.forEach(a=>a.dispose());throw e;}
}

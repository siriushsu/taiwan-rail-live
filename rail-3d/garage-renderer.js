// 收藏近看使用 Blender 原始網格與 PBR 材質；單一 WebGL context、單款常駐。
import * as THREE from './vendor/three.module.js';

export function createRenderer(onLost = () => {}) {
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, preserveDrawingBuffer:true});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-6,6,4,-4,.1,160);
  camera.up.set(0,0,1);
  scene.add(new THREE.HemisphereLight('#e6efff','#938670',1.75));
  for (const [color,intensity,pos] of [['#fff5e6',3,[7,-9,14]],['#d7e8ff',1.5,[-7,5,8]]]) {
    const light = new THREE.DirectionalLight(color,intensity);light.position.set(...pos);scene.add(light);
  }
  const studio = new THREE.Scene();studio.background = new THREE.Color(.30,.34,.38);
  const cards=[];
  for(const [position,size,strength] of [[[9,-8,11],[8,3],4.8],[[-9,5,7],[7,4],2.8],[[0,1,14],[9,5],3.6]]) {
    const card=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial({color:new THREE.Color(strength,strength,strength),side:THREE.DoubleSide}));
    card.position.set(...position);card.lookAt(0,0,1);studio.add(card);cards.push(card);
  }
  const pmrem=new THREE.PMREMGenerator(renderer), environment=pmrem.fromScene(studio,.07,.1,60);
  scene.environment=environment.texture;cards.forEach(c=>{c.geometry.dispose();c.material.dispose();});pmrem.dispose();
  let car=null, geometry=null, materials=[], abort, revision=0, disposed=false, lost=false, id='';
  let center=new THREE.Vector3(), size=new THREE.Vector3();
  const clear=()=>{if(car)scene.remove(car);geometry?.dispose();materials.forEach(m=>m.dispose());car=null;geometry=null;materials=[];id='';};
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!disposed){lost=true;onLost();}});
  return {
    async load(nextId) {
      if(disposed||lost)throw Error('renderer unavailable');
      if(nextId===id)return;
      const ticket=++revision;abort?.abort();abort=new AbortController();const {signal}=abort;
      clear();
      const base=new URL('./assets/garage-blender-v1/',import.meta.url);
      const response=await fetch(new URL(nextId+'.json',base),{signal});
      if(!response.ok)throw Error('model metadata');
      const meta=await response.json(), raw=await fetch(new URL(meta.mesh.file,base),{signal});
      if(!raw.ok)throw Error('model mesh');
      const compressed=await raw.arrayBuffer();
      let binary;
      if(typeof DecompressionStream==='function') {
        try { binary=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); } catch { /* Safari 16.4 的大輸出錯誤亦回到相容路徑。 */ }
      }
      if(!binary) {
        const {gunzipSync}=await import('./vendor/fflate-gunzip.js');
        const decoded=gunzipSync(new Uint8Array(compressed));
        binary=decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength);
      }
      if(binary.byteLength!==meta.mesh.vertexCount*24)throw Error('model size');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==meta.mesh.sha256)throw Error('model hash');
      if(disposed||ticket!==revision)return;
      const buffer=new THREE.InterleavedBuffer(new Float32Array(binary),6);
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));
      geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));
      materials=meta.mesh.drawGroups.map((g,i)=>{
        geometry.addGroup(g.start,g.count,i);
        return new THREE.MeshPhysicalMaterial({name:g.name,color:new THREE.Color(...g.color),metalness:g.metalness,roughness:g.roughness,clearcoat:g.clearcoat,side:THREE.DoubleSide});
      });
      geometry.computeBoundingBox();geometry.boundingBox.getCenter(center);geometry.boundingBox.getSize(size);
      car=new THREE.Mesh(geometry,materials);scene.add(car);id=nextId;
    },
    draw(target,row,angle) {
      if(disposed||lost||row.id!==id||!car)return false;
      const rect=target.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,1.5);
      const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
      if(target.width!==w||target.height!==h){target.width=w;target.height=h;}
      renderer.setSize(w,h,false);
      const aspect=w/h,elevation=.39,diag=Math.hypot(size.x,size.y);
      const span=Math.max(diag/2/aspect,diag*Math.sin(elevation)/2+size.z*Math.cos(elevation)/2)*1.12;
      Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.updateProjectionMatrix();
      const yaw=angle;
      camera.position.set(center.x+50*Math.cos(elevation)*Math.cos(yaw),center.y+50*Math.cos(elevation)*Math.sin(yaw),center.z+50*Math.sin(elevation));
      camera.lookAt(center);renderer.render(scene,camera);
      const ctx=target.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(renderer.domElement,0,0);
      target.dataset.rendered=id;target.dataset.appearance='blender-original';target.dataset.vertices=String(geometry.attributes.position.count);
      return true;
    },
    dispose() {
      disposed=true;revision++;abort?.abort();clear();environment.dispose();renderer.dispose();renderer.forceContextLoss();
    },
  };
}

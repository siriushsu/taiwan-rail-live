// 逐節用正式材質在 GPU 上作畫，避免「編組陣列有三節，但中間車完全透明」仍通過驗收。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/';
const OUT=process.env.GARAGE_PIXEL_OUT||'.superpowers/garage-car-pixels';mkdirSync(OUT,{recursive:true});
const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const p=await b.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
  await p.route('**/__garage_pixel_fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>車庫逐節像素驗收</title>'}));
  await p.goto(new URL('/__garage_pixel_fixture',BASE).href);
  const rows=await p.evaluate(async requested=>{
   const THREE=await import('/rail-3d/vendor/three.module.js'),{loadGarageModel,createConsist}=await import('/rail-3d/garage-model.js');
   const catalog=await fetch('/rail-3d/assets/blender-map-v1/manifest.json').then(r=>r.json());
   const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false}),target=new THREE.WebGLRenderTarget(512,256),scene=new THREE.Scene();
   renderer.setSize(512,256);renderer.setClearColor(0,0);renderer.setRenderTarget(target);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,3));
   const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-3,-5,8);scene.add(light);
   const camera=new THREE.OrthographicCamera(-4,4,2,-2,.01,1000);camera.up.set(0,0,1);
   const pixels=new Uint8Array(512*256*4),rows=[];
   function painted(){renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,512,256,pixels);let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)count++;return count;}
   try{
    for(const id of requested.length?requested:Object.keys(catalog.models)){
     const primary=await loadGarageModel(id);let consist;
     try{
      consist=await createConsist(id,primary);scene.add(consist.root);consist.root.rotation.set(0,0,0);
      for(const child of consist.root.children)child.visible=false;
      const cars=[];
      for(const c of consist.cars){
       c.car.position.set(0,0,0);c.car.rotation.set(0,0,0);
       const box=new THREE.Box3().setFromObject(c.car),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),half=Math.max(size.x/4,size.z/2,size.y/2)*1.4;
       camera.left=-half*2;camera.right=half*2;camera.top=half;camera.bottom=-half;camera.position.copy(center).add(new THREE.Vector3(0,-10,4));camera.lookAt(center);camera.updateProjectionMatrix();
       const hidden=painted();c.car.visible=true;const counts=[];
       for(const owned of [true,false]){consist.update(owned);counts.push(painted());}
       cars.push({id:c.id,hidden,owned:counts[0],locked:counts[1]});c.car.visible=false;
      }
      rows.push({id,cars,pass:cars.length===3&&cars.every(c=>c.hidden===0&&c.owned>500&&c.locked>500)});
     }finally{if(consist){scene.remove(consist.root);consist.dispose();}primary.dispose();}
    }
   }finally{target.dispose();renderer.dispose();}
   return rows;
  },(process.env.GARAGE_PIXEL_IDS||'').split(',').filter(Boolean));
  for(const row of rows){results.push({engine,...row});console.log(row.pass?'PASS':'FAIL',engine,row.id,JSON.stringify(row.cars));}
  results.push({engine,id:'渲染錯誤',pass:errors.length===0,errors});
 }catch(e){results.push({engine,pass:false,error:e.stack});console.error(engine,e);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({base:BASE,date:new Date().toISOString(),results},null,2));
console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

// 真 WebGL：地下列車雙面 / 單次繪製逐像素比對，含實際網格、雙向姿態、夜燈與遮蔽。
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5248/',results=[];
fs.mkdirSync('output/train-single-pass',{recursive:true});
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const page=await browser.newPage({viewport:{width:640,height:480}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/single-pass-test',r=>r.fulfill({contentType:'text/html',body:'<canvas id="test" width="640" height="480"></canvas>'}));
  await page.goto(base+'single-pass-test');
  const result=await page.evaluate(async()=>{
   const THREE=await import('/rail-3d/vendor/three.module.js');
   const {createWenhuGeometry,createWenhuMaterial}=await import('/rail-3d/assets/wenhu-v1/wenhu.js');
   const {installTrainLighting,prepareWindowLighting}=await import('/rail-3d/integration/train-lighting.js');
   const catalog=await (await fetch('/rail-3d/assets/blender-map-v1/manifest.json')).json(),assets=[];
   for(const id of ['c381','wenhu','airportexpress','emu3000'].filter(id=>catalog.meshes[id])){
    const meta=catalog.meshes[id],data=new Float32Array(await (await fetch('/rail-3d/assets/blender-map-v1/'+meta.file)).arrayBuffer());
    const geometry=createWenhuGeometry(THREE,{data});prepareWindowLighting(geometry,THREE);assets.push({geometry,meta,id});
   }
   const scene=new THREE.Scene(),camera=new THREE.Camera(),renderer=new THREE.WebGLRenderer({canvas:document.getElementById('test'),antialias:false});
   renderer.setSize(640,480,false);renderer.autoClear=false;
   // 故意使用遠離原點的公尺座標，讓精度驗證能抓到把矩陣合成移回 GPU 的退步。
   camera.projectionMatrix.set(.007,0,0,-1610,0,.025,.015,-22500,0,0,-.02,0,0,0,0,1);
   const material=createWenhuMaterial(THREE);installTrainLighting(material,THREE);
   material.uniforms.trainClipMatrix={value:new THREE.Matrix4()};material.vertexShader='uniform mat4 trainClipMatrix;\n'+material.vertexShader.replace('projectionMatrix*modelViewMatrix*vec4(position,1.0)','trainClipMatrix*vec4(position,1.0)');
   const light=(mat,camera,mesh)=>{mat.uniforms.trainClipMatrix.value.multiplyMatrices(camera.projectionMatrix,mesh.modelViewMatrix);mat.uniforms.trainBounds.value.set(mesh.geometry.boundingBox.min.x,mesh.geometry.boundingBox.max.x);mat.uniforms.trainTunnel.value.fromArray(mesh.userData.trainLight.tunnel);mat.uniformsNeedUpdate=true;};
   material.onBeforeRender=(_r,_s,c,_g,m)=>light(material,c,m);
   const under=material.clone();under.transparent=true;under.depthWrite=false;under.uniforms.trainOpacity.value=.42;under.onBeforeRender=(_r,_s,c,_g,m)=>light(under,c,m);
   const depth=material.clone();depth.colorWrite=false;depth.onBeforeRender=(_r,_s,c,_g,m)=>light(depth,c,m);
   const models=new Map(),checks=[];
   const build=(count,transparent)=>{
    for(const m of models.values())scene.remove(m.group);models.clear();
    const group=new THREE.Group(),cars=[];
    for(let i=0;i<count;i++){
     const {geometry,meta}=assets[i%assets.length],car=new THREE.Group(),mesh=new THREE.Mesh(geometry,i%4===0&&transparent?under:material);
     const sx=20/(meta.max[0]-meta.min[0]),sy=3.2/(meta.max[1]-meta.min[1]);mesh.scale.set(sx,sy,sy);mesh.position.set(-(meta.min[0]+meta.max[0])/2*sx,0,-meta.min[2]*sy);
     mesh.layers.set(i%4===0?1:0);mesh.layers.enable(2);mesh.renderOrder=3;mesh.userData.trainLight={tunnel:[i%3/2,(i+1)%3/2,(i+2)%3/2]};
     car.position.set(230000-100+i%8*28,900000-27+Math.floor(i/8)*11,i%4===0?2:0);car.rotation.set(0,i%2?.06:-.04,i%2?Math.PI:.08,'ZYX');car.add(mesh);group.add(car);cars.push(car);
    }
    group.visible=true;scene.add(group);models.set('test',{group,cars});
   };
   const shot=(singlePass,night)=>{
    material.uniforms.trainNight.value=under.uniforms.trainNight.value=night;under.forceSinglePass=singlePass;
    renderer.clear();let calls=0;
    const draw=pass=>{camera.layers.set(pass);scene.overrideMaterial=pass===2?depth:null;renderer.render(scene,camera);scene.overrideMaterial=null;calls+=renderer.info.render.calls;};
    draw(0);renderer.clearDepth();draw(2);draw(1);camera.layers.set(0);
    const gl=renderer.getContext(),pixels=new Uint8Array(640*480*4);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {pixels,calls};
   };
   for(const [count,transparent]of [[16,false],[40,true],[88,true],[88,false],[8,true],[0,false]]){
    build(count,transparent);
    for(const night of [0,1]){
     const a=shot(false,night),b=shot(true,night);let max=0,different=0,painted=0;
     for(let i=0;i<a.pixels.length;i+=4){if(a.pixels[i]+a.pixels[i+1]+a.pixels[i+2])painted++;let delta=0;for(let k=0;k<4;k++){const d=Math.abs(a.pixels[i+k]-b.pixels[i+k]);delta=Math.max(delta,d);max=Math.max(max,d);}if(delta>1)different++;}
     checks.push({count,transparent,night,painted,max,different,beforeCalls:a.calls,afterCalls:b.calls});
    }
   }
   const memory=renderer.info.memory.geometries;
   for(const {geometry}of assets)geometry.dispose();material.dispose();under.dispose();depth.dispose();renderer.dispose();
   return {checks,assets:assets.map(a=>a.id),memory};
  });
  console.log(name,JSON.stringify(result));results.push({name,...result,errors});
  assert(result.assets.length>=3,'需要多種實際車廂網格');
  assert.equal(result.memory,result.assets.length,'只能使用來源網格');
  for(const row of result.checks){assert(row.count===0||row.painted>500,'比較必須確實畫出列車');assert.equal(row.different,0,'地下單次繪製必須逐像素等價（容許 1 色階量化）');assert(row.count===0||!row.transparent||row.afterCalls<row.beforeCalls,'透明車廂繪製指令必須減少');}
  assert.equal(errors.length,0,'shader 或瀏覽器錯誤不可當成效能改善');
 }finally{await browser.close();}
}
fs.writeFileSync('output/train-single-pass/results.json',JSON.stringify(results,null,2));console.log('PASS 雙引擎地下單次繪製、夜間照明與透視逐像素等價');

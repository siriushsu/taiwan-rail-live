import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5256/',out='output/portal-review',rows=[];
fs.mkdirSync(out,{recursive:true});
function check(name,pass,detail){rows.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));}
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch(),p=await b.newPage({viewport:{width:900,height:400}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+'rail-3d/integration/train-lighting.js');
  await p.evaluate(async()=>{
   document.body.innerHTML='';document.body.style.margin='0';
   const THREE=await import('/rail-3d/vendor/three.module.js'),{createWenhuGeometry,createWenhuMaterial}=await import('/rail-3d/assets/wenhu-v1/wenhu.js'),{prepareWindowLighting,installTrainLighting}=await import('/rail-3d/integration/train-lighting.js');
   const catalog=await(await fetch('/rail-3d/assets/blender-map-v1/manifest.json')).json(),cache=new Map();
   window.__load=async id=>{if(cache.has(id))return cache.get(id);const meta=catalog.meshes[id],data=new Float32Array(await(await fetch('/rail-3d/assets/blender-map-v1/'+meta.file)).arrayBuffer()),g=createWenhuGeometry(THREE,{data});prepareWindowLighting(g,THREE);cache.set(id,g);return g;};
   window.__coverage=[];
   for(const id of Object.keys(catalog.meshes)){const g=await __load(id),a=g.getAttribute('windowLight');let lit=0,bad=0;for(let i=0;i<a.count;i++){lit+=a.getX(i);if(!Number.isFinite(a.getY(i))||a.getY(i)<0||a.getY(i)>1)bad++;}__coverage.push({id,lit,bad});}
   const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(900,400);document.body.append(renderer.domElement);
   const scene=new THREE.Scene();scene.background=new THREE.Color('#263544');const camera=new THREE.OrthographicCamera(-6,6,4,-1,.1,100),material=createWenhuMaterial(THREE),original=createWenhuMaterial(THREE);installTrainLighting(material,THREE);let mesh;
   window.__draw=async(id,night=0,side=-1,old=false,tunnel=0)=>{if(mesh)scene.remove(mesh);const g=await __load(id),box=g.boundingBox;mesh=new THREE.Mesh(g,old?original:material);scene.add(mesh);const center=box.getCenter(new THREE.Vector3()),span=Math.max(8,box.max.x-box.min.x+1.4),aspect=innerWidth/innerHeight;camera.left=-span/2;camera.right=span/2;camera.top=span/aspect/2;camera.bottom=-camera.top;camera.position.set(center.x,side*20,center.z+.1);camera.lookAt(center);camera.updateProjectionMatrix();material.uniforms.trainBounds.value.set(box.min.x,box.max.x);material.uniforms.trainNight.value=night;material.uniforms.trainTunnel.value.setScalar(tunnel);renderer.setSize(innerWidth,innerHeight);renderer.render(scene,camera);
    const gl=renderer.getContext(),pixels=new Uint8Array(innerWidth*innerHeight*4);gl.readPixels(0,0,innerWidth,innerHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
   };
  });
  const coverage=await p.evaluate(()=>__coverage);check(engine+' 全模型側窗辨識',coverage.length===110&&coverage.every(r=>r.lit>0&&!r.bad),{meshes:coverage.length,missing:coverage.filter(r=>!r.lit||r.bad)});
  for(const id of ['700t','700t-mid','emu3000','c381','wenhu','airportlocal','ppcoach','danhai-section-0'])for(const side of [-1,1]){
   const detail=await p.evaluate(async([id,side])=>{
    const original=await __draw(id,0,side,true),day=await __draw(id,0,side),tunnel=await __draw(id,0,side,false,1),night=await __draw(id,1,side);let different=0,maxDayDelta=0,warm=0,tunnelLit=0;
    for(let i=0;i<day.length;i+=4){const delta=Math.max(...[0,1,2].map(c=>Math.abs(day[i+c]-original[i+c])));if(delta)different++;maxDayDelta=Math.max(maxDayDelta,delta);if(night[i]>225&&night[i+1]>170&&night[i]>night[i+2]+40&&night[i]>day[i]+80)warm++;if(tunnel[i]>210&&tunnel[i+1]>155&&tunnel[i]>day[i]+60)tunnelLit++;}
    return {dayPixelChanges:different,maxDayDelta,litWindowPixels:warm,tunnelLit};
   },[id,side]);
   // WebKit 更動 shader varying 後偶有單一像素差 1/255，容許色彩量化，禁止實際改色。
   check(engine+' '+id+' 側面 '+side,detail.maxDayDelta<=1&&detail.litWindowPixels>150,detail);
   if(side===-1)await p.screenshot({path:`${out}/${engine}-windows-${id}.png`});
   check(engine+' '+id+' 洞內 '+side,detail.tunnelLit>150,{tunnelLit:detail.tunnelLit});
  }
  check(engine+' 無執行錯誤',errors.length===0,errors);
 }catch(e){check(engine+' 執行',false,e.stack);}finally{await b.close();}
}
fs.writeFileSync(out+'/windows-browser.json',JSON.stringify(rows,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;

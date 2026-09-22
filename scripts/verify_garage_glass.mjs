// 量測正式 renderer 畫出的玻璃像素與反射增量；不以材質名稱或設定值取代實際光影。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT=process.env.GARAGE_GLASS_OUT||'.superpowers/garage-glass';mkdirSync(OUT,{recursive:true});
const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:900,height:500}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
  await p.route('**/__garage_glass',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><canvas style="width:900px;height:500px"></canvas>'}));
  await p.goto(new URL('/__garage_glass',BASE).href);
  const rows=await p.evaluate(async()=>{
   const T=await import('/rail-3d/vendor/three.module.js');let frame;
   const afterRender=T.Scene.prototype.onAfterRender;
   T.Scene.prototype.onAfterRender=function(renderer,scene,camera){afterRender.call(this,renderer,scene,camera);frame={renderer,scene,camera};};
   const {createRenderer}=await import('/rail-3d/garage-renderer.js'),r=createRenderer(),canvas=document.querySelector('canvas'),copy=document.createElement('canvas'),ctx=copy.getContext('2d',{willReadFrequently:true});
   const maskMaterial=new T.MeshBasicMaterial({color:0xff00ff,side:T.DoubleSide,toneMapped:false,fog:false});
   const pixels=()=>{const c=frame.renderer.domElement;if(copy.width!==c.width||copy.height!==c.height){copy.width=c.width;copy.height=c.height;}ctx.drawImage(c,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
   const redraw=()=>frame.renderer.render(frame.scene,frame.camera),rows=[];
   try{
    for(const id of ['emu3000','700t','c301','e200','danhai']){
     await r.load(id,'track');
     for(const period of ['sunrise','day','sunset','night'])for(const direction of [1,-1]){
      r.draw(canvas,{id,owned:true},-Math.PI/2,{mode:'track',period,direction,elevation:.16,distance:2.4});
      const baseline=pixels(),meshes=[];frame.scene.traverseVisible(o=>{if(o.isMesh&&Array.isArray(o.material)&&o.material.some(m=>m.name==='glass'))meshes.push(o);});
      const cars=[];
      for(const mesh of meshes){
       const original=mesh.material;mesh.material=original.map(m=>m.name==='glass'?maskMaterial:m);redraw();const mask=pixels(),indices=[];
       for(let i=0;i<mask.length;i+=4)if(mask[i]>250&&mask[i+1]<5&&mask[i+2]>250)indices.push(i);
       mesh.material=original;const glass=original.filter(m=>m.name==='glass'),gains=glass.map(m=>m.envMapIntensity);glass.forEach(m=>m.envMapIntensity=0);redraw();const unreflected=pixels();glass.forEach((m,i)=>m.envMapIntensity=gains[i]);
       let response=0,luminance=0;for(const i of indices){const l=d=>d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;response+=l(baseline)-l(unreflected);luminance+=l(baseline);}
       cars.push({pixels:indices.length,reflection:response/Math.max(1,indices.length),luminance:luminance/Math.max(1,indices.length)});
      }
      const positive=cars.every(c=>c.pixels>30&&c.reflection>(period==='night'?.5:5));
      rows.push({id,period,direction,cars,pass:cars.length===3&&positive});
     }
    }
    // 反覆換四時段、回近看再回海岸，GPU 貼圖數不得隨次數增加。
    await r.load('emu3000','track');const textures=[];
    for(let i=0;i<12;i++){const period=['sunrise','day','sunset','night'][i%4];r.draw(canvas,{id:'emu3000',owned:true},-Math.PI/2,{mode:'track',period,elevation:.16});textures.push(frame.renderer.info.memory.textures);}
    rows.push({id:'反射貼圖釋放',textures,pass:Math.max(...textures.slice(4))-Math.min(...textures.slice(4))<=1});
    await r.load('emu3000','model');r.draw(canvas,{id:'emu3000',owned:true},-.55,{mode:'model',elevation:.39});const studio=frame.scene.environment;
    await r.load('emu3000','track');r.draw(canvas,{id:'emu3000',owned:true},-Math.PI/2,{mode:'track',period:'day',elevation:.16});rows.push({id:'場景反射切換',pass:frame.scene.environment!==studio});
   }finally{r.dispose();maskMaterial.dispose();T.Scene.prototype.onAfterRender=afterRender;}
   return rows;
  });
  for(const row of rows){results.push({engine,...row});console.log(row.pass?'PASS':'FAIL',engine,JSON.stringify(row));}
  results.push({engine,id:'渲染錯誤',pass:errors.length===0,errors});
 }catch(e){results.push({engine,pass:false,error:e.stack});console.error(e);}finally{await browser.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({base:BASE,date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

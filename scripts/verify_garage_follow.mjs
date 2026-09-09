// 由真實畫出的列車色罩量測置中與可見性，並檢查移動鏡頭沒有改變旋轉角度。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT=process.env.GARAGE_FOLLOW_OUT||'.superpowers/garage-follow';mkdirSync(OUT,{recursive:true});
const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:900,height:600}}),errors=[];
  p.on('console',m=>{if(m.text().startsWith('完成跟車取樣'))console.log(engine,m.text());});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
  await p.route('**/__garage_follow',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><canvas></canvas>'}));
  await p.goto(new URL('/__garage_follow',BASE).href);
  const rows=await p.evaluate(async()=>{
   const T=await import('/rail-3d/vendor/three.module.js');let frame;
   const afterRender=T.Scene.prototype.onAfterRender;
   T.Scene.prototype.onAfterRender=function(renderer,scene,camera){afterRender.call(this,renderer,scene,camera);frame={renderer,scene,camera};};
   const {createRenderer}=await import('/rail-3d/garage-renderer.js'),r=createRenderer(),canvas=document.querySelector('canvas'),copy=document.createElement('canvas'),ctx=copy.getContext('2d',{willReadFrequently:true}),rows=[];
   const masks=[0xff00ff,0x00ff00,0x0000ff].map(color=>new T.MeshBasicMaterial({color,toneMapped:false}));
   function measure(){
    const cars=[];frame.scene.traverseVisible(o=>{if(o.isMesh&&Array.isArray(o.material)&&o.material.some(m=>m.name==='glass'))cars.push(o);});
    // 最大倍率可能裁到兩端；另量車身的完整投影，不能把裁切後色罩中心誤認為鏡頭焦點。
    let gx0=Infinity,gx1=-Infinity,gy0=Infinity,gy1=-Infinity;const point=new T.Vector3();
    for(const car of cars){const b=car.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){point.set(x,y,z).applyMatrix4(car.matrixWorld).project(frame.camera);gx0=Math.min(gx0,point.x);gx1=Math.max(gx1,point.x);gy0=Math.min(gy0,point.y);gy1=Math.max(gy1,point.y);}}
    const projectedOffset=Math.max(Math.abs(gx0+gx1),Math.abs(gy0+gy1))/4;
    const original=cars.map(c=>c.material);cars.forEach((c,i)=>c.material=masks[i]);frame.renderer.render(frame.scene,frame.camera);
    const c=frame.renderer.domElement;copy.width=c.width;copy.height=c.height;ctx.drawImage(c,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;
    let left=c.width,right=-1,top=c.height,bottom=-1;const counts=[0,0,0];
    for(let i=0;i<d.length;i+=4){const k=d[i]>250&&d[i+1]<5&&d[i+2]>250?0:d[i]<5&&d[i+1]>250&&d[i+2]<5?1:d[i]<5&&d[i+1]<5&&d[i+2]>250?2:-1;if(k<0)continue;counts[k]++;const x=i/4%c.width,y=Math.floor(i/4/c.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    cars.forEach((c,i)=>c.material=original[i]);
    return{counts,projectedOffset,dx:Math.abs((left+right+1)/2/c.width-.5),dy:Math.abs((top+bottom+1)/2/c.height-.5),position:frame.camera.position.toArray(),rotation:frame.camera.quaternion.toArray()};
   }
   const draw=(id,distance,zoom=2.4,yaw=-.9,elevation=.8,direction=1)=>r.draw(canvas,{id,owned:true},yaw,{mode:'loop',distance,zoom,elevation,direction});
   try{
    for(const id of ['emu3000','700t','c301','e200','danhai']){
     await r.load(id,'loop');
     for(const [width,height]of (id==='emu3000'?[[900,500],[360,270],[768,440]]:[[900,500]]))for(const direction of [1,-1]){
      canvas.style.cssText=`width:${width}px;height:${height}px`;draw(id,0);const length=+canvas.dataset.loopLength,samples=[];
      for(let i=0;i<=8;i++){draw(id,direction*(i/8*length-.1));samples.push(measure());}
      const first=samples[0],last=samples.at(-1),maxDx=Math.max(...samples.map(s=>s.dx)),maxDy=Math.max(...samples.map(s=>s.dy)),visible=samples.every(s=>s.counts.every(n=>n>10)&&s.projectedOffset<1e-8);
      const stable=samples.every(s=>s.rotation.every((v,i)=>Math.abs(v-first.rotation[i])<1e-10)),moved=Math.hypot(...samples[4].position.map((v,i)=>v-first.position[i]))>10,closed=Math.hypot(...last.position.map((v,i)=>v-first.position[i]))<1e-8;
      rows.push({id,width,direction,maxDx,maxDy,visible,stable,moved,closed,pass:maxDx<.045&&maxDy<.045&&visible&&stable&&moved&&closed});console.log('完成跟車取樣',id,width,direction);
     }
    }
    await r.load('emu3000','loop');canvas.style.cssText='width:900px;height:500px';
    for(const zoom of [1.2,3])for(const [yaw,elevation]of [[-.9,.8],[.7,.25],[-2.4,1.35]]){draw('emu3000',9,zoom,yaw,elevation);const m=measure();rows.push({id:'縮放與旋轉',zoom,yaw,elevation,...m,pass:m.projectedOffset<1e-8&&m.dx<.075&&m.dy<.075&&m.counts.every(n=>n>10)});}
    for(const zoom of [.7,1]){draw('emu3000',0,zoom);const a=frame.camera.position.clone();draw('emu3000',20,zoom);rows.push({id:'全景保持跑道中心',zoom,pass:a.distanceTo(frame.camera.position)<1e-10});}
    draw('emu3000',10,1);const before=frame.camera.position.clone();draw('emu3000',10,1.00001);rows.push({id:'縮放銜接沒有瞬間跳轉',pass:before.distanceTo(frame.camera.position)<1e-5});
    draw('emu3000',10,2);const a=measure();draw('emu3000',10,2,-.9,.8,-1);const z=measure();rows.push({id:'原地反向仍保持置中',pass:z.dx<.045&&z.dy<.045&&Math.hypot(...z.position.map((v,i)=>v-a.position[i]))<.1});
    draw('emu3000',5,2.4);
   }finally{r.dispose();masks.forEach(m=>m.dispose());T.Scene.prototype.onAfterRender=afterRender;}
   return rows;
  });
  for(const row of rows){results.push({engine,...row});console.log(row.pass?'PASS':'FAIL',engine,JSON.stringify(row));}
  results.push({engine,id:'渲染錯誤',pass:errors.length===0,errors});await p.screenshot({path:OUT+'/'+engine+'.png'});
 }catch(e){results.push({engine,pass:false,error:e.stack});console.error(e);}finally{await browser.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({base:BASE,date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.GARAGE_URL||'http://127.0.0.1:5291/',out='output/fleet-headlights';mkdirSync(out,{recursive:true});const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 const b=await type.launch();try{const p=await b.newPage();await p.route('**/__headlight',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await p.goto(new URL('/__headlight',base).href);
 const rows=await p.evaluate(async()=>{
 const T=await import('/rail-3d/vendor/three.module.js'),{loadGarageModel,createConsist}=await import('/rail-3d/garage-model.js'),r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(720,480);r.shadowMap.enabled=true;r.shadowMap.type=T.PCFSoftShadowMap;r.outputColorSpace=T.SRGBColorSpace;const cam=new T.OrthographicCamera(-15,15,10,-10,.1,150);cam.up.set(0,0,1);cam.position.set(16,-25,24);cam.lookAt(0,0,0);
 const s=new T.Scene();s.background=new T.Color('#080c15');s.add(new T.HemisphereLight('#e6ecff','#3b3933',.15));const g=new T.PlaneGeometry(70,70),m=new T.MeshStandardMaterial({color:'#6b7054',roughness:1}),maskM=new T.MeshBasicMaterial({color:0xff00ff,toneMapped:false}),floor=new T.Mesh(g,m);floor.position.z=-.01;floor.receiveShadow=true;s.add(floor);const c=document.createElement('canvas');c.width=720;c.height=480;const ctx=c.getContext('2d');const pixels=()=>{r.render(s,cam);ctx.drawImage(r.domElement,0,0);return ctx.getImageData(0,0,720,480).data;};const rows=[];
 try{for(const id of ['emu3000','dr1000','dl38','blue']){
 const a=await loadGarageModel(id),t=await createConsist(id,a,null,{locoAtTail:id==='dl38'});t.straight(-1);s.add(t.root);t.root.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});
 for(const direction of [1,-1]){t.lighting.update('night',direction);s.updateMatrixWorld(true);const spots=[];t.root.traverseVisible(o=>{if(o.isSpotLight)spots.push(o);});const expected=id==='blue'&&direction===-1?0:1;
 const lit=pixels();floor.material=maskM;const mask=pixels();floor.material=m;const strength=spots.map(l=>l.intensity);spots.forEach(l=>l.intensity=0);const dark=pixels();spots.forEach((l,i)=>l.intensity=strength[i]);let count=0,gain=0;for(let i=0;i<lit.length;i+=4)if(mask[i]>250&&mask[i+1]<5&&mask[i+2]>250){const d=lit[i]+lit[i+1]+lit[i+2]-dark[i]-dark[i+1]-dark[i+2];if(d>12){count++;gain+=d;}}
 if(id==='dl38'&&direction===1){t.cars.filter(c=>c.id!=='dl38').forEach(c=>c.car.visible=false);const clearLit=pixels();spots.forEach(l=>l.intensity=0);const clearDark=pixels();spots.forEach((l,i)=>l.intensity=strength[i]);let cleared=0;for(let i=0;i<clearLit.length;i+=4)if(mask[i]>250&&mask[i+1]<5&&mask[i+2]>250&&clearLit[i]+clearLit[i+1]+clearLit[i+2]-clearDark[i]-clearDark[i+1]-clearDark[i+2]>12)cleared++;t.cars.forEach(c=>c.car.visible=true);rows.push({id,occludedPixels:count,unobstructedPixels:cleared,pass:count===0&&cleared>20});}
 const facing=spots.every(l=>{const p=l.getWorldPosition(new T.Vector3()),q=l.target.getWorldPosition(new T.Vector3());return Math.sign(q.x-p.x)===direction;});rows.push({id,direction,beams:spots.length,groundPixels:count,gain,pass:spots.length===expected&&facing&&(expected===0||id==='dl38'&&direction===1?count===0:count>20)});
 }
 t.lighting.update('day',1);let active=0;t.root.traverseVisible(o=>{if(o.isSpotLight)active++;});rows.push({id,dayOff:active===0,pass:active===0});s.remove(t.root);t.dispose();a.dispose();
 }}finally{g.dispose();m.dispose();maskM.dispose();r.dispose();}return rows;
 });results.push(...rows.map(r=>({engine,...r})));console.log(engine,JSON.stringify(rows));}finally{await b.close();}
}
writeFileSync(out+'/verification.json',JSON.stringify(results,null,2));console.log(results.filter(r=>r.pass).length+'/'+results.length+' 通過');if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium} from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const out='output/fleet-refinement-20260912';mkdirSync(out,{recursive:true});
const b=await chromium.launch();const p=await b.newPage();await p.goto(process.env.GARAGE_VIADUCT_URL||'http://127.0.0.1:5251/prototypes/garage-viaduct/');await p.waitForFunction(()=>window.viaductPreview?.state.ready);
await p.evaluate(()=>viaductPreview.dispose());
for(const id of ['blue','bluecoach','dl38','alicoach','emu3000','dr1000']){
 const data=await p.evaluate(async id=>{
 const T=await import('/rail-3d/vendor/three.module.js'),{loadGarageModel}=await import('/rail-3d/garage-model.js'),a=await loadGarageModel(id);
 const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(600,300);r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;
 const s=new T.Scene();s.background=new T.Color('#deded7');const mesh=new T.Mesh(a.geometry,a.materials);mesh.position.copy(a.center).negate();s.add(mesh,new T.HemisphereLight('#ffffff','#999999',2));const l=new T.DirectionalLight('#ffffff',3);l.position.set(30,-30,50);s.add(l);s.updateMatrixWorld(true);
 const sheet=document.createElement('canvas');sheet.width=1800;sheet.height=660;const ctx=sheet.getContext('2d');ctx.fillStyle='#deded7';ctx.fillRect(0,0,1800,660);
 let thumbnail;const angles=[[1,0,.12],[-1,0,.12],[0,1,.15],[0,-1,.15],[1,1,.6],[-1,-1,.6]];
 for(let i=0;i<angles.length;i++){
 const c=new T.OrthographicCamera(-1,1,1,-1,.01,1000);c.up.set(0,0,1);c.position.set(...angles[i]).normalize().multiplyScalar(100);c.lookAt(0,0,0);c.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(mesh),v=new T.Vector3();let mx=0,my=0;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){v.set(x,y,z).applyMatrix4(c.matrixWorldInverse);mx=Math.max(mx,Math.abs(v.x));my=Math.max(my,Math.abs(v.y));}
 const span=Math.max(my,mx/2)*1.12;Object.assign(c,{left:-span*2,right:span*2,top:span,bottom:-span});c.updateProjectionMatrix();r.render(s,c);if(i===4)thumbnail=r.domElement.toDataURL('image/webp',.92).split(',')[1];
 const x=i%3*600,y=Math.floor(i/3)*330;ctx.drawImage(r.domElement,x,y);ctx.fillStyle='#202828';ctx.font='18px sans-serif';ctx.fillText(id+' / '+['front','rear','side A','side B','angle A','angle B'][i],x+10,y+320);
 }
 a.dispose();r.dispose();return {sheet:sheet.toDataURL().split(',')[1],thumbnail};
 },id);writeFileSync(`${out}/${id}.png`,Buffer.from(data.sheet,'base64'));writeFileSync(`${out}/${id}.webp`,Buffer.from(data.thumbnail,'base64'));console.log(id);
}
await b.close();

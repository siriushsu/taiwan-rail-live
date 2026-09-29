import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const GARAGE_SITE=process.env.GARAGE_BASE_URL||'http://127.0.0.1:5251'; // 預設同舊版；共用驗收腳本可指到自己起的空埠 server
const out='output/scene-shells';mkdirSync(out,{recursive:true});const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 try{for(const name of ['viaduct','shifen']){
  const page=await browser.newPage({viewport:{width:1200,height:850},reducedMotion:'reduce',hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${GARAGE_SITE}/prototypes/garage-${name}/`);await page.waitForFunction(n=>window[n+'Preview']?.state.ready,name);
  const facts=await page.evaluate(async name=>{
   const T=await import('/rail-3d/vendor/three.module.js'),S=await import(`/rail-3d/garage-scenes/${name}.js`),P=await import('/rail-3d/garage-scenes/props.js');
   const scene=S.createScene(),g=scene.group;g.updateMatrixWorld(true);const slab=g.getObjectByName('ground-slab');
   const box=new T.Box3().setFromObject(slab),z=box.max.z-.03,ray=new T.Raycaster();let rimHits=0;
   for(const [origin,direction] of [[[40,0,z],[-1,0,0]],[[-40,0,z],[1,0,0]],[[0,30,z],[0,-1,0]],[[0,-30,z],[0,1,0]]]){ray.set(new T.Vector3(...origin),new T.Vector3(...direction));if(ray.intersectObject(slab).length)rimHits++;}
   const placements=base=>{const list=[],geometries=[],materials=[];const p=P.createProps({geo:g=>(geometries.push(g),g),mat:(c,o)=>{const m=new T.MeshStandardMaterial({color:c,...o});materials.push(m);return m;},instance:(g,m,pos,scale)=>list.push({pos,scale}),rand:()=>.4});p.townhouse(0,0,base,{floors:3,ground:'plain',back:true});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());return list;};
   const a=placements(0),b=placements(-.7),translationError=Math.max(...a.map((p,i)=>Math.abs(b[i].pos[2]-p.pos[2]+.7)));
   let skirt=null;if(name==='shifen'){
    const o=g.getObjectByName('hills-skirt'),p=o.geometry.attributes.position,bounds=new T.Box3().setFromObject(o);let gaps=0,backFacing=0;
    for(let i=0;i<p.count;i+=2){const j=(i+2)%p.count,a=new T.Vector3().fromBufferAttribute(p,i),b=new T.Vector3().fromBufferAttribute(p,j),bottom=new T.Vector3().fromBufferAttribute(p,i+1),along=b.clone().sub(a),normal=new T.Vector3(-along.y,along.x,0).normalize(),mid=a.clone().add(b).add(bottom).multiplyScalar(1/3).add(o.position);if(along.x*along.x+along.y*along.y<1e-12)continue;ray.set(mid.clone().addScaledVector(normal,2),normal.clone().negate());if(!ray.intersectObject(o).length)backFacing++;if(bottom.z+o.position.z>box.max.z)gaps++;}
    skirt={gaps,backFacing,minY:bounds.min.y,maxY:bounds.max.y,minZ:bounds.min.z,ground:box.max.z,side:o.material.side};
   }
   scene.dispose();return{rimHits,thickness:box.max.z-box.min.z,translationError,skirt};
  },name);
  const pass=facts.rimHits===4&&facts.thickness>.079&&facts.translationError<1e-6&&(!facts.skirt||facts.skirt.gaps===0&&facts.skirt.backFacing===0);
  results.push({engine,name,pass,facts});console.log(engine,name,pass,JSON.stringify(facts));
  await page.locator('#scene').focus();
  for(let angle=0;angle<4;angle++){
   await page.screenshot({path:`${out}/${engine}-${name}-${angle}.png`});
   for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  }
  await page.setViewportSize({width:375,height:850});await page.tap('button[data-period="night"]');await page.locator('#scene').focus();for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${out}/${engine}-${name}-mobile-night-low.png`});
  results.push({engine,name,pass:errors.length===0,errors});await page.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='output/viaduct-roof-flicker';mkdirSync(out,{recursive:true});
const before=execFileSync('git',['show','9f0bf1ec:rail-3d/garage-scenes/viaduct.js'],{encoding:'utf8'}),results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();try{
 const page=await browser.newPage({viewport:{width:1000,height:850},reducedMotion:'reduce'});
 await page.route('**/viaduct.js?before-roof',route=>route.fulfill({contentType:'text/javascript',body:before}));
 await page.goto('http://127.0.0.1:5251/prototypes/garage-viaduct/');await page.waitForFunction(()=>window.viaductPreview?.state.ready);
 await page.click('[data-view="train"]');await page.click('#play');const start=await page.evaluate(()=>viaductPreview.state.distance);await page.waitForFunction(s=>viaductPreview.state.distance>s+.25,start);await page.click('#play');
 const report=await page.evaluate(async()=>{
  viaductPreview.dispose();
  const T=await import('/rail-3d/vendor/three.module.js'),fixed=await import('/rail-3d/garage-scenes/viaduct.js'),old=await import('/rail-3d/garage-scenes/viaduct.js?before-roof');
  const canvas=document.createElement('canvas'),renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),reports=[];
  for(const [version,module]of [['before',old],['after',fixed]]){
   const model=module.createScene(),s=new T.Scene();s.background=new T.Color('#e7e8e1');s.add(model.group,new T.HemisphereLight('#ffffff','#777777',2));const sun=new T.DirectionalLight('#ffffff',3);sun.position.set(30,-30,45);s.add(sun);
   for(const part of ['red','blue']){
    const target=new T.Vector3(...(part==='red'?[version==='before'?9.2:9.25,version==='before'?-9.05:-8.96,version==='before'?6.94:7.13]:[version==='before'?4.9:5,-14.4979744,2.66]));
    const cam=new T.OrthographicCamera(-.4,.4,.4,-.4,.1,200);cam.up.set(0,0,1);const samples=[];
    for(let i=0;i<48;i++){
     const yaw=-.8+i*.008;cam.position.copy(target).add(new T.Vector3(Math.cos(yaw)*70,Math.sin(yaw)*70,20));cam.lookAt(target);renderer.render(s,cam);ctx.drawImage(canvas,0,0);const data=ctx.getImageData(126,126,5,5).data;const rgb=[0,0,0];for(let j=0;j<data.length;j+=4)for(let k=0;k<3;k++)rgb[k]+=data[j+k]/25;samples.push(rgb);
    }
    const correct=samples.filter(([r,g,b])=>part==='red'?r>g+15:g>r+10&&b>r+10).length;
    const maxJump=Math.max(...samples.slice(1).map((rgb,i)=>Math.max(...rgb.map((v,k)=>Math.abs(v-samples[i][k])))));
    reports.push({version,part,correct,maxJump,samples});
   }
   model.dispose();
  }
  renderer.dispose();return reports;
 });
 const after=report.filter(r=>r.version==='after');const pass=after.every(r=>r.correct===48&&r.maxJump<10);
 results.push({engine,pass,report});console.log(engine,pass,JSON.stringify(report.map(({samples,...r})=>r)));
 }finally{await browser.close();}
}
writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import {writeFileSync} from 'node:fs';
const results=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.TEST_ENGINE&&process.env.TEST_ENGINE!==engine)continue;
 const browser=await type.launch();
 try{
  const page=await browser.newPage({viewport:{width:1000,height:800},reducedMotion:'reduce',hasTouch:true,isMobile:true});
  await page.goto('http://127.0.0.1:5251/prototypes/garage-south-coast/');
  await page.waitForFunction(()=>window.southCoastPreview?.state.ready);
  await page.tap('[data-view="train"]');
  for(const width of [1000,375]){
   if(process.env.TEST_WIDTH&&Number(process.env.TEST_WIDTH)!==width)continue;
   await page.setViewportSize({width,height:800});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const scan=await page.evaluate(async()=>{
    const api=southCoastPreview,canvas=document.querySelector('#scene'),out=document.createElement('canvas');
    api.render();out.width=canvas.width;out.height=canvas.height;const ctx=out.getContext('2d');
    const read=async()=>{const im=new Image();im.src=canvas.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,out.width,out.height).data;};
    const diff=(a,b,i)=>Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
    const rows=[];
    for(let j=0;j<32;j++){
     api.setDistance(j/32*api.state.pathLength);
     api.sceneVisible(false);api.trainVisible(false);const blank=await read();
     api.trainVisible(true);const solo=await read();
     api.sceneVisible(true);const full=await read();
     api.trainVisible(false);const scenery=await read();api.trainVisible(true);
     const s=api.state,cars=s.bounds.map(b=>{let total=0,visible=0;for(let y=Math.max(0,Math.floor(b.top));y<Math.min(out.height,b.bottom);y++)for(let x=Math.max(0,Math.floor(b.left));x<Math.min(out.width,b.right);x++){const i=(y*out.width+x)*4;if(diff(solo,blank,i)>40){total++;if(diff(full,scenery,i)>20)visible++;}}return{ratio:visible/total,pixels:total,inFrame:b.left>0&&b.right<out.width&&b.top>0&&b.bottom<out.height};});
     const heading=Math.atan2(s.poses.reduce((n,c)=>n+Math.sin(c.heading),0),s.poses.reduce((n,c)=>n+Math.cos(c.heading),0));
     rows.push({distance:s.distance,cars,headingError:Math.abs(Math.atan2(Math.sin(s.cameraYaw-heading+Math.PI/2),Math.cos(s.cameraYaw-heading+Math.PI/2)))});
    }
    api.setDistance(api.state.pathLength*.5);return rows;
   });
   const pass=scan.every(r=>r.headingError<1e-6&&r.cars.every(c=>c.ratio>.9&&c.inFrame&&c.pixels>100));
   results.push({engine,width,pass,minVisibility:Math.min(...scan.flatMap(r=>r.cars.map(c=>c.ratio))),scan});
   console.log(engine,width,pass,results.at(-1).minVisibility);
   await page.screenshot({path:`output/south-coast/${engine}-follow-back-${width}.png`});
  }
 }finally{await browser.close();}
}
writeFileSync(`output/south-coast/follow-camera${process.env.TEST_ENGINE?'-'+process.env.TEST_ENGINE+'-'+(process.env.TEST_WIDTH||'all'):''}.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

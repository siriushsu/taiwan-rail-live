// 真正執行 GLSL 淡入淡出，讀 GL 像素；固定透明度相位使慢速雲端也能驗動畫中間態。
const {chromium,webkit}=await import(process.env.GLASS_TEST_PLAYWRIGHT||'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'output/glass-transition');fs.mkdirSync(out,{recursive:true});
const mutate=process.env.GLASS_MUTATE==='opaque';
const code=fs.readFileSync(path.join(root,'night-map.js'),'utf8');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname.startsWith('/api/'))return res.writeHead(503,{'content-type':'application/json'}).end('{}');
  // 反向對照：關掉 shader 的插值，起點透明／中間像素判準必須紅。
  if(mutate&&u.pathname==='/night-map.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(code.replace('mix(transition.x,transition.y,smoothstep(0.0,1.0,progress))','1.0'));
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`,results=[];
let browser;
async function sample(page,phase){return page.evaluate(phase=>new Promise(resolve=>{
  const m=M.raw,g=m.getLayer('building-glass-edges').implementation,original=g.render;
  g.fadeStart=performance.now()-g.fadeDuration*phase;
  g.render=function(gl,args){
    const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);original.call(this,gl,args);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);
    let energy=0,changed=0;for(let i=0;i<a.length;i+=4){const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);energy+=delta;if(delta>12)changed++;}
    g.render=original;resolve({phase,energy,changed,buildings:g.buildings,vertices:g.count});
  };m.triggerRepaint();
}),phase);}
try {
  for(const [name,engine] of Object.entries({chromium,webkit})){
    browser=await engine.launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,locale:'zh-TW',timezoneId:'Asia/Taipei'});
      await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'?metrocore=off&lang=zh-TW');
      await page.waitForFunction(()=>window.__state?.ready&&state.trains.length&&M.raw,null,{timeout:60000});
      await page.evaluate(()=>{state.playing=false;clearFollow();clearFreqFollow();setMap3d(true);document.body.classList.add('fs');M.raw.resize();M.raw.jumpTo({center:[121.5164,25.041],zoom:15.7,pitch:0,bearing:0});});
      await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:90000});
      await page.waitForFunction(()=>M.raw.getLayer('building-glass-edges')?.implementation?.buildings>0,null,{timeout:30000});
      const stats=await page.evaluate(()=>{
        const m=M.raw,g=m.getLayer('building-glass-edges').implementation,canvas=m.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;
        clearTimeout(g.timer);g.timer=null;m.off('sourcedata',g.schedule);m.off('moveend',g.schedule);
        g.selection.clear();g.targets=[];g.count=0;g.fadeDuration=100000;g.rebuild();
        const cell=b=>{const p=m.project([(b.bounds[0]+b.bounds[2])/2,(b.bounds[1]+b.bounds[3])/2]);if(p.x<0||p.x>w||p.y<0||p.y>h)return null;return Math.min(7,Math.floor(p.x/w*8))+8*Math.min(5,Math.floor(p.y/h*6));};
        const available=new Set([...g.tiles.values()].flat().map(cell).filter(x=>x!==null));
        const selected=new Set(g.targets.map(cell).filter(x=>x!==null));
        const gl=m.painter.context.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
        return {available:available.size,selected:selected.size,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
      });
      assert.equal(stats.selected,stats.available,'縮小時每個有建物的畫面區域都分到額度');
      const phases=[];for(const phase of [0,.25,.5,1])phases.push(await sample(page,phase));
      assert(phases[0].energy<phases[3].energy*.02,'淡入起點必須接近完全透明');
      assert(phases[1].energy>phases[0].energy&&phases[2].energy>phases[1].energy&&phases[3].energy>phases[2].energy,'實際線條像素逐步變亮');
      assert(phases[3].changed>100,'必須真的渲染出線條，不能全透明假通過');
      for(const p of phases)assert(p.buildings<=(mobile?700:1600)&&p.vertices<=160000,'動畫的每個相位都不得超額');
      await page.screenshot({path:path.join(out,`${name}-${mobile?'mobile':'desktop'}-after.png`)});
      await page.evaluate(()=>{
        const m=M.raw,g=m.getLayer('building-glass-edges').implementation;g.fadeDuration=360;g.frames=[];
        const original=g.render;g.render=function(gl,args){original.call(this,gl,args);this.frames.push({buildings:this.buildings,vertices:this.count,fading:this.fading});};
        m.jumpTo({center:[121.5224,25.045],zoom:15.7,pitch:60,bearing:135});g.rebuild();
      });
      await page.waitForFunction(()=>!M.raw.getLayer('building-glass-edges').implementation.fading,null,{timeout:30000});
      const frames=await page.evaluate(()=>M.raw.getLayer('building-glass-edges').implementation.frames);
      assert(frames.some(f=>f.fading)&&frames.some(f=>!f.fading),'真正移動鏡頭後，動畫有開始也有結束');
      assert(frames.every(f=>f.buildings<=(mobile?700:1600)&&f.vertices<=160000),'移動鏡頭的每一幀仍守住額度');
      assert.equal(errors.length,0,'不可有瀏覽器未處理例外');
      const row={engine:name,mobile,...stats,phases,transitionFrames:frames.length,errors};results.push(row);console.log('PASS',JSON.stringify(row));
      await context.close();
    }
    await browser.close();browser=null;
  }
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,mutate?'browser-opaque-control.json':'browser-results.json'),JSON.stringify(results,null,2));}

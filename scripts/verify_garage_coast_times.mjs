import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-coast';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail||'');};
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{for(const [hour,period]of [[6,'sunrise'],[12,'day'],[18,'sunset'],[23,'night']]){
  const ctx=await b.newContext({viewport:{width:1280,height:940},timezoneId:'America/New_York'});
  await ctx.addInitScript(hour=>{const RealDate=Date,at=RealDate.UTC(2026,8,8,hour-8);window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};localStorage.setItem('trainmap-howto-seen','1');},hour);
  await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});await p.goto(BASE+'?garage=demo&lang=zh-TW');await p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered);
  await p.click('[data-view="track"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='track');await p.click('.g-auto');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(engine+' '+period+' 依台灣開啟時間選擇天空，不受裝置時區影響',await p.locator('.g-view').getAttribute('data-period')===period);
  const pixels=await p.locator('.g-view').evaluate(c=>{const g=c.getContext('2d'),sample=(x,y)=>[...g.getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data];return {sky:sample(.5,.02),sea:sample(.4,.45),land:sample(.5,.96)};});
  check(engine+' '+period+' 天空海面與近景都有畫出',pixels.sky[3]===255&&pixels.sea[3]===255&&pixels.land[3]===255&&pixels.land[1]>pixels.land[0]&&pixels.land[1]>pixels.land[2]&&JSON.stringify(pixels.sky)!==JSON.stringify(pixels.sea),JSON.stringify(pixels));
  await p.locator('.g-view').screenshot({path:OUT+'/'+engine+'-'+period+'.png'});
  await p.screenshot({path:OUT+'/'+engine+'-'+period+'-page.png'});
  check(engine+' '+period+' 無 JS 例外',!errors.length,errors.join('|'));await ctx.close();
 }}catch(e){check(engine+' coast',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

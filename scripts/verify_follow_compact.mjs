import {chromium,webkit} from 'playwright';import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/',results=[];fs.mkdirSync('output/follow-compact',{recursive:true});
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch();
 for(const width of [360,375,390,414,520,768,1280]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<1000,hasTouch:true,locale:'zh-TW'}),page=await context.newPage(),errors=[];
  await context.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base+'?g=all&scene=3d&train=117&t=12:00&z=17&lang=zh-TW');await page.waitForFunction(()=>state.ready&&state.followTrain&&window.railIslandIntegration?.renderer?.stats.models>0,null,{timeout:60000});await page.evaluate(()=>state.playing=false);
   await page.locator('#fpClose').tap();await page.waitForFunction(()=>document.querySelector('#followPanel').classList.contains('fp-min'));
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>state._setAppearance(theme),theme);await page.waitForFunction(()=>!window.railIslandIntegration?.loading&&window.railIslandIntegration?.renderer?.stats.models>0);await page.waitForTimeout(350);
    const row=await page.evaluate(()=>{const p=document.querySelector('#followPanel'),r=p.getBoundingClientRect(),button=p.querySelector('#fpEnd'),e=button.getBoundingClientRect(),style=getComputedStyle(p);const targets=[...document.querySelectorAll('button,input,select,[role=button]')].filter(el=>!p.contains(el)&&el.getBoundingClientRect().width&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');const overlap=targets.filter(el=>{const q=el.getBoundingClientRect(),x=Math.max(q.x,r.x),y=Math.max(q.y,r.y),w=Math.min(q.right,r.right)-x,h=Math.min(q.bottom,r.bottom)-y;if(w<1||h<1)return false;const hit=document.elementFromPoint(x+w/2,y+h/2);return el.contains(hit)||p.contains(hit);}).map(e=>e.id||e.className);return {height:r.height,width:r.width,hit:button.contains(document.elementFromPoint(e.x+e.width/2,e.y+e.height/2)),touch:e.width>=44&&e.height>=44,overflow:document.documentElement.scrollWidth>innerWidth+1,caption:getComputedStyle(p.querySelector('.ri-formation-caption')).display,overlap,top:style.borderTopWidth,radius:style.borderRadius,full:document.body.classList.contains('fs')};});
    results.push({engine:name,width,theme,pass:row.hit&&row.touch&&!row.overflow&&row.caption==='none'&&row.height<=70&&!row.overlap.length&&(theme!=='dark'||row.top==='3px'&&row.radius==='14px'),...row});
    if(width===375)await page.screenshot({path:`output/follow-compact/${name}-${theme}.png`});
   }
   await page.locator('#fpEnd').tap();results.push({engine:name,width,type:'真觸控結束跟隨',pass:await page.evaluate(()=>!state.followTrain)});
   results.push({engine:name,width,type:'無未處理錯誤',pass:!errors.length,errors});
  }catch(e){results.push({engine:name,width,pass:false,error:e.stack});}finally{await context.close();}
 }
 await browser.close();
}
fs.writeFileSync('output/follow-compact/results.json',JSON.stringify(results,null,2));for(const r of results)console.log(r.pass?'PASS':'FAIL',JSON.stringify(r));if(results.some(r=>!r.pass))process.exitCode=1;

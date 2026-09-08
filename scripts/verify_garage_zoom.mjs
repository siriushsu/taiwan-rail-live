import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-zoom';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snap=p=>p.locator('.g-view').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0,count=0;for(let i=0;i<d.length;i+=4)if(d[i+3]){count++;hash=(hash*31+d[i]*3+d[i+1]*5+d[i+2]*7)>>>0;}const b=JSON.parse(c.dataset.formation||'[]');return{...c.dataset,hash,count,carWidth:b[0]?b[0].right-b[0].left:0,scroll:document.getElementById('trainGarage').scrollTop};});
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  for(const mobile of [false,true]){
   const c=await b.newContext({viewport:mobile?{width:375,height:812}:{width:1280,height:940},isMobile:mobile,hasTouch:mobile}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
   await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
   await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
   await p.goto(BASE+'?garage=demo&lang=zh-TW');await p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered);
   const press=async sel=>{await p.locator(sel).scrollIntoViewIfNeeded();if(mobile)await p.tap(sel);else await p.click(sel);await settle(p);};
   for(const mode of ['model','loop','track']){
    await press('[data-view="'+mode+'"]');await p.waitForFunction(m=>document.querySelector('.g-view').dataset.mode===m&&document.querySelector('.g-fallback').hidden,mode);if(await p.locator('.g-auto').getAttribute('aria-pressed')==='true')await press('.g-auto');
    const name=engine+' '+(mobile?'觸控':'桌面')+' '+mode,base=await snap(p);await press('.g-zoom-in');const big=await snap(p);
    check(name+' 放大按鈕實際改變畫面與車身尺寸',+big.zoom===1.2&&big.hash!==base.hash&&(mode==='model'?big.count>base.count*1.1:Math.abs(big.carWidth/base.carWidth-1.2)<.001));
    check(name+' 縮放不改變旋轉或行駛位置',big.yaw===base.yaw&&big.elevation===base.elevation&&big.distance===base.distance);
    await press('.g-zoom-out');check(name+' 縮小回原始比例',+(await snap(p)).zoom===1);await press('.g-zoom-in');await press('.g-reset-view');check(name+' 重設還原 100%',+(await snap(p)).zoom===1&&await p.locator('.g-zoom-level').textContent()==='100%');
    for(let i=0;i<10&&await p.locator('.g-zoom-in').isEnabled();i++)await press('.g-zoom-in');check(name+' 放大上限停在 300%',+(await snap(p)).zoom===3&&await p.locator('.g-zoom-in').isDisabled());
    for(let i=0;i<14&&await p.locator('.g-zoom-out').isEnabled();i++)await press('.g-zoom-out');check(name+' 縮小下限停在 70%',+(await snap(p)).zoom===.7&&await p.locator('.g-zoom-out').isDisabled());await press('.g-reset-view');
    if(!mobile){await p.locator('.g-view').scrollIntoViewIfNeeded();const r=await p.locator('.g-view').boundingBox();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.5);const old=await snap(p);await p.mouse.wheel(0,-120);await p.waitForTimeout(180);const wheel=await snap(p);check(name+' 滾輪縮放且頁面不跟著捲動',+wheel.zoom>+old.zoom&&wheel.hash!==old.hash&&wheel.scroll===old.scroll);await p.locator('.g-view').focus();await p.keyboard.press('0');await p.keyboard.press('+');await settle(p);check(name+' 鍵盤也能放大',Math.abs(+(await snap(p)).zoom-1.2)<1e-8);await press('.g-reset-view');}
    if(engine==='chromium'&&mobile){
     await p.locator('.g-view').scrollIntoViewIfNeeded();const r=await p.locator('.g-view').boundingBox(),x=r.x+r.width*.43,y=r.y+r.height*.5,client=await c.newCDPSession(p),old=await snap(p);
     await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x-25,y},{id:2,x:x+25,y}]});
     for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-25-i*4,y},{id:2,x:x+25+i*4,y}]});
     await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);const pinched=await snap(p);
     check(name+' 真雙指張開放大且不誤旋轉或捲頁',+pinched.zoom>1.7&&pinched.hash!==old.hash&&pinched.yaw===old.yaw&&pinched.elevation===old.elevation&&pinched.scroll===old.scroll,{zoom:pinched.zoom,yaw:pinched.yaw,scroll:pinched.scroll});
     await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x-48,y},{id:2,x:x+48,y}]});for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-48+i*4,y},{id:2,x:x+48-i*4,y}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);check(name+' 真雙指合攏縮小',+(await snap(p)).zoom<+pinched.zoom*.7);
     const beforeDrag=await snap(p);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+10,y:y-10}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(p);const afterDrag=await snap(p);check(name+' 雙指結束後單指仍可旋轉',afterDrag.yaw!==beforeDrag.yaw&&afterDrag.zoom===beforeDrag.zoom);await client.detach();await press('.g-reset-view');
    }
    const hits=await p.locator('.g-zoom button').evaluateAll(els=>els.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));check(name+' 縮放按鈕至少 44px 且不被畫布遮住',hits);
   }
   await press('[data-view="loop"]');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='loop');if(await p.locator('.g-auto').getAttribute('aria-pressed')==='true')await press('.g-auto');await press('.g-zoom-in');await p.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);await p.screenshot({path:OUT+'/'+engine+(mobile?'-mobile':'-desktop')+'.png'});
   check(engine+' '+mobile+' 無 JS 或 WebGL 錯誤',!errors.length,errors);await c.close();
  }
 }catch(e){check(engine+' zoom suite',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const results=[],BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/';
const check=(name,pass)=>{results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);};
for(const [name,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const p=await b.newPage({viewport:{width:1280,height:900},locale:'zh-TW'});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');window.__gl=[];const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const c=get.call(this,type,...args);if(c&&type.startsWith('webgl')&&!__gl.includes(c))__gl.push(c);return c;};});
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
  await p.goto(BASE+'?garage=1&lang=zh-TW');const ready=()=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
  await ready();
  // 與使用者相同的 pointerdown/move/up，驗證左右拖曳會改變像素。
  const hash=()=>p.locator('.g-view').evaluate(c=>c.toDataURL());const before=await hash(),box=await p.locator('.g-view').boundingBox();
  await p.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await p.mouse.down();await p.mouse.move(box.x+box.width*.65,box.y+box.height*.5,{steps:8});await p.mouse.up();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(name+' 拖曳確實旋轉車模',await hash()!==before);
  // 在下載尚未完成時丟失 WebGL context，舊 Promise 不可把錯誤提示再藏掉。
  let release,notify;const requested=new Promise(r=>notify=r);
  await p.route('**/garage-blender-v1/ck124.bin.gz',async route=>{await new Promise(r=>{release=r;notify();});await route.continue().catch(()=>{});});
  await p.locator('.g-car[data-model="ck124"]').evaluate(e=>e.click());await requested;
  await p.evaluate(()=>__gl.filter(g=>!g.canvas.isConnected).at(-1).getExtension('WEBGL_lose_context').loseContext());
  await p.waitForSelector('.g-retry:visible');release();await p.waitForTimeout(150);
  check(name+' 下載中 context loss 保留重試與進度',await p.locator('.g-retry').isVisible()&&await p.locator('.g-count').textContent()==='0');
  await p.unroute('**/garage-blender-v1/ck124.bin.gz');await p.click('.g-retry');await ready();
  check(name+' context loss 後可建立新展示台',await p.locator('.g-view').getAttribute('data-rendered')==='ck124');
  // 護照型里程碑的入口是真的可使用的旅程護照。
  await p.locator('.g-car[data-model="c301"]').evaluate(e=>e.click());await p.click('.g-cta');
  check(name+' 里程碑按鈕開啟旅程護照',await p.evaluate(()=>!TrainGarage.isOpen&&!document.getElementById('ridePanel').hidden));
  // 從捷運分頁啟動台鐵、高鐵、林鐵收集，必須切到對應系統，不能跟上同號別系統列車。
  for(const [id,sys]of [['emu500','tra_sched'],['700t','thsr_sched'],['dl38','afr_sched']]){
   await p.evaluate(()=>{loadSystem(state.systems.find(s=>s.id==='mrt'));openTrainGarage();});
   await p.locator('.g-car[data-model="'+id+'"]').evaluate(e=>e.click());await p.click('.g-cta');
   await p.waitForFunction(()=>!TrainGarage.isOpen);
   check(name+' '+id+' 從捷運頁開始收集',await p.evaluate(sys=>state.mode==='sched'&&state.followTrain?.sys===sys,sys));
  }
  check(name+' 進入跟車不預先送收藏',await p.evaluate(()=>loadRides().length===0));
  check(name+' 無例外',errors.length===0);
  for(const mode of ['missing','broken']){
   const old=await b.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true,locale:'zh-TW'});
   const oldErrors=[];old.on('pageerror',e=>oldErrors.push(e.message));
   await old.addInitScript(mode=>{
    window.DecompressionStream=mode==='missing'?undefined:class{constructor(){throw Error('old engine');}};
    HTMLDialogElement.prototype.showModal=undefined;HTMLDialogElement.prototype.close=undefined;
    localStorage.setItem('trainmap-howto-seen','1');
   },mode);
   await old.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
   await old.goto(BASE+'?garage=1&lang=zh-TW');await old.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered);
   check(name+' '+mode+' 解壓與 dialog 相容路徑',await old.evaluate(()=>document.querySelector('#trainGarage').classList.contains('g-legacy')&&document.querySelector('.g-view').dataset.appearance==='blender-original'));
   await old.keyboard.press('Shift+Tab');
   check(name+' '+mode+' 焦點不離開車庫',await old.evaluate(()=>document.getElementById('trainGarage').contains(document.activeElement)));
   await old.locator('.g-close').scrollIntoViewIfNeeded();await old.tap('.g-close');
   check(name+' '+mode+' 關閉恢復地圖與可及性',await old.evaluate(()=>!TrainGarage.isOpen&&document.getElementById('map').getAttribute('aria-hidden')!=='true'&&document.body.style.overflow===''));
   check(name+' '+mode+' 無例外',oldErrors.length===0);await old.close();
  }

 }catch(e){console.log(e.stack);check(name+' lifecycle',false);}finally{await b.close();}
}
mkdirSync('.superpowers/garage-blender-lifecycle',{recursive:true});writeFileSync('.superpowers/garage-blender-lifecycle/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));
if(results.some(r=>!r.pass))process.exitCode=1;

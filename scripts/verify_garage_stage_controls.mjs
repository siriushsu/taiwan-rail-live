// 車庫舞台：旋轉、視角高低沒有按鈕之後只剩拖曳——滑鼠左鍵、右鍵、觸控、滾輪、畫布方向鍵都要能轉；
// 時段選擇（天色）只在有天色的海岸行旅與場景出現，選了舞台與提示列跟著換、記在這台裝置、全畫面也能選。
// 用法：GARAGE_URL=http://127.0.0.1:5297/ node scripts/verify_garage_stage_controls.mjs（Chrome 無視窗；截圖在 .superpowers/garage-stage-controls）
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-stage-controls';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const ready=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
const view=p=>p.locator('.g-view').evaluate(c=>({yaw:+c.dataset.yaw,elevation:+c.dataset.elevation,zoom:+c.dataset.zoom,mode:c.dataset.mode,period:c.dataset.period}));
const hint=p=>p.locator('.g-view-hint').textContent();
const near=(a,b,eps=.02)=>Math.abs(a-b)<eps;
// 台灣時間的時段，跟 train-garage.js 的 scenePeriod 同一組界線。
const taipeiPeriod=()=>{const now=new Date(),h=(now.getUTCHours()+8)%24+now.getUTCMinutes()/60;return h>=5&&h<7?'sunrise':h>=7&&h<17?'day':h>=17&&h<19?'sunset':'night';};
async function boot(b,width=1280,height=940,lang='zh-TW'){
 const touch=width<1000,c=await b.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,locale:lang}),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
 await p.goto(BASE+'?garage=demo&lang='+lang);await ready(p);return{c,p,errors};
}
const show=async(p,id,tap=false)=>{const tab=p.locator(`[data-view="${id}"]`);await(tap?tab.tap():tab.click());await p.waitForFunction(id=>document.querySelector('.g-view').dataset.mode===id,id,{timeout:30000});await settle(p);};
const center=async p=>{const canvas=p.locator('.g-view');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2};};
const mouseDrag=async(p,dx,dy,button='left')=>{const {x,y}=await center(p);await p.mouse.move(x,y);await p.mouse.down({button});await p.mouse.move(x+dx,y+dy,{steps:8});await p.mouse.up({button});await settle(p);};
// 觸控拖曳走 Chrome 的觸控輸入（touchstart → pointer 事件），跟手指一樣會碰到頁面捲動。
const touchDrag=async(p,dx,dy)=>{const {x,y}=await center(p),s=await p.context().newCDPSession(p);
 await s.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++)await s.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});
 await s.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await s.detach();await settle(p);};
const pick=async(p,value)=>{await p.selectOption('.g-period-select',value);await settle(p);};
const hits=p=>p.locator('.g-period').evaluate(el=>{const r=el.getBoundingClientRect();return{height:r.height,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),overflow:document.documentElement.scrollWidth>innerWidth||document.getElementById('trainGarage').scrollWidth>document.getElementById('trainGarage').clientWidth};});

const b=await chromium.launch({channel:'chrome',headless:true});
try{
 {const {c,p,errors}=await boot(b);
  check('四顆旋轉／視角鈕拿掉了，自轉與重設還在',await p.locator('.g-left,.g-right,.g-up,.g-down').count()===0&&await p.locator('.g-auto').isVisible()&&await p.locator('.g-reset-view').isVisible());
  check('畫布標出方向鍵',await p.locator('.g-view').getAttribute('aria-keyshortcuts')==='ArrowLeft ArrowRight ArrowUp ArrowDown');
  check('近看小車沒有天色選單',await p.locator('.g-period').isHidden());
  let s=await view(p);await mouseDrag(p,60,0);let t=await view(p);check('滑鼠左鍵橫拖轉水平',near(t.yaw-s.yaw,.72)&&near(t.elevation,s.elevation,1e-6),{s,t});
  s=t;await mouseDrag(p,0,-40);t=await view(p);check('滑鼠左鍵直拖改仰角',near(t.elevation-s.elevation,.32)&&near(t.yaw,s.yaw,1e-6),{s,t});
  s=t;await mouseDrag(p,-60,0,'right');t=await view(p);check('滑鼠右鍵橫拖也能轉',near(t.yaw-s.yaw,-.72),{s,t});
  s=t;await mouseDrag(p,0,40,'right');t=await view(p);check('滑鼠右鍵直拖也能改仰角',near(t.elevation-s.elevation,-.32),{s,t});
  check('畫布上的右鍵選單被擋掉',await p.locator('.g-view').evaluate(c=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});c.dispatchEvent(e);return e.defaultPrevented;}));
  s=t;await mouseDrag(p,60,0,'middle');t=await view(p);check('中鍵拖不轉',t.yaw===s.yaw,{s,t});
  s=t;const {x,y}=await center(p);await p.mouse.move(x,y);await p.mouse.wheel(0,-240);await settle(p);t=await view(p);check('滾輪縮放',t.zoom>s.zoom+.2,{s,t});
  await p.click('.g-reset-view');await settle(p);s=await view(p);await p.locator('.g-view').focus();await p.keyboard.press('ArrowLeft');await p.keyboard.press('ArrowUp');await settle(p);t=await view(p);
  check('畫布方向鍵轉水平與仰角',near(t.yaw-s.yaw,-.15,1e-6)&&near(t.elevation-s.elevation,.12,1e-6),{s,t});
  await show(p,'loop');check('環形試跑沒有天色選單',await p.locator('.g-period').isHidden());

  await show(p,'track');
  check('海岸行旅出現天色選單、預設自動照台灣時間',await p.locator('.g-period').isVisible()&&await p.inputValue('.g-period-select')==='auto'&&(await view(p)).period===taipeiPeriod(),await view(p));
  check('天色選單的字',await p.locator('.g-period > span').textContent()==='天色'&&JSON.stringify(await p.locator('.g-period-select option').allTextContents())===JSON.stringify(['自動','日出','藍天','黃昏','星空']));
  await pick(p,'night');check('海岸行旅選星空：舞台畫星空、提示列跟著換、記在這台裝置',(await view(p)).period==='night'&&(await hint(p)).endsWith(' · 星空')&&await p.evaluate(()=>localStorage.getItem('trainmap-garage-period-v1'))==='night',{hint:await hint(p)});
  await p.screenshot({path:OUT+'/desktop-track-night.png'});
  await show(p,'scene');await p.waitForFunction(()=>document.querySelector('.g-view').dataset.scene&&document.querySelector('.g-view').dataset.mode==='scene',null,{timeout:60000});await settle(p);
  check('場景沿用星空、提示列帶地名與時段',(await view(p)).period==='night'&&(await hint(p)).endsWith(' · 星空')&&await p.locator('.g-period').isVisible(),{period:(await view(p)).period,hint:await hint(p)});
  // 場景只有藍天、黃昏、星空三套主題，日出畫黃昏那套（garage-diorama.js 的 themeOf）；dataset.period 是實際畫的主題，提示列寫選的時段。
  await pick(p,'sunrise');check('場景選日出（畫黃昏那套）',await p.inputValue('.g-period-select')==='sunrise'&&(await view(p)).period==='sunset'&&(await hint(p)).endsWith(' · 日出'),{period:(await view(p)).period,hint:await hint(p)});
  s=await view(p);await mouseDrag(p,50,0);t=await view(p);check('場景滑鼠拖曳轉水平',near(t.yaw-s.yaw,.6),{s,t});
  await p.screenshot({path:OUT+'/desktop-scene-sunrise.png'});

  await p.click('.g-fs');await p.waitForFunction(()=>document.getElementById('trainGarage').classList.contains('g-full'));await settle(p);
  check('全畫面也有天色選單',await p.locator('.g-period').isVisible());
  await pick(p,'auto');check('全畫面選回自動照台灣時間',(await view(p)).period===taipeiPeriod()&&await p.evaluate(()=>localStorage.getItem('trainmap-garage-period-v1'))==='auto');
  s=await view(p);await mouseDrag(p,0,-40);t=await view(p);check('全畫面直拖改仰角',t.elevation>s.elevation+.2,{s,t});
  await pick(p,'sunset');await p.screenshot({path:OUT+'/desktop-fullscreen-sunset.png'});
  await p.click('.g-fs');await p.waitForFunction(()=>!document.getElementById('trainGarage').classList.contains('g-full'));
  // 進車庫後網址的 ?garage= 會被拿掉，重開要重新帶參數進來。
  await p.goto(BASE+'?garage=demo&lang=zh-TW');await ready(p);await show(p,'track');
  check('重開記得上次選的黃昏',await p.inputValue('.g-period-select')==='sunset'&&(await view(p)).period==='sunset'&&(await hint(p)).endsWith(' · 黃昏'));
  for(const [lang,label,options]of [['en','Sky',['Auto','Sunrise','Blue skies','Dusk','Starry night']],['ja','時間帯',['自動','日の出','青空','夕暮れ','星空']]]){
   await p.evaluate(l=>setLanguage(l),lang);await settle(p);
   check(lang+' 天色選單翻譯',await p.locator('.g-period > span').textContent()===label&&JSON.stringify(await p.locator('.g-period-select option').allTextContents())===JSON.stringify(options),{label:await p.locator('.g-period > span').textContent(),options:await p.locator('.g-period-select option').allTextContents()});
  }
  await p.evaluate(()=>setLanguage('zh-TW'));await pick(p,'auto');
  check('桌機無 JS 例外',!errors.length,errors);await c.close();}

 for(const width of [360,375,414,768]){
  const height=width===360?640:width===375?667:width===414?736:1024,{c,p,errors}=await boot(b,width,height);
  await show(p,'track',true);await p.evaluate(()=>{const g=document.getElementById('trainGarage');g.scrollTop=0;});await settle(p);
  const top=await p.evaluate(()=>document.getElementById('trainGarage').scrollTop);
  let s=await view(p);await touchDrag(p,60,0);let t=await view(p);check(width+' 觸控橫拖轉水平（海岸夾在 ±0.2）',t.yaw>s.yaw+.1,{s,t});
  const before=await p.evaluate(()=>document.getElementById('trainGarage').scrollTop);
  s=t;await touchDrag(p,0,-40);t=await view(p);const after=await p.evaluate(()=>document.getElementById('trainGarage').scrollTop);
  check(width+' 觸控直拖改仰角、頁面不捲',t.elevation>s.elevation+.1&&after===before,{s,t,before,after,top});
  await p.locator('.g-period').scrollIntoViewIfNeeded();const h=await hits(p);check(width+' 天色選單看得到、點得到、不撐出橫捲',h.height>=43.5&&h.hit&&!h.overflow,h);
  await pick(p,'night');check(width+' 選星空',(await view(p)).period==='night'&&(await hint(p)).endsWith(' · 星空'));
  await p.locator('.g-stage').screenshot({path:`${OUT}/${width}-track-night.png`});
  if(width===375){
   await p.locator('.g-fs').tap();await p.waitForFunction(()=>document.getElementById('trainGarage').classList.contains('g-full'));await settle(p);
   s=await view(p);await touchDrag(p,-60,0);t=await view(p);check('375 全畫面觸控橫拖',t.yaw<s.yaw-.1,{s,t});
   check('375 全畫面天色選單點得到',(await hits(p)).hit);await p.screenshot({path:`${OUT}/375-fullscreen.png`});
   await p.locator('.g-fs').tap();
   await p.evaluate(()=>{document.documentElement.dataset.theme='dark';state.mapDark=true;TrainGarage.refresh();});await settle(p);
   await p.locator('.g-period').scrollIntoViewIfNeeded();await p.locator('.g-stage').screenshot({path:`${OUT}/375-track-dark.png`});
  }
  await pick(p,'auto');check(width+' 無 JS 例外',!errors.length,errors);await c.close();
 }
}finally{await b.close();}
const failed=results.filter(r=>!r.pass);console.log(`\n${results.length-failed.length}/${results.length} PASS`);process.exit(failed.length?1:0);

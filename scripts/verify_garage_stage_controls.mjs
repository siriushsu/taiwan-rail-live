// 車庫舞台：旋轉、視角高低沒有按鈕之後靠手勢（照主地圖 rail-3d/map-gestures.js，逐模式的數值在 verify_garage_map_gestures.mjs）：
// 左鍵與觸控拖曳平移（觸控不捲頁面）、右鍵拖曳轉向與仰角、滾輪縮放、畫布方向鍵照舊；
// 時段選擇（天色）只在有天色的海岸行旅出現，選了舞台與提示列跟著換、記在這台裝置、全畫面也能選；場景頁用記著的天色當起點，頁上的時段鈕只管開著的這段。
// 用法：GARAGE_URL=http://127.0.0.1:5297/ node scripts/verify_garage_stage_controls.mjs（Chrome 無視窗；截圖在 .superpowers/garage-stage-controls）
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-stage-controls';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const ready=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
const view=p=>p.locator('.g-view').evaluate(c=>({yaw:+c.dataset.yaw,elevation:+c.dataset.elevation,zoom:+c.dataset.zoom,mode:c.dataset.mode,period:c.dataset.period,pan:JSON.parse(c.dataset.pan||'[0,0]')}));
const hint=p=>p.locator('.g-view-hint').textContent();
const sview=p=>p.locator('.g-sf-view').evaluate(c=>({yaw:+c.dataset.yaw,elevation:+c.dataset.elevation,zoom:+c.dataset.zoom,mode:c.dataset.mode,period:c.dataset.period,pan:JSON.parse(c.dataset.pan||'[0,0]')}));
const moved=(s,t)=>Math.hypot(t.pan[0]-s.pan[0],t.pan[1]-s.pan[1]);
const openScene=async p=>{await p.click('[data-view="scene"]');await p.waitForFunction(()=>{const v=document.querySelector('.g-sf-view');return !document.querySelector('.g-sf').hidden&&v?.dataset.scene&&v.dataset.mode==='scene';},null,{timeout:60000});await settle(p);};
const leaveScene=async p=>{await p.click('.g-sf-leave');await p.waitForFunction(()=>document.querySelector('.g-sf').hidden);await settle(p);};
const stored=p=>p.evaluate(()=>localStorage.getItem('trainmap-garage-period-v1'));
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
const center=async(p,sel='.g-view')=>{const canvas=p.locator(sel);await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2};};
// oy：起點離中心的垂直距離。右鍵橫拖照主地圖，在中心下方與上方轉的方向相反，所以右鍵從中心下方 40px 起拖。
const mouseDrag=async(p,dx,dy,button='left',sel='.g-view',oy=0)=>{const {x,y}=await center(p,sel);await p.mouse.move(x,y+oy);await p.mouse.down({button});await p.mouse.move(x+dx,y+oy+dy,{steps:8});await p.mouse.up({button});await settle(p);};
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
  let s=await view(p);await mouseDrag(p,60,-30);let t=await view(p);check('滑鼠左鍵拖曳平移，不轉、不改仰角',moved(s,t)>.01&&t.yaw===s.yaw&&t.elevation===s.elevation,{s,t});
  await p.click('.g-reset-view');await settle(p);
  s=await view(p);await mouseDrag(p,-60,0,'right','.g-view',40);t=await view(p);check('滑鼠右鍵橫拖轉水平',Math.abs(t.yaw-s.yaw)>.3&&t.elevation===s.elevation,{s,t});
  s=t;await mouseDrag(p,0,40,'right','.g-view',40);t=await view(p);check('滑鼠右鍵往下拖拉高鏡頭',t.elevation>s.elevation+.2,{s,t});
  check('畫布上的右鍵選單被擋掉',await p.locator('.g-view').evaluate(c=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});c.dispatchEvent(e);return e.defaultPrevented;}));
  s=t;await mouseDrag(p,60,0,'middle');t=await view(p);check('中鍵拖不轉',t.yaw===s.yaw,{s,t});
  // 滾輪照主地圖：先等 40ms 分辨滑鼠滾輪還是觸控板，再緩動約 200ms，所以等縮放動起來再量（最多 3 秒）。
  s=t;const {x,y}=await center(p);await p.mouse.move(x,y);await p.mouse.wheel(0,-240);
  await p.waitForFunction(z=>+document.querySelector('.g-view').dataset.zoom>z+.2,s.zoom,{timeout:3000}).catch(()=>{});await settle(p);t=await view(p);check('滾輪縮放',t.zoom>s.zoom+.2,{s,t});
  await p.click('.g-reset-view');await settle(p);s=await view(p);await p.locator('.g-view').focus();await p.keyboard.press('ArrowLeft');await p.keyboard.press('ArrowUp');await settle(p);t=await view(p);
  check('畫布方向鍵轉水平與仰角',near(t.yaw-s.yaw,-.15,1e-6)&&near(t.elevation-s.elevation,.12,1e-6),{s,t});
  await show(p,'loop');check('環形試跑沒有天色選單',await p.locator('.g-period').isHidden());

  await show(p,'track');
  check('海岸行旅出現天色選單、預設自動照台灣時間',await p.locator('.g-period').isVisible()&&await p.inputValue('.g-period-select')==='auto'&&(await view(p)).period===taipeiPeriod(),await view(p));
  check('天色選單的字',await p.locator('.g-period > span').textContent()==='天色'&&JSON.stringify(await p.locator('.g-period-select option').allTextContents())===JSON.stringify(['自動','日出','藍天','黃昏','星空']));
  await pick(p,'night');check('海岸行旅選星空：舞台畫星空、提示列跟著換、記在這台裝置',(await view(p)).period==='night'&&(await hint(p)).endsWith(' · 星空')&&await p.evaluate(()=>localStorage.getItem('trainmap-garage-period-v1'))==='night',{hint:await hint(p)});
  await p.screenshot({path:OUT+'/desktop-track-night.png'});
  // 場景是獨立的場景頁：從「場景」格進去，起點是記著的天色；頁上的時段鈕照舊（日／黃昏／夜），只管開著的這段、不寫回記著的選擇。
  await openScene(p);
  check('場景頁沿用星空、時段鈕跟著亮',(await sview(p)).period==='night'&&await p.locator('[data-sf-period="night"]').getAttribute('aria-pressed')==='true',await sview(p));
  await p.click('[data-sf-period="sunset"]');await settle(p);
  check('場景頁時段鈕改黃昏，不改記著的選擇',(await sview(p)).period==='sunset'&&await stored(p)==='night',{view:await sview(p),stored:await stored(p)});
  s=await sview(p);await mouseDrag(p,50,0,'left','.g-sf-view');t=await sview(p);check('場景頁滑鼠左鍵拖曳平移、不轉',moved(s,t)>.01&&t.yaw===s.yaw,{s,t});
  s=t;await mouseDrag(p,-50,0,'right','.g-sf-view',40);t=await sview(p);check('場景頁滑鼠右鍵拖曳轉水平',Math.abs(t.yaw-s.yaw)>.3,{s,t});
  check('場景頁畫布上的右鍵選單被擋掉',await p.locator('.g-sf-view').evaluate(c=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});c.dispatchEvent(e);return e.defaultPrevented;}));
  await p.screenshot({path:OUT+'/desktop-scene-page.png'});
  await leaveScene(p);
  check('離開場景頁，舞台回到記著的星空',(await view(p)).period==='night'&&await p.inputValue('.g-period-select')==='night'&&(await hint(p)).endsWith(' · 星空'),{view:await view(p),hint:await hint(p)});
  // 場景只有白天、黃昏、夜晚三套，日出併進黃昏那顆（garage-diorama.js 的 themeOf）。
  await pick(p,'sunrise');await openScene(p);
  check('記著日出：場景頁畫黃昏那套、黃昏鈕亮',(await sview(p)).period==='sunset'&&await p.locator('[data-sf-period="sunset"]').getAttribute('aria-pressed')==='true',await sview(p));
  await leaveScene(p);

  await p.click('.g-fs');await p.waitForFunction(()=>document.getElementById('trainGarage').classList.contains('g-full'));await settle(p);
  check('全畫面也有天色選單',await p.locator('.g-period').isVisible());
  await pick(p,'auto');check('全畫面選回自動照台灣時間',(await view(p)).period===taipeiPeriod()&&await p.evaluate(()=>localStorage.getItem('trainmap-garage-period-v1'))==='auto');
  s=await view(p);await mouseDrag(p,0,40,'right','.g-view',40);t=await view(p);check('全畫面右鍵往下拖拉高鏡頭（海岸仰角上限 .30）',t.elevation>s.elevation+.1,{s,t});
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
  let s=await view(p);await touchDrag(p,60,0);let t=await view(p);check(width+' 觸控橫拖平移、不轉',moved(s,t)>.01&&t.yaw===s.yaw,{s,t});
  const before=await p.evaluate(()=>document.getElementById('trainGarage').scrollTop);
  s=t;await touchDrag(p,0,-40);t=await view(p);const after=await p.evaluate(()=>document.getElementById('trainGarage').scrollTop);
  check(width+' 觸控直拖平移、不改仰角、頁面不捲',moved(s,t)>.01&&t.elevation===s.elevation&&after===before,{s,t,before,after,top});
  await p.locator('.g-period').scrollIntoViewIfNeeded();const h=await hits(p);check(width+' 天色選單看得到、點得到、不撐出橫捲',h.height>=43.5&&h.hit&&!h.overflow,h);
  await pick(p,'night');check(width+' 選星空',(await view(p)).period==='night'&&(await hint(p)).endsWith(' · 星空'));
  await p.locator('.g-stage').screenshot({path:`${OUT}/${width}-track-night.png`});
  if(width===375){
   await p.locator('.g-fs').tap();await p.waitForFunction(()=>document.getElementById('trainGarage').classList.contains('g-full'));await settle(p);
   s=await view(p);await touchDrag(p,-60,0);t=await view(p);check('375 全畫面觸控橫拖平移',moved(s,t)>.01,{s,t});
   check('375 全畫面天色選單點得到',(await hits(p)).hit);await p.screenshot({path:`${OUT}/375-fullscreen.png`});
   await p.locator('.g-fs').tap();
   await p.evaluate(()=>{document.documentElement.dataset.theme='dark';state.mapDark=true;TrainGarage.refresh();});await settle(p);
   await p.locator('.g-period').scrollIntoViewIfNeeded();await p.locator('.g-stage').screenshot({path:`${OUT}/375-track-dark.png`});
  }
  await pick(p,'auto');check(width+' 無 JS 例外',!errors.length,errors);await c.close();
 }
}finally{await b.close();}
const failed=results.filter(r=>!r.pass);console.log(`\n${results.length-failed.length}/${results.length} PASS`);process.exit(failed.length?1:0);

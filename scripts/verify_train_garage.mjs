// 真實引擎驗收：精修網格、進度、觸控、切換與失敗復原；不連外寫資料。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/';
const OUT='.superpowers/garage-blender'+(process.env.GARAGE_MOBILE_ONLY?'-mobile':'');mkdirSync(OUT,{recursive:true});
const results=[];
function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));}
const STYLE={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9ede5'}}]};
async function boot(browser,width=1280,query='',height=900){
 const ctx=await browser.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000,locale:'zh-TW'});
 await ctx.addInitScript(()=>{
  localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');
  window.__garageDraws=0;const orig=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){if(this.canvas.classList.contains('g-view'))window.__garageDraws++;return orig.apply(this,args);};
 });
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({contentType:'application/json',body:JSON.stringify(STYLE)});return r.abort();});
 const page=await ctx.newPage(),errors=[],meshes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/garage-blender-v1/')&&r.url().endsWith('.bin.gz'))meshes.push(r.url());});
 await page.goto(BASE+'?lang=zh-TW&'+query,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.trains.length>0,{},{timeout:60000});
 if(query.includes('garage='))await ready(page);
 return {ctx,page,errors,meshes};
}
const ready=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.appearance==='blender-original'&&document.querySelector('.g-view').dataset.rendered&&!document.querySelector('.g-retry')?.offsetHeight);
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const pix=p=>p.evaluate(()=>{const c=document.querySelector('.g-view'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0,left=c.width,right=-1,top=c.height,bottom=-1,hash=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i+3]){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);hash=(hash*31+d[i]+d[i+1]*3+d[i+2]*7)>>>0;}}return{count,left,right,top,bottom,w:c.width,h:c.height,hash};});
const storage=p=>p.evaluate(()=>JSON.stringify({rides:loadRides(),checkins:loadCheckins()}));
// 展示台的平均彩度(max-min of RGB)。量真的畫出來的像素,不量 CSS 宣告——灰車體是渲染結果不是樣式。
const chroma=p=>p.evaluate(()=>{const c=document.querySelector('.g-view'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let sum=0,n=0;for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;sum+=Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]);n++;}return n?sum/n:-1;});
const lockOf=p=>p.evaluate(()=>document.querySelector('.g-view').dataset.lock);

const select=async(p,id)=>{await p.selectOption('.g-model-select',id);await p.waitForFunction(id=>document.querySelector('.g-view')?.dataset.rendered===id,id);};
async function auditControls(page){
 return page.evaluate(()=>{
  const d=document.getElementById('trainGarage'),els=[...d.querySelectorAll('button,input,select,summary,a')].filter(el=>{const r=el.getBoundingClientRect();return el.checkVisibility()&&r.width&&r.height&&r.top>=70&&r.bottom<=innerHeight;});
  const failures=[];
  for(const el of els){const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!el.contains(hit))failures.push('hit:'+el.className);if(r.left<0||r.right>innerWidth+.5)failures.push('edge:'+el.className);if(r.height<43.5)failures.push('target:'+el.className);}
  for(let a=0;a<els.length;a++)for(let b=a+1;b<els.length;b++){if(els[a].contains(els[b])||els[b].contains(els[a]))continue;const x=els[a].getBoundingClientRect(),y=els[b].getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)failures.push('overlap:'+els[a].className+'/'+els[b].className);}
  // 所有原有互動控件都在 modal 之外；top layer 必須讓它們無法命中。
  const background=[...document.querySelectorAll('button,a,input,select,[role="button"]')].filter(el=>!d.contains(el)&&el.getClientRects().length);
  for(const el of background){const r=el.getBoundingClientRect();if(r.x>=0&&r.y>=0&&r.right<innerWidth&&r.bottom<innerHeight){const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(el.contains(h))failures.push('background:'+el.id);}}
  return {failures,controls:els.length,background:background.length,overflow:d.scrollWidth>innerWidth||document.documentElement.scrollWidth>innerWidth};
 });
}

for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  if(!process.env.GARAGE_MOBILE_ONLY){
  const {ctx,page,errors,meshes}=await boot(browser);
  check(engine+' 首頁不載入車庫網格',meshes.length===0);
  await page.evaluate(()=>openTrainGarage());await ready(page);
  check(engine+' 空白護照與全部 62 款規則',await page.evaluate(()=>document.querySelector('.g-count').textContent==='0'&&document.querySelector('.g-total').textContent===' / 62'&&garageCollection().every(r=>r.goal)&&document.querySelectorAll('.g-car').length===62));
  check(engine+' 只載入目前單款精修模型',meshes.length===1,meshes);
  const original=await storage(page);
  await page.click('[data-filter="owned"]');await page.click('.g-demo-start');await ready(page);
  check(engine+' 展示模式不寫護照',await storage(page)===original&&await page.locator('.g-demo').isVisible()&&!await page.locator('.g-goal').isVisible());
  await page.click('.g-demo-off');await page.click('[data-filter="all"]');
  const catalog=await page.evaluate(()=>Object.keys(RailGarageCatalog)),bad=[];
  for(const id of catalog){
   await select(page,id);const a=await pix(page);await page.click('.g-right');await settle(page);const b=await pix(page);
   for(const x of [a,b])if(x.count<500||x.left<2||x.top<2||x.right>x.w-3||x.bottom>x.h-3)bad.push({id,pixels:x});
   if(a.hash===b.hash)bad.push({id,reason:'rotation'});
  }
  check(engine+' 62 款原始 Blender 網格兩角度完整入鏡與旋轉',bad.length===0,bad);
  await select(page,'700t');await page.screenshot({path:OUT+'/'+engine+'-desktop.png'});
  await page.click('.g-sources summary');
  check(engine+' 模型來源與安全外連',await page.evaluate(()=>document.querySelectorAll('.g-source-body a').length>0&&[...document.querySelectorAll('.g-source-body a')].every(a=>a.href.startsWith('https://')&&a.rel.includes('noopener'))));
  await settle(page);const idle=await page.evaluate(()=>__garageDraws);await page.waitForTimeout(450);
  check(engine+' 靜止時不持續重畫精修模型',await page.evaluate(()=>__garageDraws)===idle);
  await page.click('.g-auto');const start=await page.evaluate(()=>__garageDraws);await page.waitForTimeout(250);check(engine+' 自動旋轉持續重畫',await page.evaluate(()=>__garageDraws)>start+1);await page.click('.g-auto');
  await page.evaluate(()=>{saveRides([{train:'211',date:'2026-08-10',stockId:'taroko',sys:'tra_sched'},{train:'212',date:'2026-08-02',stockId:'taroko',sys:'tra_sched'},{train:'123',date:'2026-08-01',stockId:'e500pp',sys:'tra_sched'},{train:'900',date:'2026-08-03',sys:'thsr_sched'}]);renderPassport();});
  check(engine+' 舊章／舊分類／最早日期帶入',await page.evaluate(()=>{const rows=garageCollection();return rows.find(r=>r.id==='temu1000').date==='2026-08-02'&&rows.find(r=>r.id==='emu3000').earned&&rows.find(r=>r.id==='700t').earned&&rows.find(r=>r.id==='emu800').owned;}));
  await page.evaluate(()=>{saveCheckins({v:2,st:{'metro|台北車站':{name:'台北車站',sys:'metro',s:'visit',d:'2026-09-07',n:1,u:Date.now()},'metro|中山':{name:'中山',sys:'metro',s:'pass',d:'2026-09-07',n:1,u:Date.now()}},sg:{}});renderPassport();});
  check(engine+' 車站進度即時解鎖',await page.evaluate(()=>garageCollection().find(r=>r.id==='c301').owned));

  // 未收集的車＝灰車體(使用者 2026-09-07:「車庫裡沒有收集到的車,應該是灰色輪廓才對,
  // 不能沒收集到就在車庫裡呀」)。款式不寫死,從當下的護照推導出一款已入庫、一款未收集,
  // 種子改了也不會假綠;並配正向對照——已入庫那款必須量到真實塗裝彩度,否則「彩度低」恆真。
  await page.click('[data-filter="all"]');
  const pair=await page.evaluate(()=>{const rows=garageCollection();
    return {owned:rows.find(r=>r.owned)?.id||'',locked:rows.find(r=>!r.owned)?.id||''};});
  await select(page,pair.owned);const ownedLook={id:pair.owned,lock:await lockOf(page),chroma:await chroma(page)};
  await select(page,pair.locked);const lockedLook={id:pair.locked,lock:await lockOf(page),chroma:await chroma(page)};
  check(engine+' 未收集的車在展示台是灰車體',lockedLook.lock==='grey'&&lockedLook.chroma<4,lockedLook);
  check(engine+' 控制組 已入庫的車保有塗裝彩度',ownedLook.lock==='off'&&ownedLook.chroma>10,ownedLook);
  check(engine+' 未收集的格子縮圖去色(類別已套上且樣式表真的有這條規則)',await page.evaluate(([o,l])=>{
    const has=id=>document.querySelector('.g-car[data-model="'+id+'"]')?.classList.contains('g-locked');
    const rule=[...document.styleSheets].flatMap(sh=>{try{return [...sh.cssRules];}catch{return [];}})
      .find(r=>r.selectorText==='#trainGarage .g-car.g-locked img');
    return has(l)===true&&has(o)===false&&!!rule&&rule.style.filter.includes('grayscale');
  },[pair.owned,pair.locked]),pair);
  const count=await page.locator('.g-count').textContent();await page.reload();await page.waitForFunction(()=>state.ready);await page.evaluate(()=>openTrainGarage());await ready(page);
  check(engine+' 重開保留護照推導進度',await page.locator('.g-count').textContent()===count);
  await page.evaluate(()=>{saveRides([]);saveCheckins({v:2,st:{},sg:{}});renderPassport();});
  check(engine+' 換成空白護照不殘留前一份收藏',await page.locator('.g-count').textContent()==='0');
  await page.click('[data-filter="owned"]');check(engine+' 空收藏停用選單並提供返回所有車款',await page.locator('.g-empty').isVisible()&&await page.locator('.g-model-select').isDisabled()&&!await page.locator('.g-showcase').isVisible());await page.click('.g-reset');
  check(engine+' 移除搜尋框，62 款依系統分組選車',await page.locator('#trainGarage input').count()===0&&await page.locator('.g-model-select option').count()===62&&await page.locator('.g-model-select optgroup[label="台北捷運"] option').count()===7);
  await select(page,'700t');check(engine+' 下拉選車同步展示台與收藏架',await page.locator('.g-car[data-model="700t"]').getAttribute('aria-pressed')==='true'&&await page.locator('.g-name').textContent()===await page.evaluate(()=>RailGarageCatalog['700t'].name));
  await page.locator('.g-car[data-model="c301"]').click();await ready(page);check(engine+' 收藏架選車回到下拉選單',await page.locator('.g-model-select').inputValue()==='c301'&&await page.locator('.g-model-select').evaluate(el=>el===document.activeElement));
  await page.route('**/garage-blender-v1/ct273.bin.gz',r=>r.fulfill({status:503,body:'retry'}));
  await page.locator('.g-car[data-model="ct273"]').evaluate(e=>e.click());await page.waitForSelector('.g-retry:visible');
  check(engine+' 網格失敗顯示重試且不影響收藏',await page.locator('.g-count').textContent()==='0');
  await page.unroute('**/garage-blender-v1/ct273.bin.gz');await page.click('.g-retry');await ready(page);
  check(engine+' 失敗後可重新載入',await page.locator('.g-view').getAttribute('data-rendered')==='ct273');
  await page.locator('.g-car[data-model="ck124"]').evaluate(e=>e.click());await page.locator('.g-car[data-model="emu500"]').evaluate(e=>e.click());await page.waitForFunction(()=>document.querySelector('.g-view').dataset.rendered==='emu500');
  check(engine+' 連續換車不被舊下載覆蓋',await page.locator('.g-name').textContent()==='EMU500 通勤電車');
  await page.evaluate(()=>{for(let i=0;i<6;i++){TrainGarage.close();openTrainGarage();}});await ready(page);check(engine+' 快速開關仍可載入',!await page.locator('.g-fallback').isVisible());
  for(const lang of ['en','ja']){await page.evaluate(lang=>setLanguage(lang),lang);await ready(page);check(engine+' '+lang+' 動態翻譯',await page.locator('#garageTitle').textContent()===(lang==='en'?'My garage':'マイ車庫'));}
  await page.keyboard.press('Escape');check(engine+' Esc 回到地圖',await page.evaluate(()=>!TrainGarage.isOpen));
  await page.evaluate(()=>{openTrainGarage();window.dispatchEvent(new Event('rail:native-back',{cancelable:true}));});check(engine+' App 返回關閉車庫',await page.evaluate(()=>!TrainGarage.isOpen));
  check(engine+' 桌面無 JS 例外',errors.length===0,errors);await ctx.close();
  }
  for(const width of [360,375,390,414,600,768,844]){
   const {ctx,page,errors}=await boot(browser,width,'',width===844?390:width===768?1024:width===360?640:width===375?667:width===414?736:900);
   await page.evaluate(()=>{document.body.classList.add('fs');const banner=document.getElementById('alertBanner');banner.hidden=false;banner.textContent='營運公告';const tr=state.trains.find(t=>t.sys==='tra_sched'&&!t.loop);followTrainNo(tr.train,{sys:tr.sys});openRidePanel();});
   await page.tap('#tabMore');await page.locator('#moreSheet [data-act="garage"]').scrollIntoViewIfNeeded();await page.tap('#moreSheet [data-act="garage"]');await ready(page);
   const first=await page.evaluate(()=>{const c=document.querySelector('.g-view').getBoundingClientRect(),s=document.querySelector('.g-model-select').getBoundingClientRect(),d=document.getElementById('trainGarage');return {canvasTop:c.top,canvasBottom:c.bottom,selectorTop:s.top,selectorBottom:s.bottom,height:innerHeight,scroll:d.scrollTop};});
   check(engine+' '+width+' 第一屏同時看得到選單與完整車模',first.selectorTop>=0&&first.selectorBottom<=first.canvasTop&&first.canvasBottom<=first.height&&first.scroll===0,first);
   await page.tap('.g-model-select');await page.selectOption('.g-model-select','700t');await page.tap('.g-view');await page.waitForFunction(()=>document.querySelector('.g-view').dataset.rendered==='700t');
   check(engine+' '+width+' 觸控下拉換車不跳離展示台',await page.locator('.g-model-select').inputValue()==='700t'&&await page.evaluate(()=>document.getElementById('trainGarage').scrollTop===0));
   let audit=await auditControls(page);check(engine+' '+width+' 全畫面／公告／跟車／抽屜／護照組合',!audit.failures.length&&!audit.overflow,audit);
   await page.locator('.g-right').scrollIntoViewIfNeeded();const before=await pix(page);await page.tap('.g-right');await settle(page);const after=await pix(page);check(engine+' '+width+' 真觸控旋轉',before.hash!==after.hash);
   await page.locator('.g-filters').scrollIntoViewIfNeeded();audit=await auditControls(page);check(engine+' '+width+' 收藏架與所有背景控件相交及命中',!audit.failures.length&&!audit.overflow,audit);
   await page.tap('[data-filter="owned"]');await page.locator('.g-demo-start').scrollIntoViewIfNeeded();await page.tap('.g-demo-start');await ready(page);
   await page.evaluate(()=>document.getElementById('trainGarage').scrollTop=0);
   if(width===390)await page.screenshot({path:OUT+'/'+engine+'-mobile.png'});
   await page.locator('.g-sources summary').scrollIntoViewIfNeeded();await page.tap('.g-sources summary');await page.locator('.g-source-body').scrollIntoViewIfNeeded();
   audit=await auditControls(page);check(engine+' '+width+' 展開來源連結',!audit.failures.length&&!audit.overflow,audit);
   await page.evaluate(()=>{document.documentElement.dataset.theme='dark';state.mapDark=true;TrainGarage.refresh();document.getElementById('trainGarage').classList.add('dark');});
   audit=await auditControls(page);check(engine+' '+width+' 深色模式控件與溢出',!audit.failures.length&&!audit.overflow,audit);
   if(width===390){await page.locator('.g-showcase').scrollIntoViewIfNeeded();await page.screenshot({path:OUT+'/'+engine+'-mobile-dark.png'});}
   const bad=[];for(const el of await page.locator('#trainGarage button:visible:not(.g-car),#trainGarage input:visible,#trainGarage select:visible,#trainGarage summary:visible').all()){
    await el.scrollIntoViewIfNeeded();if(!await el.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}))bad.push(await el.getAttribute('class'));
   }
   check(engine+' '+width+' 捲動後全部控件可觸及',!bad.length,bad);
   await page.tap('.g-close');check(engine+' '+width+' 回到原護照',await page.evaluate(()=>!TrainGarage.isOpen&&!document.getElementById('ridePanel').hidden));
   check(engine+' '+width+' 無 JS 例外',errors.length===0,errors);await ctx.close();
  }
 }catch(e){check(engine+' 測試執行',false,e.stack);}finally{await browser.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));
console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

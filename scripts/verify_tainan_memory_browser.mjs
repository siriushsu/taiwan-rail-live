import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.VURL||'http://127.0.0.1:5244',out='output/tainan-memory';fs.mkdirSync(out,{recursive:true});
const results=[];
async function controls(page,scope='body'){
 return page.evaluate(scope=>{
  const all=[...document.querySelector(scope).querySelectorAll('button,a,input,select')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])'));
  const boxes=all.map(e=>({id:e.id||e.textContent.trim().slice(0,30),e,r:e.getBoundingClientRect()})).filter(v=>v.r.width&&v.r.height);
  const errors=[];
  for(const b of boxes){if(b.r.left<-.1||b.r.right>innerWidth+.1||b.r.top<-.1||b.r.bottom>innerHeight+.1)errors.push('溢出:'+b.id);const hit=document.elementFromPoint(b.r.x+b.r.width/2,b.r.y+b.r.height/2);if(hit!==b.e&&!b.e.contains(hit))errors.push('無法觸及:'+b.id);if(b.r.width<24||b.r.height<24)errors.push('觸控目標過小:'+b.id);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1)errors.push('相交:'+a.id+'/'+b.id);}
  if(document.documentElement.scrollWidth>innerWidth)errors.push('水平捲動');return {count:boxes.length,errors};
 },scope);
}
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
 const browser=await type.launch({headless:engine!=='chromium'});
 for(const [width,height] of [[360,780],[375,812],[390,844],[414,896],[768,1024],[844,390],[1280,900]]){
  console.log('開始',engine,width,height);
  const touch=width!==1280,context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // 模擬地下化後才開啟；歷史頁不可依裝置日期換班表。
  await page.addInitScript(()=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:['2027-01-03T12:00:00+08:00']));}static now(){return new NativeDate('2027-01-03T12:00:00+08:00').valueOf();}};});
  await page.goto(base+'/memories/tainan-2026-09-12/');try{await page.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});}catch(e){console.log('載入狀態',await page.locator('#loading').textContent(),errors);throw e;}
  const click=sel=>touch?page.tap(sel):page.click(sel);
  await click('#play');const layout=await controls(page);assert.deepEqual(layout.errors,[],engine+' '+width+' '+JSON.stringify(layout.errors));
  await click('#next');await click('#zoomin');await click('#zoomout');await click('#rotate');await click('#overview');await click('#station');
  await page.locator('#speed').selectOption('60');await page.locator('#time').fill('17:30:00');await page.locator('#time').dispatchEvent('change');assert.equal(await page.locator('#clock').textContent(),'17:30:00');
  const timeline=page.locator('#timeline');const b=await timeline.boundingBox();if(touch)await page.touchscreen.tap(b.x+b.width*.75,b.y+b.height/2);else await page.mouse.click(b.x+b.width*.75,b.y+b.height/2);assert.ok(await page.evaluate(()=>tainanMemory.state.sec>60000));
  if(height>520){await click('#about');for(const control of await page.locator('#details a,#details button').all()){await control.scrollIntoViewIfNeeded();assert.ok(await control.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.height>=44&&(e===h||e.contains(h));}),'說明控件可捲到且可觸及');}await click('#details button');}
  const behavior=await page.evaluate(async()=>{
   const m=tainanMemory,results=[];m.state.playing=false;
   const distance=(a,b)=>Math.hypot((a[0]-b[0])*102000,(a[1]-b[1])*111320);
   for(const direction of ['北上','南下']){
    const tr=m.data.trains.find(t=>t.direction===direction&&t.serviceDate===m.data.date&&t.stops.some(s=>s.name.replace('台','臺')==='臺南'&&s.depSec-s.arrSec>=120)),st=tr.stops.find(s=>s.name.replace('台','臺')==='臺南');
    const p=m.sample(tr,st.arrSec+40),q=m.sample(tr,st.depSec-20);if(!p||!q)throw Error('停靠時不見列車');if(distance(p.coordinate,q.coordinate)>.02)throw Error('停靠時仍移動 '+tr.train);
    let run;for(let t=tr.spans[0].start+30;t<st.arrSec-20;t+=10){const a=m.sample(tr,t),b=m.sample(tr,t+10);if(a&&b&&distance(a.coordinate,b.coordinate)>10){run={a,b,t};break;}}
    if(!run)throw Error('找不到動態案例');if(Math.sign(run.b.coordinate[1]-run.a.coordinate[1])!==(direction==='北上'?1:-1))throw Error('方向相反');
    m.jump(run.t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const model=m.models.get(tr.id);if(!model.group.visible)throw Error('實際編組未顯示');
    // 由渲染物件反算座標，核對原始股道線段，而非只拿 sample() 與自己比。
    let error=0;for(const car of model.cars){const lon=m.data.origin[0]+car.position.x/(111320*Math.cos(m.data.origin[1]*Math.PI/180)),lat=m.data.origin[1]+car.position.y/111320;let nearest=Infinity;for(const rail of m.data.rails)for(let i=1;i<rail.coordinates.length;i++){const a=rail.coordinates[i-1],b=rail.coordinates[i],x=(a[0]-lon)*102000,y=(a[1]-lat)*111320,dx=(b[0]-a[0])*102000,dy=(b[1]-a[1])*111320,f=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));nearest=Math.min(nearest,Math.hypot(x+f*dx,y+f*dy));}error=Math.max(error,nearest);}if(error>.05)throw Error('車廂離軌 '+error);
    results.push({direction,train:tr.train,cars:model.cars.length,trackErrorM:error,dwellDisplacementM:distance(p.coordinate,q.coordinate)});
   }
   const night=m.data.trains.filter(t=>t.serviceDate!==m.data.date).map(t=>({train:t.train,visible:!!m.sample(t,t.spans[0].start+1)}));if(night.some(t=>!t.visible))throw Error('跨夜遺失');
   const uncertain=m.uncertainty.intervals.find(i=>i.trainNos.includes('3158'));m.jump((uncertain.start+uncertain.end)/2);m.stationView();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const id of uncertain.trains){const model=m.models.get(id),tr=m.data.trains.find(t=>t.id===id),p=m.sample(tr,m.state.sec);if(model.group.visible||!model.label.coordinate||distance(model.label.coordinate,p.coordinate)>.001)throw Error('不確定股道沒有保留原位置標記');}
   if(!document.getElementById('caption').textContent.includes('股道安排待確認'))throw Error('缺少不確定性說明');
   m.jump(uncertain.end+2);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(const id of uncertain.trains)if(!m.models.get(id).group.visible)throw Error('已離開不確定時段仍不恢復車身');
   return {date:m.data.date,dayTrainCount:m.data.trains.length,directions:results,night,uncertainty:'原位置標記與明示說明，離開時段恢復車身'};
  });
  const followId=await page.evaluate(()=>tainanMemory.data.trains.find(t=>t.direction==='南下'&&t.serviceDate===tainanMemory.data.date).id);await page.locator('#train').selectOption(followId);assert.equal(await page.evaluate(()=>tainanMemory.state.follow),followId);await click('#station');
  const before=await page.evaluate(()=>tainanMemory.state.sec);await click('#play');await page.waitForFunction(before=>tainanMemory.state.sec>before+5,before);await click('#play');
  await page.locator('#time').fill('08:03:30');await page.locator('#time').dispatchEvent('change');await page.screenshot({path:`${out}/${engine}-${width}.png`});
  assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith(base+'/memories/tainan-2026-09-12/')||u==='data:,'),'歷史頁讀取外部或即時資料');
  assert.equal(await page.locator('#live').getAttribute('href'),'../../?scene=3d&g=all&at=22.99681,120.21295&z=17');
  results.push({engine,width,height,controls:layout.count,requests:requests.length,...behavior});console.log('通過',engine,width);fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));console.log('雙引擎重播驗收通過：'+results.length+' 組；'+results.map(r=>r.width).join('/'));

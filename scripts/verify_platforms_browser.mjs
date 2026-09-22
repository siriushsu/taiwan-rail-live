import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5208/';
const out='output/platforms';fs.mkdirSync(out,{recursive:true});
const checks=[];const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));};
const epoch=Date.parse('2026-09-07T09:28:00+08:00');
for(const [engineName,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch();
 for(const width of (process.env.WIDTHS||'360,375,390,414,520,768,1280').split(',').map(Number)){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',isMobile:width<1000,hasTouch:width<1000});
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  let platform='1A',stamp=epoch,calls=0;
  await p.clock.setFixedTime(new Date(epoch));
  await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
  await p.route('**/api/tra-platforms',async route=>{calls++;await route.fulfill({json:{schema:1,at:new Date(stamp).toISOString(),expiresAt:stamp+180000,records:[{stationId:'3370',stationName:'花壇',trainNo:'3177',arrivalAt:epoch+300000,departureAt:epoch+360000,state:platform?'known':'unavailable',platform,updatedAt:stamp,expiresAt:stamp+180000}]}});});
  try{
   await p.goto(base+'?scene=2d&train=3177&t=09:28&lang=zh-TW',{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>state.ready&&state.followTrain&&window.RailPlatforms,null,{timeout:60000});
   await p.waitForTimeout(1100);
   check(`${engineName} ${width} 回放不取目前月台`,calls===0&&await p.locator('#fpPlatform').isHidden());
   await p.locator('#fpNonLive')[width<1000?'tap':'click']();
   await p.waitForFunction(()=>document.getElementById('fpPlatform').dataset.platformState==='known');
   check(`${engineName} ${width} 真觸控回到現在顯示花壇月台`,(await p.locator('#fpPlatform').textContent()).includes('花壇 · 月台 1A'));
   const measure=()=>{const shown=e=>{if(!e?.getClientRects().length)return false;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)<.05)return false;}return true;};const controls=[...document.querySelectorAll('button,a,input,select,[role="button"]')].filter(shown);const fields=['fpPlatform','tcPlatform'].map(id=>document.getElementById(id)).filter(shown);const overlaps=[];for(const f of fields){const a=f.getBoundingClientRect();for(const c of controls){if(c.contains(f)||f.contains(c))continue;const b=c.getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([f.id,c.id||c.textContent.slice(0,20)]);}}return {overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1,fields:fields.map(e=>{const r=e.getBoundingClientRect();return{id:e.id,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};};
   let m=await p.evaluate(measure);check(`${engineName} ${width} 月台列與既有控件不重疊`,!m.overflow&&!m.overlaps.length&&m.fields.every(e=>e.hit),m);
   await p.screenshot({path:`${out}/${engineName}-${width}-follow.png`});
   await p.evaluate(()=>{const tr=state.followTrain;openBoard({...tr.stops.find(s=>s.name==='花壇'),sys:'tra_sched'});});
   await p.waitForTimeout(1200);
   const board=await p.locator('#board .row[data-no="3177"] .rail-platform-label').textContent();check(`${engineName} ${width} 車站看板同月台`,board==='月台 1A',board);
   // 在全畫面／開看板／開工具抽屜的組合中掃新資訊與所有可見控件。
   for(const full of width<1000?[true]:[false,true]){
    if(await p.evaluate(()=>document.body.classList.contains('fs'))!==full)await p.locator('#fsFab').click();
    await p.waitForTimeout(800);m=await p.evaluate(measure);
    check(`${engineName} ${width} ${full?'全畫面':'一般'} 看板組合不擠壓控件`,!m.overflow&&!m.overlaps.length,m);
   }
   await p.evaluate(()=>closeBoard());
   await p.locator(width<1000?'#tabMore':'#toolsFab')[width<1000?'tap':'click']();
   await p.waitForTimeout(700);m=await p.evaluate(measure);
   // 更多是覆蓋地圖的模態抽屜；背景跟車卡被蓋住符合設計，驗證抽屜控件不被月台搶點擊。
   const drawer=await p.evaluate(()=>{const sheet=document.getElementById('moreSheet'),body=document.getElementById('moreBody'),clip=body.getBoundingClientRect();return [...sheet.querySelectorAll('button,input,select,[role="button"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.top>=clip.top&&r.bottom<=clip.bottom;}).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});});
   check(`${engineName} ${width} 月台不搶工具抽屜控件點擊`,!m.overflow&&drawer.length>0&&drawer.every(e=>e.hit),drawer);
   await p.locator('#moreClose')[width<1000?'tap':'click']();
   await p.evaluate(()=>state._setAppearance('light'));await p.waitForTimeout(800);m=await p.evaluate(measure);
   check(`${engineName} ${width} 亮色月台與控件不重疊`,!m.overflow&&!m.overlaps.length,m);
   check(`${engineName} ${width} 月台更新時刻使用台灣時間`,(await p.locator('#fpPlatform').getAttribute('title')).includes('09:28'));
   const midnight=await p.evaluate(()=>{const stop={name:'臺北',depSec:90000};const holder=document.createElement('div');holder.innerHTML=RailPlatforms.slot({sys:'tra_sched',train:'123',_rday:'2026-09-06',stops:[stop]},stop);return Number(holder.firstElementChild.dataset.event);});
   check(`${engineName} ${width} 前夜班次不重複扣一天`,midnight===Date.parse('2026-09-07T01:00:00+08:00'));
   if(width===1280){
    platform='2B';stamp+=61000;await p.clock.setFixedTime(new Date(stamp));await p.waitForTimeout(1600);
    check(`${engineName} 月台改號會更新`,(await p.locator('#fpPlatform').textContent()).includes('2B'));
    platform=null;stamp+=61000;await p.clock.setFixedTime(new Date(stamp));await p.waitForTimeout(1600);
    check(`${engineName} 官方撤回號碼不留空欄`,await p.locator('#fpPlatform').isHidden()&&await p.locator('#fpPlatform').evaluate(e=>e.getBoundingClientRect().height===0));
    await p.evaluate(()=>{const tr=state.followTrain;openBoard({...tr.stops.find(s=>s.name==='花壇'),sys:'tra_sched'});});
    await p.waitForTimeout(1200);
    check(`${engineName} 看板沒有月台資料時不留空行`,await p.locator('#board .row[data-no="3177"] .rail-platform-label').evaluate(e=>e.hidden&&e.textContent===''&&e.getBoundingClientRect().height===0));
    await p.evaluate(()=>closeBoard());
    stamp=epoch;await p.clock.setFixedTime(new Date(epoch+250000));await p.waitForTimeout(1600);
    check(`${engineName} 過期撤回月台號碼`,await p.locator('#fpPlatform').isHidden());
   }
   check(`${engineName} ${width} 無執行錯誤`,errors.length===0,errors);
  }catch(e){check(`${engineName} ${width} 操作完成`,false,String(e));}
  await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(checks,null,2));
console.log(`${checks.filter(x=>x.pass).length}/${checks.length} 通過`);if(checks.some(x=>!x.pass))process.exitCode=1;

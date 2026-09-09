import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const results=[];const check=(name,pass,detail)=>{results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));};
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch();
 try{
  const ctx=await browser.newContext({viewport:{width:414,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'});
  await ctx.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  const page=await ctx.newPage();
  const boot=async query=>{await page.goto((process.env.BASE_URL||'http://127.0.0.1:5236/')+'?lang=zh-TW&t=12:00'+query);await page.waitForFunction(()=>state.ready&&!!window.railIslandSunlight,null,{timeout:60000});await page.evaluate(()=>state.playing=false);};
  await boot('');
  await page.locator('#tabMore').tap();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();
  if(await page.evaluate(()=>sunlight.enabled))await page.tap('#sunlightRow');
  await boot('');check(name+' 關閉偏好跨重新載入保留',await page.evaluate(()=>!sunlight.enabled&&!M.raw.getSky()));
  await boot('&sun=on');
  check(name+' 分享連結覆蓋本次偏好且不改儲存值',await page.evaluate(()=>sunlight.enabled&&localStorage.getItem('trainmap-sunlight')==='0'));
  await page.evaluate(()=>{state._setAppearance('light');window.__sunTestCtx={date:'2026-09-08'};});
  // 使用真實 time input，讓 input/change 事件走使用者平常那條路。
  await page.locator('#todPick').fill('18:00');await page.locator('#todPick').blur();
  await page.waitForFunction(()=>sunlight.current?.phase==='sunset');
  check(name+' 直接指定時刻會更新光線',await page.evaluate(()=>state.simSec===64800&&musicContextNow().hour==='dusk'));
  for(const fs of [false,true])for(const banner of [false,true]){
   await page.evaluate(({fs,banner})=>{document.body.classList.toggle('fs',fs);const el=document.getElementById('alertBanner');el.innerHTML='<span>測試營運公告</span><button type="button">詳情</button>';el.hidden=!banner;M.resize();const st=state.schedStations.find(st=>st.name.includes('臺北'));if(st)openBoard(st);},{fs,banner});
   await page.locator('#tabMore').tap();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();
   const hit=await page.locator('#sunlightRow').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&document.documentElement.scrollWidth<=innerWidth+1;});
   check(`${name} fs=${fs} 橫幅=${banner} 車站卡＋更多面板仍可操作`,hit);
   await page.tap('#sunlightRow');await page.tap('#sunlightRow');await page.tap('#moreClose');
  }
  await page.evaluate(()=>{window.__sunTestCtx={date:'2026-09-08'};state.playing=false;setSimSec(43200);M.raw.setPitch(0);});
  const motion=await page.evaluate(async()=>{const before={c:M.getCenter(),z:M.getZoom(),pitch:M.getPitch()};setSimSec(86399);const a=sunlight.current;setSimSec(0);const replay=sunlight.current;window.__sunTestCtx.date='2026-09-09';sunlight.update(true);const b=sunlight.current;M.raw.jumpTo({center:[120.3,22.6]});await new Promise(r=>setTimeout(r,1200));const south=sunlight.current;M.raw.jumpTo({center:[121.6,25.1]});await new Promise(r=>setTimeout(r,1200));const north=sunlight.current;const s=sunlight.stats.applications;state.playing=true;state.speedMult=600;await new Promise(r=>setTimeout(r,3200));state.playing=false;return {midnightDelta:Math.abs(a.elevation-b.elevation),utcDelta:b.utcMs-a.utcMs,replaySkySame:JSON.stringify(a.sky)===JSON.stringify(replay.sky),south,north,updates:sunlight.stats.applications-s,before};});
  check(name+' 跨午夜連續、南北移動都更新、快轉每秒至多一次',motion.midnightDelta<.01&&motion.utcDelta===1000&&motion.replaySkySame&&motion.south.lat<23&&motion.north.lat>25&&motion.updates<=4&&motion.updates>=2,{midnightDelta:motion.midnightDelta,utcDelta:motion.utcDelta,replaySkySame:motion.replaySkySame,south:motion.south.lat,north:motion.north.lat,updates:motion.updates});
  await ctx.close();
 }catch(e){check(name+' 完成',false,String(e.stack||e));}finally{await browser.close();}
}
fs.mkdirSync('output/sunlight',{recursive:true});fs.writeFileSync('output/sunlight/controls.json',JSON.stringify(results,null,2));
if(results.some(x=>!x.pass))process.exitCode=1;

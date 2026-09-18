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
  // v0914c 起「日夜光影」列(#sunlightRow)搬進觀看面板「地圖」分頁,不再掛在「更多」抽屜下。
  const openMapTab=async()=>{const rail=page.locator('.view-rail [data-view="map"]');if(await rail.isVisible())await rail.tap();else{await page.tap('#viewSettingsBtn');await page.tap('.view-tabs [data-view="map"]');}};
  // v0912 起明亮外觀預設就是關：原本「開著才點關」從來不會點，偏好沒寫進去，下面「關閉保留」空轉通過。
  // 先開、重載驗「開」有被記住（預設是關，這條才量得到記憶），再關、重載驗「關」。
  await openMapTab();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();
  if(!await page.evaluate(()=>sunlight.enabled))await page.tap('#sunlightRow');
  await boot('');check(name+' 開啟偏好跨重新載入保留',await page.evaluate(()=>sunlight.enabled));
  await openMapTab();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();await page.tap('#sunlightRow');
  await boot('');check(name+' 關閉偏好跨重新載入保留',await page.evaluate(()=>!sunlight.enabled&&!M.raw.getSky()));
  await boot('&sun=on');
  // v0912（dcf6ca80）起偏好依外觀分兩把鍵（SUNLIGHT_PREF_KEY＋-dark／-light）；舊鍵 trainmap-sunlight 已沒人寫，讀它恆為 null。
  // 上面那次關閉寫進的是當下外觀那一把，==='0' 同時證明讀對了鍵。
  const shared=await page.evaluate(()=>{const key=SUNLIGHT_PREF_KEY+(document.documentElement.getAttribute('data-theme')==='dark'?'-dark':'-light');return {enabled:sunlight.enabled,key,stored:localStorage.getItem(key)};});
  check(name+' 分享連結覆蓋本次偏好且不改儲存值',shared.enabled&&shared.stored==='0',shared);
  await page.evaluate(()=>{state._setAppearance('light');window.__sunTestCtx={date:'2026-09-08'};});
  // 使用真實 time input，讓 input/change 事件走使用者平常那條路。
  await page.locator('#todPick').fill('18:00');await page.locator('#todPick').blur();
  await page.waitForFunction(()=>sunlight.current?.phase==='sunset');
  check(name+' 直接指定時刻會更新光線',await page.evaluate(()=>state.simSec===64800&&musicContextNow().hour==='dusk'));
  // 手機殼（≤900）一律全畫面：setFs(false) 在手機直接 return，載入即 fs（09-18 實測 360／414／768 皆是）。
  // 這支是 414 寬，fs=false 是產品進不去的狀態（頂列 ⚠ 鈕寬 0），只量 fs=true；桌面的車站卡＋觀看由 verify_view_controls 覆蓋。
  for(const fs of [true])for(const banner of [false,true]){
   // 公告走產品自己的 renderAlertBanner：手機一律把橫幅設 hidden、改亮頂列 ⚠ 鈕（07-30 改版）。
   // 不能直接拿掉 #alertBanner 的 hidden——那是手機永遠不會出現的狀態，會觸發桌面的
   // `.alert-banner:not([hidden]) ~ .board` 讓位規則，把車站卡撐到整個畫面。
   const alertOn=await page.evaluate(({fs,banner})=>{document.body.classList.toggle('fs',fs);state.alert={...(state.alert||{}),list:banner?[{title:'測試營運公告',start:'2026-09-08 12:00'}]:[]};renderAlertBanner();M.resize();const st=state.schedStations.find(st=>st.name.includes('臺北'));if(st)openBoard(st);const chip=document.getElementById('alertChip'),b=document.getElementById('alertBanner');return (chip&&!chip.hidden&&chip.getBoundingClientRect().width>0)||(!b.hidden&&b.getBoundingClientRect().width>0);},{fs,banner});
   await openMapTab();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();
   const hit=await page.locator('#sunlightRow').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&document.documentElement.scrollWidth<=innerWidth+1;});
   // alertOn 是正向對照：有公告那兩格必須真的看得到公告入口，否則這格什麼都沒量到。
   check(`${name} fs=${fs} 橫幅=${banner} 車站卡＋觀看面板仍可操作`,hit&&(!banner||alertOn),{alertOn});
   await page.tap('#sunlightRow');await page.tap('#sunlightRow');
   // #sunlightRow 沒有 data-act/data-proxy,不在自動關閉清單裡,面板不會自己收起。
   const vc=page.locator('.view-close');if(await vc.isVisible())await vc.tap();
  }
  await page.evaluate(()=>{window.__sunTestCtx={date:'2026-09-08'};state.playing=false;setSimSec(43200);M.raw.setPitch(0);});
  const motion=await page.evaluate(async()=>{const before={c:M.getCenter(),z:M.getZoom(),pitch:M.getPitch()};setSimSec(86399);const a=sunlight.current;setSimSec(0);const replay=sunlight.current;window.__sunTestCtx.date='2026-09-09';sunlight.update(true);const b=sunlight.current;M.raw.jumpTo({center:[120.3,22.6]});await new Promise(r=>setTimeout(r,1200));const south=sunlight.current;M.raw.jumpTo({center:[121.6,25.1]});await new Promise(r=>setTimeout(r,1200));const north=sunlight.current;const s=sunlight.stats.applications;state.playing=true;state.speedMult=600;await new Promise(r=>setTimeout(r,3200));state.playing=false;return {midnightDelta:Math.abs(a.elevation-b.elevation),utcDelta:b.utcMs-a.utcMs,replaySkySame:JSON.stringify(a.sky)===JSON.stringify(replay.sky),south,north,updates:sunlight.stats.applications-s,before};});
  check(name+' 跨午夜連續、南北移動都更新、快轉每秒至多一次',motion.midnightDelta<.01&&motion.utcDelta===1000&&motion.replaySkySame&&motion.south.lat<23&&motion.north.lat>25&&motion.updates<=4&&motion.updates>=2,{midnightDelta:motion.midnightDelta,utcDelta:motion.utcDelta,replaySkySame:motion.replaySkySame,south:motion.south.lat,north:motion.north.lat,updates:motion.updates});
  await ctx.close();
 }catch(e){check(name+' 完成',false,String(e.stack||e));}finally{await browser.close();}
}
fs.mkdirSync('output/sunlight',{recursive:true});fs.writeFileSync('output/sunlight/controls.json',JSON.stringify(results,null,2));
if(results.some(x=>!x.pass))process.exitCode=1;

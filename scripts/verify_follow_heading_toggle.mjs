// 車頭朝上為選用設定；預設不旋轉地圖，開啟後兩套跟車形狀都適用。
import {chromium,webkit} from 'playwright';import fs from 'node:fs';
const results=[],base=process.env.BASE_URL||'http://127.0.0.1:5207/';const check=(name,pass,detail)=>{results.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));};
// 車頭朝上是每幀收斂 18% 的漸近轉向:固定等 600ms 等於假設 60fps。軟體算圖的機器只跑十幾 fps,
// 同樣的 600ms 只轉到差 4 度,閘門會把環境慢誤判成產品壞掉(2026-09-18 實測:本機 11fps,
// 600ms 差 3.84 度、3000ms 差 0.05 度)。改成等它自己收斂,真的轉不到位仍由下面的斷言抓。
const settleHeading=page=>page.waitForFunction(()=>{const e=state._followHeading?.value;
  return Number.isFinite(e)&&Math.abs(((M.getBearing()-e+540)%360)-180)<1;},null,{timeout:8000}).catch(()=>{});
for(const [engine,type]of Object.entries({chromium,webkit})){const browser=await type.launch();for(const width of [360,375,390,414,520,768,1280]){
 const mobile=width<1000,context=await browser.newContext({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile,locale:'zh-TW'});await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');});const page=await context.newPage();
 try{await page.goto(base+'?g=all&train=117&t=12:00&lang=zh-TW');await page.waitForFunction(()=>state.ready&&state.followTrain,null,{timeout:60000});await page.evaluate(()=>{state.playing=false;setSimSec(43200);M.raw.setZoom(13);M.raw.setBearing(32);});await page.waitForTimeout(400);
 check(engine+' '+width+' 預設關閉且不搶方向',await page.evaluate(()=>!state.followHeadingUp&&Math.abs(M.getBearing()-32)<.1));
 const tap=async selector=>mobile?page.locator(selector).tap():page.locator(selector).click();await page.waitForFunction(()=>window.railViewControls);await tap(mobile?'#viewSettingsBtn':'.view-rail [data-view=angle]');await page.locator('#followHeadingRow').scrollIntoViewIfNeeded();await tap('#followHeadingRow');await tap('.view-close');await settleHeading(page);
 const heading=await page.evaluate(()=>({on:state.followHeadingUp,bearing:M.getBearing(),expected:state._followHeading?.value,pitch:M.getPitch(),target:state.followTrain.train}));const delta=Math.abs(((heading.bearing-heading.expected+540)%360)-180);check(engine+' '+width+' 真點開啟車頭朝上',heading.on&&delta<1,heading);
 await page.evaluate(()=>M.setPitch(35));await tap('.maplibregl-ctrl-compass');await page.waitForTimeout(500);check(engine+' '+width+' 開啟後指北仍有效',await page.evaluate(()=>state.followHeadingUp&&Math.abs(M.getBearing())<.1&&M.getPitch()<.1));
 await page.waitForFunction(()=>window.railViewControls);await tap(mobile?'#viewSettingsBtn':'.view-rail [data-view=angle]');await page.locator('#followHeadingRow').scrollIntoViewIfNeeded();await tap('#followHeadingRow');await tap('.view-close');await page.evaluate(()=>M.raw.setBearing(-42));await page.waitForTimeout(400);check(engine+' '+width+' 關閉後保持手動方向',await page.evaluate(()=>!state.followHeadingUp&&Math.abs(M.getBearing()+42)<.1&&localStorage.getItem('trainmap-follow-heading-up')==='0'));
 if(width===390){await page.evaluate(()=>{const ln=state.decoLines.find(l=>l._sys==='tymc'),tr=ln._tt[2];setSimSec((tr[1]+tr[3])/2);applyFreqFollow({ln,tr});M.raw.setZoom(13);setFollowHeadingUp(true);});await settleHeading(page);const d=await page.evaluate(()=>({freq:!!state.freqFollow,heading:state._followHeading?.value,bearing:M.getBearing()}));check(engine+' 捷運跟車共用方向開關',d.freq&&Number.isFinite(d.heading)&&Math.abs(((d.bearing-d.heading+540)%360)-180)<1,d);}
 }catch(e){check(engine+' '+width+' 方向開關驗證完成',false,String(e));}await context.close();}await browser.close();}
fs.writeFileSync('output/3d-integration/heading-results.json',JSON.stringify(results,null,2));console.log(results.filter(r=>r.pass).length+'/'+results.length);if(results.some(r=>!r.pass))process.exitCode=1;

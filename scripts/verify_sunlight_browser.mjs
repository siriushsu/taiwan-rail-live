import {chromium,webkit} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {skyDefaults} from '../rail-3d/environment/sun.mjs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5236/';
const out=process.env.OUT||'output/sunlight';fs.mkdirSync(out,{recursive:true});
const results=[];
function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
const clean=x=>x&&Object.fromEntries(Object.entries(x).filter(([k])=>!k.endsWith('-transition')));
async function boot(page,query=''){
 await page.goto(base+'?lang=zh-TW&scene=3d&ground=flat&at=25.033,121.565&z=17&t=12:00'+query,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>state.ready&&window.railIslandSunlight&&M.isStyleReady(),null,{timeout:60000});
 await page.evaluate(()=>{state.playing=false;window.__sunTestCtx={date:'2026-09-08'};setSimSec(43200);sunlight.update(true);});
 await page.waitForFunction(()=>window.railIslandIntegration?.renderer,null,{timeout:45000});
}
const init=()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','light');};
async function time(page,h){await page.evaluate(h=>setSimSec(h*3600),h);await page.waitForTimeout(350);}
function skyMean(png){const rgb=[0,0,0];let n=0;for(let y=2;y<Math.min(25,png.height);y++)for(let x=png.width*.15|0;x<png.width*.85;x++){const i=(y*png.width+x)*4;for(let k=0;k<3;k++)rgb[k]+=png.data[i+k];n++;}return rgb.map(v=>v/n);}
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
for(const [name,engine] of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const browser=await engine.launch();
 try{
  let ctx=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW',timezoneId:'America/New_York'});await ctx.addInitScript(init);
  let page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/unknown property|sky-color|horizon-color|light\.position/.test(m.text()))errors.push(m.text());});
  await boot(page);
  await page.evaluate(()=>{M.raw.setPitch(75);M.raw.setBearing(0);railIslandIntegration.setInspection(false);});
  await page.waitForTimeout(700);
  const before=await page.evaluate(()=>({sources:Object.keys(M.raw.getStyle().sources),layers:M.raw.getStyle().layers.map(l=>l.id),center:M.getCenter(),zoom:M.getZoom(),pitch:M.getPitch(),bearing:M.getBearing()}));
  const images={},readings={};
  for(const h of [6,12,18,0]){
   await time(page,h);
   readings[h]=await page.evaluate(()=>({sky:M.raw.getSky(),light:M.raw.getLight(),sun:sunlight.current,music:musicContextNow().hour,simSec:state.simSec}));
   const buffer=await page.locator('#map').screenshot({path:`${out}/${name}-${String(h).padStart(2,'0')}.png`});
   images[h]=skyMean(PNG.sync.read(buffer));
  }
  const surface=await page.evaluate(()=>{const top=M.surfaceTop(),w=cv.width,h=Math.max(0,Math.floor(top*state.dpr)-1),data=h?ctx.getImageData(0,0,w,h).data:[];return {top,painted:Array.from(data).filter((v,i)=>i%4===3&&v>0).length};});
  check(name+' 地平線外不殘留 canvas 車牌／站名',surface.top>0&&surface.painted===0,surface);
  const pairs=[[6,12],[12,18],[18,0],[0,6]];
  check(name+' 真實畫面四時段天空有可見色差',pairs.every(([a,b])=>dist(images[a],images[b])>12),images);
  check(name+' 晨東／暮西／正午高／午夜地下',readings[6].light.position[1]>70&&readings[6].light.position[1]<110&&readings[18].light.position[1]>250&&readings[18].light.position[1]<290&&readings[12].light.position[2]<25&&readings[0].light.position[2]>90);
  check(name+' 回放與音樂共用時刻',Object.entries(readings).every(([h,r])=>r.simSec===Number(h)*3600&&r.sun.utcMs===Date.parse('2026-09-08T00:00:00+08:00')+r.simSec*1000)&&new Set(Object.values(readings).map(r=>r.music)).size>1,Object.fromEntries(Object.entries(readings).map(([h,r])=>[h,{phase:r.sun.phase,music:r.music}])));
  const after=await page.evaluate(()=>({sources:Object.keys(M.raw.getStyle().sources),layers:M.raw.getStyle().layers.map(l=>l.id),center:M.getCenter(),zoom:M.getZoom(),pitch:M.getPitch(),bearing:M.getBearing()}));
  check(name+' 換光照不新增圖層／來源／不移相機',JSON.stringify(before)===JSON.stringify(after));
  const count=await page.evaluate(()=>sunlight.stats.applications);await page.waitForTimeout(2100);
  check(name+' 暫停時不反覆更新樣式',(await page.evaluate(()=>sunlight.stats.applications))===count);
  await page.evaluate(()=>{delete window.__sunTestCtx;sunlight.update(true);});
  const tz=await page.evaluate(()=>({actual:new Date(sunlight.current.utcMs+8*3600e3).toISOString().slice(0,10),date:todayStr('Asia/Taipei')}));
  check(name+' 海外裝置仍用台北曆日',tz.actual===tz.date,tz);
  await page.evaluate(()=>{window.__sunTestCtx={date:'2026-09-08'};setSimSec(64800);});
  const baselineSky=clean(await page.evaluate(()=>M.raw.getSky()));
  for(const mode of ['dark','light','landscape']){
   await page.evaluate(mode=>{document.querySelector(`#msBasemapSeg [data-map="${mode}"]`).click();},mode);
   await page.waitForFunction(mode=>M.isStyleReady()&&M.getStyleKind()===mode&&sunlight.current&&!!M.raw.getSky(),mode,{timeout:45000});
   await page.waitForFunction(()=>window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,null,{timeout:45000});
   check(name+' '+mode+' 重載保留天空',JSON.stringify(clean(await page.evaluate(()=>M.raw.getSky())))===JSON.stringify(baselineSky));
   const light=await page.evaluate(()=>({actual:M.raw.getLight(),expected:sunlight.current.light}));
   check(name+' '+mode+' 3D 非同步載入不覆蓋光源',JSON.stringify(clean(light.actual))===JSON.stringify(light.expected),light.actual);
  }
  // 衛星以本機透明圖磚注入，不使用 token；走正式 setStyleKind(diff:false) 生命週期。
  await page.evaluate(()=>{M.setStyleKind('sun-test-sat',{version:8,sources:{sat:{type:'raster',tiles:['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFz8AAAAASUVORK5CYII='],tileSize:256}},layers:[{id:'sat',type:'raster',source:'sat'}]});});
  await page.waitForFunction(()=>M.isStyleReady()&&M.raw.getSky()?.['sky-color']===sunlight.current?.sky['sky-color']);
  check(name+' raster 衛星樣式重載保留天空',JSON.stringify(clean(await page.evaluate(()=>M.raw.getSky())))===JSON.stringify(baselineSky));
  await page.evaluate(()=>{sunlight.setEnabled(false);state.basemap='map';M.setStyleKind('sun-test-original',{version:8,sources:{},layers:[{id:'base',type:'background',paint:{'background-color':'#aaa'}}],sky:{'sky-color':'#123456','horizon-color':'#abcdef'},light:{anchor:'viewport',position:[1.2,220,45],color:'#ffeedd',intensity:.4}});});
  await page.waitForFunction(()=>M.isStyleReady()&&M.getStyleKind()==='sun-test-original');
  const original=await page.evaluate(()=>({sky:M.raw.getSky(),light:M.raw.getLight()}));
  await page.evaluate(()=>{sunlight.setEnabled(true);sunlight.setEnabled(false);});
  const restored=await page.evaluate(()=>({sky:M.raw.getSky(),light:M.raw.getLight()}));
  check(name+' 關閉還原底圖原有 sky/light',Object.entries({...skyDefaults,...original.sky}).every(([k,v])=>JSON.stringify(restored.sky[k])===JSON.stringify(v))&&JSON.stringify(clean(original.light))===JSON.stringify(clean(restored.light)),{original,restored});
  check(name+' 無頁面例外',errors.length===0,errors);
  await ctx.close();
  for(const width of (process.env.WIDTHS||'360,375,390,414,520,768').split(',').map(Number)){
   ctx=await browser.newContext({viewport:{width,height:900},isMobile:true,hasTouch:true,locale:'zh-TW',deviceScaleFactor:1});await ctx.addInitScript(init);page=await ctx.newPage();await boot(page);
   for(const full of [false,true]){
    await page.evaluate(full=>{document.body.classList.toggle('fs',full);M.resize();},full);
    await page.locator('#tabMore').tap();await page.locator('#sunlightRow').scrollIntoViewIfNeeded();
    const prior=await page.evaluate(()=>sunlight.enabled);await page.tap('#sunlightRow');
    const data=await page.evaluate(()=>{const el=document.getElementById('sunlightRow'),r=el.getBoundingClientRect(),hit=(b)=>{const q=b.getBoundingClientRect();return q.width>0&&q.height>0&&b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2));};
     const overlaps=[...document.querySelectorAll('button,input,select,a[href],[role="button"]')].filter(b=>b!==el&&!el.contains(b)&&hit(b)).filter(b=>{const q=b.getBoundingClientRect();return Math.min(q.right,r.right)-Math.max(q.left,r.left)>1&&Math.min(q.bottom,r.bottom)-Math.max(q.top,r.top)>1;}).map(b=>b.id||b.textContent.trim().slice(0,20));
     return {on:sunlight.enabled,aria:el.getAttribute('aria-checked'),hit:hit(el),height:r.height,overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1,store:localStorage.getItem('trainmap-sunlight'),share:new URL(buildShareUrl()).searchParams.get('sun')};});
    check(`${name} ${width} ${full?'全畫面':'一般'} 真觸控／可及／所有控件交集／無橫捲`,data.on!==prior&&data.aria===String(data.on)&&data.hit&&data.height>=44&&!data.overlaps.length&&!data.overflow&&data.store===(data.on?'1':'0')&&data.share===(data.on?'on':'off'),data);
    await page.tap('#sunlightRow');await page.tap('#moreClose');
   }
   await ctx.close();
  }
 }catch(e){check(name+' 完成驗收',false,String(e.stack||e));}finally{await browser.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
if(results.some(x=>!x.pass))process.exitCode=1;

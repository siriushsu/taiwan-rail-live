import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configFor} from './tainan_memory_config.mjs';
// 日期與資料夾參數化（不給參數＝9/12 封存版）：--date=…、--dir=…、--out=…，或環境變數 MEMORY_DATE／MEMORY_DIR／MEMORY_OUT。
//   dir 預設 memories/tainan-<date>；out 預設 9/12 → output/tainan-memory、其他日期 → output/tainan-memory-MMDD。CHROMIUM_CHANNEL 換 Chromium 的 channel（預設 chromium）。
//   入口是主站「更多」選單裡的一列，id 讀 tainan_memory_config.mjs 該日期的 verify.entry.id（9/12＝#tainanMemoryLink）；entry 為 null＝主站還沒有入口，直接報錯。
const opt=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)||process.env[`MEMORY_${name.toUpperCase()}`]||'';
const DATE=opt('date')||'2026-09-12',DIR=(opt('dir')||`memories/tainan-${DATE}`).replace(/^\/+|\/+$/g,''),OUTDIR=opt('out')||(DATE==='2026-09-12'?'output/tainan-memory':`output/tainan-memory-${DATE.slice(5).replace('-','')}`);
const ENTRY=configFor(DATE).verify.entry?.id;assert.ok(ENTRY,DATE+' 的 verify.entry 是 null：主站還沒有這個重播的入口，沒有東西可驗');
const base=process.env.VURL||'http://127.0.0.1:5244',rows=[];
fs.mkdirSync(OUTDIR,{recursive:true});
for(const [engine,type] of Object.entries({chromium,webkit})){
 console.log('開始',engine);
 // 瀏覽器測試一律無視窗(有視窗會搶焦點、把畫面切走)。Chromium 帶 channel:'chromium' 走真 GPU 的無視窗模式;預設 headless shell 是 SwiftShader 軟體算繪。
 const browser=await type.launch(engine==='chromium'?{channel:process.env.CHROMIUM_CHANNEL||'chromium',headless:true}:{headless:true});
 // 每個寬度開一個新的手機分頁，不在同一分頁上改尺寸：Playwright 在 isMobile 分頁 setViewportSize 之後，
 // (any-pointer: coarse) 有時會變成不成立且不恢復，頁面就把 mobile-shell 拿掉、1280 寬的列高變成桌面的 40 px
 // （2026-09-29 實測：origin/main 原版同樣時有時無，與產品無關）。
 const open=async(width,height)=>{const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
  await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-map3d','0');localStorage.setItem('ri-trains-enabled','0');});
  await page.goto(base+'/?g=all&lang=zh-TW');await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.trains?.length>0,null,{timeout:120000});
  await page.evaluate(()=>{state.playing=false;});return page;};
 // 直向：AGENTS.md 第 4 節的 360／375／414／768，加斷點之間的中間帶（389／400／900／1024 兩側）；橫向：max-height 500 的手機版式。
 for(const [width,height] of [[360,900],[375,900],[390,900],[414,900],[600,900],[768,900],[850,900],[960,900],[1100,900],[1280,900],[667,375],[844,390]]){
  const page=await open(width,height);
  for(const full of [false,true])for(const banner of [false,true]){
   await page.evaluate(({full,banner})=>{document.body.classList.toggle('fs',full);const e=document.getElementById('alertBanner');e.hidden=!banner;e.textContent=banner?'驗收：營運公告橫幅':'';},{full,banner});
   const more=await page.locator('#tabMore').isVisible()?'#tabMore':'#toolsFab';await page.tap(more);await page.waitForFunction(()=>document.body.classList.contains('tools-open'));await page.locator('#'+ENTRY).scrollIntoViewIfNeeded();
   const check=await page.evaluate(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),collisions=[];
    for(const o of document.querySelectorAll('button,a,input,select,summary,[role="button"]')){if(o===e||o.contains(e)||e.contains(o))continue;const b=o.getBoundingClientRect();if(!b.width||!b.height)continue;const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(h!==o&&!o.contains(h))continue;if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)collisions.push(o.id||o.textContent.slice(0,20));}
    return {hit:e===hit||e.contains(hit),height:r.height,inView:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,collisions};},ENTRY);
   assert.ok(check.hit&&check.inView&&!check.overflow&&check.height>=44,JSON.stringify({engine,width,vh:height,full,banner,check}));assert.deepEqual(check.collisions,[]);rows.push({engine,width,vh:height,full,banner,...check});fs.writeFileSync(OUTDIR+'/entry-results.json',JSON.stringify(rows,null,2));
   await page.tap('#moreClose');
  }
  await page.close();
 }
 const page=await open(390,844);
 // 真正從既有更多選單點入，不能只驗 href 存在。
 await page.evaluate(()=>{document.body.classList.remove('fs');document.getElementById('alertBanner').hidden=true;});
 await page.tap('#tabMore');await page.tap('#'+ENTRY);await page.waitForURL('**/'+DIR+'/index.html');try{await page.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});}catch(e){console.log('歷史頁載入狀態',engine,page.url(),await page.locator('#loading').textContent());throw e;}
 await page.tap('#live');await page.waitForURL(url=>url.pathname==='/'&&url.searchParams.get('at')==='22.99681,120.21295');
 await browser.close();
}
fs.writeFileSync(OUTDIR+'/entry-results.json',JSON.stringify(rows,null,2));console.log('正式介面入口通過：'+rows.length+' 組；含全畫面、營運橫幅、抽屜開啟與觸控往返。');

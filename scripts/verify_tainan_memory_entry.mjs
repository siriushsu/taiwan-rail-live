import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.VURL||'http://127.0.0.1:5244',rows=[];
for(const [engine,type] of Object.entries({chromium,webkit})){
 console.log('開始',engine);
 const browser=await type.launch({headless:engine!=='chromium'}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-map3d','0');});
 await page.goto(base+'/?scene=2d&g=all&lang=zh-TW');await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.trains?.length>0,null,{timeout:120000});
 await page.evaluate(()=>{state.playing=false;});
 for(const width of [360,375,390,414,768,1280]){
  await page.setViewportSize({width,height:900});
  for(const full of [false,true])for(const banner of [false,true]){
   await page.evaluate(({full,banner})=>{document.body.classList.toggle('fs',full);const e=document.getElementById('alertBanner');e.hidden=!banner;e.textContent=banner?'驗收：營運公告橫幅':'';},{full,banner});
   const more=await page.locator('#tabMore').isVisible()?'#tabMore':'#toolsFab';await page.tap(more);await page.waitForFunction(()=>document.body.classList.contains('tools-open'));await page.locator('#tainanMemoryLink').scrollIntoViewIfNeeded();
   const check=await page.evaluate(()=>{const e=document.getElementById('tainanMemoryLink'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),collisions=[];
    for(const o of document.querySelectorAll('button,a,input,select,summary,[role="button"]')){if(o===e||o.contains(e)||e.contains(o))continue;const b=o.getBoundingClientRect();if(!b.width||!b.height)continue;const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(h!==o&&!o.contains(h))continue;if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)collisions.push(o.id||o.textContent.slice(0,20));}
    return {hit:e===hit||e.contains(hit),height:r.height,inView:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,collisions};});
   assert.ok(check.hit&&check.inView&&!check.overflow&&check.height>=44,JSON.stringify({engine,width,full,banner,check}));assert.deepEqual(check.collisions,[]);rows.push({engine,width,full,banner,...check});fs.writeFileSync('output/tainan-memory/entry-results.json',JSON.stringify(rows,null,2));
   await page.tap('#moreClose');
  }
 }
 // 真正從既有更多選單點入，不能只驗 href 存在。
 await page.evaluate(()=>{document.body.classList.remove('fs');document.getElementById('alertBanner').hidden=true;});
 await page.setViewportSize({width:390,height:844});await page.tap('#tabMore');await page.tap('#tainanMemoryLink');await page.waitForURL('**/memories/tainan-2026-09-12/');try{await page.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});}catch(e){console.log('歷史頁載入狀態',engine,page.url(),await page.locator('#loading').textContent());throw e;}
 await page.tap('#live');await page.waitForURL(url=>url.pathname==='/'&&url.searchParams.get('at')==='22.99681,120.21295');
 await browser.close();
}
fs.writeFileSync('output/tainan-memory/entry-results.json',JSON.stringify(rows,null,2));console.log('正式介面入口通過：'+rows.length+' 組；含全畫面、營運橫幅、抽屜開啟與觸控往返。');

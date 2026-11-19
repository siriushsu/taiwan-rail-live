import {chromium, webkit} from 'playwright';
import assert from 'node:assert/strict';

const url=new URL('/?train=117&t=12:00',process.env.BASE_URL || 'http://127.0.0.1:5248');
const setting='#viewSettingsBody [data-proxy="immBtn"]';
for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
    for(const mobile of [true,false]) {
      const page=await browser.newPage({viewport:{width:mobile?390:1440,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,locale:'zh-TW'});
      const tap=selector=>mobile?page.tap(selector):page.click(selector);
      const entry=mobile?'#viewSettingsBtn':'.view-rail [data-view="angle"]';
      const label=engine+' '+(mobile?'手機':'桌面');
      const pending=new Set();
      page.on('request',r=>pending.add(r));
      page.on('requestfinished',r=>pending.delete(r));
      page.on('requestfailed',r=>pending.delete(r));
      await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
      let heldImage;
      if(mobile) {
        await page.route('**/delayed-boot-image.png',route=>{heldImage=route;});
        await page.addInitScript(()=>{
          if(sessionStorage.getItem('delayed-boot-image'))return;
          sessionStorage.setItem('delayed-boot-image','1');
          document.addEventListener('DOMContentLoaded',()=>{
            const image=new Image(1,1);
            image.src='/delayed-boot-image.png';
            document.body.append(image);
          },{once:true});
        });
      }
      async function openPage(reload) {
        // 載入事件還會等圖片等資產。用列車與觀看面板都可用的時間判斷開機完成。
        const start=Date.now(),options={waitUntil:'commit',timeout:60000};
        if(reload)await page.reload(options);
        else await page.goto(url.href,options);
        await page.waitForFunction(()=>typeof state!=='undefined' && state.ready && state.trains?.length>0 && window.railViewControls,null,{timeout:90000});
        console.log(label,reload?'重新載入':'開機','可操作',Date.now()-start,'ms');
      }
      async function toggle() {
        await tap(entry);
        await page.locator(setting).scrollIntoViewIfNeeded();
        await tap(setting);
      }
      async function exitImmersive() {
        await tap(entry);
        assert(await page.locator('#viewSettingsPanel').isVisible());
        assert.equal(await page.locator(setting).getAttribute('aria-pressed'),'true');
        await page.locator(setting).scrollIntoViewIfNeeded();
        await tap(setting);
        await page.waitForFunction(()=>!document.body.classList.contains('immersive'));
      }
      try {
        await openPage(false);
        await toggle();
        await page.waitForFunction(()=>document.body.classList.contains('immersive')&&!railViewControls.opened);
        await exitImmersive();
        if(mobile) {
          assert(heldImage,'延後的圖片請求已送出');
          assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation')[0].loadEventEnd),0);
          await heldImage.fulfill({status:204,body:''});
          await page.waitForLoadState('load');
        }
        console.log('PASS',label,'進入沉浸→重新打開觀看→退出沉浸');
        await toggle();
        await openPage(true);
        await page.waitForFunction(()=>document.body.classList.contains('immersive'));
        await exitImmersive();
        console.log('PASS',label,'重新載入後仍能退出沉浸');
      } catch(error) {
        console.error(label,'尚未完成的請求',Array.from(pending,r=>new URL(r.url()).pathname).slice(0,12));
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}

// BASE=http://127.0.0.1:5188 node scripts/verify_landscape_temple_scenes.mjs
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

for (const mobile of [false,true]) {
  const browser=mobile?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({isMobile:mobile,hasTouch:mobile,viewport:{width:mobile?390:1240,height:850}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
    const base=new URL(process.env.BASE||'http://127.0.0.1:5179');
    base.search=new URLSearchParams({map:'landscape',landscape:'new',opening:'0',g:'all','ls.auto':'0',place:'dajia',t:'11:00'});
    await page.goto(base.href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.railIslandLandscapeWeb?.api()?.scene?.getObjectByName('temple-halls')?.geometry?.attributes?.position?.count>1000,null,{timeout:60000});
    // 地景圖磚外圍的廟（near=0）11-24 起改由地景場景的 regional-places 網格畫（吃霧與日夜光），MapLibre 那層藏起來：
    // 兩種畫法都算數——圖磚裡有這座廟，而且 MapLibre 那層畫出它、或地景場景的廟網格正在畫
    await page.evaluate(()=>{window.regionalTemple=id=>M.raw.querySourceFeatures('taiwan-places',{sourceLayer:'temple'}).some(f=>f.properties.temple===id&&f.properties.near===0)&&
      (M.raw.queryRenderedFeatures({layers:['place-temple-regional']}).some(f=>f.properties.temple===id)||
       (m=>!!(m?.visible&&m.parent.visible))(window.railIslandLandscapeWeb.api().scene.getObjectByName('place-temple-regional')));});
    await page.evaluate(()=>M.raw.jumpTo({center:[120.304681,23.568099],zoom:18.5,pitch:51,bearing:17}));
    await page.waitForFunction(()=>regionalTemple('w1274037915'),null,{timeout:45000});
    await page.evaluate(()=>M.raw.jumpTo({center:[120.4421,22.75673],zoom:16.8,pitch:60,bearing:-67}));
    await page.waitForFunction(()=>M.raw.getLayer('landscape-foguang-buddha')?.implementation.ready &&
      regionalTemple('w1134404747'),null,{timeout:45000});
    if(mobile) {
      await page.locator('.maplibregl-ctrl-compass').first().tap();
      await page.waitForFunction(()=>Math.abs(M.raw.getBearing())<1);
    } else {
      const previous=await page.evaluate(()=>M.raw.getZoom());
      await page.locator('.maplibregl-ctrl-zoom-in').first().click();
      await page.waitForFunction(z=>M.raw.getZoom()>z+.2,previous);
    }
    await page.evaluate(()=>M.raw.jumpTo({center:[120.94448,24.00922],zoom:17.5,pitch:50,bearing:11}));
    await page.waitForFunction(()=>!M.raw.getLayer('landscape-foguang-buddha') &&
      M.raw.queryRenderedFeatures({layers:['place-temple-regional','place-temple-detail']})
       .some(f=>f.properties.temple==='w287892695' && f.properties.top>=136),null,{timeout:45000});
    assert.deepEqual(errors,[]);
    console.log(mobile?'WebKit 手機觸控':'Chromium 桌面','大甲實體網格、北港重簷、佛光山本館與大佛、中台金頂均已載入');
  } finally {await browser.close();}
}

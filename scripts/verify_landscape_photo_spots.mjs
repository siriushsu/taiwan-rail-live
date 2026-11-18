// 執行：BASE=http://127.0.0.1:5188 node scripts/verify_landscape_photo_spots.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,webkit} from 'playwright';

const assets=new URL('../landscape-web/models/duoliang/',import.meta.url);
const meta=JSON.parse(await readFile(new URL('model.json',assets),'utf8'));
const {file,sha256,vertexCount,drawGroups}=meta.lods.near;
const mesh=await readFile(new URL(file,assets));
assert.equal(createHash('sha256').update(mesh).digest('hex'),sha256);
assert.equal(mesh.length,vertexCount*24);
assert.equal(drawGroups.reduce((n,g)=>n+g.count,0),vertexCount);

for(const mobile of [false,true]){
  const browser=mobile?await webkit.launch({headless:true}):await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:mobile?375:1240,height:820},isMobile:mobile,hasTouch:mobile});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
    const url=new URL(process.env.BASE||'http://127.0.0.1:5179');
    url.search=new URLSearchParams({map:'landscape',landscape:'new',opening:'0',g:'all','ls.auto':'0',photo:'duoliang-station'});
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.railIslandLandscapeWeb?.revealed &&
      M.raw.getLayer('landscape-duoliang-station')?.implementation.ready && !state.playing,null,{timeout:60000});
    assert.ok(await page.evaluate(()=>Math.abs(M.raw.getCenter().lng-120.95890)<.00002));
    await page.evaluate(()=>railViewControls.open('angle'));
    const spot=page.locator('#viewScenes [data-scene="mudan"]');
    await spot.scrollIntoViewIfNeeded();
    assert.ok(await spot.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
    if(mobile) await spot.tap(); else await spot.click();
    const framed=()=>Math.abs(M.raw.getCenter().lng-121.85256)<.00002 &&
      Math.abs(M.raw.getBearing()-128.208)<.1 && Math.abs(M.raw.getPitch()-74)<.5 &&
      !M.raw.getLayer('landscape-duoliang-station') && !state.playing;
    await page.waitForFunction(framed,null,{timeout:15000});
    await page.waitForTimeout(1100);
    assert.ok(await page.evaluate(framed));
    if(!mobile){
      const canvas=await page.locator('.maplibregl-canvas').boundingBox();
      const x=canvas.x+canvas.width*.48,y=canvas.y+canvas.height*.48;
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+100,y+35,{steps:12});await page.mouse.up();
      await page.waitForFunction(()=>Math.abs(M.raw.getCenter().lng-121.85256)>.00003);
    }
    assert.deepEqual(errors,[]);
    console.log(mobile?'WebKit 觸控':'Chromium 拖曳','多良模型、取景方位與班表回放通過');
  }finally{await browser.close();}
}

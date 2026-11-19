// 對本機 dev_server（圖磚可用 LANDSCAPE_TILES 指向本機倉）實際載入模型與材質。
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {lightCalendar,lightLevel,modelHours} from '../rail-3d/environment/model-hours.js';
function level(id,hour,day,name='') {
  const cal=lightCalendar(2026,11,day);
  return lightLevel(modelHours(id,name),hour,cal.weekday,cal.monthlyMonday);
}
assert.equal(level('taipei-main-v1',.25,14),1); // 週五營運日跨到週六
assert.equal(level('taipei-main-v1',2,14),.12);
assert.equal(level('taipei-city-hall-bus',.99,16),1); // 週日跨到週一
assert.equal(level('taipei-city-hall-bus',1,16),.12);
assert.equal(level('tfam',20,14),1);
assert.equal(level('tfam',20,13),.12);
assert.equal(level('keelung-tower',19,23),1);
assert.equal(level('keelung-tower',19,30),.12);
assert.equal(level('tamsui-fort-san-domingo',16,2),.12);
assert.equal(level('taipei101-landmark-v1',23,19),.12);
assert.equal(level('taipei-stadium',18,19),1);
assert.equal(level('taipei-stadium',12,19),.12);
assert.equal(level('undocumented',2,19),.36);

const base=process.env.BASE_URL || 'http://127.0.0.1:5179/';
const www=new URL(base);
const cases=[
  ['presidential-office',121.512,25.04],
  ['taipei-main-v1',121.517,25.0478],
  ['national-theater',121.518,25.035],
];
for(const [name,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch(engine===chromium ? {channel:'chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']} : {headless:true});
  try {
    const page=await browser.newPage({viewport:{width:900,height:720},timezoneId:'Asia/Taipei'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(/shader error|validation_status/i.test(m.text()))errors.push(m.text());});
    await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
    await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.goto(new URL('?map=landscape&landscape=new&sun=on&g=all&at=25.04,121.512&z=17&t=02:00&ls.auto=0',www).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.railIslandLandscapeWeb?.revealed,null,{timeout:120000});
    for(const [id,lon,lat] of cases){
      await page.evaluate(([lon,lat])=>{state.playing=false;M.raw.jumpTo({center:[lon,lat],zoom:17,pitch:45});},[lon,lat]);
      await page.waitForFunction(id=>[...railIslandLandscapeWeb.api().tiles.values()].some(t=>t.stations?.some(s=>s.id===id && (s.nearG || !s.near))),id,{timeout:90000});
      const results=await page.evaluate(async id=>{
        const api=railIslandLandscapeWeb.api(),{renderer}=api;
        const s=[...api.tiles.values()].flatMap(t=>t.stations||[]).find(s=>s.id===id);
        const T=await import('/landscape-web/engine/vendor/three.module.js');
        const target=new T.WebGLRenderTarget(160,160);
        const results=[];
        for(const model of [s.far,s.nearG].filter(Boolean)){
          // 用同一部相機與環境光拍四次，只量模型點燈所造成的像素差。
          const group=model.clone();group.visible=true;group.traverse(o=>o.layers.set(0));
          const scene=new T.Scene();scene.background=new T.Color(0);
          scene.add(group,new T.AmbientLight(0xffffff,.04));
          const box=new T.Box3().setFromObject(group), center=box.getCenter(new T.Vector3());
          const extent=box.getSize(new T.Vector3()).length()*.53;
          const cam=new T.OrthographicCamera(-extent,extent,extent,-extent,.1,extent*10);
          cam.position.copy(center).add(new T.Vector3(1,.7,.8).multiplyScalar(extent*2));cam.lookAt(center);cam.updateMatrixWorld();
          const samples=[],prev=renderer.getRenderTarget(),previousClear=renderer.autoClear;
          try {
            renderer.autoClear=true;renderer.setRenderTarget(target);
            for(const h of [20,21,2,12]){
              api.setTime(h);renderer.render(scene,cam);
              const raw=new Uint8Array(160*160*4);renderer.readRenderTargetPixels(target,0,0,160,160,raw);
              let sum=0;for(let i=0;i<raw.length;i+=4)sum+=raw[i]+raw[i+1]+raw[i+2];
              samples.push(sum);
              if(id==='presidential-office' && h===2) {
                const detail=group.getObjectByName('presidential-facade');
                if(!detail || !group.children.some(o=>o!==detail && o.isMesh))
                  throw Error('總統府缺少立面細節或原建築');
                detail.visible=false;
                renderer.render(scene,cam);
                const before=new Uint8Array(raw.length);
                renderer.readRenderTargetPixels(target,0,0,160,160,before);
                detail.visible=true;
                let changed=0;
                for(let j=0;j<raw.length;j+=4) {
                  if(Math.abs(before[j]-raw[j])+Math.abs(before[j+1]-raw[j+1])+Math.abs(before[j+2]-raw[j+2])>5) changed++;
                }
                if(changed<100) throw Error('夜間總統府的立面在近景或遠景不可辨識：'+changed);
              }
            }
          } finally {renderer.setRenderTarget(prev);renderer.autoClear=previousClear;}
          results.push(samples);
        }
        target.dispose();api.setTime(state.simSec/3600);return results;
      },id);
      console.log(name,id,results);
      for(const [evening,close,late,day] of results){
        assert.ok(evening>day*1.15 && late>day, id+' 夜間在可見像素上有投光');
        if(id==='presidential-office')assert.ok(Math.abs(late-evening)<evening*.01);
        if(id==='taipei-main-v1')assert.ok(late<evening*.65);
        if(id==='national-theater')assert.ok(close<evening*.65 && Math.abs(close-late)<late*.01);
      }
    }
    // 利用網站正在播放的時鐘，跨過 21:00 那一分鐘的前後邊界。
    for (const [minute,open] of [[1259,true],[1260,false],[1259,true]]) {
      await page.evaluate(m=>{setSimSec(m*60);M.raw.triggerRepaint();},minute);
      await page.waitForFunction(open=>{
        const st=[...railIslandLandscapeWeb.api().tiles.values()].flatMap(t=>t.stations||[]).find(s=>s.id==='national-theater');
        const solid=st?.far.children.find(m=>m.material.customProgramCacheKey().includes('facade-wash'));
        return solid && (open ? solid.material.emissiveIntensity>.9 : solid.material.emissiveIntensity<.2);
      },open,{timeout:15000});
    }
    await page.evaluate(()=>{M.raw.jumpTo({center:[121.564,25.0377],zoom:16.5,pitch:45});setSimSec(2*3600);});
    await page.waitForFunction(()=>{
      const st=[...railIslandLandscapeWeb.api().tiles.values()].flatMap(t=>t.stations||[]).find(s=>s.id==='xinyi-civic-group');
      const values=st?.far.children.filter(m=>m.material.customProgramCacheKey().includes('facade-wash')).map(m=>m.material.emissiveIntensity);
      return values?.includes(1) && values.includes(.12) && values.includes(.36);
    },null,{timeout:90000});
    await page.close();
    const mobile=await browser.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true,timezoneId:'Asia/Taipei'});
    await mobile.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await mobile.goto(new URL('?g=all&scene=3d&map=landscape&landscape=old&sun=on&t=02:00&at=25.04,121.512&z=17',www).href,{waitUntil:'domcontentloaded'});
    await mobile.waitForFunction(()=>window.railIslandIntegration?.renderer?.getStations(),null,{timeout:60000});
    await mobile.evaluate(()=>{state.playing=false;M.raw.jumpTo({center:[121.512,25.04],zoom:17,pitch:45});});
    for(const width of [360,375,390,414,768]){
      await mobile.setViewportSize({width,height:812});
      await mobile.tap('#map',{position:{x:80,y:75}});
      await mobile.waitForFunction(()=>{
        const layer=railIslandIntegration.renderer.getStations(), light=id=>layer.getModel(id)?.parent?.children.find(o=>o.isDirectionalLight)?.intensity;
        return light('presidential-office')>1 && light('national-theater')<.3;
      },null,{timeout:45000});
      assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    console.log(name,'手機地景 360、375、390、414、768 px');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
}

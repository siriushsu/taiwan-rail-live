// BASE=http://127.0.0.1:5188 node scripts/verify_landscape_heritage_preview.mjs [chromium|webkit] [截圖目錄]
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import sharp from 'sharp';
import {drawHeritageHall} from '../landscape-web/heritage-geometry.mjs';
import {toTM2} from '../landscape-web/engine/proj/tm2.mjs';
const {sites}=JSON.parse(await readFile(new URL('../landscape-web/places/heritage.json',import.meta.url)));
assert.equal(sites.length,29);assert.equal(new Set(sites.map(s=>s.id)).size,29);
for(const site of sites)for(const p of site.parts){
  let triangles=0,sloped=0;
  drawHeritageHall(p,p.ring.map(ll=>toTM2(...ll)),(a,b,c)=>{
    assert.ok(a.concat(b,c).every(Number.isFinite));
    const t=[a,b,c].map(v=>v[1]);
    if(Math.min(...t)>=p.height-.001 && Math.max(...t)-Math.min(...t)>.025)sloped++;
    triangles++;
  });
  assert.ok(triangles>=10,site.name+p.name);
  if(!['flat','canopy','brickhouse','brick-arches'].includes(p.style))assert.ok(sloped>=4,site.name+p.name);
}
const mobile=process.argv[2]==='webkit',out=process.argv[3];
if(out)await mkdir(out,{recursive:true});
const browser=mobile?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,viewport:{width:mobile?375:1100,height:mobile?815:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');});
  const url=new URL(process.env.BASE||'http://127.0.0.1:5179');
  url.search=new URLSearchParams({map:'landscape',landscape:'new',g:'all',opening:'0','ls.auto':'0',t:'11:00',heritage:sites[0].id});
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#heritageSelect');
  const frame=page;
  await frame.waitForFunction(()=>window.__map?.getLayer('landscape-heritage-halls'),null,{timeout:90000});
  if(mobile)await page.locator('#heritageSelect').tap();
  await frame.evaluate(()=>{if(state.playing)togglePlay();});
  const hiddenSites=[];
  for(const [i,site] of sites.entries()){
    await page.selectOption('#heritageSelect',site.id);
    await frame.waitForFunction(({id,center})=>{
      const map=window.__map;
      if(!map || Math.abs(map.getCenter().lng-center[0])>.00012 || Math.abs(map.getCenter().lat-center[1])>.00012)return false;
      const l=map.getLayer('landscape-heritage-halls')?.implementation;
      return l?.key.split('.').includes(id) && l.models.some(({site,scene})=>site.id===id && scene.children.some(m=>m.isMesh && m.geometry.attributes.position.count>0));
    },site,{timeout:45000});
    // 實際切換同一廟宇在兩套引擎中的網格，檢查畫面中央真的有它畫出的像素。
    if(!mobile){
      await frame.waitForFunction(s=>{
        const web=window.railIslandLandscapeWeb,api=web?.api();
        if(!web?.active||!api)return true;
        const scene=api.scene.getObjectByName('heritage-'+s.id);
        const impl=__map.getLayer('landscape-heritage-halls')?.implementation;
        const meshes=impl?.models.find(r=>r.site.id===s.id)?.scene.children.filter(o=>o.isMesh)||[];
        return web.revealed && (meshes.every(m=>!api.index.tiles[m.userData.tile]) || !!scene);
      },site,{timeout:45000});
      await frame.waitForFunction(s=>Math.abs(__map.getZoom()-s.zoom)<.16,site,{timeout:18000});
      const clip=await frame.evaluate(()=>{
        const canvas=__map.getCanvas().getBoundingClientRect(),p=__map.project(__map.getCenter());
        return {x:Math.round(canvas.x+p.x-100),y:Math.round(canvas.y+p.y-96),width:200,height:192};
      });
      async function snap(visible){
        await frame.evaluate(({id,visible})=>{
          const layer=__map.getLayer('landscape-heritage-halls').implementation;
          layer.models.find(r=>r.site.id===id).scene.visible=visible;
          const api=window.railIslandLandscapeWeb?.api();
          api?.scene.traverse(o=>{if(o.name==='heritage-'+id)o.visible=visible;});
          if(api && railIslandLandscapeWeb.active && railIslandLandscapeWeb.revealed)window.__n64?.draw();
          __map.jumpTo({bearing:__map.getBearing()+(visible?.00001:-.00001)});
          __map.triggerRepaint();
        },{id:site.id,visible});
        await frame.waitForTimeout(110);
        return sharp(await frame.screenshot({clip})).removeAlpha().raw().toBuffer();
      }
      let changed=0;
      for(let attempt=0;attempt<3 && changed<28;attempt++){
        const hidden=await snap(false),shown=await snap(true),stable=await snap(true);
        changed=0;
        for(let j=0;j<shown.length;j+=3){
          const delta=Math.max(...[0,1,2].map(k=>Math.abs(shown[j+k]-hidden[j+k])));
          const drift=Math.max(...[0,1,2].map(k=>Math.abs(stable[j+k]-shown[j+k])));
          if(delta>24 && drift<7)changed++;
        }
        if(changed<28)await frame.waitForTimeout(400);
      }
      if(changed<28)hiddenSites.push([site.name,changed]);
      console.log(site.name,changed+' px');
    }
    if(out)await frame.locator('#map').screenshot({path:out+'/'+site.id+'.png',timeout:30000});
    assert.equal(await page.locator('#heritagePicker a').getAttribute('href'),site.source);
    if(i===0 || i===sites.length-1)console.log(mobile?'WebKit':'Chromium',site.name,'通過');
  }
  if(mobile)for(const width of [360,375,414,768]){
    await page.setViewportSize({width,height:815});
    const hit=await page.evaluate(()=>{
      const s=document.querySelector('#heritageSelect'),a=document.querySelector('#heritagePicker a'),l=document.querySelector('#heritagePicker label');
      const sr=s.getBoundingClientRect(),ar=a.getBoundingClientRect();
      const overlaps=[...document.querySelectorAll('.stage button,.stage a,.stage input,.stage select')].some(el=>{
        const r=el.getBoundingClientRect();
        return r.width>0 && r.height>0 && r.left<sr.right && sr.left<r.right && r.top<sr.bottom && sr.top<r.bottom;
      });
      return {overlaps,fits:document.documentElement.scrollWidth<=innerWidth && l.getBoundingClientRect().right<=sr.left && sr.right<=ar.left,hit:document.elementFromPoint(sr.x+sr.width/2,sr.y+sr.height/2)===s,target:sr.height>=44};
    });
    assert.deepEqual(hit,{overlaps:false,fits:true,hit:true,target:true});
    await page.locator('#heritageSelect').tap();
    const choice=sites[[360,375,414,768].indexOf(width)];
    await page.selectOption('#heritageSelect',choice.id);
    await frame.waitForFunction(site=>Math.abs(__map.getCenter().lng-site.center[0])<.0001,choice);

  }
  const m=frame.locator('#map');
  if(!mobile){
    const bounds=await m.boundingBox(),x=bounds.x+bounds.width*.55,y=bounds.y+bounds.height*.5;
    const from=await frame.evaluate(()=>__map.getCenter().toArray());
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y+20,{steps:12});await page.mouse.up();
    await frame.waitForFunction(ll=>Math.abs(window.__map.getCenter().lng-ll[0])>.00001,from);
  }
  assert.deepEqual(hiddenSites,[]);
  assert.deepEqual(errors,[]);console.log(sites.length+' 處切換定位與模型，互動完成');
}finally{await browser.close();}

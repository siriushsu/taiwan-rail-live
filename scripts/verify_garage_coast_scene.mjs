// 直接驗收使用者的斜角：讀取同一相機的世界投影，再到實際像素確認土地與海水仍在正確位置。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/',OUT='.superpowers/garage-coast-scene';mkdirSync(OUT,{recursive:true});
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settled=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const ready=p=>p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered&&document.querySelector('.g-fallback').hidden);
const sample=p=>p.locator('.g-view').evaluate(c=>{
 const a=JSON.parse(c.dataset.coastAnchors),ctx=c.getContext('2d');
 const rgb=point=>{const x=Math.round(point[0]),y=Math.round(point[1]);if(x<2||y<2||x>=c.width-2||y>=c.height-2)return null;const d=ctx.getImageData(x-1,y-1,3,3).data,s=[0,0,0];for(let i=0;i<d.length;i+=4)for(let k=0;k<3;k++)s[k]+=d[i+k]/9;return s;};
 return{width:c.width,height:c.height,projection:c.dataset.projection,cars:JSON.parse(c.dataset.formation),anchors:a,land:rgb(a.land),water:rgb(a.water),yaw:+c.dataset.yaw,elevation:+c.dataset.elevation};
});
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const p=await b.newPage({viewport:{width:1280,height:940},locale:'zh-TW'}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))errors.push(m.text());});
  await p.addInitScript(()=>{const RealDate=Date,at=RealDate.UTC(2026,8,8,4);window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[at]));}static now(){return at;}};localStorage.setItem('trainmap-howto-seen','1');});
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});
  await p.goto(BASE+'?garage=demo&lang=zh-TW');await ready(p);await p.click('[data-view="track"]');await ready(p);await p.waitForFunction(()=>document.querySelector('.g-view').dataset.mode==='track');await p.click('.g-auto');await settled(p);
  const poses=[];
  for(const [name,horizontal,vertical]of [['side',null,null],['left-low','.g-left','.g-down'],['left-high','.g-left','.g-up'],['right-low','.g-right','.g-down'],['right-high','.g-right','.g-up']]){
   await p.click('.g-reset-view');if(horizontal)await p.click(horizontal);if(vertical)await p.click(vertical);await settled(p);const s=await sample(p);poses.push(s);
   check(engine+' '+name+' 三節全部留在畫面內',s.projection==='perspective'&&s.cars.length===3&&s.anchors.island[1]>2&&s.cars.every(c=>c.left>1&&c.right<s.width-1&&c.top>1&&c.bottom<s.height-1),s.cars);
   check(engine+' '+name+' 世界投影位置實際畫出土地與海水',s.land&&s.water&&s.land[1]>s.land[0]+3&&s.land[1]>s.land[2]+3&&s.water[2]>s.water[0]+10,{land:s.land,water:s.water});
   await p.locator('.g-view').screenshot({path:OUT+'/'+engine+'-'+name+'.png'});
  }
  const slope=(s,a,b)=>(s.anchors[b][1]-s.anchors[a][1])/(s.anchors[b][0]-s.anchors[a][0]);
  const left=poses[2],right=poses[4];
  check(engine+' 斜角的岸線和鐵軌一起轉動，遠島也改變投影',slope(left,'railA','railB')*slope(left,'shoreA','shoreB')>0&&slope(right,'railA','railB')*slope(right,'shoreA','shoreB')>0&&slope(left,'railA','railB')*slope(right,'railA','railB')<0&&Math.abs(left.anchors.island[0]-right.anchors.island[0])>80);
  await p.click('.g-reset-view');await p.click('[data-filter="all"]');
  // 中間車尚未下載完成時返回近看，應取消工作；素材失敗也能原地重試三節編組。
  await p.click('[data-view="model"]');await ready(p);await p.selectOption('.g-model-select','r20');await ready(p);
  let release,notify,aborted=false;const requested=new Promise(r=>notify=r);
  p.on('requestfailed',r=>{if(r.url().endsWith('/juguang.bin.gz'))aborted=true;});
  await p.route('**/garage-blender-v1/juguang.bin.gz',async r=>{await new Promise(done=>{release=done;notify();});await r.continue().catch(()=>{});});
  await p.click('[data-view="track"]');await requested;await p.click('[data-view="model"]');await ready(p);release();await p.waitForTimeout(250);
  check(engine+' 返回近看取消客車下載，沒有殘留三節畫面',aborted&&await p.locator('.g-view').getAttribute('data-car-count')==='1');
  await p.unroute('**/garage-blender-v1/juguang.bin.gz');await p.route('**/garage-blender-v1/juguang.bin.gz',r=>r.fulfill({body:'invalid model'}));
  await p.click('[data-view="track"]');await p.waitForSelector('.g-retry:visible');check(engine+' 客車載入失敗保留重試與原有收藏',await p.locator('.g-count').textContent()==='6');
  await p.unroute('**/garage-blender-v1/juguang.bin.gz');await p.click('.g-retry');await ready(p);await settled(p);
  check(engine+' 重試後恢復完整三節編組',await p.locator('.g-view').getAttribute('data-car-count')==='3');
  if(await p.locator('.g-auto').getAttribute('aria-pressed')==='true')await p.click('.g-auto');
  for(const [id,expected]of [['emu3000',['emu3000','emu3000-mid','emu3000']],['e1000',['e1000','ppcoach','e1000']],['blue',['blue','bluecoach','bluecoach']],['700t',['700t','700t-mid','700t']],['ck124',['ck124','bluecoach','bluecoach']],['c381',['c381','c381-mid','c381']],['danhai',['danhai-section-0','danhai-section-2','danhai-section-4']],['alicoach',['alicoach','alicoach','alicoach']]]){
   await p.selectOption('.g-model-select',id);await ready(p);await settled(p);let s=await sample(p);
   check(engine+' '+id+' 使用正確車頭與中間車／客車／分節',JSON.stringify(s.cars.map(c=>c.model))===JSON.stringify(expected)&&s.cars.every(c=>c.left>1&&c.right<s.width-1),s.cars.map(c=>c.model));
   await p.click('.g-reverse');await settled(p);s=await sample(p);check(engine+' '+id+' 反向三節仍完整',s.cars.length===3&&s.cars.every(c=>c.left>1&&c.right<s.width-1&&c.top>1&&c.bottom<s.height-1));
   if(id==='emu3000'||id==='danhai')await p.locator('.g-view').screenshot({path:OUT+'/'+engine+'-'+id+'.png'});
   await p.click('.g-reverse');
  }
  await p.click('[data-view="model"]');await ready(p);check(engine+' 近看仍只有單車',await p.locator('.g-view').getAttribute('data-car-count')==='1');
  check(engine+' 沒有 JS 或 WebGL 材質錯誤',errors.length===0,errors);await p.close();
 }catch(e){check(engine+' scene',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/verification.json',JSON.stringify({date:new Date().toISOString(),results},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;

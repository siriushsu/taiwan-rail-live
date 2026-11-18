// 完整地圖重播。不改地圖的時鐘步進、列車數量或 GPU。可用 CDP 連接測試用 Android WebView。
import {chromium,webkit} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const mode=process.env.ENGINE||'chromium', endpoint=process.env.TEST_CDP, out=process.env.OUT;
const base=process.env.BASE||'http://127.0.0.1:8316/';
const url=new URL('?map=landscape&landscape=new&g=all&train=4022&t=09:44&scene=3d&z=18&weatherAt=2026-11-07T11%3A10%3A00%2B08%3A00&lang=zh-TW',base);
const section=process.env.SECTION || 'all';
if(section==='busy'){url.searchParams.set('t','09:09');url.searchParams.set('z','15');}
if(process.env.NO_FALLBACK==='1')url.searchParams.set('ls.auto','0'); // 長程壓測用，保留兩段自動降畫質
const browser=endpoint?await chromium.connectOverCDP(endpoint):mode==='webkit'?await webkit.launch():await chromium.launch({channel:'chrome'});
const context=endpoint?browser.contexts()[0]:await browser.newContext({...(process.env.SECTION==='protect'?{isMobile:true,hasTouch:true,deviceScaleFactor:2,viewport:{width:414,height:820}}:{viewport:{width:1080,height:730}}),timezoneId:'Asia/Taipei',locale:'zh-TW'});
const page=endpoint?context.pages()[0]:await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e.stack||e)));
page.on('console',m=>{if(/Shader Error|VALIDATE_STATUS false/.test(m.text()))errors.push(m.text().slice(0,1200));});
const assert=(v,msg)=>{if(!v)throw Error(msg);};
if(out)await mkdir(out,{recursive:true});
try {
  await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.railIslandLandscapeWeb?.revealed&&railIslandLandscapeWeb.weather?.rain>.25&&state.followTrain?.train==='4022',null,{timeout:120000});
  if(endpoint && await page.locator('#iabClose').isVisible()){
    const box=await page.locator('#iabClose').boundingBox(),cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }
  // 從真實股道定位進、出洞邊界，兩個方向在同一路段都應該能找到完整遮蔽。
  const trip=await page.evaluate(()=>{
    const tr=state.followTrain,a=tr.stops.find(s=>s.name==='福隆').depSec,b=tr.stops.find(s=>s.name==='石城').arrSec;
    function boundaries(rec,start,end){let entered=0,left=0;for(let t=start;t<=end;t++){
      const p=trainPosAt(rec,t),kind=p?.route?.level?.(p.chainageM)?.kind;
      if(!entered&&kind==='tunnel'&&p.lat>24.982&&p.lat<25.005)entered=t;
      if(entered&&kind==='surface'){left=t;break;}
    }return {entered,left};}
    let reverse;
    for(const other of state.trains){const f=other.stops.find(s=>s.name==='福隆'),s=other.stops.find(s=>s.name==='石城');
      if(!s||!f||s.depSec>=f.arrSec||f.arrSec-s.depSec>600)continue;
      const edges=boundaries(other,s.depSec,f.arrSec);
      if(edges.left-edges.entered>20){reverse={train:other.train,...edges};break;}
    }
    const active=state.trains.filter(x=>x!==tr&&trainPosAt(x,a+40));const moved=active.filter(x=>{
      const p=trainPosAt(x,a+40),q=trainPosAt(x,a+50);return q&&Math.hypot(q.lat-p.lat,q.lon-p.lon)>.0001;}).length;
    return {train:tr.train,start:a,end:b,reverse,...boundaries(tr,a,b),otherActive:active.length,otherMoving:moved,busy:tr.stops.find(s=>s.name==='七堵').depSec+15,group:state.deco,viewport:[innerWidth,innerHeight],buffer:[M.raw.getCanvas().width,M.raw.getCanvas().height]};
  });
  console.log('班表',JSON.stringify(trip));
  assert(trip.left-trip.entered>20&&trip.reverse&&trip.otherMoving>1,'缺少洞口、反向股道或其他行駛列車');
  const rows=[];
  const save=async complete=>{ if(out)await writeFile(out+'/量測.json',JSON.stringify({mode,trip,rows,errors,complete},null,2)); };
  // 同一格只切換雨絲這一批幾何。只計數真正寫入的像素，避免「有 draw call 但整批被近裁切面切掉」。
  const visibleRainPixels=()=>page.evaluate(()=>{
    const {scene,renderer,camera}=railIslandLandscapeWeb.api();
    const drops=scene.children.find(o=>o.isLineSegments&&o.material.uniforms?.amount);
    if(!drops?.visible)return 0;
    const canvas=document.createElement('canvas');
    canvas.width=renderer.domElement.width;canvas.height=renderer.domElement.height;
    const c=canvas.getContext('2d',{willReadFrequently:true});
    function pixels(){
      renderer.render(scene,camera);c.drawImage(renderer.domElement,0,0);
      return c.getImageData(0,0,canvas.width,canvas.height).data;
    }
    let clear;
    drops.visible=false;
    try{clear=pixels();}finally{drops.visible=true;}
    const wet=pixels();let changed=0;
    for(let i=0;i<wet.length;i+=4){
      if(Math.abs(wet[i]-clear[i])+Math.abs(wet[i+1]-clear[i+1])+Math.abs(wet[i+2]-clear[i+2])>12)changed++;
    }
    return changed;
  });
  const run=async(name,sec,z,wet,seconds)=>{
    // 手機跨站且換縮放時從真實分享入口載入，避免瞬間跳時又直接改 MapLibre 相機矩陣。
    if(endpoint){
      z=Math.round(z);
      if(await page.evaluate(z=>Math.abs(M.raw.getZoom()-z)>.25,z)){
        const next=new URL(url);
        const hm=[Math.floor(sec/3600),Math.floor(sec/60)%60].map(v=>String(v).padStart(2,'0')).join(':');
        next.searchParams.set('t',hm);next.searchParams.set('z',String(z+1));
        await page.goto(next.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForFunction(()=>window.railIslandLandscapeWeb?.revealed&&archiveWeather.frame&&state.followTrain?.train==='4022',null,{timeout:120000});
      }
    }
    await page.evaluate(({sec,z,wet})=>{
      const f=archiveWeather.frame;if(!window.rainReference)window.rainReference=f;
      archiveWeather.frame=wet?window.rainReference:{...window.rainReference,stations:[],radar:null};
      setSimSec(sec);
      if(Math.abs(M.raw.getZoom()-z)>.001 || Math.abs(M.raw.getPitch()-58)>.001) M.raw.jumpTo({zoom:z,pitch:58});
    },{sec,z,wet});
    await page.waitForFunction(()=>{const a=railIslandLandscapeWeb.api();
      return a.renderer.info.render.calls>8 && [...a.tiles.values()].some(t=>t.terrain?.some(m=>m.visible&&m.layers.isEnabled(0)));},null,{timeout:60000});
    await page.waitForTimeout(3800);
    const rainPixels=(name==='近景雨'||name==='遠景雨') ? await visibleRainPixels() : undefined;
    const r=await page.evaluate(seconds=>new Promise(resolve=>{
      const lw=railIslandLandscapeWeb,api=lw.api(),dt=[],t0=performance.now();let prev=0,streaks=0,cover=0,count=0;
      function frame(){
        const now=performance.now();if(prev)dt.push(now-prev);prev=now;
        const w=lw.weather;streaks=Math.max(streaks,w.streaks);cover+=w.cover;count++;
        if(now-t0<seconds*1000)return;
        M.raw.off('render',frame);
        const sorted=dt.slice().sort((a,b)=>a-b),q=p=>+(sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]||0).toFixed(1);
        resolve({elapsed:+((now-t0)/1000).toFixed(2),frames:dt.length,fps:+(1000*dt.length/Math.max(1,dt.reduce((a,b)=>a+b,0))).toFixed(1),p95:q(.95),p99:q(.99),over100:dt.filter(x=>x>100).length,streaks,cover:+(cover/count).toFixed(3),weather:w,mapRatio:M.raw.getPixelRatio(),nearby3d:railIslandIntegration.frame?.vehicles.length,train:state.followTrain?.train,sim:state.simSec,active:lw.active,tiles:[...api.tiles.values()].filter(x=>x.state==='ready').length,far:[...api.fars.values()].filter(x=>x.state==='ready').length});
      }
      M.raw.on('render',frame);
    }),seconds);
    // 在計時窗外直接讀兩張地圖畫布，避免離屏 WebView 的 CDP 截圖只存到 DOM。
    const picture=await page.evaluate(()=>new Promise(resolve=>{
      const lw=railIslandLandscapeWeb, raw=M.raw;
      raw.once('render',()=>{
        const terrain=lw.canvas, w=terrain.width,h=terrain.height,shot=document.createElement('canvas');
        shot.width=w;shot.height=h;const c=shot.getContext('2d');c.drawImage(terrain,0,0,w,h);
        const pix=c.getImageData(0,0,w,h).data,colors=new Set();
        for(let i=0;i<pix.length;i+=4*401)colors.add((pix[i]>>4)*256+(pix[i+1]>>4)*16+(pix[i+2]>>4));
        c.drawImage(raw.getCanvas(),0,0,w,h);
        const viewport=raw.getContainer(),sec=state.simSec;
        const visibleMoving=state.trains.filter(tr=>{
          const a=trainPosAt(tr,sec),b=trainPosAt(tr,sec-2);
          if(!a||!b||Math.hypot(a.lon-b.lon,a.lat-b.lat)<=.00002)return false;
          const p=raw.project([a.lon,a.lat]);
          return p.x>=0&&p.x<viewport.clientWidth&&p.y>=0&&p.y<viewport.clientHeight;
        }).length;
        resolve({colors:colors.size,visibleMoving,image:shot.toDataURL('image/jpeg',.85).split(',')[1]});
      });raw.triggerRepaint();
    }));
    r.rainPixels=rainPixels;r.colors=picture.colors;r.visibleMoving=picture.visibleMoving;
    if(out)await writeFile(out+'/'+name+'地圖.jpg',Buffer.from(picture.image,'base64'));
    rows.push({name,...r});await save(false);console.log(name,JSON.stringify(r));
    assert(r.active&&r.train==='4022'&&r.tiles+r.far>0&&r.colors>=14,'地景像素不足或跟車中斷');
    // 原生 Android WebView 的元素截圖會暫時改動裝置尺寸；上面已從實際繪製的兩張畫布取得手機畫面。
    if(out && !endpoint)await page.locator('#map').screenshot({path:out+'/'+name+'.jpg',timeout:20000});
    return r;
  };
  // 長程晴雨也能分開冷啟動，避免測試順序和手機熱節流混在一起。
  assert(['all','views','dry','rain','protect','busy'].includes(section),'未知的測試區段');
  if(section==='all' || section==='views'){
    const n=+(process.env.SECONDS_PER_VIEW||12);
    const near=await run('近景雨',trip.entered-18,17,true,n);
    const inside=await run('洞內',trip.entered+6,17,true,n);
    const exit=await run('南口雨',trip.left+2,17,true,n);
    const far=await run('遠景雨',trip.left+2,14.8,true,n);
    await run('遠景晴',trip.left+2,14.8,false,n);
    await run('近景晴',trip.entered-18,17,false,n);
    assert(near.rainPixels>0&&far.rainPixels===0,'雨絲沒有真正寫入近景像素，或遠景仍有雨絲');
    assert(near.streaks>0&&near.cover<.1&&inside.streaks===0&&inside.cover>.97&&exit.streaks>0&&exit.cover<.1&&far.streaks===0&&far.weather.mist>.12,'進出洞或遠霧不符');
  }
  if(section==='all'||section==='views'||section==='busy'){
    const n=+(process.env.SECONDS_PER_VIEW||12);
    await run('多車晴',trip.busy,14.15,false,n);
    const busyWet=await run('多車雨',trip.busy,14.15,true,n);
    assert(busyWet.nearby3d>2&&busyWet.visibleMoving>1&&busyWet.weather.rain>.1,'七堵多車取景沒有達到雨天與多車同時行駛');
  }
  if(section==='dry' || (section==='all'&&endpoint&&process.env.TRAVERSE)){
    await run('連續晴天',trip.entered-18,17,false,trip.left-trip.entered+36);
  }
  if(section==='rain' || (section==='all'&&process.env.TRAVERSE)){
    const r=await run('連續通過',trip.entered-18,17,true,trip.left-trip.entered+36);
    assert(r.weather.cover<.1&&r.cover>.25&&r.cover<.95&&r.streaks>0,'全程進出洞不符');
  }
  if(section==='protect'){
    // 觸控瀏覽器可重現慢幀。Android 實機只觀察硬體自然產生的負載。
    if(!endpoint)await page.evaluate(()=>{
      const end=performance.now()+45000;
      function slow(){
        if(!railIslandLandscapeWeb.active||performance.now()>end)return;
        const until=performance.now()+115;while(performance.now()<until){}
        requestAnimationFrame(slow);
      }requestAnimationFrame(slow);
    });
    await page.waitForFunction(()=>!railIslandLandscapeWeb.active,null,{timeout:60000});
    assert(await page.evaluate(()=>state.basemap==='landscape'&&state.followTrain?.train==='4022'&&state.playing),'低幀保底後沒有繼續跟車');
  }
  assert(errors.length===0,'瀏覽器錯誤 '+errors.join('；'));
  await save(true);
}finally{
  if(endpoint)await page.goto('about:blank').catch(()=>{});
  await browser.close();
}

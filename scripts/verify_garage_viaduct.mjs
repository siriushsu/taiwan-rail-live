import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createScene} from '../rail-3d/garage-scenes/viaduct.js';
const OUT='output/viaduct',URL='http://127.0.0.1:5253/prototypes/garage-viaduct/';mkdirSync(OUT,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));}
const state=p=>p.evaluate(()=>viaductPreview.state);
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

// 純數學：環線連續性直接在 Node 用同一份 viaduct.js 驗證，不需要瀏覽器。
{
 const probe=createScene(),path=probe.path,N=2000,expectedStep=path.length/N;
 let maxStep=0,prev=path.sample(0);
 for(let i=1;i<=N;i++){const p=path.sample(i/N*path.length);maxStep=Math.max(maxStep,Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z));prev=p;}
 check('環線取樣連續無跳動',maxStep<expectedStep*3,{maxStep,expectedStep});
 const a=path.sample(0),b=path.sample(path.length),closureGap=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 check('環線繞完一圈回到起點',closureGap<1e-9,{a,b,closureGap});
 probe.dispose();
}

for(const [engine,type] of Object.entries({chromium,webkit})){
 const b=await type.launch({headless:true});
 try{
  const p=await b.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,isMobile:true,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(URL);await p.waitForFunction(()=>window.viaductPreview?.state.ready,null,{timeout:90000});await p.tap('#play');await settle(p);

  check(engine+' EMU3000 三節雙駕駛室編組',JSON.stringify((await state(p)).poses.map(c=>c.id))===JSON.stringify(['emu3000','emu3000-mid','emu3000']));

  // 三節車體的實際像素：跟 alishan 一樣量真實像素，不是讀設定值。
  const pixel=await p.evaluate(async()=>{const api=viaductPreview,c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d'),read=async()=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};api.trainVisible(false);const empty=await read();api.trainVisible(true);const full=await read();return api.state.bounds.map(b=>{let changed=0;for(let y=Math.max(0,Math.floor(b.top));y<Math.min(c.height,b.bottom);y++)for(let x=Math.max(0,Math.floor(b.left));x<Math.min(c.width,b.right);x++){const i=(y*c.width+x)*4;if(Math.abs(full[i]-empty[i])+Math.abs(full[i+1]-empty[i+1])+Math.abs(full[i+2]-empty[i+2])>25)changed++;}return changed;});});
  check(engine+' 三節車體的實際像素',pixel.every(n=>n>30),pixel);

  // 三個時段：不只比對變數，抓縮小網格的平均色比對實際畫面差異。
  const swatch=()=>p.evaluate(()=>{const c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');return new Promise(async res=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data,gx=24,gy=16,cw=Math.floor(c.width/gx),ch=Math.floor(c.height/gy),grid=[];for(let j=0;j<gy;j++)for(let i=0;i<gx;i++){let r=0,g=0,bl=0,n=0;for(let y=j*ch;y<(j+1)*ch;y+=3)for(let x=i*cw;x<(i+1)*cw;x+=3){const idx=(y*c.width+x)*4;r+=data[idx];g+=data[idx+1];bl+=data[idx+2];n++;}grid.push(Math.round(r/n),Math.round(g/n),Math.round(bl/n));}res(grid);});});
  const grids={};
  for(const period of ['day','sunset','night']){await p.tap('button[data-period="'+period+'"]');await settle(p);await p.screenshot({path:`${OUT}/${engine}-${period}.png`});grids[period]=await swatch();check(engine+' '+period+' 切換',(await state(p)).period===period);}
  function gridDiff(a,c){let diff=0;for(let i=0;i<a.length;i+=3){if(Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2])>15)diff++;}return diff;}
  const daySunset=gridDiff(grids.day,grids.sunset),dayNight=gridDiff(grids.day,grids.night),sunsetNight=gridDiff(grids.sunset,grids.night);
  check(engine+' 三時段實際畫面互不相同',daySunset>40&&dayNight>40&&sunsetNight>40,{daySunset,dayNight,sunsetNight,cells:24*16});

  // 全景與跟車兩個視角都能完整看到三節車。跟車視角一律跟著車走；全景視角在環線四個代表位置各驗一次。
  await p.tap('button[data-period="day"]');await p.tap('[data-view="train"]');await settle(p);
  check(engine+' 跟車視角三節完整構圖',await p.evaluate(()=>{const c=document.querySelector('#scene');return viaductPreview.state.bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);}));
  await p.screenshot({path:`${OUT}/${engine}-follow.png`});
  await p.tap('[data-view="world"]');await settle(p);
  const worldFits=await p.evaluate(async()=>{const api=viaductPreview,rows=[];for(const frac of [0,.25,.5,.75]){api.setTime(frac*api.state.pathLength/api.state.speed);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=document.querySelector('#scene'),bounds=api.state.bounds,ok=bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);rows.push({frac,ok,bounds});}return rows;});
  check(engine+' 全景視角環線四個位置都完整看到三節車',worldFits.every(r=>r.ok),worldFits.map(r=>({frac:r.frac,ok:r.ok})));
  await p.screenshot({path:`${OUT}/${engine}-world.png`});

  // 看月台：車廂應停在 s=0（月台中心），且行駛暫停。
  await p.evaluate(()=>viaductPreview.setTime(9));await p.tap('#platform');await settle(p);
  check(engine+' 看月台停在月台中心且暫停',(await state(p)).distance===0&&(await state(p)).running===false,await state(p));

  // 看月台從跟車視角按下去也要看得見車：月台雨棚正好擋在跟車鏡頭與車之間。
  // 判準用車窗暗色像素，遮擋狀態量到的是 0，等於自帶正向對照。
  const darkInBounds=pg=>pg.evaluate(()=>{
   const c=document.querySelector('#scene'),cv=document.createElement('canvas');cv.width=c.width;cv.height=c.height;
   const g=cv.getContext('2d');g.drawImage(c,0,0);
   const bs=viaductPreview.state.bounds;
   const L=Math.max(0,Math.min(...bs.map(x=>x.left))),R=Math.min(c.width,Math.max(...bs.map(x=>x.right)));
   const T=Math.max(0,Math.min(...bs.map(x=>x.top))),B=Math.min(c.height,Math.max(...bs.map(x=>x.bottom)));
   if(R<=L||B<=T)return{view:c.dataset.view,dark:0};
   const d=g.getImageData(L,T,R-L,B-T).data;let dark=0;
   for(let i=0;i<d.length;i+=4)if(d[i]<70&&d[i+1]<80&&d[i+2]<90)dark++;
   return{view:c.dataset.view,dark};
  });
  await p.tap('[data-view="train"]');await p.tap('#reset');await settle(p);
  const occluded=await darkInBounds(p);
  await p.tap('#platform');await settle(p);
  const revealed=await darkInBounds(p);
  check(engine+' 看月台從跟車視角按下也看得見車',revealed.view==='world'&&revealed.dark>0&&occluded.dark===0,{occluded,revealed});

  // 參數化證明：在頁面裡直接 import viaduct.js，用不同參數各建一次場景。
  const paramProof=await p.evaluate(async()=>{
   const mod=await import('../../rail-3d/garage-scenes/viaduct.js');
   function countTriangles(group){let total=0;group.traverse(o=>{if(o.isMesh){const g=o.geometry,idx=g.index,tris=(idx?idx.count:g.attributes.position.count)/3;total+=tris*(o.isInstancedMesh?o.count:1);}});return total;}
   const configs=[{name:'default',params:{}},{name:'shortPlatform',params:{platformLength:9}},{name:'fieldsSimple',params:{backdrop:'fields',canopy:'simple'}},{name:'defaultAgain',params:{}}];
   const out=[];
   for(const cfg of configs){
    const s=mod.createScene(cfg.params),triangles=countTriangles(s.group),childCountBefore=s.group.children.length,paramsEcho=JSON.parse(JSON.stringify(s.params));
    s.dispose();
    out.push({name:cfg.name,triangles,paramsEcho,childCountBefore,childCountAfter:s.group.children.length});
   }
   return out;
  });
  const [pDefault,pShort,pFields,pDefaultAgain]=paramProof;
  check(engine+' 參數化：三組三角形總數彼此不同',new Set([pDefault.triangles,pShort.triangles,pFields.triangles]).size===3,paramProof.map(x=>({name:x.name,triangles:x.triangles})));
  check(engine+' 參數化：相同參數兩次結果相同（正向對照，證明判準分辨得出差異）',pDefault.triangles===pDefaultAgain.triangles&&pDefault.triangles>0,{default:pDefault.triangles,defaultAgain:pDefaultAgain.triangles});
  check(engine+' 參數化：scene.params 反映傳入值',pShort.paramsEcho.platformLength===9&&pFields.paramsEcho.backdrop==='fields'&&pFields.paramsEcho.canopy==='simple'&&pDefault.paramsEcho.platformLength===19&&pDefault.paramsEcho.backdrop==='coast'&&pDefault.paramsEcho.canopy==='modern',paramProof.map(x=>x.paramsEcho));
  check(engine+' 參數化：四組都能 dispose 且不留下幾何',paramProof.every(x=>x.childCountBefore>0&&x.childCountAfter===0),paramProof.map(x=>({before:x.childCountBefore,after:x.childCountAfter})));

  await p.tap('[data-view="world"]');await p.evaluate(()=>viaductPreview.setTime(4));
  for(const width of [360,375,390,414,520,768,1280]){await p.setViewportSize({width,height:900});await settle(p);await p.tap('#in');await p.tap('#out');await p.tap('#reset');await settle(p);const ui=await p.evaluate(()=>{const els=[...document.querySelectorAll('button,a')].filter(e=>e.getClientRects().length),bad=[],overlap=[];for(const e of els){const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!e.contains(hit)||r.width<43||r.height<43)bad.push(e.textContent);}for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([els[i].textContent,els[j].textContent]);}return{bad,overlap,overflow:document.documentElement.scrollWidth>innerWidth};});check(engine+' '+width+' 真觸控與可及性',!ui.bad.length&&!ui.overlap.length&&!ui.overflow,ui);}

  const mem=(await state(p)).memory;for(let i=0;i<3;i++){await p.tap('[data-view="train"]');await p.tap('button[data-period="night"]');await p.tap('[data-view="world"]');await p.tap('button[data-period="day"]');}await settle(p);check(engine+' 切換不累積資源',JSON.stringify(mem)===JSON.stringify((await state(p)).memory),{before:mem,after:(await state(p)).memory});
  const draws=(await state(p)).draws;await p.waitForTimeout(250);check(engine+' 暫停不重繪',(await state(p)).draws===draws);
  check(engine+' 無 JS／WebGL 錯誤',errors.length===0,errors);
  await p.close();

  const mobile=await b.newPage({viewport:{width:375,height:900},reducedMotion:'reduce',isMobile:true,hasTouch:true});await mobile.goto(URL);await mobile.waitForFunction(()=>window.viaductPreview?.state.ready,null,{timeout:90000});check(engine+' 手機預設跟車且減少動態停止',!(await state(mobile)).running&&(await state(mobile)).view==='train');await mobile.evaluate(()=>viaductPreview.setTime(4));await mobile.screenshot({path:`${OUT}/${engine}-mobile.png`,fullPage:true});await mobile.close();
 }catch(e){check(engine+' 驗證流程',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));
const fails=results.filter(r=>!r.pass).length,passes=results.length-fails;
console.log(`\n共 ${results.length} 項：PASS ${passes}，FAIL ${fails}`);
if(fails)process.exitCode=1;

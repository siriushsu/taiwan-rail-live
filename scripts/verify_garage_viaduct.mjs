import {chromium,webkit} from 'playwright';
import {panChecks} from './lib/garage_pan_checks.mjs';
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
  // 判準用車窗暗色像素：遮擋狀態要比露出狀態少一個數量級以上（道床的軌腰在陰影裡會入鏡一兩個像素，所以不是恰為 0），露出狀態要大於 0。
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
  check(engine+' 看月台從跟車視角按下也看得見車',revealed.view==='world'&&revealed.dark>0&&occluded.dark<=revealed.dark*.1,{occluded,revealed});

  // 道床與電車線：對車模量出來的輪對位置與車頂，不對程式碼裡的常數。
  const track=await p.evaluate(async()=>{
   const T=await import('/rail-3d/vendor/three.module.js'),V=await import('/rail-3d/garage-scenes/viaduct.js'),M=await import('/rail-3d/garage-model.js');
   const sc=V.createScene(),g=sc.group,path=sc.path,pl=sc.params.platformLength,deckZ=sc.params.pierHeight,q0=path.sample(0);
   const byName=n=>g.children.find(o=>o.name===n),inst=n=>g.children.filter(o=>o.isInstancedMesh&&o.material.name===n);
   // 車模：原點＝輪底；底部頂點最密的 |y| 桶＝輪對位置；最高頂點＝車頂。
   const prim=await M.loadGarageModel('emu3000'),t=await M.createConsist('emu3000',prim),car=t.cars[1].car;car.updateMatrixWorld(true);
   const hist={},v=new T.Vector3();let roof=-Infinity;
   car.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i);o.localToWorld(v);const z=v.z-car.position.z;roof=Math.max(roof,z);if(z<.4){const k=Math.round(Math.abs(v.y)*20)/20;hist[k]=(hist[k]||0)+1;}}});
   const wheel=+Object.entries(hist).sort((a,b)=>b[1]-a[1])[0][0];
   // 鋼軌：軌頭網格兩段各取 s=0 那兩個頂點算中線偏移；軌腰網格最低點＝軌底。
   const head=byName('rail-head').geometry.attributes.position,web=byName('rail-web').geometry.attributes.position,per=head.count/2;
   const off=i=>(head.getY(i)+head.getY(i+1))/2-q0.y;
   const railOffsets=[off(0),off(per)],railTop=head.getZ(0);let railBottom=Infinity;for(let i=0;i<web.count;i++)railBottom=Math.min(railBottom,web.getZ(i));
   // 枕木：數量由環線長度推導，每根都落在環線上，頂面托住軌底。
   const m=new T.Matrix4(),pos=new T.Vector3(),rot=new T.Quaternion(),scl=new T.Vector3(),samples=[];
   for(let i=0;i<4000;i++){const s=path.sample(i/4000*path.length);samples.push([s.x,s.y]);}
   const [ties]=inst('sleeper');let offPath=0,tieTop=null;
   for(let i=0;i<ties.count;i++){ties.getMatrixAt(i,m);m.decompose(pos,rot,scl);let best=Infinity;for(const [x,y] of samples)best=Math.min(best,Math.hypot(x-pos.x,y-pos.y));if(best>.03)offPath++;tieTop=pos.z+scl.z/2;}
   // 電車線高度；電桿（高度 >1 的那種方塊）不在月台側。
   const wireZ=byName('contact-wire').geometry.attributes.position.getZ(0);
   let mastCount=0,mastsOnPlatformSide=0;for(const mm of inst('mast'))for(let i=0;i<mm.count;i++){mm.getMatrixAt(i,m);m.decompose(pos,rot,scl);if(scl.z<1)continue;mastCount++;if(Math.abs(pos.x)<pl/2+.6&&pos.y<q0.y)mastsOnPlatformSide++;}
   // 月台外側那段不砌牆：牆＝concrete 批次裡 y 厚 .16、高 .95 的方塊。月台範圍外的前直線要有牆，當正向對照。
   let wallInPlatform=0,wallElsewhere=0;for(const w of inst('concrete'))for(let i=0;i<w.count;i++){w.getMatrixAt(i,m);m.decompose(pos,rot,scl);if(Math.abs(scl.y-.16)>1e-6||Math.abs(scl.z-.95)>1e-6||pos.y>q0.y-2)continue;if(Math.abs(pos.x)<pl/2)wallInPlatform++;else if(Math.abs(pos.x)<19)wallElsewhere++;}
   sc.dispose();t.dispose();prim.dispose();
   return{wheel,roof,railOffsets,railTop,railBottom,pathZ:q0.z,tieCount:ties.count,tieExpected:Math.ceil(path.length/.42),offPath,tieTop,wireZ,canopyUnder:deckZ-.05+2.92,mastCount,mastsOnPlatformSide,wallInPlatform,wallElsewhere};
  });
  check(engine+' 軌距對齊車模輪對（輪對位置每次從車模頂點重量）',track.railOffsets[0]<0&&track.railOffsets[1]>0&&track.railOffsets.every(o=>Math.abs(Math.abs(o)-track.wheel)<.06),{wheel:track.wheel,railOffsets:track.railOffsets});
  check(engine+' 軌頂托住輪底、軌底坐在枕木上',Math.abs(track.railTop-track.pathZ)<1e-6&&Math.abs(track.railBottom-track.tieTop)<1e-6,{railTop:track.railTop,pathZ:track.pathZ,railBottom:track.railBottom,tieTop:track.tieTop});
  check(engine+' 枕木鋪滿整圈且根根落在環線上',track.tieCount===track.tieExpected&&track.offPath===0,{tieCount:track.tieCount,tieExpected:track.tieExpected,offPath:track.offPath});
  check(engine+' 電車線在車頂之上、雨棚之下',track.wireZ-(track.pathZ+track.roof)>.3&&track.wireZ<track.canopyUnder,{wireZ:track.wireZ,roofZ:track.pathZ+track.roof,canopyUnder:track.canopyUnder});
  check(engine+' 電桿全在內側、月台外側那段不砌牆（範圍外有牆＝正向對照）',track.mastCount>0&&track.mastsOnPlatformSide===0&&track.wallInPlatform===0&&track.wallElsewhere>0,{mastCount:track.mastCount,mastsOnPlatformSide:track.mastsOnPlatformSide,wallInPlatform:track.wallInPlatform,wallElsewhere:track.wallElsewhere});

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

  // 夜燈與月台底下（09-12 使用者：「晚上路燈跟車站也都要有光」「高架車站下面看起來太空」）。在全景頁量真實像素；車先開到後直線，站區不被車擋。
  {
   const sample=pts=>p.evaluate(async pts=>{const c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d'),im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;return pts.map(pt=>{const q=viaductPreview.project(pt),i=(Math.round(q.y)*c.width+Math.round(q.x))*4;return{x:+q.x.toFixed(1),y:+q.y.toFixed(1),r:d[i],g:d[i+1],b:d[i+2],l:+(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]).toFixed(1)};});},pts);
   const facts=await p.evaluate(async()=>{const S=await import('../../rail-3d/garage-scenes/viaduct.js'),T=await import('../../rail-3d/vendor/three.module.js'),s=S.createScene(),g=s.group,M=new T.Matrix4(),pos=new T.Vector3(),rot=new T.Quaternion(),scl=new T.Vector3();
    const inst=[];for(const o of g.children)if(o.isInstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,M);M.decompose(pos,rot,scl);inst.push({m:o.material.name||'',x:pos.x,y:pos.y,z:pos.z,sz:scl.z});}
    const lamps=g.children.filter(o=>o.isPointLight).map(l=>({name:l.name,x:l.position.x,y:l.position.y,z:l.position.z}));
    const poolMesh=g.children.find(o=>o.isInstancedMesh&&o.material.name==='lamp-pool');
    const intensity=period=>{s.update(0,period);return{I:g.children.filter(o=>o.isPointLight).map(l=>l.intensity),pool:poolMesh?+poolMesh.material.opacity.toFixed(2):null,poolVisible:poolMesh?.visible};};
    const D=intensity('day'),U=intensity('sunset'),N=intensity('night'),dayI=D.I,sunsetI=U.I,nightI=N.I;
    const a=s.anchors,groundZ=a.station[2]-1.6,platZ=a.platform[2]-.4,py=a.platform[1]+1.5,pl=s.params.platformLength,deckY=s.path.sample(0).y;
    const hall=inst.filter(b=>Math.abs(b.x)<pl/2&&b.y>py-3&&b.y<py&&b.z-b.sz/2<groundZ+.1&&b.z+b.sz/2>platZ-.15);   // 月台腳印底下、從地面立到月台底的方塊＝站體
    const cars=inst.filter(b=>b.m==='car'&&Math.abs(b.y-deckY)<3.2&&Math.abs(b.x)<pl/2+2),scooters=inst.filter(b=>b.m==='scooter'&&Math.abs(b.y-deckY)<3.2),paving=inst.filter(b=>b.m==='paving'&&Math.abs(b.y-deckY)<.5);
    const heads=inst.filter(b=>b.m==='lamp'&&b.y<a.station[1]-2),pools=inst.filter(b=>b.m==='lamp-pool'),streetPools=pools.filter(b=>b.y<a.station[1]-2);   // 路燈燈頭與路面光池：在站房前那條馬路上
    const out={lamps,dayI,sunsetI,nightI,pool:{day:D.pool,sunset:U.pool,night:N.pool,dayVisible:D.poolVisible,nightVisible:N.poolVisible},heads,pools:pools.length,streetPools:streetPools.length,groundZ,platZ,py,pl,deckY,stationX:a.station[0],stationY:a.station[1],hall:hall.length,cars:cars.length,scooters:scooters.length,paving:paving.length,length:s.path.length};s.dispose();return out;});
   const street=facts.heads,plat=facts.lamps.filter(l=>l.name.startsWith('platform-lamp')),entrance=facts.lamps.find(l=>l.name==='station-entrance');
   const ys=street.map(l=>l.y),xs=street.map(l=>l.x);
   check(engine+' 夜燈配置：馬路一排路燈（燈頭＋路面光池）、月台燈、站房入口燈；白天全暗、黃昏半亮、夜裡全亮；點光源不超過八盞（多了 headless 開頁會掉 context）',street.length>=6&&Math.max(...ys)-Math.min(...ys)<.1&&Math.max(...xs)-Math.min(...xs)>30&&street.every(l=>l.z>facts.groundZ+2.4)&&facts.streetPools>=6&&facts.pools>=8&&plat.length>=2&&!!entrance&&facts.lamps.length<=8&&facts.dayI.every(i=>i===0)&&facts.nightI.every(i=>i>0)&&facts.sunsetI.every((i,k)=>i>0&&i<facts.nightI[k])&&facts.pool.day===0&&facts.pool.dayVisible===false&&facts.pool.night>.3&&facts.pool.nightVisible===true&&facts.pool.sunset>0&&facts.pool.sunset<facts.pool.night,{street:street.length,streetPools:facts.streetPools,pools:facts.pools,platform:plat.length,entrance:!!entrance,pointLights:facts.lamps.length,dayMax:Math.max(...facts.dayI),nightMin:Math.min(...facts.nightI),pool:facts.pool});
   await p.tap('[data-view="world"]');await p.tap('button[data-period="day"]');if((await state(p)).running)await p.tap('#play');await p.evaluate(t=>viaductPreview.setTime(t),facts.length/2/2.1);await p.tap('#reset');await settle(p);
   const G=facts.groundZ,[lampA,lampB]=[...street].sort((a,b)=>a.x-b.x);   // 最左兩盞：中間沒停車、離站房遠
   const road=[[lampA.x,lampA.y-.1,G+.05],[(lampA.x+lampB.x)/2,lampA.y-.1,G+.05]];                 // 路燈正下方的路面 vs 兩盞之間
   const station=[facts.stationX,facts.stationY-2.9,G+.95];                                         // 站房面街那面的一樓玻璃
   const platPt=[plat[0].x,facts.py-2.3,facts.platZ+.44],pier=[13.6,facts.deckY-.76,G+2.0];         // 月台面（燈下）與遠處一根橋墩正面（沒燈）當基準
   const hallPt=[7.0,facts.py-2.87,G+2.1];                                                            // 站體面街那面、站房右邊露出的牆面
   const day=await sample([...road,station,platPt,pier,hallPt]);await p.tap('button[data-period="night"]');await settle(p);const night=await sample([...road,station,platPt,pier,hallPt]);await p.tap('button[data-period="day"]');await settle(p);
   const pool=s=>s[0].l/Math.max(1,s[1].l),platRatio=s=>s[3].l/Math.max(1,s[4].l);
   check(engine+' 夜裡路燈底下有光池：路燈正下方的路面對兩盞之間，晚上比白天亮出一截',pool(night)>pool(day)*1.25&&pool(day)<1.1&&night[0].l>night[1].l*1.25,{poolDay:+pool(day).toFixed(2),poolNight:+pool(night).toFixed(2),underNight:night[0].l,betweenNight:night[1].l});
   check(engine+' 夜裡站房與月台有光：站房玻璃暖亮、月台面對橋墩的亮度比晚上比白天高',night[2].l>day[2].l*1.25&&night[2].r>night[2].b&&platRatio(night)>platRatio(day)*1.2,{stationDay:day[2],stationNight:night[2],platDay:+platRatio(day).toFixed(2),platNight:+platRatio(night).toFixed(2)});
   check(engine+' 月台底下不是空的：站體從地面撐到月台底、橋下鋪面停車場有車有機車、正面看得到站體牆面不是草地',facts.hall>=1&&facts.paving>=1&&facts.cars>=5&&facts.scooters>=5&&day[5].l>120&&!(day[5].g>day[5].r+8&&day[5].g>day[5].b+20),{hall:facts.hall,paving:facts.paving,cars:facts.cars,scooters:facts.scooters,hallPixel:day[5]});
  }

  await panChecks({b,engine,URL,api:'viaductPreview',check,settle});   // 鏡頭平移（四頁共用的判準，在自己開的桌面頁與觸控頁上量）
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

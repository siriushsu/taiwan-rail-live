import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createScene} from '../rail-3d/garage-scenes/shifen.js';
const OUT='output/shifen',URL='http://127.0.0.1:5254/prototypes/garage-shifen/';mkdirSync(OUT,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));}
const state=p=>p.evaluate(()=>shifenPreview.state);
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

// 純數學：環線連續性直接在 Node 用同一份 shifen.js 驗證，不需要瀏覽器。
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
  await p.goto(URL);await p.waitForFunction(()=>window.shifenPreview?.state.ready,null,{timeout:90000});await p.tap('#play');await settle(p);

  check(engine+' DR1000 三節柴油客車編組',JSON.stringify((await state(p)).poses.map(c=>c.id))===JSON.stringify(['dr1000','dr1000','dr1000']));
  check(engine+' 畫面預算：draw call 不超過 110',(await state(p)).drawCalls<=110,{drawCalls:(await state(p)).drawCalls,triangles:(await state(p)).triangles});

  // 三節車體的實際像素：量真實像素，不是讀設定值。
  const pixel=await p.evaluate(async()=>{const api=shifenPreview,c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d'),read=async()=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};api.trainVisible(false);const empty=await read();api.trainVisible(true);const full=await read();return api.state.bounds.map(b=>{let changed=0;for(let y=Math.max(0,Math.floor(b.top));y<Math.min(c.height,b.bottom);y++)for(let x=Math.max(0,Math.floor(b.left));x<Math.min(c.width,b.right);x++){const i=(y*c.width+x)*4;if(Math.abs(full[i]-empty[i])+Math.abs(full[i+1]-empty[i+1])+Math.abs(full[i+2]-empty[i+2])>25)changed++;}return changed;});});
  check(engine+' 三節車體的實際像素',pixel.every(n=>n>30),pixel);

  // 三個時段：抓縮小網格的平均色比對實際畫面差異。
  const swatch=()=>p.evaluate(()=>{const c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');return new Promise(async res=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data,gx=24,gy=16,cw=Math.floor(c.width/gx),ch=Math.floor(c.height/gy),grid=[];for(let j=0;j<gy;j++)for(let i=0;i<gx;i++){let r=0,g=0,bl=0,n=0;for(let y=j*ch;y<(j+1)*ch;y+=3)for(let x=i*cw;x<(i+1)*cw;x+=3){const idx=(y*c.width+x)*4;r+=data[idx];g+=data[idx+1];bl+=data[idx+2];n++;}grid.push(Math.round(r/n),Math.round(g/n),Math.round(bl/n));}res(grid);});});
  const grids={};
  for(const period of ['day','sunset','night']){await p.tap('button[data-period="'+period+'"]');await settle(p);await p.screenshot({path:`${OUT}/${engine}-${period}.png`});grids[period]=await swatch();check(engine+' '+period+' 切換',(await state(p)).period===period);}
  function gridDiff(a,c){let diff=0;for(let i=0;i<a.length;i+=3){if(Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2])>15)diff++;}return diff;}
  const daySunset=gridDiff(grids.day,grids.sunset),dayNight=gridDiff(grids.day,grids.night),sunsetNight=gridDiff(grids.sunset,grids.night);
  check(engine+' 三時段實際畫面互不相同',daySunset>40&&dayNight>40&&sunsetNight>40,{daySunset,dayNight,sunsetNight,cells:24*16});

  // 全景與跟車兩個視角都能完整看到三節車。
  await p.tap('button[data-period="day"]');await p.tap('[data-view="train"]');await settle(p);
  check(engine+' 跟車視角三節完整構圖',await p.evaluate(()=>{const c=document.querySelector('#scene');return shifenPreview.state.bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);}));
  await p.screenshot({path:`${OUT}/${engine}-follow.png`});
  await p.tap('[data-view="world"]');await settle(p);
  const worldFits=await p.evaluate(async()=>{const api=shifenPreview,rows=[];for(const frac of [0,.25,.5,.75]){api.setTime(frac*api.state.pathLength/api.state.speed);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=document.querySelector('#scene'),bounds=api.state.bounds,ok=bounds.every(b=>b.left>0&&b.right<c.width&&b.top>0&&b.bottom<c.height);rows.push({frac,ok,bounds});}return rows;});
  check(engine+' 全景視角環線四個位置都完整看到三節車',worldFits.every(r=>r.ok),worldFits.map(r=>({frac:r.frac,ok:r.ok})));
  await p.screenshot({path:`${OUT}/${engine}-world.png`});

  // 看老街：車廂應停在 s=0（老街中段），且行駛暫停。
  await p.evaluate(()=>shifenPreview.setTime(9));await p.tap('#platform');await settle(p);
  check(engine+' 看老街停在老街中段且暫停',(await state(p)).distance===0&&(await state(p)).running===false,await state(p));

  // 店屋貼著鐵軌，車不能被房子擋掉：先把場景整個隱藏、只畫車，拿到車的剪影；再把場景放回去，剪影裡顏色沒被改掉的像素就是露出來的部分。
  // 淺色車身貼著淺色房子時「有車／沒車」的像素差會被低估，所以不拿那個當分母，拿剪影當分母。
  const exposure=pg=>pg.evaluate(async()=>{const api=shifenPreview,c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');
   const read=async()=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
   api.sceneVisible(false);api.trainVisible(false);const bare=await read();api.trainVisible(true);const alone=await read();api.sceneVisible(true);const withScene=await read();api.render();
   const bs=api.state.bounds,L=Math.max(0,Math.floor(Math.min(...bs.map(b=>b.left)))),R=Math.min(c.width,Math.ceil(Math.max(...bs.map(b=>b.right)))),T=Math.max(0,Math.floor(Math.min(...bs.map(b=>b.top)))),B=Math.min(c.height,Math.ceil(Math.max(...bs.map(b=>b.bottom))));
   const diff=(a,b,i)=>Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
   let silhouette=0,visible=0;for(let y=T;y<B;y++)for(let x=L;x<R;x++){const i=(y*c.width+x)*4;if(diff(alone,bare,i)<=25)continue;silhouette++;if(diff(withScene,alone,i)<=25)visible++;}
   return{view:c.dataset.view,silhouette,visible,ratio:+(visible/Math.max(1,silhouette)).toFixed(3)};});
  const worldStreet=await exposure(p);
  await p.tap('[data-view="train"]');await p.tap('#reset');await settle(p);
  const followStreet=await exposure(p);
  check(engine+' 看老街（全景）車身露出七成以上',worldStreet.view==='world'&&worldStreet.silhouette>200&&worldStreet.ratio>=.7,worldStreet);
  check(engine+' 跟車視角停在老街裡車身露出七成以上',followStreet.view==='train'&&followStreet.silhouette>400&&followStreet.ratio>=.7,followStreet);

  // 道床、老街、天燈、車站、河與山：全部對著同一份 shifen.js 蓋出來的場景量，車的尺寸每次從車模頂點重量。
  const scene=await p.evaluate(async()=>{
   const T=await import('/rail-3d/vendor/three.module.js'),S=await import('/rail-3d/garage-scenes/shifen.js'),V=await import('/rail-3d/garage-scenes/viaduct.js'),M=await import('/rail-3d/garage-model.js');
   const sc=S.createScene(),g=sc.group,path=sc.path,q0=path.sample(0),trackY=q0.y,railZ=q0.z,groundZ=sc.anchors.street[2]-1;
   const byName=n=>g.children.find(o=>o.name===n),inst=n=>g.children.filter(o=>o.isInstancedMesh&&o.material.name===n);
   // 車模：原點＝輪底；底部頂點最密的 |y| 桶＝輪對位置；最高頂點＝車頂；最寬頂點＝車身半寬。
   const prim=await M.loadGarageModel('dr1000'),t=await M.createConsist('dr1000',prim),car=t.cars[1].car;car.updateMatrixWorld(true);
   const hist={},v=new T.Vector3();let roof=-Infinity,halfW=0;
   car.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i);o.localToWorld(v);const z=v.z-car.position.z,y=v.y-car.position.y;roof=Math.max(roof,z);halfW=Math.max(halfW,Math.abs(y));if(z<.4){const k=Math.round(Math.abs(y)*20)/20;hist[k]=(hist[k]||0)+1;}}});
   const wheel=+Object.entries(hist).sort((a,b)=>b[1]-a[1])[0][0];
   const head=byName('rail-head').geometry.attributes.position,web=byName('rail-web').geometry.attributes.position,per=head.count/2;
   const off=i=>(head.getY(i)+head.getY(i+1))/2-q0.y;
   const railOffsets=[off(0),off(per)],railTop=head.getZ(0);let railBottom=Infinity;for(let i=0;i<web.count;i++)railBottom=Math.min(railBottom,web.getZ(i));
   const m=new T.Matrix4(),pos=new T.Vector3(),rot=new T.Quaternion(),scl=new T.Vector3(),samples=[];
   for(let i=0;i<4000;i++){const s=path.sample(i/4000*path.length);samples.push([s.x,s.y]);}
   const [ties]=inst('sleeper');let offPath=0,tieTop=null;
   for(let i=0;i<ties.count;i++){ties.getMatrixAt(i,m);m.decompose(pos,rot,scl);let best=Infinity;for(const [x,y] of samples)best=Math.min(best,Math.hypot(x-pos.x,y-pos.y));if(best>.03)offPath++;tieTop=pos.z+scl.z/2;}
   // 老街淨空：老街範圍內、車身高度帶內的每個合批物件，量它離軌道中線最近的邊，扣掉車身半寬就是淨空。
   const streetX=[-13,-13+sc.params.streetLength];let minEdge=Infinity,closest=null,streetItems=0;
   for(const o of g.children){if(!o.isInstancedMesh||['sleeper','string','lantern','sky-lantern'].includes(o.material.name))continue;
    for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,rot,scl);
     if(pos.x<streetX[0]||pos.x>streetX[1]||Math.abs(pos.y-trackY)>3.5)continue;
     if(pos.z+scl.z/2<railZ+.05||pos.z-scl.z/2>railZ+roof)continue;
     const edge=Math.abs(pos.y-trackY)-scl.y/2;streetItems++;if(edge<minEdge){minEdge=edge;closest={material:o.material.name||'(props)',x:+pos.x.toFixed(2),y:+pos.y.toFixed(2),z:+pos.z.toFixed(2),sy:+scl.y.toFixed(2)};}}}
   // 燈籠串：每條都橫跨軌道中線，離車頂有餘裕。
   const strings=[];for(const o of inst('string'))for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,rot,scl);strings.push({x:pos.x,y0:pos.y-scl.y/2,y1:pos.y+scl.y/2,z:pos.z});}
   const stringsAcross=strings.filter(s=>s.y0<trackY-.6&&s.y1>trackY+.6).length,stringMinZ=Math.min(...strings.map(s=>s.z));
   // 電車線：本場景沒有；高架場景有，當正向對照。
   const wireHere=!!byName('contact-wire'),vs=V.createScene(),wireViaduct=!!vs.group.children.find(o=>o.name==='contact-wire');vs.dispose();
   // 天燈：兩個時刻各讀一次位置；夜裡紙燈與燈籠的自發光要比白天強。
   const sky=byName('sky-lanterns'),readSky=()=>{const out=[];for(let i=0;i<sky.count;i++){sky.getMatrixAt(i,m);m.decompose(pos,rot,scl);out.push({x:+pos.x.toFixed(2),y:+pos.y.toFixed(2),z:+pos.z.toFixed(2)});}return out;};
   const lanternMat=inst('lantern')[0].material;
   sc.update(0,'day');const skyA=readSky(),paperDay=sky.material.emissiveIntensity,lanternDay=lanternMat.emissiveIntensity;
   sc.update(2.5,'night');const skyB=readSky(),paperNight=sky.material.emissiveIntensity,lanternNight=lanternMat.emissiveIntensity;
   // 月台：plank 批次裡最長的那塊。
   let plat=null;for(const o of inst('plank'))for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,rot,scl);if(!plat||scl.x>plat.sx)plat={x:pos.x,y:pos.y,z:pos.z,sx:scl.x,sy:scl.y,sz:scl.z};}
   const platEdgeGap=Math.abs(plat.y-trackY)-plat.sy/2-halfW,platTop=plat.z+plat.sz/2;
   // 河與吊橋：河在後直線外側，吊橋橋面兩端都落在岸上。
   const river=byName('river');river.geometry.computeBoundingBox();const rb=river.geometry.boundingBox,riverY=[rb.min.y+river.position.y,rb.max.y+river.position.y];
   let deck=null;for(const o of inst('bridge-deck'))for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,rot,scl);deck={y0:+(pos.y-scl.y/2).toFixed(2),y1:+(pos.y+scl.y/2).toFixed(2),z:+pos.z.toFixed(2)};}
   const backY=path.sample(path.length/2).y;
   // 山：每個頂點都在底座圓角矩形內，最高點夠高。
   const hills=byName('hills'),hpv=hills.geometry.attributes.position;let hillMax=-Infinity,hillOutside=0;
   const inRect=(x,y)=>{const ax=Math.abs(x),ay=Math.abs(y);if(ax>33||ay>20)return false;if(ax<=29||ay<=16)return true;return Math.hypot(ax-29,ay-16)<=4;};
   for(let i=0;i<hpv.count;i++){const x=hpv.getX(i)+hills.position.x,y=hpv.getY(i)+hills.position.y,z=hpv.getZ(i)+hills.position.z;hillMax=Math.max(hillMax,z);if(!inRect(x,y))hillOutside++;}
   sc.dispose();t.dispose();prim.dispose();
   return{wheel,roof,halfW,railOffsets,railTop,railBottom,pathZ:q0.z,trackY,tieCount:ties.count,tieExpected:Math.ceil(path.length/.42),offPath,tieTop,minEdge,gap:minEdge-halfW,closest,streetItems,streetX,stringCount:strings.length,stringsAcross,stringMinZ,roofZ:railZ+roof,wireHere,wireViaduct,skyA,skyB,paperDay,paperNight,lanternDay,lanternNight,groundZ,platEdgeGap,platTop,riverY,deck,backY,hillMax,hillOutside,hillVerts:hpv.count};
  });
  check(engine+' 軌距對齊車模輪對（輪對位置每次從車模頂點重量）',scene.railOffsets[0]<0&&scene.railOffsets[1]>0&&scene.railOffsets.every(o=>Math.abs(Math.abs(o)-scene.wheel)<.06),{wheel:scene.wheel,railOffsets:scene.railOffsets});
  check(engine+' 軌頂托住輪底、軌底坐在枕木上',Math.abs(scene.railTop-scene.pathZ)<1e-6&&Math.abs(scene.railBottom-scene.tieTop)<1e-6,{railTop:scene.railTop,pathZ:scene.pathZ,railBottom:scene.railBottom,tieTop:scene.tieTop});
  check(engine+' 枕木鋪滿整圈且根根落在環線上',scene.tieCount===scene.tieExpected&&scene.offPath===0,{tieCount:scene.tieCount,tieExpected:scene.tieExpected,offPath:scene.offPath});
  check(engine+' 老街店屋貼著車走但不撞車（淨空由車模半寬推導：≥.25 且 ≤.7）',scene.streetItems>20&&scene.gap>=.25&&scene.gap<=.7,{gap:+scene.gap.toFixed(3),halfW:+scene.halfW.toFixed(3),closest:scene.closest,streetItems:scene.streetItems});
  check(engine+' 燈籠串條條橫過街心、掛在車頂之上',scene.stringCount>=6&&scene.stringsAcross===scene.stringCount&&scene.stringMinZ-scene.roofZ>=.3,{stringCount:scene.stringCount,stringsAcross:scene.stringsAcross,stringMinZ:scene.stringMinZ,roofZ:scene.roofZ});
  check(engine+' 柴油小車不架電車線（高架場景有＝正向對照）',!scene.wireHere&&scene.wireViaduct,{wireHere:scene.wireHere,wireViaduct:scene.wireViaduct});
  const rising=scene.skyA.map((a,i)=>scene.skyB[i].z>a.z).filter(Boolean).length,skyInStreet=[...scene.skyA,...scene.skyB].every(l=>l.x>=scene.streetX[0]&&l.x<=scene.streetX[1]&&Math.abs(l.y-scene.trackY)<=1.5&&l.z>=scene.groundZ+1.2&&l.z<=scene.groundZ+15);
  check(engine+' 天燈從老街上空往上飄（飄走的從街心再放一盞）',scene.skyA.length===6&&rising>=5&&skyInStreet,{rising,skyA:scene.skyA,skyB:scene.skyB});
  check(engine+' 夜裡天燈與燈籠亮起來',scene.paperNight>scene.paperDay&&scene.lanternNight>scene.lanternDay&&scene.lanternDay===0,{paperDay:scene.paperDay,paperNight:scene.paperNight,lanternDay:scene.lanternDay,lanternNight:scene.lanternNight});
  check(engine+' 月台貼在軌旁、面高托得住車門',scene.platEdgeGap>=.2&&scene.platEdgeGap<=.8&&scene.platTop>=scene.pathZ-.1&&scene.platTop<=scene.pathZ+.35,{platEdgeGap:+scene.platEdgeGap.toFixed(3),platTop:scene.platTop,pathZ:scene.pathZ});
  check(engine+' 河在後直線外側、吊橋跨過整條河',scene.riverY[0]>scene.backY+1.45&&scene.deck.y0<scene.riverY[0]&&scene.deck.y1>scene.riverY[1]&&scene.deck.z>scene.groundZ+.5,{riverY:scene.riverY,backY:scene.backY,deck:scene.deck});
  check(engine+' 對岸的山收在底座裡、有高度',scene.hillOutside===0&&scene.hillMax>=scene.groundZ+4&&scene.hillVerts>1000,{hillOutside:scene.hillOutside,hillMax:scene.hillMax,hillVerts:scene.hillVerts});

  // 參數化證明：在頁面裡直接 import shifen.js，用不同參數各建一次場景。
  const paramProof=await p.evaluate(async()=>{
   const mod=await import('../../rail-3d/garage-scenes/shifen.js');
   function countTriangles(group){let total=0;group.traverse(o=>{if(o.isMesh){const g=o.geometry,idx=g.index,tris=(idx?idx.count:g.attributes.position.count)/3;total+=tris*(o.isInstancedMesh?o.count:1);}});return total;}
   const configs=[{name:'default',params:{}},{name:'noLanterns',params:{skyLanterns:0}},{name:'shortStreet',params:{streetLength:12,skyLanterns:3}},{name:'defaultAgain',params:{}}];
   const out=[];
   for(const cfg of configs){
    const s=mod.createScene(cfg.params),sky=s.group.children.find(o=>o.name==='sky-lanterns'),triangles=countTriangles(s.group),childCountBefore=s.group.children.length,paramsEcho=JSON.parse(JSON.stringify(s.params));
    s.dispose();
    out.push({name:cfg.name,triangles,skyCount:sky?sky.count:0,paramsEcho,childCountBefore,childCountAfter:s.group.children.length});
   }
   return out;
  });
  const [pDefault,pNoLantern,pShort,pDefaultAgain]=paramProof;
  check(engine+' 參數化：天燈數照參數（0 盞就沒有那個網格）',pDefault.skyCount===6&&pNoLantern.skyCount===0&&pShort.skyCount===3,paramProof.map(x=>({name:x.name,skyCount:x.skyCount})));
  check(engine+' 參數化：老街縮短三角形變少、相同參數兩次結果相同（正向對照）',pShort.triangles<pDefault.triangles&&pDefault.triangles===pDefaultAgain.triangles&&pDefault.triangles>0,paramProof.map(x=>({name:x.name,triangles:x.triangles})));
  check(engine+' 參數化：四組都能 dispose 且不留下幾何',paramProof.every(x=>x.childCountBefore>0&&x.childCountAfter===0)&&pShort.paramsEcho.streetLength===12,paramProof.map(x=>({before:x.childCountBefore,after:x.childCountAfter})));

  await p.tap('[data-view="world"]');await p.evaluate(()=>shifenPreview.setTime(4));
  for(const width of [360,375,390,414,520,768,1280]){await p.setViewportSize({width,height:900});await settle(p);await p.tap('#in');await p.tap('#out');await p.tap('#reset');await settle(p);const ui=await p.evaluate(()=>{const els=[...document.querySelectorAll('button,a')].filter(e=>e.getClientRects().length),bad=[],overlap=[];for(const e of els){const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!e.contains(hit)||r.width<43||r.height<43)bad.push(e.textContent);}for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([els[i].textContent,els[j].textContent]);}return{bad,overlap,overflow:document.documentElement.scrollWidth>innerWidth};});check(engine+' '+width+' 真觸控與可及性',!ui.bad.length&&!ui.overlap.length&&!ui.overflow,ui);}

  const mem=(await state(p)).memory;for(let i=0;i<3;i++){await p.tap('[data-view="train"]');await p.tap('button[data-period="night"]');await p.tap('[data-view="world"]');await p.tap('button[data-period="day"]');}await settle(p);check(engine+' 切換不累積資源',JSON.stringify(mem)===JSON.stringify((await state(p)).memory),{before:mem,after:(await state(p)).memory});
  const draws=(await state(p)).draws;await p.waitForTimeout(250);check(engine+' 暫停不重繪',(await state(p)).draws===draws);
  check(engine+' 無 JS／WebGL 錯誤',errors.length===0,errors);
  await p.close();

  const mobile=await b.newPage({viewport:{width:375,height:900},reducedMotion:'reduce',isMobile:true,hasTouch:true});await mobile.goto(URL);await mobile.waitForFunction(()=>window.shifenPreview?.state.ready,null,{timeout:90000});check(engine+' 手機預設跟車且減少動態停止',!(await state(mobile)).running&&(await state(mobile)).view==='train');await mobile.evaluate(()=>shifenPreview.setTime(4));await mobile.screenshot({path:`${OUT}/${engine}-mobile.png`,fullPage:true});await mobile.close();
 }catch(e){check(engine+' 驗證流程',false,e.stack);}finally{await b.close();}
}
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));
const fails=results.filter(r=>!r.pass).length,passes=results.length-fails;
console.log(`\n共 ${results.length} 項：PASS ${passes}，FAIL ${fails}`);
if(fails)process.exitCode=1;

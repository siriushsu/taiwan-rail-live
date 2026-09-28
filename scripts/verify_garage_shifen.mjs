import {chromium,webkit} from 'playwright';
import {panChecks} from './lib/garage_pan_checks.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createScene} from '../rail-3d/garage-scenes/shifen.js';
const OUT='output/shifen',URL=process.env.GARAGE_SHIFEN_URL||'http://127.0.0.1:5254/prototypes/garage-shifen/';mkdirSync(OUT,{recursive:true});
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
  // 09-28 三項精修（遊客＋看老街鏡頭＋Blender 樹叢竹叢）把上限從 110 調整到 115：新增的都是
  // InstancedMesh（不是逐一個體 Mesh，維持「每種幾何一個 draw call、靠 per-instance 上色做外觀
  // 變化」的既有省法）——遊客 7 種部位＋手持天燈 3 個網格＋植被 4 種部位＝14 個新 InstancedMesh，
  // 實測落在 113（車站原本 102 基準＋11，因為部分實例 count=0 時 three.js 不計入 draw call）。
  // 115 是「實測值 113＋2 的極小緩衝」，仍遠低於任務允許放寬到的 125 上限（高架月台場景那一版
  // 的量），沒有必要一次跳到頂。
  check(engine+' 畫面預算：draw call 不超過 115（09-28 遊客＋植被精修後的新上限，原 110 是舊基準）',(await state(p)).drawCalls<=115,{drawCalls:(await state(p)).drawCalls,triangles:(await state(p)).triangles});

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

  // 看老街：09-28 起改成「快轉到下一次進站」（不是瞬移到老街中段），套用南迴同一套 stop-timetable
  // 做法——舊判準（distance===0 且 running===false）驗的是已經拔掉的瞬移行為，改驗新行為：時間真的往前
  // 跳（不是瞬移到某個固定值）、跳完處在減速／停站階段、切到月台特寫視角；再等到真的停穩，車停在月台
  // 中心（世界座標 x≈STATION_OFFSET）且速度為零。深入的階段機（含突變測試）放 verify_garage_shifen_stop.mjs。
  await p.evaluate(()=>shifenPreview.setTime(40));const beforeClick=(await state(p)).time;   // 40 秒落在巡航段（brake=5…cruiseAt=26 之後），確保這次點擊真的會觸發快轉，不是本來就在減速/停站中
  await p.tap('#platform');await settle(p);const afterClick=await state(p);
  check(engine+' 看老街快轉到下一次進站（不是瞬移）',afterClick.time>beforeClick+1&&(afterClick.phase==='braking'||afterClick.phase==='stopped')&&afterClick.view==='platform',{beforeClick,afterClick});
  await p.evaluate(()=>new Promise(res=>{const iv=setInterval(()=>{if(shifenPreview.state.phase==='stopped'){clearInterval(iv);res();}},50);}));await settle(p);
  const stoppedAt=await state(p);
  check(engine+' 看老街快轉後真的停在月台、車速歸零',stoppedAt.phase==='stopped'&&stoppedAt.currentSpeed===0&&Math.abs(stoppedAt.poses[1].x-13.2)<.05,stoppedAt);

  // 店屋貼著鐵軌，車不能被房子擋掉：先把場景整個隱藏、只畫車，拿到車的剪影；再把場景放回去，剪影裡顏色沒被改掉的像素就是露出來的部分。
  // 淺色車身貼著淺色房子時「有車／沒車」的像素差會被低估，所以不拿那個當分母，拿剪影當分母。
  const exposure=pg=>pg.evaluate(async()=>{const api=shifenPreview,c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d');
   const read=async()=>{const im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
   api.sceneVisible(false);api.trainVisible(false);const bare=await read();api.trainVisible(true);const alone=await read();api.sceneVisible(true);const withScene=await read();api.render();
   const bs=api.state.bounds,L=Math.max(0,Math.floor(Math.min(...bs.map(b=>b.left)))),R=Math.min(c.width,Math.ceil(Math.max(...bs.map(b=>b.right)))),T=Math.max(0,Math.floor(Math.min(...bs.map(b=>b.top)))),B=Math.min(c.height,Math.ceil(Math.max(...bs.map(b=>b.bottom))));
   const diff=(a,b,i)=>Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
   let silhouette=0,visible=0;for(let y=T;y<B;y++)for(let x=L;x<R;x++){const i=(y*c.width+x)*4;if(diff(alone,bare,i)<=25)continue;silhouette++;if(diff(withScene,alone,i)<=25)visible++;}
   return{view:c.dataset.view,silhouette,visible,ratio:+(visible/Math.max(1,silhouette)).toFixed(3)};});
  // 09-28 二版：獨立評審指出「看老街」原本的月台特寫（仰角拉到 1.15 rad≈66° 只為了閃雨棚）其實只
  // 看得到站房屋頂，看不到老街——改成沿老街走廊的低角度全景（PLATFORM_YAW／PLATFORM_ELEVATION，
  // 見 main.js），跟車視角在站區也不再自動拉高仰角到 1.22（同一次評審要求）。這兩個視角原本用「車身
  // 曝光率 ≥.7」當唯一判準（那是舊設計專門為了閃雨棚校準出來的數字）；新設計的構圖重點換成老街本身，
  // 車身曝光率不再是唯一標準，但仍留一個寬鬆下限當退化保護（車不能整個消失在雨棚或畫面外）——下面
  // platformFraming 量的「兩排店面／天燈是否真的在畫面裡」＋這裡的曝光率下限一起構成新判準。
  // 下限 .35 是兩個引擎實測值（platform≈.46/.47，跟車站區≈.415/.418）打七折取整，不是另外猜的數字。
  const platformShot=await exposure(p);
  const platformFraming=await p.evaluate(()=>{
   const api=shifenPreview,c=document.querySelector('#scene');
   const inBounds=q=>q.x>=0&&q.x<=c.width&&q.y>=0&&q.y<=c.height;
   const xs=[-11,-6,-2,2,6];
   const farRow=xs.map(x=>api.project([x,-3.15,1.5])),nearRow=xs.map(x=>api.project([x,-9.55,1.0]));
   const info=api.lanternInfo(),lanterns=[];for(let k=0;k<(info?.count||0);k++){const r=api.lanternState(k);if(r)lanterns.push(r);}
   const maxScale=Math.max(0,...lanterns.map(l=>l.scale));
   const risen=lanterns.filter(l=>l.scale>maxScale*.25&&inBounds(api.project(l.position)));
   return{elevation:api.state.elevation,farRowOn:farRow.filter(inBounds).length,nearRowOn:nearRow.filter(inBounds).length,lanternCount:lanterns.length,risenOnScreen:risen.length};
  });
  await p.tap('[data-view="train"]');await p.tap('#reset');await settle(p);
  const followStreet=await exposure(p);
  check(engine+' 看老街：沿街低角度（仰角實測值 ≤25°）＋兩排店面與天燈都在畫面裡',platformShot.view==='platform'&&platformFraming.elevation<=.4363&&platformFraming.farRowOn>=3&&platformFraming.nearRowOn>=3&&platformFraming.risenOnScreen>=3,{...platformFraming,ratio:platformShot.ratio});
  check(engine+' 看老街車身曝光率退化保護（新構圖不以車身為主角，只防整個消失）',platformShot.view==='platform'&&platformShot.silhouette>200&&platformShot.ratio>=.35,platformShot);
  check(engine+' 跟車視角停在月台旁車身曝光率退化保護（09-28 起不再自動拉高仰角避雨棚，這裡改防整個消失）',followStreet.view==='train'&&followStreet.silhouette>400&&followStreet.ratio>=.35,followStreet);

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
   // 天燈：09-28 起搬到 createSkyLanterns()（獨立於 createScene() 之外，資產非同步載入），這裡另外
   // 載入同一份 kit 建一次，用 readInstance()（讀真的寫進 InstancedMesh 的那份，不是重算 stateAt 公式）
   // 兩個時刻各讀一次位置；夜裡紙燈與燈籠串的自發光要比白天強。
   const lanternKit=await M.loadGarageParts(new URL('/rail-3d/assets/garage-lanterns-v1/lanterns.json',location.href)),
    skyLanterns=S.createSkyLanterns(lanternKit,1.25/prim.size.y,sc.lanternZone),
    paperMesh=skyLanterns.group.children.find(o=>o.name==='sky-lantern-paper'),
    readSky=()=>Array.from({length:skyLanterns.count},(_,i)=>{const r=skyLanterns.readInstance(i);return{x:+r.position[0].toFixed(2),y:+r.position[1].toFixed(2),z:+r.position[2].toFixed(2)};});
   const lanternMat=inst('lantern')[0].material;
   const lanternZoneX=[sc.lanternZone.x0,sc.lanternZone.x1]; // 09-28 二版：落點範圍從街段延伸到站區（見 shifen.js createScene 的 lanternZone 註解），這裡直接讀場景自己宣告的範圍，不要另外硬編一份跟它可能對不上的邊界。
   sc.update(0,'day');skyLanterns.update(0,'day');const skyA=readSky(),paperDay=paperMesh.material.emissiveIntensity,lanternDay=lanternMat.emissiveIntensity;
   sc.update(2.5,'night');skyLanterns.update(2.5,'night');const skyB=readSky(),paperNight=paperMesh.material.emissiveIntensity,lanternNight=lanternMat.emissiveIntensity;
   skyLanterns.dispose();lanternKit.dispose();
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
   return{wheel,roof,halfW,railOffsets,railTop,railBottom,pathZ:q0.z,trackY,tieCount:ties.count,tieExpected:Math.ceil(path.length/.42),offPath,tieTop,minEdge,gap:minEdge-halfW,closest,streetItems,streetX,stringCount:strings.length,stringsAcross,stringMinZ,roofZ:railZ+roof,wireHere,wireViaduct,skyA,skyB,lanternZoneX,paperDay,paperNight,lanternDay,lanternNight,groundZ,platEdgeGap,platTop,riverY,deck,backY,hillMax,hillOutside,hillVerts:hpv.count};
  });
  check(engine+' 軌距對齊車模輪對（輪對位置每次從車模頂點重量）',scene.railOffsets[0]<0&&scene.railOffsets[1]>0&&scene.railOffsets.every(o=>Math.abs(Math.abs(o)-scene.wheel)<.06),{wheel:scene.wheel,railOffsets:scene.railOffsets});
  check(engine+' 軌頂托住輪底、軌底坐在枕木上',Math.abs(scene.railTop-scene.pathZ)<1e-6&&Math.abs(scene.railBottom-scene.tieTop)<1e-6,{railTop:scene.railTop,pathZ:scene.pathZ,railBottom:scene.railBottom,tieTop:scene.tieTop});
  check(engine+' 枕木鋪滿整圈且根根落在環線上',scene.tieCount===scene.tieExpected&&scene.offPath===0,{tieCount:scene.tieCount,tieExpected:scene.tieExpected,offPath:scene.offPath});
  check(engine+' 老街店屋貼著車走但不撞車（淨空由車模半寬推導：≥.25 且 ≤.7）',scene.streetItems>20&&scene.gap>=.25&&scene.gap<=.7,{gap:+scene.gap.toFixed(3),halfW:+scene.halfW.toFixed(3),closest:scene.closest,streetItems:scene.streetItems});
  check(engine+' 燈籠串條條橫過街心、掛在車頂之上',scene.stringCount>=6&&scene.stringsAcross===scene.stringCount&&scene.stringMinZ-scene.roofZ>=.3,{stringCount:scene.stringCount,stringsAcross:scene.stringsAcross,stringMinZ:scene.stringMinZ,roofZ:scene.roofZ});
  check(engine+' 柴油小車不架電車線（高架場景有＝正向對照）',!scene.wireHere&&scene.wireViaduct,{wireHere:scene.wireHere,wireViaduct:scene.wireViaduct});
  // 09-28 二版：天燈預設數量從 6 盞改成 12 盞（見 shifen.js createSkyLanterns 的 cfg.count），
  // 這裡的期望值跟著等比例更新——原本「6 盞裡至少 5 盞在漲」（容許 1 盞剛好在這個取樣窗口內
  // wrap 回收）是照 6 盞校準的容忍度（1/6≈16.7%），盞數變多、相位改成均分後，固定的 2.5 秒取樣窗
  // 落在某一盞 wrap 附近的機率跟著變高（12 盞均分在 13 秒週期，統計上預期任何時刻都有一兩盞在
  // wrap 前後），照同一個比例（16.7%）換算成 12 盞就是「至少 10 盞在漲」，不是行為壞掉、是取樣
  // 對到了原本就會發生的 wrap（實測 skyB 裡確實有一盞 z 從 13.07 掉到 1.68，正是 wrap 那一下）。
  const rising=scene.skyA.map((a,i)=>scene.skyB[i].z>a.z).filter(Boolean).length,skyInStreet=[...scene.skyA,...scene.skyB].every(l=>l.x>=scene.lanternZoneX[0]&&l.x<=scene.lanternZoneX[1]&&Math.abs(l.y-scene.trackY)<=1.5&&l.z>=scene.groundZ+1.2&&l.z<=scene.groundZ+15);
  check(engine+' 天燈從老街上空往上飄（飄走的從街心再放一盞）',scene.skyA.length===12&&rising>=10&&skyInStreet,{rising,skyA:scene.skyA,skyB:scene.skyB});
  check(engine+' 夜裡天燈與燈籠亮起來',scene.paperNight>scene.paperDay&&scene.lanternNight>scene.lanternDay&&scene.lanternDay===0,{paperDay:scene.paperDay,paperNight:scene.paperNight,lanternDay:scene.lanternDay,lanternNight:scene.lanternNight});
  check(engine+' 月台貼在軌旁、面高托得住車門',scene.platEdgeGap>=.2&&scene.platEdgeGap<=.8&&scene.platTop>=scene.pathZ-.1&&scene.platTop<=scene.pathZ+.35,{platEdgeGap:+scene.platEdgeGap.toFixed(3),platTop:scene.platTop,pathZ:scene.pathZ});
  check(engine+' 河在後直線外側、吊橋跨過整條河',scene.riverY[0]>scene.backY+1.45&&scene.deck.y0<scene.riverY[0]&&scene.deck.y1>scene.riverY[1]&&scene.deck.z>scene.groundZ+.5,{riverY:scene.riverY,backY:scene.backY,deck:scene.deck});
  check(engine+' 對岸的山收在底座裡、有高度',scene.hillOutside===0&&scene.hillMax>=scene.groundZ+4&&scene.hillVerts>1000,{hillOutside:scene.hillOutside,hillMax:scene.hillMax,hillVerts:scene.hillVerts});

  // 參數化證明：在頁面裡直接 import shifen.js，用不同參數各建一次場景。09-28 起 skyLanterns 不再是
  // createScene() 的參數（天燈搬到獨立的 createSkyLanterns()，見上面「天燈」那段），這裡拆成兩組證明：
  // createScene() 只證 streetLength；天燈數量的參數化改對 createSkyLanterns() 自己的 count 測。
  const paramProof=await p.evaluate(async()=>{
   const mod=await import('../../rail-3d/garage-scenes/shifen.js');
   function countTriangles(group){let total=0;group.traverse(o=>{if(o.isMesh){const g=o.geometry,idx=g.index,tris=(idx?idx.count:g.attributes.position.count)/3;total+=tris*(o.isInstancedMesh?o.count:1);}});return total;}
   const configs=[{name:'default',params:{}},{name:'shortStreet',params:{streetLength:12}},{name:'defaultAgain',params:{}}];
   const out=[];
   for(const cfg of configs){
    const s=mod.createScene(cfg.params),triangles=countTriangles(s.group),childCountBefore=s.group.children.length,paramsEcho=JSON.parse(JSON.stringify(s.params));
    s.dispose();
    out.push({name:cfg.name,triangles,paramsEcho,childCountBefore,childCountAfter:s.group.children.length});
   }
   return out;
  });
  const [pDefault,pShort,pDefaultAgain]=paramProof;
  check(engine+' 參數化：老街縮短三角形變少、相同參數兩次結果相同（正向對照）',pShort.triangles<pDefault.triangles&&pDefault.triangles===pDefaultAgain.triangles&&pDefault.triangles>0,paramProof.map(x=>({name:x.name,triangles:x.triangles})));
  check(engine+' 參數化：三組都能 dispose 且不留下幾何',paramProof.every(x=>x.childCountBefore>0&&x.childCountAfter===0)&&pShort.paramsEcho.streetLength===12,paramProof.map(x=>({before:x.childCountBefore,after:x.childCountAfter})));

  // createSkyLanterns() 自己的參數化：count 控制天燈網格的實例數（0 盞時乾脆不建 InstancedMesh）。
  const lanternParamProof=await p.evaluate(async()=>{
   const S=await import('/rail-3d/garage-scenes/shifen.js'),M=await import('/rail-3d/garage-model.js'),sc=S.createScene();
   const kit=await M.loadGarageParts(new URL('/rail-3d/assets/garage-lanterns-v1/lanterns.json',location.href));
   const out=[];for(const count of [0,3,6]){const l=S.createSkyLanterns(kit,1,sc.lanternZone,{count});const paperMesh=l.group.children.find(o=>o.name==='sky-lantern-paper');out.push({count,got:l.count,hasMesh:!!paperMesh,meshCount:paperMesh?paperMesh.count:0});l.dispose();}
   kit.dispose();sc.dispose();return out;
  });
  check(engine+' 參數化：天燈數照 createSkyLanterns 的 count（0 盞就沒有那個網格）',lanternParamProof.every(x=>x.got===x.count&&x.hasMesh===(x.count>0)&&x.meshCount===x.count),lanternParamProof);

  // 山的背面與夜燈（09-12 兩點：轉到背面山要是實心的、有房子有燈的地方要有光）。全部在 1440×1000 的全景頁上量真實像素；車先停到後直線，老街不被車擋。
  {
   const sample=pts=>p.evaluate(async pts=>{const c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d'),im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;return pts.map(pt=>{const q=shifenPreview.project(pt),i=(Math.round(q.y)*c.width+Math.round(q.x))*4;return{x:+q.x.toFixed(1),y:+q.y.toFixed(1),r:d[i],g:d[i+1],b:d[i+2],l:+(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]).toFixed(1)};});},pts);
   const facts=await p.evaluate(async()=>{const S=await import('/rail-3d/garage-scenes/shifen.js'),s=S.createScene(),g=s.group,hills=g.children.find(o=>o.name==='hills'),skirt=g.children.find(o=>o.name==='hills-skirt');
    const range=(o,axis)=>{if(!o)return null;const a=o.geometry.attributes.position,off=o.position[axis];let lo=Infinity,hi=-Infinity;for(let i=0;i<a.count;i++){const v=a['get'+axis.toUpperCase()](i)+off;lo=Math.min(lo,v);hi=Math.max(hi,v);}return[+lo.toFixed(2),+hi.toFixed(2)];};
    const glass=g.children.find(o=>o.isInstancedMesh&&o.material.name==='glass');
    const require_three=await import('/rail-3d/vendor/three.module.js'),wins=[];if(glass){const M=new require_three.Matrix4();for(let i=0;i<glass.count;i++){glass.getMatrixAt(i,M);wins.push([+M.elements[12].toFixed(2),+M.elements[13].toFixed(2),+M.elements[14].toFixed(2)]);}}
    const lamps=g.children.filter(o=>o.isPointLight);s.update(0,'day');const dayI=lamps.map(l=>l.intensity),dayGlass=glass?.material.emissiveIntensity;s.update(0,'night');const nightI=lamps.map(l=>l.intensity),nightGlass=glass?.material.emissiveIntensity;
    const q0=s.path.sample(0),out={hillsY:range(hills,'y'),skirtY:range(skirt,'y'),skirtZ:range(skirt,'z'),hillsZ:range(hills,'z'),lampCount:lamps.length,dayI,nightI,dayGlass,nightGlass,windows:wins.length,trackY:q0.y,railZ:q0.z,groundZ:s.anchors.street[2]-1,farWindows:wins.filter(w=>Math.abs(w[1]-(q0.y+1.75-.02))<.05&&w[2]>q0.z+1.2),stringX:[...new Set(g.children.filter(o=>o.isInstancedMesh&&o.material.name==='string').flatMap(o=>{const M2=new (require_three.Matrix4)();return Array.from({length:o.count},(_,i)=>{o.getMatrixAt(i,M2);return +M2.elements[12].toFixed(2);});}))]};s.dispose();return out;});
   const T=facts.trackY,G=facts.groundZ,R=facts.railZ;
   check(engine+' 山鋪到台子後緣、後緣有一面封到地面的切面牆',facts.hillsY&&facts.hillsY[1]>=19.9&&facts.skirtY&&Math.abs(facts.skirtY[0]-15.4)<.05&&Math.abs(facts.skirtY[1]-20)<.05&&facts.skirtZ&&Math.abs(facts.skirtZ[0]-(G+.02))<.05&&facts.skirtZ[1]>G+.8,{hillsY:facts.hillsY,skirtY:facts.skirtY,skirtZ:facts.skirtZ});
   await p.tap('[data-view="world"]');await p.tap('button[data-period="day"]');if((await state(p)).running)await p.tap('#play');await p.evaluate(()=>shifenPreview.setTime(34));await p.tap('#reset');await settle(p);
   const wallPt=[-9,20,G+.02+.35],frontPt=[-9,15.6,G+.05];   // 切面牆中段一點；山前腳一點（正面看得到、背面被山擋住）
   await p.locator('#scene').focus();for(let i=0;i<21;i++)await p.keyboard.press('ArrowRight');await settle(p);   // 21×.15 ≈ π：轉到背面
   const [backWall]=await sample([wallPt]);await p.evaluate(()=>shifenPreview.setVisible('hills-skirt',false));await settle(p);const [noWall]=await sample([wallPt]);await p.evaluate(()=>shifenPreview.setVisible('hills-skirt',true));
   const [backHill]=await sample([[-9,19.2,G+.02+3.0]]);   // 背坡上的一點：從背面要看到山（綠），不是看穿到台子或背景
   check(engine+' 從背面看得到山：背坡是綠的、切面是土色，把切面牆藏起來顏色就變（正向對照）',backHill.g>backHill.r&&backHill.g>backHill.b&&backWall.r>backWall.g&&backWall.g>backWall.b&&(Math.abs(noWall.r-backWall.r)+Math.abs(noWall.g-backWall.g)+Math.abs(noWall.b-backWall.b))>40,{backHill,backWall,noWall});
   await p.tap('#reset');await settle(p);
   // 夜燈：燈籠串底下的鋪面 vs 遠處沒燈的草地，晚上要比白天亮出一截；窗戶晚上要亮起來且是暖色。
   const pav=[-2.8,T+1.3,R-.15],grass=[-26,-17.5,G+.01],cands=facts.farWindows.filter(w=>facts.stringX.every(sx=>Math.abs(w[0]-sx)>.8));   // 遠排二樓窗，避開燈籠串正前方那幾扇（串會擋住取樣點）
   const day=await sample([pav,grass,...cands]);await p.tap('button[data-period="night"]');await settle(p);const night=await sample([pav,grass,...cands]);await p.tap('button[data-period="day"]');await settle(p);
   const ratio=s=>s[0].l/Math.max(1,s[1].l);
   check(engine+' 夜裡燈籠串底下有光池：鋪面對草地的亮度比，晚上比白天高',facts.lampCount>=10&&facts.nightI.every(i=>i>0)&&facts.dayI.every(i=>i===0)&&ratio(night)>ratio(day)*1.35&&night[0].l>night[1].l*1.4,{lampCount:facts.lampCount,dayRatio:+ratio(day).toFixed(2),nightRatio:+ratio(night).toFixed(2),pavNight:night[0].l,grassNight:night[1].l});
   const lit=cands.filter((w,i)=>night[i+2].l>day[i+2].l*1.5&&night[i+2].r>night[i+2].b+30);
   check(engine+' 夜裡房子的窗戶亮起來：遠排二樓窗白天是暗的、晚上暖色發亮（避開燈籠串的窗至少一半要亮）',facts.windows>40&&facts.nightGlass>facts.dayGlass&&facts.dayGlass===0&&cands.length>=2&&lit.length*2>=cands.length,{windows:facts.windows,cands:cands.length,lit:lit.length,samples:cands.map((w,i)=>({w,day:day[i+2].l,night:[night[i+2].r,night[i+2].g,night[i+2].b]}))});
  }

  // 09-28 精修 Task 3：Blender 樹叢／竹叢取代程序化二十面體「寶石樹」。舊 broadleaf 的樹幹材質色
  // 71664e（props.js 專用、bush/rock 不用這個色）現在只可能出現在活頁面「真正在畫面上」的 scene
  // 裡（vegetation 是另外用 loadGarageParts() 建的資產、透過 main.js 的 vegetation.group 掛上去，
  // 不在 createScene() 自己的 group 裡）——第一版判準誤用乾淨 createScene() 探針掃描，那個探針從
  // 建構時的定義就不含任何樹的幾何（新舊都不含，因為 createScene() 早就把樹的建立搬出去了），
  // 掃出來永遠是 0、跟改動無關，做突變測試時才抓到自己判準測錯物件——已改成掃 sceneHasMaterialColor()
  // 讀的那個真正的 live scene。treeSpots／bambooSpots 座標仍然用探針拿（純資料、不含幾何，是安全的）。
  const oldBroadleafTrunks=await p.evaluate(()=>shifenPreview.sceneHasMaterialColor('#71664e')?1:0);
  const vegFacts=await p.evaluate(async()=>{
   const S=await import('/rail-3d/garage-scenes/shifen.js');
   const probe=S.createScene();
   const treeSpots=probe.treeSpots.map(s=>({z:s.z,species:s.species})),bambooSpots=probe.bambooSpots.length;
   probe.dispose();
   const api=shifenPreview,idxs=[0,1,2,49,50,99,100,149,150,199];
   const flush=idxs.map(i=>{const t=api.vegTrunk(i);return t&&treeSpots[i]?Math.abs(t.position[2]-treeSpots[i].z):Infinity;});
   const speciesSeen=new Set(treeSpots.map(s=>s.species));
   return {treeCount:treeSpots.length,bambooSpotCount:bambooSpots,flushErrors:flush,speciesSeen:[...speciesSeen],vegInfo:api.vegInfo()};
  });
  check(engine+' 場景不再建立任何舊二十面體寶石樹（掃活頁面真正的 scene，找 broadleaf 專用樹幹材質色 71664e）',oldBroadleafTrunks===0,oldBroadleafTrunks);
  check(engine+' 樹幹底部貼齊地面（世界座標 z 跟落點資料逐棵一致，容差只蓋 float32 存取的量化誤差）',vegFacts.flushErrors.every(e=>e<1e-3),vegFacts.flushErrors);
  check(engine+' 至少兩種闊葉樹外觀（叢生多瓣冠層，round／layered 種）＋竹叢座標數與植被總數吻合',vegFacts.speciesSeen.length>=2&&vegFacts.bambooSpotCount>0&&vegFacts.vegInfo.treeCount===vegFacts.treeCount&&vegFacts.vegInfo.culmCount===vegFacts.bambooSpotCount*6&&vegFacts.vegInfo.leafCount===vegFacts.vegInfo.culmCount*5,vegFacts);

  // 09-28 精修 Task 1：遊客站在老街軌道上、手持天燈、列車接近時避讓、遠離後走回。全圈 dt=.05 細掃
  // （用跟真正逐幀播放一樣的方式一小步一小步 setTime，update() 內部的 dt 才不會被 clamp 到 .08
  // 上限之外——採樣方式跟實際播放一致，不是瞬移採樣），比對「車體世界包圍盒」（跟 state.bounds
  // 同一個 THREE.Box3().setFromObject 來源，只是不投影到螢幕）而不是重算 trainMinDistance() 內部
  // 公式，避免判準跟被驗的實作同源。
  await p.tap('[data-view="world"]');
  const sweep=await p.evaluate(async()=>{
   const api=shifenPreview,lap=api.timetable.lap,DT=.05,N=Math.ceil((lap+1)/DT),out=[];
   for(let k=0;k<=N;k++){const t=k*DT;api.setTime(t);const vs=api.visitorState(),boxes=api.trainWorldBounds();out.push({t,vs:vs.map(v=>[v.x,v.y,v.lateral]),boxes:boxes.map(bx=>[bx.min[0],bx.min[1],bx.max[0],bx.max[1]])});}
   return {walkSpeedWorld:api.visitorInfo().walkSpeedWorld,holderIndices:api.visitorInfo().holderIndices,count:api.visitorInfo().count,samples:out};
  });
  const pointBoxDist=(px,py,box)=>{const dx=Math.max(box[0]-px,0,px-box[2]),dy=Math.max(box[1]-py,0,py-box[3]);return Math.hypot(dx,dy);};
  const SAFETY_GAP=.3;   // 自訂：車體世界包圍盒表面到遊客中心點的最小容許淨空，約略一個人自己半個身寬（測「有沒有跟車體重疊」，不是重算內部 nearGap/farGap 兩個常數）
  let worstGap=Infinity,worstGapAt=null;
  for(const s of sweep.samples)for(const v of s.vs){let best=Infinity;for(const bx of s.boxes)best=Math.min(best,pointBoxDist(v[0],v[1],bx));if(best<worstGap){worstGap=best;worstGapAt={t:s.t,v};}}
  check(engine+' 遊客避讓：列車經過全程（雙向都在同一條迴圈裡跑過），每個人跟車體世界包圍盒的距離都保持安全淨空',worstGap>=SAFETY_GAP,{worstGap:+worstGap.toFixed(3),SAFETY_GAP,worstGapAt});

  // 「沒有列車」不能用「離站後固定等幾秒」判定：實測（probe-farGap-candidates／probe-peak-separation，
  // 09-28）發現這條迴圈本身是折返繞遠（河與吊橋、對岸的山）再回到老街，對街上靠近月台端的定點來說，
  // 火車離站後的直線距離會先小幅拉開、再因為迴圈彎回來又暫時縮小，要到迴圈遠端（實測約離站後 30~55
  // 秒不等，因人而異）才會真正穩定拉開到 farGap 以外——這是這條迴圈的幾何本身，不是漏抓或誤觸發
  // （曾經以為是 bug，逐一比對 state.poses 世界座標與各遊客距離才確認是真實幾何）。所以判準改成
  // 「整條迴圈是否存在一段連續夠長（≥5 秒）、onTrack>=3 的穩定窗口」，只驗「真的會發生」這件事本身，
  // 不assume 何時發生；用連續秒數而非單一取樣點，排除單幀雜訊或迴圈中段暫時性的部分回流（idx8 類
  // 遊客在遠端會先降到谷值又回升，見 probe-recovery-timeline 的記錄）當假陽性。
  const REQUIRED_HOLD=5;
  let holdStart=null,bestHold=0,bestHoldAt=null,minOnTrackEver=Infinity;
  for(const s of sweep.samples){
   const onTrack=s.vs.filter(v=>v[2]<0.5).length;
   if(onTrack<minOnTrackEver)minOnTrackEver=onTrack;
   if(onTrack>=3){if(holdStart==null)holdStart=s.t;const held=s.t-holdStart;if(held>bestHold){bestHold=held;bestHoldAt=s.t;}}
   else holdStart=null;
  }
  check(engine+' 遊客避讓：整條迴圈存在一段連續≥5秒、軌道上至少3人的穩定窗口（不假設離站後幾秒內就穩定，這條迴圈的幾何要到遠端才會真正拉開安全距離，見 polish-04-notes）',bestHold>=REQUIRED_HOLD,{bestHold:+bestHold.toFixed(2),bestHoldAt,minOnTrackEver});

  let maxSpeed=0,maxSpeedAt=null;
  for(let i=1;i<sweep.samples.length;i++){const s=sweep.samples[i],prev=sweep.samples[i-1],dt=s.t-prev.t;for(let k=0;k<s.vs.length;k++){const d=Math.hypot(s.vs[k][0]-prev.vs[k][0],s.vs[k][1]-prev.vs[k][1])/dt;if(d>maxSpeed){maxSpeed=d;maxSpeedAt={t:s.t,k};}}}
  check(engine+' 遊客避讓：獨立從逐幀世界座標差重算最大位移速度不超過 1.5 m/s 上限（不信內部 maxWorldSpeedSeen 的自我回報）',maxSpeed<=1.5+.05,{maxSpeed:+maxSpeed.toFixed(4),maxSpeedAt});

  const holderCheck=await p.evaluate(()=>{const api=shifenPreview,vs=api.visitorState();return api.visitorInfo().holderIndices.map(i=>vs[i]?.holdsLantern===true);});
  check(engine+' 手持天燈的人數與名冊一致（4 人）、天燈幾何實際存在',holderCheck.length===4&&holderCheck.every(Boolean)&&(await p.evaluate(()=>!!shifenPreview.visitorLantern(0))),holderCheck);
  await p.evaluate(()=>shifenPreview.setTime(0));await p.tap('#reset');await settle(p);

  await panChecks({b,engine,URL,api:'shifenPreview',check,settle});   // 鏡頭平移（四頁共用的判準，在自己開的桌面頁與觸控頁上量）
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

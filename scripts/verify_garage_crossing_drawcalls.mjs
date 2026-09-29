// 街角平交道（rail-3d/garage-scenes/crossing.js）draw call 預算驗收。
// 判準只量「實際畫出來的東西」：renderer.info.render.calls／triangles（主 pass；three r170 的陰影 pass 不算在內）。
//   1. 三種編組 × 四時段 × 兩種鏡頭 × 一個循環內 24 個時間點，每格 calls 最大值 <= 135。
//   2. 場景本體（隱藏列車）calls 不得回到合併前的量級，三角形逐點不高於合併前（改前 89fe15b7 實測值內嵌於此，僅限本腳本固定的 1400x900、預設鏡頭）。
//      已知取捨：合併後車輛與其他跨全景的零件各成一顆，失去「個別零件被視錐剔除」；長寬比 >= 1.8 的「陪它走走」少數時間點
//      場景本體會多畫最多約 600 個三角形（實測 1920x1080 在一個循環 48 點中有 1 點 +450），換來 draw call 282 → 27。
//   3. 世界鏡頭下場景本體三角形與合併前逐點完全相同——少了東西（例如某組合併物件沒加進場景）會在這裡變紅，
//      只看上限抓不到「少畫」，所以這條是雙向的。
//   4. 動態件沒被併壞：遮斷桿放下／升起時桿臂位置、車流通行時車頂的高度（射線探測），兩個引擎都要對。
// 固定條件：viewport 1400x900、dpr 1、停掉播放；每個時間點 setTime→render 之後才讀數字。
// 引擎：chromium（真 Chrome 無視窗）＋webkit（無視窗）；一律無視窗。環境變數 GARAGE_BASE_URL 指向要驗的站。
import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const GARAGE_SITE=process.env.GARAGE_BASE_URL||'http://127.0.0.1:5291';
const OUT='output/garage-crossing-drawcalls';mkdirSync(OUT,{recursive:true});
const LIMIT=135,SAMPLES=24,SCENE_ONLY_LIMIT=40;
// 改動前（HEAD 89fe15b7、未合併）場景本體 calls 為 282（全在視錐內）／105–241（陪它走走），三角形如下，取樣點 t=i*(180/2.6)/24。
const BASE_TRIANGLES={
 world:[58704,58704,58704,58704,58704,58704,58704,58704,58704,58704,58704,58456,58392,58704,58704,58704,58704,58704,58704,58704,58704,58704,58704,58704],
 train:[55074,55074,55946,57632,58076,58184,55694,54998,54998,55178,55178,55058,54998,54998,54998,54998,55074,55074,55074,55074,55074,55074,55074,55074]
};
const results=[];
function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));}
const ENGINES=(process.env.GARAGE_ENGINES||'chromium,webkit').split(',');   // 只跑一個引擎時：GARAGE_ENGINES=chromium
for(const [engine,type]of Object.entries({chromium,webkit}).filter(([e])=>ENGINES.includes(e))){
 const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const page=await(await browser.newContext({viewport:{width:1400,height:900},deviceScaleFactor:1})).newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${GARAGE_SITE}/prototypes/garage-crossing/`);
  await page.waitForFunction(()=>window.newScenePreview?.state.ready,null,{timeout:120000});
  if((await page.evaluate(()=>newScenePreview.state)).running)await page.click('#play');
  // 1. 三種編組 × 四時段 × 兩鏡頭
  const table={};
  for(const model of ['dr1000','blue','emu3000']){
   if((await page.evaluate(()=>newScenePreview.state.model))!==model){await page.selectOption('#train',model);await page.waitForFunction(id=>newScenePreview.state.model===id&&!newScenePreview.state.changing,model,{timeout:120000});}
   table[model]=await page.evaluate(({SAMPLES})=>{
    const api=newScenePreview,cycle=180/2.6,cells={};
    for(const period of ['dawn','day','sunset','night'])for(const view of ['world','train']){
     document.querySelector(`[data-period="${period}"]`).click();api.setView(view);
     let calls=0,triangles=0,at=0;
     for(let i=0;i<SAMPLES;i++){const t=i*cycle/SAMPLES;api.setTime(t);api.render();const s=api.state;if(s.calls>calls){calls=s.calls;at=+t.toFixed(2);}triangles=Math.max(triangles,s.triangles);}
     cells[`${period}/${view}`]={calls,triangles,at};
    }
    return cells;},{SAMPLES});
  }
  const worst=Object.entries(table).flatMap(([model,cells])=>Object.entries(cells).map(([cell,v])=>({model,cell,...v}))).sort((a,b)=>b.calls-a.calls)[0];
  const over=Object.entries(table).flatMap(([model,cells])=>Object.entries(cells).filter(([,v])=>v.calls>LIMIT).map(([cell,v])=>({model,cell,...v})));
  check(`${engine} 三種編組 × 四時段 × 兩鏡頭 draw call 最大值 <= ${LIMIT}`,over.length===0,{worst,over});
  // 2、3. 場景本體
  await page.selectOption('#train','dr1000');await page.waitForFunction(()=>newScenePreview.state.model==='dr1000'&&!newScenePreview.state.changing);
  const only=await page.evaluate(({SAMPLES})=>{
   const api=newScenePreview,cycle=180/2.6,r={};
   document.querySelector('[data-period="day"]').click();api.trainVisible(false);
   for(const view of ['world','train']){api.setView(view);r[view]=[];for(let i=0;i<SAMPLES;i++){api.setTime(i*cycle/SAMPLES);api.render();const s=api.state;r[view].push({calls:s.calls,triangles:s.triangles});}}
   api.trainVisible(true);return r;},{SAMPLES});
  for(const view of ['world','train']){
   const calls=only[view].map(x=>x.calls),tri=only[view].map(x=>x.triangles),grew=tri.map((v,i)=>v>BASE_TRIANGLES[view][i]?{i,tri:v,base:BASE_TRIANGLES[view][i]}:null).filter(Boolean);
   check(`${engine} 場景本體（無列車）${view} draw call <= ${SCENE_ONLY_LIMIT}`,Math.max(...calls)<=SCENE_ONLY_LIMIT,{max:Math.max(...calls),min:Math.min(...calls)});
   check(`${engine} 場景本體 ${view} 三角形逐點不高於合併前`,grew.length===0,{grew,max:Math.max(...tri),baseMax:Math.max(...BASE_TRIANGLES[view])});
  }
  const differ=only.world.map((x,i)=>x.triangles!==BASE_TRIANGLES.world[i]?{i,tri:x.triangles,base:BASE_TRIANGLES.world[i]}:null).filter(Boolean);
  check(`${engine} 場景本體 world 三角形與合併前逐點完全相同（沒有少畫）`,differ.length===0,{differ});
  // 4. 動態件：合併成動態 mesh 之後，桿臂與車輛仍跟著當下的姿態走。
  //    遮斷桿：桿臂是一片連續的斜面，上表面高度＝軸心高 1.33 ＋ 水平距離×tan(仰角) ＋ 半厚 0.06/cos(仰角)，
  //    放下、全關、升起的各個角度都用射線（probeDown）實測比對；全開（桿臂直立）時桿臂原位置不能還留著一支橫桿（桿臂全關時同一個探測點會打到 1.39）。
  //    車輛：通行中的轎車車頂板高 1.68（離開停止線 4.3 m 以外、電車線 3 m 以外，不受路面爬升與電車線干擾）。
  const dyn=await page.evaluate(({SAMPLES})=>{
   const api=newScenePreview,cycle=180/2.6,r={gates:[],open:[],cars:[]};
   document.querySelector('[data-period="day"]').click();api.setView('world');
   for(let i=0;i<SAMPLES;i++){
    const t=i*cycle/SAMPLES;api.setTime(t);api.render();const s=api.state.scene,rnd=v=>v===null?null:+v.toFixed(3);
    s.gates.forEach((rot,gi)=>{const side=gi?1:-1,th=Math.abs(rot),at=dx=>api.probeDown([side*3.25-side*dx,-side*4.6,6]);
     if(th<=1.2)r.gates.push({t:+t.toFixed(2),side,th:+th.toFixed(3),pred:+(1.33+.8*Math.tan(th)+.06/Math.cos(th)).toFixed(3),hit:rnd(at(.8))});
     else if(th>=1.5)r.open.push({t:+t.toFixed(2),side,hit:rnd(at(2.75))});});   // 距桿座 2.75 m 處是兩條車道之間的空隙，通行的車不會壓到
    s.vehicles.forEach((v,vi)=>{if(v.length>=2&&Math.abs(v.y)>4.3&&Math.abs(v.y)<15)r.cars.push({t:+t.toFixed(2),vi,y:+v.y.toFixed(2),hit:rnd(api.probeDown([v.x,v.y-.1*v.dir,6]))});});
   }
   return r;},{SAMPLES:480});
  const gateErr=dyn.gates.map(g=>g.hit===null?9:Math.abs(g.hit-g.pred)),carErr=dyn.cars.map(c=>c.hit===null?9:Math.abs(c.hit-1.68));
  const angles=new Set(dyn.gates.map(g=>Math.round(g.th*10)/10)),worstOpen=Math.max(...dyn.open.map(o=>o.hit===null?0:o.hit));
  check(`${engine} 遮斷桿桿臂高度與當下仰角一致（放下、全關、升起）`,dyn.gates.length>=40&&angles.size>=6&&Math.max(...gateErr)<=.03,{samples:dyn.gates.length,angles:[...angles].sort(),maxErr:+Math.max(...gateErr).toFixed(4),worst:dyn.gates[gateErr.indexOf(Math.max(...gateErr))]});
  check(`${engine} 遮斷桿全開時桿臂原位置沒有殘留橫桿`,dyn.open.length>=20&&worstOpen<=.5,{samples:dyn.open.length,worstHit:worstOpen});
  check(`${engine} 通行中的轎車車頂在該有的位置`,dyn.cars.length>=20&&new Set(dyn.cars.map(c=>c.vi)).size>=3&&Math.max(...carErr)<=.02,{samples:dyn.cars.length,cars:[...new Set(dyn.cars.map(c=>c.vi))],maxErr:+Math.max(...carErr).toFixed(4),worst:dyn.cars[carErr.indexOf(Math.max(...carErr))]});
  check(`${engine} 無程式錯誤`,!errors.length,errors);
  writeFileSync(`${OUT}/${engine}-table.json`,JSON.stringify({table,only,dyn},null,1));
  await page.close();
 }finally{await browser.close();}
}
writeFileSync(`${OUT}/verification.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;

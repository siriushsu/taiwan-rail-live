// 「透視顯示」切到「實體」時，地下列車要用實色車體畫出來——這是顯示層的事，
// 只驗旗標傳到哪裡不算數，要量畫面上真的變不透明。
// 判準刻意分兩層：poseSamples 的 translucent 是實作自己的回報（同源，只能當前置條件），
// 真正的證據是「同一狀態下有車 vs 沒車」的像素差——實色的差量必須明顯大於半透明。
// 每個狀態各自取自己的背景底片，否則建築在兩個狀態下的透明度差異會混進遮罩。
import fs from 'node:fs';import {chromium,webkit}from'playwright';
import {createRequire} from 'node:module';const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const base=process.env.BASE_URL||'http://127.0.0.1:5179/',out='output/underground-solid';fs.mkdirSync(out,{recursive:true});const rows=[];
// 台北車站的淡水信義線：確定在地下，兩個方向各一列，畫面上有足夠像素可量。
const STATION='台北車站',KEY='mrt:R';

function meanDiff(a,b){const d=new Float64Array(a.length/4);for(let i=0,k=0;i<a.length;i+=4,k++)d[k]=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return d;}

for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch(),page=await browser.newPage({viewport:{width:1100,height:820},locale:'zh-TW'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  await page.goto(base+'?g=all&scene=3d&map=landscape&t=08:00');
  // 本機沒有即時來源，state.ready 永遠不成立；只等 3D 這層就緒。M 與 state 都是詞法全域，不掛在 window 上。
  await page.waitForFunction(()=>window.railIslandPhysical?.metro&&window.railIslandIntegration?.renderer&&typeof M!=='undefined',null,{timeout:120000});
  await page.evaluate(async ({station,key})=>{
   // 停掉模擬時鐘：2D 車號牌是另一層 HTML 標記，會繼續隨時間移動，
   // 兩張截圖之間就有背景差（WebKit 較慢，實測 6.5；chromium 只有 0.2）。
   railIslandIntegration.render=()=>{};try{state.playing=false;clearFollow?.();}catch(e){}
   const pack=await(await fetch('rail-3d/physical/metro-network.json')).json(),frame=railIslandIntegration.capture(),vehicles=[];
   for(const dir of [1,-1]){
    const record=pack.routes[key+':'+dir],route=railIslandPhysical.metro.geometry.route(record.pathIds,key.split(':')[0],'#d34545',{prefixM:160,suffixM:160});
    const s=route.offsets[record.stationNames.indexOf(station)],coordinate=route.path.at(s).coordinate;
    vehicles.push({id:key+':'+dir,systemId:key.split(':')[0],routeId:key.split(':')[1],longitude:coordinate[0],latitude:coordinate[1],route,chainageM:s,railDirection:1,sourceKind:'timetable',followed:false,color:'#d34545'});
   }
   // 底片要留著地下軌道線，只拿掉車：display.enabled=false 會連整層 3D 一起關掉，量到的就不是車了。
   window.__u=(withTrains=true)=>railIslandIntegration.renderer.update({...frame,vehicles:withTrains?vehicles:[],routes:vehicles.map(v=>v.route),display:{...frame.display,enabled:true,modelMode:'all'},followLock:false,selectedVehicleId:null});
   M.raw.jumpTo({center:[vehicles[0].longitude,vehicles[0].latitude],zoom:17,pitch:55,bearing:15});
   __u();
  },{station:STATION,key:KEY});
  await page.waitForFunction(()=>{__u();return railIslandIntegration.renderer.stats.models===2;},null,{timeout:60000});
  // 切開關會讓內部 render() 拿真實 frame 重畫，連地下軌道線也換成全網路的；線段數要回到測試 frame 這一份，
  // 不然兩個狀態的背景就不一樣（WebKit 實測差 6.5，chromium 只差 0.22——只在一個引擎上出現的假綠）。
  const expectRails=await page.evaluate(()=>railIslandIntegration.renderer.stats.undergroundRailSegments);

  const shots={};let box=null;
  for(const [mode,on]of [['透視',true],['實體',false]]){
   // setInspection 走的是使用者按鈕的同一條路（setOption），它自己會用真實班表的 frame 重畫一次，
   // 測試車的車模會被當成不在畫面上的車清掉、重建又是非同步的；所以要重打 __u() 直到兩列車都回來。
   await page.evaluate(on=>railIslandIntegration.setInspection(on),on);
   // 建築也吃同一個開關,兩個狀態的背景對比會不一樣,那會混進「車體差多少」的量測裡
   // （突變測試證實:不關建築時,把開關拿掉的突變在 WebKit 仍然假綠）。這裡把建築關掉,
   // 讓兩個狀態唯一的差別就是車身材質;下面還有一條底片相等的對照在守這件事。
   await page.evaluate(on=>railIslandIntegration.renderer.setAppearance({buildings:false,dark:false,transparent:on,satellite:false,landscape:true}),on);
   await page.waitForFunction(n=>{__u();const s=railIslandIntegration.renderer.stats;return s.models===2&&s.undergroundRailSegments===n;},expectRails,{timeout:60000});
   await page.evaluate(()=>{__u();M.raw.triggerRepaint();});await page.waitForTimeout(600);
   // 刻意不在這裡再呼叫一次 __u()：要證明畫面上留著的就是剛才那一幀，沒有被別的東西蓋掉。
   const detail=await page.evaluate(()=>{const s=railIslandIntegration.renderer.stats;return {models:s.models,undergroundModels:s.undergroundModels,rails:s.undergroundRailSegments,
     underground:s.poseSamples.every(p=>p.cars.every(c=>c.underground)),translucent:s.poseSamples.every(p=>p.cars.every(c=>c.translucent===true)),solid:s.poseSamples.every(p=>p.cars.every(c=>c.translucent===false)),errors:s.errors};});
   // 前置條件：兩個狀態都要真的有兩列地下車、地下軌道線也照舊在畫（實體只換車身，不動軌道）。
   rows.push({engine,mode,test:'地下列車與地下軌道線都在，車身透明度跟著開關走',
     pass:detail.models===2&&detail.undergroundModels===2&&detail.rails===expectRails&&detail.underground&&(on?detail.translucent:detail.solid)&&!detail.errors.length,detail});
   if(!box)box=await page.evaluate(()=>{const s=railIslandIntegration.renderer.stats,r=M.raw.getCanvas().getBoundingClientRect();
     const pts=s.poseSamples.flatMap(p=>p.cars.map(c=>M.raw.project(c.coordinate)));
     const xs=pts.map(q=>q.x+r.left),ys=pts.map(q=>q.y+r.top);
     return {x0:Math.floor(Math.min(...xs)-30),x1:Math.ceil(Math.max(...xs)+30),y0:Math.floor(Math.min(...ys)-45),y1:Math.ceil(Math.max(...ys)+45)};});
   shots[mode]=PNG.sync.read(await page.screenshot({path:`${out}/${engine}-${mode}-有車.png`})).data;
   await page.evaluate(()=>{__u(false);M.raw.triggerRepaint();});await page.waitForTimeout(600);
   shots[mode+':底']=PNG.sync.read(await page.screenshot({path:`${out}/${engine}-${mode}-無車.png`})).data;
   await page.evaluate(()=>{__u(true);M.raw.triggerRepaint();});
  }
  // 遮罩取「實體狀態下車體蓋到的像素」，而且只看列車所在的那個框：整張畫面比會被建築透明度與圖磚載入蓋過去。
  const dT=meanDiff(shots['透視'],shots['透視:底']),dS=meanDiff(shots['實體'],shots['實體:底']),W=1100;
  let n=0,sumT=0,sumS=0;
  for(let y=Math.max(0,box.y0);y<box.y1;y++)for(let x=Math.max(0,box.x0);x<box.x1;x++){const k=y*W+x;if(dS[k]>25){n++;sumT+=dT[k];sumS+=dS[k];}}
  const meanT=n?sumT/n:0,meanS=n?sumS/n:0,area=(box.x1-box.x0)*(box.y1-box.y0);
  // 對照組:兩個狀態的「無車」底片在這一塊必須幾乎一樣,否則量到的是背景不是車。
  const dB=meanDiff(shots['透視:底'],shots['實體:底']);let bn=0,bsum=0;
  for(let y=Math.max(0,box.y0);y<box.y1;y++)for(let x=Math.max(0,box.x0);x<box.x1;x++){bn++;bsum+=dB[y*W+x];}
  const meanBase=bn?bsum/bn:0;
  rows.push({engine,test:'兩個狀態的背景相同（量到的差是車不是背景）',pass:meanBase<3,meanBase:+meanBase.toFixed(2)});
  // 半透明 .42 對實色 1，車體內外面又各混一次，實測比值約 1.6–2.4；門檻放 1.5。
  // meanT>5 是反向對照：半透明的車必須還看得見，「車根本沒畫出來」不可以算過。
  rows.push({engine,test:'實體的車身像素差量明顯大於半透明',pass:n>300&&n<area*.9&&meanT>5&&meanS>meanT*1.5,
    pixels:n,area,box,meanTranslucent:+meanT.toFixed(1),meanSolid:+meanS.toFixed(1),ratio:+(meanS/(meanT||1)).toFixed(2)});
  console.log(engine,rows.at(-1));
  // 使用者真的會碰到的是那顆按鈕：驗它掛在同一條路上，而不是只驗程式介面。
  const ui=await page.evaluate(()=>{const row=document.querySelector('[data-rail3d="inspection"]');if(!row)return {why:'找不到透視顯示那一列'};
    const solid=[...row.querySelectorAll('button')].find(b=>b.dataset.value==='off');solid.click();
    return {name:row.querySelector('.nm')?.textContent,buttons:[...row.querySelectorAll('button')].map(b=>b.textContent),pressed:solid.getAttribute('aria-pressed')};});
  rows.push({engine,test:'設定裡那一列叫「透視顯示」，按「實體」真的會切過去',
    pass:ui.name==='透視顯示'&&ui.buttons?.join('／')==='透視／實體'&&ui.pressed==='true',ui});
  rows.push({engine,test:'無頁面錯誤',pass:!errors.length,errors:errors.slice(0,3)});
 }catch(e){rows.push({engine,pass:false,error:String(e)});console.log(e);}finally{await browser.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(rows,null,2));
const failed=rows.filter(r=>!r.pass);console.log({checks:rows.length,failed:failed.length});if(failed.length){console.log(failed);process.exitCode=1;}

// 近景裁切不能改列車位置、路網或公開 capture()，也不能漏掉任何一種跟隨來源。
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5248/',results=[];
fs.mkdirSync('output/3d-capture-scope',{recursive:true});
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-TW'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  await page.goto(base+'?g=all&scene=3d&t=12:00');
  await page.waitForFunction(()=>state.ready&&state.trains.length&&window.railIslandPhysical?.metro&&window.railIslandIntegration?.renderer,null,{timeout:120000});
  const checks=await page.evaluate(()=>{
   const checks=[],saved={ready:state.ready,mode:state.mode,lines:state.lines,deco:state.deco,decoLines:state.decoLines,visible:state.visible,followTrain:state.followTrain,freqFollow:state.freqFollow};
   const core=metroCoreItemsForLine,official=trtcOfficialItemsForLine,step=trtcOfficialMotionStep,locate=freqTrainPosAt,sample=railIslandPhysical.metro.sample;
   const check=(label,ok,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail));checks.push({label,...detail});};
   const key=v=>({id:v.id,longitude:v.longitude,latitude:v.latitude,chainageM:v.chainageM,railDirection:v.railDirection,direction:v.direction,sourceKind:v.sourceKind,followed:v.followed});
   try{
    state.ready=false;state.playing=false;state.simSec=43200;state.followTrain=null;state.freqFollow=null;state.deco=true;
    metroCoreItemsForLine=trtcOfficialItemsForLine=()=>null;
    let locateCalls=0,sampleCalls=0;
    freqTrainPosAt=(...args)=>{locateCalls++;return locate(...args);};
    railIslandPhysical.metro.sample=(...args)=>{sampleCalls++;return sample(...args);};
    for(const [seed,pitch,bearing]of [[[121.517,25.0478],0,0],[[121.517,25.0478],70,165],[[120.302,22.639],60,0]]){
     // 選這個地區實際在途的一班作為視口中心，不能用固定秒數／固定車站冒充畫面有車。
     const anchor=railIslandIntegration.capture().vehicles.sort((a,b)=>Math.hypot(a.longitude-seed[0],a.latitude-seed[1])-Math.hypot(b.longitude-seed[0],b.latitude-seed[1]))[0],center=[anchor.longitude,anchor.latitude];
     M.raw.jumpTo({center,zoom:17,pitch,bearing});
     locateCalls=sampleCalls=0;const full=railIslandIntegration.capture(),fullCalls={locate:locateCalls,sample:sampleCalls};
     locateCalls=sampleCalls=0;const cropped=railIslandIntegration.capture({cull:true}),croppedCalls={locate:locateCalls,sample:sampleCalls};
     const all=new Map(full.vehicles.map(v=>[v.id,v])),bounds=M.raw.getBounds(),near=full.vehicles.filter(v=>bounds.contains([v.longitude,v.latitude]));
     check('公開資料保留全台、近景確實減少定位',full.vehicles.length>100&&cropped.vehicles.length<full.vehicles.length&&croppedCalls.locate<fullCalls.locate&&croppedCalls.sample<fullCalls.sample,{center,pitch,bearing,full:full.vehicles.length,cropped:cropped.vehicles.length,fullCalls,croppedCalls});
     check('畫面內列車不漏、保留車輛座標與方向不變',near.length>0&&near.every(v=>cropped.vehicles.some(c=>c.id===v.id))&&cropped.vehicles.every(v=>JSON.stringify(key(v))===JSON.stringify(key(all.get(v.id)))),{center,near:near.length});
     check('路網與站點不裁切',JSON.stringify(cropped.routes.map(r=>r.id))===JSON.stringify(full.routes.map(r=>r.id))&&JSON.stringify(cropped.stations)===JSON.stringify(full.stations),{routes:full.routes.length,stations:full.stations.length});
    }
    M.raw.jumpTo({center:[120.302,22.639],zoom:17,pitch:60,bearing:0});
    state.followTrain=state.trains.find(tr=>tr.sys==='tra_sched'&&tr.train==='117');
    let frame=railIslandIntegration.capture({cull:true});
    check('遠離鏡頭的台鐵跟隨車保留',!!frame.selectedVehicleId&&frame.vehicles.some(v=>v.id===frame.selectedVehicleId&&v.followed&&v.publicLabel==='117'),{});
    state.followTrain=null;
    const ln=state.decoLines.find(ln=>ln._sys==='mrt'&&ln.id==='R'),tr=ln._tt.find(tr=>locate(ln,tr,state.simSec));
    check('真實北捷班表樣本在途',!!tr,{});
    for(const mode of ['sched','freq']){
     state.mode=mode;state.lines=[ln];state.visible=mode==='freq'?new Set([ln.id]):saved.visible;
     state.freqFollow={ln,tr};frame=railIslandIntegration.capture({cull:true});
     check(mode+' 班表跟隨車保留',!!frame.selectedVehicleId&&frame.vehicles.some(v=>v.id===frame.selectedVehicleId&&v.sourceKind==='timetable'&&v.followed),{});
     // 沒有 ln 屬性的兩種真實跟隨形狀。受控名冊提供固定位置，避免牆鐘與網路左右結果。
     const pos={lat:ln.stations[5].lat,lon:ln.stations[5].lon,progress:5},item={systemId:freqSysIdOf(ln),vehicleId:'scope-test',pos,train:{direction:1,trajectory:[{progress:5},{progress:6}]},vehicle:{direction:1}};
     for(const kind of ['core','official']){
      metroCoreItemsForLine=l=>l===ln&&kind==='core'?[item]:null;
      trtcOfficialItemsForLine=l=>l===ln&&kind==='official'?[item]:null;
      trtcOfficialMotionStep=()=>1;
      state.freqFollow=null;frame=railIslandIntegration.capture({cull:true});
      check(mode+' '+kind+' 遠方線無跟隨時略過',!frame.vehicles.some(v=>v.id.endsWith(':scope-test')),{});
      state.freqFollow=kind==='core'?{core:true,systemId:item.systemId,lineId:ln.id,vehicleId:item.vehicleId}:{official:true,lineId:ln.id,vehicleId:item.vehicleId};
      frame=railIslandIntegration.capture({cull:true});
      check(mode+' '+kind+' 無 ln 的跟隨車保留',!!frame.selectedVehicleId&&frame.vehicles.some(v=>v.id===frame.selectedVehicleId&&v.sourceKind===kind&&v.followed),{});
     }
     metroCoreItemsForLine=trtcOfficialItemsForLine=()=>null;
     // 有班表的路線不預建班距迴圈；用既有建置函式製作同一條真實線形的 fallback fixture。
     const fallback={...ln,_tt:null,n:2,_speed:40};buildLineSchedule(fallback);state.lines=[fallback];state.decoLines=[fallback];state.freqFollow={ln:fallback,k:0};
     frame=railIslandIntegration.capture({cull:true});
     check(mode+' 班距示意跟隨車保留',!!frame.selectedVehicleId&&frame.vehicles.some(v=>v.id===frame.selectedVehicleId&&v.sourceKind==='frequency'&&v.followed),{});
     state.freqFollow=null;
    }
    return checks;
   }finally{
    Object.assign(state,saved);metroCoreItemsForLine=core;trtcOfficialItemsForLine=official;trtcOfficialMotionStep=step;freqTrainPosAt=locate;railIslandPhysical.metro.sample=sample;
   }
  });
  results.push({name,checks,errors});console.log(name,JSON.stringify(checks));assert.equal(errors.length,0);
 }finally{await browser.close();}
}
fs.writeFileSync('output/3d-capture-scope/results.json',JSON.stringify(results,null,2));console.log('PASS 雙引擎近景裁切、全台 API、路網與各類跟隨來源');

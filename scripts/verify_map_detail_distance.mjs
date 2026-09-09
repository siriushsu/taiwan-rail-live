import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const out='output/detail-distance';fs.mkdirSync(out,{recursive:true});const results=[];
function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
for(const [name,engine]of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:({chromium,webkit})[process.env.ENGINE]}:{chromium,webkit})){
 const b=await engine.launch({headless:process.env.HEADFUL!=='1'});
 for(const width of (process.env.WIDTHS||'414,1280').split(',').map(Number)){
  const ctx=await b.newContext({viewport:{width,height:900},locale:'zh-TW',isMobile:width<900,hasTouch:true});await ctx.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));await p.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
  try{
   await p.goto('http://127.0.0.1:5236/?map=landscape&scene=3d&ground=terrain&at=22.974,120.227&z=13.5&t=13:31&sun=on&lang=zh-TW');await p.waitForFunction(()=>state.ready&&railIslandIntegration.renderer&&!railIslandIntegration.loading,null,{timeout:90000});
   await p.evaluate(()=>{state.playing=false;document.body.classList.add('fs');M.resize();M.raw.jumpTo({center:[120.227,22.974],zoom:13.5,pitch:75,bearing:0});setSimSec(48660);});await p.waitForFunction(()=>M.raw.isSourceLoaded('terrain'),null,{timeout:60000});
   for(const ground of ['terrain','flat'])for(const pitch of [45,60,75]){
    await p.evaluate(({ground,pitch})=>{railIslandIntegration.setGroundMode(ground);M.raw.setPitch(pitch);reproject();draw();},{ground,pitch});
    const r=await p.evaluate(()=>{const far=labelBoxes.filter(x=>/臺北|台北|基隆|桃園|大園|山鼻|文心|北屯/.test(x.name));const invalidTrains=state._trainHits.filter(h=>{const pos=trainPos(h.tr,state.simSec);return M.detailOpacity([pos.lat,pos.lon])<=0;});const invalidMetro=[...state.lines,...(state.decoLines||[])].flatMap(ln=>(ln.pts||[]).map((p,i)=>({p,s:ln.stations[i]}))).filter(x=>M.detailOpacity([x.s.lat,x.s.lon])<=0&&(x.p.detailOpacity??1)>0);return {far,invalidTrains:invalidTrains.length,invalidMetro:invalidMetro.length,alpha:[M.detailOpacity([22.997,120.212]),M.detailOpacity([25.047,121.517]),M.detailOpacity([25.132,121.739])],labels:labelBoxes.length,hits:state._trainHits.length};});
    check(`${name} ${width} ${ground} ${pitch} 遠站／車牌／兩種捷運資料共用距離範圍`,!r.far.length&&!r.invalidTrains&&!r.invalidMetro&&r.alpha[0]===1&&r.alpha[1]===0&&r.alpha[2]===0&&r.labels>0,r);
   }
   const fade=await p.evaluate(()=>{const values=[];for(let lat=22.974;lat<23.7;lat+=.001)values.push(M.detailOpacity([lat,120.227]));const point=M.toScreen([22.997,120.212]),raw=M.raw.project([120.212,22.997]);return {intermediate:values.filter(x=>x>0&&x<1).length,largestStep:Math.max(...values.slice(1).map((x,i)=>Math.abs(x-values[i]))),monotone:values.every((v,i)=>!i||v<=values[i-1]),delta:Math.hypot(point.x-raw.x,point.y-raw.y),tail:values.at(-1)};});
   check(`${name} ${width} 距離漸變且座標不位移`,fade.intermediate>10&&fade.largestStep<.06&&fade.monotone&&fade.delta===0&&fade.tail===0,fade);
   // 真實觸控附近車站，命中仍沿用相同的投影座標。
   await p.evaluate(()=>{railIslandIntegration.setGroundMode('terrain');const s=state.schedStations.find(s=>s.name==='大橋');M.raw.jumpTo({center:[s.lon,s.lat],zoom:15,pitch:55});});await p.waitForTimeout(350);
   const target=await p.evaluate(()=>{const r=M.getContainer().getBoundingClientRect();return state.schedStations.map(s=>({s,p:mapDetailPoint([s.lat,s.lon])})).find(({p})=>p.detailOpacity===1&&p.x>70&&p.x<r.width-80&&p.y>170&&p.y<r.height-160&&state._trainHits.every(h=>Math.hypot(h.x-p.x,h.y-p.y)>50)&&document.elementFromPoint(r.x+p.x,r.y+p.y)===M.raw.getCanvas())&&(()=>{const v=state.schedStations.map(s=>({s,p:mapDetailPoint([s.lat,s.lon])})).find(({p})=>p.detailOpacity===1&&p.x>70&&p.x<r.width-80&&p.y>170&&p.y<r.height-160&&state._trainHits.every(h=>Math.hypot(h.x-p.x,h.y-p.y)>50)&&document.elementFromPoint(r.x+p.x,r.y+p.y)===M.raw.getCanvas());return {x:r.x+v.p.x,y:r.y+v.p.y,name:v.s.name};})();});
   if(target){await p.touchscreen.tap(target.x,target.y);await p.waitForTimeout(200);check(`${name} ${width} 近站真觸控命中`,await p.evaluate(n=>state.boardStation?.name===n||document.getElementById('tapPick')?.textContent.includes(n),target.name),target);await p.evaluate(()=>closeBoard());}else check(`${name} ${width} 找到可點近站`,false);
   await p.evaluate(()=>{M.raw.jumpTo({center:[120.227,22.974],zoom:13.5,pitch:75,bearing:0});});await p.screenshot({path:`${out}/${name}-${width}-tainan.png`});
   await p.evaluate(()=>{M.raw.setPitch(0);reproject();draw();});check(`${name} ${width} 回俯視恢復完整範圍`,await p.evaluate(()=>M.detailOpacity([25.132,121.739])===1));
   check(`${name} ${width} 無頁面例外`,errors.length===0,errors);
  }catch(e){check(`${name} ${width} 完成流程`,false,String(e.stack));}finally{await ctx.close();}
 }
 await b.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(x=>!x.pass))process.exitCode=1;

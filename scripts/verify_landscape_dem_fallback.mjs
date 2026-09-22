// 地景底圖是唯一預設「起伏」的底圖，所以只有它會把立體列車押在 DEM 上：高程讀不到時列車一台都
// 不畫，不報錯也不重試，使用者看到的就是「地景沒有立體列車」（2026-09-18 Android 回報）。
// 這支閘門把地形分片擋掉當作「DEM 不會到」，驗列車仍然畫得出來，並以同一條件的正向對照
// （分片正常）確認沒有退場時仍然用真正的地形高程——少了正向對照，整支腳本改成「一律平坦」也會通過。
import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5228/',out='output/landscape-dem-fallback';fs.mkdirSync(out,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
// 苗栗山線，實測地形高程約 203 公尺；退成平坦時同一台車會落在個位數公尺。
const TERRAIN_M=50,FLAT_M=10;
async function boot(p){
 await p.goto(base+'?map=landscape&scene=3d&g=all&train=117&t=12:00&lang=zh-TW');
 await p.waitForFunction(()=>state.ready&&state.followTrain,null,{timeout:120000});
 await p.evaluate(()=>{state.playing=false;setSimSec(43200);M.raw.setZoom(17);});
 await p.waitForFunction(()=>!!railIslandIntegration?.renderer&&!railIslandIntegration?.loading,null,{timeout:60000});
}
// 列車模型是逐台非同步組出來的；等 models 真的長出來，不是等固定秒數。
async function models(p,timeout=60000){const t0=Date.now();
 while(Date.now()-t0<timeout){const n=await p.evaluate(()=>railIslandIntegration?.renderer?.stats?.models??0);if(n>0)return n;await p.waitForTimeout(500);}
 return 0;}
const sample=p=>p.evaluate(()=>{const s=railIslandIntegration.renderer.stats;
 return {models:s.models,demUnavailable:!!s.demUnavailable,groundMode:s.groundMode,terrain:!!M.raw.getTerrain(),
  displayHeightM:s.poseSamples?.[0]?.displayHeightM??null};});
for(const [name,engine]of Object.entries(process.env.ENGINE?{[process.env.ENGINE]:({chromium,webkit})[process.env.ENGINE]}:{chromium,webkit})){
 const browser=await engine.launch({headless:process.env.HEADFUL!=='1'});
 for(const dem of [false,true]){
  const context=await browser.newContext({viewport:{width:1360,height:980},locale:'zh-TW'});
  await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');});
  const p=await context.newPage();
  // 固定營運資料退回班表，與其他地景閘門一致；不偽造衛星授權。
  await p.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  // 只擋分片，不擋 manifest.json：manifest 一擋，registerTerrainProtocol 整個建不起來，
  // 連平面底圖的立體列車都會一起沒有，測到的就不是地景這條路。
  if(!dem)await p.route('**/rail-3d/terrain/*.bin',r=>r.abort());
  try{
   await boot(p);const n=await models(p),s=await sample(p);
   if(dem){
    check(name+' 地形正常時仍用真正的高程',n>0&&s.displayHeightM>TERRAIN_M&&!s.demUnavailable,s);
   }else{
    check(name+' 地形取不到時地景仍畫得出立體列車',n>0,s);
    check(name+' 退場改用平坦高度並留下明確訊號',s.displayHeightM!==null&&s.displayHeightM<FLAT_M&&s.demUnavailable,s);
   }
   // 截圖只是佐證，不是判準：底圖字形拿不到時 Playwright 會卡在等字型，不該把判準拖成失敗。
   await p.screenshot({path:out+'/'+name+'-'+(dem?'dem':'nodem')+'.png',timeout:15000}).catch(()=>{});
  }catch(e){check(name+' '+(dem?'地形正常':'地形取不到')+' 流程',false,String(e));}
  await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
console.log(results.filter(r=>r.pass).length+'/'+results.length+' 通過');if(results.some(r=>!r.pass))process.exitCode=1;

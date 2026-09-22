import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=process.env.BASE_URL||'http://127.0.0.1:5228/';
const repo=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
// 開跑前先確認 BASE_URL 服的是這棵樹。2026-09-12 踩過：預設的 5228 被一支跑了四天的舊 server 佔住,
// `curl` 照樣回 200、閘門照樣全綠,量到的卻全是四天前的樹。只加連線逾時擋不住這種——要比對內容。
{
  const localBuild=/^const BUILD = '([^']+)'/m.exec(fs.readFileSync(path.join(repo,'index.html'),'utf8'))?.[1];
  let served=null;
  try{const r=await fetch(base);if(!r.ok)throw Error('HTTP '+r.status);served=/const BUILD = '([^']+)'/.exec(await r.text())?.[1];}
  catch(e){console.error(`FAIL 前置 ${base} 連不上（${e.message}）——先起 server 再跑`);process.exit(1);}
  if(!served||served!==localBuild){
    console.error(`FAIL 前置 ${base} 服的是 BUILD ${served??'(讀不到)'},本機 index.html 是 ${localBuild}——那個埠上是別棵樹`);
    process.exit(1);}
  console.log(`前置：${base} 服的是 BUILD ${served}，與本機相同`);
}
// 板橋檢查點的株數每個引擎各記一筆,跑完兩引擎再互相對照(見檔尾 CL-COUNT)。
const urbanCount={};
const output='output/worldcover-0908';fs.mkdirSync(output,{recursive:true});
const results=[];
function check(name,pass,detail){results.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));}
// 跳點之後等林冠真的重建完（rebuilds 不再變動）才量，否則讀到的是上一個地點的殘值。
async function treesSettled(page,timeout=40000){const t0=Date.now();let last=-1,stable=Date.now();
 while(Date.now()-t0<timeout){const r=await page.evaluate(()=>railIslandIntegration?.renderer?.stats?.landscape?.rebuilds??-1);
  if(r!==last){last=r;stable=Date.now();}if(last>0&&Date.now()-stable>1600)return true;await page.waitForTimeout(150);}
 return false;}
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch({headless:false});
 const page=await browser.newPage({viewport:{width:1360,height:980},locale:'zh-TW'}),requests=[],failed=[],errors=[];
 await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
 page.on('request',r=>{if(r.url().includes('/landcover/'))requests.push(r.url());});
 page.on('response',r=>{if(r.url().includes('/landcover/')&&!r.ok())failed.push([r.status(),r.url()]);});
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'?map=landscape&scene=3d&ground=flat&g=all&at=23.6,120.95&z=9&lang=zh-TW');
  await page.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading,null,{timeout:60000});
  await page.waitForFunction(()=>M.raw.queryRenderedFeatures({layers:['landscape-worldcover-wood']}).length>0,null,{timeout:40000});
  check(name+' 公開分類資料實際渲染',await page.evaluate(()=>({count:M.raw.queryRenderedFeatures({layers:['landscape-worldcover-wood']}).length})).then(x=>x.count>0));
  check(name+' 來源與授權顯示',await page.locator('.maplibregl-ctrl-attrib').innerText().then(s=>s.includes('ESA WorldCover 2021')));
  await page.getByText('資料來源與授權',{exact:true}).click();
  check(name+' 完整署名可在資料來源查閱',await page.locator('#landscapeDataCredit').innerText().then(s=>s.includes('Copernicus Sentinel data (2021)')&&s.includes('CC BY 4.0')));
  await page.getByText('資料來源與授權',{exact:true}).click();
  const credit=page.locator('.maplibregl-ctrl-attrib a[href*="esa-worldcover"]');await credit.scrollIntoViewIfNeeded();
  const creditHit=await credit.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  check(name+' 新來源連結可捲入且未被控件遮住',creditHit);
  check(name+' OSM 細節在分類底層之上',await page.evaluate(()=>{const ids=M.raw.getStyle().layers.map(l=>l.id);return ['water','building','landcover_wood','park'].every(id=>ids.indexOf(id)>ids.indexOf('landscape-worldcover-wood'));}));
  await page.screenshot({path:output+'/'+name+'-island.png'});
  await page.evaluate(()=>M.raw.jumpTo({center:[121.5795,24.9968],zoom:16.5,pitch:55,bearing:0}));
  await page.waitForFunction(()=>window.railIslandIntegration?.renderer?.stats.landscape.count>20,null,{timeout:40000});
  // 關掉 OSM 林地顯示，確認 ESA 的小塊林地本身能產生樹群，不只掛了空的資料來源。
  await page.evaluate(()=>{M.raw.setLayoutProperty('landcover_wood','visibility','none');M.raw.jumpTo({center:[121.4640,25.0140],zoom:16.5,pitch:55,bearing:0});});
  check(name+' 都市綠地取樣有收斂',await treesSettled(page));
  let stats=await page.evaluate(()=>{const s=railIslandIntegration.renderer.stats.landscape;return {count:s.count,cap:s.cap,worldcoverCount:s.worldcoverCount,osmCount:s.osmCount,patches:s.patches,broadSkipped:s.broadSkipped,checks:s.checks,maxBuildMs:s.maxBuildMs,maxWorkSliceMs:s.maxWorkSliceMs,yields:s.yields,error:s.error};});
  check(name+' ESA 小塊綠地提供立體樹群',stats.worldcoverCount>0&&stats.osmCount===0&&stats.count<=stats.cap,stats);
  check(name+' 樹群取樣分批且單次工作低於 50ms',stats.yields>1&&stats.maxWorkSliceMs<50&&!stats.error,stats);
  // 株數本身要有具名斷言。原本三條判準都只問「有沒有樹／來源對不對／有沒有超過上限」,
  // 於是 2026-09-12 出現過一次 22→156 的七倍暫態而全鏈照綠(十次量測裡九次是 22、checks 恆 640,
  // 那一次重現不出來也歸因不了)。不釘死數字——ESA 圖磚換版就會假紅——只擋「逼近上限」。
  urbanCount[name]=stats.count;
  check(name+' 都市綠地株數未逼近上限',stats.count>0&&stats.count<stats.cap*.5,{count:stats.count,cap:stats.cap,checks:stats.checks});
  // 整片山區的 ESA 林地只負責地面顏色：底圖照樣是綠的（正向對照），但一株樹都不長。
  await page.evaluate(()=>M.raw.jumpTo({center:[120.9530,22.6100],zoom:16.5,pitch:55,bearing:0}));
  check(name+' 整片山區取樣有收斂',await treesSettled(page));
  const broad=await page.evaluate(()=>{const s=railIslandIntegration.renderer.stats.landscape;
   return {count:s.count,worldcoverCount:s.worldcoverCount,broadSkipped:s.broadSkipped,patches:s.patches,checks:s.checks,maxBuildMs:Math.round(s.maxBuildMs),
    esaWood:M.raw.queryRenderedFeatures({layers:['landscape-worldcover-wood']}).length};});
  check(name+' 整片山區只上色不長樹',broad.esaWood>0&&broad.broadSkipped>0&&broad.count===0,broad);
  await page.evaluate(()=>{M.raw.setLayoutProperty('landcover_wood','visibility','visible');M.raw.jumpTo({center:[121.5795,24.9968],zoom:16.5,pitch:55,bearing:0});});
  await page.waitForTimeout(2500);
  await page.screenshot({path:output+'/'+name+'-forest.png'});
  await page.waitForTimeout(2500);
  const count=await page.evaluate(()=>railIslandIntegration.renderer.stats.landscape.rebuilds);
  await page.waitForTimeout(1500);
  check(name+' 靜止時不重掃 ESA 圖磚',await page.evaluate(n=>railIslandIntegration.renderer.stats.landscape.rebuilds===n,count));
  check(name+' 圖磚按視野載入且不超過 z11',requests.length>0&&requests.length<150&&requests.every(u=>Number(u.match(/worldcover-2021\/(\d+)/)?.[1])<=11),{requests:requests.length});
  check(name+' 圖磚無缺漏及程式錯誤',!failed.length&&!errors.length,{failed,errors});
  await page.evaluate(()=>chooseBasemap('light'));
  await page.waitForFunction(()=>M.getStyleKind()==='light'&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading);
  const before=requests.length;
  await page.evaluate(()=>M.raw.jumpTo({center:[120.3,22.6],zoom:10}));await page.waitForTimeout(1500);
  check(name+' 一般底圖卸載公開分類資料',await page.evaluate(()=>!M.raw.getSource('taiwan-worldcover'))&&requests.length===before);
  await page.route('**/landcover/**/*.pbf',r=>r.fulfill({status:503,body:''}));
  await page.evaluate(()=>chooseBasemap('landscape'));
  await page.waitForFunction(()=>M.getStyleKind()==='landscape'&&window.railIslandIntegration?.renderer&&!window.railIslandIntegration?.loading);
  check(name+' 分類圖磚斷線仍可顯示既有底圖和列車',await page.evaluate(()=>!!M.raw.getSource('openmaptiles')&&railIslandIntegration.errors.length===0&&state.ready));
 }catch(e){check(name+' 公開圖資流程',false,String(e.stack));}
 await browser.close();
}
// CL-COUNT：同一個檢查點、同一份資料,兩個引擎長出來的株數不該差一個量級。
// 這是唯一抓得到 2026-09-12 那個七倍暫態的判準——它當時兩引擎一邊 22 一邊 156,而所有既有判準全綠。
// 倍數取 3：實測正常狀態兩引擎完全相同(十次量測全是 22),留 3 倍給圖磚到貨時序的抖動,
// 仍遠小於那次 7.1 倍。分母為零由上面的「株數未逼近上限」擋,這裡只在兩邊都有值時才判。
{
  const [a,b]=Object.values(urbanCount),RATIO=3;
  if(Object.keys(urbanCount).length<2)check('跨引擎株數對照的分母齊全',false,urbanCount);
  else check('兩引擎的都市綠地株數同一量級',Math.max(a,b)<=Math.min(a,b)*RATIO,{...urbanCount,ratio:+(Math.max(a,b)/Math.max(1,Math.min(a,b))).toFixed(2),limit:RATIO});
}
fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2));
console.log(results.filter(r=>r.pass).length+'/'+results.length+' 通過');if(results.some(r=>!r.pass))process.exitCode=1;

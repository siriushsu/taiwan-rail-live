// issue #57 修改前後對照截圖。兩棵樹各自起一台 dev server，同一組鏡頭各拍一張。
// 用法：BEFORE_URL=http://127.0.0.1:5402/ AFTER_URL=http://127.0.0.1:5401/ node scripts/shoot_tunnel_compare.mjs
import fs from 'node:fs';import {chromium} from 'playwright';
const OUT='output/tunnel-compare';fs.mkdirSync(OUT,{recursive:true});
const SHOTS=[
 {key:'reporter',name:'回報者視角 24.2738,120.6643 z20',center:[120.6643,24.2738],zoom:20,pitch:60,bearing:0},
 {key:'reporter-wide',name:'回報者視角拉遠 z17',center:[120.6643,24.2738],zoom:17,pitch:64,bearing:0},
 // 山岳隧道鏡頭：站在洞口、朝洞內看，拉到看得見整座山的距離。缺陷本來就是山體尺度的
 // （隧道跟著山坡爬、山頂地表浮出軌道痕跡），貼著洞口拍反而照不到。
 // 座標取自各段真正的洞口節點（與非隧道股道相接的那一端），不是 way 的第一個點。
 {key:'sanyi',name:'山線 三義隧道 南口朝北（外接高架橋）',center:[120.75033,24.35538],zoom:14.4,pitch:74,bearing:17},
 {key:'xinguanyin',name:'北迴線 新觀音隧道 北口朝南',center:[121.78104,24.43689],zoom:14.4,pitch:74,bearing:177},
 {key:'zhongyang',name:'南迴線 中央隧道 東口朝西',center:[120.81902,22.29305],zoom:14.4,pitch:74,bearing:256},
 // 對照組：都市地下段的透視必須原封不動。山岳隧道那條規則若寫得太寬，這一張會先變。
 {key:'taipei',name:'對照組 台北車站地下路網（透視須保留）',center:[121.5170,25.0478],zoom:16.5,pitch:60,bearing:20},
];
const targets=[['before',process.env.BEFORE_URL],['after',process.env.AFTER_URL]].filter(t=>t[1]);
const browser=await chromium.launch();const log=[];
for(const [tag,base] of targets){
 const page=await browser.newPage({viewport:{width:1400,height:900},locale:'zh-TW'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await page.goto(base+'?scene=3d&map=landscape&g=all&t=08:00');
 await page.waitForFunction(()=>state.ready&&window.railIslandIntegration?.renderer,null,{timeout:120000});
 await page.evaluate(()=>{state.playing=false;railIslandIntegration.renderer.setGroundMode('terrain');});
 for(const s of SHOTS){
  await page.evaluate(v=>railIslandIntegration.renderer.map.jumpTo({center:v.center,zoom:v.zoom,pitch:v.pitch,bearing:v.bearing}),s);
  // 等圖磚與地形真的到齊再拍，不然「修改前」拍到半載入的畫面會被誤讀成修好了
  await page.waitForFunction(()=>{const m=railIslandIntegration.renderer.map;return m.loaded()&&m.areTilesLoaded();},null,{timeout:60000}).catch(()=>{});
  // 等畫面真的定下來再拍：圖磚／樹木載到一半就按快門，修改前後的差異會被載入進度污染。
  let prev=null,settled=false;
  for(let i=0;i<14;i++){
   await page.waitForTimeout(700);
   const shot=await page.screenshot();
   if(prev&&shot.equals(prev)){settled=true;break;}
   prev=shot;
  }
  const file=`${OUT}/${s.key}-${tag}.png`;
  await page.screenshot({path:file});
  const stat=await page.evaluate(()=>{const r=railIslandIntegration.renderer;return {models:r.stats?.models??null,errors:r.stats?.errors?.length??0};});
  log.push({tag,key:s.key,name:s.name,file,settled,...stat});
  console.log(tag,s.key,settled?'已定格':'⚠ 未定格',JSON.stringify(stat));
 }
 if(errors.length)console.log(tag,'頁面錯誤',errors.slice(0,3));
 await page.close();
}
await browser.close();
fs.writeFileSync(OUT+'/shots.json',JSON.stringify(log,null,2));
console.log('共',log.length,'張');

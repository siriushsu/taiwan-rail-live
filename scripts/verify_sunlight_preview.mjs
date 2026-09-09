import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1400,height:1000},locale:'zh-TW'});
 await page.goto('http://127.0.0.1:5236/sunlight-preview.html');
 await page.waitForFunction(()=>!document.querySelector('[data-hour]').disabled,null,{timeout:60000});
 for(const hour of [6,12,0,18]){
  await page.click(`[data-hour="${hour}"]`);await page.waitForTimeout(500);
  const result=await page.frames()[1].evaluate(()=>({time:state.simSec,phase:sunlight.current.phase,pitch:M.getPitch()}));
  if(result.time!==hour*3600||result.pitch<70)throw Error(JSON.stringify(result));
  console.log('PASS 預覽切換',hour,result);
 }
 await page.screenshot({path:'output/sunlight/preview.png'});
} finally {await browser.close();}

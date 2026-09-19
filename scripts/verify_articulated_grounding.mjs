// 高雄輕軌曾把五分節各自的最低點壓到軌面，讓無轉向架的第 2、4 節下沉約 36 cm。
// 用真實 Chromium／WebKit 把高雄輕軌放在水平直軌上側拍，量屋頂線與車底離軌差。
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';

const root=process.cwd(),requestedPort=Number(process.env.PORT||0),out='output/articulated-grounding',rows=[];
fs.mkdirSync(out,{recursive:true});
const mime={'.bin':'application/octet-stream','.css':'text/css','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const u=new URL(req.url,'http://x');if(u.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end('{}');}let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if((file!==root&&!file.startsWith(root+path.sep))||!fs.existsSync(file)){res.statusCode=404;return res.end();}if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(requestedPort,'127.0.0.1',resolve));
const port=server.address().port;

async function boot(page){
  await page.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
  await page.goto(`http://127.0.0.1:${port}/?scene=3d&tracks=legacy&ground=flat&g=all&at=22.6567,120.3083&z=19&t=22:15`);
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&window.railIslandIntegration?.renderer,null,{timeout:120000});
  await page.evaluate(async()=>{
    state.playing=false;clearFollow();clearFreqFollow();document.body.classList.add('fs');M.resize();
    const {makePath}=await import('/rail-3d/integration/train-path.js');
    const latitude=22.6567,longitude=120.3083,coordinates=[[longitude-.0015,latitude],[longitude+.0015,latitude]],path=makePath(coordinates),s=path.length/2,q=path.at(s).coordinate;
    const level=()=>({kind:'surface',offsetM:0,flatOffsetM:0}),route={id:'qa-krtc-c',systemId:'krtc',routeId:'C',lineKey:'krtc|C',color:'#79a679',displayColor:'#79a679',coordinates,physical:true,path,level};
    path.level=level;
    const vehicle={id:'qa-krtc-caf',longitude:q[0],latitude:q[1],chainageM:s,railDirection:1,formationFacing:1,systemId:'krtc',routeId:'C',route,color:'#79a679',publicLabel:'C',sourceKind:'frequency',followed:true};
    const integration=railIslandIntegration,frame=integration.capture();integration.render=()=>{};integration.setGroundMode('flat');integration.setModelMode('all');
    M.raw.setCenterClampedToGround(false);M.raw.jumpTo({center:q,zoom:19,pitch:55,bearing:0,elevation:0,padding:{top:0,bottom:0,left:0,right:0}});
    window.__articulatedUpdate=()=>integration.renderer.update({...frame,vehicles:[vehicle],routes:[route],clearanceRoutes:[route],selectedVehicleId:vehicle.id,followLock:false,display:{...frame.display,enabled:true,modelMode:'all'}});
    __articulatedUpdate();
  });
  await page.waitForFunction(()=>{__articulatedUpdate();return railIslandIntegration.renderer.stats.poseSamples[0]?.carCount===5&&railIslandIntegration.renderer.projectedCars().length===5;},null,{timeout:90000});
  await page.waitForTimeout(250);
}

async function measure(page){return page.evaluate(()=>{
  __articulatedUpdate();const r=railIslandIntegration.renderer,cars=r.projectedCars().sort((a,b)=>a.index-b.index),tops=cars.map(c=>c.bounds.top),bottoms=cars.map(c=>c.bounds.bottom),pose=r.stats.poseSamples[0];
  const average=xs=>xs.reduce((a,b)=>a+b,0)/xs.length,ground=[bottoms[0],bottoms[2],bottoms[4]],suspended=[bottoms[1],bottoms[3]];
  return {width:innerWidth,model:pose.modelId,cars:pose.carCount,topSpread:Math.max(...tops)-Math.min(...tops),suspendedRise:average(ground)-average(suspended),tops,bottoms,overflow:document.documentElement.scrollWidth>innerWidth+1,errors:[...railIslandIntegration.errors,...r.stats.errors]};
});}

try{
  for(const [engine,type] of Object.entries({chromium,webkit})){
    const browser=await type.launch();
    try{
      for(const width of [1440,360,375,414,768]){
        const context=await browser.newContext({viewport:{width,height:width===1440?900:820},locale:'zh-TW',isMobile:width!==1440,hasTouch:width!==1440});
        const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
        try{
          await boot(page);const detail=await measure(page),pass=detail.model==='caf'&&detail.cars===5&&detail.topSpread<2&&detail.suspendedRise>2&&!detail.overflow&&!detail.errors.length&&!pageErrors.length;
          rows.push({engine,width,pass,detail,pageErrors});console.log(pass?'PASS':'FAIL',engine,width,JSON.stringify(detail));
          if(width===1440||width===375)await page.screenshot({path:`${out}/${engine}-${width}.png`});
        }catch(error){rows.push({engine,width,pass:false,error:String(error),pageErrors});console.error('FAIL',engine,width,error);}
        await context.close();
      }
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));fs.writeFileSync(`${out}/report.json`,JSON.stringify(rows,null,2));}

if(rows.some(row=>!row.pass))process.exitCode=1;
else console.log(`PASS 高雄輕軌鉸接車體雙引擎與手機寬度 ${rows.length}/${rows.length}`);

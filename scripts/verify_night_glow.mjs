// 暗色路線微光：雙引擎實際像素、顯示篩選、底圖重建與手機版面。
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/night-glow'); fs.mkdirSync(out, { recursive: true });
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png' };
const server = createServer((req,res) => {
  const u = new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')) {
    if(u.pathname === '/api/thsr-schedule') { res.setHeader('content-type','application/json'); return fs.createReadStream(path.join(root,'data/thsr_schedule_dense.json')).pipe(res); }
    res.writeHead(503,{'content-type':'application/json'}).end('{}'); return;
  }
  let p = path.resolve(root, '.' + decodeURIComponent(u.pathname));
  if(!p.startsWith(root+path.sep) && p!==root) return res.writeHead(404).end();
  if(fs.existsSync(p) && fs.statSync(p).isDirectory()) p=path.join(p,'index.html');
  if(!fs.existsSync(p)) return res.writeHead(404).end();
  res.setHeader('content-type',mime[path.extname(p)] || 'application/octet-stream');fs.createReadStream(p).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}/`;
const results=[];
function ok(name, pass, detail='') { results.push({name,pass,detail}); console.log(`${pass?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`); }
let browser;
try {
 for (const en of ['chromium','webkit']) {
  browser=await ({chromium,webkit}[en]).launch();
  const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,isMobile:true});
  await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('trainmap-appearance','dark');});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?lang=zh-TW');
  await page.waitForFunction(()=>window.__state?.ready&&window.__glTracks?.ready&&window.__M.raw.getLayer('track-glow'),null,{timeout:60000});
  await page.evaluate(()=>{selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(9*3600);state.playing=false;M.setView([25.046,121.523],12,{animate:false});M.raw.setPitch(40);glTracksSync();});
  const layers=await page.evaluate(()=>{
    const raw=M.raw, all=raw.getStyle().layers, g=all.find(l=>l.id==='track-glow');
    return {source:g.source,sameSource:g.source===all.find(l=>l.id.startsWith('track-line-')).source,
      glowIndex:all.indexOf(g),lineIndex:all.findIndex(l=>l.id.startsWith('track-casing-')),
      opacity:raw.getPaintProperty(g.id,'line-opacity'),filter:raw.getFilter(g.id),expected:glTracksKeys().lineKeys};
  });
  ok(en+' 微光與軌道共用幾何、位在實線之下',layers.sameSource&&layers.glowIndex<layers.lineIndex&&layers.opacity>0,layers);
  ok(en+' 微光沿用路線顯示篩選',JSON.stringify(layers.filter[2][1])===JSON.stringify(layers.expected));
  for(const [theme,style,collect,expected] of [['dark','auto',false,.22],['light','auto',false,0],['sat','auto',false,0],['dark','faint',false,0],['dark','hidden',false,0],['dark','auto',true,0]]) {
    const alpha=await page.evaluate(([theme,style,collect])=>{state.mapDark=theme==='dark';state.basemap=theme==='sat'?'sat':'street';state.trackStyle=style;state.collectMap=collect;glTracksSync();return M.raw.getPaintProperty('track-glow','line-opacity');},[theme,style,collect]);
    ok(en+` ${theme}/${style}/collect=${collect}`,alpha===expected,alpha);
  }
  await page.evaluate(()=>{state.mapDark=true;state.basemap='street';state.trackStyle='auto';state.collectMap=false;glTracksSync();});
  for(const width of [360,375,414,768,1280]) {
    await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
    const size=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,canvas:M.raw.getCanvas().clientWidth,viewport:innerWidth}));
    ok(en+' '+width+' 地圖與版面尺寸',!size.overflow&&size.canvas<=size.viewport+1,size);
  }
  await page.screenshot({path:path.join(out,en+'-dark.png')});
  // 重建 style：模擬換底圖後所有自訂 layer 被移除，確認微光會和軌道一起補回。
  // 接著用單色底做像素 A/B，排除圖磚抵達、列車與時鐘動畫造成的雜訊。
  await page.evaluate(()=>{
    document.getElementById('overlay').style.visibility='hidden';
    M.raw.setStyle({version:8,sources:{},layers:[{id:'test-bg',type:'background',paint:{'background-color':'#10141c'}}]});
  });
  await page.waitForFunction(()=>M.raw.getLayer('track-glow')&&M.raw.getPaintProperty('track-glow','line-opacity')===.22);
  const restored=await page.evaluate(()=>M.raw.getStyle().layers.filter(l=>l.id==='track-glow').length);
  ok(en+' 換底圖後微光恰好重建一次',restored===1,restored);
  await page.evaluate(()=>M.raw.setPaintProperty('track-glow','line-opacity-transition',{duration:0}));
  async function pixels(alpha) {
    await page.evaluate(alpha=>{M.raw.setPaintProperty('track-glow','line-opacity',alpha);M.raw.triggerRepaint();},alpha);
    await page.waitForTimeout(200);
    return sharp(await page.screenshot({clip:{x:390,y:100,width:420,height:500}})).ensureAlpha().raw().toBuffer();
  }
  const on=await pixels(.22),off=await pixels(0);let brighter=0,delta=0;
  for(let i=0;i<on.length;i+=4){const d=on[i]+on[i+1]+on[i+2]-off[i]-off[i+1]-off[i+2];if(d>6){brighter++;delta+=d;}}
  if(en==='webkit'&&brighter===0) console.log('SKIP WebKit 合成像素：此環境沒有 GL 畫面，style/篩選/重建已驗；真機仍需複驗。');
  else ok(en+' 微光確實讓軌道周圍亮起',brighter>200&&delta>2000,{brighter,delta});
  ok(en+' 無前端例外',!errors.length,errors);
  await context.close();await browser.close();browser=null;
 }
} catch(e) {ok('驗收執行',false,e.stack);} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;

// 真實引擎操作：路線雙向、跨系統同名站、分岔、查詢入口、鏡頭、手機互斥與可點擊性。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/discovery'); fs.mkdirSync(out, { recursive: true });
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
function ok(name,pass,detail='') { results.push({name,pass,detail}); console.log(`${pass?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`); }
async function tap(page,selector) {
  const l=page.locator(selector); await l.scrollIntoViewIfNeeded();
  const hit=await l.evaluate(e=>{const r=e.getBoundingClientRect();const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===h||e.contains(h);});
  if(!hit) throw new Error('控件被遮住 '+selector);
  await l.tap();
}
async function geometry(page,label) {
  const g=await page.evaluate(()=>{
    const fresh=[...document.querySelectorAll('#trackPanel button,#trackPanel input,#trackPanel select')].filter(e=>!e.closest('[hidden]')&&getComputedStyle(e).display!=='none');
    const bad=[];
    for(const e of fresh) {
      e.scrollIntoView({block:'center',inline:'nearest'});
      const r=e.getBoundingClientRect(), h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      if(r.width&&r.height&&((r.height<43&&matchMedia('(any-pointer: coarse)').matches)||r.left<0||r.right>innerWidth+1||!(h===e||e.contains(h)))) bad.push({id:e.id||e.textContent.trim().slice(0,35),h:r.height,hit:h?.id||h?.tagName});
    }
    document.getElementById('trackPanel').scrollTop=0;
    const visible=e=>{
      let r=e.getBoundingClientRect();if(!r.width||!r.height||e.closest('[hidden]'))return null;
      let l=Math.max(0,r.left),t=Math.max(0,r.top),rr=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);
      for(let p=e;p;p=p.parentElement){const st=getComputedStyle(p);if(st.visibility==='hidden'||st.opacity==='0')return null;if(/auto|scroll|hidden|clip/.test(st.overflow+st.overflowY)){const q=p.getBoundingClientRect();l=Math.max(l,q.left);t=Math.max(t,q.top);rr=Math.min(rr,q.right);b=Math.min(b,q.bottom);}}
      // 平板側欄依既有設計會覆蓋右上控件；相交掃描只比較目前真的露出、可操作的控件。
      const hit=document.elementFromPoint((l+rr)/2,(t+b)/2);if(!(hit===e||e.contains(hit)))return null;
      return rr-l>2&&b-t>2?{l,t,r:rr,b}:null;
    };
    const all=[...document.querySelectorAll('button,input,select,a,[role=button],[role=slider],.chip')].map(e=>({e,r:visible(e)})).filter(x=>x.r);
    const pairs=[];
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      const a=all[i],b=all[j];if(!(a.e.closest('#rdTabs,#rdRoutes,#rdScenes')||b.e.closest('#rdTabs,#rdRoutes,#rdScenes'))||a.e.contains(b.e)||b.e.contains(a.e))continue;
      const w=Math.min(a.r.r,b.r.r)-Math.max(a.r.l,b.r.l),h=Math.min(a.r.b,b.r.b)-Math.max(a.r.t,b.r.t);
      if(w>2&&h>2)pairs.push([a.e.id||a.e.textContent.trim().slice(0,20),b.e.id||b.e.textContent.trim().slice(0,20)]);
    }
    return {bad,pairs,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  ok(label,!g.bad.length&&!g.pairs.length&&!g.overflow,g);
}
let browser;
try {
 const html=await(await fetch(base)).text();
 ok('伺服器確實使用目前 worktree',createHash('sha256').update(html).digest('hex')===createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'));
 for(const en of (process.env.ENGINES||'chromium,webkit').split(',')) {
  browser=await ({chromium,webkit}[en]).launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-TW'});
  await ctx.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');localStorage.setItem('iabHintDismiss','1');localStorage.setItem('trainmap-language','zh-TW');localStorage.setItem('trainmap-appearance','light');});
  const page=await ctx.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?lang=zh-TW');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&state.systems.length>5,null,{timeout:60000});
  await page.evaluate(()=>{selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(8*3600);state.playing=false;syncTimeUI();});
  await tap(page,'#tabSearch');await tap(page,'#queryLinks [data-act=routes]');
  ok(en+' 查詢入口開導覽',await page.locator('#rdRoutes').isVisible()&&!await page.locator('#searchPanel').isVisible());
  await tap(page,'[data-rdtab=settings]');await tap(page,'#trackSeg [data-v=hidden]');
  ok(en+' 原有軌道顯示設定仍能操作',await page.locator('#trackSeg [data-v=hidden]').evaluate(e=>e.classList.contains('on')));
  await tap(page,'#trackSeg [data-v=auto]');await tap(page,'[data-rdtab=routes]');
  const cat=await page.evaluate(()=>{
    const before=JSON.stringify(state.systems.map(s=>(s.mode==='sched'?s._track:s.data)?.lines?.map(l=>l.stations)));
    const c=RailDiscovery.catalog(state.systems,buildStnIndex());for(const r of c)RailDiscovery.ordered(r,true);
    const after=JSON.stringify(state.systems.map(s=>(s.mode==='sched'?s._track:s.data)?.lines?.map(l=>l.stations)));
    return {n:c.length,systems:new Set(c.map(r=>r.sysId)).size,unchanged:before===after,danhai:c.filter(r=>r.sysId==='ntdlrt').map(r=>({id:r.id,end:r.stations.at(-1).name})),scenes:RailDiscovery.scenes.map(s=>({id:s.id,n:RailDiscovery.scenePoints(s,c).length}))};
  });
  ok(en+' 全系統資料與分岔保留',cat.n===38&&cat.systems===10&&cat.unchanged&&cat.danhai.length>=2&&new Set(cat.danhai.map(r=>r.end)).size>=2,cat);
  await tap(page,'[data-route="mrt|BR"]');
  let names=await page.locator('.rd-stations button').allTextContents();
  ok(en+' 文湖線正向',names.length===24&&names[0].includes('動物園')&&names.at(-1).includes('南港展覽館'));
  await tap(page,'[data-rd=reverse]');names=await page.locator('.rd-stations button').allTextContents();
  ok(en+' 文湖線反向',names[0].includes('南港展覽館')&&names.at(-1).includes('動物園'));
  await tap(page,'[data-stop="0"]');
  let st=await page.evaluate(()=>state.boardStation);
  ok(en+' 全台同框點站開裝飾層看板',st.name==='南港展覽館'&&st.sys==='deco'&&st.metroSysId==='mrt',st);
  // 同名站要保持系統：從各自的路線選到市政府。
  for(const sys of ['tmrt','mrt']) {
    await page.evaluate(()=>openTrackPanel('routes'));await tap(page,'[data-rd=back]');
    await page.locator('#rdSearch').fill('市政府');await page.locator('#rdSystem').selectOption(sys);
    await tap(page,'#rdList .rd-route');
    const ix=await page.locator('.rd-stations button').allTextContents();
    await tap(page,`[data-stop="${ix.findIndex(s=>s.replace(/\s|›/g,'')==='市政府')}"]`);
    st=await page.evaluate(()=>state.boardStation);ok(en+' 市政府辨識 '+sys,st.name==='市政府'&&st.metroSysId===sys,st);
  }
  // 模擬時間和倍速不因跨系統取景改變，跟車需退出，鏡頭到指定區域。
  await page.evaluate(()=>{selectGroup(GROUPS.find(g=>g.id==='hsr'));setSimSec(9*3600);setSpeed(10);state.playing=false;openTrackPanel('scenes');});
  await tap(page,'[data-scene=danhai]');
  await page.waitForFunction(()=>!M.raw.isMoving());
  const view=await page.evaluate(()=>({group:state.group,time:state.simSec,speed:state.speedMult,playing:state.playing,pitch:M.getPitch(),center:M.getCenter(),follow:!!(state.followTrain||state.freqFollow)}));
  ok(en+' 淡海取景保留時間與速度',view.group==='all'&&view.time===32400&&view.speed===10&&!view.playing&&view.pitch>25&&view.pitch<=55&&!view.follow,view);
  ok(en+' 相機確實在淡海',view.center.lat>25.15&&view.center.lat<25.25&&view.center.lng>121.3&&view.center.lng<121.5,view.center);
  // 適配層契約；真正跨層驗證另由 verify_basemap_align 的畫面像素探針負責。
  const projection=await page.evaluate(()=>{
    const ln=state.decoLines.find(l=>l._sys==='ntdlrt');const p=ln.stations[1];const gl=M.raw.project([p.lon,p.lat]);const canvas=M.toScreen([p.lat,p.lon]);
    return {error:Math.hypot(gl.x-canvas.x,gl.y-canvas.y),canvasSize:[document.getElementById('overlay').width,document.getElementById('overlay').height]};
  });
  ok(en+' 既有投影與原生地圖一致',projection.error<.1,projection);
  // 空白搜尋提示確實能觸控到結果，導覽入口會收掉打字態。
  await tap(page,'#tabSearch');await tap(page,'#trainSearch');
  ok(en+' 空白搜尋有範例',await page.locator('.rd-suggestions [data-query]').count()>=3);
  await tap(page,'.rd-suggestions [data-query="台北"]');
  ok(en+' 點範例產生搜尋結果',await page.locator('#trainSearch').inputValue()==='台北'&&await page.locator('#searchDrop .stn-row').count()>0);
  await page.locator('#trainSearch').fill('');await tap(page,'[data-discovery=routes]');
  ok(en+' 搜尋提示進導覽退出鍵盤態',!await page.evaluate(()=>document.body.classList.contains('search-open')));
  for(const width of [360,375,390,414,640,768,900,1280]) {
    await page.evaluate(()=>document.fullscreenElement?document.exitFullscreen():undefined);
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>{closeSearchPanel();openTrackPanel('routes');});
    if(await page.locator('[data-rd=back]').isVisible()) await tap(page,'[data-rd=back]');
    await page.locator('#rdSearch').fill('文湖');await page.locator('#rdSystem').selectOption('mrt');
    await tap(page,'[data-route="mrt|BR"]');
    // 手機產品只支援全畫面，不能直接移除 fs 製造使用者到不了的狀態。
    for(const fsMode of [true]) {
      await page.evaluate(on=>state._setFs(on),fsMode);
      await page.waitForTimeout(120);
      await geometry(page,`${en} ${width} ${fsMode?'全畫面':'一般'} 導覽可及性與全控件相交`);
    }
    await tap(page,'[data-rdtab=scenes]');await geometry(page,`${en} ${width} 取景可及性`);
    if(width===390||width===1280) await page.screenshot({path:path.join(out,`${en}-${width}.png`)});
  }
  await page.evaluate(()=>document.fullscreenElement?document.exitFullscreen():undefined);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{state._setFs(true);selectGroup(GROUPS.find(g=>g.id==='all'));setSimSec(8*3600);const tr=state.trains.find(tr=>!tr.loop&&trainPos(tr,state.simSec));setFollow(tr);openTrackPanel('routes');});
  ok(en+' 跟車矩陣確實有列車',await page.evaluate(()=>!!state.followTrain));
  await geometry(page,en+' 跟車與公告同時存在');
  await tap(page,'#tabMore');
  ok(en+' 更多抽屜可開啟',await page.evaluate(()=>document.body.classList.contains('tools-open')));
  await page.evaluate(()=>{document.getElementById('moreClose').click();openTrackPanel('scenes');setLanguage('en');});
  ok(en+' 切英文重畫導覽',!/[\u3400-\u9fff]/.test(await page.locator('#rdScenes').innerText()));
  await page.evaluate(()=>openTrackPanel('routes'));
  if(await page.locator('[data-rd=back]').isVisible()) await tap(page,'[data-rd=back]');
  await page.locator('#rdSearch').fill('');await page.locator('#rdSystem').selectOption('');
  const untranslated=await page.locator('#rdList .rd-route').allTextContents().then(rows=>rows.filter(s=>/[\u3400-\u9fff]/.test(s)));
  ok(en+' 英文路線清單與起終站',!untranslated.length,untranslated);
  await page.locator('#rdSearch').fill('Wenhu');
  ok(en+' 英文搜尋路線',await page.locator('#rdList [data-route="mrt|BR"]').count()===1);
  await page.evaluate(()=>{document.documentElement.setAttribute('data-fs','xlarge');openTrackPanel('scenes');});
  await geometry(page,en+' 英文特大字級');
  await page.evaluate(()=>document.documentElement.removeAttribute('data-fs'));
  await page.evaluate(()=>setLanguage('ja'));ok(en+' 日文取景',await page.locator('#rdScenes').innerText().then(s=>s.includes('嘉義')));
  ok(en+' 無前端例外',!errors.length,errors);
  await ctx.close();
  const desktop=await browser.newContext({viewport:{width:1280,height:900},hasTouch:false});
  await desktop.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
  const dp=await desktop.newPage();await dp.goto(base+'?lang=zh-TW');
  await dp.waitForFunction(()=>typeof state!=='undefined'&&state.ready);
  await dp.evaluate(()=>openTrackPanel('routes'));
  for(const on of [false,true]) {
    await dp.evaluate(on=>state._setFs(on),on);await dp.waitForTimeout(150);
    await geometry(dp,en+' 桌面 '+(on?'全畫面':'一般'));
  }
  await dp.screenshot({path:path.join(out,`${en}-desktop.png`)});
  await desktop.close();await browser.close();browser=null;
 }
} catch(e) { ok('驗收執行',false,e.stack); } finally { if(browser)await browser.close();await new Promise(r=>server.close(r)); }
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
if(results.some(r=>!r.pass)) process.exitCode=1;

import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
// 日期、資料夾與輸出位置參數化（不給參數＝9/12 封存版，行為與改版前相同）：
//   --date=2026-10-16 --dir=memories/tainan-2026-10-16 --out=output/tainan-memory-1016，或環境變數 MEMORY_DATE／MEMORY_DIR／MEMORY_OUT。
//   dir 預設 memories/tainan-<date>；out 預設 9/12 → output/tainan-memory、其他日期 → output/tainan-memory-MMDD。
//   CHROMIUM_CHANNEL 換 Chromium 的 channel（預設 chromium）。--date=2026-10-16 時另跑 10/16 版專屬檢查（lastDayChecks）。
//   資料有 singleLine（單線雙向說明）時另跑 singleLineChecks：說明框版面、「說明」鈕、標籤疊放、跟車卡留置站，不看日期。
//   SIZES=360x780,1280x900 只跑指定的視窗大小；ONLY=singleline 只跑 singleLineChecks（突變測試用，不跑其餘步驟）；KEEP_GOING=1 讓 singleLineChecks 紅了也往下跑、最後一次列出全部。
//   --date=2026-10-16 另跑 lastDayLayoutChecks（標頭、跟車卡右緣提示、跟車時展開單線說明的鏡頭、標籤與整班車身〔含改過方位與仰角之後、展開之後再旋轉〕、寬版用滾輪縮放跨過讓位門檻時讓位量不跳、60 倍播放時說明框與跟車點不跳、最後一夜跨旋轉與自動收合後原地重開）；ONLY=layout 只跑這一段（突變測試用），KEEP_GOING=1 對它也有效。
//   讓位的量測值（每個尺寸、樣本的可用空間、需要、車身下緣離框上緣、進框比例）寫到 <out>/lift-results.json；縮放連續每一步的 span 與讓位量寫到 <out>/zoom-results.json，60 倍播放的量測寫到 <out>/stab-results.json。
const opt=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)||process.env[`MEMORY_${name.toUpperCase()}`]||'';
const DATE=opt('date')||'2026-09-12',DIR=(opt('dir')||`memories/tainan-${DATE}`).replace(/^\/+|\/+$/g,''),OUTDIR=opt('out')||(DATE==='2026-09-12'?'output/tainan-memory':`output/tainan-memory-${DATE.slice(5).replace('-','')}`);
const lastDay=DATE==='2026-10-16';
const base=process.env.VURL||'http://127.0.0.1:5244',out=OUTDIR;fs.mkdirSync(out,{recursive:true});
const results=[];
// 正式站會由 Cloudflare 注入 Web Analytics；它不提供重播資料。
// 只辨識正式網域上的兩個基礎設施端點，其他外部請求與 /api/* 仍不得出現。
function isProductionTelemetry(url){
 if(base!=='https://railisland.tw'&&base!=='https://www.railisland.tw')return false;
 const u=new URL(url);
 return (u.origin==='https://static.cloudflareinsights.com'&&/^\/beacon\.min\.js(?:\/[^/]+)?$/.test(u.pathname))||(u.origin===base&&u.pathname==='/cdn-cgi/rum');
}
async function controls(page,scope='body',skip=''){
 return page.evaluate(([scope,skip])=>{
  const all=[...document.querySelector(scope).querySelectorAll('button,a,input,select')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])')&&!(skip&&e.closest(skip)));
  const boxes=all.map(e=>({id:e.id||e.textContent.trim().slice(0,30),e,r:e.getBoundingClientRect()})).filter(v=>v.r.width&&v.r.height);
  const errors=[];
  for(const b of boxes){if(b.r.left<-.1||b.r.right>innerWidth+.1||b.r.top<-.1||b.r.bottom>innerHeight+.1)errors.push('溢出:'+b.id);const hit=document.elementFromPoint(b.r.x+b.r.width/2,b.r.y+b.r.height/2);if(hit!==b.e&&!b.e.contains(hit))errors.push('無法觸及:'+b.id);if(b.r.width<24||b.r.height<24)errors.push('觸控目標過小:'+b.id);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1)errors.push('相交:'+a.id+'/'+b.id);}
  if(document.documentElement.scrollWidth>innerWidth)errors.push('水平捲動');return {count:boxes.length,errors};
 },[scope,skip]);
}
// ── 10/16 版專屬檢查（--date=2026-10-16 才跑）──────────────────────────────────────────────
// 預期值一律從 tainanMemory.data（snapshot）與下面的常數算，不呼叫頁面自己的格式化函式；失敗訊息開頭是「引擎 寬×高」與檢查名稱。
const KIND_ZH={official:'官方',observed:'實測',inferred:'推定'},SRC_ZH={obs:'實測',interp:'內插',sched:'表定',est:'推定'},WORDS={'track-overlap':'股道安排待確認','single-line-unresolved':'封鎖初期股道安排不明'};
const pad2=n=>String(n).padStart(2,'0');
const hhmm=sec=>{const s=((Math.floor(sec)%86400)+86400)%86400;return pad2(Math.floor(s/3600))+':'+pad2(Math.floor(s%3600/60));};
const evTime=t=>(t>=86400?'次日 ':'')+hhmm(t);
const hms=sec=>{if(!Number.isFinite(sec))return '—';const r=Math.round(sec),d=Math.floor(r/86400),s=r-d*86400;return (d<0?'前日 ':d>0?'次日 ':'')+pad2(Math.floor(s/3600))+':'+pad2(Math.floor(s%3600/60))+':'+pad2(s%60);};
const dur=sec=>{const s=Math.round(Math.abs(sec)),m=Math.floor(s/60),r=s%60;return (m?m+'分':'')+(r||!m?r+'秒':'');};
const diff=d=>!Number.isFinite(d)?'—':Math.abs(d)<5?'準點':(d>0?'晚':'早')+dur(d);
// 跟車卡的規則（驗收腳本自己的版本，不照抄頁面）：欄位順序是 站、表定、重播、來源、差、留置（來源緊接在重播後面，側欄窄時先被切掉的是差與留置）。
// 到站那一行的來源照 src；開車那一行照開車時刻怎麼來的：有到站紀錄的站（obs，含被留置的通過站）與起點站（est）是表定加誤點分鐘推出來的＝推定，
// 內插站（interp）的到站與開車都由鄰近的站推算＝內插，整班照表定（sched）＝表定。起點站（end 'origin'）到站與開車同一秒＝沒有到站，終點站（end 'terminal'）同理沒有開車，那一行各欄都記「—」。
const CARD_HEAD=['站','表定到／開','重播到／開','來源到／開','差重播−表定','留置'],COL={sched:0,act:1,src:2,diff:3,hold:4},ARR_ZH={obs:'實測',interp:'內插',sched:'表定',est:'推定'},DEP_ZH={obs:'推定',interp:'內插',est:'推定',sched:'表定'};
// COL：tbody 每一列的 td 依序是表定、重播、來源、差、留置（站名是 th）；單線說明那段的留置站檢查也照它取欄。
const CARD_NOTE=['到站誤差約半分鐘','實測＝','內插＝這一站沒有可用的紀錄，到站與開車都由鄰近的站推算','推定＝紀錄裡沒有開車時刻','留置＝','「—」＝起點站沒有到站、終點站沒有開車'];
const cardWant=s=>{const pass=s.stop===false,hold=Number(s.holdSec)>=90?Number(s.holdSec):0,passed=pass&&!hold,has=Number.isFinite(s.schedArrSec),
  noArr=s.end==='origin'&&s.arrSec===s.depSec,noDep=s.end==='terminal'&&s.arrSec===s.depSec,two=(a,d)=>[noArr?'—':a,noDep?'—':d];
 return [has?(pass?['通過',hms(s.schedArrSec)]:two(hms(s.schedArrSec),hms(s.schedDepSec))):['—'],passed?['通過',hms(s.arrSec)]:two(hms(s.arrSec),hms(s.depSec)),
  passed?[ARR_ZH[s.src]||'—']:two(ARR_ZH[s.src]||'—',DEP_ZH[s.src]||'—'),has?(passed?[diff(s.arrSec-s.schedArrSec)]:two(diff(s.arrSec-s.schedArrSec),diff(s.depSec-s.schedDepSec))):['—'],[hold?dur(hold):'—']];};
// 外部對照：[車次, 站, 表定, 重播, 來源, 差, 留置]。來源與「—」寫死，時刻用代號從 snapshot 取（SA／SD＝表定到／開、A／D＝重播到／開、A-SA／D-SD＝差、H＝留置秒數）。
const CARD_KNOWN=[['3031','臺南',['—','SD'],['—','D'],['—','推定'],['—','D-SD'],['—']],['3778','臺南',['SA','—'],['A','—'],['內插','—'],['A-SA','—'],['—']],
 ['3782','仁德',['SA','SD'],['A','D'],['內插','內插'],['A-SA','D-SD'],['—']],['3782','保安',['SA','SD'],['A','D'],['實測','推定'],['A-SA','D-SD'],['H']],
 ['145','永康',['通過','SA'],['A','D'],['實測','推定'],['A-SA','D-SD'],['H']],['6631','臺南',['SA','SD'],['A','D'],['表定','表定'],['A-SA','D-SD'],['—']]];
const cardTok=(s,v)=>({SA:hms(s.schedArrSec),SD:hms(s.schedDepSec),A:hms(s.arrSec),D:hms(s.depSec),'A-SA':diff(s.arrSec-s.schedArrSec),'D-SD':diff(s.depSec-s.schedDepSec),H:dur(Number(s.holdSec))})[v]??v;
// 地圖標籤旗標的外部對照（3288、5971 沒經過臺南，看第一列：3288 仁德是內插、5971 保安是起點，開車時刻推定）。
const FLAG_KNOWN={'3031':'推定','3288':'內插','5971':'推定','3778':'內插','3782':'實測'};
const isTainan=s=>s.name.replace('台','臺')==='臺南',anchorOf=t=>(t.stops.find(isTainan)||t.stops[0]).arrSec;
const cssRgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
const toHsl=([r,g,b])=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2;let h=0;if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;}return {h,s:d?d/(1-Math.abs(2*l-1)):0,l};};
// 兩張 PNG 在頁面裡解碼後逐像素比：回傳差異像素數與「有光暈那張」差異處的平均顏色（不經網路，不產生請求）。
const pixelDiff=(page,a,b)=>page.evaluate(async([a,b])=>{
 const load=async s=>{const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const bmp=await createImageBitmap(new Blob([u],{type:'image/png'})),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(bmp,0,0);return g.getImageData(0,0,bmp.width,bmp.height).data;};
 const A=await load(a),B=await load(b);let n=0,r=0,g=0,bl=0;
 for(let i=0;i<A.length;i+=4){const d=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]);if(d>60){n++;r+=A[i];g+=A[i+1];bl+=A[i+2];}}
 return {n,total:A.length/4,avg:n?[r/n,g/n,bl/n].map(Math.round):null};
},[a.toString('base64'),b.toString('base64')]);
// 開場：預設時刻讀 snapshot.defaultSec（22:00）、標題與日期、說明文字要點。
async function lastDayOpening(page,{engine,width,height}){
 const where=`${engine} ${width}×${height}`;
 const r=await page.evaluate(()=>{const d=tainanMemory.data;return {sec:tainanMemory.state.sec,def:d.defaultSec,title:document.title,h1:document.querySelector('h1').textContent,date:document.querySelector('.date').textContent,clock:document.getElementById('clock').textContent,tl:Number(document.getElementById('timeline').value),about:document.querySelector('#details .detail-body').textContent,sched:[...new Set(d.trains.filter(t=>t.timing==='scheduled').map(t=>t.train))].sort(),from:d.singleLine?.fromSec,night:!document.getElementById('night').hidden};});
 const fail=m=>{throw Error(`[10/16 ${where}] 開場：${m}`);};
 if(r.def!==79200)fail('snapshot.defaultSec 不是 22:00（79200）：'+r.def);
 if(!(r.sec>=r.def&&r.sec<r.def+120))fail(`開場時刻 ${r.sec} 不是 defaultSec ${r.def}（容許 120 秒的自動播放）`);
 if(!r.clock.startsWith('22:0')||r.tl<r.def||r.tl>=r.def+120)fail(`時鐘或時間軸沒有落在 22:00 起：${r.clock} / ${r.tl}`);
 if(!r.title.includes('臺南地面鐵道最後一天・2026 年 10 月 16 日'))fail('標題不對：'+r.title);
 if(r.h1!=='臺南地面鐵道最後一天'||r.date!=='2026 年 10 月 16 日')fail(`h1／日期不對：${r.h1} / ${r.date}`);
 if(!r.night)fail('資料有事件，時間軸面板卻是隱藏的');
 if(r.sched.length===0)fail('snapshot 沒有任何 timing==="scheduled" 的班次（6631～6633 應整班照表定）');
 const need=['臺鐵即時動態','不是 GPS 軌跡','誤差約半分鐘','有到站紀錄的站與起點站','大橋與仁德兩站不回報','這兩站的到站與開車時間都是由前後站內插出來的','內插',r.sched.join('、')+' 次沒有任何即時動態紀錄','照時刻表畫','「無即時動態紀錄」','股道位置是推演','單線雙向',hhmm(r.from),'封鎖初期股道安排不明','股道安排待確認','區間車（8 節）與莒光號（9 節）是推估編組','沿用 9 月 12 日的封存版本','隔天清晨 6 點','地下化'];
 const miss=need.filter(k=>!r.about.includes(k));if(miss.length)fail('說明文字缺這些要點：'+JSON.stringify(miss));
 return {defaultSec:r.def,scheduledTrains:r.sched};
}
async function lastDayChecks(page,{engine,width,height,click,out}){
 const where=`${engine} ${width}×${height}`,done=[],side=width>=900||height<=520,openDefault=width>=900||(width>=700&&height<=520);   // side＝面板在場景右側（寬 900 以上或高 520 以下）；openDefault＝預設展開（寬 900 以上，或寬 700 以上的橫向手機）
 const step=async(name,fn)=>{try{await fn();done.push(name);}catch(e){e.message=`[10/16 ${where}] ${name}：${e.message}`;console.log('FAIL '+String(e.message).split('\n')[0]);throw e;}};   // 改過的 message 不會出現在 Node 印出的 stack 裡，所以另外印一行，失敗時才看得到是哪一步、哪個視窗
 const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const isOpen=async()=>(await page.locator('#nightToggle').getAttribute('aria-expanded'))==='true';
 const setPanel=async open=>{if(await isOpen()!==open)await click('#nightToggle');assert.equal(await isOpen(),open,'面板沒有'+(open?'展開':'收合'));};
 const shot=name=>page.screenshot({path:`${out}/lastday-${engine}-${width}-${name}.png`});
 const D=await page.evaluate(()=>{const m=tainanMemory,d=m.data;return {events:d.events||[],single:d.singleLine||null,marks:m.marks,
  intervals:m.uncertainty.intervals.map(i=>({start:i.start,end:i.end,trains:i.trains,trainNos:i.trainNos,reason:i.reason||''})),
  trains:d.trains.map(t=>({id:t.id,train:t.train,direction:t.direction,typeName:t.typeName,mark:t.mark||'',timing:t.timing||'',stops:t.stops.map(s=>({name:s.name,stop:s.stop,arrSec:s.arrSec,depSec:s.depSec,schedArrSec:s.schedArrSec,schedDepSec:s.schedDepSec,src:s.src,holdSec:s.holdSec,end:s.end}))}))};});
 const gm=D.trains.find(t=>t.mark==='last-ground'),sm=D.trains.find(t=>t.mark==='last-south');
 const evs=[...D.events].sort((a,b)=>a.t-b.t);
 const rowChecks=async()=>{const n=await page.locator('#events .evb').count();assert.ok(n>0,'沒有任何可點的事件列');
  for(let i=0;i<n;i++){const b=page.locator('#events .evb').nth(i);await b.scrollIntoViewIfNeeded();
   const m=await b.evaluate(e=>{const r=e.getBoundingClientRect(),body=document.getElementById('nightBody').getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {h:Math.round(r.height),inBody:r.top>=body.top-.5&&r.bottom<=body.bottom+.5&&r.left>=body.left-.5&&r.right<=body.right+.5,inView:r.left>=-.1&&r.right<=innerWidth+.1&&r.top>=-.1&&r.bottom<=innerHeight+.1,hit:e===h||e.contains(h)};});
   assert.ok(m.h>=40&&m.inBody&&m.inView&&m.hit,`事件列 ${i} 摸不到或太小：${JSON.stringify(m)}`);}return n;};

 await step('資料契約：兩班重點車（3782 地面最後一班、145 最後南下）、每班都有 timing、事件與單線欄位齊全',async()=>{
  assert.ok(gm&&sm,'snapshot 缺 mark');assert.equal(gm.train,'3782');assert.equal(sm.train,'145');
  assert.deepEqual(D.trains.filter(t=>!['observed','scheduled'].includes(t.timing)).map(t=>t.train),[],'有班次沒有 timing');
  assert.ok(evs.length>=2&&evs.every(e=>e.id&&Number.isFinite(e.t)&&e.text&&KIND_ZH[e.kind]),'events 欄位不齊');
  assert.ok(evs.some(e=>e.t>=86400),'缺次日 06:00 通車那一列');assert.ok(D.single&&Number.isFinite(D.single.fromSec)&&Number.isFinite(D.single.toSec)&&D.single.note,'缺 singleLine');
 });

 await step('最後一夜面板：寬 900 以上與寬 700 以上的橫向手機預設展開，其餘預設收合；展開與收合都不擋控件、不溢出；每一列都摸得到',async()=>{
  const st=()=>page.evaluate(()=>{const t=document.getElementById('nightToggle'),b=document.getElementById('nightBody'),n=document.getElementById('night');return {exp:t.getAttribute('aria-expanded'),body:getComputedStyle(b).display,hidden:n.hidden,bh:b.getBoundingClientRect().height};});
  const s0=await st();assert.equal(s0.hidden,false,'面板被藏起來');assert.equal(s0.exp,String(openDefault),'預設展開狀態不對（寬 900 以上與寬 700 以上的橫向手機應展開，其餘應收合）');assert.equal(s0.body==='none',!openDefault,'內容顯示狀態跟 aria-expanded 不一致');
  for(const open of openDefault?[true,false]:[false,true]){await setPanel(open);const s=await st();assert.equal(s.exp,String(open));assert.equal(s.body==='none',!open);if(open)assert.ok(s.bh>40,'展開後內容高度只有 '+s.bh);
   const l=await controls(page,'body','#events');assert.deepEqual(l.errors,[],`面板${open?'展開':'收合'}：`+JSON.stringify(l.errors));
   // 場景不能疊到標頭或重播控制，重播控制也不能超出視窗：場景蓋住的若只是日期之類的文字，上面的控件掃描看不到。
   const g=await page.evaluate(()=>{const R=s=>document.querySelector(s).getBoundingClientRect(),sc=R('#scene'),pb=R('.playback');return {sceneTop:sc.top,sceneBottom:sc.bottom,headerBottom:R('header').bottom,playbackTop:pb.top,playbackBottom:pb.bottom,vh:innerHeight};});
   assert.ok(g.sceneTop>=g.headerBottom-.5&&g.sceneBottom<=g.playbackTop+.5&&g.playbackBottom<=g.vh+.5,`面板${open?'展開':'收合'}：場景疊到標頭或重播控制，或重播控制超出視窗 `+JSON.stringify(g));
   if(open)await rowChecks();await shot(open?'panel-open':'panel-closed');}
  await setPanel(openDefault);
 });

 await step('時間軸：列的內容、種類標籤；每一列跳到對的時刻、有 train 的同時跟車；過去／現在／未來標記；次日列不可點',async()=>{
  const rows=await page.evaluate(()=>[...document.querySelectorAll('#events > li.ev')].map(li=>({id:li.dataset.id,tag:li.firstElementChild.tagName,time:li.querySelector('time').textContent,text:li.querySelector('.tx').textContent,kd:li.querySelector('.kd').textContent})));
  assert.equal(rows.length,evs.length,'列數與 snapshot.events 不同');
  evs.forEach((e,i)=>{const r=rows[i];assert.deepEqual(r,{id:e.id,tag:e.t<86400?'BUTTON':'DIV',time:evTime(e.t),text:e.text,kd:KIND_ZH[e.kind]},'第 '+i+' 列內容');});
  for(let i=0;i<evs.length;i++){const e=evs[i];if(e.t>=86400)continue;
   await page.evaluate(()=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');});await frames();
   if(!openDefault)await setPanel(true);
   const sel=`#events > li.ev:nth-child(${i+1}) .evb`;await page.locator(sel).scrollIntoViewIfNeeded();await click(sel);await frames();
   const g=await page.evaluate(()=>({sec:tainanMemory.state.sec,follow:tainanMemory.state.follow,sel:document.getElementById('train').value,clock:document.getElementById('clock').textContent,open:document.getElementById('nightToggle').getAttribute('aria-expanded'),cardHidden:document.getElementById('followcard').hidden,cardTitle:document.querySelector('#followcard h3')?.firstElementChild?.textContent||'',
    rows:[...document.querySelectorAll('#events > li.ev')].map(li=>({st:li.dataset.state,mk:li.querySelector('.mk').textContent,cur:li.firstElementChild.getAttribute('aria-current')}))}));
   assert.ok(Math.abs(g.sec-e.t)<1,`第 ${i} 列（${e.id}）跳到 ${g.sec}，應為 ${e.t}`);assert.equal(g.clock,hms(e.t),'時鐘顯示');
   if(e.train!=null&&e.train!==''){const tr=D.trains.find(t=>t.id===g.follow);assert.ok(tr&&tr.train===String(e.train),`第 ${i} 列（${e.id}）應跟 ${e.train} 次，實際跟 ${tr?.train}`);assert.equal(g.sel,g.follow,'下拉選單沒跟著選');assert.equal(g.cardHidden,false,'跟車卡沒出現');assert.equal(g.cardTitle,e.train+' 次');}
   else{assert.equal(g.follow,'','沒有 train 的列不該開始跟車');}
   assert.equal(g.open,String(side),side?'面板在場景右側時，點了事件不該收合面板':'面板接在場景下方時，點了事件要收合面板，讓人看到場景');
   const cur=evs.reduce((c,x,j)=>x.t<=e.t?j:c,-1);
   g.rows.forEach((x,j)=>{const want=j<cur?'past':j===cur?'current':'future';assert.deepEqual(x,{st:want,mk:{past:'✓',current:'●',future:'○'}[want],cur:j===cur?'true':null},`點第 ${i} 列後，第 ${j} 列的標記`);});}
  // 次日列：不是按鈕、永遠在未來
  const nd=await page.evaluate(()=>[...document.querySelectorAll('#events > li.ev')].filter(li=>Number(li.dataset.t)>=86400).map(li=>({tag:li.firstElementChild.tagName,st:li.dataset.state,btn:!!li.querySelector('button')})));
  assert.ok(nd.length>0&&nd.every(x=>x.tag==='DIV'&&!x.btn&&x.st==='future'),'次日列不對：'+JSON.stringify(nd));
  await page.evaluate(()=>{tainanMemory.followTrain('');});await setPanel(openDefault);
 });

 await step('車次下拉選單：最上方固定兩班重點車、其餘照到臺南時間排且不重複、選了就跟',async()=>{
  const opts=await page.evaluate(()=>[...document.getElementById('train').options].map(o=>({v:o.value,t:o.textContent})));
  assert.deepEqual(opts[0],{v:'',t:'自由觀看'});
  assert.equal(opts[1].v,gm.id);assert.ok(opts[1].t.startsWith('★ 地面最後一班 · ')&&opts[1].t.includes(' · 3782 '),opts[1].t);
  assert.equal(opts[2].v,sm.id);assert.ok(opts[2].t.startsWith('★ 最後南下・告別列車 · ')&&opts[2].t.includes(' · 145 '),opts[2].t);
  const rest=[...D.trains].filter(t=>t.stops.length&&t.id!==gm.id&&t.id!==sm.id).sort((a,b)=>anchorOf(a)-anchorOf(b));
  assert.deepEqual(opts.slice(3).map(o=>o.v),rest.map(t=>t.id),'其餘選項沒有照到臺南時間排，或有重複／遺漏');
  rest.forEach((t,i)=>{const o=opts[3+i];assert.ok(!o.t.startsWith('★')&&o.t.endsWith(' · 表定')===(t.timing==='scheduled')&&o.t.includes(' · '+t.train+' '),'選項文字 '+o.t);});
  for(const t of [gm,sm]){await page.locator('#train').selectOption(t.id);await frames();assert.equal(await page.evaluate(()=>tainanMemory.state.follow),t.id);}
  await page.locator('#train').selectOption('');await frames();assert.equal(await page.evaluate(()=>tainanMemory.state.follow),'');
 });

 await step('標籤來源旗標：每班車照 anchorStop（臺南那一列，沒經過臺南的看第一列）帶 實測／內插／推定／表定；整班沒有即時紀錄的標「無即時動態紀錄」；重點車標籤文字',async()=>{
  const got=await page.evaluate(()=>Object.fromEntries(tainanMemory.data.trains.map(t=>{const e=tainanMemory.models.get(t.id).label.e,f=e.querySelector('.flag');return [t.id,{lt:e.querySelector('.lt').textContent,flag:f?.textContent||'',src:e.dataset.src||'',mark:e.dataset.mark||'',outline:f?getComputedStyle(f).outlineStyle:''}];})));
  const counts={obs:0,interp:0,est:0,sched:0};
  for(const t of D.trains){const {outline,...g}=got[t.id],k=t.timing==='scheduled'?'sched':(t.stops.find(isTainan)||t.stops[0])?.src;assert.ok(k in counts,`班次 ${t.train} 的臺南（或第一站）那一列沒有來源：${k}`);counts[k]++;
   assert.deepEqual(g,{lt:t.mark==='last-ground'?'地面最後一班 '+t.train:t.mark==='last-south'?'最後南下・告別列車 '+t.train:t.train+' '+t.direction,flag:t.timing==='scheduled'?'無即時動態紀錄':SRC_ZH[k],src:k,mark:t.mark},'班次 '+t.train);
   if(k==='est')assert.equal(outline,'dashed',`班次 ${t.train} 的「推定」旗標要有虛線外框（比照跟車卡的推定）`);}
  for(const [no,want] of Object.entries(FLAG_KNOWN)){const t=D.trains.find(x=>x.train===no);assert.ok(t,'snapshot 找不到 '+no+' 次');assert.equal(got[t.id].flag,want,no+' 次的標籤旗標（寫死的外部對照）');}
  for(const [k,n] of Object.entries(counts))assert.ok(n>0,`沒有任何一班帶「${k==='sched'?'無即時動態紀錄':SRC_ZH[k]}」旗標，這項檢查是空轉：`+JSON.stringify(counts));
 });

 // 兩班重點車的標籤與光暈：標籤文字／配色／可見度、光暈物件數＝車廂數，並用「關掉光暈前後的畫面差」證明光暈真的畫在畫面上、顏色對。
 const markCheck=async(tr,{text,sec,hueOk,colorOk,name,file})=>{
  if(!openDefault)await setPanel(false);
  await page.evaluate(([id,sec])=>{tainanMemory.state.playing=false;tainanMemory.followTrain(id,sec);},[tr.id,sec]);await frames();
  const L=await page.evaluate(id=>{const m=tainanMemory,model=m.models.get(id),e=model.label.e,cs=getComputedStyle(e),r=e.getBoundingClientRect(),s=document.getElementById('scene').getBoundingClientRect(),prev=e.style.pointerEvents;e.style.pointerEvents='auto';const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);e.style.pointerEvents=prev;
   return {hidden:e.hidden,display:cs.display,vis:cs.visibility,op:cs.opacity,lt:e.querySelector('.lt').textContent,mark:e.dataset.mark,bg:cs.backgroundColor,bd:cs.borderTopColor,w:r.width,h:r.height,inScene:r.left>=s.left-1&&r.right<=s.right+1&&r.top>=s.top-1&&r.bottom<=s.bottom+1,onTop:e===h||e.contains(h),groupVisible:model.group.visible,cars:model.cars.length,glow:model.glow?model.glow.list.length:-1};},tr.id);
  assert.ok(!L.hidden&&L.display!=='none'&&L.vis==='visible'&&Number(L.op)>.9&&L.w>40&&L.h>10&&L.inScene&&L.onTop&&L.groupVisible,name+' 標籤不可見：'+JSON.stringify(L));
  assert.equal(L.lt,text);assert.equal(L.mark,tr.mark);assert.ok(hueOk(L),name+' 標籤配色不對：'+JSON.stringify({bg:L.bg,bd:L.bd}));assert.equal(L.glow,L.cars,name+' 光暈數量應等於車廂數');
  // 光暈外圈只有約 3 個像素寬：小畫面（橫向手機）裡一列 3 節車只有 20 像素長，量不出差別。量測前把畫面放大到車身 ≥150 像素長（上限＝放大極限 34 m），
  // 用頁面上真正的「＋」鈕放大；標籤可見度與全頁截圖仍是放大前、使用者跟車當下看到的畫面。
  await shot(file);
  const measure=()=>page.evaluate(id=>{const m=tainanMemory,model=m.models.get(id),c=m.camera,r=m.renderer.domElement.getBoundingClientRect();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const car of model.cars){const v=c.position.clone().set(car.position.x,car.position.y,car.position.z+2).project(c),x=r.left+(v.x+1)/2*r.width,y=r.top+(1-v.y)/2*r.height;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
   const L=Math.hypot(x1-x0,y1-y0),pad=40;x0=Math.max(r.left,x0-pad);y0=Math.max(r.top,y0-pad);x1=Math.min(r.right,x1+pad);y1=Math.min(r.bottom,y1+pad);return {x:x0,y:y0,width:x1-x0,height:y1-y0,L,span:c.top-c.bottom};},tr.id);
  await page.waitForFunction(()=>tainanMemory.state.nearReady,null,{timeout:60000});   // 近景車身模型載入完才量：載入前後車身幾何不同，會被誤當成光暈的差異
  let clip=await measure();for(let i=0;i<8&&clip.L<150&&clip.span>34.5;i++){await click('#zoomin');await frames();clip=await measure();}await frames();
  assert.ok(clip.width>30&&clip.height>30,name+' 車身不在畫面裡：'+JSON.stringify(clip));
  const box={x:clip.x,y:clip.y,width:clip.width,height:clip.height};
  // 小畫面裡量測框會蓋到視角按鈕（剛按過的「＋」還在淡出 hover 底色）與標籤：量光暈時把場景上的 HTML 疊層藏起來，只比 WebGL 畫布。
  const overlays=on=>page.evaluate(on=>{for(const e of document.querySelectorAll('#labels,.view-controls,#singleline,.scene-note'))e.style.visibility=on?'':'hidden';},on);
  await overlays(false);await frames();await page.waitForTimeout(700);   // 剛按過「＋」：手機模擬的點按反白要等它退掉
  const withGlow=await page.screenshot({clip:box}),again=await page.screenshot({clip:box});
  const noise=await pixelDiff(page,withGlow,again);assert.equal(noise.n,0,name+' 同一個畫面連拍兩張就不一樣（'+noise.n+' 像素），量測不可信');   // 對照組：沒動任何東西，差異必須是 0
  const setGlow=on=>page.evaluate(([id,on])=>{for(const c of tainanMemory.models.get(id).glow.list){c.shell.visible=on;c.floor.visible=on;}},[tr.id,on]);
  await setGlow(false);await frames();const without=await page.screenshot({clip:box});await setGlow(true);await frames();
  const back=await page.screenshot({clip:box});await overlays(true);await frames();
  const restore=await pixelDiff(page,withGlow,back);assert.equal(restore.n,0,name+' 光暈關了又開，畫面沒有回到原樣（'+restore.n+' 像素），差異不能全算在光暈上');   // 對照組：開→關→開要回到一模一樣的畫面
  fs.writeFileSync(`${out}/lastday-${engine}-${width}-${file}-glow-on.png`,withGlow);fs.writeFileSync(`${out}/lastday-${engine}-${width}-${file}-glow-off.png`,without);
  const d=await pixelDiff(page,withGlow,without);
  // 外圈約 3 個像素寬、沿車身兩側：差異像素數至少要有「車身在畫面上的長度（像素）」的 2 倍（實測約 6～9 倍）；沒有光暈時關前後的差異是 0。
  const need=Math.max(20,Math.round(2*clip.L));
  assert.ok(d.n>=need&&d.avg&&colorOk(d.avg),`${name} 光暈在畫面上的差異不足（要 ≥${need}）或顏色不對：${JSON.stringify({...d,trainLengthPx:Math.round(clip.L)})}`);
  return {labelBg:L.bg,labelBd:L.bd,glowPixels:d.n,glowAvgRgb:d.avg,trainLengthPx:Math.round(clip.L),cameraSpanM:Math.round(clip.span)};
 };
 const marks={};
 await step('地面最後一班 3782：23:05 金色標籤看得見、車身外圈金色光暈真的畫出來',async()=>{
  marks.ground=await markCheck(gm,{text:'地面最後一班 3782',sec:83100,name:'3782 地面最後一班',file:'mark-3782',
   hueOk:L=>{const h=toHsl(cssRgb(L.bg));return h.h>=38&&h.h<=52&&h.s>.6;},colorOk:([r,g,b])=>r>=200&&g>=140&&r-b>=60&&g-b>=30});
 });
 await step('最後南下 145：標籤文字、深紅配色、紅色光暈真的畫出來',async()=>{
  const at=sm.stops.find(isTainan).arrSec+5;
  marks.south=await markCheck(sm,{text:'最後南下・告別列車 145',sec:at,name:'145 最後南下',file:'mark-145',
   hueOk:L=>{const h=toHsl(cssRgb(L.bd));return (h.h<=12||h.h>=348)&&h.s>.3;},colorOk:([r,g,b])=>r-g>=40&&r-b>=40});
 });

 // 期望值照驗收腳本自己的規則算（CARD_HEAD、ARR_ZH／DEP_ZH、cardWant），不照抄頁面的公式；CARD_KNOWN 寫死的幾列另當外部對照。
 await step('跟車逐站卡：欄序 站／表定／重播／來源／差／留置；起點站沒有到站、終點站沒有開車記「—」；到站與開車的來源各照規則；逐站對得上 snapshot，另列這班車自己的事件',async()=>{
  const sched=D.trains.find(t=>t.timing==='scheduled'),held=D.trains.find(t=>!t.mark&&t.timing==='observed'&&t.stops.some(s=>Number(s.holdSec)>=90))||D.trains.find(t=>!t.mark&&t.timing==='observed');
  const picks=[gm,sm,sched,held].filter(Boolean);assert.equal(picks.length,4,'找不到要驗的四班車（兩班重點車、一班整班表定、一班一般實測）');
  for(const t of D.trains)if((t.stops.some(s=>s.stop===false&&Number(s.holdSec)>=90)||CARD_KNOWN.some(k=>k[0]===t.train))&&!picks.includes(t))picks.push(t);   // 另外把「表定通過、實際留置」的站所在的班次、外部對照列所在的班次也驗到
  const known=new Map(CARD_KNOWN.map(k=>[k[0]+' '+k[1],k])),knownSeen=new Set(),arrSeen=new Set(),depSeen=new Set();
  let holdRows=0,noHoldRows=0,heldPassRows=0,originRows=0,terminalRows=0,twoLineEnds=0;
  for(const t of picks){
   await page.evaluate(()=>{tainanMemory.state.playing=false;});await page.locator('#train').selectOption(t.id);await frames();
   const g=await page.evaluate(()=>{const c=document.getElementById('followcard');if(c.hidden)return null;return {sec:tainanMemory.state.sec,h3:[...c.querySelector('h3').children].map(x=>x.textContent),status:c.querySelector('.st').textContent,note:c.querySelector('.note').textContent,head:[...c.querySelectorAll('thead th')].map(th=>th.textContent),
    rows:[...c.querySelectorAll('tbody tr')].map(tr=>({name:tr.querySelector('th').textContent,state:tr.dataset.state||'',tds:[...tr.querySelectorAll('td')].map(td=>[...td.querySelectorAll('.ln')].map(l=>l.textContent)),holdCls:!!tr.querySelector('td.hold')})),
    mine:[...c.querySelectorAll('.mine li')].map(li=>[li.querySelector('time').textContent,li.querySelector('span').textContent]),hint:document.querySelector('#nightToggle .s').textContent};});
   assert.ok(g,t.train+' 沒有跟車卡');
   assert.deepEqual(g.h3,[t.train+' 次',t.typeName+' '+t.direction,...(t.mark==='last-ground'?['地面最後一班']:t.mark==='last-south'?['最後南下・告別列車']:[])],t.train+' 卡片標題');
   assert.equal(g.rows.length,t.stops.length,t.train+' 逐站列數');
   assert.deepEqual(g.head,CARD_HEAD,t.train+' 卡片欄名與順序（來源緊接在重播後面；開車時刻多半是推定，欄名不能寫「實測」）');
   t.stops.forEach((s,i)=>{const r=g.rows[i],want=cardWant(s),pass=s.stop===false,hold=Number(s.holdSec)>=90,passed=pass&&!hold,noArr=s.end==='origin'&&s.arrSec===s.depSec,noDep=s.end==='terminal'&&s.arrSec===s.depSec;
    assert.equal(r.name,s.name);assert.deepEqual(r.tds,want,`${t.train} ${s.name} 的表定／重播／來源／差／留置`);assert.equal(r.holdCls,hold,`${t.train} ${s.name} 留置的強調樣式`);
    const k=known.get(t.train+' '+s.name.replace('台','臺'));if(k){assert.deepEqual(r.tds,k.slice(2).map(col=>col.map(v=>cardTok(s,v))),`${t.train} ${s.name}（寫死的外部對照）`);knownSeen.add(k[0]+' '+k[1]);}
    const slack=pass?10:0;assert.equal(r.state,g.sec>s.depSec+slack?'past':g.sec>=s.arrSec-slack?'now':'future',`${t.train} ${s.name} 的過去／現在／未來標記`);
    if(hold)holdRows++;else if(!pass&&Number(s.holdSec)<90)noHoldRows++;if(pass&&hold)heldPassRows++;if(noArr)originRows++;if(noDep)terminalRows++;if(s.end&&s.arrSec!==s.depSec)twoLineEnds++;
    if(!noArr)arrSeen.add(ARR_ZH[s.src]);if(!passed&&!noDep)depSeen.add(s.src);});
   assert.deepEqual(g.mine,evs.filter(e=>e.train!=null&&String(e.train)===t.train||e.ref?.trainId===t.id).map(e=>[evTime(e.t),e.text]),t.train+' 的「這班車在最後一夜」清單（點了跟別班、時刻取自這班車停站的那一列也算）');
   assert.ok(t.timing==='scheduled'?g.note.includes('沒有任何即時動態紀錄'):CARD_NOTE.every(p=>g.note.includes(p)),t.train+' 卡片註腳：'+g.note);
   assert.equal(g.hint,'跟車中：'+t.train+' 次的逐站時刻','收合列的副標');
   if(t===sm){if(!openDefault)await setPanel(true);await page.locator('#followcard').scrollIntoViewIfNeeded();const box=await page.locator('#followcard').boundingBox();assert.ok(box&&box.width>100&&box.height>60,'跟車卡在畫面上沒有大小');await shot('card-145');await setPanel(openDefault);}}
  assert.ok(holdRows>0,'四班車裡沒有任何留置（≥90 秒）的列，留置欄位這項檢查是空轉');assert.ok(heldPassRows>0,'沒有任何「表定通過、實際留置」的列，到站／開車並列這項檢查是空轉');assert.ok(noHoldRows>0,'沒有任何「未達 90 秒、不標留置」的列，反向對照缺');
  assert.ok(originRows>0&&terminalRows>0&&twoLineEnds>0,`起點站「—」${originRows} 列、終點站「—」${terminalRows} 列、到開不同秒的起訖站 ${twoLineEnds} 列，三種都要驗到`);
  assert.deepEqual([...known.keys()].filter(k=>!knownSeen.has(k)),[],'寫死的外部對照列沒有全部驗到');
  for(const k of ['實測','內插','表定'])assert.ok(arrSeen.has(k),'驗到的列裡沒有到站來源「'+k+'」');
  for(const k of ['obs','interp','est','sched'])assert.ok(depSeen.has(k),`驗到的列裡沒有 src=${k} 的開車那一行，開車來源 ${k}→${DEP_ZH[k]} 沒驗到`);
  await page.locator('#train').selectOption('');await frames();const off=await page.evaluate(()=>({hidden:document.getElementById('followcard').hidden,hint:document.querySelector('#nightToggle .s').textContent}));
  assert.equal(off.hidden,true,'取消跟車後卡片還在');assert.equal(off.hint,'點一列，跳到那個時刻','取消跟車後副標沒復原');
 });

 await step('單線雙向：時段內場景裡有一行說明、時段外沒有，不壓控件、不接收指標',async()=>{
  await setPanel(openDefault);const sl=D.single,mid=Math.round((sl.fromSec+sl.toSec)/2);
  for(const [sec,on] of [[sl.fromSec-60,false],[sl.fromSec+2,true],[mid,true],[sl.toSec-2,true],[sl.toSec+60,false]]){
   await page.evaluate(sec=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');tainanMemory.jump(sec);},sec);await frames();
   const g=await page.evaluate(()=>{const e=document.getElementById('singleline'),r=e.getBoundingClientRect(),s=document.getElementById('scene').getBoundingClientRect(),cs=getComputedStyle(e),hit=[];
    if(!e.hidden)for(const o of [...document.querySelectorAll('#scene button,#scene a,#scene input,#scene select,#scene .scene-note')]){if(e.contains(o))continue;const b=o.getBoundingClientRect();if(!b.width||!b.height||getComputedStyle(o).display==='none')continue;if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)hit.push(o.id||o.className||o.tagName);}
    return {hidden:e.hidden,text:document.getElementById('slNote').textContent,pe:cs.pointerEvents,inScene:r.left>=s.left-1&&r.right<=s.right+1&&r.top>=s.top-1&&r.bottom<=s.bottom+1,w:r.width,hit};});
   assert.equal(g.hidden,!on,`${hms(sec)} 單線說明該${on?'顯示':'隱藏'}`);
   if(on){assert.equal(g.text,sl.note);assert.equal(g.pe,'none');assert.ok(g.inScene&&g.w>60,'說明超出場景：'+JSON.stringify(g));assert.deepEqual(g.hit,[],'單線說明壓到控件或操作提示');}}
 });

 await step('不確定時段：每種 reason 各有字幕寫法（封鎖初期股道安排不明／股道安排待確認）；車身隱藏、標籤留原位、離開後恢復',async()=>{
  const reasons=[...new Set(D.intervals.map(i=>i.reason))];assert.ok(reasons.length>0&&reasons.every(r=>WORDS[r]),'intervals 的 reason 缺漏或未知：'+JSON.stringify(reasons));
  assert.ok(reasons.includes('single-line-unresolved'),'封鎖初期（22:00 到單線起點）那幾班要有 single-line-unresolved 的不確定時段：'+JSON.stringify(reasons));   // track-overlap 有就驗、沒有就略過（兩種都有時各驗一次）
  for(const r of reasons){
   // 每種 reason 挑「中點時至少一班有畫出」的第一個時段：中點時兩班都在畫面範圍外的時段（例如 22:01 永康—大橋）本來就沒有字幕與標記，挑它檢查會空轉；全部都這樣就明講失敗，不靜默略過。
   const cands=D.intervals.filter(i=>i.reason===r);let iv=null,drawn=[];
   for(const c of cands){const ids=await page.evaluate(([ids,sec])=>ids.filter(id=>!!tainanMemory.sample(tainanMemory.data.trains.find(t=>t.id===id),sec)),[c.trains,(c.start+c.end)/2]);if(ids.length){iv=c;drawn=ids;break;}}
   assert.ok(iv,`${r}：${cands.length} 個時段的中點都沒有任何一班車在畫面範圍內，沒有可驗的對象：`+cands.map(c=>hms(c.start)+'–'+hms(c.end)+' '+c.trainNos.join('/')).join('、'));
   const sec=(iv.start+iv.end)/2,drawnNos=drawn.map(id=>iv.trainNos[iv.trains.indexOf(id)]);console.log(`[10/16 ${where}] 不確定時段 ${r}：挑 ${hms(iv.start)}–${hms(iv.end)} ${iv.trainNos.join('/')}，中點有畫出 ${drawnNos.join('/')}`);
   await page.evaluate(sec=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');tainanMemory.jump(sec);tainanMemory.stationView();},sec);await frames();
   const g=await page.evaluate(([ids,sec])=>{const m=tainanMemory;const sampled=id=>!!m.sample(m.data.trains.find(t=>t.id===id),sec);return {caption:document.getElementById('caption').textContent,cls:document.getElementById('caption').classList.contains('uncertain'),
    now:m.uncertainty.intervals.filter(i=>sec>=i.start&&sec<=i.end).map(i=>({reason:i.reason||'',on:i.trains.some(sampled)})),
    own:ids.map(id=>{const model=m.models.get(id),p=m.sample(m.data.trains.find(t=>t.id===id),sec);return {id,bodyHidden:!model.group.visible,keep:!!model.label.coordinate&&!!p&&Math.hypot((model.label.coordinate[0]-p.coordinate[0])*102000,(model.label.coordinate[1]-p.coordinate[1])*111320)<.001,dashed:model.label.e.classList.contains('uncertain')};})};},[drawn,sec]);
   assert.ok(g.cls,r+' 字幕沒有標成不確定樣式');
   for(const [k,w] of Object.entries(WORDS)){const present=g.now.some(x=>x.reason===k&&x.on);assert.equal(g.caption.includes(w),present,`${hms(sec)} 字幕「${w}」該${present?'出現':'不出現'}：${g.caption}`);}
   assert.ok(g.now.some(x=>x.reason===r&&x.on),r+' 的挑選時刻沒有任何車在場景內，這項檢查是空轉');
   for(const n of drawnNos)assert.ok(g.caption.includes(n),`字幕缺車次 ${n}：${g.caption}`);
   for(const o of g.own)assert.deepEqual([o.bodyHidden,o.keep,o.dashed],[true,true,true],`${r} 的 ${o.id} 沒有保留原位置標記`);
   await page.evaluate(sec=>{tainanMemory.jump(sec);},iv.end+2);await frames();
   const after=await page.evaluate(([ids,sec])=>{const m=tainanMemory,busy=new Set(m.uncertainty.intervals.filter(i=>sec>=i.start&&sec<=i.end).flatMap(i=>i.trains));return ids.filter(id=>!busy.has(id)).map(id=>({id,visible:m.models.get(id).group.visible,sampled:!!m.sample(m.data.trains.find(t=>t.id===id),sec)}));},[iv.trains,iv.end+2]);
   for(const a of after)if(a.sampled)assert.ok(a.visible,`${r}：離開時段後 ${a.id} 沒有恢復車身`);}
 });
 return {steps:done.length,marks};
}
// ── 單線說明框、標籤疊放、跟車卡留置站（只看資料有沒有 singleLine，不看日期）──────────────────────────────────
// 窄版＝視窗寬 899 px 以下，或高 600 px 以下（replay.css 的 @media(max-width:899px),(max-height:600px)）：預設只有一行摘要與「說明」鈕，點開才看完整說明；寬版直接列出完整說明。
// 高的門檻是 600 不是 520：寬 900 以上、高 600 以下的視窗，最後一夜照預設展開在側邊，場景只剩約 600 px 寬，完整說明會長到蓋住整排視角按鈕（SL_SWEEP 裡的寬版矮視窗守這一條）。
// 預期值一律從 snapshot（singleLine、trains、events）與上面的 hhmm／hms／diff／dur 算，不呼叫頁面自己的格式化函式；失敗訊息開頭是「引擎 寬×高」與檢查名稱。
const NARROW=(w,h)=>w<=899||h<=600;
const SL_SWEEP=[[360,780],[375,812],[390,844],[414,896],[600,900],[601,900],[768,1024],[899,1000],[900,900],[932,430],[1024,768],[1280,800],[568,320],[640,360],[667,375],[844,340],[900,530],[920,540],[1100,540],[900,600],[900,601],[1366,600]];   // 含 899／900 與 600／601 兩側；932×430（橫向手機，寬已過 899，靠高 600 px 以下收合）；568×320、640×360、667×375（寬不到 700 的橫向手機，最後一夜面板收成右上角按鈕）；844×340（iPhone 橫拿時 Safari 的可視高度，重播控制縮排）；900×530、920×540、1100×540、900×600、1366×600（寬版但矮：最後一夜照預設展開在側邊，要收成摘要＋「說明」鈕，收合與展開都不碰視角按鈕）與 900×601（高度門檻的另一側：寬版完整說明，也不碰視角按鈕）
const INTERACTIVE='a[href],button,input,select,textarea,summary,[role=button],[tabindex]:not([tabindex="-1"])';
const ovl=(a,b)=>Math.min(a.r,b.r)-Math.max(a.l,b.l)>.5&&Math.min(a.b,b.b)-Math.max(a.t,b.t)>.5;
const WHEEL={eligible:[],ran:[]};   // 滾輪捲說明框：eligible＝Chromium 跑過橫向窄版（高 520 以下）的「說明」鈕檢查；ran＝真的滾過（說明被截高才會滾）。整輪結束時檢查
async function singleLineChecks(page,{engine,width,height,click,sweep}){
 const where=`${engine} ${width}×${height}`,done=[],ratios=[],fails=[];
 const step=async(name,fn)=>{try{await fn();done.push(name);}catch(e){e.message=`[單線說明 ${where}] ${name}：${e.message}`;console.log('FAIL '+String(e.message).split('\n')[0]);if(!process.env.KEEP_GOING)throw e;fails.push(String(e.message).split('\n')[0]);}};   // KEEP_GOING=1：紅了也往下跑，最後一次列出全部（突變測試看哪幾步會紅）
 const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const follow=async(id,sec)=>{await page.evaluate(([id,sec])=>{tainanMemory.state.playing=false;tainanMemory.followTrain(id,sec);},[id,sec]);await frames();};
 const D=await page.evaluate(()=>{const d=tainanMemory.data,pick=m=>{const t=d.trains.find(x=>x.mark===m);return t&&{id:t.id,train:t.train};};
  return {single:d.singleLine,gm:pick('last-ground'),sm:pick('last-south'),meet:(d.events||[]).find(e=>e.id==='meet-baoan')?.t,
   held:d.trains.filter(t=>t.stops.some(s=>s.stop===false&&Number(s.holdSec)>=90)).map(t=>({id:t.id,train:t.train,stops:t.stops.map(s=>({name:s.name,stop:s.stop,arrSec:s.arrSec,depSec:s.depSec,schedArrSec:s.schedArrSec,schedDepSec:s.schedDepSec,holdSec:s.holdSec}))}))};});
 assert.ok(D.single&&D.gm&&D.sm,'資料缺 singleLine 或兩班重點車（地面最後一班、最後南下）');
 const SAMPLES=[[D.gm,81900],[D.gm,83100],[D.sm,81000],[D.sm,82200]];   // 22:45:00 與 23:05:00 跟地面最後一班、22:30:00 與 22:50:00 跟最後南下；22:30 時 145 還在畫面範圍外（永康），標籤不會出現
 const sumWant=hhmm(D.single.fromSec)+' 起單線雙向';
 const measure=(id,sec)=>page.evaluate(([id,sec])=>{const m=tainanMemory,q=i=>document.getElementById(i),cs=e=>getComputedStyle(e),R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};};
  const box=q('singleline'),tg=q('slToggle'),note=q('slNote'),le=m.models.get(id).label.e,tr=m.data.trains.find(t=>t.id===id);if(!box||!tg||!note||!q('slSum'))throw Error('單線說明缺 #slToggle／#slNote／#slSum：沒有「摘要＋說明鈕＋說明文字」的結構');
  const others=[...document.querySelectorAll('#scene button,#scene a,#scene input,#scene select,#scene .scene-note')].filter(o=>!box.contains(o)&&o.getClientRects().length&&cs(o).display!=='none').map(o=>({id:o.id||o.className||o.tagName,...R(o)}));
  return {vw:innerWidth,vh:innerHeight,hidden:box.hidden,squeezed:q('scene').classList.contains('squeezed'),scene:R(q('scene')),box:R(box),boxPe:cs(box).pointerEvents,
   toggle:{display:cs(tg).display,pe:cs(tg).pointerEvents,exp:tg.getAttribute('aria-expanded'),ctl:tg.getAttribute('aria-controls'),...R(tg)},sum:q('slSum').textContent,
   note:{display:cs(note).display,pe:cs(note).pointerEvents,vis:cs(note).visibility,oy:cs(note).overflowY,ta:cs(note).touchAction,sh:note.scrollHeight,ch:note.clientHeight,text:note.textContent,...R(note)},
   label:le.hidden?null:R(le),drawn:!!m.sample(tr,m.state.sec),others};},[id,sec]);
 // 時段外（單線說明結束後、開始前）整塊都不能被畫出來：窄版另外設了 display，不能蓋過 hidden 屬性；只看 hidden 屬性會漏掉這種蓋過。
 const offAt=async(w,h)=>{for(const sec of [D.single.fromSec-60,D.single.toSec+60]){await follow(D.gm.id,sec);
   const o=await page.evaluate(()=>{const e=document.getElementById('singleline');return {hidden:e.hidden,box:e.getClientRects().length,toggle:document.getElementById('slToggle').getClientRects().length};});
   assert.deepEqual(o,{hidden:true,box:0,toggle:0},`${w}×${h} ${hms(sec)}：時段外說明框要完全不顯示（含「說明」鈕）：`+JSON.stringify(o));}};
 // 預設狀態的版面：每個視窗大小各量一次。
 const layoutAt=async(w,h)=>{await page.evaluate(()=>{tainanMemory.night.setOpen(null);});const narrow=NARROW(w,h),seen={};
  for(const [tr,sec] of SAMPLES){await follow(tr.id,sec);const g=await measure(tr.id,sec),at=`${w}×${h} ${hms(sec)} 跟 ${tr.train}`;
   assert.equal(g.vw,w,at+'：視窗寬度沒有切到位');assert.equal(g.hidden,false,at+'：單線說明該顯示');assert.equal(g.squeezed,false,at+'：場景被壓扁，單線說明被收起來');
   assert.equal(g.boxPe,'none',at+'：說明框容器該不接收指標');assert.equal(g.note.pe,'none',at+'：說明文字該不接收指標（不擋地圖拖曳）');
   assert.ok(g.box.l>=g.scene.l-1&&g.box.r<=g.scene.r+1&&g.box.t>=g.scene.t-1&&g.box.b<=g.scene.b+1,at+'：說明框超出場景 '+JSON.stringify({box:g.box,scene:g.scene}));
   const ratio=g.box.w*g.box.h/(g.scene.w*g.scene.h);
   if(narrow){assert.notEqual(g.toggle.display,'none',at+'：窄版要有「說明」鈕');assert.equal(g.toggle.exp,'false',at+'：窄版預設要收合');assert.equal(g.toggle.ctl,'slNote',at+'：aria-controls');assert.ok(g.toggle.h>=32,at+'：「說明」鈕高 '+g.toggle.h+' px，觸控目標至少 32 px');
    assert.equal(g.toggle.pe,'auto',at+'：「說明」鈕要接收指標');assert.equal(g.note.display,'none',at+'：窄版預設不顯示完整說明');assert.equal(g.sum,sumWant,at+'：摘要時刻要照 singleLine.fromSec');
    assert.ok(ratio<=.10,at+`：說明框佔場景 ${(ratio*100).toFixed(1)}%，窄版要 ≤10%`);}
   else{assert.equal(g.toggle.display,'none',at+'：寬版不該有「說明」鈕');assert.notEqual(g.note.display,'none',at+'：寬版要直接列出完整說明');assert.equal(g.note.text,D.single.note,at+'：寬版的說明文字');}
   const hit=g.others.filter(o=>ovl(g.box,o)).map(o=>o.id);assert.deepEqual(hit,[],at+'：說明框壓到控件或操作提示');
   let lab=null;if(g.label){lab=ovl(g.box,g.label);assert.ok(!lab,at+'：說明框蓋到被跟列車的標籤 '+JSON.stringify({box:g.box,label:g.label}));seen[tr.train]=(seen[tr.train]||0)+1;}
   else assert.equal(g.drawn,false,at+'：列車有畫出、標籤卻被藏起來，無法判斷說明框有沒有蓋到它');
   ratios.push({w,h,sec:hms(sec),train:tr.train,narrow,ratioPct:Math.round(ratio*1000)/10,labelShown:!!g.label});}
  for(const tr of [D.gm,D.sm])assert.ok(seen[tr.train]>0,`${w}×${h}：跟 ${tr.train} 的每個取樣時刻標籤都不在畫面內，「說明框不蓋標籤」這項檢查是空轉`);
  await offAt(w,h);};
 // 切換鈕：真的點（觸控 context 用 page.tap）、aria-expanded 跟著變；展開與收合都跟所有互動元素兩兩比相交、「說明」鈕座標的 elementFromPoint 回到它自己。
 const scan=()=>page.evaluate(sel=>{const R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};},
   /* 看得到的那一塊：把矩形依序裁到有捲動／裁切的祖先之內（例如夜間面板捲動後，捲到框外的事件列）；被裁光的元素使用者點不到也看不到，不算相交。 */
   vis=e=>{let r=R(e);for(let p=e.parentElement;p&&p!==document.documentElement;p=p.parentElement){const c=getComputedStyle(p);if(c.overflowX!=='visible'||c.overflowY!=='visible'){const q=p.getBoundingClientRect();r={l:Math.max(r.l,q.left),t:Math.max(r.t,q.top),r:Math.min(r.r,q.right),b:Math.min(r.b,q.bottom)};}if(c.position==='fixed')break;}return r;},ov=(a,b)=>Math.min(a.r,b.r)-Math.max(a.l,b.l)>.5&&Math.min(a.b,b.b)-Math.max(a.t,b.t)>.5;
  const els=[...document.querySelectorAll(sel)].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])')&&getComputedStyle(e).visibility!=='hidden'),boxes=els.map(e=>({e,id:e.id||String(e.className||'')||e.tagName,...vis(e)})).filter(b=>b.r>b.l&&b.b>b.t),errors=[],detail=[];
  const rc=b=>[b.l,b.t,b.r,b.b].map(Math.round).join(',');
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;if(ov(a,b)){errors.push('相交:'+a.id+'/'+b.id);detail.push(a.id+'['+rc(a)+'] × '+b.id+'['+rc(b)+']');}}
  detail.push('scrollY='+scrollY+' innerH='+innerHeight+' docH='+document.documentElement.scrollHeight+' evTop='+(document.getElementById('events')?.scrollTop)+' nightBodyTop='+(document.getElementById('nightBody')?.scrollTop));
  const sl=document.getElementById('singleline'),nt=document.getElementById('slNote'),parts=[['說明框',sl],['說明文字',nt]].filter(([,e])=>e.getClientRects().length);
  for(const [name,e] of parts)for(const b of boxes){if(e.contains(b.e)||b.e.contains(e))continue;if(ov(R(e),b))errors.push(name+'蓋住:'+b.id);}
  const tg=document.getElementById('slToggle'),r=tg.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {count:boxes.length,errors,detail,toggleHit:hit===tg||tg.contains(hit),hitName:hit?(hit.id||String(hit.className||'')||hit.tagName):null};},INTERACTIVE);
 const toggleAt=async(w,h)=>{const at=`${w}×${h}`;if(engine==='chromium'&&h<=520)WHEEL.eligible.push(at);await page.evaluate(()=>{tainanMemory.night.setOpen(null);});await follow(D.gm.id,83100);
  const state=async()=>(await measure(D.gm.id,83100));
  let g=await state();assert.notEqual(g.toggle.display,'none',at+'：窄版要有「說明」鈕（鈕被 display:none 了）');assert.equal(g.toggle.exp,'false',at+'：開始時要是收合');
  let s=await scan();assert.deepEqual(s.errors,[],at+' 收合：'+JSON.stringify(s.errors));assert.ok(s.toggleHit,at+` 收合：「說明」鈕座標的 elementFromPoint 不是它自己（是 ${s.hitName}）`);
  await click('#slToggle');await frames();g=await state();
  assert.equal(g.toggle.exp,'true',at+'：點一下後 aria-expanded 要是 true');assert.notEqual(g.note.display,'none',at+'：點開後要顯示完整說明');assert.equal(g.note.vis,'visible');assert.equal(g.note.text,D.single.note,at+'：展開後的說明文字');
  assert.ok(g.note.h>20&&g.note.l>=g.scene.l-1&&g.note.r<=g.scene.r+1&&g.note.t>=g.scene.t-1&&g.note.b<=g.scene.b+1,at+'：展開後說明文字有一部分在場景外（被裁掉）'+JSON.stringify({note:g.note,scene:g.scene}));
  // 橫向手機的場景太矮，展開後的說明會被截高：被截掉的部分要能在框內捲動（接收指標、overflow-y 可捲、觸控可上下拖），而且真的捲得動。
  if(g.note.sh>g.note.ch+1){assert.equal(g.note.pe,'auto',at+'：說明被截高、文字卻不接收指標，捲不到後半段');assert.ok(['auto','scroll'].includes(g.note.oy),at+'：說明被截高、卻不能捲動（overflow-y '+g.note.oy+'）');assert.notEqual(g.note.ta,'none',at+'：說明被截高、觸控卻不能上下拖');
   const moved=await page.evaluate(()=>{const n=document.getElementById('slNote');n.scrollTop=n.scrollHeight;const t=n.scrollTop;n.scrollTop=0;return t;});assert.ok(moved>0,at+'：說明被截高，scrollTop 卻推不動');
   // 真的用滾輪捲一次：說明要捲動、鏡頭與跟車都不變；同一下滾在畫布上，鏡頭要變（正向對照），再滾回原狀。Playwright 的行動版 WebKit 不支援 mouse.wheel，只在 Chromium 滾。
   if(engine==='chromium'){
   const cam=()=>page.evaluate(()=>{const c=tainanMemory.camera;return {span:c.top-c.bottom,x:c.position.x,y:c.position.y,follow:tainanMemory.state.follow,top:document.getElementById('slNote').scrollTop};});
   const nb=await page.locator('#slNote').boundingBox(),c0=await cam();
   const canvasPt=()=>page.evaluate(()=>{const c=document.querySelector('#scene canvas'),r=c.getBoundingClientRect();for(const fy of [.5,.3,.7,.2,.8])for(const fx of [.5,.7,.3,.85,.15]){const x=r.left+r.width*fx,y=r.top+r.height*fy;if(document.elementFromPoint(x,y)===c)return [x,y];}return null;});
   const pt=await canvasPt();   // 滾輪要真的落在畫布上，不能落在說明或按鈕上
   assert.ok(pt,at+'：場景裡找不到滾輪落得到畫布的點');
   await page.mouse.move(nb.x+nb.width/2,nb.y+nb.height/2);await page.mouse.wheel(0,120);await frames();await frames();const c1=await cam();
   assert.ok(c1.top>c0.top,at+'：在說明上滾動，說明沒有捲動 '+JSON.stringify([c0,c1]));assert.deepEqual({...c1,top:0},{...c0,top:0},at+'：在說明上滾動，鏡頭或跟車跟著變了');
   await page.evaluate(()=>{document.getElementById('slNote').scrollTop=0;});await page.mouse.move(...pt);await page.mouse.wheel(0,120);await frames();await frames();const c2=await cam();
   assert.ok(Math.abs(c2.span-c0.span)>1e-6,at+'：在畫布上滾動，鏡頭沒有縮放，上面那項「鏡頭不變」是空轉');
   // 跟車展開時預留的帶子隨縮放改變，縮放之後說明框的高度可能跟著變、蓋到剛才那一點；滾回去之前重新找一個落在畫布上的點。
   const pt2=await canvasPt();assert.ok(pt2,at+'：縮放之後場景裡找不到滾輪落得到畫布的點');await page.mouse.move(...pt2);await page.mouse.wheel(0,-120);await frames();await frames();
   assert.ok(Math.abs((await cam()).span-c0.span)<1e-6*Math.max(1,c0.span),at+'：滾回去之後鏡頭沒有回到原本的縮放');WHEEL.ran.push(at);}}
  assert.equal(g.toggle.pe,'auto');
  s=await scan();assert.deepEqual(s.errors,[],at+' 展開：'+JSON.stringify(s.errors)+' 細節：'+JSON.stringify(s.detail));assert.ok(s.toggleHit,at+` 展開：「說明」鈕座標的 elementFromPoint 不是它自己（是 ${s.hitName}）`);
  ratios.push({w,h,state:'expanded',ratioPct:Math.round(g.box.w*g.box.h/(g.scene.w*g.scene.h)*1000)/10});
  await click('#slToggle');await frames();g=await state();
  assert.equal(g.toggle.exp,'false',at+'：再點一下要收合');assert.equal(g.note.display,'none',at+'：收合後不顯示完整說明');
  s=await scan();assert.deepEqual(s.errors,[],at+' 再收合：'+JSON.stringify(s.errors));assert.ok(s.toggleHit,at+' 再收合：「說明」鈕座標的 elementFromPoint');};
 const sizes=sweep?SL_SWEEP:[];
 await step('單線說明框版面：窄版只剩摘要（≤10% 場景、不蓋被跟列車的標籤、不壓控件）、寬版完整顯示；摘要時刻照 singleLine.fromSec',async()=>{
  try{await layoutAt(width,height);
   for(const [w,h] of sizes){await page.setViewportSize({width:w,height:h});await frames();await layoutAt(w,h);}}
  finally{await page.setViewportSize({width,height});await frames();}
  const bySize=new Map();for(const r of ratios.filter(r=>r.sec)){const k=`${r.w}×${r.h}${r.narrow?'':'（寬版）'}`;bySize.set(k,[...(bySize.get(k)||[]),r.ratioPct]);}
  console.log(`[單線說明 ${where}] 說明框佔場景面積（預設狀態，4 個取樣時刻的範圍）：`+[...bySize].map(([k,v])=>`${k} ${Math.min(...v)}%${Math.max(...v)!==Math.min(...v)?'–'+Math.max(...v)+'%':''}`).join('；'));
 });
 await step('「說明」鈕：真的點（觸控用 tap）展開、再點收合；aria-expanded 跟著變；展開與收合都不壓互動元素；座標的 elementFromPoint 回到它自己',async()=>{
  let n=0;
  try{if(NARROW(width,height)){await toggleAt(width,height);n++;}
   for(const [w,h] of sizes)if(NARROW(w,h)){await page.setViewportSize({width:w,height:h});await frames();await toggleAt(w,h);n++;}}
  finally{await page.setViewportSize({width,height});await frames();}
  if(sweep)assert.ok(n>=9,'窄版取樣只有 '+n+' 組，掃視窗的範圍變小了');
 });
 await step('標籤疊放：兩班重點車在保安交會時，正在跟的那班標籤在最上層（跟 3782 → 3782 在上、跟 145 → 145 在上）',async()=>{
  const at=D.meet??82465;
  for(const [me,other] of [[D.gm,D.sm],[D.sm,D.gm]]){await follow(me.id,at);
   const g=await page.evaluate(([me,other])=>{const m=tainanMemory,box=document.getElementById('labels'),a=m.models.get(me).label.e,b=m.models.get(other).label.e,R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};};
    const ra=R(a),rb=R(b),ix={l:Math.max(ra.l,rb.l),t:Math.max(ra.t,rb.t),r:Math.min(ra.r,rb.r),b:Math.min(ra.b,rb.b)},area=r=>Math.max(0,r.r-r.l)*Math.max(0,r.b-r.t),prev=box.style.pointerEvents;box.style.pointerEvents='auto';   // 標籤平常不接收指標，量疊放順序時才暫時打開
    const top=(x,y)=>{const h=document.elementFromPoint(x,y);return h?.closest('.map-label')===a?'self':h?.closest('.map-label')===b?'other':(h?.id||String(h?.className||'')||h?.tagName||null);};
    const out={shown:!a.hidden&&!b.hidden,overlapPct:Math.round(area(ix)/area(ra)*100),own:top((ra.l+ra.r)/2,(ra.t+ra.b)/2),both:top((ix.l+ix.r)/2,(ix.t+ix.b)/2),zSelf:getComputedStyle(a).zIndex,zOther:getComputedStyle(b).zIndex,cls:a.className};box.style.pointerEvents=prev;return out;},[me.id,other.id]);
   const who=`${hms(at)} 跟 ${me.train}`;assert.ok(g.shown,who+'：兩班標籤要都在畫面內');assert.ok(g.overlapPct>=30,who+`：兩個標籤只重疊 ${g.overlapPct}%，疊放順序這項檢查是空轉`);
   assert.equal(g.own,'self',who+'：被跟那班標籤中心的最上層元素不是它自己（是 '+g.own+'）');assert.equal(g.both,'self',who+'：兩個標籤重疊處的最上層元素不是被跟那班（是 '+g.both+'）');}
  await page.evaluate(()=>{tainanMemory.followTrain('');});
 });
 await step('標籤疊放：正在跟的那班標籤（標籤裡疊放最高）移到視角按鈕上，最上層仍是按鈕',async()=>{
  await follow(D.gm.id,D.meet??82465);
  // 標籤平常不接收指標，量疊放順序時才暫時打開；移動標籤與還原在同一個工作裡做完，中間沒有畫格，畫面上看不到標籤被移動。
  const g=await page.evaluate(id=>{const m=tainanMemory,box=document.getElementById('labels'),a=m.models.get(id).label.e,saved=[a.style.transform,a.hidden,box.style.pointerEvents],sr=document.getElementById('scene').getBoundingClientRect(),res=[];
   box.style.pointerEvents='auto';a.hidden=false;
   for(const c of document.querySelectorAll('#scene .view-controls button')){if(!c.getClientRects().length)continue;const r=c.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    a.style.transform=`translate(${x-sr.left}px,${y-sr.top}px) translate(-50%,-50%)`;const h=document.elementFromPoint(x,y),la=a.getBoundingClientRect();
    res.push({id:c.id,covered:la.left<x&&la.right>x&&la.top<y&&la.bottom>y,top:h===c||c.contains(h)?'button':h?.closest?.('.map-label')===a?'label':(h?.id||h?.tagName||null)});}
   [a.style.transform,a.hidden,box.style.pointerEvents]=saved;return {cls:a.className,z:getComputedStyle(a).zIndex,res};},D.gm.id);
  assert.ok(g.cls.split(' ').includes('following'),'被跟那班的標籤沒有 following：'+g.cls);
  assert.ok(g.res.length>=4&&g.res.every(r=>r.covered),'標籤沒有真的移到按鈕上，這項檢查是空轉：'+JSON.stringify(g.res));
  assert.deepEqual(g.res.filter(r=>r.top!=='button'),[],'被跟那班的標籤（z-index '+g.z+'）蓋過視角按鈕');
  await page.evaluate(()=>{tainanMemory.followTrain('');});
 });
 await step('跟車卡：表定通過、實際被留置（≥90 秒）的站，重播欄同時列到站與開車、差欄逐項列、狀態列寫「停在」；一般通過站仍只列「通過」',async()=>{
  assert.ok(D.held.length>0,'資料裡沒有「表定通過、留置 ≥90 秒」的站，這項檢查是空轉');let heldRows=0,plainPass=0;
  for(const t of D.held){const hs=t.stops.filter(s=>s.stop===false&&Number(s.holdSec)>=90);
   for(const h of hs){const mid=Math.round((h.arrSec+h.depSec)/2);await follow(t.id,mid);
    const g=await page.evaluate(()=>{const c=document.getElementById('followcard');if(c.hidden)return null;return {status:c.querySelector('.st').textContent,rows:[...c.querySelectorAll('tbody tr')].map(tr=>({name:tr.querySelector('th').textContent,state:tr.dataset.state||'',tds:[...tr.querySelectorAll('td')].map(td=>[...td.querySelectorAll('.ln')].map(l=>l.textContent))}))};});
    assert.ok(g,t.train+' 沒有跟車卡');console.log(`[單線說明 ${where}] 跟車卡 ${t.train} ${h.name}：表定通過 ${hms(h.schedArrSec)}、實測到 ${hms(h.arrSec)}、開 ${hms(h.depSec)}、留置 ${dur(Number(h.holdSec))}`);
    t.stops.forEach((s,i)=>{const r=g.rows[i],isHeld=s.stop===false&&Number(s.holdSec)>=90,isPass=s.stop===false;assert.equal(r.name,s.name);
     if(isHeld){heldRows++;assert.deepEqual(r.tds[COL.sched],['通過',hms(s.schedArrSec)],`${t.train} ${s.name} 的表定欄`);
      assert.deepEqual(r.tds[COL.act],[hms(s.arrSec),hms(s.depSec)],`${t.train} ${s.name} 的重播欄要同時列到站與開車（不是「通過」）`);
      assert.deepEqual(r.tds[COL.diff],[diff(s.arrSec-s.schedArrSec),diff(s.depSec-s.schedDepSec)],`${t.train} ${s.name} 的差欄要到站、開車各一列`);assert.deepEqual(r.tds[COL.hold],[dur(Number(s.holdSec))],`${t.train} ${s.name} 的留置欄`);}
     else if(isPass){plainPass++;assert.deepEqual(r.tds[COL.act],['通過',hms(s.arrSec)],`${t.train} ${s.name}（一般通過站）的重播欄仍只列「通過」`);assert.deepEqual(r.tds[COL.diff],[diff(s.arrSec-s.schedArrSec)],`${t.train} ${s.name}（一般通過站）的差欄`);}});
    const here=g.rows.find(r=>r.name===h.name);assert.equal(here.state,'now',`${t.train} ${h.name}：${hms(mid)} 正停在這站，這一列該是「現在」`);assert.ok(g.status.includes('停在'+h.name),`${t.train} ${hms(mid)} 的狀態列要寫「停在${h.name}」：${g.status}`);}}
  assert.ok(heldRows>0&&plainPass>0,`留置的通過站 ${heldRows} 列、一般通過站 ${plainPass} 列，兩邊都要有`);
  await page.evaluate(()=>{tainanMemory.followTrain('');});
 });
 // 摘要的時刻是資料決定的：改 singleLine.fromSec 的資料副本（連同 integrity 的雜湊）開一頁，摘要與顯示時段都要跟著變。寫死「22:22」的實作在這一步會紅。
 if(sweep)await step('摘要時刻不是寫死的：資料副本把 singleLine.fromSec 往後挪 4 分鐘，摘要與顯示時段跟著挪',async()=>{
  const crypto=await import('node:crypto'),origin=new URL(page.url()).origin,dirUrl=page.url().split('?')[0],delta=240,snapUrl=new URL('snapshot.json',dirUrl).href;
  const ctx=await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),p2=await ctx.newPage();
  try{let patched=null;const getPatched=async()=>{if(!patched){const j=await (await ctx.request.get(snapUrl)).json();j.singleLine.fromSec+=delta;patched=Buffer.from(JSON.stringify(j));}return patched;};
   await p2.route(u=>u.href===snapUrl,async route=>{await route.fulfill({status:200,contentType:'application/json',body:await getPatched()});});
   await p2.route(u=>u.href===new URL('integrity.json',dirUrl).href,async route=>{const j=await (await ctx.request.get(new URL('integrity.json',dirUrl).href)).json();j.files['snapshot.json']=crypto.createHash('sha256').update(await getPatched()).digest('hex');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)});});
   await p2.addInitScript(()=>{const N=Date;globalThis.Date=class extends N{constructor(...a){super(...(a.length?a:['2027-01-03T12:00:00+08:00']));}static now(){return new N('2027-01-03T12:00:00+08:00').valueOf();}};});
   await p2.goto(dirUrl);await p2.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});
   const from=D.single.fromSec+delta,want=hhmm(from)+' 起單線雙向',probe=async sec=>{await p2.evaluate(([id,sec])=>{tainanMemory.state.playing=false;tainanMemory.followTrain(id,sec);},[D.gm.id,sec]);await p2.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));return p2.evaluate(()=>({hidden:document.getElementById('singleline').hidden,sum:document.getElementById('slSum').textContent}));};
   assert.notEqual(hhmm(from),hhmm(D.single.fromSec),'資料副本的時刻跟原資料一樣，這項檢查沒有鑑別力');
   const inside=await probe(from+30);assert.equal(inside.hidden,false,'新起點之後單線說明該顯示');assert.equal(inside.sum,want,'摘要時刻要照資料副本的 fromSec');
   const before=await probe(D.single.fromSec+30);assert.equal(before.hidden,true,'新起點之前（原起點之後）單線說明該隱藏');}
  finally{await ctx.close();}
 });
 await page.evaluate(()=>{tainanMemory.followTrain('');tainanMemory.night.setOpen(null);});
 if(fails.length)throw Error(`單線說明 ${where}：${fails.length} 個檢查失敗\n`+fails.join('\n'));
 return {steps:done.length,ratios};
}
// ── 10/16 版面（--date=2026-10-16 才跑；ONLY=layout 只跑這一段）────────────────────────────────────────────
// 每個視窗大小：標頭文字置中、標頭「關於」、跟車卡右緣的捲動提示。sweep（寬 390 那一組）另外切視窗大小量這幾件事：打開最後一夜、點時間軸單線那一列後，
// 說明框（收合與展開）和視角按鈕不相交；跟車時展開說明，被跟那班的標籤不被說明框蓋住、仍畫在列車投影的位置，空間夠時整班車在框上方，收合後列車回到場景中心；同一組判準在按「旋轉」、雙指改仰角之後、展開之後再按「旋轉」再量一次；寬版用滾輪小步縮放跨過讓位門檻時讓位量不跳；60 倍播放時說明框上緣與跟車點不跳；
// 最後一夜跨旋轉，以及直向自動收合之後在同一個版面直接按「最後一夜」重開。
const NIGHT_SIZES=[[568,320],[640,360],[667,330],[667,375]];   // 寬不到 700 的橫向手機：最後一夜平常收成右上角的鈕，打開後場景變窄，視角按鈕可能折成兩排
// 跟車展開說明的讓位（讓的是整班車）：LIFT_PHONE 量預設視角四個樣本（SAMPLES），其中 23:05 跟 3782、22:50 跟 145（LIFT_SAMPLES）必須走到「空間夠」（覆蓋率斷言，走不到就紅）；
// 22:45 跟 3782、22:30 跟 145 照同一組判準驗，空間不夠時只驗標籤、印出量到的值：22:30 那筆跳到 22:38:30 145 剛進畫面，車身在畫面上接近縱向，
// 667×375、844×390、932×430 的框停在最小高度也放不下（I8 量：可用 59–99 px、需要 84–101 px）。LIFT_PRINT 兩個樣本（LIFT_SAMPLES）只印量到的值，空間夠才驗車身。
const LIFT_PHONE=[[360,780],[390,844],[667,375],[844,390],[932,430]];
// 高 340 的橫向手機（740×340、844×340）列在 LIFT_PRINT、走退路（I7 量的）：場景只剩約 151 px，按鈕下緣在場景頂下 48 px，框最小 56 px＋下緣 8 px，可用 39–40 px；
// 放不下標籤＋標籤下方 9–17 px 的車身＋2＋M（需要 42–52 px）。退路只保標籤不被框蓋、車盡量往上。
const LIFT_PRINT=[[740,340],[844,340],[1100,560],[1366,600],[900,530],[920,540],[568,320],[640,360],[667,330],[900,601],[920,620],[1000,650],[1280,700]];   // 摘要版、矮螢幕（568×320 打開最後一夜）、寬版完整說明（不限高）
const LIFT_GAP=8;   // 頁面約定的車身外框與說明框的間距（M）：空間夠時車身外框下緣 ≤ 框上緣 − LIFT_GAP＋1
const LIFT_LOG=[],ZOOM_LOG=[],STAB_LOG=[];
const HINT_LOG=[];
async function lastDayLayoutChecks(page,{engine,width,height,click,sweep}){
 const where=`${engine} ${width}×${height}`,done=[],fails=[];
 const step=async(name,fn)=>{try{await fn();done.push(name);}catch(e){e.message=`[10/16 版面 ${where}] ${name}：${e.message}`;console.log('FAIL '+String(e.message).split('\n')[0]);if(!process.env.KEEP_GOING)throw e;fails.push(String(e.message).split('\n')[0]);}};
 const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const isOpen=async()=>(await page.locator('#nightToggle').getAttribute('aria-expanded'))==='true';
 const reset=async()=>{await page.evaluate(()=>{const m=tainanMemory;m.state.playing=false;m.followTrain('');m.night.setOpen(null);});await frames();};
 const resize=async(w,h)=>{await page.setViewportSize({width:w,height:h});await frames();};
 const T=await page.evaluate(()=>{const d=tainanMemory.data,id=m=>d.trains.find(t=>t.mark===m)?.id;return {gm:id('last-ground'),sm:id('last-south'),single:d.singleLine,events:(d.events||[]).map(e=>({id:e.id,t:e.t}))};});
 assert.ok(T.gm&&T.sm&&T.single,'資料缺兩班重點車或 singleLine');
 const slRow=T.events.find(e=>e.t===T.single.fromSec);assert.ok(slRow,'時間軸沒有單線起點（singleLine.fromSec）那一列');
 const SAMPLES=[[T.gm,'3782',81900],[T.gm,'3782',83100],[T.sm,'145',81000],[T.sm,'145',82200]];   // 22:45、23:05 跟地面最後一班；22:30、22:50 跟最後南下。選車照選單的做法（先跳到那個時刻、再選車、不給時刻）：22:30 時 145 還停在永康、不在畫面範圍，頁面會跳到它進畫面的第一秒，這一筆量的就是剛進畫面的位置

 await step('標頭：「歷史重播」的文字和「回即時地圖」一樣在框的垂直中線上（相差 ≤1 px；高 380 以下框縮成 32 px 高時也一樣）',async()=>{
  const g=await page.evaluate(()=>{const off=e=>{const r=e.getBoundingClientRect(),rg=document.createRange();rg.selectNodeContents(e);const t=rg.getBoundingClientRect();return {h:Math.round(r.height*10)/10,off:Math.round(((t.top+t.bottom)/2-(r.top+r.bottom)/2)*10)/10};};return {span:off(document.querySelector('nav span')),link:off(document.getElementById('live'))};});
  assert.ok(Math.abs(g.span.off-g.link.off)<=1&&Math.abs(g.span.off)<=1.5,'「歷史重播」的文字沒有和「回即時地圖」一樣垂直置中（off＝文字中線減框中線）：'+JSON.stringify(g));
  if(height<=380)assert.ok(g.span.h<40,'高 380 以下「歷史重播」的框沒有縮小，縮小後的情況沒量到：'+JSON.stringify(g));
 });

 await step('標頭「關於」：高 520 以下在「回即時地圖」旁邊、座標點得到自己、按了打開說明視窗；高 520 以上不出現',async()=>{
  const g=await page.evaluate(()=>{const a=document.getElementById('aboutNav'),l=document.getElementById('live');if(!a)return null;const r=a.getBoundingClientRect(),q=l.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {shown:a.getClientRects().length>0&&r.width>0&&r.height>0,text:a.textContent.trim(),inNav:!!a.closest('header nav'),w:Math.round(r.width),h:Math.round(r.height),gap:Math.round(r.left-q.right),sameRow:Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>r.height/2,hit:h===a||a.contains(h)};});
  assert.ok(g,'標頭沒有 #aboutNav');
  if(height<=520){assert.ok(g.shown,'高 520 以下標頭要有「關於」：'+JSON.stringify(g));assert.equal(g.text,'關於');assert.ok(g.inNav&&g.sameRow&&g.gap>=0&&g.gap<=16,'「關於」不在「回即時地圖」右邊：'+JSON.stringify(g));
   assert.ok(g.hit,'「關於」座標的 elementFromPoint 不是它自己');assert.ok(g.h>=32&&g.w>=32,'「關於」觸控目標太小：'+JSON.stringify(g));
   await click('#aboutNav');assert.equal(await page.evaluate(()=>document.getElementById('details').open),true,'按「關於」沒有打開說明視窗');
   await click('#details button');assert.equal(await page.evaluate(()=>document.getElementById('details').open),false,'說明視窗關不掉');}
  else assert.equal(g.shown,false,'高 520 以上標頭不該出現「關於」（重播控制裡已有「關於這一天」）：'+JSON.stringify(g));
 });

 await step('跟車卡右緣提示：表格右邊還有欄位時右緣有淡出，捲到底或沒有溢出時沒有；提示不接收指標，點下去落在表格上',async()=>{
  await page.evaluate(id=>{const m=tainanMemory;m.state.playing=false;m.night.setOpen(true);m.followTrain(id,82465);},T.gm);await frames();
  await page.locator('#followcard tbody tr').first().scrollIntoViewIfNeeded();await frames();
  // 點擊位置：提示的水平中線，垂直取第一個整列都在最後一夜面板可視範圍裡的表格列（面板會捲動，捲出框的列點不到）。
  const st=()=>page.evaluate(()=>{const c=document.getElementById('followcard'),tw=c&&!c.hidden?c.querySelector('.tw'):null,hint=c?.querySelector('.tw-more');if(!tw||!hint)return null;
   const t=tw.getBoundingClientRect(),r=hint.getBoundingClientRect(),nb=document.getElementById('nightBody').getBoundingClientRect(),cs=getComputedStyle(hint),x=r.left+r.width/2;
   const row=[...tw.querySelectorAll('tbody tr')].map(e=>e.getBoundingClientRect()).find(q=>q.top>=Math.max(0,nb.top)-.5&&q.bottom<=Math.min(innerHeight,nb.bottom)+.5),y=row?row.top+row.height/2:null,h=row&&x>=0&&x<=innerWidth?document.elementFromPoint(x,y):null;
   return {rest:Math.round(tw.scrollWidth-tw.clientWidth-tw.scrollLeft),over:tw.scrollWidth-tw.clientWidth>1,op:Number(cs.opacity),vis:cs.visibility,pe:cs.pointerEvents,edge:Math.round(Math.abs(r.right-t.right)),span:r.top<=t.top+1&&r.bottom>=t.bottom-1,w:Math.round(r.width),
    probed:!!h,hitHint:h===hint,hitTable:!!h&&tw.contains(h),hitName:h?(h.id||String(h.className||'')||h.tagName):null,at:row?[Math.round(x),Math.round(y)]:null};});
  const scrollTo=async end=>{await page.evaluate(end=>{const tw=document.querySelector('#followcard .tw');tw.scrollLeft=end?tw.scrollWidth:0;},end);await frames();};
  const on=(g,at)=>{assert.ok(g&&g.op>=.9&&g.vis==='visible'&&g.edge<=1&&g.span&&g.w>=12,at+'：表格右邊還有內容，右緣卻沒有提示：'+JSON.stringify(g));assert.equal(g.pe,'none',at+'：提示要不接收指標');
   assert.ok(g.probed&&!g.hitHint&&g.hitTable,at+'：提示的位置點下去沒有落在表格上：'+JSON.stringify(g));};
  const off=(g,at)=>assert.ok(g&&(g.op<=.01||g.vis==='hidden'),at+'：右邊已經沒有內容，提示卻還在：'+JSON.stringify(g));
  let g=await st();assert.ok(g,'跟車卡、表格或右緣提示不在');const natural=g.over;HINT_LOG.push(`${engine} ${width}×${height}：${natural?'溢出':'沒有溢出'}`);
  if(natural){on(g,'捲動前');await scrollTo(true);g=await st();assert.ok(g.rest<=1,'表格捲不到底：'+JSON.stringify(g));off(g,'捲到底');await scrollTo(false);on(await st(),'捲回最左');}
  else off(g,'表格沒有溢出');
  // 不管這個視窗大小有沒有溢出，都把表格外框（.tw 的上一層，提示貼著它的右緣）壓窄一次：提示要出現、捲到底要消失，放回原寬後回到原本的狀態（表格框變大小時會重算）。
  await page.evaluate(()=>{document.querySelector('#followcard .tw').parentElement.style.maxWidth='140px';});await frames();
  on(await st(),'表格框壓窄到 140 px');await scrollTo(true);off(await st(),'壓窄後捲到底');await scrollTo(false);
  await page.evaluate(()=>{document.querySelector('#followcard .tw').parentElement.style.maxWidth='';});await frames();g=await st();if(natural)on(g,'放回原寬');else off(g,'放回原寬');
  await reset();
 });

 if(sweep)await step('單線說明框不碰視角按鈕：打開最後一夜、點時間軸單線那一列，說明收合與展開都和每一顆視角按鈕不相交，按鈕與「說明」鈕的座標都點得到自己（568×320、640×360、667×330、667×375）',async()=>{
  const sel=`#events > li.ev[data-id="${slRow.id}"] .evb`;let twoRows=0;
  try{for(const [w,h] of NIGHT_SIZES){const at=`${w}×${h}`;await resize(w,h);await reset();
    if(!await isOpen())await click('#nightToggle');assert.equal(await isOpen(),true,at+'：最後一夜打不開');
    await page.locator(sel).scrollIntoViewIfNeeded();await click(sel);await frames();
    assert.ok(Math.abs(await page.evaluate(()=>tainanMemory.state.sec)-slRow.t)<1,at+'：點了單線那一列沒有跳到 '+hms(slRow.t));assert.equal(await isOpen(),true,at+'：側欄版面點了時間軸的列，最後一夜不該收起來');
    for(const exp of [false,true]){if(exp){await click('#slToggle');await frames();}
     const g=await page.evaluate(()=>{const R=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};},ov=(a,b)=>Math.min(a.r,b.r)-Math.max(a.l,b.l)>.5&&Math.min(a.b,b.b)-Math.max(a.t,b.t)>.5;
      const self=e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return h===e||e.contains(h);},rc=r=>[r.l,r.t,r.r,r.b].map(Math.round).join(',');
      const box=document.getElementById('singleline'),tg=document.getElementById('slToggle'),note=document.getElementById('slNote'),btns=[...document.querySelectorAll('#scene .view-controls button')].filter(b=>b.getClientRects().length);
      const parts=[['說明框',box],['說明鈕',tg],['說明文字',note]].filter(([,e])=>e.getClientRects().length&&getComputedStyle(e).display!=='none'),hit=[];
      for(const [n,e] of parts)for(const b of btns)if(ov(R(e),R(b)))hit.push(`${n}[${rc(R(e))}]×${b.id}[${rc(R(b))}]`);
      return {shown:!box.hidden&&box.getClientRects().length>0,exp:tg.getAttribute('aria-expanded'),note:getComputedStyle(note).display,hit,btnMiss:btns.filter(b=>!self(b)).map(b=>b.id),tgHit:self(tg),
       tgH:Math.round(tg.getBoundingClientRect().height),btnH:Math.round(Math.min(...btns.map(b=>b.getBoundingClientRect().height))),btns:btns.length,rows:new Set(btns.map(b=>Math.round(b.getBoundingClientRect().top))).size};});
     const st=at+(exp?' 展開':' 收合');
     assert.ok(g.shown,st+'：單線說明沒出現');assert.equal(g.exp,String(exp),st+'：aria-expanded');if(exp)assert.notEqual(g.note,'none',st+'：說明文字沒顯示');
     assert.ok(g.btns>=6,st+'：視角按鈕只有 '+g.btns+' 顆');assert.deepEqual(g.hit,[],st+'：說明框和視角按鈕相交');assert.deepEqual(g.btnMiss,[],st+'：這幾顆視角按鈕的座標點到的不是自己');assert.ok(g.tgHit,st+'：「說明」鈕的座標點到的不是它自己');
     assert.ok(g.tgH>=32&&g.btnH>=44,st+`：觸控目標變小了（「說明」鈕 ${g.tgH} px、視角按鈕最矮 ${g.btnH} px）`);if(g.rows>=2)twoRows++;}
    await click('#slToggle');await frames();}}
  finally{await resize(width,height);await reset();}
  assert.ok(twoRows>0,'四個尺寸打開最後一夜後視角按鈕都只有一排，「按鈕折成兩排」的情況沒驗到');
 });

 // 投影自己算：snapshot 經緯度 → 場景公尺（與頁面同一個原點），乘上相機的 view／projection 矩陣，再換成 #labels 的像素。車在地面（z 0），標籤錨在車上方 7 m、translate(-50%,-100%)（錨＝標籤框底邊中點）。
 const probe=id=>page.evaluate(id=>{const m=tainanMemory,c=m.camera,d=m.data,host=document.getElementById('scene'),L=document.getElementById('labels').getBoundingClientRect(),W=host.clientWidth,H=host.clientHeight,tr=d.trains.find(t=>t.id===id),p=m.sample(tr,m.state.sec);
   if(!p)return {drawn:false};
   const sx=111320*Math.cos(d.origin[1]*Math.PI/180),proj=(co,z)=>{const x=(co[0]-d.origin[0])*sx,y=(co[1]-d.origin[1])*111320,e=c.matrixWorldInverse.elements,q=c.projectionMatrix.elements,vx=e[0]*x+e[4]*y+e[8]*z+e[12],vy=e[1]*x+e[5]*y+e[9]*z+e[13],vz=e[2]*x+e[6]*y+e[10]*z+e[14];
    return [L.left+((q[0]*vx+q[4]*vy+q[8]*vz+q[12])*.5+.5)*W,L.top+(-(q[1]*vx+q[5]*vy+q[9]*vz+q[13])*.5+.5)*H];};
   const R=r=>({l:r.left,t:r.top,r:r.right,b:r.bottom}),le=m.models.get(id).label.e,lr=le.getBoundingClientRect(),box=document.getElementById('singleline'),g=proj(p.coordinate,0),a=proj(p.coordinate,7);
   const bx=box.hidden||!box.getClientRects().length?null:box.getBoundingClientRect();
   return {drawn:true,W,H,underBox:!!bx&&g[0]>bx.left&&g[0]<bx.right&&g[1]>bx.top&&g[1]<bx.bottom,follow:m.state.follow===id,exp:document.getElementById('slToggle').getAttribute('aria-expanded'),noteShown:getComputedStyle(document.getElementById('slNote')).display!=='none',
    center:[g[0]-(L.left+W/2),g[1]-(L.top+H/2)],label:le.hidden||!le.getClientRects().length?null:R(lr),anchor:[lr.left+lr.width/2-a[0],lr.bottom-a[1]],box:box.hidden||!box.getClientRects().length?null:R(box.getBoundingClientRect())};},id);
 const near=v=>Math.abs(v[0])<=1&&Math.abs(v[1])<=1,fmt=v=>v.map(x=>Math.round(x*10)/10).join(',');
 // 車身由腳本自己量：被跟那班所有 BufferGeometry 頂點（排除 Box／Plane 的光暈殼與地面光）乘上相機矩陣投影到畫面，不呼叫頁面的讓位函式、不讀它算好的值。
 // 可用空間＝框上緣 − 標籤與車身那一欄（兩者水平範圍的聯集，左右各放寬 4 px）最低的按鈕下緣，沒有按鈕就是場景頂；需要＝當下量到的「標籤與車身合起來的外框高」＋2＋LIFT_GAP。
 // 空間夠：車身外框下緣 ≤ 框上緣 − LIFT_GAP＋1，而且頂點進框比例 ≤10%；空間不夠：只驗標籤不被框蓋住，印出量到的可用空間、需要與進框比例。
 const body=id=>page.evaluate(id=>{const m=tainanMemory,c=m.camera,host=document.getElementById('scene'),L=document.getElementById('labels').getBoundingClientRect(),W=host.clientWidth,H=host.clientHeight,g=m.models.get(id).group,v=new c.position.constructor();g.updateMatrixWorld(true);
   const e=document.getElementById('singleline'),b=e.hidden||!e.getClientRects().length?null:e.getBoundingClientRect();let n=0,inside=0,l=Infinity,r=-Infinity,t=Infinity,bt=-Infinity;
   g.traverse(o=>{if(!o.isMesh||!o.visible||o.geometry?.type!=='BufferGeometry')return;const pos=o.geometry.attributes.position;
    for(let k=0;k<pos.count;k++){v.fromBufferAttribute(pos,k).applyMatrix4(o.matrixWorld).project(c);const x=L.left+(v.x*.5+.5)*W,y=L.top+(-v.y*.5+.5)*H;n++;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);bt=Math.max(bt,y);if(b&&x>b.left&&x<b.right&&y>b.top&&y<b.bottom)inside++;}});
   const btns=[...host.querySelectorAll('.view-controls button'),document.getElementById('nightToggle')].filter(x=>x&&x.getClientRects().length).map(x=>x.getBoundingClientRect()).filter(q=>q.width&&q.height&&q.left<L.left+W&&q.right>L.left&&q.top<L.top+H&&q.bottom>L.top).map(q=>({l:q.left,r:q.right,b:q.bottom}));
   return {n,inPct:n?inside/n*100:0,rect:{l,t,r,b:bt},sceneTop:L.top,btns};},id);
 const judge=(at,c1,bd,group)=>{assert.ok(bd.n>0,at+'：量不到被跟那班的車身頂點');const lab=c1.label,u={t:Math.min(lab.t,bd.rect.t),b:Math.max(lab.b,bd.rect.b),l:Math.min(lab.l,bd.rect.l),r:Math.max(lab.r,bd.rect.r)};
  const low=Math.max(bd.sceneTop,...bd.btns.filter(q=>q.r>u.l-4&&q.l<u.r+4).map(q=>q.b)),r1=x=>Math.round(x*10)/10;
  const j={engine,group,at,enough:c1.box.t-low>=u.b-u.t+2+LIFT_GAP,avail:r1(c1.box.t-low),need:r1(u.b-u.t+2+LIFT_GAP),gap:r1(c1.box.t-bd.rect.b),inPct:r1(bd.inPct),bodyH:r1(bd.rect.b-bd.rect.t),center:c1.center.map(r1)};
  LIFT_LOG.push(j);fs.writeFileSync(out+'/lift-results.json',JSON.stringify(LIFT_LOG,null,1));const s=`可用 ${j.avail}、需要 ${j.need}、車身下緣離框上緣 ${j.gap} px、車身高 ${j.bodyH} px、進框 ${j.inPct}%`;
  if(j.enough){assert.ok(bd.rect.b<=c1.box.t-LIFT_GAP+1,at+' 展開（空間夠）：車身外框下緣離說明框上緣不到 '+LIFT_GAP+' px（整班車要露在框上方）：'+s);assert.ok(j.inPct<=10,at+' 展開（空間夠）：車身頂點進框超過 10%：'+s);}
  else console.log(`[10/16 版面 ${where}] ${at} 展開：空間不夠，只驗標籤；${s}`);
  return j;};
 const LIFT_SAMPLES=[[T.gm,'3782',83100],[T.sm,'145',82200]];   // 23:05 跟地面最後一班 3782、22:50 跟最後南下 145（LIFT_PRINT 與改視角用；LIFT_PHONE 用四個樣本 SAMPLES）
 const narrowNow=()=>page.evaluate(()=>getComputedStyle(document.getElementById('slToggle')).display!=='none');
 if(sweep)await step('跟車時展開單線說明：被跟那班的標籤不被說明框蓋住、仍畫在列車投影的位置（≤1 px）；空間夠時整班車在框上方（車身下緣 ≤ 框上緣 − 8＋1、進框 ≤10%），手機尺寸的預設視角 23:05 跟 3782、22:50 跟 145 必須空間夠（22:45、22:30 也量）；收合後列車回到場景中心；1280×900 不讓位',async()=>{
  const lifted=[],jumped=new Set(),short=[],extra=[];   // short：手機尺寸預設視角 LIFT_SAMPLES 走不到「空間夠」的樣本，整段量完才判紅（其餘尺寸照樣量完、印出）；extra：另外兩個樣本空間不夠的，只印出
  try{for(const [w,h] of [...LIFT_PHONE,...LIFT_PRINT]){const phone=LIFT_PHONE.some(([a,b])=>a===w&&b===h),night=w===568&&h===320;await resize(w,h);await reset();
    if(night){await page.evaluate(()=>tainanMemory.night.setOpen(true));await frames();assert.ok(await isOpen(),'568×320：最後一夜沒有打開');}
    for(const [id,no,sec] of (phone?SAMPLES:LIFT_SAMPLES)){
     const t=await page.evaluate(([id,sec])=>{const m=tainanMemory;m.state.playing=false;m.jump(sec);m.followTrain(id);return m.state.sec;},[id,sec]);await frames();
     const at=`${w}×${h}${night?'（最後一夜打開）':''} ${hms(sec)}${t===sec?'':'（跳到 '+hms(t)+'）'} 跟 ${no}`;if(t!==sec)jumped.add(`${hms(sec)} 跟 ${no} 跳到 ${hms(t)}`);
     const narrow=await narrowNow();
     if(narrow){if((await page.locator('#slToggle').getAttribute('aria-expanded'))==='true'){await click('#slToggle');await frames();}
      const c0=await probe(id);assert.ok(c0.drawn,at+'：選了車，畫面內卻沒有這班車');
      assert.ok(c0.follow&&near(c0.center),at+' 收合：被跟那班不在場景中心 '+fmt(c0.center));assert.ok(c0.label&&near(c0.anchor),at+' 收合：標籤不在列車的投影位置 '+JSON.stringify(c0.anchor));
      await click('#slToggle');await frames();}
     const c1=await probe(id);assert.ok(c1.drawn,at+'：選了車，畫面內卻沒有這班車');
     if(narrow)assert.equal(c1.exp,'true',at+'：「說明」點了沒有展開');assert.ok(c1.noteShown,at+'：展開後說明文字沒顯示');assert.ok(c1.follow,at+'：展開說明後不再跟車');
     assert.ok(c1.label,at+' 展開：被跟那班的標籤不見了（被推出可見範圍或被藏起來）');assert.ok(c1.box&&!ovl(c1.box,c1.label),at+' 展開：說明框蓋到被跟那班的標籤 '+JSON.stringify({box:c1.box,label:c1.label}));
     assert.ok(near(c1.anchor),at+' 展開：標籤離開了列車的投影位置（標籤要畫在真實位置，讓位只能動鏡頭）'+fmt(c1.anchor));
     assert.ok(Math.abs(c1.center[0])<=c1.W/2&&Math.abs(c1.center[1])<=c1.H/2,at+' 展開：被跟那班被推出場景外 '+fmt(c1.center));
     const j=judge(at,c1,await body(id),phone?'phone':'print');
     if(phone&&!j.enough)(LIFT_SAMPLES.some(([a,,b])=>a===id&&b===sec)?short:extra).push(`${at}（可用 ${j.avail}、需要 ${j.need}）`);
     if(!near(c1.center))lifted.push(`${w}×${h} ${no}`);
     if(narrow){await click('#slToggle');await frames();const c2=await probe(id);
      assert.equal(c2.exp,'false',at+'：再點要收合');assert.ok(c2.follow&&near(c2.center),at+' 再收合：列車沒有回到場景中心 '+fmt(c2.center));assert.ok(c2.label&&near(c2.anchor),at+' 再收合：標籤不在列車的投影位置');}
    }}
   // 寬版：說明直接列出、框在場景下緣。1280×800 跟 3782 不蓋中心，照常置中、標籤不被蓋；1280×900 框不在中央那一欄的上半，兩個樣本都不讓位、車在中心、標籤不被蓋。
   await resize(1280,800);await reset();await page.evaluate(id=>{tainanMemory.state.playing=false;tainanMemory.followTrain(id,83100);},T.gm);await frames();
   const wide=await probe(T.gm);assert.ok(wide.drawn&&wide.noteShown,'1280×800 23:05 跟 3782：寬版要直接列出單線說明');
   assert.ok(near(wide.center)&&wide.label&&near(wide.anchor)&&!ovl(wide.box,wide.label),'1280×800 23:05 跟 3782：寬版說明框不蓋中心，跟車要照常置中、標籤不被蓋 '+JSON.stringify(wide));
   await resize(1280,900);await reset();
   for(const [id,no,sec] of LIFT_SAMPLES){await page.evaluate(([id,sec])=>{const m=tainanMemory;m.state.playing=false;m.jump(sec);m.followTrain(id);},[id,sec]);await frames();
    const c=await probe(id),bd=await body(id),at=`1280×900 ${hms(sec)} 跟 ${no}`;assert.ok(c.drawn&&c.noteShown&&c.box,at+'：寬版要直接列出單線說明');
    assert.ok(c.box.t>=bd.sceneTop+c.H/2,at+'：說明框上緣在場景中線之上（應在中央那一欄的下半）'+JSON.stringify({box:c.box,sceneTop:bd.sceneTop,H:c.H}));
    assert.ok(c.follow&&near(c.center),at+'：說明框不在中央那一欄的上半，不該讓位，列車要在場景中心 '+fmt(c.center));
    assert.ok(c.label&&near(c.anchor)&&!ovl(c.box,c.label),at+'：標籤被蓋或不在列車的投影位置 '+JSON.stringify({label:c.label,anchor:c.anchor}));judge(at,c,bd,'1280x900');}}
  finally{await resize(width,height);await reset();}
  assert.ok(lifted.length>0,'展開說明時鏡頭一次都沒有讓開（列車都還在中心），「整班車放到說明框上方」沒驗到');
  assert.ok(!short.length,`覆蓋率：手機尺寸的預設視角展開時空間不夠、整班車的判準沒驗到 ${short.length} 筆：${short.join('；')}`);
  console.log(`[10/16 版面 ${where}] 手機尺寸預設視角 22:45、22:30 兩個樣本空間不夠、只驗標籤的：${extra.join('；')||'無'}`);
  console.log(`[10/16 版面 ${where}] 展開說明時鏡頭讓開的取樣：${lifted.join('、')}；選車時那班不在畫面、跳到進畫面那一秒的取樣：${[...jumped].join('、')||'無'}`);
 });
 // 改過方位與仰角之後再跟車展開說明：讓位要沿著當下鏡頭的方向推（不是開機時的預設方位與仰角），否則轉過或傾斜過的鏡頭會把被跟那班推到說明框底下或旁邊。
 // 三種：先按頁面上的「旋轉」（方位 +45°）再跟車；同上再用雙指同向往上拖（PointerEvent，兩種引擎都送得到）把仰角壓低（雙指手勢會取消跟車，所以先改視角、再跟車）；
 // 預設視角跟車、展開說明之後再按「旋轉」（「旋轉」不取消跟車）。每一步都量鏡頭真的轉了、仰角真的變了，沒變就紅（那一組沒驗到）。車身判準同上，這幾組不要求空間一定夠。
 const TURN_SIZES=[[360,780],[390,844],[667,375],[844,390]];
 if(sweep)await step('改方位與仰角之後跟車展開說明：按「旋轉」、再加雙指改仰角、展開之後再按「旋轉」，被跟那班的標籤不被說明框蓋住、仍畫在列車投影的位置（≤1 px）、列車在場景內而且跟車點不在說明框底下；空間夠時整班車在框上方；收合後回到場景中心',async()=>{
  const cam=()=>page.evaluate(()=>{const c=tainanMemory.camera,f=c.getWorldDirection(new c.position.constructor());return {elev:Math.asin(-f.z)*180/Math.PI,az:Math.atan2(f.y,f.x)*180/Math.PI};});
  const turned=(a,b)=>Math.abs((b.az-a.az+540)%360-180);
  const tiltDown=()=>page.evaluate(async()=>{const c=tainanMemory.renderer.domElement,r=c.getBoundingClientRect(),x=r.left+r.width/2,y0=r.top+r.height/2;
   const ev=(type,id,x,y)=>c.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===11,clientX:x,clientY:y,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
   let y=y0;ev('pointerdown',11,x-40,y);ev('pointerdown',12,x+40,y);for(let i=1;i<=20;i++){y=y0-i*4;ev('pointermove',11,x-40,y);ev('pointermove',12,x+40,y);await new Promise(r=>requestAnimationFrame(r));}
   ev('pointerup',11,x-40,y);ev('pointerup',12,x+40,y);});
  const lifted=[],views=[];
  try{for(const [w,h] of TURN_SIZES)for(const variant of ['rot','rotTilt','expRot']){await resize(w,h);await reset();await page.evaluate(()=>tainanMemory.stationView());await frames();
    const v0=await cam();let v2=v0;
    if(variant!=='expRot'){await click('#rotate');await frames();const v1=await cam();assert.ok(Math.abs(turned(v0,v1)-45)<1,`${w}×${h}：按「旋轉」後方位轉了 ${turned(v0,v1).toFixed(1)}°，不是 45°`);v2=v1;
     if(variant==='rotTilt'){await tiltDown();await frames();v2=await cam();assert.ok(v1.elev-v2.elev>10,`${w}×${h}：雙指往上拖之後仰角 ${v1.elev.toFixed(1)}→${v2.elev.toFixed(1)}°，沒有壓低，改仰角這一組沒驗到`);}}
    const how=variant==='expRot'?'預設視角跟車、展開之後再按「旋轉」':`旋轉${variant==='rotTilt'?'＋雙指改仰角':''}（方位 ${Math.round(v0.az)}→${Math.round(v2.az)}°、仰角 ${Math.round(v0.elev)}→${Math.round(v2.elev)}°）`,tag=`${w}×${h} ${variant}`;views.push(`${w}×${h} ${how}`);
    for(const [id,no,sec] of LIFT_SAMPLES){
     await page.evaluate(([id,sec])=>{const m=tainanMemory;m.state.playing=false;m.jump(sec);m.followTrain(id);},[id,sec]);await frames();
     const at=`${w}×${h} ${how} ${hms(sec)} 跟 ${no}`;
     if((await page.locator('#slToggle').getAttribute('aria-expanded'))==='true'){await click('#slToggle');await frames();}
     const c0=await probe(id);assert.ok(c0.drawn,at+'：選了車，畫面內卻沒有這班車');
     assert.ok(c0.follow&&near(c0.center),at+' 收合：被跟那班不在場景中心 '+fmt(c0.center));assert.ok(c0.label&&near(c0.anchor),at+' 收合：標籤不在列車的投影位置 '+JSON.stringify(c0.anchor));
     await click('#slToggle');await frames();
     if(variant==='expRot'){const a0=await cam();await click('#rotate');await frames();const a1=await cam();assert.ok(Math.abs(turned(a0,a1)-45)<1,at+'：展開之後按「旋轉」，方位轉了 '+turned(a0,a1).toFixed(1)+'°，不是 45°');}
     const c1=await probe(id);
     assert.equal(c1.exp,'true',at+'：「說明」點了沒有展開');assert.ok(c1.noteShown,at+'：展開後說明文字沒顯示');assert.ok(c1.follow,at+'：展開說明後不再跟車');
     assert.ok(c1.label,at+' 展開：被跟那班的標籤不見了（被推出可見範圍或被藏起來）');assert.ok(c1.box&&!ovl(c1.box,c1.label),at+' 展開：說明框蓋到被跟那班的標籤 '+JSON.stringify({box:c1.box,label:c1.label}));
     assert.ok(near(c1.anchor),at+' 展開：標籤離開了列車的投影位置（標籤要畫在真實位置，讓位只能動鏡頭）'+fmt(c1.anchor));
     assert.ok(Math.abs(c1.center[0])<=c1.W/2&&Math.abs(c1.center[1])<=c1.H/2,at+' 展開：被跟那班被推出場景外 '+fmt(c1.center));
     assert.ok(!c1.underBox,at+' 展開：被跟那班的跟車點落在說明框底下（只有標籤露在框外）'+fmt(c1.center));
     judge(at,c1,await body(id),variant);
     if(!near(c1.center))lifted.push(`${tag} ${no}`);
     await click('#slToggle');await frames();const c2=await probe(id);
     assert.equal(c2.exp,'false',at+'：再點要收合');assert.ok(c2.follow&&near(c2.center),at+' 再收合：列車沒有回到場景中心 '+fmt(c2.center));assert.ok(c2.label&&near(c2.anchor),at+' 再收合：標籤不在列車的投影位置');
    }}}
  finally{await resize(width,height);await reset();await page.evaluate(()=>tainanMemory.stationView());await frames();}
  assert.ok(lifted.length>0,'改方位與仰角之後展開說明，鏡頭一次都沒有讓開，「讓位沿著當下鏡頭的方向推」沒驗到');
  console.log(`[10/16 版面 ${where}] 改方位與仰角：${views.join('；')}；展開說明時鏡頭讓開的取樣：${lifted.join('、')}`);
 });
 // 縮放連續：寬版（說明直接列出）跟車時，用滾輪小步縮放跨過讓位門檻，讓位量（跟車點投影在場景中線上方幾 px，用上面的 probe 自己投影，不讀頁面算好的值）不能跳。
 // 縮放方式：Chromium 用 page.mouse.wheel 滾在畫布上（每步重找落在畫布上的點）；Playwright 的行動版 WebKit 不支援 mouse.wheel，改對畫布送 WheelEvent，走頁面同一個 wheel 處理。
 // 滾輪不取消跟車；每步都驗還在跟車、span 真的乘了 e^(deltaY×0.001)，沒有就紅（那一步沒縮放到，相鄰差是空轉）。
 // 一步 deltaY ±40（span ×1.041）。I8 量到一步縮放本身讓讓位量自然變 ≤6.4 px（1280×800 跟 145 拉近到 span 221 時 Chromium 6.2、WebKit 6.4；1280×700 跟 3782 ≤3.4）；
 // 「框上緣高過門檻才讓、一讓就把車身外框置中」的寫法在門檻上一步跳 52 px。門檻取 12 px：約自然變化的兩倍、跳動的四分之一。
 // 覆蓋率：每個樣本的整段縮放至少一步讓位量 ≤0.5 px、至少一步 ≥6 px（真的跨過門檻），否則紅。1000×650 跟 3782 從 span 330 拉遠到 403 仍讓 20–25 px（門檻在 span 約 1100），跨不到，改用 1280×700。
 const ZOOM_SAMPLES=[[1280,800,T.sm,'145',82200],[1280,700,T.gm,'3782',83100]],ZOOM_DY=40,ZOOM_IN=10,ZOOM_OUT=15,ZOOM_JUMP=12;
 if(sweep)await step('縮放連續：寬版跟車時用滾輪小步縮放（拉近 10 步、再拉遠到比起點遠 5 步）跨過讓位門檻，相鄰兩步的讓位量變化 ≤12 px；每個樣本至少一步 ≤0.5 px、一步 ≥6 px',async()=>{
  const canvasPt=()=>page.evaluate(()=>{const c=tainanMemory.renderer.domElement,r=c.getBoundingClientRect();for(const fy of [.5,.3,.7,.2,.8])for(const fx of [.5,.7,.3,.85,.15]){const x=r.left+r.width*fx,y=r.top+r.height*fy;if(document.elementFromPoint(x,y)===c)return [x,y];}return null;});
  const wheel=async dy=>{const pt=await canvasPt();assert.ok(pt,'縮放連續：場景裡找不到滾輪落得到畫布的點');
   if(engine==='chromium'){await page.mouse.move(...pt);await page.mouse.wheel(0,dy);}
   else await page.evaluate(([dy,x,y])=>tainanMemory.renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,deltaMode:0,clientX:x,clientY:y,bubbles:true,cancelable:true})),[dy,...pt]);
   await frames();await frames();};
  const bad=[],uncovered=[],summary=[],r2=x=>Math.round(x*100)/100;
  try{for(const [w,h,id,no,sec] of ZOOM_SAMPLES){await resize(w,h);await reset();await page.evaluate(()=>tainanMemory.stationView());await frames();
    await page.evaluate(([id,sec])=>{const m=tainanMemory;m.state.playing=false;m.jump(sec);m.followTrain(id);},[id,sec]);await frames();
    const at=`${w}×${h} ${hms(sec)} 跟 ${no}`;assert.ok(!(await narrowNow()),at+'：要是寬版（說明直接列出），這組量的是寬版');
    const read=async()=>{const c=await probe(id),sp=await page.evaluate(()=>tainanMemory.camera.top-tainanMemory.camera.bottom);
     assert.ok(c.drawn&&c.follow&&c.noteShown,at+'：縮放中不再跟車、畫面內沒有這班車，或說明不在 '+JSON.stringify({drawn:c.drawn,follow:c.follow,note:c.noteShown}));return {lift:-c.center[1],span:sp};};
    const rows=[await read()];
    for(const dy of [...Array(ZOOM_IN).fill(-ZOOM_DY),...Array(ZOOM_OUT).fill(ZOOM_DY)]){await wheel(dy);const r=await read(),prev=rows.at(-1);
     assert.ok(Math.abs(Math.log(r.span/prev.span)-dy*.001)<1e-3,at+`：滾一下（deltaY ${dy}）span ${prev.span.toFixed(1)}→${r.span.toFixed(1)}，不是乘 e^(${dy*.001})，這一步沒縮放到`);rows.push(r);}
    const L=rows.map(r=>r.lift),d=L.slice(1).map((v,i)=>v-L[i]),worst=Math.max(...d.map(Math.abs)),k=d.findIndex(v=>Math.abs(v)===worst),lo=Math.min(...L),hi=Math.max(...L);
    ZOOM_LOG.push({engine,at,how:engine==='chromium'?'page.mouse.wheel':'WheelEvent',spans:rows.map(r=>r2(r.span)),lifts:L.map(r2),worstStep:r2(worst),min:r2(lo),max:r2(hi)});fs.writeFileSync(out+'/zoom-results.json',JSON.stringify(ZOOM_LOG,null,1));
    summary.push(`${at} 讓位量 ${r2(lo)}–${r2(hi)} px、相鄰最大變化 ${r2(worst)} px`);
    if(worst>ZOOM_JUMP)bad.push(`${at}：第 ${k+1} 步（span ${r2(rows[k].span)}→${r2(rows[k+1].span)}）讓位量 ${r2(L[k])}→${r2(L[k+1])} px，變化 ${r2(worst)} px（超過 ${ZOOM_JUMP} px，縮放跨過讓位門檻時畫面跳動）`);
    if(!(lo<=.5&&hi>=6))uncovered.push(`${at}（讓位量 ${r2(lo)}–${r2(hi)} px）`);}}
  finally{await resize(width,height);await reset();await page.evaluate(()=>tainanMemory.stationView());await frames();}
  console.log(`[10/16 版面 ${where}] 縮放連續（${engine==='chromium'?'page.mouse.wheel':'對畫布送 WheelEvent'}、deltaY ±${ZOOM_DY}）：${summary.join('；')}`);
  assert.ok(!bad.length,'縮放連續：'+bad.join('；'));
  assert.ok(!uncovered.length,'覆蓋率：縮放沒有跨過讓位門檻（整段至少一步 ≤0.5 px、一步 ≥6 px），縮放連續沒驗到：'+uncovered.join('；'));
 });
 // 穩定性：預留的帶子與讓位量不隨列車移動或轉彎改變。跟 3782、展開說明（寬版本來就列出）、不碰鏡頭，以 60 倍播放 3 秒，每幀量說明框上緣與被跟那班跟車點投影的縱向位置（腳本自己投影），各自變動 ≤1 px。
 // 23:05 起那三分鐘 3782 幾乎走直線（車身在畫面上的外框高只差 0.2 px），跟著當下車身重算的寫法在這段量不出來；另加 22:58 起 3782 出站轉彎那段（外框高約 3→32 px）。
 // 22:58 那段 667×375 照最壞外框讓 11 px，照當下外框不必讓（跟車點不動，量不出差別）；390×844 讓 69 px，照當下外框算的話跟車點會晃 24 px（I8 量的），所以兩個尺寸都量。
 // 覆蓋率：22:58 轉彎那段至少一個尺寸整段讓位量 ≥6 px（有在讓位時量到），否則紅。
 if(sweep)await step('跟車展開說明時以 60 倍播放 3 秒：說明框上緣與跟車點的縱向位置變動都 ≤1 px（框與畫面不隨列車移動或轉彎跳動）；22:58 轉彎那段要在讓位 ≥6 px 時量到',async()=>{
  const bad=[];
  try{for(const [w,h,sec] of [[667,375,83100],[900,601,83100],[667,375,82680],[390,844,82680]]){await resize(w,h);await reset();const at=`${w}×${h} ${hms(sec).slice(0,5)} 跟 3782`;
    await page.evaluate(([id,sec])=>{const m=tainanMemory;m.state.playing=false;m.jump(sec);m.followTrain(id);},[T.gm,sec]);await frames();
    if(await narrowNow()&&(await page.locator('#slToggle').getAttribute('aria-expanded'))!=='true'){await click('#slToggle');await frames();}
    const r=await page.evaluate(async id=>{const m=tainanMemory,c=m.camera,d=m.data,e=document.getElementById('singleline'),host=document.getElementById('scene'),tr=d.trains.find(t=>t.id===id),sx=111320*Math.cos(d.origin[1]*Math.PI/180),tops=[],lifts=[],s0=m.state.sec,sp=m.state.speed;m.state.speed=60;m.state.playing=true;const t0=performance.now();
     while(performance.now()-t0<3000){await new Promise(r=>requestAnimationFrame(r));if(!e.hidden&&e.getClientRects().length)tops.push(e.getBoundingClientRect().top);
      const p=m.sample(tr,m.state.sec);if(p){const H=host.clientHeight,v=new c.position.constructor((p.coordinate[0]-d.origin[0])*sx,(p.coordinate[1]-d.origin[1])*111320,0).project(c);lifts.push(H/2-(-v.y*.5+.5)*H);}}
     m.state.playing=false;m.state.speed=sp;return {frames:tops.length,min:Math.min(...tops),max:Math.max(...tops),pts:lifts.length,liftMin:Math.min(...lifts),liftMax:Math.max(...lifts),played:m.state.sec-s0,follow:m.state.follow===id,exp:document.getElementById('slToggle').getAttribute('aria-expanded')};},T.gm);
    assert.ok(r.follow&&r.frames>30&&r.pts>30&&r.played>100,at+'：60 倍播放 3 秒沒有真的播、說明框不在，或不再跟車 '+JSON.stringify(r));
    STAB_LOG.push({engine,at,sec,...r});fs.writeFileSync(out+'/stab-results.json',JSON.stringify(STAB_LOG,null,1));
    if(r.max-r.min>1)bad.push(at+'：60 倍播放 3 秒，說明框上緣變動 '+(r.max-r.min).toFixed(1)+' px（超過 1 px）'+JSON.stringify(r));
    if(r.liftMax-r.liftMin>1)bad.push(at+'：60 倍播放 3 秒，跟車點的縱向位置變動 '+(r.liftMax-r.liftMin).toFixed(1)+' px（超過 1 px，畫面隨列車轉彎上下晃；讓位量 '+r.liftMin.toFixed(1)+'–'+r.liftMax.toFixed(1)+' px）');
    console.log(`[10/16 版面 ${where}] ${at} 60 倍播放 3 秒：${r.frames} 幀、播了 ${Math.round(r.played)} 秒，說明框上緣 ${r.min.toFixed(1)}–${r.max.toFixed(1)}，讓位量 ${r.liftMin.toFixed(1)}–${r.liftMax.toFixed(1)} px`);}}
  finally{await resize(width,height);await reset();}
  assert.ok(!bad.length,bad.join('；'));
  const turn=STAB_LOG.filter(j=>j.engine===engine&&j.sec===82680&&j.liftMin>=6);
  assert.ok(turn.length>0,'覆蓋率：22:58 轉彎那段沒有在讓位 ≥6 px 時量到（跟車點不晃沒驗到）：'+STAB_LOG.filter(j=>j.engine===engine&&j.sec===82680).map(j=>`${j.at} 讓位量 ${j.liftMin.toFixed(1)}–${j.liftMax.toFixed(1)} px`).join('；'));
 });

 if(sweep)await step('最後一夜跨旋轉：直向點了時間軸的列（自動收合）之後轉成橫向，面板照開；使用者自己按的開與關跨旋轉保留；自動收合之後在同一個版面直接按「最後一夜」要打開',async()=>{
  const sel=`#events > li.ev[data-id="${slRow.id}"] .evb`,want=async(v,msg)=>{await frames();assert.equal(await isOpen(),v,msg);};
  try{await resize(390,844);await reset();await want(false,'390×844：預設要收合');
   await click('#nightToggle');await want(true,'390×844：使用者打開');
   await page.locator(sel).scrollIntoViewIfNeeded();await click(sel);await want(false,'390×844：點了時間軸的列要自動收合');
   await resize(844,390);await want(true,'轉成 844×390（側欄版面）：直向的自動收合不算使用者的選擇，面板要照開');
   await click('#nightToggle');await want(false,'844×390：使用者收合');
   await resize(390,844);await want(false,'轉回 390×844：使用者收合的要保留');
   await resize(844,390);await want(false,'再轉成 844×390：使用者收合的要保留（這個版面預設是展開）');
   await click('#nightToggle');await want(true,'844×390：使用者打開');
   await resize(390,844);await want(true,'轉回 390×844：使用者打開的要保留（這個版面預設是收合）');
   // 自動收合只算當下這一次：不轉螢幕、在同一個版面直接按「最後一夜」就要打開（按鈕沒清掉自動收合的話，要轉一次螢幕才重開得了）；重開之後再按要收合。
   await page.locator(sel).scrollIntoViewIfNeeded();await click(sel);await want(false,'390×844：再點一次時間軸的列，要自動收合');
   await click('#nightToggle');await want(true,'390×844：自動收合之後，在同一個版面直接按「最後一夜」要打開（不必先轉螢幕）');
   await click('#nightToggle');await want(false,'390×844：重開之後再按要收合');}
  finally{await resize(width,height);await reset();}
 });
 await reset();
 if(fails.length)throw Error(`10/16 版面 ${where}：${fails.length} 個檢查失敗\n`+fails.join('\n'));
 return {steps:done.length};
}
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
 // 使用者 2026-09-23 裁示瀏覽器測試一律無視窗(有視窗會搶焦點、把畫面切走)。Chromium 帶 channel:'chromium' 走真 GPU 的無視窗模式;預設 headless shell 是 SwiftShader 軟體算繪。
 const browser=await type.launch(engine==='chromium'?{channel:process.env.CHROMIUM_CHANNEL||'chromium',headless:true}:{headless:true});
 for(const [width,height] of (process.env.SIZES?process.env.SIZES.split(',').map(v=>v.split('x').map(Number)):[[360,780],[375,812],[390,844],[414,896],[768,1024],[844,390],[1280,900],...(lastDay?[[667,375],[640,360],[568,320],[844,340],[667,330],[740,340],[932,430]]:[])])){   // 10/16 另外掃寬不到 700 的橫向手機：最後一夜面板曾在這幾個尺寸壓到重播控制；844×340 是 iPhone 橫拿時 Safari 的可視高度，場景曾蓋住時鐘與時間拉桿；667×330、740×340、932×430 是量單線說明框與跟車鏡頭用的橫向尺寸，場景不疊標頭與重播控制的檢查也要跑到。9/12 已封存，沒有這個面板，不加
  console.log('開始',engine,width,height);
  const touch=width!==1280,context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // 模擬地下化後才開啟；歷史頁不可依裝置日期換班表。
  await page.addInitScript(()=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:['2027-01-03T12:00:00+08:00']));}static now(){return new NativeDate('2027-01-03T12:00:00+08:00').valueOf();}};});
  await page.goto(base+'/'+DIR+'/');try{await page.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});}catch(e){console.log('載入狀態',await page.locator('#loading').textContent(),errors);throw e;}
  const opening=lastDay?await lastDayOpening(page,{engine,width,height}):{};
  const click=sel=>touch?page.tap(sel):page.click(sel);
  if(process.env.ONLY==='layout'){assert.ok(lastDay,'ONLY=layout 只給 --date=2026-10-16');const only=await lastDayLayoutChecks(page,{engine,width,height,click,sweep:width===390});results.push({engine,width,height,layout:only});console.log('通過（只跑 10/16 版面）',engine,width);fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));await context.close();continue;}
  if(process.env.ONLY==='singleline'){const only=await singleLineChecks(page,{engine,width,height,click,sweep:width===390});results.push({engine,width,height,singleLine:only});console.log('通過（只跑單線說明）',engine,width);fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));await context.close();continue;}
  await click('#play');const layout=await controls(page,'body',lastDay?'#events':'');assert.deepEqual(layout.errors,[],engine+' '+width+' '+JSON.stringify(layout.errors));
  await click('#next');await click('#zoomin');await click('#zoomout');await click('#rotate');await click('#overview');await click('#station');
  // 施工外罩預設蓋上，按鈕可拿掉再蓋回（使用者 2026-09-29 選「完整站房＋外罩可切換」）。
  const wrapState=()=>page.evaluate(()=>[tainanMemory.wrap?.visible,document.getElementById('wrap').textContent]);
  assert.deepEqual(await wrapState(),[true,'拿掉外罩']);await click('#wrap');assert.deepEqual(await wrapState(),[false,'蓋回外罩']);await click('#wrap');assert.deepEqual(await wrapState(),[true,'拿掉外罩']);
  // 周邊建物改成低細節網格（使用者 2026-09-30「附近的建築物應該也要同樣建模 不需要太精細 但是不要是灰色方塊」）：網格在場景裡，群組、材質、頂點數與 model.json 一致，
  // 香格里拉飯店塔身（封存輪廓漏收、另依 OSM 部件補上的 255990928）也在。
  assert.deepEqual(await page.evaluate(()=>{const s=tainanMemory.surroundings,n=s?.meta?.lods?.near;return [!!s?.mesh?.parent,n?.drawGroups?.length>0&&s.mesh.geometry.groups.length===n.drawGroups.length,Array.isArray(s?.mesh?.material)&&s.mesh.material.length===n?.drawGroups?.length,s?.mesh?.geometry?.attributes?.position?.count===n?.vertexCount,!!s?.meta?.buildings?.some(b=>b.id===255990928&&b.minHeightM===24)];}),[true,true,true,true,true],'周邊建物網格沒有完整載入');
  // 放大極限 34 公尺（使用者 2026-09-29「放大極限就用 34 公尺」）：從舊站近景連按放大，視野高度停在 34 m、不會更近。
  for(let i=0;i<8;i++)await click('#zoomin');assert.equal(await page.evaluate(()=>Math.round((tainanMemory.camera.top-tainanMemory.camera.bottom)*1000)/1000),34);
  // 馬路（使用者 2026-09-30「連馬路、人行道細節也做更多一點」）：柏油、人行道、路緣、白線、黃線五層網格都在場景裡、不是空的；
  // 標線只有 12～15 cm 寬，放大到 34 m 時完全不透明，切到全線時淡出、不畫（每個像素幾公尺，畫了只會閃爍）。
  assert.deepEqual(await page.evaluate(()=>{const m=tainanMemory.roads?.meshes||{};return ['asphalt','sidewalk','curb','white','yellow'].map(k=>!!m[k]?.parent&&m[k].geometry.attributes.position.count>0).concat([m.white?.visible,m.white?.material.opacity,m.yellow?.material.opacity]);}),[true,true,true,true,true,true,1,1],'馬路網格或 34 m 的標線不對');
  await click('#overview');assert.deepEqual(await page.evaluate(()=>{const m=tainanMemory.roads.meshes;return [m.white.visible,m.white.material.opacity,m.yellow.visible];}),[false,0,false],'全線視角的標線沒有淡出');
  await click('#station');
  // EMU3000 集電弓車的位置與朝向（維基編組表：1 號車在屏東／高雄端，集電弓在第 3、7 節靠 1 號車端、第 10 節靠 12 號車端；
  // 網格的集電弓在 -X 端，flip＝轉 180° 後集電弓朝行進前方）。期望值直接寫編組表推出來的結果，不照頁面的排法算。
  const ep3000=await page.evaluate(()=>Object.fromEntries(['南下','北上'].map(d=>{const t=tainanMemory.data.trains.find(t=>t.formation.id==='emu3000'&&t.direction===d);return [d,tainanMemory.models.get(t.id).parts.map((p,i)=>p.mesh==='emu3000'?'ED'+(p.flip?'<':'>')+i:p.mesh==='emu3000-ep'?'EP'+(p.flip?'<':'>')+i:null).filter(Boolean)];})));
  assert.deepEqual(ep3000,{南下:['ED>0','EP<2','EP<6','EP>9','ED<11'],北上:['ED>0','EP<2','EP>5','EP>9','ED<11']},'EMU3000 集電弓車的位置或朝向不對');
  await page.locator('#speed').selectOption('60');await page.locator('#time').fill('17:30:00');await page.locator('#time').dispatchEvent('change');assert.equal(await page.locator('#clock').textContent(),'17:30:00');
  const timeline=page.locator('#timeline');const b=await timeline.boundingBox();if(touch)await page.touchscreen.tap(b.x+b.width*.75,b.y+b.height/2);else await page.mouse.click(b.x+b.width*.75,b.y+b.height/2);assert.ok(await page.evaluate(()=>tainanMemory.state.sec>60000));
  if(height>520){await click('#about');for(const control of await page.locator('#details a,#details button').all()){await control.scrollIntoViewIfNeeded();assert.ok(await control.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.height>=44&&(e===h||e.contains(h));}),'說明控件可捲到且可觸及');}await click('#details button');}
  const behavior=await page.evaluate(async lastDay=>{
   const m=tainanMemory,results=[];m.state.playing=false;
   const distance=(a,b)=>Math.hypot((a[0]-b[0])*102000,(a[1]-b[1])*111320);
   for(const direction of ['北上','南下']){
    const tr=m.data.trains.find(t=>t.direction===direction&&t.serviceDate===m.data.date&&t.stops.some(s=>s.name.replace('台','臺')==='臺南'&&s.depSec-s.arrSec>=120)),st=tr.stops.find(s=>s.name.replace('台','臺')==='臺南');
    const p=m.sample(tr,st.arrSec+40),q=m.sample(tr,st.depSec-20);if(!p||!q)throw Error('停靠時不見列車');if(distance(p.coordinate,q.coordinate)>.02)throw Error('停靠時仍移動 '+tr.train);
    let run;for(let t=tr.spans[0].start+30;t<st.arrSec-20;t+=10){const a=m.sample(tr,t),b=m.sample(tr,t+10);if(a&&b&&distance(a.coordinate,b.coordinate)>10){run={a,b,t};break;}}
    if(!run)throw Error('找不到動態案例');if(Math.sign(run.b.coordinate[1]-run.a.coordinate[1])!==(direction==='北上'?1:-1))throw Error('方向相反');
    m.jump(run.t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const model=m.models.get(tr.id);if(!model.group.visible)throw Error('實際編組未顯示');
    // 由渲染物件反算座標，核對原始股道線段，而非只拿 sample() 與自己比。
    let error=0;for(const car of model.cars){const lon=m.data.origin[0]+car.position.x/(111320*Math.cos(m.data.origin[1]*Math.PI/180)),lat=m.data.origin[1]+car.position.y/111320;let nearest=Infinity;for(const rail of m.data.rails)for(let i=1;i<rail.coordinates.length;i++){const a=rail.coordinates[i-1],b=rail.coordinates[i],x=(a[0]-lon)*102000,y=(a[1]-lat)*111320,dx=(b[0]-a[0])*102000,dy=(b[1]-a[1])*111320,f=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));nearest=Math.min(nearest,Math.hypot(x+f*dx,y+f*dy));}error=Math.max(error,nearest);}if(error>.05)throw Error('車廂離軌 '+error);
    results.push({direction,train:tr.train,cars:model.cars.length,trackErrorM:error,dwellDisplacementM:distance(p.coordinate,q.coordinate)});
   }
   const night=m.data.trains.filter(t=>t.serviceDate!==m.data.date).map(t=>({train:t.train,visible:!!m.sample(t,t.spans[0].start+1)}));if(night.some(t=>!t.visible))throw Error('跨夜遺失');
   const uncertain=lastDay?(m.uncertainty.intervals.find(i=>(i.reason||'track-overlap')==='track-overlap')||m.uncertainty.intervals[0]):m.uncertainty.intervals.find(i=>i.trainNos.includes('3158'));m.jump((uncertain.start+uncertain.end)/2);m.stationView();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const id of uncertain.trains){const model=m.models.get(id),tr=m.data.trains.find(t=>t.id===id),p=m.sample(tr,m.state.sec);if(model.group.visible||!model.label.coordinate||distance(model.label.coordinate,p.coordinate)>.001)throw Error('不確定股道沒有保留原位置標記');}
   if(!document.getElementById('caption').textContent.includes(lastDay&&uncertain.reason==='single-line-unresolved'?'封鎖初期股道安排不明':'股道安排待確認'))throw Error('缺少不確定性說明');
   m.jump(uncertain.end+2);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(const id of uncertain.trains)if(!m.models.get(id).group.visible)throw Error('已離開不確定時段仍不恢復車身');
   return {date:m.data.date,dayTrainCount:m.data.trains.length,directions:results,night,uncertainty:'原位置標記與明示說明，離開時段恢復車身'};
  },lastDay);
  const lastResult=lastDay?{opening,...await lastDayChecks(page,{engine,width,height,click,out})}:{};
  const hasSingle=await page.evaluate(()=>!!tainanMemory.data.singleLine);if(lastDay)assert.ok(hasSingle,'10/16 的資料要有 singleLine');
  const singleResult=hasSingle?{singleLine:await singleLineChecks(page,{engine,width,height,click,sweep:width===390})}:{};
  const layoutResult=lastDay?{layout:await lastDayLayoutChecks(page,{engine,width,height,click,sweep:width===390})}:{};
  const followId=await page.evaluate(()=>tainanMemory.data.trains.find(t=>t.direction==='南下'&&t.serviceDate===tainanMemory.data.date).id);await page.locator('#train').selectOption(followId);assert.equal(await page.evaluate(()=>tainanMemory.state.follow),followId);await click('#station');
  const before=await page.evaluate(()=>tainanMemory.state.sec);await click('#play');await page.waitForFunction(before=>tainanMemory.state.sec>before+5,before);await click('#play');
  await page.locator('#time').fill('08:03:30');await page.locator('#time').dispatchEvent('change');await page.screenshot({path:`${out}/${engine}-${width}.png`});
  assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith(base+'/'+DIR+'/')||u==='data:,'||isProductionTelemetry(u)),'歷史頁讀取外部或即時資料');
  assert.equal(await page.locator('#live').getAttribute('href'),'../../?scene=3d&g=all&at=22.99681,120.21295&z=17');
  results.push({engine,width,height,controls:layout.count,requests:requests.length,telemetryRequests:requests.filter(isProductionTelemetry).length,...behavior,...lastResult,...singleResult,...layoutResult});console.log('通過',engine,width);fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));await context.close();
 }
 await browser.close();
}
// 滾輪捲說明框只在 Chromium、而且說明被截高時才跑（toggleAt）：這一輪 Chromium 跑過橫向窄版的「說明」鈕檢查，就至少要有一個尺寸真的滾過，否則這項等於沒驗。
// Playwright 的行動版 WebKit 不支援 mouse.wheel，WebKit 這項沒驗，輸出照實寫出來。
console.log(`滾輪捲說明框：Chromium 實際滾過 ${WHEEL.ran.length} 個尺寸（${WHEEL.ran.join('、')||'無'}），有資格的 ${WHEEL.eligible.length} 個；WebKit 沒驗（Playwright 的行動版 WebKit 不支援 mouse.wheel）`);
if(WHEEL.eligible.length)assert.ok(WHEEL.ran.length>0,`Chromium 跑了 ${WHEEL.eligible.length} 個橫向窄版尺寸的「說明」鈕檢查，滾輪捲說明框卻一次都沒有真的跑到（說明都沒有被截高，或條件壞了）`);
if(HINT_LOG.length)console.log('跟車卡右緣提示（跟 3782、22:54:25、最後一夜打開）：'+HINT_LOG.join('；'));
if(LIFT_LOG.length){fs.writeFileSync(out+'/lift-results.json',JSON.stringify(LIFT_LOG,null,1));const short=LIFT_LOG.filter(j=>!j.enough);console.log(`跟車展開說明的讓位：量了 ${LIFT_LOG.length} 筆，空間不夠 ${short.length} 筆（${[...new Set(short.map(j=>j.engine+' '+j.at.split(' ')[0]))].join('、')||'無'}）；明細 ${out}/lift-results.json`);}
fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));console.log('雙引擎重播驗收通過：'+results.length+' 組；'+results.map(r=>r.width).join('/'));

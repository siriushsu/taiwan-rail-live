// 阿里山雲海＋螢火蟲驗收：六個判準——阿里山-雲海時段／阿里山-雲海位置／阿里山-雲海覆蓋／
// 阿里山-雲海飄動／阿里山-螢火蟲／阿里山-螢火蟲可見（後兩者是退件重做新增，見各自區塊註解）。
// 新腳本一律無視窗 channel:'chrome'（不像既有 verify_garage_alishan.mjs 沿用預設 headless）。
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const OUT='output/alishan-fx',URL=process.env.GARAGE_ALISHAN_URL||'http://127.0.0.1:5252/prototypes/garage-alishan/';
mkdirSync(OUT,{recursive:true});
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));}
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:1440,height:1000},isMobile:true,hasTouch:true});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(URL);
 await p.waitForFunction(()=>window.alishanPreview?.state.ready,null,{timeout:90000});
 // 預設 running=true，背景 rAF 會持續推進 time；本腳本全程做「同一瞬間」的跨呼叫比對，
 // 先暫停才不會被背景動畫偷偷推進時間污染比對（心得：曾經漏了這步，量到 87% 假陽性重疊）。
 await p.tap('#play');

 // ---------- 阿里山-雲海時段：day/night 不可見、sunset 可見且不透明度介於 0~1 之間 ----------
 const periodRows=[];
 for(const period of ['day','sunset','night']){
  await p.tap(`button[data-period="${period}"]`);await settle(p);
  await p.evaluate(()=>alishanPreview.setTime(20));
  const fx=await p.evaluate(()=>alishanPreview.state.fx);
  periodRows.push({period,cloudOpacity:fx.cloudOpacity,cloudVisible:fx.cloudVisible});
 }
 const day=periodRows.find(r=>r.period==='day'),sunset=periodRows.find(r=>r.period==='sunset'),night=periodRows.find(r=>r.period==='night');
 check('阿里山-雲海時段',
  day.cloudOpacity===0&&!day.cloudVisible&&sunset.cloudOpacity>0&&sunset.cloudOpacity<1&&sunset.cloudVisible&&night.cloudOpacity===0&&!night.cloudVisible,
  periodRows);

 // ---------- 阿里山-雲海位置：離軌淨空>半徑、雲底高於地面、跟車鏡頭下不擋列車（動態找全程最近點測）----------
 await p.tap('button[data-period="sunset"]');await settle(p);
 await p.evaluate(()=>alishanPreview.setTime(20));
 const clouds=await p.evaluate(()=>alishanPreview.state.fx.clouds);
 const clearanceOk=clouds.every(c=>c.railDist>c.radius+0.05);
 // 雲團扁平化重做後 radius 改指「水平半寬」，垂直半高另外存在 halfHeight——雲底＝wz-halfHeight，
 // 不能再用 radius（現在遠大於 halfHeight）當垂直量尺，否則會把「水平很寬」誤判成「垂直探到地下」。
 const groundOk=clouds.every(c=>c.wz-c.halfHeight>c.ground-0.05);
 const minClearance=Math.min(...clouds.map(c=>c.railDist-c.radius));

 // 動態找全程「列車離任一雲團中心最近」的時間點，而不是寫死一個時間——粗掃 journeyDuration，
 // 抓 minDistance 最小的那個時刻做遮擋測試，這樣改了雲的排布或路線之後判準仍然测的是真正的最壞情形。
 await p.tap('[data-view="train"]');await settle(p);
 const journeyDuration=await p.evaluate(()=>alishanPreview.state.journeyDuration);
 let worst={t:0,minD:Infinity};
 for(let t=0;t<journeyDuration;t+=journeyDuration/60){
  const r=await p.evaluate((tt)=>{alishanPreview.setTime(tt);const s=alishanPreview.state,tr=s.poses.find(c=>c.id==='dl38');let m=Infinity;for(const c of s.fx.clouds){const d=Math.hypot(c.wx-tr.x,c.wy-tr.y,c.wz-tr.z);if(d<m)m=d;}return m;},t);
  if(r<worst.minD)worst={t,minD:r};
 }
 await p.evaluate((t)=>alishanPreview.setTime(t),worst.t);await settle(p);
 const read=()=>p.evaluate(async()=>{const c=document.querySelector('#scene'),out=document.createElement('canvas');out.width=c.width;out.height=c.height;const ctx=out.getContext('2d'),im=new Image();im.src=c.toDataURL();await im.decode();ctx.drawImage(im,0,0);return [...ctx.getImageData(0,0,c.width,c.height).data];});
 await p.evaluate(()=>alishanPreview.cloudsVisible(false));await settle(p);
 const withoutClouds=await read();
 await p.evaluate(()=>alishanPreview.cloudsVisible(true));await settle(p);
 const withClouds=await read();
 const bounds=await p.evaluate(()=>alishanPreview.state.bounds);
 const canvasSize=await p.evaluate(()=>{const c=document.querySelector('#scene');return{w:c.width,h:c.height};});
 let globalChanged=0;for(let i=0;i<withoutClouds.length;i+=4)if(Math.abs(withoutClouds[i]-withClouds[i])+Math.abs(withoutClouds[i+1]-withClouds[i+1])+Math.abs(withoutClouds[i+2]-withClouds[i+2])>25)globalChanged++;
 const positiveControl=globalChanged>200; // 正對照：雲確實在畫面某處造成看得見的差異，不然下面的「沒擋到」毫無意義
 const carRatios=bounds.map(bd=>{let changed=0,count=0;for(let y=Math.max(0,Math.floor(bd.top));y<Math.min(canvasSize.h,bd.bottom);y++)for(let x=Math.max(0,Math.floor(bd.left));x<Math.min(canvasSize.w,bd.right);x++){const i=(y*canvasSize.w+x)*4;count++;if(Math.abs(withoutClouds[i]-withClouds[i])+Math.abs(withoutClouds[i+1]-withClouds[i+1])+Math.abs(withoutClouds[i+2]-withClouds[i+2])>25)changed++;}return count?1-changed/count:1;});
 const occlusionOk=carRatios.every(r=>r>=0.9);
 await p.evaluate(()=>alishanPreview.cloudsVisible(null));
 check('阿里山-雲海位置',clearanceOk&&groundOk&&positiveControl&&occlusionOk,
  {cloudCount:clouds.length,minClearance,groundOk,positiveControl,globalChanged,worstApproach:worst,carRatios});

 // ---------- 阿里山-雲海覆蓋：退件重做新增。板子外框依實際輪廓（沿用 skirt 那條 boundary
 // 多邊形）分 12 段，至少 8 段有雲（不是只塞在一個角落）；雲頂全部低於全路網最低軌道高度；
 // 每朵雲的高/寬比 ≤0.4（跟 Blender build 階段的 P7 自檢是兩層獨立防線，來源不同）----------
 await p.tap('button[data-period="sunset"]');await settle(p);
 await p.evaluate(()=>alishanPreview.setTime(20));
 const coverFx=await p.evaluate(()=>alishanPreview.state.fx);
 const segCovered=new Set(coverFx.clouds.map(c=>c.segment)).size;
 const topsBelowTrack=coverFx.clouds.every(c=>c.top<coverFx.minTrackZ);
 const ratioOk=Object.values(coverFx.cloudHeightWidthRatio).every(r=>r<=0.4+1e-6);
 check('阿里山-雲海覆蓋',
  segCovered>=8&&topsBelowTrack&&ratioOk,
  {segments:coverFx.segments,segCovered,minTrackZ:coverFx.minTrackZ,maxTop:Math.max(...coverFx.clouds.map(c=>c.top)),cloudHeightWidthRatio:coverFx.cloudHeightWidthRatio,cloudCount:coverFx.clouds.length});

 // ---------- 阿里山-雲海飄動：兩個時間點位置不同（有動），差異有界（不暴衝／不 pop）----------
 // 用 cloudsVisible(true) 強制開雲，不靠「哪個時段會自動顯示雲」來間接開啟——飄動跟時段判斷是
 // 兩件事，強制開關讓這個判準不會被「時段判斷」的突變連坐拖垮，也不依賴前一個判準留下的畫面狀態，
 // 只單獨測「雲一旦可見，位置會不會隨時間動」。
 await p.tap('[data-view="world"]');await p.evaluate(()=>alishanPreview.cloudsVisible(true));await settle(p);
 // dt 取 15 秒（不是隨手挑短間隔）：最慢的漂移頻率 0.05 rad/s，若某雲團取樣當下恰好在正弦波峰
 // 附近（該點導數趨近 0），太短的 dt 量到的位移會被這個「暫時卡住」的假象蓋過去，不是真的没在動
 // ——放大 dt 讓相位變化量夠大，同時只要求九成雲團動了（容許極少數仍卡在波峰附近的個案），
 // 而不是要求全部 73 朵在同一個瞬間都測得到位移。
 const t1=await p.evaluate(()=>{alishanPreview.setTime(10);return alishanPreview.state.fx.clouds.map(c=>[c.wx,c.wy]);});
 const t2=await p.evaluate(()=>{alishanPreview.setTime(25);return alishanPreview.state.fx.clouds.map(c=>[c.wx,c.wy]);});
 await p.evaluate(()=>alishanPreview.cloudsVisible(null));
 const deltas=t1.map((p0,i)=>Math.hypot(p0[0]-t2[i][0],p0[1]-t2[i][1]));
 const drifted=deltas.filter(d=>d>0.01).length,noPop=deltas.every(d=>d<1.5);
 check('阿里山-雲海飄動',drifted>=deltas.length*0.9&&noPop,{count:deltas.length,drifted,maxDelta:Math.max(...deltas),minDelta:Math.min(...deltas)});

 // ---------- 阿里山-螢火蟲：僅夜晚可見、數量 60~120、高度落在 0.2~1.2、換算真實世界 0.3~2.5
 // 公尺（第四輪退回新增，用 main.js 傳進來的車模縮放比例換算，見 alishan.js 的 fx.setTrainScale）、
 // 個別會閃爍 ----------
 await p.tap('button[data-period="night"]');await settle(p);
 const b1=await p.evaluate(()=>{alishanPreview.setTime(10);return alishanPreview.state.fx.fireflyBrightness;});
 const b2=await p.evaluate(()=>{alishanPreview.setTime(10.3);return alishanPreview.state.fx.fireflyBrightness;});
 const fireState=await p.evaluate(()=>alishanPreview.state.fx);
 const heights=fireState.fireflyHeights,heightsM=fireState.fireflyHeightsM;
 const flickered=b1.filter((v,i)=>Math.abs(v-b2[i])>0.02).length;
 await p.tap('button[data-period="day"]');await settle(p);
 const dayFire=await p.evaluate(()=>alishanPreview.state.fx.fireflyVisible);
 const heightMOk=!!heightsM&&heightsM.every(h=>h>=0.3-1e-6&&h<=2.5+1e-6);
 check('阿里山-螢火蟲',
  fireState.fireflyVisible&&fireState.fireflyCount>=60&&fireState.fireflyCount<=120&&
  heights.every(h=>h>=0.2-1e-6&&h<=1.2+1e-6)&&heightMOk&&flickered>heights.length*0.2&&!dayFire,
  {count:fireState.fireflyCount,heightRange:[Math.min(...heights),Math.max(...heights)],
   heightRangeM:heightsM?[Math.min(...heightsM),Math.max(...heightsM)]:null,flickered,total:heights.length,dayFire});

 // ---------- 阿里山-螢火蟲-成群：2026-09-28 新增。退件「撒得太開像雜訊」——改成 4~6 個聚落，
 // 每個聚落要真的「聚」（成員彼此散佈半徑要遠小於全場尺度），不是隨機撒點事後硬貼標籤。
 // clusterId 是 alishan.js 建構時依插入順序給的分群編號，跟真正的空間分布是獨立資訊
 // （比對「編號相同」與「位置真的聚在一起」兩件事，才不會被「隨便分幾組」矇混過去）。
 const groupFx=await p.evaluate(()=>alishanPreview.state.fx);
 const clusterCount=groupFx.fireflyClusterCount;
 const byCluster=new Map();
 for(const pt of groupFx.fireflyPositions){if(!byCluster.has(pt.clusterId))byCluster.set(pt.clusterId,[]);byCluster.get(pt.clusterId).push(pt);}
 const clusterSpreads=[...byCluster.entries()].map(([id,pts])=>{const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;const spread=Math.max(...pts.map(p=>Math.hypot(p.x-cx,p.y-cy)));return{id,count:pts.length,spread};});
 // 展幅上限取 10 世界單位——全場板子外框約 70×46，聚落展幅遠小於此才算「聚」不是「散」。
 check('阿里山-螢火蟲-成群',clusterCount>=4&&clusterCount<=6&&clusterSpreads.length===clusterCount&&clusterSpreads.every(c=>c.spread<=10),
  {clusterCount,clusterSpreads});

 // ---------- 阿里山-螢火蟲-任何時刻60%在亮：2026-09-28 新增。退件「幾乎看不到」的根因是亮度
 // 公式有半週期恆為 0——這裡密集抽樣一整趟 journey 的時間點，每個時間點都要有 ≥60% 螢火蟲
 // brightness≥LIT_BRIGHTNESS，取所有樣本的「最小值」而非平均值，因為使用者會在任何一瞬間
 // 看畫面，不是看時間平均。40 個樣本涵蓋最短週期(2s)一輪以上，也涵蓋跨 120 隻獨立相位/週期
 // 可能出現的最壞瞬間。----------
 const LIT_BRIGHTNESS=0.25;
 const litSamples=[];
 for(let k=0;k<40;k++){const t=k*0.37;const br=await p.evaluate(tt=>{alishanPreview.setTime(tt);return alishanPreview.state.fx.fireflyBrightness;},t);const lit=br.filter(v=>v>=LIT_BRIGHTNESS).length;litSamples.push({t,fraction:lit/br.length});}
 const minFraction=Math.min(...litSamples.map(s=>s.fraction));
 check('阿里山-螢火蟲-任何時刻60%在亮',minFraction>=0.6,
  {minFraction,worstSample:litSamples.find(s=>s.fraction===minFraction),sampleCount:litSamples.length});

 // ---------- 阿里山-螢火蟲可見：第三輪新增、第四輪退回大幅擴充。退件原話：舊判準只有下限
 // （直徑≥4px），這是「協調端上次開條件的漏洞」——這輪同一份 on/off 逐像素 diff 資料一次量出
 // 五件事：可見數量（沿用既有 ≥12，只用下限篩「這算不算一隻螢火蟲」，不受尺寸上限影響，讓
 // 突變 1 能夠只弄紅尺寸上限）、外暈直徑上限（新增）、核心尺寸（新增）、柔邊度（新增，沿半徑
 // 取樣、必須單調遞減、75% 半徑處 ≤ 中心的 40%）、顏色（新增，G>R>B 且 B≤0.6G）。技術仍是
 // 「雲海位置」擋車判準同一招——關/開各拍一張同背景的畫面再逐像素 diff，不用顏色閾值掃描（上
 // 一輪踩過坑：閾值掃描把月台燈/車燈也掃成「螢火蟲」）。夜晚跟車鏡頭跟退件截圖 3-夜晚近景同一
 // 顆鏡頭：night+train+折返靜止點 t=86.15。----------
 await p.tap('button[data-period="night"]');await p.tap('[data-view="train"]');await settle(p);
 await p.evaluate(()=>alishanPreview.setTime(86.15));await settle(p);
 const fireCanvasSize=await p.evaluate(()=>{const c=document.querySelector('#scene');return{w:c.width,h:c.height};});
 const {w:fw,h:fh}=fireCanvasSize;
 // scanFireflies：同一套「on/off 逐像素 diff＋窗格內掃 peak/lit/剖面」邏輯抽成函式，因為
 // 2026-09-28 這輪要跑兩次獨立的 on/off——一次雙層（核心+外暈，量「可見/尺寸上限/顏色」，
 // 對應使用者實際看到的畫面）、一次只留核心（halo 強制關閉，量「核心/柔邊度」）。原因見下面
 // 大註解：外暈半徑變大時中心附近的加色貢獻也會變大，雙層一起量會讓「尺寸」突變連坐打紅
 // 「核心/柔邊度」，退件明講這次要解耦——結構上做到解耦的辦法就是量測時把兩層拆開，不是
 // 重新定義門檻。
 // litThreshold 保留可調參數（目前唯一呼叫點用預設值 30）：曾經試過「halo 關閉、只留核心」
 // 的第二次獨立掃描，需要比合併訊號更低的門檻才量得到，後來發現核心單獨只有 1~3px、
 // ring-sampling 在這種次像素尺度下不可靠，改回單一次合併掃描（見下方呼叫處的說明）；
 // 參數留著沒有壞處，不影響現在唯一的呼叫方式。
 function scanFireflies(onPixels,offPixels,projected,litThreshold=30){
  const intensityAt=(x,y)=>{if(x<0||y<0||x>=fw||y>=fh)return 0;const i=(y*fw+x)*4;return Math.abs(onPixels[i]-offPixels[i])+Math.abs(onPixels[i+1]-offPixels[i+1])+Math.abs(onPixels[i+2]-offPixels[i+2]);};
  // 螢火蟲整體只有個位數像素大小，剖面取樣點常落在半個像素之間——雙線性內插比 Math.round()
  // 準得多，不然「75% 半徑」這種次像素距離會被整數化誤差量到偏高（先前實測：round 版本量到
  // ratio75 一度衝到 0.41，換成雙線性後同一份渲染結果量到的是真正平滑曲線該有的低比例）。
  const intensityAtF=(x,y)=>{const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;return intensityAt(x0,y0)*(1-fx)*(1-fy)+intensityAt(x0+1,y0)*fx*(1-fy)+intensityAt(x0,y0+1)*(1-fx)*fy+intensityAt(x0+1,y0+1)*fx*fy;};
  const rgbDiffAt=(x,y)=>{if(x<0||y<0||x>=fw||y>=fh)return[0,0,0];const i=(y*fw+x)*4;return[Math.abs(onPixels[i]-offPixels[i]),Math.abs(onPixels[i+1]-offPixels[i+1]),Math.abs(onPixels[i+2]-offPixels[i+2])];};
  const LIT=litThreshold,R=12,detected=[];
  for(let idx=0;idx<projected.length;idx++){
   const cx=Math.round(projected[idx].x),cy=Math.round(projected[idx].y);
   if(cx<-R||cy<-R||cx>=fw+R||cy>=fh+R)continue;
   // 全窗格掃描一次，量出 peak（連同座標，投影中心可能有 ≤1px 取整誤差）與 lit 像素數，
   // 直徑/核心/剖面三個子判準共用同一份掃描結果，不用各自重複掃描。
   let peak=-1,peakX=cx,peakY=cy,lit=0;
   const vals=[];
   for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
    const v=intensityAt(cx+dx,cy+dy);vals.push(v);
    if(v>peak){peak=v;peakX=cx+dx;peakY=cy+dy;}
    if(v>LIT)lit++;
   }
   if(peak<=LIT||!lit)continue;
   const diameter=2*Math.sqrt(lit/Math.PI);
   // 核心＝比背景亮出來的部分裡落在「離峰值最近的上 25%」那段的區域（門檻取 75% 上檔，比第一版
   // 草稿的 60% 更保守，避免外暈萬一在突變 2 下變成大面積接近峰值的平台時被誤算進核心）。
   const coreThresh=LIT+(peak-LIT)*0.75;
   const coreLit=vals.filter(v=>v>coreThresh).length;
   const coreDiameter=coreLit?2*Math.sqrt(coreLit/Math.PI):0;
   // 柔邊度剖面：以偵測到的峰值座標為圓心（不是投影中心，兩者可能差 ≤1px），沿半徑 50%/75%/
   // 100%（100%＝偵測到的外暈半徑本身）各取 8 個方向平均，要求單調不遞增（容許 ±2 的取樣雜訊）
   // 且 75% 處的「高出背景的亮度」≤ 中心「高出背景的亮度」的 40%。背景＝0（on/off 兩張圖沒有
   // 螢火蟲時逐像素相同，diff 定義上就是 0，不需要另外量）。
   const ringAvgAt=rr=>{if(rr<0.4)return peak;let s=0;const n=8;for(let k=0;k<n;k++){const a=k/n*Math.PI*2;s+=intensityAtF(peakX+Math.cos(a)*rr,peakY+Math.sin(a)*rr);}return s/n;};
   const Rh=diameter/2,v50=ringAvgAt(Rh*.5),v75=ringAvgAt(Rh*.75),vEdge=ringAvgAt(Rh);
   const monotonic=peak>=v50-2&&v50>=v75-2&&v75>=vEdge-2;
   const ratio75=peak>0?v75/peak:1;
   const [dR,dG,dB]=rgbDiffAt(peakX,peakY);
   const colorOk=dG>dR&&dR>dB&&dB<=0.6*dG;
   detected.push({idx,x:cx,y:cy,peak:Math.round(peak),diameter:+diameter.toFixed(2),coreDiameter:+coreDiameter.toFixed(2),
    monotonic,ratio75:+ratio75.toFixed(3),dR,dG,dB,colorOk});
  }
  return detected;
 }
 // 第一次 on/off：核心+外暈都在（一般狀態），量「可見/尺寸上限/顏色」——對應使用者實際看到的畫面。
 await p.evaluate(()=>alishanPreview.fireflyVisible(false));await settle(p);
 const fireOffPixels=await read();
 await p.evaluate(()=>alishanPreview.fireflyVisible(true));await settle(p);
 const fireOnPixels=await read();
 const fireflyPositions=await p.evaluate(()=>alishanPreview.state.fx.fireflyPositions);
 const projected=await p.evaluate(pts=>pts.map(pt=>alishanPreview.project([pt.x,pt.y,pt.z])),fireflyPositions);
 const detected=scanFireflies(fireOnPixels,fireOffPixels,projected);
 // 2026-09-28 最終設計（取代先前兩版都被突變測試推翻的做法）：突變3（放大 HALO_PX）證明「核心/
 // 柔邊度/顏色都量在核心+外暈合併畫面上」結構上量不乾淨——外暈變大時，合併訊號的峰值位置、
 // ring-sampling 剖面、被亮到的鄰近背景像素全部跟著變，四個判準（含尺寸上限）連坐一起紅。
 // 拆成三種各自結構解耦的量法：
 // 1) 可見／尺寸上限——維持在「核心+外暈」合併畫面上量：這兩個判準本來就該量「使用者實際看到
 //    的整團光暈多大」，外暈尺寸改變時這裡本來就應該有反應，不需要解耦。
 // 2) 核心／顏色——改成第二次獨立 on/off、halo 強制關閉（只留核心 sprite），見下方擷取區塊；
 //    halo 關閉時 HALO_PX 對這次擷取的畫面零貢獻，結構上不可能被外暈尺寸突變牽連。
 // 3) 柔邊度——改成直接讀 glowTex 自己的 alpha 剖面（texture-space，見 alishan.js 的
 //    sampleAlphaProfile／fx.state.glowAlphaProfile），完全不經過畫面像素，結構上不受任何
 //    on-screen 尺寸/mipmap/ACES 色調映射/背景疊色影響（也不再需要柔邊度的 90% 容忍度——
 //    這是單一貼圖的內在屬性，不是逐隻取樣，沒有「背景偶發遮蔽污染其中幾隻」這種問題）。
 const visibleFireflies=detected.filter(d=>d.diameter>=4);
 check('阿里山-螢火蟲可見',visibleFireflies.length>=12,
  {visibleCount:visibleFireflies.length,total:fireflyPositions.length,sample:visibleFireflies.slice(0,6).map(d=>({x:d.x,y:d.y,diameter:d.diameter}))});
 check('阿里山-螢火蟲可見-尺寸上限',visibleFireflies.length>0&&visibleFireflies.every(d=>d.diameter<=10+1e-6),
  {diameterRange:visibleFireflies.length?[Math.min(...visibleFireflies.map(d=>d.diameter)),Math.max(...visibleFireflies.map(d=>d.diameter))]:null});

 // 第二次 on/off：halo 強制關閉，只留核心——量「核心」與「顏色」，結構上不受 HALO_PX 影響。
 // litThreshold 用 10 而非預設 30：核心單獨的訊號峰值遠低於「核心+外暈」合併訊號的峰值（探針
 // probe_core_only_intensity.mjs 量過：200 個遠離任何螢火蟲的隨機點 on/off 恆等，雜訊地板=0；
 // 錨定群核心峰值都遠高於地板），10 在兩者之間留了足夠邊際。這裡只讀 diameter（lit 像素計數，
 // 不涉及次像素 ring-sampling），核心單獨尺度雖小但「數有幾個像素比門檻亮」不像「沿半徑取樣算
 // 比例」那樣在次像素尺度下失真——先前踩的坑是把柔邊度也塞進這次獨立擷取才出問題，見上面。
 await p.evaluate(()=>alishanPreview.fireflyHalo(false));await settle(p);
 await p.evaluate(()=>alishanPreview.fireflyVisible(false));await settle(p);
 const coreOffPixels=await read();
 await p.evaluate(()=>alishanPreview.fireflyVisible(true));await settle(p);
 const coreOnPixels=await read();
 await p.evaluate(()=>{alishanPreview.fireflyVisible(null);alishanPreview.fireflyHalo(null);});await settle(p);
 const coreDetected=scanFireflies(coreOnPixels,coreOffPixels,projected,10);
 check('阿里山-螢火蟲可見-核心',coreDetected.length>0&&coreDetected.every(d=>d.diameter<=3+1e-6),
  {coreCount:coreDetected.length,diameterRange:coreDetected.length?[Math.min(...coreDetected.map(d=>d.diameter)),Math.max(...coreDetected.map(d=>d.diameter))]:null});
 // 第三次 on/off：halo 仍關閉、另外把 tone mapping 也關掉——專門量「顏色」。實測發現核心單獨
 // 的訊號振幅很小（peak 總和量級十幾），ACES 色調映射對composited 畫面做非線性壓縮，訊號越小這個
 // 非線性把材質本來 G≫R>B 的比例壓到 R≈G 甚至打平（探針 probe_color_coreonly.mjs：idx 45/51/72
 // 量到 d[R,G,B]=[4,4,3]／[5,5,2]，dG 沒有大於 dR，passRate 只有 0.875，低於 90% 門檻——這不是
 // 背景污染，是量測方法本身在小訊號下失真）。關掉 tone mapping 後 on/off 差值回到線性可加，
 // 材質自己的顏色比例才量得乾淨（探針 probe_color_notonemap.mjs：同一批樣本 22/22 全過，
 // 原本打平的 idx 45/51 訊號太弱被自然排除在偵測之外，不是被勉強量成合格）。
 await p.evaluate(()=>{alishanPreview.fireflyHalo(false);alishanPreview.setToneMapping(false);alishanPreview.fireflyVisible(false);});await settle(p);
 const colorOffPixels=await read();
 await p.evaluate(()=>alishanPreview.fireflyVisible(true));await settle(p);
 const colorOnPixels=await read();
 await p.evaluate(()=>{alishanPreview.fireflyVisible(null);alishanPreview.fireflyHalo(null);alishanPreview.setToneMapping(true);});await settle(p);
 const colorDetected=scanFireflies(colorOnPixels,colorOffPixels,projected,10);
 // ≥90% 通過而非「每一隻都要過」：跟「可見」同一個風格，容許極少數投影點疊在背景邊界上的
 // 偶發污染；若顏色 formula 本身真的壞了，失敗比例會遠超過 10%（下面突變測試會驗證這點）。
 const passRate=(arr,pred)=>arr.length?arr.filter(pred).length/arr.length:0;
 check('阿里山-螢火蟲可見-顏色',colorDetected.length>0&&passRate(colorDetected,d=>d.colorOk)>=0.9,
  {passRate:+passRate(colorDetected,d=>d.colorOk).toFixed(3),colorCount:colorDetected.length,
   sample:colorDetected.slice(0,4).map(d=>({dR:d.dR,dG:d.dG,dB:d.dB})),failIdx:colorDetected.filter(d=>!d.colorOk).map(d=>d.idx)});

 // 柔邊度：直接讀貼圖自己的 alpha 剖面（texture-space，非畫面像素）——見上面設計說明。
 // 半徑 0/25/50/75/90/100% 各自 16 方向平均（抵銷 64×64 網格的像素化雜訊），要求單調不遞增
 // （容許 ±2 的取樣雜訊，跟舊版 on-screen 判準的容差一致）且 75% 半徑處 ≤ 中心的 40%。
 const glowProfile=await p.evaluate(()=>alishanPreview.state.fx.glowAlphaProfile);
 const centerAlpha=glowProfile[0].alpha,atFrac=f=>glowProfile.find(s=>s.rFrac===f).alpha;
 const softMonotonic=glowProfile.every((s,i)=>i===0||s.alpha<=glowProfile[i-1].alpha+2);
 const softRatio75=centerAlpha>0?atFrac(.75)/centerAlpha:1;
 check('阿里山-螢火蟲可見-柔邊度',softMonotonic&&softRatio75<=0.4+1e-6,
  {profile:glowProfile,ratio75:+softRatio75.toFixed(4),monotonic:softMonotonic});

 check('無 JS 錯誤',errors.length===0,errors);
 await p.close();
}catch(e){check('驗證流程',false,e.stack);}finally{await b.close();}
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;

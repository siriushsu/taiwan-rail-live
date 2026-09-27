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
 await p.evaluate(()=>alishanPreview.fireflyVisible(false));await settle(p);
 const fireOffPixels=await read();
 await p.evaluate(()=>alishanPreview.fireflyVisible(true));await settle(p);
 const fireOnPixels=await read();
 const fireflyPositions=await p.evaluate(()=>alishanPreview.state.fx.fireflyPositions);
 const projected=await p.evaluate(pts=>pts.map(pt=>alishanPreview.project([pt.x,pt.y,pt.z])),fireflyPositions);
 await p.evaluate(()=>alishanPreview.fireflyVisible(null));
 const fireCanvasSize=await p.evaluate(()=>{const c=document.querySelector('#scene');return{w:c.width,h:c.height};});
 const {w:fw,h:fh}=fireCanvasSize;
 const intensityAt=(x,y)=>{if(x<0||y<0||x>=fw||y>=fh)return 0;const i=(y*fw+x)*4;return Math.abs(fireOnPixels[i]-fireOffPixels[i])+Math.abs(fireOnPixels[i+1]-fireOffPixels[i+1])+Math.abs(fireOnPixels[i+2]-fireOffPixels[i+2]);};
 // 螢火蟲整體只有個位數像素大小，剖面取樣點常落在半個像素之間——雙線性內插比 Math.round()
 // 準得多，不然「75% 半徑」這種次像素距離會被整數化誤差量到偏高（先前實測：round 版本量到
 // ratio75 一度衝到 0.41，換成雙線性後同一份渲染結果量到的是真正平滑曲線該有的低比例）。
 const intensityAtF=(x,y)=>{const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;return intensityAt(x0,y0)*(1-fx)*(1-fy)+intensityAt(x0+1,y0)*fx*(1-fy)+intensityAt(x0,y0+1)*(1-fx)*fy+intensityAt(x0+1,y0+1)*fx*fy;};
 const rgbDiffAt=(x,y)=>{if(x<0||y<0||x>=fw||y>=fh)return[0,0,0];const i=(y*fw+x)*4;return[Math.abs(fireOnPixels[i]-fireOffPixels[i]),Math.abs(fireOnPixels[i+1]-fireOffPixels[i+1]),Math.abs(fireOnPixels[i+2]-fireOffPixels[i+2])];};
 const LIT=30,R=12,detected=[];
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
  // 顏色：峰值像素本身 on/off 兩張圖的 R/G/B 各自差值（不是加總強度），量的是「這個光源本身的
  // 顏色」，不受場景背景色影響。
  const [dR,dG,dB]=rgbDiffAt(peakX,peakY);
  const colorOk=dG>dR&&dR>dB&&dB<=0.6*dG;
  detected.push({idx,x:cx,y:cy,diameter:+diameter.toFixed(2),coreDiameter:+coreDiameter.toFixed(2),
   monotonic,ratio75:+ratio75.toFixed(3),dR,dG,dB,colorOk});
 }
 // 「可見」＝既有下限 diameter≥4px（沿用第三輪定義，不受新的上限/核心/柔邊度/顏色門檻影響，
 // 讓突變 1（外暈放大成 20px）不會連坐拖垮這個數量判準——退件明講兩者要分開)。
 const visibleFireflies=detected.filter(d=>d.diameter>=4);
 check('阿里山-螢火蟲可見',visibleFireflies.length>=12,
  {visibleCount:visibleFireflies.length,total:fireflyPositions.length,sample:visibleFireflies.slice(0,6).map(d=>({x:d.x,y:d.y,diameter:d.diameter}))});
 check('阿里山-螢火蟲可見-尺寸上限',visibleFireflies.length>0&&visibleFireflies.every(d=>d.diameter<=10+1e-6),
  {diameterRange:visibleFireflies.length?[Math.min(...visibleFireflies.map(d=>d.diameter)),Math.max(...visibleFireflies.map(d=>d.diameter))]:null});
 check('阿里山-螢火蟲可見-核心',visibleFireflies.length>0&&visibleFireflies.every(d=>d.coreDiameter<=3+1e-6),
  {coreDiameterRange:visibleFireflies.length?[Math.min(...visibleFireflies.map(d=>d.coreDiameter)),Math.max(...visibleFireflies.map(d=>d.coreDiameter))]:null});
 check('阿里山-螢火蟲可見-柔邊度',visibleFireflies.length>0&&visibleFireflies.every(d=>d.monotonic&&d.ratio75<=0.4+1e-6),
  {ratio75Range:visibleFireflies.length?[Math.min(...visibleFireflies.map(d=>d.ratio75)),Math.max(...visibleFireflies.map(d=>d.ratio75))]:null,
   nonMonotonic:visibleFireflies.filter(d=>!d.monotonic).length});
 check('阿里山-螢火蟲可見-顏色',visibleFireflies.length>0&&visibleFireflies.every(d=>d.colorOk),
  {sample:visibleFireflies.slice(0,4).map(d=>({dR:d.dR,dG:d.dG,dB:d.dB})),failCount:visibleFireflies.filter(d=>!d.colorOk).length});

 check('無 JS 錯誤',errors.length===0,errors);
 await p.close();
}catch(e){check('驗證流程',false,e.stack);}finally{await b.close();}
writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;

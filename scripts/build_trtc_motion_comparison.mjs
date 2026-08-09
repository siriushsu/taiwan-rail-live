#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'CODEX-北捷運動-第二輪.json')));
const metroSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'CODEX-全捷運運動-驗收.json')));
const names = { baseline: '基準樹 86ebfb1', first: '第一輪 e3d4bac', second: '目前版全捷運梯形 v0805c' };
const modelKeys = { baseline: 'baseline_chromium', first: 'first_chromium', second: 'second_chromium' };
const models = Object.fromEntries(Object.entries(modelKeys).map(([name, key]) => [name, {
  label: names[name], curves: source.models[key].curves, captureFrames: source.models[key].captureFrames,
  accuracy: source.models[key].accuracy, saturation: source.models[key].saturation,
}]));
const metroEngine = name => {
  const cur = metroSource.models[`current_${name}`], mutation = metroSource.models.mutation_chromium;
  const bad = mutation.correction.filter(x => x.system === 'ntdlrt' && (x.line === 'V' || x.line === 'VB'));
  return {
    engine: name, lines: cur.lines, systems: cur.systems.length,
    movingSteps: cur.pure.reduce((n, x) => n + x.movingSteps, 0),
    stalls: cur.pure.reduce((n, x) => n + x.stalls.length, 0),
    backwards: cur.pure.reduce((n, x) => n + x.backwards.length, 0),
    belowFloor: cur.correction.reduce((n, x) => n + x.belowFloor, 0),
    aboveCeil: cur.correction.reduce((n, x) => n + x.aboveCeil, 0),
    danhaiMutation: { minRate: Math.min(...bad.map(x => x.minRate)), maxRate: Math.max(...bad.map(x => x.maxRate)),
      belowFloor: bad.reduce((n, x) => n + x.belowFloor, 0), aboveCeil: bad.reduce((n, x) => n + x.aboveCeil, 0) },
  };
};
const metroLines = metroSource.models.current_chromium.pure.map(x => ({
  system: x.system, line: x.line, directions: x.directions, movingSteps: x.movingSteps,
  stalls: x.stalls.length, backwards: x.backwards.length,
  trapezoidSegments: x.trapezoidSegments, linearFallbackSegments: x.linearFallbackSegments,
}));
const data = { selectedKeys: source.selectedKeys, selectionRule: source.selectionRule, models,
  allMetro: { engines: [metroEngine('chromium'), metroEngine('webkit')], lines: metroLines },
  capture: { key: source.selectedKeys[0], center: [25.0352, 121.5298], zoom: 16 },
  generatedAt: new Date().toISOString() };
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>北捷運動模型：基準／第一輪／第二輪倒數梯形對照</title>
<style>
:root{--ink:#17202a;--muted:#64707c;--paper:#f4f1e9;--card:#fffdf8;--line:#d8d2c5;--base:#df3f4f;--first:#147d92;--second:#7e62b3}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif}main{max-width:1180px;margin:auto;padding:28px 18px 64px}h1{font-size:clamp(25px,4vw,42px);line-height:1.12;margin:0 0 8px}h2{margin:38px 0 14px;font-size:24px}.lead{max-width:900px;color:var(--muted);font-size:16px}.notice{border-left:5px solid var(--base);background:#fff2f2;padding:12px 15px;border-radius:8px;margin:18px 0}.legend{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}.legend span:before{content:"";display:inline-block;width:26px;height:4px;border-radius:2px;margin-right:7px;vertical-align:middle}.legend .baseline:before{background:var(--base)}.legend .first:before{background:var(--first)}.legend .second:before{background:var(--second)}.sample{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:18px 0;box-shadow:0 3px 14px #3d342415}.sample h3{margin:0 0 2px;font-size:17px;word-break:break-all}.jump{color:var(--muted);margin:0 0 12px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart-card{border:1px solid var(--line);border-radius:10px;padding:10px;background:#fff}.chart-card h4{margin:0 0 6px}.chart-card canvas{display:block;width:100%;height:260px}.caption{color:var(--muted);font-size:13px;margin:8px 0 0}.frames{display:grid;gap:14px}.frame-row{display:grid;grid-template-columns:180px repeat(6,minmax(120px,1fr));gap:8px;align-items:start}.frame-label{font-weight:700;padding:8px}.frame{min-width:0}.frame img{display:block;width:100%;aspect-ratio:560/300;object-fit:cover;border:1px solid var(--line);border-radius:8px;background:#f3f0e8}.frame small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.table-wrap{max-width:100%;overflow-x:auto}.stats{border-collapse:collapse;width:100%;background:var(--card)}.stats th,.stats td{padding:9px 10px;border:1px solid var(--line);text-align:right;white-space:nowrap}.stats th:first-child,.stats td:first-child{text-align:left}.meta{font-size:12px;color:var(--muted);margin-top:40px}@media(max-width:820px){.charts{grid-template-columns:1fr}.frame-row{grid-template-columns:120px repeat(6,150px);overflow-x:auto;padding-bottom:8px}.frame-label{position:sticky;left:0;background:var(--card);z-index:1}.chart-card canvas{height:230px}}
</style></head><body><main>
<h1>平順度換掉了多少準度？</h1>
<p class="lead">同一份 2026-08-03 早尖峰語料、同一組逐秒時刻、同一支量測程式。紅色是未修改基準樹，藍色是第一輪 0.25×–2× 有界速度，紫色是第二輪「15 秒倒數＋停到停梯形」位置。</p>
<div class="notice"><strong>判讀先講：</strong>第一輪消除了基準樹的停住與數十倍衝刺，但校正期準度顯著退步。目前版直接從絕對到站倒數推站間位置，25m 內才平順接手，並延續同區間列車前後順序；同一套停到停梯形與 0.25×–2× 校正界線也已套到淡海輕軌等全部捷運。它追回一部分北捷準度、縮短長時間爬行，且沒有新增輪詢瞬移，但仍未追平基準樹。</div>
<h2>選樣規則</h2><p id="rule"></p><p>四班車都在分析前固定，沒有依本輪準度或畫面好不好看挑樣。</p>
<div class="legend"><span class="baseline">基準樹</span><span class="first">第一輪</span><span class="second">第二輪倒數梯形</span></div>
<section id="samples"></section>
<h2>淡海輕軌與全捷運共同驗收</h2>
<p id="metro-summary"></p>
<div class="table-wrap"><table class="stats"><thead><tr><th>系統／線</th><th>兩方向</th><th>行進取樣</th><th>行進中停住</th><th>倒退</th><th>梯形段</th><th>等速安全回退段</th></tr></thead><tbody id="metro-lines"></tbody></table></div>
<p class="caption">這張表要證明：修正不是北捷特例。每條線都逐秒掃過兩個方向；短到無法解出合理梯形的段落保留等速前進，不會為了套曲線而停住。舊校正器的語意突變控制在淡海輕軌確實重現 0× 與約 237×。</p>
<h2>同車、同時刻的實際 canvas 畫格</h2>
<p>固定鏡頭中心在東門—忠孝新生一帶，先執行 <code>map.setView([25.0352,121.5298], 16, {animate:false})</code>，再呼叫產品本身的 <code>draw()</code>。洋紅圈只是指出比較車，位置由產品實際輸出；每張圖都是 overlay canvas 的同尺寸裁切，沒有打網路或用外部底圖。</p>
<div class="frames" id="frames"></div>
<p class="caption">這組畫格要證明：基準樹會在新錨點後短時間大幅位移；第一輪與目前版都持續前進，校正時間軸守住 2×。紫線另含梯形本身的自然加減速；它與藍線相近不是壞事，只有倒數位置與既有平順位置差在 25m 內才接手，避免每 15 秒瞬移。</p>
<h2>三欄量化摘要</h2><div class="table-wrap"><table class="stats"><thead><tr><th>模型</th><th>全部位置誤差 p50</th><th>p90</th><th>p99</th><th>0.25× 最長</th><th>2× 最長</th></tr></thead><tbody id="stats"></tbody></table></div>
<p class="meta" id="meta"></p>
</main><script>
const DATA=${json};
const COLORS={baseline:'#df3f4f',first:'#147d92',second:'#7e62b3'};
const DASH={baseline:[],first:[],second:[7,5]};
const MODELS=['baseline','first','second'];
const fmt=n=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:1}):'—';
document.getElementById('rule').textContent=DATA.selectionRule;
function chart(canvas,key,kind){
 const dpr=Math.max(1,devicePixelRatio||1),box=canvas.getBoundingClientRect(),W=Math.max(520,box.width),H=260;
 canvas.width=W*dpr;canvas.height=H*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,W,H);
 const pad={l:54,r:18,t:18,b:34},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
 const series=MODELS.map(name=>({name,points:DATA.models[name].curves[key].points.filter(p=>Number.isFinite(kind==='position'?p.progressKm:p.normalizedSpeed))}));
 const epochs=series.flatMap(s=>s.points.map(p=>p.epoch)),x0=Math.min(...epochs),x1=Math.max(...epochs);
 let ys=series.flatMap(s=>s.points.map(p=>kind==='position'?p.progressKm:p.normalizedSpeed));
 let y0,y1;if(kind==='speed'){y0=0;y1=4.2}else{y0=Math.min(...ys);y1=Math.max(...ys);const m=Math.max(.01,(y1-y0)*.08);y0-=m;y1+=m}
 const X=x=>pad.l+(x-x0)/(x1-x0||1)*iw,Y=y=>pad.t+(1-(Math.max(y0,Math.min(y1,y))-y0)/(y1-y0||1))*ih;
 c.font='11px system-ui';c.strokeStyle='#ddd7cb';c.fillStyle='#68727c';c.lineWidth=1;
 const grid=kind==='speed'?[.25,1,2,4]:[0,.25,.5,.75,1].map(f=>y0+(y1-y0)*f);
 for(const y of grid){c.beginPath();c.moveTo(pad.l,Y(y));c.lineTo(W-pad.r,Y(y));c.stroke();c.textAlign='right';c.fillText(kind==='speed'?y+'×':y.toFixed(2)+' km',pad.l-7,Y(y)+4)}
 for(let i=0;i<=4;i++){const x=x0+(x1-x0)*i/4;c.beginPath();c.moveTo(X(x),pad.t);c.lineTo(X(x),H-pad.b);c.stroke();c.textAlign='center';c.fillText(Math.round(x-x0)+'s',X(x),H-11)}
 for(const s of series){c.strokeStyle=COLORS[s.name];c.lineWidth=s.name==='baseline'?2.4:2;c.setLineDash(DASH[s.name]);c.beginPath();let open=false;for(const p of s.points){const v=kind==='position'?p.progressKm:p.normalizedSpeed;if(!Number.isFinite(v)){open=false;continue}const x=X(p.epoch),y=Y(v);if(!open){c.moveTo(x,y);open=true}else c.lineTo(x,y)}c.stroke()}
 c.setLineDash([]);if(kind==='speed'){const maxima=Object.fromEntries(series.map(s=>[s.name,Math.max(...s.points.map(p=>p.normalizedSpeed).filter(Number.isFinite))]));c.textAlign='left';c.fillStyle='#68727c';c.fillText('>4× 尖峰裁切；基準 max '+fmt(maxima.baseline)+'×',pad.l+6,pad.t+12)}
}
const samples=document.getElementById('samples');
for(const key of DATA.selectedKeys){const jump=DATA.models.first.curves[key].jump;const el=document.createElement('article');el.className='sample';el.innerHTML='<h3>'+key+'</h3><p class="jump">第一輪最大 target 跳幅：'+fmt(jump&&jump.from)+' → '+fmt(jump&&jump.to)+' 秒（Δ '+fmt(jump&&jump.delta)+' 秒）</p><div class="charts"><div class="chart-card"><h4>逐秒位置—時間</h4><canvas data-kind="position"></canvas><p class="caption">看連續性：紅線的水平／近垂直段是凍住與衝刺；藍線用有界校正，紫線再加上停到停梯形。紫線偏離藍線處，是可信倒數位置在 25m 內接手。</p></div><div class="chart-card"><h4>逐秒正規化速度</h4><canvas data-kind="speed"></canvas><p class="caption">0.25×、1×、2× 保留第一輪的等速站間參考線。紫線可因梯形的自然巡航高於 2×，不等於即時校正越界；校正時間軸另以逐線測試確認仍在 0.25×–2×。基準尖峰超過 4× 時在圖頂裁切並標出 max。</p></div></div>';samples.appendChild(el);for(const cv of el.querySelectorAll('canvas'))chart(cv,key,cv.dataset.kind)}
const frames=document.getElementById('frames');for(const name of MODELS){const row=document.createElement('div');row.className='frame-row';row.innerHTML='<div class="frame-label">'+DATA.models[name].label+'</div>';for(const f of DATA.models[name].captureFrames){const d=document.createElement('div');d.className='frame';d.innerHTML='<img alt="'+name+' '+f.epoch+'" src="'+f.dataUrl+'"><small>t+'+(f.epoch-DATA.models[name].captureFrames[0].epoch)+'s · eased '+fmt(f.eased)+'s</small>';row.appendChild(d)}frames.appendChild(row)}
const engines=DATA.allMetro.engines,m=engines[0],d=m.danhaiMutation;document.getElementById('metro-summary').textContent='Chromium 與 WebKit 各驗 '+m.systems+' 個系統、'+m.lines+' 條線、'+m.movingSteps.toLocaleString('zh-TW')+' 個行進取樣；目前版兩引擎都是停住 0、倒退 0、速度越過 0.25×／2× 界線 0。把非北捷校正器突變回舊語意後，淡海 V／VB 立刻量到 '+fmt(d.minRate)+'×～'+fmt(d.maxRate)+'×（下界違反 '+d.belowFloor+'、上界違反 '+d.aboveCeil+' 個取樣）。';
const metroBody=document.getElementById('metro-lines');for(const x of DATA.allMetro.lines){const tr=document.createElement('tr');tr.innerHTML='<td>'+x.system+' / '+x.line+'</td><td>'+x.directions.join('、')+'</td><td>'+x.movingSteps.toLocaleString('zh-TW')+'</td><td>'+x.stalls+'</td><td>'+x.backwards+'</td><td>'+x.trapezoidSegments+'</td><td>'+x.linearFallbackSegments+'</td>';metroBody.appendChild(tr)}
const stats=document.getElementById('stats');for(const name of MODELS){const m=DATA.models[name];const tr=document.createElement('tr');tr.innerHTML='<td>'+m.label+'</td><td>'+fmt(m.accuracy.all.p50)+'m</td><td>'+fmt(m.accuracy.all.p90)+'m</td><td>'+fmt(m.accuracy.all.p99)+'m</td><td>'+fmt(m.saturation.floor.durationSec.max)+'s</td><td>'+fmt(m.saturation.ceil.durationSec.max)+'s</td>';stats.appendChild(tr)}
document.getElementById('meta').textContent='產生時間：'+DATA.generatedAt+'。本檔所有 CSS、JS、曲線資料與 PNG 畫格均內嵌；可離線直接開啟。';
</script></body></html>`;

fs.writeFileSync(path.join(ROOT, 'CODEX-對照.html'), html);
console.log(path.join(ROOT, 'CODEX-對照.html'));

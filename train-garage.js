// 收藏由護照推導；這裡不另存進度，也不把地圖的推定派車當成實際車型紀錄。
(() => {
  'use strict';
  const RULES = [
    ['emu3000','stock','emu3000'], ['temu1000','stock','taroko'], ['temu2000','stock','puyuma'],
    ['e1000','stock','pp'], ['dr3100','stock','dr3100'], ['e200','stock','chukuang'],
    ['emu500','stock','local'], ['emu900','stock','fast-local'],
    ['blue','named','blue-train'], ['haifeng','named','haifeng'],
    ['700t','system','thsr_sched'], ['dl38','system','afr_sched'],
  ].map(([model,category,id]) => ({model,category,id}));
  const ruleByModel = new Map(RULES.map(r => [r.model,r]));
  // 穩定的產品里程碑；不是實際搭過該車型的推定。既有章仍以 OR 條件帶入。
  const GOALS = {"c301":{"metric":"stations","need":2},"c321":{"metric":"stations","need":4},"c341":{"metric":"stations","need":6},"c371":{"metric":"stations","need":8},"c381":{"metric":"stations","need":12},"val256":{"metric":"stations","need":16},"wenhu":{"metric":"stations","need":20},"airportlocal":{"metric":"stations","need":24},"airportexpress":{"metric":"stations","need":28},"y100":{"metric":"stations","need":32},"sanying":{"metric":"stations","need":36},"taichung":{"metric":"stations","need":40},"kaohsiung":{"metric":"stations","need":45},"danhai":{"metric":"stations","need":50},"ankeng":{"metric":"stations","need":60},"caf":{"metric":"stations","need":70},"citadis":{"metric":"stations","need":80},"emu500":{"metric":"rides","need":1},"emu600":{"metric":"rides","need":2},"emu700":{"metric":"rides","need":3},"emu800":{"metric":"rides","need":4},"emu800r":{"metric":"rides","need":5},"emu900":{"metric":"rides","need":6},"dr1000":{"metric":"rides","need":8},"dr3100":{"metric":"rides","need":10},"temu1000":{"metric":"rides","need":12},"temu2000":{"metric":"rides","need":15},"emu3000":{"metric":"rides","need":18},"e1000":{"metric":"rides","need":20},"e500":{"metric":"rides","need":25},"emu100":{"metric":"rides","need":30},"emu1200":{"metric":"rides","need":35},"dr2700":{"metric":"rides","need":40},"ck124":{"metric":"rides","need":50},"dt668":{"metric":"rides","need":75},"ct273":{"metric":"rides","need":100},"e200":{"metric":"km","need":50},"e300":{"metric":"km","need":100},"e400":{"metric":"km","need":150},"r20":{"metric":"km","need":200},"r100":{"metric":"km","need":250},"r150":{"metric":"km","need":300},"r180":{"metric":"km","need":400},"r200":{"metric":"km","need":500},"dhl100":{"metric":"km","need":600},"juguang":{"metric":"km","need":700},"ppcoach":{"metric":"km","need":800},"bluecoach":{"metric":"km","need":900},"mingricoach":{"metric":"km","need":1000},"blue":{"metric":"km","need":1200},"haifeng":{"metric":"km","need":1500},"shanlan":{"metric":"km","need":1800},"mingri":{"metric":"km","need":2000},"700t":{"metric":"km","need":2500},"dl25":{"metric":"branches","need":1},"dl38":{"metric":"branches","need":2},"dl39":{"metric":"branches","need":3},"dl45":{"metric":"branches","need":4},"alicoach":{"metric":"branches","need":1},"hinoki":{"metric":"branches","need":2},"fushen":{"metric":"branches","need":3},"xuyue":{"metric":"branches","need":4}};
  function collection(snapshot, models) {
    const {coll, rides = [], special, stationCount = 0} = snapshot;
    const progress = {rides:rides.length, km:rides.reduce((n,r)=>n+Math.max(0,Number(r.km)||0),0), stations:stationCount, branches:coll?.branch?.size||0};
    return Object.entries(models).map(([id,model]) => {
      const legacy = ruleByModel.get(id), goal = GOALS[id];
      let earned = false, date = '', label = '';
      if (legacy?.category === 'system') {
        const matches = rides.filter(r => r.sys === legacy.id);
        earned = matches.length > 0;
        date = matches.map(r => r.date || '').filter(Boolean).sort()[0] || '';
        label = model.system;
      } else if (legacy) {
        earned = !!coll?.[legacy.category]?.has(legacy.id);
        date = coll?.at?.[legacy.category + '|' + legacy.id] || '';
        const list = legacy.category === 'stock' ? special?.rollingStock : special?.namedTrains;
        label = list?.find(x => x.id === legacy.id)?.name || model.name;
      }
      const now = progress[goal.metric], owned = earned || now >= goal.need;
      return {id, model, rule:legacy || {category:'progress',id:goal.metric}, goal, now, owned, earned, date:earned?date:'', label};
    });
  }
  function goalText(row) {
    const keys={rides:'完乘 {count} 趟',km:'累積旅程 {count} 公里',stations:'收集 {count} 座車站',branches:'取得 {count} 枚支線章'};
    return tr(keys[row.goal.metric],{count:row.goal.need});
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host, dialog, rows = [], selected, filter = 'all', demo = false;
  let active = false, renderer, raf = 0, auto = false, yaw = -.55, elevation = .39, last = 0, drag = null, resize, visibility;
  const pointers=new Map();let pinch=null,zoom=1;
  let mode='model',running=false,direction=1,distance=0,travelTime=0,inView=true,period='day';
  // 場景分頁（旗標 garagescene 開才用得到）：sceneUi＝目前這份 DOM 掛的是兩分頁版；tab＝展示框分頁 model｜scene；
  // loopOn＝「跑起來」開關（開＝mode 'loop'）；cardsUp＝場景卡片正在顯示（此時 3D 不畫、rAF 停掉）。
  // 旗標關時四個都停在初值，舊路徑完全不碰它們。
  let sceneUi=false,tab='model',loopOn=false,cardsUp=false;
  function scenePeriod(){const now=new Date(),h=(now.getUTCHours()+8)%24+now.getUTCMinutes()/60;return h>=5&&h<7?'sunrise':h>=7&&h<17?'day':h>=17&&h<19?'sunset':'night';}
  function resetView(){zoom=1;pointers.clear();pinch=drag=null;yaw=mode==='track'?-Math.PI/2:mode==='loop'?-.9:-.55;elevation=mode==='track'?.16:mode==='loop'?.8:.39;}
  function clampView(){if(mode==='loop')elevation=Math.max(.25,Math.min(1.35,elevation));if(mode==='track'){yaw=Math.max(-Math.PI/2-.20,Math.min(-Math.PI/2+.20,yaw));elevation=Math.max(.08,Math.min(.30,elevation));}}
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const tr = (key, values) => host.t(key, values);
  const $ = sel => dialog.querySelector(sel);
  const status = row => row.owned ? tr('已入庫') : tr('待收集');
  function data() {
    rows = collection(host.snapshot(), globalThis.RailGarageCatalog || {});
    if (demo) for (const row of rows) if (['emu3000','e200','e1000','700t','blue','temu2000'].includes(row.id)) {
      row.owned = true; row.date = ''; // 展示只改此輪檢視物件，不寫入護照。
    }
  }
  let renderSession = 0, modelTicket = 0, loadedId = '', loadedMode = '', rendererPromise;
  async function startRenderer() {
    const session=++renderSession;
    try {
      const module=await import('./rail-3d/garage-renderer.js');
      if(!active||session!==renderSession)return;
      renderer=module.createRenderer(()=>{auto=running=false;modelTicket++;renderer?.dispose();renderer=null;loadedId='';if(dialog?.open){$('.g-fallback').textContent=tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;showControls();}});
    } catch { renderer=null; }
  }
  async function loadSelected() {
    const ticket=++modelTicket, id=selected;
    loadedId='';delete $('.g-view').dataset.rendered;
    $('.g-view').getContext('2d').clearRect(0,0,$('.g-view').width,$('.g-view').height);
    $('.g-fallback').textContent=tr('小車載入中…');$('.g-fallback').hidden=false;$('.g-retry').hidden=true;
    try {
      await rendererPromise;
      if(ticket!==modelTicket||!active)return;
      if(!renderer)throw Error('renderer unavailable');
      await renderer.load(id,mode);
      if(ticket!==modelTicket||!active)return;
      loadedId=id;loadedMode=mode;$('.g-fallback').hidden=true;requestDraw();
    } catch(e) {
      if(ticket!==modelTicket||!active||e.name==='AbortError')return;
      $('.g-fallback').textContent=tr('小車載入失敗，請重試；收藏進度不受影響。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;
    }
  }
  function requestDraw() { if (!raf && !sceneEl && !cardsUp && dialog?.open && inView && !document.hidden) raf=requestAnimationFrame(frame); }
  function frame(at) {
    raf=0;if(!dialog.open||document.hidden||!inView||sceneEl||cardsUp)return;
    // 精修網格試跑最多約 30 fps；離開展示台或切到背景後不持續佔用 GPU。
    if((auto||running)&&last&&at-last<32){requestDraw();return;}
    const dt=last?Math.min((at-last)/1000,.06):0;last=at;
    if(auto&&!drag)yaw+=dt*.35;
    if(mode!=='model'&&running&&loadedId){distance+=dt*2.1*direction;travelTime+=dt;}
    const row=rows.find(r=>r.id===selected);
    if(row&&loadedId===row.id) { renderer?.draw($('.g-view'),row,yaw,{elevation,zoom,mode,distance,direction,period,time:travelTime}); }

    if((auto||running)&&loadedId)requestDraw();
  }
  function setZoom(value){zoom=Math.max(.7,Math.min(3,value));showControls();requestDraw();}
  function showControls() {
    $('.g-zoom-in').disabled=zoom>=3;$('.g-zoom-out').disabled=zoom<=.7;$('.g-zoom-level').textContent=Math.round(zoom*100)+'%';
    dialog.classList.toggle('g-scene',mode!=='model'||(sceneUi&&tab==='scene'));
    for(const b of dialog.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode));
    if(sceneUi){for(const b of dialog.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===tab));$('.g-run-switch').setAttribute('aria-checked',String(loopOn));}
    $('.g-reverse').hidden=mode==='model'||cardsUp;$('.g-reverse').setAttribute('aria-pressed',String(direction===-1));
    $('.g-auto').setAttribute('aria-label',tr(mode!=='model'?(running?'暫停行駛':'開始行駛'):'自動旋轉'));
    $('.g-auto').setAttribute('aria-pressed',String(mode!=='model'?running:auto));$('.g-auto').textContent=(mode!=='model'?running:auto)?'Ⅱ':'▷';
    $('.g-view-hint').textContent=mode==='track'?tr('頭城海岸・龜山島')+' · '+tr({sunrise:'日出',day:'藍天',sunset:'黃昏',night:'星空'}[period]):mode==='loop'?tr('環形試跑 · 拖曳旋轉，欣賞三節小車'):tr('上下左右拖曳，看看每一面');
  }
  // 一車一景（旗標 garagescene 開才有，host.scenes 由 index.html 傳入）。展示框的「場景」分頁列出這台車能開進的景：
  // 哪台車進哪幾景只准經過 garageScenesFor（對照表在 train-garage-scenes.js），這裡不寫死任何車款或場景名；
  // 卡片的鎖頭只准問 garageSceneUnlocked（garage-scene-unlock.js，解鎖單位是場景 id，不看通行證）。
  // 車庫只負責列卡片、開 iframe、收 leave 訊息；點進去之後場景頁會再問一次解鎖，鎖住時由它顯示「還沒解鎖」。
  let sceneEl=null,sceneFrame=null,sceneBtn=null;
  // 旗標開、而且對照表有載入才走兩分頁版；對照表沒載到就當旗標關（舊的三分頁）。
  const scenesOn=()=>!!host?.scenes&&typeof globalThis.garageScenesFor==='function';
  const scenesOf=row=>sceneUi&&row?globalThis.garageScenesFor(row.id)||[]:[];
  const sceneUnlocked=id=>typeof globalThis.garageSceneUnlocked==='function'&&!!globalThis.garageSceneUnlocked(id);
  const LOCK_SVG='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const MAKING_SVG='<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="6" width="18" height="7" rx="1.5"/><path d="M7 13 11 6M12 13 16 6M17 13l3-5"/><path d="M6 13v7M18 13v7"/></svg>';
  // 場景分頁的樣式。放在這裡、旗標開才注入 <style>（旗標關時連 CSS 都和以前一樣）；顏色只用 --g-* 變數，深色模式自動跟著走。
  const SCENE_CSS=`
#trainGarage .g-scene-tabs.g-tabs-2{grid-template-columns:repeat(2,minmax(0,1fr))}
#trainGarage .g-scene-tabs.g-tabs-2 button{padding:10px 4px;font-size:13px}
#trainGarage .g-scene-tabs.g-tabs-2 button[aria-pressed=true]{font-weight:600}
#trainGarage .g-run{padding:2px 12px 8px;border-bottom:1px solid var(--g-line)}
#trainGarage .g-run-main{display:flex;align-items:center;justify-content:space-between;gap:10px}
#trainGarage .g-run-switch{display:inline-flex;align-items:center;gap:10px;padding:0 8px 0 0;border:0;background:none;text-align:left}
#trainGarage .g-run-switch b{font-size:15px;line-height:1.4}
#trainGarage .g-run-track{position:relative;flex:none;width:48px;height:28px;border-radius:14px;border:1px solid var(--g-line);background:var(--line-faint,var(--g-stage));transition:background-color .15s,border-color .15s}
#trainGarage .g-run-track::after{content:"";position:absolute;left:2px;top:2px;box-sizing:border-box;width:22px;height:22px;border-radius:50%;border:1px solid var(--g-line);background:var(--g-paper);transition:transform .15s}
#trainGarage .g-run-switch[aria-checked=true] .g-run-track{background:var(--g-accent);border-color:var(--g-accent)}
#trainGarage .g-run-switch[aria-checked=true] .g-run-track::after{transform:translateX(20px);border-color:transparent;background:#fffdf6}
#trainGarage .g-run small{display:block;margin-top:-2px;font-size:12px;line-height:1.5;color:var(--g-muted)}
#trainGarage .g-making{display:flex;flex-direction:column;align-items:center;gap:4px;padding:20px 14px 10px;text-align:center}
#trainGarage .g-making svg{color:var(--g-ink)}
#trainGarage .g-making b{font-size:16px;line-height:1.4}
#trainGarage .g-making small{font-size:12px;line-height:1.5;color:var(--g-muted)}
#trainGarage .g-tag{position:absolute;left:12px;bottom:12px;padding:4px 10px;border:1px solid var(--g-line);border-radius:20px;background:var(--g-card);color:var(--g-ink);font-size:11px;line-height:1.5;pointer-events:none}
#trainGarage .g-scene-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:10px;padding:10px}
#trainGarage .g-scene-card{display:flex;flex-direction:column;align-items:stretch;min-width:0;padding:0;overflow:hidden;text-align:left;border:1px solid var(--g-line);border-radius:12px;background:var(--g-card)}
#trainGarage .g-scene-th{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--g-stage)}
#trainGarage .g-scene-th img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
#trainGarage .g-scene-locked .g-scene-th img{filter:grayscale(1) contrast(.7) brightness(1.05);opacity:.75}
#trainGarage .g-scene-fav{position:absolute;left:8px;top:8px;padding:4px 10px;border-radius:20px;background:var(--g-accent);color:var(--g-paper);font-size:11px;letter-spacing:1px;line-height:1.4}
#trainGarage .g-scene-tx{display:flex;flex-direction:column;gap:3px;padding:10px 12px 12px}
#trainGarage .g-scene-tx b{font-size:16px;line-height:1.4}
#trainGarage .g-scene-tx small{font-size:12px;line-height:1.5;color:var(--g-muted)}
#trainGarage .g-scene-state{display:flex}
#trainGarage .g-scene-enter{margin-top:8px;padding:10px 20px;border-radius:10px;background:var(--g-accent);color:var(--g-paper);font-size:14px;line-height:1.4}
#trainGarage .g-scene-lock{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:9px 12px;border:1px dashed var(--g-line);border-radius:10px;color:var(--g-muted);font-size:12px;line-height:1.4}
#trainGarage .g-stage[data-panel=cards] .g-viewport,#trainGarage .g-stage[data-panel=cards] .g-fallback,#trainGarage .g-stage[data-panel=cards] .g-stage-foot{display:none}
@media(prefers-reduced-motion:reduce){#trainGarage .g-run-track,#trainGarage .g-run-track::after{transition:none}}`;
  // 兩分頁版的 DOM：build() 先照舊組好三分頁，旗標開再由這裡改成「近看小車｜場景」並補上跑起來開關、卡片區、製作中區塊與標籤，
  // 所以旗標關時 build() 出來的 HTML 一個字都沒動。
  function mountSceneTab(){
    if(!document.getElementById('trainGarageSceneStyle')){const s=document.createElement('style');s.id='trainGarageSceneStyle';s.textContent=SCENE_CSS;document.head.append(s);}
    const tabs=$('.g-scene-tabs');tabs.classList.add('g-tabs-2');
    tabs.innerHTML=[['model','近看小車'],['scene','場景']].map(([id,text])=>`<button type="button" data-tab="${id}" aria-pressed="${tab===id}">${esc(tr(text))}</button>`).join('');
    $('.g-scene-bar').insertAdjacentHTML('afterend',
      `<div class="g-run"><div class="g-run-main"><button type="button" class="g-run-switch" role="switch" aria-checked="${loopOn}" aria-describedby="gRunHint"><span class="g-run-track" aria-hidden="true"></span><b>${esc(tr('跑起來'))}</b></button></div><small id="gRunHint">${esc(tr('開啟後小車繞圈跑'))}</small></div>`
      +`<div class="g-making" hidden>${MAKING_SVG}<b>${esc(tr('這款車的場景製作中'))}</b><small>${esc(tr('先用「海岸行旅」暫時展示'))}</small></div>`
      +`<div class="g-scene-list" hidden></div>`);
    $('.g-viewport').insertAdjacentHTML('beforeend',`<span class="g-tag" hidden>${esc(tr('海岸行旅・暫時展示'))}</span>`);
    for(const b of dialog.querySelectorAll('[data-tab]'))b.onclick=()=>{if(tab===b.dataset.tab)return;tab=b.dataset.tab;showDetail();};
    $('.g-run-switch').onclick=()=>{loopOn=!loopOn;showDetail();};
    sceneUi=true;
  }
  // 依目前分頁、開關與這台車有沒有景，決定展示框現在是哪一種畫面：
  //   model＝近看小車（開關開著就是環形試跑 loop）｜cards＝場景卡片（3D 不畫、rAF 停）｜making＝這款車沒有景，製作中區塊＋海岸行旅（track）。
  function syncScenePanel(row){
    const list=scenesOf(row),panel=tab==='model'?'model':list.length?'cards':'making',want=panel==='making'?'track':loopOn?'loop':'model';
    if(want!==mode){mode=want;auto=false;running=mode!=='model'&&!reduced.matches;resetView();last=0;}
    cardsUp=panel==='cards';
    if(cardsUp){cancelAnimationFrame(raf);raf=0;renderSceneCards(row,list);}
    else if(panel==='making'){const box=$('.g-scene-list');if(box.dataset.key){box.replaceChildren();delete box.dataset.key;}} // 沒有景的車：不留上一台車的（隱藏）卡片
    $('.g-stage').dataset.panel=panel;
    $('.g-run').hidden=panel!=='model';$('.g-scene-list').hidden=!cardsUp;$('.g-making').hidden=panel!=='making';$('.g-tag').hidden=panel!=='making';
    // 反向鍵跟著跑起來那一列走（分頁列寬度才不會在開關時縮放）；製作中沒有那一列，回分頁列旁。
    const rev=$('.g-reverse'),slot=panel==='model'?$('.g-run-main'):$('.g-scene-bar');if(rev.parentNode!==slot)slot.append(rev);
  }
  function renderSceneCards(row,list){
    const box=$('.g-scene-list'),key=row.id+'|'+list.join(',');
    if(box.dataset.key!==key){
      const home=globalThis.RailGarageScenes?.[row.id]?.scene; // 本命景：對照表登記給這台車的那一景，在清單裡才標
      box.replaceChildren(...list.map(id=>{
        const info=globalThis.RailGarageSceneInfo?.[id]||{},card=document.createElement('button');
        card.type='button';card.className='g-scene-card';card.dataset.scene=id;
        card.innerHTML=`<span class="g-scene-th">${info.preview?`<img src="${esc(info.preview)}" alt="" loading="lazy" decoding="async" width="640" height="360">`:''}${id===home?`<span class="g-scene-fav">${esc(tr('本命景'))}</span>`:''}</span><span class="g-scene-tx"><b>${esc(tr(info.name||id))}</b>${info.blurb?`<small>${esc(tr(info.blurb))}</small>`:''}<span class="g-scene-state"></span></span>`;
        const img=card.querySelector('img');if(img)img.onerror=()=>{img.hidden=true;};
        card.onclick=()=>openScene(row.id,id,card);
        return card;
      }));
      box.dataset.key=key;
    }
    syncSceneLocks();
  }
  // 重讀每張卡的解鎖狀態（切到場景分頁、從場景頁回來都會呼叫）。只在狀態變了才動 DOM，卡片本身不重建，焦點與預覽圖都留著。
  function syncSceneLocks(){
    for(const card of dialog?.querySelectorAll('.g-scene-card')||[]){
      const id=card.dataset.scene,unlocked=sceneUnlocked(id);
      if(card.dataset.unlocked===String(unlocked))continue;
      const info=globalThis.RailGarageSceneInfo?.[id]||{};
      card.dataset.unlocked=String(unlocked);card.classList.toggle('g-scene-locked',!unlocked);
      card.querySelector('.g-scene-state').innerHTML=unlocked?`<span class="g-scene-enter">${esc(tr('進入'))}</span>`:`<span class="g-scene-lock">${LOCK_SVG}${esc(tr('這一景還沒解鎖'))}</span>`;
      card.setAttribute('aria-label',[tr(info.name||id),card.querySelector('.g-scene-fav')?tr('本命景'):'',unlocked?tr('進入'):tr('這一景還沒解鎖')].filter(Boolean).join(' · '));
    }
  }
  function onSceneMessage(e){
    if(!sceneEl||e.origin!==location.origin||e.source!==sceneFrame?.contentWindow)return;
    if(e.data?.type==='railisland:garage-scene:leave')closeScene(true);
  }
  function openScene(carId,sceneId,trigger){
    if(sceneEl||!dialog?.open)return;
    sceneBtn=trigger||document.activeElement; // iOS Safari 點按鈕不會讓它取得焦點，所以由呼叫端把卡片傳進來
    cancelAnimationFrame(raf);raf=0;
    sceneEl=document.createElement('div');sceneEl.className='g-scene-overlay';
    sceneFrame=document.createElement('iframe');
    sceneFrame.setAttribute('allow','fullscreen');sceneFrame.title=tr('場景');
    sceneFrame.src='garage-scene.html?car='+encodeURIComponent(carId)+'&scene='+encodeURIComponent(sceneId)+'&lang='+encodeURIComponent(host.lang())+'&period='+encodeURIComponent(period==='sunrise'?'day':period)+'&embed=1';
    sceneEl.append(sceneFrame);dialog.append(sceneEl);
    window.addEventListener('message',onSceneMessage);
  }
  function closeScene(restoreFocus){
    if(!sceneEl)return;
    window.removeEventListener('message',onSceneMessage);
    try{sceneFrame.src='about:blank';}catch(e){}
    sceneEl.remove();sceneEl=sceneFrame=null;
    const b=sceneBtn;sceneBtn=null;last=0;
    syncSceneLocks(); // 從場景頁回來：解鎖狀態可能變了（例如剛兌換），重讀一次
    if(restoreFocus)(b?.isConnected?b:dialog?.querySelector('[data-tab="scene"]'))?.focus?.({preventScroll:true});
    requestDraw();
  }
  function showDetail() {
    const row=rows.find(r=>r.id===selected);
    $('.g-showcase').hidden=!row;
    if(!row){auto=running=false;cancelAnimationFrame(raf);raf=0;showControls();return;}
    if(sceneUi)syncScenePanel(row);
    $('.g-view').setAttribute('aria-label',tr(row.model.name)+' · '+status(row)+' · '+tr(mode==='track'?'海岸行旅':mode==='loop'?'環形試跑':'近看小車'));
    showControls();
    const badge=$('.g-status');badge.textContent=status(row);badge.classList.toggle('owned',row.owned);
    $('.g-name').textContent=tr(row.model.name);
    $('.g-system').textContent=tr(row.model.system)+' · '+tr('Q 版收藏模型');
    $('.g-reason').textContent=demo ? tr('展示模式・不計入收藏') : row.earned ? tr('完成「{name}」收藏，代表車型已入庫。',{name:tr(row.label)}) :
      row.owned ? tr('已達成「{goal}」，紀念模型已入庫。',{goal:goalText(row)}) :
      row.rule.category==='progress' ? goalText(row) : tr('取得「{name}」收集章，或達成「{goal}」。',{name:tr(row.label),goal:goalText(row)});
    $('.g-goal').textContent=goalText(row)+' · '+Math.min(Math.floor(row.now),row.goal.need)+' / '+row.goal.need;
    $('.g-goal').hidden=demo||row.earned;
    $('.g-date').textContent=demo?tr('展示模式・不計入收藏'):row.date?tr('首次入庫：{date}',{date:row.date}):'';
    const action=$('.g-cta');action.hidden=!row.rule||demo;action.textContent=row.rule.category==='progress'?tr('查看旅程護照'):tr(row.owned?'再陪它跑一趟':'開始收集');
    action.onclick=()=>{const rule=row.rule;close();host.launch(rule);};
    $('.g-source-body').replaceChildren();
    for(const text of [tr('模型製作：軌島（Q 版示意）'),tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'),tr('外觀依公開照片參考繪製；照片僅連結，未作為模型貼圖。')]) {
      const p=document.createElement('p');p.textContent=text;$('.g-source-body').append(p);
    }
    for(const source of row.model.sources||[]) {
      let url;try{url=new URL(source.url);}catch{continue;}if(!['https:','http:'].includes(url.protocol))continue;
      const p=document.createElement('p'),a=document.createElement('a');
      a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=tr('外觀參考')+' · '+tr(source.label)+' ↗';p.append(a);$('.g-source-body').append(p);
    }
    if(!cardsUp&&(loadedId!==row.id||loadedMode!==mode))loadSelected(); // 場景卡片顯示中不載 3D，切回近看小車時才載
    requestDraw();
  }
  function chooseModel(id) {
    selected=id;$('.g-model-select').value=id;
    dialog.querySelectorAll('.g-car').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.model===id)));
    showDetail();
  }
  function showGrid() {
    const list=rows.filter(r=>filter==='all'||(filter==='owned'?r.owned:r.rule&&!r.owned))
      .sort((a,b)=>Number(b.owned)-Number(a.owned)||Number(!!b.rule)-Number(!!a.rule));
    if(!list.some(r=>r.id===selected))selected=list[0]?.id;
    const picker=$('.g-model-select');picker.replaceChildren();picker.disabled=!list.length;
    for(const sys of new Set(list.map(r=>r.model.system))) {
      const group=document.createElement('optgroup');group.label=tr(sys);
      for(const row of list.filter(r=>r.model.system===sys)) {
        const option=document.createElement('option');option.value=row.id;option.textContent=tr(row.model.name)+' · '+status(row);group.append(option);
      }
      picker.append(group);
    }
    if(!list.length){const option=document.createElement('option');option.textContent=tr('沒有符合條件的車款。');option.value='';picker.append(option);}
    picker.value=selected||'';
    $('.g-result').textContent=tr('{count} 款車車',{count:list.length});
    $('.g-grid').replaceChildren();
    for(const row of list) {
      const b=document.createElement('button');b.type='button';b.className=row.owned?'g-car':'g-car g-locked';b.dataset.model=row.id;b.setAttribute('aria-pressed',String(selected===row.id));
      b.setAttribute('aria-label',tr(row.model.name)+' · '+status(row));
      b.innerHTML=`<span class="g-check" aria-hidden="true">${row.owned?'✓':'○'}</span><img src="${esc(row.model.thumbnail)}" alt="" loading="lazy" width="320" height="200"><b>${esc(tr(row.model.name))}</b><small>${esc(status(row))}</small>`;
      b.onclick=()=>{chooseModel(row.id);$('.g-filters').scrollIntoView({block:'start',behavior:'instant'});$('.g-model-select').focus({preventScroll:true});};
      $('.g-grid').append(b);
    }
    $('.g-empty').hidden=!!list.length;
    $('.g-empty-text').textContent=!rows.length?tr('車庫暫時無法載入，請稍後重試。'):filter==='owned'?tr('第一格車位，留給下一段旅程。'):tr('沒有符合條件的車款。');
    $('.g-demo-start').hidden=demo||filter!=='owned';
    for(const b of dialog.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===filter));
    showDetail();
  }
  function refresh() {
    if(!dialog?.open)return;
    const langChanged=dialog.lang!==host.lang();
    if(langChanged){build();return;}
    data();const owned=rows.filter(r=>r.owned).length,total=rows.filter(r=>r.rule).length;
    $('.g-count').textContent=rows.length?owned:'—';$('.g-total').textContent=rows.length?' / '+total:'';
    const p=$('progress');p.max=Math.max(1,total);p.value=owned;p.setAttribute('aria-label',tr('已入庫 {count} 款，共可收集 {total} 款',{count:owned,total}));
    $('.g-demo').hidden=!demo;
    $('.g-demo-off').textContent=tr('回到我的車庫');
    $('.g-catalog').textContent=tr('館藏模型 {count} 款',{count:rows.length});
    if(!rows.some(r=>r.id===selected))selected=rows.find(r=>r.owned)?.id||rows.find(r=>r.rule)?.id;
    showGrid();
  }
  function build() {
    data();resize?.disconnect();visibility?.disconnect();pointers.clear();pinch=drag=null;inView=true;
    dialog.lang=host.lang();
    closeScene(false);
    dialog.classList.toggle('dark',host.dark());
    dialog.innerHTML=`<header class="g-top"><span class="g-brand">RAIL ISLAND / COLLECTION</span><button class="g-close" autofocus>${esc(tr('回到地圖'))} ↗</button></header>
      <main class="g-main"><div class="g-heading"><h1 id="garageTitle">${esc(tr('我的車庫'))}</h1>
      <div class="g-progress"><strong class="g-count">0</strong><span class="g-total"></span><progress max="1" value="0"></progress><span>${esc(tr('可收集車款'))}</span></div></div>
      <div class="g-demo" hidden><span>${esc(tr('展示模式・不計入收藏'))}</span><button class="g-demo-off"></button></div>
      <div class="g-filters"><div class="g-tabs">${[['all','全部車款'],['owned','已入庫'],['pending','待收集']].map(([id,text])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${esc(tr(text))}</button>`).join('')}</div>
      <label class="g-picker"><span>${esc(tr('選擇車款'))}</span><select class="g-model-select"></select></label></div>
      <div class="g-empty" hidden><p class="g-empty-text"></p><button class="g-reset">${esc(tr('查看所有車款'))}</button><button class="g-demo-start">${esc(tr('看看展示車庫'))}</button></div>
      <section class="g-showcase" aria-label="${esc(tr('車型展示'))}"><div class="g-stage"><div class="g-scene-bar"><div class="g-scene-tabs">${[['model','近看小車'],['loop','環形試跑'],['track','海岸行旅']].map(([id,label])=>`<button data-view="${id}" aria-pressed="${mode===id}">${esc(tr(label))}</button>`).join('')}</div><button class="g-reverse" hidden aria-pressed="false" title="${esc(tr('反向行駛'))}" aria-label="${esc(tr('反向行駛'))}">⇄</button></div><div class="g-viewport"><canvas class="g-view" tabindex="0" role="img"></canvas><div class="g-zoom"><button class="g-zoom-in" title="${esc(tr('放大場景'))}" aria-label="${esc(tr('放大場景'))}">+</button><output class="g-zoom-level" aria-label="${esc(tr('縮放比例'))}">100%</output><button class="g-zoom-out" title="${esc(tr('縮小場景'))}" aria-label="${esc(tr('縮小場景'))}">−</button></div></div><div class="g-fallback" hidden>${esc(tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。'))}</div>
      <div class="g-stage-foot"><span class="g-view-hint"></span><div class="g-controls"><button class="g-left" title="${esc(tr('向左旋轉'))}" aria-label="${esc(tr('向左旋轉'))}">↶</button><button class="g-auto" aria-label="${esc(tr('自動旋轉'))}" aria-pressed="false">▷</button><button class="g-right" title="${esc(tr('向右旋轉'))}" aria-label="${esc(tr('向右旋轉'))}">↷</button><button class="g-up" title="${esc(tr('提高視角'))}" aria-label="${esc(tr('提高視角'))}">↑</button><button class="g-down" title="${esc(tr('降低視角'))}" aria-label="${esc(tr('降低視角'))}">↓</button><button class="g-reset-view" title="${esc(tr('重設視角'))}" aria-label="${esc(tr('重設視角'))}">⌂</button><button class="g-retry" hidden aria-label="${esc(tr('重新載入小車'))}">↻</button></div></div></div>
      <div class="g-detail"><span class="g-status"></span><h2 class="g-name"></h2><p class="g-system"></p><p class="g-reason"></p><p class="g-goal"></p><p class="g-date"></p><button class="g-cta"></button><details class="g-sources"><summary>${esc(tr('車型與來源'))} ↗</summary><div class="g-source-body"></div></details></div></section>
      <p class="g-result" role="status" aria-live="polite"></p><div class="g-grid"></div>
      <footer class="g-footer"><span class="g-catalog"></span> · ${esc(tr('模型製作：軌島（Q 版示意）'))}<br>${esc(tr('進度沿用旅程護照；62 款小車都有收集條件，既有車種章自動帶入。'))}<br>${esc(tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'))}</footer></main>`;
    sceneUi=false;if(scenesOn())mountSceneTab();

    // 頂列實高給 CSS 當內容的 scroll-margin-top（見 train-garage.css「避開 sticky 頂列」那條）。
    // 要看 border-box：頂列上內距是 max(12px, 瀏海安全區)，轉向時只有內距變、內容框不變，預設的觀察框收不到。
    const top=$('.g-top');resize=new ResizeObserver(()=>{dialog.style.setProperty('--g-top-h',top.getBoundingClientRect().height+'px');requestDraw();});resize.observe($('.g-view'));resize.observe(top,{box:'border-box'});
    visibility=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=0;if(inView)requestDraw();else{cancelAnimationFrame(raf);raf=0;}},{root:dialog});visibility.observe($('.g-view'));
    $('.g-close').onclick=close;
    $('.g-retry').onclick=()=>{if(!renderer)rendererPromise=startRenderer();loadSelected();};
    $('.g-demo-off').onclick=()=>{demo=false;filter='owned';refresh();};
    $('.g-demo-start').onclick=()=>{demo=true;selected='e200';resetView();filter='owned';refresh();dialog.scrollTop=0;};
    $('.g-reset').onclick=()=>{filter='all';showGrid();};
    for(const b of dialog.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;showGrid();};
    $('.g-model-select').onchange=e=>chooseModel(e.target.value);
    const turn=(horizontal,vertical=0)=>{auto=false;yaw+=horizontal;elevation=Math.max(.08,Math.min(1.48,elevation+vertical));clampView();showControls();requestDraw();};
    $('.g-left').onclick=()=>turn(-Math.PI/6);$('.g-right').onclick=()=>turn(Math.PI/6);
    $('.g-up').onclick=()=>turn(0,Math.PI/12);$('.g-down').onclick=()=>turn(0,-Math.PI/12);
    $('.g-reset-view').onclick=()=>{auto=false;resetView();showControls();requestDraw();};
    $('.g-auto').onclick=()=>{if(mode!=='model')running=!running;else auto=!auto;last=0;showControls();requestDraw();};
    $('.g-reverse').onclick=()=>{direction*=-1;showControls();requestDraw();};
    for(const b of dialog.querySelectorAll('[data-view]'))b.onclick=()=>{if(mode===b.dataset.view)return;mode=b.dataset.view;auto=false;running=mode!=='model'&&!reduced.matches;resetView();last=0;showDetail();};
    $('.g-zoom-in').onclick=()=>setZoom(zoom*1.2);$('.g-zoom-out').onclick=()=>setZoom(zoom/1.2);
    const canvas=$('.g-view');
    canvas.onkeydown=e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')setZoom(1);else setZoom(zoom*(e.key==='-'?1/1.2:1.2));return;}const directions={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.12],ArrowDown:[0,-.12]};if(directions[e.key]){e.preventDefault();turn(...directions[e.key]);}};
    const gap=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
    canvas.addEventListener('wheel',e=>{e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);setZoom(zoom*Math.exp(-Math.max(-160,Math.min(160,pixels))*.002));},{passive:false});
    canvas.onpointerdown=e=>{if(e.button>0)return;auto=false;showControls();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);if(pointers.size===1)drag={id:e.pointerId,x:e.clientX,y:e.clientY};else{drag=null;pinch={gap:Math.max(1,gap()),zoom};}};
    canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size>=2){if(pinch)setZoom(pinch.zoom*gap()/pinch.gap);}else if(drag?.id===e.pointerId){turn((e.clientX-drag.x)*.012,(drag.y-e.clientY)*.008);drag.x=e.clientX;drag.y=e.clientY;}};
    canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(!pointers.delete(e.pointerId))return;pinch=drag=null;if(pointers.size===1){const [id,p]=pointers.entries().next().value;drag={id,...p};}else if(pointers.size>=2)pinch={gap:Math.max(1,gap()),zoom};};
    refresh();
  }
  function cleanup() {
    if (!active) return;
    active = false;renderSession++;modelTicket++;loadedId='';
    closeScene(false);cancelAnimationFrame(raf);raf=0;auto=running=false;cardsUp=false;drag=pinch=null;pointers.clear();resize?.disconnect();visibility?.disconnect();
    renderer?.dispose();renderer=null;
    host?.onClose();
  }
  // iOS 15.0–15.3 沒有原生 dialog；整頁遮罩、焦點圈與 aria-hidden 提供同樣的返回流程。
  let legacyBackground=[], legacyOverflow='';
  function showDialog() {
    if(typeof dialog.showModal==='function'){dialog.showModal();return;}
    dialog.classList.add('g-legacy');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    if(!('open' in dialog))Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});
    legacyBackground=[...document.body.children].filter(el=>el!==dialog).map(el=>[el,el.getAttribute('aria-hidden')]);
    for(const [el] of legacyBackground)el.setAttribute('aria-hidden','true');
    legacyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.setAttribute('open','');
  }
  function close() {
    if(!dialog?.open)return;
    if(dialog.classList.contains('g-legacy')){
      dialog.removeAttribute('open');dialog.classList.remove('g-legacy');
      for(const [el,value] of legacyBackground)value===null?el.removeAttribute('aria-hidden'):el.setAttribute('aria-hidden',value);
      legacyBackground=[];document.body.style.overflow=legacyOverflow;
    }else dialog.close();
    cleanup();
  }
  document.addEventListener('focusin',e=>{if(dialog?.open&&dialog.classList.contains('g-legacy')&&!dialog.contains(e.target))$('.g-close').focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{
    if(!dialog?.open||!dialog.classList.contains('g-legacy'))return;
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key!=='Tab')return;
    const els=[...dialog.querySelectorAll('button,a,input,select,summary,[tabindex]')].filter(el=>!el.disabled&&el.getClientRects().length&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY'));
    const at=els.indexOf(document.activeElement),next=els[(at+(e.shiftKey?-1:1)+els.length)%els.length];
    if(next){e.preventDefault();next.focus();}
  },true);
  function open(adapter, options={}) {
    if(dialog?.open){host=adapter;refresh();return;}
    if(active)cleanup();
    host=adapter;active=true;
    if(!dialog){dialog=document.createElement('dialog');dialog.id='trainGarage';dialog.setAttribute('aria-labelledby','garageTitle');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{if(!dialog.open)cleanup();});}
    demo=!!options.demo;data();selected=demo?'e200':rows.find(r=>r.owned)?.id||'emu3000';
    filter=demo||rows.some(r=>r.owned)?'owned':'all';auto=running=false;mode='model';tab='model';loopOn=false;cardsUp=false;resetView();direction=1;distance=0;travelTime=0;period=scenePeriod();last=0;inView=true;
    rendererPromise=startRenderer();
    showDialog();build();dialog.scrollTop=0;$('.g-close').focus({preventScroll:true});requestDraw();
  }
  window.addEventListener('rail:native-back', e => {if(dialog?.open){e.preventDefault();e.stopImmediatePropagation();close();}}, {capture:true});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else requestDraw();});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog?.open){auto=running=false;showControls();requestDraw();}});
  globalThis.TrainGarage={open,close,refresh,collection,rules:RULES,goals:GOALS,get isOpen(){return !!dialog?.open;}};
})();

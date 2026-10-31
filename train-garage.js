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
  // 全畫面觀看（同 App，見 native build/garage-web-port/全螢幕-設計.md）：fsHistory＝CSS 備案推過一筆瀏覽紀錄，返回手勢靠它退出。
  let fs=false,fsScroll=0,fsHistory=false;
  let mode='model',running=false,direction=1,distance=0,travelTime=0,inView=true,period='day';
  // 第 4 格「場景」（規則照 App 的 Garage3DStage）：每款車都有預設車庫「田園小站」；分派表（train-garage-scenes.js）分到已做好那四座的
  // 12 款車另有專屬場景，照錢包（host.sceneUnlocks）鎖或不鎖。沒有錢包（沒登入、懸賞關著、展示模式）只畫預設車庫、不出切換列。
  // 已做好的四座要跟 rail-3d/garage-diorama.js 的 SCENES 一致。鎖著的專屬場景點了開兌換視窗（見下面「兌換專屬場景」）。
  const DEFAULT_SCENE='paddy',DEFAULT_PLACE='預設車庫・田園小站',BUILT_SCENES=new Set(['south-coast','alishan','viaduct','shifen']);
  // trainView＝原型的「陪它走走」（跟著車看），手機寬預設開；preferDefault＝有專屬場景的車切去預設車庫，換車就回到專屬場景。
  let trainView=false,preferDefault=false,sceneCar='',viewScene='',viewPending=false,sceneMeta=null,loadedScene='';
  // 手機預設關陰影、像素比 1（10-30 A54 量測），只用在場景頁。
  const lite=matchMedia('(pointer:coarse) and (hover:none)');
  const exclusiveScene=id=>{const s=globalThis.RailGarageScenes?.[id];return s&&BUILT_SCENES.has(s.scene)?s.scene:'';};
  // 專屬場景的地名取分派表裡 params 為空的那款（原型實際畫的那一段），同 App manifest 的 place。
  const scenePlace=scene=>scene===DEFAULT_SCENE?DEFAULT_PLACE:Object.values(globalThis.RailGarageScenes||{}).find(s=>s.scene===scene&&!Object.keys(s.params||{}).length)?.place||'';
  const shortPlace=place=>place.slice(place.lastIndexOf('・')+1);
  function sceneAccess(row){const ex=row&&exclusiveScene(row.id);if(!ex||demo)return 'hidden';const unlocked=host.sceneUnlocks?.();return unlocked?(unlocked.has(ex)?'unlocked':'locked'):'hidden';}
  function sceneOf(row){const ex=row&&exclusiveScene(row.id);return ex&&!preferDefault&&sceneAccess(row)==='unlocked'?ex:DEFAULT_SCENE;}
  const maxZoom=()=>mode==='scene'?1.8:3;
  function scenePeriod(){const now=new Date(),h=(now.getUTCHours()+8)%24+now.getUTCMinutes()/60;return h>=5&&h<7?'sunrise':h>=7&&h<17?'day':h>=17&&h<19?'sunset':'night';}
  function resetView(){zoom=1;pointers.clear();pinch=drag=null;
    // 場景頁的預設角度各座不同（SCENES 的 yaw／仰角）；模組還沒載完先用田園小站那組，載完再補一次（同 App）。
    if(mode==='scene'){viewScene=sceneOf(rows.find(r=>r.id===selected));const m=sceneMeta?.[viewScene];viewPending=!m;yaw=m?m.yaw:-1.12;elevation=trainView?(m?m.train:.5):(m?m.world:.58);return;}
    yaw=mode==='track'?-Math.PI/2:mode==='loop'?-.9:-.55;elevation=mode==='track'?.16:mode==='loop'?.8:.39;}
  function clampView(){if(mode==='loop')elevation=Math.max(.25,Math.min(1.35,elevation));if(mode==='scene')elevation=Math.max(.2,Math.min(1.2,elevation));if(mode==='track'){yaw=Math.max(-Math.PI/2-.20,Math.min(-Math.PI/2+.20,yaw));elevation=Math.max(.08,Math.min(.30,elevation));}}
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
  let renderSession = 0, modelTicket = 0, loadedId = '', loadedMode = '', rendererPromise, gridKey = '';
  async function startRenderer() {
    const session=++renderSession;
    try {
      const module=await import('./rail-3d/garage-renderer.js');
      if(!active||session!==renderSession)return;
      sceneMeta=module.SCENES;
      renderer=module.createRenderer(()=>{auto=running=false;modelTicket++;renderer?.dispose();renderer=null;loadedId='';if(dialog?.open){setFullscreen(false);$('.g-fallback').textContent=tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;$('.g-fs').hidden=true;showControls();}});
    } catch { renderer=null; }
  }
  async function loadSelected() {
    const ticket=++modelTicket, id=selected, row=rows.find(r=>r.id===id), scene=mode==='scene'?sceneOf(row):'';
    loadedId='';delete $('.g-view').dataset.rendered;
    $('.g-view').getContext('2d').clearRect(0,0,$('.g-view').width,$('.g-view').height);
    $('.g-fallback').textContent=tr(scene?'場景載入中…':'小車載入中…');$('.g-fallback').hidden=false;$('.g-retry').hidden=true;$('.g-fs').hidden=false;
    try {
      await rendererPromise;
      if(ticket!==modelTicket||!active)return;
      if(!renderer)throw Error('renderer unavailable');
      await renderer.load(id,mode,{scene,family:row?.model.family});
      if(ticket!==modelTicket||!active)return;
      loadedId=id;loadedMode=mode;loadedScene=scene;$('.g-fallback').hidden=true;
      if(scene&&viewPending){resetView();showControls();}
      requestDraw();
    } catch(e) {
      if(ticket!==modelTicket||!active||e.name==='AbortError')return;
      setFullscreen(false);$('.g-fallback').textContent=tr('小車載入失敗，請重試；收藏進度不受影響。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;$('.g-fs').hidden=true;
    }
  }
  // 全畫面時舞台是 fixed、脫離 dialog 的 containing block，IntersectionObserver（root＝dialog）會一直回不在畫面；全畫面一定看得到。
  const onScreen=()=>inView||fs;
  function requestDraw() { if (!raf && dialog?.open && onScreen() && !document.hidden) raf=requestAnimationFrame(frame); }
  function frame(at) {
    raf=0;if(!dialog.open||document.hidden||!onScreen())return;
    // 精修網格試跑最多約 30 fps；離開展示台或切到背景後不持續佔用 GPU。
    if((auto||running)&&last&&at-last<32){requestDraw();return;}
    const dt=last?Math.min((at-last)/1000,.06):0;last=at;
    if(auto&&!drag)yaw+=dt*.35;
    if(mode!=='model'&&running&&loadedId){distance+=dt*2.1*direction;travelTime+=dt;}
    const row=rows.find(r=>r.id===selected);
    if(row&&loadedId===row.id) { renderer?.draw($('.g-view'),row,yaw,{elevation,zoom,mode,distance,direction,period,time:travelTime,scene:loadedScene,trainView,lite:lite.matches}); }

    if((auto||running)&&loadedId)requestDraw();
  }
  // 舞台鋪滿畫面，頁籤、縮放、提示與控制鈕疊在上面；同一個 renderer，模式、角度、縮放與行駛時間點照舊。
  // 有 Fullscreen API 的（桌機、Android Chrome）連瀏覽器外框一起藏，Esc／返回手勢由瀏覽器退出；
  // iPhone Safari 沒有元素全畫面，只用 CSS 鋪滿，另推一筆瀏覽紀錄讓返回手勢退出。
  const FS_PATH={on:'M9 4 L9 9 L4 9 M15 4 L15 9 L20 9 M20 15 L15 15 L15 20 M9 20 L9 15 L4 15',off:'M4 9 L4 4 L9 4 M15 4 L20 4 L20 9 M20 15 L20 20 L15 20 M9 20 L4 20 L4 15'};
  const fsElement=()=>document.fullscreenElement||document.webkitFullscreenElement||null;
  let fsLeftAt=-1e9;
  function setFullscreen(on){
    if(on===fs||!dialog)return;fs=on;
    const stage=$('.g-stage');
    if(on){
      fsScroll=dialog.scrollTop;dialog.classList.add('g-full');
      const request=stage.requestFullscreen||stage.webkitRequestFullscreen,css=()=>{if(fs&&!fsHistory){history.pushState(history.state,'');fsHistory=true;}};
      if(request&&(document.fullscreenEnabled||document.webkitFullscreenEnabled))try{Promise.resolve(request.call(stage,{navigationUI:'hide'})).catch(css);}catch{css();}
      else css();
    }else{
      fsLeftAt=performance.now();dialog.classList.remove('g-full');
      if(fsElement())try{Promise.resolve((document.exitFullscreen||document.webkitExitFullscreen).call(document)).catch(()=>{});}catch{}
      if(fsHistory){fsHistory=false;history.back();}
      dialog.scrollTop=fsScroll;
    }
    const b=$('.g-fs'),label=fs?tr('退出全畫面'):tr('全畫面觀看');b.setAttribute('aria-pressed',String(fs));b.setAttribute('aria-label',label);b.title=label;
    b.querySelector('path').setAttribute('d',fs?FS_PATH.on:FS_PATH.off);requestDraw();
  }
  // Esc／返回手勢：兌換視窗開著先關它；全畫面時先退全畫面、不關車庫。瀏覽器自己退出全畫面時同一下可能再送一次 cancel，那一下也不關。
  const backOut=()=>{if(redeemScene){closeRedeem();return true;}if(fs){setFullscreen(false);return true;}return performance.now()-fsLeftAt<400;};
  function setZoom(value){zoom=Math.max(.7,Math.min(maxZoom(),value));showControls();requestDraw();}
  function showControls() {
    $('.g-zoom-in').disabled=zoom>=maxZoom();$('.g-zoom-out').disabled=zoom<=.7;$('.g-zoom-level').textContent=Math.round(zoom*100)+'%';
    dialog.classList.toggle('g-scene',mode!=='model');
    for(const b of dialog.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode));
    $('.g-reverse').hidden=mode==='model'||mode==='scene';$('.g-reverse').setAttribute('aria-pressed',String(direction===-1));
    $('.g-ride').hidden=mode!=='scene';$('.g-ride').setAttribute('aria-pressed',String(trainView));
    // 場景分頁的名字：看得到錢包的 12 款車維持專屬場景的地名，畫的是哪一座看下面的切換列（同 App）。
    const row=rows.find(r=>r.id===selected),access=sceneAccess(row),showing=sceneOf(row);
    $('[data-view="scene"]').textContent=tr(shortPlace(scenePlace(access==='hidden'?DEFAULT_SCENE:exclusiveScene(row.id))));
    const pick=$('.g-scene-pick');pick.hidden=mode!=='scene'||access==='hidden';
    $('[data-pick="default"]').setAttribute('aria-pressed',String(showing===DEFAULT_SCENE));$('[data-pick="exclusive"]').setAttribute('aria-pressed',String(showing!==DEFAULT_SCENE));
    $('[data-pick="exclusive"]').classList.toggle('g-pick-locked',access==='locked');$('[data-pick="exclusive"]').setAttribute('aria-label',tr('專屬場景')+(access==='locked'?' · '+tr('未解鎖'):''));
    $('.g-auto').setAttribute('aria-label',tr(mode!=='model'?(running?'暫停行駛':'開始行駛'):'自動旋轉'));
    $('.g-auto').setAttribute('aria-pressed',String(mode!=='model'?running:auto));$('.g-auto').textContent=(mode!=='model'?running:auto)?'Ⅱ':'▷';
    const sky=tr({sunrise:'日出',day:'藍天',sunset:'黃昏',night:'星空'}[period]);
    $('.g-view-hint').textContent=mode==='track'?tr('頭城海岸・龜山島')+' · '+sky:mode==='scene'?tr(scenePlace(showing))+' · '+sky:mode==='loop'?tr('環形試跑 · 拖曳旋轉，欣賞三節小車'):tr('上下左右拖曳，看看每一面');
  }
  function showDetail() {
    const row=rows.find(r=>r.id===selected);
    $('.g-showcase').hidden=!row;
    if(!row){auto=running=false;cancelAnimationFrame(raf);raf=0;showControls();return;}
    // 換車就回到專屬場景（同 App configure）；場景換座（解鎖、切換、換車）視角照新那座重設。
    if(row.id!==sceneCar){sceneCar=row.id;preferDefault=false;}
    if(mode==='scene'&&viewScene!==sceneOf(row))resetView();
    $('.g-view').setAttribute('aria-label',tr(row.model.name)+' · '+status(row)+' · '+(mode==='scene'?tr(shortPlace(scenePlace(sceneOf(row)))):tr(mode==='track'?'海岸行旅':mode==='loop'?'環形試跑':'近看小車')));
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
    ownTrainDetail(row);
    $('.g-source-body').replaceChildren();
    for(const text of [tr('模型製作：軌島（Q 版示意）'),tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'),tr('外觀依公開照片參考繪製；照片僅連結，未作為模型貼圖。')]) {
      const p=document.createElement('p');p.textContent=text;$('.g-source-body').append(p);
    }
    for(const source of row.model.sources||[]) {
      let url;try{url=new URL(source.url);}catch{continue;}if(!['https:','http:'].includes(url.protocol))continue;
      const p=document.createElement('p'),a=document.createElement('a');
      a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=tr('外觀參考')+' · '+tr(source.label)+' ↗';p.append(a);$('.g-source-body').append(p);
    }
    if(loadedId!==row.id||loadedMode!==mode||loadedScene!==(mode==='scene'?sceneOf(row):''))loadSelected();
    requestDraw();
  }
  // ── 自製列車:按鈕與狀態只看 host 給的資料,本檔不讀儲存。──
  // 展示模式一律不顯示:展示車不是真的入庫(同上面 g-cta 在展示模式藏起來的理由)。
  // 名字只用 textContent 放進去,而且元素標了 data-i18n-skip:名字剛好是字典鍵時也不會被翻譯。
  function ownTrainDetail(row) {
    const plan=$('.mt-g-plan'),note=$('.mt-g-note'),mine=$('.mt-g-mine'),status=$('.mt-g-status'),view=$('.mt-g-view');
    plan.hidden=note.hidden=mine.hidden=true;plan.onclick=null;view.onclick=null;
    const api=host.plan?.();
    if(!api||demo)return;
    const fam=api.familyStatus(row.model.family);
    const drivable=fam==='drivable'&&!!api.MODELS[row.id];
    if(row.owned&&(drivable||fam==='metro'||fam==='coach')){
      plan.hidden=false;plan.textContent=tr('自己排一班');plan.disabled=!drivable;
      if(drivable)plan.onclick=()=>host.ownTrainSchedule(row.id);
      else{note.hidden=false;note.textContent=fam==='metro'?tr('捷運路線下一版開放'):tr('客車要有車頭牽引，編組組裝還沒開放');}
    }
    const card=host.ownTrainCard?.()||null;
    if(!card||card.modelId!==row.id||card.issue==='model_gone')return;
    if(card.issue==='pass_required'){
      mine.hidden=false;status.textContent=tr('自製列車需要通行證；你的 {name} 存檔已保留',{name:card.name});
      view.textContent=tr('去看它');view.setAttribute('data-mt-g','view');view.onclick=()=>host.ownTrainView();
    }else if(card.issue==='station_gone'){
      mine.hidden=false;status.textContent=tr('你排的 {name} 要重新排：起站或訖站已經不在站點資料裡',{name:card.name});
      view.textContent=tr('重新排');view.setAttribute('data-mt-g','replan');view.onclick=()=>host.ownTrainReplan();
    }else if(card.issue){
      // 其他排班失敗原因(路線資料變動等)比照 station_gone,給重新排+通用原因,不讓車悄悄消失卻沒有任何提示。
      mine.hidden=false;status.textContent=tr('你排的 {name} 要重新排：路線資料有變動',{name:card.name});
      view.textContent=tr('重新排');view.setAttribute('data-mt-g','replan');view.onclick=()=>host.ownTrainReplan();
    }else if(card.from&&card.to){
      mine.hidden=false;status.textContent=tr('你的 {name} 每天 {time} 從{from}開往{to}',{name:card.name,time:card.time,from:card.from,to:card.to});
      view.textContent=tr('去看它');view.setAttribute('data-mt-g','view');view.onclick=()=>host.ownTrainView();
    }
  }
  function ownTrainHint() {
    const el=$('.mt-g-hint');
    el.classList.remove('mt-g-warn');
    el.hidden=!host.plan?.()||demo;
    if(el.hidden)return;
    const card=host.ownTrainCard?.()||null;
    if(card&&card.issue==='model_gone'){el.classList.add('mt-g-warn');el.textContent=tr('你排的 {name} 要重新排：車款已經不在車庫目錄裡',{name:card.name});}
    else el.textContent=tr('通行證專屬：已入庫的車可以自己排班上地圖');
  }
  // ── 兌換專屬場景：照 App（railcore GarageRedeemCopy＋WalletController，規格見 native build/garage-web-port/）。──
  // 網頁只有登入的人有錢包（host.wallet.uid() 空的就不出入口），只認點數制（v3）。入口兩個：最上面的「車庫場景」列、
  // 舞台第 4 格鎖著的「專屬場景」。redeemAction＝這個帳號最近一筆 {uid,scene,requestId,phase,error,cost,balance}；
  // redeemStored＝它的 pending 還在 host 的儲存裡，結果沒確認前重試都沿用同一個 requestId（伺服器靠它不重扣）。
  // redeemAck＝關視窗時看過的終局那筆，再開就不重播「已解鎖！用了…」；redeemResent＝401 後憑證好了自動重送過的那筆（只重送一次）。
  let redeemScene='',redeemAction=null,redeemStored=false,redeemAck='',redeemResent='',redeemOpener=null;
  const TERMINAL=new Set(['SUCCEEDED','ALREADY','NOT_ENOUGH','FAILED','CONFLICT_READY']),OPEN=new Set(['PENDING','RETRYABLE_FAILURE','AUTH_REQUIRED','STORAGE_FAILURE','CONFLICT_REFRESH']);
  const LOCK='<svg class="g-lock" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.6 5.2V3.9a2.4 2.4 0 0 1 4.8 0v1.3" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1.2" fill="currentColor"/></svg>';
  const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v),whole=v=>Number.isInteger(v)&&v>=0;
  // 數字照語言加千分位；單複數照 n、沒有就照 balance、再沒有就照 cost。
  const T=(key,args={})=>{const v={};for(const k in args)v[k]=new Intl.NumberFormat(host.lang()).format(args[k]);return host.t(key,v,args.n??args.balance??args.cost);};
  function walletCtx(){
    const w=host.wallet,uid=demo?'':w?.uid()||'';if(!uid)return null;
    const c=w.ledger(),scenes=w.scenes().filter(s=>BUILT_SCENES.has(s));
    const action=redeemAction?.uid===uid?redeemAction:null;
    // 舊伺服器回的是籌碼（沒有 unit:'point'）：網頁只做點數制，一律當暫時無法兌換。
    // storageBlocked：網頁只有送出前寫 pending 會寫不進去；這時四格都等，不能再開別座。
    return {uid,scenes,sale:new Set(!c||c.unit==='point'?scenes:[]),loadState:w.loadState(),action,stored:!!action&&redeemStored,storageBlocked:action?.phase==='STORAGE_FAILURE',
      ledger:c&&{balance:num(c.balance),nextCost:num(c.nextCost),unlocked:c.unlocked.map(u=>String(u&&u.scene))}};
  }
  function sceneState(ctx,scene){
    if(ctx.ledger?.unlocked.includes(scene))return 'UNLOCKED';
    if(!ctx.sale.has(scene))return 'UNAVAILABLE';
    const a=ctx.action,l=ctx.ledger;
    if(a&&a.scene===scene&&ctx.stored)return a.phase==='PENDING'?'PENDING':a.phase==='AUTH_REQUIRED'?'AUTH_REQUIRED':'FAILED';
    if(ctx.loadState==='AUTH_REQUIRED'||ctx.loadState==='WRONG_ACCOUNT')return 'AUTH_REQUIRED';
    if(ctx.loadState!=='READY'||!l||l.balance==null||l.nextCost==null||ctx.storageBlocked)return 'WAITING';
    return l.balance>=l.nextCost?'CAN_REDEEM':'NOT_ENOUGH';
  }
  function walletHeader(ctx){
    if(ctx.loadState==='AUTH_REQUIRED'||ctx.loadState==='WRONG_ACCOUNT')return T('需要登入');
    if(ctx.scenes.every(s=>ctx.ledger?.unlocked.includes(s)))return T('所有場景都已解鎖');
    const l=ctx.ledger;
    if(!l||l.balance==null||l.nextCost==null)return T(ctx.loadState==='FAILED'?'讀取失敗':'讀取中…');
    return T('目前 {balance} 點・下一座 {cost} 點',{balance:l.balance,cost:l.nextCost});
  }
  // 回 {unlocked,status,message,button,text,enabled}：status 是場景格第二行；button 是主按鈕做什麼，text 為 null 就不畫主按鈕。
  function redeemView(ctx,scene){
    const state=sceneState(ctx,scene),l=ctx.ledger,action=ctx.action,balance=l?.balance??null,cost=l?.nextCost??null;
    const status=state==='UNLOCKED'?T('已解鎖'):state==='CAN_REDEEM'?T('用 {cost} 點兌換',{cost}):state==='NOT_ENOUGH'?T('還差 {n} 點',{n:cost-balance}):
      state==='PENDING'?T('兌換處理中…'):state==='FAILED'?T('結果待確認'):state==='AUTH_REQUIRED'?T('需要登入'):state==='WAITING'?T(ctx.storageBlocked?'結果待確認':ctx.loadState==='FAILED'?'讀取失敗':'讀取中…'):T('暫時無法兌換');
    const balanceLine=balance!=null&&cost!=null?T('目前 {balance} 點，這座要 {cost} 點。',{balance,cost}):null;
    const short=(have,need)=>have!=null&&need!=null&&need>have?T('還差 {n} 點',{n:need-have}):null;
    const V=(unlocked,message,button,text,enabled)=>({unlocked,status,message,button,text,enabled});
    const byState=message=>{
      switch(state){
        case 'UNLOCKED':return V(true,message??T('這座場景已經解鎖。'),'VIEW',T('看場景'),true);
        case 'CAN_REDEEM':return V(false,message??balanceLine,'REDEEM',T('用 {cost} 點兌換',{cost}),true);
        case 'NOT_ENOUGH':return V(false,message??balanceLine,'REDEEM',short(balance,cost),false);
        case 'AUTH_REQUIRED':return V(false,message??T('需要登入才能兌換。'),'',null,false);
        case 'WAITING':return ctx.loadState==='FAILED'?V(false,message??T('讀取失敗，請稍後再試。'),'RELOAD',T('重新讀取'),true):V(false,message??T('讀取中…'),'',null,false);
        default:return V(false,T('暫時無法兌換。'),'',null,false);
      }
    };
    const a=action?.scene===scene&&!(TERMINAL.has(action.phase)&&action.requestId===redeemAck)?action:null;
    if(!a)return action&&action.scene!==scene&&OPEN.has(action.phase)&&state!=='UNLOCKED'?V(false,T('另一座場景的兌換還沒確認，請先處理那一座。'),'',null,false):byState(null);
    switch(a.phase){
      case 'PENDING':return V(false,T('兌換處理中…'),'',T('兌換處理中…'),false);
      case 'RETRYABLE_FAILURE':return V(false,T(a.error==='bounty_paused'?'懸賞暫停中，兌換結果還沒確認。稍後重試，不會重複扣。':'還沒確認兌換結果。重試會沿用同一筆兌換，不會重複扣。'),'RETRY',T('重試'),true);
      case 'AUTH_REQUIRED':return V(false,T('需要登入才能兌換。'),'',null,false);
      case 'STORAGE_FAILURE':return V(false,T('這台裝置的儲存寫入失敗，兌換結果還沒確認。'),'RETRY_STORAGE',T('重試儲存'),true);
      case 'SUCCEEDED':return byState(a.cost!=null&&a.balance!=null?T('已解鎖！用了 {cost} 點，還剩 {balance} 點。',{cost:a.cost,balance:a.balance}):T('這座場景已經解鎖。'));
      case 'ALREADY':return byState(T('這座場景之前就解鎖了，這次沒有扣除。'));
      case 'NOT_ENOUGH':{
        const line=a.balance!=null&&a.cost!=null?T('目前 {balance} 點，這座要 {cost} 點。',{balance:a.balance,cost:a.cost}):balanceLine;
        return state==='CAN_REDEEM'?byState(line):V(false,line,'REDEEM',short(a.balance,a.cost)??short(balance,cost),false);
      }
      case 'CONFLICT_REFRESH':return V(false,T('點數剛有變動，正在重新讀取…'),'',null,false);
      case 'CONFLICT_READY':return byState(T('已讀到最新點數，確認後再按一次兌換。'));
      default:return byState(T('兌換沒有完成。'));
    }
  }
  // 關了頁面又回來、上次送出的還沒確認：那一座顯示「結果待確認」＋重試，沿用同一個 requestId（同 App 重開時的 pending）。
  function restorePending(){
    const w=host.wallet,uid=demo?'':w?.uid();if(!uid||redeemAction?.uid===uid)return;
    const p=w.pending.get(),ok=p&&p.uid===uid&&typeof p.scene==='string'&&typeof p.requestId==='string';
    redeemAction=ok?{uid,scene:p.scene,requestId:p.requestId,phase:'RETRYABLE_FAILURE',error:'network_failed'}:null;redeemStored=!!ok;
  }
  function reloadWallet(){
    const w=host.wallet;if(!w?.uid())return;
    w.reload().then(()=>{
      const a=redeemAction;if(!a||a.uid!==w.uid())return;
      // 409 conflict 之後重讀：讀到了等使用者再按一次（不自動再兌換）；讀不到就收在「兌換沒有完成」＋重新讀取，不卡在讀取中。
      if(a.phase==='CONFLICT_REFRESH'){redeemAction={...a,phase:w.loadState()==='READY'?'CONFLICT_READY':'FAILED'};renderWallet();}
      // 兌換時 401、之後讀錢包又好了（憑證換新）：用同一個 requestId 自動重送，同 App resumeAfterAuthentication；只重送一次。
      else if(a.phase==='AUTH_REQUIRED'&&redeemStored&&w.loadState()==='READY'&&redeemResent!==a.requestId){redeemResent=a.requestId;sendRedeem(a);}
    });
  }
  // 200 也要驗：ok、是這一座、nth≥1、數字是 ≥0 整數、unlocked 含這座且不重複；不對就當結果沒確認（同 App bad_response）。
  function redeemOk(b,scene){
    if(!b||b.ok!==true||b.scene!==scene||!whole(b.nth)||b.nth<1||!whole(b.cost)||!whole(b.balance)||!Array.isArray(b.unlocked))return false;
    const ids=b.unlocked.map(u=>u&&u.scene);return ids.includes(scene)&&new Set(ids).size===ids.length;
  }
  function beginRedeem(ctx,scene){
    if(ctx.action&&OPEN.has(ctx.action.phase))return;
    const id=crypto.randomUUID?crypto.randomUUID():[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const p={uid:ctx.uid,scene,requestId:id};
    // 先存再送：存不進去就不送（不然回應掉了就沒辦法用同一個 requestId 重試）。
    if(!host.wallet.pending.set(p)){redeemAction={...p,phase:'STORAGE_FAILURE'};redeemStored=false;renderWallet();return;}
    redeemStored=true;sendRedeem(p);
  }
  // 每種回應怎麼處理照 App WalletController（規格 1.6）：結果沒確認（網路、逾時、429、5xx、回應壞掉）留著 pending 等使用者按重試；
  // 有結論的（成功、already、not_enough、conflict、其他 4xx）清掉 pending。
  async function sendRedeem(p){
    const w=host.wallet,base={uid:p.uid,scene:p.scene,requestId:p.requestId};
    redeemAction={...base,phase:'PENDING'};renderWallet();
    const {status,body}=await w.redeem(p.scene,p.requestId);
    if(redeemAction?.requestId!==p.requestId||w.uid()!==p.uid)return; // 回來時人換了，或這筆已經被取代
    const e=body&&typeof body==='object'?body.error:undefined,set=(phase,extra)=>{redeemAction={...base,phase,...extra};},done=()=>{w.pending.clear();redeemStored=false;};
    if(status===200&&redeemOk(body,p.scene)){set('SUCCEEDED',{cost:body.cost,balance:body.balance});done();w.patch({balance:body.balance,unlocked:body.unlocked,nextCost:null});reloadWallet();}
    else if(status===401){set('AUTH_REQUIRED');reloadWallet();}
    else if(status===403&&e==='wrong_account'){set('FAILED',{error:e});done();w.wrongAccount();}
    else if(status===409&&e==='already'){set('ALREADY');done();const l=w.ledger();if(l&&!l.unlocked.some(u=>u?.scene===p.scene))w.patch({unlocked:[...l.unlocked,{scene:p.scene}]});reloadWallet();}
    else if(status===409&&e==='not_enough'){set('NOT_ENOUGH',{cost:num(body.cost),balance:num(body.balance)});done();if(num(body.cost)!=null&&num(body.balance)!=null)w.patch({balance:num(body.balance),nextCost:num(body.cost)});}
    else if(status===409&&e==='conflict'){set('CONFLICT_REFRESH');done();w.patch({nextCost:null});reloadWallet();}
    else if(status===0||status===429||status>=500||status===200||!e)set('RETRYABLE_FAILURE',{error:e||'network_failed'});
    else{set('FAILED',{error:e});done();}
    renderWallet();
  }
  function redeemDo(kind){
    const ctx=walletCtx(),a=ctx?.action;if(!ctx)return;
    if(kind==='REDEEM')beginRedeem(ctx,redeemScene);
    else if(kind==='RETRY'&&a?.phase==='RETRYABLE_FAILURE')sendRedeem(a);
    // 存不進去那筆還沒送出：存成功就照原本的意思送出去（同一個 requestId）。
    else if(kind==='RETRY_STORAGE'&&a?.phase==='STORAGE_FAILURE'){if(host.wallet.pending.set({uid:a.uid,scene:a.scene,requestId:a.requestId})){redeemStored=true;sendRedeem(a);}}
    else if(kind==='RELOAD')reloadWallet();
    else if(kind==='VIEW')goScene(redeemScene);
  }
  function showScenes(){
    restorePending();
    const box=$('.g-scenes'),ctx=walletCtx();
    box.hidden=!ctx||!ctx.scenes.length;
    if(box.hidden){if(redeemScene)closeRedeem();return;}
    $('.g-scenes-head').textContent=walletHeader(ctx);
    const list=$('.g-scenes-list');
    if(list.dataset.key!==ctx.scenes.join()){list.dataset.key=ctx.scenes.join();list.replaceChildren(...ctx.scenes.map(scene=>{
      const b=document.createElement('button');b.type='button';b.className='g-sc';b.dataset.scene=scene;b.onclick=()=>openRedeem(scene,b);return b;}));}
    for(const b of list.children){
      const scene=b.dataset.scene,v=redeemView(ctx,scene),place=scenePlace(scene);
      b.classList.toggle('on',v.unlocked);b.setAttribute('aria-label',tr(place)+' · '+v.status);
      b.innerHTML=`<b>${v.unlocked?'':LOCK}${esc(tr(shortPlace(place)))}</b><small>${esc(v.status)}</small>`;
    }
    if(redeemScene)showRedeem();
  }
  function showRedeem(){
    const ctx=walletCtx();if(!ctx){closeRedeem();return;}
    const v=redeemView(ctx,redeemScene),place=scenePlace(redeemScene);
    $('.g-redeem h2').textContent=v.unlocked?tr(place):tr('解鎖「{place}」',{place:tr(place)});
    $('.g-redeem-desc').textContent=tr('永久解鎖這座場景。選到在這裡跑的車款時，在舞台的「{tab}」分頁切到「專屬場景」就能看。',{tab:tr(shortPlace(place))});
    const msg=$('.g-redeem-msg'),go=$('.g-redeem-go');msg.hidden=!v.message;msg.textContent=v.message||'';
    go.hidden=!v.text;go.textContent=v.text||'';go.disabled=!v.enabled;go.dataset.do=v.button;
  }
  function renderWallet(){if(dialog?.open){showScenes();showControls();}}
  function openRedeem(scene,opener){
    if(!scene)return;
    setFullscreen(false);redeemScene=scene;redeemOpener=opener;
    $('.g-top').inert=$('.g-main').inert=true;$('.g-redeem').hidden=false;showRedeem();
    $('.g-redeem-card').focus({preventScroll:true});
    // 每次開窗都讀一次最新點數（同 App 開視窗時 refresh；正在讀就不再發）。
    if(host.wallet.loadState()!=='LOADING')reloadWallet();
  }
  function closeRedeem(){
    if(!redeemScene)return;
    // 終局那筆看過就不再重播（同 App acknowledged）；處理中、待確認的下次開窗照樣看到。
    const a=redeemAction;if(a&&a.scene===redeemScene&&TERMINAL.has(a.phase))redeemAck=a.requestId;
    redeemScene='';$('.g-redeem').hidden=true;$('.g-top').inert=$('.g-main').inert=false;
    if(redeemOpener?.isConnected)redeemOpener.focus({preventScroll:true});redeemOpener=null;
  }
  // 看場景（同 App）：關視窗；目前的車不在這座就改選這座的車（先挑已入庫的、不然目錄第一款；不在目前篩選裡就切回全部車款），
  // 舞台切到第 4 格的專屬場景，捲回篩選列。
  function goScene(scene){
    closeRedeem();
    const cars=rows.filter(r=>exclusiveScene(r.id)===scene),inFilter=r=>filter==='all'||(filter==='owned'?r.owned:r.rule&&!r.owned);
    if(!cars.some(r=>r.id===selected)){const pick=cars.find(r=>r.owned)||cars[0];if(pick){selected=pick.id;if(!inFilter(pick))filter='all';}}
    mode='scene';auto=false;running=!reduced.matches;preferDefault=false;sceneCar=selected;resetView();last=0;
    showGrid();$('.g-filters').scrollIntoView({block:'start',behavior:'instant'});
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
    // host 每次重畫護照都會呼叫 refresh（登入的人回前景同步完就一次）：卡片與選單內容沒變就不重建，
    // 整批換掉 62 張縮圖會讓手機重新解碼、閃一下。
    const key=dialog.lang+'|'+filter+'|'+list.map(r=>r.id+(r.owned?'+':'-')).join(),picker=$('.g-model-select');
    if(key!==gridKey){gridKey=key;
      picker.replaceChildren();picker.disabled=!list.length;
      for(const sys of new Set(list.map(r=>r.model.system))) {
        const group=document.createElement('optgroup');group.label=tr(sys);
        for(const row of list.filter(r=>r.model.system===sys)) {
          const option=document.createElement('option');option.value=row.id;option.textContent=tr(row.model.name)+' · '+status(row);group.append(option);
        }
        picker.append(group);
      }
      if(!list.length){const option=document.createElement('option');option.textContent=tr('沒有符合條件的車款。');option.value='';picker.append(option);}
      $('.g-grid').replaceChildren();
      for(const row of list) {
        const b=document.createElement('button');b.type='button';b.className=row.owned?'g-car':'g-car g-locked';b.dataset.model=row.id;b.setAttribute('aria-pressed',String(selected===row.id));
        b.setAttribute('aria-label',tr(row.model.name)+' · '+status(row));
        b.innerHTML=`<span class="g-check" aria-hidden="true">${row.owned?'✓':'○'}</span><img src="${esc(row.model.thumbnail)}" alt="" loading="lazy" width="320" height="200"><b>${esc(tr(row.model.name))}</b><small>${esc(status(row))}</small>`;
        b.onclick=()=>{chooseModel(row.id);$('.g-filters').scrollIntoView({block:'start',behavior:'instant'});$('.g-model-select').focus({preventScroll:true});};
        $('.g-grid').append(b);
      }
    }
    picker.value=selected||'';
    for(const el of dialog.querySelectorAll('.g-car'))el.setAttribute('aria-pressed',String(el.dataset.model===selected));
    $('.g-result').textContent=tr('{count} 款車車',{count:list.length});
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
    ownTrainHint();showScenes();
    if(!rows.some(r=>r.id===selected))selected=rows.find(r=>r.owned)?.id||rows.find(r=>r.rule)?.id;
    showGrid();
  }
  function build() {
    setFullscreen(false);data();resize?.disconnect();visibility?.disconnect();pointers.clear();pinch=drag=null;inView=true;gridKey='';redeemScene='';redeemOpener=null;
    dialog.lang=host.lang();
    dialog.classList.toggle('dark',host.dark());
    dialog.innerHTML=`<header class="g-top"><span class="g-brand">RAIL ISLAND / COLLECTION</span><button class="g-close" autofocus>${esc(tr('回到地圖'))} ↗</button></header>
      <main class="g-main"><div class="g-heading"><h1 id="garageTitle">${esc(tr('我的車庫'))}</h1>
      <div class="g-progress"><strong class="g-count">0</strong><span class="g-total"></span><progress max="1" value="0"></progress><span>${esc(tr('可收集車款'))}</span></div></div>
      <p class="mt-g-hint" data-mt-g="hint" hidden data-i18n-skip></p>
      <div class="g-demo" hidden><span>${esc(tr('展示模式・不計入收藏'))}</span><button class="g-demo-off"></button></div>
      <section class="g-scenes" hidden aria-labelledby="gScenesTitle"><div class="g-scenes-bar"><h2 id="gScenesTitle">${esc(tr('車庫場景'))}</h2><span class="g-scenes-head"></span></div><div class="g-scenes-list"></div></section>
      <div class="g-filters"><div class="g-tabs">${[['all','全部車款'],['owned','已入庫'],['pending','待收集']].map(([id,text])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${esc(tr(text))}</button>`).join('')}</div>
      <label class="g-picker"><span>${esc(tr('選擇車款'))}</span><select class="g-model-select"></select></label></div>
      <div class="g-empty" hidden><p class="g-empty-text"></p><button class="g-reset">${esc(tr('查看所有車款'))}</button><button class="g-demo-start">${esc(tr('看看展示車庫'))}</button></div>
      <section class="g-showcase" aria-label="${esc(tr('車型展示'))}"><div class="g-stage"><div class="g-scene-bar"><div class="g-scene-tabs">${[['model','近看小車'],['loop','環形試跑'],['track','海岸行旅'],['scene','田園小站']].map(([id,label])=>`<button data-view="${id}" aria-pressed="${mode===id}">${esc(tr(label))}</button>`).join('')}</div><button class="g-reverse" hidden aria-pressed="false" title="${esc(tr('反向行駛'))}" aria-label="${esc(tr('反向行駛'))}">⇄</button><button class="g-ride" hidden aria-pressed="false">${esc(tr('陪它走走'))}</button></div>
      <div class="g-scene-pick" hidden><button data-pick="default" aria-pressed="true">${esc(tr('預設車庫'))}</button><button data-pick="exclusive" aria-pressed="false">${LOCK}${esc(tr('專屬場景'))}</button></div><div class="g-viewport"><canvas class="g-view" tabindex="0" role="img"></canvas><div class="g-zoom"><button class="g-zoom-in" title="${esc(tr('放大場景'))}" aria-label="${esc(tr('放大場景'))}">+</button><output class="g-zoom-level" aria-label="${esc(tr('縮放比例'))}">100%</output><button class="g-zoom-out" title="${esc(tr('縮小場景'))}" aria-label="${esc(tr('縮小場景'))}">−</button></div><button class="g-fs" type="button" aria-pressed="false" title="${esc(tr('全畫面觀看'))}" aria-label="${esc(tr('全畫面觀看'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${FS_PATH.off}"/></svg></button></div><div class="g-fallback" hidden>${esc(tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。'))}</div>
      <div class="g-stage-foot"><span class="g-view-hint"></span><div class="g-controls"><button class="g-left" title="${esc(tr('向左旋轉'))}" aria-label="${esc(tr('向左旋轉'))}">↶</button><button class="g-auto" aria-label="${esc(tr('自動旋轉'))}" aria-pressed="false">▷</button><button class="g-right" title="${esc(tr('向右旋轉'))}" aria-label="${esc(tr('向右旋轉'))}">↷</button><button class="g-up" title="${esc(tr('提高視角'))}" aria-label="${esc(tr('提高視角'))}">↑</button><button class="g-down" title="${esc(tr('降低視角'))}" aria-label="${esc(tr('降低視角'))}">↓</button><button class="g-reset-view" title="${esc(tr('重設視角'))}" aria-label="${esc(tr('重設視角'))}">⌂</button><button class="g-retry" hidden aria-label="${esc(tr('重新載入小車'))}">↻</button></div></div></div>
      <div class="g-detail"><span class="g-status"></span><h2 class="g-name"></h2><p class="g-system"></p><p class="g-reason"></p><p class="g-goal"></p><p class="g-date"></p><button class="g-cta"></button><button class="mt-g-plan" type="button" data-mt-g="schedule" hidden></button><p class="mt-g-note" data-mt-g="note" hidden></p><div class="mt-g-mine" hidden><p class="mt-g-status" data-mt-g="status" data-i18n-skip></p><button class="mt-g-view" type="button" data-mt-g="view"></button></div><details class="g-sources"><summary>${esc(tr('車型與來源'))} ↗</summary><div class="g-source-body"></div></details></div></section>
      <p class="g-result" role="status" aria-live="polite"></p><div class="g-grid"></div>
      <footer class="g-footer"><span class="g-catalog"></span> · ${esc(tr('模型製作：軌島（Q 版示意）'))}<br>${esc(tr('進度沿用旅程護照；62 款小車都有收集條件，既有車種章自動帶入。'))}<br>${esc(tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'))}</footer></main>
      <div class="g-redeem" hidden><div class="g-redeem-card" role="dialog" aria-modal="true" aria-labelledby="gRedeemTitle" tabindex="-1"><h2 id="gRedeemTitle"></h2><p class="g-redeem-desc"></p><p class="g-redeem-msg" role="status"></p><button class="g-redeem-go" type="button"></button><button class="g-redeem-close" type="button">${esc(tr('關閉'))}</button></div></div>`;

    // 頂列實高給 CSS 當內容的 scroll-margin-top（見 train-garage.css「避開 sticky 頂列」那條）。
    // 要看 border-box：頂列上內距是 max(12px, 瀏海安全區)，轉向時只有內距變、內容框不變，預設的觀察框收不到。
    const top=$('.g-top');resize=new ResizeObserver(()=>{dialog.style.setProperty('--g-top-h',top.getBoundingClientRect().height+'px');requestDraw();});resize.observe($('.g-view'));resize.observe(top,{box:'border-box'});
    visibility=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=0;if(onScreen())requestDraw();else{cancelAnimationFrame(raf);raf=0;}},{root:dialog});visibility.observe($('.g-view'));
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
    $('.g-ride').onclick=()=>{trainView=!trainView;resetView();showControls();requestDraw();};
    $('[data-pick="default"]').onclick=()=>{preferDefault=true;showDetail();};
    // 鎖著的專屬場景：開這款車那一座的兌換視窗（全畫面時先退出，視窗在舞台外面）；解鎖了就直接切過去（同 App）。
    $('[data-pick="exclusive"]').onclick=e=>{const row=rows.find(r=>r.id===selected);if(sceneAccess(row)==='locked'){openRedeem(exclusiveScene(row.id),e.currentTarget);return;}preferDefault=false;showDetail();};
    for(const b of dialog.querySelectorAll('[data-view]'))b.onclick=()=>{if(mode===b.dataset.view)return;mode=b.dataset.view;auto=false;running=mode!=='model'&&!reduced.matches;resetView();last=0;showDetail();};
    $('.g-redeem-go').onclick=e=>redeemDo(e.currentTarget.dataset.do);$('.g-redeem-close').onclick=closeRedeem;
    $('.g-redeem').onclick=e=>{if(e.target===e.currentTarget)closeRedeem();};
    $('.g-fs').onclick=()=>setFullscreen(!fs);
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
    active = false;renderSession++;modelTicket++;loadedId='';setFullscreen(false);
    cancelAnimationFrame(raf);raf=0;auto=running=false;drag=pinch=null;pointers.clear();resize?.disconnect();visibility?.disconnect();
    renderer?.trim();
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
    closeRedeem();setFullscreen(false);
    if(dialog.classList.contains('g-legacy')){
      dialog.removeAttribute('open');dialog.classList.remove('g-legacy');
      for(const [el,value] of legacyBackground)value===null?el.removeAttribute('aria-hidden'):el.setAttribute('aria-hidden',value);
      legacyBackground=[];document.body.style.overflow=legacyOverflow;
    }else dialog.close();
    cleanup();
  }
  document.addEventListener('focusin',e=>{if(dialog?.open&&dialog.classList.contains('g-legacy')&&!dialog.contains(e.target))$('.g-close').focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{
    // 兌換視窗的 Esc 在按鍵這一下就處理掉：Chrome 擋 modal dialog 的 cancel 要有新的使用者操作，連按幾次之後擋不住，車庫會整個關掉。
    if(dialog?.open&&redeemScene&&e.key==='Escape'){e.preventDefault();closeRedeem();return;}
    if(!dialog?.open||!dialog.classList.contains('g-legacy'))return;
    if(e.key==='Escape'){e.preventDefault();if(!backOut())close();return;}
    if(e.key!=='Tab')return;
    const els=[...dialog.querySelectorAll('button,a,input,select,summary,[tabindex]')].filter(el=>!el.disabled&&el.getClientRects().length&&!el.closest('[inert]')&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY'));
    const at=els.indexOf(document.activeElement),next=els[(at+(e.shiftKey?-1:1)+els.length)%els.length];
    if(next){e.preventDefault();next.focus();}
  },true);
  function open(adapter, options={}) {
    if(dialog?.open){host=adapter;refresh();return;}
    if(active)cleanup();
    host=adapter;active=true;
    if(!dialog){dialog=document.createElement('dialog');dialog.id='trainGarage';dialog.setAttribute('aria-labelledby','garageTitle');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();if(!backOut())close();});dialog.addEventListener('close',()=>{if(!dialog.open)cleanup();});}
    demo=!!options.demo;data();selected=demo?'e200':rows.find(r=>r.owned)?.id||'emu3000';
    filter=demo||rows.some(r=>r.owned)?'owned':'all';auto=running=false;mode='model';resetView();direction=1;distance=0;travelTime=0;period=scenePeriod();last=0;inView=true;
    trainView=innerWidth<=800;preferDefault=false;sceneCar=viewScene='';
    rendererPromise=renderer?Promise.resolve():startRenderer();
    showDialog();build();dialog.scrollTop=0;$('.g-close').focus({preventScroll:true});requestDraw();
    reloadWallet(); // 「車庫場景」列出現時讀一次最新點數（同 App）；沒登入、懸賞關著時什麼都不做
  }
  window.addEventListener('rail:native-back', e => {if(dialog?.open){e.preventDefault();e.stopImmediatePropagation();if(!backOut())close();}}, {capture:true});
  for(const type of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(type,()=>{if(fs&&!fsHistory&&!fsElement())setFullscreen(false);});
  window.addEventListener('popstate',()=>{if(fsHistory){fsHistory=false;setFullscreen(false);}});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else requestDraw();});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog?.open){auto=running=false;showControls();requestDraw();}});
  globalThis.TrainGarage={open,close,refresh,collection,rules:RULES,goals:GOALS,get isOpen(){return !!dialog?.open;}};
})();

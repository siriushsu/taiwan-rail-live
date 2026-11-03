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
  // 第 4 格「場景」開場景頁（三端同一套規則）：場景是主角，畫哪一座看 frameScene，不由車款推；頁上一排場景鈕就地換座。
  // 預設車庫「田園小站」每款車都能跑、永遠能進；已做好的四座只跑分派表（train-garage-scenes.js）分到那座的車，照錢包的已解鎖清單進，
  // 鎖著的點了開兌換視窗（見下面「兌換專屬場景」）。沒有錢包（沒登入、展示模式）只有田園小站，不出場景列與場景鈕。
  // 已做好的四座要跟 rail-3d/garage-diorama.js 的 SCENES 一致。
  const DEFAULT_SCENE='paddy',DEFAULT_PLACE='預設車庫・田園小站',BUILT_SCENES=new Set(['south-coast','alishan','viaduct','shifen']);
  // 場景格、場景鈕用的短名（阿里山那座用線名，不用它畫的那段「之字形」）。
  const SCENE_SHORT={paddy:'田園小站','south-coast':'南迴海岸',shifen:'十分老街',viaduct:'站前街',alishan:'阿里山林鐵'};
  // trainView＝原型的「陪它走走」（跟著車看），手機寬預設開。frameCars＝這次開著場景頁時各座最後看的車：換座時記下，每次打開場景頁清空。
  let trainView=false,frameScene='',frameCars=new Map(),viewScene='',viewPending=false,sceneMeta=null,loadedScene='';
  // 第 4 格點下去開「場景頁」：蓋住整個車庫的 9-29 外框頁（網頁分支 garage/scene-03 的 garage-scene.html；規格與對照稿在
  // native build/garage-web-port/scene-frame-mock/）。開著時 mode＝'scene'，frameBack＝點之前那一格，離開就回到那一格。
  // 各座文字：全景鈕、三個時段（白天／黃昏／夜晚）、載入字、最底說明；前四座照 9-29，田園小站是新寫的。
  // rowScroll＝下次畫場景鈕列時把選中那格捲進畫面（開頁、換座時）。
  let frameBack='',rowScroll=false;
  const tab=()=>frameBack||mode;
  const FRAME_PERIODS=['day','sunset','night'],FRAME_TEXT={
    'south-coast':['山海全景',['晴日','夕照','入夜'],'正在把小車搬到海邊…','南迴海岸 · 微縮印象'],
    viaduct:['高架全景',['平原晴日','黃昏側光','月台夜燈'],'正在把小車送上高架…','西部幹線高架 · 微縮印象'],
    shifen:['老街全景',['山谷晴日','黃昏放燈','老街夜燈'],'正在把小車開進老街…','平溪線十分老街 · 微縮印象'],
    alishan:['山林全景',['山中晴日','午後斜光','林間夜色'],'正在把小車帶進森林…','阿里山林鐵 · 微縮印象'],
    paddy:['田園全景',['稻田晴日','黃昏收工','小站夜燈'],'正在把小車開進田園小站…','田園小站 · 微縮印象'],
  };
  // 手機預設關陰影、像素比 1（10-30 A54 量測），只用在場景頁。
  const lite=matchMedia('(pointer:coarse) and (hover:none)');
  const exclusiveScene=id=>{const s=globalThis.RailGarageScenes?.[id];return s&&BUILT_SCENES.has(s.scene)?s.scene:'';};
  // 專屬場景的地名取分派表裡 params 為空的那款（原型實際畫的那一段），同 App manifest 的 place。
  const scenePlace=scene=>scene===DEFAULT_SCENE?DEFAULT_PLACE:Object.values(globalThis.RailGarageScenes||{}).find(s=>s.scene===scene&&!Object.keys(s.params||{}).length)?.place||'';
  // 場景清單：田園小站排第一，後面是錢包裡可兌換、這裡也做好的那幾座。能進＝田園小站，或錢包的已解鎖清單有它。
  const sceneList=ctx=>ctx?[DEFAULT_SCENE,...ctx.scenes]:[DEFAULT_SCENE];
  const sceneOpen=(ctx,scene)=>scene===DEFAULT_SCENE||!!ctx?.ledger?.unlocked.includes(scene);
  // 每座跑的車：田園小站＝全部車款，其他＝分派表分到那座的；已入庫的排前面，其餘照目錄順序。
  function roster(scene){const cars=scene===DEFAULT_SCENE?rows:rows.filter(r=>exclusiveScene(r.id)===scene);return [...cars.filter(r=>r.owned),...cars.filter(r=>!r.owned)];}
  // 換到某座時選哪台車：這次在那座最後看的 > 目前的車（跑得了那座的話）> 那座第一款已入庫的 > 那座第一款。
  function pickCar(scene){const cars=roster(scene),had=frameCars.get(scene);return (cars.find(r=>r.id===had)||cars.find(r=>r.id===selected)||cars[0])?.id;}
  const inFilter=r=>filter==='all'||(filter==='owned'?r.owned:r.rule&&!r.owned);
  const maxZoom=()=>mode==='scene'?1.8:3;
  function scenePeriod(){const now=new Date(),h=(now.getUTCHours()+8)%24+now.getUTCMinutes()/60;return h>=5&&h<7?'sunrise':h>=7&&h<17?'day':h>=17&&h<19?'sunset':'night';}
  // 時段選擇，記在這台裝置：auto＝照台灣時間（scenePeriod），其餘固定。舞台只有海岸行旅有天色，選單只在那一格出現；場景頁開時用它當起點，頁上的時段鈕照舊、只管開著的這段。
  const PERIOD_KEY='trainmap-garage-period-v1',PERIOD_CHOICES=[['auto','自動'],['sunrise','日出'],['day','藍天'],['sunset','黃昏'],['night','星空']];
  let periodChoice='auto';
  function savedPeriodChoice(){try{const v=localStorage.getItem(PERIOD_KEY);if(PERIOD_CHOICES.some(([id])=>id===v))return v;}catch{}return 'auto';}
  const pickedPeriod=()=>periodChoice==='auto'?scenePeriod():periodChoice;
  function resetView(){zoom=1;pointers.clear();pinch=drag=null;
    // 場景頁的預設角度各座不同（SCENES 的 yaw／仰角）；模組還沒載完先用田園小站那組，載完再補一次（同 App）。
    if(mode==='scene'){viewScene=frameScene;const m=sceneMeta?.[viewScene];viewPending=!m;yaw=m?m.yaw:-1.12;elevation=trainView?(m?m.train:.5):(m?m.world:.58);return;}
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
      renderer=module.createRenderer(()=>{auto=running=false;modelTicket++;renderer?.dispose();renderer=null;loadedId='';if(dialog?.open){setFullscreen(false);$('.g-fallback').textContent=tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;$('.g-fs').hidden=true;if(frameBack)frameNotice(tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。'),true);showControls();}});
    } catch { renderer=null; }
  }
  async function loadSelected() {
    const ticket=++modelTicket, id=selected, row=rows.find(r=>r.id===id), scene=mode==='scene'?frameScene:'', view=$(scene?'.g-sf-view':'.g-view');
    loadedId='';delete view.dataset.rendered;
    view.getContext('2d').clearRect(0,0,view.width,view.height);
    if(scene)frameNotice(tr(FRAME_TEXT[scene][2]));
    else{$('.g-fallback').textContent=tr('小車載入中…');$('.g-fallback').hidden=false;$('.g-retry').hidden=true;$('.g-fs').hidden=false;}
    try {
      await rendererPromise;
      if(ticket!==modelTicket||!active)return;
      if(!renderer)throw Error('renderer unavailable');
      await renderer.load(id,mode,{scene,family:row?.model.family});
      if(ticket!==modelTicket||!active)return;
      loadedId=id;loadedMode=mode;loadedScene=scene;$(scene?'.g-sf-loading':'.g-fallback').hidden=true;
      if(scene&&viewPending){resetView();showControls();}
      requestDraw();
    } catch(e) {
      if(ticket!==modelTicket||!active||e.name==='AbortError')return;
      if(scene){frameNotice(tr('小車載入失敗，請重試；收藏進度不受影響。'),true);return;}
      setFullscreen(false);$('.g-fallback').textContent=tr('小車載入失敗，請重試；收藏進度不受影響。');$('.g-fallback').hidden=false;$('.g-retry').hidden=false;$('.g-fs').hidden=true;
    }
  }
  // 場景頁的載入字／失敗字蓋在 3D 畫面上；失敗多一顆重新載入。
  function frameNotice(text,failed=false){$('.g-sf-loading').hidden=false;$('.g-sf-loading span').textContent=text;$('.g-sf-retry').hidden=!failed;}
  // 全畫面時舞台是 fixed、脫離 dialog 的 containing block，IntersectionObserver（root＝dialog）會一直回不在畫面；全畫面一定看得到。
  const onScreen=()=>inView||fs||!!frameBack;
  function requestDraw() { if (!raf && dialog?.open && onScreen() && !document.hidden) raf=requestAnimationFrame(frame); }
  function frame(at) {
    raf=0;if(!dialog.open||document.hidden||!onScreen())return;
    // 精修網格試跑最多約 30 fps；離開展示台或切到背景後不持續佔用 GPU。
    if((auto||running)&&last&&at-last<32){requestDraw();return;}
    const dt=last?Math.min((at-last)/1000,.06):0;last=at;
    if(auto&&!drag)yaw+=dt*.35;
    if(mode!=='model'&&running&&loadedId){distance+=dt*2.1*direction;travelTime+=dt;}
    const row=rows.find(r=>r.id===selected);
    if(row&&loadedId===row.id) { renderer?.draw($(frameBack?'.g-sf-view':'.g-view'),row,yaw,{elevation,zoom,mode,distance,direction,period,time:travelTime,scene:loadedScene,trainView,lite:lite.matches}); }

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
  // Esc／返回手勢：兌換視窗開著先關它，再來是車款選單、場景頁；全畫面時先退全畫面、不關車庫。瀏覽器自己退出全畫面時同一下可能再送一次 cancel，那一下也不關。
  const backOut=()=>{if(redeemScene){closeRedeem();return true;}if(closeCars(true))return true;if(frameBack){closeFrame();return true;}if(fs){setFullscreen(false);return true;}return performance.now()-fsLeftAt<400;};
  // 開場景頁到 scene（開著就就地換座，先記下離開那座最後看的車），車照 pickCar。時段從記著的天色選擇起（自動＝台灣時間；日出併進黃昏那顆），
  // 開著時手動選的留到離開；呼叫的人接著 showDetail 載入這座。
  function openFrame(scene){
    if(!frameBack){
      setFullscreen(false);frameBack=mode;mode='scene';auto=false;running=!reduced.matches;last=0;frameCars=new Map();rowScroll=true;
      const p=pickedPeriod();period=FRAME_PERIODS.includes(p)?p:'sunset';
      dialog.classList.add('g-sf-open');$('.g-top').inert=$('.g-main').inert=true;$('.g-sf').hidden=false;$('.g-sf-leave').focus({preventScroll:true});
    }else if(frameScene!==scene){frameCars.set(frameScene,selected);rowScroll=true;}
    frameScene=scene;selected=pickCar(scene)||selected;closeCars();resetView();
  }
  // 場景頁最後看的車不在目前的篩選裡（例如篩選「已入庫」、車是待收集）才切回全部車款，首頁的選擇跟著它。
  function keepFrameCar(){const row=rows.find(r=>r.id===selected);if(row&&!inFilter(row))filter='all';}
  function closeFrame(){
    if(!frameBack)return;
    closeCars();mode=frameBack;frameBack='';frameScene='';auto=false;running=mode!=='model'&&!reduced.matches;period=pickedPeriod();resetView();last=0;
    dialog.classList.remove('g-sf-open');$('.g-sf').hidden=true;$('.g-top').inert=$('.g-main').inert=false;
    keepFrameCar();showGrid();$('[data-view="scene"]').focus({preventScroll:true});
  }
  // 車款選單：場景頁標題那塊點了打開，只列這座跑的車，選了就地換車、場景不變。點外面、Esc、選了、換座、離開都會關。
  function openCars(){
    const list=$('.g-sf-car-list'),menu=$('.g-sf-cars'),title=$('.g-sf-title');
    list.replaceChildren(...roster(frameScene).map(row=>{
      const b=document.createElement('button');b.type='button';b.dataset.car=row.id;b.setAttribute('aria-pressed',String(row.id===selected));
      b.innerHTML=`<b>${esc(tr(row.model.name))}</b><small>${esc(status(row))}</small>`;
      b.onclick=()=>{closeCars(true);if(row.id!==selected){selected=row.id;showDetail();}};return b;}));
    menu.style.top=(title.getBoundingClientRect().bottom-$('.g-sf').getBoundingClientRect().top+4)+'px';
    menu.hidden=false;title.setAttribute('aria-expanded','true');
    const on=list.querySelector('[aria-pressed="true"]')||list.firstElementChild;
    if(on){list.scrollTop=Math.max(0,on.offsetTop-(list.clientHeight-on.offsetHeight)/2);on.focus({preventScroll:true});}
  }
  function closeCars(refocus=false){
    const menu=dialog&&$('.g-sf-cars');if(!menu||menu.hidden)return false;
    menu.hidden=true;$('.g-sf-title').setAttribute('aria-expanded','false');if(refocus)$('.g-sf-title').focus({preventScroll:true});return true;
  }
  function setZoom(value){zoom=Math.max(.7,Math.min(maxZoom(),value));showControls();requestDraw();}
  function showControls() {
    $('.g-zoom-in').disabled=zoom>=maxZoom();$('.g-zoom-out').disabled=zoom<=.7;$('.g-zoom-level').textContent=Math.round(zoom*100)+'%';
    // 舞台照車庫停著的那一格（場景頁開著時是點之前那一格）。
    const at=tab();
    dialog.classList.toggle('g-scene',at!=='model');
    for(const b of dialog.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===at));
    $('.g-reverse').hidden=at==='model';$('.g-reverse').setAttribute('aria-pressed',String(direction===-1));
    const row=rows.find(r=>r.id===selected);
    $('.g-auto').setAttribute('aria-label',tr(mode!=='model'?(running?'暫停行駛':'開始行駛'):'自動旋轉'));
    $('.g-auto').setAttribute('aria-pressed',String(mode!=='model'?running:auto));$('.g-auto').textContent=(mode!=='model'?running:auto)?'Ⅱ':'▷';
    $('.g-period').hidden=at!=='track';$('.g-period-select').value=periodChoice;
    const sky=tr({sunrise:'日出',day:'藍天',sunset:'黃昏',night:'星空'}[period]);
    $('.g-view-hint').textContent=at==='track'?tr('頭城海岸・龜山島')+' · '+sky:at==='loop'?tr('環形試跑 · 拖曳旋轉，欣賞三節小車'):tr('上下左右拖曳，看看每一面');
    if(frameBack)showFrame(row);
  }
  // 場景頁：標題那塊是這座的地名＋車名・狀態，這座跑的車不只一款時整塊是車款選單的按鈕（加 ▾）。
  // 有錢包時標題下一排場景鈕：能進的就地換座，鎖著的帶鎖、點了開兌換視窗（疊在場景頁上）。
  function showFrame(row){
    const [world,periods,,caption]=FRAME_TEXT[frameScene],f=$('.g-sf'),many=roster(frameScene).length>1,title=$('.g-sf-title');
    f.dataset.period=period;
    $('.g-sf-title b').textContent=tr(frameScene===DEFAULT_SCENE?'田園小站':scenePlace(frameScene));
    $('.g-sf-title small').innerHTML=row?esc(tr(row.model.name)+' · '+status(row))+(many?'<span aria-hidden="true"> ▾</span>':''):'';
    title.disabled=!many;
    if(many&&row)title.setAttribute('aria-label',tr('換車：{name}',{name:tr(row.model.name)}));else title.removeAttribute('aria-label');
    const ctx=walletCtx(),box=$('.g-sf-scenes'),seg=box.firstElementChild;
    box.hidden=!ctx||!ctx.scenes.length;
    if(!box.hidden){
      const scenes=sceneList(ctx);
      if(seg.dataset.key!==scenes.join()){seg.dataset.key=scenes.join();seg.replaceChildren(...scenes.map(scene=>{
        const b=document.createElement('button');b.type='button';b.dataset.sfScene=scene;
        b.onclick=()=>{if(scene===frameScene)return;if(!sceneOpen(walletCtx(),scene)){openRedeem(scene,b);return;}openFrame(scene);showDetail();};return b;}));}
      for(const b of seg.children){
        const scene=b.dataset.sfScene,open=sceneOpen(ctx,scene),name=tr(SCENE_SHORT[scene]);
        b.innerHTML=(open?'':LOCK)+esc(name);b.setAttribute('aria-pressed',String(scene===frameScene));b.setAttribute('aria-label',name+(open?'':' · '+tr('未解鎖')));
      }
      const on=seg.querySelector('[aria-pressed="true"]');
      if(rowScroll&&on){const l=on.offsetLeft,r=l+on.offsetWidth;if(l<box.scrollLeft+12)box.scrollLeft=l-12;else if(r>box.scrollLeft+box.clientWidth-12)box.scrollLeft=r-box.clientWidth+12;}
    }
    rowScroll=false;
    $('[data-sf-view="world"]').textContent=tr(world);
    for(const b of f.querySelectorAll('[data-sf-view]'))b.setAttribute('aria-pressed',String((b.dataset.sfView==='train')===trainView));
    f.querySelectorAll('[data-sf-period]').forEach((b,i)=>{b.textContent=tr(periods[i]);b.setAttribute('aria-pressed',String(b.dataset.sfPeriod===period));});
    const play=$('.g-sf-play');play.textContent=running?'Ⅱ':'▷';play.setAttribute('aria-pressed',String(running));play.setAttribute('aria-label',tr(running?'暫停行駛':'開始行駛'));
    $('.g-sf-in').disabled=zoom>=maxZoom();$('.g-sf-out').disabled=zoom<=.7;
    $('.g-sf-caption').textContent=tr(caption);
  }
  function showDetail() {
    const row=rows.find(r=>r.id===selected);
    $('.g-showcase').hidden=!row;
    if(!row){auto=running=false;cancelAnimationFrame(raf);raf=0;showControls();return;}
    // 場景換座時視角照新那座重設。
    if(mode==='scene'&&viewScene!==frameScene)resetView();
    $(frameBack?'.g-sf-view':'.g-view').setAttribute('aria-label',tr(row.model.name)+' · '+status(row)+' · '+(mode==='scene'?tr(SCENE_SHORT[frameScene]):tr(mode==='track'?'海岸行旅':mode==='loop'?'環形試跑':'近看小車')));
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
    if(loadedId!==row.id||loadedMode!==mode||loadedScene!==(mode==='scene'?frameScene:''))loadSelected();
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
  // 網頁只有登入的人有錢包（host.wallet.uid() 空的就不出入口），只認點數制（v3）。入口兩個：首頁「車庫場景」列、
  // 場景頁的場景鈕，都是點鎖著的那座。redeemAction＝這個帳號最近一筆 {uid,scene,requestId,phase,error,cost,balance}；
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
    // 田園小站和已解鎖的直接開場景頁到那一座，鎖著的開兌換視窗。
    const list=$('.g-scenes-list'),scenes=sceneList(ctx);
    if(list.dataset.key!==scenes.join()){list.dataset.key=scenes.join();list.replaceChildren(...scenes.map(scene=>{
      const b=document.createElement('button');b.type='button';b.className='g-sc';b.dataset.scene=scene;
      b.onclick=()=>{if(sceneOpen(walletCtx(),scene))goScene(scene);else openRedeem(scene,b);};return b;}));}
    for(const b of list.children){
      const scene=b.dataset.scene,v=scene===DEFAULT_SCENE?{unlocked:true,status:tr('免費')}:redeemView(ctx,scene);
      b.classList.toggle('on',v.unlocked);b.setAttribute('aria-label',tr(scenePlace(scene))+' · '+v.status);
      b.innerHTML=`<b>${v.unlocked?'':LOCK}${esc(tr(SCENE_SHORT[scene]))}</b><small>${esc(v.status)}</small>`;
    }
    if(redeemScene)showRedeem();
  }
  function showRedeem(){
    const ctx=walletCtx();if(!ctx){closeRedeem();return;}
    const v=redeemView(ctx,redeemScene),place=scenePlace(redeemScene);
    $('.g-redeem h2').textContent=v.unlocked?tr(place):tr('解鎖「{place}」',{place:tr(place)});
    $('.g-redeem-desc').textContent=tr('永久解鎖這座場景。解鎖後在場景頁上方點它就能看。');
    const msg=$('.g-redeem-msg'),go=$('.g-redeem-go');msg.hidden=!v.message;msg.textContent=v.message||'';
    go.hidden=!v.text;go.textContent=v.text||'';go.disabled=!v.enabled;go.dataset.do=v.button;
    // 訊息的樣子：要重試的是警示框；剛兌換成功（還沒關過視窗）那句加粗。
    const a=redeemAction,done=a?.scene===redeemScene&&a.phase==='SUCCEEDED'&&a.requestId!==redeemAck;
    $('.g-redeem-card').dataset.state=['RETRY','RETRY_STORAGE','RELOAD'].includes(v.button)?'warn':done?'done':'';
  }
  function renderWallet(){if(dialog?.open){showScenes();showControls();}}
  function openRedeem(scene,opener){
    if(!scene)return;
    setFullscreen(false);redeemScene=scene;redeemOpener=opener;
    $('.g-top').inert=$('.g-main').inert=$('.g-sf').inert=true;$('.g-redeem').hidden=false;showRedeem();
    $('.g-redeem-card').focus({preventScroll:true});
    // 每次開窗都讀一次最新點數（同 App 開視窗時 refresh；正在讀就不再發）。
    if(host.wallet.loadState()!=='LOADING')reloadWallet();
  }
  function closeRedeem(){
    if(!redeemScene)return;
    // 終局那筆看過就不再重播（同 App acknowledged）；處理中、待確認的下次開窗照樣看到。
    const a=redeemAction;if(a&&a.scene===redeemScene&&TERMINAL.has(a.phase))redeemAck=a.requestId;
    redeemScene='';$('.g-redeem').hidden=true;$('.g-top').inert=$('.g-main').inert=!!frameBack;$('.g-sf').inert=false;
    if(redeemOpener?.isConnected)redeemOpener.focus({preventScroll:true});redeemOpener=null;
  }
  // 看場景、首頁點能進的場景格：關視窗，開場景頁到這座（場景頁開著就就地換座）。從首頁來的先把車庫捲回篩選列，離開時看得到展示台。
  function goScene(scene){
    closeRedeem();
    if(!frameBack)$('.g-filters').scrollIntoView({block:'start',behavior:'instant'});
    openFrame(scene);showDetail();
  }
  function chooseModel(id) {
    selected=id;$('.g-model-select').value=id;
    dialog.querySelectorAll('.g-car').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.model===id)));
    showDetail();
  }
  function showGrid() {
    const list=rows.filter(inFilter).sort((a,b)=>Number(b.owned)-Number(a.owned)||Number(!!b.rule)-Number(!!a.rule));
    // 場景頁開著時車由場景頁決定（可能不在篩選裡），離開時 keepFrameCar 再對齊篩選。
    if(!frameBack&&!list.some(r=>r.id===selected))selected=list[0]?.id;
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
        b.innerHTML=`<span class="g-check" aria-hidden="true">${row.owned?'入':'○'}</span><img src="${esc(row.model.thumbnail)}" alt="" loading="lazy" width="320" height="200"><b>${esc(tr(row.model.name))}</b><small>${esc(status(row))}</small>`;
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
    // 換語言重建時場景頁一起關掉，回到點之前那一格。
    if(frameBack){mode=frameBack;frameBack='';frameScene='';period=pickedPeriod();resetView();keepFrameCar();}
    dialog.classList.remove('g-sf-open');
    dialog.lang=host.lang();
    dialog.classList.toggle('dark',host.dark());
    dialog.innerHTML=`<header class="g-top"><span class="g-brand">${esc(tr('軌島・收藏'))}</span><button class="g-close" autofocus>${esc(tr('回到地圖'))} ↗</button></header>
      <main class="g-main"><div class="g-heading"><h1 id="garageTitle">${esc(tr('我的車庫'))}</h1>
      <div class="g-progress"><strong class="g-count">0</strong><span class="g-total"></span><progress max="1" value="0"></progress><span>${esc(tr('可收集車款'))}</span></div></div>
      <p class="mt-g-hint" data-mt-g="hint" hidden data-i18n-skip></p>
      <div class="g-demo" hidden><span>${esc(tr('展示模式・不計入收藏'))}</span><button class="g-demo-off"></button></div>
      <section class="g-scenes" hidden aria-labelledby="gScenesTitle"><div class="g-scenes-bar"><h2 id="gScenesTitle">${esc(tr('車庫場景'))}</h2><span class="g-scenes-head"></span></div><div class="g-scenes-list"></div></section>
      <div class="g-filters"><div class="g-tabs">${[['all','全部車款'],['owned','已入庫'],['pending','待收集']].map(([id,text])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${esc(tr(text))}</button>`).join('')}</div>
      <label class="g-picker"><span>${esc(tr('選擇車款'))}</span><select class="g-model-select"></select></label></div>
      <div class="g-empty" hidden><p class="g-empty-text"></p><button class="g-reset">${esc(tr('查看所有車款'))}</button><button class="g-demo-start">${esc(tr('看看展示車庫'))}</button></div>
      <section class="g-showcase" aria-label="${esc(tr('車型展示'))}"><div class="g-stage"><div class="g-scene-bar"><div class="g-scene-tabs">${[['model','近看小車'],['loop','環形試跑'],['track','海岸行旅'],['scene','場景']].map(([id,label])=>`<button data-view="${id}" aria-pressed="${mode===id}">${esc(tr(label))}</button>`).join('')}</div><button class="g-reverse" hidden aria-pressed="false" title="${esc(tr('反向行駛'))}" aria-label="${esc(tr('反向行駛'))}">⇄</button></div>
      <div class="g-viewport"><canvas class="g-view" tabindex="0" role="img" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></canvas><div class="g-zoom"><button class="g-zoom-in" title="${esc(tr('放大場景'))}" aria-label="${esc(tr('放大場景'))}">+</button><output class="g-zoom-level" aria-label="${esc(tr('縮放比例'))}">100%</output><button class="g-zoom-out" title="${esc(tr('縮小場景'))}" aria-label="${esc(tr('縮小場景'))}">−</button></div><button class="g-fs" type="button" aria-pressed="false" title="${esc(tr('全畫面觀看'))}" aria-label="${esc(tr('全畫面觀看'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${FS_PATH.off}"/></svg></button></div><div class="g-fallback" hidden>${esc(tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。'))}</div>
      <div class="g-stage-foot"><span class="g-view-hint"></span><div class="g-controls"><button class="g-auto" aria-label="${esc(tr('自動旋轉'))}" aria-pressed="false">▷</button><button class="g-reset-view" title="${esc(tr('重設視角'))}" aria-label="${esc(tr('重設視角'))}">⌂</button><label class="g-period" hidden><span>${esc(tr('天色'))}</span><select class="g-period-select">${PERIOD_CHOICES.map(([id,label])=>`<option value="${id}">${esc(tr(label))}</option>`).join('')}</select></label><button class="g-retry" hidden aria-label="${esc(tr('重新載入小車'))}">↻</button></div></div></div>
      <div class="g-detail"><span class="g-status"></span><h2 class="g-name"></h2><p class="g-system"></p><p class="g-reason"></p><p class="g-goal"></p><p class="g-date"></p><button class="g-cta"></button><button class="mt-g-plan" type="button" data-mt-g="schedule" hidden></button><p class="mt-g-note" data-mt-g="note" hidden></p><div class="mt-g-mine" hidden><p class="mt-g-status" data-mt-g="status" data-i18n-skip></p><button class="mt-g-view" type="button" data-mt-g="view"></button></div><details class="g-sources"><summary>${esc(tr('車型與來源'))} ↗</summary><div class="g-source-body"></div></details></div></section>
      <p class="g-result" role="status" aria-live="polite"></p><div class="g-grid"></div>
      <footer class="g-footer"><span class="g-catalog"></span> · ${esc(tr('模型製作：軌島（Q 版示意）'))}<br>${esc(tr('進度沿用旅程護照；62 款小車都有收集條件，既有車種章自動帶入。'))}<br>${esc(tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'))}</footer></main>
      <section class="g-sf" hidden aria-labelledby="gSfTitle"><div class="g-sf-bar"><button class="g-sf-leave" type="button">${esc(tr('離開'))}</button><button class="g-sf-title" type="button" aria-expanded="false"><b id="gSfTitle"></b><small></small></button></div>
      <div class="g-sf-scenes" hidden><div class="g-sf-seg" role="group" aria-label="${esc(tr('選擇場景'))}"></div></div>
      <div class="g-sf-cars" hidden><p>${esc(tr('在這座跑的車'))}</p><div class="g-sf-car-list"></div></div>
      <div class="g-sf-stage"><div class="g-sf-wrap"><canvas class="g-sf-view" tabindex="0" role="img" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"></canvas><div class="g-sf-views" role="group" aria-label="${esc(tr('觀賞視角'))}"><button data-sf-view="world" type="button"></button><button data-sf-view="train" type="button">${esc(tr('陪它走走'))}</button></div>
      <p class="g-sf-hint">${esc(tr('拖曳轉個角度 · 滾動或雙指縮放'))}</p><div class="g-sf-loading" role="status"><span></span><button class="g-sf-retry" type="button" hidden>${esc(tr('重新載入小車'))}</button></div></div>
      <div class="g-sf-tools"><div class="g-sf-seg" role="group" aria-label="${esc(tr('時間'))}">${FRAME_PERIODS.map(p=>`<button data-sf-period="${p}" type="button"></button>`).join('')}</div>
      <div class="g-sf-icons" role="group" aria-label="${esc(tr('列車與視角控制'))}"><button class="g-sf-play g-sf-icon" type="button"></button><button class="g-sf-out g-sf-icon" type="button" aria-label="${esc(tr('縮小場景'))}">−</button><button class="g-sf-in g-sf-icon" type="button" aria-label="${esc(tr('放大場景'))}">＋</button><button class="g-sf-reset g-sf-icon" type="button" aria-label="${esc(tr('重設視角'))}">⌂</button></div></div>
      <p class="g-sf-caption"></p></div></section>
      <div class="g-redeem" hidden><div class="g-redeem-card" role="dialog" aria-modal="true" aria-labelledby="gRedeemTitle" tabindex="-1"><h2 id="gRedeemTitle"></h2><p class="g-redeem-desc"></p><p class="g-redeem-msg" role="status"></p><button class="g-redeem-go" type="button"></button><button class="g-redeem-close" type="button">${esc(tr('關閉'))}</button></div></div>`;

    // 頂列實高給 CSS 當內容的 scroll-margin-top（見 train-garage.css「避開 sticky 頂列」那條）。
    // 要看 border-box：頂列上內距是 max(12px, 瀏海安全區)，轉向時只有內距變、內容框不變，預設的觀察框收不到。
    const top=$('.g-top');resize=new ResizeObserver(()=>{dialog.style.setProperty('--g-top-h',top.getBoundingClientRect().height+'px');requestDraw();});resize.observe($('.g-view'));resize.observe($('.g-sf-view'));resize.observe(top,{box:'border-box'});
    visibility=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=0;if(onScreen())requestDraw();else{cancelAnimationFrame(raf);raf=0;}},{root:dialog});visibility.observe($('.g-view'));
    $('.g-close').onclick=close;
    $('.g-retry').onclick=()=>{if(!renderer)rendererPromise=startRenderer();loadSelected();};
    $('.g-demo-off').onclick=()=>{demo=false;filter='owned';refresh();};
    $('.g-demo-start').onclick=()=>{demo=true;selected='e200';resetView();filter='owned';refresh();dialog.scrollTop=0;};
    $('.g-reset').onclick=()=>{filter='all';showGrid();};
    for(const b of dialog.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;showGrid();};
    $('.g-model-select').onchange=e=>chooseModel(e.target.value);
    const turn=(horizontal,vertical=0)=>{auto=false;yaw+=horizontal;elevation=Math.max(.08,Math.min(1.48,elevation+vertical));clampView();showControls();requestDraw();};
    // 旋轉、視角高低沒有按鈕：拖曳（左鍵、右鍵、觸控）與畫布上的方向鍵。
    const periodSelect=$('.g-period-select');periodSelect.value=periodChoice;
    periodSelect.onchange=()=>{periodChoice=periodSelect.value;try{localStorage.setItem(PERIOD_KEY,periodChoice);}catch{}period=pickedPeriod();showControls();requestDraw();};
    $('.g-reset-view').onclick=()=>{auto=false;resetView();showControls();requestDraw();};
    $('.g-auto').onclick=()=>{if(mode!=='model')running=!running;else auto=!auto;last=0;showControls();requestDraw();};
    $('.g-reverse').onclick=()=>{direction*=-1;showControls();requestDraw();};
    // 第 4 格：先畫這款車的專屬場景（已解鎖的話），不然田園小站。
    for(const b of dialog.querySelectorAll('[data-view]'))b.onclick=()=>{if(b.dataset.view==='scene'){const ex=exclusiveScene(selected);openFrame(ex&&sceneOpen(walletCtx(),ex)?ex:DEFAULT_SCENE);showDetail();return;}if(mode===b.dataset.view)return;mode=b.dataset.view;auto=false;running=mode!=='model'&&!reduced.matches;resetView();last=0;showDetail();};
    $('.g-sf-leave').onclick=closeFrame;
    $('.g-sf-title').onclick=()=>{if(!closeCars(true))openCars();};
    $('.g-sf').addEventListener('pointerdown',e=>{if(!e.target.closest('.g-sf-cars,.g-sf-title'))closeCars();});
    $('.g-sf-cars').addEventListener('focusout',e=>{const to=e.relatedTarget;if(to&&!e.currentTarget.contains(to)&&!to.closest('.g-sf-title'))closeCars();});
    for(const b of dialog.querySelectorAll('[data-sf-view]'))b.onclick=()=>{trainView=b.dataset.sfView==='train';resetView();showControls();requestDraw();};
    for(const b of dialog.querySelectorAll('[data-sf-period]'))b.onclick=()=>{period=b.dataset.sfPeriod;showControls();requestDraw();};
    $('.g-redeem-go').onclick=e=>redeemDo(e.currentTarget.dataset.do);$('.g-redeem-close').onclick=closeRedeem;
    $('.g-redeem').onclick=e=>{if(e.target===e.currentTarget)closeRedeem();};
    $('.g-fs').onclick=()=>setFullscreen(!fs);
    $('.g-zoom-in').onclick=()=>setZoom(zoom*1.2);$('.g-zoom-out').onclick=()=>setZoom(zoom/1.2);
    // 場景頁的鈕跟舞台同一套動作。
    $('.g-sf-retry').onclick=$('.g-retry').onclick;$('.g-sf-play').onclick=$('.g-auto').onclick;$('.g-sf-reset').onclick=$('.g-reset-view').onclick;
    $('.g-sf-in').onclick=$('.g-zoom-in').onclick;$('.g-sf-out').onclick=$('.g-zoom-out').onclick;
    for(const canvas of [$('.g-view'),$('.g-sf-view')]){
      canvas.onkeydown=e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')setZoom(1);else setZoom(zoom*(e.key==='-'?1/1.2:1.2));return;}const directions={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.12],ArrowDown:[0,-.12]};if(directions[e.key]){e.preventDefault();turn(...directions[e.key]);}};
      const gap=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
      canvas.addEventListener('wheel',e=>{e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);setZoom(zoom*Math.exp(-Math.max(-160,Math.min(160,pixels))*.002));},{passive:false});
      canvas.oncontextmenu=e=>e.preventDefault(); // 右鍵拖也能轉，不跳選單
      canvas.onpointerdown=e=>{if(e.button!==0&&e.button!==2)return;auto=false;showControls();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);if(pointers.size===1)drag={id:e.pointerId,x:e.clientX,y:e.clientY};else{drag=null;pinch={gap:Math.max(1,gap()),zoom};}};
      canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size>=2){if(pinch)setZoom(pinch.zoom*gap()/pinch.gap);}else if(drag?.id===e.pointerId){turn((e.clientX-drag.x)*.012,(drag.y-e.clientY)*.008);drag.x=e.clientX;drag.y=e.clientY;}};
      canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(!pointers.delete(e.pointerId))return;pinch=drag=null;if(pointers.size===1){const [id,p]=pointers.entries().next().value;drag={id,...p};}else if(pointers.size>=2)pinch={gap:Math.max(1,gap()),zoom};};
    }
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
    // 兌換視窗、場景頁的 Esc 在按鍵這一下就處理掉：Chrome 擋 modal dialog 的 cancel 要有新的使用者操作，連按幾次之後擋不住，車庫會整個關掉。
    if(dialog?.open&&(redeemScene||frameBack)&&e.key==='Escape'){e.preventDefault();backOut();return;}
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
    filter=demo||rows.some(r=>r.owned)?'owned':'all';auto=running=false;mode='model';frameBack='';resetView();direction=1;distance=0;travelTime=0;periodChoice=savedPeriodChoice();period=pickedPeriod();last=0;inView=true;
    trainView=innerWidth<=800;frameScene=viewScene='';
    rendererPromise=renderer?Promise.resolve():startRenderer();
    showDialog();build();dialog.scrollTop=0;$('.g-close').focus({preventScroll:true});requestDraw();
    reloadWallet(); // 「車庫場景」列出現時讀一次最新點數（同 App）；沒登入時什麼都不做
  }
  window.addEventListener('rail:native-back', e => {if(dialog?.open){e.preventDefault();e.stopImmediatePropagation();if(!backOut())close();}}, {capture:true});
  for(const type of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(type,()=>{if(fs&&!fsHistory&&!fsElement())setFullscreen(false);});
  window.addEventListener('popstate',()=>{if(fsHistory){fsHistory=false;setFullscreen(false);}});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else requestDraw();});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog?.open){auto=running=false;showControls();requestDraw();}});
  globalThis.TrainGarage={open,close,refresh,collection,rules:RULES,goals:GOALS,get isOpen(){return !!dialog?.open;}};
})();

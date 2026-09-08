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
  let mode='model',running=false,direction=1,distance=0,travelTime=0,inView=true,period='day';
  function scenePeriod(){const now=new Date(),h=(now.getUTCHours()+8)%24+now.getUTCMinutes()/60;return h>=5&&h<7?'sunrise':h>=7&&h<17?'day':h>=17&&h<19?'sunset':'night';}
  function clampView(){if(mode==='track'){yaw=Math.max(-Math.PI/2-.20,Math.min(-Math.PI/2+.20,yaw));elevation=Math.max(.08,Math.min(.30,elevation));}}
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
  function requestDraw() { if (!raf && dialog?.open && inView && !document.hidden) raf=requestAnimationFrame(frame); }
  function frame(at) {
    raf=0;if(!dialog.open||document.hidden||!inView)return;
    // 精修網格試跑最多約 30 fps；離開展示台或切到背景後不持續佔用 GPU。
    if((auto||running)&&last&&at-last<32){requestDraw();return;}
    const dt=last?Math.min((at-last)/1000,.06):0;last=at;
    if(auto&&!drag)yaw+=dt*.35;
    if(mode==='track'&&running&&loadedId){distance+=dt*2.1*direction;travelTime+=dt;}
    const row=rows.find(r=>r.id===selected);
    if(row&&loadedId===row.id) { renderer?.draw($('.g-view'),row,yaw,{elevation,mode,distance,direction,period,time:travelTime}); }

    if((auto||running)&&loadedId)requestDraw();
  }
  function showControls() {
    dialog.classList.toggle('g-coast',mode==='track');
    for(const b of dialog.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode));
    $('.g-reverse').hidden=mode!=='track';$('.g-reverse').setAttribute('aria-pressed',String(direction===-1));
    $('.g-auto').setAttribute('aria-label',tr(mode==='track'?(running?'暫停行駛':'開始行駛'):'自動旋轉'));
    $('.g-auto').setAttribute('aria-pressed',String(mode==='track'?running:auto));$('.g-auto').textContent=(mode==='track'?running:auto)?'Ⅱ':'▷';
    $('.g-view-hint').textContent=mode==='track'?tr('頭城海岸・龜山島')+' · '+tr({sunrise:'日出',day:'藍天',sunset:'黃昏',night:'星空'}[period]):tr('上下左右拖曳，看看每一面');
  }
  function showDetail() {
    const row=rows.find(r=>r.id===selected);
    $('.g-showcase').hidden=!row;
    if(!row){auto=running=false;cancelAnimationFrame(raf);raf=0;showControls();return;}
    $('.g-view').setAttribute('aria-label',row.model.name+' · '+status(row)+' · '+tr(mode==='track'?'海岸行旅':'近看小車'));
    showControls();
    const badge=$('.g-status');badge.textContent=status(row);badge.classList.toggle('owned',row.owned);
    $('.g-name').textContent=row.model.name;
    $('.g-system').textContent=tr(row.model.system)+' · '+tr('Q 版收藏模型');
    $('.g-reason').textContent=demo ? tr('展示模式・不計入收藏') : row.earned ? tr('完成「{name}」收藏，代表車型已入庫。',{name:row.label}) :
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
      a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=tr('外觀參考')+' · '+source.label+' ↗';p.append(a);$('.g-source-body').append(p);
    }
    if(loadedId!==row.id||loadedMode!==mode)loadSelected();
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
        const option=document.createElement('option');option.value=row.id;option.textContent=row.model.name+' · '+status(row);group.append(option);
      }
      picker.append(group);
    }
    if(!list.length){const option=document.createElement('option');option.textContent=tr('沒有符合條件的車款。');option.value='';picker.append(option);}
    picker.value=selected||'';
    $('.g-result').textContent=tr('{count} 款車車',{count:list.length});
    $('.g-grid').replaceChildren();
    for(const row of list) {
      const b=document.createElement('button');b.type='button';b.className=row.owned?'g-car':'g-car g-locked';b.dataset.model=row.id;b.setAttribute('aria-pressed',String(selected===row.id));
      b.setAttribute('aria-label',row.model.name+' · '+status(row));
      b.innerHTML=`<span class="g-check" aria-hidden="true">${row.owned?'✓':'○'}</span><img src="${esc(row.model.thumbnail)}" alt="" loading="lazy" width="320" height="200"><b>${esc(row.model.name)}</b><small>${esc(status(row))}</small>`;
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
    data();resize?.disconnect();visibility?.disconnect();inView=true;
    dialog.lang=host.lang();
    dialog.classList.toggle('dark',host.dark());
    dialog.innerHTML=`<header class="g-top"><span class="g-brand">RAIL ISLAND / COLLECTION</span><button class="g-close" autofocus>${esc(tr('回到地圖'))} ↗</button></header>
      <main class="g-main"><div class="g-heading"><h1 id="garageTitle">${esc(tr('我的車庫'))}</h1>
      <div class="g-progress"><strong class="g-count">0</strong><span class="g-total"></span><progress max="1" value="0"></progress><span>${esc(tr('可收集車款'))}</span></div></div>
      <div class="g-demo" hidden><span>${esc(tr('展示模式・不計入收藏'))}</span><button class="g-demo-off"></button></div>
      <div class="g-filters"><div class="g-tabs">${[['all','全部車款'],['owned','已入庫'],['pending','待收集']].map(([id,text])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${esc(tr(text))}</button>`).join('')}</div>
      <label class="g-picker"><span>${esc(tr('選擇車款'))}</span><select class="g-model-select"></select></label></div>
      <div class="g-empty" hidden><p class="g-empty-text"></p><button class="g-reset">${esc(tr('查看所有車款'))}</button><button class="g-demo-start">${esc(tr('看看展示車庫'))}</button></div>
      <section class="g-showcase" aria-label="${esc(tr('車型展示'))}"><div class="g-stage"><div class="g-scene-bar"><div class="g-scene-tabs">${[['model','近看小車'],['track','海岸行旅']].map(([id,label])=>`<button data-view="${id}" aria-pressed="${mode===id}">${esc(tr(label))}</button>`).join('')}</div><button class="g-reverse" hidden aria-pressed="false" title="${esc(tr('反向行駛'))}" aria-label="${esc(tr('反向行駛'))}">⇄</button></div><canvas class="g-view" tabindex="0" role="img"></canvas><div class="g-fallback" hidden>${esc(tr('這個裝置暫時無法顯示 3D，收藏紀錄與來源仍可查看。'))}</div>
      <div class="g-stage-foot"><span class="g-view-hint"></span><div class="g-controls"><button class="g-left" title="${esc(tr('向左旋轉'))}" aria-label="${esc(tr('向左旋轉'))}">↶</button><button class="g-auto" aria-label="${esc(tr('自動旋轉'))}" aria-pressed="false">▷</button><button class="g-right" title="${esc(tr('向右旋轉'))}" aria-label="${esc(tr('向右旋轉'))}">↷</button><button class="g-up" title="${esc(tr('提高視角'))}" aria-label="${esc(tr('提高視角'))}">↑</button><button class="g-down" title="${esc(tr('降低視角'))}" aria-label="${esc(tr('降低視角'))}">↓</button><button class="g-reset-view" title="${esc(tr('重設視角'))}" aria-label="${esc(tr('重設視角'))}">⌂</button><button class="g-retry" hidden aria-label="${esc(tr('重新載入小車'))}">↻</button></div></div></div>
      <div class="g-detail"><span class="g-status"></span><h2 class="g-name"></h2><p class="g-system"></p><p class="g-reason"></p><p class="g-goal"></p><p class="g-date"></p><button class="g-cta"></button><details class="g-sources"><summary>${esc(tr('車型與來源'))} ↗</summary><div class="g-source-body"></div></details></div></section>
      <p class="g-result" role="status" aria-live="polite"></p><div class="g-grid"></div>
      <footer class="g-footer"><span class="g-catalog"></span> · ${esc(tr('模型製作：軌島（Q 版示意）'))}<br>${esc(tr('進度沿用旅程護照；62 款小車都有收集條件，既有車種章自動帶入。'))}<br>${esc(tr('收藏的是紀念模型，不代表曾搭乘這個實際車型或車號。'))}</footer></main>`;

    resize=new ResizeObserver(()=>requestDraw());resize.observe($('.g-view'));
    visibility=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=0;if(inView)requestDraw();else{cancelAnimationFrame(raf);raf=0;}},{root:dialog});visibility.observe($('.g-view'));
    $('.g-close').onclick=close;
    $('.g-retry').onclick=()=>{if(!renderer)rendererPromise=startRenderer();loadSelected();};
    $('.g-demo-off').onclick=()=>{demo=false;filter='owned';refresh();};
    $('.g-demo-start').onclick=()=>{demo=true;selected='e200';yaw=mode==='track'?-Math.PI/2:-.55;filter='owned';refresh();dialog.scrollTop=0;};
    $('.g-reset').onclick=()=>{filter='all';showGrid();};
    for(const b of dialog.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;showGrid();};
    $('.g-model-select').onchange=e=>chooseModel(e.target.value);
    const turn=(horizontal,vertical=0)=>{auto=false;yaw+=horizontal;elevation=Math.max(.08,Math.min(1.48,elevation+vertical));clampView();showControls();requestDraw();};
    $('.g-left').onclick=()=>turn(-Math.PI/6);$('.g-right').onclick=()=>turn(Math.PI/6);
    $('.g-up').onclick=()=>turn(0,Math.PI/12);$('.g-down').onclick=()=>turn(0,-Math.PI/12);
    $('.g-reset-view').onclick=()=>{auto=false;yaw=mode==='track'?-Math.PI/2:-.55;elevation=mode==='track'?.16:.39;showControls();requestDraw();};
    $('.g-auto').onclick=()=>{if(mode==='track')running=!running;else auto=!auto;last=0;showControls();requestDraw();};
    $('.g-reverse').onclick=()=>{direction*=-1;showControls();requestDraw();};
    for(const b of dialog.querySelectorAll('[data-view]'))b.onclick=()=>{if(mode===b.dataset.view)return;mode=b.dataset.view;auto=false;running=mode==='track'&&!reduced.matches;yaw=mode==='track'?-Math.PI/2:-.55;elevation=mode==='track'?.16:.39;last=0;showDetail();};
    const canvas=$('.g-view');
    canvas.onkeydown=e=>{const directions={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.12],ArrowDown:[0,-.12]};if(directions[e.key]){e.preventDefault();turn(...directions[e.key]);}};
    canvas.onpointerdown=e=>{if(drag||e.button>0)return;auto=false;showControls();drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(drag?.id===e.pointerId){turn((e.clientX-drag.x)*.012,(drag.y-e.clientY)*.008);drag.x=e.clientX;drag.y=e.clientY;}};
    canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;};
    refresh();
  }
  function cleanup() {
    if (!active) return;
    active = false;renderSession++;modelTicket++;loadedId='';
    cancelAnimationFrame(raf);raf=0;auto=running=false;drag=null;resize?.disconnect();visibility?.disconnect();
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
    filter=demo||rows.some(r=>r.owned)?'owned':'all';auto=running=false;mode='model';yaw=-.55;elevation=.39;direction=1;distance=0;travelTime=0;period=scenePeriod();last=0;inView=true;
    rendererPromise=startRenderer();
    showDialog();build();dialog.scrollTop=0;$('.g-close').focus({preventScroll:true});requestDraw();
  }
  window.addEventListener('rail:native-back', e => {if(dialog?.open){e.preventDefault();e.stopImmediatePropagation();close();}}, {capture:true});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else requestDraw();});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog?.open){auto=running=false;showControls();requestDraw();}});
  globalThis.TrainGarage={open,close,refresh,collection,rules:RULES,goals:GOALS,get isOpen(){return !!dialog?.open;}};
})();

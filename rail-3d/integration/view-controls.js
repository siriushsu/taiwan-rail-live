// 移動原本的設定元素；事件與狀態沿用主站，避免兩個入口各自記住不同值。
export function mountViewControls({translate:t}) {
  if(window.railViewControls)return;
  const categories=[
    ['angle','視角','◩',['[data-rail3d="perspective"]','[data-rail3d="camera"]','#followHeadingRow','[data-proxy="immBtn"]','[data-proxy="ambientBtn"]']],
    ['map','地圖','▧',['.ri-basemap-row','[data-rail3d="ground"]','[data-rail3d="inspection"]','#map3dRow','#sunlightRow']],
    ['train','列車','▰',['[data-rail3d="enabled"]','[data-rail3d="formation"]','[data-rail3d="size"]','[data-rail3d="models"]','#trainHaloRow','[data-proxy="dirBtn"]','.ri-3d-help']],
    ['labels','標示','⌖',['[data-act="track"]','[data-proxy="xingBtn"]','[data-proxy="introBtn"]']],
    ['places','導覽','◇',['#riGuideRow','[data-act="cities"]','#msCities','[data-proxy="pinBtn"]']],
    ['display','畫面','◐',['[data-act="theme"]','[data-act="fontscale"]','[data-act="panelOpacity"]','[data-proxy="powerBtn"]','[data-proxy="musicBtn"]']]
  ];
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const dock=el('aside','view-dock');dock.id='viewDock';dock.setAttribute('aria-label',t('觀看設定'));
  const toggle=el('button','view-toggle',t('觀看'));toggle.id='viewSettingsBtn';toggle.type='button';toggle.setAttribute('aria-controls','viewSettingsPanel');toggle.setAttribute('aria-expanded','false');
  const panel=el('section','view-panel');panel.id='viewSettingsPanel';panel.hidden=true;panel.setAttribute('aria-label',t('觀看設定'));
  const head=el('div','view-head'),title=el('strong','',t('觀看設定')),closeBtn=el('button','view-close','×');closeBtn.type='button';closeBtn.setAttribute('aria-label',t('關閉觀看設定'));head.append(title,closeBtn);
  const nav=el('nav','view-tabs');nav.setAttribute('aria-label',t('觀看設定分類'));
  const body=el('div','view-body');body.id='viewSettingsBody';
  const rail=el('nav','view-rail');rail.setAttribute('aria-label',t('觀看設定'));
  const more=document.getElementById('moreBody'),pages=new Map(),buttons=new Map();let active='angle',opened=false,opener=null;
  for(const[key,name,icon,selectors]of categories){
    const page=el('div','view-page');page.id='view-'+key;page.hidden=true;
    for(const selector of selectors){const node=more.querySelector(selector);if(node)page.append(node);}
    body.append(page);pages.set(key,page);
    const pair=[];
    for(const container of[rail,nav]){const b=el('button','view-tab');b.type='button';b.dataset.view=key;b.setAttribute('aria-controls',page.id);b.setAttribute('aria-expanded','false');const symbol=el('span','view-symbol',icon);symbol.setAttribute('aria-hidden','true');b.append(symbol,el('span','',t(name)));b.onclick=()=>{if(opened&&active===key&&container===rail)close();else open(key,b);};container.append(b);pair.push(b);}
    buttons.set(key,pair);
  }
  more.querySelector('.ri-3d-settings')?.remove();
  // 觀看模式整組移出後，移除空標題；其他帳號、診斷與資訊仍留在更多。
  for(const heading of more.querySelectorAll('.ms-sec')){if(heading.textContent.trim()===t('地圖顯示'))heading.textContent=t('其他設定');let next=heading.nextElementSibling;if(!next||next.classList.contains('ms-sec'))heading.hidden=true;}
  panel.append(head,nav,body);dock.append(rail,panel);document.body.append(dock);document.getElementById('mapActions').append(toggle);
  function sync(){state._syncMoreSheet?.();for(const[key,page]of pages){page.hidden=key!==active;for(const b of buttons.get(key)){b.classList.toggle('on',opened&&key===active);b.setAttribute('aria-expanded',String(opened&&key===active));}}toggle.setAttribute('aria-expanded',String(opened));}
  function open(key=active,source=toggle){opener=source;active=key;document.getElementById('moreClose').click();opened=true;panel.hidden=false;document.body.classList.add('view-open');sync();layout();}
  function close(restore=false){opened=false;panel.hidden=true;document.body.classList.remove('view-open');sync();if(restore&&opener?.isConnected)opener.focus();}
  toggle.onclick=()=>opened?close():open();closeBtn.onclick=()=>close(true);
  // 開子面板或進沉浸時先收觀看面板；原本的事件仍在相同元素上執行。
  body.addEventListener('click',e=>{const row=e.target.closest('.ms-row');if(row&&(row.dataset.close==='1'||['track','fontscale'].includes(row.dataset.act)||row.dataset.proxy==='immBtn'))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened){e.preventDefault();close(true);}});
  document.addEventListener('pointerdown',e=>{if(opened&&!dock.contains(e.target)&&!toggle.contains(e.target))close();});
  function layout(){
    const mobile=document.body.classList.contains('mobile-shell'),stage=document.querySelector('.stage').getBoundingClientRect();dock.classList.toggle('view-mobile',mobile);toggle.classList.toggle('view-side-entry',mobile&&sheetIsSideRail());
    const right=Math.min(innerWidth-16,stage.right-12),left=right-52;dock.style.right=(innerWidth-right)+'px';let top=Math.max(16,stage.top+16);
    for(const q of document.querySelectorAll('#topbar,.badge,#randBtn,#nearBtn,#followLockBtn,#fsFab,.maplibregl-ctrl-top-right,#alertBanner,#alertDetail')){const r=q.getBoundingClientRect(),s=getComputedStyle(q);if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.5)continue;if(r.right>left&&r.left<right&&r.top<stage.top+220)top=Math.max(top,r.bottom+12);}
    if(mobile){const actions=document.getElementById('mapActions').getBoundingClientRect();top=Math.max(top,actions.bottom+10);}
    let bottom=Math.min(innerHeight-88,stage.bottom-88);if(!mobile)for(const q of document.querySelectorAll('.maplibregl-ctrl-bottom-right')){const r=q.getBoundingClientRect();if(r.width&&r.height&&r.top>top)bottom=Math.min(bottom,r.top-12);}if(mobile)dock.style.right='10px';dock.style.setProperty('--view-top',Math.round(top)+'px');dock.style.setProperty('--view-space',Math.max(120,Math.floor(bottom-top))+'px');
  }
  let scheduled=false;function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;layout();});}
  new ResizeObserver(schedule).observe(document.getElementById('mapActions'));
  new ResizeObserver(schedule).observe(document.getElementById('topbar'));
  // 只在這些狀態「剛出現」時收面板；已經開著的車站卡等底部卡片不算，否則在卡片上開觀看設定會立刻被自己關掉。
  let seen=new Set(document.body.classList);
  new MutationObserver(()=>{const now=document.body.classList,added=c=>now.contains(c)&&!seen.has(c);seen=new Set(now);if(opened&&['tools-open','search-open','train-open','explore-open','sheet-open','ambient'].some(added))close();schedule();}).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
  window.railViewControls={open,close,get active(){return active;},get opened(){return opened;}};sync();layout();
}

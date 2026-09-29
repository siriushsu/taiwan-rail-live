// 共用場景外框頁：garage-scene.html?car=<車款id>&lang=zh-TW|en|ja&period=day|sunset|night&embed=1
// 網站與原生 App（WebView）都嵌這一頁；外框負責進場、鎖、離開，場景本體由 rail-3d/garage-scenes/<scene>-view.js 掛載。
const params=new URLSearchParams(location.search);
const car=params.get('car')||'';
const embed=params.get('embed')==='1';

// ── 語言 ──
const normalizeLang=v=>{v=String(v||'').toLowerCase();if(v.startsWith('zh'))return 'zh-TW';if(v.startsWith('ja'))return 'ja';if(v.startsWith('en'))return 'en';return '';};
function detectLang(){
 const q=normalizeLang(params.get('lang'));if(q)return q;
 try{const saved=normalizeLang(localStorage.getItem('trainmap-language'));if(saved)return saved;}catch{}
 for(const v of (navigator.languages||[navigator.language])){const l=normalizeLang(v);if(l)return l;}
 return 'zh-TW';
}
const lang=detectLang();
// 查字方式與 index.html 的 t() 相同：繁中原文為鍵，外語只存差異，找不到回中文。
const t=zh=>lang==='zh-TW'?zh:(window.RAIL_I18N_MESSAGES?.[lang]?.[zh]??zh);
document.documentElement.lang=lang==='zh-TW'?'zh-Hant':lang;

// ── 白天／夜晚（台灣時間 6–18 點為白天，寫法同 train-garage.js 的 scenePeriod）──
function tpePeriod(){const h=(new Date().getUTCHours()+8)%24;return h>=6&&h<18?'day':'night';}
const pq=params.get('period');
const period=pq==='day'||pq==='sunset'||pq==='night'?pq:tpePeriod();

// ── 場景登錄表：新增場景只在這裡加一項（mount 模組＋stage 規格），且要同時進 window.RailGarageSceneLive ──
// load：回傳該景 mount 函式的 Promise。
// stage：場景本體周圍的 DOM 規格。控件 id／data-* 要對得上該景 mount 模組用 root.querySelector 找的東西；文字都用繁中原文（t() 的鍵）。
//   label 區塊 aria；canvasLabel 畫布 aria（native 有值時它點名原生車款，換車時改用車款名）；views 視角分頁（第一個是預設）；
//   extra 視角分頁後的附加元素；loading／loadingOther 載入字（loadingOther 給換車時用）；periods 三個時段鈕；
//   look 特寫鈕（看月台／看老街／看折返，pressed:null 表示不帶 aria-pressed）；caption 底部說明。
const SCENE_MODULES={
 'south-coast':{
  load:()=>import('./rail-3d/garage-scenes/south-coast-view.js?revision=scene-frame-0929').then(m=>m.mountSouthCoast),
  stage:{
   label:'南迴海岸微縮場景',native:['blue','bluecoach'],
   canvasLabel:'藍皮三節列車行駛於南迴海岸微縮場景，可拖曳旋轉或以方向鍵調整',
   views:[['world','山海全景'],['train','陪它走走']],
   loading:'正在把小車搬到海邊…',
   periods:[['day','晴日'],['sunset','夕照'],['night','入夜']],
   look:{id:'platform',text:'看月台',label:'看月台',pressed:'false'},
   caption:'南迴海岸 · 微縮印象'
  }
 },
 'viaduct':{
  load:()=>import('./rail-3d/garage-scenes/viaduct-view.js?revision=scene-frame-0929').then(m=>m.mountViaduct),
  stage:{
   label:'西部幹線高架微縮場景',native:['emu3000'],
   canvasLabel:'新自強三節列車行駛於西部幹線高架微縮場景，可拖曳旋轉或以方向鍵調整',
   views:[['world','高架全景'],['train','陪它走走']],
   loading:'正在把新自強送上高架…',loadingOther:'正在把小車送上高架…',
   periods:[['day','平原晴日'],['sunset','黃昏側光'],['night','月台夜燈']],
   look:{id:'platform',text:'看月台',label:'看月台停靠',pressed:'false'},
   caption:'西部幹線高架 · 微縮印象'
  }
 },
 'shifen':{
  load:()=>import('./rail-3d/garage-scenes/shifen-view.js?revision=scene-frame-0929').then(m=>m.mountShifen),
  stage:{
   label:'平溪線十分老街微縮場景',native:['dr1000'],
   canvasLabel:'DR1000 三節支線小車穿過十分老街微縮場景，可拖曳旋轉或以方向鍵調整',
   views:[['world','老街全景'],['train','陪它走走']],
   loading:'正在把小車開進老街…',
   periods:[['day','山谷晴日'],['sunset','黃昏放燈'],['night','老街夜燈']],
   look:{id:'platform',text:'看老街',label:'看小車停在老街',pressed:null},
   caption:'平溪線十分老街 · 微縮印象'
  }
 },
 'alishan':{
  load:()=>import('./rail-3d/garage-scenes/alishan-view.js?revision=scene-frame-0929').then(m=>m.mountAlishan),
  stage:{
   label:'阿里山林鐵微縮場景',
   canvasLabel:'林鐵三節列車行駛於阿里山林鐵微縮場景，可拖曳旋轉或以方向鍵調整',
   views:[['world','山林全景'],['train','陪它走走']],
   extra:[{tag:'p',cls:'journey-status',id:'journey-status',role:'status',text:'沿坡上山'}],
   loading:'正在把小車帶進森林…',
   periods:[['day','山中晴日'],['sunset','午後斜光'],['night','林間夜色']],
   look:{id:'switchback',text:'看折返',label:'看之字形折返',pressed:null},
   caption:'阿里山林鐵 · 微縮印象'
  }
 }
};

// ── 解鎖：所有「要不要掛 3D」的判斷只能經過 garageSceneUnlocked，不准另開繞道。解鎖單位是場景 id，不是車款 id。──
const UNLOCK_KEY='rail-garage-scene-unlock-test';
function garageSceneTestUnlock(sceneId){
 try{
  const u=params.get('unlock');
  if(u==='1')localStorage.setItem(UNLOCK_KEY,'1');else if(u==='0')localStorage.removeItem(UNLOCK_KEY);
  return localStorage.getItem(UNLOCK_KEY)==='1';
 }catch{return false;}
}
// 懸賞線規劃（使用者尚未核准）：讀 window.RAIL_NATIVE_UNLOCKED_SCENES（原生注入的場景 id 陣列），否則讀同源 localStorage 'trainmap-chips-me-v1'（{unlocked:[{scene,nth,at}]}）；這一輪不接帳本。
function chipsMeCache(){return null;}
function garageSceneUnlocked(sceneId){
 if(garageSceneTestUnlock(sceneId))return true;
 const c=chipsMeCache();
 return !!(c&&Array.isArray(c.unlocked)&&c.unlocked.some(u=>u.scene===sceneId));
}

// ── 車款／場景資料 ──
const entry=window.RailGarageScenes?.[car]||null;
const sceneId=entry?.scene||null;
const live=!!sceneId&&Array.isArray(window.RailGarageSceneLive)&&window.RailGarageSceneLive.includes(sceneId)&&!!SCENE_MODULES[sceneId];
const carName=window.RailGarageCatalog?.[car]?.name||'';

// ── DOM ──
const frame=document.getElementById('frame');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const leaveBtn=el('button','leave',t('離開'));leaveBtn.type='button';leaveBtn.id='leave';
const title=el('div','title');
if(entry){title.append(el('b','',t(entry.place)));if(carName)title.append(el('small','',t(carName)));}
else if(carName)title.append(el('b','',t(carName)));
const bar=el('div','bar');bar.append(leaveBtn,title);
// 鎖定／不可用畫面已在中央大字寫出場景與車款名，頁首那份只在場景本體顯示時出現。
const body=el('div');body.style.cssText='flex:1;min-height:0;display:flex;flex-direction:column';
frame.append(bar,body);
if(entry)document.title=t(entry.place)+(carName?' · '+t(carName):'');

function stageMarkup(spec){
 // 畫布 aria 與載入字點名的是原生車款；換了車就改用目前這款的名字，不誤導讀屏軟體。
 const swapped=!!spec.native&&!spec.native.includes(car)&&!!carName;
 const s=el('section');s.id='stage';s.setAttribute('aria-label',t(spec.label));
 const wrap=el('div','canvas-wrap');
 const canvas=el('canvas');canvas.id='scene';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',swapped?t(carName)+t('三節列車行駛於')+t(spec.label)+t('，可拖曳旋轉或以方向鍵調整'):t(spec.canvasLabel));
 const tabs=el('nav','view-tabs');tabs.setAttribute('aria-label',t('觀賞視角'));
 spec.views.forEach(([v,zh],i)=>{const b=el('button','',t(zh));b.type='button';b.dataset.view=v;b.setAttribute('aria-pressed',String(i===0));tabs.append(b);});
 wrap.append(canvas,tabs);
 for(const x of spec.extra||[]){const n=el(x.tag,x.cls,t(x.text));n.id=x.id;if(x.role)n.setAttribute('role',x.role);wrap.append(n);}
 const hint=el('p','hint',t('拖曳轉個角度 · 滾動或雙指縮放 · 右鍵拖曳或雙指拖曳移動鏡頭'));
 const loading=el('div','loading',t(swapped&&spec.loadingOther||spec.loading));loading.id='loading';loading.setAttribute('role','status');
 wrap.append(hint,loading);
 const tools=el('div','tools');
 const c1=el('div','cluster');c1.setAttribute('aria-label',t('時間'));
 for(const [p,zh] of spec.periods){const b=el('button','',t(zh));b.type='button';b.dataset.period=p;b.setAttribute('aria-pressed',String(p===period));c1.append(b);}
 const c2=el('div','cluster');c2.setAttribute('aria-label',t('列車與視角控制'));
 const mk=(id,cls,text,label,pressed)=>{const b=el('button',cls,text);b.type='button';b.id=id;b.setAttribute('aria-label',label);if(pressed!=null)b.setAttribute('aria-pressed',pressed);c2.append(b);};
 const look=spec.look;
 mk('play','icon','Ⅱ',t('暫停行駛'),'true');mk(look.id,'',t(look.text),t(look.label),look.pressed);mk('out','icon','−',t('縮小'));mk('in','icon','＋',t('放大'));mk('reset','icon','⌂',t('重設視角'));
 tools.append(c1,c2);
 s.append(wrap,tools,el('p','caption',t(spec.caption)));
 return s;
}
function notice(heading,text){
 const n=el('div','notice');n.append(el('h1','',heading));if(carName)n.append(el('div','car',t(carName)));n.append(el('p','',text));return n;
}

// ── 離開 ──
function navigateAway(){
 if(embed&&window.parent!==window){window.parent.postMessage({type:'railisland:garage-scene:leave',car},'*');return;}
 let sameOrigin=false;try{sameOrigin=!!document.referrer&&new URL(document.referrer).origin===location.origin;}catch{}
 if(sameOrigin&&history.length>1)history.back();else location.href='./?garage=1';
}

// ── 狀態與進出場 ──
let handle=null,token=0;
const state={status:'loading',ready:false,car,scene:sceneId,lang,period,live};
function setStatus(status,ready=false){state.status=status;state.ready=ready;frame.dataset.status=status;}
async function enter(){
 const my=++token;
 if(handle){handle.dispose();handle=null;}
 setStatus('loading');body.replaceChildren();title.hidden=true;
 if(!entry||!live){setStatus('unavailable');body.append(notice(t(entry?entry.place:carName||car||'—'),t('這款車的專屬場景還沒開放。')));return state;}
 if(!garageSceneUnlocked(sceneId)){setStatus('locked');body.append(notice(t(entry.place),t('這一景還沒解鎖')));return state;}
 title.hidden=false;const stage=stageMarkup(SCENE_MODULES[sceneId].stage);body.append(stage);
 try{
  const mount=await SCENE_MODULES[sceneId].load();
  if(my!==token)return state;
  const h=mount(stage,{car,period,t,params:entry.params});handle=h;
  const ok=await h.ready;
  if(my!==token)return state;
  setStatus(ok?'ready':'error',ok);
 }catch(e){console.error(e);if(my===token)setStatus('error');}
 return state;
}
function leave({navigate=true}={}){
 token++;
 if(handle){handle.dispose();handle=null;}
 body.replaceChildren();
 setStatus('left');
 if(navigate)navigateAway();
}
leaveBtn.addEventListener('click',()=>leave());
document.addEventListener('keydown',e=>{if(e.key==='Escape')leave();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});

window.garageSceneFrame={state,enter,leave,memory:()=>handle?.memory?.()??null,get handle(){return handle;}};
enter();

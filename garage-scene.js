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

// ── 場景登錄表：新增場景只在這裡加一行，且要同時進 window.RailGarageSceneLive ──
const SCENE_MODULES={
 'south-coast':()=>import('./rail-3d/garage-scenes/south-coast-view.js?revision=scene-frame-0929').then(m=>m.mountSouthCoast)
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

function stageMarkup(){
 const s=el('section');s.id='stage';s.setAttribute('aria-label',t('南迴海岸微縮場景'));
 const wrap=el('div','canvas-wrap');
 const canvas=el('canvas');canvas.id='scene';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('藍皮三節列車行駛於南迴海岸微縮場景，可拖曳旋轉或以方向鍵調整'));
 const tabs=el('nav','view-tabs');tabs.setAttribute('aria-label',t('觀賞視角'));
 for(const [v,zh,p] of [['world','山海全景','true'],['train','陪它走走','false']]){const b=el('button','',t(zh));b.type='button';b.dataset.view=v;b.setAttribute('aria-pressed',p);tabs.append(b);}
 const hint=el('p','hint',t('拖曳轉個角度 · 滾動或雙指縮放 · 右鍵拖曳或雙指拖曳移動鏡頭'));
 const loading=el('div','loading',t('正在把小車搬到海邊…'));loading.id='loading';loading.setAttribute('role','status');
 wrap.append(canvas,tabs,hint,loading);
 const tools=el('div','tools');
 const c1=el('div','cluster');c1.setAttribute('aria-label',t('時間'));
 for(const [p,zh] of [['day','晴日'],['sunset','夕照'],['night','入夜']]){const b=el('button','',t(zh));b.type='button';b.dataset.period=p;b.setAttribute('aria-pressed',String(p===period));c1.append(b);}
 const c2=el('div','cluster');c2.setAttribute('aria-label',t('列車與視角控制'));
 const mk=(id,cls,text,label,pressed)=>{const b=el('button',cls,text);b.type='button';b.id=id;b.setAttribute('aria-label',label);if(pressed!=null)b.setAttribute('aria-pressed',pressed);c2.append(b);};
 mk('play','icon','Ⅱ',t('暫停行駛'),'true');mk('platform','',t('看月台'),t('看月台'),'false');mk('out','icon','−',t('縮小'));mk('in','icon','＋',t('放大'));mk('reset','icon','⌂',t('重設視角'));
 tools.append(c1,c2);
 s.append(wrap,tools,el('p','caption',t('南迴海岸 · 微縮印象')));
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
 title.hidden=false;const stage=stageMarkup();body.append(stage);
 try{
  const mount=await SCENE_MODULES[sceneId]();
  if(my!==token)return state;
  const h=mount(stage,{car,period,t});handle=h;
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

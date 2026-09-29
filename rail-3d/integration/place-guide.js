import {stationCatalog} from '../station-catalog.js';
import {landmarkCatalog} from '../landmark-catalog.js';

const catalog=[...stationCatalog,...landmarkCatalog];
const distance=(a,b)=>Math.hypot((a[0]-b[0])*111320*Math.cos(b[1]*Math.PI/180),(a[1]-b[1])*111320);
const metadata=new Map();
async function dimensions(place){
  if(!metadata.has(place.id))metadata.set(place.id,fetch(new URL(`../assets/stations/${place.id}/metadata.json`,import.meta.url)).then(r=>{if(!r.ok)throw Error('取景資料尚未載入');return r.json();}).catch(e=>{metadata.delete(place.id);throw e;}));
  const m=await metadata.get(place.id);
  let width=m.footprintWidthM||place.widthM||200,depth=m.footprintDepthM||place.depthM||200,height=m.displayHeightM||place.heightM||35;
  // 跨站大廳、雨棚等分件可能遠離站區錨點；取整個模型範圍，不能只框主屋頂。
  for(const part of m.components||[]){
    const angle=(part.rotationDeg||0)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const x=(part.anchor[0]-place.center[0])*111320*Math.cos(place.center[1]*Math.PI/180),y=(part.anchor[1]-place.center[1])*111320;
    width=Math.max(width,2*Math.abs(x)+(part.widthM||0)*c+(part.depthM||0)*s);
    depth=Math.max(depth,2*Math.abs(y)+(part.widthM||0)*s+(part.depthM||0)*c);
    height=Math.max(height,(part.baseM||0)+(part.displayHeightM||0));
  }
  return {width,depth,height};
}

// 根據眼前控制項求可用矩形；桌面浮動卡也算，不能只看手機斷點。
export function guidePadding(map){
  const rect=map.getContainer().getBoundingClientRect(),w=rect.width,h=rect.height,p={top:24,bottom:24,left:24,right:24};
  const selectors=['#topbar','.badge','#mapActions','.maplibregl-ctrl','#board','#followPanel','#freqCard','#moreSheet','.tabbar','#alertBanner','#hazardBanner'];
  for(const el of document.querySelectorAll(selectors.join(','))){
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(el.hidden||!r.width||!r.height||cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)<.5||r.bottom<=rect.top||r.top>=rect.bottom||r.right<=rect.left||r.left>=rect.right)continue;
    const q={left:Math.max(0,r.left-rect.left),right:Math.min(w,r.right-rect.left),top:Math.max(0,r.top-rect.top),bottom:Math.min(h,r.bottom-rect.top)};
    const candidates=[['left',q.right+16],['right',w-q.left+16],['top',q.bottom+16],['bottom',h-q.top+16]];
    candidates.sort((a,b)=>a[1]/(['left','right'].includes(a[0])?w:h)-b[1]/(['left','right'].includes(b[0])?w:h));
    const [side,value]=candidates[0];p[side]=Math.max(p[side],value);
  }
  for(const [a,b,size] of [['left','right',w],['top','bottom',h]])if(p[a]+p[b]>size-100){const k=Math.max(0,(size-100)/(p[a]+p[b]));p[a]*=k;p[b]*=k;}
  return p;
}

export function createPlaceGuide({getRenderer,ensure3D,getRoutes,unlock,onSelect,onView,closePanels,toast,translate=s=>s}){
  let request=0,current=null,select,button;
  async function fly(place,custom=false){
    const ticket=++request;onSelect(place.key);unlock();
    try{
      const d=custom?{width:300,depth:300,height:25}:await dimensions(place);
      if(ticket!==request)return false;
      if(!await ensure3D()||ticket!==request)return false;
      const r=getRenderer();if(!r)return false;unlock();r.map.stop();
      // 等已收合的 sheet 完成版面更新，再依其實際空間取景。
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(ticket!==request||r!==getRenderer())return false;
      const map=r.map,padding=guidePadding(map),w=map.getContainer().clientWidth-padding.left-padding.right,h=map.getContainer().clientHeight-padding.top-padding.bottom;
      const pitch=place.pitch??55,diagonal=Math.hypot(d.width,d.depth),angle=pitch*Math.PI/180;
      const scale=Math.min(w*.58/diagonal,h*.58/(diagonal*Math.cos(angle)+d.height*Math.sin(angle)));
      const zoom=Math.min(place.zoom??16.8,Math.log2(scale*40075016.686*Math.cos(place.center[1]*Math.PI/180)/512));
      const elevation=(map.queryTerrainElevation(place.center)||0)+d.height*.4;
      const view={center:place.center,zoom:Math.max(12,zoom),pitch,bearing:place.bearing??25,padding,elevation};
      current={key:place.key,name:place.name,dimensions:d,view,request:ticket,status:'moving'};
      map.setCenterClampedToGround(false);
      onView(view);toast(translate('正在看：{name}',{name:translate(place.name)}));
      const completed=await r.animateCamera(view,1800);
      if(ticket===request)current.status=completed?'ready':'cancelled';
      return completed;
    }catch(e){if(ticket===request)toast(translate(e.message||'暫時無法前往，請再試一次'));return false;}
  }
  async function goTo(key){const p=catalog.find(p=>p.key===key);if(!p)return false;closePanels();return fly(p);}
  function station(st){
    const center=[st.lon,st.lat],known=stationCatalog.map(p=>({p,d:distance(p.center,center)})).sort((a,b)=>a.d-b.d)[0];
    if(known?.d<350)return fly({...known.p,center,name:st.name});
    // 沿該站附近的路線切線安排斜向視角，不改站點或路線位置。
    let best=null;
    for(const route of getRoutes())for(let i=1;i<route.coordinates.length;i++){
      const a=route.coordinates[i-1],b=route.coordinates[i],d=distance(a,center)+distance(b,center);
      if(!best||d<best.d)best={a,b,d};
    }
    const bearing=best?90-Math.atan2(best.b[1]-best.a[1],(best.b[0]-best.a[0])*Math.cos(center[1]*Math.PI/180))*180/Math.PI-35:25;
    return fly({key:st.id||st.name,name:st.name,center,pitch:55,bearing,zoom:16.8},true);
  }
  function mount(after){
    const row=document.createElement('div');row.id='riGuideRow';row.className='ms-row ri-guide-row';
    const label=document.createElement('label');label.htmlFor='riGuidePlace';label.textContent=translate('車站／地標導覽');
    const controls=document.createElement('span');controls.className='ri-guide-input';
    select=document.createElement('select');select.id='riGuidePlace';
    for(const [name,list]of [['車站',stationCatalog],['地標',landmarkCatalog]]){const group=document.createElement('optgroup');group.label=translate(name);for(const p of list){const option=document.createElement('option');option.value=p.key;option.textContent=translate(p.name);group.append(option);}select.append(group);}
    button=document.createElement('button');button.type='button';button.id='riGuideGo';button.textContent=translate('前往');button.onclick=()=>void goTo(select.value);
    controls.append(select,button);row.append(label,controls);after.after(row);
  }
  return {mount,goTo,station,get current(){return current;},catalog};
}

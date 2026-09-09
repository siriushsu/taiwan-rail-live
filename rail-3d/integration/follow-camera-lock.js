// MapLibre 5.9.0 的相機約束：手勢只改 zoom / bearing / pitch，中心共用列車目標。
// 不改 pane 或列車座標；底圖與自訂 3D 層始終讀同一個 map transform。
export function installFollowCameraLock(map,getTarget){
  const previous=map.transformCameraUpdate,canvas=map.getCanvas(),pointers=new Set();let touches=0;
  const touch=e=>{touches=e.touches.length;},down=e=>pointers.add(e.pointerId),up=e=>pointers.delete(e.pointerId),blur=()=>{touches=0;pointers.clear();};
  window.addEventListener('blur',blur);
  for(const type of ['touchstart','touchend','touchcancel'])canvas.addEventListener(type,touch,{capture:true,passive:true});
  canvas.addEventListener('pointerdown',down,{capture:true,passive:true});
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,up,{capture:true,passive:true});
  const constrain=next=>({...previous?.(next),...getTarget()});map.transformCameraUpdate=constrain;
  return {sync(){
    const target=getTarget();if(!target?.center)return false;
    const c=map.getCenter(),padding=map.getPadding(),wanted=target.padding||{top:0,bottom:0,left:0,right:0};
    if(Math.abs(c.lng-target.center.lng)+Math.abs(c.lat-target.center.lat)<1e-10&&Math.abs(map.getCenterElevation()-target.elevation)<.001&&Object.keys(wanted).every(k=>Math.abs(padding[k]-wanted[k])<.1))return true;
    map.setCenterClampedToGround(false);
    if(touches||pointers.size||map.handlers.isActive()){
      // jumpTo() 會呼叫 stop() 並重設觸控 handlers。手勢進行中沿用此固定版本的
      // _getTransformForUpdate → _applyUpdatedTransform 路徑，只提交同一約束，不中止捏合。
      const next=map._getTransformForUpdate();next.setPadding(wanted);
      map._applyUpdatedTransform(next);map.fire('move');map._update();
    }else map.jumpTo({...target,padding:wanted});
    return true;
  },destroy(){window.removeEventListener('blur',blur);for(const type of ['touchstart','touchend','touchcancel'])canvas.removeEventListener(type,touch,true);canvas.removeEventListener('pointerdown',down,true);for(const type of ['pointerup','pointercancel'])document.removeEventListener(type,up,true);if(map.transformCameraUpdate===constrain)map.transformCameraUpdate=previous;}};
}

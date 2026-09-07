(async()=>{
  const {resolvePlatform}=await import('./rail-platform.js');
  let snapshot=null, requestedAt=0, pending=false;
  const labels={unavailable:'月台尚未提供',undecided:'月台未定',stale:'月台資料已過期',replay:'回放不提供即時月台',cancelled:'列車停駛'};
  const liveClock=()=>state.clockAtNow&&state.playing&&state.speedMult===1&&!state._scrubTime&&!clockSkewBad()&&Math.abs(state.simSec-nowSecOfDay())<=120;
  function eventAt(tr,second){
    const rosterDay=/^\d{4}-\d\d-\d\d$/.test(tr._rday||'');
    const day=rosterDay?tr._rday:todayStr('Asia/Taipei'), now=nowSecOfDay();
    // 有行車日期時，跨午夜的 >86400 秒已屬於隔天，不能再扣一次日界。
    const wrap=rosterDay?0:schedWrapT(tr.stops,now,0)-now;
    return Date.parse(day+'T00:00:00+08:00')+(Number(second)-wrap)*1000;
  }
  function slot(tr,stop,kind='departure',second=stop?.depSec){
    if(tr?.sys!=='tra_sched'||!stop||stop.stop===false)return '';
    return `<span class="rail-platform-label" hidden data-rail-platform data-no="${escHtml(tr.train)}" data-station="${escHtml(stop.name)}" data-event="${eventAt(tr,second)}" data-kind="${kind}"></span>`;
  }
  function target(el){return {sys:'tra',trainNo:el.dataset.no,stationName:el.dataset.station,scheduledAt:Number(el.dataset.event),kind:el.dataset.kind,live:liveClock()};}
  function write(el,value,full=false,station=''){
    const phrase=value.state==='known'?t('月台 {platform}',{platform:value.platform}):t(labels[value.state]||'月台尚未提供');
    el.hidden=value.state!=='known';
    const text=full&&station?`${stationName(station,'tra_sched')} · ${phrase}`:phrase;
    if(el.textContent!==text)el.textContent=text;
    el.dataset.platformState=value.state;
    el.title=value.state==='known'?t('官方月台資訊 · {time} 更新',{time:new Date(snapshot.at).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false})}):phrase;
  }
  function paint(){if(!state.ready||document.hidden)return;
    const tr=state.followTrain;
    const dwell=tr&&dwellInfoOf(tr,effTLive(tr)), next=tr&&nextStopInfo(tr,effTLive(tr));
    const stop=dwell?.st?.stop!==false&&dwell?.st?dwell.st:next?.stop;
    for(const id of ['fpPlatform','tcPlatform']){
      const el=document.getElementById(id);if(!el)continue;
      const eligible=tr?.sys==='tra_sched'&&!!stop&&stop.stop!==false;
      if(!eligible)el.hidden=true;
      if(eligible){const last=stop===tr.stops.at(-1),value=resolvePlatform(snapshot,{sys:'tra',stationName:stop.name,trainNo:tr.train,scheduledAt:eventAt(tr,last?stop.arrSec:stop.depSec),kind:last?'arrival':'departure',live:liveClock()});write(el,value,true,stop.name);}
    }
    let visible=false;
    for(const el of document.querySelectorAll('[data-rail-platform]')){
      write(el,resolvePlatform(snapshot,target(el)));
      if((el.closest('.row,.tc-st')||el.parentElement).getClientRects().length)visible=true;
    }
    visible ||= tr?.sys==='tra_sched'&&!!stop&&['fpPlatform','tcPlatform'].some(id=>document.getElementById(id)?.parentElement.getClientRects().length);
    if(visible&&liveClock()&&!pending&&Date.now()-requestedAt>=60000)void refresh();
  }
  async function refresh(){pending=true;requestedAt=Date.now();try{
    const r=await fetch(API_BASE+'/api/tra-platforms',{signal:AbortSignal.timeout(12000)});
    if(r.ok){const next=await r.json();if(next.schema===1&&Array.isArray(next.records))snapshot=next;}
  }catch{}finally{pending=false;paint();}}
  window.RailPlatforms={slot,paint,get snapshot(){return snapshot;}};
  // 不在 tick()/draw() 中增加網路或全頁查詢；背景頁面不輪詢。
  setInterval(paint,1000);document.addEventListener('visibilitychange',paint);
  if(state.boardStation)renderBoard();paint();
})().catch(error=>console.error('月台資訊',error));

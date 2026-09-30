/* 新北輕軌逐車觀測模型。純函式；秒值均為絕對 epoch，不依賴瀏覽器時鐘或靜態班次。
 * 方向別標準站間秒：官方 roadmap/danhai.js、ankeng.js，2026-09-30 擷取。
 * 這些秒數只用於未觀測站間推估；最新明確車號的到站倒數才是時間錨點。 */
(function (root) {
  'use strict';
  const TTL = 150, DWELL = 30;
  const ROUTES = {
    V: { feed: 'danhai', route: 3, codes: ['V01','V02','V03','V04','V05','V06','V07','V08','V09','V10','V11'],
      up: [130,90,105,75,50,125,145,100,130,140], down: [150,95,110,70,50,120,105,100,210,140] },
    VB: { feed: 'danhai', route: 4, codes: ['V01','V02','V03','V04','V05','V06','V07','V08','V09','V28','V27','V26'],
      up: [130,95,110,75,60,125,115,95,140,165,215], down: [145,100,110,70,60,120,105,130,170,155,210] },
    K: { feed: 'ankeng', route: 1, codes: ['K01','K02','K03','K04','K05','K06','K07','K08','K09'],
      up: [70,110,120,100,180,100,220,160], down: [90,120,110,120,170,90,210,160] },
  };
  const fresh = (at, now) => Number.isFinite(at) && Number.isFinite(now) && now-at >= -5 && now-at <= TTL;
  const seconds = value => value == null || String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>7200 ? null : Number(value);
  const lineFor = (feed, route) => Object.keys(ROUTES).find(id=>ROUTES[id].feed===feed && ROUTES[id].route===Number(route));
  function rows(feed, src, branches = false) {
    const out=[];
    if(!['danhai','ankeng'].includes(feed) || !Array.isArray(src && src.gpsData))return out;
    src.gpsData.forEach((group,gi)=>{
      if(!group || typeof group!=='object' || gi >= (feed==='ankeng'?2:6))return;
      const dir=(feed==='ankeng'?gi===0:gi<=2)?1:-1;
      for(const [code,row] of Object.entries(group)){
        if(!row || row.routeId==null)continue;
        const primary=lineFor(feed, row.timeRouteId==null?row.routeId:row.timeRouteId);
        const car=/^\d{1,8}$/.test(String(row.carNum||'').trim())?String(row.carNum).trim():null;
        const add=(lineId,value)=>{
          if(!lineId)return false;
          const si=ROUTES[lineId].codes.indexOf(code),sec=seconds(value);
          if(si<0 || sec==null)return false;
          // time3/time4 可屬另一台車；只能把 primary time、車輛路線一致的列連到此車號。
          const identified=!!car && primary===lineId && Number(row.routeId)===ROUTES[lineId].route && sec===seconds(row.time);
          out.push({lineId,si,dir,seconds:sec,code,car:identified?car:null,quality:identified?'observed':'forecast'});
          return true;
        };
        if(branches && feed==='danhai' && (gi===0 || gi===5)){
          const a=add('V',row.time3),b=add('VB',row.time4);
          if(a||b)continue;
        }
        add(primary,row.time);
      }
    });
    return out;
  }
  function sample(train, at) {
    if(!train || at>=train.retireAt || !train.trajectory.length)return null;
    const tr=train.trajectory;
    if(at<=tr[0].epoch)return tr[0].progress;
    for(let i=1;i<tr.length;i++)if(at<=tr[i].epoch){const a=tr[i-1],b=tr[i];return a.progress+(b.progress-a.progress)*(at-a.epoch)/(b.epoch-a.epoch||1);}
    return tr[tr.length-1].progress;
  }
  function run(line, from, to) {
    const route=ROUTES[line];
    return route && Math.abs(to-from)===1 ? (to>from?route.up[from]:route.down[to]) : null;
  }
  function setTimetable(model, line, trips) {
    const route=ROUTES[line];if(!route)return;
    const groups={},last=route.codes.length-1;
    for(const trip of Array.isArray(trips)?trips:[]){
      if(!Array.isArray(trip) || trip.length<6 || trip.length%2)continue;
      const dir=Math.sign(trip[2]-trip[0]);
      if(!dir || trip.some((v,i)=>!Number.isFinite(v) || (i%2===0 && (!Number.isInteger(v)||v<0||v>last))))continue;
      let valid=true;
      for(let i=2;i<trip.length;i+=2)if(dir*(trip[i]-trip[i-2])<=0 || trip[i+1]<=trip[i-1])valid=false;
      if(!valid)continue;
      for(let i=2;i<trip.length;i+=2){
        const from=trip[i-2],to=trip[i],duration=trip[i+1]-trip[i-1],standard=run(line,from,to);
        // 端點可能由建置器補時；跨站、內插秒及折返停等也不能當成站間測量。
        if(from===0 || to===0 || from===last || to===last || !standard || trip[i-1]%60 || trip[i+1]%60 ||
          duration<DWELL+standard*.5 || duration>DWELL+standard*2)continue;
        (groups[`${from}/${to}`]||(groups[`${from}/${to}`]=[])).push(duration-DWELL);
      }
    }
    const profile={};
    for(const [key,values] of Object.entries(groups)){
      if(values.length<8)continue;
      values.sort((a,b)=>a-b);
      if(values[Math.floor(values.length*.75)]-values[Math.floor(values.length*.25)]>60)continue;
      const [from,to]=key.split('/').map(Number),standard=run(line,from,to),median=values[Math.floor(values.length/2)];
      // 分鐘精度班表只作弱先驗，與路線圖標準秒等權；校正最多半個分鐘格，不覆蓋直接倒數。
      profile[key]={seconds:standard+Math.max(-30,Math.min(30,(median-standard)/2)),samples:values.length};
    }
    (model.timing||(model.timing={}))[line]=profile;
  }
  function forecastRun(profile, line, from, to) {
    return profile?.[`${from}/${to}`]?.seconds || run(line,from,to);
  }
  function baseTrain(obs, at, arrival = at+obs.seconds, profile) {
    const route=ROUTES[obs.lineId],last=route.codes.length-1,step=obs.dir;
    const origin=step>0?0:last,dest=step>0?last:0,eta=arrival;
    const trajectory=[],calls=[];
    const put=(epoch,progress,stateAfter)=>trajectory.push({epoch,progress,stateAfter});
    // 起點 time 是到站欄位，並非可靠的發車指令（實測 time=4、drivingTime 卻是九分鐘後）。
    if(obs.si===origin){
      put(at,origin,'pending');put(at+TTL,origin,'pending');
      calls.push({stationIndex:origin,arrivalEpoch:at,departureEpoch:null});
    } else {
      put(eta-run(obs.lineId,obs.si-step,obs.si),obs.si-step,'running');
      put(eta,obs.si,obs.si===dest?'terminal':'dwelling');
      let departure=eta+DWELL;
      calls.push({stationIndex:obs.si,arrivalEpoch:eta,departureEpoch:obs.si===dest?null:departure});
      for(let si=obs.si;si!==dest;si+=step){
        put(departure,si,'running');
        const arrival=departure+forecastRun(profile,obs.lineId,si,si+step);
        put(arrival,si+step,si+step===dest?'terminal':'dwelling');
        calls.push({stationIndex:si+step,arrivalEpoch:arrival,departureEpoch:si+step===dest?null:arrival+DWELL});
        departure=arrival+DWELL;
      }
    }
    return {lineId:obs.lineId,direction:step>0?2:1,destinationStationIndex:dest,
      publicLabel:obs.car,sourceAt:at,observation:{...obs,at},trajectory,calls,
      // 官方時間不可被動畫 join 的速度上限改寫；0 秒只代表此批回報到站，不是新到站事件。
      sourceCall:{stationIndex:obs.si,arrivalEpoch:at+obs.seconds,departureEpoch:null,basis:'official',sourceAt:at},
      retireAt:at+TTL,pending:obs.si===origin,quality:{source:obs.si===origin?'ntm-pending':'ntm-observed',confidence:1}};
  }
  function travel(line, from, to) {
    if(from===to)return 0;
    const step=to>from?1:-1;let p=from,total=0;
    while(step*(to-p)>1e-8){
      const end=step>0?Math.min(to,Math.floor(p+1e-8)+1):Math.max(to,Math.ceil(p-1e-8)-1);
      const low=Math.floor(Math.min(p,end)+1e-8),sec=step>0?ROUTES[line].up[low]:ROUTES[line].down[low];
      if(!(sec>0))return Infinity;
      total+=Math.abs(end-p)*sec;p=end;
    }
    return total;
  }
  function join(train, previous, now) {
    const old=sample(previous,now),ideal=sample(train,now),step=train.direction===2?1:-1;
    if(old==null || ideal==null || previous.lineId!==train.lineId || previous.direction!==train.direction)return train;
    // 只向前接續上一畫格，不瞬移、不倒退，也不把官方來不及抵達的 deadline 畫成瞬間加速。
    const points=[{epoch:now,progress:old,stateAfter:'running'}];
    let last=points[0],delay=0;
    for(const p of train.trajectory){
      if(p.epoch<=now || step*(p.progress-last.progress)<-1e-8)continue;
      const earliest=last.epoch+travel(train.lineId,last.progress,p.progress)/2;
      const epoch=Math.max(p.epoch+delay,earliest);
      delay=Math.max(delay,epoch-p.epoch);
      points.push({...p,epoch});last=points[points.length-1];
    }
    if(points.length===1)points.push({epoch:train.retireAt,progress:old,stateAfter:'dwelling'});
    train.trajectory=points;
    for(const call of train.calls){
      if(call.arrivalEpoch<=now && step*(old-call.stationIndex)>=-1e-8)continue;
      const p=points.find(p=>Math.abs(p.progress-call.stationIndex)<1e-8 && p.epoch>=call.arrivalEpoch);
      if(p && p.epoch>call.arrivalEpoch){const delta=p.epoch-call.arrivalEpoch;call.arrivalEpoch=p.epoch;if(call.departureEpoch!=null)call.departureEpoch+=delta;}
    }
    if(delay>1 || step*(old-ideal)>.05)train.quality={source:'ntm-constrained',confidence:.5};
    return train;
  }
  function update(model, feed, src, at, now) {
    if(!fresh(at,now) || !['danhai','ankeng'].includes(feed) || !Array.isArray(src && src.gpsData))return false;
    const feeds=model.feeds||(model.feeds={}),previous=feeds[feed];
    if(previous && at<=previous.at)return false; // 同批快取不續命、不重建軌跡。
    const board=rows(feed,src,true),observations=rows(feed,src).filter(r=>r.car),grouped=new Map();
    for(const row of observations){const a=grouped.get(row.car)||[];a.push(row);grouped.set(row.car,a);}
    const trains=new Map((previous?.trains||[]).filter(t=>t.retireAt>now).map(t=>[t.publicLabel,t]));
    const signatures={};
    for(const [car,rec]of Object.entries(previous?.signatures||{}))if(at-rec.lastSeen<=TTL)signatures[car]=rec;
    for(const [car,choices]of grouped){
      const distinct=new Set(choices.map(o=>`${o.lineId}/${o.dir}/${o.si}/${o.seconds}`));
      if(distinct.size!==1)continue; // 同車出現在矛盾站點／方向，不猜哪筆是真的。
      const obs=choices[0];let old=trains.get(car);
      if(old && (old.lineId!==obs.lineId || old.direction!==(obs.dir>0?2:1))){
        const was=sample(old,now);
        const origin=obs.dir>0?0:ROUTES[obs.lineId].codes.length-1;
        const oldDest=old.destinationStationIndex;
        const sameTerminal=ROUTES[old.lineId].codes[oldDest]===ROUTES[obs.lineId].codes[origin];
        // 快取可能跳過待發的那一批；在同一終點折返、下一筆已到相鄰站仍可接車。
        // 路線切換只接受真正共用的終點，絕不把 V11 當成 V26。
        if(was==null || !sameTerminal || Math.abs(was-oldDest)>.1 || Math.abs(obs.si-origin)>1)continue;
        old={...old,lineId:obs.lineId,direction:obs.dir>0?2:1,
          trajectory:[{epoch:now,progress:origin,stateAfter:'pending'}]};
      }
      // 同車同站正倒數長期凍結時不把新的 proxy at 當新的車輛證據；到站/待發 0、1 不適用。
      const signature=`${obs.lineId}/${obs.dir}/${obs.si}/${obs.seconds}`;
      const prior=signatures[car],since=prior?.signature===signature?prior.since:at;
      signatures[car]={signature,since,lastSeen:at};
      if(obs.seconds>1 && at-since>45)continue;
      // 連續的「已到站」不是每批又到站一次，不能每次重加一段停站時間。
      const priorCall=old?.lineId===obs.lineId && old.direction===(obs.dir>0?2:1)
        ? old.calls.find(c=>c.stationIndex===obs.si) : null;
      // 畫面已完成的到站/停站不重做；來源的本批 0 秒另存 sourceCall，不當成新的精確到站事件。
      const arrival=obs.seconds<=1 && priorCall && priorCall.arrivalEpoch<=at
        ? Math.max(at-TTL,priorCall.arrivalEpoch) : at+obs.seconds;
      const train=join(baseTrain(obs,at,arrival,model.timing?.[obs.lineId]),old,now);
      train.vehicleId=`ntm:${feed}:${car}`;
      train.signature=signature;train.signatureSince=since;
      if(train.retireAt>now)trains.set(car,train);
    }
    feeds[feed]={at,rows:board,trains:[...trains.values()],signatures};
    return true;
  }
  function system(model,feed,now){
    const f=model?.feeds?.[feed];if(!f || !fresh(f.at,now))return null;
    const trains=f.trains.filter(t=>fresh(t.sourceAt,now) && sample(t,now)!=null).map(t=>({...t,
      nextCall:!t.pending && t.sourceCall.arrivalEpoch>=now-30 ? t.sourceCall
        : t.calls.find(c=>c.departureEpoch==null?c.arrivalEpoch>=now:c.departureEpoch>=now)||t.calls[t.calls.length-1]}));
    return {systemId:feed==='danhai'?'ntdlrt':'ntalrt',trains,boards:[],sourceAt:f.at};
  }
  const api={TTL,DWELL,ROUTES,fresh,rows,sample,run,setTimetable,update,system};
  root.NtmLiveModel=api;
  if(typeof module==='object' && module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);

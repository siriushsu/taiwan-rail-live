// 合成資料只測契約，不用來宣稱真實準確率。真實回放另存報告。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ntm-live-model.js',import.meta.url),'utf8');
const mutation=process.env.NTM_MODEL_MUTATION;
const mutations={
  identity:["primary===lineId && Number(row.routeId)===ROUTES[lineId].route",'true'],
  clock:['step=obs.dir;', 'step=obs.dir;arrival+=60;'],
  continuity:['const old=sample(previous,now),ideal=', 'const old=null,ideal='],
  stale:['now-at <= TTL','now-at <= 1800'],
  duplicate:['at<=previous.at','at<previous.at'],
  pending:['if(obs.si===origin){','if(false){'],
  sourceAnchor:['nextCall:!t.pending && t.sourceCall.arrivalEpoch>=now-30','nextCall:false'],
};
const ctx={};
let code=source;
if(mutation){const pair=mutations[mutation];assert(pair&&code.includes(pair[0]));code=code.replace(...pair);}
vm.runInNewContext(code,ctx);
const api=ctx.NtmLiveModel;
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const at=1790729000;
function packet(line,si,dir,seconds,car='212'){
  const route=api.ROUTES[line],feed=route.feed,groups=Array.from({length:feed==='ankeng'?2:6},()=>({}));
  const gi=feed==='ankeng'?(dir>0?0:1):(dir>0?(si<9?0:line==='V'?1:2):(si<9?5:line==='V'?3:4));
  groups[gi][route.codes[si]]={routeId:route.route,timeRouteId:route.route,time:seconds,carNum:car};
  return {gpsData:groups};
}
const get=(model,feed='ankeng',now=at)=>api.system(model,feed,now)?.trains[0];
test('上下行標準站間秒各自正確，停站 30 秒不併入行車',()=>{
  assert.equal(api.run('K',4,5),180);assert.equal(api.run('K',5,4),170);
  for(const dir of [1,-1]){const m={};api.update(m,'ankeng',packet('K',4,dir,60),at,at);
    const t=get(m),c=t.calls[0],next=t.calls[1];
    assert.equal(c.arrivalEpoch,at+60);assert.equal(c.departureEpoch,at+90);
    assert.equal(next.arrivalEpoch,c.departureEpoch+api.run('K',4,4+dir));
    assert.equal(api.sample(t,at+75),4);
  }
});
test('來源時間是錨點；接收延遲不重新起算',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,100),at,at+45);
  assert.equal(get(m).calls[0].arrivalEpoch,at+100);
});
test('匿名預告保留看板，不創造車號、不帶動其他車',()=>{
  const m={},p=packet('K',4,1,60,'');api.update(m,'ankeng',p,at,at);
  assert.equal(api.rows('ankeng',p).length,1);assert.equal(api.system(m,'ankeng',at).trains.length,0);
});
test('共線的另一支線倒數不得繼承前車車號',()=>{
  const p={gpsData:[{V08:{routeId:4,timeRouteId:3,time:60,time3:60,time4:660,carNum:'105'}},{},{},{},{},{}]};
  assert.equal(api.rows('danhai',p,true).length,2);
  assert(api.rows('danhai',p,true).every(r=>r.car===null));
  p.gpsData[0].V08.timeRouteId=4;p.gpsData[0].V08.time=660;
  assert.equal(api.rows('danhai',p,true).find(r=>r.lineId==='VB').car,'105');
  assert.equal(api.rows('danhai',p,true).find(r=>r.lineId==='V').car,null);
});
test('同批快取、倒序封包不能續命或改軌跡',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,100),at,at);
  const before=JSON.stringify(m);
  assert.equal(api.update(m,'ankeng',packet('K',5,1,100),at,at+20),false);
  assert.equal(api.update(m,'ankeng',packet('K',3,1,100),at-1,at+20),false);
  assert.equal(JSON.stringify(m),before);
});
test('過期及未來封包拒收；個別列車不靠其他列車更新而續命',()=>{
  for(const time of [at-151,at+6,NaN])assert.equal(api.update({},'ankeng',packet('K',4,1,60),time,at),false);
  const m={};api.update(m,'ankeng',packet('K',4,1,60),at,at);
  api.update(m,'ankeng',packet('K',5,1,60,'213'),at+100,at+100);
  assert(!api.system(m,'ankeng',at+151).trains.some(t=>t.publicLabel==='212'));
});
test('同車短暫漏列仍維持原身分與軌跡',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,60),at,at);
  const old=get(m);api.update(m,'ankeng',{gpsData:[{},{}]},at+55,at+55);
  const next=get(m,'ankeng',at+60);
  assert.equal(next.vehicleId,old.vehicleId);assert.equal(next.sourceAt,at);
});
test('反覆回報到站不重置既有到站時間，不每批多加停站',()=>{
  const m={};api.update(m,'ankeng',packet('K',3,1,10),at,at);
  const initial=get(m).calls[0].arrivalEpoch;
  api.update(m,'ankeng',packet('K',3,1,0),at+20,at+20);
  assert.equal(get(m,'ankeng',at+20).calls[0].arrivalEpoch,initial);
  assert.equal(get(m,'ankeng',at+20).calls[1].arrivalEpoch,initial+30+api.run('K',3,4));
});
test('起點倒數不是發車指令，待發車沒有虛構的後續到站事件',()=>{
  for(const dir of [1,-1])for(const seconds of [0,1,4,180]){
    const m={},origin=dir>0?0:8;api.update(m,'ankeng',packet('K',origin,dir,seconds),at,at);
    const t=get(m);assert.equal(t.calls.length,1);assert.equal(t.calls[0].departureEpoch,null);
    assert.equal(api.sample(t,at+149),origin);
  }
});
test('凍結正倒數不能藉名冊逾期重新冒充新車',()=>{
  const m={};for(const offset of [0,55,110,165,220])api.update(m,'ankeng',packet('K',4,1,100),at+offset,at+offset);
  assert.equal(api.system(m,'ankeng',at+220).trains.length,0);
  api.update(m,'ankeng',packet('K',4,1,99),at+221,at+221);
  assert.equal(api.system(m,'ankeng',at+221).trains.length,1);
});
test('換批次起點連續、雙向不倒退，校正速度有上限',()=>{
  for(const dir of [1,-1]){
    const m={};api.update(m,'ankeng',packet('K',4,dir,100),at,at);
    const old=get(m),now=at+30,p=api.sample(old,now);
    api.update(m,'ankeng',packet('K',4,dir,5),now,now);
    const t=get(m,'ankeng',now);assert.equal(api.sample(t,now),p);
    for(let i=1;i<t.trajectory.length;i++){
      const a=t.trajectory[i-1],b=t.trajectory[i];assert(dir*(b.progress-a.progress)>=-1e-8);
      if(Math.abs(b.progress-a.progress)>1e-8)assert(b.epoch>a.epoch);
    }
    assert.equal(t.quality.source,'ntm-constrained');
  }
});
test('同車矛盾列不任選；保留上一筆有效軌跡',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,60),at,at);
  const p=packet('K',5,1,100);Object.assign(p.gpsData[1],packet('K',3,-1,30).gpsData[1]);
  api.update(m,'ankeng',p,at+55,at+55);
  assert.equal(get(m,'ankeng',at+55).sourceAt,at);
});
test('官方倒數與動畫時鐘分離；平順追趕不能延後官方 ETA',()=>{
  for(const line of ['V','VB','K'])for(const dir of [1,-1]){
    const feed=api.ROUTES[line].feed,m={};
    api.update(m,feed,packet(line,4,dir,100),at,at);
    const prior=get(m,feed),now=at+30,old=api.sample(prior,now);
    api.update(m,feed,packet(line,4,dir,5),now,now);
    const t=get(m,feed,now);
    assert.equal(api.sample(t,now),old,'不能為了對準 ETA 瞬移');
    assert(t.calls[0].arrivalEpoch>now+5,'此案例須真的觸發動畫追趕延遲');
    assert.equal(t.nextCall.arrivalEpoch,now+5);
    assert.equal(t.nextCall.stationIndex,4);assert.equal(t.nextCall.basis,'official');
    assert.equal(t.sourceCall.arrivalEpoch,now+5);
    assert.notEqual(get(m,feed,now+36).nextCall.basis,'official','已過官方到站窗不能繼續冒充即時');
  }
});
test('反覆到站保留動畫歷史，但跟車卡仍對準這一批的官方到站站點',()=>{
  const m={};api.update(m,'ankeng',packet('K',3,1,10),at,at);
  const original=get(m).calls[0].arrivalEpoch;
  for(const offset of [20,40,60]){
    api.update(m,'ankeng',packet('K',3,1,0),at+offset,at+offset);
    const t=get(m,'ankeng',at+offset);
    assert.equal(t.calls[0].arrivalEpoch,original,'重複 0 秒不是新的到站事件');
    assert.equal(t.nextCall.stationIndex,3);assert.equal(t.nextCall.arrivalEpoch,at+offset);
    assert.equal(t.nextCall.basis,'official');
  }
});
test('官方時間不從接收時刻重算，也不因凍結或矛盾資料續命',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,100),at,at+25);
  assert.equal(get(m,'ankeng',at+25).nextCall.arrivalEpoch,at+100);
  api.update(m,'ankeng',packet('K',4,1,100),at+50,at+50);
  assert.equal(get(m,'ankeng',at+50).sourceCall.sourceAt,at);
  api.update(m,'ankeng',packet('K',4,-1,40),at+60,at+60);
  assert.equal(get(m,'ankeng',at+60).sourceCall.sourceAt,at);
  assert.equal(api.system(m,'ankeng',at+151).trains.length,0);
});
test('終點保留至資料逾期；跳過待發批次也可在同站折返',()=>{
  const m={};api.update(m,'ankeng',packet('K',8,1,0),at,at);
  assert.equal(api.sample(get(m),at+60),8);
  const id=get(m).vehicleId;
  api.update(m,'ankeng',packet('K',7,-1,140),at+55,at+55);
  const t=get(m,'ankeng',at+55);assert.equal(t.direction,1);assert.equal(t.vehicleId,id);
  assert.equal(api.sample(t,at+55),8);
});
test('異支線只可在共用終點換線，不能從 V11 跳至 V26',()=>{
  const m={};api.update(m,'danhai',packet('V',10,1,0,'110'),at,at);
  api.update(m,'danhai',packet('VB',11,-1,0,'110'),at+55,at+55);
  assert.equal(get(m,'danhai',at+55).lineId,'V');
  const shared={};api.update(shared,'danhai',packet('V',0,-1,0,'110'),at,at);
  api.update(shared,'danhai',packet('VB',1,1,120,'110'),at+55,at+55);
  assert.equal(get(shared,'danhai',at+55).lineId,'VB');
  assert.equal(api.sample(get(shared,'danhai',at+55),at+55),0);
});
test('車號跨來源不相撞、跨午夜不中斷',()=>{
  const m={};api.update(m,'ankeng',packet('K',4,1,60,'110'),at,at);
  api.update(m,'danhai',packet('V',4,1,60,'110'),at,at);
  assert.notEqual(get(m).vehicleId,get(m,'danhai').vehicleId);
  const n={};api.update(n,'ankeng',packet('K',4,1,60,'110'),at+86400,at+86400);
  assert.equal(get(m).vehicleId,get(n,'ankeng',at+86400).vehicleId);
});
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('網站、原生 App 都載入逐車模型',()=>{
  assert(html.includes('<script src="./ntm-live-model.js"></script>'));
  assert(fs.readFileSync(new URL('../app/scripts/prepare-web.mjs',import.meta.url),'utf8').includes("'ntm-live-model.js'"));
});
console.log(`${checks}/${checks} NTM model contracts passed`);

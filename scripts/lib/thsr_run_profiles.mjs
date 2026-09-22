// 高鐵班表掛上與瀏覽器【逐字相同】的跑段速度曲線(rp／rpDep／rpOff／rpSegKm)。
//
// 為什麼要有這支:派車求解器的佔用模型(rail-3d/physical/reservations.js)與網頁畫車的行車模型
// (motion.js)都走 timing.js 的 segmentTime,差別只在班表每站有沒有 rp——沒有就退回等速內插。
// 2026-09-12 實測:0108 不停桃園,等速內插算它 09:12 通過,瀏覽器的曲線 09:10:38 就過了,
// 求解器因此讓停靠的 0610 多等約 90 秒;別站會反過來(曲線比等速晚到)該讓沒讓。
// 曲線模型不另寫一份:把 index.html 的 buildProfile／assignRunProfiles 原文切進 vm 沙箱跑
// (同 build_run_profiles.mjs 的做法),離線掛的與瀏覽器掛的定義上不可能漂移;
// 指紋由求解器寫進結果、assemble 寫進 dispatch.json,verify_thsr_reservation_motion.mjs 在出貨樹重算比對。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runInContext} from 'node:vm';
import {makeSandbox} from '../build_run_profiles.mjs';

const RP_FIELDS=['rp','rpDep','rpOff','rpSegKm'];
const norm=n=>String(n).replaceAll('臺','台');

// 輸入的 stops 是正式站班表語意:中途站 depSec 已含 HSR_DEP_MID_SEC(+30)。瀏覽器的
// assignSchedShapePathsFor 自己會加那 30 秒(dep0→depSec),所以餵它的是還原成 TDX 原值的複本,
// 跑完斷言它算出的到離站秒數與輸入逐站相等——常數若改了,這裡當場紅,不會靜默雙倍加。
export function attachThsrRunProfiles(trains,{indexPath='index.html',trackPath='data/thsr_track.json'}={}){
 const ctx=makeSandbox(indexPath),mid=runInContext('HSR_DEP_MID_SEC',ctx);
 const track=JSON.parse(fs.readFileSync(trackPath,'utf8')),coord=new Map();
 for(const ln of track.lines)for(const st of ln.stations)coord.set(norm(st.name),st);
 const clones=trains.map(tr=>({sys:'thsr_sched',train:tr.train,stops:tr.stops.map((s,i)=>{const st=coord.get(norm(s.name));
  return {name:s.name,lat:s.lat??st?.lat,lon:s.lon??st?.lon,arrSec:s.arrSec,depSec:i<tr.stops.length-1?s.depSec-mid:s.depSec,stop:true};})}));
 ctx.trains=clones;ctx.lines=structuredClone(track.lines);
 runInContext('assignSchedShapePathsFor(trains, lines)',ctx);
 let profiled=0,plain=0;
 trains.forEach((tr,k)=>tr.stops.forEach((s,i)=>{const c=clones[k].stops[i];
  if(c.arrSec!==s.arrSec||c.depSec!==s.depSec)throw Error(`瀏覽器算出的到離站秒數與班表不同 ${tr.id||tr.train} ${s.name} ${c.arrSec}/${c.depSec} vs ${s.arrSec}/${s.depSec}`);
  for(const f of RP_FIELDS)delete s[f];
  if(c.rp){for(const f of RP_FIELDS)s[f]=c[f];profiled++;}else if(i<tr.stops.length-1)plain++;
 }));
 return {profiled,plain,segStats:ctx.state._segStats,midSec:mid};
}

// 指紋＝每班每段的曲線參數(鍵序正規化後逐字);求解器寫進結果檔、assemble 寫進 dispatch.json、
// 閘門用出貨樹的 index.html＋thsr_track.json＋各班停靠簽章重算比對。曲線缺席(瀏覽器也退等速)記 null。
const canon=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k2=>[k2,x[k2]])):x);
export function thsrProfileFingerprint(trains){
 const rows=trains.map(tr=>[tr.id,tr.stops.map(s=>s.rp?[s.rpDep,s.rpOff,s.rpSegKm,canon(s.rp)]:null)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

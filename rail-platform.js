// 車站、車次與表訂事件時間三者一起比對；月台不是車次的永久屬性。
export const PLATFORM_MAX_AGE_MS = 180000;
const normalName = s => String(s || '').replace(/臺/g, '台').trim();
const ms = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const unknown = state => ({state, platform:null, expiresAt:null});

// StationLiveBoard 沒有行車日期，僅接受資料時刻附近六小時內的表訂事件。
// 超出這個範圍不猜日期；跨午夜的 23:xx / 00:xx 仍可正確對上。
export function platformEventAt(clock, observedAt) {
  if (!/^\d\d:\d\d(?::\d\d)?$/.test(clock || '') || !Number.isFinite(observedAt)) return null;
  const [h,m,s=0] = clock.split(':').map(Number);
  if (h>23 || m>59 || s>59) return null;
  const day = Math.floor((observedAt + 28800000) / 86400000) * 86400000 - 28800000;
  const base = day + (h*3600+m*60+s)*1000;
  const closest = [base-86400000,base,base+86400000].sort((a,b)=>Math.abs(a-observedAt)-Math.abs(b-observedAt))[0];
  return Math.abs(closest-observedAt)<=21600000 ? closest : null;
}

export function normalizePlatformSnapshot(raw, stationInfo, now=Date.now()) {
  if (!raw || !Array.isArray(raw.StationLiveBoards) || raw.StationLiveBoards.length>=10000) throw Error('月台資料格式或筆數不完整');
  const updated = ms(raw.UpdateTime), source = ms(raw.SrcUpdateTime);
  if (updated===null || source===null || Math.max(updated,source)>now+60000) throw Error('月台資料時刻無效');
  const at = Math.min(updated,source), names = new Map(Object.values(stationInfo).map(s=>[String(s.id),s.name]));
  const records = [];
  for (const r of raw.StationLiveBoards) {
    const stationId=String(r.StationID||''), trainNo=String(r.TrainNo||'').trim(), recordAt=ms(r.UpdateTime);
    if (!names.has(stationId) || !/^\d{1,8}$/.test(trainNo) || recordAt===null || recordAt>now+60000) continue;
    const text=typeof r.Platform==='string'?r.Platform.trim().toUpperCase():'';
    const cancelled=r.RunningStatus===2, undecided=/^0+$/.test(text), valid=/^\d{1,2}[A-Z]?$/.test(text)&&!undecided;
    records.push({stationId,stationName:names.get(stationId),trainNo,
      arrivalAt:platformEventAt(r.ScheduleArrivalTime,at),departureAt:platformEventAt(r.ScheduleDepartureTime,at),
      platform:valid&&!cancelled?text:null,state:cancelled?'cancelled':valid?'known':undecided?'undecided':'unavailable',
      updatedAt:recordAt,expiresAt:Math.min(at,recordAt)+PLATFORM_MAX_AGE_MS});
  }
  return {schema:1,source:'TDX StationLiveBoard',at:new Date(at).toISOString(),expiresAt:at+PLATFORM_MAX_AGE_MS,records};
}

export function resolvePlatform(snapshot, target, now=Date.now()) {
  if (!target || !['tra','tra_sched'].includes(target.sys) || target.kind==='pass') return unknown('inapplicable');
  if (target.live===false) return unknown('replay');
  if (!snapshot || snapshot.schema!==1 || !Array.isArray(snapshot.records)) return unknown('unavailable');
  if (!Number.isFinite(snapshot.expiresAt) || now>=snapshot.expiresAt || ms(snapshot.at)>now+60000) return unknown('stale');
  if (!Number.isFinite(target.scheduledAt)) return unknown('unavailable');
  const key=target.kind==='arrival'?'arrivalAt':'departureAt';
  const rows=snapshot.records.filter(r=>r.trainNo===String(target.trainNo) &&
    (target.stationId?r.stationId===String(target.stationId):normalName(r.stationName)===normalName(target.stationName)) &&
    Number.isFinite(r[key]) && Math.abs(r[key]-target.scheduledAt)<1000);
  if (!rows.length) return unknown('unavailable');
  // 同一事件多筆取最新；同時刻互相矛盾時不選任一月台。
  const newest=Math.max(...rows.map(r=>r.updatedAt)), current=rows.filter(r=>r.updatedAt===newest);
  if (new Set(current.map(r=>r.state+':'+r.platform)).size!==1) return unknown('unavailable');
  const r=current[0];
  if (!Number.isFinite(r.expiresAt) || now>=r.expiresAt) return unknown('stale');
  return {state:r.state,platform:r.platform,expiresAt:r.expiresAt};
}

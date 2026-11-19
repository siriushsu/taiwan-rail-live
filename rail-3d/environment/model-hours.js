import {nightAmount} from '../integration/train-lighting.js';
import {stationHours} from './station-hours.js';
import {stationNameKey} from './station-name.js';
import {venueHours,monthlyMondayClosures} from './venue-hours.js';

// 同一站體服務數套鐵路，任一系統仍有旅客時都要亮。
const complexes = {
  'taipei-main-v1':['tra:台北','thsr:台北','trtc:台北'],
  'banqiao-v1':['tra:板橋','thsr:板橋','trtc:板橋'],
  'nangang-v1':['tra:南港','thsr:南港','trtc:南港'],
  'zuoying-complex-v1':['tra:新左營','thsr:左營','krtc:左營'],
  'xinwuri-complex-v1':['tra:新烏日','thsr:台中','tmrt:高鐵台中'],
  'taoyuan-hsr-v1':['thsr:桃園','tymc:高鐵桃園'],
  'hsinchu-hsr-v1':['thsr:新竹','tra:六家'],
  'tainan-hsr-v1':['thsr:台南','tra:沙崙'],
  'airport-taipei-main-station':['tymc:台北'],
  'island-annex-tra-taitung':['tra:台東'],'island-annex-tra-douliu':['tra:斗六'],
  'island-annex-tymc-a18':['tymc:高鐵桃園'],
  'tra-xincheng-taroko':['tra:新城'],'tra-zuoying-jiucheng':['tra:左營'],
  'island-krtc-c27':['krtc:灣仔內(大順鼎山)'],
  'tra-taichung-v1':['tra:台中'],
};
const allNight = [[0,1440]];
const noPassengerHours = [null];
// 這幾座站房在現行班表沒有旅客停靠。有新班次時以班表為先。
const nonStoppingStations = new Set(['tra-fangye','tra-xinma',
  'island-afr_sched-afr_main12','island-afr_sched-afr_main13','island-afr_sched-afr_main14']);
export function modelHours(id,name='') {
  const venue=venueHours.get(id);
  if (venue) return [venue];
  if (/-bridge$/.test(id)) return [allNight];
  if (complexes[id]) return complexes[id].map(k=>stationHours[k]).filter(Boolean);
  const system = id.match(/(?:^|-)island-(?:ug-)?(afr|krtc|tymc|tmrt|ntdlrt|ntalrt|sanying)/)?.[1] ||
    (/^(?:island-(?:ug-)?)?mrt-/.test(id) ? 'trtc' : /-hsr-v1$/.test(id) ? 'thsr' : 'tra');
  // 古蹟舊站房、展館與現役客站要分開；相同站名可能代表兩座不同年代的建築。
  if (!/^(?:island-|mrt-|tra-)|-hsr-v1$/.test(id) &&
      !['kaohsiung-main-v1','hualien-v1','taitung-v1','hsinchu-tra','hexing-old','zhutian-old'].includes(id)) return [];
  const key=stationNameKey(name.replace(/^高鐵/,''));
  const week=stationHours[system+':'+key];
  return week ? [week] : nonStoppingStations.has(id) ? [noPassengerHours] : [];
}

function inWindow(week,day,minute) {
  const span=week[week.length===1 ? 0 : day];
  if (!span) return false;
  if (Array.isArray(span[0])) return span.some(([open,close])=>minute>=open && minute<close);
  return minute>=span[0] && minute<span[1];
}
// 凌晨仍可能有前一個營運日的末班；每個場館的結束時間為不含邊界。
export function lightLevel(schedules,hour,weekday,monthlyMonday='') {
  if (!schedules.length) return .36;
  const minute=(Math.floor(hour*60+1e-8)%1440+1440)%1440;
  for (const week of schedules)
    if ((monthlyMondayClosures.get(week)!==monthlyMonday && inWindow(week,weekday,minute)) ||
        inWindow(week,(weekday+6)%7,minute+1440)) return 1;
  return .12;
}

export function lightCalendar(year,month,day) {
  const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
  const monthlyMonday=weekday!==1 ? '' : day<=7 ? 'first' :
    day+7>new Date(Date.UTC(year,month,0)).getUTCDate() ? 'last' : '';
  return {weekday,monthlyMonday};
}

const daytime = {hour:12,weekday:0,monthlyMonday:'',night:0};
let lastSun, lastClock;
// 獨立 MapLibre 模型共用網站日照的台灣曆日、模擬時刻和日落過渡。
// 日夜光影關閉時 current 為 null，即回復白天的光源。
export function mapLightClock(sun) {
  if (!sun) return daytime;
  if (sun===lastSun) return lastClock;
  const taipei=new Date(sun.utcMs+8*3600000);
  lastSun=sun;
  lastClock={...lightCalendar(taipei.getUTCFullYear(),taipei.getUTCMonth()+1,taipei.getUTCDate()),
    hour:taipei.getUTCHours()+taipei.getUTCMinutes()/60,night:nightAmount(sun)};
  return lastClock;
}
export function lightModelScene(key,ambient,schedules,clock,dayKey,dayAmbient) {
  const {night,hour,weekday}=clock, level=lightLevel(schedules,hour,weekday,clock.monthlyMonday);
  key.intensity=dayKey*(1-night)+1.35*night*level;
  ambient.intensity=dayAmbient*(1-night)+night*(.13+.19*level);
}

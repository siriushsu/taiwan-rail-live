// 地景照明的每週常態班表取自 data/。跨日班車以實際到站的星期歸日，
// 凌晨四點前的末班屬於前一個營運日。只採計停靠站，兩方向與支線合併。
import fs from 'node:fs';
import { stationNameKey } from '../rail-3d/environment/station-name.js';
const data = new URL('../data/', import.meta.url);
const read = file => JSON.parse(fs.readFileSync(new URL(file+'.json', data)));
const stations = new Map();
function stop(system, name, weekday, sec) {
  if (!Number.isFinite(sec)) return;
  const key = system+':'+stationNameKey(name);
  const minute = Math.floor(sec / 60);
  const shift = Math.floor((minute - 240) / 1440);
  const d = (weekday + shift + 7) % 7, time = minute - shift*1440;
  if (!stations.has(key)) stations.set(key, Array(7).fill(null));
  const week = stations.get(key), range = week[d] ||= [time,time+1];
  range[0] = Math.min(range[0],time); range[1] = Math.max(range[1],time+1);
}
for (const [system,file] of [['tra','tra_schedule'],['thsr','../scripts/seo_data/thsr_timetable'],['afr','afr_schedule_dense']]) {
  const {trains,dates} = read(file);
  const runs = (train,d) => {
    for (const s of train.stops) if (s.stop !== false) {
      stop(system,s.name,d,s.arrSec); stop(system,s.name,d,s.depSec);
    }
  };
  if (dates) {
    for (const [date,ids] of Object.entries(dates)) {
      const d = new Date(date+'T00:00:00Z').getUTCDay();
      for (const i of ids) runs(trains[i],d);
    }
  } else for (let d=0;d<7;d++) for (const train of trains) runs(train,d);
}
for (const system of ['trtc','tymc','krtc','tmrt','ntalrt','ntdlrt','sanying']) {
  const times = read(system+'_times').lines;
  for (const line of read(system).lines) {
    const {days,sets} = times[line.id];
    days.forEach((set,d) => {
      for (const trip of sets[set]) for (let i=0;i<trip.length;i+=2) {
        stop(system,line.stations[trip[i]].name,d,trip[i+1]);
      }
    });
  }
}
// 高鐵官網各站「車站資訊」列的開門與關門時間。若當日有加班車則取聯集。
// https://www.thsrc.com.tw/ArticleContent/2f940836-cedc-41ef-8e28-c2336ac8fe68
const thsrDoors = {
  南港:[350,1445],台北:[360,1440],板橋:[360,1440],桃園:[380,1425],
  新竹:[375,1425],苗栗:[365,1425],台中:[340,1440],彰化:[380,1440],
  雲林:[375,1425],嘉義:[360,1425],台南:[345,1440],左營:[325,1440],
};
for (const [name,[opens,closes]] of Object.entries(thsrDoors)) {
  const week=stations.get('thsr:'+name);
  for (let day=0;day<7;day++) {
    const service=week[day] || [opens,closes];
    week[day]=[Math.min(opens,service[0]),Math.max(closes,service[1])];
  }
}
const entries = [...stations].sort(([a],[b]) => a < b ? -1 : 1).map(([key,week]) => {
  // 台鐵旅客運送契約第 3 條，首班前半小時開站，末班後十分鐘收班。
  // https://www.railway.gov.tw/tra-tip-web/tip/file/61f5001f-3ab9-417a-a0de-b54244f57809
  if (key.startsWith('tra:')) for (const range of week) if (range) {
    range[0] -= 30;
    range[1] += 9; // 已經包含末班那一分鐘
  }
  const constant = week.every(range => JSON.stringify(range) === JSON.stringify(week[0]));
  return '  '+JSON.stringify(key)+': '+JSON.stringify(constant ? [week[0]] : week);
});
fs.writeFileSync(new URL('../rail-3d/environment/station-hours.js',import.meta.url),
  '// 由 scripts/build_landscape_station_hours.mjs 產生，單位為營運日的分鐘。\nexport const stationHours = {\n'+entries.join(',\n')+'\n};\n');
console.log('地景逐站班表',entries.length);

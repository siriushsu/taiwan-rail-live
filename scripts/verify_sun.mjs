import assert from 'node:assert/strict';
import {sunPosition, solarTimeMs, toMapLibreSunPosition, sunlightAt} from '../rail-3d/environment/sun.mjs';

// 獨立數值：NREL/TP-560-34302，A.5，表 A5.1。
// https://docs.nlr.gov/docs/fy08osti/34302.pdf （2003-10-17 12:30:30，UTC−7）
// NOAA 近似未做折射／視差，容許 0.1°，不套用 SPA 的高精度宣稱。
const ref = sunPosition(Date.parse('2003-10-17T12:30:30-07:00'),39.742476,-105.1786);
assert.ok(Math.abs(ref.azimuth-194.34024)<.1);
assert.ok(Math.abs(90-ref.elevation-50.11162)<.1);
console.log('PASS NREL 獨立樣例：方位與高度',ref);

assert.equal(solarTimeMs('2026-09-08',0),Date.parse('2026-09-07T16:00:00Z'));
assert.equal(solarTimeMs('2026-09-08',86400),solarTimeMs('2026-09-08',0));
assert.equal(solarTimeMs('2026-09-08',-1),solarTimeMs('2026-09-08',86399));
assert.ok(Number.isNaN(solarTimeMs('bad',0)));
console.log('PASS 台北曆日、午夜與時間軸循環');

for(const lat of [22,23.4487,25.033])for(const date of ['2026-03-20','2026-06-21','2026-09-08','2026-12-21']){
 let high=-90,previous;
 for(let sec=0;sec<86400;sec+=30){
  const ms=solarTimeMs(date,sec),s=sunlightAt(ms,lat,121.565);
  assert.ok(Number.isFinite(s.elevation)&&s.azimuth>=0&&s.azimuth<360);
  assert.deepEqual(s.light.position,toMapLibreSunPosition(ms,lat,121.565));
  assert.equal(s.light.anchor,'map');
  assert.ok(s.light.intensity>=0&&s.light.intensity<=1);
  if(previous)for(const k of ['sky-color','horizon-color']){
   const rgb=x=>x.match(/\w\w/g).map(v=>parseInt(v,16));
   assert.ok(rgb(s.sky[k].slice(1)).every((v,i)=>Math.abs(v-rgb(previous.sky[k].slice(1))[i])<=5),'配色不突然跳變');
  }
  high=Math.max(high,s.elevation);previous=s;
 }
 if(lat===23.4487&&date==='2026-06-21')assert.ok(high>89.5);
}
console.log('PASS 台灣南北、四季逐 30 秒掃描：有限值、合法參數與連續配色');
const at=h=>sunlightAt(solarTimeMs('2026-09-08',h*3600),25.033,121.565);
assert.ok(at(6).azimuth>70&&at(6).azimuth<110);
assert.ok(at(18).azimuth>250&&at(18).azimuth<290);
assert.ok(at(0).elevation<0);
assert.equal(new Set([0,6,12,18].map(h=>at(h).sky['sky-color'])).size,4);
console.log('PASS 晨東暮西、午夜在地平線下、四時段色彩');

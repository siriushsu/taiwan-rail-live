import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sunPosition, solarTimeMs, toMapLibreSunPosition, sunlightAt, PAVED_LAYERS, parseColor, shadeColor} from '../rail-3d/environment/sun.mjs';

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
  assert.ok(s.hillshade['hillshade-illumination-direction']>=0&&s.hillshade['hillshade-illumination-direction']<=359);
  assert.ok(s.hillshade['hillshade-illumination-altitude']>=0&&s.hillshade['hillshade-illumination-altitude']<=90);
  assert.ok(s.hillshade['hillshade-exaggeration']>=.08&&s.hillshade['hillshade-exaggeration']<=.42+1e-10);
  if(previous)assert.ok(Math.abs(s.hillshade['hillshade-exaggeration']-previous.hillshade['hillshade-exaggeration'])<.01,'坡面對比不突然跳變');
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

// ── 夜間鋪面（2026-09-09）────────────────────────────────────────────────────
// 使用者回報「晚上道路都還是淺色的，幾乎看不清楚軌道跟車」。壓暗地面的是 landscape-hillshade
// 的陰影色，而 map3d.js 把那層插在 'building' 之前——畫在它上面的道路、機場鋪面、底圖鐵道
// 與 2D 建物因此整夜維持白天配色。這一組守的是「名單沒漏、白天不動、夜裡真的變暗」。
const style = JSON.parse(fs.readFileSync('vendor/ofm-landscape.json', 'utf8'));
const ids = style.layers.map(l => l.id);
// 插入點改了，名單的上下界就整個失效——先擋住這件事，再談名單本身。
assert.ok(fs.readFileSync('rail-3d/integration/map3d.js', 'utf8').includes("'landscape-hillshade'")
  && /addLayer\(\{id:'landscape-hillshade'[\s\S]{0,400}?\},'building'\)/.test(fs.readFileSync('rail-3d/integration/map3d.js', 'utf8')),
  'landscape-hillshade 不再插在 building 之前，PAVED_LAYERS 的上下界要重新盤');
// 下界＝hillshade 的插入點；上界＝行政界線（再上面是地名標籤，壓暗只會看不清楚字）。
const expected = ids.slice(ids.indexOf('building'), ids.indexOf('boundary_3'));
assert.deepEqual(PAVED_LAYERS.map(([id]) => id), expected,
  '樣式檔在 hillshade 與行政界線之間的圖層與 PAVED_LAYERS 不一致（少一條＝那條入夜後還是淺色）');
assert.equal(PAVED_LAYERS.length, 25, '鋪面名單長度變了，請確認是樣式真的增減圖層');
// 每一條都真的能解析出顏色：解析不出來的會被原樣跳過，等於這條沒被壓暗而且不會有錯誤訊息。
for (const [id, prop] of PAVED_LAYERS) {
  const layer = style.layers.find(l => l.id === id);
  assert.ok(layer, `${id} 不在樣式檔裡`);
  assert.ok(parseColor(layer.paint?.[prop]), `${id} 的 ${prop} 解析不出純色：${JSON.stringify(layer.paint?.[prop])}`);
}
console.log(`PASS 夜間鋪面名單涵蓋 hillshade 之上、界線之下的 ${PAVED_LAYERS.length} 個圖層，且都解析得出純色`);

// 三種寫法都要認得；認不得的（資料驅動 expression）必須原樣不動，不可換成一個死色。
assert.deepEqual(parseColor('#f7efd9'), [[247, 239, 217], 1]);
assert.deepEqual(parseColor('#abc'), [[170, 187, 204], 1]);
assert.deepEqual(parseColor('rgba(255, 255, 255, 1)'), [[255, 255, 255], 1]);
assert.deepEqual(parseColor('hsl(0,0%,88%)')[0].map(Math.round), [224, 224, 224]);
assert.equal(parseColor(['match', ['get', 'class'], 'a', '#fff', '#000']), null);
assert.deepEqual(shadeColor(['get', 'color'], [23, 38, 59], .72), ['get', 'color']);
assert.equal(shadeColor('rgba(255, 255, 255, .5)', [23, 38, 59], .5), 'rgba(139,147,157,0.5)');
console.log('PASS 色彩解析涵蓋 #hex／rgba()／hsl()，expression 原樣跳過');

const noon = at(12), midnight = at(0);
assert.equal(noon.paved.alpha, 0, '白天不准動道路配色');
assert.equal(shadeColor('#f7efd9', noon.paved.ink, noon.paved.alpha), '#f7efd9');
assert.ok(midnight.paved.alpha > .7, `夜裡鋪面壓暗不足：${midnight.paved.alpha}`);
// 反向對照：夜色不能壓到跟地面一樣暗，否則路網等於消失。地面吃的是 hillshade 的 0.82。
assert.ok(midnight.paved.alpha < .82, '鋪面壓得比地面還暗，路網會整個看不見');
// 逐 30 秒掃一天：不跳變，而且黃昏／黎明真的有一段中間值（硬切也會「正午 0、午夜滿」）。
let last = null, maxJump = 0, between = 0;
for (let sec = 0; sec < 86400; sec += 30) {
  const s = sunlightAt(solarTimeMs('2026-09-08', sec), 25.033, 121.565);
  assert.ok(s.paved.alpha >= 0 && s.paved.alpha <= .72);
  if (s.paved.alpha > .001 && s.paved.alpha < .719) between += 30;
  if (last !== null) maxJump = Math.max(maxJump, Math.abs(s.paved.alpha - last));
  last = s.paved.alpha;
}
assert.ok(maxJump < .01, `鋪面夜色跳變 ${maxJump}`);
assert.ok(between > 3600, `晨昏過渡只有 ${between} 秒，等於硬切`);
console.log(`PASS 鋪面夜色：正午 0、午夜 ${midnight.paved.alpha.toFixed(2)}、晨昏過渡合計 ${between} 秒，逐 30 秒最大跳變 ${maxJump.toFixed(4)}`);

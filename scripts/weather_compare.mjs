#!/usr/bin/env node
// 跟車即時天氣 P0：雷達回波對雨量站，看「雷達說在下雨」跟地面量到的雨對不對得上，決定 App 要用多少 dBZ 當「下雨」。
//   node scripts/weather_compare.mjs --files <資料夾>              # 資料夾裡放氣象署原始 O-A0059-001.json／O-A0003-001.json／O-A0002-001.json
//   node scripts/weather_compare.mjs --api https://railisland.tw --hours 72   # 讀 /api/weather 存下來的歷史
// 每個有 10 分鐘雨量的雨量站算一對：雷達取站點那一格（「單格」）與周圍 3×3 的最大值（「3×3」，容許一格內的位置誤差）。
// --files 模式另外用全部測站的 TWD67／WGS84 兩組座標重算位移中位數，核對 weather_frames.mjs 的 TWD67_TO_WGS84。
import { readFileSync } from 'node:fs';
import { cropRadar, parseObs, parseRain, sampleRadar, unb64, TWD67_TO_WGS84 } from './weather_frames.mjs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const THRESHOLDS = [15, 20, 25, 30, 35];

function pairs(radar, bytes, rain) {
  const out = [];
  for (const [id, lon, lat, p10m, p1h] of rain.rows) {
    if (p10m == null) continue;
    const one = sampleRadar(radar, lon, lat, bytes);
    if (one == null) continue;
    let max = one;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const v = sampleRadar(radar, lon + dx * radar.res, lat + dy * radar.res, bytes);
      if (v != null && v > max) max = v;
    }
    out.push({ id, one, max, p10m, p1h });
  }
  return out;
}

function report(all, label) {
  const wet = all.filter(p => p.p10m > 0).length;
  console.log(`\n${label}：${all.length} 對，雨量站 10 分鐘有雨 ${wet} 對`);
  console.log('門檻 dBZ | 取樣 | 雷達有雨且站有雨 | 雷達有雨站沒雨 | 雷達沒雨站有雨 | 抓到站上的雨 | 雷達說有雨時站真的有雨');
  for (const t of THRESHOLDS) for (const k of ['one', 'max']) {
    const tp = all.filter(p => p[k] >= t && p.p10m > 0).length, fp = all.filter(p => p[k] >= t && !(p.p10m > 0)).length;
    const fn = all.filter(p => p[k] < t && p.p10m > 0).length;
    const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '-';
    console.log(`${String(t).padStart(8)} | ${k === 'one' ? '單格' : '3×3 '} | ${String(tp).padStart(16)} | ${String(fp).padStart(14)} | ${String(fn).padStart(14)} | ${pct(tp, tp + fn).padStart(12)} | ${pct(tp, tp + fp).padStart(10)}`);
  }
  // 「站沒雨」可能只是 10 分鐘內雨太小量不到 0.5 mm；用 1 小時雨量再看一次雷達有雨站沒雨的那些
  const fp20 = all.filter(p => p.one >= 20 && !(p.p10m > 0));
  if (fp20.length) console.log(`雷達 ≥20 dBZ 但 10 分鐘沒雨的 ${fp20.length} 對裡，1 小時內有雨 ${fp20.filter(p => p.p1h > 0).length} 對`);
}

if (opt('--files')) {
  const dir = opt('--files'), read = f => readFileSync(`${dir}/${f}`, 'utf8');
  const radar = cropRadar(read('O-A0059-001.json')), rain = parseRain(read('O-A0002-001.json'));
  console.log(`雷達 ${radar.at}（${radar.w}×${radar.h}，${radar.datum}）、雨量站 ${rain.at}`);
  const st = JSON.parse(read('O-A0003-001.json')).cwaopendata.dataset.Station;
  const d = st.map(s => Object.fromEntries((s.GeoInfo.Coordinates || []).map(c => [c.CoordinateName, [+c.StationLongitude, +c.StationLatitude]])))
    .filter(c => c.TWD67 && c.WGS84).map(c => [c.WGS84[0] - c.TWD67[0], c.WGS84[1] - c.TWD67[1]]);
  const med = i => { const v = d.map(x => x[i]).sort((a, b) => a - b); return v[v.length >> 1]; };
  console.log(`TWD67→WGS84 位移中位數（${d.length} 站）：經度 ${med(0).toFixed(5)}、緯度 ${med(1).toFixed(5)}；程式用 ${TWD67_TO_WGS84.dlon}、${TWD67_TO_WGS84.dlat}`);
  if (radar.at !== rain.at) console.log('⚠️ 雷達與雨量站不是同一個時刻，對比會有落差');
  report(pairs(radar, radar.bytes, rain), radar.at);
} else if (opt('--api')) {
  const base = opt('--api').replace(/\/$/, ''), hours = Number(opt('--hours')) || 24;
  const list = (await (await fetch(`${base}/api/weather?list=1&hours=${hours}`)).json()).frames.filter(f => f.rainAt === f.at);
  console.log(`${base}：最近 ${hours} 小時 ${list.length} 筆雷達與雨量站同時刻的資料`);
  const all = [];
  for (const f of list) {
    const j = await (await fetch(`${base}/api/weather?at=${encodeURIComponent(f.at)}`)).json();
    all.push(...pairs(j.radar, unb64(j.radar.data), j.rain));
  }
  report(all, `${list.length} 筆合計`);
} else {
  console.error('用法見檔頭');
  process.exit(2);
}

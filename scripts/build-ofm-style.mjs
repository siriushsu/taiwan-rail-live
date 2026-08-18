#!/usr/bin/env node
// 從 OpenFreeMap 取樣式，調成「跟現行 CARTO 一樣安靜」再存進 vendor/。
// 動三件事：標籤改中文優先單行、路名與路牌整層拿掉、鄉里級標籤往後推。
// 圖磚、sprite、glyphs 仍指向 OpenFreeMap（我們只自存樣式檔）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ZH = ['coalesce', ['get', 'name:nonlatin'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name:latin']];

// 兩套樣式的圖層命名不同血統，各自列清單；對不上就 fail，不要靜靜跳過
const CONF = {
  positron: {
    url: 'https://tiles.openfreemap.org/styles/positron',
    drop: ['highway-name-path', 'highway-name-minor', 'highway-name-major',
           'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us'],
    minzoom: { label_other: 15, label_village: 14, label_town: 9 },
  },
  dark: {
    url: 'https://tiles.openfreemap.org/styles/dark',
    drop: ['highway_name_other', 'highway_name_motorway', 'road_oneway', 'road_oneway_opposite'],
    minzoom: { place_other: 15, place_suburb: 14, place_village: 14, place_town: 9 },
  },
};

for (const [name, cf] of Object.entries(CONF)) {
  const res = await fetch(cf.url);
  if (!res.ok) throw new Error(`${name} 取樣式失敗 HTTP ${res.status}`);
  const style = await res.json();

  let n = 0;
  for (const l of style.layers) {
    if (l.type !== 'symbol' || !l.layout) continue;
    const tf = l.layout['text-field'];
    // 只改「雙語串接」那種；路牌 ref 之類的本來就不留
    if (Array.isArray(tf) && JSON.stringify(tf).includes('name:nonlatin')) { l.layout['text-field'] = ZH; n++; }
  }

  const missing = cf.drop.filter(id => !style.layers.some(l => l.id === id));
  if (missing.length) throw new Error(`${name}: 找不到要拿掉的圖層 ${missing.join(', ')}——上游樣式結構變了，先去看一眼`);
  style.layers = style.layers.filter(l => !cf.drop.includes(l.id));

  for (const [id, z] of Object.entries(cf.minzoom)) {
    const l = style.layers.find(x => x.id === id);
    if (!l) throw new Error(`${name}: 找不到圖層 ${id}`);
    l.minzoom = z;
  }

  const out = path.join(root, 'vendor', `ofm-${name}.json`);
  fs.writeFileSync(out, JSON.stringify(style));
  console.log(`${name}: 標籤改 ${n} 層、拿掉 ${cf.drop.length} 層路名路牌、${Object.keys(cf.minzoom).length} 層提高 minzoom → vendor/ofm-${name}.json (${fs.statSync(out).size} bytes)`);
}

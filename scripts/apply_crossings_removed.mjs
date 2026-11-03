#!/usr/bin/env node
// 把 lib/crossings_removed.mjs 的清單從現行 data/crossings.json 拿掉，其餘欄位一字不動。
// 不整檔重跑 build_crossings.mjs 的原因：tra.json 線形在 07-12 之後改過（臺南地下化等），整檔重建會連帶改動
// 數十筆的 d，tracks/elec 還要另跑 enrich_crossings_osm.mjs 重抓 OSM。build_crossings.mjs 讀同一份清單，日後重建不會長回來。
// 用法：node scripts/apply_crossings_removed.mjs（可重跑；已拿掉的條目不再改動）
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { REMOVED_CROSSINGS, removedKey } from './lib/crossings_removed.mjs';

const file = 'data/crossings.json';
const raw = fs.readFileSync(file, 'utf8');
assert.equal(JSON.stringify(JSON.parse(raw)), raw, 'crossings.json 序列化方式跟 JSON.stringify 不同');
const cross = JSON.parse(raw);
const keys = new Set(REMOVED_CROSSINGS.map(removedKey));
const dropped = cross.crossings.filter(x => keys.has(removedKey(x)));
if (!dropped.length) { console.log('沒有要拿掉的條目'); process.exit(0); }
cross.crossings = cross.crossings.filter(x => !keys.has(removedKey(x)));
const note = '官方 XML 仍帶座標、現地已地下化/高架化或停用的平交道另行排除(清單與依據見 scripts/lib/crossings_removed.mjs)。';
cross.source_notes = cross.source_notes.replace(/合計 \d+ 筆。/, `合計 ${cross.crossings.length} 筆。`)
  .replace('與台鐵官方公布現役平交道數一致,', '');
if (!cross.source_notes.includes(note)) cross.source_notes += note;
fs.writeFileSync(file, JSON.stringify(cross));
console.log(`拿掉 ${dropped.length} 筆：${dropped.map(x => `${x.name}(${x.lnId})`).join('、')}；剩 ${cross.crossings.length} 筆`);
